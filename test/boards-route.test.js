import "./helpers.js";
import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/app.js";
import { findTask, findBoard } from "../src/data/tasks.js";

const form = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
});

const del = (body) => ({
    method: "DELETE",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
});

const rowIds = (html) => [...html.matchAll(/data-task-id="(\d+)"/g)].map((m) => Number(m[1]));

test("board + view routes", async (t) => {
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://localhost:${server.address().port}`;
    t.after(() => server.close());

    await t.test("GET /boards renders the sidebar with every board", async () => {
        const html = await (await fetch(`${base}/boards`)).text();
        for (const name of ["Designs", "Branding", "Email Template"]) assert.ok(html.includes(name));
        assert.match(html, /data-board-id="1"/);
        // the last board gets no delete button (three boards here, so all three do)
        assert.equal((html.match(/hx-delete="\/boards\//g) ?? []).length, 3);
    });

    await t.test("GET /boards/:id renders that board's own tasks only", async () => {
        const one = await (await fetch(`${base}/boards/1`)).text();
        // board view renders columns in order: planned(1,3), progress(2), done(4)
        assert.deepEqual(rowIds(one), [1, 3, 2, 4]);
        assert.ok(!one.includes("Logo variants"));
        const two = await (await fetch(`${base}/boards/2`)).text();
        assert.deepEqual(rowIds(two), [6, 5]);
        assert.ok(two.includes("Logo variants"));
    });

    await t.test("GET /boards/999 is a 404", async () => {
        assert.equal((await fetch(`${base}/boards/999`)).status, 404);
        assert.equal((await fetch(`${base}/boards/nope`)).status, 404);
    });

    await t.test("table view sorts server-side by ?sort=&dir=", async () => {
        const asc = await (await fetch(`${base}/boards/1?view=table&sort=title&dir=asc`)).text();
        assert.ok(asc.includes("task-table"));
        assert.deepEqual(rowIds(asc), [4, 2, 3, 1]);
        const byStatus = await (await fetch(`${base}/boards/1?view=table&sort=status&dir=asc`)).text();
        assert.deepEqual(rowIds(byStatus), [1, 3, 2, 4]);
        const desc = await (await fetch(`${base}/boards/1?view=table&sort=status&dir=desc`)).text();
        assert.deepEqual(rowIds(desc), [4, 2, 1, 3]);
        // sort headers carry the chevron for the active column
        // (the fragment escapes quotes, so match #i-chevron-down-outline)
        assert.ok(desc.includes("#i-chevron-down-outline"), "desc header should render the down chevron");
    });

    await t.test("list view groups rows under column headings", async () => {
        const html = await (await fetch(`${base}/boards/1?view=list`)).text();
        assert.ok(html.includes("task-list"));
        assert.match(html, /id="list-planned"[\s\S]*id="row-1"[\s\S]*id="row-3"/);
        assert.match(html, /id="list-progress"[\s\S]*id="row-2"/);
        assert.match(html, /id="list-done"[\s\S]*id="row-4"/);
    });

    await t.test("search filters the rendered view", async () => {
        const html = await (await fetch(`${base}/boards/1?view=table&q=hero`)).text();
        assert.deepEqual(rowIds(html), [2]);
    });

    await t.test("POST /tasks with a boardId lands on that board", async () => {
        const r = await fetch(`${base}/tasks`, form("title=Wireframe+the+pricing+page&status=planned&boardId=3"));
        assert.equal(r.status, 200);
        const html = await r.text();
        assert.ok(html.includes("Wireframe the pricing page"));
        assert.equal(findTask(9).boardId, 3);
        // default sort is column order: planned(7,9) then done(8)
        assert.deepEqual(rowIds(await (await fetch(`${base}/boards/3?view=table`)).text()), [7, 9, 8]);
        // no boardId defaults to board 1
        await fetch(`${base}/tasks`, form("title=Loose+idea&status=planned"));
        assert.equal(findTask(10).boardId, 1);
    });

    await t.test("move from the table re-renders the table, not the columns", async () => {
        const r = await fetch(`${base}/tasks/1/move`, form("toColumn=done&toIndex=0&view=table&sort=order&dir=asc"));
        assert.equal(r.status, 200);
        const html = await r.text();
        assert.ok(html.includes("task-table"));
        assert.ok(!html.includes('<section class="column"'));
        assert.match(html, /moved to Done/);
        assert.equal(findTask(1).status, "done");
        assert.equal(findTask(1).boardId, 1);
    });

    await t.test("delete from the table re-renders the table", async () => {
        const r = await fetch(`${base}/tasks/9`, del("view=table&sort=order&dir=asc"));
        assert.equal(r.status, 200);
        const html = await r.text();
        assert.ok(html.includes("task-table"));
        assert.ok(!html.includes("Wireframe the pricing page"));
        assert.equal(findTask(9), undefined);
    });

    await t.test("POST /boards adds one, rename changes it, delete cleans its tasks", async () => {
        const created = await (await fetch(`${base}/boards`, form("name=Launch+plan"))).text();
        assert.ok(created.includes("Launch plan"));
        const renamed = await (await fetch(`${base}/boards/4`, form("name=Launch week"))).text();
        assert.ok(renamed.includes("Launch week"));
        await fetch(`${base}/tasks`, form("title=Press+kit&status=planned&boardId=4"));
        const removed = await fetch(`${base}/boards/4`, del(""));
        assert.equal(removed.status, 200);
        const html = await removed.text();
        assert.ok(!html.includes("Launch week"));
        assert.match(html, /data-removed-task-ids="\d+"/);
        assert.equal(findTask(11), undefined);
        assert.equal((await fetch(`${base}/boards/4`)).status, 404);
    });

    await t.test("an empty board name is a 400", async () => {
        assert.equal((await fetch(`${base}/boards`, form("name=+"))).status, 400);
        assert.equal((await fetch(`${base}/boards/1`, form("name=%20"))).status, 400);
    });

    await t.test("rename trims whitespace and stores the trimmed name", async () => {
        const r = await fetch(`${base}/boards/1`, form("name=%20%20Trimmed%20%20"));
        assert.equal(r.status, 200);
        assert.ok((await r.text()).includes("Trimmed"));
        assert.equal(findBoard(1).name, "Trimmed");
        // restore for later tests in this file
        await fetch(`${base}/boards/1`, form("name=Designs"));
    });

    await t.test("rename rejects a too-long name with a 400 (no silent truncate)", async () => {
        const long = "x".repeat(60);
        const before = findBoard(1).name;
        const r = await fetch(`${base}/boards/1`, form(`name=${long}`));
        assert.equal(r.status, 400);
        assert.match(await r.text(), /too long/i);
        assert.equal(findBoard(1).name, before); // unchanged, not truncated
        // a new board rejects the same way
        const created = await fetch(`${base}/boards`, form(`name=${long}`));
        assert.equal(created.status, 400);
    });

    await t.test("rename accepts exactly 40 characters", async () => {
        const r = await fetch(`${base}/boards/1`, form(`name=${"y".repeat(40)}`));
        assert.equal(r.status, 200);
        assert.equal(findBoard(1).name.length, 40);
        await fetch(`${base}/boards/1`, form("name=Designs"));
    });

    await t.test("rename escapes HTML in the rendered nav", async () => {
        const r = await fetch(`${base}/boards/1`, form("name=%3Cb%3Ex%3C%2Fb%3E"));
        assert.equal(r.status, 200);
        const html = await r.text();
        // the raw tag must not appear as markup; it is escaped text
        assert.ok(!/<b>x<\/b>/.test(html));
        assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;") || html.includes("&#60;b&#62;"));
        assert.equal(findBoard(1).name, "<b>x</b>");
        await fetch(`${base}/boards/1`, form("name=Designs"));
    });

    await t.test("rename an unknown board is a 404", async () => {
        assert.equal((await fetch(`${base}/boards/999`, form("name=Ghost"))).status, 404);
    });

    await t.test("the last board cannot be deleted", async () => {
        assert.equal((await fetch(`${base}/boards/2`, del(""))).status, 200);
        assert.equal((await fetch(`${base}/boards/3`, del(""))).status, 200);
        // one board left: no delete button in the nav, and the route 400s
        const html = await (await fetch(`${base}/boards`)).text();
        assert.equal((html.match(/hx-delete="\/boards\//g) ?? []).length, 0);
        assert.equal((await fetch(`${base}/boards/1`, del(""))).status, 400);
    });
});

import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/app.js";
import { getNote } from "../src/data/tasks.js";

const post = (base, path, body) =>
    fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });

test("notes routes", async (t) => {
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://localhost:${server.address().port}`;
    t.after(() => server.close());

    await t.test("panel contains textarea, version input, empty status area", async () => {
        const html = await (await fetch(`${base}/tasks/1/notes`)).text();
        assert.match(html, /<textarea class="notes-textarea"[^>]*name="note"/);
        assert.match(html, /id="note-version" name="version" value="0"/);
        assert.match(html, /id="note-status-swap"/);
        assert.ok(!html.includes("<%-"));
    });

    await t.test("two saves in a row carry the right base version", async () => {
        const r1 = await post(base, "/tasks/1/notes", "note=one&version=0");
        assert.equal(r1.status, 200);
        const h1 = await r1.text();
        // response is the OOB version input only
        assert.match(h1, /id="note-version" name="version" value="1" hx-swap-oob="true"/);
        assert.equal(getNote(1).version, 1);

        // second save sends the version the OOB fragment delivered
        const r2 = await post(base, "/tasks/1/notes", "note=two&version=1");
        assert.equal(r2.status, 200);
        const h2 = await r2.text();
        assert.match(h2, /id="note-version" name="version" value="2" hx-swap-oob="true"/);
        assert.equal(getNote(1).note, "two");
        assert.equal(getNote(1).version, 2);
    });

    await t.test("empty note save clears and still bumps version", async () => {
        const r = await post(base, "/tasks/1/notes", "note=&version=2");
        assert.equal(r.status, 200);
        assert.match(await r.text(), /value="3"/);
        assert.equal(getNote(1).note, "");
        assert.equal(getNote(1).version, 3);
    });

    await t.test("note text is escaped in the panel", async () => {
        await post(base, "/tasks/2/notes", "note=%3Cb%3Ebold%3C%2Fb%3E&version=0");
        const html = await (await fetch(`${base}/tasks/2/notes`)).text();
        assert.ok(!html.includes("<b>bold</b>"));
        assert.ok(html.includes("&lt;b&gt;bold&lt;/b&gt;"));
    });

    await t.test("unknown id: panel and save are 404", async () => {
        assert.equal((await fetch(`${base}/tasks/999/notes`)).status, 404);
        assert.equal((await post(base, "/tasks/999/notes", "note=x&version=0")).status, 404);
    });
});

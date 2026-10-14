// test/icons.test.js — icon sprite, helper, and glyph-guard tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import app from "../src/app.js";
import { listBoards, getTask, columns as COLUMNS, findTask, getNote } from "../src/data/tasks.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, exts, out = []) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === "node_modules" || name === "screenshots") continue;
            walk(full, exts, out);
        } else if (exts.some((e) => name.endsWith(e))) {
            out.push(full);
        }
    }
    return out;
}

const sprite = readFileSync(path.join(root, "src/views/partials/icon-sprite.ejs"), "utf8");
const spriteNames = new Set([...sprite.matchAll(/id="i-([^"]+)"/g)].map((m) => m[1]));

test("sprite exists and has no <title>", () => {
    assert.ok(spriteNames.size > 0, "sprite should contain at least one symbol");
    assert.ok(!sprite.includes("<title"), "sprite must not contain <title>");
});

test("app.locals.icon works for every sprite name", () => {
    for (const name of spriteNames) {
        const html = app.locals.icon(name);
        assert.ok(html.includes(`#i-${name}`), `icon(${name}) should reference its symbol`);
    }
});

test("app.locals.icon throws for unknown name", () => {
    assert.throws(() => app.locals.icon("does-not-exist"), /unknown name/);
    assert.throws(() => app.locals.icon(""), /unknown name/);
    assert.throws(() => app.locals.icon("menu"), /unknown name/); // must be menu-outline
});

test("every icon() call in ejs views exists in the sprite", () => {
    const views = walk(path.join(root, "src/views"), [".ejs"]);
    let calls = 0;
    for (const file of views) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/icon\(["']([^"']+)["']\)/g)) {
            calls++;
            assert.ok(spriteNames.has(m[1]), `${path.relative(root, file)}: icon("${m[1]}") not in sprite`);
        }
    }
    assert.ok(calls > 0, "expected at least one icon() call in views");
});

test("every Icon() call in public js exists in the sprite", () => {
    const files = walk(path.join(root, "public"), [".js"]);
    for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/Icon\(["']([^"']+)["']\)/g)) {
            assert.ok(spriteNames.has(m[1]), `${path.relative(root, file)}: Icon("${m[1]}") not in sprite`);
        }
    }
});

test("no ion-icon / CDN / leftover glyph usage in src or public", () => {
    const files = [
        ...walk(path.join(root, "src"), [".ejs", ".js", ".css"]),
        ...walk(path.join(root, "public"), [".js", ".css"]),
    ];
    const blocklist = /<ion-icon|ionicons\.esm\.js|<script[^>]*(?:unpkg\.com|jsdelivr)|<link[^>]*(?:unpkg\.com|jsdelivr)|☰|✕|✖|✓|✎|▾|▸|⋮|&times;/;
    for (const file of files) {
        const src = readFileSync(file, "utf8");
        const m = src.match(blocklist);
        assert.equal(m, null, `${path.relative(root, file)}: forbidden token "${m && m[0]}"`);
    }
});

// --- guard: escaped icon markup. icon() returns a <svg> string; if a template
// prints it through the escaped form (<%=) the browser shows the literal
// "<svg class=..." as text. These two tests make that class of bug loud.

test("lint: every icon( call in src/views is printed unescaped", () => {
    const views = walk(path.join(root, "src/views"), [".ejs"]);
    let calls = 0;
    for (const file of views) {
        const src = readFileSync(file, "utf8");
        // strip <%# comments so a comment mentioning the escaped form can't trip this
        const code = src.replace(/<%#[\s\S]*?%>/g, "");
        // any icon( occurring inside an escaped <%= ... %> block is the bug
        for (const m of code.matchAll(/<%=[\s\S]*?%>/g)) {
            if (/\bicon\s*\(/.test(m[0])) {
                assert.fail(`${path.relative(root, file)}: icon() printed inside an escaped <%= ... %> block — use the unescaped form`);
            }
        }
        for (const m of code.matchAll(/\bicon\s*\(/g)) calls++;
        // every icon( must live in an unescaped block
        const unescaped = [...code.matchAll(/<%-[\s\S]*?%>/g)].map((m) => m[0]).join("\n");
        const escaped = [...code.matchAll(/<%=[\s\S]*?%>/g)].map((m) => m[0]).join("\n");
        const inEscapedOnly = (code.match(/\bicon\s*\(/g) || []).length - (unescaped.match(/\bicon\s*\(/g) || []).length - (escaped.match(/\bicon\s*\(/g) || []).length;
        assert.equal(inEscapedOnly, 0, `${path.relative(root, file)}: icon() call outside any output block`);
    }
    assert.ok(calls > 0, "expected at least one icon() call in views");
});

test("rendered views never contain escaped svg/use/path entities", async () => {
    const render = (name, data) => new Promise((resolve, reject) =>
        app.render(name, data, (err, html) => (err ? reject(err) : resolve(html))));

    const cases = [];
    // shell + sidebar + banner
    cases.push(["index", await render("index", {})]);
    cases.push(["partials/boards", await render("partials/boards", { boards: listBoards() })]);
    // board / list
    const boardData = { boards: listBoards(), boardId: 1, view: "board", sort: "order", dir: "asc", q: "", columns: COLUMNS, tasks: getTask(1) };
    cases.push(["board", await render("partials/board", boardData)]);
    cases.push(["list", await render("partials/list", { ...boardData, view: "list" })]);
    // table sorted by every column, both directions
    for (const sort of ["title", "status", "note", "order"]) {
        for (const dir of ["asc", "desc"]) {
            cases.push([`table ${sort}/${dir}`, await render("partials/table", { ...boardData, view: "table", sort, dir })]);
        }
    }
    // notes panel + conflict fragment
    const task = findTask(1);
    cases.push(["notes-panel", await render("partials/notes-panel", { task, note: getNote(1) })]);
    cases.push(["note-conflict", await render("partials/note-conflict", { version: 2, updatedAt: "2026-10-13T10:00:00.000Z", note: "hello" })]);

    const bad = /&lt;svg|&lt;use|&lt;path/;
    for (const [label, html] of cases) {
        const m = html.match(bad);
        assert.equal(m, null, `${label}: escaped icon markup leaked into output ("${m && m[0]}")`);
        assert.ok(!html.includes("<ion-icon"), `${label}: ion-icon web component`);
    }
});

import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/app.js";

const form = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
});

test("move route response shape", async (t) => {
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://localhost:${server.address().port}`;
    t.after(() => server.close());

    await t.test("same-column move: exactly one section, no OOB, announces the slot", async () => {
        // seed: planned = [1, 3] — reorder within planned
        const res = await fetch(`${base}/tasks/3/move`, form("toColumn=planned&toIndex=0"));
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.equal((html.match(/<section/g) ?? []).length, 1);
        assert.equal((html.match(/id="column-planned"/g) ?? []).length, 1);
        assert.ok(!html.includes("hx-swap-oob"));
        assert.match(html, /moved to position 1 of 2/);
    });

    await t.test("cross-column move: two sections, source OOB-free, dest carries oob", async () => {
        const res = await fetch(`${base}/tasks/3/move`, form("toColumn=done&toIndex=0"));
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.equal((html.match(/<section/g) ?? []).length, 2);
        assert.equal((html.match(/id="column-planned"/g) ?? []).length, 1);
        assert.equal((html.match(/id="column-done"/g) ?? []).length, 1);
        assert.equal((html.match(/hx-swap-oob/g) ?? []).length, 1);
        // oob attr sits on the destination section (sections also carry tabindex="-1")
        assert.match(html, /<section class="column" id="column-done"[^>]*hx-swap-oob="true">/);
    });

    await t.test("missing toColumn is a 400 (no implicit move-right caller)", async () => {
        const res = await fetch(`${base}/tasks/3/move`, form(""));
        assert.equal(res.status, 400);
    });
});

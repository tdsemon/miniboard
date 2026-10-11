import test from "node:test";
import assert from "node:assert/strict";
import { getNote, saveNote, findTask } from "../src/data/tasks.js";

// sequential subtests against the shared in-memory seed (task 1 starts with an empty note)
test("notes", async (t) => {

    await t.test("getNote unknown id", () => {
        assert.deepEqual(getNote(999), { ok: false });
    });

    await t.test("getNote seed task is empty v0", () => {
        const n = getNote(1);
        assert.equal(n.ok, true);
        assert.equal(n.note, "");
        assert.equal(n.version, 0);
        assert.equal(n.updatedAt, null);
    });

    await t.test("saveNote unknown id", () => {
        assert.deepEqual(saveNote(999, "x", 0), { ok: false });
    });

    await t.test("saveNote with matching base saves and bumps version", () => {
        const r = saveNote(1, "hello", 0);
        assert.equal(r.ok, true);
        assert.equal(r.note, "hello");
        assert.equal(r.version, 1);
        assert.ok(r.updatedAt);
        assert.equal(findTask(1).note, "hello");
    });

    await t.test("two saves in a row with the right bases both succeed", () => {
        const r = saveNote(1, "hello world", 1);
        assert.equal(r.ok, true);
        assert.equal(r.version, 2);
        assert.equal(r.note, "hello world");
        assert.equal(findTask(1).version, 2);
    });

    await t.test("stale base -> conflict, data unchanged", () => {
        // server moves on under this tab's feet (v0 -> v1)
        const first = saveNote(3, "theirs", 0);
        assert.equal(first.ok, true);

        const r = saveNote(3, "mine", 0); // this tab never saw v1
        assert.equal(r.ok, false);
        assert.equal(r.conflict, true);
        assert.equal(r.serverNote, "theirs");
        assert.equal(r.serverVersion, 1);
        assert.equal(r.updatedAt, first.updatedAt);
        // nothing was written
        assert.equal(findTask(3).note, "theirs");
        assert.equal(findTask(3).version, 1);
        assert.equal(findTask(3).updatedAt, first.updatedAt);
        // and the correct base still saves afterwards
        const ok = saveNote(3, "mine", 1);
        assert.equal(ok.ok, true);
        assert.equal(ok.version, 2);
        assert.equal(findTask(3).note, "mine");
    });

    await t.test("missing baseVersion is a conflict, not a save", () => {
        const task = findTask(4);
        const r = saveNote(4, "nope");
        assert.equal(r.ok, false);
        assert.equal(r.conflict, true);
        assert.equal(findTask(4).version, task.version);
        assert.equal(findTask(4).note, task.note);
    });

    await t.test("text capped at 10000 chars", () => {
        const r = saveNote(2, "x".repeat(10050), 0);
        assert.equal(r.ok, true);
        assert.equal(r.note.length, 10000);
    });

    await t.test("empty body treated as empty string", () => {
        const r = saveNote(2, undefined, 1);
        assert.equal(r.ok, true);
        assert.equal(r.note, "");
        assert.equal(r.version, 2); // bumped from the cap-save's 1
    });
});

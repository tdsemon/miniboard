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
        assert.deepEqual(saveNote(999, "x"), { ok: false });
    });

    await t.test("saveNote bumps version, sets updatedAt", () => {
        const r = saveNote(1, "hello");
        assert.equal(r.ok, true);
        assert.equal(r.note, "hello");
        assert.equal(r.version, 1);
        assert.ok(r.updatedAt);
        assert.equal(findTask(1).note, "hello");
    });

    await t.test("second save bumps again", () => {
        const r = saveNote(1, "hello world");
        assert.equal(r.version, 2);
        assert.equal(r.note, "hello world");
    });

    await t.test("text capped at 10000 chars", () => {
        const r = saveNote(2, "x".repeat(10050));
        assert.equal(r.ok, true);
        assert.equal(r.note.length, 10000);
    });

    await t.test("empty body treated as empty string", () => {
        const r = saveNote(2, undefined);
        assert.equal(r.ok, true);
        assert.equal(r.note, "");
        assert.equal(r.version, 2); // bumped from the cap-save's 1
    });
});

import "./helpers.js";
import test from "node:test";
import assert from "node:assert/strict";
import { moveTask, tasksInColumn, findTask } from "../src/data/tasks.js";

const ids = (key) => tasksInColumn(key).map((t) => t.id);
const contiguous = (key) => tasksInColumn(key).every((t, i) => t.order === i);

// sequential subtests against the shared in-memory seed: 1,3 planned / 2 progress / 4 done
test("move/reorder", async (t) => {

    await t.test("same column, move down", () => {
        const r = moveTask(1, "planned", 1);
        assert.equal(r.ok, true);
        assert.equal(r.fromColumn, "planned");
        assert.equal(r.toColumn, "planned");
        assert.deepEqual(ids("planned"), [3, 1]);
        assert.ok(contiguous("planned"));
    });

    await t.test("same column, move up", () => {
        assert.equal(moveTask(1, "planned", 0).ok, true);
        assert.deepEqual(ids("planned"), [1, 3]);
        assert.ok(contiguous("planned"));
    });

    await t.test("cross column at index", () => {
        const r = moveTask(3, "progress", 0);
        assert.equal(r.ok, true);
        assert.equal(r.fromColumn, "planned");
        assert.equal(r.toColumn, "progress");
        assert.deepEqual(ids("planned"), [1]);
        assert.deepEqual(ids("progress"), [3, 2]);
        assert.ok(contiguous("planned"));
        assert.ok(contiguous("progress"));
    });

    await t.test("index past end clamps to end", () => {
        assert.equal(moveTask(3, "progress", 99).ok, true);
        assert.deepEqual(ids("progress"), [2, 3]);
        assert.ok(contiguous("progress"));
    });

    await t.test("negative index clamps to start", () => {
        assert.equal(moveTask(3, "progress", -5).ok, true);
        assert.deepEqual(ids("progress"), [3, 2]);
        assert.ok(contiguous("progress"));
    });

    await t.test("unknown id rejected, state unchanged", () => {
        assert.deepEqual(moveTask(999, "done", 0), { ok: false, reason: "not-found" });
        assert.deepEqual(ids("done"), [4]);
        assert.deepEqual(ids("progress"), [3, 2]);
    });

    await t.test("bad column rejected, state unchanged", () => {
        assert.deepEqual(moveTask(4, "nonsense", 0), { ok: false, reason: "bad-column" });
        assert.deepEqual(ids("done"), [4]);
        assert.equal(findTask(4).status, "done");
    });
});

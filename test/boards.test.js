import "./helpers.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
    listBoards, findBoard, addBoard, renameBoard, removeBoard,
    getTask, findTask, addTask, moveTask, searchTasks, sortTasks,
} from "../src/data/tasks.js";

test("tasks stay on their board", async (t) => {

    await t.test("seed has three boards, tasks live on them", () => {
        assert.deepEqual(listBoards().map((b) => b.name), ["Designs", "Branding", "Email Template"]);
        assert.deepEqual(getTask(1).map((t) => t.id), [1, 2, 3, 4]);
        assert.deepEqual(getTask(2).map((t) => t.id), [5, 6]);
        assert.deepEqual(getTask(3).map((t) => t.id), [7, 8]);
    });

    await t.test("search is scoped to one board", () => {
        // "section" exists on board 1 (task 2) — nothing on board 3
        assert.deepEqual(searchTasks("section", 1).map((t) => t.id), [2]);
        assert.deepEqual(searchTasks("section", 3), []);
        assert.deepEqual(searchTasks("welcome", 3).map((t) => t.id), [7]);
        assert.deepEqual(searchTasks("welcome", 1), []);
    });

    await t.test("a move keeps the task on its board and never reorders another board", () => {
        const beforeOther = getTask(3).map((t) => t.id);
        const r = moveTask(1, "progress", 0);
        assert.equal(r.ok, true);
        assert.equal(findTask(1).boardId, 1);
        assert.deepEqual(getTask(1).filter((t) => t.status === "progress").map((t) => t.id), [1, 2]);
        assert.deepEqual(getTask(3).map((t) => t.id), beforeOther);
    });

    await t.test("sortTasks orders by the chosen key", () => {
        // state after the move above: planned=[3], progress=[1,2], done=[4]
        const list = getTask(1);
        const byTitle = sortTasks(list, "title", "asc").map((t) => t.title);
        assert.deepEqual(byTitle, [...byTitle].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
        assert.deepEqual(sortTasks(list, "title", "desc").map((t) => t.title), [...byTitle].reverse());
        // planned(0) < progress(1) < done(2)
        assert.deepEqual(sortTasks(list, "status", "asc").map((t) => t.status), ["planned", "progress", "progress", "done"]);
        // order = column rank then within-column order
        assert.deepEqual(sortTasks(list, "order", "asc").map((t) => t.id), [3, 1, 2, 4]);
        assert.deepEqual(sortTasks(list, "order", "desc").map((t) => t.id), [4, 2, 1, 3]);
        // unknown sort keys fall back to title rather than throwing
        assert.equal(sortTasks(list, "bogus").length, 4);
    });
});

test("boards", async (t) => {

    await t.test("add and rename a board", () => {
        const board = addBoard("Roadmap");
        assert.equal(findBoard(board.id)?.name, "Roadmap");
        assert.equal(renameBoard(board.id, "Sprint 12")?.name, "Sprint 12");
        assert.equal(renameBoard(9999, "nope"), null);
    });

    await t.test("removing a board removes its tasks and returns their ids", () => {
        addTask("Sticky note wall", "planned", 2);
        assert.equal(getTask(2).length, 3);
        const r = removeBoard(2);
        assert.equal(r.ok, true);
        assert.equal(r.board.name, "Branding");
        assert.deepEqual(r.removedTasks.map((t) => t.id).sort(), [5, 6, 9]);
        assert.deepEqual(getTask(2), []);
        assert.equal(findTask(5), undefined);
        // neighbours untouched
        assert.deepEqual(getTask(3).map((t) => t.id), [7, 8]);
    });

    await t.test("the last board cannot be removed", () => {
        const keep = listBoards().map((b) => b.id);
        for (const id of keep) removeBoard(id);
        assert.equal(listBoards().length, 1);
        const r = removeBoard(listBoards()[0].id);
        assert.equal(r.ok, false);
        assert.equal(r.reason, "last-board");
        assert.equal(listBoards().length, 1);
        assert.equal(removeBoard(9999).reason, "not-found");
    });
});

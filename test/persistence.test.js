import "./helpers.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const DATA_FILE = process.env.DATA_FILE;
const dir = path.dirname(DATA_FILE);

// each import is a fresh module instance: it re-reads DATA_FILE on load,
// which is exactly what "restart the server" does
const load = () => import(`../src/data/tasks.js?fresh=${Date.now()}-${Math.random()}`);
const reset = () => fs.rmSync(DATA_FILE, { force: true });

// sequential subtests, each starting from a clean slate
test("persistence", async (t) => {

    await t.test("save then reload round trip (notes and versions included)", async () => {
        reset();
        const a = await load();
        a.addBoard("Persisted board");
        const task = a.addTask("Persisted task", "planned", 1);
        a.moveTask(task.id, "progress", 0);
        a.saveNote(task.id, "first save", 0);
        a.saveNote(task.id, "second save", 1);
        a.flush();

        const b = await load();
        assert.deepEqual(b.listBoards().map((x) => x.name),
            ["Designs", "Branding", "Email Template", "Persisted board"]);
        const reloaded = b.findTask(task.id);
        assert.equal(reloaded.title, "Persisted task");
        assert.equal(reloaded.status, "progress");
        assert.equal(reloaded.note, "second save");
        assert.equal(reloaded.version, 2);
        assert.ok(reloaded.updatedAt);
    });

    await t.test("counters continue after reload (no id reuse)", async () => {
        reset();
        const a = await load();
        const task = a.addTask("first", "planned", 1);
        const board = a.addBoard("second board");
        a.flush();

        const b = await load();
        const nextTask = b.addTask("after reload", "planned", 1);
        const nextBoard = b.addBoard("third board");
        assert.equal(nextTask.id, task.id + 1);
        assert.equal(nextBoard.id, board.id + 1);
    });

    await t.test("board delete persists", async () => {
        reset();
        const a = await load();
        a.removeBoard(2);
        a.flush();

        const b = await load();
        assert.equal(b.findBoard(2), undefined);
        assert.deepEqual(b.listBoards().map((x) => x.name), ["Designs", "Email Template"]);
        assert.equal(b.findTask(5), undefined);
        assert.deepEqual(b.getTask(1).map((x) => x.id), [1, 2, 3, 4]);
    });

    await t.test("atomic write leaves no temp file behind", async () => {
        reset();
        const a = await load();
        a.addTask("temp check", "planned", 1);
        a.flush();
        assert.ok(fs.existsSync(DATA_FILE));
        assert.ok(!fs.existsSync(`${DATA_FILE}.tmp`));
        // and the file on disk is the whole snapshot, not a fragment
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        assert.ok(Array.isArray(parsed.boards) && parsed.boards.length > 0);
        assert.ok(Array.isArray(parsed.tasks));
        assert.ok(Number.isInteger(parsed.nextId) && Number.isInteger(parsed.nextBoardId));
    });

    await t.test("corrupt file falls back and keeps a .bak", async () => {
        reset();
        fs.writeFileSync(DATA_FILE, "{ this is not json");
        const warns = [];
        const original = console.warn;
        console.warn = (...args) => warns.push(args.join(" "));
        const m = await load();
        console.warn = original;

        assert.equal(warns.length, 1);
        assert.match(warns[0], /corrupt/);
        assert.deepEqual(m.listBoards().map((x) => x.name), ["Designs", "Branding", "Email Template"]);
        assert.equal(m.getTask(1).length, 4);
        const baks = fs.readdirSync(dir).filter((f) => f.startsWith("miniboard.json.bak-"));
        assert.equal(baks.length, 1);
        assert.equal(fs.readFileSync(path.join(dir, baks[0]), "utf8"), "{ this is not json");

        // the bad file was renamed away, so the next boot seeds fresh with no
        // second backup — and a wrong shape counts as corrupt too
        const again = await load();
        assert.deepEqual(again.listBoards().map((x) => x.name), ["Designs", "Branding", "Email Template"]);
        fs.writeFileSync(DATA_FILE, JSON.stringify({ boards: [], tasks: [], nextId: 1, nextBoardId: 1 }));
        const shaped = await load();
        assert.equal(shaped.listBoards().length, 3);
        assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith("miniboard.json.bak-")).length, 2);
    });

    await t.test("missing file seeds fresh", async () => {
        reset();
        const m = await load();
        assert.deepEqual(m.listBoards().map((x) => x.name), ["Designs", "Branding", "Email Template"]);
        assert.equal(m.getTask(1).length, 4);
        assert.equal(m.findTask(1).version, 0);
        assert.ok(!fs.existsSync(DATA_FILE)); // seeding alone writes nothing
    });
});

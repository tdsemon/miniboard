import test from "node:test";
import assert from "node:assert/strict";
import { draftForInput, draftAfterSave, decideDraftAction, clampCursor, snippet } from "../public/drafts.js";

// Rules 1-4 have pure halves here; rule 5 (inline prompt, restore focused) and
// the restore/discard clicks are DOM wiring in notes.js + notes-panel.ejs.
const draft = (text, baseVersion, savedAt = 1) => ({ text, baseVersion, savedAt });

test("draft contract", async (t) => {

    await t.test("rule 1: an input writes text, baseVersion and savedAt", () => {
        assert.deepEqual(draftForInput("hello", 3, 99), { text: "hello", baseVersion: 3, savedAt: 99 });
        assert.equal(draftForInput(null, null, 1).text, "");
        assert.equal(draftForInput("x", "7", 1).baseVersion, 7);
        assert.equal(draftForInput("x", "garbage", 1).baseVersion, 0);
    });

    await t.test("rule 2: saved text equals textarea text -> draft deleted", () => {
        assert.equal(draftAfterSave(draft("same", 1), "same", "same", 2), null);
        assert.equal(draftAfterSave(null, "a", "b", 2), null);
    });

    await t.test("rule 2: typed during the save -> draft kept on the new baseVersion", () => {
        assert.deepEqual(
            draftAfterSave(draft("typed more", 1), "saved", "typed more", 2),
            { text: "typed more", baseVersion: 2, savedAt: 1 }
        );
    });

    await t.test("rule 3: no draft, or draft already matches the server -> none", () => {
        assert.equal(decideDraftAction(null, "server", 4), "none");
        assert.equal(decideDraftAction(undefined, "server", 4), "none");
        assert.equal(decideDraftAction(draft("server", 1), "server", 4), "none");
        assert.equal(decideDraftAction({ baseVersion: 4, savedAt: 1 }, "server", 4), "none");
    });

    await t.test("rule 3: same baseVersion, different text -> restore prompt", () => {
        assert.equal(decideDraftAction(draft("mine", 4), "server", 4), "prompt-restore");
        // versions arrive from storage/server as numbers or strings
        assert.equal(decideDraftAction(draft("mine", "4"), "server", "4"), "prompt-restore");
    });

    await t.test("rule 3: baseVersion behind the server -> keep draft, notice only", () => {
        assert.equal(decideDraftAction(draft("mine", 3), "server", 4), "keep-with-notice");
        assert.equal(decideDraftAction(draft("mine", 0), "server", 4), "keep-with-notice");
    });

    await t.test("rule 3: baseVersion ahead of the server -> server reset prompt", () => {
        assert.equal(decideDraftAction(draft("mine", 9), "server", 4), "prompt-server-reset");
    });

    await t.test("rule 4: restore -> autosave sends the draft text -> draft gone", () => {
        const d = draft("local text", 4);
        assert.equal(decideDraftAction(d, "server", 4), "prompt-restore");
        // restore puts d.text in the textarea, so the save goes out with it...
        assert.equal(draftAfterSave(d, "local text", "local text", 5), null);
        // ...unless the user kept typing during that save
        assert.deepEqual(
            draftAfterSave({ ...d, text: "local text more" }, "local text", "local text more", 5),
            { text: "local text more", baseVersion: 5, savedAt: 1 }
        );
    });

    await t.test("rule 4: discard -> server text kept, next open is clean", () => {
        // discard is `delete drafts[id]`; with no draft the next open is "none"
        assert.equal(decideDraftAction(null, "server", 4), "none");
    });
});

test("clampCursor", () => {
    assert.equal(clampCursor(5, 10), 5);
    assert.equal(clampCursor(0, 10), 0);
    assert.equal(clampCursor(-3, 10), 0);
    assert.equal(clampCursor(99, 10), 10);
    assert.equal(clampCursor(4, 0), 0);
    assert.equal(clampCursor(4, undefined), 0);
    assert.equal(clampCursor("nope", 10), 0);
    assert.equal(clampCursor(undefined, 10), 0);
    assert.equal(clampCursor("7", "10"), 7);
});

test("snippet", () => {
    assert.equal(snippet("short"), "short");
    assert.equal(snippet("  padded \n lines "), "padded lines");
    const long = snippet("x".repeat(80));
    assert.equal(long.length, 60);
    assert.ok(long.endsWith("…"));
});

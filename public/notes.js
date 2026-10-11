// Alpine side of the notes drawer: status machine, flush-on-close, ticking
// labels, local drafts and resume state. Every HTTP request goes through htmx
// (attributes or htmx.ajax); this file only tracks truth from htmx events —
// never shows "saved" optimistically.
//
// DRAFT CONTRACT — the rules, and where each one lives:
//  1. on every input, write the draft immediately (no debounce; it's local).
//     baseVersion = the version the textarea was loaded / last saved with.
//     -> onInput() + draftForInput()            [test: rule 1]
//  2. on a confirmed server save where the saved text equals the current
//     textarea text, delete that task's draft. if the user typed more during the
//     save, keep the draft with the new baseVersion.
//     -> onAfterRequest() + draftAfterSave()    [test: rule 2]
//  3. on open of a task's note, compare draft to server (decideDraftAction):
//       - no draft, or draft.text === server note: nothing to do, drop the stale
//         draft.
//       - text differs and draft.baseVersion === server version: show the
//         restore prompt (restore / discard).
//       - draft.baseVersion < server version: the server moved on without this
//         tab's draft (another tab or session). do NOT prompt for restore —
//         raise the conflict bar (rule 6) with the draft as "mine" and the
//         server's copy already in the textarea.
//       - draft.baseVersion > server version (server restarted, in-memory data
//         reset): treat as restorable, prompt, and say "server was reset".
//     -> onPanelReady()                          [test: rule 3]
//  4. restore = put the draft text into the textarea, status goes dirty, normal
//     autosave takes over. discard = delete the draft, keep the server text.
//     -> restoreDraft() / discardDraft()
//  5. the prompt is a small inline bar inside the drawer above the textarea —
//     not a modal, not a confirm(). keyboard reachable, restore is the focused
//     default. -> notes-panel.ejs (.draft-bar)
//  6. conflict = we lost the version race, from either direction: a 409 on a
//     save, or an open whose draft is older than the server. status goes
//     "conflict" (one bar, two sources): autosave stops (textarea is readonly),
//     the draft is kept, and the bar offers
//       keep mine  -> version input := server version, status dirty, save-now.
//                     on an open-conflict the textarea still holds the server
//                     text, so the draft text is put in first.
//       take server-> GET /tasks/:id/notes/current (the 409 body can be stale
//                     by click time), textarea + version := server's, draft
//                     deleted, status saved.
//     closing/switching while in conflict never flushes (it would just 409
//     again); the draft and lastEdited survive for the continue banner, and
//     beforeunload still warns. -> onError() / enterConflict() / keepMine() /
//     takeServer()
// The textarea is readonly while the prompt is up: rules 1 and 2 would otherwise
// clobber the very draft the prompt is asking about.
import { decideDraftAction, draftAfterSave, draftForInput, clampCursor, snippet } from "./drafts.js";

// one key per concern, "miniboard:" prefixed. every read/write goes through
// safeStorage so a blocked or full localStorage degrades to no persistence
// instead of breaking the app.
const KEY_UI = "miniboard:ui";
const KEY_DRAFTS = "miniboard:drafts";

const safeStorage = {
    getItem(key) {
        try {
            const raw = localStorage.getItem(key);
            if (raw == null) return null;
            JSON.parse(raw); // corrupt JSON would otherwise throw inside Alpine
            return raw;
        } catch {
            return null;
        }
    },
    setItem(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch {}
    },
    removeItem(key) {
        try {
            localStorage.removeItem(key);
        } catch {}
    },
};

const writeKey = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {}
};

const mb = () => Alpine.store("mb");

// One re-render path for every board/view switch. The URL is built here (from
// the persisted store + the search box) because htmx's js: expressions can read
// the DOM but not Alpine stores — so Alpine calls this, htmx does the swap.
function refreshBoard() {
    const ui = mb()?.ui;
    if (!ui) return;
    const q = document.querySelector(".search")?.value ?? "";
    const params = new URLSearchParams({
        view: ui.view || "board",
        sort: ui.sort || "order",
        dir: ui.dir || "asc",
        q,
    });
    htmx.ajax("GET", `/boards/${ui.activeBoardId ?? 1}?${params}`, {
        target: "#board",
        swap: "innerHTML",
    });
}

// --- throttled ui capture (~300ms). values land in the store, Alpine's $persist
// effect does the actual write. ---
let uiTimer = null;
let pendingUi = null;

function queueUi(patch) {
    pendingUi = Object.assign(pendingUi || {}, patch);
    if (uiTimer) return;
    uiTimer = setTimeout(() => {
        uiTimer = null;
        writeUiPending();
    }, 300);
}

function writeUiPending() {
    const patch = pendingUi;
    pendingUi = null;
    const ui = mb()?.ui;
    if (!patch || !ui) return false;
    if ("start" in patch) {
        ui.cursorStart = patch.start;
        ui.cursorEnd = patch.end;
    }
    if ("scroll" in patch) ui.scrollTop = patch.scroll;
    return true;
}

function captureCursor() {
    const ta = document.querySelector(".notes-textarea");
    if (!ta) return;
    queueUi({
        start: clampCursor(ta.selectionStart, ta.value.length),
        end: clampCursor(ta.selectionEnd, ta.value.length),
    });
}

function captureScroll() {
    const ta = document.querySelector(".notes-textarea");
    if (!ta) return;
    queueUi({ scroll: ta.scrollTop });
}

// snapshot both keys right now (beforeunload can't wait for a scheduled effect)
function persistNow() {
    const store = mb();
    if (!store) return;
    writeKey(KEY_UI, store.ui);
    writeKey(KEY_DRAFTS, store.drafts);
}

const editorHasFocus = () => !!document.activeElement?.closest?.(".notes-panel");

// alpine:initializing (not alpine:init) so $persist from the persist plugin is
// already registered no matter where the script tags sit; Alpine dispatches
// both events back-to-back inside start(), before it walks the DOM.
document.addEventListener("alpine:initializing", () => {
    Alpine.store("notes", { openId: null, hasNotes: {}, tickNow: Date.now() });

    // persisted state: drafts (taskId -> {text, baseVersion, savedAt}) and the
    // resume/ui snapshot. $persist writes through safeStorage on every change.
    Alpine.store("mb", {
        ui: Alpine.$persist({
            openTaskId: null,
            cursorStart: 0,
            cursorEnd: 0,
            scrollTop: 0,
            focusedColumn: null,
            lastEdited: null, // { taskId, boardId, at, snippet } -> continue banner
            // board + view the user is looking at: persisted so a reload lands
            // on the same place, and read by every refreshBoard() call
            activeBoardId: 1,
            view: "board", // board | table | list
            sort: "order", // table view: title | status | note | order
            dir: "asc",
        })
            .as(KEY_UI)
            .using(safeStorage),
        drafts: Alpine.$persist({}).as(KEY_DRAFTS).using(safeStorage),
        refresh: refreshBoard,
    });

    // one app-wide ticker: the banner's "time since" reads $store.notes.tickNow
    setInterval(() => {
        const notes = Alpine.store("notes");
        if (notes) notes.tickNow = Date.now();
    }, 5000);

    // cursor + scroll: document-level so the panel markup stays clean
    document.addEventListener("selectionchange", () => {
        const el = document.activeElement;
        if (el?.classList?.contains("notes-textarea")) captureCursor();
    });
    document.addEventListener(
        "scroll",
        (e) => {
            if (e.target?.classList?.contains("notes-textarea")) captureScroll();
        },
        true // scroll does not bubble
    );

    // which column the user was working in (drawer wins on load, see onBoardSettle)
    document.addEventListener("focusin", (e) => {
        const col = e.target?.closest?.(".column");
        const ui = mb()?.ui;
        if (!col || !ui) return;
        const key = String(col.id || "").replace(/^column-/, "");
        if (key && ui.focusedColumn !== key) ui.focusedColumn = key;
    });

    // two tabs: a draft/ui change elsewhere must not clobber an open editor.
    // the tab with the drawer open + focused ignores ui; tabs with the drawer
    // open ignore drafts. everyone else just updates the banner.
    window.addEventListener("storage", (e) => {
        if (e.key !== KEY_UI && e.key !== KEY_DRAFTS) return;
        let incoming;
        try {
            incoming = JSON.parse(e.newValue ?? "null");
        } catch {
            return;
        }
        if (!incoming || typeof incoming !== "object") return;
        const store = mb();
        if (!store) return;
        const prop = e.key === KEY_UI ? "ui" : "drafts";
        try {
            if (JSON.stringify(store[prop]) === JSON.stringify(incoming)) return; // already ours: no ping-pong
        } catch {
            return;
        }
        const drawerOpen = Alpine.store("notes")?.openId != null;
        if (prop === "drafts" ? drawerOpen : drawerOpen && editorHasFocus()) return;
        if (prop === "ui") {
            const board = store.ui.activeBoardId;
            const view = store.ui.view;
            store.ui = incoming;
            // another tab switched boards or views: keep this tab's screen honest
            if (incoming.activeBoardId !== board || incoming.view !== view) refreshBoard();
            return;
        }
        store[prop] = incoming;
    });

    // deleting a task drops its draft and anything pointing at it; deleting a
    // board drops the drafts of the tasks the server removed with it (the
    // route echoes their ids) and lands on a board that still exists
    document.addEventListener("htmx:after-request", (e) => {
        const path = e.detail?.elt?.getAttribute?.("hx-delete");
        if (!path || !e.detail.successful) return;
        const store = mb();
        if (!store) return;

        const taskId = Number(path.match(/\/tasks\/(\d+)/)?.[1]);
        if (Number.isFinite(taskId)) {
            if (store.drafts[taskId]) delete store.drafts[taskId];
            if (Number(store.ui.openTaskId) === taskId) store.ui.openTaskId = null;
            if (Number(store.ui.lastEdited?.taskId) === taskId) store.ui.lastEdited = null;
            return;
        }

        const boardId = Number(path.match(/\/boards\/(\d+)/)?.[1]);
        if (!Number.isFinite(boardId)) return;
        const responseText = e.detail.xhr?.responseText ?? "";
        const gone = new Set(
            (responseText.match(/data-removed-task-ids="([^"]*)"/)?.[1] ?? "").split(",").map(Number)
        );
        for (const key of Object.keys(store.drafts)) {
            if (gone.has(Number(key))) delete store.drafts[key];
        }
        if (gone.has(Number(store.ui.openTaskId))) store.ui.openTaskId = null;
        if (gone.has(Number(store.ui.lastEdited?.taskId))) store.ui.lastEdited = null;
        if (Number(store.ui.activeBoardId) === boardId) {
            const next = Number(
                new DOMParser().parseFromString(responseText, "text/html")
                    .querySelector("[data-board-id]")?.dataset.boardId
            );
            if (Number.isFinite(next)) {
                store.ui.activeBoardId = next;
                refreshBoard();
            }
        }
    });

    Alpine.data("notesDrawer", () => ({
        open: false,
        openId: null,
        lastFocusId: null,
        status: "idle", // idle | editing | dirty | saving | saved | error | conflict
        seq: 0,         // bumps on every keystroke
        sentSeq: -1,    // seq captured when a request went out (stale-response guard)
        sentText: "",   // text captured when a request went out (rule 2)
        savedAt: null,
        tickNow: Date.now(),
        timer: null,

        // draft + resume
        baseVersion: 0,      // version the textarea was loaded / last saved with
        prompt: null,        // null | "prompt-restore" | "prompt-server-reset"
        conflict: null,      // rule 6: { version, updatedAt, text, source }
        showServer: false,   // "show server text" toggle on the conflict bar
        panelSeq: 0,         // bumped per open, so each panel load settles once
        settledSeq: -1,
        resume: false,       // this open should restore cursor/scroll/focus
        resumeAfterPrompt: false, // ...once the user picks restore/discard
        resumeTried: false,  // page-load resume already ran

        get savedLabel() {
            if (!this.savedAt) return "saved";
            const s = Math.max(0, Math.round((this.tickNow - this.savedAt) / 1000));
            return s < 5 ? "saved just now" : `saved ${s}s ago`;
        },
        get conflictLabel() {
            const c = this.conflict;
            if (!c) return "";
            return `server v${c.version}${this.conflictWhen}`;
        },
        get conflictWhen() {
            const at = Date.parse(this.conflict?.updatedAt ?? "");
            if (!Number.isFinite(at)) return "";
            const s = Math.max(0, Math.round((this.$store.notes.tickNow - at) / 1000));
            if (s < 60) return `, ${s}s ago`;
            const m = Math.floor(s / 60);
            if (m < 60) return `, ${m}m ago`;
            return `, ${Math.floor(m / 60)}h ago`;
        },
        hasUnsaved() {
            return ["dirty", "saving", "error", "conflict"].includes(this.status);
        },
        // conflict never flushes: the server would just 409 again (rule 6)
        canFlush() {
            return this.hasUnsaved() && this.status !== "conflict";
        },
        isNoteRequest(elt) {
            return !!elt?.closest?.(".notes-form");
        },

        // opening another card while dirty: flush the current note first
        onOpen(id, resume = false) {
            this.resume = !!resume;
            if (this.open && this.openId !== id && this.canFlush()) {
                this.flush().then((ok) => {
                    if (ok) this.finishOpen(id);
                    else this.resume = false;
                });
                return;
            }
            this.finishOpen(id);
        },
        finishOpen(id) {
            this.openId = id;
            this.lastFocusId = id;
            this.status = "idle";
            this.seq = 0;
            this.sentSeq = -1;
            this.sentText = "";
            this.savedAt = null;
            this.baseVersion = 0;
            this.prompt = null;
            this.conflict = null;
            this.showServer = false;
            this.panelSeq++;
            this.stopTick();
            this.open = true;
            Alpine.store("notes").openId = id;
            mb().ui.openTaskId = id;
            htmx.ajax("GET", `/tasks/${id}/notes`, { target: "#notes-drawer", swap: "innerHTML" });
        },

        async closeIt() {
            if (this.canFlush()) {
                const ok = await this.flush();
                if (!ok) return; // stay open, status === "error", retry available
            }
            this.forceClose();
        },
        forceClose() {
            this.open = false;
            this.openId = null;
            this.status = "idle";
            this.prompt = null;
            this.conflict = null;
            this.showServer = false;
            this.resume = false;
            this.resumeAfterPrompt = false;
            writeUiPending();
            mb().ui.openTaskId = null;
            this.stopTick();
            Alpine.store("notes").openId = null;
            this.$nextTick(() => document.getElementById("notes-btn-" + this.lastFocusId)?.focus());
        },

        // one last save with the CURRENT textarea/version; resolves false on any failure
        flush() {
            const ta = document.querySelector(".notes-textarea");
            const version = document.getElementById("note-version");
            if (!ta) return Promise.resolve(true); // no panel, nothing to lose
            this.status = "saving";
            this.sentSeq = this.seq;
            return htmx
                .ajax("POST", ta.getAttribute("hx-post"), {
                    source: ta,
                    target: "#note-status-swap",
                    swap: "innerHTML",
                    values: { note: ta.value, version: version?.value ?? "0" },
                })
                .then(() => this.status !== "error")
                .catch(() => { this.status = "error"; return false; });
        },

        retry() {
            const form = document.querySelector(".notes-form");
            if (form) htmx.trigger(form, "save-now");
        },

        // rule 1: every keystroke writes the draft straight away
        onInput() {
            const firstDirtyAfterSave = this.savedAt !== null && ["saved", "editing"].includes(this.status);
            this.seq++;
            if (this.status !== "saving") this.status = "dirty";

            const ta = document.querySelector(".notes-textarea");
            if (ta && this.openId != null) mb().drafts[this.openId] = draftForInput(ta.value, this.baseVersion);
            if (firstDirtyAfterSave) this.markEdited(ta ? ta.value : "");
        },
        onFocus() {
            if (this.status === "idle" || this.status === "saved") this.status = "editing";
        },
        markEdited(text) {
            if (this.openId == null) return;
            // the drawer only ever opens from the board being viewed (cards, rows,
            // or a banner reopen that switched boards first), so the task's board
            // is the active one — the banner uses it to jump back across boards
            mb().ui.lastEdited = {
                taskId: this.openId,
                boardId: mb().ui.activeBoardId,
                at: Date.now(),
                snippet: snippet(text),
            };
        },

        // one htmx event per panel swap: apply draft rules, then (if this open is
        // a resume) put the cursor and scroll back.
        onAfterSettle(e) {
            const target = e.detail?.target;
            if (!target) return;
            if (target.id === "board") {
                this.onBoardSettle();
                return;
            }
            if (target.id !== "notes-drawer") return;
            if (this.settledSeq === this.panelSeq) return; // same swap, settled twice
            const ta = document.querySelector(".notes-textarea");
            if (!ta || ta.id !== "note-" + this.openId) return; // stale response
            this.settledSeq = this.panelSeq;
            this.onPanelReady();
        },

        // first board paint: reopen the note we were in, or put focus back in a
        // column. every view marks its rows with data-task-id (card, table, list)
        // so the resume works no matter which view is persisted
        onBoardSettle() {
            if (this.resumeTried) return;
            this.resumeTried = true;
            const ui = mb().ui;
            const id = ui.openTaskId;
            if (id != null && document.querySelector(`[data-task-id="${id}"]`)) {
                this.onOpen(Number(id), true);
                return;
            }
            if (id != null) ui.openTaskId = null; // task deleted while we were away
            this.restoreColumnFocus();
        },
        restoreColumnFocus() {
            const key = mb().ui.focusedColumn;
            if (!key) return;
            const col = document.getElementById("column-" + key);
            if (!col) return;
            (col.querySelector(".card") || col).focus({ preventScroll: true });
        },

        onPanelReady() {
            const ta = document.querySelector(".notes-textarea");
            if (!ta) return;

            const serverNote = ta.value;
            const serverVersion = Number(document.getElementById("note-version")?.value ?? 0);
            this.baseVersion = serverVersion;
            this.prompt = null;

            // rule 3
            const drafts = mb().drafts;
            const draft = drafts[this.openId];
            const action = decideDraftAction(draft, serverNote, serverVersion);
            if (action === "none") {
                if (draft) delete drafts[this.openId];
            } else if (action === "keep-with-notice") {
                // rule 6, open-source: textarea keeps the server text, the draft
                // is "mine" and only comes back in if the user keeps it
                this.enterConflict({
                    version: serverVersion,
                    updatedAt: document.getElementById("note-version")?.dataset.updatedAt ?? "",
                    text: serverNote,
                    source: "draft",
                });
            } else {
                this.prompt = action;
            }

            if (this.resume) {
                this.resume = false;
                if (this.prompt) this.resumeAfterPrompt = true; // offsets mean more after restore
                else this.applyResume();
            }
            if (this.prompt) this.$nextTick(() => document.querySelector(".draft-restore")?.focus());
        },

        // rule 4
        restoreDraft() {
            const ta = document.querySelector(".notes-textarea");
            const draft = mb().drafts[this.openId];
            if (!ta || !draft) {
                this.prompt = null;
                this.afterPrompt();
                return;
            }
            this.baseVersion = Number(document.getElementById("note-version")?.value ?? 0);
            ta.value = draft.text;
            draft.baseVersion = this.baseVersion; // textarea now carries the server version
            this.prompt = null;
            ta.dispatchEvent(new Event("input", { bubbles: true })); // dirty + autosave take over
            this.afterPrompt();
        },
        discardDraft() {
            const drafts = mb().drafts;
            if (drafts[this.openId]) delete drafts[this.openId]; // server text stays as it is
            this.prompt = null;
            this.afterPrompt();
        },
        afterPrompt() {
            if (this.resumeAfterPrompt) {
                this.resumeAfterPrompt = false;
                this.applyResume();
                return;
            }
            document.querySelector(".notes-textarea")?.focus();
        },

        // rule 6 — one entry point for both sources. `text` is the server's copy
        // as of the conflict; `source` says whether the textarea already holds
        // mine ("save") or still holds the server text ("draft": keep mine pulls
        // the draft in first).
        enterConflict({ version, updatedAt, text, source }) {
            this.prompt = null;
            this.conflict = {
                version: Number(version) || 0,
                updatedAt: updatedAt ?? "",
                text: String(text ?? ""),
                source,
            };
            this.status = "conflict"; // readonly textarea, no autosave, no flush
            this.stopTick();
            // nextTick flushes Alpine's reactivity (x-if mounts the bar), the
            // frame after that guarantees it is laid out before we focus it
            this.$nextTick(() => requestAnimationFrame(() =>
                document.querySelector(".conflict-keep")?.focus()
            ));
        },
        // "keep mine": my text goes out against the server's current version, so
        // the next save wins instead of 409ing on the stale one again.
        keepMine() {
            const ta = document.querySelector(".notes-textarea");
            const versionEl = document.getElementById("note-version");
            const conflict = this.conflict;
            if (!ta || !versionEl || !conflict) return;
            const draft = mb().drafts[this.openId];
            // open-conflict: textarea still holds the server text, mine is the draft
            if (conflict.source === "draft" && draft) ta.value = draft.text;
            versionEl.value = String(conflict.version);
            this.baseVersion = conflict.version;
            this.conflict = null;
            this.showServer = false;
            // input = rule 1 writes the draft + status dirty; save-now = the
            // request that actually overwrites the server
            ta.dispatchEvent(new Event("input", { bubbles: true }));
            const form = document.querySelector(".notes-form");
            if (form) htmx.trigger(form, "save-now");
        },
        // "take server": re-fetch (the 409 body can be stale by click time),
        // then adopt the server's copy wholesale.
        takeServer() {
            const id = this.openId;
            htmx.ajax("GET", `/tasks/${id}/notes/current`, { target: "#note-current-swap", swap: "innerHTML" })
                .then(() => {
                    const el = document.getElementById("note-current");
                    const ta = document.querySelector(".notes-textarea");
                    const versionEl = document.getElementById("note-version");
                    if (!el || !ta || !versionEl || this.openId !== id) return;
                    const version = Number(el.dataset.version) || 0;
                    ta.value = el.textContent;
                    versionEl.value = String(version);
                    this.baseVersion = version;
                    const drafts = mb().drafts;
                    if (drafts[id]) delete drafts[id];
                    this.conflict = null;
                    this.showServer = false;
                    this.status = "saved";
                    this.savedAt = Date.now();
                    this.tickNow = this.savedAt;
                    this.startTick();
                    this.syncHasNote();
                    this.markEdited(ta.value);
                    ta.focus();
                })
                .catch(() => {}); // still in conflict: the bar stays, retryable
        },

        // cursor + scroll, only ever called after the panel has settled and Alpine
        // has initialised it (x-cloak/x-show are off by the time nextTick runs)
        applyResume() {
            this.$nextTick(() => {
                const ta = document.querySelector(".notes-textarea");
                if (!ta) return;
                const ui = mb().ui;
                const len = ta.value.length;
                ta.setSelectionRange(clampCursor(ui.cursorStart, len), clampCursor(ui.cursorEnd, len));
                ta.focus();
                ta.scrollTop = ui.scrollTop; // last: focus() can scroll the control
            });
        },

        onBeforeRequest(e) {
            if (!this.isNoteRequest(e.detail?.elt)) return;
            this.status = "saving";
            this.sentSeq = this.seq;
            const ta = document.querySelector(".notes-textarea");
            this.sentText = ta ? ta.value : "";
        },
        onAfterRequest(e) {
            if (!this.isNoteRequest(e.detail?.elt)) return;
            if (!e.detail.successful) {
                // responseError fires first: a 409 already moved us to "conflict"
                if (this.status !== "conflict") { this.status = "error"; this.stopTick(); }
                return;
            }

            const ta = document.querySelector(".notes-textarea");
            const savedVersion = Number(document.getElementById("note-version")?.value ?? this.baseVersion);
            this.baseVersion = savedVersion;

            // rule 2
            const drafts = mb().drafts;
            if (ta) {
                const next = draftAfterSave(drafts[this.openId], this.sentText, ta.value, savedVersion);
                if (next) drafts[this.openId] = next;
                else if (drafts[this.openId]) delete drafts[this.openId];
            }

            // user typed after this request went out: newer text is not saved yet
            if (this.seq !== this.sentSeq) { this.status = "dirty"; return; }
            this.status = "saved";
            this.savedAt = Date.now();
            this.tickNow = this.savedAt;
            this.startTick();
            this.syncHasNote();
            this.markEdited(ta ? ta.value : ""); // lastEdited on every successful save
        },
        onError(e) {
            if (e?.detail?.elt && !this.isNoteRequest(e.detail.elt)) return;
            // 409 = we lost the version race. htmx never swaps error responses,
            // so pull the server's copy out of the body and raise the bar.
            if (e.detail?.xhr?.status === 409) {
                const doc = new DOMParser().parseFromString(e.detail.xhr.responseText ?? "", "text/html");
                const el = doc.getElementById("note-conflict");
                this.enterConflict({
                    version: el?.dataset.version,
                    updatedAt: el?.dataset.updatedAt,
                    text: el?.textContent,
                    source: "save",
                });
                return;
            }
            this.status = "error";
            this.stopTick();
        },
        syncHasNote() {
            const ta = document.querySelector(".notes-textarea");
            if (ta && this.openId != null) Alpine.store("notes").hasNotes[this.openId] = ta.value.length > 0;
        },
        startTick() {
            this.stopTick();
            this.timer = setInterval(() => { this.tickNow = Date.now(); }, 3000);
        },
        stopTick() {
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
        },
        onBeforeUnload(e) {
            const hadPendingUi = uiTimer !== null;
            writeUiPending();
            if (hadPendingUi || this.hasUnsaved()) persistNow();
            if (this.hasUnsaved()) { e.preventDefault(); e.returnValue = ""; }
        },
    }));

    // continue banner — lives inside #board so htmx swaps recreate it, but every
    // value comes from the persisted store, never from server HTML. titles are
    // read from the card in the DOM and rendered with x-text only.
    Alpine.data("continueBanner", () => ({
        get lastEdited() { return this.$store.mb.ui.lastEdited; },
        get title() {
            const le = this.lastEdited;
            if (!le) return "";
            // the task's title only exists in the DOM of the board that renders
            // it; rows in every view carry data-task-id + .card-title
            const host = document.querySelector(`[data-task-id="${le.taskId}"]`);
            return host?.querySelector(".card-title")?.textContent ?? "";
        },
        get text() {
            const le = this.lastEdited;
            if (!le) return "";
            return snippet(this.$store.mb.drafts[le.taskId]?.text ?? le.snippet ?? "");
        },
        get when() {
            const le = this.lastEdited;
            if (!le) return "";
            const s = Math.max(0, Math.round((this.$store.notes.tickNow - (le.at ?? 0)) / 1000));
            if (s < 60) return `${s}s ago`;
            const m = Math.floor(s / 60);
            if (m < 60) return `${m}m ago`;
            return `${Math.floor(m / 60)}h ago`;
        },
        get visible() { return !!this.lastEdited && !!this.title && !this.$store.notes.openId; },
        reopen() {
            const le = this.lastEdited;
            if (le?.taskId == null) return;
            // the note may live on another board: switch first so its card/row
            // is on screen when the drawer opens
            if (le.boardId != null && this.$store.mb.ui.activeBoardId !== le.boardId) {
                this.$store.mb.ui.activeBoardId = le.boardId;
                this.$store.mb.refresh();
            }
            this.$dispatch("notes-open", { id: Number(le.taskId), resume: true });
        },
        dismiss() { this.$store.mb.ui.lastEdited = null; },
    }));
});

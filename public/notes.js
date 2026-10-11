// Alpine side of the notes drawer: status machine, flush-on-close, ticking
// labels. Every HTTP request goes through htmx (attributes or htmx.ajax);
// this file only tracks truth from htmx events — never shows "saved" optimistically.
document.addEventListener("alpine:init", () => {
    Alpine.store("notes", { openId: null, hasNotes: {} });

    Alpine.data("notesDrawer", () => ({
        open: false,
        openId: null,
        lastFocusId: null,
        status: "idle", // idle | editing | dirty | saving | saved | error
        seq: 0,         // bumps on every keystroke
        sentSeq: -1,    // seq captured when a request went out (stale-response guard)
        savedAt: null,
        tickNow: Date.now(),
        timer: null,

        get savedLabel() {
            if (!this.savedAt) return "saved";
            const s = Math.max(0, Math.round((this.tickNow - this.savedAt) / 1000));
            return s < 5 ? "saved just now" : `saved ${s}s ago`;
        },
        hasUnsaved() {
            return ["dirty", "saving", "error"].includes(this.status);
        },
        isNoteRequest(elt) {
            return !!elt?.closest?.(".notes-form");
        },

        // opening another card while dirty: flush the current note first
        onOpen(id) {
            if (this.open && this.openId !== id && this.hasUnsaved()) {
                this.flush().then((ok) => { if (ok) this.finishOpen(id); });
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
            this.savedAt = null;
            this.stopTick();
            this.open = true;
            Alpine.store("notes").openId = id;
            htmx.ajax("GET", `/tasks/${id}/notes`, { target: "#notes-drawer", swap: "innerHTML" });
        },

        async closeIt() {
            if (this.hasUnsaved()) {
                const ok = await this.flush();
                if (!ok) return; // stay open, status === "error", retry available
            }
            this.forceClose();
        },
        forceClose() {
            this.open = false;
            this.openId = null;
            this.status = "idle";
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

        onInput() {
            this.seq++;
            if (this.status !== "saving") this.status = "dirty";
        },
        onFocus() {
            if (this.status === "idle" || this.status === "saved") this.status = "editing";
        },

        onBeforeRequest(e) {
            if (!this.isNoteRequest(e.detail?.elt)) return;
            this.status = "saving";
            this.sentSeq = this.seq;
        },
        onAfterRequest(e) {
            if (!this.isNoteRequest(e.detail?.elt)) return;
            if (!e.detail.successful) { this.status = "error"; this.stopTick(); return; }
            // user typed after this request went out: newer text is not saved yet
            if (this.seq !== this.sentSeq) { this.status = "dirty"; return; }
            this.status = "saved";
            this.savedAt = Date.now();
            this.tickNow = this.savedAt;
            this.startTick();
            this.syncHasNote();
        },
        onError(e) {
            if (e?.detail?.elt && !this.isNoteRequest(e.detail.elt)) return;
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
            if (this.hasUnsaved()) { e.preventDefault(); e.returnValue = ""; }
        },
    }));
});

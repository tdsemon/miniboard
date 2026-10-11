// Pure draft/resume logic: no DOM, no storage, no Alpine — node:test imports
// this file directly. The rules themselves live as comments in notes.js.

// Rule 1: shape of a draft written on every input.
export function draftForInput(text, baseVersion, now = Date.now()) {
    return {
        text: String(text ?? ""),
        baseVersion: Number(baseVersion) || 0,
        savedAt: now,
    };
}

// Rule 2: what survives a confirmed save. savedText is what the server now has,
// textareaText is what the user is looking at (may have moved on during the save).
export function draftAfterSave(draft, savedText, textareaText, savedVersion) {
    if (!draft) return null;
    if (savedText === textareaText) return null; // caught up: no draft needed
    return { ...draft, baseVersion: Number(savedVersion) || 0 };
}

// Rule 3: what a stored draft means for a note panel that just loaded.
//   "none"                -> no draft, or draft already matches the server
//   "prompt-restore"      -> same version, local text differs
//   "keep-with-notice"    -> server moved on (other tab/session), keep, don't ask
//   "prompt-server-reset" -> draft is newer than the server (memory was reset)
export function decideDraftAction(draft, serverNote, serverVersion) {
    if (!draft || typeof draft.text !== "string") return "none";
    if (draft.text === serverNote) return "none";

    const base = Number(draft.baseVersion);
    const server = Number(serverVersion);
    if (!Number.isFinite(base)) return "none";
    if (base === server) return "prompt-restore";
    if (base < server) return "keep-with-notice";
    return "prompt-server-reset";
}

// Cursor offsets come out of storage; text length comes from the textarea.
export function clampCursor(pos, len) {
    const at = Number(pos);
    const max = Number(len);
    const hi = Number.isFinite(max) && max > 0 ? Math.round(max) : 0;
    if (!Number.isFinite(at)) return 0;
    return Math.min(Math.max(Math.round(at), 0), hi);
}

// One line, ~60 chars, for the continue banner.
export function snippet(text, max = 60) {
    const flat = String(text ?? "").replace(/\s+/g, " ").trim();
    if (flat.length <= max) return flat;
    return flat.slice(0, max - 1) + "…";
}

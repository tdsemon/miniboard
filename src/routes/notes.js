import { Router } from "express";
import { findTask, getNote, saveNote } from "../data/tasks.js";

const router = Router();

router.get("/tasks/:id/notes", (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return res.status(404).send("");
    res.render("partials/notes-panel", { task, note: getNote(task.id) });
});

// the server's current note, for "take server" (and cheap to re-fetch rather
// than trusting the 409 body, which can be a version behind by click time)
router.get("/tasks/:id/notes/current", (req, res) => {
    const note = getNote(req.params.id);
    if (!note.ok) return res.status(404).send("");
    res.render("partials/note-current", note);
});

router.post("/tasks/:id/notes", (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return res.status(404).send("");
    // the version the textarea was loaded with; a drag/typing race can send
    // nothing at all, and that is a bad request rather than a conflict
    const raw = req.body?.version;
    if (raw === undefined || raw === "" || !Number.isInteger(Number(raw))) {
        return res.status(400).send("");
    }
    const saved = saveNote(task.id, req.body?.note, Number(raw));
    if (saved.conflict) {
        return res.status(409).render("partials/note-conflict", {
            version: saved.serverVersion,
            updatedAt: saved.updatedAt,
            note: saved.serverNote,
        });
    }
    if (!saved.ok) return res.status(404).send("");
    res.render("partials/note-status", { version: saved.version });
});

export default router;

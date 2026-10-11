import { Router } from "express";
import { findTask, getNote, saveNote } from "../data/tasks.js";

const router = Router();

router.get("/tasks/:id/notes", (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return res.status(404).send("");
    res.render("partials/notes-panel", { task, note: getNote(task.id) });
});

router.post("/tasks/:id/notes", (req, res) => {
    const saved = saveNote(req.params.id, req.body?.note);
    if (!saved.ok) return res.status(404).send("");
    const task = findTask(req.params.id);
    res.render("partials/note-status", { ...saved, title: task.title });
});

export default router;

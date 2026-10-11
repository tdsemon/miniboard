import { Router } from "express";
import { addTask, columns, findBoard } from "../data/tasks.js";

const router = Router();
const valid = new Set(columns.map((c) => c.key));

router.post("/tasks", (req, res) => {
    const { title, status } = req.body;
    const boardId = findBoard(req.body.boardId ?? 1)?.id ?? 1;
    const task = addTask(title, valid.has(status) ? status : "planned", boardId);
    res.render("partials/card", { task, columns });
});

export default router;

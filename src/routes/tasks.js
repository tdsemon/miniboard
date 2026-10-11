import { Router } from "express";
import { addTask, columns } from "../data/tasks.js";

const router = Router();
const valid = new Set(columns.map((c) => c.key));

router.post("/tasks", (req, res) => {
    const { title, status } = req.body;
    const task = addTask(title, valid.has(status) ? status : "planned");
    res.render("partials/card", { task, columns });
});

export default router;
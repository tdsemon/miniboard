import { Router } from "express";
import { findTask, columns, getTask, removeTask, searchTasks } from "../data/tasks.js";
import { get } from "node:https";

const router = Router();

const NEXT = {
    planned: "progress",
    progress: "done",
    done: "done"

}

router.get("/board", (req, res) => {
    res.render("partials/board.ejs",{
        tasks: getTask(),
        columns
    })
})

router.get("/search", (req,res) => {
    const results = searchTasks(req.query.q || "");
    res.render("partials/board", { tasks: results, columns })
})


router.delete("/tasks/:id", (req,res) => {
    removeTask(req.params.id);
    res.send("");
})

router.post("/tasks/:id/move", (req,res) => {
     const task = findTask(req.params.id);
     if (task) task.status = NEXT[task.status]
     res.render("partials/board", { tasks: getTask(), columns })
})

export default router; 
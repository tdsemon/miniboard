import { Router } from "express";
import { findTask, columns, getTask, removeTask, searchTasks, moveTask, tasksInColumn } from "../data/tasks.js";

const router = Router();

const NEXT = {
    planned: "progress",
    progress: "done",
    done: "done"

}

const renderColumn = (res, key, oob = false) =>
    new Promise((resolve, reject) => {
        res.render("partials/column", {
            col: columns.find((c) => c.key === key),
            tasks: getTask(),
            columns,
            oob
        }, (err, html) => (err ? reject(err) : resolve(html)));
    });

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


router.delete("/tasks/:id", async (req,res) => {
    const task = findTask(req.params.id);
    if (!task) return res.status(404).send("");
    const key = task.status;
    removeTask(req.params.id);
    res.send(await renderColumn(res, key));
})

router.post("/tasks/:id/move", async (req,res) => {
    const { toColumn, toIndex: rawIndex } = req.body ?? {};
    if (req.body?.forceFail) return res.status(500).send(""); // temporary: ?fail=1 failure injection (test scaffolding, remove in step 8)
    let column = toColumn;
    let index;
    if (column === undefined) {
        const task = findTask(req.params.id);
        if (!task) return res.status(404).send("");
        column = NEXT[task.status];
        index = tasksInColumn(column).length;
    } else {
        index = Number(rawIndex);
        if (!Number.isInteger(index)) return res.status(400).send("");
    }

    const result = moveTask(req.params.id, column, index);
    if (!result.ok) return res.status(result.reason === "not-found" ? 404 : 400).send("");

    let out = "";
    if (result.fromColumn !== result.toColumn) out += await renderColumn(res, result.fromColumn, true);
    out += await renderColumn(res, result.toColumn);
    res.send(out);
})

export default router;

import { Router } from "express";
import { findTask, columns, getTask, removeTask, searchTasks, moveTask, tasksInColumn } from "../data/tasks.js";

const router = Router();

const renderPartial = (res, name, data) =>
    new Promise((resolve, reject) => {
        res.render(name, data, (err, html) => (err ? reject(err) : resolve(html)));
    });

const renderColumn = (res, key, oob = false) =>
    renderPartial(res, "partials/column", {
        col: columns.find((c) => c.key === key),
        tasks: getTask(),
        columns,
        oob
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
    // drag (dnd.js), the keyboard select and alt+arrow all send toColumn; a
    // body without one has no caller, so treat it as a bad request rather
    // than inventing a destination.
    if (toColumn === undefined) return res.status(400).send("");
    const index = rawIndex === undefined ? tasksInColumn(toColumn).length : Number(rawIndex);
    if (!Number.isInteger(index)) return res.status(400).send("");

    const result = moveTask(req.params.id, toColumn, index);
    if (!result.ok) return res.status(result.reason === "not-found" ? 404 : 400).send("");

    // contract: primary fragment = the column the card came FROM (clients always
    // target it), OOB = the column it went TO. One shape serves drag, the
    // keyboard select and alt+arrow reorder alike.
    let out = await renderColumn(res, result.fromColumn);
    if (result.fromColumn !== result.toColumn) out += await renderColumn(res, result.toColumn, true);
    const within = result.fromColumn === result.toColumn;
    out += await renderPartial(res, "partials/announce", {
        title: result.task.title,
        label: columns.find((c) => c.key === result.toColumn).label,
        // within-column moves announce the slot, which is what alt+arrow moved
        ...(within ? { position: result.task.order + 1, total: tasksInColumn(result.toColumn).length } : {}),
    });
    res.send(out);
})

export default router;

import { Router } from "express";
import { findTask, columns, getTask, removeTask, moveTask, tasksInColumn } from "../data/tasks.js";
import { renderBoardView } from "./boards.js";

const router = Router();

const renderPartial = (res, name, data) =>
    new Promise((resolve, reject) => {
        res.render(name, data, (err, html) => (err ? reject(err) : resolve(html)));
    });

const renderColumn = (res, task, key, oob = false) =>
    renderPartial(res, "partials/column", {
        col: columns.find((c) => c.key === key),
        tasks: getTask(task.boardId),
        columns,
        boardId: task.boardId,
        oob
    });

// A request that came from the Table or List view carries its view in the
// body; the answer is that view re-rendered, so one move/delete path serves
// every view without the client needing a second endpoint.
const wantsView = (body) => (body?.view === "table" || body?.view === "list" ? body.view : null);

router.delete("/tasks/:id", async (req, res) => {
    const task = findTask(req.params.id);
    if (!task) return res.status(404).send("");
    const view = wantsView(req.body);
    const boardId = task.boardId;
    const key = task.status;
    removeTask(req.params.id);
    if (view) {
        const html = await renderBoardView(res, boardId, {
            view,
            q: req.body.q ?? "",
            sort: req.body.sort,
            dir: req.body.dir,
        });
        return res.send(html);
    }
    res.send(await renderColumn(res, { boardId }, key));
})

router.post("/tasks/:id/move", async (req, res) => {
    const { toColumn, toIndex: rawIndex } = req.body ?? {};
    // drag (dnd.js), the keyboard select and alt+arrow all send toColumn; a
    // body without one has no caller, so treat it as a bad request rather
    // than inventing a destination.
    if (toColumn === undefined) return res.status(400).send("");
    const index = rawIndex === undefined ? tasksInColumn(toColumn, findTask(req.params.id)?.boardId ?? 1).length : Number(rawIndex);
    if (!Number.isInteger(index)) return res.status(400).send("");

    const result = moveTask(req.params.id, toColumn, index);
    if (!result.ok) return res.status(result.reason === "not-found" ? 404 : 400).send("");

    const announce = await renderPartial(res, "partials/announce", {
        title: result.task.title,
        label: columns.find((c) => c.key === result.toColumn).label,
        // within-column moves announce the slot, which is what alt+arrow moved
        ...(result.fromColumn === result.toColumn
            ? { position: result.task.order + 1, total: tasksInColumn(result.toColumn, result.task.boardId).length }
            : {}),
    });

    const view = wantsView(req.body);
    if (view) {
        const html = await renderBoardView(res, result.task.boardId, {
            view,
            q: req.body.q ?? "",
            sort: req.body.sort,
            dir: req.body.dir,
        });
        return res.send(html + announce);
    }

    // contract: primary fragment = the column the card came FROM (clients always
    // target it), OOB = the column it went TO. One shape serves drag, the
    // keyboard select and alt+arrow reorder alike.
    let out = await renderColumn(res, result.task, result.fromColumn);
    if (result.fromColumn !== result.toColumn) out += await renderColumn(res, result.task, result.toColumn, true);
    res.send(out + announce);
})

export default router;

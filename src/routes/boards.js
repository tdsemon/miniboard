import { Router } from "express";
import { listBoards, findBoard, addBoard, renameBoard, removeBoard, getTask, searchTasks, sortTasks, columns } from "../data/tasks.js";

const router = Router();

const renderPartial = (res, name, data) =>
    new Promise((resolve, reject) => {
        res.render(name, data, (err, html) => (err ? reject(err) : resolve(html)));
    });

const NAME_MAX = 60;
const cleanName = (raw) => String(raw ?? "").trim().slice(0, NAME_MAX);

const viewName = (view) => (view === "table" || view === "list" ? view : "board");

// One renderer for every view of one board: the fragments all receive the same
// locals, so a partial can render a move select or a sort header without
// knowing how it was reached.
export const renderBoardView = (res, boardId, { view = "board", q = "", sort = "order", dir = "asc" } = {}) => {
    const board = findBoard(boardId);
    if (!board) return null;
    const found = searchTasks(q, board.id);
    const tasks = viewName(view) === "table" ? sortTasks(found, sort, dir) : found;
    return renderPartial(res, `partials/${viewName(view)}`, {
        boards: listBoards(),
        board,
        boardId: board.id,
        tasks,
        columns,
        q,
        sort,
        dir,
        view: viewName(view),
    });
};

router.get("/boards", (req, res) => {
    res.render("partials/boards", { boards: listBoards() });
});

router.get("/boards/:id", async (req, res) => {
    const html = await renderBoardView(res, req.params.id, {
        view: req.query.view,
        q: req.query.q ?? "",
        sort: req.query.sort,
        dir: req.query.dir,
    });
    if (!html) return res.status(404).send("");
    res.send(html);
});

router.post("/boards", (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).send("");
    addBoard(name);
    res.render("partials/boards", { boards: listBoards() });
});

router.post("/boards/:id", (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).send("");
    if (!renameBoard(req.params.id, name)) return res.status(404).send("");
    res.render("partials/boards", { boards: listBoards() });
});

// The response echoes the removed task ids so the client can drop their
// drafts; the refreshed nav rides along so the sidebar keeps working.
router.delete("/boards/:id", (req, res) => {
    const result = removeBoard(req.params.id);
    if (!result.ok) return res.status(result.reason === "last-board" ? 400 : 404).send("");
    res.render("partials/boards", {
        boards: listBoards(),
        removedTaskIds: result.removedTasks.map((t) => t.id).join(","),
    });
});

export default router;

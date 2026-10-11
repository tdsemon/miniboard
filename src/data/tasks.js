const boardSeed = [
    { id: 1, name: "Designs" },
    { id: 2, name: "Branding" },
    { id: 3, name: "Email Template" },
]

let boards = boardSeed.map((b) => ({ ...b }))

let nextBoardId = 4;

const seed = [
    { id: 1, boardId: 1, title: "Research landing page trend", status: "planned", order: 0, note: "", version: 0, updatedAt: null },
    { id: 2, boardId: 1, title: "Design the hero section of physio", status: "progress", order: 0, note: "", version: 0, updatedAt: null },
    { id: 3, boardId: 1, title: "Make a video about Ai Maya", status: "planned", order: 1, note: "", version: 0, updatedAt: null },
    { id: 4, boardId: 1, title: "Build a small project with Alpinejs and htmx", status: "done", order: 0, note: "", version: 0, updatedAt: null },
    { id: 5, boardId: 2, title: "Logo variants for the clinic", status: "progress", order: 0, note: "", version: 0, updatedAt: null },
    { id: 6, boardId: 2, title: "Brand voice one-pager", status: "planned", order: 0, note: "", version: 0, updatedAt: null },
    { id: 7, boardId: 3, title: "Welcome email layout", status: "planned", order: 0, note: "", version: 0, updatedAt: null },
    { id: 8, boardId: 3, title: "Unsubscribe footer copy", status: "done", order: 0, note: "", version: 0, updatedAt: null },
]

let tasks = seed.map((t) => ({ ...t }))

let nextId = 9;

export const columns = [
    {key: "planned", label: "Planned"},
    {key: "progress", label: "In Progress"},
    {key: "done", label: "Done"},
]

const columnKeys = new Set(columns.map((c) => c.key));

export const listBoards = () => boards
export const findBoard = (id) => boards.find((b) => b.id === Number(id))

export const addBoard = (name) => {
    const board = { id: nextBoardId++, name };
    boards.push(board);
    return board;
}

export const renameBoard = (id, name) => {
    const board = findBoard(id);
    if (!board) return null;
    board.name = name;
    return board;
}

// The last board is the app: removing it would leave nowhere to put a task.
export const removeBoard = (id) => {
    const board = findBoard(id);
    if (!board) return { ok: false, reason: "not-found" };
    if (boards.length <= 1) return { ok: false, reason: "last-board" };
    boards = boards.filter((b) => b !== board);
    const removedTasks = tasks.filter((t) => t.boardId === board.id);
    tasks = tasks.filter((t) => t.boardId !== board.id);
    return { ok: true, board, removedTasks };
}

// boardId defaults to 1 so every pre-board caller (and the seed's move tests)
// keeps working; new callers pass the board they rendered the control from.
export const getTask = (boardId = 1) => tasks.filter((t) => t.boardId === Number(boardId))
export const findTask = (id) => tasks.find((t) => t.id === Number(id))
export const tasksInColumn = (key, boardId = 1) => tasks
    .filter((t) => t.status === key && t.boardId === Number(boardId))
    .sort((a, b) => a.order - b.order)

export const addTask = (title, status, boardId = 1) => {
    const newTask = {
        id: nextId++,
        title,
        status,
        boardId: Number(boardId),
        order: tasksInColumn(status, boardId).length
    }
    tasks.push(newTask);
    return newTask;
}

export const removeTask = (id) => {
    const task = findTask(id);
    tasks = tasks.filter((t) => t !== task);
    if (task) tasksInColumn(task.status, task.boardId).forEach((t, i) => t.order = i);
    return task;
}

// A move never crosses boards: the destination is a column, the task keeps its
// boardId, and the peers it reorders against are filtered to that board.
export const moveTask = (id, toColumn, toIndex) => {
    const task = findTask(id);
    if (!task) return { ok: false, reason: "not-found" };
    if (!columnKeys.has(toColumn)) return { ok: false, reason: "bad-column" };

    const fromColumn = task.status;
    const rest = tasks
        .filter((t) => t !== task && t.status === toColumn && t.boardId === task.boardId)
        .sort((a, b) => a.order - b.order);
    rest.splice(Math.max(0, Math.min(toIndex, rest.length)), 0, task);
    task.status = toColumn;
    rest.forEach((t, i) => t.order = i);
    if (fromColumn !== toColumn) tasksInColumn(fromColumn, task.boardId).forEach((t, i) => t.order = i);

    return { ok: true, task, fromColumn, toColumn };
}

export const searchTasks = (q, boardId = 1) => tasks
    .filter((t) => t.boardId === Number(boardId) && t.title.toLowerCase().includes(q.toLowerCase()))

const statusRank = Object.fromEntries(columns.map((c, i) => [c.key, i]));

const sortValue = (t, sort) => ({
    title: t.title.toLowerCase(),
    status: statusRank[t.status] ?? 9,
    note: t.updatedAt || "",
    order: [statusRank[t.status] ?? 9, t.order],
}[sort] ?? t.title.toLowerCase());

const sorters = {
    title: (a, b) => a.localeCompare(b),
    status: (a, b) => a - b,
    note: (a, b) => String(a).localeCompare(String(b)),
    order: (a, b) => (a[0] - b[0]) || (a[1] - b[1]),
};

export const sortTasks = (list, sort = "order", dir = "asc") => {
    const sign = dir === "desc" ? -1 : 1;
    const cmp = sorters[sort] ?? sorters.title;
    return [...list].sort((a, b) => cmp(sortValue(a, sort), sortValue(b, sort)) * sign);
};

export const getNote = (id) => {
    const task = findTask(id);
    if (!task) return { ok: false };
    return { ok: true, note: task.note, version: task.version, updatedAt: task.updatedAt };
}

const NOTE_MAX = 10000;

// Optimistic concurrency: the client sends the version its textarea was loaded
// with. A stale base means someone else saved in between — report the conflict
// and change nothing, so the client can offer keep-mine / take-server.
export const saveNote = (id, text, baseVersion) => {
    const task = findTask(id);
    if (!task) return { ok: false };
    if (Number(baseVersion) !== task.version) {
        return {
            ok: false,
            conflict: true,
            serverNote: task.note,
            serverVersion: task.version,
            updatedAt: task.updatedAt,
        };
    }
    task.note = String(text ?? "").slice(0, NOTE_MAX);
    task.version += 1;
    task.updatedAt = new Date().toISOString();
    return { ok: true, note: task.note, version: task.version, updatedAt: task.updatedAt };
}

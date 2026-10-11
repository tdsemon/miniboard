const seed = [
    { id: 1, title: "Research landing page trend", status: "planned", order: 0 },
    { id: 2, title: "Design the hero section of physio", status: "progress", order: 0 },
    { id: 3, title: "Make a video about Ai Maya", status: "planned", order: 1 },
    { id: 4, title: "Build a small project with Alpinejs and htmx", status: "done", order: 0 },
]

let tasks = seed.map((t) => ({ ...t }))

let nextId = 5;

export const columns = [
    {key: "planned", label: "Planned"},
    {key: "progress", label: "In Progress"},
    {key: "done", label: "Done"},
]

const columnKeys = new Set(columns.map((c) => c.key));

export const getTask = () => tasks
export const findTask = (id) => tasks.find((t) => t.id === Number(id))
export const tasksInColumn = (key) => tasks.filter((t) => t.status === key).sort((a, b) => a.order - b.order)

export const addTask = (title, status) => {
    const newTask = {
        id: nextId++,
        title,
        status,
        order: tasksInColumn(status).length
    }
    tasks.push(newTask);
    return newTask;
}

export const removeTask = (id) => {
    const task = findTask(id);
    tasks = tasks.filter((t) => t !== task);
    if (task) tasksInColumn(task.status).forEach((t, i) => t.order = i);
    return task;
}

export const moveTask = (id, toColumn, toIndex) => {
    const task = findTask(id);
    if (!task) return { ok: false, reason: "not-found" };
    if (!columnKeys.has(toColumn)) return { ok: false, reason: "bad-column" };

    const fromColumn = task.status;
    const rest = tasks
        .filter((t) => t !== task && t.status === toColumn)
        .sort((a, b) => a.order - b.order);
    rest.splice(Math.max(0, Math.min(toIndex, rest.length)), 0, task);
    task.status = toColumn;
    rest.forEach((t, i) => t.order = i);
    if (fromColumn !== toColumn) tasksInColumn(fromColumn).forEach((t, i) => t.order = i);

    return { ok: true, task, fromColumn, toColumn };
}

export const searchTasks = (q) => tasks.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()))

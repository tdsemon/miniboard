let tasks = [
    {id: 1, title: "Research landing page trend", status: "planned" },
    {id: 2, title: "Design the hero section of physio", status: "progress" },
    {id: 3, title: "Make a video about Ai Maya", status: "planned"},
    {id: 4, title: "Build a small project with Alpinejs and htmx", status: "done"},
]

let nextId = 5;

export const columns = [
    {key: "planned", label: "Planned"},
    {key: "progress", label: "In Progress"},
    {key: "done", label: "Done"},
]

export const getTask = () => tasks
export const findTask = (id) => tasks.find((t) => t.id ===Number(id))
export const addTask = (title, status) => {
    const newTask = {
        id: nextId++,
        title,
        status
    }
    tasks.push(newTask);
    return newTask;
}

export const removeTask = (id) => {
    tasks = tasks.filter((t) => t.id !== Number(id))
}

export const searchTasks = (q) => tasks.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()))
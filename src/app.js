import express from "express";
import path from "node:path";
import { fileURLToPath } from 'url';
import { readFileSync } from 'node:fs';
import boardRoutes from "./routes/board.js";
import boardsRoutes from "./routes/boards.js";
import taskRoutes from "./routes/tasks.js";
import noteRoutes from "./routes/notes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Use ejs to render template - each render returns htl that htmx drops in 

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// icon helper: server-side templates emit <svg class="icon"><use href="#i-...">
// from app.locals.icon(name). The set is derived from the committed sprite so
// an unknown name is a hard error in any environment (never a silent broken ref).
// The sprite itself is inlined once in index.ejs, outside #board/#notes-drawer.
const sprite = readFileSync(path.join(__dirname, "views", "partials", "icon-sprite.ejs"), "utf8");
const ICONS = new Set([...sprite.matchAll(/id="i-([^"]+)"/g)].map((m) => m[1]));
app.locals.icon = (name) => {
    if (!ICONS.has(name)) {
        throw new Error(`icon(): unknown name "${name}" — check src/views/partials/icon-sprite.ejs and ICONS in scripts/build-icons.mjs`);
    }
    return `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
};

//express reading from encoded data
app.use(express.urlencoded({extended: true}));

//server static files from /public folder
app.use(express.static(path.join(__dirname, "..", "public")))

//home page
app.get("/", (req,res)=> res.render('index'));

app.use(boardRoutes)
app.use(boardsRoutes)
app.use(taskRoutes)
app.use(noteRoutes)

export default app;

import express from "express";
import path from "node:path";
import { fileURLToPath } from 'url';
import boardRoutes from "./routes/board.js";
import taskRoutes from "./routes/tasks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Use ejs to render template - each render returns htl that htmx drops in 

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

//express reading from encoded data
app.use(express.urlencoded({extended: true}));

//server static files from /public folder
app.use(express.static(path.join(__dirname, "..", "public")))

//home page
app.get("/", (req,res)=> res.render('index'));

app.use(boardRoutes)
app.use(taskRoutes)

export default app;

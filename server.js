import app from "./src/app.js";
import { flush } from "./src/data/tasks.js";

const PORT = process.env.PORT ?? 3000;

// the data layer debounces its writes; a signal must land them before exit
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        flush();
        process.exit(0);
    });
}

app.listen(PORT, () => {
    console.log(`Miniboard -> http://localhost:${PORT}`)
})

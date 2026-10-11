// Every test process gets its own temp data file, set BEFORE any app module
// loads: ESM evaluates imports in source order, so this import must come
// first in each test file, ahead of anything that reaches src/data/tasks.js.
// The temp dir is removed when the process exits.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniboard-test-"));
process.env.DATA_FILE ??= path.join(dir, "miniboard.json");

process.on("exit", () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

// scripts/screenshots.mjs — stage 2 visual/overflow gate.
// Boots the server against a temp fixture (never touches data/miniboard.json),
// captures board/table/list/drawer in light+dark at 3 sizes, and FAILS if any
// (size, view) shows horizontal page overflow (scrollWidth > clientWidth).
// Browser: nix playwright-driver chromium via playwright-core executablePath.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/nix/store/6bg6ciwh50x38sca5x9zimdzqijkc8sq-playwright-chromium/chrome-linux64/chrome";
const PORT = 3160;
const SIZES = [
    { w: 320, h: 700 },
    { w: 360, h: 740 },
    { w: 768, h: 1024 },
    { w: 1023, h: 740 },
    { w: 1024, h: 740 },
    { w: 1025, h: 740 },
    { w: 1440, h: 900 },
    { w: 1920, h: 1080 },
];
// sidebar layout-mode crossings: 1023 drawer, 1024/1025 docked.
// each gets a plain "board" shot and a "drawer" shot (sidebar open).
const SIDEBAR_SIZES = [1023, 1024, 1025];
const THEMES = ["light", "dark"];

// deterministic fixture: boards + tasks, two with notes (drawer screenshots)
const fixture = {
    boards: [
        { id: 1, name: "Designs" },
        { id: 2, name: "Branding" },
        { id: 3, name: "Email Template" },
    ],
    tasks: [
        { id: 1, boardId: 1, title: "Research landing page trends", status: "planned", order: 0, note: "", version: 0, updatedAt: null },
        { id: 2, boardId: 1, title: "Design the hero section", status: "progress", order: 0, note: "Keep the CTA above the fold.", version: 1, updatedAt: "2026-10-13T10:00:00.000Z" },
        { id: 3, boardId: 1, title: "Make a video about AI Maya with a very long title that should wrap instead of overflowing the card", status: "planned", order: 1, note: "", version: 0, updatedAt: null },
        { id: 4, boardId: 1, title: "Build a small project with Alpine and htmx", status: "done", order: 0, note: "", version: 0, updatedAt: null },
        { id: 5, boardId: 2, title: "Logo variants for the clinic", status: "progress", order: 0, note: "Try the monogram again.", version: 1, updatedAt: "2026-10-13T11:00:00.000Z" },
    ],
    nextId: 6,
    nextBoardId: 4,
};

const dir = mkdtempSync(path.join(tmpdir(), "mb-shots-"));
const dataFile = path.join(dir, "miniboard.json");
writeFileSync(dataFile, JSON.stringify(fixture, null, 2));
mkdirSync(path.join(root, "screenshots"), { recursive: true });

const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DATA_FILE: dataFile },
    stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));

async function waitForServer() {
    for (let i = 0; i < 50; i++) {
        try {
            // bare fetch() hangs on a keep-alive socket; give each probe its own AbortController
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), 500);
            const res = await fetch(`http://localhost:${PORT}/`, { signal: ac.signal });
            clearTimeout(t);
            if (res.ok) return;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start");
}

const overflow = [];
const failures = [];

try {
    await waitForServer();
    const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

    for (const theme of THEMES) {
        for (const { w, h } of SIZES) {
            const context = await browser.newContext({ viewport: { width: w, height: h } });
            await context.addInitScript((t) => localStorage.setItem("miniboard:theme", t), theme);
            const page = await context.newPage();
            await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
            await page.waitForSelector(".column", { timeout: 5000 });
            await page.waitForTimeout(400); // let the .view-enter fade finish

            const checkOverflow = async (label) => {
                const { sw, cw } = await page.evaluate(() => ({
                    sw: document.documentElement.scrollWidth,
                    cw: document.documentElement.clientWidth,
                }));
                if (sw > cw) overflow.push(`${label}: scrollWidth ${sw} > clientWidth ${cw}`);
            };

            const shot = (state) => page.screenshot({ path: path.join(root, "screenshots", `${theme}-${w}x${h}-${state}.png`) });

            // board
            await checkOverflow(`${theme} ${w}x${h} board`);
            await shot("board");

            // drawer (from board view)
            await page.locator(".card .notes-btn").first().click();
            await page.waitForSelector("#notes-drawer .notes-panel", { state: "visible", timeout: 5000 });
            await checkOverflow(`${theme} ${w}x${h} drawer`);
            await shot("drawer");
            await page.keyboard.press("Escape");
            await page.waitForSelector("#notes-drawer .notes-panel", { state: "hidden", timeout: 5000 });

            // table
            await page.locator(".tabs button", { hasText: "Table" }).click();
            await page.waitForSelector(".task-table, .empty-view", { timeout: 5000 });
            await page.waitForTimeout(400); // view-enter fade
            await checkOverflow(`${theme} ${w}x${h} table`);
            await shot("table");

            // list
            await page.locator(".tabs button", { hasText: "List" }).click();
            await page.waitForSelector(".task-list, .empty-view", { timeout: 5000 });
            await page.waitForTimeout(400); // view-enter fade
            await checkOverflow(`${theme} ${w}x${h} list`);
            await shot("list");

            await context.close();
        }
    }

    // sidebar layout-mode crossings (both themes) — drawer open + board, no overflow
    for (const theme of THEMES) {
        for (const w of SIDEBAR_SIZES) {
            const context = await browser.newContext({ viewport: { width: w, height: 740 } });
            await context.addInitScript((t) => localStorage.setItem("miniboard:theme", t), theme);
            const page = await context.newPage();
            await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
            await page.waitForSelector(".column", { timeout: 5000 });
            await page.waitForTimeout(400);

            const checkOverflow = async (label) => {
                const { sw, cw } = await page.evaluate(() => ({
                    sw: document.documentElement.scrollWidth,
                    cw: document.documentElement.clientWidth,
                }));
                if (sw > cw) overflow.push(`${label}: scrollWidth ${sw} > clientWidth ${cw}`);
            };

            const shot = (state) => page.screenshot({ path: path.join(root, "screenshots", `${theme}-${w}x740-${state}.png`) });

            // board (sidebar closed)
            await checkOverflow(`${theme} ${w}x740 board`);
            await shot("board");

            // sidebar drawer open
            await page.locator(".menu-btn").click();
            await page.waitForTimeout(400);
            await checkOverflow(`${theme} ${w}x740 drawer`);
            await shot("drawer");

            await context.close();
        }
    }

    await browser.close();
} finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
}

if (overflow.length) {
    console.error("HORIZONTAL OVERFLOW:");
    for (const line of overflow) console.error("  " + line);
    process.exit(1);
}
if (failures.length) {
    console.error("FAILURES:");
    for (const line of failures) console.error("  " + line);
    process.exit(1);
}
console.log(`ok: ${THEMES.length * SIZES.length * 4} screenshots (plus ${THEMES.length * SIDEBAR_SIZES.length * 2} sidebar), no horizontal overflow`);

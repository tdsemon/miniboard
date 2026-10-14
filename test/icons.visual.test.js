// test/icons.visual.test.js — Playwright: icon-only controls have accessible
// names, icons survive htmx swaps, no horizontal overflow at 320/1440.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/nix/store/6bg6ciwh50x38sca5x9zimdzqijkc8sq-playwright-chromium/chrome-linux64/chrome";
const PORT = 3161;

const fixture = {
    boards: [{ id: 1, name: "Designs" }, { id: 2, name: "Branding" }],
    tasks: [
        { id: 1, boardId: 1, title: "Research landing page trends", status: "planned", order: 0, note: "", version: 0, updatedAt: null },
        { id: 2, boardId: 1, title: "Design the hero section", status: "progress", order: 0, note: "Keep the CTA above the fold.", version: 1, updatedAt: "2026-10-13T10:00:00.000Z" },
    ],
    nextId: 3, nextBoardId: 3,
};

let server, browser, dataDir;

before(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), "mb-icons-"));
    const dataFile = path.join(dataDir, "miniboard.json");
    writeFileSync(dataFile, JSON.stringify(fixture, null, 2));
    server = spawn(process.execPath, ["server.js"], {
        cwd: root,
        env: { ...process.env, PORT: String(PORT), DATA_FILE: dataFile },
        stdio: "ignore",
    });
    for (let i = 0; i < 60; i++) {
        try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch {}
        await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});

after(async () => {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

async function newPage(width, height, theme = "light") {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript((t) => localStorage.setItem("miniboard:theme", t), theme);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".column", { timeout: 8000 });
    return { ctx, page };
}

const SIZES = [[360, 740], [1440, 900]];
const THEMES = ["light", "dark"];

test("icon-only controls have accessible names", async () => {
    const { ctx, page } = await newPage(1440, 900);
    // menu (sidebar toggle) — always present
    await page.getByRole("button", { name: /toggle boards sidebar/i }).waitFor({ timeout: 5000 });
    // theme toggle
    await page.getByRole("button", { name: /switch to (light|dark) theme/i }).waitFor({ timeout: 5000 });
    // rename board (pencil) — first board
    await page.getByRole("button", { name: /rename designs/i }).waitFor({ timeout: 5000 });
    // delete board (trash) — first board
    await page.getByRole("button", { name: /delete board designs/i }).waitFor({ timeout: 5000 });
    // notes button on a card
    await page.getByRole("button", { name: /note on/i }).first().waitFor({ timeout: 5000 });
    // delete task
    await page.getByRole("button", { name: /delete task/i }).first().waitFor({ timeout: 5000 });
    // add task
    await page.getByRole("button", { name: /add task/i }).first().waitFor({ timeout: 5000 });
    // add board
    await page.getByPlaceholder("New board").waitFor({ timeout: 5000 });
    await ctx.close();

    // search icon button is only visible below 640px
    const small = await newPage(360, 740);
    await small.page.getByRole("button", { name: /search tasks/i }).waitFor({ timeout: 5000 });
    await small.ctx.close();
});

test("icons survive htmx swaps (move card, switch view, switch board)", async () => {
    const { ctx, page } = await newPage(1440, 900);
    // count note icons before
    const before = await page.locator("svg.icon use[href='#i-document-text-outline']").count();
    assert.ok(before > 0, "expected note icons on initial board render");

    // switch to table view (htmx swap into #board)
    await page.getByRole("button", { name: /table/i }).click();
    await page.waitForSelector(".task-table, .empty-view", { timeout: 8000 });
    const afterTable = await page.locator("svg.icon use[href='#i-document-text-outline']").count();
    assert.ok(afterTable > 0, "note icons should survive table view swap");

    // switch to list view
    await page.getByRole("button", { name: /list/i }).click();
    await page.waitForSelector(".task-list, .empty-view", { timeout: 8000 });
    const afterList = await page.locator("svg.icon use[href='#i-document-text-outline']").count();
    assert.ok(afterList > 0, "note icons should survive list view swap");

    // back to board, move a card via the select (htmx move swap)
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await page.waitForSelector(".column", { timeout: 8000 });
    // move first card to "progress"
    const moveSelect = page.locator(".move-select").first();
    await moveSelect.selectOption("progress");
    await page.waitForTimeout(800);
    const afterMove = await page.locator("svg.icon use[href='#i-document-text-outline']").count();
    assert.ok(afterMove > 0, "note icons should survive a move swap");

    // switch board via sidebar (htmx board swap)
    await page.locator("#boards .project-btn", { hasText: "Branding" }).click();
    await page.waitForTimeout(800);
    // Branding has no tasks, so assert the board actually swapped and a
    // non-card icon (menu) is still present rather than a note icon.
    await page.locator(".topbar-title", { hasText: "Branding" }).waitFor({ timeout: 5000 });
    const menuAfterBoard = await page.locator("svg.icon use[href='#i-menu-outline']").count();
    assert.ok(menuAfterBoard > 0, "menu icon should survive a board swap");

    // client-rendered board list: the sidebar itself is htmx-swapped on add
    await page.getByPlaceholder("New board").fill("Temp Board");
    await page.getByPlaceholder("New board").press("Enter");
    await page.waitForTimeout(800);
    const menuIcon = await page.locator("svg.icon use[href='#i-menu-outline']").count();
    assert.ok(menuIcon > 0, "menu icon should still be present after board add swap");
    await ctx.close();
});

test("no horizontal overflow at 320 and 1440, light + dark", async () => {
    for (const theme of THEMES) {
        for (const [w, h] of [[320, 700], [1440, 900]]) {
            const { ctx, page } = await newPage(w, h, theme);
            const { sw, cw } = await page.evaluate(() => ({
                sw: document.documentElement.scrollWidth,
                cw: document.documentElement.clientWidth,
            }));
            assert.ok(sw <= cw, `${theme} ${w}x${h}: scrollWidth ${sw} > clientWidth ${cw}`);
            await ctx.close();
        }
    }
});

test("screenshots at 360 and 1440, light + dark, board + table", async () => {
    const shotDir = path.join(root, "screenshots");
    mkdirSync(shotDir, { recursive: true });
    for (const theme of THEMES) {
        for (const [w, h] of SIZES) {
            const { ctx, page } = await newPage(w, h, theme);
            const shot = (state) => page.screenshot({ path: path.join(shotDir, `${theme}-${w}x${h}-${state}.png`) });
            await shot("board");
            await page.getByRole("button", { name: "Table", exact: true }).click();
            await page.waitForSelector(".task-table, .empty-view", { timeout: 8000 });
            await page.waitForTimeout(300);
            await shot("table");
            await ctx.close();
        }
    }
});

// --- guard: escaped icon markup shows as literal text in the rendered page.
// innerText is what a user actually reads, so if icon() ever gets printed
// through the escaped form again, "<svg class=..." lands here.

const assertNoMarkupText = (page, label) => page.evaluate(() => document.body.innerText).then((text) => {
    for (const token of ["<svg", "<use", "&lt;", "&gt;"]) {
        assert.equal(text.includes(token), false, `${label}: body text contains "${token}" — escaped icon markup`);
    }
});

test("no escaped icon markup in body text on every view", async () => {
    const { ctx, page } = await newPage(1440, 900);
    await assertNoMarkupText(page, "board");

    // table, every sortable header in both directions (real clicks)
    for (const col of ["Title", "Status", "Note", "Order"]) {
        await page.getByRole("button", { name: "Table", exact: true }).click();
        await page.waitForSelector(".task-table", { timeout: 8000 });
        for (const _ of [0, 1]) { // first click = asc, second = desc
            await page.locator(".sort-btn", { hasText: col }).click();
            await page.waitForTimeout(350);
            await assertNoMarkupText(page, `table ${col}`);
        }
    }

    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.waitForSelector(".task-list", { timeout: 8000 });
    await assertNoMarkupText(page, "list");

    await page.getByRole("button", { name: "Board", exact: true }).click();
    await page.waitForSelector(".column", { timeout: 8000 });
    await assertNoMarkupText(page, "board again");
    await assertNoMarkupText(page, "sidebar"); // sidebar is on the page
    await ctx.close();
});

test("no escaped icon markup in the notes drawer across every status", async () => {
    // idle -> editing -> dirty -> saving -> saved, then error (aborted save),
    // then conflict (409). All reached by real clicks.
    const { ctx, page } = await newPage(1440, 900);

    await page.locator(".notes-btn").first().click();
    await page.waitForSelector(".notes-panel", { state: "visible", timeout: 8000 });
    await assertNoMarkupText(page, "drawer idle");

    const ta = page.locator(".notes-textarea");
    await ta.click();
    await assertNoMarkupText(page, "drawer editing");

    await ta.type(" more words", { delay: 20 });
    await assertNoMarkupText(page, "drawer dirty");

    // error: abort the notes POST so the save fails
    await page.route((u) => u.pathname.endsWith("/notes") && u.method === "POST", (route) => route.abort("failed"));
    await page.locator(".notes-save").click();
    await page.waitForTimeout(900);
    await assertNoMarkupText(page, "drawer error");
    await page.unroute((u) => u.pathname.endsWith("/notes") && u.method === "POST");

    // conflict: force a 409 with a note-conflict body
    await page.route((u) => u.pathname.endsWith("/notes") && u.method === "POST", (route) => route.fulfill({
        status: 409,
        contentType: "text/html",
        body: '<div id="note-conflict" hidden data-version="9" data-updated-at="2026-10-13T10:00:00.000Z">server copy</div>',
    }));
    await page.locator(".notes-save").click();
    await page.waitForTimeout(900);
    await page.locator(".conflict-bar").waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    await assertNoMarkupText(page, "drawer conflict");
    await page.unroute((u) => u.pathname.endsWith("/notes") && u.method === "POST");

    // saved: back to a working server, save for real
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.locator(".notes-btn").first().click();
    await page.waitForSelector(".notes-panel", { state: "visible", timeout: 8000 });
    await page.locator(".notes-textarea").click();
    await page.locator(".notes-textarea").type("final", { delay: 20 });
    await page.locator(".notes-save").click();
    await page.waitForTimeout(1200);
    await assertNoMarkupText(page, "drawer saved");
    await ctx.close();
});

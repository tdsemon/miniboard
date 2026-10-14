// scripts/rename.mjs — regression gate for board rename.
// Boots the server against a temp fixture (never touches data/miniboard.json),
// drives the pencil / keyboard / touch / dblclick paths, and FAILS on any
// console error or a broken expectation.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright-core";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/nix/store/6bg6ciwh50x38sca5x9zimdzqijkc8sq-playwright-chromium/chrome-linux64/chrome";
const FIREFOX = "/nix/store/q90g76a2ybhj6zxnsny6nyz9hjvzd2g4-playwright-firefox/firefox/firefox";
const PORT = 3191;

const fixture = {
    boards: [{ id: 1, name: "Designs" }, { id: 2, name: "Branding" }, { id: 3, name: "Email Template" }],
    tasks: [{ id: 1, boardId: 1, title: "T1", status: "planned", order: 0, note: "", version: 0, updatedAt: null }],
    nextId: 2, nextBoardId: 4,
};

const dir = mkdtempSync(path.join(tmpdir(), "mb-rename-"));
const dataFile = path.join(dir, "miniboard.json");
writeFileSync(dataFile, JSON.stringify(fixture, null, 2));

const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DATA_FILE: dataFile },
    stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
}

const failures = [];
const check = (cond, msg, label) => { if (!cond) failures.push(label ? `[${label}] ${msg}` : msg); };

// hover the row so the opacity-reveal pencil becomes pointer-events:auto, then act
const reveal = async (page, idx = 0) => {
    const item = page.locator(".project-item").nth(idx);
    await item.hover();
    await page.waitForTimeout(120);
};

const engines = [
    { name: "chromium", launch: () => chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] }) },
    { name: "firefox", launch: () => firefox.launch({ executablePath: FIREFOX }) },
];

async function run(engine, browser, name, { hasTouch = false } = {}, fn) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("PAGEERR: " + e.message));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".project-edit");
    await page.waitForTimeout(200);
    try { await fn(page); } catch (e) { failures.push(`[${engine.name}] ${name}: threw ${e.message.split("\n")[0]}`); }
    check(errors.length === 0, `[${engine.name}] ${name}: console errors ${JSON.stringify(errors)}`);
    await page.close();
}

const cases = [
["mouse pencil", {}, async (page) => {
    const activeBefore = await page.evaluate(() => Alpine.$data(document.querySelector(".app")).$store.mb.ui.activeBoardId);
    const reqs = [];
    page.on("request", (r) => { const u = r.url(); if (!/\.(js|css|png|svg|ico|woff)/.test(u)) reqs.push(`${r.method()} ${u.replace(`http://localhost:${PORT}`, "")}`); });
    await reveal(page, 0);
    await page.locator(".project-edit").first().click();
    await page.waitForTimeout(200);
    const input = page.locator(".board-rename input");
    check(await input.count() === 1, "pencil: input did not open");
    check(await input.evaluate((el) => document.activeElement === el), "pencil: input not focused");
    check(await input.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length), "pencil: name not selected");
    const activeAfter = await page.evaluate(() => Alpine.$data(document.querySelector(".app")).$store.mb.ui.activeBoardId);
    check(activeBefore === activeAfter, "pencil: active board changed");
    check(!reqs.some((r) => /^GET \/boards\/\d/.test(r)), `pencil: fired board-switch request ${JSON.stringify(reqs)}`);
}],

["rename via Enter", {}, async (page) => {
    await reveal(page, 0);
    await page.locator(".project-edit").first().click();
    await page.waitForTimeout(150);
    await page.locator(".board-rename input").fill("Launch week");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check((await page.locator("#boards").textContent()).includes("Launch week"), "Enter: sidebar did not update");
    check((await page.locator(".topbar-title").textContent()).trim() === "Launch week", "Enter: topbar did not update");
    check(await page.locator(".board-rename").count() === 0, "Enter: rename form still open");
}],

// 3. empty name rejected -> error shown, stays open, old name kept
// uses board 2 (Branding) while it is still pristine: each run() boots a fresh
// server that re-reads the shared temp file, and a prior test's rename may not
// have been flushed yet, so assert on a board no earlier test renamed
["empty rejected", {}, async (page) => {
    await reveal(page, 1);
    await page.locator(".project-edit").nth(1).click();
    await page.waitForTimeout(150);
    await page.locator(".board-rename input").fill("   ");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    check(await page.locator(".board-rename").count() === 1, "empty: form closed");
    const errText = (await page.locator(".rename-error").textContent()) ?? "";
    check(errText.trim().length > 0 && await page.locator(".rename-error").isVisible(), "empty: no error message");
    check(/empty|too long|required/i.test(errText), `empty: wrong error text ${JSON.stringify(errText)}`);
    const btn = await page.locator(".project-btn").nth(1).textContent();
    check(btn === "Branding", `empty: board name changed to ${JSON.stringify(btn)}`);
}],

["Escape cancels", {}, async (page) => {
    await reveal(page, 1);
    await page.locator(".project-edit").nth(1).click();
    await page.waitForTimeout(150);
    await page.locator(".board-rename input").fill("Nope");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    check(await page.locator(".board-rename").count() === 0, "Escape: form still open");
    check((await page.locator("#boards").textContent()).includes("Branding"), "Escape: name was changed");
    check(await page.evaluate(() => document.activeElement?.classList.contains("project-edit")), "Escape: focus not on pencil");
}],

["keyboard only", {}, async (page) => {
    let reached = false;
    for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        if (await page.evaluate(() => document.activeElement?.classList.contains("project-edit"))) { reached = true; break; }
    }
    check(reached, "keyboard: could not tab to pencil");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    check(await page.locator(".board-rename").count() === 1, "keyboard: Enter did not open rename");
    await page.locator(".board-rename input").fill("Keyboard board");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check((await page.locator("#boards").textContent()).includes("Keyboard board"), "keyboard: name not saved");
}],

["touch tap", { hasTouch: true }, async (page) => {
    await reveal(page, 0);
    await page.locator(".project-edit").first().tap();
    await page.waitForTimeout(200);
    check(await page.locator(".board-rename").count() === 1, "touch: tap did not open rename");
    check(await page.locator(".board-rename input").evaluate((el) => document.activeElement === el), "touch: input not focused");
}],

["dblclick name", {}, async (page) => {
    await page.locator(".project-btn").first().dblclick();
    await page.waitForTimeout(200);
    check(await page.locator(".board-rename").count() === 1, "dblclick: rename did not open");
}],

["persists across refresh", {}, async (page) => {
    await reveal(page, 2);
    await page.locator(".project-edit").nth(2).click();
    await page.waitForTimeout(150);
    await page.locator(".board-rename input").fill("Persisted");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#boards .project-btn");
    check((await page.locator("#boards").textContent()).includes("Persisted"), "refresh: name not kept");
}],
];

// --- item 5: rename-mode + htmx-swap + outside-click behaviour ---
async function extraChecks(engine, browser, page) {
    // (5a) single rename mode: opening a second form closes the first
    await reveal(page, 0);
    await page.locator(".project-edit").first().click();
    await page.waitForTimeout(150);
    check(await page.evaluate(() => Alpine.$data(document.querySelector(".app")).editingId) === 1, "single-open: board 1 form did not open", engine.name);
    await reveal(page, 1);
    await page.locator(".project-edit").nth(1).click();
    await page.waitForTimeout(150);
    check(await page.evaluate(() => Alpine.$data(document.querySelector(".app")).editingId) === 2, "single-open: board 2 form did not take over", engine.name);
    check((await page.locator(".board-rename").count()) === 1, "single-open: more than one rename form open", engine.name);

    // (5b) htmx swap of #board while editing must NOT wipe the open input.
    // board 3 was renamed to "Persisted" by the cases above; the form lives on
    // .app (not #board), so the swap must leave editingId and the draft intact.
    await reveal(page, 2);
    await page.locator(".project-edit").nth(2).click();
    await page.waitForTimeout(150);
    await page.locator(".board-rename input").fill("Keep me");
    await page.evaluate(() => htmx.ajax("GET", "/boards/1?view=table", { target: "#board", swap: "innerHTML" }));
    await page.waitForTimeout(600);
    check(await page.evaluate(() => Alpine.$data(document.querySelector(".app")).editingId) === 3, "swap-safety: editingId lost across #board swap", engine.name);
    check((await page.locator(".board-rename").count()) === 1, "swap-safety: rename form wiped by #board swap", engine.name);
    check((await page.locator(".board-rename input").evaluate((el) => el.value)) === "Keep me", "swap-safety: typed text lost across swap", engine.name);

    // (5c) outside click = CANCEL (not save) — mouse. target = header topbar,
    // which is outside the rename form and not a rename control.
    await page.mouse.click(700, 40);
    await page.waitForTimeout(200);
    check((await page.locator(".board-rename").count()) === 0, "outside-cancel(mouse): form still open", engine.name);
    check(await page.evaluate(() => Alpine.$data(document.querySelector(".app")).editingId) === null, "outside-cancel(mouse): editingId not cleared", engine.name);
    // board 3's stored name must still be "Persisted" (cancel, not save)
    check((await page.locator("#boards").textContent()).includes("Persisted"), "outside-cancel(mouse): name saved instead of cancelled", engine.name);

    // (5d) outside tap = CANCEL on touch too (same policy). tap on the topbar.
    // board 1 was renamed to "Keyboard board" by the "keyboard only" case above,
    // so capture the live name and assert cancel leaves it unchanged.
    const beforeTouch = (await page.locator("#boards").textContent());
    await reveal(page, 0);
    await page.locator(".project-edit").first().click();
    await page.waitForTimeout(150);
    await page.locator(".board-rename input").fill("Touched");
    await page.locator("header.topbar").tap();
    await page.waitForTimeout(200);
    check(await page.evaluate(() => Alpine.$data(document.querySelector(".app")).editingId) === null, "outside-cancel(touch): editingId not cleared", engine.name);
    check((await page.locator("#boards").textContent()) === beforeTouch, "outside-cancel(touch): board name changed on outside tap (should cancel, not save)", engine.name);
    check(!((await page.locator("#boards").textContent()).includes("Touched")), "outside-cancel(touch): typed text was saved", engine.name);

    // --- item 1: component open/close audit ---
    // start from board view so the drawer and sort targets are both reachable
    await page.evaluate(() => htmx.ajax("GET", "/boards/1", { target: "#board", swap: "innerHTML" }));
    await page.locator("#board .card").first().waitFor({ state: "visible", timeout: 5000 });

    // sidebar drawer via menu button. sidebarOpen starts true at >=1024
    // (index.ejs:56), so seed a known closed state before asserting the toggle.
    await page.evaluate(() => { Alpine.$data(document.querySelector(".app")).sidebarOpen = false; });
    await page.waitForTimeout(150);
    check(await page.locator(".sidebar").getAttribute("data-open") !== "true", "audit: sidebar not seeded closed", engine.name);
    await page.locator(".menu-btn").click();
    await page.waitForTimeout(200);
    check(await page.evaluate(() => Alpine.$data(document.querySelector(".app")).sidebarOpen === true), "audit: menu button did not open sidebar drawer", engine.name);
    check(await page.locator(".sidebar").getAttribute("data-open") === "true", "audit: sidebar data-open not true after open", engine.name);
    await page.locator(".menu-btn").click();
    await page.waitForTimeout(200);
    check(await page.evaluate(() => Alpine.$data(document.querySelector(".app")).sidebarOpen === false), "audit: menu button did not close sidebar drawer", engine.name);
    check(await page.locator(".sidebar").getAttribute("data-open") !== "true", "audit: sidebar data-open still true after close", engine.name);

    // notes drawer via Note button. the click dispatches notes-open, which
    // fetches /tasks/:id/notes into #notes-drawer (notes.js:370) — wait for the
    // content to land, not just for the click.
    const noteBtn = page.locator(".notes-btn").first();
    if (await noteBtn.count()) {
        const noteReqs = [];
        page.on("request", (r) => { if (r.url().includes("/notes")) noteReqs.push(r.method() + " " + r.url()); });
        await noteBtn.click();
        // the swap target #notes-drawer is an invisible container (no CSS box);
        // the visible, positioned element is .notes-panel (x-show="open") inside it
        await page.locator("#notes-drawer .notes-panel").waitFor({ state: "visible", timeout: 5000 });
        check(await page.locator("#notes-drawer .notes-panel").isVisible(), "audit: Note button did not open notes drawer", engine.name);
        await page.locator("#notes-drawer .notes-close").click();
        await page.locator("#notes-drawer .notes-panel").waitFor({ state: "hidden", timeout: 5000 });
    }

    // sort menu: a sort click flips ui.sort then refresh() re-renders #board,
    // briefly removing .task-table — wait for it to come back before asserting.
    // must enter table view via setView so ui.view matches; a raw htmx swap
    // would leave ui.view = "board" and the next refresh() would revert.
    await page.evaluate(() => Alpine.$data(document.querySelector(".app")).setView("table"));
    await page.locator("#board .task-table").waitFor({ state: "visible", timeout: 5000 });
    const sortBtn = page.locator("#board .sort-btn").first();
    if (await sortBtn.count()) {
        const before = await page.evaluate(() => Alpine.$data(document.querySelector(".app")).$store.mb.ui.sort);
        await sortBtn.click();
        await page.locator("#board .task-table").waitFor({ state: "visible", timeout: 5000 });
        check((await page.locator("#board .task-table").count()) === 1, "audit: sort button closed the table", engine.name);
        const after = await page.evaluate(() => Alpine.$data(document.querySelector(".app")).$store.mb.ui.sort);
        check(after !== before, `audit: sort button did not change sort (still ${after})`, engine.name);
    } else {
        check(false, "audit: no .sort-btn found in table view", engine.name);
    }

    // search: the .search-btn icon toggle is x-show="!wide" (hidden at >=640px),
    // so exercise it in a narrow sub-context where it's the only search control.
    // ponytail: separate context (not page.context().newPage()) — the main page
    // is closed by run() after this fn returns, and a sibling page from the same
    // context can inherit that teardown; a fresh context is independent.
    const narrowCtx = await browser.newContext({ viewport: { width: 480, height: 900 } });
    const narrow = await narrowCtx.newPage();
    await narrow.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await narrow.waitForSelector(".search-btn");
    await narrow.waitForTimeout(500);
    // ponytail: dispatchEvent not .click() — Firefox's click() waits for a
    // pointerup that never fires; the DOM toggle is what we're asserting.
    await narrow.locator(".search-btn").dispatchEvent("click");
    await narrow.locator(".search").waitFor({ state: "visible", timeout: 5000 });
    check(await narrow.locator(".search").isVisible(), "audit: search icon did not expand the input", engine.name);
    await narrowCtx.close();

    const step = async (label, fn) => { try { return await fn(); } catch (e) { throw new Error(`[${label}] ${e.message}`); } };

    // continue banner: only visible after a real note save sets lastEdited
    // (notes.js:437); the rename flow never edits a note, so it's display:none
    // via x-show="visible". Guard on visibility, not count() — count() sees
    // hidden nodes and the click() would then wait forever.
    const bannerBtn = page.locator(".continue-open");
    if (await bannerBtn.isVisible().catch(() => false)) {
        await step("continue-open", () => bannerBtn.click());
        await page.waitForTimeout(300);
    }
}

for (const engine of engines) {
    const browser = await engine.launch();
    for (const [name, opts, fn] of cases) {
        await run(engine, browser, name, opts, fn);
    }
    await run(engine, browser, "extra: single-open/swap/outside/audit", { hasTouch: true }, (page) => extraChecks(engine, browser, page));
    await browser.close();
}

server.kill();
rmSync(dir, { recursive: true, force: true });

if (failures.length) {
    console.log("rename regression FAILED:");
    failures.forEach((f) => console.log("  ✗ " + f));
    process.exit(1);
}
console.log("rename regression: all checks passed");
process.exit(0);

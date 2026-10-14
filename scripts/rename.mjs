// scripts/rename.mjs — regression gate for board rename.
// Boots the server against a temp fixture (never touches data/miniboard.json),
// drives the pencil / keyboard / touch / dblclick paths, and FAILS on any
// console error or a broken expectation.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/nix/store/6bg6ciwh50x38sca5x9zimdzqijkc8sq-playwright-chromium/chrome-linux64/chrome";
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
const check = (cond, msg) => { if (!cond) failures.push(msg); };

// hover the row so the opacity-reveal pencil becomes pointer-events:auto, then act
const reveal = async (page, idx = 0) => {
    const item = page.locator(".project-item").nth(idx);
    await item.hover();
    await page.waitForTimeout(120);
};

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

async function run(name, { hasTouch = false } = {}, fn) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("PAGEERR: " + e.message));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".project-edit");
    await page.waitForTimeout(200);
    try { await fn(page); } catch (e) { failures.push(`${name}: threw ${e.message.split("\n")[0]}`); }
    check(errors.length === 0, `${name}: console errors ${JSON.stringify(errors)}`);
    await page.close();
}

// 1. pencil click (mouse) opens focused + selected; board does NOT switch; no hx-get
await run("mouse pencil", {}, async (page) => {
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
});

// 2. type new name + Enter -> sidebar + topbar update
await run("rename via Enter", {}, async (page) => {
    await reveal(page, 0);
    await page.locator(".project-edit").first().click();
    await page.waitForTimeout(150);
    await page.locator(".board-rename input").fill("Launch week");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check((await page.locator("#boards").textContent()).includes("Launch week"), "Enter: sidebar did not update");
    check((await page.locator(".topbar-title").textContent()).trim() === "Launch week", "Enter: topbar did not update");
    check(await page.locator(".board-rename").count() === 0, "Enter: rename form still open");
});

// 3. empty name rejected -> error shown, stays open, old name kept
// uses board 2 (Branding) while it is still pristine: each run() boots a fresh
// server that re-reads the shared temp file, and a prior test's rename may not
// have been flushed yet, so assert on a board no earlier test renamed
await run("empty rejected", {}, async (page) => {
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
});

// 4. Escape cancels and focus returns to the pencil
await run("Escape cancels", {}, async (page) => {
    await reveal(page, 1);
    await page.locator(".project-edit").nth(1).click();
    await page.waitForTimeout(150);
    await page.locator(".board-rename input").fill("Nope");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    check(await page.locator(".board-rename").count() === 0, "Escape: form still open");
    check((await page.locator("#boards").textContent()).includes("Branding"), "Escape: name was changed");
    check(await page.evaluate(() => document.activeElement?.classList.contains("project-edit")), "Escape: focus not on pencil");
});

// 5. keyboard-only: tab to pencil, Enter opens; type + Enter saves
await run("keyboard only", {}, async (page) => {
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
});

// 6. touch tap on pencil opens rename
await run("touch tap", { hasTouch: true }, async (page) => {
    await reveal(page, 0);
    await page.locator(".project-edit").first().tap();
    await page.waitForTimeout(200);
    check(await page.locator(".board-rename").count() === 1, "touch: tap did not open rename");
    check(await page.locator(".board-rename input").evaluate((el) => document.activeElement === el), "touch: input not focused");
});

// 7. double-click the name opens rename (same code path)
await run("dblclick name", {}, async (page) => {
    await page.locator(".project-btn").first().dblclick();
    await page.waitForTimeout(200);
    check(await page.locator(".board-rename").count() === 1, "dblclick: rename did not open");
});

// 8. rename then refresh keeps the new name
await run("persists across refresh", {}, async (page) => {
    await reveal(page, 2);
    await page.locator(".project-edit").nth(2).click();
    await page.waitForTimeout(150);
    await page.locator(".board-rename input").fill("Persisted");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#boards .project-btn");
    check((await page.locator("#boards").textContent()).includes("Persisted"), "refresh: name not kept");
});

await browser.close();
server.kill();
rmSync(dir, { recursive: true, force: true });

if (failures.length) {
    console.log("rename regression FAILED:");
    failures.forEach((f) => console.log("  ✗ " + f));
    process.exit(1);
}
console.log("rename regression: all checks passed");
process.exit(0);

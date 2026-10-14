// Sidebar layout-mode regression (drawer <1024 / docked >=1024), one run per
// engine, each with its own temp DATA_FILE so runs can't share state.
// Covers: live resize across the 1024 boundary, drawer open/close affordances,
// docked-collapse persistence, exact 1023/1024/1025 widths, and console errors.
import { chromium, firefox } from "playwright-core";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const CHROME = "/nix/store/6bg6ciwh50x38sca5x9zimdzqijkc8sq-playwright-chromium/chrome-linux64/chrome";
const FIREFOX = "/nix/store/q90g76a2ybhj6zxnsny6nyz9hjvzd2g4-playwright-firefox/firefox/firefox";
const PORT = 3193; // per-engine port, incremented after each engine
let nextPort = PORT;

const fixture = {
    boards: [{ id: 1, name: "Designs" }, { id: 2, name: "Branding" }],
    tasks: [{ id: 1, boardId: 1, title: "T1", status: "planned", order: 0, note: "", version: 0, updatedAt: null }],
    nextId: 2, nextBoardId: 3,
};

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

async function withServer(fn) {
    const port = nextPort++;
    const dir = mkdtempSync(path.join(tmpdir(), "mb-sidebar-"));
    const dataFile = path.join(dir, "miniboard.json");
    writeFileSync(dataFile, JSON.stringify(fixture));
    const server = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_FILE: dataFile }, stdio: "ignore" });
    // bare fetch() has no timeout; a keep-alive socket that never closes stalls
    // the readiness loop, so give each probe its own AbortController.
    for (let i = 0; i < 50; i++) {
        try {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), 500);
            const r = await fetch(`http://localhost:${port}/`, { signal: ac.signal });
            clearTimeout(t);
            if (r.ok) break;
        } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
    try { await fn(port); } finally { server.kill(); }
}

const state = (page) => page.evaluate(() => {
    const app = Alpine.$data(document.querySelector(".app"));
    const aside = document.querySelector(".sidebar");
    const menu = document.querySelector(".menu-btn");
    const backdrop = document.querySelector(".sidebar-backdrop");
    const bs = getComputedStyle(backdrop);
    return {
        layout: app.layout,
        drawerOpen: app.drawerOpen,
        docked: app.$store.mb.ui.sidebarDocked,
        asideDataOpen: aside.getAttribute("data-open"),
        asideInert: aside.hasAttribute("inert"),
        asideAriaHidden: aside.getAttribute("aria-hidden"),
        menuAriaExpanded: menu.getAttribute("aria-expanded"),
        menuVisible: menu.getBoundingClientRect().width > 0,
        backdropDisplay: bs.display,
        locked: document.documentElement.classList.contains("nav-locked"),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
});

// focus lands ~200ms after the drawer finishes its 200ms slide (index.ejs
// toggleSidebar/closeSidebar wrap .focus() in a 200ms setTimeout), so poll
// instead of asserting at a single fixed instant.
const pollFocus = (page, cls) => page.waitForFunction(
    (c) => document.activeElement && document.activeElement.classList.contains(c),
    cls,
    { timeout: 3000 },
).then(() => true).catch(() => false);

const menuClickable = async (page) => {
    // the drawer overlays the topbar while open; only assert clickability
    // when the drawer is closed (or docked). Returns { clickable, coveredBy }.
    return page.evaluate(() => {
        const menu = document.querySelector(".menu-btn");
        const r = menu.getBoundingClientRect();
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        const top = document.elementFromPoint(cx, cy);
        return {
            clickable: top === menu || menu.contains(top),
            coveredBy: top ? top.tagName + "." + (typeof top.className === "string" ? top.className.split(" ")[0] : "") : "null",
        };
    });
};

async function run(engineName, launch) {
    const browser = await launch();
    await withServer(async (port) => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        page.on("pageerror", (e) => errors.push("PAGEERR: " + e.message));
        const S = `http://localhost:${port}/`;
        const T = (msg) => { if (errors.length) failures.push(`[${engineName}] ${msg}: console errors ${JSON.stringify(errors)}`); };

        // a) load 1440 -> docked open; resize 375 -> drawer closed, menu clickable, no backdrop
        await page.goto(S, { waitUntil: "networkidle" });
        await page.waitForSelector("#boards .project-btn");
        let s = await state(page);
        check(s.layout === "docked" && s.docked === true, `a) expected docked+open at 1440, got layout=${s.layout} docked=${s.docked}`);
        await page.setViewportSize({ width: 375, height: 740 });
        await page.waitForTimeout(350);
        s = await state(page);
        const mc = await menuClickable(page);
        check(s.layout === "drawer" && s.drawerOpen === false, `a) expected drawer closed at 375, got layout=${s.layout} open=${s.drawerOpen}`);
        check(mc.clickable, `a) menu button covered at 375 (drawer closed): ${mc.coveredBy}`);
        check(s.backdropDisplay === "none", `a) backdrop visible at 375 with drawer closed: ${s.backdropDisplay}`);
        T("a");

        // b) open -> close button in viewport, backdrop present, tap backdrop closes,
        //    reopen + Escape closes, focus returns to menu button
        await page.evaluate(() => {
            const app = Alpine.$data(document.querySelector(".app"));
            window.__tlog = [];
            const orig = app.toggleSidebar.bind(app);
            app.toggleSidebar = function () {
                window.__tlog.push("toggle drawerOpen=" + app.drawerOpen + " layout=" + app.layout);
                orig();
                window.__tlog.push("after drawerOpen=" + app.drawerOpen);
            };
        });
        await page.locator(".menu-btn").click();
        await page.waitForTimeout(300);
        s = await state(page);
        const closeBtn = await page.evaluate(() => {
            const b = document.querySelector(".sidebar-close");
            const r = b.getBoundingClientRect();
            return { visible: r.width > 0 && r.height > 0, inViewport: r.x >= 0 && r.x + r.width <= window.innerWidth };
        });
        check(s.drawerOpen === true && s.backdropDisplay === "block", `b) drawer did not open at 375: open=${s.drawerOpen} backdrop=${s.backdropDisplay}`);
        check(closeBtn.visible && closeBtn.inViewport, `b) close button not usable: ${JSON.stringify(closeBtn)}`);
        check(s.locked === true, `b) page scroll not locked while drawer open`);
        check(await pollFocus(page, "sidebar-close"), `b) focus not moved into drawer on open (active=${await page.evaluate(() => document.activeElement.className || document.activeElement.tagName)} tlog=${await page.evaluate(() => JSON.stringify(window.__tlog || []))})`);
        const bt = await page.evaluate(() => {
            const bd = document.querySelector(".sidebar-backdrop");
            const r = bd.getBoundingClientRect();
            const el = document.elementFromPoint(370, 400);
            return { bdRect: { x: r.x, y: r.y, w: r.width, h: r.height }, hit370: el ? el.className || el.tagName : "none" };
        });
        await page.evaluate(() => {
            const app = Alpine.$data(document.querySelector(".app"));
            window.__clog = [];
            const orig = app.closeSidebar.bind(app);
            app.closeSidebar = function () {
                window.__clog.push("close called drawerOpen=" + app.drawerOpen);
                orig();
                window.__clog.push("after drawerOpen=" + app.drawerOpen);
                const t0 = performance.now();
                const iv = setInterval(() => {
                    const mb = document.querySelector(".menu-btn");
                    const r2 = mb.getBoundingClientRect();
                    const vis = getComputedStyle(mb).display !== "none" && r2.width > 0;
                    window.__clog.push(`t=${Math.round(performance.now() - t0)} vis=${vis} active=${document.activeElement.className || document.activeElement.tagName}`);
                    if (performance.now() - t0 > 800) clearInterval(iv);
                }, 100);
            };
        });
        await page.locator(".sidebar-backdrop").click({ position: { x: 370, y: 400 } });
        await page.waitForTimeout(1200);
        s = await state(page);
        check(s.drawerOpen === false && s.backdropDisplay === "none", `b) backdrop tap did not close drawer`);
        check(s.locked === false, `b) scroll lock not released after backdrop close`);
        check(await pollFocus(page, "menu-btn"), `b) focus did not return to menu button after backdrop close (active=${await page.evaluate(() => document.activeElement.className || document.activeElement.tagName)} clog=${await page.evaluate(() => JSON.stringify(window.__clog || []))} backdrop=${JSON.stringify(bt)})`);
        await page.locator(".menu-btn").click();
        await page.waitForTimeout(300);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        s = await state(page);
        check(s.drawerOpen === false, `b) Escape did not close drawer`);
        check(await pollFocus(page, "menu-btn"), `b) focus did not return to menu button after Escape`);
        T("b");

        // c) open drawer at 375, resize 1440 -> docked, no backdrop, not inert, board not covered
        await page.locator(".menu-btn").click();
        await page.waitForTimeout(300);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(350);
        s = await state(page);
        check(s.layout === "docked" && s.drawerOpen === false, `c) expected docked after crossing up, got layout=${s.layout} open=${s.drawerOpen}`);
        check(s.backdropDisplay === "none", `c) backdrop still shown in docked mode: ${s.backdropDisplay}`);
        check(s.asideInert === false && s.asideAriaHidden !== "true", `c) docked sidebar still inert/aria-hidden`);
        const covered = await page.evaluate(() => {
            const board = document.querySelector("#board");
            const r = board.getBoundingClientRect();
            const el = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 200));
            return el && !board.contains(el) ? el.tagName + "." + (typeof el.className === "string" ? el.className.split(" ")[0] : "") : null;
        });
        check(covered === null, `c) board covered by ${covered} in docked mode`);
        T("c");

        // d) collapse at 1440, reload -> still collapsed; load at 375 with that
        //    stored value -> drawer closed; resize 1440 -> collapsed respected
        await page.locator(".menu-btn").click(); // collapse docked sidebar
        await page.waitForTimeout(300);
        check((await state(page)).docked === false, `d) menu button did not collapse docked sidebar`);
        await page.reload({ waitUntil: "networkidle" });
        // the docked sidebar is collapsed after reload, so #boards is hidden —
        // wait on the store (read synchronously off the Alpine component)
        // instead of a selector that can never become visible.
        await page.waitForFunction(() => Alpine && Alpine.store && Alpine.store("mb") && Alpine.store("mb").ui && typeof Alpine.store("mb").ui.sidebarDocked !== "undefined");
        s = await state(page);
        check(s.layout === "docked" && s.docked === false && s.asideDataOpen === "false", `d) collapsed state not restored after reload: layout=${s.layout} docked=${s.docked}`);
        await page.setViewportSize({ width: 375, height: 740 });
        await page.waitForTimeout(350);
        s = await state(page);
        check(s.layout === "drawer" && s.drawerOpen === false, `d) stored collapsed value leaked into drawer mode at 375: open=${s.drawerOpen}`);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(350);
        s = await state(page);
        check(s.layout === "docked" && s.docked === false && s.asideDataOpen === "false", `d) collapsed state not respected after crossing back up: docked=${s.docked}`);
        T("d");

        // restore docked-open for the width sweep
        await page.locator(".menu-btn").click();
        await page.waitForTimeout(250);

        // e) exact widths 1023/1024/1025: layout mode + no horizontal overflow
        for (const w of [1023, 1024, 1025]) {
            await page.setViewportSize({ width: w, height: 900 });
            await page.waitForTimeout(300);
            s = await state(page);
            const want = w >= 1024 ? "docked" : "drawer";
            check(s.layout === want, `e) width ${w}: expected layout ${want}, got ${s.layout}`);
            check(s.overflowX === false, `e) width ${w}: horizontal overflow (scrollWidth > innerWidth)`);
        }
        T("e");
    });
    await browser.close();
}

await run("chromium", () => chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] }));
await run("firefox", () => firefox.launch({ executablePath: FIREFOX }));

if (failures.length) {
    console.log("sidebar regression FAILED:");
    failures.forEach((f) => console.log("  ✗ " + f));
    process.exit(1);
}
console.log("sidebar regression: all checks passed");
process.exit(0);

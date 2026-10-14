// test/icons.test.js — icon sprite, helper, and glyph-guard tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import app from "../src/app.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, exts, out = []) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === "node_modules" || name === "screenshots") continue;
            walk(full, exts, out);
        } else if (exts.some((e) => name.endsWith(e))) {
            out.push(full);
        }
    }
    return out;
}

const sprite = readFileSync(path.join(root, "src/views/partials/icon-sprite.ejs"), "utf8");
const spriteNames = new Set([...sprite.matchAll(/id="i-([^"]+)"/g)].map((m) => m[1]));

test("sprite exists and has no <title>", () => {
    assert.ok(spriteNames.size > 0, "sprite should contain at least one symbol");
    assert.ok(!sprite.includes("<title"), "sprite must not contain <title>");
});

test("app.locals.icon works for every sprite name", () => {
    for (const name of spriteNames) {
        const html = app.locals.icon(name);
        assert.ok(html.includes(`#i-${name}`), `icon(${name}) should reference its symbol`);
    }
});

test("app.locals.icon throws for unknown name", () => {
    assert.throws(() => app.locals.icon("does-not-exist"), /unknown name/);
    assert.throws(() => app.locals.icon(""), /unknown name/);
    assert.throws(() => app.locals.icon("menu"), /unknown name/); // must be menu-outline
});

test("every icon() call in ejs views exists in the sprite", () => {
    const views = walk(path.join(root, "src/views"), [".ejs"]);
    let calls = 0;
    for (const file of views) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/icon\(["']([^"']+)["']\)/g)) {
            calls++;
            assert.ok(spriteNames.has(m[1]), `${path.relative(root, file)}: icon("${m[1]}") not in sprite`);
        }
    }
    assert.ok(calls > 0, "expected at least one icon() call in views");
});

test("every Icon() call in public js exists in the sprite", () => {
    const files = walk(path.join(root, "public"), [".js"]);
    for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/Icon\(["']([^"']+)["']\)/g)) {
            assert.ok(spriteNames.has(m[1]), `${path.relative(root, file)}: Icon("${m[1]}") not in sprite`);
        }
    }
});

test("no ion-icon / CDN / leftover glyph usage in src or public", () => {
    const files = [
        ...walk(path.join(root, "src"), [".ejs", ".js", ".css"]),
        ...walk(path.join(root, "public"), [".js", ".css"]),
    ];
    const blocklist = /<ion-icon|ionicons\.esm\.js|<script[^>]*(?:unpkg\.com|jsdelivr)|<link[^>]*(?:unpkg\.com|jsdelivr)|☰|✕|✖|✓|✎|▾|▸|⋮|&times;/;
    for (const file of files) {
        const src = readFileSync(file, "utf8");
        const m = src.match(blocklist);
        assert.equal(m, null, `${path.relative(root, file)}: forbidden token "${m && m[0]}"`);
    }
});

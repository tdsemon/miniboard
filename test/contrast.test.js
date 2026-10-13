// Contrast gate for the token layer (stage 1).
//
// Approach (per review note): the CHECKED PAIRS are listed explicitly here;
// their VALUES are parsed from style.css and every var() chain is resolved
// recursively before checking, so hexes live in exactly one place (the CSS).
// light-dark(a, b) is split into its two sides and each theme is asserted.
//
// Thresholds: 4.5 for text pairs (WCAG AA normal text); --accent on
// --surface is asserted at 4.5 because it IS used as text (.has-note,
// active board name) which also covers its >= 3 UI role.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(dir, "..", "public", "style.css"), "utf8");

const PAIRS = [
    ["--text", "--bg", 4.5],
    ["--text", "--surface", 4.5],
    ["--text-muted", "--surface", 4.5],
    ["--text", "--surface-muted", 4.5], // table hover, tabs container, pills
    ["--on-accent", "--accent", 4.5],
    ["--accent", "--surface", 4.5],
    ["--accent", "--accent-soft", 4.5], // active sidebar item, banner text
    ["--danger", "--surface", 4.5],
    ["--on-inverse", "--surface-inverse", 4.5], // toast text both themes
];

// Every custom property declared in any :root block.
function parseTokens(source) {
    const tokens = {};
    for (const block of source.matchAll(/:root(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) {
        for (const decl of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
            tokens[decl[1]] = decl[2].trim();
        }
    }
    return tokens;
}

// Expand var(--x) chains recursively (cycle-guarded) so light-dark() sees
// literal values before it gets split.
function resolveValue(tokens, value, depth = 0) {
    assert.ok(depth < 10, `var() cycle while resolving: ${value}`);
    return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => {
        assert.ok(name in tokens, `unknown token referenced: ${name}`);
        return resolveValue(tokens, tokens[name], depth + 1);
    });
}

// Split on the first TOP-LEVEL comma (values like shadows contain commas
// inside rgba()).
function splitTopLevel(value) {
    let depth = 0;
    for (let i = 0; i < value.length; i++) {
        const c = value[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "," && depth === 0) return [value.slice(0, i).trim(), value.slice(i + 1).trim()];
    }
    return null;
}

function themeSides(tokens, name) {
    assert.ok(name in tokens, `token not defined: ${name}`);
    const resolved = resolveValue(tokens, tokens[name]);
    if (resolved.startsWith("light-dark(") && resolved.endsWith(")")) {
        const parts = splitTopLevel(resolved.slice("light-dark(".length, -1));
        assert.ok(parts, `malformed light-dark() for ${name}: ${resolved}`);
        return { light: parts[0], dark: parts[1] };
    }
    return { light: resolved, dark: resolved };
}

function toRgb(hex) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    assert.match(h, /^[0-9a-f]{6}$/i, `not a plain hex colour (unresolved var?): ${hex}`);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function channelLuminance(c) {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
    const [r, g, b] = toRgb(hex).map(channelLuminance);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
}

const tokens = parseTokens(css);

test("checked tokens exist and are light-dark() pairs (one source per theme)", () => {
    for (const [fg, bg] of PAIRS) {
        for (const name of new Set([fg, bg])) {
            assert.ok(name in tokens, `token not defined: ${name}`);
            assert.match(tokens[name], /^light-dark\(/, `${name} must be a light-dark() pair, got: ${tokens[name]}`);
        }
    }
});

for (const theme of ["light", "dark"]) {
    test(`WCAG AA contrast in the ${theme} theme`, () => {
        for (const [fgName, bgName, min] of PAIRS) {
            const fg = themeSides(tokens, fgName)[theme];
            const bg = themeSides(tokens, bgName)[theme];
            const ratio = contrast(fg, bg);
            assert.ok(
                ratio >= min,
                `${fgName} (${fg}) on ${bgName} (${bg}) = ${ratio.toFixed(2)}:1, need >= ${min}:1 in ${theme}`,
            );
        }
    });
}

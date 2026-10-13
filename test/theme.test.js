// theme.js is a CLASSIC script (no export/import — see classic-scripts.test.js).
// Load it with node:vm in a fake browser sandbox and pull the helpers off
// window. The store half registers on alpine:init and needs a real browser;
// its pure decision logic is exactly resolveTheme/normalizeStored below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = readFileSync(path.join(dir, "..", "public", "theme.js"), "utf8");

const sandbox = {
    window: {
        matchMedia: () => ({ matches: false, addEventListener() {} }),
        localStorage: {
            store: {},
            getItem(k) { return this.store[k] ?? null; },
            setItem(k, v) { this.store[k] = String(v); },
            removeItem(k) { delete this.store[k]; },
        },
        addEventListener() {},
        setTimeout() {},
        innerWidth: 1280,
        innerHeight: 800,
    },
    document: {
        addEventListener() {},
        querySelector() { return null; },
        documentElement: {},
    },
    console,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "theme.js" });

const { resolveTheme, normalizeStored } = sandbox.window;

test("theme.js attaches its helpers to window (classic script)", () => {
    assert.equal(typeof resolveTheme, "function");
    assert.equal(typeof normalizeStored, "function");
});

test("a stored choice wins over the system", () => {
    assert.equal(resolveTheme("dark", false), "dark");
    assert.equal(resolveTheme("light", true), "light");
});

test("no stored choice follows the system", () => {
    assert.equal(resolveTheme(null, true), "dark");
    assert.equal(resolveTheme(null, false), "light");
});

test("an invalid stored value is ignored — system stays the default", () => {
    assert.equal(resolveTheme("purple", true), "dark");
    assert.equal(resolveTheme("", false), "light");
    assert.equal(resolveTheme(undefined, true), "dark");
});

test("normalizeStored drops anything that isn't light/dark", () => {
    assert.equal(normalizeStored("light"), "light");
    assert.equal(normalizeStored("dark"), "dark");
    assert.equal(normalizeStored("purple"), null);
    assert.equal(normalizeStored(null), null);
    assert.equal(normalizeStored(""), null);
});

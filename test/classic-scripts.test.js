// Permanent guard (stage 1 fix, applies to stage 3's spring.js too):
// every <script src> in index.ejs that is NOT type="module" loads as a
// CLASSIC script, so it must contain no top-level export/import — a stray
// `export` is a syntax error in the browser, and node --check won't catch
// it because the file never gets parsed as an entry point. Comments and
// string literals are stripped first so words like "important" in minified
// vendor code can't false-positive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const index = readFileSync(path.join(dir, "..", "src", "views", "index.ejs"), "utf8");

const classicScripts = [...index.matchAll(/<script\b([^>]*)>/g)]
    .map((m) => m[1])
    .filter((attrs) => !/type\s*=\s*["']module["']/.test(attrs))
    .map((attrs) => /src\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1])
    .filter(Boolean);

function stripCommentsAndStrings(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

test("index.ejs loads classic scripts (sanity: the guard sees something)", () => {
    assert.ok(classicScripts.length >= 5, `found: ${classicScripts.join(", ")}`);
    assert.ok(classicScripts.includes("/theme.js"));
    assert.ok(classicScripts.includes("/dnd.js"));
});

for (const src of classicScripts) {
    test(`classic script ${src} has no top-level export/import`, () => {
        const file = path.join(dir, "..", "public", src.replace(/^\//, ""));
        assert.ok(existsSync(file), `missing file for ${src}: ${file}`);
        const stripped = stripCommentsAndStrings(readFileSync(file, "utf8"));
        assert.ok(!/\bexport\b/.test(stripped), `${src} contains "export" but loads as a classic script`);
        assert.ok(!/\bimport\b/.test(stripped), `${src} contains "import" but loads as a classic script`);
    });
}

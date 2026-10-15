# Miniboard

A small kanban board: HTMX for HTML over the wire, Alpine.js for client state,
Express + EJS on the server. Cards drag between columns, notes autosave with
optimistic-concurrency conflict handling, and unfinished work survives a closed
tab via localStorage drafts.

## Run

```sh
nix develop        # nodejs 22 + npm
npm install
npm run dev        # http://localhost:3000  (nodemon)
npm test           # node:test, no framework
PORT=8080 npm run dev   # optional: PORT overrides the default 3000
DATA_FILE=/tmp/mb.json npm run dev  # optional: data file path (default data/miniboard.json)
```

No build step. Client libraries are vendored under `public/vendor` (htmx 2.0.4,
Alpine 3.17.4, its persist plugin, SortableJS 1.15.6) and served by
`express.static` — nothing is fetched from a CDN at runtime. Icons are ionicons
8.0.13 (MIT), inlined as a sprite at build time (`npm run icons`, committed
output); see `public/vendor/ionicons-LICENSE.txt`.

Data lives in one JSON file (`data/miniboard.json`, gitignored; override with
`DATA_FILE`). Every mutation schedules a debounced (~200ms) atomic write
(temp file + rename), and SIGINT/SIGTERM flush before exit. A missing file
seeds the three demo boards; a corrupt one is renamed to
`miniboard.json.bak-<timestamp>`, warned about once, and reseeded — the
server never crashes on a bad file. Tests point `DATA_FILE` at a temp dir.

## Layout

```
server.js                 entry point, listens on PORT (default 3000)
src/app.js                express app: static files, ejs, routes
src/routes/boards.js      GET /boards, /boards/:id (view fragments);
                          POST /boards (add), /boards/:id (rename);
                          DELETE /boards/:id (blocks the last board)
src/routes/board.js       POST /tasks/:id/move; DELETE /tasks/:id (both view-aware)
src/routes/tasks.js       POST /tasks (add, takes boardId)
src/routes/notes.js       GET/POST /tasks/:id/notes, GET /tasks/:id/notes/current
src/data/tasks.js         boards, tasks, notes, versioning; JSON persistence
src/data/miniboard.json   the data file (gitignored; override with DATA_FILE)
src/views/index.ejs       page shell, notes drawer, script tags
src/views/partials/       boards, board, banner, column, card, table, list,
                          move-select, notes-panel, note-status,
                          note-conflict, note-current, announce
public/dnd.js             x-sortable directive, move queue, alt+arrow reorder
public/notes.js           notes drawer: status machine, drafts, conflict
public/drafts.js          pure draft logic (imported by node:test)
public/style.css          all styling, css custom properties in :root
test/                     node:test suites
```

## Contracts

**Boards & views** — every board has three views, all rendered server-side into
the same `#board` element: `?view=board` (columns), `table` (sortable via
`?sort=title|status|note|order&dir=asc|desc`) and `list` (grouped rows).
`?q=` filters any view. The client keeps `activeBoardId`, `view`, `sort` and
`dir` in the persisted `miniboard:ui` store and builds the URL in one place
(`refreshBoard` in notes.js), so a reload lands on the same board + view.
`DELETE /boards/:id` refuses the last board, deletes its tasks, and echoes
`data-removed-task-ids` so the client drops those tasks' drafts. The sidebar
nav (`GET /boards`) is swapped whole by add/rename/delete; the active marker
reads the Alpine store, not server state.

**Move** — `POST /tasks/:id/move` with `toColumn` (required, 400 without it)
and `toIndex` (optional integer, clamped by the server). The response is the
column the card came *from* (swap it with `outerHTML`), plus an out-of-band
swap of the destination column when it changed, plus an aria-live announce
div. Within-column moves announce `position N of M`; cross-column ones name
the destination column. Drag, the move select and alt+arrow all use this one
endpoint. A request from the Table or List view also sends `view` (+ `sort`,
`dir`, `q`); the server then re-renders that view into `#board` instead of the
column fragments. A move never crosses boards.

**Notes** — `POST /tasks/:id/notes` with `note` and `version` (the version the
textarea was loaded with; missing or non-numeric is a 400). 200 returns an
out-of-band hidden version input. 409 returns `partials/note-conflict` with the
server's text (escaped), `data-version` and `data-updated-at`, and changes
nothing. `GET /tasks/:id/notes/current` returns the server's current copy as a
fragment for "take server".

**Drafts** (localStorage, `miniboard:drafts`) — every keystroke writes a draft
{text, baseVersion}. A save where the text matches the textarea deletes it.
On open, the draft is compared to the server: same base version prompts to
restore; older than the server raises the conflict bar; newer means the server
was reset and prompts anyway; equal text drops the stale draft. Closing the
drawer never discards a draft.

**Conflict** — either a 409 mid-save or an open whose draft is older than the
server. One bar, two actions: *keep mine* rewrites the version input to the
server's and saves (overwriting the server), *take server* re-fetches
`/notes/current` into the textarea and drops the draft. The textarea is
read-only while the bar is up, autosave stops, and closing the drawer keeps
the draft and the continue-banner state.

**Resume** — `miniboard:ui` stores the open task, cursor, scroll position, the
last-edited snippet (with its board id) and the current board + view, so a
reload or a closed tab reopens the drawer where it was and the continue banner
offers a one-click return — switching boards first if the note lives elsewhere.

## Design system

All styling lives in `public/style.css`. Components reference **only** the
semantic token layer declared in `:root` — primitives (`--n-*`, `--indigo-*`,
`--s-*`, `--r-*`, `--fs-*`) are the raw values, semantic tokens (`--bg`,
`--surface*`, `--text*`, `--accent*`, `--shadow-*`, `--focus-ring`) are what
components use. Colour primitives are never referenced outside `:root`
(enforced by review; `test/contrast.test.js` parses `:root` and fails on an
unresolved `var()` chain).

Both themes come from one declaration per token via `light-dark(light, dark)`.
Which side applies is decided by `color-scheme`, which the `data-theme`
mechanism sets — there is no second set of rules per theme.

**Adding a themed colour:** add the primitive under `--- primitives ---`, add
one semantic token under `--- semantic ---` using `light-dark()`, then use only
the semantic name. Add the new pair to `PAIRS` in `test/contrast.test.js` so
the gate checks it in both themes.

**Scales:** spacing `--s-1..6` (4→32px), radii `--r-sm..xl` + `--r-full`,
type `--fs-xs..xl` each paired with its own `--lh-*`, weights `--fw-regular|
medium|semibold`, motion `--dur-1|2|3` + `--ease-out`, icons `--icon-sm|md|lg`.
Layout constants `--sidebar-width`, `--topbar-height`, `--notes-width`.
Breakpoints are the two in use: `639px` (phone) and `1023px`/`1024px`
(desktop starts).

**Focus:** one `:focus-visible` rule draws the ring (`--focus-ring`) for every
interactive element. Components do not declare their own outline.

**Motion:** every animation and transition sits inside
`@media (prefers-reduced-motion: no-preference)`. A single
`@media (prefers-reduced-motion: reduce)` rule collapses all durations and
kills transforms, so an animation added later is opted out automatically.

**Forced colors:** `@media (forced-colors: active)` at the end of the file
gives shape/border fallbacks to anything that was told apart by colour alone
(status dots, pills, hover, focus, the open-card ring).

**Icons:** `app.locals.icon(name)` / `window.Icon(name)` render an `<svg
use>` pointing at the sprite (`src/views/partials/icon-sprite.ejs`, generated
by `npm run icons`). Print it unescaped — `<%- icon("name") %>`, never `<%=
%>` — and never inject it through `x-html`.

## Known gaps

- **Single process only** — the JSON file is written with atomic renames, but two servers sharing one `DATA_FILE` would overwrite each other.
- **Debounced writes** — a hard kill (SIGKILL, power loss) can lose the last ~200ms of edits; only SIGINT/SIGTERM flush first.
- **Single user** — no accounts, no sharing, no realtime sync beyond the two-tab localStorage rules.
- **Plain-text notes** — no markdown rendering or preview.
- **No automated browser tests for interaction** — node:test covers the
  server, persistence and the pure draft logic; `test/icons.visual.test.js`
  uses Playwright for icon/markup rendering only. Drag, alt+arrow and the
  drawer flows are checked by hand.
- **Single-tab-wins UI state** — the focused tab ignores the others, so a second tab cannot steal the open note.

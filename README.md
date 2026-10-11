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
```

No build step. Client libraries are vendored under `public/vendor` (htmx 2.0.4,
Alpine 3.17.4, its persist plugin, SortableJS 1.15.6) and served by
`express.static` — nothing is fetched from a CDN at runtime.

## Layout

```
server.js                 entry point, listens on :3000
src/app.js                express app: static files, ejs, routes
src/routes/board.js       GET /board, /search; POST /tasks/:id/move; DELETE /tasks/:id
src/routes/tasks.js       POST /tasks (add)
src/routes/notes.js       GET/POST /tasks/:id/notes, GET /tasks/:id/notes/current
src/data/tasks.js         in-memory data: tasks, notes, versioning
src/views/index.ejs       page shell, notes drawer, script tags
src/views/partials/       board, column, card, notes-panel, note-status,
                          note-conflict, note-current, announce
public/dnd.js             x-sortable directive, move queue, alt+arrow reorder
public/notes.js           notes drawer: status machine, drafts, conflict
public/drafts.js          pure draft logic (imported by node:test)
public/style.css          all styling, css custom properties in :root
test/                     node:test suites
```

## Contracts

**Move** — `POST /tasks/:id/move` with `toColumn` (required, 400 without it)
and `toIndex` (optional integer, clamped by the server). The response is the
column the card came *from* (swap it with `outerHTML`), plus an out-of-band
swap of the destination column when it changed, plus an aria-live announce
div. Within-column moves announce `position N of M`; cross-column ones name
the destination column. Drag, the move select and alt+arrow all use this one
endpoint.

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

**Resume** — `miniboard:ui` stores the open task, cursor, scroll position and
the last-edited snippet, so a reload or a closed tab reopens the drawer where
it was and the continue banner offers a one-click return.

// Alpine directive: x-sortable — wires SortableJS into each .cards list.
// Registered on alpine:init so it runs before Alpine initializes; Alpine's
// MutationObserver re-runs init on every htmx-swapped column, and the
// cleanup callback destroys the old Sortable instance.
document.addEventListener("alpine:init", () => {
    // A missing library should cost us drag-and-drop, not the whole page:
    // skip registering the directive and let the other alpine directives run.
    if (typeof Sortable === "undefined") {
        console.error(
            "SortableJS is missing — drag-and-drop is disabled. " +
            "Check that /vendor/Sortable.min.js loads (public/vendor/, served by express.static)."
        );
        return;
    }
    Alpine.directive("sortable", (el, {}, { cleanup }) => {
        const sortable = Sortable.create(el, {
            group: "miniboard",          // shared: drag across columns + reorder
            draggable: ".card",          // add-form is not a .card, never draggable
            animation: 150,
            ghostClass: "card-ghost",    // placeholder left in the target slot
            chosenClass: "card-chosen",  // card being picked up
            dragClass: "card-drag",
            filter: "button, .card-action, select", // Note / X / move-select don't start a drag
            preventOnFilter: false,                // but their clicks still work
            // touch only: a quick swipe scrolls the lane, a press-hold drags
            delay: 150,
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            // horizontal lane autoscroll while dragging
            scrollSensitivity: 40,
            scrollSpeed: 12,
            onEnd(evt) {
                if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
                queueMove(evt);
            },
        });
        cleanup(() => sortable.destroy());
    });
});

// Serialize moves: they are index-based, so they must reach the server in the
// order they happened on screen (aborting a stale move would leave the next
// one's index computed against state the server never saw).
let chain = Promise.resolve();

// Bumped on failure: queued moves captured the old generation and skip
// themselves, so stale indexes are never replayed against the server.
let gen = 0;

// ids whose move should put focus back on the card (alt+arrow reorder, so the
// shortcut chains) instead of the move select (drag and select-initiated moves)
const focusCardAfter = new Set();

function queueMove(evt) {
    const id = evt.item.id.replace(/^card-/, "");
    const toColumn = evt.to.id.replace(/^col-/, "");
    const myGen = gen;
    chain = chain
        .then(() => {
            if (myGen !== gen) return; // queue was cleared by a failure
            return htmx.ajax("POST", `/tasks/${id}/move`, {
                target: evt.from.closest(".column"),
                swap: "outerHTML",
                values: { toColumn, toIndex: String(evt.newIndex) },
            });
        })
        .catch(() => failMove());
}

// One failed move invalidates everything queued behind it: those drops were
// indexed against a DOM state the server never saw. Drop the queue, re-fetch
// the current board view (server truth) and start over.
function failMove() {
    gen++;
    chain = Promise.resolve();
    focusCardAfter.clear();
    Alpine.store("mb").refresh();
    showToast("Move failed, card put back");
    announce("Move failed, card put back");
}

// alt+ArrowUp / alt+ArrowDown on a focused card (or anything inside it) moves
// it one slot within its column. Same endpoint as drag; the index comes from
// the DOM, which is where the user is looking. Cards are tabindex="-1", so
// this is how keyboard users reorder without the move select.
document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const card = e.target?.closest?.(".card");
    const list = card?.closest?.(".cards");
    if (!card || !list) return;
    const cards = [...list.children].filter((el) => el.classList.contains("card"));
    const from = cards.indexOf(card);
    const to = from + (e.key === "ArrowDown" ? 1 : -1);
    if (from < 0 || to < 0 || to >= cards.length) return; // already at the edge
    e.preventDefault();
    focusCardAfter.add(card.id.replace(/^card-/, ""));
    queueMove({ item: card, from: list, to: list, newIndex: to });
});

// The move response swaps whole columns away, destroying whatever was focused
// in them. Put focus back once the new markup has settled: the card for an
// alt+arrow reorder, the move select otherwise (drag, dropdown).
document.addEventListener("htmx:afterSettle", (e) => {
    const path = e.detail?.xhr?.responseURL ?? "";
    const id = path.match(/\/tasks\/(\d+)\/move/)?.[1];
    if (!id) return;
    if (focusCardAfter.delete(id)) document.getElementById(`card-${id}`)?.focus();
    else document.getElementById(`move-${id}`)?.focus();
});

let toastEl;
function showToast(msg) {
    if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.className = "toast";
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("toast-show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toastEl.classList.remove("toast-show"), 3000);
}

function announce(msg) {
    const region = document.getElementById("move-status");
    if (region) region.textContent = msg;
}

// Alpine directive: x-sortable — wires SortableJS into each .cards list.
// Registered on alpine:init so it runs before Alpine initializes; Alpine's
// MutationObserver re-runs init on every htmx-swapped column, and the
// cleanup callback destroys the old Sortable instance.
document.addEventListener("alpine:init", () => {
    Alpine.directive("sortable", (el, {}, { cleanup }) => {
        const sortable = Sortable.create(el, {
            group: "miniboard",          // shared: drag across columns + reorder
            draggable: ".card",          // add-form is not a .card, never draggable
            animation: 150,
            ghostClass: "card-ghost",    // placeholder left in the target slot
            chosenClass: "card-chosen",  // card being picked up
            dragClass: "card-drag",
            filter: "button, .card-action, select", // → / X / move-select don't start a drag
            preventOnFilter: false,                // but their clicks still work
            onEnd(evt) {
                if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
                queueMove(evt);
            },
        });
        cleanup(() => sortable.destroy());
    });
});

// Serialize drops: moves are index-based, so they must reach the server in
// the order they happened on screen (aborting a stale drop would leave the
// next drop's index computed against state the server never saw).
let chain = Promise.resolve();

// Bumped on failure: queued moves captured the old generation and skip
// themselves, so stale indexes are never replayed against the server.
let gen = 0;

// id -> { fromKey, oldIndex } for in-flight moves (failure handling keys off it)
const pending = new Map();

function queueMove(evt) {
    const id = evt.item.id.replace(/^card-/, "");
    const toColumn = evt.to.id.replace(/^col-/, "");
    const toIndex = evt.newIndex;
    const myGen = gen;
    // temporary failure injection: open the page as /?fail=1
    // (test scaffolding, remove in step 8)
    const forceFail = new URLSearchParams(location.search).has("fail");

    pending.set(id, {});
    chain = chain
        .then(() => {
            if (myGen !== gen) return; // queue was cleared by a failure
            return htmx.ajax("POST", `/tasks/${id}/move`, {
                target: evt.to.closest(".column"),
                swap: "outerHTML",
                values: { toColumn, toIndex: String(toIndex), ...(forceFail ? { forceFail: "1" } : {}) },
            });
        })
        .then(() => pending.delete(id))
        .catch(() => failMove());
}

// One failed move invalidates everything queued behind it: those drops were
// indexed against a DOM state the server never saw. Drop the queue, re-fetch
// the columns (GET /board) so the DOM matches server truth, and start over.
function failMove() {
    gen++;
    chain = Promise.resolve();
    pending.clear();
    htmx.ajax("GET", "/board", { target: "#board", swap: "innerHTML" });
    showToast("Move failed, card put back");
    announce("Move failed, card put back");
}

// The move response swaps whole columns away, destroying the select that was
// focused/dragged from. After every successful move, re-focus the moved
// card's select so keyboard users keep their place. Fires for drag and
// keyboard moves alike (both go through POST /tasks/:id/move).
document.addEventListener("htmx:afterSettle", (e) => {
    const path = e.detail?.xhr?.responseURL ?? "";
    const id = path.match(/\/tasks\/(\d+)\/move/)?.[1];
    if (!id) return;
    document.getElementById(`move-${id}`)?.focus();
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

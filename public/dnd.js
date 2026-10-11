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
            filter: "button, .card-action", // → / X don't start a drag
            preventOnFilter: false,          // but their clicks still work
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

// id -> { fromKey, oldIndex } for in-flight moves, used to snap back on error
const pending = new Map();

function queueMove(evt) {
    const id = evt.item.id.replace(/^card-/, "");
    const toColumn = evt.to.id.replace(/^col-/, "");
    const fromKey = evt.from.id.replace(/^col-/, "");
    const toIndex = evt.newIndex;
    const meta = { fromKey, oldIndex: evt.oldIndex };
    // temporary failure injection: open the page as /?fail=1
    const forceFail = new URLSearchParams(location.search).has("fail");

    pending.set(id, meta);
    chain = chain
        .then(() =>
            htmx.ajax("POST", `/tasks/${id}/move`, {
                target: evt.to.closest(".column"),
                swap: "outerHTML",
                values: { toColumn, toIndex: String(toIndex), ...(forceFail ? { forceFail: "1" } : {}) },
            })
        )
        .then(() => pending.delete(id))
        .catch(() => failMove(id));
}

function failMove(id) {
    const meta = pending.get(id);
    pending.delete(id);
    if (!meta) return; // already handled by the event listener (or vice versa)
    snapBack(id, meta);
}

function snapBack(id, { fromKey, oldIndex }) {
    const card = document.getElementById(`card-${id}`);
    const col = document.querySelector(`#col-${fromKey}`); // fresh lookup: an earlier OOB swap may have replaced evt.from
    if (card && col) {
        const cards = [...col.querySelectorAll(".card")];
        col.insertBefore(card, cards[oldIndex] ?? null);
    }
    // ponytail: column counts go stale after a manual snap-back; next successful server response re-renders them
    showToast("Move failed — card put back");
}

for (const type of ["htmx:responseError", "htmx:sendError"]) {
    document.addEventListener(type, (e) => {
        const path = e.detail?.requestConfig?.path ?? "";
        const id = path.match(/\/tasks\/(\d+)\/move/)?.[1];
        if (id) failMove(id);
    });
}

let toastEl;
function showToast(msg) {
    if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.className = "toast";
        toastEl.setAttribute("role", "status");
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("toast-show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toastEl.classList.remove("toast-show"), 3000);
}

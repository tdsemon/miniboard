// public/theme.js — theme store (Alpine.store("theme")) + the switch animation.
// CLASSIC script (no export/import — see test/classic-scripts.test.js):
// helpers attach to window, the store registers on alpine:init like notes.js.
// Loaded with defer, before alpine.min.js.
//
// Contract: value = the stored choice or null (= follow the OS). A stored
// choice only ever comes from an explicit user toggle; an invalid stored
// value is ignored and cleared. effective = value ?? system.

function resolveTheme(stored, systemDark) {
    if (stored === "light" || stored === "dark") return stored;
    return systemDark ? "dark" : "light";
}

function normalizeStored(value) {
    return value === "light" || value === "dark" ? value : null;
}

window.resolveTheme = resolveTheme;
window.normalizeStored = normalizeStored;

const KEY = "miniboard:theme";
const systemQuery = window.matchMedia("(prefers-color-scheme: dark)");
const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function readStored() {
    try {
        return normalizeStored(window.localStorage.getItem(KEY));
    } catch (e) {
        return null;
    }
}

function persist(value) {
    try {
        if (value === null) window.localStorage.removeItem(KEY);
        else window.localStorage.setItem(KEY, value);
    } catch (e) {
        /* private mode / quota: theme still applies, just not remembered */
    }
}

function setMeta(effective) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = effective === "dark" ? "#0f1117" : "#ffffff";
}

// Circular reveal from the clicked element when the browser supports view
// transitions and motion is allowed; otherwise instant switch (+ a 250ms
// .theme-fade colour fade, skipped under reduced motion).
function changeTheme(change, sourceEl) {
    const reduce = reduceQuery.matches;

    if (typeof document.startViewTransition === "function" && !reduce) {
        let x = window.innerWidth / 2;
        let y = window.innerHeight / 2;
        if (sourceEl && typeof sourceEl.getBoundingClientRect === "function") {
            const rect = sourceEl.getBoundingClientRect();
            if (rect.width || rect.height) {
                x = rect.left + rect.width / 2;
                y = rect.top + rect.height / 2;
            }
        }
        const radius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y),
        );
        try {
            // data-theme flips synchronously inside this callback, so the
            // new snapshot is captured with the new theme already applied.
            const transition = document.startViewTransition(() => {
                change();
            });
            transition.ready
                .then(() => {
                    document.documentElement.animate(
                        [
                            { clipPath: `circle(0px at ${x}px ${y}px)` },
                            { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
                        ],
                        {
                            duration: 450,
                            easing: "cubic-bezier(0.2, 0, 0, 1)",
                            pseudoElement: "::view-transition-new(root)",
                        },
                    );
                })
                .catch(() => {
                    /* transition aborted (spam clicks): theme already set */
                });
            return;
        } catch (e) {
            /* startViewTransition refused: fall through to the instant path */
        }
    }

    if (reduce) {
        change();
        return;
    }
    const root = document.documentElement;
    root.classList.add("theme-fade");
    void root.offsetWidth; // arm the transition before the colours change
    change();
    window.setTimeout(() => root.classList.remove("theme-fade"), 250);
}

// Store registers on alpine:init — Alpine fires that when alpine.min.js
// starts, which is after this defer script has run (same ordering notes.js
// relies on), so the topbar toggle can use $store.theme from first render.
document.addEventListener("alpine:init", () => {
    Alpine.store("theme", {
        value: readStored(), // null = follow the OS
        systemDark: systemQuery.matches,

        get effective() {
            return resolveTheme(this.value, this.systemDark);
        },

        set(theme, sourceEl) {
            if (theme !== "light" && theme !== "dark") return;
            this.value = theme;
            persist(theme);
            changeTheme(() => this.apply(), sourceEl);
        },

        toggle(sourceEl) {
            this.set(this.effective === "dark" ? "light" : "dark", sourceEl);
        },

        apply() {
            const rootEl = document.documentElement;
            if (this.value === null) delete rootEl.dataset.theme;
            else rootEl.dataset.theme = this.value;
            setMeta(this.effective);
        },
    });

    const theme = Alpine.store("theme");

    // OS theme changed: only relevant while we follow the system.
    systemQuery.addEventListener("change", (event) => {
        if (theme.value !== null) return;
        theme.systemDark = event.matches;
        theme.apply();
    });

    // Another tab toggled (or cleared) the theme.
    window.addEventListener("storage", (event) => {
        if (event.key !== KEY) return;
        const next = normalizeStored(event.newValue);
        if (event.newValue !== null && next === null) persist(null); // invalid: clear it
        theme.value = next;
        theme.apply();
    });
});

// icons.js — classic script, no export. Provides window.Icon(name) so
// client-side markup (toasts, notes status swaps, any JS-built HTML) can
// reference the same sprite the server templates use. The sprite is inlined
// once in index.ejs (outside #board / #notes-drawer), so an htmx swap never
// removes it. Unknown names throw — same contract as app.locals.icon.
(function () {
    var ICONS = {
        "menu-outline": 1, "close-outline": 1, "pencil-outline": 1, "trash-outline": 1,
        "document-text-outline": 1, "sunny-outline": 1, "moon-outline": 1, "search-outline": 1,
        "add-outline": 1, "grid-outline": 1, "list-outline": 1, "albums-outline": 1,
        "chevron-up-outline": 1, "chevron-down-outline": 1, "swap-vertical-outline": 1,
        "checkmark-outline": 1, "alert-circle-outline": 1, "cloud-done-outline": 1,
        "sync-outline": 1, "cloud-offline-outline": 1, "arrow-undo-outline": 1, "reload-outline": 1,
    };
    window.Icon = function (name) {
        if (!ICONS[name]) {
            throw new Error('Icon(): unknown name "' + name + '" — check public/icons.js ICONS map');
        }
        return '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>';
    };
})();

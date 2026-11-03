// ============================================
// PANEL REFRESH — open panels follow the day
// ============================================
// The custom panel is plain HTML painted once by a show* method (ActionMenu's
// panels, the UI's own: Kingdom, Diplomacy, Settlements, ...). Without help it
// keeps showing yesterday's numbers after End Turn until it is closed and
// opened again.
//
// trackShows(target) wraps each show* method of an object so that the
// outermost show* call that paints the panel is remembered as the panel's
// view: { self, fn, args } (UI.showCustomPanel calls note()). After the day
// (ui/game/endDay.js) refreshAfterDay() calls that view again, so the same
// screen redraws with today's values in place (same title, so it keeps its
// scroll). A one-off result line passed in (a `message`/`msg`/`flash`/`note`
// parameter) is not shown again. A view replaced during the day (an event
// scene, the death screen) is left alone, and a locked panel never redraws.

let depth = 0;
let pending = null;
let refreshing = false;

const MESSAGE_PARAMS = /^(message|msg|flash|note|notice|result)$/;

/** The positions of a function's one-off message parameters, from its source. */
function messageSlots(fn) {
    const src = Function.prototype.toString.call(fn);
    const m = src.match(/^[^(]*\(([^)]*)\)/);
    if (!m) return [];
    const out = [];
    m[1].split(',').forEach((p, i) => {
        const name = p.split('=')[0].trim();
        if (MESSAGE_PARAMS.test(name)) out.push(i);
    });
    return out;
}

/** Wrap every show* method of `target` (an object or a prototype) so its panel can be redrawn. */
export function trackShows(target) {
    if (!target || target.__showsTracked) return target;
    for (const name of Object.getOwnPropertyNames(target)) {
        if (!/^show[A-Z]/.test(name) || name === 'showCustomPanel' || name === 'showNotification') continue;
        const desc = Object.getOwnPropertyDescriptor(target, name);
        if (!desc || typeof desc.value !== 'function') continue;
        const fn = desc.value;
        const slots = messageSlots(fn);
        const wrapped = function (...args) {
            if (depth > 0) return fn.apply(this, args);
            depth++;
            const prev = pending;
            pending = { self: this, fn, args, slots, name };
            try {
                return fn.apply(this, args);
            } finally {
                depth--;
                pending = prev;
            }
        };
        wrapped.__tracked = fn;
        Object.defineProperty(target, name, { ...desc, value: wrapped });
    }
    Object.defineProperty(target, '__showsTracked', { value: true });
    return target;
}

const CUSTOM = 'customPanel';

function _views(ui) {
    if (!ui._panelViews) ui._panelViews = {};
    return ui._panelViews;
}

/** Is a panel on screen: the custom panel exists; a side panel is not hidden. */
function _open(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (id !== CUSTOM && el.classList && el.classList.contains('hidden')) return null;
    return el;
}

export const PanelRefresh = {
    /**
     * A panel is painted (UI.showCustomPanel, or UI.showPanel for the side
     * panels: tile info, kingdom, character): remember the view that painted
     * it (none for an untracked painter).
     */
    note(ui, id = CUSTOM) {
        if (refreshing || !ui) return;
        _views(ui)[id] = pending;
    },

    /** A panel was closed. */
    clear(ui, id = CUSTOM) {
        if (ui && ui._panelViews) delete ui._panelViews[id];
    },

    /** The views on screen now (to compare before and after the day). */
    snapshot(ui) {
        return ui ? { ..._views(ui) } : {};
    },

    _redraw(ui, view) {
        const args = view.args.slice();
        for (const i of view.slots) if (i < args.length) args[i] = null;
        refreshing = true;
        depth++;
        // Redrawn as if from inside the panel, so a tab bar it shows under stays (UI.showCustomPanel)
        const click = ui._clickInPanel;
        ui._clickInPanel = true;
        try {
            view.fn.apply(view.self, args);
            return true;
        } catch (e) {
            console.warn(`[PanelRefresh] ${view.name} failed to redraw:`, e);
            return false;
        } finally {
            depth--;
            refreshing = false;
            ui._clickInPanel = click;
        }
    },

    /**
     * Redraw each open panel's view that the day did not replace. `before` is
     * snapshot(ui) from when the day began. → the ids redrawn.
     */
    refreshAfterDay(ui, before) {
        const done = [];
        if (!ui || !before || typeof document === 'undefined') return done;
        const views = _views(ui);
        for (const [id, view] of Object.entries(before)) {
            if (!view || views[id] !== view) continue;
            const el = _open(id);
            if (!el || el._locked) continue;
            if (PanelRefresh._redraw(ui, view)) done.push(id);
        }
        return done;
    },
};

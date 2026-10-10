// ActionMenu UI kit — the shared look of the action-menu panels: button and
// card styles, and the panel tab bar. Panels used to hand-roll these per file
// (and each drew its own row of tab buttons inside the content, so switching
// tabs resized the window and the row scrolled away with the content).
//
// panelTabs() puts a panel's tabs in the custom panel's own tab bar
// (UI.setPanelNav, ui/ui/panels.js): a fixed bar above the content that keeps
// the window one size while the player moves between tabs. When the panel is
// shown as a tab of another window (the Ledger as the market's 📒 tab), the
// host's bar stays and the panel's tabs show as a sub-tab row instead.
//
// Pure string builders — no imports, no state.

/** Base button: inline style strings, so panels can keep `style="${BTN_GOLD}"`. */
export const BTN = 'padding: 5px 10px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; font-family: var(--font-body); line-height: 1.3;';
export const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
export const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
export const BTN_DARK = BTN + 'background: #444; color: #eee;';
export const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
export const BTN_OFF = BTN + 'background: #333; color: #777; cursor: not-allowed;';
export const BTN_RED = BTN + 'background: #7a3030; color: #eee;';
export const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';

export function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** [key, label, title?] or { key, label, title? } → { key, label, title }. */
function tabItem(t) {
    return Array.isArray(t) ? { key: t[0], label: t[1], title: t[2] || '' } : { key: t.key, label: t.label, title: t.title || '' };
}

/**
 * A row of sub-tabs inside the content (used when a panel is hosted in another
 * window's tab bar, or when there is no tab bar to use). attrsFor(key) returns
 * the routing attributes of a tab's button (e.g. data-am-act/data-am-args).
 */
export function subTabsHtml(tabs, active, attrsFor) {
    const items = tabs.map(tabItem);
    if (!items.length) return '';
    return `<div class="panel-subtabs">${items.map(i =>
        `<button class="panel-subtab${i.key === active ? ' active' : ''}" ${attrsFor(i.key)}${i.title ? ` title="${esc(i.title)}"` : ''}>${i.label}</button>`).join('')}</div>`;
}

/** Will the custom panel's current tab bar survive the next showCustomPanel? (mirrors ui/ui/panels.js) */
function liveNav(ui) {
    const nav = ui && ui._panelNav;
    if (!nav || typeof nav !== 'object' || !Array.isArray(nav.items)) return null;
    return (ui._panelNavFresh || ui._clickInPanel !== false) ? nav : null;
}

/**
 * The panel's tabs. Call just before game.ui.showCustomPanel and put the
 * returned HTML (often '') where the old tab row was.
 *   id       — the panel's id ('bank', 'ledger', ...)
 *   title    — the window title the bar keeps
 *   tabs     — [[key, label, title?], ...]
 *   active   — the key shown
 *   go(key)  — show that tab (set the panel's tab state, re-render)
 *   attrsFor(key) — routing attributes for the sub-tab-row fallback
 * When another window's bar lists this panel among its hosts
 * (nav.hosts = { [id]: { [tabKey]: hostKey, '*': hostKey } }), that bar stays:
 * tabs mapped to one of its keys light that key and are left out of the
 * sub-tab row; the others show in the row.
 */
export function panelTabs(game, { id, title, tabs, active, go, attrsFor }) {
    const ui = game && game.ui;
    const items = tabs.map(tabItem);
    if (!ui || typeof ui.setPanelNav !== 'function') return subTabsHtml(items, active, attrsFor);
    const host = liveNav(ui);
    const map = host && host.id !== id && host.hosts && host.hosts[id];
    if (map) {
        const hostKey = map[active] || map['*'];
        if (hostKey && host.items.some(i => i.key === hostKey)) host.active = hostKey;
        // The panel re-renders inside the host window: keep its bar
        ui._panelNavFresh = true;
        return subTabsHtml(items.filter(i => !map[i.key]), active, attrsFor);
    }
    ui.setPanelNav({ id, title, active, items: items.map(i => ({ key: i.key, label: i.label, title: i.title, run: () => go(i.key) })) });
    return '';
}

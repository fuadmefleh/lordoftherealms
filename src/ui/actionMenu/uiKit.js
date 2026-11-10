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
// Pure string builders, no state; tab labels lead with the realm's glyphs (ui/icons.js).

import { glyphLabel } from '../icons.js';

/** Base button: inline style strings, so panels can keep `style="${BTN_GOLD}"`. */
export const BTN = 'padding: 5px 10px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; font-family: var(--font-body); line-height: 1.3;';
export const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
export const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
export const BTN_DARK = BTN + 'background: #444; color: #eee;';
export const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
export const BTN_OFF = BTN + 'background: #333; color: #777; cursor: not-allowed;';
export const BTN_RED = BTN + 'background: #7a3030; color: #eee;';
/** "🔓 as treasurer" — why the player may read a realm's own numbers (systems/realmIntel.js). */
export function intelBadge(why) {
    return why ? `<span style="font-size:10px; color:#9fd89f;" title="You read this because of ${esc(why)}">🔓 ${esc(why)}</span>` : '';
}

/** The note shown where a realm's books are closed to the player. */
export function closedBooks(what = 'the crown\'s books') {
    return `<div style="font-size:11px; color:var(--text-secondary); margin:4px 0;">🔒 ${esc(String(what).charAt(0).toUpperCase() + String(what).slice(1))} are not for a commoner's eyes: the throne, an office at that court (chancellor, tax collector, treasurer, spymaster) or a spy placed in the realm would open them. What you have is the talk of the street.</div>`;
}

// ── Structure helpers (styles.css "Panel kit") ──────────────────────────
// Panels used to open on a grey slab of prose; these give them a shape the
// eye can scan. All take trusted HTML (callers escape what they interpolate).

/** The panel's opening paragraph: one or two sentences, gold rule at the left. */
export function lede(html) {
    return html ? `<p class="pk-lede">${html}</p>` : '';
}

/** A row of stat chips. items: [icon, label, value, cls?] or { icon, label, value, cls } or a plain string. */
export function chips(items) {
    const parts = (items || []).filter(Boolean).map(i => {
        if (typeof i === 'string') return `<span class="pk-chip">${i}</span>`;
        const [ic, label, value, cls] = Array.isArray(i) ? i : [i.icon, i.label, i.value, i.cls];
        const v = value == null || value === '' ? '' : ` <b>${value}</b>`;
        return `<span class="pk-chip${cls ? ' ' + cls : ''}">${ic ? ic + ' ' : ''}${label || ''}${v}</span>`;
    });
    return parts.length ? `<div class="pk-chips">${parts.join('')}</div>` : '';
}

/** The player's purse as a chip: "💰 Purse 1,250g". */
export function purse(gold) {
    const n = Math.floor(Number(gold) || 0);
    return { icon: '💰', label: 'Purse', value: `${n.toLocaleString('en-US')}g`, cls: 'gold' };
}

/** A small uppercase section heading. */
export function sectionHead(text) {
    return `<div class="pk-head">${text}</div>`;
}

/** A bullet list of short points. */
export function bullets(items) {
    const li = (items || []).filter(Boolean).map(i => `<li>${i}</li>`).join('');
    return li ? `<ul class="pk-list">${li}</ul>` : '';
}

/** Label/value row. */
export function kv(label, value) {
    return `<div class="pk-kv"><span>${label}</span><span>${value}</span></div>`;
}

/** A collapsed "summary ▸" that opens to its body (long lists nobody needs open). */
export function more(summary, bodyHtml) {
    return bodyHtml ? `<details class="pk-more"><summary>${summary}</summary>${bodyHtml}</details>` : '';
}

export const CARD ='background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';

/**
 * True once the player has closed the custom panel. A minigame whose loop
 * re-shows the panel every tick checks this and stops — otherwise closing it
 * just makes it pop straight back until the game runs out.
 */
export function panelClosed() {
    return typeof document !== 'undefined' && typeof document.getElementById === 'function'
        && !document.getElementById('customPanel');
}

export function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Before a battle: fight it on the ground yourself (ui/innerMapBattle.js) or
 * let the captains settle it. Two data-am-act buttons: `field` and `auto` are
 * [act, ...args] for ActionMenu[act](game, ...args).
 */
export function fieldChoiceHtml(field, auto, blurb = 'Your companies drawn up on the ground where it happens: march, hold, charge, loose, sound the retreat.') {
    const btn = (spec, label, style) => `<button data-am-act="${esc(spec[0])}" data-am-args="${esc(JSON.stringify(spec.slice(1)))}" style="${style}display:block;width:100%;text-align:left;padding:9px 10px;">${label}</button>`;
    return `<div style="padding:4px 2px;">${btn(field, '⚔️ Take the field — command them yourself', BTN_GOLD)}
        <div style="font-size:11px;color:#999;margin:2px 0 8px;">${blurb}</div>
        ${btn(auto, '🎲 Let the captains fight it', BTN_DARK)}
        <div style="font-size:11px;color:#999;margin-top:2px;">Settled at once on the odds.</div></div>`;
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
        `<button class="panel-subtab${i.key === active ? ' active' : ''}" ${attrsFor(i.key)}${i.title ? ` title="${esc(i.title)}"` : ''}>${glyphLabel(i.label)}</button>`).join('')}</div>`;
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

// ============================================
// FIRST STEPS CARD — the guided first month on the HUD
// ============================================
// A compact card at the top of the right info rail (#hudRightRail): the
// current step (systems/firstSteps.js), why it matters, how to do it, a
// button that takes the player there (the same action-menu path the menu
// uses: ActionMenu.handleAction, so AP, needs and outlaw refusals apply), a
// collapse toggle and "Skip guidance". Refreshed from UI.updateStats, which
// also runs FirstSteps.check so a step finished by any action is credited at
// once, with a notification. A skipped (or switched-off) guidance is
// reopened from the Steward's Counsel panel (firstStepsResumeHtml).
//
// Clicks go through one document-level listener on [data-fs-act] elements
// (the card's own and the Counsel's resume button), routed to the game the
// card was last drawn for. The card inherits the rail's --ui-zoom; it sets
// no viewport sizes or pixel positions of its own.

import { FirstSteps } from '../systems/firstSteps.js';
import { Hex } from '../core/hex.js';
import { ActionMenu } from './actionMenu/_ref.js';
import { PlayerActions } from '../player/playerActions.js';
import { Afterlife } from '../player/afterlife.js';

const CARD_ID = 'firstStepsCard';
const BTN = 'border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;padding:5px 9px;';
const BTN_GO = BTN + 'background:var(--gold);color:#1a1a1a;flex:1;';
const BTN_DIM = BTN + 'background:rgba(255,255,255,0.08);color:var(--text-secondary);';

let _game = null;
let _listening = false;

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function _here(game) {
    return game.world.getTile(game.player.q, game.player.r);
}

/** Centre the camera on a hex (as the Counsel's map button does). */
function _focus(game, q, r) {
    if (!game.renderer || !game.camera || typeof game.renderer.getHexPixelPos !== 'function') return;
    const pos = game.renderer.getHexPixelPos(q, r);
    if (!pos || !game.camera.centerOn) return;
    game.camera.following = false;
    game.camera.centerOn(pos.x, pos.y);
}

/** The nearest settlement the player has seen but not yet entered, or null. */
function _nearestNewTown(game) {
    const { world, player } = game;
    if (!world || typeof world.getSettlementViews !== 'function') return null;
    const seen = player.quests && player.quests.settlementsVisited;
    const visited = (name) => (seen instanceof Set ? seen.has(name) : Array.isArray(seen) && seen.includes(name));
    let best = null;
    let bestD = Infinity;
    for (const s of world.getSettlementViews()) {
        const t = world.getTile(s.q, s.r);
        if (!t || !t.explored || visited(s.name)) continue;
        if (s.q === player.q && s.r === player.r) continue;
        const d = Hex.wrappingDistance(player.q, player.r, s.q, s.r, world.width);
        if (d < bestD) { bestD = d; best = s; }
    }
    return best ? { s: best, d: bestD } : null;
}

/** The step's button: run its action where the player stands, or open its panel. */
function _go(game) {
    const step = FirstSteps.current(game.player);
    const go = step && step.go;
    if (!go) return;
    const tile = _here(game);
    if (go.action) {
        const avail = tile && tile.settlement
            ? PlayerActions.getAvailableActions(game.player, tile, game.world).some(a => a.type === go.action)
            : false;
        if (avail) {
            ActionMenu.handleAction(game, tile, go.action);
        } else {
            game.ui.showNotification(`${step.icon || '📜'} First Steps`, tile && tile.settlement
                ? _esc(`${tile.settlement.name} offers no "${go.label || step.title}". Try another town.`)
                : 'You need to be in a town or village for this. Walk into one, then press the button again.', 'info');
        }
        return;
    }
    switch (go.panel) {
        case 'endDay':
            if (typeof game.endDay === 'function') game.endDay();
            break;
        case 'quests':
            game.ui.showQuestsPanel();
            break;
        case 'house':
            ActionMenu.showHousePanel(game, tile);
            break;
        case 'counsel':
            ActionMenu.showCounsel(game);
            break;
        case 'map': {
            const n = _nearestNewTown(game);
            if (n) {
                _focus(game, n.s.q, n.s.r);
                game.ui.showNotification('🗺️ First Steps', _esc(`${n.s.name} lies ${n.d} hexes away. Click it on the map to travel there.`), 'info');
            } else {
                game.ui.showNotification('🗺️ First Steps', 'No other town is in sight yet. Explore further, then click one on the map.', 'info');
            }
            break;
        }
        default:
            break;
    }
}

function _act(game, act) {
    const player = game.player;
    switch (act) {
        case 'go':
            _go(game);
            break;
        case 'toggle':
            FirstSteps.setCollapsed(player, !(player.firstSteps && player.firstSteps.collapsed));
            break;
        case 'skip':
            if (FirstSteps.skip(player)) {
                game.ui.showNotification('📜 First Steps', 'Guidance put away. You can take it up again from the 🗝️ Counsel panel.', 'info');
            }
            break;
        case 'resume':
            if (FirstSteps.resume(player)) {
                if (typeof ActionMenu.closePanel === 'function') ActionMenu.closePanel(game);
                game.ui.showNotification('📜 First Steps', 'Guidance resumed: your next step is on the right of the screen.', 'info');
            }
            break;
        default:
            return;
    }
    updateFirstStepsCard(game);
}

function _onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-fs-act]') : null;
    if (!el || !_game || !_game.player) return;
    e.stopPropagation();
    _act(_game, el.dataset.fsAct);
}

function _cardHtml(v) {
    const s = v.step;
    const head = `<div class="hud-card-header" style="display:flex;align-items:center;justify-content:space-between;gap:6px;">`
        + `<span>◆ First Steps · ${v.doneCount}/${v.total}</span>`
        + `<button data-fs-act="toggle" title="${v.collapsed ? 'Show the step' : 'Hide the step'}" style="${BTN_DIM}padding:1px 7px;">${v.collapsed ? '▸' : '▾'}</button></div>`;
    if (v.collapsed) {
        return head + `<div style="font-size:12px;color:var(--text-secondary);">${_esc(s.icon || '')} ${_esc(s.title)}</div>`;
    }
    const pct = v.total ? Math.round(100 * v.doneCount / v.total) : 0;
    return head
        + `<div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;margin:-4px 0 8px;"><div style="height:4px;width:${pct}%;background:var(--gold);border-radius:2px;"></div></div>`
        + `<div class="hud-obj-title" style="display:flex;gap:6px;align-items:baseline;"><span>${_esc(s.icon || '')}</span><span>${_esc(s.title)}</span></div>`
        + `<div class="hud-obj-desc" style="margin-bottom:6px;">${_esc(s.why)}</div>`
        + `<div style="font-size:12px;color:var(--gold-light);line-height:1.4;margin-bottom:8px;">➜ ${_esc(s.how)}</div>`
        + '<div style="display:flex;gap:6px;">'
        + (s.go ? `<button data-fs-act="go" style="${BTN_GO}">${_esc((s.go && s.go.label) || 'Show me')}</button>` : '')
        + `<button data-fs-act="skip" title="Stop the guidance (you can resume it from the Counsel panel)" style="${BTN_DIM}">Skip guidance</button>`
        + '</div>';
}

/**
 * Credit any step now done (with a notification each) and redraw the card.
 * Called from UI.updateStats; safe without a HUD (tests) or a guided player.
 */
export function updateFirstStepsCard(game) {
    if (!game || !game.player || !game.world) return;
    _game = game;
    for (const n of FirstSteps.check(game.player, game.world)) {
        if (game.ui) game.ui.showNotification(_esc(`${n.icon} ${n.title}`), _esc(n.text), n.type);
    }
    if (typeof document === 'undefined' || !document.getElementById) return;
    if (!_listening && document.addEventListener) {
        _listening = true;
        document.addEventListener('click', _onClick);
    }
    const rail = document.getElementById('hudRightRail');
    let card = document.getElementById(CARD_ID);
    const v = FirstSteps.view(game.player);
    // Dead and waiting (interregnum): no guidance for a life that has ended
    if (!v.active || !v.step || Afterlife.active(game.player)) {
        if (card) card.style.display = 'none';
        return;
    }
    if (!card) {
        if (!rail || !document.createElement) return;
        card = document.createElement('div');
        card.id = CARD_ID;
        card.className = 'hud-frame hud-info-card';
        if (rail.insertBefore) rail.insertBefore(card, rail.firstChild || null);
        else if (rail.appendChild) rail.appendChild(card);
    }
    card.style.display = '';
    const sig = `${v.step.id}|${v.doneCount}|${v.collapsed}`;
    if (card._fsSig !== sig) {
        card._fsSig = sig;
        card.innerHTML = _cardHtml(v);
    }
}

/** The Counsel panel's footer: a button to take up the guidance again (or ''). */
export function firstStepsResumeHtml(player) {
    if (!FirstSteps.canResume(player)) return '';
    const v = FirstSteps.view(player);
    return `<button data-fs-act="resume" style="width:100%;margin-top:8px;padding:7px;border:1px solid rgba(245,197,66,0.35);border-radius:4px;background:rgba(245,197,66,0.08);color:var(--gold);cursor:pointer;font-weight:bold;font-size:12px;">📜 Show the First Steps guidance (${v.doneCount}/${v.total} done)</button>`;
}

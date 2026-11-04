// ============================================
// WILDS ENCOUNTER MODAL — a choice out in the wilds or at a minor POI
// ============================================
// Presents an encounter of player/wilds.js: the situation, its 2–3 choices
// with their odds, costs and requirements, then what came of the choice.
// Used by the wilderness inner map (stepping onto an encounter, or Examine)
// and by Explore POI (ui/actionMenu/build.js). All logic lives in Wilds.
import { Wilds } from '../player/wilds.js';

const ODDS_COLOR = { 'very likely': '#7fd07f', likely: '#b5d77f', 'even odds': '#e0b040', risky: '#e08a50', desperate: '#e06060', certain: '#9ecbff' };
const BTN = 'display:block; width:100%; text-align:left; padding:8px 11px; margin:6px 0 0; border:none; border-radius:5px; font-family:var(--font-body); font-size:13px; font-weight:600;';
const BTN_GO = BTN + 'background:linear-gradient(135deg,#f5c542,#d4a843); color:#1a1a2e; cursor:pointer;';
const BTN_OFF = BTN + 'background:rgba(255,255,255,0.07); color:var(--text-secondary); cursor:default;';
const BTN_LEAVE = BTN + 'background:rgba(255,255,255,0.1); color:#ddd; cursor:pointer; text-align:center;';

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Open the encounter modal.
 * opts: {
 *   ctx: { id, wq, wr, slot?, terrain, poi? }  — what Wilds.resolve needs
 *   title?: heading over the encounter (e.g. the POI's name)
 *   canLeave?: show "Leave it be" (default true)
 *   leaveLabel?: its label
 *   onResolved?(res): after a choice resolved (before the outcome view closes)
 *   extraLines?(res): lines to add to the outcome (e.g. the POI finish)
 *   onClose?(res|null): when the modal closes (res null when left alone)
 *   doneLabel?: the outcome view's button
 * }
 * Returns a handle { close }.
 */
export function showWildsEncounter(game, opts = {}) {
    const player = game && game.player;
    const world = game && game.world;
    const ctx = opts.ctx;
    const info = player && ctx ? Wilds.describe(player, ctx.id, ctx) : null;
    if (!info) return null;
    const canLeave = opts.canLeave !== false;
    document.getElementById('wildsEncounterOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'wildsEncounterOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.style.cssText = 'position:fixed; inset:0; z-index:1200; background:rgba(0,0,0,0.65); backdrop-filter:blur(4px); display:flex; justify-content:center; align-items:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(16,20,28,0.97); border:1px solid rgba(245,197,66,0.4); border-radius:12px; padding:20px 24px; width:min(460px, calc(100vw - 32px)); max-height:calc(100vh - 48px); overflow-y:auto; box-shadow:0 12px 48px rgba(0,0,0,0.85); font-family:var(--font-body); color:#ddd;';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let result = null;
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        overlay.remove();
        window.removeEventListener('keydown', onKey, true);
        if (opts.onClose) opts.onClose(result);
    };
    const onKey = (e) => {
        if (e.key !== 'Escape' && e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        if (result || (canLeave && e.key === 'Escape')) close();
    };
    window.addEventListener('keydown', onKey, true);

    const header = () => {
        let h = '';
        if (opts.title) h += `<div style="text-align:center; font-size:11px; color:#999; letter-spacing:0.05em; text-transform:uppercase;">${_esc(opts.title)}</div>`;
        h += `<div style="text-align:center; font-size:44px; margin:4px 0 6px;">${info.icon || '❔'}</div>`;
        h += `<div style="text-align:center; font-family:var(--font-display); font-size:18px; color:var(--gold); margin-bottom:8px;">${_esc(info.name)}</div>`;
        return h;
    };

    const renderChoices = () => {
        const fresh = Wilds.describe(player, ctx.id, ctx) || info;
        let h = header();
        h += `<div style="font-size:13px; line-height:1.55; margin-bottom:10px;">${_esc(fresh.text)}</div>`;
        const hp = Math.round(player.health || 0);
        h += `<div style="display:flex; gap:12px; font-size:11px; color:#aaa; margin-bottom:4px;"><span>❤️ ${hp}/${player.maxHealth || 100}</span><span>⚡ ${Math.max(0, player.movementRemaining || 0)} stamina</span><span>💰 ${Math.floor(player.gold || 0)}</span></div>`;
        for (const c of fresh.choices) {
            const pct = c.chance === null ? '' : ` ~${Math.round(c.chance * 100)}%`;
            const sub = [`<span style="color:${ODDS_COLOR[c.odds] || '#ccc'};">${c.odds}${pct}</span>`];
            if (c.costText) sub.push(`costs ${_esc(c.costText)}`);
            if (c.checkText) sub.push(_esc(c.checkText));
            if (c.hint) sub.push(`<i>${_esc(c.hint)}</i>`);
            if (c.can.ok) {
                h += `<button data-wc="${_esc(c.id)}" style="${BTN_GO}">${_esc(c.label)}<div style="font-weight:normal; font-size:11px; opacity:0.85; margin-top:2px;">${sub.join(' · ')}</div></button>`;
            } else {
                h += `<button disabled style="${BTN_OFF}">${_esc(c.label)}<div style="font-weight:normal; font-size:11px; margin-top:2px;">🔒 ${_esc(c.can.reason)}</div></button>`;
            }
        }
        if (canLeave) h += `<button data-wc-leave="1" style="${BTN_LEAVE}">${_esc(opts.leaveLabel || 'Leave it be')}</button>`;
        box.innerHTML = h;
        box.querySelectorAll('[data-wc]').forEach(b => b.addEventListener('click', () => choose(b.getAttribute('data-wc'))));
        const leave = box.querySelector('[data-wc-leave]');
        if (leave) leave.addEventListener('click', close);
    };

    const renderOutcome = (res, extra) => {
        const ok = res.passed;
        const tested = res.chance !== null && res.chance !== undefined;
        let h = header();
        h += `<div style="background:rgba(255,255,255,0.04); border:1px solid ${ok ? 'rgba(127,208,127,0.4)' : 'rgba(224,96,96,0.4)'}; border-radius:6px; padding:9px 11px;">`;
        h += `<div style="font-weight:bold; color:${ok ? '#7fd07f' : '#e08080'}; font-size:12px;">${_esc(res.choice.label)}${tested ? ` — ${ok ? 'success' : 'failure'}` : ''}</div>`;
        h += `<div style="font-size:13px; line-height:1.5; margin-top:4px;">${_esc(res.text)}</div>`;
        const lines = [...(res.lines || []), ...(extra || [])];
        if (lines.length) h += `<div style="font-size:11.5px; color:#cfc6a8; margin-top:6px; line-height:1.6;">${lines.map(_esc).join('<br>')}</div>`;
        h += '</div>';
        // A repeatable choice not yet used up: try again (its own roll), or leave it for later
        if (res.resolved === false && res.usesLeft > 0) {
            h += `<button data-wc-again="1" style="${BTN_GO} text-align:center;">${_esc(res.choice.label)} again (${res.usesLeft} left)</button>`;
        }
        h += `<button data-wc-done="1" style="${BTN_GO} text-align:center;">${_esc(opts.doneLabel || 'Continue')}</button>`;
        box.innerHTML = h;
        box.querySelector('[data-wc-done]').addEventListener('click', close);
        const again = box.querySelector('[data-wc-again]');
        if (again) again.addEventListener('click', () => { result = null; renderChoices(); });
    };

    const choose = (choiceId) => {
        const res = Wilds.resolve(player, world, ctx, choiceId);
        if (!res.success) {
            if (game.ui && game.ui.showNotification) game.ui.showNotification(`${info.icon} ${info.name}`, res.reason, 'error');
            return;
        }
        result = res;
        if (opts.onResolved) opts.onResolved(res);
        const extra = opts.extraLines ? opts.extraLines(res) : null;
        if (game.ui && game.ui.updateStats) game.ui.updateStats(player, world);
        renderOutcome(res, extra);
    };

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay && (result || canLeave)) close();
    });
    renderChoices();
    return { close };
}

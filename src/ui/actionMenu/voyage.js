// ============================================
// VOYAGE PANEL — a voyage day by day, events at sea, sail on / heave to
// ============================================
// Voyages (systems/shipVoyages.js) advance one day per endDay. endDay hands
// the day's voyage report to onVoyageDay, which shows the voyage log and
// either sails on by itself (a quiet day) or waits for the captain: an event
// with choices, a storm, a fight, hunger — "Sail on" or "Heave to".
// Not merged into ActionMenu; imported directly by endDay.js and houseShips.js.

import { ActionMenu } from './_ref.js';
import { Ships } from '../../systems/ships.js';

/** How long a quiet day's log stays up before the ship sails on. */
const AUTO_SAIL_MS = 900;

const BTN = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;';
const BTN_PRIMARY = `${BTN}border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
const BTN_SECONDARY = `${BTN}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pill(label, value, color = null) {
    return `<span style="font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);${color ? `color:${color};` : ''}">${label} ${value}</span>`;
}

function logLines(entries) {
    if (!entries || !entries.length) return '';
    return entries.map(e => `<div style="font-size:11px;padding:2px 0;">${e.icon || '•'} ${esc(e.text)}</div>`).join('');
}

function clearTimer(game) {
    if (game._voyageTimer) {
        clearTimeout(game._voyageTimer);
        game._voyageTimer = null;
    }
}

/** End another day at sea (the voyage moves on in the daily tick). */
export function sailOn(game) {
    clearTimer(game);
    if (!Ships.getVoyage(game.player)) return;
    if (Ships.describeVoyageEvent(game.player)) {
        showVoyagePanel(game, null);
        return;
    }
    game._endDayConfirmed = true;
    game.endDay();
}

/** Stop the voyage and take the helm, still aboard. */
export function heaveTo(game) {
    clearTimer(game);
    const res = Ships.heaveTo(game.player, game.world);
    game.ui.hideCustomPanel();
    game.ui.showNotification('⚓ Heave To', res.message, res.success ? 'info' : 'error');
    game.ui.updateStats(game.player, game.world);
}

/** Start a voyage from the Sail To menu, optionally victualling first (`start` overrides how she sets out). */
export function beginVoyage(game, shipId, destQ, destR, destName, victualDays = 0, start = null) {
    const player = game.player;
    const world = game.world;
    if (victualDays > 0) {
        const ship = Ships.getShipById(player, shipId);
        const want = ship ? Ships.provisionsNeeded(ship, victualDays) : 0;
        if (want > 0) {
            const bought = Ships.buyProvisions(player, world, shipId, want);
            game.ui.showNotification(bought.success ? '🍞 Provisioned' : 'Provisions', bought.message, bought.success ? 'success' : 'warning');
        }
    }
    // `start` sets out some other way — an expedition (systems/discovery.js)
    const result = start ? start() : Ships.startVoyage(player, world, shipId, destQ, destR, destName);
    if (!result.success) {
        game.ui.showNotification('Cannot Sail', result.message, 'error');
        return;
    }
    game.ui.showNotification('⛵ Under Way', result.message, 'success');
    game.ui.updateStats(player, world);
    showVoyagePanel(game, null);
    game._voyageTimer = setTimeout(() => sailOn(game), AUTO_SAIL_MS);
}

/**
 * The day's voyage report from endDay (Ships.processDaily → voyage):
 * show it, then sail on or wait for orders.
 */
export function onVoyageDay(game, day) {
    if (!day) return;
    if (game.renderer && game.camera && ActionMenu._centerCameraOnPlayer) ActionMenu._centerCameraOnPlayer(game);
    if (day.arrived) {
        if (typeof game.onPlayerArrived === 'function') game.onPlayerArrived();
        game.ui.updateStats(game.player, game.world);
        showArrivalPanel(game, day);
        return;
    }
    if (day.lost || !Ships.getVoyage(game.player)) {
        showVoyagePanel(game, day);
        return;
    }
    showVoyagePanel(game, day);
    if (!day.notable && !day.event) {
        game._voyageTimer = setTimeout(() => sailOn(game), AUTO_SAIL_MS);
    }
}

function showArrivalPanel(game, day) {
    const ship = Ships.getShipById(game.player, day.shipId);
    const last = ship && ship.lastVoyage;
    let html = '<div style="max-height:440px;overflow-y:auto;">';
    html += `<h4 style="margin:0 0 4px;">⚓ ${esc(day.name)} makes port at ${esc(day.destName)}</h4>`;
    html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">${day.day} day${day.day === 1 ? '' : 's'} at sea. Her hold is as you left it — use the Port Market or Ship's Hold here.</div>`;
    if (ship) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">';
        html += pill('👥', `${Ships.getCrew(ship)}/${Ships.getShipEffectiveStats(ship).crewRequired}`);
        html += pill('🙂', Ships.getMorale(ship));
        html += pill('🔧', `${ship.condition}%`);
        html += '</div>';
    }
    html += '<div style="font-size:12px;font-weight:bold;margin-bottom:4px;">📜 Ship\'s log</div>';
    html += `<div style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);">${logLines(last ? last.log : day.log)}</div>`;
    html += `<button onclick="window._voyageClose()" style="width:100%;margin-top:8px;${BTN_PRIMARY}">Go ashore</button>`;
    html += '</div>';
    game.ui.showCustomPanel('⚓ Landfall', html);
    window._voyageClose = () => game.ui.hideCustomPanel();
}

/** The voyage in progress: today's log, the waiting event, and the orders. */
function showVoyagePanel(game, day, outcome = null) {
    const player = game.player;
    const ship = Ships.getVoyageShip(player) || (day && Ships.getShipById(player, day.shipId));
    const v = ship && (ship.voyage || ship.lastVoyage);
    if (!ship || !v) return;
    const active = !!ship.voyage;
    const event = active ? Ships.describeVoyageEvent(player) : null;

    let html = '<div style="max-height:460px;overflow-y:auto;">';
    html += `<h4 style="margin:0 0 4px;">⛵ ${esc(ship.name)} → ${esc(v.destName)}</h4>`;
    if (active) {
        const left = Ships.voyageDays(player, ship, Math.max(1, v.route.length - v.step));
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">Day ${v.day} at sea · about ${left} day${left === 1 ? '' : 's'} to go</div>`;
    }
    const food = Ships.getProvisionDays(ship);
    const foodColor = food === Infinity ? null : food <= 2 ? '#e57373' : food <= 5 ? '#f0ad4e' : '#5cb85c';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">';
    html += pill('🍞 Provisions', food === Infinity ? '—' : `${food}d`, foodColor);
    html += pill('👥', `${Ships.getCrew(ship)}/${Ships.getShipEffectiveStats(ship).crewRequired}`);
    html += pill('🙂', Ships.getMorale(ship));
    html += pill('🔧', `${ship.condition}%`);
    html += '</div>';

    const today = day && day.log && day.log.length ? day.log : (v.log || []).slice(-3);
    html += `<div style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);margin-bottom:8px;">${logLines(today) || '<div style="font-size:11px;color:var(--text-secondary);">Fair winds.</div>'}</div>`;

    if (outcome) {
        html += `<div style="padding:8px;border:1px solid rgba(245,197,66,0.35);border-radius:8px;background:rgba(245,197,66,0.06);font-size:12px;margin-bottom:8px;">${outcome.icon || ''} ${esc(outcome.text)}</div>`;
    }

    if (event) {
        html += '<div style="padding:8px;border:1px solid rgba(79,195,247,0.45);border-radius:8px;background:rgba(79,195,247,0.06);margin-bottom:8px;">';
        html += `<div style="font-weight:bold;margin-bottom:4px;">${event.icon} ${esc(event.title)}</div>`;
        html += `<div style="font-size:12px;margin-bottom:8px;">${esc(event.text)}</div>`;
        html += '<div style="display:flex;flex-direction:column;gap:6px;">';
        for (const c of event.choices) {
            html += c.available
                ? `<button onclick="window._voyageChoose('${esc(c.id)}')" style="${BTN_PRIMARY}text-align:left;">${esc(c.label)}</button>`
                : `<button disabled style="${BTN_SECONDARY}text-align:left;opacity:0.5;cursor:not-allowed;">${esc(c.label)} — ${esc(c.why)}</button>`;
        }
        html += '</div></div>';
    } else if (active) {
        const auto = day && !day.notable && !outcome;
        html += '<div style="display:flex;gap:6px;">';
        html += `<button onclick="window._voyageSailOn()" style="flex:1;${BTN_PRIMARY}">${auto ? '⛵ Sailing on…' : '⛵ Sail on'}</button>`;
        html += `<button onclick="window._voyageHeaveTo()" style="flex:1;${BTN_SECONDARY}">⚓ Heave to</button>`;
        html += '</div>';
    } else {
        html += `<button onclick="window._voyageClose()" style="width:100%;${BTN_SECONDARY}">Close</button>`;
    }
    html += '</div>';

    game.ui.showCustomPanel('🧭 Voyage', html);
    window._voyageSailOn = () => sailOn(game);
    window._voyageHeaveTo = () => heaveTo(game);
    window._voyageClose = () => { clearTimer(game); game.ui.hideCustomPanel(); };
    window._voyageChoose = (choiceId) => {
        clearTimer(game);
        const res = Ships.resolveVoyageEvent(player, game.world, choiceId);
        if (!res.success) {
            game.ui.showNotification('At Sea', res.message, 'error');
            return;
        }
        game.ui.updateStats(player, game.world);
        showVoyagePanel(game, null, res);
    };
}

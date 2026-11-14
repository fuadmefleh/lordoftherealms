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
import { InnerMapDeck } from '../innerMapDeck.js';
import { esc, lede, chips, card, rowList } from './uiKit.js';

/**
 * Sail on by itself after a quiet day — not while the captain is on deck,
 * where the day runs on the deck's clock (ui/innerMapDeck.js).
 */
function autoSail(game) {
    if (InnerMapDeck.onDeck(game)) return;
    game._voyageTimer = setTimeout(() => { if (!InnerMapDeck.onDeck(game)) sailOn(game); }, AUTO_SAIL_MS);
}

/** How long a quiet day's log stays up before the ship sails on. */
const AUTO_SAIL_MS = 900;

// In the action menu's voice (ui/actionMenu/uiKit.js): the ship as chips, the
// log as a card, the orders and an event's choices as rows.

/** The ship's state as chips: provisions, crew, morale, hull. */
function shipChips(ship, withFood = true) {
    const food = Ships.getProvisionDays(ship);
    return chips([
        withFood ? { icon: '🍞', label: 'Provisions', value: food === Infinity ? '—' : `${food} days`, cls: food !== Infinity && food <= 2 ? 'dim' : '' } : null,
        ['👥', 'Crew', `${Ships.getCrew(ship)}/${Ships.getShipEffectiveStats(ship).crewRequired}`],
        ['🙂', 'Morale', Ships.getMorale(ship)],
        ['🔧', 'Hull', `${ship.condition}%`],
    ]);
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
        const want = ship ? Ships.provisionsNeeded(ship, victualDays, { player }) : 0;
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
    // On deck: she gets under way and the day goes on (sail through it from the helm)
    if (InnerMapDeck.onDeck(game)) { game.ui.hideCustomPanel(); return; }
    showVoyagePanel(game, null);
    autoSail(game);
}

/**
 * The day's voyage report from endDay (Ships.processDaily → voyage):
 * show it, then sail on or wait for orders.
 */
export function onVoyageDay(game, day) {
    if (!day) return;
    // On deck: the morning comes on deck instead (landfall leaves the deck, then shows here)
    if (InnerMapDeck.onVoyageDay(game, day)) return;
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
    if (!day.notable && !day.event) autoSail(game);
}

function showArrivalPanel(game, day) {
    const ship = Ships.getShipById(game.player, day.shipId);
    const last = ship && ship.lastVoyage;
    let html = '<div style="font-size:12px;">';
    html += lede(`<b>${esc(day.name)}</b> makes port at <b>${esc(day.destName)}</b> after ${day.day} day${day.day === 1 ? '' : 's'} at sea. Her hold is as you left it: trade it at the Port Market or the Ship's Hold.`);
    if (ship) html += shipChips(ship, false);
    html += card(logLines(last ? last.log : day.log), { icon: '📜', title: 'Ship\'s log' });
    html += rowList([{ icon: '⚓', name: 'Go ashore', tone: 'gold', attrs: 'onclick="window._voyageClose()"' }]);
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

    let html = '<div style="font-size:12px;">';
    let where = `<b>${esc(ship.name)}</b> bound for <b>${esc(v.destName)}</b>`;
    if (active) {
        const left = Ships.voyageDays(player, ship, Math.max(1, v.route.length - v.step));
        where += `: day ${v.day} at sea, about ${left} day${left === 1 ? '' : 's'} to go.`;
    }
    html += lede(where);
    html += shipChips(ship);

    const today = day && day.log && day.log.length ? day.log : (v.log || []).slice(-3);
    html += card(logLines(today) || '<div style="font-size:11px;color:var(--text-secondary);">Fair winds.</div>', { icon: '📜', title: 'Today' });

    if (outcome) html += card(`${outcome.icon || ''} ${esc(outcome.text)}`, { tone: 'gold' });

    const on = (call) => `onclick="window.${call}"`;
    if (event) {
        html += card(`<div style="font-size:12px;">${esc(event.text)}</div>`, { icon: event.icon, title: esc(event.title), tone: 'warn' });
        html += rowList(event.choices.map(c => ({
            icon: '▸', name: esc(c.label), off: !c.available, why: esc(c.why || ''),
            attrs: c.available ? on(`_voyageChoose('${esc(c.id)}')`) : '',
        })), 'What are your orders?');
    } else if (active) {
        const auto = day && !day.notable && !outcome;
        html += rowList([
            { icon: '⛵', name: auto ? 'Sailing on…' : 'Sail on', desc: 'Another day at sea', tone: 'gold', attrs: on('_voyageSailOn()') },
            { icon: '⚓', name: 'Heave to', desc: 'Stop the voyage here and take the helm yourself', attrs: on('_voyageHeaveTo()') },
        ]);
    } else {
        html += rowList([{ icon: '↩️', name: 'Close', attrs: on('_voyageClose()') }]);
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

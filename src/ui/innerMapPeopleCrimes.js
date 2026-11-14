// ============================================
// INNER MAP PEOPLE CRIMES — a bound townsperson, and the worst you can do with them
// ============================================
// The street-map half of systems/peopleCrimes.js for someone downed and tied
// (ui/innerMapDowned.js lists these entries beside bind, gag and bury):
//
//   - Lock Them in Your Cellar: where you keep a house or property in this
//     town. They are gone from the street (away on the roster); fed or starved
//     from the Lots & Town Houses panel ("In Your Cellars").
//   - Sell Them to the Galleys: in a harbour town, the galley master pays out
//     of the town's purse and they are gone before dawn.
//
// Anyone in sight may see it done (the dark halves the odds): seen, it is
// known at once. The town map is not saved — the roster carries what matters.

import { InnerMap } from '../world/innerMap.js';
import { PeopleCrimes } from '../systems/peopleCrimes.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { InnerMapCarry } from './innerMapCarry.js';

function _note(game, title, body, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
}

function _where() {
    const wt = InnerMap.currentWorldTile || {};
    return { q: wt.q, r: wt.r };
}

function _night() {
    const h = Number(InnerMap.timeOfDay);
    return h >= 22 || h < 5;
}

/** Those who could see: awake, out where the player is, within sight. */
function _witnesses(npc) {
    const R = (StreetCrime.config().sight || {}).radius || 7;
    const hidden = InnerMap._insideBuilding ? new Set(['gone']) : new Set((StreetCrime.config().sight || {}).hiddenStates || []);
    const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
    return (InnerMap.npcs || []).filter(n => n && n !== npc && !hidden.has(n.state) && n.state !== 'unconscious' && !n.dead && !n.departed
        && Math.max(Math.abs(n.q - pq), Math.abs(n.r - pr)) <= R).length;
}

/** Your house or property in this town (the cellar). */
function _yourPlace() {
    return (InnerMap.buildings || []).find(b => b && (b.isPlayerOwned || b.isPlayerProperty)) || null;
}

/** Off the street: the roster keeps them away now. */
function _takeOff(npc) {
    if (InnerMapCarry.person === npc) InnerMapCarry.reset();
    npc._carried = false;
    npc._dragged = false;
    npc._ko = null;
    npc._bleed = null;
    npc._lyingIn = null;
    npc._bound = false;
    npc._gagged = false;
    npc.path = null;
    npc.state = 'gone';
}

export const InnerMapPeopleCrimes = {
    /** Entries for a downed, bound townsperson. */
    downedItems(game, npc) {
        const out = [];
        if (!npc || !npc._bound || !npc._person || !npc._folk || npc.type === 'guard') return out;
        const world = game && game.world;
        const { q, r } = _where();
        const place = _yourPlace();
        if (place) out.push({ type: 'action', action: 'downed_cellar', label: 'Lock Them in Your Cellar', icon: '⛓️', desc: `In the cellar of your ${String(place.name || place.type || 'house').toLowerCase()}: fed or starved, as you choose. Kept on the Lots & Town Houses panel.`, npc });
        else out.push({ type: 'disabled', label: 'Lock Them in Your Cellar: you keep no house or property in this town' });
        if (world && PeopleCrimes.isHarbour(world, q, r)) {
            const price = PeopleCrimes.bondagePrice(world, q, r, npc._person);
            out.push({ type: 'action', action: 'downed_galleys', label: `Sell Them to the Galleys (${price}g)`, icon: '⚓', desc: 'The galley master pays and takes them aboard. Sold people sometimes come home.', npc });
        } else out.push({ type: 'disabled', label: 'Sell Them to the Galleys: no galley master puts in here' });
        return out;
    },

    /** downed_cellar / downed_galleys. */
    handle(game, item) {
        const npc = item.npc;
        if (!npc || !npc._person) return;
        const player = game.player, world = game.world;
        const { q, r } = _where();
        const opts = { q, r, pid: npc._person.id, witnesses: _witnesses(npc), night: _night() };
        let res;
        if (item.action === 'downed_cellar') {
            const place = _yourPlace();
            res = PeopleCrimes.lockAway(player, world, { ...opts, place: String((place && (place.name || place.type)) || 'house').toLowerCase() });
        } else {
            res = PeopleCrimes.sellToGalleys(player, world, opts);
        }
        if (!res.ok) { _note(game, 'Not Done', res.text, 'warning'); return; }
        _takeOff(npc);
        _note(game, item.action === 'downed_cellar' ? '⛓️ Locked Away' : '⚓ Sold', res.text, res.seen ? 'error' : 'warning');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
    },
};

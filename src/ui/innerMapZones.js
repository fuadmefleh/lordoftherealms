// ============================================
// INNER MAP ZONES — places you may not go
// ============================================
// Some tiles lie in a zone (tile._zone, set by the map: the gaol's cells and
// corridor, world/innerMap/jail.js) with a rule and a warden who keeps it.
// Step into a zone you're not allowed in and the warden shouts at you to get
// out. Come back — or stay past the grace period — and he shouts again and
// comes at you (InnerMapReactions' fight, InnerMapCombat's blows).
//
// Strikes are counted per building visit (a fresh visit starts fresh).
// Rules and lines: data/jail.json → zones.

import { InnerMap } from '../world/innerMap.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCombat } from './innerMapCombat.js';

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _pick(arr, fallback) {
    return Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length) % arr.length] : fallback;
}

export const InnerMapZones = {
    _tiles: null,      // the map the strikes were counted on
    _zone: null,       // the zone the player stands in
    _since: 0,         // when they came into it
    _strikes: {},      // zone → times warned on this visit
    _set: {},          // zone → the warden has been set on them

    reset() {
        this._zone = null;
        this._strikes = {};
        this._set = {};
    },

    /** Each frame: has the player stepped where they shouldn't? */
    update(game) {
        if (!InnerMap.active || !InnerMap.tiles || typeof InnerMap.zoneRule !== 'function') return;
        if (this._tiles !== InnerMap.tiles) {
            this._tiles = InnerMap.tiles;
            this.reset();
        }
        const t = InnerMap.getTile(InnerMap.playerInnerQ, InnerMap.playerInnerR);
        const zone = (t && t._zone) || null;
        const now = _now();
        if (zone !== this._zone) {
            this._zone = zone;
            this._since = now;
            if (zone) this._entered(game, zone);
            return;
        }
        // Lingering after a warning is ignoring it
        if (!zone || this._set[zone] || !this._strikes[zone]) return;
        const rule = InnerMap.zoneRule(zone) || {};
        const grace = (Number(rule.graceSeconds) || 6) * 1000;
        if (now - this._since > grace && !InnerMap.zoneAllows(zone)) this._attack(game, zone, rule);
    },

    _entered(game, zone) {
        if (InnerMap.zoneAllows(zone) || this._set[zone]) return;
        const rule = InnerMap.zoneRule(zone) || {};
        const warden = InnerMap.zoneWarden(zone);
        if (!warden) return;
        this._strikes[zone] = (this._strikes[zone] || 0) + 1;
        if (this._strikes[zone] === 1) {
            const line = _pick(rule.warn, 'Oi! You can\'t go back there. Out!');
            InnerMapReactions.bark(warden, line, 3.5);
            warden.facing = this._faceTo(warden);
            if (game && game.ui) game.ui.showNotification(`⚠️ ${warden.name}`, `"${line}" ${rule.warnNote || 'Go back the way you came.'}`, 'warning');
            return;
        }
        this._attack(game, zone, rule);
    },

    /** The warden has had enough: he shouts, and comes at the player. */
    _attack(game, zone, rule) {
        const warden = InnerMap.zoneWarden(zone);
        if (!warden) return;
        this._set[zone] = true;
        const line = _pick(rule.attack, 'I warned you!');
        InnerMapReactions.bark(warden, line, 3.5);
        InnerMapReactions._respond(warden, 'fight', null);
        InnerMapCombat._npcReactions.set(warden.id, { mode: 'fight', attackTimer: InnerMapCombat.NPC_ATTACK_INTERVAL });
        if (game && game.ui) game.ui.showNotification(`⚔️ ${warden.name} Attacks!`, `"${line}" ${rule.attackNote || 'You were told.'}`, 'error');
    },

    _faceTo(npc) {
        const dq = InnerMap.playerInnerQ - npc.q, dr = InnerMap.playerInnerR - npc.r;
        if (Math.abs(dq) >= Math.abs(dr)) return dq >= 0 ? 3 : 1;
        return dr >= 0 ? 2 : 0;
    },
};

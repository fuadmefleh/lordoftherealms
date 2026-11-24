// ============================================
// WAR STAKES — what the fate of prisoners leaves on the world
// ============================================
// The world-side record of player/prisonerFates.js, read by the realms
// (world/kingdomAI.js, systems/realmWars.js) and the world map
// (ui/renderer/warStakes.js) without reaching up into the player layer:
//
//   world.prisonerFates.stakes   [{ id, byPlayer, by, kingdomId, realm, men,
//                                day, q, r, tiles: [{q,r}], rotDays, place }]
//                                captives impaled along a road. fresh() is
//                                1 the day they went up, 0 once rotted.
//   world.prisonerFates.columns  [{ id, kingdomId, realm, men, leaders, q, r,
//                                toQ, toR, day }] a blinded army walking home
//   kingdom.captivity            { dismay: { until, m }, oathBound: [{ id, men,
//                                until }], fearOf: { player | kid: until } }
//                                (saved with the kingdom, systems/saveLoad.js)
//
// Pure reads and tiny writes, no randomness, no globals.

import { Hex } from '../core/hex.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = (world) => _num(world && world.day);

export const WarStakes = {
    /** world.prisonerFates, created on demand. */
    state(world) {
        if (!world) return null;
        const w = world.prisonerFates && typeof world.prisonerFates === 'object' ? world.prisonerFates : (world.prisonerFates = {});
        if (!Array.isArray(w.stakes)) w.stakes = [];
        if (!Array.isArray(w.columns)) w.columns = [];
        if (!Number.isFinite(w.nextId)) w.nextId = 1;
        return w;
    },

    /** The stakes standing (rotting ones too), or []. */
    stakes(world) {
        return (world && world.prisonerFates && Array.isArray(world.prisonerFates.stakes)) ? world.prisonerFates.stakes : [];
    },

    /** The blinded columns on the road home, or []. */
    columns(world) {
        return (world && world.prisonerFates && Array.isArray(world.prisonerFates.columns)) ? world.prisonerFates.columns : [];
    },

    /** How fresh a stake line is today: 1 → 0 over its rotDays. */
    fresh(stake, day) {
        if (!stake) return 0;
        const rot = Math.max(1, _num(stake.rotDays, 90));
        return Math.max(0, Math.min(1, 1 - (_num(day) - _num(stake.day)) / rot));
    },

    /**
     * The strongest dread of the player's stakes within `radius` hexes of (q, r):
     * 0..1 (the freshest line in reach). opts.byPlayer false counts any stakes.
     */
    dreadAt(world, q, r, radius, opts = {}) {
        const day = _day(world);
        let best = 0;
        for (const s of WarStakes.stakes(world)) {
            if (opts.byPlayer !== false && !s.byPlayer) continue;
            const f = WarStakes.fresh(s, day);
            if (f <= best) continue;
            const pts = Array.isArray(s.tiles) && s.tiles.length ? s.tiles : [{ q: s.q, r: s.r }];
            if (pts.some(t => Hex.wrappingDistance(q, r, t.q, t.r, (world && world.width) || 0) <= radius)) best = f;
        }
        return best;
    },

    /** kingdom.captivity, created on demand. */
    captivity(kingdom) {
        if (!kingdom) return null;
        const c = kingdom.captivity && typeof kingdom.captivity === 'object' ? kingdom.captivity : (kingdom.captivity = {});
        if (!Array.isArray(c.oathBound)) c.oathBound = [];
        if (!c.fearOf || typeof c.fearOf !== 'object') c.fearOf = {};
        return c;
    },

    /** The heart a realm has lost (a blinded army come home): the morale it is short, 0 when none. */
    dismay(kingdom, day) {
        const d = kingdom && kingdom.captivity && kingdom.captivity.dismay;
        return d && _num(d.until) > _num(day) ? _num(d.m) : 0;
    },

    /** Does this realm dread `key` ('player' or a realm's id) today? */
    fears(kingdom, key, day) {
        const f = kingdom && kingdom.captivity && kingdom.captivity.fearOf;
        return !!(f && _num(f[key]) > _num(day));
    },

    /** Men of this realm still bound by an oath to the player not to bear arms against them. */
    oathBound(kingdom, day) {
        const list = kingdom && kingdom.captivity && Array.isArray(kingdom.captivity.oathBound) ? kingdom.captivity.oathBound : [];
        return list.reduce((t, o) => t + (_num(o.until) > _num(day) ? Math.max(0, _num(o.men)) : 0), 0);
    },
};

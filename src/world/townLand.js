// ============================================
// TOWN LAND — how much ground a town has to build on
// ============================================
// A hex holds only so many building plots. Each town's ground is counted from
// its hex and kept on its housing record (settlement.housing.land, saved with
// the tile; world/townHousing.js reads it):
//
//   land = { v, max, wood, wall, wallKind, sub, subAt, sats, at, cleared, full, wallFull }
//     max      plots the hex holds: hexPlots × terrain[its terrain], less the
//              water (a river through it, each side facing sea or lake) and
//              its neighbours (a town on the next hex, an estate's fields,
//              a farm or works, a rural site, the player's property)
//     wood     plots of it still under trees: wood[terrain] of the ground the
//              town did not stand on when first counted. Cleared plot by plot
//              when the town needs them (`clear`: a crew's days of work, the
//              wood to the market) before it is built on
//     wall     plots inside its walls (wallSlack × its ground when they went up;
//              stoneSlack more when rebuilt in stone), never more than max; null
//              for an open town. Edge plots stop at it until the town has a suburb
//     sub      the quarter outside its walls on its own hex: { name, day, d: { type: n } }
//     subAt    'q,r' of a quarter founded on a neighbouring hex (a settlement of its own)
//     sats     villages its overflow founded: [{ q, r, name, day }]
//
// The town lays edge plots only while ground remains (TownHousing.landLeft);
// what happens when it is gone is systems/townSprawl.js (redevelopment,
// suburbs, satellite villages). Recounted every recountDays (the neighbours
// change) and whenever its walls do.
//
// Pure: no randomness, no globals; world passed in. Data: data/townHousing.json `land`.

import { Hex } from '../core/hex.js';
import { TownHousing } from './townHousing.js';
import { TownEras } from './townEras.js';
import { Estates } from './estates.js';
import { SettlementMarket } from './settlementMarket.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r1 = v => Math.round(v * 10) / 10;
const WATER = /ocean|sea|lake|coast/;

export const TownLand = {
    config() { return TownHousing.config().land; },

    on() { return TownHousing.on() && TownLand.config().enabled !== false; },

    /** Is the hex's terrain water (sea, lake, coastal waters)? */
    _wet(t) { return !!(t && t.terrain && WATER.test(String(t.terrain.id || ''))); },

    /** Does something else hold the ground of this hex (an estate's fields, a farm or works, a rural site, the player's property)? */
    _held(world, t, q, r) {
        if (!t) return false;
        if (t.improvement && t.improvement.type !== 'ruins') return true;
        if ((Array.isArray(t.playerProperties) && t.playerProperties.length) || t.playerProperty) return true;
        const sites = world && world.hinterland && Array.isArray(world.hinterland.sites) ? world.hinterland.sites : null;
        if (sites && sites.some(x => x && x.q === q && x.r === r)) return true;
        try { if (Estates.fieldAt(world, q, r)) return true; } catch (e) { /* no estates */ }
        return false;
    },

    _neighbours(world, q, r) {
        const out = [];
        for (const n of Hex.neighbors(q, r)) {
            const nq = world.width ? Hex.wrapQ(n.q, world.width) : n.q;
            const t = typeof world.getTile === 'function' ? world.getTile(nq, n.r) : null;
            out.push({ q: nq, r: n.r, t });
        }
        return out;
    },

    /**
     * The hex's ground in plots, and what takes from it.
     * → { max, woodShare, terrain, parts: { terrain, river, water, towns, fields } }
     */
    count(world, q, r) {
        const C = TownLand.config();
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        const tid = t && t.terrain ? String(t.terrain.id || 'grassland') : 'grassland';
        const T = _obj(C.terrain) || {};
        const tm = T[tid] != null ? _num(T[tid], 1) : 1;
        const Wt = _obj(C.water) || {};
        let water = t && (t.hasRiver || t.river) ? _num(Wt.river, 0.06) : 0;
        const N = _obj(C.neighbours) || {};
        let towns = 0, fields = 0, sides = 0;
        for (const n of TownLand._neighbours(world, q, r)) {
            if (!n.t) continue;
            if (TownLand._wet(n.t)) { sides++; continue; }
            if (n.t.settlement) { towns++; continue; }
            if (TownLand._held(world, n.t, n.q, n.r)) fields++;
        }
        water += sides * _num(Wt.side, 0.06);
        const nb = Math.min(_num(N.max, 0.45), towns * _num(N.settlement, 0.07) + fields * _num(N.field, 0.04));
        const max = Math.max(1, Math.round(_num(C.hexPlots, 2400) * tm * Math.max(0.1, 1 - water) * (1 - nb)));
        const Wd = _obj(C.wood) || {};
        return { max, woodShare: Math.max(0, Math.min(1, _num(Wd[tid], 0))), terrain: tid, parts: { terrain: tm, water: _r1(water * 100) / 100, sides, towns, fields } };
    },

    /** The town's land record (null where land limits are off or it keeps no housing). */
    of(s) {
        const h = s && s.housing;
        return h && _obj(h.land) ? h.land : null;
    },

    /**
     * Count (or recount) the town's ground: on first sight, every recountDays,
     * and when its walls go up or are rebuilt in stone. → the land record.
     */
    refresh(world, s, day) {
        if (!TownLand.on() || !world || !s || !Number.isFinite(s.q) || !Number.isFinite(s.r)) return null;
        const h = TownHousing.ensure(s);
        if (!h) return null;
        const C = TownLand.config();
        let L = _obj(h.land);
        const due = !L || !Number.isFinite(L.max) || day - _num(L.at, -1e9) >= Math.max(1, _num(C.recountDays, 120));
        if (due) {
            const c = TownLand.count(world, s.q, s.r);
            if (!L) {
                // (what the town stands on is cleared ground; of the rest, the wood's share is under trees)
                L = h.land = { v: 1, max: c.max, wood: Math.round(Math.max(0, c.max - h.plots) * c.woodShare), wall: null, sub: null, subAt: null, sats: [], at: day, cleared: 0 };
            } else {
                L.max = c.max;
                L.at = day;
            }
            L.wood = Math.max(0, Math.min(_num(L.wood), Math.round(L.max - h.plots)));
            L.terrain = c.terrain;
        }
        // Its walls: the ground inside them is the town's until it builds beyond
        const st = TownEras.state(s);
        const kind = st && st.walls ? st.walls.kind : null;
        if (kind && kind !== L.wallKind) {
            const slack = L.wallKind ? _num(C.stoneSlack, 1.1) : _num(C.wallSlack, 1.25);
            const ring = Math.round(Math.max(h.plots, _num(h.foot)) * slack);
            L.wall = Math.min(L.max, Math.max(_num(L.wall), ring));
            L.wallKind = kind;
        } else if (!kind && L.wallKind) {
            // (walls pulled down or never rebuilt: the town is open again)
            L.wall = null;
            delete L.wallKind;
            L.sub = null;
        }
        return L;
    },

    /**
     * Clear wooded ground for the town's builders: up to clear.perWeek[type] plots,
     * no more than `need` and the wood left. The felled timber goes to its market.
     * → { plots, wood, days (a crew's working days for it), crew } or null.
     */
    clear(s, need) {
        const L = TownLand.of(s);
        if (!L || !(_num(L.wood) > 0) || !(need > 0)) return null;
        const K = _obj(TownLand.config().clear) || {};
        const per = _obj(K.perWeek) || {};
        const max = Math.max(0, Math.floor(_num(per[s.type], _num(per.village, 2))));
        const plots = Math.min(max, Math.ceil(need), Math.floor(L.wood));
        if (!(plots > 0)) return null;
        L.wood = Math.max(0, L.wood - plots);
        L.cleared = _num(L.cleared) + plots;
        const wood = Math.round(plots * _num(K.woodPerPlot, 6));
        if (wood > 0 && SettlementMarket.tracks('wood')) SettlementMarket.add(s, 'wood', wood);
        return { plots, wood, days: Math.round(plots * _num(K.days, 5)), crew: Math.max(1, Math.floor(_num(K.crew, 2))) };
    },

    /**
     * Free neighbouring hexes a town's people may build a village on: dry ground
     * (not suburb/satellite `never` terrain), no town, nothing held there, of its
     * realm or no one's. Best ground first. → [{ q, r, t, max }]
     */
    freeHexes(world, s) {
        if (!world || !s || typeof world.getTile !== 'function') return [];
        const never = new Set(Array.isArray(TownHousing.config().satellite.never) ? TownHousing.config().satellite.never : []);
        const out = [];
        for (const n of TownLand._neighbours(world, s.q, s.r)) {
            const t = n.t;
            if (!t || !t.terrain || t.terrain.passable === false || t.settlement || TownLand._wet(t) || never.has(t.terrain.id)) continue;
            if (t.kingdom != null && s.kingdom != null && t.kingdom !== s.kingdom) continue;
            if (t.kingdom != null && s.kingdom == null) continue;
            if (TownLand._held(world, t, n.q, n.r)) continue;
            out.push({ q: n.q, r: n.r, t, max: TownLand.count(world, n.q, n.r).max });
        }
        return out.sort((a, b) => b.max - a.max || a.q - b.q || a.r - b.r);
    },
};

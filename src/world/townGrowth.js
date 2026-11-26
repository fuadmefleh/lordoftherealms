// ============================================================
// TOWN GROWTH — newcomers' camps, and the streets laid out for them
// ============================================================
// When many people reach a town at once (a migrant column, a week's settlers,
// refugees, the player's paid colonists) they cannot all be housed: they camp
// on the outskirts until houses go up for them. This module is the town's
// record of it, kept on the settlement (saved with the tile):
//
//   settlement.growth = {
//       v, seq,
//       arr:     [[day, n, from, kind]]      arrivals of the last days (noteArrival)
//       camp:    { id, since, n, housed, from, hh: [{ ids, head, lot }], lots: [{ id, n, hh, ready }], next }
//                                            the camp while it stands (systems/arrivalCamps.js runs it)
//       cleared: { id, d, hub? }             the camp struck: its trodden ground grows back (fadeDays)
//       streets: [{ id, name, d, lots: [id], kind?: 'infill', side? }]
//                                            the streets laid out at the town's edge, in order
//                                            (infill: plots among the town's yards, no lane of its own)
//       noRoom:  day                         the last survey found no room (none tried for noRoomDays)
//   }
//
// The streets are laid on the town's street map after its plan and its water
// (layStreets): the plan from the town's seed, the water of the hex, then each
// new street in the order it was laid — at the edge of the built town (outside
// its walls) on the side with most room: across the road north or south, or
// along the road out east or west, its lots along both sides; what no side
// has room for is infill on the town's yards — hash-placed from the town and
// the street's number, drawing nothing from the map's dice, so the town
// underneath stands as it stood and the same streets come back every visit.
// A street is surveyed on the map before it is kept (fitStreet): the lot book
// never holds a lot the map cannot show. The map is laid out anew when a
// street is added (stamp).
//
// Pure: no randomness, no globals; no import-time effects. Data: data/townGrowth.json.

import { DataLoader } from '../core/dataLoader.js';
import { CustomObjects } from './customObjects.js';
import { TownProps } from './townProps.js';
import { LotBook } from './lotBook.js';
import { markHash } from './townMarks.js';

const DEFAULTS = {
    enabled: true,
    windowDays: 7,
    share: 0.08,
    minPeople: 15,
    maxPeople: 60,
    perLot: { village: 8, town: 10, city: 12, capital: 14 },
    lotsPerWeek: { village: 2, town: 2, city: 3, capital: 3 },
    buildDays: { village: 24, town: 28, city: 32, capital: 36 },
    house: { village: { wood: 4, planks: 4 }, town: { planks: 6, stone: 2 }, city: { planks: 6, stone: 4 }, capital: { planks: 6, stone: 5 } },
    lotsPerStreet: 6,
    maxStreets: { village: 6, town: 4, city: 2, capital: 0 },
    crowdDays: 45,
    fadeDays: 40,
    tentPeople: 5,
    maxTents: 14,
    noRoomDays: 90,
    streetNames: ["Settlers' Lane", 'New Row', 'Wagon Lane', 'Far Street', 'Tenter Lane', "Newcomers' Way", 'Long Acre', 'Fieldgate'],
    tents: ['tp_tent_canvas', 'tp_tent_canvas_open', 'tp_tent_canvas', 'tp_tent_patch'],
    firePer: 5,
    wagonPer: 4,
    maxWagons: 3,
    linePer: 3,
    maxLines: 4,
    beasts: ['goat', 'chicken', 'chicken', 'sheep', 'goat', 'cow'],
    maxBeasts: 6,
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _h = markHash;

let _src;
let _cfg = null;

/** Objects a new street may clear from its ground (fields, fences, hay, trees, bushes): never walls, memorials, graves, the square. */
function _clearable(o) {
    if (!o || o.townWall || o.memory) return false;
    const d = CustomObjects.getDef(o.defId);
    const tags = (d && d.tags) || [];
    if (tags.some(t => t === 'memory' || t === 'grave' || t === 'square' || t === 'hearth' || t === 'hearthOut')) return false;
    return true;
}

export const TownGrowth = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townGrowth : undefined;
        if (_cfg && src === _src) return _cfg;
        _src = src;
        const d = _obj(src) || {};
        _cfg = { ...DEFAULTS, ...d };
        for (const k of ['perLot', 'lotsPerWeek', 'buildDays', 'maxStreets']) _cfg[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
        _cfg.house = { ...DEFAULTS.house, ...(_obj(d.house) || {}) };
        return _cfg;
    },

    on() { return TownGrowth.config().enabled !== false; },

    /** A per-type setting (a village's when the type has none). */
    byType(key, type) {
        const t = TownGrowth.config()[key] || {};
        return t[type] != null ? t[type] : t.village;
    },

    /** The settlement's growth record (made when `create`). */
    of(settlement, create = false) {
        if (!settlement || typeof settlement !== 'object') return null;
        if (!_obj(settlement.growth)) {
            if (!create) return null;
            settlement.growth = { v: 1, seq: 0, arr: [], camp: null, streets: [] };
        }
        const g = settlement.growth;
        if (!Array.isArray(g.arr)) g.arr = [];
        if (!Array.isArray(g.streets)) g.streets = [];
        g.seq = _num(g.seq);
        return g;
    },

    /** The camp standing at the town, or null. */
    camp(settlement) {
        const g = TownGrowth.of(settlement);
        return (g && _obj(g.camp)) || null;
    },

    /**
     * The households still under canvas, a tent to each: the camp's roster
     * households not yet housed; a town that keeps no roster, its campers in
     * families of tentPeople. 0 with no camp.
     */
    tentHouseholds(settlement) {
        const camp = TownGrowth.camp(settlement);
        if (!camp) return 0;
        const under = Math.max(0, _num(camp.n) - _num(camp.housed));
        if (under <= 0) return 0;
        const hh = Array.isArray(camp.hh) ? camp.hh : [];
        if (hh.length) return Math.max(1, hh.filter(h => !h.housed).length);
        return Math.ceil(under / Math.max(1, _num(TownGrowth.config().tentPeople, 5)));
    },

    // ── What a standing camp does to the town (data effects; read by systems/illness.js,
    // systems/npcTheft.js, world/townLabour.js; its mood by systems/arrivalCamps.js) ──

    /** Its people under canvas as a share of the town's (0 with no camp). */
    campShare(settlement) {
        const camp = TownGrowth.camp(settlement);
        if (!camp) return 0;
        const under = Math.max(0, _num(camp.n) - _num(camp.housed));
        return under / Math.max(1, _num(settlement.population) || under);
    },

    /** Are the campers going short (nothing given them to eat)? */
    campHungry(settlement) {
        const camp = TownGrowth.camp(settlement);
        return !!camp && !(_num(camp.food) > 0);
    },

    /**
     * The sickness a camp brings (effects.sick): × a camper's own risk (crowding),
     * more again for what comes in the water; less while they are fed; × everyone
     * else's in the town by the camp's share, at most townMax. null with no camp.
     */
    campRisk(settlement) {
        const camp = TownGrowth.camp(settlement);
        if (!camp || !(_num(camp.n) - _num(camp.housed) > 0)) return null;
        const S = (TownGrowth.config().effects || {}).sick || {};
        const fed = !TownGrowth.campHungry(settlement);
        const camper = _num(S.camper, 1.5) * (fed ? _num(S.fed, 0.75) : 1);
        return {
            camper: Math.round(camper * 100) / 100,
            water: Math.round(camper * _num(S.water, 1.3) * 100) / 100,
            town: Math.round(Math.min(_num(S.townMax, 1.12), 1 + TownGrowth.campShare(settlement) * _num(S.townPer, 0.6)) * 100) / 100,
        };
    },

    /** What a camp adds to the town's crime (0..max; effects.crime; the more when they go hungry). */
    campCrime(settlement) {
        const share = TownGrowth.campShare(settlement);
        if (!share) return 0;
        const K = (TownGrowth.config().effects || {}).crime || {};
        const hungry = TownGrowth.campHungry(settlement) ? _num(K.hungry, 1.5) : 1;
        return Math.round(Math.min(_num(K.max, 0.1), share * _num(K.perShare, 0.8) * hungry) * 1000) / 1000;
    },

    /** × the town's nightly burglaries and the cutpurses' day while a camp stands (1 with none; at most theftMax). */
    campTheftMult(settlement) {
        const share = TownGrowth.campShare(settlement);
        if (!share) return 1;
        const K = (TownGrowth.config().effects || {}).crime || {};
        const hungry = TownGrowth.campHungry(settlement) ? _num(K.hungry, 1.5) : 1;
        return Math.round(Math.min(_num(K.theftMax, 1.8), 1 + share * _num(K.theft, 2.5) * hungry) * 100) / 100;
    },

    /** The streets laid out at the town's edge, oldest first ([] for none). */
    streets(settlement) {
        const g = TownGrowth.of(settlement);
        return g ? g.streets : [];
    },

    /**
     * People came to settle (a column in, a week's settlers, colonists, refugees).
     * Written on the town for systems/arrivalCamps.js to reckon with; world-layer
     * callers (world/colonization.js) note theirs here too. → the growth record.
     */
    noteArrival(settlement, n, day, from = null, kind = 'migrants') {
        if (!TownGrowth.on() || !settlement || !(n > 0) || kind === 'return') return null;
        const g = TownGrowth.of(settlement, true);
        g.arr.push([Math.floor(_num(day)), Math.round(n), from || null, kind || 'migrants']);
        const keep = Math.max(1, _num(TownGrowth.config().windowDays, 7)) * 2;
        const d0 = Math.floor(_num(day)) - keep;
        g.arr = g.arr.filter(a => a[0] >= d0).slice(-40);
        return g;
    },

    /**
     * A place still a camp of tents itself (a clan's village of the Dawn of Man, a colony
     * freshly founded in play: world/innerMap/camp.js _isDawnVillage): newcomers just pitch
     * their tents among the rest.
     */
    tentVillage(s) {
        if (!s) return false;
        if (s.dawnBorn) {
            if (s.campEra === true) return s.type === 'village' || s.type === 'town';
            if (s.campEra === false) return false;
            return s.type === 'village';
        }
        return s.type === 'village' && !!s.colony && !s.campOutgrown && _num(s.population) < 150;
    },

    /** People arrived in the last windowDays (up to `day`). */
    recent(settlement, day) {
        const g = TownGrowth.of(settlement);
        if (!g) return 0;
        const w = Math.max(1, _num(TownGrowth.config().windowDays, 7));
        return g.arr.reduce((s, a) => (a[0] > day - w && a[0] <= day ? s + _num(a[1]) : s), 0);
    },

    /** How many arriving at once make a camp: share of the town's people, within minPeople..maxPeople. */
    threshold(settlement) {
        const C = TownGrowth.config();
        const pop = Math.max(0, _num(settlement && settlement.population));
        return Math.max(_num(C.minPeople, 15), Math.min(_num(C.maxPeople, 60), Math.ceil(pop * _num(C.share, 0.08))));
    },

    /** The size of a lot laid along a new street (the middle of the town type's lot sizes). */
    lotSize(type) {
        const wR = LotBook.byType('width', type) || [6, 8];
        const dR = LotBook.byType('depth', type) || [5, 6];
        return { w: Math.round((_num(wR[0], 6) + _num(wR[1], 6)) / 2), h: Math.round((_num(dR[0], 6) + _num(dR[1], 6)) / 2) };
    },

    /** Every lot along the town's new streets: [{ id, w, h, street }]. */
    streetLots(settlement) {
        const sz = TownGrowth.lotSize(settlement && settlement.type);
        const out = [];
        for (const st of TownGrowth.streets(settlement)) for (const id of st.lots || []) out.push({ id, w: sz.w, h: sz.h, street: st.id });
        return out;
    },

    /** May the town lay out another street (its type's maxStreets)? */
    canLayStreet(settlement) {
        const max = Math.max(0, Math.floor(_num(TownGrowth.byType('maxStreets', settlement && settlement.type), 0)));
        return TownGrowth.streets(settlement).length < max;
    },

    /**
     * A new street at the town's edge: named (no two alike in a town) and its lots
     * numbered (g<n>a, g<n>b, …). → the street record.
     */
    addStreet(settlement, day) {
        const g = TownGrowth.of(settlement, true);
        const C = TownGrowth.config();
        // (numbered past every street the town has had: one taken away again never lends its number)
        const n = Math.max(g.streets.length, _num(g.lastStreet), ...g.streets.map(s => parseInt(String(s.id).slice(1), 10) || 0)) + 1;
        g.lastStreet = n;
        const key = settlement.foundingName || settlement.name || `${settlement.q},${settlement.r}`;
        const names = Array.isArray(C.streetNames) && C.streetNames.length ? C.streetNames : DEFAULTS.streetNames;
        const used = new Set(g.streets.map(s => s.name));
        const start = Math.floor(_h(key, 'street', n) * names.length);
        let name = null;
        for (let i = 0; i < names.length && !name; i++) if (!used.has(names[(start + i) % names.length])) name = names[(start + i) % names.length];
        if (!name) name = `${names[start % names.length]} ${n}`;
        const count = Math.max(1, Math.floor(_num(C.lotsPerStreet, 6)));
        const lots = Array.from({ length: count }, (_, i) => `g${n}${String.fromCharCode(97 + i)}`);
        const st = { id: `s${n}`, name, d: Math.floor(_num(day)), lots };
        g.streets.push(st);
        return st;
    },

    /**
     * The street just added, cut to what its town's map has room for (`laid`: the lots
     * InnerMap.surveyGrowth found laid on the map, all streets'): only the lots that
     * show are kept; laid only inside the town it is infill (no lane of its own, named
     * for the yards); none fit — it is taken away again. null `laid` (no map to survey)
     * keeps it whole. → the street kept, or null.
     */
    fitStreet(settlement, st, laid) {
        const g = TownGrowth.of(settlement);
        if (!g || !st || !Array.isArray(laid)) return st || null;
        const mine = laid.filter(l => l.street === st.id);
        const ids = new Set(mine.map(l => l.id));
        st.lots = (st.lots || []).filter(id => ids.has(id));
        if (!st.lots.length) {
            g.streets = g.streets.filter(x => x !== st);
            return null;
        }
        if (mine.every(l => l.infill)) {
            st.kind = 'infill';
            st.name = `${settlement.name || 'the town'}'s back yards`;
        } else {
            const side = (mine.find(l => !l.infill) || {}).side;
            if (side) st.side = side;
        }
        return st;
    },

    /**
     * A street kept whole because its town's map could not be surveyed then (st.unsurveyed:
     * the designs not loaded) is fitted the first time its map is laid (world/innerMap/terrain.js):
     * its lots not on the map and not yet granted leave the lot book. → streets changed.
     */
    settleUnsurveyed(settlement, laid) {
        const g = TownGrowth.of(settlement);
        if (!g || !Array.isArray(laid) || !g.streets.some(s => s.unsurveyed)) return 0;
        const onMap = new Set(laid.map(l => l.id));
        const held = (settlement.lotBook && settlement.lotBook.lots) || {};
        let n = 0;
        for (const st of g.streets.slice()) {
            if (!st.unsurveyed) continue;
            delete st.unsurveyed;
            const keep = (st.lots || []).filter(id => onMap.has(id) || held[id]);
            if (keep.length === (st.lots || []).length) continue;
            n++;
            st.lots = keep;
            if (!keep.length) g.streets = g.streets.filter(x => x !== st);
        }
        return n;
    },

    /** What the town's street map shows of its growth: laid out anew when a street is added. */
    stamp(settlement) {
        const n = TownGrowth.streets(settlement).length;
        return n ? `|grow${n}` : '';
    },

    // ── On the street map (after the planner and the water; world/innerMap/terrain.js) ──

    /**
     * Lay the town's new streets on its map, in the order they were laid out.
     * Each street goes to the side of the town with the most room for its lots:
     *   north or south — a lane across the road out, beyond the built town (and
     *     its walls), its lots on both sides of the lane, west and east of the road;
     *   east or west — along the road out (or a lane of its own where no road
     *     runs that way), its lots fronting it on both sides, marching outward.
     * The next street on a side goes out beyond the last (the ground a street
     * takes is the town's). Lots no side has room for are found inside the town:
     * infill on its gardens and yards, each fronting a street. A street record of
     * kind 'infill' is all infill. A lot that fits nowhere is not laid (and the
     * town never grants one: systems/arrivalCamps.js surveys a street before it is
     * kept, InnerMap.surveyGrowth). Clears the fields, fences and trees in the way;
     * never a building, the water, the walls, a pier. Draws nothing from the map's dice.
     * opts: { center, roadTiles (the layout's list, added to) }.
     * → the lots laid: [{ id, q0, q1, r0, r1, w, h, gate, street, side, infill? }] (also on tiles._lots).
     */
    layStreets(tiles, settlement, opts = {}) {
        const streets = TownGrowth.streets(settlement);
        if (!streets.length || !Array.isArray(tiles) || !tiles.length) return [];
        const H = tiles.length, W = tiles[0].length;
        const center = opts.center || { q: Math.floor(W / 2), r: Math.floor(H / 2) };
        const key = settlement.foundingName || settlement.name || `${settlement.q},${settlement.r}`;
        const { w, h: dpt } = TownGrowth.lotSize(settlement.type);
        const roadTiles = Array.isArray(opts.roadTiles) ? opts.roadTiles : null;
        const out = [];
        const G = TownGrowth._ground(tiles);
        const sides = ['S', 'N', 'E', 'W'];
        // (the town's own order of sides: which it grows to first when they have the same room)
        const pref = sides.slice().sort((a, b) => _h(key, 'growSide', a) - _h(key, 'growSide', b));
        const lastOn = {};
        streets.forEach((st, i) => {
            const ids = (st.lots || []).slice();
            if (!ids.length) return;
            let plan = null;
            if (st.kind !== 'infill') {
                const reach = TownGrowth._reach(tiles, center);
                // (alternating as the town grows: the side just built on goes last among equals)
                const order = pref.slice().sort((a, b) => (lastOn[a] || -1) - (lastOn[b] || -1));
                for (const side of order) {
                    const p = TownGrowth._planSide(tiles, G, side, reach, center, w, dpt, ids.length);
                    if (p && p.lots.length && (!plan || p.lots.length > plan.lots.length)) plan = p;
                    if (plan && plan.lots.length >= ids.length) break;
                }
            }
            let used = 0;
            if (plan) {
                lastOn[plan.side] = i + 1;
                TownGrowth._applyPlan(tiles, plan, roadTiles);
                plan.lots.forEach(l => {
                    const id = ids[used++];
                    TownGrowth._markLot(tiles, l, id);
                    out.push({ id, q0: l.q0, q1: l.q1, r0: l.r0, r1: l.r1, w, h: dpt, gate: l.gate, street: st.id, side: plan.side });
                });
            }
            // What is left: infill on the town's gardens and yards, fronting a street
            if (used < ids.length) {
                for (const l of TownGrowth._infill(tiles, G, center, w, dpt, ids.length - used, `${key}|${st.id}`)) {
                    const id = ids[used++];
                    TownGrowth._markLot(tiles, l, id);
                    out.push({ id, q0: l.q0, q1: l.q1, r0: l.r0, r1: l.r1, w, h: dpt, gate: l.gate, street: st.id, side: 'in', infill: true });
                }
            }
        });
        if (out.length) TownProps.joinFences(tiles);
        if (Array.isArray(tiles._lots)) for (const l of out) tiles._lots.push(l);
        else tiles._lots = out.slice();
        return out;
    },

    /** The ground tests a new street's lots and lane go by. */
    _ground(tiles) {
        const H = tiles.length, W = tiles[0].length;
        const wet = t => !!(t && (t._wet || t._bridge || t._ford || (t.subTerrain && /water/.test(t.subTerrain.id || ''))));
        const anchorHard = t => {
            if (!t || !t.customObjectPart) return false;
            const a = tiles[t.customObjectPart.anchorR] && tiles[t.customObjectPart.anchorR][t.customObjectPart.anchorQ];
            return !!(a && a.customObject && !_clearable(a.customObject));
        };
        // (and ground kept for something laid later: the churchyard's graves, world/churchyard.js)
        const solid = t => !t || t.customBuilding || t.customBuildingPart || t.building || t._townWall || t._pier || t._deck || wet(t) || t._reserved || t._grave
            || anchorHard(t) || (t.customObject && !_clearable(t.customObject));
        return {
            /** May a lot (or its margin) take this cell? */
            free: (q, r) => q >= 3 && r >= 3 && q < W - 3 && r < H - 3 && !!tiles[r][q] && !solid(tiles[r][q])
                && !tiles[r][q].isRoad && !tiles[r][q]._lot && !tiles[r][q]._plaza,
            /** May a lane run over this cell (a road already there is kept)? */
            lane: (q, r) => q >= 2 && r >= 2 && q < W - 2 && r < H - 2 && !!tiles[r][q] && !solid(tiles[r][q]) && !tiles[r][q]._lot && !tiles[r][q]._plaza,
            road: (q, r) => !!(tiles[r] && tiles[r][q] && tiles[r][q].isRoad && !wet(tiles[r][q])),
        };
    },

    /** How far the built town (its core, its walls, the streets laid since) reaches from its middle: { n, s, e, w }. */
    _reach(tiles, center) {
        const H = tiles.length, W = tiles[0].length;
        let n = center.r, s = center.r, e = center.q, w = center.q;
        const R = 46;
        for (let r = Math.max(0, center.r - R); r <= Math.min(H - 1, center.r + R); r++) {
            for (let q = Math.max(0, center.q - R); q <= Math.min(W - 1, center.q + R); q++) {
                const t = tiles[r][q];
                if (!t || !(t._townCore || t._townWall || t._lot)) continue;
                if (r < n) n = r;
                if (r > s) s = r;
                if (q > e) e = q;
                if (q < w) w = q;
            }
        }
        const box = tiles._townWalls && tiles._townWalls.box;
        if (box) { n = Math.min(n, box.r0 - 2); s = Math.max(s, box.r1 + 2); w = Math.min(w, box.q0 - 2); e = Math.max(e, box.q1 + 2); }
        return { n, s, e, w };
    },

    /**
     * Where a street on `side` would go, and how many of its `want` lots fit
     * (nothing written). → { side, lots: [{ q0, q1, r0, r1, gate }], lane: [[q, r]], track: [[q, r]], band } or null.
     */
    _planSide(tiles, G, side, reach, center, w, dpt, want) {
        const H = tiles.length, W = tiles[0].length;
        const laneW = 2;
        const lotFits = (q0, r0, gate) => {
            const q1 = q0 + w - 1, r1 = r0 + dpt - 1;
            for (let r = r0; r <= r1; r++) for (let q = q0 - 1; q <= q1 + 1; q++) if (!G.free(q, r)) return false;
            // (and a row of open ground behind it, away from its street)
            const back = gate === 'south' ? r0 - 1 : r1 + 1;
            for (let q = q0; q <= q1; q++) if (!G.free(q, back) && !G.road(q, back)) return false;
            return true;
        };
        const plan = { side, lots: [], lane: [], track: [], band: null };
        if (side === 'N' || side === 'S') {
            const dir = side === 'S' ? 1 : -1;
            const band = 2 * dpt + laneW;
            const b0 = dir > 0 ? reach.s + 2 : reach.n - 2 - band + 1;
            const b1 = b0 + band - 1;
            if (b0 < 3 || b1 > H - 4) return null;
            const y = b0 + dpt;
            // Where the road out crosses the lane's rows: the run of road nearest the town's middle
            let c0 = null, c1 = null;
            for (let d = 0; d <= 14 && c0 == null; d++) {
                for (const q of [center.q - d, center.q + d]) if (G.road(q, y)) { c0 = c1 = q; break; }
            }
            if (c0 != null) {
                while (G.road(c0 - 1, y)) c0--;
                while (G.road(c1 + 1, y)) c1++;
            }
            const linked = c0 != null;
            if (!linked) { c0 = center.q; c1 = center.q + 1; }
            // The lots, slot by slot (north side, south side; west of the road, east of it)
            for (let s = 0; s < 16 && plan.lots.length < want; s++) {
                const kk = Math.floor(s / 4);
                const which = s % 4;   // 0 NW, 1 SE, 2 NE, 3 SW
                const northSide = which === 0 || which === 2;
                const west = which === 0 || which === 3;
                const q0 = west ? c0 - (kk + 1) * (w + 1) : c1 + 2 + kk * (w + 1);
                const r0 = northSide ? b0 : y + laneW;
                const gate = northSide ? 'south' : 'north';
                if (!lotFits(q0, r0, gate)) continue;
                let ok = true;
                for (let q = q0; q <= q0 + w - 1 && ok; q++) for (let r = y; r < y + laneW && ok; r++) if (!G.lane(q, r)) ok = false;
                if (ok) plan.lots.push({ q0, q1: q0 + w - 1, r0, r1: r0 + dpt - 1, gate, west });
            }
            if (!plan.lots.length) return plan;
            const westEnd = Math.min(c0, ...plan.lots.filter(l => l.west).map(l => l.q0 - 1));
            const eastEnd = Math.max(c1, ...plan.lots.filter(l => !l.west).map(l => l.q1 + 1));
            for (let q = westEnd; q <= eastEnd; q++) for (let r = y; r < y + laneW; r++) if (G.lane(q, r) && !G.road(q, r)) plan.lane.push([q, r]);
            // No road out there (it bent away): a track back to the nearest street
            if (!linked) {
                const step = dir > 0 ? -1 : 1;
                for (let r = dir > 0 ? y - 1 : y + laneW, n = 0; n < 40 && r > 1 && r < H - 2; r += step, n++) {
                    if (G.road(c0, r)) break;
                    for (const q of [c0, c1]) if (G.lane(q, r)) plan.track.push([q, r]);
                }
            }
            plan.band = { q0: westEnd - 1, q1: eastEnd + 1, r0: b0 - 1, r1: b1 + 1 };
            return plan;
        }
        // East or west: along the road out, its lots fronting it on both sides
        const dir = side === 'E' ? 1 : -1;
        const x0 = dir > 0 ? reach.e + 2 : reach.w - 2;
        if (x0 < 4 || x0 > W - 5) return null;
        // The road out on that side: the run of road nearest the town's middle row, at the town's edge
        let y0 = null, y1 = null;
        for (let d = 0; d <= 14 && y0 == null; d++) {
            for (const r of [center.r - d, center.r + d]) if (G.road(x0, r)) { y0 = y1 = r; break; }
        }
        if (y0 != null) {
            while (G.road(x0, y0 - 1) && y1 - y0 < 3) y0--;
            while (G.road(x0, y1 + 1) && y1 - y0 < 3) y1++;
        }
        const own = y0 == null;
        if (own) { y0 = center.r; y1 = center.r + laneW - 1; }
        const rowsN = [y0 - dpt, y0 - 1], rowsS = [y1 + 1, y1 + dpt];
        if (rowsN[0] < 4 || rowsS[1] > H - 5) return null;
        // Lot by lot outward, north of the road then south of it; the lane (where there is no road) runs on with them
        let far = x0;
        for (let k = 0; k < 8 && plan.lots.length < want; k++) {
            const near = x0 + dir * (1 + k * (w + 1));
            const q0 = dir > 0 ? near : near - w + 1;
            const q1 = q0 + w - 1;
            if (q0 < 4 || q1 > W - 5) break;
            // (the road, or the lane, must run along the lot's whole front)
            let front = true;
            for (let q = q0; q <= q1 && front; q++) for (let r = y0; r <= y1 && front; r++) if (!G.road(q, r) && !G.lane(q, r)) front = false;
            if (!front) break;
            let any = false;
            for (const [r0, gate] of [[rowsN[0], 'south'], [rowsS[0], 'north']]) {
                if (plan.lots.length >= want) break;
                if (!lotFits(q0, r0, gate)) continue;
                plan.lots.push({ q0, q1, r0, r1: r0 + dpt - 1, gate });
                any = true;
            }
            if (any) far = dir > 0 ? q1 + 1 : q0 - 1;
        }
        if (!plan.lots.length) return plan;
        const qa = Math.min(x0, far), qb = Math.max(x0, far);
        for (let q = qa; q <= qb; q++) for (let r = y0; r <= y1; r++) if (!G.road(q, r) && G.lane(q, r)) plan.lane.push([q, r]);
        // A lane of its own: a track back along its row to the town's nearest street
        if (own || !G.road(x0 - dir, y0)) {
            for (let q = x0 - dir, n = 0; n < 40 && q > 1 && q < W - 2; q -= dir, n++) {
                if (G.road(q, y0) || G.road(q, y1)) break;
                for (let r = y0; r <= y1; r++) if (G.lane(q, r)) plan.track.push([q, r]);
            }
        }
        plan.band = { q0: qa - 1, q1: qb + 1, r0: rowsN[0] - 1, r1: rowsS[1] + 1 };
        return plan;
    },

    /** Lay a street's lane and track (its lots are marked by _markLot); the ground about it is the town's. */
    _applyPlan(tiles, plan, roadTiles) {
        for (const [q, r] of plan.lane) TownGrowth._road(tiles, q, r, roadTiles);
        for (const [q, r] of plan.track) TownGrowth._road(tiles, q, r, roadTiles);
        const b = plan.band;
        if (b) for (let r = b.r0; r <= b.r1; r++) for (let q = b.q0; q <= b.q1; q++) {
            const t = tiles[r] && tiles[r][q];
            if (t) { t._townCleared = true; t._townCore = true; delete t._townFade; }
        }
    },

    /** A lot taken: cleared, numbered, the town's. */
    _markLot(tiles, l, id) {
        for (let r = l.r0; r <= l.r1; r++) for (let q = l.q0; q <= l.q1; q++) {
            const t = tiles[r][q];
            TownGrowth._clearAt(tiles, q, r);
            t._lot = id;
            t._townCleared = true;
            t._townCore = true;
            delete t._townFade;
        }
    },

    /**
     * Room inside the town: lots on its gardens and yards (open ground among its
     * streets, cleared of what grows there), each fronting a street on its north
     * or south side, nearest the middle first. → up to n lots [{ q0, q1, r0, r1, gate }].
     */
    _infill(tiles, G, center, w, dpt, n, salt) {
        const H = tiles.length, W = tiles[0].length;
        const reach = TownGrowth._reach(tiles, center);
        const cands = [];
        for (let r0 = Math.max(3, reach.n - 2); r0 + dpt - 1 <= Math.min(H - 4, reach.s + 2); r0++) {
            for (let q0 = Math.max(4, reach.w - 2); q0 + w - 1 <= Math.min(W - 5, reach.e + 2); q0++) {
                const r1 = r0 + dpt - 1, q1 = q0 + w - 1;
                // its front on a street: the row below (the lot's gate south) or above it (gate north)
                let gate = null;
                const along = (rr) => { let c = 0; for (let q = q0; q <= q1; q++) if (G.road(q, rr)) c++; return c >= Math.ceil(w / 2); };
                if (along(r1 + 1)) gate = 'south';
                else if (along(r0 - 1)) gate = 'north';
                if (!gate) continue;
                let ok = true;
                for (let r = r0; r <= r1 && ok; r++) for (let q = q0 - 1; q <= q1 + 1 && ok; q++) if (!G.free(q, r)) ok = false;
                if (!ok) continue;
                const d = Math.abs(q0 + w / 2 - center.q) + Math.abs(r0 + dpt / 2 - center.r);
                cands.push({ q0, q1, r0, r1, gate, sc: d + _h(salt, 'infill', q0, r0) * 3 });
            }
        }
        cands.sort((a, b) => a.sc - b.sc);
        const got = [];
        for (const c of cands) {
            if (got.length >= n) break;
            if (got.some(g => c.q0 <= g.q1 + 1 && c.q1 >= g.q0 - 1 && c.r0 <= g.r1 + 1 && c.r1 >= g.r0 - 1)) continue;
            got.push(c);
        }
        return got;
    },

    /** A tile of the new street: bare earth, walkable, on the town's road list. */
    _road(tiles, q, r, roadTiles) {
        const t = tiles[r] && tiles[r][q];
        if (!t || t.isRoad) return;
        TownGrowth._clearAt(tiles, q, r);
        t.isRoad = true;
        t.subTerrain.passable = true;
        t.baseTerrain = 'dirt';
        t.subTerrain.id = 'dirt';
        t.subTerrain.name = 'Road';
        t.subTerrain.color = '#8b7355';
        delete t._fieldSoil;
        delete t._fieldGreen;
        t._townCore = true;
        delete t._townFade;
        if (roadTiles) roadTiles.push({ q, r });
    },

    /** Take away the clearable thing standing on (q, r) — all of it (a field's fence with its field). */
    _clearAt(tiles, q, r) {
        const t = tiles[r] && tiles[r][q];
        if (!t) return;
        let aq = q, ar = r;
        if (t.customObjectPart) { aq = t.customObjectPart.anchorQ; ar = t.customObjectPart.anchorR; }
        const a = tiles[ar] && tiles[ar][aq];
        const o = a && a.customObject;
        if (!o) { if (t.customObjectPart) { t.customObjectPart = null; if (!t._wet) t.subTerrain.passable = true; } return; }
        if (!_clearable(o)) return;
        const def = CustomObjects.getDef(o.defId);
        const b = (def && def.bounds) || { minCol: -4, maxCol: 4, minRow: -8, maxRow: 0 };
        a.customObject = null;
        if (a.subTerrain && !a._wet) a.subTerrain.passable = true;
        const tilled = !!(def && def.tilled);
        for (let rr = ar + b.minRow - 1; rr <= ar + b.maxRow + 1; rr++) {
            for (let qq = aq + b.minCol - 1; qq <= aq + b.maxCol + 1; qq++) {
                const c = tiles[rr] && tiles[rr][qq];
                if (!c) continue;
                const p = c.customObjectPart;
                if (p && p.anchorQ === aq && p.anchorR === ar) {
                    c.customObjectPart = null;
                    if (c.subTerrain && !c._wet) c.subTerrain.passable = true;
                }
                if (tilled) { delete c._fieldSoil; delete c._fieldGreen; }
            }
        }
        // (a field's fence goes with it)
        if (tilled) {
            for (let rr = ar + b.minRow - 1; rr <= ar + b.maxRow + 1; rr++) {
                for (let qq = aq + b.minCol - 1; qq <= aq + b.maxCol + 1; qq++) {
                    const c = tiles[rr] && tiles[rr][qq];
                    const fd = c && c.customObject ? CustomObjects.getDef(c.customObject.defId) : null;
                    if (fd && (fd.tags || []).some(x => x === 'fence' || x === 'gate')) {
                        c.customObject = null;
                        if (c.subTerrain && !c._wet) c.subTerrain.passable = true;
                    }
                }
            }
        }
    },
};

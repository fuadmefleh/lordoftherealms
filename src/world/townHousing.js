// ============================================
// TOWN HOUSING — how many a town's houses hold, and what it builds next
// ============================================
// Every town keeps a count of its dwellings by type (settlement.housing,
// saved with the tile):
//
//   housing = { v, d: { type: n }, plots, q: [[type, readyDay, bare]],
//               cap, rooms (cached each week) }
//
// A dwelling of each type (data/townHousing.json types) houses `people` — a
// family and its kin, more in a stone tenement that rises a storey higher —
// and lets `rooms` to lodgers. The count is derived the first time from the
// town's people, its size and its era (mix, slack over its people); after
// that it changes only as houses are built (the town's own builders, weekly:
// `week`; the newcomers' houses and the player's tenements through
// `addDwelling`), burnt or sacked (`lose`).
//
//   capacity(s)          people the town's dwellings house (families)
//   rooms(s)             lodgers its rooms to let take besides
//   room(s)              people that can still be housed (capacity + rooms − people; < 0: sleeping rough)
//   crowd(s)             people ÷ capacity
//   nextDwellingType(s)  what goes up next on a plot: the town's own mix by size and era, denser
//                        (row houses, tenements) when its plots are scarce or its people crowded
//   rentMult / sickMult / fireMult / welfarePenalty / growthFactor — what the crowding does
//
// Plots: the town's building ground (its dwellings' feet plus free plots).
// A town short of free plots adds some at its edge each week (edgePlots: a
// village or a town as many as it lacks, a city or a capital few) — only
// while it has ground left (housing.land, counted from its hex, its walls and
// its neighbours by world/townLand.js: `landLeft`); the town-growth code adds
// a street's lots when it lays one (`addPlots`).
//
// Its ground gone and its people crowded, the builders pull down old hovels,
// cottages and houses for denser dwellings (redevelopment: `week`, queue
// entries [type, readyDay, bare, fromType]; housing.rd counts those done).
// A walled town that builds outside its walls has a suburb (land.sub: its
// dwellings `sub.d`, poorer, unwalled — `suburbCrime`, raided first in `lose`).
//
// Pure model: no RNG, no imports above world/. Tuned in data/townHousing.json.

import { DataLoader } from '../core/dataLoader.js';
import { SettlementMarket } from './settlementMarket.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const TYPES = ['village', 'town', 'city', 'capital'];
const ERAS = ['hearth', 'timber', 'stone', 'guild'];

const DEFAULTS = {
    enabled: true,
    lodgersPerRoom: 2,
    eraDefault: { village: 'timber', town: 'timber', city: 'stone', capital: 'stone' },
    types: {
        cottage: { name: 'Cottage', people: 6, rooms: 1, foot: 1, minType: 'village', materials: {}, days: 18, design: 'house' },
        house: { name: 'House', people: 7, rooms: 2, foot: 1, minType: 'village', materials: {}, days: 26, design: 'house' },
    },
    eraMult: {},
    mix: { village: { cottage: 0.8, house: 0.2 }, town: { house: 1 }, city: { house: 1 }, capital: { house: 1 } },
    dense: {},
    slack: 1.08,
    freePlots: { village: 1.2, town: 0.35, city: 0.15, capital: 0.08 },
    edgePlots: { village: 6, town: 4, city: 2, capital: 1 },
    daysPerYear: 120,
    build: { every: 7, aim: 1.05, perWeek: { village: 1, town: 1, city: 2, capital: 3 }, perThousand: 0.5, maxQueue: 40, denseBelow: 0.12, denseCrowd: 1.05, bareDays: 1.6 },
    land: { enabled: true, hexPlots: 2000, terrain: {}, wood: {}, water: { river: 0.06, side: 0.06 }, neighbours: { settlement: 0.07, field: 0.04, max: 0.45 }, wallSlack: 1.25, stoneSlack: 1.1, clear: { perWeek: {}, days: 5, crew: 2, woodPerPlot: 6 }, recountDays: 120 },
    redev: { enabled: true, from: ['hovel', 'cottage', 'house'], to: {}, village: {}, gain: 1.15, perWeek: { village: 0, town: 1, city: 2, capital: 3 }, perThousand: 0.15, maxBuilding: 12, minCrowd: 1.0, crew: 3, noticeEvery: 120 },
    suburb: { enabled: true, minPlots: 60, minCrowd: 1.0, mix: { cottage: 1 }, crime: 0.06, raidMult: 2.2, dwellingsPerStreet: 14, maxStreets: 4, settlers: 0.05, min: 40, max: 600, names: ['{p} Without'] },
    satellite: { enabled: true, minCrowd: 1.05, everyYears: 10, maxPerTown: 3, share: 0.06, min: 40, max: 500, grainDays: 30, woodPer: 0.05, names: ['Little {p}'], never: [] },
    effects: { rentPer: 1.5, rentMax: 2.5, rentMin: 0.75, sickPer: 2, sickMax: 1.8, firePer: 2.5, fireMax: 2.2, welfare: 0.6, welfareMax: 0.25, lodgerWeight: 0.3, growthStop: 0.12 },
    player: { kinds: {}, roomShare: 0.35, tenantChance: 0.1, leaveChance: 0.01, missChance: 0.04 },
};

let _src;
let _cfg = null;

function _type(t) { return TYPES.includes(t) ? t : 'village'; }

export const TownHousing = {
    TYPES,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townHousing : undefined;
        if (!_cfg || src !== _src) {
            _src = src;
            const d = _obj(src) || {};
            const c = { ...DEFAULTS, ...d };
            for (const k of ['build', 'effects', 'player', 'eraDefault', 'freePlots', 'edgePlots', 'land', 'redev', 'suburb', 'satellite']) c[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            c.build.perWeek = { ...DEFAULTS.build.perWeek, ...((d.build && d.build.perWeek) || {}) };
            c.typeIds = Object.keys(c.types || {});
            _cfg = c;
        }
        return _cfg;
    },

    on() { return TownHousing.config().enabled !== false; },

    /** A dwelling type's definition. */
    def(id) { return TownHousing.config().types[id] || null; },

    /** The town's era id (world/townEras.js, else by its size). */
    era(s) {
        const H = s && s.townEra && Array.isArray(s.townEra.history) ? s.townEra.history : null;
        const id = H && H.length ? H[H.length - 1][0] : null;
        return ERAS.includes(id) ? id : (TownHousing.config().eraDefault[_type(s && s.type)] || 'timber');
    },

    /** May this type be built in this town (its size, its era)? */
    allowed(s, id) {
        const d = TownHousing.def(id);
        if (!d) return false;
        if (TYPES.indexOf(_type(s && s.type)) < TYPES.indexOf(_type(d.minType))) return false;
        return !Array.isArray(d.eras) || d.eras.includes(TownHousing.era(s));
    },

    /** People one dwelling of a type houses in this town's era. */
    people(s, id) {
        const d = TownHousing.def(id);
        if (!d) return 0;
        const em = _obj(TownHousing.config().eraMult[id]);
        return _num(d.people) * _num(em && em[TownHousing.era(s)], 1);
    },

    /** The town's housing record, derived on first sight (from its people, size and era). */
    ensure(s) {
        if (!s || typeof s !== 'object') return null;
        const h = s.housing;
        if (_obj(h) && _obj(h.d) && Number.isFinite(h.plots)) return h;
        const C = TownHousing.config();
        const type = _type(s.type);
        const pop = Math.max(0, _num(s.population));
        const mix = { ...(_obj(C.mix[type]) || { house: 1 }) };
        // (only what the town's era raises: the rest of its mix goes to what it does)
        let wsum = 0;
        for (const id of Object.keys(mix)) { if (!TownHousing.allowed(s, id)) delete mix[id]; else wsum += _num(mix[id]); }
        if (!(wsum > 0)) { mix.house = 1; wsum = 1; }
        let avg = 0;
        for (const id of Object.keys(mix)) avg += _num(mix[id]) / wsum * TownHousing.people(s, id);
        const n = Math.max(1, Math.ceil(pop * _num(C.slack, 1.08) / Math.max(1, avg)));
        const d = {};
        let left = n, foot = 0;
        const ids = Object.keys(mix).sort((a, b) => mix[b] - mix[a]);
        ids.forEach((id, i) => {
            const k = i === ids.length - 1 ? left : Math.min(left, Math.round(n * _num(mix[id]) / wsum));
            if (k > 0) { d[id] = k; left -= k; foot += k * _num(TownHousing.def(id).foot, 1); }
        });
        const rec = { v: 1, d, plots: Math.round(foot * (1 + _num(C.freePlots[type], 0.2)) * 10) / 10, q: [] };
        s.housing = rec;
        TownHousing._cache(s, rec);
        return rec;
    },

    _cache(s, h) {
        const C = TownHousing.config();
        let cap = 0, rooms = 0, foot = 0;
        for (const id in h.d) {
            const d = TownHousing.def(id);
            if (!d) continue;
            const n = Math.max(0, _num(h.d[id]));
            cap += n * TownHousing.people(s, id);
            rooms += n * _num(d.rooms) * _num(C.lodgersPerRoom, 2);
            foot += n * _num(d.foot, 1);
        }
        h.cap = Math.round(cap);
        h.rooms = Math.round(rooms);
        h.foot = Math.round(foot * 10) / 10;
        h.era = TownHousing.era(s);
        return h;
    },

    /** People the town's dwellings house (families and kin). */
    capacity(s) {
        const h = TownHousing.ensure(s);
        if (!h) return 0;
        if (!Number.isFinite(h.cap) || h.era !== TownHousing.era(s)) TownHousing._cache(s, h);
        return h.cap;
    },

    /** Lodgers the rooms let in its houses take besides. */
    rooms(s) {
        const h = TownHousing.ensure(s);
        if (!h) return 0;
        if (!Number.isFinite(h.rooms)) TownHousing._cache(s, h);
        return h.rooms;
    },

    /** People that can still be housed: families' room and rooms to let, less those here (negative: sleeping rough). */
    room(s) {
        return Math.round(TownHousing.capacity(s) + TownHousing.rooms(s) - Math.max(0, _num(s && s.population)));
    },

    /** People ÷ capacity (1 = every house full; 0 where it has no houses counted). */
    crowd(s) {
        const cap = TownHousing.capacity(s);
        return cap > 0 ? Math.round(Math.max(0, _num(s.population)) / cap * 1000) / 1000 : 0;
    },

    /**
     * How overcrowded, as the harm counts it: lodgers in the rooms let count
     * lodgerWeight, those past capacity and every room (doubled up, sleeping
     * rough) count in full. 0 at or under capacity.
     */
    over(s) {
        const cap = TownHousing.capacity(s);
        if (!(cap > 0)) return 0;
        const pop = Math.max(0, _num(s.population));
        if (pop <= cap) return 0;
        const E = TownHousing.config().effects;
        const rooms = TownHousing.rooms(s);
        const lodged = Math.min(pop - cap, rooms);
        const rough = Math.max(0, pop - cap - rooms);
        return Math.round((lodged * _num(E.lodgerWeight, 0.3) + rough) / cap * 1000) / 1000;
    },

    /** Lodgers in the rooms let, and those sleeping rough or doubled up. */
    lodgers(s) {
        const cap = TownHousing.capacity(s);
        const pop = Math.max(0, _num(s && s.population));
        const rooms = TownHousing.rooms(s);
        return { lodged: Math.round(Math.max(0, Math.min(pop - cap, rooms))), rough: Math.round(Math.max(0, pop - cap - rooms)) };
    },

    /** Free building plots (its ground less what stands on it). */
    freePlots(s) {
        const h = TownHousing.ensure(s);
        if (!h) return 0;
        if (!Number.isFinite(h.foot)) TownHousing._cache(s, h);
        let building = 0;
        for (const [id] of h.q || []) building += _num((TownHousing.def(id) || {}).foot, 1);
        return Math.max(0, Math.round((h.plots - h.foot - building) * 10) / 10);
    },

    // ── The town's ground (housing.land: world/townLand.js counts it) ──

    /**
     * Plots the town may still lay at its edge: its cleared ground (the hex's
     * ground less what is under trees), inside its walls while it has no
     * quarter outside them, less the plots it has. Infinity where its ground
     * is not counted (no land record: a test town, land limits off).
     */
    landLeft(s) {
        const h = TownHousing.ensure(s);
        const L = h && _obj(h.land);
        if (!L || TownHousing.config().land.enabled === false || !Number.isFinite(L.max)) return Infinity;
        return Math.round((TownHousing.landCap(s) - h.plots) * 10) / 10;
    },

    /** The most plots the town's cleared ground holds now (its walls' circuit while it has no suburb on the hex). */
    landCap(s) {
        const h = TownHousing.ensure(s);
        const L = h && _obj(h.land);
        if (!L || !Number.isFinite(L.max)) return Infinity;
        let cap = Math.max(0, L.max - _num(L.wood));
        if (Number.isFinite(L.wall) && !_obj(L.sub)) cap = Math.min(cap, L.wall);
        return Math.round(cap * 10) / 10;
    },

    /** Is the town's ground all built on (no edge plots left, nothing free)? */
    landFull(s) {
        const h = TownHousing.ensure(s);
        if (!h || !(TownHousing.landLeft(s) < 1)) return false;
        return TownHousing.freePlots(s) < _num(TownHousing.config().build.denseBelow, 0.12) * Math.max(1, h.plots);
    },

    /** Does the town build outside its walls now (a suburb on its hex, its walls' ground built over)? */
    buildsOutside(s) {
        const h = TownHousing.ensure(s);
        const L = h && _obj(h.land);
        return !!(L && _obj(L.sub) && Number.isFinite(L.wall) && _num(h.foot) >= L.wall);
    },

    /** The suburb's dwellings (land.sub.d) in all. */
    suburbDwellings(s) {
        const L = s && s.housing && _obj(s.housing.land);
        const d = L && _obj(L.sub) && _obj(L.sub.d);
        return d ? Object.values(d).reduce((a, b) => a + Math.max(0, _num(b)), 0) : 0;
    },

    /** The suburb's share of the town's dwellings (0 with none). */
    suburbShare(s) {
        const n = TownHousing.suburbDwellings(s);
        if (!n) return 0;
        const all = Object.values((s.housing && s.housing.d) || {}).reduce((a, b) => a + Math.max(0, _num(b)), 0);
        return all > 0 ? Math.min(1, n / all) : 0;
    },

    /** What an unwalled quarter outside the walls adds to the town's crime (world/townLabour.js). */
    suburbCrime(s) {
        const sh = TownHousing.suburbShare(s);
        return sh ? Math.round(sh * _num(TownHousing.config().suburb.crime, 0.06) * 1000) / 1000 : 0;
    },

    /** Redevelopments done (housing.rd): { n, by: { type: n } }. */
    redeveloped(s) {
        const rd = s && s.housing && _obj(s.housing.rd);
        return rd ? { n: _num(rd.n), by: { ...(rd.by || {}) } } : { n: 0, by: {} };
    },

    /** Redevelopments under way (queue entries with the type they replace). */
    redeveloping(s) {
        const h = s && s.housing;
        return h && Array.isArray(h.q) ? h.q.filter(e => e && e[3]).length : 0;
    },

    /**
     * What an old dwelling of `from` is rebuilt as: the first of the era's list
     * (a village's own) the town's size and era raise whose people a plot beat
     * the old one's by redev.gain. → a type id, or null.
     */
    redevTarget(s, from) {
        const R = TownHousing.config().redev;
        const fd = TownHousing.def(from);
        if (!fd) return null;
        const era = TownHousing.era(s);
        const list = _type(s && s.type) === 'village' ? (R.village || {})[era] : (R.to || {})[era];
        const per = id => TownHousing.people(s, id) / Math.max(0.1, _num((TownHousing.def(id) || {}).foot, 1));
        const base = per(from);
        for (const id of Array.isArray(list) ? list : []) {
            if (id === from || !TownHousing.allowed(s, id)) continue;
            if (per(id) >= base * _num(R.gain, 1.15)) return id;
        }
        return null;
    },

    /** Does the town lack ground (free plots under denseBelow of it) or room (crowded past denseCrowd)? */
    scarce(s) {
        const h = TownHousing.ensure(s);
        if (!h) return false;
        const B = TownHousing.config().build;
        return TownHousing.freePlots(s) < _num(B.denseBelow, 0.12) * Math.max(1, h.plots) || TownHousing.crowd(s) > _num(B.denseCrowd, 1.05);
    },

    /**
     * What goes up next on a plot: denser where plots are scarce or people
     * crowded (row houses and tenements in town and city, a house in a
     * village), else the town's own mix — the type it is furthest short of.
     * Only what its size and era raise. → a type id
     */
    nextDwellingType(s) {
        const C = TownHousing.config();
        const h = TownHousing.ensure(s);
        const type = _type(s && s.type);
        // (outside its walls the town builds as the poor build: the suburb's own mix)
        if (TownHousing.buildsOutside(s)) {
            const sub = h.land.sub;
            const sd = _obj(sub.d) || {};
            const n = Object.values(sd).reduce((a, b) => a + _num(b), 0) + 1;
            let best = null, gap = -Infinity;
            for (const [id, w] of Object.entries(_obj(C.suburb.mix) || {})) {
                if (!TownHousing.allowed(s, id)) continue;
                const g = _num(w) - _num(sd[id]) / n;
                if (g > gap) { gap = g; best = id; }
            }
            if (best) return best;
        }
        if (TownHousing.scarce(s)) {
            const list = (Array.isArray(C.dense[type]) ? C.dense[type] : []).filter(id => TownHousing.allowed(s, id));
            if (list.length) {
                const built = h ? Object.values(h.d).reduce((a, b) => a + _num(b), 0) + (h.q || []).length : 0;
                return list[built % list.length];
            }
        }
        const mix = _obj(C.mix[type]) || { house: 1 };
        let best = null, gap = -Infinity;
        const total = h ? Object.values(h.d).reduce((a, b) => a + _num(b), 0) + (h.q || []).length + 1 : 1;
        for (const [id, w] of Object.entries(mix)) {
            if (!TownHousing.allowed(s, id)) continue;
            const have = h ? _num(h.d[id]) + (h.q || []).filter(x => x[0] === id).length : 0;
            const g = _num(w) - have / total;
            if (g > gap) { gap = g; best = id; }
        }
        return best || (TownHousing.allowed(s, 'house') ? 'house' : 'cottage');
    },

    /** The building design type a dwelling stands as on the street map ('house', 'rowhouse', 'tenement'). */
    designOf(id) {
        const d = TownHousing.def(id);
        return (d && d.design) || 'house';
    },

    /** A dwelling built (the town's builders, a newcomer's house, the player's tenement): its plot taken. */
    addDwelling(s, id, n = 1) {
        const h = TownHousing.ensure(s);
        if (!h || !TownHousing.def(id) || !(n > 0)) return 0;
        h.d[id] = _num(h.d[id]) + n;
        const foot = _num(TownHousing.def(id).foot, 1) * n;
        // (built on ground the town had not counted: a plot laid for it)
        if (h.plots < _num(h.foot) + foot) h.plots = Math.round((_num(h.foot) + foot) * 10) / 10;
        TownHousing._cache(s, h);
        return n;
    },

    /** Building plots added (a street laid at the town's edge, its lots). */
    addPlots(s, n) {
        const h = TownHousing.ensure(s);
        if (!h || !(n > 0)) return 0;
        h.plots = Math.round((h.plots + n) * 10) / 10;
        return n;
    },

    /**
     * A share of the town's dwellings lost (a fire, a sack, a raid): its plots
     * stay, bare. An unwalled quarter outside the walls is raided first: it
     * loses suburb.raidMult × the share. → dwellings lost
     */
    lose(s, share) {
        const h = TownHousing.ensure(s);
        const f = _clamp(_num(share), 0, 1);
        if (!h || !(f > 0)) return 0;
        let lost = 0;
        const sub = _obj(h.land) && _obj(h.land.sub) && _obj(h.land.sub.d) ? h.land.sub.d : null;
        const fs = sub ? _clamp(f * _num(TownHousing.config().suburb.raidMult, 2.2), 0, 1) : 0;
        for (const id of Object.keys(h.d)) {
            const inSub = sub ? Math.min(_num(sub[id]), _num(h.d[id])) : 0;
            const ks = Math.floor(inSub * fs);
            const k = ks + Math.floor((_num(h.d[id]) - inSub) * f);
            if (ks > 0) { sub[id] -= ks; if (sub[id] <= 0) delete sub[id]; }
            if (k > 0) { h.d[id] -= k; lost += k; }
            if (h.d[id] <= 0) delete h.d[id];
        }
        TownHousing._cache(s, h);
        return lost;
    },

    // ── What crowding does ─────────────────────────────────

    /** Rent × (crowded dear, empty houses cheap). */
    rentMult(s) {
        const E = TownHousing.config().effects;
        const cap = TownHousing.capacity(s);
        if (!(cap > 0)) return 1;
        const c = Math.max(0, _num(s.population)) / cap;
        if (c >= 1) return Math.round(Math.min(_num(E.rentMax, 2.5), 1 + _num(E.rentPer, 1.5) * (c - 1)) * 100) / 100;
        return Math.round(Math.max(_num(E.rentMin, 0.75), 1 - (1 - c) * 1.5) * 100) / 100;
    },

    /** Sickness × from crowding. */
    sickMult(s) {
        const E = TownHousing.config().effects;
        return Math.min(_num(E.sickMax, 1.8), 1 + _num(E.sickPer, 2) * TownHousing.over(s));
    },

    /** Fire × from crowding (more hearths to a roof). */
    fireMult(s) {
        const E = TownHousing.config().effects;
        return Math.min(_num(E.fireMax, 2.2), 1 + _num(E.firePer, 2.5) * TownHousing.over(s));
    },

    /** Welfare lost to the crowding (0..welfareMax). */
    welfarePenalty(s) {
        const E = TownHousing.config().effects;
        return Math.min(_num(E.welfareMax, 0.25), _num(E.welfare, 0.6) * TownHousing.over(s));
    },

    /** The town's growth × (1 with room; 0 crowded past growthStop). */
    growthFactor(s) {
        if (!s || !_obj(s.housing)) return 1;
        const E = TownHousing.config().effects;
        const o = TownHousing.over(s);
        return _clamp(1 - o / Math.max(0.01, _num(E.growthStop, 0.12)), 0, 1);
    },

    // ── The builders' week ─────────────────────────────────

    /** The dwelling's timber and stone from the market's stock (real goods, used up). → true when it goes up bare (short of them). */
    _materials(s, d) {
        let bare = false;
        for (const [g, n] of Object.entries(d.materials || {})) {
            const got = SettlementMarket.good(g) ? SettlementMarket.take(s, g, n) : n;
            if (got < n * 0.5) bare = true;
        }
        return bare;
    },

    /**
     * The town's builders (every build.every days, systems/townPoor.js through
     * systems/townSprawl.js calls it): houses begun on their days stand; a town
     * short of room (capacity under aim × its people) begins more, each with its
     * materials taken from the market's stock (no timber: it goes up slower,
     * bareDays ×); a town short of free plots adds a few at its edge — while it
     * has ground left (landLeft). Its ground gone and its people crowded, it
     * pulls down old low-density dwellings for denser ones (redev), their people
     * put out until the new one stands.
     * → { built: [type…], begun: n, edge: plots laid, noLand, razed: [[from, to, days]], rebuilt: [[from, to]] }
     */
    week(s, day) {
        const out = { built: [], begun: 0, edge: 0, noLand: false, razed: [], rebuilt: [] };
        const h = TownHousing.ensure(s);
        if (!h || !TownHousing.on()) return out;
        const C = TownHousing.config();
        const B = C.build;
        const type = _type(s.type);
        if (!Array.isArray(h.q)) h.q = [];
        const keep = [];
        for (const e of h.q) {
            if (_num(e[1]) > day) { keep.push(e); continue; }
            TownHousing.addDwelling(s, e[0]);
            out.built.push(e[0]);
            // (built outside the walls: the suburb's)
            const sub = e[4] && _obj(h.land) && _obj(h.land.sub) ? h.land.sub : null;
            if (sub) { if (!_obj(sub.d)) sub.d = {}; sub.d[e[0]] = _num(sub.d[e[0]]) + 1; }
            if (e[3]) {
                if (!_obj(h.rd)) h.rd = { n: 0, by: {} };
                h.rd.n = _num(h.rd.n) + 1;
                h.rd.by[e[0]] = _num(h.rd.by[e[0]]) + 1;
                h.rd.last = day;
                out.rebuilt.push([e[3], e[0]]);
            }
        }
        h.q = keep;
        // (short of ground, the town lays plots at its edge: a village into its fields as fast as it
        // likes, a walled city a plot now and then — its people pack into row houses and tenements;
        // and only while it has ground to lay them on: world/townLand.js)
        if (TownHousing.freePlots(s) < _num(B.denseBelow, 0.12) * Math.max(1, h.plots)) {
            const gap = Math.max(0, Math.max(0, _num(s.population)) * _num(B.aim, 1.05) - TownHousing.capacity(s));
            const per = _num(C.edgePlots[type], 1);
            const want = type === 'village' || type === 'town' ? Math.max(per, gap / Math.max(1, TownHousing.people(s, 'house') || 7) * 0.5) : per;
            const left = TownHousing.landLeft(s);
            const add = Math.round(Math.min(want, Math.max(0, left)) * 10) / 10;
            if (add > 0) { TownHousing.addPlots(s, add); out.edge = add; }
            if (!(left - add >= 1)) out.noLand = true;
        }
        const pop = Math.max(0, _num(s.population));
        let queued = 0;
        for (const [id] of h.q) queued += TownHousing.people(s, id);
        let short = pop * _num(B.aim, 1.05) - TownHousing.capacity(s) - queued;
        // (a town burnt out or swelled at once sets more hands to it: catchUp of the gap a week)
        const gapN = short > 0 ? short / Math.max(1, TownHousing.people(s, TownHousing.nextDwellingType(s))) : 0;
        const max = Math.max(1, Math.round(_num(B.perWeek[type], 1) + _num(B.perThousand, 0.5) * pop / 1000), Math.ceil(gapN * _num(B.catchUp, 0.15)));
        const maxQ = Math.max(_num(B.maxQueue, 40), Math.round(pop / 60));
        for (let i = 0; i < max && short > 0 && h.q.length < maxQ; i++) {
            if (!(TownHousing.freePlots(s) >= _num((TownHousing.def(TownHousing.nextDwellingType(s)) || {}).foot, 1))) break;
            const outside = TownHousing.buildsOutside(s);
            const id = TownHousing.nextDwellingType(s);
            const d = TownHousing.def(id);
            if (!d) break;
            const bare = TownHousing._materials(s, d);
            const e = [id, day + Math.round(_num(d.days, 25) * (bare ? _num(B.bareDays, 1.6) : 1)), bare ? 1 : 0];
            if (outside) e.push(0, 1);
            h.q.push(e);
            short -= TownHousing.people(s, id);
            out.begun++;
        }
        // Its ground gone and its people crowded: old dwellings pulled down for denser ones
        const R = C.redev;
        if (R.enabled !== false && short > 0 && TownHousing.landFull(s) && TownHousing.crowd(s) >= _num(R.minCrowd, 1)) {
            const n = Math.floor(_num(R.perWeek[type], 0) + _num(R.perThousand, 0.15) * pop / 1000);
            const busy = TownHousing.redeveloping(s);
            const room = Math.max(0, Math.floor(_num(R.maxBuilding, 12)) - busy);
            const sub = _obj(h.land) && _obj(h.land.sub) && _obj(h.land.sub.d) ? h.land.sub.d : {};
            for (let i = 0; i < Math.min(n, room) && short > 0; i++) {
                // (the oldest and meanest first: hovels, then cottages, then houses — inside the town, not its suburb's poor)
                let from = null, to = null;
                for (const id of Array.isArray(R.from) ? R.from : []) {
                    if (!(_num(h.d[id]) - _num(sub[id]) > 0)) continue;
                    const t = TownHousing.redevTarget(s, id);
                    if (t) { from = id; to = t; break; }
                }
                if (!from) break;
                const d = TownHousing.def(to);
                h.d[from] -= 1;
                if (h.d[from] <= 0) delete h.d[from];
                TownHousing._cache(s, h);
                const bare = TownHousing._materials(s, d);
                const days = Math.round(_num(d.days, 40) * (bare ? _num(B.bareDays, 1.6) : 1));
                h.q.push([to, day + days, bare ? 1 : 0, from]);
                out.razed.push([from, to, days]);
                short -= TownHousing.people(s, to) - TownHousing.people(s, from);
            }
        }
        return out;
    },

    /** For the panels: { cap, rooms, pop, crowd, over, lodged, rough, free, plots, rentMult, d, building, era } */
    summary(s) {
        const h = TownHousing.ensure(s);
        if (!h) return null;
        const L = TownHousing.lodgers(s);
        return {
            cap: TownHousing.capacity(s), rooms: TownHousing.rooms(s), pop: Math.round(_num(s.population)), crowd: TownHousing.crowd(s),
            over: TownHousing.over(s), lodged: L.lodged, rough: L.rough, free: TownHousing.freePlots(s), plots: h.plots,
            rentMult: TownHousing.rentMult(s), d: { ...h.d }, building: (h.q || []).length, era: TownHousing.era(s),
            next: TownHousing.nextDwellingType(s),
            land: TownHousing.landSummary(s),
        };
    },

    /**
     * The town's ground for the panels, or null where it is not counted:
     * { used, of (its cleared ground), max (the hex's), wood (plots still under trees), wall (its walls' circuit or null),
     *   full, outside (builds outside its walls), sub (the suburb's name), subN (its dwellings),
     *   subAt (a quarter on the next hex), sats (villages its people founded), rd (rebuilt denser), rdNow (being rebuilt) }
     */
    landSummary(s) {
        const h = TownHousing.ensure(s);
        const L = h && _obj(h.land);
        if (!L || !Number.isFinite(L.max)) return null;
        const cap = TownHousing.landCap(s);
        return {
            used: Math.round(h.plots), of: Math.round(Math.max(cap, h.plots)), max: Math.round(L.max), wood: Math.round(_num(L.wood)),
            wall: Number.isFinite(L.wall) ? Math.round(L.wall) : null, full: TownHousing.landFull(s), outside: TownHousing.buildsOutside(s),
            sub: _obj(L.sub) ? L.sub.name : null, subN: TownHousing.suburbDwellings(s), subAt: L.subAt || null,
            sats: Array.isArray(L.sats) ? L.sats.map(x => x.name) : [], rd: TownHousing.redeveloped(s).n, rdNow: TownHousing.redeveloping(s),
        };
    },

    /** A crowding word and colour. */
    crowdLabel(c) {
        if (c >= 1.25) return { label: 'Packed to the rafters', color: '#e74c3c' };
        if (c >= 1.05) return { label: 'Overcrowded', color: '#e67e22' };
        if (c >= 0.95) return { label: 'Full', color: '#e8a040' };
        if (c >= 0.8) return { label: 'Room to spare', color: '#9fd59f' };
        return { label: 'Houses standing empty', color: '#8fb3d9' };
    },
};

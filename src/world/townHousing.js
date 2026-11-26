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
// village or a town as many as it lacks, a city or a capital few);
// the town-growth code adds a street's lots when it lays one (`addPlots`).
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
            for (const k of ['build', 'effects', 'player', 'eraDefault', 'freePlots', 'edgePlots']) c[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
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

    /** A share of the town's dwellings lost (a fire, a sack): its plots stay, bare. → dwellings lost */
    lose(s, share) {
        const h = TownHousing.ensure(s);
        const f = _clamp(_num(share), 0, 1);
        if (!h || !(f > 0)) return 0;
        let lost = 0;
        for (const id of Object.keys(h.d)) {
            const k = Math.floor(_num(h.d[id]) * f);
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

    /**
     * The town's builders (every build.every days, systems/townPoor.js calls
     * it): houses begun on their days stand; a town short of room (capacity
     * + under aim × its people) begins more, each with its materials taken
     * from the market's stock (no timber: it goes up slower, bareDays ×); a
     * town short of free plots adds a few at its edge once a year.
     * → { built: [type…], begun: n }
     */
    week(s, day) {
        const out = { built: [], begun: 0 };
        const h = TownHousing.ensure(s);
        if (!h || !TownHousing.on()) return out;
        const C = TownHousing.config();
        const B = C.build;
        const type = _type(s.type);
        if (!Array.isArray(h.q)) h.q = [];
        const keep = [];
        for (const e of h.q) {
            if (_num(e[1]) <= day) { TownHousing.addDwelling(s, e[0]); out.built.push(e[0]); } else keep.push(e);
        }
        h.q = keep;
        // (short of ground, the town lays plots at its edge: a village into its fields as fast as it
        // likes, a walled city a plot now and then — its people pack into row houses and tenements)
        if (TownHousing.freePlots(s) < _num(B.denseBelow, 0.12) * Math.max(1, h.plots)) {
            const gap = Math.max(0, Math.max(0, _num(s.population)) * _num(B.aim, 1.05) - TownHousing.capacity(s));
            const per = _num(C.edgePlots[type], 1);
            const want = type === 'village' || type === 'town' ? Math.max(per, gap / Math.max(1, TownHousing.people(s, 'house') || 7) * 0.5) : per;
            TownHousing.addPlots(s, Math.round(want * 10) / 10);
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
            const id = TownHousing.nextDwellingType(s);
            const d = TownHousing.def(id);
            if (!d) break;
            // (the timber and stone from the market: real goods, used up)
            let bare = false;
            for (const [g, n] of Object.entries(d.materials || {})) {
                const got = SettlementMarket.good(g) ? SettlementMarket.take(s, g, n) : n;
                if (got < n * 0.5) bare = true;
            }
            h.q.push([id, day + Math.round(_num(d.days, 25) * (bare ? _num(B.bareDays, 1.6) : 1)), bare ? 1 : 0]);
            short -= TownHousing.people(s, id);
            out.begun++;
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

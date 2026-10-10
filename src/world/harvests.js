// ============================================
// HARVESTS — the agricultural year, region by region
// ============================================
// Seasons (world/seasons.js) give the year its shape: little comes to market
// at sowing, a glut at harvest. This module gives each year its size. Every
// region — a realm's land, or for free towns a zone of the map — grows its
// own harvest:
//
//   weather   the growing season's weather (spring and summer) sampled at the
//             region's largest towns and scored against the place's own
//             climate normal: a dry year in a desert is a bad year, not
//             every year (the weather is a pure function of hex and day, so
//             sampling it draws nothing)
//   war       each war the realm fights (levies off the land, foragers), each
//             battle fought on its land (world/kingdomAI.js noteBattle),
//             raiders and war hosts abroad on it; a sacked town loses more
//   blights   grain rust, locusts (warm lands), murrain among the herds —
//             hash-rolled per region and year, crossing to neighbouring
//             regions while the season lasts
//   labour    a town short of land hands at harvest leaves grain in the field
//   soil      each town's farmland splits into grain, vegetables and legumes,
//             flax, vines and orchards, and fallow; the mix drifts toward what
//             pays and what the climate favours; over-cropping thins the soil,
//             fallow and legumes restore it
//
// On the reckoning day (end of summer) the harvest is in: it scales the
// region's towns' grain, wine, linen and livestock output (world/
// settlementMarket.js via systems/marketDynamics.js, the granary food of
// world/economy.js, the hinterland's herds) and the player's farms
// (player/playerEconomy/property.js) until the next one — the seasonal curve
// keeps its shape, the harvest sets its amplitude. Bumper years glut, bad
// ones bring dearth, and the existing famine, lean-season, granary, dole and
// speculation machinery reacts to real shortages.
//
// The forecast firms up as summer goes: the player hears their own region's
// estimate where they stand and every region's in the weekly crop reports
// at market towns; the heralds cry failing and bumper harvests and blights;
// townsfolk talk of them (systems/chatter.js `harvest`).
//
// Public API for other systems (crop insurance and the like):
//   Harvests.regionOf(world, q, r)          → region id of a hex
//   Harvests.expectedYield(world, region)   → the best estimate today (1 = a normal year)
//   Harvests.forecast(world, region)        → { est, conf, weather, war, blights, settled }
//   Harvests.outcome(world, region, year)   → the reckoned harvest of a year, or null
//
// Deterministic: rolls are hashes of the world seed, year and region; no
// RNG stream is touched. State on world.harvests (saved by systems/saveLoad.js),
// each town's fields on settlement.farm (saved with the tiles), the player's
// crop knowledge on player.harvests. Tuned in data/harvests.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Seasons } from './seasons.js';
import { WorldEvents } from './worldEvents.js';
import { SettlementMarket } from './settlementMarket.js';
import { TownLabour } from './townLabour.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _key = (q, r) => `${q},${r}`;
const _r3 = (v) => Math.round(v * 1000) / 1000;
const CROPS = ['grain', 'veg', 'fibre', 'vine', 'fallow'];
const YIELDS = ['grain', 'veg', 'fibre', 'vine', 'fodder', 'stock'];

const DEFAULTS = {
    growing: { sowDay: 1, settleDay: 60, sampleEvery: 3, samplePoints: 3 },
    zoneCell: [16, 12],
    neighbourRange: 9,
    weather: { score: { clear: 0, cloudy: 0.15, rain: 0.35, storm: -0.5, snow: -1, blizzard: -1.6, heatwave: -0.8 }, summerStorm: 1.5, gain: 2.4, normalYears: 6, min: 0.45, max: 1.3 },
    war: { perWar: 0.04, perBattle: 0.03, perRaider: 0.04, max: 0.4, townDamage: 0.6 },
    labour: { below: 0.95, k: 0.6 },
    blights: {},
    crops: {
        climate: {
            grain: { base: 1, fertile: 1.1 }, veg: { base: 0.27, river: 1.3 },
            fibre: { base: 0.13, cool: 1.5, warm: 0.5, river: 1.3 },
            vine: { base: 0.09, hot: 2.5, warm: 1.2, mild: 0.5, cold: 0.1, upland: 1.4 },
            fallow: { base: 0.33, pasture: 1 },
        },
        temperature: { cold: 0.4, cool: 0.5, warm: 0.5, hot: 0.6 },
        drift: 0.3, elasticity: 0.8, minFallow: 0.06, soilFallow: 3, vegDamp: 0.6, vegFood: 0.8,
    },
    soil: { rate: 0.35, k: 1.6, min: 0.55, max: 1.2 },
    effects: { grainMin: 0.25, grainMax: 1.7, econShare: 0.7, econMin: 0.4, econMax: 1.35, wineClimate: 0.5, linen: 0.1, fodder: 0.8, stockGoods: ['meat', 'cheese', 'hide', 'wool', 'horses', 'horse'], rentShare: 0.5 },
    rotations: {
        intensive: { label: 'Intensive', yield: 1.15, soil: 0.7 },
        three_field: { label: 'Three-field rotation', yield: 1, soil: 1 },
        rest: { label: 'Long fallow', yield: 0.8, soil: 1.15 },
    },
    propertyCrops: {},
    irrigatedDamp: 0.5,
    herdSites: ['sheep_run', 'cattle_ranch', 'horse_stud'],
    forecast: { reportFrom: 20, reportEvery: 7, failingBelow: 0.82, bumperAbove: 1.14, heraldFrom: 40, bumperFrom: 50, talkFrom: 20, talkUntil: 110, poorBelow: 0.85, plentyAbove: 1.12 },
    counsel: { failingBelow: 0.85, failingFrom: 25, failingUntil: 80, radius: 40, soilBelow: 0.8 },
    famine: { event: 'famine', day: 100, below: 0.72, perPoint: 3, max: 0.7 },
    historyCap: 40,
    pastYears: 4,
};

let _src;
let _cfg = null;

function _build(src) {
    const d = _obj(src) || {};
    const C = { ...DEFAULTS, ...d };
    C.growing = { ...DEFAULTS.growing, ...(d.growing || {}) };
    C.weather = { ...DEFAULTS.weather, ...(d.weather || {}), score: { ...DEFAULTS.weather.score, ...((d.weather && d.weather.score) || {}) } };
    C.war = { ...DEFAULTS.war, ...(d.war || {}) };
    C.labour = { ...DEFAULTS.labour, ...(d.labour || {}) };
    const cr = d.crops || {};
    C.crops = { ...DEFAULTS.crops, ...cr, climate: { ...DEFAULTS.crops.climate, ...(cr.climate || {}) }, temperature: { ...DEFAULTS.crops.temperature, ...(cr.temperature || {}) } };
    C.soil = { ...DEFAULTS.soil, ...(d.soil || {}) };
    C.effects = { ...DEFAULTS.effects, ...(d.effects || {}) };
    C.rotations = { ...DEFAULTS.rotations, ...(d.rotations || {}) };
    C.forecast = { ...DEFAULTS.forecast, ...(d.forecast || {}) };
    C.counsel = { ...DEFAULTS.counsel, ...(d.counsel || {}) };
    C.famine = { ...DEFAULTS.famine, ...(d.famine || {}) };
    C.propertyCrops = { ...(d.propertyCrops || {}) };
    const blights = {};
    for (const [id, b] of Object.entries(d.blights || {})) {
        if (!_obj(b) || id.startsWith('_')) continue;
        blights[id] = {
            id, name: b.name || id, icon: b.icon || '🍂', hits: Array.isArray(b.hits) ? b.hits.slice() : ['grain'],
            chance: _num(b.chance), warmAbove: Number.isFinite(b.warmAbove) ? b.warmAbove : null,
            start: Array.isArray(b.start) ? [_num(b.start[0], 10), _num(b.start[1], 50)] : [10, 50],
            severity: Array.isArray(b.severity) ? [_num(b.severity[0], 0.2), _num(b.severity[1], 0.4)] : [0.2, 0.4],
            spread: _num(b.spread), decay: _num(b.decay, 0.8),
        };
    }
    C.blights = blights;
    C.blightIds = Object.keys(blights);
    // The climate's usual mix (all factors 1): the reference for soil and the rest share
    const base = {};
    let sum = 0;
    for (const c of CROPS) { base[c] = _num((C.crops.climate[c] || {}).base, 0.1); sum += base[c]; }
    for (const c of CROPS) base[c] /= sum;
    C.baseMix = base;
    C.rest0 = base.fallow + 0.5 * base.veg;
    C.stockSet = new Set(C.effects.stockGoods || []);
    C.herdSet = new Set(Array.isArray(d.herdSites) ? d.herdSites : DEFAULTS.herdSites);
    return C;
}

/** FNV-1a of a string, finished with a murmur mix → 0..1 (no RNG stream is touched). */
function _roll(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** Per-world caches rebuilt from world state: climate normals by sample town. */
const _caches = new WeakMap();
function _cache(world) {
    let c = _caches.get(world);
    if (!c) { c = { normals: new Map() }; _caches.set(world, c); }
    return c;
}

export const Harvests = {
    CROPS,
    YIELDS,
    roll: _roll,

    // ── Config ─────────────────────────────────────────────

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.harvests : undefined;
        if (!_cfg || src !== _src) {
            _src = src;
            _cfg = _build(src);
        }
        return _cfg;
    },

    /** The world's seed for the hash rolls. */
    seed(world) {
        return String((world && world.generationParams && world.generationParams.seed) || 'world');
    },

    /** The harvest year of a day (0-based; days 1..120 are year 0). */
    yearOf(day) {
        return Math.floor((Math.max(1, Math.floor(_num(day, 1))) - 1) / Seasons.DAYS_PER_YEAR);
    },

    // ── State ─────────────────────────────────────────────

    /** world.harvests: { year, cur (the growing season), last (the harvest in force), past, history, ver }. */
    state(world) {
        if (!world) return null;
        let st = _obj(world.harvests);
        if (!st) st = world.harvests = Harvests._blank();
        if (!Array.isArray(st.past)) st.past = [];
        if (!Array.isArray(st.history)) st.history = [];
        if (!Number.isFinite(st.ver)) st.ver = 0;
        return st;
    },

    _blank() {
        return { v: 1, year: null, cur: null, last: null, past: [], history: [], ver: 0, seq: 1 };
    },

    serialize(world) {
        const st = world && _obj(world.harvests);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    /** After a load: the saved record, or none (older saves sow on the next day; towns derive their fields). */
    restore(saved, world) {
        if (!world) return;
        world.harvests = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : Harvests._blank();
        Harvests.state(world);
        _caches.delete(world);
    },

    /** Bumped whenever a sowing or a harvest changes the towns' output (market profiles key on it). */
    version(world) {
        const st = world && _obj(world.harvests);
        return st ? _num(st.ver) : 0;
    },

    // ── Regions ───────────────────────────────────────────

    /** Region id of a hex: 'k:<realm>' on a realm's land, else 'z:<cell>'. */
    regionOf(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (t && t.settlement && t.settlement.kingdom != null) return `k:${t.settlement.kingdom}`;
        if (t && t.kingdom != null) return `k:${t.kingdom}`;
        const [cw, ch] = Harvests.config().zoneCell;
        return `z:${Math.floor(_num(q) / Math.max(1, cw))},${Math.floor(_num(r) / Math.max(1, ch))}`;
    },

    /** A settlement's region (its realm's, or its zone's). */
    regionOfTown(world, s) {
        if (!s) return null;
        if (s.kingdom != null) return `k:${s.kingdom}`;
        const [cw, ch] = Harvests.config().zoneCell;
        return `z:${Math.floor(_num(s.q) / Math.max(1, cw))},${Math.floor(_num(s.r) / Math.max(1, ch))}`;
    },

    /** A region's display name. */
    regionName(world, id) {
        const st = world && _obj(world.harvests);
        const rec = st && st.cur && st.cur.regions && st.cur.regions[id];
        if (rec && rec.name) return rec.name;
        const out = st && st.last && st.last.out && st.last.out[id];
        if (out && out.name) return out.name;
        const k = world ? Harvests._kingdomOf(world, id) : null;
        return k ? k.name : 'the free lands';
    },

    _kingdomOf(world, id) {
        if (typeof id !== 'string' || !id.startsWith('k:')) return null;
        const kid = id.slice(2);
        return (world.kingdoms || []).find(k => k && String(k.id) === kid) || null;
    },

    // ── A town's fields ───────────────────────────────────

    /** The climate's weights for each crop at a town (before prices). */
    _climate(world, s) {
        const C = Harvests.config();
        const CC = C.crops.climate;
        const T = C.crops.temperature;
        const tile = world && typeof world.getTile === 'function' ? world.getTile(s.q, s.r) : null;
        const temp = tile && typeof tile.temperature === 'number' ? tile.temperature : 0.5;
        const land = SettlementMarket.landProfile(world, s.q, s.r);
        const sh = land.shares || {};
        const w = {};
        w.grain = _num(CC.grain.base, 1) * (land.fertility > 1 ? _num(CC.grain.fertile, 1) : 1);
        w.veg = _num(CC.veg.base, 0.27) * (land.river ? _num(CC.veg.river, 1) : 1);
        w.fibre = _num(CC.fibre.base, 0.13) * (temp < T.cool ? _num(CC.fibre.cool, 1) : temp > T.hot ? _num(CC.fibre.warm, 1) : 1) * (land.river ? _num(CC.fibre.river, 1) : 1);
        w.vine = _num(CC.vine.base, 0.09) * (temp > T.hot ? _num(CC.vine.hot, 1) : temp > T.warm ? _num(CC.vine.warm, 1) : temp < T.cold ? _num(CC.vine.cold, 1) : _num(CC.vine.mild, 1))
            * (_num(sh.upland) > 0.2 ? _num(CC.vine.upland, 1) : 1);
        w.fallow = _num(CC.fallow.base, 0.33) * (1 + _num(sh.pasture) * _num(CC.fallow.pasture, 0));
        return { w, temp };
    },

    _normalise(w) {
        let sum = 0;
        for (const c of CROPS) sum += Math.max(0, _num(w[c]));
        const out = {};
        for (const c of CROPS) out[c] = sum > 0 ? _r3(Math.max(0, _num(w[c])) / sum) : Harvests.config().baseMix[c];
        return out;
    },

    /** settlement.farm, derived from the land on first sight: { mix, ref, soil, y, yr, temp }. */
    ensureFarm(world, s) {
        if (!s) return null;
        let f = _obj(s.farm);
        if (f && _obj(f.mix) && _obj(f.ref)) return f;
        const { w, temp } = Harvests._climate(world, s);
        const mix = Harvests._normalise(w);
        f = s.farm = { mix, ref: { ...mix }, soil: 1, y: null, yr: null, temp: _r3(temp) };
        return f;
    },

    /** Each crop's yield at a town for the harvest in force (1s before the first harvest). */
    townYield(s) {
        const f = s && _obj(s.farm);
        const y = f && _obj(f.y);
        const out = {};
        for (const c of YIELDS) out[c] = y && Number.isFinite(y[c]) ? y[c] : 1;
        return out;
    },

    /**
     * The town's market grain against a normal year at its first mix: grain
     * and vegetables (hardier: vegDamp of the swing) × their yields.
     */
    grainFactor(s) {
        const f = s && _obj(s.farm);
        if (!f || !_obj(f.y)) return 1;
        const C = Harvests.config();
        const K = C.crops;
        const y = f.y;
        const veg = 1 + (_num(y.veg, 1) - 1) * _num(K.vegDamp, 0.6);
        const now = _num(f.mix.grain) * _num(y.grain, 1) + _num(f.mix.veg) * K.vegFood * veg;
        const ref = _num(f.ref.grain) + _num(f.ref.veg) * K.vegFood;
        if (!(ref > 0)) return 1;
        return _clamp(now / ref, C.effects.grainMin, C.effects.grainMax);
    },

    /** Multiplier on the granary food a town grows for its people (world/economy.js). */
    foodFactor(world, s) {
        const f = s && _obj(s.farm);
        if (!f || !_obj(f.y)) return 1;
        const E = Harvests.config().effects;
        return _clamp(1 + (Harvests.grainFactor(s) - 1) * E.econShare, E.econMin, E.econMax);
    },

    /** Multiplier on the tithe and rents of a town the player holds (Taxation.collectTaxes). */
    rentFactor(s) {
        const f = s && _obj(s.farm);
        if (!f || !_obj(f.y)) return 1;
        const E = Harvests.config().effects;
        return _clamp(1 + (Harvests.grainFactor(s) - 1) * _num(E.rentShare, 0.5), 0.4, 1.4);
    },

    /** The herds' yield at a town (murrain, war, the fodder on its fallow): hinterland sheep runs, ranches and studs. */
    stockFactor(s) {
        const f = s && _obj(s.farm);
        if (!f || !_obj(f.y)) return 1;
        const E = Harvests.config().effects;
        return _clamp(_num(f.y.stock, 1) * (1 + _num(E.fodder) * (_num(f.mix.fallow) - _num(f.ref.fallow))), 0.2, 1.6);
    },

    /** Is a hinterland site kind a herd (data/harvests.json herdSites)? */
    isHerdSite(kind) {
        return Harvests.config().herdSet.has(kind);
    },

    /**
     * Scale a town's production profile ({ goodId: units a day },
     * SettlementMarket.production) by its harvest in force and its crop mix:
     * grain, wine, flax (linen; textiles where markets keep no flax) and the livestock goods.
     */
    applyToProduction(world, s, prod) {
        const f = s && _obj(s.farm);
        if (!f || !prod) return prod;
        const C = Harvests.config();
        const E = C.effects;
        const y = Harvests.townYield(s);
        if (prod.grain > 0 && _obj(f.y)) prod.grain *= Harvests.grainFactor(s);
        if (prod.wine > 0) {
            const ref = Math.max(0.005, _num(f.ref.vine));
            const climate = Math.pow(_clamp(ref / Math.max(0.005, C.baseMix.vine), 0.1, 4), _num(E.wineClimate, 0.5));
            prod.wine *= _clamp(_num(f.mix.vine) * y.vine / ref * climate, 0.1, 3);
        }
        // Flax: the flax fields bring flax to market (the linen weavers and the
        // cottagers of the putting-out system make linen of it); without a flax
        // good, linen comes to market as textiles
        if (_num(E.flax) > 0 && SettlementMarket.tracks('flax')) {
            const pop = Math.max(0, _num(s.population));
            const td = _num(SettlementMarket.config().typeDemand[s.type], 1) || 1;
            const n = pop * E.flax * td * (_num(f.mix.fibre) / Math.max(0.01, C.baseMix.fibre)) * y.fibre;
            if (n > 0) prod.flax = (prod.flax || 0) + n;
        } else if (_num(E.linen) > 0 && SettlementMarket.tracks('textiles') && SettlementMarket.uses(s, 'textiles')) {
            const need = SettlementMarket.need(s, 'textiles');
            const n = need * E.linen * (_num(f.mix.fibre) / Math.max(0.01, C.baseMix.fibre)) * y.fibre;
            if (n > 0) prod.textiles = (prod.textiles || 0) + n;
        }
        const stock = Harvests.stockFactor(s);
        if (stock !== 1) for (const id of C.stockSet) if (prod[id] > 0) prod[id] *= stock;
        return prod;
    },

    // ── The year ──────────────────────────────────────────

    /**
     * The day's turn (from endDay, before the markets): sow at the year's
     * start, sample the growing season, reckon the harvest on settleDay, and
     * keep the player's crop knowledge. → { notices }.
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        if (!world || typeof world.getTile !== 'function' || !Number.isFinite(world.day)) return out;
        const st = Harvests.state(world);
        const C = Harvests.config();
        const G = C.growing;
        const day = world.day;
        const Y = Harvests.yearOf(day);
        const doy = Seasons.dayOfYear(day);
        if (st.year !== Y) Harvests._sow(world, st, Y, day);
        const cur = st.cur;
        if (cur && cur.year === Y && !cur.settled) {
            if (doy <= G.settleDay && (doy - G.sowDay) % Math.max(1, G.sampleEvery) === 0) Harvests._sample(world, st, day);
            if (doy >= G.settleDay) Harvests._settle(world, st, Y, day, player, out);
            else Harvests._announce(world, st, day);
        }
        if (doy === C.famine.day) Harvests._famine(world, st, day);
        if (player) Harvests._learn(world, player, day);
        return out;
    },

    /**
     * The lean months after a failed harvest: a realm whose harvest came in
     * below famine.below may fall into the Hungry Months (the world event
     * 'famine'), with chance (below − yield) × perPoint — a hash roll; the
     * event's own dice run on a stream seeded from it, never the game's.
     */
    _famine(world, st, day) {
        const F = Harvests.config().famine;
        const last = st.last;
        if (!last || !last.out || !(F.perPoint > 0)) return;
        const seed = Harvests.seed(world);
        const active = (world.activeEvents || []).filter(ev => ev && ev.id === F.event);
        for (const [id, o] of Object.entries(last.out)) {
            if (o.kingdomId == null || !(o.y < F.below)) continue;
            const k = Harvests._kingdomOf(world, id);
            if (!k || k.isAlive === false || active.some(ev => ev.kingdomId === k.id)) continue;
            if (_roll(seed, 'famine', last.year, id) >= Math.min(F.max, (F.below - o.y) * F.perPoint)) continue;
            const rng = Utils.seededRandom(Math.floor(_roll(seed, 'famineRng', last.year, id) * 2147483647) + 1);
            const ev = Utils.withRng(rng, () => WorldEvents.startEvent(world, F.event, { kingdomId: k.id }));
            if (ev) {
                ev.harvest = true;
                Harvests._record(world, st, 'famine', id, day, { pct: Math.round(o.y * 100) });
            }
        }
    },

    /** A battle fought on a realm's land (world/kingdomAI.js): its fields are burned and trampled. */
    noteBattle(world, kingdomId) {
        const st = world && _obj(world.harvests);
        const cur = st && st.cur;
        if (!cur || cur.settled || kingdomId == null) return;
        const rec = cur.regions && cur.regions[`k:${kingdomId}`];
        if (rec) rec.battles = _num(rec.battles) + 1;
    },

    /** The year's sowing: regions, crop mixes drift and soil settles, blights are rolled. */
    _sow(world, st, Y, day) {
        const C = Harvests.config();
        const G = C.growing;
        const doy = Seasons.dayOfYear(day);
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        const regions = {};
        const towns = {};
        for (const s of views) {
            const live = (world.getTile(s.q, s.r) || {}).settlement || s;
            const f = Harvests.ensureFarm(world, live);
            // A new year's fields (not on the first sight of a town: its mix is the climate's)
            if (f.sownYr != null && f.sownYr !== Y) Harvests._drift(world, live, f);
            f.sownYr = Y;
            const id = Harvests.regionOfTown(world, s);
            towns[_key(s.q, s.r)] = id;
            const rec = regions[id] || (regions[id] = { towns: [], pop: 0 });
            rec.towns.push({ k: _key(s.q, s.r), pop: _num(s.population), temp: _num(f.temp, 0.5), name: s.name });
            rec.pop += _num(s.population);
        }
        const out = {};
        for (const [id, rec] of Object.entries(regions)) {
            rec.towns.sort((a, b) => b.pop - a.pop || (a.k < b.k ? -1 : 1));
            const k = Harvests._kingdomOf(world, id);
            const temp = rec.towns.reduce((a, t) => a + t.temp, 0) / Math.max(1, rec.towns.length);
            out[id] = {
                name: k ? k.name : `the free lands about ${rec.towns[0].name || 'the hills'}`,
                kingdomId: k ? k.id : null,
                pts: rec.towns.slice(0, Math.max(1, G.samplePoints)).map(t => t.k),
                temp: _r3(temp), ws: 0, wn: 0, norm: null, war: 0, raid: 0, battles: 0, blights: [], plan: [], nb: [],
            };
        }
        // Neighbours (blights cross between them)
        const ids = Object.keys(out);
        const range = Math.max(1, _num(C.neighbourRange, 9));
        const pos = ids.map(id => regions[id].towns.map(t => t.k.split(',').map(Number)));
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                let near = false;
                for (const a of pos[i]) {
                    for (const b of pos[j]) {
                        if (Math.abs(a[1] - b[1]) > range) continue;
                        if (Hex.wrappingDistance(a[0], a[1], b[0], b[1], world.width) <= range) { near = true; break; }
                    }
                    if (near) break;
                }
                if (near) { out[ids[i]].nb.push(ids[j]); out[ids[j]].nb.push(ids[i]); }
            }
        }
        // The year's blights, rolled per region (they start on their day)
        const seed = Harvests.seed(world);
        for (const id of ids) {
            const rec = out[id];
            for (const b of C.blightIds.map(x => C.blights[x])) {
                if (b.warmAbove != null && rec.temp <= b.warmAbove) continue;
                if (_roll(seed, 'blight', Y, id, b.id) >= b.chance) continue;
                const from = Math.round(b.start[0] + _roll(seed, 'start', Y, id, b.id) * (b.start[1] - b.start[0]));
                const sev = _r3(b.severity[0] + _roll(seed, 'sev', Y, id, b.id) * (b.severity[1] - b.severity[0]));
                rec.plan.push({ kind: b.id, day: from, sev });
            }
        }
        st.year = Y;
        // A season joined late (a new game in autumn, an old save) has no harvest to reckon this year
        st.cur = { year: Y, regions: out, towns, settled: doy > G.settleDay, from: doy };
        st.ver = _num(st.ver) + 1;
    },

    /** A town's crop mix drifts toward what pays and what the climate favours; its soil follows last year's rest. */
    _drift(world, s, f) {
        const C = Harvests.config();
        const K = C.crops;
        const S = C.soil;
        // Soil: last year's fallow and legumes
        const rest = _num(f.mix.fallow) + 0.5 * _num(f.mix.veg);
        const target = _clamp(1 + S.k * (rest - C.rest0), S.min, S.max);
        f.soil = _r3(_clamp(_num(f.soil, 1) + S.rate * (target - _num(f.soil, 1)), S.min, S.max));
        // Prices: grain and veg follow grain, flax textiles, vines wine, fallow the herds
        const { w } = Harvests._climate(world, s);
        const sc = (g) => (SettlementMarket.uses(s, g) ? _clamp(SettlementMarket.scarcity(s, g), 0.5, 2) : 1);
        const e = _num(K.elasticity, 0.8);
        const grain = Math.pow(sc('grain'), e);
        w.grain *= grain;
        w.veg *= grain;
        w.fibre *= Math.pow(SettlementMarket.tracks('flax') ? (sc('flax') + sc('linen')) / 2 : sc('textiles'), e);
        w.vine *= Math.pow(sc('wine'), e);
        w.fallow *= Math.pow((sc('meat') + sc('cheese')) / 2, e) * (1 + Math.max(0, 1 - f.soil) * _num(K.soilFallow, 3));
        const target2 = Harvests._normalise(w);
        const d = _clamp(_num(K.drift, 0.3), 0, 1);
        const mix = {};
        for (const c of CROPS) mix[c] = _num(f.mix[c]) + d * (target2[c] - _num(f.mix[c]));
        mix.fallow = Math.max(_num(K.minFallow, 0.06), mix.fallow);
        f.mix = Harvests._normalise(mix);
    },

    /** The weather score of a sampled day at a hex. */
    _score(world, q, r, day) {
        const W = Harvests.config().weather;
        if (!world.weather || typeof world.weather.getWeather !== 'function') return 0;
        const wx = world.weather.getWeather(q, r, day);
        let v = _num(W.score[wx.type]);
        if (wx.type === 'storm' && Seasons.seasonOf(day) === 'Summer') v *= _num(W.summerStorm, 1);
        return v;
    },

    /** The climate normal at a sample town: its season's mean score over normalYears calendar years. */
    _normal(world, key) {
        const cache = _cache(world).normals;
        if (cache.has(key)) return cache.get(key);
        const C = Harvests.config();
        const G = C.growing;
        const [q, r] = key.split(',').map(Number);
        let sum = 0, n = 0;
        const years = Math.max(1, _num(C.weather.normalYears, 6));
        for (let y = 0; y < years; y++) {
            for (let d = G.sowDay; d <= G.settleDay; d += Math.max(1, G.sampleEvery)) {
                sum += Harvests._score(world, q, r, y * Seasons.DAYS_PER_YEAR + d);
                n++;
            }
        }
        const v = n ? sum / n : 0;
        cache.set(key, v);
        return v;
    },

    /** A growing-season sample: the weather at the regions' towns, the wars, the raiders abroad, blights starting and spreading. */
    _sample(world, st, day) {
        const C = Harvests.config();
        const cur = st.cur;
        const doy = Seasons.dayOfYear(day);
        const regions = cur.regions;
        for (const rec of Object.values(regions)) {
            let s = 0, n = 0, norm = 0;
            for (const key of rec.pts) {
                const [q, r] = key.split(',').map(Number);
                s += Harvests._score(world, q, r, day);
                norm += Harvests._normal(world, key);
                n++;
            }
            if (n) {
                rec.ws = _r3(rec.ws + s / n);
                rec.wn++;
                rec.norm = _r3(norm / n);
            }
        }
        // War: the realm's wars, and raiders and war hosts on its land
        for (const [id, rec] of Object.entries(regions)) {
            if (rec.kingdomId == null) continue;
            const k = Harvests._kingdomOf(world, id);
            if (k && k.isAlive !== false) rec.war = _r3(rec.war + ((k.wars && k.wars.length) || 0));
        }
        for (const u of world.units || []) {
            if (!u || u.destroyed || (u.type !== 'raider' && u.type !== 'war_host')) continue;
            const rec = regions[Harvests.regionOf(world, u.q, u.r)];
            if (rec) rec.raid = _r3(rec.raid + 1);
        }
        // Blights: those due start; the active ones may cross to a neighbour
        const seed = Harvests.seed(world);
        const has = (rec, kind) => rec.blights.some(b => b.kind === kind);
        for (const [id, rec] of Object.entries(regions)) {
            for (const p of rec.plan) {
                if (p.day > doy || has(rec, p.kind)) continue;
                rec.blights.push({ kind: p.kind, sev: p.sev, day, from: null });
                Harvests._record(world, st, 'blight', id, day, { blight: p.kind });
            }
        }
        const every = Math.max(1, C.growing.sampleEvery);
        const spreads = [];
        for (const [id, rec] of Object.entries(regions)) {
            for (const b of rec.blights) {
                if (b.day === day) continue;
                const def = C.blights[b.kind];
                if (!def) continue;
                for (const nid of rec.nb) {
                    const nrec = regions[nid];
                    if (!nrec || has(nrec, b.kind)) continue;
                    if (def.warmAbove != null && nrec.temp <= def.warmAbove) continue;
                    if (_roll(seed, 'spread', cur.year, b.kind, id, nid, day) < def.spread * every / 30) spreads.push({ nid, kind: b.kind, sev: _r3(b.sev * def.decay), from: id });
                }
            }
        }
        for (const x of spreads) {
            const nrec = regions[x.nid];
            if (has(nrec, x.kind)) continue;
            nrec.blights.push({ kind: x.kind, sev: x.sev, day, from: x.from });
            Harvests._record(world, st, 'blight', x.nid, day, { blight: x.kind, from: Harvests.regionName(world, x.from) });
        }
    },

    /** Samples due over the whole season (for the forecast's confidence). */
    _samplesDue() {
        const G = Harvests.config().growing;
        return Math.floor((G.settleDay - G.sowDay) / Math.max(1, G.sampleEvery)) + 1;
    },

    /** A region's harvest as the season stands: { weather, war, blights:{crop:factor}, yields:{...}, conf }. */
    _reckon(rec, final = false) {
        const C = Harvests.config();
        const W = C.weather;
        const due = Harvests._samplesDue();
        const conf = final ? 1 : _clamp(_num(rec.wn) / due, 0, 1);
        let weather = 1;
        if (rec.wn > 0 && rec.norm != null) {
            const dev = rec.ws / rec.wn - rec.norm;
            weather = _clamp(1 + W.gain * dev, W.min, W.max);
        }
        weather = 1 + (weather - 1) * conf;
        const n = Math.max(1, _num(rec.wn));
        const war = _clamp(C.war.perWar * _num(rec.war) / n + C.war.perBattle * _num(rec.battles) + C.war.perRaider * _num(rec.raid) / n, 0, C.war.max);
        const hit = {};
        for (const c of YIELDS) hit[c] = 1;
        for (const b of rec.blights || []) {
            const def = C.blights[b.kind];
            for (const c of (def ? def.hits : [])) if (hit[c] != null) hit[c] *= 1 - _clamp(_num(b.sev), 0, 0.95);
        }
        const yields = {};
        const crop = weather * (1 - war);
        for (const c of ['grain', 'veg', 'fibre', 'vine', 'fodder']) yields[c] = _r3(crop * hit[c]);
        // The herds feel a drought on the pastures a little, war half as much
        yields.stock = _r3((1 + (weather - 1) * 0.3) * (1 - war * 0.5) * hit.stock * (0.85 + 0.15 * hit.fodder));
        const headline = _r3(yields.grain * 0.7 + yields.veg * 0.3);
        return { weather: _r3(weather), war: _r3(war), hit, yields, y: headline, conf: _r3(conf) };
    },

    /** The harvest is in: every region's reckoned, every town's fields and the player's farms take it up. */
    _settle(world, st, Y, day, player, out) {
        const C = Harvests.config();
        const cur = st.cur;
        const res = {};
        for (const [id, rec] of Object.entries(cur.regions)) {
            const r = Harvests._reckon(rec, true);
            res[id] = {
                name: rec.name, kingdomId: rec.kingdomId, y: r.y, ...r.yields, weather: r.weather, war: r.war,
                blights: (rec.blights || []).map(b => b.kind),
            };
        }
        // The towns: their own soil, sacking and hands at harvest
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
        for (const s of views) {
            const live = (world.getTile(s.q, s.r) || {}).settlement || s;
            const f = Harvests.ensureFarm(world, live);
            const id = cur.towns[_key(s.q, s.r)] || Harvests.regionOfTown(world, s);
            const o = res[id];
            const soil = _num(f.soil, 1);
            const dmg = _clamp(_num(live.damage), 0, 0.9) * C.war.townDamage;
            const land = TownLabour.factors(live, day).land;
            const hands = land < C.labour.below ? 1 - (C.labour.below - land) * C.labour.k : 1;
            const y = {};
            for (const c of YIELDS) {
                const base = o ? _num(o[c], 1) : 1;
                y[c] = _r3(_clamp(c === 'stock' ? base * (1 - dmg * 0.5) : base * soil * (1 - dmg) * hands, 0.1, 1.6));
            }
            f.y = y;
            f.yr = Y;
            f.rg = id;
        }
        st.last = { year: Y, day, out: res };
        st.past.push({ year: Y, out: res });
        while (st.past.length > Math.max(1, _num(C.pastYears, 4))) st.past.shift();
        cur.settled = true;
        st.ver = _num(st.ver) + 1;
        // The heralds' news: the harvests that failed and the bumper ones
        for (const [id, o] of Object.entries(res)) {
            if (o.y < C.forecast.poorBelow) Harvests._record(world, st, 'poor', id, day, { pct: Math.round(o.y * 100) });
            else if (o.y > C.forecast.plentyAbove) Harvests._record(world, st, 'plenty', id, day, { pct: Math.round(o.y * 100) });
        }
        // The player's farms: their soil follows their rotation
        if (player && Array.isArray(player.properties)) {
            for (const ref of player.properties) {
                const tile = world.getTile(ref.q, ref.r);
                const props = tile && Array.isArray(tile.playerProperties) ? tile.playerProperties : [];
                const prop = props.find(p => p && p.type === ref.type);
                if (!prop || !C.propertyCrops[prop.type]) continue;
                const rot = C.rotations[prop.rotation] || C.rotations.three_field;
                const soil = _num(prop.soil, 1);
                prop.soil = _r3(_clamp(soil + C.soil.rate * (_num(rot.soil, 1) - soil), C.soil.min, C.soil.max));
            }
            const own = Harvests.regionOf(world, player.q, player.r);
            const o = res[own];
            if (o) {
                const pct = Math.round(o.y * 100);
                out.notices.push({ icon: o.y < 0.85 ? '🥀' : o.y > 1.12 ? '🌾' : '🌾', title: 'The Harvest Is In', type: o.y < 0.85 ? 'warning' : 'info',
                    text: `The harvest in ${o.name} came in at ${pct}% of a normal year${o.blights.length ? ` (${o.blights.map(b => (C.blights[b] || {}).name || b).join(', ')})` : ''}.` });
            }
        }
    },

    /** Mid-season news: a failing harvest (from heraldFrom), a bumper one (from bumperFrom). */
    _announce(world, st, day) {
        const C = Harvests.config();
        const F = C.forecast;
        const doy = Seasons.dayOfYear(day);
        if (doy < F.heraldFrom || (doy - F.heraldFrom) % 5 !== 0) return;
        for (const [id, rec] of Object.entries(st.cur.regions)) {
            const est = Harvests._reckon(rec).y;
            if (est < F.failingBelow) Harvests._record(world, st, 'failing', id, day, { pct: Math.round(est * 100) });
            else if (doy >= F.bumperFrom && est > F.bumperAbove) Harvests._record(world, st, 'bumper', id, day, { pct: Math.round(est * 100) });
        }
    },

    /** A news record for the heralds and the towns' talk (once per kind, region and year). */
    _record(world, st, kind, id, day, extra = {}) {
        const Y = Harvests.yearOf(day);
        const key = `hv:${Y}:${id}:${kind}${extra.blight ? `:${extra.blight}` : ''}`;
        if (st.history.some(h => h.key === key)) return null;
        const rec = (st.cur && st.cur.regions && st.cur.regions[id]) || {};
        const first = rec.pts && rec.pts[0] ? rec.pts[0].split(',').map(Number) : null;
        const h = {
            key, kind, day, region: id, place: Harvests.regionName(world, id), kingdomId: rec.kingdomId != null ? rec.kingdomId : null,
            q: first ? first[0] : null, r: first ? first[1] : null, ...extra,
        };
        st.history.push(h);
        const cap = Math.max(5, _num(Harvests.config().historyCap, 40));
        while (st.history.length > cap) st.history.shift();
        return h;
    },

    // ── Reading the harvest ───────────────────────────────

    /**
     * What is known of a region's coming harvest today: { est, conf, weather,
     * war, blights, settled, year }. In the growing season the estimate firms
     * up as the samples come in; after the reckoning it is the outcome.
     */
    forecast(world, region) {
        const st = world && _obj(world.harvests);
        if (!st) return null;
        const cur = st.cur;
        if (cur && !cur.settled && cur.regions && cur.regions[region]) {
            const rec = cur.regions[region];
            const r = Harvests._reckon(rec);
            return { est: r.y, conf: r.conf, weather: r.weather, war: r.war, yields: r.yields, blights: rec.blights.map(b => b.kind), settled: false, year: cur.year };
        }
        const o = st.last && st.last.out && st.last.out[region];
        if (o) return { est: o.y, conf: 1, weather: o.weather, war: o.war, yields: Harvests._yieldsOf(o), blights: o.blights || [], settled: true, year: st.last.year };
        return null;
    },

    _yieldsOf(o) {
        const y = {};
        for (const c of YIELDS) y[c] = _num(o[c], 1);
        return y;
    },

    /** The best estimate of a region's harvest today (1 = a normal year; 1 when nothing is known). */
    expectedYield(world, region) {
        const f = Harvests.forecast(world, region);
        return f ? f.est : 1;
    },

    /** The reckoned harvest of a region in a year ({ y, grain, veg, fibre, vine, fodder, stock, weather, war, blights, name }), or null. */
    outcome(world, region, year = null) {
        const st = world && _obj(world.harvests);
        if (!st) return null;
        const Y = year == null ? (st.last ? st.last.year : null) : year;
        if (Y == null) return null;
        const row = st.past.find(p => p && p.year === Y);
        const o = row && row.out && row.out[region];
        return o ? { ...o, year: Y } : null;
    },

    /** Every region of the season in progress (or the last harvest): [{ id, name, kingdomId, est, conf, settled, blights }]. */
    regions(world) {
        const st = world && _obj(world.harvests);
        if (!st) return [];
        const ids = st.cur && st.cur.regions ? Object.keys(st.cur.regions) : Object.keys((st.last && st.last.out) || {});
        return ids.map(id => {
            const f = Harvests.forecast(world, id);
            return { id, name: Harvests.regionName(world, id), kingdomId: (st.cur && st.cur.regions[id] || {}).kingdomId ?? null, ...(f || { est: 1, conf: 0, settled: false, blights: [] }) };
        });
    },

    /** The news on record ([{ key, kind, day, region, place, kingdomId, q, r, blight?, pct? }]). */
    history(world) {
        const st = world && _obj(world.harvests);
        return st && Array.isArray(st.history) ? st.history : [];
    },

    /** A blight's display name. */
    blightName(kind) {
        const b = Harvests.config().blights[kind];
        return b ? b.name : String(kind || 'blight');
    },

    /**
     * What townsfolk say of the harvest in a town's region (systems/chatter.js
     * `harvest`): 'failing', 'bumper' and the blights' kinds in the season;
     * 'poor' or 'plenty' after the reckoning.
     */
    talk(world, s) {
        const out = [];
        const st = world && _obj(world.harvests);
        if (!st || !s || !Number.isFinite(world.day)) return out;
        const F = Harvests.config().forecast;
        const doy = Seasons.dayOfYear(world.day);
        const id = Harvests.regionOfTown(world, s);
        const cur = st.cur;
        if (cur && !cur.settled && cur.regions && cur.regions[id] && doy >= F.talkFrom) {
            const rec = cur.regions[id];
            const est = Harvests._reckon(rec).y;
            if (est < F.failingBelow) out.push('failing');
            else if (est > F.bumperAbove) out.push('bumper');
            for (const b of rec.blights) if (!out.includes(b.kind)) out.push(b.kind);
        } else if (st.last && st.last.out && st.last.out[id] && (doy > Harvests.config().growing.settleDay && doy <= F.talkUntil)) {
            const o = st.last.out[id];
            if (o.y < F.poorBelow) out.push('poor');
            else if (o.y > F.plentyAbove) out.push('plenty');
        }
        return out;
    },

    // ── The player's farms ────────────────────────────────

    /** The rotation a player property follows (farms only) and its label. */
    rotation(prop) {
        const C = Harvests.config();
        const id = prop && C.rotations[prop.rotation] ? prop.rotation : 'three_field';
        return { id, ...C.rotations[id] };
    },

    /** Choose a farm's rotation: 'intensive' | 'three_field' | 'rest'. → { success, message }. */
    setRotation(player, world, q, r, type, rot) {
        const C = Harvests.config();
        if (!C.rotations[rot]) return { success: false, message: 'No such rotation.' };
        if (!C.propertyCrops[type]) return { success: false, message: 'Only farms, orchards and herds keep a rotation.' };
        const owns = (player && player.properties || []).some(p => p && p.q === q && p.r === r && p.type === type);
        const tile = owns && world ? world.getTile(q, r) : null;
        const prop = tile && Array.isArray(tile.playerProperties) ? tile.playerProperties.find(p => p && p.type === type) : null;
        if (!prop) return { success: false, message: 'You own no such property here.' };
        prop.rotation = rot;
        return { success: true, message: `${prop.name || 'The farm'} will follow ${C.rotations[rot].label.toLowerCase()} from the next sowing: yield ×${C.rotations[rot].yield}, soil heading for ${Math.round(C.rotations[rot].soil * 100)}%.` };
    },

    /**
     * The harvest's factor on a player property's output (1 for properties
     * that grow nothing): the region's yield for its crop (irrigated land
     * feels irrigatedDamp of a bad year) × its soil × its rotation.
     */
    propertyFactor(world, tile, prop) {
        if (!prop || !tile) return 1;
        const C = Harvests.config();
        const crop = C.propertyCrops[prop.type];
        if (!crop) return 1;
        const st = world && _obj(world.harvests);
        const o = st && st.last && st.last.out ? st.last.out[Harvests.regionOf(world, tile.q, tile.r)] : null;
        let y = o ? _num(o[crop], 1) : 1;
        if (prop.type === 'irrigated_farm' && y < 1) y = 1 + (y - 1) * _num(C.irrigatedDamp, 0.5);
        if (crop === 'stock') return _clamp(y, 0.1, 1.6);
        const rot = Harvests.rotation(prop);
        return _clamp(y * _num(prop.soil, 1) * _num(rot.yield, 1), 0.1, 2);
    },

    // ── The player's knowledge ────────────────────────────

    playerState(player) {
        if (!player) return null;
        let s = _obj(player.harvests);
        if (!s) s = player.harvests = { known: {}, reportAt: null };
        if (!_obj(s.known)) s.known = {};
        return s;
    },

    serializePlayer(player) {
        const s = player && _obj(player.harvests);
        return s ? JSON.parse(JSON.stringify(s)) : null;
    },

    /**
     * The player hears their own region's estimate where they stand, and
     * every region's at a market town's weekly crop report in the season.
     */
    _learn(world, player, day) {
        if (!Number.isFinite(player.q) || player.boardedShip) return;
        const st = Harvests.state(world);
        if (!st.cur && !st.last) return;
        const ps = Harvests.playerState(player);
        const C = Harvests.config();
        const F = C.forecast;
        const doy = Seasons.dayOfYear(day);
        const note = (id, src) => {
            const f = Harvests.forecast(world, id);
            if (!f) return;
            ps.known[id] = { day, est: f.est, conf: f.conf, settled: f.settled, year: f.year, src, name: Harvests.regionName(world, id), blights: f.blights.slice() };
        };
        note(Harvests.regionOf(world, player.q, player.r), 'local');
        const t = world.getTile(player.q, player.r);
        if (t && t.settlement && t.settlement.market && doy >= F.reportFrom && (ps.reportAt == null || day - ps.reportAt >= F.reportEvery)) {
            ps.reportAt = day;
            const ids = st.cur && st.cur.regions ? Object.keys(st.cur.regions) : [];
            for (const id of ids) note(id, 'report');
        }
        // Forget old years' estimates
        const Y = Harvests.yearOf(day);
        for (const [id, k] of Object.entries(ps.known)) if (!k || _num(k.year, Y) < Y - 1) delete ps.known[id];
    },

    /** What the player knows of each region's harvest: [{ id, name, est, conf, settled, day, src, blights }], worst first. */
    known(player, world) {
        const ps = player && _obj(player.harvests);
        if (!ps || !_obj(ps.known)) return [];
        return Object.entries(ps.known).map(([id, k]) => ({ id, ...k })).sort((a, b) => a.est - b.est);
    },
};

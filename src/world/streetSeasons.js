// ============================================
// STREET SEASONS — what the season has done to the ground of a hex today
// ============================================
//
// The street map (the inner map) shows the season as it lies on the ground:
// snow that piles up over the cold wet days and melts on the warm ones (slush,
// then mud), ponds and rivers frozen over in a hard winter and thin again near
// the thaw, unpaved ground gone to mud after rain, autumn leaves lying. This
// module works that out — a pure function of the world, the hex and the day:
// it walks the last weeks day by day over the weather's own precipitation
// field (world/weather.js) and a smooth seasonal temperature (the tile's own,
// a cosine through the year, the climate's era: world/climate.js, and a hashed
// daily wobble). It draws no randomness and keeps no state, so nothing about
// it needs saving and a reload sees the same ground.
//
// It also keeps the town calendar of the street: the harvest fair (each town
// its own days in autumn, or a great fair on: systems/marketFairs.js), the
// midwinter bonfire, the spring sowing.
//
// The map side (ice to walk on, the pace of feet and carts, festival props,
// townsfolk at the fair) is world/innerMap/streetSeasons.js; the look of it
// is ui/innerMapLayers/streetSeasons.js. Data: data/streetSeasons.json.

import { DataLoader } from '../core/dataLoader.js';
import { Seasons } from './seasons.js';
import { Climate } from './climate.js';

const DEFAULTS = {
    enabled: true,
    lookbackDays: 50,
    temperature: { amplitude: 0.17, coldestDay: 104, wobble: 0.035 },
    snow: {
        wetAbove: 0.58, fallPerWet: 1.1, snowBelowC: 1, meltPerDegree: 0.035, rainMelt: 0.08, sunMelt: 0.01, max: 1,
        lookWinterAt: 0.32, lookWinterSpringAt: 0.5, lookWinterAutumnAt: 0.45, roofAt: 0.12, bankAt: 0.38, slushDays: 3,
    },
    ice: {
        perDegreeFrost: 0.02, perDegreeThaw: 0.045, rainThaw: 0.05, max: 1.4, thin: 0.22, solid: 0.55, riverRate: 0.45,
        rottenBelow: 0.75, crackBase: 0.22, warnEvery: 6, thinPathCost: 6, holeRefreezeDays: 2,
    },
    mud: { wetAbove: 0.6, perWet: 0.9, meltSoak: 1.6, dryPerDay: 0.09, warmDry: 0.004, showAt: 0.18, puddlesAt: 0.45 },
    leaves: { points: [[58, 0], [64, 0.15], [72, 0.55], [80, 0.9], [88, 1], [94, 0.7], [100, 0.3], [106, 0]], fallingAt: 0.15, fallingPerBlock: 5 },
    pace: { deepSnow: [0.62, 0.45], mud: [0.68, 0.45], slush: [0.88, 0.8], ice: [0.92, 0.75], thinIce: [0.8, 0.6] },
    harvestFair: { firstDay: 16, spread: 6, days: 3, hours: [9, 20], join: {}, radius: 7, props: [], lines: [], music: [] },
    midwinter: { days: [14, 16], hours: [16, 24], join: {}, props: [], ring: [2, 3], lines: [] },
    shovelling: { snowAt: 0.3, hours: [6, 12], share: {}, stay: [14, 26], lines: [] },
    snowPlay: { snowAt: 0.3, share: 0.55, snowmen: 3, lines: [] },
    sowing: { days: [1, 22], extra: {}, labels: ['Sowing the field'], lines: [] },
    stay: {},
    notices: {},
};

const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Integer hash → 0..1 (no RNG drawn). */
export function ssHash(a, b = 0, c = 0, d = 0) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647) + Math.imul(d | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** A stable number for a string (a town's name). */
export function ssStrHash(s) {
    let h = 2166136261;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
}

let _cfg = null;
let _cfgSrc;
// One remembered answer: the map asks for the same hex and day many times
let _memo = { key: null, st: null };

export const StreetSeasons = {
    /** Settings: data/streetSeasons.json over the defaults (section by section). */
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.streetSeasons : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const out = { ...DEFAULTS, ...d };
            for (const k of Object.keys(DEFAULTS)) {
                if (_obj(DEFAULTS[k])) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            }
            _cfg = out;
            _memo = { key: null, st: null };
        }
        return _cfg;
    },

    /** Day of the year 1..120 for any day (before day 1 too). */
    doy(day) {
        const d = Math.floor(_num(day, 1)) - 1;
        return ((d % 120) + 120) % 120 + 1;
    },

    /** The calendar season of a day (any day, before day 1 too). */
    seasonOf(day) {
        return Seasons.NAMES[Math.floor((StreetSeasons.doy(day) - 1) / 30)];
    },

    /** Day within its season, 1..30. */
    dayInSeason(day) {
        return ((StreetSeasons.doy(day) - 1) % 30) + 1;
    },

    /**
     * The street's temperature in °C at a world tile on a day: the tile's own
     * warmth, a cosine through the year, the climate's era and a hashed wobble
     * (the weather's 0..1 scale: 0 → −30 °C, 1 → 50 °C).
     */
    celsius(world, tile, q, r, day) {
        const C = StreetSeasons.config().temperature;
        const base = _num(tile && tile.temperature, 0.5);
        const doy = StreetSeasons.doy(day);
        const curve = -_num(C.amplitude, 0.17) * Math.cos(2 * Math.PI * (doy - _num(C.coldestDay, 104)) / 120);
        let era = 0;
        try { era = tile && world ? _num(Climate.tempAt(world, tile, day), 0) : 0; } catch { era = 0; }
        const seed = _num(world && world.weather && world.weather.seed, 0);
        const wob = (ssHash(q, r, day, seed) + ssHash(q + 7, r - 3, day - 1, seed) - 1) * _num(C.wobble, 0.035);
        return (base + curve + era + wob) * 80 - 30;
    },

    /** The weather's wetness 0..1 at a hex on a day (0.4 — dry — without a weather system). */
    wetness(world, q, r, day) {
        const w = world && world.weather;
        if (!w || typeof w.precipitation !== 'function') return 0.4;
        try { return _num(w.precipitation(q, r, day), 0.4); } catch { return 0.4; }
    },

    /**
     * The ground of hex (q, r) on `day`:
     *   { day, season, celsius, snow, slush, ice, thawing, mud, leaves, snowing, raining, wet }
     * snow 0..1 (its depth), slush 0..1 (snow melting these last days), ice 0..max
     * (its thickness on still water), thawing (the ice went down these last days),
     * mud 0..1 (0 while the ground is frozen), leaves 0..1 (lying).
     * null when the world has no such hex.
     */
    state(world, q, r, day) {
        const cfg = StreetSeasons.config();
        const d0 = Math.floor(_num(day, _num(world && world.day, 1)));
        const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        const seed = _num(world && world.weather && world.weather.seed, 0);
        const key = `${q},${r},${d0},${seed},${world && world.generationParams ? world.generationParams.seed : ''}`;
        if (_memo.key === key && _memo.w === world) return _memo.st;
        const S = cfg.snow, I = cfg.ice, M = cfg.mud;
        const L = Math.max(10, Math.floor(_num(cfg.lookbackDays, 50)));
        let snow = 0, ice = 0, mud = 0;
        let lastMelt = -1e9, meltRecent = 0, iceBefore = 0;
        const iceHist = [];
        let c = 0, wet = 0;
        for (let d = d0 - L + 1; d <= d0; d++) {
            c = StreetSeasons.celsius(world, tile, q, r, d);
            wet = StreetSeasons.wetness(world, q, r, d);
            const wetDay = wet > _num(S.wetAbove, 0.58);
            // Snow: falls on cold wet days, melts on warm ones (rain melts it faster)
            if (wetDay && c < _num(S.snowBelowC, 1)) {
                snow = Math.min(_num(S.max, 1), snow + (wet - _num(S.wetAbove, 0.58)) * _num(S.fallPerWet, 1.1));
            }
            let melted = 0;
            if (c > 0 && snow > 0) {
                const m = c * _num(S.meltPerDegree, 0.035) + (wetDay ? _num(S.rainMelt, 0.08) : 0) + _num(S.sunMelt, 0.01);
                melted = Math.min(snow, m);
                snow -= melted;
            }
            if (melted > 0.005) { lastMelt = d; meltRecent = d0 - d < _num(S.slushDays, 3) ? meltRecent + melted : meltRecent; }
            // Ice on still water: frost builds it, warmth and rain eat it
            iceBefore = ice;
            if (c < 0) ice = Math.min(_num(I.max, 1.4), ice + (-c) * _num(I.perDegreeFrost, 0.02));
            else ice = Math.max(0, ice - c * _num(I.perDegreeThaw, 0.045) - (wetDay ? _num(I.rainThaw, 0.05) : 0));
            iceHist.push(ice - iceBefore);
            if (iceHist.length > 3) iceHist.shift();
            // Mud: rain and snowmelt on unfrozen ground soak it, dry days dry it
            if (c > 0) {
                if (wet > _num(M.wetAbove, 0.6)) mud += (wet - _num(M.wetAbove, 0.6)) * _num(M.perWet, 0.9);
                mud += melted * _num(M.meltSoak, 1.6);
                mud -= _num(M.dryPerDay, 0.09) + Math.max(0, c - 10) * _num(M.warmDry, 0.004);
                mud = _clamp(mud, 0, 1);
            }
        }
        const slushDays = _num(S.slushDays, 3);
        const slush = d0 - lastMelt < slushDays ? _clamp(meltRecent * 3, 0, 1) : 0;
        const thawing = ice > 0 && iceHist.reduce((a, b) => a + b, 0) < -0.005;
        const snowing = wet > _num(S.wetAbove, 0.58) && c < _num(S.snowBelowC, 1);
        const raining = wet > _num(M.wetAbove, 0.6) && !snowing;
        const st = {
            day: d0,
            season: StreetSeasons.seasonOf(d0),
            celsius: Math.round(c * 10) / 10,
            snow: Math.round(snow * 1000) / 1000,
            slush: Math.round(slush * 1000) / 1000,
            ice: Math.round(ice * 1000) / 1000,
            thawing,
            mud: c > 0 ? Math.round(mud * 1000) / 1000 : 0,
            leaves: StreetSeasons.leavesOn(d0),
            snowing,
            raining,
            wet: Math.round(wet * 1000) / 1000,
        };
        _memo = { key, w: world, st };
        return st;
    },

    /** Leaves lying 0..1 by the day of the year (data: leaves.points). */
    leavesOn(day) {
        const pts = (StreetSeasons.config().leaves.points || []).filter(p => Array.isArray(p)).slice().sort((a, b) => a[0] - b[0]);
        if (!pts.length) return 0;
        const x = StreetSeasons.doy(day);
        if (x <= pts[0][0]) return _num(pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
            if (x <= pts[i][0]) {
                const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
                return Math.round((y0 + (y1 - y0) * (x - x0) / Math.max(1, x1 - x0)) * 1000) / 1000;
            }
        }
        return _num(pts[pts.length - 1][1]);
    },

    /**
     * The season the street map looks like (which terrain sheets it wears): the
     * calendar's, except that a winter with no snow lying looks like late autumn
     * (bare and brown), and deep snow in autumn or spring looks like winter.
     */
    lookSeason(calendar, st) {
        if (!st) return calendar;
        const S = StreetSeasons.config().snow;
        const I = StreetSeasons.config().ice;
        if (calendar === 'Winter') return st.snow >= _num(S.lookWinterAt, 0.32) || st.ice >= _num(I.thin, 0.22) ? 'Winter' : 'Autumn';
        if (calendar === 'Autumn') return st.snow >= _num(S.lookWinterAutumnAt, 0.45) ? 'Winter' : 'Autumn';
        if (calendar === 'Spring') return st.snow >= _num(S.lookWinterSpringAt, 0.5) ? 'Winter' : 'Spring';
        return calendar;
    },

    /**
     * The ice on a body of water: { state: 'none' | 'thin' | 'solid', strength 0..1 }.
     * kind: 'pond' | 'lake' | 'river' | 'sea' (the sea never freezes here). Thawing ice
     * under `rottenBelow` has gone rotten: thin, whatever its thickness.
     */
    iceOn(st, kind = 'pond') {
        if (!st || kind === 'sea') return { state: 'none', strength: 0 };
        const I = StreetSeasons.config().ice;
        const eff = kind === 'river' ? st.ice * _num(I.riverRate, 0.45) : st.ice;
        const thin = _num(I.thin, 0.22), solid = _num(I.solid, 0.55);
        if (eff < thin) return { state: 'none', strength: 0 };
        const strength = _clamp((eff - thin) / Math.max(0.01, solid - thin), 0, 1);
        if (eff >= solid && !(st.thawing && eff < _num(I.rottenBelow, 0.75))) return { state: 'solid', strength: 1 };
        return { state: 'thin', strength: eff >= solid ? 0.6 : strength * 0.9 };
    },

    /** The chance a step on thin ice of this strength breaks it. */
    crackChance(strength) {
        return _clamp(_num(StreetSeasons.config().ice.crackBase, 0.22) * (1 - _clamp(_num(strength), 0, 1)), 0, 1);
    },

    // ── The town's calendar ────────────────────────────

    /** A town's own first day of its harvest fair this autumn (day of the season). */
    fairFirstDay(settlement) {
        const F = StreetSeasons.config().harvestFair;
        const h = ssStrHash(`${settlement && settlement.name}|${settlement && settlement.q},${settlement && settlement.r}`);
        return Math.max(1, Math.min(30, Math.floor(_num(F.firstDay, 16) + (h % (Math.max(0, _num(F.spread, 6)) + 1)))));
    },

    /** Is the harvest fair on in this town on `day` (its own days in autumn, or a great fair on)? */
    fairOn(settlement, day) {
        if (!settlement) return false;
        const f = settlement.market && settlement.market.fair;
        if (f && Number.isFinite(f.start) && day >= f.start && day <= _num(f.until, f.start)) return true;
        if (StreetSeasons.seasonOf(day) !== 'Autumn') return false;
        const first = StreetSeasons.fairFirstDay(settlement);
        const dis = StreetSeasons.dayInSeason(day);
        return dis >= first && dis < first + Math.max(1, _num(StreetSeasons.config().harvestFair.days, 3));
    },

    /** Are the midwinter fires lit on `day`? */
    midwinterOn(day) {
        if (StreetSeasons.seasonOf(day) !== 'Winter') return false;
        const D = StreetSeasons.config().midwinter.days || [14, 16];
        const dis = StreetSeasons.dayInSeason(day);
        return dis >= _num(D[0], 14) && dis <= _num(D[1], 16);
    },

    /** Is it the sowing in spring on `day`? */
    sowingOn(day) {
        if (StreetSeasons.seasonOf(day) !== 'Spring') return false;
        const D = StreetSeasons.config().sowing.days || [1, 22];
        const dis = StreetSeasons.dayInSeason(day);
        return dis >= _num(D[0], 1) && dis <= _num(D[1], 22);
    },

    /** Is hour `h` within [from, to)? */
    inHours(h, span) {
        const a = _num(span && span[0], 0), b = _num(span && span[1], 24);
        return h >= a && h < b;
    },

    /**
     * How fast feet (or a cart: cart true) go over a kind of ground today, x speed:
     * ground 'street' (cleared: paved or a road), 'soft' (unpaved, trodden soil, bare
     * earth, a field), 'open' (grass and the like), 'ice', 'thinIce'.
     */
    pace(st, ground, cart = false) {
        if (!st) return 1;
        const P = StreetSeasons.config().pace;
        const pick = (pair, k) => {
            const v = Array.isArray(pair) ? _num(pair[cart ? 1 : 0], 1) : _num(pair, 1);
            return 1 - (1 - v) * _clamp(k, 0, 1);
        };
        if (ground === 'ice') return pick(P.ice, 1);
        if (ground === 'thinIce') return pick(P.thinIce, 1);
        let k = 1;
        const M = StreetSeasons.config().mud;
        if (ground === 'open' || ground === 'soft') {
            // Snow lying off the cleared streets drags at the feet
            if (st.snow > 0.08) k = Math.min(k, pick(P.deepSnow, (st.snow - 0.08) / 0.92));
        }
        if (ground === 'soft' && st.mud >= _num(M.showAt, 0.18)) k = Math.min(k, pick(P.mud, st.mud));
        if (ground === 'street' && st.slush > 0.05) k = Math.min(k, pick(P.slush, st.slush));
        return Math.round(k * 1000) / 1000;
    },
};

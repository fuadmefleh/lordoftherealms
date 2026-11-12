// ============================================
// CLIMATE — the slow weather of centuries
// ============================================
// A seeded climate curve under the day-to-day weather (world/weather.js):
// one ERA at a time — a little ice age, a warm period, a great drought, wet
// decades — each lasting years to decades, ramping in and out, with quiet
// years between. A 10,000-day game (some 83 years) sees one to three.
//
//   anomaly    an era adds to the weather's temperature (scaled by latitude:
//              the north and south feel a cold age most) and precipitation
//              (droughts and wet decades strike a band of latitudes). The
//              weather reads it (`tempAt`, `wetAt`), so more snow, longer
//              cold spells, fewer heat waves follow by themselves — and with
//              them the cold-driven demand for firewood and warm clothes
//              (SettlementMarket.coldFactor/isCold read the temperature) and
//              building delays (systems/construction.js reads the weather).
//   harvests   `yieldFactor` — the region's crop and herds (world/harvests.js
//              _sample → rec.clim): cold lands fail in a cold age, the north
//              gains and the hot south loses in a warm one, droughts hit dry
//              margins hardest, the wet rots the grain on moist land.
//   sickness   `diseaseMult` — townsfolk sickness risk (systems/illness.js).
//   ice        `icebound` — a port too cold freezes: sea trade from it
//              mostly stops (systems/marketDynamics.js), ships cannot make
//              port there (systems/ships.js).
//   people     `hardship` — townsfolk migrate toward the towns the era spares
//              (systems/labour.js).
//   crises     `crisisWeights` — famines in droughts and cold ages, plagues
//              in wet ones, invasions out of a freezing north
//              (systems/crises.js), and a famine centres where it is worst.
//   telling    a notice when an era begins and ends, a chapter of the Annals
//              (`annalChapters` → systems/annals.js `ages`: "The Long Winter,
//              years 912–960"), a counsel hint, a line on the date's card
//              (`describe`), a colour grade on the map (`grade`).
//
// Deterministic: the eras are hashes of the world seed and the era's index
// (no RNG stream is touched); era i follows era i−1, so the curve is the same
// whether regenerated or loaded. The eras begun are kept on world.climate
// (saved, systems/saveLoad.js) so a loaded game keeps its history even if
// the data changes. Runs with player=null (the interregnum). Tuned in
// data/climate.json. Prose seam: Climate.useProse(LlmProse).

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Seasons } from './seasons.js';

const YEAR = Seasons.DAYS_PER_YEAR || 120;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r3 = (v) => Math.round(v * 1000) / 1000;
const _smooth = (t) => { const x = _clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const _fill = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const SEASON_TEMP = { Spring: 0.05, Summer: 0.15, Autumn: -0.05, Winter: -0.15 };
const WATER = new Set(['ocean', 'deep_ocean', 'sea', 'coast', 'lake']);

const DEFAULTS = {
    enabled: true, firstYears: [14, 30], gapYears: [20, 45], rampYears: 4,
    weights: { cold: 1.2, warm: 1, drought: 1, wet: 0.8 },
    kinds: {
        cold: { icon: '❄️', label: 'Little Ice Age', years: [20, 45], temp: [-0.05, -0.08], wet: [0, 0.02], names: ['the Long Winter'] },
        warm: { icon: '☀️', label: 'Warm Period', years: [22, 45], temp: [0.04, 0.07], wet: [-0.02, 0], names: ['the Warm Age'] },
        drought: { icon: '🏜️', label: 'Great Drought', years: [8, 18], temp: [0.01, 0.03], wet: [-0.12, -0.18], band: [0.18, 0.28], names: ['the Great Drought'] },
        wet: { icon: '🌧️', label: 'Wet Decades', years: [8, 16], temp: [-0.01, 0], wet: [0.08, 0.12], band: [0.2, 0.3], names: ['the Drowned Years'] },
    },
    latitude: { equator: 0.6, polar: 1.5 },
    yield: { cold: 1.4, warmCold: 1.2, warmMild: 0.3, warmHot: 1.0, coolBelow: 0.4, hotAbove: 0.7, drought: 1.6, dryMargin: 1.3, dryBelow: 0.35, wetRot: 0.6, wetDry: 0.8, min: 0.6, max: 1.2 },
    disease: { wet: 2.5, warm: 2, coldWinter: 2.5, max: 1.4 },
    ice: { below: 0.17, seaTrade: 0.15 },
    migration: { pull: 0.15, hardshipK: 2.5 },
    crisisBias: {},
    text: {},
};

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

function _hash(s) {
    let h = Utils.hashStr(String(s)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return _num(p && p.seed, 1);
}

/** A unit roll for `key` in this world (no RNG stream touched). */
function _roll(seed, key) {
    return (_hash(`${seed}|climate|${key}`) % 100000) / 100000;
}
const _range = (seed, key, pair) => { const [lo, hi] = Array.isArray(pair) ? pair : [pair, pair]; return _num(lo) + _roll(seed, key) * (_num(hi, lo) - _num(lo)); };

let _cfg = null;
let _cfgSrc;
let _prose = null;
/** Generated eras by seed and what was recorded (pure; rebuilt when either changes). */
const _gen = new Map();
/** The last eraAt answer (per world, day and recorded eras). */
const _at = { world: null, day: null, nrec: -1, cfg: null, seed: null, res: null };

export const Climate = {
    KINDS: ['cold', 'warm', 'drought', 'wet'],

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.climate;
        if (_cfg && _cfgSrc === src) return _cfg;
        _cfgSrc = src;
        _cfg = _merge(DEFAULTS, _obj(src) || {});
        _gen.clear();
        return _cfg;
    },

    /** Hand in the LLM prose writer (systems/llmProse.js: { write, text }). */
    useProse(impl) {
        _prose = impl && typeof impl.write === 'function' && typeof impl.text === 'function' ? impl : null;
    },

    // ── State ─────────────────────────────────────────

    state(world) {
        if (!world) return null;
        let st = _obj(world.climate);
        if (!st || st.v !== 1) st = world.climate = { v: 1, eras: [], seen: {}, log: [] };
        if (!Array.isArray(st.eras)) st.eras = [];
        if (!_obj(st.seen)) st.seen = {};
        if (!Array.isArray(st.log)) st.log = [];
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.climate);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.climate = _obj(saved) && saved.v === 1 ? saved : null;
        _at.world = null;
        if (world.climate) Climate.state(world);
    },

    // ── The curve ─────────────────────────────────────

    /** The game-year index (0-based, fractional) of a day. */
    yearOf(day) {
        return (Math.max(1, _num(day, 1)) - 1) / YEAR;
    },

    /** The calendar year a game-year index shows as (world.baseYear + index). */
    calendarYear(world, yi) {
        return (Number.isFinite(world && world.baseYear) ? world.baseYear : 1) + Math.floor(yi);
    },

    /** The `i`th era, following `prev` (or the world's start). Pure. */
    _make(seed, i, prev) {
        const C = Climate.config();
        const from = prev ? prev.to + Math.round(_range(seed, `gap:${i}`, C.gapYears)) : Math.round(_range(seed, 'first', C.firstYears));
        const kinds = Climate.KINDS.filter(k => _num(C.weights[k]) > 0 && C.kinds[k] && (!prev || k !== prev.kind));
        const total = kinds.reduce((s, k) => s + _num(C.weights[k]), 0);
        let roll = _roll(seed, `kind:${i}`) * total;
        let kind = kinds[kinds.length - 1] || 'cold';
        for (const k of kinds) { roll -= _num(C.weights[k]); if (roll <= 0) { kind = k; break; } }
        const K = C.kinds[kind] || DEFAULTS.kinds[kind];
        const years = Math.max(3, Math.round(_range(seed, `years:${i}`, K.years)));
        const names = _arr(K.names).length ? K.names : DEFAULTS.kinds[kind].names;
        const name = names[Math.floor(_roll(seed, `name:${i}`) * names.length) % names.length];
        const era = {
            id: `clim${i + 1}`, i, kind, name, from, to: from + years,
            temp: _r3(_range(seed, `temp:${i}`, K.temp || [0, 0])),
            wet: _r3(_range(seed, `wet:${i}`, K.wet || [0, 0])),
            band: null,
        };
        if (K.band) era.band = { c: _r3(0.2 + _roll(seed, `bandc:${i}`) * 0.6), h: _r3(_range(seed, `bandh:${i}`, K.band)) };
        return era;
    },

    /**
     * Every era up to (and covering) game year `uptoYear`: those recorded on
     * world.climate (begun before), then generated on from the last of them.
     */
    eras(world, uptoYear = null) {
        const C = Climate.config();
        if (!world || !C.enabled) return [];
        const seed = _seed(world);
        const rec = _arr(world.climate && world.climate.eras);
        const last = rec.length ? rec[rec.length - 1] : null;
        const key = `${seed}|${rec.length}|${last ? `${last.id}:${last.to}` : '-'}`;
        let list = _gen.get(key);
        const want = uptoYear == null ? Climate.yearOf(world.day) + 1 : uptoYear;
        if (!list || list.upto < want) {
            const out = rec.slice();
            let prev = last;
            let i = out.length;
            while (!prev || prev.to <= want) {
                prev = Climate._make(seed, i++, prev);
                out.push(prev);
                if (i > 2000) break;
            }
            list = { eras: out, upto: want };
            if (_gen.size > 64) _gen.clear();
            _gen.set(key, list);
        }
        return list.eras;
    },

    /** The era over a day and its strength 0..1 (the ramp in and out), or null. */
    eraAt(world, day) {
        const C = Climate.config();
        if (!world || !C.enabled) return null;
        const d = day == null ? _num(world.day, 1) : day;
        // (the weather asks this for every hex it draws: one look-up per world and day)
        const nrec = world.climate && Array.isArray(world.climate.eras) ? world.climate.eras.length : 0;
        const seed = _seed(world);
        if (_at.world === world && _at.day === d && _at.nrec === nrec && _at.cfg === C && _at.seed === seed) return _at.res;
        const y = Climate.yearOf(d);
        let res = null;
        for (const e of Climate.eras(world, y)) {
            if (y < e.from) break;
            if (y >= e.to) continue;
            const ramp = Math.max(0.5, Math.min(_num(C.rampYears, 4), (e.to - e.from) / 3));
            const env = Math.min(_smooth((y - e.from) / ramp), _smooth((e.to - y) / ramp));
            res = env > 0 ? { era: e, env } : null;
            break;
        }
        _at.world = world; _at.day = d; _at.nrec = nrec; _at.cfg = C; _at.seed = seed; _at.res = res;
        return res;
    },

    /** How far from the equator a row lies, 0..1, and the era's latitude scale there. */
    _lat(world, r) {
        const L = Climate.config().latitude;
        const H = _num(world && world.height, 60);
        const a = H > 1 ? Math.abs((_num(r) / (H - 1)) * 2 - 1) : 0.5;
        return _num(L.equator, 0.6) + (_num(L.polar, 1.5) - _num(L.equator, 0.6)) * a;
    },

    /** How much of a band era falls on row r (1 at its centre, 0 past its edge). */
    _band(world, era, r) {
        if (!era.band) return 1;
        const H = _num(world && world.height, 60);
        const at = H > 1 ? _num(r) / (H - 1) : 0.5;
        const x = Math.abs(at - era.band.c) / Math.max(0.01, era.band.h);
        return x >= 1 ? 0 : _smooth(1 - x);
    },

    /** The era's anomaly at a hex on a day: { temp, wet, era, env } (zeros when the climate is settled). */
    anomaly(world, q, r, day) {
        const at = Climate.eraAt(world, day);
        if (!at) return { temp: 0, wet: 0, era: null, env: 0 };
        const e = at.era;
        const band = Climate._band(world, e, r);
        const lat = e.band ? 1 : Climate._lat(world, r);
        return { temp: e.temp * at.env * lat * band, wet: e.wet * at.env * band, era: e, env: at.env };
    },

    /** Added to the weather's 0..1 temperature on a tile (world/weather.js). */
    tempAt(world, tile, day) {
        if (!tile) return 0;
        const at = Climate.eraAt(world, day);
        if (!at || !at.era.temp) return 0;
        const e = at.era;
        return e.temp * at.env * (e.band ? Climate._band(world, e, tile.r) : Climate._lat(world, tile.r)) || 0;
    },

    /** Added to the weather's 0..1 precipitation at a hex (world/weather.js). */
    wetAt(world, q, r, day) {
        const at = Climate.eraAt(world, day);
        if (!at || !at.era.wet) return 0;
        return at.era.wet * at.env * Climate._band(world, at.era, r) || 0;
    },

    // ── What it does ──────────────────────────────────

    /** The harvest factor the climate gives a hex on a day (1 = an ordinary age). */
    yieldFactor(world, q, r, day) {
        const a = Climate.anomaly(world, q, r, day);
        if (!a.era) return 1;
        const Y = Climate.config().yield;
        const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        const base = _num(tile && tile.temperature, 0.5);
        const moist = _num(tile && tile.moisture, 0.5);
        let f = 1;
        if (a.temp < 0) f += a.temp * Y.cold;
        else if (a.temp > 0) {
            if (base < Y.coolBelow) f += a.temp * Y.warmCold;
            else if (base > Y.hotAbove) f -= a.temp * Y.warmHot;
            else f += a.temp * Y.warmMild;
        }
        if (a.wet < 0) f += a.wet * Y.drought * (moist < Y.dryBelow ? Y.dryMargin : 1);
        else if (a.wet > 0) f += moist < Y.dryBelow ? a.wet * Y.wetDry : -a.wet * Y.wetRot;
        return _r3(_clamp(f, Y.min, Y.max));
    },

    /** How hard the era bears on a hex: 0 spared, up to 1; below 0 where it favours (the lands people go to). */
    hardship(world, q, r, day) {
        const M = Climate.config().migration;
        return _clamp((1 - Climate.yieldFactor(world, q, r, day)) * _num(M.hardshipK, 2.5), -0.5, 1);
    },

    /** Townsfolk sickness risk × this at a hex (systems/illness.js). */
    diseaseMult(world, q, r, day) {
        const a = Climate.anomaly(world, q, r, day);
        if (!a.era) return 1;
        const D = Climate.config().disease;
        let m = 1 + Math.max(0, a.wet) * D.wet + Math.max(0, a.temp) * D.warm;
        if (a.temp < 0 && Seasons.seasonOf(day == null ? world.day : day) === 'Winter') m += -a.temp * D.coldWinter;
        return _r3(_clamp(m, 0.8, _num(D.max, 1.4)));
    },

    /** The tile's temperature today with its season and the era (the weather's own scale). */
    seasonalTemp(world, tile, day) {
        if (!tile) return 0.5;
        const d = day == null ? _num(world && world.day, 1) : day;
        return _num(tile.temperature, 0.5) + _num(SEASON_TEMP[Seasons.seasonOf(d)]) + Climate.tempAt(world, tile, d);
    },

    /** Is the water at (or the harbour of a port town at) q,r frozen today? */
    icebound(world, q, r, day) {
        const C = Climate.config();
        if (!world || !C.enabled || typeof world.getTile !== 'function') return false;
        const tile = world.getTile(q, r);
        if (!tile) return false;
        return Climate.seasonalTemp(world, tile, day) < _num(C.ice.below, 0.1);
    },

    /** Multipliers on the crisis kinds' weights (systems/crises.js), eased by the era's ramp. */
    crisisWeights(world, day) {
        const at = Climate.eraAt(world, day);
        const out = {};
        if (!at) return out;
        const bias = _obj(Climate.config().crisisBias[at.era.kind]) || {};
        for (const [k, v] of Object.entries(bias)) if (!k.startsWith('_')) out[k] = _r3(1 + (_num(v, 1) - 1) * at.env);
        return out;
    },

    /** The settlements (views) the era hits hardest today, worst first (the famine's centre). */
    harshest(world, views, day, n = 5) {
        if (!Climate.eraAt(world, day)) return [];
        return _arr(views).map(s => ({ s, f: Climate.yieldFactor(world, s.q, s.r, day) }))
            .filter(x => x.f < 0.97)
            .sort((a, b) => a.f - b.f || (a.s.name < b.s.name ? -1 : 1))
            .slice(0, n).map(x => x.s);
    },

    /** Where a band era is worst: the largest town nearest its centre row. */
    _region(world, era) {
        if (!era.band) return era.kind === 'cold' ? 'the north and the south' : 'the whole world';
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : (typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : []);
        let best = null, bs = -Infinity;
        for (const s of _arr(views)) {
            const w = Climate._band(world, era, s.r);
            if (w <= 0.5) continue;
            const sc = w * 2 + Math.log10(Math.max(10, _num(s.population))) - (s.name || '').length * 0.001;
            if (sc > bs) { bs = sc; best = s; }
        }
        return best ? `the lands about ${best.name}` : 'the middle lands';
    },

    // ── The day ───────────────────────────────────────

    /**
     * Weekly: an era begun is recorded and told; at its middle, a line; when it
     * ends, its close. Call after world.advanceDay (ui/game/endDay.js, the
     * harness, the afterlife's world tick with player=null). → { notices }
     */
    processDay(world, player = null) {
        const out = { notices: [] };
        const C = Climate.config();
        if (!world || !C.enabled) return out;
        const day = _num(world.day, 1);
        if (day % 7 !== 5) return out;
        const st = Climate.state(world);
        const y = Climate.yearOf(day);
        for (const e of Climate.eras(world, y)) {
            if (y < e.from) break;
            const seen = st.seen[e.id];
            if (seen === 'ended') continue;
            if (!seen) {
                if (!st.eras.some(x => x.id === e.id)) st.eras.push({ ...e, band: e.band ? { ...e.band } : null });
                const rec = st.eras.find(x => x.id === e.id);
                rec.region = Climate._region(world, e);
                // (an era long over before this world kept a record — an older save — goes into
                // the record as it was, untold)
                const past = y >= e.to;
                rec.beganDay = past ? Math.round(e.from * YEAR) + 1 : day;
                st.seen[e.id] = 'begun';
                const line = Climate._log(world, st, rec, 'begin', rec.beganDay);
                if (player && line && !past) out.notices.push(Climate._notice(rec, line, 'warning'));
                if (past) {
                    st.seen[e.id] = 'ended';
                    rec.endedDay = Math.round(e.to * YEAR) + 1;
                    Climate._log(world, st, rec, 'end', rec.endedDay);
                    continue;
                }
            }
            const rec = st.eras.find(x => x.id === e.id) || e;
            if (st.seen[e.id] === 'begun' && y >= (e.from + e.to) / 2 && y < e.to) {
                st.seen[e.id] = 'mid';
                Climate._log(world, st, rec, 'mid');
            }
            if (y >= e.to) {
                st.seen[e.id] = 'ended';
                rec.endedDay = day;
                const line = Climate._log(world, st, rec, 'end');
                if (player && line) out.notices.push(Climate._notice(rec, line, 'info'));
            }
        }
        if (st.eras.length > 200) st.eras.splice(0, st.eras.length - 200);
        return out;
    },

    _notice(rec, line, type) {
        const K = Climate.config().kinds[rec.kind] || {};
        return { icon: K.icon || '🌦️', title: rec.name.charAt(0).toUpperCase() + rec.name.slice(1), text: line, type };
    },

    /** A dated line of an era's chronicle. */
    _log(world, st, rec, kind, atDay = null) {
        const T = (_obj(Climate.config().text[rec.kind]) || {})[kind];
        const list = _arr(T);
        if (!list.length) return null;
        const n = st.log.filter(x => x.id === rec.id).length;
        const pick = list[Math.floor(_roll(_seed(world), `line:${rec.id}:${kind}`) * list.length) % list.length];
        const vars = { name: rec.name, region: rec.region || 'the land', years: Math.max(1, rec.to - rec.from) };
        const text = _fill(pick, vars);
        const e = { id: rec.id, day: atDay != null ? atDay : _num(world.day, 1), kind, text, n };
        st.log.push(e);
        if (st.log.length > 300) st.log.splice(0, st.log.length - 300);
        if (_prose) {
            try { _prose.write(world, { kind: 'crisis', key: `climate:${rec.id}:${n}`, facts: { era: rec.name, kind: rec.kind, event: kind, region: vars.region, years: vars.years }, fallback: text, style: 'chronicle' }); } catch (err) { /* the template stands */ }
        }
        if (Array.isArray(world.events)) world.events.push({ text: `${(Climate.config().kinds[rec.kind] || {}).icon || '🌦️'} ${text}`, type: 'climate' });
        return text;
    },

    /** A chronicle line as it reads now (the LLM's if written, else the template). */
    line(world, e) {
        if (!e) return '';
        if (_prose) {
            try { return _prose.text(world, `climate:${e.id}:${e.n}`, e.text) || e.text; } catch (err) { return e.text; }
        }
        return e.text;
    },

    /** The eras the world has lived through or lives in (recorded), oldest first. */
    history(world) {
        return _arr(world && world.climate && world.climate.eras);
    },

    /**
     * Eras as chapters of the Annals (systems/annals.js `ages`): those lived
     * through since `fromDay`, oldest first — "The Long Winter, years 912–960".
     */
    annalChapters(world, fromDay = 0) {
        const st = world && _obj(world.climate);
        if (!st) return [];
        const C = Climate.config();
        return _arr(st.eras).filter(e => e.beganDay != null && (e.endedDay == null || e.endedDay >= fromDay)).map(e => {
            const K = C.kinds[e.kind] || {};
            const live = e.endedDay == null;
            const fromYear = Climate.calendarYear(world, e.from);
            const toYear = live ? null : Climate.calendarYear(world, e.to);
            const byYear = new Map();
            for (const x of st.log) {
                if (x.id !== e.id) continue;
                const yr = Climate.calendarYear(world, Climate.yearOf(x.day));
                if (!byYear.has(yr)) byYear.set(yr, []);
                byYear.get(yr).push(Climate.line(world, x));
            }
            const paragraphs = [...byYear.entries()].map(([yr, lines]) => ({ year: yr, text: `In the year ${yr}, ${lines.map((t, i) => (i === 0 ? t.charAt(0).toLowerCase() + t.slice(1) : t)).join(' ')}` }));
            const name = e.name.charAt(0).toUpperCase() + e.name.slice(1);
            return {
                id: `age_${e.id}`, kind: 'climate', climate: e.kind, icon: K.icon || '🌦️',
                title: `${name}, ${live ? `year ${fromYear} to the present` : `years ${fromYear}–${toYear}`}`,
                fromYear, toYear, live, outcome: null, paragraphs,
            };
        });
    },

    /**
     * A line for the date's card and the counsel: what the era does where you
     * stand. → { icon, name, era, text, yield, ice, disease, hardship } or null.
     */
    describe(world, q, r, day = null) {
        const d = day == null ? _num(world && world.day, 1) : day;
        const a = Climate.anomaly(world, q, r, d);
        if (!a.era) return null;
        const K = Climate.config().kinds[a.era.kind] || {};
        const f = Climate.yieldFactor(world, q, r, d);
        const tile = world.getTile ? world.getTile(q, r) : null;
        const parts = [];
        if (a.temp <= -0.02) parts.push('long hard winters, more snow, fuel and warm clothes dear');
        else if (a.temp >= 0.02) parts.push('mild winters and hot summers');
        if (a.wet <= -0.03) parts.push('the rains fail');
        else if (a.wet >= 0.03) parts.push('rain without end');
        const pct = Math.round((f - 1) * 100);
        if (Math.abs(pct) >= 2) parts.push(`harvests ${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`);
        const dm = Climate.diseaseMult(world, q, r, d);
        if (dm >= 1.05) parts.push('more sickness');
        // Frozen harbours in the cold north this winter (judged at midwinter)
        const midwinter = Math.floor((d - 1) / YEAR) * YEAR + 105;
        const ice = !!(tile && a.temp < 0 && Climate.seasonalTemp(world, tile, midwinter) < _num(Climate.config().ice.below, 0.1) + 0.05);
        if (ice) parts.push('harbours freeze in winter');
        const since = Climate.calendarYear(world, a.era.from);
        const name = a.era.name.charAt(0).toUpperCase() + a.era.name.slice(1);
        const text = parts.length ? `${K.icon || '🌦️'} ${name} (since ${since}): ${parts.join(', ')} here.` : `${K.icon || '🌦️'} ${name} (since ${since}): it is little felt here.`;
        return { icon: K.icon || '🌦️', name, era: a.era, text, yield: f, ice, disease: dm, hardship: Climate.hardship(world, q, r, d) };
    },

    /** The era's colour on the map (ui/renderer/atmosphere.js): { soft:[r,g,b,a], desat, frost } or null. */
    grade(world) {
        const at = Climate.eraAt(world, world && world.day);
        if (!at) return null;
        const k = at.env;
        switch (at.era.kind) {
            case 'cold': return { soft: [160, 190, 235, 0.08 * k], desat: 0.12 * k, frost: 0.04 * k };
            case 'warm': return { soft: [255, 205, 130, 0.06 * k], desat: 0, frost: 0 };
            case 'drought': return { soft: [225, 180, 110, 0.1 * k], desat: 0.1 * k, frost: 0 };
            case 'wet': return { soft: [110, 150, 140, 0.08 * k], desat: 0.06 * k, frost: 0 };
            default: return null;
        }
    },

    /** Is the water at a hex water (for callers checking a sea hex)? */
    isWater(tile) {
        return !!(tile && tile.terrain && WATER.has(tile.terrain.id));
    },
};

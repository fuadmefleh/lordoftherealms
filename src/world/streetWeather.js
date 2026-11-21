// ============================================
// STREET WEATHER — the weather of a hex hour by hour, as the street map feels it
// ============================================
//
// The world's weather (world/weather.js) is a pure function of (hex, day): two
// drifting fronts of precipitation. The street map wants it by the hour, so
// this reads the same precipitation field at the hour — the day's own value
// at noon, the fronts moving through the hours either side of it — plus a
// small hashed wobble for showers that come and go. Nothing new is invented:
// the top bar's "Rain" is the noon of the street's rain.
//
// From that it works out, again purely (no RNG drawn, nothing to save):
//   • what falls now: rain (light → heavy), a storm, snow, a blizzard, and the
//     cloud, the sun, the wind (its direction by hex and day, gusting by hour);
//   • the ground over the last day and a half: puddles that fill in the rain
//     and dry after it, fresh mud on the unpaved ground (on top of the season's
//     mud of past days: world/streetSeasons.js), the ground's dampness;
//   • a rainbow, a little while after a good rain clears with the sun out;
//   • fireflies on warm, still, dry summer nights; mist on damp, still dawns.
// The temperature is the street season's (StreetSeasons.celsius), with a
// day's swing from the small hours to the afternoon; below freezing what falls
// is snow, as the season's ground says.
//
// The map side (the going in the mud, shelter, townsfolk out of the rain) is
// world/innerMap/streetWeather.js; the player getting wet player/wetness.js;
// the look ui/innerMapLayers/weatherFx.js. Data: data/streetWeather.json.

import { DataLoader } from '../core/dataLoader.js';
import { StreetSeasons, ssHash } from './streetSeasons.js';

const DEFAULTS = {
    enabled: true,
    hourly: {
        showerAmp: 0.07, showerHours: 3, rainAbove: 0.68, stormAbove: 0.9, blizzardAbove: 0.85, cloudyAbove: 0.45,
        desertStormAbove: 0.92, snowBelowC: 1, diurnalC: 3.5, lookbackHours: 36,
    },
    ground: {
        puddleFill: 0.42, puddleDry: 0.09, mudSoak: 0.22, mudDry: 0.028, dampFill: 0.9, dampDry: 0.14,
        nightDry: 0.5, warmDryAbove: 16, warmDry: 0.5, frozenDry: 0.15,
    },
    pace: { mudFoot: 0.84, mudRide: 0.7, mudCart: 0.58, mudAt: 0.12, hurryInRain: 1.15 },
    wind: { calm: [0.12, 0.45], cloudy: 0.55, rain: 0.6, snow: 0.5, storm: 1, blizzard: 1 },
    rainbow: { hours: 1.6, minRain: 0.25, maxCloud: 0.6, chance: 0.7, sunHours: [7, 18.5] },
    fireflies: { seasons: ['Summer'], lateSpringFrom: 20, hours: [21, 3], minC: 12, maxWind: 0.6 },
    fog: { hours: [4, 9.5], peak: 6.2, seasons: { Spring: 0.9, Summer: 0.55, Autumn: 1, Winter: 0.7 }, maxWind: 0.75 },
    wetness: {},
    shelter: { heavyAt: 0.55, heavyShare: 0.65, lightShare: 0.2, eavesShare: 0.4 },
    fx: {},
};

const WATER_TERRAINS = ['ocean', 'deep_ocean', 'sea', 'coast', 'lake'];
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _smooth = t => t * t * (3 - 2 * t);

let _cfg = null;
let _cfgSrc;
// The last answer: the map asks for the same hex and quarter hour every frame
let _memo = { key: null, w: null, st: null };

/** Is hour h within [from, to) on a 24-hour clock that may wrap past midnight? */
function _inHours(h, span) {
    const a = _num(span && span[0], 0), b = _num(span && span[1], 24);
    return a <= b ? h >= a && h < b : h >= a || h < b;
}

/** 0 at night … 1 by day (the sun's light on the street). */
export function daylight(hour) {
    const h = ((_num(hour, 12) % 24) + 24) % 24;
    if (h < 5 || h > 21) return 0;
    if (h < 8) return (h - 5) / 3;
    if (h > 18) return (21 - h) / 3;
    return 1;
}

export const StreetWeather = {
    /** Settings: data/streetWeather.json over the defaults (section by section). */
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.streetWeather : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const out = { ...DEFAULTS, ...d };
            for (const k of Object.keys(DEFAULTS)) {
                if (_obj(DEFAULTS[k])) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            }
            _cfg = out;
            _memo = { key: null, w: null, st: null };
        }
        return _cfg;
    },

    /** Forget the remembered answer (tests; a forced weather). */
    clearMemo() {
        _memo = { key: null, w: null, st: null };
    },

    /**
     * The precipitation 0..1 at a hex at absolute hour `H` (day × 24 + hour):
     * the world's field read at the hour (its day's value at noon) plus the showers' wobble.
     */
    precipAt(world, q, r, H) {
        const w = world && world.weather;
        if (!w || typeof w.precipitation !== 'function') return 0.4;
        const C = StreetWeather.config().hourly;
        let p;
        try { p = _num(w.precipitation(q, r, (H - 12) / 24), 0.4); } catch { p = 0.4; }
        const amp = _num(C.showerAmp, 0.07);
        if (amp > 0) {
            const span = Math.max(0.5, _num(C.showerHours, 3));
            const x = H / span;
            const k = Math.floor(x);
            const seed = _num(w.seed, 0) | 0;
            const a = ssHash(q, r, k, seed + 17), b = ssHash(q, r, k + 1, seed + 17);
            p += (a + (b - a) * _smooth(x - k) - 0.5) * 2 * amp;
        }
        return _clamp(p, 0, 1);
    },

    /** The street's °C at a day and hour: the season's day (StreetSeasons.celsius) and the day's swing. */
    celsiusAt(world, tile, q, r, day, hour) {
        const base = StreetSeasons.celsius(world, tile, q, r, day);
        const sw = _num(StreetWeather.config().hourly.diurnalC, 3.5);
        return base + sw * Math.cos(2 * Math.PI * (_num(hour, 12) - 15) / 24);
    },

    /**
     * What falls at precipitation p and c °C on a tile: { type, intensity } with the
     * world weather's own thresholds (world/weather.js getWeather), snow below freezing.
     */
    classify(tile, p, c) {
        const C = StreetWeather.config().hourly;
        const baseTemp = _num(tile && tile.temperature, 0.5);
        const isWater = !!(tile && tile.terrain && WATER_TERRAINS.includes(tile.terrain.id));
        const rainAbove = _num(C.rainAbove, 0.68);
        if (p > rainAbove) {
            if (c < _num(C.snowBelowC, 1)) {
                if (p > _num(C.blizzardAbove, 0.85)) return { type: 'blizzard', intensity: 1 };
                return { type: 'snow', intensity: _clamp((p - rainAbove) * 4, 0.1, 1) };
            }
            if (baseTemp > 0.8 && !isWater) {
                return p > _num(C.desertStormAbove, 0.92) ? { type: 'storm', intensity: 1 } : { type: 'cloudy', intensity: 1 };
            }
            if (p > _num(C.stormAbove, 0.9)) return { type: 'storm', intensity: 1 };
            return { type: 'rain', intensity: _clamp((p - rainAbove) * 4, 0.1, 1) };
        }
        const cloudyAbove = _num(C.cloudyAbove, 0.45);
        if (p > cloudyAbove) return { type: 'cloudy', intensity: _clamp((p - cloudyAbove) * 4, 0, 1) };
        if (!isWater && (c + 30) / 80 > 0.82 && p < 0.3) return { type: 'heatwave', intensity: _clamp(((c + 30) / 80 - 0.82) * 6, 0, 1) };
        return { type: 'clear', intensity: 0 };
    },

    /** The wind at a hex and hour: { x, y, strength } (x signed across the view). */
    windAt(world, q, r, day, hour, type) {
        const W = StreetWeather.config().wind;
        const seed = _num(world && world.weather && world.weather.seed, 0) | 0;
        const [lo, hi] = Array.isArray(W.calm) ? W.calm : [0.12, 0.45];
        let s = _num(lo, 0.12) + (_num(hi, 0.45) - _num(lo, 0.12)) * ssHash(q, r, day, seed + 31);
        const k = W[type];
        if (Number.isFinite(Number(k))) s = Math.max(s, Number(k) * (0.75 + 0.25 * ssHash(q, r, day, seed + 37)));
        // it rises and falls through the day
        const x = (day * 24 + hour) / 5;
        const i = Math.floor(x);
        const a = ssHash(q, r, i, seed + 41), b = ssHash(q, r, i + 1, seed + 41);
        s *= 0.8 + 0.4 * (a + (b - a) * _smooth(x - i));
        s = _clamp(s, 0, 1);
        const ang = ssHash(q, r, day, seed + 43) * Math.PI * 2;
        return { x: Math.cos(ang) * s, y: Math.sin(ang) * s * 0.2, strength: s };
    },

    /**
     * The street's weather at hex (q, r), world day `day`, hour `hour` (fractions welcome):
     *   { day, hour, type, intensity, rain, snow, storm, cloud, sun, celsius, season, wind,
     *     puddles, mud, damp, sinceRain, rainbow, fireflies, fog, raining, snowing }
     * rain / snow 0..1 falling now; puddles, mud, damp 0..1 on the ground; sinceRain the hours
     * since the last rain stopped (Infinity if none these last hours); rainbow, fireflies, fog 0..1.
     * null without a weather system or a hex.
     */
    at(world, q, r, day, hour) {
        const cfg = StreetWeather.config();
        if (!cfg.enabled || !world || !world.weather) return null;
        const d0 = Math.floor(_num(day, _num(world.day, 1)));
        const h0 = _clamp(_num(hour, 12), 0, 24);
        const tile = typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (!tile) return null;
        const seed = _num(world.weather.seed, 0);
        const key = `${q},${r},${d0},${Math.floor(h0 * 4)},${seed}`;
        if (_memo.key === key && _memo.w === world) return _memo.st;
        const C = cfg.hourly, G = cfg.ground;
        const H = d0 * 24 + h0;
        const L = Math.max(6, Math.floor(_num(C.lookbackHours, 36)));
        // (each day's base temperature worked out once)
        const dayC = new Map();
        const cAt = (Habs) => {
            const d = Math.floor(Habs / 24);
            let base = dayC.get(d);
            if (base === undefined) { base = StreetSeasons.celsius(world, tile, q, r, d); dayC.set(d, base); }
            return base + _num(C.diurnalC, 3.5) * Math.cos(2 * Math.PI * ((Habs - d * 24) - 15) / 24);
        };
        const wetOf = (wx) => (wx.type === 'rain' ? wx.intensity : wx.type === 'storm' ? 1 : 0);
        let puddles = 0, mud = 0, damp = 0;
        let since = Infinity, spellPeak = 0, lastPeak = 0, spellEnd = null;
        const steps = L + 1;
        for (let i = 0; i < steps; i++) {
            // hourly samples up to now; the last step only the fraction of the hour gone
            const Hs = i < L ? H - L + i : H;
            const dt = i < L ? 1 : Math.max(0, h0 - Math.floor(h0)) || 0;
            const c = cAt(Hs);
            const wx = StreetWeather.classify(tile, StreetWeather.precipAt(world, q, r, Hs), c);
            const rr = wetOf(wx);
            const hh = ((Hs % 24) + 24) % 24;
            let dry = (hh >= 20 || hh < 6) ? _num(G.nightDry, 0.5) : 1;
            if (c > _num(G.warmDryAbove, 16)) dry *= 1 + _num(G.warmDry, 0.5);
            if (c <= 0) dry *= _num(G.frozenDry, 0.15);
            if (rr > 0.02) {
                puddles += rr * _num(G.puddleFill, 0.42) * dt;
                damp += rr * _num(G.dampFill, 0.9) * dt;
                if (c > 0) mud += rr * _num(G.mudSoak, 0.22) * dt;
                if (since !== 0) spellPeak = 0;
                spellPeak = Math.max(spellPeak, rr);
                since = 0;
            } else {
                puddles -= _num(G.puddleDry, 0.09) * dry * dt;
                damp -= _num(G.dampDry, 0.14) * dry * dt;
                if (c > 0) mud -= _num(G.mudDry, 0.028) * dry * dt;
                if (since === 0) { lastPeak = spellPeak; spellEnd = Hs; }
                if (since !== Infinity) since += i < L ? 1 : dt;
            }
            puddles = _clamp(puddles, 0, 1);
            damp = _clamp(damp, 0, 1);
            mud = _clamp(mud, 0, 1);
        }
        // Now
        const p = StreetWeather.precipAt(world, q, r, H);
        const celsius = cAt(H);
        const wx = StreetWeather.classify(tile, p, celsius);
        const type = wx.type;
        const rain = wetOf(wx);
        const snow = type === 'snow' ? wx.intensity : type === 'blizzard' ? 1 : 0;
        const cloud = _clamp((p - 0.3) / 0.45, 0, 1);
        const sun = daylight(h0) * (1 - cloud * 0.85);
        const wind = StreetWeather.windAt(world, q, r, d0, h0, type);
        const season = StreetSeasons.seasonOf(d0);
        // ── A rainbow: a good rain just cleared, the sun out ──
        const RB = cfg.rainbow;
        let rainbow = 0;
        if (rain === 0 && snow === 0 && since > 0 && since < _num(RB.hours, 1.6) && lastPeak >= _num(RB.minRain, 0.25)
            && cloud < _num(RB.maxCloud, 0.6) && _inHours(h0, RB.sunHours || [7, 18.5]) && daylight(h0) > 0.5
            && ssHash(q, r, Math.floor(_num(spellEnd, 0)), seed + 53) < _num(RB.chance, 0.7)) {
            const span = _num(RB.hours, 1.6);
            rainbow = _clamp(Math.min(since / 0.2, (span - since) / (span * 0.4), 1), 0, 1);
        }
        // ── Fireflies: a warm, still, dry summer night ──
        const FF = cfg.fireflies;
        let fireflies = 0;
        const ffSeason = (FF.seasons || []).includes(season)
            || (season === 'Spring' && StreetSeasons.dayInSeason(d0) >= _num(FF.lateSpringFrom, 20));
        if (ffSeason && rain === 0 && snow === 0 && _inHours(h0, FF.hours || [21, 3]) && celsius >= _num(FF.minC, 12)
            && wind.strength < _num(FF.maxWind, 0.6)) {
            fireflies = _clamp((0.45 + (celsius - _num(FF.minC, 12)) / 10) * (1 - wind.strength / _num(FF.maxWind, 0.6) * 0.5), 0, 1);
        }
        // ── Mist at dawn over the water and the low ground ──
        const FG = cfg.fog;
        let fog = 0;
        const fh = FG.hours || [4, 9.5];
        if (_inHours(h0, fh) && rain < 0.5 && snow < 0.5) {
            const peak = _num(FG.peak, 6.2);
            const shape = h0 <= peak ? (h0 - _num(fh[0], 4)) / Math.max(0.5, peak - _num(fh[0], 4)) : (_num(fh[1], 9.5) - h0) / Math.max(0.5, _num(fh[1], 9.5) - peak);
            const hum = _clamp((p - 0.3) / 0.3, 0, 1) * 0.7 + damp * 0.5;
            const still = _clamp(1 - wind.strength / _num(FG.maxWind, 0.75), 0, 1);
            const sk = _num((FG.seasons || {})[season], 0.8);
            const chance = ssHash(q, r, d0, seed + 59) < 0.55 + hum * 0.35;
            fog = chance ? _clamp(_smooth(_clamp(shape, 0, 1)) * _clamp(hum, 0, 1) * still * sk, 0, 1) : 0;
        }
        const st = {
            day: d0,
            hour: h0,
            type,
            intensity: wx.intensity,
            rain,
            snow,
            storm: type === 'storm' || type === 'blizzard',
            cloud,
            sun,
            celsius: Math.round(celsius * 10) / 10,
            season,
            wind,
            puddles: Math.round(puddles * 1000) / 1000,
            mud: Math.round(mud * 1000) / 1000,
            damp: Math.round(damp * 1000) / 1000,
            sinceRain: since,
            rainbow,
            fireflies,
            fog,
            raining: rain > 0,
            snowing: snow > 0,
        };
        _memo = { key, w: world, st };
        return st;
    },

    /**
     * × speed of the mud over one kind of ground (world/innerMap/streetSeasons.js _groundKind):
     * 'road' (unpaved) and 'soft' ground take it; mode 'foot' | 'ride' | 'cart'. `mud` 0..1.
     */
    mudPace(mud, ground, mode = 'foot') {
        if (ground !== 'road' && ground !== 'soft') return 1;
        const P = StreetWeather.config().pace;
        const m = _num(mud, 0);
        if (m < _num(P.mudAt, 0.12)) return 1;
        const full = mode === 'cart' ? _num(P.mudCart, 0.58) : mode === 'ride' ? _num(P.mudRide, 0.7) : _num(P.mudFoot, 0.84);
        return 1 - (1 - full) * _clamp(m, 0, 1);
    },
};

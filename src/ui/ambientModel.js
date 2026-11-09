// Ambient life on the inner map — the pure half (no canvas, no DOM).
//
// What gives off smoke, steam, embers and sparks, how much at each hour and
// season, which way the wind blows them, and where each particle is at a given
// moment. The drawing half is ui/innerMapLayers/ambient.js.
//
// Particles keep no state. An emitter has a fixed number of slots; each slot
// cycles on its own period and its particle's age, drift and size are worked
// out from (emitter seed, slot, cycle, clock). So nothing is allocated per
// frame, a redraw never jitters, and when the clock stops (the game paused)
// every puff hangs where it was.
//
// Settings: data/ambient.json (merged into gamedata as `ambient`).

/** Built-in fallbacks; data/ambient.json overrides any of them. */
export const AMBIENT_DEFAULTS = {
    enabled: true,
    maxSlots: 24,
    wind: { calm: [0.15, 0.6], rain: 1.15, storm: 1.9, snow: 0.85, blizzard: 2.1, cloudy: 1, lift: 0.18 },
    weather: { rain: { alpha: 1.25, life: 0.8 }, storm: { alpha: 1.3, life: 0.65 }, snow: { alpha: 1.2, life: 0.9 } },
    kinds: {
        smoke: { color: [96, 92, 88], life: [4, 6.5], rise: 0.75, riseDecay: 0.5, size: [0.16, 0.95], alpha: 0.3, fadeIn: 0.12, drift: 0.55, wobble: 0.1, wobbleHz: 0.3, spread: 0.05 },
    },
    schedules: { allDay: { hours: [[0, 1], [24, 1]] } },
    buildings: {},
    objects: {},
    furniture: {},
    parts: [],
    art: {},
};

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
            ? _merge(base[k], v) : v;
    }
    return out;
}

/** The settings, data over defaults (`src` is gamedata.ambient). */
export function ambientConfig(src) {
    return _merge(AMBIENT_DEFAULTS, src || {});
}

/** A stable 0..1 hash of up to four integers. */
export function hash01(a, b = 0, c = 0, d = 0) {
    let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ (d * 2654435761);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/** Piecewise-linear lookup in [[hour, value], …] (sorted, 0..24). */
export function curveAt(points, hour) {
    if (!points || !points.length) return 1;
    const h = ((hour % 24) + 24) % 24;
    for (let i = 1; i < points.length; i++) {
        const [h1, v1] = points[i];
        if (h <= h1) {
            const [h0, v0] = points[i - 1];
            return h1 === h0 ? v1 : v0 + (v1 - v0) * (h - h0) / (h1 - h0);
        }
    }
    return points[points.length - 1][1];
}

/**
 * How hard a schedule burns at this hour: 0 (out) … ~1.5 (stoked).
 * @param {object} sched  { hours, season?: {winter: k…}, cold?: k, weather?: {rain: k…} }
 * @param {object} ctx    { hour, season ('Winter'…), celsius, weather ('rain'…) }
 */
export function scheduleIntensity(sched, ctx) {
    if (!sched) return 1;
    let v = curveAt(sched.hours, ctx.hour);
    const season = String(ctx.season || '').toLowerCase();
    if (sched.season && sched.season[season] != null) v *= sched.season[season];
    // The colder the day, the more hearths are lit (below 15°C, full effect by -10°C)
    if (sched.cold && Number.isFinite(ctx.celsius)) {
        const c = Math.max(0, Math.min(1, (15 - ctx.celsius) / 25));
        v *= 1 + sched.cold * c;
    }
    if (sched.weather && ctx.weather && sched.weather[ctx.weather] != null) v *= sched.weather[ctx.weather];
    return Math.max(0, Math.min(sched.max != null ? sched.max : 1.5, v));
}

/**
 * Is this one emitter lit, and how strongly (0..1+)? Each building or fire
 * has its own threshold, so as the hour's coverage rises houses light one by
 * one; the edge fades over `soft` of coverage rather than popping.
 */
export function emitterLevel(intensity, share, seed, soft = 0.08) {
    const coverage = Math.min(1, intensity) * (share == null ? 1 : share);
    // (thresholds kept within [soft/2, 1 - soft/2]: none lit at nought, all at full)
    const th = soft / 2 + hash01(seed, 7177) * (1 - soft);
    const on = Math.max(0, Math.min(1, (coverage - th) / soft + 0.5));
    return on * Math.max(intensity, 0.25);
}

/**
 * The wind for a map on a day: a vector in tiles/s (x across the screen, y
 * down it). Calm days take a strength from `wind.calm` by hash; rain, storm
 * and snow multiply it.
 */
export function windFor(worldQ, worldR, day, weatherType, cfgWind) {
    const W = cfgWind || AMBIENT_DEFAULTS.wind;
    const h1 = hash01(worldQ | 0, worldR | 0, day | 0, 11);
    const h2 = hash01(worldQ | 0, worldR | 0, day | 0, 23);
    const [lo, hi] = W.calm || [0.15, 0.6];
    let s = lo + (hi - lo) * h2;
    const t = String(weatherType || '').toLowerCase();
    for (const key of ['blizzard', 'storm', 'rain', 'snow', 'cloudy']) {
        if (t.includes(key) && W[key]) { s *= W[key]; break; }
    }
    // Mostly across the view; a little toward or away from it
    const ang = h1 * Math.PI * 2;
    return { x: Math.cos(ang) * s, y: Math.sin(ang) * s * (W.lift != null ? W.lift : 0.18) };
}

/** Weather multipliers for the particles: { alpha, life } */
export function weatherMods(cfg, weatherType) {
    const t = String(weatherType || '').toLowerCase();
    const W = cfg.weather || {};
    for (const key of Object.keys(W)) if (t.includes(key)) return { alpha: W[key].alpha || 1, life: W[key].life || 1 };
    return { alpha: 1, life: 1 };
}

/** How many slots an emitter of `rate` per second keeps for a kind. */
export function slotCount(kind, rate, maxSlots = 24) {
    const lifeMax = kind.life ? kind.life[1] : 1;
    return Math.max(1, Math.min(maxSlots, Math.ceil(rate * lifeMax)));
}

/**
 * Where slot `slot` of an emitter is at clock `t` — written into `out`
 * ({ alive, x, y, size, alpha, u, h }), offsets in tiles from the emitter,
 * size in tiles. Returns `out`.
 * @param {object} kind   a particle kind from the settings
 * @param {number} seed   the emitter's seed
 * @param {number} slot   0..n-1
 * @param {number} n      the emitter's slot count (slotCount)
 * @param {number} rate   particles per second
 * @param {number} t      the ambient clock, seconds
 * @param {object} wind   { x, y } tiles/s
 * @param {number} lifeK  a weather multiplier on life
 * @param {number} [spread] tiles either side of the source (default: the kind's)
 */
export function particleAt(kind, seed, slot, n, rate, t, wind, lifeK, out, spread = null) {
    const period = n / Math.max(0.001, rate);
    const phase = (slot + hash01(seed, slot, 3) * 0.6) / n;
    const cyc = t / period + phase;
    const c = Math.floor(cyc);
    const h1 = hash01(seed, slot, c, 1), h2 = hash01(seed, slot, c, 2), h3 = hash01(seed, slot, c, 5);
    const life = (kind.life[0] + (kind.life[1] - kind.life[0]) * h1) * (lifeK || 1);
    const age = (cyc - c) * period;
    out.h = h3;
    if (age > life || life <= 0) { out.alive = false; return out; }
    const u = age / life;
    out.alive = true;
    out.u = u;
    const rise = (kind.rise || 0) * (0.8 + h2 * 0.4);
    const decay = kind.riseDecay || 0;
    // (decay > 0: rising slower as it goes, never sinking while decay ≤ 1; decay < 0:
    //  leaving the mouth slowly and gathering speed, so the plume is thick at its source)
    let dy = -rise * (age - decay * age * age / (2 * life));
    // A spark is thrown up and falls back
    if (kind.gravity) dy += 0.5 * kind.gravity * age * age;
    const sway = (kind.wobble || 0) * Math.sin((t * (kind.wobbleHz || 0.3) + h3) * Math.PI * 2) * u;
    const sp = (spread != null ? spread : kind.spread || 0) * (h2 * 2 - 1);
    const fling = (kind.fling || 0) * (h3 * 2 - 1) * age;
    // The wind takes it more the higher it goes
    const d = kind.drift != null ? kind.drift : 0.5;
    const blow = d * age * (0.35 + 0.65 * u);
    out.x = sp + sway + fling + (wind ? wind.x * blow : 0);
    out.y = dy + (wind ? wind.y * blow : 0);
    const [s0, s1] = kind.size || [0.1, 0.5];
    out.size = (s0 + (s1 - s0) * Math.pow(u, 0.7)) * (0.8 + h1 * 0.4);
    const fi = kind.fadeIn || 0.1;
    let a = u < fi ? u / fi : Math.pow(1 - (u - fi) / (1 - fi), kind.fadePow || 1.4);
    if (kind.twinkle) a *= 0.65 + 0.35 * Math.sin(t * kind.twinkle + h2 * 40);
    out.alpha = Math.max(0, a) * (kind.alpha != null ? kind.alpha : 0.3);
    return out;
}

/** A flicker 0.75..1.15 for a fire's glow, smooth, out of step from fire to fire. */
export function flicker(t, seed, speed = 1) {
    const p = hash01(seed, 91) * 10;
    return 0.95 + 0.1 * Math.sin((t * 7.3 + p) * speed) + 0.06 * Math.sin((t * 12.9 + p * 1.7) * speed)
        + 0.04 * Math.sin((t * 23.1 + p * 3.1) * speed);
}

/** Which frame of a looping sprite animation shows at `t` ({ count, fps }). */
export function frameAt(frames, t, seed) {
    if (!frames || !(frames.count > 1)) return 0;
    const f = Math.floor(t * (frames.fps || 8) + hash01(seed, 5) * frames.count);
    return ((f % frames.count) + frames.count) % frames.count;
}

/**
 * The chimney tops of a building def: [{ x, y }] in tiles from the anchor
 * tile's top-left, one per chimney (its top cell's pot). Chimneys are the
 * overlay cells from a sheet matching `sheetRe`, two cells tall: the top one
 * is the upper of each column pair.
 */
export function chimneyTops(def, sheetRe = /Chimney/i, pot = [0.56, 0.58]) {
    const cells = (def && def.layers && def.layers.overlay) || [];
    const byCol = new Map();
    for (const c of cells) {
        if (!c.sheetPath || !sheetRe.test(c.sheetPath)) continue;
        const prev = byCol.get(c.q);
        if (prev == null || c.r < prev) byCol.set(c.q, c.r);
    }
    const out = [];
    for (const [q, r] of byCol) out.push({ x: q + pot[0], y: r + pot[1] });
    return out;
}

/**
 * The building's outline in tiles from its anchor: { minQ, maxQ, minR, maxR,
 * roofR } — roofR the top row of its roof (the highest cell drawn).
 */
export function buildingBox(def) {
    let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const name of ['floor', 'walls', 'roof']) {
        for (const c of (def && def.layers && def.layers[name]) || []) {
            if (c.q < minQ) minQ = c.q;
            if (c.q > maxQ) maxQ = c.q;
            if (c.r < minR) minR = c.r;
            if (c.r > maxR) maxR = c.r;
        }
    }
    if (minQ === Infinity) return null;
    return { minQ, maxQ, minR, maxR, roofR: minR };
}

/**
 * The emitters a building def gives off, by its type (data `buildings`,
 * falling back to `_default`): [{ kind, rate, x, y, spread?, schedule, share }]
 * with x, y in tiles from the anchor's top-left. Chimney emitters stand on
 * each chimney; roof emitters at the middle of its roof; none if a chimney
 * emitter finds no chimney.
 */
export function buildingEmitters(def, cfg, type) {
    const B = cfg.buildings || {};
    const spec = B[type || (def && def.buildingType)] || B._default;
    if (!spec || !def) return [];
    const out = [];
    const sched = spec.schedule || 'allDay';
    const share = spec.share != null ? spec.share : 1;
    if (spec.chimney && spec.chimney.length) {
        let tops = chimneyTops(def);
        // A forge or an oven burns whether the builder drew a chimney or not: its
        // smoke then comes off the roof (`noChimney`: [share of width, tiles below the top])
        if (!tops.length && spec.noChimney) {
            const box = buildingBox(def);
            if (box) tops = [{ x: box.minQ + (box.maxQ + 1 - box.minQ) * spec.noChimney[0], y: box.roofR + spec.noChimney[1] }];
        }
        for (const top of tops) {
            for (const e of spec.chimney) out.push({ kind: e.kind, rate: e.rate || 1, x: top.x, y: top.y, schedule: e.schedule || sched, share: e.share != null ? e.share : share });
        }
    }
    if (spec.roof && spec.roof.length) {
        const box = buildingBox(def);
        if (box) {
            for (const e of spec.roof) {
                const at = e.at || [0.5, 0.6];
                out.push({
                    kind: e.kind, rate: e.rate || 1,
                    x: box.minQ + (box.maxQ + 1 - box.minQ) * at[0], y: box.roofR + at[1],
                    spread: e.spread, schedule: e.schedule || sched, share: e.share != null ? e.share : share,
                });
            }
        }
    }
    return out;
}

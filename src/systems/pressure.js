// ============================================
// PRESSURE — clocks that wind faster the mightier the player grows
// ============================================
// The world's answers to an overmighty House (a league of the realms,
// systems/coalitions.js; a realm marching on a holding, systems/holdingSieges.js;
// a saga brought to its court, systems/sagas.js) should come on a believable
// cadence that follows the player's power, not on a rare roll.
//
//   MIGHT   0–1 from the power score the realms reckon each week
//           (Coalitions.power, cached on player.coalitions.power): 0 at
//           might.floor and below, 1 at might.full and above.
//   CLOCK   a charge on the owning system's own (saved) state. Each check adds
//           days / interval, where the interval runs from slowDays (at the
//           clock's minMight) down to fastDays (at full might). Below minMight
//           the charge drains. When it reaches its threshold (1 ± jitter, by a
//           hash: no RNG drawn) the clock is ripe; the owner acts and spends
//           it, and a cooldown keeps it from firing again too soon.
//   HEAT    each firing warms the clock (shorter intervals next time); heat
//           cools over years and passes half to an heir. Capped, so a long
//           reign escalates without turning to spam.
//
// Pure helper: no RNG stream is touched, nothing global is read — the player,
// world and the clock's holder are passed in. Tuning: data/coalitions.json →
// pressure (laid over DEFAULTS below).

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r3 = (v) => Math.round(v * 1000) / 1000;

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

/** A deterministic unit roll for `key` (no RNG stream is touched). */
function _roll(key) {
    let h = Utils.hashStr(String(key)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return (h % 100000) / 100000;
}

const DEFAULTS = {
    enabled: true, // false: no clock ever ripens and sagas keep their plain schedule
    // 0 for a wanderer with a farm or two; 1 at the coalition's formAt
    might: { floor: 25, full: 140, staleDays: 28 },
    // Escalation (heat): each firing adds 1 (up to max) and the interval is
    // divided by 1 + step × heat; heat cools by decayPerYear (120 days) and an
    // heir inherits heirKeep of it. Memory of a long, mighty reign — but capped,
    // so a century-long game neither burns out nor turns to spam.
    heat: { step: 0.2, max: 3, decayPerYear: 0.1, heirKeep: 0.5, yearDays: 120 },
    clocks: {
        // A league sworn against the House (a game runs for decades: years apart)
        coalition: { minMight: 0.2, slowDays: 1080, fastDays: 360, jitter: 0.25, joinShare: 0.6, primedDays: 28 },
        // A hostile realm marches on one of the player's holdings
        siege: { minMight: 0.1, slowDays: 720, fastDays: 240, jitter: 0.3, cadence: 7, cooldownDays: 240, minHostility: 12, pendingDays: 40 },
        // Sagas: the gap between them, how often a story may return, one more at once, word brought to court
        saga: { gapMult: [1.5, 0.75], repeatMult: [1.25, 0.85], extraActiveAt: 0.6, hookAt: 0.2 },
    },
};

let _cfg = null;
let _cfgSrc;

export const Pressure = {
    DEFAULTS,

    config() {
        const g = DataLoader._gamedata;
        const src = g && _obj(g.coalitions) ? g.coalitions.pressure : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = _merge(DEFAULTS, _obj(src) || {});
        }
        return _cfg;
    },

    clockConfig(id) {
        return _obj(Pressure.config().clocks[id]) || {};
    },

    /** Power score → 0–1. */
    mightOf(score) {
        const M = Pressure.config().might;
        const floor = _num(M.floor, 40);
        const full = Math.max(floor + 1, _num(M.full, 180));
        return _r3(_clamp((_num(score) - floor) / (full - floor), 0, 1));
    },

    /**
     * The player's might as the realms last reckoned it: { might, score, day }.
     * opts.score overrides the reckoning. A reckoning older than staleDays
     * (none taken, an interregnum) counts as no might at all.
     */
    might(player, world, opts = {}) {
        if (opts && Number.isFinite(opts.score)) return { might: Pressure.mightOf(opts.score), score: opts.score, day: _num(world && world.day) };
        const pw = player && _obj(player.coalitions) ? _obj(player.coalitions.power) : null;
        const day = _num(world && world.day);
        if (!pw || !Number.isFinite(pw.score)) return { might: 0, score: 0, day: null };
        if (day - _num(pw.day) > _num(Pressure.config().might.staleDays, 28)) return { might: 0, score: pw.score, day: pw.day };
        return { might: Pressure.mightOf(pw.score), score: pw.score, day: pw.day };
    },

    /** Linear between [weak, strong] by might. */
    lerp(pair, might, fallback = 1) {
        if (Pressure.config().enabled === false) return fallback;
        if (!Array.isArray(pair) || pair.length < 2) return Number.isFinite(pair) ? pair : fallback;
        return _num(pair[0], fallback) + (_num(pair[1], fallback) - _num(pair[0], fallback)) * _clamp(_num(might), 0, 1);
    },

    /** Days between firings at this might (Infinity below the clock's minMight). */
    interval(might, cfg) {
        const min = _num(cfg.minMight, 0);
        if (!(might >= min) || might <= 0) return Infinity;
        const t = min >= 1 ? 1 : _clamp((might - min) / (1 - min), 0, 1);
        const slow = Math.max(1, _num(cfg.slowDays, 600));
        const fast = Math.max(1, Math.min(slow, _num(cfg.fastDays, 150)));
        return slow + (fast - slow) * t;
    },

    /** The clock record on its holder (created on demand; saved with the holder). */
    clock(holder) {
        if (!_obj(holder)) return null;
        if (!_obj(holder.clock)) holder.clock = { charge: 0, fired: 0, lastDay: null, lastFired: null };
        const c = holder.clock;
        c.charge = _num(c.charge);
        c.fired = _num(c.fired);
        return c;
    },

    /** The threshold for the clock's next firing: 1 ± jitter (a hash of seed, id and count). */
    threshold(c, id, cfg, seed = 0) {
        const j = _clamp(_num(cfg.jitter), 0, 0.9);
        return _r3(1 + j * (_roll(`pressure:${id}:${seed}:${c.fired}`) * 2 - 1));
    },

    /**
     * Wind the clock for the days since it last wound, at this might. Returns
     * { ripe, charge, threshold, interval }. The owner acts when ripe and
     * calls spend(); an unspent ripe clock waits (capped at its threshold).
     */
    wind(holder, id, might, day, opts = {}) {
        const c = Pressure.clock(holder);
        if (!c) return { ripe: false, charge: 0, threshold: 1, interval: Infinity };
        const cfg = opts.cfg || Pressure.clockConfig(id);
        const days = c.lastDay == null ? Math.max(1, _num(opts.days, 1)) : Math.max(0, day - c.lastDay);
        c.lastDay = day;
        // Heat: an heir inherits part of it; it cools with the years
        const H = Pressure.config().heat || {};
        if (opts.generation != null) {
            if (c.gen != null && c.gen !== opts.generation) c.heat = _r3(_num(c.heat) * _num(H.heirKeep, 0.5));
            c.gen = opts.generation;
        }
        c.heat = _r3(Math.max(0, _num(c.heat) - days / Math.max(1, _num(H.yearDays, 120)) * _num(H.decayPerYear, 0.1)));
        const iv = Pressure.interval(might, cfg) / (1 + _num(H.step, 0.2) * c.heat);
        const th = Pressure.threshold(c, id, cfg, opts.seed);
        if (opts.paused) return { ripe: false, charge: c.charge, threshold: th, interval: iv };
        if (Number.isFinite(iv)) c.charge = Math.min(th, c.charge + days / iv);
        else c.charge = Math.max(0, c.charge - days / Math.max(1, _num(cfg.slowDays, 600)));
        c.charge = _r3(c.charge);
        c.might = might;
        if (Pressure.config().enabled === false) return { ripe: false, charge: c.charge, threshold: th, interval: iv };
        return { ripe: c.charge >= th, charge: c.charge, threshold: th, interval: iv };
    },

    /** The clock fired: empty it. */
    spend(holder, day) {
        const c = Pressure.clock(holder);
        if (!c) return;
        c.charge = 0;
        c.fired++;
        c.heat = _r3(Math.min(_num(Pressure.config().heat.max, 3), _num(c.heat) + 1));
        c.lastFired = day;
    },

    /** 0–1 share of the way to the next firing (for panels). */
    progress(holder, id, seed = 0) {
        const c = _obj(holder) && _obj(holder.clock);
        if (!c) return 0;
        return _clamp(_num(c.charge) / Math.max(0.01, Pressure.threshold(c, id, Pressure.clockConfig(id), seed)), 0, 1);
    },
};

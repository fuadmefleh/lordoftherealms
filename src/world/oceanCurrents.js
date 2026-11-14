// ============================================
// OCEAN CURRENTS — the set of the sea, hex by hex
// ============================================
// Every sea hex has a current: a way it runs and how hard. The great streams
// follow the latitude bands as on our own world: westward in the warm belt
// either side of the equator, eastward in the middle latitudes, westward
// again near the poles. Within a band each stream wanders (smooth value
// noise of the world's seed), so it swings and slackens from one stretch of
// sea to the next, and dies away across the band's edges, where the streams
// meet. Coastal water runs weaker. Lakes have none.
//
//   at(world, q, r) → { x, y (unit vector, map screen axes: y down), dir
//                      (the nearest hex side, Hex.neighbors order E, NE, NW,
//                      W, SW, SE), strength 0..1, name } or null
//   along(cur, dir)  → how much a move toward hex side `dir` goes with the
//                      current (-1 against … 1 with it), times its strength
//
// Who it moves: a ship at sea on the world map (player/core/movement.js
// — quicker with it, slower against it; carried a hex downstream when it
// lies at sea overnight: ui/game/endDay.js), and a swimmer in the sea on
// the street map (world/innerMap/currents.js). No randomness: the same
// world always has the same currents. Settings: data/currents.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';

const SEA_IDS = new Set(['ocean', 'deep_ocean', 'coast', 'sea']);

// Hex sides as screen vectors (Hex.neighbors order)
const SIDE_VEC = [
    [1, 0], [0.5, -0.866], [-0.5, -0.866], [-1, 0], [-0.5, 0.866], [0.5, 0.866],
];
const SIDE_NAMES = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east'];

const DEFAULTS = {
    enabled: true,
    // Band edges as |latitude| 0 (equator) .. 1 (pole)
    bands: [
        { to: 0.3, angle: 180, name: 'the equatorial current' },
        { to: 0.68, angle: 0, name: 'the westerly drift' },
        { to: 1, angle: 180, name: 'the polar current' },
    ],
    wander: 45,
    scale: 9,
    minStrength: 0.25,
    edgeFade: 0.08,
    coast: 0.6,
    sail: { with: 0.35, against: 0.35, driftPerDay: 0.55 },
    swim: { sea: 0.45, river: 1.05, bankShare: 0.4, skillResist: 0.5 },
};

function _num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

function _valueNoise(seed, scale) {
    const h = (x, y) => {
        let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
        n = Math.imul(n ^ (n >>> 13), 1274126177);
        return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const s = (t) => t * t * (3 - 2 * t);
    return (q, r) => {
        const x = q / scale, y = r / scale;
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = s(x - x0), fy = s(y - y0);
        const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
}

function _seedOf(world) {
    const s = world && world.generationParams && world.generationParams.seed;
    if (Number.isFinite(s)) return s | 0;
    const str = String(s == null ? 'realm' : s);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h | 0;
}

export const OceanCurrents = {
    _cfgSrc: undefined,
    _cfg: null,
    _noise: null,     // { seed, angle, strength }

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.currents;
        if (this._cfgSrc !== src || !this._cfg) {
            this._cfgSrc = src;
            const s = src || {};
            this._cfg = {
                ...DEFAULTS, ...s,
                bands: Array.isArray(s.bands) && s.bands.length ? s.bands : DEFAULTS.bands,
                sail: { ...DEFAULTS.sail, ...(s.sail || {}) },
                swim: { ...DEFAULTS.swim, ...(s.swim || {}) },
            };
            this._noise = null;
        }
        return this._cfg;
    },

    _fields(world) {
        const seed = _seedOf(world);
        const cfg = this.config();
        if (!this._noise || this._noise.seed !== seed) {
            const sc = Math.max(1, _num(cfg.scale, 9));
            this._noise = { seed, angle: _valueNoise(seed ^ 0x51ed, sc), strength: _valueNoise(seed ^ 0x2c1b, sc * 1.3) };
        }
        return this._noise;
    },

    /** The water of a hex a current runs in */
    isSea(tile) {
        return !!(tile && tile.terrain && SEA_IDS.has(tile.terrain.id));
    },

    /** The current of sea hex (q, r), or null (land, a lake, currents off) */
    at(world, q, r) {
        const cfg = this.config();
        if (!cfg.enabled || !world || typeof world.getTile !== 'function') return null;
        const tile = world.getTile(q, r);
        if (!this.isSea(tile)) return null;
        const H = Math.max(2, world.height || 2);
        const lat = Math.abs((r / (H - 1)) * 2 - 1);
        const bands = cfg.bands;
        let i = bands.findIndex(b => lat <= _num(b.to, 1));
        if (i < 0) i = bands.length - 1;
        const band = bands[i];
        const lo = i > 0 ? _num(bands[i - 1].to, 0) : 0;
        const hi = _num(band.to, 1);
        // (slack where two streams meet: the band's inner edge, never the equator or the pole)
        const fade = Math.max(0.001, _num(cfg.edgeFade, 0.08));
        let edge = 1;
        if (i > 0) edge = Math.min(edge, (lat - lo) / fade);
        if (i < bands.length - 1) edge = Math.min(edge, (hi - lat) / fade);
        edge = Math.max(0, Math.min(1, edge));
        const f = this._fields(world);
        const wander = _num(cfg.wander, 45) * (f.angle(q, r) * 2 - 1);
        const ang = (_num(band.angle, 0) + wander) * Math.PI / 180;
        const min = Math.max(0, Math.min(1, _num(cfg.minStrength, 0.25)));
        let strength = (min + (1 - min) * f.strength(q, r)) * edge;
        if (tile.terrain.id === 'coast') strength *= _num(cfg.coast, 0.6);
        // In screen axes (y down): an angle of 90 runs north
        const x = Math.cos(ang), y = -Math.sin(ang);
        let dir = 0, best = -Infinity;
        for (let k = 0; k < 6; k++) {
            const d = SIDE_VEC[k][0] * x + SIDE_VEC[k][1] * y;
            if (d > best) { best = d; dir = k; }
        }
        return { x, y, dir, strength: Math.round(strength * 1000) / 1000, name: band.name || 'the current' };
    },

    /**
     * The current off a hex's shore: its own, if it is sea; else the sea
     * hexes beside it, run together (the water of a coastal hex's street map).
     */
    near(world, q, r) {
        const own = this.at(world, q, r);
        if (own || !world) return own;
        let x = 0, y = 0, s = 0, n = 0, name = null;
        for (const nb of Hex.neighbors(q, r)) {
            const W = world.width;
            const nq = Number.isFinite(W) && W > 0 ? Hex.wrapQ(nb.q, W) : nb.q;
            if (Number.isFinite(world.height) && (nb.r < 0 || nb.r >= world.height)) continue;
            const c = this.at(world, nq, nb.r);
            if (!c) continue;
            x += c.x * c.strength; y += c.y * c.strength; s += c.strength; n++;
            name = name || c.name;
        }
        const l = Math.hypot(x, y);
        if (!n || l < 1e-6) return null;
        x /= l; y /= l;
        let dir = 0, best = -Infinity;
        for (let k = 0; k < 6; k++) {
            const d = SIDE_VEC[k][0] * x + SIDE_VEC[k][1] * y;
            if (d > best) { best = d; dir = k; }
        }
        return { x, y, dir, strength: Math.round((s / n) * 1000) / 1000, name };
    },

    /** How far a move toward hex side `dir` runs with the current: -strength (against) .. strength (with) */
    along(cur, dir) {
        if (!cur || !Number.isInteger(dir) || dir < 0 || dir > 5) return 0;
        const v = SIDE_VEC[dir];
        return (v[0] * cur.x + v[1] * cur.y) * cur.strength;
    },

    /** The sailing cost of a hex entered toward side `dir`, times this (with the current < 1 < against it) */
    sailFactor(world, q, r, dir) {
        const cur = this.at(world, q, r);
        if (!cur) return 1;
        const a = this.along(cur, dir);
        const s = this.config().sail;
        return a >= 0 ? 1 - a * _num(s.with, 0.35) : 1 - a * _num(s.against, 0.35);
    },

    /** A current in words: 'the westerly drift, running east, strong' ('' for none) */
    describe(cur) {
        if (!cur) return '';
        const s = cur.strength || 0;
        const how = s < 0.2 ? 'slack' : s < 0.4 ? 'gentle' : s < 0.65 ? 'steady' : 'strong';
        return `${cur.name || 'the current'}, running ${this.sideName(cur.dir)}, ${how}`;
    },

    /** A hex side's name ('east', 'south-west', …) */
    sideName(dir) {
        return SIDE_NAMES[dir] || 'away';
    },

    /** The side of (fromQ, fromR) that (toQ, toR) lies on, or -1 (not neighbours) */
    sideTo(neighbors, toQ, toR, width) {
        for (let k = 0; k < 6; k++) {
            const n = neighbors[k];
            const q = Number.isFinite(width) && width > 0 ? ((n.q % width) + width) % width : n.q;
            if (q === toQ && n.r === toR) return k;
        }
        return -1;
    },
};

// ============================================
// SEA WINDS — the wind over the sea, and the storms that cross it
// ============================================
// The prevailing winds by latitude, as the world generator laid the rain
// with them (Terrain._climate12): trade winds blowing west and toward the
// equator in the warm belt, westerlies blowing east and poleward in the
// middle latitudes, polar easterlies beyond; calm doldrums at the equator
// and slack horse latitudes where trades meet westerlies. The belts follow
// the sun north in the northern summer and south in the southern, and the
// trades and westerlies blow hardest in their hemisphere's winter (the
// seasonal trade winds). Day by day the wind veers and freshens about the
// prevailing one (smooth noise of the seed, the hex and the day).
//
//   SeaWinds.prevailing(world, q, r, day) → the season's wind, no day's whim
//   SeaWinds.at(world, q, r, day)         → today's wind (a storm's swirl near one)
//        { x, y (unit vector it blows TOWARD, screen axes, y down), angle
//          (degrees toward, 0 east 90 north), dir (hex side toward), strength
//          0..1, band, name }
//   SeaWinds.pointOfSail(wind, dir, rig)  → { factor, angle, point }: a ship
//          heading toward hex side `dir` makes way × factor (beam reach best,
//          dead upwind slow — tacking — light airs drifting)
//   SeaWinds.describe(wind)               → 'a fresh westerly'
//
//   SeaStorms.active(world, day)          → the storms at sea that day:
//          { id, name, kind, q, r, radius, intensity, heading, born, dies }
//   SeaStorms.dangerAt(world, q, r, day)  → { type, danger, storm } or null
//   SeaStorms.near(world, q, r, day, d)   → storms within d hexes, nearest first
//
// Storms are born on the open sea in their belts and seasons and carried by
// the prevailing wind over days (hurricanes recurving poleward), growing and
// dying, weakening over land — all from hashes of the world seed and the day,
// so no RNG is drawn and the same world always has the same weather at sea.
// Settings: data/seaWinds.json (winds, sailing, storms).

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { OceanCurrents } from './oceanCurrents.js';

const SIDE_VEC = [
    [1, 0], [0.5, -0.866], [-0.5, -0.866], [-1, 0], [-0.5, 0.866], [0.5, 0.866],
];
const COMPASS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
const COMPASS_ADJ = ['easterly', 'north-easterly', 'northerly', 'north-westerly', 'westerly', 'south-westerly', 'southerly', 'south-easterly'];
const YEAR = 120;

const DEFAULTS = {
    winds: {
        enabled: true, seasonShift: 0.07, doldrums: 0.05, edgeFade: 0.06, scale: 11, days: 2.5,
        bands: [
            { id: 'trades', to: 0.3, angleN: 200, angleS: 160, strength: 0.7, wander: 25, strengthLo: 0.7, strengthHi: 1.15, winterBoost: 0.25, name: 'the trade wind' },
            { id: 'westerlies', to: 0.66, angleN: 20, angleS: 340, strength: 0.72, wander: 70, strengthLo: 0.4, strengthHi: 1.3, winterBoost: 0.3, name: 'the westerlies' },
            { id: 'polar', to: 1, angleN: 200, angleS: 160, strength: 0.55, wander: 45, strengthLo: 0.5, strengthHi: 1.2, winterBoost: 0.15, name: 'the polar easterlies' },
        ],
        doldrumsStrength: 0.18, doldrumsWander: 180,
    },
    sailing: {
        calm: 0.4, fullAt: 0.5, fjordWind: 0.7,
        points: {
            square: [[0, 1.0], [45, 1.12], [90, 1.15], [120, 0.85], [150, 0.5], [180, 0.35]],
            fore: [[0, 0.92], [45, 1.1], [90, 1.3], [120, 1.15], [150, 0.75], [180, 0.5]],
            oars: [[0, 1], [180, 1]],
        },
        defaultRig: { rig: 'square', oars: 0, draft: 1 },
        rigs: {},
    },
    storms: {
        enabled: true, perArea: 3200, tries: 5, maxLife: 9,
        belts: [
            { kind: 'hurricane', from: 0.08, to: 0.3, chance: 0.09, peakDay: 60, offSeason: 0.15, life: [4, 8], radius: [2, 4], intensity: [0.9, 1.5], speed: [1, 2.2], recurve: 0.18, label: 'hurricane' },
            { kind: 'gale', from: 0.36, to: 0.72, chance: 0.12, peakDay: 105, offSeason: 0.25, life: [3, 6], radius: [2, 3], intensity: [0.7, 1.15], speed: [1.5, 3], recurve: 0, label: 'gale' },
        ],
        landDecay: 0.45, dieBelow: 0.3, sightRadius: 7,
        names: ['the Grey Widow', 'the Black Mare', 'the Salt Hag', 'the Long Howl'],
    },
};

const _num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function _hash(a, b, c, d) {
    let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041) + Math.imul(d | 0, 2246822519)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n = Math.imul(n ^ (n >>> 16), 2654435761);
    return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

const _s = (t) => t * t * (3 - 2 * t);

/** Smooth value noise over (x, y, t), seeded. */
function _noise3(seed, x, y, t) {
    const x0 = Math.floor(x), y0 = Math.floor(y), t0 = Math.floor(t);
    const fx = _s(x - x0), fy = _s(y - y0), ft = _s(t - t0);
    const layer = (tt) => {
        const a = _hash(seed, x0, y0, tt), b = _hash(seed, x0 + 1, y0, tt);
        const c = _hash(seed, x0, y0 + 1, tt), d = _hash(seed, x0 + 1, y0 + 1, tt);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
    const l0 = layer(t0), l1 = layer(t0 + 1);
    return l0 + (l1 - l0) * ft;
}

function _seedOf(world) {
    const s = world && world.generationParams && world.generationParams.seed;
    if (Number.isFinite(s)) return s | 0;
    const str = String(s == null ? 'realm' : s);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h | 0;
}

/** Day of the year 1..120 */
function _doy(day) {
    const d = Math.floor(_num(day, 1));
    return ((((d - 1) % YEAR) + YEAR) % YEAR) + 1;
}

/** The sun's swing: +1 furthest north (day 45, northern midsummer), -1 furthest south (day 105) */
function _decl(day) {
    return Math.sin(2 * Math.PI * (_doy(day) - 15) / YEAR);
}

/** Signed latitude: +1 the north pole (row 0), -1 the south */
function _lat(world, r) {
    const H = Math.max(2, _num(world && world.height, 2));
    return 1 - 2 * (r / (H - 1));
}

function _vec(angleDeg) {
    const a = angleDeg * Math.PI / 180;
    return { x: Math.cos(a), y: -Math.sin(a) };
}

function _side(x, y) {
    let dir = 0, best = -Infinity;
    for (let k = 0; k < 6; k++) {
        const d = SIDE_VEC[k][0] * x + SIDE_VEC[k][1] * y;
        if (d > best) { best = d; dir = k; }
    }
    return dir;
}

function _wind(x, y, strength, band, name) {
    const l = Math.hypot(x, y) || 1;
    x /= l; y /= l;
    let angle = Math.atan2(-y, x) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    return { x, y, angle: Math.round(angle * 10) / 10, dir: _side(x, y), strength: Math.round(_clamp(strength, 0, 1) * 1000) / 1000, band, name };
}

let _src;
let _cfg = null;

export const SeaWinds = {
    SIDE_VEC,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.seaWinds;
        if (_cfg && _src === src) return _cfg;
        _src = src;
        const s = _obj(src);
        const w = _obj(s.winds), sl = _obj(s.sailing), st = _obj(s.storms);
        _cfg = {
            ...s,
            winds: { ...DEFAULTS.winds, ...w, bands: Array.isArray(w.bands) && w.bands.length ? w.bands : DEFAULTS.winds.bands },
            sailing: {
                ...DEFAULTS.sailing, ...sl,
                points: { ...DEFAULTS.sailing.points, ..._obj(sl.points) },
                defaultRig: { ...DEFAULTS.sailing.defaultRig, ..._obj(sl.defaultRig) },
                rigs: { ...DEFAULTS.sailing.rigs, ..._obj(sl.rigs) },
            },
            storms: { ...DEFAULTS.storms, ...st, belts: Array.isArray(st.belts) && st.belts.length ? st.belts : DEFAULTS.storms.belts, names: Array.isArray(st.names) && st.names.length ? st.names : DEFAULTS.storms.names },
        };
        SeaStorms._cache = new WeakMap();
        return _cfg;
    },

    /**
     * Does the wind move ships in this world? Generated worlds (their
     * generationParams) — a hand-made world only with world.seaWinds true,
     * so test worlds keep their plain hex counts.
     */
    active(world) {
        if (!world || !this.config().winds.enabled) return false;
        if (world.seaWinds === false) return false;
        return world.seaWinds === true || !!world.generationParams;
    },

    /** Day of the year (1..120) and the sun's swing (+1 north .. -1 south) */
    season(day) {
        return { doy: _doy(day), decl: _decl(day) };
    },

    /** The wind belt over row r on a day: { band (config), lat (signed, sun-shifted), edge 0..1, doldrums } */
    _belt(world, r, day) {
        const W = this.config().winds;
        const lat = _lat(world, r) - _num(W.seasonShift, 0.07) * _decl(day);
        const a = Math.abs(lat);
        const bands = W.bands;
        let i = bands.findIndex(b => a <= _num(b.to, 1));
        if (i < 0) i = bands.length - 1;
        const lo = i > 0 ? _num(bands[i - 1].to, 0) : 0;
        const hi = _num(bands[i].to, 1);
        const fade = Math.max(0.001, _num(W.edgeFade, 0.06));
        let edge = 1;
        if (i > 0) edge = Math.min(edge, (a - lo) / fade);
        if (i < bands.length - 1) edge = Math.min(edge, (hi - a) / fade);
        return { band: bands[i], lat, edge: _clamp(edge, 0, 1), doldrums: a < _num(W.doldrums, 0.05) };
    },

    /** The season's prevailing wind at (q, r) — the belt's, no day's whim. */
    prevailing(world, q, r, day = null) {
        const d = day == null ? _num(world && world.day, 1) : day;
        const W = this.config().winds;
        const b = this._belt(world, r, d);
        const north = b.lat >= 0;
        const ang = north ? _num(b.band.angleN, 0) : _num(b.band.angleS, 0);
        const v = _vec(ang);
        // (its hemisphere's winter: the sun on the other side)
        const winter = Math.max(0, north ? -_decl(d) : _decl(d));
        let strength = _num(b.band.strength, 0.6) * (1 + _num(b.band.winterBoost, 0) * winter);
        // slack where two belts meet (the horse latitudes), all but still in the doldrums
        strength *= 0.25 + 0.75 * b.edge;
        if (b.doldrums) strength = Math.min(strength, _num(W.doldrumsStrength, 0.18));
        return _wind(v.x, v.y, strength, b.doldrums ? 'doldrums' : b.band.id, b.doldrums ? 'the doldrums' : b.band.name);
    },

    /** Today's wind at (q, r): the prevailing wind veered and freshened by the day, swirled near a storm. */
    at(world, q, r, day = null) {
        const d = day == null ? _num(world && world.day, 1) : day;
        const W = this.config().winds;
        const b = this._belt(world, r, d);
        const base = this.prevailing(world, q, r, d);
        const seed = _seedOf(world);
        const sc = Math.max(1, _num(W.scale, 11));
        const t = d / Math.max(0.5, _num(W.days, 2.5));
        const wander = b.doldrums ? _num(W.doldrumsWander, 180) : _num(b.band.wander, 40);
        const veer = (_noise3(seed ^ 0x77a1, q / sc, r / sc, t) * 2 - 1) * wander;
        const lo = _num(b.band.strengthLo, 0.6), hi = _num(b.band.strengthHi, 1.2);
        const gust = lo + (hi - lo) * _noise3(seed ^ 0x3b9d, q / sc + 17, r / sc - 5, t * 1.3);
        const ang = base.angle + veer;
        const v = _vec(ang);
        let wind = _wind(v.x, v.y, base.strength * gust, base.band, base.name);
        const st = SeaStorms.windAt(world, q, r, d);
        if (st) {
            const k = st.weight;
            wind = _wind(wind.x * (1 - k) + st.x * k, wind.y * (1 - k) + st.y * k, Math.max(wind.strength, st.strength), 'storm', st.name);
        }
        return wind;
    },

    /** A ship's rig by her type: { rig, oars, draft } */
    rigOf(ship) {
        const S = this.config().sailing;
        const t = ship && (ship.typeId || ship.type);
        return { ...S.defaultRig, ..._obj(t != null ? S.rigs[t] : null) };
    },

    /**
     * The point of sail of a ship heading toward hex side `dir` in `wind`:
     * { factor (× her way), angle (0 running .. 180 dead upwind), point }.
     * `rig` from rigOf (default square-rigged, no oars).
     */
    pointOfSail(wind, dir, rig = null) {
        const S = this.config().sailing;
        const R = rig || S.defaultRig;
        if (!wind || !Number.isInteger(dir) || dir < 0 || dir > 5) return { factor: 1, angle: 90, point: 'beam' };
        const v = SIDE_VEC[dir];
        const dot = _clamp(v[0] * wind.x + v[1] * wind.y, -1, 1);
        const angle = Math.acos(dot) * 180 / Math.PI;
        const pts = S.points[R.rig] || S.points.square;
        let f = pts[pts.length - 1][1];
        for (let i = 1; i < pts.length; i++) {
            if (angle <= pts[i][0]) {
                const [a0, f0] = pts[i - 1], [a1, f1] = pts[i];
                f = f0 + (f1 - f0) * ((angle - a0) / Math.max(1e-6, a1 - a0));
                break;
            }
        }
        // light airs: every point drifts toward the calm
        const calm = _num(S.calm, 0.4);
        const felt = _clamp(_num(wind.strength, 0) / Math.max(0.01, _num(S.fullAt, 0.5)), 0, 1);
        f = calm + (f - calm) * felt;
        const oars = _clamp(_num(R.oars, 0), 0, 1);
        f = f * (1 - oars) + 1 * oars;
        const point = angle < 30 ? 'running' : angle < 70 ? 'broad' : angle < 110 ? 'beam' : angle < 145 ? 'close' : 'tacking';
        return { factor: Math.round(f * 1000) / 1000, angle: Math.round(angle), point };
    },

    /** A point of sail in words */
    pointName(point) {
        return {
            running: 'running before the wind', broad: 'on a broad reach', beam: 'on a beam reach',
            close: 'close-hauled', tacking: 'beating to windward, tacking',
        }[point] || 'under sail';
    },

    /** Where the wind comes from, as a compass word: 'west' */
    fromName(wind) {
        if (!wind) return '';
        const from = (wind.angle + 180) % 360;
        return COMPASS[Math.round(from / 45) % 8];
    },

    /** How hard, in words */
    strengthName(s) {
        s = _num(s, 0);
        return s < 0.12 ? 'calm' : s < 0.3 ? 'light airs' : s < 0.5 ? 'a moderate breeze' : s < 0.7 ? 'a fresh breeze' : s < 0.88 ? 'a strong wind' : 'a gale';
    },

    /** 'a fresh westerly' / 'calm' */
    describe(wind) {
        if (!wind) return '';
        const s = wind.strength;
        if (s < 0.12) return wind.band === 'doldrums' ? 'flat calm (the doldrums)' : 'calm';
        const from = (wind.angle + 180) % 360;
        const adj = COMPASS_ADJ[Math.round(from / 45) % 8];
        const how = s < 0.3 ? 'light' : s < 0.5 ? 'moderate' : s < 0.7 ? 'fresh' : s < 0.88 ? 'strong' : 'gale-force';
        return `a ${how} ${adj}${wind.band === 'storm' ? ` (${wind.name})` : ''}`;
    },
};

// ── Storms ───────────────────────────────────────────────

function _range(v, h) {
    if (Array.isArray(v)) return _num(v[0], 0) + (_num(v[1], v[0]) - _num(v[0], 0)) * h;
    return _num(v, 0);
}

export const SeaStorms = {
    _cache: new WeakMap(),   // world → { seed, w, h, days: Map day → storms }

    config() {
        return SeaWinds.config().storms;
    },

    _isOpenSea(tile) {
        return !!(tile && tile.terrain && (tile.terrain.id === 'ocean' || tile.terrain.id === 'deep_ocean') && tile.waterBodyType !== 'lake');
    },

    _slots(world) {
        const C = this.config();
        return Math.max(1, Math.round((_num(world.width, 1) * _num(world.height, 1)) / Math.max(200, _num(C.perArea, 3200))));
    },

    /** Was a storm born on day `born` in slot `slot`? Its seed record, or null. */
    _birth(world, born, slot) {
        const C = this.config();
        const seed = _seedOf(world);
        const W = _num(world.width, 0), H = _num(world.height, 0);
        if (!(W > 0 && H > 2)) return null;
        const doy = _doy(born);
        for (let tr = 0; tr < Math.max(1, _num(C.tries, 5)); tr++) {
            const hq = _hash(seed ^ 0x5707, born, slot, tr * 3 + 1);
            const hr = _hash(seed ^ 0x5707, born, slot, tr * 3 + 2);
            const q = Math.floor(hq * W), r = Math.floor(hr * H);
            const lat = _lat(world, r);
            const a = Math.abs(lat);
            const belt = C.belts.find(b => a >= _num(b.from, 0) && a <= _num(b.to, 1));
            if (!belt) continue;
            if (!this._isOpenSea(world.getTile(q, r))) continue;
            // its season, in its own hemisphere (the south's year runs half a year off)
            const peak = _num(belt.peakDay, 60) + (lat < 0 ? YEAR / 2 : 0);
            const season = Math.max(0, Math.cos(2 * Math.PI * (doy - peak) / YEAR));
            const weight = _num(belt.offSeason, 0.2) + (1 - _num(belt.offSeason, 0.2)) * season;
            const roll = _hash(seed ^ 0x5707, born, slot, tr * 3 + 3);
            if (roll >= _num(belt.chance, 0.1) * weight) return null;
            const h = (k) => _hash(seed ^ 0x9e37, born, slot, 100 + k);
            const names = C.names || [];
            return {
                id: `st${born}_${slot}`, born, slot, belt, kind: belt.kind || 'gale', label: belt.label || belt.kind || 'storm',
                q, r, south: lat < 0,
                life: Math.max(2, Math.round(_range(belt.life, h(1)))),
                radius: Math.max(1, Math.round(_range(belt.radius, h(2)))),
                peak: _range(belt.intensity, h(3)),
                speed: _range(belt.speed, h(4)),
                name: names.length ? names[Math.floor(h(5) * names.length) % names.length] : 'the storm',
            };
        }
        return null;
    },

    /** Follow a storm from its birth to `day`: its state that day, or null (spent, not yet born, gone ashore). */
    _track(world, b, day) {
        const C = this.config();
        const age = day - b.born;
        if (age < 0 || age >= b.life) return null;
        const W = world.width, H = world.height;
        let x = b.q, y = b.r, strength = 1;
        let hx = 0, hy = 0;
        for (let i = 0; i <= age; i++) {
            const qi = Hex.wrapQ(Math.round(x), W), ri = _clamp(Math.round(y), 0, H - 1);
            if (i > 0 && !this._isOpenSea(world.getTile(qi, ri))) {
                const t = world.getTile(qi, ri);
                // (over the shallows a storm keeps most of itself; over land it dies away)
                if (!(t && OceanCurrents.isSea(t))) strength *= _num(C.landDecay, 0.45);
            }
            if (i === age) break;
            // carried by the season's wind at its eye, turning poleward as it ages (a hurricane's recurve)
            const pw = SeaWinds.prevailing(world, qi, ri, b.born + i);
            const pole = b.south ? 1 : -1;     // screen y: north is up (−)
            const turn = _num(b.belt.recurve, 0) * i;
            // (poleward, then swung east as it leaves the trades)
            hx = pw.x + turn * 1.2;
            hy = pw.y + pole * turn;
            const l = Math.hypot(hx, hy) || 1;
            hx /= l; hy /= l;
            x += hx * b.speed;
            y += hy * b.speed * 1.15;
            if (y < 0 || y > H - 1) return null;
        }
        // grows the first day, blows at its height, blows itself out the last days
        const t = (age + 0.5) / b.life;
        const shape = t < 0.25 ? 0.55 + 1.8 * t : t > 0.7 ? Math.max(0, 1 - (t - 0.7) * 2.2) : 1;
        const intensity = b.peak * shape * strength;
        if (intensity < _num(C.dieBelow, 0.3)) return null;
        const q = Hex.wrapQ(Math.round(x), W), r = _clamp(Math.round(y), 0, H - 1);
        return {
            id: b.id, name: b.name, kind: b.kind, label: b.label, q, r,
            radius: b.radius, intensity: Math.round(intensity * 100) / 100,
            heading: { x: hx, y: hy, dir: _side(hx, hy) }, speed: b.speed,
            born: b.born, dies: b.born + b.life - 1, age, south: b.south,
        };
    },

    /** The storms at sea on `day` (cached per world and day). */
    active(world, day = null) {
        const C = this.config();
        if (!world || !C.enabled || !SeaWinds.active(world) || typeof world.getTile !== 'function') return [];
        const d = Math.floor(day == null ? _num(world.day, 1) : day);
        let c = this._cache.get(world);
        const seed = _seedOf(world);
        if (!c || c.seed !== seed || c.w !== world.width || c.h !== world.height) {
            c = { seed, w: world.width, h: world.height, days: new Map() };
            this._cache.set(world, c);
        }
        if (c.days.has(d)) return c.days.get(d);
        const out = [];
        const slots = this._slots(world);
        const maxLife = Math.max(1, _num(C.maxLife, 9));
        for (let born = d - maxLife + 1; born <= d; born++) {
            for (let s = 0; s < slots; s++) {
                const b = this._birth(world, born, s);
                if (!b) continue;
                const st = this._track(world, b, d);
                if (st) out.push(st);
            }
        }
        if (c.days.size > 12) c.days.clear();
        c.days.set(d, out);
        return out;
    },

    _dist(world, a, b) {
        return Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, world.width);
    },

    /** A storm at (q, r) on `day`: { type: 'hurricane' | 'gale', danger, storm } — the worst there — or null. */
    dangerAt(world, q, r, day = null) {
        let worst = null;
        for (const st of this.active(world, day)) {
            const dd = this._dist(world, st, { q, r });
            if (dd > st.radius) continue;
            const danger = st.intensity * (1 - 0.55 * dd / (st.radius + 0.5));
            if (!worst || danger > worst.danger) {
                worst = { type: st.kind === 'hurricane' && danger >= 1 ? 'hurricane' : 'gale', danger: Math.round(danger * 100) / 100, storm: st };
            }
        }
        return worst;
    },

    /** Storms within `reach` hexes of (q, r), nearest first: [{ storm, distance }] */
    near(world, q, r, day = null, reach = null) {
        const R = reach == null ? _num(this.config().sightRadius, 7) : reach;
        return this.active(world, day)
            .map(st => ({ storm: st, distance: this._dist(world, st, { q, r }) }))
            .filter(e => e.distance <= R + e.storm.radius)
            .sort((a, b) => a.distance - b.distance);
    },

    /** The swirl of a storm's wind at (q, r): { x, y, strength, weight, name } or null (none near). */
    windAt(world, q, r, day) {
        const list = this.active(world, day);
        if (!list.length) return null;
        let best = null;
        for (const st of list) {
            const dd = this._dist(world, st, { q, r });
            if (dd > st.radius + 2) continue;
            const weight = _clamp(1 - (dd - st.radius) / 2.5, 0, 1);
            if (best && best.weight >= weight) continue;
            // round the eye: anticlockwise in the north, clockwise in the south (screen y down)
            let dx = q - st.q, dy = (r - st.r) * 0.866;
            if (Math.abs(dx) > world.width / 2) dx -= Math.sign(dx) * world.width;
            const l = Math.hypot(dx, dy) || 1;
            const s = st.south ? -1 : 1;
            best = { x: (dy / l) * s, y: (-dx / l) * s, strength: _clamp(0.75 + 0.25 * st.intensity, 0, 1), weight: dd === 0 ? 1 : weight, name: st.name };
        }
        return best;
    },

    /** A storm in words: 'the Grey Widow, a hurricane, two days off to the south-west' */
    describe(world, st, from = null) {
        if (!st) return '';
        let where = '';
        if (from) {
            let dx = st.q - from.q;
            if (world && Math.abs(dx) > world.width / 2) dx -= Math.sign(dx) * world.width;
            const dy = st.r - from.r;
            const ang = (Math.atan2(-dy * 0.866, dx) * 180 / Math.PI + 360) % 360;
            const d = this._dist(world, st, from);
            where = d <= st.radius ? ', upon you' : `, ${d} leagues to the ${COMPASS[Math.round(ang / 45) % 8]}`;
        }
        const moving = st.heading ? `, moving ${COMPASS[Math.round(((Math.atan2(-st.heading.y, st.heading.x) * 180 / Math.PI) + 360) % 360 / 45) % 8]}` : '';
        return `${st.name}, a ${st.label}${where}${moving}`;
    },
};

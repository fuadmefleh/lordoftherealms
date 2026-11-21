// InnerMapRenderer — the weather you see on the street map (mixed in via Object.assign).
//
// Reads the hour's street weather (InnerMap._sw: world/streetWeather.js, bound
// by ui/innerMapWeather.js) and draws it in three passes:
//
//   • _renderWeatherGround (over the ground, under every sprite: after the
//     season's footprints) — the ground darkened while it is wet, the fresh mud
//     on the unpaved roads and soft ground glossy and dark, puddles that fill in
//     the rain on the roads and the low ground and dry after it (iced over in a
//     frost), rain rings in them, splashes on the ground and rings on the water.
//   • _renderWeatherLow (after the smoke and the leaves, under the fog of war and
//     the night's dark) — mist lying over the water and the low ground at dawn.
//   • _renderWeatherFx (layer 10, over the lighting; innerMapUI.js hands its old
//     _renderWeatherParticles to it) — rain streaks (light to heavy, slanted by the
//     wind and its gusts), snowflakes (a blizzard driven sideways), the storm's
//     lightning (a flash, now and then the bolt itself; ui/innerMapWeather.js
//     strikes it and sends the thunder after), a rainbow after the rain when the
//     sun comes out (on the side of the sky away from the sun), fireflies over
//     the meadows and the water on warm summer nights, drips off the player
//     when wet through.
//
// Cosmetic only: its own random stream (never the game's seeded RNG). The
// cells it uses (where puddles lie, the mud shines, mist gathers, fireflies
// dance) are worked out once per map; drops, flakes and fireflies are fields
// of fixed seeds and splashes a fixed ring — a frame allocates nothing.
// Settings: data/streetWeather.json `fx`.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { StreetWeather } from '../../world/streetWeather.js';

const MAX_DROPS = 400;
const MAX_FLAKES = 360;
const MAX_SPLASH = 120;
const SPLASH_LIFE = 0.28;
const RING_LIFE = 0.9;

function _mulberry(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const _rand = _mulberry(0x5eed1234);

/** Integer hash → 0..1. */
function hh(q, r, k) {
    let h = (Math.imul(q | 0, 374761393) + Math.imul(r | 0, 668265263) + Math.imul(k | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _frac = x => x - Math.floor(x);

// The drop and flake fields: fixed seeds (x, y, speed, length), made once
const _dropSeed = new Float32Array(MAX_DROPS * 4);
const _flakeSeed = new Float32Array(MAX_FLAKES * 4);
for (let i = 0; i < MAX_DROPS * 4; i++) _dropSeed[i] = _rand();
for (let i = 0; i < MAX_FLAKES * 4; i++) _flakeSeed[i] = _rand();
// Splashes and rings: a ring of [x, y, born, kind] (kind 0 a splash on the ground, 1 a ring on the water)
const _spl = new Float32Array(MAX_SPLASH * 4);
let _splN = 0;
let _splAcc = 0;
// The bolt's path: up to 14 points, laid at each strike
const _bolt = new Float32Array(28);
let _boltN = 0;

// Alpha steps for fading things (no string made a frame)
const STEPS = 8;
const RING_COL = Array.from({ length: STEPS + 1 }, (_, i) => `rgba(215, 232, 245, ${(0.75 * i / STEPS).toFixed(3)})`);
const SPLASH_COL = Array.from({ length: STEPS + 1 }, (_, i) => `rgba(205, 222, 240, ${(0.8 * i / STEPS).toFixed(3)})`);
/** A ramp of one colour at 0..1 alpha in 50 steps, made once: ramp(a) → the string. */
function _ramp(rgb) {
    const list = Array.from({ length: 51 }, (_, i) => `rgba(${rgb}, ${(i / 50).toFixed(3)})`);
    return a => list[Math.max(0, Math.min(50, Math.round(a * 50)))];
}
const WET = _ramp('14, 20, 32');
const MUD = _ramp('52, 36, 22');
const HAZE = _ramp('214, 220, 228');
const FLASH = _ramp('235, 240, 255');
const BLIZ = 'rgba(225, 232, 242, 0.14)';

const _isBuildingCell = t => !!(t && (t.building || t.buildingInfo || t.customBuilding || t.customBuildingPart));
const _isOpenWater = t => !!(t && (t._wet || t._sea) && !t._deck && !t._pier && !t._bridge && !t._iced
    && !(t.subTerrain && /frozen|ice/.test(t.subTerrain.id || '')));

function _canvas(w, h) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

/** A soft round glow, drawn once (fireflies, mist). */
function _glow(size, stops) {
    const c = _canvas(size, size);
    if (!c) return null;
    const g = c.getContext('2d');
    if (!g || typeof g.createRadialGradient !== 'function') return null;
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [at, col] of stops) gr.addColorStop(at, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
}

/** A list of cells by row: { q, r (Int16Array), k (Float32Array per cell), row offsets }. */
function _byRows(cells, H) {
    const n = cells.length / 3;
    const q = new Int16Array(n), r = new Int16Array(n), k = new Float32Array(n), start = new Int32Array(H + 2);
    for (let i = 0; i < n; i++) { q[i] = cells[i * 3]; r[i] = cells[i * 3 + 1]; k[i] = cells[i * 3 + 2]; }
    let j = 0;
    for (let row = 0; row <= H + 1; row++) {
        while (j < n && r[j] < row) j++;
        start[row] = j;
    }
    return { q, r, k, start, n };
}

Object.assign(InnerMapRenderer, {
    _wxCache: null,
    _wxFlashT: -99,      // the lightning's last flash (ambient clock)
    _wxBoltT: -99,       // ...and when its bolt was seen
    _wxPlayerWet: 0,     // 0..100 (ui/innerMapWeather.js)
    _wxRainbowC: null,

    _wxFx() {
        return StreetWeather.config().fx || {};
    },

    /**
     * The cells of this map the weather plays on, worked out once (cached on the tiles array):
     * puddle hollows (roads, paving, soft and low ground), the shining mud (unpaved roads, soft
     * ground), mist (water and the damp low ground), fireflies (meadows near the water).
     */
    _wxCells() {
        const tiles = InnerMap.tiles;
        if (!tiles || !tiles.length) return null;
        const c = this._wxCache;
        if (c && c.tiles === tiles) return c;
        const fx = this._wxFx();
        const H = tiles.length, W = tiles[0].length;
        const maxP = Math.max(0, _num(fx.puddleCells, 420)), maxG = Math.max(0, _num(fx.glossCells, 900));
        const puddles = [], gloss = [], mist = [], flies = [];
        const at = (q, r) => (r >= 0 && r < H && q >= 0 && q < W ? tiles[r][q] : null);
        const nearWater = (q, r) => _isOpenWater(at(q + 2, r)) || _isOpenWater(at(q - 2, r)) || _isOpenWater(at(q, r + 2)) || _isOpenWater(at(q, r - 2));
        for (let r = 0; r < H; r++) {
            const row = tiles[r];
            for (let q = 0; q < W; q++) {
                const t = row[q];
                if (!t || t._isInterior || t._deck || t._pier) continue;
                if (_isOpenWater(t)) {
                    if (hh(q, r, 701) < 0.05) mist.push(q, r, hh(q, r, 702));
                    continue;
                }
                if (_isBuildingCell(t) || t._wet || t.customObject || t.customObjectPart) continue;
                if (t.subTerrain && t.subTerrain.passable === false) continue;
                const paved = !!(t.paving || t._pave);
                const soft = !paved && (t.isRoad || t._townSoil || t._fieldSoil || t.baseTerrain === 'dirt');
                const moist = _num(t.moisture, 0.5);
                // Puddles: the roads and the soft ground, more in the low wet places; the paving's few hollows
                const pShare = paved ? 0.06 : soft ? 0.09 + moist * 0.12 : (moist > 0.62 ? 0.03 : 0);
                if (pShare > 0 && hh(q, r, 703) < pShare) {
                    // the lower the ground, the sooner it fills: a threshold of the puddles' level
                    puddles.push(q, r, Math.min(0.85, 0.08 + hh(q, r, 704) * 0.55 + (1 - moist) * 0.25));
                }
                if (soft && hh(q, r, 705) < 0.4) gloss.push(q, r, hh(q, r, 706));
                if (!soft && !paved && !t.isRoad && moist > 0.55 && hh(q, r, 707) < 0.012) mist.push(q, r, hh(q, r, 708));
                if (!soft && !paved && !t.isRoad && /grass|meadow/.test(String(t.baseTerrain || '')) && hh(q, r, 709) < (nearWater(q, r) ? 0.05 : 0.012)) flies.push(q, r, hh(q, r, 710));
            }
        }
        // keep to the caps (evenly thinned)
        const cap = (arr, max) => {
            const n = arr.length / 3;
            if (n <= max) return arr;
            const out = [];
            const step = n / max;
            for (let i = 0; i < max; i++) { const j = Math.floor(i * step) * 3; out.push(arr[j], arr[j + 1], arr[j + 2]); }
            return out;
        };
        this._wxCache = {
            tiles,
            puddles: _byRows(cap(puddles, maxP), H),
            gloss: _byRows(cap(gloss, maxG), H),
            mist: _byRows(cap(mist, 260), H),
            flies: _byRows(cap(flies, 260), H),
        };
        return this._wxCache;
    },

    // ══════════════════════════════════════════════
    // OVER THE GROUND: wet, mud, puddles, splashes
    // ══════════════════════════════════════════════

    _renderWeatherGround(ctx, camera) {
        const sw = InnerMap._sw;
        if (!sw || InnerMap._insideBuilding || InnerMap._underwater || !InnerMap.tiles) return;
        const fx = this._wxFx();
        const cells = this._wxCells();
        if (!cells) return;
        const now = this._ambientT || 0;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const p = Math.max(1, Math.round(ds / 16));
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const cw = ctx.canvas.width, ch = ctx.canvas.height;
        const frozen = sw.celsius <= 0;

        // ── The ground darkened while it's wet ──
        const damp = Math.max(sw.damp, sw.rain);
        if (damp > 0.03 && !frozen) {
            ctx.fillStyle = WET(damp * _num(fx.wetTint, 0.16));
            ctx.fillRect(0, 0, cw, ch);
        }

        // ── The fresh mud: dark, wet patches with a shine ──
        const ssMud = InnerMap._ss ? _num(InnerMap._ss.mud, 0) : 0;
        const mud = Math.max(sw.mud, ssMud * 0.6);
        if (mud > 0.1 && !frozen) {
            const G = cells.gloss;
            const a = Math.min(0.34, 0.08 + mud * 0.22);
            ctx.fillStyle = MUD(a);
            const i0 = G.start[Math.max(0, rMin)], i1 = G.start[Math.min(rMax + 1, G.start.length - 1)];
            for (let i = i0; i < i1; i++) {
                const q = G.q[i];
                if (q < qMin || q > qMax || G.k[i] > mud + 0.25) continue;
                const r = G.r[i];
                const s = camera.worldToScreenFast(q * T, r * T);
                // an irregular patch (a wide middle and a narrower top and foot, corners cut), never a square
                const w = Math.floor(ds * (0.32 + G.k[i] * 0.3)), h = Math.max(2 * p, Math.floor(w * (0.38 + hh(q, r, 7) * 0.2)));
                const x = Math.floor(s.x + (ds - w) * (0.15 + hh(q, r, 3) * 0.7)), y = Math.floor(s.y + (ds - h) * (0.2 + hh(q, r, 4) * 0.6));
                const inset = Math.max(p, Math.floor(w * 0.18));
                ctx.fillRect(x, y + p, w, Math.max(p, h - 2 * p));
                ctx.fillRect(x + inset, y, w - 2 * inset, h);
                // a lobe off to one side
                const lw = Math.floor(w * 0.45), lx = hh(q, r, 8) < 0.5 ? x - Math.floor(lw * 0.4) : x + w - Math.floor(lw * 0.6);
                ctx.fillRect(lx, y + Math.floor(h * 0.3), lw, Math.max(p, Math.floor(h * 0.5)));
            }
            // the shine: the sky on the wet mud, glinting as you move
            ctx.fillStyle = sw.sun > 0.4 ? 'rgba(235, 228, 205, 0.5)' : 'rgba(170, 180, 190, 0.38)';
            for (let i = i0; i < i1; i++) {
                const q = G.q[i];
                if (q < qMin || q > qMax || G.k[i] > mud) continue;
                const r = G.r[i];
                if (Math.sin(now * 1.3 + G.k[i] * 40) < 0.1) continue;
                const s = camera.worldToScreenFast(q * T, r * T);
                ctx.fillRect(Math.floor(s.x + ds * (0.2 + hh(q, r, 5) * 0.5)), Math.floor(s.y + ds * (0.25 + hh(q, r, 6) * 0.4)), 2 * p, p);
            }
        }

        // ── Puddles: fill in the rain on the roads and in the hollows, dry after ──
        const lvl = sw.puddles;
        if (lvl > 0.06) {
            const P = cells.puddles;
            const i0 = P.start[Math.max(0, rMin)], i1 = P.start[Math.min(rMax + 1, P.start.length - 1)];
            const dark = frozen ? 'rgba(170, 196, 214, 0.85)' : 'rgba(46, 52, 60, 0.78)';
            const sky = frozen ? 'rgba(240, 250, 255, 0.85)' : sw.sun > 0.4 ? 'rgba(190, 215, 235, 0.85)' : 'rgba(128, 146, 164, 0.75)';
            for (let i = i0; i < i1; i++) {
                const q = P.q[i];
                if (q < qMin || q > qMax) continue;
                const th = P.k[i];
                if (lvl <= th) continue;
                const r = P.r[i];
                const t = InnerMap.tiles[r] && InnerMap.tiles[r][q];
                if (!t || !t.explored) continue;
                const size = Math.min(1, 0.3 + (lvl - th) / 0.35);
                const s = camera.worldToScreenFast(q * T, r * T);
                const w = Math.max(3 * p, Math.round(ds * (0.35 + hh(q, r, 11) * 0.3) * size));
                const h = Math.max(2 * p, Math.round(w * (0.42 + hh(q, r, 12) * 0.15)));
                const x = Math.floor(s.x + (ds - w) * (0.2 + hh(q, r, 13) * 0.6)), y = Math.floor(s.y + (ds - h) * (0.25 + hh(q, r, 14) * 0.5));
                ctx.fillStyle = dark;
                ctx.fillRect(x + p, y, w - 2 * p, h);
                ctx.fillRect(x, y + p, w, Math.max(p, h - 2 * p));
                ctx.fillStyle = sky;
                ctx.fillRect(x + p, y + p, Math.max(p, Math.floor(w * 0.45)), Math.max(1, p >> 1) || 1);
                // rain rings in the puddle
                if (sw.rain > 0 && !frozen) {
                    const u = _frac(now * (0.9 + sw.rain * 1.4) + hh(q, r, 15));
                    const k = Math.ceil((1 - u) * STEPS);
                    ctx.strokeStyle = RING_COL[k];
                    ctx.lineWidth = Math.max(1, p >> 1);
                    const rw = Math.max(1, w * 0.18 * (0.3 + u)), rh = rw * 0.5;
                    ctx.strokeRect(Math.floor(x + w * (0.3 + hh(q, r, 16) * 0.4) - rw), Math.floor(y + h * 0.5 - rh), Math.ceil(rw * 2), Math.max(1, Math.ceil(rh * 2)));
                }
            }
        }

        // ── Splashes on the ground, rings on the water ──
        this._wxSplashes(ctx, camera, sw, fx, now, ds, p);
    },

    /** Spawn and draw the rain's splashes (a fixed ring of them). */
    _wxSplashes(ctx, camera, sw, fx, now, ds, p) {
        const T = this.TILE_SIZE;
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const max = Math.min(MAX_SPLASH, Math.max(0, _num(fx.splashes, 70)));
        if (sw.rain > 0 && max > 0) {
            // as many as the rain and the ground in view call for, spread over the frames
            const dt = Math.min(0.1, Math.max(0, now - (this._wxSplT || now)));
            const area = (qMax - qMin + 1) * (rMax - rMin + 1);
            _splAcc += dt * sw.rain * (sw.storm ? 2 : 1) * Math.min(260, area * 0.22);
            let n = Math.min(12, Math.floor(_splAcc));
            _splAcc -= n;
            const tiles = InnerMap.tiles;
            while (n-- > 0) {
                const q = qMin + Math.floor(_rand() * (qMax - qMin + 1)), r = rMin + Math.floor(_rand() * (rMax - rMin + 1));
                const t = tiles[r] && tiles[r][q];
                if (!t || !t.visible || _isBuildingCell(t) || t._isInterior) continue;
                const water = _isOpenWater(t);
                if (!water && t.subTerrain && t.subTerrain.passable === false) continue;
                const i = (_splN++ % max) * 4;
                _spl[i] = (q + 0.1 + _rand() * 0.8) * T;
                _spl[i + 1] = (r + 0.1 + _rand() * 0.8) * T;
                _spl[i + 2] = now;
                _spl[i + 3] = water ? 1 : 0;
            }
        }
        this._wxSplT = now;
        const n = Math.min(_splN, max);
        if (!n) return;
        ctx.lineWidth = Math.max(1, p >> 1);
        for (let k = 0; k < n; k++) {
            const i = k * 4;
            const age = now - _spl[i + 2];
            const ring = _spl[i + 3] === 1;
            const life = ring ? RING_LIFE : SPLASH_LIFE;
            if (age < 0 || age > life) continue;
            const u = age / life;
            const s = camera.worldToScreenFast(_spl[i], _spl[i + 1]);
            const x = Math.floor(s.x), y = Math.floor(s.y);
            if (x < -8 || y < -8 || x > ctx.canvas.width + 8 || y > ctx.canvas.height + 8) continue;
            const fade = Math.ceil((1 - u) * STEPS);
            if (ring) {
                ctx.strokeStyle = RING_COL[fade];
                const rw = ds * (0.05 + u * 0.18), rh = rw * 0.5;
                ctx.strokeRect(Math.floor(x - rw), Math.floor(y - rh), Math.ceil(rw * 2), Math.max(1, Math.ceil(rh * 2)));
            } else {
                // a little crown: two droplets thrown out and a dot
                ctx.fillStyle = SPLASH_COL[fade];
                const sp = Math.round((1 + u * 3) * p);
                ctx.fillRect(x - sp, y - Math.round(u * 2 * p), p, p);
                ctx.fillRect(x + sp, y - Math.round(u * 2 * p), p, p);
                ctx.fillRect(x, y, p, p);
            }
        }
    },

    // ══════════════════════════════════════════════
    // LOW: the mist at dawn
    // ══════════════════════════════════════════════

    _renderWeatherLow(ctx, camera) {
        const sw = InnerMap._sw;
        if (!sw || !(sw.fog > 0.02) || InnerMap._insideBuilding || InnerMap._underwater) return;
        const cells = this._wxCells();
        if (!cells) return;
        if (!this._wxMistSprite) this._wxMistSprite = _glow(96, [[0, 'rgba(232,236,240,0.9)'], [0.45, 'rgba(228,232,238,0.45)'], [1, 'rgba(225,230,236,0)']]);
        const spr = this._wxMistSprite;
        const now = this._ambientT || 0;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const cw = ctx.canvas.width, ch = ctx.canvas.height;
        // a light haze over everything
        ctx.fillStyle = HAZE(sw.fog * 0.16);
        ctx.fillRect(0, 0, cw, ch);
        if (!spr) return;
        const M = cells.mist;
        const wind = sw.wind ? sw.wind.x : 0.2;
        const i0 = M.start[Math.max(0, rMin - 3)], i1 = M.start[Math.min(rMax + 4, M.start.length - 1)];
        const prev = ctx.globalAlpha;
        for (let i = i0; i < i1; i++) {
            const q = M.q[i];
            if (q < qMin - 4 || q > qMax + 4) continue;
            const k = M.k[i];
            // banks drifting slowly with the air, swelling and thinning
            const drift = Math.sin(now * 0.05 + k * 20) * 1.6 + wind * Math.sin(now * 0.02 + k * 9) * 2;
            const s = camera.worldToScreenFast((q + 0.5 + drift) * T, (M.r[i] + 0.5) * T);
            const w = ds * (4 + k * 3), h = w * 0.45;
            ctx.globalAlpha = Math.min(1, sw.fog * (0.4 + 0.25 * Math.sin(now * 0.12 + k * 30)));
            ctx.drawImage(spr, s.x - w / 2, s.y - h / 2, w, h);
        }
        ctx.globalAlpha = prev;
    },

    // ══════════════════════════════════════════════
    // IN THE AIR (over the lighting): rain, snow, lightning, rainbow, fireflies, drips
    // ══════════════════════════════════════════════

    _renderWeatherFx(ctx, canvas, camera /* , deltaTime */) {
        const sw = InnerMap._sw;
        if (!sw || InnerMap._insideBuilding || InnerMap._underwater) return false;
        const fx = this._wxFx();
        const now = this._ambientT || 0;
        const cw = canvas.width, ch = canvas.height;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const p = Math.max(1, Math.round(ds / 16));
        const wind = sw.wind || { x: 0, strength: 0 };
        // gusts: the wind rising and falling over the seconds
        const gust = 1 + wind.strength * 0.55 * Math.sin(now * 0.71) * Math.sin(now * 0.23 + 1.3);
        const wx = wind.x * gust;
        ctx.save();
        // the camera's place, so the rain and snow fall over the street and move with it
        const camX = camera.x * camera.zoom, camY = camera.y * camera.zoom;

        // ── Rain ──
        if (sw.rain > 0) {
            const n = Math.min(MAX_DROPS, Math.round(_num(fx.drops, 260) * (0.25 + 0.75 * sw.rain) * (sw.storm ? 1.35 : 1)));
            const v = ch * (1.25 + 0.7 * sw.rain);                 // px/s down the screen
            const slant = wx * (sw.storm ? 0.75 : 0.45);            // across, per unit down
            const span = cw + 240;
            for (let layer = 0; layer < 2; layer++) {
                ctx.strokeStyle = layer ? 'rgba(200, 215, 235, 0.55)' : 'rgba(165, 185, 215, 0.32)';
                ctx.lineWidth = layer ? Math.max(1, p * 0.6) : Math.max(1, p * 0.4);
                const par = layer ? 1 : 0.8;
                ctx.beginPath();
                for (let i = layer; i < n; i += 2) {
                    const j = i * 4;
                    const sp = v * (0.8 + _dropSeed[j + 2] * 0.4) * (layer ? 1 : 0.8);
                    const len = (6 + _dropSeed[j + 3] * 8) * p * (0.6 + sw.rain * 0.6) * (layer ? 1 : 0.7);
                    const y = ((_dropSeed[j + 1] * (ch + 80) + now * sp - camY * par) % (ch + 80) + (ch + 80)) % (ch + 80) - 40;
                    const x = ((_dropSeed[j] * span + now * sp * slant - camX * par) % span + span) % span - 120;
                    ctx.moveTo(x, y);
                    ctx.lineTo(x - slant * len, y - len);
                }
                ctx.stroke();
            }
        }

        // ── Snow ──
        if (sw.snow > 0) {
            const bliz = sw.type === 'blizzard';
            const n = Math.min(MAX_FLAKES, Math.round(_num(fx.flakes, 220) * (0.3 + 0.7 * sw.snow) * (bliz ? 1.5 : 1)));
            const v = ch * (bliz ? 0.45 : 0.14 + sw.snow * 0.08);
            const across = wx * (bliz ? 2.2 : 0.6);
            const span = cw + 120;
            if (bliz) {
                ctx.fillStyle = BLIZ;
                ctx.fillRect(0, 0, cw, ch);
            }
            for (let layer = 0; layer < 2; layer++) {
                ctx.fillStyle = layer ? 'rgba(255, 255, 255, 0.9)' : 'rgba(235, 242, 250, 0.6)';
                const sz = layer ? Math.max(2, p * 1.4) : Math.max(1, p);
                const par = layer ? 1 : 0.75;
                for (let i = layer; i < n; i += 2) {
                    const j = i * 4;
                    const sp = v * (0.7 + _flakeSeed[j + 2] * 0.6) * (layer ? 1 : 0.7);
                    const sway = Math.sin(now * (0.8 + _flakeSeed[j + 3]) + i) * ds * 0.25;
                    const y = ((_flakeSeed[j + 1] * (ch + 40) + now * sp - camY * par) % (ch + 40) + (ch + 40)) % (ch + 40) - 20;
                    const x = ((_flakeSeed[j] * span + now * sp * across + sway - camX * par) % span + span) % span - 60;
                    ctx.fillRect(Math.floor(x), Math.floor(y), sz, sz);
                }
            }
        }

        // ── Lightning: the flash, and now and then the bolt ──
        const fa = now - this._wxFlashT;
        if (fa >= 0 && fa < 0.5) {
            // two quick flickers, then fading
            const k = fa < 0.06 ? 1 : fa < 0.11 ? 0.35 : fa < 0.17 ? 0.85 : Math.max(0, 0.85 * (1 - (fa - 0.17) / 0.33));
            ctx.fillStyle = FLASH(k * 0.42);
            ctx.fillRect(0, 0, cw, ch);
            if (_boltN > 1 && now - this._wxBoltT < 0.22) {
                ctx.strokeStyle = 'rgba(190, 205, 255, 0.45)';
                ctx.lineWidth = Math.max(3, p * 3);
                ctx.beginPath();
                ctx.moveTo(_bolt[0] * cw, _bolt[1] * ch);
                for (let i = 1; i < _boltN; i++) ctx.lineTo(_bolt[i * 2] * cw, _bolt[i * 2 + 1] * ch);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.lineWidth = Math.max(1, p);
                ctx.stroke();
            }
        }

        // ── A rainbow after the rain, the sun out ──
        if (sw.rainbow > 0.01) this._wxRainbow(ctx, cw, ch, sw, fx);

        // ── Fireflies on a warm summer night ──
        if (sw.fireflies > 0.01) this._wxFireflies(ctx, camera, sw, now, ds);

        // ── Drips off the player when wet ──
        const wet = _num(this._wxPlayerWet, 0);
        if (wet > 12 && InnerMap.getPlayerWorldPos && !InnerMap.isPlayerSwimming?.()) {
            const pw = InnerMap.getPlayerWorldPos();
            const s = camera.worldToScreenFast(pw.x, pw.y);
            const drops = wet > 75 ? 3 : wet > 40 ? 2 : 1;
            ctx.fillStyle = 'rgba(150, 195, 240, 0.85)';
            for (let i = 0; i < drops; i++) {
                const u = _frac(now * (0.7 + wet / 120) + i / drops + 0.17 * i);
                ctx.globalAlpha = Math.max(0, 1 - u);
                const x = Math.floor(s.x + ds * (i === 0 ? -0.18 : i === 1 ? 0.2 : 0.02));
                const y = Math.floor(s.y - ds * 0.35 + u * ds * 0.65);
                ctx.fillRect(x, y, p, 2 * p);
            }
            ctx.globalAlpha = 1;
        }
        ctx.restore();
        return true;
    },

    /** Lay a strike (ui/innerMapWeather.js): the flash now, and with `bolt` the bolt itself across the sky. */
    _wxStrike(bolt) {
        const now = this._ambientT || 0;
        this._wxFlashT = now;
        if (!bolt) return;
        this._wxBoltT = now;
        let x = 0.15 + _rand() * 0.7, y = 0;
        const n = 8 + Math.floor(_rand() * 6);
        const end = 0.35 + _rand() * 0.4;
        _boltN = Math.min(14, n);
        for (let i = 0; i < _boltN; i++) {
            _bolt[i * 2] = x; _bolt[i * 2 + 1] = y;
            x += (_rand() - 0.5) * 0.07;
            y += end / _boltN * (0.6 + _rand() * 0.8);
        }
    },

    /** The rainbow: soft bands across the sky away from the sun (drawn once a size into a kept canvas). */
    _wxRainbow(ctx, cw, ch, sw, fx) {
        // morning sun in the east: the bow stands in the west, and the other way about after noon
        const side = sw.hour < 12.5 ? 0 : 1;
        let c = this._wxRainbowC;
        if (!c || c.w !== cw || c.h !== ch || c.side !== side) {
            const can = _canvas(cw, Math.max(1, Math.round(ch * 0.6)));
            if (!can) return;
            const g = can.getContext('2d');
            if (!g || typeof g.createLinearGradient !== 'function') return;
            const R = Math.max(cw, ch) * 0.62;
            const cx = cw * (side ? 0.68 : 0.32), cy = ch * 0.62 + R * 0.55;
            const band = Math.max(3, R * 0.016);
            const cols = ['#ff4b3a', '#ff9d2e', '#ffe84a', '#5fd36a', '#4aa6ff', '#6b5cff', '#b062e6'];
            g.lineWidth = band * 1.15;
            for (let i = 0; i < cols.length; i++) {
                g.strokeStyle = cols[i];
                g.beginPath();
                g.arc(cx, cy, R - i * band, Math.PI * 1.08, Math.PI * 1.92);
                g.stroke();
            }
            // soft: fade toward the ground at both feet
            g.globalCompositeOperation = 'destination-in';
            const gr = g.createLinearGradient(0, 0, 0, can.height);
            gr.addColorStop(0, 'rgba(0,0,0,1)');
            gr.addColorStop(0.55, 'rgba(0,0,0,0.8)');
            gr.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = gr;
            g.fillRect(0, 0, can.width, can.height);
            g.globalCompositeOperation = 'source-over';
            c = this._wxRainbowC = { can, w: cw, h: ch, side };
        }
        ctx.globalAlpha = Math.min(1, sw.rainbow) * _num(fx.rainbowAlpha, 0.32);
        ctx.drawImage(c.can, 0, 0);
        ctx.globalAlpha = 1;
    },

    /** Fireflies: little lights blinking and wandering over the meadows and the water's edge. */
    _wxFireflies(ctx, camera, sw, now, ds) {
        const cells = this._wxCells();
        if (!cells) return;
        if (!this._wxFlySprite) this._wxFlySprite = _glow(24, [[0, 'rgba(250,255,190,1)'], [0.25, 'rgba(215,250,120,0.75)'], [1, 'rgba(160,230,80,0)']]);
        const spr = this._wxFlySprite;
        if (!spr) return;
        const fx = this._wxFx();
        const T = this.TILE_SIZE;
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const F = cells.flies;
        const i0 = F.start[Math.max(0, rMin)], i1 = F.start[Math.min(rMax + 1, F.start.length - 1)];
        let shown = 0;
        const max = Math.max(0, _num(fx.fireflies, 46));
        const prevOp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'lighter';
        for (let i = i0; i < i1 && shown < max; i++) {
            const q = F.q[i];
            if (q < qMin || q > qMax) continue;
            const k = F.k[i];
            if (k > sw.fireflies + 0.1) continue;
            // two or three to a spot, wandering about it
            for (let f = 0; f < 3 && shown < max; f++) {
                const ph = k * 50 + f * 2.1;
                const x = (q + 0.5 + Math.sin(now * (0.31 + f * 0.07) + ph) * 1.1 + Math.sin(now * 0.9 + ph * 1.7) * 0.2) * T;
                const y = (F.r[i] + 0.3 + Math.cos(now * (0.27 + f * 0.05) + ph * 1.3) * 0.8) * T;
                const b = Math.sin(now * (1.6 + f * 0.4) + ph * 3);
                if (b < 0.2) continue;
                const s = camera.worldToScreenFast(x, y);
                const sz = ds * 0.45 * (0.6 + 0.4 * b);
                ctx.globalAlpha = Math.min(1, (b - 0.2) * 1.4 * sw.fireflies);
                ctx.drawImage(spr, s.x - sz / 2, s.y - sz / 2, sz, sz);
                shown++;
            }
        }
        ctx.globalCompositeOperation = prevOp;
        ctx.globalAlpha = 1;
    },
});

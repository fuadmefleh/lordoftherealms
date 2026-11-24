// ============================================
// INTERIOR LIGHT — the light in a room, worked out once and laid over it
// ============================================
// Indoors (a procedural room or a sprite room, not a cave or a mine) this pass
// stands in for LightSystem's night overlay: one light map for the whole house,
// so the two never darken a room twice.
//
//   THE MAP     — a value a tile, worked out when something changes (the hour's
//                 daylight in steps, a hearth lit or let die, candles lit, a
//                 window shuttered: the over-time module's flags), never a frame:
//                   ambient  dimmer than the street by day, dark but readable by
//                            night (interiorArt.light day / night)
//                   corners  each tile's share of open floor about it (5×5) —
//                            darker in corners and small rooms: a soft vignette
//                   windows  daylight by the hour (interiorDress.daylight) in a
//                            pool widening into the room and fading, cool; none at
//                            night or shuttered (tile._wallDecorState 'shut')
//                   fires    hearths, ovens, forges (tile._furniture.lit !== false),
//                            candles (tile._decorLit, else lit after dark), wall
//                            torches (lit after dark unless _decorLit is false):
//                            warm, spreading through the room's floor and its
//                            doorways (not through walls)
//                 then blurred a step. Three small canvases, a pixel a tile (and a
//                 border): `mul` multiplied over the scene, `add` (the windows' cool
//                 pool) and `glow` (the fires' warmth, flickering a little) added.
//   DRAWN       — scaled up smooth over the map: no stripes, no edges. At night the
//                 light you carry (LightSystem.carried) is added to the map first,
//                 on a canvas the screen's size; by day the small map goes straight on.
//
// Config: data/innerMapRenderer.json interiorArt.light (DEFAULTS below when absent).
// interiorLightMap() is pure (tests and the preview call it); InteriorLight keeps
// the canvases and draws (ui/innerMapRenderer.js, layer 9).

import { InnerMap } from '../world/innerMap.js';
import { LightSystem } from './lightSystem.js';
import { asIds, artFor, daylight } from './interiorDress.js';

export const DEFAULTS = {
    day: [0.74, 0.72, 0.69],
    night: [0.3, 0.31, 0.42],
    vignette: 0.7,
    window: { reach: 4, mul: [0.34, 0.36, 0.4], add: [0.11, 0.12, 0.14], onWall: 0.55 },
    fires: {
        fireplace: { radius: 5.5, strength: 1, color: [1, 0.62, 0.3] },
        hearth: { radius: 5.5, strength: 1, color: [1, 0.62, 0.3] },
        forge: { radius: 5, strength: 1, color: [1, 0.52, 0.22] },
        oven: { radius: 3.5, strength: 0.75, color: [1, 0.6, 0.3] },
        kiln: { radius: 3.5, strength: 0.75, color: [1, 0.58, 0.28] },
        brazier: { radius: 4, strength: 0.85, color: [1, 0.6, 0.28] },
        cauldron: { radius: 2.5, strength: 0.45, color: [1, 0.58, 0.28] },
        candle: { radius: 3, strength: 0.6, color: [1, 0.8, 0.5], candle: true },
    },
    candle: { radius: 3, strength: 0.55, color: [1, 0.8, 0.5] },
    torch: { radius: 4, strength: 0.75, color: [1, 0.66, 0.35] },
    fireMul: 0.85,
    glow: 0.2,
    glowDay: 0.07,
    flicker: 0.07,
    steps: 20,
    player: { radius: 70, strength: 0.16, color: [1, 0.78, 0.5] },
    // (a cellar: no daylight at any hour, its torches always burning — this its ambient)
    cellar: [0.2, 0.2, 0.24],
};

const WINDOW_IDS = new Set(['window', 'windows', 'curtains']);

/** The config: interiorArt.light over DEFAULTS (one level deep) */
export function lightConfig(art) {
    const L = art && art.light;
    if (!L) return DEFAULTS;
    const out = { ...DEFAULTS, ...L };
    for (const k of ['window', 'candle', 'torch', 'player']) out[k] = { ...DEFAULTS[k], ...(L[k] || {}) };
    out.fires = { ...DEFAULTS.fires, ...(L.fires || {}) };
    return out;
}

/** Is this room a cellar (world/innerMap/floors.js marks its tiles _cellar)? Underground: dark at every hour. */
export function isCellar(tiles) {
    const row = tiles && tiles[0];
    return !!(row && row[0] && row[0]._cellar);
}

const passable = (t) => !!t && (t.baseTerrain !== 'wall' || !!t._doorway);
const isWallT = (t) => !!t && t.baseTerrain === 'wall' && !t._doorway;
const smooth = (t) => (t <= 0 ? 1 : t >= 1 ? 0 : 1 - t * t * (3 - 2 * t));

/** What a wall decor id is as a light: 'window', 'torch' or null (its art's `light`, else by name) */
function wallLightKind(art, id) {
    const a = art && art.wallDecor && artFor(art.wallDecor, id);
    if (a && a.light) return a.light;
    if (WINDOW_IDS.has(id)) return 'window';
    return id === 'torch' ? 'torch' : null;
}
function decorIsCandle(art, id) {
    const a = art && art.decor && artFor(art.decor, id);
    return a ? a.light === 'candle' : (id === 'candles' || id === 'candle');
}

/**
 * The light sources in a room: windows, fires, candles, torches, with where they are.
 * A big piece (furniture.piece) counts once, at its middle.
 */
export function collectLightSources(tiles, art, cfg = lightConfig(art)) {
    const out = [];
    const H = tiles.length, W = H ? tiles[0].length : 0;
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            const t = tiles[r][q];
            if (!t) continue;
            if (t._wallDecor) {
                for (const id of asIds(t._wallDecor)) {
                    const k = wallLightKind(art, id);
                    if (k === 'window') out.push({ kind: 'window', q, r, tile: t });
                    else if (k === 'torch') out.push({ kind: 'torch', q, r, tile: t, spec: cfg.torch });
                }
            }
            if (t._decor && asIds(t._decor).some(id => decorIsCandle(art, id))) {
                out.push({ kind: 'candle', q, r, tile: t, spec: cfg.candle });
            }
            const f = t._furniture || (t._interiorMeta && t._interiorMeta.furniture);
            const spec = f && cfg.fires[f.type];
            if (spec) {
                const pc = f.piece;
                if (pc && (pc.i || pc.j)) continue;   // (counted at its head)
                const cq = pc ? q + (pc.w - 1) / 2 : q, cr = pc ? r + (pc.h - 1) / 2 : r;
                const parts = [];
                if (pc) {
                    for (let j = 0; j < pc.h; j++) for (let i = 0; i < pc.w; i++) {
                        const o = tiles[r + j] && tiles[r + j][q + i];
                        if (o && o._furniture) parts.push(o._furniture);
                    }
                } else parts.push(f);
                out.push({ kind: spec.candle ? 'candleStand' : 'fire', q, r, cq, cr, tile: t, parts, spec });
            }
        }
    }
    return out;
}

/** Whether a source gives light now (night: the hour is dark enough for candles and torches) */
export function sourceLit(s, night) {
    if (s.kind === 'fire') {
        // (a piece lit or put out on any of its tiles: put out wins unless another says lit)
        const ls = s.parts.map(p => p.lit);
        if (ls.includes(true)) return true;
        return !ls.includes(false);
    }
    if (s.kind === 'candleStand') {
        const f = s.parts[0];
        if (f.lit === true || f.lit === false) return f.lit;
        return s.tile._decorLit === true ? true : s.tile._decorLit === false ? false : night;
    }
    if (s.kind === 'candle' || s.kind === 'torch') {
        const v = s.tile._decorLit;
        if (v === true || v === false) return v;
        return night;
    }
    return false;
}

/** A small code of a source's state (what the map is keyed on) */
function stateCode(s) {
    const t = s.tile;
    if (s.kind === 'window') return t._wallDecorState === 'shut' ? 's' : 'o';
    if (s.kind === 'fire') return s.parts.map(p => (p.lit === false ? '0' : p.lit === true ? '1' : 'u')).join('');
    const f = s.parts && s.parts[0];
    return `${t._decorLit === true ? 1 : t._decorLit === false ? 0 : 'u'}${f && f.lit === false ? 0 : f && f.lit === true ? 1 : 'u'}`;
}

/**
 * The light map of a room (pure). tiles: InnerMap.tiles; hour: InnerMap.timeOfDay.
 * Returns { w, h, d, night, mul, add, glow } — Float32Arrays of w*h*3 (rgb, 0..1):
 * mul ≤ 1 (multiplied over the scene), add and glow (added; glow is the fires').
 */
export function interiorLightMap(tiles, hour, opts = {}) {
    const art = opts.art || null;
    const cfg = opts.cfg || lightConfig(art);
    const H = tiles.length, W = H ? tiles[0].length : 0;
    const N = W * H;
    const at = (q, r) => (q >= 0 && r >= 0 && q < W && r < H ? tiles[r][q] : null);
    // (a cellar: no daylight, its torches and candles lit at every hour)
    const under = opts.cellar != null ? !!opts.cellar : isCellar(tiles);
    const d = under ? 0 : daylight(hour);
    const night = under || d < 0.5;
    const dark = under && cfg.cellar ? cfg.cellar : cfg.night;
    const sources = opts.sources || collectLightSources(tiles, art, cfg);

    // ── corners: the share of open floor about each tile ──
    const open = new Uint8Array(N);
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) open[r * W + q] = passable(tiles[r][q]) ? 1 : 0;
    const vig = new Float32Array(N);
    const vMin = cfg.vignette;
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            let n = 0;
            for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
                const qq = q + i, rr = r + j;
                if (qq >= 0 && rr >= 0 && qq < W && rr < H) n += open[rr * W + qq];
            }
            const o = n / 25;
            const s = Math.max(0, Math.min(1, (o - 0.32) / 0.55));
            vig[r * W + q] = vMin + (1 - vMin) * s * s * (3 - 2 * s);
        }
    }
    // (a wall takes the light of the floor before it: its face is lit as the room is)
    const vig2 = Float32Array.from(vig);
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) {
        if (open[r * W + q]) continue;
        let best = 0;
        for (const [i, j] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const qq = q + i, rr = r + j;
            if (qq >= 0 && rr >= 0 && qq < W && rr < H && open[rr * W + qq]) best = Math.max(best, vig[rr * W + qq]);
        }
        vig2[r * W + q] = best ? best * 0.96 : vig[r * W + q];
    }

    // ── windows: a pool of daylight into the room ──
    const win = new Float32Array(N);
    if (d > 0) {
        const reach = cfg.window.reach;
        for (const s of sources) {
            if (s.kind !== 'window' || s.tile._wallDecorState === 'shut') continue;
            const dirs = [[0, 1], [1, 0], [-1, 0], [0, -1]];
            const dir = dirs.find(([i, j]) => passable(at(s.q + i, s.r + j)));
            if (!dir) continue;
            const [ux, uy] = dir, px = -uy, py = ux;
            win[s.r * W + s.q] = Math.max(win[s.r * W + s.q], cfg.window.onWall);
            for (let a = 1; a <= reach; a++) {
                const cq = s.q + ux * a, cr = s.r + uy * a;
                if (!passable(at(cq, cr))) break;
                const fall = Math.pow(1 - (a - 1) / reach, 1.3);
                const wa = 0.55 + 0.45 * a;
                const span = Math.ceil(wa + 0.5);
                for (let b = -span; b <= span; b++) {
                    const tq = cq + px * b, tr = cr + py * b;
                    const t = at(tq, tr);
                    if (!t) continue;
                    // (sideways only as far as the floor runs on: not round a wall)
                    let clear = true;
                    const sg = Math.sign(b);
                    for (let k = sg; sg && Math.abs(k) <= Math.abs(b); k += sg) {
                        if (!passable(at(cq + px * k, cr + py * k))) { clear = false; break; }
                    }
                    if (!clear) continue;
                    const lat = Math.max(0, 1 - Math.abs(b) / (wa + 0.5));
                    const v = fall * lat;
                    const i0 = tr * W + tq;
                    win[i0] = 1 - (1 - win[i0]) * (1 - v);   // (two windows' pools: one over the other)
                }
            }
        }
    }

    // ── fires, candles, torches: warm light through the floor and its doorways ──
    const fire = new Float32Array(N * 3);
    const dist = new Float32Array(N);
    for (const s of sources) {
        if (s.kind === 'window' || !sourceLit(s, night)) continue;
        const sp = s.spec;
        const R = sp.radius;
        dist.fill(Infinity);
        // seeds: the source's own floor (a torch on a wall: the floor before it)
        const sq = s.cq != null ? s.cq : s.q, sr = s.cr != null ? s.cr : s.r;
        const seeds = [];
        const add = (q, r, d0) => { if (at(q, r) && passable(at(q, r))) seeds.push([q, r, d0]); };
        if (passable(at(s.q, s.r))) {
            const pc = s.parts && s.parts[0] && s.parts[0].piece;
            if (pc) { for (let j = 0; j < pc.h; j++) for (let i = 0; i < pc.w; i++) add(s.q + i, s.r + j, Math.hypot(s.q + i - sq, s.r + j - sr)); }
            else add(s.q, s.r, 0);
        } else {
            for (const [i, j] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) add(s.q + i, s.r + j, 0.6);
        }
        const q0 = Math.max(0, Math.floor(sq - R - 1)), q1 = Math.min(W - 1, Math.ceil(sq + R + 1));
        const r0 = Math.max(0, Math.floor(sr - R - 1)), r1 = Math.min(H - 1, Math.ceil(sr + R + 1));
        for (const [q, r, d0] of seeds) dist[r * W + q] = Math.min(dist[r * W + q], d0);
        // (relaxed till it settles: a few sweeps over a small box)
        for (let pass = 0, changed = true; changed && pass < 12; pass++) {
            changed = false;
            for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
                const i0 = r * W + q;
                if (!open[i0]) continue;
                let best = dist[i0];
                for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
                    if (!i && !j) continue;
                    const qq = q + i, rr = r + j;
                    if (qq < q0 || rr < r0 || qq > q1 || rr > r1 || !open[rr * W + qq]) continue;
                    // (a diagonal step only past two open sides: not through a wall's corner)
                    if (i && j && !(open[r * W + qq] && open[rr * W + q])) continue;
                    const nd = dist[rr * W + qq] + (i && j ? 1.414 : 1);
                    if (nd < best) best = nd;
                }
                if (best < dist[i0]) { dist[i0] = best; changed = true; }
            }
        }
        const col = sp.color;
        for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
            const i0 = r * W + q;
            let dd = dist[i0];
            if (!open[i0]) {
                // a wall before lit floor is lit a little less than that floor
                for (const [i, j] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                    const qq = q + i, rr = r + j;
                    if (qq >= 0 && rr >= 0 && qq < W && rr < H && open[rr * W + qq]) dd = Math.min(dd, dist[rr * W + qq] + 0.6);
                }
            }
            if (!(dd < R)) continue;
            const v = sp.strength * smooth(dd / R);
            fire[i0 * 3] += v * col[0]; fire[i0 * 3 + 1] += v * col[1]; fire[i0 * 3 + 2] += v * col[2];
        }
    }

    // ── all together ──
    const mul = new Float32Array(N * 3), add = new Float32Array(N * 3), glow = new Float32Array(N * 3);
    // (the fires' glow grows as the daylight goes: no jump at dusk)
    const glowK = cfg.glowDay + (cfg.glow - cfg.glowDay) * (1 - d);
    for (let i0 = 0; i0 < N; i0++) {
        const v = vig2[i0], wv = win[i0] * d;
        for (let c = 0; c < 3; c++) {
            const amb = (dark[c] + (cfg.day[c] - dark[c]) * d) * v;
            const f = fire[i0 * 3 + c];
            mul[i0 * 3 + c] = Math.min(1, amb + wv * cfg.window.mul[c] + f * cfg.fireMul);
            add[i0 * 3 + c] = wv * cfg.window.add[c];
            glow[i0 * 3 + c] = Math.min(0.5, f * glowK);
        }
    }
    blur(mul, W, H); blur(add, W, H); blur(glow, W, H);
    return { w: W, h: H, d, night, mul, add, glow, sources };
}

/** A [1 2 1] blur, once each way (in place) */
function blur(a, W, H) {
    const tmp = new Float32Array(a.length);
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) for (let c = 0; c < 3; c++) {
        const l = a[(r * W + Math.max(0, q - 1)) * 3 + c], m = a[(r * W + q) * 3 + c], rr = a[(r * W + Math.min(W - 1, q + 1)) * 3 + c];
        tmp[(r * W + q) * 3 + c] = (l + 2 * m + rr) / 4;
    }
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) for (let c = 0; c < 3; c++) {
        const u = tmp[(Math.max(0, r - 1) * W + q) * 3 + c], m = tmp[(r * W + q) * 3 + c], dn = tmp[(Math.min(H - 1, r + 1) * W + q) * 3 + c];
        a[(r * W + q) * 3 + c] = (u + 2 * m + dn) / 4;
    }
}

/** The multiplier the scene gets at a tile, by channel ([r, g, b]) */
export function lightAt(map, q, r) {
    const i0 = (r * map.w + q) * 3;
    return [map.mul[i0], map.mul[i0 + 1], map.mul[i0 + 2]];
}

/** Whether the room's own light model lights this interior (not a cave or a mine: LightSystem's) */
export function indoorModelApplies() {
    const b = InnerMap._insideBuilding;
    if (!b || b._underground || !InnerMap.tiles || !InnerMap.tiles.length) return false;
    const row = InnerMap.tiles[Math.floor(InnerMap.tiles.length / 2)];
    const t = row && row[Math.floor(row.length / 2)];
    return !!t && !!t._isInterior && !t._cave;
}

function _canvas(w, h) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext && c.getContext('2d');
    return x && x.putImageData ? c : null;
}

/** A light map array into a canvas, a pixel a tile and a border of one (its edge repeated) */
function _fill(canvas, arr, W, H) {
    const x = canvas.getContext('2d');
    const img = x.createImageData(W + 2, H + 2);
    const p = img.data;
    for (let r = -1; r <= H; r++) for (let q = -1; q <= W; q++) {
        const s = (Math.min(H - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, q))) * 3;
        const o = ((r + 1) * (W + 2) + (q + 1)) * 4;
        p[o] = Math.round(arr[s] * 255); p[o + 1] = Math.round(arr[s + 1] * 255); p[o + 2] = Math.round(arr[s + 2] * 255); p[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
}

export const InteriorLight = {
    enabled: true,
    _tiles: null,
    _sources: null,
    _frames: 0,
    _key: '',
    map: null,
    _c: null,     // { mul, add, glow } canvases
    _scr: null,   // the screen-sized canvas for the night's compose

    /** Bring the map up to date (a rescan of the room now and then, the key each call). Returns it. */
    update(tiles, hour, art) {
        const cfg = lightConfig(art);
        if (tiles !== this._tiles || !this._sources || ++this._frames > 120) {
            this._tiles = tiles; this._frames = 0;
            const src = collectLightSources(tiles, art, cfg);
            const sig = src.map(s => `${s.kind}${s.q},${s.r}`).join(';');
            if (sig !== this._srcSig) { this._srcSig = sig; this._key = ''; }
            this._sources = src;
        }
        const under = isCellar(tiles);
        const d = under ? 0 : daylight(hour);
        const night = under || d < 0.5;
        let key = `${Math.round(d * cfg.steps)}|${night ? 1 : 0}|`;
        for (const s of this._sources) key += stateCode(s);
        if (key !== this._key || !this.map) {
            this._key = key;
            this.map = interiorLightMap(tiles, hour, { art, cfg, sources: this._sources });
            this._dirty = true;
        }
        return this.map;
    },

    /** Force the map to be worked out again (a room changed under it) */
    invalidate() { this._key = ''; this._tiles = null; },

    /**
     * Lay the room's light over the scene. Returns true when it did (LightSystem's
     * overlay is then left off: ui/innerMapRenderer.js), false when this is no room of ours.
     */
    render(ctx, canvas, camera, art, t = 0, tileSize = 32) {
        if (!this.enabled || !indoorModelApplies()) return false;
        const tiles = InnerMap.tiles;
        const map = this.update(tiles, InnerMap.timeOfDay, art);
        const cfg = lightConfig(art);
        const W = map.w, H = map.h;
        if (!this._c || this._c.w !== W || this._c.h !== H) {
            const mul = _canvas(W + 2, H + 2), add = _canvas(W + 2, H + 2), glow = _canvas(W + 2, H + 2);
            this._c = mul && add && glow ? { mul, add, glow, w: W, h: H } : null;
            this._dirty = true;
        }
        if (!this._c) return true;   // (no canvas here: the map stands, nothing to draw it on)
        if (this._dirty) {
            _fill(this._c.mul, map.mul, W, H); _fill(this._c.add, map.add, W, H); _fill(this._c.glow, map.glow, W, H);
            this._dirty = false;
        }
        const ds = tileSize * camera.zoom;
        const o = camera.worldToScreenFast(0, 0);
        const x = o.x - ds, y = o.y - ds, w = (W + 2) * ds, h = (H + 2) * ds;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        // At night the light you carry joins the map before it goes on
        const P = cfg.player;
        const pl = map.night && InnerMap.getPlayerWorldPos ? InnerMap.getPlayerWorldPos() : null;
        const scr = pl ? this._screen(canvas.width, canvas.height) : null;
        if (scr) {
            const s = scr.getContext('2d');
            s.globalCompositeOperation = 'source-over';
            s.fillStyle = '#fff';
            s.fillRect(0, 0, scr.width, scr.height);
            s.imageSmoothingEnabled = true;
            s.drawImage(this._c.mul, x, y, w, h);
            const c = LightSystem.carried;
            const ps = camera.worldToScreenFast(pl.x, pl.y);
            const rad = (c ? 60 + (c.radius || 0) * 0.8 : P.radius) * camera.zoom;
            const k = c ? Math.min(0.7, (c.intensity || 0.8) * 0.6) : P.strength;
            const col = c && c.color ? [c.color.r / 255, c.color.g / 255, c.color.b / 255] : P.color;
            const g = s.createRadialGradient(ps.x, ps.y, 0, ps.x, ps.y, rad);
            const rgba = (a) => `rgba(${Math.round(col[0] * 255)}, ${Math.round(col[1] * 255)}, ${Math.round(col[2] * 255)}, ${a.toFixed(3)})`;
            g.addColorStop(0, rgba(k)); g.addColorStop(0.5, rgba(k * 0.5)); g.addColorStop(1, rgba(0));
            s.globalCompositeOperation = 'lighter';
            s.fillStyle = g;
            s.fillRect(ps.x - rad, ps.y - rad, rad * 2, rad * 2);
            ctx.globalCompositeOperation = 'multiply';
            ctx.drawImage(scr, 0, 0);
        } else {
            ctx.globalCompositeOperation = 'multiply';
            ctx.drawImage(this._c.mul, x, y, w, h);
        }
        ctx.globalCompositeOperation = 'lighter';
        if (map.d > 0.01) ctx.drawImage(this._c.add, x, y, w, h);
        // the fires' warmth, wavering a little (on the renderer's clock: still when paused)
        const f = cfg.flicker;
        ctx.globalAlpha = Math.max(0, Math.min(1, 1 - f + f * (0.5 + 0.3 * Math.sin(t * 7.3) + 0.2 * Math.sin(t * 12.9 + 1.7))));
        ctx.drawImage(this._c.glow, x, y, w, h);
        ctx.restore();
        return true;
    },

    _screen(w, h) {
        if (!this._scr || this._scr.width !== w || this._scr.height !== h) this._scr = _canvas(w, h);
        return this._scr;
    },
};

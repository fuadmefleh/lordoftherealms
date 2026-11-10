// InnerMapRenderer — living water on the inner map (mixed in via Object.assign).
//
// Drawn over the ground and under every sprite (innerMapRenderer.js, after
// the ground overlays), only for the water cells on screen:
//
//   • Surf on sea and lake shores (and gently on ponds and river banks): a broken band of
//     foam runs in from the open water to the waterline on each side of a
//     shore cell that faces land, with a pale wash behind it, then fades as it
//     draws back. Neighbouring cells are out of step, so the waves roll along
//     a beach rather than pulse; now and then one breaks in a splash
//     (assets/lpc/FX/Splash.png, six 64×32 frames).
//   • Sun on the water: sparse sparkles that come and go on open water
//     (assets/lpc/FX/Water Reflections.png rows 0–1, four 32×32 frames), and
//     ripple rings on ponds (its row 2). Dimmer by night.
//   • The river runs: its sparkles drift downstream (the world river's
//     outflow side, else along the river's run).
//
// Storm and wind make the waves come faster, reach further and break more
// often; a still day leaves the water glassy. Settings: data/innerMap.json
// `waterFx`. The cells are worked out once per map (cached on the tiles
// array) — the frame only does arithmetic and a few rects and blits.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';
import { CustomObjects } from '../../world/customObjects.js';
import { sheetScale } from '../sheetScale.js';

const DEFAULTS = {
    enabled: true,
    surf: {
        period: 5.2, from: 1.25, to: 0.06, inShare: 0.55, roll: 0.09,
        thick: 0.09, dashes: 4, gap: 0.22,
        foam: '#eaf8ff', wash: '#bfe7ff', alpha: 0.85, washAlpha: 0.22,
        kinds: { sea: 1, lake: 0.85, pond: 0.6, river: 0.75 },
        splashEvery: 7, splashKinds: ['sea', 'lake'],
    },
    glint: { density: 0.08, cycle: [3.5, 7], fps: 7, alpha: 0.9, nightAlpha: 0.3, rippleKinds: ['pond'] },
    swell: { enabled: true, density: 0.45, wavelength: 3.2, speed: 0.6, underway: 1.6, crest: 0.3, length: 0.55, alpha: 0.6, minDist: 2.2, color: '#d8f0ff' },
    deck: { period: 2.4, from: 0.7, to: 0.04, alpha: 0.8, hullRows: 2 },
    wake: {
        enabled: true, rate: 0.45, alpha: 0.85, foam: '#eef9ff', bowPad: 0.3, sternPad: 0.6, waterRise: 0.35, wakeRise: 0.9,
        bowCount: 34, bowLength: 5, bowSpread: 0.9, wakeCount: 75, wakeLength: 14, wakeAngle: 0.2,
    },
    river: { density: 0.16, speed: 0.55, alpha: 0.75 },
    weather: {
        storm: { speed: 1.7, reach: 1.25, splash: 3, glint: 0.2 },
        rain: { speed: 1.2, reach: 1.1, splash: 1.5, glint: 0.4 },
        snow: { speed: 0.9, reach: 0.9, splash: 1, glint: 0.6 },
        fog: { speed: 0.8, reach: 0.9, splash: 1, glint: 0.3 },
        calm: { speed: 1, reach: 1, splash: 1, glint: 1 },
    },
};

// World hex sides in Hex.neighbors order (E, NE, NW, W, SW, SE) as map vectors
const SIDE_VEC = [[1, 0], [0.5, -0.87], [-0.5, -0.87], [-1, 0], [-0.5, 0.87], [0.5, 0.87]];
const N = 1, E = 2, S = 4, W = 8;

const _hash = (q, r, salt = 0) => {
    let h = (q * 73856093) ^ (r * 19349663) ^ (salt * 83492791);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};
const _frac = x => x - Math.floor(x);

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? _merge(base[k], v) : v;
    }
    return out;
}

const _isWater = t => !!(t && (t._wet || t._sea) && !t._deck && !t._pier && !t.isRoad
    && !(t.subTerrain && /frozen|ice/.test(t.subTerrain.id || '')));

Object.assign(InnerMapRenderer, {
    _waterFxCache: null,

    _waterFxCfg() {
        const src = DataLoader._gamedata && DataLoader._gamedata.innerMap && DataLoader._gamedata.innerMap.waterFx;
        if (this._waterFxCfgSrc !== src || !this._waterFxCfgVal) {
            this._waterFxCfgSrc = src;
            this._waterFxCfgVal = _merge(DEFAULTS, src || {});
        }
        return this._waterFxCfgVal;
    },

    /**
     * The water cells of this map that move, by row: shore cells (the sides
     * facing land), open-water sparkle cells, river cells (with their flow).
     * Cached on the tiles array; null when the map has no water.
     */
    _waterFxCells() {
        const tiles = InnerMap.tiles;
        if (!tiles || !tiles.length) return null;
        const c = this._waterFxCache;
        if (c && c.tiles === tiles) return c.rows;
        const cfg = this._waterFxCfg();
        const H = tiles.length;
        const Wd = tiles[0].length;
        const at = (q, r) => (r >= 0 && r < H && q >= 0 && q < Wd ? tiles[r][q] : null);
        // Land is anything not water on the map (off the edge counts as more water)
        const land = (q, r) => { const t = at(q, r); return !!t && !_isWater(t) && !t._deck; };
        const flow = this._riverFlowVec();
        const rows = new Map();
        let any = false;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < Wd; q++) {
                const t = tiles[r][q];
                if (!_isWater(t)) continue;
                const kind = t._waterKind || (t._sea ? 'sea' : 'pond');
                let sides = 0;
                if (land(q, r - 1)) sides |= N;
                if (land(q + 1, r)) sides |= E;
                if (land(q, r + 1)) sides |= S;
                if (land(q - 1, r)) sides |= W;
                const h = _hash(q, r, 7);
                let cell = null;
                // (a river's banks lap gently in the surf field, _waterFxField; its cells
                // keep their sparkles drifting downstream, bank or no)
                if (kind === 'river') {
                    // (a sparkle drifts most of a tile either way: only where there is water all round,
                    // else it slides off over the painted bank onto the grass)
                    const open = !sides && !land(q - 1, r - 1) && !land(q + 1, r - 1) && !land(q - 1, r + 1) && !land(q + 1, r + 1);
                    if (open && h < cfg.river.density) cell = { q, r, kind, river: true, h, fx: flow ? flow[0] : 0, fy: flow ? flow[1] : 0 };
                } else if (sides && _num(cfg.surf.kinds[kind], 0) > 0) {
                    cell = { q, r, kind, sides, h, strength: _num(cfg.surf.kinds[kind], 0) };
                } else if (!sides && h < cfg.glint.density) {
                    cell = { q, r, kind, glint: true, h, ripple: cfg.glint.rippleKinds.includes(kind) };
                }
                if (!cell) continue;
                if (!rows.has(r)) rows.set(r, []);
                rows.get(r).push(cell);
                any = true;
            }
        }
        // River cells with no world river direction: along the river's own run
        if (!flow) {
            for (const list of rows.values()) {
                for (const cell of list) {
                    if (!cell.river) continue;
                    let hx = 0, vy = 0;
                    for (let d = -3; d <= 3; d++) {
                        if (d && _isWater(at(cell.q + d, cell.r))) hx++;
                        if (d && _isWater(at(cell.q, cell.r + d))) vy++;
                    }
                    if (hx >= vy) cell.fx = 1; else cell.fy = 1;
                }
            }
        }
        this._waterFxCache = { tiles, rows: any ? rows : null };
        return this._waterFxCache.rows;
    },

    /** The world river's outflow as a map vector, or null */
    _riverFlowVec() {
        const wt = InnerMap._currentWorldTileRef;
        if (!wt || !Number.isInteger(wt.riverDir) || wt.riverDir < 0 || wt.riverDir > 5) return null;
        return SIDE_VEC[wt.riverDir];
    },

    /** How the weather moves the water: { speed, reach, splash, glint } */
    _waterFxWeather(cfg) {
        const w = InnerMap.weather;
        const type = w && w.type ? String(w.type).toLowerCase() : 'calm';
        const key = /storm|thunder|blizzard/.test(type) ? 'storm' : /rain|drizzle|shower/.test(type) ? 'rain'
            : /snow/.test(type) ? 'snow' : /fog|mist/.test(type) ? 'fog' : 'calm';
        const base = cfg.weather[key] || cfg.weather.calm;
        const wind = w && typeof w.wind === 'number' ? Math.max(0, Math.min(1, w.wind)) : 0;
        return { ...base, speed: base.speed * (1 + wind * 0.3), reach: base.reach * (1 + wind * 0.15) };
    },

    /** 0 at night … 1 at noon (for the sun on the water) */
    _waterFxDay() {
        const h = typeof InnerMap.timeOfDay === 'number' ? InnerMap.timeOfDay : 12;
        if (h < 5 || h > 21) return 0;
        if (h < 8) return (h - 5) / 3;
        if (h > 18) return (21 - h) / 3;
        return 1;
    },

    /** The water's clock (s): the ambient clock when there is one, else the wall clock. */
    _waterFxNow() {
        if (typeof this._ambientT === 'number' && typeof this.tickAmbient === 'function') return this._ambientT;
        return performance.now() / 1000;
    },

    _renderWaterFx(ctx, camera) {
        const cfg = this._waterFxCfg();
        if (!cfg.enabled || InnerMap._insideBuilding) return;
        const rows = this._waterFxCells();
        if (!rows) return;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const origin = camera.worldToScreenFast(qMin * T, rMin * T);
        // The water moves on the ambient clock (innerMapLayers/ambient.js tickAmbient): with
        // the game, standing still while it is paused, like the fires and the smoke
        const now = this._waterFxNow();
        const wx = this._waterFxWeather(cfg);
        const day = this._waterFxDay();
        const refl = this._sheets && this._sheets.get('water_reflections');
        const splash = this._sheets && this._sheets.get('water_splash');
        // Aboard at sea: the water runs past the ship, bow to stern (the helm is aft)
        const L = InnerMap._deck;
        const deck = L && L.helm && L.bow ? { L, flow: L.helm.q >= L.bow.q ? 1 : -1, underway: !!L.underway } : null;
        let S_ = cfg.surf;
        // The water lapping the hull: quicker, shorter waves than surf on a beach
        if (deck) S_ = { ...S_, ...cfg.deck, kinds: S_.kinds, splashKinds: [] };
        const period = S_.period / Math.max(0.2, wx.speed) / (deck && deck.underway ? 1.5 : 1);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        this._drawSwell(ctx, origin, ds, this._frameRange, now, wx, cfg, deck);
        this._drawSurfField(ctx, origin, ds, this._frameRange, now, period, wx, S_);
        if (deck) this._drawWake(ctx, camera, now, wx, cfg, deck);
        for (let r = rMin; r <= rMax; r++) {
            const list = rows.get(r);
            if (!list) continue;
            const row = InnerMap.tiles[r];
            const y0 = origin.y + (r - rMin) * ds;
            for (const cell of list) {
                if (cell.q < qMin || cell.q > qMax) continue;
                const t = row[cell.q];
                if (!t || !t.explored || !t.visible || t.customObject || t.customObjectPart) continue;
                const x0 = origin.x + (cell.q - qMin) * ds;
                if (cell.sides) this._drawSplash(ctx, cell, x0, y0, ds, now, period, wx, S_, splash);
                else if (cell.river) this._drawRiverGlint(ctx, cell, x0, y0, ds, now, cfg, day, refl);
                else if (cell.glint) this._drawGlint(ctx, cell, x0, y0, ds, now, cfg, day, wx, refl);
            }
        }
        ctx.restore();
    },

    /**
     * The pixels of a terrain sheet (to tell water from shore inside a brush
     * cell), or null while it loads — the field is worked out again once it has.
     */
    _waterFxSheet(path) {
        if (!this._waterFxSheets) this._waterFxSheets = new Map();
        const have = this._waterFxSheets.get(path);
        if (have) return have.data ? have : null;
        if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
        const rec = { data: null, w: 0, h: 0, k: 1 };
        this._waterFxSheets.set(path, rec);
        const img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                const g = c.getContext('2d');
                g.drawImage(img, 0, 0);
                rec.data = g.getImageData(0, 0, img.width, img.height).data;
                rec.w = img.width;
                rec.h = img.height;
                // A sheet repainted at more than 32px a cell (the painted terrain is 4×):
                // its 32px cell addresses scale up with it (ui/sheetScale.js)
                rec.k = sheetScale(img);
                // Work the shore out again with the real waterline
                if (this._waterFxFieldCache) this._waterFxFieldCache.pending = true;
            } catch (e) { /* a tainted or missing sheet: the cell outline is used */ }
        };
        img.src = path;
        return null;
    },

    /**
     * Distance to land, in tiles, sampled SUB times per tile across the map
     * (a chamfer distance from the land, so the contours round the corners
     * the way the shore brush does), with each sample's surf strength by its
     * cell's water kind. A ship's hull on the water counts as land, to its
     * own pixels (the water laps it). Cached on the tiles array, and worked
     * out again when a ship moors or casts off (InnerMap._waterStamp).
     */
    _waterFxField() {
        const tiles = InnerMap.tiles;
        const f = this._waterFxFieldCache;
        const stamp = InnerMap._waterStamp || 0;
        if (f && f.tiles === tiles && !f.pending && f.stamp === stamp) return f;
        const cfg = this._waterFxCfg();
        const SUB = Math.max(2, Math.min(16, cfg.surf.sub | 0 || 16));
        const H = tiles.length, Wd = tiles[0].length;
        const w = Wd * SUB, h = H * SUB;
        const dist = new Float32Array(w * h);
        const strength = new Float32Array(Wd * H);
        const INF = 1e9;
        let waiting = false;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < Wd; q++) {
                const t = tiles[r][q];
                const water = _isWater(t);
                // A pier and a deck are neither land nor surf (the water runs under a
                // pier; a ship is land only to its hull's own pixels, _waterFxHulls)
                const land = !water && !(t && (t._pier || t._deck));
                if (water) strength[r * Wd + q] = _num(cfg.surf.kinds[t._waterKind || (t._sea ? 'sea' : 'pond')], 0);
                // A water cell drawn with a shore piece of the brush: its own
                // pixels say where the water is (blue) and where the shore is
                const td = water && t.terrainDetail && t.terrainDetail.layer === 'water' && t.terrainDetail.sheetPath ? t.terrainDetail : null;
                const sheet = td ? this._waterFxSheet(td.sheetPath) : null;
                if (td && !sheet) waiting = true;
                for (let sy = 0; sy < SUB; sy++) {
                    const base = (r * SUB + sy) * w + q * SUB;
                    for (let sx = 0; sx < SUB; sx++) {
                        let v = land ? 0 : INF;
                        if (sheet) {
                            const px = _sheetPx(sheet, td.sx + (sx + 0.5) * (td.sw || 32) / SUB, sheet.w);
                            const py = _sheetPx(sheet, td.sy + (sy + 0.5) * (td.sh || 32) / SUB, sheet.h);
                            const o = (py * sheet.w + px) * 4;
                            const a = sheet.data[o + 3], R = sheet.data[o], G = sheet.data[o + 1], B = sheet.data[o + 2];
                            const blue = a > 128 && B > R + 25 && B >= G - 10;
                            if (!blue) v = 0;
                        }
                        dist[base + sx] = v;
                    }
                }
            }
        }
        // Ships' hulls on the water: land where their tiles are opaque
        if (this._waterFxHulls(tiles, dist, w, SUB)) waiting = true;
        // Two-pass chamfer (1, √2)
        const D2 = Math.SQRT2;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                let d = dist[i];
                if (d === 0) continue;
                if (x > 0) d = Math.min(d, dist[i - 1] + 1);
                if (y > 0) {
                    d = Math.min(d, dist[i - w] + 1);
                    if (x > 0) d = Math.min(d, dist[i - w - 1] + D2);
                    if (x < w - 1) d = Math.min(d, dist[i - w + 1] + D2);
                }
                dist[i] = d;
            }
        }
        for (let y = h - 1; y >= 0; y--) {
            for (let x = w - 1; x >= 0; x--) {
                const i = y * w + x;
                let d = dist[i];
                if (d === 0) continue;
                if (x < w - 1) d = Math.min(d, dist[i + 1] + 1);
                if (y < h - 1) {
                    d = Math.min(d, dist[i + w] + 1);
                    if (x < w - 1) d = Math.min(d, dist[i + w + 1] + D2);
                    if (x > 0) d = Math.min(d, dist[i + w - 1] + D2);
                }
                dist[i] = d;
            }
        }
        // Samples → tiles: land is 0, the first water sample by it half a sample out
        for (let i = 0; i < dist.length; i++) dist[i] = dist[i] >= INF ? 99 : dist[i] === 0 ? 0 : (dist[i] - 0.5) / SUB;
        // Each shore cell's waterline: the middle of its water samples right
        // by the land (where a breaking wave splashes), in tile fractions
        const edge = new Map();
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < Wd; q++) {
                if (!strength[r * Wd + q]) continue;
                let sx = 0, sy = 0, n = 0;
                for (let y = 0; y < SUB; y++) {
                    for (let x = 0; x < SUB; x++) {
                        const d = dist[(r * SUB + y) * w + q * SUB + x];
                        if (d > 0 && d < 1.6 / SUB) { sx += x + 0.5; sy += y + 0.5; n++; }
                    }
                }
                if (n) edge.set(r * Wd + q, [sx / n / SUB, sy / n / SUB]);
            }
        }
        const prev = this._waterFxFieldCache;
        this._waterFxFieldCache = { tiles, SUB, w, h, Wd, H, dist, strength, edge, img: null, canvas: prev && prev.canvas || null, pending: false, waiting, stamp };
        return this._waterFxFieldCache;
    },

    /**
     * The surf, for the tiles on screen: each sample of shore water lights up
     * where the incoming wave's line (its distance from land) passes it, a
     * pale wash behind it to the waterline, a faint lace along the waterline.
     * Written into a small offscreen image at SUB pixels a tile, then drawn
     * up to the view unsmoothed (pixel art).
     */
    _drawSurfField(ctx, origin, ds, range, now, period, wx, S_) {
        const F = this._waterFxField();
        const { qMin, qMax, rMin, rMax } = range;
        const cols = qMax - qMin + 1, rowsN = rMax - rMin + 1;
        if (cols <= 0 || rowsN <= 0) return;
        const SUB = F.SUB;
        const iw = cols * SUB, ih = rowsN * SUB;
        if (!F.canvas) F.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
        const g2 = F.canvas && F.canvas.getContext ? F.canvas.getContext('2d') : null;
        // (no real canvas: a headless run)
        if (!g2 || typeof g2.createImageData !== 'function' || typeof g2.putImageData !== 'function') return;
        if (F.canvas.width !== iw || F.canvas.height !== ih || !F.img) {
            F.canvas.width = iw; F.canvas.height = ih;
            F.img = g2.createImageData(iw, ih);
        }
        const data = F.img.data;
        data.fill(0);
        const from = S_.from * wx.reach;
        const to = S_.to / Math.max(0.7, wx.reach);
        const band = Math.max(0.05, S_.thick * (wx.reach > 1.1 ? 1.4 : 1));
        const reachMax = from + band + 0.1;
        const inShare = S_.inShare;
        const foam = _rgb(S_.foam), wash = _rgb(S_.wash);
        const fa = S_.alpha, wa = S_.washAlpha;
        const roll = S_.roll;
        const gap = S_.gap;
        let any = false;
        for (let r = rMin; r <= rMax; r++) {
            const row = InnerMap.tiles[r];
            for (let q = qMin; q <= qMax; q++) {
                const st = F.strength[r * F.Wd + q];
                if (!st) continue;
                const t = row[q];
                // (a hull cell too: the foam laps under the hull, drawn over it)
                if (!t.explored || !t.visible) continue;
                // Skip open water far from any shore (cheap test on the cell's middle sample)
                const mid = (r * SUB + (SUB >> 1)) * F.w + q * SUB + (SUB >> 1);
                if (F.dist[mid] > reachMax + 1) continue;
                // Each wave a little out of step with the next: a phase offset hashed at the
                // tile corners and blended across the tile, so there is no seam at its edges
                const h00 = _hash(q, r, 7) * 0.12, h10 = _hash(q + 1, r, 7) * 0.12;
                const h01 = _hash(q, r + 1, 7) * 0.12, h11 = _hash(q + 1, r + 1, 7) * 0.12;
                for (let sy = 0; sy < SUB; sy++) {
                    const gy = r * SUB + sy;
                    const oy = (r - rMin) * SUB + sy;
                    const fy = _smooth((sy + 0.5) / SUB);
                    const hl = h00 + (h01 - h00) * fy, hr = h10 + (h11 - h10) * fy;
                    for (let sx = 0; sx < SUB; sx++) {
                        const gx = q * SUB + sx;
                        const d = F.dist[gy * F.w + gx];
                        if (d > reachMax || d <= 0) continue;
                        // The wave rolls along the beach: its phase shifts with position
                        const p = now / period + (gx + gy) / SUB * roll + hl + (hr - hl) * _smooth((sx + 0.5) / SUB);
                        const ph = p - Math.floor(p);
                        let line, a;
                        if (ph < inShare) {
                            const k = ph / inShare;
                            const ease = 1 - (1 - k) * (1 - k);
                            line = from + (to - from) * ease;
                            a = 0.3 + 0.7 * ease;
                        } else {
                            const k = (ph - inShare) / (1 - inShare);
                            line = to + k * 0.2;
                            a = 1 - k;
                        }
                        a *= st;
                        let cr = 0, cg = 0, cb = 0, alpha = 0;
                        const off = Math.abs(d - line);
                        if (off < band && d >= to * 0.8) {
                            // Foam, broken up: each wave its own gaps
                            const g = _hash(gx >> 1, gy >> 1, Math.floor(p));
                            if (g >= gap) { cr = foam[0]; cg = foam[1]; cb = foam[2]; alpha = a * fa * (1 - off / band * 0.5); }
                        }
                        if (!alpha && d >= to && d < line) { cr = wash[0]; cg = wash[1]; cb = wash[2]; alpha = a * wa; }
                        // The lace at the waterline, always a little
                        if (!alpha && Math.abs(d - to) < band * 0.6) {
                            const g = _hash(gx, gy, 3);
                            if (g > 0.45) { cr = foam[0]; cg = foam[1]; cb = foam[2]; alpha = 0.22 * st; }
                        }
                        if (alpha <= 0.02) continue;
                        const o = (oy * iw + (q - qMin) * SUB + sx) * 4;
                        data[o] = cr; data[o + 1] = cg; data[o + 2] = cb; data[o + 3] = Math.min(255, alpha * 255);
                        any = true;
                    }
                }
            }
        }
        if (!any) return;
        g2.putImageData(F.img, 0, 0);
        // Drawn up smoothed: soft foam over the painted water, not a staircase of blocks
        const smoothWas = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = S_.smooth !== false;
        ctx.drawImage(F.canvas, 0, 0, iw, ih, Math.round(origin.x), Math.round(origin.y), Math.round(cols * ds), Math.round(rowsN * ds));
        ctx.imageSmoothingEnabled = smoothWas;
    },

    /**
     * Mark the samples a ship's hull covers as land (its tiles' opaque
     * pixels), for every hull (`hull_*` objects) on the map. → true while a
     * sheet is still loading.
     */
    _waterFxHulls(tiles, dist, w, SUB) {
        let waiting = false;
        const H = tiles.length, Wd = tiles[0].length;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < Wd; q++) {
                const o = tiles[r][q].customObject;
                if (!o || !/^hull_/.test(o.defId || '')) continue;
                const def = CustomObjects.getDef(o.defId);
                if (!def || !Array.isArray(def.tiles)) continue;
                // Only where the hull meets the water: the ship is drawn from
                // the side, so that is the lowest rows of its footprint in each
                // column (masts, sails, the deck and the far rail stand up over
                // the sea behind it, and get no foam)
                const foot = (def.meta || []).filter(m => m.hull);
                const low = new Map();
                for (const m of foot) low.set(m.localCol, Math.max(low.has(m.localCol) ? low.get(m.localCol) : -1e9, m.localRow));
                const rowsDeep = Math.max(1, _num(this._waterFxCfg().deck.hullRows, 2));
                const hull = new Set(foot.filter(m => m.localRow > low.get(m.localCol) - rowsDeep).map(m => `${m.localCol},${m.localRow}`));
                for (const tl of def.tiles) {
                    if (hull.size && !hull.has(`${tl.localCol || 0},${tl.localRow || 0}`)) continue;
                    const cq = q + (tl.localCol || 0), cr = r + (tl.localRow || 0);
                    if (cq < 0 || cr < 0 || cq >= Wd || cr >= H || !tl.sheetPath) continue;
                    const sheet = this._waterFxSheet(tl.sheetPath);
                    if (!sheet) { waiting = true; continue; }
                    const sw = tl.sw || 32, sh = tl.sh || 32;
                    for (let sy = 0; sy < SUB; sy++) {
                        const py = _sheetPx(sheet, tl.sy + (sy + 0.5) * sh / SUB, sheet.h);
                        const base = (cr * SUB + sy) * w + cq * SUB;
                        for (let sx = 0; sx < SUB; sx++) {
                            const px = _sheetPx(sheet, tl.sx + (sx + 0.5) * sw / SUB, sheet.w);
                            if (sheet.data[(py * sheet.w + px) * 4 + 3] > 128) dist[base + sx] = 0;
                        }
                    }
                }
            }
        }
        return waiting;
    },

    /**
     * The swell on open water: crests (short pale arcs) travelling over the
     * sea — toward the shore on a coast, past the ship when aboard (faster
     * under way). Every visible open-water cell, hashed so some carry none.
     */
    _drawSwell(ctx, origin, ds, range, now, wx, cfg, deck) {
        const F = this._waterFxField();
        const SW = cfg.swell;
        if (!SW || !SW.enabled) return;
        const { qMin, qMax, rMin, rMax } = range;
        const px = Math.max(2, Math.round(ds / 16)); // two art pixels
        const lam = Math.max(1, SW.wavelength);
        const speed = (SW.speed + (deck && deck.underway ? SW.underway : 0)) * wx.speed;
        const mid = F.SUB >> 1;
        const dAt = (q, r) => (q < 0 || r < 0 || q >= F.Wd || r >= F.H ? 99 : F.dist[(r * F.SUB + mid) * F.w + q * F.SUB + mid]);
        ctx.fillStyle = SW.color;
        for (let r = rMin; r <= rMax; r++) {
            const row = InnerMap.tiles[r];
            for (let q = qMin; q <= qMax; q++) {
                const st = F.strength[r * F.Wd + q];
                if (!st) continue;
                const t = row[q];
                if (!t.explored || !t.visible || t.customObjectPart || t.customObject) continue;
                if ((t._waterKind || 'sea') === 'river' || t._waterKind === 'pond') continue;
                const d = dAt(q, r);
                if (d < SW.minDist) continue;
                const h = _hash(q, r, 11);
                if (h > SW.density) continue;
                // Which way: past the ship (bow → stern) aboard; else down the slope of the distance to land
                let ux, uy;
                if (deck) { ux = deck.flow; uy = 0; } else {
                    const gx = dAt(q + 1, r) - dAt(q - 1, r), gy = dAt(q, r + 1) - dAt(q, r - 1);
                    if (d > 40 || (!gx && !gy)) continue;
                    if (Math.abs(gx) >= Math.abs(gy)) { ux = gx > 0 ? -1 : 1; uy = 0; } else { ux = 0; uy = gy > 0 ? -1 : 1; }
                }
                const p = now * speed / lam - (q * ux + r * uy) / lam + h * 0.37;
                const k = p - Math.floor(p);
                const show = SW.crest;
                if (k > show) continue;
                const f = k / show;
                const a = Math.sin(f * Math.PI) * SW.alpha * (0.6 + 0.4 * st);
                if (a <= 0.03) continue;
                ctx.globalAlpha = a;
                const x0 = origin.x + (q - qMin) * ds, y0 = origin.y + (r - rMin) * ds;
                // Centre of the crest, carried across the cell along the travel
                const cx = x0 + ds / 2 + ux * (f - 0.5) * ds * 0.9 + (h - 0.5) * ds * 0.4 * uy;
                const cy = y0 + ds / 2 + uy * (f - 0.5) * ds * 0.9 + (h - 0.5) * ds * 0.4 * ux;
                const len = Math.round(ds * SW.length * (0.6 + h * 0.8));
                // A little arc, ︵, the way pixel-art seas are drawn: whichever
                // way it travels, a crest reads as a ridge seen from above the shore
                const x = Math.round(cx - len / 2), y = Math.round(cy);
                ctx.fillRect(x + Math.round(len * 0.2), y, Math.round(len * 0.6), px);
                ctx.fillRect(x, y + px, Math.round(len * 0.2), px);
                ctx.fillRect(x + Math.round(len * 0.8), y + px, Math.round(len * 0.2), px);
            }
        }
        ctx.globalAlpha = 1;
    },

    /**
     * Aboard and under way: the bow wave peeling off both sides of the stem,
     * and the wake spreading behind the stern. `deck` = { L, flow, underway }.
     */
    _drawWake(ctx, camera, now, wx, cfg, deck) {
        const WK = cfg.wake;
        const L = deck && deck.L;
        if (!WK || !WK.enabled || !L || !deck.underway) return;
        const T = this.TILE_SIZE;
        const z = camera.zoom;
        const ds = T * z;
        const px = Math.max(2, Math.round(ds / 16));
        const flow = deck.flow; // water runs this way along x (bow → stern)
        // The hull's own extent: the ship is anchored bottom-left, its footprint
        // rising from the anchor row, so the waterline is the anchor row's foot
        const def = L.defId ? CustomObjects.getDef(L.defId) : null;
        const foot = def && def.meta ? def.meta.filter(m => m.hull) : [];
        if (!foot.length || !L.anchor) return;
        // (the bottom row: where the hull is in the water — not the bowsprit over it)
        const bottom = Math.max(...foot.map(m => m.localRow));
        const keel = foot.filter(m => m.localRow === bottom);
        const c0 = Math.min(...keel.map(m => m.localCol)), c1 = Math.max(...keel.map(m => m.localCol)) + 1;
        const wl = L.anchor.r + 1 - WK.waterRise; // the waterline, a little up the hull's bottom row
        const bowX = flow > 0 ? L.anchor.q + c0 + WK.bowPad : L.anchor.q + c1 - WK.bowPad;
        const sternX = flow > 0 ? L.anchor.q + c1 - WK.sternPad : L.anchor.q + c0 + WK.sternPad;
        const at = (x, y) => camera.worldToScreenFast(x * T, y * T);
        const rate = WK.rate * wx.speed;
        ctx.fillStyle = WK.foam;
        // The bow wave: water thrown off the stem and running back along the side, curling out
        for (let i = 0; i < WK.bowCount; i++) {
            const s = _frac(now * rate * 1.3 + i / WK.bowCount);
            const j = _hash(i, 3, 5);
            const x = bowX + flow * (s * WK.bowLength - 0.3) + (j - 0.5) * 0.25;
            // out from the hull as it goes, and up and down a little (spray at the stem)
            const y = wl + s * WK.bowSpread + (j - 0.5) * 0.35 - (s < 0.15 ? (0.15 - s) * 4 * j : 0);
            const p = at(x, y);
            ctx.globalAlpha = WK.alpha * (1 - s) * (0.6 + 0.4 * j);
            const sz = px * (s < 0.25 ? 2 : 1.5);
            ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.round(sz * 1.5), Math.round(sz));
        }
        // The wake: two arms spreading out behind the stern, churned water between them
        for (let i = 0; i < WK.wakeCount; i++) {
            const s = _frac(now * rate + i / WK.wakeCount);
            const j = _hash(i, 9, 2);
            const arm = i % 3; // 0, 1: the arms; 2: the churn down the middle
            const x = sternX + flow * (s * WK.wakeLength + 0.2) + (j - 0.5) * 0.3;
            const half = s * WK.wakeLength * WK.wakeAngle;
            const y = wl - WK.wakeRise + (arm === 2 ? (j - 0.5) * (0.4 + s * 0.8) : (arm ? 1 : -1) * (0.3 + half));
            const p = at(x, y);
            ctx.globalAlpha = WK.alpha * (1 - s) * (arm === 2 ? 0.55 : 0.9) * (0.6 + 0.4 * j);
            ctx.fillRect(Math.round(p.x), Math.round(p.y), arm === 2 ? px * 3 : px * 2, arm === 2 ? px : Math.round(px * 1.5));
        }
        ctx.globalAlpha = 1;
    },

    /** Now and then a wave breaks in a splash where it meets the land (a shore cell). */
    _drawSplash(ctx, cell, x0, y0, ds, now, period, wx, S_, splash) {
        if (!splash || !S_.splashKinds.includes(cell.kind)) return;
        const p = now / period + (cell.q + cell.r) * S_.roll + cell.h * 0.12;
        const ph = p - Math.floor(p);
        const start = S_.inShare * 0.85;
        if (ph < start) return;
        const every = Math.max(1, Math.round(S_.splashEvery / Math.max(0.2, wx.splash)));
        if (_hash(cell.q, cell.r, Math.floor(p)) >= 1 / every) return;
        // On this cell's waterline (where the shore art meets the water)
        const F = this._waterFxField();
        const at = F.edge && F.edge.get(cell.r * F.Wd + cell.q);
        if (!at) return;
        const k = (ph - start) / (1 - start);
        const frame = Math.min(5, Math.floor(k * 6));
        const sw = ds * 2, sh = ds;
        // (the splash sits at the bottom of its 64×32 frame)
        const sx = x0 + at[0] * ds - sw / 2;
        const sy = y0 + at[1] * ds - sh * 0.85;
        ctx.globalAlpha = Math.min(1, 0.9 * cell.strength);
        ctx.drawImage(splash, frame * 64, 0, 64, 32, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh));
        ctx.globalAlpha = 1;
    },

    /** Sun on open water: a sparkle that flashes through its four frames, then rests. Ripple rings on ponds. */
    _drawGlint(ctx, cell, x0, y0, ds, now, cfg, day, wx, refl) {
        if (!refl) return;
        const G = cfg.glint;
        const [c0, c1] = Array.isArray(G.cycle) ? G.cycle : [4, 6];
        const cycle = c0 + (c1 - c0) * cell.h;
        const t = _frac(now / cycle + cell.h * 3.7) * cycle;
        const frames = 4;
        const show = frames / Math.max(1, G.fps);
        if (t > show) return;
        const frame = Math.min(frames - 1, Math.floor(t * G.fps));
        const rowY = cell.ripple ? 64 : (cell.h * 997) % 1 < 0.35 ? 0 : 32;
        const light = cell.ripple ? 1 : G.nightAlpha + (1 - G.nightAlpha) * day;
        ctx.globalAlpha = G.alpha * light * (cell.ripple ? 1 : wx.glint);
        if (ctx.globalAlpha <= 0.02) { ctx.globalAlpha = 1; return; }
        ctx.drawImage(refl, frame * 32, rowY, 32, 32, Math.round(x0), Math.round(y0), Math.ceil(ds), Math.ceil(ds));
        ctx.globalAlpha = 1;
    },

    /** The river runs: a small sparkle drifting downstream through its cell. */
    _drawRiverGlint(ctx, cell, x0, y0, ds, now, cfg, day, refl) {
        if (!refl) return;
        const R = cfg.river;
        const k = _frac(now * R.speed / 1.5 + cell.h * 5.3);
        // Drift a tile and a half along the flow, fading in and out
        const off = (k - 0.5) * 1.5 * ds;
        const fade = Math.sin(k * Math.PI);
        const frame = Math.floor(_frac(now * 1.3 + cell.h) * 4);
        ctx.globalAlpha = R.alpha * fade * (cfg.glint.nightAlpha + (1 - cfg.glint.nightAlpha) * day);
        if (ctx.globalAlpha > 0.02) {
            ctx.drawImage(refl, frame * 32, 32, 32, 32, Math.round(x0 + cell.fx * off), Math.round(y0 + cell.fy * off), Math.ceil(ds), Math.ceil(ds));
        }
        ctx.globalAlpha = 1;
    },
});

/** A 32px-cell address (fractional) → the pixel in a sheet scaled by sheet.k, kept on the sheet */
function _sheetPx(sheet, v, size) {
    const p = Math.floor(v * (sheet.k || 1));
    return Math.max(0, Math.min((size || 1) - 1, p));
}

function _smooth(k) { return k * k * (3 - 2 * k); }

function _num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

function _rgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    const n = m ? parseInt(m[1], 16) : 0xffffff;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

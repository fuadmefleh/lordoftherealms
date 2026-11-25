// InnerMapRenderer — the season on the street map (mixed in via Object.assign).
//
// What the day's season has done to the ground (world/streetSeasons.js, laid
// on the map by world/innerMap/streetSeasons.js) drawn as pixel-art dabs at
// the LPC grid's own pixel (a cell is 32 of them):
//
//   • _renderSeasonGround — drawn into the ground cache's chunks with the rest
//     of the ground (innerMapLayers/groundCache.js keys them on
//     InnerMap._ssKey, so a new day's ground is drawn once, not every frame):
//     a dusting of snow over ground not yet white (or what is left in the
//     thaw), snow banks shovelled up either side of the streets, slush and
//     puddles, mud and ruts on the unpaved ground after rain, autumn leaves,
//     thin ice (darker, cracked) and the hole where it gave way.
//   • _iceDetail — frozen water drawn from the ice sheet (terrain_winter_ice.png:
//     the terrain sheet's layout with the water frozen; terrainRoads.js asks).
//   • _renderSeasonFx (after the water's play) — footprints in the snow and the
//     mud behind everyone walking, the snowmen.
//   • _renderSeasonAir (after the smoke) — leaves drifting down in autumn, the
//     fiddler's notes at the harvest fair.
//   • _seasonRoofSnow — snow lying on the roofs, drawn into each building's
//     kept canvas (objectsBuildings.js keys it on the snow's level).
//
// No state but the footprints (a fixed ring, nothing allocated a frame) and a
// few small sprites made once. Only the cells on screen are visited.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { hh, blob, run, dot, placeIn, puddle, rut } from './groundMarks.js';

const ICE_SHEET = 'assets/lpc/Terrain/terrain_winter_ice.png';
const SEASON_SHEET = /assets\/lpc\/Terrain\/terrain_(spring|summer|autumn|winter)\.png$/;

// Leaves: autumn reds, oranges, golds and browns; a bare winter's are browner
const LEAVES = ['#c4512b', '#db842c', '#e6b53d', '#9a3d1c', '#b8702e', '#d9a441'];
const LEAVES_OLD = ['#7a5232', '#8c6a3f', '#6b4a2c', '#9a7a4a'];
// What a building cell IS, by its sheet (the kit files cells by drawing order, not by what
// they are: a design's roof sits in its "floor" layer with the wall faces, its door in the
// "roof" layer). A roof is a kit roof sheet (assets/buildingKit/modern/roofs_*.png: thatch,
// shingle, slate, clay, turf, adobe, flat) or a sheet of the LPC Roofing set (its roofs,
// trim and chimneys); doors, windows and wall faces never are, whatever their sheet's name.
const ROOF_SHEET = /\/roofs_[^/]*$|\/Roofing\//i;
const NOT_ROOF = /\/Doors\/|\/Windows\/|walls_|\/Walls?\//i;
const LAYERS = ['floor', 'walls', 'roof', 'overlay'];
/** Is this building cell roofing (snow lies on it)? */
export function isRoofCell(cell) {
    const p = (cell && cell.sheetPath) || '';
    return ROOF_SHEET.test(p) && !NOT_ROOF.test(p);
}
// A design's roofing cells, each left in its own layer so they draw in the order they were
// drawn (a chimney over its roof): { floor, walls, roof, overlay } or null; made once a design
const _roofOf = new WeakMap();
export function roofLayers(def) {
    if (!def || !def.layers) return null;
    if (_roofOf.has(def)) return _roofOf.get(def);
    const out = {};
    let n = 0;
    for (const lyr of LAYERS) {
        const cells = (def.layers[lyr] || []).filter(isRoofCell);
        out[lyr] = cells;
        n += cells.length;
    }
    const res = n ? out : null;
    _roofOf.set(def, res);
    return res;
}
const SNOW = '#eef3f8', SNOW_SHADE = '#c3d1df', SNOW_GRAIN = 'rgba(240, 245, 250, 0.85)';
const MUD = 'rgba(72, 50, 30, ';

// The footprints: a ring of [x, y, born, dir, kind] (kind 0 snow, 1 mud)
const PRINTS = 260;
const _prints = new Float32Array(PRINTS * 5);
let _printN = 0;
const PRINT_LIFE = 50;   // seconds on the ambient clock
// their colours fading, in steps (no string made a frame)
const FADE = 8;
const PRINT_SNOW = Array.from({ length: FADE + 1 }, (_, i) => `rgba(120, 145, 175, ${(0.55 * i / FADE).toFixed(3)})`);
const PRINT_MUD = Array.from({ length: FADE + 1 }, (_, i) => `rgba(48, 32, 18, ${(0.5 * i / FADE).toFixed(3)})`);

function _canvas(w, h) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

/** Is this cell open ground snow lies on (not a street, water, a building)? */
function _snowGround(t) {
    return !!(t && !t.isRoad && !t.paving && !t._pave && !t._wet && !t._iced && !t._isInterior
        && !t.building && !t.customBuilding && !t.customBuildingPart && !t._deck && !t._pier && !t._bridge);
}
/** A street cleared of snow (a road or paving). */
function _street(t) {
    return !!(t && (t.isRoad || t.paving || t._pave) && !t._wet);
}
/** Bare earth that goes to mud: an unpaved road, tilled or trodden soil, never grass (world/innerMap/streetSeasons.js). */
function _soft(t) {
    return !!(InnerMap._bareEarth && InnerMap._bareEarth(t));
}
/**
 * Is this cell in the shade of something standing by it (where snow lingers longest)?
 * The north side of a house or wall (the cell above it), or beside a fence, a stack, a tree.
 */
function _shaded(at, q, r) {
    const house = n => !!(n && (n.building || n.customBuilding || n.customBuildingPart));
    // (a town's field is a prop too, but lies flat: no shade)
    const stands = n => !!(n && (n.customObject || n.customObjectPart) && !n._fieldSoil);
    return house(at(q, r + 1)) || house(at(q, r + 2)) || stands(at(q, r + 1)) || stands(at(q - 1, r)) || stands(at(q + 1, r));
}

Object.assign(InnerMapRenderer, {
    _ssIceOv: null,

    /** The same detail piece from the ice sheet, for frozen water (null-safe: the piece itself when it has none). */
    _iceDetail(ov) {
        if (!ov || !ov.sheetPath || !SEASON_SHEET.test(ov.sheetPath)) return ov;
        const memo = this._ssIceOv || (this._ssIceOv = new WeakMap());
        let iv = memo.get(ov);
        if (!iv) {
            const sx = Number.isFinite(ov.sx) ? ov.sx : 0, sy = Number.isFinite(ov.sy) ? ov.sy : 0;
            // (the deep water's block, rows 23-25, is still dark water on the ice sheet: the open ice in its place)
            const deep = sy >= 23 * 32 && sy < 26 * 32 && sx < 5 * 32;
            iv = { sheetPath: ICE_SHEET, sx: deep ? 32 : sx, sy: deep ? 11 * 32 : sy, sw: ov.sw, sh: ov.sh };
            memo.set(ov, iv);
        }
        return iv;
    },

    // ══════════════════════════════════════════════
    // THE GROUND (into the ground cache)
    // ══════════════════════════════════════════════

    /**
     * The thin ice of this map as a small canvas, a pixel a cell (the darker wash where
     * the ice is thin, clear elsewhere), kept until the thin cells change. → canvas or null
     */
    _thinIceWash(tiles) {
        if (typeof document === 'undefined' || !tiles || !tiles.length) return null;
        const H = tiles.length, W = tiles[0].length;
        let n = 0, sig = 0;
        for (let r = 0; r < H; r++) {
            const row = tiles[r];
            for (let q = 0; q < W; q++) if (row[q] && row[q]._iced === 1) { n++; sig = (sig + (r * W + q) * 2654435761) >>> 0; }
        }
        const C = this._thinWash || (this._thinWash = { tiles: null, n: -1, sig: -1, canvas: null });
        if (C.tiles === tiles && C.n === n && C.sig === sig) return n ? C.canvas : null;
        C.tiles = tiles; C.n = n; C.sig = sig;
        if (!n) return null;
        const c = C.canvas && C.canvas.width === W && C.canvas.height === H ? C.canvas : document.createElement('canvas');
        c.width = W; c.height = H;
        // (setting the width above cleared it)
        const g = c.getContext && c.getContext('2d');
        if (!g || typeof g.fillRect !== 'function') return null;
        g.fillStyle = 'rgba(30, 84, 118, 0.34)';
        for (let r = 0; r < H; r++) {
            const row = tiles[r];
            for (let q = 0; q < W; q++) if (row[q] && row[q]._iced === 1) g.fillRect(q, r, 1, 1);
        }
        C.canvas = c;
        return c;
    },

    _renderSeasonGround(ctx, camera) {
        const ss = InnerMap._ss;
        if (!ss || InnerMap._insideBuilding || !InnerMap.tiles) return;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        // one of the sheet's pixels on the screen (the dabs are drawn two of them square)
        const px = ds / 32;
        const p = Math.max(1, Math.round(px * 2));
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const tiles = InnerMap.tiles;
        const origin = camera.worldToScreenFast(qMin * T, rMin * T);
        const ox = origin.x, oy = origin.y;
        const sz = Math.ceil(ds) + 1;
        const dust = ss.dust || 0;
        const thaw = !ss.winterLook && ss.season === 'Spring';
        const banks = !!ss.banks;
        const mud = ss.mudShow || 0;
        const puddlesAt = 0.45;
        const leaves = ss.leavesShow || 0;
        const oldLeaves = ss.season === 'Winter';
        const slush = ss.slush || 0;
        const wetStreets = ss.raining || slush > 0.2;
        const at = (q, r) => (tiles[r] ? tiles[r][q] : null);
        // (the colours worked out once a pass, not a cell)
        const mudRim = MUD + (0.14 + mud * 0.16).toFixed(3) + ')';
        const mudCore = 'rgba(40, 26, 14, ' + (0.16 + mud * 0.22).toFixed(3) + ')';
        const mudShine = 'rgba(196, 190, 172, ' + (0.12 + mud * 0.18).toFixed(3) + ')';
        const mudShare = 0.12 + mud * 0.4;
        const rutFill = 'rgba(52, 34, 18, ' + Math.min(0.34, 0.1 + mud * 0.24).toFixed(3) + ')';
        const rutLip = 'rgba(214, 184, 136, ' + Math.min(0.26, 0.06 + mud * 0.18).toFixed(3) + ')';
        const slushFill = ss.winterLook ? 'rgba(150, 140, 128, 0.32)' : 'rgba(60, 70, 80, 0.2)';
        // Thin ice: one soft wash for the whole view (a cell a pixel, scaled up smoothly), so a
        // patch of thin ice fades into the solid round it instead of standing as squares
        const wash = this._thinIceWash(tiles);
        if (wash) {
            const w = qMax - qMin + 1, h = rMax - rMin + 1;
            const sq = Math.max(0, qMin), sr = Math.max(0, rMin);
            const ew = Math.min(wash.width, qMax + 1) - sq, eh = Math.min(wash.height, rMax + 1) - sr;
            if (w > 0 && h > 0 && ew > 0 && eh > 0) {
                ctx.save();
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(wash, sq, sr, ew, eh, ox + (sq - qMin) * ds, oy + (sr - rMin) * ds, ew * ds, eh * ds);
                ctx.restore();
            }
        }

        for (let r = rMin; r <= rMax; r++) {
            const row = tiles[r];
            if (!row) continue;
            const y = Math.floor(oy + (r - rMin) * ds);
            for (let q = qMin; q <= qMax; q++) {
                const t = row[q];
                if (!t || !t.explored || t._isInterior) continue;
                const x = Math.floor(ox + (q - qMin) * ds);

                // ── Ice: thin ice darker and cracked; the hole where it broke ──
                if (t._iced === 1) {
                    this._ssCrack(ctx, x, y, ds, p, q, r, 'rgba(22, 58, 84, 0.6)', 'rgba(235, 248, 255, 0.55)');
                    continue;
                }
                if (t._iced === 2) {
                    if (hh(q, r, 9) < 0.14) this._ssCrack(ctx, x, y, ds, p, q, r, 'rgba(120, 165, 190, 0.45)', 'rgba(255, 255, 255, 0.6)');
                    continue;
                }
                if (t._ssHole != null && t._wet) {
                    this._ssHoleRim(ctx, x, y, ds, p, q, r, at);
                    continue;
                }

                // ── Snow banks shovelled up the sides of a cleared street ──
                if (banks && _street(t)) {
                    const depth = (2 + Math.round(ss.snow * 4)) * p;
                    if (_snowGround(at(q, r - 1))) this._ssBank(ctx, x, y, sz, depth, p, q, r, 0);
                    if (_snowGround(at(q, r + 1))) this._ssBank(ctx, x, y, sz, depth, p, q, r, 2);
                    if (_snowGround(at(q - 1, r))) this._ssBank(ctx, x, y, sz, depth, p, q, r, 1);
                    if (_snowGround(at(q + 1, r))) this._ssBank(ctx, x, y, sz, depth, p, q, r, 3);
                }
                // ── Slush trodden on the streets, puddles on the paving in the rain ──
                if (_street(t) && (wetStreets || (ss.winterLook && ss.snowing))) {
                    if (hh(q, r, 3) < 0.45) {
                        const w = 4 + Math.floor(hh(q, r, 10) * 6), h = 2 + Math.floor(hh(q, r, 11) * 2);
                        const [cx, cy] = placeIn(w, h, q, r, 12);
                        ctx.fillStyle = slushFill;
                        blob(ctx, x, y, px, cx, cy, w, h, q, r, 13);
                    }
                    if ((t.paving || t._pave) && ss.raining && hh(q, r, 4) < 0.18) this._ssPuddle(ctx, x, y, px, q, r, 0.7);
                }

                // ── Snow lying on in patches: a dusting not yet white, or what the thaw has left in the shade ──
                if (dust > 0 && _snowGround(t)) {
                    const shade = _shaded(at, q, r);
                    // (a few patches about the place, most of them in the lee of walls and fences)
                    const share = (thaw ? dust * (shade ? 0.7 : 0.12) : dust * (shade ? 0.6 : 0.14)) * (t._fieldSoil ? 0.6 : 1);
                    if (hh(q, r, 40) < share) {
                        const big = shade ? 1.25 : 1;
                        const w = Math.round((4 + hh(q, r, 41) * 5 + dust * 3) * big), h = Math.max(2, Math.round(w * (0.4 + hh(q, r, 42) * 0.15)));
                        // (in the shade: tucked against the foot of what casts it)
                        const ww = Math.round(w * 1.4) + 1;
                        const [cx, cy] = shade ? [1 + ww / 2 + hh(q, r, 43) * Math.max(0, 30 - ww), 29 - h / 2 - hh(q, r, 44) * 5] : placeIn(ww, h + 2, q, r, 43);
                        this._ssSnowPatch(ctx, x, y, px, cx, cy, w, h, q, r, thaw);
                    }
                    // the dusting's grains: single pixels caught in the grass
                    if (!thaw && dust > 0.2) {
                        ctx.fillStyle = SNOW_GRAIN;
                        const n = Math.floor(dust * 9 * (0.3 + hh(q, r, 45) * 0.7));
                        for (let i = 0; i < n; i++) dot(ctx, x, y, px, Math.floor(hh(q, r, 46 + i) * 30) + 1, Math.floor(hh(q, r, 56 + i) * 30) + 1);
                    }
                    // meltwater standing on the bare earth (never a pool on the grass)
                    if (thaw && slush > 0.05 && _soft(t) && hh(q, r, 5) < slush * 0.2) this._ssPuddle(ctx, x, y, px, q, r, 0.8);
                }

                // ── Mud on the bare earth after rain: dark wet patches, the wheels' ruts, puddles ──
                if (mud > 0 && _soft(t)) {
                    if (hh(q, r, 90) < mudShare) {
                        const w = Math.round(8 + hh(q, r, 91) * 10 + mud * 4), h = Math.max(3, Math.round(w * (0.36 + hh(q, r, 92) * 0.16)));
                        const [cx, cy] = placeIn(Math.round(w * 1.35) + 1, h + 1, q, r, 93);
                        // the wet ground spreading off one side, the core darker where it lies deepest
                        const side = hh(q, r, 97) < 0.5 ? -1 : 1;
                        ctx.fillStyle = mudRim;
                        blob(ctx, x, y, px, cx, cy, w, h, q, r, 94, cx + side * w * 0.38, cy + (hh(q, r, 98) - 0.5) * h * 0.6, Math.round(w * 0.5), Math.max(2, h - 1));
                        ctx.fillStyle = mudCore;
                        blob(ctx, x, y, px, cx + (hh(q, r, 95) - 0.5) * 2, cy, Math.max(3, w - 5), Math.max(2, h - 2), q, r, 96);
                        if (mud > 0.5) { ctx.fillStyle = mudShine; run(ctx, x, y, px, cx - w * 0.15, Math.round(cy - h / 2) + 1, Math.max(2, Math.round(w * 0.22))); }
                    }
                    if (t.isRoad && mud > 0.3) {
                        // The wheels' two ruts along the road's run (one apiece on a road two cells wide)
                        // (only down a lane one or two cells wide: never criss-crossing a square or a yard)
                        const roadAt = (dq, dr) => { const n = at(q + dq, r + dr); return !!(n && n.isRoad && !n._wet); };
                        const laneOf = (horiz) => {
                            const runs = horiz ? roadAt(-1, 0) || roadAt(1, 0) : roadAt(0, -1) || roadAt(0, 1);
                            const lo = horiz ? roadAt(0, -1) : roadAt(-1, 0), hi = horiz ? roadAt(0, 1) : roadAt(1, 0);
                            if (!runs || (lo && hi)) return 0;
                            if (hi) return horiz ? (roadAt(0, 2) ? 0 : 2) : (roadAt(2, 0) ? 0 : 2);
                            if (lo) return horiz ? (roadAt(0, -2) ? 0 : 3) : (roadAt(-2, 0) ? 0 : 3);
                            return 1;
                        };
                        const ewL = laneOf(true), nsL = laneOf(false);
                        if ((ewL > 0) !== (nsL > 0)) {
                            const along = ewL > 0, kind = ewL || nsL;
                            // one cell wide: both wheels; two: the one wheel nearer the middle of the road
                            if (kind === 1) { rut(ctx, x, y, px, q, r, along, 10, 3, rutFill, rutLip); rut(ctx, x, y, px, q, r, along, 21, 8, rutFill, rutLip); }
                            else rut(ctx, x, y, px, q, r, along, kind === 2 ? 24 : 7, kind === 2 ? 3 : 8, rutFill, rutLip);
                        }
                    }
                    if (mud >= puddlesAt && hh(q, r, 7) < (mud - 0.35) * 0.3) this._ssPuddle(ctx, x, y, px, q, r, 1);
                }

                // ── Autumn leaves lying ──
                if (leaves > 0 && dust < 0.6 && !t._wet && !t._iced && !t.building && !t.customBuilding && !t.customBuildingPart) {
                    const onStreet = _street(t);
                    const n = Math.floor(leaves * (onStreet ? 2.5 : 7) * (0.4 + hh(q, r, 8)));
                    const pal = oldLeaves ? LEAVES_OLD : LEAVES;
                    for (let i = 0; i < n; i++) {
                        ctx.fillStyle = pal[Math.floor(hh(q, r, 130 + i) * pal.length)];
                        const lx = x + Math.floor(hh(q, r, 140 + i) * (ds - 2 * p)), ly = y + Math.floor(hh(q, r, 150 + i) * (ds - p));
                        if (hh(q, r, 160 + i) < 0.5) ctx.fillRect(lx, ly, 2 * p, p);
                        else { ctx.fillRect(lx, ly, p, p); ctx.fillRect(lx + p, ly + p, p, p); }
                    }
                }
            }
        }
    },

    /** A crack across the ice: a jagged run of the sheet's pixels and a glint beside it. */
    _ssCrack(ctx, x, y, ds, p, q, r, dark, light) {
        const u = Math.max(1, Math.round(p / 2));
        let cx = x + Math.floor((0.2 + hh(q, r, 200) * 0.6) * ds), cy = y + Math.floor((0.2 + hh(q, r, 201) * 0.6) * ds);
        const steps = 5 + Math.floor(hh(q, r, 202) * 5);
        let dir = Math.floor(hh(q, r, 203) * 4);
        for (let i = 0; i < steps; i++) {
            ctx.fillStyle = dark;
            ctx.fillRect(cx, cy, u * 2, u);
            ctx.fillStyle = light;
            ctx.fillRect(cx, cy - u, u * 2, u);
            if (hh(q, r, 210 + i) < 0.35) dir = (dir + (hh(q, r, 220 + i) < 0.5 ? 1 : 3)) & 3;
            cx += dir === 0 ? 2 * u : dir === 2 ? -2 * u : u;
            cy += dir === 1 ? 2 * u : dir === 3 ? -2 * u : (hh(q, r, 230 + i) < 0.5 ? u : -u);
            if (cx < x || cy < y || cx > x + ds - 2 * u || cy > y + ds - u) break;
        }
    },

    /** The hole broken through the ice: dark water ringed with jagged white edges. */
    _ssHoleRim(ctx, x, y, ds, p, q, r, at) {
        // (the open water darker, a rounded hole, not a square)
        ctx.fillStyle = 'rgba(8, 26, 40, 0.35)';
        blob(ctx, x, y, ds / 32, 16, 16, 26, 22, q, r, 77);
        const n = Math.max(3, Math.round(ds / p));
        for (let i = 0; i < n; i++) {
            const k = i * p;
            for (let side = 0; side < 4; side++) {
                const nb = side === 0 ? at(q, r - 1) : side === 1 ? at(q + 1, r) : side === 2 ? at(q, r + 1) : at(q - 1, r);
                if (!nb || !nb._iced) continue;
                const d = p * (1 + Math.floor(hh(q * 4 + side, r, i) * 3));
                ctx.fillStyle = hh(q, r * 4 + side, i) < 0.3 ? '#bfe0ee' : '#eef8fc';
                if (side === 0) ctx.fillRect(x + k, y, p, d);
                else if (side === 2) ctx.fillRect(x + k, y + Math.ceil(ds) - d, p, d);
                else if (side === 3) ctx.fillRect(x, y + k, d, p);
                else ctx.fillRect(x + Math.ceil(ds) - d, y + k, d, p);
            }
        }
    },

    /** A snow bank along one side of a street cell (side: 0 up, 1 left, 2 down, 3 right). */
    _ssBank(ctx, x, y, sz, depth, p, q, r, side) {
        const n = Math.ceil(sz / p);
        for (let i = 0; i < n; i++) {
            const d = Math.max(p, depth - Math.floor(hh(q * 4 + side, r, 300 + i) * 2) * p);
            const k = i * p;
            ctx.fillStyle = SNOW;
            if (side === 0) ctx.fillRect(x + k, y, p, d);
            else if (side === 2) ctx.fillRect(x + k, y + sz - d, p, d);
            else if (side === 1) ctx.fillRect(x, y + k, d, p);
            else ctx.fillRect(x + sz - d, y + k, d, p);
            // the bank's face toward the street in shadow
            ctx.fillStyle = SNOW_SHADE;
            if (side === 0) ctx.fillRect(x + k, y + d, p, Math.max(1, p >> 1));
            else if (side === 2) ctx.fillRect(x + k, y + sz - d - Math.max(1, p >> 1), p, Math.max(1, p >> 1));
            else if (side === 1) ctx.fillRect(x + d, y + k, Math.max(1, p >> 1), p);
            else ctx.fillRect(x + sz - d - Math.max(1, p >> 1), y + k, Math.max(1, p >> 1), p);
        }
    },

    /** A puddle: a rounded pool of dark water in a muddy rim, the sky's glint along its far edge. */
    _ssPuddle(ctx, x, y, px, q, r, alpha) {
        const w = 7 + Math.floor(hh(q, r, 400) * 8), h = Math.max(3, Math.round(w * (0.4 + hh(q, r, 401) * 0.12)));
        const [cx, cy] = placeIn(Math.round(w * 1.4) + 2, h + 2, q, r, 402);
        ctx.globalAlpha = alpha;
        puddle(ctx, x, y, px, cx, cy, w, h, q, r, 'rgba(46, 32, 18, 0.34)', 'rgba(54, 68, 86, 0.74)', 'rgba(28, 34, 42, 0.5)', 'rgba(200, 218, 232, 0.8)');
        ctx.globalAlpha = 1;
    },

    /** A patch of snow lying on: rounded, its foot in shadow, a bright crust on top (old and greyer in the thaw). */
    _ssSnowPatch(ctx, x, y, px, cx, cy, w, h, q, r, old) {
        // a smaller lobe off one shoulder, so no patch is a plain oval
        const side = hh(q, r, 510) < 0.5 ? -1 : 1;
        const lw = Math.max(2, Math.round(w * 0.5)), lh = Math.max(2, h - 1);
        const lx = cx + side * w * 0.42, ly = cy - h * 0.25;
        ctx.fillStyle = old ? 'rgba(120, 136, 150, 0.32)' : 'rgba(150, 170, 190, 0.42)';
        blob(ctx, x, y, px, cx, cy + 1, w, h, q, r, 501, lx, ly + 1, lw, lh);
        ctx.fillStyle = old ? 'rgba(222, 228, 232, 0.88)' : SNOW;
        blob(ctx, x, y, px, cx, cy, w, h, q, r, 501, lx, ly, lw, lh);
        if (w >= 6) {
            ctx.fillStyle = old ? 'rgba(246, 249, 252, 0.9)' : '#ffffff';
            run(ctx, x, y, px, cx - w * 0.3, Math.round(cy - h / 2), Math.max(1, Math.round(w * 0.3)));
        }
    },

    // ══════════════════════════════════════════════
    // EACH FRAME: footprints, snowmen
    // ══════════════════════════════════════════════

    /** Note who has stepped where (once a frame, before drawing). */
    _ssTrackSteps(now) {
        const ss = InnerMap._ss;
        if (!ss) return;
        const snowy = ss.winterLook ? ss.snow > 0.1 : ss.dust > 0.55;
        const muddy = ss.mudShow > 0.35;
        if (!snowy && !muddy) return;
        const tiles = InnerMap.tiles;
        const step = (q, r, pq, pr) => {
            const t = tiles[r] && tiles[r][q];
            if (!t) return;
            const kind = snowy && _snowGround(t) ? 0 : muddy && _soft(t) ? 1 : -1;
            if (kind < 0) return;
            const i = (_printN++ % PRINTS) * 5;
            _prints[i] = q; _prints[i + 1] = r; _prints[i + 2] = now;
            _prints[i + 3] = q > pq ? 3 : q < pq ? 1 : r > pr ? 2 : 0;
            _prints[i + 4] = kind;
        };
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        if (this._ssLastP && (this._ssLastP.q !== pq || this._ssLastP.r !== pr)) step(pq, pr, this._ssLastP.q, this._ssLastP.r);
        this._ssLastP = this._ssLastP || { q: pq, r: pr };
        this._ssLastP.q = pq; this._ssLastP.r = pr;
        const npcs = InnerMap.npcs || [];
        for (let k = 0; k < npcs.length; k++) {
            const n = npcs[k];
            if (n._insideBuilding || n.state === 'gone') continue;
            if (n._ssLq !== undefined && (n._ssLq !== n.q || n._ssLr !== n.r)) step(n.q, n.r, n._ssLq, n._ssLr);
            n._ssLq = n.q; n._ssLr = n.r;
        }
    },

    _renderSeasonFx(ctx, camera) {
        const ss = InnerMap._ss;
        if (!ss || InnerMap._insideBuilding || InnerMap._underwater) return;
        const now = this._ambientT || 0;
        if (InnerMap.tiles !== this._ssPrintsTiles) { _printN = 0; _prints.fill(0); this._ssPrintsTiles = InnerMap.tiles; this._ssLastP = null; }
        this._ssTrackSteps(now);
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const p = Math.max(1, Math.round(ds / 16));
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        // ── Footprints ──
        const n = Math.min(_printN, PRINTS);
        for (let k = 0; k < n; k++) {
            const i = k * 5;
            const q = _prints[i], r = _prints[i + 1];
            if (q < qMin || q > qMax || r < rMin || r > rMax) continue;
            const age = now - _prints[i + 2];
            if (age < 0 || age > PRINT_LIFE) continue;
            const fade = Math.ceil((1 - age / PRINT_LIFE) * FADE);
            const s = camera.worldToScreenFast(q * T, r * T);
            const x = Math.floor(s.x), y = Math.floor(s.y);
            ctx.fillStyle = (_prints[i + 4] === 0 ? PRINT_SNOW : PRINT_MUD)[fade];
            const dir = _prints[i + 3];
            const along = dir === 1 || dir === 3;
            // two prints, left foot and right, across the line of the walk
            for (let f = 0; f < 2; f++) {
                const off = (f ? 0.6 : 0.4) * ds;
                const lat = (f ? 0.56 : 0.44) * ds;
                const fx = x + Math.floor(along ? off : lat), fy = y + Math.floor(along ? lat : off);
                ctx.fillRect(fx, fy, along ? 2 * p : p, along ? p : 2 * p);
            }
        }
        // ── Snowmen ──
        const sm = InnerMap._ssSnowmen;
        if (sm) {
            for (const m of sm) {
                if (m.q < qMin - 1 || m.q > qMax + 1 || m.r < rMin - 1 || m.r > rMax + 1) continue;
                const t = InnerMap.tiles[m.r] && InnerMap.tiles[m.r][m.q];
                if (!t || !t.visible) continue;
                const spr = this._ssSnowmanSprite(m.v);
                if (!spr) continue;
                const s = camera.worldToScreenFast(m.q * T, m.r * T);
                const w = Math.round(ds * 0.6), h = Math.round(w * spr.height / spr.width);
                const smooth = ctx.imageSmoothingEnabled;
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(spr, Math.floor(s.x + (ds - w) / 2), Math.floor(s.y + ds * 0.9 - h), w, h);
                ctx.imageSmoothingEnabled = smooth;
            }
        }
    },

    /** A snowman, drawn once at the sheet's own pixel (16 x 24): three balls, coal, a carrot, a scarf or a hat. */
    _ssSnowmanSprite(v) {
        this._ssSnowmanSprites = this._ssSnowmanSprites || [];
        if (this._ssSnowmanSprites[v]) return this._ssSnowmanSprites[v];
        const c = _canvas(16, 24);
        if (!c) return null;
        const g = c.getContext('2d');
        const ball = (cx, cy, rad) => {
            for (let y = -rad; y <= rad; y++) {
                for (let x = -rad; x <= rad; x++) {
                    const d = x * x + y * y;
                    if (d > rad * rad + rad * 0.6) continue;
                    // lit from the upper left, shaded below right
                    g.fillStyle = x + y > rad * 0.7 ? '#c3d1df' : x + y < -rad * 0.9 ? '#ffffff' : '#eef3f8';
                    g.fillRect(cx + x, cy + y, 1, 1);
                }
            }
        };
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(3, 22, 10, 2);
        ball(8, 18, 5);
        ball(8, 10, 4);
        ball(8, 4, 3);
        g.fillStyle = '#222';
        g.fillRect(7, 3, 1, 1); g.fillRect(9, 3, 1, 1);
        g.fillRect(8, 9, 1, 1); g.fillRect(8, 11, 1, 1); g.fillRect(8, 16, 1, 1);
        g.fillStyle = '#e07a1f';
        g.fillRect(9, 5, 2, 1);
        g.fillStyle = '#5a3a1e';
        g.fillRect(2, 9, 3, 1); g.fillRect(1, 8, 1, 1); g.fillRect(11, 9, 3, 1); g.fillRect(14, 8, 1, 1);
        if (v === 1) { g.fillStyle = '#b8322a'; g.fillRect(5, 7, 7, 1); g.fillRect(10, 8, 1, 2); }
        if (v === 2) { g.fillStyle = '#2b2b30'; g.fillRect(5, 1, 7, 1); g.fillRect(6, 0, 5, 1); }
        this._ssSnowmanSprites[v] = c;
        return c;
    },

    // ══════════════════════════════════════════════
    // IN THE AIR: leaves drifting down, the fiddler's notes
    // ══════════════════════════════════════════════

    _renderSeasonAir(ctx, camera) {
        const ss = InnerMap._ss;
        if (!ss || InnerMap._insideBuilding || InnerMap._underwater) return;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const t = this._ambientT || 0;
        const { qMin, qMax, rMin, rMax } = this._frameRange;
        // ── Leaves on the wind: a few to each block of the map, falling and turning ──
        const L = ss.leavesShow || 0;
        if (L >= 0.15 && !ss.winterLook) {
            const B = 10;
            const per = Math.max(1, Math.round(5 * L));
            const p = Math.max(1, Math.round(ds / 16));
            const wind = (this._ambWind && Number.isFinite(this._ambWind.x)) ? this._ambWind.x : 0.4;
            for (let br = Math.floor(rMin / B) - 1; br <= Math.floor(rMax / B); br++) {
                for (let bq = Math.floor(qMin / B) - 1; bq <= Math.floor(qMax / B); bq++) {
                    for (let i = 0; i < per; i++) {
                        const h0 = hh(bq, br, i), h1 = hh(bq, br, i + 50), h2 = hh(bq, br, i + 100);
                        const period = 9 + h1 * 7;
                        const u = ((t / period + h0) % 1 + 1) % 1;
                        const wx = (bq * B + h1 * B) * T + Math.sin(t * (0.9 + h2) + i) * T * 0.6 + wind * u * T * 3;
                        const wy = (br * B + h2 * B * 0.5) * T + u * B * T * 0.7;
                        const s = camera.worldToScreenFast(wx, wy);
                        if (s.x < -20 || s.y < -20 || s.x > ctx.canvas.width + 20 || s.y > ctx.canvas.height + 20) continue;
                        const a = Math.min(1, Math.min(u, 1 - u) * 6);
                        ctx.globalAlpha = a;
                        ctx.fillStyle = LEAVES[Math.floor(h2 * LEAVES.length)];
                        // turning as it falls: broad, then edge-on
                        const flip = Math.sin(t * 3 + i * 1.7 + h0 * 6) > 0;
                        ctx.fillRect(Math.floor(s.x), Math.floor(s.y), flip ? 2 * p : p, flip ? p : 2 * p);
                    }
                }
            }
            ctx.globalAlpha = 1;
        }
        // ── The fiddler's notes rising at the fair ──
        const fest = InnerMap._ssFair;
        if (fest && fest.kind === 'fair' && InnerMap._ssMusicianId != null) {
            const m = (InnerMap.npcs || []).find(n => n.id === InnerMap._ssMusicianId);
            if (m && m.activity && m.activity.type === 'season' && m.state === 'idle' && !m._insideBuilding
                && m.q >= qMin && m.q <= qMax && m.r >= rMin && m.r <= rMax) {
                const s = camera.worldToScreenFast(m.q * T + T / 2, m.r * T);
                ctx.font = `${Math.max(9, Math.round(ds * 0.32))}px serif`;
                ctx.textAlign = 'center';
                for (let i = 0; i < 3; i++) {
                    const u = ((t * 0.6 + i / 3) % 1);
                    ctx.globalAlpha = Math.min(1, (1 - u) * 1.5);
                    const x = s.x + Math.sin((t + i) * 2.2) * ds * 0.3, y = s.y - u * ds * 1.1;
                    ctx.fillStyle = '#2a1a0a';
                    ctx.fillText(i & 1 ? '♫' : '♪', x + 1, y + 1);
                    ctx.fillStyle = '#fff4c8';
                    ctx.fillText(i & 1 ? '♫' : '♪', x, y);
                }
                ctx.globalAlpha = 1;
            }
        }
    },

    // ══════════════════════════════════════════════
    // SNOW ON THE ROOFS (into a building's kept canvas)
    // ══════════════════════════════════════════════

    /** The roofs' snow today: 0 none, 1-3 deeper (part of a building canvas's key). */
    _ssRoofLevel() {
        const ss = InnerMap._ss;
        return ss && !InnerMap._insideBuilding ? (ss.roof || 0) : 0;
    },

    /**
     * Lay the roofs' snow over a building just drawn into its canvas `c` (context `g`,
     * camera `cam`): its roof cells drawn again apart, whitened over their own pixels,
     * the snow thickest along the top of each cell (the ridges and the courses).
     */
    _seasonRoofSnow(g, c, cam, def, anchorQ, anchorR, ds, level) {
        // (by what each cell is, not the layer it is filed in: most roofs are in the "floor"
        // layer, the door in "roof" — snow lies on the roof, not down the front door)
        if (!level || !c) return;
        const roof = roofLayers(def);
        if (!roof) return;
        let tmp = this._ssRoofTmp;
        if (!tmp) tmp = this._ssRoofTmp = _canvas(c.width, c.height);
        if (!tmp) return;
        if (tmp.width !== c.width || tmp.height !== c.height) { tmp.width = c.width; tmp.height = c.height; }
        const tg = tmp.getContext('2d');
        tg.setTransform(1, 0, 0, 1, 0, 0);
        tg.globalCompositeOperation = 'source-over';
        tg.globalAlpha = 1;
        tg.clearRect(0, 0, tmp.width, tmp.height);
        tg.setTransform(g.getTransform());
        tg.imageSmoothingEnabled = false;
        this._drawCustomBuildingDirect(tg, cam, { ...def, layers: roof }, anchorQ, anchorR, ds, null, null, 0, null);
        tg.setTransform(1, 0, 0, 1, 0, 0);
        const L = Math.max(1, Math.min(3, level | 0));
        // (the roof's own shape kept under the snow: its colour drained and its pixels lifted
        // toward white — a screen, so the courses and the ridge still read — then cut back to
        // the roof's own pixels, the blends having painted the empty canvas round it)
        let mask = this._ssRoofMask;
        if (!mask) mask = this._ssRoofMask = _canvas(tmp.width, tmp.height);
        if (mask) {
            if (mask.width !== tmp.width || mask.height !== tmp.height) { mask.width = tmp.width; mask.height = tmp.height; }
            const mg = mask.getContext('2d');
            mg.setTransform(1, 0, 0, 1, 0, 0);
            mg.globalCompositeOperation = 'copy';
            mg.drawImage(tmp, 0, 0);
            mg.globalCompositeOperation = 'source-over';
            tg.globalCompositeOperation = 'saturation';
            tg.fillStyle = `rgba(128, 128, 128, ${[0.45, 0.65, 0.8][L - 1]})`;
            tg.fillRect(0, 0, tmp.width, tmp.height);
            tg.globalCompositeOperation = 'screen';
            tg.fillStyle = ['rgb(110, 118, 130)', 'rgb(150, 160, 176)', 'rgb(182, 193, 210)'][L - 1];
            tg.fillRect(0, 0, tmp.width, tmp.height);
            tg.globalCompositeOperation = 'destination-in';
            tg.drawImage(mask, 0, 0);
        } else {
            tg.globalCompositeOperation = 'source-atop';
            tg.fillStyle = `rgba(238, 244, 250, ${(0.3 + L * 0.15).toFixed(3)})`;
            tg.fillRect(0, 0, tmp.width, tmp.height);
        }
        // drifts lying along the courses: a fine brighter line down the roof every few sheet pixels
        tg.globalCompositeOperation = 'source-atop';
        const k = (g.getTransform().a) || 1;
        const band = Math.max(1, Math.round(ds / 32 * k));
        const step = Math.max(band * 3, Math.round(ds / 4 * k));
        tg.fillStyle = `rgba(250, 252, 255, ${(0.12 + L * 0.08).toFixed(3)})`;
        for (let y = 0; y < tmp.height; y += step) tg.fillRect(0, y, tmp.width, band);
        tg.globalCompositeOperation = 'source-over';
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.drawImage(tmp, 0, 0);
        g.restore();
    },
});

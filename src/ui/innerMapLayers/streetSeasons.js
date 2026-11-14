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

const ICE_SHEET = 'assets/lpc/Terrain/terrain_winter_ice.png';
const SEASON_SHEET = /assets\/lpc\/Terrain\/terrain_(spring|summer|autumn|winter)\.png$/;

// Leaves: autumn reds, oranges, golds and browns; a bare winter's are browner
const LEAVES = ['#c4512b', '#db842c', '#e6b53d', '#9a3d1c', '#b8702e', '#d9a441'];
const LEAVES_OLD = ['#7a5232', '#8c6a3f', '#6b4a2c', '#9a7a4a'];
const SNOW = '#eef3f8', SNOW_SHADE = '#c3d1df', SNOW_OLD = '#dfe5ea';
const MUD = 'rgba(72, 50, 30, ', MUD_DARK = '#4d4438';

// The footprints: a ring of [x, y, born, dir, kind] (kind 0 snow, 1 mud)
const PRINTS = 260;
const _prints = new Float32Array(PRINTS * 5);
let _printN = 0;
const PRINT_LIFE = 50;   // seconds on the ambient clock
// their colours fading, in steps (no string made a frame)
const FADE = 8;
const PRINT_SNOW = Array.from({ length: FADE + 1 }, (_, i) => `rgba(120, 145, 175, ${(0.55 * i / FADE).toFixed(3)})`);
const PRINT_MUD = Array.from({ length: FADE + 1 }, (_, i) => `rgba(48, 32, 18, ${(0.5 * i / FADE).toFixed(3)})`);

/** Integer hash → 0..1. */
function hh(q, r, k) {
    let h = (Math.imul(q | 0, 374761393) + Math.imul(r | 0, 668265263) + Math.imul(k | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

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
/** Soft ground that goes to mud: an unpaved road, trodden soil, bare earth, a field. */
function _soft(t) {
    return !!(t && !t._wet && !t._iced && !t.paving && !t._pave && !t._isInterior && !t.building && !t.customBuilding && !t.customBuildingPart
        && (t.isRoad || t._townSoil || t._fieldSoil || t.baseTerrain === 'dirt'));
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
        const dustWash = dust > 0.4 ? `rgba(236, 242, 248, ${((dust - 0.4) * 0.9).toFixed(3)})` : null;
        const mudFill = MUD + (0.16 + mud * 0.3).toFixed(3) + ')';
        const rutFill = MUD + Math.min(0.7, 0.25 + mud * 0.4).toFixed(3) + ')';

        for (let r = rMin; r <= rMax; r++) {
            const row = tiles[r];
            if (!row) continue;
            const y = Math.floor(oy + (r - rMin) * ds);
            for (let q = qMin; q <= qMax; q++) {
                const t = row[q];
                if (!t || !t.explored || t._isInterior) continue;
                const x = Math.floor(ox + (q - qMin) * ds);
                // (a wash is laid edge to edge, not overlapped: a translucent overlap would show the grid)
                const cw = Math.floor(ox + (q + 1 - qMin) * ds) - x, ch = Math.floor(oy + (r + 1 - rMin) * ds) - y;

                // ── Ice: thin ice darker and cracked; the hole where it broke ──
                if (t._iced === 1) {
                    ctx.fillStyle = 'rgba(38, 92, 122, 0.16)';
                    ctx.fillRect(x, y, cw, ch);
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
                    const n = 1 + Math.floor(hh(q, r, 3) * 3);
                    ctx.fillStyle = ss.winterLook ? 'rgba(150, 140, 128, 0.35)' : 'rgba(60, 70, 80, 0.22)';
                    for (let i = 0; i < n; i++) {
                        ctx.fillRect(x + Math.floor(hh(q, r, 10 + i) * (ds - 3 * p)), y + Math.floor(hh(q, r, 20 + i) * (ds - 2 * p)), p * (2 + (i & 1)), p);
                    }
                    if ((t.paving || t._pave) && ss.raining && hh(q, r, 4) < 0.18) this._ssPuddle(ctx, x, y, ds, p, q, r, 0.7);
                }

                // ── Snow dusting the ground not yet white, or lying on in the thaw ──
                if (dust > 0 && _snowGround(t)) {
                    if (dustWash) {
                        ctx.fillStyle = dustWash;
                        ctx.fillRect(x, y, cw, ch);
                    }
                    const n = 4;
                    for (let i = 0; i < n; i++) {
                        if (hh(q, r, 40 + i) >= dust * 0.8) continue;
                        const w = (2 + Math.floor(hh(q, r, 50 + i) * 4)) * p, h = (1 + Math.floor(hh(q, r, 60 + i) * 2)) * p;
                        const bx = x + Math.floor(hh(q, r, 70 + i) * Math.max(1, ds - w)), by = y + Math.floor(hh(q, r, 80 + i) * Math.max(1, ds - h - p));
                        ctx.fillStyle = thaw ? SNOW_OLD : SNOW;
                        ctx.fillRect(bx, by, w, h);
                        ctx.fillRect(bx + p, by - p, Math.max(p, w - 2 * p), p);
                        ctx.fillStyle = SNOW_SHADE;
                        ctx.fillRect(bx + p, by + h, Math.max(p, w - 2 * p), Math.max(1, Math.round(p / 2)));
                    }
                    if (thaw && slush > 0.05 && hh(q, r, 5) < slush * 0.25) this._ssPuddle(ctx, x, y, ds, p, q, r, 0.8);
                }

                // ── Mud on the soft ground after rain: dark patches, ruts, puddles ──
                if (mud > 0 && _soft(t)) {
                    ctx.fillStyle = mudFill;
                    const n = 1 + Math.floor(mud * 4);
                    for (let i = 0; i < n; i++) {
                        const w = (3 + Math.floor(hh(q, r, 90 + i) * 5)) * p, h = (2 + Math.floor(hh(q, r, 100 + i) * 3)) * p;
                        ctx.fillRect(x + Math.floor(hh(q, r, 110 + i) * Math.max(1, ds - w)), y + Math.floor(hh(q, r, 120 + i) * Math.max(1, ds - h)), w, h);
                    }
                    if (t.isRoad) {
                        // Ruts along the road's run (the wheels' two tracks)
                        const ew = _street(at(q - 1, r)) || _street(at(q + 1, r));
                        const ns = _street(at(q, r - 1)) || _street(at(q, r + 1));
                        ctx.fillStyle = rutFill;
                        if (ew && (!ns || hh(q, r, 6) < 0.5)) {
                            ctx.fillRect(x, y + Math.floor(ds * 0.3), sz, p);
                            ctx.fillRect(x, y + Math.floor(ds * 0.68), sz, p);
                        } else if (ns) {
                            ctx.fillRect(x + Math.floor(ds * 0.3), y, p, sz);
                            ctx.fillRect(x + Math.floor(ds * 0.68), y, p, sz);
                        }
                    }
                    if (mud >= puddlesAt && hh(q, r, 7) < (mud - 0.35) * 0.5) this._ssPuddle(ctx, x, y, ds, p, q, r, 1);
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
        ctx.fillStyle = 'rgba(8, 26, 40, 0.35)';
        const m = Math.round(ds * 0.12);
        ctx.fillRect(x + m, y + m, Math.ceil(ds) - 2 * m, Math.ceil(ds) - 2 * m);
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

    /** A puddle: dark water, the sky's glint on its near edge. */
    _ssPuddle(ctx, x, y, ds, p, q, r, alpha) {
        const w = (5 + Math.floor(hh(q, r, 400) * 5)) * p, h = (2 + Math.floor(hh(q, r, 401) * 2)) * p;
        const bx = x + Math.floor(hh(q, r, 402) * Math.max(1, ds - w)), by = y + Math.floor(hh(q, r, 403) * Math.max(1, ds - h - p));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = MUD_DARK;
        ctx.fillRect(bx + p, by, w - 2 * p, h);
        ctx.fillRect(bx, by + p, w, Math.max(p, h - 2 * p));
        ctx.fillStyle = 'rgba(150, 175, 195, 0.8)';
        ctx.fillRect(bx + p, by + p, Math.max(p, Math.floor(w / 2)), Math.max(1, p >> 1));
        ctx.fillStyle = 'rgba(110, 130, 150, 0.6)';
        ctx.fillRect(bx + 2 * p, by + 2 * p, Math.max(p, Math.floor(w / 4)), Math.max(1, p >> 1));
        ctx.globalAlpha = 1;
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
        const roof = def && def.layers && def.layers.roof;
        if (!level || !roof || !roof.length || !c) return;
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
        this._drawCustomBuildingDirect(tg, cam, { ...def, layers: { roof } }, anchorQ, anchorR, ds, null, null, 0, null);
        tg.setTransform(1, 0, 0, 1, 0, 0);
        tg.globalCompositeOperation = 'source-atop';
        tg.fillStyle = `rgba(238, 244, 250, ${(0.35 + level * 0.17).toFixed(3)})`;
        tg.fillRect(0, 0, tmp.width, tmp.height);
        // drifts lying along the courses: brighter bands down the roof, a sheet pixel or two deep
        const k = (g.getTransform().a) || 1;
        const band = Math.max(1, Math.round(ds / 32 * k * (1 + level)));
        const step = Math.max(band * 2, Math.round(ds / 4 * k));
        tg.fillStyle = `rgba(250, 252, 255, ${(0.25 + level * 0.15).toFixed(3)})`;
        for (let y = 0; y < tmp.height; y += step) tg.fillRect(0, y, tmp.width, band);
        tg.globalCompositeOperation = 'source-over';
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.drawImage(tmp, 0, 0);
        g.restore();
    },
});

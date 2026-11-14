// InnerMapRenderer — the ground drawn once and kept (mixed in via Object.assign).
//
// The street map's ground — the terrain fills and grid (layer 0), the brush
// detail, paving, decals, lane edges and kerbs (layer 0.5) and the dirt roads
// (layer 1) — does not move from frame to frame, yet drawn tile by tile it was
// the better part of a frame: a thousand-odd cells on screen, each a fill, a
// paving cell, the lanes' clipped tufts and the kerbs' turned pieces. Here the
// same three layers are drawn into chunks of a few cells square at the screen's
// own resolution, and each frame only blits the chunks on screen.
//
// A chunk is drawn by the very layer methods (terrainRoads.js), pointed at the
// chunk's canvas through a stand-in camera and a frame range reaching a cell or
// so past its edges, so what spills over from its neighbours (kerbs, tufts, tall
// shore decals) lies in it as it would on the screen. Every frame each chunk on
// screen checks the cells it reads (what explored / visible / paved / laned …
// them) and is redrawn when one has changed. While the zoom glides, inside a
// building, or where there is no DOM, the layers draw directly as before.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';

// The chunk's size in device px it aims at (its side in cells follows the zoom)
const CHUNK_PX = 768;
// Cells drawn round a chunk for what spills into it: kerbs and tufts reach half
// a cell, a tall shore decal (reeds) up from the cells below
const PAD_X = 1, PAD_TOP = 1, PAD_BOTTOM = 3;
// Unused chunks are dropped after this many frames; a few canvases are kept to reuse
const STALE_FRAMES = 90;
const POOL = 12;
// While a sheet the ground needs is still loading, its chunk is redrawn this often (ms)
const RETRY_MS = 400;
// How long a frame may spend drawing chunks (ms) before it leaves the rest to the next
const BUILD_BUDGET_MS = 6;

// The fields of a cell the three ground layers read, compared one by one (named, not looked
// up by key: this runs over every cell of every chunk on screen) — not its lazy _cachedFill:
// it follows baseTerrain, and is cleared wherever that changes
const SIG_N = 18;
/** Bring a cell's record (sig from i) up to date; true when anything in it differed. */
function cellChanged(sig, i, t) {
    let c = false;
    if (sig[i + 0] !== t.explored) { sig[i + 0] = t.explored; c = true; }
    if (sig[i + 1] !== t.visible) { sig[i + 1] = t.visible; c = true; }
    if (sig[i + 2] !== t._isInterior) { sig[i + 2] = t._isInterior; c = true; }
    if (sig[i + 3] !== t.baseTerrain) { sig[i + 3] = t.baseTerrain; c = true; }
    if (sig[i + 4] !== t.subTerrain) { sig[i + 4] = t.subTerrain; c = true; }
    if (sig[i + 5] !== t.terrainDetail) { sig[i + 5] = t.terrainDetail; c = true; }
    if (sig[i + 6] !== t.grassOverlay) { sig[i + 6] = t.grassOverlay; c = true; }
    if (sig[i + 7] !== t.paving) { sig[i + 7] = t.paving; c = true; }
    if (sig[i + 8] !== t._pave) { sig[i + 8] = t._pave; c = true; }
    if (sig[i + 9] !== t.decor) { sig[i + 9] = t.decor; c = true; }
    if (sig[i + 10] !== t._crag) { sig[i + 10] = t._crag; c = true; }
    if (sig[i + 11] !== t._fieldSoil) { sig[i + 11] = t._fieldSoil; c = true; }
    if (sig[i + 12] !== t._soilFill) { sig[i + 12] = t._soilFill; c = true; }
    if (sig[i + 13] !== t._townSoil) { sig[i + 13] = t._townSoil; c = true; }
    if (sig[i + 14] !== t._wet) { sig[i + 14] = t._wet; c = true; }
    if (sig[i + 15] !== t.isRoad) { sig[i + 15] = t.isRoad; c = true; }
    if (sig[i + 16] !== t.customBuildingPart) { sig[i + 16] = t.customBuildingPart; c = true; }
    if (sig[i + 17] !== t.building) { sig[i + 17] = t.building; c = true; }
    return c;
}

Object.assign(InnerMapRenderer, {
    _groundCache: null,
    // (set true to draw the ground cell by cell every frame, as before)
    _groundCacheOff: false,

    /** Layers 0 – 1: the ground, from the chunk cache when it can, else drawn directly. */
    _renderGround(ctx, camera) {
        if (!this._groundCacheUsable(ctx, camera)) {
            this._renderGroundDirect(ctx, camera);
            return;
        }
        try {
            this._renderGroundCached(ctx, camera);
        } catch (err) {
            // (never leave the street without its ground: draw it the old way, and stop caching)
            console.warn('[InnerMapRenderer] ground cache:', err);
            this._groundCacheOff = true;
            this._groundCache = null;
            this._renderGroundDirect(ctx, camera);
        }
    },

    _renderGroundDirect(ctx, camera) {
        // ── Layer 0: Terrain (ground) ──
        this._renderTerrainLayer(ctx, camera);
        // ── Layer 0.5: Terrain detail (9-tile brush paint over base) ──
        this._renderTerrainDetailLayer(ctx, camera);
        // ── Layer 1: Roads ──
        this._renderRoadLayer(ctx, camera);
        // ── Layer 1.2: The season on the ground — snow, slush, mud, leaves, thin ice (innerMapLayers/streetSeasons.js) ──
        if (this._renderSeasonGround) this._renderSeasonGround(ctx, camera);
    },

    _groundCacheUsable(ctx, camera) {
        if (this._groundCacheOff || typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
        if (InnerMap._insideBuilding || !InnerMap.tiles || !InnerMap.tiles.length) return false;
        if (!ctx || !(ctx.canvas instanceof HTMLCanvasElement) || !camera) return false;
        if (camera.worldPixelWidth > 0) return false;
        // (while the zoom glides every frame is a new size: draw directly till it settles)
        const z = camera.zoom, tz = Number.isFinite(camera.targetZoom) ? camera.targetZoom : z;
        return z > 0 && Math.abs(z - tz) <= tz * 1e-4;
    },

    _renderGroundCached(ctx, camera) {
        const T = this.TILE_SIZE;
        const zoom = Number.isFinite(camera.targetZoom) ? camera.targetZoom : camera.zoom;
        const k = (ctx.canvas && ctx.canvas.pixelRatio) || 1;
        const ds = T * zoom;
        const n = Math.max(4, Math.min(16, Math.floor(CHUNK_PX / (ds * k))));
        const mapH = InnerMap.tiles.length, mapW = InnerMap.tiles[0].length;

        // Anything the whole ground hangs on: a change starts the cache afresh
        const terrainKey = this._seasonKey('terrain');
        const cliffKey = this._seasonKey('cliff');
        // (and the day's season on the ground: world/innerMap/streetSeasons.js)
        const key = [zoom, k, n, terrainKey, cliffKey, (InnerMap.roads || []).length, InnerMap._ssKey || ''].join('|');
        let gc = this._groundCache;
        if (!gc || gc.key !== key || gc.tiles !== InnerMap.tiles || gc.roads !== InnerMap.roads
            || gc.fills !== this._terrainFills || gc.sheet !== this._sheets.get(terrainKey)
            || gc.cliff !== this._sheets.get(cliffKey)) {
            const pool = gc ? gc.pool : [];
            if (gc) for (const c of gc.chunks.values()) if (c.canvas && pool.length < POOL) pool.push(c.canvas);
            gc = this._groundCache = {
                key, tiles: InnerMap.tiles, roads: InnerMap.roads, fills: this._terrainFills,
                sheet: this._sheets.get(terrainKey), cliff: this._sheets.get(cliffKey),
                chunks: new Map(), pool, frame: 0,
            };
        }
        gc.frame++;

        const { qMin, qMax, rMin, rMax } = this._frameRange;
        const cq0 = Math.floor(qMin / n), cq1 = Math.floor(qMax / n);
        const cr0 = Math.floor(rMin / n), cr1 = Math.floor(rMax / n);
        const now = performance.now();
        // The chunks on screen, each checked against its cells (a change marks it dirty till drawn)
        const onScreen = [];
        for (let cr = cr0; cr <= cr1; cr++) {
            for (let cq = cq0; cq <= cq1; cq++) {
                const q0 = cq * n, r0 = cr * n;
                if (q0 >= mapW || r0 >= mapH) continue;
                const id = cq + ',' + cr;
                let ch = gc.chunks.get(id);
                if (!ch) {
                    ch = { canvas: null, sig: [], missAt: 0, used: 0, dirty: true, q0, r0 };
                    gc.chunks.set(id, ch);
                }
                ch.used = gc.frame;
                // (each chunk checked every other frame, in turn: a change shows a frame later at most)
                if ((!ch.canvas || ((cq + cr + gc.frame) & 1) === 0)
                    && this._groundChunkChanged(ch.sig, q0, r0, n, mapW, mapH)) ch.dirty = true;
                if (ch.missAt && now - ch.missAt > RETRY_MS) ch.dirty = true;
                onScreen.push(ch);
            }
        }
        // Draw the dirty ones, a few milliseconds' worth a frame (entering a town or a new zoom
        // needs them all: spread over a few frames rather than one long stall)
        let pending = 0;
        for (const ch of onScreen) {
            if (!ch.dirty && ch.canvas) continue;
            if (performance.now() - now > BUILD_BUDGET_MS) { pending++; continue; }
            const at = camera.worldToScreenFast(ch.q0 * T, ch.r0 * T);
            this._drawGroundChunk(gc, ch, ch.q0, ch.r0, n, ds, zoom, k, at.x, at.y);
            ch.dirty = false;
        }
        if (pending) {
            // (not all ready yet: this frame's ground drawn directly, the rest of the chunks next frame)
            this._renderGroundDirect(ctx, camera);
        } else {
            const smooth = ctx.imageSmoothingEnabled;
            ctx.imageSmoothingEnabled = false;
            for (const ch of onScreen) {
                // the chunk's corner where its first cell would be drawn (floored, as the layers place
                // a cell), on a whole device pixel: its pixels 1:1 on the screen's (_drawGroundChunk)
                const p = camera.worldToScreenFast(ch.q0 * T, ch.r0 * T);
                const X = Math.floor(Math.floor(p.x) * k), Y = Math.floor(Math.floor(p.y) * k);
                ctx.drawImage(ch.canvas, X / k, Y / k, ch.canvas.width / k, ch.canvas.height / k);
            }
            ctx.imageSmoothingEnabled = smooth;
        }

        // Chunks off screen a while go back to the pool
        if (gc.frame % 30 === 0) {
            for (const [id, ch] of gc.chunks) {
                if (gc.frame - ch.used <= STALE_FRAMES) continue;
                if (ch.canvas && gc.pool.length < POOL) gc.pool.push(ch.canvas);
                gc.chunks.delete(id);
            }
        }
    },

    /**
     * Has anything a chunk reads changed since it was drawn — its cells, and the
     * ones round them its spill-over cells look at? `sig` is the chunk's record of
     * them, brought up to date in place. True when anything differed.
     */
    _groundChunkChanged(sig, q0, r0, n, mapW, mapH) {
        const qa = Math.max(0, q0 - PAD_X - 1), qb = Math.min(mapW - 1, q0 + n + PAD_X);
        const ra = Math.max(0, r0 - PAD_TOP - 1), rb = Math.min(mapH - 1, r0 + n + PAD_BOTTOM);
        const F = SIG_N;
        const len = (rb - ra + 1) * (qb - qa + 1) * (F + 1);
        let changed = sig.length !== len;
        if (changed) sig.length = len;
        let i = 0;
        for (let r = ra; r <= rb; r++) {
            const row = InnerMap.tiles[r];
            for (let q = qa; q <= qb; q++) {
                const t = row[q];
                if (sig[i] !== t) { sig[i] = t; changed = true; }
                i++;
                if (t && cellChanged(sig, i, t)) changed = true;
                i += F;
            }
        }
        return changed;
    },

    /**
     * Draw one chunk's ground by the layer methods, through a camera that puts its corner
     * at 0,0. (sx, sy) is where that corner is on the screen now: the cells are placed as
     * the layers would place them there (floor of a fractional position, each cell), and
     * the canvas is shifted by what its floored corner falls short of a whole device pixel,
     * so a blit at that pixel puts every cell where the layers would have drawn it. A camera
     * moved on since may land the cells a pixel off from that, never more.
     */
    _drawGroundChunk(gc, ch, q0, r0, n, ds, zoom, k, sx = 0, sy = 0) {
        const T = this.TILE_SIZE;
        const w = Math.ceil((n * ds + 2) * k) + 2, h = Math.ceil((n * ds + 2) * k) + 2;
        const fx = sx - Math.floor(sx), fy = sy - Math.floor(sy);
        const px = Math.floor(sx) * k, py = Math.floor(sy) * k;
        const dx = px - Math.floor(px), dy = py - Math.floor(py);
        let c = ch.canvas;
        if (!c) c = gc.pool.pop() || document.createElement('canvas');
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, w, h);
        g.setTransform(k, 0, 0, k, dx, dy);
        g.imageSmoothingEnabled = false;
        ch.canvas = c;

        const ox = q0 * T, oy = r0 * T;
        const pt = { x: 0, y: 0 };
        const cam = {
            zoom,
            targetZoom: zoom,
            worldPixelWidth: 0,
            worldToScreenFast(x, y) { pt.x = (x - ox) * zoom + fx; pt.y = (y - oy) * zoom + fy; return pt; },
            worldToScreen(x, y) { return { x: (x - ox) * zoom + fx, y: (y - oy) * zoom + fy }; },
        };
        const mapH = InnerMap.tiles.length, mapW = InnerMap.tiles[0].length;
        const frameRange = this._frameRange;
        this._frameRange = {
            qMin: Math.max(0, q0 - PAD_X), qMax: Math.min(mapW - 1, q0 + n - 1 + PAD_X),
            rMin: Math.max(0, r0 - PAD_TOP), rMax: Math.min(mapH - 1, r0 + n - 1 + PAD_BOTTOM),
        };
        // A sheet still loading leaves a hole: the chunk is drawn again shortly
        let missed = false;
        const getSheet = this._getSheetByPath;
        this._getSheetByPath = function (path) {
            const img = getSheet.call(this, path);
            // (still loading: not one that failed, or one of the configured sheets, all in before entry)
            if (path && !img && !(this._sheetKeyByPath && this._sheetKeyByPath.has(path))) {
                const st = this._sheetPathCache && this._sheetPathCache.get(path);
                if (!st || st.status === 'loading') missed = true;
            }
            return img;
        };
        try {
            g.save();
            this._renderGroundDirect(g, cam);
            g.restore();
        } finally {
            this._getSheetByPath = getSheet;
            this._frameRange = frameRange;
        }
        ch.missAt = missed ? performance.now() : 0;
    },
});

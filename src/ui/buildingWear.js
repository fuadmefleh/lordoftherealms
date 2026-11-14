// ============================================================
// BUILDING WEAR — how a weathered house is drawn
// ============================================================
// A town's buildings weather as the years pass (world/townEras.js: a planned
// building's tile.customBuilding.wear, 1 weathered, 2 old). The renderer
// (ui/innerMapLayers/objectsBuildings.js) draws a worn one from its own cells:
//
//   - dulled and darkened (wearFilter), the old more so
//   - moss on its roof: patches cut from the building kit's own turf roof
//     (assets/buildingKit/modern/roofs_turf.png), masked to soft clumps,
//     thickest along the eaves (mossOn)
//   - grime up the foot of its walls (grimeOn)
//   - an old one's roof sagging in the middle of its ridge (sagOf)
//
// Placement is a hash of the building's place: the same house, the same moss,
// every frame and every visit. No randomness, no game state.

import { DataLoader } from '../core/dataLoader.js';
import { sheetScale } from './sheetScale.js';

const TURF = 'assets/buildingKit/modern/roofs_turf.png';
const _sheets = new Map();
/** A sheet by path, loading. */
function _sheet(path) {
    if (_sheets.has(path) || typeof Image === 'undefined') return _sheets.get(path) || null;
    const img = new Image();
    img.src = path;
    _sheets.set(path, img);
    return img;
}
const ROOF = /roofs_|\/Roofing\/[^/]*(roof|thatch|shingle|slate|tile)/i;
const ROOF_TILES = /roofs_/i;
const WALL = /walls_/i;
const SAG = false;

let _turf = null;
let _decals = null;

function _hash(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/** The turf roof sheet, loading. */
function _turfImg() {
    if (_turf || typeof Image === 'undefined') return _turf;
    _turf = new Image();
    _turf.src = TURF;
    return _turf;
}

/**
 * The moss clumps: a few patches of the turf roof's middle cell, each masked
 * to a soft, lumpy blob (a sum of discs placed by hash), darkened a touch so
 * it sits in the roof rather than on it. Built once the turf has loaded.
 */
function _mossDecals() {
    if (_decals) return _decals;
    const img = _turfImg();
    if (!img || !img.complete || !img.naturalWidth || typeof document === 'undefined') return null;
    const k = img.naturalWidth / 96;   // (a 3x3 nine-slice at 32px a cell, painted at k×)
    const out = [];
    for (let i = 0; i < 6; i++) {
        const w = 64, h = 32;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        // the blob: discs along its length, bigger in the middle
        g.fillStyle = '#000';
        const n = 7;
        for (let j = 0; j < n; j++) {
            const t = (j + 0.5) / n;
            const r = h * (0.18 + 0.22 * Math.sin(Math.PI * t)) * (0.75 + 0.5 * _hash('moss', i, j));
            const x = w * (0.12 + 0.76 * t) + (_hash('mx', i, j) - 0.5) * 6;
            const y = h * 0.55 + (_hash('my', i, j) - 0.5) * h * 0.35;
            g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        }
        // a few strays round it
        for (let j = 0; j < 5; j++) {
            g.beginPath();
            g.arc(w * _hash('sx', i, j), h * (0.3 + 0.6 * _hash('sy', i, j)), 1.5 + 2 * _hash('sr', i, j), 0, Math.PI * 2);
            g.fill();
        }
        // the turf through the mask
        g.globalCompositeOperation = 'source-in';
        const sx = (32 + 4 + _hash('ox', i) * 12) * k, sy = (32 + 4 + _hash('oy', i) * 14) * k;
        g.drawImage(img, sx, sy, 22 * k, 11 * k, 0, 0, w, h);
        // shade it into the roof: darker below, a soft edge
        g.globalCompositeOperation = 'source-atop';
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(70, 72, 20, 0.25)');
        grad.addColorStop(1, 'rgba(24, 30, 8, 0.6)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        out.push(c);
    }
    _decals = out;
    return out;
}

export const BuildingWear = {
    /** The canvas filter a building of this wear is drawn through ('' for none). */
    wearFilter(wear) {
        return wear >= 2 ? 'saturate(0.58) brightness(0.8) sepia(0.3) contrast(0.94)'
            : wear >= 1 ? 'saturate(0.76) brightness(0.9) sepia(0.16)' : '';
    },

    /**
     * Is the art a building of this wear and spire draws with loaded — the moss and
     * the belltower sheet? (The renderer keeps a drawn building only once it is.)
     */
    artReady(wear, spire) {
        if (wear && !_mossDecals()) return false;
        if (spire) {
            const S = DataLoader._gamedata && DataLoader._gamedata.townEras && DataLoader._gamedata.townEras.art && DataLoader._gamedata.townEras.art.spires;
            if (S && Array.isArray(S.styles) && S.styles.includes(spire)) {
                const img = _sheet(S.sheet);
                if (!img || !img.complete || !img.naturalWidth) return false;
            }
        }
        return true;
    },

    /** Is this cell of a building its roof (a kit roof, a thatch or shingle sheet)? */
    isRoof(cell) {
        return !!cell && ROOF.test(cell.sheetPath || '');
    },

    /** The roof's extent in a design's cells: { q0, q1, r0, r1 } or null. */
    roofBox(def) {
        let box = null;
        for (const lyr of ['floor', 'walls', 'roof', 'overlay']) {
            for (const cell of (def.layers && def.layers[lyr]) || []) {
                if (!ROOF_TILES.test(cell.sheetPath || '')) continue;
                box = box || { q0: cell.q, q1: cell.q, r0: cell.r, r1: cell.r };
                box.q0 = Math.min(box.q0, cell.q); box.q1 = Math.max(box.q1, cell.q);
                box.r0 = Math.min(box.r0, cell.r); box.r1 = Math.max(box.r1, cell.r);
            }
        }
        return box;
    },

    /**
     * How far (screen px) an old roof's cell sags: most in the middle of the
     * ridge, nothing at the gable ends; its eave row half as much.
     */
    sagOf(cell, box, ds, wear) {
        // (drawn cell by cell a dip opens seams between the columns: an old roof is told by its moss and dull instead)
        if (!SAG || wear < 2 || !box || !ROOF_TILES.test(cell.sheetPath || '')) return 0;
        const span = box.q1 - box.q0;
        if (span < 2) return 0;
        const x = ((cell.q + 0.5) - (box.q0 + (span + 1) / 2)) / ((span + 1) / 2);
        const depth = ds * 0.1 * Math.max(0, 1 - x * x);
        return Math.round(cell.r === box.r1 ? depth * 0.5 : depth);
    },

    /**
     * Moss on a worn building's roof: a clump on some of its roof cells (more
     * on an old one), most along the eaves. Draws nothing until the turf has
     * loaded. Returns how many clumps it drew.
     */
    mossOn(ctx, def, ax, ay, ds, wear, key, sag = null) {
        if (!wear) return 0;
        const decals = _mossDecals();
        if (!decals || !decals.length) return 0;
        const box = BuildingWear.roofBox(def);
        if (!box) return 0;
        // (never over a chimney: the columns a chimney stands in keep their moss to the eaves)
        const chimneys = new Set();
        for (const lyr of ['floor', 'walls', 'roof', 'overlay']) {
            for (const cell of (def.layers && def.layers[lyr]) || []) if (/chimney/i.test(cell.sheetPath || '')) { chimneys.add(cell.q); chimneys.add(cell.q + 1); }
        }
        let n = 0;
        const smooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = true;
        for (const lyr of ['floor', 'walls', 'roof', 'overlay']) {
            for (const cell of (def.layers && def.layers[lyr]) || []) {
                if (!ROOF_TILES.test(cell.sheetPath || '')) continue;
                // (not on the gable ends' trim)
                if (cell.q === box.q0 || cell.q === box.q1) continue;
                const eave = cell.r === box.r1;
                if (!eave && chimneys.has(cell.q)) continue;
                const p = (wear >= 2 ? 0.5 : 0.22) * (eave ? 1.8 : cell.r === box.r0 ? 0.5 : 1);
                if (_hash(key, cell.q, cell.r) >= p) continue;
                // a few tufts in the cell, the eave's along its lower edge where the rain runs off
                const tufts = 1 + Math.floor(_hash(key, 'n', cell.q, cell.r) * (wear >= 2 ? 3 : 2));
                for (let i = 0; i < tufts; i++) {
                    const d = decals[Math.floor(_hash(key, 'd', cell.q, cell.r, i) * decals.length)];
                    const w = ds * (0.4 + 0.4 * _hash(key, 'w', cell.q, cell.r, i));
                    const hh = w * 0.45;
                    const x = ax + cell.q * ds + (ds - w) * _hash(key, 'x', cell.q, cell.r, i);
                    const y = ay + cell.r * ds + (eave ? ds * (0.62 + 0.2 * _hash(key, 'y', cell.q, cell.r, i)) - hh * 0.5 : (ds - hh) * _hash(key, 'y', cell.q, cell.r, i)) + (sag ? sag(cell) : 0);
                    ctx.globalAlpha = (wear >= 2 ? 0.8 : 0.65) * (0.75 + 0.25 * _hash(key, 'a', cell.q, cell.r, i));
                    ctx.drawImage(d, Math.floor(x), Math.floor(y), Math.round(w), Math.round(hh));
                    n++;
                }
            }
        }
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = smooth;
        return n;
    },

    /**
     * A landmark's belltower (data/townEras.json art.spires: a style's 2 x 5 cells of the
     * spire sheet), standing over the middle of the building's ridge, its foot on the
     * roof's top row. Returns whether it drew.
     */
    spireOn(ctx, def, ax, ay, ds, style) {
        const S = DataLoader._gamedata && DataLoader._gamedata.townEras && DataLoader._gamedata.townEras.art && DataLoader._gamedata.townEras.art.spires;
        const i = S && Array.isArray(S.styles) ? S.styles.indexOf(style) : -1;
        if (i < 0) return false;
        const img = _sheet(S.sheet);
        if (!img || !img.complete || !img.naturalWidth) return false;
        const box = BuildingWear.roofBox(def);
        const b = def.bounds || { minCol: -1, maxCol: 1, minRow: -3 };
        const q0 = box ? box.q0 : b.minCol, q1 = box ? box.q1 : b.maxCol, rTop = box ? box.r0 : b.minRow;
        const k = sheetScale(img);
        // (drawn half again its cells' size: a belltower stands well over a man and his roof)
        const w = 2 * ds * 1.6, h = 5 * ds * 1.6;
        const x = ax + ((q0 + q1 + 1) / 2) * ds - w / 2;
        // (its foot a little down the roof's top row, as if it rose out of the ridge)
        const y = ay + (rTop + 1.1) * ds - h;
        const smooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, i * 64 * k, 0, 64 * k, 160 * k, Math.floor(x), Math.floor(y), Math.round(w), Math.round(h));
        ctx.imageSmoothingEnabled = smooth;
        return true;
    },

    /** Grime up the foot of a worn building's walls (its lowest row of wall cells). */
    grimeOn(ctx, def, ax, ay, ds, cs, wear) {
        if (!wear) return 0;
        let bottom = -Infinity;
        const walls = [];
        for (const lyr of ['floor', 'walls']) {
            for (const cell of (def.layers && def.layers[lyr]) || []) {
                if (!WALL.test(cell.sheetPath || '')) continue;
                walls.push(cell);
                if (cell.r > bottom) bottom = cell.r;
            }
        }
        let n = 0;
        const a = wear >= 2 ? 0.5 : 0.3;
        for (const cell of walls) {
            if (cell.r !== bottom) continue;
            const x = Math.floor(ax + cell.q * ds), y = Math.floor(ay + cell.r * ds);
            const g = ctx.createLinearGradient(0, y + cs * 0.45, 0, y + cs);
            g.addColorStop(0, 'rgba(34, 30, 18, 0)');
            g.addColorStop(1, `rgba(34, 30, 18, ${a})`);
            ctx.fillStyle = g;
            ctx.fillRect(x, Math.floor(y + cs * 0.45), cs, Math.ceil(cs * 0.55));
            n++;
        }
        return n;
    },
};

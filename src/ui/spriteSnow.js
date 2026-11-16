// ============================================================
// SPRITE SNOW — winter on the street map's object sprites
// ============================================================
// The kit buildings' roofs are snowed on in their kept canvases
// (innerMapLayers/streetSeasons.js _seasonRoofSnow). This does the same for
// what is not a kit building: a camp's tents, the market square's stalls, a
// well's little roof (data/townProps.json snowRoofs) and a Guild Age
// landmark's belltower cap (data/townEras.json art.spires.snowCaps).
//
// Each snowable sprite names its roof as a band of its height ([top, bottom],
// fractions from the sprite's top): only the canopy, the tent's top or the
// spire's cap is snowed, never the poles, the goods, the counter or the walls.
// The snow is the roofs' look: the colour partly drained and lifted toward a
// bluish white (a screen, so the stripes and courses still read), kept to
// the sprite's own opaque pixels, brightest along its top edges where it
// lies thickest; a dark opening (a tent's doorway) keeps most of its shadow.
// Level 1 is a dusting over the band's upper part, 3 full cover down to its
// foot.
//
// The pixel pass (snowPixels) is pure, for the tests; SpriteSnow keeps each
// snowed cell (an object's 32px cell, a spire style) per snow level, made
// once, so a frame only blits.

import { DataLoader } from '../core/dataLoader.js';

/** The roofs' snow per level 1-3 (as _seasonRoofSnow): how much colour drains, the screen's tint. */
export const SNOW_DESAT = [0.45, 0.65, 0.8];
export const SNOW_TINT = [[110, 118, 130], [150, 160, 176], [182, 193, 210]];
/** How far down its band the snow reaches per level (a dusting keeps to the top). */
const REACH = [0.72, 0.9, 1];

function _smooth(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/**
 * How much snow lies at height `f` of a sprite (0 its top, 1 its foot) with the roof
 * `band` [top, bottom] at snow `level` (1-3): 1 over the roof, fading out toward the
 * foot of the reach, 0 above its top (a flag, a finial) and below.
 */
export function snowWeight(f, band, level) {
    if (!band || !level) return 0;
    const L = Math.max(1, Math.min(3, level | 0));
    const a = band[0], b = a + (band[1] - a) * REACH[L - 1];
    if (!(b > a) || f < a || f > b) return 0;
    const fade = (b - a) * 0.28, lead = Math.min(0.02, (b - a) * 0.1);
    const top = lead > 0 ? Math.min(1, (f - a) / lead) : 1;
    return Math.min(top, f > b - fade ? (b - f) / fade : 1);
}

/**
 * Snow over RGBA pixels in place (`data` w x h, row-major). `rowF(y)` gives the share of
 * the sprite's height row y stands at (0 top .. 1 foot); `band` the roof's [top, bottom];
 * `rim` how many pixels deep the bright edge lies along the sprite's tops; `above` an
 * optional count of rows at the top of `data` that only give the rim context (read, not
 * changed). Alpha is never changed: the snow stays on the sprite's own pixels. Returns how
 * many pixels it snowed on.
 */
export function snowPixels(data, w, h, level, band, rowF, rim = 1, above = 0) {
    if (!level || !band) return 0;
    const L = Math.max(1, Math.min(3, level | 0));
    const d = SNOW_DESAT[L - 1], T = SNOW_TINT[L - 1];
    const rimA = [0.35, 0.5, 0.65][L - 1];
    let n = 0;
    for (let y = above; y < h; y++) {
        const wt = snowWeight(rowF(y), band, L);
        if (wt <= 0) continue;
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (data[i + 3] < 16) continue;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const lum = 0.3 * r + 0.59 * g + 0.11 * b;
            // drained toward its own grey, then screened toward the bluish white
            let r2 = r + (lum - r) * d, g2 = g + (lum - g) * d, b2 = b + (lum - b) * d;
            r2 = 255 - (255 - r2) * (255 - T[0]) / 255;
            g2 = 255 - (255 - g2) * (255 - T[1]) / 255;
            b2 = 255 - (255 - b2) * (255 - T[2]) / 255;
            // (a dark opening, a doorway's shadow, keeps most of its dark)
            let k = wt * (0.3 + 0.7 * _smooth(18, 64, lum));
            // the top edge: the snow lies thickest where nothing is above it
            let edge = false;
            for (let j = 1; j <= rim && !edge; j++) {
                const yy = y - j;
                if (yy >= 0 && data[(yy * w + x) * 4 + 3] < 96) edge = true;
            }
            if (edge) {
                r2 += (250 - r2) * rimA; g2 += (252 - g2) * rimA; b2 += (255 - b2) * rimA;
                k = Math.max(k, wt);
            }
            data[i] = Math.round(r + (r2 - r) * k);
            data[i + 1] = Math.round(g + (g2 - g) * k);
            data[i + 2] = Math.round(b + (b2 - b) * k);
            n++;
        }
    }
    return n;
}

function _townProps() {
    return (DataLoader.get && DataLoader.get('townProps')) || (DataLoader._gamedata && DataLoader._gamedata.townProps) || null;
}

const _bandOf = new WeakMap();
/** The roof band [top, bottom] of an object def (data/townProps.json snowRoofs), or null. */
export function objectSnowBand(def) {
    if (!def) return null;
    if (_bandOf.has(def)) return _bandOf.get(def);
    const S = (_townProps() || {}).snowRoofs;
    const b = S && Array.isArray(S[def.id]) && S[def.id].length >= 2 ? S[def.id] : null;
    _bandOf.set(def, b);
    return b;
}

/**
 * Which part of an object cell `td` (of `def`, its rows bounds.minRow..0) the band covers:
 * [f0, f1] the shares of the object's height its top and foot stand at, or null when
 * the snow does not reach it (or it is a ware set smaller on a counter).
 */
export function cellSpan(def, td, band, level) {
    if (!band || !level || !td || (td.scale > 0 && td.scale !== 1)) return null;
    const b = def && def.bounds;
    const minRow = b ? b.minRow : 0, maxRow = b && b.maxRow != null ? b.maxRow : 0;
    const H = maxRow - minRow + 1;
    if (!(H > 0)) return null;
    const f0 = (td.localRow - minRow) / H, f1 = f0 + (td.sh || 32) / 32 / H;
    const L = Math.max(1, Math.min(3, level | 0));
    const a = band[0], z = a + (band[1] - a) * REACH[L - 1];
    if (f1 <= a || f0 >= z) return null;
    return [f0, f1];
}

function _canvas(w, h) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    return c;
}

/**
 * Snow a region (sx, sy, sw, sh: the image's own pixels) of `img` onto a canvas its size;
 * the rows from `f0` to `f1` of the sprite's height. A few rows above it are read for the
 * rim (the cell above in the same sheet). Null when it cannot (not loaded, a tainted sheet).
 */
function _snowRegion(img, sx, sy, sw, sh, level, band, f0, f1, rim) {
    const pad = Math.min(sy, rim);
    const c = _canvas(sw, sh + pad);
    if (!c) return null;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.imageSmoothingEnabled = false;
    g.drawImage(img, sx, sy - pad, sw, sh + pad, 0, 0, sw, sh + pad);
    let im;
    try { im = g.getImageData(0, 0, sw, sh + pad); } catch (e) { return null; }
    snowPixels(im.data, sw, sh + pad, level, band, y => f0 + ((y - pad + 0.5) / sh) * (f1 - f0), rim, pad);
    g.putImageData(im, 0, 0);
    // (kept on a canvas of its own, not the one read back: a canvas made to be read lives in
    // memory, not on the GPU, and blitting it would upload it again every frame)
    const out = _canvas(sw, sh);
    out.getContext('2d').drawImage(c, 0, pad, sw, sh, 0, 0, sw, sh);
    return out;
}

const _cells = new WeakMap();   // td -> [canvas|false per level 1-3]
const _spires = new Map();      // `${sheet}|${style}|${level}` -> canvas|false

export const SpriteSnow = {
    /**
     * The snowed drawing of an object's cell `td` (of `def`, from `img`, a sheet drawn at
     * `k` times its 32px grid) at snow `level`, or null to draw it plain: its own
     * canvas, the cell's sheet pixels, made on first sight and kept.
     */
    cell(def, td, img, k, level) {
        if (!level) return null;
        const band = objectSnowBand(def);
        if (!band) return null;
        let arr = _cells.get(td);
        const L = Math.max(1, Math.min(3, level | 0));
        if (arr && arr[L] !== undefined) return arr[L] || null;
        const span = cellSpan(def, td, band, L);
        if (!arr) { arr = []; _cells.set(td, arr); }
        if (!span) { arr[L] = false; return null; }
        if (!img || !img.complete || !img.naturalWidth) return null;   // (not kept: it loads)
        const c = _snowRegion(img, Math.round(td.sx * k), Math.round(td.sy * k), Math.round((td.sw || 32) * k), Math.round((td.sh || 32) * k),
            L, band, span[0], span[1], Math.max(1, Math.round(k)));
        arr[L] = c || false;
        return c;
    },

    /** The spire caps' bands (data/townEras.json art.spires.snowCaps), by style. */
    spireBand(spires, style) {
        const S = spires && spires.snowCaps;
        return S && Array.isArray(S[style]) ? S[style] : null;
    },

    /**
     * A belltower `style` (its 64 x 160 cell of the spire sheet `img`, `k` times that) with
     * snow on its cap at `level`, or null to draw it plain.
     */
    spire(spires, img, style, i, k, level) {
        if (!level || !img || !img.complete || !img.naturalWidth) return null;
        const band = this.spireBand(spires, style);
        if (!band) return null;
        const L = Math.max(1, Math.min(3, level | 0));
        const key = `${spires.sheet}|${style}|${L}`;
        if (_spires.has(key)) return _spires.get(key) || null;
        const c = _snowRegion(img, Math.round(i * 64 * k), 0, Math.round(64 * k), Math.round(160 * k), L, band, 0, 1, Math.max(1, Math.round(k * 1.5)));
        _spires.set(key, c || false);
        return c;
    },
};

// Ground marks — mud, puddles, ruts and lingering snow drawn as pixel art on
// the LPC grid's own pixel (a cell is 32 of them), shared by the season's
// ground (innerMapLayers/streetSeasons.js, into the ground cache) and the
// hour's weather (innerMapLayers/weatherFx.js, each frame).
//
// Every mark is filled a row of sheet pixels at a time: a rounded, tapered,
// slightly ragged shape whose rows abut exactly (each edge rounded to the
// sheet's pixel on the screen), so a translucent mark never overlaps itself
// into darker boxes, and never strays out of its own cell (the ground cache
// draws a cell's marks into one chunk only). No state, nothing allocated.

/** Integer hash → 0..1. */
export function hh(q, r, k) {
    let h = (Math.imul(q | 0, 374761393) + Math.imul(r | 0, 668265263) + Math.imul(k | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const CELL = 32;
const SKY_IN_WATER = 'rgba(150, 174, 196, 0.32)';

/**
 * A rounded blob filled row by row in the current fillStyle.
 * (x, y): the cell's top-left on the screen; px: screen pixels to a sheet pixel;
 * (cx, cy): the blob's centre and (w, h) its size, in sheet pixels within the cell;
 * (a, b, k): its hash key (the ragged edge). → the rows drawn
 */
export function blob(ctx, x, y, px, cx, cy, w, h, a, b, k, lx = 0, ly = 0, lw = 0, lh = 0) {
    _spans(_L1, _R1, cx, cy, w, h, a, b, k);
    // (a lobe off one shoulder, merged row by row into the same shape: no overlap to darken)
    const lobe = lw > 0 && lh > 0;
    if (lobe) _spans(_L2, _R2, lx, ly, lw, lh, b, a, k + 3);
    let n = 0;
    for (let ry = 0; ry < CELL; ry++) {
        let l1 = _L1[ry], r1 = _R1[ry];
        if (lobe) {
            const l2 = _L2[ry], r2 = _R2[ry];
            if (l2 >= 0) {
                if (l1 < 0) { l1 = l2; r1 = r2; } else if (l2 <= r1 && l1 <= r2) { l1 = Math.min(l1, l2); r1 = Math.max(r1, r2); } else n += _row(ctx, x, y, px, ry, l2, r2);
            }
        }
        if (l1 >= 0) n += _row(ctx, x, y, px, ry, l1, r1);
    }
    return n;
}

// Scratch rows for blob(): each row's left and right edge in sheet pixels (-1: none)
const _L1 = new Int16Array(CELL), _R1 = new Int16Array(CELL), _L2 = new Int16Array(CELL), _R2 = new Int16Array(CELL);

/** One ellipse's rows into (L, R): rounded, leaning a little, its edge ragged by the hash. */
function _spans(L, R, cx, cy, w, h, a, b, k) {
    L.fill(-1); R.fill(-1);
    const rows = Math.max(1, Math.round(h));
    const top = Math.round(cy - rows / 2);
    // (a slight lean, so no two are the same ellipse)
    const lean = (hh(a, b, k + 7) - 0.5) * 0.8;
    for (let i = 0; i < rows; i++) {
        const ry = top + i;
        if (ry < 0 || ry >= CELL) continue;
        const v = ((i + 0.5) / rows) * 2 - 1;
        const half = (w / 2) * Math.sqrt(Math.max(0, 1 - v * v * 0.92));
        const jl = hh(a, b, k * 61 + i), jr = hh(b, a, k * 67 + i);
        const mid = cx + lean * v * 2;
        let l = Math.round(mid - half + (jl < 0.25 ? 1 : jl > 0.85 ? -1 : 0));
        let r = Math.round(mid + half + (jr < 0.25 ? -1 : jr > 0.85 ? 1 : 0));
        if (l < 0) l = 0;
        if (r > CELL) r = CELL;
        if (r - l < 1) continue;
        L[ry] = l; R[ry] = r;
    }
}

function _row(ctx, x, y, px, ry, l, r) {
    const sx = x + Math.round(l * px), ex = x + Math.round(r * px);
    const sy = y + Math.round(ry * px), ey = y + Math.round((ry + 1) * px);
    if (ex <= sx || ey <= sy) return 0;
    ctx.fillRect(sx, sy, ex - sx, ey - sy);
    return 1;
}

/** A run of sheet pixels along one row (a glint, a rut's ridge): (cx, cy) in sheet pixels, len long. */
export function run(ctx, x, y, px, cx, cy, len) {
    let l = Math.round(cx), r = Math.round(cx + len);
    if (l < 0) l = 0;
    if (r > CELL) r = CELL;
    if (r <= l || cy < 0 || cy >= CELL) return;
    const sx = x + Math.round(l * px), sy = y + Math.round(cy * px);
    ctx.fillRect(sx, sy, Math.max(1, x + Math.round(r * px) - sx), Math.max(1, y + Math.round((cy + 1) * px) - sy));
}

/** One sheet pixel at (cx, cy). */
export function dot(ctx, x, y, px, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= CELL || cy >= CELL) return;
    const sx = x + Math.round(cx * px), sy = y + Math.round(cy * px);
    ctx.fillRect(sx, sy, Math.max(1, x + Math.round((cx + 1) * px) - sx), Math.max(1, y + Math.round((cy + 1) * px) - sy));
}

/**
 * Where a blob of size (w, h) sits in its cell, by hash: → [cx, cy] in sheet pixels
 * (one array, reused: read it at once).
 */
const _pl = [0, 0];
export function placeIn(w, h, a, b, k) {
    const mx = Math.ceil(w / 2) + 1, my = Math.ceil(h / 2) + 1;
    _pl[0] = mx + hh(a, b, k) * Math.max(0, CELL - 2 * mx);
    _pl[1] = my + hh(b, a, k + 1) * Math.max(0, CELL - 2 * my);
    return _pl;
}

/**
 * A puddle: a wet muddy rim, the water (the sky in it), the far bank's shadow along
 * its top edge and the light caught on its near side.
 * Colours: rim, water, shade, glint (strings; rim and shade may be null). (w, h) in sheet pixels.
 */
export function puddle(ctx, x, y, px, cx, cy, w, h, a, b, rim, water, shade, glint) {
    // a second, smaller pool run into it on one side: no two puddles one oval
    const side = hh(a, b, 41) < 0.5 ? -1 : 1;
    const lw = Math.max(3, Math.round(w * 0.55)), lh = Math.max(2, h - 1);
    const lx = cx + side * w * 0.4, ly = cy + (hh(a, b, 42) < 0.5 ? -1 : 1) * h * 0.3;
    if (rim) {
        ctx.fillStyle = rim;
        blob(ctx, x, y, px, cx, cy + 0.5, w + 2, h + 1, a, b, 31, lx, ly + 0.5, lw + 2, lh + 1);
    }
    ctx.fillStyle = water;
    blob(ctx, x, y, px, cx, cy, w, h, a, b, 37, lx, ly, lw, lh);
    // the pale sky lying across its near half
    if (w >= 6) {
        ctx.fillStyle = SKY_IN_WATER;
        blob(ctx, x, y, px, cx + w * 0.08, cy + h * 0.18, Math.round(w * 0.62), Math.max(1, Math.round(h * 0.45)), a, b, 43);
    }
    const top = Math.round(cy - h / 2);
    if (shade) {
        ctx.fillStyle = shade;
        run(ctx, x, y, px, cx - w * 0.32, top, Math.max(2, Math.round(w * 0.64)));
    }
    if (glint) {
        ctx.fillStyle = glint;
        const low = top + h - 2;
        run(ctx, x, y, px, cx - w * 0.05, low, Math.max(2, Math.round(w * 0.3)));
        if (w >= 8) dot(ctx, x, y, px, Math.round(cx - w * 0.25), top + 1 + (h > 4 ? 1 : 0));
    }
}

/**
 * A wheel's rut along a road's run: a dark, broken, gently wandering groove one
 * sheet pixel wide with its raised lip beside it, continuous from cell to cell
 * (its wander and its breaks follow the map's own coordinate along the run).
 * along: true for a road running east-west. pos: the rut's place across the cell.
 */
export function rut(ctx, x, y, px, q, r, along, pos, seed, dark, lip) {
    const base = along ? q * CELL : r * CELL;
    const lane = along ? r : q;
    // (pass 0 the groove, 1 its wet floor half as wide again, 2 the lip thrown up beside it)
    for (let pass = 0; pass < (lip ? 3 : 2); pass++) {
        ctx.fillStyle = pass === 2 ? lip : dark;
        for (let i = 0; i < CELL; i++) {
            const g = base + i;
            // broken in places, in runs of a few pixels: the wheels lifted, the ground harder
            const gap = hh(Math.floor((g + seed * 3) / 7), lane, seed);
            if (gap < 0.22) continue;
            // the floor only where the groove runs deep
            if (pass === 1 && gap < 0.6) continue;
            const off = Math.round(Math.sin(g * 0.09 + seed) * 0.7 + Math.sin(g * 0.031 + seed * 3) * 1.1);
            const c = pos + off + (pass === 0 ? 0 : pass === 1 ? -1 : 1);
            if (c < 1 || c >= CELL - 1) continue;
            if (along) dot(ctx, x, y, px, i, c);
            else dot(ctx, x, y, px, c, i);
        }
    }
}

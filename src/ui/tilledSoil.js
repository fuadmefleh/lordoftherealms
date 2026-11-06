// Tilled soil laid over the ground with ragged, rounded edges: the player's
// tilled ground (ui/innerMapDigging.js) and the towns' ploughed fields
// (world/townProps.js marks their cells _fieldSoil; innerMapLayers/terrainRoads.js
// draws them). The grass (or snow, or dirt) under it stays; the soil lies on it.
//
// The sheets (scripts/terrain_modern/make_tilled_autotile.py, 128px cells, 4 across):
//   rows 0-3  by which sides carry on into tilled ground:
//             index = T*1 + R*2 + B*4 + L*8, at (index % 4, index >> 2)
//   row 4     inside corners (soil all round but one diagonal): TL, TR, BL, BR
//   row 5     plain soil (cols 0-2, picked by position)
// Every edge follows one ragged line per side that repeats each tile, so any
// two cells that meet, meet exactly.

const SHEETS = {
    dry: 'assets/lpc/Terrain/tilled_auto.png',
    wet: 'assets/lpc/Terrain/tilled_auto_wet.png',
};
const CELL = 128;
const _imgs = {};

function _sheet(which) {
    const path = SHEETS[which] || SHEETS.dry;
    if (typeof Image === 'undefined') return null;
    let img = _imgs[path];
    if (!img) { img = new Image(); img.src = path; _imgs[path] = img; }
    return img.complete && img.naturalWidth ? img : null;
}

/**
 * The sheet cell [col, row] for tilled ground whose neighbours are tilled where
 * `has(dq, dr)` says.
 */
export function tilledCell(has, q = 0, r = 0) {
    const T = has(0, -1), R = has(1, 0), B = has(0, 1), L = has(-1, 0);
    if (T && R && B && L) {
        const corner = !has(-1, -1) ? 0 : !has(1, -1) ? 1 : !has(-1, 1) ? 2 : !has(1, 1) ? 3 : -1;
        if (corner >= 0) return [corner, 4];
        return [(Math.abs((q * 73856093) ^ (r * 19349663)) >>> 0) % 3, 5];
    }
    const idx = (T ? 1 : 0) + (R ? 2 : 0) + (B ? 4 : 0) + (L ? 8 : 0);
    return [idx % 4, idx >> 2];
}

/** Draw tilled ground at screen (x, y), a tile ds across; false while the sheet loads. */
export function drawTilledSoil(ctx, has, q, r, x, y, ds, which = 'dry') {
    const img = _sheet(which);
    if (!img) return false;
    const [c, rr] = tilledCell(has, q, r);
    const k = img.naturalWidth / (4 * CELL);   // (the sheet as drawn, at whatever size it was saved)
    const sz = Math.ceil(ds) + 1;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, c * CELL * k, rr * CELL * k, CELL * k, CELL * k, Math.floor(x), Math.floor(y), sz, sz);
    ctx.imageSmoothingEnabled = smooth;
    return true;
}

// ============================================
// TILE SIDES — walls along a tile's edges
// ============================================
// Characters move tile to tile, so "the rim of this tile is not walkable" is
// expressed as blocked sides: you can stand on the tile, but no one crosses
// its blocked side (in either direction). Interiors set them per tile
// (meta.blockSides) and per 9-tile brush slot (brush.slotSides → meta.brushSides),
// as strings of the letters n, e, s, w.
//
// The interior editor carries a twin of sidesMask / sidesString /
// outerSidesForSlot in editor-core.js; tileSides.test.js keeps them in step.

export const SIDE = { n: 1, e: 2, s: 4, w: 8 };
const ORDER = ['n', 'e', 's', 'w'];

/** 'nw' / ['n','w'] / 9 → bitmask (N=1, E=2, S=4, W=8). */
export function sidesMask(spec) {
    if (typeof spec === 'number') return spec & 15;
    if (!spec) return 0;
    let m = 0;
    for (const ch of Array.isArray(spec) ? spec : String(spec)) m |= SIDE[String(ch).toLowerCase()] || 0;
    return m;
}

/** Bitmask → 'nesw'-ordered string ('' for none). */
export function sidesString(mask) {
    return ORDER.filter(k => mask & SIDE[k]).join('');
}

/** The outer sides of a 9-tile brush slot: TL → 'nw', Top → 'n', Centre → ''. */
export function outerSidesForSlot(row, col) {
    return (row === 0 ? 'n' : '') + (col === 2 ? 'e' : '') + (row === 2 ? 's' : '') + (col === 0 ? 'w' : '');
}

/**
 * Is a step of (dq, dr) from a tile with sides `fromMask` onto one with
 * `toMask` blocked? A diagonal step is blocked if either of its two
 * component sides is.
 */
export function stepBlockedBySides(fromMask, toMask, dq, dr) {
    if (!fromMask && !toMask) return false;
    if (dq > 0 && ((fromMask & SIDE.e) || (toMask & SIDE.w))) return true;
    if (dq < 0 && ((fromMask & SIDE.w) || (toMask & SIDE.e))) return true;
    if (dr > 0 && ((fromMask & SIDE.s) || (toMask & SIDE.n))) return true;
    if (dr < 0 && ((fromMask & SIDE.n) || (toMask & SIDE.s))) return true;
    return false;
}

/**
 * The sides a 9-tile brush blocks on one painted cell: its brush.slotSides
 * entry for the slot the cell uses. `has(dq, dr)` says whether the neighbour
 * at that offset is painted with the same brush. Wall brushes and inside
 * corners block none. Mirrors brushSlotSidesAt in interior_editor.html.
 */
export function brushSlotSides(brush, has) {
    if (!brush || !brush.slotSides || brush.brushType === 'wall' || brush.brushType === 'interior_wall') return 0;
    const hasTop = has(0, -1), hasBottom = has(0, 1), hasLeft = has(-1, 0), hasRight = has(1, 0);
    if (hasTop && hasBottom && hasLeft && hasRight && brush.insideCorners) {
        const ic = !has(-1, -1) ? 0 : !has(1, -1) ? 1 : !has(-1, 1) ? 2 : !has(1, 1) ? 3 : -1;
        if (ic >= 0 && brush.insideCorners[ic]) return 0;
    }
    const row = (!hasTop && hasBottom) ? 0 : (hasTop && !hasBottom) ? 2 : 1;
    const col = (!hasLeft && hasRight) ? 0 : (hasLeft && !hasRight) ? 2 : 1;
    return sidesMask(brush.slotSides[row] && brush.slotSides[row][col]);
}

// ============================================
// NINE-TILE — auto-tiling with a 9-tile brush
// ============================================
// A 9-tile brush has a 3×3 grid of tiles (corners, edges, centre), four
// inside-corner tiles for concave turns, and optional alternate centre fills.
// Which tile a cell gets depends only on which of its 8 neighbours are also
// painted with the brush.
//
// The game stamps brushes onto inner-map masks with these functions
// (world/innerMap/terrain.js), and the terrain editor paints and previews with
// the twin in editor-core.js (EditorCore.pickNineTileSlot / resolveNineTileCell
// / …), so what a modder sees is what the game draws. A test keeps them in step.

// Inside-corner index by the diagonal that is missing: 0=TL, 1=TR, 2=BL, 3=BR.
export const NINE_TILE_IC_ORDER = ['TL', 'TR', 'BL', 'BR'];

/**
 * Which brush slot a cell uses. `has(dq, dr)` says whether the neighbour at
 * that offset is in the brush. Returns { row, col } for the 3×3 grid,
 * { ic } for an inside corner, or null when the cell has no neighbour on one
 * whole axis (a one-wide strip or a stub), which no 9-tile slot can draw.
 */
export function pickNineTileSlot(has) {
    const hasTop = has(0, -1);
    const hasBottom = has(0, 1);
    const hasLeft = has(-1, 0);
    const hasRight = has(1, 0);

    // All 4 cardinals present but a diagonal missing: a concave (inside) corner
    if (hasTop && hasBottom && hasLeft && hasRight) {
        const icIdx = !has(-1, -1) ? 0 : !has(1, -1) ? 1 : !has(-1, 1) ? 2 : !has(1, 1) ? 3 : -1;
        if (icIdx >= 0) return { ic: icIdx };
    }

    if ((!hasTop && !hasBottom) || (!hasLeft && !hasRight)) return null;

    // row 0=top edge, 1=middle, 2=bottom edge; col 0=left edge, 1=middle, 2=right edge
    let row = 1;
    if (!hasTop && hasBottom) row = 0;
    else if (hasTop && !hasBottom) row = 2;
    let col = 1;
    if (!hasLeft && hasRight) col = 0;
    else if (hasLeft && !hasRight) col = 2;
    return { row, col };
}

function gridHasTile(grid) {
    return Array.isArray(grid) && grid.some(row => Array.isArray(row) && row.some(t => t && t.sheetPath));
}
function listHasTile(list) {
    return Array.isArray(list) && list.some(t => t && t.sheetPath);
}

/**
 * The grids a brush uses in a season. The editor saves a grid for every
 * season, empty ones included, so a season's grid (or inside corners) only
 * wins when it holds at least one tile; otherwise the default ones do.
 * @returns {{tilesGrid: Array|null, cornersArr: Array|null, altFills: Array|null}}
 */
export function resolveBrushSeason(brush, season) {
    const st = season && brush.seasonTiles && brush.seasonTiles[season];
    const sc = season && brush.seasonInsideCorners && brush.seasonInsideCorners[season];
    const sa = season && brush.seasonAltFills && brush.seasonAltFills[season];
    return {
        tilesGrid: gridHasTile(st) ? st : (brush.tiles || null),
        cornersArr: listHasTile(sc) ? sc : (brush.insideCorners || null),
        altFills: listHasTile(sa) ? sa : null,
    };
}

// Same hash the renderers use to vary tiles by position.
export function nineTileHash(q, r) {
    return Math.abs((q * 73856093) ^ (r * 19349663)) >>> 0;
}

/**
 * Resolve one painted cell.
 * @returns {{ slot: {row,col}|{ic}, tile: Object|null, fallback: null|'strip'|'noInsideCorner'|'empty' }}
 *   slot     — the slot actually used (centre when the ideal one cannot be drawn)
 *   tile     — that slot's tile reference, or null if the brush leaves it empty
 *   fallback — why the ideal slot was not used: a one-wide strip or stub
 *              ('strip'), an inside corner with no tile ('noInsideCorner'),
 *              or the slot used is empty ('empty')
 */
export function resolveNineTileCell(brush, season, has, q, r, resolved) {
    const { tilesGrid, cornersArr, altFills } = resolved || resolveBrushSeason(brush, season);
    let slot = pickNineTileSlot(has);
    let fallback = null;
    if (!slot) {
        slot = { row: 1, col: 1 };
        fallback = 'strip';
    } else if (slot.ic !== undefined && !(cornersArr && cornersArr[slot.ic] && cornersArr[slot.ic].sheetPath)) {
        slot = { row: 1, col: 1 };
        fallback = 'noInsideCorner';
    }

    let tile;
    if (slot.ic !== undefined) {
        tile = cornersArr[slot.ic];
    } else {
        tile = tilesGrid && tilesGrid[slot.row] ? tilesGrid[slot.row][slot.col] : null;
        // Centre: hash-pick from the alternate fills for variety
        if (slot.row === 1 && slot.col === 1 && altFills) {
            const pool = tile && tile.sheetPath ? [tile, ...altFills] : altFills;
            tile = pool[nineTileHash(q, r) % pool.length];
        }
    }
    if (!tile || !tile.sheetPath) {
        tile = null;
        if (!fallback) fallback = 'empty';
    }
    return { slot, tile, fallback };
}

/**
 * Clear cells of a boolean mask[r][q] that no 9-tile slot can draw (one-wide
 * strips and stubs), repeating because each removal can expose a new stub.
 * Mutates and returns the mask.
 */
export function erodeUntileableStubs(mask) {
    const H = mask.length;
    const W = H > 0 ? mask[0].length : 0;
    const inMask = (q, r) => r >= 0 && r < H && q >= 0 && q < W && !!mask[r][q];
    let eroded = true;
    while (eroded) {
        eroded = false;
        const toClear = [];
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (mask[r][q] && !pickNineTileSlot((dq, dr) => inMask(q + dq, r + dr))) toClear.push([r, q]);
            }
        }
        for (const [r, q] of toClear) {
            mask[r][q] = false;
            eroded = true;
        }
    }
    return mask;
}

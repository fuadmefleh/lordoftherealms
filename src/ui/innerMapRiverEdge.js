// ============================================
// INNER MAP RIVER EDGE — carried down the river into the next hex
// ============================================
// A swimmer in a river who reaches the map's edge where the river runs off it
// goes on with it into the next hex's map (ui/game/gameLoop.js _crossEdge does
// the crossing, as for a walk off the edge: the world hex, fog, arrival and
// its encounters, the clock running on), coming in on the matching edge in the
// same river, still in the water, still with the current.
//
//   • The current carries you out: drifting (not swimming somewhere) on a
//     river cell at the edge with the stream running off the map, you go on
//     downstream (gameLoop _currentStep → riverCarriesOut).
//   • You swim out on purpose: walk (swim) to a river edge cell, upstream or
//     down, and the ordinary edge crossing takes you on — into the river on
//     the far side if it runs on there (riverRunsOn), else onto the bank as
//     any crossing.
//   • The river goes no further (it ends, the sea or a lake lies beyond, the
//     world's edge, ground no one can cross): the current holds you at the
//     edge, told once.

import { InnerMap } from '../world/innerMap.js';

/** Outward from the map, by the side of the hex an edge faces (E, NE, NW, W, SW, SE) */
const OUTWARD = [[1, 0], [0, -1], [0, -1], [-1, 0], [0, 1], [0, 1]];

/** Is (q, r) river water a body is swimming in (not a bank's shallows, a bridge or a ford)? */
export function isRiverSwim(tiles, q, r) {
    const t = tiles && tiles[r] && tiles[r][q];
    return !!(t && t._wet && t._waterKind === 'river' && !t._bridge && InnerMap.isSwimmable(q, r)
        && !(t.subTerrain && t.subTerrain.passable));
}

/**
 * Does the river of world hex (q, r) cross its side `side` — flow in or out
 * by it (world/innerMap/water.js _riverSides, as the river is laid on its map)?
 */
export function riverRunsOn(world, q, r, side) {
    const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
    if (!tile || typeof InnerMap._riverSides !== 'function') return false;
    const s = InnerMap._riverSides(world, tile, q, r);
    return s.outflow === side || s.inflows.includes(side);
}

/**
 * Is the current carrying the swimmer at edge cell (q, r) out by `side`?
 * `cur` as InnerMap.currentAt gives it ({ x, y, kind }).
 */
export function riverCarriesOut(cur, side) {
    if (!cur || cur.kind !== 'river' || side == null) return false;
    const [ox, oy] = OUTWARD[side];
    return cur.x * ox + cur.y * oy > 0.25;
}

/**
 * Where to come in, in the river, on the next map: the river cell along the
 * edge facing `side` (within a few cells of it) nearest `entry` — deep water
 * first, so you are still swimming. `edgeSideOf(q, r)` tells an edge cell's
 * side (gameLoop edgeSide). Null with no river there.
 */
export function riverEntryCell(tiles, side, entry, edgeSideOf, depth = 3) {
    if (!tiles || !tiles.length) return null;
    const H = tiles.length, W = tiles[0].length;
    let best = null;
    const consider = (q, r) => {
        const t = tiles[r] && tiles[r][q];
        if (!t || !t._wet || t._waterKind !== 'river' || t._bridge || !InnerMap.isSwimmable(q, r)) return;
        const deep = !(t.subTerrain && t.subTerrain.passable);
        const d = Math.hypot(q - entry.q, r - entry.r) + (deep ? 0 : 6);
        if (!best || d < best.d) best = { q, r, d };
    };
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            const inset = Math.min(q, r, W - 1 - q, H - 1 - r);
            if (inset > depth) continue;
            // (which side this stretch of the edge faces: the nearest edge cell's)
            const e = inset === r ? [q, 0] : inset === H - 1 - r ? [q, H - 1] : inset === q ? [0, r] : [W - 1, r];
            if (edgeSideOf(e[0], e[1]) !== side) continue;
            consider(q, r);
        }
    }
    return best && { q: best.q, r: best.r };
}

// The cells of the cave sheet (assets/lpc/new/cave_tiles.png, built by
// scripts/build_cave_tiles.py from the LPC cliff sheet) that draw an
// underground tile, and the drifts and shafts on the street map. Pure: no
// canvas, so the renderer (ui/innerMapLayers/caves.js) and the tests share it.
//
// Sheet: 8 x 8 cells, 32px logical (drawn at 4x: 1024px wide).
//   row 0  floor (4 sand variants), trodden floor, rubble, loose stones, crystal
//   row 1  rock face meeting the floor: middle, left end, right end, both ends;
//          then the same with the rock's rim along its top (open ground above)
//   rows 2-3  the rock's top: 16 rims by the open sides (N 1, E 2, S 4, W 8)
//   row 4  ore in the face: ore, copper, tin, silver, gold, coal, gems, salt
//   row 5  timbers, ladder up, daylight at the mouth, a drift cracked / hollowed / open
//   row 6  a shaft: pit, deeper pit, timber collar, collar and ladder

export const CAVE_SHEET = 'assets/lpc/new/cave_tiles.png';
/** The sheet's logical width (its cells are addressed in 32px units at this width). */
export const CAVE_BASE_WIDTH = 256;

const ORE = { ore: 0, copper: 1, tin: 2, silver_ore: 3, gold_ore: 4, coal: 5, gems: 6, salt: 7 };

const _open = t => !!(t && (t._cave === 'floor' || t._cave === 'exit' || t._cave === 'rubble'));
const _rock = t => !t || t._cave === 'rock';
/** Is this rock a face (open ground below it)? */
const _face = (at, q, r) => _rock(at(q, r)) && !!at(q, r) && _open(at(q, r + 1));

/**
 * The cells to draw, in order, for the underground tile at (q, r).
 * at(q, r) → the tile there or null. site: 'cave' | 'adit' | 'shaft' (the way out).
 * → [[col, row], …]
 */
export function caveCells(at, q, r, site = 'cave') {
    const t = at(q, r);
    if (!t) return [];
    const out = [];
    if (t._cave !== 'rock') {
        const v = ((Math.imul(q, 73856093) ^ Math.imul(r, 19349663)) >>> 0) & 3;
        if (t._cave === 'exit') {
            out.push(site === 'shaft' ? [v, 0] : [2, 5]);
            if (site === 'shaft') out.push([1, 5]);
            return out;
        }
        out.push(t._mined ? [4, 0] : [v, 0]);
        if (t._cave === 'rubble') out.push([5, 0]);
        else if (t._loose === 'stone') out.push([6, 0]);
        else if (t._loose === 'crystal') out.push([7, 0]);
        if (t._support) out.push([0, 5]);
        return out;
    }
    if (_open(at(q, r + 1))) {
        // A face: closed at an end where open ground meets it from the side; its rim on top where open above
        const w = _open(at(q - 1, r)), e = _open(at(q + 1, r));
        const i = w && e ? 3 : w ? 1 : e ? 2 : 0;
        out.push([_open(at(q, r - 1)) ? 4 + i : i, 1]);
        const ore = t._vein != null ? ORE[t._vein] : undefined;
        if (ore !== undefined) out.push([ore, 4]);
        return out;
    }
    // The rock's top: a rim along each side open ground (or a face below) meets it
    const N = _open(at(q, r - 1)) ? 1 : 0;
    const E = (_open(at(q + 1, r)) || _face(at, q + 1, r)) ? 2 : 0;
    const S = _face(at, q, r + 1) ? 4 : 0;
    const W = (_open(at(q - 1, r)) || _face(at, q - 1, r)) ? 8 : 0;
    const m = N | E | S | W;
    out.push([m % 8, 2 + (m >> 3)]);
    return out;
}

/** The cell over a rock face being cut into a drift (stage of stages; open: through). */
export function aditCell(stage, stages, open) {
    if (open) return [5, 5];
    if (!(stage > 0)) return null;
    return stage / Math.max(1, stages) < 0.5 ? [3, 5] : [4, 5];
}

/** The cell over the ground where a shaft is being sunk. */
export function shaftCell(stage, stages, open) {
    if (open) return [3, 6];
    if (!(stage > 0)) return null;
    return [Math.min(2, Math.floor((stage - 1) * 3 / Math.max(1, stages - 1))), 6];
}

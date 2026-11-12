// ============================================================
// TOWN WALLS — a palisade, later stone, round a town that raised them
// ============================================================
// A town's walls (world/townEras.js: settlement.townEra.walls) stand on its
// street map as a ring of one-tile pieces round everything it has built —
// its houses, gardens, lots, square and churchyard — with gates where its
// roads run out, a tower either side of each gate in stone and at each
// corner. Laid by the planner after the town is dressed and before its
// farmland (world/townPlanner.js), so the fields lie round the walls.
//
// The art is tile-composed (scripts/make_town_walls.py: assets/buildingKit/
// town_walls.png, from the building kit's wall tiles and the street sheet's
// stone). Each piece is an editor object (CustomObjects): its footprint
// blocks; it draws its face (stone: two rows, a palisade: one) on its own
// tile and the rows above, and its top — the wall walk or the stake tips,
// joined to the sides it joins (16 masks) — above that, so a run going north
// shows as its top seen from above and a run going east as its face.
//
// Pure: hashes nothing, draws no dice: the same town, the same walls.

import { DataLoader } from '../core/dataLoader.js';

const T = 32;
const ROWS = { stone: 2, palisade: 1 };
/** The widest gate drawn as one piece (wider ones are left open). */
const GATE_MAX = 6;

function _art() {
    const d = DataLoader._gamedata && DataLoader._gamedata.townEras;
    return (d && d.art) || null;
}

function _mats() {
    const A = _art();
    return A && A.materials ? Object.entries(A.materials) : [];
}

/** The four sides a piece joins: n=1 e=2 s=4 w=8. */
export const WALL_N = 1, WALL_E = 2, WALL_S = 4, WALL_W = 8;

export const TownWalls = {
    /** A piece's id: tw_<material>_<mask> (0..15), or tw_<material>_tower. */
    pieceId(material, mask, tower = false) {
        return `tw_${material}_${tower ? 'tower' : mask}`;
    },

    /** A gate piece's id: tw_<material>_gate<k> (stone) or tw_<material>_gate<k>_<mask> (palisade). */
    gateId(material, k, mask = null) {
        return `tw_${material}_gate${k}${mask == null ? '' : `_${mask}`}`;
    },

    isWall(id) {
        return typeof id === 'string' && id.startsWith('tw_');
    },

    /** How many rows of face a kind of wall stands. */
    rows(kind) {
        return ROWS[kind] || 2;
    },

    /** Every piece of every material, for CustomObjects to register. */
    defs() {
        const A = _art();
        if (!A || !A.sheet) return [];
        const out = [];
        _mats().forEach(([key, m], band) => {
            const stone = m.kind === 'stone';
            const h = TownWalls.rows(m.kind);
            const y0 = band * 3;
            const cellAt = (col, row, localRow, localCol = 0) => ({ localCol, localRow, sheetPath: A.sheet, sx: col * T, sy: (y0 + row) * T, sw: T, sh: T });
            const faceCells = (idx, rows) => {
                const cells = [];
                for (let k = 0; k < rows; k++) {
                    // (stone: the upper course over the lower, the lowest at the foot; a palisade one row)
                    const row = stone ? (k === rows - 1 ? 2 : 1) : 1;
                    cells.push(cellAt(idx, row, -(rows - 1 - k)));
                }
                return cells;
            };
            const piece = (id, tiles) => ({
                id, name: m.name || 'Town Wall',
                objectType: 'decoration', terrainBindings: [], spawnWeight: 0,
                townProp: true, townWall: m.kind, wallMaterial: key,
                tags: ['wall', m.kind],
                bounds: { minCol: 0, minRow: Math.min(0, ...tiles.map(t => t.localRow)), maxCol: Math.max(0, ...tiles.map(t => t.localCol)), maxRow: 0 },
                hasBlockedTiles: true, hasInteraction: false,
                tiles,
                // (only its footprint blocks: its face and top are drawn over the ground behind it)
                meta: [{ localCol: 0, localRow: 0, impassable: true, interactionPoint: true }],
            });
            const pieceTiles = (mask) => {
                const e = !!(mask & WALL_E), w = !!(mask & WALL_W), s = !!(mask & WALL_S);
                // Its face shows where nothing of the wall stands in front of it (a palisade's
                // east–west half shows even at a corner, the stakes running out from it)
                const face = !s || (!stone && (e || w));
                const idx = (e ? 1 : 0) + (w ? 2 : 0);
                const tiles = [];
                if (face) tiles.push(...faceCells(idx, h));
                tiles.push(cellAt(mask, 0, -h));
                return tiles;
            };
            for (let mask = 0; mask < 16; mask++) out.push(piece(TownWalls.pieceId(key, mask), pieceTiles(mask)));
            // A tower: a row taller, its face whole, crenellated all round
            const towerTiles = () => [...faceCells(0, h + 1), cellAt(16, 0, -(h + 1))];
            if (stone) out.push(piece(TownWalls.pieceId(key, 0, true), towerTiles()));
            // A gate k tiles wide in a north or south wall, drawn by the piece on its west side
            // (only that piece's own tile blocks; the road under the gate is walked):
            // stone — that piece a tower, and over the way the wall walk carried across on an
            // arch (row 1, cols 5-8: left, crown, right, a one-tile arch); a palisade — two great
            // posts and a beam across their tops (row 2: beam cols 0-3, the posts' feet cols 4-6)
            for (let k = 1; k <= GATE_MAX; k++) {
                if (stone) {
                    const tiles = towerTiles();
                    for (let c = 1; c <= k; c++) {
                        const arch = k === 1 ? 8 : c === 1 ? 5 : c === k ? 7 : 6;
                        tiles.push(cellAt(arch, 1, -(h - 1), c));
                        for (let rr = h - 2; rr >= 1; rr--) tiles.push(cellAt(3, 1, -rr - 1, c));
                        tiles.push(cellAt(WALL_E | WALL_W, 0, -h, c));
                    }
                    out.push(piece(TownWalls.gateId(key, k), tiles));
                } else {
                    for (let mask = 0; mask < 16; mask++) {
                        const tiles = pieceTiles(mask);
                        for (let c = 1; c <= k; c++) {
                            const beam = k === 1 ? 3 : c === 1 ? 0 : c === k ? 2 : 1;
                            tiles.push(cellAt(beam, 2, -1, c));
                            const foot = k === 1 ? 6 : c === 1 ? 4 : c === k ? 5 : -1;
                            if (foot >= 0) tiles.push(cellAt(foot, 2, 0, c));
                        }
                        out.push(piece(TownWalls.gateId(key, k, mask), tiles));
                    }
                }
            }
        });
        return out;
    },

    /**
     * Ring the town with walls (in place). `tiles` the street map, `kind`
     * 'palisade' | 'stone', `material` a data/townEras.json art material, `reach`
     * the planner's (q, r) → distance from the centre as a share of the town.
     * The ring is a rectangle round all the town has built (buildings, lots, the
     * square, gardens and props within the town), `margin` tiles clear of it (more
     * to the south, where the wall's face rises over the ground inside), held two
     * tiles in from the map's edge; a gate where a road crosses it.
     * Returns { pieces, gates, box } or null.
     */
    lay(tiles, { kind, material, reach, margin = 2 } = {}) {
        if (!tiles || !tiles.length || !kind || !material) return null;
        const H = tiles.length, W = tiles[0].length;
        const h = TownWalls.rows(kind);
        const stone = kind === 'stone';
        let q0 = Infinity, q1 = -Infinity, r0 = Infinity, r1 = -Infinity;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = tiles[r][q];
                if (!t) continue;
                // (its houses, the square and the churchyard, and what stands among them: its empty
                // building lots and the ground beyond are left outside, to be built on as it grows)
                const built = t.customBuilding || t.customBuildingPart || t._plaza || t._grave
                    || ((t.customObject || t.customObjectPart) && (!reach || reach(q, r) <= 0.95));
                if (!built) continue;
                if (q < q0) q0 = q; if (q > q1) q1 = q;
                if (r < r0) r0 = r; if (r > r1) r1 = r;
            }
        }
        if (!Number.isFinite(q0)) return null;
        // (a building's anchor row is its foot: its roof reaches up the rows above, all counted)
        const box = {
            q0: Math.max(2, q0 - margin - 1),
            q1: Math.min(W - 3, q1 + margin + 1),
            // the north wall's top rises over the ground outside: room for it above
            r0: Math.max(h + 2, r0 - margin - 1),
            // the south wall's face and top rise over the ground inside it
            r1: Math.min(H - 3, r1 + margin + h + 2),
        };
        // A side that would run along a lane (most of it road) is moved out past it
        const roadShare = (side) => {
            let n = 0, road = 0;
            if (side === 'r0' || side === 'r1') for (let q = box.q0; q <= box.q1; q++) { n++; if (tiles[box[side]][q].isRoad) road++; }
            else for (let r = box.r0; r <= box.r1; r++) { n++; if (tiles[r][box[side]].isRoad) road++; }
            return n ? road / n : 0;
        };
        for (const [side, step, lim] of [['r0', -1, h + 2], ['r1', 1, H - 3], ['q0', -1, 2], ['q1', 1, W - 3]]) {
            for (let i = 0; i < 8 && roadShare(side) > 0.2 && box[side] !== lim; i++) box[side] += step;
        }
        if (box.q1 - box.q0 < 8 || box.r1 - box.r0 < 8) return null;
        const ring = [];
        for (let q = box.q0; q <= box.q1; q++) { ring.push([q, box.r0]); ring.push([q, box.r1]); }
        for (let r = box.r0 + 1; r < box.r1; r++) { ring.push([box.q0, r]); ring.push([box.q1, r]); }
        const at = new Set();
        const free = (q, r) => {
            const t = tiles[r] && tiles[r][q];
            return !!t && !t.isRoad && !t.customBuilding && !t.customBuildingPart && !t.customObject && !t.customObjectPart
                && !(t.subTerrain && /water/.test(t.subTerrain.id || ''));
        };
        // A garden's fruit tree, a woodpile or a barrel on the wall's line is cleared for it
        // (a building never stands there: the ring is drawn round them all)
        // (what the prop blocked is walked again, unless the ground itself is rock or water)
        const open = t => { if (t.subTerrain && !/rock|water|cliff|mountain|wall/.test(t.subTerrain.id || '')) t.subTerrain.passable = true; };
        const clearProp = (q, r) => {
            const t = tiles[r][q];
            const aq = t.customObjectPart ? t.customObjectPart.anchorQ : q, ar = t.customObjectPart ? t.customObjectPart.anchorR : r;
            const a = tiles[ar] && tiles[ar][aq];
            if (!a || !a.customObject || TownWalls.isWall(a.customObject.defId)) return;
            a.customObject = null;
            for (let rr = ar - 8; rr <= ar; rr++) for (let qq = aq - 1; qq <= aq + 12; qq++) {
                const p = tiles[rr] && tiles[rr][qq] && tiles[rr][qq].customObjectPart;
                if (p && p.anchorQ === aq && p.anchorR === ar) { tiles[rr][qq].customObjectPart = null; open(tiles[rr][qq]); }
            }
            open(a);
        };
        for (const [q, r] of ring) {
            const t = tiles[r] && tiles[r][q];
            if (t && !t.isRoad && !t.customBuilding && !t.customBuildingPart && (t.customObject || t.customObjectPart)) clearProp(q, r);
        }
        const gates = [];
        for (const [q, r] of ring) {
            if (free(q, r)) at.add(r * W + q);
            else if (tiles[r][q] && tiles[r][q].isRoad) gates.push([q, r]);
        }
        // A gate in an east or west wall: the wall south of it rises over the road as it is drawn
        // (its face and top stand on the rows above its foot), so the wall stops short a tower's
        // height below the road, and the way through shows open
        const sideGate = new Set();
        for (const [q, r] of gates) {
            if ((q !== box.q0 && q !== box.q1) || r === box.r0 || r === box.r1) continue;
            if (tiles[r + 1] && tiles[r + 1][q] && tiles[r + 1][q].isRoad) continue;
            for (let k = 1; k <= h + (stone ? 1 : 0); k++) if (r + k < box.r1) { at.delete((r + k) * W + q); sideGate.add((r + k) * W + q); }
        }
        const has = (q, r) => q >= 0 && r >= 0 && q < W && r < H && at.has(r * W + q);
        // Towers: either side of each gate, and at the corners (stone)
        const towers = new Set();
        if (stone) {
            for (const [q, r] of [...gates, ...[...sideGate].map(k => [k % W, Math.floor(k / W)])]) {
                for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (has(q + dq, r + dr)) towers.add((r + dr) * W + q + dq);
            }
            for (const [q, r] of [[box.q0, box.r0], [box.q1, box.r0], [box.q0, box.r1], [box.q1, box.r1]]) if (has(q, r)) towers.add(r * W + q);
        }
        let pieces = 0;
        for (const k of at) {
            const q = k % W, r = Math.floor(k / W);
            const mask = (has(q, r - 1) ? WALL_N : 0) | (has(q + 1, r) ? WALL_E : 0) | (has(q, r + 1) ? WALL_S : 0) | (has(q - 1, r) ? WALL_W : 0);
            const tower = towers.has(k);
            const t = tiles[r][q];
            t.customObject = { defId: TownWalls.pieceId(material, mask, tower), sheetPath: null, currentHealthPct: 100, planted: true, townWall: kind };
            t.subTerrain.passable = false;
            t._townWall = kind;
            pieces++;
        }
        TownWalls._gatehouses(tiles, { material, kind, box, has });
        // Keep the woods, the fields and the farmsteads off the wall and the ground it rises over
        const top = h + 1;
        for (const k of at) {
            const q = k % W, r = Math.floor(k / W);
            for (let rr = r - top - 1; rr <= r + 1; rr++) {
                for (let qq = q - 1; qq <= q + 1; qq++) {
                    const t = tiles[rr] && tiles[rr][qq];
                    if (!t) continue;
                    t._townCleared = true;
                    if (!at.has(rr * W + qq)) t._reserved = true;
                }
            }
        }
        tiles._townWalls = { kind, material, box, gates: gates.length, open: sideGate.size };
        return { pieces, gates: gates.length, box };
    },

    /**
     * Each gate in the north and south walls (a run of road across the wall's line,
     * wall either side) drawn as one: the piece on its west side becomes its
     * gatehouse (stone) or gate frame (palisade), reaching over the way.
     */
    _gatehouses(tiles, { material, kind, box, has }) {
        let n = 0;
        for (const r of [box.r0, box.r1]) {
            for (let q = box.q0 + 1; q < box.q1; q++) {
                if (!has(q - 1, r) || has(q, r) || !(tiles[r][q] && tiles[r][q].isRoad)) continue;
                let k = 0;
                while (q + k < box.q1 && !has(q + k, r) && tiles[r][q + k].isRoad) k++;
                if (k < 1 || k > GATE_MAX || !has(q + k, r)) continue;
                const left = tiles[r][q - 1];
                if (kind === 'stone') left.customObject.defId = TownWalls.gateId(material, k);
                else {
                    const m = /_(\d+)$/.exec(left.customObject.defId);
                    left.customObject.defId = TownWalls.gateId(material, k, m ? Number(m[1]) : WALL_W);
                }
                left.customObject.gate = k;
                n++;
            }
        }
        return n;
    },

    /**
     * Once the water is laid (the river, the sea and the mill clear what stands in
     * their way: world/innerMap/terrain.js), join the wall's pieces anew and stand
     * a tower (stone) at each end the water broke, so the wall ends at the water's
     * edge rather than stopping short. Returns how many pieces changed.
     */
    finish(tiles) {
        const info = tiles && tiles._townWalls;
        if (!info) return 0;
        const H = tiles.length, W = tiles[0].length;
        const stone = info.kind === 'stone';
        const isW = (q, r) => q >= 0 && r >= 0 && q < W && r < H && !!(tiles[r][q] && tiles[r][q].customObject && TownWalls.isWall(tiles[r][q].customObject.defId));
        const { q0, q1, r0, r1 } = info.box;
        const onRing = (q, r) => ((r === r0 || r === r1) && q >= q0 && q <= q1) || ((q === q0 || q === q1) && r >= r0 && r <= r1);
        let changed = 0;
        // The shore's dressing may have cleared a piece on dry ground: the wall runs on to the water's edge
        for (let r = r0; r <= r1; r++) {
            for (let q = q0; q <= q1; q++) {
                if (!onRing(q, r)) continue;
                const t = tiles[r][q];
                if (!t || !t._townWall || t.isRoad || t.customObject || t.customObjectPart || t.customBuilding || t.customBuildingPart) continue;
                if (/water/.test((t.subTerrain && t.subTerrain.id) || '') || t._bridge || t._ford) continue;
                t.customObject = { defId: TownWalls.pieceId(info.material, 0), sheetPath: null, currentHealthPct: 100, planted: true, townWall: info.kind };
                t.subTerrain.passable = false;
                changed++;
            }
        }
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (!isW(q, r)) continue;
                const obj = tiles[r][q].customObject;
                if (obj.gate) continue;
                const mask = (isW(q, r - 1) ? WALL_N : 0) | (isW(q + 1, r) ? WALL_E : 0) | (isW(q, r + 1) ? WALL_S : 0) | (isW(q - 1, r) ? WALL_W : 0);
                // an end the water (or the mill) broke: the next tile along the ring is no wall, and no road
                let broken = false;
                for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nq = q + dq, nr = r + dr;
                    if (!onRing(nq, nr) || isW(nq, nr)) continue;
                    const t = tiles[nr] && tiles[nr][nq];
                    if (t && !t.isRoad) broken = true;
                }
                const tower = /_tower$/.test(obj.defId) || (stone && broken);
                const id = TownWalls.pieceId(info.material, mask, tower);
                if (id !== obj.defId) { obj.defId = id; changed++; }
            }
        }
        return changed;
    },
};

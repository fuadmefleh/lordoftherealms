// InnerMap — hand-authored interiors (interior_editor.html → CustomInteriors) given what the
// planned ones have (world/innerMap/interiorPlanner.js), so the same dressing, light and
// hour's layer work in them (ui/interiorDress.js, ui/interiorLight.js, interiorState.js).
//
// The editor's meta, cell by cell (all optional, older interiors have none of it):
//   innerWall: true            a wall within the room: impassable, drawn by the game in the
//                              building's inside wall (tile._innerWall, _wallMaterial) unless a
//                              wall sprite is painted there
//   doorway: true              an opening in an inner wall: walked through, belongs to no room
//                              (tile._doorway)
//   decor: 'mugs' | [ids]      what lies on a table, counter, shelf or the floor (tile._decor)
//   wallDecor: 'window' | [ids], wallDecorFace: 'down' | 'left' | 'right' | 'up'
//                              what hangs on a wall facing into a room — windows, curtains,
//                              torches, paintings… (tile._wallDecor, _wallDecorFace; the face
//                              worked out from the floor beside it when the author gave none)
//   room: 'Kitchen'            the name of the room the cell lies in
// The interior itself may name `wallMaterial` (an interiorArt wall: plaster, timber, stone…)
// for its drawn inner walls; else the building's own (interiors.js _interiorLook).
//
// Then its rooms (a flood of the floor between walls, doors and doorways: tile._room,
// _roomId) and its door (the tile marked door). No RNG.
import { InnerMap } from './_ref.js';
import { CustomBuildings } from './_imports.js';

const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FACES = new Set(['down', 'left', 'right', 'up']);

/** Ids from an authored field: 'mugs', ['mugs', 'bread'] or [{ type: 'mugs' }] → a clean list. */
export function authoredIds(v) {
    if (v == null || v === false) return [];
    const out = [];
    for (const x of (Array.isArray(v) ? v : [v])) {
        const id = typeof x === 'string' ? x.trim() : x && typeof x === 'object' ? String(x.type || x.id || '').trim() : '';
        if (id && !out.includes(id)) out.push(id);
    }
    return out;
}

const isFloor = (t) => !!t && t.baseTerrain !== 'wall' && t.baseTerrain !== 'void' && !t._isDoor;
const isWallTile = (t) => !!t && t.baseTerrain === 'wall' && !t._doorway;

/** The side of a wall tile its room lies: the floor below it, else beside it, else above (the front wall). */
export function authoredFace(tiles, q, r) {
    const F = (qq, rr) => (tiles[rr] && tiles[rr][qq]) || null;
    if (isFloor(F(q, r + 1))) return 'down';
    if (isFloor(F(q + 1, r))) return 'right';
    if (isFloor(F(q - 1, r))) return 'left';
    if (isFloor(F(q, r - 1))) return 'up';
    return null;
}

/**
 * Lay the authored meta's new things on an interior's tiles (in place). metaAt(q, r): the
 * cell's meta (or null). opts: { wallMaterial, wallTint }. → { rooms: [{ id, name, cells }], door }
 */
export function dressAuthoredTiles(tiles, w, h, metaAt, opts = {}) {
    const M = (q, r) => (metaAt && metaAt(q, r)) || null;
    let door = null;
    // ── Walls within and the openings in them ──
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
        const t = tiles[r] && tiles[r][q], m = M(q, r);
        if (!t) continue;
        if (t._isDoor && !door) door = { q, r };
        if (!m) continue;
        if (m.doorway && !t._isDoor) {
            t._doorway = true;
            delete t._innerWall;
            if (t.baseTerrain === 'wall' || t.baseTerrain === 'void') t.baseTerrain = 'custom_floor';
            t.subTerrain = { ...t.subTerrain, id: 'custom_floor', name: 'Doorway', icon: '🏠', passable: true };
        } else if (m.innerWall && !t._isDoor) {
            t._innerWall = true;
            t.baseTerrain = 'wall';
            t.subTerrain = { ...t.subTerrain, id: 'wall', name: 'Wall', icon: '🧱', color: '#5a4a3a', passable: false };
            if (t._furniture) t._furniture = null;
        }
        if ((t._innerWall || t.baseTerrain === 'wall') && opts.wallMaterial && !t._wallMaterial) t._wallMaterial = opts.wallMaterial;
        if (t._innerWall && opts.wallTint && !t._wallTint) t._wallTint = opts.wallTint;
    }
    // ── What lies on things, what hangs on the walls (the faces read once the walls stand) ──
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
        const t = tiles[r] && tiles[r][q], m = M(q, r);
        if (!t || !m) continue;
        const decor = authoredIds(m.decor);
        if (decor.length && !isWallTile(t) && !t._isDoor) t._decor = decor.length === 1 ? decor[0] : decor;
        const hung = authoredIds(m.wallDecor);
        if (hung.length && isWallTile(t)) {
            const face = FACES.has(m.wallDecorFace) ? m.wallDecorFace : authoredFace(tiles, q, r);
            if (face) {
                t._wallDecor = hung.length === 1 ? hung[0] : hung;
                t._wallDecorFace = face;
            }
        }
    }
    // ── Its rooms: the floor between walls, doors and doorways ──
    const named = new Map();
    const seen = new Set();
    const rooms = [];
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
        const t0 = tiles[r] && tiles[r][q];
        if (!isFloor(t0) || t0._doorway || seen.has(`${q},${r}`)) continue;
        const cells = [];
        const queue = [[q, r]];
        seen.add(`${q},${r}`);
        let name = null;
        while (queue.length) {
            const [cq, cr] = queue.shift();
            cells.push([cq, cr]);
            const m = M(cq, cr);
            if (!name && m && typeof m.room === 'string' && m.room.trim()) name = m.room.trim();
            for (const [dq, dr] of D4) {
                const nq = cq + dq, nr = cr + dr, k = `${nq},${nr}`;
                const o = tiles[nr] && tiles[nr][nq];
                if (seen.has(k) || !isFloor(o) || o._doorway) continue;
                seen.add(k);
                queue.push([nq, nr]);
            }
        }
        const n = rooms.length;
        const base = name || (n === 0 ? 'Main room' : `Room ${n + 1}`);
        const count = (named.get(base) || 0) + 1;
        named.set(base, count);
        const id = `${String(base).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'room'}${count > 1 ? `_${count}` : ''}`;
        for (const [cq, cr] of cells) { tiles[cr][cq]._room = base; tiles[cr][cq]._roomId = id; }
        rooms.push({ id, name: base, cells: cells.length });
    }
    // (the main room the biggest, as the planner's is its first)
    rooms.sort((a, b) => b.cells - a.cells);
    return { rooms, door };
}

Object.assign(InnerMap, {
    /**
     * An authored interior's tiles given its inner walls, doorways, decor, wall decor and
     * windows, its rooms and its door (interiors.js _generateCustomInterior).
     */
    _dressAuthoredInterior(tiles, w, h, def, building) {
        const oq = (def && def.bounds && def.bounds.minCol) || 0, or_ = (def && def.bounds && def.bounds.minRow) || 0;
        const metaMap = (def && def._metaMap) || {};
        let wallMaterial = def && typeof def.wallMaterial === 'string' && def.wallMaterial ? def.wallMaterial : null;
        let wallTint = null;
        if (!wallMaterial && this._interiorLook && building) {
            try {
                const base = (this.INTERIOR_LAYOUTS && (this.INTERIOR_LAYOUTS[building.type] || this.INTERIOR_LAYOUTS[String(building.type || '').replace(/^player_/, '')] || this.INTERIOR_LAYOUTS.house)) || {};
                const C = building._customDefId && CustomBuildings && CustomBuildings.getBuilding ? CustomBuildings.getBuilding(building._customDefId) : null;
                const look = this._interiorLook(C, building.type, base);
                wallMaterial = look.wall || null;
                wallTint = look.tint || null;
            } catch { /* the drawn walls take the default wall */ }
        }
        return dressAuthoredTiles(tiles, w, h, (q, r) => metaMap[`${q + oq},${r + or_}`] || null, { wallMaterial, wallTint });
    },
});

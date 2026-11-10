// ============================================
// InnerMap — the town's mill on the water
// ============================================
// The town planner (world/townPlanner.js) stands its mill at the edge of
// town, knowing nothing of water: the river, the shore and the ponds are laid
// after it (world/innerMap/water.js, harbour.js), and the river keeps clear
// of the town. Once the water lies where it will, a town with a river, a lake
// shore or the sea near it moves its mill (or, wanting one, builds one) onto
// the bank, a gable wall against the water where its wheel can hang
// (ui/innerMapLayers/ambient.js turns it), and leads a race of water in along
// that wall's foot, three cells wide, for the wheel to turn in; a pond is no
// place for a mill. With no bank that will take it, the mill stays where the planner
// put it.
//
// The mill's tile records which wall the wheel hangs on and which way the
// water runs past it: customBuilding.wheel = { side: 1 east | -1 west,
// flow: 1 the water runs left to right under it | -1 right to left | 0 still }.
//
// Worlds made since terrainGen 5 only (terrain.js); hash-placed, so it draws
// nothing from the map's generation rng and an older save's towns keep
// their plan.

import { InnerMap } from './_ref.js';
import { CustomBuildings, CustomObjects, Cultures } from './_imports.js';

/** A hash stream of a hex, its own salt */
function _rng(a, b, salt) {
    let s = (((a * 73856093) ^ (b * 19349663)) + salt) >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Water a wheel can turn in: a river, a lake or the sea (not a pond), not a bridge, a ford, a pier or a deck */
const _isWater = t => !!(t && t._wet && t._waterKind !== 'pond' && !t._bridge && !t._ford && !t._pier && !t._deck && !t.isRoad);

/** Ground a mill can stand on */
const _isGround = t => !!(t && !t._wet && !t._sea && !t.isRoad && !t._lot && !t._plaza && !t._grave && !t._pier && !t._deck
    && !t.building && !t.customBuilding && !t.customBuildingPart && !t.customObject && !t.customObjectPart);

/** How many rows up the gable wall the race runs above its foot row */
const RACE_UP = 2;

/** How much a body of water is liked for a mill: a river best, then a lake, then the sea */
const KIND_COST = { river: 0, lake: 4, sea: 6 };

Object.assign(InnerMap, {
    /**
     * Stand the town's mill on the water's edge (see the head of this file).
     * @param {Array}  tiles
     * @param {object} worldTile  the hex (its settlement)
     * @param {number} worldQ, worldR
     * @param {object} opts { arch, palette, riverPath: [{q, r}…] upstream → downstream }
     * @returns {{ q, r, side, moved, built }|null}  where it stands now, or null if it stayed put
     */
    _millByWater(tiles, worldTile, worldQ, worldR, opts = {}) {
        const settlement = worldTile && worldTile.settlement;
        if (!settlement || !CustomBuildings.isLoaded()) return null;
        const H = tiles.length, W = H ? tiles[0].length : 0;
        if (!W) return null;
        let anyWater = false;
        for (let r = 0; r < H && !anyWater; r++) for (let q = 0; q < W; q++) if (_isWater(tiles[r][q])) { anyWater = true; break; }
        if (!anyWater) return null;

        // The mill the planner stood (if any), taken up while we look
        let old = null;
        for (let r = 0; r < H && !old; r++) {
            for (let q = 0; q < W; q++) {
                const cb = tiles[r][q].customBuilding;
                const def = cb && CustomBuildings.getBuilding(cb.defId);
                if (def && def.buildingType === 'mill' && def.meta && def.bounds) { old = { def, q, r }; break; }
            }
        }
        const defs = old ? [old.def] : this._millDefs(opts);
        if (!defs.length) return null;
        if (old) this._liftBuilding(tiles, old.def, old.q, old.r);

        const spot = this._millSpot(tiles, defs, worldQ, worldR);
        if (!spot) {
            if (old) this._standBuilding(tiles, old.def, old.q, old.r);
            return null;
        }
        if (old) this._clearFlankProps(tiles, old.def, old.q, old.r);
        this._standBuilding(tiles, spot.def, spot.q, spot.r);
        // The mill race along its wall, and the water drawn afresh with it
        if (this._markWet && this._stampWater) {
            if (spot.race.length) this._markWet(tiles, spot.race, spot.kind);
            this._stampRace(tiles, spot);
        }
        tiles[spot.r][spot.q].customBuilding.wheel = { side: spot.side, flow: this._millFlow(spot, opts.riverPath) };
        // Keep the wild trees back from its walls and its wheel
        const { minCol, maxCol, minRow } = spot.def.bounds;
        for (let r = spot.r + minRow - 1; r <= spot.r + 2; r++) {
            for (let q = spot.q + minCol - 2; q <= spot.q + maxCol + 2; q++) {
                const t = tiles[r] && tiles[r][q];
                if (t && !t._wet) t._townCleared = true;
            }
        }
        return { q: spot.q, r: spot.r, side: spot.side, moved: !!old, built: !old };
    },

    /** The mills a town of this culture would build: its own, else the common ones in its materials */
    _millDefs(opts) {
        const arch = opts && opts.arch;
        const own = arch && arch.culture ? CustomBuildings.getByCulture(arch.culture, 'mill').filter(d => d.meta && d.bounds) : [];
        if (own.length) return own;
        const common = CustomBuildings.getByType('mill').filter(d => d.meta && d.bounds && !d.culture);
        const pal = opts && opts.palette;
        return pal ? [...common].sort((a, b) => Cultures.fit(pal, b) - Cultures.fit(pal, a)) : common;
    },

    /**
     * The best bank for a mill: its footprint on open ground, its door onto dry
     * land, and the foot of one gable wall in the water — the cell beside its
     * bottom corner wet, and the water running on two cells out from the wall.
     * Nearer the town and its streets is better; a river better than still water.
     */
    _millSpot(tiles, defs, worldQ, worldR) {
        const H = tiles.length, W = tiles[0].length;
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        // How far each cell is from a street (Chebyshev, capped)
        const CAP = 24;
        const roadDist = new Int16Array(W * H).fill(CAP);
        let front = [];
        for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (tiles[r][q].isRoad && !tiles[r][q]._wet) { roadDist[r * W + q] = 0; front.push(r * W + q); }
        for (let d = 1; d < CAP && front.length; d++) {
            const next = [];
            for (const i of front) {
                const q = i % W, r = (i - q) / W;
                for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
                    const x = q + dq, y = r + dr;
                    if (x < 0 || y < 0 || x >= W || y >= H) continue;
                    const k = y * W + x;
                    if (roadDist[k] > d) { roadDist[k] = d; next.push(k); }
                }
            }
            front = next;
        }
        const at = (q, r) => (q >= 0 && r >= 0 && q < W && r < H ? tiles[r][q] : null);
        const rng = _rng(worldQ, worldR, 6143);
        let best = null;
        for (const def of defs) {
            const { minCol, maxCol, minRow, maxRow } = def.bounds;
            const door = (def.meta || []).find(m => m.door) || { q: 0, r: 0 };
            for (let r = 2 - minRow; r < H - 3 - maxRow; r++) {
                for (let q = 2 - minCol; q < W - 2 - maxCol; q++) {
                    for (const side of [1, -1]) {
                        const col = side > 0 ? q + maxCol + 1 : q + minCol - 1;
                        const foot = r + maxRow;
                        // The water at the wall's foot, and open water two cells out from it (the shore
                        // cell against the wall is half bank): the wheel turns in that
                        const w0 = at(col, foot);
                        if (!_isWater(w0) || !_isWater(at(col + side, foot)) || !_isWater(at(col + side, foot + 1))
                            || !_isWater(at(col + 2 * side, foot)) || !_isWater(at(col + 2 * side, foot + 1))) continue;
                        // Its footprint on open ground (a cell clear of other buildings round it)
                        let ok = true;
                        for (const m of def.meta) {
                            if (!_isGround(at(q + m.q, r + m.r))) { ok = false; break; }
                        }
                        if (!ok) continue;
                        for (let rr = r + minRow - 1; rr <= foot + 1 && ok; rr++) {
                            for (let qq = q + minCol - 1; qq <= q + maxCol + 1; qq++) {
                                const t = at(qq, rr);
                                if (t && (t.customBuilding || t.customBuildingPart || t.building)) { ok = false; break; }
                            }
                        }
                        if (!ok) continue;
                        // The race: the water led in along the wall's foot, three cells wide so the shore
                        // drawn either side of it leaves open water between (world/innerMap/water.js draws it)
                        const race = [];
                        for (let rr = foot - RACE_UP; rr <= foot + 1 && ok; rr++) {
                            for (let k = 0; k <= 2; k++) {
                                const t = at(col + k * side, rr);
                                if (_isWater(t)) continue;
                                if (!t || t._wet || !_isGround(t) || t.q < 1 || t.r < 1 || t.q >= W - 1 || t.r >= H - 1) { ok = false; break; }
                                race.push([col + k * side, rr]);
                            }
                        }
                        if (!ok) continue;
                        // The door onto dry ground, and a step beyond it
                        const d1 = at(q + door.q, r + door.r + 1), d2 = at(q + door.q, r + door.r + 2);
                        if (!d1 || !d2 || d1._wet || d2._wet || d1.customBuilding || d1.customBuildingPart || d1.customObject || d1.customObjectPart) continue;
                        const kind = (w0 && w0._waterKind) || 'sea';
                        let score = (KIND_COST[kind] != null ? KIND_COST[kind] : 6)
                            + roadDist[(r + door.r + 1) * W + q + door.q] * 0.8
                            + Math.hypot(q - cq, r - cr) * 0.12;
                        // More water round the wheel: it hangs over the stream, not a puddle by the wall
                        for (const [dq, dr, k] of [[1, 2, 1.5], [2, 2, 1], [0, 1, 1], [1, -1, 0.5], [3, 0, 0.5], [3, 1, 0.5]]) {
                            if (_isWater(at(col + dq * side, foot + dr))) score -= k;
                        }
                        score += rng() * 0.3;
                        if (!best || score < best.score) best = { def, q, r, side, col, foot, score, race, kind };
                    }
                }
            }
        }
        return best;
    },

    /**
     * Which way the water runs under the wheel, seen on the map: 1 left to right,
     * -1 right to left, 0 still water. Along a gable wall the stream runs mostly up
     * or down the map: running down (toward the viewer) by an east wall reads as
     * running right, as if the wall were turned to face us.
     */
    _millFlow(spot, path) {
        if (!Array.isArray(path) || path.length < 3) return 0;
        const x = spot.col + spot.side * 0.5, y = spot.foot + 0.5;
        let k = 0, bestD = Infinity;
        for (let i = 0; i < path.length; i++) {
            const d = Math.hypot(path[i].q - x, path[i].r - y);
            if (d < bestD) { bestD = d; k = i; }
        }
        if (bestD > 9) return 0;
        const a = path[Math.max(0, k - 3)], b = path[Math.min(path.length - 1, k + 3)];
        const dx = b.q - a.q, dy = b.r - a.r;
        if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 1 : dx < 0 ? -1 : 0;
        return (dy > 0 ? 1 : -1) * spot.side;
    },

    /**
     * Draw the water afresh with the race in it. The shore tiles either side of
     * a channel are half bank, which would leave a strip of grass between the
     * wall and the wheel: so the wall's own column (hidden under the building)
     * counts as water while the shore is tiled, and is dry ground again after.
     */
    _stampRace(tiles, spot) {
        const { minCol, maxCol } = spot.def.bounds;
        const wq = spot.side > 0 ? spot.q + maxCol : spot.q + minCol;
        const keep = [];
        for (let rr = spot.foot - RACE_UP; rr <= spot.foot; rr++) {
            const t = tiles[rr] && tiles[rr][wq];
            if (!t || t._wet) continue;
            keep.push({ t, detail: t.terrainDetail, sub: t.subTerrain, base: t.baseTerrain });
            t._wet = true;
            t._waterKind = spot.kind;
        }
        this._stampWater(tiles);
        for (const k of keep) {
            const t = k.t;
            for (const f of ['_wet', '_waterKind', '_shallow', '_sea', '_deep']) delete t[f];
            t.terrainDetail = k.detail;
            t.subTerrain = k.sub;
            t.baseTerrain = k.base;
        }
    },

    /** Take a building off its tiles (the planner's putBuilding undone) */
    _liftBuilding(tiles, def, q, r) {
        tiles[r][q].customBuilding = null;
        for (const m of def.meta || []) {
            const t = tiles[r + m.r] && tiles[r + m.r][q + m.q];
            if (!t) continue;
            t.customBuildingPart = null;
            delete t._doorMarker;
            t.subTerrain.passable = true;
        }
    },

    /** Stand a building with its anchor at (q, r) (as the planner's putBuilding) */
    _standBuilding(tiles, def, q, r) {
        tiles[r][q].customBuilding = { defId: def.id };
        for (const m of def.meta || []) {
            const t = tiles[r + m.r][q + m.q];
            if (m.q !== 0 || m.r !== 0) t.customBuildingPart = { anchorQ: q, anchorR: r };
            if (m.door) {
                t._doorMarker = { anchorQ: q, anchorR: r, defId: def.id };
                t.subTerrain.passable = true;
            } else if (m.impassable) {
                t.subTerrain.passable = false;
            }
        }
    },

    /** The sacks and barrels the planner stood against a building's flanks, gone with it */
    _clearFlankProps(tiles, def, q, r) {
        const { minCol, maxCol } = def.bounds;
        for (const fq of [q + minCol - 1, q + maxCol + 1]) {
            const t = tiles[r] && tiles[r][fq];
            if (!t || !t.customObject || t.customObjectPart) continue;
            const d = CustomObjects.getDef(t.customObject.defId);
            if (!d || !d.bounds || d.bounds.maxCol !== d.bounds.minCol || d.bounds.maxRow !== d.bounds.minRow) continue;
            t.customObject = null;
            t.subTerrain.passable = true;
        }
    },
});

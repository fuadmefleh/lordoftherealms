// InnerMap — cliffs: raised crags in mountainous and rocky country, drawn
// from the seasonal LPC cliff sheets (assets/lpc/Terrain/cliff_<season>.png).
//
// A crag is high ground with its rim all round and a rock face below. Two
// shapes: square (a straight face, a few rows tall) and angled (the face
// sweeps round its front corners on the sheet's slanting pieces). A big one
// may carry a smaller crag on its top, a second step up. The whole of it is
// impassable to walkers: only a climber goes up a face (climbing.js). How many crags a terrain carries, how big and
// of which shape is data (data/innerMap.json → cliffs[terrain]:
// { count, width, height, face, tier, angled }).
//
//   • _layCliffs(tiles, worldTile, wq, wr): run after the water, roads,
//     buildings and lots and before the scatter of trees and objects, so a
//     crag only stands on ground nothing else has taken; none near the centre
//     (where you start) or the map's edges (where you cross to the next hex),
//     and two clear tiles between crags, so the open ground always joins up.
//   • tile._crag = { c, r }: the sheet cell to draw over the ground (null on
//     the open top of the crag, where the grass below shows through).
//   • tile._cragLevel: the height of a top (1, or 2 on a second step up); of
//     a face, the ground at its foot. Climbers go up and down the faces
//     (world/innerMap/climbing.js); nobody else does.
//
// Hash-placed from the hex's coordinates: draws nothing from the map's rng.

import { InnerMap } from './_ref.js';

// Sheet cells (col, row) of a crag with a grassy top, 32px each
const TOP = {
    tl: [5, 6], t: [2, 5], tr: [6, 6],
    l: [0, 5], r: [4, 5],
    bl: [5, 7], b: [2, 7], br: [6, 7],
};
const WALL = { l: [5, 3], m: [2, 3], r: [6, 3] }; // the rock, stacking seamlessly
const FOOT = { l: [5, 8], m: [2, 8], r: [6, 8] }; // its foot, on the grass
// The angled front: three rows, two slanting columns each side of a straight middle
const ANGLED = [
    { l: [[0, 6], [1, 6]], m: null, r: [[3, 6], [4, 6]] },     // the rim turns down the slope
    { l: [[0, 7], [1, 7]], m: [2, 7], r: [[3, 7], [4, 7]] },   // the front rim
    { l: [[0, 8], [1, 8]], m: [2, 8], r: [[3, 8], [4, 8]] },   // the foot
];

// What a freshly made tile carries; anything else set on a tile means
// something stands or happens there
const PLAIN_KEYS = new Set([
    'q', 'r', 'baseTerrain', 'subTerrain', 'encounter', 'explored', 'visible', 'parentTerrain',
    'building', 'effectiveTemp', 'moisture', 'weatherType', 'terrainDetail', 'grassOverlay',
    '_cachedFill', '_cachedOverlay',
]);

const EDGE = 4;      // clear of the map's sides
const CENTRE = 9;    // clear of where you come in
const GAP = 2;       // between crags

function _hashRng(wq, wr) {
    let s = ((wq * 73856093) ^ (wr * 19349663) ^ 0x5bd1e995) >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

const _range = (rng, v, d) => {
    const [a, b] = Array.isArray(v) ? v : [d, d];
    return a + Math.floor(rng() * (Math.max(a, b) - a + 1));
};

Object.assign(InnerMap, {
    /** Is this tile untouched ground a crag may stand on? */
    _cragGround(tile) {
        if (!tile || !tile.subTerrain || tile.subTerrain.passable === false) return false;
        if (tile.building || tile.encounter) return false;
        for (const k of Object.keys(tile)) {
            if (PLAIN_KEYS.has(k)) continue;
            const v = tile[k];
            if (v !== undefined && v !== null && v !== false) return false;
        }
        return true;
    },

    /** The crag settings for a terrain, or null when it has none. */
    cliffConfig(terrainId) {
        const c = this.CONFIG && this.CONFIG.cliffs && this.CONFIG.cliffs[terrainId];
        return c && Array.isArray(c.count) && c.count[1] > 0 ? c : null;
    },

    /** Stand crags on the map (see the head of this file). Returns how many. */
    _layCliffs(tiles, worldTile, wq, wr) {
        const terrainId = worldTile && worldTile.terrain && worldTile.terrain.id;
        const cfg = this.cliffConfig(terrainId);
        if (!cfg || !tiles || !tiles.length) return 0;
        const H = tiles.length, W = tiles[0].length;
        const rng = _hashRng(wq, wr);
        // a town's hex keeps fewer, out past its houses
        const want = Math.round(_range(rng, cfg.count, 0) * (worldTile.settlement ? 0.4 : 1));
        const taken = Array.from({ length: H }, () => new Uint8Array(W));
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        let laid = 0;

        for (let tries = 0; laid < want && tries < want * 40; tries++) {
            const w = _range(rng, cfg.width, 4);
            const angled = w >= 5 && rng() < (Number(cfg.angled) || 0);
            // (an angled crag's front is three rows; above it the top and its straight sides)
            const h = angled ? Math.max(1, _range(rng, cfg.height, 3) - 2) : _range(rng, cfg.height, 3);
            const face = angled ? ANGLED.length : _range(rng, cfg.face, 2);
            const full = h + face;
            const q0 = EDGE + Math.floor(rng() * Math.max(1, W - 2 * EDGE - w));
            const r0 = EDGE + Math.floor(rng() * Math.max(1, H - 2 * EDGE - full));
            if (q0 + w > W - EDGE || r0 + full > H - EDGE) continue;
            // clear of the centre
            const nq = Math.max(q0, Math.min(cq, q0 + w - 1)), nr = Math.max(r0, Math.min(cr, r0 + full - 1));
            if (Math.max(Math.abs(nq - cq), Math.abs(nr - cr)) < CENTRE) continue;
            // untouched ground under it and a tile round it, and clear of other crags
            let ok = true;
            for (let r = r0 - GAP; ok && r < r0 + full + GAP; r++) {
                for (let q = q0 - GAP; q < q0 + w + GAP; q++) {
                    if (taken[r][q]) { ok = false; break; }
                    const inner = r >= r0 - 1 && r <= r0 + full && q >= q0 - 1 && q <= q0 + w;
                    if (inner && !this._cragGround(tiles[r][q])) { ok = false; break; }
                }
            }
            if (!ok) continue;
            if (angled) this._standAngledCrag(tiles, q0, r0, w, h);
            else this._standCrag(tiles, q0, r0, w, h, face);
            // A second step up, on a big crag's top (clear of its rim)
            const tw = w - 4, room = angled ? h - 1 : h - 2;
            if (tw >= 3 && room >= 4 && rng() < (Number(cfg.tier) || 0)) {
                const tf = 2, th = Math.min(room - tf, 2 + Math.floor(rng() * 2));
                const tW = 3 + Math.floor(rng() * (tw - 2));            // 3 … tw wide
                const tq = q0 + 2 + Math.floor(rng() * (tw - tW + 1));  // inside the rim
                if (th >= 2 && tW >= 5 && rng() < 0.5) this._standAngledCrag(tiles, tq, r0 + 1, tW, Math.max(1, th + tf - ANGLED.length));
                else if (th >= 2) this._standCrag(tiles, tq, r0 + 1, tW, th, tf);
            }
            for (let r = r0; r < r0 + full; r++) for (let q = q0; q < q0 + w; q++) taken[r][q] = 1;
            laid++;
        }
        return laid;
    },

    _markCrag(t, cell, name) {
        if (!t) return;
        this._cragLevelOf(t, name);
        t.subTerrain = { id: 'cliff', name, icon: '🧗', color: '#6b5440', passable: false };
        t._crag = cell ? { c: cell[0], r: cell[1] } : null;
        t._cragTop = name === 'Crag';
    },

    /**
     * How high a crag tile stands (for climbing: world/innerMap/climbing.js):
     * its top one step above the ground it was raised on (a second crag on a
     * first's top: two), a face at the level of the ground at its foot.
     */
    _cragLevelOf(t, name) {
        const base = t._cragTop === true ? (t._cragLevel || 1) : 0;
        t._cragLevel = name === 'Crag' ? base + 1 : base;
    },

    /**
     * Lay one angled crag, w ≥ 5 wide: a top row of rim and `h - 1` rows of its
     * straight sides, then the front sweeping round on the slanting pieces.
     */
    _standAngledCrag(tiles, q0, r0, w, h) {
        const at = (r, q) => (tiles[r] || [])[q];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const cell = y === 0 ? (x === 0 ? TOP.tl : x === w - 1 ? TOP.tr : TOP.t)
                    : x === 0 ? TOP.l : x === w - 1 ? TOP.r : null;
                this._markCrag(at(r0 + y, q0 + x), cell, 'Crag');
            }
        }
        ANGLED.forEach((row, i) => {
            const r = r0 + h + i;
            const name = i === 0 ? 'Crag' : 'Cliff Face';
            for (let x = 0; x < w; x++) {
                const cell = x < 2 ? row.l[x] : x >= w - 2 ? row.r[x - (w - 2)] : row.m;
                this._markCrag(at(r, q0 + x), cell, name);
            }
        });
    },

    /** Lay one crag: w × h of high ground with a face `face` rows tall below it. */
    _standCrag(tiles, q0, r0, w, h, face = 2) {
        const mark = (t, cell, name) => {
            if (!t) return;
            this._cragLevelOf(t, name);
            t.subTerrain = { id: 'cliff', name, icon: '🧗', color: '#6b5440', passable: false };
            t._crag = cell ? { c: cell[0], r: cell[1] } : null;
            t._cragTop = name === 'Crag';
        };
        const row = (r) => tiles[r] || [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const top = y === 0, bot = y === h - 1, L = x === 0, R = x === w - 1;
                const cell = top ? (L ? TOP.tl : R ? TOP.tr : TOP.t)
                    : bot ? (L ? TOP.bl : R ? TOP.br : TOP.b)
                        : L ? TOP.l : R ? TOP.r : null;
                mark(row(r0 + y)[q0 + x], cell, 'Crag');
            }
        }
        for (let i = 0; i < face; i++) {
            const set = i === face - 1 ? FOOT : WALL;
            for (let x = 0; x < w; x++) {
                const cell = x === 0 ? set.l : x === w - 1 ? set.r : set.m;
                mark(row(r0 + h + i)[q0 + x], cell, 'Cliff Face');
            }
        }
    },
});

// ============================================
// LAND REGIONS — which walkable landmass a hex lies on
// ============================================
// Every hex whose terrain is passable is labelled with the id of the
// landmass it belongs to (a flood fill over Hex.neighbors, wrapping east–
// west like the map). Two hexes with different ids have water (or other
// impassable ground) between them: no overland path exists, so a walker
// should not ask the A* (Hex.findPath) for one — it would search the whole
// landmass and fail. Terrain is fixed once a world is generated (or loaded),
// so the labels are worked out once per world and its tile grid and cached;
// `invalidate` drops them should the ground ever change.
//
// Pure: no RNG, no globals — the world is passed in.

import { Hex } from '../core/hex.js';

const _cache = new WeakMap();

function walkable(tile) {
    return !!(tile && tile.terrain && tile.terrain.passable);
}

function build(world) {
    const W = world.width, H = world.height;
    const ids = new Int32Array(W * H).fill(-1);
    const sizes = [];
    const stack = [];
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            if (ids[r * W + q] !== -1 || !walkable(world.getTile(q, r))) continue;
            const id = sizes.length;
            let n = 0;
            ids[r * W + q] = id;
            stack.push(q, r);
            while (stack.length) {
                const cr = stack.pop(), cq = stack.pop();
                n++;
                for (const nb of Hex.neighbors(cq, cr)) {
                    if (nb.r < 0 || nb.r >= H) continue;
                    const nq = Hex.wrapQ(nb.q, W);
                    const i = nb.r * W + nq;
                    if (ids[i] !== -1 || !walkable(world.getTile(nq, nb.r))) continue;
                    ids[i] = id;
                    stack.push(nq, nb.r);
                }
            }
            sizes.push(n);
        }
    }
    return { tiles: world.tiles, W, H, ids, sizes };
}

function labels(world) {
    if (!world || !(world.width > 0) || !(world.height > 0) || typeof world.getTile !== 'function') return null;
    let c = _cache.get(world);
    if (!c || c.tiles !== world.tiles || c.W !== world.width || c.H !== world.height) {
        c = build(world);
        _cache.set(world, c);
    }
    return c;
}

export const LandRegions = {
    /** The landmass id of (q, r) — or -1 for water / impassable ground / off the map (null without a world grid). */
    of(world, q, r) {
        const c = labels(world);
        if (!c) return null;
        if (!Number.isFinite(q) || !Number.isFinite(r) || r < 0 || r >= c.H) return -1;
        const wq = Hex.wrapQ(q, c.W);
        const id = c.ids[r * c.W + wq];
        // (ground that changed under the labels, a peak levelled: label afresh)
        if ((id >= 0) !== walkable(world.getTile(wq, r))) {
            _cache.delete(world);
            return LandRegions.of(world, q, r);
        }
        return id;
    },

    /** Hexes on the landmass with this id (0 for -1/unknown). */
    size(world, id) {
        const c = labels(world);
        return c && id >= 0 && id < c.sizes.length ? c.sizes[id] : 0;
    },

    /**
     * Can one walk from a to b ({q, r} each) without crossing water? False when
     * either end is not walkable ground or they lie on different landmasses.
     * True (no opinion) for a world without a tile grid, e.g. a test's mock.
     */
    connected(world, a, b) {
        if (!a || !b) return false;
        const ra = LandRegions.of(world, a.q, a.r);
        if (ra === null) return true;
        const rb = LandRegions.of(world, b.q, b.r);
        return ra >= 0 && ra === rb;
    },

    /** Forget a world's labels (its ground changed). */
    invalidate(world) {
        if (world) _cache.delete(world);
    },
};

// ============================================
// InnerMap — the lists: a tournament field on open ground by the town
// ============================================
// When a tournament is held in a town (systems/lists.js; ui/innerMapTournament.js)
// its street map gets a field: the best stretch of open ground near the streets
// (never water, a road, a lot, the square, a grave, a building or anything stood
// on the map — trees, crops, fences), a little in from the map's edge. The
// layout (rows from the top, the barrier running east–west):
//
//   0–1   the stands, tiered benches of spectators facing the lists
//   3     the north lane (a rider charging east)
//   4     the tilt barrier
//   5     the south lane (a rider charging west)
//   7     the crowd on foot along the rail, the herald in the middle
//   8     the heraldic banners on their poles
//   ends  a pavilion at either end (west, east), where the riders wait
//
// Pure on the tiles: the same map gives the same field (scores are a
// hash of the hex, never the shared RNG). Tiles are not changed: while the
// lists stand (setListsStanding) the barrier, stands and pavilions are kept
// in a side index the walks read (_listsBlocks, _findPath), never on the tiles.

import { InnerMap } from './_ref.js';

/** Ground the field can be laid on. */
const _isGround = t => !!(t && t.subTerrain && t.subTerrain.passable && !t._wet && !t._sea && !t.isRoad && !t._lot
    && !t._plaza && !t._grave && !t._pier && !t._deck && !t._bridge && !t._isInterior && !t._field && !t._crop
    && !t.building && !t.customBuilding && !t.customBuildingPart && !t.customObject && !t.customObjectPart);

/** A hash of the parts → [0, 1). */
function _h(...parts) {
    let h = 2166136261 >>> 0;
    for (const p of parts) {
        const s = String(p);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 0x3b; h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

/** The sizes tried, largest first: [width, height]. */
const SIZES = [[22, 9], [18, 9], [15, 9]];
const EDGE = 2;

/** Lay out the field's parts on a w×9 rectangle with its corner at (q0, r0). */
function _layout(q0, r0, w, h, seed) {
    const L = {
        q0, r0, w, h,
        laneA: r0 + 3, barrier: r0 + 4, laneB: r0 + 5,
        // (where a run starts and ends: just out from the pavilions)
        x0: q0 + 3, x1: q0 + w - 4,
        stands: { q: q0 + 3, r: r0, w: w - 6, h: 2 },
        pavilions: [
            { q: q0, r: r0 + 2, w: 2, h: 4, side: -1 },
            { q: q0 + w - 2, r: r0 + 2, w: 2, h: 4, side: 1 },
        ],
        herald: { q: q0 + Math.floor(w / 2), r: r0 + 7 },
        // (the melee is fought on the south lane's middle, either side of the herald's line)
        ring: { q: q0 + Math.floor(w / 2), r: r0 + 6 },
        banners: [],
        crowd: [],
    };
    // The barrier's ends
    L.barrierFrom = L.x0;
    L.barrierTo = L.x1;
    // Spectators in the stands (two tiers, facing south) and along the rail (facing north)
    for (let q = L.stands.q; q < L.stands.q + L.stands.w; q++) {
        for (let k = 0; k < 2; k++) {
            if (_h(seed, 'stand', q - q0, k) < 0.72) L.crowd.push({ q, r: r0 + k, facing: 2, tier: 1 - k, i: L.crowd.length });
        }
    }
    for (let q = q0 + 3; q <= q0 + w - 4; q++) {
        if (Math.abs(q - L.herald.q) <= 1) continue;
        if (_h(seed, 'rail', q - q0) < 0.55) L.crowd.push({ q, r: r0 + 7, facing: 0, tier: -1, i: L.crowd.length });
    }
    // Banners: every few paces along the far side, and over each pavilion
    for (let q = q0 + 2; q <= q0 + w - 3; q += 4) L.banners.push({ q, r: r0 + 8, i: L.banners.length });
    for (const p of L.pavilions) L.banners.push({ q: p.q + (p.side < 0 ? 0 : 1), r: p.r - 1, i: L.banners.length, tall: true });
    return L;
}

Object.assign(InnerMap, {
    /**
     * Where the lists stand on this street map (see the head of the file), or
     * null when no open ground is big enough. Deterministic for the tiles and
     * the hex (worldQ, worldR).
     */
    listsSite(tiles, worldQ = 0, worldR = 0) {
        const H = tiles ? tiles.length : 0, W = H && tiles[0] ? tiles[0].length : 0;
        if (W < 20 || H < 14) return null;
        const seed = `${worldQ},${worldR}`;
        // Bad cells, as a summed-area table: a rectangle is clear in O(1)
        const S = new Int32Array((W + 1) * (H + 1));
        for (let r = 0; r < H; r++) {
            let row = 0;
            for (let q = 0; q < W; q++) {
                const t = tiles[r] && tiles[r][q];
                if (!_isGround(t)) row++;
                S[(r + 1) * (W + 1) + q + 1] = S[r * (W + 1) + q + 1] + row;
            }
        }
        const bad = (q, r, w, h) => S[(r + h) * (W + 1) + q + w] - S[r * (W + 1) + q + w] - S[(r + h) * (W + 1) + q] + S[r * (W + 1) + q];
        // How far each cell is from a street (Chebyshev, capped): the lists stand by the town, not out in the wilds
        const CAP = 30;
        const roadDist = new Int16Array(W * H).fill(CAP);
        let front = [];
        for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) {
            const t = tiles[r][q];
            if (t && t.isRoad && !t._wet) { roadDist[r * W + q] = 0; front.push(r * W + q); }
        }
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
        const cq = W / 2, cr = H / 2;
        for (const [w, h] of SIZES) {
            let best = null;
            for (let r = EDGE; r + h <= H - EDGE; r++) {
                for (let q = EDGE; q + w <= W - EDGE; q++) {
                    if (bad(q, r, w, h)) continue;
                    // Near a street (the herald's side, the rail, either end), near the town's middle
                    const near = Math.min(
                        roadDist[(r + h - 1) * W + q + (w >> 1)], roadDist[r * W + q + (w >> 1)],
                        roadDist[(r + 4) * W + q], roadDist[(r + 4) * W + q + w - 1]);
                    const score = Math.max(0, near - 2) * 1.5 + Math.hypot(q + w / 2 - cq, r + h / 2 - cr) * 0.08 + _h(seed, q, r) * 0.4;
                    if (!best || score < best.score) best = { q, r, score };
                }
            }
            if (best) return _layout(best.q, best.r, w, h, seed);
        }
        return null;
    },

    /** Is (q, r) on the lists (`L` from listsSite)? */
    onLists(L, q, r) {
        return !!(L && q >= L.q0 && q < L.q0 + L.w && r >= L.r0 && r < L.r0 + L.h);
    },

    /**
     * The cells the lists' solid parts take up (`L` from listsSite): the tilt
     * barrier (x0..x1 on its row), the stands, the two pavilions. The lanes, the
     * rail side, the ring and the gaps at the barrier's ends (between it and the
     * pavilions: the way round into the north lane) stay open. → [{ q, r }]
     */
    listsSolidCells(L) {
        if (!L) return [];
        const out = [];
        for (let q = L.barrierFrom; q <= L.barrierTo; q++) out.push({ q, r: L.barrier });
        const S = L.stands;
        if (S) for (let r = S.r; r < S.r + S.h; r++) for (let q = S.q; q < S.q + S.w; q++) out.push({ q, r });
        for (const p of L.pavilions || []) {
            for (let r = p.r; r < p.r + p.h; r++) for (let q = p.q; q < p.q + p.w; q++) out.push({ q, r });
        }
        return out;
    },

    // While the lists stand on this map ({ tiles, w, L, set } — the cells' index r * w + q), or null.
    // Nothing on the tiles is changed and nothing is saved: the block goes with the day, or the map.
    _listsBlock: null,

    /**
     * Raise (L) or strike (null) the lists' solid parts on the current street map:
     * the player's walk, everyone's paths (_findPath) and the townsfolk's steps go
     * round them. Called each frame by ui/innerMapTournament.js (cheap when unchanged).
     */
    setListsStanding(L) {
        if (!L) { this._listsBlock = null; return; }
        const b = this._listsBlock;
        if (b && b.L === L && b.tiles === this.tiles && b.w === this.width) return;
        const W = this.width;
        const set = new Set();
        for (const c of this.listsSolidCells(L)) {
            if (c.q >= 0 && c.r >= 0 && c.q < W && c.r < this.height) set.add(c.r * W + c.q);
        }
        this._listsBlock = { tiles: this.tiles, w: W, L, set };
    },

    /** Is (q, r) a solid part of the lists standing on this map now? */
    _listsBlocks(q, r) {
        const b = this._listsBlock;
        return !!(b && b.tiles === this.tiles && b.w === this.width && b.set.has(r * b.w + q));
    },
});

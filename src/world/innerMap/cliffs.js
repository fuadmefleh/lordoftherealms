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
// Worlds made since terrainGen 9 (BIG_GEN) lay them bigger (data/mining.json →
// crags[terrain]): a big crag carries a second step and that maybe a third
// (_tierUp), faces run three rows tall and more, and a few faces have a cave's
// mouth at their foot (_cutCaveMouth: the sheet's cave cells; its entry tile
// _caveMouth, every tile of it _caveMouthOf) leading underground
// (world/innerMap/mines.js). A face with a mouth (or a drift cut in it) is not climbed.
//
// Hash-placed from the hex's coordinates: draws nothing from the map's rng.

import { InnerMap } from './_ref.js';
import { DataLoader } from './_imports.js';

// The terrainGen from which crags are laid bigger, in up to three tiers, with caves
export const BIG_GEN = 9;
// The cave mouths on the sheet: one cell wide (col 6) or three (cols 7-9), rows 9-11
const MOUTH_ROWS = [9, 10, 11];

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

    /**
     * The bigger crags of worlds made since terrainGen 9 (data/mining.json →
     * crags[terrain]), or null when the terrain has none.
     */
    bigCragConfig(terrainId) {
        const g = DataLoader._gamedata;
        const c = g && g.mining && g.mining.crags && g.mining.crags[terrainId];
        return c && Array.isArray(c.count) && c.count[1] > 0 ? c : null;
    },

    /** Stand crags on the map (see the head of this file). Returns how many. gp: the world's generationParams. */
    _layCliffs(tiles, worldTile, wq, wr, gp = null) {
        const terrainId = worldTile && worldTile.terrain && worldTile.terrain.id;
        // Worlds made since terrainGen 9: bigger crags in tiers, with caves (_layBigCliffs)
        if ((Number(gp && gp.terrainGen) || 1) >= BIG_GEN) {
            const big = this.bigCragConfig(terrainId);
            if (big && tiles && tiles.length) return this._layBigCliffs(tiles, worldTile, wq, wr, big);
        }
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

    /**
     * Worlds since terrainGen 9: bigger crags, each big one carrying a second
     * step up and that one maybe a third, faces three rows tall and more, and
     * now and then a cave mouth at a face's foot (_cutCaveMouth). The same rules
     * of ground as _layCliffs; its own hash stream (an older world never comes here).
     */
    _layBigCliffs(tiles, worldTile, wq, wr, cfg) {
        const H = tiles.length, W = tiles[0].length;
        const rng = _hashRng(wq * 31 + 7, wr * 17 + 3);
        const want = Math.round(_range(rng, cfg.count, 0) * (worldTile.settlement ? 0.4 : 1));
        const taken = Array.from({ length: H }, () => new Uint8Array(W));
        const cq = Math.floor(W / 2), cr = Math.floor(H / 2);
        const caves = { n: 0, max: worldTile.settlement ? 0 : Math.max(0, Number(cfg.maxCaves) || 0), chance: Number(cfg.caves) || 0 };
        let laid = 0;
        for (let tries = 0; laid < want && tries < want * 40; tries++) {
            const w = _range(rng, cfg.width, 6);
            const angled = w >= 5 && rng() < (Number(cfg.angled) || 0);
            const h = angled ? Math.max(1, _range(rng, cfg.height, 5) - 2) : _range(rng, cfg.height, 5);
            const face = angled ? ANGLED.length : _range(rng, cfg.face, 3);
            const full = h + face;
            const q0 = EDGE + Math.floor(rng() * Math.max(1, W - 2 * EDGE - w));
            const r0 = EDGE + Math.floor(rng() * Math.max(1, H - 2 * EDGE - full));
            if (q0 + w > W - EDGE || r0 + full > H - EDGE) continue;
            const nq = Math.max(q0, Math.min(cq, q0 + w - 1)), nr = Math.max(r0, Math.min(cr, r0 + full - 1));
            if (Math.max(Math.abs(nq - cq), Math.abs(nr - cr)) < CENTRE) continue;
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
            else {
                this._standCrag(tiles, q0, r0, w, h, face);
                this._maybeCave(tiles, rng, caves, q0, r0, w, h, face);
            }
            this._tierUp(tiles, rng, cfg, caves, { q0, r0, w, h, angled }, 1);
            for (let r = r0; r < r0 + full; r++) for (let q = q0; q < q0 + w; q++) taken[r][q] = 1;
            laid++;
        }
        return laid;
    },

    /** A step up on a crag's top, clear of its rim: and on that, maybe another (depth: the steps already). */
    _tierUp(tiles, rng, cfg, caves, base, depth) {
        if (depth >= 3) return;
        const tw = base.w - 4, room = base.angled ? base.h - 1 : base.h - 2;
        const chance = depth === 1 ? Number(cfg.tier) || 0 : Number(cfg.tier3) || 0;
        if (tw < 3 || room < 4 || !(rng() < chance)) return;
        const tf = Math.max(2, Math.min(_range(rng, cfg.face, 3), room - 2));
        // (a step up fills most of the top under it: room on it for the next)
        const th = Math.max(2, room - tf - Math.floor(rng() * Math.min(3, Math.max(1, room - tf - 1))));
        if (th + tf > room) return;
        const tW = 3 + Math.floor((0.45 + rng() * 0.55) * (tw - 2));
        const tq = base.q0 + 2 + Math.floor(rng() * (tw - tW + 1));
        const tr = base.r0 + 1 + Math.floor(rng() * (room - th - tf + 1));
        if (th >= 2 && tW >= 5 && tf <= ANGLED.length && rng() < 0.3) {
            const ah = Math.max(1, th + tf - ANGLED.length);
            this._standAngledCrag(tiles, tq, tr, tW, ah);
            this._tierUp(tiles, rng, cfg, caves, { q0: tq, r0: tr, w: tW, h: ah, angled: true }, depth + 1);
        } else {
            this._standCrag(tiles, tq, tr, tW, th, tf);
            this._maybeCave(tiles, rng, caves, tq, tr, tW, th, tf, depth);
            this._tierUp(tiles, rng, cfg, caves, { q0: tq, r0: tr, w: tW, h: th, angled: false }, depth + 1);
        }
    },

    /** Now and then a square crag's face, three rows tall or more, has a cave in it. */
    _maybeCave(tiles, rng, caves, q0, r0, w, h, face, depth = 0) {
        if (face < MOUTH_ROWS.length || w < 3 || caves.n >= caves.max) return;
        // (most open at the ground, where anyone can walk in; fewer up on the steps)
        if (!(rng() < caves.chance * (depth > 0 ? 0.4 : 1))) return;
        const wide = w >= 6 && rng() < 0.5;
        const mw = wide ? 3 : 1;
        const x = q0 + 1 + Math.floor(rng() * (w - 1 - mw));
        if (this._cutCaveMouth(tiles, x, r0 + h + face - MOUTH_ROWS.length, mw)) caves.n++;
    },

    /**
     * A cave's mouth in a rock face: mw (1 or 3) columns from q, its three rows
     * from rTop down to the face's foot row. Its entry is the foot row's middle
     * tile (_caveMouth); each of its tiles knows it (_caveMouthOf). False if the
     * ground below the entry is no place to stand.
     */
    _cutCaveMouth(tiles, q, rTop, mw = 1) {
        const at = (r, x) => (tiles[r] || [])[x];
        const eq = q + (mw >> 1), er = rTop + MOUTH_ROWS.length - 1;
        const foot = at(er + 1, eq);
        if (!foot || !foot.subTerrain || (foot.subTerrain.id === 'cliff' && !foot._cragTop)) return false;
        for (let i = 0; i < MOUTH_ROWS.length; i++) {
            for (let j = 0; j < mw; j++) {
                const t = at(rTop + i, q + j);
                if (!t || t.subTerrain.id !== 'cliff' || t._cragTop) return false;
            }
        }
        for (let i = 0; i < MOUTH_ROWS.length; i++) {
            for (let j = 0; j < mw; j++) {
                const t = at(rTop + i, q + j);
                t._crag = { c: mw === 1 ? 6 : 7 + j, r: MOUTH_ROWS[i] };
                t._caveMouthOf = { q: eq, r: er };
            }
        }
        const entry = at(er, eq);
        entry._caveMouth = true;
        entry.subTerrain = { ...entry.subTerrain, name: 'Cave Mouth' };
        return true;
    },

    _markCrag(t, cell, name) {
        if (!t) return;
        this._cragLevelOf(t, name);
        t.subTerrain = { id: 'cliff', name, icon: '⛰️', color: '#6b5440', passable: false };
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
            t.subTerrain = { id: 'cliff', name, icon: '⛰️', color: '#6b5440', passable: false };
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

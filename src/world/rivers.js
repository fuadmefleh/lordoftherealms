// ============================================
// RIVERS — how big each river is, and what that means in play
// ============================================
// A river's size is how many river hexes run into a hex (itself counted):
// its FEED, worked out once for each world from the generated courses
// (tile.riverDir; a delta's second channel, tile.riverBranch, carries the
// river it leaves). The feed sorts every river hex into a band:
//   brook        — a stream a boat can't use, stepped over on foot
//   river        — a boat's water (systems/riverBoats.js navigable)
//   great river  — quicker boats, but a barrier on land: crossing it without
//                  a bridge, a ford or a town costs a traveller time and an
//                  army much more (crossExtra; player/core/movement.js and
//                  world/units.js updateWarHost)
// A river hex with no course recorded (painted in an editor, or a test's
// fixture) can't be measured: it counts as `unknownBand`.
//
// The navigable water (river-band hexes and up, and the lakes they run into)
// falls into NETWORKS (`net`), so two towns on one river — or a river town
// and a port, where the river reaches the sea — trade by water
// (tradeByWater: systems/marketDynamics.js riverFactor).
//
// Fords (worlds since terrainGen 17: markFords, called by
// world/terrain.js): a few shallow, wide stretches of the great rivers, on
// flat open land, well up from the mouth, marked tile._ford. Older worlds
// have none: there a great river is crossed at a road's bridge (or its
// ford/ferry), at a town, or the hard way.
//
// Pure: no randomness, no globals. Derived data only (rivers don't change in
// play), cached per world. Settings: data/rivers.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';

const WATER_IDS = new Set(['ocean', 'deep_ocean', 'coast', 'sea', 'lake']);
const SEA_IDS = new Set(['ocean', 'deep_ocean', 'coast', 'sea']);
const BANDS = ['brook', 'river', 'great'];
const RANK = { brook: 0, river: 1, great: 2 };

const DEFAULTS = {
    bands: { river: 6, great: 24 },
    unknownBand: 'river',
    names: { brook: 'brook', river: 'river', great: 'great river' },
    navigable: { minBand: 'river' },
    crossing: {
        // extra days on foot to wade/swim across a hex of the band with no crossing
        player: { brook: 0, river: 0, great: 0.5 },
        // the player at the head of an army of armyFrom units or more crosses as a host
        armyFrom: 6,
        host: { brook: 0, river: 0.25, great: 1.5 },
        // extra hexes of a day's march a war host loses crossing (world/units.js)
        army: { brook: 0, river: 0, great: 2 },
        // at a natural ford: this share of the cost
        fordShare: 0.25,
    },
    fords: {
        fromGen: 17,
        minBand: 'great',
        terrain: ['plains', 'grassland', 'savanna', 'tundra', 'desert', 'beach', 'woodland', 'seasonal_forest', 'boreal_forest', 'temperate_rainforest', 'tropical_rainforest'],
        maxDrop: 0.01,
        flatNeighbours: 4,
        minFromMouth: 4,
        spacing: 7,
        perHexes: 14,
        maxFords: 24,
    },
    boats: { great: { down: 0.8, up: 0.85 } },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

let _src;
let _cfg = null;
/** world → its derived river grid (rebuilt when its tiles are replaced). */
const _grids = new WeakMap();

export const Rivers = {
    BANDS,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.rivers;
        if (_cfg && _src === src) return _cfg;
        _src = src;
        const d = _obj(src);
        const cr = _obj(d.crossing);
        _cfg = {
            ...DEFAULTS, ...d,
            bands: { ...DEFAULTS.bands, ..._obj(d.bands) },
            names: { ...DEFAULTS.names, ..._obj(d.names) },
            navigable: { ...DEFAULTS.navigable, ..._obj(d.navigable) },
            crossing: {
                ...DEFAULTS.crossing, ...cr,
                player: { ...DEFAULTS.crossing.player, ..._obj(cr.player) },
                host: { ...DEFAULTS.crossing.host, ..._obj(cr.host) },
                army: { ...DEFAULTS.crossing.army, ..._obj(cr.army) },
            },
            fords: { ...DEFAULTS.fords, ..._obj(d.fords) },
            boats: { ...DEFAULTS.boats, ..._obj(d.boats) },
        };
        return _cfg;
    },

    /** The band for a feed: 'brook' | 'river' | 'great' */
    bandOf(feed) {
        const B = this.config().bands;
        if (feed >= _num(B.great, 24)) return 'great';
        if (feed >= _num(B.river, 6)) return 'river';
        return 'brook';
    },

    rank(band) {
        return RANK[band] ?? 0;
    },

    // ── The grid ─────────────────────────────────────────

    /**
     * How many river hexes run into each hex of a world of tiles[r][q]
     * (itself counted; a course runs by tile.riverDir, and a delta's second
     * channel carries the river it splits from). → { feed: Float32Array,
     * down: Int32Array (the next river hex down, -1), known: Uint8Array (a
     * generated course: 1) } by r * width + q. No randomness.
     */
    feedOf(tiles, width, height) {
        const W = width, H = height, N = W * H;
        const feed = new Float32Array(N);
        const down = new Int32Array(N).fill(-1);
        const known = new Uint8Array(N);
        const ins = new Uint16Array(N);
        const step = (q, r, dir) => {
            const n = Hex.neighbors(q, r)[dir];
            if (!n || n.r < 0 || n.r >= H) return -1;
            return n.r * W + Hex.wrapQ(n.q, W);
        };
        const at = (i) => tiles[Math.floor(i / W)][i % W];
        for (let r = 0; r < H; r++) {
            const row = tiles[r];
            if (!row) continue;
            for (let q = 0; q < W; q++) {
                const t = row[q];
                if (!t || !t.hasRiver) continue;
                const i = r * W + q;
                feed[i] = 1;
                if (!Number.isInteger(t.riverDir) || t.riverDir < 0 || t.riverDir > 5) continue;
                known[i] = 1;
                const j = step(q, r, t.riverDir);
                if (j < 0) continue;
                const nt = at(j);
                if (!nt || !nt.hasRiver) continue;
                down[i] = j;
                ins[j]++;
            }
        }
        // (from the springs down: a hex hands on its count once all its feeders are in)
        const stack = [];
        for (let i = 0; i < N; i++) if (feed[i] > 0 && ins[i] === 0) stack.push(i);
        while (stack.length) {
            const i = stack.pop();
            const d = down[i];
            if (d < 0) continue;
            feed[d] += feed[i];
            if (--ins[d] === 0) stack.push(d);
        }
        // A delta's second channel is as big as the river it leaves, down to the sea
        for (let r = 0; r < H; r++) {
            const row = tiles[r];
            if (!row) continue;
            for (let q = 0; q < W; q++) {
                const t = row[q];
                if (!t || !t.hasRiver || !Number.isInteger(t.riverBranch) || t.riverBranch < 0 || t.riverBranch === t.riverDir) continue;
                const f = feed[r * W + q];
                let j = step(q, r, t.riverBranch);
                for (let k = 0; j >= 0 && k < 12; k++) {
                    const bt = at(j);
                    if (!bt || !bt.hasRiver || feed[j] >= f) break;
                    feed[j] = f;
                    j = down[j];
                }
            }
        }
        return { feed, down, known };
    },

    /** The world's derived river grid, worked out once (null for a world without tiles). */
    grid(world) {
        if (!world || !Array.isArray(world.tiles) || !(world.width > 0) || !(world.height > 0)) return null;
        let g = _grids.get(world);
        if (g && g.tiles === world.tiles && g.W === world.width && g.H === world.height) return g;
        const W = world.width, H = world.height;
        const { feed, down, known } = this.feedOf(world.tiles, W, H);
        g = { tiles: world.tiles, W, H, feed, down, known, net: null, netSea: null };
        _grids.set(world, g);
        return g;
    },

    /** Forget a world's grid (a test or an editor changed its rivers). */
    reset(world) {
        if (world) _grids.delete(world);
    },

    _tile(world, q, r) {
        if (!world || typeof world.getTile !== 'function') return null;
        if (Number.isFinite(world.height) && (r < 0 || r >= world.height)) return null;
        const wq = world.width > 0 ? Hex.wrapQ(q, world.width) : q;
        return world.getTile(wq, r) || null;
    },

    _isRiverHex(t) {
        return !!(t && t.hasRiver && !(t.terrain && WATER_IDS.has(t.terrain.id)));
    },

    /** How many river hexes run into (q, r), itself counted (0: no river; null: no course recorded). */
    feed(world, q, r) {
        const t = this._tile(world, q, r);
        if (!t || !t.hasRiver) return 0;
        const g = this.grid(world);
        if (!g) return null;
        const i = r * g.W + Hex.wrapQ(q, g.W);
        if (!g.known[i] && !(g.feed[i] > 1)) return null;
        return g.feed[i];
    },

    /** The size of the river on (q, r): 'brook' | 'river' | 'great', or null (no river on land there). */
    band(world, q, r) {
        const t = this._tile(world, q, r);
        if (!this._isRiverHex(t)) return null;
        const f = this.feed(world, q, r);
        if (f == null) return BANDS.includes(this.config().unknownBand) ? this.config().unknownBand : 'river';
        return this.bandOf(f);
    },

    /** Its name in prose: 'brook' | 'river' | 'great river' */
    bandName(band) {
        return (band && this.config().names[band]) || 'river';
    },

    /** Is the river on (q, r) big enough for a boat (navigable.minBand)? */
    boatable(world, q, r) {
        const b = this.band(world, q, r);
        return !!b && this.rank(b) >= this.rank(this.config().navigable.minBand);
    },

    /** Is (q, r) → (tq, tr) one step along a river's course (either way, or a delta's split)? */
    alongCourse(world, fq, fr, tq, tr) {
        const W = world && world.width > 0 ? world.width : 0;
        const same = (a, b, c, d) => b === d && (W ? Hex.wrapQ(a, W) === Hex.wrapQ(c, W) : a === c);
        const runs = (aq, ar, bq, br) => {
            const t = this._tile(world, aq, ar);
            if (!t || !t.hasRiver) return false;
            const ns = Hex.neighbors(aq, ar);
            for (const d of [t.riverDir, t.riverBranch]) {
                if (Number.isInteger(d) && d >= 0 && d <= 5 && same(ns[d].q, ns[d].r, bq, br)) return true;
            }
            return false;
        };
        return runs(fq, fr, tq, tr) || runs(tq, tr, fq, fr);
    },

    // ── Crossing on land ─────────────────────────────────

    /**
     * How (q, r)'s river is crossed: 'town' (its bridge or ferry), 'bridge'
     * (a road's or one the player built), 'road' (a road's ford or ferry,
     * paid on the road: world/transport.js), 'ford' (a natural ford,
     * terrainGen 17), or null (no crossing: wade or swim).
     */
    crossingAt(tile) {
        if (!tile) return null;
        if (tile.settlement) return 'town';
        const inf = tile.infrastructure;
        if (inf && !inf.underConstruction && (inf.id === 'bridge' || inf.id === 'stone_road' || inf.id === 'dirt_road'
            || inf.moveCostOverride != null || inf.moveCostReduction)) return 'bridge';
        if (tile.hasRoad) return tile.roadCross === 'ford' || tile.roadCross === 'ferry' ? 'road' : 'bridge';
        if (tile._ford) return 'ford';
        return null;
    },

    /**
     * The extra a traveller pays stepping from (fq, fr) into (tq, tr) to
     * get across the river there, by the river's size — `who`: 'player'
     * (days on foot), 'host' (days, the player at the head of an army) or
     * 'army' (hexes of a war host's day's march). 0 going along the river's
     * course, onto a hex with a bridge, road or town, or where the river is
     * small; a natural ford costs crossing.fordShare of it.
     */
    crossExtra(world, fq, fr, tq, tr, who = 'player') {
        const t = this._tile(world, tq, tr);
        if (!this._isRiverHex(t) || !t.terrain || t.terrain.passable === false) return 0;
        const C = this.config().crossing;
        const table = _obj(C[who]);
        const band = this.band(world, tq, tr);
        const full = _num(table[band]);
        if (!(full > 0)) return 0;
        if (this.alongCourse(world, fq, fr, tq, tr)) return 0;
        const how = this.crossingAt(t);
        if (how === 'ford') return full * _num(C.fordShare, 0.25);
        if (how) return 0;
        return full;
    },

    /** Does the player cross rivers as a host (at the head of crossing.armyFrom units or more)? */
    crossesAsHost(player) {
        const n = player && Array.isArray(player.army) ? player.army.length : 0;
        return n >= Math.max(1, _num(this.config().crossing.armyFrom, 6));
    },

    // ── Navigable networks ───────────────────────────────

    _lakeAt(g, i) {
        const t = g.tiles[Math.floor(i / g.W)][i % g.W];
        return !!(t && t.terrain && t.terrain.id === 'lake');
    },

    /**
     * Label the navigable water into networks: boatable river hexes joined
     * down their courses (and into the lakes they reach), lakes to the lakes
     * beside them. g.net[i] = the network (-1: none); g.netSea = the set of
     * networks whose river runs out into the sea.
     */
    _nets(world) {
        const g = this.grid(world);
        if (!g) return null;
        if (g.net) return g;
        const W = g.W, H = g.H, N = W * H;
        const minRank = this.rank(this.config().navigable.minBand);
        const unknown = this.config().unknownBand;
        const water = new Uint8Array(N); // 1 boatable river, 2 lake
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = g.tiles[r][q];
                if (!t || !t.terrain) continue;
                const i = r * W + q;
                if (t.terrain.id === 'lake') { water[i] = 2; continue; }
                if (!this._isRiverHex(t)) continue;
                const band = g.known[i] || g.feed[i] > 1 ? this.bandOf(g.feed[i]) : unknown;
                if (this.rank(band) >= minRank) water[i] = 1;
            }
        }
        // union-find
        const parent = new Int32Array(N).fill(-1);
        for (let i = 0; i < N; i++) if (water[i]) parent[i] = i;
        const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
        const join = (a, b) => { const x = find(a), y = find(b); if (x !== y) parent[Math.max(x, y)] = Math.min(x, y); };
        const seaMouth = [];
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const i = r * W + q;
                if (!water[i]) continue;
                const t = g.tiles[r][q];
                const ns = Hex.neighbors(q, r);
                if (water[i] === 2) {
                    for (const n of ns) {
                        if (n.r < 0 || n.r >= H) continue;
                        const j = n.r * W + Hex.wrapQ(n.q, W);
                        if (water[j] === 2) join(i, j);
                    }
                    continue;
                }
                for (const d of [t.riverDir, t.riverBranch]) {
                    if (!Number.isInteger(d) || d < 0 || d > 5) continue;
                    const n = ns[d];
                    if (n.r < 0 || n.r >= H) continue;
                    const j = n.r * W + Hex.wrapQ(n.q, W);
                    if (water[j]) join(i, j);
                    else {
                        const nt = g.tiles[n.r][Hex.wrapQ(n.q, W)];
                        if (nt && nt.terrain && SEA_IDS.has(nt.terrain.id)) seaMouth.push(i);
                    }
                }
            }
        }
        const net = new Int32Array(N).fill(-1);
        for (let i = 0; i < N; i++) if (water[i]) net[i] = find(i);
        g.net = net;
        g.netSea = new Set(seaMouth.map(i => net[i]));
        return g;
    },

    /** The network of navigable water at (q, r), or -1 */
    netAt(world, q, r) {
        const g = this._nets(world);
        if (!g || r < 0 || r >= g.H) return -1;
        return g.net[r * g.W + Hex.wrapQ(q, g.W)];
    },

    /**
     * The networks a town at (q, r) puts its boats on: its own hex's river
     * (boatable), and any lake beside it. → array of network ids
     */
    townNets(world, q, r) {
        const g = this._nets(world);
        if (!g || r < 0 || r >= g.H) return [];
        const out = [];
        const own = g.net[r * g.W + Hex.wrapQ(q, g.W)];
        if (own >= 0) out.push(own);
        for (const n of Hex.neighbors(q, r)) {
            if (n.r < 0 || n.r >= g.H) continue;
            const j = n.r * g.W + Hex.wrapQ(n.q, g.W);
            const t = g.tiles[n.r][Hex.wrapQ(n.q, g.W)];
            if (g.net[j] >= 0 && t && t.terrain && t.terrain.id === 'lake' && !out.includes(g.net[j])) out.push(g.net[j]);
        }
        return out;
    },

    /** Does the water of network `id` run out into the sea? */
    netReachesSea(world, id) {
        const g = this._nets(world);
        return !!(g && id >= 0 && g.netSea.has(id));
    },

    /**
     * Can goods go between towns a and b by water, a river at least part of
     * the way? 'river' (on one river or lake network), 'river_sea' (down a
     * river to the sea and along the coast to a port, or another river's
     * mouth), or null. `port(s)`: is s a port (optional; from the caller).
     */
    tradeByWater(world, a, b, port = null) {
        if (!a || !b) return null;
        const na = this.townNets(world, a.q, a.r);
        const nb = this.townNets(world, b.q, b.r);
        if (!na.length && !nb.length) return null;
        if (na.some(x => nb.includes(x))) return 'river';
        const seaA = na.some(x => this.netReachesSea(world, x));
        const seaB = nb.some(x => this.netReachesSea(world, x));
        const pa = !!(port && port(a)), pb = !!(port && port(b));
        if ((seaA && (seaB || pb)) || (seaB && pa)) return 'river_sea';
        return null;
    },

    // ── Fords (terrainGen 17) ────────────────────────────

    /**
     * Mark a few natural fords on the great rivers of a new world (tiles in
     * rows, at generation: world/terrain.js since fords.fromGen): shallow,
     * wide stretches — a great river's hex on open flat land, little drop to
     * the next hex down, its banks flat, minFromMouth hexes or more up from
     * where it runs into the sea or a lake — the flattest first, no two
     * within `spacing` hexes, one per perHexes great-river hexes (at most
     * maxFords). Sets tile._ford = true. No randomness. → the number marked
     */
    markFords(tiles, width, height, cfg = null) {
        const F = { ...this.config().fords, ...(cfg || {}) };
        const W = width, H = height;
        const { feed, down, known } = this.feedOf(tiles, W, H);
        const at = (i) => tiles[Math.floor(i / W)][i % W];
        const flat = new Set(F.terrain || []);
        const minRank = this.rank(F.minBand || 'great');
        // hexes from each river hex down to the end of its river (memoised walk)
        const toMouth = new Int32Array(W * H).fill(-1);
        const mouthDist = (i) => {
            const path = [];
            let j = i;
            while (j >= 0 && toMouth[j] < 0 && path.length <= W * H) { path.push(j); j = down[j]; }
            const end = j >= 0 && toMouth[j] >= 0;
            for (let k = 0; k < path.length; k++) toMouth[path[k]] = end ? toMouth[j] + (path.length - k) : path.length - 1 - k;
            return toMouth[i];
        };
        const cands = [];
        let great = 0;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = tiles[r][q];
                if (!this._isRiverHex(t)) continue;
                const i = r * W + q;
                if (!known[i] || this.rank(this.bandOf(feed[i])) < minRank) continue;
                great++;
                if (!t.terrain || !flat.has(t.terrain.id) || t.settlement) continue;
                if (mouthDist(i) < _num(F.minFromMouth, 4)) continue;
                const d = down[i];
                const drop = d >= 0 ? Math.abs(_num(t.elevation, 0.5) - _num(at(d).elevation, 0.5)) : 1;
                if (drop > _num(F.maxDrop, 0.03)) continue;
                // (its banks: open flat land on both sides, not hills or water)
                let flatN = 0;
                for (const n of Hex.neighbors(q, r)) {
                    if (n.r < 0 || n.r >= H) continue;
                    const o = tiles[n.r][Hex.wrapQ(n.q, W)];
                    if (o && o.terrain && flat.has(o.terrain.id)) flatN++;
                }
                if (flatN < _num(F.flatNeighbours, 4)) continue;
                cands.push({ q, r, drop, feed: feed[i] });
            }
        }
        cands.sort((a, b) => a.drop - b.drop || b.feed - a.feed || a.r - b.r || a.q - b.q);
        const cap = Math.min(_num(F.maxFords, 24), Math.max(great > 0 ? 1 : 0, Math.floor(great / Math.max(1, _num(F.perHexes, 14)))));
        const spacing = _num(F.spacing, 7);
        const picked = [];
        for (const c of cands) {
            if (picked.length >= cap) break;
            if (picked.some(p => Math.abs(p.r - c.r) <= spacing && Hex.wrappingDistance(p.q, p.r, c.q, c.r, W) < spacing)) continue;
            picked.push(c);
            tiles[c.r][c.q]._ford = true;
        }
        return picked.length;
    },

    /** Are fords marked on worlds of this terrainGen? */
    fordsApply(terrainGen) {
        return (Number(terrainGen) || 1) >= _num(this.config().fords.fromGen, 17);
    },
};

// ============================================
// TOWN SITING — where real towns grow (terrainGen 16+)
// ============================================
//
// Worlds since terrainGen 16 seat their capitals, first towns and free
// villages by a site score: fresh water (a river, a confluence, a lake
// shore), a river mouth or a sheltered bay, a ford on a big river, the foot
// of a mountain pass, good farmland and food about, an ore field within
// reach; swamp, desert away from water, the frozen north, bare mountains and
// (for a capital) a speck of an island count against a place. Weights in
// data/kingdoms.json `siting` (documented in `_siting`). Reads the map only;
// draws no RNG, so the placement code that calls it stays deterministic.

import { Hex } from '../core/hex.js';

const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'lake', 'sea']);
const DRY = new Set(['desert']);
const COLD = new Set(['ice', 'snow', 'tundra', 'snow_peak']);
const MOUNTAIN = new Set(['mountain', 'snow_peak']);

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// One score map per generated tile grid (built at most once per world)
const cache = new WeakMap();

export const TownSiting = {
    /** The siting weights (data/kingdoms.json `siting`, set by DataLoader) */
    DATA: null,

    /** Does this world seat its towns by the site score? */
    applies(terrainGen) {
        return (Number(terrainGen) || 1) >= 16;
    },

    cfg() {
        return TownSiting.DATA || {};
    },

    /**
     * The site map for this tile grid: `score(q, r, kind)` ('capital' adds
     * the tiny-island penalty) and `features(q, r)` (what the score saw).
     */
    map(tiles, width, height) {
        let m = cache.get(tiles);
        if (!m) {
            m = TownSiting._build(tiles, width, height);
            cache.set(tiles, m);
        }
        return m;
    },

    /**
     * The site map of a world in play, or null when its settlements are not
     * sited (made before terrainGen 16, or a custom world): founding in play
     * (KingdomAI.tryExpand, Colonization pioneers, wandering settlers, dawn
     * clans, a village's daughter party) ranks its candidates with it.
     */
    forWorld(world) {
        const gp = (world && world.generationParams) || {};
        if (gp.customWorld || !TownSiting.applies(gp.terrainGen)) return null;
        if (!world.tiles || !world.tiles.length || !world.width || !world.height) return null;
        return TownSiting.map(world.tiles, world.width, world.height);
    },

    /** The weights for settlements founded in play (data/kingdoms.json siting.founded). */
    founded(path) {
        const F = TownSiting.cfg().founded || {};
        return (path ? F[path] : F) || {};
    },

    /**
     * The best site within `radius` of (q, r) for a settlement founded in
     * play: the live score less distWeight per hex from (q, r), over the hexes
     * `accept(tile, d)` lets through (the founder's own rules: territory,
     * spacing, reach). Ties keep the nearer, earlier hex. Draws no RNG.
     * → { tile, q, r, score (live, undiscounted), d } | null
     */
    bestNear(world, q, r, radius, accept, opts = {}) {
        const m = opts.map || TownSiting.forWorld(world);
        if (!m) return null;
        const kind = opts.kind || 'village';
        const dw = num(opts.distWeight, 0.5);
        let best = null, bestV = -Infinity;
        for (const h of Hex.hexesInRange(q, r, Math.max(0, radius | 0))) {
            const t = world.getTile(h.q, h.r);
            if (!t || !t.terrain) continue;
            const d = typeof Hex.wrappingDistance === 'function' ? Hex.wrappingDistance(q, r, t.q, t.r, world.width) : Hex.distance(q, r, t.q, t.r);
            if (accept && !accept(t, d)) continue;
            const s = m.live(t.q, t.r, kind);
            if (!Number.isFinite(s)) continue;
            const v = s - dw * d;
            if (v > bestV) { bestV = v; best = { tile: t, q: t.q, r: t.r, score: s, d }; }
        }
        return best;
    },

    /** Score of one hex (convenience). */
    score(tiles, width, height, q, r, kind = 'town') {
        return TownSiting.map(tiles, width, height).score(q, r, kind);
    },

    _build(tiles, width, height) {
        const C = TownSiting.cfg();
        const T = C.terrain || {};
        const at = (q, r) => (r < 0 || r >= height ? null : tiles[r][Hex.wrapQ(q, width)]);
        const nbrs = (t) => Hex.neighbors(t.q, t.r).map(n => at(n.q, n.r));
        const isWater = (t) => !!t && !!t.terrain && WATER.has(t.terrain.id);
        const isLake = (t) => isWater(t) && (t.terrain.id === 'lake' || t._lake || t.waterBodyType === 'lake');
        const isSea = (t) => isWater(t) && !isLake(t);
        const down = (t) => {
            if (!t.hasRiver || !Number.isInteger(t.riverDir) || t.riverDir < 0) return null;
            const n = Hex.neighbors(t.q, t.r)[t.riverDir];
            return at(n.q, n.r);
        };

        // River hexes, how many flow into each, and how many feed each from upstream
        const rivers = [];
        const into = new Map();
        for (const row of tiles) for (const t of row) {
            if (!t.hasRiver) continue;
            rivers.push(t);
            const d = down(t);
            if (d && d.hasRiver) into.set(d, (into.get(d) || 0) + 1);
        }
        const feed = new Map();
        const indeg = new Map(into);
        const queue = rivers.filter(t => !indeg.get(t));
        for (let k = 0; k < queue.length; k++) {
            const t = queue[k];
            const f = (feed.get(t) || 0) + 1;
            feed.set(t, f);
            const d = down(t);
            if (d && d.hasRiver && indeg.has(d)) {
                feed.set(d, (feed.get(d) || 0) + f);
                indeg.set(d, indeg.get(d) - 1);
                if (!indeg.get(d)) queue.push(d);
            }
        }

        // Land masses: how big the land a hex stands on is
        const landSize = new Map();
        for (const row of tiles) for (const t of row) {
            if (landSize.has(t) || !t.terrain || !t.terrain.passable || isWater(t)) continue;
            const group = [t];
            landSize.set(t, 0);
            for (let k = 0; k < group.length; k++) {
                for (const n of nbrs(group[k])) {
                    if (!n || landSize.has(n) || !n.terrain || !n.terrain.passable || isWater(n)) continue;
                    landSize.set(n, 0);
                    group.push(n);
                }
            }
            for (const g of group) landSize.set(g, group.length);
        }

        const foodIds = new Set(Array.isArray(C.foodIds) ? C.foodIds : ['wheat', 'fish', 'cattle', 'horses']);
        const bigFeed = num(C.bigRiverFeed, 12);
        const features = new Map();
        // (what a hex offers, read fresh; feat() keeps it for the generation pass)
        const readFeat = (t) => {
            const ns = nbrs(t);
            const waterN = ns.filter(isWater);
            const seaN = ns.filter(isSea).length;
            const lakeN = ns.some(isLake);
            const riverN = ns.some(n => n && n.hasRiver);
            const d = down(t);
            const ring = Hex.hexesInRange(t.q, t.r, 2).map(h => at(h.q, h.r)).filter(Boolean);
            let food = 0;
            let ore = 0;
            for (const o of ring) {
                if (o.resource && foodIds.has(o.resource.id)) food++;
                if (o.ores) for (const k in o.ores) ore = Math.max(ore, num(o.ores[k], 0));
            }
            return {
                river: !!t.hasRiver,
                riverNear: !t.hasRiver && riverN,
                confluence: !!t.hasRiver && (into.get(t) || 0) >= 2,
                riverMouth: !!t.hasRiver && (seaN > 0 || (!!d && isSea(d))),
                lakeShore: lakeN || (!!t.hasRiver && !!d && isLake(d)),
                coast: seaN > 0,
                sheltered: seaN > 0 && waterN.length <= 3,
                bigRiver: !!t.hasRiver && (feed.get(t) || 0) >= bigFeed,
                passFoot: !!t._pass || ns.some(n => n && n._pass),
                dry: !t.hasRiver && !riverN && waterN.length === 0,
                food,
                ore,
                land: landSize.get(t) || 0,
            };
        };
        const feat = (t) => {
            let f = features.get(t);
            if (!f) { f = readFeat(t); features.set(t, f); }
            return f;
        };

        const scores = new Map();
        // (the score of a hex from what it offers: f is feat(t) at generation, readFeat(t) in play)
        const scoreOf = (t, getF) => {
            const id = t.terrain && t.terrain.id;
            if (!t.terrain || !t.terrain.passable || WATER.has(id)) return -Infinity;
            const f = getF(t);
            let s = num(T[id], 0.5);
            let fert = 0, landN = 0;
            for (const n of nbrs(t)) {
                if (!n || !n.terrain || !n.terrain.passable || isWater(n)) continue;
                fert += num(T[n.terrain.id], 0.5);
                landN++;
            }
            if (landN) s += num(C.ringFertility, 0.6) * (fert / landN);
            if (f.river) s += num(C.river, 3.5);
            if (f.riverNear) s += num(C.riverNear, 2);
            if (f.confluence) s += num(C.confluence, 3);
            if (f.riverMouth) s += num(C.riverMouth, 4);
            if (f.lakeShore) s += num(C.lakeShore, 3);
            if (f.coast) s += num(C.coast, 1.5);
            if (f.sheltered) s += num(C.sheltered, 1.5);
            if (f.bigRiver) s += num(C.bigRiver, 1.5);
            if (f.passFoot) {
                s += num(C.passFoot, 3);
                if (MOUNTAIN.has(id)) s -= num(T[id], 0); // the way over the range, not a bare peak
            }
            if (f.dry) s += num(C.dry, -1.5);
            s += Math.min(num(C.foodMax, 2.5), f.food * num(C.foodEach, 0.75));
            s += num(C.ore, 2.5) * f.ore;
            const dryLand = DRY.has(id) || (id === 'savanna' && (t.moisture ?? 0.5) < 0.3);
            if (dryLand && !f.river && !f.riverNear && !f.lakeShore && !f.coast) s += num(C.desertInterior, -4);
            if (COLD.has(id)) s += num(C.cold, -1);
            return s;
        };
        const base = (t) => {
            let s = scores.get(t);
            if (s === undefined) { s = scoreOf(t, feat); scores.set(t, s); }
            return s;
        };

        return {
            features: (q, r) => { const t = at(q, r); return t ? feat(t) : null; },
            score(q, r, kind = 'town') {
                const t = at(q, r);
                if (!t) return -Infinity;
                let s = base(t);
                if (kind === 'capital' && Number.isFinite(s) && feat(t).land < num(C.islandMin, 40)) s += num(C.tinyIsland, -8);
                return s;
            },
            /**
             * The score of a hex as it is now, for a settlement founded in play:
             * read fresh (no per-hex cache), so ground cleared, a resource worked
             * out or a hex scored once at generation counts as it stands today.
             * The rivers' shape and the land masses are the world's own, fixed
             * since generation, and come from the map.
             */
            live(q, r, kind = 'town') {
                const t = at(q, r);
                if (!t) return -Infinity;
                let s = scoreOf(t, readFeat);
                if (kind === 'capital' && Number.isFinite(s) && (landSize.get(t) || 0) < num(C.islandMin, 40)) s += num(C.tinyIsland, -8);
                return s;
            },
            /** What live() saw (fresh). */
            liveFeatures: (q, r) => { const t = at(q, r); return t ? readFeat(t) : null; },
        };
    },
};

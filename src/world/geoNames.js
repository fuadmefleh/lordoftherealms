// ============================================
// GEO NAMES — the names of the land and the water, like an atlas
// ============================================
//
// Finds the world's named geography in its tiles and names each feature in
// the tongue of the people who live round it (data/geography.json):
//   range   — a connected band of mountain / snow peak / highlands
//   pass    — a gap through a range (tile._pass, worlds since terrainGen 16)
//   river   — a river's main stem from spring to mouth, and its big
//             tributaries, by how many river hexes run into it (riverDir)
//   lake    — connected lake hexes
//   sea     — a connected body of open water (coast, ocean and deep ocean
//             alike) is one sea, an ocean when large (or round the map's
//             edge), lettered in several places; only an arm behind a
//             strait (a basin whose mouth is narrow) is a sea or gulf of
//             its own, and water cut off from the rest is its own sea/lake
//   bay     — an inlet: sea hexes well away from any basin (a bay, a gulf
//             when large, a sound or fjord when long and narrow)
//   forest / desert / marsh — connected woodland, desert and swamp
//   island  — a small landmass; three or more close together are isles
//
// The culture of a feature is that of the towns nearest its hexes (a
// multi-source walk from every settlement, within cultureRadius), weighted
// by nearness; its name comes from that culture's roots and nouns, or a word
// built from its language's syllables (data/cultures.json). Every choice is
// a hash of the world seed and the feature, never Utils' RNG, and the tiles
// are only read, so any world of any version gets its names and no other
// randomness moves. Worked out once per world and tile grid and cached;
// saved names (serialize/restore, saveLoad 'geography') are kept on load so
// a town founded later never renames a range.
//
// Positions are kept in "hex-pixel" units (one hex width = 1, rows 0.75
// apart, even rows shifted half a hex: Renderer.getHexPixelPos / hexWidth),
// unwrapped across the east–west seam so a feature over it stays whole.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';

const SEA = new Set(['deep_ocean', 'ocean', 'coast', 'sea']);
const RANGE = new Set(['mountain', 'snow_peak', 'highlands']);
const FOREST = new Set(['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest']);

const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** A small local generator (mulberry32) seeded from a hash: never Utils' stream. */
function _rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const _pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

const FALLBACK = { cultureRadius: 14, sizes: {}, zoom: {}, fallbackCulture: {}, kinds: {}, cultures: {} };

const _cache = new WeakMap();

export const GeoNames = {
    data() {
        const g = DataLoader._gamedata;
        return (g && _obj(g.geography)) || FALLBACK;
    },

    size(key, d) {
        return _num(_obj(GeoNames.data().sizes) && GeoNames.data().sizes[key], d);
    },

    /**
     * Every named feature of the world: { features, at } where features is
     * [{ id, key, kind, sub, name, culture, size, x, y, angle, length, width,
     * anchor: tile index, anchors: [{ x, y, angle, tile }] (rivers) }] and
     * `at` holds per-hex lookups (Int32Array by r * width + q, -1 for none):
     * land, water, river, pass, island. Cached per world and tile grid.
     */
    features(world) {
        if (!world || !Array.isArray(world.tiles) || !world.width || !world.height) return { features: [], at: null };
        const c = _cache.get(world);
        if (c && c.tiles === world.tiles && c.pins === world._geoPins) return c.result;
        const result = GeoNames._compute(world);
        _cache.set(world, { tiles: world.tiles, pins: world._geoPins, result });
        return result;
    },

    /** Forget the cached names (the ground changed). */
    invalidate(world) {
        if (world) _cache.delete(world);
    },

    /** The named features at hex (q, r): { land, water, river, pass, island } (each a feature or null). */
    at(world, q, r) {
        const { features, at } = GeoNames.features(world);
        const out = { land: null, water: null, river: null, pass: null, island: null };
        if (!at || !Number.isFinite(q) || !Number.isFinite(r) || r < 0 || r >= world.height) return out;
        const i = r * world.width + Hex.wrapQ(Math.round(q), world.width);
        for (const k of Object.keys(out)) {
            const f = at[k][i];
            if (f >= 0) out[k] = features[f];
        }
        return out;
    },

    /** The most telling name for hex (q, r) — a pass, a range or forest, a bay or sea, a lake, an island, a river — or null. */
    nameAt(world, q, r) {
        const a = GeoNames.at(world, q, r);
        const f = a.pass || a.land || a.water || a.island || a.river;
        return f ? f.name : null;
    },

    /** The names kept with a save: { names: { key: name } }. */
    serialize(world) {
        const { features } = GeoNames.features(world);
        if (!features.length) return null;
        const names = {};
        for (const f of features) names[f.key] = f.name;
        return { names };
    },

    /** Keep a save's names (features found again under the same key take them back). */
    restore(data, world) {
        if (!world) return;
        world._geoPins = data && _obj(data.names) ? { ...data.names } : null;
        _cache.delete(world);
    },

    // ── Finding the features ───────────────────────────────

    _compute(world) {
        const W = world.width, H = world.height, N = W * H;
        const tiles = world.tiles;
        const tileAt = (i) => (tiles[(i / W) | 0] && tiles[(i / W) | 0][i % W]) || null;
        const id = (i) => {
            const t = tileAt(i);
            return t && t.terrain ? t.terrain.id : null;
        };
        // neighbour indices (-1 off the top or bottom) and the q step across each (for unwrapping)
        const nbr = new Int32Array(N * 6).fill(-1);
        const dq = new Int8Array(N * 6);
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const ns = Hex.neighbors(q, r);
                for (let k = 0; k < 6; k++) {
                    const n = ns[k];
                    if (n.r < 0 || n.r >= H) continue;
                    nbr[(r * W + q) * 6 + k] = n.r * W + Hex.wrapQ(n.q, W);
                    dq[(r * W + q) * 6 + k] = n.q - q;
                }
            }
        }
        const ids = new Array(N);
        for (let i = 0; i < N; i++) ids[i] = id(i);
        const ctx = { world, W, H, N, tiles, tileAt, nbr, dq, ids, features: [] };
        ctx.at = {
            land: new Int32Array(N).fill(-1), water: new Int32Array(N).fill(-1), river: new Int32Array(N).fill(-1),
            pass: new Int32Array(N).fill(-1), island: new Int32Array(N).fill(-1),
        };
        GeoNames._people(ctx);
        GeoNames._ranges(ctx);
        GeoNames._passes(ctx);
        GeoNames._areas(ctx, 'forest', (i) => FOREST.has(ids[i]), GeoNames.size('forest', 30));
        GeoNames._areas(ctx, 'desert', (i) => ids[i] === 'desert', GeoNames.size('desert', 18));
        GeoNames._areas(ctx, 'marsh', (i) => ids[i] === 'swamp', GeoNames.size('marsh', 7));
        GeoNames._lakes(ctx);
        GeoNames._seas(ctx);
        GeoNames._islands(ctx);
        GeoNames._rivers(ctx);
        GeoNames._name(ctx);
        return { features: ctx.features, at: ctx.at };
    },

    /** Unwrapped position (hex-pixel units) of tile index i at unwrapped column uq. */
    _pos(ctx, i, uq) {
        const r = (i / ctx.W) | 0;
        return { x: uq + (r % 2 === 0 ? 0.5 : 0), y: r * 0.75 };
    },

    /**
     * The connected components of hexes passing `test`, each as { tiles,
     * uq } (unwrapped columns), in map order (so the same world always gives
     * the same components).
     */
    _components(ctx, test) {
        const { N, W, nbr, dq } = ctx;
        const seen = new Uint8Array(N);
        const out = [];
        for (let s = 0; s < N; s++) {
            if (seen[s] || !test(s)) continue;
            seen[s] = 1;
            const tl = [s], uq = [s % W];
            for (let p = 0; p < tl.length; p++) {
                const i = tl[p];
                for (let k = 0; k < 6; k++) {
                    const j = nbr[i * 6 + k];
                    if (j < 0 || seen[j] || !test(j)) continue;
                    seen[j] = 1;
                    tl.push(j);
                    uq.push(uq[p] + dq[i * 6 + k]);
                }
            }
            out.push({ tiles: tl, uq });
        }
        return out;
    },

    /**
     * A feature from a component: its long axis (angle, length, width) and
     * the hex its label hangs on (and whose fog it keeps) — the hex nearest
     * the middle, or with `open` (a per-hex score) the most open one near it.
     */
    _feature(ctx, kind, comp, extra = {}, open = null) {
        const pts = comp.tiles.map((i, n) => GeoNames._pos(ctx, i, comp.uq[n]));
        let mx = 0, my = 0;
        for (const p of pts) { mx += p.x; my += p.y; }
        mx /= pts.length; my /= pts.length;
        let sxx = 0, syy = 0, sxy = 0;
        for (const p of pts) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
        let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const ca = Math.cos(angle), sa = Math.sin(angle);
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const p of pts) {
            const a = (p.x - mx) * ca + (p.y - my) * sa;
            const b = -(p.x - mx) * sa + (p.y - my) * ca;
            a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
        }
        let best = 0, bd = Infinity;
        pts.forEach((p, n) => {
            const d = Math.sqrt((p.x - mx) ** 2 + (p.y - my) ** 2) - (open ? 2.5 * Math.min(6, open[comp.tiles[n]]) : 0);
            if (d < bd) { bd = d; best = n; }
        });
        // (text reads left to right: keep the axis within ±90°)
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        const anchor = comp.tiles[best];
        const at = GeoNames._pos(ctx, anchor, anchor % ctx.W);
        let lo = comp.tiles[0];
        for (const i of comp.tiles) if (i < lo) lo = i;
        const f = {
            id: ctx.features.length, kind, sub: 'default', key: `${kind}:${lo}`,
            size: comp.tiles.length, x: at.x, y: at.y, angle, length: a1 - a0 + 1, width: b1 - b0 + 1,
            anchor, tiles: comp.tiles, name: '', culture: null, ...extra,
        };
        ctx.features.push(f);
        return f;
    },

    _mark(ctx, layer, f) {
        for (const i of f.tiles) if (ctx.at[layer][i] < 0) ctx.at[layer][i] = f.id;
    },

    /** Who lives nearest each hex: the settlement (its culture and name) and how far. */
    _people(ctx) {
        const { world, N, W, nbr, tileAt } = ctx;
        const near = new Int32Array(N).fill(-1);
        const dist = new Int32Array(N).fill(-1);
        const towns = [];
        const queue = [];
        for (let i = 0; i < N; i++) {
            const t = tileAt(i);
            const s = t && t.settlement;
            if (!s) continue;
            // (as Cultures.cultureOf would stamp it, without stamping: its own, its realm's,
            // the nearest realm's — so names come out the same before and after the stamping)
            let culture = s.culture || null;
            if (!culture && s.kingdom != null && typeof world.getKingdom === 'function') {
                const k = world.getKingdom(s.kingdom);
                culture = (k && k.culture) || null;
            }
            if (!culture && Array.isArray(world.kingdoms)) {
                let best = null;
                for (const kk of world.kingdoms) {
                    if (!kk || !kk.capital || !kk.culture) continue;
                    const d = Hex.wrappingDistance(i % W, (i / W) | 0, kk.capital.q, kk.capital.r, W);
                    if (!best || d < best.d) best = { d, culture: kk.culture };
                }
                if (best) culture = best.culture;
            }
            near[i] = towns.length;
            dist[i] = 0;
            towns.push({ name: s.name || null, culture, tile: i });
            queue.push(i);
        }
        const R = _num(GeoNames.data().cultureRadius, 14);
        for (let p = 0; p < queue.length; p++) {
            const i = queue[p];
            if (dist[i] >= R) continue;
            for (let k = 0; k < 6; k++) {
                const j = nbr[i * 6 + k];
                if (j < 0 || dist[j] >= 0) continue;
                dist[j] = dist[i] + 1;
                near[j] = near[i];
                queue.push(j);
            }
        }
        Object.assign(ctx, { near, dist, towns });
    },

    _ranges(ctx) {
        const min = GeoNames.size('range', 10);
        for (const comp of GeoNames._components(ctx, (i) => RANGE.has(ctx.ids[i]))) {
            if (comp.tiles.length < min) continue;
            GeoNames._mark(ctx, 'land', GeoNames._feature(ctx, 'range', comp));
        }
    },

    _passes(ctx) {
        const { N, tileAt } = ctx;
        const passOf = new Int32Array(N).fill(-1);
        for (let i = 0; i < N; i++) {
            const t = tileAt(i);
            if (t && t._pass != null && t._pass !== false) passOf[i] = Number(t._pass) || 0;
        }
        const seen = new Set();
        for (let s = 0; s < N; s++) {
            const pid = passOf[s];
            if (pid < 0 || seen.has(pid)) continue;
            seen.add(pid);
            // (its first piece in map order holds s, the first hex of that pass)
            for (const comp of GeoNames._components(ctx, (i) => passOf[i] === pid)) {
                const f = GeoNames._feature(ctx, 'pass', comp);
                // the range it crosses (its name is given first: the pass may borrow it)
                const r = comp.tiles.map(i => ctx.at.land[i]).find(v => v >= 0);
                let range = -1;
                if (r == null) {
                    for (const i of comp.tiles) {
                        for (let k = 0; k < 6 && range < 0; k++) {
                            const j = ctx.nbr[i * 6 + k];
                            if (j >= 0 && ctx.at.land[j] >= 0 && ctx.features[ctx.at.land[j]].kind === 'range') range = ctx.at.land[j];
                        }
                    }
                }
                f.range = r != null ? r : range;
                GeoNames._mark(ctx, 'pass', f);
                break;
            }
        }
    },

    _areas(ctx, kind, test, min) {
        for (const comp of GeoNames._components(ctx, test)) {
            if (comp.tiles.length < min) continue;
            const f = GeoNames._feature(ctx, kind, comp);
            if (kind === 'forest') {
                let trop = 0, pine = 0;
                for (const i of comp.tiles) {
                    if (ctx.ids[i] === 'tropical_rainforest') trop++;
                    else if (ctx.ids[i] === 'boreal_forest') pine++;
                }
                if (trop > comp.tiles.length / 2) f.sub = 'jungle';
                else if (pine > comp.tiles.length / 2) f.sub = 'pine';
            }
            GeoNames._mark(ctx, 'land', f);
        }
    },

    _lakes(ctx) {
        const min = GeoNames.size('lake', 3);
        for (const comp of GeoNames._components(ctx, (i) => ctx.ids[i] === 'lake')) {
            if (comp.tiles.length < min) continue;
            GeoNames._mark(ctx, 'water', GeoNames._feature(ctx, 'lake', comp));
        }
    },

    /**
     * The sea: basins of open water (far from land), every sea hex going to
     * the nearest, gathered per body of water into one sea (an ocean when
     * great) save the arms behind a strait; then the inlets, the sea hexes a
     * good way from any basin.
     */
    _seas(ctx) {
        const { N, nbr, ids } = ctx;
        const isSea = (i) => SEA.has(ids[i]);
        const openDist = GeoNames.size('openDist', 3);
        // how far each sea hex is from land (or a lake)
        const dl = new Int32Array(N).fill(-1);
        const q = [];
        for (let i = 0; i < N; i++) if (ids[i] && !isSea(i)) { dl[i] = 0; q.push(i); }
        for (let p = 0; p < q.length; p++) {
            const i = q[p];
            for (let k = 0; k < 6; k++) {
                const j = nbr[i * 6 + k];
                if (j < 0 || dl[j] >= 0) continue;
                dl[j] = dl[i] + 1;
                q.push(j);
            }
        }
        // (a world of only water: every hex is open)
        for (let i = 0; i < N; i++) if (dl[i] < 0) dl[i] = 999;
        // the bodies of water: every connected run of sea hexes, whatever its depth
        // (coast, ocean and deep ocean are one water: a body is never split by depth)
        const bodyOf = new Int32Array(N).fill(-1);
        const bodies = GeoNames._components(ctx, isSea);
        bodies.forEach((b, k) => { for (const i of b.tiles) bodyOf[i] = k; });
        // the basins: the open water of each body (far from land), each piece whole
        const basinOf = new Int32Array(N).fill(-1);
        const basins = [];
        for (const comp of GeoNames._components(ctx, (i) => isSea(i) && dl[i] >= openDist)) {
            if (comp.tiles.length < GeoNames.size('minBasin', 10)) continue;
            const b = basins.length;
            basins.push(comp.tiles.slice());
            for (const i of comp.tiles) basinOf[i] = b;
        }
        // every other sea hex to its nearest basin, counting the steps
        const steps = new Int32Array(N).fill(-1);
        const qq = [];
        for (let i = 0; i < N; i++) if (basinOf[i] >= 0) { steps[i] = 0; qq.push(i); }
        for (let p = 0; p < qq.length; p++) {
            const i = qq[p];
            for (let k = 0; k < 6; k++) {
                const j = nbr[i * 6 + k];
                if (j < 0 || steps[j] >= 0 || !isSea(j)) continue;
                steps[j] = steps[i] + 1;
                basinOf[j] = basinOf[i];
                basins[basinOf[i]].push(j);
                qq.push(j);
            }
        }
        // the inlets: a way in from the open sea (or water with no open sea at all)
        const inletSteps = GeoNames.size('inletSteps', 3);
        const inlet = (i) => isSea(i) && (steps[i] < 0 || steps[i] > inletSteps);
        const minBay = GeoNames.size('bay', 6);
        const bays = [];
        for (const comp of GeoNames._components(ctx, inlet)) {
            if (comp.tiles.length < minBay) continue;
            // (grown back out to the mouth: the inlet's hexes up to the open water)
            const set = new Set(comp.tiles);
            const tl = comp.tiles.slice(), uq = comp.uq.slice();
            for (let p = 0; p < tl.length; p++) {
                const i = tl[p];
                if (steps[i] >= 0 && steps[i] <= 1) continue;
                for (let k = 0; k < 6; k++) {
                    const j = nbr[i * 6 + k];
                    if (j < 0 || set.has(j) || !isSea(j) || steps[j] < 1 || steps[j] > inletSteps) continue;
                    if (steps[i] >= 0 && steps[j] >= steps[i]) continue;
                    set.add(j); tl.push(j); uq.push(uq[p] + ctx.dq[i * 6 + k]);
                }
            }
            const open = comp.tiles.some(i => steps[i] >= 0);
            bays.push({ tiles: tl, uq, open });
        }
        // the seas: each body's basins (and the water round them) are one sea — an
        // ocean when the body is great — save a basin that opens on the rest only
        // through a strait (a sea of its own: an enclosed sea or a gulf)
        const groups = GeoNames._seaGroups(ctx, basins, basinOf, bodyOf);
        const oceanAt = GeoNames.size('ocean', 700);
        const oceanEdge = GeoNames.size('oceanEdge', 250);
        const touchesEdge = (b) => b.tiles.some(i => i < ctx.W || i >= N - ctx.W);
        // the basins first (so a bay over a basin's hexes is found under it at the hex)
        for (const g of groups) {
            const comp = GeoNames._unwrap(ctx, g.tiles);
            const body = bodies[g.body];
            const f = GeoNames._feature(ctx, 'sea', comp, {}, dl);
            if (g.enclosed) {
                f.strait = true;
                // (water behind a strait: an ocean of its own when it is one — two oceans
                // meeting at a narrows — a sea of its own when large, else a gulf)
                if (f.size >= oceanAt) f.sub = 'ocean';
                else if (f.size < GeoNames.size('enclosedSea', 150)) { f.kind = 'bay'; f.sub = 'gulf'; f.key = `bay:${f.key.split(':')[1]}`; }
            } else if (body.tiles.length >= oceanAt || (body.tiles.length >= oceanEdge && touchesEdge(body))) {
                f.sub = 'ocean';
            }
            // (a great water is lettered in several places, the one name in each)
            if (f.kind === 'sea') f.anchors = GeoNames._seaSpots(ctx, f, dl);
            f._basin = true;
        }
        const seaFeatures = ctx.features.filter(f => f._basin);
        for (const b of bays) {
            const f = GeoNames._feature(ctx, 'bay', b, {}, dl);
            // (water with no way out to the open sea: an inland sea, or a lake when small)
            if (!b.open) { f.kind = f.size >= 20 ? 'sea' : 'lake'; f.sub = f.kind === 'sea' ? 'inland' : 'default'; f.key = `${f.kind}:${f.key.split(':')[1]}`; }
            else if (f.size >= GeoNames.size('gulf', 30)) f.sub = 'gulf';
            else if (f.length / Math.max(1, f.width) >= GeoNames.size('soundRatio', 3)) f.sub = 'sound';
            GeoNames._mark(ctx, 'water', f);
        }
        for (const f of seaFeatures) GeoNames._mark(ctx, 'water', f);
    },

    /**
     * The basins (each grown over the sea hexes nearest it) gathered into
     * seas: [{ tiles, body, enclosed }]. A small basin joins the neighbour it
     * shares most shore with; then a basin (or such a gathering) whose only
     * ways to the rest of its body are narrow — its mouth, the hexes touching
     * another basin, no wider than a strait — is a sea of its own (enclosed);
     * every other basin of a body is one sea with the body's biggest. When in
     * doubt, one sea.
     */
    _seaGroups(ctx, basins, basinOf, bodyOf) {
        const { N, nbr } = ctx;
        const n = basins.length;
        const parent = Array.from({ length: n }, (_, k) => k);
        const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
        const size = (k) => { let s = 0; for (let b = 0; b < n; b++) if (find(b) === k) s += basins[b].length; return s; };
        // the mouths between the gatherings: per gathering, the hexes of it beside another (by which)
        const mouths = () => {
            const m = new Map();
            for (let i = 0; i < N; i++) {
                const a = basinOf[i];
                if (a < 0) continue;
                const ga = find(a);
                for (let k = 0; k < 6; k++) {
                    const j = nbr[i * 6 + k];
                    if (j < 0 || basinOf[j] < 0) continue;
                    const gb = find(basinOf[j]);
                    if (gb === ga) continue;
                    if (!m.has(ga)) m.set(ga, new Map());
                    const per = m.get(ga);
                    if (!per.has(gb)) per.set(gb, new Set());
                    per.get(gb).add(i);
                }
            }
            return m;
        };
        // (the small basins first: each into the neighbour it touches most, the smallest first)
        const minEnclosed = GeoNames.size('enclosedMin', 60);
        for (let guard = 0; guard < n; guard++) {
            const m = mouths();
            let pick = -1, ps = Infinity;
            for (const [g, per] of m) {
                if (!per.size) continue;
                const s = size(g);
                if (s < minEnclosed && (s < ps || (s === ps && g < pick))) { pick = g; ps = s; }
            }
            if (pick < 0) break;
            let to = -1, tc = -1;
            for (const [g, set] of m.get(pick)) if (set.size > tc || (set.size === tc && g < to)) { to = g; tc = set.size; }
            parent[pick] = to;
        }
        // the enclosed: narrow-mouthed, and not the body's biggest
        const m = mouths();
        const roots = [...new Set(Array.from({ length: n }, (_, k) => find(k)))].filter(g => basins.some((b, k) => b.length && find(k) === g));
        const sizes = new Map(roots.map(g => [g, size(g)]));
        const bodyOfG = (g) => bodyOf[basins[g][0]];
        const biggest = new Map();
        for (const g of roots) {
            const b = bodyOfG(g);
            const cur = biggest.get(b);
            if (cur == null || sizes.get(g) > sizes.get(cur) || (sizes.get(g) === sizes.get(cur) && g < cur)) biggest.set(b, g);
        }
        const strait = GeoNames.size('straitMouth', 6);
        const enclosed = new Set();
        for (const g of roots) {
            if (biggest.get(bodyOfG(g)) === g || !m.has(g)) continue;
            const s = sizes.get(g);
            if (s < minEnclosed) continue;
            let mouth = 0;
            for (const set of m.get(g).values()) mouth += set.size;
            if (mouth <= Math.min(strait, Math.max(3, 0.5 * Math.sqrt(s)))) enclosed.add(g);
        }
        // every other gathering of a body with its biggest
        for (const g of roots) if (!enclosed.has(g)) parent[g] = find(biggest.get(bodyOfG(g)));
        const out = new Map();
        for (let k = 0; k < n; k++) {
            if (!basins[k].length) continue;
            const g = find(k);
            if (!out.has(g)) out.set(g, { tiles: [], body: bodyOf[basins[k][0]], enclosed: enclosed.has(g), lo: Infinity });
            const o = out.get(g);
            for (const i of basins[k]) { o.tiles.push(i); if (i < o.lo) o.lo = i; }
        }
        // (in map order, so the same world always gives the same seas)
        return [...out.values()].sort((a, b) => a.lo - b.lo);
    },

    /**
     * Where a great water's name is written: its label hex, and then the most
     * open hexes far from every spot so far (one about every seaSpotGap hex
     * widths, at most seaSpots), so an ocean round the world is named across it.
     */
    _seaSpots(ctx, f, open) {
        const W = ctx.W;
        const gap = GeoNames.size('seaSpotGap', 19);
        const most = GeoNames.size('seaSpots', 16);
        const pos = (i) => GeoNames._pos(ctx, i, i % W);
        const spot = (i) => { const p = pos(i); return { x: p.x, y: p.y, angle: 0, tile: i }; };
        const spots = [spot(f.anchor)];
        // (only the open water, a little in from the map's top and bottom: a name is not
        // written in a bay's mouth, nor half off the world)
        const H = ctx.H;
        const cand = f.tiles.filter(i => open[i] >= 3 && i >= 2 * W && i < (H - 2) * W);
        // (rows count for more than columns: a screen of the map is wider than it is tall)
        const dist = (a, b) => {
            let dx = Math.abs(a.x - b.x);
            dx = Math.min(dx, W - dx);
            return Math.hypot(dx, 1.6 * (a.y - b.y));
        };
        while (spots.length < most) {
            let best = -1, bs = -Infinity;
            for (const i of cand) {
                const p = pos(i);
                let d = Infinity;
                for (const s of spots) d = Math.min(d, dist(p, s));
                if (d < gap) continue;
                // (far enough off is far enough: past that, the more open water)
                const score = Math.min(d, gap * 1.25) + Math.min(4, open[i]);
                if (score > bs || (score === bs && i < best)) { bs = score; best = i; }
            }
            if (best < 0) break;
            spots.push(spot(best));
        }
        return spots;
    },

    /** A set of hexes as a component with unwrapped columns (a walk from the first, then any left over as they are). */
    _unwrap(ctx, list) {
        const set = new Set(list);
        const uqOf = new Map();
        const tl = [];
        for (const s of list) {
            if (uqOf.has(s)) continue;
            uqOf.set(s, s % ctx.W);
            tl.push(s);
            for (let p = tl.length - 1; p < tl.length; p++) {
                const i = tl[p];
                for (let k = 0; k < 6; k++) {
                    const j = ctx.nbr[i * 6 + k];
                    if (j < 0 || !set.has(j) || uqOf.has(j)) continue;
                    uqOf.set(j, uqOf.get(i) + ctx.dq[i * 6 + k]);
                    tl.push(j);
                }
            }
        }
        return { tiles: tl, uq: tl.map(i => uqOf.get(i)) };
    },

    /** Small landmasses: an island alone, or three or more close together as isles. */
    _islands(ctx) {
        const { N, nbr, ids } = ctx;
        const land = (i) => !!ids[i] && !SEA.has(ids[i]);
        const max = GeoNames.size('islandMax', 90);
        const comps = GeoNames._components(ctx, land);
        if (comps.length < 2) return;
        const biggest = Math.max(...comps.map(c => c.tiles.length));
        const isles = comps.filter(c => c.tiles.length <= max && c.tiles.length < biggest);
        if (!isles.length) return;
        // which isles lie within isleGap of each other (walks out over the sea, joining where they meet)
        const owner = new Int32Array(N).fill(-1);
        const depth = new Int32Array(N).fill(-1);
        const parent = isles.map((_, k) => k);
        const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
        const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
        const q = [];
        isles.forEach((c, k) => { for (const i of c.tiles) { owner[i] = k; depth[i] = 0; q.push(i); } });
        const gap = GeoNames.size('isleGap', 3);
        for (let p = 0; p < q.length; p++) {
            const i = q[p];
            for (let k = 0; k < 6; k++) {
                const j = nbr[i * 6 + k];
                if (j < 0) continue;
                if (owner[j] >= 0) {
                    if (owner[j] !== owner[i] && depth[i] + depth[j] + 1 <= gap) join(owner[i], owner[j]);
                    continue;
                }
                if (land(j) || depth[i] + 1 > Math.ceil(gap / 2)) continue;
                owner[j] = owner[i];
                depth[j] = depth[i] + 1;
                q.push(j);
            }
        }
        const groups = new Map();
        isles.forEach((c, k) => { const g = find(k); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
        const minGroup = GeoNames.size('archipelago', 3);
        const minIsle = GeoNames.size('island', 4);
        for (const list of groups.values()) {
            if (list.length >= minGroup) {
                const f = GeoNames._feature(ctx, 'island', GeoNames._unwrap(ctx, list.flatMap(c => c.tiles)), { sub: 'isles' });
                f.isles = list.length;
                GeoNames._mark(ctx, 'island', f);
            } else {
                for (const c of list) if (c.tiles.length >= minIsle) GeoNames._mark(ctx, 'island', GeoNames._feature(ctx, 'island', c));
            }
        }
    },

    /**
     * The rivers: from each mouth up the branch with the most river in it
     * (the main stem), each big side branch its own river from where it
     * joins. Size is the river hexes that run into the mouth.
     */
    _rivers(ctx) {
        const { N, W, tileAt, nbr, dq } = ctx;
        const down = new Int32Array(N).fill(-1);
        const downK = new Int8Array(N).fill(-1);
        const river = new Uint8Array(N);
        for (let i = 0; i < N; i++) {
            const t = tileAt(i);
            if (t && t.hasRiver) river[i] = 1;
        }
        const ups = new Map();
        const ins = new Int32Array(N);
        for (let i = 0; i < N; i++) {
            if (!river[i]) continue;
            const t = tileAt(i);
            const d = t.riverDir;
            if (!Number.isInteger(d) || d < 0 || d > 5) continue;
            const j = nbr[i * 6 + d];
            if (j < 0 || !river[j] || j === i) continue;
            down[i] = j;
            downK[i] = d;
            ins[j]++;
            if (!ups.has(j)) ups.set(j, []);
            ups.get(j).push(i);
        }
        // how much river runs into each hex (as the Currents & Rivers map, renderer/flowMap.js)
        const feed = new Float64Array(N);
        const stack = [];
        for (let i = 0; i < N; i++) if (river[i]) { feed[i] = 1; if (ins[i] === 0) stack.push(i); }
        const left = ins.slice();
        while (stack.length) {
            const i = stack.pop();
            const d = down[i];
            if (d < 0) continue;
            feed[d] += feed[i];
            if (--left[d] === 0) stack.push(d);
        }
        const minRiver = GeoNames.size('river', 14);
        const minTrib = GeoNames.size('tributary', 18);
        const mouths = [];
        for (let i = 0; i < N; i++) if (river[i] && down[i] < 0 && feed[i] >= minRiver) mouths.push(i);
        mouths.sort((a, b) => feed[b] - feed[a] || a - b);
        const queue = mouths.map(i => ({ mouth: i, trib: false }));
        const every = GeoNames.size('riverLabelEvery', 16);
        const taken = new Uint8Array(N);
        for (let p = 0; p < queue.length; p++) {
            const { mouth, trib } = queue[p];
            if (taken[mouth] && !trib) continue;
            // up the main stem, mouth first (unwrapped columns, so the line stays whole over the seam)
            const path = [mouth];
            let cur = mouth;
            const guard = new Set([mouth]);
            while (ups.has(cur)) {
                const list = ups.get(cur).filter(j => !guard.has(j)).sort((a, b) => feed[b] - feed[a] || a - b);
                if (!list.length) break;
                for (const j of list.slice(1)) if (feed[j] >= minTrib) queue.push({ mouth: j, trib: true });
                cur = list[0];
                guard.add(cur);
                path.push(cur);
            }
            if (path.length < 4) continue;
            path.reverse(); // spring → mouth
            const uq = new Array(path.length);
            uq[0] = path[0] % W;
            for (let n = 1; n < path.length; n++) uq[n] = uq[n - 1] + dq[path[n - 1] * 6 + downK[path[n - 1]]];
            const f = GeoNames._feature(ctx, 'river', { tiles: path, uq }, { sub: trib ? 'tributary' : 'default' });
            f.size = feed[mouth];
            f.key = `river:${mouth}`;
            f.tiles = path;
            // where its name is written: along the middle, and every `every` hexes either way
            const pts = path.map((i, n) => GeoNames._pos(ctx, i, uq[n]));
            const L = path.length;
            const at = [];
            const mid = Math.floor(L / 2);
            for (let off = 0; mid - off >= 2 || mid + off < L - 2; off += every) {
                if (mid + off < L - 2) at.push(mid + off);
                if (off > 0 && mid - off >= 2) at.push(mid - off);
                if (at.length >= 8) break;
            }
            f.anchors = at.map(n => {
                const a = pts[Math.max(0, n - 2)], b = pts[Math.min(L - 1, n + 2)];
                let ang = Math.atan2(b.y - a.y, b.x - a.x);
                if (ang > Math.PI / 2) ang -= Math.PI;
                if (ang < -Math.PI / 2) ang += Math.PI;
                const shift = (path[n] % W) - uq[n];
                return { x: (a.x + b.x) / 2 + shift, y: (a.y + b.y) / 2, angle: ang, tile: path[n] };
            });
            for (const i of path) taken[i] = 1;
            GeoNames._mark(ctx, 'river', f);
        }
    },

    // ── Naming ─────────────────────────────────────────────

    _name(ctx) {
        const D = GeoNames.data();
        const seed = String((ctx.world.generationParams && ctx.world.generationParams.seed) || ctx.world.seed || 0);
        const pins = _obj(ctx.world._geoPins) || {};
        const used = new Set();
        // (the saved names first, so a new one never takes a kept one)
        for (const f of ctx.features) {
            const pin = pins[f.key];
            if (typeof pin === 'string' && pin && !used.has(pin.toLowerCase())) { f.name = pin; used.add(pin.toLowerCase()); }
        }
        // the biggest first: the great features get the first choice of words
        const order = ctx.features.slice().sort((a, b) => b.size - a.size || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        for (const f of order) {
            const vote = GeoNames._culture(ctx, f);
            f.culture = vote.culture || _obj(D.fallbackCulture) && D.fallbackCulture[f.kind] || 'Imperial';
            f.town = vote.town;
            if (f.name) continue;
            for (let attempt = 0; attempt < 40 && !f.name; attempt++) {
                const n = GeoNames._compose(ctx, f, _rng(_hash(`${seed}|${f.key}|${attempt}`)));
                if (n && !used.has(n.toLowerCase())) f.name = n;
            }
            if (!f.name) {
                const base = GeoNames._compose(ctx, f, _rng(_hash(`${seed}|${f.key}|x`))) || f.kind;
                for (let k = 2; !f.name; k++) if (!used.has(`${base} ${k}`.toLowerCase())) f.name = `${base} ${k}`;
            }
            used.add(f.name.toLowerCase());
        }
    },

    /** The culture of the people round a feature, and the town nearest it: { culture, town }. */
    _culture(ctx, f) {
        const tally = new Map();
        const townTally = new Map();
        const step = Math.max(1, Math.floor(f.tiles.length / 400));
        for (let n = 0; n < f.tiles.length; n += step) {
            const i = f.tiles[n];
            const k = ctx.near[i];
            if (k < 0) continue;
            const w = 1 / (1 + ctx.dist[i]);
            const t = ctx.towns[k];
            if (t.culture) tally.set(t.culture, (tally.get(t.culture) || 0) + w);
            if (t.name) townTally.set(t.name, (townTally.get(t.name) || 0) + w);
        }
        const top = (m) => {
            let best = null, bw = -1;
            for (const [k, w] of m) if (w > bw + 1e-9 || (Math.abs(w - bw) <= 1e-9 && k < best)) { best = k; bw = w; }
            return best;
        };
        return { culture: top(tally), town: top(townTally) };
    },

    /** A word in the culture's own tongue: two or three of its language's syllables. */
    _tongue(culture, rng) {
        const g = DataLoader._gamedata;
        const C = g && _obj(g.cultures);
        const lang = C && _obj(C.cultures) && C.cultures[culture] && C.cultures[culture].language;
        const L = lang && _obj(C.languages) && C.languages[lang];
        const syl = L && Array.isArray(L.syllables) && L.syllables.length ? L.syllables : ['la', 'ru', 'mo', 'ten', 'ar', 'is'];
        // (a word starts on a syllable with a vowel in it: no 'Ncdo')
        let w = _pick(rng, syl);
        for (let k = 0; k < 6 && !/[aeiouy]/.test(w); k++) w = _pick(rng, syl);
        const n = rng() < 0.65 ? 2 : 3;
        for (let k = 1; k < n; k++) w += _pick(rng, syl);
        if (w.length < 4) w += _pick(rng, syl);
        // (no mouthfuls: a long word is cut back to its first two syllables, or so)
        if (w.length > 9) w = w.slice(0, Math.max(5, Math.min(8, w.length - _pick(rng, syl).length)));
        // (no letter three times running, no more than two vowels together)
        w = w.replace(/(.)\1\1+/g, '$1$1').replace(/([aeiouy]{2})[aeiouy]+/g, '$1');
        return w.charAt(0).toUpperCase() + w.slice(1);
    },

    /** One name for a feature from its culture's words (null when the pattern can't be filled). */
    _compose(ctx, f, rng) {
        const D = GeoNames.data();
        const K = _obj(D.kinds) && D.kinds[f.kind];
        if (!K) return null;
        const C = (_obj(D.cultures) && D.cultures[f.culture]) || {};
        const subKey = f.sub && f.sub !== 'default' ? f.sub : null;
        const cNouns = _obj(C.nouns) || {};
        const kNouns = _obj(K.nouns) || {};
        const nouns = (subKey && cNouns[subKey]) || (!subKey && cNouns[f.kind]) || (subKey && kNouns[subKey]) || kNouns.default || [''];
        let patterns = (subKey && Array.isArray(K[subKey]) && K[subKey]) || K.patterns || ['the {root} {noun}'];
        if (!f.town) patterns = patterns.filter(p => !p.includes('{town}'));
        if (!patterns.length) return null;
        const pattern = _pick(rng, patterns);
        const croots = Array.isArray(C.roots) ? C.roots : [];
        const kroots = Array.isArray(K.roots) ? K.roots : [];
        const root = () => (croots.length && (rng() < 0.55 || !kroots.length) ? _pick(rng, croots) : _pick(rng, kroots.length ? kroots : ['Old']));
        // (in the culture's own tongue more often the more it keeps to it)
        const tongueShare = _num(C.tongue, 0.3);
        let p = pattern;
        if (p.includes('{root}') && p.includes('{tongue}')) p = rng() < tongueShare ? p.replace('{root}', '{tongue}') : p.replace('{tongue}', '{root}');
        const out = p
            .replace('{noun}', () => _pick(rng, nouns))
            .replace('{croot}', () => root().replace(/'s$/, 's').replace(/[^A-Za-z]/g, ''))
            .replace('{root}', root)
            .replace('{tongue}', () => GeoNames._tongue(f.culture, rng))
            .replace('{town}', () => f.town || '');
        return out.replace(/\s+/g, ' ').trim();
    },

    /** A name without its leading article (for the map's lettering). */
    bare(name) {
        return String(name || '').replace(/^the\s+/i, '');
    },
};

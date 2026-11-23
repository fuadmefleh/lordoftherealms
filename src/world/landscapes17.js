// ============================================
// LANDSCAPES (terrainGen 17) — glaciers, badlands and canyons, volcanoes, reefs
// ============================================
// Run by Terrain.generateMap once the rivers, marshes and resources are final
// (worlds since terrainGen 17 only; data/terrain.json `landscapes`, documented
// there under `_landscapes`). Draws only from the RNG it is handed (its own
// seeded stream), reads no globals.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';

const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'lake', 'sea']);

/** Tunables (data/terrain.json `landscapes` overrides them, section by section). */
export const LANDSCAPES_DEFAULTS = {
    glaciers: { peakMaxTemp: 0.34, valleyMaxTemp: 0.3, valleyMinElev: 0.74, valleyIce: 2, valleyRounds: 2 },
    badlands: {
        seedOn: ['hills', 'highlands'],
        on: ['hills', 'highlands', 'savanna', 'plains', 'desert'],
        maxMoisture: 0.12, growMoisture: 0.17, minTemp: 0.55, lowMinRise: 0.07,
        desertBonus: 0.06, patchesPerLand: 0.0025, patchSpacing: 6, patchMin: 3, patchMax: 9, jitter: 0.04,
    },
    canyons: {
        on: ['hills', 'highlands', 'badlands', 'savanna', 'desert'], maxMoisture: 0.2, riverWet: 0.38, bankWet: 0.1, minTemp: 0.5, minRise: 0.08,
        perMap: 4, minLength: 3, maxLength: 9, spacing: 10, dryLength: [3, 6], dryTries: 30,
    },
    volcanoes: {
        min: 1, max: 3, minRange: 8, spacing: 18, minTemp: 0.25, minLowland: 6,
        ashOn: ['highlands', 'plains', 'grassland', 'savanna', 'woodland', 'seasonal_forest', 'boreal_forest', 'temperate_rainforest', 'tropical_rainforest', 'hills', 'desert', 'tundra', 'badlands'],
        ashRing2: 0.5, springs: [1, 2], springRadius: 3,
    },
    reefs: { minTemp: 0.64, seedChance: 0.35, grow: 0.55, atolls: true, mouthClear: 2, fishChance: 0.4 },
};

export const Landscapes17 = {
    config(data) {
        const D = LANDSCAPES_DEFAULTS;
        const c = data || {};
        const out = {};
        for (const k of Object.keys(D)) out[k] = { ...D[k], ...(c[k] || {}) };
        return out;
    },

    /**
     * Lay the new landscapes on a finished map. ctx: { T (Terrain), rng,
     * waterThreshold, hillsLevel, minerals, resMultiplier, strategicMultiplier,
     * config (data/terrain.json landscapes) }. Marks: tile._canyon (a canyon hex,
     * badlands terrain), tile._reef (warm coral shallows, still coastal water),
     * tile.hotSpring (with the HOT_SPRINGS resource), tile._volcano (the
     * volcano's number on the ash around it). -> stats.
     */
    apply(tiles, width, height, ctx) {
        const T = ctx.T;
        const TY = T.TYPES || {};
        const rng = ctx.rng || (() => Utils.random());
        const C = Landscapes17.config(ctx.config || T.LANDSCAPES);
        const wt = ctx.waterThreshold ?? 0.42;
        const hillsLvl = ctx.hillsLevel ?? 0.52;
        const at = (q, r) => (r < 0 || r >= height) ? null : tiles[r][Hex.wrapQ(q, width)];
        const nbrs = (t) => Hex.neighbors(t.q, t.r).map(n => at(n.q, n.r));
        const id = (t) => t && t.terrain && t.terrain.id;
        const isWater = (t) => !!t && WATER.has(id(t));
        const isLand = (t) => !!t && !!t.terrain && !isWater(t);
        const scale = Math.sqrt((width * height) / (120 * 80));
        const reroll = (t) => {
            t.resource = ctx.minerals
                ? T.rollResource15(t, ctx.minerals, ctx.resMultiplier ?? 1, ctx.strategicMultiplier ?? 1)
                : T.rollResource(id(t), t.q, t.r, ctx.resMultiplier ?? 1, ctx.strategicMultiplier ?? 1);
        };
        // would making this passable hex impassable cut the land about it apart?
        const cuts = (t) => {
            if (!t.terrain.passable) return false;
            const ring = nbrs(t).filter(n => n && n.terrain && n.terrain.passable);
            if (ring.length <= 1) return false;
            const want = new Set(ring);
            const seen = new Set([t, ring[0]]);
            const queue = [ring[0]];
            let found = 1;
            for (let k = 0; k < queue.length && found < want.size && k < 2500; k++) {
                for (const o of nbrs(queue[k])) {
                    if (!o || seen.has(o) || !o.terrain.passable) continue;
                    seen.add(o);
                    queue.push(o);
                    if (want.has(o)) found++;
                }
            }
            return found < want.size;
        };
        const land = [];
        for (const row of tiles) for (const t of row) if (isLand(t) && t.terrain.passable) land.push(t);
        const stats = { glaciers: 0, badlands: 0, canyons: [], volcanoes: [], ash: 0, springs: 0, reefs: 0 };

        // ── 1. glaciers: the coldest peaks under ice, and the high cold valleys between them ──
        const G = C.glaciers;
        if (TY.GLACIER) {
            for (const row of tiles) for (const t of row) {
                if (id(t) === 'snow_peak' && (t.temperature ?? 0.5) <= G.peakMaxTemp) {
                    t.terrain = TY.GLACIER;
                    t.resource = null;
                    stats.glaciers++;
                }
            }
            for (let round = 0; round < G.valleyRounds; round++) {
                const turn = [];
                for (const row of tiles) for (const t of row) {
                    if (id(t) !== 'mountain' || t._pass || t.settlement) continue;
                    if ((t.temperature ?? 0.5) > G.valleyMaxTemp || t.elevation < G.valleyMinElev) continue;
                    if (nbrs(t).some(n => n && n._pass)) continue;
                    if (nbrs(t).filter(n => id(n) === 'glacier').length < G.valleyIce) continue;
                    turn.push(t);
                }
                for (const t of turn) {
                    if (cuts(t)) continue;
                    t.terrain = TY.GLACIER;
                    t.resource = null;
                    stats.glaciers++;
                }
            }
        }

        // ── 2. badlands: patches of eroded ground in the dry uplands and at the desert's edge ──
        const B = C.badlands;
        const BAD = TY.BADLANDS;
        const desertBeside = (t) => nbrs(t).some(n => id(n) === 'desert');
        const upland = (t, rise) => (B.seedOn || []).includes(id(t)) || (t.elevation - wt) >= rise;
        const badOk = (t, maxM) => t && BAD && (B.on || []).includes(id(t)) && !t.settlement && !t._pass && !t._lake
            && (t.temperature ?? 0.5) >= B.minTemp && (t.moisture ?? 0.5) <= maxM && upland(t, B.lowMinRise);
        if (BAD) {
            const seeds = [];
            for (const t of land) {
                if (!(B.seedOn || []).includes(id(t)) || !badOk(t, B.maxMoisture)) continue;
                seeds.push({ t, s: (B.maxMoisture - t.moisture) + (desertBeside(t) ? B.desertBonus : 0) + rng() * B.jitter });
            }
            seeds.sort((a, b) => b.s - a.s || a.t.r - b.t.r || a.t.q - b.t.q);
            const want = Math.round(B.patchesPerLand * land.length);
            const placed = [];
            for (const { t } of seeds) {
                if (placed.length >= want) break;
                if (id(t) === 'badlands' || placed.some(p => Hex.wrappingDistance(p.q, p.r, t.q, t.r, width) < B.patchSpacing)) continue;
                const size = B.patchMin + Math.floor(rng() * (B.patchMax - B.patchMin + 1));
                const patch = [t];
                const inP = new Set(patch);
                for (let k = 0; k < patch.length && patch.length < size; k++) {
                    const ns = nbrs(patch[k]).filter(n => n && !inP.has(n) && badOk(n, B.growMoisture));
                    for (let i = ns.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ns[i], ns[j]] = [ns[j], ns[i]]; }
                    for (const n of ns) { if (patch.length >= size) break; inP.add(n); patch.push(n); }
                }
                if (patch.length < B.patchMin) continue;
                for (const p of patch) { p.terrain = BAD; reroll(p); stats.badlands++; }
                placed.push(t);
            }
        }

        // ── canyons: dry-country rivers cut gorges through the uplands; a few dry ravines
        // wind through the badlands where no river runs now ──
        const K = C.canyons;
        // (a river hex and its banks were made greener by the river itself, Terrain._riverbanks12:
        // the country it runs through is dry if it would be dry without it, riverWet less)
        // (and the country either side must be dry too, bankWet less for the river beside it)
        const banks = (t) => nbrs(t).filter(n => isLand(n) && !n.hasRiver);
        const dryBanks = (t) => {
            const b = banks(t);
            if (!b.length) return false;
            const m = b.reduce((a, n) => a + (n.moisture ?? 0.5), 0) / b.length;
            return m <= K.maxMoisture + K.bankWet || b.filter(n => id(n) === 'badlands' || id(n) === 'desert').length >= 2;
        };
        const canyonOk = (t) => t && BAD && (K.on || []).includes(id(t)) && !t.settlement && !t._pass && !t._lake
            && (t.moisture ?? 0.5) <= K.maxMoisture + (t.hasRiver ? K.riverWet : 0)
            && (t.temperature ?? 0.5) >= K.minTemp && (t.elevation - wt) >= K.minRise
            && (!t.hasRiver || dryBanks(t));
        if (BAD) {
            const target = Math.max(1, Math.round(K.perMap * scale));
            const down = (t) => (t.hasRiver && Number.isInteger(t.riverDir) && t.riverDir >= 0) ? nbrs(t)[t.riverDir] : null;
            const runs = [];
            const used = new Set();
            for (const t of land) {
                if (!t.hasRiver || used.has(t) || !canyonOk(t)) continue;
                // (start where the river enters the dry uplands: the hex above it is not one)
                const ups = nbrs(t).filter((n, i) => n && n.hasRiver && n.riverDir === (i + 3) % 6);
                if (ups.some(canyonOk)) continue;
                const run = [];
                for (let c = t; c && canyonOk(c) && !used.has(c) && run.length < K.maxLength; c = down(c)) { run.push(c); used.add(c); }
                if (run.length >= K.minLength) runs.push(run);
            }
            runs.sort((a, b) => b.length - a.length || a[0].r - b[0].r || a[0].q - b[0].q);
            const cut = (run, river) => {
                for (const c of run) {
                    if (id(c) !== 'badlands') { c.terrain = BAD; reroll(c); stats.badlands++; }
                    c._canyon = true;
                }
                // (its rims: the dry upland beside the gorge is eroded badland too)
                for (const c of run) {
                    for (const n of banks(c)) {
                        if (n._canyon || id(n) === 'badlands' || n.settlement || n._pass || n._lake) continue;
                        if (!(K.on || []).includes(id(n)) || (n.moisture ?? 0.5) > K.maxMoisture + K.bankWet) continue;
                        n.terrain = BAD;
                        reroll(n);
                        stats.badlands++;
                    }
                }
                stats.canyons.push({ q: run[0].q, r: run[0].r, length: run.length, river });
            };
            const apart = (h) => !stats.canyons.some(c => Hex.wrappingDistance(c.q, c.r, h.q, h.r, width) < K.spacing);
            for (const run of runs) {
                if (stats.canyons.length >= target) break;
                if (apart(run[0])) cut(run, true);
            }
            // dry ravines winding out of the badland patches
            const bad = land.filter(t => id(t) === 'badlands' && !t._canyon);
            for (let n = 0; n < K.dryTries && stats.canyons.length < target && bad.length; n++) {
                const s = bad[Math.floor(rng() * bad.length) % bad.length];
                if (s._canyon || !apart(s)) continue;
                const len = K.dryLength[0] + Math.floor(rng() * (K.dryLength[1] - K.dryLength[0] + 1));
                const run = [s];
                const inR = new Set(run);
                let dir = Math.floor(rng() * 6);
                for (let step = 1; step < len; step++) {
                    const ring = nbrs(run[run.length - 1]);
                    const opts = [dir, (dir + 1) % 6, (dir + 5) % 6].filter(d => {
                        const o = ring[d];
                        return o && !inR.has(o) && !o._canyon && (id(o) === 'badlands' || canyonOk(o)) && !o.hasRiver
                            && !nbrs(o).some(x => x && x !== run[run.length - 1] && inR.has(x));
                    });
                    if (!opts.length) break;
                    dir = opts[Math.floor(rng() * opts.length) % opts.length];
                    run.push(ring[dir]);
                    inR.add(ring[dir]);
                }
                if (run.length >= K.minLength) cut(run, false);
            }
        }

        // ── 3. volcanoes: a few fire mountains in the long ranges, black fertile ash about
        // them and hot springs at their feet ──
        const V = C.volcanoes;
        if (TY.VOLCANO) {
            const isRange = (t) => t && (id(t) === 'mountain' || id(t) === 'snow_peak');
            const comp = new Map();
            const ranges = [];
            for (const row of tiles) for (const t of row) {
                if (!isRange(t) || comp.has(t)) continue;
                const members = [t];
                comp.set(t, ranges.length);
                for (let k = 0; k < members.length; k++) {
                    for (const o of nbrs(members[k])) if (isRange(o) && !comp.has(o)) { comp.set(o, ranges.length); members.push(o); }
                }
                ranges.push(members);
            }
            const lowAbout = (t) => {
                let n = 0;
                for (const h of Hex.hexesInRange(t.q, t.r, 2)) {
                    const o = at(h.q, h.r);
                    if (o && o !== t && (V.ashOn || []).includes(id(o)) && !o.settlement) n++;
                }
                return n;
            };
            const cands = [];
            for (const range of ranges) {
                if (range.length < V.minRange) continue;
                for (const t of range) {
                    if (t._pass || t.hasRiver || t.settlement || (t.temperature ?? 0.5) < V.minTemp) continue;
                    if (nbrs(t).some(n => !n || n._pass || n.hasRiver && isRange(n))) continue;
                    const low = lowAbout(t);
                    if (low < V.minLowland) continue;
                    cands.push({ t, s: Math.log(range.length) + low * 0.3 + rng() * 2 });
                }
            }
            cands.sort((a, b) => b.s - a.s || a.t.r - b.t.r || a.t.q - b.t.q);
            const want = Math.max(0, Math.round((V.min + Math.floor(rng() * (V.max - V.min + 1))) * Math.min(1.5, Math.max(0.6, scale))));
            for (const { t } of cands) {
                if (stats.volcanoes.length >= want) break;
                if (stats.volcanoes.some(v => Hex.wrappingDistance(v.q, v.r, t.q, t.r, width) < V.spacing * Math.max(0.6, scale))) continue;
                if (cuts(t)) continue;
                const n = stats.volcanoes.length + 1;
                t.terrain = TY.VOLCANO;
                t.resource = null;
                t._volcano = n;
                const v = { q: t.q, r: t.r, ash: 0, springs: [] };
                // the ash: the near ring all of it, the next ring in part
                if (TY.ASH_PLAINS) {
                    for (const h of Hex.hexesInRange(t.q, t.r, 2)) {
                        const o = at(h.q, h.r);
                        if (!o || o === t || !(V.ashOn || []).includes(id(o)) || o.settlement || o._pass || o._canyon) continue;
                        const d = Hex.wrappingDistance(t.q, t.r, o.q, o.r, width);
                        if (d > 1 && rng() >= V.ashRing2) continue;
                        o.terrain = TY.ASH_PLAINS;
                        o._volcano = n;
                        reroll(o);
                        v.ash++;
                        stats.ash++;
                    }
                }
                // hot springs where the ground is warm about it
                const HS = T.RESOURCES && T.RESOURCES.HOT_SPRINGS;
                const spots = [];
                for (const h of Hex.hexesInRange(t.q, t.r, V.springRadius)) {
                    const o = at(h.q, h.r);
                    if (!o || o === t || !o.terrain.passable || isWater(o) || o.settlement || o.hotSpring) continue;
                    if (Hex.wrappingDistance(t.q, t.r, o.q, o.r, width) < 1) continue;
                    spots.push(o);
                }
                const nSpr = V.springs[0] + Math.floor(rng() * (V.springs[1] - V.springs[0] + 1));
                for (let k = 0; k < nSpr && spots.length; k++) {
                    const i = Math.floor(rng() * spots.length) % spots.length;
                    const o = spots.splice(i, 1)[0];
                    o.hotSpring = true;
                    if (HS) o.resource = HS;
                    v.springs.push({ q: o.q, r: o.r });
                    stats.springs++;
                }
                stats.volcanoes.push(v);
            }
        }

        // ── 4. reefs: coral in the warm shallows along the shore and round warm isles ──
        const R = C.reefs;
        {
            const FISH = T.RESOURCES && T.RESOURCES.FISH;
            const mouthNear = (t) => {
                for (const h of Hex.hexesInRange(t.q, t.r, R.mouthClear)) {
                    const o = at(h.q, h.r);
                    if (!o || !o.hasRiver || isWater(o)) continue;
                    const dn = (Number.isInteger(o.riverDir) && o.riverDir >= 0) ? nbrs(o)[o.riverDir] : null;
                    if (dn && isWater(dn)) return true;
                }
                return false;
            };
            const reefOk = (t) => {
                if (!t || t._reef || t._fjord || t._lake || t.waterBodyType === 'lake') return false;
                if ((t.temperature ?? 0.5) < R.minTemp) return false;
                const ns = nbrs(t);
                if (ns.some(n => n && (id(n) === 'swamp' || id(n) === 'lake'))) return false;
                if (id(t) === 'coast') return ns.some(n => isLand(n));
                // (an atoll: open ocean ringing a warm isle)
                return !!R.atolls && id(t) === 'ocean' && ns.some(n => id(n) === 'island');
            };
            const cand = [];
            for (const row of tiles) for (const t of row) if (reefOk(t) && !mouthNear(t)) cand.push(t);
            for (const t of cand) {
                if (t._reef || rng() >= R.seedChance) continue;
                const run = [t];
                t._reef = true;
                for (let k = 0; k < run.length; k++) {
                    for (const n of nbrs(run[k])) {
                        if (reefOk(n) && !mouthNear(n) && rng() < R.grow) { n._reef = true; run.push(n); }
                    }
                }
                for (const r of run) {
                    stats.reefs++;
                    if (!r.resource && FISH && rng() < R.fishChance) r.resource = FISH;
                }
            }
        }
        return stats;
    },
};

// Worlds since terrainGen 16 (Terrain._passes16, data/terrain.json passes): a long
// mountain range is a wall with gateways. Each long range with lowland on both sides is
// crossed by one to three narrow passes over its lowest saddle, highlands at the crest
// and hills at the feet; older worlds keep their ranges as they were made.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { World } from '../world/world.js';
import { Terrain } from '../world/terrain.js';

const SEEDS = [4711, 99, 2024];
const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'sea', 'lake']);
const PEAKS = new Set(['mountain', 'snow_peak']);
const UPLAND = new Set(['highlands', 'mountain', 'snow_peak']);
const make = (gen, seed) => {
    const w = new World(120, 80);
    w.generate({ seed, kingdomCount: 6, terrainGen: gen, riverCount: 40 });
    return { w, info: gen >= 16 ? Terrain._lastPasses16 : null };
};
const tileAt = (w, h) => w.tiles[h.r][Hex.wrapQ(h.q, w.width)];
const count = (w, ids) => w.tiles.flat().filter(t => ids.has(t.terrain.id)).length;
// (as in roadRiverNetwork: since terrainGen 15 a small river may die out in dry country)
const dryNear = (w, t) => Hex.hexesInRange(t.q, t.r, 2).some(h => {
    const o = h.r >= 0 && h.r < w.height ? tileAt(w, h) : null;
    return o && (o.terrain.id === 'desert' || (['savanna', 'plains', 'tundra'].includes(o.terrain.id) && o.moisture < 0.3));
});

const worlds = {};
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    for (const s of SEEDS) worlds[s] = { g15: make(15, s), g16: make(16, s) };
});

describe('Mountain passes (terrainGen 16)', () => {
    it('finds the long ranges and crosses every one with lowland on both sides', () => {
        for (const s of SEEDS) {
            const { info } = worlds[s].g16;
            expect(info.ranges.length).toBeGreaterThan(1);
            for (const r of info.ranges) {
                expect(r.crossings.length).toBeLessThanOrEqual(3);
                // (a range with lowland on only one side, a coastal wall, has nothing to cross to;
                // every other has its pass)
                if (r.sites) expect(r.crossings.length).toBeGreaterThan(0);
            }
            expect(info.ranges.filter(r => r.crossings.length).length / info.ranges.length).toBeGreaterThanOrEqual(0.5);
            expect(info.passes.length).toBeGreaterThanOrEqual(2);
        }
    });

    it('every pass is a walk of non-mountain land from lowland on one side to lowland on the other', () => {
        for (const s of SEEDS) {
            const { w, info } = worlds[s].g16;
            for (const p of info.passes) {
                const tiles = p.path.map(h => tileAt(w, h));
                for (let i = 1; i < p.path.length; i++) {
                    const a = p.path[i - 1], b = p.path[i];
                    expect(Hex.wrappingOffsetDistance(a.q, a.r, b.q, b.r, w.width)).toBe(1);
                }
                for (const t of tiles) {
                    expect(PEAKS.has(t.terrain.id)).toBe(false);
                    expect(t.terrain.passable).toBe(true);
                }
                // (it starts and ends below the highlands, and the cut is in its middle)
                expect(UPLAND.has(tiles[0].terrain.id)).toBe(false);
                expect(UPLAND.has(tiles[tiles.length - 1].terrain.id)).toBe(false);
                expect(tiles.some(t => t._pass === p.id)).toBe(true);
            }
        }
    });

    it('a pass is a narrow notch: highlands at the crest, hills toward its feet', () => {
        for (const s of SEEDS) {
            const { w, info } = worlds[s].g16;
            for (const p of info.passes) {
                const hexes = p.hexes.map(h => tileAt(w, h));
                expect(hexes.length).toBeGreaterThan(0);
                expect(hexes.length).toBeLessThanOrEqual(20);
                for (const t of hexes) {
                    expect(t._pass).toBe(p.id);
                    expect(['highlands', 'hills']).toContain(t.terrain.id);
                }
                // (one hex wide: hardly a pass hex touches more than two others of its pass)
                const wide = hexes.filter(t => Hex.neighbors(t.q, t.r)
                    .filter(n => n.r >= 0 && n.r < w.height && tileAt(w, n)._pass === p.id).length > 2).length;
                expect(wide).toBeLessThanOrEqual(Math.ceil(hexes.length / 4));
            }
        }
    });

    it('takes only a little of the mountains away', () => {
        let a = 0, b = 0;
        for (const s of SEEDS) {
            const m15 = count(worlds[s].g15.w, PEAKS), m16 = count(worlds[s].g16.w, PEAKS);
            expect(m16).toBeGreaterThan(m15 * 0.9);
            a += m15; b += m16;
        }
        expect(b).toBeLessThan(a);
    });

    it('rivers still run to water (or die out in dry country, as since terrainGen 15)', () => {
        for (const s of SEEDS) {
            const { w } = worlds[s].g16;
            const dead = w.tiles.flat().filter(t => {
                if (!t.hasRiver) return false;
                const n = Hex.neighbors(t.q, t.r)[t.riverDir];
                const d = n.r >= 0 && n.r < w.height ? tileAt(w, n) : null;
                return d && !d.hasRiver && !WATER.has(d.terrain.id);
            });
            for (const t of dead) expect(dryNear(w, t)).toBe(true);
        }
    });

    it('is the same world from the same seed', () => {
        const a = make(16, 4711), b = make(16, 4711);
        const sig = (w) => w.tiles.flat().map(t => t.terrain.id + (t._pass || '')).join();
        expect(sig(a.w)).toBe(sig(b.w));
        expect(a.info.passes.map(p => p.path)).toEqual(b.info.passes.map(p => p.path));
    });

    it('leaves worlds before terrainGen 16 as they were made: no passes', () => {
        for (const s of SEEDS) expect(worlds[s].g15.w.tiles.flat().some(t => t._pass)).toBe(false);
    });

    it('names a pass hex as a pass', () => {
        const { w, info } = worlds[SEEDS[0]].g16;
        expect(Terrain.getRegionName(tileAt(w, info.passes[0].hexes[0]), w)).toBe('Mountain Pass');
    });
});

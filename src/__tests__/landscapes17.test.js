// Worlds since terrainGen 17 (world/landscapes17.js, data/terrain.json landscapes): new kinds
// of land, each sparse and where it belongs. Glaciers on the coldest peaks and in the high
// cold valleys between them; badlands in the dry uplands, with a few canyons (dry-country
// rivers in gorges, dry ravines); one to three volcanoes in the ranges, ringed by rich
// volcanic soil with hot springs at their feet; coral reefs in the warm shallows. Worlds
// before 17 are untouched.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Terrain } from '../world/terrain.js';
import { World } from '../world/world.js';
import { Landscapes17 } from '../world/landscapes17.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Renderer } from '../ui/renderer.js';

const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'lake', 'sea']);
const NEW_IDS = new Set(['glacier', 'badlands', 'volcano', 'ash_plains']);
const RANGE = new Set(['mountain', 'snow_peak', 'glacier']);
const SEEDS = [4711, 12345];
const make = (gen, seed) => {
    const w = new World(120, 80);
    w.generate({ seed, kingdomCount: 6, terrainGen: gen, riverCount: 40 });
    return w;
};
const at = (w, q, r) => (r < 0 || r >= w.height) ? null : w.tiles[r][Hex.wrapQ(q, w.width)];
const nbrs = (w, t) => Hex.neighbors(t.q, t.r).map(n => at(w, n.q, n.r)).filter(Boolean);
const all = (w) => w.tiles.flat();
const land = (w) => all(w).filter(t => !WATER.has(t.terrain.id));
const of = (w, id) => all(w).filter(t => t.terrain.id === id);
const C = () => Landscapes17.config(Terrain.LANDSCAPES);

const worlds = {};
let w16;
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    for (const seed of SEEDS) worlds[seed] = make(17, seed);
    w16 = make(16, 4711);
}, 180000);

describe('Landscapes (terrainGen 17)', () => {
    it('leaves a gen 16 world exactly as it was', () => {
        const counts = {};
        for (const t of all(w16)) counts[t.terrain.id] = (counts[t.terrain.id] || 0) + 1;
        // (frozen before terrainGen 17 existed)
        expect(counts).toEqual({
            deep_ocean: 3068, ocean: 2022, island: 21, coast: 173, woodland: 266, boreal_forest: 189, hills: 696,
            highlands: 320, swamp: 88, lake: 185, beach: 60, tundra: 23, temperate_rainforest: 32, plains: 1098,
            seasonal_forest: 363, desert: 357, savanna: 199, tropical_rainforest: 73, mountain: 285, sea: 8,
            snow_peak: 49, snow: 25,
        });
        expect(all(w16).some(t => t._reef || t._canyon || t.hotSpring || t._volcano)).toBe(false);
        expect(all(w16).some(t => t.resource && t.resource.id === 'hot_springs')).toBe(false);
    });

    it('puts glaciers only on the highest, coldest ground, never on a pass', () => {
        const G = C().glaciers;
        for (const seed of SEEDS) {
            const w = worlds[seed];
            const ice = of(w, 'glacier');
            expect(ice.length).toBeGreaterThan(10);
            for (const t of ice) {
                expect(t.elevation).toBeGreaterThanOrEqual(G.valleyMinElev);
                expect(t.temperature).toBeLessThanOrEqual(Math.max(G.peakMaxTemp, G.valleyMaxTemp));
                expect(t._pass).toBeFalsy();
                expect(t.terrain.passable).toBe(false);
            }
            // (the valley ice lies between ice-capped peaks)
            const valleys = ice.filter(t => t.elevation <= 0.88);
            for (const t of valleys) expect(nbrs(w, t).filter(n => n.terrain.id === 'glacier').length).toBeGreaterThanOrEqual(G.valleyIce);
            // no cold peak left bare of ice
            expect(of(w, 'snow_peak').every(t => t.temperature > G.peakMaxTemp)).toBe(true);
        }
    });

    it('lays badlands in sparse patches in dry, warm uplands', () => {
        const B = C().badlands;
        const K = C().canyons;
        for (const seed of SEEDS) {
            const w = worlds[seed];
            const bad = of(w, 'badlands');
            const share = bad.length / land(w).length;
            expect(share).toBeGreaterThan(0.004);
            expect(share).toBeLessThan(0.04);
            for (const t of bad) {
                expect(t.temperature).toBeGreaterThanOrEqual(Math.min(B.minTemp, K.minTemp));
                expect(t.moisture).toBeLessThanOrEqual(t.hasRiver ? K.maxMoisture + K.riverWet : Math.max(B.growMoisture, K.maxMoisture + K.bankWet));
                expect(t.settlement && t.settlement.type === 'capital').toBeFalsy();
            }
            // patches, not speckles
            const set = new Set(bad);
            const alone = bad.filter(t => !nbrs(w, t).some(n => set.has(n))).length;
            expect(alone / bad.length).toBeLessThan(0.1);
        }
    });

    it('cuts a few canyons: winding lines of badland, river canyons following the river down', () => {
        let rivered = 0;
        for (const seed of SEEDS) {
            const w = worlds[seed];
            const can = all(w).filter(t => t._canyon);
            expect(can.length).toBeGreaterThanOrEqual(6);
            expect(can.every(t => t.terrain.id === 'badlands')).toBe(true);
            for (const t of can) {
                // (each canyon hex runs on to another, a line, not a blot)
                expect(nbrs(w, t).some(n => n._canyon)).toBe(true);
                if (t.hasRiver) rivered++;
            }
        }
        expect(rivered).toBeGreaterThan(0);
    });

    it('raises one to three volcanoes in the ranges, ringed by volcanic soil and hot springs', () => {
        for (const seed of SEEDS) {
            const w = worlds[seed];
            const vs = of(w, 'volcano');
            expect(vs.length).toBeGreaterThanOrEqual(1);
            expect(vs.length).toBeLessThanOrEqual(3);
            for (const v of vs) {
                expect(v.terrain.passable).toBe(false);
                expect(v.hasRiver).toBe(false);
                expect(nbrs(w, v).some(n => RANGE.has(n.terrain.id))).toBe(true);
                const ash = all(w).filter(t => t.terrain.id === 'ash_plains' && t._volcano === v._volcano);
                expect(ash.length).toBeGreaterThanOrEqual(3);
                for (const a of ash) expect(Hex.wrappingDistance(v.q, v.r, a.q, a.r, w.width)).toBeLessThanOrEqual(2);
                const springs = all(w).filter(t => t.hotSpring && Hex.wrappingDistance(v.q, v.r, t.q, t.r, w.width) <= C().volcanoes.springRadius);
                expect(springs.length).toBeGreaterThanOrEqual(1);
                for (const s of springs) {
                    expect(s.terrain.passable).toBe(true);
                    expect(s.resource && s.resource.id).toBe('hot_springs');
                }
            }
            // volcanic soil is the best farmland there is
            const M = JSON.parse(fs.readFileSync('data/markets.json', 'utf8'));
            expect(M.fertility.ash_plains).toBeGreaterThan(M.fertility.plains);
        }
    });

    it('grows coral reefs only in warm shallows beside land or round a warm isle', () => {
        const R = C().reefs;
        for (const seed of SEEDS) {
            const w = worlds[seed];
            const reefs = all(w).filter(t => t._reef);
            expect(reefs.length).toBeGreaterThan(5);
            for (const t of reefs) {
                expect(['coast', 'ocean']).toContain(t.terrain.id);
                expect(t.temperature).toBeGreaterThanOrEqual(R.minTemp);
                expect(t._fjord || t._lake || t.waterBodyType === 'lake').toBeFalsy();
                const ns = nbrs(w, t);
                if (t.terrain.id === 'coast') expect(ns.some(n => !WATER.has(n.terrain.id))).toBe(true);
                else expect(ns.some(n => n.terrain.id === 'island')).toBe(true);
            }
            // (still water for ships and every water rule)
            expect(reefs.every(t => Terrain.isWaterId(t.terrain.id))).toBe(true);
            // a sparse share of the warm coast
            const warmCoast = of(w, 'coast').filter(t => t.temperature >= R.minTemp && nbrs(w, t).some(n => !WATER.has(n.terrain.id)));
            expect(reefs.length).toBeLessThan(warmCoast.length + 30);
        }
    });

    it('keeps the new land sparse', () => {
        for (const seed of SEEDS) {
            const w = worlds[seed];
            const n = land(w).filter(t => NEW_IDS.has(t.terrain.id)).length;
            expect(n / land(w).length).toBeLessThan(0.06);
        }
    });

    it('never moves a river, and rivers still run down to water', () => {
        // the pass itself, on a gen 16 map: no river mark changes
        Terrain._currentThresholds = null;
        const tiles = Terrain.generateMap(120, 80, { seed: 4711, terrainGen: 16, riverCount: 40 });
        const before = tiles.flat().map(t => `${t.hasRiver ? 1 : 0}${t.riverDir ?? '-'}${t.riverBranch ?? ''}`).join();
        Landscapes17.apply(tiles, 120, 80, { T: Terrain, rng: (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })() });
        const after = tiles.flat().map(t => `${t.hasRiver ? 1 : 0}${t.riverDir ?? '-'}${t.riverBranch ?? ''}`).join();
        expect(after).toBe(before);
        for (const seed of SEEDS) {
            const w = worlds[seed];
            let mouths = 0;
            for (const t of all(w)) {
                if (!t.hasRiver || !Number.isInteger(t.riverDir) || t.riverDir < 0) continue;
                const d = Hex.neighbors(t.q, t.r)[t.riverDir];
                const dn = at(w, d.q, d.r);
                if (!dn) continue;
                expect(dn.terrain.id).not.toBe('volcano');
                if (WATER.has(dn.terrain.id)) mouths++;
            }
            expect(mouths).toBeGreaterThan(10);
        }
    });

    it('settles nobody on impassable ground, and the land about it stays joined', () => {
        for (const seed of SEEDS) {
            const w = worlds[seed];
            for (const t of all(w)) {
                if (t.settlement) {
                    expect(t.terrain.passable).toBe(true);
                    expect(['glacier', 'volcano']).not.toContain(t.terrain.id);
                }
            }
            // every volcano or valley glacier left its passable neighbours joined (a few steps round)
            for (const t of [...of(w, 'volcano'), ...of(w, 'glacier').filter(g => g.elevation <= 0.88)]) {
                const ring = nbrs(w, t).filter(n => n.terrain.passable);
                if (ring.length < 2) continue;
                expect(new Set(ring.map(n => n.regionId)).size).toBe(1);
            }
        }
    });

    it('is the same world from the same seed', () => {
        const again = make(17, 4711);
        const sig = (w) => all(w).map(t => `${t.terrain.id}${t._reef ? 'R' : ''}${t._canyon ? 'C' : ''}${t.hotSpring ? 'H' : ''}${t.resource ? t.resource.id : ''}`).join();
        expect(sig(again)).toBe(sig(worlds[4711]));
    });

    it('names, draws and walks the new land', () => {
        const w = worlds[4711];
        const v = of(w, 'volcano')[0];
        expect(Terrain.getRegionName(v, w)).toBe('Volcano');
        const can = all(w).find(t => t._canyon);
        expect(Terrain.getRegionName(can, w)).toBe('Canyon');
        const reef = all(w).find(t => t._reef);
        expect(Terrain.getRegionName(reef, w)).toBe('Coral Reef');
        const ice = of(w, 'glacier')[0];
        expect(Terrain.getRegionName(ice, w)).toBe('Glacier');
        for (const t of [v, can, reef, ice, of(w, 'ash_plains')[0], of(w, 'badlands').find(b => !b._canyon)]) {
            expect(typeof Terrain.getRegionDescription(t, w)).toBe('string');
            const img = Renderer.prototype.getTileImage.call({}, t);
            expect(img).toBeTruthy();
            expect(fs.existsSync(`assets/tiles/${img}`)).toBe(true);
        }
        const D = (t) => Infrastructure.getPlayerHexDays({ terrain: t, hasRiver: false, hasRoad: false, infrastructure: null }, { _travelSpeed: 1 });
        expect(D(Terrain.TYPES.BADLANDS)).toBeCloseTo(2);
        expect(D(Terrain.TYPES.ASH_PLAINS)).toBeCloseTo(0.75);
        expect(D(Terrain.TYPES.GLACIER)).toBe(Infinity);
        expect(D(Terrain.TYPES.VOLCANO)).toBe(Infinity);
    });
});

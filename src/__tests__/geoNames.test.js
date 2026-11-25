// The names of the land and the water (world/geoNames.js, data/geography.json): ranges,
// passes, rivers, lakes, seas and bays, forests, deserts, fens and islands found in the
// tiles and named in the tongue of the people round them — a hash of the world seed,
// never Utils' RNG — so any world of any version has them and nothing else moves.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { GeoNames } from '../world/geoNames.js';
import { Hex } from '../core/hex.js';

// A drawn world: land everywhere but where `water(q, r)` gives a terrain id
const drawn = (W, H, water) => {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: { id: water(q, r) || 'plains' } });
        tiles.push(row);
    }
    return { width: W, height: H, tiles, kingdoms: [], generationParams: { seed: 'drawn' } };
};

const make = (seed, gen = 16, w = 120, h = 80) => {
    const world = new World(w, h);
    world.generate({ seed, kingdomCount: 6, terrainGen: gen, riverCount: 40 });
    return world;
};

let worlds;
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    worlds = [make(4711), make(99)];
}, 120000);

const kinds = (w) => new Set(GeoNames.features(w).features.map(f => f.kind));

describe('Geo names: the features', () => {
    it('finds ranges, rivers, lakes and seas on generated worlds', () => {
        for (const w of worlds) {
            const k = kinds(w);
            for (const kind of ['range', 'river', 'lake', 'sea', 'forest']) expect(k.has(kind), kind).toBe(true);
            const { features } = GeoNames.features(w);
            // one body of open water is one sea (an ocean), not a patchwork of seas:
            // only water behind a strait (f.strait) is named apart from the rest of its body
            const seas = features.filter(f => f.kind === 'sea');
            const SEA = new Set(['deep_ocean', 'ocean', 'coast', 'sea']);
            const bodyOf = new Int32Array(w.width * w.height).fill(-1);
            let nb = 0;
            for (let s = 0; s < bodyOf.length; s++) {
                const t0 = w.tiles[(s / w.width) | 0][s % w.width];
                if (bodyOf[s] >= 0 || !SEA.has(t0.terrain.id)) continue;
                const q = [s];
                bodyOf[s] = nb;
                for (let p = 0; p < q.length; p++) {
                    const i = q[p];
                    for (const n of Hex.neighbors(i % w.width, (i / w.width) | 0)) {
                        if (n.r < 0 || n.r >= w.height) continue;
                        const j = n.r * w.width + Hex.wrapQ(n.q, w.width);
                        if (bodyOf[j] >= 0 || !SEA.has(w.tiles[n.r][j % w.width].terrain.id)) continue;
                        bodyOf[j] = nb;
                        q.push(j);
                    }
                }
                nb++;
            }
            const perBody = new Map();
            for (const f of seas.filter(x => !x.strait)) {
                const b = bodyOf[f.anchor];
                perBody.set(b, (perBody.get(b) || 0) + 1);
            }
            for (const n of perBody.values()) expect(n).toBe(1);
            // the greatest water is an ocean, its one name lettered in several places on it
            const big = seas.slice().sort((a, b) => b.size - a.size)[0];
            expect(big.sub).toBe('ocean');
            expect(big.anchors.length).toBeGreaterThan(1);
            const on = new Set(big.tiles);
            for (const a of big.anchors) expect(on.has(a.tile)).toBe(true);
            // a river runs from its spring to its mouth, every hex a river hex, each draining into the next
            for (const f of features.filter(x => x.kind === 'river')) {
                expect(f.tiles.length).toBeGreaterThan(3);
                expect(f.size).toBeGreaterThanOrEqual(GeoNames.size('river', 14));
                for (const i of f.tiles) expect(w.tiles[(i / w.width) | 0][i % w.width].hasRiver).toBe(true);
                expect(f.anchors.length).toBeGreaterThan(0);
            }
            // a range is mountain country, and its long axis is longer than it is wide
            for (const f of features.filter(x => x.kind === 'range')) {
                const t = w.tiles[(f.anchor / w.width) | 0][f.anchor % w.width];
                expect(['mountain', 'snow_peak', 'highlands']).toContain(t.terrain.id);
                expect(f.length).toBeGreaterThanOrEqual(f.width);
            }
        }
    });

    it('names the passes through the ranges (terrainGen 16)', () => {
        const w = worlds.find(x => x.tiles.flat().some(t => t._pass != null));
        if (!w) return;
        expect(kinds(w).has('pass')).toBe(true);
        const t = w.tiles.flat().find(x => x._pass != null);
        expect(GeoNames.at(w, t.q, t.r).pass).toBeTruthy();
        expect(GeoNames.nameAt(w, t.q, t.r)).toBe(GeoNames.at(w, t.q, t.r).pass.name);
    });

    it('looks a hex up: a range hex is in its range, a sea hex in a sea or bay', () => {
        const w = worlds[0];
        const range = GeoNames.features(w).features.find(f => f.kind === 'range');
        const i = range.tiles[0];
        const hit = GeoNames.at(w, i % w.width, (i / w.width) | 0);
        expect(hit.land === range || hit.pass).toBeTruthy();
        const sea = w.tiles.flat().find(t => t.terrain.id === 'deep_ocean');
        expect(['sea', 'bay']).toContain(GeoNames.at(w, sea.q, sea.r).water.kind);
    });

    it('names one ocean across coast, ocean and deep water, and keeps a cut-off sea and a lake apart', () => {
        // an ocean round a continent (deep far out, coast by the shore), an inland sea
        // and a lake in the continent, none joined to the ocean
        const W = 80, H = 50;
        const w = drawn(W, H, (q, r) => {
            const land = q >= 15 && q < 65 && r >= 10 && r < 40;
            if (!land) return (q < 8 || q >= 72 || r < 4 || r >= 46) ? 'deep_ocean' : (q < 13 || q >= 67 || r < 8 || r >= 42) ? 'ocean' : 'coast';
            if (q >= 22 && q < 36 && r >= 16 && r < 30) return 'ocean';   // the inland sea
            if (q >= 48 && q < 52 && r >= 20 && r < 23) return 'lake';
            return null;
        });
        const { features } = GeoNames.features(w);
        const water = features.filter(f => f.kind === 'sea' || f.kind === 'bay');
        const at = (q, r) => GeoNames.at(w, q, r).water;
        const ocean = at(2, 2);
        expect(ocean.kind).toBe('sea');
        expect(ocean.sub).toBe('ocean');
        // every hex of the ocean, deep or shallow, near or far, is the one ocean
        for (const [q, r] of [[2, 2], [40, 2], [78, 48], [10, 25], [70, 25], [40, 44], [14, 25], [40, 9]]) expect(at(q, r), `${q},${r}`).toBe(ocean);
        expect(water.filter(f => f.sub === 'ocean').length).toBe(1);
        expect(ocean.anchors.length).toBeGreaterThan(1);
        expect(new Set(ocean.anchors.map(a => a.tile)).size).toBe(ocean.anchors.length);
        // the inland sea is its own sea, the lake its own lake
        const inland = at(28, 22);
        expect(inland).not.toBe(ocean);
        expect(inland.kind).toBe('sea');
        expect(inland.sub).not.toBe('ocean');
        expect(at(49, 21).kind).toBe('lake');
        expect(new Set([ocean.name, inland.name, at(49, 21).name]).size).toBe(3);
    });

    it('splits water only at a strait: two oceans through a narrows, one water through a wide sound', () => {
        // two great basins, joined by a channel `width` rows wide
        const make2 = (width) => drawn(90, 44, (q, r) => {
            if ((q >= 2 && q < 38 && r >= 2 && r < 42) || (q >= 52 && q < 88 && r >= 2 && r < 42)) return 'ocean';
            if (q >= 38 && q < 52 && r >= 21 && r < 21 + width) return 'coast';
            return null;
        });
        const narrow = make2(2);
        const a = GeoNames.at(narrow, 15, 20).water, b = GeoNames.at(narrow, 70, 20).water;
        expect(a.kind).toBe('sea');
        expect(b.kind).toBe('sea');
        expect(a).not.toBe(b);
        expect(a.name).not.toBe(b.name);
        const wide = make2(16);
        expect(GeoNames.at(wide, 15, 20).water).toBe(GeoNames.at(wide, 70, 20).water);
        expect(GeoNames.at(wide, 15, 20).water.sub).toBe('ocean');
    });
});

describe('Geo names: the names', () => {
    it('gives every feature a name, unique in its world', () => {
        for (const w of worlds) {
            const names = GeoNames.features(w).features.map(f => f.name);
            expect(names.every(n => typeof n === 'string' && n.trim().length > 2)).toBe(true);
            expect(new Set(names.map(n => n.toLowerCase())).size).toBe(names.length);
        }
    });

    it('names a feature after the culture of the people round it, in their words or their tongue', () => {
        const C = DataLoader._gamedata.cultures;
        const G = GeoNames.data();
        for (const w of worlds) {
            const { features } = GeoNames.features(w);
            const cultures = new Set(features.map(f => f.culture));
            expect(cultures.size).toBeGreaterThan(2);
            let tongue = 0;
            for (const f of features) {
                expect(C.cultures[f.culture], f.culture).toBeTruthy();
                const syl = C.languages[C.cultures[f.culture].language].syllables;
                const roots = [...(G.cultures[f.culture].roots || []), ...(G.kinds[f.kind].roots || [])];
                const words = f.name.replace(/^the /, '').split(/\s+/);
                const fromRoot = roots.some(r => f.name.includes(r) || f.name.includes(r.replace(/'s$/, 's').replace(/[^A-Za-z]/g, '')));
                const fromTown = f.town && f.name.includes(f.town);
                const fromTongue = words.some(wd => /^[A-Z]/.test(wd) && syl.some(s => wd.toLowerCase().startsWith(s)));
                if (fromTongue && !fromRoot && !fromTown) tongue++;
                expect(fromRoot || fromTown || fromTongue, `${f.name} (${f.culture})`).toBe(true);
            }
            // (some names are in the land's own tongues)
            expect(tongue).toBeGreaterThan(3);
        }
    });

    it('is the same for the same seed, and different for another', () => {
        const again = make(4711);
        const a = GeoNames.features(worlds[0]).features.map(f => `${f.key}=${f.name}`);
        const b = GeoNames.features(again).features.map(f => `${f.key}=${f.name}`);
        expect(b).toEqual(a);
        const c = GeoNames.features(worlds[1]).features.map(f => f.name);
        expect(c.join('|')).not.toBe(a.map(x => x.split('=')[1]).join('|'));
    }, 60000);

    it('draws nothing from Utils\' RNG and changes no tile', () => {
        const w = worlds[1];
        const before = JSON.stringify(w.tiles[10].map(t => [t.terrain.id, t.elevation, t.hasRiver, t.settlement ? t.settlement.culture : null]));
        Utils.setSeed(777);
        GeoNames.invalidate(w);
        GeoNames.features(w);
        const x = Utils.random();
        Utils.setSeed(777);
        expect(Utils.random()).toBe(x);
        expect(JSON.stringify(w.tiles[10].map(t => [t.terrain.id, t.elevation, t.hasRiver, t.settlement ? t.settlement.culture : null]))).toBe(before);
    });

    it('keeps the names a save gave, even where the land would now name it otherwise', () => {
        const w = worlds[0];
        const saved = GeoNames.serialize(w);
        const f = GeoNames.features(w).features.find(x => x.kind === 'range');
        saved.names[f.key] = 'the Old Saved Teeth';
        GeoNames.restore(JSON.parse(JSON.stringify(saved)), w);
        const g = GeoNames.features(w).features.find(x => x.key === f.key);
        expect(g.name).toBe('the Old Saved Teeth');
        // an older save with none: the names are worked out afresh
        GeoNames.restore(null, w);
        expect(GeoNames.features(w).features.find(x => x.key === f.key).name).toBe(f.name);
    });

    it('names the geography of an older world too (it reads the tiles, never changes them)', () => {
        const old = make(321, 10, 80, 50);
        const k = kinds(old);
        expect(k.has('sea')).toBe(true);
        expect(GeoNames.features(old).features.length).toBeGreaterThan(5);
    }, 60000);

    it('gives the label a hex under its feature and a fade-in zoom by size', () => {
        const { features } = GeoNames.features(worlds[0]);
        for (const f of features) expect(f.tiles).toContain(f.anchor);
        const seas = features.filter(f => f.kind === 'sea');
        const lakes = features.filter(f => f.kind === 'lake');
        const Z = GeoNames.data().zoom;
        expect(Z.sea.big).toBeLessThan(Z.lake.small);
        expect(seas.length && lakes.length).toBeTruthy();
    });
});

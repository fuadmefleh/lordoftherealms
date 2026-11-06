// Fish under the water (ui/innerMapLayers/underwaterFish.js): the water about
// a diver holds fish of its own kind (sea fish at sea, freshwater ones in a
// lake), they keep to water they can swim in, and dart away from the diver.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { UnderwaterFish } from '../ui/innerMapLayers/underwaterFish.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const N = 40;
/** Deep water of `kind`, with a bank of sand down its left side (q < 6). */
function water(kind) {
    const tiles = [];
    for (let r = 0; r < N; r++) {
        tiles[r] = [];
        for (let q = 0; q < N; q++) {
            tiles[r][q] = q < 6
                ? { q, r, subTerrain: { id: 'sand', passable: true } }
                : { q, r, _wet: true, _deep: true, _waterKind: kind, _sea: kind === 'sea', subTerrain: { id: 'sea_water', passable: false } };
        }
    }
    InnerMap.tiles = tiles;
    InnerMap.width = InnerMap.height = N;
    InnerMap._insideBuilding = null;
    InnerMap.playerInnerQ = 20;
    InnerMap.playerInnerR = 20;
}

const species = () => DataLoader._gamedata.diving.fish.species;
const divable = (f) => InnerMap.isDivable(Math.floor(f.x), Math.floor(f.y));

beforeEach(() => { UnderwaterFish.fish = []; UnderwaterFish._dive = null; });

describe('fish under the water', () => {
    it('the sea about a diver holds sea fish, in the water, not right on top of them', () => {
        water('sea');
        UnderwaterFish.reset({}, 7);
        const fish = UnderwaterFish.fish;
        expect(fish.length).toBeGreaterThan(5);
        const sea = new Set(species().filter(s => s.waters.includes('sea')).map(s => s.id));
        expect(fish.every(f => sea.has(f.sp.id))).toBe(true);
        expect(fish.every(divable)).toBe(true);
        expect(fish.every(f => Math.hypot(f.x - 20.5, f.y - 20.5) > 2)).toBe(true);
    });

    it('a lake holds freshwater fish', () => {
        water('lake');
        UnderwaterFish.reset({}, 3);
        const lake = new Set(species().filter(s => s.waters.includes('lake')).map(s => s.id));
        expect(UnderwaterFish.fish.length).toBeGreaterThan(0);
        expect(UnderwaterFish.fish.every(f => lake.has(f.sp.id))).toBe(true);
    });

    it('they swim about, and never up onto the bank', () => {
        water('sea');
        UnderwaterFish.reset({}, 11);
        const start = UnderwaterFish.fish.map(f => [f.x, f.y]);
        for (let i = 0; i < 600; i++) UnderwaterFish.update(0.05);
        expect(UnderwaterFish.fish.length).toBeGreaterThan(0);
        expect(UnderwaterFish.fish.every(divable)).toBe(true);
        const moved = UnderwaterFish.fish.filter((f, i) => start[i] && Math.hypot(f.x - start[i][0], f.y - start[i][1]) > 0.5);
        expect(moved.length).toBeGreaterThan(0);
    });

    it('a fish beside the diver darts away', () => {
        water('sea');
        UnderwaterFish.reset({}, 5);
        const f = UnderwaterFish.fish[0];
        f.shoal = null;
        f.x = 21.3; f.y = 20.5; f.tx = 21.3; f.ty = 20.5; f.vx = 0; f.vy = 0;
        for (let i = 0; i < 10; i++) UnderwaterFish.update(0.05);
        expect(f.flee).toBe(true);
        expect(Math.hypot(f.x - 20.5, f.y - 20.5)).toBeGreaterThan(0.9);
    });
});

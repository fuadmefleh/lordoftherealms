// Out on the open road, folk talk of what's really there: the roadhouse and
// its keeper, whose land it is, where the road runs and how far, the season
// (systems/npcKnowledge.js aboutRoad / roadEnds / roadGreeting).
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { NpcKnowledge } from '../systems/npcKnowledge.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

/** A strip of road along row 5 from Ashford (q=2) to Kingsbridge (q=14), in Varn's land. */
function makeWorld() {
    const W = 20, H = 12;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        tiles[r] = [];
        for (let q = 0; q < W; q++) tiles[r][q] = { q, r, terrain: { id: 'forest', passable: true }, kingdom: 'k1', hasRoad: r === 5 && q > 2 && q < 14 };
    }
    tiles[5][2].settlement = { name: 'Ashford', type: 'town', q: 2, r: 5, kingdom: 'k1' };
    tiles[5][14].settlement = { name: 'Kingsbridge', type: 'city', q: 14, r: 5, kingdom: 'k1' };
    return {
        width: W, height: H, tiles, season: 'Winter', day: 40,
        kingdoms: [{ id: 'k1', name: 'Varn', ruler: 'King Aldous', isAlive: true }],
        getTile: (q, r) => (tiles[r] && tiles[r][q]) || null,
        getSettlementViews: () => [tiles[5][2].settlement, tiles[5][14].settlement],
    };
}
const house = { name: 'The Crooked Lantern', keeper: 'Maud Fletcher', rooms: 6, stars: 3.8 };

describe('Talk on the open road', () => {
    it('traces the road to the towns it really reaches, each way', () => {
        const ends = NpcKnowledge.roadEnds(makeWorld(), 6, 5);
        expect(ends.onRoad).toBe(true);
        expect(ends.ends.map(e => e.name).sort()).toEqual(['Ashford', 'Kingsbridge']);
        const ash = ends.ends.find(e => e.name === 'Ashford');
        expect(ash.dir).toBe('west');
        expect(ash.d).toBe(4);
    });

    it('the keeper speaks of their own house, the road both ways, the land and the season', () => {
        const world = makeWorld();
        const ans = NpcKnowledge.aboutRoad(world, {}, { id: 1, type: 'villager', name: 'Maud' }, { q: 6, r: 5, house, isKeeper: true, disposition: 70, seed: 'k' });
        expect(ans.text).toMatch(/Crooked Lantern/);
        expect(ans.text).toMatch(/Ashford/);
        expect(ans.text).toMatch(/Kingsbridge/);
        expect(ans.text).toMatch(/Varn/);
        // No town talk on the road
        expect(ans.text).not.toMatch(/marketplace|town hall|square|settlement/i);
    });

    it('a traveller says where they came from and where they are bound', () => {
        const ans = NpcKnowledge.aboutRoad(makeWorld(), {}, { id: 2, type: 'traveler', name: 'Ivo' }, { q: 6, r: 5, house, disposition: 60, seed: 't' });
        expect(ans.text).toMatch(/Ashford/);
        expect(ans.text).toMatch(/Kingsbridge/);
        expect(ans.text).toMatch(/Crooked Lantern/);
    });

    it('off the road, the nearest town as the crow flies; no crown, said so', () => {
        const world = makeWorld();
        world.tiles[9][7].kingdom = null;
        const ans = NpcKnowledge.aboutRoad(world, {}, { id: 3, type: 'villager' }, { q: 7, r: 9, disposition: 60, seed: 'o' });
        expect(ans.text).toMatch(/no proper road/i);
        expect(ans.text).toMatch(/No crown/);
    });

    it('greets you like a roadhouse keeper, not a town gate guard', () => {
        const line = NpcKnowledge.roadGreeting(makeWorld(), { id: 1, type: 'villager' }, { house, isKeeper: true, seed: 'g' });
        expect(line).toBeTruthy();
        expect(line).not.toMatch(/\{\w+\}/);
        expect(line).not.toMatch(/in town/i);
    });
});

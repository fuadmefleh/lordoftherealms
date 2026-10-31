import { describe, it, expect } from 'vitest';
import { Estates } from '../world/estates.js';
import { Hex } from '../core/hex.js';

// A small world: plains everywhere, a town at (5,5), a mountain, a ruin and a hinterland site near it.
function mockWorld() {
    const width = 12, height = 12;
    const tiles = [];
    for (let r = 0; r < height; r++) {
        tiles.push([]);
        for (let q = 0; q < width; q++) tiles[r].push({ q, r, terrain: { id: 'plains' } });
    }
    tiles[5][5].settlement = { name: 'Ashford', type: 'town' };
    tiles[5][6].terrain = { id: 'mountain' };
    tiles[4][5].improvement = { type: 'ruins', name: 'Old Keep' };
    return {
        width, height, tiles,
        generationParams: { seed: 'fields' },
        getTile: (q, r) => (tiles[r] && tiles[r][Hex.wrapQ(q, width)]) || null,
        hinterland: { sites: [{ q: 4, r: 5, kind: 'sheep_run' }] },
        estates: {
            v: 1, ver: 0, seq: 3, sales: [], history: [], holders: {},
            towns: { '5,5': { k: '5,5', q: 5, r: 5, name: 'Ashford', ests: ['E1', 'E2'] } },
            estates: { E1: { id: 'E1', town: '5,5', name: 'Hall', holder: 'player' }, E2: { id: 'E2', town: '5,5', name: 'Grange', holder: 'church' } },
        },
    };
}

describe('Estates.fieldHexes', () => {
    it('puts each estate on its own free farmland hex beside its town, the same every time', () => {
        const world = mockWorld();
        const fields = Estates.fieldHexes(world);
        expect(fields.map(f => f.id)).toEqual(['E1', 'E2']);
        const hexes = new Set(fields.map(f => `${f.q},${f.r}`));
        expect(hexes.size).toBe(2);
        for (const f of fields) {
            const t = world.getTile(f.q, f.r);
            expect(Hex.wrappingDistance(5, 5, f.q, f.r, world.width)).toBe(1);
            expect(t.settlement).toBeUndefined();
            expect(t.improvement).toBeUndefined();
            expect(t.terrain.id).toBe('plains');
            expect(`${f.q},${f.r}`).not.toBe('4,5');
        }
        expect(Estates.fieldHexes(mockWorld())).toEqual(fields);
        expect(Estates.fieldAt(world, fields[1].q, fields[1].r).name).toBe('Grange');
        expect(Estates.fieldAt(world, 5, 5)).toBeNull();
    });

    it('follows a new hinterland site off the hex it took', () => {
        const world = mockWorld();
        const first = Estates.fieldHexes(world)[0];
        world.hinterland.sites.push({ q: first.q, r: first.r, kind: 'quarry' });
        const after = Estates.fieldHexes(world);
        expect(after.some(f => f.q === first.q && f.r === first.r)).toBe(false);
    });
});

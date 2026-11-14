// Seeds from wild plants: a bush cut down on the map now and then gives its
// seed (player/gathering.js plantSeeds), and foraging turns up wild seed.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Gathering } from '../player/gathering.js';
import { Utils } from '../core/utils.js';

beforeAll(async () => { await loadData(); });

const count = (def, n = 400) => {
    Utils.setSeed(7);
    const got = {};
    for (let i = 0; i < n; i++) for (const g of Gathering.felled({ inventory: {} }, def, def.resource).gives) got[g.item] = (got[g.item] || 0) + 1;
    return got;
};

describe('seeds from wild plants', () => {
    it('berry bushes give strawberry runners, herbs and flowers give herb seed, now and then', () => {
        const berries = count({ name: 'Redberry Bush', objectType: 'plant', resource: { type: 'berries', amount: 4 } });
        expect(berries.strawberry_seed).toBeGreaterThan(80);
        expect(berries.strawberry_seed).toBeLessThan(220);
        const herbs = count({ name: 'Lavender', objectType: 'plant', resource: { type: 'herbs', amount: 2 } });
        expect(herbs.herb_seed).toBeGreaterThan(120);
        const grass = count({ name: 'Tall Grass', objectType: 'plant', resource: { type: 'firewood', amount: 2 } });
        expect(grass.wheat_seed).toBeGreaterThan(20);
    });

    it('a plain shrub or a tree gives no seed', () => {
        expect(count({ name: 'Shrub', objectType: 'plant', resource: { type: 'firewood', amount: 2 } })).toEqual({});
        expect(Object.keys(count({ name: 'Oak', objectType: 'tree', resource: { type: 'wood', amount: 40 } }, 50)).some(k => k.endsWith('_seed'))).toBe(false);
    });
});

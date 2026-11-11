// Buildings come with the age (world/innerMap/state.js settlementLayout, data/dawn.json
// eraBuildings) and dawn-born places keep camp while the world is in its dawn, even
// raised to towns (world/dawn.js syncCamps, world/innerMap/camp.js).

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData } from './playtest/harness.js';
import { InnerMap } from '../world/innerMap.js';
import { Dawn } from '../world/dawn.js';

beforeAll(async () => {
    await loadData();
});

const layoutAt = (year, s) => {
    const was = InnerMap._worldYear;
    InnerMap._worldYear = year;
    try { return InnerMap.settlementLayout(s); } finally { InnerMap._worldYear = was; }
};

describe('buildings by age', () => {
    const town = { type: 'town', name: 'Elderford' };

    it('a young town has no guildhall, post house, jail or mint: houses stand in their place', () => {
        const early = layoutAt(300, town);
        for (const b of ['guildhall', 'post_house', 'jail', 'mint', 'bank']) {
            expect(early.required).not.toContain(b);
            expect(early.optional || []).not.toContain(b);
        }
        const full = layoutAt(853, town);
        // (a gated building becomes a house; only late inns are dropped)
        expect(early.required.length).toBeLessThanOrEqual(full.required.length);
        expect(early.required.filter(b => b === 'house').length).toBeGreaterThan(0);
        expect(full.required).toContain('guildhall');
    });

    it('a full-grown world is laid out as it always was', () => {
        const plain = layoutAt(null, { type: 'capital', name: 'Kingsbridge' });
        const at853 = layoutAt(853, { type: 'capital', name: 'Kingsbridge' });
        expect(at853).toEqual(plain);
        expect(InnerMap.eraBuildingStamp(853)).toBe('');
        expect(InnerMap.eraBuildingStamp(300)).not.toBe('');
    });
});

describe('dawn camps', () => {
    it('a dawn-born place keeps camp in the dawn, even as a town; after it, streets', () => {
        const s = { type: 'town', name: 'Forgehollow', dawnBorn: true, campEra: true };
        expect(InnerMap._isDawnVillage(s)).toBe(true);
        s.campEra = false;
        expect(InnerMap._isDawnVillage(s)).toBe(false);
        // older saves (no flag): villages camp, towns don't
        expect(InnerMap._isDawnVillage({ type: 'village', dawnBorn: true })).toBe(true);
        expect(InnerMap._isDawnVillage({ type: 'town', dawnBorn: true })).toBe(false);
    });

    it('the new year refreshes the flag against the dawn year', () => {
        const grid = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, q) => ({ q, r, terrain: { passable: true }, settlement: null })));
        const s = grid[1][1].settlement = { type: 'town', name: 'A', dawnBorn: true, campEra: true };
        const world = { year: Dawn.dawnYear() + 1, width: 4, height: 4, tiles: grid, getTile: (q, r) => (grid[r] && grid[r][q]) || null, getSettlementViews: () => [{ q: 1, r: 1 }] };
        Dawn.syncCamps(world);
        expect(s.campEra).toBe(false);
        world.year = 5;
        Dawn.syncCamps(world);
        expect(s.campEra).toBe(true);
    });
});

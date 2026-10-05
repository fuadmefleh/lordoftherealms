// Foraging feeds the desperate: the quick forage roll lives in the player
// layer (seeded, capped by the pack) and wild foods count as rations.

import { describe, it, expect, beforeEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { Foraging } from '../player/foraging.js';
import { Player } from '../player/player.js';
import { MEAL_HUNGER } from '../player/core/needs.js';

const FORAGE = {
    terrain_mapping: { woodland: 'forest' },
    loot_table: { forest: [{ item: 'berries', name: 'Wild Berries', chance: 1 }] },
};

describe('Foraging', () => {
    beforeEach(() => Utils.setSeed(7));

    it('finds nothing where nothing grows', () => {
        const p = { inventory: {} };
        expect(Foraging.quickForage(p, { terrain: { id: 'ocean' } }, FORAGE).success).toBe(false);
    });

    it('adds what it finds to the pack', () => {
        const p = { inventory: {} };
        const res = Foraging.quickForage(p, { terrain: { id: 'woodland' } }, FORAGE);
        expect(res.success).toBe(true);
        expect(res.added).toBe(true);
        expect(p.inventory.berries).toBe(1);
    });

    it('is deterministic under a seed', () => {
        const table = { ...FORAGE, loot_table: { forest: [
            { item: 'berries', chance: 0.3 }, { item: 'mushrooms', chance: 0.3 }, { item: 'herbs', chance: 0.3 },
        ] } };
        const run = () => {
            Utils.setSeed(42);
            const p = { inventory: {} };
            for (let i = 0; i < 10; i++) Foraging.quickForage(p, { terrain: { id: 'woodland' } }, table);
            return p.inventory;
        };
        expect(run()).toEqual(run());
    });

    it('wild foods are rations, eaten only after proper food', () => {
        expect(Player.FOOD_TYPES).toContain('berries');
        expect(Player.FOOD_TYPES.indexOf('berries')).toBeGreaterThan(Player.FOOD_TYPES.indexOf('food'));
        for (const f of Player.FOOD_TYPES) expect(MEAL_HUNGER[f]).toBeGreaterThan(0);
    });

    it('a starving forager eats berries and stops starving', () => {
        const p = new Player();
        p.inventory = { berries: 1, bread: 1 };
        p.starvationDays = 2;
        expect(p.consumeFood()).toBe(true);
        expect(p.inventory.berries).toBe(1); // bread first
        expect(p.consumeFood()).toBe(true);
        expect(p.inventory.berries).toBeUndefined();
        expect(p.getFoodCount()).toBe(0);
    });
});

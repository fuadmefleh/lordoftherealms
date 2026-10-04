// Tax policy has consequences (happiness, growth, loyalty, revenue), the
// right officials can set it, and settlement population changes persist
// through the Peoples demographic drift.

import { describe, it, expect } from 'vitest';
import { Taxation } from '../systems/marketDynamics.js';
import { Peoples } from '../systems/peoples.js';

function makeWorld(settlement) {
    const tile = { q: 3, r: 3, settlement };
    return { day: 7, activeEvents: [], getTile: (q, r) => (q === 3 && r === 3 ? tile : null) };
}

const makePlayer = (over = {}) => ({ gold: 0, taxRate: 'moderate', settlements: [{ q: 3, r: 3 }], ...over });

describe('Taxation — consequences', () => {
    it('heavy taxes sour the mood, shrink the town and turn a conquered town against you', () => {
        const settlement = { name: 'Holt', population: 12000, colony: { loyalty: 50 } };
        const world = makeWorld(settlement);
        const player = makePlayer({ taxRate: 'very_high' });
        for (let i = 0; i < 8; i++) Taxation.collectTaxes(player, world);
        expect(settlement.happiness).toBeLessThan(30);
        expect(settlement.population).toBeLessThan(12000);
        expect(settlement.colony.loyalty).toBeLessThan(50);
    });

    it('light taxes cheer the town and help it grow', () => {
        const settlement = { name: 'Holt', population: 12000, colony: { loyalty: 50 } };
        const player = makePlayer({ taxRate: 'very_low' });
        Taxation.collectTaxes(player, makeWorld(settlement));
        expect(settlement.happiness).toBeGreaterThan(50);
        expect(settlement.population).toBeGreaterThan(12000);
        expect(settlement.colony.loyalty).toBeGreaterThan(50);
    });

    it('a happy town pays more than a miserable one at the same rate', () => {
        const happy = { name: 'A', population: 10000, happiness: 90 };
        const sad = { name: 'B', population: 10000, happiness: 10 };
        const a = Taxation.collectTaxes(makePlayer(), makeWorld(happy), { dryRun: true }).collected;
        const b = Taxation.collectTaxes(makePlayer(), makeWorld(sad), { dryRun: true }).collected;
        expect(a).toBeGreaterThan(b);
    });

    it('a dry run changes nothing', () => {
        const settlement = { name: 'Holt', population: 12000 };
        const player = makePlayer({ taxRate: 'very_high' });
        const res = Taxation.collectTaxes(player, makeWorld(settlement), { dryRun: true });
        expect(res.collected).toBeGreaterThan(0);
        expect(player.gold).toBe(0);
        expect(settlement.population).toBe(12000);
        expect(settlement.happiness).toBeUndefined();
    });
});

describe('Taxation — who may set the rate', () => {
    it('a lord of their own settlements may, without a kingdom or council', () => {
        const player = makePlayer({ allegiance: null });
        expect(Taxation.setTaxRate(player, 'high').success).toBe(true);
        expect(player.taxRate).toBe('high');
    });

    it('the Tax Collector and Chancellor may; a landless commoner may not', () => {
        const landless = { settlements: [], allegiance: 'k1', taxRate: 'moderate' };
        expect(Taxation.canSetTaxes({ ...landless, kingdomTitle: 'tax_collector' })).toBe(true);
        expect(Taxation.canSetTaxes({ ...landless, kingdomTitle: 'chancellor' })).toBe(true);
        expect(Taxation.canSetTaxes({ ...landless, kingdomTitle: 'jailer' })).toBe(false);
        expect(Taxation.setTaxRate({ ...landless, kingdomTitle: 'citizen' }, 'low').success).toBe(false);
    });
});

describe('Peoples — population changes persist', () => {
    const demographics = () => ([
        { tribe: { id: 'a' }, population: 600, share: 0.6, sentiment: 0 },
        { tribe: { id: 'b' }, population: 400, share: 0.4, sentiment: 0 },
    ]);

    it('rescales the demographic groups to the settlement population instead of overwriting it', () => {
        const settlement = { population: 1000, demographics: demographics() };
        settlement.population = 700; // a plague strikes
        Peoples.processPopulationDrift(settlement);
        expect(settlement.population).toBe(700);
        expect(settlement.demographics.reduce((a, d) => a + d.population, 0)).toBe(700);
        expect(settlement.demographics[0].share).toBeCloseTo(0.6, 2);
    });

    it('contented groups slowly gain share', () => {
        const settlement = { population: 1000, demographics: demographics() };
        settlement.demographics[0].sentiment = 100;
        settlement.demographics[1].sentiment = -100;
        for (let i = 0; i < 200; i++) Peoples.processPopulationDrift(settlement);
        expect(settlement.demographics[0].share).toBeGreaterThan(0.6);
        expect(settlement.population).toBe(1000);
    });
});

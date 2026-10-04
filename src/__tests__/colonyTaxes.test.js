// Taxes reach the settlements the player actually rules. player.settlements was
// never populated in play, so weekly collection, tax mood, the Tax Collector's
// bonus and the council's commons happiness all ran on an empty list. The
// player's founded and conquered colonies (player.colonies) now count.

import { describe, it, expect } from 'vitest';
import { Taxation } from '../systems/marketDynamics.js';
import { Councils } from '../systems/councils.js';

function makeWorld(map) {
    return { day: 7, activeEvents: [], getTile: (q, r) => map[`${q},${r}`] || null };
}

describe('player settlements for taxation', () => {
    it("a founded colony is taxed and feels the rate", () => {
        const settlement = { name: 'Newhope', population: 2000, kingdom: null, colony: { isPlayerColony: true, loyalty: 50 } };
        const world = makeWorld({ '1,1': { q: 1, r: 1, settlement } });
        const player = { gold: 0, taxRate: 'very_low', colonies: [{ q: 1, r: 1, name: 'Newhope' }] };
        const res = Taxation.collectTaxes(player, world);
        expect(res.settlements.map(s => s.name)).toEqual(['Newhope']);
        expect(res.collected).toBeGreaterThan(0);
        expect(player.gold).toBe(res.collected);
        expect(settlement.happiness).toBeGreaterThan(50);
    });

    it("a colony in the player's own realm still counts; one lost to another crown does not", () => {
        const ours = { name: 'Ours', population: 1000, kingdom: 'k1', colony: { loyalty: 60 } };
        const lost = { name: 'Lost', population: 1000, kingdom: 'k2' };
        const world = makeWorld({ '1,1': { settlement: ours }, '2,2': { settlement: lost } });
        const player = { allegiance: 'k1', colonies: [{ q: 1, r: 1 }, { q: 2, r: 2 }] };
        expect(Taxation.getPlayerSettlements(player, world).map(r => r.settlement.name)).toEqual(['Ours']);
    });

    it('a colony lord may set taxes', () => {
        expect(Taxation.canSetTaxes({ colonies: [{ q: 0, r: 0 }] })).toBe(true);
        expect(Taxation.canSetTaxes({ colonies: [] })).toBe(false);
    });

    it("the council's commons read the colonies' happiness", () => {
        const settlement = { name: 'Grim', population: 1000, kingdom: null, happiness: 10, colony: { isPlayerColony: true } };
        const world = makeWorld({ '1,1': { settlement } });
        const sad = Councils.factionTargets({ colonies: [{ q: 1, r: 1 }] }, world);
        settlement.happiness = 90;
        const glad = Councils.factionTargets({ colonies: [{ q: 1, r: 1 }] }, world);
        expect(JSON.stringify(sad)).not.toEqual(JSON.stringify(glad));
    });
});

// The royal kitchens (player/household.js Household.royalTable, read by
// player/core/lifecycle.js endDay): a reigning ruler at the palace the crown
// keeps, with empty packs and a bare larder, eats at the crown's table — a
// ration off the palace town's stalls, paid by the treasury into the town's
// purse. Away from the palace, or once the crown is lost, nobody feeds them.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Scenarios } from '../player/scenarios.js';
import { Throne } from '../systems/throne.js';
import { Household } from '../player/household.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Economy } from '../world/economy.js';

beforeAll(async () => {
    await loadData();
});

function monarch(seed = 31) {
    const g = newGame(seed);
    Scenarios.apply(g.player, g.world, { origin: 'monarch' });
    const k = Throne.ruledKingdom(g.player, g.world);
    const palace = (g.player.houses || []).find(h => h && String(h.keptBy) === String(k.id));
    return { g, k, palace };
}

/** Bread and grain on the palace town's stalls, so there is food to buy. */
function stockStalls(world, h) {
    const s = world.getTile(h.q, h.r).settlement;
    SettlementMarket.add(s, 'grain', 200);
    SettlementMarket.add(s, 'bread', 100);
    return s;
}

describe('the royal table', () => {
    it('feeds a ruler at the palace with empty packs, paid from the treasury into the town', () => {
        const { g, k, palace } = monarch();
        expect(k).toBeTruthy();
        expect(palace).toBeTruthy();
        const p = g.player;
        const s = stockStalls(g.world, palace);
        p.q = palace.q; p.r = palace.r;
        p.inventory = {};
        k.treasury = 5000;
        const t0 = k.treasury;
        if (!s.economy) Economy.initSettlement(s);
        const town0 = s.economy.gold;
        const court0 = CrownBooks.lines(k, 'day').court || 0;
        const fed = Household.royalTable(p, g.world);
        expect(fed).toBeTruthy();
        expect(fed.n).toBeGreaterThan(0);
        expect(fed.cost).toBeGreaterThan(0);
        expect(k.treasury).toBeCloseTo(t0 - fed.cost, 2);
        expect(s.economy.gold).toBeCloseTo(town0 + fed.cost, 2);
        expect((CrownBooks.lines(k, 'day').court || 0) - court0).toBeCloseTo(fed.cost, 2);
    });

    it('the day ends fed at the palace (no starvation), and starving away from it', () => {
        const { g, k, palace } = monarch();
        const p = g.player;
        stockStalls(g.world, palace);
        k.treasury = 5000;
        p.q = palace.q; p.r = palace.r;
        p.inventory = {};
        p.starvationDays = 0;
        p.endDay(g.world);
        expect(p.starvationDays).toBe(0);
        // Out on the road with nothing in the packs: no kitchens follow
        const away = g.world.getSettlementViews().find(v => v.q !== palace.q || v.r !== palace.r);
        p.q = away.q; p.r = away.r;
        p.inventory = {};
        p.endDay(g.world);
        expect(p.starvationDays).toBe(1);
    });

    it('not from an empty treasury, and not once the crown is gone', () => {
        const { g, k, palace } = monarch();
        const p = g.player;
        stockStalls(g.world, palace);
        p.q = palace.q; p.r = palace.r;
        p.inventory = {};
        k.treasury = 0;
        expect(Household.royalTable(p, g.world)).toBeNull();
        k.treasury = 5000;
        p.throne.ruling = null;
        expect(Household.royalTable(p, g.world)).toBeNull();
    });
});

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

    it('not from an empty treasury and an empty purse, and not once the crown is gone', () => {
        const { g, k, palace } = monarch();
        const p = g.player;
        stockStalls(g.world, palace);
        p.q = palace.q; p.r = palace.r;
        p.inventory = {};
        k.treasury = 0;
        p.gold = 0;
        expect(Household.royalTable(p, g.world)).toBeNull();
        k.treasury = 5000;
        p.throne.ruling = null;
        expect(Household.royalTable(p, g.world)).toBeNull();
    });

    it('with the chests empty, the ruler\'s own purse pays the table', () => {
        const { g, k, palace } = monarch();
        const p = g.player;
        stockStalls(g.world, palace);
        p.q = palace.q; p.r = palace.r;
        p.inventory = {};
        k.treasury = 0;
        p.gold = 500;
        const fed = Household.royalTable(p, g.world);
        expect(fed).toBeTruthy();
        expect(fed.paidBy).toBe('purse');
        expect(p.gold).toBeCloseTo(500 - fed.cost, 2);
        expect(k.treasury).toBe(0);
    });

    it('the palace town bare: the purveyors send to the nearest town with food to spare', () => {
        const { g, k, palace } = monarch();
        const p = g.player;
        const w = g.world;
        const s = w.getTile(palace.q, palace.r).settlement;
        // (a dearth at the palace: nothing edible on its stalls)
        SettlementMarket.ensure(s);
        for (const id of Object.keys(s.market.stock)) if (Household.isFood(id)) s.market.stock[id] = 0;
        expect(Household.marketFood(p, w, { q: palace.q, r: palace.r })).toEqual([]);
        // ...and a town of the realm nearby with grain in store
        const near = w.getSettlementViews().filter(v => (v.q !== palace.q || v.r !== palace.r))
            .sort((a, b) => Math.abs(a.q - palace.q) + Math.abs(a.r - palace.r) - Math.abs(b.q - palace.q) - Math.abs(b.r - palace.r))[0];
        const src = w.getTile(near.q, near.r).settlement;
        SettlementMarket.add(src, 'grain', 500);
        const grain0 = SettlementMarket.stock(src, 'grain');
        p.q = palace.q; p.r = palace.r;
        p.inventory = {};
        k.treasury = 5000;
        const key = Household.houseKey(palace);
        const home = Household.home(p, key, true, { q: palace.q, r: palace.r });
        home.larder = {};
        const fed = Household.royalTable(p, w);
        expect(fed).toBeTruthy();
        expect(fed.purveyed).toBeTruthy();
        expect(fed.cost).toBeGreaterThan(0);
        expect(k.treasury).toBeCloseTo(5000 - fed.cost, 2);
        // (the goods came off some town's stalls; the week's rations beyond tonight wait in the larder)
        if (fed.purveyed.from === src.name) expect(SettlementMarket.stock(src, fed.food)).toBeLessThan(fed.food === 'grain' ? grain0 : Infinity);
        expect(Household.rations(home)).toBeGreaterThan(0);
        // ...so tomorrow's supper is from the larder
        p.starvationDays = 0;
        p.endDay(w);
        expect(p.starvationDays).toBe(0);
    });
});

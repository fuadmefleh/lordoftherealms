/**
 * Leather and wool keep up with a town's trades (data/markets.json, 2026-11:
 * _supplyLeatherWool2026_11). A town's tanners make enough leather from its
 * hides for its people and its cobblers, legharness makers and glovers; its
 * sheep bring in enough wool for its people, weavers and quilters; and its
 * cobblers make the boots it wears — so the towns hold leather, wool and boots
 * near their targets rather than at the scarcity cap.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SettlementMarket } from '../world/settlementMarket.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

describe('leather and wool', () => {
    it('the tannery\'s capacity covers the town\'s own leather use and its leather trades', () => {
        const s = { name: 'Ashford', type: 'town', population: 2000 };
        SettlementMarket.ensure(s);
        const tan = SettlementMarket.tradeCapacity(s, 'tannery');
        const draws = ['cobbler', 'legharness_maker', 'glover']
            .reduce((a, id) => a + SettlementMarket.tradeCapacity(s, id) * SettlementMarket.recipeGoods(id, 'in').leather, 0);
        expect(tan).toBeGreaterThan(SettlementMarket.need(s, 'leather'));
        expect(tan).toBeGreaterThan(SettlementMarket.need(s, 'leather') + draws * 0.5);
    });

    it('a played world keeps its towns\' leather, wool and boots off the scarcity cap', () => {
        // (seed 101, 150 days, the player kept fed and idle — before 2026-11 every town's
        // leather and wool sat at the cap, 2.2x, and the towns' boots with them)
        const game = newGame(101);
        for (let d = 0; d < 150; d++) {
            game.player.health = 100; game.player.inventory.bread = 40; game.player.starvationDays = 0;
            endDay(game);
        }
        const sc = {};
        for (const v of game.world.getSettlementViews()) {
            const t = game.world.getTile(v.q, v.r);
            const s = t && t.settlement;
            if (!s || !s.market || s.type === 'village') continue;
            for (const g of ['leather', 'hide', 'wool', 'boots', 'textiles', 'clothes']) (sc[g] || (sc[g] = [])).push(SettlementMarket.scarcity(s, g));
        }
        for (const g of ['leather', 'wool', 'boots']) expect(med(sc[g]), g).toBeLessThan(1.4);
        for (const g of ['hide', 'textiles', 'clothes']) expect(med(sc[g]), g).toBeLessThan(1.6);
        // ...nor glutted
        for (const g of ['leather', 'hide', 'wool']) expect(med(sc[g]), g).toBeGreaterThan(0.6);
    }, 300000);
});

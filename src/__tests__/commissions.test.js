// Hired work (systems/commissions.js): a town's mill, baker, smithy… work the
// player's goods for a fee or a cut of the product; jobs take days, are
// collected at the same town, and the cut goes to the town's market.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Commissions } from '../systems/commissions.js';
import { SettlementMarket } from '../world/settlementMarket.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function atTown(type = 'town') {
    const game = newGame(4242, { terrainGen: 3 });
    const { world, player } = game;
    const s = world.getSettlementViews().find(x => x.type === type) || world.getSettlementViews()[0];
    player.q = s.q; player.r = s.r;
    const live = world.getTile(s.q, s.r).settlement;
    SettlementMarket.ensure(live);
    // speak the town's tongue: these tests are about the work, not the haggling
    if (player.languages) for (const k of Object.keys(require('../../data/cultures.json').languages)) player.languages[k] = 100;
    return { ...game, s: live };
}

describe('hiring the tradesmen', () => {
    it('every town trade and the craftsmen\'s work are for hire — the mill and the baker everywhere, the jeweller only in a city', () => {
        const { world, s } = atTown('village');
        const ids = Commissions.offers(world, s).map(o => o.id);
        expect(ids).toContain('trade:mill');
        expect(ids).toContain('trade:bakery');
        expect(ids).not.toContain('trade:jeweller');
        expect(ids).not.toContain('trade:distillery');
        expect(ids.some(i => i.startsWith('craft:'))).toBe(true);
        const t = atTown('town');
        expect(Commissions.offers(t.world, t.s).map(o => o.id)).toContain('trade:smithy');
    });

    it('the mill grinds your grain for a fee: the gold goes to the town, the flour to you when collected', () => {
        const { world, player, s } = atTown('town');
        player.inventory.grain = 10;
        player.gold = 500;
        const gold0 = player.gold, town0 = s.economy ? s.economy.gold || 0 : 0;
        const res = Commissions.commission(player, world, 'trade:mill', 10, 'fee');
        expect(res.success).toBe(true);
        expect(player.inventory.grain || 0).toBe(0);
        const fee = gold0 - player.gold;
        expect(fee).toBeGreaterThan(0);
        if (s.economy) expect(s.economy.gold).toBe(town0 + fee);
        // ready by the end of the day: collected here
        const got = Commissions.collect(player, world);
        expect(got.success).toBe(true);
        expect(player.inventory.flour).toBe(10);
        expect(Commissions.pending(player).length).toBe(0);
    });

    it('or for a cut: no gold, the miller keeps a share (into the town market)', () => {
        const { world, player, s } = atTown('town');
        player.inventory.grain = 20;
        const gold0 = player.gold;
        const stock0 = SettlementMarket.stock(s, 'flour');
        const res = Commissions.commission(player, world, 'trade:mill', 20, 'cut');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold0);
        expect(res.job.kept.flour).toBe(5);
        expect(SettlementMarket.stock(s, 'flour')).toBeCloseTo(stock0 + 5, 5);
        Commissions.collect(player, world);
        expect(player.inventory.flour).toBe(15);
    });

    it('a big job takes days, is announced when done, and is collected only in that town', () => {
        const { world, player, s } = atTown('town');
        const offer = Commissions.offer(world, s, 'trade:bakery');
        const runs = offer.perDay * 3;
        player.inventory.grain = runs;
        player.gold = 10000;
        const res = Commissions.commission(player, world, 'trade:bakery', runs, 'fee');
        expect(res.success).toBe(true);
        expect(res.job.readyDay).toBe(world.day + 2);
        expect(Commissions.collect(player, world).success).toBe(false);
        // away from town: not here
        const q0 = player.q;
        player.q = (player.q + 3) % world.width;
        world.day += 2;
        const n = Commissions.processDay(player, world).notices;
        expect(n.length).toBe(1);
        expect(Commissions.processDay(player, world).notices.length).toBe(0);
        if (!world.getTile(player.q, player.r).settlement) expect(Commissions.collect(player, world).success).toBe(false);
        player.q = q0;
        const got = Commissions.collect(player, world);
        expect(got.success).toBe(true);
        expect(player.inventory.bread).toBeGreaterThanOrEqual(Math.floor(runs * 1.25));
    });

    it('craftsmen take recipes too (the cook bakes bread from grain), and nothing without the goods or the gold', () => {
        const { world, player } = atTown('town');
        player.inventory = {};
        player.gold = 0;
        expect(Commissions.commission(player, world, 'craft:bread_bake', 1, 'fee').success).toBe(false);
        player.inventory.grain = 4;
        expect(Commissions.commission(player, world, 'craft:bread_bake', 2, 'fee').success).toBe(false);
        expect(Commissions.commission(player, world, 'craft:bread_bake', 2, 'cut').success).toBe(true);
        Commissions.collect(player, world);
        expect(player.inventory.bread).toBeGreaterThan(0);
    });
});

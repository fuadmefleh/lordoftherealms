// Every coin comes from somewhere and goes somewhere (2026-11): the player's
// actions and the institutions in src/world (and systems m–z: see
// coinSystems.mzA–D.test.js) move coin purse to purse, or book what is truly
// lost or found with MoneySupply.leak — so the world's coin census closes
// around each one. Before: coin buried in a hole simply left the world (and
// came back from nowhere when dug up); a tribe's trade paid its profit out of
// nothing and took the price into nothing; hired colonists, colony incentives
// and signboards were paid to nobody; an ally's good fortune minted the
// player 50 gold; a founding party's purse rode off the books while it
// walked; a robbed caravan's purse vanished unless its inventory mirrored it.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { Burials } from '../world/burials.js';
import { Colonization } from '../world/colonization.js';
import { WorldEvents } from '../world/worldEvents.js';
import { VillageFounding } from '../world/villageFounding.js';
import { WorldUnit } from '../world/units.js';
import { MoneySupply } from '../world/moneySupply.js';

let logSpy, warnSpy, g;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    g = coinGame(101);
}, 120000);
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

const closes = (m) => expect(Math.abs(m.unbooked)).toBeLessThan(0.05);

describe('coin in the ground (world/burials.js)', () => {
    it('buried coin is booked lost, and found again when it is dug up', () => {
        const { world, player } = g;
        player.gold = 500;
        const c = { kind: 'cache', items: {}, gold: 0 };
        const put = measure(world, player, () => Burials.putIn(c, player, 'gold', 120, world));
        expect(put.result).toBe(120);
        expect(put.delta).toBe(-120);
        closes(put);
        const take = measure(world, player, () => Burials.takeAll(c, player, world));
        expect(take.result.taken.gold).toBe(120);
        expect(player.gold).toBe(500);
        closes(take);
        expect(MoneySupply.state(world).leaks.buried).toBe(0);
    });
});

describe('the colonies (world/colonization.js)', () => {
    it("a tribe's trade: the price spent on at the nearest town, the resale paid by one", () => {
        const { world, player } = g;
        const town = coinTowns(world)[0];
        standIn(player, town);
        player.gold = 500;
        const ind = { name: 'Forest Folk', tradeability: 0.6, relation: 0, hostility: 0.3 };
        const m = measure(world, player, () => Colonization.tradeWithTribe(player, ind, world, town));
        expect(m.result.success).toBe(true);
        closes(m);
        const t = measure(world, player, () => Colonization.tributeToTribe(player, ind, world, town));
        expect(t.result.success).toBe(true);
        expect(t.delta).toBe(0); // (the player's 100 is in the town's purse)
        closes(t);
    });

    it('a colony\'s signboard and incentive are paid into its purse; its incentive spending into the next town', () => {
        const { world, player } = g;
        const town = coinTowns(world)[1];
        const s = town.settlement;
        const tile = world.getTile(town.q, town.r);
        const hadColony = s.colony;
        s.colony = { recruitment: { recruited: 0, enRoute: 0, incentive: 'none', incentiveCost: 0, signboard: false, reputation: 0, lastRecruitDay: 0 } };
        try {
            player.gold = 500;
            const g0 = s.economy.gold;
            const sign = measure(world, player, () => Colonization.postSignboard(player, tile));
            expect(sign.result.success).toBe(true);
            expect(s.economy.gold).toBeCloseTo(g0 + 20, 2);
            closes(sign);
            const inc = measure(world, player, () => Colonization.setColonyIncentive(player, tile, 'free_housing'));
            expect(inc.result.success).toBe(true);
            closes(inc);
            const spend = measure(world, player, () => Colonization._colonySpends(world, tile, 8));
            expect(spend.result).toBe(8);
            closes(spend);
        } finally {
            s.colony = hadColony;
        }
    });
});

describe("an ally's good fortune (world/worldEvents.js)", () => {
    it('the gift comes out of the allied crown, not from nothing', () => {
        const { world, player } = g;
        const k = world.kingdoms.find(x => x.isAlive && (x.treasury || 0) > 100);
        player.reputation = { ...(player.reputation || {}), [k.id]: 80 };
        player.gold = 100;
        const t0 = k.treasury;
        const m = measure(world, player, () => WorldEvents.applyPlayerEffects({ kingdom: k.id, impact: 'positive' }, player, world));
        expect(player.gold).toBe(150);
        expect(k.treasury).toBeCloseTo(t0 - 50, 2);
        closes(m);
    });
});

describe('parties on the road (world/villageFounding.js, world/units.js)', () => {
    it("a founding party's coin rides as its purse — counted — and goes home with it", () => {
        const { world, player } = g;
        const town = coinTowns(world)[0];
        player.gold = 300;
        let unit;
        // (the player pays the purses: out of the player's coin, onto the party)
        const go = measure(world, player, () => {
            player.gold -= 96;
            unit = VillageFounding.spawnParty(world, { from: town, site: { q: town.q + 3, r: town.r }, people: 12, coin: 96, sourceName: town.settlement.name });
        });
        expect(unit.purse).toBe(96);
        closes(go);
        const back = measure(world, player, () => { VillageFounding._goHome(unit, world, player, 'test'); unit.destroyed = true; world.settleUnitCoin(unit); });
        expect(player.gold).toBe(300);
        closes(back);
        world.units = world.units.filter(u => u !== unit);
    });

    it("a robbed caravan's purse goes to the robbers, mirrored or not", () => {
        const { world, player } = g;
        const town = coinTowns(world)[0];
        const cart = new WorldUnit('caravan', town.q, town.r, town.q + 4, town.r);
        cart.stepsToday = () => 0; // (held on the robbers' hex)
        cart.inventory = { cloth: 3 };
        cart.purse = 140; // (not mirrored on inventory.gold)
        const raider = new WorldUnit('raider', town.q, town.r);
        raider.inventory = {};
        delete raider._rolledGold;
        world.units.push(cart, raider);
        try {
            const m = measure(world, player, () => cart.updateCaravan(world));
            expect(cart.purse).toBe(0);
            expect(raider.inventory.gold).toBe(140);
            expect(raider.inventory.cloth).toBe(3);
            closes(m);
        } finally {
            world.units = world.units.filter(u => u !== cart && u !== raider);
        }
    });
});

describe("a delve partner's cut (systems/delves.js → rivals.js)", () => {
    it('held for the partner, counted, then paid into their purse', async () => {
        const { Rivals } = await import('../systems/rivals.js');
        const { world, player } = g;
        standIn(player, coinTowns(world)[0]);
        const st = Rivals.state(player);
        const rival = (st.list || [])[0] || (st.list.push({ id: 'r_test', name: 'Test Rival', gold: 0, renown: 0, deeds: { delves: 0 }, q: player.q, r: player.r, memory: [] }), st.list[0]);
        const keep = st.partner;
        st.partner = { id: rival.id, name: rival.name, until: (world.day || 0) + 5, share: 0.25, bonus: 0, earned: 0, credited: 0, delves: 0 };
        player.gold = 400;
        const g0 = rival.gold;
        // (as Delves._finish takes the cut)
        const take = measure(world, player, () => { player.gold -= 60; st.partner.earned += 60; st.partner.owed = 60; });
        closes(take);
        const pay = measure(world, player, () => Rivals._tickPartner(player, world, () => {}));
        expect(rival.gold).toBe(g0 + 60);
        expect(st.partner.owed).toBe(0);
        closes(pay);
        st.partner = keep;
    });
});

// Every coin comes from somewhere and goes somewhere (2026-11): the player-side
// coin of systems d–f. Each action below used to make or lose coin out of no
// purse — alms and temple gifts paid to no one, a feast's or a joiner's bill
// spent into nothing, a delve's finds and an outlaw's take unbooked, a
// tournament purse struck from nothing, the player's own banking house drawing
// deposits and interest from no town and paying its clerks into the void, a
// failed house refunding depositors past an empty vault. Now each moves coin
// purse to purse, or books it with MoneySupply.leak, and the world's coin
// census closes around it (coinCheck.measure: unbooked ≈ 0).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Devotion } from '../systems/devotion.js';
import { Furnishing } from '../systems/furnishing.js';
import { Delves } from '../systems/delves.js';
import { Duels } from '../systems/duels.js';
import { Finance } from '../systems/finance.js';
import { Economy } from '../world/economy.js';
import { loadData, newGame } from './playtest/harness.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';

let logSpy, warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

/** A live game, the player in its richest town with coin to spend. */
function inTown(seed = 101) {
    const g = coinGame(seed);
    const town = coinTowns(g.world)[0];
    const s = standIn(g.player, town);
    g.player.gold = 5000;
    return { g, world: g.world, player: g.player, town, s, tile: g.world.getTile(town.q, town.r) };
}

describe('systems d–f: the player\'s coin has a counterparty', () => {
    it('alms to the poor and a gift to the temple land in the town\'s purse', () => {
        const { world, player, tile, s } = inTown();
        const before = s.economy.gold;
        for (const who of ['poor', 'temple']) {
            const m = measure(world, player, () => Devotion.donate(player, world, tile, who, 40));
            expect(m.result.success).toBe(true);
            expect(Math.abs(m.unbooked)).toBeLessThan(0.05);
        }
        expect(s.economy.gold).toBeCloseTo(before + 80, 2);
    });

    it('a piece of furniture bought pays the joiner\'s town; sold back, the town pays what it can', () => {
        const { world, player } = inTown();
        const buy = measure(world, player, () => Furnishing.buy(player, world, 'storage_chest', 'city'));
        expect(buy.result.success).toBe(true);
        expect(Math.abs(buy.unbooked)).toBeLessThan(0.05);
        const sell = measure(world, player, () => Furnishing.sell(player, buy.result.piece.uid, world));
        expect(sell.result.success).toBe(true);
        expect(Math.abs(sell.unbooked)).toBeLessThan(0.05);
    });

    it('a delve\'s finds are booked found; an outlaw\'s take goes to the nearest town', () => {
        const { world, player } = inTown();
        Delves.getState(player).active = { haul: { gold: 0, items: {}, lore: [] }, lootFactor: 1 };
        const found = measure(world, player, () => Delves._applyOutcome(player, world, { gold: [50, 50] }, 0));
        expect(found.delta).toBeGreaterThan(0);
        expect(found.booked).toBeCloseTo(found.delta, 2);
        const robbed = measure(world, player, () => Delves._applyOutcome(player, world, { gold: [-40, -40] }, 0));
        expect(Math.abs(robbed.delta)).toBeLessThan(0.05);
        expect(Math.abs(robbed.unbooked)).toBeLessThan(0.05);
    });

    it('a tournament purse is paid by the town of the lists (a broke town pays what it has)', () => {
        const { world, player, s } = inTown();
        const won = { playerWon: true, aLost: 0.1 };
        const bouts = [{ result: won }, { result: won }, { result: won }];
        const m = measure(world, player, () => Duels.settleTournament(player, { prizePool: 300, bouts, armour: 0, world }));
        expect(m.result.gold).toBe(300);
        expect(Math.abs(m.unbooked)).toBeLessThan(0.05);
        s.economy.gold = 120;
        const poor = measure(world, player, () => Duels.settleTournament(player, { prizePool: 300, bouts, armour: 0, world, payer: s }));
        expect(poor.result.gold).toBe(120);
        expect(Math.abs(poor.unbooked)).toBeLessThan(0.05);
    });

    it('the player\'s own banking house: a month of deposits, loans, interest and wages, then a wind-up, all closed', () => {
        // (the default ten realms on day 1, as playerBank.test.js: a city no house seats yet)
        const g = newGame(777);
        const { world, player } = g;
        world.day = 1;
        Finance.loadState(player, world);
        const seats = new Set(Finance.openBanks(player).map(b => `${b.q},${b.r}`));
        for (const v of world.getSettlementViews()) {
            const t = world.getTile(v.q, v.r);
            if (t && t.settlement && !t.settlement.economy) Economy.initSettlement(t.settlement);
        }
        const city = coinTowns(world).find(t => (t.settlement.type === 'city' || t.settlement.type === 'capital') && !seats.has(`${t.q},${t.r}`));
        expect(city).toBeTruthy();
        player.gold = 60000;
        player.reputation = player.reputation || {};
        standIn(player, city);
        player.reputation[city.settlement.kingdom] = 40;
        const founded = measure(world, player, () => Finance.foundBank(player, world, 10000));
        expect(founded.result.success).toBe(true);
        expect(Math.abs(founded.unbooked)).toBeLessThan(0.05);
        const month = measure(world, player, () => { for (let i = 0; i < 30; i++) { world.day++; Finance.processDay(world, player); } });
        expect(Math.abs(month.unbooked)).toBeLessThan(0.5);
        const bank = Finance.ownBank(player);
        expect(bank.publicDeposits).toBeGreaterThan(0);
        const wind = measure(world, player, () => Finance.windUpBank(player, world));
        expect(wind.result.success).toBe(true);
        expect(Math.abs(wind.unbooked)).toBeLessThan(0.05);
    });
});

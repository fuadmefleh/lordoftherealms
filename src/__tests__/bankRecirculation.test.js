// The banking houses' coin goes somewhere (systems/finance.js): a failed
// house's receivers pay what it had left to its seat town, a run's
// withdrawals and a lost venture's coin land there too, and a refounded
// house's capital is put up by its realm's merchants — never struck from
// nothing (a century soak watched the vaults climb from 0.77M to 1.8M as
// every failure was refounded with a full house's capital out of nowhere).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { Finance } from '../systems/finance.js';
import { loadData, newGame } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => logSpy && logSpy.mockRestore());

function fresh(seed = 777) {
    const game = newGame(seed);
    game.world.day = 1;
    Finance.loadState(game.player, game.world);
    // (every town keeps its purse, as after the first day's economy)
    for (const row of game.world.tiles) for (const t of row) if (t.settlement && !t.settlement.economy) Economy.initSettlement(t.settlement);
    return game;
}

const seatTown = (world, bank) => world.getTile(bank.q, bank.r).settlement;
/** Every town purse, every open vault and every living crown's chests: the coin the banks touch. */
function coin(game) {
    const { world, player } = game;
    let sum = 0;
    for (const row of world.tiles) for (const t of row) if (t.settlement && t.settlement.economy && Number.isFinite(t.settlement.economy.gold)) sum += t.settlement.economy.gold;
    for (const k of world.kingdoms) if (k && k.isAlive !== false) sum += Number(k.treasury) || 0;
    for (const b of Finance.state(player).banks) if (b.status === 'open') sum += Number(b.capital) || 0;
    return sum + (Number(player.gold) || 0);
}

describe("a banking house's coin always lands somewhere", () => {
    it("a failed house's receivers pay what it had left into its seat town", () => {
        const game = fresh();
        const bank = Finance.openBanks(game.player)[0];
        const town = seatTown(game.world, bank);
        bank.capital = 12000;
        const purse0 = town.economy.gold;
        const before = coin(game);
        Finance._fail(game.world, game.player, Finance.state(game.player), bank, { notices: [] });
        expect(bank.status).toBe('failed');
        expect(bank.capital).toBe(0);
        expect(town.economy.gold).toBeCloseTo(purse0 + 12000, 2);
        expect(coin(game)).toBeCloseTo(before, 2);
    });

    it("the player's deposit is paid out of what the failed house had, not on top of it", () => {
        const game = fresh();
        const p = game.player;
        const bank = Finance.openBanks(p)[0];
        p.q = bank.q; p.r = bank.r;
        p.gold = 5000;
        Finance.deposit(p, game.world, bank.id, 4000);
        const before = coin(game);
        Finance._fail(game.world, p, Finance.state(p), bank, { notices: [] });
        expect(coin(game)).toBeCloseTo(before, 2);
    });

    it("a run's withdrawals go home with the depositors when the house stands", () => {
        const game = fresh();
        const bank = Finance.openBanks(game.player)[0];
        const town = seatTown(game.world, bank);
        bank.capital = bank.baseCapital; // (well reserved: it survives the run)
        bank.panic = { since: 0, until: 0, cause: null, paid: 0, paidDay: null };
        const before = coin(game);
        const purse0 = town.economy.gold;
        // (the failure roll comes up high: the house survives)
        const spy = vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        try {
            Finance._endPanic(game.world, game.player, Finance.state(game.player), bank, { notices: [] });
        } finally { spy.mockRestore(); }
        expect(bank.status).toBe('open');
        expect(town.economy.gold).toBeGreaterThan(purse0);
        expect(coin(game)).toBeCloseTo(before, 2);
    });

    it("a failed house's seat is refounded with capital its realm's merchants put up, never from nothing", () => {
        const game = fresh();
        const { world, player } = game;
        const st = Finance.state(player);
        const bank = Finance.openBanks(player)[0];
        const k = world.kingdoms.find(x => x.id === bank.kingdomId);
        Finance._fail(world, player, st, bank, { notices: [] });
        // (give the realm's towns coin to put up)
        for (const t of Economy.realmTowns(k, world)) if (t.settlement.economy) t.settlement.economy.gold += 20000;
        const treasury0 = k.treasury;
        const before = coin(game);
        world.day = bank.failedDay + 91;
        Finance._refoundDay(world, player, st, world.day);
        const nb = Finance.openBanks(player).find(b => b.q === bank.q && b.r === bank.r && b.id !== bank.id);
        expect(nb).toBeTruthy();
        expect(nb.capital).toBe(nb.baseCapital);
        expect(nb.capital).toBeGreaterThanOrEqual(Finance.cfg('banks').minCrownHouse);
        // The crown puts nothing in; the towns' coin became the vault's
        expect(k.treasury).toBe(treasury0);
        expect(coin(game)).toBeCloseTo(before, 1);
    });

    it('a realm with too little coin waits for its house, and keeps its coin', () => {
        const game = fresh();
        const { world, player } = game;
        const st = Finance.state(player);
        const bank = Finance.openBanks(player)[0];
        const k = world.kingdoms.find(x => x.id === bank.kingdomId);
        Finance._fail(world, player, st, bank, { notices: [] });
        for (const t of Economy.realmTowns(k, world)) if (t.settlement.economy) t.settlement.economy.gold = 10;
        const before = coin(game);
        const open0 = Finance.openBanks(player).length;
        world.day = bank.failedDay + 91;
        Finance._refoundDay(world, player, st, world.day);
        expect(Finance.openBanks(player).length).toBe(open0);
        expect(coin(game)).toBeCloseTo(before, 2);
    });

    it("a house below its founding capital rebuilds from its merchants' interest, out of its realm's purses", () => {
        const game = fresh();
        const { world, player } = game;
        const st = Finance.state(player);
        const bank = Finance.openBanks(player)[0];
        bank.capital = Math.round(bank.baseCapital * 0.5);
        const cap0 = bank.capital;
        const before = coin(game);
        for (let d = 0; d < 30; d++) { world.day++; Finance._banksDay(world, player, st, { notices: [] }); }
        expect(bank.capital).toBeGreaterThan(cap0);
        // (the yield is moved, never made: the towns paid every coin of it)
        expect(coin(game)).toBeCloseTo(before, 1);
    });

    it('a house past its founding capital pays the surplus out to its city: its vault levels off', () => {
        const game = fresh();
        const { world, player } = game;
        const st = Finance.state(player);
        const bank = Finance.openBanks(player)[0];
        bank.capital = bank.baseCapital * 3;
        const before = coin(game);
        for (let d = 0; d < 240; d++) { world.day++; Finance._banksDay(world, player, st, { notices: [] }); }
        expect(bank.capital).toBeLessThan(bank.baseCapital * 1.05);
        expect(coin(game)).toBeCloseTo(before, 1);
    });

    it("a house lends what it holds past its keep into its realm's towns, and is repaid as its vault falls", () => {
        // (2026-11: the vaults held more than all the towns together, idle — Finance._merchantBookDay)
        const game = fresh();
        const { world, player } = game;
        const st = Finance.state(player);
        const B = Finance.cfg('banks');
        expect(B.merchantLend).toBeGreaterThan(0);
        const bank = Finance.openBanks(player)[0];
        bank.capital = bank.baseCapital;
        bank.merchantBook = 0;
        const towns0 = Economy.realmTowns(world.getKingdom(bank.kingdomId), world).reduce((a, t) => a + (t.settlement.economy ? t.settlement.economy.gold : 0), 0);
        const before = coin(game);
        for (let d = 0; d < 120; d++) { world.day++; Finance._banksDay(world, player, st, { notices: [] }); }
        const target = B.merchantLend * bank.baseCapital * (1 - B.merchantKeep);
        expect(bank.merchantBook).toBeGreaterThan(target * 0.6);
        expect(bank.capital).toBeGreaterThanOrEqual(bank.baseCapital * B.merchantKeep);
        // (the loans are coin in the towns' purses: none made, none lost)
        const towns1 = Economy.realmTowns(world.getKingdom(bank.kingdomId), world).reduce((a, t) => a + (t.settlement.economy ? t.settlement.economy.gold : 0), 0);
        expect(towns1).toBeGreaterThan(towns0 + target * 0.4);
        expect(coin(game)).toBeCloseTo(before, 1);
        // A crown borrows most of the vault: the merchants repay, out of their towns' purses
        bank.capital = Math.round(bank.baseCapital * B.merchantKeep * 0.9);
        const book0 = bank.merchantBook;
        const before2 = coin(game);
        for (let d = 0; d < 60; d++) { world.day++; Finance._banksDay(world, player, st, { notices: [] }); }
        expect(bank.merchantBook).toBeLessThan(book0 * 0.8);
        expect(coin(game)).toBeCloseTo(before2, 1);
    });
});

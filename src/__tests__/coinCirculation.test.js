// The coin in circulation holds (2026-11). A live small-map game (4 realms, an
// idle player) saw each realm's circulating coin — towns + folk + other purses,
// world/moneySupply.js — fall week after week: 25k → 9k in 79 days. Where it
// went: the crowns' chests (taxes per head outran the wages, and an NPC crown
// felt "full" only at 160 days of spending — more than its realm's whole coin),
// and the free towns (a village under no crown sells to the realms but pays no
// taxes and has no price level, so coin piled up there for good). Now:
//   • Fiscal.reserveStand reckons the chests against the realm's coin too
//     (npc.coinLow / coinHigh / coinFlush), and the largesse spends what passes
//     npc.largesseCoin of it back into the towns, daily;
//   • a crown whose chests hold deficitCoinShare of its realm's coin borrows
//     nothing (the largesse was being paid for with the banks' vaults);
//   • a free town past freeTowns.above × the realms' coin per head spends the
//     excess into the realms' towns (MoneySupply._freeTowns).
// Every coin moves purse to purse; none is made.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Fiscal } from '../systems/fiscal.js';
import { MoneySupply } from '../world/moneySupply.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Economy } from '../world/economy.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => logSpy && logSpy.mockRestore());

function crown({ treasury, exp = 400, coin = 20000 }) {
    const k = { id: 'a', name: 'Testland', isAlive: true, treasury };
    const f = CrownBooks.state(k);
    f.avg = { rev: exp, exp, n: 30, demesne: 0, purse: 0 };
    const R = MoneySupply._blank(coin);
    R.counted = true;
    const world = { kingdoms: [k], day: 100, money: { realms: { a: R } } };
    return { k, world };
}

describe("an NPC crown's chests are reckoned against its realm's coin", () => {
    it('a month of spending that is most of the realm\'s coin is not "low"; past coinHigh it is high', () => {
        const N = Fiscal.config().npc;
        expect(N.coinLow).toBeGreaterThan(0);
        expect(N.coinHigh).toBeGreaterThan(N.coinLow);
        // 20 days of spending (< reserveLow) but 40% of the realm's coin: high, not low
        const rich = crown({ treasury: 8000, exp: 400, coin: 20000 });
        expect(Fiscal.reserveStand(rich.world, rich.k)).toBe('high');
        // Thin both ways: low
        const thin = crown({ treasury: 400 * 20, exp: 400, coin: 200000 });
        expect(Fiscal.reserveStand(thin.world, thin.k)).toBe('low');
        // Not yet counted: days alone, as before
        const raw = crown({ treasury: 400 * 20 });
        raw.world.money = null;
        expect(Fiscal.reserveStand(raw.world, raw.k)).toBe('low');
    });

    it('the largesse begins past largesseCoin of the realm\'s coin and pays every coin into the towns', () => {
        const N = Fiscal.config().npc;
        const tiles = {};
        const towns = [];
        for (let i = 0; i < 2; i++) {
            const s = { name: `S${i}`, kingdom: 'a', population: 1000, type: 'town' };
            Economy.initSettlement(s);
            s.economy.gold = 1000;
            tiles[`${i},0`] = { q: i, r: 0, settlement: s };
            towns.push({ q: i, r: 0, s, key: `${i},0` });
        }
        const { k, world } = crown({ treasury: 20000, exp: 400, coin: 20000 });
        world.getTile = (q, r) => tiles[`${q},${r}`] || null;
        k.capital = { q: 0, r: 0 };
        const line = N.largesseCoin * 20000;
        expect(line).toBeLessThan(N.largesseAbove * 400);
        const before = k.treasury + towns.reduce((a, t) => a + t.s.economy.gold, 0);
        const spent = Fiscal._largesse(world, k, k.fisc, towns);
        expect(spent).toBeCloseTo((20000 - line) * N.largesseShare, 1);
        expect(k.treasury + towns.reduce((a, t) => a + t.s.economy.gold, 0)).toBeCloseTo(before, 4);
    });
});

describe('a free town spends its piled-up coin into the realms', () => {
    it('only the excess past freeTowns.above × the realms\' coin per head moves, purse to purse', () => {
        const F = MoneySupply.config().freeTowns;
        expect(F.above).toBeGreaterThan(0);
        const mk = (name, kingdom, pop, gold, q) => ({ name, kingdom, population: pop, type: 'village', q, r: 0, economy: { gold } });
        const free = mk('Free', null, 400, 20000, 0);
        const a = mk('A', 'a', 1000, 2000, 1), b = mk('B', 'b', 1000, 2000, 2);
        const all = [free, a, b];
        const world = { getSettlementViews: () => all, getTile: (q) => ({ settlement: all[q] }) };
        const st = { realms: { a: MoneySupply._blank(2000), b: MoneySupply._blank(2000) } };
        const ka = { id: 'a', population: 1000 }, kb = { id: 'b', population: 1000 };
        const towns = new Map([['a', [a]], ['b', [b]]]);
        const norm = 2; // coin per head
        const moved = MoneySupply._freeTowns(world, st, [ka, kb], towns, norm, () => 1, F);
        const excess = 20000 - F.above * norm * 400;
        expect(moved).toBeCloseTo(excess * F.rate, 1);
        expect(free.economy.gold + a.economy.gold + b.economy.gold).toBeCloseTo(24000, 4);
        expect(st.realms.a.tot.drift + st.realms.b.tot.drift).toBeCloseTo(moved, 2);
        // A free town at the realms' level keeps its coin
        free.economy.gold = 400 * norm;
        expect(MoneySupply._freeTowns(world, st, [ka, kb], towns, norm, () => 1, F)).toBe(0);
    });
});

describe("a small world's coin in circulation over 240 days (idle player)", () => {
    it('stays within a band of where it began', () => {
        const game = newGame(101, { kingdomCount: 4 });
        const circ = () => {
            let c = 0;
            for (const v of CoinCensus.count(game.world, game.player).values()) c += v.coin;
            return c;
        };
        const keepAlive = () => { game.player.health = 100; game.player.starvationDays = 0; };
        for (let i = 0; i < 8; i++) { keepAlive(); endDay(game); }
        const start = circ();
        expect(start).toBeGreaterThan(50000);
        let lo = start, hi = start;
        for (let i = 8; i < 240; i++) {
            keepAlive();
            endDay(game);
            if (i % 30 === 0) { const c = circ(); lo = Math.min(lo, c); hi = Math.max(hi, c); }
        }
        const end = circ();
        // (before 2026-11: 127k → 54k by day 240, the crowns holding more than the towns)
        expect(end / start).toBeGreaterThan(0.8);
        expect(end / start).toBeLessThan(1.25);
        expect(lo / start).toBeGreaterThan(0.75);
        // The crowns' chests hold a working balance, not the realm's coin
        const treas = game.world.kingdoms.filter(k => k.isAlive).reduce((a, k) => a + Math.max(0, k.treasury || 0), 0);
        expect(treas / end).toBeLessThan(0.5);
    }, 300000);
});

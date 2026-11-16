// The coin census closes day by day under the bot (2026-11-15). A bot-played
// run drifted 1–2k unbooked coin over 600 days (of ~1.05M): spies' daily
// upkeep paid into no purse (−23 a day), and a spy's work against a crown
// took coin out of its chests into nothing; new inns opened with cash from
// nothing (+6k in 100 days on seed 101, the first time a town's houses were
// asked after); a pedlar's purse was counted by realm but not in the world's
// total (CoinCensus.each); a migrating household's purses vanished when its
// new town kept no roster; selling a ship without the world paid a flat
// price from nothing; import duty left a float residue and was credited
// though a kind-trade lot paid none; a crown's loss with no town of its own to
// spend it in went nowhere. And two leaks that were only booked are now
// routed: an avenger's purse comes out of their home town and goes back to it
// when the feud ends; coin lost at sea goes into the sea's keeping
// (world.money.sea, counted) and what the sea gives up comes out of it first.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData, newGame, endDay, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Espionage } from '../systems/espionage.js';
import { Hospitality } from '../systems/hospitality.js';
import { Nemesis } from '../systems/nemesis.js';
import { Economy } from '../world/economy.js';

let logSpy, warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

const TOL = 0.02;

describe('the coin sites behind the drift', () => {
    it("a spy's upkeep is spent in the town nearest their post", () => {
        const g = coinGame(101);
        const t = coinTowns(g.world)[0];
        standIn(g.player, t);
        Espionage.initPlayer(g.player);
        g.player.gold = 500;
        g.player.espionage.spies.push({ id: 1, name: 'Mole', status: 'idle', loyalty: 90, upkeep: 23, location: { q: t.q, r: t.r }, skills: {}, traits: [], level: 1 });
        const before = t.settlement.economy.gold;
        const m = measure(g.world, g.player, () => Espionage.processDaily(g.player, g.world));
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        expect(t.settlement.economy.gold).toBeCloseTo(before + 23, 2);
    });

    it("a town's inns open with their keepers' savings out of its purse", () => {
        const g = coinGame(101);
        const t = coinTowns(g.world)[0];
        const st = Hospitality.state(g.world);
        for (const id of st.towns[`${t.q},${t.r}`] || []) delete st.houses[id];
        delete st.towns[`${t.q},${t.r}`];
        const m = measure(g.world, g.player, () => Hospitality.townHouses(g.world, t.q, t.r));
        expect(m.result.length).toBeGreaterThan(0);
        expect(m.result.some(h => h.cash > 0)).toBe(true);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("an avenger's yearly means come out of their home town, up to the purse's cap", () => {
        const g = coinGame(101);
        const t = coinTowns(g.world)[0];
        const nm = { id: 'nmT', kind: 'blood', purse: 100, home: { q: t.q, r: t.r } };
        Nemesis.state(g.player).list.push(nm); // (counted coin: systems/coinCensus.js)
        const m = measure(g.world, g.player, () => Nemesis._earn(g.player, g.world, nm, 150));
        expect(m.result).toBe(150);
        expect(nm.purse).toBe(250);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        nm.purse = Nemesis.config().purse.cap - 10;
        expect(Nemesis._earn(g.player, g.world, nm, 150)).toBe(10);
    });

    it('coin lost at sea is kept by the sea, and what it gives up comes out of that first', () => {
        const g = coinGame(101);
        const lost = measure(g.world, g.player, () => { g.player.gold -= 40; MoneySupply.seaLost(g.world, 40); });
        expect(lost.booked).toBe(0);
        expect(Math.abs(lost.unbooked)).toBeLessThan(TOL);
        expect(CoinCensus.total(g.world, g.player).byKind.sea).toBe(40);
        const found = measure(g.world, g.player, () => { g.player.gold += 100; MoneySupply.seaFound(g.world, 100, 'seaFinds'); });
        expect(found.booked).toBe(60); // (40 out of the sea's keeping, 60 coin from no purse)
        expect(Math.abs(found.unbooked)).toBeLessThan(TOL);
        expect(g.world.money.sea).toBe(0);
    });

    it("a pedlar's purse is in the world's total", () => {
        const g = coinGame(101);
        const t = coinTowns(g.world)[0].settlement;
        const st = t.townTrade || (t.townTrade = { pedlars: [] });
        if (!Array.isArray(st.pedlars)) st.pedlars = [];
        const m = measure(g.world, g.player, () => { const paid = Economy.drawTown(t, 25); st.pedlars.push({ id: 'pdT', purse: paid, pack: {} }); });
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });
});

/**
 * The bot plays `days` (after 8 days of setting up), the census measured
 * against the books around its actions and every step of the daily turn
 * (harness moneyTrace, full). → { total, by: { step: unbooked } }
 */
function drift(seed, days) {
    const g = newGame(seed, {});
    const stats = {};
    for (let i = 0; i < 8; i++) { botDay(g, stats); endDay(g); }
    g.moneyTrace = { by: {}, day: {}, last: null, crown: {}, crownLast: null, full: true, unbooked: {} };
    const tot = () => CoinCensus.total(g.world, g.player).total - MoneySupply.bookedChange(g.world);
    const by = {};
    const add = (k, v) => { if (Math.abs(v) > 1e-9) by[k] = (by[k] || 0) + v; };
    const start = tot();
    for (let i = 8; i < days; i++) {
        let u0 = tot();
        botDay(g, stats);
        add('botDay', tot() - u0);
        g.moneyTrace.last = null; g.moneyTrace.lastM = null; g.moneyTrace.lastBooked = null;
        const res = endDay(g);
        if (res.died) { u0 = tot(); carryOn(g, res.died); add('carryOn', tot() - u0); }
    }
    for (const k in g.moneyTrace.unbooked) add(k, g.moneyTrace.unbooked[k]);
    return { total: tot() - start, by };
}

describe('the census closes under the bot', () => {
    it('seed 101, 300 days: under 15 coin unbooked in all, under 10 by any one step', () => {
        const { total, by } = drift(101, 300);
        const worst = Object.entries(by).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
        console.info(`seed 101 300d: unbooked ${total.toFixed(2)}; worst ${worst.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`);
        // (before: −1.2k, spies −23 a day, inns +6k in the first 100 days)
        expect(Math.abs(total)).toBeLessThan(15);
        for (const [k, v] of worst) expect(Math.abs(v), k).toBeLessThan(10);
    }, 300000);
});

// Coin in the systems a–l (2026-11): every coin comes from somewhere and goes
// somewhere. The guilds' chests no longer only fill — a hall spends its upkeep,
// members' relief, the masters' dividend and a seasonal feast into its town
// (Guilds._spendWeek), so guild treasuries level off instead of piling up
// (seed 303, four realms: 14.6k → 30.7k over five years before). Each action
// below is measured against the world's coin census and the books (coinCheck.js):
// nothing made or lost unbooked. (More cases: coinSystems.al.ac / .df / .gl.)

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Guilds } from '../systems/guilds.js';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { measure } from './playtest/coinCheck.js';

beforeAll(async () => {
    await loadData();
});

const plains = (q, r, settlement = null) => ({ q, r, terrain: { id: 'plains', passable: true }, resource: null, settlement });

/** A capital of realm k1 at (5,5), its purse counted by the census. */
function capitalWorld() {
    const capital = { name: 'Highmarket', type: 'capital', population: 12000, happiness: 50, kingdom: 'k1', q: 5, r: 5 };
    const kingdoms = [{ id: 'k1', name: 'Aster', isAlive: true, wars: [], capital: { q: 5, r: 5 }, finance: { debtRatio: 0, missed: 0, unpaid: 0 }, traits: [], treasury: 1000, territory: [{ q: 5, r: 5 }] }];
    const world = {
        width: 40, height: 40, day: 50, activeEvents: [], units: [], kingdoms,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => (q === 5 && r === 5 ? plains(5, 5, capital) : plains(q, r)),
        getSettlementViews: () => [capital],
        getAllSettlements: () => [capital],
    };
    SettlementMarket.ensure(capital);
    Economy.initSettlement(capital);
    capital.economy.gold = 5000;
    return { world, capital };
}

const guildCoin = (world) => {
    let t = 0, m = 0;
    for (const v of world.getSettlementViews()) {
        const s = world.getTile(v.q, v.r).settlement;
        for (const g of Object.values((s && s.guilds) || {})) { t += Math.max(0, g.treasury || 0); m += g.members || 0; }
    }
    return { t, m };
};

describe('a guildhall spends in its town', () => {
    it('upkeep, relief and dividend come out of the chest and into the town purse, nothing made or lost', () => {
        const { world, capital } = capitalWorld();
        Guilds.ensureTown(world, capital, 50);
        const g = Object.values(capital.guilds)[0];
        expect(g).toBeTruthy();
        g.treasury = 3000;
        g.prosperity = 0.5;
        const town0 = capital.economy.gold;
        const m = measure(world, null, () => Guilds._spendWeek(world, capital, g, world.day));
        const spent = m.result.upkeep + m.result.relief + m.result.dividend + m.result.feast;
        expect(m.result.upkeep).toBeGreaterThan(0);
        // (hard times: relief, no dividend)
        expect(m.result.relief).toBeGreaterThan(0);
        expect(m.result.dividend).toBe(0);
        expect(g.treasury).toBeCloseTo(3000 - spent, 2);
        expect(capital.economy.gold).toBeCloseTo(town0 + spent, 2);
        expect(Math.abs(m.unbooked)).toBeLessThan(0.05);
    });

    it('the reserve is kept: a chest at its reserve pays only its upkeep', () => {
        const { world, capital } = capitalWorld();
        Guilds.ensureTown(world, capital, 50);
        const g = Object.values(capital.guilds)[0];
        const C = Guilds.config();
        g.prosperity = 1.2;
        g.treasury = g.members * C.dues * C.spending.reserveWeeks;
        const r = Guilds._spendWeek(world, capital, g, world.day);
        expect(r.relief + r.dividend + r.feast).toBe(0);
        expect(r.upkeep).toBeCloseTo(g.members * C.spending.upkeep, 1);
    });

    it('holds a feast once a season on its own day, and the town is merrier for it', () => {
        const { world, capital } = capitalWorld();
        Guilds.ensureTown(world, capital, 50);
        const g = Object.values(capital.guilds)[0];
        let feasts = 0;
        for (let day = 7; day <= 364; day += 7) {
            g.treasury = 4000;
            const mood = capital.happiness;
            const r = Guilds._spendWeek(world, capital, g, day);
            if (r.feast > 0) { feasts++; expect(capital.happiness).toBeGreaterThan(mood); }
        }
        expect(feasts).toBe(4);
    });
});

describe('the guilds\' chests level off', () => {
    it('seed 303, four realms, three years: guild treasuries hold steady a member and stop piling up', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const g = newGame(303, { kingdomCount: 4 });
        g.autoUpkeep = 'full';
        const marks = [];
        for (let i = 0; i < 1095; i++) {
            g.player.health = 100; g.player.starvationDays = 0;
            endDay(g);
            if (i === 364 || i === 729 || i === 1094) marks.push(guildCoin(g.world));
        }
        const per = marks.map(x => x.t / Math.max(1, x.m));
        console.info(`guilds: ${marks.map(x => `${Math.round(x.t)}/${x.m}`).join(' → ')} (a member: ${per.map(x => x.toFixed(1)).join(' → ')})`);
        // (before: 18.0k → 23.3k → 28.3k, 7.9 → 9.3 → 9.8 a member)
        for (const p of per) expect(p).toBeLessThan(7);
        expect(per[2]).toBeLessThan(per[0] * 1.15);
    }, 900000);
});

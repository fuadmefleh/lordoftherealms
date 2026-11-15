// What drained the crowns (seed 303's century: 305k → 37k): the realm's
// misfortunes — a scandal, a flood, a recession, a religious war, a civil war —
// each took a share of the whole chests, so a crown that saved paid the most
// and the year's events came to a wealth tax of about half its treasury. Now a
// misfortune is reckoned against the chests but at most a few weeks' revenue
// (CrownBooks.lossBasis), and is spent into the realm's towns: the coin moves,
// none vanishes. Offices sold for less than their price (the towns' merchants
// pay what their purses allow) bring only that share of the corruption. And a
// crown with more put by than it needs spends the surplus back into its towns
// (Fiscal._largesse), so its chests level off instead of draining the realm's coin.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { CrownBooks } from '../world/crownBooks.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Characters } from '../world/characters.js';
import { Religion } from '../systems/religion.js';
import { Economy } from '../world/economy.js';
import { Fiscal } from '../systems/fiscal.js';
import { loadData } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => logSpy && logSpy.mockRestore());

/** A small realm: three towns with purses, a capital, books with `rev` a day of revenue. */
function realm({ treasury = 100000, rev = 200 } = {}) {
    const tiles = {};
    const territory = [];
    for (let i = 0; i < 3; i++) {
        const s = { name: `S${i}`, kingdom: 'a', population: 1000, type: i === 0 ? 'capital' : 'town' };
        Economy.initSettlement(s);
        s.economy.gold = 5000;
        tiles[`${i},0`] = { q: i, r: 0, settlement: s };
        territory.push({ q: i, r: 0 });
    }
    const k = { id: 'a', name: 'Testland', isAlive: true, treasury, military: 500, stability: 60, territory, capital: { q: 0, r: 0 }, relations: {},
        religion: { piety: 50 }, characterData: { advisors: {} } };
    const f = CrownBooks.state(k);
    f.avg = { rev, exp: rev * 0.9, n: 30, demesne: 10, purse: 0 };
    const world = { kingdoms: [k], events: [], day: 100, getTile: (q, r) => tiles[`${q},${r}`] || null };
    return { k, world, tiles };
}
const purses = (tiles) => Object.values(tiles).reduce((a, t) => a + t.settlement.economy.gold, 0);

describe("a crown's misfortunes cost it weeks of revenue, not its savings", () => {
    it('lossBasis is the chests, capped at eventLoss.basisDays of revenue', () => {
        const days = CrownBooks.config().eventLoss.basisDays;
        expect(days).toBeGreaterThan(0);
        expect(CrownBooks.lossBasis(realm({ treasury: 100000, rev: 200 }).k)).toBe(200 * days);
        expect(CrownBooks.lossBasis(realm({ treasury: 1000, rev: 200 }).k)).toBe(1000);
        // (no revenue on record yet: the chests, as before)
        const { k } = realm({ treasury: 5000 });
        k.fisc.avg.n = 0;
        expect(CrownBooks.lossBasis(k)).toBe(5000);
    });

    it("a scandal's tenth is a tenth of a few weeks' revenue for a rich crown — spent into its towns", () => {
        const { k, world, tiles } = realm({ treasury: 300000, rev: 200 });
        const before = k.treasury + purses(tiles);
        const out = WorldEvents._lose(world, k, 0.1);
        expect(out).toBe(Math.floor(200 * CrownBooks.config().eventLoss.basisDays * 0.1));
        expect(k.treasury).toBe(300000 - out);
        expect(k.treasury + purses(tiles)).toBeCloseTo(before, 6);
    });

    it('a year of misfortunes leaves a saving crown most of its chests', () => {
        const { k, world } = realm({ treasury: 300000, rev: 200 });
        // (two dozen 10–20% events: the old wealth tax took ~95% of the chests)
        for (let i = 0; i < 24; i++) WorldEvents._lose(world, k, i % 2 ? 0.2 : 0.1);
        expect(k.treasury).toBeGreaterThan(250000);
    });

    it('a religious war and a civil war are paid for in the capital, not lost', () => {
        const { k, world, tiles } = realm({ treasury: 300000, rev: 200 });
        const before = k.treasury + purses(tiles);
        Religion.triggerReligiousConflict(k, { name: 'the Test Heresy', strength: 60 }, world);
        const afterWar = k.treasury;
        expect(afterWar).toBeLessThan(300000);
        expect(300000 - afterWar).toBeLessThanOrEqual(Math.ceil(CrownBooks.lossBasis({ ...k, treasury: 300000 }) * 0.15));
        expect(k.treasury + purses(tiles)).toBeCloseTo(before, 6);
        // A court event that costs the treasury a share spends it; one that fills it draws on the towns
        const loss = Characters.applyEventDataEffects({ treasuryPct: -0.1 }, k, world);
        expect(loss.treasury).toBeLessThan(0);
        const gain = Characters.applyEventDataEffects({ treasuryPct: 0.1 }, k, world);
        expect(gain.treasury).toBeGreaterThan(0);
        expect(k.treasury + purses(tiles)).toBeCloseTo(before, 4);
    });

    it('offices sold for a fraction of their price bring that fraction of the corruption', () => {
        const { k } = realm({ treasury: 0, rev: 200 });
        const f = CrownBooks.state(k);
        f.corruption = 0;
        const price = Math.round(200 * CrownBooks.config().crisis.offices.days);
        // The buyers can find only a quarter of the price
        const gain = CrownBooks.sellOffices(k, { pay: (a) => a / 4 });
        expect(gain).toBeCloseTo(price / 4, 2);
        expect(f.corruption).toBeCloseTo(CrownBooks.config().corruption.officesSale / 4, 4);
        expect(k.treasury).toBeCloseTo(price / 4, 2);
    });

    it('a crown past its reserve spends the surplus into its towns, weekly, and stops at the reserve', () => {
        const N = Fiscal.config().npc;
        expect(N.largesseAbove).toBeGreaterThan(0);
        const { k, world, tiles } = realm({ treasury: 0, rev: 200 });
        k.fisc.avg.exp = 100;
        const towns = Object.entries(tiles).map(([key, t]) => ({ q: t.q, r: t.r, s: t.settlement, key }));
        // At the reserve: nothing spent
        k.treasury = N.largesseAbove * 100;
        expect(Fiscal._largesse(world, k, k.fisc, towns)).toBe(0);
        // Well past it: a share of the excess goes to the towns, every coin of it
        k.treasury = N.largesseAbove * 100 + 50000;
        const before = k.treasury + purses(tiles);
        const spent = Fiscal._largesse(world, k, k.fisc, towns);
        expect(spent).toBeCloseTo(50000 * N.largesseShare, 1);
        expect(k.fisc.day.works).toBeCloseTo(spent, 1);
        expect(k.treasury + purses(tiles)).toBeCloseTo(before, 4);
        // Week on week the chests come down toward the reserve, never under it
        for (let w = 0; w < 60; w++) Fiscal._largesse(world, k, k.fisc, towns);
        expect(k.treasury).toBeGreaterThanOrEqual(N.largesseAbove * 100);
        expect(k.treasury).toBeLessThan(N.largesseAbove * 100 + 500);
    });
});

// The world's coin census closes (2026-11). Every change in CoinCensus.total
// over a run is a booked flow — the mints' strikes, debasement, wear,
// recoinage, forgery, the cheat panel, and coin truly lost or found
// (MoneySupply.leak) — summed by MoneySupply.bookedChange. Before, seed 303
// (4 realms, the bot keeping itself) lost 17k of 435k in five years unbooked,
// and made 3k on other runs: units were born with coin from nothing and took
// it with them when they left the map; a robbed caravan's coin was copied to
// the robbers; outlaw hoards past their cap, a dispersed band's hoard, a
// crown's defaulted loans, a crashed bubble and saga treasury losses simply
// vanished; new villages got a starting purse from nothing; rival
// adventurers and saga purses were paid from nothing. Now each draws from a
// real purse or pays into one.
//
// And the landholders' coffers and the rival merchant houses' capital no
// longer only grow: holders spend estateWages of their outgoings in their
// estates' towns, keep reserveMonths (2) of rents and spend savingsSpend
// (0.3) a month of the rest; a merchant house pays overheadShare of its
// capital a week to its towns and keeps workingPerPost a post working,
// paying out the rest.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { CoinCensus } from '../systems/coinCensus.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Economy } from '../world/economy.js';
import { World } from '../world/world.js';
import { WorldUnit } from '../world/units.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { LandMarket } from '../systems/landMarket.js';
import { PublicWorks } from '../systems/publicWorks.js';
import { Transport } from '../world/transport.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

let logSpy, warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

/** A tiny world of towns on a row: getTile / getSettlementViews over plain records. */
function row(n, gold = 1000) {
    const towns = [];
    for (let i = 0; i < n; i++) {
        const s = { name: `T${i}`, q: i * 4, r: 0, kingdom: 'a', population: 1000, type: 'town' };
        Economy.initSettlement(s);
        s.economy.gold = gold;
        towns.push(s);
    }
    const world = Object.create(World.prototype);
    world.width = 100; world.height = 10; world.units = [];
    world.getTile = (q, r) => { const s = towns.find(t => t.q === q && t.r === r); return s ? { q, r, settlement: s, terrain: { passable: true } } : { q, r, terrain: { passable: true } }; };
    world.getSettlementViews = () => towns;
    return { world, towns };
}

const sum = (towns) => towns.reduce((a, t) => a + t.economy.gold, 0);

describe('units carry real coin', () => {
    it("a new unit's rolled coin is drawn from the nearest town; a unit leaving the map pays what it carries into the nearest town", () => {
        const { world, towns } = row(3);
        const u = new WorldUnit('caravan', 4, 0, 8, 0);
        u.inventory.gold = 120;
        u._rolledGold = 120;
        const before = sum(towns) + 120; // (the roll counted once, as the census sees it)
        world.fundUnitCoin(u);
        expect(u._rolledGold).toBeUndefined();
        expect(towns[1].economy.gold).toBe(880);
        expect(sum(towns) + u.inventory.gold).toBeCloseTo(before - 120, 6);
        // ...and it reaches the end of the road: its coin goes into the town it stands nearest
        u.q = 9; u.destroyed = true;
        world.settleUnitCoin(u);
        expect(u.inventory.gold).toBe(0);
        expect(towns[2].economy.gold).toBe(1120);
        expect(sum(towns)).toBeCloseTo(3000, 6);
    });

    it('a broke town funds only what it has; a letter-rider carries the mail\'s coin, not coin to be found', () => {
        const { world, towns } = row(1, 30);
        const u = new WorldUnit('ship', 0, 0);
        u.inventory.gold = 200;
        u._rolledGold = 200;
        world.fundUnitCoin(u);
        expect(u.inventory.gold).toBe(30);
        expect(towns[0].economy.gold).toBe(0);
        const rider = { type: 'courier_rider', q: 0, r: 0, inventory: { gold: 50 }, bag: { gold: 50, player: true }, destroyed: true };
        expect(world.settleUnitCoin(rider)).toBe(0);
        expect(towns[0].economy.gold).toBe(0);
    });

    it('with no town that keeps coin anywhere, the coin is lost and booked as lost', () => {
        const { world, towns } = row(1);
        towns[0].inKind = true;
        world.money = null;
        const u = { type: 'raider', q: 0, r: 0, inventory: { gold: 40 }, destroyed: true };
        world.settleUnitCoin(u);
        expect(MoneySupply.state(world).leaks.unitsLost).toBe(-40);
        expect(MoneySupply.bookedChange(world)).toBe(-40);
    });
});

describe("the landholders' and merchant houses' outflows", () => {
    it('a holder spends on its estates in their own towns, by their worth', () => {
        const { world, towns } = row(2, 0);
        const held = [{ town: '0,0', value: 300 }, { town: '4,0', value: 100 }];
        const paid = LandMarket._spendOnEstates(world, held, 100);
        expect(paid).toBe(100);
        expect(towns[0].economy.gold).toBeCloseTo(75, 2);
        expect(towns[1].economy.gold).toBeCloseTo(25, 2);
    });

    it("a rival house's overheads go into its towns, and it keeps only workingPerPost a post working", () => {
        const cfg = MerchantHouses.config().rivals;
        expect(cfg.overheadShare).toBeGreaterThan(0);
        expect(cfg.workingPerPost).toBeGreaterThan(0);
        const { world, towns } = row(2, 1000);
        const r = { seat: { q: 0, r: 0 }, posts: [{ q: 4, r: 0 }], capital: 10000 };
        const paid = MerchantHouses._rivalOverheads(world, r, cfg);
        expect(paid).toBeCloseTo(10000 * cfg.overheadShare, 2);
        expect(r.capital + sum(towns)).toBeCloseTo(12000, 6);
        // Past its working capital (seat + one post) every coin of profit is paid out
        expect(MerchantHouses._rivalCap(r, cfg)).toBe(Math.min(cfg.capitalCap, cfg.workingPerPost * 2));
        r.capital = MerchantHouses._rivalCap(r, cfg) + 500;
        expect(MerchantHouses._rivalPayout(r, 300, cfg)).toBe(300);
    });
});

/** Run `days` (keeping the bot alive) and measure the census against the books from day 8. */
function closure(seed, days, each = null) {
    const g = newGame(seed, { kingdomCount: 4 });
    g.autoUpkeep = 'full';
    const live = () => { g.player.health = 100; g.player.starvationDays = 0; };
    for (let i = 0; i < 8; i++) { live(); endDay(g); }
    const w0 = CoinCensus.total(g.world, g.player).total;
    const b0 = MoneySupply.bookedChange(g.world);
    for (let i = 8; i < days; i++) { live(); endDay(g); if (each) each(g, i); }
    const w1 = CoinCensus.total(g.world, g.player).total;
    const unbooked = (w1 - w0) - (MoneySupply.bookedChange(g.world) - b0);
    return { g, w0, w1, unbooked };
}

describe('the coin census closes over a run', () => {
    for (const seed of [101, 303]) {
        it(`seed ${seed}, 240 days: every change in the world's coin is booked`, () => {
            const { w0, w1, unbooked } = closure(seed, 240);
            console.info(`seed ${seed} 240d: world coin ${Math.round(w0)} -> ${Math.round(w1)}, unbooked ${unbooked.toFixed(1)}`);
            // (rounding only: −13k to −17k before, on these worlds; −37 on seed 101 until
            // 2026-11-15 — a stale roll funded twice, World.fundUnitCoin)
            expect(Math.abs(unbooked)).toBeLessThan(5);
        }, 300000);
    }

    it('seed 101: a public work funded with thousands spends at its pace, its books close, and so does the census', () => {
        let w = null, held = 0, after = 0;
        const { unbooked } = closure(101, 40, (game, i) => {
            const { world, player } = game;
            if (i === 8) {
                // (the player's thousands are real coin: drawn out of the towns' purses)
                let need = 8000;
                for (const v of world.getSettlementViews()) {
                    if (!(need > 0)) break;
                    const s = world.getTile(v.q, v.r).settlement;
                    const got = Economy.drawTown(s, Math.min(need, Math.max(0, (s.economy && s.economy.gold) - 200)));
                    player.gold += got; need -= got;
                }
                for (const v of world.getSettlementViews()) {
                    const r = PublicWorks.commission(world, player, 'harbour', `${v.q},${v.r}`, { by: 'player' });
                    if (r.success) { w = r.work; break; }
                }
                if (!w) {
                    for (const seg of Transport.segments(world)) {
                        const r = PublicWorks.commission(world, player, 'upgrade_road', seg.key, { by: 'player' });
                        if (r.success) { w = r.work; break; }
                    }
                }
                // (the budget nearly gone: topped up with what finishing it wants)
                if (w) { const b = w.budget - 1; player.gold += b; w.budget = 1; w.book.funded -= b; PublicWorks.fund(world, player, w.id); held = w.budget; }
            }
            if (i === 9 && w) after = w.budget;
        });
        expect(w).not.toBe(null);
        expect(held).toBeGreaterThan(100);
        // (one day of it: a day's wages and materials, not the budget)
        expect(after / held).toBeGreaterThan(0.9);
        expect(w.book.funded).toBeCloseTo(w.spent + w.book.refunded + w.budget, 1);
        expect(Math.abs(unbooked)).toBeLessThan(5);
    }, 300000);

    it("seed 303, five years: the census closes, and the landholders' coffers and merchant capital level off", () => {
        const coffers = (g) => {
            let c = 0;
            for (const h of Object.values((g.world.estates && g.world.estates.holders) || {})) if (h && h.kind !== 'player' && h.kind !== 'crown') c += Math.max(0, h.purse || 0);
            for (const h of Object.values((g.player.house && g.player.house.rivals) || {})) if (h && !h.extinct) c += Math.max(0, h.gold || 0);
            return c;
        };
        const towns = (g) => CoinCensus.total(g.world, g.player).byKind.towns || 0;
        let maxRatio = 0, capOk = true;
        const { g, w0, unbooked } = closure(303, 608, (game, i) => {
            if (i % 60 !== 0) return;
            maxRatio = Math.max(maxRatio, coffers(game) / Math.max(1, towns(game)));
            const cfg = MerchantHouses.config().rivals;
            for (const r of (game.player.merchant && game.player.merchant.rivals) || []) {
                if (r && r.status === 'active' && r.capital > MerchantHouses._rivalCap(r, cfg) * 1.25 + 500) capOk = false;
            }
        });
        console.info(`seed 303 5y: unbooked ${unbooked.toFixed(1)}, coffers/towns max ${maxRatio.toFixed(2)}, end ${Math.round(coffers(g))} / ${Math.round(towns(g))}`);
        // (−91 until 2026-11-15: lairs' bands and war hosts funded a roll their spawner had replaced)
        expect(Math.abs(unbooked)).toBeLessThan(25);
        void w0;
        // (before: 16k → 67k in the coffers against 81k → 64k in the towns — past 1.0)
        expect(maxRatio).toBeLessThan(0.65);
        expect(capOk).toBe(true);
    }, 600000);
});

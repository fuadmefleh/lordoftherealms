// Every coin comes from somewhere and goes somewhere (2026-11): player-side
// payments in src/systems g–l that once made or unmade coin — a ransom paid to
// no one, a translator's wage, a robber's take, salvage of a demolished road
// paid from nothing, a House favour from no purse, relic gold — now move coin
// purse to purse (or book it with MoneySupply.leak), so the world's census
// moves by exactly what the books say.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { Knockout } from '../systems/knockout.js';
import { HeirAgency } from '../systems/heirAgency.js';
import { House } from '../systems/house.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { LegendaryArtifacts } from '../systems/legendaryArtifacts.js';
import { Holdings } from '../systems/holdings.js';
import { Kingship } from '../systems/kingship.js';

let logSpy, warnSpy, g, town;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    g = coinGame(303, 1);
    town = coinTowns(g.world)[0];
    standIn(g.player, town);
    // (real coin in hand, whatever the start)
    if (g.player._inKind) delete g.player._inKind;
    g.player.gold = 2000;
}, 120000);
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

const closed = (m) => expect(Math.abs(m.unbooked)).toBeLessThan(0.05);

describe('coin in systems g–l closes', () => {
    it('a robber who knocks the player down spends the take in the nearest town', () => {
        const before = g.player.gold;
        const m = measure(g.world, g.player, () => Knockout.playerWakes(g.player, { act: 'rob' }, () => 0.5, g.world));
        expect(m.result.stolen).toBeGreaterThan(0);
        expect(g.player.gold).toBe(before - m.result.stolen);
        closed(m);
    });

    it("a captive child's ransom reaches a purse", () => {
        const child = { id: 'cs-child', firstName: 'Ada', isAlive: true, age: 20, gender: 'female' };
        g.player.children = [...(g.player.children || []), child];
        HeirAgency.ensure(child).captive = { by: 'the enemy', day: 1, until: 99, ransom: 150 };
        const m = measure(g.world, g.player, () => HeirAgency.ransom(g.player, g.world, child.id));
        expect(m.result.success).toBe(true);
        closed(m);
    });

    it("a House favour is paid out of the friendliest House's purse, never from nothing", () => {
        g.player.house.prestige = 1000;
        const m = measure(g.world, g.player, () => House.callInFavor(g.player, g.world, { kind: 'gold' }));
        expect(m.result.success).toBe(true);
        closed(m);
    });

    it("a demolished road's salvage is bought out of the nearest town's purse", () => {
        const s = town.settlement;
        const tile = { q: s.q + 1, r: s.r, infrastructure: { id: 'road', name: 'Road' } };
        const m = measure(g.world, g.player, () => Infrastructure.demolish(g.player, tile, g.world));
        expect(m.result.success).toBe(true);
        closed(m);
    });

    it("a relic's hoard of old coin is booked as found", () => {
        LegendaryArtifacts.initialize(g.player);
        const a = LegendaryArtifacts._getDefinitions().find(x => x && x.reforgeRewards && x.reforgeRewards.gold > 0);
        if (!a) return; // (no artifact pays gold in this data)
        g.player.artifacts.fragments[a.id] = a.fragmentsRequired;
        const m = measure(g.world, g.player, () => LegendaryArtifacts.reforgeArtifact(g.player, a.id, g.world));
        expect(m.result.success).toBe(true);
        expect(m.booked).toBeCloseTo(a.reforgeRewards.gold, 2);
        closed(m);
    });

    it("a holding's garrison pay, a governor's fee, a rebels' parley go into the holding's town", () => {
        const s = town.settlement;
        const gold0 = s.economy.gold;
        const m = measure(g.world, g.player, () => { g.player.gold -= 40; Holdings._payInto(g.world, s, 40, 'garrisonPay'); });
        expect(s.economy.gold).toBeCloseTo(gold0 + 40, 2);
        closed(m);
        // (a holding with no town record: the nearest town takes it)
        const m2 = measure(g.world, g.player, () => { g.player.gold -= 25; Holdings._payInto(g.world, { q: s.q, r: s.r, inKind: true }, 25, 'garrisonPay'); });
        closed(m2);
    });

    it('a crown feast and a vassal grant are spent in the realm', () => {
        const k = g.world.kingdoms.find(x => x && x.isAlive !== false && x.id === town.settlement.kingdom);
        const m = measure(g.world, g.player, () => {
            k.treasury -= 100;
            Kingship._spendRealm(g.world, k, 100, 'courtFeast');
        });
        closed(m);
    });
});

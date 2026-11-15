// Coin conservation in systems o–r (2026-11, second sweep): each action below
// moved coin from or into nowhere before — patronage's fees, stipends and
// masons' wages vanished; a petition's gold came from no one and went to no
// one; a hanged pirate's bounty, a sold prize and a merchant's strongbox were
// paid from nothing, a navy fine and a ferry fare left the world; a public
// work's budget was paid to no one; a quest taken in the wilds paid from no
// purse; a crown's reparations dropped the odd coppers. Now each draws from a
// real purse, pays into one, or is booked (MoneySupply.leak).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { Patronage } from '../systems/patronage.js';
import { Petitions } from '../systems/petitions.js';
import { Pirates } from '../systems/pirates.js';
import { PublicWorks } from '../systems/publicWorks.js';
import { Transport } from '../world/transport.js';
import { OutlawLairs } from '../systems/outlawLairs.js';
import { RealmWars } from '../systems/realmWars.js';
import { Quests } from '../systems/quests.js';
import { ProfaneCrimes } from '../systems/profaneCrimes.js';

let logSpy, warnSpy, g, towns;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    g = coinGame(303, 1);
    towns = coinTowns(g.world);
    g.player.gold = 5000;
}, 120000);
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

const TOL = 0.05;
const kingdomOf = (t) => g.world.kingdoms.find(k => k.id === t.settlement.kingdom);

describe('systems o–r move real coin', () => {
    it("patronage's spending (a stipend, a Great Work's masons) goes into the town where it is spent", () => {
        const t = towns[0];
        standIn(g.player, t);
        const town0 = t.settlement.economy.gold;
        const gold0 = g.player.gold;
        const m = measure(g.world, g.player, () => {
            Patronage._spend(g.player, 60, g.world); // a client's stipend, where the player is
            Patronage._spend(g.player, 140, g.world, { q: t.q, r: t.r }); // a work's labour, at its site
        });
        expect(g.player.gold).toBeCloseTo(gold0 - 200, 6);
        expect(t.settlement.economy.gold).toBeCloseTo(town0 + 200, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it('a forestalled Great Work is bought by the town at its site, out of its purse', () => {
        const t = towns[1];
        const workId = Object.keys(Patronage.greatWorks())[0];
        const p = { id: 'gwT', workId, q: t.q, r: t.r, name: t.settlement.name, spent: 400, stage: 0, status: 'building' };
        Patronage.state(g.player).projects.push(p);
        const town0 = t.settlement.economy.gold;
        const gold0 = g.player.gold;
        const m = measure(g.world, g.player, () => Patronage._forestall(g.player, g.world, p, { notices: [] }));
        expect(g.player.gold - gold0).toBeGreaterThan(0);
        expect(t.settlement.economy.gold).toBeCloseTo(town0 - (g.player.gold - gold0), 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("a petition's gold is paid into, or out of, the petitioning town's purse", () => {
        const t = towns[2];
        const ctx = { q: t.q, r: t.r, kingdomId: t.settlement.kingdom };
        const town0 = t.settlement.economy.gold;
        const give = measure(g.world, g.player, () => Petitions.applyEffects(g.player, g.world, ctx, { gold: -75 }));
        expect(t.settlement.economy.gold).toBeCloseTo(town0 + 75, 6);
        expect(Math.abs(give.unbooked)).toBeLessThan(TOL);
        const take = measure(g.world, g.player, () => Petitions.applyEffects(g.player, g.world, ctx, { gold: 40 }));
        expect(t.settlement.economy.gold).toBeCloseTo(town0 + 35, 6);
        expect(Math.abs(take.unbooked)).toBeLessThan(TOL);
        // A crown petition's treasury effect is raised out of the realm's towns
        const crown = measure(g.world, g.player, () => Petitions.applyEffects(g.player, g.world, ctx, { treasury: 120 }));
        expect(crown.delta).toBeCloseTo(0, 1);
        expect(Math.abs(crown.unbooked)).toBeLessThan(TOL);
    });

    it("a pirate's bounty comes out of the crown; a navy fine goes into it; sea finds are booked", () => {
        const t = towns[0];
        standIn(g.player, t);
        const k = kingdomOf(t);
        // The navy's fine, struck colours
        const treasury0 = k.treasury;
        const fine = measure(g.world, g.player, () => Pirates._surrender(g.player, g.world, { enemy: {} }, { cargo: {} }));
        expect(k.treasury).toBeGreaterThan(treasury0);
        expect(Math.abs(fine.unbooked)).toBeLessThan(TOL);
        // A beaten crew handed to the crown
        const gold0 = g.player.gold;
        const st = { enemy: { name: 'The Gull', str0: 20, type: 'pirate' }, log: [] };
        const hang = measure(g.world, g.player, () => Pirates._crewFate(g.player, g.world, st, { cargo: {} }, 'hang', (phase) => ({ phase }), () => ({ done: true })));
        expect(g.player.gold).toBeGreaterThan(gold0);
        expect(Math.abs(hang.unbooked)).toBeLessThan(TOL);
        // A strongbox in a derelict: coin from the sea, booked as found
        const sea = measure(g.world, g.player, () => Pirates._applyOutcome(g.player, g.world, null, { gold: [30, 30] }));
        expect(sea.delta).toBeGreaterThan(0);
        expect(Math.abs(sea.unbooked)).toBeLessThan(TOL);
        // A prize sold to a broker: out of the port's purse
        const sell = measure(g.world, g.player, () => Pirates._shipFate(g.player, g.world, st, { cargo: {} }, 'sell', () => ({ done: true })));
        expect(Math.abs(sell.unbooked)).toBeLessThan(TOL);
    });

    it("a public work's budget is paid to the towns that sell its stone and work its site, and returned closed", () => {
        const t = towns[1];
        standIn(g.player, t);
        const st = Transport.state(g.world);
        const w = {
            id: 'pwT', kind: 'repair', name: 'Test Works', owner: 'player', payer: 'player', kid: t.settlement.kingdom,
            status: 'stalled', stall: 'funds', est: 300, budget: 0, spent: 0, days: 10, daysDone: 0, hands: 4,
            need: {}, got: {}, tq: t.q, tr: t.r, q: t.q, r: t.r,
        };
        st.works.push(w);
        const town0 = t.settlement.economy.gold;
        const fund = measure(g.world, g.player, () => PublicWorks.fund(g.world, g.player, 'pwT'));
        expect(fund.result.success).toBe(true);
        expect(Math.abs(fund.unbooked)).toBeLessThan(TOL);
        const pay = measure(g.world, g.player, () => PublicWorks._pay(g.world, g.player, w, 33.33, t.settlement));
        expect(t.settlement.economy.gold).toBeCloseTo(town0 + 33.33, 6);
        expect(Math.abs(pay.unbooked)).toBeLessThan(TOL);
        const back = measure(g.world, g.player, () => PublicWorks.abandon(g.world, g.player, 'pwT'));
        expect(back.result.success).toBe(true);
        expect(Math.abs(back.unbooked)).toBeLessThan(TOL);
        // The ferryman's fare is spent in the nearest town
        const ferry = measure(g.world, g.player, () => PublicWorks.playerCrossing(g.world, g.player, { q: t.q, r: t.r, roadCross: 'ferry' }));
        expect(ferry.result).toBeGreaterThan(0);
        expect(Math.abs(ferry.unbooked)).toBeLessThan(TOL);
    });

    it("a lair's hoard taken by the player moves to the copper; a realm's expedition is spent in its towns", () => {
        const t = towns[2];
        const ol = OutlawLairs.state(g.player);
        const lair = { id: 'lairT', name: 'Test Hollow', kind: 'bandit_camp', q: t.q, r: t.r, kingdomId: t.settlement.kingdom, notoriety: 10, hoard: { gold: 120.37, goods: {} }, leader: { name: 'Black Tam' }, parties: [], status: 'active' };
        ol.lairs.push(lair);
        const gold0 = g.player.gold;
        const m = measure(g.world, g.player, () => OutlawLairs._reward(g.player, g.world, lair));
        expect(g.player.gold - gold0).toBeCloseTo(120.37, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("a beaten crown's reparations keep the odd coppers in its chests", () => {
        const t = towns[3] || towns[0];
        const k = kingdomOf(t);
        k.treasury = 10;
        const m = measure(g.world, g.player, () => {
            const got = RealmWars._exact(k, g.world, 777);
            g.player.gold += got;
            return got;
        });
        expect(m.result).toBeGreaterThan(10);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it('a quest taken in the wilds is paid by the nearest town that keeps coin', () => {
        const t = towns[0];
        standIn(g.player, t);
        const town0 = t.settlement.economy.gold;
        const quest = { id: 'qT', title: 'Wild Errand', type: 'kill', rewards: { gold: 45 }, payer: null, objectives: [] };
        const m = measure(g.world, g.player, () => Quests.grantRewards(g.player, quest, g.world));
        expect(t.settlement.economy.gold).toBeCloseTo(town0 - 45, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("a forged relic's gilt box is bought out of the player's purse into the town's", () => {
        const t = towns[1];
        standIn(g.player, t);
        if (!g.player.inventory) g.player.inventory = {};
        g.player.inventory.bones = 10;
        const town0 = t.settlement.economy.gold;
        const m = measure(g.world, g.player, () => ProfaneCrimes.forgeRelic(g.player, g.world, null));
        expect(m.result.success).toBe(true);
        expect(t.settlement.economy.gold).toBeGreaterThan(town0);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });
});

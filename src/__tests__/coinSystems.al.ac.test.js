// Coin conservation in systems a–c (2026-11): each action below moved coin
// from or into nowhere before — a bounty turned in paid from no purse, a
// companion's wages and gifts vanished, a friend's savings were rolled from
// nothing, a cultural building's takings came from no one, a lord repaid a
// loan out of chests that did not hold it, a lease's bid bond simply left the
// world. Now each draws from a real purse, pays into one, or is booked.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { Relationships } from '../systems/relationships.js';
import { BountyHunting } from '../systems/bountyHunting.js';
import { Bonds } from '../systems/bonds.js';
import { Companions } from '../systems/companions.js';
import { Culture } from '../systems/culture.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { Concessions } from '../systems/concessions.js';
import { Crises } from '../systems/crises.js';

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

/** A relationship NPC living in `town` (counted by the census through Relationships._npcs). */
function npcIn(town, extra = {}) {
    const npc = { id: `rnpc_t${Relationships._nextId++}`, firstName: 'Tess', isAlive: true, settlementQ: town.q, settlementR: town.r, kingdomId: town.settlement.kingdom, traits: [], ...extra };
    Relationships._npcs.push(npc);
    return npc;
}

describe('systems a–c move real coin', () => {
    it("a criminal turned in is paid by the notice town's realm and purse, not from nothing", () => {
        const t = towns[0];
        const bounty = { id: 'bt1', type: 'criminal_hunt', status: 'captured_pending_decision', actualPay: 120, difficulty: 3, fromQ: t.q, fromR: t.r, targetName: 'Gil' };
        g.player.activeBounties = [bounty];
        const before = g.player.gold;
        const m = measure(g.world, g.player, () => BountyHunting.resolveCapturedTarget(g.player, bounty, 'turn_in', g.world));
        expect(m.result.success).toBe(true);
        expect(g.player.gold - before).toBeGreaterThan(0);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("a friend's savings are drawn out of their town's purse when first rolled", () => {
        const t = towns[1];
        const npc = npcIn(t);
        const town0 = t.settlement.economy.gold;
        const m = measure(g.world, g.player, () => Bonds.purseOf(npc, g.world));
        expect(m.result).toBeGreaterThan(0);
        expect(t.settlement.economy.gold).toBeCloseTo(town0 - m.result, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("a companion's gift and wages go into their own purse", () => {
        const t = towns[2];
        standIn(g.player, t);
        const npc = npcIn(t, { purse: 10 });
        Companions.ensure(npc, g.world);
        const gift = measure(g.world, g.player, () => Companions.gift(g.player, npc.id, g.world));
        expect(gift.result.success).toBe(true);
        npc.companion.wageDue = 12;
        const wages = measure(g.world, g.player, () => Companions.payWages(g.player, npc.id, g.world));
        expect(wages.result.success).toBe(true);
        expect(npc.purse).toBeGreaterThan(10);
        expect(Math.abs(gift.unbooked)).toBeLessThan(TOL);
        expect(Math.abs(wages.unbooked)).toBeLessThan(TOL);
    });

    it("a cultural building's takings come out of its town's purse", () => {
        const t = towns[0];
        const tile = g.world.getTile(t.q, t.r);
        const saved = tile.culturalBuilding;
        tile.culturalBuilding = { type: 'library', incomeBonus: 30, level: 2 };
        g.player.culturalBuildings = [{ q: t.q, r: t.r }];
        g.player.cultureIncomeCarry = 0;
        const town0 = t.settlement.economy.gold;
        const m = measure(g.world, g.player, () => Culture.processPlayerCulture(g.player, g.world));
        expect(m.result.income).toBeGreaterThan(0);
        expect(t.settlement.economy.gold).toBeLessThan(town0);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        tile.culturalBuilding = saved;
        g.player.culturalBuildings = [];
    });

    it('a lord repays a loan out of his chests and towns, never more than he has', () => {
        const k = g.world.kingdoms.find(x => x && x.isAlive !== false && x.lord);
        k.lord.honor = 10;
        k.treasury = 50; // (short of what he owes: the rest is raised from his towns)
        const st = CourtLetters.state(g.player);
        st.loans.push({ id: 'Ltest', kingdomId: k.id, kingdomName: k.name, lordName: k.lord.name, principal: 300, interest: 30, day: 0, due: 0, status: 'open' });
        const m = measure(g.world, g.player, () => CourtLetters._loans(g.world, g.player, { notices: [], arrived: [] }));
        expect(st.loans.find(l => l.id === 'Ltest').status).not.toBe('open');
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("a lease's bid bond is booked out while the crown holds it, and back when refunded", () => {
        const a = { id: 'Atest', bid: 0 };
        const out = measure(g.world, g.player, () => Concessions._escrow(g.player, g.world, a, 400, {}));
        expect(out.result.success).toBe(true);
        expect(out.delta).toBeCloseTo(-400, 6);
        expect(Math.abs(out.unbooked)).toBeLessThan(TOL);
    });

    it("an invading host's war chest is booked, and what is left of it goes to its realm at the close", () => {
        const k = g.world.kingdoms.find(x => x && x.isAlive !== false);
        const c = { uid: 'ctest', kind: 'invasion', data: { chest: 0, realmId: k.id, hosts: [], at: { q: towns[0].q, r: towns[0].r } } };
        // (the sack booked the plunder out of the world as it went into the chest: _capture)
        c.data.chest = 200;
        const st = { history: [], active: c };
        const t0 = k.treasury;
        const close = measure(g.world, g.player, () => Crises._close(g.world, st, c, 10));
        expect(k.treasury - t0).toBeCloseTo(200, 6);
        expect(close.booked).toBeCloseTo(200, 6);
        expect(c.data.chest).toBe(0);
        expect(Math.abs(close.unbooked)).toBeLessThan(TOL);
    });
});

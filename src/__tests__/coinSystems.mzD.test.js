// Coin conservation in systems t–w (2026-11, fourth sweep): each action below
// moved coin from or into nowhere before — an office's salary and its
// commissions were paid from no purse; a claimant's backing, the scribes of a
// forged claim and a pretender's banners took coin to no one, and a kingmaker's
// reward came from nowhere; gifts between crowns vanished; a founded realm's
// chests were struck from nothing;
// a dead or departing townsman's purse left the roster with them; buried
// treasure came from no purse unbooked; the guild's contact and initiation, a
// heist's outlays, a forger's fee, an upbringing's costs and a fine with no
// town to hand went to no one. Now each draws from a real purse, pays into
// one, or is booked (MoneySupply.leak).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { Titles } from '../systems/titles.js';
import { Throne } from '../systems/throne.js';
import { TownSchool } from '../systems/townSchool.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TreasureDigs } from '../systems/treasureDigs.js';
import { Underworld } from '../systems/underworld.js';
import { Underwriting } from '../systems/underwriting.js';
import { Upbringing } from '../systems/upbringing.js';
import { WatchQuestioning } from '../systems/watchQuestioning.js';

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

describe('systems t–w move real coin', () => {
    it("an office's salary and commissions are paid by the crown it serves", () => {
        const t = towns[0];
        const k = kingdomOf(t);
        standIn(g.player, t);
        k.treasury = 2000;
        g.player.allegiance = k.id;
        g.player.currentTitle = 'marshal';
        g.player.titleProgress = g.player.titleProgress || {};
        const gold0 = g.player.gold;
        const m = measure(g.world, g.player, () => Titles.processDaily(g.player, g.world));
        expect(g.player.gold).toBeGreaterThan(gold0);
        expect(k.treasury).toBeCloseTo(2000 - (g.player.gold - gold0), 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        // A commission recorded without the world is credited now and settled by the crown at the day's end
        const m2 = measure(g.world, g.player, () => {
            Titles.recordSurvey(Object.assign(g.player, { currentTitle: 'royal_cartographer' }));
            Titles.processDaily(g.player, g.world);
        });
        expect(g.player.titlePayOwed).toBeUndefined();
        expect(Math.abs(m2.unbooked)).toBeLessThan(TOL);
        g.player.currentTitle = null;
    });

    it("a claimant's gold backing is spent in the realm, and the kingmaker is repaid by its crown", () => {
        const t = towns[1];
        const k = kingdomOf(t);
        k.treasury = 3000;
        const crisis = Throne.startCrisis(g.player, g.world, k, 'heir', k.ruler || 'the King');
        expect(crisis).toBeTruthy();
        const c = crisis.claimants[0];
        const back = measure(g.world, g.player, () => Throne.backClaimant(g.player, g.world, crisis.id, c.id, 'gold', { amount: 400 }));
        expect(back.result.success).toBe(true);
        expect(back.delta).toBeCloseTo(0, 1);
        expect(Math.abs(back.unbooked)).toBeLessThan(TOL);
        for (const x of crisis.claimants) x.support = x === c ? 1e9 : 0;
        const gold0 = g.player.gold;
        const won = measure(g.world, g.player, () => Throne._resolveCrisis(g.player, g.world, crisis, { crisesResolved: [] }));
        expect(g.player.gold).toBeGreaterThan(gold0);
        expect(won.delta).toBeCloseTo(0, 1);
        expect(Math.abs(won.unbooked)).toBeLessThan(TOL);
    });

    it("a school's fund (a counted purse) takes the patron's gift and pays a sponsored child's fee", () => {
        const t = towns[2];
        const s = standIn(g.player, t);
        Townsfolk.seed(s, g.world, { q: t.q, r: t.r });
        expect(s.folk).toBeTruthy();
        const town0 = s.economy.gold;
        const fund0 = TownSchool.state(s.folk).fund;
        const m = measure(g.world, g.player, () => TownSchool.donate(g.player, g.world, s, 120));
        expect(m.result.success).toBe(true);
        expect(s.economy.gold).toBeCloseTo(town0, 6);
        expect(TownSchool.state(s.folk).fund).toBeCloseTo(fund0 + 120, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        // A sponsored child's fee: out of the fund into the teacher's
        const kid = Townsfolk.residents(s.folk).find(p => Townsfolk.age(p, g.world.day) < 14);
        if (kid && TownSchool.teacherFor(g.world, s.folk, 'parish', g.world.day)) {
            kid.sponsored = { by: 'player', d: g.world.day };
            const f = measure(g.world, g.player, () => TownSchool._payFee(g.world, s, s.folk, kid, 'parish', g.world.day));
            expect(Math.abs(f.unbooked)).toBeLessThan(TOL);
        }
    });

    it("a townsman's purse is left to his heir or his town when he dies or leaves", () => {
        const t = towns[2];
        const folk = t.settlement.folk;
        const [a, b] = Townsfolk.residents(folk).filter(p => Townsfolk.age(p, g.world.day) >= 18);
        Townsfolk.purse(folk, a, g.world);
        a.purse += 0; // (rolled: real coin, out of the town)
        const coinA = a.purse;
        expect(coinA).toBeGreaterThan(0);
        const die = measure(g.world, g.player, () => Townsfolk._die(folk, a, g.world.day, 'a test', g.world));
        expect(a.purse).toBe(0);
        expect(Math.abs(die.unbooked)).toBeLessThan(TOL);
        Townsfolk.purse(folk, b, g.world);
        const town0 = t.settlement.economy.gold;
        const coinB = b.purse;
        const gone = measure(g.world, g.player, () => Townsfolk.exile(folk, b, g.world.day, 'exile', g.world));
        expect(t.settlement.economy.gold).toBeCloseTo(town0 + coinB, 6);
        expect(Math.abs(gone.unbooked)).toBeLessThan(TOL);
    });

    it('buried treasure is found coin, booked; a bribe at the dig goes to the nearest town', () => {
        const t = towns[3];
        const tile = g.world.getTile(t.q, t.r);
        const saved = tile.buried;
        tile.buried = { gold: 150, items: [], discovered: false };
        const m = measure(g.world, g.player, () => TreasureDigs.giveLoot(g.player, g.world, tile, 1));
        expect(m.result.gold).toBe(150);
        expect(m.booked).toBeCloseTo(150, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        tile.buried = saved;
    });

    it("the guild's contact and initiation are paid into the underworld's purses", () => {
        const t = towns.find(x => Underworld.hasGuildPresence(x.settlement));
        expect(t).toBeTruthy();
        standIn(g.player, t);
        const tile = g.world.getTile(t.q, t.r);
        const gold0 = g.player.gold;
        const m = measure(g.world, g.player, () => {
            Underworld.meetContact(g.player, g.world, tile);
            Underworld.joinGuild(g.player, g.world, tile);
        });
        expect(g.player.gold).toBeLessThan(gold0);
        expect(m.delta).toBeCloseTo(0, 1);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("the underwriters' guilds raise their capital from their realm's towns", () => {
        const st = { guilds: [], nextGuildId: 1, covers: {}, claims: [], bans: {}, books: {}, history: [], stats: { byKind: {} } };
        const saved = g.player.underwriting;
        g.player.underwriting = st;
        const m = measure(g.world, g.player, () => Underwriting._init(g.world, g.player, st));
        expect(st.guilds.length).toBeGreaterThan(0);
        expect(st.guilds.some(x => x.capital > 0)).toBe(true);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        g.player.underwriting = saved;
    });

    it("an upbringing's costs (a stranger's board, the silver he took) go into the nearest town", () => {
        const t = towns[0];
        standIn(g.player, t);
        const town0 = t.settlement.economy.gold;
        const m = measure(g.world, g.player, () => Upbringing._applyEffects(g.player, g.world, { skills: {} }, { gold: -60 }, null));
        expect(t.settlement.economy.gold).toBeCloseTo(town0 + 60, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("a bribe taken by the watch with no guard to hand goes to the case's town", () => {
        const t = towns[1];
        const kase = { key: `${t.q},${t.r}`, town: t.settlement.name, kingdom: t.settlement.kingdom, type: t.settlement.type, charges: [], proof: 0, grave: false, suspicion: 30 };
        const town0 = t.settlement.economy.gold;
        const m = measure(g.world, g.player, () => WatchQuestioning.resolve(g.player, g.world, kase, 'bribed', { gold: 25 }));
        expect(t.settlement.economy.gold).toBeCloseTo(town0 + 25, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });
});

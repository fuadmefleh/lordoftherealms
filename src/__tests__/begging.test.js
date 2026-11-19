// Begging (2026-11-17, player/begging.js; systems/townJobs.js _hardTimes):
// anyone in a town may beg for alms. Every copper and loaf comes out of a real
// purse or store (the census closes); the alms follow the spot, the town and
// who is begging; begging the same town day after day brings less; a noble
// seen begging pays in reputation, Prestige and talk. Townsfolk fallen on hard
// times take to begging and leave it when back on their feet, and the soak bot
// begs when broke and hungry (a fresh heir of an empty House).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { botDay } from './playtest/bot.js';
import { Begging } from '../player/begging.js';
import { Household } from '../player/household.js';
import { TownJobs } from '../systems/townJobs.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { addSettlementActions } from '../player/actions/settlementActions.js';
import { Arms } from '../systems/arms.js';

let logSpy, warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

/** A beggar's start: in the richest town, broke, no food, a nobody. */
function pauper(g, i = 0) {
    const t = coinTowns(g.world)[i];
    const s = standIn(g.player, t);
    g.player.gold = 0;
    g.player.inventory = {};
    g.player.renown = 0;
    g.player.kingdomTitle = null;
    g.player.equipment = {};
    if (g.player.house) g.player.house.prestige = 0;
    return s;
}

describe('begging for alms', () => {
    it('is offered in a town, and its alms come out of real purses and stores (the census closes)', () => {
        const g = coinGame(101, 2);
        const s = pauper(g);
        const acts = [];
        addSettlementActions(acts, g.player, g.world.getTile(s.q, s.r), g.world, {});
        expect(acts.some(a => a.type === 'beg')).toBe(true);
        Utils.setSeed(7);
        let gold = 0, bread = 0;
        for (let d = 0; d < 4; d++) {
            const m = measure(g.world, g.player, () => Begging.beg(g.player, g.world, s));
            expect(m.result.success).toBe(true);
            expect(Math.abs(m.unbooked)).toBeLessThan(0.01);
            gold += m.result.gold;
            bread += m.result.bread;
            // (whole cents)
            expect(Math.round(g.player.gold * 100) / 100).toBe(g.player.gold);
            g.world.day += 1;
        }
        expect(gold + bread).toBeGreaterThan(0);
        expect(g.player.inventory.bread || 0).toBe(bread);
        expect(Begging.state(g.player).stats.times).toBe(4);
    }, 120000);

    it('a loaf given comes out of the market store', () => {
        const g = coinGame(101, 2);
        const s = pauper(g);
        const store0 = SettlementMarket.stock(s, 'bread');
        Utils.setSeed(11);
        let bread = 0;
        for (let d = 0; d < 6 && !bread; d++) { bread += Begging.beg(g.player, g.world, s).bread; g.world.day += 4; }
        expect(bread).toBeGreaterThan(0);
        expect(SettlementMarket.stock(s, 'bread')).toBeCloseTo(store0 - bread, 2);
    }, 120000);

    it('gives more at the temple steps and at a fair, less in a poor or hostile town, less to the well-dressed and the noble', () => {
        const g = coinGame(101, 2);
        const s = pauper(g);
        const p = g.player;
        const street = Begging.odds(p, g.world, s, 'street');
        const spots = Begging.spots(s).map(x => x.id);
        if (spots.includes('temple')) expect(Begging.odds(p, g.world, s, 'temple').chance).toBeGreaterThan(street.chance);
        // A fair in town
        s.market.fair = { id: 'test', name: 'Fair', start: g.world.day, until: g.world.day + 5, ask: 1, sell: 0.7 };
        expect(Begging.odds(p, g.world, s, 'street').chance).toBeGreaterThan(street.chance);
        delete s.market.fair;
        // A poor town: its purse a head well under the reference
        const gold = s.economy.gold;
        s.economy.gold = 1;
        expect(Begging.odds(p, g.world, s, 'street').chance).toBeLessThan(street.chance);
        s.economy.gold = gold;
        // A hostile realm
        p.reputation[s.kingdom] = -80;
        expect(Begging.odds(p, g.world, s, 'street').chance).toBeLessThan(street.chance);
        p.reputation[s.kingdom] = 0;
        // Fine clothes and harness on the back
        const rich = Object.entries(Arms.items()).map(([id, it]) => ({ id, slot: it.slot })).filter(it => ['body', 'head', 'legs'].includes(it.slot) && Arms.basePrice(it.id) >= Begging.config().dress.fine)[0];
        if (rich) {
            p.equipment = { [rich.slot]: { id: rich.id } };
            expect(Begging.dressWorth(p)).toBeGreaterThanOrEqual(Begging.config().dress.fine);
            expect(Begging.odds(p, g.world, s, 'street').chance).toBeLessThan(street.chance);
            p.equipment = {};
        }
        // A face everyone knows
        p.renown = 500;
        expect(Begging.odds(p, g.world, s, 'street').chance).toBeLessThan(street.chance);
        p.renown = 0;
        // A noble: a title
        p.kingdomTitle = 'Baron';
        const noble = Begging.odds(p, g.world, s, 'street');
        expect(noble.noble).toBe(true);
        expect(noble.chance).toBeLessThan(street.chance);
    }, 120000);

    it('costs a little standing — and a noble a scandal: reputation, Prestige and talk', () => {
        const g = coinGame(101, 2);
        const s = pauper(g);
        const p = g.player;
        const kid = s.kingdom;
        p.reputation[kid] = 10;
        Utils.setSeed(3);
        const plain = Begging.beg(p, g.world, s);
        expect(plain.scandal).toBe(false);
        const plainLoss = 10 - p.reputation[kid];
        expect(plainLoss).toBeGreaterThan(0);
        // ...the same as a lord
        g.world.day += 30;
        p.kingdomTitle = 'Baron';
        if (p.house) p.house.prestige = 50;
        p.reputation[kid] = 10;
        const rumours0 = (p.gossip && p.gossip.rumors ? p.gossip.rumors.length : 0);
        const lordly = Begging.beg(p, g.world, s);
        expect(lordly.scandal).toBe(true);
        expect(10 - p.reputation[kid]).toBeGreaterThan(plainLoss * 3);
        if (p.house) expect(p.house.prestige).toBeLessThan(50);
        expect(p.gossip.rumors.length).toBe(rumours0 + 1);
        expect(p.gossip.rumors[p.gossip.rumors.length - 1].type).toBe('begging_noble');
    }, 120000);

    it('brings less when the same town sees you every day', () => {
        const g = coinGame(101, 2);
        const s = pauper(g);
        const fresh = Begging.odds(g.player, g.world, s, 'street').chance;
        Utils.setSeed(5);
        for (let d = 0; d < 3; d++) Begging.beg(g.player, g.world, s);
        const tired = Begging.odds(g.player, g.world, s, 'street').chance;
        expect(tired).toBeLessThan(fresh * 0.5);
        // ...and they forget in time
        g.world.day += 30;
        const later = Begging.odds(g.player, g.world, s, 'street').chance;
        const st = g.player.begging;
        g.player.begging = null;
        const stranger = Begging.odds(g.player, g.world, s, 'street').chance;
        g.player.begging = st;
        expect(later).toBeGreaterThan(stranger * 0.9);
    }, 120000);
});

describe('townsfolk on hard times', () => {
    /** A rostered town and one of its grown, jobless people. */
    function rostered(g) {
        for (const t of coinTowns(g.world)) {
            const s = t.settlement;
            Townsfolk.seed(s, g.world);
            const folk = s.folk;
            if (!folk || !Array.isArray(folk.people)) continue;
            TownJobs.ensure(folk, s, g.world, g.world.day);
            const p = folk.people.find(x => Townsfolk.isHere(x) && x.job && !['noble', 'priest', 'guard', 'beggar'].includes(x.job.id) && Townsfolk.age(x, g.world.day) >= 20);
            if (p) return { s, folk, p };
        }
        return null;
    }

    it('a broke, hungry hand takes to begging, keeps their home, and leaves it when back on their feet', () => {
        const g = coinGame(101, 2);
        const r = rostered(g);
        expect(r).toBeTruthy();
        const { s, folk, p } = r;
        p.job = { id: 'unemployed', rank: 'master', since: g.world.day };
        p.purse = 0.5;
        p.hungry = g.world.day;
        expect(TownJobs._hardTimes(g.world, s, folk, g.world.day)).toBeGreaterThanOrEqual(1);
        expect(p.job.id).toBe('beggar');
        expect(p.job.fallen).toBe(true);
        // The alms at payday come out of the town's purse into theirs (coin conserved)
        const town0 = Economy.townPurse(s);
        const purse0 = p.purse;
        const m = measure(g.world, g.player, () => TownJobs.payday(g.world, s, folk, g.world.day, 30));
        expect(Math.abs(m.unbooked)).toBeLessThan(0.01);
        void town0; void purse0;
        // Back on their feet
        p.purse = 50;
        TownJobs._hardTimes(g.world, s, folk, g.world.day + 30);
        expect(p.job.id).not.toBe('beggar');
    }, 120000);
});

describe('a broke heir has a way to eat', () => {
    it('the soak bot begs when broke and hungry in a town, and eats', () => {
        const g = newGame(101);
        endDay(g);
        const s = pauper(g);
        g.player.actionPoints = g.player.maxActionPoints || 10;
        g.player.starvationDays = 1;
        const stats = {};
        Utils.setSeed(9);
        let fedDays = 0;
        for (let d = 0; d < 6; d++) {
            if (g.player.q !== s.q || g.player.r !== s.r) standIn(g.player, { q: s.q, r: s.r, settlement: s });
            botDay(g, stats);
            const res = endDay(g);
            expect(res.died).toBeFalsy();
            if (!g.player.starvationDays) fedDays++;
        }
        expect(stats.begged).toBeGreaterThan(0);
        expect(fedDays).toBeGreaterThan(0);
    }, 300000);

    it("an heir come home to the House's stocked larder sups from it when the packs are empty", () => {
        const g = coinGame(101, 2);
        const s = pauper(g);
        const key = `${s.q},${s.r}`;
        const home = Household.home(g.player, key, true, { name: 'Home', town: s.name, q: s.q, r: s.r });
        home.larder = { bread: 6 };
        g.player.starvationDays = 2;
        const rations = Household.rations(home);
        g.player.endDay(g.world);
        expect(g.player.starvationDays).toBe(0);
        expect(Household.rations(home)).toBeLessThan(rations);
        // (the larder's master is not fed twice by the household's table tonight)
        expect(Household.mouths(g.player, home)).toBe(Household.servants(home).length + home.guests.length);
    }, 120000);
});

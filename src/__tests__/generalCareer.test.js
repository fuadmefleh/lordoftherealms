// A commission in a realm's army (player/generalship.js) and the General
// advanced start: the host is the realm's own men, wages leave the treasury,
// grain leaves a town's granary for coin into its purse, plunder leaves the
// plundered town, a taken town changes realm, the crown's favour and fear
// move rank, and a coup ends in a crown or in exile.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { Scenarios } from '../player/scenarios.js';
import { Generalship } from '../player/generalship.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Economy } from '../world/economy.js';
import { Throne } from '../systems/throne.js';
import { RealmWars } from '../systems/realmWars.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';

beforeAll(async () => {
    await loadData();
});

afterEach(() => {
    vi.restoreAllMocks();
});

function generalGame(seed) {
    const g = newGame(seed);
    const before = {};
    for (const k of g.world.kingdoms) before[k.id] = { military: k.military, treasury: k.treasury };
    const towns = {};
    for (const v of g.world.getSettlementViews()) {
        const s = g.world.getTile(v.q, v.r).settlement;
        if (s && !s.economy && s.population > 0) Economy.initSettlement(s);
        if (s && s.economy) towns[`${v.q},${v.r}`] = { food: s.economy.food, gold: s.economy.gold };
    }
    const report = Scenarios.apply(g.player, g.world, { origin: 'general' });
    return { g, report, before, towns };
}

/** Two living realms put at war, the player commissioned in the first. */
function atWar(g, rank = 0) {
    const w = g.world;
    const realms = w.kingdoms.filter(k => k.isAlive !== false && Economy.realmTowns(k, w).length >= 2);
    const [a, b] = realms;
    if (!(a.wars || []).includes(b.id)) KingdomAI.startWar(a, b, w);
    a.military = Math.max(a.military, 2000);
    b.military = Math.max(b.military, 2000);
    a.treasury = Math.max(a.treasury || 0, 5000);
    g.player.reputation = g.player.reputation || {};
    const c = Generalship._grant(g.player, w, a, { rank, favour: 50, morale: 60 });
    return { a, b, c };
}

describe('the General start', () => {
    it('is offered among the advanced starts', () => {
        const adv = Scenarios.choices().origins.filter(o => o.group === 'advanced').map(o => o.id);
        expect(adv).toContain('general');
    });

    it('commands a share of a real realm\'s army, fed from a real granary, with orders', () => {
        const { g, report, before, towns } = generalGame(201);
        const p = g.player;
        const c = Generalship.state(p);
        expect(c).toBeTruthy();
        const k = g.world.getKingdom(c.kingdomId);
        expect(Generalship.rankDef(c).id).toBe('general');
        expect(p.allegiance).toBe(k.id);
        // The host is the realm's own men: a share of its army, nothing minted
        expect(c.men).toBe(Generalship.targetMen(c, k));
        expect(k.military).toBe(before[k.id].military);
        expect(c.men).toBeGreaterThan(0);
        // Grain from the camp town's granary, the crown paying its purse
        const camp = g.world.getTile(p.q, p.r).settlement;
        expect(camp.kingdom).toBe(k.id);
        const was = towns[`${p.q},${p.r}`];
        expect(c.supplies).toBeGreaterThan(0);
        expect(camp.economy.food).toBeCloseTo(was.food - c.supplies, 1);
        const paid = before[k.id].treasury - k.treasury;
        expect(paid).toBeGreaterThan(0);
        expect(camp.economy.gold).toBeCloseTo(was.gold + paid, 1);
        expect(c.lieutenants.length).toBe(3);
        expect(c.rival).toBeTruthy();
        expect(c.order).toBeTruthy();
        expect(p.scenario.start.kind).toBe('general');
        expect(report.welcome).not.toMatch(/\{\w+\}/);
        expect(p.title).toMatch(/^General of /);
    }, 60000);

    it('survives save and load, and the days run on', () => {
        const { g } = generalGame(202);
        for (let d = 0; d < 3; d++) endDay(g);
        const c = Generalship.state(g.player);
        expect(c).toBeTruthy();
        const back = roundTrip(g);
        const c2 = Generalship.state(back.player);
        expect(c2.kingdomId).toBe(c.kingdomId);
        expect(c2.rank).toBe(c.rank);
        expect(c2.lieutenants.length).toBe(c.lieutenants.length);
        endDay(back);
        expect(Generalship.state(back.player)).toBeTruthy();
    }, 120000);
});

describe('seeking a commission', () => {
    it('is granted at a capital to a known soldier, not to a stranger', () => {
        const g = newGame(203);
        const p = g.player;
        const k = g.world.kingdoms.find(x => x.isAlive !== false && x.capital);
        const tile = g.world.getTile(k.capital.q, k.capital.r);
        p.skills = { ...(p.skills || {}), combat: 0, leadership: 0 };
        p.renown = 0;
        expect(Generalship.seek(p, g.world, tile).success).toBe(false);
        p.skills.combat = 3; p.skills.leadership = 2; p.renown = 20;
        p.q = tile.q; p.r = tile.r;
        const res = Generalship.seek(p, g.world, tile);
        expect(res.success).toBe(true);
        const c = Generalship.state(p);
        expect(Generalship.rankDef(c).id).toBe('captain');
        expect(p.allegiance).toBe(k.id);
        // Sworn elsewhere: no second commission
        expect(Generalship.seek(p, g.world, tile).success).toBe(false);
    }, 60000);
});

describe('wages and supplies', () => {
    it('wages leave the crown\'s treasury; an empty treasury owes them', () => {
        const g = newGame(204);
        const { a, c } = atWar(g, 1);
        const w = g.world;
        const p = g.player;
        const gold0 = p.gold;
        const t0 = a.treasury;
        for (let i = 1; i <= 7; i++) { w.day += 1; Generalship.processDay(p, w); }
        const paid = p.gold - gold0;
        expect(paid).toBeGreaterThan(0);
        expect(Math.round(t0 - a.treasury)).toBeGreaterThanOrEqual(Math.round(paid));
        // Broke crown: the wage is owed
        a.treasury = 0;
        const g1 = p.gold;
        for (let i = 1; i <= 7; i++) { w.day += 1; Generalship.processDay(p, w); }
        expect(p.gold).toBeLessThanOrEqual(g1);
        expect(c.owed).toBeGreaterThan(0);
    }, 60000);

    it('a host without bread deserts, and the realm loses the men', () => {
        const g = newGame(205);
        const { a, c } = atWar(g, 1);
        const w = g.world;
        // Far from any of its towns: no supply line
        let far = null;
        for (let q = 0; q < w.width && !far; q++) for (let r = 0; r < w.height && !far; r++) {
            if (Economy.realmTowns(a, w).every(t => Hex.wrappingDistance(q, r, t.q, t.r, w.width) > 6)) far = { q, r };
        }
        g.player.q = far.q; g.player.r = far.r;
        c.supplies = 0;
        const men = c.men;
        const mil = a.military;
        w.day += 1;
        const out = Generalship.processDay(g.player, w);
        expect(out.notices.some(n => n.title === 'The Host Goes Hungry')).toBe(true);
        expect(a.military).toBeLessThan(mil);
        expect(c.men).toBeLessThan(men + Math.ceil((Generalship.targetMen(c, a) - men) * 0.1) + 1);
    }, 60000);
});

describe('war', () => {
    it('a battle\'s dead are the realms\' dead (the battle hook)', () => {
        const g = newGame(206);
        const { a, b, c } = atWar(g, 2);
        const w = g.world;
        const near = b.territory[0];
        g.player.q = near.q; g.player.r = near.r;
        const prep = Generalship.prepareBattle(g.player, w, 'field', { enemyId: b.id });
        expect(prep.spec).toBeTruthy();
        expect(prep.spec.host.men).toBe(c.men);
        expect(prep.spec.enemy.kingdomId).toBe(b.id);
        expect(prep.spec.odds).toBeGreaterThan(0);
        const am = a.military;
        const bm = b.military;
        const res = Generalship.settleBattle(g.player, w, prep.spec, { victory: true, hostLost: 10, enemyLost: 40, retinueLost: 0 });
        expect(res.victory).toBe(true);
        expect(a.military).toBe(am - 10);
        expect(b.military).toBe(bm - 40);
        expect(c.record.battlesWon).toBe(1);
        // The day after, no second battle on the same day
        expect(Generalship.giveBattle(g.player, w, b.id).success).toBe(false);
    }, 60000);

    it('a besieged town that falls passes to the liege; the sack\'s coin comes out of its purse', () => {
        const g = newGame(207);
        const { a, b, c } = atWar(g, 2);
        const w = g.world;
        const t = Economy.realmTowns(b, w).find(x => !(b.capital && b.capital.q === x.q && b.capital.r === x.r)) || Economy.realmTowns(b, w)[0];
        g.player.q = t.q; g.player.r = t.r;
        Economy.initSettlement(t.settlement);
        t.settlement.economy.gold = 1000;
        const res = Generalship.besiege(g.player, w, 'sack');
        expect(res.success).toBe(true);
        c.siege.progress = 99;
        const gold0 = g.player.gold;
        const tr0 = a.treasury;
        w.day += 1;
        const out = Generalship.processDay(g.player, w);
        expect(out.notices.some(n => n.title === 'Town Surrenders')).toBe(true);
        expect(t.settlement.kingdom).toBe(a.id);
        expect(w.getTile(t.q, t.r).kingdom).toBe(a.id);
        const taken = 1000 - t.settlement.economy.gold;
        expect(taken).toBeGreaterThan(0);
        const mine = g.player.gold - gold0;
        expect(mine).toBeGreaterThan(0);
        expect(mine).toBeLessThan(taken);
        expect(a.treasury).toBeGreaterThan(tr0 - 200); // the crown's share came in (less the week's wages at most)
        expect(c.record.townsTaken).toBe(1);
    }, 60000);

    it('the realm fights better with its general at the front, and only then', () => {
        const g = newGame(208);
        const { a, b } = atWar(g, 3);
        const w = g.world;
        g.player.q = b.territory[0].q; g.player.r = b.territory[0].r;
        Generalship.state(g.player).supplies = 1000;
        w.day += 1;
        Generalship.processDay(g.player, w);
        expect(KingdomAI.fieldCommandMult(a, w)).toBeGreaterThan(1);
        // A stale record (the general gone) counts for nothing
        w.day += 5;
        expect(KingdomAI.fieldCommandMult(a, w)).toBe(1);
    }, 60000);
});

describe('rank and the court', () => {
    it('merit and favour bring promotion; lost favour brings dismissal', () => {
        const g = newGame(209);
        const { a, c } = atWar(g, 0);
        const w = g.world;
        c.merit = 40;
        c.favour = 60;
        w.day = Math.ceil((w.day + 1) / 7) * 7;
        // Not before a rank has been held a while
        Generalship.processDay(g.player, w);
        expect(Generalship.rankDef(c).id).toBe('captain');
        c.rankSince = w.day - 60;
        w.day += 7;
        Generalship.processDay(g.player, w);
        expect(Generalship.rankDef(c).id).toBe('commander');
        // Favour gone: demoted, then dismissed
        c.favour = 5;
        w.day += 1;
        Generalship.processDay(g.player, w);
        expect(Generalship.state(g.player).rank).toBe(0);
        Generalship.state(g.player).favour = 3;
        w.day += 1;
        const out = Generalship.processDay(g.player, w);
        expect(Generalship.state(g.player)).toBeNull();
        expect(out.notices.some(n => n.title === 'Dismissed')).toBe(true);
        expect(g.player.commissionPast[0].how).toBe('dismissed');
        expect(a.fieldCommand).toBeUndefined();
    }, 60000);

    it('a coup that succeeds crowns the general', () => {
        const g = newGame(210);
        const { a, c } = atWar(g, 2);
        const w = g.world;
        g.player.q = a.capital.q; g.player.r = a.capital.r;
        c.morale = 90;
        for (const lt of c.lieutenants) lt.loyalty = 90;
        const odds = Generalship.coupOdds(g.player, w);
        expect(odds.ok).toBe(true);
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        const res = Generalship.stageCoup(g.player, w);
        expect(res.crowned).toBe(true);
        expect(Throne.ruledKingdom(g.player, w).id).toBe(a.id);
        expect(Generalship.state(g.player)).toBeNull();
    }, 60000);

    it('a coup that fails is exile and war', () => {
        const g = newGame(211);
        const { a, c } = atWar(g, 2);
        const w = g.world;
        g.player.q = a.capital.q; g.player.r = a.capital.r;
        c.morale = 90;
        const mil = a.military;
        vi.spyOn(Utils, 'random').mockReturnValue(0.999);
        const res = Generalship.stageCoup(g.player, w);
        expect(res.failed).toBe(true);
        expect(a.military).toBeLessThan(mil);
        expect(Throne.isExiledFrom(g.player, w, a.id)).toBe(true);
        expect(RealmWars.atWarWith(g.player, a.id)).toBe(true);
        expect(g.player.allegiance).toBeNull();
    }, 60000);

    it('a commission is not inherited', () => {
        const g = newGame(212);
        atWar(g, 1);
        g.player.name = 'Someone Else';
        g.world.day += 1;
        Generalship.processDay(g.player, g.world);
        expect(Generalship.state(g.player)).toBeNull();
    }, 60000);
});

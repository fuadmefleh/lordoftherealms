// A playable regency (systems/regency.js): an under-age heir takes up the
// mantle and keeps their age; a regent (the widowed spouse, a grown sibling or
// a council lord) rules in their name — loyal, skimming or plotting. The
// child's court can win the regent over, put them aside or assert majority
// early; no war or siege while a regent rules. At majority a choice: keep,
// purge or reward the regent's men. Saved; drawn from its own RNG stream.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { House } from '../systems/house.js';
import { Regency } from '../systems/regency.js';
import { HeirAgency } from '../systems/heirAgency.js';
import { Upbringing } from '../systems/upbringing.js';
import { Relationships } from '../systems/relationships.js';
import { Councils } from '../systems/councils.js';
import { Sieges } from '../systems/sieges.js';
import { Ledger } from '../systems/ledger.js';
import { Player } from '../player/player.js';
import { loadData, newGame, roundTrip, endDay } from './playtest/harness.js';

let baseRegency;
beforeAll(async () => {
    await loadData();
    baseRegency = JSON.parse(JSON.stringify(DataLoader.upbringing.regency));
});
afterEach(() => {
    DataLoader.upbringing.regency = JSON.parse(JSON.stringify(baseRegency));
});

function makeWorld(day = 100) {
    const world = {
        day, width: 30, height: 20, units: [], events: [], generationParams: { seed: 31 },
        kingdoms: [{ id: 'k1', name: 'Arvenland', isAlive: true, treasury: 5000, wars: [], allies: [], relations: {}, culture: 'Imperial', territory: [], lord: { name: 'Queen Maud', kingdomId: 'k1', traits: [] } }],
        getTile: () => null,
        getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
        getSettlementViews: () => [],
        getAllSettlements: () => [],
    };
    return world;
}

let nextId = 1;
function child(extra = {}) {
    const c = {
        id: `rg_${nextId++}`, firstName: 'Wynn', dynasty: 'Vane', gender: 'male', age: 10, isAlive: true, traits: [],
        strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    if (c.age >= 16) c.upbringing.comeOfAge = true;
    return c;
}

function makeDyingRuler(world, kids) {
    const p = new Player();
    p.firstName = 'Old';
    p.lastName = 'Vane';
    p.name = 'Old Vane';
    p.age = 60;
    p.gold = 2000;
    p.allegiance = 'k1'; // (a council regent answers to this crown: what he takes goes to its treasury)
    p.relationships = {};
    p.reputation = {};
    p.children = kids;
    House.initialize(p, world);
    p.house.prestige = 40;
    return p;
}

/** A regency in progress, without a succession (unit tests of the weekly tick). */
function regencyOf(world, regent, extra = {}) {
    const p = makeDyingRuler(world, []);
    p.age = 10;
    p.firstName = 'Wynn';
    Regency.begin(p, world, { kind: 'council', id: 'council:x', name: 'Lord Tench', loyalty: 55, ambition: 40, ...regent });
    Object.assign(p, extra);
    return p;
}

function weeks(p, world, n) {
    const out = [];
    for (let i = 0; i < n * 7; i++) {
        world.day++;
        out.push(...Regency.processDay(p, world).notices);
    }
    return out;
}

describe('a child takes up the mantle', () => {
    it('keeps their age and reigns under the regent chosen from the late ruler\'s household', () => {
        const world = makeWorld();
        const heir = child({ age: 10 });
        const elder = child({ age: 19, firstName: 'Ada', gender: 'female' });
        const p = makeDyingRuler(world, [heir, elder]);
        const sp = Relationships.generateNPC({ name: 'Arvenhold', kingdom: 'k1' }, world);
        sp.firstName = 'Mirel';
        p.spouse = sp.id;
        const cands = Regency.candidates(p, world, heir.id);
        expect(cands.map(c => c.kind)).toEqual(['spouse', 'sibling', 'council']);
        const res = Relationships.succeedAsHeir(p, heir.id, world, { regency: true, regent: elder.id });
        expect(res.success).toBe(true);
        expect(p.age).toBe(10);
        expect(Regency.active(p)).toBe(true);
        expect(p.regency.regent.kind).toBe('sibling');
        expect(p.regency.regent.name).toMatch(/Ada/);
        expect(res.house.regency).toBe(true); // the existing fragmentation path still applies
        expect(p.house.history.some(h => (h.tags || []).includes('regency'))).toBe(true);
    });

    it('a minor heir without a regency is still refused', () => {
        const world = makeWorld();
        const heir = child({ age: 9 });
        const p = makeDyingRuler(world, [heir]);
        expect(Relationships.succeedAsHeir(p, heir.id, world, {}).success).toBe(false);
    });

    it('an adult heir clears an old regency record', () => {
        const world = makeWorld();
        const heir = child({ age: 20 });
        const p = makeDyingRuler(world, [heir]);
        p.regency = { active: false, done: true, regent: { name: 'x' } };
        Relationships.succeedAsHeir(p, heir.id, world, {});
        expect(p.regency).toBeNull();
    });
});

describe('the limits of a child ruler', () => {
    it('no war declared, no siege laid; the company fights under the regent\'s captains', () => {
        const world = makeWorld();
        const p = regencyOf(world, {});
        expect(Regency.forbids(p, 'war')).toMatch(/not of age/);
        const war = Councils.declareWar(p, world, 'k1');
        expect(war.success).toBe(false);
        expect(war.reason).toMatch(/not of age/);
        const siege = Sieges.canInvest(p, world, { q: 1, r: 1, settlement: { name: 'Keep', kingdom: 'k1' } });
        expect(siege.ok).toBe(false);
        expect(siege.reason).toMatch(/not of age/);
        expect(HeirAgency.commandMultiplier(p)).toBe(HeirAgency.config().regencyBattleMult);
        // One of the blood can lead the company instead
        const sis = child({ age: 18, gender: 'female' });
        p.children = [sis];
        HeirAgency.giveCommand(p, world, sis.id);
        expect(HeirAgency.commandMultiplier(p)).toBe(1);
    });
});

describe('the regent', () => {
    it('a loyal regent keeps the books honest', () => {
        const world = makeWorld();
        const p = regencyOf(world, { kind: 'spouse', loyalty: 80, ambition: 10 });
        const gold = p.gold;
        weeks(p, world, 8);
        expect(p.gold).toBe(gold);
        expect(p.regency.embezzled).toBe(0);
    });

    it('a disloyal regent skims the treasury (on the ledger), and an ambitious one plots a coup', () => {
        const world = makeWorld();
        // A council lord the House cannot command: loyalty settles low
        DataLoader.upbringing.regency.baseLoyalty = { ...baseRegency.baseLoyalty, council: 10 };
        const p = regencyOf(world, { loyalty: 10, ambition: 90 });
        p.house.prestige = 0;
        p.currentTitle = 'baron';
        const notices = weeks(p, world, 12);
        expect(p.regency.embezzled).toBeGreaterThan(0);
        expect(notices.some(n => /Plot/.test(n.title))).toBe(true);
        expect(notices.some(n => /Coup/.test(n.title))).toBe(true);
        expect(p.regency.coups).toBeGreaterThanOrEqual(1);
        expect(p.currentTitle).toBeNull();
    });

    it('what a council regent skims and carries off in a coup goes to the crown he answers to; coin conserved', () => {
        const world = makeWorld();
        DataLoader.upbringing.regency.baseLoyalty = { ...baseRegency.baseLoyalty, council: 10 };
        const p = regencyOf(world, { loyalty: 10, ambition: 90 });
        p.house.prestige = 0;
        p.house.rivals = {}; // (no rival claimant: the coup's fragmentation skims no coin)
        const k = world.kingdoms[0];
        const before = p.gold + k.treasury;
        weeks(p, world, 12);
        expect(p.regency.coups).toBeGreaterThanOrEqual(1);
        expect(p.gold).toBeLessThan(2000);
        expect(p.gold + k.treasury).toBe(before);
        // Putting the exposed plotter aside takes part of it back, out of that same treasury
        p.regency.rumoured = true;
        p.house.prestige = 100;
        const res = Regency.replace(p, world);
        expect(res.success).toBe(true);
        expect(res.recovered).toBeGreaterThan(0);
        expect(p.gold + k.treasury).toBe(before);
    });

    it("a widowed regent's coup carries the gold into their own purse; gifts go there too", () => {
        const world = makeWorld();
        const sp = Relationships.generateNPC({ name: 'Arvenhold', kingdom: 'k1' }, world);
        sp.purse = 10;
        const p = regencyOf(world, { kind: 'spouse', id: sp.id, name: sp.firstName, loyalty: 50, ambition: 50 });
        p.house.rivals = {};
        const before = p.gold + sp.purse;
        Regency._coup(p, world, p.regency, { notices: [] });
        expect(sp.purse).toBeGreaterThan(10);
        expect(p.gold + sp.purse).toBe(before);
        expect(Regency.favour(p, world, 'gift').success).toBe(true);
        expect(p.gold + sp.purse).toBe(before);
    });

    it('records the skimming in the Ledger under the regency', () => {
        const world = makeWorld();
        const p = regencyOf(world, { loyalty: 5, ambition: 20 });
        world.day += 6;
        weeks(p, world, 1);
        expect(Ledger.today(p).expenses.regency).toBeGreaterThan(0);
    });

    it('gifts and honours win the regent over; an exposed plotter is put aside cheaply, with gold recovered', () => {
        const world = makeWorld();
        const p = regencyOf(world, { loyalty: 30, ambition: 70 });
        const r = p.regency.regent;
        expect(Regency.favour(p, world, 'gift').success).toBe(true);
        expect(r.loyalty).toBe(30 + baseRegency.giftLoyalty);
        expect(Regency.favour(p, world, 'honour').success).toBe(true);
        expect(r.ambition).toBe(70 + baseRegency.honourAmbition);
        p.regency.rumoured = true;
        p.regency.embezzled = 300;
        const gold = p.gold;
        const prestige = p.house.prestige;
        const res = Regency.replace(p, world);
        expect(res.success).toBe(true);
        expect(res.recovered).toBe(150);
        expect(p.gold).toBe(gold + 150);
        expect(p.house.prestige).toBe(prestige - baseRegency.replaceExposedPrestige);
        expect(p.regency.regent.kind).toBe('council');
        expect(p.regency.rumoured).toBe(false);
    });

    it('a regent who dies is succeeded by the council', () => {
        const world = makeWorld();
        const sis = child({ age: 20, gender: 'female' });
        const p = regencyOf(world, { kind: 'sibling', id: sis.id, name: 'Ada' }, { children: [sis] });
        sis.isAlive = false;
        const n = Regency.processDay(p, world).notices;
        expect(n[0].title).toMatch(/New Regent/);
        expect(p.regency.regent.kind).toBe('council');
    });

    it('draws nothing from the shared RNG stream', () => {
        const world = makeWorld();
        const p = regencyOf(world, { loyalty: 20, ambition: 80 });
        Utils.setSeed(8);
        const expected = Utils.random();
        Utils.setSeed(8);
        weeks(p, world, 6);
        expect(Utils.random()).toBe(expected);
    });
});

describe('majority', () => {
    it('ends the regency at sixteen with a choice; purge recovers what was skimmed', () => {
        const world = makeWorld();
        const p = regencyOf(world, { loyalty: 30 });
        p.regency.embezzled = 200;
        p.regency.rumoured = true;
        p.age = 16;
        const n = Regency.processDay(p, world).notices;
        expect(n[0].title).toMatch(/Come of Age/);
        expect(Regency.active(p)).toBe(false);
        expect(Regency.endingPending(p)).toBe(true);
        expect(Regency.forbids(p, 'war')).toBeNull();
        expect(Regency.endingChoices(p).map(c => c.id)).toEqual(['keep', 'purge', 'reward']);
        const gold = p.gold;
        const prestige = p.house.prestige;
        const res = Regency.resolveEnding(p, world, 'purge');
        expect(res.success).toBe(true);
        expect(p.gold).toBe(gold + 100);
        expect(p.house.prestige).toBe(prestige + baseRegency.purgePlotterPrestige);
        expect(Regency.endingPending(p)).toBe(false);
        expect(p.regency.resolved.choice).toBe('purge');
    });

    it('rewarding the regent raises the officers\' loyalty; keeping a loyal one teaches diplomacy', () => {
        const world = makeWorld();
        const p = regencyOf(world, { loyalty: 80 });
        p.house.roleLoyalty = { someone: 50 };
        p.age = 16;
        Regency.processDay(p, world);
        expect(Regency.resolveEnding(p, world, 'reward').success).toBe(true);
        expect(p.house.roleLoyalty.someone).toBe(50 + baseRegency.rewardRoleLoyalty);

        const q = regencyOf(world, { loyalty: 80 });
        q.age = 16;
        q.skills = { diplomacy: 2 };
        Regency.processDay(q, world);
        Regency.resolveEnding(q, world, 'keep');
        expect(q.skills.diplomacy).toBe(3);
    });

    it('left unanswered, the regent\'s men stay', () => {
        const world = makeWorld();
        const p = regencyOf(world, { loyalty: 70 });
        p.age = 16;
        Regency.processDay(p, world);
        world.day += baseRegency.endingDays;
        Regency.processDay(p, world);
        expect(p.regency.resolved).toEqual({ choice: 'keep', day: world.day, lapsed: true });
    });

    it('may be asserted early, for Prestige', () => {
        const world = makeWorld();
        const p = regencyOf(world, {});
        p.age = 12;
        expect(Regency.assertMajority(p, world).success).toBe(false);
        p.age = 14;
        const prestige = p.house.prestige;
        expect(Regency.assertMajority(p, world).success).toBe(true);
        expect(p.house.prestige).toBe(prestige - baseRegency.earlyMajorityPrestige);
        expect(Regency.endingPending(p)).toBe(true);
    });
});

describe('saving', () => {
    it('the regency survives a save, and older saves backfill to none', () => {
        const game = newGame(4243);
        Regency.begin(game.player, game.world, { kind: 'council', id: 'council:x', name: 'Lord Tench', loyalty: 33, ambition: 61 });
        game.player.regency.embezzled = 77;
        const g2 = roundTrip(game);
        expect(g2.player.regency.active).toBe(true);
        expect(g2.player.regency.regent.loyalty).toBe(33);
        expect(g2.player.regency.embezzled).toBe(77);
        const legacy = new Player();
        delete legacy.regency;
        Regency.loadState(legacy);
        expect(legacy.regency).toBeNull();
    });

    it('the daily harness runs the regency tick', () => {
        const game = newGame(4244);
        Regency.begin(game.player, game.world, { kind: 'council', id: 'council:y', name: 'Lady Hale', loyalty: 10, ambition: 80 });
        game.player.age = 10;
        for (let i = 0; i < 14; i++) endDay(game);
        expect(game.player.regency.regent.loyalty).not.toBe(10);
    });
});

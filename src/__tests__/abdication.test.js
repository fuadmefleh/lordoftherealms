// Abdication & retirement (systems/abdication.js): the ruler steps down while
// alive; the player goes on as the heir and the old ruler lives on as an NPC
// elder — a pension in real coin, respect and ambition, favourites, counsel,
// plots and the power behind the throne, a monastery, old age and death. The
// court's pressure brings a demand and, unanswered, a forced abdication.
// Saved; drawn from its own RNG stream.

import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { House } from '../systems/house.js';
import { Abdication } from '../systems/abdication.js';
import { Regency } from '../systems/regency.js';
import { Upbringing } from '../systems/upbringing.js';
import { Relationships } from '../systems/relationships.js';
import { Counsel } from '../systems/counsel.js';
import { Annals } from '../systems/annals.js';
import { Legacy } from '../systems/legacy.js';
import { DynastyTree } from '../systems/dynastyTree.js';
import { Player } from '../player/player.js';
import { loadData, newGame, roundTrip, endDay } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

function makeWorld(day = 120) {
    const town = { name: 'Arvenhold', q: 5, r: 5, kingdom: 'k1', type: 'town', population: 400, economy: { gold: 1000 } };
    const world = {
        day, width: 30, height: 20, units: [], events: [], generationParams: { seed: 77 },
        kingdoms: [{ id: 'k1', name: 'Arvenland', isAlive: true, treasury: 5000, stability: 50, wars: [], allies: [], relations: {}, culture: 'Imperial', territory: [] }],
        getTile: (q, r) => (q === 5 && r === 5 ? { q, r, settlement: town } : null),
        getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
        getSettlementViews: () => [{ q: 5, r: 5, name: 'Arvenhold' }],
        getAllSettlements: () => [town],
        town,
    };
    return world;
}

let nextId = 1;
function child(extra = {}) {
    const c = {
        id: `ab_${nextId++}`, firstName: 'Wynn', dynasty: 'Vane', gender: 'male', age: 20, isAlive: true, traits: [],
        strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    if (c.age >= 16) c.upbringing.comeOfAge = true;
    return c;
}

function makeRuler(world, kids) {
    const p = new Player();
    p.firstName = 'Aldric';
    p.lastName = 'Vane';
    p.name = 'Aldric Vane';
    p.gender = 'male';
    p.age = 58;
    p.maxLifespan = 75;
    p.gold = 3000;
    p.q = 5;
    p.r = 5;
    p.allegiance = 'k1';
    p.relationships = {};
    p.reputation = { k1: 50 };
    p.renown = 100;
    p.skills = { commerce: 6, combat: 4, leadership: 7, diplomacy: 9, stealth: 2, cartography: 0 };
    p.children = kids;
    House.initialize(p, world);
    p.house.prestige = 50;
    Legacy.openReign(p, world);
    return p;
}

/** All the coin the abdication touches: the purse, the elders', the children's, the town's, the crown's. */
function coinTotal(p, world) {
    const elders = Abdication.state(p).elders.reduce((s, e) => s + (Relationships.getNPC(e.npcId)?.purse || 0), 0);
    const kids = (p.children || []).reduce((s, c) => s + (c.purse || 0), 0);
    const court = (p.house.court || []).reduce((s, e) => s + (Relationships.getNPC(e.npcId)?.purse || 0), 0);
    return Math.round((p.gold + elders + kids + court + world.town.economy.gold + world.kingdoms[0].treasury) * 100) / 100;
}

function days(p, world, n) {
    const notices = [];
    let abdicated = null;
    for (let i = 0; i < n; i++) {
        world.day++;
        const out = Abdication.processDay(p, world);
        notices.push(...out.notices);
        if (out.abdicated) abdicated = out.abdicated;
    }
    return { notices, abdicated };
}

describe('stepping down', () => {
    it('the heir becomes the player; the old ruler lives on as an NPC elder', () => {
        Utils.setSeed(11);
        const world = makeWorld();
        const heir = child({ firstName: 'Bryn', age: 24 });
        const p = makeRuler(world, [heir, child({ firstName: 'Cass', age: 19 })]);
        const before = coinTotal(p, world);
        const res = Abdication.abdicate(p, world, { childId: heir.id, residence: 'court' });
        expect(res.success).toBe(true);
        expect(p.firstName).toBe('Bryn');
        expect(p.age).toBe(24);
        const e = Abdication.elders(p)[0];
        const npc = Relationships.getNPC(e.npcId);
        expect(npc.firstName).toBe('Aldric');
        expect(npc.age).toBe(58);
        expect(npc.elder).toBe(true);
        expect(npc.isAlive).toBe(true);
        // The endowment came out of the purse into theirs: the rest passed whole (no heriot)
        expect(npc.purse).toBe(300);
        expect(p.gold).toBe(2700);
        expect(coinTotal(p, world)).toBe(before);
        // The reign is closed as an abdication, not a death; the tree keeps them living
        const reign = p.house.reigns[p.house.reigns.length - 1];
        expect(reign.abdicated.how).toBe('voluntary');
        expect(reign.cause).toBeNull();
        DynastyTree.sync(p, world, { npc: id => Relationships.getNPC(id) });
        const rec = p.house.lineage.people[e.treeId];
        expect(rec.alive).toBe(true);
        expect(rec.abdicated).toBe(world.day);
        expect(p.house.lineage.currentId).not.toBe(e.treeId);
        expect(Annals.reignFacts(world, reign).fallback).toMatch(/stepped down/);
        expect(p.house.history.some(h => (h.tags || []).includes('abdication'))).toBe(true);
        // Renown kept better than at a death
        expect(p.renown).toBe(80);
    });

    it('passing over the rightful heir costs Prestige and leaves a claim', () => {
        const world = makeWorld();
        const eldest = child({ firstName: 'Eda', age: 30 });
        const younger = child({ firstName: 'Fen', age: 20 });
        const p = makeRuler(world, [eldest, younger]);
        expect(Abdication.rightfulHeirId(p)).toBe(eldest.id);
        const res = Abdication.abdicate(p, world, { childId: younger.id });
        expect(res.success).toBe(true);
        expect(p.firstName).toBe('Fen');
        expect(Abdication.elders(p)[0].passedOver).toBe(true);
    });

    it('a minor heir reigns under the old ruler as regent', () => {
        const world = makeWorld();
        const kid = child({ firstName: 'Gil', age: 9 });
        const p = makeRuler(world, [kid]);
        const res = Abdication.abdicate(p, world, { childId: kid.id, regent: 'elder', residence: 'court' });
        expect(res.success).toBe(true);
        expect(p.age).toBe(9);
        expect(Regency.active(p)).toBe(true);
        expect(p.regency.regent.kind).toBe('elder');
        expect(p.regency.regent.id).toBe(Abdication.elders(p)[0].npcId);
    });

    it('is refused without a child, and under a regency', () => {
        const world = makeWorld();
        const p = makeRuler(world, []);
        expect(Abdication.abdicate(p, world, {}).success).toBe(false);
    });
});

describe('the elder lives on', () => {
    it('the pension moves real coin, and the elder spends their keep in their town', () => {
        Utils.setSeed(5);
        const world = makeWorld();
        const p = makeRuler(world, [child({ age: 22 }), child({ age: 18, firstName: 'Ivo' })]);
        Abdication.abdicate(p, world, { residence: 'estate', pension: 8 });
        const total = coinTotal(p, world);
        const e = Abdication.elders(p)[0];
        const gold = p.gold;
        const townGold = world.town.economy.gold;
        days(p, world, 30);
        expect(e.paid).toBe(240);
        expect(p.gold).toBe(gold - 240);
        expect(world.town.economy.gold).toBeGreaterThan(townGold);
        expect(coinTotal(p, world)).toBe(total);
    });

    it('an unpaid pension is owed and sours them', () => {
        const world = makeWorld();
        const p = makeRuler(world, [child({ age: 22 })]);
        Abdication.abdicate(p, world, { residence: 'court', pension: 15 });
        p.gold = 0;
        const e = Abdication.elders(p)[0];
        const r0 = e.respect;
        days(p, world, 60);
        expect(e.owed).toBe(900);
        expect(e.respect).toBeLessThan(r0);
    });

    it('a disrespected, ambitious elder plots, rules from behind the seat, and is cloistered', () => {
        Utils.setSeed(9);
        const world = makeWorld();
        const p = makeRuler(world, [child({ age: 22 })]);
        Abdication.abdicate(p, world, { residence: 'court', pension: 0 });
        const e = Abdication.elders(p)[0];
        e.respect = 5;
        e.ambition = 90;
        e.how = 'forced'; // (their respect will not climb back)
        const total = coinTotal(p, world);
        const { notices } = days(p, world, 7 * 12);
        expect(e.rumoured || e.shadows > 0).toBe(true);
        expect(notices.some(n => /Power Behind the Throne/.test(n.title))).toBe(true);
        expect(e.skimmed).toBeGreaterThan(0);
        expect(coinTotal(p, world)).toBe(total);
        const res = Abdication.setResidence(p, world, e.npcId, 'monastery');
        expect(res.success).toBe(true);
        expect(e.shadow).toBeNull();
        expect(e.residence).toBe('monastery');
        expect(coinTotal(p, world)).toBe(total);
    });

    it('counsel, honours and gifts', () => {
        const world = makeWorld();
        const p = makeRuler(world, [child({ age: 22 })]);
        Abdication.abdicate(p, world, { residence: 'court' });
        const e = Abdication.elders(p)[0];
        const dip = p.skills.diplomacy;
        const c = Abdication.counsel(p, world, e.npcId);
        expect(c.success).toBe(true);
        expect(p.skills.diplomacy).toBe(dip + 1);
        expect(Abdication.counsel(p, world, e.npcId).success).toBe(false); // (a month between)
        const prestige = p.house.prestige;
        expect(Abdication.honour(p, world, e.npcId).success).toBe(true);
        expect(p.house.prestige).toBeLessThan(prestige);
        const purse = Relationships.getNPC(e.npcId).purse;
        expect(Abdication.gift(p, world, e.npcId).success).toBe(true);
        expect(Relationships.getNPC(e.npcId).purse).toBe(purse + 100);
    });

    it('they grow old and die: their purse to the House, the reign\'s annals closed', () => {
        Utils.setSeed(3);
        const world = makeWorld(119);
        const p = makeRuler(world, [child({ age: 22 })]);
        Abdication.abdicate(p, world, { residence: 'court' });
        const e = Abdication.elders(p)[0];
        const npc = Relationships.getNPC(e.npcId);
        e.maxLifespan = 40; // long past it
        npc.age = 90;
        const total = coinTotal(p, world);
        let died = false;
        for (let y = 0; y < 10 && !died; y++) {
            days(p, world, 120);
            died = !e.alive;
        }
        expect(died).toBe(true);
        expect(npc.isAlive).toBe(false);
        expect(npc.purse).toBe(0);
        expect(coinTotal(p, world)).toBe(total);
        const reign = p.house.reigns.find(r => r.abdicated);
        expect(reign.elderDeath.cause).toBe('old age');
        expect(Annals.reignFacts(world, reign).fallback).toMatch(/died of old age/);
        expect(Abdication.elders(p)).toHaveLength(0);
    });
});

describe('pressure and a forced abdication', () => {
    function beleaguered(world) {
        const p = makeRuler(world, [child({ firstName: 'Hal', age: 26 })]);
        p.house.prestige = -20;
        p.karma = -120;
        p.age = 74;
        p.health = 30;
        p.maxHealth = 100;
        return p;
    }

    it('the pressure is read without changing state, and the Counsel hears it', () => {
        const world = makeWorld();
        const p = beleaguered(world);
        const snap = JSON.stringify(p.abdication || null);
        const pr = Abdication.pressure(p, world);
        expect(pr.score).toBeGreaterThanOrEqual(65);
        expect(pr.reasons.map(r => r.key)).toEqual(expect.arrayContaining(['prestige', 'infamy', 'frail', 'years']));
        expect(JSON.stringify(p.abdication || null)).toBe(snap);
        const { items } = Counsel.scan(p, world, { fresh: true });
        expect(items.some(i => String(i.id).startsWith('abdication_pressure'))).toBe(true);
    });

    it('weeks of pressure bring a demand; unanswered, the court deposes the ruler', () => {
        Utils.setSeed(21);
        const world = makeWorld(119);
        const p = beleaguered(world);
        let r = days(p, world, 7 * 5);
        expect(p.abdication.demand).toBeTruthy();
        expect(r.notices.some(n => /Demands You Step Down/.test(n.title))).toBe(true);
        r = days(p, world, 40);
        expect(r.abdicated).toBeTruthy();
        expect(p.firstName).toBe('Hal');
        const e = Abdication.elders(p)[0];
        expect(e.how).toBe('forced');
        expect(e.residence).toBe('estate');
        expect(e.endowment).toBe(0); // no endowment for the deposed
    });

    it('the seat can be held against the demand', () => {
        const world = makeWorld(119);
        const p = beleaguered(world);
        p.house.prestige = 40;
        Abdication.state(p).demand = { day: 119, due: 149, score: 80, reasons: ['test'] };
        expect(Abdication.holdSeat(p, world, 'prestige').success).toBe(true);
        expect(p.abdication.demand).toBeNull();
        expect(p.house.prestige).toBe(25);
    });
});

describe('saving', () => {
    it('the elders and the pressure survive a save; older saves backfill to none', () => {
        const game = newGame(4251);
        const kid = child({ firstName: 'Jory', age: 21 });
        game.player.children = [...(game.player.children || []), kid];
        game.player.gold = 2000;
        const res = Abdication.abdicate(game.player, game.world, { childId: kid.id, residence: 'estate', pension: 8 });
        expect(res.success).toBe(true);
        const npcId = res.elder.npcId;
        const g2 = roundTrip(game);
        const e = Abdication.elder(g2.player, npcId);
        expect(e).toBeTruthy();
        expect(e.pension).toBe(8);
        expect(e.residence).toBe('estate');
        expect(g2.player.firstName).toBe('Jory');
        expect(Relationships.getNPC(npcId)).toBeTruthy();
        expect(Relationships.getNPC(npcId).elder).toBe(true);
        const legacy = new Player();
        delete legacy.abdication;
        Abdication.loadState(legacy);
        expect(legacy.abdication).toBeNull();
    });

    it('the daily harness pays the pension', () => {
        const game = newGame(4252);
        const kid = child({ firstName: 'Kit', age: 21 });
        game.player.children = [...(game.player.children || []), kid];
        game.player.gold = 2000;
        const res = Abdication.abdicate(game.player, game.world, { childId: kid.id, residence: 'court', pension: 4 });
        expect(res.success).toBe(true);
        for (let i = 0; i < 5; i++) endDay(game);
        expect(Abdication.elders(game.player)[0].paid).toBeGreaterThan(0);
    });
});

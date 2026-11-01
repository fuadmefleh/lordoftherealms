// Play the heir before they inherit (systems/heirAgency.js): a child fostered
// at a lord's court (the host's court tutors them, a bond grows, a soured court
// keeps them hostage), a child betrothed to a realm (kin are slow to join a
// league against the House), a grown child commanding the company (their
// martial skill in battle; wounds, capture, death), an embassy — and the
// record they carry into a reign: lords' memories, standing, Prestige, a
// trait and a line in the Annals.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { NPCLords } from '../world/npcLords.js';
import { House } from '../systems/house.js';
import { Heirs } from '../systems/heirs.js';
import { HeirAgency } from '../systems/heirAgency.js';
import { Upbringing } from '../systems/upbringing.js';
import { Relationships } from '../systems/relationships.js';
import { Traits } from '../systems/traits.js';
import { Coalitions } from '../systems/coalitions.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { Ledger } from '../systems/ledger.js';
import { Player } from '../player/player.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

let baseAgency;
beforeAll(async () => {
    await loadData();
    baseAgency = JSON.parse(JSON.stringify(DataLoader.upbringing.agency));
});
afterEach(() => {
    DataLoader.upbringing.agency = JSON.parse(JSON.stringify(baseAgency));
});

function makeWorld(day = 40) {
    const lord = (name, kid, traits) => ({ name, kingdomId: kid, age: 50, traits, honor: 6, martial: 5, diplomacy: 5, stewardship: 5, relationships: {}, goals: [] });
    const world = {
        day, width: 30, height: 20, units: [], events: [], generationParams: { seed: 777 },
        kingdoms: [
            { id: 'k1', name: 'Arvenland', ruler: 'Queen Maud', isAlive: true, wars: [], allies: [], relations: {}, culture: 'Imperial', traits: ['militaristic'], military: 200, territory: [],
                characterData: { ruler: { firstName: 'Maud', traits: [{ id: 'brave' }] } }, lord: lord('Queen Maud', 'k1', [{ id: 'brave', name: 'Brave' }]) },
            { id: 'k2', name: 'Belmarch', ruler: 'King Osric', isAlive: true, wars: [], allies: [], relations: {}, culture: 'Imperial', traits: ['mercantile'], military: 180, territory: [],
                lord: lord('King Osric', 'k2', [{ id: 'greedy', name: 'Greedy' }]) },
        ],
        getTile: () => null,
        getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
        getSettlementViews: () => [],
        getAllSettlements: () => [],
    };
    return world;
}

function makePlayer(world) {
    const p = new Player();
    p.firstName = 'Aldric';
    p.lastName = 'Vane';
    p.name = 'Aldric Vane';
    p.gold = 3000;
    p.age = 50;
    p.renown = 10;
    p.reputation = { k1: 10, k2: 5 };
    p.relationships = {};
    p.children = [];
    p.army = [];
    House.initialize(p, world);
    return p;
}

let nextId = 1;
function addChild(player, extra = {}) {
    const c = {
        id: `ha_${nextId++}`, firstName: extra.firstName || 'Edda', dynasty: 'Vane', gender: 'female', age: 9, isAlive: true,
        traits: [], strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    if (c.age >= 16) c.upbringing.comeOfAge = true;
    player.children.push(c);
    return c;
}

/** Days pass: children age yearly, upbringing and agency run. */
function live(player, world, days) {
    const notices = [];
    for (let i = 0; i < days; i++) {
        world.day++;
        if (world.day % 120 === 0) for (const c of player.children) if (c.isAlive) c.age++;
        Upbringing.processDay(player, world);
        notices.push(...HeirAgency.processDay(player, world).notices);
    }
    return notices;
}

describe('content', () => {
    it('loads the agency config, the new lord memories and the family letter', () => {
        const cfg = HeirAgency.config();
        expect(cfg.fosterYears.length).toBeGreaterThan(0);
        for (const f of Object.values(cfg.hostFocus)) expect(Upbringing.focus(f), f).toBeTruthy();
        for (const d of ['fostered_heir', 'envoy_received', 'betrothal_made', 'betrothal_broken']) expect(NPCLords.deedDef(d), d).toBeTruthy();
        expect(CourtLetters.kind('family_report')).toBeTruthy();
        expect(CourtLetters.kind('family_report').weight).toBe(0);
    });
});

describe('fostering a child at a court', () => {
    it('sends a child to be raised abroad: the host court tutors, the lord remembers, a rival feud cools', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        p.house.rivals = { k1: { kingdomId: 'k1', name: 'House Maud', feud: 40 } };
        const kid = addChild(p, { age: 9 });
        expect(HeirAgency.fosterChild(p, world, addChild(p, { age: 4 }).id, 'k1').success).toBe(false);
        const res = HeirAgency.fosterChild(p, world, kid.id, 'k1', 2);
        expect(res.success).toBe(true);
        expect(res.placement.minor).toBe(true);
        expect(res.placement.until).toBe(world.day + 2 * 120);
        expect(kid.upbringing.tutor.kind).toBe('host');
        expect(kid.upbringing.tutor.focus).toBe('martial'); // a militaristic realm
        expect(kid.upbringing.tutor.seeds.brave).toBeGreaterThan(0);
        expect(p.house.rivals.k1.feud).toBe(30);
        expect(NPCLords.memoryOf(world.kingdoms[0].lord).map(m => m.key)).toContain('ward');
        expect(HeirAgency.isAway(kid)).toBe(true);
        expect(HeirAgency.fosterChild(p, world, kid.id, 'k2').success).toBe(false);
    });

    it('a grown child goes as a ward for a season instead (Heirs.sendAsWard)', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const grown = addChild(p, { age: 18 });
        const res = HeirAgency.fosterChild(p, world, grown.id, 'k2');
        expect(res.success).toBe(true);
        expect(res.placement.minor).toBeUndefined();
    });

    it('the bond grows; the child comes home with the host\'s character, a record and a letter', () => {
        const world = makeWorld(1);
        const p = makePlayer(world);
        const kid = addChild(p, { age: 9 });
        HeirAgency.fosterChild(p, world, kid.id, 'k1', 1);
        live(p, world, 125);
        const a = HeirAgency.ensure(kid);
        expect(kid.upbringing.placement.returned).toBe(true);
        expect(a.record.bonds.k1).toBeGreaterThanOrEqual(3);
        expect(a.record.fostered).toHaveLength(1);
        expect(a.record.fostered[0].lordName).toContain('Maud');
        expect(kid.upbringing.seeds.brave).toBeGreaterThanOrEqual(Upbringing.config().seedThreshold);
        expect(Upbringing.childhoodTraits(kid)).toContain('brave');
        expect(kid.upbringing.tutor).toBeNull();
        expect(CourtLetters.open(p).some(l => l.kind === 'family_report' && /comes home/.test(l.subject))).toBe(true);
    });

    it('a court grown cold keeps the child as a hostage, and a held ward does not come home', () => {
        const world = makeWorld(1);
        const p = makePlayer(world);
        const kid = addChild(p, { age: 10 });
        HeirAgency.fosterChild(p, world, kid.id, 'k2', 1);
        p.reputation.k2 = -100;
        const notices = live(p, world, HeirAgency.config().hostageCheckDays);
        expect(kid.upbringing.heldBy.kingdomId).toBe('k2');
        expect(notices.some(n => /Held/.test(n.title))).toBe(true);
        live(p, world, 130);
        expect(kid.upbringing.placement.returned).toBe(false);
        expect(HeirAgency.status(p, world, kid)).toMatch(/hostage/);
    });

    it('draws nothing from the shared RNG', () => {
        const world = makeWorld(1);
        const p = makePlayer(world);
        const kid = addChild(p, { age: 9 });
        HeirAgency.fosterChild(p, world, kid.id, 'k1', 1);
        Utils.setSeed(99);
        const expected = Utils.random();
        Utils.setSeed(99);
        for (let i = 0; i < 60; i++) { world.day++; HeirAgency.processDay(p, world); }
        expect(Utils.random()).toBe(expected);
    });
});

describe('betrothal', () => {
    it('promises a child for half a dowry; the match is made at coming of age', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const kid = addChild(p, { age: 14 });
        const gold = p.gold;
        const res = HeirAgency.betroth(p, world, kid.id, 'k2');
        expect(res.success).toBe(true);
        expect(p.gold).toBe(gold - res.cost);
        expect(Ledger.today(p).expenses.family).toBe(res.cost);
        expect(Heirs.kinshipWith(p, 'k2')).toBe('betrothed');
        expect(NPCLords.memoryOf(world.kingdoms[1].lord).map(m => m.key)).toContain('betrothal_made');
        kid.age = 16;
        live(p, world, 1);
        expect(kid.upbringing.spouse.kingdomId).toBe('k2');
        expect(kid.upbringing.spouse.name).toBe(res.betrothal.name);
        expect(HeirAgency.ensure(kid).betrothal).toBeNull();
        expect(Heirs.kinshipWith(p, 'k2')).toBe('married');
    });

    it('a broken betrothal is remembered', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const kid = addChild(p, { age: 10 });
        HeirAgency.betroth(p, world, kid.id, 'k1');
        const rep = p.reputation.k1;
        expect(HeirAgency.breakBetrothal(p, world, kid.id).success).toBe(true);
        expect(p.reputation.k1).toBe(rep + HeirAgency.config().betrothalBreakReputation);
        expect(NPCLords.memoryOf(world.kingdoms[0].lord).map(m => m.key)).toContain('betrothal_broken');
        expect(Heirs.kinshipWith(p, 'k1')).toBeNull();
    });

    it('a realm bound by marriage or betrothal is slower to turn on the House (coalitions)', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const k = world.kingdoms[1];
        const power = { score: 120, parts: {}, realm: null };
        const before = Coalitions.assess(p, world, k, power, [], null);
        const kid = addChild(p, { age: 10 });
        HeirAgency.betroth(p, world, kid.id, 'k2');
        p.reputation.k2 = 5; // the same standing as before, so only the bond differs
        const promised = Coalitions.assess(p, world, k, power, [], null);
        expect(promised.kin).toBe('betrothed');
        expect(promised.reasons.some(r => /betrothal/.test(r))).toBe(true);
        expect(promised.hostility).toBeLessThanOrEqual(Math.round(before.hostility * 0.75) + 1);
        expect(Heirs.kinshipFactor(p, 'k2').factor).toBe(0.75);
        p.marriageAllianceKingdom = 'k2';
        expect(Heirs.kinshipFactor(p, 'k2')).toEqual({ kin: 'married', factor: 0.5 });
    });
});

describe('commissions', () => {
    it('a commanding child lifts the company in battle, and their record grows', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const son = addChild(p, { age: 20, firstName: 'Bran', gender: 'male' });
        son.skills.combat = 6;
        son.skills.leadership = 4;
        expect(HeirAgency.commandMultiplier(p)).toBe(1);
        expect(HeirAgency.giveCommand(p, world, son.id).success).toBe(true);
        expect(HeirAgency.commandMultiplier(p)).toBeCloseTo(1 + 6 * 0.025 + 4 * 0.015, 5);
        DataLoader.upbringing.agency.fate = { ...baseAgency.fate, woundWin: 0, deathWin: 0 };
        const res = HeirAgency.onBattle(p, world, true, 'Bandits');
        expect(res.fate).toBe('unhurt');
        const rec = HeirAgency.ensure(son).record;
        expect(rec.battles).toEqual({ fought: 1, won: 1, lost: 0 });
        HeirAgency.onBattle(p, world, true, 'Bandits');
        expect(son.skills.combat).toBe(7); // half a point a battle
    });

    it('a commander may be wounded, captured for ransom, or killed — by a hash roll, not the shared RNG', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const son = addChild(p, { age: 20, gender: 'male' });
        HeirAgency.giveCommand(p, world, son.id);
        DataLoader.upbringing.agency.fate = { ...baseAgency.fate, deathLoss: 0, captureLoss: 1 };
        Utils.setSeed(3);
        const expected = Utils.random();
        Utils.setSeed(3);
        const cap = HeirAgency.onBattle(p, world, false, 'the Red Hand');
        expect(Utils.random()).toBe(expected);
        expect(cap.fate).toBe('captured');
        expect(HeirAgency.commander(p)).toBeNull();
        expect(HeirAgency.ensure(son).captive.by).toBe('the Red Hand');
        expect(CourtLetters.open(p).some(l => l.kind === 'family_report' && /captive/.test(l.subject))).toBe(true);
        const gold = p.gold;
        expect(HeirAgency.ransom(p, world, son.id).success).toBe(true);
        expect(p.gold).toBe(gold - baseAgency.fate.ransom);

        HeirAgency.giveCommand(p, world, son.id);
        DataLoader.upbringing.agency.fate = { ...baseAgency.fate, deathLoss: 1 };
        p.heir = son.id;
        const dead = HeirAgency.onBattle(p, world, false, 'the Red Hand');
        expect(dead.fate).toBe('killed');
        expect(son.isAlive).toBe(false);
        expect(p.heir).toBeNull();
        expect(HeirAgency.processDay(p, world).notices.some(n => /Fallen/.test(n.title))).toBe(true);
    });

    it('an unransomed captive is let go in time, and the House is shamed', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        p.house.prestige = 50;
        const son = addChild(p, { age: 20, gender: 'male' });
        HeirAgency.ensure(son).captive = { by: 'brigands', day: world.day, until: world.day + 2, ransom: 150 };
        live(p, world, 2);
        expect(HeirAgency.ensure(son).captive).toBeNull();
        expect(p.house.prestige).toBe(50 - baseAgency.fate.unransomedPrestige);
    });

    it('an envoy returns with standing, a lord\'s memory and a bond — or is kept if war comes', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const d = addChild(p, { age: 19 });
        d.skills.diplomacy = 4;
        const rep = p.reputation.k2;
        const res = HeirAgency.sendEnvoy(p, world, d.id, 'k2');
        expect(res.success).toBe(true);
        expect(HeirAgency.isAway(d)).toBe(true);
        expect(HeirAgency.giveCommand(p, world, d.id).success).toBe(false);
        live(p, world, HeirAgency.config().envoyDays);
        const gain = Math.round(baseAgency.envoyReputation + 4 * baseAgency.envoyDiplomacyRep);
        expect(p.reputation.k2).toBe(rep + gain);
        expect(NPCLords.memoryOf(world.kingdoms[1].lord).map(m => m.key)).toContain('envoy_received');
        expect(HeirAgency.ensure(d).record.envoys).toHaveLength(1);
        expect(d.skills.diplomacy).toBe(5);

        HeirAgency.sendEnvoy(p, world, d.id, 'k1');
        p.allegiance = 'k2';
        world.kingdoms[1].wars.push('k1');
        world.kingdoms[0].wars.push('k2');
        live(p, world, HeirAgency.config().envoyDays);
        expect(d.upbringing.heldBy.kingdomId).toBe('k1');
    });
});

describe('succession: the record pays off', () => {
    it('a fostered, battle-hardened, married heir carries it into the reign', () => {
        const world = makeWorld(1);
        const p = makePlayer(world);
        p.house.prestige = 20;
        const heir = addChild(p, { age: 9, firstName: 'Corin', gender: 'male' });
        HeirAgency.fosterChild(p, world, heir.id, 'k1', 1);
        live(p, world, 125);
        heir.age = 18;
        live(p, world, 1); // comes of age
        Heirs.marryForAlliance(p, world, heir.id, 'k2');
        HeirAgency.giveCommand(p, world, heir.id);
        DataLoader.upbringing.agency.fate = { ...baseAgency.fate, woundWin: 0, deathWin: 0 };
        for (let i = 0; i < 3; i++) { world.day++; HeirAgency.onBattle(p, world, true, 'Raiders'); }
        const plan = HeirAgency.payoff(p, world, heir);
        expect(plan.lines.map(l => l.icon)).toEqual(expect.arrayContaining(['🏰', '⚔️', '🦁', '💍']));
        const maudBefore = NPCLords.memoryOpinion(world.kingdoms[0].lord, world.day);

        const res = Relationships.succeedAsHeir(p, heir.id, world, { cause: 'old age' });
        expect(res.success).toBe(true);
        expect(res.heirRecord.lines.length).toBe(plan.lines.length);
        expect(Traits.has(p, 'brave')).toBe(true);
        const keys = NPCLords.memoryOf(world.kingdoms[0].lord, world.day).map(m => m.key);
        expect(keys).toContain('fostered_heir');
        expect(NPCLords.memoryOpinion(world.kingdoms[0].lord, world.day)).toBeGreaterThan(maudBefore);
        expect(NPCLords.memoryOf(world.kingdoms[1].lord, world.day).map(m => m.key)).toContain('marriage_kin');
        expect(p.reputation.k1).toBeGreaterThanOrEqual(baseAgency.payoff.fosterReputation);
        const entry = p.house.history.find(h => (h.tags || []).includes('heirRecord'));
        expect(entry.text).toMatch(/Corin came to the seat/);
        expect(entry.generation).toBe(p.house.generation);
    });

    it('a captured, unremarkable heir loses Prestige for it', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const heir = addChild(p, { age: 20 });
        HeirAgency.ensure(heir).record.captured = 2;
        const plan = HeirAgency.payoff(p, world, heir);
        expect(plan.prestige).toBe(2 * baseAgency.payoff.capturedPrestige);
    });

    it('the record and a child\'s commission survive a save', () => {
        const game = newGame(4242);
        const { player, world } = game;
        const kid = addChild(player, { age: 18 });
        const kd = world.kingdoms.find(k => k.isAlive && k.id !== player.allegiance);
        player.reputation = { ...(player.reputation || {}), [kd.id]: 20 };
        expect(HeirAgency.sendEnvoy(player, world, kid.id, kd.id).success).toBe(true);
        HeirAgency.ensure(kid).record.battles = { fought: 2, won: 1, lost: 1 };
        const g2 = roundTrip(game);
        const kid2 = g2.player.children.find(c => c.id === kid.id);
        expect(HeirAgency.ensure(kid2).commission.kind).toBe('envoy');
        expect(HeirAgency.ensure(kid2).record.battles.won).toBe(1);
    });
});

// The House's court (systems/court.js): people the player knows can be
// invited to live at court for a stipend; they have skills, can hold any
// office but the heir's, can rule as regent or be named regent-designate,
// are paid from the player's purse into their own, and leave when unpaid,
// faithless or dismissed. Saved on the House and the relationship NPC.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { House } from '../systems/house.js';
import { Court } from '../systems/court.js';
import { Regency } from '../systems/regency.js';
import { Upbringing } from '../systems/upbringing.js';
import { Relationships } from '../systems/relationships.js';
import { Player } from '../player/player.js';
import { loadData } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

function makeWorld(day = 100) {
    const world = {
        day, width: 30, height: 20, units: [], events: [], generationParams: { seed: 77 },
        kingdoms: [{ id: 'k1', name: 'Arvenland', isAlive: true, wars: [], allies: [], relations: {}, culture: 'Imperial', territory: [] }],
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
        id: `ct_${nextId++}`, firstName: 'Wynn', dynasty: 'Vane', gender: 'male', age: 10, isAlive: true, traits: [],
        strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    if (c.age >= 16) c.upbringing.comeOfAge = true;
    return c;
}

function makePlayer(world, kids = []) {
    const p = new Player();
    p.firstName = 'Old';
    p.lastName = 'Vane';
    p.name = 'Old Vane';
    p.age = 50;
    p.gold = 2000;
    p.relationships = {};
    p.reputation = {};
    p.children = kids;
    Relationships.initialize(p);
    House.initialize(p, world);
    p.house.prestige = 40;
    return p;
}

function known(p, world, extra = {}, score = 50) {
    const npc = Relationships.generateNPC({ name: 'Ashford', type: 'town', kingdom: 'k1' }, world);
    Object.assign(npc, { age: 30, occupation: 'merchant', traits: ['practical'] }, extra);
    const rel = Relationships.getRelationship(p, npc.id);
    rel.score = score;
    return npc;
}

beforeEach(() => {
    Relationships._npcs = [];
    Relationships._nextId = 1;
});

describe('inviting someone to court', () => {
    it('a friend at a fair stipend usually accepts; the welcome purse goes into their own', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const npc = known(p, world, { traits: ['loyal'] }, 90);
        const odds = Court.inviteOdds(p, world, npc.id);
        expect(odds.ok).toBe(true);
        expect(odds.chance).toBeGreaterThan(0.6);
        Utils.setSeed(3);
        let res = null;
        for (let i = 0; i < 20 && !(res && res.accepted); i++) {
            npc.courtRefused = null;
            res = Court.invite(p, world, npc.id, { stipend: odds.expected + 2 });
        }
        expect(res.accepted).toBe(true);
        expect(Court.isMember(p, npc.id)).toBe(true);
        expect(npc.atCourt).toBeTruthy();
        expect(npc.purse).toBe((odds.expected + 2) * Court.config().joinDays);
        expect(p.house.court[0]).toMatchObject({ npcId: npc.id, since: 100, stipend: odds.expected + 2 });
        // They no longer turn up among their town's people
        const meet = Relationships.getNPCsAtSettlement({ settlement: { name: 'Ashford', type: 'village', kingdom: 'k1' } }, world, p);
        expect(meet.some(n => n.id === npc.id)).toBe(false);
    });

    it('refuses strangers, the bound and the full; a stingy offer lowers the odds; a refusal holds a while', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const stranger = Relationships.generateNPC({ name: 'Ashford', kingdom: 'k1' }, world);
        expect(Court.inviteOdds(p, world, stranger.id).reason).toMatch(/meet/);
        const gov = known(p, world, { governing: { q: 1, r: 1 } });
        expect(Court.inviteOdds(p, world, gov.id).ok).toBe(false);
        const royal = known(p, world, { royal: { kingdomId: 'k1' } });
        expect(Court.inviteOdds(p, world, royal.id).reason).toMatch(/royal/);
        const sour = known(p, world, {}, -20);
        expect(Court.inviteOdds(p, world, sour.id).ok).toBe(false);

        const npc = known(p, world, {}, 20);
        const fair = Court.inviteOdds(p, world, npc.id).chance;
        const stingy = Court.inviteOdds(p, world, npc.id, 1).chance;
        const rich = Court.inviteOdds(p, world, npc.id, 20).chance;
        expect(stingy).toBeLessThan(fair);
        expect(rich).toBeGreaterThan(fair);

        npc.courtRefused = { day: 95, stipend: 5 };
        expect(Court.inviteOdds(p, world, npc.id, 5).ok).toBe(false);
        expect(Court.inviteOdds(p, world, npc.id, 6).ok).toBe(true);

        // Full: seats by Prestige and rank
        p.house.prestige = 0;
        const cap = Court.capacity(p);
        for (let i = 0; i < cap; i++) Court.join(p, world, known(p, world).id, { free: true });
        expect(Court.inviteOdds(p, world, known(p, world).id).reason).toMatch(/full/);
        p.house.prestige = 200;
        expect(Court.capacity(p)).toBeGreaterThan(cap);
    });

    it('a refusal on the dice leaves them at home and remembers the offer', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const npc = known(p, world, { traits: ['homebody', 'fickle'] }, 0);
        p.house.prestige = 0;
        Utils.setSeed(11);
        const res = Court.invite(p, world, npc.id, { stipend: 1 });
        expect(res.success).toBe(true);
        expect(res.accepted).toBe(false);
        expect(Court.isMember(p, npc.id)).toBe(false);
        expect(npc.courtRefused).toMatchObject({ day: 100, stipend: 1 });
    });
});

describe('courtiers have skills', () => {
    it('worked out once from occupation and traits, on the children\'s scale, deterministic', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const a = known(p, world, { occupation: 'diplomat', traits: ['honest'] });
        const s = Court.ensureSkills(a);
        expect(Object.keys(s).sort()).toEqual(['combat', 'commerce', 'diplomacy', 'leadership', 'stealth']);
        expect(s.diplomacy).toBeGreaterThanOrEqual(5);
        expect(Math.max(...Object.values(s))).toBeLessThanOrEqual(Court.config().skillCap);
        const again = { ...a, skills: undefined };
        expect(Court.ensureSkills(again)).toEqual(s);
        a.skills.diplomacy = 1;
        expect(Court.ensureSkills(a).diplomacy).toBe(1); // stored once, never re-rolled
    });
});

describe('stipends', () => {
    it('every coin paid leaves the player\'s purse and lands in the courtier\'s', () => {
        const world = makeWorld(700);
        const p = makePlayer(world);
        const a = known(p, world);
        const b = known(p, world, { occupation: 'guard' });
        Court.join(p, world, a.id, { stipend: 5, free: true });
        Court.join(p, world, b.id, { stipend: 3, free: true });
        const before = p.gold + (a.purse || 0) + (b.purse || 0);
        for (let i = 0; i < 20; i++) { world.day++; Court.processDay(p, world); }
        expect(p.gold + a.purse + b.purse).toBe(before);
        expect(a.purse).toBe(100);
        expect(b.purse).toBe(60);
        expect(Court.dailyCost(p)).toBe(8);
    });

    it('unpaid, they sour by the day and leave owed; their savings go with them', () => {
        const world = makeWorld(701);
        const p = makePlayer(world);
        const a = known(p, world);
        Court.join(p, world, a.id, { stipend: 5, loyalty: 70, free: true });
        p.gold = 0;
        const notices = [];
        for (let i = 0; i < Court.config().unpaidLeaveDays + 1; i++) { world.day++; notices.push(...Court.processDay(p, world).notices); }
        expect(Court.isMember(p, a.id)).toBe(false);
        expect(a.atCourt).toBeFalsy();
        expect(notices.some(n => /unpaid/i.test(n.title))).toBe(true);
        expect(notices.some(n => /Leaves/.test(n.title))).toBe(true);
    });

    it('a raise warms them, a cut sours them', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const a = known(p, world);
        Court.join(p, world, a.id, { stipend: 4, loyalty: 50, free: true });
        expect(Court.setStipend(p, a.id, 6).loyalty).toBeGreaterThan(50);
        expect(Court.setStipend(p, a.id, 2).loyalty).toBeLessThan(50);
    });
});

describe('dismissal and leaving', () => {
    it('dismissed: off the roll, out of office and the regency designation, home again', () => {
        const world = makeWorld();
        const p = makePlayer(world, [child({ age: 8 })]);
        p.heir = p.children[0].id;
        const a = known(p, world);
        Court.join(p, world, a.id, { free: true });
        expect(House.assignRole(p, 'steward', a.id).success).toBe(true);
        expect(Regency.designate(p, world, a.id).success).toBe(true);
        const res = Court.dismiss(p, world, a.id);
        expect(res.success).toBe(true);
        expect(Court.isMember(p, a.id)).toBe(false);
        expect(p.house.roles.steward).toBeNull();
        expect(p.house.regentDesignate).toBeNull();
        expect(a.atCourt).toBeFalsy();
        expect(p.relationships[a.id].score).toBeLessThan(50);
    });

    it('a faithless courtier leaves of their own accord; a disloyal officer skims into their own purse', () => {
        const world = makeWorld(0);
        const p = makePlayer(world);
        p.house.prestige = 0;
        p.gold = 5000;
        const a = known(p, world, { traits: ['fickle', 'greedy'] }, -60);
        Court.join(p, world, a.id, { stipend: 0, loyalty: 10, free: true });
        House.assignRole(p, 'steward', a.id);
        const total = () => p.gold + (a.purse || 0);
        const before = total();
        const notices = [];
        for (let i = 0; i < 400 && Court.isMember(p, a.id); i++) { world.day++; notices.push(...Court.processDay(p, world).notices); }
        expect(Court.isMember(p, a.id)).toBe(false);
        expect(total()).toBe(before);
        expect(a.purse).toBeGreaterThan(0); // skimmed
        expect(p.house.roles.steward).toBeNull();
    });

    it('a courtier who dies is struck off the roll', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const a = known(p, world);
        Court.join(p, world, a.id, { free: true });
        House.assignRole(p, 'marshal', a.id);
        a.isAlive = false;
        world.day++;
        const out = Court.processDay(p, world);
        expect(Court.isMember(p, a.id)).toBe(false);
        expect(p.house.roles.marshal).toBeNull();
        expect(out.notices[0].title).toMatch(/Death/);
    });
});

describe('offices for those not of the blood', () => {
    it('a courtier can hold an office and its bonus scales with their skill and loyalty', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const a = known(p, world, { occupation: 'merchant prince' });
        Court.join(p, world, a.id, { loyalty: 100, free: true });
        expect(House.getRoleBonuses(p).propertyIncomeMult).toBe(1);
        expect(House.assignRole(p, 'steward', a.id).success).toBe(true);
        const hi = House.getRoleBonuses(p).propertyIncomeMult;
        expect(hi).toBeCloseTo(1 + Math.min(0.5, a.skills.commerce * 0.03), 5);
        Court.entry(p, a.id).loyalty = 50;
        expect(House.getRoleBonuses(p).propertyIncomeMult).toBeLessThan(hi);
        expect(House.officerLoyalty(p, a.id)).toBe(50);
        expect(House._findMember(p, a.id)).toBe(a);
        // No roleLoyalty entry: their loyalty lives at court, and they press no claim
        expect(p.house.roleLoyalty[a.id]).toBeUndefined();
        Court.entry(p, a.id).loyalty = 0;
        world.day = 120;
        expect(House._driftRoleLoyalty(p, world).claimant).toBeNull();
    });

    it('the heir must be of the blood; strangers to the court cannot be appointed', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        const a = known(p, world);
        expect(House.assignRole(p, 'chancellor', a.id).success).toBe(false);
        Court.join(p, world, a.id, { free: true });
        const res = House.assignRole(p, 'heir', a.id);
        expect(res.success).toBe(false);
        expect(res.reason).toMatch(/blood/);
        const kid = child({ age: 6 });
        p.children.push(kid);
        expect(House.assignRole(p, 'heir', kid.id).success).toBe(true);
    });
});

describe('courtiers and the regency', () => {
    it('a courtier is a regent candidate, and the regent-designate is used first at succession', () => {
        const world = makeWorld();
        const heir = child({ age: 9 });
        const p = makePlayer(world, [heir]);
        p.heir = heir.id;
        const a = known(p, world, { occupation: 'noble', firstName: 'Corin' });
        Court.join(p, world, a.id, { loyalty: 80, free: true });
        const cands = Regency.candidates(p, world, heir.id);
        expect(cands.map(c => c.kind)).toEqual(['courtier', 'council']);
        expect(Regency.designateOptions(p, world).map(c => c.id)).toEqual([a.id]);
        expect(Regency.designate(p, world, a.id).success).toBe(true);
        expect(Regency.candidates(p, world, heir.id)[0]).toMatchObject({ id: a.id, designate: true });
        const res = Relationships.succeedAsHeir(p, heir.id, world, { regency: true });
        expect(res.success).toBe(true);
        expect(p.regency.regent).toMatchObject({ kind: 'courtier', id: a.id });
        expect(Regency._regentAlive(p, p.regency.regent)).toBe(true);
        // The court outlives the head who gathered it
        expect(Court.isMember(p, a.id)).toBe(true);
    });

    it('the designate outranks the spouse; a sitting regent can be replaced by a courtier', () => {
        const world = makeWorld();
        const heir = child({ age: 9 });
        const p = makePlayer(world, [heir]);
        const sp = Relationships.generateNPC({ name: 'Arvenhold', kingdom: 'k1' }, world);
        p.spouse = sp.id;
        const a = known(p, world);
        Court.join(p, world, a.id, { free: true });
        Regency.designate(p, world, a.id);
        expect(Regency.pick(p, world, heir.id).id).toBe(a.id);

        const b = known(p, world, { firstName: 'Bryn' });
        Court.join(p, world, b.id, { free: true });
        Regency.begin(p, world, { kind: 'council', id: 'council:x', name: 'Lord Tench', loyalty: 55, ambition: 40 });
        expect(Regency.replacements(p, world).some(c => c.id === b.id)).toBe(true);
        const res = Regency.replace(p, world, b.id);
        expect(res.success).toBe(true);
        expect(p.regency.regent).toMatchObject({ kind: 'courtier', id: b.id });
        // A courtier ruling as regent cannot be dismissed out from under the child
        expect(Court.dismiss(p, world, b.id).success).toBe(false);
    });
});

describe('save and load', () => {
    it('the court, its offices and the designate round-trip with the House; skills with the NPC', () => {
        const world = makeWorld();
        const heir = child({ age: 9 });
        const p = makePlayer(world, [heir]);
        p.heir = heir.id;
        const a = known(p, world, { occupation: 'knight' });
        Court.join(p, world, a.id, { stipend: 6, loyalty: 66, free: true });
        House.assignRole(p, 'marshal', a.id);
        Regency.designate(p, world, a.id);
        const houseJson = JSON.parse(JSON.stringify(House.serialize(p.house)));
        Relationships.prepareForSave(p);
        const npcsJson = JSON.parse(JSON.stringify(p._relationshipNpcs));

        const q = makePlayer(world, [heir]);
        House.deserialize(q, world, houseJson);
        Relationships._npcs = npcsJson;
        expect(q.house.court).toHaveLength(1);
        expect(q.house.court[0]).toMatchObject({ npcId: a.id, stipend: 6, loyalty: 66 });
        expect(q.house.roles.marshal).toBe(a.id);
        expect(q.house.regentDesignate).toBe(a.id);
        const back = Court.members(q)[0];
        expect(back.skills).toEqual(a.skills);
        expect(back.atCourt).toBeTruthy();
        expect(House.getRoleBonuses(q).armyUpkeepMult).toBeLessThan(1);

        // Older saves have no court
        const r = makePlayer(world);
        const old = { ...houseJson };
        delete old.court;
        delete old.regentDesignate;
        House.deserialize(r, world, old);
        expect(r.house.court).toEqual([]);
        expect(r.house.regentDesignate).toBeNull();
    });
});

describe('the shared contract', () => {
    it('ensure / members / join (free, no roll) / isMember', () => {
        const world = makeWorld();
        const p = makePlayer(world);
        delete p.house.court;
        expect(Court.ensure(p)).toEqual([]);
        const a = known(p, world);
        const gold = p.gold;
        const res = Court.join(p, world, a.id, { stipend: 4, loyalty: 70, free: true });
        expect(res.success).toBe(true);
        expect(p.gold).toBe(gold);
        expect(Court.isMember(p, a.id)).toBe(true);
        expect(Court.members(p)).toEqual([a]);
        expect(p.house.court[0]).toMatchObject({ npcId: a.id, since: 100, stipend: 4, loyalty: 70 });
        // Not free: the welcome purse is paid
        const b = known(p, world);
        Court.join(p, world, b.id, { stipend: 2 });
        expect(p.gold).toBe(gold - 2 * Court.config().joinDays);
    });
});

describe('panels', () => {
    it('render the Court, its member page, invitations, the House offices and the regent picker', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const world = makeWorld();
        const heir = child({ age: 9 });
        const p = makePlayer(world, [heir]);
        p.heir = heir.id;
        const a = known(p, world, { firstName: 'Corin', occupation: 'knight' });
        const b = known(p, world, { firstName: 'Brisa', occupation: 'merchant' }, 40);
        Court.join(p, world, a.id, { stipend: 6, free: true });
        House.assignRole(p, 'marshal', a.id);
        const panels = [];
        const game = {
            player: p, world,
            ui: {
                showCustomPanel: (title, html) => panels.push({ title, html }),
                showNotification: () => {}, updateStats: () => {}, hideCustomPanel: () => {},
            },
        };
        world.getTile = () => null;
        ActionMenu.showHouseCourt(game);
        expect(panels.at(-1).html).toContain('Corin');
        expect(panels.at(-1).html).toContain('Marshal');
        ActionMenu.showHouseCourt(game, 'member', a.id);
        expect(panels.at(-1).html).toContain('Dismiss from court');
        ActionMenu.showHouseCourt(game, 'invite');
        expect(panels.at(-1).html).toContain('Brisa');
        ActionMenu.showHouseCourt(game, 'offer', b.id);
        expect(panels.at(-1).html).toContain('A fair stipend');
        ActionMenu.showHouseCourt(game, 'designate');
        expect(panels.at(-1).html).toContain('Corin');
        globalThis.window._courtUI.designate(a.id);
        expect(p.house.regentDesignate).toBe(a.id);

        ActionMenu.showHousePanel(game, null);
        expect(panels.at(-1).html).toContain('The Court');
        expect(panels.at(-1).html).toContain('courtier, loyalty');
        globalThis.window._houseAssignRole('steward');
        expect(panels.at(-1).html).toContain('Corin');
        globalThis.window._houseAssignRole('heir');
        expect(panels.at(-1).html).not.toContain('Corin');

        Relationships.succeedAsHeir(p, heir.id, world, { regency: true });
        expect(p.regency.regent.id).toBe(a.id);
        Court.join(p, world, b.id, { free: true });
        p.house.prestige = 100;
        ActionMenu.showRegencyPanel(game);
        globalThis.window._regencyUI.pickReplace();
        expect(panels.at(-1).html).toContain('Brisa');
        globalThis.window._regencyUI.replace(b.id);
        expect(p.regency.regent.id).toBe(b.id);
    });
});

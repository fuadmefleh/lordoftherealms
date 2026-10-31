import { describe, it, expect, beforeEach } from 'vitest';
import { Townsfolk } from '../systems/townsfolk.js';
import { NpcFamily } from '../systems/npcFamily.js';
import { Relationships } from '../systems/relationships.js';
import { Heirs } from '../systems/heirs.js';
import { House } from '../systems/house.js';
import { Utils } from '../core/utils.js';

const Y = 120;

function makeWorld(day = 1) {
    const town = { name: 'Ashford', type: 'town', q: 5, r: 7, kingdom: 'k1' };
    const tiles = { '5,7': { q: 5, r: 7, settlement: town } };
    return {
        day, baseYear: 853, generationParams: { seed: 4242 }, activeEvents: [],
        town, getSettlementViews: () => [town], getKingdom: () => null,
        getTile: (q, r) => tiles[`${q},${r}`] || null,
    };
}

function seedNpcs() {
    const types = { villager: 6, merchant: 3, guard: 2, farmer: 2, priest: 1, blacksmith_npc: 1, child: 3 };
    const npcs = [];
    let id = 0;
    for (const [type, n] of Object.entries(types)) for (let i = 0; i < n; i++) npcs.push({ id: id++, type, name: 'Ada', age: 18 + ((id * 7) % 30) });
    let s = 99;
    NpcFamily.generateFamilies(npcs, () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; });
    return npcs;
}

function setup() {
    const world = makeWorld(1);
    Townsfolk.attach(world.town, world, seedNpcs(), { q: 5, r: 7, target: 18 });
    const folk = world.town.folk;
    const player = { firstName: 'Rowan', lastName: 'Vale', gender: 'male', age: 25, gold: 500, charisma: 5, skills: {}, reputation: {} };
    Relationships._npcs = [];
    Relationships._nextId = 1;
    Relationships.initialize(player);
    return { world, folk, player };
}

const adult = (folk, world, pred = () => true) => folk.people.find(p => Townsfolk.isHere(p) && Townsfolk.age(p, world.day) >= 18 && p.role !== 'child' && p.role !== 'priest' && pred(p));
const unwed = (folk) => (p) => { const sp = Townsfolk.get(folk, p.spouse); return !sp || sp.died != null; };

describe('Townsfolk in the player\'s life', () => {
    beforeEach(() => Utils.setSeed(7));

    it('a known townsperson becomes one relationship NPC, linked both ways, starting from their regard', () => {
        const { world, folk, player } = setup();
        const p = adult(folk, world);
        p.mem = { disposition: 80, timesSpoken: 3 };
        const res = Relationships.fromTownsperson(player, world, folk, p, world.town);
        expect(res.success).toBe(true);
        const npc = res.npc;
        expect(npc.folkUid).toBe(`5,7#${p.id}`);
        expect(p.rnpc).toBe(npc.id);
        expect(npc.firstName).toBe(p.first);
        expect(npc.age).toBe(Townsfolk.age(p, world.day));
        expect(Relationships.getRelationship(player, npc.id).score).toBeGreaterThan(20);
        // Idempotent
        expect(Relationships.fromTownsperson(player, world, folk, p).npc).toBe(npc);
        expect(Relationships._npcs.filter(n => n.folkUid === npc.folkUid).length).toBe(1);
    });

    it('children cannot be drawn into the player\'s affairs', () => {
        const { world, folk, player } = setup();
        const kid = folk.people.find(p => p.role === 'child');
        const res = Relationships.fromTownsperson(player, world, folk, kid);
        expect(res.success).toBe(false);
    });

    it('bridging draws nothing from the shared RNG', () => {
        const { world, folk, player } = setup();
        Utils.setSeed(11);
        const before = Utils.random();
        Utils.setSeed(11);
        Relationships.fromTownsperson(player, world, folk, adult(folk, world));
        expect(Utils.random()).toBe(before);
    });

    it('a companion leaves the town\'s streets and seasons, and comes home when dismissed', () => {
        const { world, folk, player } = setup();
        const p = adult(folk, world);
        p.mem = { disposition: 95, timesSpoken: 5 };
        const { npc } = Relationships.fromTownsperson(player, world, folk, p);
        player.relationships[npc.id].score = 100;
        npc.traits = ['adventurous', 'loyal'];
        let joined = false;
        for (let i = 0; i < 20 && !joined; i++) joined = Relationships.requestJoinTravelParty(player, npc.id, world).accepted;
        expect(joined).toBe(true);
        expect(p.away && p.away.withPlayer).toBe('party');
        expect(Townsfolk.residents(folk)).not.toContain(p);
        expect(Townsfolk.status(p, world).text).toMatch(/road with Rowan/);
        Relationships.removeFromTravelParty(player, npc.id);
        Relationships.syncFolk(player, world);
        expect(p.away).toBe(null);
        expect(Townsfolk.residents(folk)).toContain(p);
        expect(p.log.some(e => e.k === 'cameHome')).toBe(true);
    });

    it('someone wed in town is not free to court', () => {
        const { world, folk, player } = setup();
        const p = adult(folk, world, q => { const sp = Townsfolk.get(folk, q.spouse); return sp && sp.died == null; });
        expect(p).toBeTruthy();
        const { npc } = Relationships.fromTownsperson(player, world, folk, p);
        expect(npc.marriedTo).toBe(Townsfolk.name(Townsfolk.get(folk, p.spouse)));
        const acts = Relationships.getCourtActionAvailability(player, npc.id, { world });
        expect(acts.every(a => !a.unlocked)).toBe(true);
    });

    it('marrying a townsperson takes them from home; the town\'s seasons no longer touch them', () => {
        const { world, folk, player } = setup();
        // A newcomer to town, single
        const p = Townsfolk._newcomer(folk, 1, () => 0.3, { age: 24, gender: 'female', role: 'farmer', from: 'Greymoor' });
        expect(unwed(folk)(p)).toBe(true);
        const { npc } = Relationships.fromTownsperson(player, world, folk, p);
        expect(Relationships.marry(player, npc.id, world).success).toBe(true);
        expect(p.away.withPlayer).toBe('wed');
        expect(Townsfolk.biographyLine(folk, p, p.log[p.log.length - 1], world)).toMatch(/Married Rowan/);
        // Years pass: no town wedding, no town death for her
        for (let d = 2; d <= 10 * Y; d++) { world.day = d; Townsfolk.processDay(world); }
        expect(p.spouse == null || Townsfolk.get(folk, p.spouse).died != null).toBe(true);
        expect(p.died).toBe(null);
        Relationships.syncFolk(player, world);
        expect(npc.age).toBe(Townsfolk.age(p, world.day));
    });

    it('a death on either side is a death on both', () => {
        const { world, folk, player } = setup();
        const [a, b] = folk.people.filter(p => Townsfolk.isHere(p) && Townsfolk.age(p, 1) >= 18 && p.role !== 'child').slice(0, 2);
        const na = Relationships.fromTownsperson(player, world, folk, a).npc;
        const nb = Relationships.fromTownsperson(player, world, folk, b).npc;
        Townsfolk._die(folk, a, 1, 'a fever');
        nb.isAlive = false;
        nb.deathCause = 'a bandit\'s arrow';
        Relationships.syncFolk(player, world);
        expect(na.isAlive).toBe(false);
        expect(na.deathCause).toBe('a fever');
        expect(b.died).not.toBe(null);
        expect(b.cause).toBe('a bandit\'s arrow');
    });

    it('"Meet People" in a town with a roster meets its own townsfolk, the known first', () => {
        const { world, folk, player } = setup();
        const known = adult(folk, world, q => q.role !== 'noble');
        known.mem = { disposition: 60, timesSpoken: 4 };
        const tile = world.getTile(5, 7);
        const met = Relationships.getNPCsAtSettlement(tile, world, player);
        expect(met.length).toBe(3);
        expect(met.every(n => n.folkUid)).toBe(true);
        expect(met[0].folkUid).toBe(`5,7#${known.id}`);
    });

    it('a grown heir can wed a townsperson, who becomes the spouse on succession', () => {
        const { world, folk, player } = setup();
        House.initialize(player, world);
        if (player.house) player.house.prestige = 10;
        const child = { id: 'c1', firstName: 'Tam', gender: 'male', age: 20, isAlive: true, upbringing: { comeOfAge: true } };
        player.children = [child];
        const matches = Heirs.localMatches(player, world, 'c1');
        expect(matches.length).toBeGreaterThan(0);
        expect(matches.every(m => m.person.gender === 'female')).toBe(true);
        const m = matches[0];
        const prestige = player.house ? player.house.prestige : 0;
        const res = Heirs.marryTownsperson(player, world, 'c1', folk, m.person.id);
        expect(res.success).toBe(true);
        expect(child.upbringing.spouse.kind).toBe('local');
        expect(m.person.away.withPlayer).toBe('house');
        expect(m.person.wedHouse).toBe(true);
        expect(player.reputation.k1).toBe(Heirs.config().localReputation);
        if (player.house && !m.gentle) expect(player.house.prestige).toBeLessThan(prestige);
        expect(Heirs.marryTownsperson(player, world, 'c1', folk, m.person.id).success).toBe(false);
        expect(Heirs.localMatches(player, world, 'c1')).toEqual([]);
        // The heir inherits: the townsperson is the new ruler's spouse
        const npc = Relationships._seatHeirSpouse(player, child, world);
        expect(npc.folkUid).toBe(child.upbringing.spouse.folkUid);
        expect(player.spouse).toBe(npc.id);
        Relationships.syncFolk(player, world);
        expect(m.person.away.withPlayer).toBe('wed');
    });

    it('relationship ageing follows the roster for townsfolk at home', () => {
        const { world, folk, player } = setup();
        const p = adult(folk, world);
        const { npc } = Relationships.fromTownsperson(player, world, folk, p);
        world.day = Y * 3;
        Relationships.processAging(player, world);
        expect(npc.age).toBe(Townsfolk.age(p, world.day));
    });
});

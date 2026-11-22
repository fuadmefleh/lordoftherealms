// Betrothals as diplomacy (systems/betrothals.js): a child — even an infant —
// promised to a rival House's child or a foreign crown's prince on negotiated
// terms (whose line, a ward, coin and land), the bond while it stands
// (truces the AI reads), the wedding through the marriage code (a claim from
// a royal match), breaking it from either side, a maimed betrothed, the rival
// Houses' own promises, offers to the player, and the save.

import { describe, it, expect, beforeAll } from 'vitest';
import { House } from '../systems/house.js';
import { HeirAgency } from '../systems/heirAgency.js';
import { Heirs } from '../systems/heirs.js';
import { Upbringing } from '../systems/upbringing.js';
import { Betrothals, CrownMatches } from '../systems/betrothals.js';
import { Relationships } from '../systems/relationships.js';
import { DynastyTree } from '../systems/dynastyTree.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { Throne } from '../systems/throne.js';
import { Raising } from '../systems/raising.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Kingship } from '../systems/kingship.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { loadData } from './playtest/harness.js';
import { ActionMenu } from '../ui/actionMenu/_ref.js';
import '../ui/actionMenu/matches.js';

beforeAll(async () => {
    await loadData();
});

function makeWorld(day = 40) {
    const lord = (name, kid) => ({ name, kingdomId: kid, age: 50, traits: [], honor: 6, martial: 5, diplomacy: 5, stewardship: 5, relationships: {}, goals: [] });
    const world = {
        day, width: 30, height: 20, units: [], events: [], generationParams: { seed: 4242 },
        kingdoms: [
            { id: 'k1', name: 'Arvenland', ruler: 'Queen Maud', isAlive: true, wars: [], allies: [], relations: {}, culture: 'Imperial', military: 200, territory: [], treasury: 5000,
                characterData: { ruler: { id: 'r1', firstName: 'Maud', traits: [] }, children: [
                    { id: 'p1', firstName: 'Osric', dynasty: 'Arven', gender: 'male', age: 6, isAlive: true },
                    { id: 'p2', firstName: 'Hal', dynasty: 'Arven', gender: 'male', age: 3, isAlive: true },
                ] },
                lord: lord('Queen Maud', 'k1') },
            { id: 'k2', name: 'Belmarch', ruler: 'King Osric', isAlive: true, wars: [], allies: [], relations: {}, culture: 'Imperial', military: 180, territory: [], treasury: 3000,
                characterData: { ruler: { id: 'r2', firstName: 'Osric' }, children: [] }, lord: lord('King Osric', 'k2') },
            { id: 'k3', name: 'Carrow', ruler: 'King Bran', isAlive: true, wars: [], allies: [], relations: {}, culture: 'Imperial', military: 150, territory: [], treasury: 2000,
                characterData: { ruler: { id: 'r3', firstName: 'Bran' }, children: [] }, lord: lord('King Bran', 'k3') },
        ],
        getTile: () => null,
        getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
        getSettlementViews: () => [],
        getAllSettlements: () => [],
    };
    return world;
}

function rival(kid, name, kids, extra = {}) {
    return {
        kingdomId: kid, name, feud: 20, gold: 2000, renown: 10, memory: [], log: [], events: [], ties: {}, standing: {},
        head: { firstName: 'Corwin', gender: 'male', age: 44, traits: [], persona: { honour: 5 }, spouse: { firstName: 'Ysolde', gender: 'female', age: 40 }, children: kids },
        ...extra,
    };
}

function makePlayer(world) {
    const p = new Player();
    p.firstName = 'Aldric';
    p.lastName = 'Vane';
    p.name = 'Aldric Vane';
    p.gold = 5000;
    p.age = 45;
    p.reputation = { k1: 30, k2: 10, k3: 10 };
    p.relationships = {};
    p.children = [];
    p.army = [];
    House.initialize(p, world);
    p.house.prestige = 100;
    p.house.rivals = {
        k2: rival('k2', 'House Varr', [{ firstName: 'Brenna', gender: 'female', age: 2 }, { firstName: 'Tam', gender: 'male', age: 9 }]),
        k3: rival('k3', 'House Holt', [{ firstName: 'Gareth', gender: 'male', age: 4 }]),
    };
    return p;
}

let nextId = 1;
function addChild(player, extra = {}) {
    const c = {
        id: `bt_${nextId++}`, firstName: extra.firstName || 'Edda', dynasty: 'Vane', gender: 'female', age: 1, isAlive: true,
        traits: [], strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    if (c.age >= 16) c.upbringing.comeOfAge = true;
    player.children.push(c);
    return c;
}

describe('suitors and terms', () => {
    it('an infant can be promised: rival children, princes and realms come up, of the other sex and a near age', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const babe = addChild(player, { gender: 'female', age: 0 });
        const s = Betrothals.suitors(player, world, babe.id);
        const ids = s.map(x => x.id);
        expect(ids).toContain('rival:k3:Gareth');
        expect(ids).toContain('royal:k1:p1');
        expect(ids).toContain('noble:k2');
        // (no girls for a girl)
        expect(ids).not.toContain('rival:k2:Brenna');
        const osric = s.find(x => x.id === 'royal:k1:p1');
        expect(osric.heir).toBe(true);
    });

    it('the price moves with the terms: their child taking your name costs more, yours raised at their court less', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const c = addChild(player, { gender: 'female', age: 8 });
        const plain = Betrothals.quote(player, world, c.id, 'royal:k1:p1', { line: 'theirs', ward: 'none' });
        const ours = Betrothals.quote(player, world, c.id, 'royal:k1:p1', { line: 'ours', ward: 'none' });
        const pledge = Betrothals.quote(player, world, c.id, 'royal:k1:p1', { line: 'theirs', ward: 'oursThere' });
        expect(plain.ok).toBe(true);
        expect(ours.ask).toBeGreaterThan(plain.ask);
        expect(pledge.ask).toBeLessThan(plain.ask);
        // A greater House pays less (status): same terms, more Prestige
        player.house.prestige = 800;
        const great = Betrothals.quote(player, world, c.id, 'royal:k1:p1', { line: 'theirs', ward: 'none' });
        expect(great.ask).toBeLessThan(plain.ask);
    });

    it('a hot feud or a war closes the door', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const c = addChild(player, { gender: 'female', age: 3 });
        player.house.rivals.k3.feud = 90;
        const s = Betrothals.suitors(player, world, c.id).find(x => x.id === 'rival:k3:Gareth');
        expect(s.ok).toBe(false);
        expect(Betrothals.propose(player, world, c.id, s.id, {}).success).toBe(false);
    });
});

describe('a promise to a rival House', () => {
    it('half the dowry into their purse now; a truce and a cooling feud while it stands; the wedding keeps it', () => {
        const world = makeWorld(42);
        const player = makePlayer(world);
        const rv = player.house.rivals.k3;
        const c = addChild(player, { gender: 'female', age: 4 });
        const q = Betrothals.quote(player, world, c.id, 'rival:k3:Gareth', { line: 'theirs', ward: 'none' });
        const gold0 = player.gold;
        const purse0 = rv.gold;
        const res = Betrothals.propose(player, world, c.id, 'rival:k3:Gareth', { line: 'theirs', ward: 'none' });
        expect(res.success).toBe(true);
        const b = Betrothals.of(c);
        expect(b.kind).toBe('rival');
        expect(b.dowry).toBe(q.now);
        expect(player.gold).toBeCloseTo(gold0 - q.now, 2);
        expect(rv.gold).toBeCloseTo(purse0 + q.now, 2);
        expect(rv.head.children[0].betrothed.childId).toBe(c.id);
        // Kinship: the realm is slower to join a league
        expect(Heirs.kinshipWith(player, 'k3')).toBe('betrothed');
        // The bond: a truce (no plots, agents, ambush) and the feud eases
        rv.feud = 30;
        world.day = 49;
        Betrothals.processDay(player, world);
        expect(RivalHouses.inTruce(rv, world)).toBe(true);
        expect(rv.feud).toBeLessThan(30);
        // The other House's yearly matches pass a promised child by
        expect(RivalHouses.matchableChildren(rv).map(x => x.firstName)).not.toContain('Gareth');
        // Both come of age: the wedding
        c.age = 16; c.upbringing.comeOfAge = true;
        rv.head.children[0].age = 17;
        world.day = 50;
        const out = Betrothals.processDay(player, world);
        expect(out.notices.some(n => n.title === 'A Promise Kept')).toBe(true);
        expect(Betrothals.of(c)).toBe(null);
        expect(c.upbringing.spouse.rivalHouse).toBe('House Holt');
        expect(rv.head.children[0].wed).toBe(c.firstName);
        expect(Betrothals.state(player).stats.kept).toBe(1);
    });

    it('their child raised at your court: a ward of the House until the wedding', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        player.house.prestige = 400; // (room for a ward)
        const boy = addChild(player, { gender: 'male', age: 8, firstName: 'Piers' });
        // Brenna is two: too young to be sent
        expect(Betrothals.quote(player, world, boy.id, 'rival:k2:Brenna', { ward: 'theirsHere' }).ok).toBe(false);
        const girl = addChild(player, { gender: 'female', age: 9, firstName: 'Ione' });
        const res = Betrothals.propose(player, world, girl.id, 'rival:k2:Tam', { line: 'ours', ward: 'theirsHere' });
        expect(res.success).toBe(true);
        const w = Raising.wards(player).find(x => x.rivalChild === 'Tam');
        expect(w).toBeTruthy();
        expect(player.house.rivals.k2.head.children[1].wardOf).toBe('player');
        // Broken by you: the ward goes home, the feud flares, the lord remembers
        const feud0 = player.house.rivals.k2.feud;
        const br = HeirAgency.breakBetrothal(player, world, girl.id);
        expect(br.success).toBe(true);
        expect(Raising.wards(player).find(x => x.rivalChild === 'Tam')).toBeUndefined();
        expect(player.house.rivals.k2.feud).toBeGreaterThan(feud0);
        expect(world.getKingdom('k2').lord.memory.some(m => m && (m.k === 'betrothal_broken' || m.deed === 'betrothal_broken'))).toBe(true);
        // ...grounds for their suit
        const grounds = RivalHouses.lawGrounds(player, world, player.house.rivals.k2);
        expect(grounds.rival.some(g => g.kind === 'betrothal')).toBe(true);
    });

    it('broken by them: what you paid comes back, and the broken word is yours to sue on', () => {
        const world = makeWorld(60);
        const player = makePlayer(world);
        const rv = player.house.rivals.k3;
        const c = addChild(player, { gender: 'female', age: 5 });
        expect(Betrothals.propose(player, world, c.id, 'rival:k3:Gareth', {}).success).toBe(true);
        const paid = Betrothals.of(c).dowry;
        const gold0 = player.gold;
        const res = Betrothals.breakOff(player, world, c.id, 'a better match', { byThem: true });
        expect(res.refund).toBe(paid);
        expect(player.gold).toBeCloseTo(gold0 + paid, 2);
        expect(rv.brokeWord).toBe(1);
        expect(rv.brokeBetrothal.childId).toBe(c.id);
        expect(rv.head.children[0].betrothed).toBeUndefined();
    });

    it('a maimed betrothed may be put aside without shame', () => {
        const world = makeWorld(60);
        const player = makePlayer(world);
        const c = addChild(player, { gender: 'female', age: 5 });
        Betrothals.propose(player, world, c.id, 'rival:k3:Gareth', {});
        player.house.rivals.k3.head.children[0].maimed = { parts: { eye: 2 }, log: [], taken: [], aids: {} };
        world.day = 61;
        const out = Betrothals.processDay(player, world);
        expect(Betrothals.of(c).flaw).toBe('maimed');
        expect(out.notices.some(n => n.title === 'A Promise in Doubt')).toBe(true);
        const pr0 = player.house.prestige;
        const res = HeirAgency.breakBetrothal(player, world, c.id);
        expect(res.free).toBe(true);
        expect(player.house.prestige).toBe(pr0);
    });

    it('a child of theirs who dies ends it, with no one to blame', () => {
        const world = makeWorld(60);
        const player = makePlayer(world);
        const c = addChild(player, { gender: 'female', age: 5 });
        Betrothals.propose(player, world, c.id, 'rival:k3:Gareth', {});
        player.house.rivals.k3.head.children = [];
        world.day = 62;
        const out = Betrothals.processDay(player, world);
        expect(Betrothals.of(c)).toBe(null);
        expect(out.notices.some(n => n.title === 'A Promise Ended')).toBe(true);
    });
});

describe('a promise to a foreign crown', () => {
    it('a truce the kingdoms\' AI reads, and a marriage claim at the wedding — more for the heir', () => {
        const world = makeWorld(70);
        const player = makePlayer(world);
        // The player rules Carrow
        player.throne = { ruling: { kingdomId: 'k3', since: 1 }, claims: {}, exile: {} };
        world.getKingdom('k3').crown = { playerRuled: true };
        const c = addChild(player, { gender: 'female', age: 5 });
        const res = Betrothals.propose(player, world, c.id, 'royal:k1:p1', { line: 'theirs', ward: 'none' });
        expect(res.success).toBe(true);
        expect(world.getKingdom('k1').characterData.children[0].betrothedTo.childId).toBe(c.id);
        world.day = 77;
        Betrothals.processDay(player, world);
        expect(KingdomAI.hasTruce(world.getKingdom('k1'), world.getKingdom('k3'), world)).toBe(true);
        // The wedding
        c.age = 16; c.upbringing.comeOfAge = true;
        world.getKingdom('k1').characterData.children[0].age = 17;
        world.day = 80;
        Betrothals.processDay(player, world);
        expect(c.upbringing.spouse.kind).toBe('royal');
        expect(world.getKingdom('k1').characterData.children[0].spouseId).toBe(c.id);
        expect(Throne.claimStrength(player, 'k1')).toBeGreaterThanOrEqual(30);
    });
});

describe('the rival Houses among themselves', () => {
    it('Houses on good terms promise their young children, and wed them when grown', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const a = player.house.rivals.k2;
        const b = player.house.rivals.k3;
        RivalHouses.bond(a, b, 60);
        const Y = Betrothals._Y();
        let made = false;
        for (let y = 1; y <= 30 && !made; y++) {
            world.day = Y * y;
            Betrothals._housesYear(player, world, { notices: [] });
            made = !!(a.head.children[0].betrothed && b.head.children[0].betrothed);
        }
        expect(made).toBe(true);
        expect(a.head.children[0].betrothed.name).toBe('Gareth');
        a.head.children[0].age = 20;
        b.head.children[0].age = 20;
        const out = { notices: [] };
        Betrothals._housesYear(player, world, out);
        expect(a.head.children[0].wed).toBe('another House');
        expect(out.notices.some(n => n.title === 'Rival Houses Wed')).toBe(true);
    });
});

describe('offers and the save', () => {
    it('a House on good terms offers a match now and then; accepting seals it at their price', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        player.house.rivals.k3.feud = 5;
        addChild(player, { gender: 'female', age: 2 });
        let offer = null;
        for (let d = 30; d <= 30 * 400 && !offer; d += 30) {
            world.day = d;
            Betrothals._offersDay(player, world, { notices: [] });
            offer = Betrothals.state(player).offers[0] || null;
        }
        expect(offer).toBeTruthy();
        const res = Betrothals.acceptOffer(player, world, offer.id);
        expect(res.success).toBe(true);
        expect(Betrothals.state(player).offers.length).toBe(0);
    });

    it('the record and offers ride in the save', () => {
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('betrothals');
    });

    it('determinism: the same world and day give the same quote and the same offers', () => {
        const run = () => {
            const world = makeWorld();
            const player = makePlayer(world);
            player.house.rivals.k3.feud = 5;
            const c = addChild(player, { gender: 'female', age: 2, id: 'fixed' });
            const days = [];
            for (let d = 30; d <= 30 * 120; d += 30) {
                world.day = d;
                Betrothals._offersDay(player, world, { notices: [] });
                if (Betrothals.state(player).offers.length) { days.push(d); Betrothals.state(player).offers = []; }
            }
            return { q: Betrothals.quote(player, world, c.id, 'rival:k3:Gareth', { line: 'ours' }).ask, days };
        };
        expect(run()).toEqual(run());
    });
});

describe('the Matches panel', () => {
    it('renders the overview, the suitors and the terms, and a click seals the promise', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const c = addChild(player, { gender: 'female', age: 4, firstName: 'Wren' });
        const shown = [];
        const game = { player, world, ui: { showCustomPanel: (t, h) => shown.push({ t, h }), updateStats: () => {}, showNotification: () => {} } };
        ActionMenu.showMatchesPanel(game);
        expect(shown.at(-1).h).toContain('Seek a Match');
        ActionMenu.showMatchSeek(game, c.id);
        expect(shown.at(-1).h).toContain('Gareth Holt');
        expect(shown.at(-1).h).toContain('Foreign Crowns');
        ActionMenu.showMatchTerms(game, c.id, 'rival:k3:Gareth', 'ours', 'none', null);
        expect(shown.at(-1).h).toContain('takes your name');
        ActionMenu.matchesDo(game, 'propose', c.id, 'rival:k3:Gareth', 'ours', 'none', null);
        expect(Betrothals.of(c).terms.line).toBe('ours');
        expect(shown.at(-1).h).toContain('Promised');
        ActionMenu.matchesDo(game, 'breakAsk', c.id);
        expect(shown.at(-1).h).toContain('Prestige');
        ActionMenu.matchesDo(game, 'break', c.id);
        expect(Betrothals.of(c)).toBe(null);
    });
});

describe('a promise to a lord of your realm', () => {
    it('the lord is favoured while it stands, and his house is kin at the wedding', () => {
        const world = makeWorld(90);
        const player = makePlayer(world);
        player.throne = { ruling: { kingdomId: 'k3', since: 1 }, claims: {}, exile: {} };
        const court = Kingship.court(player);
        court.vassals.push({ id: 'vassal_9', firstName: 'Odo', dynasty: 'Marr', gender: 'male', age: 40, culture: 'Imperial', traits: [], goals: [], favour: 0, grudge: 0, kin: false, opinion: 10 });
        const c = addChild(player, { gender: 'male', age: 6 });
        const s = Betrothals.suitors(player, world, c.id).find(x => x.kind === 'vassal');
        expect(s).toBeTruthy();
        expect(Betrothals.propose(player, world, c.id, s.id, {}).success).toBe(true);
        expect(court.vassals[0].favour).toBeGreaterThan(0);
        c.age = 16; c.upbringing.comeOfAge = true;
        world.day = 91 + 10 * Betrothals._Y();
        Betrothals.processDay(player, world);
        expect(court.vassals[0].kin).toBe(true);
        expect(c.upbringing.spouse.kind).toBe('vassal');
    });
});

describe('a vassal match takes a ward', () => {
    it('your child raised in the lord\'s hall, or his at your court; the lord\'s favour grows monthly', () => {
        const world = makeWorld(90);
        const player = makePlayer(world);
        player.house.prestige = 400;
        player.throne = { ruling: { kingdomId: 'k3', since: 1 }, claims: {}, exile: {} };
        const court = Kingship.court(player);
        court.vassals.push({ id: 'vassal_7', firstName: 'Odo', dynasty: 'Marr', gender: 'male', age: 40, culture: 'Imperial', traits: [], goals: [], favour: 0, grudge: 0, kin: false, opinion: 10 });
        court.vassals.push({ id: 'vassal_8', firstName: 'Ida', dynasty: 'Fenn', gender: 'female', age: 38, culture: 'Imperial', traits: [], goals: [], favour: 0, grudge: 0, kin: false, opinion: 10 });
        const c = addChild(player, { gender: 'male', age: 8 });
        const res = Betrothals.propose(player, world, c.id, 'vassal:vassal_7', { ward: 'oursThere' });
        expect(res.success).toBe(true);
        expect(c.upbringing.placement.kind).toBe('ward');
        expect(c.upbringing.placement.vassalId).toBe('vassal_7');
        expect(c.upbringing.tutor.kind).toBe('host');
        expect(HeirAgency.isAway(c)).toBe(true);
        const f0 = court.vassals[0].favour;
        world.day = 120;
        Betrothals.processDay(player, world);
        expect(court.vassals[0].favour).toBe(f0 + 1);
        // His child at your court: a ward with no fee
        const d = addChild(player, { gender: 'female', age: 8 });
        expect(Betrothals.propose(player, world, d.id, 'vassal:vassal_8', { ward: 'theirsHere' }).success).toBe(true);
        expect(Raising.wards(player).find(x => x.vassalId === 'vassal_8')).toBeTruthy();
    });
});

describe('whose House the children are', () => {
    function wedRival(line) {
        const world = makeWorld(42);
        const player = makePlayer(world);
        const rv = player.house.rivals.k3;
        const c = addChild(player, { gender: 'female', age: 4 });
        Betrothals.propose(player, world, c.id, 'rival:k3:Gareth', { line });
        c.age = 18; c.upbringing.comeOfAge = true;
        rv.head.children[0].age = 18;
        world.day = 50;
        Betrothals.processDay(player, world);
        const Y = Betrothals._Y();
        for (let y = 1; y <= 12; y++) { world.day = Y * y; Betrothals.processDay(player, world); c.age++; }
        return { world, player, rv, c };
    }

    it('their name taken: the children are of your House, in the tree, and come to the seat with their parent', () => {
        const { world, player, c } = wedRival('ours');
        const issue = Betrothals.issue(c, world);
        expect(issue.length).toBeGreaterThan(0);
        const L = DynastyTree.sync(player, world, { npc: () => null });
        expect(L.people[issue[0].id].parents).toContain(c.id);
        const before = player.children.length;
        const born = Relationships._heirsOwnChildren(player, c, null, world);
        expect(born.map(k => k.firstName)).toEqual(issue.map(i => i.first));
        expect(player.children.length).toBe(before + issue.length);
    });

    it('your child gone to them: the children are of their House, and when their parent heads it, its heirs', () => {
        const { world, player, rv, c } = wedRival('theirs');
        const issue = Betrothals.issue(c, world);
        expect(issue.length).toBeGreaterThan(0);
        expect(Relationships._heirsOwnChildren(player, c, null, world)).toEqual([]);
        // Gareth inherits his House: the grandchildren are its children
        rv.head = { ...rv.head, firstName: 'Gareth', children: [] };
        Betrothals._bloodSync(player, world, c.upbringing.spouse);
        expect(rv.head.children.map(x => x.firstName)).toEqual(issue.map(i => i.first));
        expect(RivalHouses.heirOf(rv, { any: true }).bloodOf).toBe(player.house.name);
    });

    it('a royal line with your blood in it: a claim by blood, greater once the grandchild is the crown\'s heir', () => {
        const world = makeWorld(42);
        const player = makePlayer(world);
        const c = addChild(player, { gender: 'female', age: 5 });
        Betrothals.propose(player, world, c.id, 'royal:k1:p1', { line: 'theirs' });
        c.age = 18; c.upbringing.comeOfAge = true;
        const k1 = world.getKingdom('k1');
        k1.characterData.children[0].age = 19;
        world.day = 50;
        Betrothals.processDay(player, world);
        expect(c.upbringing.spouse.royalId).toBe('p1');
        c.upbringing.spouse.issue.push({ id: 'is_x', first: 'Tamsin', gender: 'female', born: 40, alive: true });
        Betrothals._bloodSync(player, world, c.upbringing.spouse);
        expect(player.throne.claims.k1.sources.blood).toBe(12);
        // Osric is crowned: his children by your daughter are the crown's children, its line of succession
        k1.characterData.ruler = k1.characterData.children.shift();
        k1.characterData.children = [];
        Betrothals._bloodSync(player, world, c.upbringing.spouse);
        expect(k1.characterData.children[0].bloodOf).toBe(player.house.name);
        expect(player.throne.claims.k1.sources.blood).toBe(25);
    });
});

describe('the crowns among themselves', () => {
    it('realms on good terms promise their royal children, keep a truce, and wed them into an alliance', () => {
        const world = makeWorld();
        const k1 = world.getKingdom('k1');
        const k2 = world.getKingdom('k2');
        k2.characterData.children = [{ id: 'q1', firstName: 'Liesl', gender: 'female', age: 5, isAlive: true }];
        k1.relations.k2 = 40; k2.relations.k1 = 40;
        const Y = Betrothals._Y();
        let found = false;
        for (let y = 1; y <= 40 && !found; y++) {
            world.day = Y * y;
            CrownMatches.processDay(world);
            found = !!k2.characterData.children[0].betrothedTo;
        }
        expect(found).toBe(true);
        const partner = k1.characterData.children.find(c => c.betrothedTo);
        expect(partner.betrothedTo.royalId).toBe('q1');
        // A promised royal is no suitor for the player's children
        const player = makePlayer(world);
        const babe = addChild(player, { gender: 'male', age: 5 });
        expect(Betrothals.suitors(player, world, babe.id).some(s => s.id === 'royal:k2:q1')).toBe(false);
        world.day += 7 - (world.day % 7);
        CrownMatches.processDay(world);
        expect(KingdomAI.hasTruce(k1, k2, world)).toBe(true);
        partner.age = 17; k2.characterData.children[0].age = 16;
        world.day = Y * 100;
        CrownMatches.processDay(world);
        expect(k2.characterData.children[0].spouseId).toBe(partner.id);
        expect(k1.allies).toContain('k2');
        expect(k2.allies).toContain('k1');
    });

    it('a war breaks the promise', () => {
        const world = makeWorld(7);
        const k1 = world.getKingdom('k1');
        const k2 = world.getKingdom('k2');
        k2.characterData.children = [{ id: 'q1', firstName: 'Liesl', gender: 'female', age: 5, isAlive: true, betrothedTo: { kingdomId: 'k1', royalId: 'p1' } }];
        k1.characterData.children[0].betrothedTo = { kingdomId: 'k2', royalId: 'q1' };
        k1.wars = ['k2'];
        CrownMatches.processDay(world);
        expect(k1.characterData.children[0].betrothedTo).toBeUndefined();
        expect(k2.characterData.children[0].betrothedTo).toBeUndefined();
    });
});

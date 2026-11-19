// The years away that make a child (systems/heirPaths.js): formative paths
// (squire, apprentice, novice, scholar, fostered abroad) paid to real payees,
// growing the child and leaving named contacts; a host court that sours keeps
// the child as a hostage and makes demands (pay, refuse, rescue; a child held
// too long turns); wards kept as leverage; and what the years away carry into
// a reign — friends, tongues, a line in the Annals.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { House } from '../systems/house.js';
import { HeirAgency } from '../systems/heirAgency.js';
import { HeirPaths } from '../systems/heirPaths.js';
import { Upbringing } from '../systems/upbringing.js';
import { Raising } from '../systems/raising.js';
import { Relationships } from '../systems/relationships.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { Player } from '../player/player.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

let basePaths;
let baseRivalWards;
beforeAll(async () => {
    await loadData();
    basePaths = JSON.parse(JSON.stringify(DataLoader.upbringing.paths));
    baseRivalWards = JSON.parse(JSON.stringify(DataLoader.upbringing.raising.wards.rival));
});
afterEach(() => {
    DataLoader.upbringing.paths = JSON.parse(JSON.stringify(basePaths));
    DataLoader.upbringing.raising.wards.rival = JSON.parse(JSON.stringify(baseRivalWards));
});

const _turn = (child) => Number(child.upbringing.turn) || 0;

function makeWorld(day = 40) {
    const lord = (name, kid, traits) => ({ name, kingdomId: kid, age: 50, traits, honor: 6, martial: 5, diplomacy: 5, stewardship: 5, relationships: {}, goals: [] });
    const guildTown = {
        name: 'Wexford', q: 3, r: 4, type: 'town', kingdom: 'k2', population: 2000, economy: { gold: 500 },
        guilds: { weavers: { id: 'weavers', name: 'Weavers of Wexford', master: { name: 'Hugh Webb', player: false }, treasury: 0, prosperity: 1 } },
    };
    const capital = { name: 'Arvenhold', q: 8, r: 2, type: 'capital', kingdom: 'k1', population: 4000, economy: { gold: 800 } };
    const tiles = { '3,4': { settlement: guildTown }, '8,2': { settlement: capital } };
    const world = {
        day, width: 30, height: 20, units: [], events: [], generationParams: { seed: 777 },
        kingdoms: [
            { id: 'k1', name: 'Arvenland', ruler: 'Queen Maud', isAlive: true, wars: [], allies: [], relations: {}, culture: 'Imperial', traits: ['militaristic'], military: 200, territory: [],
                treasury: 1000, capital: { q: 8, r: 2 }, temples: [{ type: 'cathedral', at: 'Arvenhold' }],
                characterData: { ruler: { firstName: 'Maud', traits: [{ id: 'brave' }] } }, lord: lord('Queen Maud', 'k1', [{ id: 'brave', name: 'Brave' }]) },
            { id: 'k2', name: 'Belmarch', ruler: 'King Osric', isAlive: true, wars: [], allies: [], relations: {}, culture: 'Nordic', traits: ['mercantile'], military: 180, territory: [],
                treasury: 1000, lord: lord('King Osric', 'k2', [{ id: 'greedy', name: 'Greedy' }]) },
        ],
        getTile: (q, r) => tiles[`${q},${r}`] || null,
        getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
        getSettlementViews: () => [guildTown, capital],
        getAllSettlements: () => [guildTown, capital],
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
    p.q = 4;
    p.r = 4;
    p.reputation = { k1: 10, k2: 5 };
    p.relationships = {};
    p.children = [];
    p.army = [];
    p.nativeLanguage = 'vellish';
    p.languages = { vellish: 100 };
    House.initialize(p, world);
    return p;
}

let nextId = 1;
function addChild(player, extra = {}) {
    const c = {
        id: `hp_${nextId++}`, firstName: extra.firstName || 'Edda', dynasty: 'Vane', gender: 'female', age: 11, isAlive: true,
        traits: [], strength: 5, charisma: 5, intelligence: 5, faith: 5, luck: 5,
        skills: { commerce: 0, combat: 0, leadership: 0, diplomacy: 0, stealth: 0, cartography: 0 }, health: 100, maxHealth: 100, ...extra,
    };
    Upbringing.ensure(c);
    if (c.age >= 16) c.upbringing.comeOfAge = true;
    player.children.push(c);
    return c;
}

/** Days pass: children age yearly; upbringing, agency, raising and paths run. */
function live(player, world, days) {
    const notices = [];
    for (let i = 0; i < days; i++) {
        world.day++;
        if (world.day % 120 === 0) for (const c of player.children) if (c.isAlive) c.age++;
        Upbringing.processDay(player, world);
        notices.push(...HeirAgency.processDay(player, world).notices);
        notices.push(...Raising.processDay(player, world).notices);
        notices.push(...HeirPaths.processDay(player, world).notices);
    }
    return notices;
}

describe('formative paths', () => {
    it('offers real places: courts and rival halls, guild masters, church houses, schools, households of another tongue', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        player.house.rivals = { k2: { kingdomId: 'k2', name: 'House Osric', feud: 20, gold: 400 } };
        const child = addChild(player);
        const court = HeirPaths.venues(player, world, 'squire', child);
        expect(court.map(v => v.key)).toEqual(expect.arrayContaining(['k:k1', 'k:k2', 'rival:k2']));
        const guild = HeirPaths.venues(player, world, 'apprentice', child);
        expect(guild[0]).toMatchObject({ key: 'guild:3,4:weavers', master: 'Hugh Webb', payee: { type: 'guild', gid: 'weavers' } });
        const church = HeirPaths.venues(player, world, 'novice', child).map(v => v.note);
        expect(church).toEqual(expect.arrayContaining(['cathedral', 'priory']));
        const school = HeirPaths.venues(player, world, 'scholar', child).map(v => v.note);
        expect(school).toEqual(expect.arrayContaining(['cathedral school', 'university']));
        // Only realms whose tongue the child lacks (Arvenland speaks the House's own)
        const abroad = HeirPaths.venues(player, world, 'abroad', child);
        expect(abroad.map(v => v.kingdomId)).toEqual(['k2']);
        expect(abroad[0].language).toBe('norrish');
    });

    it('a squire pays the host crown, goes away, is taught by the court and comes home with friends who remember', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const child = addChild(player, { age: 11 });
        const t0 = world.kingdoms[0].treasury;
        const g0 = player.gold;
        const res = HeirPaths.begin(player, world, child.id, 'squire', 'k:k1');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(g0 - 120);
        expect(world.kingdoms[0].treasury).toBe(t0 + 120);
        expect(HeirAgency.isAway(child)).toBe(true);
        expect(Upbringing.isAway(child)).toBe(true);
        expect(child.upbringing.tutor).toMatchObject({ kind: 'path', focus: 'martial' });
        expect(HeirAgency.status(player, world, child)).toMatch(/Away at the court of/);
        // Named contacts: real relationship NPCs who know whose child this is
        expect(res.contacts.length).toBe(2);
        for (const c of res.contacts) expect(Relationships.getNPC(c.npcId).contactOf.childId).toBe(child.id);
        // A second path is barred
        expect(HeirPaths.begin(player, world, child.id, 'novice', 'town:8,2:priory').success).toBe(false);

        const combat0 = child.skills.combat;
        const notices = live(player, world, 4 * 120);
        const up = child.upbringing;
        expect(up.path.active).toBe(false);
        expect(up.pathRecord[0]).toMatchObject({ kind: 'squire', how: 'completed' });
        expect(child.skills.combat).toBeGreaterThan(combat0 + 2);
        // Board was paid each year into the same chests (3 more years at 40)
        expect(world.kingdoms[0].treasury).toBeGreaterThanOrEqual(t0 + 120 + 3 * 40);
        // A court path is a fostering in the record: it pays off at succession
        expect(HeirAgency.ensure(child).record.fostered.some(f => f.path === 'squire' && !f.recalled)).toBe(true);
        // The friends: their regard is earned, and the House knows them now
        for (const c of up.contacts) {
            expect(c.regard).toBeGreaterThan(0);
            expect(player.relationships[c.npcId].score).toBeGreaterThan(0);
        }
        expect(notices.some(n => /Comes Home/.test(n.title))).toBe(true);
        expect(up.seeds.brave).toBeGreaterThanOrEqual(Upbringing.config().seedThreshold);
    });

    it('the path ends before coming of age, and the board unpaid sends the child home early', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const child = addChild(player, { age: 14 });
        const res = HeirPaths.begin(player, world, child.id, 'scholar', 'town:8,2:university');
        expect(res.success).toBe(true);
        // 14 → the path must end before the year they turn 16
        expect(res.path.until).toBeLessThan(HeirPaths._comeOfAgeDay(child, world));
        expect(world.getTile(8, 2).settlement.economy.gold).toBe(800 + 150);
        player.gold = 0;
        live(player, world, 120);
        expect(child.upbringing.pathRecord[0]).toMatchObject({ kind: 'scholar', how: 'unpaid' });
        expect(HeirAgency.isAway(child)).toBe(false);
    });

    it('an apprentice pays the guild\'s hall chest; abroad teaches the host tongue', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const a = addChild(player, { age: 10, firstName: 'Bran', gender: 'male' });
        const b = addChild(player, { age: 10, firstName: 'Cora' });
        expect(HeirPaths.begin(player, world, a.id, 'apprentice', 'guild:3,4:weavers').success).toBe(true);
        expect(world.getTile(3, 4).settlement.guilds.weavers.treasury).toBe(80);
        expect(a.upbringing.contacts.find(c => c.role === 'master').name).toMatch(/^Hugh Webb/);
        expect(HeirPaths.begin(player, world, b.id, 'abroad', 'abroad:k2').success).toBe(true);
        live(player, world, 3 * 120);
        expect(b.languages.norrish).toBeGreaterThanOrEqual(80);
        expect(b.upbringing.contacts.find(c => c.role === 'fosterSibling').gender).toBe('male');
    });

    it('draws the same contacts for the same world, child and day', () => {
        const names = () => {
            const world = makeWorld();
            const player = makePlayer(world);
            const child = addChild(player, { id: 'same_child' });
            return HeirPaths.begin(player, world, child.id, 'squire', 'k:k1').contacts.map(c => `${c.name}:${c.gender}`);
        };
        Utils.setSeed(1);
        const a = names();
        Utils.setSeed(999);
        expect(names()).toEqual(a);
    });
});

describe('hostages and leverage', () => {
    it('a soured host keeps the child, demands a price into its chests, and paying brings them home', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const child = addChild(player, { age: 11 });
        HeirPaths.begin(player, world, child.id, 'squire', 'k:k1');
        player.reputation.k1 = -100;
        const notices = live(player, world, 30);
        const held = child.upbringing.heldBy;
        expect(held).toMatchObject({ kingdomId: 'k1', path: 'squire' });
        expect(held.demand.amount).toBeGreaterThan(0);
        expect(notices.some(n => /Terms for/.test(n.title))).toBe(true);
        const t0 = world.kingdoms[0].treasury;
        const g0 = player.gold;
        const res = HeirPaths.payDemand(player, world, child.id);
        expect(res.success).toBe(true);
        expect(player.gold).toBeCloseTo(g0 - res.cost, 2);
        expect(world.kingdoms[0].treasury).toBeCloseTo(t0 + res.cost, 2);
        expect(child.upbringing.heldBy).toBeUndefined();
        expect(child.upbringing.pathRecord[0].how).toBe('ransomed');
        expect(HeirAgency.isAway(child)).toBe(false);
    });

    it('the church holds no hostages', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const child = addChild(player, { age: 11 });
        HeirPaths.begin(player, world, child.id, 'novice', 'town:8,2:priory');
        player.reputation.k1 = -100;
        live(player, world, 60);
        expect(child.upbringing.heldBy).toBeUndefined();
    });

    it('refused terms turn the child; a turned child is a worse officer and a mark at succession', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        player.house.rivals = { k2: { kingdomId: 'k2', name: 'House Osric', feud: 20, gold: 400 } };
        const child = addChild(player, { age: 11 });
        expect(HeirPaths.begin(player, world, child.id, 'squire', 'rival:k2').success).toBe(true);
        expect(player.house.rivals.k2.feud).toBe(10);
        // The rival's AI: a hot feud and the child is theirs to bargain with
        player.house.rivals.k2.feud = 80;
        live(player, world, 30);
        const up = child.upbringing;
        expect(up.heldBy).toMatchObject({ kingdomId: 'k2', rival: true });
        for (let i = 0; i < 12 && !up.turned; i++) {
            if (up.heldBy.demand) HeirPaths.refuseDemand(player, world, child.id);
            live(player, world, 30);
        }
        expect(up.turned).toBeTruthy();
        expect(up.seeds.deceitful).toBeGreaterThan(0);
        const plan = HeirPaths.payoffLines(player, world, child);
        expect(plan.lines.some(l => /Turned/.test(l.text))).toBe(true);
        expect(plan.prestige).toBeLessThan(0);
        // A rival's demand is paid into the rival's purse
        const g0 = player.house.rivals.k2.gold;
        if (!up.heldBy.demand) HeirPaths._demand(player, world, child, { notices: [] });
        const res = HeirPaths.payDemand(player, world, child.id);
        expect(res.success).toBe(true);
        expect(player.house.rivals.k2.gold).toBeCloseTo(g0 + res.cost, 2);
    });

    it('a rescue is a gamble paid to hired blades', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const child = addChild(player, { age: 11 });
        HeirPaths.begin(player, world, child.id, 'squire', 'k:k1');
        player.reputation.k1 = -100;
        live(player, world, 20);
        expect(child.upbringing.heldBy).toBeTruthy();
        DataLoader.upbringing.paths.hostage.rescueMin = 1;
        DataLoader.upbringing.paths.hostage.rescueMax = 1;
        const g0 = player.gold;
        const res = HeirPaths.rescue(player, world, child.id);
        expect(res.rescued).toBe(true);
        expect(player.gold).toBe(g0 - 80);
        expect(child.upbringing.heldBy).toBeUndefined();
    });

    it('a ward kept as a hostage pays no fee and costs standing; ransomed, their crown pays into the purse', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        player.reputation.k1 = 30;
        const res = Raising.takeWard(player, world, 'k1');
        expect(res.success).toBe(true);
        const ward = res.ward;
        expect(HeirPaths.keepWard(player, world, ward.id).success).toBe(true);
        expect(player.reputation.k1).toBe(22);
        const fees0 = ward.feesPaid || 0;
        live(player, world, 30);
        expect(ward.feesPaid || 0).toBe(fees0);
        expect(player.reputation.k1).toBeLessThan(22);
        const t0 = world.kingdoms[0].treasury;
        const g0 = player.gold;
        const r = HeirPaths.ransomWard(player, world, ward.id);
        expect(r.success).toBe(true);
        expect(player.gold).toBeCloseTo(g0 + r.paid, 2);
        expect(world.kingdoms[0].treasury).toBeCloseTo(t0 - r.paid, 2);
        expect(Raising.wards(player).length).toBe(0);
    });
});

describe('the interregnum', () => {
    it('a held child\'s terms do not lapse and the child does not turn while the House waits; the clocks run again on return', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const child = addChild(player, { age: 11 });
        HeirPaths.begin(player, world, child.id, 'squire', 'k:k1');
        player.reputation.k1 = -100;
        live(player, world, 30);
        const held = child.upbringing.heldBy;
        expect(held.demand).toBeTruthy();
        const due0 = held.demand.due, turn0 = _turn(child), demands0 = held.demands;
        // The ruler dies; the House waits in trust for months
        player.interregnum = { since: world.day };
        live(player, world, 150);
        expect(child.upbringing.heldBy.demand).toBeTruthy();
        expect(child.upbringing.heldBy.demand.due).toBe(due0 + 150);
        expect(child.upbringing.heldBy.demands).toBe(demands0);
        expect(_turn(child)).toBe(turn0);
        expect(held.paused).toBe(150);
        // An heir returns: the terms fall due as they would have, and the turning goes on
        delete player.interregnum;
        const notices = live(player, world, due0 + 150 - world.day + 1);
        expect(notices.some(n => /Terms Refused/.test(n.title))).toBe(true);
        expect(_turn(child)).toBeGreaterThan(turn0);
    });
});

describe('rival Houses send their own children', () => {
    function withRival(world, player, extra = {}) {
        player.house.rivals = {
            k2: { kingdomId: 'k2', name: 'House Osric', feud: 20, gold: 1000, renown: 0, standing: {}, memory: [], log: [], ties: {},
                head: { firstName: 'Osric', gender: 'male', age: 44, traits: [], children: [{ firstName: 'Wulf', gender: 'male', age: 9 }], persona: { honour: 6 } }, ...extra },
        };
        return player.house.rivals.k2;
    }
    function setRival(fields) {
        Object.assign(DataLoader.upbringing.raising.wards.rival, fields);
    }

    it('a rival sends a child to be raised at your court: their fee into your purse, the feud cools, and they dare not plot', () => {
        const world = makeWorld(30);
        const player = makePlayer(world);
        const rv = withRival(world, player, { feud: 65 });
        // A House this bitter keeps its children home
        setRival({ chance: 1 });
        HeirPaths._rivalChildrenDay(player, world, { notices: [] });
        expect(Raising.wards(player).length).toBe(0);
        rv.feud = 30;
        const out = { notices: [] };
        HeirPaths._rivalChildrenDay(player, world, out);
        const ward = Raising.wards(player)[0];
        expect(ward).toMatchObject({ rivalId: 'k2', firstName: 'Wulf', kingdomName: 'House Osric' });
        expect(rv.head.children[0].wardOf).toBe('player');
        expect(out.notices.some(n => /Sends a Child/.test(n.title))).toBe(true);
        // A realm's ward is not barred by a rival's child of the same realm
        expect(Raising._wardBarred(player, world, world.kingdoms[1])).not.toMatch(/already lives/);
        // While their child lives under your roof they will not plot against you
        rv.feud = 65;
        expect(RivalHouses.hostsChild(player, rv)).toBe(true);
        expect(RivalHouses._scores(player, world, rv, { q: 8, r: 2 }).scores.shadow).toBe(0);
        rv.feud = 30;
        const g0 = player.gold, rg0 = rv.gold;
        live(player, world, 30);
        expect(player.gold - g0).toBeCloseTo(8, 2);
        expect(rg0 - rv.gold).toBeCloseTo(8, 2);
        expect(rv.feud).toBe(29);
        expect(ward.feesPaid).toBe(8);
    });

    it('a rival\'s child kept as a hostage: the feud grows; ransomed, the rival pays from its purse into yours', () => {
        const world = makeWorld(30);
        const player = makePlayer(world);
        const rv = withRival(world, player);
        setRival({ chance: 1 });
        HeirPaths._rivalChildrenDay(player, world, { notices: [] });
        const ward = Raising.wards(player)[0];
        expect(HeirPaths.keepWard(player, world, ward.id).success).toBe(true);
        expect(rv.feud).toBe(30);
        expect(rv.memory.some(m => m.kind === 'threatened')).toBe(true);
        const g0 = player.gold, rg0 = rv.gold;
        const r = HeirPaths.ransomWard(player, world, ward.id);
        expect(r.success).toBe(true);
        expect(r.paid).toBe(150);
        expect(player.gold - g0).toBeCloseTo(150, 2);
        expect(rg0 - rv.gold).toBeCloseTo(150, 2);
        expect(rv.feud).toBe(45);
        expect(Raising.wards(player).length).toBe(0);
        expect(rv.head.children[0].wardAt).toBeUndefined();
    });

    it('with no seat at your court, a rival sends its child to a House it is friendly with, and they grow closer', () => {
        const world = makeWorld(30);
        const player = makePlayer(world);
        const rv = withRival(world, player, { feud: 60 });
        player.house.rivals.k1 = { kingdomId: 'k1', name: 'House Maud', feud: 10, gold: 500, ties: {}, head: { firstName: 'Maud', age: 40, traits: [], children: [] }, log: [] };
        RivalHouses.bond(rv, player.house.rivals.k1, 30);
        setRival({ chance: 1 });
        HeirPaths._rivalChildrenDay(player, world, { notices: [] });
        const c = rv.head.children[0];
        expect(c.wardAt).toBe('House Maud');
        expect(RivalHouses.tie(rv, player.house.rivals.k1)).toBe(40);
        world.day = c.wardUntil;
        world.day += (30 - (world.day % 30)) % 30;
        HeirPaths._rivalChildrenDay(player, world, { notices: [] });
        expect(c.wardAt).toBeUndefined();
        expect(RivalHouses.tie(rv, player.house.rivals.k1)).toBe(45);
    });

    it('a squire\'s fellow squire is a real child of the host House', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const rv = withRival(world, player);
        rv.head.children[0].age = 12;
        const child = addChild(player, { age: 11 });
        const res = HeirPaths.begin(player, world, child.id, 'squire', 'rival:k2');
        expect(res.success).toBe(true);
        const fellow = res.contacts.find(c => c.role === 'squire');
        expect(fellow.name).toBe('Wulf Osric');
        expect(fellow.hostChild).toMatchObject({ rivalId: 'k2', firstName: 'Wulf' });
        expect(rv.head.children[0].squireWith).toMatchObject({ childId: child.id });
        expect(Relationships.getNPC(fellow.npcId).age).toBe(12);
    });
});

describe('the panels', () => {
    it('a child page offers the paths and places; held, it offers the terms; the wards panel offers leverage', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const world = makeWorld();
        const player = makePlayer(world);
        const kid = addChild(player, { age: 11 });
        const panels = [];
        const game = { player, world, ui: { showCustomPanel: (title, html) => panels.push({ title, html }), showNotification: () => {}, updateStats: () => {} } };
        ActionMenu.showChildPanel(game, kid.id);
        expect(panels.at(-1).html).toContain('The Years Away');
        window._heirPathsUI.pick(kid.id, 'squire');
        expect(panels.at(-1).html).toContain(`window._heirPathsUI.begin('${kid.id}','squire','k:k1')`);
        window._heirPathsUI.begin(kid.id, 'squire', 'k:k1');
        expect(kid.upbringing.path.active).toBe(true);
        expect(panels.at(-1).html).toContain('Friends From the Years Away');
        player.reputation.k1 = -100;
        live(player, world, 20);
        ActionMenu.showChildPanel(game, kid.id);
        expect(panels.at(-1).html).toContain(`window._heirPathsUI.pay('${kid.id}')`);
        window._heirPathsUI.pay(kid.id);
        expect(kid.upbringing.heldBy).toBeUndefined();

        player.reputation.k2 = 30;
        Raising.takeWard(player, world, 'k2');
        ActionMenu.showHouseWards(game);
        const w = Raising.wards(player)[0];
        expect(panels.at(-1).html).toContain(`window._heirPathsUI.keepWard('${w.id}')`);
        window._heirPathsUI.keepWard(w.id);
        expect(panels.at(-1).html).toContain(`window._heirPathsUI.ransomWard('${w.id}')`);
    });
});

describe('what the years away leave', () => {
    it('the coming-of-age summary tells the path, the friends and the dilemmas, and the chronicle keeps it', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const child = addChild(player, { age: 12 });
        HeirPaths.begin(player, world, child.id, 'novice', 'town:8,2:priory');
        live(player, world, 4 * 120 + 5);
        const s = Raising.comingOfAgeSummary(player, world, child);
        expect(s).toBeTruthy();
        expect(s.text).toMatch(/novice of the church at the priory at Arvenhold/);
        if (child.upbringing.events.length) expect(s.text).toMatch(/remembered for/);
        expect(s.paths[0].kind).toBe('novice');
        expect(player.house.history.some(h => h.tags.includes('comingOfAge'))).toBe(true);
        expect(child.literacy).toBeGreaterThanOrEqual(30);
    });

    it('a grown child can wed a friend of their youth; at succession friends and tongues come to the throne', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const child = addChild(player, { age: 10, gender: 'male', firstName: 'Corin' });
        HeirPaths.begin(player, world, child.id, 'abroad', 'abroad:k2');
        live(player, world, 6 * 120 + 5);
        const up = child.upbringing;
        expect(up.comeOfAge).toBe(true);
        const sib = up.contacts.find(c => c.role === 'fosterSibling');
        const npc = Relationships.getNPC(sib.npcId);
        npc.age = Math.max(16, npc.age);
        sib.regard = Math.max(sib.regard, 40);
        const wed = HeirPaths.wedContact(player, world, child.id, sib.npcId);
        expect(wed.success).toBe(true);
        expect(up.spouse).toMatchObject({ kind: 'contact', npcId: sib.npcId });

        player.heir = child.id;
        const res = Relationships.succeedAsHeir(player, child.id, world, {});
        expect(res.success).toBe(true);
        expect(player.spouse).toBe(sib.npcId);
        expect(player.languages.norrish).toBeGreaterThanOrEqual(80);
        const host = up.contacts.find(c => c.role === 'host');
        expect(player.relationships[host.npcId].score).toBe(Math.round(host.regard));
        const rec = player.house.history.find(h => h.tags.includes('heirRecord'));
        expect(rec.text).toMatch(/Friends from the years away/);
    });

    it('a path and its friends survive a save', () => {
        const game = newGame(4242);
        const { world, player } = game;
        House.initialize(player, world);
        const child = addChild(player, { age: 11 });
        const venue = HeirPaths.venues(player, world, 'squire', child).find(v => !HeirPaths._venueBarred(player, world, v));
        expect(venue).toBeTruthy();
        player.gold = 5000;
        const res = HeirPaths.begin(player, world, child.id, 'squire', venue.key);
        expect(res.success).toBe(true);
        const { player: p2 } = roundTrip(game);
        const c2 = p2.children.find(c => c.id === child.id);
        expect(c2.upbringing.path).toMatchObject({ kind: 'squire', active: true, key: venue.key });
        expect(c2.upbringing.contacts.length).toBe(2);
        for (const c of c2.upbringing.contacts) expect(Relationships.getNPC(c.npcId)).toBeTruthy();
    }, 120000);
});

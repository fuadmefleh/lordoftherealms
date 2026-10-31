// Hollow mechanics made real: a lie kept hot hardens into accepted truth (or
// is debunked), fanning a lie makes it traceable; a friend's belief refutes a
// slander, an admitted truth earns trust, a jealous spouse's named rival is
// the one given up, ignored matters close doors; loyalty counts; a rumour's
// reputation cost is reported; the LLM voice names the good; Deeds shows the
// tallies (systems/whispers.js, systems/relationships/matters.js,
// systems/gossip.js, systems/chatter.js, systems/deeds.js).

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Gossip } from '../systems/gossip.js';
import { Whispers } from '../systems/whispers.js';
import { Chatter } from '../systems/chatter.js';
import { Deeds } from '../systems/deeds.js';
import { Relationships } from '../systems/relationships.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const W = 40;
const H = 30;

function makeWorld(day = 30) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: { id: 'grassland', passable: true } });
        tiles.push(row);
    }
    const k1 = [
        { q: 5, r: 5, name: 'Tallow', type: 'town', kingdom: 'k1' },
        { q: 7, r: 6, name: 'Brindle', type: 'capital', kingdom: 'k1' },
        { q: 6, r: 8, name: 'Mossford', type: 'village', kingdom: 'k1' },
    ];
    const k2 = [{ q: 9, r: 5, name: 'Harrow', type: 'capital', kingdom: 'k2' }];
    for (const t of [...k1, ...k2]) tiles[t.r][t.q].settlement = { ...t };
    const world = {
        day, width: W, height: H, tiles, units: [], generationParams: { seed: 77 },
        kingdoms: [
            { id: 'k1', name: 'Arvenland', ruler: 'Queen Maud', isAlive: true, settlements: k1, wars: ['k2'], stability: 60, treasury: 500, culture: 'Imperial',
                lord: { name: 'Queen Maud', age: 40, traits: [{ id: 'cruel' }] } },
            { id: 'k2', name: 'Belmarch', ruler: 'King Osric', isAlive: true, settlements: k2, wars: ['k1'], stability: 60, treasury: 500, culture: 'Imperial',
                lord: { name: 'King Osric', age: 50, traits: [{ id: 'honorable' }] } },
        ],
        getTile: (q, r) => (tiles[r] && tiles[r][q]) || null,
        getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
    };
    return world;
}

function makePlayer() {
    const p = new Player();
    p.name = 'Aldric';
    p.q = 5; p.r = 5;
    p.gold = 1000;
    p.health = 100;
    p.reputation = { k1: 0, k2: 0 };
    p.relationships = {};
    p._relationshipNpcs = [];
    p._relationshipNextId = 1;
    p.spouse = null;
    return p;
}

const saved = [];
function tweak(obj, key, value) {
    saved.push([obj, key, obj[key]]);
    obj[key] = value;
}
afterEach(() => {
    while (saved.length) {
        const [obj, key, value] = saved.pop();
        obj[key] = value;
    }
});
beforeEach(() => {
    Utils.setSeed(4242);
});

const scfg = () => DataLoader.gossip.scandals.config;

describe('a lie kept hot comes to a reckoning', () => {
    const hotLie = (player, world) => {
        tweak(scfg(), 'plant', { ...scfg().plant, traceChancePerDay: 0 });
        const res = Whispers.plant(player, world, { subjectType: 'ruler', kingdomId: 'k1', kind: 'madness' }, 5, 5);
        expect(res.ok).toBe(true);
        res.scandal.truth = false;
        res.scandal.extra = 90;
        res.scandal.ends = world.day + 100;
        return res.scandal;
    };

    it('believed: it is proven as if it were so, and shakes the realm', () => {
        const world = makeWorld();
        const player = makePlayer();
        tweak(scfg(), 'harden', { days: 2, base: 1, perTown: 0, standing: 0, min: 1, max: 1 });
        const sc = hotLie(player, world);
        const stab0 = world.getKingdom('k1').stability;
        world.day++;
        Whispers.processDay(world, player);
        expect(sc.hotDays).toBe(1);
        expect(sc.state).toBe('live');
        world.day++;
        const out = Whispers.processDay(world, player);
        const done = Whispers.state(player).resolved[0];
        expect(done.state).toBe('proven');
        expect(done.hardened).toBe(true);
        expect(world.getKingdom('k1').stability).toBeLessThan(stab0);
        expect(out.notices.some(n => n.title === 'A Scandal Proven')).toBe(true);
        expect(Whispers.stats(player).hardened).toBe(1);
    });

    it('or debunked there and then', () => {
        const world = makeWorld();
        const player = makePlayer();
        tweak(scfg(), 'harden', { days: 1, base: 0, perTown: 0, standing: 0, min: 0, max: 0 });
        tweak(scfg(), 'fan', { ...scfg().fan, traceOnDebunk: 0 });
        hotLie(player, world);
        world.day++;
        Whispers.processDay(world, player);
        expect(Whispers.state(player).resolved[0].state).toBe('debunked');
        expect(Whispers.stats(player).debunked).toBe(1);
    });

    it('likelier the more of the realm tells it and the shakier the crown', () => {
        const world = makeWorld();
        const player = makePlayer();
        const sc = Whispers._create(player, world, { type: 'ruler', kingdomId: 'k1', name: 'Queen Maud' }, 'madness', { q: 5, r: 5, name: 'Tallow' }, { truth: false });
        const one = Whispers.hardenChance(world, player, sc);
        sc.spreadTo.push('7,6', '6,8');
        const three = Whispers.hardenChance(world, player, sc);
        expect(three).toBeGreaterThan(one);
        world.getKingdom('k1').stability = 20;
        expect(Whispers.hardenChance(world, player, sc)).toBeGreaterThan(three);
    });

    it('a lie the player fanned may be traced to them when it is debunked', () => {
        const world = makeWorld();
        const player = makePlayer();
        tweak(scfg(), 'fan', { ...scfg().fan, traceChance: 0, traceOnDebunk: 1 });
        const sc = Whispers._create(player, world, { type: 'ruler', kingdomId: 'k1', name: 'Queen Maud' }, 'debts', { q: 5, r: 5, name: 'Tallow' }, { truth: false });
        expect(Whispers.fan(player, world, sc.id, 5, 5).ok).toBe(true);
        const out = { notices: [] };
        Whispers._resolve(player, world, sc, 'debunked', out);
        expect(sc.traced).toBe(true);
        expect(out.notices.some(n => n.title === 'Your Whisper Traced' && /your coin/.test(n.text))).toBe(true);
    });

    it('one config key for a traced rival\'s anger', () => {
        expect(scfg().plant.rivalAttitude).toBeUndefined();
        expect(Whispers.config().rival.attitudeIfTraced).toBeLessThan(0);
    });
});

describe('matters keep their word', () => {
    let world;
    let player;
    let npc;
    const mcfg = () => DataLoader.relationships.matters.config;
    const meet = (score, extra = {}) => {
        const n = Relationships.generateNPC({ name: 'Tallow', q: 5, r: 5, kingdom: 'k1', type: 'town' }, world);
        const rel = Relationships.getRelationship(player, n.id);
        rel.score = score;
        Object.assign(rel, extra);
        return n;
    };

    beforeEach(() => {
        world = makeWorld();
        player = makePlayer();
        Relationships.initialize(player);
        Relationships._npcs = [];
        npc = meet(40);
    });

    it('a friend who believes your denial of a slander speaks up for you: the tale loses its credit', () => {
        const rumor = Gossip.accuse(player, world, 'slander', { q: 5, r: 5, victim: 'someone', credibility: 0.6 });
        const cred0 = rumor.credibility;
        player.relationships[npc.id].matter = { kind: 'heard_crime', day: 0, expires: 99, line: 0, rumor: 'lies', severity: 20, slander: true, rumorId: rumor.id };
        const res = Relationships.resolveMatter(player, npc.id, 'deny', world);
        expect(res.tone).toBe('good');
        expect(rumor.tellings['5,5'].id).toBe('refuted');
        expect(rumor.credibility).toBeLessThan(cred0);
    });

    it('a hard truth admitted earns trust: later denials are believed more readily', () => {
        player.relationships[npc.id].matter = { kind: 'heard_crime', day: 0, expires: 99, line: 0, rumor: 'a killing', severity: 60, slander: false };
        const before = Relationships.matterView(player, npc.id).options.find(o => o.id === 'deny').chance;
        Relationships.resolveMatter(player, npc.id, 'admit', world);
        expect(player.relationships[npc.id].trustsWord).toBe(true);
        expect(npc.loyalty).toBe(55);
        player.relationships[npc.id].matter = { kind: 'heard_crime', day: 0, expires: 99, line: 0, rumor: 'a killing', severity: 60, slander: false };
        const after = Relationships.matterView(player, npc.id).options.find(o => o.id === 'deny').chance;
        expect(after).toBeGreaterThan(before);
    });

    it('giving up the named lover ends that romance only', () => {
        const spouse = meet(60, { romantic: true, affection: 50 });
        player.spouse = spouse.id;
        const lover = meet(20, { romantic: true, affection: 45 });
        const other = meet(20, { romantic: true, affection: 45 });
        player.relationships[spouse.id].matter = { kind: 'jealousy', day: 0, expires: 99, line: 0, other: `${lover.firstName} ${lover.dynasty}`, otherId: lover.id, cause: 'sense' };
        const res = Relationships.resolveMatter(player, spouse.id, 'end', world);
        expect(res.ok).toBe(true);
        expect(player.relationships[lover.id].romantic).toBe(false);
        expect(player.relationships[other.id].romantic).toBe(true);
        expect(res.note).toMatch(lover.firstName);
    });

    it('an ignored rival suitor marries the one you courted, and the courting is over', () => {
        const love = meet(30, { romantic: true, affection: 50 });
        player.relationships[love.id].matter = { kind: 'rival_suitor', day: 0, expires: world.day - 1, line: 0, suitor: 'a travelling poet' };
        tweak(mcfg(), 'chancePerDay', 0);
        Relationships.processMatters(player, world);
        expect(love.isMarried).toBe(true);
        expect(love.marriedTo).toBe('a travelling poet');
        const acts = Relationships.getCourtActionAvailability(player, love.id, { world });
        expect(acts.every(a => !a.unlocked)).toBe(true);
        expect(acts[0].lockReason).toMatch(/travelling poet/);
    });

    it('an ignored grudge goes cold: no courting until the door opens again', () => {
        const enemy = meet(-50);
        player.relationships[enemy.id].matter = { kind: 'grudge', day: 0, expires: world.day - 1, line: 0, rumorId: null };
        tweak(mcfg(), 'chancePerDay', 0);
        tweak(mcfg(), 'grudgeChance', 0);
        Relationships.processMatters(player, world);
        const rel = player.relationships[enemy.id];
        expect(rel.closedUntil).toBeGreaterThan(world.day);
        expect(Relationships.getCourtActionAvailability(player, enemy.id, { world }).every(a => !a.unlocked)).toBe(true);
        world.day = rel.closedUntil + 1;
        expect(Relationships.getCourtActionAvailability(player, enemy.id, { world }).some(a => a.unlocked)).toBe(true);
    });

    it('loyalty counts when asking someone to travel with you', () => {
        let loyal = 0;
        let sour = 0;
        for (let seed = 1; seed <= 40; seed++) {
            for (const [lv, add] of [[100, () => loyal++], [0, () => sour++]]) {
                const n = meet(10);
                n.loyalty = lv;
                n.traits = [];
                player.travelParty = [];
                Utils.setSeed(seed);
                if (Relationships.requestJoinTravelParty(player, n.id, world).accepted) add();
            }
        }
        expect(loyal).toBeGreaterThan(sour);
    });

    it('a loyal debtor repays more surely', () => {
        tweak(mcfg(), 'chancePerDay', 0);
        tweak(mcfg(), 'honesty', {});
        let loyal = 0;
        let sour = 0;
        for (let d = 0; d < 30; d++) {
            for (const [lv, add] of [[100, () => loyal++], [0, () => sour++]]) {
                const n = meet(40);
                n.loyalty = lv;
                player.relationships[n.id].debt = { amount: 50, due: world.day, lent: 0 };
                Relationships.processMatters(player, world);
                if (!player.relationships[n.id].debt) add();
                delete player.relationships[n.id];
            }
            world.day++;
        }
        expect(loyal).toBeGreaterThan(sour);
    });
});

describe('the talk keeps its word', () => {
    it('a rumour that only costs reputation is reported', () => {
        const world = makeWorld();
        const player = makePlayer();
        Gossip.initializePlayer(player);
        const rumor = { id: 99, type: 'assault', credibility: 1, severity: 20, spreadTo: ['5,5'], consequencesApplied: {} };
        const res = Gossip._applyConsequences(player, rumor, 'k1', { bountyIssued: 50, kingdomWarrant: 90 }, world.day, 20);
        expect(res.consequence).toBe('reputation');
        expect(res.repLoss).toBeLessThan(0);
        expect(player.reputation.k1).toBe(res.repLoss);
    });

    it('the LLM voice names the good in a dearth or a glut, and every money and land kind', () => {
        const world = makeWorld();
        const player = makePlayer();
        const ctx = Chatter.context(world, player, { q: 5, r: 5 });
        ctx.dearth = { id: 'grain', label: 'grain' };
        ctx.glut = { id: 'wine', label: 'wine' };
        ctx.money = ['tax_revolt', 'tax_farm', 'heavy_taxes', 'army_unpaid', 'mania', 'crash', 'insurers_failed', 'bank'].map(kind => ({ kind, bank: 'House Vell' }));
        ctx.labour = ['rent_riot', 'bequest', 'dowry'];
        ctx.prices = ['engrossing'];
        const facts = Chatter.promptFacts(ctx);
        expect(facts).toContain('short of grain');
        expect(facts).toContain('glutted with wine');
        expect(facts).toContain('sold its taxes here to House Vell');
        expect(facts).toContain('deserting');
        expect(facts).toContain('Bourse has crashed');
        expect(facts).toContain('over the rent');
        expect(facts).toContain('left one of his estates to the Church');
        expect(facts).toContain('hoarding grain');
    });

    it('the townsfolk talk of engrossers where the lofts are full', () => {
        const world = makeWorld();
        const player = makePlayer();
        world.tiles[5][5].settlement.engross = { grain: 30, since: 0 };
        const ctx = Chatter.context(world, player, { q: 5, r: 5 });
        expect(ctx.prices).toContain('engrossing');
        expect(Chatter.validate()).toEqual([]);
    });
});

describe('the tallies are shown', () => {
    it('Deeds & Records counts whispers, land, the putting-out trade, notoriety, money and the realms\' books', () => {
        const player = makePlayer();
        player.whispers = { scandals: [], resolved: [], stats: { planted: 2, hardened: 1, traced: 1 } };
        player.land = { stats: { bought: 1, arrears: 40, pressed: 2, putOut: 30, cloth: 12 } };
        player.gossip = { totalKills: 3, witnessedKills: 1, unwitnessedKills: 2, bounties: [{ gold: 50 }, { gold: 25 }], rumors: [] };
        player.bills = { stats: { forgeriesCaught: 1 } };
        player.merchantPrince = { stats: { forwardsDone: 4, forwardsFailed: 1 } };
        const world = { engrossing: { stats: { bought: 120.5, edicts: 2 } }, fiscal: { stats: { farmsSold: 3, revolts: 1, playerFarms: 0 } } };
        const d = Deeds.collect(player, world);
        expect(d['whispers.planted']).toBe(2);
        expect(d['whispers.hardened']).toBe(1);
        expect(d['estates.arrears']).toBe(40);
        expect(d['estates.pressed']).toBe(2);
        expect(d['puttingOut.cloth']).toBe(12);
        expect(d['gossip.kills']).toBe(3);
        expect(d['gossip.bountyGold']).toBe(75);
        expect(d['bills.forgeriesCaught']).toBe(1);
        expect(d['merchant.forwardsFailed']).toBe(1);
        expect(d['engrossing.bought']).toBe(120.5);
        expect(d['fiscal.farmsSold']).toBe(3);
        const secs = Deeds.sections(player, world);
        for (const id of ['whispers', 'estates', 'puttingOut', 'notoriety', 'money', 'realms']) {
            expect(secs.find(s => s.id === id).empty).toBe(false);
        }
        // The realms' books are present facts: no reign column
        expect(secs.find(s => s.id === 'realms').rows.every(r => r.reign === null)).toBe(true);
    });
});

describe('the heralds cry the grain dealers', () => {
    it('engrossing and edicts against it are proclaimed records', async () => {
        const { Heralds } = await import('../systems/heralds.js');
        const world = makeWorld();
        world.engrossing = { history: [{ day: 30, kind: 'engross', kingdomId: 'k1', kingdom: 'Arvenland', units: 40 }, { day: 31, kind: 'edict', kingdomId: 'k1', kingdom: 'Arvenland', place: 'Brindle', units: 40 }] };
        const recs = Heralds._engrossRecords(world);
        expect(recs.map(r => r.key)).toEqual(['en:engross:k1:30', 'en:edict:k1:31']);
        const T = Chatter.data().heralds.templates;
        expect(T.grain_engrossed.length).toBeGreaterThan(0);
        expect(T.engrossing_edict.length).toBeGreaterThan(0);
        expect(T.estate_rent_riot.length).toBeGreaterThan(0);
    });
});

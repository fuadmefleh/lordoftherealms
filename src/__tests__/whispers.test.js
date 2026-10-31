// Whispers: rumours that grow in the telling (systems/gossip.js), court
// scandals and whisper campaigns (systems/whispers.js), and the matters the
// people the player knows bring them (systems/relationships/matters.js).

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Gossip } from '../systems/gossip.js';
import { Whispers } from '../systems/whispers.js';
import { Chatter } from '../systems/chatter.js';
import { Relationships } from '../systems/relationships.js';
import { KingdomStability } from '../world/kingdomState.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const W = 40;
const H = 30;

/** Two realms at war: Arvenland (Tallow, Brindle, Mossford) and Belmarch (Harrow). */
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

// Data tweaks for one test, undone after it
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

/** A crime rumour that started in Tallow and is now told in Brindle too. */
function crimeRumor(player, world) {
    const r = Gossip.accuse(player, world, 'assault', { q: 5, r: 5, victim: 'Old Tam', credibility: 1 });
    r.spreadTo.push('7,6');
    return r;
}

describe('rumours grow in the telling', () => {
    it('a rumour reaching a new town may be retold, scaling its severity there', () => {
        const world = makeWorld();
        const player = makePlayer();
        const rumor = crimeRumor(player, world);
        tweak(DataLoader.gossip.tellings, 'chance', 1);
        Gossip._retell(rumor, Gossip._getRumorType('assault'), '5,5', '7,6');
        const t = Gossip.tellingAt(rumor, '7,6');
        expect(t).toBeTruthy();
        expect(Gossip.localSeverity(rumor, '7,6')).toBeCloseTo(rumor.severity * t.severity);
        expect(Gossip.localSeverity(rumor, '5,5')).toBe(rumor.severity); // the truth where it happened
        expect(Gossip.describeAt(rumor, '7,6')).not.toMatch(/\{\w+\}/);
    });

    it('a telling that blames a stranger turns no guard against the player', () => {
        const world = makeWorld();
        const player = makePlayer();
        const rumor = Gossip.accuse(player, world, 'murder', { q: 5, r: 5, victim: 'Old Tam', credibility: 1 });
        expect(Gossip.checkGuardHostility(player, 5, 5, world).hostile).toBe(true);
        rumor.tellings = { '5,5': { id: 'misplaced', d: 1 } };
        const st = Gossip.checkGuardHostility(player, 5, 5, world);
        expect(st.hostile).toBe(false);
        expect(st.reason).toMatch(/stranger/);
    });

    it('a stolen deed is credited to the most renowned rival', () => {
        const world = makeWorld();
        const player = makePlayer();
        player.rivals = { list: [{ id: 1, name: 'Kael the Grey', renown: 30 }, { id: 2, name: 'Ysolde', renown: 5 }] };
        const deed = Gossip.spreadDeed(player, world, 'duel_won', { q: 5, r: 5, victim: 'Ser Brannoc' });
        expect(Gossip._rivalName(player)).toBe('Kael the Grey');
        deed.tellings = { '7,6': { id: 'stolen', d: 2, who: 'Kael the Grey' } };
        deed.spreadTo.push('7,6');
        expect(Gossip.describeAt(deed, '7,6')).toMatch(/Kael the Grey/);
        // Townsfolk there don't credit the player with it
        const ctx = Chatter.context(world, player, { q: 7, r: 6 });
        expect(ctx.deeds).toHaveLength(0);
    });

    it('spreads through the world\'s tile scan when kingdoms carry no settlement list (generated worlds)', () => {
        const world = makeWorld();
        const views = world.kingdoms.flatMap(k => k.settlements);
        for (const k of world.kingdoms) k.settlements = [];
        world.getSettlementViews = () => views;
        const player = makePlayer();
        const rumor = Gossip.accuse(player, world, 'murder', { q: 5, r: 5, victim: 'Old Tam', credibility: 1 });
        const def = Gossip._getRumorType('murder');
        for (let i = 0; i < 40 && rumor.spreadTo.length < 2; i++) Gossip._spreadRumor(rumor, def, world, { baseSpreadChance: 1, maxSpreadDistance: 3 });
        expect(rumor.spreadTo.length).toBeGreaterThan(1);
        expect(Gossip._nearestSettlement(world, 6, 6, 3)).toBeTruthy();
        expect(Whispers._byRealm(world).get('k1')).toHaveLength(3);
    });

    it('a bard sings a rumour down in one town, for a price', () => {
        const world = makeWorld();
        const player = makePlayer();
        const rumor = crimeRumor(player, world);
        const gold = player.gold;
        const res = Whispers.singDown(player, world, rumor.id, 7, 6);
        expect(res.ok).toBe(true);
        expect(player.gold).toBe(gold - Whispers.config().bard.cost);
        expect(Gossip.tellingAt(rumor, '7,6').id).toBe('refuted');
        expect(Gossip.localSeverity(rumor, '7,6')).toBeLessThan(rumor.severity * 0.5);
        expect(Whispers.singDown(player, world, rumor.id, 9, 5).ok).toBe(false); // not told in Harrow
    });

    it('accuse starts a crime rumour with its immediate cost', () => {
        const world = makeWorld();
        const player = makePlayer();
        const karma = player.karma || 0;
        const r = Gossip.accuse(player, world, 'whisperer', { q: 5, r: 5, victim: 'Queen Maud', credibility: 1 });
        expect(r.type).toBe('whisperer');
        expect(r.spreadTo).toEqual(['5,5']);
        expect(player.karma).toBeLessThan(karma);
        expect(player.reputation.k1).toBeLessThan(0);
        expect(Gossip.accuse(player, world, 'duel_won', { q: 5, r: 5 })).toBeNull(); // deeds are not accusations
    });
});

describe('court scandals', () => {
    it('tales hatch, spread, and weigh on the realm\'s stability', () => {
        const world = makeWorld(19);
        const player = makePlayer();
        for (let i = 0; i < 80; i++) {
            world.day++;
            Whispers.processDay(world, player);
        }
        const st = Whispers.state(player);
        expect(st.scandals.length + st.resolved.length).toBeGreaterThan(0);
        // Force a hot one about Arvenland's queen and check the drag
        const sc = Whispers._create(player, world, { type: 'ruler', kingdomId: 'k1', name: 'Queen Maud' }, 'poison', { q: 5, r: 5, name: 'Tallow' }, { extra: 60 });
        sc.spreadTo.push('7,6', '6,8');
        sc.heat = Whispers._heat(sc, world);
        Whispers._applyStability(player, world);
        const k1 = world.getKingdom('k1');
        expect(k1.scandal.stab).toBeLessThan(0);
        const parts = KingdomStability.target(k1, world).parts.map(p => p.label);
        expect(parts).toContain('Court scandal');
    });

    it('the daily tick never touches the main RNG stream', () => {
        const world = makeWorld(25);
        const player = makePlayer();
        Utils.setSeed(9);
        const a = Utils.random();
        Utils.setSeed(9);
        for (let i = 0; i < 20; i++) { world.day++; Whispers.processDay(world, player); }
        expect(Utils.random()).toBe(a);
    });

    it('a cruel ruler is likelier to have poisoned someone', () => {
        const world = makeWorld();
        const player = makePlayer();
        const cruel = Whispers.truthChance('poison', { type: 'ruler', kingdomId: 'k1' }, world, player);
        const honest = Whispers.truthChance('poison', { type: 'ruler', kingdomId: 'k2' }, world, player);
        expect(cruel).toBeGreaterThan(honest);
    });

    it('a secret pact needs a war', () => {
        const world = makeWorld();
        expect(Whispers.kindsFor('ruler', world, world.getKingdom('k1'))).toContain('pact');
        world.kingdoms.forEach(k => { k.wars = []; });
        expect(Whispers.kindsFor('ruler', world, world.getKingdom('k1'))).not.toContain('pact');
    });

    it('a true, hot tale is proven at its end and shakes the realm', () => {
        const world = makeWorld();
        const player = makePlayer();
        const sc = Whispers._create(player, world, { type: 'ruler', kingdomId: 'k1', name: 'Queen Maud' }, 'bastard', { q: 5, r: 5, name: 'Tallow' }, { truth: true, extra: 80, known: true });
        sc.ends = world.day + 1;
        const before = world.getKingdom('k1').stability;
        world.day += 2;
        const out = Whispers.processDay(world, player);
        expect(Whispers.state(player).resolved[0].state).toBe('proven');
        expect(world.getKingdom('k1').stability).toBeLessThan(before);
        expect(out.notices.some(n => n.title === 'A Scandal Proven')).toBe(true);
    });

    it('the player hears a tale where they stand', () => {
        const world = makeWorld();
        const player = makePlayer();
        Whispers._create(player, world, { type: 'ruler', kingdomId: 'k1', name: 'Queen Maud' }, 'debts', { q: 5, r: 5, name: 'Tallow' });
        world.day++;
        const out = Whispers.processDay(world, player);
        expect(out.notices.some(n => /Whispers in Tallow/.test(n.title))).toBe(true);
        expect(Chatter.context(world, player, { q: 5, r: 5 }).scandals).toHaveLength(1);
    });

    it('fanning heats a tale and pleases its subject\'s enemies; quashing cools it', () => {
        const world = makeWorld();
        const player = makePlayer();
        const sc = Whispers._create(player, world, { type: 'ruler', kingdomId: 'k1', name: 'Queen Maud' }, 'debts', { q: 5, r: 5, name: 'Tallow' });
        const heat0 = sc.heat;
        tweak(DataLoader.gossip.scandals.config, 'fan', { ...DataLoader.gossip.scandals.config.fan, traceChance: 0 });
        const fan = Whispers.fan(player, world, sc.id, 5, 5);
        expect(fan.ok).toBe(true);
        expect(sc.heat).toBeGreaterThan(heat0);
        expect(player.reputation.k2).toBeGreaterThan(0);
        const hot = sc.heat;
        const quash = Whispers.quash(player, world, sc.id, 5, 5);
        expect(quash.ok).toBe(true);
        expect(sc.heat).toBeLessThan(hot);
        expect(player.reputation.k1).toBeGreaterThan(0);
        expect(Whispers.quash(player, world, sc.id, 9, 5).ok).toBe(false); // not in Belmarch
    });

    it('blackmail pays for a known truth; selling it to the enemy proves it', () => {
        const world = makeWorld();
        const player = makePlayer();
        const a = Whispers._create(player, world, { type: 'ruler', kingdomId: 'k1', name: 'Queen Maud' }, 'affair', { q: 5, r: 5, name: 'Tallow' }, { truth: true });
        expect(Whispers.blackmail(player, world, a.id, 5, 5).ok).toBe(false); // not known to be true
        Whispers.reveal(player, a.id);
        const gold = player.gold;
        const bm = Whispers.blackmail(player, world, a.id, 5, 5);
        expect(bm.ok).toBe(true);
        expect(player.gold).toBeGreaterThan(gold);
        expect(Whispers.state(player).resolved[0].state).toBe('buried');

        const b = Whispers._create(player, world, { type: 'ruler', kingdomId: 'k1', name: 'Queen Maud' }, 'debts', { q: 5, r: 5, name: 'Tallow' }, { truth: true });
        Whispers.reveal(player, b.id);
        const before = world.getKingdom('k1').stability;
        const sold = Whispers.sell(player, world, b.id, 'k2');
        expect(sold.ok).toBe(true);
        expect(world.getKingdom('k1').stability).toBeLessThan(before);
        expect(player.reputation.k2).toBeGreaterThan(0);
    });

    it('an honourable ruler may answer blackmail with the guard', () => {
        const world = makeWorld();
        const player = makePlayer();
        player.q = 9; player.r = 5;
        tweak(DataLoader.gossip.scandals.config, 'blackmail', { ...DataLoader.gossip.scandals.config.blackmail, refuseChance: 1 });
        const sc = Whispers._create(player, world, { type: 'ruler', kingdomId: 'k2', name: 'King Osric' }, 'affair', { q: 9, r: 5, name: 'Harrow' }, { truth: true });
        Whispers.reveal(player, sc.id);
        const res = Whispers.blackmail(player, world, sc.id, 9, 5);
        expect(res.refused).toBe(true);
        expect(player.gossip.rumors.some(r => r.type === 'blackmailer')).toBe(true);
    });

    it('a planted lie can be traced back to the player', () => {
        const world = makeWorld();
        const player = makePlayer();
        tweak(DataLoader.gossip.scandals.config, 'plant', { ...DataLoader.gossip.scandals.config.plant, traceChancePerDay: 1 });
        const res = Whispers.plant(player, world, { subjectType: 'ruler', kingdomId: 'k1', kind: 'madness' }, 5, 5);
        expect(res.ok).toBe(true);
        res.scandal.truth = false;
        world.day++;
        const out = Whispers.processDay(world, player);
        expect(out.notices.some(n => n.title === 'Your Whisper Traced')).toBe(true);
        expect(player.gossip.rumors.some(r => r.type === 'whisperer')).toBe(true);
        expect(player.reputation.k1).toBeLessThan(0);
        expect(Whispers.state(player).resolved[0].state).toBe('debunked');
    });

    it('one tale per subject; the player\'s tale must fit them', () => {
        const world = makeWorld();
        const player = makePlayer();
        expect(Whispers.plant(player, world, { subjectType: 'ruler', kingdomId: 'k1', kind: 'cheat' }, 5, 5).ok).toBe(false);
        expect(Whispers.plant(player, world, { subjectType: 'ruler', kingdomId: 'k1', kind: 'debts' }, 5, 5).ok).toBe(true);
        expect(Whispers.plant(player, world, { subjectType: 'ruler', kingdomId: 'k1', kind: 'affair' }, 5, 5).ok).toBe(false);
    });

    it('survives a save round-trip', () => {
        const world = makeWorld();
        const player = makePlayer();
        Whispers._create(player, world, { type: 'ruler', kingdomId: 'k1', name: 'Queen Maud' }, 'debts', { q: 5, r: 5, name: 'Tallow' });
        const copy = { whispers: Whispers.serialize(player) };
        Whispers.loadState(copy);
        expect(copy.whispers.scandals[0].subject.name).toBe('Queen Maud');
        const fresh = {};
        Whispers.loadState(fresh);
        expect(fresh.whispers.scandals).toEqual([]);
    });
});

describe('matters of the heart and of friendship', () => {
    let world;
    let player;
    let npc;

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

    it('a friend asks for a loan, and pays it back with interest', () => {
        tweak(DataLoader.relationships.matters.config, 'chancePerDay', 1);
        Relationships.getRelationship(player, npc.id).matter = null;
        player.relationships[npc.id].matter = { kind: 'loan', day: world.day, expires: world.day + 10, line: 0, amount: 50, reason: 'A sick cow' };
        const view = Relationships.matterView(player, npc.id);
        expect(view.options.map(o => o.id)).toEqual(['lend', 'refuse']);
        const gold = player.gold;
        const res = Relationships.resolveMatter(player, npc.id, 'lend', world);
        expect(res.ok).toBe(true);
        expect(player.gold).toBe(gold - 50);
        const rel = player.relationships[npc.id];
        expect(rel.debt.amount).toBe(50);
        tweak(DataLoader.relationships.matters.config, 'honesty', { [npc.personality]: 1 });
        world.day = rel.debt.due;
        const events = Relationships.processMatters(player, world);
        expect(events.some(e => e.title === 'A Debt Repaid')).toBe(true);
        expect(player.gold).toBe(gold - 50 + 60);
    });

    it('friends bring matters of their own, and an ignored one costs', () => {
        tweak(DataLoader.relationships.matters.config, 'chancePerDay', 1);
        const events = Relationships.processMatters(player, world);
        expect(events.some(e => e.type === 'matter')).toBe(true);
        const m = Relationships.getMatter(player, npc.id);
        expect(m).toBeTruthy();
        const score = player.relationships[npc.id].score;
        world.day = m.expires + 1;
        tweak(DataLoader.relationships.matters.config, 'chancePerDay', 0);
        const later = Relationships.processMatters(player, world);
        expect(later.some(e => e.ignored)).toBe(true);
        expect(Relationships.getMatter(player, npc.id)).toBeFalsy();
        expect(player.relationships[npc.id].score).toBeLessThanOrEqual(score + 3);
    });

    it('a friend who hears a crime rumour about you asks if it is true', () => {
        tweak(DataLoader.relationships.matters.config, 'heardChance', 1);
        tweak(DataLoader.relationships.matters.config, 'chancePerDay', 0);
        Gossip.accuse(player, world, 'murder', { q: 5, r: 5, victim: 'Old Tam', credibility: 1 });
        Relationships.processMatters(player, world);
        const view = Relationships.matterView(player, npc.id);
        expect(view.kind).toBe('heard_crime');
        expect(view.line).toMatch(/Old Tam/);
        expect(view.options.map(o => o.id)).toEqual(['deny', 'admit', 'justify']);
        const res = Relationships.resolveMatter(player, npc.id, 'admit', world);
        expect(res.ok).toBe(true);
        // Asked once per rumour
        Relationships.processMatters(player, world);
        expect(Relationships.getMatter(player, npc.id)).toBeFalsy();
    });

    it('the daily turn of matters never touches the main RNG stream', () => {
        meet(70);
        Utils.setSeed(9);
        const a = Utils.random();
        Utils.setSeed(9);
        for (let i = 0; i < 10; i++) { world.day++; Relationships.processMatters(player, world); }
        expect(Utils.random()).toBe(a);
    });

    it('a slander is denied truthfully', () => {
        player.relationships[npc.id].matter = { kind: 'heard_crime', day: 0, expires: 99, line: 0, rumor: 'lies', severity: 20, slander: true };
        const before = player.relationships[npc.id].score;
        const res = Relationships.resolveMatter(player, npc.id, 'deny', world);
        expect(res.tone).toBe('good');
        expect(player.relationships[npc.id].score).toBeGreaterThan(before);
    });

    it('a married player can court someone else, and talk of it reaches the spouse', () => {
        const spouse = meet(60, { romantic: true, affection: 12 });
        player.spouse = spouse.id;
        spouse.isMarried = true;
        const lover = meet(20, { romantic: true, affection: 40 });
        const acts = Relationships.getCourtActionAvailability(player, lover.id, { world });
        expect(acts.find(a => a.id === 'propose').unlocked).toBe(false);
        expect(acts.some(a => a.unlocked)).toBe(true);

        tweak(DataLoader.relationships.matters.config, 'affairRumorChance', 1);
        const rumor = Relationships._affairRisk(player, lover, world);
        expect(rumor.type).toBe('affair');
        expect(Gossip.isTalk(rumor)).toBe(true);
        expect(Gossip.checkGuardHostility(player, 5, 5, world).hostile).toBe(false);

        tweak(DataLoader.relationships.matters.config, 'rumorJealousyChance', 1);
        tweak(DataLoader.relationships.matters.config, 'chancePerDay', 0);
        Relationships.processMatters(player, world);
        const view = Relationships.matterView(player, spouse.id);
        expect(view.kind).toBe('jealousy');
        expect(view.options.map(o => o.id)).toEqual(['lie', 'end', 'defy']);
        const res = Relationships.resolveMatter(player, spouse.id, 'defy', world);
        expect(res.divorced).toBe(true);
        expect(player.spouse).toBeNull();
    });

    it('ending the affair keeps the marriage', () => {
        const spouse = meet(60, { romantic: true, affection: 50 });
        player.spouse = spouse.id;
        const lover = meet(20, { romantic: true, affection: 45 });
        player.relationships[spouse.id].matter = { kind: 'jealousy', day: 0, expires: 99, line: 0, other: `${lover.firstName} ${lover.dynasty}`, cause: 'sense' };
        const res = Relationships.resolveMatter(player, spouse.id, 'end', world);
        expect(res.ok).toBe(true);
        expect(player.spouse).toBe(spouse.id);
        expect(player.relationships[lover.id].romantic).toBe(false);
    });

    it('a rival suitor wins if the player waits too long', () => {
        const love = meet(30, { romantic: true, affection: 50 });
        player.relationships[love.id].matter = { kind: 'rival_suitor', day: 0, expires: world.day - 1, line: 0, suitor: 'a travelling poet' };
        tweak(DataLoader.relationships.matters.config, 'chancePerDay', 0);
        const events = Relationships.processMatters(player, world);
        expect(events.some(e => /travelling poet/.test(e.text))).toBe(true);
        expect(player.relationships[love.id].romantic).toBe(false);
    });

    it('a close friend tells the truth of a court scandal', () => {
        const friend = meet(70);
        const sc = Whispers._create(player, world, { type: 'ruler', kingdomId: 'k1', name: 'Queen Maud' }, 'heresy', { q: 7, r: 6, name: 'Brindle' }, { truth: false });
        const params = Relationships._matterParams(player, 'confidence', friend);
        expect(params.scandalId).toBe(sc.id);
        player.relationships[friend.id].matter = { kind: 'confidence', day: 0, expires: 99, line: 0, ...params };
        expect(Relationships.matterView(player, friend.id).line).toMatch(/a lie/);
        Relationships.resolveMatter(player, friend.id, 'keep', world);
        expect(Whispers.get(player, sc.id).truthKnown).toBe(true);
    });

    it('an enemy badmouths the player through their town', () => {
        const enemy = meet(-50);
        tweak(DataLoader.relationships.matters.config, 'grudgeChance', 1);
        tweak(DataLoader.relationships.matters.config, 'chancePerDay', 0);
        Relationships.processMatters(player, world);
        expect(Relationships.getMatter(player, enemy.id).kind).toBe('grudge');
        expect(player.gossip.rumors.some(r => r.type === 'slander' && r.victim.name === `${enemy.firstName} ${enemy.dynasty}`)).toBe(true);
    });
});

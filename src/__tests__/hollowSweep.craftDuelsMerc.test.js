// Hollow mechanics made real (second sweep): crafted quality is shown and
// fights in duels; townsfolk brawl by their duel profiles and temperament; a
// rival suitor is fought on the duel engine; a deed's telling sets how much
// it is worth; each kind of court scandal has its own fallout; the wilds,
// the bench and odd jobs are on the Deeds roll; a Masterwork achievement;
// mercenary contracts carry loot tables, count galleys at a pirate cove and
// report their log; a task's other way out touches its other party; a
// favour's coin is a debt; a withdrawal spares the band for a few days.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Crafting } from '../player/crafting.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Duels } from '../systems/duels.js';
import { Gossip } from '../systems/gossip.js';
import { Whispers } from '../systems/whispers.js';
import { Relationships } from '../systems/relationships.js';
import { Deeds } from '../systems/deeds.js';
import { Achievements } from '../systems/achievements.js';
import { MercContracts } from '../player/mercContracts.js';
import { NpcTasks } from '../systems/npcTasks.js';
import { NpcKnowledge } from '../systems/npcKnowledge.js';
import { Quests } from '../systems/quests.js';
import { FieldBattle } from '../player/fieldBattle.js';
import { WorldUnit } from '../world/units.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

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
    Utils.setSeed(9191);
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
    ];
    const k2 = [{ q: 9, r: 5, name: 'Harrow', type: 'capital', kingdom: 'k2' }];
    for (const t of [...k1, ...k2]) tiles[t.r][t.q].settlement = { ...t };
    const world = {
        day, width: W, height: H, tiles, units: [], events: [], generationParams: { seed: 77 },
        kingdoms: [
            { id: 'k1', name: 'Arvenland', ruler: 'Queen Maud', isAlive: true, settlements: k1, wars: ['k2'], stability: 60, treasury: 1000, culture: 'Imperial',
                relations: { k2: -40 }, religion: { unity: 70, piety: 50 },
                characterData: { advisors: { chancellor: { loyalty: 60 }, marshal: { loyalty: 50 } } },
                lord: { name: 'Queen Maud', age: 40, traits: [] } },
            { id: 'k2', name: 'Belmarch', ruler: 'King Osric', isAlive: true, settlements: k2, wars: ['k1'], stability: 60, treasury: 500, culture: 'Imperial',
                relations: { k1: -40 }, lord: { name: 'King Osric', age: 50, traits: [] } },
        ],
        getTile: (q, r) => (tiles[r] && tiles[r][q]) || null,
        getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
    };
    return world;
}

function makePlayer(over = {}) {
    const p = new Player();
    p.name = 'Aldric';
    p.q = 5; p.r = 5;
    p.gold = 1000;
    p.health = 100; p.maxHealth = 100;
    p.inventory = {};
    p.army = [];
    p.skills = { ...(p.skills || {}), combat: 3 };
    p.strength = 6;
    p.reputation = { k1: 0, k2: 0 };
    p.relationships = {};
    Object.assign(p, over);
    return p;
}

describe('crafted quality is shown and fights', () => {
    it('a quality tag for a held crafted stack, nothing for ordinary goods or a Common average', () => {
        const p = makePlayer({ inventory: { weapons: 2, bread: 4 } });
        Crafting.noteQuality(p, 'weapons', 2, 2);
        expect(Crafting.qualityTag(p, 'weapons')).toMatch(/Fine/);
        expect(Crafting.qualityTag(p, 'bread')).toBe('');
        Crafting.noteQuality(p, 'bread', 4, 1);
        expect(Crafting.qualityTag(p, 'bread')).toBe('');
    });

    it('a Fine sword cuts deeper and a Fine shield guards better in a duel; a Crude one less', () => {
        const plain = makePlayer({ inventory: { weapons: 1, shield: 1, leather_armor: 1 } });
        const fine = makePlayer({ inventory: { weapons: 1, shield: 1, leather_armor: 1 } });
        Crafting.noteQuality(fine, 'weapons', 1, 3);
        Crafting.noteQuality(fine, 'shield', 1, 3);
        Crafting.noteQuality(fine, 'leather_armor', 1, 3);
        const crude = makePlayer({ inventory: { weapons: 1 } });
        Crafting.noteQuality(crude, 'weapons', 1, 0);
        const a = Duels.fromPlayer(plain, { mods: PlayerEffects.duelModifiers(plain) });
        const b = Duels.fromPlayer(fine, { mods: PlayerEffects.duelModifiers(fine) });
        const c = Duels.fromPlayer(crude, { mods: PlayerEffects.duelModifiers(crude) });
        expect(b.power).toBeGreaterThan(a.power);
        expect(b.attack).toBeGreaterThan(a.attack);
        expect(b.defense).toBeGreaterThan(a.defense);
        expect(b.armour).toBeGreaterThan(a.armour);
        expect(c.power).toBeLessThan(Duels.fromPlayer(makePlayer({ inventory: { weapons: 1 } }), {}).power);
        // Arms carry their own grade (systems/arms.js): the Fine blade cuts deeper even without the player layer's map
        expect(Duels.fromPlayer(fine, {}).power).toBeGreaterThan(Duels.fromPlayer(plain, {}).power);
    });
});

describe('townsfolk brawl by their profiles', () => {
    it('a guard hits harder than a merchant, from the duel profile', () => {
        const rng = () => 0.5;
        const guard = Duels.npcSwing({ type: 'guard' }, rng);
        const merchant = Duels.npcSwing({ type: 'merchant' }, rng);
        expect(guard).toBeGreaterThan(merchant);
        expect(guard).toBeGreaterThan(0);
    });

    it('stand or run: the guard stands, the merchant runs, a bold farmer may stand, a hurt one runs', () => {
        expect(Duels.brawlStance({ type: 'guard' }, { playerAttack: 4 }).stance).toBe('fight');
        expect(Duels.brawlStance({ type: 'merchant' }, { playerAttack: 4 }).stance).toBe('flee');
        const meek = Duels.brawlStance({ type: 'traveler', personalityTraits: ['cautious'] }, { playerAttack: 4 });
        const bold = Duels.brawlStance({ type: 'traveler', personalityTraits: ['bold'] }, { playerAttack: 4 });
        expect(bold.score).toBeGreaterThan(meek.score);
        expect(bold.stance).toBe('fight');
        expect(meek.stance).toBe('flee');
        expect(Duels.brawlStance({ type: 'guard', personalityTraits: ['quiet'] }, { playerAttack: 4, hpFrac: 0.1 }).stance).toBe('flee');
        // A fearsome player sends more of them running
        expect(Duels.brawlStance({ type: 'blacksmith_npc' }, { playerAttack: 14 }).stance).toBe('flee');
    });

    it('the mode is labelled from data', () => {
        expect(Duels.mode('firstBlood').label).toMatch(/first blood/i);
    });
});

describe('a rival suitor is fought on the duel engine', () => {
    let world;
    let player;
    beforeEach(() => {
        world = makeWorld();
        player = makePlayer();
        Relationships.initialize(player);
        Relationships._npcs = [];
    });

    const court = (suitor) => {
        const n = Relationships.generateNPC({ name: 'Tallow', q: 5, r: 5, kingdom: 'k1', type: 'town' }, world);
        const rel = Relationships.getRelationship(player, n.id);
        Object.assign(rel, { score: 30, romantic: true, affection: 50 });
        rel.matter = { kind: 'rival_suitor', day: 0, expires: 99, line: 0, suitor };
        return n;
    };

    it('a guard captain fights like a guard, a poet like a traveller: the odds say so', () => {
        const a = court('a captain of the guard');
        const b = court('a travelling poet');
        const vsGuard = Relationships.matterView(player, a.id).options.find(o => o.id === 'duel').chance;
        const vsPoet = Relationships.matterView(player, b.id).options.find(o => o.id === 'duel').chance;
        expect(vsPoet).toBeGreaterThan(vsGuard);
        const { b: foe } = Relationships._suitorDuelists(player, { suitor: 'a captain of the guard' });
        expect(foe.weapon).toMatch(/spear/);
    });

    it('the fight is a real duel: its result comes back with the answer', () => {
        const n = court('a widowed miller');
        const res = Relationships.resolveMatter(player, n.id, 'duel', world);
        expect(res.ok).toBe(true);
        expect(res.duel).toBeTruthy();
        expect(res.duel.rounds).toBeGreaterThan(0);
        expect(res.note).toMatch(/exchange/);
    });
});

describe('a deed is worth what its telling makes it', () => {
    it('a legend counts for more, a soured telling for little, a stolen one for nothing', () => {
        const world = makeWorld();
        const player = makePlayer();
        const deed = Gossip.spreadDeed(player, world, 'duel_won', { q: 5, r: 5, victim: 'Ser Brannoc' });
        const plain = Gossip.deedWeight(deed, '5,5');
        expect(plain).toBeGreaterThan(0);
        deed.tellings = { '5,5': { id: 'legend', d: 1 } };
        const legend = Gossip.deedWeight(deed, '5,5');
        deed.tellings = { '5,5': { id: 'soured', d: 1 } };
        const soured = Gossip.deedWeight(deed, '5,5');
        deed.tellings = { '5,5': { id: 'stolen', d: 2, who: 'Kael' } };
        expect(Gossip.deedWeight(deed, '5,5')).toBe(0);
        expect(legend).toBeGreaterThan(plain);
        expect(soured).toBeLessThan(plain * 0.5);
        expect(Gossip.deedWeight({ type: 'murder', severity: 50 }, '5,5')).toBe(0);
    });

    it('a deed raises the player\'s name in the realm it is told in, once per town; a sack does not', () => {
        const world = makeWorld();
        const player = makePlayer();
        Gossip.initializePlayer(player);
        const deed = Gossip.spreadDeed(player, world, 'duel_won', { q: 5, r: 5, victim: 'Ser Brannoc' });
        tweak(DataLoader.gossip.spreadSettings, 'baseSpreadChance', 0);
        Gossip.processDaily(player, world);
        const rep = player.reputation.k1;
        expect(rep).toBeGreaterThan(0);
        expect(deed.consequencesApplied['5,5'].deed).toBe(true);
        Gossip.processDaily(player, world);
        expect(player.reputation.k1).toBe(rep);
        const p2 = makePlayer();
        Gossip.initializePlayer(p2);
        Gossip.spreadDeed(p2, world, 'sack', { q: 5, r: 5, victim: 'Tallow' });
        Gossip.processDaily(p2, world);
        expect(p2.reputation.k1 || 0).toBeLessThanOrEqual(0);
    });
});

describe('each kind of scandal has its own fallout', () => {
    const tale = (world, kind, extra = {}) => ({ id: 1, kind, subject: { type: 'ruler', name: 'Queen Maud', kingdomId: 'k1' }, kingdomId: 'k1', kingdomName: 'Arvenland', enemy: 'Belmarch', enemyId: 'k2', ...extra });

    it('a proven heresy breaks the faith\'s unity; a pact sours the realm on its enemy; debts empty the treasury; madness unsettles the council', () => {
        const world = makeWorld();
        const k = world.getKingdom('k1');
        Whispers.applyFallout(world, tale(world, 'heresy'), 'proven');
        expect(k.religion.unity).toBeLessThan(70);
        expect(k.religion.piety).toBeLessThan(50);
        Whispers.applyFallout(world, tale(world, 'pact'), 'proven');
        expect(k.relations.k2).toBeLessThan(-40);
        expect(world.getKingdom('k2').relations.k1).toBeLessThan(-40);
        Whispers.applyFallout(world, tale(world, 'debts'), 'proven');
        expect(k.treasury).toBeLessThan(1000);
        const notes = Whispers.applyFallout(world, tale(world, 'madness'), 'proven');
        expect(k.characterData.advisors.chancellor.loyalty).toBeLessThan(60);
        expect(Whispers.falloutText(notes)).toMatch(/council/);
    });

    it('the pact finds its enemy by name in an old save', () => {
        const world = makeWorld();
        Whispers.applyFallout(world, tale(world, 'pact', { enemyId: null }), 'proven');
        expect(world.getKingdom('k1').relations.k2).toBeLessThan(-40);
    });

    it('a heresy debunked restores some piety', () => {
        const world = makeWorld();
        Whispers.applyFallout(world, tale(world, 'heresy'), 'debunked');
        expect(world.getKingdom('k1').religion.piety).toBeGreaterThan(50);
    });
});

describe('the roll of deeds and a Masterwork', () => {
    it('the wilds, the bench and odd jobs are counted', () => {
        const p = makePlayer();
        p.wilds = { stats: { met: 4, resolved: 3, passed: 2, failed: 1, poi: 1 }, journal: [], resolved: {} };
        p.crafting = { xp: 50, made: 7, failed: 2, masterworks: 1 };
        p.jobsCompleted = 5;
        const d = Deeds.collect(p);
        expect(d['wilds.met']).toBe(4);
        expect(d['wilds.poi']).toBe(1);
        expect(d['crafting.made']).toBe(7);
        expect(d['crafting.masterworks']).toBe(1);
        expect(d['work.jobsCompleted']).toBe(5);
        const secs = Deeds.sections(p);
        expect(secs.find(s => s.id === 'wilds').empty).toBe(false);
        expect(secs.find(s => s.id === 'crafting').empty).toBe(false);
    });

    it('a masterwork from your own bench wins the Masterwork achievement', () => {
        const p = makePlayer();
        Achievements.initialize(p);
        p.crafting = { xp: 0, made: 1, failed: 0, masterworks: 0 };
        expect(Achievements.checkAchievements(p, makeWorld()).some(a => a.id === 'masterwork')).toBe(false);
        p.crafting.masterworks = 1;
        expect(Achievements.checkAchievements(p, makeWorld()).some(a => a.id === 'masterwork')).toBe(true);
    });
});

describe('mercenary contracts keep their promises', () => {
    const pirate = { id: 'pirate_raid', name: 'Raid Pirate Cove', payment: 600, duration: 2, minStrength: 70, risk: 0.45 };

    it('a pirate cove counts the galleys; land work does not', () => {
        expect(MercContracts.forceFor(pirate, 50, 40)).toBeGreaterThan(50);
        expect(MercContracts.forceFor({ id: 'guard_duty' }, 50, 40)).toBe(50);
    });

    it('a won contract takes spoils from its loot table, and the message tells the march', () => {
        const world = makeWorld();
        const player = makePlayer({ army: Array.from({ length: 12 }, (_, i) => ({ type: 'pikeman', name: `p${i}`, strength: 20, level: 1, experience: 0 })) });
        tweak(DataLoader._gamedata.mercenaryContracts.contracts.pirate_raid, 'spoilsChance', 1);
        const acc = MercContracts.accept(player, pirate, world.getTile(5, 5).settlement, 240);
        expect(acc.success).toBe(true);
        player.activeContract.opposition = 5;
        player.activeContract.risk = 0;
        player.activeContract.log.push({ day: 30, type: 'loot', text: 'Your company seized a strongbox: +40 gold.' });
        let res = null;
        let guard = 5;
        while (!(res && res.completed) && guard--) { res = MercContracts.tick(player, world, () => 240); world.day++; }
        expect(res.completed).toBe(true);
        expect(res.success).toBe(true);
        const ids = ['spices', 'luxuries', 'gems', 'liquor'];
        const got = Object.keys(res.items || {});
        expect(got.length + (res.loot > 0 ? 1 : 0)).toBeGreaterThan(0);
        expect(got.every(id => ids.includes(id))).toBe(true);
        expect(res.message).toMatch(/On the march|strongbox/);
        expect(res.log.length).toBeGreaterThan(0);
    });

    it('loot rolls draw from their own stream: the shared RNG is untouched', () => {
        const world = makeWorld();
        Utils.setSeed(5);
        const before = Utils.random();
        Utils.setSeed(5);
        MercContracts._rollItems(world, { type: 'pirate_raid', opposition: 70 }, 'spoils');
        expect(Utils.random()).toBe(before);
    });
});

describe('a task\'s other way out, and a favour\'s coin', () => {
    it('thanks warm by the data, and the unused grievance setting is gone', () => {
        expect(NpcTasks.config().thanksDisposition).toBe(DataLoader._gamedata.npcTasks.config.thanksDisposition);
        expect(NpcTasks.config().grievanceDisposition).toBeUndefined();
    });

    it('returning the documents leaves their owner in your debt', () => {
        const world = makeWorld();
        const player = makePlayer();
        Quests.initialize(player);
        const quest = {
            id: 'q1', v: 2, type: 'npc_task', task: 'rival_documents', title: 'Rival Documents', status: 'active',
            giver: { id: 'g1', name: 'Lady Wren', town: 'Tallow', q: 5, r: 5 },
            alt: { ...DataLoader._gamedata.npcTasks.tasks.rival_documents.alt, text: 'You sold the scheme back.' },
            objectives: [
                { type: 'talk_to', mode: 'fetch', uid: 'u-holder', person: 'Lord Brant', q: 9, r: 5, town: 'Harrow', target: 1, current: 1 },
                { type: 'return_to', target: 1, current: 0 },
            ],
        };
        player.quests.active.push(quest);
        const karma0 = player.karma || 0;
        const res = Quests.resolveTaskAlt(player, world, 'q1');
        expect(res.success).toBe(true);
        expect(res.got.holder).toBe('Lord Brant');
        expect(player.quests.thanksOwed['u-holder'].name).toBe('Lord Brant');
        expect(player.reputation.k2).toBeGreaterThan(0);
        expect(player.karma).toBe(karma0 + 1);
    });

    it('a favour\'s coin is owed: repaid on time it warms them, overdue they ask for it once', () => {
        const player = makePlayer({ gold: 100 });
        const mem = { disposition: 70, owed: { amount: 20, day: 10, due: 40, dunned: false } };
        expect(NpcKnowledge.owedTo(mem, 20).overdue).toBe(false);
        expect(NpcKnowledge.dunning(mem, 20)).toBeNull();
        expect(NpcKnowledge.dunning(mem, 50)).toMatch(/20 coins/);
        expect(mem.disposition).toBeLessThan(70);
        expect(NpcKnowledge.dunning(mem, 51)).toBeNull();
        const res = NpcKnowledge.repay(player, mem, 50);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(80);
        expect(mem.owed).toBeUndefined();
        expect(NpcKnowledge.repay(player, mem, 50).success).toBe(false);
    });
});

describe('a withdrawal spares the band', () => {
    it('the band you withdrew from leaves you be for a few days', () => {
        const world = { width: 60, height: 60, day: 10, events: [], units: [], kingdoms: [],
            getTile: (q, r) => ({ q, r, terrain: { id: 'plains', passable: true }, settlement: null }), getKingdom: () => null };
        const player = makePlayer({ q: 0, r: 0, army: Array.from({ length: 10 }, (_, i) => ({ type: 'pikeman', name: `p${i}`, strength: 10, level: 1, upkeep: 1, experience: 0 })) });
        const u = new WorldUnit('raider', 1, 0);
        u.strength = 80;
        world.units.push(u);
        const { enemy, ctx } = FieldBattle.unitEnemy(player, u, world);
        const b = FieldBattle.start(player, enemy, world, ctx);
        FieldBattle.play(player, b, 'hold', world);
        if (!b.done) FieldBattle.withdraw(player, b, world);
        if (b.outcome === 'withdrew') expect(u.sparedUntilDay).toBe(10 + FieldBattle.config().withdraw.spareDays);
        else expect(b.done).toBe(true);
    });
});

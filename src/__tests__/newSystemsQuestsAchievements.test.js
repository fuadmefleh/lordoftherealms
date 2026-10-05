// Achievements and quest-board quests for the newer systems (delves, rivals,
// companions, petitions, holdings, sieges, sagas, the throne and court, the
// underworld, the trading company, discovery and voyages, ailments, foraging
// and hunting, upbringing and the House). Every achievement must be able to
// unlock; every new quest must be offerable (only when its system is within
// reach), progress from what the player does after accepting, and complete.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Achievements } from '../systems/achievements.js';
import { Quests } from '../systems/quests.js';
import { Deeds } from '../systems/deeds.js';
import { Kingship } from '../systems/kingship.js';
import { Legacy } from '../systems/legacy.js';
import { Traits } from '../systems/traits.js';
import { Underworld } from '../systems/underworld.js';
import { Ailments } from '../systems/ailments.js';
import { Delves } from '../systems/delves.js';
import { Petitions } from '../systems/petitions.js';
import { House } from '../systems/house.js';
import { Ships } from '../systems/ships.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(4242));

function blankPlayer(extra = {}) {
    const p = { gold: 0, karma: 0, renown: 0, army: [], reputation: {}, properties: [], inventory: {}, ...extra };
    Quests.initialize(p);
    Achievements.initialize(p);
    return p;
}

const blankWorld = () => ({ day: 0, kingdoms: [] });
const unlocked = (p, w) => Achievements.checkAchievements(p, w).map(a => a.id);

// ── Achievements ──────────────────────────────────────────────────────

/** For each new achievement: put the player in a state that earns it. */
const ACHIEVEMENT_STATES = {
    INTO_THE_DARK: (p) => { p.delves = { stats: { delves: 1 } }; },
    DELVE_MASTER: (p) => { p.delves = { stats: { cleared: 10 } }; },
    SIX_CHAMBERS_DOWN: (p) => { p.delves = { stats: { deepest: 6 } }; },
    EVERY_DARK_PLACE: (p) => { for (const k of Achievements.DELVE_KINDS) Quests.track(p, `delve_cleared_${k}`); },
    DUELIST: (p) => { p.rivals = { stats: { duelsWon: 1 } }; },
    MASTER_DUELIST: (p) => { p.rivals = { stats: { duelsWon: 10 } }; },
    BLOOD_FEUD: (p) => { p.rivals = { stats: { slain: 1 } }; },
    FRIEND_FOR_LIFE: (p) => { p.companions = { stats: { devoted: 1 } }; },
    BAND_OF_BROTHERS: (p) => { p.companions = { stats: { devoted: 3 } }; },
    MAGISTRATE: (p) => { p.petitions = { stats: { ruled: 10 } }; },
    WISDOM_OF_SOLOMON: (p) => { p.petitions = { stats: { ruled: 50 } }; },
    LORD_OF_THE_MANOR: (p) => { p.holdings = { keys: ['1,1'], stats: {} }; },
    IMPROVER_OF_LANDS: (p) => { p.holdings = { keys: [], stats: { projects: 10 } }; },
    IRON_FIST: (p) => { p.holdings = { keys: [], stats: { rebellionsCrushed: 1 } }; },
    UNBROKEN_WALLS: (p) => { p.realmWars = { siegeStats: { relieved: 0, held: 1 } }; },
    THE_GATES_GIVE_WAY: (p) => { p.sieges = { stats: { captured: 1 } }; },
    BREAKER_OF_CITIES: (p) => { p.sieges = { stats: { captured: 5 } }; },
    NO_RELIEF_COMING: (p) => { p.sieges = { stats: { reliefsBeaten: 1 } }; },
    STUFF_OF_SAGAS: (p) => { p.sagas = { stats: { won: 1 } }; },
    SAGA_OF_AGES: (p) => { p.sagas = { stats: { won: 3 } }; },
    WYRMSLAYER: (p) => { Quests.track(p, 'saga_slain_wyrm_wakes'); },
    MONSTER_HUNTER: (p) => { p.bountyHunter = { rank: 1, beastsSlain: 1 }; },
    A_CLAIM_TO_THE_THRONE: (p) => { p.throne = { claims: { k1: { strength: 10 } } }; },
    KINGMAKER: (p) => { Quests.track(p, 'kingmaker'); },
    UNEASY_LIES_THE_HEAD: (p) => { p.house = { stats: { crowned: 1 } }; },
    THE_FULL_COUNCIL: (p) => {
        const council = {};
        for (const o of Kingship.OFFICES) council[o] = { kind: 'courtier', id: o, name: o };
        p.throne = { ruling: { kingdomId: 'k1', since: 0, court: { council, stats: {} } } };
    },
    LAWGIVER: (p) => { p.throne = { ruling: { kingdomId: 'k1', since: 0, court: { council: {}, stats: { edictsPassed: 5 } } } }; },
    LONG_REIGN: (p, w) => {
        p.throne = { ruling: { kingdomId: 'k1', since: 5 } };
        w.day = 5 + Achievements.LONG_REIGN_YEARS * Legacy._daysPerYear();
    },
    ONE_OF_THE_GUILD: (p) => { Underworld.ensure(p).guild.member = true; },
    PRINCE_OF_THIEVES: (p) => {
        const g = Underworld.ensure(p).guild;
        g.member = true;
        g.rank = Underworld.ranks().length - 1;
    },
    CHARTERED_COMPANY: (p) => { p.merchant = { company: { posts: [], stats: {} } }; },
    MERCHANT_PRINCE_OF_THE_SEAS: (p) => {
        p.merchant = { company: { posts: [1, 2, 3, 4, 5].map(i => ({ id: `post${i}` })), stats: {} } };
        Quests.track(p, 'convoys_by_sea', 10);
    },
    HOSTILE_TAKEOVER: (p) => { p.merchant = { company: null, rivals: [{ id: 'h1', status: 'bought' }] }; },
    LAND_HO: (p) => { p.discovery = { stats: { found: 1 } }; },
    CARTOGRAPHER_OF_THE_UNKNOWN: (p) => { p.discovery = { stats: { found: 5, named: 5 } }; },
    SEA_LEGS: (p) => { p.voyageStats = { voyages: 1 }; },
    OLD_SALT: (p) => { p.voyageStats = { daysAtSea: 100 }; },
    ADMIRAL: (p) => { p.ships = [1, 2, 3, 4, 5].map(i => ({ id: `s${i}` })); },
    SURVIVED_THE_BLACK_DEATH: (p) => { Quests.track(p, 'recovered_plague'); },
    MASTER_FORAGER: (p) => { p.foragingTrips = 60; },
    MASTER_OF_THE_HUNT: (p) => { p.huntingTrips = 60; },
    A_PERSON_OF_CHARACTER: (p) => {
        p.traits = { earned: {}, deeds: {} };
        for (const id of Object.keys(Traits.TRAITS).slice(0, 5)) p.traits.earned[id] = { day: 1 };
    },
    RAISED_RIGHT: (p) => { p.children = [{ id: 'c1', firstName: 'Ada', upbringing: { comeOfAge: true, comeOfAgeDay: 200 } }]; },
    BLOOD_ROYAL: (p) => { p.children = [{ id: 'c1', firstName: 'Ada', upbringing: { comeOfAge: true, placement: { kind: 'royal', kingdomId: 'k1' } } }]; },
    THE_LINE_ENDURES: (p) => { p.house = { stats: {}, reigns: [{ name: 'Old Lord' }] }; },
};

describe('New achievements', () => {
    it('about forty were added, each with a check and data presentation', () => {
        const keys = Object.keys(ACHIEVEMENT_STATES);
        expect(keys.length).toBeGreaterThanOrEqual(40);
        const json = DataLoader._gamedata.achievements.achievements || DataLoader._gamedata.achievements;
        for (const k of keys) {
            expect(typeof Achievements.ACHIEVEMENTS[k].check, k).toBe('function');
            expect(json[k], `${k} in data/achievements.json`).toBeTruthy();
            expect(json[k].id).toBe(Achievements.ACHIEVEMENTS[k].id);
        }
    });

    it('every achievement in data has a check, and every check is in data', () => {
        const json = DataLoader._gamedata.achievements.achievements || DataLoader._gamedata.achievements;
        expect(Object.keys(json).filter(k => typeof (Achievements.ACHIEVEMENTS[k] || {}).check !== 'function')).toEqual([]);
        expect(Object.keys(Achievements.ACHIEVEMENTS).filter(k => !json[k])).toEqual([]);
    });

    it('a blank player earns none of them', () => {
        const ids = unlocked(blankPlayer(), blankWorld());
        const newIds = Object.keys(ACHIEVEMENT_STATES).map(k => Achievements.ACHIEVEMENTS[k].id);
        expect(ids.filter(id => newIds.includes(id))).toEqual([]);
    });

    for (const [key, setup] of Object.entries(ACHIEVEMENT_STATES)) {
        it(`${key} unlocks in a state that earns it`, () => {
            const p = blankPlayer();
            const w = blankWorld();
            setup(p, w);
            const id = Achievements.ACHIEVEMENTS[key].id;
            expect(unlocked(p, w)).toContain(id);
            expect(p.achievements.unlocked).toContain(key);
            // Once only
            expect(unlocked(p, w)).not.toContain(id);
        });
    }

    it('thresholds are not met one short', () => {
        const p = blankPlayer();
        p.delves = { stats: { cleared: 9, deepest: 5 } };
        p.foragingTrips = 59;
        for (const k of Achievements.DELVE_KINDS.slice(1)) Quests.track(p, `delve_cleared_${k}`);
        const ids = unlocked(p, blankWorld());
        expect(ids).not.toContain('delve_master');
        expect(ids).not.toContain('six_chambers_down');
        expect(ids).not.toContain('master_forager');
        expect(ids).not.toContain('every_dark_place');
    });

    it('the delve kinds and the wyrm saga match the data', () => {
        expect(Object.keys(Delves.KINDS).sort()).toEqual([...Achievements.DELVE_KINDS].sort());
        const sagas = DataLoader._gamedata.sagas;
        const tmpl = (sagas.templates || sagas.sagas || sagas).wyrm_wakes;
        expect(JSON.stringify(tmpl)).toContain('"role":"boss"');
    });
});

describe('Achievement hooks in the systems', () => {
    it('living through the plague counts (Survived the Black Death)', () => {
        const p = blankPlayer();
        const w = { day: 1, kingdoms: [] };
        Ailments.inflict(p, w, 'plague');
        expect(Ailments.has(p, 'plague')).toBe(true);
        expect(unlocked(p, w)).not.toContain('survived_the_black_death');
        Ailments.cureAll(p);
        expect(p.quests.stats.recovered_plague).toBe(1);
        expect(unlocked(p, w)).toContain('survived_the_black_death');
    });

    it('a cleared delve counts toward its kind', () => {
        const tiles = new Map();
        const w = { day: 10, width: 40, height: 40, kingdoms: [], units: [], getTile: (q, r) => tiles.get(`${q},${r}`) || null, getKingdom: () => null, getAllSettlements: () => [] };
        const tile = { q: 3, r: 3, terrain: { id: 'grassland', passable: true }, improvement: { type: 'cave', name: 'Test cave', icon: '?', explored: false, founded: 300 } };
        tiles.set('3,3', tile);
        const p = new Player();
        p.maxHealth = 1000; p.health = 1000; p.movementRemaining = 50; p.q = 3; p.r = 3; p.inventory = {};
        Quests.initialize(p);
        Delves._live = new Map();
        expect(Delves.start(p, w, tile).success).toBe(true);
        const kind = p.delves.active.kind;
        Delves.finish(p, w, 'cleared');
        expect(p.quests.stats[`delve_cleared_${kind}`]).toBe(1);
    });
});

// ── Quests ────────────────────────────────────────────────────────────

const NEW_QUESTS = [
    'PHYSICIANS_HERBS', 'FURS_FOR_WINTER', 'TOMB_OF_THE_OLD_KINGS', 'THE_DEEP_SEAM', 'THE_BLIND_DARK',
    'THE_DROWNED_HALLS', 'BREAD_FOR_THE_BESIEGED', 'CONVOY_ESCORT', 'COMPANY_CONTRACTS', 'THE_RUMOURED_ISLE',
    'NAME_THE_NEW_LAND', 'A_SEASONED_CREW', 'RUN_THE_BLOCKADE', 'SLAY_THE_SAGA_BEAST', 'SATISFACTION_DEMANDED',
    'THE_MERCIFUL_HAND', 'THE_IRON_LAW', 'SCALES_OF_JUSTICE', 'WALLS_AND_WORKS', 'RAIDERS_AT_THE_GATE',
    'TAKE_THE_TOWN', 'NO_RELIEF_FOR_THEM', 'BY_ROYAL_DECREE', 'THE_KINGMAKERS_WAGER', 'HONOUR_AMONG_THIEVES',
    'A_FRIEND_INDEED',
];

/** Where each Deeds key a deed_since objective reads is kept on the player. */
const DEED_HOME = {
    land: (p, k) => [p, k],
    company: (p, k) => [p.merchant.company.stats, k],
    discovery: (p, k) => [p.discovery.stats, k],
    voyages: (p, k) => [p.voyageStats, k],
    sagas: (p, k) => [p.sagas.stats, k],
    rivals: (p, k) => [p.rivals.stats, k],
    holdings: (p, k) => [p.holdings.stats, k],
    sieges: (p, k) => [p.sieges.stats, k],
    underworld: (p, k) => [p.underworld.stats, k],
    companions: (p, k) => [p.companions.stats, k],
};

/** Advance whatever an objective reads by n, the way the system would. */
function advance(p, obj, n) {
    if (obj.type === 'counter_since') return Quests.track(p, obj.stat, n);
    if (obj.type === 'court_since') {
        const s = p.throne.ruling.court.stats;
        s[obj.stat] = (s[obj.stat] || 0) + n;
        return;
    }
    if (obj.type === 'deed_since') {
        const [prefix, k] = obj.key.split('.');
        const [box, field] = DEED_HOME[prefix](p, k);
        box[field] = (box[field] || 0) + n;
        return;
    }
    if (obj.type === 'deliver_item') {
        p.inventory[obj.item] = (p.inventory[obj.item] || 0) + n;
        return;
    }
    throw new Error(`no way to advance ${obj.type}`);
}

/** A player (and world) with every new system within reach. */
function everywherePlayer() {
    const p = blankPlayer({ renown: 1000 });
    p.q = 0; p.r = 0;
    p.ships = [{ id: 's1', q: 0, r: 0 }];
    p.merchant = { company: { posts: [], contracts: [], stats: { contractsDone: 0 } }, board: [{ id: 'b1', defId: 'siege_relief' }], rivals: [] };
    p.holdings = { keys: ['1,1'], stats: {} };
    p.petitions = { pending: [], stats: {} };
    p.rivals = { list: [{ id: 'r1', name: 'Vex', dead: false }], stats: {} };
    p.sagas = { active: [{ id: 'wyrm_wakes', units: [{ key: 'u1', role: 'boss', slain: false, gone: false }] }], done: [], stats: {} };
    p.realmWars = { wars: {}, ultimatums: {}, truces: {}, besieged: { '1,1': { name: 'Millbrook' } } };
    p.sieges = { active: { q: 2, r: 2 }, stats: {} };
    p.army = [{ type: 'infantry' }, { type: 'infantry' }, { type: 'archers' }];
    p.throne = { claims: {}, crises: [{ id: 'cr1', kingdomId: 'k2' }], ruling: { kingdomId: 'k1', since: 0, court: { council: {}, stats: { edictsPassed: 0 } } } };
    p.underworld = { guild: { member: true, contactMet: true, rank: 0 }, stats: {} };
    p.travelParty = [{ id: 'c1' }];
    p.companions = { stats: {} };
    p.discovery = { sites: [], stats: {} };
    p.voyageStats = {};
    p.foragingTrips = 0;
    p.huntingTrips = 0;
    const world = {
        day: 30, width: 4, height: 4, tiles: [],
        kingdoms: [{ id: 'k1', isAlive: true, navy: { blockades: { k2: { since: 1 } } } }],
        getTile: () => null,
    };
    return { p, world };
}

describe('New quest templates', () => {
    it('are all loaded, with known requirements and trackable objectives', () => {
        const kingshipStats = Object.keys(Kingship._blank().stats);
        const deedKeys = Object.keys(Deeds.collect({}));
        const earlyJobs = JSON.stringify(DataLoader._gamedata.earlyJobs || {});
        for (const key of NEW_QUESTS) {
            const t = Quests.QUEST_TEMPLATES[key];
            expect(t, key).toBeTruthy();
            for (const r of [].concat(t.requires || [])) expect(Quests.REQUIREMENTS[r], `${key} requires ${r}`).toBeTypeOf('function');
            for (const o of t.objectives) {
                expect(Quests.UNTRACKABLE_OBJECTIVES).not.toContain(o.type);
                expect(['counter_since', 'deed_since', 'court_since', 'deliver_item'], `${key}: ${o.type}`).toContain(o.type);
                if (o.type === 'deed_since') expect(deedKeys, `${key}: ${o.key}`).toContain(o.key);
                if (o.type === 'court_since') expect(kingshipStats, `${key}: ${o.stat}`).toContain(o.stat);
                if (o.type === 'deliver_item') expect(earlyJobs, `${key}: ${o.item} is foraged or hunted`).toContain(`"item":"${o.item}"`);
            }
        }
    });

    it('every counter a quest or achievement reads is emitted by a Quests.track call in the game', () => {
        const files = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const f = path.join(dir, e.name);
                if (e.isDirectory()) { if (e.name !== '__tests__') walk(f); } else if (/\.jsx?$/.test(e.name)) files.push(f);
            }
        };
        walk(path.resolve(__dirname, '..'));
        const emitted = [];
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf8');
            for (const m of src.matchAll(/Quests\.track\([^,]+,\s*(?:[^'`]*\?\s*)?(['`])([^'`]+)\1/g)) emitted.push(m[2]);
        }
        const patterns = emitted.map(s => new RegExp(`^${s.replace(/\$\{[^}]+\}/g, '[a-z_]+')}$`));
        const isEmitted = (stat) => patterns.some(re => re.test(stat));
        const stats = NEW_QUESTS.flatMap(k => Quests.QUEST_TEMPLATES[k].objectives.filter(o => o.type === 'counter_since').map(o => o.stat));
        stats.push('kingmaker', 'recovered_plague', 'convoys_by_sea', 'saga_slain_wyrm_wakes', ...Achievements.DELVE_KINDS.map(k => `delve_cleared_${k}`));
        for (const s of stats) expect(isEmitted(s), `${s} is tracked somewhere`).toBe(true);
    });

    it('none is offered when its system is out of reach', () => {
        const p = blankPlayer({ renown: 1000 });
        const gated = NEW_QUESTS.filter(k => Quests.QUEST_TEMPLATES[k].requires).map(k => Quests.QUEST_TEMPLATES[k].id);
        expect(gated.length).toBeGreaterThanOrEqual(18);
        const w = { day: 1, kingdoms: [], getTile: () => null };
        for (let i = 0; i < 150; i++) {
            p.quests.available = [];
            Quests.generateAvailableQuests(p, w);
            for (const q of p.quests.available) expect(gated, q.id).not.toContain(q.id);
        }
    });

    it('every one is offered once its system is within reach', () => {
        const { p, world } = everywherePlayer();
        const want = new Set(NEW_QUESTS.map(k => Quests.QUEST_TEMPLATES[k].id));
        for (let i = 0; i < 400 && want.size; i++) {
            p.quests.available = [];
            Quests.generateAvailableQuests(p, world);
            for (const q of p.quests.available) want.delete(q.id);
        }
        expect([...want]).toEqual([]);
    });

    it('a sea quest needs a ship or a port; the board drops it when neither holds', () => {
        const { p, world } = everywherePlayer();
        const t = Quests.QUEST_TEMPLATES.THE_RUMOURED_ISLE;
        expect(Quests.isReachable(t, p, world)).toBe(true);
        p.ships = [];
        expect(Quests.isReachable(t, p, world)).toBe(false);
        // Standing in a port town by the water is enough
        const water = { id: Ships.WATER_TERRAINS[0] };
        const portWorld = { ...world, getTile: (q, r) => (q === 0 && r === 0 ? { q, r, settlement: { name: 'Port' }, terrain: { id: 'plains' } } : { q, r, terrain: water }) };
        expect(Quests.isReachable(t, p, portWorld)).toBe(true);
        // Inland and shipless: the offer leaves the board at the next daily tidy
        p.quests.available = [Quests.createQuest('THE_RUMOURED_ISLE', p)];
        Quests.updateProgress(p, world);
        expect(p.quests.available.some(q => q.id === 'the_rumoured_isle')).toBe(false);
    });

    for (const key of NEW_QUESTS) {
        it(`${key} progresses only from acceptance and completes`, () => {
            const { p, world } = everywherePlayer();
            const t = Quests.QUEST_TEMPLATES[key];
            // Deeds done before the quest was taken don't count
            for (const o of t.objectives) if (o.type !== 'deliver_item') advance(p, o, 7);
            p.quests.available = [Quests.createQuest(key, p)];
            expect(Quests.isReachable(p.quests.available[0], p, world)).toBe(true);
            const res = Quests.acceptQuest(p, t.id, world);
            expect(res.success).toBe(true);
            Quests.updateProgress(p, world);
            const quest = p.quests.active.find(q => q.id === t.id);
            expect(quest, 'still active after accepting').toBeTruthy();
            expect(quest.objectives.every(o => o.current === 0)).toBe(true);

            // Half-way: progress shows, not complete
            for (const o of t.objectives) if (o.target > 1) advance(p, o, 1);
            expect(Quests.updateProgress(p, world).map(q => q.id)).not.toContain(t.id);
            if (t.objectives.some(o => o.target > 1)) expect(quest.objectives.some(o => o.current >= 1)).toBe(true);

            // Do the rest
            for (const o of t.objectives) advance(p, o, o.target > 1 ? o.target - 1 : o.target);
            const gold0 = p.gold;
            const renown0 = p.renown;
            const done = Quests.updateProgress(p, world);
            expect(done.map(q => q.id)).toContain(t.id);
            expect(p.quests.completed.some(q => q.id === t.id)).toBe(true);
            expect(p.gold).toBe(gold0 + (t.rewards.gold || 0));
            expect(p.renown).toBe(renown0 + (t.rewards.renown || 0));
            // Goods asked for are handed over
            for (const o of t.objectives.filter(x => x.type === 'deliver_item')) expect(p.inventory[o.item] || 0).toBe(0);
        });
    }
});

describe('Quest hooks in the systems', () => {
    it('a merciful ruling on a petition advances The Merciful Hand', () => {
        const tiles = new Map();
        const kingdoms = [{ id: 'k1', name: 'Varr', isAlive: true, military: 500, stability: 60, wars: [] }];
        const world = { day: 10, season: 'Winter', kingdoms, getTile: (q, r) => tiles.get(`${q},${r}`) || null, getKingdom: (id) => kingdoms.find(k => k.id === id) || null };
        tiles.set('1,1', { q: 1, r: 1, settlement: { name: 'Millbrook', type: 'town', population: 900, kingdom: 'k1', happiness: 50, colony: { isPlayerColony: true, loyalty: 50 } } });
        const p = blankPlayer({ id: 'p1', lastName: 'Ashborne', gold: 5000, houses: [], children: [], colonies: [{ q: 1, r: 1 }] });
        House.initialize(p, world);
        p.holdings = { keys: ['1,1'], stats: {} };
        p.quests.available = [Quests.createQuest('THE_MERCIFUL_HAND', p)];
        Quests.acceptQuest(p, 'the_merciful_hand', world);
        const def = Petitions.getDef('land_dispute');
        const choice = def.choices.find(c => c.effects && c.effects.court && c.effects.court.mercy > 0);
        expect(choice).toBeTruthy();
        for (let i = 0; i < 2; i++) {
            const pet = Petitions._create(p, world, def, 'land_dispute', Petitions._buildCtx(def, { kind: 'settlement', q: 1, r: 1, settlement: world.getTile(1, 1).settlement }, p, world));
            expect(Petitions.rule(p, world, pet.id, choice.id).success).toBe(true);
        }
        expect(p.quests.stats.ruled_mercy).toBe(2);
        expect(Quests.updateProgress(p, world).map(q => q.id)).toContain('the_merciful_hand');
    });
});

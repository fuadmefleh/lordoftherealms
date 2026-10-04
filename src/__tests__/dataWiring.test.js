// Data that the code used to ignore (hardcoded values shadowed the JSON) and
// content that could never be reached (Heresy Hunter, Alliance Broker).

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Banking } from '../systems/marketDynamics.js';
import { Gossip } from '../systems/gossip.js';
import { WorldUnit } from '../world/units.js';
import { Religion } from '../systems/religion.js';
import { Quests } from '../systems/quests.js';
import { Achievements } from '../systems/achievements.js';
import { Relationships } from '../systems/relationships.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { RealmPolitics, REALM_POLITICS } from '../player/realmPolitics.js';

let ActionMenu;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

const gd = () => DataLoader._gamedata;

// ── Loans ──────────────────────────────────────────────────────────────
describe('Banking loan options come from data/market.json', () => {
    it('offers exactly the data catalogue', () => {
        const player = { gold: 10000, properties: [] };
        const opts = Banking.getLoanOptions(player, 'k1');
        expect(opts.map(o => o.id)).toEqual(gd().market.loanOptions.map(o => o.id));
        expect(opts.map(o => o.amount)).toEqual(gd().market.loanOptions.map(o => o.amount));
        expect(opts.every(o => o.kingdomId === 'k1')).toBe(true);
    });

    it('a data change reaches the game', () => {
        const saved = Banking._loanOptions;
        try {
            Banking._loanOptions = [{ id: 'tiny', name: 'Tiny Loan', amount: 50, interestRate: 0.05, duration: 5 }];
            const opts = Banking.getLoanOptions({ gold: 30, properties: [] }, 'k1');
            expect(opts).toHaveLength(1);
            expect(opts[0]).toMatchObject({ id: 'tiny', amount: 50, available: true });
        } finally {
            Banking._loanOptions = saved;
        }
    });

    it('falls back to the built-in catalogue without data', () => {
        const saved = Banking._loanOptions;
        try {
            Banking._loanOptions = null;
            const opts = Banking.getLoanOptions({ gold: 300, properties: [] }, 'k1');
            expect(opts.map(o => o.id)).toEqual(['small', 'medium', 'large']);
            expect(opts.map(o => o.available)).toEqual([true, false, false]);
        } finally {
            Banking._loanOptions = saved;
        }
    });
});

// ── Gambling ───────────────────────────────────────────────────────────
describe('Gambling settings come from data/earlyJobs.json', () => {
    it('lists the data minigames by the ids the menu dispatches on', () => {
        const ids = ActionMenu._getGamblingData().map(g => g.id);
        expect(ids).toEqual(['crown_anchor', 'dragons_flip', 'high_low', 'poker']);
        expect(ids).toEqual(gd().earlyJobs.gambling.games.map(g => g.id));
    });

    it('data values match the shipped behaviour', () => {
        expect(ActionMenu._getGamblingGame('dragons_flip')).toMatchObject({ minBet: 10, maxBet: 500, winChance: 0.48, payoutMultiplier: 2 });
        expect(ActionMenu._getGamblingGame('high_low')).toMatchObject({ minBet: 5, maxBet: 200, streakBonus: 0.5 });
        expect(ActionMenu._getGamblingSettings().apCostPerRound).toBe(2);
    });

    it('a data change reaches the game; missing data falls back', () => {
        const saved = DataLoader.earlyJobs.gambling;
        try {
            DataLoader.earlyJobs.gambling = { ...saved, games: saved.games.map(g => g.id === 'high_low' ? { ...g, maxBet: 75 } : g) };
            expect(ActionMenu._getGamblingGame('high_low').maxBet).toBe(75);
            delete DataLoader.earlyJobs.gambling;
            expect(ActionMenu._getGamblingGame('high_low').maxBet).toBe(200);
            expect(ActionMenu._getGamblingData()).toHaveLength(4);
        } finally {
            DataLoader.earlyJobs.gambling = saved;
        }
    });
});

// ── Unit templates ─────────────────────────────────────────────────────
describe('World units come from data/units.json', () => {
    it('built-in fallbacks agree with the data (no drift)', () => {
        const data = gd().units;
        for (const [type, def] of Object.entries(WorldUnit.DEFAULT_TYPES)) {
            expect(data.unitTypes[type], type).toEqual(def);
        }
        for (const [theme, def] of Object.entries(WorldUnit.DEFAULT_THEMES)) {
            expect(data.inventoryThemes[theme], theme).toEqual(def);
        }
        expect(data.maxAge).toEqual(WorldUnit.DEFAULT_MAX_AGE);
    });

    it('settlers start with the data starting inventory', () => {
        const u = new WorldUnit('settler', 0, 0);
        expect(u.inventory).toEqual(gd().units.unitTypes.settler.initialInventory);
    });

    it('produces identical units with or without data loaded', () => {
        const types = ['caravan', 'raider', 'patrol', 'settler', 'ship', 'pirate', 'fishing_boat', 'lord_party', 'monster'];
        const roll = () => {
            Utils.setSeed(4242);
            return types.map(t => {
                const u = new WorldUnit(t, 1, 2);
                return { icon: u.icon, name: u.name, speed: u.speed, population: u.population, strength: u.strength, inventory: u.inventory, maxAge: u.maxAge };
            }).slice(0, 8); // monster has no built-in fallback
        };
        const withData = roll();
        const saved = [WorldUnit.TYPES, WorldUnit.THEMES, WorldUnit.MAX_AGE, WorldUnit.DEFAULTS];
        try {
            WorldUnit.TYPES = {}; WorldUnit.THEMES = {}; WorldUnit.MAX_AGE = null; WorldUnit.DEFAULTS = null;
            expect(roll()).toEqual(withData);
        } finally {
            [WorldUnit.TYPES, WorldUnit.THEMES, WorldUnit.MAX_AGE, WorldUnit.DEFAULTS] = saved;
        }
    });

    it('a data change reaches the game', () => {
        const saved = WorldUnit.TYPES.caravan;
        try {
            WorldUnit.TYPES.caravan = { ...saved, speed: 9, name: 'Big Caravan' };
            const u = new WorldUnit('caravan', 0, 0);
            expect(u.speed).toBe(9);
            expect(u.name).toBe('Big Caravan');
        } finally {
            WorldUnit.TYPES.caravan = saved;
        }
    });
});

// ── Gossip ─────────────────────────────────────────────────────────────
function gossipWorld(day) {
    const settlements = [
        { q: 0, r: 0, name: 'Origin', kingdom: 'k1' },
        { q: 1, r: 0, name: 'Nearby', kingdom: 'k1' },
    ];
    return {
        day, width: 50, units: [],
        kingdoms: [{ id: 'k1', settlements }],
        getTile: (q, r) => ({ settlement: settlements.find(s => s.q === q && s.r === r) }),
    };
}

function makeRumor(id, dayCreated, spreadTo) {
    return {
        id, type: 'theft', perpetrator: 'P', victim: { name: 'V' }, locationQ: 0, locationR: 0,
        dayCreated, credibility: 1, severity: 25, spreadTo, consequencesApplied: {}, expired: false,
    };
}

describe('Gossip reads decayRate and maxRumorsPerSettlement', () => {
    it('decayRate speeds up how fast rumors expire', () => {
        const saved = DataLoader.gossip.decayRate;
        try {
            const decayDays = DataLoader.gossip.rumorTypes.theft.decayDays;
            const age = Math.ceil(decayDays / 2);
            const run = (rate) => {
                DataLoader.gossip.decayRate = rate;
                const player = { name: 'P', reputation: {} };
                Gossip.initializePlayer(player);
                player.gossip.rumors.push(makeRumor(1, 0, ['0,0']));
                Gossip.processDaily(player, gossipWorld(age));
                return player.gossip.rumors[0].expired;
            };
            expect(run(1)).toBe(false);
            expect(run(2)).toBe(true);
        } finally {
            DataLoader.gossip.decayRate = saved;
        }
    });

    it('a settlement full of rumors takes no new ones', () => {
        const saved = DataLoader.gossip.maxRumorsPerSettlement;
        vi.spyOn(Utils, 'random').mockReturnValue(0); // every spread roll succeeds
        try {
            const run = (max) => {
                DataLoader.gossip.maxRumorsPerSettlement = max;
                const player = { name: 'P', reputation: {} };
                Gossip.initializePlayer(player);
                player.gossip.rumors.push(makeRumor(1, 0, ['1,0'])); // already at Nearby
                player.gossip.rumors.push(makeRumor(2, 0, ['0,0'])); // wants to spread to Nearby
                Gossip.processDaily(player, gossipWorld(1));
                return player.gossip.rumors[1].spreadTo.includes('1,0');
            };
            expect(run(30)).toBe(true);
            expect(run(1)).toBe(false);
        } finally {
            DataLoader.gossip.maxRumorsPerSettlement = saved;
        }
    });
});

// ── Heresy Hunter ──────────────────────────────────────────────────────
function makePlayer(extra = {}) {
    const player = { name: 'Hero', gold: 1000, karma: 0, renown: 0, faith: 5, charisma: 5, reputation: {}, properties: [], army: [], ...extra };
    Quests.initialize(player);
    Achievements.initialize(player);
    return player;
}

function heresyWorld(strength) {
    const kingdom = {
        id: 'k1', name: 'Avalon', isAlive: true,
        religion: { faithId: 'x', piety: 20, heresies: [{ id: 'dualist_heresy', name: 'Dualist Heresy', strength }] },
    };
    return { kingdom, world: { day: 1, events: [], kingdoms: [kingdom], getKingdom: (id) => (id === 'k1' ? kingdom : null) } };
}

describe('Heresy Hunter is reachable', () => {
    it('suppressing a heresy removes it and tracks the deed', () => {
        const { kingdom, world } = heresyWorld(10);
        const player = makePlayer();
        const res = Religion.suppressHeresy(player, kingdom, world, 15);
        expect(res.suppressed).toBe(true);
        expect(kingdom.religion.heresies).toHaveLength(0);
        expect(player.quests.stats.heresies_suppressed).toBe(1);
        expect(world.events.some(e => e.text.includes('Dualist Heresy'))).toBe(true);
    });

    it('denouncing heresy is offered where a heresy rages and wears it down', () => {
        const { kingdom, world } = heresyWorld(100);
        const player = makePlayer();
        const settlement = { kingdom: 'k1', name: 'Camelot' };
        expect(PlayerReligion.heresyAt(settlement, world).heresy.name).toBe('Dualist Heresy');
        Utils.setSeed(1);
        const first = PlayerReligion.denounceHeresy(player, settlement, world);
        expect(first.success).toBe(true);
        expect(first.suppressed).toBe(false);
        expect(kingdom.religion.heresies[0].strength).toBeLessThan(100);
        let res = first;
        for (let i = 0; i < 20 && !res.suppressed; i++) res = PlayerReligion.denounceHeresy(player, settlement, world);
        expect(res.suppressed).toBe(true);
        expect(player.quests.stats.heresies_suppressed).toBe(1);
        expect(player.reputation.k1).toBeGreaterThan(0);
        expect(PlayerReligion.denounceHeresy(player, settlement, world).success).toBe(false);
    });

    it('the Heresy Hunter quest completes and the achievement unlocks', () => {
        const player = makePlayer();
        const quest = Quests.createQuest('HERESY_HUNTER', player);
        player.quests.active.push(quest);
        for (let i = 0; i < 5; i++) {
            const { kingdom, world } = heresyWorld(1);
            Religion.suppressHeresy(player, kingdom, world, 10);
        }
        Quests.updateProgress(player, { kingdoms: [], width: 0, height: 0, tiles: [] });
        expect(quest.objectives[0].current).toBe(5);
        expect(quest.objectives[0].completed).toBe(true);
        const ids = Achievements.checkAchievements(player, { kingdoms: [] }).map(a => a.id);
        expect(ids).toContain('heresy_hunter');
    });
});

// ── Alliance Broker ────────────────────────────────────────────────────
function allianceWorld(relations = 50) {
    const a = { id: 'a', name: 'Avalon', isAlive: true, relations: { b: relations, c: -20 }, allies: [], wars: [] };
    const b = { id: 'b', name: 'Brennor', isAlive: true, relations: { a: relations, c: 0 }, allies: [], wars: [] };
    const c = { id: 'c', name: 'Corvane', isAlive: true, relations: { a: -20, b: 0 }, allies: [], wars: [] };
    const kingdoms = [a, b, c];
    return { a, b, world: { day: 5, events: [], kingdoms, getKingdom: (id) => kingdoms.find(k => k.id === id) } };
}

describe('Alliance Broker is reachable', () => {
    it('only crowns at peace and on warm terms are candidates', () => {
        const { world } = allianceWorld(50);
        const pairs = RealmPolitics.allianceCandidates(world).map(p => [p.a.id, p.b.id]);
        expect(pairs).toEqual([['a', 'b']]);
        world.kingdoms[0].wars.push('b');
        expect(RealmPolitics.allianceCandidates(world)).toHaveLength(0);
    });

    it('a successful envoy forms the alliance and tracks it', () => {
        const { a, b, world } = allianceWorld(50);
        const player = makePlayer();
        vi.spyOn(Utils, 'random').mockReturnValue(0);
        const res = RealmPolitics.brokerAlliance(player, world, 'a', 'b');
        expect(res.success).toBe(true);
        expect(res.failed).toBeUndefined();
        expect(a.allies).toContain('b');
        expect(b.allies).toContain('a');
        expect(a.relations.b).toBeGreaterThanOrEqual(REALM_POLITICS.alliance.sealRelations);
        expect(player.gold).toBe(1000 - REALM_POLITICS.alliance.fee);
        expect(player.quests.stats.alliances_formed).toBe(1);
        // Already allied — no longer a candidate
        expect(RealmPolitics.brokerAlliance(player, world, 'a', 'b').success).toBe(false);
    });

    it('a failed envoy costs the fee and sets a cooldown', () => {
        const { a, world } = allianceWorld(50);
        const player = makePlayer();
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        const res = RealmPolitics.brokerAlliance(player, world, 'a', 'b');
        expect(res.failed).toBe(true);
        expect(a.allies).toHaveLength(0);
        expect(player.quests.stats.alliances_formed).toBeUndefined();
        expect(RealmPolitics.brokerAlliance(player, world, 'a', 'b').success).toBe(false);
    });

    it('both quests can now be offered', () => {
        expect(Quests.UNTRACKABLE_OBJECTIVES).toEqual([]);
        const player = makePlayer({ renown: 1000 });
        const seen = new Set();
        for (let i = 0; i < 200 && !(seen.has('heresy_hunter') && seen.has('alliance_broker')); i++) {
            player.quests.available = [];
            Quests.generateAvailableQuests(player);
            for (const q of player.quests.available) seen.add(q.id);
        }
        expect(seen.has('heresy_hunter')).toBe(true);
        expect(seen.has('alliance_broker')).toBe(true);
    });
});

// ── Relationships ──────────────────────────────────────────────────────
describe('relationshipTypes and fatherMaxAge are read', () => {
    it('relation labels follow the data bands (same thresholds as before)', () => {
        const label = (s) => Relationships.getRelationLabel(s).label;
        expect([95, 90, 60, 59, 30, 10, 9, 0, -29, -30, -59, -60, -100].map(label)).toEqual([
            'Best Friend', 'Best Friend', 'Close Friend', 'Friend', 'Friend', 'Acquaintance', 'Neutral', 'Neutral',
            'Neutral', 'Rival', 'Rival', 'Nemesis', 'Nemesis',
        ]);
    });

    it('a data change reaches the labels', () => {
        const types = DataLoader.relationships.relationshipTypes;
        const saved = types.friend;
        try {
            types.friend = { ...saved, label: 'Pal', minScore: 20 };
            expect(Relationships.getRelationLabel(25).label).toBe('Pal');
        } finally {
            types.friend = saved;
        }
    });

    it('no children are born once the father is past fatherMaxAge', () => {
        const settings = DataLoader.relationships.heirSettings;
        const savedNpcs = Relationships._npcs;
        vi.spyOn(Utils, 'random').mockReturnValue(0); // childbirth roll always succeeds
        try {
            const spouse = { id: 'npc_w', firstName: 'Wren', age: 30, gender: 'female', culture: 'Imperial' };
            Relationships._npcs = [spouse];
            const player = { gender: 'male', age: settings.fatherMaxAge + 1, spouse: 'npc_w', children: [], relationships: {} };
            const world = { day: settings.daysPerYear };
            expect(Relationships.checkChildbirth(player, world)).toBeNull();
            player.age = settings.fatherMaxAge - 10;
            expect(Relationships.checkChildbirth(player, world)).not.toBeNull();
        } finally {
            Relationships._npcs = savedNpcs;
        }
    });
});

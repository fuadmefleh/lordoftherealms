// Rival adventurers (systems/rivals.js): a small named cast who delve, hunt
// bounties, take quests, enter contests and remember the player.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Rivals } from '../systems/rivals.js';
import { Delves } from '../systems/delves.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { World } from '../world/world.js';
import { addSettlementActions } from '../player/actions/settlementActions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const W = 40;
const H = 30;

/** A small world: plains everywhere, three towns, two ruins. */
function makeWorld(day = 5) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: { id: 'grassland', passable: true } });
        tiles.push(row);
    }
    const towns = [
        { q: 5, r: 5, name: 'Tallow', type: 'town', kingdom: 'k1', population: 800 },
        { q: 12, r: 6, name: 'Brindle', type: 'capital', kingdom: 'k1', population: 2000 },
        { q: 8, r: 14, name: 'Mossford', type: 'village', kingdom: 'k1', population: 200 },
    ];
    for (const t of towns) tiles[t.r][t.q].settlement = { ...t };
    tiles[7][9].improvement = { type: 'ruins', name: 'Sunken Ruins of Tallow', icon: '🏛️', explored: false };
    tiles[10][15].improvement = { type: 'ruins', name: 'Old Keep', icon: '🏛️', explored: false };
    const world = {
        day, width: W, height: H, tiles, units: [],
        kingdoms: [{ id: 'k1', name: 'Arvenland', isAlive: true, settlements: towns }],
        getTile: (q, r) => (tiles[r] && tiles[r][q]) || null,
        getKingdom: (id) => world.kingdoms.find(k => k.id === id) || null,
        getAllSettlements() {
            const out = [];
            for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (tiles[r][q].settlement) out.push({ q, r, ...tiles[r][q].settlement });
            return out;
        },
    };
    return world;
}

function makePlayer() {
    const p = new Player();
    p.name = 'Aldric';
    p.q = 5; p.r = 5;
    p.gold = 1000;
    p.health = 100; p.maxHealth = 100;
    p.renown = 10;
    p.inventory = {};
    p.army = [];
    return p;
}

/** Advance n days of rival life; returns all notices. */
function runDays(world, player, n) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        world.day++;
        notices.push(...Rivals.processDay(world, player).notices);
    }
    return notices;
}

beforeEach(() => {
    Utils.setSeed(1234);
    Delves._live = new Map();
});

describe('rival content (data/rivals.json)', () => {
    it('is registered with DataLoader and has a varied cast of archetypes with lines', () => {
        const data = Rivals.data();
        expect(data.config).toBeTruthy();
        const arch = Rivals.archetypes();
        for (const id of ['treasure_hunter', 'sellsword', 'bounty_hunter', 'crusader', 'merchant_adventurer', 'usurper']) {
            expect(arch[id]).toBeTruthy();
            expect(arch[id].lines.greet.length).toBeGreaterThan(0);
            expect(arch[id].lines.hostile.length).toBeGreaterThan(0);
            expect(Object.keys(arch[id].goals).length).toBeGreaterThan(0);
        }
        expect(DataLoader.gossip.rumorTypes.slander).toBeTruthy();
        expect(DataLoader.gossip.rumorTypes.slander.bountyGold).toBe(0);
    });
});

describe('the cast', () => {
    it('is created lazily on the first daily tick, 6–9 strong, with homes and goals', () => {
        const world = makeWorld();
        const player = makePlayer();
        expect(Rivals.state(player).initialized).toBe(false);
        expect(Rivals.alive(player)).toHaveLength(0);
        Rivals.processDay(world, player);
        const cast = Rivals.alive(player);
        expect(cast.length).toBeGreaterThanOrEqual(6);
        expect(cast.length).toBeLessThanOrEqual(9);
        expect(new Set(cast.map(r => r.name)).size).toBe(cast.length);
        for (const r of cast) {
            expect(r.home && r.home.name).toBeTruthy();
            expect(r.renown).toBeGreaterThan(0);
            expect(r.stats.prowess).toBeGreaterThan(0);
        }
    });

    it('is deterministic for a seed', () => {
        const run = () => {
            Utils.setSeed(77);
            const world = makeWorld();
            const player = makePlayer();
            runDays(world, player, 40);
            return JSON.stringify({ list: Rivals.state(player).list, news: Rivals.state(player).news });
        };
        expect(run()).toBe(run());
    });

    it('acts on the world over time and records news', () => {
        const world = makeWorld();
        const player = makePlayer();
        runDays(world, player, 120);
        expect(Rivals.news(player, 40).length).toBeGreaterThan(0);
        const deeds = Rivals.state(player).list.reduce((s, r) => s + r.deeds.delves + r.deeds.quests + r.deeds.tournaments + r.deeds.bounties, 0);
        expect(deeds).toBeGreaterThan(0);
    });

    it('newcomers replace the dead', () => {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        const before = Rivals.alive(player).length;
        for (const r of Rivals.alive(player)) r.dead = { day: world.day, cause: 'test' };
        runDays(world, player, 25);
        expect(Rivals.alive(player).length).toBeGreaterThan(0);
        expect(Rivals.state(player).list.length).toBeGreaterThan(before);
    });
});

describe('delving first', () => {
    it('a rival can partly loot a site: thinner hauls for the player afterwards', () => {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        const rival = Rivals.alive(player)[0];
        rival.stats.prowess = 1; // unlikely to clear it fully
        const tile = world.getTile(9, 7);
        Utils.setRng(() => 0.99); // no death, no full clear, max share
        rival.task = { type: 'delve', q: 9, r: 7, name: tile.improvement.name, key: '9,7', arriveDay: world.day };
        Rivals._resolveTask(player, world, rival, () => {});
        Utils.resetRng();
        expect(tile.improvement.explored).toBe(false);
        expect(tile.improvement.rivalLooted.by).toBe(rival.name);
        expect(tile.improvement.rivalLooted.lootFactor).toBeLessThan(1);
        expect(Delves.isDelveSite(tile)).toBe(true);
        player.q = 9; player.r = 7;
        const res = Delves.start(player, world, tile);
        expect(res.success).toBe(true);
        expect(res.delve.lootFactor).toBe(tile.improvement.rivalLooted.lootFactor);
        expect(res.delve.lootedBy).toBe(rival.name);
    });

    it('a rival can clear a site: it is no longer delvable ("already looted by …")', () => {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        const rival = Rivals.alive(player)[0];
        rival.stats.prowess = 10;
        const tile = world.getTile(9, 7);
        let n = 0;
        Utils.setRng(() => (n++ === 0 ? 0.99 : 0.01)); // survive, then clear
        rival.task = { type: 'delve', q: 9, r: 7, name: tile.improvement.name, key: '9,7', arriveDay: world.day };
        Rivals._resolveTask(player, world, rival, () => {});
        Utils.resetRng();
        expect(tile.improvement.explored).toBe(true);
        expect(tile.improvement.lootedBy).toBe(rival.name);
        expect(Delves.isDelveSite(tile)).toBe(false);
        expect(Rivals.news(player)[0].text).toContain('cleared Sunken Ruins of Tallow');
    });
});

describe('bounties and quests', () => {
    it('a bounty hunter can bring in your accepted bounty before you', () => {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        const rival = Rivals.alive(player)[0];
        rival.stats.prowess = 10;
        const bounty = { id: 'b1', type: 'criminal_hunt', status: 'active', targetName: 'Copper Jack', targetQ: 7, targetR: 7, difficulty: 3, actualPay: 200, fromSettlement: 'Tallow' };
        player.activeBounties = [bounty];
        rival.q = 5; rival.r = 5;
        const task = Rivals._planTask(player, world, rival, 'bounty');
        expect(task.bountyId).toBe('b1');
        expect(bounty.rivalHunter.name).toBe(rival.name);
        rival.task = task;
        const notices = [];
        Utils.setRng(() => 0.01);
        Rivals._resolveTask(player, world, rival, (icon, title, text) => notices.push({ title, text }));
        Utils.resetRng();
        expect(player.activeBounties).toHaveLength(0);
        expect(notices.some(n => n.title === 'Bounty Claimed')).toBe(true);
    });

    it('a rival near you takes an offer off your quest journal', () => {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        player.quests = { active: [], completed: [], available: [{ id: 'q1', title: 'Clear the Road', objectives: [] }] };
        const rival = Rivals.alive(player)[0];
        const s = world.getAllSettlements()[0];
        const offer = Rivals._takeQuestOffer(player, world, rival, s);
        expect(offer.title).toBe('Clear the Road');
        expect(player.quests.available).toHaveLength(0);
    });
});

describe('meeting rivals', () => {
    function setup() {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        const rival = Rivals.alive(player)[0];
        rival.task = null;
        rival.q = player.q; rival.r = player.r;
        return { world, player, rival };
    }

    it('rivals resting in town are met on arrival and offered in the action menu', () => {
        const { world, player, rival } = setup();
        const tile = world.getTile(player.q, player.r);
        const met = Rivals.onPlayerArrived(player, world, tile);
        expect(met.map(m => m.rival.id)).toContain(rival.id);
        expect(rival.met).toBe(true);
        const actions = [];
        addSettlementActions(actions, player, tile, world, { isCity: true, isVillage: false, isPlayerSettlement: false, playerSettlementCount: 0, playerKingdom: null, hasPlayerFoundedKingdom: false });
        expect(actions.some(a => a.type === 'rivals_here')).toBe(true);
        expect(actions.some(a => a.type === 'hall_of_heroes')).toBe(true);
    });

    it('a duel is resolved with personal power; the loser remembers it', () => {
        const { world, player, rival } = setup();
        player.skills.combat = 10;
        player.strength = 10;
        rival.stats.prowess = 1;
        rival.level = 1;
        const renown = player.renown;
        const res = Rivals.duel(player, world, rival.id);
        expect(res.success).toBe(true);
        expect(res.playerWon).toBe(true);
        expect(player.renown).toBeGreaterThan(renown);
        expect(rival.attitude).toBeLessThan(0);
        expect(rival.memory[0].text).toContain('duel');
        expect(Rivals.duel(player, world, rival.id).success).toBe(false); // once a day
    });

    it('a duel to the death can kill a rival', () => {
        const { world, player, rival } = setup();
        rival.attitude = -50;
        player.skills.combat = 10;
        player.strength = 10;
        rival.stats.prowess = 1;
        rival.level = 1;
        const res = Rivals.duel(player, world, rival.id, { toDeath: true });
        expect(res.rivalDied).toBe(true);
        expect(rival.dead).toBeTruthy();
        expect(Rivals.fallen(player)).toContain(rival);
    });

    it('team up: the partner helps delve checks and takes a share of the gold', () => {
        const { world, player, rival } = setup();
        rival.archetype = 'treasure_hunter';
        const res = Rivals.teamUp(player, world, rival.id);
        expect(res.success).toBe(true);
        expect(Delves.partnerBonus(player)).toBeGreaterThan(0);
        // Finish a delve with gold in the haul
        const tile = world.getTile(9, 7);
        player.q = 9; player.r = 7;
        Delves.start(player, world, tile);
        player.delves.active.haul.gold = 100;
        player.delves.active.index = 1;
        const gold = player.gold;
        const summary = Delves.finish(player, world, 'retreat');
        expect(player.gold).toBe(gold - 25);
        expect(summary.extra.some(l => l.includes(rival.name))).toBe(true);
        world.day++;
        Rivals.processDay(world, player);
        expect(rival.attitude).toBeGreaterThan(0);
    });

    it('hire: they join the army for a contract, then leave', () => {
        const { world, player, rival } = setup();
        rival.archetype = 'sellsword';
        rival.attitude = 0;
        const gold = player.gold;
        const res = Rivals.hire(player, world, rival.id);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold - res.cost);
        expect(player.army.some(u => u.rivalId === rival.id)).toBe(true);
        world.day += Rivals.config().hire.days;
        Rivals.processDay(world, player);
        expect(player.army.some(u => u.rivalId === rival.id)).toBe(false);
        expect(rival.with).toBe(null);
    });

    it('race: delve the site first and take the pot', () => {
        const { world, player, rival } = setup();
        const res = Rivals.race(player, world, rival.id);
        expect(res.success).toBe(true);
        const race = res.race;
        const tile = world.getTile(race.q, race.r);
        // The player delves it first
        tile.improvement.explored = true;
        tile.improvement.delved = { day: world.day, depth: 2, of: 4, reason: 'cleared' };
        const gold = player.gold;
        world.day++;
        const notices = Rivals.processDay(world, player).notices;
        expect(notices.some(n => n.title === 'Race Won!')).toBe(true);
        expect(player.gold).toBe(gold + race.wager * 2);
        expect(Rivals.state(player).race).toBe(null);
    });

    it('sabotage: success delays them; failure is remembered as a slight', () => {
        const { world, player, rival } = setup();
        rival.restUntil = world.day;
        Utils.setRng(() => 0.01);
        const ok = Rivals.sabotage(player, world, rival.id);
        expect(ok.caught).toBe(false);
        expect(rival.restUntil).toBeGreaterThan(world.day);
        Utils.setRng(() => 0.99);
        const bad = Rivals.sabotage(player, world, rival.id);
        Utils.resetRng();
        expect(bad.caught).toBe(true);
        expect(rival.attitude).toBeLessThanOrEqual(-25);
    });
});

describe('nemeses', () => {
    it('a nemesis spreads slander through the gossip system', () => {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        const rival = Rivals.alive(player)[0];
        rival.attitude = -80;
        expect(Rivals.isNemesis(rival)).toBe(true);
        const rumor = Rivals._slander(player, world, rival);
        expect(rumor.type).toBe('slander');
        expect(player.gossip.rumors).toContain(rumor);
    });

    it('a nemesis can ambush the player', () => {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        const rival = Rivals.alive(player)[0];
        rival.attitude = -80;
        rival.task = { type: 'hunt', q: player.q, r: player.r, name: 'Tallow', arriveDay: world.day };
        const notices = [];
        Rivals._resolveTask(player, world, rival, (icon, title, text) => notices.push({ title, text }));
        expect(notices.some(n => n.title === 'Ambushed!')).toBe(true);
    });
});

describe('contests and crowns', () => {
    it('rivals nearby enter tournaments and festivals by name', () => {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        const rival = Rivals.alive(player)[0];
        rival.task = null; rival.q = 5; rival.r = 5;
        const tile = world.getTile(5, 5);
        const ent = Rivals.tournamentEntrants(player, world, tile, 2);
        expect(ent.some(e => e.id === rival.id)).toBe(true);
        const rows = Rivals.festivalContest(player, world, tile, 'strong', 'jousting');
        expect(rows.some(r => r.id === rival.id)).toBe(true);
    });

    it('an ambitious rival backs a claimant in a succession crisis', () => {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        const rival = Rivals.alive(player)[0];
        player.throne = { crises: [{ id: 'c1', kingdomId: 'k1', kingdomName: 'Arvenland', claimants: [
            { id: 'incumbent', name: 'Old King', support: 40, isIncumbent: true },
            { id: 'rival', name: 'Pretender', support: 20 },
        ], backing: { claimantId: 'incumbent' } }] };
        rival.attitude = -40;
        Rivals._doUsurp(player, world, rival, { q: 12, r: 6, name: 'Brindle' }, () => {});
        const pretender = player.throne.crises[0].claimants[1];
        expect(pretender.support).toBeGreaterThan(20);
        expect(pretender.rivalBackers).toContain(rival.name);
    });
});

describe('on a generated world', () => {
    it('runs a season of rival life without trouble', () => {
        Utils.setSeed(11);
        const world = new World(40, 30);
        world.generate({ kingdomCount: 4 });
        world.day = 1;
        const player = makePlayer();
        const town = world.getAllSettlements()[0];
        player.q = town.q; player.r = town.r;
        expect(() => runDays(world, player, 90)).not.toThrow();
        expect(Rivals.alive(player).length).toBeGreaterThan(0);
        expect(Rivals.leaderboard(player, world).length).toBeGreaterThan(1);
    });
});

describe('Hall of Heroes and saving', () => {
    it('ranks the player among the rivals by renown', () => {
        const world = makeWorld();
        const player = makePlayer();
        Rivals.processDay(world, player);
        player.renown = 9999;
        const rows = Rivals.leaderboard(player, world);
        expect(rows[0].isPlayer).toBe(true);
        expect(rows.length).toBe(Rivals.alive(player).length + 1);
        expect(rows[1].status).toBeTruthy();
    });

    it('state round-trips through save/load and old saves are backfilled', () => {
        const world = makeWorld();
        const player = makePlayer();
        runDays(world, player, 10);
        const saved = SaveLoad.serializePlayer(player);
        expect(saved.rivals.list.length).toBeGreaterThan(0);
        const restored = makePlayer();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify(saved)), restored, world);
        expect(restored.rivals.list.map(r => r.name)).toEqual(player.rivals.list.map(r => r.name));

        const old = JSON.parse(JSON.stringify(saved));
        delete old.rivals;
        const fresh = makePlayer();
        SaveLoad.restorePlayer(old, fresh, world);
        expect(fresh.rivals.initialized).toBe(false);
        expect(fresh.rivals.list).toEqual([]);
    });
});

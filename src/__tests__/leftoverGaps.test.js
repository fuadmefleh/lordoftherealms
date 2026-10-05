// Leftover gaps closed: the foraging/hunting minigames pay goods (seeded,
// qty ranges, luck/int, a craft rank from trips), saga beasts carry bounties
// and loot (and appear on notice boards), Deeds & Records gathers every
// system's counters (lifetime and this reign) and Legacy keeps holdings
// stats, rivals' faith and gold matter, the Watchtower works for an
// independent holding, scurvy heals faster ashore, and whistling for a wind
// leans on luck.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { Foraging, Hunting, FORAGE_RANKS } from '../player/foraging.js';
import { Sagas } from '../systems/sagas.js';
import { BountyHunting } from '../systems/bountyHunting.js';
import { Deeds } from '../systems/deeds.js';
import { Legacy } from '../systems/legacy.js';
import { House } from '../systems/house.js';
import { Quests } from '../systems/quests.js';
import { Rivals } from '../systems/rivals.js';
import { Traits } from '../systems/traits.js';
import { Holdings } from '../systems/holdings.js';
import { Underworld } from '../systems/underworld.js';
import { Relationships } from '../systems/relationships.js';
import { Ailments } from '../systems/ailments.js';
import { Ships } from '../systems/ships.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Economy } from '../world/economy.js';
import { World } from '../world/world.js';
import { Player } from '../player/player.js';

let logSpy;
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => { if (logSpy) logSpy.mockRestore(); });

const FOREST = [
    { item: 'berries', name: 'Wild Berries', icon: '🍇', chance: 0.5, qty: { min: 2, max: 5 }, sellPrice: 3 },
    { item: 'truffles', name: 'Truffles', icon: '🟤', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 25 },
];
const FORAGE = { terrain_mapping: { woodland: 'forest' }, loot_table: { forest: FOREST } };
const WOODS = { terrain: { id: 'woodland' } };

describe('foraging pays goods, not gold', () => {
    it('the quick path honours the qty range and counts the trip', () => {
        Utils.setSeed(3);
        for (let i = 0; i < 30; i++) {
            const p = { inventory: {}, gold: 0 };
            const res = Foraging.quickForage(p, WOODS, FORAGE);
            const e = res.entry;
            expect(res.qty).toBeGreaterThanOrEqual(e.qty.min);
            expect(res.qty).toBeLessThanOrEqual(e.qty.max);
            expect(p.inventory[e.item]).toBe(res.qty);
            expect(p.gold).toBe(0);
            expect(p.foragingTrips).toBe(1);
        }
    });

    it('a minigame haul goes into the packs, the trip counts, and full packs leave goods behind', () => {
        Utils.setSeed(5);
        const p = { inventory: {}, gold: 0, renown: 0 };
        const grid = Foraging.makeGrid(FOREST, p, 4);
        expect(grid).toHaveLength(4);
        const found = [];
        for (const row of grid) for (const c of row) if (c.entry) found.push({ entry: c.entry, qty: Foraging.rollQty(c.entry, p) });
        const trip = Foraging.finishTrip(p, found);
        expect(p.gold).toBe(0);
        expect(p.foragingTrips).toBe(1);
        for (const f of trip.kept) expect(p.inventory[f.entry.item]).toBeGreaterThan(0);
        // A full pack refuses a new kind of good
        const full = { inventory: {} };
        for (let i = 0; i < 40; i++) full.inventory[`junk_${i}`] = 1;
        const res = Foraging.finishTrip(full, [{ entry: FOREST[1], qty: 1 }]);
        expect(res.kept).toHaveLength(0);
        expect(res.lost).toHaveLength(1);
        expect(full.inventory.truffles).toBeUndefined();
    });

    it('trips build a craft rank that widens the search and fattens the bundle', () => {
        const novice = { intelligence: 5, luck: 5 };
        const master = { intelligence: 5, luck: 5, foragingTrips: FORAGE_RANKS[FORAGE_RANKS.length - 1].min };
        expect(Foraging.skill(novice).level).toBe(0);
        expect(Foraging.skill(master).level).toBe(FORAGE_RANKS.length - 1);
        expect(Foraging.findMultiplier(master)).toBeGreaterThan(Foraging.findMultiplier(novice));
        expect(Foraging.qtyBonusChance(master)).toBeGreaterThan(Foraging.qtyBonusChance(novice));
        expect(Foraging.searches(master)).toBeGreaterThan(Foraging.searches(novice));
        // A rank-up is reported once
        const p = { inventory: {}, foragingTrips: 4 };
        Utils.setSeed(1);
        const r = Foraging.quickForage(p, WOODS, FORAGE);
        expect(r.rankUp && r.rankUp.name).toBe(FORAGE_RANKS[1].name);
    });

    it('luck favours the rare finds; intelligence and luck add to the bundle', () => {
        const count = (luck) => {
            Utils.setSeed(9);
            const p = { intelligence: 5, luck };
            let rare = 0;
            for (let i = 0; i < 4000; i++) if (Foraging.rollFind(FOREST, p) === FOREST[1]) rare++;
            return rare;
        };
        expect(count(10)).toBeGreaterThan(count(1));
        expect(Foraging.qtyBonusChance({ luck: 10, intelligence: 10 })).toBeGreaterThan(Foraging.qtyBonusChance({ luck: 5, intelligence: 5 }));
    });

    it('is deterministic under a seed', () => {
        const run = () => {
            Utils.setSeed(42);
            const p = { inventory: {} };
            for (let i = 0; i < 10; i++) Foraging.quickForage(p, WOODS, FORAGE);
            return p.inventory;
        };
        expect(run()).toEqual(run());
    });

    it('every forage and hunt find is a sellable good', () => {
        const ej = DataLoader.earlyJobs;
        for (const kind of ['foraging', 'hunting']) {
            for (const table of Object.values(ej[kind].loot_table)) {
                for (const e of table) expect(PlayerInventory.goodValue(e.item), e.item).toBeGreaterThan(0);
            }
        }
        // The exotic price of pearls (data/discovery.json) wins over the wild one
        expect(PlayerInventory.goodValue('pearls')).toBeGreaterThan(60);
    });
});

describe('hunting pays goods, not gold', () => {
    const TABLE = [
        { item: 'game_meat', name: 'Venison', chance: 0.35, qty: { min: 1, max: 3 }, sellPrice: 8 },
        { item: 'bear_pelt', name: 'Bear Pelt', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 40 },
    ];

    it('the quick hunt takes a quarry in its qty range and counts the trip', () => {
        Utils.setSeed(4);
        const p = { inventory: {}, gold: 0, skills: { combat: 2 } };
        const res = Hunting.quickHunt(p, TABLE);
        expect(res.qty).toBeGreaterThanOrEqual(res.entry.qty.min);
        expect(res.qty).toBeLessThanOrEqual(res.entry.qty.max);
        expect(p.inventory[res.entry.item]).toBe(res.qty);
        expect(p.huntingTrips).toBe(1);
        expect(p.gold).toBe(0);
    });

    it('a clean kill always yields something; experience steadies the aim', () => {
        Utils.setSeed(8);
        const p = { inventory: {}, skills: { combat: 1 }, strength: 5 };
        const loot = Hunting.strikeLoot(TABLE, p);
        expect(loot.length).toBeGreaterThan(0);
        for (const f of loot) expect(f.qty).toBeGreaterThanOrEqual(1);
        const vet = { ...p, huntingTrips: 60 };
        expect(Hunting.hitThreshold(vet)).toBeLessThan(Hunting.hitThreshold(p));
        expect(Hunting.lootMultiplier(vet)).toBeGreaterThan(Hunting.lootMultiplier(p));
    });
});

// ── Saga beasts: bounties, loot, notice boards ──

function genWorld(seed = 4242) {
    Utils.setSeed(seed);
    const w = new World(80, 60);
    w.generate({ kingdomCount: 10, seed });
    w.day = 1;
    return w;
}
function makeSagaPlayer(w) {
    const p = new Player({ firstName: 'Saga', lastName: 'Hunter', gender: 'female', age: 25 });
    p.placeInWorld(w);
    Quests.initialize(p);
    House.initialize(p, w);
    p.gold = 1000;
    p.renown = 50;
    p.inventory = { food: 50 };
    p.army = [];
    return p;
}
function wyrmOf(w, saga) {
    return w.units.find(u => u.sagaKey && u.sagaKey.startsWith(`${saga.uid}:boss`));
}

describe('saga beasts carry bounties', () => {
    it('every bounty names real goods and every boss has one', () => {
        const goods = DataLoader._gamedata.playerEconomy.GOODS;
        let bosses = 0;
        for (const t of Object.values(Sagas.templates())) {
            for (const ch of Object.values(t.chapters)) {
                for (const e of [...(ch.effects || []), ...(ch.daily || [])]) {
                    if (e.do !== 'unit') continue;
                    if (e.role === 'boss') { bosses++; expect(e.bounty && e.bounty.post, e.name).toBe(true); }
                    for (const item of [...Object.keys((e.bounty && e.bounty.loot) || {}), ...Object.keys((e.bounty && e.bounty.rare) || {})]) {
                        expect(goods[item.toUpperCase()], item).toBeTruthy();
                    }
                }
            }
        }
        expect(bosses).toBeGreaterThanOrEqual(3);
    });

    it('the wyrm is cried on nearby boards; slaying it pays the realm\'s bounty, its scales and the notice', () => {
        const w = genWorld();
        const p = makeSagaPlayer(w);
        BountyHunting.initialize(p);
        Utils.setSeed(12);
        const saga = Sagas.start(p, w, 'wyrm_wakes');
        Sagas.processDay(w, p);
        Sagas._enter(p, w, saga, 'raids', () => {});
        const wyrm = wyrmOf(w, saga);
        expect(wyrm).toBeTruthy();

        // A board near the beast posts it (no RNG drawn)
        const board = { q: wyrm.q, r: wyrm.r, settlement: { name: 'Ashby' } };
        const offers = Sagas.bountyOffers(p, w, board);
        expect(offers).toHaveLength(1);
        const offer = offers[0];
        expect(offer.type).toBe('saga_beast');
        expect(offer.actualPay).toBe(Sagas.bountyPrice(saga, saga.units.find(u => u.role === 'boss')));
        const onBoard = BountyHunting.generateBoardOffers(p, w, board, []);
        expect(onBoard.some(o => o.id === offer.id)).toBe(true);
        // Far away, no notice
        const far = { q: (wyrm.q + 40) % w.width, r: (wyrm.r + 30) % w.height, settlement: { name: 'Far' } };
        expect(Sagas.bountyOffers(p, w, far).length).toBe(0);

        // Take the notice
        p.activeBounties.push({ ...offer });
        expect(BountyHunting.sagaOffers(p, w, board)).toHaveLength(0);

        const kingdom = w.getKingdom(saga.anchor.kingdomId);
        kingdom.treasury = 100000;
        const gold0 = p.gold;
        wyrm.destroyed = true;
        wyrm.slainByPlayer = true;
        w.day++;
        const out = Sagas.processDay(w, p);
        expect(out.notices.some(n => n.title === 'Bounty Claimed')).toBe(true);
        expect(kingdom.treasury).toBe(100000 - offer.actualPay);
        expect(p.gold - gold0).toBeGreaterThanOrEqual(offer.actualPay);
        expect(p.inventory.dragon_scale).toBeGreaterThanOrEqual(4); // carcass scales + the ending's three
        expect(p.inventory.gems).toBeGreaterThan(0);
        expect(Sagas.state(p).stats.beastsSlain).toBe(1);

        // Paid once only
        const gold1 = p.gold;
        const rec = saga.units.find(u => u.role === 'boss');
        expect(Sagas._payBounty(p, w, saga, rec)).toBeNull();
        expect(p.gold).toBe(gold1);

        // The hunter's notice: a fee on top, a beast on the record, the notice gone
        const upd = BountyHunting.processDaily(p, w);
        expect(upd.beasts).toHaveLength(1);
        expect(upd.beasts[0].outcome).toBe('slain');
        expect(p.gold - gold1).toBe(upd.beasts[0].bonus);
        expect(p.bountyHunter.beastsSlain).toBe(1);
        expect(p.activeBounties.some(b => b.id === offer.id)).toBe(false);
    });

    it('a broke realm pays half; a beast that leaves the story lapses the notice', () => {
        const w = genWorld();
        const p = makeSagaPlayer(w);
        BountyHunting.initialize(p);
        Utils.setSeed(21);
        const saga = Sagas.start(p, w, 'wyrm_wakes');
        Sagas.processDay(w, p);
        Sagas._enter(p, w, saga, 'raids', () => {});
        const rec = saga.units.find(u => u.role === 'boss');
        const kingdom = w.getKingdom(saga.anchor.kingdomId);
        kingdom.treasury = 0;
        const res = Sagas._payBounty(p, w, saga, rec);
        expect(res.gold).toBe(Math.floor(res.posted / 2));

        // A second saga's beast that wanders off
        const p2 = makeSagaPlayer(w);
        BountyHunting.initialize(p2);
        p2.activeBounties.push({ id: 'saga_x', type: 'saga_beast', sagaKey: 'nope', status: 'active', targetName: 'Ghost', actualPay: 100 });
        const upd = BountyHunting.processDaily(p2, w);
        expect(upd.beasts[0].outcome).toBe('gone');
        expect(p2.activeBounties).toHaveLength(0);
    });
});

// ── Deeds & Records, Legacy ──

describe('Deeds & Records', () => {
    function housePlayer() {
        const p = { name: 'Ada', gold: 0, inventory: {}, children: [] };
        House.initialize(p, { day: 0 });
        return p;
    }

    it('collects counters from every system without creating their state', () => {
        const p = housePlayer();
        p.delves = { stats: { delves: 3, cleared: 1, deepest: 4 } };
        p.petitions = { stats: { ruled: 5, ignored: 2 } };
        p.voyageStats = { voyages: 2, daysAtSea: 11 };
        p.foragingTrips = 7;
        const d = Deeds.collect(p);
        expect(d['delves.delves']).toBe(3);
        expect(d['petitions.ignored']).toBe(2);
        expect(d['voyages.daysAtSea']).toBe(11);
        expect(d['land.foragingTrips']).toBe(7);
        expect(d['sieges.invested']).toBe(0);
        expect(p.sieges).toBeUndefined(); // read-only
        const secs = Deeds.sections(p);
        expect(secs.find(s => s.id === 'sieges').empty).toBe(true);
        expect(secs.find(s => s.id === 'delves').empty).toBe(false);
        expect(secs.find(s => s.id === 'bounties').empty).toBe(true);
    });

    it('the reign column counts from the snapshot taken when the ruler took the mantle', () => {
        const p = housePlayer();
        p.delves = { stats: { delves: 3, deepest: 4 } };
        p.holdings = { keys: [], log: [], stats: { projects: 2, raidsRepelled: 1 } };
        Legacy.openReign(p, { day: 100 });
        expect(p.house.currentReign.snapshot.deeds['delves.delves']).toBe(3);
        expect(p.house.currentReign.snapshot.holdingProjects).toBe(2);
        p.delves.stats.delves = 5;
        p.holdings.stats.projects = 6;
        p.holdings.stats.rebellionsCrushed = 1;
        const rows = Object.fromEntries(Deeds.sections(p).flatMap(s => s.rows).map(r => [r.key, r]));
        expect(rows['delves.delves'].lifetime).toBe(5);
        expect(rows['delves.delves'].reign).toBe(2);
        expect(rows['delves.deepest'].reign).toBe(0); // the record was set in an earlier reign
        expect(rows['holdings.held'].reign).toBeNull(); // present tense

        const rec = Legacy.summarize(p, { day: 200 });
        expect(rec.holdingProjects).toBe(4);
        expect(rec.rebellionsCrushed).toBe(1);
        expect(rec.raidsRepelled).toBe(0);
        const w = Legacy.config().weights;
        expect(w.holdingProject).toBeGreaterThan(0);
        const without = Legacy.reignScore({ ...rec, holdingProjects: 0, rebellionsCrushed: 0 });
        expect(rec.score - without).toBe(4 * w.holdingProject + w.rebellionCrushed);
    });

    it('a reign opened before records were kept counts from zero', () => {
        const p = housePlayer();
        p.house.currentReign = { name: 'Old', generation: 1, startDay: 0, snapshot: { prestige: 0, stats: {} } };
        p.petitions = { stats: { ruled: 4 } };
        expect(Deeds.reignBaseline(p)).toBeNull();
        const row = Deeds.sections(p).flatMap(s => s.rows).find(r => r.key === 'petitions.ruled');
        expect(row.reign).toBe(4);
    });
});

// ── Rivals: faith and spending ──

function rivalWorld(day = 5) {
    const W = 30, H = 20;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: { id: 'grassland', passable: true } });
        tiles.push(row);
    }
    const towns = [
        { q: 5, r: 5, name: 'Tallow', type: 'town', kingdom: 'k1', population: 800 },
        { q: 12, r: 6, name: 'Brindle', type: 'capital', kingdom: 'k1', population: 2000 },
    ];
    for (const t of towns) tiles[t.r][t.q].settlement = { ...t };
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

describe('rivals: faith and gold', () => {
    function setup() {
        Utils.setSeed(77);
        const w = rivalWorld();
        const p = new Player();
        p.name = 'Aldric'; p.q = 5; p.r = 5; p.inventory = {}; p.army = [];
        Rivals.ensureCast(p, w);
        const rival = Rivals.state(p).list[0];
        return { w, p, rival };
    }

    it('faith steels each side; a devout rival holds back against a Pious player', () => {
        const { p, rival } = setup();
        rival.stats.faith = 9;
        rival.attitude = 0;
        p.faith = 5;
        const plain = Rivals.faithEdge(p, rival);
        expect(plain.rival).toBeCloseTo(4 * Rivals.config().faith.duelPerPoint, 5);
        expect(plain.player).toBe(0);
        p.traits = { earned: { pious: { day: 1 } } };
        expect(Traits.has(p, 'pious')).toBe(true);
        const pious = Rivals.faithEdge(p, rival);
        expect(pious.rival).toBeCloseTo(plain.rival - Rivals.config().faith.piousRestraint, 5);
        p.faith = 9;
        expect(Rivals.faithEdge(p, rival).player).toBeGreaterThan(0);
    });

    it('rivals spend gold: finer arms raise prowess; hired swords add power and go home', () => {
        const { w, p, rival } = setup();
        const cfg = Rivals.config().spend;
        rival.stats.prowess = 5;
        rival.gold = cfg.keep + cfg.gearBase + 5 * cfg.gearPerProwess;
        const power0 = Rivals.rivalPower(rival);
        expect(Rivals._spend(p, w, rival)).toBe('gear');
        expect(rival.stats.prowess).toBe(6);
        expect(rival.gold).toBe(cfg.keep);
        expect(Rivals.rivalPower(rival)).toBeGreaterThan(power0);

        rival.stats.prowess = cfg.maxProwess;
        rival.gold = cfg.keep + cfg.retainerCost;
        const power1 = Rivals.rivalPower(rival);
        expect(Rivals._spend(p, w, rival)).toBe('retainer');
        expect(rival.retainers).toBe(1);
        expect(Rivals.rivalPower(rival)).toBeCloseTo(power1 + cfg.retainerPower, 5);
        w.day += cfg.retainerDays + 1;
        rival.gold = 0;
        expect(Rivals._spend(p, w, rival)).toBeNull();
        expect(rival.retainers).toBe(0);
    });
});

// ── Watchtower, scurvy, whistle ──

describe('cheap fixes', () => {
    it('a Watchtower in an independent holding cools the nearest realm\'s heat', () => {
        const tiles = new Map();
        for (let q = 0; q < 16; q++) for (let r = 0; r < 16; r++) tiles.set(`${q},${r}`, { q, r, terrain: { id: 'plains', passable: true } });
        const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, territory: [], population: 5000 };
        const world = {
            day: 10, width: 16, kingdoms: [kingdom], units: [], events: [],
            getTile: (q, r) => tiles.get(`${q},${r}`) || null,
            getKingdom: (id) => (id === 'k1' ? kingdom : null),
            getAllSettlements: () => [...tiles.values()].filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
        };
        // A realm's town nearby, our independent holding at (5,5)
        const realmTown = { name: 'Varrholt', type: 'town', population: 900, kingdom: 'k1' };
        Economy.initSettlement(realmTown);
        tiles.get('9,9').settlement = realmTown;
        const ours = { name: 'Freehold', type: 'village', population: 300, level: 1, kingdom: null, colony: { isPlayerColony: true, loyalty: 60, garrisonStrength: 0 } };
        Economy.initSettlement(ours);
        tiles.get('5,5').settlement = ours;
        const player = {
            id: 'p1', name: 'Ash', gold: 10000, renown: 20, karma: 0, reputation: {}, properties: [], colonies: [{ q: 5, r: 5, name: 'Freehold', foundedDay: 0 }],
            children: [], inventory: {}, army: [], q: 5, r: 5, taxRate: 'moderate',
            skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2 },
        };
        Relationships.initialize(player);
        House.initialize(player, world);
        Holdings.ensure(ours);
        ours.holding.built.watchtower = { day: 1 };
        Holdings.refresh(ours);
        expect(ours.holding.fx.heatRelief).toBeGreaterThan(0);
        Underworld.ensure(player);
        Underworld.addHeat(player, 'k1', 20, world);
        Holdings.processDay(player, world);
        expect(Underworld.getHeat(player, 'k1')).toBeLessThan(20);
    });

    it('scurvy runs its course far faster ashore with fresh food than at sea', () => {
        const stageDaysPassed = (ashore) => {
            Utils.setSeed(31);
            const tile = { q: 3, r: 3, terrain: { id: 'plains', passable: true } };
            const w = { day: 10, season: 'Summer', width: 40, height: 40, units: [], events: [], activeEvents: [], getTile: (q, r) => (q === 3 && r === 3 ? tile : null), getKingdom: () => null };
            const p = new Player();
            p.q = 3; p.r = 3; p.health = 100; p._lastRestType = 'outdoors'; p.movementRemaining = 10;
            p.inventory = ashore ? { fruit: 20 } : {};
            if (!ashore) p.boardedShip = 'ship1';
            Ailments.inflict(p, w, 'scurvy');
            const rec = Ailments.list(p).find(r => r.id === 'scurvy');
            w.day++;
            Ailments.processDay(w, p);
            return Ailments.list(p).includes(rec) ? rec.dayInStage : Infinity;
        };
        expect(stageDaysPassed(false)).toBe(1);
        expect(stageDaysPassed(true)).toBeGreaterThanOrEqual(Ailments.def('scurvy').ashoreRecovery);
    });

    it('whistling for a wind leans on luck', () => {
        const becalmed = (DataLoader._gamedata.ships.voyageEvents || []).flatMap(e => e.choices || []).find(c => c.id === 'whistle');
        expect(becalmed.chance.stat).toBe('luck');
        const passes = (luck) => {
            Utils.setSeed(5);
            const p = { luck, q: 0, r: 0 };
            const ship = { q: 0, r: 0, voyage: {} };
            let n = 0;
            for (let i = 0; i < 2000; i++) {
                const lines = [];
                Ships._applyVoyageOutcome(p, null, ship, { chance: { p: 0.5, stat: 'luck', per: 0.06, pass: { text: 'P' }, fail: { text: 'F' } } }, lines, 0);
                if (lines.includes('P')) n++;
            }
            return n;
        };
        expect(passes(10)).toBeGreaterThan(passes(1) + 400);
    });
});

describe('save and load', () => {
    it('the voyage record round-trips; old saves backfill the new fields', () => {
        const p = new Player();
        p.voyageStats = { voyages: 3, daysAtSea: 17, events: 2, longest: 9 };
        p.foragingTrips = 12;
        const back = new Player();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p))), back);
        expect(back.voyageStats).toEqual({ voyages: 3, daysAtSea: 17, events: 2, longest: 9 });
        expect(back.foragingTrips).toBe(12);

        // A hunter's record, a rival and saga stats from before this change
        const old = { bountyHunter: { rank: 2, capturesTurnedIn: 3, capturesRecruited: 0, failedCaptures: 0, nextTargetId: 4, boardRefreshDay: 0, boardSettlementKey: '', boardOffers: [] } };
        BountyHunting.initialize(old);
        expect(old.bountyHunter.beastsSlain).toBe(0);
        const rival = Rivals._backfillRival({ stats: { prowess: 6, cunning: 5, faith: 8, charm: 4 }, gold: 300 });
        expect(rival.retainers).toBe(0);
        expect(rival.gear).toBe(0);
        const st = Sagas.state({ sagas: { active: [], done: [], stats: { started: 2, ended: 1, joined: 1, won: 1 } } });
        expect(st.stats.beastsSlain).toBe(0);
        expect(st.stats.bountyGold).toBe(0);
    });
});

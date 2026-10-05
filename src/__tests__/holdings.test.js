// Holdings development (systems/holdings.js): projects in the settlements the
// player rules, the systems that read their effects, governors, garrisons,
// unrest and rebellion, bandit raids, and save/load.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Holdings } from '../systems/holdings.js';
import { Taxation } from '../systems/marketDynamics.js';
import { Economy } from '../world/economy.js';
import { Colonization } from '../world/colonization.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Petitions } from '../systems/petitions.js';
import { Ships } from '../systems/ships.js';
import { RealmWars } from '../systems/realmWars.js';
import { Underworld } from '../systems/underworld.js';
import { Relationships } from '../systems/relationships.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { House } from '../systems/house.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

afterEach(() => Utils.resetRng());

/** A small hand-built world: plains, a lake at (0,0), our town at (5,5), a kingdom k1. */
function makeWorld(day = 10) {
    const tiles = new Map();
    const plains = { id: 'plains', passable: true };
    for (let q = 0; q < 16; q++) {
        for (let r = 0; r < 16; r++) tiles.set(`${q},${r}`, { q, r, terrain: plains });
    }
    tiles.get('0,0').terrain = { id: 'lake', passable: false };
    const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, territory: [{ q: 5, r: 5 }], population: 5000 };
    const world = {
        day,
        width: 16,
        kingdoms: [kingdom],
        units: [],
        events: [],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => (id === 'k1' ? kingdom : null),
        getAllSettlements: () => [...tiles.values()].filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
    };
    return world;
}

function addTown(world, q, r, extra = {}) {
    const settlement = {
        name: `Town${q}${r}`, type: 'village', population: 300, level: 1, kingdom: null,
        colony: { isPlayerColony: true, loyalty: 60, garrisonStrength: 0 },
        ...extra,
    };
    Economy.initSettlement(settlement);
    world.getTile(q, r).settlement = settlement;
    return settlement;
}

function makePlayer(world, extra = {}) {
    const player = {
        id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male',
        gold: 10000, renown: 20, karma: 0, reputation: {}, properties: [], colonies: [], children: [],
        inventory: {}, army: [], q: 5, r: 5, taxRate: 'moderate',
        skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        ...extra,
    };
    Relationships.initialize(player);
    House.initialize(player, world);
    return player;
}

function own(player, world, q, r, extra = {}) {
    const s = addTown(world, q, r, extra);
    player.colonies.push({ q, r, name: s.name, foundedDay: 0 });
    return s;
}

function finish(player, world, days = 30) {
    for (let i = 0; i < days; i++) {
        world.day++;
        Holdings.processDay(player, world);
    }
}

function soldier(n = 1) {
    return Array.from({ length: n }, () => ({ type: 'soldier', name: 'Soldier', icon: '⚔️', strength: 10, upkeep: 5, experience: 0, level: 1 }));
}

describe('Holdings data (data/holdings.json)', () => {
    it('is registered with the DataLoader and every effect key has a home', () => {
        expect(DataLoader.holdings).toBeTruthy();
        const projects = Holdings.projects();
        for (const id of ['palisade', 'stone_walls', 'market_square', 'granary', 'shrine', 'temple', 'barracks',
            'harbour', 'watchtower', 'workshop_quarter', 'tavern_inn', 'moot_hall']) {
            expect(projects[id], id).toBeTruthy();
        }
        for (const [id, def] of Object.entries(projects)) {
            expect(def.gold, id).toBeGreaterThan(0);
            expect(def.days, id).toBeGreaterThan(0);
            for (const k of Object.keys(def.effects || {})) expect(Holdings.FX_KEYS, `${id}.${k}`).toContain(k);
            if (def.upgradeOf) expect(projects[def.upgradeOf], id).toBeTruthy();
        }
        expect(Holdings.config().rebellion.days).toBe(DataLoader.holdings.config.rebellion.days);
    });

    it('slots grow with population tier', () => {
        expect(Holdings.slots({ population: 20 })).toBe(2);
        expect(Holdings.slots({ population: 300 })).toBe(3);
        expect(Holdings.slots({ population: 1000 })).toBe(4);
        expect(Holdings.slots({ population: 3000 })).toBe(5);
    });
});

describe('Projects', () => {
    let world, player, s;
    beforeEach(() => {
        world = makeWorld();
        player = makePlayer(world);
        s = own(player, world, 5, 5);
    });

    it('cost gold and materials (buying what the packs lack) and finish after their days', () => {
        player.inventory.wood = 5;
        const q = Holdings.quote(player, 'palisade');
        expect(q.materials[0]).toMatchObject({ id: 'wood', need: 20, have: 5, missing: 15 });
        const gold = player.gold;
        const res = Holdings.startProject(player, world, 5, 5, 'palisade');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold - q.total);
        expect(player.inventory.wood).toBeUndefined();
        expect(s.holding.queue).toHaveLength(1);
        finish(player, world, res.days);
        expect(s.holding.built.palisade).toBeTruthy();
        expect(s.holding.queue).toHaveLength(0);
        expect(s.holding.fx.defense).toBeCloseTo(0.25, 5);
        expect(player.holdings.stats.projects).toBe(1);
    });

    it('respects slots, tiers, upgrades and the coast', () => {
        s.population = 50; // hamlet: 2 slots, tier 0
        expect(Holdings.startProject(player, world, 5, 5, 'palisade').success).toBe(true);
        expect(Holdings.startProject(player, world, 5, 5, 'granary').success).toBe(true);
        const third = Holdings.canStart(player, world, 5, 5, 'shrine');
        expect(third.ok).toBe(false);
        expect(third.reason).toMatch(/slot/);
        expect(Holdings.canStart(player, world, 5, 5, 'stone_walls').reason).toMatch(/population/);
        s.population = 300;
        expect(Holdings.canStart(player, world, 5, 5, 'stone_walls').reason).toMatch(/Palisade first/);
        finish(player, world, 10);
        // An upgrade reuses its slot and replaces the base when done
        expect(Holdings.startProject(player, world, 5, 5, 'stone_walls').success).toBe(true);
        finish(player, world, 20);
        expect(s.holding.built.stone_walls).toBeTruthy();
        expect(s.holding.built.palisade).toBeUndefined();
        expect(Holdings.usedSlots(s.holding)).toBe(2);
        // Inland: no harbour
        expect(Holdings.canStart(player, world, 5, 5, 'harbour').reason).toMatch(/water/);
    });

    it('can be abandoned for half the gold', () => {
        Holdings.startProject(player, world, 5, 5, 'market_square');
        const paid = s.holding.queue[0].paid;
        const gold = player.gold;
        const res = Holdings.cancelProject(player, world, 5, 5, 'market_square');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold + Math.floor(paid / 2));
    });

    it('projects their effect before you build', () => {
        const fx = Holdings.projectEffect(player, world, 5, 5, 'market_square');
        expect(fx.lines.join(' ')).toMatch(/tax/);
        expect(fx.taxDelta).toBeGreaterThanOrEqual(0);
        const walls = Holdings.projectEffect(player, world, 5, 5, 'palisade');
        expect(walls.defenseAfter).toBeGreaterThan(walls.defenseBefore);
    });
});

describe('Existing systems read the projects', () => {
    let world, player, s;
    const build = (id) => {
        s.holding = s.holding || null;
        Holdings.ensure(s).built[id] = 1;
        Holdings.refresh(s);
    };
    beforeEach(() => {
        world = makeWorld();
        player = makePlayer(world);
        s = own(player, world, 5, 5, { population: 1000, happiness: 50 });
    });

    it('Market Square raises taxes; a revolt stops them', () => {
        const before = Taxation.collectTaxes(player, world, { dryRun: true }).collected;
        build('market_square');
        const after = Taxation.collectTaxes(player, world, { dryRun: true }).collected;
        expect(after).toBeGreaterThan(before);
        s.holding.rebellion = { startDay: 0, deadline: 99, strength: 50 };
        Holdings.refresh(s);
        expect(Taxation.collectTaxes(player, world, { dryRun: true }).collected).toBe(0);
    });

    it('happiness target and growth rise with taverns and temples', () => {
        build('tavern_inn');
        Taxation.collectTaxes(player, world);
        expect(s.happiness).toBeGreaterThan(50);
        expect(s.growthRate).toBeCloseTo(0.015, 5);
    });

    it('Granary adds days of food to the lean-season stores', () => {
        const before = Economy.foodReserveDays(s);
        build('granary');
        expect(Economy.foodReserveDays(s)).toBeCloseTo(before + 6, 5);
    });

    it('Market Square improves sale prices; Barracks trains more and cheaper recruits', () => {
        const sale = Economy.saleBonus(s);
        const cap = PlayerMilitary.getRecruitmentCapacity(s);
        const cost = Economy.recruitCostMultiplier(null, s);
        build('market_square');
        build('barracks');
        expect(Economy.saleBonus(s)).toBeCloseTo(sale + 0.04, 5);
        expect(PlayerMilitary.getRecruitmentCapacity(s)).toBeGreaterThan(cap);
        expect(Economy.recruitCostMultiplier(null, s)).toBeCloseTo(cost * 0.9, 5);
    });

    it('Workshop Quarter turns out more goods', () => {
        const tile = world.getTile(5, 5);
        const a = { ...s, economy: null, holding: undefined };
        Economy.initSettlement(a);
        Utils.setSeed(3);
        Economy.produceDaily(a, tile, world);
        build('workshop_quarter');
        const b = { ...s, economy: null };
        Economy.initSettlement(b);
        Utils.setSeed(3);
        Economy.produceDaily(b, tile, world);
        expect(b.economy.goods).toBeGreaterThanOrEqual(a.economy.goods);
        expect(b.economy.goods).toBe(Math.round(a.economy.goods * 1.2));
    });

    it('walls, militia and garrison hold against war hosts and sieges', () => {
        const base = Holdings.defenseRating(s);
        expect(base).toBeCloseTo(10 + 1000 * 0.01, 5); // the old war-host formula
        build('palisade');
        build('barracks');
        s.holding.garrison.push(...soldier(3));
        expect(Holdings.defenseRating(s)).toBeCloseTo((20 + 30 + 10) * 1.25, 5);
        // RealmWars storms with the same rating
        const kingdom = world.getKingdom('k1');
        const war = { hosts: [], score: 0, holdingsLost: 0, hostsDefeated: 0 };
        const rec = { id: 'h1', name: 'Host', strength: 1, target: { kind: 'colony', q: 5, r: 5, name: s.name } };
        const text = RealmWars._strike(player, world, kingdom, war, rec, { destroyed: false });
        expect(text).toMatch(/garrison holds/);
        expect(player.colonies).toHaveLength(1);
        // Player sieges of a walled settlement are harder
        const other = { name: 'X', type: 'village', population: 1000, kingdom: null };
        const plain = PlayerMilitary.getSettlementDefense(other, world);
        other.holding = { fx: { defense: 0.6 } };
        expect(PlayerMilitary.getSettlementDefense(other, world)).toBe(Math.floor(plain * 1.6));
    });

    it('Moot Hall gives petitioners more days', () => {
        const def = Object.values(Petitions.defs())[0];
        const ctx = { q: 5, r: 5 };
        const a = Petitions._create(player, world, def, 'x1', ctx);
        build('moot_hall');
        const b = Petitions._create(player, world, def, 'x2', ctx);
        expect(b.expiresDay - a.expiresDay).toBe(4);
    });

    it('Shrine spreads your faith; Watchtower cools underworld heat', () => {
        player.religion = { name: 'The Ash Path', presence: {}, followers: 0 };
        s.kingdom = 'k1';
        player.allegiance = 'k1';
        Underworld.ensure(player);
        Underworld.addHeat(player, 'k1', 20, world);
        build('shrine');
        build('watchtower');
        Holdings.processDay(player, world);
        expect(player.religion.presence['5,5']).toBeGreaterThan(0);
        expect(Underworld.getHeat(player, 'k1')).toBeCloseTo(19.5, 5);
    });

    it('Harbour: better port prices and free repairs for docked ships', () => {
        const port = own(player, world, 1, 0, { population: 400 });
        expect(Holdings.isCoastal(world, 1, 0)).toBe(true);
        const plain = Ships.getPortMarket(world, 1, 0);
        Holdings.ensure(port).built.harbour = 1;
        Holdings.refresh(port);
        const better = Ships.getPortMarket(world, 1, 0);
        const sellBefore = plain.reduce((t, e) => t + e.sell, 0);
        const sellAfter = better.reduce((t, e) => t + e.sell, 0);
        expect(sellAfter).toBeGreaterThan(sellBefore);
        for (const e of better) if (e.buy !== null) expect(e.sell).toBeLessThan(e.buy);
        expect(Ships._harbourAt(world, 1, 0)).toBe(true);
    });

    it('Tavern and Inn draws settlers to a young colony', () => {
        const young = own(player, world, 9, 9, { population: 3 });
        young.colony.recruitment = { recruited: 0, enRoute: 0, incentive: 'none', reputation: 0, signboard: false };
        Holdings.ensure(young).built.tavern_inn = 1;
        Holdings.refresh(young);
        Utils.setRng(() => 0.01);
        Colonization._processSettlerArrivals(world.getTile(9, 9), world);
        expect(young.colony.recruitment.enRoute).toBeGreaterThan(0);
    });
});

describe('Governors', () => {
    let world, player, s;
    beforeEach(() => {
        world = makeWorld();
        player = makePlayer(world);
        s = own(player, world, 5, 5, { population: 1000, happiness: 50 });
    });

    it('stewards for hire are the same all month, and cost a fee', () => {
        const a = Holdings.stewardOffers(world, 5, 5);
        world.day += 3;
        expect(Holdings.stewardOffers(world, 5, 5)).toEqual(a);
        const gold = player.gold;
        const res = Holdings.appointGovernor(player, world, 5, 5, a[0].id);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold - a[0].fee);
        expect(s.holding.fx.taxMult).toBeGreaterThan(1 - 0.5);
    });

    it('a steward boosts taxes, and skims when disloyal', () => {
        const offer = Holdings.stewardOffers(world, 5, 5)[0];
        Holdings.appointGovernor(player, world, 5, 5, offer.id);
        s.holding.governor.loyalty = 90;
        Holdings.refresh(s);
        const loyal = s.holding.fx.taxMult;
        expect(loyal).toBeCloseTo(1 + offer.stewardship * 0.03, 5);
        s.holding.governor.loyalty = 20;
        Holdings.refresh(s);
        expect(s.holding.fx.skim).toBeGreaterThan(0);
        expect(s.holding.fx.taxMult).toBeLessThan(loyal);
    });

    it('a companion leaves the party to govern and rejoins when relieved', () => {
        const npc = Relationships.generateNPC({ name: s.name, type: 'town', kingdom: null }, world);
        player.travelParty = [npc.id];
        const cand = Holdings.governorCandidates(player, world, 5, 5).find(c => c.id === npc.id);
        expect(cand.kind).toBe('companion');
        expect(Holdings.appointGovernor(player, world, 5, 5, npc.id).success).toBe(true);
        expect(player.travelParty).not.toContain(npc.id);
        expect(Holdings.governorCandidates(player, world, 5, 5).some(c => c.id === npc.id)).toBe(false);
        expect(Holdings.dismissGovernor(player, world, 5, 5).success).toBe(true);
        expect(player.travelParty).toContain(npc.id);
    });

    it('grown children can govern', () => {
        player.children = [{ id: 'child_1', firstName: 'Bryn', gender: 'female', age: 18, isAlive: true, strength: 6, intelligence: 9,
            skills: { commerce: 4, combat: 1, stealth: 0, diplomacy: 2 } }];
        const cand = Holdings.governorCandidates(player, world, 5, 5).find(c => c.id === 'child_1');
        expect(cand).toMatchObject({ kind: 'family', stewardship: 7 });
        expect(cand.loyalty).toBe(80);
    });

    it('an ungoverned holding drifts while you are far away', () => {
        player.q = 15; player.r = 15;
        Holdings.processDay(player, world);
        expect(s.holding.drifting).toBe(true);
        expect(s.happiness).toBeLessThan(50);
        expect(s.colony.loyalty).toBeLessThan(60);
        const offer = Holdings.stewardOffers(world, 5, 5)[0];
        Holdings.appointGovernor(player, world, 5, 5, offer.id);
        Holdings.processDay(player, world);
        expect(s.holding.drifting).toBe(false);
    });

    it('a disloyal governor may betray you', () => {
        const offer = Holdings.stewardOffers(world, 5, 5)[0];
        Holdings.appointGovernor(player, world, 5, 5, offer.id);
        s.holding.governor.loyalty = 5;
        s.holding.governor.loyaltyMod = -100;
        Utils.setRng(() => 0);
        const gold = player.gold;
        const day = Holdings.processDay(player, world);
        expect(s.holding.governor).toBeNull();
        expect(player.gold).toBeLessThan(gold);
        expect(day.notices.join(' ')).toMatch(/betrays/);
    });
});

describe('Garrison', () => {
    let world, player, s;
    beforeEach(() => {
        world = makeWorld();
        player = makePlayer(world);
        s = own(player, world, 5, 5);
        player.army = soldier(4);
    });

    it('stations and withdraws troops only when you are there', () => {
        player.q = 12;
        expect(Holdings.stationTroops(player, world, 5, 5, 'soldier', 2).success).toBe(false);
        player.q = 5;
        expect(Holdings.stationTroops(player, world, 5, 5, 'soldier', 3).success).toBe(true);
        expect(player.army).toHaveLength(1);
        expect(Holdings.garrisonStrength(s.holding)).toBe(30);
        expect(Holdings.withdrawTroops(player, world, 5, 5, 'soldier', 1).success).toBe(true);
        expect(player.army).toHaveLength(2);
    });

    it('costs upkeep every day, cheaper with a Barracks, and deserts when unpaid', () => {
        Holdings.stationTroops(player, world, 5, 5, 'soldier', 4);
        const gold = player.gold;
        const day = Holdings.processDay(player, world);
        expect(day.upkeep).toBe(20);
        expect(player.gold).toBe(gold - 20);
        s.holding.built.barracks = 1;
        Holdings.refresh(s);
        expect(Holdings.garrisonUpkeep(s.holding)).toBe(15);
        player.gold = 0;
        Holdings.processDay(player, world);
        expect(s.holding.garrison.length).toBeLessThan(4);
    });
});

describe('Unrest and rebellion', () => {
    let world, player, s;
    beforeEach(() => {
        world = makeWorld();
        player = makePlayer(world);
        s = own(player, world, 5, 5, { population: 500, happiness: 10 });
    });

    it('grows with misery and neglect, and turns to rebellion without a garrison', () => {
        player.q = 15; player.r = 15;
        Holdings.processDay(player, world);
        expect(s.holding.unrest).toBeGreaterThan(0);
        s.holding.unrest = 100;
        const day = Holdings.processDay(player, world);
        expect(s.holding.rebellion).toBeTruthy();
        expect(day.rebellions).toHaveLength(1);
        expect(Holdings.canStart(player, world, 5, 5, 'granary').ok).toBe(false);
    });

    it('a strong garrison puts the riots down instead', () => {
        s.holding = null;
        Holdings.ensure(s).garrison.push(...soldier(5));
        s.holding.unrest = 100;
        Holdings.processDay(player, world);
        expect(s.holding.rebellion).toBeNull();
        expect(s.holding.unrest).toBeLessThan(100);
    });

    it('is lost if the rebels still hold the town at the deadline', () => {
        Holdings.ensure(s).unrest = 100;
        Holdings.processDay(player, world);
        const deadline = s.holding.rebellion.deadline;
        world.day = deadline;
        const day = Holdings.processDay(player, world);
        expect(day.lost).toHaveLength(1);
        expect(player.colonies).toHaveLength(0);
        expect(s.colony.isPlayerColony).toBe(false);
        expect(Holdings.isHolding(player, world, 5, 5)).toBe(false);
        expect(player.holdings.stats.holdingsLost).toBe(1);
    });

    it('can be bought off or crushed in battle', () => {
        Holdings.ensure(s).unrest = 100;
        Holdings.processDay(player, world);
        const gold = player.gold;
        const res = Holdings.parley(player, world, 5, 5);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold - Holdings.parleyCost(s));
        expect(s.holding.rebellion).toBeNull();
        s.holding.unrest = 100;
        Holdings.processDay(player, world);
        expect(Holdings.resolveRebellion(player, world, 5, 5, false).crushed).toBe(false);
        expect(Holdings.resolveRebellion(player, world, 5, 5, true).crushed).toBe(true);
        expect(s.holding.rebellion).toBeNull();
    });
});

describe('Bandit raids', () => {
    it('raiders near a holding strike; walls and troops beat them off', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const s = own(player, world, 5, 5, { population: 300, happiness: 60 });
        s.economy.food = 100;
        const raider = { type: 'raider', name: 'Raider Band', q: 6, r: 5, strength: 40 };
        world.units.push(raider);
        Utils.setRng(() => 0);
        const day = Holdings.processDay(player, world);
        expect(day.raids[0].repelled).toBe(false);
        expect(s.economy.food).toBe(70);
        expect(s.happiness).toBeLessThan(60);
        // A week later, behind a garrison
        world.day += 7;
        Holdings.ensure(s).garrison.push(...soldier(6));
        const day2 = Holdings.processDay(player, world);
        expect(day2.raids[0].repelled).toBe(true);
        expect(raider.destroyed).toBe(true);
    });
});

describe('Determinism', () => {
    it('draws no RNG without holdings, or with quiet holdings', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        let draws = 0;
        Utils.setRng(() => { draws++; return 0.5; });
        Holdings.processDay(player, world);
        expect(draws).toBe(0);
        expect(player.holdings).toBeUndefined();
        own(player, world, 5, 5, { happiness: 60 });
        Holdings.processDay(player, world);
        expect(draws).toBe(0);
    });
});

describe('Save and load', () => {
    it('round-trips the ledger and the settlement record, and backfills old saves', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        const s = own(player, world, 5, 5);
        Holdings.startProject(player, world, 5, 5, 'granary');
        finish(player, world, 10);
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        expect(saved.holdings.stats.projects).toBe(1);
        // The settlement record travels with the tiles
        const tileCopy = JSON.parse(JSON.stringify(s));
        world.getTile(5, 5).settlement = tileCopy;
        delete tileCopy.holding.fx;
        const back = makePlayer(world);
        SaveLoad.restorePlayer(saved, back, world);
        expect(back.holdings.stats.projects).toBe(1);
        expect(tileCopy.holding.fx.reserveDays).toBe(6);

        // An old save: no ledger, no holding records
        const old = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        delete old.holdings;
        delete tileCopy.holding;
        const back2 = makePlayer(world);
        SaveLoad.restorePlayer(old, back2, world);
        expect(back2.holdings.keys).toEqual(['5,5']);
        expect(tileCopy.holding.built).toEqual({});
    });
});

describe('Manage Holding panel', () => {
    it('shows slots, projects with their projected effect, governor and garrison, and acts on them', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const world = makeWorld();
        const player = makePlayer(world);
        const s = own(player, world, 5, 5, { population: 700 });
        player.army = soldier(2);
        const shown = [];
        const notes = [];
        const game = {
            player, world,
            ui: {
                showCustomPanel: (title, html) => shown.push({ title, html }),
                showNotification: (title, text, kind) => notes.push({ title, text, kind }),
                updateStats: () => {},
                hideCustomPanel: () => {},
            },
        };
        ActionMenu.showHoldingPanel(game, world.getTile(5, 5));
        const html = shown[0].html;
        expect(shown[0].title).toContain(s.name);
        expect(html).toContain('slots <b>0/4</b>');
        expect(html).toContain('Market Square');
        expect(html).toMatch(/tax a week|% tax/);
        expect(html).toContain('Appoint a governor');
        expect(html).toContain('Garrison');
        window._holding.start('granary');
        expect(s.holding.queue[0].id).toBe('granary');
        expect(shown[1].html).toContain('under construction');
        window._holding.station('soldier', 2);
        expect(s.holding.garrison).toHaveLength(2);
        expect(notes.every(n => n.kind === 'success')).toBe(true);
    });
});

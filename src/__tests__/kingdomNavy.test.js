/**
 * Kingdom navies: realms with ports keep a fleet paid from the treasury,
 * fleets fight for the sea in kingdom wars, a blockade cuts the blockaded
 * realm's income, helps storm its ports and spoils its port markets, hostile
 * fleets intercept the player's ships, and a sworn player can lend galleys
 * to the liege's fleet. Also: the training event and turncoat mercenaries
 * respect kingdom.militaryCap.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Ships } from '../systems/ships.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { RealmPolitics } from '../player/realmPolitics.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Technology } from '../systems/technology.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(2024));

function kingdom(id, extra = {}) {
    return {
        id, name: `Realm ${id}`, isAlive: true, territory: [], wars: [], allies: [], relations: {},
        military: 500, militaryCap: 600, treasury: 100000, population: 10000, stability: 60, traits: [], ...extra,
    };
}

/**
 * Row 0 is open sea. Realm A holds q 0-4 and B holds q 10-14 on rows 1-3;
 * each has a port on row 1 (its capital) and an inland town on row 3.
 */
function makeWorld(aExtra = {}, bExtra = {}) {
    const width = 20, height = 10;
    const tiles = {};
    const a = kingdom('A', aExtra);
    const b = kingdom('B', bExtra);
    for (let r = 0; r < height; r++) {
        for (let q = 0; q < width; q++) {
            const owner = r >= 1 && r <= 3 ? (q <= 4 ? a : (q >= 10 && q <= 14 ? b : null)) : null;
            tiles[`${q},${r}`] = {
                q, r, kingdom: owner ? owner.id : null,
                terrain: r === 0 ? { id: 'ocean', passable: false } : { id: 'plains', passable: true },
            };
            if (owner) owner.territory.push({ q, r });
        }
    }
    const town = (q, r, k, type) => { tiles[`${q},${r}`].settlement = { name: `${k.id}-${q}-${r}`, type, kingdom: k.id, population: 3000 }; };
    town(2, 1, a, 'capital'); town(2, 3, a, 'town');
    town(12, 1, b, 'capital'); town(12, 3, b, 'town');
    a.capital = { q: 2, r: 1 };
    b.capital = { q: 12, r: 1 };
    const world = {
        day: 100, width, height, events: [], kingdoms: [a, b],
        getTile: (q, r) => (r < 0 || r >= height ? null : tiles[`${Hex.wrapQ(q, width)},${r}`]),
        getKingdom: (id) => [a, b].find(k => k.id === id) || null,
        getAllSettlements: () => Object.values(tiles).filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
    };
    return { world, a, b };
}

function makePlayer(extra = {}) {
    const p = {
        name: 'Hero', gold: 1000, health: 100, maxHealth: 100, q: 2, r: 0,
        army: [], properties: [], ships: [], karma: 0, renown: 0, reputation: {},
        skills: { combat: 0, leadership: 1, commerce: 0, diplomacy: 2 },
        ...extra,
    };
    Technology.initPlayer(p);
    return p;
}

const galley = () => PlayerMilitary.makeArmyUnit(PlayerMilitary.UNIT_TYPES.WAR_GALLEY);

describe('royal fleets', () => {
    it('counts ports and builds a fleet capped by its ports and traits, paid from the treasury', () => {
        const { world, a } = makeWorld();
        const n = KingdomNavy.updateFleet(a, world);
        expect(n.ports).toBe(1);
        expect(n.settlements).toBe(2);
        // one port that is also the capital
        expect(n.cap).toBe(KingdomNavy.CONFIG.perPort + KingdomNavy.CONFIG.capitalPort);
        // first count: half the cap afloat, then it builds toward the cap
        const before = a.treasury;
        const s0 = n.strength;
        KingdomNavy.updateFleet(a, world);
        expect(n.strength).toBeGreaterThan(s0);
        expect(a.treasury).toBeLessThan(before);

        const naval = makeWorld({ traits: ['naval'] }).a;
        const nn = KingdomNavy.updateFleet(naval, makeWorld().world);
        expect(nn.cap).toBe(Math.floor(n.cap * 1.5));
    });

    it('a poor treasury caps the fleet, and an unpaid fleet rots', () => {
        const { world, a } = makeWorld({ treasury: KingdomNavy.CONFIG.reservePerStrength * 4 });
        const n = KingdomNavy.updateFleet(a, world);
        expect(n.cap).toBe(4);

        a.treasury = 0;
        n.strength = 40;
        KingdomNavy.updateFleet(a, world);
        expect(n.strength).toBeLessThan(40);
    });

    it('a realm without ports keeps no fleet', () => {
        const { world, a } = makeWorld();
        world.getTile(2, 1).settlement = null; // the port is gone
        const n = KingdomNavy.updateFleet(a, world);
        expect(n.ports).toBe(0);
        expect(n.cap).toBe(0);
    });
});

describe('war at sea', () => {
    function atWar(aExtra, bExtra) {
        const env = makeWorld(aExtra, bExtra);
        KingdomAI.startWar(env.a, env.b, env.world);
        KingdomNavy.updateFleet(env.a, env.world);
        KingdomNavy.updateFleet(env.b, env.world);
        return env;
    }

    it('the stronger fleet blockades the enemy ports; income falls by the port share', () => {
        const { world, a, b } = atWar();
        a.navy.strength = 40;
        b.navy.strength = 5;
        KingdomNavy._updateBlockade(a, b, world);
        expect(KingdomNavy.isBlockaded(b)).toBe(true);
        expect(KingdomNavy.blockaders(b)).toEqual(['A']);
        // half of B's settlements are ports
        expect(KingdomNavy.incomeFactor(b)).toBeCloseTo(1 - KingdomNavy.CONFIG.blockade.incomeLoss * 0.5);
        expect(KingdomNavy.incomeFactor(a)).toBe(1);
        expect(world.events.some(e => /blockades/.test(e.text))).toBe(true);

        // B rebuilds and breaks it
        b.navy.strength = 40;
        KingdomNavy._updateBlockade(a, b, world);
        expect(KingdomNavy.isBlockaded(b)).toBe(false);
    });

    it('a blockade ends with the war', () => {
        const { world, a, b } = atWar();
        a.navy.strength = 40;
        b.navy.strength = 0;
        KingdomNavy._updateBlockade(a, b, world);
        expect(KingdomNavy.isBlockaded(b)).toBe(true);
        KingdomAI.endWar(a, b, world);
        KingdomNavy.updateFleet(b, world);
        expect(KingdomNavy.isBlockaded(b)).toBe(false);
    });

    it('helps storm a blockaded port, not an inland town', () => {
        const { world, a, b } = atWar();
        a.navy.strength = 40;
        b.navy.strength = 0;
        KingdomNavy._updateBlockade(a, b, world);
        expect(KingdomNavy.siegeMultiplier(a, b, world, 12, 1)).toBeCloseTo(1 + KingdomNavy.CONFIG.blockade.siegeBonus);
        expect(KingdomNavy.siegeMultiplier(a, b, world, 12, 3)).toBe(1);
    });

    it('fleet battles are deterministic and draw nothing from the world RNG', () => {
        let draws = 0;
        Utils.setRng(() => { draws++; return 0.5; });
        const run = () => {
            const { world, a, b } = atWar();
            a.navy.strength = 30;
            b.navy.strength = 28;
            for (let d = 0; d < 60; d++) {
                world.day = 100 + d;
                KingdomNavy.processWar(a, b, world);
            }
            return [a.navy.strength, b.navy.strength, world.events.length];
        };
        const first = run();
        const drawsDuringWar = draws;
        const second = run();
        Utils.resetRng();
        expect(second).toEqual(first);
        // only startWar's goal rolls draw from the RNG (2 per war)
        expect(drawsDuringWar).toBe(2);
        expect(first[2]).toBeGreaterThan(0); // some battle or blockade happened
    });
});

describe('blockaded port markets', () => {
    function blockaded(bFleet) {
        const env = makeWorld();
        KingdomAI.startWar(env.a, env.b, env.world);
        KingdomNavy.updateFleet(env.a, env.world);
        KingdomNavy.updateFleet(env.b, env.world);
        env.a.navy.strength = 30;
        env.b.navy.strength = bFleet;
        KingdomNavy._updateBlockade(env.a, env.b, env.world);
        return env;
    }

    it('a loose blockade makes goods dearer and buyers stingier', () => {
        const { world } = makeWorld();
        const free = Ships.getPortMarket(world, 12, 1);
        const env = blockaded(20); // 30 vs 20: blockaded, not shut
        const market = Ships.getPortMarket(env.world, 12, 1);
        expect(Ships.getPortBlockade(env.world, 12, 1).closed).toBe(false);
        expect(market.length).toBe(free.length);
        for (let i = 0; i < market.length; i++) {
            expect(market[i].sell).toBeLessThanOrEqual(free[i].sell);
            if (free[i].buy !== null) expect(market[i].buy).toBeGreaterThan(free[i].buy);
            expect(market[i].blockaded).toBe(true);
        }
    });

    it('a tight blockade closes the harbour', () => {
        const env = blockaded(0);
        expect(Ships.getPortBlockade(env.world, 12, 1).closed).toBe(true);
        expect(Ships.getPortMarket(env.world, 12, 1)).toEqual([]);
        const ship = { id: 'ship_1', typeId: 'sloop', name: 'Gull', q: 12, r: 1, status: 'docked', condition: 100, customizations: [], cargo: { spices: 5 }, crew: 10, morale: 70 };
        const p = makePlayer({ q: 12, r: 1, ships: [ship] });
        const res = Ships.sellTradeGood(p, env.world, 'ship_1', 'spices', 5);
        expect(res.success).toBe(false);
        expect(res.message).toMatch(/closed/);
    });
});

describe('interception at sea', () => {
    function hostileSea(playerExtra = {}) {
        const env = makeWorld();
        KingdomNavy.updateFleet(env.b, env.world);
        env.b.navy.strength = 60;
        const ship = { id: 'ship_1', typeId: 'sloop', name: 'Gull', q: 12, r: 0, status: 'anchored', condition: 100, customizations: [], cargo: { spices: 10 }, crew: 20, morale: 70 };
        const p = makePlayer({ ships: [ship], reputation: { B: -80 }, ...playerExtra });
        return { ...env, ship, p };
    }

    it('hostile realms, and realms at war with your liege, send their fleets after you', () => {
        const { world, a, b, p } = hostileSea();
        expect(Ships.fleetHostility(p, world, b)).toBe('hostile');
        expect(Ships.fleetHostility(p, world, a)).toBe(null);
        p.reputation.B = 0;
        expect(Ships.fleetHostility(p, world, b)).toBe(null);
        p.allegiance = 'A';
        KingdomAI.startWar(a, b, world);
        expect(Ships.fleetHostility(p, world, b)).toBe('war');
        expect(Ships.fleetHostility(p, world, a)).toBe(null); // never your own liege
    });

    it('only near their waters', () => {
        const { world } = hostileSea();
        expect(KingdomNavy.fleetsNear(world, 12, 0).map(f => f.kingdom.id)).toEqual(['B']);
        expect(KingdomNavy.fleetsNear(world, 6, 0)).toEqual([]);
    });

    it('a ship that loses is damaged and has cargo seized; one that wins thins the fleet', () => {
        Utils.setRng(() => 0); // every check passes; equal rolls on both sides
        const { world, ship, p } = hostileSea();
        const reports = Ships._interceptShips(p, world);
        Utils.resetRng();
        expect(reports).toHaveLength(1);
        expect(reports[0].won).toBe(false);
        expect(ship.condition).toBeLessThan(100);
        expect(ship.cargo.spices).toBe(7);

        // A galley escort and a full crew turn the fight
        const strong = hostileSea({ army: [galley(), galley(), galley(), galley(), galley(), galley()] });
        strong.ship.typeId = 'galleon';
        const before = strong.b.navy.strength;
        Utils.setRng(() => 0);
        const win = Ships._interceptShips(strong.p, strong.world);
        Utils.resetRng();
        expect(win[0].won).toBe(true);
        expect(strong.b.navy.strength).toBeLessThan(before);
        expect(strong.p.renown).toBe(KingdomNavy.CONFIG.intercept.renown);
    });

    it('escorts and crew raise the odds over many encounters', () => {
        const wins = (army, crew) => {
            let w = 0;
            for (let i = 0; i < 200; i++) {
                const env = hostileSea({ army: army() });
                env.ship.crew = crew;
                if (Ships._fightInterception(env.p, env.world, env.ship, env.b, 'hostile').won) w++;
            }
            return w;
        };
        const bare = wins(() => [], 4);
        const escorted = wins(() => [galley(), galley()], 20);
        expect(escorted).toBeGreaterThan(bare);
    });

    it('docked ships are safe in harbour, and processDaily reports interceptions', () => {
        const { world, ship, p } = hostileSea();
        ship.status = 'docked';
        Utils.setRng(() => 0);
        const out = Ships.processDaily(p, world);
        Utils.resetRng();
        expect(out.interceptions).toEqual([]);
    });
});

describe("galleys in the liege's fleet", () => {
    function serving() {
        const env = makeWorld();
        KingdomAI.startWar(env.a, env.b, env.world);
        KingdomNavy.updateFleet(env.a, env.world);
        KingdomNavy.updateFleet(env.b, env.world);
        const p = makePlayer({ allegiance: 'A', army: [galley(), galley()] });
        return { ...env, p };
    }

    it('lent galleys join the fleet, are paid, and stop escorting', () => {
        const { world, a, p } = serving();
        const escort = Ships.getEscortStrength(p);
        expect(escort).toBeGreaterThan(0);
        const base = KingdomNavy.effectiveStrength(a);
        const res = RealmPolitics.lendGalleys(p, world);
        expect(res.success).toBe(true);
        expect(a.navy.auxiliary).toBe(RealmPolitics.fleetContribution(p));
        expect(KingdomNavy.effectiveStrength(a)).toBe(base + a.navy.auxiliary);
        expect(Ships.getEscortStrength(p)).toBe(0);

        const gold = p.gold;
        const out = RealmPolitics.processFleetService(p, world);
        expect(out.wage).toBe(KingdomNavy.CONFIG.liegeService.wagePerGalley * 2);
        expect(p.gold).toBe(gold + out.wage);

        expect(RealmPolitics.recallGalleys(p, world).success).toBe(true);
        expect(a.navy.auxiliary).toBe(0);
        expect(Ships.getEscortStrength(p)).toBe(escort);
    });

    it('sea victories become campaign merit; defeats wound a galley', () => {
        const { world, a, b, p } = serving();
        RealmPolitics.lendGalleys(p, world);
        a.navy.strength = 50;
        b.navy.strength = 10;
        KingdomNavy.fleetBattle(a, b, world);
        let out = RealmPolitics.processFleetService(p, world);
        expect(out.victories).toBe(1);
        expect(p.politics.merit['A:B']).toBe(1);

        a.navy.strength = 0;
        a.navy.auxiliary = 5;
        b.navy.strength = 80;
        KingdomNavy.fleetBattle(a, b, world);
        out = RealmPolitics.processFleetService(p, world);
        expect(out.defeats).toBe(1);
        expect(out.wounded).toBe(1);
        expect(p.army.some(u => u.woundedDays > 0)).toBe(true);
    });

    it('service ends when the liege makes peace', () => {
        const { world, a, b, p } = serving();
        RealmPolitics.lendGalleys(p, world);
        KingdomAI.endWar(a, b, world);
        const out = RealmPolitics.processFleetService(p, world);
        expect(out.ended).toMatch(/no longer at war/);
        expect(p.politics.fleetService).toBe(null);
        expect(a.navy.auxiliary).toBe(0);
    });

    it('needs galleys and a liege at war', () => {
        const { world, p } = serving();
        p.army = [];
        expect(RealmPolitics.lendGalleys(p, world).success).toBe(false);
    });
});

describe('save and load', () => {
    it('saves the fleet with the kingdom and backfills old saves', () => {
        const { world, a } = makeWorld();
        KingdomNavy.updateFleet(a, world);
        const saved = SaveLoad.serializeKingdoms([a])[0];
        expect(saved.navy.strength).toBe(a.navy.strength);
        expect(saved.navy.cap).toBe(a.navy.cap);

        const old = kingdom('Z');
        const n = KingdomNavy.ensure(old);
        expect(n).toMatchObject({ strength: 0, blockades: {}, auxiliary: 0, _init: false });
    });
});

describe('military cap leftovers', () => {
    it('the training event never lifts an army past what the realm can feed', () => {
        const k = kingdom('T', { military: 1000, militaryCap: 1050 });
        const world = { day: 1, kingdoms: [k], events: [] };
        Utils.setRng(() => 0); // picks 'training' and the first realm
        const ev = WorldEvents.generateMilitaryEvent(world);
        Utils.resetRng();
        expect(ev.text).toMatch(/training/i);
        expect(k.military).toBe(1050);

        Utils.setRng(() => 0);
        WorldEvents.generateMilitaryEvent(world);
        Utils.resetRng();
        expect(k.military).toBe(1050);
    });

    it('a turncoat mercenary company joins a rival only up to its cap', () => {
        const rival = kingdom('R', { military: 990, militaryCap: 1000 });
        const world = { day: 1, kingdoms: [rival] };
        const company = {
            id: 'mc1', name: 'Grey Company', icon: '⚔️', dailyWage: 0, loyalty: 10, outbidRisk: 0.9, daysRemaining: 30,
            roster: [{ type: 'soldier', count: 50 }],
        };
        const p = makePlayer({ gold: 0, mercenaryCompanies: [company] });
        Utils.setRng(() => 0);
        const out = PlayerMilitary._processMercenaryCompanies(p, world);
        Utils.resetRng();
        expect(out.events.some(e => e.type === 'outbid_switch')).toBe(true);
        expect(rival.military).toBe(1000);
    });
});

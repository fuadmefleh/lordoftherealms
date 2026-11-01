// Landing parties (systems/landings.js, player/coastalRaids.js): what the
// ship's boat on open coast is good for — beach runs past the customs house,
// raids from the sea, colonies founded from a landing, and pirate reavers
// coming ashore on the player's coastal holdings.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Ships } from '../systems/ships.js';
import { Landings } from '../systems/landings.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { Underworld } from '../systems/underworld.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Pirates } from '../systems/pirates.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Colonization } from '../world/colonization.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { CoastalRaids } from '../player/coastalRaids.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

afterEach(() => {
    vi.restoreAllMocks();
    if (DataLoader._gamedata) delete DataLoader._gamedata.landings;
    Utils.resetRng();
});

/** Override landing tunables for one test. */
function tune(over) {
    DataLoader._gamedata.landings = over;
}

/** Count draws on the shared RNG stream while fn runs. */
function drawsDuring(fn) {
    const base = Utils.getRng();
    let n = 0;
    Utils.setRng(() => { n++; return base(); });
    try { return { n, out: fn() }; } finally { Utils.setRng(base); }
}

const WATER = { id: 'ocean', name: 'Ocean', passable: false };
const GRASS = { id: 'grassland', name: 'Grassland', passable: true, moveCost: 1 };

/** Small hand-made world: ocean except the hexes in `land`; a realm `K` with a town. */
function makeWorld(land = {}) {
    const tiles = new Map();
    const kingdom = { id: 'K', name: 'Kestrel', isAlive: true, treasury: 100, traits: [], territory: [], wars: [] };
    const getTile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) {
            const spec = land[key];
            tiles.set(key, {
                q, r, terrain: spec ? spec.terrain : WATER,
                settlement: spec && spec.settlement ? { q, r, ...spec.settlement } : null,
                kingdom: spec ? spec.kingdom || null : null,
                infrastructure: null,
            });
        }
        return tiles.get(key);
    };
    for (const key of Object.keys(land)) {
        const [q, r] = key.split(',').map(Number);
        getTile(q, r);
    }
    const world = {
        day: 10, width: 200, height: 200, events: [], kingdoms: [kingdom],
        generationParams: { seed: 7 },
        getTile,
        getKingdom: (id) => (id === 'K' ? kingdom : null),
        getAllSettlements: () => [...tiles.values()].filter(t => t.settlement).map(t => t.settlement),
        invalidateSettlements() {},
    };
    return { world, kingdom };
}

function makeShip(extra = {}) {
    return { id: 'ship_1', name: 'Gull', typeId: 'cog', status: 'anchored', q: 20, r: 20, cargo: {}, lots: {}, crew: 8, morale: 70, ...extra };
}

function makePlayer(extra = {}) {
    return {
        q: 0, r: 0, gold: 1000, actionPoints: 10, karma: 0, renown: 0, inventory: {}, maxInventory: 20,
        skills: { stealth: 1, combat: 1, leadership: 1 }, reputation: {}, ships: [], boardedShip: null, ...extra,
    };
}

/* ── Beach runs ─────────────────────────────────────────── */

describe('Landings — beach runs past the customs house', () => {
    // The ship anchored at (20,20); the player ashore on a neighbouring beach; a town of K four hexes inland
    const shore = Hex.neighbors(20, 20)[0];
    const town = { q: shore.q + 3, r: shore.r };
    function setup() {
        const { world, kingdom } = makeWorld({
            [`${shore.q},${shore.r}`]: { terrain: GRASS },
            [`${town.q},${town.r}`]: { terrain: GRASS, settlement: { name: 'Ketby', type: 'town', kingdom: 'K', population: 800 }, kingdom: 'K' },
        });
        const ship = makeShip({ cargo: { wine: 8, timber: 4 }, lots: { wine: { L: 8 } } });
        const player = makePlayer({ q: shore.q, r: shore.r, ships: [ship] });
        return { world, kingdom, ship, player };
    }

    it('lands booked goods unbooked — no duty, no embargo — when the watch sees nothing', () => {
        const { world, ship, player } = setup();
        vi.spyOn(Landings, 'runCatchChance').mockReturnValue(0);
        const q = Landings.runQuote(player, world, ship.id, 'wine');
        expect(q.ok).toBe(true);
        expect(q.units).toBe(Ships.LANDING_BOAT_CAPACITY);
        const res = Landings.runAshore(player, world, ship.id, 'wine');
        expect(res.success).toBe(true);
        expect(res.caught).toBe(false);
        expect(player.inventory.wine).toBe(5);
        expect(ship.cargo.wine).toBe(3);
        // The bookings of the landed units are gone: the player's ledger holds none
        expect(TradePolicy._ledger(player, 'wine')).toEqual({});
        expect(ship.lots.wine.L).toBeCloseTo(3, 1);
        expect(player.actionPoints).toBe(8);
        // The boat's trips are spent
        expect(Ships.getFerryAllowance(ship, world, shore.q, shore.r)).toBe(0);
        expect(Landings.ensure(player).stats.runUnits).toBe(5);
    });

    it('refuses goods that owe nothing, and any run through a port or jetty', () => {
        const { world, ship, player } = setup();
        expect(Landings.runQuote(player, world, ship.id, 'timber').ok).toBe(false);
        const tile = world.getTile(shore.q, shore.r);
        tile.infrastructure = { id: 'jetty', underConstruction: false };
        const q = Landings.runQuote(player, world, ship.id, 'wine');
        expect(q.ok).toBe(false);
        expect(q.reason).toMatch(/customs/);
    });

    it('caught: the goods seized, a fine to the crown and heat with the realm', () => {
        const { world, kingdom, ship, player } = setup();
        vi.spyOn(Landings, 'runCatchChance').mockReturnValue(1);
        const res = Landings.runAshore(player, world, ship.id, 'wine', 3);
        expect(res.caught).toBe(true);
        expect(res.seized).toBe(3);
        expect(player.inventory.wine).toBeUndefined();
        expect(ship.cargo.wine).toBe(5);
        expect(res.fine).toBeGreaterThan(0);
        expect(player.gold).toBe(1000 - res.fine);
        expect(kingdom.treasury).toBe(100 + res.fine);
        expect(Underworld.getHeat(player, 'K')).toBeGreaterThan(0);
    });

    it('the watch is sharper near a town, after a raid on its coast, and absent on wild shores', () => {
        const { world, player } = setup();
        const watch = Landings.coastWatch(world, shore.q, shore.r);
        expect(watch.kingdom.id).toBe('K');
        const calm = Landings.runCatchChance(player, world, watch);
        Landings.raiseAlarm(player, world, 'K');
        expect(Landings.alarmed(player, world, 'K')).toBe(true);
        expect(Landings.runCatchChance(player, world, watch)).toBeGreaterThan(calm);
        expect(Landings.coastWatch(world, shore.q + 40, shore.r)).toBeNull();
    });

    it('rolls by hash: the shared RNG stream is never drawn', () => {
        const { world, ship, player } = setup();
        const { n, out } = drawsDuring(() => Landings.runAshore(player, world, ship.id, 'wine'));
        expect(out.success).toBe(true);
        expect(n).toBe(0);
    });
});

/* ── Landfall colonies ──────────────────────────────────── */

describe('Landings — a colony founded from a landing', () => {
    const shore = Hex.neighbors(60, 60)[0];
    function setup() {
        const land = {};
        // A patch of unclaimed coast: the shore and the land behind it
        for (const h of Hex.hexesInRange(shore.q + 2, shore.r, 2)) land[`${h.q},${h.r}`] = { terrain: GRASS };
        land[`${shore.q},${shore.r}`] = { terrain: GRASS };
        const { world } = makeWorld(land);
        const ship = makeShip({ q: 60, r: 60, cargo: { grain: 6, timber: 4, wine: 2 } });
        const player = makePlayer({ q: shore.q, r: shore.r, ships: [ship], army: [] });
        return { world, ship, player };
    }

    it('costs less than an overland colony and lands settlers and a boat-load of stores', () => {
        const { world, ship, player } = setup();
        const q = Landings.landfallQuote(player, world);
        expect(q.ok).toBe(true);
        expect(q.cost).toBeLessThan(Colonization.COLONY_COST);
        const res = Landings.foundLandfall(player, world, 'Gullhaven');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(1000 - q.cost);
        const s = world.getTile(shore.q, shore.r).settlement;
        expect(s.name).toBe('Gullhaven');
        expect(s.colony.isPlayerColony).toBe(true);
        expect(s.colony.landfall).toBeTruthy();
        expect(s.population).toBe(Landings.config().landfall.settlers);
        const landed = Object.values(res.landed).reduce((a, b) => a + b, 0);
        expect(landed).toBe(Landings.config().landfall.supplies);
        expect(Ships.getCargoUsed(ship)).toBe(12 - landed);
        expect(s.economy.food).toBeGreaterThan(0);
    });

    it('has no quay: a boat-load a day until a jetty is built on it', () => {
        const { world, ship, player } = setup();
        Landings.foundLandfall(player, world);
        const tile = world.getTile(shore.q, shore.r);
        expect(Ships.isPortTile(world, shore.q, shore.r)).toBe(true);
        expect(Ships.hasDock(world, shore.q, shore.r)).toBe(false);
        // The day's boat trips went into the founding; tomorrow another boat-load
        world.day++;
        const a = Landings.supplyColony(player, world, ship.id, 'grain', 99);
        expect(a.success).toBe(true);
        expect(a.landed).toBeLessThanOrEqual(Ships.LANDING_BOAT_CAPACITY);
        // A jetty may be built in the colony; once finished, ships berth freely
        Infrastructure.TYPES = DataLoader.get('infrastructure').types || Infrastructure.TYPES;
        player.gold = 5000;
        const can = Infrastructure.canBuild(player, 'JETTY', tile, world);
        expect(can.reason || '').not.toMatch(/already ports/);
        tile.infrastructure = { id: 'jetty', underConstruction: false };
        expect(Ships.hasDock(world, shore.q, shore.r)).toBe(true);
        expect(Ships.getFerryAllowance(ship, world, shore.q, shore.r)).toBe(Infinity);
    });

    it('needs a ship at anchor with founding stores, on unclaimed coast', () => {
        const { world, ship, player } = setup();
        ship.cargo = { wine: 10 };
        expect(Landings.landfallQuote(player, world).ok).toBe(false);
        ship.cargo = { grain: 10 };
        ship.status = 'docked';
        expect(Landings.landfallQuote(player, world).ok).toBe(false);
        ship.status = 'anchored';
        world.getTile(shore.q, shore.r).kingdom = 'K';
        expect(Landings.landfallQuote(player, world).reason).toMatch(/claimed/);
    });
});

/* ── Raids from the sea ─────────────────────────────────── */

function armyOf(type, n) {
    const def = Object.values(PlayerMilitary.UNIT_TYPES).find(u => u.id === type);
    return Array.from({ length: n }, () => PlayerMilitary.makeArmyUnit(def));
}

/** A real world: the player aboard a ship on the water beside a realm's port town. */
function seaSetup(seed = 4242) {
    const game = newGame(seed);
    const { world, player } = game;
    for (const s of world.getAllSettlements()) {
        if (!s.kingdom || s.type === 'capital' || !Ships.isPortTile(world, s.q, s.r)) continue;
        const water = Hex.neighbors(s.q, s.r)
            .map(n => ({ q: Hex.wrapQ(n.q, world.width), r: n.r }))
            .find(n => n.r >= 0 && n.r < world.height && Ships.isWaterTile(world.getTile(n.q, n.r)));
        if (!water) continue;
        const settlement = world.getTile(s.q, s.r).settlement;
        const ship = { id: 'ship_r', name: 'Reaver', typeId: 'cog', status: 'at_sea', q: water.q, r: water.r, cargo: {}, crew: 8, morale: 70 };
        player.ships = [ship];
        player.boardedShip = ship.id;
        player.q = water.q;
        player.r = water.r;
        player.allegiance = null;
        player.actionPoints = 20;
        player.army = armyOf('soldier', 20);
        return { game, world, player, settlement, ship, kingdom: world.getKingdom(settlement.kingdom) };
    }
    throw new Error('no port town fits the test');
}

describe('CoastalRaids — troops landed from the boats', () => {
    it('the boats land only so many soldiers a day; the rest stay aboard', () => {
        const { world, player, settlement } = seaSetup();
        const t = CoastalRaids.targets(player, world);
        expect(t.some(x => x.settlement === settlement)).toBe(true);
        const q = CoastalRaids.quote(player, world, settlement.q, settlement.r);
        expect(q.troops).toBe(Landings.config().raid.troopsPerShip);
        expect(q.landed).toBe(20);
    });

    it('a won raid plunders gold and stores into the hold, and the realm remembers', () => {
        const { world, player, settlement, ship, kingdom } = seaSetup();
        tune({ raid: { defenseShare: 0.0001 } });
        const repBefore = player.reputation[kingdom.id] || 0;
        const res = CoastalRaids.raid(player, world, settlement.q, settlement.r, 'plunder');
        expect(res.success).toBe(true);
        expect(res.victory).toBe(true);
        expect(res.plunder).toBeGreaterThan(0);
        expect(Ships.getCargoUsed(ship)).toBeGreaterThan(0);
        expect(Ships.getCargoUsed(ship)).toBeLessThanOrEqual(Ships.LANDING_BOAT_CAPACITY);
        expect(player.reputation[kingdom.id]).toBeLessThan(repBefore);
        expect(settlement.lastRaidedDay).toBe(world.day);
        expect(Landings.alarmed(player, world, kingdom.id)).toBe(true);
        expect((kingdom.lord && kingdom.lord.memory || []).some(m => m.k === 'raid')).toBe(!!kingdom.lord);
        // Soldiers left aboard rejoin the army
        expect(player.army.length).toBe(20 - res.casualties);
        // The boats have done their day's work
        expect(CoastalRaids.quote(player, world, settlement.q, settlement.r).ok).toBe(false);
    });

    it('burning the stores empties the market, costs more karma, and nothing goes to the hold', () => {
        const { world, player, settlement, ship } = seaSetup();
        tune({ raid: { defenseShare: 0.0001 } });
        const stockBefore = Object.values(SettlementMarket.ensure(settlement).stock).reduce((a, b) => a + b, 0);
        const res = CoastalRaids.raid(player, world, settlement.q, settlement.r, 'burn');
        expect(res.victory).toBe(true);
        expect(res.burned).toBe(true);
        expect(Ships.getCargoUsed(ship)).toBe(0);
        const stockAfter = Object.values(settlement.market.stock).reduce((a, b) => a + b, 0);
        expect(stockBefore).toBeGreaterThan(0);
        expect(stockAfter).toBeLessThan(stockBefore);
        expect(player.karma).toBeLessThanOrEqual(-Landings.config().raid.burnKarma);
    });

    it('a warned coast meets the next landing with a readier garrison', () => {
        const { world, player, settlement, kingdom } = seaSetup();
        const calm = CoastalRaids.quote(player, world, settlement.q, settlement.r).defense;
        Landings.raiseAlarm(player, world, kingdom.id);
        expect(CoastalRaids.quote(player, world, settlement.q, settlement.r).defense).toBeGreaterThan(calm);
    });

    it('fights on its own seeded stream: the shared RNG is untouched', () => {
        const { world, player, settlement } = seaSetup();
        const { n, out } = drawsDuring(() => CoastalRaids.raid(player, world, settlement.q, settlement.r));
        expect(out.success).toBe(true);
        expect(n).toBe(0);
    });

    it("never offers the player's liege's towns", () => {
        const { world, player, settlement } = seaSetup();
        player.allegiance = settlement.kingdom;
        expect(CoastalRaids.targets(player, world).some(t => t.settlement === settlement)).toBe(false);
    });
});

/* ── Sea reavers ────────────────────────────────────────── */

describe('Landings — sea reavers on your coastal holdings', () => {
    it('a captain near a coastal holding may land; the holding beats them off or burns', () => {
        const { world, player, settlement } = seaSetup();
        player.boardedShip = null;
        settlement.colony = { isPlayerColony: true, loyalty: 70, garrisonStrength: 0 };
        player.colonies = [{ q: settlement.q, r: settlement.r, name: settlement.name }];
        const st = Pirates.ensure(player, world);
        const cap = Pirates.atLarge(player)[0];
        const haven = Pirates.haven(player, cap.havenId);
        haven.q = settlement.q;
        haven.r = settlement.r;
        cap.strength = 9999;
        expect(st).toBeTruthy();
        tune({ reavers: { chance: 1 } });
        const popBefore = settlement.population;
        const day = Landings.processDay(world, player);
        expect(day.raids.length).toBe(1);
        expect(day.raids[0].repelled).toBe(false);
        expect(settlement.population).toBeLessThan(popBefore);
        // Not again for a while
        world.day++;
        expect(Landings.processDay(world, player).raids.length).toBe(0);
    });

    it('draws nothing from the shared stream', () => {
        const { world, player } = seaSetup();
        Pirates.ensure(player, world);
        expect(drawsDuring(() => Landings.processDay(world, player)).n).toBe(0);
    });
});

/* ── Saving ─────────────────────────────────────────────── */

describe('Landings — saved with the game', () => {
    it('player.landings travels in the save and is backfilled for old saves', () => {
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('landings');
        const p = makePlayer();
        Landings.raiseAlarm(p, { day: 5 }, 'K');
        const copy = JSON.parse(JSON.stringify(p.landings));
        const q = { landings: copy };
        Landings.loadState(q);
        expect(q.landings.alarms.K).toBe(35);
        const old = {};
        Landings.loadState(old);
        expect(old.landings.stats.runs).toBe(0);
    });
});

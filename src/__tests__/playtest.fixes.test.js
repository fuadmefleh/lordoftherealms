// Focused regressions for bugs the headless playtest (playtest.soak.test.js)
// turned up: ship upkeep past an empty purse, planting contracts that never
// paid, runaway tavern income, same-tile buy→sell money loops, trips dropped
// when the next hex cost more stamina than was left, and worlds that came
// back different after a save/load.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Economy } from '../world/economy.js';
import { Player } from '../player/player.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { SeasonalWork } from '../player/seasonalWork.js';
import { Ships } from '../systems/ships.js';
import { Underworld } from '../systems/underworld.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const GRASS = { id: 'grassland', name: 'Grassland', passable: true, moveCost: 1 };
const HILLS = { id: 'hills', name: 'Hills', passable: true, moveCost: 3 };
const WATER = { id: 'ocean', name: 'Ocean', passable: false, moveCost: 99 };

/** A small hand-built world: `land` maps "q,r" → { terrain, settlement }. */
function makeWorld(land = {}, { day = 1, size = 12 } = {}) {
    const tiles = [];
    for (let r = 0; r < size; r++) {
        const row = [];
        for (let q = 0; q < size; q++) {
            const spec = land[`${q},${r}`];
            row.push({ q, r, terrain: spec ? spec.terrain : WATER, settlement: spec ? spec.settlement || null : null, resource: null });
        }
        tiles.push(row);
    }
    return {
        width: size, height: size, day, tiles, kingdoms: [],
        getTile(q, r) { return r >= 0 && r < size ? tiles[r][((q % size) + size) % size] : null; },
        getKingdom() { return null; },
    };
}

describe('ship upkeep', () => {
    it('never takes the purse below zero; unpaid upkeep wears the hull', () => {
        const world = makeWorld({ '5,5': { terrain: GRASS, settlement: { name: 'Saltmere', type: 'town' } } });
        const player = {
            q: 5, r: 5, gold: 2, inventory: {},
            ships: [{ id: 's1', name: 'Gull', typeId: 'galleon', status: 'docked', q: 5, r: 5, cargo: {}, crew: 0, condition: 80 }],
        };
        const res = Ships.processDaily(player, world);
        expect(player.gold).toBe(0);
        expect(res.upkeepShort).toBeGreaterThan(0);
        expect(player.ships[0].condition).toBeLessThan(80);
    });
});

describe('planting contracts', () => {
    it('pay out at the harvest for a real settlement (which carries no q/r of its own)', () => {
        const village = { name: 'Barley', type: 'village', population: 400 };
        const world = makeWorld({ '3,4': { terrain: GRASS, settlement: village } }, { day: 10 });
        const player = { gold: 0, q: 3, r: 4 };
        const signed = SeasonalWork.signPlantingContract(player, village, world);
        expect(signed.success).toBe(true);
        expect(signed.contract).toMatchObject({ q: 3, r: 4 });
        world.day = signed.contract.dueDay;
        const [paid] = SeasonalWork.processDaily(player, world);
        expect(paid.lost).toBeUndefined();
        expect(paid.paid).toBeGreaterThan(0);
    });

    it('a contract saved without a position finds its settlement by name', () => {
        const village = { name: 'Barley', type: 'village', population: 400 };
        const world = makeWorld({ '3,4': { terrain: GRASS, settlement: village } }, { day: 80 });
        const player = { gold: 0, plantingContracts: [{ settlementName: 'Barley', dueDay: 79, payout: 50 }] };
        const [paid] = SeasonalWork.processDaily(player, world);
        expect(paid.paid).toBeGreaterThan(0);
    });
});

describe('taverns', () => {
    it('cap the population bonus — a capital tavern no longer repays itself in days', () => {
        const capital = { name: 'Crown', type: 'capital', population: 15000 };
        const world = makeWorld({ '2,2': { terrain: GRASS, settlement: capital } });
        const tile = world.getTile(2, 2);
        const player = new Player();
        player.gold = 5000;
        player.properties = [];
        expect(PlayerEconomy.buildProperty(player, 'TAVERN', tile, world).success).toBe(true);
        const prop = PlayerEconomy.findPropertyAt(tile, 'tavern');
        prop.underConstruction = false;
        const before = player.gold;
        PlayerEconomy.produceGoods(player, world);
        const net = player.gold - before;
        expect(net).toBeGreaterThan(0);
        expect(prop.todayIncome).toBeLessThanOrEqual(Math.ceil((35 + 40) * 1.5));
    });
});

describe('no buying and selling straight back on one tile', () => {
    const town = () => ({ name: 'Brightwater', type: 'capital', population: 9000 });

    it('a trade agreement on both sides of the counter no longer makes the market a money pump', () => {
        const settlement = town();
        const world = makeWorld({ '4,4': { terrain: GRASS, settlement } });
        const tile = world.getTile(4, 4);
        settlement.kingdom = 'k1';
        const player = new Player();
        player.tradeAgreements = { k1: { untilDay: 999 } };
        const discount = Math.max(0.5, 1 - Trading.buyDiscount(player, settlement));
        for (const g of Trading.getAvailableGoods(settlement, tile, world)) {
            const buy = Math.ceil(g.price * discount);
            const good = PlayerEconomy.GOODS[g.id.toUpperCase()];
            expect(Trading.saleUnitPrice(player, good, settlement, world), g.id).toBeLessThan(buy);
        }
    });

    it('the black market and the fence pay under the open price for goods on open sale', () => {
        const settlement = town();
        const world = makeWorld({ '4,4': { terrain: GRASS, settlement } });
        const tile = world.getTile(4, 4);
        const player = new Player();
        Underworld.ensure(player).guild.rank = 5;
        for (const g of Trading.getAvailableGoods(settlement, tile, world)) {
            const ask = Economy.marketAsk(world, tile, g.id);
            expect(Underworld.blackMarketPrice(world, tile, g.id), g.id).toBeLessThan(Math.ceil(ask * 0.5) + 1);
            expect(Underworld.fencePrice(player, g.id, world, tile), g.id).toBeLessThan(Math.ceil(ask * 0.5) + 1);
        }
    });

    it('goods bought at a port sell back there for less, to every outlet', () => {
        const settlement = { name: 'Saltmere', type: 'town', population: 2000 };
        const world = makeWorld({ '5,5': { terrain: GRASS, settlement } });
        const tile = world.getTile(5, 5);
        const player = new Player();
        player.q = 5; player.r = 5;
        for (const e of Ships.getPortMarket(world, 5, 5).filter(x => x.buy)) {
            const good = PlayerEconomy.GOODS[e.id.toUpperCase()];
            if (good) expect(Trading.saleUnitPrice(player, good, settlement, world), e.id).toBeLessThan(e.buy);
            expect(Underworld.blackMarketPrice(world, tile, e.id), e.id).toBeLessThan(e.buy);
            expect(Ships.portSaleUnitPrice(player, world, 5, 5, e), e.id).toBeLessThan(e.buy);
        }
    });
});

describe('walking', () => {
    it('queues the rest of the trip when the next hex costs more stamina than is left', () => {
        const land = {};
        for (let q = 0; q < 8; q++) land[`${q},3`] = { terrain: q === 2 ? HILLS : GRASS };
        const world = makeWorld(land);
        const player = new Player();
        player.q = 0; player.r = 3;
        expect(player.moveTo(5, 3, world)).toBe(true);
        player.movementRemaining = 2; // one grassland step, then not enough for the hills
        let guard = 0;
        while (player.isMoving && guard++ < 50) player.stepAlongPath(world, 1);
        expect(player.q).toBe(1);
        expect(player.queuedPath).toBeTruthy();
        expect(player.resumeQueuedPath()).toBe(true);
    });
});

describe('save and load', () => {
    it('regenerates the same world from the saved seed, and settlements know their place', () => {
        Utils.setSeed(7);
        const world = new World(40, 30);
        world.generate({ kingdomCount: 3 });
        expect(world.generationParams.seed).toBeTruthy();
        for (const s of world.getAllSettlements()) {
            expect(world.getTile(s.q, s.r).settlement).toMatchObject({ q: s.q, r: s.r });
        }
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(world)));
        Utils.setSeed(999); // a different session
        const again = new World(40, 30);
        again.generate(saved.generationParams);
        const ids = (w) => w.tiles.map(row => row.map(t => t.terrain.id).join(',')).join('|');
        expect(ids(again)).toBe(ids(world));
    });
});

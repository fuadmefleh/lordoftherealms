// Port markets and sailing movement.
// Ports export some trade goods cheaply and import others at a premium, so
// buying into the hold at one port and selling at another is a trade run.
// While aboard, movement (pathing, stepping and the reach overlay) follows
// the sea rules: water, beaches and coastal settlements.

import { describe, it, expect, beforeAll } from 'vitest';
import { Ships } from '../systems/ships.js';
import { Player } from '../player/player.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const WATER = { id: 'ocean', name: 'Ocean', passable: false, moveCost: 99 };
const GRASS = { id: 'grassland', name: 'Grassland', passable: true, moveCost: 1 };

// 20×20 map: ocean everywhere except the listed hexes.
function makeWorld(land = {}, day = 1) {
    const tiles = new Map();
    return {
        width: 20, height: 20, day,
        getTile(q, r) {
            if (r < 0 || r >= 20) return null;
            q = ((q % 20) + 20) % 20;
            const key = `${q},${r}`;
            if (!tiles.has(key)) {
                const spec = land[key];
                tiles.set(key, { q, r, terrain: spec ? spec.terrain : WATER, settlement: spec ? spec.settlement || null : null });
            }
            return tiles.get(key);
        },
    };
}

const portWorld = (day = 1) => makeWorld({ '5,5': { terrain: GRASS, settlement: { name: 'Saltmere', type: 'town' } } }, day);

function dockedPlayer() {
    return {
        q: 5, r: 5, gold: 5000, boardedShip: null, inventory: {}, skills: { commerce: 1 },
        ships: [{ id: 's1', name: 'Gull', typeId: 'galleon', status: 'docked', q: 5, r: 5, cargo: {} }],
    };
}

describe('Port market', () => {
    it('gives every trade good a role and stable prices within a week', () => {
        const a = Ships.getPortMarket(portWorld(1), 5, 5);
        const b = Ships.getPortMarket(portWorld(6), 5, 5);
        expect(a.length).toBeGreaterThan(0);
        expect(b).toEqual(a);
        for (const e of a) {
            expect(['export', 'import', 'local']).toContain(e.role);
            expect(e.sell).toBeGreaterThan(0);
            if (e.role === 'import') expect(e.buy).toBeNull();
            else expect(e.buy).toBeGreaterThan(e.sell);
        }
    });

    it('differs between ports, so trade runs can pay', () => {
        const roles = (q, r) => Ships.getPortMarket(portWorld(), q, r).map(e => e.role).join();
        const distinct = new Set([roles(5, 5), roles(12, 3), roles(2, 17), roles(9, 9)]);
        expect(distinct.size).toBeGreaterThan(1);
    });

    it('buys into the hold and sells back out, moving gold both ways', () => {
        const world = portWorld();
        const player = dockedPlayer();
        const good = Ships.getPortMarket(world, 5, 5).find(e => e.buy !== null);
        expect(good).toBeTruthy();

        const bought = Ships.buyTradeGood(player, world, 's1', good.id, 4);
        expect(bought.success).toBe(true);
        expect(player.ships[0].cargo[good.id]).toBe(4);
        expect(player.gold).toBe(5000 - 4 * good.buy);

        const sold = Ships.sellTradeGood(player, world, 's1', good.id, 4);
        expect(sold.revenue).toBe(4 * good.sell);
        expect(player.ships[0].cargo[good.id]).toBeUndefined();
    });

    it('charges more per unit as a big purchase drains the town\'s stores', async () => {
        const { SettlementMarket } = await import('../world/settlementMarket.js');
        const settlement = { name: 'Saltmere', type: 'city', population: 3000 };
        SettlementMarket.ensure(settlement);
        const world = makeWorld({ '5,5': { terrain: GRASS, settlement } });
        const good = Ships.getPortMarket(world, 5, 5)
            .find(e => e.buy !== null && SettlementMarket.tracks(e.id) && SettlementMarket.stock(settlement, e.id) > 0);
        expect(good).toBeTruthy();
        const lot = Math.min(40, Math.floor(SettlementMarket.stock(settlement, good.id)));
        const player = dockedPlayer();
        player.gold = 1e6;
        const bought = Ships.buyTradeGood(player, world, 's1', good.id, lot);
        expect(bought.success).toBe(true);
        expect(bought.bought).toBe(lot);
        // The first unit costs the posted price; the lot as a whole costs more
        expect(bought.cost).toBeGreaterThan(lot * good.buy);
    });

    it('needs the ship docked at a port', () => {
        const world = makeWorld({ '5,5': { terrain: GRASS } });
        const player = dockedPlayer();
        const good = Ships.getPortMarket(world, 5, 5).find(e => e.buy !== null);
        expect(Ships.buyTradeGood(player, world, 's1', good.id, 1).success).toBe(false);
    });

    it('refuses to buy a good the port only imports', () => {
        // Find a port that imports something
        for (let q = 0; q < 20; q++) {
            const world = makeWorld({ [`${q},5`]: { terrain: GRASS, settlement: { name: 'P' } } });
            const imp = Ships.getPortMarket(world, q, 5).find(e => e.role === 'import');
            if (!imp) continue;
            const player = { ...dockedPlayer(), q };
            player.ships[0].q = q;
            expect(Ships.buyTradeGood(player, world, 's1', imp.id, 1).success).toBe(false);
            return;
        }
        throw new Error('no importing port found');
    });
});

describe('Sailing movement', () => {
    function sailor() {
        const p = new Player();
        p.q = 5; p.r = 5;
        p.boardedShip = 's1';
        p.movementRemaining = 6;
        return p;
    }

    it('reach overlay shows water while sailing, not land', () => {
        const [landHex] = Hex.neighbors(5, 5);
        const world = makeWorld({ [`${landHex.q},${landHex.r}`]: { terrain: GRASS } });
        const reach = sailor().getReachableHexes(world);
        expect(reach.size).toBeGreaterThan(1);
        expect(reach.has(`${landHex.q},${landHex.r}`)).toBe(false);
        // 6 stamina at 2 per hex = 3 hexes out
        for (const cost of reach.values()) expect(cost).toBeLessThanOrEqual(6);
    });

    it('a ship can enter a coastal settlement to dock but not bare land', () => {
        const world = makeWorld({ '6,5': { terrain: GRASS, settlement: { name: 'Port' } }, '4,5': { terrain: GRASS } });
        const p = sailor();
        expect(p._canEnterHex(6, 5, world)).toBe(true);
        expect(p._canEnterHex(4, 5, world)).toBe(false);
        p.boardedShip = null;
        expect(p._canEnterHex(4, 5, world)).toBe(true);
        expect(p._canEnterHex(5, 6, world)).toBe(false);
    });
});

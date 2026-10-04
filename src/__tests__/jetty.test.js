// Jetties: a player-built dock on open coast. Ships can sail in and berth
// there, and cargo crosses without the boat-load limit — like a port, but
// with no market.

import { describe, it, expect, beforeEach } from 'vitest';
import { Ships } from '../systems/ships.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Hex } from '../core/hex.js';
import infraData from '../../data/infrastructure.json';

const WATER = { id: 'ocean', name: 'Ocean', passable: false };
const GRASS = { id: 'grassland', name: 'Grassland', passable: true, moveCost: 1 };

// Everything is ocean except the hexes given in `land`.
function makeWorld(land = {}) {
    const tiles = new Map();
    const getTile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) {
            const spec = land[key];
            tiles.set(key, {
                q, r,
                terrain: spec ? spec.terrain : WATER,
                settlement: spec ? spec.settlement || null : null,
                infrastructure: null,
            });
        }
        return tiles.get(key);
    };
    return { getTile, day: 10 };
}

const [shore] = Hex.neighbors(5, 5);
const keyOf = (h) => `${h.q},${h.r}`;

function buildJetty(world, player) {
    const tile = world.getTile(shore.q, shore.r);
    const result = Infrastructure.build(player, 'JETTY', tile, world);
    tile.infrastructure.underConstruction = false;
    tile.infrastructure.constructionDaysLeft = 0;
    return { tile, result };
}

describe('Jetty', () => {
    beforeEach(() => {
        Infrastructure.TYPES = infraData.types;
    });

    it('can only be built on land next to open water, never in a settlement', () => {
        const player = { gold: 1000 };
        const world = makeWorld({
            [keyOf(shore)]: { terrain: GRASS },
            '50,50': { terrain: GRASS },
            '20,20': { terrain: GRASS, settlement: { name: 'Port Town' } },
        });
        expect(Infrastructure.canBuild(player, 'JETTY', world.getTile(shore.q, shore.r), world).can).toBe(true);

        // An inland hex: surround (50,50) with grass
        const inland = { '50,50': { terrain: GRASS } };
        for (const n of Hex.neighbors(50, 50)) inland[keyOf(n)] = { terrain: GRASS };
        const dry = makeWorld(inland);
        const check = Infrastructure.canBuild(player, 'JETTY', dry.getTile(50, 50), dry);
        expect(check.can).toBe(false);

        const town = Infrastructure.canBuild(player, 'JETTY', world.getTile(20, 20), world);
        expect(town.can).toBe(false);
    });

    it('does nothing while still under construction', () => {
        const world = makeWorld({ [keyOf(shore)]: { terrain: GRASS } });
        const player = { gold: 1000 };
        const tile = world.getTile(shore.q, shore.r);
        Infrastructure.build(player, 'JETTY', tile, world);
        expect(tile.infrastructure.underConstruction).toBe(true);
        expect(Ships.hasDock(world, shore.q, shore.r)).toBe(false);
    });

    it('lets the whole hold come ashore when rowing to a finished jetty', () => {
        const world = makeWorld({ [keyOf(shore)]: { terrain: GRASS } });
        const ship = { id: 'ship_1', name: 'Gull', typeId: 'cog', status: 'at_sea', q: 5, r: 5, cargo: { timber: 12 } };
        const player = { q: 5, r: 5, gold: 1000, ships: [ship], boardedShip: 'ship_1', inventory: {} };
        const { result } = buildJetty(world, player);
        expect(result.success).toBe(true);
        expect(player.gold).toBe(1000 - result.cost);

        expect(Ships.hasDock(world, shore.q, shore.r)).toBe(true);
        expect(Ships.isPortTile(world, shore.q, shore.r)).toBe(false); // no market

        const landed = Ships.rowAshore(player, world, shore.q, shore.r);
        expect(landed.isPort).toBe(true);
        expect(player.inventory.timber).toBe(12);
        expect(ship.cargo.timber || 0).toBe(0);
    });

    it('docks a ship that disembarks onto the jetty', () => {
        const world = makeWorld({ [keyOf(shore)]: { terrain: GRASS } });
        const ship = { id: 'ship_1', name: 'Gull', typeId: 'cog', status: 'at_sea', q: shore.q, r: shore.r, cargo: { fish: 9 } };
        const player = { q: shore.q, r: shore.r, gold: 1000, ships: [ship], boardedShip: 'ship_1', inventory: {} };
        buildJetty(world, player);

        const result = Ships.disembark(player, world);
        expect(result.success).toBe(true);
        expect(ship.status).toBe('docked');
        expect(ship.dockedAt).toBe('Jetty');
        expect(player.inventory.fish).toBe(9);
        expect(Ships.getFerryAllowance(ship, world, shore.q, shore.r)).toBe(Infinity);
    });
});

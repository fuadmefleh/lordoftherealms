// Rowing ashore from a ship onto undeveloped coast.
// A boarded player can row to any walkable land hex next to the ship; the
// ship anchors offshore. Without a port only a boat-load of cargo comes
// ashore — ports (settlements on the water) unload the whole hold.

import { describe, it, expect } from 'vitest';
import { Ships } from '../systems/ships.js';
import { Hex } from '../core/hex.js';

const WATER = { id: 'ocean', name: 'Ocean', passable: false };
const GRASS = { id: 'grassland', name: 'Grassland', passable: true };
const PEAK = { id: 'snow_peak', name: 'Snow Peak', passable: false };

// Small map: everything is ocean except the hexes given in `land`.
function makeWorld(land = {}) {
    const tiles = new Map();
    const getTile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) {
            const spec = land[key];
            tiles.set(key, { q, r, terrain: spec ? spec.terrain : WATER, settlement: spec ? spec.settlement || null : null });
        }
        return tiles.get(key);
    };
    return { getTile };
}

function makePlayer(cargo = {}) {
    const ship = { id: 'ship_1', name: 'Gull', typeId: 'cog', status: 'at_sea', q: 0, r: 0, cargo: { ...cargo } };
    return { q: 5, r: 5, ships: [ship], boardedShip: 'ship_1', inventory: {} };
}

// Two neighbours of (5,5): one walkable, one impassable mountain.
const [shore, peak] = Hex.neighbors(5, 5);
const keyOf = (h) => `${h.q},${h.r}`;

describe('Ships — landing ashore', () => {
    it('offers only walkable land next to the ship as row-ashore targets', () => {
        const world = makeWorld({ [keyOf(shore)]: { terrain: GRASS }, [keyOf(peak)]: { terrain: PEAK } });
        const targets = Ships.getRowAshoreTargets(world, 5, 5);
        expect(targets.map(t => keyOf(t))).toEqual([keyOf(shore)]);
    });

    it('rows ashore, anchors the ship offshore, and brings only a boat-load of cargo', () => {
        const world = makeWorld({ [keyOf(shore)]: { terrain: GRASS } });
        const player = makePlayer({ timber: 12 });

        const result = Ships.rowAshore(player, world, shore.q, shore.r);

        expect(result.success).toBe(true);
        expect(result.isPort).toBe(false);
        expect([player.q, player.r]).toEqual([shore.q, shore.r]);
        expect(player.boardedShip).toBeNull();
        const ship = player.ships[0];
        expect(ship.status).toBe('anchored');
        expect([ship.q, ship.r]).toEqual([5, 5]);
        expect(player.inventory.timber).toBe(Ships.LANDING_BOAT_CAPACITY);
        expect(ship.cargo.timber).toBe(12 - Ships.LANDING_BOAT_CAPACITY);
        expect(result.cargo.remaining).toBe(12 - Ships.LANDING_BOAT_CAPACITY);
    });

    it('unloads the whole hold when rowing into a port', () => {
        const world = makeWorld({ [keyOf(shore)]: { terrain: GRASS, settlement: { name: 'Saltmere' } } });
        const player = makePlayer({ timber: 12, wine: 3 });

        const result = Ships.rowAshore(player, world, shore.q, shore.r);

        expect(result.isPort).toBe(true);
        expect(player.inventory).toEqual({ timber: 12, wine: 3 });
        expect(player.ships[0].cargo).toEqual({});
    });

    it('refuses to row to land that is not adjacent or not walkable', () => {
        const world = makeWorld({ [keyOf(peak)]: { terrain: PEAK }, '9,9': { terrain: GRASS } });
        const player = makePlayer();
        expect(Ships.rowAshore(player, world, peak.q, peak.r).success).toBe(false);
        expect(Ships.rowAshore(player, world, 9, 9).success).toBe(false);
        expect(player.boardedShip).toBe('ship_1');
    });

    it('rows back out to the anchored ship and boards it', () => {
        const world = makeWorld({ [keyOf(shore)]: { terrain: GRASS } });
        const player = makePlayer();
        Ships.rowAshore(player, world, shore.q, shore.r);

        expect(Ships.getAnchoredShipsNear(player, player.q, player.r)).toHaveLength(1);
        const result = Ships.rowToShip(player, 'ship_1');

        expect(result.success).toBe(true);
        expect([player.q, player.r]).toEqual([5, 5]);
        expect(player.boardedShip).toBe('ship_1');
        expect(player.ships[0].status).toBe('at_sea');
    });

    it('will not row out to an anchored ship that is too far away', () => {
        const player = makePlayer();
        Object.assign(player.ships[0], { status: 'anchored', q: 20, r: 20 });
        player.boardedShip = null;
        expect(Ships.getAnchoredShipsNear(player, player.q, player.r)).toHaveLength(0);
        expect(Ships.rowToShip(player, 'ship_1').success).toBe(false);
    });

    it('disembarking on an open beach also lands only a boat-load', () => {
        const world = makeWorld({ '5,5': { terrain: { id: 'beach', name: 'Beach', passable: true } } });
        const player = makePlayer({ fish: 9 });

        const result = Ships.disembark(player, world);

        expect(result.success).toBe(true);
        expect(player.inventory.fish).toBe(Ships.LANDING_BOAT_CAPACITY);
        expect(player.ships[0].status).toBe('docked');
        expect(player.boardedShip).toBeNull();
    });
});

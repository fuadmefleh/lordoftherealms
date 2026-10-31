// Sailors sign on at the port where a short-handed ship lies: the town menu
// offers "Hire Sailors" whenever a ship docked there has empty berths.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Ships } from '../systems/ships.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

/** (5,5) holds a town; `coastal` puts sea all around it. */
function makeWorld(coastal) {
    const town = { name: 'Saltmere', type: 'town', population: 2000 };
    return {
        day: 10,
        getTile: (q, r) => (q === 5 && r === 5)
            ? { q, r, settlement: town, terrain: { id: 'plains', passable: true } }
            : { q, r, terrain: coastal ? { id: 'ocean', passable: false } : { id: 'plains', passable: true } },
    };
}

function shipAt(q, r, crew) {
    const type = Object.values(Ships.SHIP_TYPES || {})[0] || Ships._getShipTypes()[0];
    return { id: 'ship_t1', typeId: type.id, name: 'Gull', q, r, status: 'docked', condition: 100, customizations: [], cargo: {}, crew, morale: 60 };
}

describe('hiring sailors', () => {
    it('lists a crewless ship docked at a port, with what it needs', () => {
        const player = { q: 5, r: 5, gold: 5000, ships: [shipAt(5, 5, 0)] };
        const rows = Ships.shortHandedAt(player, makeWorld(true), 5, 5);
        expect(rows).toHaveLength(1);
        expect(rows[0].open).toBe(Ships.getShipEffectiveStats(player.ships[0]).crewRequired);
        expect(rows[0].cost).toBe(Ships.getHireCost(rows[0].open));
    });

    it('lists nothing inland, and nothing once the crew is full', () => {
        const player = { q: 5, r: 5, gold: 5000, ships: [shipAt(5, 5, 0)] };
        expect(Ships.shortHandedAt(player, makeWorld(false), 5, 5)).toEqual([]);
        const world = makeWorld(true);
        expect(Ships.hireCrew(player, world, 'ship_t1').success).toBe(true);
        expect(Ships.shortHandedAt(player, world, 5, 5)).toEqual([]);
    });
});

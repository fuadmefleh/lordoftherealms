// Islands and cut-off coasts: a ruin, a treasure cache or a delve on an
// island no road reaches is reached by rowing ashore from a ship. Once
// landed, the player walks the island, sees the tile's deeds (explore, delve,
// dig, the inner map) and rows back out to the anchored ship.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Ships } from '../systems/ships.js';
import { Delves } from '../systems/delves.js';
import { PlayerActions } from '../player/playerActions.js';
import { InnerMap } from '../world/innerMap.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

afterEach(() => {
    InnerMap.active = false;
    Utils.resetRng();
});

/** Hexes within `n` steps of (q, r), walking the map's own neighbours. */
function within(q, r, n) {
    let seen = new Map([[`${q},${r}`, { q, r }]]);
    let edge = [{ q, r }];
    for (let i = 0; i < n; i++) {
        const next = [];
        for (const h of edge) {
            for (const nb of Hex.neighbors(h.q, h.r)) {
                const k = `${nb.q},${nb.r}`;
                if (!seen.has(k)) { seen.set(k, nb); next.push(nb); }
            }
        }
        edge = next;
    }
    return [...seen.values()];
}

/** Raise a three-hex-wide island out of open sea, far from any shore. */
function carveIsland(world) {
    let land = null;
    for (let r = 0; r < world.height && !land; r++) {
        for (let q = 0; q < world.width; q++) {
            const t = world.getTile(q, r);
            if (t && t.terrain && t.terrain.passable && !t.settlement && !Ships.isWaterTile(t) && t.terrain.id !== 'beach') { land = t.terrain; break; }
        }
    }
    if (!land) return null;
    for (let r = 4; r < world.height - 4; r++) {
        for (let q = 4; q < world.width - 4; q++) {
            const ring = within(q, r, 2).map(h => world.getTile(h.q, h.r));
            if (!ring.every(t => t && Ships.isWaterTile(t))) continue;
            const island = within(q, r, 1).map(h => world.getTile(h.q, h.r));
            for (const t of island) {
                t.terrain = land;
                t.improvement = null;
            }
            return { center: world.getTile(q, r), island };
        }
    }
    return null;
}

describe('Islands — reached by rowing ashore', () => {
    it('a landed party walks the island, finds its ruins and treasure, and enters the inner map', () => {
        const game = newGame(4242);
        const { world, player } = game;
        const carved = carveIsland(world);
        expect(carved).not.toBeNull();
        const { center, island } = carved;
        const edge = island.find(t => t !== center);
        // Ruins on the far side; a treasure cache in the middle
        const ruinTile = island.find(t => t !== center && t !== edge);
        ruinTile.improvement = { type: 'ruins', name: 'Drowned Hall', explored: false };
        center.improvement = { type: 'treasure_cache', name: 'Buried Chest', explored: false };

        // The ship lies off the island's edge, the player aboard
        const water = Hex.neighbors(edge.q, edge.r).map(h => world.getTile(h.q, h.r)).find(t => Ships.isWaterTile(t));
        const ship = { id: 'ship_i', name: 'Tern', typeId: 'cog', status: 'at_sea', q: water.q, r: water.r, cargo: {}, crew: 8, morale: 70 };
        player.ships = [ship];
        player.boardedShip = ship.id;
        player.q = water.q;
        player.r = water.r;

        // Row ashore onto the island
        expect(Ships.getRowAshoreTargets(world, water.q, water.r).some(t => t.q === edge.q && t.r === edge.r)).toBe(true);
        expect(Ships.rowAshore(player, world, edge.q, edge.r).success).toBe(true);
        expect(ship.status).toBe('anchored');

        // Walking the island: a path to the ruins, none to the far mainland
        expect(player.moveTo(ruinTile.q, ruinTile.r, world)).toBe(true);
        player.isMoving = false;
        player.path = null;
        const mainland = world.getAllSettlements()[0];
        expect(player.moveTo(mainland.q, mainland.r, world)).toBe(false);

        // Standing on the ruins: explore or delve, and the inner map
        player.q = ruinTile.q;
        player.r = ruinTile.r;
        const types = PlayerActions.getAvailableActions(player, ruinTile, world).map(a => a.type);
        expect(types.some(t => t === 'explore_poi' || t === 'delve')).toBe(true);
        expect(types).toContain('explore_inner_map');
        if (Delves.isDelveSite(ruinTile)) expect(types).toContain('delve');

        // The treasure cache in the middle can be dug
        player.q = center.q;
        player.r = center.r;
        const there = PlayerActions.getAvailableActions(player, center, world).map(a => a.type);
        expect(there).toContain('dig_treasure');

        // The interior of an island hex generates like any other land
        expect(InnerMap.enter({ world, player }, center.q, center.r)).toBe(true);
        expect(InnerMap.tiles.length).toBeGreaterThan(0);
        InnerMap.active = false;

        // Back to the boat: walk to the edge and row out
        player.q = edge.q;
        player.r = edge.r;
        expect(PlayerActions.getAvailableActions(player, edge, world).map(a => a.type)).toContain('row_to_ship');
        expect(Ships.rowToShip(player, ship.id).success).toBe(true);
        expect(player.boardedShip).toBe(ship.id);
    });
});

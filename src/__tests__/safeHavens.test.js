// Hostile bands strike on the open road and in villages no crown protects:
// never inside a town, city or capital, nor a village under a living realm.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { WorldUnit } from '../world/units.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(size = 30) {
    const tiles = [];
    for (let r = 0; r < size; r++) {
        tiles.push([]);
        for (let q = 0; q < size; q++) {
            tiles[r].push({ q, r, terrain: { id: 'plains', passable: true, moveCost: 1 }, regionId: 1 });
        }
    }
    const kingdoms = [{ id: 'k1', isAlive: true }, { id: 'k2', isAlive: false }];
    return {
        width: size, height: size, day: 10, tiles, units: [], events: [], kingdoms,
        getTile(q, r) {
            if (r < 0 || r >= size) return null;
            return tiles[r][((q % size) + size) % size];
        },
        getKingdom(id) { return kingdoms.find(k => k.id === id) || null; },
        isPassable() { return true; },
    };
}

const player = (q, r) => ({ q, r, army: [], skills: {}, reputation: {} });

describe('WorldUnit.isSafeHaven', () => {
    it('towns, cities and capitals are always safe; open ground never is', () => {
        const world = makeWorld();
        world.getTile(5, 5).settlement = { type: 'town', kingdom: null };
        world.getTile(6, 5).settlement = { type: 'capital', kingdom: 'k1' };
        world.getTile(7, 5).settlement = { type: 'city', kingdom: null };
        expect(WorldUnit.isSafeHaven(world, 5, 5)).toBe(true);
        expect(WorldUnit.isSafeHaven(world, 6, 5)).toBe(true);
        expect(WorldUnit.isSafeHaven(world, 7, 5)).toBe(true);
        expect(WorldUnit.isSafeHaven(world, 8, 5)).toBe(false);
    });

    it('a village is safe only under a living crown', () => {
        const world = makeWorld();
        world.getTile(5, 5).settlement = { type: 'village', kingdom: 'k1' };
        world.getTile(6, 5).settlement = { type: 'village', kingdom: null };
        world.getTile(7, 5).settlement = { type: 'village', kingdom: 'k2' }; // fallen realm
        expect(WorldUnit.isSafeHaven(world, 5, 5)).toBe(true);
        expect(WorldUnit.isSafeHaven(world, 6, 5)).toBe(false);
        expect(WorldUnit.isSafeHaven(world, 7, 5)).toBe(false);
    });
});

describe('Raider pursuit', () => {
    it('does not hunt a player inside a town, but does on the road beside it', () => {
        const world = makeWorld();
        world.getTile(15, 15).settlement = { type: 'town', kingdom: null };
        const raider = new WorldUnit('raider', 15, 17);
        world.units.push(raider);

        Utils.setSeed(3);
        raider.updateRaider(world, player(15, 15));
        expect(raider._pursuingPlayer).toBeFalsy();
        expect(raider.targetQ === 15 && raider.targetR === 15).toBe(false);

        // One hex out of town is open road: an adjacent band always engages
        raider.q = 16; raider.r = 17;
        Utils.setSeed(3);
        raider.updateRaider(world, player(16, 16));
        expect(raider.targetQ).toBe(16);
        expect(raider.targetR).toBe(16);
    });

    it('hunts a player in a village no crown protects', () => {
        const world = makeWorld();
        world.getTile(15, 15).settlement = { type: 'village', kingdom: null };
        const raider = new WorldUnit('raider', 15, 16);
        world.units.push(raider);
        Utils.setSeed(3);
        raider.updateRaider(world, player(15, 15));
        expect(raider.targetQ).toBe(15);
        expect(raider.targetR).toBe(15);
    });
});

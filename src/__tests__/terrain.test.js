import { describe, it, expect, beforeAll } from 'vitest';
import { Terrain } from '../world/terrain.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

describe('Terrain', () => {
    it('TYPES: loaded from JSON via DataLoader', () => {
        expect(Terrain.TYPES).toBeTruthy();
        expect(Object.keys(Terrain.TYPES).length).toBeGreaterThanOrEqual(20);
    });

    it('TYPES: impassable terrains have Infinity moveCost', () => {
        for (const [key, type] of Object.entries(Terrain.TYPES)) {
            if (!type.passable && type.moveCost !== null) {
                expect(type.moveCost).toBe(Infinity);
            }
        }
    });

    it('RESOURCES: all have required fields', () => {
        expect(Terrain.RESOURCES).toBeTruthy();
        for (const [key, res] of Object.entries(Terrain.RESOURCES)) {
            expect(res).toHaveProperty('id');
            expect(res).toHaveProperty('name');
            expect(res).toHaveProperty('icon');
        }
    });

    it('generateMap: creates tile grid', () => {
        const tiles = Terrain.generateMap(20, 15, { riverCount: 0 });
        expect(tiles).toHaveLength(15);
        expect(tiles[0]).toHaveLength(20);
    });

    it('generateMap: all tiles have terrain property', () => {
        const tiles = Terrain.generateMap(20, 15, { riverCount: 0 });
        for (let r = 0; r < 15; r++) {
            for (let q = 0; q < 20; q++) {
                expect(tiles[r][q]).toHaveProperty('terrain');
                expect(tiles[r][q].terrain).toHaveProperty('id');
                expect(tiles[r][q].terrain).toHaveProperty('passable');
            }
        }
    });

    it('generateMap: has both land and water', () => {
        const tiles = Terrain.generateMap(40, 30, { riverCount: 0 });
        let hasLand = false;
        let hasWater = false;
        for (let r = 0; r < 30; r++) {
            for (let q = 0; q < 40; q++) {
                if (tiles[r][q].terrain.passable) hasLand = true;
                else hasWater = true;
            }
        }
        expect(hasLand).toBe(true);
        expect(hasWater).toBe(true);
    });

    it('rollResource: returns resource or null', () => {
        if (Terrain.rollResource) {
            const result = Terrain.rollResource('mountain');
            expect(result === null || typeof result === 'object').toBe(true);
        }
    });
});

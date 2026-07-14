/**
 * Permanent regression guard for the Phase-1 seedable RNG.
 *
 * If any domain code ever calls Math.random() directly again (bypassing the
 * seedable Utils source), one of these scenarios will stop being reproducible
 * and the test fails.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { WorldUnit } from '../world/units.js';
import { Terrain } from '../world/terrain.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeUniformWorld(width, height) {
    const cache = {};
    return {
        width,
        height,
        units: [],
        events: [],
        getTile(q, r) {
            if (r < 0 || r >= height) return null;
            const wq = ((q % width) + width) % width;
            const key = `${wq},${r}`;
            if (!cache[key]) cache[key] = { terrain: { id: 'plains', passable: true }, regionId: 1 };
            return cache[key];
        },
    };
}

describe('determinism under a fixed seed', () => {
    it('raider simulation is byte-identical across two seeded runs', () => {
        const run = () => {
            Utils.setSeed(2024);
            const world = makeUniformWorld(40, 28);
            const raider = new WorldUnit('raider', 7, 7);
            const trail = [];
            for (let i = 0; i < 30; i++) {
                raider.update(world, null);
                trail.push([raider.q, raider.r]);
                if (raider.destroyed) break;
            }
            return trail;
        };
        expect(run()).toEqual(run());
    });

    it('terrain generation is byte-identical across two seeded runs', () => {
        const gen = () => {
            Utils.setSeed(2024);
            const tiles = Terrain.generateMap(30, 24, { seed: 2024 });
            return tiles.map((row) => row.map((t) => (t.terrain ? t.terrain.id : 'none')));
        };
        expect(gen()).toEqual(gen());
    });

    it('resetRng restores non-determinism', () => {
        Utils.resetRng();
        const a = Utils.randInt(0, 1e9);
        const b = Utils.randInt(0, 1e9);
        // Astronomically unlikely to collide if truly using Math.random.
        expect(a === b).toBe(false);
    });
});

/**
 * Golden characterization test — terrain generation.
 *
 * Locks the observable output of Terrain.generateMap under a fixed seed, so
 * later refactors (and the Phase-1 RNG routing) are provably behaviour-
 * preserving. Directly exercises the seedable noise2D permutation table.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Terrain } from '../world/terrain.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

// Compact, stable digest of a generated map: a histogram of terrain ids plus a
// handful of fixed-coordinate elevation samples.
function digest(tiles) {
    const hist = {};
    for (const row of tiles) {
        for (const t of row) {
            const id = t.terrain && t.terrain.id ? t.terrain.id : 'none';
            hist[id] = (hist[id] || 0) + 1;
        }
    }
    const sample = [
        [5, 5],
        [20, 10],
        [35, 25],
    ].map(([q, r]) => {
        const t = tiles[r] && tiles[r][q];
        return t ? Number(t.elevation.toFixed(4)) : null;
    });
    return { hist, sample };
}

describe('golden: terrain generation', () => {
    it('is reproducible: same seed -> identical map', () => {
        Utils.setSeed(12345);
        const a = Terrain.generateMap(40, 30, { seed: 12345 });
        Utils.setSeed(12345);
        const b = Terrain.generateMap(40, 30, { seed: 12345 });
        expect(digest(a)).toEqual(digest(b));
    });

    it('snapshot: 40x30 map for seed 12345', () => {
        Utils.setSeed(12345);
        const tiles = Terrain.generateMap(40, 30, { seed: 12345 });
        expect(digest(tiles)).toMatchSnapshot();
    });
});

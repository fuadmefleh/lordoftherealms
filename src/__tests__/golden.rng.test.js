/**
 * Golden characterization test — the seeded RNG contract.
 *
 * Freezes the exact sequence every Utils random helper produces for a fixed
 * seed. This is the safety net for the Phase-1 RNG singleton: any accidental
 * change to draw order, algorithm, or helper arithmetic breaks the snapshot.
 * No DataLoader needed — these are pure functions of the seed.
 */
import { describe, it, expect } from 'vitest';
import { Utils } from '../core/utils.js';

describe('golden: seeded RNG contract', () => {
    it('snapshot: deterministic draws for seed 777', () => {
        Utils.setSeed(777);
        const seq = {
            random: Array.from({ length: 5 }, () => Number(Utils.random().toFixed(6))),
            randInt: Array.from({ length: 5 }, () => Utils.randInt(0, 100)),
            randFloat: Array.from({ length: 3 }, () => Number(Utils.randFloat(0, 1).toFixed(6))),
            randPick: Array.from({ length: 5 }, () => Utils.randPick(['a', 'b', 'c', 'd'])),
            shuffle: Utils.shuffle([1, 2, 3, 4, 5, 6, 7, 8]),
            weightedPick: Array.from({ length: 6 }, () =>
                Utils.weightedPick([
                    { value: 'x', weight: 1 },
                    { value: 'y', weight: 3 },
                ])
            ),
            noise: [
                Number(Utils.noise2D(1.5, 2.5).toFixed(6)),
                Number(Utils.noise2D(10.1, 0.3).toFixed(6)),
            ],
        };
        expect(seq).toMatchSnapshot();
    });

    it('two seeded runs are byte-identical', () => {
        const run = () => {
            Utils.setSeed(9);
            return [Utils.random(), Utils.randInt(0, 1e6), Utils.noise2D(4.4, 5.5)];
        };
        expect(run()).toEqual(run());
    });
});

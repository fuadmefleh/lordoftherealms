/**
 * Golden characterization test — world-unit AI (raider).
 *
 * This is the behavioural safety net for Phase 3's dependency-injection work
 * on src/world/units.js. It drives a raider over many turns on a minimal,
 * fully-deterministic world fixture with NO player present (the `game` global
 * is absent in the test env, so updateRaider takes its player === null path).
 *
 * After Phase 3 threads an explicit `player` param into update()/updateRaider
 * (defaulting to null), replaying this scenario with no player must produce an
 * identical trail — proving the refactor preserved behaviour.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { WorldUnit } from '../world/units.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

// Minimal world: an infinite-feeling uniform grid of passable plains, one
// region, no other units. Enough to satisfy updateRaider + moveTowardsTarget.
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
            if (!cache[key]) {
                cache[key] = { terrain: { id: 'plains', passable: true }, regionId: 1 };
            }
            return cache[key];
        },
    };
}

describe('golden: raider AI on a uniform world (no player)', () => {
    it('snapshot: raider trail over 25 turns, seed 42', () => {
        Utils.setSeed(42);
        const world = makeUniformWorld(48, 32);
        const raider = new WorldUnit('raider', 10, 10);

        const trail = [];
        for (let i = 0; i < 25; i++) {
            raider.update(world);
            trail.push({ q: raider.q, r: raider.r, destroyed: !!raider.destroyed });
            if (raider.destroyed) break;
        }
        expect({ trail, events: world.events }).toMatchSnapshot();
    });

    it('is reproducible: identical trail for the same seed', () => {
        const run = () => {
            Utils.setSeed(42);
            const world = makeUniformWorld(48, 32);
            const raider = new WorldUnit('raider', 10, 10);
            const trail = [];
            for (let i = 0; i < 25; i++) {
                raider.update(world);
                trail.push([raider.q, raider.r]);
                if (raider.destroyed) break;
            }
            return trail;
        };
        expect(run()).toEqual(run());
    });
});

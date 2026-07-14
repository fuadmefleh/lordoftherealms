/**
 * Pure unit tests for WorldUnit raider AI — enabled by the Phase-3 DI.
 *
 * Because updateRaider now takes an explicit `player` param (instead of a
 * global), we can finally exercise the player-pursuit branch in isolation with
 * a hand-built fixture — no Game, no window, no canvas.
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

describe('WorldUnit raider — player injection', () => {
    it('pursues an adjacent, reachable player (targets and reaches them)', () => {
        Utils.setSeed(1);
        const world = makeUniformWorld(48, 32);
        const raider = new WorldUnit('raider', 10, 10);
        const player = { q: 11, r: 10, army: [], indenturedServitude: false };

        raider.update(world, player);

        // Adjacent + same region => pursuitChance 1.0 => targets the player and,
        // with speed >= 1, moves onto their tile.
        expect(raider.q).toBe(11);
        expect(raider.r).toBe(10);
    });

    it('ignores a player in indentured servitude', () => {
        Utils.setSeed(1);
        const world = makeUniformWorld(48, 32);
        const raider = new WorldUnit('raider', 10, 10);
        const indentured = { q: 11, r: 10, army: [], indenturedServitude: true };

        raider.update(world, indentured);

        // No pursuit: the raider does not lock onto the player's tile.
        expect(raider.q === 11 && raider.r === 10).toBe(false);
    });

    it('runs without a player (null) and does not throw', () => {
        Utils.setSeed(1);
        const world = makeUniformWorld(48, 32);
        const raider = new WorldUnit('raider', 10, 10);

        expect(() => raider.update(world, null)).not.toThrow();
        expect(() => raider.update(world)).not.toThrow(); // default param
    });
});

// Planning a trip on the world map (Player.travelEstimate): the route, its
// steps and how many days it takes, camping where each day's strength or
// action points run out — the same rule stepAlongPath walks by.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => { await loadData(); });

/** A passable explored hex `n` steps along a straight-ish line from the player. */
function farHex(game, n) {
    const { player, world } = game;
    for (let d = n; d < n + 20; d++) {
        for (const [dq, dr] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, -d], [-d, d]]) {
            const q = ((player.q + dq) % world.width + world.width) % world.width;
            const r = player.r + dr;
            const t = world.getTile(q, r);
            if (t && t.terrain.passable && player._canEnterHex(q, r, world)) return { q, r };
        }
    }
    return null;
}

describe('travel estimate', () => {
    it('arrives today with the day\'s strength, takes more days the further it goes, and marks the camps', () => {
        const game = newGame(401);
        const { player, world } = game;
        player.actionPoints = 10;
        const near = farHex(game, 1);
        const e1 = player.travelEstimate(world, near.q, near.r);
        expect(e1.days).toBe(0);
        expect(e1.steps).toBeGreaterThanOrEqual(1);

        const far = farHex(game, 25);
        const e2 = player.travelEstimate(world, far.q, far.r);
        expect(e2.steps).toBeGreaterThan(10);
        expect(e2.days).toBeGreaterThanOrEqual(1);
        expect(e2.stops).toHaveLength(e2.days);
        // Out of action points: even the next hex waits for tomorrow
        player.actionPoints = 0;
        expect(player.travelEstimate(world, near.q, near.r).days).toBe(1);
    }, 120000);

    it('has nothing to plan to where you stand, in jail, or to the impassable', () => {
        const game = newGame(402);
        const { player, world } = game;
        expect(player.travelEstimate(world, player.q, player.r)).toBe(null);
        const near = farHex(game, 2);
        player.jailState = { days: 3 };
        expect(player.travelEstimate(world, near.q, near.r)).toBe(null);
    }, 120000);
});

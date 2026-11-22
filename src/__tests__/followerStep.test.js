import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InnerMap } from '../world/innerMap.js';
import { FollowerStep } from '../ui/followerStep.js';

const T = 32;
const at = (q, r) => ({ x: q * T + T / 2, y: r * T + T / 2 });

// A 6x6 street: a house wall filling cells (2..3, 0..3).
function _grid(walls) {
    return (q, r) => {
        if (q < 0 || r < 0 || q > 5 || r > 5) return null;
        return { subTerrain: { passable: !walls.has(`${q},${r}`) } };
    };
}

describe('FollowerStep', () => {
    let saved;
    beforeEach(() => {
        saved = InnerMap.getTile;
        const walls = new Set();
        for (let q = 2; q <= 3; q++) for (let r = 0; r <= 3; r++) walls.add(`${q},${r}`);
        InnerMap.getTile = _grid(walls);
    });
    afterEach(() => { InnerMap.getTile = saved; });

    it('knows a wall from a street', () => {
        expect(FollowerStep.walkable(at(1, 1).x, at(1, 1).y)).toBe(true);
        expect(FollowerStep.walkable(at(2, 1).x, at(2, 1).y)).toBe(false);
    });

    it('picks the first place a figure may stand', () => {
        expect(FollowerStep.place(at(2, 2), null, at(1, 2))).toEqual(at(1, 2));
        expect(FollowerStep.place(at(2, 2), at(3, 3))).toBeNull();
    });

    it('never walks a dog through the house to reach the far side', () => {
        const m = at(1, 1);
        const goal = at(4, 1);
        for (let i = 0; i < 200; i++) FollowerStep.move(m, goal.x, goal.y, 6);
        expect(Math.floor(m.x / T)).toBeLessThan(2);
    });

    it('slides along a wall rather than stopping dead', () => {
        const m = at(1, 1);
        const goal = at(3, 5); // down and to the right, past the house's corner
        let moved = 0;
        for (let i = 0; i < 400; i++) moved += FollowerStep.move(m, goal.x, goal.y, 4);
        expect(moved).toBeGreaterThan(0);
        expect(FollowerStep.walkable(m.x, m.y)).toBe(true);
    });

    it('does not cut diagonally across a corner', () => {
        const m = { x: 1 * T + T - 1, y: 4 * T + 1 }; // bottom-left of the house corner
        const goal = at(2, 3); // inside the corner cell diagonally up-right
        FollowerStep.move(m, goal.x, goal.y, 4);
        expect(FollowerStep.walkable(m.x, m.y)).toBe(true);
    });

    it('lets a figure caught inside a wall walk out', () => {
        const m = at(2, 1);
        const goal = at(1, 1);
        expect(FollowerStep.move(m, goal.x, goal.y, 8)).toBeGreaterThan(0);
    });
});

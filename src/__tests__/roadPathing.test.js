// Overland travel keeps to the road: on open ground a road hex costs the same
// stamina as the grass beside it, so route planning weighs leaving the road.

import { describe, it, expect } from 'vitest';
import { Hex } from '../core/hex.js';
import { PlayerMovementMethods } from '../player/core/movement.js';

const W = 20, H = 12;

function makeWorld(roads = [], terrain = () => ({ id: 'plains', passable: true, moveCost: 1 })) {
    const roadSet = new Set(roads.map(([q, r]) => `${q},${r}`));
    const tiles = new Map();
    for (let q = 0; q < W; q++) {
        for (let r = 0; r < H; r++) {
            tiles.set(`${q},${r}`, { q, r, terrain: terrain(q, r), hasRoad: roadSet.has(`${q},${r}`), infrastructure: null });
        }
    }
    return { width: W, height: H, getTile: (q, r) => tiles.get(`${Hex.wrapQ(q, W)},${r}`) };
}

// A stand-in traveller: the real path-cost methods, plain stamina costs
function traveller() {
    return {
        ...PlayerMovementMethods,
        boardedShip: null,
        _hexMoveCost(tile) { return tile.hasRoad ? 1 : tile.terrain.moveCost; },
    };
}

function route(world, p, from, to) {
    return Hex.findPath(from[0], from[1], to[0], to[1], world.width, world.height,
        (q, r) => world.getTile(q, r).terrain.passable,
        (q, r) => p._hexPathCost(world.getTile(q, r)));
}

describe('Road-favouring route planning', () => {
    // A road running one row north of the straight line: a hex longer to use
    const ROAD = [0, 1, 2, 3, 4, 5, 6, 7].map(q => [q, 4]);
    const roadSteps = (world, path) => path.filter(s => world.getTile(s.q, s.r).hasRoad).length;

    it('takes a slightly longer road over open plains', () => {
        const world = makeWorld(ROAD);
        const path = route(world, traveller(), [0, 5], [6, 5]);
        expect(roadSteps(world, path)).toBeGreaterThanOrEqual(5);
        expect(path.length).toBeGreaterThan(7); // the longer way, kept to the road
    });

    it('still cuts across when the road is a long way round', () => {
        const far = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]];
        const world = makeWorld(far);
        const path = route(world, traveller(), [0, 5], [6, 5]);
        expect(path.some(s => world.getTile(s.q, s.r).hasRoad)).toBe(false);
        expect(path.length).toBe(7);
    });

    it('takes a road through rough country (the search keeps improved routes)', () => {
        const world = makeWorld(ROAD, () => ({ id: 'forest', passable: true, moveCost: 2 }));
        const path = route(world, traveller(), [0, 5], [6, 5]);
        expect(roadSteps(world, path)).toBeGreaterThanOrEqual(5);
    });

    it('only weighs planning: stamina is unchanged and ships ignore roads', () => {
        const p = traveller();
        const grass = makeWorld().getTile(3, 3);
        expect(p._hexMoveCost(grass)).toBe(1);
        expect(p._hexPathCost(grass)).toBeGreaterThan(1);
        expect(p._hexPathCost({ ...grass, hasRoad: true })).toBe(1);
        expect({ ...p, boardedShip: 's1' }._hexPathCost(grass)).toBe(1);
    });

    it('recognises built roads and bridges, not unfinished ones', () => {
        const p = traveller();
        const t = (inf) => ({ hasRoad: false, infrastructure: inf });
        expect(p._isRoadHex(t({ id: 'stone_road', underConstruction: false }))).toBe(true);
        expect(p._isRoadHex(t({ id: 'bridge', underConstruction: false }))).toBe(true);
        expect(p._isRoadHex(t({ id: 'dirt_road', underConstruction: true }))).toBe(false);
        expect(p._isRoadHex(t({ id: 'irrigation_channel', underConstruction: false }))).toBe(false);
    });
});

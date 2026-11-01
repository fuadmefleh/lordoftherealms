// The Wanderer's starting village must sit on walkable land, not a lone islet
// (player/core/state.js placeInWorld): the first independent village in scan
// order used to win even when it was a one-hex island ringed by ocean.
import { describe, it, expect } from 'vitest';
import { Player } from '../player/core/state.js';

const OCEAN = { id: 'ocean', passable: false };
const LAND = { id: 'plains', passable: true };

function world(width, height) {
    const tiles = [];
    for (let r = 0; r < height; r++) {
        tiles.push([]);
        for (let q = 0; q < width; q++) tiles[r].push({ terrain: OCEAN });
    }
    return { width, height, tiles, kingdoms: [] };
}

function place(w) {
    const p = { reputation: {}, revealArea() {}, discoverNearbyHolySites() {} };
    Player.prototype.placeInWorld.call(p, w);
    return p;
}

describe('placeInWorld', () => {
    it('skips an islet village for one on a real landmass', () => {
        const w = world(40, 30);
        // A one-hex island village, first in row-scan order
        w.tiles[1][2] = { terrain: { id: 'island', passable: true }, settlement: { type: 'village' } };
        // A mainland block further down with its own village
        for (let r = 10; r < 20; r++) for (let q = 10; q < 20; q++) w.tiles[r][q] = { terrain: LAND };
        w.tiles[15][15].settlement = { type: 'village' };
        const p = place(w);
        expect([p.q, p.r]).toEqual([15, 15]);
    });

    it('falls back to the best-connected village when every one is small', () => {
        const w = world(40, 30);
        w.tiles[1][2] = { terrain: LAND, settlement: { type: 'village' } };
        w.tiles[10][10] = { terrain: LAND, settlement: { type: 'village' } };
        w.tiles[10][11] = { terrain: LAND };
        w.tiles[10][12] = { terrain: LAND };
        const p = place(w);
        expect([p.q, p.r]).toEqual([10, 10]);
    });

    it('counts reachable land across the wrapped east-west seam', () => {
        const w = world(10, 4);
        for (let r = 0; r < 4; r++) { w.tiles[r][0] = { terrain: LAND }; w.tiles[r][9] = { terrain: LAND }; }
        expect(Player._landReach(w, 0, 0, 100)).toBe(8);
    });
});

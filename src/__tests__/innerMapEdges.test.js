/**
 * Crossing the inner map's edge into the next hex (ui/game/gameLoop.js):
 * which world-hex side an edge faces, and where you come in on the next map.
 */
import { describe, it, expect } from 'vitest';
import { edgeSide, edgeEntry } from '../ui/game/gameLoop.js';
import { Hex } from '../core/hex.js';

const W = 128, H = 128;

describe('the edges of the map', () => {
    it('each edge faces a side of the hex; the top and bottom are two sides each', () => {
        expect(edgeSide(127, 60, W, H)).toBe(0); // E
        expect(edgeSide(0, 60, W, H)).toBe(3); // W
        expect(edgeSide(100, 0, W, H)).toBe(1); // NE
        expect(edgeSide(20, 0, W, H)).toBe(2); // NW
        expect(edgeSide(20, 127, W, H)).toBe(4); // SW
        expect(edgeSide(100, 127, W, H)).toBe(5); // SE
        expect(edgeSide(64, 64, W, H)).toBeNull();
    });

    it('you come in on the matching edge of the next map, at the same place along it', () => {
        expect(edgeEntry(0, 127, 40, W, H)).toEqual({ q: 0, r: 40 });
        expect(edgeEntry(3, 0, 40, W, H)).toEqual({ q: 127, r: 40 });
        // out by the north-east (right half of the top), in by the south-west (left half of the bottom)
        expect(edgeEntry(1, 100, 0, W, H)).toEqual({ q: 36, r: 127 });
        expect(edgeEntry(2, 20, 0, W, H)).toEqual({ q: 84, r: 127 });
        expect(edgeEntry(4, 20, 127, W, H)).toEqual({ q: 84, r: 0 });
        expect(edgeEntry(5, 100, 127, W, H)).toEqual({ q: 36, r: 0 });
    });

    it('and the next map\'s edge faces back the way you came', () => {
        for (const [q, r] of [[127, 40], [0, 40], [100, 0], [20, 0], [20, 127], [100, 127]]) {
            const side = edgeSide(q, r, W, H);
            const e = edgeEntry(side, q, r, W, H);
            expect(edgeSide(e.q, e.r, W, H)).toBe((side + 3) % 6);
        }
        // (sides opposite on the world grid: a hex's neighbour by side s has us by side s + 3)
        for (const [q, r] of [[10, 10], [10, 11]]) {
            for (let s = 0; s < 6; s++) {
                const n = Hex.neighbors(q, r)[s];
                expect(Hex.neighbors(n.q, n.r)[(s + 3) % 6]).toEqual({ q, r });
            }
        }
    });
});

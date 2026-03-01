import { describe, it, expect } from 'vitest';
import { Hex } from '../core/hex.js';

describe('Hex', () => {
    it('DIRECTIONS: has 6 directions', () => {
        expect(Hex.DIRECTIONS).toHaveLength(6);
    });

    it('neighbors: returns 6 neighbors', () => {
        const n = Hex.neighbors(5, 5);
        expect(n).toHaveLength(6);
        for (const neighbor of n) {
            expect(neighbor).toHaveProperty('q');
            expect(neighbor).toHaveProperty('r');
        }
    });

    it('neighbors: even vs odd row differences', () => {
        const even = Hex.neighbors(5, 4); // even row
        const odd = Hex.neighbors(5, 5);  // odd row
        expect(JSON.stringify(even)).not.toBe(JSON.stringify(odd));
    });

    it('axialToCube / cubeToAxial: roundtrip', () => {
        const q = 3, r = 7;
        const cube = Hex.axialToCube(q, r);
        expect(cube).toHaveProperty('x');
        expect(cube).toHaveProperty('y');
        expect(cube).toHaveProperty('z');
        expect(cube.x + cube.y + cube.z).toBe(0);
        const axial = Hex.cubeToAxial(cube.x, cube.y, cube.z);
        expect(axial.q).toBe(q);
        expect(axial.r).toBe(r);
    });

    it('distance: zero for same hex', () => {
        expect(Hex.distance(5, 5, 5, 5)).toBe(0);
    });

    it('distance: correct for adjacent hexes', () => {
        for (const dir of Hex.DIRECTIONS) {
            const nq = 5 + dir.q, nr = 5 + dir.r;
            const d = Hex.distance(5, 5, nq, nr);
            expect(d).toBe(1);
        }
    });

    it('distance: symmetric', () => {
        const d1 = Hex.distance(2, 3, 7, 8);
        const d2 = Hex.distance(7, 8, 2, 3);
        expect(d1).toBe(d2);
    });

    it('wrapQ: wraps coordinates', () => {
        const width = 100;
        expect(Hex.wrapQ(50, width)).toBe(50);
        expect(Hex.wrapQ(-1, width)).toBe(99);
        expect(Hex.wrapQ(100, width)).toBe(0);
        expect(Hex.wrapQ(0, width)).toBe(0);
    });

    it('wrappingDistance: shorter across wrap boundary', () => {
        const width = 100;
        const d = Hex.wrappingDistance(5, 5, 95, 5, width);
        expect(d).toBeLessThan(50);
    });

    it('axialToPixel: returns x,y coordinates', () => {
        const result = Hex.axialToPixel(0, 0, 54);
        expect(result).toHaveProperty('x');
        expect(result).toHaveProperty('y');
        expect(typeof result.x).toBe('number');
        expect(typeof result.y).toBe('number');
    });

    it('hexesInRange: returns correct count', () => {
        const hexes = Hex.hexesInRange(5, 5, 1);
        expect(hexes.length).toBeGreaterThanOrEqual(1);
        expect(hexes.length).toBeLessThanOrEqual(7);
        const hexes2 = Hex.hexesInRange(5, 5, 2);
        expect(hexes2.length).toBeGreaterThanOrEqual(hexes.length);
    });

    it('hexCorners: returns 6 corner points', () => {
        const corners = Hex.hexCorners(100, 100, 54);
        expect(corners).toHaveLength(6);
        for (const corner of corners) {
            expect(corner).toHaveProperty('x');
            expect(corner).toHaveProperty('y');
        }
    });
});

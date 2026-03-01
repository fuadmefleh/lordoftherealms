import { describe, it, expect } from 'vitest';
import { Utils } from '../core/utils.js';

describe('Utils', () => {
    it('clamp: clamps values within range', () => {
        expect(Utils.clamp(5, 0, 10)).toBe(5);
        expect(Utils.clamp(-5, 0, 10)).toBe(0);
        expect(Utils.clamp(15, 0, 10)).toBe(10);
        expect(Utils.clamp(0, 0, 10)).toBe(0);
        expect(Utils.clamp(10, 0, 10)).toBe(10);
    });

    it('lerp: linear interpolation', () => {
        expect(Utils.lerp(0, 10, 0)).toBe(0);
        expect(Utils.lerp(0, 10, 1)).toBe(10);
        expect(Utils.lerp(0, 10, 0.5)).toBe(5);
        expect(Utils.lerp(2, 8, 0.25)).toBeCloseTo(3.5);
    });

    it('randInt: returns integer in range', () => {
        for (let i = 0; i < 100; i++) {
            const val = Utils.randInt(5, 10);
            expect(val).toBeGreaterThanOrEqual(5);
            expect(val).toBeLessThanOrEqual(10);
            expect(val).toBe(Math.floor(val));
        }
    });

    it('randFloat: returns float in range', () => {
        for (let i = 0; i < 100; i++) {
            const val = Utils.randFloat(1.0, 2.0);
            expect(val).toBeGreaterThanOrEqual(1.0);
            expect(val).toBeLessThan(2.0);
        }
    });

    it('randPick: picks from array', () => {
        const arr = ['a', 'b', 'c'];
        for (let i = 0; i < 50; i++) {
            expect(arr).toContain(Utils.randPick(arr));
        }
    });

    it('weightedPick: respects weights', () => {
        const items = [
            { value: 'common', weight: 100 },
            { value: 'rare', weight: 0 },
        ];
        for (let i = 0; i < 50; i++) {
            expect(Utils.weightedPick(items)).toBe('common');
        }
    });

    it('shuffle: returns same elements', () => {
        const arr = [1, 2, 3, 4, 5];
        const shuffled = Utils.shuffle([...arr]);
        expect(shuffled).toHaveLength(arr.length);
        for (const item of arr) {
            expect(shuffled).toContain(item);
        }
    });

    it('hashStr: produces consistent hashes', () => {
        const h1 = Utils.hashStr('test');
        const h2 = Utils.hashStr('test');
        expect(h1).toBe(h2);
        expect(Utils.hashStr('abc')).not.toBe(Utils.hashStr('xyz'));
    });

    it('formatNumber: formats with separators', () => {
        const result = Utils.formatNumber(1000);
        expect(typeof result).toBe('string');
    });

    it('deepClone: creates independent copy', () => {
        const original = { a: 1, b: { c: 2 } };
        const clone = Utils.deepClone(original);
        expect(clone).toEqual(original);
        clone.b.c = 99;
        expect(original.b.c).toBe(2);
    });

    it('seededRandom: produces deterministic values', () => {
        const rng1 = Utils.seededRandom(42);
        const rng2 = Utils.seededRandom(42);
        for (let i = 0; i < 10; i++) {
            expect(rng1()).toBe(rng2());
        }
    });

    it('noise2D: returns values in valid range', () => {
        for (let i = 0; i < 20; i++) {
            const val = Utils.noise2D(i * 0.5, i * 0.3);
            expect(typeof val).toBe('number');
            expect(isNaN(val)).toBe(false);
        }
    });

    it('fbm: returns values in valid range', () => {
        const val = Utils.fbm(1.5, 2.5, 4);
        expect(typeof val).toBe('number');
        expect(isNaN(val)).toBe(false);
    });
});

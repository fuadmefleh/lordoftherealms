import { describe, it, expect, beforeAll } from 'vitest';
import { Kingdom } from '../world/kingdom.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

describe('Kingdom', () => {
    it('DEFAULTS: loaded from JSON', () => {
        expect(Kingdom.DEFAULTS).toBeTruthy();
        expect(Array.isArray(Kingdom.DEFAULTS)).toBe(true);
        expect(Kingdom.DEFAULTS.length).toBeGreaterThanOrEqual(5);
    });

    it('create: returns kingdom with required properties', () => {
        const template = Kingdom.DEFAULTS[0];
        const kingdom = Kingdom.create(template);
        expect(kingdom).toHaveProperty('id');
        expect(kingdom).toHaveProperty('name');
        expect(kingdom).toHaveProperty('territory');
        expect(kingdom).toHaveProperty('capital');
        expect(kingdom).toHaveProperty('treasury');
        expect(kingdom).toHaveProperty('isAlive');
        expect(Array.isArray(kingdom.territory)).toBe(true);
        expect(kingdom.isAlive).toBe(true);
    });

    it('create: initializes treasury in range', () => {
        const template = Kingdom.DEFAULTS[0];
        for (let i = 0; i < 20; i++) {
            const kingdom = Kingdom.create(template);
            expect(kingdom.treasury).toBeGreaterThanOrEqual(500);
            expect(kingdom.treasury).toBeLessThanOrEqual(2000);
        }
    });

    it('generateCityName: returns string', () => {
        const name = Kingdom.generateCityName('Imperial');
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
    });

    it('generateCityName: works for all cultures', () => {
        const cultures = ['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime'];
        for (const culture of cultures) {
            const name = Kingdom.generateCityName(culture);
            expect(typeof name).toBe('string');
            expect(name.length).toBeGreaterThan(0);
        }
    });

    it('generateRulerName: returns formatted name', () => {
        const name = Kingdom.generateRulerName('Imperial');
        expect(typeof name).toBe('string');
        const parts = name.split(' ');
        expect(parts.length).toBeGreaterThanOrEqual(3);
    });

    it('initRelations: sets up bilateral relations', () => {
        const kingdoms = Kingdom.DEFAULTS.slice(0, 3).map(d => Kingdom.create(d));
        Kingdom.initRelations(kingdoms);
        for (const k of kingdoms) {
            expect(Object.keys(k.relations).length).toBeGreaterThanOrEqual(2);
            for (const [id, val] of Object.entries(k.relations)) {
                expect(val).toBeGreaterThanOrEqual(-30);
                expect(val).toBeLessThanOrEqual(30);
            }
        }
    });
});

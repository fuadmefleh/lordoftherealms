import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    DataLoader.clearCache();
    DataLoader._gamedata = null;
    await DataLoader.initializeAll();
});

describe('DataLoader', () => {
    it('loads terrain.json successfully', async () => {
        const data = await DataLoader.load('terrain.json');
        expect(data).toBeTruthy();
        expect(data).toHaveProperty('types');
        expect(data).toHaveProperty('resources');
        expect(data).toHaveProperty('resourceChances');
        expect(data).toHaveProperty('biomeTable');
    });

    it('loads kingdoms.json successfully', async () => {
        const data = await DataLoader.load('kingdoms.json');
        expect(data.defaults).toBeTruthy();
        expect(Array.isArray(data.defaults)).toBe(true);
        expect(data.defaults.length).toBeGreaterThanOrEqual(5);
    });

    it('loads characters.json successfully', async () => {
        const data = await DataLoader.load('characters.json');
        expect(data).toHaveProperty('firstNames');
        expect(data).toHaveProperty('dynastyNames');
        expect(data).toHaveProperty('rulerTraits');
        expect(data).toHaveProperty('advisorRoles');
        expect(data).toHaveProperty('characterEvents');
    });

    it('loadAll: loads multiple files', async () => {
        const results = await DataLoader.loadAll(['terrain.json', 'kingdoms.json']);
        expect(results).toHaveProperty('terrain.json');
        expect(results).toHaveProperty('kingdoms.json');
    });

    it('caching: returns same object on second load', async () => {
        const first = await DataLoader.load('terrain.json');
        const second = await DataLoader.load('terrain.json');
        expect(first).toBe(second);
    });

    it('processInfinityFields: converts null to Infinity', () => {
        const obj = { moveCost: null, name: 'test', nested: { moveCost: null } };
        DataLoader.processInfinityFields(obj);
        expect(obj.moveCost).toBe(Infinity);
        expect(obj.nested.moveCost).toBe(Infinity);
        expect(obj.name).toBe('test');
    });

    it('clearCache: empties the cache', async () => {
        await DataLoader.load('terrain.json');
        expect(Object.keys(DataLoader._cache).length).toBeGreaterThan(0);
        DataLoader.clearCache();
        expect(Object.keys(DataLoader._cache).length).toBe(0);
    });
});

describe('JSON Data Integrity — Terrain', () => {
    it('terrain types: all have required fields', async () => {
        const data = await DataLoader.load('terrain.json');
        for (const [key, type] of Object.entries(data.types)) {
            expect(type).toHaveProperty('id');
            expect(type).toHaveProperty('name');
            expect(type).toHaveProperty('color');
            expect(type).toHaveProperty('passable');
            expect(type).toHaveProperty('icon');
            expect(typeof type.passable).toBe('boolean');
        }
    });

    it('terrain types: at least 20 terrain types', async () => {
        const data = await DataLoader.load('terrain.json');
        expect(Object.keys(data.types).length).toBeGreaterThanOrEqual(20);
    });

    it('resources: all have required fields', async () => {
        const data = await DataLoader.load('terrain.json');
        for (const [key, res] of Object.entries(data.resources)) {
            expect(res).toHaveProperty('id');
            expect(res).toHaveProperty('name');
            expect(res).toHaveProperty('icon');
        }
    });

    it('biome table: 6x6 grid', async () => {
        const data = await DataLoader.load('terrain.json');
        expect(data.biomeTable).toHaveLength(6);
        for (const row of data.biomeTable) {
            expect(row).toHaveLength(6);
        }
    });

    it('biome table: all entries are valid terrain keys', async () => {
        const data = await DataLoader.load('terrain.json');
        const validKeys = new Set(Object.keys(data.types));
        for (const row of data.biomeTable) {
            for (const biome of row) {
                expect(validKeys.has(biome)).toBe(true);
            }
        }
    });
});

describe('JSON Data Integrity — Kingdoms', () => {
    it('kingdom defaults: all have required fields', async () => {
        const data = await DataLoader.load('kingdoms.json');
        for (const kingdom of data.defaults) {
            expect(kingdom).toHaveProperty('id');
            expect(kingdom).toHaveProperty('name');
            expect(kingdom).toHaveProperty('ruler');
            expect(kingdom).toHaveProperty('color');
            expect(kingdom).toHaveProperty('culture');
            expect(kingdom).toHaveProperty('preferredTerrain');
            expect(Array.isArray(kingdom.preferredTerrain)).toBe(true);
        }
    });

    it('city names: all cultures have entries', async () => {
        const data = await DataLoader.load('kingdoms.json');
        const cultures = ['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime'];
        for (const culture of cultures) {
            expect(data.cityNames).toHaveProperty(culture);
            expect(data.cityNames[culture].length).toBeGreaterThanOrEqual(10);
        }
    });
});

describe('JSON Data Integrity — Characters', () => {
    it('first names: all cultures have male and female', async () => {
        const data = await DataLoader.load('characters.json');
        const cultures = ['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime'];
        for (const culture of cultures) {
            expect(data.firstNames).toHaveProperty(culture);
            expect(data.firstNames[culture]).toHaveProperty('male');
            expect(data.firstNames[culture]).toHaveProperty('female');
            expect(data.firstNames[culture].male.length).toBeGreaterThanOrEqual(10);
            expect(data.firstNames[culture].female.length).toBeGreaterThanOrEqual(10);
        }
    });

    it('ruler traits: positive, negative, and neutral', async () => {
        const data = await DataLoader.load('characters.json');
        const categories = Object.values(data.rulerTraits).map(t => t.category);
        expect(categories).toContain('positive');
        expect(categories).toContain('negative');
        expect(categories).toContain('neutral');
    });

    it('advisor roles: all have bonuses', async () => {
        const data = await DataLoader.load('characters.json');
        for (const [key, role] of Object.entries(data.advisorRoles)) {
            expect(role).toHaveProperty('bonuses');
            expect(role).toHaveProperty('primarySkill');
        }
    });
});

describe('JSON Data Integrity — Economy', () => {
    it('production rates: all settlement types', async () => {
        const data = await DataLoader.load('economy.json');
        expect(data.productionRates).toHaveProperty('capital');
        expect(data.productionRates).toHaveProperty('city');
        expect(data.productionRates).toHaveProperty('town');
        expect(data.productionRates).toHaveProperty('village');
    });

    it('resource bonuses: all have numeric values', async () => {
        const data = await DataLoader.load('economy.json');
        for (const [res, bonuses] of Object.entries(data.resourceBonuses)) {
            for (const [key, val] of Object.entries(bonuses)) {
                expect(typeof val).toBe('number');
                expect(val).toBeGreaterThan(0);
            }
        }
    });
});

describe('JSON Data Integrity — Quests', () => {
    it('quest templates: all have required structure', async () => {
        const data = await DataLoader.load('quests.json');
        const templates = data.questTemplates || data;
        for (const [key, quest] of Object.entries(templates)) {
            expect(quest).toHaveProperty('id');
            expect(quest).toHaveProperty('title');
            expect(quest).toHaveProperty('type');
            expect(quest).toHaveProperty('objectives');
            expect(quest).toHaveProperty('rewards');
            expect(Array.isArray(quest.objectives)).toBe(true);
        }
    });
});

describe('JSON Data Integrity — Military', () => {
    it('unit types: all have cost and strength', async () => {
        const data = await DataLoader.load('military.json');
        for (const [key, unit] of Object.entries(data.unitTypes)) {
            expect(unit).toHaveProperty('id');
            expect(unit).toHaveProperty('name');
        }
    });
});

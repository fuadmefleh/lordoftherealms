// ============================================
// TESTS — Data loading and JSON integrity
// ============================================

TestRunner.describe('DataLoader', async function () {
    await TestRunner.it('loads terrain.json successfully', async () => {
        const data = await DataLoader.load('terrain.json');
        assert.ok(data, 'Data should be loaded');
        assert.hasProperty(data, 'types');
        assert.hasProperty(data, 'resources');
        assert.hasProperty(data, 'resourceChances');
        assert.hasProperty(data, 'biomeTable');
    });

    await TestRunner.it('loads kingdoms.json successfully', async () => {
        const data = await DataLoader.load('kingdoms.json');
        assert.ok(data.defaults);
        assert.isArray(data.defaults);
        assert.ok(data.defaults.length >= 5, 'Should have at least 5 kingdoms');
    });

    await TestRunner.it('loads characters.json successfully', async () => {
        const data = await DataLoader.load('characters.json');
        assert.hasProperty(data, 'firstNames');
        assert.hasProperty(data, 'dynastyNames');
        assert.hasProperty(data, 'rulerTraits');
        assert.hasProperty(data, 'advisorRoles');
        assert.hasProperty(data, 'characterEvents');
    });

    await TestRunner.it('loadAll: loads multiple files', async () => {
        const results = await DataLoader.loadAll(['terrain.json', 'kingdoms.json']);
        assert.hasProperty(results, 'terrain.json');
        assert.hasProperty(results, 'kingdoms.json');
    });

    await TestRunner.it('caching: returns same object on second load', async () => {
        const first = await DataLoader.load('terrain.json');
        const second = await DataLoader.load('terrain.json');
        assert.equal(first, second, 'Should return cached instance');
    });

    await TestRunner.it('processInfinityFields: converts null to Infinity', () => {
        const obj = { moveCost: null, name: 'test', nested: { moveCost: null } };
        DataLoader.processInfinityFields(obj);
        assert.equal(obj.moveCost, Infinity);
        assert.equal(obj.nested.moveCost, Infinity);
        assert.equal(obj.name, 'test');
    });

    await TestRunner.it('clearCache: empties the cache', async () => {
        await DataLoader.load('terrain.json');
        assert.ok(Object.keys(DataLoader._cache).length > 0);
        DataLoader.clearCache();
        assert.equal(Object.keys(DataLoader._cache).length, 0);
    });
});

TestRunner.describe('JSON Data Integrity — Terrain', async function () {
    await TestRunner.it('terrain types: all have required fields', async () => {
        const data = await DataLoader.load('terrain.json');
        for (const [key, type] of Object.entries(data.types)) {
            assert.hasProperty(type, 'id', `${key} missing id`);
            assert.hasProperty(type, 'name', `${key} missing name`);
            assert.hasProperty(type, 'color', `${key} missing color`);
            assert.hasProperty(type, 'passable', `${key} missing passable`);
            assert.hasProperty(type, 'icon', `${key} missing icon`);
            assert.isType(type.passable, 'boolean', `${key} passable should be boolean`);
        }
    });

    await TestRunner.it('terrain types: at least 20 terrain types', async () => {
        const data = await DataLoader.load('terrain.json');
        const count = Object.keys(data.types).length;
        assert.ok(count >= 20, `Expected >= 20 terrain types, got ${count}`);
    });

    await TestRunner.it('resources: all have required fields', async () => {
        const data = await DataLoader.load('terrain.json');
        for (const [key, res] of Object.entries(data.resources)) {
            assert.hasProperty(res, 'id', `${key} missing id`);
            assert.hasProperty(res, 'name', `${key} missing name`);
            assert.hasProperty(res, 'icon', `${key} missing icon`);
        }
    });

    await TestRunner.it('biome table: 6x6 grid', async () => {
        const data = await DataLoader.load('terrain.json');
        assert.lengthOf(data.biomeTable, 6, 'Should have 6 heat levels');
        for (const row of data.biomeTable) {
            assert.lengthOf(row, 6, 'Each row should have 6 moisture levels');
        }
    });

    await TestRunner.it('biome table: all entries are valid terrain keys', async () => {
        const data = await DataLoader.load('terrain.json');
        const validKeys = new Set(Object.keys(data.types));
        for (const row of data.biomeTable) {
            for (const biome of row) {
                assert.ok(validKeys.has(biome), `Invalid biome "${biome}" in biome table`);
            }
        }
    });
});

TestRunner.describe('JSON Data Integrity — Kingdoms', async function () {
    await TestRunner.it('kingdom defaults: all have required fields', async () => {
        const data = await DataLoader.load('kingdoms.json');
        for (const kingdom of data.defaults) {
            assert.hasProperty(kingdom, 'id');
            assert.hasProperty(kingdom, 'name');
            assert.hasProperty(kingdom, 'ruler');
            assert.hasProperty(kingdom, 'color');
            assert.hasProperty(kingdom, 'culture');
            assert.hasProperty(kingdom, 'preferredTerrain');
            assert.isArray(kingdom.preferredTerrain);
        }
    });

    await TestRunner.it('city names: all cultures have entries', async () => {
        const data = await DataLoader.load('kingdoms.json');
        const cultures = ['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime'];
        for (const culture of cultures) {
            assert.hasProperty(data.cityNames, culture, `Missing city names for ${culture}`);
            assert.ok(data.cityNames[culture].length >= 10, `${culture} should have at least 10 city names`);
        }
    });
});

TestRunner.describe('JSON Data Integrity — Characters', async function () {
    await TestRunner.it('first names: all cultures have male and female', async () => {
        const data = await DataLoader.load('characters.json');
        const cultures = ['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime'];
        for (const culture of cultures) {
            assert.hasProperty(data.firstNames, culture, `Missing names for ${culture}`);
            assert.hasProperty(data.firstNames[culture], 'male');
            assert.hasProperty(data.firstNames[culture], 'female');
            assert.ok(data.firstNames[culture].male.length >= 10);
            assert.ok(data.firstNames[culture].female.length >= 10);
        }
    });

    await TestRunner.it('ruler traits: positive, negative, and neutral', async () => {
        const data = await DataLoader.load('characters.json');
        const categories = Object.values(data.rulerTraits).map(t => t.category);
        assert.includes(categories, 'positive');
        assert.includes(categories, 'negative');
        assert.includes(categories, 'neutral');
    });

    await TestRunner.it('advisor roles: all have bonuses', async () => {
        const data = await DataLoader.load('characters.json');
        for (const [key, role] of Object.entries(data.advisorRoles)) {
            assert.hasProperty(role, 'bonuses', `${key} missing bonuses`);
            assert.hasProperty(role, 'primarySkill', `${key} missing primarySkill`);
        }
    });
});

TestRunner.describe('JSON Data Integrity — Economy', async function () {
    await TestRunner.it('production rates: all settlement types', async () => {
        const data = await DataLoader.load('economy.json');
        assert.hasProperty(data.productionRates, 'capital');
        assert.hasProperty(data.productionRates, 'city');
        assert.hasProperty(data.productionRates, 'town');
        assert.hasProperty(data.productionRates, 'village');
    });

    await TestRunner.it('resource bonuses: all have numeric values', async () => {
        const data = await DataLoader.load('economy.json');
        for (const [res, bonuses] of Object.entries(data.resourceBonuses)) {
            for (const [key, val] of Object.entries(bonuses)) {
                assert.isType(val, 'number', `${res}.${key} should be number`);
                assert.ok(val > 0, `${res}.${key} should be positive`);
            }
        }
    });
});

TestRunner.describe('JSON Data Integrity — Quests', async function () {
    await TestRunner.it('quest templates: all have required structure', async () => {
        const data = await DataLoader.load('quests.json');
        const templates = data.questTemplates || data;
        for (const [key, quest] of Object.entries(templates)) {
            assert.hasProperty(quest, 'id', `${key} missing id`);
            assert.hasProperty(quest, 'title', `${key} missing title`);
            assert.hasProperty(quest, 'type', `${key} missing type`);
            assert.hasProperty(quest, 'objectives', `${key} missing objectives`);
            assert.hasProperty(quest, 'rewards', `${key} missing rewards`);
            assert.isArray(quest.objectives, `${key} objectives should be array`);
        }
    });
});

TestRunner.describe('JSON Data Integrity — Military', async function () {
    await TestRunner.it('unit types: all have cost and strength', async () => {
        const data = await DataLoader.load('military.json');
        for (const [key, unit] of Object.entries(data.unitTypes)) {
            assert.hasProperty(unit, 'id', `${key} missing id`);
            assert.hasProperty(unit, 'name', `${key} missing name`);
            assert.hasProperty(unit, 'cost', `${key} missing cost`);
            assert.hasProperty(unit, 'strength', `${key} missing strength`);
            assert.ok(unit.cost > 0, `${key} cost should be positive`);
        }
    });

    await TestRunner.it('contract types: all have payment and duration', async () => {
        const data = await DataLoader.load('military.json');
        for (const [key, contract] of Object.entries(data.contractTypes)) {
            assert.hasProperty(contract, 'id', `${key} missing id`);
            assert.hasProperty(contract, 'payment', `${key} missing payment`);
            assert.hasProperty(contract, 'duration', `${key} missing duration`);
        }
    });
});

TestRunner.describe('JSON Data Integrity — Technology', async function () {
    await TestRunner.it('tech tree: all techs have required fields', async () => {
        const data = await DataLoader.load('technology.json');
        assert.ok(data.TECHS, 'techs should exist');
        const techEntries = Object.entries(data.TECHS);
        assert.ok(techEntries.length >= 20, `Expected >= 20 techs, got ${techEntries.length}`);
        for (const [key, tech] of techEntries) {
            assert.hasProperty(tech, 'id', `${key} missing id`);
            assert.hasProperty(tech, 'name', `${key} missing name`);
            assert.hasProperty(tech, 'category', `${key} missing category`);
        }
    });
});

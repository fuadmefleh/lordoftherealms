// ============================================
// TESTS — Kingdom module
// ============================================

TestRunner.describe('Kingdom', async function () {
    await TestRunner.it('DEFAULTS: loaded from JSON', () => {
        assert.ok(Kingdom.DEFAULTS, 'DEFAULTS should be defined');
        assert.isArray(Kingdom.DEFAULTS);
        assert.ok(Kingdom.DEFAULTS.length >= 5);
    });

    await TestRunner.it('create: returns kingdom with required properties', () => {
        const template = Kingdom.DEFAULTS[0];
        const kingdom = Kingdom.create(template);
        assert.hasProperty(kingdom, 'id');
        assert.hasProperty(kingdom, 'name');
        assert.hasProperty(kingdom, 'territory');
        assert.hasProperty(kingdom, 'capital');
        assert.hasProperty(kingdom, 'treasury');
        assert.hasProperty(kingdom, 'isAlive');
        assert.isArray(kingdom.territory);
        assert.equal(kingdom.isAlive, true);
    });

    await TestRunner.it('create: initializes treasury in range', () => {
        const template = Kingdom.DEFAULTS[0];
        for (let i = 0; i < 20; i++) {
            const kingdom = Kingdom.create(template);
            assert.ok(kingdom.treasury >= 500 && kingdom.treasury <= 2000,
                `Treasury ${kingdom.treasury} out of range`);
        }
    });

    await TestRunner.it('generateCityName: returns string', () => {
        const name = Kingdom.generateCityName('Imperial');
        assert.isType(name, 'string');
        assert.ok(name.length > 0);
    });

    await TestRunner.it('generateCityName: works for all cultures', () => {
        const cultures = ['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime'];
        for (const culture of cultures) {
            const name = Kingdom.generateCityName(culture);
            assert.isType(name, 'string', `${culture} should produce a name`);
            assert.ok(name.length > 0, `${culture} name should not be empty`);
        }
    });

    await TestRunner.it('generateRulerName: returns formatted name', () => {
        const name = Kingdom.generateRulerName('Imperial');
        assert.isType(name, 'string');
        // Should have at least "Title Name Epithet"
        const parts = name.split(' ');
        assert.ok(parts.length >= 3, `Expected at least 3 words, got "${name}"`);
    });

    await TestRunner.it('initRelations: sets up bilateral relations', () => {
        const kingdoms = Kingdom.DEFAULTS.slice(0, 3).map(d => Kingdom.create(d));
        Kingdom.initRelations(kingdoms);
        for (const k of kingdoms) {
            assert.ok(Object.keys(k.relations).length >= 2, 'Should have relations with other kingdoms');
            for (const [id, val] of Object.entries(k.relations)) {
                assert.ok(val >= -30 && val <= 30, `Relation ${val} out of range`);
            }
        }
    });
});

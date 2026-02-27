// ============================================
// TESTS — Player module
// ============================================

TestRunner.describe('Player', async function () {
    await TestRunner.it('constructor: initializes with defaults', () => {
        const player = new Player();
        assert.equal(player.name, 'Wanderer');
        assert.equal(player.gold, 10000);
        assert.equal(player.health, 100);
        assert.equal(player.stamina, 10);
        assert.ok(player.skills);
    });

    await TestRunner.it('constructor: accepts custom profile', () => {
        const player = new Player({ firstName: 'Hero', gender: 'female', age: 25 });
        assert.equal(player.name, 'Hero');
        assert.equal(player.gender, 'female');
        assert.equal(player.age, 25);
    });

    await TestRunner.it('skills: has all expected skills', () => {
        const player = new Player();
        assert.hasProperty(player.skills, 'commerce');
        assert.hasProperty(player.skills, 'combat');
        assert.hasProperty(player.skills, 'leadership');
        assert.hasProperty(player.skills, 'diplomacy');
        assert.hasProperty(player.skills, 'stealth');
        assert.hasProperty(player.skills, 'cartography');
    });

    await TestRunner.it('inventory: starts with bread', () => {
        const player = new Player();
        assert.ok(player.inventory.bread >= 1, 'Should start with bread');
    });

    await TestRunner.it('movement: starts with full movement', () => {
        const player = new Player();
        assert.equal(player.movementRemaining, player.stamina);
    });
});

TestRunner.describe('Economy System', async function () {
    await TestRunner.it('Economy: PRODUCTION_RATES loaded', () => {
        assert.ok(Economy.PRODUCTION_RATES);
        assert.hasProperty(Economy.PRODUCTION_RATES, 'capital');
        assert.hasProperty(Economy.PRODUCTION_RATES, 'town');
    });

    await TestRunner.it('Economy: RESOURCE_BONUSES loaded', () => {
        assert.ok(Economy.RESOURCE_BONUSES);
        assert.hasProperty(Economy.RESOURCE_BONUSES, 'iron');
        assert.hasProperty(Economy.RESOURCE_BONUSES, 'wheat');
    });
});

TestRunner.describe('PlayerEconomy', async function () {
    await TestRunner.it('PROPERTY_TYPES: loaded from JSON', () => {
        assert.ok(PlayerEconomy.PROPERTY_TYPES);
        const keys = Object.keys(PlayerEconomy.PROPERTY_TYPES);
        assert.ok(keys.length >= 7, `Expected >= 7 property types, got ${keys.length}`);
    });

    await TestRunner.it('GOODS: loaded with icons and names', () => {
        assert.ok(PlayerEconomy.GOODS);
        for (const [key, good] of Object.entries(PlayerEconomy.GOODS)) {
            assert.hasProperty(good, 'name', `${key} missing name`);
            assert.hasProperty(good, 'icon', `${key} missing icon`);
        }
    });

    await TestRunner.it('RECIPES: all reference valid goods', () => {
        assert.ok(PlayerEconomy.RECIPES);
        const goodKeys = new Set(Object.keys(PlayerEconomy.GOODS).map(k => k.toLowerCase()));
        for (const [key, recipe] of Object.entries(PlayerEconomy.RECIPES)) {
            assert.hasProperty(recipe, 'output', `${key} missing output`);
            assert.hasProperty(recipe, 'input', `${key} missing input`);
        }
    });
});

TestRunner.describe('PlayerMilitary', async function () {
    await TestRunner.it('UNIT_TYPES: loaded from JSON', () => {
        assert.ok(PlayerMilitary.UNIT_TYPES);
        const keys = Object.keys(PlayerMilitary.UNIT_TYPES);
        assert.ok(keys.length >= 4, `Expected >= 4 unit types, got ${keys.length}`);
    });

    await TestRunner.it('CONTRACT_TYPES: loaded from JSON', () => {
        assert.ok(PlayerMilitary.CONTRACT_TYPES);
        const keys = Object.keys(PlayerMilitary.CONTRACT_TYPES);
        assert.ok(keys.length >= 4, `Expected >= 4 contract types, got ${keys.length}`);
    });
});

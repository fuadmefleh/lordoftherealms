// ============================================
// TESTS — Game systems (Religion, Culture, Technology, etc.)
// ============================================

TestRunner.describe('Religion', async function () {
    await TestRunner.it('FAITHS: loaded from JSON', () => {
        assert.ok(Religion.FAITHS);
        const keys = Object.keys(Religion.FAITHS);
        assert.ok(keys.length >= 5, `Expected >= 5 faiths, got ${keys.length}`);
    });

    await TestRunner.it('FAITHS: each has required fields', () => {
        for (const [key, faith] of Object.entries(Religion.FAITHS)) {
            assert.hasProperty(faith, 'id', `${key} missing id`);
            assert.hasProperty(faith, 'name', `${key} missing name`);
            assert.hasProperty(faith, 'icon', `${key} missing icon`);
        }
    });

    await TestRunner.it('KINGDOM_FAITHS: maps kingdom to faith', () => {
        assert.ok(Religion.KINGDOM_FAITHS);
    });
});

TestRunner.describe('Culture', async function () {
    await TestRunner.it('BUILDING_TYPES: loaded from JSON', () => {
        assert.ok(Culture.BUILDING_TYPES);
        const keys = Object.keys(Culture.BUILDING_TYPES);
        assert.ok(keys.length >= 4, `Expected >= 4 building types, got ${keys.length}`);
    });

    await TestRunner.it('TRADITIONS: loaded from JSON', () => {
        assert.ok(Culture.TRADITIONS);
    });
});

TestRunner.describe('Technology', async function () {
    await TestRunner.it('TECHS: loaded from JSON', () => {
        assert.ok(Technology.TECHS);
        const keys = Object.keys(Technology.TECHS);
        assert.ok(keys.length >= 20, `Expected >= 20 techs, got ${keys.length}`);
    });

    await TestRunner.it('CATEGORIES: loaded from JSON', () => {
        assert.ok(Technology.CATEGORIES);
    });

    await TestRunner.it('TECH_BUILDINGS: loaded with costs', () => {
        assert.ok(Technology.TECH_BUILDINGS);
        for (const [key, building] of Object.entries(Technology.TECH_BUILDINGS)) {
            assert.hasProperty(building, 'name', `${key} missing name`);
        }
    });
});

TestRunner.describe('Infrastructure', async function () {
    await TestRunner.it('TYPES: loaded from JSON', () => {
        assert.ok(Infrastructure.TYPES);
        const keys = Object.keys(Infrastructure.TYPES);
        assert.ok(keys.length >= 4, `Expected >= 4 types, got ${keys.length}`);
    });

    await TestRunner.it('TYPES: each has cost and description', () => {
        for (const [key, type] of Object.entries(Infrastructure.TYPES)) {
            assert.hasProperty(type, 'id', `${key} missing id`);
            assert.hasProperty(type, 'cost', `${key} missing cost`);
            assert.hasProperty(type, 'description', `${key} missing description`);
        }
    });
});

TestRunner.describe('Quests', async function () {
    await TestRunner.it('QUEST_TEMPLATES: loaded from JSON', () => {
        assert.ok(Quests.QUEST_TEMPLATES);
        const keys = Object.keys(Quests.QUEST_TEMPLATES);
        assert.ok(keys.length >= 10, `Expected >= 10 quest templates, got ${keys.length}`);
    });

    await TestRunner.it('QUEST_TEMPLATES: cover multiple categories', () => {
        const types = new Set();
        for (const quest of Object.values(Quests.QUEST_TEMPLATES)) {
            types.add(quest.type);
        }
        assert.ok(types.size >= 4, `Expected >= 4 quest categories, got ${types.size}`);
    });
});

TestRunner.describe('Achievements', async function () {
    await TestRunner.it('ACHIEVEMENTS: loaded from JSON', () => {
        assert.ok(Achievements.ACHIEVEMENTS);
    });
});

TestRunner.describe('Cartography', async function () {
    await TestRunner.it('QUALITY: loaded from JSON', () => {
        assert.ok(Cartography.QUALITY);
        assert.hasProperty(Cartography.QUALITY, 'crude');
        assert.hasProperty(Cartography.QUALITY, 'masterwork');
    });

    await TestRunner.it('MAP_TYPES: loaded from JSON', () => {
        assert.ok(Cartography.MAP_TYPES);
    });
});

TestRunner.describe('Colonization', async function () {
    await TestRunner.it('INDIGENOUS_TRIBES: loaded from JSON', () => {
        assert.ok(Colonization.INDIGENOUS_TRIBES);
    });

    await TestRunner.it('POLICIES: loaded from JSON', () => {
        assert.ok(Colonization.POLICIES);
        const keys = Object.keys(Colonization.POLICIES);
        assert.ok(keys.length >= 4, `Expected >= 4 policies, got ${keys.length}`);
    });
});

TestRunner.describe('KingdomAI', async function () {
    await TestRunner.it('PERSONALITIES: loaded from JSON', () => {
        assert.ok(KingdomAI.PERSONALITIES);
        const keys = Object.keys(KingdomAI.PERSONALITIES);
        assert.ok(keys.length >= 5, `Expected >= 5 personalities, got ${keys.length}`);
    });
});

TestRunner.describe('NPCLords', async function () {
    await TestRunner.it('TRAITS: loaded from JSON', () => {
        assert.ok(NPCLords.TRAITS);
        const keys = Object.keys(NPCLords.TRAITS);
        assert.ok(keys.length >= 8, `Expected >= 8 traits, got ${keys.length}`);
    });
});

TestRunner.describe('Tavern', async function () {
    await TestRunner.it('config constants: loaded from JSON', () => {
        assert.ok(Tavern.DRINK_COST > 0);
        assert.ok(Tavern.BRIBE_COST > 0);
        assert.ok(Tavern.MAX_RUMORS > 0);
    });

    await TestRunner.it('RELIABILITY: loaded from JSON', () => {
        assert.ok(Tavern.RELIABILITY);
    });
});

TestRunner.describe('Peoples', async function () {
    await TestRunner.it('TRIBAL_ROOTS: loaded from JSON', () => {
        assert.ok(Peoples.TRIBAL_ROOTS);
    });

    await TestRunner.it('EVOLUTION_STAGES: loaded from JSON', () => {
        assert.ok(Peoples.EVOLUTION_STAGES);
    });
});

TestRunner.describe('WorldEvents', async function () {
    await TestRunner.it('CATEGORIES: loaded from JSON', () => {
        assert.ok(WorldEvents.CATEGORIES);
        assert.hasProperty(WorldEvents.CATEGORIES, 'POLITICAL');
        assert.hasProperty(WorldEvents.CATEGORIES, 'MILITARY');
    });
});

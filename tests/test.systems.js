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

TestRunner.describe('BattleSystem', async function () {
    // Helper: mock player with army
    function makePlayer(units) {
        return {
            army: units,
            skills: { combat: 2, leadership: 2 },
            festivals: { moraleBoostDays: 0, moraleBoostValue: 0 },
        };
    }

    await TestRunner.it('createPlayerSquads: splits army by role', () => {
        const player = makePlayer([
            { type: 'knight', strength: 30, level: 1 },
            { type: 'archer', strength: 8, level: 1 },
            { type: 'soldier', strength: 10, level: 1 },
        ]);
        const squads = BattleSystem.createPlayerSquads(player);
        assert.ok(squads.length >= 2, `Expected >= 2 squads, got ${squads.length}`);
        assert.ok(squads.every(s => s.isPlayer), 'All squads should be player-owned');
        assert.ok(squads.every(s => s.strength > 0), 'All squads should have positive strength');
    });

    await TestRunner.it('createPlayerSquads: returns empty for no army', () => {
        const player = makePlayer([]);
        const squads = BattleSystem.createPlayerSquads(player);
        assert.lengthOf(squads, 0, 'Expected 0 squads for empty army');
    });

    await TestRunner.it('createEnemySquads: creates squads from strength', () => {
        const squads = BattleSystem.createEnemySquads(80, 'Raider Band', {});
        assert.ok(squads.length >= 1, 'Expected at least 1 enemy squad');
        assert.ok(squads.every(s => !s.isPlayer), 'All enemy squads should not be player-owned');
    });

    await TestRunner.it('_calcMoves: cavalry gets more moves', () => {
        const cavMoves = BattleSystem._calcMoves('cavalry', 2);
        const infMoves = BattleSystem._calcMoves('infantry', 2);
        assert.ok(cavMoves >= infMoves,
            `Cavalry should have >= infantry moves (cav=${cavMoves}, inf=${infMoves})`);
        assert.ok(cavMoves >= BattleSystem.MIN_MOVES, 'Cavalry moves should be >= MIN_MOVES');
        assert.ok(cavMoves <= BattleSystem.MAX_MOVES, 'Cavalry moves should be <= MAX_MOVES');
    });

    await TestRunner.it('_calcMoves: large squads move slower', () => {
        const small = BattleSystem._calcMoves('infantry', 2);
        const large = BattleSystem._calcMoves('infantry', 10);
        assert.ok(small >= large, 'Small squads should move at least as fast as large ones');
    });

    await TestRunner.it('getMovableHexes: returns valid positions', () => {
        const squad = BattleSystem._buildSquad('infantry', [{ type: 'soldier', strength: 10, level: 1 }], 2, 2, true);
        const hexes = BattleSystem.getMovableHexes(squad, [squad]);
        assert.ok(Array.isArray(hexes), 'Should return array');
        assert.ok(hexes.length > 0, 'Should return at least one movable hex');
        for (const h of hexes) {
            assert.ok(h.col >= 0 && h.col < BattleSystem.MAP_COLS, `col ${h.col} out of range`);
            assert.ok(h.row >= 0 && h.row < BattleSystem.MAP_ROWS, `row ${h.row} out of range`);
        }
    });

    await TestRunner.it('getMovableHexes: no moves if hasMoved', () => {
        const squad = BattleSystem._buildSquad('infantry', [{ type: 'soldier', strength: 10, level: 1 }], 2, 2, true);
        squad.hasMoved = true;
        const hexes = BattleSystem.getMovableHexes(squad, [squad]);
        assert.lengthOf(hexes, 0, 'hasMoved=true should return empty');
    });

    await TestRunner.it('resolveCombat: reduces defender strength', () => {
        const attacker = BattleSystem._buildSquad('cavalry', [{ type: 'knight', strength: 30, level: 1 }], 1, 3, true);
        const defender = BattleSystem._buildSquad('infantry', [{ type: 'soldier', strength: 10, level: 1 }], 2, 3, false);
        const allSquads = [attacker, defender];
        const before = defender.strength;
        BattleSystem.resolveCombat(attacker, defender, allSquads);
        assert.ok(defender.strength < before, 'Defender strength should decrease after combat');
    });

    await TestRunner.it('checkBattleEnd: detects player win', () => {
        const player = BattleSystem._buildSquad('cavalry', [{ type: 'knight', strength: 30, level: 1 }], 1, 3, true);
        const enemy  = BattleSystem._buildSquad('infantry', [{ type: 'soldier', strength: 10, level: 1 }], 7, 3, false);
        enemy.destroyed = true;
        assert.equal(BattleSystem.checkBattleEnd([player, enemy]), 'player_wins');
    });

    await TestRunner.it('checkBattleEnd: detects enemy win', () => {
        const player = BattleSystem._buildSquad('cavalry', [{ type: 'knight', strength: 30, level: 1 }], 1, 3, true);
        const enemy  = BattleSystem._buildSquad('infantry', [{ type: 'soldier', strength: 10, level: 1 }], 7, 3, false);
        player.destroyed = true;
        assert.equal(BattleSystem.checkBattleEnd([player, enemy]), 'enemy_wins');
    });

    await TestRunner.it('checkBattleEnd: returns null when both alive', () => {
        const player = BattleSystem._buildSquad('cavalry', [{ type: 'knight', strength: 30, level: 1 }], 1, 3, true);
        const enemy  = BattleSystem._buildSquad('infantry', [{ type: 'soldier', strength: 10, level: 1 }], 7, 3, false);
        assert.equal(BattleSystem.checkBattleEnd([player, enemy]), null);
    });

    await TestRunner.it('calcTacticalBonus: full strength = high bonus', () => {
        const squad = BattleSystem._buildSquad('cavalry', [{ type: 'knight', strength: 30, level: 1 }], 1, 3, true);
        const bonus = BattleSystem.calcTacticalBonus([squad]);
        assert.ok(bonus >= 1.0 && bonus <= 1.3, `Expected bonus in [1.0, 1.3], got ${bonus}`);
    });

    await TestRunner.it('calcTacticalBonus: destroyed squad = low bonus', () => {
        const squad = BattleSystem._buildSquad('cavalry', [{ type: 'knight', strength: 30, level: 1 }], 1, 3, true);
        squad.strength = 0;
        squad.destroyed = true;
        const bonus = BattleSystem.calcTacticalBonus([squad]);
        assert.ok(bonus >= 0.8 && bonus <= 1.0, `Expected bonus in [0.8, 1.0], got ${bonus}`);
    });
});

// ============================================
// TESTS — Terrain generation
// ============================================

TestRunner.describe('Terrain', async function () {
    await TestRunner.it('TYPES: loaded from JSON via DataLoader', () => {
        assert.ok(Terrain.TYPES, 'TYPES should be defined');
        assert.ok(Object.keys(Terrain.TYPES).length >= 20);
    });

    await TestRunner.it('TYPES: impassable terrains have Infinity moveCost', () => {
        for (const [key, type] of Object.entries(Terrain.TYPES)) {
            if (!type.passable && type.moveCost !== null) {
                assert.equal(type.moveCost, Infinity, `${key} should have Infinity moveCost`);
            }
        }
    });

    await TestRunner.it('RESOURCES: all have required fields', () => {
        assert.ok(Terrain.RESOURCES);
        for (const [key, res] of Object.entries(Terrain.RESOURCES)) {
            assert.hasProperty(res, 'id');
            assert.hasProperty(res, 'name');
            assert.hasProperty(res, 'icon');
        }
    });

    await TestRunner.it('generateMap: creates tile grid', () => {
        const tiles = Terrain.generateMap(20, 15, { riverCount: 0 });
        assert.lengthOf(tiles, 15, 'Should have 15 rows');
        assert.lengthOf(tiles[0], 20, 'Should have 20 columns');
    });

    await TestRunner.it('generateMap: all tiles have terrain property', () => {
        const tiles = Terrain.generateMap(20, 15, { riverCount: 0 });
        for (let r = 0; r < 15; r++) {
            for (let q = 0; q < 20; q++) {
                assert.hasProperty(tiles[r][q], 'terrain', `Tile (${q},${r}) missing terrain`);
                assert.hasProperty(tiles[r][q].terrain, 'id');
                assert.hasProperty(tiles[r][q].terrain, 'passable');
            }
        }
    });

    await TestRunner.it('generateMap: has both land and water', () => {
        const tiles = Terrain.generateMap(40, 30, { riverCount: 0 });
        let hasLand = false;
        let hasWater = false;
        for (let r = 0; r < 30; r++) {
            for (let q = 0; q < 40; q++) {
                if (tiles[r][q].terrain.passable) hasLand = true;
                else hasWater = true;
            }
        }
        assert.ok(hasLand, 'Map should have land tiles');
        assert.ok(hasWater, 'Map should have water tiles');
    });

    await TestRunner.it('rollResource: returns resource or null', () => {
        // Test a terrain type with high resource chance
        if (Terrain.rollResource) {
            const result = Terrain.rollResource('mountain');
            // It may or may not have a resource, but should not throw
            assert.ok(result === null || typeof result === 'object');
        }
    });
});

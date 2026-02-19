// ============================================
// TESTS — LocalMap generation logic
// ============================================

TestRunner.describe('LocalMap', async function () {
    await TestRunner.it('generateLocalTiles: returns correct grid dimensions', () => {
        const mockTile = { q: 5, r: 3, terrain: { id: 'plains', passable: true }, resource: null, improvement: null };
        const tiles = LocalMap.generateLocalTiles(mockTile);
        assert.lengthOf(tiles, LocalMap.ROWS, `Should have ${LocalMap.ROWS} rows`);
        assert.lengthOf(tiles[0], LocalMap.COLS, `Each row should have ${LocalMap.COLS} columns`);
    });

    await TestRunner.it('generateLocalTiles: all cells have terrain', () => {
        const mockTile = { q: 7, r: 2, terrain: { id: 'forest', passable: true }, resource: null, improvement: null };
        const tiles = LocalMap.generateLocalTiles(mockTile);
        for (let r = 0; r < LocalMap.ROWS; r++) {
            for (let q = 0; q < LocalMap.COLS; q++) {
                assert.ok(tiles[r][q].terrain, `Cell (${q},${r}) should have terrain`);
                assert.ok(tiles[r][q].terrain.id, `Cell (${q},${r}) terrain should have id`);
                assert.ok(tiles[r][q].terrain.color, `Cell (${q},${r}) terrain should have color`);
            }
        }
    });

    await TestRunner.it('generateLocalTiles: deterministic (same input → same output)', () => {
        const mockTile = { q: 12, r: 8, terrain: { id: 'hills', passable: true }, resource: null, improvement: null };
        const tiles1 = LocalMap.generateLocalTiles(mockTile);
        const tiles2 = LocalMap.generateLocalTiles(mockTile);
        for (let r = 0; r < LocalMap.ROWS; r++) {
            for (let q = 0; q < LocalMap.COLS; q++) {
                assert.equal(tiles1[r][q].terrain.id, tiles2[r][q].terrain.id,
                    `Cell (${q},${r}) terrain should be identical for same seed`);
            }
        }
    });

    await TestRunner.it('generateLocalTiles: different tiles produce different maps', () => {
        const tile1 = { q: 0, r: 0, terrain: { id: 'plains', passable: true }, resource: null, improvement: null };
        const tile2 = { q: 10, r: 10, terrain: { id: 'plains', passable: true }, resource: null, improvement: null };
        const tiles1 = LocalMap.generateLocalTiles(tile1);
        const tiles2 = LocalMap.generateLocalTiles(tile2);
        let different = false;
        for (let r = 0; r < LocalMap.ROWS && !different; r++) {
            for (let q = 0; q < LocalMap.COLS && !different; q++) {
                if (tiles1[r][q].terrain.id !== tiles2[r][q].terrain.id) different = true;
            }
        }
        assert.ok(different, 'Maps for different tile coords should differ');
    });

    await TestRunner.it('generateLocalTiles: POIs are placed', () => {
        const mockTile = { q: 3, r: 3, terrain: { id: 'forest', passable: true }, resource: null, improvement: null };
        const tiles = LocalMap.generateLocalTiles(mockTile);
        let poiCount = 0;
        for (let r = 0; r < LocalMap.ROWS; r++) {
            for (let q = 0; q < LocalMap.COLS; q++) {
                if (tiles[r][q].poi) poiCount++;
            }
        }
        assert.ok(poiCount >= 2, `Should place at least 2 POIs, found ${poiCount}`);
    });

    await TestRunner.it('generateLocalTiles: resource tile places resource POI', () => {
        const mockTile = {
            q: 5, r: 5,
            terrain: { id: 'mountain', passable: true },
            resource: { id: 'iron', name: 'Iron Deposits', icon: '⛏️' },
            improvement: null,
        };
        const tiles = LocalMap.generateLocalTiles(mockTile);
        const cq = Math.floor(LocalMap.COLS / 2);
        const cr = Math.floor(LocalMap.ROWS / 2) - 1;
        assert.ok(tiles[cr][cq].poi, 'Center tile should have a POI for the world resource');
        assert.ok(tiles[cr][cq].poi.icon === '⛏️', 'Resource POI should use the resource icon');
    });

    await TestRunner.it('generateLocalTiles: middle row is path terrain', () => {
        const mockTile = { q: 4, r: 6, terrain: { id: 'plains', passable: true }, resource: null, improvement: null };
        const tiles = LocalMap.generateLocalTiles(mockTile);
        const midRow = Math.floor(LocalMap.ROWS / 2);
        for (let q = 0; q < LocalMap.COLS; q++) {
            assert.equal(tiles[midRow][q].terrain.id, 'path',
                `Middle row cell (${q},${midRow}) should be path terrain`);
        }
    });

    await TestRunner.it('_seededRand: produces values in [0,1)', () => {
        const rand = LocalMap._seededRand(42);
        for (let i = 0; i < 100; i++) {
            const v = rand();
            assert.ok(v >= 0 && v < 1, `Value ${v} should be in [0,1)`);
        }
    });

    await TestRunner.it('_hexCenter: returns object with x and y', () => {
        const center = LocalMap._hexCenter(2, 3, 36);
        assert.ok(typeof center.x === 'number', 'Center x should be a number');
        assert.ok(typeof center.y === 'number', 'Center y should be a number');
    });

    await TestRunner.it('LOCAL_TERRAIN: all entries have required fields', () => {
        for (const [key, terrain] of Object.entries(LocalMap.LOCAL_TERRAIN)) {
            assert.ok(terrain.id, `Terrain ${key} should have id`);
            assert.ok(terrain.name, `Terrain ${key} should have name`);
            assert.ok(terrain.color, `Terrain ${key} should have color`);
            assert.ok(terrain.icon, `Terrain ${key} should have icon`);
            assert.ok(typeof terrain.passable === 'boolean', `Terrain ${key} should have passable boolean`);
        }
    });

    await TestRunner.it('POI_TYPES: all entries have required fields', () => {
        for (const [key, poi] of Object.entries(LocalMap.POI_TYPES)) {
            assert.ok(poi.id, `POI ${key} should have id`);
            assert.ok(poi.name, `POI ${key} should have name`);
            assert.ok(poi.icon, `POI ${key} should have icon`);
            assert.ok(poi.desc, `POI ${key} should have desc`);
        }
    });
});

/**
 * Grass 9-tile layer vs. settlement roads.
 *
 * The grass brush is auto-tiled at generation time. Settlement road data is
 * kept on the tiles array (tiles._settlementLayout), which JSON save/load
 * drops — enter() must not then carve a fresh road network through the
 * stamped grass, and any roads that do get added later must re-auto-tile the
 * grass so no hard-edged squares are left next to the dirt.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { InnerMap } from '../world/innerMap.js';
import { DataLoader } from '../core/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INNER_MAP_JSON = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../data/innerMap.json'), 'utf-8')
);

const makeGame = (worldTile) => ({
    world: { getTile: () => worldTile, season: 'Spring', day: 1 },
    player: {},
});

const makeWorldTile = () => ({
    terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5,
    settlement: { name: 'Testby', type: 'village', population: 300 },
});

const isGrass = (t) => !!(t.terrainDetail && t.terrainDetail.layer === 'grass');

// Every grass cell must carry the slot its final neighbourhood calls for.
const slotMismatches = (tiles, slots) => {
    const mask = tiles.map(row => row.map(isGrass));
    let bad = 0;
    for (let r = 0; r < tiles.length; r++) {
        for (let q = 0; q < tiles[r].length; q++) {
            if (!mask[r][q]) continue;
            const want = InnerMap._pickNineTileInfo(mask, q, r);
            if (JSON.stringify(want) !== JSON.stringify(slots.get(tiles[r][q]))) bad++;
        }
    }
    return bad;
};

let slots;
beforeEach(() => {
    InnerMap.initialize(JSON.parse(JSON.stringify(INNER_MAP_JSON)));
    InnerMap._cache = {};
    DataLoader._gamedata = { terrainNineTileBrushes: [] };
    // Record the slot each stamp writes so tests can check edge consistency
    slots = new Map();
    const orig = Object.getPrototypeOf(InnerMap)._stampNineTileMask || InnerMap._stampNineTileMask;
    InnerMap._stampNineTileMask = function (tiles, mask, brush, cat, onCell) {
        return orig.call(this, tiles, mask, brush, cat, (t, info) => {
            slots.set(t, info);
            if (onCell) onCell(t, info);
        });
    };
});

describe('InnerMap grass layer vs. roads', () => {
    it('keeps settlement roads after a save/load round-trip', () => {
        const worldTile = makeWorldTile();
        InnerMap.enter(makeGame(worldTile), 5, 6);
        const before = InnerMap.roads.map(r => `${r.q},${r.r}`).sort();
        expect(before.length).toBeGreaterThan(0);
        InnerMap.exit(makeGame(worldTile));

        InnerMap.deserialize(JSON.parse(JSON.stringify(InnerMap.serialize())));
        InnerMap.enter(makeGame(worldTile), 5, 6);
        const after = InnerMap.roads.map(r => `${r.q},${r.r}`).sort();
        expect(after).toEqual(before);
    });

    it('re-auto-tiles grass when roads are carved after generation', () => {
        const worldTile = makeWorldTile();
        const tiles = InnerMap.generate(worldTile, 5, 6, null);
        // Simulate a legacy save: no layout, no road flags → _generateRoads runs
        for (const row of tiles) for (const t of row) t.isRoad = false;
        delete tiles._settlementLayout;
        InnerMap._cache[`5,6_${InnerMap.width}x${InnerMap.height}`] = tiles;
        InnerMap.buildings = [];
        InnerMap.enter(makeGame(worldTile), 5, 6);
        // Force a road strip through the meadow, as _generateRoads would
        const mid = Math.floor(InnerMap.height / 2);
        for (let q = 5; q < 15; q++) tiles[mid][q].isRoad = true;
        InnerMap._refreshGrassLayer(tiles);

        for (const row of tiles) {
            for (const t of row) expect(t.isRoad && isGrass(t)).toBe(false);
        }
        expect(slotMismatches(tiles, slots)).toBe(0);
    });

    it('strips grass from tilled land and re-auto-tiles around it', () => {
        const tiles = InnerMap.generate(makeWorldTile(), 5, 6, null);
        const tilled = [];
        for (let q = 4; q < 7; q++) {
            for (let r = 4; r < 7; r++) {
                if (isGrass(tiles[r][q])) { tiles[r][q]._tilled = true; tilled.push(tiles[r][q]); }
            }
        }
        expect(tilled.length).toBeGreaterThan(0);
        expect(InnerMap._refreshGrassLayer(tiles)).toBe(true);
        for (const t of tilled) expect(isGrass(t)).toBe(false);
        expect(slotMismatches(tiles, slots)).toBe(0);
    });

    it('leaves water cells alone when refreshing grass', () => {
        const tiles = InnerMap.generate(makeWorldTile(), 5, 6, null);
        const cell = tiles.flat().find(t => isGrass(t) && !t.isRoad);
        cell.terrainDetail = { fillCategory: 'water', layer: 'water' };
        cell.isRoad = true;
        InnerMap._refreshGrassLayer(tiles);
        expect(cell.terrainDetail.layer).toBe('water');
    });
});

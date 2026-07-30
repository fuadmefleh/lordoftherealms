/**
 * Procedural inner-map water features (ponds) — spec:
 * docs/development/specs/2026-07-16-brush-impassable-water-design.md
 *
 * A water 9-tile brush (category 'water') with per-cell `impassable` flags is
 * stamped onto inner maps by InnerMap._paintWaterFeatures. Flagged slots become
 * blocked pond_water tiles; unflagged shore-edge slots stay walkable. Movement
 * (player step, A*, NPC spawn) reads tile.subTerrain.passable and needs no
 * water-specific logic — these tests exercise that whole chain.
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

// ── Test water brush ──
// Distinct sheet path so water tiles are identifiable; center + inside corners
// blocked (deep water), edge slots unflagged (walkable shore).
const WATER_SHEET = 'assets/test/pond.png';
const cell = (sx, sy, impassable) => {
    const c = { sheetPath: WATER_SHEET, sx, sy };
    if (impassable) c.impassable = true;
    return c;
};
const makeWaterBrush = () => ({
    id: 'ntb_test_pond',
    name: 'Test Pond',
    category: 'water',
    tiles: [
        [cell(0, 0), cell(32, 0), cell(64, 0)],
        [cell(0, 32), cell(32, 32, true), cell(64, 32)],
        [cell(0, 64), cell(32, 64), cell(64, 64)],
    ],
    insideCorners: [cell(96, 0, true), cell(128, 0, true), cell(96, 32, true), cell(128, 32, true)],
});

// Config clone with guaranteed water on grassland so tests are deterministic
// regardless of which rng draw the chance roll lands on.
const makeConfig = () => {
    const cfg = JSON.parse(JSON.stringify(INNER_MAP_JSON));
    cfg.subTerrains.grassland.waterFeatures = { chance: 1, count: [2, 3], size: [6, 12] };
    return cfg;
};

const WORLD_TILE = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };

const pondTiles = (tiles) => {
    const out = [];
    for (const row of tiles) {
        for (const t of row) {
            if (t.subTerrain.id === 'pond_water') out.push(t);
        }
    }
    return out;
};

beforeEach(() => {
    InnerMap.initialize(makeConfig());
    InnerMap._cache = {};
    InnerMap.season = 'spring';
    DataLoader._gamedata = { terrainNineTileBrushes: [makeWaterBrush()] };
});

describe('InnerMap water features — generation', () => {
    it('places blocked pond water tagged pond_water/baseTerrain water', () => {
        const tiles = InnerMap.generate(WORLD_TILE, 3, 4, null);
        const ponds = pondTiles(tiles);
        expect(ponds.length).toBeGreaterThan(0);
        for (const t of ponds) {
            expect(t.subTerrain.passable).toBe(false);
            expect(t.baseTerrain).toBe('water');
            expect(t.terrainDetail.sheetPath).toBe(WATER_SHEET);
        }
    });

    it('keeps shore-edge cells walkable (unflagged brush slots)', () => {
        const tiles = InnerMap.generate(WORLD_TILE, 3, 4, null);
        const shore = [];
        for (const row of tiles) {
            for (const t of row) {
                if (t.terrainDetail && t.terrainDetail.sheetPath === WATER_SHEET && t.subTerrain.passable) {
                    shore.push(t);
                }
            }
        }
        // Every pond has an auto-tiled rim of edge slots — all walkable
        expect(shore.length).toBeGreaterThan(0);
        for (const t of shore) expect(t.subTerrain.id).not.toBe('pond_water');
    });

    it('is deterministic for the same world coordinates', () => {
        const a = InnerMap.generate(WORLD_TILE, 3, 4, null);
        const b = InnerMap.generate(WORLD_TILE, 3, 4, null);
        const key = (tiles) => pondTiles(tiles).map(t => `${t.q},${t.r}`).join('|');
        expect(pondTiles(a).length).toBeGreaterThan(0);
        expect(key(a)).toBe(key(b));
    });

    it('never touches the map border or the player start tile', () => {
        const tiles = InnerMap.generate(WORLD_TILE, 3, 4, null);
        const W = InnerMap.width, H = InnerMap.height;
        for (const t of pondTiles(tiles)) {
            expect(t.q).toBeGreaterThanOrEqual(2);
            expect(t.q).toBeLessThanOrEqual(W - 3);
            expect(t.r).toBeGreaterThanOrEqual(2);
            expect(t.r).toBeLessThanOrEqual(H - 3);
        }
        const centerQ = Math.floor(W / 2), centerR = Math.floor(H / 2);
        expect(tiles[centerR][centerQ].subTerrain.passable).toBe(true);
    });

    it('generates no water without a waterFeatures config (desert)', () => {
        const tiles = InnerMap.generate({ ...WORLD_TILE, terrain: { id: 'desert' } }, 3, 4, null);
        expect(pondTiles(tiles)).toHaveLength(0);
    });

    it('generates no water when no water brush exists', () => {
        DataLoader._gamedata = { terrainNineTileBrushes: [] };
        const tiles = InnerMap.generate(WORLD_TILE, 3, 4, null);
        expect(pondTiles(tiles)).toHaveLength(0);
    });

    it('finds a water brush by name when category is missing (legacy data)', () => {
        const legacy = makeWaterBrush();
        delete legacy.category;
        legacy.name = 'Deep Lake';
        DataLoader._gamedata = { terrainNineTileBrushes: [legacy] };
        const tiles = InnerMap.generate(WORLD_TILE, 3, 4, null);
        expect(pondTiles(tiles).length).toBeGreaterThan(0);
    });
});

describe('InnerMap water features — brush slot flags', () => {
    it('reads impassable flags per slot (default + season grids)', () => {
        const brush = makeWaterBrush();
        expect(InnerMap._isBrushSlotImpassable(brush, { row: 1, col: 1 })).toBe(true);
        expect(InnerMap._isBrushSlotImpassable(brush, { row: 0, col: 1 })).toBe(false);
        expect(InnerMap._isBrushSlotImpassable(brush, { ic: 2 })).toBe(true);
        // Flag carried only on a season grid still counts
        const seasonal = makeWaterBrush();
        delete seasonal.tiles[1][1].impassable;
        seasonal.seasonTiles = { winter: [[null, null, null], [null, cell(0, 0, true), null], [null, null, null]] };
        expect(InnerMap._isBrushSlotImpassable(seasonal, { row: 1, col: 1 })).toBe(true);
    });

    it('unflagged brushes stamp fully walkable water (visual-only)', () => {
        const openBrush = makeWaterBrush();
        for (const row of openBrush.tiles) for (const c of row) delete c.impassable;
        openBrush.insideCorners.forEach(c => delete c.impassable);
        DataLoader._gamedata = { terrainNineTileBrushes: [openBrush] };
        const tiles = InnerMap.generate(WORLD_TILE, 3, 4, null);
        expect(pondTiles(tiles)).toHaveLength(0);
        // Visuals still stamped
        const stamped = tiles.flat().filter(t => t.terrainDetail && t.terrainDetail.sheetPath === WATER_SHEET);
        expect(stamped.length).toBeGreaterThan(0);
        for (const t of stamped) expect(t.subTerrain.passable).toBe(true);
    });
});

describe('InnerMap water features — movement integration', () => {
    let tiles;
    beforeEach(() => {
        tiles = InnerMap.generate(WORLD_TILE, 3, 4, null);
        InnerMap.tiles = tiles;
        InnerMap.currentWorldTile = { q: 3, r: 4 };
    });

    it('movePlayer refuses to step onto pond water', () => {
        const pond = pondTiles(tiles)[0];
        // Stand just left of the pond tile (any tile works for the refusal check)
        InnerMap.playerInnerQ = pond.q - 1;
        InnerMap.playerInnerR = pond.r;
        const before = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const result = InnerMap.movePlayer(1, 0);
        expect(result.moved).toBe(false);
        expect(InnerMap.playerInnerQ).toBe(before.q);
        expect(InnerMap.playerInnerR).toBe(before.r);
    });

    it('A* routes around ponds — path never crosses blocked water', () => {
        const ponds = pondTiles(tiles);
        // Bounding box of the first pond blob
        let minQ = Infinity, maxQ = -Infinity, row = ponds[0].r;
        for (const t of ponds) {
            if (t.r !== row) continue;
            minQ = Math.min(minQ, t.q);
            maxQ = Math.max(maxQ, t.q);
        }
        // Walk from a passable tile left of the pond to one right of it
        const findPassable = (q, r, dir) => {
            while (q > 0 && q < InnerMap.width - 1 && !tiles[r][q].subTerrain.passable) q += dir;
            return tiles[r][q].subTerrain.passable ? q : -1;
        };
        const startQ = findPassable(minQ - 2, row, -1);
        const endQ = findPassable(maxQ + 2, row, 1);
        expect(startQ).toBeGreaterThan(-1);
        expect(endQ).toBeGreaterThan(-1);
        const path = InnerMap._findPath(startQ, row, endQ, row);
        expect(path).not.toBeNull();
        // Straight line would be (endQ - startQ + 1) nodes; blocked water forces a detour
        expect(path.length).toBeGreaterThan(endQ - startQ + 1);
        for (const step of path) {
            expect(tiles[step.r][step.q].subTerrain.passable).toBe(true);
        }
    });

    it('NPC spawn never lands on pond water', () => {
        InnerMap._spawnNPCs({ type: 'village' });
        expect(InnerMap.npcs.length).toBeGreaterThan(0);
        for (const npc of InnerMap.npcs) {
            const t = tiles[npc.r] && tiles[npc.r][npc.q];
            if (!t) continue;
            expect(t.subTerrain.passable).toBe(true);
        }
    });
});

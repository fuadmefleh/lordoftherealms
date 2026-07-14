// ═══════════════════════════════════════════════════════════
//  INTERIOR GENERATOR — Procedural sprite-based interior rooms
//
//  Uses interior_floor / interior_wall brushes (with optional
//  buildingTags) to build properly bordered 9-tile rooms, and
//  places tagged custom objects inside them.
//
//  Entry point: generateSpriteInterior(building, seed)
//    Returns { tiles, width, height } or null if no brushes exist.
//
//  The caller is responsible for falling back to colored-box
//  rendering when null is returned.
// ═══════════════════════════════════════════════════════════

import { CustomInteriors } from './customInteriors.js';
import { CustomObjects }   from './customObjects.js';

// ─── Grid sizes per building type ───────────────────────────────
// [minW, maxW, minH, maxH]
const BUILDING_DIMS = {
    town_hall:   [12, 14, 9, 11],
    marketplace: [13, 16, 9, 11],
    tavern:      [10, 13, 8, 10],
    blacksmith:  [8,  11, 7,  9],
    church:      [9,  11, 11, 13],
    temple:      [11, 13, 11, 13],
    barracks:    [12, 14, 9, 11],
    house:       [7,  9,  6,  8],
    manor:       [13, 16, 11, 13],
    granary:     [7,  9,  7,  9],
    warehouse:   [11, 13, 9, 11],
    stable:      [9,  11, 7,  9],
    guard_tower: [5,  7,  7,  9],
    farm:        [7,  9,  5,  7],
    // defaults for unknown types
    _default:    [8,  12, 7, 10],
};

// ─── Object count hints per building type ───────────────────────
// [min, max]
const BUILDING_OBJECT_COUNTS = {
    town_hall:   [3, 5],
    marketplace: [4, 7],
    tavern:      [4, 6],
    blacksmith:  [2, 4],
    church:      [3, 5],
    temple:      [4, 6],
    barracks:    [3, 6],
    house:       [2, 4],
    manor:       [4, 7],
    granary:     [2, 4],
    warehouse:   [3, 5],
    stable:      [2, 4],
    guard_tower: [2, 3],
    farm:        [2, 3],
    _default:    [2, 4],
};

// ─── Seeded RNG ──────────────────────────────────────────────────
function makeRng(seed) {
    let s = 0;
    const str = String(seed);
    for (let i = 0; i < str.length; i++) s = ((s << 5) - s + str.charCodeAt(i)) | 0;
    s = s >>> 0 || 1;
    return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

function pickFromRange(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
}

function pickFromArray(rng, arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(rng() * arr.length)];
}

// ─── Main export ─────────────────────────────────────────────────
/**
 * Generate a sprite-based interior for a building.
 *
 * @param {Object} building  - Building object with .type, .q, .r, .name etc.
 * @param {string} seed      - Deterministic seed (e.g. interiorKey cache key).
 * @returns {{ tiles: Array[][], width: number, height: number } | null}
 *   Returns null when no interior_floor or interior_wall brushes exist,
 *   signalling the caller to fall back to colored-box rendering.
 */
export function generateSpriteInterior(building, seed) {
    const buildingType = (building.type || 'house').replace(/^player_/, '');

    // ── Gather brushes for this building type ──────────────────
    const floorBrushes = CustomInteriors.getBrushesForType(buildingType, 'interior_floor');
    const wallBrushes  = CustomInteriors.getBrushesForType(buildingType, 'interior_wall');

    // Need at least one brush to proceed
    if (floorBrushes.length === 0 && wallBrushes.length === 0) return null;

    const rng = makeRng(seed || `${buildingType}_${building.q}_${building.r}`);

    // ── Pick grid dimensions ────────────────────────────────────
    const dims = BUILDING_DIMS[buildingType] || BUILDING_DIMS._default;
    const w = pickFromRange(rng, dims[0], dims[1]);
    const h = pickFromRange(rng, dims[2], dims[3]);

    // ── Pick brushes ────────────────────────────────────────────
    const floorBrush = pickFromArray(rng, floorBrushes.length ? floorBrushes : null);
    const wallBrush  = pickFromArray(rng, wallBrushes.length  ? wallBrushes  : null);

    // Door position: bottom center (r = h-1, q = floor(w/2))
    const doorQ = Math.floor(w / 2);
    const doorR = h - 1;

    // ── Build cell classification ────────────────────────────────
    // wall = top row (r===0) + left/right columns (q===0 or q===w-1)
    // door = bottom-center tile
    // floor = everything else
    function isWallCell(q, r) {
        return r === 0 || q === 0 || q === w - 1;
    }
    function isDoorCell(q, r) {
        return q === doorQ && r === doorR;
    }

    // ── Build brushGroupMap for wall tiles ───────────────────────
    // All wall tiles share a single brushId so resolveNineTile connects them.
    const brushGroupMap = {};
    if (wallBrush) {
        for (let r = 0; r < h; r++) {
            for (let q = 0; q < w; q++) {
                if (isWallCell(q, r)) {
                    brushGroupMap[`${q},${r}`] = { brushId: wallBrush.id, layer: 'walls' };
                }
            }
        }
    }

    // ── Collect all sheet paths for preloading ───────────────────
    const sheetPaths = new Set();
    const collectBrushPaths = (brush) => {
        if (!brush) return;
        const collect = (t) => { if (t && t.sheetPath) sheetPaths.add(t.sheetPath); };
        if (brush.tiles) for (const row of brush.tiles) if (row) for (const t of row) collect(t);
        if (brush.insideCorners) for (const t of brush.insideCorners) collect(t);
        if (brush.corridors) for (const t of brush.corridors) collect(t);
        if (brush.endCaps) for (const t of brush.endCaps) collect(t);
    };
    collectBrushPaths(floorBrush);
    collectBrushPaths(wallBrush);

    // ── Build tile grid ──────────────────────────────────────────
    const tiles = [];
    const floorCenter = floorBrush && floorBrush.tiles &&
        floorBrush.tiles[1] && floorBrush.tiles[1][1];

    for (let r = 0; r < h; r++) {
        tiles[r] = [];
        for (let q = 0; q < w; q++) {
            const wall = isWallCell(q, r);
            const door = isDoorCell(q, r);

            const tile = {
                q, r,
                baseTerrain: wall ? 'wall' : 'interior_floor',
                subTerrain: wall ? {
                    id: 'wall', name: 'Wall', icon: '🧱', color: '#5a4a3a', passable: false
                } : {
                    id: 'interior_floor', name: 'Floor', icon: '🏠', color: '#8B7355', passable: true
                },
                explored: true,
                visible: true,
                parentTerrain: 'interior',
                encounter: null,
                building: null,
                _isInterior: true,
                _interiorBuildingType: buildingType,
                _furniture: null,
                effectiveTemp: 20,
                moisture: 0.3,
                weatherType: 'clear',
            };

            if (door) {
                tile.baseTerrain = 'interior_floor';
                tile.subTerrain = { id: 'door', name: 'Door', icon: '🚪', color: '#6a4a2a', passable: true };
                tile._isDoor = true;
            }

            // Attach sprite data
            if (wall && wallBrush) {
                const tileRef = CustomInteriors.resolveNineTile(wallBrush, q, r, brushGroupMap, w, h);
                if (tileRef) tile._customTile = { walls: tileRef };
            } else if (!wall && !door && floorBrush && floorCenter) {
                tile._customTile = { floor: floorCenter };
            }

            tiles[r][q] = tile;
        }
    }

    // ── Place tagged objects ─────────────────────────────────────
    const objDefs = CustomObjects.getObjectsForType(buildingType);
    if (objDefs.length > 0) {
        const counts = BUILDING_OBJECT_COUNTS[buildingType] || BUILDING_OBJECT_COUNTS._default;
        const objCount = pickFromRange(rng, counts[0], counts[1]);

        // Collect candidates: passable, non-door, not wall, not on first/last rows
        const candidates = [];
        for (let r = 1; r < h - 1; r++) {
            for (let q = 1; q < w - 1; q++) {
                if (!isWallCell(q, r) && !isDoorCell(q, r)) {
                    candidates.push({ q, r });
                }
            }
        }
        // Shuffle candidates
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
        }

        let placed = 0;
        for (const pos of candidates) {
            if (placed >= objCount) break;
            const tile = tiles[pos.r][pos.q];
            if (tile.customObject || tile.customObjectPart) continue;

            const def = pickFromArray(rng, objDefs);
            if (!def || !def.tiles || def.tiles.length === 0) continue;

            // Check footprint fits and is free
            const bounds = def.bounds || { minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 };
            let fits = true;
            for (const td of def.tiles) {
                const fq = pos.q + td.localCol;
                const fr = pos.r + td.localRow;
                if (fq <= 0 || fq >= w - 1 || fr <= 0 || fr >= h - 1) { fits = false; break; }
                if (isWallCell(fq, fr) || isDoorCell(fq, fr)) { fits = false; break; }
                if (tiles[fr][fq].customObject || tiles[fr][fq].customObjectPart) { fits = false; break; }
            }
            if (!fits) continue;

            // Collect sheet paths
            for (const td of def.tiles) if (td.sheetPath) sheetPaths.add(td.sheetPath);

            // Place anchor
            tile.customObject = { defId: def.id };
            tile.subTerrain = { ...tile.subTerrain, passable: false };

            // Mark footprint
            let metaLookup = null;
            if (Array.isArray(def.meta) && def.meta.length > 0) {
                metaLookup = {};
                for (const m of def.meta) metaLookup[`${m.localCol},${m.localRow}`] = m;
            }
            for (const td of def.tiles) {
                if (td.localRow === 0 && td.localCol === 0) continue;
                const fq = pos.q + td.localCol;
                const fr = pos.r + td.localRow;
                tiles[fr][fq].customObjectPart = { anchorQ: pos.q, anchorR: pos.r };
                const meta = metaLookup && metaLookup[`${td.localCol},${td.localRow}`];
                if (td.impassable || (meta && meta.impassable)) {
                    tiles[fr][fq].subTerrain.passable = false;
                }
            }

            placed++;
        }
    }

    // ── Kick off image preloads ──────────────────────────────────
    CustomInteriors.preloadPaths([...sheetPaths]);

    return { tiles, width: w, height: h };
}

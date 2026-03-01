/**
 * SettlementGenerator — Procedural settlement layout generator
 * 
 * Inspired by Pierre Vigier's Vagabond city generation:
 * https://pvigier.github.io/2020/03/15/vagabond-city-generation.html
 *
 * Algorithm overview:
 *  1. Place a civic seed at center (town hall / marketplace)
 *  2. Generate a road network: radial spokes + ring roads + cross streets
 *  3. Divide the road-bounded area into city blocks (parcels)
 *  4. Assign districts to parcels (civic, commercial, residential, farmland)
 *  5. Subdivide parcels into building lots
 *  6. Place buildings from the editor library onto lots
 *  7. Fill remaining space with decorations
 *
 * This module provides SettlementGenerator.generate(), called from
 * InnerMap.generate() to replace the old scatter-based placement.
 *
 * Depends on: CustomBuildings (optional), InnerMap.BUILDING_TYPES,
 *             InnerMap.SETTLEMENT_BUILDINGS
 */

import { CustomBuildings } from './customBuildings.js';
import { InnerMap } from './innerMap.js';

// ── District types ──────────────────────────────────────────
const DISTRICT = {
    CIVIC:       'civic',        // Town hall, church, barracks
    COMMERCIAL:  'commercial',   // Marketplace, tavern, blacksmith
    RESIDENTIAL: 'residential',  // Houses, manors
    FARM:        'farm',         // Farms, barns, granaries
    OPEN:        'open',         // Plazas, wells, decorations
};

// Which building types belong to each district
const DISTRICT_BUILDING_MAP = {
    [DISTRICT.CIVIC]:       ['town_hall', 'church', 'temple', 'barracks', 'guard_tower', 'manor'],
    [DISTRICT.COMMERCIAL]:  ['marketplace', 'tavern', 'blacksmith', 'warehouse', 'stable'],
    [DISTRICT.RESIDENTIAL]: ['house'],
    [DISTRICT.FARM]:        ['farm', 'barn', 'granary'],
    [DISTRICT.OPEN]:        ['well'],
};

// Settlement type → radius of the settlement area (in tiles from center)
const SETTLEMENT_RADIUS = {
    village:  22,
    town:     32,
    city:     42,
    capital:  52,
};

// Number of radial spoke roads per settlement type
const SPOKE_COUNT = {
    village:  3,
    town:     4,
    city:     6,
    capital:  8,
};

// Number of ring roads per settlement type
const RING_COUNT = {
    village:  1,
    town:     2,
    city:     3,
    capital:  4,
};

// Road widths per settlement type
const ROAD_WIDTH = {
    village:  1,
    town:     1,
    city:     2,
    capital:  2,
};

// ── Helper: seeded random angle jitter ──
function jitter(rng, amount) {
    return (rng() - 0.5) * 2 * amount;
}

// ── Helper: Bresenham-like thick line rasterizer ──
function rasterizeLine(x0, y0, x1, y1, width) {
    const tiles = [];
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0, cy = y0;
    const half = Math.floor(width / 2);
    const visited = new Set();
    while (true) {
        for (let tw = -half; tw <= half; tw++) {
            // Thicken perpendicular to the major axis
            let tq, tr;
            if (dx >= dy) {
                tq = cx; tr = cy + tw;
            } else {
                tq = cx + tw; tr = cy;
            }
            const k = `${tq},${tr}`;
            if (!visited.has(k)) {
                visited.add(k);
                tiles.push({ q: tq, r: tr });
            }
        }
        if (cx === x1 && cy === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; cx += sx; }
        if (e2 < dx)  { err += dx; cy += sy; }
    }
    return tiles;
}

// ══════════════════════════════════════════════════════════════
//  MAIN GENERATOR
// ══════════════════════════════════════════════════════════════

/**
 * Generate a settlement layout on the tile grid.
 *
 * @param {Array[][]} tiles    – 2D tile array from InnerMap.generate()
 * @param {Object}    settlement – { type, name, population }
 * @param {Function}  rng      – seeded random [0,1)
 * @param {number}    mapW     – map width (tiles[0].length)
 * @param {number}    mapH     – map height (tiles.length)
 */
function generate(tiles, settlement, rng, mapW, mapH) {
    const type = settlement.type || 'village';
    const pop  = settlement.population || 50;

    const cx = Math.floor(mapW / 2);
    const cy = Math.floor(mapH / 2);
    const radius = Math.min(SETTLEMENT_RADIUS[type] || 22, Math.floor(Math.min(mapW, mapH) / 2) - 2);

    // ── 1. Generate road network ──────────────────────────────
    const roadSet    = new Set();   // "q,r" → true
    const roadTiles  = [];          // [{q,r}, ...]
    const mainRoadW  = ROAD_WIDTH[type] || 1;
    const numSpokes  = SPOKE_COUNT[type] || 3;
    const numRings   = RING_COUNT[type]  || 1;

    // 1a. Radial spoke roads from center outward
    const spokeAngles = [];
    const baseAngle = rng() * Math.PI * 2; // random starting rotation
    for (let i = 0; i < numSpokes; i++) {
        const angle = baseAngle + (i / numSpokes) * Math.PI * 2 + jitter(rng, 0.15);
        spokeAngles.push(angle);

        // Spoke extends from ~4 tiles out to full radius
        const startD = 4;
        const endD   = radius + Math.floor(jitter(rng, 3));
        const x0 = cx + Math.round(Math.cos(angle) * startD);
        const y0 = cy + Math.round(Math.sin(angle) * startD);
        const x1 = cx + Math.round(Math.cos(angle) * endD);
        const y1 = cy + Math.round(Math.sin(angle) * endD);

        const lineTiles = rasterizeLine(x0, y0, x1, y1, mainRoadW);
        for (const t of lineTiles) {
            if (t.q >= 0 && t.q < mapW && t.r >= 0 && t.r < mapH) {
                const k = `${t.q},${t.r}`;
                if (!roadSet.has(k)) {
                    roadSet.add(k);
                    roadTiles.push(t);
                }
            }
        }
    }

    // 1b. Ring roads (concentric roughly-circular paths)
    for (let ri = 0; ri < numRings; ri++) {
        const ringRadius = Math.floor(radius * (ri + 1) / (numRings + 1)) + Math.floor(jitter(rng, 2));
        const circumference = Math.floor(2 * Math.PI * ringRadius);
        const segments = Math.max(12, circumference);
        for (let s = 0; s < segments; s++) {
            const a0 = (s / segments) * Math.PI * 2;
            const a1 = ((s + 1) / segments) * Math.PI * 2;
            const x0 = cx + Math.round(Math.cos(a0) * ringRadius);
            const y0 = cy + Math.round(Math.sin(a0) * ringRadius);
            const x1 = cx + Math.round(Math.cos(a1) * ringRadius);
            const y1 = cy + Math.round(Math.sin(a1) * ringRadius);

            const lineTiles = rasterizeLine(x0, y0, x1, y1, 1);
            for (const t of lineTiles) {
                if (t.q >= 0 && t.q < mapW && t.r >= 0 && t.r < mapH) {
                    const k = `${t.q},${t.r}`;
                    if (!roadSet.has(k)) {
                        roadSet.add(k);
                        roadTiles.push(t);
                    }
                }
            }
        }
    }

    // 1c. Secondary cross streets — short roads between spoke pairs
    if (type !== 'village') {
        for (let i = 0; i < spokeAngles.length; i++) {
            const a1 = spokeAngles[i];
            const a2 = spokeAngles[(i + 1) % spokeAngles.length];
            const midAngle = (a1 + a2) / 2;
            // Place 1-2 cross streets at varying distances
            const crossCount = type === 'capital' ? 2 : 1;
            for (let ci = 0; ci < crossCount; ci++) {
                const d = Math.floor(radius * (0.3 + ci * 0.3) + jitter(rng, 3));
                const x0 = cx + Math.round(Math.cos(a1) * d);
                const y0 = cy + Math.round(Math.sin(a1) * d);
                const x1 = cx + Math.round(Math.cos(a2) * d);
                const y1 = cy + Math.round(Math.sin(a2) * d);

                const lineTiles = rasterizeLine(x0, y0, x1, y1, 1);
                for (const t of lineTiles) {
                    if (t.q >= 0 && t.q < mapW && t.r >= 0 && t.r < mapH) {
                        const k = `${t.q},${t.r}`;
                        if (!roadSet.has(k)) {
                            roadSet.add(k);
                            roadTiles.push(t);
                        }
                    }
                }
            }
        }
    }

    // 1d. Central plaza — clear a small open area at center
    const plazaR = type === 'capital' ? 4 : type === 'city' ? 3 : 2;
    for (let dr = -plazaR; dr <= plazaR; dr++) {
        for (let dq = -plazaR; dq <= plazaR; dq++) {
            if (dq * dq + dr * dr <= plazaR * plazaR + 1) {
                const q = cx + dq, r = cy + dr;
                if (q >= 0 && q < mapW && r >= 0 && r < mapH) {
                    const k = `${q},${r}`;
                    if (!roadSet.has(k)) {
                        roadSet.add(k);
                        roadTiles.push({ q, r });
                    }
                }
            }
        }
    }

    // Mark road tiles on the grid
    for (const rt of roadTiles) {
        const tile = tiles[rt.r][rt.q];
        tile.isRoad = true;
        tile.subTerrain.passable = true;
        // Set base terrain to dirt for roads
        tile.baseTerrain = 'dirt';
        tile.subTerrain.id = 'dirt';
        tile.subTerrain.name = 'Road';
        tile.subTerrain.color = '#8b7355';
    }

    // ── 2. Flood-fill to identify city blocks (parcels) ────────
    const blockMap = new Int16Array(mapW * mapH).fill(-1); // -1 = unassigned
    let nextBlockId = 0;
    const blocks = []; // [{ id, tiles: [{q,r},...], avgDist, district }]

    // Mark road tiles and out-of-settlement tiles as boundary
    for (let r = 0; r < mapH; r++) {
        for (let q = 0; q < mapW; q++) {
            const dist = Math.sqrt((q - cx) * (q - cx) + (r - cy) * (r - cy));
            const idx = r * mapW + q;
            if (roadSet.has(`${q},${r}`) || dist > radius + 2) {
                blockMap[idx] = -2; // boundary
            }
        }
    }

    // Flood fill to find contiguous blocks
    for (let r = 1; r < mapH - 1; r++) {
        for (let q = 1; q < mapW - 1; q++) {
            const idx = r * mapW + q;
            if (blockMap[idx] !== -1) continue;

            const blockId = nextBlockId++;
            const blockTiles = [];
            const stack = [{ q, r }];
            blockMap[idx] = blockId;

            while (stack.length > 0) {
                const cur = stack.pop();
                blockTiles.push(cur);
                const neighbors = [
                    { q: cur.q + 1, r: cur.r },
                    { q: cur.q - 1, r: cur.r },
                    { q: cur.q, r: cur.r + 1 },
                    { q: cur.q, r: cur.r - 1 },
                ];
                for (const n of neighbors) {
                    if (n.q < 0 || n.q >= mapW || n.r < 0 || n.r >= mapH) continue;
                    const ni = n.r * mapW + n.q;
                    if (blockMap[ni] !== -1) continue;
                    blockMap[ni] = blockId;
                    stack.push(n);
                }
            }

            // Compute average distance to center
            let totalDist = 0;
            for (const bt of blockTiles) {
                totalDist += Math.sqrt((bt.q - cx) * (bt.q - cx) + (bt.r - cy) * (bt.r - cy));
            }
            const avgDist = blockTiles.length > 0 ? totalDist / blockTiles.length : 0;

            blocks.push({
                id: blockId,
                tiles: blockTiles,
                avgDist,
                district: null,
            });
        }
    }

    // ── 3. Assign districts to blocks based on distance ────────
    // Sort blocks by average distance from center
    blocks.sort((a, b) => a.avgDist - b.avgDist);

    const innerRadius  = radius * 0.2;
    const midRadius    = radius * 0.5;
    const outerRadius  = radius * 0.75;

    for (const block of blocks) {
        if (block.tiles.length < 2) {
            block.district = DISTRICT.OPEN;
            continue;
        }
        if (block.avgDist <= innerRadius) {
            // Innermost blocks: civic + commercial
            block.district = rng() < 0.5 ? DISTRICT.CIVIC : DISTRICT.COMMERCIAL;
        } else if (block.avgDist <= midRadius) {
            // Middle ring: mix of commercial and residential
            const roll = rng();
            if (roll < 0.3) block.district = DISTRICT.COMMERCIAL;
            else block.district = DISTRICT.RESIDENTIAL;
        } else if (block.avgDist <= outerRadius) {
            // Outer ring: mostly residential
            block.district = rng() < 0.15 ? DISTRICT.FARM : DISTRICT.RESIDENTIAL;
        } else {
            // Outskirts: farmland
            block.district = DISTRICT.FARM;
        }
    }

    // Ensure we have at least one civic and one commercial block
    const hasCivic = blocks.some(b => b.district === DISTRICT.CIVIC);
    const hasComm  = blocks.some(b => b.district === DISTRICT.COMMERCIAL);
    if (!hasCivic && blocks.length > 0) blocks[0].district = DISTRICT.CIVIC;
    if (!hasComm  && blocks.length > 1) blocks[1].district = DISTRICT.COMMERCIAL;

    // ── 4. Subdivide blocks into building lots ──────────────────
    // Each lot is a rectangular area within a block where one building fits.
    const lots = []; // [{ q, r, w, h, district, blockId }]

    for (const block of blocks) {
        if (block.tiles.length < 4) continue; // too small for a building

        // Find bounding box of block
        let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
        const tileSet = new Set();
        for (const t of block.tiles) {
            if (t.q < minQ) minQ = t.q;
            if (t.q > maxQ) maxQ = t.q;
            if (t.r < minR) minR = t.r;
            if (t.r > maxR) maxR = t.r;
            tileSet.add(`${t.q},${t.r}`);
        }

        // Determine lot size based on district
        let lotW, lotH, lotSpacing;
        if (block.district === DISTRICT.CIVIC) {
            lotW = 5; lotH = 7; lotSpacing = 2;
        } else if (block.district === DISTRICT.COMMERCIAL) {
            lotW = 4; lotH = 6; lotSpacing = 2;
        } else if (block.district === DISTRICT.FARM) {
            lotW = 6; lotH = 6; lotSpacing = 3;
        } else {
            // Residential
            lotW = 3; lotH = 5; lotSpacing = 2;
        }

        // Scan for lot positions within this block
        for (let lr = minR; lr <= maxR - lotH + 1; lr += lotH + lotSpacing) {
            for (let lq = minQ; lq <= maxQ - lotW + 1; lq += lotW + lotSpacing) {
                // Check all tiles in this lot are part of the block
                let valid = true;
                for (let dr = 0; dr < lotH && valid; dr++) {
                    for (let dq = 0; dq < lotW && valid; dq++) {
                        if (!tileSet.has(`${lq + dq},${lr + dr}`)) valid = false;
                    }
                }
                if (!valid) continue;

                // Check none of the lot tiles are already used
                let free = true;
                for (let dr = 0; dr < lotH && free; dr++) {
                    for (let dq = 0; dq < lotW && free; dq++) {
                        const t = tiles[lr + dr][lq + dq];
                        if (t.building || t.customBuilding || t.customBuildingPart || t.isRoad) {
                            free = false;
                        }
                    }
                }
                if (!free) continue;

                lots.push({
                    q: lq, r: lr,
                    w: lotW, h: lotH,
                    district: block.district,
                    blockId: block.id,
                });
            }
        }
    }

    // Shuffle lots to avoid always filling blocks top-to-bottom
    for (let i = lots.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = lots[i]; lots[i] = lots[j]; lots[j] = tmp;
    }

    // ── 5. Place buildings on lots ────────────────────────────
    // Determine how many buildings of each type to place
    const layout = (typeof InnerMap !== 'undefined' && InnerMap.SETTLEMENT_BUILDINGS)
        ? (InnerMap.SETTLEMENT_BUILDINGS[type] || InnerMap.SETTLEMENT_BUILDINGS.village)
        : { required: [], optional: [], maxBuildings: 10 };

    const requiredQueue = [...layout.required];
    const optionalQueue = [...layout.optional];

    // Shuffle optional
    for (let i = optionalQueue.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = optionalQueue[i]; optionalQueue[i] = optionalQueue[j]; optionalQueue[j] = tmp;
    }

    // Max buildings based on layout or settlement
    const maxBuildings = layout.maxBuildings || 10;
    let placedCount = 0;

    // Track which lot indices we've used
    const usedLots = new Set();

    // Get custom building defs if available
    const hasCustom = typeof CustomBuildings !== 'undefined' && CustomBuildings.isLoaded() && CustomBuildings.hasAny();

    // Helper: find the best district for a building type
    function districtForType(bType) {
        for (const [dist, types] of Object.entries(DISTRICT_BUILDING_MAP)) {
            if (types.includes(bType)) return dist;
        }
        return DISTRICT.RESIDENTIAL;
    }

    // Helper: try to place a building (custom or sprite) onto a lot
    function placeOnLot(lotIdx, buildingType) {
        const lot = lots[lotIdx];
        usedLots.add(lotIdx);

        // Try custom building first
        if (hasCustom) {
            const candidates = CustomBuildings.getByType(buildingType);
            if (candidates.length > 0) {
                const def = candidates[Math.floor(rng() * candidates.length)];
                if (_tryPlaceCustomBuilding(tiles, def, lot, mapW, mapH)) {
                    placedCount++;
                    return true;
                }
            }
        }

        // Fall back to sprite-based building placement
        _placeSpriteBuilding(tiles, lot, buildingType, settlement, rng);
        placedCount++;
        return true;
    }

    // Place required buildings first — prefer matching district lots
    for (const bType of requiredQueue) {
        if (placedCount >= maxBuildings) break;
        const idealDistrict = districtForType(bType);

        // Find best lot: prefer matching district, then nearest to center
        let bestIdx = -1;
        let bestScore = Infinity;
        for (let li = 0; li < lots.length; li++) {
            if (usedLots.has(li)) continue;
            const lot = lots[li];
            const distMatch = lot.district === idealDistrict ? 0 : 10;
            const dist = Math.sqrt((lot.q + lot.w / 2 - cx) ** 2 + (lot.r + lot.h / 2 - cy) ** 2);
            const score = distMatch + dist * 0.1;
            if (score < bestScore) { bestScore = score; bestIdx = li; }
        }
        if (bestIdx >= 0) placeOnLot(bestIdx, bType);
    }

    // Place optional buildings — fill remaining lots
    for (const bType of optionalQueue) {
        if (placedCount >= maxBuildings) break;
        const idealDistrict = districtForType(bType);

        let bestIdx = -1;
        let bestScore = Infinity;
        for (let li = 0; li < lots.length; li++) {
            if (usedLots.has(li)) continue;
            const lot = lots[li];
            const distMatch = lot.district === idealDistrict ? 0 : 5;
            const dist = Math.sqrt((lot.q + lot.w / 2 - cx) ** 2 + (lot.r + lot.h / 2 - cy) ** 2);
            const score = distMatch + dist * 0.1 + rng() * 3;
            if (score < bestScore) { bestScore = score; bestIdx = li; }
        }
        if (bestIdx >= 0) placeOnLot(bestIdx, bType);
    }

    // If we still have lots left and haven't hit max, fill with extra houses
    for (let li = 0; li < lots.length && placedCount < maxBuildings; li++) {
        if (usedLots.has(li)) continue;
        const lot = lots[li];
        if (lot.district === DISTRICT.FARM) {
            placeOnLot(li, 'farm');
        } else {
            placeOnLot(li, 'house');
        }
    }

    // ── 6. Decorations on remaining open space ──────────────
    _placeDecorations(tiles, roadSet, settlement, rng, cx, cy, radius, mapW, mapH);

    // ── 7. Paths from center to map edges (entry roads) ──────
    _placeEntryRoads(tiles, spokeAngles, cx, cy, radius, mapW, mapH, roadSet, roadTiles);

    // Return data for the buildings list and roadTiles
    return { roadTiles, blocks, lots };
}

// ══════════════════════════════════════════════════════════════
//  CUSTOM BUILDING PLACEMENT ON A LOT
// ══════════════════════════════════════════════════════════════

/**
 * Place a custom (editor-authored) building onto a lot.
 * Checks footprint against the lot area and marks tiles.
 */
function _tryPlaceCustomBuilding(tiles, def, lot, mapW, mapH) {
    const bounds = def.bounds || {
        minCol: 0, minRow: 0,
        maxCol: (def.width || 1) - 1,
        maxRow: (def.height || 1) - 1
    };
    const footW = bounds.maxCol - bounds.minCol + 1;
    const footH = bounds.maxRow - bounds.minRow + 1;

    // Building must fit within lot (with a 1-tile margin if lot is large enough)
    if (footW > lot.w || footH > lot.h) return false;

    // Center the building in the lot
    const offsetQ = Math.floor((lot.w - footW) / 2) - bounds.minCol;
    const offsetR = Math.floor((lot.h - footH) / 2) - bounds.minRow;
    const anchorQ = lot.q + offsetQ;
    const anchorR = lot.r + offsetR;

    // Verify all footprint tiles are in-bounds and free
    for (let dr = bounds.minRow; dr <= bounds.maxRow; dr++) {
        for (let dq = bounds.minCol; dq <= bounds.maxCol; dq++) {
            const fq = anchorQ + dq, fr = anchorR + dr;
            if (fr < 0 || fr >= mapH || fq < 0 || fq >= mapW) return false;
            const t = tiles[fr][fq];
            if (t.building || t.customBuilding || t.customBuildingPart || t.isRoad) return false;
        }
    }

    // Place anchor
    tiles[anchorR][anchorQ].customBuilding = { defId: def.id };

    // Mark footprint
    for (let dr = bounds.minRow; dr <= bounds.maxRow; dr++) {
        for (let dq = bounds.minCol; dq <= bounds.maxCol; dq++) {
            if (dr === 0 && dq === 0) continue;
            const fq = anchorQ + dq, fr = anchorR + dr;
            tiles[fr][fq].customBuildingPart = { anchorQ, anchorR };
        }
    }

    // Apply meta (impassable, door)
    for (const m of (def.meta || [])) {
        const fr = anchorR + m.r, fq = anchorQ + m.q;
        if (fr >= 0 && fr < mapH && fq >= 0 && fq < mapW) {
            if (m.impassable) tiles[fr][fq].subTerrain.passable = false;
        }
    }

    return true;
}

// ══════════════════════════════════════════════════════════════
//  SPRITE-BASED BUILDING PLACEMENT ON A LOT
// ══════════════════════════════════════════════════════════════

function _placeSpriteBuilding(tiles, lot, buildingType, settlement, rng) {
    const type = settlement.type || 'village';

    // Choose the sprite for this building type
    const btDef = (typeof InnerMap !== 'undefined' && InnerMap.BUILDING_TYPES)
        ? (InnerMap.BUILDING_TYPES[buildingType] || InnerMap.BUILDING_TYPES.house)
        : { sprite: 'buildings/villageSmall00.png' };

    // Building anchor = bottom-center of the lot
    const bq = lot.q + Math.floor(lot.w / 2);
    const br = lot.r + lot.h - 1;

    if (br < 0 || br >= tiles.length || bq < 0 || bq >= tiles[0].length) return;

    const tile = tiles[br][bq];
    if (tile.building || tile.isRoad) return;

    tile.building = btDef.sprite;
    tile._buildingTypeHint = buildingType;

    // Mark a 3×3 footprint as impassable (buildings render 3w × 3h)
    const H = tiles.length, W = tiles[0].length;
    for (let dq = -1; dq <= 1; dq++) {
        for (let dr = -2; dr <= 0; dr++) {
            const fq = bq + dq, fr = br + dr;
            if (fr >= 0 && fr < H && fq >= 0 && fq < W) {
                tiles[fr][fq].subTerrain.passable = false;
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════
//  DECORATIONS
// ══════════════════════════════════════════════════════════════

function _placeDecorations(tiles, roadSet, settlement, rng, cx, cy, radius, mapW, mapH) {
    const type = settlement.type || 'village';

    // Get decoration sprites from InnerMap if available
    const decoPool = (typeof InnerMap !== 'undefined' && InnerMap.DECORATION_SPRITES)
        ? (InnerMap.DECORATION_SPRITES[type] || InnerMap.DECORATION_SPRITES.village)
        : [];
    if (decoPool.length === 0) return;

    const DECO_LAYOUTS = {
        1: [{ ox: 0, oy: 0 }],
        2: [{ ox: -0.22, oy: 0.05 }, { ox: 0.22, oy: -0.05 }],
        3: [{ ox: -0.22, oy: 0.12 }, { ox: 0.22, oy: 0.12 }, { ox: 0, oy: -0.14 }]
    };

    let maxDecorations;
    switch (type) {
        case 'capital': maxDecorations = 40; break;
        case 'city':    maxDecorations = 30; break;
        case 'town':    maxDecorations = 20; break;
        default:        maxDecorations = 12; break;
    }

    // Collect empty passable tiles in the settlement area
    const candidates = [];
    for (let r = 1; r < mapH - 1; r++) {
        for (let q = 1; q < mapW - 1; q++) {
            const dist = Math.sqrt((q - cx) * (q - cx) + (r - cy) * (r - cy));
            if (dist > radius + 5) continue;
            const t = tiles[r][q];
            if (t.building || t.customBuilding || t.customBuildingPart || t.isRoad) continue;
            if (!t.subTerrain.passable) continue;
            candidates.push({ q, r });
        }
    }

    // Shuffle
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
    }

    let decoPlaced = 0;
    for (const c of candidates) {
        if (decoPlaced >= maxDecorations) break;
        const tile = tiles[c.r][c.q];

        const roll = rng();
        const count = roll < 0.65 ? 1 : roll < 0.90 ? 2 : 3;
        const layout = DECO_LAYOUTS[count];

        const decorations = [];
        const usedSprites = new Set();
        for (let d = 0; d < count; d++) {
            let sprite;
            let attempts = 0;
            do {
                sprite = decoPool[Math.floor(rng() * decoPool.length)];
                attempts++;
            } while (usedSprites.has(sprite) && attempts < 10);
            usedSprites.add(sprite);
            decorations.push({ sprite, ox: layout[d].ox, oy: layout[d].oy });
        }
        tile.decorations = decorations;
        decoPlaced++;
    }
}

// ══════════════════════════════════════════════════════════════
//  ENTRY ROADS — extend spoke roads to map edges
// ══════════════════════════════════════════════════════════════

function _placeEntryRoads(tiles, spokeAngles, cx, cy, radius, mapW, mapH, roadSet, roadTiles) {
    for (const angle of spokeAngles) {
        // Extend spoke from settlement edge to map border
        const startD = radius;
        // Find the map edge along this angle
        const cos = Math.cos(angle), sin = Math.sin(angle);
        let endD = startD;
        while (true) {
            const eq = cx + Math.round(cos * endD);
            const er = cy + Math.round(sin * endD);
            if (eq < 0 || eq >= mapW || er < 0 || er >= mapH) break;
            endD++;
        }

        const x0 = cx + Math.round(cos * startD);
        const y0 = cy + Math.round(sin * startD);
        const x1 = cx + Math.round(cos * (endD - 1));
        const y1 = cy + Math.round(sin * (endD - 1));

        const lineTiles = rasterizeLine(x0, y0, x1, y1, 1);
        for (const t of lineTiles) {
            if (t.q >= 0 && t.q < mapW && t.r >= 0 && t.r < mapH) {
                const k = `${t.q},${t.r}`;
                const tile = tiles[t.r][t.q];
                tile.isRoad = true;
                tile.subTerrain.passable = true;
                tile.baseTerrain = 'dirt';
                tile.subTerrain.id = 'dirt';
                tile.subTerrain.name = 'Road';
                tile.subTerrain.color = '#8b7355';
                if (!roadSet.has(k)) {
                    roadSet.add(k);
                    roadTiles.push(t);
                }
            }
        }
    }
}

// ── Public API ──────────────────────────────────────────────
export const SettlementGenerator = {
    generate,
    DISTRICT,
    SETTLEMENT_RADIUS,
};

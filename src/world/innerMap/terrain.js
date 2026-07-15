// InnerMap — terrain members (split from the original monolith).
import { InnerMap } from './_ref.js';
import { Utils, Hex, CustomObjects, CustomBuildings, CustomInteriors, generateSpriteInterior, SettlementGenerator, DataLoader, Terrain, NpcFamily } from './_imports.js';

Object.assign(InnerMap, {
    /**
     * Get the base terrain fill category for a tile.
     * Sub-terrain can override the parent's default.
     */
    _getBaseTerrain(terrainId, subTerrainId) {
        // Check sub-terrain override first
        if (subTerrainId && this.SUB_TO_BASE_TERRAIN[subTerrainId]) {
            return this.SUB_TO_BASE_TERRAIN[subTerrainId];
        }
        // Fall back to parent terrain mapping
        return this.PARENT_TO_BASE_TERRAIN[terrainId] || 'grass';
    },

    _getGrassNineTileBrush() {
        const gd = (typeof DataLoader !== 'undefined') ? DataLoader._gamedata : null;
        // Terrain editor brushes live in terrainNineTileBrushes (NOT nineTileBrushes which is building brushes)
        const brushes = Array.isArray(gd && gd.terrainNineTileBrushes) ? gd.terrainNineTileBrushes : [];

        if (brushes.length) {
            const valid = brushes.filter(b => b && b.tiles && typeof b.tiles === 'object');
            if (valid.length) {
                const byName = valid.find(b => /grass|meadow|lawn|turf/i.test(String(b.name || '')));
                if (byName) return byName;
                const hasCenter = valid.find(b => {
                    return Array.isArray(b.tiles) && b.tiles[1] && b.tiles[1][1] && b.tiles[1][1].sheetPath;
                });
                if (hasCenter) return hasCenter;
                return valid[0];
            }
        }

        // ── Hardcoded fallback: build a brush from the LPC terrain sheet ──
        // Edge tiles use the grass-to-dirt transition block (rows 0-2, cols 6-8).
        // These are fully opaque tiles with textured grass/dirt blending — much
        // fuller than the transparent overlay tiles at cols 0-2.
        // Center + IC tiles are left null so they fall through to
        // fillCategory:'grass' which gives hash-based fill variety.
        if (this._fallbackGrassBrush) return this._fallbackGrassBrush;

        const seasons = ['spring', 'summer', 'autumn', 'winter'];
        const seasonTiles = {};
        const seasonInsideCorners = {};

        for (const season of seasons) {
            const sheet = `assets/lpc/Terrain/terrain_${season}.png`;
            const grid = [];
            for (let row = 0; row < 3; row++) {
                grid[row] = [];
                for (let col = 0; col < 3; col++) {
                    if (row === 1 && col === 1) {
                        // Center: null → falls through to fillCategory:'grass'
                        grid[row][col] = null;
                    } else {
                        // Edge/corner: transition tile at same position + 6 cols
                        grid[row][col] = { sheetPath: sheet, sx: (col + 6) * 32, sy: row * 32 };
                    }
                }
            }
            seasonTiles[season] = grid;
            // Inside corners: null → falls through to fillCategory:'grass'
            seasonInsideCorners[season] = [null, null, null, null];
        }

        this._fallbackGrassBrush = {
            name: 'Grass (Default)',
            tiles: seasonTiles.spring,
            insideCorners: [null, null, null, null],
            seasonTiles,
            seasonInsideCorners,
        };
        return this._fallbackGrassBrush;
    },

    /**
     * Pick the correct tile from a 9-tile brush for a given position in a
     * boolean mask, using the same auto-tiling logic as the terrain editor:
     *   - Check 4 cardinal neighbors to determine edge/center
     *   - If all 4 cardinals present, check diagonals for inside corners
     * Returns { row, col } for the 3×3 tiles grid, or { ic: 0-3 } for an
     * inside corner, or null if no tile should be placed.
     */
    _pickNineTileInfo(mask, q, r) {
        const H = mask.length;
        const W = H > 0 ? mask[0].length : 0;
        const has = (nq, nr) => (nr >= 0 && nr < H && nq >= 0 && nq < W) ? !!mask[nr][nq] : false;

        const hasTop = has(q, r - 1);
        const hasBottom = has(q, r + 1);
        const hasLeft = has(q - 1, r);
        const hasRight = has(q + 1, r);

        // Check for inside corners: all 4 cardinals present but a diagonal is missing
        if (hasTop && hasBottom && hasLeft && hasRight) {
            const hasTL = has(q - 1, r - 1);
            const hasTR = has(q + 1, r - 1);
            const hasBL = has(q - 1, r + 1);
            const hasBR = has(q + 1, r + 1);

            // IC indices: 0=TL, 1=TR, 2=BL, 3=BR (which diagonal is MISSING)
            const icIdx = !hasTL ? 0 : !hasTR ? 1 : !hasBL ? 2 : !hasBR ? 3 : -1;
            if (icIdx >= 0) return { ic: icIdx };
        }

        // Degenerate case: both sides of an axis missing → no valid 3×3 tile.
        // Return null so the tile gets no grass overlay (base dirt shows through).
        if ((!hasTop && !hasBottom) || (!hasLeft && !hasRight)) return null;

        // Map to 3×3 grid: row 0=top edge, 1=middle, 2=bottom edge
        let row = 1;
        if (!hasTop && hasBottom) row = 0;
        else if (hasTop && !hasBottom) row = 2;
        // col 0=left edge, 1=middle, 2=right edge
        let col = 1;
        if (!hasLeft && hasRight) col = 0;
        else if (hasLeft && !hasRight) col = 2;

        return { row, col };
    },

    _paintGrassSecondLayer(tiles, worldQ, worldR) {
        const brush = this._getGrassNineTileBrush();
        const H = this.height;
        const W = this.width;

        // Paintable mask — the detail layer is purely visual and always on top,
        // so every tile that exists is paintable. No exceptions.
        const paintable = Array.from({ length: H }, () => Array(W).fill(false));
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (tiles[r][q]) paintable[r][q] = true;
            }
        }

        // ── Grass mask: cover all paintable non-road tiles ──
        // Full coverage gives a clean grassy meadow. The 9-tile brush then
        // creates proper transitions only where grass meets road/dirt.
        const mask = Array.from({ length: H }, () => Array(W).fill(false));

        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (!paintable[r][q]) continue;
                const tile = tiles[r][q];
                if (tile && tile.isRoad) continue;
                mask[r][q] = true;
            }
        }

        // Shrink the mask 1 tile inward so the map border always has a clean
        // dirt edge (prevents the brush edge tiles from being cut off at the screen edge).
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (r === 0 || r === H - 1 || q === 0 || q === W - 1) mask[r][q] = false;
            }
        }

        // Get season-specific tiles if available
        const season = (this.season || 'spring').toLowerCase();
        const tilesGrid = (brush && brush.seasonTiles && brush.seasonTiles[season])
            ? brush.seasonTiles[season]
            : (brush ? brush.tiles : null);
        const cornersArr = (brush && brush.seasonInsideCorners && brush.seasonInsideCorners[season])
            ? brush.seasonInsideCorners[season]
            : (brush ? brush.insideCorners || null : null);
        // Alternate center fill tiles — picked by hash for variety
        const altFills = (brush && brush.seasonAltFills && brush.seasonAltFills[season] && brush.seasonAltFills[season].length)
            ? brush.seasonAltFills[season]
            : null;

        // Assign terrain detail for each grass tile
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (!mask[r][q]) continue;
                const tile = tiles[r][q];
                if (!tile) continue;

                if (tilesGrid) {
                    // Degenerate tiles (thin/isolated, no neighbors on one axis) use center fill
                    // rather than being skipped — custom brushes have a real center tile that fills nicely.
                    const info = this._pickNineTileInfo(mask, q, r) || { row: 1, col: 1 };

                    // Inside corner
                    if (info.ic !== undefined && cornersArr && cornersArr[info.ic]) {
                        const ic = cornersArr[info.ic];
                        if (ic && ic.sheetPath) {
                            tile.terrainDetail = {
                                sheetPath: ic.sheetPath,
                                sx: Number.isFinite(ic.sx) ? ic.sx : 0,
                                sy: Number.isFinite(ic.sy) ? ic.sy : 0,
                                sw: 32,
                                sh: 32,
                            };
                            continue;
                        }
                    }

                    // Fallback for inside corners w/o defined IC tiles: use center fill
                    if (info.ic !== undefined) {
                        const center = tilesGrid[1] && tilesGrid[1][1];
                        if (center && center.sheetPath) {
                            tile.terrainDetail = {
                                sheetPath: center.sheetPath,
                                sx: Number.isFinite(center.sx) ? center.sx : 0,
                                sy: Number.isFinite(center.sy) ? center.sy : 0,
                                sw: 32,
                                sh: 32,
                            };
                            continue;
                        }
                    }

                    // Normal 3×3 grid tile
                    if (info.row !== undefined) {
                        let tileRef = tilesGrid[info.row] && tilesGrid[info.row][info.col];
                        // For the center slot (row 1, col 1), hash-pick from alt fills pool if available
                        if (info.row === 1 && info.col === 1 && altFills && altFills.length) {
                            const pool = tileRef ? [tileRef, ...altFills] : altFills;
                            const hash = Math.abs((q * 73856093 ^ r * 19349663)) >>> 0;
                            tileRef = pool[hash % pool.length];
                        }
                        if (tileRef && tileRef.sheetPath) {
                            tile.terrainDetail = {
                                sheetPath: tileRef.sheetPath,
                                sx: Number.isFinite(tileRef.sx) ? tileRef.sx : 0,
                                sy: Number.isFinite(tileRef.sy) ? tileRef.sy : 0,
                                sw: 32,
                                sh: 32,
                            };
                            continue;
                        }
                    }
                }

                // Fallback: use terrain fill tile for grass
                tile.terrainDetail = { fillCategory: 'grass' };
            }
        }
    },

    /**
     * Generate or retrieve an inner map for a world tile
     * @param {Object} worldTile - The world tile object
     * @param {number} worldQ - World tile q coordinate
     * @param {number} worldR - World tile r coordinate
     * @returns {Array} 2D array of inner map tiles
     */
    getOrGenerate(worldTile, worldQ, worldR, game) {
        const key = `${worldQ},${worldR}_${this.width}x${this.height}`;
        if (this._cache[key]) {
            // Update dynamic weather data on cached tiles
            this._refreshWeatherData(this._cache[key], worldQ, worldR, game);
            return this._cache[key];
        }

        const tiles = this.generate(worldTile, worldQ, worldR, game);
        this._cache[key] = tiles;
        return tiles;
    },

    /**
     * Refresh weather-related per-tile data on a cached inner map.
     * Keeps terrain layout stable but updates temperature/weather tints.
     */
    _refreshWeatherData(tiles, worldQ, worldR, game) {
        const world = game && game.world;
        let wType = 'clear';
        let eTemp = 0.5;
        if (world && world.weather) {
            const w = world.weather.getWeather(worldQ, worldR);
            if (w) wType = w.type;
            const t = world.weather.getTemperature(worldQ, worldR);
            if (t) eTemp = t.value;
        }
        for (let r = 0; r < tiles.length; r++) {
            for (let q = 0; q < tiles[r].length; q++) {
                tiles[r][q].weatherType = wType;
                tiles[r][q].effectiveTemp = eTemp;
            }
        }
    },

    /**
     * Generate an inner map for a world tile.
     * Uses the world tile's noise values (elevation, temperature, moisture)
     * combined with per-cell fbm noise so the inner map is coherent with
     * its parent tile.
     */
    generate(worldTile, worldQ, worldR, game) {
        // All inner maps are a fixed size
        this.width = this.INNER_MAP_SIZE;
        this.height = this.INNER_MAP_SIZE;

        const terrainId = worldTile.terrain ? worldTile.terrain.id : 'grassland';
        const config = this.CONFIG;
        const subTerrains = config && config.subTerrains ? config.subTerrains[terrainId] : null;

        // Parent tile noise values (0-1 range)
        const parentElev = worldTile.elevation  !== undefined ? worldTile.elevation  : 0.5;
        const parentTemp = worldTile.temperature !== undefined ? worldTile.temperature : 0.5;
        const parentMoist = worldTile.moisture   !== undefined ? worldTile.moisture   : 0.5;

        // Dynamic season / weather temperature adjustment
        // If the world has a weather system, use actual dynamic temperature;
        // otherwise fall back to the static tile temperature.
        let effectiveTemp = parentTemp;
        const world = game && game.world;
        if (world && world.weather) {
            const dynTemp = world.weather.getTemperature(worldQ, worldR);
            if (dynTemp) effectiveTemp = dynTemp.value;
        }

        // Get current weather for the tile position
        let currentWeather = { type: 'clear', intensity: 0 };
        if (world && world.weather) {
            currentWeather = world.weather.getWeather(worldQ, worldR);
        }

        // Seeded RNG based on world tile position so maps are deterministic
        const seed = (worldQ * 73856093 ^ worldR * 19349663) >>> 0;
        let rngState = seed || 1;
        const rng = () => {
            rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
            return rngState / 0x7fffffff;
        };

        const tiles = [];
        const primaryTerrains = subTerrains ? subTerrains.primary : this._defaultSubTerrains(terrainId);
        const totalWeight = primaryTerrains.reduce((sum, t) => sum + (t.weight || 1), 0);

        // Noise offset derived from world coordinates so each tile's inner
        // noise patch is unique but deterministic
        const noiseOffX = worldQ * 7.13 + 100;
        const noiseOffY = worldR * 7.13 + 200;
        const noiseScale = 0.45; // controls how rapidly sub-terrain varies

        for (let r = 0; r < this.height; r++) {
            const row = [];
            for (let q = 0; q < this.width; q++) {
                // --- Per-cell noise coherent with parent tile ---
                const nx = noiseOffX + q * noiseScale;
                const ny = noiseOffY + r * noiseScale;

                // Local elevation / moisture perturbation (small-scale detail)
                const localElev  = (Utils.fbm(nx, ny, 3, 2.0, 0.5) + 1) / 2;        // 0-1
                const localMoist = (Utils.fbm(nx + 50, ny + 50, 3, 2.0, 0.5) + 1) / 2;

                // Blend parent noise with local detail (70 % parent, 30 % local)
                const blendElev  = parentElev  * 0.7 + localElev  * 0.3;
                const blendMoist = parentMoist * 0.7 + localMoist * 0.3;

                // Adjust moisture for active weather (rain/storm boosts moisture)
                let weatherMoistBoost = 0;
                if (currentWeather.type === 'rain')  weatherMoistBoost = 0.08 * currentWeather.intensity;
                if (currentWeather.type === 'storm') weatherMoistBoost = 0.15;
                if (currentWeather.type === 'snow')  weatherMoistBoost = 0.05 * currentWeather.intensity;
                const adjustedMoist = Math.min(1, blendMoist + weatherMoistBoost);

                // Use blended noise to bias the weighted random selection.
                // Incorporate effective temperature so cold/hot regions shift selection.
                // Map blendElev into an index range across the sorted primary list
                // so wetter / higher cells naturally pick different sub-terrains.
                const tempBias = (1 - effectiveTemp) * 0.15; // colder → slightly higher bias
                const noiseBias = (blendElev * 0.45 + adjustedMoist * 0.40 + tempBias) % 1.0; // 0-1

                // Weighted selection modulated by noise
                let roll = rng() * totalWeight;
                // Shift the roll by the noise bias to favour different sub-terrains
                roll = ((roll / totalWeight + noiseBias) % 1.0) * totalWeight;
                let selectedTerrain = primaryTerrains[0];
                for (const t of primaryTerrains) {
                    roll -= (t.weight || 1);
                    if (roll <= 0) {
                        selectedTerrain = t;
                        break;
                    }
                }

                // Edge tiles are more likely to be the primary terrain
                const isEdge = q === 0 || q === this.width - 1 || r === 0 || r === this.height - 1;
                if (isEdge && rng() > 0.4) {
                    selectedTerrain = primaryTerrains[0]; // Default to primary
                }

                // No per-tile encounters (removed)
                const encounter = null;

                const passable = selectedTerrain.passable !== false;

                // Inner map base layer: force dirt everywhere, then paint grass as a second layer.
                const baseTerrain = 'dirt';

                row.push({
                    q, r,
                    baseTerrain: baseTerrain,  // ground fill category (grass/dirt/sand/water/stone/etc.)
                    subTerrain: {
                        id: selectedTerrain.id,
                        name: selectedTerrain.name,
                        icon: selectedTerrain.icon,
                        color: selectedTerrain.color,
                        passable: passable
                    },
                    encounter: encounter,
                    explored: false,
                    visible: false,
                    parentTerrain: terrainId,
                    building: null,  // may be set below for settlements
                    // Weather / climate data baked at generation time
                    effectiveTemp: effectiveTemp,
                    moisture: adjustedMoist,
                    weatherType: currentWeather.type
                });
            }
            tiles.push(row);
        }

        // --- Settlement building placement ---
        // Must run BEFORE the grass layer so road tiles are excluded from
        // the grass mask and the 9-tile brush creates proper edges.
        if (worldTile.settlement) {
            // Use the procedural settlement generator (road network + parcels + lots)
            if (typeof SettlementGenerator !== 'undefined') {
                const genResult = SettlementGenerator.generate(
                    tiles, worldTile.settlement, rng, this.width, this.height
                );
                // Store layout data for road generation at enter() time
                tiles._settlementLayout = genResult;
            } else if (typeof CustomBuildings !== 'undefined' && CustomBuildings.isLoaded() && CustomBuildings.hasAny()) {
                // Fallback: scatter custom buildings (legacy)
                this._placeCustomBuildings(tiles, worldTile.settlement, rng);
            }
        }

        // Paint a second grass layer using saved 9-tile brushes (fallback: grass fill overlays).
        // Road tiles (isRoad) are excluded from the mask so the brush auto-tiles
        // smooth edges around dirt paths.
        // Only apply on grass-based terrains — skip sand/stone/dry_dirt etc.
        if (this._getBaseTerrain(terrainId, null) === 'grass') {
            this._paintGrassSecondLayer(tiles, worldQ, worldR);
        }

        // --- Player property placement ---
        this._placePlayerProperties(tiles, worldTile, rng);

        // --- Scatter custom editor-authored objects on terrain ---
        if (typeof CustomObjects !== 'undefined' && CustomObjects.isLoaded() && CustomObjects.hasAnyBindings()) {
            this._scatterCustomObjects(tiles, rng, game ? (game.world ? (game.world.day || 0) : 0) : 0);
        }

        // Ensure the center tile (player start) is always passable
        const centerQ = Math.floor(this.width / 2);
        const centerR = Math.floor(this.height / 2);
        tiles[centerR][centerQ].subTerrain.passable = true;
        tiles[centerR][centerQ].explored = true;
        tiles[centerR][centerQ].visible = true;

        // Reveal tiles around center
        this._revealAround(tiles, centerQ, centerR, 2);

        return tiles;
    },

    // ══════════════════════════════════════════════════════════════
    // DOOR EXCLUSION ZONE
    // Scans all placed buildings for door markers and returns a Set
    // of "q,r" keys forming a clearance area in front of each door.
    // Trees/objects should not be placed on these tiles.
    // ══════════════════════════════════════════════════════════════
    _buildDoorExclusionZone(tiles, W, H) {
        const zone = new Set();
        const CLEARANCE = 3; // tiles of clearance in front of door

        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const tile = tiles[r][q];

                // Custom buildings: check anchor tiles for door meta
                if (tile.customBuilding) {
                    const def = (typeof CustomBuildings !== 'undefined' && CustomBuildings.isLoaded())
                        ? CustomBuildings.getBuilding(tile.customBuilding.defId)
                        : null;
                    if (def && def.meta) {
                        const bounds = def.bounds || { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 };
                        for (const m of def.meta) {
                            if (!m.door) continue;
                            const doorQ = q + m.q;
                            const doorR = r + m.r;

                            // Determine facing: door on bottom edge = faces south,
                            // top edge = north, left edge = west, right edge = east.
                            // Default: south (most common for LPC buildings).
                            let dq = 0, dr = 1; // south by default
                            if (m.r === bounds.minRow)      { dq = 0; dr = -1; } // top → north
                            else if (m.r === bounds.maxRow)  { dq = 0; dr = 1;  } // bottom → south
                            else if (m.q === bounds.minCol)  { dq = -1; dr = 0; } // left → west
                            else if (m.q === bounds.maxCol)  { dq = 1; dr = 0;  } // right → east

                            // Mark clearance in front of door + 1 tile width either side
                            for (let d = 0; d <= CLEARANCE; d++) {
                                const cq = doorQ + dq * d;
                                const cr = doorR + dr * d;
                                for (let s = -1; s <= 1; s++) {
                                    const fq = cq + (dr !== 0 ? s : 0);
                                    const fr = cr + (dq !== 0 ? s : 0);
                                    if (fq >= 0 && fq < W && fr >= 0 && fr < H) {
                                        zone.add(`${fq},${fr}`);
                                    }
                                }
                            }
                        }
                    }
                }

                // Legacy sprite buildings: door is assumed at bottom-center
                if (tile.building && !tile.customBuilding) {
                    // Mark 3 tiles directly below the building tile
                    for (let d = 1; d <= CLEARANCE; d++) {
                        const fr = r + d;
                        for (let s = -1; s <= 1; s++) {
                            const fq = q + s;
                            if (fq >= 0 && fq < W && fr >= 0 && fr < H) {
                                zone.add(`${fq},${fr}`);
                            }
                        }
                    }
                }
            }
        }

        return zone;
    },

    // ══════════════════════════════════════════════════════════════
    // CUSTOM OBJECT SCATTER
    // Called from generate() after terrain + buildings are placed.
    // Places editor-authored objects from CustomObjects by matching
    // each tile's subTerrain.id against the object's terrainBindings.
    // Spawn density: ~8% of eligible tiles per run (tunable later).
    // ══════════════════════════════════════════════════════════════
    _scatterCustomObjects(tiles, rng, currentDay = 0) {
        const W = this.width;
        const H = this.height;
        const unboundPool = CustomObjects.getUnboundObjects();

        // ── Build door exclusion zone ──
        // Prevent trees/objects from being placed directly in front of building doors.
        // For each building with door meta, mark a clearance area around/in front of the door.
        const doorExclusion = this._buildDoorExclusionZone(tiles, W, H);

        // Build set of object IDs that are only spawned via spawnAfter
        // (e.g. stumps) — these should never be auto-scattered.
        const spawnAfterIds = new Set();
        for (const d of CustomObjects.getAllDefs()) {
            if (d.spawnAfter) spawnAfterIds.add(d.spawnAfter);
        }

        // Helper: is this def eligible for auto-scatter?
        const _outdoorTypes = new Set(['tree', 'rock', 'plant']);
        function canScatter(def) {
            if (!def) return false;
            // Only natural outdoor object types are auto-scattered on terrain
            if (!_outdoorTypes.has(def.objectType)) return false;
            // Objects that only exist as spawnAfter replacements shouldn't scatter
            if (spawnAfterIds.has(def.id)) return false;
            return true;
        }

        for (let r = 1; r < H - 1; r++) {
            for (let q = 1; q < W - 1; q++) {
                const tile = tiles[r][q];
                // Only consider passable, unoccupied terrain tiles
                if (!tile.subTerrain.passable) continue;
                if (tile.building) continue;
                if (tile.customObject || tile.customObjectPart) continue;

                // Build combined pool: terrain-bound + universal (unbound)
                // Filter out objects not eligible for auto-scatter
                const terrainPool = CustomObjects.getObjectsForTerrain(tile.subTerrain.id);
                const rawPool = terrainPool.length && unboundPool.length
                    ? terrainPool.concat(unboundPool)
                    : terrainPool.length ? terrainPool : unboundPool;
                const pool = rawPool.filter(canScatter);
                if (!pool.length) continue;

                // Per-tile spawn roll (~8% base for non-trees, ~20% for trees on grass)
                const spawnThreshold = (pool.some(d => d.objectType === 'tree')) ? 0.20 : 0.08;
                if (rng() > spawnThreshold) continue;

                // Weighted-random pick from the combined pool
                const total = pool.reduce((s, d) => s + (d.spawnWeight || 1), 0);
                let roll = rng() * total;
                let def = pool[pool.length - 1];
                for (const d of pool) {
                    roll -= (d.spawnWeight || 1);
                    if (roll <= 0) { def = d; break; }
                }
                if (!def || !def.tiles || def.tiles.length === 0) continue;

                // Trees only spawn on grass (tiles that have a grass detail overlay)
                if (def.objectType === 'tree' && !tile.terrainDetail) continue;

                // Verify every footprint tile is in-bounds and free
                let clear = true;
                for (const tDef of def.tiles) {
                    const fr = r + tDef.localRow;
                    const fq = q + tDef.localCol;
                    if (fr <= 0 || fr >= H - 1 || fq <= 0 || fq >= W - 1)
                        { clear = false; break; }
                    const ft = tiles[fr][fq];
                    if (ft.building || ft.customObject || ft.customObjectPart)
                        { clear = false; break; }
                    // Prevent placement in front of building doors
                    if (doorExclusion.has(`${fq},${fr}`))
                        { clear = false; break; }
                }
                if (!clear) continue;

                // ── Place anchor ──
                const customObj = { defId: def.id, sheetPath: def.sheetPath, currentHealthPct: 100 };
                if (def.resource) customObj.resource = def.resource;
                // Record planting day so growth stages can be computed at render time
                if (def.growthStates && def.growthStates.length > 0) {
                    customObj.growthDayPlanted = currentDay;
                }
                // Random initial rotation variant (0 = default, 1..N = variants)
                if (def.rotationVariants && def.rotationVariants.length > 0) {
                    customObj.rotationIdx = Math.floor(rng() * (def.rotationVariants.length + 1));
                }
                // Random initial color variant (biased toward non-default variants)
                const autoColorVariantIdx = this._pickAutoColorVariantIdx(def, rng);
                if (autoColorVariantIdx != null) customObj.colorVariantIdx = autoColorVariantIdx;
                tile.customObject = customObj;

                // ── Build meta lookup for Format B composed objects ──
                let metaLookup = null;
                if (Array.isArray(def.meta) && def.meta.length > 0) {
                    metaLookup = {};
                    for (const m of def.meta) {
                        metaLookup[`${m.localCol},${m.localRow}`] = m;
                    }
                }

                // ── Mark footprint ──
                for (const tDef of def.tiles) {
                    const fr = r + tDef.localRow;
                    const fq = q + tDef.localCol;
                    const ft = tiles[fr][fq];
                    // Non-anchor footprint tiles get a back-reference to the anchor
                    if (tDef.localRow !== 0 || tDef.localCol !== 0) {
                        ft.customObjectPart = { anchorQ: q, anchorR: r };
                    }
                    // Honour the per-tile impassable flag from the editor
                    // Format A: impassable is directly on tDef
                    // Format B: impassable is in def.meta[] keyed by localCol,localRow
                    const meta = metaLookup && metaLookup[`${tDef.localCol},${tDef.localRow}`];
                    if (tDef.impassable || (meta && meta.impassable)) {
                        ft.subTerrain.passable = false;
                    }
                }
            }
        }
    },

    /**
     * Pick a color variant index for auto-placed objects.
     * Returns 0 for default, 1..N for variant entries, or null if no variants exist.
     * Uses a bias so procedurally placed worlds look less repetitive.
     */
    _pickAutoColorVariantIdx(def, randFn = Math.random) {
        const variantCount = Array.isArray(def?.colorVariants) ? def.colorVariants.length : 0;
        if (variantCount <= 0) return null;

        // Keep some defaults, but prefer variant looks for visual variety.
        const baseChance = 0.25;
        if (randFn() < baseChance) return 0;
        return 1 + Math.floor(randFn() * variantCount);
    },

    // ── Building sprite lists (from assets/tiles/buildings/) ──────
    BUILDING_SPRITES: {
        village: [
            'buildings/villageSmall00.png', 'buildings/villageSmall01.png',
            'buildings/villageSmall02.png', 'buildings/villageSmall03.png',
            'buildings/villageThatched00.png', 'buildings/villageThatched01.png',
            'buildings/villageThatched02.png', 'buildings/villageThatched03.png',
            'buildings/villageWood00.png', 'buildings/villageWood01.png',
            'buildings/villageWood02.png', 'buildings/villageWood03.png'
        ],
        town: [
            'buildings/village00.png', 'buildings/village01.png',
            'buildings/village02.png', 'buildings/village03.png',
            'buildings/villageWood00.png', 'buildings/villageWood01.png',
            'buildings/villageWood02.png', 'buildings/villageWood03.png',
            'buildings/marketplace00.png',
            'buildings/inn.png',
            'buildings/church00.png',
            'buildings/granary00.png', 'buildings/granary01.png',
            'buildings/well00.png', 'buildings/well01.png',
            'buildings/smithy.png'
        ],
        capital: [
            'buildings/walledCity.png',
            'buildings/village00.png', 'buildings/village01.png',
            'buildings/village02.png', 'buildings/village03.png',
            'buildings/marketplace00.png',
            'buildings/church00.png',
            'buildings/temple.png',
            'buildings/barracks00.png',
            'buildings/granaryStone00.png', 'buildings/granaryStone01.png',
            'buildings/warehouse00.png',
            'buildings/smithy.png',
            'buildings/well00.png'
        ],
        city: [
            'buildings/village00.png', 'buildings/village01.png',
            'buildings/village02.png', 'buildings/village03.png',
            'buildings/villageWood00.png', 'buildings/villageWood01.png',
            'buildings/marketplace00.png',
            'buildings/church00.png',
            'buildings/barracks00.png',
            'buildings/granary00.png', 'buildings/granary01.png',
            'buildings/warehouse00.png',
            'buildings/smithy.png',
            'buildings/inn.png',
            'buildings/well00.png', 'buildings/well01.png'
        ],
        // Farm sprites (from pop_center_images, loaded as bare filename)
        farm: [
            'farm00.png', 'farm01.png', 'farm02.png', 'farm03.png'
        ],
        // Extra structures that can appear in any settlement
        common: [
            'buildings/well00.png', 'buildings/well01.png',
            'buildings/barn00.png', 'buildings/barnWood00.png',
            'buildings/tent00.png',
            'buildings/sign00.png', 'buildings/sign01.png'
        ]
    },

    // ── Decoration sprite pools — small/medium props placed on empty tiles ──
    DECORATION_SPRITES: {
        village: [
            'buildings/corral00.png', 'buildings/corral01.png', 'buildings/corral02.png',
            'buildings/corral00_cows.png', 'buildings/corral01_cows.png',
            'buildings/pasture00.png', 'buildings/pasture00_sheep.png',
            'buildings/pen00.png', 'buildings/pen00_pigs.png',
            'buildings/foresterHut00.png', 'buildings/foresterHut01.png',
            'buildings/foresterShed00.png',
            'buildings/well03.png', 'buildings/well04.png', 'buildings/well05.png',
            'buildings/tent00.png',
            'buildings/sign00.png', 'buildings/sign01.png'
        ],
        town: [
            'buildings/corral00.png', 'buildings/corral00_cows.png',
            'buildings/pasture00.png', 'buildings/pasture00_sheep.png',
            'buildings/pen00.png', 'buildings/pen00_pigs.png',
            'buildings/cookhouse00.png', 'buildings/windmill00.png',
            'buildings/well03.png', 'buildings/well04.png', 'buildings/well05.png',
            'buildings/loggingCamp00.png', 'buildings/loggingCamp01.png',
            'buildings/foresterHut00.png', 'buildings/foresterShed00.png',
            'buildings/sign00.png', 'buildings/sign01.png'
        ],
        city: [
            'buildings/cookhouse00.png', 'buildings/windmill00.png',
            'buildings/well03.png', 'buildings/well04.png', 'buildings/well05.png',
            'buildings/archeryRange00.png',
            'buildings/corral00_cows.png', 'buildings/corral01_cows.png',
            'buildings/loggingCamp00.png', 'buildings/loggingCamp01.png',
            'buildings/clayPit00.png', 'buildings/clayPit01.png',
            'buildings/scriptorium00.png',
            'buildings/mines00.png', 'buildings/mines01.png',
            'buildings/sign00.png', 'buildings/sign01.png'
        ],
        capital: [
            'buildings/cookhouse00.png', 'buildings/windmill00.png',
            'buildings/well03.png', 'buildings/well04.png', 'buildings/well05.png',
            'buildings/archeryRange00.png',
            'buildings/scriptorium00.png', 'buildings/alchemistsLab00.png',
            'buildings/corral00_cows.png', 'buildings/corral01_cows.png',
            'buildings/clayPit00.png', 'buildings/clayPit01.png',
            'buildings/loggingCamp00.png',
            'buildings/mines02.png', 'buildings/mines03.png',
            'buildings/sign00.png'
        ]
    },
});

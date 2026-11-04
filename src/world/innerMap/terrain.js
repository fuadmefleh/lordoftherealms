// InnerMap — terrain members (split from the original monolith).
import { InnerMap } from './_ref.js';
import { Utils, Hex, CustomObjects, CustomBuildings, CustomInteriors, generateSpriteInterior, SettlementGenerator, DataLoader, Terrain, NpcFamily, Cultures } from './_imports.js';
import { pickNineTileSlot, resolveBrushSeason, resolveNineTileCell, erodeUntileableStubs } from '../../core/nineTile.js';

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

    /**
     * Usable terrain-editor brushes of one category. Brushes saved before the
     * category field existed count as 'terrain', so the default layer keeps
     * working on legacy data.
     * (Terrain editor brushes live in terrainNineTileBrushes — NOT
     * nineTileBrushes, which is building brushes.)
     */
    _getNineTileBrushesByCategory(category) {
        const gd = (typeof DataLoader !== 'undefined') ? DataLoader._gamedata : null;
        const brushes = Array.isArray(gd && gd.terrainNineTileBrushes) ? gd.terrainNineTileBrushes : [];
        return brushes.filter(b => b && Array.isArray(b.tiles) && (b.category || 'terrain') === category);
    },

    _getGrassNineTileBrush() {
        const valid = this._getNineTileBrushesByCategory('terrain');
        if (valid.length) {
            const byName = valid.find(b => /grass|meadow|lawn|turf/i.test(String(b.name || '')));
            if (byName) return byName;
            const hasCenter = valid.find(b => b.tiles[1] && b.tiles[1][1] && b.tiles[1][1].sheetPath);
            if (hasCenter) return hasCenter;
            return valid[0];
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
            // Inside corners: the opaque grass→dirt block carries dedicated
            // concave-corner tiles at rows 3-4, cols 6-7 — a grass field with a
            // dirt diamond-notch biting into one corner. Without these, a grass
            // tile that fully surrounds a diagonal dirt cell falls back to the
            // opaque centre fill and shows a hard 90° notch. IC order matches
            // _pickNineTileInfo (0=TL, 1=TR, 2=BL, 3=BR missing diagonal), i.e.
            // the tile whose dirt bite sits in that corner.
            seasonInsideCorners[season] = [
                { sheetPath: sheet, sx: 7 * 32, sy: 4 * 32 }, // 0: TL missing → bite top-left
                { sheetPath: sheet, sx: 6 * 32, sy: 4 * 32 }, // 1: TR missing → bite top-right
                { sheetPath: sheet, sx: 7 * 32, sy: 3 * 32 }, // 2: BL missing → bite bottom-left
                { sheetPath: sheet, sx: 6 * 32, sy: 3 * 32 }, // 3: BR missing → bite bottom-right
            ];
        }

        this._fallbackGrassBrush = {
            name: 'Grass (Default)',
            tiles: seasonTiles.spring,
            insideCorners: seasonInsideCorners.spring,
            seasonTiles,
            seasonInsideCorners,
        };
        return this._fallbackGrassBrush;
    },

    _getWaterNineTileBrush() {
        // Prefer an explicit category (set in the terrain editor's Type dropdown),
        // fall back to name matching for brushes saved before the field existed.
        const byCategory = this._getNineTileBrushesByCategory('water');
        if (byCategory.length) return byCategory[0];
        const byName = this._getNineTileBrushesByCategory('terrain')
            .find(b => /water|pond|lake|river/i.test(String(b.name || '')));
        if (byName) return byName;
        return this._fallbackWaterBrush(this._waterGround);
    },

    /**
     * Water with a grass shore from the LPC terrain sheets (one per season):
     * the 3×3 shore block at cols 0-2, rows 10-12 (open water in the middle)
     * and the inside corners from the grass-blob-in-water block at cols 0-1,
     * rows 13-14 (each quarter is water with a grass bite in one corner).
     * The open water and the inside corners are impassable; the shore edges
     * stay walkable shallows (as a pond's do).
     * On bare ground (`ground` 'dirt': a map with no grass layer) the shore
     * is the dirt-banked block at cols 6-8 (the same open water in the
     * middle) with the dirt-blob-in-water inside corners at cols 6-7, rows 13-14.
     */
    _fallbackWaterBrush(ground = 'grass') {
        const dirt = ground === 'dirt';
        const key = dirt ? 'dirt' : 'grass';
        this._fallbackWater = this._fallbackWater || {};
        if (this._fallbackWater[key]) return this._fallbackWater[key];
        const c0 = dirt ? 6 : 0;
        const ic0 = dirt ? 6 : 0;
        const seasonTiles = {};
        const seasonInsideCorners = {};
        for (const season of ['spring', 'summer', 'autumn', 'winter']) {
            const sheet = `assets/lpc/Terrain/terrain_${season}.png`;
            const cell = (c, r, impassable = false) => ({ sheetPath: sheet, sx: c * 32, sy: r * 32, ...(impassable ? { impassable: true } : {}) });
            seasonTiles[season] = [
                [cell(c0, 10), cell(c0 + 1, 10), cell(c0 + 2, 10)],
                [cell(c0, 11), cell(1, 11, true), cell(c0 + 2, 11)],
                [cell(c0, 12), cell(c0 + 1, 12), cell(c0 + 2, 12)],
            ];
            // IC order (core/nineTile.js): 0 = TL diagonal is land → the bite of land sits top-left
            seasonInsideCorners[season] = [cell(ic0 + 1, 14, true), cell(ic0, 14, true), cell(ic0 + 1, 13, true), cell(ic0, 13, true)];
        }
        const brush = {
            name: dirt ? 'Water, Dirt Banks (Default)' : 'Water (Default)',
            category: 'water',
            lpcDefault: true,
            tiles: seasonTiles.spring,
            insideCorners: seasonInsideCorners.spring,
            seasonTiles,
            seasonInsideCorners,
        };
        this._fallbackWater[key] = brush;
        return brush;
    },

    /**
     * Is the given brush slot flagged impassable? Flags live on the cell
     * objects (Format A, like object footprint tiles) and are
     * season-independent — a slot counts as blocked if ANY grid carrying it
     * (default or any season) has the flag.
     * @param {Object} brush - nine-tile brush
     * @param {Object} info - {row, col} for the 3×3 grid or {ic} for an inside corner
     */
    _isBrushSlotImpassable(brush, info) {
        const isIC = info.ic !== undefined;
        // Every array that could carry this slot: the default grid plus one per season.
        const rows = isIC
            ? [brush.insideCorners, ...Object.values(brush.seasonInsideCorners || {})]
            : [brush.tiles, ...Object.values(brush.seasonTiles || {})].map(g => g && g[info.row]);
        const idx = isIC ? info.ic : info.col;
        return rows.some(row => !!(row && row[idx] && row[idx].impassable));
    },

    /**
     * Pick the slot of a 9-tile brush for a cell of a boolean mask (see
     * core/nineTile.js, shared with the terrain editor). Returns { row, col }
     * for the 3×3 grid, { ic: 0-3 } for an inside corner, or null when no
     * slot fits (no neighbours on a whole axis).
     */
    _pickNineTileInfo(mask, q, r) {
        const H = mask.length;
        const W = H > 0 ? mask[0].length : 0;
        return pickNineTileSlot((dq, dr) => {
            const nq = q + dq, nr = r + dr;
            return nr >= 0 && nr < H && nq >= 0 && nq < W ? !!mask[nr][nq] : false;
        });
    },

    /**
     * Remove mask cells that have no valid 9-tile representation (one-wide
     * strips and stubs would otherwise fall back to the opaque centre fill and
     * show as hard-edged squares). Mutates the mask.
     */
    _erodeUntileableStubs(mask) {
        erodeUntileableStubs(mask);
    },

    /**
     * Which of a brush's grids apply for a season: a season's grid or inside
     * corners win only when they hold a tile (see core/nineTile.js).
     * @returns {{tilesGrid: Array, cornersArr: Array|null, altFills: Array|null}}
     */
    _resolveBrushSeason(brush, season) {
        return resolveBrushSeason(brush, season);
    },

    /**
     * Auto-tile a boolean mask with a 9-tile brush, writing tile.terrainDetail
     * for every masked tile. Cells with no usable brush tile fall back to
     * `fallbackCategory` fill. `onCell(tile, info)` — if given — is called with
     * the slot actually used, so callers can attach per-slot behaviour.
     */
    _stampNineTileMask(tiles, mask, brush, fallbackCategory, onCell) {
        const H = mask.length;
        const W = H > 0 ? mask[0].length : 0;
        const season = (this.season || 'spring').toLowerCase();
        const resolved = this._resolveBrushSeason(brush, season);

        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (!mask[r][q]) continue;
                const tile = tiles[r][q];
                if (!tile) continue;

                // Strips and inside corners without a tile use the centre fill,
                // so passability follows the slot actually used
                const { slot: info, tile: tileRef } = resolveNineTileCell(brush, season, (dq, dr) => {
                    const nq = q + dq, nr = r + dr;
                    return nr >= 0 && nr < H && nq >= 0 && nq < W ? !!mask[nr][nq] : false;
                }, q, r, resolved);

                tile.terrainDetail = (tileRef && tileRef.sheetPath)
                    ? {
                        sheetPath: tileRef.sheetPath,
                        sx: Number.isFinite(tileRef.sx) ? tileRef.sx : 0,
                        sy: Number.isFinite(tileRef.sy) ? tileRef.sy : 0,
                        sw: 32,
                        sh: 32,
                    }
                    : { fillCategory: fallbackCategory };
                // Tag which layer stamped this cell so later passes (e.g.
                // _refreshGrassLayer) can tell grass cells from water cells.
                tile.terrainDetail.layer = fallbackCategory;

                if (onCell) onCell(tile, info);
            }
        }
    },

    _paintGrassSecondLayer(tiles, worldQ, worldR, townOnly = false) {
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
                if (tile && (tile.isRoad || tile._townSoil)) continue;
                // On stony or dry land only the town's yards and fields are green
                if (townOnly && !(tile._townCore || tile._townFade != null)) continue;
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

        this._erodeUntileableStubs(mask);
        this._stampNineTileMask(tiles, mask, brush, 'grass');
    },

    /**
     * Re-auto-tile the grass layer after bare-ground tiles were added on top
     * of it (roads generated at enter() time, after the map was stamped, or
     * land the player tilled). Road and tilled cells drop out of the grass
     * mask, cells left as untileable stubs are
     * cleared, and the remaining grass is re-stamped so its edges meet the
     * new dirt cleanly instead of showing hard-edged squares.
     * Details saved before the layer tag existed count as grass.
     * @returns {boolean} true if the layer was re-stamped
     */
    _refreshGrassLayer(tiles) {
        const isGrass = (t) => !!(t && t.terrainDetail && (t.terrainDetail.layer || 'grass') === 'grass');
        let stale = false;
        const mask = tiles.map(row => row.map(t => {
            const grass = isGrass(t);
            const bare = !!(t && (t.isRoad || t._tilled || t._townSoil));
            if (grass && bare) stale = true;
            return grass && !bare;
        }));
        if (!stale) return false;

        this._erodeUntileableStubs(mask);
        for (let r = 0; r < tiles.length; r++) {
            for (let q = 0; q < tiles[r].length; q++) {
                const tile = tiles[r][q];
                if (!mask[r][q] && isGrass(tile)) tile.terrainDetail = null;
            }
        }
        this._stampNineTileMask(tiles, mask, this._getGrassNineTileBrush(), 'grass');
        return true;
    },

    // Ponds, rivers, lakes and their shores: world/innerMap/water.js

    /**
     * Generate or retrieve an inner map for a world tile
     * @param {Object} worldTile - The world tile object
     * @param {number} worldQ - World tile q coordinate
     * @param {number} worldR - World tile r coordinate
     * @returns {Array} 2D array of inner map tiles
     */
    getOrGenerate(worldTile, worldQ, worldR, game) {
        const key = `${worldQ},${worldR}_${this.width}x${this.height}`;
        // A settlement founded (or gone) since the map was drawn: lay it out
        // afresh — a village where the clan made camp is no longer wild ground
        // (its name and size and style: a tent village that grows into a town is laid out anew)
        const st = worldTile.settlement;
        const settledAs = st ? `${st.name || 'settlement'}|${st.type || 'village'}|${this._isDawnVillage && this._isDawnVillage(st) ? 'camp' : 'town'}` : null;
        // (the open sea is drawn afresh each time: your ship may be another one)
        if (worldTile.terrain && Terrain.isWaterId(worldTile.terrain.id)) delete this._cache[key];
        const cached = this._cache[key];
        if (cached) {
            // (a map back from a save has lost the marker: then a settlement
            // with no streets on its map is the sign it was drawn wild)
            const was = cached._settledAs;
            const stale = was !== undefined ? was !== settledAs
                : !!settledAs && !cached.some(row => row && row.some(t => t && t.isRoad));
            if (stale) delete this._cache[key];
        }
        if (this._cache[key]) {
            // Update dynamic weather data on cached tiles
            this._refreshWeatherData(this._cache[key], worldQ, worldR, game);
            return this._cache[key];
        }

        const tiles = this.generate(worldTile, worldQ, worldR, game);
        tiles._settledAs = settledAs;
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
        // A lake hex's shores are the land about it (world/innerMap/water.js)
        const landId = terrainId === 'lake' && this._lakeShoreTerrain ? this._lakeShoreTerrain(game && game.world, worldQ, worldR) : terrainId;
        const subTerrains = config && config.subTerrains ? config.subTerrains[landId] : null;

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
        const primaryTerrains = subTerrains ? subTerrains.primary : this._defaultSubTerrains(landId);
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

                // Encounters are placed after the map is built (encounters.js)
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
            // A village of the Dawn of Man: tents round its fires, not streets (world/innerMap/camp.js)
            if (this._isDawnVillage && this._isDawnVillage(worldTile.settlement)) {
                tiles._settlementLayout = this._layVillageCamp(tiles, worldTile.settlement, worldQ, worldR);
            } else if (typeof SettlementGenerator !== 'undefined') {
            // Use the procedural settlement generator (road network + parcels + lots)
                // A world made since terrainGen 3 builds each town of its
                // culture's materials (world/cultures.js); older saves' towns keep their look
                const gp = (game && game.world && game.world.generationParams) || {};
                const palette = (Number(gp.terrainGen) || 1) >= 3 && Cultures.cultureOf(game.world, worldTile.settlement)
                    ? Cultures.palette(worldTile.settlement.culture) : null;
                const genResult = SettlementGenerator.generate(
                    tiles, worldTile.settlement, rng, this.width, this.height, { palette }
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
        const groundBase = this._getBaseTerrain(landId, null);
        if (groundBase === 'grass') {
            this._paintGrassSecondLayer(tiles, worldQ, worldR);
        } else if (worldTile.settlement && ['stone', 'dirt', 'dry_dirt', 'dark_stone'].includes(groundBase)) {
            // A town in the hills (or on the steppe) still keeps its gardens and greens
            this._paintGrassSecondLayer(tiles, worldQ, worldR, true);
        }

        // The water's banks: grass where the ground is grassed, dirt where it is bare
        this._waterGround = (groundBase === 'grass' || groundBase === 'snow' || groundBase === 'ice') ? 'grass' : 'dirt';

        // --- Procedural water features (ponds; world/innerMap/water.js) ---
        // After the grass layer so pond visuals stamp over it, and before
        // player properties / object scatter so those avoid the blocked water.
        this._paintWaterFeatures(tiles, terrainId, rng, worldTile);

        // --- The sea or a lake along the sides that face it; a harbour with its
        // pier and ships in a settlement (world/innerMap/harbour.js; hash-placed) ---
        const atSea = !!(worldTile.terrain && Terrain.isWaterId(worldTile.terrain.id));
        if (this._layHarbour && !atSea) {
            this._layHarbour(tiles, worldTile, worldQ, worldR, game && game.world);
        }
        // --- At sea aboard your own ship: open water, your ship, you on deck ---
        if (this._layOpenSea && atSea) {
            this._layOpenSea(game, tiles, worldTile);
        }
        // --- The hex's river across the map, bridged where a street crosses
        // it; then reeds, lilies and stones along the shores (world/innerMap/water.js; hash-placed) ---
        if (this._layRiver && (!atSea || terrainId === 'lake')) {
            this._layRiver(tiles, worldTile, worldQ, worldR, game && game.world);
        }
        if (this._dressWater) this._dressWater(tiles, worldQ, worldR);

        // --- Player property placement ---
        this._placePlayerProperties(tiles, worldTile, rng);

        // --- A roadhouse on an open road (systems/hospitality.js; hash-placed: draws nothing from rng) ---
        this._placeRoadhouse(tiles, worldTile, worldQ, worldR, game && game.world);

        // --- Crags in mountainous and rocky country, on ground nothing else has
        // taken; before the scatter, which grows round them (world/innerMap/cliffs.js;
        // hash-placed: draws nothing from rng) ---
        if (this._layCliffs) this._layCliffs(tiles, worldTile, worldQ, worldR);

        // --- Scatter custom editor-authored objects on terrain ---
        if (typeof CustomObjects !== 'undefined' && CustomObjects.isLoaded() && CustomObjects.hasAnyBindings()) {
            this._scatterCustomObjects(tiles, rng, game ? (game.world ? (game.world.day || 0) : 0) : 0);
        }

        // --- Wilderness encounters (hash-placed: draws nothing from rng) ---
        this._placeWildEncounters(tiles, worldTile, worldQ, worldR, game);


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

        const parentId = tiles[0] && tiles[0][0] && tiles[0][0].parentTerrain;
        const densities = (this.CONFIG && this.CONFIG.treeDensity) || {};
        const treeDensity = Number.isFinite(densities[parentId]) ? densities[parentId] : 1;

        for (let r = 1; r < H - 1; r++) {
            for (let q = 1; q < W - 1; q++) {
                const tile = tiles[r][q];
                // Only consider passable, unoccupied terrain tiles
                if (!tile.subTerrain.passable) continue;
                // (nor on the shallows at the water's edge, a ford or a bridge)
                if (tile._wet) continue;
                // No wild trees inside a town; fewer the nearer you come to one (world/townPlanner.js)
                if (tile._townCore || tile._townCleared) continue;
                if (tile._townFade != null && rng() > Math.pow(tile._townFade, 1.6)) continue;
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
                // ...and thinner on the heights and in the marsh (data/innerMap.json treeDensity)
                if (def.objectType === 'tree' && treeDensity < 1 && rng() > treeDensity) continue;

                // Verify every footprint tile is in-bounds and free
                let clear = true;
                for (const tDef of def.tiles) {
                    const fr = r + tDef.localRow;
                    const fq = q + tDef.localCol;
                    if (fr <= 0 || fr >= H - 1 || fq <= 0 || fq >= W - 1)
                        { clear = false; break; }
                    const ft = tiles[fr][fq];
                    // ...and never across a building lot (world/townPlanner.js), out over the water or up a crag (cliffs.js)
                    if (ft.building || ft.customObject || ft.customObjectPart || ft.customBuilding || ft.customBuildingPart || ft.isRoad || ft._lot || ft._wet || ft._cragTop !== undefined)
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

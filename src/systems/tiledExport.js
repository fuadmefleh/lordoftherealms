// ============================================
// TILED MAP EDITOR EXPORT / IMPORT
// Converts inner maps ↔ Tiled JSON (.tmj) format
// https://doc.mapeditor.org/en/stable/reference/json-map-format/
// ============================================

import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import { InnerMap } from '../world/innerMap.js';


export const TiledExport = {

    // Tiled format version
    TILED_VERSION: '1.10.2',
    FORMAT_VERSION: '1.10',

    // ══════════════════════════════════════════════
    // EXPORT — Inner Map → Tiled JSON
    // ══════════════════════════════════════════════

    /**
     * Export the current inner map (or a given tile grid) to Tiled JSON format.
     * Produces a .tmj file that Tiled can open directly.
     *
     * @param {Array} tiles - 2D array of inner map tiles (InnerMap.tiles)
     * @param {Object} [opts] - Options
     * @param {string} [opts.season] - Season for terrain sheet (default: 'summer')
     * @param {string} [opts.parentTerrain] - Parent terrain ID
     * @param {number} [opts.worldQ] - World tile Q coordinate
     * @param {number} [opts.worldR] - World tile R coordinate
     * @returns {Object} Tiled JSON map object
     */
    exportToTiled(tiles, opts = {}) {
        if (!tiles || !tiles.length || !tiles[0].length) {
            throw new Error('No tiles to export');
        }

        const height = tiles.length;
        const width = tiles[0].length;
        const season = (opts.season || 'summer').toLowerCase();
        const tileSize = 32;

        // ── Build tileset from the terrain spritesheet ──
        // The LPC terrain sheet is 512×832 = 16 cols × 26 rows = 416 tiles
        const terrainSheet = `assets/lpc/Terrain/terrain_${season}.png`;
        const sheetCols = 16;
        const sheetRows = 26;
        const tileCount = sheetCols * sheetRows;

        // Additional tilesets for overlays
        const rocksSheet = 'assets/lpc/Terrain/Rocks, Grasslands.png';
        const rocksCols = 6;
        const rocksRows = 12;
        const rocksTileCount = rocksCols * rocksRows;

        const treesSheet = `assets/lpc/Terrain/trees_${season}.png`;
        const plantsSheet = `assets/lpc/Terrain/plants_${season}.png`;
        const waterRippleSheet = 'assets/lpc/FX/WaterRipple.png';

        // GID offsets: terrain starts at 1, rocks at tileCount+1, etc.
        const TERRAIN_FIRST_GID = 1;
        const ROCKS_FIRST_GID = tileCount + 1;

        // ── Build terrain fill lookup (baseTerrain → list of {col,row}) ──
        const terrainFills = this._getTerrainFills();

        // ── Layer 0: Terrain (ground fills) ──
        const terrainData = [];
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                const fillCat = tile.baseTerrain || 'grass';
                let fills = terrainFills[fillCat];
                if (!fills || fills.length === 0) {
                    const fb = {
                        dark_green: 'grass', dark_stone: 'stone',
                        dry_dirt: 'dirt', deep_water: 'water', sand: 'dirt'
                    };
                    fills = terrainFills[fb[fillCat]] || terrainFills.grass;
                }
                // Deterministic hash (same as renderer)
                const hash = (Math.abs((tile.q * 73856093 ^ tile.r * 19349663))) >>> 0;
                const pick = fills[hash % fills.length];
                // Tiled GID = row * cols + col + firstgid
                const localId = pick.row * sheetCols + pick.col;
                terrainData.push(TERRAIN_FIRST_GID + localId);
            }
        }

        // ── Layer 1: Object overlays (rocks, trees, etc. as tile layer for simplicity) ──
        // We use 0 for "no tile" in Tiled
        const overlayData = [];
        const overlayMap = this._getOverlayMap();
        const rockSprites = this._getRockSprites();

        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                const subId = tile.subTerrain ? tile.subTerrain.id : null;
                const cat = subId ? overlayMap[subId] : null;

                if (cat === 'rocks') {
                    const hash = (Math.abs((tile.q * 19349663 ^ tile.r * 73856093))) >>> 0;
                    const def = rockSprites[hash % rockSprites.length];
                    const localId = (def.sy / 32) * rocksCols + (def.sx / 32);
                    overlayData.push(ROCKS_FIRST_GID + localId);
                } else {
                    // Trees, plants, water features → object layer instead
                    overlayData.push(0);
                }
            }
        }

        // ── Layer 2: Object group for non-tile overlays (trees, water, buildings) ──
        const objects = [];
        let nextObjId = 1;

        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                const subId = tile.subTerrain ? tile.subTerrain.id : null;
                const cat = subId ? overlayMap[subId] : null;

                // Water/ice overlays
                if (cat === 'water_feature' || cat === 'ice_feature' || cat === 'waterfall') {
                    objects.push({
                        id: nextObjId++,
                        name: tile.subTerrain.name || subId,
                        type: cat,
                        x: q * tileSize,
                        y: r * tileSize,
                        width: tileSize,
                        height: tileSize,
                        rotation: 0,
                        visible: true,
                        properties: [
                            { name: 'subTerrainId', type: 'string', value: subId },
                            { name: 'icon', type: 'string', value: tile.subTerrain.icon || '' },
                            { name: 'passable', type: 'bool', value: tile.subTerrain.passable !== false }
                        ]
                    });
                }

                // Trees / plants / flowers / mushrooms
                if (cat === 'trees' || cat === 'plants' || cat === 'wildflowers' || cat === 'mushrooms') {
                    objects.push({
                        id: nextObjId++,
                        name: tile.subTerrain.name || subId,
                        type: cat,
                        x: q * tileSize,
                        y: r * tileSize,
                        width: tileSize,
                        height: cat === 'trees' ? tileSize * 3 : tileSize,
                        rotation: 0,
                        visible: true,
                        properties: [
                            { name: 'subTerrainId', type: 'string', value: subId },
                            { name: 'icon', type: 'string', value: tile.subTerrain.icon || '' },
                            { name: 'passable', type: 'bool', value: tile.subTerrain.passable !== false }
                        ]
                    });
                }

                // Buildings
                if (tile.building) {
                    objects.push({
                        id: nextObjId++,
                        name: tile.buildingInfo ? tile.buildingInfo.name : tile.building,
                        type: 'building',
                        x: q * tileSize,
                        y: r * tileSize,
                        width: tileSize,
                        height: tileSize,
                        rotation: 0,
                        visible: true,
                        properties: [
                            { name: 'buildingType', type: 'string', value: tile.building },
                            { name: 'buildingIcon', type: 'string', value: tile.buildingInfo ? tile.buildingInfo.icon : '' }
                        ]
                    });
                }

                // Encounters
                if (tile.encounter) {
                    objects.push({
                        id: nextObjId++,
                        name: tile.encounter.name || tile.encounter.key,
                        type: 'encounter',
                        x: q * tileSize,
                        y: r * tileSize,
                        width: tileSize,
                        height: tileSize,
                        rotation: 0,
                        visible: true,
                        properties: [
                            { name: 'encounterKey', type: 'string', value: tile.encounter.key || '' },
                            { name: 'icon', type: 'string', value: tile.encounter.icon || '' },
                            { name: 'description', type: 'string', value: tile.encounter.description || '' },
                            { name: 'discovered', type: 'bool', value: !!tile.encounter.discovered }
                        ]
                    });
                }
            }
        }

        // ── Layer 3: Metadata tile properties (stored as object layer) ──
        // Encodes per-tile custom properties that Tiled can't store in tile layers
        const metaObjects = [];
        let metaObjId = nextObjId;

        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                metaObjects.push({
                    id: metaObjId++,
                    name: `tile_${q}_${r}`,
                    type: 'tile_meta',
                    x: q * tileSize,
                    y: r * tileSize,
                    width: tileSize,
                    height: tileSize,
                    rotation: 0,
                    visible: false,
                    properties: [
                        { name: 'q', type: 'int', value: q },
                        { name: 'r', type: 'int', value: r },
                        { name: 'baseTerrain', type: 'string', value: tile.baseTerrain || 'grass' },
                        { name: 'subTerrainId', type: 'string', value: tile.subTerrain ? tile.subTerrain.id : '' },
                        { name: 'subTerrainName', type: 'string', value: tile.subTerrain ? tile.subTerrain.name : '' },
                        { name: 'subTerrainIcon', type: 'string', value: tile.subTerrain ? tile.subTerrain.icon : '' },
                        { name: 'subTerrainColor', type: 'string', value: tile.subTerrain ? tile.subTerrain.color : '' },
                        { name: 'passable', type: 'bool', value: tile.subTerrain ? tile.subTerrain.passable !== false : true },
                        { name: 'parentTerrain', type: 'string', value: tile.parentTerrain || '' },
                        { name: 'explored', type: 'bool', value: !!tile.explored },
                        { name: 'visible', type: 'bool', value: !!tile.visible },
                        { name: 'building', type: 'string', value: tile.building || '' }
                    ]
                });
            }
        }

        // ── Assemble the Tiled JSON map ──
        const map = {
            compressionlevel: -1,
            height: height,
            infinite: false,
            layers: [
                {
                    id: 1,
                    name: 'terrain',
                    type: 'tilelayer',
                    visible: true,
                    opacity: 1,
                    x: 0, y: 0,
                    width: width,
                    height: height,
                    data: terrainData
                },
                {
                    id: 2,
                    name: 'rocks',
                    type: 'tilelayer',
                    visible: true,
                    opacity: 1,
                    x: 0, y: 0,
                    width: width,
                    height: height,
                    data: overlayData
                },
                {
                    id: 3,
                    name: 'objects',
                    type: 'objectgroup',
                    visible: true,
                    opacity: 1,
                    draworder: 'topdown',
                    x: 0, y: 0,
                    objects: objects
                },
                {
                    id: 4,
                    name: 'tile_metadata',
                    type: 'objectgroup',
                    visible: false,
                    opacity: 1,
                    draworder: 'index',
                    x: 0, y: 0,
                    objects: metaObjects
                }
            ],
            nextlayerid: 5,
            nextobjectid: metaObjId,
            orientation: 'orthogonal',
            renderorder: 'right-down',
            tiledversion: this.TILED_VERSION,
            tileheight: tileSize,
            tilewidth: tileSize,
            tilesets: [
                {
                    columns: sheetCols,
                    firstgid: TERRAIN_FIRST_GID,
                    image: terrainSheet,
                    imageheight: sheetRows * tileSize,
                    imagewidth: sheetCols * tileSize,
                    margin: 0,
                    name: `terrain_${season}`,
                    spacing: 0,
                    tilecount: tileCount,
                    tileheight: tileSize,
                    tilewidth: tileSize
                },
                {
                    columns: rocksCols,
                    firstgid: ROCKS_FIRST_GID,
                    image: rocksSheet,
                    imageheight: rocksRows * tileSize,
                    imagewidth: rocksCols * tileSize,
                    margin: 0,
                    name: 'rocks_grasslands',
                    spacing: 0,
                    tilecount: rocksTileCount,
                    tileheight: tileSize,
                    tilewidth: tileSize
                }
            ],
            type: 'map',
            version: this.FORMAT_VERSION,
            width: width,
            properties: [
                { name: 'parentTerrain', type: 'string', value: opts.parentTerrain || '' },
                { name: 'worldQ', type: 'int', value: opts.worldQ !== undefined ? opts.worldQ : 0 },
                { name: 'worldR', type: 'int', value: opts.worldR !== undefined ? opts.worldR : 0 },
                { name: 'season', type: 'string', value: season },
                { name: 'generator', type: 'string', value: 'lord_of_the_realms' },
                { name: 'exportVersion', type: 'int', value: 1 }
            ]
        };

        return map;
    },

    /**
     * Export and trigger a browser download of the .tmj file.
     * @param {Array} tiles - 2D tile grid
     * @param {Object} [opts] - Same as exportToTiled
     * @param {string} [filename] - Download filename
     */
    downloadTiled(tiles, opts = {}, filename) {
        const map = this.exportToTiled(tiles, opts);
        const json = JSON.stringify(map, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename || this._makeFilename(opts);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    _makeFilename(opts) {
        const parts = ['innermap'];
        if (opts.parentTerrain) parts.push(opts.parentTerrain);
        if (opts.worldQ !== undefined) parts.push(`${opts.worldQ}_${opts.worldR}`);
        if (opts.season) parts.push(opts.season);
        return parts.join('_') + '.tmj';
    },

    // ══════════════════════════════════════════════
    // IMPORT — Tiled JSON → Inner Map tiles
    // ══════════════════════════════════════════════

    /**
     * Import a Tiled JSON map into inner map tile format.
     * Reads the terrain tile layer to reconstruct baseTerrain,
     * and the metadata object layer to reconstruct subTerrain/encounters.
     *
     * @param {Object|string} tiledJson - Tiled JSON object or JSON string
     * @returns {Object} { tiles, width, height, parentTerrain, season, worldQ, worldR }
     */
    importFromTiled(tiledJson) {
        const map = typeof tiledJson === 'string' ? JSON.parse(tiledJson) : tiledJson;

        if (!map || !map.layers) {
            throw new Error('Invalid Tiled map: missing layers');
        }

        const width = map.width;
        const height = map.height;
        const tileSize = map.tilewidth || 32;

        // Extract map-level properties
        const mapProps = this._propsToObj(map.properties);
        const parentTerrain = mapProps.parentTerrain || 'grassland';
        const season = mapProps.season || 'summer';
        const worldQ = mapProps.worldQ || 0;
        const worldR = mapProps.worldR || 0;

        // Find layers by name
        const terrainLayer = map.layers.find(l => l.name === 'terrain' && l.type === 'tilelayer');
        const objectLayer = map.layers.find(l => l.name === 'objects' && l.type === 'objectgroup');
        const metaLayer = map.layers.find(l => l.name === 'tile_metadata' && l.type === 'objectgroup');

        // Build tileset GID → {col, row} reverse lookup for terrain
        const terrainTileset = map.tilesets.find(ts => ts.name && ts.name.startsWith('terrain'));
        const terrainFirstGid = terrainTileset ? terrainTileset.firstgid : 1;
        const terrainCols = terrainTileset ? terrainTileset.columns : 16;

        // Reverse lookup: terrain fill {col,row} → baseTerrain category
        const fillToBase = this._buildFillToBaseMap();

        // ── Parse metadata layer (richest source of tile info) ──
        const metaByPos = {};
        if (metaLayer && metaLayer.objects) {
            for (const obj of metaLayer.objects) {
                const props = this._propsToObj(obj.properties);
                const q = props.q !== undefined ? props.q : Math.floor(obj.x / tileSize);
                const r = props.r !== undefined ? props.r : Math.floor(obj.y / tileSize);
                metaByPos[`${q},${r}`] = props;
            }
        }

        // ── Parse object layer ──
        const objectsByPos = {};
        if (objectLayer && objectLayer.objects) {
            for (const obj of objectLayer.objects) {
                const q = Math.floor(obj.x / tileSize);
                const r = Math.floor(obj.y / tileSize);
                const key = `${q},${r}`;
                if (!objectsByPos[key]) objectsByPos[key] = [];
                objectsByPos[key].push(obj);
            }
        }

        // ── Reconstruct tiles ──
        const tiles = [];
        for (let r = 0; r < height; r++) {
            const row = [];
            for (let q = 0; q < width; q++) {
                const key = `${q},${r}`;
                const meta = metaByPos[key] || {};

                // Get baseTerrain from metadata or derive from terrain tile GID
                let baseTerrain = meta.baseTerrain || 'grass';
                if (!meta.baseTerrain && terrainLayer && terrainLayer.data) {
                    const gid = terrainLayer.data[r * width + q];
                    if (gid > 0) {
                        const localId = gid - terrainFirstGid;
                        const col = localId % terrainCols;
                        const tileRow = Math.floor(localId / terrainCols);
                        baseTerrain = fillToBase[`${col},${tileRow}`] || 'grass';
                    }
                }

                // Build subTerrain from metadata
                const subTerrain = {
                    id: meta.subTerrainId || baseTerrain,
                    name: meta.subTerrainName || meta.subTerrainId || baseTerrain,
                    icon: meta.subTerrainIcon || '🌿',
                    color: meta.subTerrainColor || '#4B8434',
                    passable: meta.passable !== undefined ? meta.passable : true
                };

                // Check for buildings in objects
                let building = meta.building || null;
                let buildingInfo = null;
                const objsHere = objectsByPos[key] || [];
                for (const obj of objsHere) {
                    if (obj.type === 'building') {
                        const bProps = this._propsToObj(obj.properties);
                        building = bProps.buildingType || obj.name;
                        buildingInfo = {
                            name: obj.name,
                            icon: bProps.buildingIcon || '🏠'
                        };
                    }
                }

                // Check for encounters in objects
                let encounter = null;
                for (const obj of objsHere) {
                    if (obj.type === 'encounter') {
                        const eProps = this._propsToObj(obj.properties);
                        encounter = {
                            key: eProps.encounterKey || obj.name,
                            name: obj.name,
                            icon: eProps.icon || '❓',
                            description: eProps.description || '',
                            discovered: eProps.discovered || false
                        };
                    }
                }

                row.push({
                    q, r,
                    baseTerrain,
                    subTerrain,
                    encounter,
                    explored: meta.explored !== undefined ? meta.explored : false,
                    visible: meta.visible !== undefined ? meta.visible : false,
                    parentTerrain: meta.parentTerrain || parentTerrain,
                    building: building || null,
                    buildingInfo: buildingInfo,
                    effectiveTemp: 0.5,
                    moisture: 0.5,
                    weatherType: 'clear'
                });
            }
            tiles.push(row);
        }

        return {
            tiles,
            width,
            height,
            parentTerrain,
            season,
            worldQ,
            worldR
        };
    },

    /**
     * Import from a File object (from <input type="file">).
     * Returns a Promise that resolves to the import result.
     * @param {File} file
     * @returns {Promise<Object>}
     */
    importFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const result = this.importFromTiled(reader.result);
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    },

    /**
     * Apply an imported map to the InnerMap system, replacing the cache entry
     * for the given world coordinates.
     *
     * @param {Object} imported - Result from importFromTiled
     * @param {Object} [overrides] - Optional overrides { worldQ, worldR }
     */
    applyImport(imported, overrides = {}) {
        const wq = overrides.worldQ !== undefined ? overrides.worldQ : imported.worldQ;
        const wr = overrides.worldR !== undefined ? overrides.worldR : imported.worldR;

        // Resize if needed
        if (imported.width !== InnerMap.width || imported.height !== InnerMap.height) {
            console.warn(`Imported map size ${imported.width}x${imported.height} differs from current ${InnerMap.width}x${InnerMap.height}. Using imported size.`);
        }

        // Store in cache
        const key = `${wq},${wr}_${imported.width}x${imported.height}`;
        InnerMap._cache[key] = imported.tiles;

        // If we're currently viewing this tile, update live
        if (InnerMap.active && InnerMap.currentWorldTile &&
            InnerMap.currentWorldTile.q === wq && InnerMap.currentWorldTile.r === wr) {
            InnerMap.tiles = imported.tiles;
            InnerMap.width = imported.width;
            InnerMap.height = imported.height;
        }

        console.log(`Tiled import applied to cache key: ${key}`);
        return key;
    },

    // ══════════════════════════════════════════════
    // INTERNAL HELPERS
    // ══════════════════════════════════════════════

    /** Convert Tiled properties array to a plain object */
    _propsToObj(props) {
        const obj = {};
        if (!props) return obj;
        for (const p of props) {
            obj[p.name] = p.value;
        }
        return obj;
    },

    /** Terrain fill definitions — reads from InnerMapRenderer if loaded, otherwise uses built-in fallback */
    _getTerrainFills() {
        // Prefer the renderer's fills (which are loaded from terrain.json)
        if (typeof InnerMapRenderer !== 'undefined' && InnerMapRenderer._terrainFills) {
            return InnerMapRenderer._terrainFills;
        }
        // Fallback for headless / test contexts
        return this._getDefaultTerrainFills();
    },

    /** Hardcoded fallback fills — only used if InnerMapRenderer hasn't loaded terrain.json */
    _getDefaultTerrainFills() {
        return {
            grass: [
                { col: 1, row: 1 }, { col: 3, row: 1 }, { col: 4, row: 1 },
                { col: 5, row: 1 }, { col: 3, row: 2 }, { col: 4, row: 2 },
                { col: 5, row: 2 },
            ],
            dirt: [
                { col: 3, row: 3 }, { col: 4, row: 3 }, { col: 5, row: 3 },
                { col: 3, row: 4 }, { col: 4, row: 4 }, { col: 5, row: 4 },
            ],
            sand: [
                { col: 10, row: 1 }, { col: 3, row: 5 },
                { col: 4, row: 5 }, { col: 5, row: 5 },
            ],
            dry_dirt: [
                { col: 3, row: 6 }, { col: 4, row: 6 }, { col: 10, row: 6 },
                { col: 9, row: 9 }, { col: 10, row: 9 },
            ],
            water: [
                { col: 1, row: 11 }, { col: 1, row: 21 },
                { col: 12, row: 16 }, { col: 13, row: 16 },
                { col: 14, row: 16 }, { col: 15, row: 16 },
                { col: 12, row: 17 }, { col: 13, row: 17 },
                { col: 14, row: 17 }, { col: 15, row: 17 },
            ],
            deep_water: [
                { col: 1, row: 24 },
            ],
            stone: [
                { col: 3, row: 3 }, { col: 4, row: 3 }, { col: 5, row: 3 },
                { col: 3, row: 4 }, { col: 4, row: 4 }, { col: 5, row: 4 },
            ],
            dark_stone: [
                { col: 3, row: 3 }, { col: 4, row: 3 }, { col: 5, row: 3 },
                { col: 3, row: 4 }, { col: 4, row: 4 }, { col: 5, row: 4 },
            ],
        };
    },

    /** Overlay map — mirrors InnerMapRenderer._OVERLAY_MAP */
    _getOverlayMap() {
        return {
            deciduous_trees: 'trees', light_trees: 'trees',
            pine_trees: 'trees', pine_grove: 'trees',
            palm_tree: 'trees', palm_grove: 'trees', coconut_tree: 'trees',
            acacia_tree: 'trees', fruit_trees: 'trees', dead_trees: 'trees',
            moss_trees: 'trees', ancient_tree: 'trees',
            giant_ferns: 'trees', vine_canopy: 'trees',
            jungle_thick: 'trees', bamboo: 'trees',
            bush: 'plants', scrub: 'plants', tall_grass: 'plants',
            dense_brush: 'plants', underbrush: 'plants', thicket: 'plants',
            flowers: 'wildflowers', wildflowers: 'wildflowers',
            mushrooms: 'mushrooms',
            rocks: 'rocks', rocky_outcrop: 'rocks', bare_rock: 'rocks',
            rocky_ground: 'rocks', scree: 'rocks',
            pond: 'water_feature', shallow_water: 'water_feature',
            stream: 'water_feature', brook: 'water_feature',
            mountain_stream: 'water_feature', river: 'water_feature',
            pool: 'water_feature', lagoon: 'water_feature',
            tide_pools: 'water_feature', oasis_small: 'water_feature',
            watering_hole: 'water_feature', lily_pads: 'water_feature',
            moss_bank: 'water_feature', murky_water: 'water_feature',
            spring: 'water_feature',
            frozen_stream: 'ice_feature', frozen_pool: 'ice_feature',
            frozen_lake: 'ice_feature', ice_sheet: 'ice_feature',
            glacier: 'ice_feature', thick_ice: 'ice_feature',
            ice_spire: 'ice_feature',
            waterfall: 'waterfall',
        };
    },

    /** Rock sprite definitions — mirrors InnerMapRenderer._ROCK_SPRITES */
    _getRockSprites() {
        return [
            { sx: 0, sy: 0, sw: 32, sh: 32 },
            { sx: 32, sy: 0, sw: 32, sh: 32 },
            { sx: 64, sy: 0, sw: 32, sh: 32 },
            { sx: 96, sy: 0, sw: 32, sh: 32 },
            { sx: 0, sy: 32, sw: 32, sh: 32 },
            { sx: 32, sy: 32, sw: 32, sh: 32 },
            { sx: 64, sy: 32, sw: 32, sh: 32 },
        ];
    },

    /**
     * Build reverse lookup: "col,row" → baseTerrain category.
     * Used during import to derive baseTerrain from the placed terrain GID.
     */
    _buildFillToBaseMap() {
        const fills = this._getTerrainFills();
        const map = {};
        for (const [category, tiles] of Object.entries(fills)) {
            for (const t of tiles) {
                map[`${t.col},${t.row}`] = category;
            }
        }
        return map;
    },
};

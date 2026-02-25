// ============================================
// INNER MAP — Sub-tile exploration system
// Each world hex has an inner map (smaller hex grid)
// Players can enter and explore the interior of any tile
// Now features: named buildings, roads, NPCs, market, time system
// ============================================

const InnerMap = {
    // Configuration (loaded from JSON)
    CONFIG: null,
    
    // Cache of generated inner maps keyed by "q,r"
    _cache: {},

    // Current inner map state
    active: false,
    currentWorldTile: null,   // { q, r } of the world tile we're exploring
    tiles: [],                // 2D array of inner map tiles
    width: 8,
    height: 8,
    playerInnerQ: 4,          // Player position within inner map
    playerInnerR: 3,
    
    // Discovered encounters on the inner map (keyed by "q,r")
    _discoveredEncounters: {},

    // ── Time system ──────────────────────────────────────
    // 1 real-time minute = 1 in-game hour, 24 hours = 1 day
    timeOfDay: 8,              // Current hour (0-23), start at 8 AM
    _timeAccumulator: 0,       // Accumulates real-time seconds
    TIME_SCALE: 60,            // Seconds of real time per in-game hour
    dayEnded: false,           // Flag to show end-of-day modal once

    // ── Weather snapshot (set when entering) ────────────
    weather: null,             // { type, intensity } from world weather
    temperature: null,         // { value, celsius, fahrenheit } from world weather
    season: null,              // Current season string

    // ── Player walking state ──────────────────────────────
    _playerPath: null,         // Array of { q, r } steps to walk
    _playerPathIndex: 0,       // Current index in _playerPath
    _playerMoveProgress: 0,    // 0-1 interpolation between current and next tile
    _playerPrevQ: 4,           // Previous tile position (for interpolation)
    _playerPrevR: 3,
    _playerWalking: false,     // Is the player currently walking?
    _playerSpeed: 4.0,         // Tiles per second walk speed
    _playerArrivalResult: null, // Deferred arrival result for game.js to pick up

    // ── Object interaction state ─────────────────────────
    _pendingInteraction: null,  // { anchorQ, anchorR, defId } — set when walking toward an object
    _activeInteraction: null,   // { anchorQ, anchorR, defId, elapsed, duration, fading }

    // ── NPC system ───────────────────────────────────────
    npcs: [],                  // Array of NPC objects on the inner map
    _npcMoveTimer: 0,          // Timer for NPC movement ticks

    // ── Building data for current inner map ──────────────
    buildings: [],             // Array of { q, r, type, name, icon, sprite, actions[] }
    roads: [],                 // Array of { q, r } tiles that are roads

    // ── Pending position for property built from inner map ──
    _pendingPropertyPosition: null,   // { q, r } inner map coords

    /**
     * Initialize with data from JSON
     */
    initialize(data) {
        this.CONFIG = data;
        if (data.innerMapSize) {
            this.width = data.innerMapSize.width;
            this.height = data.innerMapSize.height;
        }
    },

    // ══════════════════════════════════════════════
    // NAMED BUILDING TYPES — buildings the player can visit
    // ══════════════════════════════════════════════
    BUILDING_TYPES: {
        town_hall:    { name: 'Town Hall',     icon: '🏛️', sprite: 'buildings/walledCity.png',       actions: ['talk_official', 'view_notices', 'pay_taxes'] },
        marketplace:  { name: 'Marketplace',   icon: '🏪', sprite: 'buildings/marketplace00.png',    actions: ['trade', 'browse_goods', 'talk_merchant'] },
        tavern:       { name: 'Tavern',        icon: '🍺', sprite: 'buildings/inn.png',              actions: ['tavern', 'rest', 'buy_drink', 'talk_locals', 'recruit'] },
        blacksmith:   { name: 'Blacksmith',    icon: '⚒️', sprite: 'buildings/smithy.png',           actions: ['buy_weapons', 'buy_tools', 'repair'] },
        church:       { name: 'Church',        icon: '⛪', sprite: 'buildings/church00.png',          actions: ['pray', 'donate', 'meditate', 'talk_priest'] },
        temple:       { name: 'Temple',        icon: '🕌', sprite: 'buildings/temple.png',            actions: ['pray', 'donate', 'meditate', 'seek_blessing'] },
        barracks:     { name: 'Barracks',      icon: '🏰', sprite: 'buildings/barracks00.png',        actions: ['recruit', 'train_combat', 'talk_captain'] },
        granary:      { name: 'Granary',       icon: '🌾', sprite: 'buildings/granary00.png',         actions: ['buy_food', 'store_goods'] },
        warehouse:    { name: 'Warehouse',     icon: '📦', sprite: 'buildings/warehouse00.png',       actions: ['store_goods', 'collect_goods'] },
        well:         { name: 'Well',          icon: '💧', sprite: 'buildings/well00.png',            actions: ['rest', 'talk_locals'] },
        barn:         { name: 'Barn',          icon: '🏚️', sprite: 'buildings/barn00.png',            actions: ['rest', 'forage'] },
        house:        { name: 'House',         icon: '🏠', sprite: 'buildings/villageSmall00.png',    actions: ['talk_locals', 'ask_directions'] },
        manor:        { name: 'Manor',         icon: '🏘️', sprite: 'buildings/village00.png',         actions: ['talk_official', 'seek_audience'] },
        stable:       { name: 'Stable',        icon: '🐴', sprite: 'buildings/barnWood00.png',        actions: ['buy_horse', 'stable_horse'] },
        guard_tower:  { name: 'Guard Tower',   icon: '🗼', sprite: 'buildings/barracks00.png',        actions: ['talk_guard', 'report_crime'] },
        farm:         { name: 'Farm',           icon: '🌾', sprite: 'farm00.png',                         actions: ['buy_food', 'forage', 'talk_locals'] },
    },

    // ══════════════════════════════════════════════
    // PROPERTY SPRITES — sprites for player-built properties
    // ══════════════════════════════════════════════
    PROPERTY_SPRITES: {
        farm:          ['farm00.png', 'farm01.png', 'farm02.png', 'farm03.png'],
        pasture:       ['buildings/pasture00_sheep.png', 'buildings/corral00.png', 'buildings/corral01.png'],
        logging_camp:  ['buildings/loggingCamp00.png', 'buildings/loggingCamp01.png'],
        mine:          ['buildings/mines00.png', 'buildings/mines01.png', 'buildings/mines02.png', 'buildings/mines03.png'],
        workshop:      ['buildings/smithy.png'],
        trading_post:  ['buildings/marketplace00.png'],
        fishing_wharf: ['buildings/warehouse00.png'],
        brewery:       ['buildings/cookhouse00.png'],
        tavern:        ['buildings/inn.png'],
    },

    // ══════════════════════════════════════════════
    // PROPERTY BUILDING DEFS — label/action definitions for player properties
    // ══════════════════════════════════════════════
    PROPERTY_BUILDING_DEFS: {
        farm:          { name: 'Farm',          icon: '🌾', actions: ['manage_property', 'collect_goods'] },
        pasture:       { name: 'Pasture',       icon: '🐑', actions: ['manage_property', 'collect_goods'] },
        logging_camp:  { name: 'Logging Camp',  icon: '🪓', actions: ['manage_property', 'collect_goods'] },
        mine:          { name: 'Mine',          icon: '⛏️', actions: ['manage_property', 'collect_goods'] },
        workshop:      { name: 'Workshop',      icon: '🔨', actions: ['manage_property', 'collect_goods'] },
        trading_post:  { name: 'Trading Post',  icon: '🏪', actions: ['manage_property'] },
        fishing_wharf: { name: 'Fishing Wharf', icon: '⚓', actions: ['manage_property', 'collect_goods'] },
        brewery:       { name: 'Brewery',       icon: '🍺', actions: ['manage_property', 'collect_goods'] },
        tavern:        { name: 'Tavern',        icon: '🍻', actions: ['manage_property'] },
    },

    // ══════════════════════════════════════════════
    // SETTLEMENT BUILDING LAYOUTS — which buildings each settlement type gets
    // ══════════════════════════════════════════════
    SETTLEMENT_BUILDINGS: {
        village: {
            required: ['tavern', 'well'],
            optional: ['house', 'house', 'house', 'barn', 'granary', 'stable', 'farm', 'farm'],
            maxBuildings: 7
        },
        town: {
            required: ['marketplace', 'tavern', 'blacksmith', 'church', 'granary'],
            optional: ['house', 'house', 'house', 'house', 'barn', 'stable', 'warehouse', 'guard_tower', 'manor', 'farm', 'farm', 'farm'],
            maxBuildings: 14
        },
        city: {
            required: ['marketplace', 'tavern', 'blacksmith', 'church', 'barracks', 'granary', 'warehouse'],
            optional: ['house', 'house', 'house', 'house', 'house', 'temple', 'stable', 'guard_tower', 'manor', 'barn', 'farm', 'farm', 'farm'],
            maxBuildings: 18
        },
        capital: {
            required: ['town_hall', 'marketplace', 'tavern', 'blacksmith', 'church', 'temple', 'barracks', 'granary', 'warehouse'],
            optional: ['house', 'house', 'house', 'house', 'house', 'house', 'stable', 'guard_tower', 'guard_tower', 'manor', 'manor', 'barn', 'farm', 'farm', 'farm', 'farm'],
            maxBuildings: 22
        }
    },

    // ══════════════════════════════════════════════
    // NPC TYPES — townspeople that walk around the inner map
    // ══════════════════════════════════════════════
    NPC_TYPES: {
        merchant:    { name: 'Merchant',     icon: '🧑‍💼', speed: 0.4, destinations: ['marketplace', 'warehouse', 'tavern'] },
        guard:       { name: 'Guard',        icon: '💂', speed: 0.3, destinations: ['guard_tower', 'barracks', 'town_hall', 'gate'] },
        farmer:      { name: 'Farmer',       icon: '🧑‍🌾', speed: 0.5, destinations: ['farm', 'granary', 'marketplace', 'barn', 'well'] },
        priest:      { name: 'Priest',       icon: '🧑‍⚖️', speed: 0.3, destinations: ['church', 'temple', 'well'] },
        blacksmith_npc: { name: 'Blacksmith', icon: '⚒️', speed: 0.3, destinations: ['blacksmith', 'marketplace', 'tavern'] },
        villager:    { name: 'Villager',     icon: '🧑', speed: 0.5, destinations: ['house', 'marketplace', 'tavern', 'well', 'church'] },
        child:       { name: 'Child',        icon: '👦', speed: 0.7, destinations: ['house', 'well', 'tavern'] },
        noble:       { name: 'Noble',        icon: '🤴', speed: 0.3, destinations: ['town_hall', 'church', 'manor', 'marketplace'] },
        traveler:    { name: 'Traveler',     icon: '🧳', speed: 0.5, destinations: ['tavern', 'marketplace', 'stable'] },
        beggar:      { name: 'Beggar',       icon: '🧎', speed: 0.2, destinations: ['marketplace', 'church', 'tavern', 'well'] },
    },

    // NPC pool per settlement type
    NPC_POOLS: {
        village:  { villager: 4, farmer: 2, child: 2, merchant: 1, traveler: 1 },
        town:     { villager: 6, merchant: 3, guard: 2, farmer: 2, priest: 1, blacksmith_npc: 1, child: 3, traveler: 2 },
        city:     { villager: 8, merchant: 4, guard: 4, farmer: 2, priest: 2, blacksmith_npc: 1, noble: 2, child: 4, traveler: 3, beggar: 1 },
        capital:  { villager: 10, merchant: 6, guard: 6, farmer: 3, priest: 3, blacksmith_npc: 2, noble: 4, child: 5, traveler: 4, beggar: 2 },
    },

    // Map dimensions per settlement type  { min, max } (square maps)
    SETTLEMENT_MAP_SIZES: {
        village:  { min: 40, max: 50 },
        town:     { min: 50, max: 60 },
        city:     { min: 70, max: 80 },
        capital:  { min: 95, max: 120 },
    },

    // ══════════════════════════════════════════════
    // BASE TERRAIN MAPPING — like C# Generate() biome switch
    // Maps parent terrain ID → base fill category used by the renderer.
    // Sub-terrains can optionally override via a "baseTerrain" field
    // in their JSON definition (e.g. pond → 'water', dirt_path → 'dirt').
    // ══════════════════════════════════════════════
    PARENT_TO_BASE_TERRAIN: {
        grassland:            'grass',
        plains:               'grass',
        woodland:             'grass',   // no dark_green fills in spritesheet; trees are overlays
        forest:               'grass',
        dense_forest:         'grass',
        seasonal_forest:      'grass',
        boreal_forest:        'grass',
        temperate_rainforest: 'grass',
        tropical_rainforest:  'grass',
        desert:               'sand',
        savanna:              'dry_dirt',
        mountain:             'stone',
        snow_peak:            'stone',
        hills:                'stone',
        highlands:            'stone',
        swamp:                'dark_stone',
        tundra:               'dirt',
        snow:                 'grass',   // seasonal sheet swap handles visuals
        ice:                  'water',
        beach:                'sand',
        island:               'sand',
    },

    // Sub-terrain IDs that override the parent's base terrain.
    // Only listed for sub-terrains whose ground fill differs from their parent.
    SUB_TO_BASE_TERRAIN: {
        dirt:      'dirt',
        mud:       'dirt',
        rocks:     'stone',
        cliff:     'stone',
        ice:       'stone',
        sand:      'sand',
        dry_grass: 'dry_dirt',
        bog:       'dark_stone',
    },

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
        // Set map dimensions based on settlement type
        if (worldTile.settlement) {
            const sType = worldTile.settlement.type || 'village';
            const sz = this.SETTLEMENT_MAP_SIZES[sType] || this.SETTLEMENT_MAP_SIZES.village;
            // Deterministic size from world coords within [min, max]
            const hash = ((worldQ * 73856093 ^ worldR * 19349663) >>> 0) % (sz.max - sz.min + 1);
            this.width = sz.min + hash;
            this.height = sz.min + hash;
        } else {
            this.width = this.CONFIG && this.CONFIG.innerMapSize ? this.CONFIG.innerMapSize.width : 20;
            this.height = this.CONFIG && this.CONFIG.innerMapSize ? this.CONFIG.innerMapSize.height : 20;
        }

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

                // Determine base terrain fill — like C#'s tileType
                const baseTerrain = this._getBaseTerrain(terrainId, selectedTerrain.id);

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
        if (worldTile.settlement) {
            const customOnly = window.gameOptions?.customBuildingsOnly &&
                               typeof CustomBuildings !== 'undefined' &&
                               CustomBuildings.isLoaded() && CustomBuildings.hasAny();
            if (!customOnly) {
                this._placeBuildings(tiles, worldTile.settlement, rng);
            }
            // Place custom editor-authored buildings (always, or exclusively when customOnly)
            if (typeof CustomBuildings !== 'undefined' && CustomBuildings.isLoaded() && CustomBuildings.hasAny()) {
                this._placeCustomBuildings(tiles, worldTile.settlement, rng);
            }
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

        // Build set of object IDs that are only spawned via spawnAfter
        // (e.g. stumps) — these should never be auto-scattered.
        const spawnAfterIds = new Set();
        for (const d of CustomObjects.getAllDefs()) {
            if (d.spawnAfter) spawnAfterIds.add(d.spawnAfter);
        }

        // Helper: is this def eligible for auto-scatter?
        function canScatter(def) {
            if (!def) return false;
            // 'other' type objects are not auto-scattered (placed via game events)
            if (def.objectType === 'other') return false;
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

                // Per-tile spawn roll (~8% base)
                if (rng() > 0.08) continue;

                // Weighted-random pick from the combined pool
                const total = pool.reduce((s, d) => s + (d.spawnWeight || 1), 0);
                let roll = rng() * total;
                let def = pool[pool.length - 1];
                for (const d of pool) {
                    roll -= (d.spawnWeight || 1);
                    if (roll <= 0) { def = d; break; }
                }
                if (!def || !def.tiles || def.tiles.length === 0) continue;

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
                }
                if (!clear) continue;

                // ── Place anchor ──
                const customObj = { defId: def.id, sheetPath: def.sheetPath, currentHealthPct: 100 };
                if (def.resource) customObj.resource = def.resource;
                // Record planting day so growth stages can be computed at render time
                if (def.growthStates && def.growthStates.length > 0) {
                    customObj.growthDayPlanted = currentDay;
                }
                tile.customObject = customObj;

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
                    if (tDef.impassable) {
                        ft.subTerrain.passable = false;
                    }
                }
            }
        }
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

    /**
     * Place buildings on inner-map tiles for a settlement.
     * Building density depends on settlement type.
     */
    _placeBuildings(tiles, settlement, rng) {
        const type = settlement.type || 'village';
        const pop = settlement.population || 50;

        // Determine how many building tiles to place
        let buildingCount;
        switch (type) {
            case 'capital': buildingCount = Math.min(50, 18 + Math.floor(pop / 150)); break;
            case 'city':    buildingCount = Math.min(40, 14 + Math.floor(pop / 150)); break;
            case 'town':    buildingCount = Math.min(30, 10 + Math.floor(pop / 120)); break;
            default:        buildingCount = Math.min(20, 6  + Math.floor(pop / 80));  break;
        }

        const sprites = this.BUILDING_SPRITES[type] || this.BUILDING_SPRITES.village;
        const commonSprites = this.BUILDING_SPRITES.common;

        // Collect candidate tiles: passable, non-edge
        const centerQ = Math.floor(this.width / 2);
        const centerR = Math.floor(this.height / 2);
        const candidates = [];
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const t = tiles[r][q];
                const isEdge = q === 0 || q === this.width - 1 || r === 0 || r === this.height - 1;
                if (isEdge) continue;
                if (!t.subTerrain.passable) continue;
                // Prefer tiles near center (village nucleus)
                const dist = Math.abs(q - centerQ) + Math.abs(r - centerR);
                candidates.push({ q, r, dist });
            }
        }

        // Sort by distance to center, with slight random jitter
        candidates.sort((a, b) => (a.dist + rng() * 1.5) - (b.dist + rng() * 1.5));

        // Exclusion zone: prevents overlapping 3-tile-wide buildings (±3 tile buffer around each)
        const blockedByBuilding = new Set();
        const _markBuildingZone = (bq, br) => {
            for (let dq = -3; dq <= 3; dq++) {
                for (let dr = -3; dr <= 3; dr++) {
                    blockedByBuilding.add(`${bq + dq},${br + dr}`);
                }
            }
        };

        // Mark the actual visual footprint of a building as impassable.
        // Buildings render 3 tiles wide (q-1..q+1) and 3 tiles tall (r-2..r).
        const _markBuildingImpassable = (bq, br) => {
            for (let dq = -1; dq <= 1; dq++) {
                for (let dr = -2; dr <= 0; dr++) {
                    const fq = bq + dq, fr = br + dr;
                    if (fr >= 0 && fr < this.height && fq >= 0 && fq < this.width) {
                        tiles[fr][fq].subTerrain.passable = false;
                    }
                }
            }
        };

        // Place the center tile building first (village square / town hall)
        const centerTile = tiles[centerR][centerQ];
        if (type === 'capital') {
            centerTile.building = 'buildings/walledCity.png';
        } else if (type === 'town') {
            centerTile.building = 'buildings/marketplace00.png';
        } else {
            centerTile.building = sprites[Math.floor(rng() * sprites.length)];
        }
        centerTile.subTerrain.name = settlement.name || centerTile.subTerrain.name;
        _markBuildingImpassable(centerQ, centerR);
        _markBuildingZone(centerQ, centerR);

        // Determine farm count based on settlement type
        const farmCount = type === 'capital' ? 8 : type === 'city' ? 6 : type === 'town' ? 4 : 2;
        const farmSprites = this.BUILDING_SPRITES.farm;

        // Collect outer-ring candidates (far from center) for farms
        const outerCandidates = candidates
            .filter(c => {
                const dist = Math.abs(c.q - centerQ) + Math.abs(c.r - centerR);
                return dist >= Math.floor(Math.min(this.width, this.height) / 4);
            })
            .sort((a, b) => {
                // Prefer tiles near the edge but still passable
                const dA = Math.abs(a.q - centerQ) + Math.abs(a.r - centerR);
                const dB = Math.abs(b.q - centerQ) + Math.abs(b.r - centerR);
                return dB - dA + (rng() - 0.5) * 1.5;
            });

        // Place farm tiles at outer ring first, reserving those slots
        const farmTilePositions = new Set();
        let farmsPlaced = 0;
        for (const c of outerCandidates) {
            if (farmsPlaced >= farmCount) break;
            if (c.q === centerQ && c.r === centerR) continue;
            if (blockedByBuilding.has(`${c.q},${c.r}`)) continue;
            const tile = tiles[c.r][c.q];
            if (tile.building) continue; // already placed
            tile.building = farmSprites[Math.floor(rng() * farmSprites.length)];
            _markBuildingImpassable(c.q, c.r);
            tile._buildingTypeHint = 'farm';
            farmTilePositions.add(`${c.q},${c.r}`);
            _markBuildingZone(c.q, c.r);
            farmsPlaced++;
        }

        let placed = 1;
        for (const c of candidates) {
            if (placed >= buildingCount) break;
            if (c.q === centerQ && c.r === centerR) continue;
            if (farmTilePositions.has(`${c.q},${c.r}`)) continue; // skip farm tiles
            if (blockedByBuilding.has(`${c.q},${c.r}`)) continue;
            const tile = tiles[c.r][c.q];
            if (tile.building) continue;
            // Mix main sprites with common ones
            const pool = rng() < 0.25 ? commonSprites : sprites;
            tile.building = pool[Math.floor(rng() * pool.length)];
            _markBuildingImpassable(c.q, c.r);
            _markBuildingZone(c.q, c.r);
            placed++;
        }

        // ── Scatter decorative props on remaining empty passable tiles ──
        const decoPool = this.DECORATION_SPRITES[type] || this.DECORATION_SPRITES.village;
        if (decoPool.length === 0) return;

        // Predefined layouts for 1, 2, or 3 decorations on a single hex
        const DECO_LAYOUTS = {
            1: [{ ox: 0, oy: 0 }],
            2: [{ ox: -0.22, oy: 0.05 }, { ox: 0.22, oy: -0.05 }],
            3: [{ ox: -0.22, oy: 0.12 }, { ox: 0.22, oy: 0.12 }, { ox: 0, oy: -0.14 }]
        };

        // Determine decoration count — more for bigger settlements
        let maxDecorations;
        switch (type) {
            case 'capital': maxDecorations = 30; break;
            case 'city':    maxDecorations = 22; break;
            case 'town':    maxDecorations = 15; break;
            default:        maxDecorations = 10; break;
        }

        // Collect remaining empty passable inner tiles
        const decoCandidates = candidates.filter(c => {
            const t = tiles[c.r][c.q];
            return !t.building && t.subTerrain.passable;
        });

        // Shuffle with RNG
        for (let i = decoCandidates.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = decoCandidates[i];
            decoCandidates[i] = decoCandidates[j];
            decoCandidates[j] = tmp;
        }

        let decoPlaced = 0;
        for (const c of decoCandidates) {
            if (decoPlaced >= maxDecorations) break;
            const tile = tiles[c.r][c.q];

            // Pick how many items on this tile (weighted: 65% one, 25% two, 10% three)
            const roll = rng();
            const count = roll < 0.65 ? 1 : roll < 0.90 ? 2 : 3;
            const layout = DECO_LAYOUTS[count];

            const decorations = [];
            const usedSprites = new Set();
            for (let d = 0; d < count; d++) {
                // Pick a unique sprite per tile
                let sprite;
                let attempts = 0;
                do {
                    sprite = decoPool[Math.floor(rng() * decoPool.length)];
                    attempts++;
                } while (usedSprites.has(sprite) && attempts < 10);
                usedSprites.add(sprite);

                decorations.push({
                    sprite: sprite,
                    ox: layout[d].ox,
                    oy: layout[d].oy
                });
            }

            tile.decorations = decorations;
            decoPlaced++;
        }
    },

    // ══════════════════════════════════════════════════════════════
    // CUSTOM BUILDING SCATTER
    // Called from generate() after _placeBuildings().
    // Scatters editor-authored buildings from CustomBuildings onto
    // remaining free passable tiles in settlement inner maps.
    // ══════════════════════════════════════════════════════════════

    _placeCustomBuildings(tiles, settlement, rng) {
        const W    = this.width;
        const H    = this.height;
        const type = settlement.type || 'village';

        // How many custom buildings to attempt per settlement type.
        // When running in custom-buildings-only mode, place more to fill the space.
        const customOnly = window.gameOptions?.customBuildingsOnly &&
                           CustomBuildings.isLoaded() && CustomBuildings.hasAny();
        const maxToPlace = customOnly
            ? (type === 'capital' ? 14 : type === 'city' ? 10 : type === 'town' ? 7 : 5)
            : (type === 'capital' ? 6  : type === 'city' ? 4 : type === 'town' ? 3 : 2);

        const defs = CustomBuildings.getAllForSettlement(type, rng);
        if (!defs.length) {
            console.info('[CustomBuildings] _placeCustomBuildings: no defs for type:', type);
            return;
        }

        let placed = 0;
        let defIdx = 0;
        // Loop cycling through available defs (so a library with 1 def can still fill maxToPlace slots)
        while (placed < maxToPlace && defIdx < maxToPlace * 4) {
            const def = defs[defIdx % defs.length];
            defIdx++;

            // Use bounds if available (origin-relative), otherwise fall back to width/height
            const bounds = def.bounds || { minCol: 0, minRow: 0, maxCol: (def.width || 1) - 1, maxRow: (def.height || 1) - 1 };
            const footW = bounds.maxCol - bounds.minCol + 1;
            const footH = bounds.maxRow - bounds.minRow + 1;

            // Each iteration: try to place this def; continue to next iteration on failure
            {

            // Skip buildings that are too large for this inner map
            if (footW > W - 2 || footH > H - 2) { continue; }

            // Collect anchor positions where the entire footprint is free.
            // Anchor corresponds to the origin (0,0). Footprint extends from
            // anchor+minCol to anchor+maxCol and anchor+minRow to anchor+maxRow.
            const candidates = [];
            for (let r = 1 - bounds.minRow; r <= H - 2 - bounds.maxRow; r++) {
                outer: for (let q = 1 - bounds.minCol; q <= W - 2 - bounds.maxCol; q++) {
                    for (let dr = bounds.minRow; dr <= bounds.maxRow; dr++) {
                        for (let dq = bounds.minCol; dq <= bounds.maxCol; dq++) {
                            const t = tiles[r + dr][q + dq];
                            if (!t.subTerrain.passable || t.building ||
                                t.customBuilding || t.customBuildingPart)
                                continue outer;
                        }
                    }
                    candidates.push({ q, r });
                }
            }
            if (!candidates.length) { continue; }

            // Pick a random candidate position
            const { q: aq, r: ar } = candidates[Math.floor(rng() * candidates.length)];

            // Mark anchor tile
            tiles[ar][aq].customBuilding = { defId: def.id };

            // Mark the remaining footprint tiles as "part of building"
            for (let dr = bounds.minRow; dr <= bounds.maxRow; dr++) {
                for (let dq = bounds.minCol; dq <= bounds.maxCol; dq++) {
                    if (dr === 0 && dq === 0) continue;
                    tiles[ar + dr][aq + dq].customBuildingPart = { anchorQ: aq, anchorR: ar };
                }
            }

            // Apply impassable / door meta from the building editor
            for (const m of (def.meta || [])) {
                const fr = ar + m.r, fq = aq + m.q;
                if (fr >= 0 && fr < H && fq >= 0 && fq < W) {
                    if (m.impassable) tiles[fr][fq].subTerrain.passable = false;
                }
            }

            placed++;
            } // end placement block
        } // end while

        if (placed > 0)
            console.log(`[CustomBuildings] placed ${placed} custom building(s) in ${type} (customOnly=${customOnly})`);
        else
            console.warn(`[CustomBuildings] failed to place any custom buildings in ${type} — no free space found`);
    },


    /**
     * Place player-built properties on the inner map tiles.
     * Each property gets a building sprite on a suitable tile.
     */
    _placePlayerProperties(tiles, worldTile, rng) {
        const properties = worldTile.playerProperties || [];
        const allProps = [...properties];
        // Include single playerProperty if not already in array
        if (worldTile.playerProperty && !allProps.includes(worldTile.playerProperty)) {
            allProps.push(worldTile.playerProperty);
        }
        if (allProps.length === 0) return;

        const height = tiles.length;
        const width = tiles[0] ? tiles[0].length : 0;

        // Mark visual footprint of a placed building impassable (3 wide × 3 tall: q-1..q+1, r-2..r)
        const _markFootprint = (bq, br) => {
            for (let dq = -1; dq <= 1; dq++) {
                for (let dr = -2; dr <= 0; dr++) {
                    const fq = bq + dq, fr = br + dr;
                    if (fr >= 0 && fr < height && fq >= 0 && fq < width) {
                        tiles[fr][fq].subTerrain.passable = false;
                    }
                }
            }
        };

        for (const prop of allProps) {
            // If property already has stored inner map coordinates, try to use them
            if (prop.innerQ !== undefined && prop.innerR !== undefined) {
                const tile = tiles[prop.innerR] && tiles[prop.innerR][prop.innerQ];
                if (tile && !tile.building) {
                    const sprites = this.PROPERTY_SPRITES[prop.type] || ['buildings/villageSmall00.png'];
                    tile.building = sprites[Math.floor(rng() * sprites.length)];
                    _markFootprint(prop.innerQ, prop.innerR);
                    tile._buildingTypeHint = 'player_property';
                    tile._propertyRef = prop;
                    continue;
                }
            }

            // Pick a suitable tile for this property
            const pos = this._findSuitablePropertyTile(tiles, prop, rng);
            if (pos) {
                prop.innerQ = pos.q;
                prop.innerR = pos.r;
                const sprites = this.PROPERTY_SPRITES[prop.type] || ['buildings/villageSmall00.png'];
                tiles[pos.r][pos.q].building = sprites[Math.floor(rng() * sprites.length)];
                _markFootprint(pos.q, pos.r);
                tiles[pos.r][pos.q]._buildingTypeHint = 'player_property';
                tiles[pos.r][pos.q]._propertyRef = prop;
            }
        }
    },

    /**
     * Find a suitable inner map tile for a property.
     * Farms/pastures prefer outer tiles; other properties prefer mid-range.
     */
    _findSuitablePropertyTile(tiles, prop, rng) {
        const height = tiles.length;
        const width = tiles[0] ? tiles[0].length : 0;
        const centerQ = Math.floor(width / 2);
        const centerR = Math.floor(height / 2);
        const candidates = [];

        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const tile = tiles[r][q];
                const isEdge = q === 0 || q === width - 1 || r === 0 || r === height - 1;
                if (isEdge) continue;
                if (!tile.subTerrain.passable) continue;
                if (tile.building) continue;

                const dist = Math.abs(q - centerQ) + Math.abs(r - centerR);
                candidates.push({ q, r, dist });
            }
        }

        if (candidates.length === 0) return null;

        // Farms/pastures prefer outer tiles; others prefer medium distance
        if (prop.type === 'farm' || prop.type === 'pasture' || prop.type === 'logging_camp') {
            candidates.sort((a, b) => b.dist - a.dist + (rng() - 0.5) * 2);
        } else {
            const idealDist = 2;
            candidates.sort((a, b) => {
                const dA = Math.abs(a.dist - idealDist);
                const dB = Math.abs(b.dist - idealDist);
                return dA - dB + (rng() - 0.5) * 2;
            });
        }

        return candidates[0];
    },

    /**
     * Get expected inner map dimensions for a world tile.
     */
    _getInnerMapDimensions(worldTile) {
        if (worldTile.settlement) {
            const type = worldTile.settlement.type || 'village';
            if (type === 'capital') return { width: 14, height: 14 };
            if (type === 'city') return { width: 12, height: 12 };
            if (type === 'town') return { width: 10, height: 10 };
            return { width: 8, height: 8 };
        }
        return {
            width: this.CONFIG && this.CONFIG.innerMapSize ? this.CONFIG.innerMapSize.width : 8,
            height: this.CONFIG && this.CONFIG.innerMapSize ? this.CONFIG.innerMapSize.height : 8
        };
    },

    /**
     * Place a newly-built property on the inner map.
     * Called when building from the world map level.
     * Picks a random suitable inner map tile and updates the cache.
     */
    placePropertyOnInnerMap(worldTile, property, worldQ, worldR) {
        // Create a seeded RNG for property placement
        const propCount = (worldTile.playerProperties ? worldTile.playerProperties.length : 0);
        const seed = ((worldQ * 73856093 ^ worldR * 19349663) + 7919 + propCount) >>> 0;
        let rngState = seed || 1;
        const rng = () => {
            rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
            return rngState / 0x7fffffff;
        };

        // Check if there's a pending inner map position (built from inner map)
        let forcedPos = null;
        if (this._pendingPropertyPosition) {
            forcedPos = { q: this._pendingPropertyPosition.q, r: this._pendingPropertyPosition.r };
            this._pendingPropertyPosition = null; // consume it
        }

        // Get the appropriate cache key
        const dims = this._getInnerMapDimensions(worldTile);
        const key = `${worldQ},${worldR}_${dims.width}x${dims.height}`;

        // If inner map is cached, update it directly
        const cached = this._cache[key];
        if (cached) {
            // Use forced position (from inner map build) or find a suitable tile
            let pos = null;
            if (forcedPos && cached[forcedPos.r] && cached[forcedPos.r][forcedPos.q] &&
                !cached[forcedPos.r][forcedPos.q].building &&
                cached[forcedPos.r][forcedPos.q].subTerrain.passable) {
                pos = forcedPos;
            } else {
                pos = this._findSuitablePropertyTile(cached, property, rng);
            }
            if (pos) {
                property.innerQ = pos.q;
                property.innerR = pos.r;
                const sprites = this.PROPERTY_SPRITES[property.type] || ['buildings/villageSmall00.png'];
                cached[pos.r][pos.q].building = sprites[Math.floor(rng() * sprites.length)];
                cached[pos.r][pos.q]._buildingTypeHint = 'player_property';
                cached[pos.r][pos.q]._propertyRef = property;

                // If inner map is currently active, add this building to the buildings list
                if (this.active && this.currentWorldTile &&
                    this.currentWorldTile.q === worldQ && this.currentWorldTile.r === worldR) {
                    const def = this.PROPERTY_BUILDING_DEFS[property.type];
                    if (def) {
                        const exists = this.buildings.find(b => b.q === pos.q && b.r === pos.r);
                        if (!exists) {
                            const statusLabel = property.underConstruction ? ' (Building)' : '';
                            const bldg = {
                                q: pos.q,
                                r: pos.r,
                                type: 'player_' + property.type,
                                name: `${property.name || def.name}${statusLabel}`,
                                icon: property.icon || def.icon,
                                sprite: cached[pos.r][pos.q].building,
                                actions: [...def.actions],
                                isPlayerProperty: true,
                                propertyRef: property,
                            };
                            cached[pos.r][pos.q].buildingInfo = bldg;
                            this.buildings.push(bldg);
                        }
                    }
                }
            }
        } else if (forcedPos) {
            // Not cached yet, but we have a forced position — store it on the property
            property.innerQ = forcedPos.q;
            property.innerR = forcedPos.r;
        }
        // If not cached and no forced position, coordinates will be assigned when inner map is generated
    },

    /**
     * Add player property buildings to the buildings list.
     * Called during enter() to ensure labels and interactions work.
     */
    _addPropertyBuildings() {
        if (!this._currentWorldTileRef) return;

        const properties = this._currentWorldTileRef.playerProperties || [];
        const allProps = [...properties];
        if (this._currentWorldTileRef.playerProperty &&
            !allProps.includes(this._currentWorldTileRef.playerProperty)) {
            allProps.push(this._currentWorldTileRef.playerProperty);
        }

        for (const prop of allProps) {
            if (prop.innerQ === undefined || prop.innerR === undefined) continue;

            const tile = this.tiles[prop.innerR] && this.tiles[prop.innerR][prop.innerQ];
            if (!tile) continue;

            const def = this.PROPERTY_BUILDING_DEFS[prop.type];
            if (!def) continue;

            // Skip if already in buildings list
            const exists = this.buildings.find(b => b.q === prop.innerQ && b.r === prop.innerR);
            if (exists) continue;

            const statusLabel = prop.underConstruction ? ' (Building)' : '';
            const bldg = {
                q: prop.innerQ,
                r: prop.innerR,
                type: 'player_' + prop.type,
                name: `${prop.name || def.name}${statusLabel}`,
                icon: prop.icon || def.icon,
                sprite: tile.building,
                actions: [...def.actions],
                isPlayerProperty: true,
                propertyRef: prop,
            };

            tile.buildingInfo = bldg;
            this.buildings.push(bldg);
        }
    },

    /**
     * Default sub-terrains for terrain types with no JSON config
     */
    _defaultSubTerrains(terrainId) {
        const terrainDef = Terrain.TYPES[terrainId.toUpperCase()] || Terrain.TYPES.GRASSLAND;
        return [
            { id: terrainId, name: terrainDef.name, icon: terrainDef.icon, color: terrainDef.color, weight: 80 },
            { id: terrainId + '_var', name: terrainDef.name + ' (varied)', icon: terrainDef.icon, color: terrainDef.color, weight: 20 }
        ];
    },

    /**
     * Enter an inner map from the world map
     * @param {Object} game - The game instance
     * @param {number} worldQ - World tile q coordinate
     * @param {number} worldR - World tile r coordinate
     */
    enter(game, worldQ, worldR) {
        const worldTile = game.world.getTile(worldQ, worldR);
        if (!worldTile) return false;

        // Use larger grid for settlements
        const hasSettlement = !!worldTile.settlement;
        if (hasSettlement) {
            const sType = worldTile.settlement.type || 'village';
            const sz = this.SETTLEMENT_MAP_SIZES[sType] || this.SETTLEMENT_MAP_SIZES.village;
            const hash = ((worldQ * 73856093 ^ worldR * 19349663) >>> 0) % (sz.max - sz.min + 1);
            this.width = sz.min + hash;
            this.height = sz.min + hash;
        } else {
            this.width = this.CONFIG && this.CONFIG.innerMapSize ? this.CONFIG.innerMapSize.width : 20;
            this.height = this.CONFIG && this.CONFIG.innerMapSize ? this.CONFIG.innerMapSize.height : 20;
        }

        // Generate/retrieve inner map
        this.tiles = this.getOrGenerate(worldTile, worldQ, worldR, game);
        this.currentWorldTile = { q: worldQ, r: worldR };
        this._currentWorldTileRef = worldTile;
        this.active = true;

        // Place player in center
        this.playerInnerQ = Math.floor(this.width / 2);
        this.playerInnerR = Math.floor(this.height / 2);

        // Make sure center and surroundings are explored
        this._revealAround(this.tiles, this.playerInnerQ, this.playerInnerR, 2);

        // ── Initialize time system ──
        this.timeOfDay = 8;  // Start at 8 AM
        this._timeAccumulator = 0;
        this.dayEnded = false;

        // ── Snapshot weather / temperature from world ──
        if (game.world && game.world.weather) {
            this.weather = game.world.weather.getWeather(worldQ, worldR);
            this.temperature = game.world.weather.getTemperature(worldQ, worldR);
        } else {
            this.weather = { type: 'clear', intensity: 0 };
            this.temperature = { value: 0.5, celsius: 10, fahrenheit: 50 };
        }
        this.season = game.world ? game.world.season : 'Spring';
        this.worldDay = game.world ? (game.world.day || 0) : 0;

        // ── Generate buildings list for settlement tiles ──
        this.buildings = [];
        this.roads = [];
        if (hasSettlement) {
            this._buildBuildingList();
            this._generateRoads();
        }

        // ── Add player property buildings (works for settlement and wilderness tiles) ──
        this._addPropertyBuildings();

        // ── Spawn NPCs ──
        this.npcs = [];
        this._npcMoveTimer = 0;
        if (hasSettlement) {
            this._spawnNPCs(worldTile.settlement);
        }

        // For settlements, reveal all tiles (you're visiting a known location)
        if (hasSettlement) {
            for (let r = 0; r < this.height; r++) {
                for (let q = 0; q < this.width; q++) {
                    this.tiles[r][q].explored = true;
                    this.tiles[r][q].visible = true;
                }
            }
        }

        return true;
    },

    /**
     * Exit the inner map back to the world map
     */
    exit(game) {
        this.active = false;
        this.currentWorldTile = null;
        this._currentWorldTileRef = null;
        this.npcs = [];
        this.buildings = [];
        this.roads = [];
        this.dayEnded = false;
        this._pendingInteraction = null;
        this._activeInteraction = null;
        // Tiles remain cached for re-entry
    },

    /**
     * Move player within the inner map
     * @returns {{ moved: boolean, encounter: Object|null }}
     */
    movePlayer(dq, dr) {
        // Cancel any animated walk in progress
        this.cancelPlayerWalk();

        const newQ = this.playerInnerQ + dq;
        const newR = this.playerInnerR + dr;

        // Bounds check
        if (newQ < 0 || newQ >= this.width || newR < 0 || newR >= this.height) {
            return { moved: false, encounter: null, outOfBounds: true };
        }

        const tile = this.tiles[newR][newQ];
        if (!tile.subTerrain.passable) {
            return { moved: false, encounter: null, outOfBounds: false };
        }

        // Move
        this.playerInnerQ = newQ;
        this.playerInnerR = newR;

        // Reveal nearby tiles
        this._revealAround(this.tiles, newQ, newR, 2);

        // Check for encounter
        let encounter = null;
        if (tile.encounter && !tile.encounter.discovered) {
            tile.encounter.discovered = true;
            encounter = tile.encounter;
            const encounterKey = `${this.currentWorldTile.q},${this.currentWorldTile.r}_${newQ},${newR}`;
            this._discoveredEncounters[encounterKey] = true;
        }

        return { moved: true, encounter: encounter, outOfBounds: false };
    },

    /**
     * Move player to a specific inner map tile (click-to-move).
     * Sets up an animated walk along the A* path.
     * Returns { started, moved, outOfBounds } — the 'moved' flag is only
     * true once the player actually arrives (checked via updatePlayer).
     */
    movePlayerTo(targetQ, targetR) {
        if (targetQ < 0 || targetQ >= this.width || targetR < 0 || targetR >= this.height) {
            return { started: false, moved: false, encounter: null, outOfBounds: true };
        }

        const tile = this.tiles[targetR][targetQ];
        if (!tile.subTerrain.passable) {
            return { started: false, moved: false, encounter: null, outOfBounds: false };
        }

        // A* pathfinding
        const path = this._findPath(this.playerInnerQ, this.playerInnerR, targetQ, targetR);
        if (!path || path.length <= 1) {
            return { started: false, moved: false, encounter: null, outOfBounds: false };
        }

        // Start animated walk (skip index 0 which is the current position)
        this._playerPath = path;
        this._playerPathIndex = 1;
        this._playerMoveProgress = 0;
        this._playerPrevQ = this.playerInnerQ;
        this._playerPrevR = this.playerInnerR;
        this._playerWalking = true;
        this._playerArrivalResult = null;

        return { started: true, moved: false, encounter: null, outOfBounds: false };
    },

    /**
     * Cancel the current player walk (e.g. on new right-click).
     */
    cancelPlayerWalk() {
        this._playerPath = null;
        this._playerPathIndex = 0;
        this._playerMoveProgress = 0;
        this._playerWalking = false;
        this._playerPrevQ = this.playerInnerQ;
        this._playerPrevR = this.playerInnerR;
    },

    // ══════════════════════════════════════════════
    // OBJECT INTERACTION
    // ══════════════════════════════════════════════

    /**
     * Start an interaction with a custom object.
     * Called when the player arrives at a tile adjacent to the target object.
     * @param {number} baseDamage  % of the object's health removed per swing
     */
    startInteraction(anchorQ, anchorR, defId, baseDamage) {
        // Ensure health is initialised (objects placed before this feature always start at 100).
        const anchorTile = this.getTile(anchorQ, anchorR);
        if (anchorTile && anchorTile.customObject && anchorTile.customObject.currentHealthPct == null) {
            anchorTile.customObject.currentHealthPct = 100;
        }
        this._activeInteraction = {
            anchorQ, anchorR, defId,
            baseDamage: baseDamage || 20,  // % HP removed per swing
            swingTimer: 0,
            swingInterval: 0.5,  // seconds between swings
            fadeDuration: 0.4,   // seconds to fade out once health hits 0
            fading: false,
            done: false
        };
        this._pendingInteraction = null;
    },

    /**
     * Compute how much % health one swing deals to a custom object.
     * Scales with player strength and luck; reduced by def.resistance (0–95).
     *   str=1, luck=5  → ~8.5%  (~12 swings)
     *   str=5, luck=5  → ~20.5% (~5  swings)
     *   str=10, luck=5 → ~35.5% (~3  swings)
     */
    _computeObjectDamage(player, def) {
        const str    = (player && player.strength) || 5;
        const luck   = (player && player.luck)     || 5;
        const base   = str * 3 + luck * 0.5 + 3;         // base %
        const resist = def && def.resistance != null ? Math.min(def.resistance, 95) : 0;
        return base * (1 - resist / 100);
    },

    /**
     * Update active object interaction each frame.
     * Each swing deals baseDamage% (±12.5% variance) to the object's currentHealthPct.
     * Returns:
     *   null                           — still animating between swings
     *   { hit, damage, healthPct }     — a swing just landed (object still alive)
     *   { completed, anchorQ, anchorR, defId, resource } — object destroyed
     */
    updateInteraction(deltaTime) {
        const ia = this._activeInteraction;
        if (!ia || ia.done) return null;

        ia.swingTimer += deltaTime;

        // Phase 2: fading — health hit 0, wait fadeDuration then remove
        if (ia.fading) {
            if (ia.swingTimer >= ia.fadeDuration) {
                ia.done = true;
                const anchorTile = this.getTile(ia.anchorQ, ia.anchorR);
                let resource = null;
                if (anchorTile && anchorTile.customObject && anchorTile.customObject.resource) {
                    resource = { ...anchorTile.customObject.resource };
                }
                this._removeCustomObject(ia.anchorQ, ia.anchorR);
                const result = { completed: true, anchorQ: ia.anchorQ, anchorR: ia.anchorR, defId: ia.defId, resource };
                this._activeInteraction = null;
                return result;
            }
            return null;
        }

        // Phase 1: swing — deal a hit every swingInterval seconds
        if (ia.swingTimer >= ia.swingInterval) {
            ia.swingTimer -= ia.swingInterval;
            const anchorTile = this.getTile(ia.anchorQ, ia.anchorR);
            if (!anchorTile || !anchorTile.customObject) {
                this._activeInteraction = null;
                return { completed: true, anchorQ: ia.anchorQ, anchorR: ia.anchorR, defId: ia.defId, resource: null };
            }
            // Apply swing with ±12.5% variance
            const dmg = ia.baseDamage * (0.875 + Math.random() * 0.25);
            anchorTile.customObject.currentHealthPct =
                Math.max(0, anchorTile.customObject.currentHealthPct - dmg);
            const hp = anchorTile.customObject.currentHealthPct;
            if (hp <= 0) {
                ia.fading = true;
                ia.swingTimer = 0;
            }
            return { hit: true, damage: Math.round(dmg), healthPct: hp };
        }

        return null; // still animating between swings
    },

    /**
     * Remove a custom object (anchor + all footprint tiles).
     * If the definition specifies a `spawnAfter` object ID, that object
     * is automatically placed at the origin tile after removal (e.g. a
     * stump spawning after a tree is harvested).
     */
    _removeCustomObject(anchorQ, anchorR) {
        const anchorTile = this.getTile(anchorQ, anchorR);
        if (!anchorTile || !anchorTile.customObject) return;

        const defId = anchorTile.customObject.defId;
        const def = (typeof CustomObjects !== 'undefined') ? CustomObjects.getDef(defId) : null;

        // Clear footprint tiles and restore passability for all tiles (including anchor)
        if (def && def.tiles) {
            for (const td of def.tiles) {
                const fq = anchorQ + td.localCol;
                const fr = anchorR + td.localRow;
                const ft = this.getTile(fq, fr);
                if (!ft) continue;
                const isAnchor = td.localCol === 0 && td.localRow === 0;
                if (isAnchor) {
                    // Anchor tile: restore passability if object made it impassable
                    if (td.impassable) ft.subTerrain.passable = true;
                } else if (ft.customObjectPart &&
                           ft.customObjectPart.anchorQ === anchorQ &&
                           ft.customObjectPart.anchorR === anchorR) {
                    delete ft.customObjectPart;
                    if (td.impassable) ft.subTerrain.passable = true;
                }
            }
        }

        // Clear anchor
        delete anchorTile.customObject;

        // ── spawnAfter: place a replacement object at the origin tile ──
        if (def && def.spawnAfter) {
            const spawnDef = CustomObjects.getDef(def.spawnAfter);
            if (spawnDef && spawnDef.tiles && spawnDef.tiles.length > 0) {
                // Verify the full footprint of the replacement is free
                let clear = true;
                for (const tDef of spawnDef.tiles) {
                    const fq = anchorQ + tDef.localCol;
                    const fr = anchorR + tDef.localRow;
                    if (fq < 0 || fq >= this.width || fr < 0 || fr >= this.height)
                        { clear = false; break; }
                    const ft = this.getTile(fq, fr);
                    if (!ft || ft.building || ft.customObject || ft.customObjectPart)
                        { clear = false; break; }
                }
                if (clear) {
                    // Place the spawn-after object
                    const newObj = { defId: spawnDef.id, sheetPath: spawnDef.sheetPath, currentHealthPct: 100 };
                    if (spawnDef.resource) newObj.resource = spawnDef.resource;
                    anchorTile.customObject = newObj;
                    // Mark footprint tiles
                    for (const tDef of spawnDef.tiles) {
                        const fq = anchorQ + tDef.localCol;
                        const fr = anchorR + tDef.localRow;
                        const ft = this.getTile(fq, fr);
                        if (!ft) continue;
                        if (tDef.localCol !== 0 || tDef.localRow !== 0) {
                            ft.customObjectPart = { anchorQ, anchorR };
                        }
                        if (tDef.impassable) ft.subTerrain.passable = false;
                    }
                }
            }
        }
    },

    /**
     * Find the best walkable tile adjacent to an object's footprint.
     * Returns { q, r } or null if none found.
     */
    findAdjacentToObject(anchorQ, anchorR, def) {
        // Collect all footprint tile coords
        const footprint = new Set();
        if (def && def.tiles) {
            for (const td of def.tiles) {
                footprint.add(`${anchorQ + td.localCol},${anchorR + td.localRow}`);
            }
        } else {
            footprint.add(`${anchorQ},${anchorR}`);
        }

        // Gather all passable neighbors of the footprint
        const candidates = [];
        const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
        for (const key of footprint) {
            const [fq, fr] = key.split(',').map(Number);
            for (const [dq, dr] of dirs) {
                const nq = fq + dq, nr = fr + dr;
                const nk = `${nq},${nr}`;
                if (footprint.has(nk)) continue;
                const nt = this.getTile(nq, nr);
                if (!nt || !nt.subTerrain.passable) continue;
                // Prefer tiles closer to the player
                const dist = Math.abs(nq - this.playerInnerQ) + Math.abs(nr - this.playerInnerR);
                candidates.push({ q: nq, r: nr, dist });
            }
        }
        if (candidates.length === 0) return null;

        // Pick closest to player
        candidates.sort((a, b) => a.dist - b.dist);
        return { q: candidates[0].q, r: candidates[0].r };
    },

    /**
     * Get the direction the player should face toward an object anchor.
     */
    getDirectionToward(targetQ, targetR) {
        const dq = targetQ - this.playerInnerQ;
        const dr = targetR - this.playerInnerR;
        // Return direction constant compatible with InnerMapCharacters
        if (Math.abs(dq) >= Math.abs(dr)) {
            return dq >= 0 ? 3 : 1; // RIGHT : LEFT
        }
        return dr >= 0 ? 2 : 0; // DOWN : UP
    },

    /**
     * Tick the player walking animation. Called each frame.
     * Returns null while walking, or { moved, encounter } on arrival / each step.
     */
    updatePlayer(deltaTime) {
        if (!this._playerWalking || !this._playerPath) return null;

        this._playerMoveProgress += deltaTime * this._playerSpeed;

        if (this._playerMoveProgress >= 1.0) {
            this._playerMoveProgress = 0;

            // Advance to the next step
            const step = this._playerPath[this._playerPathIndex];

            // Defensive: never step onto impassable tile
            const stepTile = this.tiles[step.r] && this.tiles[step.r][step.q];
            if (!stepTile || !stepTile.subTerrain.passable) {
                this.cancelPlayerWalk();
                return { moved: false, encounter: null, blocked: true };
            }

            this._playerPrevQ = this.playerInnerQ;
            this._playerPrevR = this.playerInnerR;
            this.playerInnerQ = step.q;
            this.playerInnerR = step.r;
            this._playerPathIndex++;

            // Reveal fog
            this._revealAround(this.tiles, step.q, step.r, 2);

            // Check encounter
            let encounter = null;
            if (stepTile.encounter && !stepTile.encounter.discovered) {
                stepTile.encounter.discovered = true;
                encounter = stepTile.encounter;
            }

            // Check if arrived at final destination
            if (this._playerPathIndex >= this._playerPath.length) {
                this._playerWalking = false;
                this._playerPath = null;
                return { moved: true, encounter, arrived: true };
            }

            // Intermediate step with encounter — stop walking
            if (encounter) {
                this.cancelPlayerWalk();
                return { moved: true, encounter, arrived: false };
            }
        }

        return null; // still walking
    },

    /**
     * Get the player's current interpolated world position (for rendering).
     */
    getPlayerWorldPos() {
        const T = 32; // TILE_SIZE
        if (this._playerWalking && this._playerPath && this._playerPathIndex < this._playerPath.length) {
            const target = this._playerPath[this._playerPathIndex];
            const progress = this._playerMoveProgress;
            const fx = this.playerInnerQ * T + T / 2;
            const fy = this.playerInnerR * T + T / 2;
            const tx = target.q * T + T / 2;
            const ty = target.r * T + T / 2;
            return {
                x: fx + (tx - fx) * progress,
                y: fy + (ty - fy) * progress,
                walking: true,
                dq: target.q - this.playerInnerQ,
                dr: target.r - this.playerInnerR
            };
        }
        return {
            x: this.playerInnerQ * T + T / 2,
            y: this.playerInnerR * T + T / 2,
            walking: false,
            dq: 0, dr: 0
        };
    },

    /**
     * Simple A* pathfinding for the inner map
     */
    _findPath(startQ, startR, endQ, endR) {
        const key = (q, r) => `${q},${r}`;
        const open = [{ q: startQ, r: startR, g: 0, h: 0, f: 0, parent: null }];
        const closed = new Set();

        const heuristic = (q1, r1, q2, r2) => Math.abs(q1 - q2) + Math.abs(r1 - r2);
        open[0].h = heuristic(startQ, startR, endQ, endR);
        open[0].f = open[0].h;

        while (open.length > 0) {
            // Sort by f-cost
            open.sort((a, b) => a.f - b.f);
            const current = open.shift();
            const currentKey = key(current.q, current.r);

            if (current.q === endQ && current.r === endR) {
                // Reconstruct path
                const path = [];
                let node = current;
                while (node) {
                    path.unshift({ q: node.q, r: node.r });
                    node = node.parent;
                }
                return path;
            }

            closed.add(currentKey);

            // Get neighbors using square grid (4-directional)
            const neighbors = [
                { q: current.q + 1, r: current.r },
                { q: current.q - 1, r: current.r },
                { q: current.q, r: current.r + 1 },
                { q: current.q, r: current.r - 1 },
            ];
            for (const n of neighbors) {
                if (n.q < 0 || n.q >= this.width || n.r < 0 || n.r >= this.height) continue;
                const nKey = key(n.q, n.r);
                if (closed.has(nKey)) continue;

                const tile = this.tiles[n.r][n.q];
                if (!tile.subTerrain.passable) continue;

                const g = current.g + 1;
                const h = heuristic(n.q, n.r, endQ, endR);
                const f = g + h;

                const existing = open.find(o => o.q === n.q && o.r === n.r);
                if (existing) {
                    if (g < existing.g) {
                        existing.g = g;
                        existing.f = f;
                        existing.parent = current;
                    }
                } else {
                    open.push({ q: n.q, r: n.r, g, h, f, parent: current });
                }
            }
        }

        return null; // No path
    },

    /**
     * Reveal tiles around a position
     */
    _revealAround(tiles, q, r, radius) {
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dq = -radius; dq <= radius; dq++) {
                const nq = q + dq;
                const nr = r + dr;
                if (nq >= 0 && nq < this.width && nr >= 0 && nr < this.height) {
                    // Use hex distance for a more natural reveal shape
                    const dist = Math.abs(dq) + Math.abs(dr);
                    if (dist <= radius + 1) {
                        tiles[nr][nq].explored = true;
                        tiles[nr][nq].visible = true;
                    }
                }
            }
        }
    },

    /**
     * Get the inner tile at a position
     */
    getTile(q, r) {
        if (q < 0 || q >= this.width || r < 0 || r >= this.height) return null;
        return this.tiles[r] ? this.tiles[r][q] : null;
    },

    /**
     * Get a summary of the inner map for display
     */
    getSummary() {
        if (!this.active || !this.tiles) return null;

        let totalTiles = 0;
        let exploredTiles = 0;
        let encounters = 0;
        let discoveredEncounters = 0;

        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                totalTiles++;
                if (this.tiles[r][q].explored) exploredTiles++;
                if (this.tiles[r][q].encounter) {
                    encounters++;
                    if (this.tiles[r][q].encounter.discovered) discoveredEncounters++;
                }
            }
        }

        return {
            exploredTiles,
            totalTiles,
            exploredPercent: Math.floor((exploredTiles / totalTiles) * 100),
            encounters,
            discoveredEncounters,
            parentTerrain: this.tiles[0][0].parentTerrain,
            worldTile: this.currentWorldTile
        };
    },

    /**
     * Serialize inner map cache for save/load
     */
    serialize() {
        return {
            cache: this._cache,
            discoveredEncounters: this._discoveredEncounters
        };
    },

    /**
     * Restore inner map cache from save data
     */
    deserialize(data) {
        if (data) {
            this._cache = data.cache || {};
            this._discoveredEncounters = data.discoveredEncounters || {};

            // ── Migration: Fix stale baseTerrain on water/ice feature tiles ──
            // Old saves set baseTerrain='water' for brooks/streams/ponds etc.
            // Now those features inherit parent terrain + use overlays.
            const WATER_OVERLAY_IDS = new Set([
                'pond','shallow_water','murky_water','stream','river','pool',
                'waterfall','brook','mountain_stream','lagoon','lily_pads',
                'tide_pools','moss_bank','oasis_small','watering_hole','spring',
                'frozen_stream','frozen_pool','frozen_lake','ice_sheet',
                'glacier','thick_ice','ice_spire','ice_cave'
            ]);
            for (const key of Object.keys(this._cache)) {
                const tiles = this._cache[key];
                if (!tiles) continue;
                for (let r = 0; r < tiles.length; r++) {
                    for (let q = 0; q < (tiles[r] || []).length; q++) {
                        const tile = tiles[r][q];
                        if (tile && tile.subTerrain && WATER_OVERLAY_IDS.has(tile.subTerrain.id)) {
                            // Recalculate correct baseTerrain from parent
                            tile.baseTerrain = this._getBaseTerrain(tile.parentTerrain, null);
                        }
                    }
                }
            }
        }
    },

    /**
     * Clear all cached inner maps
     */
    clearCache() {
        this._cache = {};
        this._discoveredEncounters = {};
    },

    // ══════════════════════════════════════════════
    // TIME SYSTEM — 1 real minute = 1 in-game hour
    // ══════════════════════════════════════════════

    /**
     * Update inner map time. Called every frame with deltaTime (seconds).
     * @returns {string|null} 'day_ended' if the day is over
     */
    updateTime(deltaTime) {
        if (!this.active || this.dayEnded) return null;

        this._timeAccumulator += deltaTime;
        if (this._timeAccumulator >= this.TIME_SCALE) {
            this._timeAccumulator -= this.TIME_SCALE;
            this.timeOfDay++;

            if (this.timeOfDay >= 24) {
                this.timeOfDay = 24;
                this.dayEnded = true;
                return 'day_ended';
            }
        }
        return null;
    },

    /**
     * Get formatted time string (e.g. "3:00 PM")
     */
    getTimeString() {
        const hour = this.timeOfDay % 24;
        const minuteProgress = this._timeAccumulator / this.TIME_SCALE;
        const minutes = Math.floor(minuteProgress * 60);
        const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
        if (hour === 0) return `12:${mm} AM`;
        if (hour < 12) return `${hour}:${mm} AM`;
        if (hour === 12) return `12:${mm} PM`;
        return `${hour - 12}:${mm} PM`;
    },

    /**
     * Get time period for ambient effects
     */
    getTimePeriod() {
        const h = this.timeOfDay;
        if (h >= 6 && h < 10) return 'morning';
        if (h >= 10 && h < 14) return 'midday';
        if (h >= 14 && h < 18) return 'afternoon';
        if (h >= 18 && h < 21) return 'evening';
        return 'night';
    },

    /**
     * Get ambient overlay color based on time of day
     */
    getAmbientOverlay() {
        const h = this.timeOfDay;
        let base;
        if (h >= 6 && h < 8) base = 'rgba(255, 200, 100, 0.08)';       // Dawn
        else if (h >= 8 && h < 17) base = null;                        // Day — no overlay
        else if (h >= 17 && h < 19) base = 'rgba(255, 140, 50, 0.12)'; // Sunset
        else if (h >= 19 && h < 21) base = 'rgba(30, 20, 60, 0.25)';   // Dusk
        else base = 'rgba(10, 10, 40, 0.45)';                          // Night
        return base;
    },

    /**
     * Return an additional weather/temperature tint overlay colour,
     * layered on top of the time-of-day ambient overlay.
     */
    getWeatherOverlay() {
        const w = this.weather;
        if (!w) return null;
        switch (w.type) {
            case 'rain':    return 'rgba(40, 60, 90, ' + (0.08 + w.intensity * 0.10).toFixed(2) + ')';
            case 'storm':   return 'rgba(20, 20, 40, 0.22)';
            case 'snow':    return 'rgba(180, 200, 230, ' + (0.06 + w.intensity * 0.08).toFixed(2) + ')';
            case 'cloudy':  return 'rgba(60, 65, 75, ' + (0.04 + w.intensity * 0.06).toFixed(2) + ')';
            default:        return null;
        }
    },

    /**
     * Return a temperature-based tint (very subtle).
     */
    getTemperatureOverlay() {
        const t = this.temperature;
        if (!t) return null;
        if (t.value < 0.25) return 'rgba(100, 140, 200, 0.06)';   // Cold
        if (t.value > 0.78) return 'rgba(200, 130, 60, 0.05)';    // Hot
        return null;
    },

    // ══════════════════════════════════════════════
    // BUILDING SYSTEM — Named interactable buildings
    // ══════════════════════════════════════════════

    /**
     * Build the list of named buildings from the tiles that had buildings placed
     */
    _buildBuildingList() {
        this.buildings = [];
        if (!this._currentWorldTileRef || !this._currentWorldTileRef.settlement) return;

        const settlement = this._currentWorldTileRef.settlement;
        const type = settlement.type || 'village';
        const layout = this.SETTLEMENT_BUILDINGS[type] || this.SETTLEMENT_BUILDINGS.village;

        // Collect tiles that have building sprites
        const buildingTiles = [];
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                if (this.tiles[r][q].building) {
                    buildingTiles.push({ q, r, sprite: this.tiles[r][q].building });
                }
            }
        }

        if (buildingTiles.length === 0) return;

        // Assign building types: required first, then optional
        const assigned = [];
        const required = [...layout.required];
        const optional = [...layout.optional];

        // Center tile gets the first required building (town_hall / marketplace / tavern)
        const centerQ = Math.floor(this.width / 2);
        const centerR = Math.floor(this.height / 2);

        // Sort building tiles: center first, then by distance to center
        buildingTiles.sort((a, b) => {
            const distA = Math.abs(a.q - centerQ) + Math.abs(a.r - centerR);
            const distB = Math.abs(b.q - centerQ) + Math.abs(b.r - centerR);
            return distA - distB;
        });

        for (let i = 0; i < buildingTiles.length; i++) {
            const bt = buildingTiles[i];
            let buildingType;

            // Honour placement-time type hint (e.g. farm tiles placed at outer ring)
            const tile = this.tiles[bt.r][bt.q];
            // Skip player property tiles — they are handled by _addPropertyBuildings()
            if (tile._buildingTypeHint === 'player_property') continue;
            if (tile._buildingTypeHint) {
                buildingType = tile._buildingTypeHint;
                // Remove from required/optional lists to avoid double-assignment
                const reqIdx = required.indexOf(buildingType);
                if (reqIdx !== -1) required.splice(reqIdx, 1);
                const optIdx = optional.indexOf(buildingType);
                if (optIdx !== -1) optional.splice(optIdx, 1);
            } else if (required.length > 0) {
                buildingType = required.shift();
            } else if (optional.length > 0) {
                buildingType = optional.shift();
            } else {
                buildingType = 'house'; // fallback
            }

            const def = this.BUILDING_TYPES[buildingType] || this.BUILDING_TYPES.house;

            const bldg = {
                q: bt.q,
                r: bt.r,
                type: buildingType,
                name: def.name,
                icon: def.icon,
                sprite: bt.sprite,  // keep original sprite for visuals
                actions: [...def.actions],
            };

            // Update the tile's building info
            this.tiles[bt.r][bt.q].buildingInfo = bldg;
            this.tiles[bt.r][bt.q].building = bt.sprite; // keep sprite
            assigned.push(bldg);
        }

        this.buildings = assigned;
    },

    /**
     * Generate roads connecting buildings in settlements
     */
    _generateRoads() {
        this.roads = [];
        if (this.buildings.length < 2) return;

        const roadSet = new Set();
        const centerQ = Math.floor(this.width / 2);
        const centerR = Math.floor(this.height / 2);

        // Connect each building to the center with a simple road
        for (const bldg of this.buildings) {
            const path = this._findPath(bldg.q, bldg.r, centerQ, centerR);
            if (path) {
                for (const step of path) {
                    const key = `${step.q},${step.r}`;
                    if (!roadSet.has(key)) {
                        const tile = this.getTile(step.q, step.r);
                        if (!tile || !tile.subTerrain.passable) continue;
                        roadSet.add(key);
                        this.roads.push({ q: step.q, r: step.r });
                        // Mark road on tile
                        if (!tile.building) {
                            tile.isRoad = true;
                        }
                    }
                }
            }
        }

        // Connect buildings to each other via nearest neighbor (simple spanning)
        for (let i = 0; i < this.buildings.length - 1; i++) {
            const a = this.buildings[i];
            const b = this.buildings[i + 1];
            const path = this._findPath(a.q, a.r, b.q, b.r);
            if (path) {
                for (const step of path) {
                    const key = `${step.q},${step.r}`;
                    if (!roadSet.has(key)) {
                        const tile = this.getTile(step.q, step.r);
                        if (!tile || !tile.subTerrain.passable) continue;
                        roadSet.add(key);
                        this.roads.push({ q: step.q, r: step.r });
                        if (!tile.building) {
                            tile.isRoad = true;
                        }
                    }
                }
            }
        }
    },

    /**
     * Get the building at a specific tile, if any
     */
    getBuildingAt(q, r) {
        return this.buildings.find(b => b.q === q && b.r === r) || null;
    },

    /**
     * Get available actions for a building
     */
    getBuildingActions(building) {
        if (!building) return [];
        const def = this.BUILDING_TYPES[building.type];
        if (!def) return [];

        // Filter actions based on time of day
        const period = this.getTimePeriod();
        let actions = [...def.actions];

        // Tavern has more options at night / evening
        if (building.type === 'tavern' && (period === 'evening' || period === 'night')) {
            if (!actions.includes('buy_drink')) actions.push('buy_drink');
        }

        // Church closed at night
        if ((building.type === 'church' || building.type === 'temple') && period === 'night') {
            actions = actions.filter(a => a !== 'pray' && a !== 'donate');
            actions.push('closed');
        }

        // Market closed at night
        if (building.type === 'marketplace' && period === 'night') {
            actions = ['closed'];
        }

        return actions;
    },

    // ══════════════════════════════════════════════
    // NPC SYSTEM — Townspeople that walk around
    // ══════════════════════════════════════════════

    /**
     * Spawn NPCs for the current settlement
     */
    _spawnNPCs(settlement) {
        this.npcs = [];
        const type = settlement.type || 'village';
        const pool = this.NPC_POOLS[type] || this.NPC_POOLS.village;

        // Seeded RNG for deterministic NPC placement
        const wt = this.currentWorldTile;
        let seed = ((wt.q * 73856093 ^ wt.r * 19349663) + 42) >>> 0;
        const rng = () => {
            seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
            return seed / 0x7fffffff;
        };

        // Generate first/last names
        const firstNames = ['Ada', 'Brom', 'Clara', 'Dorn', 'Eva', 'Finn', 'Greta', 'Holt',
            'Iris', 'Jace', 'Kira', 'Lars', 'Maeve', 'Nils', 'Ora', 'Per', 'Quinn', 'Rolf',
            'Siv', 'Tor', 'Una', 'Voss', 'Wren', 'Xara', 'Yves', 'Zara', 'Arne', 'Bjorn',
            'Cora', 'Dag', 'Elsa', 'Frey', 'Gerd', 'Hakon', 'Inga', 'Jarl', 'Knut', 'Lena',
            'Marta', 'Njord', 'Olga', 'Peder', 'Ragna', 'Sven', 'Thora', 'Ulf', 'Viggo', 'Ylva'];

        let npcId = 0;
        for (const [npcType, count] of Object.entries(pool)) {
            const typeDef = this.NPC_TYPES[npcType];
            if (!typeDef) continue;

            for (let i = 0; i < count; i++) {
                // Pick random passable tile for initial position
                let q, r, attempts = 0;
                do {
                    q = Math.floor(rng() * this.width);
                    r = Math.floor(rng() * this.height);
                    attempts++;
                } while (attempts < 50 && (!this.tiles[r] || !this.tiles[r][q] ||
                    !this.tiles[r][q].subTerrain.passable));

                if (attempts >= 50) continue;

                const name = firstNames[Math.floor(rng() * firstNames.length)];

                // Assign LPC character preset (deterministic by NPC id + type)
                const npcSeed = npcId;
                const preset = (typeof InnerMapCharacters !== 'undefined')
                    ? InnerMapCharacters.getPresetForNPC(npcType, npcSeed)
                    : null;

                this.npcs.push({
                    id: npcId++,
                    type: npcType,
                    name: name,
                    icon: typeDef.icon,
                    speed: typeDef.speed,
                    preset: preset,         // LPC character preset ID
                    facing: 2,              // Default facing: down
                    q: q,
                    r: r,
                    // Movement
                    targetQ: q,
                    targetR: r,
                    path: null,
                    pathIndex: 0,
                    moveProgress: 0,   // 0-1 animation between tiles
                    prevQ: q,
                    prevR: r,
                    // Behavior
                    idleTimer: rng() * 5 + 2,  // seconds until next move
                    state: 'idle',  // idle, walking, at_building
                    currentBuilding: null,
                    destinations: typeDef.destinations || [],
                    // Traveler tracking
                    visitsLeft: npcType === 'traveler' ? (1 + Math.floor(rng() * 3)) : -1,
                    departing: false,
                });
            }
        }
    },

    /**
     * Update all NPCs — called every frame with deltaTime (seconds)
     */
    updateNPCs(deltaTime) {
        if (!this.active || this.npcs.length === 0) return;

        for (const npc of this.npcs) {
            // Safety: if NPC is somehow on an impassable tile, relocate to nearest passable
            const curTile = this.tiles[npc.r] && this.tiles[npc.r][npc.q];
            if (!curTile || !curTile.subTerrain.passable) {
                let relocated = false;
                const neighbors = [
                    { q: npc.q + 1, r: npc.r },
                    { q: npc.q - 1, r: npc.r },
                    { q: npc.q, r: npc.r + 1 },
                    { q: npc.q, r: npc.r - 1 },
                ];
                for (const nb of neighbors) {
                    if (nb.q >= 0 && nb.q < this.width && nb.r >= 0 && nb.r < this.height) {
                        const t = this.tiles[nb.r][nb.q];
                        if (t && t.subTerrain.passable) {
                            npc.q = nb.q; npc.r = nb.r;
                            npc.prevQ = nb.q; npc.prevR = nb.r;
                            npc.path = null;
                            npc.state = 'idle';
                            npc.idleTimer = 1;
                            relocated = true;
                            break;
                        }
                    }
                }
                if (!relocated) { npc.state = 'gone'; continue; }
            }

            switch (npc.state) {
                case 'idle':
                    npc.idleTimer -= deltaTime;
                    if (npc.idleTimer <= 0) {
                        // Pick a new destination
                        this._npcPickDestination(npc);
                    }
                    break;

                case 'walking':
                    if (npc.path && npc.pathIndex < npc.path.length) {
                        npc.moveProgress += deltaTime * npc.speed * 2;
                        if (npc.moveProgress >= 1.0) {
                            npc.moveProgress = 0;
                            npc.prevQ = npc.q;
                            npc.prevR = npc.r;
                            const step = npc.path[npc.pathIndex];

                            // Defensive: never step onto impassable tile
                            const stepTile = this.tiles[step.r] && this.tiles[step.r][step.q];
                            if (!stepTile || !stepTile.subTerrain.passable) {
                                npc.path = null;
                                npc.state = 'idle';
                                npc.idleTimer = 1 + Math.random() * 3;
                                break;
                            }

                            npc.q = step.q;
                            npc.r = step.r;
                            npc.pathIndex++;

                            if (npc.pathIndex >= npc.path.length) {
                                // Arrived at destination
                                npc.path = null;

                                // If departing traveler reached map edge, remove them
                                if (npc.departing) {
                                    npc.state = 'gone';
                                    continue;
                                }

                                const bldg = this.getBuildingAt(npc.q, npc.r);
                                if (bldg) {
                                    npc.state = 'at_building';
                                    npc.currentBuilding = bldg.type;
                                    npc.idleTimer = 3 + Math.random() * 8;
                                    // Traveler visited a place
                                    if (npc.visitsLeft > 0) npc.visitsLeft--;
                                } else {
                                    npc.state = 'idle';
                                    npc.idleTimer = 1 + Math.random() * 4;
                                }
                            }
                        }
                    } else {
                        npc.state = 'idle';
                        npc.idleTimer = 1 + Math.random() * 3;
                    }
                    break;

                case 'at_building':
                    npc.idleTimer -= deltaTime;
                    if (npc.idleTimer <= 0) {
                        npc.currentBuilding = null;
                        npc.state = 'idle';
                        npc.idleTimer = 0.5;
                    }
                    break;
            }
        }

        // Remove departed travelers
        this.npcs = this.npcs.filter(n => n.state !== 'gone');
    },

    /**
     * Find the nearest passable edge tile from a given position
     */
    _findNearestEdgeTile(fromQ, fromR) {
        let best = null;
        let bestDist = Infinity;
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                // Must be on the map edge
                if (q !== 0 && q !== this.width - 1 && r !== 0 && r !== this.height - 1) continue;
                if (!this.tiles[r] || !this.tiles[r][q] || !this.tiles[r][q].subTerrain.passable) continue;
                const dist = Math.abs(q - fromQ) + Math.abs(r - fromR);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { q, r };
                }
            }
        }
        return best;
    },

    /**
     * Pick a new destination for an NPC to walk to
     */
    _npcPickDestination(npc) {
        // Traveler departing: head to edge of map
        if (npc.type === 'traveler' && npc.visitsLeft <= 0 && !npc.departing) {
            const edge = this._findNearestEdgeTile(npc.q, npc.r);
            if (edge) {
                const path = this._findPath(npc.q, npc.r, edge.q, edge.r);
                if (path && path.length > 1) {
                    npc.departing = true;
                    npc.path = path.slice(1);
                    npc.pathIndex = 0;
                    npc.moveProgress = 0;
                    npc.prevQ = npc.q;
                    npc.prevR = npc.r;
                    npc.state = 'walking';
                    return;
                }
            }
            // Can't path to edge, just vanish
            npc.state = 'gone';
            return;
        }

        // Find buildings matching NPC's preferred destinations
        const candidates = this.buildings.filter(b =>
            npc.destinations.includes(b.type) && (b.q !== npc.q || b.r !== npc.r)
        );

        let target = null;
        if (candidates.length > 0) {
            target = candidates[Math.floor(Math.random() * candidates.length)];
        } else {
            // Random passable tile
            let attempts = 0;
            do {
                const rq = Math.floor(Math.random() * this.width);
                const rr = Math.floor(Math.random() * this.height);
                if (this.tiles[rr] && this.tiles[rr][rq] && this.tiles[rr][rq].subTerrain.passable) {
                    target = { q: rq, r: rr };
                    break;
                }
                attempts++;
            } while (attempts < 20);
        }

        if (target) {
            const path = this._findPath(npc.q, npc.r, target.q, target.r);
            if (path && path.length > 1) {
                npc.path = path.slice(1); // Remove start position
                npc.pathIndex = 0;
                npc.moveProgress = 0;
                npc.prevQ = npc.q;
                npc.prevR = npc.r;
                npc.state = 'walking';
                return;
            }
        }

        // Couldn't find a path, just idle again
        npc.state = 'idle';
        npc.idleTimer = 2 + Math.random() * 5;
    },

    /**
     * Get NPC at a specific tile position
     */
    getNPCsAt(q, r) {
        return this.npcs.filter(n => n.q === q && n.r === r);
    },
};

// InnerMap — interiors members (split from the original monolith).
import { InnerMap } from './_ref.js';
import { Utils, Hex, CustomObjects, CustomBuildings, CustomInteriors, generateSpriteInterior, SettlementGenerator, DataLoader, Terrain, NpcFamily } from './_imports.js';

Object.assign(InnerMap, {
    /**
     * Enter an inner map from the world map
     * @param {Object} game - The game instance
     * @param {number} worldQ - World tile q coordinate
     * @param {number} worldR - World tile r coordinate
     */
    enter(game, worldQ, worldR) {
        const worldTile = game.world.getTile(worldQ, worldR);
        if (!worldTile) return false;

        const hasSettlement = !!worldTile.settlement;

        // All inner maps are a fixed size
        this.width = this.INNER_MAP_SIZE;
        this.height = this.INNER_MAP_SIZE;

        // Season must be set before generation — the 9-tile brushes pick
        // their seasonal tiles from it while stamping.
        this.season = game.world ? game.world.season : 'Spring';

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

        // ── Restore or initialize time system ──
        const timeKey = `${worldQ},${worldR}`;
        const savedTime = this._timeCache[timeKey];
        if (savedTime) {
            this.timeOfDay = savedTime.timeOfDay;
            this._timeAccumulator = savedTime._timeAccumulator;
            this.dayEnded = savedTime.dayEnded || false;
        } else {
            this.timeOfDay = 8;  // Start at 8 AM
            this._timeAccumulator = 0;
            this.dayEnded = false;
        }

        // ── Snapshot weather / temperature from world ──
        if (game.world && game.world.weather) {
            this.weather = game.world.weather.getWeather(worldQ, worldR);
            this.temperature = game.world.weather.getTemperature(worldQ, worldR);
        } else {
            this.weather = { type: 'clear', intensity: 0 };
            this.temperature = { value: 0.5, celsius: 10, fahrenheit: 50 };
        }
        this.worldDay = game.world ? (game.world.day || 0) : 0;

        // ── Generate buildings list for settlement tiles ──
        this.buildings = [];
        this.roads = [];
        if (hasSettlement) {
            this._buildBuildingList();
            // Use pre-generated road data from SettlementGenerator if available
            if (this.tiles._settlementLayout && this.tiles._settlementLayout.roadTiles) {
                const roadSet = new Set();
                for (const rt of this.tiles._settlementLayout.roadTiles) {
                    const key = `${rt.q},${rt.r}`;
                    if (!roadSet.has(key)) {
                        roadSet.add(key);
                        this.roads.push({ q: rt.q, r: rt.r });
                        const tile = this.getTile(rt.q, rt.r);
                        if (tile) tile.isRoad = true;
                    }
                }
            } else if (this.tiles.some(row => row.some(t => t && t.isRoad))) {
                // The layout is a property on the tiles array, which JSON
                // save/load drops — but the per-tile road flags survive, so
                // rebuild the list from them instead of carving a fresh
                // network through the already-stamped grass.
                for (let r = 0; r < this.height; r++) {
                    for (let q = 0; q < this.width; q++) {
                        if (this.tiles[r][q].isRoad) this.roads.push({ q, r });
                    }
                }
            } else {
                this._generateRoads();
            }
            // Roads added after generation cut through the grass layer —
            // re-auto-tile it so grass edges meet the dirt cleanly.
            this._refreshGrassLayer(this.tiles);
        }

        // ── Add player property buildings (works for settlement and wilderness tiles) ──
        this._addPropertyBuildings();

        // ── Spawn NPCs ──
        this.npcs = [];
        this._npcMoveTimer = 0;
        if (hasSettlement) {
            this._spawnNPCs(worldTile.settlement);
            this._assignBuildingOwners(game.player);
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
        // If inside a building, exit to the outer map first
        if (this._insideBuilding) {
            this.exitBuilding(game);
        }

        // Save time state for this tile before exiting
        if (this.currentWorldTile) {
            const timeKey = `${this.currentWorldTile.q},${this.currentWorldTile.r}`;
            this._timeCache[timeKey] = {
                timeOfDay: this.timeOfDay,
                _timeAccumulator: this._timeAccumulator,
                dayEnded: this.dayEnded
            };
        }

        this.active = false;
        this.currentWorldTile = null;
        this._currentWorldTileRef = null;
        this.npcs = [];
        this.buildings = [];
        this.roads = [];
        this.dayEnded = false;
        this._pendingInteraction = null;
        this._activeInteraction = null;
        this._pendingDialog = null;
        this._insideBuilding = null;
        this._outerMapState = null;
        // Tiles remain cached for re-entry
    },

    // ══════════════════════════════════════════════
    // BUILDING INTERIOR SYSTEM
    // Enter and explore the inside of buildings
    // ══════════════════════════════════════════════
    /**
     * Interior layout definitions for each building type.
     * Defines the size, floor tile, wall placement, and furniture/objects.
     */
    INTERIOR_LAYOUTS: {
        town_hall: {
            width: 12, height: 10, floor: 'wood_floor', wallColor: '#5a4a3a',
            furniture: [
                { type: 'table', icon: '🪑', name: 'Council Table', q: 5, r: 4, passable: false },
                { type: 'throne', icon: '👑', name: 'Lord\'s Chair', q: 6, r: 2, passable: false },
                { type: 'bookshelf', icon: '📚', name: 'Bookshelf', q: 1, r: 1, passable: false },
                { type: 'bookshelf', icon: '📚', name: 'Bookshelf', q: 2, r: 1, passable: false },
                { type: 'chest', icon: '📦', name: 'Storage Chest', q: 10, r: 1, passable: false },
                { type: 'candle', icon: '🕯️', name: 'Candelabra', q: 5, r: 2, passable: true },
                { type: 'banner', icon: '🚩', name: 'Royal Banner', q: 8, r: 1, passable: true },
            ]
        },
        marketplace: {
            width: 14, height: 10, floor: 'stone_floor', wallColor: '#6a5a4a',
            furniture: [
                { type: 'stall', icon: '🏪', name: 'Merchant Stall', q: 3, r: 3, passable: false },
                { type: 'stall', icon: '🏪', name: 'Food Stall', q: 7, r: 3, passable: false },
                { type: 'stall', icon: '🏪', name: 'Cloth Stall', q: 11, r: 3, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Barrel', q: 1, r: 1, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Barrel', q: 2, r: 1, passable: false },
                { type: 'crate', icon: '📦', name: 'Crate', q: 12, r: 1, passable: false },
                { type: 'scales', icon: '⚖️', name: 'Scales', q: 5, r: 5, passable: true },
            ]
        },
        tavern: {
            width: 12, height: 10, floor: 'wood_floor', wallColor: '#4a3a2a',
            furniture: [
                { type: 'bar', icon: '🍺', name: 'Bar Counter', q: 2, r: 2, passable: false },
                { type: 'bar', icon: '🍺', name: 'Bar Counter', q: 3, r: 2, passable: false },
                { type: 'bar', icon: '🍺', name: 'Bar Counter', q: 4, r: 2, passable: false },
                { type: 'table', icon: '🪑', name: 'Table', q: 2, r: 5, passable: false },
                { type: 'table', icon: '🪑', name: 'Table', q: 6, r: 5, passable: false },
                { type: 'table', icon: '🪑', name: 'Table', q: 9, r: 5, passable: false },
                { type: 'table', icon: '🪑', name: 'Table', q: 6, r: 7, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Ale Barrel', q: 1, r: 1, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Wine Barrel', q: 1, r: 2, passable: false },
                { type: 'fireplace', icon: '🔥', name: 'Fireplace', q: 10, r: 1, passable: false },
                { type: 'stairs', icon: '🪜', name: 'Stairs Up', q: 10, r: 8, passable: true },
            ]
        },
        blacksmith: {
            width: 10, height: 8, floor: 'stone_floor', wallColor: '#3a3a3a',
            furniture: [
                { type: 'anvil', icon: '🔨', name: 'Anvil', q: 4, r: 3, passable: false },
                { type: 'forge', icon: '🔥', name: 'Forge', q: 2, r: 1, passable: false },
                { type: 'forge', icon: '🔥', name: 'Forge', q: 3, r: 1, passable: false },
                { type: 'rack', icon: '⚔️', name: 'Weapon Rack', q: 7, r: 1, passable: false },
                { type: 'rack', icon: '🛡️', name: 'Armor Rack', q: 8, r: 1, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Water Barrel', q: 1, r: 5, passable: false },
                { type: 'chest', icon: '📦', name: 'Supply Chest', q: 8, r: 6, passable: false },
            ]
        },
        church: {
            width: 10, height: 12, floor: 'stone_floor', wallColor: '#7a7a8a',
            furniture: [
                { type: 'altar', icon: '⛪', name: 'Altar', q: 4, r: 2, passable: false },
                { type: 'altar', icon: '⛪', name: 'Altar', q: 5, r: 2, passable: false },
                { type: 'pew', icon: '🪑', name: 'Pew', q: 3, r: 5, passable: false },
                { type: 'pew', icon: '🪑', name: 'Pew', q: 6, r: 5, passable: false },
                { type: 'pew', icon: '🪑', name: 'Pew', q: 3, r: 7, passable: false },
                { type: 'pew', icon: '🪑', name: 'Pew', q: 6, r: 7, passable: false },
                { type: 'candle', icon: '🕯️', name: 'Candle Stand', q: 2, r: 2, passable: true },
                { type: 'candle', icon: '🕯️', name: 'Candle Stand', q: 7, r: 2, passable: true },
                { type: 'bookshelf', icon: '📖', name: 'Holy Texts', q: 1, r: 1, passable: false },
            ]
        },
        temple: {
            width: 12, height: 12, floor: 'stone_floor', wallColor: '#8a7a6a',
            furniture: [
                { type: 'altar', icon: '🕌', name: 'Sacred Altar', q: 5, r: 2, passable: false },
                { type: 'altar', icon: '🕌', name: 'Sacred Altar', q: 6, r: 2, passable: false },
                { type: 'statue', icon: '🗿', name: 'Statue', q: 2, r: 3, passable: false },
                { type: 'statue', icon: '🗿', name: 'Statue', q: 9, r: 3, passable: false },
                { type: 'pew', icon: '🪑', name: 'Prayer Mat', q: 4, r: 6, passable: false },
                { type: 'pew', icon: '🪑', name: 'Prayer Mat', q: 7, r: 6, passable: false },
                { type: 'pew', icon: '🪑', name: 'Prayer Mat', q: 4, r: 8, passable: false },
                { type: 'pew', icon: '🪑', name: 'Prayer Mat', q: 7, r: 8, passable: false },
                { type: 'candle', icon: '🕯️', name: 'Incense Burner', q: 5, r: 4, passable: true },
                { type: 'chest', icon: '📦', name: 'Offering Box', q: 10, r: 1, passable: false },
            ]
        },
        barracks: {
            width: 12, height: 10, floor: 'stone_floor', wallColor: '#4a4a4a',
            furniture: [
                { type: 'bed', icon: '🛏️', name: 'Bunk', q: 1, r: 1, passable: false },
                { type: 'bed', icon: '🛏️', name: 'Bunk', q: 3, r: 1, passable: false },
                { type: 'bed', icon: '🛏️', name: 'Bunk', q: 5, r: 1, passable: false },
                { type: 'bed', icon: '🛏️', name: 'Bunk', q: 1, r: 3, passable: false },
                { type: 'bed', icon: '🛏️', name: 'Bunk', q: 3, r: 3, passable: false },
                { type: 'bed', icon: '🛏️', name: 'Bunk', q: 5, r: 3, passable: false },
                { type: 'rack', icon: '⚔️', name: 'Weapon Rack', q: 9, r: 1, passable: false },
                { type: 'rack', icon: '🛡️', name: 'Shield Rack', q: 10, r: 1, passable: false },
                { type: 'table', icon: '🪑', name: 'Mess Table', q: 8, r: 5, passable: false },
                { type: 'chest', icon: '📦', name: 'Equipment Chest', q: 10, r: 8, passable: false },
            ]
        },
        house: {
            width: 8, height: 7, floor: 'wood_floor', wallColor: '#6a5a4a',
            furniture: [
                { type: 'bed', icon: '🛏️', name: 'Bed', q: 1, r: 1, passable: false },
                { type: 'table', icon: '🪑', name: 'Table', q: 4, r: 2, passable: false },
                { type: 'fireplace', icon: '🔥', name: 'Hearth', q: 6, r: 1, passable: false },
                { type: 'chest', icon: '📦', name: 'Storage Chest', q: 1, r: 5, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Water Barrel', q: 6, r: 5, passable: false },
            ]
        },
        manor: {
            width: 14, height: 12, floor: 'wood_floor', wallColor: '#5a4a3a',
            furniture: [
                { type: 'throne', icon: '👑', name: 'Lord\'s Chair', q: 6, r: 2, passable: false },
                { type: 'table', icon: '🪑', name: 'Dining Table', q: 5, r: 5, passable: false },
                { type: 'table', icon: '🪑', name: 'Dining Table', q: 6, r: 5, passable: false },
                { type: 'table', icon: '🪑', name: 'Dining Table', q: 7, r: 5, passable: false },
                { type: 'bed', icon: '🛏️', name: 'Master Bed', q: 11, r: 2, passable: false },
                { type: 'bookshelf', icon: '📚', name: 'Library', q: 1, r: 1, passable: false },
                { type: 'bookshelf', icon: '📚', name: 'Library', q: 2, r: 1, passable: false },
                { type: 'fireplace', icon: '🔥', name: 'Grand Fireplace', q: 12, r: 1, passable: false },
                { type: 'chest', icon: '📦', name: 'Treasury Chest', q: 12, r: 10, passable: false },
                { type: 'banner', icon: '🚩', name: 'Family Banner', q: 6, r: 1, passable: true },
                { type: 'stairs', icon: '🪜', name: 'Staircase', q: 1, r: 10, passable: true },
            ]
        },
        granary: {
            width: 8, height: 8, floor: 'wood_floor', wallColor: '#6a5a4a',
            furniture: [
                { type: 'barrel', icon: '🛢️', name: 'Grain Barrel', q: 1, r: 1, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Grain Barrel', q: 2, r: 1, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Grain Barrel', q: 3, r: 1, passable: false },
                { type: 'crate', icon: '📦', name: 'Grain Sack', q: 5, r: 1, passable: false },
                { type: 'crate', icon: '📦', name: 'Grain Sack', q: 6, r: 1, passable: false },
                { type: 'scales', icon: '⚖️', name: 'Scales', q: 3, r: 4, passable: true },
            ]
        },
        warehouse: {
            width: 12, height: 10, floor: 'stone_floor', wallColor: '#5a5a5a',
            furniture: [
                { type: 'crate', icon: '📦', name: 'Crate', q: 1, r: 1, passable: false },
                { type: 'crate', icon: '📦', name: 'Crate', q: 2, r: 1, passable: false },
                { type: 'crate', icon: '📦', name: 'Crate', q: 3, r: 1, passable: false },
                { type: 'crate', icon: '📦', name: 'Crate', q: 1, r: 2, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Barrel', q: 8, r: 1, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Barrel', q: 9, r: 1, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Barrel', q: 10, r: 1, passable: false },
                { type: 'chest', icon: '📦', name: 'Locked Chest', q: 10, r: 8, passable: false },
                { type: 'scales', icon: '⚖️', name: 'Scales', q: 5, r: 5, passable: true },
            ]
        },
        stable: {
            width: 10, height: 8, floor: 'dirt_floor', wallColor: '#5a4a3a',
            furniture: [
                { type: 'stall', icon: '🐴', name: 'Horse Stall', q: 1, r: 1, passable: false },
                { type: 'stall', icon: '🐴', name: 'Horse Stall', q: 3, r: 1, passable: false },
                { type: 'stall', icon: '🐴', name: 'Horse Stall', q: 5, r: 1, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Water Trough', q: 7, r: 1, passable: false },
                { type: 'crate', icon: '🌾', name: 'Hay Bale', q: 8, r: 1, passable: false },
                { type: 'crate', icon: '🌾', name: 'Hay Bale', q: 8, r: 2, passable: false },
            ]
        },
        well: {
            width: 6, height: 6, floor: 'stone_floor', wallColor: '#7a7a7a',
            furniture: [
                { type: 'well', icon: '💧', name: 'Well', q: 2, r: 2, passable: false },
                { type: 'bucket', icon: '🪣', name: 'Bucket', q: 3, r: 3, passable: true },
            ]
        },
        barn: {
            width: 10, height: 8, floor: 'dirt_floor', wallColor: '#6a4a3a',
            furniture: [
                { type: 'crate', icon: '🌾', name: 'Hay Bale', q: 1, r: 1, passable: false },
                { type: 'crate', icon: '🌾', name: 'Hay Bale', q: 2, r: 1, passable: false },
                { type: 'crate', icon: '🌾', name: 'Hay Bale', q: 1, r: 2, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Feed Barrel', q: 7, r: 1, passable: false },
                { type: 'chest', icon: '📦', name: 'Tool Chest', q: 8, r: 6, passable: false },
            ]
        },
        guard_tower: {
            width: 6, height: 8, floor: 'stone_floor', wallColor: '#5a5a5a',
            furniture: [
                { type: 'rack', icon: '⚔️', name: 'Weapon Rack', q: 1, r: 1, passable: false },
                { type: 'rack', icon: '🛡️', name: 'Shield Rack', q: 4, r: 1, passable: false },
                { type: 'table', icon: '🪑', name: 'Watch Table', q: 2, r: 3, passable: false },
                { type: 'stairs', icon: '🪜', name: 'Stairs Up', q: 4, r: 6, passable: true },
            ]
        },
        farm: {
            width: 8, height: 6, floor: 'dirt_floor', wallColor: '#6a5a4a',
            furniture: [
                { type: 'table', icon: '🪑', name: 'Work Table', q: 3, r: 2, passable: false },
                { type: 'bed', icon: '🛏️', name: 'Straw Bed', q: 1, r: 1, passable: false },
                { type: 'barrel', icon: '🛢️', name: 'Water Barrel', q: 6, r: 1, passable: false },
                { type: 'crate', icon: '🌾', name: 'Seed Crate', q: 6, r: 4, passable: false },
            ]
        },
    },

    /**
     * Floor tile definitions for building interiors
     */
    INTERIOR_FLOORS: {
        wood_floor:  { color: '#8B7355', altColor: '#7A6548', name: 'Wooden Floor' },
        stone_floor: { color: '#8a8a8a', altColor: '#7a7a7a', name: 'Stone Floor' },
        dirt_floor:  { color: '#9a8a6a', altColor: '#8a7a5a', name: 'Dirt Floor' },
    },

    /**
     * Furniture type rendering info
     */
    FURNITURE_COLORS: {
        table: '#6a4a2a', throne: '#8a6a3a', bookshelf: '#5a3a1a', chest: '#7a5a2a',
        candle: '#f5c542', banner: '#c0392b', bar: '#5a3a1a', barrel: '#6a4a2a',
        fireplace: '#e74c3c', bed: '#7a6a5a', rack: '#5a5a5a', anvil: '#4a4a4a',
        forge: '#e74c3c', stall: '#6a5a3a', altar: '#aaaacc', pew: '#6a4a2a',
        statue: '#999999', crate: '#7a5a2a', scales: '#aaaaaa', well: '#6a8aaa',
        bucket: '#6a5a4a', stairs: '#8a7a6a',
    },

    /**
     * Enter a building interior. Saves outer map state and generates interior tiles.
     * @param {Object} building - The building object from InnerMap.buildings[]
     * @param {Object} game - The game instance
     * @returns {boolean} Success
     */
    enterBuilding(building, game) {
        if (!building || !this.active) return false;
        if (this._insideBuilding) return false; // Already inside

        // Save current outer map state
        this._outerMapState = {
            tiles: this.tiles,
            width: this.width,
            height: this.height,
            playerInnerQ: this.playerInnerQ,
            playerInnerR: this.playerInnerR,
            buildings: this.buildings,
            roads: this.roads,
            npcs: this.npcs,
            _npcMoveTimer: this._npcMoveTimer,
        };

        // Get or generate interior
        const interiorKey = `${this.currentWorldTile.q},${this.currentWorldTile.r}_${building.type}_${building.q}_${building.r}`;
        let interior = this._interiorCache[interiorKey];
        if (!interior) {
            interior = this._generateInterior(building, interiorKey);
            this._interiorCache[interiorKey] = interior;
        }

        // Apply interior state
        this._insideBuilding = building;
        this.tiles = interior.tiles;
        this.width = interior.width;
        this.height = interior.height;
        this.buildings = []; // No sub-buildings inside
        this.roads = [];

        // Populate interior with NPCs that are currently inside this building
        const interiorNpcs = [];
        const outerNpcs = this._outerMapState.npcs;
        for (const npc of outerNpcs) {
            if (npc.state === 'inside_building' &&
                npc._insideBuildingQ === building.q &&
                npc._insideBuildingR === building.r) {
                // Place NPC on a passable interior tile
                const placed = this._placeNpcInInterior(npc, interior);
                if (placed) interiorNpcs.push(npc);
            }
        }
        this.npcs = interiorNpcs;

        // Place player at the door (bottom center)
        this.playerInnerQ = Math.floor(this.width / 2);
        this.playerInnerR = this.height - 2;

        // Cancel any walk/interaction state
        this.cancelPlayerWalk();
        this._pendingInteraction = null;
        this._activeInteraction = null;

        return true;
    },

    /**
     * Exit the building interior and restore the outer inner map.
     * @param {Object} game - The game instance
     */
    exitBuilding(game) {
        if (!this._insideBuilding || !this._outerMapState) return;

        const building = this._insideBuilding;

        // Restore outer map state
        this.tiles = this._outerMapState.tiles;
        this.width = this._outerMapState.width;
        this.height = this._outerMapState.height;
        this.playerInnerQ = this._outerMapState.playerInnerQ;
        this.playerInnerR = this._outerMapState.playerInnerR;
        this.buildings = this._outerMapState.buildings;
        this.roads = this._outerMapState.roads;
        this.npcs = this._outerMapState.npcs;
        this._npcMoveTimer = this._outerMapState._npcMoveTimer;

        // Place player next to the building they exited
        // Try to place at the building's position (or adjacent)
        const adj = this._findPassableAdjacentTile(building.q, building.r);
        if (adj) {
            this.playerInnerQ = adj.q;
            this.playerInnerR = adj.r;
        }

        // Any NPCs that were shown in the interior go back to inside_building state
        // (they'll eventually exit on their own timer from outerNpcs)

        this._insideBuilding = null;
        this._outerMapState = null;

        // Cancel any walk/interaction state
        this.cancelPlayerWalk();
        this._pendingInteraction = null;
        this._activeInteraction = null;
    },

    /**
     * Place an NPC at a walkable position inside a building interior.
     * Modifies npc.q/r in place. Returns true if placed successfully.
     */
    _placeNpcInInterior(npc, interior) {
        const w = interior.width, h = interior.height;
        const tiles = interior.tiles;
        // Collect passable interior tiles (avoid the door row)
        const candidates = [];
        for (let r = 1; r < h - 1; r++) {
            for (let q = 1; q < w - 1; q++) {
                if (tiles[r] && tiles[r][q] && tiles[r][q].subTerrain &&
                    tiles[r][q].subTerrain.passable && !tiles[r][q]._isDoor) {
                    candidates.push({ q, r });
                }
            }
        }
        if (candidates.length === 0) return false;
        const pos = candidates[Math.floor(Utils.random() * candidates.length)];
        npc.q = pos.q;
        npc.r = pos.r;
        npc.prevQ = pos.q;
        npc.prevR = pos.r;
        npc.path = null;
        npc.moveProgress = 0;
        // Keep them idle inside the interior (state stays inside_building
        // but the renderer will show them because _insideBuilding is set)
        return true;
    },

    /**
     * Find a passable tile adjacent to the given position
     */
    _findPassableAdjacentTile(q, r) {
        const dirs = [
            { dq: 0, dr: 1 }, { dq: 1, dr: 0 }, { dq: 0, dr: -1 }, { dq: -1, dr: 0 },
            { dq: 1, dr: 1 }, { dq: -1, dr: 1 }, { dq: 1, dr: -1 }, { dq: -1, dr: -1 },
        ];
        for (const d of dirs) {
            const nq = q + d.dq, nr = r + d.dr;
            if (nq >= 0 && nq < this.width && nr >= 0 && nr < this.height) {
                const tile = this.tiles[nr] && this.tiles[nr][nq];
                if (tile && tile.subTerrain && tile.subTerrain.passable) return { q: nq, r: nr };
            }
        }
        return { q, r };
    },

    /**
     * Generate the interior tile grid for a building.
     * If CustomInteriors has a matching authored interior, use it; otherwise
     * fall back to the hardcoded INTERIOR_LAYOUTS procedural generation.
     * @param {Object} building - Building definition with type/name
     * @param {string} [interiorKey] - Cache key used as deterministic seed
     * @returns {{ tiles: Array, width: number, height: number }}
     */
    _generateInterior(building, interiorKey) {
        // ── Try linked custom interior first (by building def ID) ──
        if (building._customDefId && typeof CustomInteriors !== 'undefined') {
            const linked = CustomInteriors.pickForBuildingId(building._customDefId);
            if (linked) {
                console.log(`[Interior] Using linked interior "${linked.id || linked.name}" for building "${building.name}" (defId: ${building._customDefId})`);
                return this._generateCustomInterior(linked, building);
            }
        }

        // ── Try custom-authored interior by building type (plus aliases) ──
        if (typeof CustomInteriors !== 'undefined' && CustomInteriors.hasAny()) {
            const seed = interiorKey || `${building.type}_${building.q}_${building.r}`;
            const typeCandidates = [];
            const addType = (t) => {
                if (!t || typeof t !== 'string') return;
                if (!typeCandidates.includes(t)) typeCandidates.push(t);
            };

            addType(building.type);
            addType((building.type || '').replace(/^player_/, ''));

            if (building._customDefId && typeof CustomBuildings !== 'undefined' && typeof CustomBuildings.getBuilding === 'function') {
                const customDef = CustomBuildings.getBuilding(building._customDefId);
                if (customDef && customDef.buildingType) {
                    addType(customDef.buildingType);
                }
            }

            const typeAlias = {
                marketplace: 'market',
                market: 'marketplace',
                town_hall: 'townhall',
                townhall: 'town_hall',
                blacksmith: 'smithy',
                smithy: 'blacksmith',
            };
            for (const t of [...typeCandidates]) {
                addType(typeAlias[t]);
            }

            for (const t of typeCandidates) {
                const def = CustomInteriors.pickForBuilding(t, `${seed}_${t}`);
                if (def) {
                    return this._generateCustomInterior(def, building);
                }
            }
        }

        // ── Try sprite-based procedural interior (interior_floor/interior_wall brushes) ──
        // This runs after custom authored interiors and before the colored-box fallback.
        // Returns null if no interior brush types are registered, so the fallback still works.
        if (typeof CustomInteriors !== 'undefined') {
            const seed = interiorKey || `${building.type}_${building.q}_${building.r}`;
            const spriteInterior = generateSpriteInterior(building, seed);
            if (spriteInterior) {
                return spriteInterior;
            }
        }

        // ── Fallback: procedural interior from INTERIOR_LAYOUTS ──
        console.log(`[Interior] Falling back to procedural interior for "${building.name}" (type: ${building.type}, defId: ${building._customDefId || 'none'}, customInteriorsLoaded: ${typeof CustomInteriors !== 'undefined' ? CustomInteriors.hasAny() : false})`);
        const layout = this.INTERIOR_LAYOUTS[building.type] || this.INTERIOR_LAYOUTS.house;
        const w = layout.width;
        const h = layout.height;
        const floorDef = this.INTERIOR_FLOORS[layout.floor] || this.INTERIOR_FLOORS.wood_floor;

        const tiles = [];
        for (let r = 0; r < h; r++) {
            tiles[r] = [];
            for (let q = 0; q < w; q++) {
                const isWall = (r === 0 || q === 0 || q === w - 1);
                const isDoor = (r === h - 1 && q === Math.floor(w / 2));

                // Checkerboard floor pattern
                const isAlt = (q + r) % 2 === 0;

                tiles[r][q] = {
                    q, r,
                    baseTerrain: isWall ? 'wall' : layout.floor,
                    subTerrain: isWall ? {
                        id: 'wall', name: 'Wall', icon: '🧱', color: layout.wallColor, passable: false
                    } : {
                        id: layout.floor, name: floorDef.name, icon: '🏠',
                        color: isAlt ? floorDef.color : floorDef.altColor, passable: true
                    },
                    explored: true,
                    visible: true,
                    parentTerrain: 'interior',
                    encounter: null,
                    building: null,
                    _isInterior: true,
                    _interiorBuildingType: building.type,
                    _furniture: null,
                    effectiveTemp: 20,
                    moisture: 0.3,
                    weatherType: 'clear',
                };

                // Door tile
                if (isDoor) {
                    tiles[r][q].baseTerrain = layout.floor;
                    tiles[r][q].subTerrain = {
                        id: 'door', name: 'Door', icon: '🚪',
                        color: '#6a4a2a', passable: true
                    };
                    tiles[r][q]._isDoor = true;
                }
            }
        }

        // Place furniture
        for (const furn of (layout.furniture || [])) {
            if (furn.q >= 0 && furn.q < w && furn.r >= 0 && furn.r < h) {
                const tile = tiles[furn.r][furn.q];
                tile._furniture = {
                    type: furn.type,
                    icon: furn.icon,
                    name: furn.name,
                    passable: furn.passable,
                };
                if (!furn.passable) {
                    tile.subTerrain = {
                        id: `furniture_${furn.type}`,
                        name: furn.name,
                        icon: furn.icon,
                        color: this.FURNITURE_COLORS[furn.type] || '#6a5a4a',
                        passable: false,
                    };
                }
            }
        }

        // ── Overlay nine-tile brush sprites if available ──
        if (typeof CustomInteriors !== 'undefined' && CustomInteriors.getBrushes().length > 0) {
            const seed = interiorKey || `${building.type}_${building.q}_${building.r}`;
            const floorBrush = CustomInteriors.pickFloorBrush(seed);
            const wallBrush  = CustomInteriors.pickWallBrush(seed + '_wall');

            if (floorBrush || wallBrush) {
                // Build brushGroupMap for auto-tiling
                const brushGroupMap = {};
                for (let r2 = 0; r2 < h; r2++) {
                    for (let q2 = 0; q2 < w; q2++) {
                        const tile = tiles[r2][q2];
                        const key = `${q2},${r2}`;
                        if (tile.baseTerrain === 'wall' && wallBrush) {
                            brushGroupMap[key] = { brushId: wallBrush.id, layer: 'walls' };
                        } else if (tile.baseTerrain !== 'wall' && !tile._isDoor && floorBrush) {
                            brushGroupMap[key] = { brushId: floorBrush.id, layer: 'floor' };
                        }
                    }
                }

                // Resolve auto-tile for each cell and attach _customTile data
                for (let r2 = 0; r2 < h; r2++) {
                    for (let q2 = 0; q2 < w; q2++) {
                        const tile = tiles[r2][q2];
                        const key = `${q2},${r2}`;
                        const entry = brushGroupMap[key];
                        if (!entry) continue;

                        const brush = entry.layer === 'walls' ? wallBrush : floorBrush;
                        const resolved = CustomInteriors.resolveNineTile(brush, q2, r2, brushGroupMap, w, h);
                        if (resolved && resolved.sheetPath) {
                            tile._customTile = {
                                floor:   entry.layer === 'floor' ? resolved : null,
                                walls:   entry.layer === 'walls' ? resolved : null,
                                furniture: null,
                                overlay:   null,
                            };
                        }
                    }
                }
            }
        }

        return { tiles, width: w, height: h };
    },

    /**
     * Generate interior tiles from a custom-authored interior definition.
     * Tiles carry _customTile data so the renderer can draw spritesheets.
     * @param {Object} def - The CustomInteriors definition
     * @param {Object} building - The building being entered
     * @returns {{ tiles: Array, width: number, height: number }}
     */
    _generateCustomInterior(def, building) {
        const w = def.width;
        const h = def.height;
        const oq = def.bounds.minCol;  // origin offset
        const or_ = def.bounds.minRow;

        const tiles = [];
        for (let r = 0; r < h; r++) {
            tiles[r] = [];
            for (let q = 0; q < w; q++) {
                // Absolute coords in the editor grid
                const aq = q + oq;
                const ar = r + or_;
                const key = `${aq},${ar}`;

                // Gather per-layer sprite data
                const floorCell   = def._layerMaps.floor     && def._layerMaps.floor[key];
                const furnCell    = def._layerMaps.furniture  && def._layerMaps.furniture[key];
                const wallsCell   = def._layerMaps.walls      && def._layerMaps.walls[key];
                const overlayCell = def._layerMaps.overlay    && def._layerMaps.overlay[key];
                const meta        = def._metaMap[key] || {};

                const hasFloor = !!floorCell;
                const hasWall  = !!wallsCell;
                const isDoor   = !!meta.door;
                const isImpass = !!meta.impassable || (hasWall && !isDoor);
                const hasFurn  = !!meta.furniture;

                // Determine passability and display info
                let passable = !isImpass;
                if (isDoor) passable = true;
                if (hasFurn && meta.furniture && meta.furniture.passable === false) passable = false;

                const terrainId = isDoor ? 'door'
                    : hasWall ? 'wall'
                    : hasFloor ? 'custom_floor'
                    : 'void';

                tiles[r][q] = {
                    q, r,
                    baseTerrain: terrainId,
                    subTerrain: {
                        id: terrainId,
                        name: isDoor ? 'Door' : hasWall ? 'Wall' : 'Floor',
                        icon: isDoor ? '🚪' : hasWall ? '🧱' : '🏠',
                        color: isDoor ? '#6a4a2a' : hasWall ? '#5a4a3a' : '#8B7355',
                        passable: passable,
                    },
                    explored: true,
                    visible: true,
                    parentTerrain: 'interior',
                    encounter: null,
                    building: null,
                    _isInterior: true,
                    _interiorBuildingType: building.type,
                    _furniture: hasFurn ? meta.furniture : null,
                    _isDoor: isDoor,
                    effectiveTemp: 20,
                    moisture: 0.3,
                    weatherType: 'clear',
                    // Spritesheet rendering data for the renderer
                    _customTile: {
                        floor:     floorCell     || null,
                        furniture: furnCell      || null,
                        walls:     wallsCell     || null,
                        overlay:   overlayCell   || null,
                    },
                };
            }
        }

        // ── Place custom objects from the interior definition ──
        if (Array.isArray(def.placedObjects) && def.placedObjects.length > 0 &&
            typeof CustomObjects !== 'undefined' && CustomObjects.isLoaded()) {
            for (const po of def.placedObjects) {
                const aq = po.anchorQ;
                const ar = po.anchorR;
                // Bounds check — anchor must be within the generated tile grid
                if (aq < 0 || aq >= w || ar < 0 || ar >= h) continue;

                const objDef = po.defId ? CustomObjects.getDef(po.defId) : null;
                // Use the CustomObjects def tiles if available, otherwise use embedded tiles
                const objTiles = (objDef && objDef.tiles) ? objDef.tiles : (po.tiles || []);
                if (objTiles.length === 0) continue;

                // Set the anchor tile's customObject reference
                tiles[ar][aq].customObject = {
                    defId: po.defId || null,
                    sheetPath: objDef ? objDef.sheetPath : null,
                    currentHealthPct: 100,
                    _interiorPlaced: true,
                };

                // Build meta lookup for impassable flags
                let metaLookup = null;
                if (objDef && Array.isArray(objDef.meta) && objDef.meta.length > 0) {
                    metaLookup = {};
                    for (const m of objDef.meta) {
                        metaLookup[`${m.localCol},${m.localRow}`] = m;
                    }
                }

                // Mark footprint tiles
                for (const td of objTiles) {
                    const fq = aq + td.localCol;
                    const fr = ar + td.localRow;
                    if (fq < 0 || fq >= w || fr < 0 || fr >= h) continue;
                    const ft = tiles[fr][fq];
                    // Non-anchor tiles get a back-reference
                    if (td.localCol !== 0 || td.localRow !== 0) {
                        ft.customObjectPart = { anchorQ: aq, anchorR: ar };
                    }
                    // Honour impassable flags
                    const meta = metaLookup && metaLookup[`${td.localCol},${td.localRow}`];
                    if (td.impassable || (meta && meta.impassable)) {
                        ft.subTerrain.passable = false;
                    }
                }
            }
        }

        return { tiles, width: w, height: h };
    },
});

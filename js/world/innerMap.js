// ============================================
// INNER MAP — Sub-tile exploration system
// Each world hex has an inner map (smaller hex grid)
// Players can enter and explore the interior of any tile
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

    /**
     * Generate or retrieve an inner map for a world tile
     * @param {Object} worldTile - The world tile object
     * @param {number} worldQ - World tile q coordinate
     * @param {number} worldR - World tile r coordinate
     * @returns {Array} 2D array of inner map tiles
     */
    getOrGenerate(worldTile, worldQ, worldR) {
        const key = `${worldQ},${worldR}`;
        if (this._cache[key]) {
            return this._cache[key];
        }

        const tiles = this.generate(worldTile, worldQ, worldR);
        this._cache[key] = tiles;
        return tiles;
    },

    /**
     * Generate an inner map for a world tile.
     * Uses the world tile's noise values (elevation, temperature, moisture)
     * combined with per-cell fbm noise so the inner map is coherent with
     * its parent tile.
     */
    generate(worldTile, worldQ, worldR) {
        const terrainId = worldTile.terrain ? worldTile.terrain.id : 'grassland';
        const config = this.CONFIG;
        const subTerrains = config && config.subTerrains ? config.subTerrains[terrainId] : null;

        // Parent tile noise values (0-1 range)
        const parentElev = worldTile.elevation  !== undefined ? worldTile.elevation  : 0.5;
        const parentTemp = worldTile.temperature !== undefined ? worldTile.temperature : 0.5;
        const parentMoist = worldTile.moisture   !== undefined ? worldTile.moisture   : 0.5;

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

                // Use blended noise to bias the weighted random selection.
                // Map blendElev into an index range across the sorted primary list
                // so wetter / higher cells naturally pick different sub-terrains.
                const noiseBias = (blendElev * 0.5 + blendMoist * 0.5); // 0-1

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

                // Generate encounter
                let encounter = null;
                const encounterChance = config ? (config.encounterChance || 0.15) : 0.15;
                if (!isEdge && rng() < encounterChance && subTerrains && subTerrains.encounters) {
                    const encounterKey = subTerrains.encounters[Math.floor(rng() * subTerrains.encounters.length)];
                    if (config.encounters && config.encounters[encounterKey]) {
                        encounter = {
                            ...config.encounters[encounterKey],
                            key: encounterKey,
                            discovered: false
                        };
                    }
                }

                const passable = selectedTerrain.passable !== false;

                row.push({
                    q, r,
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
                    building: null  // may be set below for settlements
                });
            }
            tiles.push(row);
        }

        // --- Settlement building placement ---
        if (worldTile.settlement) {
            this._placeBuildings(tiles, worldTile.settlement, rng);
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
        // Extra structures that can appear in any settlement
        common: [
            'buildings/well00.png', 'buildings/well01.png',
            'buildings/barn00.png', 'buildings/barnWood00.png',
            'buildings/tent00.png',
            'buildings/sign00.png', 'buildings/sign01.png'
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
            case 'capital': buildingCount = Math.min(20, 8 + Math.floor(pop / 200)); break;
            case 'town':    buildingCount = Math.min(14, 5 + Math.floor(pop / 150)); break;
            default:        buildingCount = Math.min(9,  3 + Math.floor(pop / 100)); break;
        }

        const sprites = this.BUILDING_SPRITES[type] || this.BUILDING_SPRITES.village;
        const commonSprites = this.BUILDING_SPRITES.common;

        // Collect candidate tiles: passable, non-edge, no encounter
        const centerQ = Math.floor(this.width / 2);
        const centerR = Math.floor(this.height / 2);
        const candidates = [];
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                const t = tiles[r][q];
                const isEdge = q === 0 || q === this.width - 1 || r === 0 || r === this.height - 1;
                if (isEdge) continue;
                if (!t.subTerrain.passable) continue;
                if (t.encounter) continue;
                // Prefer tiles near center (village nucleus)
                const dist = Math.abs(q - centerQ) + Math.abs(r - centerR);
                candidates.push({ q, r, dist });
            }
        }

        // Sort by distance to center, with slight random jitter
        candidates.sort((a, b) => (a.dist + rng() * 1.5) - (b.dist + rng() * 1.5));

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

        let placed = 1;
        for (const c of candidates) {
            if (placed >= buildingCount) break;
            if (c.q === centerQ && c.r === centerR) continue;
            const tile = tiles[c.r][c.q];
            // Mix main sprites with common ones
            const pool = rng() < 0.25 ? commonSprites : sprites;
            tile.building = pool[Math.floor(rng() * pool.length)];
            placed++;
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

        // Generate/retrieve inner map
        this.tiles = this.getOrGenerate(worldTile, worldQ, worldR);
        this.currentWorldTile = { q: worldQ, r: worldR };
        this.active = true;

        // Place player in center
        this.playerInnerQ = Math.floor(this.width / 2);
        this.playerInnerR = Math.floor(this.height / 2);

        // Make sure center and surroundings are explored
        this._revealAround(this.tiles, this.playerInnerQ, this.playerInnerR, 2);

        return true;
    },

    /**
     * Exit the inner map back to the world map
     * @param {Object} game - The game instance
     */
    exit(game) {
        this.active = false;
        this.currentWorldTile = null;
        // Tiles remain cached for re-entry
    },

    /**
     * Move player within the inner map
     * @returns {{ moved: boolean, encounter: Object|null }}
     */
    movePlayer(dq, dr) {
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
     * Move player to a specific inner map tile (click-to-move)
     * Uses simple pathfinding
     * @returns {{ moved: boolean, encounter: Object|null }}
     */
    movePlayerTo(targetQ, targetR) {
        if (targetQ < 0 || targetQ >= this.width || targetR < 0 || targetR >= this.height) {
            return { moved: false, encounter: null, outOfBounds: true };
        }

        const tile = this.tiles[targetR][targetQ];
        if (!tile.subTerrain.passable) {
            return { moved: false, encounter: null, outOfBounds: false };
        }

        // Simple A* pathfinding within the inner map
        const path = this._findPath(this.playerInnerQ, this.playerInnerR, targetQ, targetR);
        if (!path || path.length <= 1) {
            return { moved: false, encounter: null, outOfBounds: false };
        }

        // Move along path (step-by-step, collecting encounters)
        let lastEncounter = null;
        for (let i = 1; i < path.length; i++) {
            const step = path[i];
            this.playerInnerQ = step.q;
            this.playerInnerR = step.r;
            this._revealAround(this.tiles, step.q, step.r, 2);

            const stepTile = this.tiles[step.r][step.q];
            if (stepTile.encounter && !stepTile.encounter.discovered) {
                stepTile.encounter.discovered = true;
                lastEncounter = stepTile.encounter;
            }
        }

        return { moved: true, encounter: lastEncounter, outOfBounds: false };
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

            // Get neighbors using offset hex coords (same as world map)
            const neighbors = Hex.neighbors(current.q, current.r);
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
        }
    },

    /**
     * Clear all cached inner maps
     */
    clearCache() {
        this._cache = {};
        this._discoveredEncounters = {};
    }
};

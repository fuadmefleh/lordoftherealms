// InnerMap — buildings members (split from the original monolith).
import { InnerMap } from './_ref.js';
import { Utils, Hex, CustomObjects, CustomBuildings, CustomInteriors, generateSpriteInterior, SettlementGenerator, DataLoader, Terrain, NpcFamily } from './_imports.js';

Object.assign(InnerMap, {
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

        // How many editor buildings to attempt per settlement type.
        const maxToPlace = (type === 'capital' ? 14 : type === 'city' ? 10 : type === 'town' ? 7 : 5);

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

            // Mark the remaining footprint tiles as "part of building" and block them
            for (let dr = bounds.minRow; dr <= bounds.maxRow; dr++) {
                for (let dq = bounds.minCol; dq <= bounds.maxCol; dq++) {
                    if (dr === 0 && dq === 0) continue;
                    tiles[ar + dr][aq + dq].customBuildingPart = { anchorQ: aq, anchorR: ar };
                    tiles[ar + dr][aq + dq].subTerrain.passable = false;
                }
            }
            // Also block the anchor tile itself
            tiles[ar][aq].subTerrain.passable = false;

            // Apply impassable / door meta from the building editor
            for (const m of (def.meta || [])) {
                const fr = ar + m.r, fq = aq + m.q;
                if (fr >= 0 && fr < H && fq >= 0 && fq < W) {
                    if (m.impassable) tiles[fr][fq].subTerrain.passable = false;
                    if (m.door) {
                        // Tag this tile as a door so the player auto-enters on step
                        tiles[fr][fq]._doorMarker = { anchorQ: aq, anchorR: ar, defId: def.id };
                        // Ensure door tiles are passable so the player can walk onto them
                        tiles[fr][fq].subTerrain.passable = true;
                    }
                }
            }

            placed++;
            } // end placement block
        } // end while

        if (placed > 0)
            console.log(`[CustomBuildings] placed ${placed} custom building(s) in ${type}`);
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
        return { width: this.INNER_MAP_SIZE, height: this.INNER_MAP_SIZE };
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
     * Assign NPC owners to settlement buildings.
     * Called after _spawnNPCs() so the NPC roster is available.
     * Adds ownerId, ownerName, ownerTitle to each building where possible.
     * Also marks the player's own house (from player.houses) as player-owned.
     */
    _assignBuildingOwners(player) {
        if (!this.buildings.length) return;

        // Map NPC types to the building types they typically own/work at
        const NPC_TO_BUILDINGS = {
            blacksmith_npc: ['blacksmith'],
            priest:         ['church', 'temple'],
            guard:          ['barracks', 'guard_tower'],
            merchant:       ['marketplace'],
            noble:          ['manor', 'town_hall'],
            farmer:         ['farm', 'granary'],
        };

        // Display titles for each building type
        const OWNER_TITLES = {
            blacksmith:  'Blacksmith',
            church:      'Priest',
            temple:      'High Priest',
            barracks:    'Commander',
            guard_tower: 'Guard Captain',
            marketplace: 'Merchant',
            manor:       'Lord',
            town_hall:   'Official',
            farm:        'Farmer',
            granary:     'Keeper',
            tavern:      'Innkeeper',
            house:       'Resident',
            stable:      'Stable Master',
            warehouse:   'Keeper',
            barn:        'Farmer',
        };

        const assignedNpcs = new Set();
        const assignedBldgs = new Set();

        // Match NPCs with known roles to their corresponding buildings
        for (const npc of this.npcs) {
            const targets = NPC_TO_BUILDINGS[npc.type];
            if (!targets) continue;
            for (const bType of targets) {
                const bldg = this.buildings.find(b => b.type === bType && !assignedBldgs.has(b));
                if (bldg) {
                    bldg.ownerId   = npc.id;
                    bldg.ownerName = npc.name;
                    bldg.ownerTitle = OWNER_TITLES[bType] || npc.type;
                    assignedBldgs.add(bldg);
                    assignedNpcs.add(npc.id);
                    break;
                }
            }
        }

        // Tavern: first unassigned villager/merchant/traveler NPC becomes innkeeper
        const tavernBldg = this.buildings.find(b => b.type === 'tavern' && !assignedBldgs.has(b));
        if (tavernBldg) {
            const keeper = this.npcs.find(n =>
                !assignedNpcs.has(n.id) && ['villager', 'merchant', 'traveler'].includes(n.type)
            ) || this.npcs.find(n => !assignedNpcs.has(n.id));
            if (keeper) {
                tavernBldg.ownerId   = keeper.id;
                tavernBldg.ownerName = keeper.name;
                tavernBldg.ownerTitle = 'Innkeeper';
                assignedBldgs.add(tavernBldg);
                assignedNpcs.add(keeper.id);
            }
        }

        // Stable: next available NPC
        const stableBldg = this.buildings.find(b => b.type === 'stable' && !assignedBldgs.has(b));
        if (stableBldg) {
            const master = this.npcs.find(n => !assignedNpcs.has(n.id));
            if (master) {
                stableBldg.ownerId   = master.id;
                stableBldg.ownerName = master.name;
                stableBldg.ownerTitle = 'Stable Master';
                assignedBldgs.add(stableBldg);
                assignedNpcs.add(master.id);
            }
        }

        // Houses: assign remaining villager/farmer NPCs as residents
        const houseBuildings = this.buildings.filter(b => b.type === 'house' && !assignedBldgs.has(b));
        const residentNpcs = this.npcs.filter(n =>
            !assignedNpcs.has(n.id) && ['villager', 'farmer', 'merchant'].includes(n.type)
        );
        for (let i = 0; i < houseBuildings.length && i < residentNpcs.length; i++) {
            houseBuildings[i].ownerId   = residentNpcs[i].id;
            houseBuildings[i].ownerName = residentNpcs[i].name;
            houseBuildings[i].ownerTitle = 'Resident';
            assignedBldgs.add(houseBuildings[i]);
            assignedNpcs.add(residentNpcs[i].id);
        }

        // Mark the player's own house in this settlement
        if (player) {
            const wq = this.currentWorldTile && this.currentWorldTile.q;
            const wr = this.currentWorldTile && this.currentWorldTile.r;
            if (wq != null) {
                const playerHouseHere = (player.houses || []).find(h => h.q === wq && h.r === wr);
                if (playerHouseHere) {
                    const myHouse = this.buildings.find(b => b.type === 'house' && !assignedBldgs.has(b))
                                 || this.buildings.find(b => b.type === 'house');
                    if (myHouse && !myHouse.isPlayerOwned) {
                        myHouse.isPlayerOwned = true;
                        myHouse.ownerId       = 'player';
                        myHouse.ownerName     = player.name || 'You';
                        myHouse.ownerTitle    = 'Owner';
                        myHouse.name          = myHouse.name + ' (Yours)';
                    }
                }
            }
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
});

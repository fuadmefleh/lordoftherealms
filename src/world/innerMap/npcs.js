// InnerMap — npcs members (split from the original monolith).
import { InnerMap } from './_ref.js';
import { Utils, Hex, CustomObjects, CustomBuildings, CustomInteriors, generateSpriteInterior, SettlementGenerator, DataLoader, Terrain, NpcFamily } from './_imports.js';

Object.assign(InnerMap, {
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
                if (this.tiles[r][q].building || this.tiles[r][q].customBuilding) {
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
            let customBuildingDef = null;

            // Honour placement-time type hint (e.g. farm tiles placed at outer ring)
            const tile = this.tiles[bt.r][bt.q];
            const customDefId = tile.customBuilding && tile.customBuilding.defId;
            if (customDefId && typeof CustomBuildings !== 'undefined' && typeof CustomBuildings.getBuilding === 'function') {
                customBuildingDef = CustomBuildings.getBuilding(customDefId);
                // Only use the custom def's buildingType if it's a specific role
                // (not the generic 'house' default), so settlement role assignment
                // (tavern, blacksmith, marketplace, etc.) can take precedence.
                if (customBuildingDef && customBuildingDef.buildingType &&
                    customBuildingDef.buildingType !== 'house') {
                    buildingType = customBuildingDef.buildingType;
                }
            }
            // Skip player property tiles — they are handled by _addPropertyBuildings()
            if (tile._buildingTypeHint === 'player_property') continue;
            if (!buildingType && tile._buildingTypeHint) {
                buildingType = tile._buildingTypeHint;
                // Remove from required/optional lists to avoid double-assignment
                const reqIdx = required.indexOf(buildingType);
                if (reqIdx !== -1) required.splice(reqIdx, 1);
                const optIdx = optional.indexOf(buildingType);
                if (optIdx !== -1) optional.splice(optIdx, 1);
            } else if (!buildingType && required.length > 0) {
                buildingType = required.shift();
            } else if (!buildingType && optional.length > 0) {
                buildingType = optional.shift();
            } else if (!buildingType) {
                buildingType = 'house'; // fallback
            }

            const def = this.BUILDING_TYPES[buildingType] || this.BUILDING_TYPES.house;

            const bldg = {
                q: bt.q,
                r: bt.r,
                type: buildingType,
                name: customBuildingDef && customBuildingDef.name ? customBuildingDef.name : def.name,
                icon: def.icon,
                sprite: bt.sprite,  // keep original sprite for visuals
                actions: [...def.actions],
            };

            if (customDefId) {
                bldg._customDefId = customDefId;
            }

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

        // Widen roads by 1 tile in cardinal directions for smoother appearance
        const extraRoads = [];
        for (const rd of this.roads) {
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dq, dr] of dirs) {
                const nq = rd.q + dq, nr = rd.r + dr;
                const key = `${nq},${nr}`;
                if (roadSet.has(key)) continue;
                if (nq < 0 || nq >= this.width || nr < 0 || nr >= this.height) continue;
                const tile = this.getTile(nq, nr);
                if (!tile || !tile.subTerrain.passable || tile.building) continue;
                roadSet.add(key);
                extraRoads.push({ q: nq, r: nr });
                tile.isRoad = true;
            }
        }
        for (const rd of extraRoads) this.roads.push(rd);
    },

    /**
     * Get the building at a specific tile, if any.
     * Checks legacy buildings (this.buildings array + footprint) AND
     * custom editor-authored buildings (tile.customBuilding / customBuildingPart).
     */
    getBuildingAt(q, r) {
        // 1) Check exact anchor tile in legacy buildings list
        const exact = this.buildings.find(b => b.q === q && b.r === r);
        if (exact) return exact;

        // 2) Check if (q,r) falls within any legacy building's visual footprint
        //    Buildings render 3 tiles wide (anchor q-1..q+1) and 3 tiles tall (anchor r-2..r).
        const footprint = this.buildings.find(b =>
            q >= b.q - 1 && q <= b.q + 1 &&
            r >= b.r - 2 && r <= b.r
        );
        if (footprint) return footprint;

        // 3) Check for custom editor-authored buildings (CustomBuildings system)
        const tile = this.getTile(q, r);
        if (!tile) return null;

        let anchorQ = q, anchorR = r;
        let customBuildingTile = tile;

        // If this tile is part of a custom building, follow the reference to the anchor
        if (tile.customBuildingPart) {
            anchorQ = tile.customBuildingPart.anchorQ;
            anchorR = tile.customBuildingPart.anchorR;
            customBuildingTile = this.getTile(anchorQ, anchorR);
        }

        if (customBuildingTile && customBuildingTile.customBuilding) {
            const defId = customBuildingTile.customBuilding.defId;
            // Get the definition from CustomBuildings if available
            let def = null;
            if (typeof CustomBuildings !== 'undefined' && CustomBuildings.isLoaded()) {
                def = CustomBuildings.getBuilding(defId);
            }
            const bType = (def && def.buildingType) || 'house';
            const bDef = this.BUILDING_TYPES[bType] || this.BUILDING_TYPES.house;
            return {
                q: anchorQ,
                r: anchorR,
                type: bType,
                name: (def && def.name) || bDef.name,
                icon: bDef.icon,
                sprite: null,
                actions: [...bDef.actions],
                _isCustomBuilding: true,
                _customDefId: defId,
            };
        }

        return null;
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

                // Character presets live in the UI layer (InnerMapCharacters), which
                // world code can't import — the renderer falls back by NPC type.
                const preset = null;

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
                    // Personal trade inventory (merchants, travelers, blacksmiths)
                    shopInventory: this._generateNpcShop(npcType, rng),
                });
            }
        }

        // Generate family trees and NPC-NPC relationships
        NpcFamily.setInnerMapRef(this);
        NpcFamily.generateFamilies(this.npcs, rng);
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

            // Skip update for NPCs frozen in dialog
            if (npc._dialogFrozen || npc.state === 'dialog') continue;

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
                                npc.idleTimer = 1 + Utils.random() * 3;
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

                                // Check if we arrived at a building we were targeting
                                const bldg = npc._targetBuilding || this.getBuildingAt(npc.q, npc.r);
                                if (bldg) {
                                    // NPC "enters" the building — hidden from outdoor map
                                    npc.state = 'inside_building';
                                    npc.currentBuilding = bldg.type;
                                    npc._insideBuildingQ = bldg.q;
                                    npc._insideBuildingR = bldg.r;
                                    npc._outsideQ = npc.q; // remember position for when they exit
                                    npc._outsideR = npc.r;
                                    npc.idleTimer = 8 + Utils.random() * 20; // stay inside 8-28 seconds
                                    npc._targetBuilding = null;
                                    // Traveler visited a place
                                    if (npc.visitsLeft > 0) npc.visitsLeft--;
                                } else {
                                    npc.state = 'idle';
                                    npc.idleTimer = 1 + Utils.random() * 4;
                                    npc._targetBuilding = null;
                                }
                            }
                        }
                    } else {
                        npc.state = 'idle';
                        npc.idleTimer = 1 + Utils.random() * 3;
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

                case 'inside_building':
                    // The player is in here too — go about their business on the furniture
                    if (this._insideBuilding) { this._updateInteriorNpc(npc, deltaTime); break; }
                    npc.idleTimer -= deltaTime;
                    if (npc.idleTimer <= 0) {
                        if (this._insideBuilding) {
                            // Player is viewing this interior — NPC "leaves" the building
                            // Remove from interior npcs array (they'll reappear outside
                            // when player exits, since outerMapState still has them)
                            npc.state = 'leaving_building';
                        } else {
                            // Normal outdoor map — NPC exits, reappear at outdoor position
                            npc.currentBuilding = null;
                            npc._insideBuildingQ = undefined;
                            npc._insideBuildingR = undefined;
                            if (npc._outsideQ != null) {
                                npc.q = npc._outsideQ;
                                npc.r = npc._outsideR;
                                npc.prevQ = npc.q;
                                npc.prevR = npc.r;
                            }
                            npc._outsideQ = undefined;
                            npc._outsideR = undefined;
                            npc.state = 'idle';
                            npc.idleTimer = 1 + Utils.random() * 3;
                        }
                    }
                    break;
            }
        }

        // Remove departed travelers and NPCs that left the building interior
        if (this._insideBuilding) {
            // When inside a building, NPCs that "leave" should be marked as
            // exited in the outer map state so they reappear outside
            for (const npc of this.npcs) {
                if (npc.state === 'leaving_building' && this._outerMapState) {
                    const outerNpc = this._outerMapState.npcs.find(n => n.id === npc.id);
                    if (outerNpc) {
                        outerNpc.state = 'idle';
                        outerNpc.idleTimer = 1 + Utils.random() * 3;
                        outerNpc.currentBuilding = null;
                        if (outerNpc._outsideQ != null) {
                            outerNpc.q = outerNpc._outsideQ;
                            outerNpc.r = outerNpc._outsideR;
                            outerNpc.prevQ = outerNpc.q;
                            outerNpc.prevR = outerNpc.r;
                        }
                        outerNpc._outsideQ = undefined;
                        outerNpc._outsideR = undefined;
                        outerNpc._insideBuildingQ = undefined;
                        outerNpc._insideBuildingR = undefined;
                    }
                }
            }
            this.npcs = this.npcs.filter(n => n.state !== 'leaving_building' && n.state !== 'gone');
        } else {
            this.npcs = this.npcs.filter(n => n.state !== 'gone');
        }
    },

    /**
     * Find the nearest passable edge tile from a given position
     */
    _findNearestEdgeTile(fromQ, fromR) {
        let best = null;
        let bestDist = Infinity;
        const W = this.width, H = this.height;
        // Only scan actual edge tiles (borders of the map) instead of the entire grid
        for (let q = 0; q < W; q++) {
            // Top edge (r=0)
            if (this.tiles[0] && this.tiles[0][q] && this.tiles[0][q].subTerrain.passable) {
                const dist = Math.abs(q - fromQ) + fromR;
                if (dist < bestDist) { bestDist = dist; best = { q, r: 0 }; }
            }
            // Bottom edge (r=H-1)
            if (this.tiles[H - 1] && this.tiles[H - 1][q] && this.tiles[H - 1][q].subTerrain.passable) {
                const dist = Math.abs(q - fromQ) + Math.abs(H - 1 - fromR);
                if (dist < bestDist) { bestDist = dist; best = { q, r: H - 1 }; }
            }
        }
        for (let r = 1; r < H - 1; r++) {
            // Left edge (q=0)
            if (this.tiles[r] && this.tiles[r][0] && this.tiles[r][0].subTerrain.passable) {
                const dist = fromQ + Math.abs(r - fromR);
                if (dist < bestDist) { bestDist = dist; best = { q: 0, r }; }
            }
            // Right edge (q=W-1)
            if (this.tiles[r] && this.tiles[r][W - 1] && this.tiles[r][W - 1].subTerrain.passable) {
                const dist = Math.abs(W - 1 - fromQ) + Math.abs(r - fromR);
                if (dist < bestDist) { bestDist = dist; best = { q: W - 1, r }; }
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
        let targetBuilding = null;
        if (candidates.length > 0) {
            const bldg = candidates[Math.floor(Utils.random() * candidates.length)];
            // Path to a passable tile adjacent to the building (anchor may be impassable)
            const adj = this._findPassableAdjacentTile(bldg.q, bldg.r);
            target = adj;
            targetBuilding = bldg;
        } else {
            // Random passable tile
            let attempts = 0;
            do {
                const rq = Math.floor(Utils.random() * this.width);
                const rr = Math.floor(Utils.random() * this.height);
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
                npc._targetBuilding = targetBuilding; // remember the building we're headed to
                return;
            }
        }

        // Couldn't find a path, just idle again
        npc.state = 'idle';
        npc.idleTimer = 2 + Utils.random() * 5;
    },

    /**
     * Get NPC at a specific tile position
     */
    getNPCsAt(q, r) {
        return this.npcs.filter(n => n.q === q && n.r === r);
    },
});

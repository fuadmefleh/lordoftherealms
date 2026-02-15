// ============================================
// WORLD — World state management
// ============================================

class World {
    constructor(width = 70, height = 45) {
        this.width = width;
        this.height = height;
        this.tiles = [];
        this.kingdoms = [];
        this.day = 1;
        this.season = 'Spring';
        this.baseYear = 853;
        this.year = this.baseYear;
        this.history = [];
        this.events = [];
        this.units = [];
        this.weather = new WeatherSystem(this);
    }

    /**
     * Generate the entire world
     */
    generate(terrainParams = {}) {
        console.log('Generating terrain...');
        // Generate terrain
        this.tiles = Terrain.generateMap(this.width, this.height, terrainParams);
        console.log('Terrain generated');

        console.log('Creating kingdoms...');
        // Create kingdoms
        this.kingdoms = Kingdom.DEFAULTS.map(def => Kingdom.create(def));

        console.log('Placing kingdoms on map...');
        // Place kingdoms on map
        Kingdom.placeKingdoms(this.kingdoms, this.tiles, this.width, this.height);
        console.log('Kingdoms placed');

        // Initialize diplomatic relations
        Kingdom.initRelations(this.kingdoms);

        console.log('Initializing NPC lords...');
        // Initialize lords for all kingdoms
        NPCLords.initializeLords(this);

        console.log('Placing independent settlements...');
        // Scatter some independent settlements
        this.placeIndependentSettlements();

        console.log('Placing points of interest...');
        // Place some villages as points of interest
        this.placePointsOfInterest();

        console.log('Generating world history...');
        this.history = WorldEvents.generateHistory(this);

        console.log(`World generated: ${this.width}x${this.height}, ${this.kingdoms.length} kingdoms`);
    }

    /**
     * Place independent (unaligned) settlements
     */
    placeIndependentSettlements() {
        const numSettlements = Utils.randInt(8, 15);
        const existingSettlements = this.getAllSettlements();
        const minDistance = 4; // Minimum distance between settlements

        for (let i = 0; i < numSettlements; i++) {
            let attempts = 0;
            while (attempts < 200) {
                attempts++;
                const q = Utils.randInt(0, this.width - 1);
                const r = Utils.randInt(Math.floor(this.height * 0.1), Math.floor(this.height * 0.9));
                const tile = this.tiles[r][q];

                if (!tile.terrain.passable || tile.settlement || tile.kingdom) continue;

                // Coastal preference: higher chance if next to ocean
                const isCoastal = Hex.neighbors(q, r).some(n => {
                    const nt = this.getTile(n.q, n.r);
                    return nt && (nt.terrain.id === 'ocean' || nt.terrain.id === 'deep_ocean');
                });

                if (!isCoastal && Math.random() < 0.75) continue;

                // Check distance to all other settlements
                let tooClose = false;
                for (const settlement of existingSettlements) {
                    if (Hex.wrappingDistance(q, r, settlement.q, settlement.r, this.width) < minDistance) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;

                const newSettlement = {
                    type: 'village',
                    name: Kingdom.generateCityName(Utils.randPick(['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime'])),
                    population: Utils.randInt(50, 500),
                    level: 0,
                    kingdom: null,
                    founded: Utils.randInt(500, 800),
                };

                tile.settlement = newSettlement;
                existingSettlements.push({ q, r, ...newSettlement });
                break;
            }
        }
    }

    /**
     * Place points of interest (ruins, shrines, etc.)
     */
    placePointsOfInterest() {
        const poiTypes = [
            { type: 'ruins', icon: '🏚️', name: 'Ancient Ruins' },
            { type: 'shrine', icon: '⛩️', name: 'Roadside Shrine' },
            { type: 'cave', icon: '🕳️', name: 'Mysterious Cave' },
            { type: 'oasis', icon: '🌴', name: 'Desert Oasis' },
            { type: 'monument', icon: '🗿', name: 'Stone Monument' },
        ];

        const numPOI = Utils.randInt(10, 20);
        const existingSettlements = this.getAllSettlements();
        // Also track existing POIs
        const existingPOIs = [];

        for (let i = 0; i < numPOI; i++) {
            let attempts = 0;
            while (attempts < 200) {
                attempts++;
                const q = Utils.randInt(0, this.width - 1);
                const r = Utils.randInt(2, this.height - 3);
                const tile = this.tiles[r][q];

                if (!tile.terrain.passable || tile.settlement || tile.improvement) continue;

                // Check distance to settlements (don't want ruins right next to a city)
                let tooClose = false;
                for (const s of existingSettlements) {
                    if (Hex.wrappingDistance(q, r, s.q, s.r, this.width) < 2) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) { continue; }

                // Check distance to other POIs
                for (const p of existingPOIs) {
                    if (Hex.wrappingDistance(q, r, p.q, p.r, this.width) < 4) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) { continue; }

                const poi = Utils.randPick(poiTypes);
                tile.improvement = {
                    type: poi.type,
                    icon: poi.icon,
                    name: poi.name,
                    explored: false,
                    founded: Utils.randInt(100, 600),
                };
                existingPOIs.push({ q, r });
                break;
            }
        }
    }

    /**
     * Get tile at wrapped coordinates
     */
    getTile(q, r) {
        if (r < 0 || r >= this.height) return null;
        const wq = Hex.wrapQ(q, this.width);
        return this.tiles[r][wq];
    }

    /**
     * Get kingdom by ID
     */
    getKingdom(id) {
        return this.kingdoms.find(k => k.id === id);
    }

    /**
     * Advance one day
     */
    advanceDay() {
        this.day++;

        // Season tracking (30 days per season)
        const seasonNum = Math.floor(((this.day - 1) % 120) / 30);
        const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
        this.season = seasons[seasonNum];
        this.year = this.baseYear + Math.floor((this.day - 1) / 120);

        // Clear previous events
        this.events = [];

        // Process NPC lord actions
        for (const kingdom of this.kingdoms) {
            if (kingdom.isAlive && kingdom.lord) {
                NPCLords.processLordActions(kingdom, this);
            }
        }

        // Process kingdom AI turns
        for (const kingdom of this.kingdoms) {
            if (kingdom.isAlive) {
                KingdomAI.processTurn(kingdom, this);
            }
        }

        // Process wars
        KingdomAI.processWars(this);

        // Generate world events
        const worldEvents = WorldEvents.generateEvents(this);
        this.events.push(...worldEvents);

        // Process units
        this.processUnits();

        return {
            day: this.day,
            season: this.season,
            year: this.year,
            events: this.events,
        };
    }

    /**
     * Process all world units
     */
    processUnits() {
        if (!this.units) this.units = [];

        // Move units
        for (let i = this.units.length - 1; i >= 0; i--) {
            const unit = this.units[i];
            unit.update(this);
            if (unit.destroyed) {
                this.units.splice(i, 1);
            }
        }

        // Spawn new units if needed
        this.spawnUnits();
    }

    /**
     * Spawn dynamic units
     */
    spawnUnits() {
        const settlements = this.getAllSettlements();
        if (settlements.length < 2) return;

        // Spawn caravan
        if (this.units.filter(u => u.type === 'caravan').length < settlements.length) {
            if (Math.random() < 0.4) {
                const s1 = Utils.randPick(settlements);
                const t1 = this.getTile(s1.q, s1.r);
                if (t1) {
                    const reachable = settlements.filter(s => {
                        if (s.name === s1.name) return false;
                        const t2 = this.getTile(s.q, s.r);
                        return t2 && t2.regionId === t1.regionId;
                    });

                    if (reachable.length > 0) {
                        const s2 = Utils.randPick(reachable);
                        const caravan = new WorldUnit('caravan', s1.q, s1.r, s2.q, s2.r);
                        this.units.push(caravan);
                    }
                }
            }
        }

        // Spawn ship
        const coastalSettlements = settlements.filter(s => {
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = this.getTile(n.q, n.r);
                return nt && (nt.terrain.id === 'ocean' || nt.terrain.id === 'deep_ocean');
            });
        });
        if (coastalSettlements.length >= 2 && this.units.filter(u => u.type === 'ship').length < coastalSettlements.length * 2) {
            if (Math.random() < 0.4) {
                const s1 = Utils.randPick(coastalSettlements);

                // Find water region for ship
                let waterRegionId = null;
                const neighbors1 = Hex.neighbors(s1.q, s1.r);
                for (const n of neighbors1) {
                    const nt = this.getTile(n.q, n.r);
                    if (nt && !nt.terrain.passable) {
                        waterRegionId = nt.regionId;
                        break;
                    }
                }

                if (waterRegionId !== null) {
                    const reachable = coastalSettlements.filter(s => {
                        if (s.name === s1.name) return false;
                        const neighbors2 = Hex.neighbors(s.q, s.r);
                        return neighbors2.some(n => {
                            const nt = this.getTile(n.q, n.r);
                            return nt && nt.regionId === waterRegionId;
                        });
                    });

                    if (reachable.length > 0) {
                        const s2 = Utils.randPick(reachable);
                        const ship = new WorldUnit('ship', s1.q, s1.r, s2.q, s2.r);
                        this.units.push(ship);
                    }
                }
            }
        }

        // Spawn raider
        if (this.units.filter(u => u.type === 'raider').length < 8) {
            // Only spawn raiders if zoomed in enough to see them, or if camera is not defined (e.g., headless mode)
            if (!this.camera || this.camera.zoom > 0.4) {
                if (Math.random() < 0.2) {
                    const q = Utils.randInt(0, this.width - 1);
                    const r = Utils.randInt(0, this.height - 1);
                    if (this.isPassable(q, r)) {
                        this.units.push(new WorldUnit('raider', q, r));
                    }
                }
            }
        }

        // Spawn pirate
        if (this.units.filter(u => u.type === 'pirate').length < 6) {
            if (Math.random() < 0.1) {
                const q = Utils.randInt(0, this.width - 1);
                const r = Utils.randInt(0, this.height - 1);
                const tile = this.getTile(q, r);
                if (tile && (tile.terrain.id === 'ocean' || tile.terrain.id === 'deep_ocean')) {
                    this.units.push(new WorldUnit('pirate', q, r));
                }
            }
        }

        // Spawn patrol
        if (this.units.filter(u => u.type === 'patrol').length < 4) {
            if (Math.random() < 0.05) {
                const capital = settlements.find(s => s.type === 'capital');
                if (capital) {
                    this.units.push(new WorldUnit('patrol', capital.q, capital.r));
                }
            }
        }

        // Spawn settler
        if (this.day % 20 === 0 && Math.random() < 0.1 && this.units.filter(u => u.type === 'settler').length < 2) {
            const s = Utils.randPick(settlements);
            this.units.push(new WorldUnit('settler', s.q, s.r));
        }
    }

    /**
     * Generate random world events
     */
    generateEvents() {
        this.events = [];

        // Small chance of various events
        if (Math.random() < 0.05) {
            const k1 = Utils.randPick(this.kingdoms.filter(k => k.isAlive));
            const k2 = Utils.randPick(this.kingdoms.filter(k => k.isAlive && k.id !== k1.id));
            if (k1 && k2) {
                const eventTypes = [
                    { text: `Tensions rise between ${k1.name} and ${k2.name} `, type: 'diplomatic' },
                    { text: `A trade agreement is signed between ${k1.name} and ${k2.name} `, type: 'trade' },
                    { text: `Border skirmish reported between ${k1.name} and ${k2.name} `, type: 'military' },
                ];
                this.events.push(Utils.randPick(eventTypes));
            }
        }

        if (Math.random() < 0.03) {
            this.events.push({
                text: `Traveling merchants report a bountiful harvest in the ${this.season} `,
                type: 'economic'
            });
        }
    }

    /**
     * Check if a tile is passable for movement
     */
    isPassable(q, r) {
        const tile = this.getTile(q, r);
        if (!tile) return false;
        return tile.terrain.passable;
    }

    /**
     * Get all settlements in the world
     */
    getAllSettlements() {
        const settlements = [];
        for (let r = 0; r < this.height; r++) {
            for (let q = 0; q < this.width; q++) {
                if (this.tiles[r][q].settlement) {
                    settlements.push({
                        q, r,
                        ...this.tiles[r][q].settlement
                    });
                }
            }
        }
        return settlements;
    }
}

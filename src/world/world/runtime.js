// World — runtime methods.
import { World } from './core.js';
import { Terrain, Kingdom, WeatherSystem, NPCLords, Hex, Utils, WorldEvents, WorldUnit, Characters, Religion, Culture, Peoples, Colonization, Cartography, KingdomAI } from './_imports.js';

Object.assign(World.prototype, {
    /**
     * Get tile at wrapped coordinates
     */
    getTile(q, r) {
        if (r < 0 || r >= this.height) return null;
        const wq = Hex.wrapQ(q, this.width);
        return this.tiles[r][wq];
    },

    /**
     * Get kingdom by ID
     */
    getKingdom(id) {
        return this.kingdoms.find(k => k.id === id);
    },

    /**
     * Advance one day
     */
    /**
     * @param {Object} [player]
     * @param {Object} [opts] - { playerBonuses: { colonyGrowth, colonyLoyalty } }
     *   computed by the caller from the player's techs (world code can't
     *   import the tech system)
     */
    advanceDay(player = null, opts = {}) {
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

        // Process character system (dynasties, advisors, succession, marriages)
        if (typeof Characters !== 'undefined') {
            Characters.processTurn(this);
        }

        // Process wars
        KingdomAI.processWars(this);

        // Generate world events
        const worldEvents = WorldEvents.generateEvents(this);
        this.events.push(...worldEvents);

        // Timed events (droughts, plagues, gold rushes, ...)
        const timed = WorldEvents.processTimedEvents(this);
        for (const ev of timed.started) {
            this.events.push({ text: `${ev.icon} ${ev.text} (${ev.daysLeft} days)`, type: 'timed', timedEvent: ev });
        }
        for (const ev of timed.ended) {
            this.events.push({ text: `${ev.icon} ${ev.name} in ${ev.regionName} has passed.`, type: 'timed' });
        }

        // Process world religion (pilgrim income, heresies, holy site contestation)
        if (typeof Religion !== 'undefined') {
            Religion.processTurn(this);
        }

        // Process cultural events & influence
        if (typeof Culture !== 'undefined') {
            Culture.processTurn(this);
        }

        // Process multicultural peoples dynamics
        if (typeof Peoples !== 'undefined') {
            Peoples.processTurn(this);
        }

        // Process colonization (colony loyalty, indigenous, AI expansion)
        if (typeof Colonization !== 'undefined') {
            Colonization.processTurn(this, opts.playerBonuses || {});
        }

        // Process cartography (propaganda maps, kingdom cartography)
        if (typeof Cartography !== 'undefined') {
            Cartography.processTurn(this);
        }

        // Replenish market stock — settlements gradually restock goods
        const allSettlements = this.getAllSettlements();
        for (const s of allSettlements) {
            const tile = this.getTile(s.q, s.r);
            if (!tile || !tile.settlement || !tile.settlement.marketStock) continue;
            const stock = tile.settlement.marketStock;
            for (const goodId in stock) {
                if (stock[goodId] > 0) {
                    // Replenish ~10% per day (full restock in ~10 days)
                    const replenish = Math.max(1, Math.ceil(stock[goodId] * 0.1));
                    stock[goodId] = Math.max(0, stock[goodId] - replenish);
                }
            }
        }

        // Process units (player injected so raiders can target them without a global)
        this.processUnits(player);

        return {
            day: this.day,
            season: this.season,
            year: this.year,
            events: this.events,
        };
    },

    /**
     * Spawn a healthy population of units at game start so the world feels alive
     */
    spawnInitialUnits() {
        const settlements = this.getAllSettlements();
        if (settlements.length < 2) return;

        // --- Caravans: one per settlement pair ---
        const caravanCount = Math.min(settlements.length, 12);
        for (let i = 0; i < caravanCount; i++) {
            const s1 = settlements[i % settlements.length];
            const t1 = this.getTile(s1.q, s1.r);
            if (!t1) continue;
            const reachable = settlements.filter(s => {
                if (s.q === s1.q && s.r === s1.r) return false;
                const t2 = this.getTile(s.q, s.r);
                return t2 && t2.regionId === t1.regionId;
            });
            if (reachable.length > 0) {
                const s2 = Utils.randPick(reachable);
                this.units.push(new WorldUnit('caravan', s1.q, s1.r, s2.q, s2.r));
            }
        }

        // --- Ships: from coastal settlements ---
        const coastalSettlements = settlements.filter(s => {
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = this.getTile(n.q, n.r);
                return nt && (nt.terrain.id === 'ocean' || nt.terrain.id === 'deep_ocean' || nt.terrain.id === 'sea');
            });
        });
        const shipCount = Math.min(coastalSettlements.length * 2, 10);
        for (let i = 0; i < shipCount; i++) {
            const s1 = coastalSettlements[i % coastalSettlements.length];
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
                    if (s.q === s1.q && s.r === s1.r) return false;
                    return Hex.neighbors(s.q, s.r).some(n => {
                        const nt = this.getTile(n.q, n.r);
                        return nt && nt.regionId === waterRegionId;
                    });
                });
                if (reachable.length > 0) {
                    const s2 = Utils.randPick(reachable);
                    this.units.push(new WorldUnit('ship', s1.q, s1.r, s2.q, s2.r));
                }
            }
        }

        // --- Raiders: scattered on land ---
        for (let i = 0; i < 8; i++) {
            let attempts = 0;
            while (attempts < 50) {
                attempts++;
                const q = Utils.randInt(0, this.width - 1);
                const r = Utils.randInt(0, this.height - 1);
                if (this.isPassable(q, r)) {
                    this.units.push(new WorldUnit('raider', q, r));
                    break;
                }
            }
        }

        // --- Pirates: on ocean tiles ---
        for (let i = 0; i < 5; i++) {
            let attempts = 0;
            while (attempts < 50) {
                attempts++;
                const q = Utils.randInt(0, this.width - 1);
                const r = Utils.randInt(0, this.height - 1);
                const tile = this.getTile(q, r);
                if (tile && (tile.terrain.id === 'ocean' || tile.terrain.id === 'deep_ocean')) {
                    this.units.push(new WorldUnit('pirate', q, r));
                    break;
                }
            }
        }

        // --- Patrols: from kingdom capitals ---
        for (const kingdom of this.kingdoms) {
            if (!kingdom.isAlive) continue;
            const capital = settlements.find(s => s.kingdom === kingdom.id && s.type === 'capital');
            if (capital) {
                // 2 patrols per kingdom
                this.units.push(new WorldUnit('patrol', capital.q, capital.r));
                this.units.push(new WorldUnit('patrol', capital.q, capital.r));
            }
        }

        // --- Lord Parties: one per kingdom, starting at capital ---
        for (const kingdom of this.kingdoms) {
            if (!kingdom.isAlive || !kingdom.lord) continue;
            const capital = settlements.find(s => s.kingdom === kingdom.id && s.type === 'capital');
            if (capital) {
                const lordUnit = new WorldUnit('lord_party', capital.q, capital.r);
                lordUnit.kingdomId = kingdom.id;
                lordUnit.lordName = kingdom.lord.name;
                lordUnit.name = `${kingdom.lord.name}'s Procession`;
                this.units.push(lordUnit);
            }
        }

        // --- Settlers: a couple already on the move ---
        for (let i = 0; i < 2; i++) {
            const s = Utils.randPick(settlements);
            if (s) {
                this.units.push(new WorldUnit('settler', s.q, s.r));
            }
        }

        // Advance all units a few steps so they're mid-journey, not all clustered at settlements
        for (let step = 0; step < 5; step++) {
            for (const unit of this.units) {
                unit.update(this);
            }
            // Remove destroyed ones
            this.units = this.units.filter(u => !u.destroyed);
        }

        console.log(`Spawned ${this.units.length} initial world units`);
    },

    /**
     * Process all world units
     */
    processUnits(player = null) {
        if (!this.units) this.units = [];

        // Move units
        for (let i = this.units.length - 1; i >= 0; i--) {
            const unit = this.units[i];
            unit.update(this, player);
            if (unit.destroyed) {
                this.units.splice(i, 1);
            }
        }

        // Spawn new units if needed
        this.spawnUnits();
    },

    /**
     * Spawn dynamic units
     */
    spawnUnits() {
        const settlements = this.getAllSettlements();
        if (settlements.length < 2) return;

        // Spawn caravan
        if (this.units.filter(u => u.type === 'caravan').length < settlements.length) {
            if (Utils.random() < 0.4) {
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
            if (Utils.random() < 0.4) {
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
                // Bandit uprisings and the like raise the spawn rate
                if (Utils.random() < 0.2 * (1 + WorldEvents.getModifier(this, 'raiderSpawnRate'))) {
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
            if (Utils.random() < 0.1 * (1 + WorldEvents.getModifier(this, 'pirateSpawnRate'))) {
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
            if (Utils.random() < 0.05) {
                const capital = settlements.find(s => s.type === 'capital');
                if (capital) {
                    this.units.push(new WorldUnit('patrol', capital.q, capital.r));
                }
            }
        }

        // Spawn settler
        if (this.day % 20 === 0 && Utils.random() < 0.1 && this.units.filter(u => u.type === 'settler').length < 2) {
            const s = Utils.randPick(settlements);
            this.units.push(new WorldUnit('settler', s.q, s.r));
        }

        // Spawn lord parties for kingdoms that don't have one
        for (const kingdom of this.kingdoms) {
            if (!kingdom.isAlive || !kingdom.lord) continue;
            const hasLordParty = this.units.some(u => u.type === 'lord_party' && u.kingdomId === kingdom.id && !u.destroyed);
            if (!hasLordParty) {
                const capital = settlements.find(s => s.kingdom === kingdom.id && s.type === 'capital');
                if (capital) {
                    const lordUnit = new WorldUnit('lord_party', capital.q, capital.r);
                    lordUnit.kingdomId = kingdom.id;
                    lordUnit.lordName = kingdom.lord.name;
                    lordUnit.name = `${kingdom.lord.name}'s Procession`;
                    this.units.push(lordUnit);
                }
            }
        }
    },

    /**
     * Generate random world events
     */
    generateEvents() {
        this.events = [];

        // Small chance of various events
        if (Utils.random() < 0.05) {
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

        if (Utils.random() < 0.03) {
            this.events.push({
                text: `Traveling merchants report a bountiful harvest in the ${this.season} `,
                type: 'economic'
            });
        }
    },

    /**
     * Check if a tile is passable for movement
     */
    isPassable(q, r) {
        const tile = this.getTile(q, r);
        if (!tile) return false;
        return tile.terrain.passable;
    },

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
    },
});

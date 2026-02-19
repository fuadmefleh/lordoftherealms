// ============================================
// PLAYER — Player state and actions
// ============================================

class Player {
    constructor(profile = {}) {
        this.q = 0;
        this.r = 0;
        this.firstName = profile.firstName || 'Wanderer';
        this.lastName = profile.lastName || '';
        this.name = this.lastName ? `${this.firstName} ${this.lastName}` : this.firstName;
        this.gender = profile.gender || 'male';
        this.age = profile.age || 20;
        this.title = 'Nobody';

        // Core stats
        this.gold = 10000;
        this.karma = 0;
        this.renown = 0;
        this.health = 100;
        this.maxHealth = 100;
        this.stamina = 10; // Movement points per day
        this.maxStamina = 10;

        // Action Points
        this.actionPoints = 10;
        this.maxActionPoints = 10;

        // Attributes
        this.strength = 5;
        this.charisma = 5;
        this.intelligence = 5;
        this.faith = 5;
        this.luck = 5;

        // Skills
        this.skills = {
            commerce: 1,
            combat: 1,
            leadership: 1,
            diplomacy: 1,
            stealth: 1,
            cartography: 0,
        };

        // Movement
        this.path = null;           // Current path being followed
        this.pathIndex = 0;
        this.movementRemaining = this.stamina;
        this.isMoving = false;
        this.moveAnimProgress = 0;
        this.prevQ = 0;
        this.prevR = 0;
        this.queuedPath = null;     // Remaining path for multi-day travel
        this.queuedPathIndex = 0;
        this.travelDestination = null; // {q, r} final destination for multi-day travel

        // Inventory
        this.inventory = { bread: 20 };
        this.maxInventory = 20;

        // Maps collection (cartography system)
        this.maps = [];
        this.artifacts = {
            fragments: {},
            forged: [],
            discovered: [],
        };
        this.activeBounties = [];
        this.bountiesCompleted = 0;
        this.bountyHunter = {
            rank: 1,
            capturesTurnedIn: 0,
            capturesRecruited: 0,
            failedCaptures: 0,
            nextTargetId: 1,
            boardRefreshDay: 0,
            boardSettlementKey: '',
            boardOffers: [],
        };
        this.festivals = {
            hosted: 0,
            successfulContests: 0,
            diplomacyEvents: 0,
            sabotageEvents: 0,
            moraleBoostDays: 0,
            moraleBoostValue: 0,
            lastHostedDay: -999,
            history: [],
        };

        // Economic path
        this.properties = [];       // Farms, mines, workshops
        this.caravans = [];         // Active trade caravans
        this.tradeRoutes = [];      // Persistent legal trade routes
        this.smugglingRoutes = [];  // Persistent black-market routes
        this.auctions = {           // Auction market state
            active: [],
            won: [],
            nextRefreshDay: 1,
            nextId: 1,
            lastProcessedDay: 0,
        };
        this.landTaxBonus = 0;      // Passive bonus from auctioned land rights
        this.activeContract = null; // Mercenary contract
        this.loans = {};            // Loans per kingdom: { kingdomId: [loan1, loan2] }

        // Military path
        this.army = [];             // Recruited units
        this.mercenaryCompanies = [];// Hired temporary mercenary bands

        // Housing
        this.houses = [];           // Owned houses: [{ q, r, typeId, upgrades, condition, ... }]
        this.ships = [];            // Owned ships: [{ id, typeId, name, ... }]
        this.boardedShip = null;    // Currently boarded ship ID (null when on land)

        // Religious path
        this.religion = null;       // Founded religion
        this.blessings = {};        // Active divine blessings

        // Reputation per kingdom
        this.reputation = {};

        // Kingdom allegiance
        this.allegiance = null;      // Kingdom ID the player is pledged to
        this.kingdomTitle = null;    // Title within kingdom (e.g., 'king', 'treasurer', 'lord')

        // Dynasty & Relationships
        this.dynasty = {
            name: (profile.name || 'Wanderer') + 'son',
            founded: 1,
            prestige: 0,
        };
        this.spouse = null;            // Relationship NPC id of spouse
        this.children = [];            // Array of child objects
        this.relationships = {};       // { npcId: { score, romantic, affection, history[] } }
        this.heir = null;              // Child id designated as heir
        this.travelParty = [];         // Relationship NPC ids currently traveling with player
        this.maxLifespan = 55 + Math.floor(Math.random() * 31); // 55-85
        this.birthDay = 0;
        this.marriageDay = null;

        // Visuals
        this.color = '#ffffff';
        this.icon = '👤';

        // Starvation tracking
        this.starvationDays = 0; // Consecutive days without food

        // Tracking
        this.visitedImprovements = new Set();
        this.discoveredLore = new Set(); // IDs of discovered world history entries
        this.discoveredHolySites = new Set(); // "q,r" keys of discovered holy sites
        this.discoveredExtinctFaiths = new Set(); // IDs of discovered extinct religions

        // Kingdom knowledge — what the player has learned about each kingdom
        // Categories: basics, ruler, peoples, religion, military, diplomacy, economy
        this.kingdomKnowledge = {}; // { kingdomId: { basics:bool, ruler:bool, peoples:bool, religion:bool, military:bool, diplomacy:bool, economy:bool } }

        // Finance tracking — rolling history of daily income/expenses
        this.financeHistory = [];  // Array of { day, gold, income: {}, expenses: {} }
        this.financeToday = null;  // Current day's running tally
    }

    /**
     * Place player in the world at a reasonable starting location
     */
    placeInWorld(world) {
        // Find a good starting location — preferably a village or unclaimed territory
        let bestTile = null;

        // Try to start near an independent village
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (tile.settlement && tile.settlement.type === 'village' && !tile.kingdom) {
                    bestTile = { q, r };
                    break;
                }
            }
            if (bestTile) break;
        }

        // Fallback: just find any passable land
        if (!bestTile) {
            for (let r = Math.floor(world.height * 0.4); r < Math.floor(world.height * 0.6); r++) {
                for (let q = 0; q < world.width; q++) {
                    const tile = world.tiles[r][q];
                    if (tile.terrain.passable && tile.terrain.id !== 'coast') {
                        bestTile = { q, r };
                        break;
                    }
                }
                if (bestTile) break;
            }
        }

        if (bestTile) {
            this.q = bestTile.q;
            this.r = bestTile.r;
            this.prevQ = bestTile.q;
            this.prevR = bestTile.r;
        }

        // Initialize reputation with kingdoms
        for (const kingdom of world.kingdoms) {
            this.reputation[kingdom.id] = 0;
        }

        // Reveal area around player
        this.revealArea(world, 4);

        // Discover holy sites in initial visible area
        this.discoverNearbyHolySites(world, 4);
    }

    /**
     * Reveal tiles around the player
     */
    revealArea(world, radius) {
        const hexes = Hex.hexesInRange(this.q, this.r, radius);
        for (const hex of hexes) {
            const tile = world.getTile(hex.q, hex.r);
            if (tile) {
                tile.explored = true;
                tile.visible = true;
            }
        }
    }

    /**
     * Set visibility (fog of war update)
     */
    updateVisibility(world, viewRadius = 3) {
        // First, set all tiles to not visible
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                world.tiles[r][q].visible = false;
            }
        }

        // Then reveal around player
        const hexes = Hex.hexesInRange(this.q, this.r, viewRadius);
        for (const hex of hexes) {
            const tile = world.getTile(hex.q, hex.r);
            if (tile) {
                tile.explored = true;
                tile.visible = true;
            }
        }
    }

    /**
     * Food types that can sustain travel (best consumed first for efficiency)
     */
    static FOOD_TYPES = ['bread', 'preserved_fish', 'fish', 'grain'];

    /**
     * Get total food count across all food types
     */
    getFoodCount() {
        if (!this.inventory) return 0;
        let total = 0;
        for (const food of Player.FOOD_TYPES) {
            total += (this.inventory[food] || 0);
        }
        return total;
    }

    /**
     * Consume 1 unit of food (best type first). Returns true if food was consumed.
     */
    consumeFood() {
        if (!this.inventory) return false;
        for (const food of Player.FOOD_TYPES) {
            if (this.inventory[food] && this.inventory[food] > 0) {
                this.inventory[food]--;
                if (this.inventory[food] <= 0) delete this.inventory[food];
                return true;
            }
        }
        return false;
    }

    /**
     * Request to move to target hex
     */
    moveTo(targetQ, targetR, world) {
        // Can't move during jail or indentured servitude
        if (this.jailState) return false;
        if (this.indenturedServitude) return false;

        // Define passability based on whether player is on a ship
        const isPassable = (q, r) => {
            const tile = world.getTile(q, r);
            if (!tile) return false;
            
            if (this.boardedShip) {
                // On a ship: can move on water tiles and beaches/coasts
                const waterTiles = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea', 'beach'];
                if (waterTiles.includes(tile.terrain.id)) return true;
                
                // Allow starting position
                const isCurrentPos = (q === this.q && r === this.r);
                if (isCurrentPos) return true;
                
                // Allow coastal settlements (settlements adjacent to water) for docking
                if (tile.settlement) {
                    const neighbors = Hex.neighbors(q, r);
                    for (const n of neighbors) {
                        const nq = Hex.wrapQ(n.q, world.width);
                        if (n.r < 0 || n.r >= world.height) continue;
                        const nTile = world.getTile(nq, n.r);
                        if (nTile && waterTiles.includes(nTile.terrain.id)) {
                            return true; // Settlement is adjacent to water
                        }
                    }
                }
                
                return false;
            } else {
                // On land: use normal passability
                return tile.terrain.passable;
            }
        };

        const path = Hex.findPath(
            this.q, this.r,
            targetQ, targetR,
            world.width, world.height,
            isPassable,
            (q, r) => {
                const tile = world.getTile(q, r);
                if (this.boardedShip) {
                    // On a ship: water tiles have uniform movement cost
                    const waterTiles = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea', 'beach'];
                    if (waterTiles.includes(tile.terrain.id)) {
                        return 2; // Standard water movement cost
                    }
                    return 2; // For starting position on land
                }
                return Infrastructure.getEffectiveMoveCost(tile);
            }
        );

        if (path && path.length > 1) {
            this.path = path;
            this.pathIndex = 1; // Skip first element (current position)
            this.isMoving = true;
            // Store destination for multi-day travel
            this.travelDestination = { q: targetQ, r: targetR };
            // Clear any previous queued path
            this.queuedPath = null;
            this.queuedPathIndex = 0;
            return true;
        }
        return false;
    }

    /**
     * Cancel any queued multi-day travel
     */
    cancelTravel() {
        this.queuedPath = null;
        this.queuedPathIndex = 0;
        this.travelDestination = null;
        if (this.isMoving) {
            this.isMoving = false;
            this.path = null;
        }
    }

    /**
     * Resume queued path after a new day (stamina restored)
     */
    resumeQueuedPath() {
        if (!this.queuedPath || this.queuedPathIndex >= this.queuedPath.length) {
            this.queuedPath = null;
            this.queuedPathIndex = 0;
            this.travelDestination = null;
            return false;
        }

        this.path = this.queuedPath;
        this.pathIndex = this.queuedPathIndex;
        this.isMoving = true;
        this.moveAnimProgress = 0;
        // Clear queued state (now active)
        this.queuedPath = null;
        this.queuedPathIndex = 0;
        return true;
    }

    /**
     * Step along path (called each frame during movement)
     */
    stepAlongPath(world, deltaTime) {
        if (!this.isMoving || !this.path || this.pathIndex >= this.path.length) {
            this.isMoving = false;
            this.path = null;
            return false;
        }

        // Animate movement
        this.moveAnimProgress += deltaTime * 4; // Speed of movement animation

        if (this.moveAnimProgress >= 1) {
            const nextHex = this.path[this.pathIndex];
            const tile = world.getTile(nextHex.q, nextHex.r);

            // Check if tile is accessible based on current mode (ship vs land)
            let isAccessible = false;
            if (this.boardedShip) {
                const waterTiles = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea', 'beach'];
                isAccessible = waterTiles.includes(tile.terrain.id);
            } else {
                isAccessible = tile.terrain.passable;
            }

            if (!tile || !isAccessible) {
                this.isMoving = false;
                this.path = null;
                return false;
            }

            // Check stamina
            let moveCost;
            if (this.boardedShip) {
                moveCost = 2; // Water movement cost
            } else {
                moveCost = (typeof Infrastructure !== 'undefined') ? Infrastructure.getEffectiveMoveCost(tile) : tile.terrain.moveCost;
            }
            if (this.movementRemaining < moveCost) {
                this.isMoving = false;
                this.path = null;
                return false;
            }

            // Check action points (each move step costs 1 AP)
            if ((this.actionPoints || 0) < 1) {
                this.isMoving = false;
                this.path = null;
                return false;
            }

            // Move
            this.prevQ = this.q;
            this.prevR = this.r;
            this.q = nextHex.q;
            this.r = nextHex.r;
            
            // Ensure q coordinate is wrapped (for world wrapping)
            if (typeof Hex !== 'undefined' && world.width) {
                this.q = Hex.wrapQ(this.q, world.width);
            }
            
            this.movementRemaining -= moveCost;
            this.actionPoints = Math.max(0, (this.actionPoints || 0) - 1);

            // Reveal area
            this.revealArea(world, 4);
            this.updateVisibility(world, 4);

            // Discover holy sites on explored tiles
            this.discoverNearbyHolySites(world, 4);

            // Title hooks: marshal patrol & cartographer exploration
            if (typeof Titles !== 'undefined') {
                Titles.recordPatrolStep(this, this.q, this.r);
                Titles.recordExploration(this, 1);
            }

            // Check for improvements (POIs) - just track visitation, don't auto-reward
            // (Use the Explore action for full rewards)
            if (tile.improvement) {
                const impKey = `${tile.q},${tile.r}`;
                if (!this.visitedImprovements.has(impKey)) {
                    this.visitedImprovements.add(impKey);
                    // Discovery notification is now handled in game.js
                }
            }

            this.pathIndex++;
            this.moveAnimProgress = 0;

            if (this.pathIndex >= this.path.length) {
                // Arrived at destination
                this.isMoving = false;
                this.path = null;
                this.travelDestination = null;
            } else if (this.movementRemaining <= 0 || (this.actionPoints || 0) <= 0) {
                // Out of stamina or action points — queue remaining path for next day
                this.queuedPath = this.path;
                this.queuedPathIndex = this.pathIndex;
                this.isMoving = false;
                this.path = null;
            }

            return true; // Moved to new hex
        }

        return false;
    }

    /**
     * Get pixel position (interpolated during movement)
     */
    getPixelPos(hexSize) {
        const current = Hex.axialToPixel(this.q, this.r, hexSize);

        if (this.isMoving && this.path && this.pathIndex < this.path.length) {
            const next = Hex.axialToPixel(this.path[this.pathIndex].q, this.path[this.pathIndex].r, hexSize);
            return {
                x: Utils.lerp(current.x, next.x, this.moveAnimProgress),
                y: Utils.lerp(current.y, next.y, this.moveAnimProgress),
            };
        }

        return current;
    }

    /**
     * Rest (end day — restore stamina)
     */
    endDay() {
        // Daily food consumption — eat 1 food per day
        if (this.consumeFood()) {
            // Fed — reset starvation counter
            this.starvationDays = 0;
        } else {
            // No food — increment starvation
            this.starvationDays = (this.starvationDays || 0) + 1;

            // Escalating health loss: 5 + 3 per consecutive day starving
            const starveDmg = 5 + (this.starvationDays * 3);
            this.health = Math.max(0, this.health - starveDmg);
        }

        // Apply technology movement bonus
        let staminaBonus = 0;
        if (typeof Technology !== 'undefined') {
            staminaBonus = Technology.getMovementBonus(this);
        }
        this.movementRemaining = this.stamina + staminaBonus;

        // Only regenerate health if not starving
        if (this.starvationDays === 0) {
            this.health = Math.min(this.health + 5, this.maxHealth);
        }

        // Reduce max stamina while starving (weakened)
        const effectiveStamina = this.starvationDays > 0
            ? Math.max(2, this.stamina - this.starvationDays)
            : this.stamina;
        this.movementRemaining = Math.min(this.movementRemaining, effectiveStamina + staminaBonus);

        // Reset action points
        this.actionPoints = this.maxActionPoints;

        // Block movement if in jail or servitude
        if (this.jailState) {
            this.movementRemaining = 0;
            this.stamina = 0;
            this.actionPoints = 0;
        }
        if (this.indenturedServitude) {
            this.movementRemaining = 0;
            this.stamina = 0;
            this.actionPoints = 0;
        }
    }

    /**
     * Get reachable hexes from current position with remaining movement
     */
    getReachableHexes(world) {
        const reachable = new Map();
        const queue = [{ q: this.q, r: this.r, cost: 0 }];
        reachable.set(`${this.q},${this.r}`, 0);

        while (queue.length > 0) {
            const current = queue.shift();
            const neighbors = Hex.neighbors(current.q, current.r);

            for (const n of neighbors) {
                const wq = Hex.wrapQ(n.q, world.width);
                const wr = n.r;
                if (wr < 0 || wr >= world.height) continue;

                const tile = world.getTile(wq, wr);
                if (!tile || !tile.terrain.passable) continue;

                const newCost = current.cost + ((typeof Infrastructure !== 'undefined') ? Infrastructure.getEffectiveMoveCost(tile) : tile.terrain.moveCost);
                const key = `${wq},${wr}`;

                if (newCost <= this.movementRemaining && (!reachable.has(key) || reachable.get(key) > newCost)) {
                    reachable.set(key, newCost);
                    queue.push({ q: wq, r: wr, cost: newCost });
                }
            }
        }

        return reachable;
    }

    /**
     * Pledge allegiance to a kingdom
     * Player can only be pledged to one kingdom at a time
     */
    pledgeAllegiance(kingdomId, world) {
        if (this.allegiance) {
            return { success: false, reason: `Already pledged to ${world.getKingdom(this.allegiance)?.name}` };
        }

        const kingdom = world.getKingdom(kingdomId);
        if (!kingdom) {
            return { success: false, reason: 'Kingdom not found' };
        }

        this.allegiance = kingdomId;
        this.kingdomTitle = 'citizen'; // Default title
        this.title = `Citizen of ${kingdom.name}`;

        return { success: true, kingdom };
    }

    /**
     * Break allegiance with current kingdom
     */
    breakAllegiance(world) {
        if (!this.allegiance) {
            return { success: false, reason: 'Not pledged to any kingdom' };
        }

        const oldKingdom = world.getKingdom(this.allegiance);
        this.allegiance = null;
        this.kingdomTitle = null;
        this.title = 'Nobody';

        return { success: true, oldKingdom };
    }

    /**
     * Set kingdom title (e.g., 'king', 'treasurer', 'lord')
     * This would typically be granted by game events or player actions
     */
    setKingdomTitle(title) {
        if (!this.allegiance) {
            return { success: false, reason: 'Must be pledged to a kingdom first' };
        }

        this.kingdomTitle = title;
        return { success: true };
    }

    /**
     * Discover holy sites within visible radius
     */
    discoverNearbyHolySites(world, radius) {
        const neighbors = Hex.hexesInRange(this.q, this.r, radius);
        for (const { q, r } of neighbors) {
            const tile = world.getTile(q, r);
            if (tile && tile.holySite) {
                const key = `${q},${r}`;
                if (!this.discoveredHolySites.has(key)) {
                    this.discoveredHolySites.add(key);
                    // Also discover the associated extinct faith if applicable
                    if (tile.holySite.faithId && typeof Religion !== 'undefined') {
                        const faith = Religion.FAITHS[tile.holySite.faithId];
                        if (faith && faith.extinct) {
                            this.discoverExtinctFaith(faith.id, tile.holySite.name);
                        }
                    }
                }
            }
        }
    }

    /**
     * Discover an extinct faith by ID
     * @returns {boolean} true if newly discovered
     */
    discoverExtinctFaith(faithId, source) {
        if (!this.discoveredExtinctFaiths) this.discoveredExtinctFaiths = new Set();
        if (this.discoveredExtinctFaiths.has(faithId)) return false;
        this.discoveredExtinctFaiths.add(faithId);
        return true;
    }

    /**
     * Check if the player knows a specific category about a kingdom
     */
    knowsAbout(kingdomId, category) {
        if (!kingdomId) return false;
        if (!this.kingdomKnowledge) this.kingdomKnowledge = {};
        const k = this.kingdomKnowledge[kingdomId];
        if (!k) return false;
        return !!k[category];
    }

    /**
     * Learn something about a kingdom
     * @param {string} kingdomId
     * @param {string|string[]} categories - one or more of: basics, ruler, peoples, religion, military, diplomacy, economy
     * @returns {string[]} newly learned categories
     */
    learnAboutKingdom(kingdomId, categories) {
        if (!kingdomId) return [];
        if (!this.kingdomKnowledge) this.kingdomKnowledge = {};
        if (!this.kingdomKnowledge[kingdomId]) {
            this.kingdomKnowledge[kingdomId] = {};
        }
        const cats = Array.isArray(categories) ? categories : [categories];
        const newlyLearned = [];
        for (const cat of cats) {
            if (!this.kingdomKnowledge[kingdomId][cat]) {
                this.kingdomKnowledge[kingdomId][cat] = true;
                newlyLearned.push(cat);
            }
        }
        return newlyLearned;
    }
}

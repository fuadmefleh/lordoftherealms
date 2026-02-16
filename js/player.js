// ============================================
// PLAYER — Player state and actions
// ============================================

class Player {
    constructor(profile = {}) {
        this.q = 0;
        this.r = 0;
        this.name = profile.name || 'Wanderer';
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
        this.inventory = {};
        this.maxInventory = 20;

        // Maps collection (cartography system)
        this.maps = [];

        // Economic path
        this.properties = [];       // Farms, mines, workshops
        this.caravans = [];         // Active trade caravans
        this.activeContract = null; // Mercenary contract
        this.loans = {};            // Loans per kingdom: { kingdomId: [loan1, loan2] }

        // Military path
        this.army = [];             // Recruited units

        // Religious path
        this.religion = null;       // Founded religion
        this.blessings = {};        // Active divine blessings

        // Reputation per kingdom
        this.reputation = {};

        // Kingdom allegiance
        this.allegiance = null;      // Kingdom ID the player is pledged to
        this.kingdomTitle = null;    // Title within kingdom (e.g., 'king', 'treasurer', 'lord')

        // Visuals
        this.color = '#ffffff';
        this.icon = '👤';

        // Tracking
        this.visitedImprovements = new Set();

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
     * Request to move to target hex
     */
    moveTo(targetQ, targetR, world) {
        // Can't move during indentured servitude
        if (this.indenturedServitude) return false;

        const path = Hex.findPath(
            this.q, this.r,
            targetQ, targetR,
            world.width, world.height,
            (q, r) => world.isPassable(q, r)
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

            if (!tile || !tile.terrain.passable) {
                this.isMoving = false;
                this.path = null;
                return false;
            }

            // Check stamina
            const moveCost = (typeof Infrastructure !== 'undefined') ? Infrastructure.getEffectiveMoveCost(tile) : tile.terrain.moveCost;
            if (this.movementRemaining < moveCost) {
                this.isMoving = false;
                this.path = null;
                return false;
            }

            // Move
            this.prevQ = this.q;
            this.prevR = this.r;
            this.q = nextHex.q;
            this.r = nextHex.r;
            this.movementRemaining -= moveCost;

            // Reveal area
            this.revealArea(world, 4);
            this.updateVisibility(world, 4);

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
            } else if (this.movementRemaining <= 0) {
                // Out of stamina — queue remaining path for next day
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
        // Apply technology movement bonus
        let staminaBonus = 0;
        if (typeof Technology !== 'undefined') {
            staminaBonus = Technology.getMovementBonus(this);
        }
        this.movementRemaining = this.stamina + staminaBonus;
        this.health = Math.min(this.health + 5, this.maxHealth);

        // Block movement if in servitude
        if (this.indenturedServitude) {
            this.movementRemaining = 0;
            this.stamina = 0;
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
}

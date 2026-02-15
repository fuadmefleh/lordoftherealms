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
        this.gold = 100;
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
        };

        // Movement
        this.path = null;           // Current path being followed
        this.pathIndex = 0;
        this.movementRemaining = this.stamina;
        this.isMoving = false;
        this.moveAnimProgress = 0;
        this.prevQ = 0;
        this.prevR = 0;

        // Inventory
        this.inventory = {};
        this.maxInventory = 20;

        // Economic path
        this.properties = [];       // Farms, mines, workshops
        this.caravans = [];         // Active trade caravans
        this.activeContract = null; // Mercenary contract

        // Military path
        this.army = [];             // Recruited units

        // Religious path
        this.religion = null;       // Founded religion
        this.blessings = {};        // Active divine blessings

        // Reputation per kingdom
        this.reputation = {};

        // Visuals
        this.color = '#ffffff';
        this.icon = '👤';

        // Tracking
        this.visitedImprovements = new Set();
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
            return true;
        }
        return false;
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
            const moveCost = tile.terrain.moveCost;
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

            // Check for improvements (POIs)
            if (tile.improvement) {
                const impKey = `${tile.q},${tile.r}`;
                if (!this.visitedImprovements.has(impKey)) {
                    this.visitedImprovements.add(impKey);

                    // Reward
                    let xp = 10;
                    let gold = 50;
                    let msg = 'Discovered ' + tile.improvement.name;

                    if (tile.improvement.id === 'ruins') {
                        xp = 50;
                        gold = 200;
                        msg = 'Explored Ancient Ruins! Found ancient treasures.';
                    } else if (tile.improvement.id === 'shrine') {
                        xp = 20;
                        gold = 20; // Offerings?
                        this.karma += 5;
                        msg = 'Prayed at a Shrine. Felt a spiritual presence.';
                    } else if (tile.improvement.id === 'monument') {
                        xp = 30;
                        this.renown += 5;
                        msg = 'Visited a Monument. Your renown grows.';
                    }

                    this.gold += gold;
                    // TODO: Add XP system properly, for now just gold/karma/renown

                    // Show notification via global UI access (a bit hacky but works for now)
                    if (window.game && window.game.ui) {
                        window.game.ui.showNotification('Discovery!', `${msg} (+${gold} Gold)`, 'success');
                        window.game.ui.updateStats(this, world);
                    }
                }
            }

            this.pathIndex++;
            this.moveAnimProgress = 0;

            if (this.pathIndex >= this.path.length || this.movementRemaining <= 0) {
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
        this.movementRemaining = this.stamina;
        this.health = Math.min(this.health + 5, this.maxHealth);
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

                const newCost = current.cost + tile.terrain.moveCost;
                const key = `${wq},${wr}`;

                if (newCost <= this.movementRemaining && (!reachable.has(key) || reachable.get(key) > newCost)) {
                    reachable.set(key, newCost);
                    queue.push({ q: wq, r: wr, cost: newCost });
                }
            }
        }

        return reachable;
    }
}

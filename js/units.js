// ============================================
// UNITS — Dynamic map entities
// ============================================

class WorldUnit {
    constructor(type, q, r, targetQ = null, targetR = null) {
        this.type = type;
        this.q = q;
        this.r = r;
        this.sourceQ = q;
        this.sourceR = r;
        this.id = Math.random().toString(36).substr(2, 9);
        this.targetQ = targetQ;
        this.targetR = targetR;
        this.path = [];
        this.destroyed = false;
        this.age = 0;
        this.maxAge = Utils.randInt(50, 200);

        // Stats based on type
        switch (type) {
            case 'caravan':
                this.icon = '🐫';
                this.name = 'Trade Caravan';
                this.speed = 4;
                this.population = Utils.randInt(5, 15);
                this.strength = Utils.randInt(2, 5);
                this.inventory = this.generateInitialInventory('trade');
                break;
            case 'raider':
                this.icon = '🏇';
                this.name = 'Raider Band';
                this.speed = 6;
                this.population = Utils.randInt(10, 30);
                this.strength = Utils.randInt(8, 15);
                this.inventory = this.generateInitialInventory('military');
                break;
            case 'patrol':
                this.icon = '💂';
                this.name = 'Kingdom Patrol';
                this.speed = 6;
                this.population = Utils.randInt(15, 40);
                this.strength = Utils.randInt(15, 25);
                this.inventory = {};
                break;
            case 'settler':
                this.icon = '⛺';
                this.name = 'Settler Group';
                this.speed = 2;
                this.population = Utils.randInt(20, 50);
                this.strength = Utils.randInt(5, 10);
                this.inventory = { 'food': 100, 'tools': 20 };
                break;
            case 'ship':
                this.icon = '⛵';
                this.name = 'Trading Ship';
                this.speed = 8;
                this.population = Utils.randInt(10, 25);
                this.strength = Utils.randInt(5, 12);
                this.inventory = this.generateInitialInventory('sea_trade');
                break;
            case 'pirate':
                this.icon = '🏴‍☠️';
                this.name = 'Pirate Ship';
                this.speed = 8;
                this.population = Utils.randInt(15, 35);
                this.strength = Utils.randInt(12, 20);
                this.inventory = this.generateInitialInventory('pirate');
                break;
            case 'fishing_boat':
                this.icon = '🛶';
                this.name = 'Fishing Boat';
                this.speed = 6;
                this.population = Utils.randInt(2, 5);
                this.strength = 1;
                this.inventory = {};
                break;
            default:
                this.icon = '❓';
                this.name = 'Unknown Unit';
                this.speed = 1;
                this.population = 1;
                this.strength = 1;
                this.inventory = {};
        }
    }

    /**
     * Generate initial inventory for unit
     */
    generateInitialInventory(theme) {
        const inv = {};
        switch (theme) {
            case 'trade':
                inv['gold'] = Utils.randInt(50, 200);
                inv[Utils.randPick(['silk', 'spices', 'tools', 'gems'])] = Utils.randInt(5, 20);
                break;
            case 'sea_trade':
                inv['gold'] = Utils.randInt(100, 500);
                inv[Utils.randPick(['fish', 'wine', 'silk', 'spices'])] = Utils.randInt(10, 40);
                break;
            case 'military':
                inv['gold'] = Utils.randInt(10, 50);
                inv['food'] = Utils.randInt(20, 60);
                break;
            case 'pirate':
                inv['gold'] = Utils.randInt(50, 300);
                inv['rum'] = Utils.randInt(5, 15);
                break;
        }
        return inv;
    }

    /**
     * Update unit logic for the day
     */
    update(world) {
        this.age++;
        if (this.age > this.maxAge && this.type !== 'settler' && this.type !== 'fishing_boat') {
            this.destroyed = true;
            return;
        }

        // Logic based on type
        switch (this.type) {
            case 'caravan':
            case 'ship':
                this.updateCaravan(world);
                break;
            case 'raider':
            case 'pirate':
                this.updateRaider(world);
                break;
            case 'patrol':
                this.updatePatrol(world);
                break;
            case 'settler':
                this.updateSettler(world);
                break;
            case 'fishing_boat':
                this.updateFishingBoat(world);
                break;
        }
    }

    /**
     * Caravan logic: Move towards target settlement
     */
    updateCaravan(world) {
        if (this.targetQ === null || (this.q === this.targetQ && this.r === this.targetR)) {
            // Arrived or no target, find new destination
            const currentTile = world.getTile(this.q, this.r);
            if (!currentTile) return;

            let regionId = null;
            const isShip = this.type === 'ship' || this.type === 'pirate';

            if (isShip) {
                // If on water, use that region. If on land, find adjacent water region.
                if (!currentTile.terrain.passable) {
                    regionId = currentTile.regionId;
                } else {
                    const neighbors = Hex.neighbors(this.q, this.r);
                    for (const n of neighbors) {
                        const nt = world.getTile(n.q, n.r);
                        if (nt && !nt.terrain.passable) {
                            regionId = nt.regionId;
                            break;
                        }
                    }
                }
            } else {
                regionId = currentTile.regionId;
            }

            const settlements = world.getAllSettlements();
            if (settlements.length > 1) {
                const reachable = settlements.filter(s => {
                    if (s.q === this.q && s.r === this.r) return false;

                    if (isShip) {
                        // Settlement is reachable if it has an adjacent water tile in our region
                        const neighbors = Hex.neighbors(s.q, s.r);
                        return neighbors.some(n => {
                            const nt = world.getTile(n.q, n.r);
                            return nt && nt.regionId === regionId;
                        });
                    } else {
                        const t = world.getTile(s.q, s.r);
                        return t && t.regionId === regionId;
                    }
                });

                if (reachable.length > 0) {
                    const dest = Utils.randPick(reachable);
                    this.targetQ = dest.q;
                    this.targetR = dest.r;
                    this.path = [];
                } else {
                    this.destroyed = true; // Nowhere reachable to go
                    return;
                }
            } else {
                this.destroyed = true; // Nowhere to go
                return;
            }
        }

        // Move multiple times based on speed
        for (let i = 0; i < this.speed; i++) {
            if (this.q === this.targetQ && this.r === this.targetR) break;
            this.moveTowardsTarget(world);
        }

        // Check if arrived at target
        if (this.targetQ !== null && this.targetR !== null &&
            this.q === this.targetQ && this.r === this.targetR) {
            this.arrived = true;

            // If not player owned, just disappear (NPC trade specific logic elsewhere?)
            if (!this.playerOwned) {
                this.destroyed = true;
            }
        }

        // Check for raiders nearby
        const raider = world.units.find(u => (u.type === 'raider' || u.type === 'pirate') && Hex.wrappingDistance(this.q, this.r, u.q, u.r, world.width) < 1);
        if (raider) {
            // Transfer caravan's inventory to the raider
            for (const [item, amount] of Object.entries(this.inventory)) {
                raider.inventory[item] = (raider.inventory[item] || 0) + amount;
            }
            world.events.push({ text: `${this.name} was robbed by ${raider.name}!`, type: 'economic' });
            this.destroyed = true;
        }
    }

    /**
     * Raider logic: Look for caravans to rob
     */
    updateRaider(world) {
        const currentTile = world.getTile(this.q, this.r);
        const regionId = currentTile ? currentTile.regionId : null;
        const isShip = this.type === 'pirate';

        const target = world.units.find(u => {
            if (u.type !== 'caravan' && u.type !== 'ship') return false;
            if (Hex.wrappingDistance(this.q, this.r, u.q, u.r, world.width) >= 8) return false;

            const targetTile = world.getTile(u.q, u.r);
            if (!targetTile) return false;

            if (isShip) {
                // Pirate can only target if caravan is near water in the same region
                const neighbors = Hex.neighbors(u.q, u.r);
                return neighbors.some(n => {
                    const nt = world.getTile(n.q, n.r);
                    return nt && nt.regionId === regionId;
                });
            } else {
                return targetTile.regionId === regionId;
            }
        });

        if (target) {
            this.targetQ = target.q;
            this.targetR = target.r;
            this.path = [];
        } else if (!this.targetQ || (this.q === this.targetQ && this.r === this.targetR)) {
            // Wander
            const neighbors = Hex.neighbors(this.q, this.r);
            const move = Utils.randPick(neighbors);
            this.targetQ = move.q;
            this.targetR = move.r;
            this.path = [];
        }

        // Move multiple times based on speed
        for (let i = 0; i < this.speed; i++) {
            if (this.targetQ !== null && this.q === this.targetQ && this.r === this.targetR) break;
            this.moveTowardsTarget(world);
        }

        // Check for patrols nearby
        const patrol = world.units.find(u => u.type === 'patrol' && Hex.wrappingDistance(this.q, this.r, u.q, u.r, world.width) < 1);
        if (patrol) {
            world.events.push({ text: `A ${this.name} was defeated by a ${patrol.name}!`, type: 'military' });
            this.destroyed = true;
        }
    }

    /**
     * Patrol logic: Hunt raiders
     */
    updatePatrol(world) {
        const currentTile = world.getTile(this.q, this.r);
        const regionId = currentTile ? currentTile.regionId : null;

        const target = world.units.find(u => {
            if (u.type !== 'raider' && u.type !== 'pirate') return false;
            if (Hex.wrappingDistance(this.q, this.r, u.q, u.r, world.width) >= 10) return false;

            const targetTile = world.getTile(u.q, u.r);
            if (!targetTile) return false;

            return targetTile.regionId === regionId;
        });

        if (target) {
            this.targetQ = target.q;
            this.targetR = target.r;
            this.path = [];
        } else if (!this.targetQ || (this.q === this.targetQ && this.r === this.targetR)) {
            // Find a city to protect
            const currentTile = world.getTile(this.q, this.r);
            const regionId = currentTile ? currentTile.regionId : null;

            const settlements = world.getAllSettlements();
            const reachable = settlements.filter(s => {
                const t = world.getTile(s.q, s.r);
                return t && t.regionId === regionId;
            });

            if (reachable.length > 0) {
                const dest = Utils.randPick(reachable);
                this.targetQ = dest.q;
                this.targetR = dest.r;
                this.path = [];
            }
        }

        // Move multiple times based on speed
        for (let i = 0; i < this.speed; i++) {
            if (this.targetQ !== null && this.q === this.targetQ && this.r === this.targetR) break;
            this.moveTowardsTarget(world);
        }
    }

    /**
     * Settler logic: Move to a far away spot and build a village
     */
    updateSettler(world) {
        if (this.targetQ === null) {
            // Pick a distant, empty, passable tile
            const currentTile = world.getTile(this.q, this.r);
            const regionId = currentTile ? currentTile.regionId : null;

            let attempts = 0;
            while (attempts < 50) {
                attempts++;
                const q = Utils.randInt(0, world.width - 1);
                const r = Utils.randInt(5, world.height - 6);
                const tile = world.getTile(q, r);
                if (tile && tile.terrain.passable && !tile.settlement && tile.regionId === regionId) {
                    const settlements = world.getAllSettlements();
                    const dist = settlements.reduce((min, s) => Math.min(min, Hex.wrappingDistance(q, r, s.q, s.r, world.width)), Infinity);
                    if (dist > 6) {
                        this.targetQ = q;
                        this.targetR = r;
                        break;
                    }
                }
            }
            if (this.targetQ === null) { this.destroyed = true; return; }
        }

        // Move multiple times based on speed
        for (let i = 0; i < this.speed; i++) {
            if (this.q === this.targetQ && this.r === this.targetR) break;
            this.moveTowardsTarget(world);
        }

        if (this.q === this.targetQ && this.r === this.targetR) {
            // Build village!
            const tile = world.getTile(this.q, this.r);
            if (tile && !tile.settlement) {
                const name = Kingdom.generateCityName(Utils.randPick(['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime']));
                tile.settlement = {
                    type: 'village',
                    name: name,
                    population: Utils.randInt(50, 150),
                    level: 0,
                    kingdom: null,
                };
                world.events.push({ text: `A new settlement, ${name}, has been established!`, type: 'growth' });
            }
            this.destroyed = true;
            return;
        }
    }

    /**
     * Basic A* or direct movement towards target
     */
    moveTowardsTarget(world) {
        const dist = Hex.wrappingDistance(this.q, this.r, this.targetQ, this.targetR, world.width);
        if (dist === 0) return;

        // Simple step-by-step for now to avoid heavy A* every tick
        const neighbors = Hex.neighbors(this.q, this.r);
        let best = null;
        let minDist = dist;

        for (const n of neighbors) {
            const wq = Hex.wrapQ(n.q, world.width);
            const tile = world.getTile(wq, n.r);

            // Ship/Pirate/Fishing Boat only on water, others only on land
            const isWaterUnit = (this.type === 'ship' || this.type === 'pirate' || this.type === 'fishing_boat');
            if (!tile) continue;

            const tileIsWater = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(tile.terrain.id);

            // Special case for fishing boats returning to wharf
            const isFishingBoatReturning = this.type === 'fishing_boat' && this.returning && this.homeWharf;
            const isNearHome = isFishingBoatReturning &&
                Hex.wrappingDistance(wq, n.r, this.homeWharf.q, this.homeWharf.r, world.width) <= 1;

            // Special case for fishing boats starting from wharf (on land)
            const currentTile = world.getTile(this.q, this.r);
            const isFishingBoatOnLand = this.type === 'fishing_boat' && currentTile && currentTile.terrain.passable;

            // Allow fishing boats to move onto land when near their home wharf OR move from land to water when starting
            if (isWaterUnit && !tileIsWater && !isNearHome && !isFishingBoatOnLand) continue;
            if (!isWaterUnit && !tile.terrain.passable) continue;

            const d = Hex.wrappingDistance(wq, n.r, this.targetQ, this.targetR, world.width);
            if (d < minDist) {
                minDist = d;
                best = { q: wq, r: n.r };
            }
        }

        if (best) {
            this.q = best.q;
            this.r = best.r;
        } else {
            // Stuck? 
            this.age += 5; // Age faster if stuck
        }
    }

    /**
     * Fishing Boat Logic
     */
    updateFishingBoat(world) {
        // Stats
        this.maxAge = 1000; // Boats last a while

        console.log(`Fishing boat update: pos(${this.q},${this.r}) target(${this.targetQ},${this.targetR}) fishing=${this.fishing} returning=${this.returning}`);

        // 1. Heading to fishing grounds
        if (!this.fishing && !this.returning) {
            if (this.targetQ !== null && this.targetR !== null) {
                const dist = Hex.wrappingDistance(this.q, this.r, this.targetQ, this.targetR, world.width);
                console.log(`Heading to fishing grounds, distance: ${dist}`);
                if (dist <= 0) {
                    // Arrived
                    console.log('Arrived at fishing grounds!');
                    this.fishing = true;
                    this.fishingTimer = 1; // Fish for 1 day
                    this.fishingSpotQ = this.targetQ; // Remember spot
                    this.fishingSpotR = this.targetR;
                } else {
                    // Move multiple times based on speed
                    for (let i = 0; i < this.speed; i++) {
                        const currentDist = Hex.wrappingDistance(this.q, this.r, this.targetQ, this.targetR, world.width);
                        if (currentDist <= 0) {
                            this.fishing = true;
                            this.fishingTimer = 1;
                            this.fishingSpotQ = this.targetQ;
                            this.fishingSpotR = this.targetR;
                            break;
                        }
                        console.log(`Moving towards target (step ${i + 1}/${this.speed})`);
                        this.moveTowardsTarget(world);
                        console.log(`New position: (${this.q},${this.r})`);
                    }
                }
            } else {
                console.log('No target, destroying boat');
                this.destroyed = true; // No target
            }
        }
        // 2. Fishing
        else if (this.fishing) {
            this.fishingTimer--;
            console.log(`Fishing... timer: ${this.fishingTimer}`);
            if (this.fishingTimer <= 0) {
                // Done fishing, return home
                console.log('Done fishing, returning home');
                this.fishing = false;
                this.returning = true;
                this.inventory['fish'] = (this.inventory['fish'] || 0) + Utils.randInt(5, 15);

                // Set target to home
                if (this.homeWharf) {
                    this.targetQ = this.homeWharf.q;
                    this.targetR = this.homeWharf.r;
                    console.log(`Home wharf at (${this.targetQ},${this.targetR})`);
                }
            }
        }
        // 3. Returning home
        else if (this.returning) {
            const dist = Hex.wrappingDistance(this.q, this.r, this.targetQ, this.targetR, world.width);
            console.log(`Returning home, distance: ${dist}`);
            if (dist <= 0) {
                // Arrived home
                console.log('Arrived at wharf!');
                this.returning = false;

                // Deposit fish
                const tile = world.getTile(this.q, this.r);
                if (tile && tile.playerProperty && tile.playerProperty.type === 'fishing_wharf') {
                    tile.playerProperty.storage = (tile.playerProperty.storage || 0) + (this.inventory['fish'] || 0);
                    this.inventory['fish'] = 0;
                    console.log(`Deposited fish. Storage now: ${tile.playerProperty.storage}`);

                    // Go back out to same spot
                    if (this.fishingSpotQ !== undefined) {
                        this.targetQ = this.fishingSpotQ;
                        this.targetR = this.fishingSpotR;
                        console.log(`Heading back to fishing spot (${this.targetQ},${this.targetR})`);
                    } else {
                        // If we didn't save it, die or idle
                        console.log('No fishing spot saved, destroying boat');
                        this.destroyed = true;
                    }
                } else {
                    // Wharf is gone?
                    console.log('Wharf not found, destroying boat');
                    this.destroyed = true;
                }
            } else {
                // Move multiple times based on speed
                for (let i = 0; i < this.speed; i++) {
                    const currentDist = Hex.wrappingDistance(this.q, this.r, this.targetQ, this.targetR, world.width);
                    if (currentDist <= 0) {
                        // Arrived - will be handled on next update
                        break;
                    }
                    console.log(`Moving towards home (step ${i + 1}/${this.speed})`);
                    this.moveTowardsTarget(world);
                    console.log(`New position: (${this.q},${this.r})`);
                }
            }
        }
    }
}

window.WorldUnit = WorldUnit;

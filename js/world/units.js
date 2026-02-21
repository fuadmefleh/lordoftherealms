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
            case 'lord_party':
                this.icon = '👑';
                this.name = 'Royal Procession';
                this.speed = 3;              // Lords travel slowly with retinue
                this.population = Utils.randInt(30, 60);
                this.strength = Utils.randInt(30, 60);
                this.inventory = {};
                this.kingdomId = null;        // Set after construction
                this.lordName = null;         // Set after construction
                this.daysAtLocation = 0;      // How long they've stayed
                this.stayDuration = 0;        // How long they plan to stay
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
            case 'lord_party':
                this.updateLordParty(world);
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
     * Raider logic: Look for caravans to rob or the player to attack
     */
    updateRaider(world) {
        const currentTile = world.getTile(this.q, this.r);
        const regionId = currentTile ? currentTile.regionId : null;
        const isShip = this.type === 'pirate';

        // --- Check for player in range (priority target) ---
        const player = (typeof game !== 'undefined' && game.player) ? game.player : null;
        if (player && !player.indenturedServitude) {
            const playerDist = Hex.wrappingDistance(this.q, this.r, player.q, player.r, world.width);
            const detectionRange = isShip ? 6 : 5;

            // Only pursue if player is within detection range
            if (playerDist <= detectionRange && playerDist > 0) {
                // Check same region accessibility
                const playerTile = world.getTile(player.q, player.r);
                let canReach = false;

                if (isShip) {
                    // Pirates can reach player if player is on/adjacent to water in same region
                    if (player.boardedShip) {
                        canReach = true; // Player on water, pirates can reach
                    } else {
                        const pNeighbors = Hex.neighbors(player.q, player.r);
                        canReach = pNeighbors.some(n => {
                            const nt = world.getTile(Hex.wrapQ(n.q, world.width), n.r);
                            return nt && nt.regionId === regionId;
                        });
                    }
                } else {
                    canReach = playerTile && playerTile.regionId === regionId;
                }

                if (canReach) {
                    // Chance to decide to pursue (based on strength vs visible player army)
                    const playerArmySize = player.army ? player.army.length : 0;
                    let pursuitChance = 0.35; // Base 35% chance per day

                    // More likely to attack weak/undefended players
                    if (playerArmySize === 0) pursuitChance = 0.7;
                    else if (this.strength > playerArmySize * 3) pursuitChance = 0.55;
                    else if (this.strength < playerArmySize * 2) pursuitChance = 0.15;

                    // Already adjacent? Always engage
                    if (playerDist <= 1) pursuitChance = 1.0;

                    if (Math.random() < pursuitChance) {
                        this.targetQ = player.q;
                        this.targetR = player.r;
                        this.path = [];
                        this._pursuingPlayer = true;
                    }
                }
            }
        }

        // --- Original target logic: hunt caravans/ships ---
        if (!this._pursuingPlayer) {
            const target = world.units.find(u => {
                if (u.type !== 'caravan' && u.type !== 'ship') return false;
                if (Hex.wrappingDistance(this.q, this.r, u.q, u.r, world.width) >= 8) return false;

                const targetTile = world.getTile(u.q, u.r);
                if (!targetTile) return false;

                if (isShip) {
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
        }

        // Clear pursuit flag for next turn
        this._pursuingPlayer = false;

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
            const tile = world.getTile(this.q, this.r);

            // Kingdom pioneer settler — found a proper colony
            if (this.isPioneer && this.kingdomId && typeof Colonization !== 'undefined') {
                Colonization.onKingdomPioneerArrival(this, world);
                this.destroyed = true;
                return;
            }

            // Player pioneer settler — found a player colony
            if (this.isPlayerPioneer && typeof Colonization !== 'undefined') {
                // Player reference from game global
                const player = (typeof game !== 'undefined' && game.player) ? game.player : null;
                Colonization.onPioneerArrival(this, world, player);
                this.destroyed = true;
                return;
            }

            // Default: build neutral village
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
    /**
     * Lord party logic: Travel between owned settlements, stay for a few days
     */
    updateLordParty(world) {
        // Don't age out — lords are permanent until killed or kingdom falls
        this.maxAge = 999999;

        // Check if our kingdom is still alive
        if (this.kingdomId) {
            const kingdom = world.getKingdom(this.kingdomId);
            if (!kingdom || !kingdom.isAlive) {
                this.destroyed = true;
                return;
            }
            // Sync lord name in case of succession
            if (kingdom.lord) {
                this.lordName = kingdom.lord.name;
                this.name = `${this.lordName}'s Procession`;
            }
        }

        // If staying at a location, count down
        if (this.stayDuration > 0) {
            this.daysAtLocation++;
            if (this.daysAtLocation >= this.stayDuration) {
                this.stayDuration = 0;
                this.daysAtLocation = 0;
                // Pick next destination
                this._pickNextLordDestination(world);
            }
            return; // Don't move while staying
        }

        // If arrived at target, stay for a while
        if (this.targetQ !== null && this.q === this.targetQ && this.r === this.targetR) {
            const tile = world.getTile(this.q, this.r);
            if (tile && tile.settlement) {
                this.stayDuration = Utils.randInt(3, 10); // Stay 3-10 days
                this.daysAtLocation = 0;
            } else {
                this._pickNextLordDestination(world);
            }
            return;
        }

        // If no target, pick one
        if (this.targetQ === null) {
            this._pickNextLordDestination(world);
        }

        // Move towards target (slower than patrols)
        for (let i = 0; i < this.speed; i++) {
            if (this.targetQ !== null && this.q === this.targetQ && this.r === this.targetR) break;
            this.moveTowardsTarget(world);
        }
    }

    /**
     * Pick next settlement destination for a lord party
     */
    _pickNextLordDestination(world) {
        if (!this.kingdomId) return;

        const currentTile = world.getTile(this.q, this.r);
        const regionId = currentTile ? currentTile.regionId : null;

        // Get all settlements belonging to this kingdom
        const settlements = world.getAllSettlements().filter(s => {
            if (s.kingdom !== this.kingdomId) return false;
            if (s.q === this.q && s.r === this.r) return false;
            const t = world.getTile(s.q, s.r);
            return t && t.regionId === regionId;
        });

        if (settlements.length > 0) {
            // Prefer capital, then cities, then towns
            const capitals = settlements.filter(s => s.type === 'capital');
            const cities = settlements.filter(s => s.type === 'city' || s.type === 'capital');

            let dest;
            if (capitals.length > 0 && Math.random() < 0.4) {
                dest = Utils.randPick(capitals);
            } else if (cities.length > 0 && Math.random() < 0.5) {
                dest = Utils.randPick(cities);
            } else {
                dest = Utils.randPick(settlements);
            }

            this.targetQ = dest.q;
            this.targetR = dest.r;
            this.path = [];
        } else {
            // No reachable settlements — head home to capital
            const kingdom = world.getKingdom(this.kingdomId);
            if (kingdom && kingdom.capital) {
                this.targetQ = kingdom.capital.q;
                this.targetR = kingdom.capital.r;
                this.path = [];
            }
        }
    }

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

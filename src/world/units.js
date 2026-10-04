// ============================================
// UNITS — Dynamic map entities
// ============================================

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Kingdom } from './kingdom.js';
import { Colonization } from './colonization.js';
import { WEATHER_EFFECTS } from './weather.js';

export class WorldUnit {
    constructor(type, q, r, targetQ = null, targetR = null) {
        this.type = type;
        this.q = q;
        this.r = r;
        this.sourceQ = q;
        this.sourceR = r;
        this.id = Utils.random().toString(36).substr(2, 9);
        this.targetQ = targetQ;
        this.targetR = targetR;
        this.path = [];
        this.destroyed = false;
        this.age = 0;
        const ageRange = WorldUnit.MAX_AGE || WorldUnit.DEFAULT_MAX_AGE;
        this.maxAge = Utils.randInt(ageRange.min, ageRange.max);

        // Stats come from the unit template (data/units.json `unitTypes`,
        // falling back to the built-in DEFAULT_TYPES when data is missing).
        const def = WorldUnit.getTemplate(type);
        const fallback = WorldUnit.DEFAULTS || WorldUnit.DEFAULT_UNIT;
        const roll = (v) => (v && typeof v === 'object') ? Utils.randInt(v.min, v.max) : (v || 1);
        this.icon = def ? def.icon : fallback.icon;
        this.name = def ? def.name : fallback.name;
        this.speed = def ? def.speed : fallback.speed;
        this.population = roll(def ? def.population : fallback.population);
        this.strength = roll(def ? def.strength : fallback.strength);
        this.inventory = def && def.inventoryTheme ? this.generateInitialInventory(def.inventoryTheme) : {};
        // Fixed starting cargo (e.g. a settler group's food and tools)
        if (def && def.initialInventory) {
            for (const [item, qty] of Object.entries(def.initialInventory)) {
                this.inventory[item] = (this.inventory[item] || 0) + qty;
            }
        }
        if (def && def.extraFields) Object.assign(this, JSON.parse(JSON.stringify(def.extraFields)));
    }

    /** Unit types from data/units.json, installed by DataLoader. */
    static TYPES = {};

    /** Inventory themes from data/units.json, installed by DataLoader. */
    static THEMES = {};

    /** Stats for an unknown unit type (data/units.json `defaults`), installed by DataLoader. */
    static DEFAULTS = null;

    /** Lifespan range in days (data/units.json `maxAge`), installed by DataLoader. */
    static MAX_AGE = null;

    /** Fallback lifespan, used only when data/units.json has no maxAge. */
    static DEFAULT_MAX_AGE = { min: 50, max: 200 };

    /** Fallback stats for an unknown type, used only when data/units.json has no defaults. */
    static DEFAULT_UNIT = { icon: '❓', name: 'Unknown Unit', speed: 1, population: 1, strength: 1 };

    /**
     * Fallback templates for the core unit types, used only when
     * data/units.json doesn't define them. Same shape as `unitTypes`.
     */
    static DEFAULT_TYPES = {
        caravan: { icon: '🐫', name: 'Trade Caravan', speed: 4, population: { min: 5, max: 15 }, strength: { min: 2, max: 5 }, inventoryTheme: 'trade', domain: 'land' },
        raider: { icon: '🏇', name: 'Raider Band', speed: 6, population: { min: 10, max: 30 }, strength: { min: 8, max: 15 }, inventoryTheme: 'military', domain: 'land' },
        patrol: { icon: '💂', name: 'Kingdom Patrol', speed: 6, population: { min: 15, max: 40 }, strength: { min: 15, max: 25 }, inventoryTheme: null, domain: 'land' },
        settler: { icon: '⛺', name: 'Settler Group', speed: 2, population: { min: 20, max: 50 }, strength: { min: 5, max: 10 }, inventoryTheme: null, initialInventory: { food: 100, tools: 20 }, domain: 'land' },
        ship: { icon: '⛵', name: 'Trading Ship', speed: 8, population: { min: 10, max: 25 }, strength: { min: 5, max: 12 }, inventoryTheme: 'sea_trade', domain: 'sea' },
        pirate: { icon: '🏴‍☠️', name: 'Pirate Ship', speed: 8, population: { min: 15, max: 35 }, strength: { min: 12, max: 20 }, inventoryTheme: 'pirate', domain: 'sea' },
        fishing_boat: { icon: '🛶', name: 'Fishing Boat', speed: 6, population: { min: 2, max: 5 }, strength: 1, inventoryTheme: null, domain: 'sea' },
        lord_party: {
            icon: '👑', name: 'Royal Procession', speed: 3, population: { min: 30, max: 60 }, strength: { min: 30, max: 60 }, inventoryTheme: null, domain: 'land',
            extraFields: { kingdomId: null, lordName: null, daysAtLocation: 0, stayDuration: 0 },
        },
    };

    /**
     * Fallback inventory themes, used only when data/units.json doesn't define them.
     * Keys other than `randomItem` are fixed items.
     */
    static DEFAULT_THEMES = {
        trade: { gold: { min: 50, max: 200 }, randomItem: { choices: ['silk', 'spices', 'tools', 'gems'], quantity: { min: 5, max: 20 } } },
        sea_trade: { gold: { min: 100, max: 500 }, randomItem: { choices: ['fish', 'wine', 'silk', 'spices'], quantity: { min: 10, max: 40 } } },
        military: { gold: { min: 10, max: 50 }, food: { min: 20, max: 60 } },
        pirate: { gold: { min: 50, max: 300 }, rum: { min: 5, max: 15 } },
    };

    /** Template for a unit type: data first, built-in default second. */
    static getTemplate(type) {
        return (WorldUnit.TYPES && WorldUnit.TYPES[type]) || WorldUnit.DEFAULT_TYPES[type] || null;
    }

    /** Inventory theme by id: data first, built-in default second. */
    static getTheme(theme) {
        return (WorldUnit.THEMES && WorldUnit.THEMES[theme]) || WorldUnit.DEFAULT_THEMES[theme] || null;
    }

    /** Units that attack the player when adjacent. */
    static HOSTILE_TYPES = ['raider', 'pirate', 'beast', 'monster', 'war_host'];

    /** Land units that travel between settlements, like caravans. */
    static TRAVELER_TYPES = ['mercenary_band', 'pilgrim_group', 'smuggler', 'refugee', 'diplomatic_envoy'];

    /**
     * Generate initial inventory for unit from a theme:
     * { gold: {min,max}, <item>: {min,max}, randomItem: { choices, quantity } }.
     * Gold rolls first, then the random item, then fixed items in
     * declaration order (matching the original hand-written themes).
     */
    generateInitialInventory(theme) {
        const inv = {};
        const t = WorldUnit.getTheme(theme);
        if (!t) return inv;
        const rollQty = (v) => (v && typeof v === 'object') ? Utils.randInt(v.min, v.max) : v;
        if (t.gold != null) inv['gold'] = rollQty(t.gold);
        if (t.randomItem && t.randomItem.choices && t.randomItem.choices.length) {
            const q = t.randomItem.quantity || { min: 1, max: 1 };
            inv[Utils.randPick(t.randomItem.choices)] = Utils.randInt(q.min, q.max);
        }
        for (const [item, range] of Object.entries(t)) {
            if (item === 'gold' || item === 'randomItem') continue;
            inv[item] = (inv[item] || 0) + rollQty(range);
        }
        return inv;
    }

    /**
     * Update unit logic for the day
     */
    update(world, player = null) {
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
                this.updateRaider(world, player);
                break;
            case 'patrol':
                this.updatePatrol(world);
                break;
            case 'settler':
                this.updateSettler(world, player);
                break;
            case 'fishing_boat':
                this.updateFishingBoat(world);
                break;
            case 'lord_party':
                this.updateLordParty(world);
                break;
            case 'war_fleet':
                this.updateCaravan(world);
                this._sinkNearbyPirates(world);
                break;
            case 'beast':
            case 'monster':
                this.updateRaider(world, player);
                break;
            case 'war_host':
                this.updateWarHost(world);
                break;
            default:
                if (WorldUnit.TRAVELER_TYPES.includes(this.type)) this.updateCaravan(world);
        }
    }

    /** A kingdom's war host marches on a player holding (see systems/realmWars.js,
     *  which resolves the strike on arrival). Encounters may clear its target, so
     *  it re-reads its standing objective every day. */
    updateWarHost(world) {
        if (this.objectiveQ == null) return;
        this.targetQ = this.objectiveQ;
        this.targetR = this.objectiveR;
        for (let i = 0, steps = this.stepsToday(world); i < steps; i++) {
            if (this.q === this.targetQ && this.r === this.targetR) break;
            this.moveTowardsTarget(world);
        }
    }

    /** War fleets sink any pirate ship that comes within a hex. */
    _sinkNearbyPirates(world) {
        for (const u of world.units) {
            if (u.type !== 'pirate' || u.destroyed) continue;
            if (Hex.wrappingDistance(this.q, this.r, u.q, u.r, world.width) <= 1) {
                u.destroyed = true;
                world.events.push({ text: `${this.name} sank a ${u.name}!`, type: 'military' });
            }
        }
    }

    /** What a traveler does on reaching its destination settlement. */
    _onArrive(world) {
        if (this.type !== 'refugee') return;
        const tile = world.getTile(this.q, this.r);
        if (tile && tile.settlement) {
            const settlers = Math.floor(this.population / 2);
            tile.settlement.population += settlers;
            world.events.push({ text: `${settlers} refugees settle in ${tile.settlement.name}.`, type: 'social' });
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
            const isShip = this.type === 'ship' || this.type === 'pirate' || this.type === 'war_fleet';

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
        for (let i = 0, steps = this.stepsToday(world); i < steps; i++) {
            if (this.q === this.targetQ && this.r === this.targetR) break;
            this.moveTowardsTarget(world);
        }

        // Check if arrived at target
        if (this.targetQ !== null && this.targetR !== null &&
            this.q === this.targetQ && this.r === this.targetR) {
            this.arrived = true;
            this._onArrive(world);

            // If not player owned, just disappear (NPC trade specific logic elsewhere?)
            if (!this.playerOwned) {
                this.destroyed = true;
            }
        }

        // Check for raiders nearby
        const raider = world.units.find(u => (u.type === 'raider' || u.type === 'pirate') && Hex.wrappingDistance(this.q, this.r, u.q, u.r, world.width) < 1);
        // Road wardens see off half the robbers on a road-linked journey (player caravans)
        if (raider && !(this.roadLinked && Utils.random() < 0.5)) {
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
    updateRaider(world, player = null) {
        const currentTile = world.getTile(this.q, this.r);
        const regionId = currentTile ? currentTile.regionId : null;
        const isShip = this.type === 'pirate';

        // --- Check for player in range (priority target) ---
        // `player` is injected by the caller (World.processUnits ← Game.endDay);
        // null in headless/test contexts, which skips player pursuit.
        // A player standing in an active Holy Sanctuary is not hunted
        const sanctuary = player && player.sanctuary;
        const inSanctuary = !!(sanctuary && sanctuary.days > 0 &&
            Hex.wrappingDistance(sanctuary.q, sanctuary.r, player.q, player.r, world.width) <= sanctuary.radius);
        if (player && !player.indenturedServitude && !inSanctuary) {
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

                    if (Utils.random() < pursuitChance) {
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
        for (let i = 0, steps = this.stepsToday(world); i < steps; i++) {
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
        for (let i = 0, steps = this.stepsToday(world); i < steps; i++) {
            if (this.targetQ !== null && this.q === this.targetQ && this.r === this.targetR) break;
            this.moveTowardsTarget(world);
        }
    }

    /**
     * Settler logic: Move to a far away spot and build a village
     */
    updateSettler(world, player = null) {
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
        for (let i = 0, steps = this.stepsToday(world); i < steps; i++) {
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
                // `player` is injected by the caller (World.processUnits ← Game.endDay).
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
        for (let i = 0, steps = this.stepsToday(world); i < steps; i++) {
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
            if (capitals.length > 0 && Utils.random() < 0.4) {
                dest = Utils.randPick(capitals);
            } else if (cities.length > 0 && Utils.random() < 0.5) {
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

    /**
     * Hexes this unit can cover today: storms, snow and heat slow marchers
     * (WEATHER_EFFECTS.travelSpeed), and ships heave to in rough seas
     * (seaDanger). Always at least one hex.
     */
    stepsToday(world) {
        const speed = this.speed || 1;
        if (!world || !world.weather) return speed;
        const fx = WEATHER_EFFECTS[world.weather.getWeather(this.q, this.r).type] || {};
        const isWaterUnit = ['ship', 'pirate', 'fishing_boat', 'war_fleet'].includes(this.type);
        const slow = isWaterUnit ? -(fx.seaDanger || 0) * 0.5 : (fx.travelSpeed || 0);
        return slow ? Math.max(1, Math.round(speed * (1 + slow))) : speed;
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
                    for (let i = 0, steps = this.stepsToday(world); i < steps; i++) {
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
                this.inventory['fish'] = (this.inventory['fish'] || 0) + Math.round(Utils.randInt(5, 15) * (this.catchMultiplier || 1));

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
                // The wharf may share its tile with other properties
                const wharf = tile && (tile.playerProperties || [tile.playerProperty])
                    .find(p => p && p.type === 'fishing_wharf');
                if (wharf) {
                    wharf.storage = (wharf.storage || 0) + (this.inventory['fish'] || 0);
                    this.inventory['fish'] = 0;
                    console.log(`Deposited fish. Storage now: ${wharf.storage}`);

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
                for (let i = 0, steps = this.stepsToday(world); i < steps; i++) {
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

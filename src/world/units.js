// ============================================
// UNITS — Dynamic map entities
// ============================================

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Difficulty } from '../core/difficulty.js';
import { Kingdom } from './kingdom.js';
import { Colonization } from './colonization.js';
import { WEATHER_EFFECTS } from './weather.js';
import { Seasons } from './seasons.js';
import { MountainBarriers } from './mountainBarriers.js';
import { TownSiting } from './townSiting.js';
import { Ferries } from './ferries.js';
import { WarStakes } from './warStakes.js';

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
        // (the theme's coin is not coin yet: the world draws it out of the nearest town's
        // purse when the unit takes the road — World.fundUnitCoin — never from nothing)
        if (this.inventory.gold > 0) {
            this._rolledGold = this.inventory.gold;
            // (the pack the roll was put in: a spawner that gives the unit a pack of its own —
            // a lair's band setting out empty, a crown's war chest — leaves no roll to fund.
            // Not saved: a loaded unit's roll is funded as before)
            Object.defineProperty(this, '_rolledInv', { value: this.inventory, enumerable: false, writable: true, configurable: true });
        }
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

    /** Does this unit fall on the player when adjacent? (a hostile type, or a unit out to waylay them: `hostile`) */
    static isHostile(unit) {
        return !!unit && (WorldUnit.HOSTILE_TYPES.includes(unit.type) || unit.hostile === true);
    }

    /**
     * Is (q, r) a haven no hostile band will fall on someone in? A town,
     * city or capital always is (walls, a watch, too many eyes); a village
     * only while a living crown holds it — an independent village, or one
     * whose realm has fallen, is as open as the road.
     */
    /** The road encounters' settings (data/military.json encounters). */
    static _encounterCfg() {
        return (DataLoader.military && DataLoader.military.encounters) || {};
    }

    /** Within the grace after the player's last encounter (player._waylaidDay, set by player/roadEncounters.js)? */
    static playerInGrace(player, day) {
        if (!player || player._waylaidDay == null) return false;
        const grace = Number(WorldUnit._encounterCfg().graceDays);
        return (Number(day) || 0) - player._waylaidDay < (Number.isFinite(grace) ? grace : 2);
    }

    /**
     * The newcomer's calm: how far the roads let a new life be in its first
     * weeks (encounters.newcomer: `spare` at the start, tapering to nothing by
     * `days` days played), less on a harder difficulty (÷ its enemyStrength).
     * 0..1: the share of bands that pass them by, and how much less any sets
     * off after them. Reads only.
     */
    static newcomerCalm(player, day) {
        const c = WorldUnit._encounterCfg().newcomer || {};
        const days = Number.isFinite(Number(c.days)) ? Number(c.days) : 45;
        const spare = Number.isFinite(Number(c.spare)) ? Number(c.spare) : 0.7;
        if (!player || !(days > 0) || !(spare > 0)) return 0;
        const start = player.scenario && Number.isFinite(player.scenario.startDay) ? player.scenario.startDay : 0;
        const played = Math.max(0, (Number(day) || 0) - start);
        if (played >= days) return 0;
        const harder = Math.max(0.5, Difficulty.mult(player, 'enemyStrength'));
        return Math.max(0, Math.min(1, (spare * (1 - played / days)) / harder));
    }

    /**
     * Does this band pass the newcomer by today (newcomerCalm)? Hashed from the
     * band and the day — the same answer all day, and no draw from the dice.
     */
    static passesNewcomer(player, unit, day) {
        const calm = WorldUnit.newcomerCalm(player, day);
        if (!(calm > 0) || !unit) return false;
        let h = 2166136261;
        for (const ch of `${unit.id}|${Math.floor(Number(day) || 0)}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
        return ((h >>> 0) % 10000) / 10000 < calm;
    }

    /**
     * The chance a day that a band in sight of the player sets off after them
     * (encounters.pursuit): eager for a lone traveller with a full purse, much
     * less for a pauper or against a strong escort.
     */
    static pursuitChance(player, unit, day = null) {
        const p = WorldUnit._encounterCfg().pursuit || {};
        const n = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
        const army = player && player.army ? player.army.length : 0;
        const str = n(unit && unit.strength, 0);
        let chance = army === 0 ? n(p.alone, 0.45)
            : str > army * 3 ? n(p.outmatched, 0.4)
                : str < army * 2 ? n(p.evenly, 0.12) : n(p.otherwise, 0.3);
        const goods = Object.entries((player && player.inventory) || {})
            .reduce((sum, [k, v]) => sum + (k === 'quest' ? 0 : Math.max(0, n(v, 0))), 0);
        if (n(player && player.gold, 0) < n(p.poorGold, 40) && goods < n(p.poorGoods, 6)) chance *= n(p.poorMult, 0.5);
        // A party riding in a crown's livery (a realm's household guard: player/realmEscort.js) is let be
        if (player && (player.army || []).some(u => u && u.realmGuard != null)) chance *= n(p.escortMult, 0.6);
        // A new life's first weeks are calmer (newcomerCalm)
        if (day != null) chance *= 1 - WorldUnit.newcomerCalm(player, day);
        return chance;
    }

    static isSafeHaven(world, q, r) {
        const tile = world && world.getTile ? world.getTile(q, r) : null;
        const s = tile && tile.settlement;
        if (!s) return false;
        if (s.type !== 'village') return true;
        const kid = s.kingdom || null;
        if (!kid) return false;
        const kingdom = world.getKingdom ? world.getKingdom(kid) : null;
        return !!(kingdom && kingdom.isAlive !== false);
    }

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
            case 'clan':
                // A wandering clan of the Dawn of Man: world/dawn.js moves
                // it and settles it (Dawn.processDay)
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
            case 'relief_host': // a realm marching to relieve a town the player besieges (systems/sieges.js)
            case 'peasant_host': // the commons risen against their lord (systems/peasantRevolts.js)
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
        let steps = this.stepsToday(world);
        // Still getting across a great river (rafts, the horses swum over): that eats the march first
        if (this._riverDebt > 0) {
            const pay = Math.min(steps, this._riverDebt);
            this._riverDebt -= pay;
            steps -= pay;
        }
        this.marchToward(world, steps);
    }

    /**
     * A day's march toward the target that pays the ground (world/mountainBarriers.js):
     * each hex costs its march cost out of the day's speed (stepsToday), a hex
     * dearer than what is left is climbed over several days (the rest carried in
     * _marchCarry). A unit that plans its march (pathTypes: the hosts) goes the
     * cheapest way, so it takes a pass through a range; the rest go straight.
     * A unit of a type that pays nothing walks as moveTowardsTarget always did.
     */
    marchToward(world, steps = this.stepsToday(world)) {
        if (!MountainBarriers.paysMarch(this.type)) {
            for (let i = 0; i < steps; i++) {
                if (this.q === this.targetQ && this.r === this.targetR) break;
                this.moveTowardsTarget(world);
            }
            return;
        }
        const EPS = 1e-9;
        const day = world && Number.isFinite(world.day) ? world.day : null;
        const plans = MountainBarriers.plansMarch(this.type);
        let budget = steps + (Number(this._marchCarry) || 0);
        this._marchCarry = 0;
        for (let guard = 0; guard < 64; guard++) {
            if (this.targetQ == null || (this.q === this.targetQ && this.r === this.targetR)) return;
            const next = (plans && this._plannedStep(world, day)) || this._greedyStep(world);
            if (!next) {
                this.age += 5; // Age faster if stuck (as moveTowardsTarget)
                return;
            }
            const cost = MountainBarriers.marchCost(world.getTile(next.q, next.r), day);
            if (!Number.isFinite(cost)) return;
            if (cost > budget + EPS) {
                // Camped on the climb: the day's march goes into the hex
                this._marchCarry = budget;
                return;
            }
            budget -= cost;
            const fq = this.q, fr = this.r;
            this.q = next.q;
            this.r = next.r;
            // A war host crossing a great river with no bridge, road, town or ford loses
            // hexes of its march (world/rivers.js); what the day can't pay is carried
            if (this.type === 'war_host') {
                // (a ferry near a town carries it over quicker: world/ferries.js)
                const cx = Ferries.crossExtra(world, fq, fr, this.q, this.r, 'army');
                const x = cx > 0 ? Math.max(1, Math.round(cx)) : 0;
                if (x > 0) {
                    const pay = Math.min(Math.max(0, Math.floor(budget + EPS)), x);
                    budget -= pay;
                    this._riverDebt = (this._riverDebt || 0) + x - pay;
                    this._riverCrossings = (this._riverCrossings || 0) + 1;
                }
            }
        }
    }

    /**
     * The next hex of the cheapest way to the target by march cost (Hex.findPath),
     * kept while the target and winter's grip hold; null when there is none (too
     * far, or no way), and the unit goes straight instead.
     */
    _plannedStep(world, day) {
        const key = `${this.targetQ},${this.targetR}|${MountainBarriers.winterPhase(day) || ''}`;
        let plan = this._marchPlan;
        if (!plan || plan.key !== key) {
            const path = Hex.findPath(this.q, this.r, this.targetQ, this.targetR, world.width, world.height,
                (q, r) => { const t = world.getTile(q, r); return !!(t && t.terrain && t.terrain.passable); },
                (q, r) => MountainBarriers.marchCost(world.getTile(q, r), day));
            plan = { key, path: path || null, i: 0 };
            // (not saved with the unit: planned afresh after a load)
            Object.defineProperty(this, '_marchPlan', { value: plan, enumerable: false, writable: true, configurable: true });
        }
        const P = plan.path;
        if (!P) return null;
        // Find where the unit stands on the plan (it may have been pushed off it)
        while (plan.i < P.length && !(P[plan.i].q === this.q && P[plan.i].r === this.r)) plan.i++;
        if (plan.i >= P.length - 1) {
            plan.key = null; // off the plan, or at its end: plan again next time
            return null;
        }
        return P[plan.i + 1];
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

            const settlements = (world.getSettlementViews ? world.getSettlementViews() : world.getAllSettlements()); // read-only
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

        // Move multiple times based on speed (overland, a caravan pays the mountains: marchToward)
        this.marchToward(world);

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
        const raider = world.units.find(u => (u.type === 'raider' || u.type === 'pirate') && Hex.wrappingDistance(this.q, this.r, u.q, u.r, world.width) < 1
            && !(this.playerOwned && u.sparesPlayer)); // a lair paid off leaves the player's caravans be
        // Road wardens see off half the robbers on a road-linked journey (player caravans)
        if (raider && !(this.roadLinked && Utils.random() < 0.5)) {
            // Transfer caravan's inventory to the raider — its coin once: a trade caravan's
            // inventory.gold mirrors its purse (the census counts the purse), so the purse goes
            const coin = typeof this.purse === 'number' ? Math.max(0, this.purse) : Math.max(0, Number(this.inventory.gold) || 0);
            for (const [item, amount] of Object.entries(this.inventory)) {
                if (item === 'gold') continue;
                raider.inventory[item] = (raider.inventory[item] || 0) + amount;
            }
            if (coin > 0) {
                if (typeof raider.purse === 'number') raider.purse += coin;
                else raider.inventory.gold = (Number(raider.inventory.gold) || 0) + coin;
            }
            // (taken, not copied: the robbed carry nothing more)
            this.inventory = {};
            if (typeof this.purse === 'number') this.purse = 0;
            world.events.push({ text: `${this.name} was robbed by ${raider.name}!`, type: 'economic' });
            this.destroyed = true;
        }
    }

    /**
     * Raiders and pirates near the player's stakes (world/warStakes.js; the
     * captives impaled, player/prisonerFates.js): a band within the stakes'
     * deterRadius may turn away (stakeTurnBack × how fresh, impaled outlaws
     * weigh stakeOutlawMult more), riding off away from the posts for
     * stakeShunDays — it hunts neither the player nor the caravans meanwhile.
     * A hash roll (no shared dice); no stakes, no cost. → true while it shuns.
     */
    _shunStakes(world) {
        if (!world) return false;
        const day = Number(world.day) || 0;
        if (this.shunUntil != null && day < this.shunUntil && this.shunQ != null) {
            this.targetQ = this.shunQ;
            this.targetR = this.shunR;
            return true;
        }
        const gd = DataLoader._gamedata && DataLoader._gamedata.prisonerFates;
        const I = (gd && gd.impale) || {};
        const U = (gd && gd.outlaws) || {};
        const radius = Number(I.deterRadius) || 6;
        const near = WarStakes.dreadNear(world, this.q, this.r, radius, { outlawMult: Number(U.stakeOutlawMult) || 1.5 });
        if (!near) return false;
        const p = (Number(U.stakeTurnBack) || 0.6) * near.fresh;
        const seed = (world.generationParams && world.generationParams.seed) || 0;
        const roll = ((Utils.hashStr(`${seed}|stakes|${this.id}|${day}`) >>> 0) % 100000) / 100000;
        if (roll >= p) return false;
        // Away from the posts, past the reach of them
        const w = world.width || 0;
        let dq = this.q - near.q;
        if (w && dq > w / 2) dq -= w;
        if (w && dq < -w / 2) dq += w;
        let dr = this.r - near.r;
        if (!dq && !dr) dq = 1;
        const scale = (radius + 3) / Math.max(1, Math.max(Math.abs(dq), Math.abs(dr)));
        const tq = Math.round(this.q + dq * scale);
        const tr = Math.max(0, Math.min((world.height || 1e9) - 1, Math.round(this.r + dr * scale)));
        this.shunQ = w ? Hex.wrapQ(tq, w) : tq;
        this.shunR = tr;
        this.shunUntil = day + (Number(U.stakeShunDays) || 5);
        this.stakesTurned = (Number(this.stakesTurned) || 0) + 1;
        this.targetQ = this.shunQ;
        this.targetR = this.shunR;
        this.path = [];
        return true;
    }

    /**
     * Raider logic: Look for caravans to rob or the player to attack
     */
    updateRaider(world, player = null) {
        const currentTile = world.getTile(this.q, this.r);
        const regionId = currentTile ? currentTile.regionId : null;
        const isShip = this.type === 'pirate';
        // A forest of the player's stakes in reach (world/warStakes.js): the band turns away from it today
        const shun = (this.type === 'raider' || this.type === 'pirate') && this._shunStakes(world);

        // --- Check for player in range (priority target) ---
        // `player` is injected by the caller (World.processUnits ← Game.endDay);
        // null in headless/test contexts, which skips player pursuit.
        // A player standing in an active Holy Sanctuary is not hunted
        const sanctuary = player && player.sanctuary;
        const inSanctuary = !!(sanctuary && sanctuary.days > 0 &&
            Hex.wrappingDistance(sanctuary.q, sanctuary.r, player.q, player.r, world.width) <= sanctuary.radius);
        // A lair's riders keep a bargain struck with the player (systems/outlawLairs.js)
        // and one the player paid off, talked down or drove away leaves them be a while (player/roadEncounters.js)
        const sparing = this.sparedUntilDay != null && (world.day || 0) < this.sparedUntilDay;
        // Nor one inside a town, or a village under a crown's protection
        const inHaven = !!player && WorldUnit.isSafeHaven(world, player.q, player.r);
        if (!shun && player && !player.indenturedServitude && !inSanctuary && !inHaven && !this.sparesPlayer && !sparing) {
            const playerDist = Hex.wrappingDistance(this.q, this.r, player.q, player.r, world.width);
            // A lair's raiding party bound for a town only waylays travellers on its path (pursuitRange)
            const detectionRange = Number.isFinite(this.pursuitRange) ? this.pursuitRange : (isShip ? 6 : 5);

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

                // Just waylaid: the road leaves them be a day or two (data/military.json encounters.graceDays)
                if (canReach && WorldUnit.playerInGrace(player, world.day)) canReach = false;
                if (canReach) {
                    // Chance to decide to pursue (by strength against the player's army, and what they carry)
                    let pursuitChance = WorldUnit.pursuitChance(player, this, world.day);

                    // Already adjacent? Always engage (unless it passes a newcomer by today)
                    if (playerDist <= 1) pursuitChance = WorldUnit.passesNewcomer(player, this, world.day) ? 0 : 1.0;

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
        if (!shun && !this._pursuingPlayer) {
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
        // Saga creatures and companies (systems/sagas.js) are beyond a patrol
        if (patrol && !this.sagaKey) {
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

            const settlements = (world.getSettlementViews ? world.getSettlementViews() : world.getAllSettlements()); // read-only
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
        // A founding party walks its surveyed route (world/villageFounding.js via Colonization)
        if (this.expedition && typeof Colonization !== 'undefined') {
            Colonization.expeditionDay(this, world, player);
            return;
        }
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
                    const settlements = (world.getSettlementViews ? world.getSettlementViews() : world.getAllSettlements()); // read-only
                    const dist = settlements.reduce((min, s) => Math.min(min, Hex.wrappingDistance(q, r, s.q, s.r, world.width)), Infinity);
                    if (dist > 6) {
                        this.targetQ = q;
                        this.targetR = r;
                        // Since terrainGen 16: the best site near the spot drawn, where a
                        // town would grow (world/townSiting.js), by the same rules; no dice
                        if (TownSiting.forWorld(world)) {
                            const F = TownSiting.founded('settler');
                            const far = (t) => settlements.every(s => Hex.wrappingDistance(t.q, t.r, s.q, s.r, world.width) > 6);
                            const pick = TownSiting.bestNear(world, q, r, Number.isFinite(F.radius) ? F.radius : 3,
                                (t) => t.terrain.passable && !t.settlement && t.regionId === regionId && far(t),
                                { distWeight: Number.isFinite(F.distWeight) ? F.distWeight : 0.3, kind: 'village' });
                            if (pick) { this.targetQ = pick.q; this.targetR = pick.r; }
                        }
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
                const name = Kingdom.generateCityName(Utils.randPick(['Imperial', 'Woodland', 'Nomadic', 'Religious', 'Maritime']), world);
                tile.settlement = {
                    type: 'village',
                    name: name,
                    population: Utils.randInt(50, 150),
                    level: 0,
                    kingdom: null,
                };
                // (a new village has no coin it wasn't given — world/barter.js, Economy.townPurse —
                // in any world: its starting purse would be coin from nothing)
                tile.settlement.freshPurse = true;
                if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
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

        // Move towards target (slower than patrols; the mountains slow it: marchToward)
        this.marchToward(world);
    }

    /**
     * Pick next settlement destination for a lord party
     */
    _pickNextLordDestination(world) {
        if (!this.kingdomId) return;

        const currentTile = world.getTile(this.q, this.r);
        const regionId = currentTile ? currentTile.regionId : null;

        // Get all settlements belonging to this kingdom
        const settlements = (world.getSettlementViews ? world.getSettlementViews() : world.getAllSettlements()).filter(s => { // read-only
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
        const best = this._greedyStep(world, dist);
        if (best) {
            this.q = best.q;
            this.r = best.r;
        } else {
            // Stuck? 
            this.age += 5; // Age faster if stuck
        }
    }

    /** The neighbour that brings the unit nearest its target (the straight way), or null. */
    _greedyStep(world, dist = Hex.wrappingDistance(this.q, this.r, this.targetQ, this.targetR, world.width)) {
        if (dist === 0) return null;

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
        return best;
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
                // Shoals run thick in summer and thin in winter (world/seasons.js)
                this.inventory['fish'] = (this.inventory['fish'] || 0) + Math.round(Utils.randInt(5, 15) * (this.catchMultiplier || 1)
                    * Seasons.productionMultiplier('fishing', Seasons.today(world)));

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

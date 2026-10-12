// ============================================
// PLAYER CORE — State Initialization & World Placement
// The Player class definition with constructor and initial world placement.
// Methods are mixed in from movement.js, needs.js, and lifecycle.js via index.js.
// ============================================

import { Hex } from '../../core/hex.js';
import { Utils } from '../../core/utils.js';

export class Player {
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
        this.mount = null;          // Riding horse { name, price, acquiredDay } — see settlementServices.js

        // Reputation per kingdom
        this.reputation = {};

        // Kingdom allegiance
        this.allegiance = null;      // Kingdom ID the player is pledged to
        this.kingdomTitle = null;    // Title within kingdom (e.g., 'king', 'treasurer', 'lord')

        // Dynasty & Relationships
        // Prestige lives on the House (player.house.prestige, systems/house.js)
        this.dynasty = {
            name: (profile.name || 'Wanderer') + 'son',
            founded: 1,
        };
        this.spouse = null;            // Relationship NPC id of spouse
        this.children = [];            // Array of child objects
        this.relationships = {};       // { npcId: { score, romantic, affection, history[] } }
        this.heir = null;              // Child id designated as heir
        this.travelParty = [];         // Relationship NPC ids currently traveling with player
        this.maxLifespan = 55 + Math.floor(Utils.random() * 31); // 55-85
        this.birthDay = 0;
        this.marriageDay = null;

        // The House — persistent dynasty entity (systems/house.js).
        // Populated by House.initialize() during game setup; null until then.
        this.house = null;

        // Visuals
        this.color = '#ffffff';
        this.icon = '👤';

        // Starvation tracking
        this.starvationDays = 0; // Consecutive days without food

        // ── Sims-style Needs (0–100 each) ────────────────
        this.needs = {
            hunger:  100,   // Eating food → restored at taverns, inns, consuming bread
            energy:  100,   // Sleeping → resting at inns, hours of day
            social:  100,   // Talking to NPCs, visiting taverns, relationships
            fun:     100,   // Entertainment → tavern, festivals, exploring
            hygiene: 100,   // Bathing → visiting bathhouses, rivers, or rain
            comfort: 100,   // Good shelter → being indoors, nice housing, sitting
        };
        this._needWarnings = {};  // Track which low-need warnings have fired today
        this._lastNeedDecayHour = 8; // Track inner-map hour for smooth decay
        this._needHoursToday = 0;    // Inner-map hours already decayed today

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
        // Today's running tally (systems/ledger.js): open from the first day, so
        // flows written before the first close aren't lost
        this.financeToday = { income: {}, expenses: {} };
    }

    /**
     * Place player in the world at a reasonable starting location
     */
    placeInWorld(world) {
        // Find a good starting location — preferably a village or unclaimed territory
        let bestTile = null;

        // A hand-made map may say where the player begins (world_editor.html)
        const start = world.playerStart;
        if (start && world.tiles[start.r] && world.tiles[start.r][start.q] && world.tiles[start.r][start.q].terrain.passable) {
            bestTile = { q: start.q, r: start.r };
        }

        // Try to start near an independent village
        for (let r = 0; !bestTile && r < world.height; r++) {
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
     * Food types that can sustain travel (best consumed first for efficiency)
     */
    // Proper rations first; wild foods (foraged or hunted) are eaten last
    static FOOD_TYPES = ['cooked_meat', 'cooked_fish', 'bread', 'preserved_fish', 'fish', 'grain', 'food',
        'fruit', 'honey', 'game_meat', 'crabs', 'berries', 'mushrooms', 'truffles', 'cactus_fruit', 'seaweed'];

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
}

// ============================================
// SAVE/LOAD — Game state persistence
// ============================================

import { Characters } from '../world/characters.js';
import { House } from './house.js';
import { Titles } from './titles.js';
import { Espionage } from './espionage.js';
import { Festivals } from './festivals.js';
import { Councils } from './councils.js';
import { BountyHunting } from './bountyHunting.js';
import { Gossip } from './gossip.js';
import { Ships } from './ships.js';
import { Traits } from './traits.js';
import { Upbringing } from './upbringing.js';
import { Legacy } from './legacy.js';
import { Petitions } from './petitions.js';
import { Companions } from './companions.js';
import { Delves } from './delves.js';
import { Ailments } from './ailments.js';
import { Underworld } from './underworld.js';
import { Throne } from './throne.js';
import { Kingship } from './kingship.js';
import { Holdings } from './holdings.js';
import { Rivals } from './rivals.js';
import { Sagas } from './sagas.js';
import { Sieges } from './sieges.js';
import { HoldingSieges } from './holdingSieges.js';
import { Discovery } from './discovery.js';
import { MerchantHouses } from './merchantHouses.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { WorldUnit } from '../world/units.js';
import { Terrain } from '../world/terrain.js';
import { MarketDynamics } from './marketDynamics.js';
import { Utils } from '../core/utils.js';


export const SaveLoad = {
    SAVE_KEY: 'lord_of_realms_save',
    AUTO_SAVE_INTERVAL: 5, // Auto-save every 5 days

    /**
     * Save game state to localStorage
     */
    saveGame(game) {
        try {
            const saveData = {
                version: '1.0',
                timestamp: Date.now(),
                world: SaveLoad.serializeWorld(game.world),
                player: SaveLoad.serializePlayer(game.player),
                notificationLog: game.ui ? game.ui.notificationLog.slice(-200) : [],
            };

            const json = JSON.stringify(saveData);
            localStorage.setItem(SaveLoad.SAVE_KEY, json);

            return { success: true, timestamp: saveData.timestamp };
        } catch (error) {
            console.error('Failed to save game:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Load game state from localStorage
     */
    loadGame() {
        try {
            const json = localStorage.getItem(SaveLoad.SAVE_KEY);
            if (!json) {
                return { success: false, error: 'No save data found' };
            }

            const saveData = JSON.parse(json);

            return {
                success: true,
                data: saveData,
                timestamp: saveData.timestamp,
            };
        } catch (error) {
            console.error('Failed to load game:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Check if save exists
     */
    hasSave() {
        return localStorage.getItem(SaveLoad.SAVE_KEY) !== null;
    },

    /**
     * Delete save
     */
    deleteSave() {
        localStorage.removeItem(SaveLoad.SAVE_KEY);
    },

    /**
     * Serialize world state
     */
    serializeWorld(world) {
        return {
            width: world.width,
            height: world.height,
            day: world.day,
            season: world.season,
            year: world.year,
            tiles: SaveLoad.serializeTiles(world.tiles),
            kingdoms: SaveLoad.serializeKingdoms(world.kingdoms),
            events: world.events,
            activeEvents: world.activeEvents || [],
            warHistory: world.warHistory || [],
            warHistorySeq: world.warHistorySeq || 0,
            weather: world.weather && world.weather.serialize ? world.weather.serialize() : null,
            // Terrain is regenerated on load, not saved: the seed and settings
            // reproduce it (see World.generate)
            generationParams: world.generationParams || null,
            // Raiders, caravans (the player's among them), lord processions,
            // pirates, delve guardians, war hosts, settlers, fishing boats...
            // as they stand — older saves regenerate them
            units: SaveLoad.serializeUnits(world.units),
            // Regional market supply, demand, prices and price history
            markets: MarketDynamics.regionalMarkets || {},
            // Ids for characters, maps, spies, ... keep counting from here
            idCounter: Utils.getIdCounter(),
        };
    },

    /** World units as plain data (each WorldUnit's own fields). */
    serializeUnits(units) {
        if (!Array.isArray(units)) return [];
        return units.filter(u => u && typeof u === 'object').map(u => ({ ...u }));
    },

    /** WorldUnits back from saved data — no constructor, so no RNG draws. */
    restoreUnits(saved) {
        return saved.filter(u => u && typeof u === 'object' && u.type)
            .map(u => Object.assign(Object.create(WorldUnit.prototype), u));
    },

    /**
     * Serialize tiles (only save explored tiles and settlements)
     */
    serializeTiles(tiles) {
        const serialized = [];

        for (let r = 0; r < tiles.length; r++) {
            const row = [];
            for (let q = 0; q < tiles[r].length; q++) {
                const tile = tiles[r][q];
                row.push({
                    explored: tile.explored,
                    kingdom: tile.kingdom,
                    settlement: tile.settlement,
                    improvement: tile.improvement,
                    infrastructure: tile.infrastructure || null,
                    playerProperties: tile.playerProperties || null,
                    playerProperty: tile.playerProperty || null,
                    indigenous: tile.indigenous || null,
                    // Who holds a holy site, its pilgrims and level change in play
                    ...(tile.holySite ? { holySite: tile.holySite } : {}),
                    // The player's temples, shrines and cultural buildings
                    ...(tile.religiousBuilding ? { religiousBuilding: tile.religiousBuilding } : {}),
                    ...(tile.culturalBuilding ? { culturalBuilding: tile.culturalBuilding } : {}),
                    // Land the player cleared or levelled (regeneration would undo it)
                    ...(tile.terraformed ? {
                        terraformed: { terrain: tile.terrain && tile.terrain.id, resource: tile.resource || null, elevation: tile.elevation },
                    } : {}),
                    // Terrain is regenerated, not saved
                });
            }
            serialized.push(row);
        }

        return serialized;
    },

    /**
     * Serialize kingdoms
     */
    serializeKingdoms(kingdoms) {
        return kingdoms.map(k => ({
            id: k.id,
            name: k.name,
            ruler: k.ruler,
            culture: k.culture,
            color: k.color,
            description: k.description,
            isAlive: k.isAlive,
            capital: k.capital,
            settlements: k.settlements,
            territory: k.territory,
            population: k.population,
            military: k.military,
            treasury: k.treasury,
            treasuryIncomeBase: k.treasuryIncomeBase,
            stability: k.stability,
            relations: k.relations,
            wars: k.wars,
            allies: k.allies,
            // War lifecycle (goals, truces) and persistent armies
            warState: k.warState || {},
            truces: k.truces || {},
            militaryCap: k.militaryCap,
            _militaryInit: !!k._militaryInit,
            conqueredBy: k.conqueredBy || null,
            conqueredDay: k.conqueredDay != null ? k.conqueredDay : null,
            lord: k.lord,
            temples: k.temples || [], // funded by pious lords (KingdomAI.fundTemple)
            characterData: typeof Characters !== 'undefined' ? Characters.serialize(k) : (k.characterData || null),
            colonization: k.colonization || null,
            cartography: k.cartography || null,
            navy: k.navy || null, // royal fleet and blockades (KingdomNavy)
            // Claims & Crowns (systems/throne.js): the crown's policies and the
            // last succession; a player-founded realm keeps its identity
            crown: k.crown || null,
            lastSuccession: k.lastSuccession || null,
            createdByPlayer: !!k.createdByPlayer,
            traits: k.traits || [],
            // State that evolves in play (piety, heresies, cultural influence,
            // peoples, stores) — regeneration would reset it to day one
            ...SaveLoad._pickDefined(k, ['religion', 'cultureData', 'peoples', 'food', 'goods',
                // Recomputed during the day, but read before that on the first day after a load
                'characterBonuses', 'lordModifiers', 'playerFaith']),
            ...(k.createdByPlayer ? {
                foundedDay: k.foundedDay,
                colorLight: k.colorLight,
                preferredTerrain: k.preferredTerrain,
                religion: k.religion || null,
            } : {}),
        }));
    },

    /**
     * Player fields the game reads back that the explicit list below used to
     * drop — trained attributes reset to 5, debts vanished, mercenary
     * contracts, map deceptions, the marriage alliance and tax policy were
     * forgotten on load. Saved only when present, so old saves load as before.
     */
    EXTRA_PLAYER_FIELDS: [
        'charisma', 'intelligence', 'faith', 'maxInventory',
        'loans', 'taxRate', 'activeContract',
        'mapDeceptions', 'marriageAllianceKingdom', 'cultureIncomeCarry',
        'foragingTrips', 'huntingTrips', 'jobsCompleted', 'performancesGiven',
        'plantingContracts', 'voyageStats',
        // "Pretender to X", "Exile", an office's title — a fresh Player says "Nobody"
        'title',
    ],

    _pickDefined(obj, keys) {
        const out = {};
        for (const k of keys) {
            if (obj[k] !== undefined) out[k] = obj[k];
        }
        return out;
    },

    /**
     * Serialize player state
     */
    serializePlayer(player) {
        return {
            ...SaveLoad._pickDefined(player, SaveLoad.EXTRA_PLAYER_FIELDS),
            q: player.q,
            r: player.r,
            gold: player.gold,
            karma: player.karma,
            renown: player.renown,
            health: player.health,
            maxHealth: player.maxHealth,
            stamina: player.stamina,
            maxStamina: player.maxStamina,
            actionPoints: player.actionPoints != null ? player.actionPoints : 10,
            maxActionPoints: player.maxActionPoints || 10,
            movementRemaining: player.movementRemaining,
            attributes: player.attributes,
            skills: player.skills,
            reputation: player.reputation,
            properties: player.properties,
            infrastructureUnderConstruction: player.infrastructureUnderConstruction || [],
            caravans: player.caravans,
            tradeRoutes: player.tradeRoutes || [],
            smugglingRoutes: player.smugglingRoutes || [],
            auctions: player.auctions || { active: [], won: [], nextRefreshDay: 1, nextId: 1, lastProcessedDay: 0 },
            army: player.army,
            mercenaryCompanies: player.mercenaryCompanies || [],
            contract: player.contract,
            religion: player.religion,
            blessings: player.blessings,
            technology: player.technology || null,
            quests: SaveLoad.serializeQuests(player.quests),
            achievements: player.achievements,
            miraclesPerformed: player.miraclesPerformed,
            visitedTaverns: player.visitedTaverns || [],
            kingdomsVisited: player.kingdomsVisited || [],
            intel: player.intel || null,
            soulSoldCount: player.soulSoldCount || 0,
            lastSoulSoldDay: player.lastSoulSoldDay || 0,
            indenturedServitude: player.indenturedServitude || null,
            jailState: player.jailState || null,
            criminalRecord: player.criminalRecord || { pickpocket: 0, smuggling: 0 },
            sanctuary: player.sanctuary || null,
            fallenUnits: player.fallenUnits || [],
            mount: player.mount || null,
            tradeAgreements: player.tradeAgreements || {},
            inventory: player.inventory || {},
            landTaxBonus: player.landTaxBonus || 0,
            starvationDays: player.starvationDays || 0,
            allegiance: player.allegiance || null,
            kingdomTitle: player.kingdomTitle || null,
            currentTitle: player.currentTitle || null,
            titleProgress: (typeof Titles !== 'undefined') ? Titles.serializeProgress(player.titleProgress) : (player.titleProgress || {}),
            titleHistory: player.titleHistory || [],
            activeFugitive: player.activeFugitive || null,
            activeBounties: player.activeBounties || [],
            bountiesCompleted: player.bountiesCompleted || 0,
            bountyHunter: player.bountyHunter || {
                rank: 1,
                capturesTurnedIn: 0,
                capturesRecruited: 0,
                failedCaptures: 0,
                nextTargetId: 1,
                boardRefreshDay: 0,
                boardSettlementKey: '',
                boardOffers: [],
            },
            titleDutyDeadline: player.titleDutyDeadline || 0,
            titleAppointedDay: player.titleAppointedDay || 0,
            _dutyFailures: player._dutyFailures || 0,
            luck: player.luck,
            strength: player.strength,
            financeHistory: player.financeHistory || [],
            financeToday: player.financeToday || null,
            colonies: player.colonies || [],
            maps: player.maps || [],
            artifacts: player.artifacts || { fragments: {}, forged: [], discovered: [] },
            discoveredLore: Array.from(player.discoveredLore || []),
            peoplesHeritage: player.peoplesHeritage || {},
            discoveredHolySites: Array.from(player.discoveredHolySites || []),
            discoveredExtinctFaiths: Array.from(player.discoveredExtinctFaiths || []),
            kingdomKnowledge: player.kingdomKnowledge || {},
            queuedPath: player.queuedPath || null,
            queuedPathIndex: player.queuedPathIndex || 0,
            travelDestination: player.travelDestination || null,

            // Dynasty & Relationships
            dynasty: player.dynasty || null,
            spouse: player.spouse || null,
            children: player.children || [],
            relationships: player.relationships || {},
            travelParty: player.travelParty || [],
            heir: player.heir || null,
            house: (typeof House !== 'undefined') ? House.serialize(player.house) : (player.house || null),
            realmWars: player.realmWars ? JSON.parse(JSON.stringify(player.realmWars)) : null,
            politics: player.politics ? JSON.parse(JSON.stringify(player.politics)) : null,
            maxLifespan: player.maxLifespan || 70,
            birthDay: player.birthDay || 0,
            marriageDay: player.marriageDay || null,
            age: player.age || 20,
            gender: player.gender || 'male',
            name: player.name || 'Wanderer',
            firstName: player.firstName || 'Wanderer',
            lastName: player.lastName || '',
            _relationshipNpcs: player._relationshipNpcs || [],

            _relationshipNextId: player._relationshipNextId || 1,

            // Housing & Ships
            houses: player.houses || [],
            ships: player.ships || [],
            boardedShip: player.boardedShip || null,

            // Needs (Sims-style)
            needs: player.needs || { hunger: 100, energy: 100, social: 100, fun: 100, hygiene: 100, comfort: 100 },
            _lastNeedDecayHour: player._lastNeedDecayHour || 8,
            _needHoursToday: player._needHoursToday || 0,
            needsEnabled: player.needsEnabled !== false,

            // Espionage
            espionage: player.espionage || null,

            // Festivals
            festivals: player.festivals || null,

            // Councils & parliament
            council: player.council || null,

            // Gossip / Rumors
            gossip: player.gossip || null,

            // Earned character traits
            traits: Traits.serialize(player),
            // The underworld: heat per realm, guild rank, hot goods, rackets, heist plans
            underworld: Underworld.serialize(player),
            // Court petitions (pending, follow-ups, rulings history, court reputation)
            petitions: player.petitions ? JSON.parse(JSON.stringify(player.petitions)) : null,
            // Travelling companions: deed snapshot, bonds, mourning, notices (per-companion
            // personality/approval lives on the NPC in _relationshipNpcs)
            companions: Companions.serialize(player),
            // Delves (an in-progress delve, delved sites, injuries, awakened guardians)
            delves: Delves.serialize(player),
            // Wounds and sickness, sick companions and crews (systems/ailments.js)
            ailments: Ailments.serialize(player),
            // Claims, crises, a civil war, a crown (systems/throne.js)
            throne: Throne.serialize(player),
            // Holdings ledger (per-settlement development is saved with the tiles)
            holdings: Holdings.serialize(player),
            // Rival adventurers: the cast, their attitude/memory, news, partner, race (systems/rivals.js)
            rivals: Rivals.serialize(player),
            // Sagas: running and concluded storylines, what the player heard (systems/sagas.js)
            sagas: Sagas.serialize(player),
            // A siege in progress, tribute owed, past sieges (systems/sieges.js)
            sieges: Sieges.serialize(player),
            // Uncharted lands: the hidden places, who found them, claims (systems/discovery.js)
            discovery: Discovery.serialize(player),
            // The trading company, charters, rival merchant houses, contracts, ventures (systems/merchantHouses.js)
            merchant: MerchantHouses.serialize(player),
        };
    },

    /**
     * Serialize quests (convert Set to Array)
     */
    serializeQuests(quests) {
        if (!quests) return null;

        return {
            active: quests.active,
            completed: quests.completed,
            available: quests.available,
            caravansCompleted: quests.caravansCompleted,
            contractsCompleted: quests.contractsCompleted,
            templesBuilt: quests.templesBuilt,
            settlementsVisited: Array.from(quests.settlementsVisited || []),
            stats: quests.stats || {},
        };
    },

    /**
     * Restore world from save data
     */
    restoreWorld(saveData, world) {
        world.day = saveData.day;
        world.season = saveData.season;
        world.year = saveData.year;
        world.events = saveData.events || [];
        world.activeEvents = saveData.activeEvents || [];
        world.warHistory = saveData.warHistory || [];
        world.warHistorySeq = saveData.warHistorySeq || 0;
        if (saveData.weather && world.weather && world.weather.deserialize) world.weather.deserialize(saveData.weather);

        // Restore tile data
        for (let r = 0; r < world.tiles.length; r++) {
            for (let q = 0; q < world.tiles[r].length; q++) {
                const savedTile = saveData.tiles[r][q];
                const tile = world.tiles[r][q];

                tile.explored = savedTile.explored;
                tile.kingdom = savedTile.kingdom;
                tile.settlement = savedTile.settlement;
                tile.improvement = savedTile.improvement;
                tile.infrastructure = savedTile.infrastructure || null;
                tile.playerProperties = savedTile.playerProperties || null;
                // JSON turns the shared reference into a separate copy — re-link it
                tile.playerProperty = (tile.playerProperties && tile.playerProperties[0])
                    || savedTile.playerProperty || null;
                tile.indigenous = savedTile.indigenous || null;
                if (savedTile.holySite) tile.holySite = savedTile.holySite;
                if (savedTile.religiousBuilding) tile.religiousBuilding = savedTile.religiousBuilding;
                if (savedTile.culturalBuilding) tile.culturalBuilding = savedTile.culturalBuilding;
                if (savedTile.terraformed) SaveLoad._restoreTerraform(tile, savedTile.terraformed);
            }
        }

        // Restore kingdoms
        for (let i = 0; i < world.kingdoms.length; i++) {
            const savedKingdom = saveData.kingdoms[i];
            const kingdom = world.kingdoms[i];

            Object.assign(kingdom, savedKingdom);
            // Saves from before royal fleets: counted afresh (half the cap) on the next day
            KingdomNavy.ensure(kingdom);

            // Restore character data
            if (typeof Characters !== 'undefined' && savedKingdom.characterData) {
                Characters.deserialize(kingdom, savedKingdom.characterData);
            }
        }

        // Kingdoms born after world generation (a realm the player founded)
        // aren't regenerated — rebuild them from the save
        for (let i = world.kingdoms.length; i < (saveData.kingdoms || []).length; i++) {
            const saved = saveData.kingdoms[i];
            if (!saved || !saved.id) continue;
            const kingdom = {
                territory: [], cities: [], wars: [], allies: [], relations: {}, truces: {}, warState: {},
                royalBank: { treasury: 5000, interestRates: { small: 0.10, medium: 0.15, large: 0.20 } },
                ...saved,
            };
            if (!kingdom.characterData) delete kingdom.characterData;
            KingdomNavy.ensure(kingdom);
            world.kingdoms.push(kingdom);
        }

        // World units (older saves keep the ones the regenerated world spawned)
        if (Array.isArray(saveData.units)) world.units = SaveLoad.restoreUnits(saveData.units);
        // Never hand out an id the save already used
        if (typeof saveData.idCounter === 'number') {
            Utils.setIdCounter(Math.max(Utils.getIdCounter(), saveData.idCounter));
        }
        // The settlement scan changed under any cache
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
    },

    /**
     * Regional markets from a save (null for older saves: they start afresh).
     * Call after MarketDynamics.initialize().
     */
    restoreMarkets(saveData) {
        const markets = saveData && saveData.markets;
        if (markets && typeof markets === 'object' && !Array.isArray(markets)) MarketDynamics.regionalMarkets = markets;
    },

    /** Put back terrain the player cleared or levelled. */
    _restoreTerraform(tile, saved) {
        const type = saved.terrain && Object.values(Terrain.TYPES).find(t => t && t.id === saved.terrain);
        if (type) tile.terrain = type;
        tile.resource = saved.resource || null;
        if (typeof saved.elevation === 'number') tile.elevation = saved.elevation;
        tile.terraformed = true;
    },

    /**
     * Restore player from save data
     */
    restorePlayer(saveData, player, world = null) {
        Object.assign(player, saveData);

        // Backfill firstName/lastName from name for older saves
        if (!player.firstName && player.name) {
            const parts = player.name.split(' ');
            player.firstName = parts[0] || 'Wanderer';
            player.lastName = parts.slice(1).join(' ') || '';
        }

        // Ship crews and naval units (backfills crews for saves from before them)
        Ships.restoreFromSave(player);

        // Restore the House (backfills a blank for legacy saves without one)
        if (typeof House !== 'undefined') {
            House.deserialize(player, null, saveData.house);
        }

        // Restore title progress (convert Arrays back to Sets)
        if (typeof Titles !== 'undefined' && player.titleProgress) {
            player.titleProgress = Titles.deserializeProgress(player.titleProgress);
        }

        // Initialize title fields if missing
        if (typeof Titles !== 'undefined') {
            Titles.initialize(player);
        }

        // Restore quests (convert Array back to Set)
        if (player.quests && player.quests.settlementsVisited) {
            player.quests.settlementsVisited = new Set(player.quests.settlementsVisited);
        }

        // Restore discoveredLore (convert Array back to Set)
        if (player.discoveredLore && Array.isArray(player.discoveredLore)) {
            player.discoveredLore = new Set(player.discoveredLore);
        } else {
            player.discoveredLore = new Set();
        }

        // Restore discoveredHolySites (convert Array back to Set)
        if (player.discoveredHolySites && Array.isArray(player.discoveredHolySites)) {
            player.discoveredHolySites = new Set(player.discoveredHolySites);
        } else {
            player.discoveredHolySites = new Set();
        }

        // Restore discoveredExtinctFaiths (convert Array back to Set)
        if (player.discoveredExtinctFaiths && Array.isArray(player.discoveredExtinctFaiths)) {
            player.discoveredExtinctFaiths = new Set(player.discoveredExtinctFaiths);
        } else {
            player.discoveredExtinctFaiths = new Set();
        }

        // Restore espionage system state
        if (typeof Espionage !== 'undefined') {
            Espionage.loadState(player);
        }

        // Restore festivals state
        if (typeof Festivals !== 'undefined') {
            Festivals.loadState(player);
        } else if (!player.festivals || typeof player.festivals !== 'object') {
            player.festivals = {
                hosted: 0,
                successfulContests: 0,
                diplomacyEvents: 0,
                sabotageEvents: 0,
                moraleBoostDays: 0,
                moraleBoostValue: 0,
                lastHostedDay: -999,
                history: [],
            };
        }

        // Restore councils/parliament system state
        if (typeof Councils !== 'undefined') {
            Councils.loadState(player);
        }

        // Restore gossip system state
        Gossip.loadState(player);

        // Earned traits (backfills a blank record for saves from before them)
        Traits.loadState(player);
        // The underworld (backfills a blank record for saves from before it)
        Underworld.loadState(player);
        // Court petitions — older saves have none (backfilled lazily once there is state)
        if (player.petitions) Petitions.loadState(player);
        else player.petitions = null;
        // Delves — older saves have none (backfills a blank record)
        Delves.loadState(player);
        // Ailments — older saves have none; legacy delve injuries are folded in
        Ailments.loadState(player, world);
        // Claims & Crowns — older saves get a blank record (and a crown if they
        // had founded a kingdom with the old Form Kingdom action)
        Throne.load(player, world);
        Kingship.load(player, world); // the royal court rides inside player.throne
        // Holdings — older saves have none; owned settlements get a blank record and fresh effects
        Holdings.loadState(player, world);
        // Rival adventurers — older saves get a blank record (the cast arrives next day)
        Rivals.loadState(player);
        // Sagas — older saves get a blank record (the first saga starts on schedule)
        Sagas.loadState(player);
        // Sieges — older saves get a blank record
        Sieges.loadState(player);
        // Sieges of your holdings — the ledger on player.realmWars, backfilled for older saves
        HoldingSieges.loadState(player);
        // Uncharted lands — older saves get a blank record (the places are chosen next day)
        Discovery.loadState(player);
        // Merchant houses — older saves have none (stays null until a charter or company)
        MerchantHouses.loadState(player);

        // Travel party fallback for older saves
        if (!Array.isArray(player.travelParty)) {
            player.travelParty = [];
        }
        // Companions: backfill bookkeeping, and a deterministic personality (hash of
        // the id) for companions recruited before personalities existed
        Companions.loadState(player);
        // Heirs: every child gets an upbringing record (grown ones count as of
        // age); the House gets its reign records (systems/legacy.js)
        Upbringing.loadState(player);
        Legacy.ensure(player, world);

        if (player.landTaxBonus == null) player.landTaxBonus = 0;
        if (player.mount === undefined) player.mount = null;

        // Economy 2.0 fallbacks for older saves
        if (!Array.isArray(player.tradeRoutes)) player.tradeRoutes = [];
        if (!Array.isArray(player.smugglingRoutes)) player.smugglingRoutes = [];
        if (!player.auctions) {
            player.auctions = { active: [], won: [], nextRefreshDay: 1, nextId: 1, lastProcessedDay: 0 };
        } else {
            if (!Array.isArray(player.auctions.active)) player.auctions.active = [];
            if (!Array.isArray(player.auctions.won)) player.auctions.won = [];
            player.auctions.nextRefreshDay = player.auctions.nextRefreshDay || 1;
            player.auctions.nextId = player.auctions.nextId || 1;
            player.auctions.lastProcessedDay = player.auctions.lastProcessedDay || 0;
        }

        // Mercenary companies fallback
        if (!Array.isArray(player.mercenaryCompanies)) player.mercenaryCompanies = [];

        // Bounty hunter fallback
        if (!Array.isArray(player.activeBounties)) player.activeBounties = [];
        if (typeof player.bountiesCompleted !== 'number') player.bountiesCompleted = 0;
        if (typeof BountyHunting !== 'undefined') {
            BountyHunting.initialize(player);
        } else if (!player.bountyHunter || typeof player.bountyHunter !== 'object') {
            player.bountyHunter = {
                rank: 1,
                capturesTurnedIn: 0,
                capturesRecruited: 0,
                failedCaptures: 0,
                nextTargetId: 1,
                boardRefreshDay: 0,
                boardSettlementKey: '',
                boardOffers: [],
            };
        }

        // Needs system fallback for older saves
        if (!player.needs || typeof player.needs !== 'object') {
            player.needs = { hunger: 100, energy: 100, social: 100, fun: 100, hygiene: 100, comfort: 100 };
        }
        if (player._lastNeedDecayHour == null) player._lastNeedDecayHour = 8;
        if (typeof player._needHoursToday !== 'number') player._needHoursToday = 0;
        // Saves from before the needs system was switched on never carried the
        // flag — they get the default (on). An explicit opt-out is respected.
        if (typeof player.needsEnabled !== 'boolean') player.needsEnabled = true;
        for (const need of ['hunger', 'energy', 'social', 'fun', 'hygiene', 'comfort']) {
            if (!Number.isFinite(player.needs[need])) player.needs[need] = 100;
        }
        if (!player._needWarnings) player._needWarnings = {};

        // Legendary artifacts fallback
        if (!player.artifacts || typeof player.artifacts !== 'object') {
            player.artifacts = { fragments: {}, forged: [], discovered: [] };
        }
        if (!player.artifacts.fragments || typeof player.artifacts.fragments !== 'object') {
            player.artifacts.fragments = {};
        }
        if (!Array.isArray(player.artifacts.forged)) {
            player.artifacts.forged = [];
        }
        if (!Array.isArray(player.artifacts.discovered)) {
            player.artifacts.discovered = [];
        }
    },

    /**
     * Export save to file
     */
    exportSave() {
        const json = localStorage.getItem(SaveLoad.SAVE_KEY);
        if (!json) return null;

        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `lord_of_realms_save_${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);

        return true;
    },

    /**
     * Import save from file
     */
    importSave(file, callback) {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const json = e.target.result;
                const saveData = JSON.parse(json);

                // Validate save data
                if (!saveData.version || !saveData.world || !saveData.player) {
                    callback({ success: false, error: 'Invalid save file' });
                    return;
                }

                // Store in localStorage
                localStorage.setItem(SaveLoad.SAVE_KEY, json);

                callback({ success: true, data: saveData });
            } catch (error) {
                callback({ success: false, error: error.message });
            }
        };

        reader.onerror = () => {
            callback({ success: false, error: 'Failed to read file' });
        };

        reader.readAsText(file);
    },

    /**
     * Get save info without loading
     */
    getSaveInfo() {
        const json = localStorage.getItem(SaveLoad.SAVE_KEY);
        if (!json) return null;

        try {
            const saveData = JSON.parse(json);
            return {
                timestamp: saveData.timestamp,
                day: saveData.world.day,
                season: saveData.world.season,
                year: saveData.world.year,
                playerGold: saveData.player.gold,
                playerRenown: saveData.player.renown,
            };
        } catch (error) {
            return null;
        }
    },
};

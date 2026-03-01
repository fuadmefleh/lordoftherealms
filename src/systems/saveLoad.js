// ============================================
// SAVE/LOAD — Game state persistence
// ============================================

import { Characters } from '../world/characters.js';
import { Titles } from './titles.js';
import { Espionage } from './espionage.js';
import { Festivals } from './festivals.js';
import { Councils } from './councils.js';
import { BountyHunting } from './bountyHunting.js';


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
        };
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
            relations: k.relations,
            wars: k.wars,
            allies: k.allies,
            lord: k.lord,
            characterData: typeof Characters !== 'undefined' ? Characters.serialize(k) : (k.characterData || null),
            colonization: k.colonization || null,
            cartography: k.cartography || null,
        }));
    },

    /**
     * Serialize player state
     */
    serializePlayer(player) {
        return {
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
            intel: player.intel || null,
            soulSoldCount: player.soulSoldCount || 0,
            lastSoulSoldDay: player.lastSoulSoldDay || 0,
            indenturedServitude: player.indenturedServitude || null,
            jailState: player.jailState || null,
            criminalRecord: player.criminalRecord || { pickpocket: 0, smuggling: 0 },
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

            // Espionage
            espionage: player.espionage || null,

            // Festivals
            festivals: player.festivals || null,

            // Councils & parliament
            council: player.council || null,
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
                tile.playerProperty = savedTile.playerProperty || null;
                tile.indigenous = savedTile.indigenous || null;
            }
        }

        // Restore kingdoms
        for (let i = 0; i < world.kingdoms.length; i++) {
            const savedKingdom = saveData.kingdoms[i];
            const kingdom = world.kingdoms[i];

            Object.assign(kingdom, savedKingdom);

            // Restore character data
            if (typeof Characters !== 'undefined' && savedKingdom.characterData) {
                Characters.deserialize(kingdom, savedKingdom.characterData);
            }
        }
    },

    /**
     * Restore player from save data
     */
    restorePlayer(saveData, player) {
        Object.assign(player, saveData);

        // Backfill firstName/lastName from name for older saves
        if (!player.firstName && player.name) {
            const parts = player.name.split(' ');
            player.firstName = parts[0] || 'Wanderer';
            player.lastName = parts.slice(1).join(' ') || '';
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

        // Travel party fallback for older saves
        if (!Array.isArray(player.travelParty)) {
            player.travelParty = [];
        }

        if (player.landTaxBonus == null) player.landTaxBonus = 0;

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

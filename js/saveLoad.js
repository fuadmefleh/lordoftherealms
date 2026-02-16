// ============================================
// SAVE/LOAD — Game state persistence
// ============================================

const SaveLoad = {
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
            movementRemaining: player.movementRemaining,
            attributes: player.attributes,
            skills: player.skills,
            reputation: player.reputation,
            properties: player.properties,
            caravans: player.caravans,
            army: player.army,
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
            inventory: player.inventory || {},
            allegiance: player.allegiance || null,
            kingdomTitle: player.kingdomTitle || null,
            luck: player.luck,
            strength: player.strength,
            financeHistory: player.financeHistory || [],
            financeToday: player.financeToday || null,
            colonies: player.colonies || [],
            maps: player.maps || [],
            queuedPath: player.queuedPath || null,
            queuedPathIndex: player.queuedPathIndex || 0,
            travelDestination: player.travelDestination || null,
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

        // Restore quests (convert Array back to Set)
        if (player.quests && player.quests.settlementsVisited) {
            player.quests.settlementsVisited = new Set(player.quests.settlementsVisited);
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

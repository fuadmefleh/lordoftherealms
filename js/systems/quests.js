// ============================================
// QUESTS — Quest and objective system
// ============================================

const Quests = {
    /**
     * Quest templates
     */
    QUEST_TEMPLATES: {
        // Economic Quests
        MERCHANT_APPRENTICE: {
            id: 'merchant_apprentice',
            title: 'Merchant Apprentice',
            description: 'Prove yourself as a trader by accumulating wealth.',
            type: 'economic',
            objectives: [
                { type: 'gold', target: 1000, current: 0, text: 'Accumulate 1000 gold' }
            ],
            rewards: { gold: 500, renown: 10 },
            difficulty: 'easy',
        },
        TRADE_EMPIRE: {
            id: 'trade_empire',
            title: 'Trade Empire',
            description: 'Build a network of profitable properties.',
            type: 'economic',
            objectives: [
                { type: 'properties', target: 5, current: 0, text: 'Own 5 properties' }
            ],
            rewards: { gold: 2000, renown: 25 },
            difficulty: 'medium',
        },
        CARAVAN_MASTER: {
            id: 'caravan_master',
            title: 'Caravan Master',
            description: 'Successfully complete multiple trade caravans.',
            type: 'economic',
            objectives: [
                { type: 'caravans_completed', target: 10, current: 0, text: 'Complete 10 caravans' }
            ],
            rewards: { gold: 1500, renown: 20 },
            difficulty: 'medium',
        },

        // Military Quests
        FIRST_BLOOD: {
            id: 'first_blood',
            title: 'First Blood',
            description: 'Recruit your first military unit.',
            type: 'military',
            objectives: [
                { type: 'army_size', target: 1, current: 0, text: 'Recruit 1 unit' }
            ],
            rewards: { gold: 200, renown: 5 },
            difficulty: 'easy',
        },
        MERCENARY_CAPTAIN: {
            id: 'mercenary_captain',
            title: 'Mercenary Captain',
            description: 'Complete mercenary contracts to build your reputation.',
            type: 'military',
            objectives: [
                { type: 'contracts_completed', target: 5, current: 0, text: 'Complete 5 contracts' }
            ],
            rewards: { gold: 1000, renown: 30 },
            difficulty: 'medium',
        },
        WARLORD: {
            id: 'warlord',
            title: 'Warlord',
            description: 'Build a formidable army.',
            type: 'military',
            objectives: [
                { type: 'army_strength', target: 200, current: 0, text: 'Reach 200 army strength' }
            ],
            rewards: { gold: 3000, renown: 50 },
            difficulty: 'hard',
        },

        // Religious Quests
        FAITHFUL_SERVANT: {
            id: 'faithful_servant',
            title: 'Faithful Servant',
            description: 'Gain karma through righteous deeds.',
            type: 'religious',
            objectives: [
                { type: 'karma', target: 20, current: 0, text: 'Reach 20 karma' }
            ],
            rewards: { gold: 500, karma: 5 },
            difficulty: 'easy',
        },
        PROPHET: {
            id: 'prophet',
            title: 'Prophet',
            description: 'Found your own religion and spread the faith.',
            type: 'religious',
            objectives: [
                { type: 'religion_founded', target: 1, current: 0, text: 'Found a religion' },
                { type: 'followers', target: 1000, current: 0, text: 'Gain 1000 followers' }
            ],
            rewards: { gold: 2000, karma: 20, renown: 40 },
            difficulty: 'hard',
        },
        TEMPLE_BUILDER: {
            id: 'temple_builder',
            title: 'Temple Builder',
            description: 'Construct religious buildings to spread your faith.',
            type: 'religious',
            objectives: [
                { type: 'temples_built', target: 3, current: 0, text: 'Build 3 religious buildings' }
            ],
            rewards: { gold: 1500, karma: 10 },
            difficulty: 'medium',
        },

        // Exploration Quests
        WANDERER: {
            id: 'wanderer',
            title: 'Wanderer',
            description: 'Explore the world and discover new lands.',
            type: 'exploration',
            objectives: [
                { type: 'tiles_explored', target: 100, current: 0, text: 'Explore 100 tiles' }
            ],
            rewards: { gold: 300, renown: 10 },
            difficulty: 'easy',
        },
        WORLD_TRAVELER: {
            id: 'world_traveler',
            title: 'World Traveler',
            description: 'Visit settlements across the realm.',
            type: 'exploration',
            objectives: [
                { type: 'settlements_visited', target: 10, current: 0, text: 'Visit 10 settlements' }
            ],
            rewards: { gold: 800, renown: 20 },
            difficulty: 'medium',
        },

        // Legendary Artifact Quests
        ARTIFACT_SWORD_FIRST_KING: {
            id: 'artifact_sword_first_king',
            title: 'Shards of the First Crownblade',
            description: 'Recover fragments of the Sword of the First King and reforge the relic.',
            type: 'exploration',
            objectives: [
                { type: 'artifact_fragments', artifactId: 'sword_first_king', target: 3, current: 0, text: 'Collect 3 Sword fragments' },
                { type: 'artifact_reforged', artifactId: 'sword_first_king', target: 1, current: 0, text: 'Reforge the Sword of the First King' }
            ],
            rewards: { gold: 1200, renown: 35 },
            difficulty: 'hard',
        },
        ARTIFACT_CROWN_EMBERS: {
            id: 'artifact_crown_embers',
            title: 'Cinders of the Lost Crown',
            description: 'Find the scattered embers of an ancient crown and restore it at the forge.',
            type: 'exploration',
            objectives: [
                { type: 'artifact_fragments', artifactId: 'crown_embers', target: 4, current: 0, text: 'Collect 4 Crown fragments' },
                { type: 'artifact_reforged', artifactId: 'crown_embers', target: 1, current: 0, text: 'Reforge the Crown of Embers' }
            ],
            rewards: { gold: 1500, renown: 40 },
            difficulty: 'hard',
        },
        ARTIFACT_ASTROLABE_TIDES: {
            id: 'artifact_astrolabe_tides',
            title: 'Compass of Forgotten Seas',
            description: 'Assemble the Astrolabe of Tides from long-lost fragments hidden in remote places.',
            type: 'exploration',
            objectives: [
                { type: 'artifact_fragments', artifactId: 'astrolabe_tides', target: 3, current: 0, text: 'Collect 3 Astrolabe fragments' },
                { type: 'artifact_reforged', artifactId: 'astrolabe_tides', target: 1, current: 0, text: 'Reforge the Astrolabe of Tides' }
            ],
            rewards: { gold: 1100, renown: 30 },
            difficulty: 'hard',
        },

        // Diplomatic Quests
        PEACEMAKER: {
            id: 'peacemaker',
            title: 'Peacemaker',
            description: 'Build positive relations with kingdoms.',
            type: 'diplomatic',
            objectives: [
                { type: 'positive_relations', target: 3, current: 0, text: 'Reach +50 reputation with 3 kingdoms' }
            ],
            rewards: { gold: 1000, renown: 25 },
            difficulty: 'medium',
        },
        RENOWNED: {
            id: 'renowned',
            title: 'Renowned',
            description: 'Become famous throughout the land.',
            type: 'diplomatic',
            objectives: [
                { type: 'renown', target: 100, current: 0, text: 'Reach 100 renown' }
            ],
            rewards: { gold: 5000 },
            difficulty: 'hard',
        },
    },

    /**
     * Initialize quest system for player
     */
    initialize(player) {
        if (!player.quests) {
            player.quests = {
                active: [],
                completed: [],
                available: [],
                caravansCompleted: 0,
                contractsCompleted: 0,
                templesBuilt: 0,
                settlementsVisited: new Set(),
            };
        }

        // Generate initial available quests
        Quests.generateAvailableQuests(player);
    },

    /**
     * Generate available quests based on player progress
     */
    generateAvailableQuests(player) {
        if (!player.quests) return;

        const available = [];

        // Add starter quests if player has few active quests
        if (player.quests.active.length < 3) {
            // Economic starter
            if (!Quests.hasQuest(player, 'merchant_apprentice')) {
                available.push(Quests.createQuest('MERCHANT_APPRENTICE', player));
            }

            // Military starter
            if (!Quests.hasQuest(player, 'first_blood')) {
                available.push(Quests.createQuest('FIRST_BLOOD', player));
            }

            // Religious starter
            if (!Quests.hasQuest(player, 'faithful_servant')) {
                available.push(Quests.createQuest('FAITHFUL_SERVANT', player));
            }

            // Exploration starter
            if (!Quests.hasQuest(player, 'wanderer')) {
                available.push(Quests.createQuest('WANDERER', player));
            }
        }

        // Add advanced quests based on progress
        if (player.gold >= 500 && !Quests.hasQuest(player, 'trade_empire')) {
            available.push(Quests.createQuest('TRADE_EMPIRE', player));
        }

        if (player.army && player.army.length > 0 && !Quests.hasQuest(player, 'mercenary_captain')) {
            available.push(Quests.createQuest('MERCENARY_CAPTAIN', player));
        }

        if (player.religion && !Quests.hasQuest(player, 'prophet')) {
            available.push(Quests.createQuest('PROPHET', player));
        }

        const artifactFragments = player.artifacts && player.artifacts.fragments ? player.artifacts.fragments : {};
        if ((artifactFragments.sword_first_king || 0) > 0 && !Quests.hasQuest(player, 'artifact_sword_first_king')) {
            available.push(Quests.createQuest('ARTIFACT_SWORD_FIRST_KING', player));
        }
        if ((artifactFragments.crown_embers || 0) > 0 && !Quests.hasQuest(player, 'artifact_crown_embers')) {
            available.push(Quests.createQuest('ARTIFACT_CROWN_EMBERS', player));
        }
        if ((artifactFragments.astrolabe_tides || 0) > 0 && !Quests.hasQuest(player, 'artifact_astrolabe_tides')) {
            available.push(Quests.createQuest('ARTIFACT_ASTROLABE_TIDES', player));
        }

        player.quests.available = available;
    },

    /**
     * Create a quest instance from template
     */
    createQuest(templateId, player) {
        const template = Quests.QUEST_TEMPLATES[templateId];
        if (!template) return null;

        return {
            ...template,
            objectives: template.objectives.map(obj => ({ ...obj })),
            startedAt: 0,
            status: 'available',
        };
    },

    /**
     * Check if player has quest (active or completed)
     */
    hasQuest(player, questId) {
        if (!player.quests) return false;

        return player.quests.active.some(q => q.id === questId) ||
            player.quests.completed.some(q => q.id === questId) ||
            player.quests.available.some(q => q.id === questId);
    },

    /**
     * Accept a quest
     */
    acceptQuest(player, questId) {
        if (!player.quests) return { success: false, reason: 'Quest system not initialized' };

        const questIndex = player.quests.available.findIndex(q => q.id === questId);
        if (questIndex === -1) {
            return { success: false, reason: 'Quest not available' };
        }

        if (player.quests.active.length >= 5) {
            return { success: false, reason: 'Too many active quests (max 5)' };
        }

        const quest = player.quests.available[questIndex];
        quest.status = 'active';
        quest.startedAt = Date.now();

        player.quests.active.push(quest);
        player.quests.available.splice(questIndex, 1);

        return { success: true, quest };
    },

    /**
     * Update quest progress
     */
    updateProgress(player, world) {
        if (!player.quests || player.quests.active.length === 0) return [];

        const completed = [];

        for (const quest of player.quests.active) {
            let allComplete = true;

            for (const objective of quest.objectives) {
                // Update objective progress
                switch (objective.type) {
                    case 'gold':
                        objective.current = player.gold;
                        break;
                    case 'karma':
                        objective.current = player.karma;
                        break;
                    case 'renown':
                        objective.current = player.renown;
                        break;
                    case 'properties':
                        objective.current = player.properties ? player.properties.length : 0;
                        break;
                    case 'army_size':
                        objective.current = player.army ? player.army.length : 0;
                        break;
                    case 'army_strength':
                        objective.current = PlayerMilitary.getArmyStrength(player);
                        break;
                    case 'followers':
                        objective.current = player.religion ? player.religion.followers : 0;
                        break;
                    case 'religion_founded':
                        objective.current = player.religion ? 1 : 0;
                        break;
                    case 'caravans_completed':
                        objective.current = player.quests.caravansCompleted || 0;
                        break;
                    case 'contracts_completed':
                        objective.current = player.quests.contractsCompleted || 0;
                        break;
                    case 'temples_built':
                        objective.current = player.quests.templesBuilt || 0;
                        break;
                    case 'tiles_explored':
                        let exploredCount = 0;
                        for (let r = 0; r < world.height; r++) {
                            for (let q = 0; q < world.width; q++) {
                                if (world.tiles[r][q].explored) exploredCount++;
                            }
                        }
                        objective.current = exploredCount;
                        break;
                    case 'settlements_visited':
                        objective.current = player.quests.settlementsVisited.size;
                        break;
                    case 'positive_relations':
                        let positiveCount = 0;
                        for (const [kingdomId, rep] of Object.entries(player.reputation)) {
                            if (rep >= 50) positiveCount++;
                        }
                        objective.current = positiveCount;
                        break;
                    case 'artifact_fragments': {
                        const fragments = player.artifacts && player.artifacts.fragments ? player.artifacts.fragments : {};
                        objective.current = fragments[objective.artifactId] || 0;
                        break;
                    }
                    case 'artifact_reforged': {
                        const forged = player.artifacts && Array.isArray(player.artifacts.forged) ? player.artifacts.forged : [];
                        objective.current = forged.includes(objective.artifactId) ? 1 : 0;
                        break;
                    }
                }

                objective.completed = objective.current >= objective.target;
                if (!objective.completed) allComplete = false;
            }

            // Check if quest is complete
            if (allComplete && quest.status === 'active') {
                quest.status = 'completed';
                completed.push(quest);
            }
        }

        // Move completed quests
        for (const quest of completed) {
            const index = player.quests.active.findIndex(q => q.id === quest.id);
            if (index !== -1) {
                player.quests.active.splice(index, 1);
                player.quests.completed.push(quest);

                // Grant rewards
                Quests.grantRewards(player, quest);
            }
        }

        // Generate new quests
        if (completed.length > 0) {
            Quests.generateAvailableQuests(player);
        }

        return completed;
    },

    /**
     * Grant quest rewards
     */
    grantRewards(player, quest) {
        const rewards = quest.rewards;

        if (rewards.gold) {
            player.gold += rewards.gold;
        }

        if (rewards.karma) {
            player.karma += rewards.karma;
        }

        if (rewards.renown) {
            player.renown += rewards.renown;
        }

        return rewards;
    },

    /**
     * Track caravan completion
     */
    trackCaravanCompleted(player) {
        if (!player.quests) return;
        player.quests.caravansCompleted = (player.quests.caravansCompleted || 0) + 1;
    },

    /**
     * Track contract completion
     */
    trackContractCompleted(player) {
        if (!player.quests) return;
        player.quests.contractsCompleted = (player.quests.contractsCompleted || 0) + 1;
    },

    /**
     * Track temple built
     */
    trackTempleBuilt(player) {
        if (!player.quests) return;
        player.quests.templesBuilt = (player.quests.templesBuilt || 0) + 1;
    },

    /**
     * Track settlement visited
     */
    trackSettlementVisited(player, settlementName) {
        if (!player.quests) return;
        if (!player.quests.settlementsVisited) player.quests.settlementsVisited = new Set();
        player.quests.settlementsVisited.add(settlementName);
    },

    /**
     * Get quest progress summary
     */
    getProgressSummary(quest) {
        const total = quest.objectives.length;
        const completed = quest.objectives.filter(obj => obj.completed).length;
        return `${completed}/${total}`;
    },
};

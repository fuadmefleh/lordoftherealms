// ============================================
// ACHIEVEMENTS — Achievement tracking system
// ============================================

import { PlayerMilitary } from '../player/playerMilitary.js';


export const Achievements = {
    /**
     * Achievement definitions
     */
    ACHIEVEMENTS: {
        // Wealth Achievements
        FIRST_FORTUNE: {
            id: 'first_fortune',
            name: 'First Fortune',
            description: 'Accumulate 1,000 gold',
            icon: '💰',
            check: (player) => player.gold >= 1000,
            tier: 'bronze',
        },
        WEALTHY: {
            id: 'wealthy',
            name: 'Wealthy',
            description: 'Accumulate 10,000 gold',
            icon: '💎',
            check: (player) => player.gold >= 10000,
            tier: 'silver',
        },
        TYCOON: {
            id: 'tycoon',
            name: 'Tycoon',
            description: 'Accumulate 50,000 gold',
            icon: '👑',
            check: (player) => player.gold >= 50000,
            tier: 'gold',
        },

        // Military Achievements
        RECRUIT: {
            id: 'recruit',
            name: 'Recruit',
            description: 'Recruit your first unit',
            icon: '⚔️',
            check: (player) => player.army && player.army.length > 0,
            tier: 'bronze',
        },
        COMMANDER: {
            id: 'commander',
            name: 'Commander',
            description: 'Command an army of 10 units',
            icon: '🛡️',
            check: (player) => player.army && player.army.length >= 10,
            tier: 'silver',
        },
        GENERAL: {
            id: 'general',
            name: 'General',
            description: 'Build an army with 500+ strength',
            icon: '⚡',
            check: (player) => PlayerMilitary.getArmyStrength(player) >= 500,
            tier: 'gold',
        },

        // Religious Achievements
        BELIEVER: {
            id: 'believer',
            name: 'Believer',
            description: 'Reach 10 karma',
            icon: '☯️',
            check: (player) => player.karma >= 10,
            tier: 'bronze',
        },
        HOLY: {
            id: 'holy',
            name: 'Holy',
            description: 'Found a religion',
            icon: '🙏',
            check: (player) => player.religion !== null,
            tier: 'silver',
        },
        DIVINE: {
            id: 'divine',
            name: 'Divine',
            description: 'Gain 10,000 followers',
            icon: '✨',
            check: (player) => player.religion && player.religion.followers >= 10000,
            tier: 'gold',
        },

        // Exploration Achievements
        EXPLORER: {
            id: 'explorer',
            name: 'Explorer',
            description: 'Explore 100 tiles',
            icon: '🗺️',
            check: (player, world) => {
                let count = 0;
                for (let r = 0; r < world.height; r++) {
                    for (let q = 0; q < world.width; q++) {
                        if (world.tiles[r][q].explored) count++;
                    }
                }
                return count >= 100;
            },
            tier: 'bronze',
        },
        CARTOGRAPHER: {
            id: 'cartographer',
            name: 'Cartographer',
            description: 'Explore 500 tiles',
            icon: '🧭',
            check: (player, world) => {
                let count = 0;
                for (let r = 0; r < world.height; r++) {
                    for (let q = 0; q < world.width; q++) {
                        if (world.tiles[r][q].explored) count++;
                    }
                }
                return count >= 500;
            },
            tier: 'silver',
        },

        // Economic Achievements
        LANDLORD: {
            id: 'landlord',
            name: 'Landlord',
            description: 'Own 5 properties',
            icon: '🏘️',
            check: (player) => player.properties && player.properties.length >= 5,
            tier: 'bronze',
        },
        MOGUL: {
            id: 'mogul',
            name: 'Mogul',
            description: 'Own 20 properties',
            icon: '🏰',
            check: (player) => player.properties && player.properties.length >= 20,
            tier: 'gold',
        },

        // Reputation Achievements
        KNOWN: {
            id: 'known',
            name: 'Known',
            description: 'Reach 50 renown',
            icon: '⭐',
            check: (player) => player.renown >= 50,
            tier: 'bronze',
        },
        FAMOUS: {
            id: 'famous',
            name: 'Famous',
            description: 'Reach 100 renown',
            icon: '🌟',
            check: (player) => player.renown >= 100,
            tier: 'silver',
        },
        LEGENDARY: {
            id: 'legendary',
            name: 'Legendary',
            description: 'Reach 200 renown',
            icon: '💫',
            check: (player) => player.renown >= 200,
            tier: 'gold',
        },

        // Special Achievements
        SURVIVOR: {
            id: 'survivor',
            name: 'Survivor',
            description: 'Survive 100 days',
            icon: '📅',
            check: (player, world) => world.day >= 100,
            tier: 'bronze',
        },
        VETERAN: {
            id: 'veteran',
            name: 'Veteran',
            description: 'Survive 365 days (1 year)',
            icon: '🗓️',
            check: (player, world) => world.day >= 365,
            tier: 'silver',
        },
        IMMORTAL: {
            id: 'immortal',
            name: 'Immortal',
            description: 'Survive 1000 days',
            icon: '⏳',
            check: (player, world) => world.day >= 1000,
            tier: 'gold',
        },

        // Mastery Achievements
        JACK_OF_TRADES: {
            id: 'jack_of_trades',
            name: 'Jack of All Trades',
            description: 'Reach level 5 in all three paths',
            icon: '🎯',
            check: (player) => {
                const hasEconomic = player.properties && player.properties.length >= 5;
                const hasMilitary = player.army && player.army.length >= 5;
                const hasReligious = player.religion && player.religion.followers >= 1000;
                return hasEconomic && hasMilitary && hasReligious;
            },
            tier: 'gold',
        },
        MIRACLE_WORKER: {
            id: 'miracle_worker',
            name: 'Miracle Worker',
            description: 'Perform 10 miracles',
            icon: '✝️',
            check: (player) => player.miraclesPerformed >= 10,
            tier: 'silver',
        },
        PEACEKEEPER: {
            id: 'peacekeeper',
            name: 'Peacekeeper',
            description: 'Maintain positive relations with all kingdoms',
            icon: '🕊️',
            check: (player, world) => {
                const livingKingdoms = world.kingdoms.filter(k => k.isAlive);
                if (livingKingdoms.length === 0) return false;

                for (const kingdom of livingKingdoms) {
                    const rep = player.reputation[kingdom.id] || 0;
                    if (rep < 0) return false;
                }
                return true;
            },
            tier: 'gold',
        },
        // ── Deeds tracked by quest counters (Quests.track) and player records ──
        FIRST_KILL: {
            id: 'first_kill',
            name: 'First Kill',
            description: 'Win your first battle',
            icon: '🗡️',
            check: (player) => Achievements._stat(player, 'battles_won') >= 1,
            tier: 'bronze',
        },
        DRAGON_SLAYER: {
            id: 'dragon_slayer',
            name: 'Dragon Slayer',
            description: 'Defeat a legendary creature',
            icon: '🐉',
            check: (player) => Achievements._stat(player, 'special_creatures_defeated') >= 1,
            tier: 'gold',
        },
        MERCHANT_PRINCE: {
            id: 'merchant_prince',
            name: 'Merchant Prince',
            description: 'Complete 25 caravans',
            icon: '🐫',
            check: (player) => ((player.quests && player.quests.caravansCompleted) || 0) >= 25,
            tier: 'silver',
        },
        ROAD_WARRIOR: {
            id: 'road_warrior',
            name: 'Road Warrior',
            description: 'Build 50 road segments',
            icon: '🛤️',
            check: (player) => Achievements._stat(player, 'roads_built') >= 50,
            tier: 'silver',
        },
        MASTER_BUILDER: {
            id: 'master_builder',
            name: 'Master Builder',
            description: 'Construct 20 buildings',
            icon: '🏗️',
            check: (player) => Achievements._stat(player, 'buildings_constructed') >= 20,
            tier: 'silver',
        },
        SCHOLAR_SUPREME: {
            id: 'scholar_supreme',
            name: 'Scholar Supreme',
            description: 'Research 15 technologies',
            icon: '📚',
            check: (player) => ((player.technology && player.technology.implemented) || []).length >= 15,
            tier: 'gold',
        },
        BOUNTY_HUNTER: {
            id: 'bounty_hunter',
            name: 'Bounty Hunter',
            description: 'Complete 10 military contracts',
            icon: '💀',
            check: (player) => ((player.quests && player.quests.contractsCompleted) || 0) >= 10,
            tier: 'silver',
        },
        WARLORD_SUPREME: {
            id: 'warlord_supreme',
            name: 'Warlord Supreme',
            description: 'Win 50 battles',
            icon: '⚔️',
            check: (player) => Achievements._stat(player, 'battles_won') >= 50,
            tier: 'gold',
        },
        TREASURE_SEEKER: {
            id: 'treasure_seeker',
            name: 'Treasure Seeker',
            description: 'Find 5 hidden treasures',
            icon: '🗝️',
            check: (player) => Achievements._stat(player, 'treasures_found') >= 5,
            tier: 'bronze',
        },
        RUIN_DELVER: {
            id: 'ruin_delver',
            name: 'Ruin Delver',
            description: 'Explore 10 ancient ruins',
            icon: '🏚️',
            check: (player) => Achievements._stat(player, 'ruins_explored') >= 10,
            tier: 'silver',
        },
        TAVERN_CRAWLER: {
            id: 'tavern_crawler',
            name: 'Tavern Crawler',
            description: 'Visit 20 different taverns',
            icon: '🍺',
            check: (player) => (player.visitedTaverns || []).length >= 20,
            tier: 'bronze',
        },
        SPYMASTER: {
            id: 'spymaster',
            name: 'Spymaster',
            description: 'Hire 10 informants',
            icon: '🕵️',
            check: (player) => Achievements._stat(player, 'informants_hired') >= 10,
            tier: 'silver',
        },
        QUEST_MASTER: {
            id: 'quest_master',
            name: 'Quest Master',
            description: 'Complete 20 quests',
            icon: '📋',
            check: (player) => ((player.quests && player.quests.completed) || []).length >= 20,
            tier: 'gold',
        },
        GLOBE_TROTTER: {
            id: 'globe_trotter',
            name: 'Globe Trotter',
            description: 'Visit every kingdom in the realm',
            icon: '🌍',
            check: (player, world) => {
                const living = ((world && world.kingdoms) || []).filter(k => k.isAlive !== false);
                const visited = player.kingdomsVisited || [];
                return living.length > 0 && living.every(k => visited.includes(k.id));
            },
            tier: 'gold',
        },
        PIRATE_HUNTER: {
            id: 'pirate_hunter',
            name: 'Pirate Hunter',
            description: 'Defeat 5 pirate ships',
            icon: '🏴‍☠️',
            check: (player) => Achievements._stat(player, 'pirates_defeated') >= 5,
            tier: 'silver',
        },
        CATHEDRAL_BUILDER: {
            id: 'cathedral_builder',
            name: 'Cathedral Builder',
            description: 'Build a cathedral',
            icon: '⛪',
            check: (player) => ((player.religion && player.religion.buildings) || []).some(b => b.type === 'cathedral'),
            tier: 'gold',
        },
        MOUNTAIN_KING: {
            id: 'mountain_king',
            name: 'Mountain King',
            description: 'Own properties in a mountain settlement',
            icon: '⛰️',
            check: (player, world) => !!world && (player.properties || []).some(p => {
                const t = world.getTile(p.q, p.r);
                return t && t.settlement && Achievements.MOUNTAIN_TERRAINS.includes(t.terrain.id);
            }),
            tier: 'bronze',
        },
        PATRON_OF_ARTS: {
            id: 'patron_of_arts',
            name: 'Patron of the Arts',
            description: 'Build a theater and a university',
            icon: '🎭',
            check: (player) => ['theater', 'university'].every(type => (player.culturalBuildings || []).some(b => b.type === type)),
            tier: 'silver',
        },
        UNDYING: {
            id: 'undying',
            name: 'Undying',
            description: 'Survive 5 battles at below 20% health',
            icon: '💪',
            check: (player) => Achievements._stat(player, 'close_calls') >= 5,
            tier: 'gold',
        },
    },

    /** Terrain that counts as a mountain settlement. */
    MOUNTAIN_TERRAINS: ['mountain', 'hills', 'highlands', 'snow_peak'],

    /** An event counter recorded via Quests.track(). */
    _stat(player, stat) {
        return (player.quests && player.quests.stats && player.quests.stats[stat]) || 0;
    },

    /**
     * Initialize achievement system
     */
    initialize(player) {
        if (!player.achievements) {
            player.achievements = {
                unlocked: [],
                progress: {},
            };
        }

        if (!player.miraclesPerformed) {
            player.miraclesPerformed = 0;
        }
    },

    /**
     * Check for new achievements
     */
    checkAchievements(player, world) {
        if (!player.achievements) {
            Achievements.initialize(player);
        }

        const newAchievements = [];

        for (const [id, achievement] of Object.entries(Achievements.ACHIEVEMENTS)) {
            // Skip if already unlocked
            if (player.achievements.unlocked.includes(id)) continue;

            // Check if achievement is unlocked
            if (achievement.check(player, world)) {
                player.achievements.unlocked.push(id);
                newAchievements.push(achievement);
            }
        }

        return newAchievements;
    },

    /**
     * Get achievement progress
     */
    getProgress(player, world) {
        const total = Object.keys(Achievements.ACHIEVEMENTS).length;
        const unlocked = player.achievements ? player.achievements.unlocked.length : 0;
        return { unlocked, total, percentage: Math.floor((unlocked / total) * 100) };
    },

    /**
     * Get achievements by tier
     */
    getByTier(tier) {
        return Object.values(Achievements.ACHIEVEMENTS).filter(a => a.tier === tier);
    },

    /**
     * Track miracle performed
     */
    trackMiracle(player) {
        if (!player.miraclesPerformed) player.miraclesPerformed = 0;
        player.miraclesPerformed++;
    },
};

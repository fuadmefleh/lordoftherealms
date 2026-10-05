// ============================================
// ACHIEVEMENTS — Achievement tracking system
// ============================================

import { PlayerMilitary } from '../player/playerMilitary.js';
import { Foraging, Hunting, FORAGE_RANKS, HUNT_RANKS } from '../player/foraging.js';
import { Deeds } from './deeds.js';
import { Traits } from './traits.js';
import { Kingship } from './kingship.js';
import { Legacy } from './legacy.js';
import { Underworld } from './underworld.js';

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
        HERESY_HUNTER: {
            id: 'heresy_hunter',
            name: 'Heresy Hunter',
            description: 'Suppress 5 heresies',
            icon: '🔥',
            check: (player) => Achievements._stat(player, 'heresies_suppressed') >= 5,
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
        DEAD_OR_ALIVE: {
            id: 'dead_or_alive',
            name: 'Dead or Alive',
            description: 'Bring in 5 wanted criminals',
            icon: '🎯',
            check: (player) => (player.bountiesCompleted || 0) >= 5,
            tier: 'bronze',
        },
        LEGENDARY_HUNTER: {
            id: 'legendary_hunter',
            name: 'Legendary Hunter',
            description: 'Reach the top bounty hunter rank',
            icon: '⭐',
            check: (player) => ((player.bountyHunter && player.bountyHunter.rank) || 0) >= 5,
            tier: 'gold',
        },
        MASTER_OF_REVELS: {
            id: 'master_of_revels',
            name: 'Master of Revels',
            description: 'Host 10 festivals',
            icon: '🎪',
            check: (player) => ((player.festivals && player.festivals.hosted) || 0) >= 10,
            tier: 'silver',
        },
        CHAMPION_OF_THE_LISTS: {
            id: 'champion_of_the_lists',
            name: 'Champion of the Lists',
            description: 'Finish on the podium in 5 festival contests',
            icon: '🏆',
            check: (player) => ((player.festivals && player.festivals.successfulContests) || 0) >= 5,
            tier: 'bronze',
        },
        UNDYING: {
            id: 'undying',
            name: 'Undying',
            description: 'Survive 5 battles at below 20% health',
            icon: '💪',
            check: (player) => Achievements._stat(player, 'close_calls') >= 5,
            tier: 'gold',
        },

        // ── The newer systems: delves, rivals, companions, court, holdings,
        // sieges, sagas, the throne, the underworld, the trading company,
        // discovery and the sea, sickness, the land and the House. Each reads
        // a counter those systems keep (Deeds.collect) or their live state; a
        // few read event counters recorded with Quests.track().
        INTO_THE_DARK: {
            id: 'into_the_dark', name: 'Into the Dark', description: 'Finish your first delve', icon: '🕳️', tier: 'bronze',
            check: (player) => Achievements._deed(player, 'delves.delves') >= 1,
        },
        DELVE_MASTER: {
            id: 'delve_master', name: 'Delve Master', description: 'Clear 10 delves to the bottom', icon: '⛏️', tier: 'silver',
            check: (player) => Achievements._deed(player, 'delves.cleared') >= 10,
        },
        SIX_CHAMBERS_DOWN: {
            id: 'six_chambers_down', name: 'Six Chambers Down', description: 'Reach the sixth chamber of a delve', icon: '🕯️', tier: 'gold',
            check: (player) => Achievements._deed(player, 'delves.deepest') >= 6,
        },
        EVERY_DARK_PLACE: {
            id: 'every_dark_place', name: 'Every Dark Place', description: 'Clear a delve of every kind: sunken ruins, tomb, ruins, mine and cave', icon: '🗿', tier: 'gold',
            check: (player) => Achievements.DELVE_KINDS.every(k => Achievements._stat(player, `delve_cleared_${k}`) >= 1),
        },
        DUELIST: {
            id: 'duelist', name: 'Duelist', description: 'Best a rival adventurer in a duel', icon: '🤺', tier: 'bronze',
            check: (player) => Achievements._deed(player, 'rivals.duelsWon') >= 1,
        },
        MASTER_DUELIST: {
            id: 'master_duelist', name: 'Master Duelist', description: 'Win 10 duels against rival adventurers', icon: '⚔️', tier: 'silver',
            check: (player) => Achievements._deed(player, 'rivals.duelsWon') >= 10,
        },
        BLOOD_FEUD: {
            id: 'blood_feud', name: 'Blood Feud', description: 'Slay a rival adventurer', icon: '🩸', tier: 'silver',
            check: (player) => Achievements._deed(player, 'rivals.slain') >= 1,
        },
        FRIEND_FOR_LIFE: {
            id: 'friend_for_life', name: 'A Friend for Life', description: 'Win a companion\'s devotion', icon: '🤝', tier: 'bronze',
            check: (player) => Achievements._deed(player, 'companions.devoted') >= 1,
        },
        BAND_OF_BROTHERS: {
            id: 'band_of_brothers', name: 'Band of Brothers', description: 'Win the devotion of 3 companions', icon: '🛡️', tier: 'gold',
            check: (player) => Achievements._deed(player, 'companions.devoted') >= 3,
        },
        MAGISTRATE: {
            id: 'magistrate', name: 'Magistrate', description: 'Rule on 10 petitions', icon: '⚖️', tier: 'bronze',
            check: (player) => Achievements._deed(player, 'petitions.ruled') >= 10,
        },
        WISDOM_OF_SOLOMON: {
            id: 'wisdom_of_solomon', name: 'Wisdom of Solomon', description: 'Rule on 50 petitions', icon: '📜', tier: 'silver',
            check: (player) => Achievements._deed(player, 'petitions.ruled') >= 50,
        },
        LORD_OF_THE_MANOR: {
            id: 'lord_of_the_manor', name: 'Lord of the Manor', description: 'Rule a holding', icon: '🏡', tier: 'bronze',
            check: (player) => Achievements._deed(player, 'holdings.held') >= 1,
        },
        IMPROVER_OF_LANDS: {
            id: 'improver_of_lands', name: 'Improver of Lands', description: 'Complete 10 projects in your holdings', icon: '🏗️', tier: 'silver',
            check: (player) => Achievements._deed(player, 'holdings.projects') >= 10,
        },
        IRON_FIST: {
            id: 'iron_fist', name: 'Iron Fist', description: 'Crush a rebellion in one of your holdings', icon: '✊', tier: 'silver',
            check: (player) => Achievements._deed(player, 'holdings.rebellionsCrushed') >= 1,
        },
        UNBROKEN_WALLS: {
            id: 'unbroken_walls', name: 'Unbroken Walls', description: 'See a holding through an enemy siege: relieved or held', icon: '🏯', tier: 'silver',
            check: (player) => {
                const s = (player.realmWars && player.realmWars.siegeStats) || {};
                return ((s.relieved || 0) + (s.held || 0)) >= 1;
            },
        },
        THE_GATES_GIVE_WAY: {
            id: 'the_gates_give_way', name: 'The Gates Give Way', description: 'Take a town by siege', icon: '🏰', tier: 'silver',
            check: (player) => Achievements._deed(player, 'sieges.captured') >= 1,
        },
        BREAKER_OF_CITIES: {
            id: 'breaker_of_cities', name: 'Breaker of Cities', description: 'Take 5 towns by siege', icon: '🔨', tier: 'gold',
            check: (player) => Achievements._deed(player, 'sieges.captured') >= 5,
        },
        NO_RELIEF_COMING: {
            id: 'no_relief_coming', name: 'No Relief Coming', description: 'Beat an army marching to relieve your siege', icon: '🚩', tier: 'silver',
            check: (player) => Achievements._deed(player, 'sieges.reliefsBeaten') >= 1,
        },
        STUFF_OF_SAGAS: {
            id: 'stuff_of_sagas', name: 'The Stuff of Sagas', description: 'Bring a saga you joined to a triumphant end', icon: '📖', tier: 'silver',
            check: (player) => Achievements._deed(player, 'sagas.won') >= 1,
        },
        SAGA_OF_AGES: {
            id: 'saga_of_ages', name: 'Saga of Ages', description: 'Win 3 sagas', icon: '🌠', tier: 'legendary',
            check: (player) => Achievements._deed(player, 'sagas.won') >= 3,
        },
        WYRMSLAYER: {
            id: 'wyrmslayer', name: 'Wyrmslayer', description: 'Slay the wyrm of "The Wyrm Wakes" saga', icon: '🐉', tier: 'legendary',
            check: (player) => Achievements._stat(player, 'saga_slain_wyrm_wakes') >= 1,
        },
        MONSTER_HUNTER: {
            id: 'monster_hunter', name: 'Monster Hunter', description: 'Claim the bounty on a saga beast cried on the notice boards', icon: '📯', tier: 'silver',
            check: (player) => Achievements._deed(player, 'bounty.beasts') >= 1,
        },
        A_CLAIM_TO_THE_THRONE: {
            id: 'a_claim_to_the_throne', name: 'A Claim to the Throne', description: 'Hold a claim on a throne', icon: '📜', tier: 'bronze',
            check: (player) => Achievements._deed(player, 'throne.claims') >= 1,
        },
        KINGMAKER: {
            id: 'kingmaker', name: 'Kingmaker', description: 'Back the claimant who wins a succession crisis', icon: '🎭', tier: 'gold',
            check: (player) => Achievements._stat(player, 'kingmaker') >= 1,
        },
        UNEASY_LIES_THE_HEAD: {
            id: 'uneasy_lies_the_head', name: 'Uneasy Lies the Head', description: 'Win a crown', icon: '👑', tier: 'gold',
            check: (player) => Achievements._deed(player, 'house.crowned') >= 1,
        },
        THE_FULL_COUNCIL: {
            id: 'the_full_council', name: 'The Full Council', description: 'Fill all five seats of your royal council', icon: '🏛️', tier: 'gold',
            check: (player) => {
                const court = Achievements._court(player);
                return !!(court && court.council) && Kingship.OFFICES.every(o => court.council[o]);
            },
        },
        LAWGIVER: {
            id: 'lawgiver', name: 'Lawgiver', description: 'Pass 5 royal edicts', icon: '🖋️', tier: 'silver',
            check: (player) => {
                const court = Achievements._court(player);
                return !!court && ((court.stats && court.stats.edictsPassed) || 0) >= 5;
            },
        },
        LONG_REIGN: {
            id: 'long_reign', name: 'Long Reign', description: 'Rule a realm for 10 years', icon: '⏳', tier: 'legendary',
            check: (player, world) => {
                const ruling = player.throne && player.throne.ruling;
                if (!ruling || !world || typeof world.day !== 'number') return false;
                return (world.day - (ruling.since || 0)) / Legacy._daysPerYear() >= Achievements.LONG_REIGN_YEARS;
            },
        },
        ONE_OF_THE_GUILD: {
            id: 'one_of_the_guild', name: 'One of the Guild', description: 'Join the Thieves\' Guild', icon: '🗝️', tier: 'bronze',
            check: (player) => Achievements._guildMember(player),
        },
        PRINCE_OF_THIEVES: {
            id: 'prince_of_thieves', name: 'Prince of Thieves', description: 'Rise to the top rank of the Thieves\' Guild', icon: '🌑', tier: 'gold',
            check: (player) => Achievements._guildMember(player) && Underworld.isGuildmaster(player),
        },
        CHARTERED_COMPANY: {
            id: 'chartered_company', name: 'Chartered Company', description: 'Found a trading company', icon: '🏦', tier: 'bronze',
            check: (player) => !!(player.merchant && player.merchant.company),
        },
        MERCHANT_PRINCE_OF_THE_SEAS: {
            id: 'merchant_prince_of_the_seas', name: 'Merchant Prince of the Seas', description: 'Run 5 trading posts and bring 10 company convoys in by ship', icon: '⛵', tier: 'legendary',
            check: (player) => Achievements._deed(player, 'company.posts') >= 5 && Achievements._stat(player, 'convoys_by_sea') >= 10,
        },
        HOSTILE_TAKEOVER: {
            id: 'hostile_takeover', name: 'Hostile Takeover', description: 'Buy out a rival merchant house', icon: '📈', tier: 'gold',
            check: (player) => ((player.merchant && player.merchant.rivals) || []).some(r => r && r.status === 'bought'),
        },
        LAND_HO: {
            id: 'land_ho', name: 'Land Ho!', description: 'Discover an uncharted land', icon: '🏝️', tier: 'bronze',
            check: (player) => Achievements._deed(player, 'discovery.found') >= 1,
        },
        CARTOGRAPHER_OF_THE_UNKNOWN: {
            id: 'cartographer_of_the_unknown', name: 'Cartographer of the Unknown', description: 'Name 5 lands you discovered', icon: '🧭', tier: 'gold',
            check: (player) => Achievements._deed(player, 'discovery.named') >= 5,
        },
        SEA_LEGS: {
            id: 'sea_legs', name: 'Sea Legs', description: 'Complete a voyage', icon: '🌊', tier: 'bronze',
            check: (player) => Achievements._deed(player, 'voyages.voyages') >= 1,
        },
        OLD_SALT: {
            id: 'old_salt', name: 'Old Salt', description: 'Spend 100 days at sea', icon: '⚓', tier: 'silver',
            check: (player) => Achievements._deed(player, 'voyages.daysAtSea') >= 100,
        },
        ADMIRAL: {
            id: 'admiral', name: 'Admiral', description: 'Command a fleet of 5 ships', icon: '🚢', tier: 'silver',
            check: (player) => (player.ships || []).length >= 5,
        },
        SURVIVED_THE_BLACK_DEATH: {
            id: 'survived_the_black_death', name: 'Survived the Black Death', description: 'Catch the plague and live', icon: '🐀', tier: 'gold',
            check: (player) => Achievements._stat(player, 'recovered_plague') >= 1,
        },
        MASTER_FORAGER: {
            id: 'master_forager', name: 'Master Forager', description: 'Reach the rank of Master Forager', icon: '🏵️', tier: 'gold',
            check: (player) => Foraging.skill(player).level >= FORAGE_RANKS.length - 1,
        },
        MASTER_OF_THE_HUNT: {
            id: 'master_of_the_hunt', name: 'Master of the Hunt', description: 'Reach the rank of Master of the Hunt', icon: '🐗', tier: 'gold',
            check: (player) => Hunting.skill(player).level >= HUNT_RANKS.length - 1,
        },
        A_PERSON_OF_CHARACTER: {
            id: 'a_person_of_character', name: 'A Person of Character', description: 'Earn 5 character traits', icon: '🎭', tier: 'silver',
            check: (player) => Traits.getEarned(player).length >= 5,
        },
        RAISED_RIGHT: {
            id: 'raised_right', name: 'Raised Right', description: 'Raise a child of your House to come of age', icon: '🎓', tier: 'silver',
            check: (player) => (player.children || []).some(c => c && c.upbringing && c.upbringing.comeOfAge && c.upbringing.comeOfAgeDay != null),
        },
        BLOOD_ROYAL: {
            id: 'blood_royal', name: 'Blood Royal', description: 'Marry a child of your House into a royal line', icon: '💍', tier: 'gold',
            check: (player) => (player.children || []).some(c => c && c.upbringing && c.upbringing.placement && c.upbringing.placement.kind === 'royal'),
        },
        THE_LINE_ENDURES: {
            id: 'the_line_endures', name: 'The Line Endures', description: 'Pass the House to an heir', icon: '🌳', tier: 'silver',
            check: (player) => ((player.house && player.house.reigns) || []).length >= 1,
        },
    },

    /** Terrain that counts as a mountain settlement. */
    MOUNTAIN_TERRAINS: ['mountain', 'hills', 'highlands', 'snow_peak'],

    /** Delve kinds (data/delves.json → kinds) for Every Dark Place. */
    DELVE_KINDS: ['sunken', 'tomb', 'ruins', 'mine', 'cave'],

    /** Years on the throne for Long Reign (a year is Legacy's days-per-year). */
    LONG_REIGN_YEARS: 10,

    /** An event counter recorded via Quests.track(). */
    _stat(player, stat) {
        return (player.quests && player.quests.stats && player.quests.stats[stat]) || 0;
    },

    /** Deeds.collect() of the player being checked (computed once per checkAchievements pass). */
    _deedCache: null,

    /** A counter another system keeps, read through Deeds & Records. */
    _deed(player, key) {
        const c = Achievements._deedCache;
        const deeds = c && c.player === player ? c.deeds : Deeds.collect(player);
        return deeds[key] || 0;
    },

    /** The royal court of the realm the player rules, or null (read-only). */
    _court(player) {
        const r = player && player.throne && player.throne.ruling;
        return (r && r.court) || null;
    },

    _guildMember(player) {
        return !!(player.underworld && player.underworld.guild && player.underworld.guild.member);
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

        Achievements._deedCache = { player, deeds: Deeds.collect(player) };
        try {
            for (const [id, achievement] of Object.entries(Achievements.ACHIEVEMENTS)) {
                // Skip if already unlocked
                if (player.achievements.unlocked.includes(id)) continue;

                // Check if achievement is unlocked
                if (achievement.check(player, world)) {
                    player.achievements.unlocked.push(id);
                    // The day it was won, for the Achievements list (Achievements.listing)
                    if (!player.achievements.progress || typeof player.achievements.progress !== 'object') player.achievements.progress = {};
                    player.achievements.progress[id] = { day: (world && world.day) || 0 };
                    newAchievements.push(achievement);
                }
            }
        } finally {
            Achievements._deedCache = null;
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

    TIERS: ['bronze', 'silver', 'gold', 'legendary'],

    /**
     * The Achievements list (Journal → Deeds & Records): per tier, every
     * achievement with whether it is won and the day it was (when known).
     * @returns {{ progress, tiers: [{ tier, items: [{ key, name, description, icon, unlocked, day }] }] }}
     */
    listing(player) {
        const st = (player && player.achievements) || { unlocked: [], progress: {} };
        const won = new Set(st.unlocked || []);
        const tiers = Achievements.TIERS.map(tier => ({
            tier,
            items: Object.entries(Achievements.ACHIEVEMENTS).filter(([, a]) => a.tier === tier).map(([key, a]) => ({
                key, name: a.name, description: a.description, icon: a.icon, unlocked: won.has(key),
                day: st.progress && st.progress[key] && typeof st.progress[key].day === 'number' ? st.progress[key].day : null,
            })),
        }));
        return { progress: Achievements.getProgress(player), tiers };
    },

    /**
     * Track miracle performed
     */
    trackMiracle(player) {
        if (!player.miraclesPerformed) player.miraclesPerformed = 0;
        player.miraclesPerformed++;
    },
};

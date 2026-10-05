// ============================================
// QUESTS — Quest and objective system
// ============================================

import { Utils } from '../core/utils.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { PlayerInventory } from '../core/inventory.js';
import { Traits } from './traits.js';
import { Deeds } from './deeds.js';
import { Ships } from './ships.js';
import { KingdomNavy } from '../world/kingdomNavy.js';


export const Quests = {
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
        A_NEW_BEGINNING: {
            id: 'a_new_beginning',
            title: 'A New Beginning',
            description: 'Explore nearby lands, discover settlements, and grow your influence.',
            type: 'exploration',
            objectives: [
                { type: 'tiles_explored_since', target: 2, current: 0, baseline: 0, text: 'Explore 2 more hexes' }
            ],
            rewards: { renown: 5 },
            difficulty: 'easy',
        },
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

        ARTIFACT_CHALICE_DAWN: {
            id: 'artifact_chalice_dawn',
            title: 'The Cup That Held the Sunrise',
            description: 'Gather the shards of the Chalice of Dawn from forgotten shrines and restore it.',
            type: 'exploration',
            objectives: [
                { type: 'artifact_fragments', artifactId: 'chalice_dawn', target: 3, current: 0, text: 'Collect 3 Chalice fragments' },
                { type: 'artifact_reforged', artifactId: 'chalice_dawn', target: 1, current: 0, text: 'Reforge the Chalice of Dawn' }
            ],
            rewards: { gold: 1000, renown: 30 },
            difficulty: 'hard',
        },
        ARTIFACT_BANNER_IRON_HOST: {
            id: 'artifact_banner_iron_host',
            title: 'Raise the Iron Standard',
            description: 'Recover the torn pieces of the Banner of the Iron Host and raise it once more.',
            type: 'exploration',
            objectives: [
                { type: 'artifact_fragments', artifactId: 'banner_iron_host', target: 4, current: 0, text: 'Collect 4 Banner fragments' },
                { type: 'artifact_reforged', artifactId: 'banner_iron_host', target: 1, current: 0, text: 'Reforge the Banner of the Iron Host' }
            ],
            rewards: { gold: 1400, renown: 40 },
            difficulty: 'hard',
        },
        ARTIFACT_LEDGER_COIN_KINGS: {
            id: 'artifact_ledger_coin_kings',
            title: 'Accounts of the Coin-Kings',
            description: 'Piece together the lost Ledger of the Coin-Kings from ruins and caves.',
            type: 'exploration',
            objectives: [
                { type: 'artifact_fragments', artifactId: 'ledger_coin_kings', target: 3, current: 0, text: 'Collect 3 Ledger fragments' },
                { type: 'artifact_reforged', artifactId: 'ledger_coin_kings', target: 1, current: 0, text: 'Reforge the Ledger of the Coin-Kings' }
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
     * What each NPC request actually asks of the player — a counter that must
     * rise by `target` after the task is accepted.
     */
    NPC_TASK_OBJECTIVES: {
        escort_trade_caravan: { stat: 'caravans_completed', target: 1, text: 'See a trade caravan safely through' },
        merchant_delivery:    { stat: 'trade_profit', target: 300, text: 'Earn 300 gold in trade profit' },
        clear_bandits:        { stat: 'battles_won', target: 2, text: 'Win 2 battles against the bandits' },
        fetch_item:           { stat: 'taverns_visited', target: 1, text: 'Search a tavern for the lost report' },
        investigate_threat:   { stat: 'battles_won', target: 1, text: 'Hunt down whatever is killing the livestock' },
        rescue_person:        { stat: 'ruins_explored', target: 1, text: 'Search the wilds for the missing son' },
        retrieve_relic:       { stat: 'ruins_explored', target: 1, text: 'Recover the relic from the ruins' },
        clear_undead:         { stat: 'battles_won', target: 1, text: 'Drive off the restless dead' },
        gather_resource:      { stat: 'ruins_explored', target: 1, text: 'Bring back rare ore from the deep places' },
        retrieve_item:        { stat: 'battles_won', target: 1, text: 'Track down the thief' },
        delivery:             { stat: 'settlements_visited', target: 2, text: 'Carry the delivery to 2 other settlements' },
        espionage:            { stat: 'informants_hired', target: 1, text: 'Hire an informant to steal the documents' },
        explore_ruins:        { stat: 'ruins_explored', target: 1, text: 'Explore the ancient ruins' },
        bounty:               { stat: 'battles_won', target: 1, text: 'Bring the bounty target to heel' },
    },

    /** Reward package per NPC reward kind. */
    NPC_TASK_REWARDS: {
        gold:       { gold: 200, renown: 3 },
        reputation: { renown: 15, gold: 50 },
        favor:      { gold: 100, renown: 5 },
        blessing:   { karma: 5, renown: 5 },
        equipment:  { gold: 120, renown: 5, items: { weapons: 1 } },
        gratitude:  { karma: 4, renown: 8 },
        treasure:   { gold: 320 },
    },

    /** Current value of a progress counter, wherever it is kept. */
    _counter(player, stat) {
        const qs = player.quests;
        if (stat === 'caravans_completed') return qs.caravansCompleted || 0;
        if (stat === 'contracts_completed') return qs.contractsCompleted || 0;
        if (stat === 'settlements_visited') return qs.settlementsVisited ? qs.settlementsVisited.size : 0;
        return (qs.stats && qs.stats[stat]) || 0;
    },

    /**
     * Turn a request an NPC made in conversation into a tracked quest.
     * @param {Object} hook  An NPC_QUEST_HOOKS entry ({ text, type, reward })
     * @param {Object} npc   The NPC who asked ({ id, name })
     * @returns {{ success: boolean, quest?: Object, reason?: string }}
     */
    createNpcTask(player, hook, npc, world = null) {
        if (!player.quests) Quests.initialize(player);
        const objDef = hook && Quests.NPC_TASK_OBJECTIVES[hook.type];
        if (!objDef) return { success: false, reason: 'Nothing concrete to do' };
        if (player.quests.active.length >= 5) return { success: false, reason: 'Too many active quests (max 5)' };
        const id = `npc_task_${npc && npc.id != null ? npc.id : 'x'}_${hook.type}`;
        if (player.quests.active.some(q => q.id === id)) return { success: false, reason: 'Already working on it' };
        const who = (npc && npc.name) || 'a local';
        const rewards = { ...(Quests.NPC_TASK_REWARDS[hook.reward] || Quests.NPC_TASK_REWARDS.gold) };
        const quest = {
            id,
            title: `A Favour for ${who}`,
            description: hook.text,
            type: 'npc_task',
            giver: { id: npc ? npc.id : null, name: who },
            objectives: [{
                type: 'counter_since', stat: objDef.stat, baseline: Quests._counter(player, objDef.stat),
                target: objDef.target, current: 0, text: objDef.text,
            }],
            rewards,
            difficulty: 'easy',
            status: 'active',
            startedAt: world ? world.day : 0,
        };
        player.quests.active.push(quest);
        return { success: true, quest };
    },

    /** "200 gold, 3 renown" — rewards as words. */
    describeRewards(rewards) {
        if (!rewards) return '';
        const parts = [];
        if (rewards.gold) parts.push(`${rewards.gold} gold`);
        if (rewards.renown) parts.push(`${rewards.renown} renown`);
        if (rewards.karma) parts.push(`${rewards.karma} karma`);
        for (const [item, n] of Object.entries(rewards.items || {})) parts.push(`${n} ${item.replace(/_/g, ' ')}`);
        return parts.join(', ');
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
                stats: {},
            };
        }
        if (!player.quests.stats) player.quests.stats = {};

        // Generate initial available quests
        Quests.generateAvailableQuests(player);
    },

    /**
     * Generate available quests based on player progress
     */
    /** The artifact a template is about (its objectives name it), or null. */
    _artifactOf(template) {
        const obj = (template.objectives || []).find(o => o.artifactId);
        return obj ? obj.artifactId : null;
    },

    /**
     * Objective types no game mechanic can advance yet. Quests needing them
     * aren't offered. (Empty now: heresies_suppressed is tracked by
     * Religion.suppressHeresy, alliances_formed by RealmPolitics.brokerAlliance.)
     */
    UNTRACKABLE_OBJECTIVES: [],

    /** How many quests the journal offers at once. */
    MAX_AVAILABLE: 5,

    /**
     * Difficulty tiers unlock as the player proves themselves: easy always,
     * medium after 2 completed quests or 25 renown, hard after 5 or 100,
     * legendary after 10 or 300.
     */
    _unlockedDifficulties(player) {
        const done = player.quests.completed.length;
        const renown = player.renown || 0;
        const tiers = ['easy'];
        if (done >= 2 || renown >= 25) tiers.push('medium');
        if (done >= 5 || renown >= 100) tiers.push('hard');
        if (done >= 10 || renown >= 300) tiers.push('legendary');
        return tiers;
    },

    /**
     * Refill the journal's offers from the whole template catalogue. Offers
     * already on the board stay; new ones are drawn (seeded RNG) from
     * templates the player hasn't taken, in difficulty tiers they've unlocked.
     * Artifact quests are offered as soon as a matching fragment is found.
     */
    generateAvailableQuests(player, world = null) {
        if (!player.quests) return;
        // An offer whose system has slipped out of reach (the ship sold, the
        // siege over) leaves the board — judged only when the world is known
        const offered = (player.quests.available || []).filter(q => q && (!world || Quests.isReachable(q, player, world)));
        const taken = (id) => Quests.hasQuest(player, id);

        // Artifact quests: only once the player holds a fragment
        const fragments = player.artifacts && player.artifacts.fragments ? player.artifacts.fragments : {};
        for (const [key, t] of Object.entries(Quests.QUEST_TEMPLATES)) {
            const artifactId = Quests._artifactOf(t);
            if (!artifactId || taken(t.id) || !(fragments[artifactId] > 0)) continue;
            const q = Quests.createQuest(key, player);
            if (q) offered.push(q);
        }

        const tiers = Quests._unlockedDifficulties(player);
        const pool = Object.entries(Quests.QUEST_TEMPLATES).filter(([, t]) =>
            !Quests._artifactOf(t) && !t.starter && tiers.includes(t.difficulty || 'easy')
            && !(t.objectives || []).some(o => Quests.UNTRACKABLE_OBJECTIVES.includes(o.type))
            && Quests.isReachable(t, player, world)
            && !taken(t.id) && !offered.some(o => o.id === t.id));
        // Fisher-Yates with the seeded RNG so offers are reproducible per seed
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Utils.randInt(0, i);
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        while (offered.length < Quests.MAX_AVAILABLE && pool.length > 0) {
            const q = Quests.createQuest(pool.shift()[0], player);
            if (q) offered.push(q);
        }
        player.quests.available = offered;
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
    acceptQuest(player, questId, world = null) {
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
        quest.startedAt = world ? world.day : 0;
        // "Since" objectives count only what is done from now on
        let deeds = null;
        for (const obj of quest.objectives || []) {
            if (!Quests.SINCE_OBJECTIVES.includes(obj.type)) continue;
            if (obj.type === 'deed_since' && !deeds) deeds = Deeds.collect(player);
            obj.baseline = Quests._sinceReading(player, obj, deeds);
            obj.current = 0;
        }

        player.quests.active.push(quest);
        player.quests.available.splice(questIndex, 1);
        Quests.generateAvailableQuests(player, world);

        return { success: true, quest };
    },

    /** Objectives that count from a baseline taken when the quest is accepted. */
    SINCE_OBJECTIVES: ['counter_since', 'deed_since', 'court_since'],

    /** The raw reading a "since" objective measures from (before the baseline). */
    _sinceReading(player, obj, deeds = null) {
        if (obj.type === 'counter_since') return Quests._counter(player, obj.stat);
        if (obj.type === 'deed_since') return (deeds || Deeds.collect(player))[obj.key] || 0;
        if (obj.type === 'court_since') {
            const court = player.throne && player.throne.ruling && player.throne.ruling.court;
            return (court && court.stats && court.stats[obj.stat]) || 0;
        }
        return 0;
    },

    /**
     * Gates for quests that send the player into a system: a template's
     * `requires` (a name or a list) must all hold for it to be offered.
     * Each reads player state only (world when given); none creates state.
     */
    REQUIREMENTS: {
        // A ship of one's own, or standing in a port where one can take passage
        seafarer: (p, w) => (p.ships || []).length > 0
            || !!(w && typeof w.getTile === 'function' && typeof p.q === 'number' && Ships.isPortTile(w, p.q, p.r)),
        company: (p) => !!(p.merchant && p.merchant.company),
        holdings: (p) => ((p.holdings && p.holdings.keys) || []).length > 0,
        // Petitioners come to the player's holdings
        court: (p) => Quests.REQUIREMENTS.holdings(p) || ((p.petitions && p.petitions.pending) || []).length > 0,
        rivals: (p) => ((p.rivals && p.rivals.list) || []).some(r => r && !r.dead),
        sagaBeast: (p) => ((p.sagas && p.sagas.active) || []).some(s => (s.units || []).some(u => u && !u.slain && !u.gone)),
        // A holding of the player's under siege, or a siege-relief contract for the company
        besieged: (p) => Object.keys((p.realmWars && p.realmWars.besieged) || {}).length > 0
            || (!!(p.merchant && p.merchant.company)
                && [...(p.merchant.board || []), ...(p.merchant.company.contracts || [])].some(c => c && c.defId === 'siege_relief')),
        siegeCamp: (p) => !!(p.sieges && p.sieges.active),
        army: (p) => (p.army || []).length >= 3,
        ruler: (p) => !!(p.throne && p.throne.ruling),
        crisis: (p) => ((p.throne && p.throne.crises) || []).length > 0,
        underworld: (p) => !!(p.underworld && p.underworld.guild && (p.underworld.guild.member || p.underworld.guild.contactMet)),
        blockade: (p, w) => !!w && (w.kingdoms || []).some(k => k && k.isAlive !== false && KingdomNavy.isBlockaded(k)),
        companions: (p) => (p.travelParty || []).length > 0,
    },

    /** Can this template (or offer) be offered now? Unknown requirements never pass. */
    isReachable(template, player, world = null) {
        const req = template && template.requires;
        if (!req) return true;
        return (Array.isArray(req) ? req : [req]).every(r => {
            const fn = Quests.REQUIREMENTS[r];
            return typeof fn === 'function' && !!fn(player, world);
        });
    },

    /**
     * Update quest progress
     */
    updateProgress(player, world) {
        if (player.quests) Quests._tidyBoard(player, world);
        if (!player.quests || player.quests.active.length === 0) return [];

        const completed = [];
        let deeds = null;

        for (const quest of player.quests.active) {
            let allComplete = true;

            for (const objective of quest.objectives) {
                // Update objective progress
                switch (objective.type) {
                    case 'deed_since':
                        if (!deeds) deeds = Deeds.collect(player);
                        objective.current = Math.max(0, Quests._sinceReading(player, objective, deeds) - (objective.baseline || 0));
                        break;
                    case 'court_since':
                        objective.current = Math.max(0, Quests._sinceReading(player, objective) - (objective.baseline || 0));
                        break;
                    case 'deliver_item':
                        // Goods carried for the giver; handed over when the quest completes
                        objective.current = Math.min(objective.target, (player.inventory && player.inventory[objective.item]) || 0);
                        break;
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
                    case 'tiles_explored_since': {
                        // Progress relative to a baseline captured when the
                        // quest was granted, so it reads "explore N more hexes".
                        let sinceCount = 0;
                        for (let r = 0; r < world.height; r++) {
                            for (let q = 0; q < world.width; q++) {
                                if (world.tiles[r][q].explored) sinceCount++;
                            }
                        }
                        objective.current = Math.max(0, sinceCount - (objective.baseline || 0));
                        break;
                    }
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
                    case 'technologies_researched':
                        objective.current = (player.technology && player.technology.implemented || []).length;
                        break;
                    case 'counter_since':
                        objective.current = Math.max(0, Quests._counter(player, objective.stat) - (objective.baseline || 0));
                        break;
                    case 'quests_completed':
                        objective.current = player.quests.completed.length;
                        break;
                    case 'mountain_tiles_explored': {
                        let mountains = 0;
                        for (let r = 0; r < world.height; r++) {
                            for (let q = 0; q < world.width; q++) {
                                const t = world.tiles[r][q];
                                if (t.explored && Quests.MOUNTAIN_TERRAINS.includes(t.terrain.id)) mountains++;
                            }
                        }
                        objective.current = mountains;
                        break;
                    }
                    default:
                        // Event counters recorded via Quests.track()
                        objective.current = player.quests.stats[objective.type] || 0;
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

                // Hand over the goods the giver asked for
                Quests._handOver(player, quest);
                // Grant rewards
                Quests.grantRewards(player, quest);
                Traits.recordDeed(player, 'honesty', 2); // a promise kept
            }
        }

        // Generate new quests
        if (completed.length > 0) {
            Quests.generateAvailableQuests(player, world);
        }

        return completed;
    },

    /** A completed quest's deliver_item objectives take the goods from the packs. */
    _handOver(player, quest) {
        for (const obj of quest.objectives || []) {
            if (obj.type !== 'deliver_item' || !player.inventory) continue;
            const left = Math.max(0, (player.inventory[obj.item] || 0) - obj.target);
            if (left > 0) player.inventory[obj.item] = left;
            else delete player.inventory[obj.item];
        }
    },

    /**
     * Daily board upkeep: offers whose system is out of reach are dropped,
     * and a short board is refilled. Draws RNG only when it refills.
     */
    _tidyBoard(player, world) {
        if (!world || !Array.isArray(player.quests.available)) return;
        const before = player.quests.available.length;
        const kept = player.quests.available.filter(q => q && Quests.isReachable(q, player, world));
        if (kept.length === before) return;
        player.quests.available = kept;
        Quests.generateAvailableQuests(player, world);
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

        if (rewards.items) {
            // Goods that won't fit in full packs are sold on the spot
            const res = PlayerInventory.addOrSell(player, rewards.items);
            if (res.gold > 0) quest.overflowSold = { items: res.sold, gold: res.gold };
        }

        return rewards;
    },

    /** Terrain that counts for "explore mountain tiles" objectives. */
    MOUNTAIN_TERRAINS: ['mountain', 'snow_peak', 'highlands'],

    /**
     * Record a game event for quest objectives whose type is the stat name
     * (e.g. 'battles_won', 'ruins_explored', 'trade_profit').
     */
    track(player, stat, amount = 1) {
        if (!player || !player.quests) return;
        if (!player.quests.stats) player.quests.stats = {};
        player.quests.stats[stat] = (player.quests.stats[stat] || 0) + amount;
        Traits.recordStat(player, stat, amount); // deeds shape character traits
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
        Traits.recordDeed(player, 'honesty', 2);
    },

    /**
     * Track temple built
     */
    trackTempleBuilt(player) {
        if (!player.quests) return;
        player.quests.templesBuilt = (player.quests.templesBuilt || 0) + 1;
        Traits.recordDeed(player, 'piety', 3);
    },

    /**
     * Track settlement visited
     */
    trackSettlementVisited(player, settlementName) {
        if (!player.quests) return;
        if (!player.quests.settlementsVisited) player.quests.settlementsVisited = new Set();
        if (!player.quests.settlementsVisited.has(settlementName)) Traits.recordDeed(player, 'travel');
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

    /**
     * Grant the intro "A New Beginning" quest as an active quest at game start.
     * Captures the current explored-tile count as a baseline so the objective
     * reads "explore 2 MORE hexes". Idempotent.
     */
    grantStarterQuest(player, world) {
        if (!player.quests) return;
        if (Quests.hasQuest(player, 'a_new_beginning')) return;

        const quest = Quests.createQuest('A_NEW_BEGINNING', player);
        if (!quest) return;

        // Baseline = tiles already explored at grant time.
        let explored = 0;
        if (world && world.tiles) {
            for (let r = 0; r < world.height; r++) {
                for (let q = 0; q < world.width; q++) {
                    if (world.tiles[r][q].explored) explored++;
                }
            }
        }
        for (const obj of quest.objectives) {
            if (obj.type === 'tiles_explored_since') {
                obj.baseline = explored;
                obj.current = 0;
            }
        }

        quest.status = 'active';
        quest.startedAt = world ? world.day : 0;
        player.quests.active.push(quest);
    },
};

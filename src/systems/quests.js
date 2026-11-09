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
import { Economy } from '../world/economy.js';
import { NpcTasks } from './npcTasks.js';


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

    /**
     * Reward package per NPC reward kind. `reputation` is standing with the
     * realm the task was given in (createNpcTask pins it to that kingdom).
     */
    NPC_TASK_REWARDS: {
        gold:       { gold: 200, renown: 3 },
        reputation: { renown: 10, gold: 50, reputation: 8 },
        favor:      { gold: 100, renown: 5, reputation: 3 },
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
        // Standing is earned with the realm the giver lives in (none outside one)
        const tile = world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        const kingdomId = tile ? (tile.kingdom || (tile.settlement && tile.settlement.kingdom) || null) : null;
        if (rewards.reputation) {
            if (kingdomId) rewards.reputation = { kingdomId, amount: rewards.reputation };
            else delete rewards.reputation;
        }
        const quest = {
            id,
            title: `A Favour for ${who}`,
            description: hook.text,
            type: 'npc_task',
            giver: { id: npc ? (npc.uid || npc.id) : null, name: who, kingdomId },
            objectives: [{
                type: 'counter_since', stat: objDef.stat, baseline: Quests._counter(player, objDef.stat),
                target: objDef.target, current: 0, text: objDef.text,
            }],
            rewards,
            difficulty: 'easy',
            status: 'active',
            startedAt: world ? world.day : 0,
        };
        Quests._notePayer(quest, player, world);
        // Made concrete: a real place, band or person, and back to the giver (systems/npcTasks.js)
        const taskId = NpcTasks.taskFor(hook);
        if (taskId && world && tile) {
            const giver = Quests._giverOf(npc, world, player, who, kingdomId);
            const built = NpcTasks.build(taskId, { player, world, giver, seed: `${id}|${world.day || 0}` });
            if (built) Quests._applyTask(quest, taskId, built, giver, world);
        }
        player.quests.active.push(quest);
        return { success: true, quest };
    },

    /** Who asked, and where they live: a townsperson's home from their uid, else where the player stands. */
    _giverOf(npc, world, player, name, kingdomId) {
        const uid = npc && typeof npc.uid === 'string' && NpcTasks.parseUid(npc.uid) ? npc.uid : null;
        const at = uid ? NpcTasks.parseUid(uid) : { q: player.q, r: player.r };
        const tile = world && typeof world.getTile === 'function' ? world.getTile(at.q, at.r) : null;
        return {
            id: npc ? (npc.uid || npc.id) : null, uid, name, kingdomId,
            q: at.q, r: at.r, town: (tile && tile.settlement && tile.settlement.name) || 'town',
        };
    },

    /** Put a built task (NpcTasks.build) on a quest. */
    _applyTask(quest, taskId, built, giver, world) {
        quest.v = 2;
        quest.task = taskId;
        quest.giver = giver;
        quest.objectives = built.objectives;
        quest.item = built.item;
        quest.carrying = null;
        quest.person = built.person || null;
        quest.alt = built.alt || null;
        quest.deadlineDay = built.deadline;
        if (built.person) NpcTasks.hideKid(world, built.person, quest.objectives[0] && (quest.objectives[0].name || quest.objectives[0].town));
    },

    /** "200 gold, 3 renown" — rewards as words. */
    describeRewards(rewards) {
        if (!rewards) return '';
        const parts = [];
        if (rewards.gold) parts.push(`${rewards.gold} gold`);
        if (rewards.renown) parts.push(`${rewards.renown} renown`);
        if (rewards.karma) parts.push(`${rewards.karma} karma`);
        if (rewards.reputation && rewards.reputation.amount) parts.push(`${rewards.reputation.amount} reputation`);
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
     * The board is refreshed every BOARD_REFRESH_DAYS: postings older than
     * OFFER_TTL_DAYS come down (artifact quests stay while the fragment is
     * held) and are not posted again for EXPIRED_COOLDOWN_DAYS, and a short
     * board is refilled from the catalogue.
     */
    BOARD_REFRESH_DAYS: 7,
    OFFER_TTL_DAYS: 30,
    EXPIRED_COOLDOWN_DAYS: 30,

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
        // A posting that came down stale isn't put straight back up
        const day = world && typeof world.day === 'number' ? world.day : null;
        const cooling = player.quests.expired || {};
        const resting = (id) => day != null && typeof cooling[id] === 'number' && cooling[id] > day;
        const pool = Object.entries(Quests.QUEST_TEMPLATES).filter(([, t]) =>
            !Quests._artifactOf(t) && !t.starter && tiers.includes(t.difficulty || 'easy') && !resting(t.id)
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
        // Date the new postings (only when the day is known; old ones are dated at the next refresh)
        if (day != null) for (const q of offered) Quests._stampPosting(q, day);
        player.quests.available = offered;
    },

    /** Give an offer its posting date and, unless it is an artifact quest, the day it comes down. */
    _stampPosting(q, day) {
        if (!q || typeof q.postedDay === 'number') return;
        q.postedDay = day;
        if (!Quests._artifactOf(q)) q.expiresDay = day + Quests.OFFER_TTL_DAYS;
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
        delete quest.postedDay; // a taken quest no longer comes down with the board
        delete quest.expiresDay;
        quest.startedAt = world ? world.day : 0;
        Quests._notePayer(quest, player, world);
        // Targets named on taking the quest (a tomb, a lair, a town), or the general objective
        Quests._resolveSpecs(quest, player, world);
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

        const failed = [];
        for (const quest of player.quests.active) {
            let allComplete = true;
            Quests._prepare(quest, player, world);
            let failure = null;

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
                    case 'site_delved':
                    case 'lair_cleared':
                    case 'foe_slain':
                    case 'visit_towns': {
                        // A named place, lair or band (systems/npcTasks.js)
                        const res = NpcTasks.evaluate(objective, player, world);
                        objective.current = res.current;
                        if (res.failed && !failure) failure = res.failed;
                        break;
                    }
                    case 'talk_to':
                    case 'return_to':
                        // Done in conversation (Quests.talkToTask / handInNpcTask)
                        objective.current = objective.current || 0;
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
                // Goods for a named town count only once they are there
                if (objective.type === 'deliver_item' && objective.atQ != null && !(player.q === objective.atQ && player.r === objective.atR)) objective.completed = false;
                if (!objective.completed) allComplete = false;
            }

            if (quest.v === 2) {
                Quests._noteFound(player, quest);
                if (!failure && typeof quest.deadlineDay === 'number' && world && typeof world.day === 'number' && world.day > quest.deadlineDay && !allComplete) {
                    failure = 'the time ran out';
                }
            }
            if (failure && quest.status === 'active') {
                failed.push({ quest, reason: failure });
                continue;
            }

            // Check if quest is complete
            if (allComplete && quest.status === 'active') {
                quest.status = 'completed';
                completed.push(quest);
            }
        }

        for (const f of failed) Quests._failTask(player, world, f.quest, f.reason);

        // Move completed quests
        for (const quest of completed) {
            const index = player.quests.active.findIndex(q => q.id === quest.id);
            if (index !== -1) {
                player.quests.active.splice(index, 1);
                player.quests.completed.push(quest);

                // Hand over the goods the giver asked for
                Quests._handOver(player, quest);
                // Grant rewards
                Quests.grantRewards(player, quest, world);
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
        const q = player.quests;
        const before = q.available.length;
        let kept = q.available.filter(o => o && Quests.isReachable(o, player, world));
        let changed = kept.length !== before;
        // The weekly refresh: stale postings come down, a short board refills
        const day = typeof world.day === 'number' ? world.day : null;
        if (day != null && !(day - (typeof q.lastBoardDay === 'number' ? q.lastBoardDay : -Infinity) < Quests.BOARD_REFRESH_DAYS)) {
            q.lastBoardDay = day;
            if (!q.expired || typeof q.expired !== 'object') q.expired = {};
            for (const [id, until] of Object.entries(q.expired)) if (!(until > day)) delete q.expired[id];
            for (const o of kept) Quests._stampPosting(o, day);
            const fresh = kept.filter(o => !(typeof o.expiresDay === 'number' && day >= o.expiresDay));
            for (const o of kept) if (!fresh.includes(o)) q.expired[o.id] = day + Quests.EXPIRED_COOLDOWN_DAYS;
            if (fresh.length !== kept.length) changed = true;
            kept = fresh;
            if (kept.length < Quests.MAX_AVAILABLE) changed = true;
        }
        if (!changed) return;
        q.available = kept;
        // Draws RNG only when there is room on the board
        if (kept.length < Quests.MAX_AVAILABLE) Quests.generateAvailableQuests(player, world);
    },

    /**
     * Grant quest rewards
     */
    /** The town a quest was taken in pays its gold reward (quest.payer: { q, r }). */
    _notePayer(quest, player, world) {
        if (!quest || quest.payer || !world || typeof world.getTile !== 'function' || !player) return;
        const t = world.getTile(player.q, player.r);
        if (t && t.settlement) quest.payer = { q: t.q != null ? t.q : player.q, r: t.r != null ? t.r : player.r };
    },

    /**
     * Grant quest rewards. The gold comes out of the purse of the town the
     * quest was taken in (quest.payer), as much as it holds; a quest taken in
     * the wilds (or before towns kept purses) pays in full.
     */
    grantRewards(player, quest, world = null) {
        const rewards = quest.rewards;

        if (rewards.gold) {
            const t = quest.payer && world && typeof world.getTile === 'function' ? world.getTile(quest.payer.q, quest.payer.r) : null;
            const town = t && t.settlement;
            const purse = Economy.townPurse(town);
            const pay = purse == null ? rewards.gold : Math.min(rewards.gold, Math.floor(purse));
            if (purse != null) Economy.drawTown(town, pay);
            if (pay < rewards.gold) quest.rewardShort = rewards.gold - pay;
            player.gold += pay;
        }

        if (rewards.karma) {
            player.karma += rewards.karma;
        }

        if (rewards.renown) {
            player.renown += rewards.renown;
        }

        // Standing with the realm an NPC's task was given in
        const rep = rewards.reputation;
        if (rep && rep.kingdomId && rep.amount) {
            if (!player.reputation) player.reputation = {};
            player.reputation[rep.kingdomId] = Utils.clamp((player.reputation[rep.kingdomId] || 0) + rep.amount, -100, 100);
        }

        // The NPC who asked owes the player thanks (Quests.collectThanks, on next speaking);
        // a task handed in to their face was thanked there and then
        if (quest.type === 'npc_task' && !quest.handedIn && quest.giver && quest.giver.id != null && player.quests) {
            const owed = player.quests.thanksOwed && typeof player.quests.thanksOwed === 'object' ? player.quests.thanksOwed : {};
            owed[quest.giver.id] = { name: quest.giver.name, title: quest.title };
            const keys = Object.keys(owed);
            for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete owed[k];
            player.quests.thanksOwed = owed;
        }

        if (rewards.items) {
            // Goods that won't fit in full packs are sold on the spot
            const res = PlayerInventory.addOrSell(player, rewards.items);
            if (res.gold > 0) quest.overflowSold = { items: res.sold, gold: res.gold };
        }

        return rewards;
    },

    /**
     * The player speaks again with an NPC whose task they finished: the
     * thanks owed (or null), consumed. Matched by id and name.
     */
    collectThanks(player, npc) {
        const owed = player && player.quests && player.quests.thanksOwed;
        if (!owed || !npc || npc.id == null) return null;
        const key = npc.uid && owed[npc.uid] ? npc.uid : npc.id;
        const t = owed[key];
        if (!t || (t.name && npc.name && t.name !== npc.name)) return null;
        delete owed[key];
        return t;
    },

    // ──────────── CONCRETE TARGETS (systems/npcTasks.js) ────────────

    /**
     * A quest-board objective that names a target (a template objective with
     * a `fallback`) becomes concrete when the quest is taken — the nearest
     * tomb, lair or town — or the general objective when nothing fits.
     */
    _resolveSpecs(quest, player, world) {
        const objs = quest.objectives || [];
        for (let i = 0; i < objs.length; i++) {
            const spec = objs[i];
            if (!spec || !spec.fallback || spec.resolved) continue;
            const concrete = world ? NpcTasks.resolveBoard(spec, player, world, quest.id) : null;
            objs[i] = concrete || { ...spec.fallback, current: 0 };
        }
    },

    /** Before a day's progress: an old save's general NPC task is made concrete; a board spec is resolved. */
    _prepare(quest, player, world) {
        if ((quest.objectives || []).some(o => o && o.fallback && !o.resolved)) {
            Quests._resolveSpecs(quest, player, world);
        }
        if (quest.type === 'npc_task' && !quest.v) Quests._migrateLegacy(quest, player, world);
    },

    /**
     * Saves from before concrete tasks: a request still open ("explore any
     * ruin") is given a real target from where its giver lives (or where the
     * player stands). Done once per quest; left general when nothing fits.
     */
    _migrateLegacy(quest, player, world) {
        if (!world || !Array.isArray(world.tiles) || !world.tiles.length || typeof world.getTile !== 'function') return;
        quest.v = 1;
        const o = quest.objectives && quest.objectives[0];
        if (!o || o.type !== 'counter_since' || Quests._counter(player, o.stat) - (o.baseline || 0) >= o.target) return;
        const type = Object.keys(Quests.NPC_TASK_OBJECTIVES).find(k => Quests.NPC_TASK_OBJECTIVES[k].text === o.text);
        let taskId = type ? NpcTasks.LEGACY_TASK[type] : null;
        const desc = String(quest.description || '');
        if (type === 'retrieve_item' && /locket/i.test(desc)) taskId = 'lost_locket';
        if (type === 'delivery' && /challenge/i.test(desc)) taskId = 'deliver_challenge';
        if (!taskId) return;
        const g = quest.giver || {};
        const giver = Quests._giverOf(typeof g.id === 'string' ? { uid: g.id, id: g.id } : null, world, player, g.name || 'a local', g.kingdomId || null);
        if (giver.id == null) giver.id = g.id != null ? g.id : null;
        const built = NpcTasks.build(taskId, { player, world, giver, seed: `${quest.id}|${world.day || 0}|old` });
        if (!built) return;
        Quests._applyTask(quest, taskId, built, giver, world);
        quest.migrated = true;
    },

    /** The thing (or person) a task was after is found: carried now, back to the giver. */
    _noteFound(player, quest) {
        if (quest.carrying || !quest.item) return;
        const find = (quest.objectives || []).filter(o => o.type !== 'return_to');
        if (!find.length || !find.every(o => o.current >= o.target)) return;
        if (find.some(o => o.type === 'talk_to' || o.type === 'deliver_item')) return; // set in conversation / carried as goods
        const ret = quest.objectives.find(o => o.type === 'return_to');
        quest.carrying = quest.item;
        Quests._notice(player, '📜 Found', ret
            ? `${Quests._cap(quest.item)} — now take ${quest.person ? 'them' : 'it'} back to ${ret.giver} in ${ret.town}.`
            : `${Quests._cap(quest.item)} — ${quest.title} is done.`, 'success');
    },

    _cap(s) { return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : ''; },

    /** A note for the day's end (Quests.takeNotices). */
    _notice(player, title, text, type = 'info') {
        if (!player || !player.quests) return;
        if (!Array.isArray(player.quests.notices)) player.quests.notices = [];
        player.quests.notices.push({ title, text, type });
        if (player.quests.notices.length > 12) player.quests.notices.splice(0, player.quests.notices.length - 12);
    },

    /** Notices since last asked (found, failed), cleared. */
    takeNotices(player) {
        const n = player && player.quests && Array.isArray(player.quests.notices) ? player.quests.notices : [];
        if (player && player.quests) player.quests.notices = [];
        return n;
    },

    /** A task that can no longer be done: the giver is let down. */
    _failTask(player, world, quest, reason) {
        const i = player.quests.active.indexOf(quest);
        if (i === -1) return;
        player.quests.active.splice(i, 1);
        quest.status = 'failed';
        quest.failReason = reason;
        quest.endedDay = world && typeof world.day === 'number' ? world.day : null;
        if (!Array.isArray(player.quests.failed)) player.quests.failed = [];
        player.quests.failed.push(quest);
        const cap = NpcTasks.config().maxFailed;
        if (player.quests.failed.length > cap) player.quests.failed.splice(0, player.quests.failed.length - cap);
        const g = quest.giver;
        // A plea pressed on a famous visitor was never agreed to: the asker is only a little disappointed
        if (g && g.id != null && quest.fameRequest) {
            Quests._grieve(player, g, { kind: 'letDown', text: 'I suppose someone like you has greater cares than mine.', delta: Math.round(NpcTasks.config().failDisposition / 4) });
        } else if (g && g.id != null) {
            const what = quest.item ? `bring back ${quest.item}` : 'what you promised';
            Quests._grieve(player, g, { kind: 'letDown', text: `You never did ${what}. I counted on you.`, delta: NpcTasks.config().failDisposition });
        }
        Quests._notice(player, '📜 Task Failed', `${quest.title}: ${reason}.`, 'warning');
    },

    /** Remember what the giver will say (and feel) the next time the player speaks with them. */
    _grieve(player, giver, g) {
        const map = player.quests.grievances && typeof player.quests.grievances === 'object' ? player.quests.grievances : {};
        map[giver.id] = { name: giver.name, ...g };
        const keys = Object.keys(map);
        for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete map[k];
        player.quests.grievances = map;
    },

    /** A let-down or a betrayal the NPC holds against the player (or null), consumed. */
    collectGrievance(player, npc) {
        const map = player && player.quests && player.quests.grievances;
        if (!map || !npc) return null;
        const key = npc.uid && map[npc.uid] ? npc.uid : npc.id;
        const g = key != null ? map[key] : null;
        if (!g || (g.name && npc.name && g.name !== npc.name)) return null;
        delete map[key];
        return g;
    },

    _activeTask(player, questId) {
        const quest = player && player.quests && player.quests.active.find(q => q.id === questId);
        return quest && quest.v === 2 ? quest : null;
    },

    /** Everything before the return to the giver is done. */
    taskReady(quest) {
        return !!quest && (quest.objectives || []).filter(o => o.type !== 'return_to').every(o => o.current >= o.target);
    },

    /** A line of a task's definition, filled in with its names. */
    taskLine(quest, key) {
        const def = NpcTasks.task(quest && quest.task);
        if (!def || !def[key]) return null;
        const find = quest.objectives.find(o => o.type !== 'return_to') || {};
        const vars = {
            giver: quest.giver && quest.giver.name, town: quest.giver && quest.giver.town,
            person: quest.person ? quest.person.name : find.person, target: find.name || find.town,
        };
        return String(def[key]).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    },

    /**
     * Talk to the person a task names (or a townsperson standing in for them):
     * hand over what was carried, or get what they hold. `how` for a guarded
     * holder: 'bribe' (gold) or 'steal' (the caller rolled `stole`).
     */
    talkToTask(player, world, questId, how = 'ask', stole = false) {
        const quest = Quests._activeTask(player, questId);
        const o = quest && NpcTasks.nextObjective(quest);
        if (!o || o.type !== 'talk_to') return { success: false, reason: 'Nothing to do here for that task' };
        let cost = 0;
        if (o.mode === 'fetch' && o.guarded) {
            if (how === 'bribe') {
                cost = 80;
                if ((player.gold || 0) < cost) return { success: false, reason: `You need ${cost} gold` };
                player.gold -= cost;
            } else if (how === 'steal') {
                if (!stole) {
                    Traits.recordDeed(player, 'greed', 0.5);
                    return { success: false, caught: true, reason: 'Caught with a hand in the papers' };
                }
            } else {
                return { success: false, refused: true, line: Quests.taskLine(quest, 'holderLine') };
            }
        }
        o.current = 1;
        o.completed = true;
        quest.carrying = o.reply || (o.mode === 'fetch' ? (o.item || quest.item) : null);
        let line = null;
        if (o.mode === 'deliver') line = Quests.taskLine(quest, 'recipientLine');
        else if (how === 'bribe') line = '*counts the coin, then hands the papers over without a word*';
        else if (how !== 'steal') line = Quests.taskLine(quest, 'holderLine');
        // The recipient remembers who brought it
        if (o.uid && o.mode === 'deliver') NpcTasks.remember(world, o.uid, 'favour', quest.title, 5);
        const ret = quest.objectives.find(x => x.type === 'return_to');
        if (!ret) {
            // Nobody to go back to: done here
            Quests._complete(player, world, quest, 'done');
            Quests.grantRewards(player, quest, world);
        }
        return { success: true, quest, line, cost, carrying: quest.carrying, done: !ret };
    },

    /** Move a task off the active list with how it ended. */
    _complete(player, world, quest, outcome) {
        const i = player.quests.active.indexOf(quest);
        if (i !== -1) player.quests.active.splice(i, 1);
        quest.status = 'completed';
        quest.outcome = outcome;
        quest.endedDay = world && typeof world.day === 'number' ? world.day : null;
        player.quests.completed.push(quest);
    },

    /**
     * Hand a finished task in to its giver, face to face: the reward, the
     * thing brought back (a child home again), and their thanks.
     * @returns {{ success, quest?, line?, disposition?, reason? }}
     */
    handInNpcTask(player, world, questId) {
        const quest = Quests._activeTask(player, questId);
        if (!quest) return { success: false, reason: 'No such task' };
        if (!Quests.taskReady(quest)) return { success: false, reason: 'Not done yet' };
        const ret = quest.objectives.find(o => o.type === 'return_to');
        if (ret) { ret.current = 1; ret.completed = true; }
        quest.handedIn = true;
        Quests._complete(player, world, quest, 'returned');
        Quests._handOver(player, quest);
        Quests.grantRewards(player, quest, world);
        Traits.recordDeed(player, 'honesty', 2); // a promise kept
        if (quest.person) NpcTasks.settleKid(world, quest.person, true);
        if (quest.giver && quest.giver.uid) NpcTasks.remember(world, quest.giver.uid, 'favour', quest.title);
        Quests.generateAvailableQuests(player, world);
        return { success: true, quest, line: Quests.taskLine(quest, 'handIn'), disposition: NpcTasks.config().returnDisposition };
    },

    /**
     * Turn down a plea pressed on a famous visitor (systems/fame.js
     * townRequest): it never was agreed to, so saying no outright stings
     * less than letting it lapse, and the pleas return to the town in time.
     */
    declinePlea(player, world, questId) {
        const act = player && player.quests && Array.isArray(player.quests.active) ? player.quests.active : [];
        const quest = act.find(q => q && q.id === questId && q.fameRequest);
        if (!quest) return { success: false, reason: 'No such plea.' };
        act.splice(act.indexOf(quest), 1);
        quest.status = 'declined';
        quest.endedDay = world && typeof world.day === 'number' ? world.day : null;
        const g = quest.giver;
        if (g && g.id != null) Quests._grieve(player, g, { kind: 'letDown', text: 'You told me plainly. I will not ask again.', delta: Math.round(NpcTasks.config().failDisposition / 8) });
        return { success: true, quest, message: `You tell ${g && g.name ? g.name : 'them'} you cannot help.` };
    },

    /**
     * The other way out of a task, taken from the journal: sell the locket,
     * keep the sword, let the son go. Pays what the choice pays; the giver
     * hears of it and holds it against the player.
     */
    resolveTaskAlt(player, world, questId) {
        const quest = Quests._activeTask(player, questId);
        if (!quest || !quest.alt) return { success: false, reason: 'No other way out of this one' };
        if (!Quests.taskReady(quest)) return { success: false, reason: 'You have not found it yet' };
        const alt = quest.alt;
        const got = {};
        if (alt.gold) { player.gold = (player.gold || 0) + alt.gold; got.gold = alt.gold; }
        if (alt.items) got.items = PlayerInventory.addOrSell(player, alt.items);
        if (alt.karma) player.karma = (player.karma || 0) + alt.karma;
        if (alt.keepRenown && quest.rewards && quest.rewards.renown) { player.renown = (player.renown || 0) + quest.rewards.renown; got.renown = quest.rewards.renown; }
        if (alt.karma < 0) Traits.recordDeed(player, 'greed', 2);
        // The other side of the bargain: the person the task named (the rival
        // whose documents you hand back) is in your debt — their disposition,
        // their thanks next time you speak, and your name in their realm
        const held = (quest.objectives || []).find(o => o.type === 'talk_to' && o.mode === 'fetch' && o.uid);
        if (held && (alt.holderDisposition || alt.holderThanks || alt.holderReputation)) {
            if (alt.holderDisposition) NpcTasks.remember(world, held.uid, 'favour', quest.title, alt.holderDisposition);
            if (alt.holderThanks && player.quests) {
                const owed = player.quests.thanksOwed && typeof player.quests.thanksOwed === 'object' ? player.quests.thanksOwed : {};
                owed[held.uid] = { name: held.person, title: quest.title };
                player.quests.thanksOwed = owed;
            }
            const tile = world && typeof world.getTile === 'function' && held.q != null ? world.getTile(held.q, held.r) : null;
            const kId = tile && tile.settlement ? tile.settlement.kingdom : null;
            if (kId && alt.holderReputation) {
                if (!player.reputation) player.reputation = {};
                player.reputation[kId] = (player.reputation[kId] || 0) + alt.holderReputation;
                got.reputation = alt.holderReputation;
            }
            got.holder = held.person;
        }
        if (alt.karma) got.karma = alt.karma;
        Quests._complete(player, world, quest, alt.id || 'alt');
        if (quest.person) {
            const g = quest.giver || {};
            const town = NpcTasks.findTown(world, g.q, g.r, { seed: `${quest.id}|gone`, range: [4, 30] });
            NpcTasks.settleKid(world, quest.person, false, town ? town.name : null);
        }
        if (quest.giver && quest.giver.id != null) {
            const C = NpcTasks.config();
            const known = quest.giver.uid ? NpcTasks.remember(world, quest.giver.uid, 'wronged', quest.title, C.altDisposition) : null;
            Quests._grieve(player, quest.giver, { kind: 'wronged', text: alt.grievance || 'I heard what you did.', delta: known ? 0 : C.altDisposition, grudge: true });
        }
        return { success: true, quest, text: alt.text, got };
    },

    /** Map markers for the active quests' next targets (systems/npcTasks.js). */
    taskMarkers(player, world) {
        return NpcTasks.markers(player, world);
    },

    /** "Mysterious Cave — 7 hexes north-east" for an objective, or ''. */
    whereLine(obj, player, world) {
        return NpcTasks.whereLine(obj, player, world);
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

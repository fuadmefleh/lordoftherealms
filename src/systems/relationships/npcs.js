// Relationships — npcs members (split from the original monolith).
import { Relationships } from './_ref.js';
import { DataLoader, Utils, Characters } from './_imports.js';

Object.assign(Relationships, {
    // ── Runtime storage ──
    _npcs: [],

    // All relationship NPCs the player has met
    _nextId: 1,

    // ────────────────────────────────────────────────────────────────────
    //  Initialization
    // ────────────────────────────────────────────────────────────────────
    initialize(player) {
        // Set up player dynasty fields if not present
        if (!player.dynasty) {
            const dynastySurname = player.lastName || player.firstName || player.name || 'Wanderer';
            // Prestige lives on the House (player.house.prestige)
            player.dynasty = {
                name: dynastySurname,
                founded: 1,
            };
        }
        if (!player.spouse) player.spouse = null;          // NPC id
        if (!player.children) player.children = [];        // Array of child objects
        if (!player.relationships) player.relationships = {}; // { npcId: { score, type, romantic, affection, history[] } }
        if (!Array.isArray(player.travelParty)) player.travelParty = []; // NPC ids traveling with player
        if (!player.heir) player.heir = null;               // Child id designated as heir
        if (!player.maxLifespan) {
            const settings = Relationships._getHeirSettings();
            player.maxLifespan = Utils.randInt(settings.playerMaxLifespan.min, settings.playerMaxLifespan.max);
        }
        if (player.birthDay === undefined) player.birthDay = 0;
        if (!player.marriageDay) player.marriageDay = null;

        Relationships._npcs = player._relationshipNpcs || [];
        Relationships._nextId = player._relationshipNextId || 1;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Data Access
    // ────────────────────────────────────────────────────────────────────
    _getData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.relationships) {
            return DataLoader.relationships;
        }
        return null;
    },

    /** Relationship types (data/relationships.json `relationshipTypes`), with a built-in fallback. */
    _getRelationshipTypes() {
        const data = Relationships._getData();
        if (data && data.relationshipTypes && Object.keys(data.relationshipTypes).length > 0) {
            return data.relationshipTypes;
        }
        return {
            acquaintance: { id: 'acquaintance', label: 'Acquaintance', icon: '🤝', minScore: 10, maxScore: 29 },
            friend: { id: 'friend', label: 'Friend', icon: '😊', minScore: 30, maxScore: 59 },
            closeFriend: { id: 'closeFriend', label: 'Close Friend', icon: '💛', minScore: 60, maxScore: 89 },
            bestFriend: { id: 'bestFriend', label: 'Best Friend', icon: '💜', minScore: 90, maxScore: 100 },
            rival: { id: 'rival', label: 'Rival', icon: '⚡', minScore: -59, maxScore: -30 },
            nemesis: { id: 'nemesis', label: 'Nemesis', icon: '💀', minScore: -100, maxScore: -60 },
            lover: { id: 'lover', label: 'Lover', icon: '💕', minScore: 50, maxScore: 100, romantic: true },
            spouse: { id: 'spouse', label: 'Spouse', icon: '💍', romantic: true, exclusive: true },
            exSpouse: { id: 'exSpouse', label: 'Former Spouse', icon: '💔', romantic: false },
        };
    },

    _getHeirSettings() {
        const data = Relationships._getData();
        if (data && data.heirSettings) return data.heirSettings;
        return {
            minAgeToPlay: 16, inheritanceGoldPercent: 0.75, inheritanceRenownPercent: 0.5,
            inheritanceReputationPercent: 0.3, startingAge: 16,
            childbirthChancePerYear: 0.25, maxChildren: 6,
            motherMinAge: 18, motherMaxAge: 42, fatherMinAge: 16, fatherMaxAge: 65,
            playerMaxLifespan: { min: 55, max: 85 }, deathChancePerYearOverMax: 0.15,
            daysPerYear: 120,
        };
    },

    _getPersonalities() {
        const data = Relationships._getData();
        if (data && data.npcPersonalities) return data.npcPersonalities;
        return {
            kind: { id: 'kind', label: 'Kind', icon: '😇', courtModifier: 1.2, friendModifier: 1.3, rivalModifier: 0.5 },
            shy: { id: 'shy', label: 'Shy', icon: '🙈', courtModifier: 0.7, friendModifier: 0.8, rivalModifier: 0.6 },
            bold: { id: 'bold', label: 'Bold', icon: '🦁', courtModifier: 1.1, friendModifier: 1.0, rivalModifier: 1.3 },
            witty: { id: 'witty', label: 'Witty', icon: '🎭', courtModifier: 1.3, friendModifier: 1.1, rivalModifier: 0.8 },
        };
    },

    _getCourtActions() {
        const data = Relationships._getData();
        if (data && data.courtActions) return data.courtActions;
        return {
            chat: { id: 'chat', label: 'Have a Chat', icon: '💬', affectionGain: { min: 1, max: 4 }, statBonus: 'charisma', failChance: 0.1, cost: 0, minStage: 'strangers' },
            compliment: { id: 'compliment', label: 'Give a Compliment', icon: '✨', affectionGain: { min: 2, max: 6 }, statBonus: 'charisma', failChance: 0.2, cost: 0, minStage: 'strangers' },
            gift: { id: 'gift', label: 'Give a Gift', icon: '🎁', affectionGain: { min: 5, max: 12 }, statBonus: 'intelligence', failChance: 0.05, cost: 25, minStage: 'interested' },
            propose: { id: 'propose', label: 'Propose Marriage', icon: '💍', affectionGain: { min: 15, max: 25 }, statBonus: 'charisma', failChance: 0.15, failPenalty: -10, cost: 100, minStage: 'courting', minAffection: 70 },
        };
    },

    _getSocialActions() {
        const data = Relationships._getData();
        if (data && data.socialActions) return data.socialActions;
        return {
            befriend: { id: 'befriend', label: 'Be Friendly', icon: '😊', relationGain: { min: 2, max: 5 }, statBonus: 'charisma', failChance: 0.1, minLevel: 'stranger', apCost: 1 },
            share_meal: { id: 'share_meal', label: 'Share a Meal', icon: '🍞', relationGain: { min: 3, max: 6 }, statBonus: 'charisma', failChance: 0.05, cost: 10, minLevel: 'acquaintance', minScore: 10, apCost: 1 },
            tell_stories: { id: 'tell_stories', label: 'Tell Stories', icon: '📖', relationGain: { min: 2, max: 6 }, statBonus: 'intelligence', failChance: 0.1, minLevel: 'acquaintance', minScore: 10, apCost: 1 },
            train_together: { id: 'train_together', label: 'Train Together', icon: '⚔️', relationGain: { min: 3, max: 7 }, statBonus: 'strength', failChance: 0.15, minLevel: 'friend', minScore: 30, apCost: 2 },
            confide_secret: { id: 'confide_secret', label: 'Confide a Secret', icon: '🤫', relationGain: { min: 5, max: 9 }, statBonus: 'diplomacy', failChance: 0.2, failPenalty: -4, minLevel: 'close_friend', minScore: 60, apCost: 2 },
            blood_oath: { id: 'blood_oath', label: 'Swear Blood Oath', icon: '🩸', relationGain: { min: 8, max: 14 }, statBonus: 'leadership', failChance: 0.28, failPenalty: -6, cost: 40, minLevel: 'best_friend', minScore: 90, apCost: 3 },
            insult: { id: 'insult', label: 'Insult', icon: '😤', relationGain: { min: -8, max: -3 }, statBonus: null, failChance: 0, apCost: 1 },
            challenge: { id: 'challenge', label: 'Challenge to Duel', icon: '🗡️', relationGain: { min: -2, max: 5 }, statBonus: 'strength', failChance: 0.3, failResult: 'humiliation', apCost: 2 },
        };
    },

    _getRelationshipLevels() {
        const data = Relationships._getData();
        if (data && Array.isArray(data.relationshipLevels) && data.relationshipLevels.length > 0) {
            return data.relationshipLevels;
        }
        return [
            { id: 'stranger', label: 'Stranger', minScore: -100, icon: '👤' },
            { id: 'acquaintance', label: 'Acquaintance', minScore: 10, icon: '🤝' },
            { id: 'friend', label: 'Friend', minScore: 30, icon: '😊' },
            { id: 'close_friend', label: 'Close Friend', minScore: 60, icon: '💛' },
            { id: 'best_friend', label: 'Best Friend', minScore: 90, icon: '💜' },
        ];
    },

    _getCourtingStages() {
        const data = Relationships._getData();
        if (data && data.courtingStages) return data.courtingStages;
        return [
            { id: 'strangers', label: 'Strangers', icon: '👤', minAffection: 0 },
            { id: 'interested', label: 'Interested', icon: '👀', minAffection: 15 },
            { id: 'flirting', label: 'Flirting', icon: '😏', minAffection: 30 },
            { id: 'courting', label: 'Courting', icon: '💐', minAffection: 50 },
            { id: 'betrothed', label: 'Betrothed', icon: '💍', minAffection: 75 },
            { id: 'married', label: 'Married', icon: '👫', minAffection: 80 },
        ];
    },

    _getChildTraits() {
        const data = Relationships._getData();
        if (data && data.childTraits) return data.childTraits;
        return {
            gifted: { id: 'gifted', name: 'Gifted', icon: '⭐', chance: 0.1, effects: { allStats: 1 } },
            strong: { id: 'strong', name: 'Strong', icon: '💪', chance: 0.15, effects: { strength: 2 } },
            clever: { id: 'clever', name: 'Clever', icon: '🧠', chance: 0.15, effects: { intelligence: 2 } },
        };
    },

    // ────────────────────────────────────────────────────────────────────
    //  NPC Generation & Management
    // ────────────────────────────────────────────────────────────────────
    /**
     * Generate a relationship NPC at a given settlement
     */
    generateNPC(settlement, world) {
        const kingdom = settlement.kingdom ? world.getKingdom(settlement.kingdom) : null;
        const culture = kingdom ? kingdom.culture : 'Imperial';

        const namePool = (typeof Characters !== 'undefined' && Characters.FIRST_NAMES[culture])
            ? Characters.FIRST_NAMES[culture]
            : { male: ['Edmund', 'Roland', 'Victor'], female: ['Helena', 'Isabella', 'Vivienne'] };

        const gender = Utils.random() < 0.5 ? 'male' : 'female';
        const age = Utils.randInt(18, 45);
        const firstName = Utils.randPick(namePool[gender]);

        const dynastyPool = (typeof Characters !== 'undefined' && Characters.DYNASTY_NAMES[culture])
            ? Characters.DYNASTY_NAMES[culture]
            : ['Unknown'];

        const personalities = Relationships._getPersonalities();
        const personalityKeys = Object.keys(personalities);
        const personality = personalities[Utils.randPick(personalityKeys)];

        const npc = {
            id: `rnpc_${Relationships._nextId++}`,
            firstName,
            dynasty: Utils.randPick(dynastyPool),
            gender,
            age,
            culture,
            personality: personality.id,
            settlementName: settlement.name,
            settlementQ: settlement.q !== undefined ? settlement.q : null,
            settlementR: settlement.r !== undefined ? settlement.r : null,
            kingdomId: settlement.kingdom || null,
            isAlive: true,
            traits: Relationships._rollNPCTraits(),
            appearance: Relationships._rollAppearance(gender),
            occupation: Relationships._rollOccupation(settlement),

            // Relationship stats
            affection: 0,       // Romantic interest (0-100)
            friendship: 0,      // Platonic regard (-100 to 100)
            attraction: Utils.random() < 0.7 ? Utils.randInt(20, 80) : Utils.randInt(0, 30), // How receptive they are
            loyalty: 50,        // How loyal they are to the player

            // State
            isMarried: false,
            isRomantic: false,
            metDay: 0,
            lastInteraction: 0,
        };

        Relationships._npcs.push(npc);
        return npc;
    },

    /**
     * Get or generate NPCs for a settlement tile
     */
    getNPCsAtSettlement(tile, world) {
        if (!tile.settlement) return [];

        const settlementName = tile.settlement.name;
        // Return existing NPCs at this settlement
        let npcs = Relationships._npcs.filter(n =>
            n.settlementName === settlementName && n.isAlive
        );

        // Generate new NPCs if settlement has too few
        const targetCount = tile.settlement.type === 'capital' ? 5 :
                           tile.settlement.type === 'town' ? 3 : 2;

        while (npcs.length < targetCount) {
            const npc = Relationships.generateNPC(tile.settlement, world);
            npc.settlementQ = tile.q !== undefined ? tile.q : (tile.settlement.q || null);
            npc.settlementR = tile.r !== undefined ? tile.r : (tile.settlement.r || null);
            npcs.push(npc);
        }

        return npcs;
    },

    getNPC(npcId) {
        return Relationships._npcs.find(n => n.id === npcId) || null;
    },

    /**
     * Get all NPCs the player has a meaningful relationship with
     */
    getKnownNPCs(player) {
        return Relationships._npcs.filter(n => {
            const rel = player.relationships[n.id];
            return rel && (Math.abs(rel.score) >= 5 || rel.romantic);
        });
    },

    ensureTravelParty(player) {
        if (!Array.isArray(player.travelParty)) player.travelParty = [];
        return player.travelParty;
    },

    isInTravelParty(player, npcId) {
        const party = Relationships.ensureTravelParty(player);
        return party.includes(npcId);
    },

    getTravelPartyMembers(player) {
        const party = Relationships.ensureTravelParty(player);
        const members = [];
        for (const npcId of party) {
            const npc = Relationships.getNPC(npcId);
            if (npc && npc.isAlive) members.push(npc);
        }
        return members;
    },

    requestJoinTravelParty(player, npcId, world) {
        Relationships.ensureTravelParty(player);
        const npc = Relationships.getNPC(npcId);
        if (!npc || !npc.isAlive) return { success: false, reason: 'NPC not available' };

        if (Relationships.isInTravelParty(player, npcId)) {
            return { success: false, reason: `${npc.firstName} is already in your travel party.` };
        }

        const rel = Relationships.getRelationship(player, npcId);

        const known = !!player.relationships?.[npcId];
        if (!known) {
            return { success: false, reason: 'You need to meet this person first.' };
        }

        let chance = 0.20;
        chance += (rel.score || 0) * 0.006;
        chance += (rel.affection || 0) * 0.004;
        chance += ((player.charisma || 5) - 5) * 0.03;
        chance += ((player.skills?.diplomacy || 1) - 1) * 0.02;

        if (player.spouse === npcId) chance += 0.45;

        const traitList = npc.traits || [];
        if (traitList.includes('adventurous')) chance += 0.18;
        if (traitList.includes('loyal')) chance += 0.10;
        if (traitList.includes('homebody')) chance -= 0.22;
        if (traitList.includes('fickle')) chance -= 0.08;

        chance = Math.max(0.05, Math.min(0.95, chance));
        const roll = Utils.random();

        if (roll <= chance) {
            player.travelParty.push(npcId);
            npc.isTravelingWithPlayer = true;
            npc.lastInteraction = world?.day || npc.lastInteraction || 0;

            rel.score = Math.min(100, (rel.score || 0) + 2);
            rel.history.push({ day: world?.day || 0, action: 'join_travel_party', result: 'accepted' });

            return {
                success: true,
                accepted: true,
                npc,
                chance,
                roll,
                reason: `${npc.firstName} agrees to travel with you.`,
            };
        }

        rel.score = Math.max(-100, (rel.score || 0) - 1);
        rel.history.push({ day: world?.day || 0, action: 'join_travel_party', result: 'rejected' });

        return {
            success: true,
            accepted: false,
            npc,
            chance,
            roll,
            reason: `${npc.firstName} declines the invitation for now.`,
        };
    },

    removeFromTravelParty(player, npcId) {
        Relationships.ensureTravelParty(player);
        const idx = player.travelParty.indexOf(npcId);
        if (idx === -1) return { success: false, reason: 'Not in travel party' };

        player.travelParty.splice(idx, 1);
        const npc = Relationships.getNPC(npcId);
        if (npc) npc.isTravelingWithPlayer = false;

        return { success: true, npc };
    },

    cleanupTravelParty(player) {
        Relationships.ensureTravelParty(player);
        player.travelParty = player.travelParty.filter(npcId => {
            const npc = Relationships.getNPC(npcId);
            return !!(npc && npc.isAlive);
        });
    },

    // ── NPC trait/appearance generation ─────────────────────────────────
    _rollNPCTraits() {
        const traitPool = ['honest', 'cunning', 'brave', 'cautious', 'generous', 'greedy',
                          'humorous', 'serious', 'loyal', 'fickle', 'romantic', 'practical',
                          'adventurous', 'homebody', 'scholarly', 'martial'];
        const count = Utils.randInt(2, 3);
        const traits = [];
        const pool = [...traitPool];
        for (let i = 0; i < count; i++) {
            const idx = Math.floor(Utils.random() * pool.length);
            traits.push(pool.splice(idx, 1)[0]);
        }
        return traits;
    },

    _rollAppearance(gender) {
        const features = {
            hair: Utils.randPick(['dark', 'blonde', 'red', 'brown', 'silver', 'black']),
            eyes: Utils.randPick(['brown', 'blue', 'green', 'grey', 'hazel', 'amber']),
            build: Utils.randPick(['slim', 'athletic', 'stocky', 'tall', 'petite', 'sturdy']),
        };
        return features;
    },

    _rollOccupation(settlement) {
        const tier = settlement.type || 'village';
        const allOccupations = {
            village: ['farmer', 'herbalist', 'hunter', 'shepherd', 'miller', 'woodcutter', 'weaver'],
            town: ['merchant', 'blacksmith', 'scholar', 'tavern keeper', 'healer', 'guard', 'artisan', 'baker'],
            capital: ['noble', 'diplomat', 'knight', 'court scholar', 'merchant prince', 'priest', 'spymaster', 'general'],
        };
        return Utils.randPick(allOccupations[tier] || allOccupations.village);
    },
});

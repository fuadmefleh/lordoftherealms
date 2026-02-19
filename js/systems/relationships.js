// ============================================
// RELATIONSHIPS — Courting, Marriage, Friendship, Rivalry, Dynasty & Heirs
// ============================================

const Relationships = {

    // ── Runtime storage ──
    _npcs: [],              // All relationship NPCs the player has met
    _nextId: 1,

    // ────────────────────────────────────────────────────────────────────
    //  Initialization
    // ────────────────────────────────────────────────────────────────────

    initialize(player) {
        // Set up player dynasty fields if not present
        if (!player.dynasty) {
            const dynastySurname = player.lastName || player.firstName || player.name || 'Wanderer';
            player.dynasty = {
                name: dynastySurname,
                founded: 1,
                prestige: 0,
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
            shy: { id: 'shy', label: 'Shy', icon: '🫣', courtModifier: 0.7, friendModifier: 0.8, rivalModifier: 0.6 },
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

        const gender = Math.random() < 0.5 ? 'male' : 'female';
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
            attraction: Math.random() < 0.7 ? Utils.randInt(20, 80) : Utils.randInt(0, 30), // How receptive they are
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
        const roll = Math.random();

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
            const idx = Math.floor(Math.random() * pool.length);
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

    // ────────────────────────────────────────────────────────────────────
    //  Relationship Score & Labels
    // ────────────────────────────────────────────────────────────────────

    getRelationship(player, npcId) {
        if (!player.relationships[npcId]) {
            player.relationships[npcId] = {
                score: 0,
                romantic: false,
                affection: 0,
                history: [],
            };
        }
        return player.relationships[npcId];
    },

    getRelationLabel(score) {
        if (score >= 90) return { label: 'Best Friend', icon: '💜' };
        if (score >= 60) return { label: 'Close Friend', icon: '💛' };
        if (score >= 30) return { label: 'Friend', icon: '😊' };
        if (score >= 10) return { label: 'Acquaintance', icon: '🤝' };
        if (score > -30) return { label: 'Neutral', icon: '😐' };
        if (score > -60) return { label: 'Rival', icon: '⚡' };
        return { label: 'Nemesis', icon: '💀' };
    },

    getCourtingStage(affection, isMarried) {
        if (isMarried) return { id: 'married', label: 'Married', icon: '👫' };
        const stages = Relationships._getCourtingStages();
        let current = stages[0];
        for (const stage of stages) {
            if (stage.id === 'married') continue;
            if (affection >= stage.minAffection) current = stage;
        }
        return current;
    },

    getRelationshipLevel(score) {
        const levels = Relationships._getRelationshipLevels();
        let current = levels[0] || { id: 'stranger', label: 'Stranger', minScore: -100, icon: '👤' };
        for (const level of levels) {
            if (score >= (level.minScore ?? -100)) current = level;
        }
        return current;
    },

    _getLevelIndex(levelId) {
        const levels = Relationships._getRelationshipLevels();
        return levels.findIndex(level => level.id === levelId);
    },

    getSocialActionAvailability(player, npcId) {
        const rel = Relationships.getRelationship(player, npcId);
        const actions = Relationships._getSocialActions();
        const currentLevel = Relationships.getRelationshipLevel(rel.score || 0);
        const currentLevelIndex = Relationships._getLevelIndex(currentLevel.id);

        return Object.values(actions).map(action => {
            const minScore = action.minScore ?? -100;
            const minLevel = action.minLevel || 'stranger';
            const minLevelIndex = Math.max(0, Relationships._getLevelIndex(minLevel));

            if ((rel.score || 0) < minScore) {
                return {
                    ...action,
                    unlocked: false,
                    lockReason: `Requires relationship score ${minScore}`,
                };
            }

            if (currentLevelIndex < minLevelIndex) {
                const requiredLevel = Relationships._getRelationshipLevels()[minLevelIndex];
                return {
                    ...action,
                    unlocked: false,
                    lockReason: `Requires ${requiredLevel?.label || minLevel}`,
                };
            }

            return { ...action, unlocked: true, lockReason: null };
        });
    },

    getCourtActionAvailability(player, npcId) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) return [];

        const rel = Relationships.getRelationship(player, npcId);
        const actions = Relationships._getCourtActions();
        const stages = Relationships._getCourtingStages();
        const stageOrder = stages.map(stage => stage.id);
        const isSpouse = player.spouse === npcId;
        const currentStage = Relationships.getCourtingStage(rel.affection || 0, isSpouse);
        const currentStageIdx = Math.max(0, stageOrder.indexOf(currentStage.id));

        return Object.values(actions).map(action => {
            if (player.spouse && player.spouse !== npcId) {
                return {
                    ...action,
                    unlocked: false,
                    lockReason: 'You are already married to someone else',
                };
            }

            if (action.requiresSpouse && !isSpouse) {
                return {
                    ...action,
                    unlocked: false,
                    lockReason: 'Only available with your spouse',
                };
            }

            const minStageId = action.minStage || 'strangers';
            const minStageIdx = Math.max(0, stageOrder.indexOf(minStageId));
            if (currentStageIdx < minStageIdx) {
                return {
                    ...action,
                    unlocked: false,
                    lockReason: `Requires ${stages[minStageIdx]?.label || minStageId} stage`,
                };
            }

            if (action.minAffection && (rel.affection || 0) < action.minAffection) {
                return {
                    ...action,
                    unlocked: false,
                    lockReason: `Requires ${action.minAffection} affection`,
                };
            }

            return { ...action, unlocked: true, lockReason: null };
        });
    },

    // ────────────────────────────────────────────────────────────────────
    //  Social Interactions (Friendship / Rivalry)
    // ────────────────────────────────────────────────────────────────────

    performSocialAction(player, npcId, actionId) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) return { success: false, reason: 'NPC not found' };

        const actions = Relationships._getSocialActions();
        const action = actions[actionId];
        if (!action) return { success: false, reason: 'Unknown action' };

        const availability = Relationships.getSocialActionAvailability(player, npcId)
            .find(item => item.id === actionId);
        if (availability && !availability.unlocked) {
            return { success: false, reason: availability.lockReason || 'This action is locked' };
        }

        const cost = action.cost || 0;
        if (cost > 0 && player.gold < cost) {
            return { success: false, reason: `Not enough gold (need ${cost})` };
        }

        const rel = Relationships.getRelationship(player, npcId);
        const personality = Relationships._getPersonalities()[npc.personality] || { friendModifier: 1.0, rivalModifier: 1.0 };

        // Calculate gain
        const baseGain = action.relationGain
            ? Utils.randInt(action.relationGain.min, action.relationGain.max)
            : 0;

        const statVal = action.statBonus ? (player[action.statBonus] || player.skills?.[action.statBonus] || 5) : 5;
        const statMod = 1 + (statVal - 5) * 0.05;

        const personalityMod = baseGain >= 0 ? personality.friendModifier : personality.rivalModifier;

        // Failure check
        if (action.failChance && Math.random() < action.failChance) {
            const penalty = action.failPenalty ?? (action.failResult === 'humiliation' ? -3 : -1);
            rel.score = Math.max(-100, Math.min(100, rel.score + penalty));
            rel.history.push({ day: 0, action: actionId, result: 'failed' });

            if (cost > 0) player.gold -= cost;
            return { success: false, failed: true, npc, penalty, reason: 'The interaction went poorly.' };
        }

        const finalGain = Math.round(baseGain * statMod * personalityMod);
        rel.score = Math.max(-100, Math.min(100, rel.score + finalGain));

        if (cost > 0) player.gold -= cost;

        rel.history.push({ day: 0, action: actionId, result: 'success', gain: finalGain });

        // Diplomacy skill chance
        let skillUp = false;
        if (Math.random() < 0.1 && player.skills) {
            player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
            skillUp = true;
        }

        return { success: true, npc, gain: finalGain, newScore: rel.score, skillUp };
    },

    // ────────────────────────────────────────────────────────────────────
    //  Romantic Interactions (Courting)
    // ────────────────────────────────────────────────────────────────────

    performCourtAction(player, npcId, actionId) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) return { success: false, reason: 'NPC not found' };

        if (player.spouse && player.spouse !== npcId) {
            return { success: false, reason: 'You are already married!' };
        }

        const actions = Relationships._getCourtActions();
        const action = actions[actionId];
        if (!action) return { success: false, reason: 'Unknown action' };

        const availability = Relationships.getCourtActionAvailability(player, npcId)
            .find(item => item.id === actionId);
        if (availability && !availability.unlocked) {
            return { success: false, reason: availability.lockReason || 'This action is locked' };
        }

        const cost = action.cost || 0;
        if (cost > 0 && player.gold < cost) {
            return { success: false, reason: `Not enough gold (need ${cost})` };
        }

        const rel = Relationships.getRelationship(player, npcId);
        rel.romantic = true;

        // Check minimum stage
        const stages = Relationships._getCourtingStages();
        const stageOrder = stages.map(s => s.id);
        const currentStage = Relationships.getCourtingStage(rel.affection, player.spouse === npcId);
        const minStageIdx = stageOrder.indexOf(action.minStage || 'strangers');
        const curStageIdx = stageOrder.indexOf(currentStage.id);

        if (curStageIdx < minStageIdx) {
            return { success: false, reason: `You need to be at least at the "${stages[minStageIdx].label}" stage for this.` };
        }

        // Check minimum affection for proposal
        if (action.minAffection && rel.affection < action.minAffection) {
            return { success: false, reason: `Need at least ${action.minAffection} affection to attempt this.` };
        }

        const personality = Relationships._getPersonalities()[npc.personality] || { courtModifier: 1.0 };
        const statVal = action.statBonus ? (player[action.statBonus] || player.skills?.[action.statBonus] || 5) : 5;
        const statMod = 1 + (statVal - 5) * 0.06;

        // Attraction modifier
        const attractionMod = 0.5 + (npc.attraction || 50) / 100;

        // Failure check
        const adjustedFail = Math.max(0.02, action.failChance - (statVal * 0.01));
        if (Math.random() < adjustedFail) {
            const penalty = action.failPenalty || -2;
            rel.affection = Math.max(0, rel.affection + penalty);
            rel.history.push({ day: 0, action: actionId, result: 'failed', romantic: true });

            if (cost > 0) player.gold -= cost;
            return { success: false, failed: true, npc, penalty, reason: Relationships._getCourtFailText(actionId, npc) };
        }

        // Calculate affection gain
        const baseGain = Utils.randInt(action.affectionGain.min, action.affectionGain.max);
        const finalGain = Math.max(1, Math.round(baseGain * statMod * personality.courtModifier * attractionMod));
        rel.affection = Math.min(100, rel.affection + finalGain);

        // Also improve friendship
        rel.score = Math.min(100, rel.score + Math.floor(finalGain / 2));

        if (cost > 0) {
            player.gold -= cost;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.courting = (player.financeToday.expenses.courting || 0) + cost;
            }
        }

        rel.history.push({ day: 0, action: actionId, result: 'success', romantic: true, gain: finalGain });

        // Check if this was a proposal
        let married = false;
        if (actionId === 'propose' && rel.affection >= 75) {
            married = true;
        }

        // Charisma growth chance
        let charismaUp = false;
        if (Math.random() < 0.08) {
            player.charisma = (player.charisma || 5) + 1;
            charismaUp = true;
        }

        return {
            success: true, npc, gain: finalGain, newAffection: rel.affection,
            married, charismaUp,
            stage: Relationships.getCourtingStage(rel.affection, married),
        };
    },

    _getCourtFailText(actionId, npc) {
        const texts = {
            chat: `${npc.firstName} seemed distracted and uninterested in talking.`,
            compliment: `Your compliment to ${npc.firstName} came across as awkward.`,
            gift: `${npc.firstName} politely declined your gift.`,
            serenade: `Your singing was... not well received. ${npc.firstName} looked embarrassed.`,
            moonlight_walk: `The walk with ${npc.firstName} became awkward and silent.`,
            romantic_dinner: `The dinner with ${npc.firstName} was awkward and stilted.`,
            private_vows: `${npc.firstName} was not ready to make private vows yet.`,
            quality_time: `${npc.firstName} seemed distant despite your effort to reconnect.`,
            propose: `${npc.firstName} rejected your proposal! "I'm not ready for that..."`,
        };
        return texts[actionId] || `${npc.firstName} didn't respond well.`;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Marriage
    // ────────────────────────────────────────────────────────────────────

    marry(player, npcId, world) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) return { success: false, reason: 'NPC not found' };
        if (player.spouse) return { success: false, reason: 'Already married!' };

        const rel = Relationships.getRelationship(player, npcId);

        player.spouse = npcId;
        player.marriageDay = world ? world.day : 0;
        npc.isMarried = true;
        npc.isRomantic = true;
        rel.affection = Math.max(rel.affection, 80);
        rel.romantic = true;

        // Marriage bonuses
        player.maxStamina = (player.maxStamina || 10) + 1;
        player.renown = (player.renown || 0) + 3;

        // Reputation with spouse's kingdom
        if (npc.kingdomId && player.reputation) {
            player.reputation[npc.kingdomId] = (player.reputation[npc.kingdomId] || 0) + 5;
        }

        return { success: true, npc, spouse: npc };
    },

    divorce(player, world) {
        if (!player.spouse) return { success: false, reason: 'Not married' };

        const npc = Relationships.getNPC(player.spouse);
        const rel = player.relationships[player.spouse];

        if (npc) {
            npc.isMarried = false;
            npc.isRomantic = false;
        }
        if (rel) {
            rel.affection = Math.max(0, rel.affection - 40);
            rel.score = Math.max(-100, rel.score - 30);
            rel.romantic = false;
        }

        player.spouse = null;
        player.marriageDay = null;
        player.karma = (player.karma || 0) - 5;
        player.renown = Math.max(0, (player.renown || 0) - 2);

        return { success: true, exSpouse: npc };
    },

    // ────────────────────────────────────────────────────────────────────
    //  Children & Dynasty
    // ────────────────────────────────────────────────────────────────────

    /**
     * Check if a child could be born this year (called from endDay processing)
     */
    checkChildbirth(player, world) {
        if (!player.spouse) return null;
        const settings = Relationships._getHeirSettings();

        if ((player.children || []).length >= settings.maxChildren) return null;

        const spouse = Relationships.getNPC(player.spouse);
        if (!spouse) return null;

        // Age checks
        const motherAge = player.gender === 'female' ? player.age : spouse.age;
        const fatherAge = player.gender === 'male' ? player.age : spouse.age;

        if (motherAge < settings.motherMinAge || motherAge > settings.motherMaxAge) return null;
        if (fatherAge < settings.fatherMinAge) return null;

        // Only check once per year (roughly every daysPerYear days)
        if (world.day % settings.daysPerYear !== 0) return null;

        // Chance of child
        const rel = Relationships.getRelationship(player, player.spouse);
        const affectionBonus = (rel.affection || 50) / 200; // 0 to 0.5
        const chance = settings.childbirthChancePerYear + affectionBonus;

        if (Math.random() > chance) return null;

        // Generate child!
        return Relationships.generateChild(player, spouse, world);
    },

    generateChild(player, spouse, world) {
        const culture = spouse.culture || 'Imperial';
        const gender = Math.random() < 0.5 ? 'male' : 'female';

        const namePool = (typeof Characters !== 'undefined' && Characters.FIRST_NAMES[culture])
            ? Characters.FIRST_NAMES[culture]
            : { male: ['Edmund'], female: ['Helena'] };

        const firstName = Utils.randPick(namePool[gender]);

        // Roll traits for child
        const childTraits = Relationships._getChildTraits();
        const traits = [];
        for (const [id, trait] of Object.entries(childTraits)) {
            if (Math.random() < trait.chance) {
                traits.push({ ...trait });
            }
        }

        const child = {
            id: `child_${Relationships._nextId++}`,
            firstName,
            dynasty: player.dynasty?.name || player.name,
            gender,
            age: 0,
            culture,
            birthDay: world ? world.day : 0,
            isAlive: true,
            traits,

            // Inherited base stats (blend of parents + random)
            strength: Math.floor(((player.strength || 5) + Utils.randInt(3, 7)) / 2),
            charisma: Math.floor(((player.charisma || 5) + Utils.randInt(3, 7)) / 2),
            intelligence: Math.floor(((player.intelligence || 5) + Utils.randInt(3, 7)) / 2),
            faith: Math.floor(((player.faith || 5) + Utils.randInt(3, 7)) / 2),
            luck: Math.floor(((player.luck || 5) + Utils.randInt(3, 7)) / 2),

            // Skills start at 0, grow as they age
            skills: {
                commerce: 0, combat: 0, leadership: 0,
                diplomacy: 0, stealth: 0, cartography: 0,
            },

            // Will be set when taking over as heir
            health: 100,
            maxHealth: 100,
        };

        // Apply trait effects
        for (const trait of traits) {
            if (trait.effects) {
                if (trait.effects.allStats) {
                    child.strength += trait.effects.allStats;
                    child.charisma += trait.effects.allStats;
                    child.intelligence += trait.effects.allStats;
                    child.faith += trait.effects.allStats;
                    child.luck += trait.effects.allStats;
                }
                if (trait.effects.strength) child.strength += trait.effects.strength;
                if (trait.effects.intelligence) child.intelligence += trait.effects.intelligence;
                if (trait.effects.charisma) child.charisma += trait.effects.charisma;
                if (trait.effects.luck) child.luck += trait.effects.luck;
                if (trait.effects.faith) child.faith += trait.effects.faith;
                if (trait.effects.maxHealth) child.maxHealth += trait.effects.maxHealth;
                if (trait.effects.combat) child.skills.combat += trait.effects.combat;
                if (trait.effects.stealth) child.skills.stealth += trait.effects.stealth;
                if (trait.effects.diplomacy) child.skills.diplomacy += trait.effects.diplomacy;
            }
        }

        if (!player.children) player.children = [];
        player.children.push(child);

        // Auto-designate first child as heir if no heir set
        if (!player.heir) {
            player.heir = child.id;
        }

        return child;
    },

    /**
     * Age children (called yearly)
     */
    ageChildren(player, world) {
        if (!player.children) return;
        const settings = Relationships._getHeirSettings();

        for (const child of player.children) {
            if (!child.isAlive) continue;
            child.age++;

            // Skill growth as children age
            if (child.age >= 8 && child.age <= 18) {
                const growthChance = 0.3;
                const skillKeys = Object.keys(child.skills);
                for (const skill of skillKeys) {
                    if (Math.random() < growthChance) {
                        child.skills[skill] = Math.min(child.skills[skill] + 1, 5);
                    }
                }
            }

            // Older children can get stronger stats
            if (child.age >= 14) {
                if (Math.random() < 0.2) {
                    const stat = Utils.randPick(['strength', 'charisma', 'intelligence', 'faith', 'luck']);
                    child[stat] = (child[stat] || 5) + 1;
                }
            }
        }
    },

    // ────────────────────────────────────────────────────────────────────
    //  Player Aging & Death
    // ────────────────────────────────────────────────────────────────────

    /**
     * Process player aging (called every daysPerYear days)
     * Returns { aged, died, deathEvent } or null
     */
    processAging(player, world) {
        const settings = Relationships._getHeirSettings();
        if (world.day % settings.daysPerYear !== 0) return null;

        player.age++;

        // Age spouse
        const spouse = player.spouse ? Relationships.getNPC(player.spouse) : null;
        if (spouse) spouse.age++;

        // Age all known NPCs
        for (const npc of Relationships._npcs) {
            if (npc.isAlive) npc.age++;
            // NPC death (old age)
            if (npc.age > Utils.randInt(55, 85) && Math.random() < 0.15) {
                npc.isAlive = false;
                if (player.spouse === npc.id) {
                    player.spouse = null;
                    player.marriageDay = null;
                }
            }
        }

        // Age children
        Relationships.ageChildren(player, world);

        // Player death check
        if (player.age > player.maxLifespan) {
            const yearsOver = player.age - player.maxLifespan;
            const deathChance = yearsOver * settings.deathChancePerYearOverMax;
            if (Math.random() < deathChance) {
                return { aged: true, died: true, age: player.age };
            }
        }

        // Health deterioration in old age
        if (player.age > 50) {
            const healthLoss = Math.floor((player.age - 50) * 0.5);
            player.maxHealth = Math.max(50, 100 - healthLoss);
            if (player.health > player.maxHealth) {
                player.health = player.maxHealth;
            }
        }

        return { aged: true, died: false, age: player.age };
    },

    // ────────────────────────────────────────────────────────────────────
    //  Heir System
    // ────────────────────────────────────────────────────────────────────

    /**
     * Get eligible heirs from children
     */
    getEligibleHeirs(player) {
        if (!player.children) return [];
        const settings = Relationships._getHeirSettings();
        return player.children.filter(c => c.isAlive && c.age >= settings.minAgeToPlay);
    },

    /**
     * Set the designated heir
     */
    designateHeir(player, childId) {
        const child = (player.children || []).find(c => c.id === childId);
        if (!child) return { success: false, reason: 'Child not found' };
        if (!child.isAlive) return { success: false, reason: 'That child has passed away' };

        player.heir = childId;
        return { success: true, heir: child };
    },

    /**
     * Take over as an heir — creates a new player from the child's stats
     * Returns the transformed player data
     */
    succeedAsHeir(player, childId, world) {
        const settings = Relationships._getHeirSettings();
        const child = (player.children || []).find(c => c.id === childId);

        if (!child || !child.isAlive) {
            return { success: false, reason: 'Invalid heir' };
        }
        if (child.age < settings.minAgeToPlay) {
            return { success: false, reason: `Heir must be at least ${settings.minAgeToPlay} years old` };
        }

        // Store old player info for history
        const oldName = player.name;
        const oldAge = player.age;

        // Transfer heir stats to player
        player.firstName = child.firstName;
        player.lastName = child.dynasty || '';
        player.name = `${child.firstName} ${child.dynasty}`;
        player.gender = child.gender;
        player.age = child.age;
        player.title = `Heir of ${oldName}`;

        // Stats — child's developed stats
        player.strength = child.strength || 5;
        player.charisma = child.charisma || 5;
        player.intelligence = child.intelligence || 5;
        player.faith = child.faith || 5;
        player.luck = child.luck || 5;

        // Skills — child learned some, plus base
        player.skills = {
            commerce: Math.max(1, child.skills?.commerce || 0),
            combat: Math.max(1, child.skills?.combat || 0),
            leadership: Math.max(1, child.skills?.leadership || 0),
            diplomacy: Math.max(1, child.skills?.diplomacy || 0),
            stealth: Math.max(1, child.skills?.stealth || 0),
            cartography: child.skills?.cartography || 0,
        };

        // Health — full for young heir
        player.health = child.maxHealth || 100;
        player.maxHealth = child.maxHealth || 100;
        player.stamina = 10;
        player.maxStamina = 10;

        // Inheritance — partial gold, renown, reputation
        player.gold = Math.floor(player.gold * settings.inheritanceGoldPercent);
        player.renown = Math.floor((player.renown || 0) * settings.inheritanceRenownPercent);

        // Reputation partially inherited
        for (const kId of Object.keys(player.reputation || {})) {
            player.reputation[kId] = Math.floor(player.reputation[kId] * settings.inheritanceReputationPercent);
        }

        // Reset karma
        player.karma = 0;

        // New lifespan
        player.maxLifespan = Utils.randInt(settings.playerMaxLifespan.min, settings.playerMaxLifespan.max);

        // Keep dynasty, clear personal relationships
        player.spouse = null;
        player.marriageDay = null;
        player.heir = null;

        // Remove this child from children, keep others as siblings
        player.children = player.children.filter(c => c.id !== childId);

        // Keep properties, army, religion but clear personal items
        player.inventory = { bread: 10 };
        player.allegiance = null;
        player.kingdomTitle = null;

        // Increase dynasty prestige
        if (player.dynasty) {
            player.dynasty.prestige = (player.dynasty.prestige || 0) + 5;
        }

        // Clear old relationships (new character doesn't know the same people personally)
        player.relationships = {};

        return {
            success: true,
            oldName,
            oldAge,
            newName: player.name,
            heir: child,
        };
    },

    // ────────────────────────────────────────────────────────────────────
    //  NPC-Initiated Events (called in endDay)
    // ────────────────────────────────────────────────────────────────────

    /**
     * Process daily relationship events
     * Returns array of event notifications
     */
    processDailyEvents(player, world) {
        const events = [];

        Relationships.cleanupTravelParty(player);

        // Marriage events
        if (player.spouse) {
            const data = Relationships._getData();
            const marriageEvents = data?.marriageEvents || [];
            for (const evt of marriageEvents) {
                if (evt.requiresChildren && (!player.children || player.children.length === 0)) continue;
                if (Math.random() < (evt.chance || 0)) {
                    const spouse = Relationships.getNPC(player.spouse);
                    if (!spouse) continue;

                    const rel = Relationships.getRelationship(player, player.spouse);
                    rel.affection = Math.max(0, Math.min(100, rel.affection + (evt.value || 0)));

                    let text = evt.text
                        .replace('{spouse}', spouse.firstName)
                        .replace('{child}', player.children?.length > 0 ? player.children[player.children.length - 1].firstName : 'your child');

                    events.push({ type: 'marriage', text, impact: evt.value > 0 ? 'positive' : 'negative' });
                }
            }
        }

        // NPC-initiated courting events for NPCs the player knows
        const data = Relationships._getData();
        const courtEvents = data?.npcCourtEvents || [];
        for (const [npcId, rel] of Object.entries(player.relationships || {})) {
            if (!rel.romantic) continue;
            const npc = Relationships.getNPC(npcId);
            if (!npc || !npc.isAlive) continue;

            for (const evt of courtEvents) {
                if (Math.random() < (evt.chance || 0)) {
                    let text = evt.text
                        .replace('{npc}', npc.firstName)
                        .replace('{item}', Utils.randPick(['pressed flower', 'carved charm', 'ribbon', 'sweet cake']));

                    if (evt.affectionGain) {
                        rel.affection = Math.max(0, Math.min(100, (rel.affection || 0) + evt.affectionGain));
                    }
                    if (evt.relationGain) {
                        rel.score = Math.max(-100, Math.min(100, (rel.score || 0) + evt.relationGain));
                    }

                    events.push({ type: 'court', text, npc: npc.firstName });
                    break; // One event per NPC per day
                }
            }
        }

        // Childbirth check
        const newChild = Relationships.checkChildbirth(player, world);
        if (newChild) {
            const traitStr = newChild.traits.length > 0
                ? ` Traits: ${newChild.traits.map(t => `${t.icon} ${t.name}`).join(', ')}`
                : '';
            events.push({
                type: 'childbirth',
                text: `🎉 A ${newChild.gender === 'male' ? 'son' : 'daughter'} has been born! Welcome ${newChild.firstName} ${newChild.dynasty}!${traitStr}`,
                child: newChild,
            });
        }

        // Relationship decay for NPCs not interacted with recently
        for (const [npcId, rel] of Object.entries(player.relationships || {})) {
            const npc = Relationships.getNPC(npcId);
            if (!npc || !npc.isAlive) continue;

            // Slow decay if not interacted in a while
            const daysSinceInteraction = (world?.day || 0) - (npc.lastInteraction || 0);
            if (daysSinceInteraction > 30 && Math.random() < 0.05) {
                if (rel.score > 0) rel.score = Math.max(0, rel.score - 1);
                if (rel.affection > 0 && !npc.isMarried) rel.affection = Math.max(0, rel.affection - 1);
            }
        }

        return events;
    },

    // ────────────────────────────────────────────────────────────────────
    //  Save / Load Support
    // ────────────────────────────────────────────────────────────────────

    /**
     * Get serializable state for saving
     */
    getState() {
        return {
            npcs: Relationships._npcs,
            nextId: Relationships._nextId,
        };
    },

    /**
     * Restore state from save data
     */
    loadState(state, player) {
        if (state) {
            Relationships._npcs = state.npcs || [];
            Relationships._nextId = state.nextId || 1;
        }
        // Also restore from player for backward compat
        if (player._relationshipNpcs) {
            Relationships._npcs = player._relationshipNpcs;
        }
        if (player._relationshipNextId) {
            Relationships._nextId = player._relationshipNextId;
        }
    },

    /**
     * Store state on player before saving
     */
    prepareForSave(player) {
        player._relationshipNpcs = Relationships._npcs;
        player._relationshipNextId = Relationships._nextId;
    },
};

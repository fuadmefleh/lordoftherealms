// Relationships — actions members (split from the original monolith).
import { Relationships } from './_ref.js';
import { DataLoader, Utils, Characters } from './_imports.js';

Object.assign(Relationships, {
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

    /**
     * @param {Object} [opts] - { world } lets location rules apply
     *   (requiresSettlement: the player must be standing in a settlement)
     */
    getCourtActionAvailability(player, npcId, opts = {}) {
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

            if (action.requiresSettlement && opts.world && typeof opts.world.getTile === 'function') {
                const here = opts.world.getTile(player.q, player.r);
                if (!here || !here.settlement) {
                    return { ...action, unlocked: false, lockReason: 'Only possible in a settlement' };
                }
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
        }).flatMap(entry => {
            // An unlocked gift becomes one button per giftItems entry
            if (entry.id !== 'gift' || !entry.unlocked) return [entry];
            return Relationships.getGiftItems().map(gift => ({
                ...entry,
                id: `gift:${gift.id}`,
                label: gift.name,
                icon: gift.icon || entry.icon,
                cost: gift.cost || 0,
                description: gift.description || entry.description,
            }));
        });
    },

    /** The court action behind an id; 'gift:<itemId>' resolves to that gift. */
    _resolveCourtAction(actions, actionId, player, npc) {
        if (actionId !== 'gift' && !String(actionId).startsWith('gift:')) return actions[actionId] || null;
        const base = actions.gift;
        if (!base) return null;
        const itemId = String(actionId).slice(5);
        const gift = itemId
            ? Relationships.getGiftItems().find(g => g.id === itemId)
            : Relationships.chooseGift(player, npc);
        if (!gift) return itemId ? null : base;
        const value = Relationships.giftValue(gift, npc);
        return {
            ...base,
            cost: gift.cost || 0,
            statBonus: gift.statBonus || base.statBonus,
            affectionGain: { min: Math.max(1, Math.round(value * 0.75)), max: Math.max(1, Math.round(value * 1.25)) },
            gift,
        };
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
        if (action.failChance && Utils.random() < action.failChance) {
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
        if (Utils.random() < 0.1 && player.skills) {
            player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
            skillUp = true;
        }

        return { success: true, npc, gain: finalGain, newScore: rel.score, skillUp };
    },

    // ────────────────────────────────────────────────────────────────────
    //  Romantic Interactions (Courting)
    // ────────────────────────────────────────────────────────────────────
    performCourtAction(player, npcId, actionId, opts = {}) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) return { success: false, reason: 'NPC not found' };

        if (player.spouse && player.spouse !== npcId) {
            return { success: false, reason: 'You are already married!' };
        }

        const actions = Relationships._getCourtActions();
        const action = Relationships._resolveCourtAction(actions, actionId, player, npc);
        if (!action) return { success: false, reason: 'Unknown action' };
        const baseId = action.gift ? 'gift' : actionId;

        const availability = Relationships.getCourtActionAvailability(player, npcId, opts)
            .find(item => item.id === actionId || item.id === baseId);
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
        if (Utils.random() < adjustedFail) {
            const penalty = action.failPenalty || -2;
            rel.affection = Math.max(0, rel.affection + penalty);
            rel.history.push({ day: 0, action: actionId, result: 'failed', romantic: true });

            if (cost > 0) player.gold -= cost;
            return { success: false, failed: true, npc, penalty, reason: Relationships._getCourtFailText(baseId, npc) };
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
        if (Utils.random() < 0.08) {
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
});

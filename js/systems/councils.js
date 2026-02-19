// ============================================
// COUNCILS & PARLIAMENTS — governance and voting
// ============================================

const Councils = {
    SESSION_DURATION_DAYS: 7,
    CONVENE_COOLDOWN_DAYS: 10,
    VOTE_COOLDOWN_DAYS: 2,

    FACTIONS: [
        { id: 'nobility', name: 'Nobility Bloc', icon: '👑', baseSupport: 56, influence: 24 },
        { id: 'military', name: 'War Hawks', icon: '⚔️', baseSupport: 52, influence: 22 },
        { id: 'merchants', name: 'Guild Coalition', icon: '💰', baseSupport: 50, influence: 20 },
        { id: 'clergy', name: 'Clerical Synod', icon: '⛪', baseSupport: 54, influence: 18 },
        { id: 'commons', name: 'Commons Deputies', icon: '🧑‍🌾', baseSupport: 48, influence: 16 },
    ],

    _ensureState(player) {
        if (!player.council) {
            player.council = {
                approval: 55,
                lastConveneDay: -999,
                activeSessionUntilDay: 0,
                lastVoteDay: -999,
                warMandateUntilDay: 0,
                taxIncreaseApproval: null,
                factions: {},
                history: [],
            };
        }

        const state = player.council;
        if (typeof state.approval !== 'number') state.approval = 55;
        if (typeof state.lastConveneDay !== 'number') state.lastConveneDay = -999;
        if (typeof state.activeSessionUntilDay !== 'number') state.activeSessionUntilDay = 0;
        if (typeof state.lastVoteDay !== 'number') state.lastVoteDay = -999;
        if (typeof state.warMandateUntilDay !== 'number') state.warMandateUntilDay = 0;
        if (!Array.isArray(state.history)) state.history = [];
        if (!state.factions || typeof state.factions !== 'object') state.factions = {};

        for (const faction of this.FACTIONS) {
            if (!state.factions[faction.id]) {
                state.factions[faction.id] = {
                    id: faction.id,
                    support: faction.baseSupport,
                    influence: faction.influence,
                    suppressedUntilDay: 0,
                };
            }
            const record = state.factions[faction.id];
            record.support = Math.max(0, Math.min(100, Number(record.support ?? faction.baseSupport)));
            record.influence = Math.max(1, Number(record.influence ?? faction.influence));
            record.suppressedUntilDay = Number(record.suppressedUntilDay || 0);
        }

        return state;
    },

    initializePlayer(player) {
        this._ensureState(player);
    },

    loadState(player) {
        this._ensureState(player);
    },

    _hasGoverningRole(player) {
        return !!(player && player.allegiance && ['king', 'chancellor', 'treasurer'].includes(player.kingdomTitle));
    },

    _hasWarAuthority(player) {
        return !!(player && player.allegiance && ['king', 'chancellor'].includes(player.kingdomTitle));
    },

    _addHistory(state, entry) {
        state.history.unshift({
            day: entry.day,
            text: entry.text,
            passed: !!entry.passed,
            type: entry.type || 'council',
        });
        if (state.history.length > 20) state.history.length = 20;
    },

    conveneCouncil(player, world) {
        if (!this._hasGoverningRole(player)) {
            return { success: false, reason: 'Only the King, Chancellor, or Treasurer can convene the council.' };
        }

        const state = this._ensureState(player);
        const day = world?.day || 0;

        const daysSince = day - state.lastConveneDay;
        if (daysSince < this.CONVENE_COOLDOWN_DAYS) {
            return {
                success: false,
                reason: `The chamber is still in recess. You can convene again in ${this.CONVENE_COOLDOWN_DAYS - daysSince} day(s).`,
            };
        }

        state.lastConveneDay = day;
        state.activeSessionUntilDay = day + this.SESSION_DURATION_DAYS;

        const diplomacySkill = player.skills?.diplomacy || 1;
        const rep = (player.reputation && player.allegiance) ? (player.reputation[player.allegiance] || 0) : 0;
        const approvalGain = Math.max(1, Math.floor(diplomacySkill * 0.4 + rep * 0.03));
        state.approval = Math.max(0, Math.min(100, state.approval + approvalGain));

        this._addHistory(state, {
            day,
            type: 'session',
            passed: true,
            text: `Council convened for ${this.SESSION_DURATION_DAYS} days. Public approval +${approvalGain}.`,
        });

        return {
            success: true,
            approvalGain,
            sessionUntilDay: state.activeSessionUntilDay,
        };
    },

    _sessionActive(state, world) {
        const day = world?.day || 0;
        return day <= (state.activeSessionUntilDay || 0);
    },

    _getTaxRateValue(rateId) {
        if (typeof Taxation === 'undefined' || !Taxation.TAX_RATES) return 0;
        const policy = Taxation.TAX_RATES[String(rateId || '').toUpperCase()];
        return policy ? policy.rate : 0;
    },

    _proposalBias(proposalType, factionId) {
        const biasTable = {
            tax_increase: {
                nobility: 6,
                military: 4,
                merchants: -12,
                clergy: 1,
                commons: -14,
            },
            war_declaration: {
                nobility: 8,
                military: 18,
                merchants: -9,
                clergy: -4,
                commons: -6,
            },
        };
        return biasTable[proposalType]?.[factionId] || 0;
    },

    callVote(player, world, proposalType, options = {}) {
        if (!this._hasGoverningRole(player)) {
            return { success: false, reason: 'You lack council authority to call a vote.' };
        }

        const state = this._ensureState(player);
        const day = world?.day || 0;

        if (!this._sessionActive(state, world)) {
            return { success: false, reason: 'No active council session. Convene the council first.' };
        }

        if ((day - state.lastVoteDay) < this.VOTE_COOLDOWN_DAYS) {
            return { success: false, reason: `The council requires ${this.VOTE_COOLDOWN_DAYS} days between major votes.` };
        }

        if (proposalType === 'tax_increase') {
            const currentValue = this._getTaxRateValue(player.taxRate || 'moderate');
            const nextValue = this._getTaxRateValue(options.newRate);
            if (!nextValue || nextValue <= currentValue) {
                return { success: false, reason: 'Tax increase votes require selecting a higher tax policy.' };
            }
        }

        if (proposalType === 'war_declaration') {
            if (!this._hasWarAuthority(player)) {
                return { success: false, reason: 'Only the King or Chancellor can request a war vote.' };
            }
            if (!options.targetKingdomId) {
                return { success: false, reason: 'Select a target kingdom for the war vote.' };
            }
        }

        const diplomacy = player.skills?.diplomacy || 1;
        const rep = (player.reputation && player.allegiance) ? (player.reputation[player.allegiance] || 0) : 0;
        const governanceBonus = (diplomacy * 1.4) + (rep * 0.08) + (state.approval * 0.2);

        let totalInfluence = 0;
        let yesInfluence = 0;
        const factionVotes = [];

        for (const template of this.FACTIONS) {
            const faction = state.factions[template.id];
            const isSuppressed = (faction.suppressedUntilDay || 0) >= day;
            const suppressionPenalty = isSuppressed ? -14 : 0;
            const bias = this._proposalBias(proposalType, template.id);
            const randomSwing = Utils.randInt(-8, 8);
            const score = faction.support + bias + governanceBonus + suppressionPenalty + randomSwing;
            const inFavor = score >= 50;

            totalInfluence += faction.influence;
            if (inFavor) yesInfluence += faction.influence;

            factionVotes.push({
                id: template.id,
                name: template.name,
                icon: template.icon,
                inFavor,
                influence: faction.influence,
                score: Math.round(score),
            });
        }

        const yesRatio = totalInfluence > 0 ? (yesInfluence / totalInfluence) : 0;
        const required = 0.55;
        const passed = yesRatio >= required;

        state.lastVoteDay = day;

        let summaryText = '';
        if (proposalType === 'tax_increase') {
            if (passed) {
                const requestedRate = String(options.newRate);
                state.taxIncreaseApproval = {
                    rateId: requestedRate,
                    maxRateValue: this._getTaxRateValue(requestedRate),
                    expiresDay: day + 20,
                };
                state.approval = Math.max(0, Math.min(100, state.approval - 2));
                summaryText = `Tax increase approved until day ${state.taxIncreaseApproval.expiresDay}.`;
            } else {
                state.approval = Math.max(0, Math.min(100, state.approval - 6));
                summaryText = 'Tax increase motion was rejected.';
            }
        } else if (proposalType === 'war_declaration') {
            if (passed) {
                state.warMandateUntilDay = day + 20;
                state.warMandateTarget = options.targetKingdomId;
                state.approval = Math.max(0, Math.min(100, state.approval - 3));
                const targetName = world?.getKingdom(options.targetKingdomId)?.name || 'the chosen rival';
                summaryText = `War mandate passed against ${targetName} until day ${state.warMandateUntilDay}.`;
            } else {
                state.approval = Math.max(0, Math.min(100, state.approval - 5));
                summaryText = 'War mandate failed in council.';
            }
        }

        this._addHistory(state, {
            day,
            type: proposalType,
            passed,
            text: summaryText,
        });

        return {
            success: true,
            passed,
            yesRatio,
            required,
            factionVotes,
            summaryText,
        };
    },

    manageFaction(player, world, factionId, mode) {
        if (!this._hasGoverningRole(player)) {
            return { success: false, reason: 'Only senior officials can manage factions.' };
        }

        const state = this._ensureState(player);
        const day = world?.day || 0;

        if (!this._sessionActive(state, world)) {
            return { success: false, reason: 'Faction actions require an active council session.' };
        }

        const faction = state.factions[factionId];
        const factionMeta = this.FACTIONS.find(f => f.id === factionId);
        if (!faction || !factionMeta) {
            return { success: false, reason: 'Unknown faction.' };
        }

        if (mode === 'manage') {
            const cost = 80;
            if ((player.gold || 0) < cost) {
                return { success: false, reason: `Need ${cost} gold to negotiate with ${factionMeta.name}.` };
            }
            player.gold -= cost;
            faction.support = Math.min(100, faction.support + Utils.randInt(8, 14));
            state.approval = Math.min(100, state.approval + 2);

            this._addHistory(state, {
                day,
                type: 'faction',
                passed: true,
                text: `Negotiated with ${factionMeta.name}. Support increased.`,
            });

            return { success: true, faction: factionMeta.name, support: faction.support, approval: state.approval };
        }

        if (mode === 'suppress') {
            faction.support = Math.max(0, faction.support - Utils.randInt(12, 20));
            faction.suppressedUntilDay = day + 10;
            state.approval = Math.max(0, state.approval - 5);
            player.karma = (player.karma || 0) - 2;

            this._addHistory(state, {
                day,
                type: 'faction',
                passed: false,
                text: `${factionMeta.name} was suppressed by force.`,
            });

            return { success: true, faction: factionMeta.name, support: faction.support, approval: state.approval };
        }

        return { success: false, reason: 'Invalid faction action.' };
    },

    canRaiseTaxes(player, newRate, world) {
        const state = this._ensureState(player);
        const currentRateValue = this._getTaxRateValue(player.taxRate || 'moderate');
        const newRateValue = this._getTaxRateValue(newRate);

        if (newRateValue <= currentRateValue) {
            return { success: true };
        }

        const approval = state.taxIncreaseApproval;
        const day = world?.day || 0;
        if (!approval || day > approval.expiresDay) {
            return { success: false, reason: 'Council approval required for tax increases. Convene council and pass a tax vote.' };
        }

        if (newRateValue > approval.maxRateValue) {
            return { success: false, reason: 'Council only approved a smaller tax increase than requested.' };
        }

        state.taxIncreaseApproval = null;
        return { success: true };
    },

    hasWarMandate(player, world, targetKingdomId) {
        const state = this._ensureState(player);
        const day = world?.day || 0;
        if (day > (state.warMandateUntilDay || 0)) return false;

        if (state.warMandateTarget && targetKingdomId) {
            return state.warMandateTarget === targetKingdomId;
        }

        return true;
    },

    getAvailableWarTargets(player, world) {
        if (!player?.allegiance || !world) return [];
        const kingdom = world.getKingdom(player.allegiance);
        if (!kingdom) return [];

        return world.kingdoms.filter(k =>
            k.isAlive &&
            k.id !== kingdom.id &&
            !(kingdom.allies || []).includes(k.id) &&
            !(kingdom.wars || []).includes(k.id)
        );
    },

    declareWar(player, world, targetKingdomId) {
        if (!this._hasWarAuthority(player)) {
            return { success: false, reason: 'Only the King or Chancellor can declare war.' };
        }

        if (!this.hasWarMandate(player, world, targetKingdomId)) {
            return { success: false, reason: 'Council war mandate required. Pass a war vote first.' };
        }

        const kingdom = world?.getKingdom(player.allegiance);
        const target = world?.getKingdom(targetKingdomId);
        if (!kingdom || !target || !target.isAlive) {
            return { success: false, reason: 'Invalid war target.' };
        }

        if ((kingdom.wars || []).includes(target.id)) {
            return { success: false, reason: `Already at war with ${target.name}.` };
        }

        kingdom.wars = kingdom.wars || [];
        target.wars = target.wars || [];
        kingdom.wars.push(target.id);
        target.wars.push(kingdom.id);

        kingdom.relations = kingdom.relations || {};
        target.relations = target.relations || {};
        kingdom.relations[target.id] = -100;
        target.relations[kingdom.id] = -100;

        const state = this._ensureState(player);
        state.warMandateUntilDay = 0;
        state.warMandateTarget = null;
        state.approval = Math.max(0, state.approval - 4);

        if (world.events) {
            world.events.push({
                text: `⚔️ By vote of council, ${kingdom.name} has declared war on ${target.name}!`,
                type: 'military',
            });
        }

        this._addHistory(state, {
            day: world?.day || 0,
            type: 'war',
            passed: true,
            text: `War declared on ${target.name}.`,
        });

        return { success: true, kingdom: kingdom.name, target: target.name };
    },

    getSummary(player, world) {
        const state = this._ensureState(player);
        const day = world?.day || 0;
        const factions = this.FACTIONS.map(template => {
            const f = state.factions[template.id];
            return {
                id: template.id,
                name: template.name,
                icon: template.icon,
                support: f.support,
                influence: f.influence,
                suppressed: day <= (f.suppressedUntilDay || 0),
                suppressedUntilDay: f.suppressedUntilDay || 0,
            };
        });

        return {
            approval: Math.round(state.approval),
            sessionActive: this._sessionActive(state, world),
            activeSessionUntilDay: state.activeSessionUntilDay,
            lastConveneDay: state.lastConveneDay,
            warMandateUntilDay: state.warMandateUntilDay,
            warMandateTarget: state.warMandateTarget || null,
            taxIncreaseApproval: state.taxIncreaseApproval,
            factions,
            history: state.history.slice(0, 8),
            canGovern: this._hasGoverningRole(player),
            canDeclareWar: this._hasWarAuthority(player),
        };
    },
};

window.Councils = Councils;

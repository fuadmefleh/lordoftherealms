// ============================================
// FESTIVALS — Seasonal celebrations, contests, and rival diplomacy
// ============================================

const Festivals = {
    BUDGET_TIERS: {
        modest: { id: 'modest', label: 'Modest Fair', cost: 260, renown: 4, morale: 0.03, moraleDays: 5, diplomacy: 2 },
        fine: { id: 'fine', label: 'Noble Festival', cost: 460, renown: 8, morale: 0.05, moraleDays: 7, diplomacy: 4 },
        grand: { id: 'grand', label: 'Grand Celebration', cost: 820, renown: 14, morale: 0.08, moraleDays: 10, diplomacy: 7 },
    },

    CONTESTS: {
        jousting: { id: 'jousting', label: 'Jousting Lists', icon: '🐎', skills: ['combat', 'leadership'] },
        archery: { id: 'archery', label: 'Archery Contest', icon: '🏹', skills: ['combat', 'intelligence'] },
    },

    SEASONAL_THEMES: {
        Spring: { season: 'Spring', name: 'Bloomtide Revels', icon: '🌸', recommendedContest: 'jousting' },
        Summer: { season: 'Summer', name: 'Suncrest Games', icon: '☀️', recommendedContest: 'archery' },
        Autumn: { season: 'Autumn', name: 'Harvest Crown', icon: '🍂', recommendedContest: 'archery' },
        Winter: { season: 'Winter', name: 'Frostfire Jubilee', icon: '❄️', recommendedContest: 'jousting' },
    },

    initialize(player) {
        if (!player.festivals || typeof player.festivals !== 'object') {
            player.festivals = {
                hosted: 0,
                successfulContests: 0,
                diplomacyEvents: 0,
                sabotageEvents: 0,
                moraleBoostDays: 0,
                moraleBoostValue: 0,
                lastHostedDay: -999,
                history: [],
            };
        }

        const state = player.festivals;
        if (typeof state.hosted !== 'number') state.hosted = 0;
        if (typeof state.successfulContests !== 'number') state.successfulContests = 0;
        if (typeof state.diplomacyEvents !== 'number') state.diplomacyEvents = 0;
        if (typeof state.sabotageEvents !== 'number') state.sabotageEvents = 0;
        if (typeof state.moraleBoostDays !== 'number') state.moraleBoostDays = 0;
        if (typeof state.moraleBoostValue !== 'number') state.moraleBoostValue = 0;
        if (typeof state.lastHostedDay !== 'number') state.lastHostedDay = -999;
        if (!Array.isArray(state.history)) state.history = [];
    },

    loadState(player) {
        this.initialize(player);
    },

    getSeasonTheme(world) {
        const season = world?.season || 'Spring';
        return this.SEASONAL_THEMES[season] || this.SEASONAL_THEMES.Spring;
    },

    getBudgetOptions() {
        return Object.values(this.BUDGET_TIERS);
    },

    canHostFestival(player, world, settlementTile) {
        this.initialize(player);
        if (!settlementTile?.settlement) {
            return { ok: false, reason: 'Festivals can only be hosted in settlements.' };
        }

        const settlementType = settlementTile.settlement.type;
        if (!['town', 'capital'].includes(settlementType)) {
            return { ok: false, reason: 'Only towns and capitals can host major festivals.' };
        }

        const cooldownDays = 8;
        const since = (world?.day || 0) - player.festivals.lastHostedDay;
        if (since < cooldownDays) {
            return { ok: false, reason: `Your household needs ${cooldownDays - since} more day(s) before hosting another grand festival.` };
        }

        return { ok: true };
    },

    _contestPerformance(player, contestId, score = 0, world = null) {
        const seasonTheme = this.getSeasonTheme(world);
        const combat = player.skills?.combat || 1;
        const leadership = player.skills?.leadership || 1;
        const intelligence = player.intelligence || 5;
        const luck = player.luck || 5;

        let statPower = 0;
        if (contestId === 'jousting') {
            statPower = combat * 1.2 + leadership * 0.8 + ((player.strength || 5) - 4) * 0.7;
        } else {
            statPower = combat * 0.9 + intelligence * 0.8 + luck * 0.45;
        }

        const scorePower = score * 2.1;
        const randomness = Utils.randFloat(0.5, 5.5);
        const recommendedBonus = seasonTheme.recommendedContest === contestId ? 1.4 : 0;
        const total = statPower + scorePower + recommendedBonus + randomness;

        if (total >= 16) {
            return {
                tier: 'champion',
                renown: 8,
                gold: Utils.randInt(140, 260),
                moraleBonus: 0.02,
                text: contestId === 'jousting'
                    ? 'You are crowned champion of the lists after a thunderous final pass.'
                    : 'Your final volley splits the center mark and wins roaring applause.'
            };
        }

        if (total >= 11) {
            return {
                tier: 'strong',
                renown: 4,
                gold: Utils.randInt(60, 140),
                moraleBonus: 0.01,
                text: contestId === 'jousting'
                    ? 'You place among the top riders and earn a noble commendation.'
                    : 'Your arrows land true enough to claim a respected finish.'
            };
        }

        return {
            tier: 'rough',
            renown: 1,
            gold: Utils.randInt(0, 45),
            moraleBonus: 0,
            text: contestId === 'jousting'
                ? 'A broken lance and shaky seat keep you from the finals.'
                : 'Shifting winds ruin your aim and you bow out early.'
        };
    },

    _nearbyRivalKingdoms(player, world, tile) {
        const rivals = new Map();
        if (!world?.getAllSettlements) return [];
        const allSettlements = world.getAllSettlements();

        for (const settlement of allSettlements) {
            if (!settlement?.kingdom || settlement.kingdom === player.allegiance) continue;

            const dist = Hex.wrappingDistance
                ? Hex.wrappingDistance(tile.q, tile.r, settlement.q, settlement.r, world.width)
                : Hex.distance(tile.q, tile.r, settlement.q, settlement.r);

            if (dist > 28) continue;
            if (!rivals.has(settlement.kingdom) || dist < rivals.get(settlement.kingdom).distance) {
                const kingdom = world.getKingdom(settlement.kingdom);
                if (kingdom && kingdom.isAlive) {
                    rivals.set(settlement.kingdom, {
                        id: kingdom.id,
                        name: kingdom.name,
                        distance: dist,
                    });
                }
            }
        }

        return Array.from(rivals.values()).sort((a, b) => a.distance - b.distance).slice(0, 3);
    },

    hostFestival(player, world, tile, options = {}) {
        this.initialize(player);

        const gate = this.canHostFestival(player, world, tile);
        if (!gate.ok) return { success: false, reason: gate.reason };

        const tier = this.BUDGET_TIERS[options.tier] || this.BUDGET_TIERS.modest;
        if ((player.gold || 0) < tier.cost) {
            return { success: false, reason: `You need ${tier.cost} gold to host this festival.` };
        }

        const stance = options.stance === 'security' ? 'security' : 'diplomatic';
        const contestId = this.CONTESTS[options.contest] ? options.contest : this.getSeasonTheme(world).recommendedContest;
        const seasonTheme = this.getSeasonTheme(world);
        const contestResult = this._contestPerformance(player, contestId, options.contestScore || 0, world);

        player.gold -= tier.cost;

        const reputations = [];
        const sabotage = [];
        const attendees = this._nearbyRivalKingdoms(player, world, tile);

        for (const rival of attendees) {
            const relation = player.reputation?.[rival.id] || 0;
            const hostileBias = relation < 0 ? 0.1 : 0;
            const sabotageChance = (stance === 'diplomatic' ? 0.24 : 0.11) + hostileBias;

            if (Math.random() < sabotageChance) {
                const caught = stance === 'security' && Math.random() < 0.55;
                if (!caught) {
                    const loss = Utils.randInt(40, 140) + (tier.id === 'grand' ? 50 : 0);
                    player.gold = Math.max(0, player.gold - loss);
                    sabotage.push({ rival: rival.name, caught: false, goldLost: loss });
                    player.festivals.sabotageEvents += 1;
                } else {
                    sabotage.push({ rival: rival.name, caught: true, goldLost: 0 });
                    player.renown = (player.renown || 0) + 1;
                    player.karma = (player.karma || 0) + 1;
                    player.festivals.sabotageEvents += 1;
                }
                continue;
            }

            const repGain = tier.diplomacy + (stance === 'diplomatic' ? 2 : 0) + Utils.randInt(0, 2);
            if (player.reputation) {
                player.reputation[rival.id] = (player.reputation[rival.id] || 0) + repGain;
            }
            reputations.push({ rival: rival.name, repGain });
            player.festivals.diplomacyEvents += 1;
        }

        const renownGain = tier.renown + contestResult.renown + reputations.length;
        const moraleBoost = tier.morale + contestResult.moraleBonus;

        player.renown = (player.renown || 0) + renownGain;
        player.gold += contestResult.gold;

        if (Math.random() < (stance === 'diplomatic' ? 0.35 : 0.18)) {
            player.skills.diplomacy = Math.min(10, (player.skills.diplomacy || 1) + 1);
        }

        player.festivals.hosted += 1;
        if (contestResult.tier !== 'rough') {
            player.festivals.successfulContests += 1;
        }
        player.festivals.lastHostedDay = world.day;
        player.festivals.moraleBoostDays = Math.max(player.festivals.moraleBoostDays, tier.moraleDays);
        player.festivals.moraleBoostValue = Math.max(player.festivals.moraleBoostValue, moraleBoost);

        const record = {
            day: world.day,
            season: world.season,
            settlement: tile.settlement?.name || 'Unknown',
            theme: seasonTheme.name,
            tier: tier.id,
            contest: contestId,
            contestTier: contestResult.tier,
            renownGain,
            diplomacyCount: reputations.length,
            sabotageCount: sabotage.length,
        };

        player.festivals.history.unshift(record);
        if (player.festivals.history.length > 20) player.festivals.history.length = 20;

        return {
            success: true,
            tier,
            stance,
            seasonTheme,
            contest: this.CONTESTS[contestId],
            contestResult,
            reputations,
            sabotage,
            renownGain,
            moraleBoost,
            moraleDays: tier.moraleDays,
            contestPrize: contestResult.gold,
            attendees,
            record,
        };
    },

    processDaily(player, world) {
        this.initialize(player);
        const updates = { moraleExpired: false, moraleDaysLeft: 0, moraleValue: 0 };

        if (player.festivals.moraleBoostDays > 0) {
            player.festivals.moraleBoostDays -= 1;
            if (player.festivals.moraleBoostDays <= 0) {
                player.festivals.moraleBoostDays = 0;
                player.festivals.moraleBoostValue = 0;
                updates.moraleExpired = true;
            }
        }

        updates.moraleDaysLeft = player.festivals.moraleBoostDays;
        updates.moraleValue = player.festivals.moraleBoostValue || 0;
        return updates;
    },
};

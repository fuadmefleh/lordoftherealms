// ============================================
// PLAYER MILITARY — Military path systems
// ============================================

const PlayerMilitary = {
    /**
     * Unit types the player can recruit
     */
    UNIT_TYPES: {
        MILITIA: {
            id: 'militia',
            name: 'Militia',
            icon: '🗡️',
            cost: 50,
            upkeep: 2,
            strength: 5,
            description: 'Basic fighters, cheap but weak'
        },
        SOLDIER: {
            id: 'soldier',
            name: 'Soldier',
            icon: '⚔️',
            cost: 100,
            upkeep: 5,
            strength: 10,
            description: 'Trained warriors, reliable in battle'
        },
        KNIGHT: {
            id: 'knight',
            name: 'Knight',
            icon: '🛡️',
            cost: 300,
            upkeep: 15,
            strength: 30,
            description: 'Elite cavalry, devastating in combat'
        },
        ARCHER: {
            id: 'archer',
            name: 'Archer',
            icon: '🏹',
            cost: 80,
            upkeep: 4,
            strength: 8,
            description: 'Ranged attackers, good for defense'
        },
        PIKEMAN: {
            id: 'pikeman',
            name: 'Pikeman',
            icon: '🪓',
            cost: 110,
            upkeep: 5,
            strength: 12,
            description: 'Anti-cavalry infantry formation specialist'
        },
    },

    FORMATION_ROLES: {
        cavalry: ['knight'],
        archer: ['archer'],
        pikeman: ['pikeman', 'soldier', 'militia'],
    },

    _normalizeComposition(comp) {
        const c = {
            cavalry: Math.max(0, comp.cavalry || 0),
            archer: Math.max(0, comp.archer || 0),
            pikeman: Math.max(0, comp.pikeman || 0),
        };
        const total = c.cavalry + c.archer + c.pikeman;
        if (total <= 0) return { cavalry: 0.34, archer: 0.33, pikeman: 0.33 };
        c.cavalry /= total;
        c.archer /= total;
        c.pikeman /= total;
        return c;
    },

    _roleForUnitType(unitType) {
        for (const [role, types] of Object.entries(PlayerMilitary.FORMATION_ROLES)) {
            if (types.includes(unitType)) return role;
        }
        return 'pikeman';
    },

    getArmyComposition(player) {
        if (!player.army || player.army.length === 0) {
            return PlayerMilitary._normalizeComposition({});
        }

        const comp = { cavalry: 0, archer: 0, pikeman: 0 };
        for (const unit of player.army) {
            const role = PlayerMilitary._roleForUnitType(unit.type);
            const levelBonus = 1 + ((unit.level || 1) - 1) * 0.1;
            comp[role] += (unit.strength || 1) * levelBonus;
        }

        return PlayerMilitary._normalizeComposition(comp);
    },

    inferEnemyComposition(enemyStrength, enemyName = '', context = {}) {
        if (context.enemyComposition) {
            return PlayerMilitary._normalizeComposition(context.enemyComposition);
        }

        const name = (enemyName || '').toLowerCase();
        if (name.includes('raider') || name.includes('cavalry') || name.includes('knight')) {
            return PlayerMilitary._normalizeComposition({ cavalry: 0.55, archer: 0.15, pikeman: 0.30 });
        }
        if (name.includes('patrol')) {
            return PlayerMilitary._normalizeComposition({ cavalry: 0.35, archer: 0.30, pikeman: 0.35 });
        }
        if (name.includes('city') || name.includes('capital') || name.includes('garrison')) {
            return PlayerMilitary._normalizeComposition({ cavalry: 0.20, archer: 0.35, pikeman: 0.45 });
        }
        if (name.includes('bandit') || name.includes('pirate')) {
            return PlayerMilitary._normalizeComposition({ cavalry: 0.35, archer: 0.20, pikeman: 0.45 });
        }
        if (enemyStrength < 35) {
            return PlayerMilitary._normalizeComposition({ cavalry: 0.20, archer: 0.20, pikeman: 0.60 });
        }
        return PlayerMilitary._normalizeComposition({ cavalry: 0.30, archer: 0.30, pikeman: 0.40 });
    },

    _counterScore(attackerComp, defenderComp) {
        const advantage =
            attackerComp.cavalry * defenderComp.archer +
            attackerComp.archer * defenderComp.pikeman +
            attackerComp.pikeman * defenderComp.cavalry;

        const disadvantage =
            defenderComp.cavalry * attackerComp.archer +
            defenderComp.archer * attackerComp.pikeman +
            defenderComp.pikeman * attackerComp.cavalry;

        return advantage - disadvantage;
    },

    _counterMultiplier(attackerComp, defenderComp) {
        const score = PlayerMilitary._counterScore(attackerComp, defenderComp);
        return Math.max(0.8, Math.min(1.25, 1 + score * 0.75));
    },

    _terrainIsHills(terrainId = '') {
        return ['hills', 'highlands', 'foothills'].includes(terrainId);
    },

    _terrainIsPlains(terrainId = '') {
        return ['plains', 'grassland', 'steppe', 'savanna'].includes(terrainId);
    },

    _terrainMultiplier(terrainId, composition) {
        if (PlayerMilitary._terrainIsHills(terrainId)) {
            return 1 + composition.archer * 0.18;
        }
        if (PlayerMilitary._terrainIsPlains(terrainId)) {
            return 1 + composition.cavalry * 0.18;
        }
        return 1;
    },

    _moraleValue(ownStrength, enemyStrength, leadershipBonus = 0) {
        const ratio = enemyStrength / Math.max(1, ownStrength);
        const pressurePenalty = Math.max(0, ratio - 1) * 0.34;
        const morale = 1 - pressurePenalty + leadershipBonus;
        return Math.max(0.45, Math.min(1.2, morale));
    },

    _checkMoraleBreak(ownStrength, enemyStrength, moraleValue) {
        const outnumberedRatio = enemyStrength / Math.max(1, ownStrength);
        if (outnumberedRatio < 1.8) return false;
        const chance = Math.max(0.05, Math.min(0.75, (outnumberedRatio - 1.6) * 0.45 + (1 - moraleValue) * 0.6));
        return Math.random() < chance;
    },

    _getSettlementComposition(settlement, tile) {
        const composition = { cavalry: 0.18, archer: 0.32, pikeman: 0.50 };
        if (settlement.type === 'capital') {
            composition.archer += 0.08;
            composition.pikeman += 0.04;
        } else if (settlement.type === 'city') {
            composition.archer += 0.05;
        } else if (settlement.type === 'village') {
            composition.pikeman += 0.08;
        }

        const terrainId = tile?.terrain?.id;
        if (PlayerMilitary._terrainIsPlains(terrainId)) {
            composition.cavalry += 0.08;
        } else if (PlayerMilitary._terrainIsHills(terrainId)) {
            composition.archer += 0.08;
        }

        return PlayerMilitary._normalizeComposition(composition);
    },

    _getWorldUnitComposition(worldUnit) {
        switch (worldUnit.type) {
            case 'raider':
                return { cavalry: 0.65, archer: 0.10, pikeman: 0.25 };
            case 'patrol':
                return { cavalry: 0.35, archer: 0.35, pikeman: 0.30 };
            case 'settler':
            case 'caravan':
            case 'ship':
            case 'fishing_boat':
                return { cavalry: 0.10, archer: 0.10, pikeman: 0.80 };
            case 'pirate':
                return { cavalry: 0.20, archer: 0.45, pikeman: 0.35 };
            default:
                return { cavalry: 0.30, archer: 0.25, pikeman: 0.45 };
        }
    },

    /**
     * Recruit a unit at a settlement
     */
    recruitUnit(player, unitType, settlement) {
        const unit = PlayerMilitary.UNIT_TYPES[unitType.toUpperCase()];
        if (!unit) return { success: false, reason: 'Invalid unit type' };

        // Check gold
        if (player.gold < unit.cost) {
            return { success: false, reason: `Need ${unit.cost} gold (have ${player.gold})` };
        }

        // Check settlement size
        if (settlement.type === 'village' && unit.id === 'knight') {
            return { success: false, reason: 'Villages cannot recruit knights' };
        }

        player.gold -= unit.cost;

        // Add to player's army
        if (!player.army) player.army = [];
        player.army.push({
            type: unit.id,
            name: unit.name,
            icon: unit.icon,
            strength: unit.strength,
            upkeep: unit.upkeep,
            experience: 0,
            level: 1,
        });

        // Increase combat skill
        player.skills.combat = Math.min(10, player.skills.combat + 0.3);

        return { success: true, unit };
    },

    /**
     * Calculate total army strength
     */
    getArmyStrength(player) {
        if (!player.army || player.army.length === 0) return 0;

        let total = 0;
        for (const unit of player.army) {
            let strength = unit.strength;
            // Level bonus
            strength *= (1 + (unit.level - 1) * 0.2);
            // Combat skill bonus
            strength *= (1 + player.skills.combat * 0.1);
            // Technology strength bonus
            if (typeof Technology !== 'undefined') {
                const techBonus = Technology.getUnitStrengthBonus(player, unit.type);
                if (techBonus > 0) strength *= (1 + techBonus);
            }
            total += strength;
        }

        return Math.floor(total);
    },

    /**
     * Calculate daily upkeep cost
     */
    getUpkeepCost(player) {
        if (!player.army || player.army.length === 0) return 0;

        let total = 0;
        for (const unit of player.army) {
            total += unit.upkeep;
        }
        return total;
    },

    /**
     * Pay army upkeep
     */
    payUpkeep(player, world = null) {
        PlayerMilitary._ensureMercenaryState(player);
        const cost = PlayerMilitary.getUpkeepCost(player);
        const result = {
            paid: true,
            cost: 0,
            unitsLost: 0,
            mercenaryWages: 0,
            mercenaryEvents: [],
        };

        if (player.gold < cost) {
            // Can't pay - lose some units
            const nonMercCount = (player.army || []).filter(unit => !unit.mercenary).length;
            const unitsLost = Math.max(1, Math.ceil(nonMercCount * 0.1));
            for (let i = 0; i < unitsLost; i++) {
                let removed = false;
                for (let index = player.army.length - 1; index >= 0; index--) {
                    if (!player.army[index].mercenary) {
                        player.army.splice(index, 1);
                        removed = true;
                        break;
                    }
                }
                if (!removed && player.army.length > 0) {
                    player.army.pop();
                }
            }
            result.paid = false;
            result.unitsLost = unitsLost;
        } else {
            player.gold -= cost;
            result.cost = cost;
        }

        const mercenaryUpdate = PlayerMilitary._processMercenaryCompanies(player, world);
        result.mercenaryWages = mercenaryUpdate.wagesPaid;
        result.mercenaryEvents = mercenaryUpdate.events;

        return result;
    },

    /**
     * Mercenary contract types
     */
    CONTRACT_TYPES: {
        GUARD_DUTY: {
            id: 'guard_duty',
            name: 'Guard Duty',
            icon: '🛡️',
            payment: 100,
            duration: 3,
            minStrength: 20,
            description: 'Guard a settlement for 3 days'
        },
        BANDIT_HUNT: {
            id: 'bandit_hunt',
            name: 'Bandit Hunt',
            icon: '🗡️',
            payment: 200,
            duration: 5,
            minStrength: 50,
            risk: 0.3,
            description: 'Hunt down bandits threatening trade routes'
        },
        ESCORT_CARAVAN: {
            id: 'escort_caravan',
            name: 'Escort Caravan',
            icon: '🚚',
            payment: 150,
            duration: 4,
            minStrength: 30,
            risk: 0.2,
            description: 'Protect a merchant caravan'
        },
        SIEGE_SUPPORT: {
            id: 'siege_support',
            name: 'Siege Support',
            icon: '🏰',
            payment: 500,
            duration: 10,
            minStrength: 100,
            risk: 0.5,
            description: 'Support a kingdom in a siege'
        },
    },

    MERCENARY_COMPANIES: [
        {
            id: 'red_lances',
            name: 'The Red Lances',
            icon: '🩸',
            reputation: 'Famed heavy cavalry shock company',
            hireCost: 620,
            dailyWage: 95,
            durationMin: 6,
            durationMax: 10,
            baseLoyalty: 66,
            outbidRisk: 0.15,
            roster: [
                { type: 'knight', count: 3 },
                { type: 'soldier', count: 4 },
            ],
        },
        {
            id: 'storm_arrows',
            name: 'Storm Arrows Consortium',
            icon: '🏹',
            reputation: 'Disciplined long-range volleys and ambushes',
            hireCost: 540,
            dailyWage: 82,
            durationMin: 7,
            durationMax: 12,
            baseLoyalty: 70,
            outbidRisk: 0.12,
            roster: [
                { type: 'archer', count: 8 },
                { type: 'soldier', count: 2 },
            ],
        },
        {
            id: 'black_pikes',
            name: 'Black Pike Brotherhood',
            icon: '⚫',
            reputation: 'Veteran anti-cavalry line infantry',
            hireCost: 560,
            dailyWage: 88,
            durationMin: 8,
            durationMax: 12,
            baseLoyalty: 72,
            outbidRisk: 0.11,
            roster: [
                { type: 'pikeman', count: 6 },
                { type: 'soldier', count: 4 },
            ],
        },
        {
            id: 'wolfguard',
            name: 'Wolfguard Free Spears',
            icon: '🐺',
            reputation: 'Balanced veterans with high field endurance',
            hireCost: 590,
            dailyWage: 90,
            durationMin: 7,
            durationMax: 11,
            baseLoyalty: 68,
            outbidRisk: 0.14,
            roster: [
                { type: 'pikeman', count: 3 },
                { type: 'archer', count: 3 },
                { type: 'soldier', count: 4 },
            ],
        },
        {
            id: 'iron_oath',
            name: 'Iron Oath Wardens',
            icon: '⛓️',
            reputation: 'Elite contract defenders who hold the line',
            hireCost: 710,
            dailyWage: 105,
            durationMin: 6,
            durationMax: 9,
            baseLoyalty: 74,
            outbidRisk: 0.1,
            roster: [
                { type: 'knight', count: 2 },
                { type: 'pikeman', count: 4 },
                { type: 'soldier', count: 4 },
            ],
        },
    ],

    _ensureMercenaryState(player) {
        if (!Array.isArray(player.mercenaryCompanies)) player.mercenaryCompanies = [];
        if (!player._mercenaryMarkets) player._mercenaryMarkets = {};
    },

    _getMercenaryMarketKey(tile) {
        return `${tile.q},${tile.r}`;
    },

    _cloneRoster(roster = []) {
        return roster.map(row => ({ type: row.type, count: row.count }));
    },

    _getMercenaryUnitDefinition(unitType) {
        return PlayerMilitary.UNIT_TYPES[unitType.toUpperCase()] || PlayerMilitary.UNIT_TYPES.SOLDIER;
    },

    _removeMercenaryCompanyUnits(player, companyId) {
        if (!Array.isArray(player.army)) return 0;
        const before = player.army.length;
        player.army = player.army.filter(unit => unit.mercenaryCompanyId !== companyId);
        return before - player.army.length;
    },

    _estimateCompanyStrength(company) {
        let strength = 0;
        for (const row of company.roster || []) {
            const definition = PlayerMilitary._getMercenaryUnitDefinition(row.type);
            strength += (definition.strength || 0) * (row.count || 0);
        }
        return strength;
    },

    getMercenaryOffers(player, tile, world) {
        PlayerMilitary._ensureMercenaryState(player);
        if (!tile || !tile.settlement) return [];

        const day = world?.day || 1;
        const key = PlayerMilitary._getMercenaryMarketKey(tile);
        const existingMarket = player._mercenaryMarkets[key];
        if (existingMarket && day < existingMarket.refreshDay) {
            return existingMarket.offers || [];
        }

        const activeTemplateIds = new Set((player.mercenaryCompanies || []).map(c => c.templateId));
        const pool = PlayerMilitary.MERCENARY_COMPANIES.filter(company => !activeTemplateIds.has(company.id));
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        const offerCount = Math.min(shuffled.length, Math.max(1, 2 + (Math.random() < 0.35 ? 1 : 0)));

        const offers = [];
        for (let i = 0; i < offerCount; i++) {
            const template = shuffled[i];
            offers.push({
                offerId: `${template.id}_${day}_${i}`,
                templateId: template.id,
                name: template.name,
                icon: template.icon,
                reputation: template.reputation,
                hireCost: Math.floor(template.hireCost * Utils.randFloat(0.92, 1.08)),
                dailyWage: Math.floor(template.dailyWage * Utils.randFloat(0.9, 1.1)),
                duration: Utils.randInt(template.durationMin, template.durationMax),
                loyalty: Math.max(45, Math.min(90, template.baseLoyalty + Utils.randInt(-6, 8))),
                outbidRisk: template.outbidRisk,
                roster: PlayerMilitary._cloneRoster(template.roster),
            });
        }

        player._mercenaryMarkets[key] = {
            refreshDay: day + 4,
            settlementName: tile.settlement.name,
            offers,
        };

        return offers;
    },

    hireMercenaryCompany(player, tile, offerId, world) {
        PlayerMilitary._ensureMercenaryState(player);
        if (!tile || !tile.settlement) return { success: false, reason: 'Mercenaries can only be hired at settlements.' };

        const offers = PlayerMilitary.getMercenaryOffers(player, tile, world);
        const offer = offers.find(entry => entry.offerId === offerId);
        if (!offer) return { success: false, reason: 'This company has moved on.' };

        if (player.gold < offer.hireCost) {
            return { success: false, reason: `Need ${offer.hireCost} gold to hire ${offer.name}.` };
        }

        const companyId = `merc_${Date.now()}_${Math.floor(Math.random() * 999)}`;
        const company = {
            id: companyId,
            templateId: offer.templateId,
            name: offer.name,
            icon: offer.icon,
            reputation: offer.reputation,
            settlementName: tile.settlement.name,
            contractStartDay: world?.day || 1,
            daysRemaining: offer.duration,
            dailyWage: offer.dailyWage,
            loyalty: offer.loyalty,
            outbidRisk: offer.outbidRisk,
            roster: PlayerMilitary._cloneRoster(offer.roster),
            initialHireCost: offer.hireCost,
            lastEvent: 'hired',
        };

        if (!Array.isArray(player.army)) player.army = [];
        for (const row of company.roster) {
            const definition = PlayerMilitary._getMercenaryUnitDefinition(row.type);
            for (let count = 0; count < row.count; count++) {
                player.army.push({
                    type: definition.id,
                    name: definition.name,
                    icon: definition.icon,
                    strength: definition.strength,
                    upkeep: 0,
                    experience: Utils.randInt(10, 35),
                    level: 1,
                    mercenary: true,
                    mercenaryCompanyId: companyId,
                    mercenaryCompanyName: company.name,
                });
            }
        }

        player.gold -= offer.hireCost;
        player.mercenaryCompanies.push(company);

        const key = PlayerMilitary._getMercenaryMarketKey(tile);
        player._mercenaryMarkets[key].offers = player._mercenaryMarkets[key].offers.filter(entry => entry.offerId !== offerId);

        player.skills.leadership = Math.min(10, (player.skills.leadership || 1) + 0.2);

        return { success: true, company };
    },

    payMercenaryBonus(player, companyId, goldAmount = 120) {
        PlayerMilitary._ensureMercenaryState(player);
        const company = player.mercenaryCompanies.find(entry => entry.id === companyId);
        if (!company) return { success: false, reason: 'Company not found.' };

        const bonus = Math.max(50, Math.floor(goldAmount));
        if (player.gold < bonus) return { success: false, reason: `Need ${bonus} gold.` };

        player.gold -= bonus;
        const loyaltyGain = Math.floor(bonus / 45);
        company.loyalty = Math.min(100, company.loyalty + loyaltyGain);
        company.lastEvent = 'bonus_paid';

        return { success: true, company, bonus, loyaltyGain };
    },

    dismissMercenaryCompany(player, companyId) {
        PlayerMilitary._ensureMercenaryState(player);
        const index = player.mercenaryCompanies.findIndex(entry => entry.id === companyId);
        if (index < 0) return { success: false, reason: 'Company not found.' };

        const [company] = player.mercenaryCompanies.splice(index, 1);
        const unitsRemoved = PlayerMilitary._removeMercenaryCompanyUnits(player, companyId);

        return { success: true, company, unitsRemoved };
    },

    _processMercenaryCompanies(player, world) {
        PlayerMilitary._ensureMercenaryState(player);
        const events = [];
        let wagesPaid = 0;

        for (let i = player.mercenaryCompanies.length - 1; i >= 0; i--) {
            const company = player.mercenaryCompanies[i];
            company.daysRemaining = Math.max(0, (company.daysRemaining || 0) - 1);

            const paidWage = player.gold >= company.dailyWage;
            if (paidWage) {
                player.gold -= company.dailyWage;
                wagesPaid += company.dailyWage;
                company.loyalty = Math.min(100, company.loyalty + 1);
            } else {
                company.loyalty = Math.max(0, company.loyalty - 12);
            }

            company.loyalty = Math.max(0, company.loyalty - Utils.randFloat(0.5, 2.5));

            if (company.daysRemaining <= 0) {
                const unitsRemoved = PlayerMilitary._removeMercenaryCompanyUnits(player, company.id);
                player.mercenaryCompanies.splice(i, 1);
                events.push({
                    type: 'contract_expired',
                    companyName: company.name,
                    companyIcon: company.icon,
                    unitsRemoved,
                    text: `${company.icon} ${company.name} contract ended and the company marched on.`,
                });
                continue;
            }

            const outbidPressure = paidWage ? 0 : 0.22;
            const loyaltyPressure = Math.max(0, (45 - company.loyalty) * 0.012);
            const switchChance = Math.max(0.04, Math.min(0.82, company.outbidRisk + outbidPressure + loyaltyPressure));

            if (Math.random() < switchChance) {
                const unitsRemoved = PlayerMilitary._removeMercenaryCompanyUnits(player, company.id);
                player.mercenaryCompanies.splice(i, 1);

                let rivalName = 'a rival banner';
                if (world && Array.isArray(world.kingdoms)) {
                    const rivals = world.kingdoms.filter(kingdom => kingdom.isAlive && kingdom.id !== player.allegiance);
                    const chosen = rivals.length > 0 ? Utils.randPick(rivals) : null;
                    if (chosen) {
                        rivalName = chosen.name;
                        const reinforcement = Math.floor(PlayerMilitary._estimateCompanyStrength(company) * 0.45);
                        chosen.military = (chosen.military || 0) + reinforcement;
                    }
                }

                events.push({
                    type: 'outbid_switch',
                    companyName: company.name,
                    companyIcon: company.icon,
                    rivalName,
                    unitsRemoved,
                    text: `${company.icon} ${company.name} accepted a richer offer from ${rivalName} and switched sides!`,
                });
                continue;
            }

            if (company.loyalty < 45) {
                events.push({
                    type: 'loyalty_warning',
                    companyName: company.name,
                    companyIcon: company.icon,
                    loyalty: Math.floor(company.loyalty),
                    text: `${company.icon} ${company.name} loyalty is wavering (${Math.floor(company.loyalty)}).`,
                });
            }
        }

        return { wagesPaid, events };
    },

    /**
     * Accept a mercenary contract
     */
    acceptContract(player, contractType, settlement) {
        const contract = PlayerMilitary.CONTRACT_TYPES[contractType.toUpperCase()];
        if (!contract) return { success: false, reason: 'Invalid contract' };

        const strength = PlayerMilitary.getArmyStrength(player);
        if (strength < contract.minStrength) {
            return { success: false, reason: `Need army strength of ${contract.minStrength} (have ${strength})` };
        }

        if (player.activeContract) {
            return { success: false, reason: 'Already on a contract' };
        }

        player.activeContract = {
            type: contract.id,
            name: contract.name,
            payment: contract.payment,
            daysRemaining: contract.duration,
            risk: contract.risk || 0,
            settlement: settlement.name,
        };

        return { success: true, contract: player.activeContract };
    },

    /**
     * Update active contract
     */
    updateContract(player) {
        if (!player.activeContract) return null;

        player.activeContract.daysRemaining--;

        if (player.activeContract.daysRemaining <= 0) {
            // Contract complete!
            const contract = player.activeContract;

            // Check for casualties (if risky contract)
            let casualties = 0;
            if (contract.risk > 0 && Math.random() < contract.risk) {
                casualties = Math.ceil(player.army.length * Utils.randFloat(0.1, 0.3));
                for (let i = 0; i < casualties && player.army.length > 0; i++) {
                    player.army.pop();
                }
            } else {
                // Success - gain experience
                for (const unit of player.army) {
                    unit.experience += 10;
                    if (unit.experience >= 100 && unit.level < 5) {
                        unit.level++;
                        unit.experience = 0;
                        unit.strength = Math.floor(unit.strength * 1.2);
                    }
                }
            }

            // Pay player
            player.gold += contract.payment;

            // Increase combat skill
            player.skills.combat = Math.min(10, player.skills.combat + 0.5);

            const result = {
                completed: true,
                contract,
                casualties,
                payment: contract.payment,
            };

            player.activeContract = null;
            return result;
        }

        return { completed: false, daysRemaining: player.activeContract.daysRemaining };
    },

    /**
     * Combat encounter (for random events or player-initiated)
     */
    combat(player, enemyStrength, enemyName = 'Bandits', context = {}) {
        const playerStrength = PlayerMilitary.getArmyStrength(player);

        if (playerStrength === 0 && !context.skipCasualties) {
            return { victory: false, reason: 'No army to fight with!' };
        }

        const terrainId = context.terrainId || null;
        const playerComp = PlayerMilitary.getArmyComposition(player);
        const enemyComp = PlayerMilitary.inferEnemyComposition(enemyStrength, enemyName, context);

        const playerCounterMult = PlayerMilitary._counterMultiplier(playerComp, enemyComp);
        const enemyCounterMult = PlayerMilitary._counterMultiplier(enemyComp, playerComp);
        const playerTerrainMult = PlayerMilitary._terrainMultiplier(terrainId, playerComp);
        const enemyTerrainMult = PlayerMilitary._terrainMultiplier(terrainId, enemyComp);

        const festivalMoraleBonus = (player.festivals?.moraleBoostDays > 0)
            ? (player.festivals?.moraleBoostValue || 0)
            : 0;
        const leadership = (player.skills?.leadership || 1) * 0.015 + festivalMoraleBonus;
        const playerMorale = PlayerMilitary._moraleValue(playerStrength, enemyStrength, leadership);
        const enemyMorale = PlayerMilitary._moraleValue(enemyStrength, playerStrength, context.enemyMoraleBonus || 0);

        // Tactical bonus from BattleUI (1.0 = no change)
        const tacticalBonus = context.tacticalBonus || 1.0;

        // Combat calculation
        let playerPower = playerStrength * Utils.randFloat(0.8, 1.2) * playerCounterMult * playerTerrainMult * playerMorale * tacticalBonus;
        let enemyPower = enemyStrength * Utils.randFloat(0.8, 1.2) * enemyCounterMult * enemyTerrainMult * enemyMorale;

        let moraleBreak = null;
        if (PlayerMilitary._checkMoraleBreak(playerStrength, enemyStrength, playerMorale)) {
            moraleBreak = 'player';
            playerPower *= 0.55;
            enemyPower *= 1.12;
        } else if (PlayerMilitary._checkMoraleBreak(enemyStrength, playerStrength, enemyMorale)) {
            moraleBreak = 'enemy';
            enemyPower *= 0.55;
            playerPower *= 1.12;
        }

        const victory = playerPower > enemyPower;

        // Calculate casualties — skip if already applied by BattleUI
        let casualties = 0;
        if (!context.skipCasualties) {
            let casualtyRate = victory ?
                Utils.randFloat(0.05, 0.15) :
                Utils.randFloat(0.2, 0.4);

            if (moraleBreak === 'enemy' && victory) casualtyRate *= 0.65;
            if (moraleBreak === 'player' && !victory) casualtyRate *= 1.25;

            casualties = Math.ceil(player.army.length * casualtyRate);

            for (let i = 0; i < casualties && player.army.length > 0; i++) {
                player.army.pop();
            }
        }

        // Rewards for victory
        let loot = 0;
        if (victory) {
            loot = Math.floor(enemyStrength * Utils.randFloat(2, 5));
            player.gold += loot;

            // Experience for survivors
            for (const unit of player.army) {
                unit.experience += 5;
                if (unit.experience >= 100 && unit.level < 5) {
                    unit.level++;
                    unit.experience = 0;
                    unit.strength = Math.floor(unit.strength * 1.2);
                }
            }

            // Increase combat skill
            player.skills.combat = Math.min(10, player.skills.combat + 0.3);
            player.renown += Math.floor(enemyStrength / 10);
        } else {
            // Defeat — chance of capture and indentured servitude
            if (player.army.length === 0 && Math.random() < 0.4) {
                // Player is captured! Enter indentured servitude
                const servitudeDays = Utils.randInt(5, 15);
                const captor = enemyName;
                player.indenturedServitude = {
                    captor: captor,
                    daysRemaining: servitudeDays,
                    totalDays: servitudeDays,
                    dailyWage: 0, // Captors take your labor
                    goldConfiscated: Math.min(player.gold, Math.floor(player.gold * 0.3)),
                    canBuyFreedom: true,
                    freedomCost: 200 + Math.floor(enemyStrength * 2),
                    escapeChance: 0.1 + (player.skills.stealth || 0) * 0.03,
                };
                player.gold -= player.indenturedServitude.goldConfiscated;

                return {
                    victory: false,
                    casualties,
                    loot: 0,
                    enemyName,
                    playerStrength,
                    enemyStrength,
                    captured: true,
                    servitudeDays,
                    goldConfiscated: player.indenturedServitude.goldConfiscated,
                };
            }
        }

        return {
            victory,
            casualties,
            loot,
            enemyName,
            playerStrength,
            enemyStrength,
            tactics: {
                terrainId,
                moraleBreak,
                playerMorale: Number(playerMorale.toFixed(2)),
                enemyMorale: Number(enemyMorale.toFixed(2)),
                playerCounterMult: Number(playerCounterMult.toFixed(2)),
                enemyCounterMult: Number(enemyCounterMult.toFixed(2)),
                playerTerrainMult: Number(playerTerrainMult.toFixed(2)),
                enemyTerrainMult: Number(enemyTerrainMult.toFixed(2)),
            },
        };
    },

    /**
     * Process daily indentured servitude
     */
    processServitude(player, world) {
        if (!player.indenturedServitude) return null;

        const servitude = player.indenturedServitude;
        servitude.daysRemaining--;

        // Player can attempt escape each day
        const escaped = false;

        // Captors may force you to work their properties (generate small gold for them)
        // Player earns nothing but may gain skills
        player.skills.commerce = Math.min(10, (player.skills.commerce || 1) + 0.05);
        player.strength = Math.min(20, (player.strength || 5) + 0.1);

        // Movement is locked during servitude
        player.stamina = 0;
        player.movementRemaining = 0;

        if (servitude.daysRemaining <= 0) {
            // Freedom! Servitude period over
            const result = {
                freed: true,
                type: 'served',
                message: `Your period of indentured servitude under ${servitude.captor} has ended. You are free once more.`,
                daysServed: servitude.totalDays,
            };
            player.indenturedServitude = null;
            player.stamina = player.maxStamina;
            player.movementRemaining = player.maxStamina;
            player.karma += 2; // Sympathy karma
            return result;
        }

        return {
            freed: false,
            daysRemaining: servitude.daysRemaining,
            captor: servitude.captor,
            message: `You toil under ${servitude.captor}. ${servitude.daysRemaining} days of servitude remain.`,
        };
    },

    /**
     * Attempt to escape indentured servitude
     */
    attemptEscape(player) {
        if (!player.indenturedServitude) return { success: false, reason: 'Not in servitude' };

        const servitude = player.indenturedServitude;
        const roll = Math.random();

        if (roll < servitude.escapeChance) {
            // Successful escape!
            const result = {
                success: true,
                message: `You slipped away in the night and escaped ${servitude.captor}! You are free, but they may seek revenge.`,
            };
            player.indenturedServitude = null;
            player.stamina = player.maxStamina;
            player.movementRemaining = player.maxStamina;
            player.karma -= 1; // Minor karma hit for breaking contract
            player.skills.stealth = Math.min(10, (player.skills.stealth || 1) + 0.5);
            return result;
        } else {
            // Failed escape — punishment
            servitude.daysRemaining += Utils.randInt(2, 5);
            servitude.escapeChance = Math.max(0.05, servitude.escapeChance - 0.02); // Harder next time
            player.health = Math.max(10, player.health - Utils.randInt(5, 15));
            return {
                success: false,
                message: `Your escape attempt failed! The guards caught you and beat you. +${servitude.daysRemaining - (servitude.totalDays - servitude.daysRemaining)} days added to your sentence.`,
                healthLost: true,
            };
        }
    },

    /**
     * Buy freedom from indentured servitude
     */
    buyFreedom(player) {
        if (!player.indenturedServitude) return { success: false, reason: 'Not in servitude' };
        if (!player.indenturedServitude.canBuyFreedom) return { success: false, reason: 'Captor refuses to negotiate' };

        const cost = player.indenturedServitude.freedomCost;
        if (player.gold < cost) return { success: false, reason: `Need ${cost} gold (have ${player.gold})` };

        player.gold -= cost;
        const captor = player.indenturedServitude.captor;
        player.indenturedServitude = null;
        player.stamina = player.maxStamina;
        player.movementRemaining = player.maxStamina;

        return {
            success: true,
            message: `You paid ${cost} gold to ${captor} for your freedom. You are no longer bound.`,
            cost,
        };
    },

    /**
     * Raid a settlement (aggressive action)
     */
    raidSettlement(player, settlement, tile, world) {
        const playerStrength = PlayerMilitary.getArmyStrength(player);

        if (playerStrength < 30) {
            return { success: false, reason: 'Army too weak to raid (need 30+ strength)' };
        }

        // Settlement defense based on population and type
        const defenseMultiplier = {
            village: 0.5,
            town: 1.0,
            city: 2.0,
            capital: 3.0,
        };

        const defenseStrength = Math.floor(
            settlement.population * 0.02 * (defenseMultiplier[settlement.type] || 1)
        );

        // Combat
        const result = PlayerMilitary.combat(player, defenseStrength, settlement.name, {
            terrainId: tile?.terrain?.id,
            enemyComposition: PlayerMilitary._getSettlementComposition(settlement, tile),
        });

        if (result.victory) {
            // Successful raid
            const plunder = Math.floor(settlement.population * Utils.randFloat(0.5, 2));
            player.gold += plunder;
            result.plunder = plunder;

            // Negative karma and reputation
            player.karma -= 5;
            if (settlement.kingdom) {
                player.reputation[settlement.kingdom] =
                    (player.reputation[settlement.kingdom] || 0) - 20;
            }

            // Reduce settlement population
            settlement.population = Math.floor(settlement.population * 0.9);
        } else {
            // Failed raid - even worse reputation
            if (settlement.kingdom) {
                player.reputation[settlement.kingdom] =
                    (player.reputation[settlement.kingdom] || 0) - 30;
            }
            player.karma -= 3;
        }

        return result;
    },

    /**
     * Attack a settlement to conquer it.
     * Harder than raiding — the entire garrison must be defeated.
     * Pass opts.skipCombat = true when battle was already resolved tactically.
     */
    attackSettlement(player, settlement, tile, world, opts = {}) {
        const playerStrength = PlayerMilitary.getArmyStrength(player);

        if (!opts.skipCombat) {
            if (playerStrength === 0) {
                return { success: false, reason: 'You have no army! Recruit soldiers first.' };
            }

            if (playerStrength < 50) {
                return { success: false, reason: 'Army too weak to siege a settlement (need 50+ strength)' };
            }
        }

        // Settlement defense — stronger than raiding since garrison fights to the last
        const defenseMultiplier = {
            village: 0.8,
            town: 1.5,
            city: 3.0,
            capital: 5.0,
        };

        // Garrison = population-based defense + kingdom military contribution
        let garrisonStrength = Math.floor(
            settlement.population * 0.03 * (defenseMultiplier[settlement.type] || 1)
        );

        // Kingdom military reinforcements (if settlement belongs to a kingdom)
        if (settlement.kingdom) {
            const kingdom = world.getKingdom(settlement.kingdom);
            if (kingdom && kingdom.military > 0) {
                // Capital gets 40% of kingdom military, other settlements get 15%
                const militaryShare = settlement.type === 'capital' ? 0.4 : 0.15;
                garrisonStrength += Math.floor(kingdom.military * militaryShare);
            }
        }

        // Walls bonus for cities and capitals
        if (settlement.type === 'city' || settlement.type === 'capital') {
            garrisonStrength = Math.floor(garrisonStrength * 1.3); // 30% wall bonus
        }

        let result;
        if (opts.skipCombat) {
            // Combat already resolved tactically — treat as victory
            result = { victory: true, casualties: 0, loot: 0, garrisonStrength };
        } else {
            // Combat
            result = PlayerMilitary.combat(player, garrisonStrength, settlement.name, {
                terrainId: tile?.terrain?.id,
                enemyComposition: PlayerMilitary._getSettlementComposition(settlement, tile),
                enemyMoraleBonus: settlement.type === 'capital' ? 0.1 : 0,
            });
            result.garrisonStrength = garrisonStrength;
        }

        const previousKingdom = settlement.kingdom;

        if (result.victory) {
            // --- CONQUEST ---
            result.conquered = true;

            // Plunder gold from the settlement
            const plunder = Math.floor(settlement.population * Utils.randFloat(1, 3));
            player.gold += plunder;
            result.plunder = plunder;

            // Population suffers from the siege
            settlement.population = Math.floor(settlement.population * 0.7);

            // Remove settlement from old kingdom
            if (previousKingdom) {
                const oldKingdom = world.getKingdom(previousKingdom);
                if (oldKingdom) {
                    // Remove from kingdom territory
                    oldKingdom.territory = oldKingdom.territory.filter(t =>
                        t.q !== tile.q || t.r !== tile.r
                    );
                    // Take military losses
                    const militaryLoss = settlement.type === 'capital' ? 0.3 : 0.1;
                    oldKingdom.military = Math.floor(oldKingdom.military * (1 - militaryLoss));
                    // Update population
                    oldKingdom.population = Math.max(0, oldKingdom.population - settlement.population);

                    // Check if this was their capital
                    if (oldKingdom.capital && oldKingdom.capital.q === tile.q && oldKingdom.capital.r === tile.r) {
                        result.capitalCaptured = true;
                        // Try to relocate capital to another settlement
                        const remainingSettlements = [];
                        for (const t of oldKingdom.territory) {
                            const kt = world.getTile(t.q, t.r);
                            if (kt && kt.settlement && kt.settlement.kingdom === previousKingdom) {
                                remainingSettlements.push(t);
                            }
                        }
                        if (remainingSettlements.length > 0) {
                            oldKingdom.capital = remainingSettlements[0];
                        } else {
                            // Kingdom destroyed!
                            oldKingdom.isAlive = false;
                            result.kingdomDestroyed = true;
                        }
                    }
                }
            }

            // Transfer ownership to the player's kingdom, or make independent
            if (player.allegiance) {
                settlement.kingdom = player.allegiance;
                tile.kingdom = player.allegiance;
                const playerKingdom = world.getKingdom(player.allegiance);
                if (playerKingdom) {
                    playerKingdom.territory.push({ q: tile.q, r: tile.r });
                    playerKingdom.population += settlement.population;
                }
                result.newOwner = playerKingdom ? playerKingdom.name : 'your kingdom';
            } else {
                // No allegiance — settlement becomes a player colony
                settlement.kingdom = null;
                tile.kingdom = null;
                if (!settlement.colony) settlement.colony = {};
                settlement.colony.isPlayerColony = true;
                settlement.colony.foundedDay = world.day;
                settlement.colony.loyalty = 30; // Low initial loyalty after conquest
                if (!player.colonies) player.colonies = [];
                player.colonies.push({ q: tile.q, r: tile.r, name: settlement.name, foundedDay: world.day });
                result.newOwner = 'you (independent colony)';
            }

            // Clear market stock (looted)
            settlement.marketStock = {};

            // Massive karma and reputation hit
            player.karma -= 10;
            result.karmaChange = -10;

            // Reputation with ALL kingdoms drops
            for (const k of world.kingdoms) {
                if (!k.isAlive) continue;
                const penalty = k.id === previousKingdom ? -50 : -10;
                player.reputation[k.id] = (player.reputation[k.id] || 0) + penalty;
            }

            // Renown boost
            const renownGain = settlement.type === 'capital' ? 50 :
                               settlement.type === 'city' ? 30 :
                               settlement.type === 'town' ? 15 : 5;
            player.renown += renownGain;
            result.renownChange = renownGain;

            world.events.push({
                text: `⚔️ ${player.name} has conquered ${settlement.name}!`,
                type: 'military'
            });
        } else {
            // --- DEFEAT ---
            result.conquered = false;

            // Reputation hit even for failed attack
            if (previousKingdom) {
                player.reputation[previousKingdom] =
                    (player.reputation[previousKingdom] || 0) - 30;
            }
            player.karma -= 5;
            result.karmaChange = -5;
        }

        return result;
    },

    /**
     * Get the garrison strength of a settlement for display purposes
     */
    getSettlementDefense(settlement, world) {
        const defenseMultiplier = {
            village: 0.8,
            town: 1.5,
            city: 3.0,
            capital: 5.0,
        };

        let garrisonStrength = Math.floor(
            settlement.population * 0.03 * (defenseMultiplier[settlement.type] || 1)
        );

        if (settlement.kingdom) {
            const kingdom = world.getKingdom(settlement.kingdom);
            if (kingdom && kingdom.military > 0) {
                const militaryShare = settlement.type === 'capital' ? 0.4 : 0.15;
                garrisonStrength += Math.floor(kingdom.military * militaryShare);
            }
        }

        if (settlement.type === 'city' || settlement.type === 'capital') {
            garrisonStrength = Math.floor(garrisonStrength * 1.3);
        }

        return garrisonStrength;
    },

    /**
     * Attack a world unit on the player's tile
     */
    attackUnit(player, worldUnit, world) {
        const unitTile = world.getTile(worldUnit.q, worldUnit.r);
        const combatResult = PlayerMilitary.combat(player, worldUnit.strength, worldUnit.name, {
            terrainId: unitTile?.terrain?.id,
            enemyComposition: PlayerMilitary._getWorldUnitComposition(worldUnit),
        });

        // Handle no-army edge case
        if (combatResult.reason) {
            return {
                ...combatResult,
                noArmy: true,
                enemyName: worldUnit.name,
                karmaChange: 0,
                renownChange: 0,
                inventoryLoot: {},
            };
        }

        let karmaChange = 0;
        let renownChange = 0;
        let inventoryLoot = {};

        if (combatResult.victory) {
            // Transfer unit inventory to player
            if (worldUnit.inventory) {
                for (const [item, qty] of Object.entries(worldUnit.inventory)) {
                    if (qty > 0) {
                        if (!player.inventory) player.inventory = {};
                        player.inventory[item] = (player.inventory[item] || 0) + qty;
                        inventoryLoot[item] = qty;
                    }
                }
            }

            // Destroy the unit
            worldUnit.destroyed = true;

            // Karma/reputation effects by unit type
            switch (worldUnit.type) {
                case 'caravan':
                case 'ship':
                case 'fishing_boat':
                    karmaChange = -3;
                    player.karma += karmaChange;
                    break;
                case 'settler':
                    karmaChange = -5;
                    player.karma += karmaChange;
                    break;
                case 'raider':
                case 'pirate':
                    karmaChange = 1;
                    renownChange = Math.floor(worldUnit.strength / 5) + 2;
                    player.karma += karmaChange;
                    player.renown += renownChange;
                    break;
                case 'patrol':
                    karmaChange = -2;
                    player.karma += karmaChange;
                    // Anger the patrol's kingdom
                    if (worldUnit.kingdom) {
                        player.reputation[worldUnit.kingdom] =
                            (player.reputation[worldUnit.kingdom] || 0) - 25;
                    }
                    break;
            }

            // Log event
            if (world.events) {
                world.events.push({
                    text: `${player.name || 'The player'} defeated a ${worldUnit.name}!`,
                    type: 'military'
                });
            }
        } else {
            // Log defeat event
            if (world.events) {
                world.events.push({
                    text: `${player.name || 'The player'} was defeated by a ${worldUnit.name}!`,
                    type: 'military'
                });
            }
        }

        return {
            ...combatResult,
            enemyName: combatResult.enemyName || worldUnit.name,
            karmaChange,
            renownChange,
            inventoryLoot,
        };
    },
};

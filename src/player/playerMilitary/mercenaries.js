// PlayerMilitary — mercenaries members (split from the original monolith).
import { PlayerMilitary } from './_ref.js';
import { Utils, Technology, Quests, Kingdom } from './_imports.js';

Object.assign(PlayerMilitary, {
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
        const shuffled = [...pool].sort(() => Utils.random() - 0.5);
        const offerCount = Math.min(shuffled.length, Math.max(1, 2 + (Utils.random() < 0.35 ? 1 : 0)));

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

        const companyId = `merc_${Date.now()}_${Math.floor(Utils.random() * 999)}`;
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

            if (Utils.random() < switchChance) {
                const unitsRemoved = PlayerMilitary._removeMercenaryCompanyUnits(player, company.id);
                player.mercenaryCompanies.splice(i, 1);

                let rivalName = 'a rival banner';
                if (world && Array.isArray(world.kingdoms)) {
                    const rivals = world.kingdoms.filter(kingdom => kingdom.isAlive && kingdom.id !== player.allegiance);
                    const chosen = rivals.length > 0 ? Utils.randPick(rivals) : null;
                    if (chosen) {
                        rivalName = chosen.name;
                        // The rival can only take on as many as it can feed (militaryCap)
                        const reinforcement = Math.floor(PlayerMilitary._estimateCompanyStrength(company) * 0.45);
                        Kingdom.recruitTroops(chosen, reinforcement);
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
            if (contract.risk > 0 && Utils.random() < contract.risk) {
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

            Quests.trackContractCompleted(player);
            player.activeContract = null;
            return result;
        }

        return { completed: false, daysRemaining: player.activeContract.daysRemaining };
    },
});

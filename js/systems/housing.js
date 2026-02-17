/**
 * Housing System
 * Allows the player (and simulates NPCs) to buy houses in settlements,
 * upgrade them, and gain renown / local influence from ownership.
 */
const Housing = {

    /* ── Data accessors ─────────────────────────────────────── */

    _getHouseTypes() {
        return (typeof DataLoader !== 'undefined' && DataLoader.housing && DataLoader.housing.houseTypes)
            ? DataLoader.housing.houseTypes : [];
    },

    _getUpgrades() {
        return (typeof DataLoader !== 'undefined' && DataLoader.housing && DataLoader.housing.upgrades)
            ? DataLoader.housing.upgrades : [];
    },

    _getInfluenceSettings() {
        return (typeof DataLoader !== 'undefined' && DataLoader.housing && DataLoader.housing.influenceSettings)
            ? DataLoader.housing.influenceSettings : {
                baseInfluencePerHouse: 5, influencePerUpgrade: 2,
                maxInfluenceFromHousing: 50, homeRestBonus: 2, dailyMaintenanceCheck: true
            };
    },

    _getSellPenalty() {
        return (typeof DataLoader !== 'undefined' && DataLoader.housing && DataLoader.housing.sellPenalty != null)
            ? DataLoader.housing.sellPenalty : 0.5;
    },

    _getNpcOwnerTitles() {
        return (typeof DataLoader !== 'undefined' && DataLoader.housing && DataLoader.housing.npcOwnerTitles)
            ? DataLoader.housing.npcOwnerTitles : ['a wealthy merchant'];
    },

    _getNpcHouseChance() {
        return (typeof DataLoader !== 'undefined' && DataLoader.housing && DataLoader.housing.npcHouseChance)
            ? DataLoader.housing.npcHouseChance : { village: 0.05, town: 0.10, capital: 0.20 };
    },

    /* ── House type helpers ──────────────────────────────────── */

    getHouseType(id) {
        return this._getHouseTypes().find(h => h.id === id) || null;
    },

    getUpgrade(id) {
        return this._getUpgrades().find(u => u.id === id) || null;
    },

    /** Houses available for purchase in a settlement of the given type */
    getAvailableHouses(settlementType) {
        return this._getHouseTypes().filter(h => h.availableIn.includes(settlementType));
    },

    /** Upgrades applicable to a given house type that are not already installed */
    getAvailableUpgrades(houseId, installedUpgradeIds) {
        return this._getUpgrades().filter(u =>
            u.requiredHouse.includes(houseId) && !installedUpgradeIds.includes(u.id)
        );
    },

    /* ── Player house queries ────────────────────────────────── */

    /** All houses the player owns: array of { q, r, house } */
    getPlayerHouses(player) {
        return player.houses || [];
    },

    /** House owned at a specific tile, or null */
    getHouseAt(player, q, r) {
        return (player.houses || []).find(h => h.q === q && h.r === r) || null;
    },

    /** Is the player currently at one of their houses? */
    isPlayerHome(player) {
        return !!this.getHouseAt(player, player.q, player.r);
    },

    /* ── Buying a house ──────────────────────────────────────── */

    /**
     * Buy a house in the settlement at (q, r).
     * Returns { success, message } object.
     */
    buyHouse(player, q, r, houseTypeId, world) {
        const houseType = this.getHouseType(houseTypeId);
        if (!houseType) return { success: false, message: 'Unknown house type.' };

        // Already own a house here?
        if (this.getHouseAt(player, q, r)) {
            return { success: false, message: 'You already own property in this settlement.' };
        }

        // Settlement check
        const tile = world.getTile(q, r);
        if (!tile || !tile.settlement) return { success: false, message: 'No settlement here.' };
        if (!houseType.availableIn.includes(tile.settlement.type)) {
            return { success: false, message: `A ${houseType.name} cannot be built in a ${tile.settlement.type}.` };
        }

        // Cost
        const cost = this._getSettlementPrice(houseType.baseCost, tile.settlement);
        if (player.gold < cost) return { success: false, message: `Not enough gold. Need ${cost}g.` };

        // Renown requirement
        if ((player.renown || 0) < houseType.requiredRenown) {
            return { success: false, message: `You need at least ${houseType.requiredRenown} renown.` };
        }

        // Purchase
        player.gold -= cost;
        if (!player.houses) player.houses = [];
        const house = {
            q, r,
            typeId: houseTypeId,
            upgrades: [],
            purchaseDay: world.day || 0,
            condition: 100,         // 0-100
            settlementName: tile.settlement.name,
            kingdomId: tile.kingdom || null,
        };
        player.houses.push(house);

        // Track in finances
        if (player.financeToday) {
            player.financeToday.expenses.housing = (player.financeToday.expenses.housing || 0) + cost;
        }

        // Immediate renown + reputation boost
        player.renown = (player.renown || 0) + houseType.renownBonus;
        if (house.kingdomId) {
            player.reputation[house.kingdomId] = (player.reputation[house.kingdomId] || 0) + houseType.reputationBonus;
        }

        return { success: true, message: `Purchased a ${houseType.name} in ${tile.settlement.name} for ${cost}g!`, cost };
    },

    /* ── Selling a house ─────────────────────────────────────── */

    sellHouse(player, q, r) {
        const idx = (player.houses || []).findIndex(h => h.q === q && h.r === r);
        if (idx === -1) return { success: false, message: 'You do not own a house here.' };

        const house = player.houses[idx];
        const houseType = this.getHouseType(house.typeId);
        const baseValue = houseType ? houseType.baseCost : 100;
        const upgradeValue = house.upgrades.reduce((sum, uid) => {
            const u = this.getUpgrade(uid);
            return sum + (u ? u.cost : 0);
        }, 0);
        const penalty = this._getSellPenalty();
        const salePrice = Math.floor((baseValue + upgradeValue) * penalty * (house.condition / 100));

        player.gold += salePrice;
        player.houses.splice(idx, 1);

        // Small renown/rep loss
        if (houseType) {
            player.renown = Math.max(0, (player.renown || 0) - Math.floor(houseType.renownBonus / 2));
        }

        if (player.financeToday) {
            player.financeToday.income.houseSale = (player.financeToday.income.houseSale || 0) + salePrice;
        }

        return { success: true, message: `Sold your ${houseType ? houseType.name : 'house'} for ${salePrice}g.`, salePrice };
    },

    /* ── Upgrading a house ───────────────────────────────────── */

    /**
     * Install an upgrade on the player's house at (q, r).
     */
    installUpgrade(player, q, r, upgradeId) {
        const house = this.getHouseAt(player, q, r);
        if (!house) return { success: false, message: 'You do not own a house here.' };

        const houseType = this.getHouseType(house.typeId);
        if (!houseType) return { success: false, message: 'Invalid house type.' };

        const upgrade = this.getUpgrade(upgradeId);
        if (!upgrade) return { success: false, message: 'Unknown upgrade.' };

        if (!upgrade.requiredHouse.includes(house.typeId)) {
            return { success: false, message: `This upgrade is not available for a ${houseType.name}.` };
        }
        if (house.upgrades.includes(upgradeId)) {
            return { success: false, message: 'Already installed.' };
        }
        if (house.upgrades.length >= houseType.maxUpgradeSlots) {
            return { success: false, message: `No upgrade slots remaining (${houseType.maxUpgradeSlots} max).` };
        }
        if (player.gold < upgrade.cost) {
            return { success: false, message: `Not enough gold. Need ${upgrade.cost}g.` };
        }

        player.gold -= upgrade.cost;
        house.upgrades.push(upgradeId);

        if (player.financeToday) {
            player.financeToday.expenses.housing = (player.financeToday.expenses.housing || 0) + upgrade.cost;
        }

        // Apply one-time renown/reputation from upgrade
        const effects = upgrade.effects || {};
        if (effects.renownBonus) player.renown = (player.renown || 0) + effects.renownBonus;
        if (effects.reputationBonus && house.kingdomId) {
            player.reputation[house.kingdomId] = (player.reputation[house.kingdomId] || 0) + effects.reputationBonus;
        }

        return { success: true, message: `Installed ${upgrade.name} in your ${houseType.name}!` };
    },

    /* ── Aggregate bonuses ───────────────────────────────────── */

    /**
     * Compute the total ongoing bonuses from all of the player's houses + upgrades.
     * Called during rest / endDay / stat checks.
     */
    getTotalBonuses(player) {
        const bonuses = {
            renown: 0, reputation: {},    // per-kingdom
            stamina: 0, healthRegen: 0,
            strength: 0, charisma: 0, intelligence: 0, faith: 0,
            commerce: 0, combat: 0, leadership: 0, diplomacy: 0,
            movement: 0, visibility: 0, defense: 0,
            karmaPerDay: 0, maintenanceReduction: 0,
        };

        for (const house of (player.houses || [])) {
            const ht = this.getHouseType(house.typeId);
            if (!ht) continue;

            // Base house bonuses (already given once on purchase for renown/rep, but stamina/health are ongoing)
            bonuses.stamina += ht.staminaBonus || 0;
            bonuses.healthRegen += ht.healthRegenBonus || 0;

            // Upgrade bonuses
            for (const uid of house.upgrades) {
                const u = this.getUpgrade(uid);
                if (!u || !u.effects) continue;
                const e = u.effects;
                if (e.healthRegenBonus) bonuses.healthRegen += e.healthRegenBonus;
                if (e.strengthBonus)    bonuses.strength += e.strengthBonus;
                if (e.charismaBonus)    bonuses.charisma += e.charismaBonus;
                if (e.intelligenceBonus) bonuses.intelligence += e.intelligenceBonus;
                if (e.faithBonus)       bonuses.faith += e.faithBonus;
                if (e.commerceSkillBonus) bonuses.commerce += e.commerceSkillBonus;
                if (e.combatSkillBonus)   bonuses.combat += e.combatSkillBonus;
                if (e.leadershipSkillBonus) bonuses.leadership += e.leadershipSkillBonus;
                if (e.diplomacySkillBonus)  bonuses.diplomacy += e.diplomacySkillBonus;
                if (e.movementBonus)    bonuses.movement += e.movementBonus;
                if (e.visibilityBonus)  bonuses.visibility += e.visibilityBonus;
                if (e.defenseBonus)     bonuses.defense += e.defenseBonus;
                if (e.karmaPerDay)      bonuses.karmaPerDay += e.karmaPerDay;
                if (e.maintenanceReduction) bonuses.maintenanceReduction += e.maintenanceReduction;
                if (e.renownBonus)      bonuses.renown += e.renownBonus;
                if (e.reputationBonus && house.kingdomId) {
                    bonuses.reputation[house.kingdomId] = (bonuses.reputation[house.kingdomId] || 0) + e.reputationBonus;
                }
            }
        }

        return bonuses;
    },

    /**
     * Calculate the player's total housing influence score.
     */
    getInfluence(player) {
        const settings = this._getInfluenceSettings();
        let influence = 0;
        for (const house of (player.houses || [])) {
            const ht = this.getHouseType(house.typeId);
            if (!ht) continue;
            influence += settings.baseInfluencePerHouse;
            influence += house.upgrades.length * settings.influencePerUpgrade;
        }
        return Math.min(influence, settings.maxInfluenceFromHousing);
    },

    /* ── Daily processing ────────────────────────────────────── */

    /**
     * Called every day from game.endDay().
     * Handles maintenance costs, condition decay, home-rest bonuses, karma, NPC sim.
     */
    processDaily(player, world) {
        const houses = player.houses || [];
        if (houses.length === 0) return;

        let totalMaintenance = 0;
        const bonuses = this.getTotalBonuses(player);

        for (const house of houses) {
            const ht = this.getHouseType(house.typeId);
            if (!ht) continue;

            // Maintenance (reduced by servants' quarters)
            let maint = ht.maintenanceCost;
            if (bonuses.maintenanceReduction > 0) {
                maint = Math.max(1, Math.floor(maint * (1 - bonuses.maintenanceReduction)));
            }
            totalMaintenance += maint;

            // Condition degrades slowly (1% every 30 days, approx)
            if (Math.random() < 0.033) {
                house.condition = Math.max(10, house.condition - 1);
            }
        }

        // Deduct maintenance
        if (totalMaintenance > 0) {
            player.gold -= totalMaintenance;
            if (player.financeToday) {
                player.financeToday.expenses.housing = (player.financeToday.expenses.housing || 0) + totalMaintenance;
            }
        }

        // Karma from chapel
        if (bonuses.karmaPerDay > 0) {
            player.karma = (player.karma || 0) + bonuses.karmaPerDay;
        }

        // If resting at home, bonus stamina & health
        if (this.isPlayerHome(player)) {
            const settings = this._getInfluenceSettings();
            player.health = Math.min(player.maxHealth, player.health + bonuses.healthRegen);
            // Extra stamina applied at rest-time via getHomeStaminaBonus
        }
    },

    /**
     * Extra stamina the player receives when resting at a house they own.
     * Called by ActionMenu rest / player.endDay helpers.
     */
    getHomeStaminaBonus(player) {
        if (!this.isPlayerHome(player)) return 0;
        const bonuses = this.getTotalBonuses(player);
        return bonuses.stamina + (this._getInfluenceSettings().homeRestBonus || 0);
    },

    /* ── NPC house simulation ────────────────────────────────── */

    /**
     * Generate simulated NPC-owned houses for a settlement tile.
     * Creates them lazily & caches on tile.npcHouses.
     */
    getNpcHouses(tile) {
        if (!tile || !tile.settlement) return [];
        if (tile._npcHouses) return tile._npcHouses;

        const chances = this._getNpcHouseChance();
        const titles = this._getNpcOwnerTitles();
        const types = this.getAvailableHouses(tile.settlement.type);
        const npcHouses = [];

        // Larger settlements → more NPC homeowners
        const maxNpc = tile.settlement.type === 'capital' ? 8 :
                       tile.settlement.type === 'town' ? 4 : 2;

        for (let i = 0; i < maxNpc; i++) {
            const chance = chances[tile.settlement.type] || 0.05;
            if (Math.random() < chance * 3) { // higher chance so settlements feel lived-in
                const ht = types[Math.floor(Math.random() * types.length)];
                if (!ht) continue;
                const numUpgrades = Math.floor(Math.random() * (ht.maxUpgradeSlots + 1));
                npcHouses.push({
                    owner: titles[Math.floor(Math.random() * titles.length)],
                    typeId: ht.id,
                    upgrades: numUpgrades,
                });
            }
        }

        tile._npcHouses = npcHouses;
        return npcHouses;
    },

    /* ── Repair ──────────────────────────────────────────────── */

    /**
     * Repair a house back to 100% condition.
     * Cost = baseCost * 0.1 * (100 - condition)/100
     */
    repairHouse(player, q, r) {
        const house = this.getHouseAt(player, q, r);
        if (!house) return { success: false, message: 'No house to repair.' };
        if (house.condition >= 100) return { success: false, message: 'House is in perfect condition.' };

        const ht = this.getHouseType(house.typeId);
        const baseCost = ht ? ht.baseCost : 200;
        const damagePercent = (100 - house.condition) / 100;
        const repairCost = Math.max(5, Math.floor(baseCost * 0.1 * damagePercent));

        if (player.gold < repairCost) {
            return { success: false, message: `Not enough gold. Repairs cost ${repairCost}g.` };
        }

        player.gold -= repairCost;
        house.condition = 100;

        if (player.financeToday) {
            player.financeToday.expenses.housing = (player.financeToday.expenses.housing || 0) + repairCost;
        }

        return { success: true, message: `Repaired your ${ht ? ht.name : 'house'} for ${repairCost}g.`, repairCost };
    },

    /* ── Price helpers ───────────────────────────────────────── */

    /** Settlement type multiplier on base cost */
    _getSettlementPrice(baseCost, settlement) {
        const multipliers = { village: 0.8, town: 1.0, capital: 1.4 };
        const m = multipliers[settlement.type] || 1.0;
        return Math.floor(baseCost * m);
    },

    /** Total value of a house (for display) */
    getHouseValue(house) {
        const ht = this.getHouseType(house.typeId);
        const base = ht ? ht.baseCost : 100;
        const upgradeVal = house.upgrades.reduce((s, uid) => {
            const u = this.getUpgrade(uid);
            return s + (u ? u.cost : 0);
        }, 0);
        return Math.floor((base + upgradeVal) * (house.condition / 100));
    },

    /* ── Save / Load helpers ─────────────────────────────────── */

    /** Prepare player data for serialization (no-op since houses are on player) */
    prepareForSave(player) {
        // houses[] is already a plain serialisable array on the player object.
        // Nothing special needed. NPC houses (_npcHouses) are transient and regenerated.
    },
};

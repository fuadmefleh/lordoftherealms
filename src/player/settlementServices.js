// ============================================
// SETTLEMENT SERVICES — what town buildings do for the player
// ============================================
// The blacksmith, temple, stable, guard tower and town hall each sell a
// service with a lasting effect. Timed effects live in `player.blessings`
// ({ key: daysRemaining }), which is already serialized and counted down
// daily by PlayerReligion.updateBlessings; the readers (army strength,
// daily movement) look them up through the helpers at the bottom.

import { Utils } from '../core/utils.js';
import { PlayerEffects } from './playerEffects.js';

/** Price multiplier by settlement size — bigger towns charge more. */
const SIZE_PRICE = { village: 0.85, town: 1.0, city: 1.15, capital: 1.3 };

export const SERVICE_CONFIG = {
    honedArms:  { key: 'honed_arms', days: 7, strengthBonus: 0.15, costPerUnit: 8, minCost: 25 },
    blessing:   { key: 'temple_blessing', days: 5, movementBonus: 2, healthRegen: 5, cost: 30 },
    mount:      { price: 160, movementBonus: 3, saddleCost: 25, resaleRate: 0.5, tamedHorseSale: 70 },
    fines:      { perOffense: 50, reputationGain: 3 },
    tribute:    { tiers: [50, 150, 400], goldPerReputation: 25, maxReputation: 100 },
};

function _priceFactor(settlement) {
    return (settlement && SIZE_PRICE[settlement.type]) || 1.0;
}

function _spend(player, amount, category) {
    player.gold -= amount;
    if (player.financeToday) {
        player.financeToday.expenses = player.financeToday.expenses || {};
        player.financeToday.expenses[category] = (player.financeToday.expenses[category] || 0) + amount;
    }
}

function _earn(player, amount, category) {
    player.gold += amount;
    if (player.financeToday) {
        player.financeToday.income = player.financeToday.income || {};
        player.financeToday.income[category] = (player.financeToday.income[category] || 0) + amount;
    }
}

function _grantBlessing(player, key, days) {
    player.blessings = player.blessings || {};
    // Re-buying extends to the full duration; it never stacks past it.
    player.blessings[key] = Math.max(player.blessings[key] || 0, days);
}

export const SettlementServices = {
    // ──────────── BLACKSMITH ────────────

    /** Cost to hone the army's weapons at this settlement. */
    honeArmsCost(player, settlement) {
        const cfg = SERVICE_CONFIG.honedArms;
        const units = (player.army || []).length;
        return Math.round(Math.max(cfg.minCost, units * cfg.costPerUnit) * _priceFactor(settlement));
    },

    /** Sharpen blades and mend armour: +15% army strength for a week. */
    honeArms(player, settlement) {
        const cfg = SERVICE_CONFIG.honedArms;
        if (!player.army || player.army.length === 0) {
            return { success: false, reason: 'You have no soldiers whose arms need tending.' };
        }
        const cost = this.honeArmsCost(player, settlement);
        if (player.gold < cost) return { success: false, reason: `The smith wants ${cost} gold.` };
        _spend(player, cost, 'smithing');
        _grantBlessing(player, cfg.key, cfg.days);
        return {
            success: true, cost, days: cfg.days,
            message: `The smith hones your company's arms. Army strength +${Math.round(cfg.strengthBonus * 100)}% for ${cfg.days} days.`,
        };
    },

    // ──────────── TEMPLE ────────────

    blessingCost(settlement) {
        return Math.round(SERVICE_CONFIG.blessing.cost * _priceFactor(settlement));
    },

    /** A priest's blessing for the road: extra movement and healing for five days. */
    seekBlessing(player, settlement) {
        const cfg = SERVICE_CONFIG.blessing;
        const cost = this.blessingCost(settlement);
        if (player.gold < cost) return { success: false, reason: `The customary offering is ${cost} gold.` };
        _spend(player, cost, 'offerings');
        _grantBlessing(player, cfg.key, cfg.days);
        player.karma = (player.karma || 0) + 1;
        return {
            success: true, cost, days: cfg.days,
            message: `The priest blesses your journey: +${cfg.movementBonus} movement and +${cfg.healthRegen} healing each day for ${cfg.days} days. +1 karma.`,
        };
    },

    // ──────────── STABLE ────────────

    mountPrice(settlement) {
        return Math.round(SERVICE_CONFIG.mount.price * _priceFactor(settlement));
    },

    /** Buy a riding horse. One mount at a time; it adds daily movement. */
    buyMount(player, settlement, day) {
        if (player.mount) return { success: false, reason: `You already ride ${player.mount.name}.` };
        const price = this.mountPrice(settlement);
        if (player.gold < price) return { success: false, reason: `A riding horse costs ${price} gold.` };
        _spend(player, price, 'horses');
        player.mount = { name: this._horseName(), price, acquiredDay: day || 0 };
        return {
            success: true, cost: price,
            message: `You buy ${player.mount.name}, a sturdy riding horse. +${SERVICE_CONFIG.mount.movementBonus} movement each day.`,
        };
    },

    /** Saddle one of your tamed horses as your mount, for the cost of tack. */
    saddleTamedHorse(player, day) {
        const cfg = SERVICE_CONFIG.mount;
        if (player.mount) return { success: false, reason: `You already ride ${player.mount.name}.` };
        if (!player.inventory || (player.inventory.horse || 0) < 1) {
            return { success: false, reason: 'You have no tamed horse to saddle.' };
        }
        if (player.gold < cfg.saddleCost) return { success: false, reason: `Saddle and tack cost ${cfg.saddleCost} gold.` };
        _spend(player, cfg.saddleCost, 'horses');
        player.inventory.horse -= 1;
        if (player.inventory.horse <= 0) delete player.inventory.horse;
        player.mount = { name: this._horseName(), price: cfg.price, acquiredDay: day || 0 };
        return {
            success: true, cost: cfg.saddleCost,
            message: `The stablehands saddle your tamed horse. You name it ${player.mount.name}. +${cfg.movementBonus} movement each day.`,
        };
    },

    /** Sell your mount back to the stable at half what it cost. */
    sellMount(player) {
        if (!player.mount) return { success: false, reason: 'You have no horse to sell.' };
        const value = Math.round((player.mount.price || SERVICE_CONFIG.mount.price) * SERVICE_CONFIG.mount.resaleRate);
        const name = player.mount.name;
        player.mount = null;
        _earn(player, value, 'horses');
        return { success: true, gold: value, message: `You sell ${name} for ${value} gold.` };
    },

    /** Sell tamed horses from your inventory to the stable. */
    sellTamedHorses(player) {
        const count = (player.inventory && player.inventory.horse) || 0;
        if (count < 1) return { success: false, reason: 'You have no tamed horses to sell.' };
        const value = count * SERVICE_CONFIG.mount.tamedHorseSale;
        delete player.inventory.horse;
        _earn(player, value, 'horses');
        return { success: true, gold: value, count, message: `You sell ${count} tamed horse${count > 1 ? 's' : ''} for ${value} gold.` };
    },

    _horseName() {
        const names = ['Bramble', 'Ashfoot', 'Thistle', 'Copper', 'Duskmane', 'Wren', 'Old Barley', 'Storm', 'Hazel', 'Ember', 'Pike', 'Clover'];
        return names[Utils.randInt(0, names.length - 1)];
    },

    // ──────────── GUARD TOWER ────────────

    offenseCount(player) {
        const rec = player.criminalRecord || {};
        return Object.values(rec).reduce((sum, n) => sum + (Number(n) || 0), 0);
    },

    fineAmount(player, settlement) {
        return Math.round(this.offenseCount(player) * SERVICE_CONFIG.fines.perOffense * _priceFactor(settlement));
    },

    /** Settle every outstanding fine: clears the criminal record and mends standing. */
    payFines(player, settlement) {
        const offenses = this.offenseCount(player);
        if (offenses === 0) return { success: false, reason: 'Your record is clean. The guards have nothing against you.' };
        const fine = this.fineAmount(player, settlement);
        if (player.gold < fine) return { success: false, reason: `Your fines come to ${fine} gold.` };
        _spend(player, fine, 'fines');
        player.criminalRecord = {};
        const kingdomId = settlement && settlement.kingdom;
        if (kingdomId && player.reputation) {
            player.reputation[kingdomId] = Math.min(100, (player.reputation[kingdomId] || 0)
                + PlayerEffects.scaleReputationGain(player, SERVICE_CONFIG.fines.reputationGain));
        }
        return {
            success: true, cost: fine, offenses,
            message: `You pay ${fine} gold to settle ${offenses} offense${offenses > 1 ? 's' : ''}. Your record is wiped clean.`,
        };
    },

    // ──────────── TOWN HALL ────────────

    /** Pay tribute to the local crown in exchange for standing (1 rep per 25 gold). */
    payTribute(player, settlement, amount) {
        const cfg = SERVICE_CONFIG.tribute;
        const kingdomId = settlement && settlement.kingdom;
        if (!kingdomId) return { success: false, reason: 'No crown rules here to receive tribute.' };
        if (!(amount > 0)) return { success: false, reason: 'Choose an amount.' };
        if (player.gold < amount) return { success: false, reason: `You don't have ${amount} gold.` };
        player.reputation = player.reputation || {};
        const before = player.reputation[kingdomId] || 0;
        if (before >= cfg.maxReputation) return { success: false, reason: 'The crown already holds you in the highest regard.' };
        _spend(player, amount, 'tribute');
        const gain = PlayerEffects.scaleReputationGain(player, Math.max(1, Math.floor(amount / cfg.goldPerReputation)));
        player.reputation[kingdomId] = Math.min(cfg.maxReputation, before + gain);
        return {
            success: true, cost: amount, reputationGain: player.reputation[kingdomId] - before,
            message: `You pay ${amount} gold in tribute. Reputation +${player.reputation[kingdomId] - before}.`,
        };
    },

    // ──────────── EFFECT READERS ────────────

    /** Multiplier on army strength from honed arms. */
    armyStrengthMultiplier(player) {
        return (player.blessings && player.blessings[SERVICE_CONFIG.honedArms.key] > 0)
            ? 1 + SERVICE_CONFIG.honedArms.strengthBonus
            : 1;
    },

    /** Extra movement per day from a mount and a temple blessing. */
    movementBonus(player) {
        let bonus = 0;
        if (player.mount) bonus += SERVICE_CONFIG.mount.movementBonus;
        if (player.blessings && player.blessings[SERVICE_CONFIG.blessing.key] > 0) bonus += SERVICE_CONFIG.blessing.movementBonus;
        return bonus;
    },

    /** Extra daily healing from a temple blessing. */
    healthRegenBonus(player) {
        return (player.blessings && player.blessings[SERVICE_CONFIG.blessing.key] > 0)
            ? SERVICE_CONFIG.blessing.healthRegen
            : 0;
    },
};

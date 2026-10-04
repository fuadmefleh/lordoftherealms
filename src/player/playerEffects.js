// ============================================
// PLAYER EFFECTS — modifiers other systems promise the player
// ============================================
// Several systems grant effects that used to be written but never read:
// miracle blessings, House Steward income, lord trade agreements, office
// perks and crafted armour. This module is the single place that turns that
// state into numbers; combat, trading, property income and recruitment ask
// it instead of reading the raw state themselves.

import { Titles } from '../systems/titles.js';
import { House } from '../systems/house.js';
import { Relationships } from '../systems/relationships.js';

/** Personal damage reduction from gear in the inventory (multiplicative). */
const ARMOR_REDUCTION = { leather_armor: 0.2, shield: 0.15, amulet: 0.1 };

/** Better buy/sell prices in a kingdom the player has a trade agreement with. */
const TRADE_AGREEMENT_BONUS = 0.10;

/**
 * What a travel-party companion brings, by occupation: battle power, better
 * prices, diplomacy points, or daily healing on the road.
 */
const COMPANION_ROLES = {
    general:    { power: 0.12, text: '+12% battle power' },
    knight:     { power: 0.10, text: '+10% battle power' },
    guard:      { power: 0.06, text: '+6% battle power' },
    hunter:     { power: 0.05, heal: 1, text: '+5% battle power, forages' },
    spymaster:  { power: 0.04, diplomacy: 0.5, text: 'scouts ahead, whispers to envoys' },
    merchant:   { trade: 0.05, text: '+5% trade prices' },
    artisan:    { trade: 0.03, text: '+3% trade prices' },
    weaver:     { trade: 0.03, text: '+3% trade prices' },
    miller:     { trade: 0.02, heal: 1, text: '+2% trade prices, feeds the camp' },
    baker:      { trade: 0.02, heal: 1, text: '+2% trade prices, feeds the camp' },
    diplomat:   { diplomacy: 1.5, text: '+1.5 diplomacy' },
    noble:      { diplomacy: 1, text: '+1 diplomacy' },
    scholar:    { diplomacy: 0.5, text: '+0.5 diplomacy' },
    healer:     { heal: 5, text: 'heals 5 health a day' },
    herbalist:  { heal: 3, text: 'heals 3 health a day' },
    priest:     { heal: 2, diplomacy: 0.5, text: 'heals 2 a day, +0.5 diplomacy' },
};
const DEFAULT_COMPANION_ROLE = { heal: 1, text: 'keeps camp (heals 1 a day)' };

function _perk(player, key) {
    const title = Titles.getActiveTitle(player);
    return (title && title.perks && title.perks[key]) || 0;
}

export const PlayerEffects = {
    // ──────────── DIVINE BLESSINGS (miracles) ────────────

    /** "Divine Protection": the player and their army take no harm. */
    isProtected(player) {
        return !!(player.blessings && player.blessings.protection > 0);
    },

    // ──────────── INCOME ────────────

    /** Multiplier on daily property income: Prosperity miracle × House Steward. */
    propertyIncomeMultiplier(player) {
        let mult = 1;
        if (player.blessings && player.blessings.prosperity > 0) mult *= 2;
        if (player.house) {
            const steward = House.getRoleBonuses(player).propertyIncomeMult;
            if (steward) mult *= steward;
        }
        return mult;
    },

    /** "Bountiful Harvest" miracle: farms produce triple. */
    farmProductionMultiplier(player) {
        return (player.blessings && player.blessings.harvest > 0) ? 3 : 1;
    },

    // ──────────── COMPANIONS ────────────

    /** The role a companion fills in the travel party. */
    companionRole(npc) {
        return (npc && COMPANION_ROLES[npc.occupation]) || DEFAULT_COMPANION_ROLE;
    },

    /** Sum of one companion bonus (`power`, `trade`, `diplomacy`, `heal`) across the party. */
    companionBonus(player, key) {
        if (!Array.isArray(player.travelParty) || player.travelParty.length === 0) return 0;
        let total = 0;
        for (const npc of Relationships.getTravelPartyMembers(player)) {
            total += this.companionRole(npc)[key] || 0;
        }
        return total;
    },

    /**
     * A day on the road together: companions patch the player up and the bond
     * deepens. Returns { healed, members }.
     */
    processCompanions(player, world) {
        const members = Array.isArray(player.travelParty) ? Relationships.getTravelPartyMembers(player) : [];
        if (!members.length) return { healed: 0, members: 0 };
        const heal = this.companionBonus(player, 'heal');
        const maxHp = player.maxHealth || 100;
        const before = player.health || 0;
        player.health = Math.min(maxHp, before + heal);
        for (const npc of members) {
            const rel = Relationships.getRelationship(player, npc.id);
            if (rel) rel.score = Math.min(100, (rel.score || 0) + 1);
            npc.lastInteraction = (world && world.day) || npc.lastInteraction || 0;
        }
        return { healed: player.health - before, members: members.length };
    },

    // ──────────── DIPLOMACY ────────────

    /** Diplomacy skill plus a House Chancellor's bonus and diplomatic companions. */
    effectiveDiplomacy(player) {
        let value = (player.skills && player.skills.diplomacy) || 0;
        if (player.house) value += House.getRoleBonuses(player).diplomacyBonus || 0;
        value += this.companionBonus(player, 'diplomacy');
        return value;
    },

    /** Multiplier on reputation you earn: +5% per point of effective diplomacy. */
    reputationGainMultiplier(player) {
        return 1 + 0.05 * this.effectiveDiplomacy(player);
    },

    /** Scale a positive reputation gain by diplomacy (losses are untouched). */
    scaleReputationGain(player, gain) {
        return gain > 0 ? Math.round(gain * this.reputationGainMultiplier(player)) : gain;
    },

    /** Added chance when negotiating with a lord: +2% per point of effective diplomacy. */
    negotiationBonus(player) {
        return 0.02 * this.effectiveDiplomacy(player);
    },

    // ──────────── TRADE ────────────

    /** Fractional price advantage when trading at `settlement`. */
    tradeBonus(player, settlement) {
        let bonus = _perk(player, 'tradeBonus') + this.companionBonus(player, 'trade');
        const kingdomId = settlement && settlement.kingdom;
        if (kingdomId && player.tradeAgreements && player.tradeAgreements[kingdomId]) {
            bonus += TRADE_AGREEMENT_BONUS;
        }
        return bonus;
    },

    /** Drop trade agreements whose term has run out. Returns the expired kingdom names. */
    expireTradeAgreements(player, day) {
        const expired = [];
        if (!player.tradeAgreements) return expired;
        for (const [kingdomId, agreement] of Object.entries(player.tradeAgreements)) {
            if (!agreement || agreement.expires <= day) {
                expired.push((agreement && agreement.kingdom) || kingdomId);
                delete player.tradeAgreements[kingdomId];
            }
        }
        return expired;
    },

    // ──────────── MILITARY ────────────

    /** Multiplier on recruitment cost (the Marshal's "militaryDiscount"). */
    recruitCostMultiplier(player) {
        return Math.max(0.5, 1 - _perk(player, 'militaryDiscount'));
    },

    /** Multiplier on battle casualties: none under Divine Protection. */
    casualtyMultiplier(player) {
        return this.isProtected(player) ? 0 : 1;
    },

    /** Multiplier on health the player personally loses (protection, then armour). */
    personalDamageMultiplier(player) {
        if (this.isProtected(player)) return 0;
        let mult = 1;
        const inv = player.inventory || {};
        for (const [item, reduction] of Object.entries(ARMOR_REDUCTION)) {
            if (inv[item] > 0) mult *= 1 - reduction;
        }
        return mult;
    },

    /** Scale a raw personal damage roll; protection blocks it entirely. */
    scaleDamage(player, raw) {
        const mult = this.personalDamageMultiplier(player);
        return mult === 0 ? 0 : Math.max(1, Math.round(raw * mult));
    },
};

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
import { Technology } from '../systems/technology.js';
import { LegendaryArtifacts } from '../systems/legendaryArtifacts.js';
import { Peoples } from '../systems/peoples.js';
import { Housing } from '../systems/housing.js';
import { Treasures } from './treasures.js';
import { Religion } from '../systems/religion.js';
import { Traits } from '../systems/traits.js';
import { Companions } from '../systems/companions.js';
import { Underworld } from '../systems/underworld.js';
import { Ailments } from '../systems/ailments.js';

/** Tenet effect of the player's own religion (0 without one). */
function _tenet(player, key) {
    return Religion.tenetBonus(player && player.religion, key);
}

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
/** Merchants of a realm at war with your liege gouge you; your liege's allies deal kindly. */
const LIEGE_TRADE = { enemy: -0.15, ally: 0.05 };

const DEFAULT_COMPANION_ROLE = { heal: 1, text: 'keeps camp (heals 1 a day)' };
/** Battle power / personal damage per point of mood combat modifier. */
const MOOD_COMBAT_PER_POINT = 0.05;
/** Trade price advantage per point of mood charisma. */
const MOOD_TRADE_PER_POINT = 0.03;
/** Reputation-gain multiplier per point of the mood's `reputationGain`. */
const MOOD_REPUTATION_PER_POINT = 0.2;

function _perk(player, key) {
    const title = Titles.getActiveTitle(player);
    return (title && title.perks && title.perks[key]) || 0;
}

export const PlayerEffects = {
    // ──────────── LEGENDARY ARTIFACTS ────────────

    /** A reforged relic's lasting effect (see LegendaryArtifacts.getPassiveTotal). */
    artifactBonus(player, key) {
        return LegendaryArtifacts.getPassiveTotal(player, key);
    },

    // ──────────── CARRIED TREASURES (legendary loot) ────────────

    /** A carried treasure's bonus: battlePower, damageReduction or negotiation. */
    treasureBonus(player, key) {
        return Treasures.equipTotal(player, key);
    },

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
        // Ledger of the Coin-Kings
        mult *= 1 + this.artifactBonus(player, 'propertyIncome');
        // Prosperity tenet
        mult *= 1 + _tenet(player, 'propertyIncome');
        return mult;
    },

    /** "Bountiful Harvest" miracle: farms produce triple; Nature tenet +15%. */
    farmProductionMultiplier(player) {
        const harvest = (player.blessings && player.blessings.harvest > 0) ? 3 : 1;
        return harvest * (1 + _tenet(player, 'farmYield'));
    },

    // ──────────── THE PLAYER'S FAITH ────────────

    /** Battle power multiplier from the faith's tenets (Valor). */
    faithBattleMultiplier(player) {
        return 1 + _tenet(player, 'battlePower');
    },

    /** Army upkeep multiplier from the faith's tenets (Humility). */
    faithUpkeepMultiplier(player) {
        return Math.max(0.5, 1 + _tenet(player, 'upkeep'));
    },

    /**
     * Better prices in a town devoted to the player's faith (the faithful
     * deal kindly with their prophet).
     */
    faithTradeBonus(player, settlement) {
        if (!player || !player.religion || !settlement) return 0;
        // Live settlement objects don't carry coordinates; the player trades where they stand
        const q = settlement.q != null ? settlement.q : player.q;
        const r = settlement.r != null ? settlement.r : player.r;
        if (q == null || r == null) return 0;
        return Religion.isDevoted(player.religion, q, r) ? Religion.PLAYER_INFLUENCE.devotedTradeBonus : 0;
    },

    // ──────────── COMPANIONS ────────────

    /** The role a companion fills in the travel party. */
    companionRole(npc) {
        return (npc && COMPANION_ROLES[npc.occupation]) || DEFAULT_COMPANION_ROLE;
    },

    /**
     * Sum of one companion bonus (`power`, `trade`, `diplomacy`, `heal`) across
     * the party — each role scaled by the companion's mood and bonds
     * (Companions.effectiveness), plus a devoted companion's perk.
     */
    companionBonus(player, key) {
        if (!Array.isArray(player.travelParty) || player.travelParty.length === 0) return 0;
        let total = 0;
        for (const npc of Relationships.getTravelPartyMembers(player)) {
            total += (this.companionRole(npc)[key] || 0) * Companions.effectiveness(player, npc)
                + Companions.perkBonus(npc, key);
        }
        return total;
    },

    /**
     * A day on the road together: companions patch the player up and the bond
     * deepens. Returns { healed, members }.
     */
    processCompanions(player, world) {
        // Approval, wages, bonds, personal quests, desertion (systems/companions.js)
        const life = Companions.processDay(player, world);
        const members = Array.isArray(player.travelParty) ? Relationships.getTravelPartyMembers(player) : [];
        if (!members.length) return { healed: 0, members: 0, life };
        const heal = this.companionBonus(player, 'heal');
        const maxHp = player.maxHealth || 100;
        const before = player.health || 0;
        player.health = Math.min(maxHp, before + heal);
        for (const npc of members) {
            const rel = Relationships.getRelationship(player, npc.id);
            if (rel) rel.score = Math.min(100, (rel.score || 0) + 1);
            npc.lastInteraction = (world && world.day) || npc.lastInteraction || 0;
        }
        return { healed: player.health - before, members: members.length, life };
    },

    // ──────────── DIPLOMACY ────────────

    /** Diplomacy skill plus a House Chancellor's bonus and diplomatic companions. */
    effectiveDiplomacy(player) {
        let value = (player.skills && player.skills.diplomacy) || 0;
        if (player.house) value += House.getRoleBonuses(player).diplomacyBonus || 0;
        value += this.companionBonus(player, 'diplomacy');
        value += this.moodCharisma(player); // see MOOD section
        value += Traits.effect(player, 'diplomacy'); // Cunning, Scholar, Wanderer
        // Diplomacy Mastery tech: +30% effective diplomacy
        if (player.technology) value *= 1 + Technology.getEffectTotal(player, 'diplomacyBonus');
        return value;
    },

    /** Multiplier on reputation you earn: +5% per point of effective diplomacy, × mood. */
    reputationGainMultiplier(player) {
        return (1 + 0.05 * this.effectiveDiplomacy(player)) * this.moodReputationMultiplier(player)
            * (1 + this.artifactBonus(player, 'reputationGain')) // Crown of Embers
            * (1 + _tenet(player, 'reputationGain')) // Peace tenet
            * Math.max(0.5, 1 + Traits.effect(player, 'reputationGain')); // earned traits + dynasty echo
    },

    /** Scale a positive reputation gain by diplomacy (losses are untouched). */
    scaleReputationGain(player, gain) {
        return gain > 0 ? Math.round(gain * this.reputationGainMultiplier(player)) : gain;
    },

    /** Added chance when negotiating with a lord: +2% per point of effective diplomacy. */
    negotiationBonus(player) {
        // Houses give standing: housing influence helps everywhere
        return 0.02 * this.effectiveDiplomacy(player) + Housing.getNegotiationBonus(player)
            + this.treasureBonus(player, 'negotiation') // a royal seal or treaty in hand
            + _tenet(player, 'negotiation') // Sovereignty tenet
            + Traits.effect(player, 'negotiation'); // Honest, Cunning, Deceitful…
    },

    // ──────────── TRADE ────────────

    /** Fractional price advantage when trading at `settlement`. */
    tradeBonus(player, settlement) {
        let bonus = _perk(player, 'tradeBonus') + this.companionBonus(player, 'trade')
            + this.moodTradeBonus(player) // see MOOD section
            + this.artifactBonus(player, 'tradeBonus')
            + Housing.getLocalTradeBonus(player, settlement); // a known householder here
        const kingdomId = settlement && settlement.kingdom;
        bonus += this.liegeTradeModifier(player, kingdomId);
        if (kingdomId && player.tradeAgreements && player.tradeAgreements[kingdomId]) {
            bonus += TRADE_AGREEMENT_BONUS;
        }
        // Mercantile peoples here, and peoples whose origin lore you know
        bonus += Peoples.playerTradeBonus(player, settlement);
        // A town devoted to your faith
        bonus += this.faithTradeBonus(player, settlement);
        // Earned traits: Merchant Prince, Greedy, Generous…
        bonus += Traits.effect(player, 'tradeBonus');
        return bonus;
    },

    /** Price adjustment in a town of `kingdomId` from the liege's wars and alliances. */
    liegeTradeModifier(player, kingdomId) {
        const st = player && player.politics;
        if (!st || !kingdomId) return 0;
        if ((st.liegeEnemies || []).includes(kingdomId)) return LIEGE_TRADE.enemy;
        if ((st.liegeAllies || []).includes(kingdomId)) return LIEGE_TRADE.ally;
        return 0;
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
        if (this.isProtected(player)) return 0;
        // Banner of the Iron Host, and the Valor tenet
        return Math.max(0, 1 - this.artifactBonus(player, 'casualtyReduction') - _tenet(player, 'casualties'));
    },

    /** Multiplier on health the player personally loses (protection, then armour). */
    personalDamageMultiplier(player) {
        if (this.isProtected(player)) return 0;
        let mult = 1;
        const inv = player.inventory || {};
        for (const [item, reduction] of Object.entries(ARMOR_REDUCTION)) {
            if (inv[item] > 0) mult *= 1 - reduction;
        }
        // Dragon scale and dragonscale armour
        mult *= 1 - this.treasureBonus(player, 'damageReduction');
        return mult;
    },

    /** Scale a raw personal damage roll; protection blocks it entirely. */
    scaleDamage(player, raw) {
        const mult = this.personalDamageMultiplier(player);
        return mult === 0 ? 0 : Math.max(1, Math.round(raw * mult));
    },

    // ──────────── EARNED TRAITS ────────────

    /** Wounds and sickness weaken the commander: battle power / personal damage multiplier. */
    ailmentBattleMultiplier(player) {
        return Ailments.battleMultiplier(player);
    },

    /** Battle power multiplier from earned traits (Brave, Craven, Sea Wolf, …). */
    traitBattleMultiplier(player) {
        return Math.max(0.5, 1 + Traits.effect(player, 'battlePower'));
    },

    /**
     * A lord's opinion adjustment from the player's traits and the dynasty
     * echo — and, for a known thieves' guild member, the lord's own character
     * (a cunning lord likes it, an honorable one does not).
     */
    lordOpinionBonus(player, lord) {
        return Traits.lordOpinion(player, lord) + Underworld.lordOpinion(player, lord);
    },

    // ──────────── MOOD (needs system) ────────────
    // player.getMood().effects promises combat, charisma and reputation
    // modifiers; these helpers are the only readers. Mood has no effect while
    // the needs system is switched off.

    /** The active mood effects, or {} when needs are off / unavailable. */
    moodEffects(player) {
        if (!player || !player.needsEnabled || typeof player.getMood !== 'function') return {};
        return player.getMood().effects || {};
    },

    /** Net combat modifier from mood: +1 (great spirits), −1 (miserable), 0 otherwise. */
    moodCombat(player) {
        const fx = this.moodEffects(player);
        return (fx.combatBonus || 0) + (fx.combatPenalty || 0);
    },

    /** Multiplier on battle power and personal melee damage: ±5% per point. */
    moodCombatMultiplier(player) {
        return 1 + MOOD_COMBAT_PER_POINT * this.moodCombat(player);
    },

    /** Net charisma modifier from mood (+1 / −1 / 0). */
    moodCharisma(player) {
        const fx = this.moodEffects(player);
        return (fx.charismaBonus || 0) + (fx.charismaPenalty || 0);
    },

    /** Fractional trade price advantage from mood: ±3% per point of charisma. */
    moodTradeBonus(player) {
        return MOOD_TRADE_PER_POINT * this.moodCharisma(player);
    },

    /** Multiplier on reputation earned from a good mood (+10% when ecstatic). */
    moodReputationMultiplier(player) {
        const fx = this.moodEffects(player);
        return 1 + MOOD_REPUTATION_PER_POINT * (fx.reputationGain || 0);
    },
};


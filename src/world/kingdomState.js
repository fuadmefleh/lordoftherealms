// ============================================
// KINGDOM STATE — combined kingdom bonuses and the stability stat
// ============================================
//
// Three sources describe what a kingdom is good at, and until now only a few
// of their numbers were ever read:
//   • kingdom.characterBonuses — ruler traits, ruler skills and advisors
//     (data/characters.json, computed daily by Characters)
//   • kingdom.lord.traits      — NPC lord personality numbers
//     (data/npcLords.json: warBonus, taxBonus, constructionBonus, ...)
//   • kingdom.cultureData.tradition.bonuses — the culture tradition
//     (data/culture.json, whole-number percentages)
// KingdomBonuses.get() folds all three into one fractional bonus per key so
// the kingdom AI has a single place to ask "how much better is this realm at X".
//
// KingdomStability is a 0-100 stat that drifts toward a target built from
// those bonuses, running world events, wars and money. Low stability cuts
// income and risks a Peasant Rebellion timed event.

import { Utils } from '../core/utils.js';
import { WorldEvents } from './worldEvents.js';

/** npcLords.json trait field that feeds each kingdom bonus key. */
const LORD_KEYS = {
    expansion: 'expansionBonus',
    warBonus: 'warBonus',
    diplomacy: 'diplomacyBonus',
    tradeBonus: 'tradeBonus',
    tax: 'taxBonus',
    loyalty: 'loyaltyBonus',
    faith: 'faithBonus',
    defense: 'defenseBonus',
    research: 'researchBonus',
    stability: 'stabilityBonus',
    construction: 'constructionBonus',
};

/**
 * culture.json tradition bonus → kingdom bonus key. Tradition numbers are
 * percentages (15 = +15%). Keys with no kingdom-level meaning of their own
 * fold into the nearest one (archery/cavalry shape army composition too).
 */
const TRADITION_KEYS = {
    military: 'military',
    cavalry: 'military',
    archery: 'military',
    naval: 'military',
    raiding: 'warBonus',
    endurance: 'endurance',
    defense: 'defense',
    diplomacy: 'diplomacy',
    hospitality: 'diplomacy',
    trade: 'tradeBonus',
    navigation: 'tradeBonus',
    exploration: 'expansion',
    nature: 'population',
    alchemy: 'population',
    faith: 'faith',
    scholarship: 'research',
    research: 'research',
    magic: 'research',
    mining: 'treasury',
    craftsmanship: 'construction',
    stealth: 'intrigue',
    poison: 'intrigue',
};

/** Human labels for kingdom bonus keys (panels, tooltips). */
const BONUS_LABELS = {
    military: '⚔️ Military', warBonus: '🗡️ Battle', defense: '🛡️ Defense', endurance: '🥾 Endurance',
    treasury: '💰 Treasury', stewardship: '📒 Stewardship', tax: '💵 Taxes', upkeep: '🏕️ Upkeep',
    tradeBonus: '⚖️ Trade', caravanProfitBonus: '🐪 Caravans', diplomacy: '🗣️ Diplomacy', relations: '🤝 Relations',
    stability: '🏛️ Stability', loyalty: '👑 Loyalty', expansion: '🗺️ Expansion', construction: '🔨 Construction',
    population: '👥 Growth', intrigue: '🕵️ Intrigue', research: '📚 Research', culture: '🎭 Culture',
    faith: '🙏 Faith', heirs: '👶 Heirs', rulerHealth: '🩺 Ruler health',
};

export const KingdomBonuses = {
    LORD_KEYS,
    TRADITION_KEYS,
    LABELS: BONUS_LABELS,

    /** Fractional bonus for a key from ruler/advisors, NPC lord and tradition. */
    get(kingdom, key) {
        if (!kingdom) return 0;
        let total = 0;
        const cb = kingdom.characterBonuses;
        if (cb && typeof cb[key] === 'number') total += cb[key];

        const lordKey = LORD_KEYS[key];
        if (lordKey && kingdom.lord && Array.isArray(kingdom.lord.traits)) {
            for (const t of kingdom.lord.traits) {
                if (t && typeof t[lordKey] === 'number') total += t[lordKey];
            }
        }

        const tradition = kingdom.cultureData && kingdom.cultureData.tradition;
        if (tradition && tradition.bonuses) {
            for (const [tk, val] of Object.entries(tradition.bonuses)) {
                if (TRADITION_KEYS[tk] === key && typeof val === 'number') total += val / 100;
            }
        }
        return total;
    },

    /** Tradition bonuses as display strings, e.g. ['⚔️ Military +10%', ...]. */
    describeTradition(tradition) {
        if (!tradition || !tradition.bonuses) return [];
        return Object.entries(tradition.bonuses).map(([k, v]) => {
            const name = k.charAt(0).toUpperCase() + k.slice(1);
            const target = BONUS_LABELS[TRADITION_KEYS[k]];
            return `${name} +${v}%${target ? ` (${target.replace(/^\S+\s/, '')})` : ''}`;
        });
    },

    /** Every non-zero combined bonus, for UI. [{ key, label, value }] */
    summary(kingdom) {
        const out = [];
        for (const key of Object.keys(BONUS_LABELS)) {
            const value = KingdomBonuses.get(kingdom, key);
            if (Math.abs(value) >= 0.005) out.push({ key, label: BONUS_LABELS[key], value });
        }
        return out;
    },
};

export const KingdomStability = {
    BASE: 60,
    /** Fraction of the gap to the target closed each day. */
    DRIFT_RATE: 0.08,
    /** Below this, settlements are restless and rebellion may break out. */
    UNREST_THRESHOLD: 35,
    /** Daily rebellion chance at stability 0 (scaled down toward the threshold). */
    MAX_REBELLION_CHANCE: 0.03,

    ensure(kingdom) {
        if (typeof kingdom.stability !== 'number' || Number.isNaN(kingdom.stability)) {
            kingdom.stability = KingdomStability.BASE;
        }
        return kingdom.stability;
    },

    /** Event modifier summed over running events that reach this kingdom. */
    eventMod(world, kingdom, key) {
        return WorldEvents.getModifier(world, key, { kingdom: kingdom.id });
    },

    /** Where stability is heading, with the reasons (for tooltips/tests). */
    target(kingdom, world) {
        const parts = [];
        const add = (label, v) => { if (Math.abs(v) >= 0.5) parts.push({ label, value: Math.round(v) }); return v; };
        let t = KingdomStability.BASE;
        t += add('Rulers & traditions', (KingdomBonuses.get(kingdom, 'stability') + KingdomBonuses.get(kingdom, 'loyalty') * 0.5) * 100);
        t += add('Events', KingdomStability.eventMod(world, kingdom, 'stability'));
        t += add('Mood of the realm', KingdomStability.eventMod(world, kingdom, 'morale') * 0.3);
        t += add('Wars', -5 * ((kingdom.wars && kingdom.wars.length) || 0));
        if ((kingdom.treasury || 0) <= 0) t += add('Empty treasury', -15);
        if (kingdom.religion && typeof kingdom.religion.unity === 'number') {
            t += add('Faith unity', (kingdom.religion.unity - 50) * 0.1);
        }
        return { value: Utils.clamp(t, 0, 100), parts };
    },

    /**
     * One day: drift toward the target, then roll for unrest. Returns the
     * started rebellion event, if any.
     */
    processDay(kingdom, world) {
        KingdomStability.ensure(kingdom);
        const { value } = KingdomStability.target(kingdom, world);
        kingdom.stability = Utils.clamp(kingdom.stability + (value - kingdom.stability) * KingdomStability.DRIFT_RATE, 0, 100);
        kingdom.stability = Math.round(kingdom.stability * 100) / 100;

        if (kingdom.stability >= KingdomStability.UNREST_THRESHOLD) return null;
        if ((world.activeEvents || []).some(ev => ev.id === 'rebellion' && ev.kingdomId === kingdom.id)) return null;
        // Spymasters and cunning rulers root out plotters
        const intrigue = Utils.clamp(KingdomBonuses.get(kingdom, 'intrigue'), 0, 0.8);
        const unrest = (KingdomStability.UNREST_THRESHOLD - kingdom.stability) / KingdomStability.UNREST_THRESHOLD;
        const chance = KingdomStability.MAX_REBELLION_CHANCE * unrest * (1 - intrigue);
        if (Utils.random() >= chance) return null;
        const ev = WorldEvents.startEvent(world, 'rebellion', { kingdomId: kingdom.id });
        if (ev && Array.isArray(world.events)) {
            world.events.push({ text: `${ev.icon} ${ev.text} (${ev.daysLeft} days)`, type: 'timed', timedEvent: ev });
        }
        return ev;
    },

    /**
     * Income multiplier from stability: up to +20% when content, down to
     * -50% at zero (the tax collectors can't reach rebel villages).
     */
    incomeMultiplier(kingdom) {
        const s = typeof kingdom?.stability === 'number' ? kingdom.stability : KingdomStability.BASE;
        if (s >= 50) return 1 + (s - 50) / 250;
        return Math.max(0.5, 1 - (50 - s) / 100);
    },

    /** Battle morale shift: ±0.1 at the extremes. */
    moraleBonus(kingdom) {
        const s = typeof kingdom?.stability === 'number' ? kingdom.stability : KingdomStability.BASE;
        return (s - 50) / 500;
    },

    label(stability) {
        if (stability >= 80) return 'Flourishing';
        if (stability >= 60) return 'Stable';
        if (stability >= KingdomStability.UNREST_THRESHOLD) return 'Uneasy';
        if (stability >= 15) return 'Restless';
        return 'In Revolt';
    },

    color(stability) {
        if (stability >= 60) return '#27ae60';
        if (stability >= KingdomStability.UNREST_THRESHOLD) return '#f1c40f';
        return '#e74c3c';
    },
};

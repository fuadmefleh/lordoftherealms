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
    military: '⚔️ Military', militaryRegen: '🔁 Army regen', warBonus: '🗡️ Battle', defense: '🛡️ Defense', endurance: '🥾 Endurance',
    treasury: '💰 Treasury', stewardship: '📒 Stewardship', tax: '💵 Taxes', upkeep: '🏕️ Upkeep',
    tradeBonus: '⚖️ Trade', caravanProfitBonus: '🐪 Caravans', diplomacy: '🗣️ Diplomacy', relations: '🤝 Relations',
    stability: '🏛️ Stability', loyalty: '👑 Loyalty', expansion: '🗺️ Expansion', construction: '🔨 Construction',
    population: '👥 Growth', intrigue: '🕵️ Intrigue', research: '📚 Research', culture: '🎭 Culture',
    faith: '🙏 Faith', heirs: '👶 Heirs', rulerHealth: '🩺 Ruler health', visionRadius: '🧭 Scouting',
};

export const KingdomBonuses = {
    LORD_KEYS,
    TRADITION_KEYS,
    LABELS: BONUS_LABELS,

    /**
     * What each kingdom trait (kingdom.traits: 'militaristic', 'orderly', ...)
     * does: { label, summary, bonuses: { key: fraction } }. Loaded from
     * data/kingdoms.json → traitEffects.
     */
    TRAITS: {},

    /** Sum of one bonus key over the kingdom's traits. */
    traitBonus(kingdom, key) {
        const traits = kingdom && kingdom.traits;
        if (!Array.isArray(traits) || !traits.length) return 0;
        let total = 0;
        for (const id of traits) {
            const def = KingdomBonuses.TRAITS[id];
            const v = def && def.bonuses ? def.bonuses[key] : undefined;
            if (typeof v === 'number') total += v;
        }
        return total;
    },

    /** The kingdom's traits with what they do, for UI. [{ id, label, summary }] */
    describeTraits(kingdom) {
        return ((kingdom && kingdom.traits) || []).map(id => {
            const def = KingdomBonuses.TRAITS[id] || {};
            return { id, label: def.label || id, summary: def.summary || '' };
        });
    },

    /** Fractional bonus for a key from traits, ruler/advisors, NPC lord and tradition. */
    get(kingdom, key) {
        if (!kingdom) return 0;
        // The realm's own character (data/kingdoms.json → traitEffects)
        let total = KingdomBonuses.traitBonus(kingdom, key);
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

        // Scholarship, influence and running cultural events
        total += KingdomCulture.bonus(kingdom, key);

        // The realm's peoples: martial, devout, courteous, learned, secretive
        // and mercantile folk (kingdom.peoples, set daily by systems/peoples)
        const pb = kingdom.peoples && kingdom.peoples.bonuses;
        if (pb && typeof pb[key] === 'number') total += pb[key];
        // The crown: a player ruler's policies, a civil war or a succession
        // crisis (kingdom.crown, kept by systems/throne.js)
        const cm = kingdom.crown && kingdom.crown.mods;
        if (cm && typeof cm[key] === 'number') total += cm[key];
        return total;
    },

    /**
     * A player-ruled realm's edict effect beyond the kingdom AI (roadCost,
     * charterCost, rivalPostReturn, holdingWalls — data/kingship.json →
     * edicts.*.effects), summed over the edicts in force. kingdom.crown.effects
     * is kept by systems/throne.js (syncCrowns). 0 for any other realm.
     */
    crownEffect(kingdom, key) {
        const fx = kingdom && kingdom.crown && kingdom.crown.effects;
        const v = fx && fx[key];
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
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

/**
 * What a kingdom's culture actually does. kingdom.cultureData carries
 * scholarship and influence (0-100) and the cultural events it is running
 * (Culture.processTurn, data/culture.json). This lives in world/ so the
 * kingdom AI and KingdomBonuses can read it without importing systems/.
 *
 * Kept deliberately small — a fully learned, admired realm earns about +5%
 * income, +20% construction, +3 diplomacy per envoy and +5 stability.
 */
export const KingdomCulture = {
    /** Per-point weights (scholarship/influence are 0-100). */
    WEIGHTS: {
        stewardship: 0.10,      // × scholarship/100 → income (stewardship counts half)
        construction: 0.20,     // × scholarship/100 → repairs and village founding
        diplomacy: 0.30,        // × influence/100 → +floor(x*10) relations per envoy
        stabilityPivot: 40,     // average of scholarship & influence giving ±0 stability
        stabilityPerPoint: 0.1, // stability per point above/below the pivot
    },

    /** Total `value` of the kingdom's running cultural events with this effect. */
    eventValue(kingdom, effect) {
        const events = kingdom && kingdom.cultureData && kingdom.cultureData.events;
        if (!Array.isArray(events)) return 0;
        let total = 0;
        for (const ev of events) {
            if (ev && ev.effect === effect && (ev.daysLeft === undefined || ev.daysLeft > 0)) total += ev.value || 0;
        }
        return total;
    },

    _levels(kingdom) {
        const cd = kingdom && kingdom.cultureData;
        if (!cd) return null;
        return {
            scholarship: Utils.clamp(cd.scholarship || 0, 0, 100) / 100,
            influence: Utils.clamp(cd.influence || 0, 0, 100) / 100,
        };
    },

    /**
     * Fractional KingdomBonuses contribution for a key:
     *  - scholarship → stewardship (income) and construction
     *  - influence → diplomacy
     *  - events: industry → construction & treasury, trade → trade routes &
     *    treasury, renown → diplomacy
     */
    bonus(kingdom, key) {
        const lv = KingdomCulture._levels(kingdom);
        if (!lv) return 0;
        const W = KingdomCulture.WEIGHTS;
        switch (key) {
            case 'stewardship': return lv.scholarship * W.stewardship;
            case 'construction': return lv.scholarship * W.construction + KingdomCulture.eventValue(kingdom, 'industry') / 100;
            case 'diplomacy': return lv.influence * W.diplomacy + KingdomCulture.eventValue(kingdom, 'renown') / 40;
            case 'tradeBonus': return KingdomCulture.eventValue(kingdom, 'trade') / 100;
            case 'treasury': return (KingdomCulture.eventValue(kingdom, 'industry') + KingdomCulture.eventValue(kingdom, 'trade')) / 200;
            default: return 0;
        }
    },

    /** Stability target shift: learning and prestige steady a realm, festivals lift it. */
    stabilityMod(kingdom) {
        const lv = KingdomCulture._levels(kingdom);
        if (!lv) return 0;
        const W = KingdomCulture.WEIGHTS;
        const avg = (lv.scholarship + lv.influence) * 50;
        return (avg - W.stabilityPivot) * W.stabilityPerPoint + KingdomCulture.eventValue(kingdom, 'morale') * 0.2;
    },

    /** Battle morale from running festivals and games (points/200). */
    moraleBonus(kingdom) {
        return KingdomCulture.eventValue(kingdom, 'morale') / 200;
    },

    /**
     * Cultural pull: envoys from a less influential realm warm toward an
     * admired one (+1 per 20 points of influence gap, at most +3).
     */
    admiration(kingdom, target) {
        if (!kingdom || !target || !kingdom.cultureData || !target.cultureData) return 0;
        const gap = (target.cultureData.influence || 0) - (kingdom.cultureData.influence || 0);
        return Utils.clamp(Math.floor(gap / 20), 0, 3);
    },

    /**
     * Daily growth from running events: book fairs, debates and symposia add
     * scholarship, exhibitions add influence, spirit walks add piety
     * (value/10 per day each).
     */
    applyEvents(kingdom) {
        const cd = kingdom && kingdom.cultureData;
        if (!cd) return;
        const learning = KingdomCulture.eventValue(kingdom, 'scholarship') + KingdomCulture.eventValue(kingdom, 'research');
        if (learning && typeof cd.scholarship === 'number') cd.scholarship = Math.min(100, cd.scholarship + learning / 10);
        const inf = KingdomCulture.eventValue(kingdom, 'influence');
        if (inf && typeof cd.influence === 'number') cd.influence = Math.min(100, cd.influence + inf / 10);
        const faith = KingdomCulture.eventValue(kingdom, 'faith');
        if (faith && kingdom.religion && typeof kingdom.religion.piety === 'number') {
            kingdom.religion.piety = Math.min(100, kingdom.religion.piety + faith / 10);
        }
    },
};

/**
 * How the NPC lord's character shapes the kingdom (world/npcLords.js). Two
 * inputs:
 *   • the lord's 1-10 stats — ambition, honor, intelligence, stewardship —
 *     read here as a lean of -1..+1 around the middle (5.5);
 *   • kingdom.lordModifiers — standing effects of the lord's goals (justice,
 *     fear, domination, faith, survive), recomputed daily by
 *     NPCLords.updateModifiers: { stability, military, defense, upkeep,
 *     warAppetite, truceDays, lawful }.
 * Lives here (not in npcLords) so the kingdom AI can read it without an
 * import cycle.
 */
const STAT_MID = 5.5;
const GOAL_PRIORITY_WEIGHT = { high: 1, medium: 0.75, low: 0.5 };

export const LordInfluence = {
    GOAL_PRIORITY_WEIGHT,
    /** Base daily chance that a lord works on one of his goals. */
    BASE_GOAL_CHANCE: 0.3,

    /** A lord stat (1-10), 5.5 when there is no lord or no such stat. */
    stat(kingdom, key) {
        const v = kingdom && kingdom.lord ? kingdom.lord[key] : undefined;
        return typeof v === 'number' ? v : STAT_MID;
    },

    /** The stat as a lean: -1 at 1, 0 at 5.5, +1 at 10. */
    lean(kingdom, key) {
        return Utils.clamp((LordInfluence.stat(kingdom, key) - STAT_MID) / 4.5, -1, 1);
    },

    /** A standing goal modifier (0 when absent). */
    mod(kingdom, key) {
        const m = kingdom && kingdom.lordModifiers;
        return m && typeof m[key] === 'number' ? m[key] : 0;
    },

    hasGoal(kingdom, type) {
        const goals = kingdom && kingdom.lord && kingdom.lord.goals;
        return Array.isArray(goals) && goals.some(g => g && g.type === type);
    },

    /**
     * Daily chance to pursue a goal: ambition drives intensity (±25%),
     * intelligence makes the effort count (±15%), priority weights it.
     */
    goalChance(kingdom, goal) {
        const weight = GOAL_PRIORITY_WEIGHT[goal && goal.priority] || GOAL_PRIORITY_WEIGHT.medium;
        return LordInfluence.BASE_GOAL_CHANCE * weight
            * (1 + LordInfluence.lean(kingdom, 'ambition') * 0.25)
            * (1 + LordInfluence.lean(kingdom, 'intelligence') * 0.15);
    },

    /** Stewardship: ±10% on the kingdom's daily income. */
    incomeBonus(kingdom) {
        return LordInfluence.lean(kingdom, 'stewardship') * 0.1;
    },

    /** Intelligence: a shrewd lord's envoys do better (±0.15 diplomacy). */
    diplomacyBonus(kingdom) {
        return LordInfluence.lean(kingdom, 'intelligence') * 0.15;
    },

    /**
     * Multiplier on how strong a realm must feel before it declares war:
     * ambition and domination raise it, honor lowers it.
     */
    warAppetite(kingdom) {
        return Utils.clamp(1 + LordInfluence.lean(kingdom, 'ambition') * 0.15
            - LordInfluence.lean(kingdom, 'honor') * 0.1
            + LordInfluence.mod(kingdom, 'warAppetite'), 0.6, 1.5);
    },

    /**
     * Extra days this lord keeps a truce (honor ±45, a 'justice' goal +45).
     * Faithless lords let truces lapse early — the commonest betrayal.
     */
    truceBonusDays(kingdom) {
        return Math.round(LordInfluence.lean(kingdom, 'honor') * 45 + LordInfluence.mod(kingdom, 'truceDays'));
    },

    /** Relations below which this lord drops an alliance (30; 15 honorable … 45 faithless). */
    allianceFloor(kingdom) {
        return Math.round(30 - LordInfluence.lean(kingdom, 'honor') * 15);
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
        t += add('Culture & learning', KingdomCulture.stabilityMod(kingdom));
        t += add('Mood of the realm', KingdomStability.eventMod(world, kingdom, 'morale') * 0.3);
        t += add('Lord\'s rule', LordInfluence.mod(kingdom, 'stability'));
        // Orderly or restless peoples, and how well they get along (systems/peoples)
        if (kingdom.peoples && typeof kingdom.peoples.stability === 'number') {
            t += add('Peoples & harmony', kingdom.peoples.stability);
        }
        t += add('Wars', -5 * ((kingdom.wars && kingdom.wars.length) || 0));
        // Wartime propaganda maps (Cartography.processTurn) rally the realm: +2 each, up to +6
        const propaganda = (kingdom.cartography && kingdom.cartography.propagandaMaps) || [];
        if (propaganda.length > 0 && kingdom.wars && kingdom.wars.length > 0) {
            t += add('Propaganda', Math.min(6, 2 * propaganda.length));
        }
        if ((kingdom.treasury || 0) <= 0) t += add('Empty treasury', -15);
        if (kingdom.religion && typeof kingdom.religion.unity === 'number') {
            t += add('Faith unity', (kingdom.religion.unity - 50) * 0.1);
        }
        // Towns devoted to the player's faith (Justice tenet), set daily by
        // PlayerReligion.processDaily
        if (kingdom.playerFaith && typeof kingdom.playerFaith.stability === 'number') {
            t += add('Faithful towns', kingdom.playerFaith.stability);
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

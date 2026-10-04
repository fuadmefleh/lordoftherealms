// ============================================
// KINGDOM ATLAS — what a realm's own cartographers know
// ============================================
//
// kingdom.cartography = {
//     cartographerHired, // a court cartographer on the payroll (hired when rich, upkeep daily)
//     mapsMade,          // maps the court has drawn — the atlas's experience (skill)
//     mapsOwned,         // the royal archive: one chart per foreign realm
//                        //   { kingdomId, accuracy, day, source, lies }
//     propagandaMaps,    // wartime propaganda (Cartography.processTurn)
//     distrust,          // doctored maps the archive caught the player selling
// }
//
// What it does:
//  • A chart of the enemy makes a realm campaign better (KingdomAI.simulateBattle)
//    and makes it pick charted realms as war targets (KingdomAI.considerWar).
//  • Lies on a chart (a doctored map the player sold the archive) do the
//    opposite until the court cartographer redraws that realm and exposes them.
//  • Skill sets the accuracy of the official and archive maps the realm sells,
//    and how likely the archive is to spot a doctored map (Cartography).
//
// Growth is fully deterministic — day + a per-kingdom hash, no RNG draws —
// so the daily world simulation's random stream is unchanged.

import { Utils } from '../core/utils.js';
import { KingdomBonuses } from './kingdomState.js';

/** Tuning; overridden from data/cartography.json → kingdomAtlas. */
const CONFIG = {
    hireTreasury: 5000,  // a realm this rich appoints a court cartographer
    hireCost: 300,       // one-off appointment cost
    upkeep: 2,           // gold per day while employed
    drawInterval: 45,    // days between maps, before scouting/research speed it up
    minInterval: 8,
    maxCharts: 8,        // charts kept in the archive
    baseSkill: 1,
    skillGrowth: 0.9,    // atlas skill = base + growth × √(maps drawn), 0-10
    scoutingSkill: 10,   // explorer rulers (visionRadius 0.2) add +2 skill
    baseAccuracy: 0.45,  // chart accuracy = base + skill × perSkill (max 0.95)
    accuracyPerSkill: 0.05,
    maxAccuracy: 0.95,
    campaignBonus: 0.12, // battle power with a perfect chart of the enemy
    liePenalty: 0.05,    // per falsehood on the chart
    maxLiePenalty: 0.2,
    spotPerSkill: 0.06,  // chance per skill point to spot each doctored alteration
    maxSpot: 0.9,
    distrustLimit: 3,    // the archive stops buying from you after this many frauds
};

function hashId(id) {
    const s = String(id);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export const KingdomAtlas = {
    CONFIG,

    /** Ensure kingdom.cartography exists with every field (old saves too). */
    ensure(kingdom) {
        if (!kingdom.cartography) kingdom.cartography = {};
        const c = kingdom.cartography;
        if (!Array.isArray(c.mapsOwned)) c.mapsOwned = [];
        if (typeof c.mapsMade !== 'number') c.mapsMade = 0;
        if (!Array.isArray(c.propagandaMaps)) c.propagandaMaps = [];
        if (typeof c.cartographerHired !== 'boolean') c.cartographerHired = false;
        if (typeof c.distrust !== 'number') c.distrust = 0;
        return c;
    },

    /** Scouting bonus from explorer rulers and the like (fraction, >= 0). */
    scouting(kingdom) {
        return Math.max(0, KingdomBonuses.get(kingdom, 'visionRadius'));
    },

    /** Atlas skill 0-10: experience of maps drawn plus scouting. */
    skill(kingdom) {
        const c = (kingdom && kingdom.cartography) || {};
        const raw = CONFIG.baseSkill + Math.sqrt(Math.max(0, c.mapsMade || 0)) * CONFIG.skillGrowth
            + KingdomAtlas.scouting(kingdom) * CONFIG.scoutingSkill;
        return Math.round(Utils.clamp(raw, 0, 10) * 100) / 100;
    },

    /** How accurate a map this realm's cartographers draw today. */
    chartAccuracy(kingdom) {
        return Math.min(CONFIG.maxAccuracy, CONFIG.baseAccuracy + KingdomAtlas.skill(kingdom) * CONFIG.accuracyPerSkill);
    },

    /** Days between maps: explorer rulers and scholarship speed the court up. */
    drawInterval(kingdom) {
        const speed = 1 + KingdomAtlas.scouting(kingdom) * 2 + Math.max(0, KingdomBonuses.get(kingdom, 'research')) * 0.5;
        return Math.max(CONFIG.minInterval, Math.round(CONFIG.drawInterval / speed));
    },

    /** The archive's chart of another realm, or null. */
    getChart(kingdom, targetId) {
        const owned = kingdom && kingdom.cartography && kingdom.cartography.mapsOwned;
        if (!Array.isArray(owned)) return null;
        return owned.find(c => c.kingdomId === targetId) || null;
    },

    /** File a chart in the archive (replacing that realm's old chart). */
    recordChart(kingdom, entry) {
        const c = KingdomAtlas.ensure(kingdom);
        c.mapsOwned = c.mapsOwned.filter(m => m.kingdomId !== entry.kingdomId);
        c.mapsOwned.push({ lies: 0, ...entry });
        if (c.mapsOwned.length > CONFIG.maxCharts) {
            c.mapsOwned.sort((a, b) => (a.day || 0) - (b.day || 0));
            c.mapsOwned.splice(0, c.mapsOwned.length - CONFIG.maxCharts);
        }
        return c.mapsOwned[c.mapsOwned.length - 1];
    },

    /**
     * Battle-power multiplier for fighting enemyId: up to +campaignBonus with
     * an accurate chart, minus liePenalty per falsehood planted on it.
     */
    campaignMultiplier(kingdom, enemyId) {
        const chart = KingdomAtlas.getChart(kingdom, enemyId);
        if (!chart) return 1;
        const quality = Utils.clamp(((chart.accuracy || 0) - 0.4) / 0.55, 0, 1);
        const lies = Math.min(CONFIG.maxLiePenalty, (chart.lies || 0) * CONFIG.liePenalty);
        return 1 + CONFIG.campaignBonus * quality - lies;
    },

    /** Of these possible war targets, the ones the realm has charted (or all). */
    preferCharted(kingdom, candidates) {
        const charted = candidates.filter(k => KingdomAtlas.getChart(kingdom, k.id));
        return charted.length > 0 ? charted : candidates;
    },

    /** Chance the archive spots at least one of `lies` doctored alterations. */
    spotChance(kingdom, lies) {
        if (!lies) return 0;
        const per = Math.min(CONFIG.maxSpot, KingdomAtlas.skill(kingdom) * CONFIG.spotPerSkill);
        return Math.min(CONFIG.maxSpot, 1 - Math.pow(1 - per, lies));
    },

    /**
     * Which realm the court maps next: enemies at war first, then hostile
     * realms, uncharted before charted, stale charts before fresh ones.
     * Deterministic (ties go to list order).
     */
    chooseSubject(kingdom, world) {
        const day = (world && world.day) || 0;
        let best = null;
        let bestScore = -Infinity;
        for (const k of world.kingdoms || []) {
            if (!k.isAlive || k.id === kingdom.id) continue;
            const chart = KingdomAtlas.getChart(kingdom, k.id);
            let score = 0;
            if ((kingdom.wars || []).includes(k.id)) score += 40;
            if (((kingdom.relations || {})[k.id] || 0) < -30) score += 20;
            score += chart ? Math.min(60, (day - (chart.day || 0)) / 5) : 50;
            if (score > bestScore) { bestScore = score; best = k; }
        }
        return best;
    },

    /** The court cartographer draws (or redraws) a chart of the chosen realm. */
    drawMap(kingdom, world) {
        const c = KingdomAtlas.ensure(kingdom);
        const subject = KingdomAtlas.chooseSubject(kingdom, world);
        if (!subject) return null;
        const old = KingdomAtlas.getChart(kingdom, subject.id);
        let exposed = 0;
        if (old && old.lies > 0) {
            exposed = old.lies;
            if (old.source === 'player') c.distrust += 1;
            if (world && Array.isArray(world.events)) {
                world.events.push({
                    text: `🗺️ ${kingdom.name}'s cartographers find the map of ${subject.name} in their archive was doctored${old.source === 'player' ? ' — and remember who sold it' : ''}.`,
                    type: 'cartography',
                    category: 'POLITICAL',
                });
            }
        }
        c.mapsMade += 1;
        const chart = KingdomAtlas.recordChart(kingdom, {
            kingdomId: subject.id,
            accuracy: Math.round(KingdomAtlas.chartAccuracy(kingdom) * 100) / 100,
            day: (world && world.day) || 0,
            source: 'cartographer',
            lies: 0,
        });
        return { subject, chart, exposed };
    },

    /**
     * Daily: rich realms appoint a court cartographer and pay upkeep (an empty
     * treasury dismisses him); an employed cartographer draws a map every
     * drawInterval days, on a day offset by a hash of the kingdom id.
     */
    processDay(kingdom, world) {
        if (!kingdom || !kingdom.isAlive) return null;
        const c = KingdomAtlas.ensure(kingdom);
        if (!c.cartographerHired) {
            if ((kingdom.treasury || 0) >= CONFIG.hireTreasury) {
                c.cartographerHired = true;
                kingdom.treasury -= CONFIG.hireCost;
                if (world && Array.isArray(world.events)) {
                    world.events.push({ text: `🧭 ${kingdom.name} appoints a royal cartographer.`, type: 'cartography', category: 'POLITICAL' });
                }
            }
            return null;
        }
        if ((kingdom.treasury || 0) <= 0) {
            c.cartographerHired = false;
            return null;
        }
        kingdom.treasury -= CONFIG.upkeep;
        const day = (world && world.day) || 0;
        if ((day + hashId(kingdom.id)) % KingdomAtlas.drawInterval(kingdom) !== 0) return null;
        return KingdomAtlas.drawMap(kingdom, world);
    },

    /** Display summary for panels. */
    summary(kingdom, world) {
        const c = (kingdom && kingdom.cartography) || {};
        const charts = (c.mapsOwned || []).map(ch => {
            const k = world && world.getKingdom ? world.getKingdom(ch.kingdomId) : null;
            return { kingdomId: ch.kingdomId, name: k ? k.name : ch.kingdomId, accuracy: ch.accuracy, day: ch.day, source: ch.source };
        });
        return {
            hired: !!c.cartographerHired,
            mapsMade: c.mapsMade || 0,
            skill: KingdomAtlas.skill(kingdom),
            accuracy: KingdomAtlas.chartAccuracy(kingdom),
            distrust: c.distrust || 0,
            charts,
        };
    },
};

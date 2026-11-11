// ============================================
// SETTLEMENT WEALTH — what a place can afford to build with
// ============================================
//
// A town's wealth decides what its buildings are made of (data/architecture.json
// `wealth`, each culture's `tiers`): the poor build of mud, logs, wattle or rough
// stone under thatch, the middling of timber, plaster and boards under wooden
// shingle, the rich of dressed stone or brick under slate or tile. Wealth is a
// tier inside a culture: a poor village of a stone-building people is rough
// fieldstone and thatch, never its capital's ashlar.
//
// The score (0-1) is the place's size (log of its population) and its purse
// (the town's real coin a head, settlement.economy.gold), a village held below
// villageMax and a capital above capitalMin. Within the town the core is richer
// and the edge poorer, a landmark richer than a house, and each building a
// little either way by a hash of its place.
//
// A town keeps the score it was first seen with (settlement.buildWealth) — its
// houses don't rebuild themselves every visit — until it has scored another
// tier for restampDays; then it is restamped and its houses stand in the new
// tier (the town rebuilt over the years). A building put up later (a lot's
// house) is built in the tier of the day (`score`).
//
// Pure: no randomness, no globals; the settlement and the day passed in.

import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function _hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

const FALLBACK = {
    popLow: 100, popHigh: 10000, purseNorm: 2, purseStep: 0.08, purseCap: 0.2,
    villageMax: 0.62, capitalMin: 0.55,
    tiers: { poor: 0.36, rich: 0.75 },
    ring: { core: 0.12, mid: 0, edge: -0.3 }, landmark: 0.1, jitter: 0.06,
    restampDays: 1800,
};

export const TIERS = ['poor', 'mid', 'rich'];

export const SettlementWealth = {
    /** The rules (data/architecture.json `wealth`) */
    rules() {
        const g = DataLoader._gamedata;
        const w = g && g.architecture && g.architecture.wealth;
        return w && typeof w === 'object' ? { ...FALLBACK, ...w } : FALLBACK;
    },

    /** A settlement's wealth today, 0 (a hamlet of paupers) to 1 (a great rich capital) */
    score(settlement) {
        if (!settlement) return 0.5;
        const W = SettlementWealth.rules();
        const pop = Math.max(1, _num(settlement.population, 100));
        const lo = Math.log10(Math.max(1, _num(W.popLow, 100)));
        const hi = Math.log10(Math.max(10, _num(W.popHigh, 10000)));
        let s = _clamp((Math.log10(pop) - lo) / Math.max(0.1, hi - lo), 0, 1);
        // The purse: coin a head against the coin a town starts with
        const gold = settlement.economy && Number.isFinite(settlement.economy.gold) ? settlement.economy.gold : null;
        if (gold != null) {
            const perHead = Math.max(0.01, gold / pop);
            const cap = _num(W.purseCap, 0.2);
            s += _clamp(Math.log2(perHead / Math.max(0.01, _num(W.purseNorm, 2))) * _num(W.purseStep, 0.08), -cap, cap);
        }
        if (settlement.type === 'village') s = Math.min(s, _num(W.villageMax, 0.62));
        if (settlement.type === 'capital') s = Math.max(s, _num(W.capitalMin, 0.55));
        return _clamp(s, 0, 1);
    },

    /** The tier a score falls in */
    tierOf(score) {
        const T = SettlementWealth.rules().tiers || FALLBACK.tiers;
        return score < _num(T.poor, 0.36) ? 'poor' : score >= _num(T.rich, 0.75) ? 'rich' : 'mid';
    },

    /**
     * The wealth a town's standing buildings were built with: stamped the first
     * time it is asked for, and stamped again once the town has been of another
     * tier for restampDays (day: the world's day, null to leave the stamp be).
     */
    standing(settlement, day = null) {
        if (!settlement) return 0.5;
        const now = SettlementWealth.score(settlement);
        const d = Number.isFinite(day) ? day : null;
        let st = settlement.buildWealth;
        if (!st || !Number.isFinite(st.score)) {
            settlement.buildWealth = { score: Math.round(now * 1000) / 1000, day: d };
            return settlement.buildWealth.score;
        }
        if (d == null) return st.score;
        if (SettlementWealth.tierOf(now) === SettlementWealth.tierOf(st.score)) {
            if (st.since != null) delete st.since;
        } else if (st.since == null) {
            st.since = d;
        } else if (d - st.since >= _num(SettlementWealth.rules().restampDays, 1800)) {
            settlement.buildWealth = st = { score: Math.round(now * 1000) / 1000, day: d };
        }
        return st.score;
    },

    /**
     * The tier one building stands in: the town's score, its ring of town ('core' |
     * 'mid' | 'edge'), whether it is a landmark, and a little either way by a hash
     * of its key (its place: the same building, the same tier, every visit).
     */
    buildingTier(score, { ring = 'mid', landmark = false, key = '' } = {}) {
        const W = SettlementWealth.rules();
        const R = W.ring || FALLBACK.ring;
        const j = _num(W.jitter, 0.08) * ((_hash(String(key)) / 4294967295) * 2 - 1);
        const tier = SettlementWealth.tierOf(_num(score, 0.5) + _num(R[ring], 0) + (landmark ? _num(W.landmark, 0.12) : 0) + j);
        // No building outclasses its town by more than maxStep tiers: a poor
        // village's church is a decent one, never a rich man's hall.
        const cap = TIERS.indexOf(SettlementWealth.tierOf(_num(score, 0.5))) + _num(W.maxStep, 1);
        return TIERS[Math.min(TIERS.indexOf(tier), cap)];
    },
};

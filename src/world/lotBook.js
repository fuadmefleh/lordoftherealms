// ============================================
// LOT BOOK — who holds a town's building lots and vacant houses
// ============================================
// A town's lots (set aside by world/townPlanner.js) and its vacant houses
// (world/innerMap/lots.js picks them) are known by id; what's become of each
// is written in the town's lot book, kept on the settlement itself (saved
// with the world tile):
//
//   settlement.lotBook = {
//       lots:      { lot3: { holder, holderName, price, day, built: { type, name, by, readyDay, kind?, cost?, let?, tenant? } } },
//       vacancies: { '41,57': { status: 'rented'|'owned', holder, holderName, rent, day, paidDay?, let?, tenant? } },
//   }
//
// A house of the player's to let (a bought vacancy, or built.kind 'house' on
// their lot) carries let (offered to tenants) and tenant { name, since, rent,
// paidDay, owed, missed }.
//
// holder: 'player', 'rival:<kingdomId>' (an AI House), or 'npc:<name>'.
// Pure data and arithmetic; the dealings are systems/lots.js.
// Data: data/lots.json.

import { DataLoader } from '../core/dataLoader.js';

const DEFAULTS = {
    count: { village: 10, town: 7, city: 4, capital: 3 },
    width: { village: [7, 9], town: [6, 8], city: [6, 7], capital: [6, 7] },
    depth: { village: [6, 7], town: [6, 7], city: [5, 6], capital: [5, 6] },
    pricePerTile: { village: 2, town: 5, city: 10, capital: 14 },
    vacant: { village: 0, town: 1, city: 3, capital: 4 },
    rentPerDay: { village: 1, town: 2, city: 4, capital: 6 },
    salePrice: { village: 150, town: 320, city: 620, capital: 900 },
    houseBuild: { cost: { village: 110, town: 230, city: 420, capital: 600 }, days: { village: 8, town: 10, city: 12, capital: 14 } },
    letting: { tenantChance: 0.12, rentMult: 1, missChance: 0.03, behindMult: 6, leaveAfterMissed: 10, warnEvery: 5, summaryDays: 30 },
    sellBack: 0.75,
    ai: { buyChance: { village: 0.006, town: 0.008, city: 0.012, capital: 0.015 }, rentChance: 0.02, leaveChance: 0.006, buildDays: 20, builds: ['house'], buyers: ['a townsman'] },
};

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const LotBook = {
    config() {
        const d = DataLoader._gamedata && DataLoader._gamedata.lots;
        if (!d || typeof d !== 'object') return DEFAULTS;
        return {
            ...DEFAULTS, ...d,
            ai: { ...DEFAULTS.ai, ...(d.ai || {}) },
            houseBuild: { ...DEFAULTS.houseBuild, ...(d.houseBuild || {}) },
            letting: { ...DEFAULTS.letting, ...(d.letting || {}) },
        };
    },

    /** A per-type setting (falls back to the village's). */
    byType(key, type) {
        const t = this.config()[key] || {};
        return t[type] != null ? t[type] : t.village;
    },

    /** The settlement's lot book (made on first asking). */
    of(settlement) {
        if (!settlement) return null;
        if (!settlement.lotBook || typeof settlement.lotBook !== 'object') settlement.lotBook = { lots: {}, vacancies: {} };
        const b = settlement.lotBook;
        if (!b.lots) b.lots = {};
        if (!b.vacancies) b.vacancies = {};
        return b;
    },

    /** The record of one lot, or null while it's for sale. */
    lot(settlement, id) {
        const b = settlement && settlement.lotBook;
        return (b && b.lots && b.lots[id]) || null;
    },

    vacancy(settlement, key) {
        const b = settlement && settlement.lotBook;
        return (b && b.vacancies && b.vacancies[key]) || null;
    },

    /** What a lot of w × h costs in a place of this type. */
    lotPrice(type, w, h) {
        return Math.round(_num(this.byType('pricePerTile', type), 2) * Math.max(1, w) * Math.max(1, h));
    },

    /** What a house the player raises on a lot costs, and how many days it takes. */
    houseCost(type) { return Math.max(1, Math.round(_num((this.config().houseBuild.cost || {})[type] ?? (this.config().houseBuild.cost || {}).village, 200))); },
    houseDays(type) { return Math.max(0, Math.round(_num((this.config().houseBuild.days || {})[type] ?? (this.config().houseBuild.days || {}).village, 10))); },

    rentPerDay(type) { return Math.max(1, Math.round(_num(this.byType('rentPerDay', type), 2))); },
    salePrice(type) { return Math.max(1, Math.round(_num(this.byType('salePrice', type), 300))); },

    /** The ids a town's lots carry (lot0 … lotN-1 for the count its type plans). */
    lotIds(type) {
        const n = Math.max(0, Math.round(_num(this.byType('count', type), 0)));
        return Array.from({ length: n }, (_, i) => `lot${i}`);
    },

    isPlayer(rec) { return !!rec && rec.holder === 'player'; },
};

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
    houseBuild: { cost: { village: 110, town: 230, city: 420, capital: 600 }, days: { village: 40, town: 50, city: 60, capital: 70 } },
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

    // ──────────── THE PLAYER'S PROPERTIES ON LOTS ────────────
    // A property the player builds in a town (a workshop, a tavern, a farm...) stands on a
    // lot of theirs: property.lotId names it, the lot's built record is { kind: 'property',
    // type, name, by: 'player' }. world/innerMap/lots.js stands it there as a building of
    // its kind (propertyKinds), systems/lots.js finds or buys the lot.

    /** The building kinds (CustomBuildings types) a property of this type stands as, best first; a house at the last. */
    propertyKinds(propType) {
        const m = this.config().propertyKinds || {};
        const t = String(propType || '').toLowerCase();
        const list = Array.isArray(m[t]) ? m[t] : Array.isArray(m.default) ? m.default : ['warehouse'];
        return list.includes('house') ? list.slice() : [...list, 'house'];
    },

    /** The town's lot ids (as last seen on its map, else as its type plans them) with their size. */
    knownLots(settlement) {
        const book = settlement && settlement.lotBook;
        const known = book && book.known && Array.isArray(book.known.lots) ? book.known.lots : null;
        if (known && known.length) return known.map(l => ({ id: l.id, w: _num(l.w, 6), h: _num(l.h, 6) }));
        const type = settlement && settlement.type;
        const wR = this.byType('width', type) || [6, 8], dR = this.byType('depth', type) || [5, 6];
        const w = Math.round((_num(wR[0], 6) + _num(wR[1], 6)) / 2), h = Math.round((_num(dR[0], 6) + _num(dR[1], 6)) / 2);
        return this.lotIds(type).map(id => ({ id, w, h }));
    },

    /** Lots nobody holds: [{ id, w, h, price }]. */
    freeLots(settlement) {
        const lots = (settlement && settlement.lotBook && settlement.lotBook.lots) || {};
        return this.knownLots(settlement).filter(l => !lots[l.id]).map(l => ({ ...l, price: this.lotPrice(settlement && settlement.type, l.w, l.h) }));
    },

    /** The player's own lots here with nothing on them: [id]. */
    bareLotsOfPlayer(settlement) {
        const lots = (settlement && settlement.lotBook && settlement.lotBook.lots) || {};
        return Object.keys(lots).filter(id => this.isPlayer(lots[id]) && !lots[id].built);
    },

    /**
     * The player's property now stands on this lot (taken for them if no one holds it).
     * → true, or false when someone else holds the lot.
     */
    bindProperty(settlement, lotId, property, day = 0, holderName = 'You') {
        const book = this.of(settlement);
        if (!book || !lotId) return false;
        let rec = book.lots[lotId];
        if (rec && !this.isPlayer(rec)) return false;
        if (!rec) rec = book.lots[lotId] = { holder: 'player', holderName, price: 0, day, built: null };
        rec.built = { type: property && property.type, name: property && property.name, kind: 'property', by: 'player', readyDay: day };
        if (property) property.lotId = lotId;
        return true;
    },

    /** Is a lot's record the player's property (not a house to let, nor graves, a bone mill, an ossuary)? */
    isPropertyBuild(rec) {
        const b = rec && rec.built;
        if (!b || b.by !== 'player') return false;
        return b.kind === 'property' || b.kind == null;
    },
};

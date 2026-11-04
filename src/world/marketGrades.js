// ============================================
// MARKET GRADES — the craftsmanship of a town, and its stalls by grade
// ============================================
// Every town's craftsmen have a level for each good they make (0..10):
//   the settlement type's level (data/craftGrades.json market.typeLevel)
//   + a fixed local knack (±knack, hashed from the town's name and place:
//     towns differ, and stay as they are)
//   + a guild that guards the good there (settlement.guilds)
//   + perWorksLevel × the level of the player's works that make it
//     (settlement.market.works, systems/merchantPrince.js).
//
// A market's stock of a gradeable good comes in grades: mostly Common, some
// Poor and some Fine; Excellent and Masterwork are rare, and only where the
// craftsmen are good. The graded lots are kept on the market
// (settlement.market.grades = { p: period, l: { goodId: [poor, fine,
// excellent, masterwork] } }, saved with the tile) and restocked from the
// stock on hand every restockDays; Common is the rest of the stock. Buying a
// grade takes from its lot, selling a graded good adds to it, and the lots
// never outnumber the stock (units the town eats or ships go Common first,
// then Poor...).
//
// Pure and RNG-free like the rest of the market model: the odd Excellent
// piece on a stall comes from a hash of the town, the good and the week.

import { Grades } from '../core/grades.js';
import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;
const LOT_IDS = ['poor', 'fine', 'excellent', 'masterwork'];

/** A stable hash of a string to [0, 1). */
function _hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

function _key(s) {
    return `${(s && s.name) || ''}@${_num(s && s.q)},${_num(s && s.r)}`;
}

export const MarketGrades = {
    _hash01,

    /** data/craftGrades.json market (with defaults). */
    config() {
        const d = Grades.data() || {};
        return {
            typeLevel: { village: 2, town: 3.5, city: 4.5, capital: 5.5 },
            knack: 1.5, guild: 1, perWorksLevel: 0.6,
            poorBase: 0.26, poorPerLevel: 0.03, poorMin: 0.02,
            fineBase: 0.05, finePerLevel: 0.03,
            excellentPerLevel: 0.008, excellentFrom: 2,
            masterworkPerLevel: 0.004, masterworkFrom: 5,
            restockDays: 7, labels: [],
            ...(d.market || {}),
        };
    },

    /** The town's own knack, −1..1 (fixed by its name and place). */
    knack(settlement) {
        return _hash01(`knack:${_key(settlement)}`) * 2 - 1;
    },

    /** Does a guild in this town guard `goodId` (data/guilds.json)? */
    _guildGuards(settlement, goodId) {
        const gs = settlement && settlement.guilds;
        if (!gs || typeof gs !== 'object') return false;
        const defs = DataLoader._gamedata && DataLoader._gamedata.guilds && DataLoader._gamedata.guilds.guilds;
        if (!defs) return false;
        for (const gid of Object.keys(gs)) {
            const d = defs[gid];
            if (d && Array.isArray(d.goods) && d.goods.includes(goodId)) return true;
        }
        return false;
    },

    /** The best level of the player's works in town that make `goodId` (0 when none). */
    _worksLevel(settlement, goodId) {
        const works = settlement && settlement.market && settlement.market.works;
        if (!works || typeof works !== 'object') return 0;
        const recipes = (DataLoader._gamedata && DataLoader._gamedata.markets && DataLoader._gamedata.markets.recipes) || [];
        let best = 0;
        for (const [rid, w] of Object.entries(works)) {
            const rc = recipes.find(r => r && r.id === rid);
            if (rc && rc.out && goodId in rc.out) best = Math.max(best, _num(w && w.lvl));
        }
        return best;
    },

    /**
     * The town's craftsmanship for `goodId` (or in general when no good is
     * named), 0..10.
     */
    level(settlement, goodId = null) {
        if (!settlement) return 0;
        const C = MarketGrades.config();
        let lvl = _num(C.typeLevel[settlement.type], _num(C.typeLevel.village, 2));
        lvl += MarketGrades.knack(settlement) * _num(C.knack);
        if (goodId) {
            if (MarketGrades._guildGuards(settlement, goodId)) lvl += _num(C.guild);
            lvl += MarketGrades._worksLevel(settlement, goodId) * _num(C.perWorksLevel);
        }
        return _r2(_clamp(lvl, 0, 10));
    },

    /** The word for a level ({ name, color }). */
    label(level) {
        const labels = MarketGrades.config().labels || [];
        let out = { name: 'Plain', color: '#d6d2c8' };
        for (const l of labels) if (level >= _num(l.min)) out = l;
        return out;
    },

    /** Shares of a stock in each non-Common grade at a craft level: { poor, fine, excellent, masterwork }. */
    mix(level) {
        const C = MarketGrades.config();
        const L = _clamp(_num(level), 0, 10);
        return {
            poor: _r2(Math.max(_num(C.poorMin), _num(C.poorBase) - _num(C.poorPerLevel) * L)),
            fine: _r2(Math.max(0, _num(C.fineBase) + _num(C.finePerLevel) * L)),
            excellent: Math.round(Math.max(0, _num(C.excellentPerLevel) * (L - _num(C.excellentFrom))) * 1000) / 1000,
            masterwork: Math.round(Math.max(0, _num(C.masterworkPerLevel) * (L - _num(C.masterworkFrom))) * 1000) / 1000,
        };
    },

    /** The restocking period a day falls in. */
    period(day) {
        return Math.floor(_num(day) / Math.max(1, _num(MarketGrades.config().restockDays, 7)));
    },

    /**
     * The graded lots of `goodId` on the stalls today, out of `available`
     * whole units (the market's stock, or the fixed stall stock of a good the
     * town doesn't keep). → { poor, fine, excellent, masterwork, common }.
     * Restocks the lots at the turn of a period.
     */
    lots(settlement, goodId, available, day = 0) {
        const out = { poor: 0, fine: 0, excellent: 0, masterwork: 0, common: Math.max(0, Math.floor(_num(available))) };
        if (!settlement || !Grades.gradeable(goodId)) return out;
        const m = settlement.market;
        if (!m || typeof m !== 'object') return out;
        const p = MarketGrades.period(day);
        if (!m.grades || typeof m.grades !== 'object' || m.grades.p !== p) m.grades = { p, l: {} };
        const S = out.common;
        let lot = m.grades.l[goodId];
        if (!Array.isArray(lot)) {
            const mix = MarketGrades.mix(MarketGrades.level(settlement, goodId));
            lot = LOT_IDS.map(id => Math.floor(S * mix[id] + _hash01(`lot:${_key(settlement)}:${goodId}:${p}:${id}`)));
            m.grades.l[goodId] = lot;
        }
        // Never more graded units than the stock: the town used the Common ones first, then the Poor...
        let over = lot.reduce((s, v) => s + v, 0) - S;
        for (let i = 0; i < lot.length && over > 0; i++) {
            const cut = Math.min(over, lot[i]);
            lot[i] -= cut;
            over -= cut;
        }
        LOT_IDS.forEach((id, i) => { out[id] = lot[i]; });
        out.common = Math.max(0, S - lot.reduce((s, v) => s + v, 0));
        return out;
    },

    /** A buyer took `n` units of a grade's lot (the caller takes the stock itself). */
    take(settlement, goodId, n, grade) {
        const lot = settlement && settlement.market && settlement.market.grades && settlement.market.grades.l && settlement.market.grades.l[goodId];
        const i = LOT_IDS.indexOf(Grades.get(grade).id);
        if (!Array.isArray(lot) || i < 0) return 0;
        const got = Math.min(lot[i], Math.max(0, Math.floor(_num(n))));
        lot[i] -= got;
        return got;
    },

    /** A seller put `n` units of a grade on the stalls (the caller adds the stock). */
    add(settlement, goodId, n, grade, day = 0, available = 0) {
        const i = LOT_IDS.indexOf(Grades.get(grade).id);
        if (!settlement || !settlement.market || i < 0 || !(n > 0) || !Grades.gradeable(goodId)) return;
        // (this period's lots first, from the stock before the sale)
        MarketGrades.lots(settlement, goodId, available, day);
        settlement.market.grades.l[goodId][i] += Math.floor(n);
    },
};

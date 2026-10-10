// ============================================
// CROWN BOOKS — the crowns' budget lines, kept where every layer can write them
// ============================================
// The read/write side of the Crown's Purse (systems/fiscal.js runs the day):
// each realm's books live on kingdom.fisc — today's revenue and expense lines,
// the arrears owed to soldiers and officials, corruption, the crown's demesne
// and its tax levels. Systems that move a treasury for a reason the budget
// shows (customs, seigniorage, road upkeep, debt service, the dole) call
// `note(kingdom, line, amount)` beside the move, so the Treasury panel can show
// every line and the rest of the day's change lands under 'Other'.
//
// Kept in the world layer (no imports above core/) so world/kingdomAI.js,
// world/moneySupply.js, world/transport.js and world/kingdomState.js can book
// and read it without reaching up into systems/. Pure data: no RNG.
// Tuned in data/fiscal.json; with enabled: false every reader is neutral.

import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;

/** Revenue lines, in the order the panel shows them. */
export const REVENUE_LINES = ['land', 'poll', 'excise', 'customs', 'demesne', 'seigniorage', 'farms', 'levy', 'sales'];
/** Expense lines. */
export const EXPENSE_LINES = ['army', 'court', 'works', 'debt', 'dole', 'purse'];
/** Financing (not income): borrowing and the mint's debasement profit. */
export const FINANCE_LINES = ['loans', 'debase'];

const LEVELS = ['light', 'standard', 'heavy', 'crushing'];
/** Version of the books' shape (a record at this version needs no backfill). */
const STATE_V = 1;

const DEFAULTS = {
    enabled: true,
    levels: {
        light: { label: 'Light', icon: '🍃', mult: 0.75 },
        standard: { label: 'Standard', icon: '⚖️', mult: 1 },
        heavy: { label: 'Heavy', icon: '💰', mult: 1.3 },
        crushing: { label: 'Crushing', icon: '⛓️', mult: 1.65 },
    },
    burden: { base: 0.15, weights: { land: 0.5, poll: 0.25, excise: 0.25 }, farmPerSqueeze: 0.3, corruption: 0.03 },
    stability: { perLevel: 12, arrearsPerDay: 0.4, arrearsCap: 10, corruption: 10 },
    army: {
        levels: {
            half: { label: 'Half pay', mult: 0.6, cap: 0.88, stability: -2 },
            full: { label: 'Full pay', mult: 1, cap: 1, stability: 0 },
            generous: { label: 'Generous', mult: 1.25, cap: 1.05, stability: 1 },
        },
        desert: { afterDays: 7, capPerDay: 0.012, capMin: 0.6 },
    },
    court: {
        levels: {
            frugal: { label: 'Frugal', mult: 0.7, corruption: 0.002, stability: 0 },
            standard: { label: 'Standard', mult: 1, corruption: 0, stability: 0 },
            lavish: { label: 'Lavish', mult: 1.4, corruption: 0, stability: 1.5 },
        },
    },
    demesne: { share: 0.2, min: 0.05 },
    corruption: { officesSale: 0.12 },
    crisis: { offices: { days: 20 }, land: { days: 120, share: 0.3 } },
};

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = _obj(v) && _obj(base[k]) ? _merge(base[k], v) : v;
    }
    return out;
}

let _src;
let _cfg = null;

export const CrownBooks = {
    REVENUE_LINES,
    EXPENSE_LINES,
    FINANCE_LINES,
    LEVELS,

    /** data/fiscal.json merged over the defaults (cached per gamedata). */
    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.fiscal) || null;
        if (!_cfg || d !== _src) {
            _src = d;
            _cfg = _merge(DEFAULTS, d || {});
        }
        return _cfg;
    },

    enabled() {
        return CrownBooks.config().enabled !== false;
    },

    _blankLines() {
        const o = {};
        for (const l of REVENUE_LINES) o[l] = 0;
        for (const l of EXPENSE_LINES) o[l] = 0;
        for (const l of FINANCE_LINES) o[l] = 0;
        o.other = 0;
        return o;
    },

    /** kingdom.fisc, created (or backfilled for an old save) when missing. */
    state(kingdom) {
        if (!kingdom) return null;
        const cur = kingdom.fisc;
        // (checked once per record: the books are read and written many times a day)
        if (cur && cur._v === STATE_V && cur.day && cur.rates) return cur;
        let f = _obj(cur);
        if (!f) f = kingdom.fisc = {};
        if (!LEVELS.includes(f.level)) f.level = 'standard';
        if (!_obj(f.rates)) f.rates = { land: f.level, poll: f.level, excise: f.level };
        for (const l of ['land', 'poll', 'excise']) if (!LEVELS.includes(f.rates[l])) f.rates[l] = f.level;
        if (!CrownBooks.config().army.levels[f.armyPay]) f.armyPay = 'full';
        if (!CrownBooks.config().court.levels[f.courtLevel]) f.courtLevel = 'standard';
        if (!_obj(f.day)) f.day = CrownBooks._blankLines();
        if (!_obj(f.last)) f.last = CrownBooks._blankLines();
        if (!_obj(f.week)) f.week = CrownBooks._blankLines();
        if (!_obj(f.lastWeek)) f.lastWeek = CrownBooks._blankLines();
        if (!_obj(f.arrears)) f.arrears = { army: 0, court: 0 };
        f.arrearsDays = Math.max(0, Math.floor(_num(f.arrearsDays)));
        f.corruption = _clamp(_num(f.corruption), 0, 1);
        f.demesne = _clamp(_num(f.demesne, CrownBooks.config().demesne.share), 0, 1);
        if (!_obj(f.avg)) f.avg = { rev: 0, exp: 0 };
        f.deficitWeeks = Math.max(0, Math.floor(_num(f.deficitWeeks)));
        if (!Array.isArray(f.hist)) f.hist = [];
        if (!_obj(f.towns)) f.towns = {};
        if (!_obj(f.stats)) f.stats = { revenue: 0, expense: 0, revolts: 0, farmsSold: 0, officesSold: 0, landSold: 0, deserted: 0 };
        f._v = STATE_V;
        return f;
    },

    /**
     * Book an amount on one of the crown's lines (revenue and expense lines
     * take positive amounts; the treasury itself is moved by the caller).
     */
    note(kingdom, line, amount) {
        const a = _num(amount);
        if (!kingdom || !a || !CrownBooks.enabled()) return 0;
        const f = CrownBooks.state(kingdom);
        f.day[line] = _r2(_num(f.day[line]) + a);
        return a;
    },

    /** Today's books so far, or yesterday's closed ones. */
    lines(kingdom, which = 'last') {
        const f = kingdom && _obj(kingdom.fisc);
        return (f && _obj(f[which])) || CrownBooks._blankLines();
    },

    /** Sum of the revenue lines (taxes and dues, not borrowing) of a line set. */
    revenue(lines) {
        let s = 0;
        for (const l of REVENUE_LINES) s += _num(lines && lines[l]);
        return s;
    },

    expense(lines) {
        let s = 0;
        for (const l of EXPENSE_LINES) s += _num(lines && lines[l]);
        return s;
    },

    /** The crown's taxes and dues a day, smoothed (yesterday's until there is an average): the royal levy's base. */
    lastRevenue(kingdom) {
        const f = kingdom && _obj(kingdom.fisc);
        if (f && f.avg && _num(f.avg.n) > 0) return Math.max(0, _num(f.avg.rev));
        return CrownBooks.revenue(CrownBooks.lines(kingdom, 'last'));
    },

    levelMult(id) {
        const L = CrownBooks.config().levels[id];
        return L ? _num(L.mult, 1) : 1;
    },

    /** The realm's mean tax level (1 = standard), weighted over land, poll and excise. */
    taxIndex(kingdom) {
        const f = kingdom && _obj(kingdom.fisc);
        if (!f || !_obj(f.rates)) return 1;
        const W = CrownBooks.config().burden.weights;
        let s = 0, w = 0;
        for (const l of ['land', 'poll', 'excise']) {
            const wt = _num(W[l], 1 / 3);
            s += wt * CrownBooks.levelMult(f.rates[l]);
            w += wt;
        }
        return w > 0 ? s / w : 1;
    },

    /**
     * The tax burden the people of a realm town feel, on the labour model's
     * scale (0.15 = the customary dues; world/townLabour.js welfare reads
     * (rate − 0.15)): the realm's level, a tax farmer's squeeze, the
     * officials' extortion. null when the books are off.
     */
    burden(kingdom, squeeze = 1) {
        if (!kingdom || !CrownBooks.enabled()) return null;
        const B = CrownBooks.config().burden;
        const f = _obj(kingdom.fisc);
        const corr = f ? _num(f.corruption) : 0;
        return _r2(_num(B.base, 0.15) * CrownBooks.taxIndex(kingdom)
            + Math.max(0, squeeze - 1) * _num(B.farmPerSqueeze, 0.3) + corr * _num(B.corruption, 0.03));
    },

    /** Stability target term (KingdomStability.target): tax levels, unpaid soldiers, corruption, court. 0 when off. */
    stabilityMod(kingdom) {
        if (!kingdom || !CrownBooks.enabled()) return 0;
        const f = _obj(kingdom.fisc);
        if (!f) return 0;
        const S = CrownBooks.config().stability;
        let m = -(CrownBooks.taxIndex(kingdom) - 1) * _num(S.perLevel, 12);
        m -= Math.min(_num(S.arrearsCap, 10), _num(f.arrearsDays) * _num(S.arrearsPerDay, 0.4));
        m -= _num(f.corruption) * _num(S.corruption, 10);
        const A = CrownBooks.config().army.levels[f.armyPay];
        const Ct = CrownBooks.config().court.levels[f.courtLevel];
        m += _num(A && A.stability) + _num(Ct && Ct.stability);
        return Math.round(m * 100) / 100;
    },

    /**
     * Multiplier on the standing army a realm can keep (KingdomAI.updateMilitary):
     * soldiers unpaid for more than a week desert, a little more each day.
     */
    armyFactor(kingdom) {
        if (!kingdom || !CrownBooks.enabled()) return 1;
        const f = _obj(kingdom.fisc);
        if (!f) return 1;
        const A = CrownBooks.config().army;
        const lv = A.levels[f.armyPay] || A.levels.full;
        const D = A.desert;
        const late = Math.max(0, _num(f.arrearsDays) - _num(D.afterDays, 7));
        return _clamp(_num(lv.cap, 1) * (1 - late * _num(D.capPerDay, 0.012)), _num(D.capMin, 0.6), 1.2);
    },

    /** Sell offices: a lump of `days` of revenue now, corruption for years. Returns the gold raised. */
    sellOffices(kingdom) {
        if (!kingdom || !CrownBooks.enabled()) return 0;
        const f = CrownBooks.state(kingdom);
        const C = CrownBooks.config();
        const gain = Math.round(Math.max(_num(f.avg.rev), 50) * _num(C.crisis.offices.days, 20));
        f.corruption = _clamp(f.corruption + _num(C.corruption.officesSale, 0.12), 0, 1);
        kingdom.treasury = _num(kingdom.treasury) + gain;
        CrownBooks.note(kingdom, 'sales', gain);
        f.stats.officesSold = _num(f.stats.officesSold) + 1;
        return gain;
    },

    /**
     * Sell crown land: `share` of the demesne goes to the houses for `days` of
     * what it yields. Returns the gold raised (0 when little demesne is left).
     */
    sellLand(kingdom) {
        if (!kingdom || !CrownBooks.enabled()) return 0;
        const f = CrownBooks.state(kingdom);
        const C = CrownBooks.config();
        if (f.demesne <= _num(C.demesne.min, 0.05) + 1e-9) return 0;
        const sold = f.demesne * _num(C.crisis.land.share, 0.3);
        const yieldDay = Math.max(_num(f.avg.demesne), 5) * (sold / Math.max(0.01, f.demesne));
        const gain = Math.round(yieldDay * _num(C.crisis.land.days, 120));
        f.demesne = _clamp(f.demesne - sold, 0, 1);
        kingdom.treasury = _num(kingdom.treasury) + gain;
        CrownBooks.note(kingdom, 'sales', gain);
        f.stats.landSold = _num(f.stats.landSold) + 1;
        return gain;
    },
};

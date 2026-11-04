// ============================================
// GRADES — the quality of made goods (Poor → Masterwork)
// ============================================
// Five grades (data/craftGrades.json): poor, common, fine, excellent,
// masterwork. Each has a price multiplier (what a unit fetches and costs
// against a Common one) and an effect multiplier (nourishment, healing,
// protection, a blade's cut, how long clothes stay fresh...).
//
// The inventory stays { goodId: qty } for every system that reads it. The
// units of a stack that are NOT Common are counted beside it:
//
//   holder.craftGrades[goodId] = { poor: n, fine: n, excellent: n, masterwork: n }
//
// and Common is whatever is left (qty − the graded units). So anything that
// adds goods the plain way adds Common goods, and anything that takes goods
// the plain way is reconciled lazily: Common units go first, then Poor, then
// the better grades (reconcile). Code that knows about grades draws them
// explicitly with take() BEFORE it decrements the inventory, and records
// graded additions with add() AFTER it increments it.
//
// A holder is anything shaped { inventory, craftGrades } (the player, a
// test stub). Old saves' averaged record (holder.craftQuality = { n, t } on
// the old four tiers) is converted on first touch (migrate).
//
// Pure: no game state, no domain globals; the only randomness (roll) comes
// from the seeded Utils RNG.

import { DataLoader } from './dataLoader.js';
import { Utils } from './utils.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;

export const GRADE_IDS = ['poor', 'common', 'fine', 'excellent', 'masterwork'];
export const COMMON = 1;
/** The graded (non-Common) ids in the order plain removals use them up. */
const TRIM_ORDER = ['poor', 'fine', 'excellent', 'masterwork'];
const ORDERS = {
    // what you eat, wield, wear or work with: the best first
    best: ['masterwork', 'excellent', 'fine', 'common', 'poor'],
    // what you sell without naming a grade: ordinary stock first, the prized kept
    sale: ['common', 'poor', 'fine', 'excellent', 'masterwork'],
    worst: ['poor', 'common', 'fine', 'excellent', 'masterwork'],
};

const DEFAULT_GRADES = [
    { id: 'poor', name: 'Poor', icon: '🟤', color: '#b08968', price: 0.6, effect: 0.8, below: 0.6 },
    { id: 'common', name: 'Common', icon: '⚪', color: '#d6d2c8', price: 1, effect: 1, below: 1.7 },
    { id: 'fine', name: 'Fine', icon: '🔵', color: '#5dade2', price: 1.4, effect: 1.2, below: 2.6 },
    { id: 'excellent', name: 'Excellent', icon: '🟣', color: '#c39bd3', price: 2, effect: 1.4, below: 3.4 },
    { id: 'masterwork', name: 'Masterwork', icon: '🌟', color: '#f5c542', price: 3, effect: 1.65, below: null },
];

let _src;
let _cfg = null;

function _build(d) {
    const src = d && typeof d === 'object' ? d : {};
    const byId = {};
    for (const g of DEFAULT_GRADES) byId[g.id] = { ...g };
    for (const g of Array.isArray(src.grades) ? src.grades : []) {
        if (g && byId[g.id]) byId[g.id] = { ...byId[g.id], ...g };
    }
    const grades = GRADE_IDS.map((id, i) => ({ ...byId[id], index: i }));
    // Goods that come in grades: the crafting recipes' products and the listed extras
    const gradeable = new Set(Array.isArray(src.extraGradeable) ? src.extraGradeable : []);
    const crafting = DataLoader._gamedata && DataLoader._gamedata.crafting;
    for (const r of (crafting && Array.isArray(crafting.recipes)) ? crafting.recipes : []) {
        if (!r || r.quality === false || !r.result) continue;
        for (const id of Object.keys(r.result)) gradeable.add(id);
    }
    return { src, grades, byId: Object.fromEntries(grades.map(g => [g.id, g])), gradeable };
}

export const Grades = {
    GRADE_IDS,
    COMMON,

    /** The built config (data/craftGrades.json over the defaults), rebuilt when the data changes. */
    config() {
        const gd = DataLoader._gamedata;
        const d = gd ? gd.craftGrades : undefined;
        const crafting = gd ? gd.crafting : undefined;
        if (!_cfg || d !== _src || crafting !== _cfg.crafting) {
            _src = d;
            _cfg = _build(d);
            _cfg.crafting = crafting;
        }
        return _cfg;
    },

    /** The raw data file (for the sections other modules read: skills, roll, market...). */
    data() {
        return Grades.config().src;
    },

    /** Every grade, worst to best: [{ id, name, icon, color, price, effect, below, index }]. */
    list() {
        return Grades.config().grades;
    },

    /** A grade by id or index (Common for anything unknown). */
    get(g) {
        const C = Grades.config();
        if (typeof g === 'number' && Number.isFinite(g)) return C.grades[_clamp(Math.round(g), 0, C.grades.length - 1)];
        return C.byId[g] || C.grades[COMMON];
    },

    /** Index 0 (poor) … 4 (masterwork) of a grade id (Common for unknown). */
    index(id) {
        const g = Grades.config().byId[id];
        return g ? g.index : COMMON;
    },

    isGrade(id) {
        return !!Grades.config().byId[id];
    },

    priceMult(g) {
        return _num(Grades.get(g).price, 1);
    },

    effectMult(g) {
        return _num(Grades.get(g).effect, 1);
    },

    /** Does this good come in grades? */
    gradeable(goodId) {
        return Grades.config().gradeable.has(goodId);
    },

    // ── Rolling a grade ─────────────────────────────────

    /** The grade index a quality score lands on. */
    indexOfScore(score) {
        const gs = Grades.list();
        for (let i = 0; i < gs.length; i++) {
            if (gs[i].below == null || score < gs[i].below) return i;
        }
        return gs.length - 1;
    },

    /**
     * The odds of each grade (array of 5, summing to 1) for a quality score
     * with triangular noise of ±noise (the sum of two uniform draws).
     */
    distribution(score, noise) {
        const gs = Grades.list();
        const out = new Array(gs.length).fill(0);
        const n = Math.max(0, _num(noise));
        if (!(n > 0)) {
            out[Grades.indexOfScore(score)] = 1;
            return out;
        }
        // CDF of the triangular distribution on [-n, n]
        const cdf = (x) => {
            const t = _clamp(x, -n, n);
            return t <= 0 ? (t + n) * (t + n) / (2 * n * n) : 1 - (n - t) * (n - t) / (2 * n * n);
        };
        let prev = 0;
        for (let i = 0; i < gs.length; i++) {
            const hi = gs[i].below == null ? 1 : cdf(gs[i].below - score);
            out[i] = Math.max(0, hi - prev);
            prev = Math.max(prev, hi);
        }
        return out.map(_r2);
    },

    /** Roll a grade index for a quality score: ±noise triangular, from the seeded RNG. */
    roll(score, noise) {
        const n = Math.max(0, _num(noise));
        const jitter = n > 0 ? (Utils.random() + Utils.random() - 1) * n : 0;
        return Grades.indexOfScore(score + jitter);
    },

    // ── Graded stacks held ──────────────────────────────

    /** Convert an old save's averaged record (craftQuality { n, t } on crude/common/fine/masterwork). */
    migrate(holder) {
        if (!holder || !holder.craftQuality || typeof holder.craftQuality !== 'object') return;
        const old = holder.craftQuality;
        delete holder.craftQuality;
        for (const [item, rec] of Object.entries(old)) {
            const n = Math.round(_num(rec && rec.n));
            if (!(n > 0)) continue;
            const avg = _clamp(_num(rec.t) / _num(rec.n, 1), 0, 3);
            const book = Grades._book(holder, true);
            const e = book[item] || (book[item] = {});
            if (avg < 1) e.poor = _num(e.poor) + Math.round(n * (1 - avg));
            else if (avg <= 2) e.fine = _num(e.fine) + Math.round(n * (avg - 1));
            else {
                const mw = Math.round(n * (avg - 2));
                e.masterwork = _num(e.masterwork) + mw;
                e.fine = _num(e.fine) + (n - mw);
            }
            Grades.reconcile(holder, item);
        }
    },

    _book(holder, create = false) {
        if (!holder) return null;
        if (holder.craftQuality) Grades.migrate(holder);
        let b = holder.craftGrades;
        if (!b || typeof b !== 'object') {
            if (!create) return null;
            b = holder.craftGrades = {};
        }
        return b;
    },

    _held(holder, item) {
        return Math.max(0, Math.floor(_num(holder && holder.inventory && holder.inventory[item]) + 1e-9));
    },

    /**
     * Keep the graded units within what is held: units taken the plain way
     * (eaten by an army, stolen, spoiled...) were Common first, then Poor,
     * then the better grades.
     */
    reconcile(holder, item) {
        const book = Grades._book(holder);
        const e = book && book[item];
        if (!e) return;
        let over = TRIM_ORDER.reduce((s, id) => s + Math.max(0, Math.floor(_num(e[id]))), 0) - Grades._held(holder, item);
        for (const id of TRIM_ORDER) {
            e[id] = Math.max(0, Math.floor(_num(e[id])));
            if (over > 0 && e[id] > 0) {
                const cut = Math.min(over, e[id]);
                e[id] -= cut;
                over -= cut;
            }
            if (!(e[id] > 0)) delete e[id];
        }
        if (!Object.keys(e).length) delete book[item];
    },

    /** { poor, common, fine, excellent, masterwork } units of `item` held. */
    counts(holder, item) {
        Grades.reconcile(holder, item);
        const book = Grades._book(holder);
        const e = (book && book[item]) || {};
        const held = Grades._held(holder, item);
        const out = { poor: 0, common: 0, fine: 0, excellent: 0, masterwork: 0 };
        let graded = 0;
        for (const id of TRIM_ORDER) { out[id] = _num(e[id]); graded += out[id]; }
        out.common = Math.max(0, held - graded);
        return out;
    },

    /** Does the holder carry any non-Common units of `item`? */
    hasGraded(holder, item) {
        const c = Grades.counts(holder, item);
        return c.poor + c.fine + c.excellent + c.masterwork > 0;
    },

    /** Every good the holder carries graded units of. */
    gradedItems(holder) {
        const book = Grades._book(holder);
        if (!book) return [];
        return Object.keys(book).filter(id => Grades.hasGraded(holder, id));
    },

    /**
     * Note `qty` units of `item` just added to the inventory at `grade` (id or
     * index). Call AFTER the inventory went up. Common needs no record.
     */
    add(holder, item, qty, grade) {
        const n = Math.floor(_num(qty));
        if (!holder || !(n > 0)) return;
        const g = Grades.get(grade);
        if (g.id === 'common') { Grades.reconcile(holder, item); return; }
        // (units added before were Common: those beyond the record stay Common)
        const book = Grades._book(holder, true);
        const e = book[item] || (book[item] = {});
        e[g.id] = _num(e[g.id]) + n;
        Grades.reconcile(holder, item);
    },

    /** Note a mix { gradeId: n } just added (Grades.take's `drawn`, a market lot...). */
    addMix(holder, item, mix) {
        for (const [id, n] of Object.entries(mix || {})) if (n > 0) Grades.add(holder, item, n, id);
    },

    /**
     * Which units `qty` of `item` would be (opts.grade: only that grade;
     * else in opts.order: 'best' | 'sale' | 'worst'). → { drawn: { id: n },
     * n, price, effect, index } — price/effect/index the averages over the
     * units drawn (1/1/Common when none). Changes nothing.
     */
    peek(holder, item, qty, opts = {}) {
        const c = Grades.counts(holder, item);
        let left = Math.max(0, Math.floor(_num(qty)));
        const drawn = {};
        const order = opts.grade ? [Grades.get(opts.grade).id] : (ORDERS[opts.order] || ORDERS.best);
        for (const id of order) {
            if (left <= 0) break;
            const k = Math.min(left, c[id]);
            if (k > 0) { drawn[id] = k; left -= k; }
        }
        let n = 0, price = 0, effect = 0, index = 0;
        for (const [id, k] of Object.entries(drawn)) {
            const g = Grades.get(id);
            n += k; price += k * g.price; effect += k * g.effect; index += k * g.index;
        }
        return n > 0
            ? { drawn, n, price: _r2(price / n), effect: _r2(effect / n), index: _r2(index / n) }
            : { drawn, n: 0, price: 1, effect: 1, index: COMMON };
    },

    /**
     * Take `qty` units of `item` out of the grade record (as peek). Call
     * BEFORE the inventory goes down by the same qty.
     */
    take(holder, item, qty, opts = {}) {
        const res = Grades.peek(holder, item, qty, opts);
        const book = Grades._book(holder);
        const e = book && book[item];
        if (e) {
            for (const [id, k] of Object.entries(res.drawn)) {
                if (id === 'common') continue;
                e[id] = Math.max(0, _num(e[id]) - k);
                if (!(e[id] > 0)) delete e[id];
            }
            if (!Object.keys(e).length) delete book[item];
        }
        // (a draw of Common units from a stack that also holds graded ones: the
        // inventory falls next, and the graded units must not be trimmed for it)
        return res;
    },

    /** Take and remove from the inventory in one go → as take(). */
    remove(holder, item, qty, opts = {}) {
        const res = Grades.take(holder, item, qty, opts);
        const inv = holder && holder.inventory;
        if (inv) {
            inv[item] = _num(inv[item]) - res.n;
            if (!(inv[item] > 0)) delete inv[item];
        }
        return res;
    },

    /** The best grade index held of `item` (null when none is held). */
    bestIndex(holder, item) {
        const c = Grades.counts(holder, item);
        for (let i = GRADE_IDS.length - 1; i >= 0; i--) if (c[GRADE_IDS[i]] > 0) return i;
        return null;
    },

    /** The best grade held of any of `items` → { item, index } or null. */
    bestOf(holder, items) {
        let best = null;
        for (const id of items || []) {
            const i = Grades.bestIndex(holder, id);
            if (i != null && (!best || i > best.index)) best = { item: id, index: i };
        }
        return best;
    },

    /** The held stack by grade, best first, only grades held: [{ ...grade, n }]. */
    summary(holder, item) {
        const c = Grades.counts(holder, item);
        return Grades.list().filter(g => c[g.id] > 0).map(g => ({ ...g, n: c[g.id] })).reverse();
    },

    /**
     * A short text tag for the held stack ('🔵 Fine', '2 Fine · 1 Poor'), or
     * '' when it is all Common (or not held).
     */
    tag(holder, item) {
        if (!Grades.hasGraded(holder, item)) return '';
        const s = Grades.summary(holder, item);
        if (s.length === 1) return `${s[0].icon} ${s[0].name}`;
        return s.map(g => `${g.n} ${g.name}`).join(' · ');
    },

    /** The same as coloured HTML chips (UI). '' when all Common. */
    tagHtml(holder, item) {
        if (!Grades.hasGraded(holder, item)) return '';
        return Grades.summary(holder, item)
            .map(g => `<span style="color:${g.color};font-size:11px;white-space:nowrap" title="${g.name}: ×${g.price} price, ×${g.effect} effect">${g.icon} ${g.n} ${g.name}</span>`)
            .join(' ');
    },

    /** A coloured label for one grade (UI). */
    labelHtml(g, extra = '') {
        const gr = Grades.get(g);
        return `<span style="color:${gr.color};font-weight:600;white-space:nowrap" title="${gr.name}: ×${gr.price} price, ×${gr.effect} effect">${gr.icon} ${gr.name}${extra}</span>`;
    },
};

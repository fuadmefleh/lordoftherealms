// ============================================
// THE BOURSE — shares in the houses, the banks and the chartered companies
// ============================================
// An exchange sits in each of the greatest capitals (data/bourse.json →
// bourse.exchanges; picked by population, no RNG). On it trade shares in:
//   house    the rival merchant houses (systems/merchantHouses.js): 100
//            shares each; book value is the house's capital, profit its
//            weekly return, half paid out as dividends
//   bank     the banking houses (systems/finance.js): 1000 shares; book is
//            the house's equity (reserves + what crowns owe it − deposits
//            − bills it must pay); reserves, runs, crown defaults move it
//   company  the player's own trading company, once floated: outside
//            shareholders take a share of its weekly profit as dividends
//            and of anything the owner draws out
//   venture  a chartered overseas company (systems/discovery.js: new lands
//            known to its crown, colonies; pirates, war and lost fleets)
//   monopoly a crown's monopoly let to a company: its rents follow the realm's
//            trade and prices (world/economyIndex.js), and a crown in debt
//            squeezes it or, defaulting, may revoke it
// Each share's fair value is its book value × a multiple of its return on
// capital. Its price is fair × sentiment (a mean-reverting walk) × the
// market's mood (panics: a house failing, a crown defaulting, war on the
// exchange's realm) × any mania, and the player's own buying and selling
// moves it (impact, fading by the day). Dividends are paid each week from
// real profit. A mania (data-driven, rare) inflates one listing for weeks —
// the company sells new stock into it — then bursts: the price falls below
// fair, the market's mood sours, and the bank that lent on it takes a loss.
// Spies in a listing's realm let the player see its fair value: an edge.
//
// No money loops: a round trip pays the spread, the broker and its own
// impact; a float sells shares below fair and owes dividends; the owner's
// draws pay the outside shareholders their part.
//
// The tick draws from its own seeded stream (Utils.withRng on a hash of the
// seed and the day); player actions draw no randomness. State on
// player.bourse (saved with the player). Tuned in data/bourse.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { EconomyIndex } from '../world/economyIndex.js';
import { Fashions } from '../world/fashions.js';
import { Finance } from './finance.js';
import { MerchantHouses } from './merchantHouses.js';
import { Ledger } from './ledger.js';
import { seededStream } from './underwriting.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;
const _r4 = (v) => Math.round(v * 10000) / 10000;

function _day(world) {
    return world && Number.isFinite(world.day) ? world.day : 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _frac(key) {
    return (_hash(key) % 100000) / 100000;
}

function _between(range, f) {
    if (!Array.isArray(range)) return _num(range);
    const lo = _num(range[0]);
    return lo + (_num(range[1], lo) - lo) * f;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _gauss() {
    const u = Math.max(1e-9, Utils.random());
    const v = Utils.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const YEAR = 120;
const WEEKS = YEAR / 7;

const DEFAULTS = {
    exchanges: 2, hurdle: 0.08, roeSlope: 2.5, minMult: 0.35, maxMult: 2.5, roeWeight: 0.08,
    sentimentVol: 0.018, sentimentRevert: 0.06, moodRevert: 0.04,
    spread: 0.03, commission: 0.01, minCommission: 2, impact: 0.5, impactDecay: 0.85,
    historyWeeks: 26, newsCap: 40, houseShares: 100, bankShares: 1000, ventureShares: 1000,
    bankPayout: 0.5, venturePayout: 0.6, bankLowReserve: 0.8, panicDiscount: 0.55, crisisExposure: 0.5, fashionBonus: 0.12,
    float: { maxOutside: 49, discount: 0.1, fee: 0.03, minValue: 1500, payout: 0.5 },
    ventures: [],
    panics: { bank_failed: 0.85, crown_default: 0.88, war: 0.93, bank_run: 0.95 },
};

let _cfgSrc;
let _cfg = null;
// Records already backfilled this session (the daily tick skips the walk)
const _fresh = new WeakSet();
let _crownCache = null;

export const Bourse = {

    // ──────────── DATA ────────────

    data() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.bourse) || {};
    },

    config() {
        const src = _obj(Bourse.data().bourse);
        if (_cfg && _cfgSrc === src) return _cfg;
        _cfgSrc = src;
        const o = src || {};
        _cfg = {
            ...DEFAULTS, ...o,
            float: { ...DEFAULTS.float, ...(_obj(o.float) || {}) },
            panics: { ...DEFAULTS.panics, ...(_obj(o.panics) || {}) },
            ventures: Array.isArray(o.ventures) ? o.ventures : [],
        };
        return _cfg;
    },

    manias() {
        const m = Bourse.data().manias;
        return Array.isArray(m) ? m : [];
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            initialized: false, exchanges: [], listings: [], holdings: {}, mood: 1, manias: [], history: [],
            seen: {}, wars: {}, nextId: 1, lastDay: null, lastWeek: null,
            stats: { bought: 0, sold: 0, dividends: 0, fees: 0, floated: 0, outsideDividends: 0, buyBacks: 0, payouts: 0 },
        };
    },

    state(player) {
        if (!player) return Bourse._blank();
        let st = player.bourse;
        if (!_obj(st)) { player.bourse = Bourse._blank(); _fresh.add(player.bourse); return player.bourse; }
        if (_fresh.has(st)) return st;
        _fresh.add(st);
        const blank = Bourse._blank();
        if (typeof st.initialized !== 'boolean') st.initialized = false;
        for (const k of ['exchanges', 'listings', 'manias', 'history']) if (!Array.isArray(st[k])) st[k] = [];
        for (const k of ['holdings', 'seen', 'wars']) if (!_obj(st[k])) st[k] = {};
        st.mood = _num(st.mood, 1) || 1;
        if (!(st.nextId > 0)) st.nextId = 1;
        if (st.lastDay === undefined) st.lastDay = null;
        if (st.lastWeek === undefined) st.lastWeek = null;
        st.stats = { ...blank.stats, ...(_obj(st.stats) || {}) };
        for (const l of st.listings) Bourse._backfillListing(l);
        return st;
    },

    _backfillListing(l) {
        for (const k of ['shares', 'book', 'roe', 'fair', 'price', 'impact', 'lastDiv', 'divPaid']) l[k] = _num(l[k]);
        l.sentiment = _num(l.sentiment, 0);
        if (!Array.isArray(l.history)) l.history = [];
        if (!l.status) l.status = 'listed';
        if (l.mania === undefined) l.mania = null;
        return l;
    },

    serialize(player) {
        return player && player.bourse ? JSON.parse(JSON.stringify(player.bourse)) : null;
    },

    loadState(player) {
        if (!player || player.bourse == null) return null;
        return Bourse.state(player);
    },

    // ──────────── SETUP ────────────

    _init(world, player, st) {
        st.initialized = true;
        const C = Bourse.config();
        const seed = _seed(world);
        const all = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : (world.getAllSettlements ? world.getAllSettlements() : []);
        const caps = all.filter(s => s && s.type === 'capital' && s.kingdom != null && Number.isFinite(s.q))
            .map(s => ({ s, score: _num(s.population, 1000) * (0.9 + 0.2 * _frac(`${seed}|bourse|${s.q},${s.r}`)) }))
            .sort((a, b) => b.score - a.score || (a.s.q - b.s.q) || (a.s.r - b.s.r));
        if (!st.exchanges.length) {
            for (const { s } of caps.slice(0, Math.max(1, _num(C.exchanges, 2)))) st.exchanges.push({ q: s.q, r: s.r, name: s.name, kingdomId: s.kingdom });
        }
        // The chartered companies: one of each, chartered by an exchange's crown
        st.exchanges.forEach((ex, i) => {
            const def = C.ventures[i % Math.max(1, C.ventures.length)];
            if (!def || st.listings.some(l => l.defId === def.id && l.kingdomId === ex.kingdomId)) return;
            Bourse._newVenture(world, st, def, ex);
        });
        Bourse._sync(world, player, st);
        for (const l of st.listings) {
            l.fair = Bourse.fairValue(world, player, l);
            l.price = l.fair;
            l.history.push(_r2(l.price));
        }
    },

    _newVenture(world, st, def, ex) {
        const C = Bourse.config();
        const k = _kingdom(world, ex.kingdomId);
        const goods = Array.isArray(def.goods) && def.goods.length ? def.goods : ['Salt'];
        const good = goods[_hash(`${_seed(world)}|vgood|${ex.kingdomId}`) % goods.length];
        const capital = Math.round(_between(def.capital || [8000, 12000], _frac(`${_seed(world)}|vcap|${def.id}|${ex.kingdomId}`)));
        const l = Bourse._backfillListing({
            id: `lst${st.nextId++}`, kind: def.kind || 'venture', defId: def.id, ref: def.id,
            name: String(def.name || 'A Chartered Company').replace('{good}', good).replace('{kingdom}', k ? k.name : 'the Realm'),
            icon: def.icon || '🧭', good, kingdomId: ex.kingdomId, exchange: ex.name,
            shares: _num(C.ventureShares, 1000), capital, baseCapital: capital, roe: _num(C.hurdle, 0.08), created: _day(world),
        });
        l.book = capital / l.shares;
        st.listings.push(l);
        return l;
    },

    /** Bring the listings in step with the houses and banks that exist (new, ruined, bought, failed). */
    _sync(world, player, st) {
        const C = Bourse.config();
        MerchantHouses.ensureRivals(player, world);
        for (const r of MerchantHouses.rivals(player)) {
            let l = st.listings.find(x => x.kind === 'house' && x.ref === r.id && x.status === 'listed');
            if (!l && r.status === 'active') {
                l = Bourse._backfillListing({
                    id: `lst${st.nextId++}`, kind: 'house', ref: r.id, name: r.name, icon: r.icon || '⚖️',
                    kingdomId: Bourse._houseRealm(world, r), shares: _num(C.houseShares, 100), roe: _num(C.hurdle, 0.08), created: _day(world),
                    lastWeek: r.lastWeek != null ? r.lastWeek : null,
                });
                l.book = _num(r.capital) / l.shares;
                st.listings.push(l);
            }
            if (l && r.status !== 'active') Bourse._delist(world, player, st, l, r.status === 'bought' ? 'bought' : 'ruined');
        }
        for (const b of (player.finance && player.finance.banks) || []) {
            let l = st.listings.find(x => x.kind === 'bank' && x.ref === b.id && x.status === 'listed');
            if (!l && b.status === 'open') {
                l = Bourse._backfillListing({
                    id: `lst${st.nextId++}`, kind: 'bank', ref: b.id, name: b.name, icon: '🏦', kingdomId: b.kingdomId,
                    shares: _num(C.bankShares, 1000), roe: _num(C.hurdle, 0.08), created: _day(world),
                });
                l.equity = Bourse.bankEquity(world, player, b);
                l.book = l.equity / l.shares;
                st.listings.push(l);
            }
            if (l && b.status !== 'open') Bourse._delist(world, player, st, l, 'failed');
        }
        const c = MerchantHouses.company(player);
        const cl = st.listings.find(x => x.kind === 'company' && x.status === 'listed');
        if (cl && (!c || !c.float || !(_num(c.float.outside) > 0))) cl.status = 'delisted';
    },

    _houseRealm(world, r) {
        const t = r && r.seat && world.getTile ? world.getTile(r.seat.q, r.seat.r) : null;
        return t && t.settlement ? t.settlement.kingdom : null;
    },

    /** A listing leaves the board: bought out (holders paid), ruined or failed (worthless). */
    _delist(world, player, st, l, why) {
        if (l.status !== 'listed') return;
        l.status = 'delisted';
        l.endedDay = _day(world);
        l.endedWhy = why;
        const h = st.holdings[l.id];
        if (why === 'bought' && h && h.shares > 0) {
            const pay = Math.floor(h.shares * _num(l.book) * 1.15);
            player.gold = _num(player.gold) + pay;
            Ledger.record(player, 'shares', pay);
            st.stats.payouts += pay;
        }
        if (h) delete st.holdings[l.id];
        if (l.kind === 'house') {
            const r = MerchantHouses.getRival(player, l.ref);
            if (r && r.shares) r.shares.purse = 0;
        }
        l.price = why === 'bought' ? l.price : 0;
        Bourse._news(st, world, { kind: why === 'bought' ? 'delisted' : 'wiped', listing: l.name, kingdomId: l.kingdomId, own: !!h });
    },

    // ──────────── FUNDAMENTALS ────────────

    /** What the crowns owe a banking house: { owed, crisis } (crisis: owed by crowns deep in debt or lately defaulted). Reckoned once a day. */
    crownLoans(world, bankId) {
        const day = _day(world);
        if (!_crownCache || _crownCache.world !== world || _crownCache.day !== day) {
            const map = {};
            for (const k of (world && world.kingdoms) || []) {
                const f = k && k.finance;
                if (!f || !Array.isArray(f.debt) || !f.debt.length) continue;
                const bad = _num(f.debtRatio) > 1.2 || (f.lastDefaultDay != null && day - f.lastDefaultDay < 60);
                for (const d of f.debt) {
                    if (!d) continue;
                    const e = map[d.bankId] = map[d.bankId] || { owed: 0, crisis: 0 };
                    e.owed += _num(d.owed);
                    if (bad) e.crisis += _num(d.owed);
                }
            }
            _crownCache = { world, day, map };
        }
        return _crownCache.map[bankId] || { owed: 0, crisis: 0 };
    },

    /** A banking house's equity: reserves + what crowns owe it − the player's deposits − bills it must pay. */
    bankEquity(world, player, bank) {
        if (!bank) return 0;
        let eq = _num(bank.capital) + Bourse.crownLoans(world, bank.id).owed;
        const fin = player && player.finance;
        const acct = fin && fin.accounts && fin.accounts[bank.id];
        if (acct) eq -= _num(acct.balance);
        for (const b of (player && player.bills && player.bills.list) || []) {
            if (b && (b.status === 'held' || b.status === 'stolen') && b.payBankId === bank.id) eq -= _num(b.amount);
        }
        return Math.max(0, eq);
    },

    /** The multiple of book a return on capital earns (1 at the hurdle). */
    multiple(roe) {
        const C = Bourse.config();
        return _clamp(1 + _num(C.roeSlope, 2.5) * (_num(roe) - _num(C.hurdle, 0.08)), _num(C.minMult, 0.35), _num(C.maxMult, 2.5));
    },

    /** A listing's fair value a share, from its book and return (and what else the market knows). */
    fairValue(world, player, l) {
        const C = Bourse.config();
        let fair = Math.max(0, _num(l.book)) * Bourse.multiple(l.roe);
        if (l.kind === 'bank') {
            const b = Finance.bank(player, l.ref);
            if (b) {
                const ratio = Finance.reserveRatio(b);
                fair *= 0.5 + 0.5 * Math.min(1, ratio / Math.max(0.01, _num(C.bankLowReserve, 0.8)));
                if (Finance.inPanic(b, _day(world))) fair *= _num(C.panicDiscount, 0.55);
                const eq = Math.max(1, _num(l.equity));
                fair *= 1 - _num(C.crisisExposure, 0.5) * Math.min(1, Bourse.crownLoans(world, b.id).crisis / eq);
            }
        } else if (l.kind === 'house') {
            if (l.fashion) fair *= 1 + _num(C.fashionBonus, 0.12);
        } else if ((l.kind === 'venture' || l.kind === 'monopoly') && l.revokedUntil != null && _day(world) < l.revokedUntil) {
            fair *= 0.6;
        }
        return Math.max(0.01, fair);
    },

    _fashionable(world, r) {
        if (!world || !world.fashions) return false;
        const spec = new Set(r.specialty || []);
        if (!spec.size) return false;
        for (const f of Fashions.state(world).active || []) {
            if (Fashions.goods(f).some(g => spec.has(g.id))) return true;
        }
        return false;
    },

    _roeStep(l, weekly) {
        const C = Bourse.config();
        const w = _num(C.roeWeight, 0.08);
        l.roe = _r4(_clamp(_num(l.roe, _num(C.hurdle, 0.08)) * (1 - w) + _clamp(weekly, -0.5, 0.5) * WEEKS * w, -1, 1.5));
    },

    /** The weekly books: profits, dividends, book values. */
    _week(world, player, st, out) {
        const C = Bourse.config();
        const day = _day(world);
        // Rival houses trade on with or without the player's company
        if (!MerchantHouses.company(player)) MerchantHouses.quietWeek(player, world);
        Bourse._sync(world, player, st);
        for (const l of st.listings) {
            if (l.status !== 'listed') continue;
            const h = st.holdings[l.id];
            const held = h ? _num(h.shares) : 0;
            if (l.kind === 'house') {
                const r = MerchantHouses.getRival(player, l.ref);
                if (!r) continue;
                // Its whole return: the week's trade, and whatever else it earns (concession leases, contracts)
                let div = 0;
                if (r.lastWeek != null && r.lastWeek !== l.lastWeek) {
                    l.lastWeek = r.lastWeek;
                    div = _num(r.lastDividend);
                    l.lastDiv = _r2(div / l.shares);
                    if (held > 0 && div > 0) Bourse._payDividend(player, st, l, held * l.lastDiv);
                }
                const prior = _num(l.lastCap, _num(r.capital));
                if (prior > 0) Bourse._roeStep(l, (_num(r.capital) + div - prior) / prior);
                l.lastCap = _num(r.capital);
                l.book = _num(r.capital) / l.shares;
                l.fashion = Bourse._fashionable(world, r);
            } else if (l.kind === 'bank') {
                const b = Finance.bank(player, l.ref);
                if (!b) continue;
                const eq = Bourse.bankEquity(world, player, b);
                const prior = _num(l.equity, eq);
                const growth = eq - prior;
                if (prior > 0) Bourse._roeStep(l, growth / prior);
                let paid = 0;
                if (growth > 0) {
                    l.lastDiv = _r2(growth * _num(C.bankPayout, 0.5) / l.shares);
                    if (held > 0) {
                        paid = Math.min(Math.max(0, _num(b.capital)), held * l.lastDiv);
                        b.capital = _r2(_num(b.capital) - paid);
                        Bourse._payDividend(player, st, l, paid);
                    }
                } else l.lastDiv = 0;
                l.equity = eq - paid;
                l.book = l.equity / l.shares;
            } else if (l.kind === 'company') {
                const c = MerchantHouses.company(player);
                if (!c) continue;
                const wk = (c.weeks && c.weeks[0]) || null;
                if (wk && wk.day !== l.lastWeek) {
                    l.lastWeek = wk.day;
                    const net = _num(wk.income) - _num(wk.expenses);
                    Bourse._roeStep(l, net / Math.max(1, _num(wk.capital) - net));
                    const outside = _num(c.float && c.float.outside);
                    if (net > 0 && outside > 0) {
                        const div = Math.min(Math.max(0, c.capital), net * _num(C.float.payout, 0.5) * outside / 100);
                        Bourse._companyOut(c, world, div, 'Dividend to the shareholders');
                        st.stats.outsideDividends = _r2(st.stats.outsideDividends + div);
                        l.lastDiv = _r2(net * _num(C.float.payout, 0.5) / 100);
                    } else l.lastDiv = 0;
                }
                l.book = MerchantHouses.companyValue(player) / l.shares;
            } else {
                Bourse._ventureWeek(world, player, st, l, out);
                if (held > 0 && l.lastDiv > 0) Bourse._payDividend(player, st, l, held * l.lastDiv);
            }
            l.fair = _r2(Bourse.fairValue(world, player, l));
            l.history.push(_r2(l.price));
            const cap = Math.max(4, _num(C.historyWeeks, 26));
            if (l.history.length > cap) l.history.splice(0, l.history.length - cap);
        }
        Bourse._maniaWeek(world, player, st, out);
        st.lastWeek = day;
    },

    _payDividend(player, st, l, amount) {
        const a = Math.floor(_num(amount) * 100) / 100;
        if (!(a > 0)) return;
        player.gold = _num(player.gold) + a;
        Ledger.record(player, 'shareDividends', a);
        st.stats.dividends = _r2(st.stats.dividends + a);
        const h = st.holdings[l.id];
        if (h) h.dividends = _r2(_num(h.dividends) + a);
    },

    /** Gold leaving the company for its outside shareholders (not profit or loss: a distribution). */
    _companyOut(c, world, amount, text) {
        const amt = Math.round(_num(amount));
        if (amt <= 0) return 0;
        c.capital = Math.max(0, c.capital - amt);
        c.flows.dividendsOut = _num(c.flows.dividendsOut) + amt;
        c.ledger.unshift({ day: _day(world), kind: 'expenses', cat: 'dividendsOut', amount: amt, text });
        if (c.ledger.length > 80) c.ledger.length = 80;
        return amt;
    },

    /** A chartered company's week: profit from its trade, dividends, its fleets and its crown. */
    _ventureWeek(world, player, st, l, out) {
        const C = Bourse.config();
        const def = C.ventures.find(d => d.id === l.defId) || {};
        const k = _kingdom(world, l.kingdomId);
        const day = _day(world);
        let rate = _num(def.base) + (Utils.random() * 2 - 1) * _num(def.noise, 0.02);
        if (l.kind === 'venture') {
            const sites = (player.discovery && player.discovery.sites) || [];
            const known = sites.filter(s => s && s.discovered && Array.isArray(s.knownBy) && s.knownBy.includes(l.kingdomId)).length;
            const colonies = sites.filter(s => s && s.claim && (s.claim.kingdomId === l.kingdomId || s.claim.kingdom === l.kingdomId)).length;
            rate += Math.min(_num(def.maxSites, 8), known) * _num(def.perSite) + colonies * _num(def.perColony);
            if (k && Array.isArray(k.wars) && k.wars.length) rate += _num(def.war);
            const pirates = (world.units || []).filter(u => u && !u.destroyed && u.type === 'pirate').length;
            rate += Math.min(5, pirates) * _num(def.pirate);
            const lost = def.fleetLost || {};
            if (Utils.random() < _num(lost.chance)) {
                const share = _between(lost.loss || [0.15, 0.35], Utils.random());
                l.capital = _num(l.capital) * (1 - share);
                Bourse._news(st, world, { kind: 'fleet_lost', listing: l.name, kingdomId: l.kingdomId, pct: Math.round(share * 100), own: !!st.holdings[l.id] });
                l.sentiment -= 0.1;
            }
        } else {
            const now = world.economy ? EconomyIndex.latest(world, l.kingdomId) : null;
            const then = world.economy ? EconomyIndex.ago(world, l.kingdomId, 8) : null;
            if (now && then && _num(then.trade) > 0) rate += _num(def.tradeSlope) * _clamp((_num(now.trade) / _num(then.trade) - 1) * 10, -3, 3);
            if (now) rate += _num(def.priceSlope) * _clamp((_num(now.goods, 1) - 1) * 10, -3, 3);
            const f = k && k.finance;
            if (f && _num(f.debtRatio) > 1) rate += _num(def.debtSqueeze);
            if (f && f.lastDefaultDay != null && f.lastDefaultDay > _num(l.lastDefaultSeen, -1)) {
                l.lastDefaultSeen = f.lastDefaultDay;
                if (Utils.random() < _num(def.revokeOnDefault, 0.35)) {
                    const share = _between(def.revokeLoss || [0.4, 0.7], Utils.random());
                    l.capital = _num(l.capital) * (1 - share);
                    l.revokedUntil = day + 60;
                    Bourse._news(st, world, { kind: 'revoked', listing: l.name, kingdomId: l.kingdomId, pct: Math.round(share * 100), own: !!st.holdings[l.id] });
                }
            }
            if (l.revokedUntil != null && day < l.revokedUntil) rate = Math.min(rate, 0);
        }
        if (!k || k.isAlive === false) rate -= 0.02;
        const profit = _num(l.capital) * rate;
        Bourse._roeStep(l, rate);
        const div = profit > 0 ? profit * _num(C.venturePayout, 0.6) : 0;
        l.capital = Math.max(0, _num(l.capital) + profit - div);
        l.lastDiv = _r4(div / l.shares);
        l.book = l.capital / l.shares;
        if (l.capital < _num(l.baseCapital) * 0.05) Bourse._delist(world, player, st, l, 'wound up');
    },

    // ──────────── MANIAS & PANICS ────────────

    maniaDef(id) {
        return Bourse.manias().find(m => m && m.id === id) || null;
    },

    /** Today's mania multiplier on a listing. */
    maniaMult(l, day) {
        const m = l && l.mania;
        if (!m) return 1;
        if (day <= m.peakDay) {
            const t = _clamp((day - m.start) / Math.max(1, m.peakDay - m.start), 0, 1);
            return Math.pow(m.peak, t);
        }
        const t = _clamp((day - m.peakDay) / Math.max(1, m.endDay - m.peakDay), 0, 1);
        return m.trough + (1 - m.trough) * t * t;
    },

    _maniaWeek(world, player, st, out) {
        const day = _day(world);
        if (st.listings.some(l => l.mania)) return;
        for (const def of Bourse.manias()) {
            if (Utils.random() >= _num(def.chance)) continue;
            const pool = st.listings.filter(l => l.status === 'listed' && (def.targets || []).includes(l.kind));
            if (!pool.length) continue;
            const l = pool[Math.floor(Utils.random() * pool.length)];
            const rise = Math.round(_between(def.riseDays || [25, 50], Utils.random()));
            const fall = Math.round(_between(def.burstDays || [20, 40], Utils.random()));
            l.mania = {
                id: def.id, start: day, peakDay: day + rise, endDay: day + rise + fall,
                peak: _r2(_between(def.peak || [2, 3], Utils.random())), trough: _r2(_between(def.trough || [0.5, 0.7], Utils.random())),
                issued: false, burst: false,
            };
            const ex = st.exchanges.find(e => e.kingdomId === l.kingdomId) || st.exchanges[0] || {};
            Bourse._news(st, world, { kind: 'mania', mania: def.id, listing: l.name, kingdomId: l.kingdomId, place: ex.name, own: !!st.holdings[l.id] });
            out.notices.push({ icon: def.icon || '🎈', title: 'A Mania at the Bourse', text: Bourse._fill(def.start, { name: Bourse._fill(def.name, { good: l.good || 'the' }), place: ex.name || 'the Bourse', listing: l.name }), type: 'info' });
            return;
        }
    },

    /** A mania's daily course: new stock sold into it near the top, the burst, the end. */
    _maniaDay(world, player, st, l, out) {
        const m = l.mania;
        const def = Bourse.maniaDef(m.id) || {};
        const day = _day(world);
        if (!m.issued && day >= m.start + (m.peakDay - m.start) * 0.6 && _num(def.issue) > 0 && (l.kind === 'venture' || l.kind === 'monopoly')) {
            m.issued = true;
            const n = Math.round(l.shares * _num(def.issue));
            l.capital = _num(l.capital) + n * l.price;
            l.shares += n;
            l.book = l.capital / l.shares;
        }
        if (!m.burst && day > m.peakDay) {
            m.burst = true;
            st.mood = _r4(st.mood * _num(def.mood, 0.85));
            const ex = st.exchanges.find(e => e.kingdomId === l.kingdomId) || st.exchanges[0] || {};
            // The house that lent on the shares
            const bank = Finance.openBanks(player).find(b => b.kingdomId === ex.kingdomId) || Finance.openBanks(player)[0];
            let hit = 0;
            if (bank) {
                hit = Math.round(Math.max(0, _num(bank.capital)) * _between(def.bankHit || [0.02, 0.05], Utils.random()));
                bank.capital -= hit;
            }
            Bourse._news(st, world, { kind: 'crash', mania: m.id, listing: l.name, kingdomId: l.kingdomId, place: ex.name, bank: bank ? bank.name : null, amount: hit, own: !!st.holdings[l.id] });
            out.notices.push({ icon: '📉', title: 'The Bubble Bursts', text: Bourse._fill(def.burst, { name: Bourse._fill(def.name, { good: l.good || 'the' }), place: ex.name || 'the Bourse', listing: l.name }) + (bank && hit ? ` ${bank.name} loses ${hit}g it lent on the shares.` : ''), type: st.holdings[l.id] ? 'error' : 'warning' });
        }
        if (day >= m.endDay) l.mania = null;
    },

    /** Panics: houses failing, crowns defaulting, runs, war on an exchange's realm (finance.history, kingdom.wars). */
    _panics(world, player, st) {
        const C = Bourse.config();
        const P = C.panics || {};
        const day = _day(world);
        const exRealms = new Set(st.exchanges.map(e => e.kingdomId));
        const hist = (player.finance && player.finance.history) || [];
        const last = hist.length ? hist[hist.length - 1].key : null;
        const fresh = last !== st.lastFinKey;
        st.lastFinKey = last;
        for (const h of fresh ? hist : []) {
            if (!h || !h.key || st.seen[h.key] || day - _num(h.day) > 3) continue;
            st.seen[h.key] = h.day;
            const f = _num(P[h.kind], 1);
            if (f < 1) {
                st.mood = _r4(st.mood * (exRealms.has(h.kingdomId) ? f : 1 - (1 - f) / 2));
                if (h.kind === 'bank_failed' || h.kind === 'crown_default') Bourse._news(st, world, { kind: 'panic', why: h.kind, bank: h.bank || null, kingdom: h.kingdom || null, kingdomId: h.kingdomId, place: st.exchanges[0] && st.exchanges[0].name });
            }
        }
        for (const k of world.kingdoms || []) {
            if (!k || !exRealms.has(k.id)) continue;
            const n = Array.isArray(k.wars) ? k.wars.length : 0;
            if (n > _num(st.wars[k.id])) st.mood = _r4(st.mood * _num(P.war, 0.93));
            st.wars[k.id] = n;
        }
        // Old keys out
        if (day % 7 === 0) for (const [key, d] of Object.entries(st.seen)) if (day - _num(d) > 30) delete st.seen[key];
    },

    // ──────────── THE DAILY TICK ────────────

    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player || !Array.isArray(world.kingdoms)) return out;
        const st = Bourse.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        const rng = seededStream(_hash(`${_seed(world)}:bourse:${day}`));
        Utils.withRng(rng, () => {
            if (!st.initialized) Bourse._init(world, player, st);
            Bourse._tick(world, player, st, out);
        });
        return out;
    },

    _tick(world, player, st, out) {
        const C = Bourse.config();
        const day = _day(world);
        if (st.lastWeek == null || day - st.lastWeek >= 7) Bourse._week(world, player, st, out);
        Bourse._panics(world, player, st);
        st.mood = _r4(1 + (st.mood - 1) * (1 - _num(C.moodRevert, 0.04)));
        const rev = _num(C.sentimentRevert, 0.06);
        const vol = _num(C.sentimentVol, 0.018);
        const decay = _num(C.impactDecay, 0.85);
        for (const l of st.listings) {
            if (l.status !== 'listed') continue;
            if (l.mania) Bourse._maniaDay(world, player, st, l, out);
            l.sentiment = _r4(l.sentiment * (1 - rev) + vol * _gauss());
            l.impact = _r4(l.impact * decay);
            // A bank's worth moves with its vaults by the day; the rest is reckoned weekly
            if (l.kind === 'bank') l.fair = _r2(Bourse.fairValue(world, player, l));
            l.price = _r2(Math.max(0.01, l.fair * Math.exp(l.sentiment) * st.mood * Bourse.maniaMult(l, day) * (1 + l.impact)));
        }
    },

    _news(st, world, rec) {
        const day = _day(world);
        st.history.push({ ...rec, day, key: `bourse:${rec.kind}:${day}:${rec.listing || rec.bank || ''}` });
        const cap = Math.max(10, _num(Bourse.config().newsCap, 40));
        if (st.history.length > cap) st.history.splice(0, st.history.length - cap);
    },

    _fill(text, tokens) {
        return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null ? tokens[k] : m));
    },

    // ──────────── TRADING ────────────

    /** The exchange the player stands at, or null. */
    exchangeAt(player, world) {
        const st = player && player.bourse;
        if (!st || !Array.isArray(st.exchanges)) return null;
        return st.exchanges.find(e => e.q === player.q && e.r === player.r) || null;
    },

    listing(player, id) {
        const st = player && player.bourse;
        return st && Array.isArray(st.listings) ? st.listings.find(l => l.id === id) || null : null;
    },

    listed(player) {
        const st = player && player.bourse;
        return st && Array.isArray(st.listings) ? st.listings.filter(l => l.status === 'listed') : [];
    },

    /** What n shares cost to buy now (ask), or bring when sold (bid), with the broker's cut. */
    quoteTrade(l, n, side) {
        const C = Bourse.config();
        const half = _num(C.spread, 0.03) / 2;
        const gross = n * _num(l.price) * (side === 'buy' ? 1 + half : 1 - half);
        const fee = Math.max(_num(C.minCommission, 2), gross * _num(C.commission, 0.01));
        return { gross: _r2(gross), fee: _r2(fee), total: _r2(side === 'buy' ? gross + fee : Math.max(0, gross - fee)) };
    },

    /** Shares of a house the player holds through the company, which share the 100. */
    _houseRoom(player, l) {
        const r = MerchantHouses.getRival(player, l.ref);
        if (!r) return 0;
        const held = _num(((player.bourse || {}).holdings[l.id] || {}).shares);
        return Math.max(0, 100 - _num(r.shares && r.shares.player) - held);
    },

    buy(player, world, listingId, n) {
        const C = Bourse.config();
        const st = Bourse.state(player);
        const l = Bourse.listing(player, listingId);
        const k = Math.floor(_num(n));
        if (!Bourse.exchangeAt(player, world)) return { success: false, reason: 'Shares change hands only on the floor of a Bourse.' };
        if (!l || l.status !== 'listed') return { success: false, reason: 'No such listing.' };
        if (l.kind === 'company') return Bourse.buyBack(player, world, k);
        if (k <= 0) return { success: false, reason: 'How many?' };
        if (l.kind === 'house' && k > Bourse._houseRoom(player, l)) return { success: false, reason: `Only ${Bourse._houseRoom(player, l)} shares of ${l.name} are to be had.` };
        const held = _num((st.holdings[l.id] || {}).shares);
        if (held + k > l.shares * 0.25) return { success: false, reason: 'The brokers will not sell any one buyer more than a quarter of the stock.' };
        const q = Bourse.quoteTrade(l, k, 'buy');
        if (_num(player.gold) < q.total) return { success: false, reason: `${k} shares cost ${Math.ceil(q.total)}g.` };
        player.gold -= q.total;
        Ledger.record(player, 'shares', -q.gross);
        Ledger.record(player, 'brokerage', -q.fee);
        const h = st.holdings[l.id] = st.holdings[l.id] || { shares: 0, cost: 0, dividends: 0 };
        h.shares += k;
        h.cost = _r2(_num(h.cost) + q.total);
        if (l.kind === 'house') {
            const r = MerchantHouses.getRival(player, l.ref);
            if (r && r.shares) r.shares.purse = h.shares;
        }
        l.impact = _r4(l.impact + _num(C.impact, 0.5) * k / Math.max(1, l.shares));
        st.stats.bought = _r2(st.stats.bought + q.total);
        st.stats.fees = _r2(st.stats.fees + q.fee);
        return { success: true, cost: q.total, text: `Bought ${k} shares of ${l.name} for ${Math.ceil(q.total)}g.` };
    },

    sell(player, world, listingId, n) {
        const C = Bourse.config();
        const st = Bourse.state(player);
        const l = Bourse.listing(player, listingId);
        const k = Math.floor(_num(n));
        if (!Bourse.exchangeAt(player, world)) return { success: false, reason: 'Shares change hands only on the floor of a Bourse.' };
        if (!l || l.status !== 'listed') return { success: false, reason: 'No such listing.' };
        if (l.kind === 'company') return Bourse.sellOwn(player, world, k);
        const h = st.holdings[l.id];
        if (!h || k <= 0 || k > h.shares) return { success: false, reason: 'You hold fewer shares than that.' };
        const q = Bourse.quoteTrade(l, k, 'sell');
        const costShare = h.shares > 0 ? _num(h.cost) * k / h.shares : 0;
        player.gold = _num(player.gold) + q.total;
        Ledger.record(player, 'shares', q.gross);
        Ledger.record(player, 'brokerage', -q.fee);
        h.shares -= k;
        h.cost = _r2(Math.max(0, _num(h.cost) - costShare));
        if (h.shares <= 0) delete st.holdings[l.id];
        if (l.kind === 'house') {
            const r = MerchantHouses.getRival(player, l.ref);
            if (r && r.shares) r.shares.purse = h.shares > 0 ? h.shares : 0;
        }
        l.impact = _r4(l.impact - _num(C.impact, 0.5) * k / Math.max(1, l.shares));
        st.stats.sold = _r2(st.stats.sold + q.total);
        st.stats.fees = _r2(st.stats.fees + q.fee);
        return { success: true, earned: q.total, text: `Sold ${k} shares of ${l.name} for ${Math.floor(q.total)}g.` };
    },

    // ──────────── THE PLAYER'S COMPANY ────────────

    /** The terms of floating n more shares of the company: { price, cash, fair, outside }. */
    floatQuote(player, world, n) {
        const C = Bourse.config();
        const c = MerchantHouses.company(player);
        if (!c) return null;
        const st = Bourse.state(player);
        const l = st.listings.find(x => x.kind === 'company' && x.status === 'listed');
        const book = MerchantHouses.companyValue(player) / 100;
        const roe = l ? l.roe : Bourse._companyRoe(c);
        const fair = book * Bourse.multiple(roe);
        const price = fair * (1 - _num(C.float.discount, 0.1));
        const k = Math.floor(_num(n));
        return { fair: _r2(fair), price: _r2(price), cash: Math.floor(k * price * (1 - _num(C.float.fee, 0.03))), outside: _num(c.float && c.float.outside), roe };
    },

    _companyRoe(c) {
        const weeks = (c.weeks || []).slice(0, 8);
        if (!weeks.length) return Bourse.config().hurdle;
        const net = weeks.reduce((a, w) => a + _num(w.income) - _num(w.expenses), 0) / weeks.length;
        return _clamp(net / Math.max(1, _num(c.capital)) * WEEKS, -1, 1.5);
    },

    /** Float n new shares of the company on the Bourse: the cash goes into the company; outsiders own a part. */
    float(player, world, n) {
        const C = Bourse.config();
        const st = Bourse.state(player);
        const c = MerchantHouses.company(player);
        const k = Math.floor(_num(n));
        if (!Bourse.exchangeAt(player, world)) return { success: false, reason: 'A float is made on the floor of a Bourse.' };
        if (!c) return { success: false, reason: 'You have no company to float.' };
        if (MerchantHouses.companyValue(player) < _num(C.float.minValue, 1500)) return { success: false, reason: `The brokers will not float a company worth under ${_num(C.float.minValue, 1500)}g.` };
        if (!c.float) c.float = { outside: 0, floatedDay: null, raised: 0 };
        if (k <= 0 || _num(c.float.outside) + k > _num(C.float.maxOutside, 49)) return { success: false, reason: `You may sell at most ${_num(C.float.maxOutside, 49) - _num(c.float.outside)} more shares and keep control.` };
        const q = Bourse.floatQuote(player, world, k);
        let l = st.listings.find(x => x.kind === 'company' && x.status === 'listed');
        if (!l) {
            l = Bourse._backfillListing({
                id: `lst${st.nextId++}`, kind: 'company', ref: 'company', name: c.name, icon: '⚖️',
                kingdomId: (Bourse.exchangeAt(player, world) || {}).kingdomId, shares: 100, roe: q.roe, created: _day(world),
            });
            st.listings.push(l);
        }
        c.float.outside += k;
        c.float.floatedDay = c.float.floatedDay == null ? _day(world) : c.float.floatedDay;
        c.float.raised = _num(c.float.raised) + q.cash;
        c.capital += q.cash;
        c.flows.floated = _num(c.flows.floated) + q.cash;
        c.ledger.unshift({ day: _day(world), kind: 'income', cat: 'floated', amount: q.cash, text: `${k} shares floated at ${q.price.toFixed(1)}g` });
        if (c.ledger.length > 80) c.ledger.length = 80;
        l.book = MerchantHouses.companyValue(player) / 100;
        l.fair = Bourse.fairValue(world, player, l);
        l.price = _r2(q.price);
        st.stats.floated = _r2(st.stats.floated + q.cash);
        Bourse._news(st, world, { kind: 'float', listing: c.name, kingdomId: l.kingdomId, own: true, pct: k });
        return { success: true, cash: q.cash, text: `${k} shares of ${c.name} floated at ${q.price.toFixed(1)}g: ${q.cash}g into the company. Outsiders now own ${c.float.outside}%.` };
    },

    /** Buy back shares of the company from outsiders, from the purse. */
    buyBack(player, world, n) {
        const C = Bourse.config();
        const st = Bourse.state(player);
        const c = MerchantHouses.company(player);
        const l = st.listings.find(x => x.kind === 'company' && x.status === 'listed');
        const k = Math.floor(_num(n));
        if (!c || !l || !c.float) return { success: false, reason: 'Your company is not on the Bourse.' };
        if (k <= 0 || k > _num(c.float.outside)) return { success: false, reason: `Outsiders hold ${_num(c.float.outside)} shares.` };
        const q = Bourse.quoteTrade(l, k, 'buy');
        if (_num(player.gold) < q.total) return { success: false, reason: `${k} shares cost ${Math.ceil(q.total)}g.` };
        player.gold -= q.total;
        Ledger.record(player, 'shares', -q.gross);
        Ledger.record(player, 'brokerage', -q.fee);
        c.float.outside -= k;
        l.impact = _r4(l.impact + _num(C.impact, 0.5) * k / 100);
        st.stats.buyBacks = _r2(st.stats.buyBacks + q.total);
        if (c.float.outside <= 0) l.status = 'delisted';
        return { success: true, cost: q.total, text: `Bought back ${k} shares of ${c.name} for ${Math.ceil(q.total)}g. Outsiders own ${c.float.outside}%.` };
    },

    /** Sell some of your own stake in the company to outsiders (the gold is yours, not the company's). */
    sellOwn(player, world, n) {
        const C = Bourse.config();
        const st = Bourse.state(player);
        const c = MerchantHouses.company(player);
        const l = st.listings.find(x => x.kind === 'company' && x.status === 'listed');
        const k = Math.floor(_num(n));
        if (!c || !l || !c.float) return { success: false, reason: 'Float the company first.' };
        if (k <= 0 || _num(c.float.outside) + k > _num(C.float.maxOutside, 49)) return { success: false, reason: 'You would lose control of the company.' };
        const q = Bourse.quoteTrade(l, k, 'sell');
        player.gold = _num(player.gold) + q.total;
        Ledger.record(player, 'shares', q.gross);
        Ledger.record(player, 'brokerage', -q.fee);
        c.float.outside += k;
        l.impact = _r4(l.impact - _num(C.impact, 0.5) * k / 100);
        st.stats.sold = _r2(st.stats.sold + q.total);
        return { success: true, earned: q.total, text: `Sold ${k} of your shares in ${c.name} for ${Math.floor(q.total)}g. Outsiders own ${c.float.outside}%.` };
    },

    // ──────────── READERS ────────────

    /** The player's holdings at today's prices: [{ listing, shares, value, cost, dividends }]. */
    portfolio(player) {
        const st = player && player.bourse;
        if (!st) return [];
        const out = [];
        for (const [id, h] of Object.entries(st.holdings || {})) {
            const l = Bourse.listing(player, id);
            if (!l || !(h.shares > 0)) continue;
            out.push({ listing: l, shares: h.shares, value: _r2(h.shares * l.price), cost: _num(h.cost), dividends: _num(h.dividends) });
        }
        return out;
    },

    /** Shares at today's price (for net worth). */
    portfolioValue(player) {
        return Bourse.portfolio(player).reduce((a, p) => a + p.value, 0);
    },

    /**
     * Does the player see past the price to a listing's worth? Their own
     * company; a realm where they have a spy (systems/espionage.js).
     */
    insight(player, world, l) {
        if (!l) return false;
        if (l.kind === 'company') return true;
        const kid = l.kingdomId;
        if (kid == null) return false;
        const esp = player && player.espionage;
        for (const spy of (esp && esp.spies) || []) {
            const loc = spy && spy.location;
            const t = loc && world && world.getTile ? world.getTile(loc.q, loc.r) : null;
            if (t && t.settlement && t.settlement.kingdom === kid) return true;
        }
        for (const m of (esp && esp.activeMissions) || []) if (m && m.targetKingdom === kid) return true;
        return false;
    },

    /** Recent Bourse news for the heralds and the panel. */
    recent(player, world, days = 30) {
        const st = player && player.bourse;
        const day = _day(world);
        return st && Array.isArray(st.history) ? st.history.filter(h => h && day - _num(h.day) <= days) : [];
    },
};

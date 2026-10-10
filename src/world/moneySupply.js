// ============================================
// MONEY SUPPLY — the coin in each realm, where it flows, and what it does
// to prices
// ============================================
// Every realm has coin in circulation (world.money.realms[id].coin), seeded
// at coinPerHead × its people the first time it is seen. The crown's chests
// (kingdom.treasury) and the banks' vaults (systems/finance.js) are coin held
// out of circulation: they are shown beside it (broad money) but do not move
// prices until they are spent. Once a week (`every` days) the coin moves:
//   • trade      NPC traders' goods crossing a border are settled `specie`
//                in coin (the value each trade link carried, left on the
//                link by SettlementMarket.flows and gathered daily by
//                collectTrade); a realm with less coin per head than a
//                trading partner is cheaper, sells it more and wins coin back
//                (the price-specie flow: hume × the gap in log coin per head ×
//                the smaller coin), so a drained realm recovers, a realm whose
//                mines pour out coin spends it abroad, and a persistent deficit
//                settles a little low
//   • transfers  tribute and capitulation indemnities, crown loans across a
//                border and their repayment (transfer(), called by
//                KingdomAI.endWar and systems/finance.js)
//   • Gresham    debased coin drives the good coin out to sounder partners
//   • flight     a run on a bank or a crown default sends coin abroad
//   • wear       a little coin is lost every week
//   • the mint   strikes new coin from the gold and silver ore it buys in the
//                realm's markets (and from the player, systems/mints.js);
//                fine / purity of coin per unit, the crown keeping the
//                seigniorage
// Hoarding: a realm at war, or in a panic, hoards part of its coin
// (velocity). The realm's price level then follows its coin × velocity per
// head against the world's — level = clamp(ratio ^ elasticity), smoothed —
// and Coinage.priceMultiplier (world/coinage.js) multiplies it with the
// purity term: one multiplier on every price in the realm's markets, which
// EconomyIndex measures as inflation or deflation. The crown's tax yield
// follows it a little (incomeFactor, read by KingdomAI.incomeMultiplier).
//
// Pure world model: reads the realms and the markets, draws no RNG. State
// on world.money (saved with the world). Tuned in data/mints.json; with
// enabled: false every reader is neutral and nothing ticks.

import { DataLoader } from '../core/dataLoader.js';
import { SettlementMarket } from './settlementMarket.js';
import { CrownBooks } from './crownBooks.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = (v) => Math.round(v * 100) / 100;
const _r4 = (v) => Math.round(v * 10000) / 10000;

/** Flow kinds kept per realm per week (and in total). */
export const FLOW_KINDS = ['trade', 'tribute', 'loans', 'gresham', 'flight', 'mint', 'wear', 'debase', 'recoin', 'counterfeit', 'player', 'drift', 'fisc'];
/** Flows that bring foreign coin in (restruck at the realm's mint). */
const FOREIGN = new Set(['trade', 'tribute', 'loans', 'gresham', 'flight']);

const DEFAULTS = {
    enabled: true, every: 7, coinPerHead: 2,
    level: { elasticity: 0.5, min: 0.9, max: 1.12, smoothing: 0.2 },
    velocity: { war: 0.12, panic: 0.1, adjust: 0.3, floor: 0.6 },
    trade: { specie: 0.35, hume: 0.04, maxShare: 0.06 },
    transfers: { tribute: 0.15, loans: 0.4, maxShare: 0.1 },
    gresham: { rate: 0.15 },
    flight: { rate: 0.015, defaultDays: 30 },
    wear: 0.002,
    drift: 0.04,
    income: { elasticity: 0.3, min: 0.97, max: 1.03 },
    mint: {
        fine: { gold_ore: 36, silver_ore: 16, gold_bar: 140 },
        keep: 0.6, weeklyFine: 2500, playerWeeklyFine: 3000, askCap: 0.95, remint: 0.5,
        policies: {
            low: { label: 'Low (2%)', seigniorage: 0.02, draw: 1.25 },
            normal: { label: 'Usual (5%)', seigniorage: 0.05, draw: 1 },
            high: { label: 'High (10%)', seigniorage: 0.1, draw: 0.6 },
        },
        seignHistory: 8,
    },
    debase: { coinShare: 1 },
    recoinage: { crownShare: 0.5, stability: 2, maxDebtRatio: 0.3, treasuryCover: 4, cooldown: 120, minGap: 0.05 },
    exchange: { perPurity: 0.25, max: 0.05, minGold: 50 },
    concession: { termDays: 120, share: 0.5, feeShare: 0.9, minFee: 40 },
    counterfeit: { minRank: 1, minStake: 100, maxStake: 600, gain: 0.55, base: 0.16, heatPer: 0.004, rankCut: 0.02, looser: 0.6, fineShare: 1, caughtHeat: 15, passHeat: 4, arrestChance: 0.5, cooldown: 7 },
    news: { shortAt: 0.94, floodAt: 1.07, gapWeeks: 8, cap: 30, historyWeeks: 26 },
    counsel: { bullionGain: 0.05, mintRadius: 25 },
};

const SECTIONS = ['level', 'velocity', 'trade', 'transfers', 'gresham', 'flight', 'income', 'debase', 'recoinage', 'exchange', 'concession', 'counterfeit', 'news', 'counsel'];

let _cfgSrc;
let _cfg = null;

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

function _purity(k) {
    const f = k && k.finance;
    const p = f && typeof f.purity === 'number' && Number.isFinite(f.purity) ? f.purity : 1;
    return _clamp(p, 0.1, 1);
}

function _alive(world) {
    return (world && Array.isArray(world.kingdoms) ? world.kingdoms : [])
        .filter(k => k && k.isAlive !== false && k.id != null)
        .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function _flows() {
    const o = {};
    for (const k of FLOW_KINDS) o[k] = 0;
    return o;
}

export const MoneySupply = {
    FLOW_KINDS,

    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.mints) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = d || {};
            _cfg = { ...DEFAULTS, ...o };
            for (const s of SECTIONS) _cfg[s] = { ...DEFAULTS[s], ...(o[s] || {}) };
            const m = o.mint || {};
            _cfg.mint = { ...DEFAULTS.mint, ...m, fine: { ...DEFAULTS.mint.fine, ...(m.fine || {}) }, policies: { ...DEFAULTS.mint.policies, ...(m.policies || {}) } };
        }
        // (read live: tests and the survival sim switch it off on the loaded data)
        _cfg.enabled = !(d && d.enabled === false);
        return _cfg;
    },

    enabled() {
        return MoneySupply.config().enabled;
    },

    // ── State ─────────────────────────────────────────────

    state(world) {
        if (!world) return { lastDay: null, seq: 0, realms: {}, trade: {}, news: [], newsAt: {} };
        let st = world.money;
        if (!_obj(st)) st = world.money = { lastDay: null, seq: 0, realms: {}, trade: {}, news: [], newsAt: {} };
        if (!_obj(st.realms)) st.realms = {};
        if (!_obj(st.trade)) st.trade = {};
        if (!Array.isArray(st.news)) st.news = [];
        if (!_obj(st.newsAt)) st.newsAt = {};
        if (st.lastDay === undefined) st.lastDay = null;
        if (typeof st.seq !== 'number') st.seq = _num(st.seq);
        return st;
    },

    _blank(coin) {
        return MoneySupply._fill({ coin: Math.max(0, _num(coin)) });
    },

    /** Backfill a realm's record (older saves, older versions). */
    _fill(R) {
        R.coin = Math.max(0, _num(R.coin));
        R.level = _num(R.level, 1) > 0 ? _num(R.level, 1) : 1;
        R.target = _num(R.target, R.level);
        R.vel = _num(R.vel, 1) > 0 ? _num(R.vel, 1) : 1;
        R.pop = _num(R.pop);
        R.ratio = _num(R.ratio, 1) > 0 ? _num(R.ratio, 1) : 1;
        R.wkIn = _num(R.wkIn);
        if (!_obj(R.wk)) R.wk = _flows();
        if (!_obj(R.last)) R.last = _flows();
        if (!_obj(R.tot)) R.tot = _flows();
        for (const o of [R.wk, R.last, R.tot]) for (const k of FLOW_KINDS) o[k] = _num(o[k]);
        if (!Array.isArray(R.hist)) R.hist = [];
        const m = _obj(R.mint) || (R.mint = {});
        if (!MoneySupply.config().mint.policies[m.policy]) m.policy = 'normal';
        if (!_obj(m.pending)) m.pending = {};
        m.playerWeek = _num(m.playerWeek);
        m.struck = _num(m.struck);
        m.seign = _num(m.seign);
        m.lastStruck = _num(m.lastStruck);
        m.lastSeign = _num(m.lastSeign);
        if (!Array.isArray(m.seignHist)) m.seignHist = [];
        if (m.lastRecoin === undefined) m.lastRecoin = null;
        if (m.lease === undefined) m.lease = null;
        return R;
    },

    serialize(world) {
        const st = world && _obj(world.money);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    /** After a load (older saves: none — every realm is seeded afresh on the next day, level 1). */
    restore(saved, world) {
        if (!world) return;
        world.money = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : null;
        if (world.money) for (const R of Object.values(MoneySupply.state(world).realms)) MoneySupply._fill(R);
    },

    /** A realm's record (null when not seen yet, or the system is off). */
    realm(world, kid) {
        const st = world && world.money;
        if (!st || !st.realms || kid == null) return null;
        return st.realms[kid] || null;
    },

    /** Make sure a living realm has a record (seeded at coinPerHead × its people). */
    ensureRealm(world, k) {
        if (!k || k.id == null) return null;
        const st = MoneySupply.state(world);
        let R = st.realms[k.id];
        if (!R) R = st.realms[k.id] = MoneySupply._blank(MoneySupply.config().coinPerHead * Math.max(1, _num(k.population)));
        return R;
    },

    // ── Readers (O(1): Coinage.priceMultiplier calls these per price) ──

    /** The realm's quantity price level (1 = the world's norm; 1 when unmeasured or off). */
    level(world, kid) {
        const st = world && world.money;
        if (!st || !st.realms || kid == null) return 1;
        const R = st.realms[kid];
        if (!R || !(R.level > 0)) return 1;
        return MoneySupply.enabled() ? R.level : 1;
    },

    /** The crown's tax yield factor (KingdomAI.incomeMultiplier): level ^ elasticity, clamped. */
    incomeFactor(world, kingdom) {
        if (!kingdom) return 1;
        const lv = MoneySupply.level(world, kingdom.id);
        if (lv === 1) return 1;
        const I = MoneySupply.config().income;
        return _clamp(Math.pow(lv, I.elasticity), I.min, I.max);
    },

    /** Coin in circulation, in the crown's chests and in the banks' vaults: { coin, treasury, banks, broad }. */
    broadMoney(world, kingdom, bankReserves = 0) {
        const R = kingdom ? MoneySupply.realm(world, kingdom.id) : null;
        const coin = R ? R.coin : 0;
        const treasury = Math.max(0, _num(kingdom && kingdom.treasury));
        const banks = Math.max(0, _num(bankReserves));
        return { coin, treasury, banks, broad: coin + treasury + banks };
    },

    /** A realm's coin in circulation (rounded), or null when not seen yet. */
    coin(world, kid) {
        const R = MoneySupply.realm(world, kid);
        return R ? Math.round(R.coin) : null;
    },

    /** Silver content of a's coin in b's coin (what the money changers reckon): purity a / purity b. */
    exchangeRate(world, fromKid, toKid) {
        const a = _kingdom(world, fromKid), b = _kingdom(world, toKid);
        return _r4(_purity(a) / _purity(b));
    },

    /** How the coin moved over `weeks` (coin now / coin then − 1), or null. */
    trend(world, kid, weeks = 4) {
        const R = MoneySupply.realm(world, kid);
        if (!R || R.hist.length < 2) return null;
        const now = R.hist[R.hist.length - 1];
        const then = R.hist[Math.max(0, R.hist.length - 1 - Math.max(1, Math.floor(weeks)))];
        if (!(then[1] > 0)) return null;
        return now[1] / then[1] - 1;
    },

    /** The heralds' records (newest last). */
    news(world) {
        const st = world && _obj(world.money);
        return st && Array.isArray(st.news) ? st.news : [];
    },

    // ── Flows ─────────────────────────────────────────────

    _note(R, kind, amount) {
        R.wk[kind] = _r2(_num(R.wk[kind]) + amount);
        R.tot[kind] = _r2(_num(R.tot[kind]) + amount);
        // Foreign coin coming in is brought to the mint to be restruck (brassage)
        if (amount > 0 && FOREIGN.has(kind)) R.wkIn = _num(R.wkIn) + amount;
    },

    /** Add (or, negative, remove) coin in a realm's circulation. @returns the amount applied */
    adjust(world, kid, amount, kind = 'player') {
        if (!MoneySupply.enabled()) return 0;
        const k = _kingdom(world, kid);
        if (!k || k.isAlive === false) return 0;
        const R = MoneySupply.ensureRealm(world, k);
        const a = Math.max(-R.coin, _num(amount));
        if (!a) return 0;
        R.coin = _r2(R.coin + a);
        MoneySupply._note(R, kind, a);
        return a;
    },

    /**
     * Move coin between two realms' circulation: `share` of `amount` (the
     * transfers section for tribute and loans), at most maxShare of the
     * payer's coin. @returns the coin moved
     */
    transfer(world, fromKid, toKid, amount, kind = 'tribute', share = null) {
        if (!MoneySupply.enabled() || fromKid == null || toKid == null || fromKid === toKid) return 0;
        const a = _kingdom(world, fromKid), b = _kingdom(world, toKid);
        if (!a || !b || a.isAlive === false || b.isAlive === false) return 0;
        const T = MoneySupply.config().transfers;
        const Ra = MoneySupply.ensureRealm(world, a), Rb = MoneySupply.ensureRealm(world, b);
        const s = share != null ? share : _num(T[kind], 1);
        const amt = _r2(Math.min(Math.max(0, _num(amount)) * s, Ra.coin * _num(T.maxShare, 0.25)));
        if (!(amt > 0)) return 0;
        Ra.coin = _r2(Ra.coin - amt);
        Rb.coin = _r2(Rb.coin + amt);
        MoneySupply._note(Ra, kind, -amt);
        MoneySupply._note(Rb, kind, amt);
        return amt;
    },

    /**
     * Gather the day's cross-border NPC trade (link.valAB / valBA: the value
     * of the goods each way at the exporter's price, left by
     * SettlementMarket.flows) into the week's trade book, and clear it.
     */
    collectTrade(world, links) {
        if (!world || !Array.isArray(links)) return 0;
        const on = MoneySupply.enabled();
        const book = on ? MoneySupply.state(world).trade : null;
        let total = 0;
        for (const link of links) {
            const ab = link.valAB, ba = link.valBA;
            if (!(ab > 0) && !(ba > 0)) continue;
            link.valAB = 0;
            link.valBA = 0;
            if (!on) continue;
            const ka = link.a && link.a.kingdom, kb = link.b && link.b.kingdom;
            if (ka == null || kb == null || ka === kb) continue;
            if (ab > 0) { const key = `${ka}>${kb}`; book[key] = _r2(_num(book[key]) + ab); total += ab; }
            if (ba > 0) { const key = `${kb}>${ka}`; book[key] = _r2(_num(book[key]) + ba); total += ba; }
        }
        return total;
    },

    /**
     * Book goods the player carried across a border into the week's trade
     * book, as NPC trade is: `value` of goods from realm `fromKid` sold in
     * realm `toKid` (the importer's coin settles part of it, weekly).
     * @returns the value booked
     */
    noteTrade(world, fromKid, toKid, value) {
        if (!world || !MoneySupply.enabled() || fromKid == null || toKid == null || String(fromKid) === String(toKid)) return 0;
        const v = _num(value);
        if (!(v > 0)) return 0;
        const a = _kingdom(world, fromKid), b = _kingdom(world, toKid);
        if (!a || !b || a.isAlive === false || b.isAlive === false) return 0;
        const book = MoneySupply.state(world).trade;
        const key = `${a.id}>${b.id}`;
        book[key] = _r2(_num(book[key]) + v);
        return v;
    },

    // ── The mint ──────────────────────────────────────────

    policy(R) {
        const P = MoneySupply.config().mint.policies;
        return P[(R && R.mint && R.mint.policy) || 'normal'] || P.normal;
    },

    /**
     * The week's minting for a realm: buy ore above `keep` × target from its
     * markets (at most weeklyFine × the policy's draw of fine value), add what
     * the player sold, strike fine / purity of coin; the crown keeps the
     * seigniorage, the rest circulates. Foreign coin that came in this week
     * (trade, tribute, loans, Gresham, flight) is restruck in part (`remint`)
     * for the same charge. `towns` are the realm's live settlements.
     * @returns { fine, struck, seign }
     */
    mintWeek(world, k, R, towns) {
        MoneySupply._fill(R);
        const M = MoneySupply.config().mint;
        const pol = MoneySupply.policy(R);
        const purity = _purity(k);
        let fine = 0;
        // What the player sold the mint this week
        for (const [g, n] of Object.entries(R.mint.pending)) fine += Math.max(0, _num(n)) * _num(M.fine[g]);
        R.mint.pending = {};
        R.mint.playerWeek = 0;
        // Ore bought in the realm's markets
        let room = _num(M.weeklyFine) * _num(pol.draw, 1);
        const cfg = SettlementMarket.config();
        for (const g of ['gold_ore', 'silver_ore']) {
            const per = _num(M.fine[g]);
            const i = cfg.goodIds.indexOf(g);
            if (!(per > 0) || i < 0) continue;
            for (const s of towns) {
                if (!(room >= per)) break;
                const m = s.market;
                const stock = m && m.stock ? _num(m.stock[g]) : 0;
                if (!(stock > 0)) continue;
                const sh = SettlementMarket._shape(s);
                const surplus = stock - _num(sh.targetA[i]) * _num(M.keep, 1);
                if (!(surplus >= 1)) continue;
                const take = Math.floor(Math.min(surplus, room / per));
                if (take <= 0) continue;
                m.stock[g] = _r2(stock - take);
                fine += take * per;
                room -= take * per;
            }
        }
        const struck = fine > 0 ? _r2(fine / purity) : 0;
        let seign = _r2(struck * _num(pol.seigniorage));
        if (struck > 0) {
            R.coin = _r2(R.coin + struck - seign);
            MoneySupply._note(R, 'mint', struck - seign);
        }
        // Foreign coin brought in this week: `remint` of it is restruck, for the same charge
        const restruck = Math.min(R.coin, _num(R.wkIn) * _num(M.remint, 0.5));
        R.wkIn = 0;
        const brassage = _r2(restruck * _num(pol.seigniorage));
        if (brassage > 0) {
            R.coin = _r2(R.coin - brassage);
            MoneySupply._note(R, 'mint', -brassage);
            seign = _r2(seign + brassage);
        }
        if (seign > 0) {
            k.treasury = _num(k.treasury) + Math.floor(seign);
            CrownBooks.note(k, 'seigniorage', Math.floor(seign));
        }
        R.mint.struck = _r2(R.mint.struck + struck);
        R.mint.seign = _r2(R.mint.seign + seign);
        R.mint.lastStruck = struck;
        R.mint.lastSeign = seign;
        R.mint.seignHist.push(seign);
        const cap = Math.max(1, Math.floor(_num(M.seignHistory, 8)));
        if (R.mint.seignHist.length > cap) R.mint.seignHist.splice(0, R.mint.seignHist.length - cap);
        return { fine, struck, seign };
    },

    /** The mint's average weekly seigniorage over its kept history. */
    avgSeign(R) {
        const h = (R && R.mint && R.mint.seignHist) || [];
        return h.length ? h.reduce((s, v) => s + _num(v), 0) / h.length : 0;
    },

    // ── The week ──────────────────────────────────────────

    /**
     * The weekly turn (every `every` days): mints, trade settlement, Gresham,
     * flight, wear, hoarding, the price levels and their news. ctx: { panic:
     * Set of realm ids with a run on a bank (systems/mints.js gathers it) }.
     * @returns the news made, or null when it is not the day
     */
    processDay(world, ctx = {}) {
        if (!world || !MoneySupply.enabled()) return null;
        const C = MoneySupply.config();
        const st = MoneySupply.state(world);
        const day = _num(world.day);
        if (st.lastDay != null && day - st.lastDay < C.every && day >= st.lastDay) return null;
        st.lastDay = day;
        const alive = _alive(world);
        const byId = new Map(alive.map(k => [k.id, k]));
        for (const k of alive) MoneySupply.ensureRealm(world, k);
        // Fallen realms: their coin passes to the conqueror (or the richest realm)
        for (const kid of Object.keys(st.realms)) {
            if (byId.has(kid)) continue;
            const gone = st.realms[kid];
            const dead = _kingdom(world, kid);
            const heir = (dead && dead.conqueredBy && byId.get(dead.conqueredBy)) || alive.slice().sort((a, b) => st.realms[b.id].coin - st.realms[a.id].coin)[0];
            if (heir && gone && gone.coin > 0) {
                const R = st.realms[heir.id];
                R.coin = _r2(R.coin + gone.coin);
                MoneySupply._note(R, 'tribute', gone.coin);
            }
            delete st.realms[kid];
        }
        if (!alive.length) { st.trade = {}; return []; }

        // The realms' towns (live, for the mints)
        const towns = new Map();
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) {
            if (!byId.has(s.kingdom)) continue;
            const tile = typeof world.getTile === 'function' ? world.getTile(s.q, s.r) : null;
            const live = (tile && tile.settlement) || s;
            if (!live.market) continue;
            let list = towns.get(s.kingdom);
            if (!list) towns.set(s.kingdom, list = []);
            list.push(live);
        }

        // 1. Trade settles in specie (pairwise, with the price-specie flow)
        const pairs = new Map();
        for (const [key, v] of Object.entries(st.trade)) {
            const at = key.indexOf('>');
            const a = key.slice(0, at), b = key.slice(at + 1);
            if (!byId.has(a) || !byId.has(b)) continue;
            const lo = a < b ? a : b, hi = a < b ? b : a;
            const pk = `${lo}|${hi}`;
            let p = pairs.get(pk);
            if (!p) pairs.set(pk, p = { a: lo, b: hi, ab: 0, ba: 0 });
            if (a === lo) p.ab += _num(v); else p.ba += _num(v);
        }
        st.trade = {};
        const partners = new Map(); // kid → Map(kid → volume)
        const addPartner = (x, y, v) => {
            let m = partners.get(x);
            if (!m) partners.set(x, m = new Map());
            m.set(y, _num(m.get(y)) + v);
        };
        const T = C.trade;
        const tradeOut = new Map(); // coin each realm has paid out by trade this week (capped)
        for (const p of [...pairs.values()].sort((x, y) => (x.a + x.b).localeCompare(y.a + y.b))) {
            const Ra = st.realms[p.a], Rb = st.realms[p.b];
            const vol = p.ab + p.ba;
            if (!(vol > 0)) continue;
            addPartner(p.a, p.b, vol);
            addPartner(p.b, p.a, vol);
            // Coin from b to a: a's net exports settled in specie, plus what a wins back
            // from b for having less coin per head (the price-specie flow: on the
            // unclamped ratios, so a realm piling up coin past the clamp still sheds it)
            const gap = Math.log(Math.max(1e-3, _num(Rb.ratio, 1))) - Math.log(Math.max(1e-3, _num(Ra.ratio, 1)));
            const flow = _num(T.specie) * (p.ab - p.ba) + _num(T.hume) * gap * Math.min(Ra.coin, Rb.coin);
            const payer = flow > 0 ? p.b : p.a;
            const Rp = flow > 0 ? Rb : Ra, Rr = flow > 0 ? Ra : Rb;
            const room = Math.max(0, Rp.coin * _num(T.maxShare, 0.06) - _num(tradeOut.get(payer)));
            const amt = _r2(Math.min(Math.abs(flow), room));
            if (!(amt > 0)) continue;
            tradeOut.set(payer, _num(tradeOut.get(payer)) + amt);
            Rp.coin = _r2(Rp.coin - amt);
            Rr.coin = _r2(Rr.coin + amt);
            MoneySupply._note(Rp, 'trade', -amt);
            MoneySupply._note(Rr, 'trade', amt);
        }

        // 2. Gresham's law and coin flight: to the sounder trading partners
        const panic = ctx.panic instanceof Set ? ctx.panic : new Set();
        const F = C.flight;
        const inPanic = (k) => panic.has(k.id) || (k.finance && k.finance.lastDefaultDay != null && day - k.finance.lastDefaultDay <= _num(F.defaultDays, 30));
        const sendAbroad = (k, R, amount, kind) => {
            const p = _purity(k);
            let dest = [...((partners.get(k.id) || new Map()).entries())]
                .filter(([id]) => byId.has(id) && _purity(byId.get(id)) >= p && !inPanic(byId.get(id)));
            if (!dest.length) dest = alive.filter(o => o !== k && _purity(o) >= p && !inPanic(o)).map(o => [o.id, Math.max(1, st.realms[o.id].coin)]);
            const w = dest.reduce((s, [, v]) => s + v, 0);
            const amt = Math.min(_r2(amount), R.coin);
            if (!(w > 0) || !(amt > 0)) return 0;
            let sent = 0;
            for (const [id, v] of dest) {
                const part = _r2(amt * v / w);
                if (!(part > 0)) continue;
                const Ro = st.realms[id];
                Ro.coin = _r2(Ro.coin + part);
                MoneySupply._note(Ro, kind, part);
                sent += part;
            }
            R.coin = _r2(R.coin - sent);
            MoneySupply._note(R, kind, -sent);
            return sent;
        };
        for (const k of alive) {
            const R = st.realms[k.id];
            const p = _purity(k);
            if (p < 1) sendAbroad(k, R, R.coin * _num(C.gresham.rate) * (1 - p), 'gresham');
            if (inPanic(k)) sendAbroad(k, R, R.coin * _num(F.rate), 'flight');
        }

        // 3. The mints strike the week's bullion and restrike the foreign coin that came in
        for (const k of alive) MoneySupply.mintWeek(world, k, st.realms[k.id], towns.get(k.id) || []);

        // 4. The invisible balance: pilgrims, mercenaries' pay, smugglers and
        // travellers carry coin from the realms that have much of it to those that
        // have little, trade or no trade (drift × the log gap, the total kept)
        const D = _num(C.drift);
        if (D > 0 && alive.length > 1) {
            let up = 0, total = 0;
            const adj = new Map();
            for (const k of alive) {
                const R = st.realms[k.id];
                const a = R.coin * (Math.pow(Math.max(1e-3, _num(R.ratio, 1)), -D) - 1);
                adj.set(k.id, a);
                up += a;
                total += R.coin;
            }
            for (const k of alive) {
                const R = st.realms[k.id];
                const a = _r2(adj.get(k.id) - (total > 0 ? up * R.coin / total : 0));
                if (!a || R.coin + a < 0) continue;
                R.coin = _r2(R.coin + a);
                MoneySupply._note(R, 'drift', a);
            }
        }

        // 5. Wear, hoarding, and the price levels
        const V = C.velocity, L = C.level;
        let sumCV = 0, sumPop = 0;
        for (const k of alive) {
            const R = st.realms[k.id];
            const lost = _r2(R.coin * _num(C.wear));
            if (lost > 0) { R.coin = _r2(R.coin - lost); MoneySupply._note(R, 'wear', -lost); }
            const war = Array.isArray(k.wars) && k.wars.length > 0;
            const target = Math.max(_num(V.floor, 0.6), 1 - (war ? _num(V.war) : 0) - (inPanic(k) ? _num(V.panic) : 0));
            R.vel = _r4(R.vel + (target - R.vel) * _num(V.adjust, 0.3));
            R.pop = Math.max(1, _num(k.population));
            sumCV += R.coin * R.vel;
            sumPop += R.pop;
        }
        const norm = sumPop > 0 && sumCV > 0 ? sumCV / sumPop : 0;
        const made = [];
        const N = C.news;
        const cap = Math.max(4, Math.floor(_num(N.historyWeeks, 26)));
        for (const k of alive) {
            const R = st.realms[k.id];
            const prev = R.level;
            if (norm > 0) {
                const ratio = (R.coin * R.vel / R.pop) / norm;
                R.ratio = _r4(ratio);
                R.target = _r4(_clamp(Math.pow(Math.max(1e-6, ratio), _num(L.elasticity, 0.5)), _num(L.min, 0.9), _num(L.max, 1.12)));
                R.level = _r4(_clamp(R.level + (R.target - R.level) * _num(L.smoothing, 0.2), _num(L.min, 0.9), _num(L.max, 1.12)));
            }
            R.hist.push([day, Math.round(R.coin), R.level, R.vel]);
            if (R.hist.length > cap) R.hist.splice(0, R.hist.length - cap);
            R.last = R.wk;
            R.wk = _flows();
            // News: a coin shortage, a flood of coin
            const lastAt = st.newsAt[k.id];
            if (lastAt != null && day - lastAt < _num(N.gapWeeks, 8) * C.every) continue;
            let kind = null;
            if (R.level <= _num(N.shortAt, 0.94) && R.level < prev) kind = 'coin_short';
            else if (R.level >= _num(N.floodAt, 1.07) && R.level > prev) kind = 'coin_flood';
            if (!kind) continue;
            st.newsAt[k.id] = day;
            made.push(MoneySupply.record(world, { kind, kingdomId: k.id, kingdom: k.name, pct: Math.round((R.level - 1) * 100) }));
        }
        return made;
    },

    /** Put a record on the news (for the heralds and the townsfolk). */
    record(world, rec) {
        const st = MoneySupply.state(world);
        const day = _num(world && world.day);
        const k = _kingdom(world, rec.kingdomId);
        const cap = k && k.capital && Number.isFinite(k.capital.q) ? k.capital : null;
        const h = { key: `money:${rec.kind}:${rec.kingdomId}:${day}:${st.seq++}`, day, q: cap ? cap.q : null, r: cap ? cap.r : null, ...rec };
        st.news.push(h);
        const n = Math.max(4, Math.floor(_num(MoneySupply.config().news.cap, 30)));
        if (st.news.length > n) st.news.splice(0, st.news.length - n);
        return h;
    },

    /** Recent news of a kind for a realm (within `days`), or null. */
    recent(world, kid, kind, days = 60) {
        const day = _num(world && world.day);
        const list = MoneySupply.news(world);
        for (let i = list.length - 1; i >= 0; i--) {
            const h = list[i];
            if (day - _num(h.day) > days) break;
            if (h.kingdomId === kid && h.kind === kind) return h;
        }
        return null;
    },
};

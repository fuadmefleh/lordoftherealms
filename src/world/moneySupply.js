// ============================================
// MONEY SUPPLY — the coin in each realm, where it flows, and what it does
// to prices
// ============================================
// A realm's money is the real coin held in it — there is no second ledger.
// Once a week (`every` days) the census counts it:
//   • in circulation (world.money.realms[id].coin): the purses of the realm's
//     towns (settlement.economy.gold) and townsfolk, counted here, plus every
//     other purse located in the realm — gangs, guilds, inns, couriers,
//     caravans and armies on its roads, court NPCs, merchant houses, lairs,
//     adventurers — which systems/coinCensus.js
//     counts and systems/mints.js passes in (ctx.holders)
//   • out of circulation (broad money, moves no prices until it is spent):
//     the crown's chests (kingdom.treasury), the great landholders' coffers
//     (nobles, church, burghers, rival Houses), the banks' vaults, and the
//     player's purse while the player stands in the realm
// Coin moving between purses inside a realm changes nothing; coin crossing a
// border moves it between realms; coin made or destroyed (the mint, wear,
// debasement, a cheat) changes the world's total. Between censuses each flow
// is booked as it happens (note()), and the census books the rest of the
// week's change as 'other' (wages, taxes, rents, spending...).
// The weekly turn moves real coin, always out of and into town purses:
//   • trade      NPC trade across a border is paid town to town every day
//                (world/settlementMarket.js; collectTrade books it); on top,
//                the price-specie flow: a realm with less coin per head than
//                a trading partner is cheaper, sells it more and wins coin
//                back (hume × the gap in log coin per head × the smaller coin)
//   • transfers  tribute, indemnities, crown loans, plunder move treasury coin
//                (the callers move it; transfer() books it on both realms)
//   • Gresham    debased coin drives the good coin out to sounder partners
//   • flight     a run on a bank or a crown default sends coin abroad
//   • drift      pilgrims and travellers carry coin from rich realms to poor
//   • wear       a little of the towns' coin is lost every week
//   • the mint   strikes new coin from the gold and silver ore it buys in the
//                realm's markets (paid into the selling town's purse) and from
//                the player (paid into the player's purse); the crown's
//                seigniorage is struck into the treasury; foreign coin that
//                came in is restruck for the same charge, drawn from the towns
//   • the coin   (2026-11) the mint's standard (kingdom.finance.purity) is not
//     in hand   the coin in hand: after a debasement the old finer pieces
//                (R.lag) are restruck week by week — the crown keeps the extra
//                pieces their silver makes, prices follow the coin in hand —
//                and people hoard them meanwhile (velocity); clippers shave the
//                pieces (R.clip) and sell the silver as ore; the changers'
//                spread between two coins is friction on trade across their
//                border; a coin the people do not trust sours the towns
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
export const FLOW_KINDS = ['trade', 'tribute', 'loans', 'plunder', 'gresham', 'flight', 'mint', 'wear', 'debase', 'recoin', 'counterfeit', 'cheat', 'drift', 'fisc', 'other'];
/**
 * Flows booked against the hoards (the crown's chests, the player's purse):
 * on the realm's books, but not the coin in circulation.
 */
export const HOARD_FLOWS = new Set(['tribute', 'loans', 'plunder', 'debase', 'counterfeit', 'cheat']);
/** Flows that bring foreign coin into circulation (restruck at the realm's mint). */
const FOREIGN = new Set(['trade', 'gresham', 'flight']);

const DEFAULTS = {
    enabled: true, every: 7,
    level: { elasticity: 0.5, min: 0.9, max: 1.12, smoothing: 0.2 },
    velocity: { war: 0.12, panic: 0.1, adjust: 0.3, floor: 0.6 },
    trade: { hume: 0.04, maxShare: 0.06 },
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
    recoinage: { crownShare: 0.5, labour: 0.1, stability: 2, maxDebtRatio: 0.3, treasuryCover: 4, cooldown: 120, minGap: 0.05 },
    exchange: { perPurity: 0.25, max: 0.05, minGold: 50 },
    concession: { termDays: 120, share: 0.5, feeShare: 0.9, minFee: 40 },
    counterfeit: { minRank: 1, minStake: 100, maxStake: 600, gain: 0.55, base: 0.16, heatPer: 0.004, rankCut: 0.02, looser: 0.6, fineShare: 1, caughtHeat: 15, passHeat: 4, arrestChance: 0.5, cooldown: 7 },
    news: { shortAt: 0.94, floodAt: 1.07, gapWeeks: 8, cap: 30, historyWeeks: 26 },
    counsel: { bullionGain: 0.05, mintRadius: 25 },
    debasement: { firstCall: 0.3, restrike: 0.12, mix: 0.1, hoard: 0.6 },
    clip: { rate: 0.0006, max: 0.12, tolerance: 0.03, unrest: 1 },
    trust: { moodAt: 80, mood: 1, perPurity: 150, perClip: 150 },
};

const SECTIONS = ['level', 'velocity', 'trade', 'gresham', 'flight', 'income', 'recoinage', 'exchange', 'concession', 'counterfeit', 'news', 'counsel', 'debasement', 'clip', 'trust'];

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

/** The key of a pair of realms, the same both ways round. */
function _pairKey(a, b) {
    const x = String(a), y = String(b);
    return x < y ? `${x}|${y}` : `${y}|${x}`;
}

function _flows() {
    const o = {};
    for (const k of FLOW_KINDS) o[k] = 0;
    return o;
}

/** A town's purse (0 without one). */
function _purse(s) {
    const e = s && s.economy;
    return e && Number.isFinite(e.gold) ? Math.max(0, e.gold) : 0;
}

/**
 * Draw up to `amount` out of towns' purses, each in proportion to what it
 * holds (never below zero). → what was drawn (to the hundredth).
 */
function _drawTowns(towns, amount) {
    let want = _r2(Math.max(0, _num(amount)));
    if (!(want > 0) || !towns || !towns.length) return 0;
    let total = 0;
    for (const s of towns) total += _purse(s);
    if (!(total > 0)) return 0;
    want = Math.min(want, total);
    let drawn = 0;
    for (const s of towns) {
        const have = _purse(s);
        if (!(have > 0)) continue;
        const take = Math.min(have, Math.floor(want * have / total * 100) / 100);
        if (!(take > 0)) continue;
        s.economy.gold = _r2(have - take);
        drawn += take;
    }
    return _r2(drawn);
}

/**
 * Pay `amount` into towns' purses by their people (all to the first town
 * with a purse when nobody lives anywhere). → what was paid.
 */
function _payTowns(towns, amount) {
    const a = _r2(Math.max(0, _num(amount)));
    const list = (towns || []).filter(s => s && s.economy && Number.isFinite(s.economy.gold));
    if (!(a > 0) || !list.length) return 0;
    const pop = list.reduce((t, s) => t + Math.max(0, _num(s.population)), 0);
    let paid = 0;
    list.forEach((s, i) => {
        const part = i === list.length - 1 ? _r2(a - paid) : pop > 0 ? Math.floor(a * Math.max(0, _num(s.population)) / pop * 100) / 100 : 0;
        if (!(part > 0)) return;
        s.economy.gold = _r2(s.economy.gold + part);
        paid = _r2(paid + part);
    });
    return paid;
}

/**
 * The live towns of the living realms: Map(kid → [settlement]). Every
 * settlement with a realm (the tile's live record, not a view's copy).
 */
function _townsByRealm(world, byId) {
    const towns = new Map();
    const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
    for (const v of views) {
        const tile = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
        const live = (tile && tile.settlement) || v;
        const kid = live && live.kingdom;
        if (kid == null || (byId && !byId.has(kid))) continue;
        let list = towns.get(kid);
        if (!list) towns.set(kid, list = []);
        list.push(live);
    }
    return towns;
}

/** The coin in a realm's towns: { towns (their purses), folk (the townsfolk's rolled purses) }. */
function _townCoin(list) {
    let towns = 0, folk = 0;
    for (const s of list || []) {
        towns += _purse(s);
        const people = s.folk && Array.isArray(s.folk.people) ? s.folk.people : null;
        if (people) for (const p of people) if (p && !p.died && !p.away && typeof p.purse === 'number' && p.purse > 0) folk += p.purse;
    }
    return { towns: _r2(towns), folk: _r2(folk) };
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
        // (the changers' spread between each pair of realms' coins, set weekly: 'a|b' → share)
        if (!_obj(st.spreads)) st.spreads = {};
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
        // The census: coin in the towns' purses, the townsfolk's, other holders' (circulating);
        // the banks' vaults and the player's purse (hoards). counted: false until the first census
        // (an older save's abstract counter is replaced by it, with nothing booked)
        R.towns = _num(R.towns);
        R.folk = _num(R.folk);
        R.held = _num(R.held);
        R.coffers = _num(R.coffers);
        R.banks = _num(R.banks);
        R.purse = _num(R.purse);
        if (typeof R.counted !== 'boolean') R.counted = false;
        if (!_obj(R.wk)) R.wk = _flows();
        if (!_obj(R.last)) R.last = _flows();
        if (!_obj(R.tot)) R.tot = _flows();
        for (const o of [R.wk, R.last, R.tot]) {
            // (older saves booked flows this version no longer has: 'player')
            for (const k of Object.keys(o)) if (!FLOW_KINDS.includes(k)) delete o[k];
            for (const k of FLOW_KINDS) o[k] = _num(o[k]);
        }
        if (!Array.isArray(R.hist)) R.hist = [];
        const m = _obj(R.mint) || (R.mint = {});
        if (!MoneySupply.config().mint.policies[m.policy]) m.policy = 'normal';
        if (!_obj(m.pending)) m.pending = {};
        m.pendingPaid = _num(m.pendingPaid);
        m.playerWeek = _num(m.playerWeek);
        m.struck = _num(m.struck);
        m.seign = _num(m.seign);
        m.lastStruck = _num(m.lastStruck);
        m.lastSeign = _num(m.lastSeign);
        // (coin melted by recoinages: its silver went into the new coin)
        m.melted = _num(m.melted);
        if (!Array.isArray(m.seignHist)) m.seignHist = [];
        if (m.lastRecoin === undefined) m.lastRecoin = null;
        if (m.lease === undefined) m.lease = null;
        // The coin in hand (2026-11 minting and debasement): lag = how much finer the
        // pieces in circulation are than the mint's standard (old coin not yet
        // restruck; < 0: the mint strikes finer coin than circulates), clip = the
        // share of their weight clipped off; restruck / shaved: running totals
        R.lag = _clamp(_num(R.lag), -0.9, 0.9);
        R.clip = _clamp(_num(R.clip), 0, 0.9);
        R.restruck = _num(R.restruck);
        R.shaved = _num(R.shaved);
        R.silverCarry = _num(R.silverCarry);
        R.trust = _num(R.trust, 100);
        return R;
    },

    serialize(world) {
        const st = world && _obj(world.money);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    /**
     * After a load. Older saves: none — every realm is counted afresh on the
     * next weekly turn; an abstract counter from before the census is
     * replaced by the first count (counted: false), its level kept.
     */
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

    /**
     * Make sure a living realm has a record: its coin is the coin in its
     * towns' and townsfolk's purses now (the weekly census adds the other
     * holders).
     */
    ensureRealm(world, k) {
        if (!k || k.id == null) return null;
        const st = MoneySupply.state(world);
        let R = st.realms[k.id];
        if (!R) {
            const c = _townCoin(_townsByRealm(world, new Set([k.id])).get(k.id));
            R = st.realms[k.id] = MoneySupply._blank(c.towns + c.folk);
            R.towns = c.towns;
            R.folk = c.folk;
        }
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

    /**
     * Coin in circulation, in the crown's chests, in the great landholders'
     * coffers, in the banks' vaults and in the player's purse (as last counted
     * in the realm): { coin, treasury, coffers, banks, player, broad }.
     * `bankReserves` overrides the counted vaults.
     */
    broadMoney(world, kingdom, bankReserves = null) {
        const R = kingdom ? MoneySupply.realm(world, kingdom.id) : null;
        const coin = R ? R.coin : 0;
        const treasury = Math.max(0, _num(kingdom && kingdom.treasury));
        const banks = Math.max(0, bankReserves != null ? _num(bankReserves) : R ? R.banks : 0);
        const player = R ? Math.max(0, _num(R.purse)) : 0;
        const coffers = R ? Math.max(0, _num(R.coffers)) : 0;
        return { coin, treasury, coffers, banks, player, broad: coin + treasury + coffers + banks + player };
    },

    /** A realm's coin in circulation (rounded), or null when not seen yet. */
    coin(world, kid) {
        const R = MoneySupply.realm(world, kid);
        return R ? Math.round(R.coin) : null;
    },

    /** Silver content of a's coin in b's coin (what the money changers reckon): fineness in hand a / b. */
    exchangeRate(world, fromKid, toKid) {
        const a = _kingdom(world, fromKid), b = _kingdom(world, toKid);
        return _r4(MoneySupply.effective(world, a) / MoneySupply.effective(world, b));
    },

    /**
     * The silver in a realm's coin (O(1): read per price): { standard (the
     * mint's purity), circulating (the pieces in hand: standard + lag, the old
     * finer coin not yet restruck), clip (share of their weight clipped off),
     * effective (what a piece in hand is worth: circulating × (1 − the clipping
     * past `tolerance` — worn coin passes by tale until it is badly clipped)),
     * lag }. Without a record (or with the system off) all are the standard.
     */
    fineness(world, k) {
        const standard = _purity(k);
        const st = world && world.money;
        const R = st && st.realms && k ? st.realms[k.id] : null;
        if (!R || !MoneySupply.enabled()) return { standard, circulating: standard, clip: 0, effective: standard, lag: 0 };
        const lag = _num(R.lag);
        const circulating = _clamp(standard + lag, 0.1, 1);
        const clip = _clamp(_num(R.clip), 0, 0.9);
        const tol = _num(MoneySupply.config().clip.tolerance, 0.03);
        const effective = _clamp(circulating * (1 - Math.max(0, clip - tol)), 0.1, 1);
        return { standard, circulating, clip, effective, lag };
    },

    /** What a piece of the realm's coin in hand is worth in silver (1 = full weight). */
    effective(world, k) {
        return MoneySupply.fineness(world, k).effective;
    },

    /**
     * How far a realm's people and merchants trust the coin in their hands,
     * 0–100: a debased standard or coin (whichever is baser), clipping past the
     * tolerance, a recent crown default, past defaults.
     */
    trust(world, k, day = null) {
        if (!k) return 100;
        const C = MoneySupply.config();
        const fn = MoneySupply.fineness(world, k);
        let t = 100 - (1 - Math.min(fn.standard, fn.circulating)) * _num(C.trust.perPurity, 150)
            - Math.max(0, fn.clip - _num(C.clip.tolerance, 0.03)) * _num(C.trust.perClip, 150);
        const f = k.finance;
        if (f) {
            if (day != null && f.lastDefaultDay != null) t -= Math.max(0, 40 - (day - f.lastDefaultDay) / 6);
            t -= Math.min(30, _num(f.defaults) * 10);
        }
        return _clamp(Math.round(t), 0, 100);
    },

    /** The money changers' spread between two realms' coins (a share): perPurity × the gap in what a piece is worth, at most max. */
    spread(world, fromKid, toKid) {
        if (fromKid == null || toKid == null || fromKid === toKid) return 0;
        const E = MoneySupply.config().exchange;
        const gap = Math.abs(MoneySupply.effective(world, _kingdom(world, fromKid)) - MoneySupply.effective(world, _kingdom(world, toKid)));
        if (!(gap > 1e-9)) return 0;
        return _clamp(gap * _num(E.perPurity, 0.25), 0, _num(E.max, 0.05));
    },

    // ── The mint's standard: debasement and its slow spread ──

    /**
     * Set the mint's standard (kingdom.finance.purity). The coin in hand does
     * not change at once: the gap is carried as lag and closes week by week as
     * the old pieces are brought in to be restruck (a baser standard) or as the
     * new finer coin mixes in (a better one). @returns the new standard
     */
    setStandard(world, k, purity) {
        if (!k) return 1;
        if (!_obj(k.finance)) k.finance = { purity: 1 };
        const before = _purity(k);
        const p = _clamp(Math.round(_num(purity, before) * 1000) / 1000, 0.1, 1);
        k.finance.purity = p;
        const R = world && MoneySupply.enabled() && k.isAlive !== false && k.id != null ? MoneySupply.ensureRealm(world, k) : null;
        if (R) {
            MoneySupply._fill(R);
            let lag = R.lag + before - p;
            // (never finer than full weight, never baser than the floor)
            if (p + lag > 1) lag = 1 - p;
            if (p + lag < 0.1) lag = 0.1 - p;
            R.lag = _r4(lag);
        }
        return p;
    },

    /**
     * The mint calls in `share` of the old, finer coin still in hand and
     * strikes it anew at the (baser) standard: the holders get back as many
     * pieces as they brought, the crown keeps the extra pieces the same silver
     * makes. The pieces in hand are unchanged (and now baser); the crown's
     * gain is new coin made from that silver — booked 'debase', in the chests
     * until it is spent. @returns the crown's gain (whole coin)
     */
    restrike(world, k, share) {
        const R = k ? MoneySupply.realm(world, k.id) : null;
        if (!R || !MoneySupply.enabled()) return 0;
        MoneySupply._fill(R);
        if (!(R.lag > 1e-6)) return 0;
        const dl = R.lag * _clamp(_num(share), 0, 1);
        const gain = Math.floor(Math.max(0, R.coin) * dl / _purity(k));
        R.lag = _r4(Math.max(0, R.lag - dl));
        if (gain > 0) {
            k.treasury = _r2(_num(k.treasury) + gain);
            CrownBooks.note(k, 'debase', gain);
            MoneySupply._book(R, 'debase', gain);
            R.restruck = _r2(R.restruck + gain);
        }
        return gain;
    },

    /** A recoinage struck the coin anew at full weight: nothing old, nothing clipped in hand. */
    renewCoin(world, k) {
        const R = k ? MoneySupply.realm(world, k.id) : null;
        if (!R) return;
        MoneySupply._fill(R);
        R.lag = 0;
        R.clip = 0;
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

    /** The live towns of a realm (for the callers that move coin into or out of them). */
    towns(world, kid) {
        return _townsByRealm(world, new Set([kid])).get(kid) || [];
    },

    // ── Flows ─────────────────────────────────────────────

    /** Book a flow on a realm's week (no coin moves: the books only). */
    _book(R, kind, amount) {
        R.wk[kind] = _r2(_num(R.wk[kind]) + amount);
        R.tot[kind] = _r2(_num(R.tot[kind]) + amount);
        // Foreign coin coming into circulation is brought to the mint to be restruck (brassage)
        if (amount > 0 && FOREIGN.has(kind)) R.wkIn = _num(R.wkIn) + amount;
    },

    /**
     * Book coin that has already moved in real purses: `amount` (negative: out)
     * of `kind` in the realm. A circulating flow also moves the realm's counted
     * coin until the next census (which counts the purses afresh); a hoard flow
     * (HOARD_FLOWS: the crown's chests, the player's purse) is on the books
     * only. @returns the amount booked
     */
    note(world, kid, amount, kind = 'other') {
        if (!world || !MoneySupply.enabled()) return 0;
        const k = _kingdom(world, kid);
        const a = _r2(_num(amount));
        if (!k || k.isAlive === false || !a) return 0;
        const R = MoneySupply.ensureRealm(world, k);
        MoneySupply._book(R, kind, a);
        if (!HOARD_FLOWS.has(kind)) R.coin = _r2(Math.max(0, R.coin + a));
        return a;
    },

    /**
     * Coin made from nothing (the cheat panel) entering the realm its holder
     * stands in, booked under `kind`. The coin itself is wherever the caller
     * put it — the player's purse: a hoard, counted at the next census as
     * broad money, moving prices once it is spent into circulation.
     * @returns the amount booked
     */
    registerNew(world, kid, amount, kind = 'cheat') {
        return MoneySupply.note(world, kid, amount, kind);
    },

    /**
     * Book a payment between two crowns (tribute, an indemnity, a crown loan
     * and its repayment, the crown's share of plunder): the callers move the
     * treasury coin; it is booked out of one realm and into the other. The
     * coin in circulation does not move (it is in the chests; it circulates
     * when the crown spends it). @returns the amount booked
     */
    transfer(world, fromKid, toKid, amount, kind = 'tribute') {
        if (!MoneySupply.enabled() || fromKid == null || toKid == null || fromKid === toKid) return 0;
        const a = _kingdom(world, fromKid), b = _kingdom(world, toKid);
        if (!a || !b || a.isAlive === false || b.isAlive === false) return 0;
        const amt = _r2(Math.max(0, _num(amount)));
        if (!(amt > 0)) return 0;
        MoneySupply._book(MoneySupply.ensureRealm(world, a), kind, -amt);
        MoneySupply._book(MoneySupply.ensureRealm(world, b), kind, amt);
        return amt;
    },

    /**
     * Gather the day's cross-border NPC trade (link.valAB / valBA: the coin
     * the importing towns paid the exporters each way today, left by
     * SettlementMarket.flows) into the week's trade book, and book it on the
     * realms (the coin has already moved, town purse to town purse).
     */
    collectTrade(world, links) {
        if (!world || !Array.isArray(links)) return 0;
        const on = MoneySupply.enabled();
        const book = on ? MoneySupply.state(world).trade : null;
        let total = 0;
        // The money changers at the border: the spread between the two coins is
        // friction the next day's NPC trade must beat (link.changers, read by
        // SettlementMarket.flows; the week's spreads: world.money.spreads)
        const spreads = on ? MoneySupply.state(world).spreads : null;
        for (const link of links) {
            if (spreads) {
                const ka = link.a && link.a.kingdom, kb = link.b && link.b.kingdom;
                const sp = ka != null && kb != null && ka !== kb ? _num(spreads[_pairKey(ka, kb)]) : 0;
                if (sp > 0) link.changers = sp;
                else if (link.changers) link.changers = 0;
            }
            const ab = link.valAB, ba = link.valBA;
            if (!(ab > 0) && !(ba > 0)) continue;
            link.valAB = 0;
            link.valBA = 0;
            if (!on) continue;
            const ka = link.a && link.a.kingdom, kb = link.b && link.b.kingdom;
            if (ka == null || kb == null || ka === kb) continue;
            if (ab > 0) {
                const key = `${ka}>${kb}`;
                book[key] = _r2(_num(book[key]) + ab);
                total += ab;
                MoneySupply.note(world, ka, ab, 'trade');
                MoneySupply.note(world, kb, -ab, 'trade');
            }
            if (ba > 0) {
                const key = `${kb}>${ka}`;
                book[key] = _r2(_num(book[key]) + ba);
                total += ba;
                MoneySupply.note(world, kb, ba, 'trade');
                MoneySupply.note(world, ka, -ba, 'trade');
            }
        }
        return total;
    },

    /**
     * Book goods the player carried across a border into the week's trade
     * book (it makes the two realms trading partners, for the price-specie
     * flow, Gresham and flight): `value` of goods from realm `fromKid` sold in
     * realm `toKid`. The coin itself moved when the player paid and was paid.
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
     * markets (at most weeklyFine × the policy's draw of fine value), paying
     * each selling town in new coin (fine / purity, less the seigniorage);
     * the player was paid in new coin when they sold (mint.pendingPaid). The
     * crown's seigniorage is struck into its treasury. Foreign coin that came
     * into circulation this week is restruck in part (`remint`) for the same
     * charge, drawn from the towns' purses into the treasury. `towns` are the
     * realm's live settlements.
     * @returns { fine, struck (all new coin: towns + player + treasury), seign (to the crown), toTowns, toPlayer, brassage }
     */
    mintWeek(world, k, R, towns) {
        MoneySupply._fill(R);
        const M = MoneySupply.config().mint;
        const pol = MoneySupply.policy(R);
        const rate = _num(pol.seigniorage);
        const purity = _purity(k);
        let fine = 0;
        // What the player sold the mint this week (already paid in new coin)
        for (const [g, n] of Object.entries(R.mint.pending)) fine += Math.max(0, _num(n)) * _num(M.fine[g]);
        const toPlayer = _r2(R.mint.pendingPaid);
        R.mint.pending = {};
        R.mint.pendingPaid = 0;
        R.mint.playerWeek = 0;
        let seignRaw = fine > 0 ? fine / purity * rate : 0;
        // Ore bought in the realm's markets
        let room = _num(M.weeklyFine) * _num(pol.draw, 1);
        let toTowns = 0;
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
                // The mint pays the town for its ore in the new coin (less the seigniorage):
                // the struck coin enters circulation through the towns' purses
                const coin = take * per / purity;
                seignRaw += coin * rate;
                if (s.economy && Number.isFinite(s.economy.gold)) {
                    const pay = _r2(coin * (1 - rate));
                    s.economy.gold = _r2(s.economy.gold + pay);
                    toTowns = _r2(toTowns + pay);
                }
            }
        }
        const seign = Math.floor(seignRaw);
        const struck = _r2(toTowns + toPlayer + seign);
        if (toTowns > 0) {
            MoneySupply._book(R, 'mint', toTowns);
            R.coin = _r2(R.coin + toTowns);
        }
        // Foreign coin brought in this week: `remint` of it is restruck, for the same charge
        const restruck = Math.min(R.coin, _num(R.wkIn) * _num(M.remint, 0.5));
        R.wkIn = 0;
        const brassage = _drawTowns(towns, Math.floor(restruck * rate));
        if (brassage > 0) {
            MoneySupply._book(R, 'mint', -brassage);
            R.coin = _r2(Math.max(0, R.coin - brassage));
        }
        const toCrown = _r2(seign + brassage);
        if (toCrown > 0) {
            k.treasury = _r2(_num(k.treasury) + toCrown);
            CrownBooks.note(k, 'seigniorage', toCrown);
        }
        R.mint.struck = _r2(R.mint.struck + struck);
        R.mint.seign = _r2(R.mint.seign + toCrown);
        R.mint.lastStruck = struck;
        R.mint.lastSeign = toCrown;
        R.mint.seignHist.push(toCrown);
        const cap = Math.max(1, Math.floor(_num(M.seignHistory, 8)));
        if (R.mint.seignHist.length > cap) R.mint.seignHist.splice(0, R.mint.seignHist.length - cap);
        return { fine, struck, seign: toCrown, toTowns, toPlayer, brassage };
    },

    /** The mint's average weekly seigniorage over its kept history. */
    avgSeign(R) {
        const h = (R && R.mint && R.mint.seignHist) || [];
        return h.length ? h.reduce((s, v) => s + _num(v), 0) / h.length : 0;
    },

    // ── Moving real coin ──────────────────────────────────

    /**
     * Move up to `amount` of coin out of realm a's town purses into realm b's,
     * booked under `kind` on both. @returns the coin moved
     */
    _move(world, towns, ka, kb, amount, kind) {
        const st = MoneySupply.state(world);
        const Ra = st.realms[ka], Rb = st.realms[kb];
        if (!Ra || !Rb) return 0;
        const drawn = _drawTowns(towns.get(ka), amount);
        if (!(drawn > 0)) return 0;
        const paid = _payTowns(towns.get(kb), drawn);
        // (a realm with no town to take it: the coin goes back where it came from)
        if (paid < drawn) _payTowns(towns.get(ka), _r2(drawn - paid));
        if (!(paid > 0)) return 0;
        Ra.coin = _r2(Math.max(0, Ra.coin - paid));
        Rb.coin = _r2(Rb.coin + paid);
        Ra.towns = _r2(Math.max(0, Ra.towns - paid));
        Rb.towns = _r2(Rb.towns + paid);
        MoneySupply._book(Ra, kind, -paid);
        MoneySupply._book(Rb, kind, paid);
        return paid;
    },

    /**
     * The census: count each living realm's coin from the purses — its towns
     * and townsfolk here, `holders` (Map kid → { coin, banks, player }:
     * systems/coinCensus.js) for the rest — and book the week's change not
     * already booked as 'other' (wages, taxes, rents, the player's spending...).
     */
    census(world, towns, alive, holders = null) {
        const st = MoneySupply.state(world);
        for (const k of alive) {
            const R = st.realms[k.id];
            const c = _townCoin(towns.get(k.id));
            const h = holders && typeof holders.get === 'function' ? holders.get(k.id) : null;
            R.towns = c.towns;
            R.folk = c.folk;
            R.held = h ? _r2(_num(h.coin)) : 0;
            R.coffers = h ? _r2(_num(h.coffers)) : 0;
            R.banks = h ? _r2(_num(h.banks)) : 0;
            R.purse = h ? _r2(_num(h.player)) : 0;
            const coin = _r2(R.towns + R.folk + R.held);
            if (R.counted) {
                const rest = _r2(coin - R.coin);
                if (rest) MoneySupply._book(R, 'other', rest);
            }
            R.counted = true;
            R.coin = coin;
        }
    },

    // ── The week ──────────────────────────────────────────

    /**
     * The weekly turn (every `every` days): the census, the price-specie
     * flow, Gresham, flight, the mints, drift, wear, hoarding, the price
     * levels and their news. ctx: { panic: Set of realm ids with a run on a
     * bank, holders: Map kid → { coin, coffers, banks, player } of the purses beyond
     * the towns (systems/mints.js gathers both), barter: true while no town has
     * coin (census only), coinTown(settlement): which towns use coin in a world
     * still partly bartering (world/barter.js) }.
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
        const towns = _townsByRealm(world, byId);
        for (const k of alive) MoneySupply.ensureRealm(world, k);
        // Fallen realms: their towns (and the coin in them) now count for their new masters
        for (const kid of Object.keys(st.realms)) if (!byId.has(kid)) delete st.realms[kid];
        if (!alive.length) { st.trade = {}; return []; }

        // 0. The census: the coin is what the purses hold
        MoneySupply.census(world, towns, alive, ctx.holders || null);
        // Before coin (world/barter.js: ctx.barter, no town has coin yet) there is
        // nothing to flow, strike or price: the census counts the empty purses
        if (ctx.barter) { st.trade = {}; return []; }
        // (the ratios the flows read: this week's coin per head against the world's)
        let sum0 = 0, pop0 = 0;
        for (const k of alive) { sum0 += st.realms[k.id].coin; pop0 += Math.max(1, _num(k.population)); }
        const norm0 = pop0 > 0 && sum0 > 0 ? sum0 / pop0 : 0;
        const ratio = (k) => (norm0 > 0 ? (st.realms[k.id].coin / Math.max(1, _num(k.population))) / norm0 : 1);

        // 1. The trading partners (the week's book of coin paid across borders) and the price-specie flow
        const pairs = new Map();
        for (const [key, v] of Object.entries(st.trade)) {
            const at = key.indexOf('>');
            const a = key.slice(0, at), b = key.slice(at + 1);
            if (!byId.has(a) || !byId.has(b)) continue;
            const lo = a < b ? a : b, hi = a < b ? b : a;
            const pk = `${lo}|${hi}`;
            let p = pairs.get(pk);
            if (!p) pairs.set(pk, p = { a: lo, b: hi, vol: 0 });
            p.vol += _num(v);
        }
        st.trade = {};
        const partners = new Map(); // kid → Map(kid → volume)
        const addPartner = (x, y, v) => {
            let m = partners.get(x);
            if (!m) partners.set(x, m = new Map());
            m.set(y, _num(m.get(y)) + v);
        };
        const T = C.trade;
        const tradeOut = new Map();
        for (const p of [...pairs.values()].sort((x, y) => (x.a + x.b).localeCompare(y.a + y.b))) {
            if (!(p.vol > 0)) continue;
            addPartner(p.a, p.b, p.vol);
            addPartner(p.b, p.a, p.vol);
            // Coin from b to a for a having less coin per head (cheaper: it sells b more)
            const Ra = st.realms[p.a], Rb = st.realms[p.b];
            const gap = Math.log(Math.max(1e-3, ratio(byId.get(p.b)))) - Math.log(Math.max(1e-3, ratio(byId.get(p.a))));
            const flow = _num(T.hume) * gap * Math.min(Ra.coin, Rb.coin);
            const payer = flow > 0 ? p.b : p.a, payee = flow > 0 ? p.a : p.b;
            const room = Math.max(0, st.realms[payer].coin * _num(T.maxShare, 0.06) - _num(tradeOut.get(payer)));
            const amt = Math.min(Math.abs(flow), room);
            if (!(amt >= 0.01)) continue;
            const moved = MoneySupply._move(world, towns, payer, payee, amt, 'trade');
            tradeOut.set(payer, _num(tradeOut.get(payer)) + moved);
        }

        // 2. Gresham's law and coin flight: to the sounder trading partners
        const panic = ctx.panic instanceof Set ? ctx.panic : new Set();
        const F = C.flight;
        const inPanic = (k) => panic.has(k.id) || (k.finance && k.finance.lastDefaultDay != null && day - k.finance.lastDefaultDay <= _num(F.defaultDays, 30));
        const sendAbroad = (k, amount, kind) => {
            const p = _purity(k);
            let dest = [...((partners.get(k.id) || new Map()).entries())]
                .filter(([id]) => byId.has(id) && _purity(byId.get(id)) >= p && !inPanic(byId.get(id)));
            if (!dest.length) dest = alive.filter(o => o !== k && _purity(o) >= p && !inPanic(o)).map(o => [o.id, Math.max(1, st.realms[o.id].coin)]);
            const w = dest.reduce((s, [, v]) => s + v, 0);
            if (!(w > 0) || !(amount > 0)) return 0;
            let sent = 0;
            for (const [id, v] of dest) sent += MoneySupply._move(world, towns, k.id, id, amount * v / w, kind);
            return sent;
        };
        for (const k of alive) {
            const R = st.realms[k.id];
            const p = _purity(k);
            if (p < 1) sendAbroad(k, R.towns * _num(C.gresham.rate) * (1 - p), 'gresham');
            if (inPanic(k)) sendAbroad(k, R.towns * _num(F.rate), 'flight');
        }

        // 3. The mints strike the week's bullion and restrike the foreign coin that came in
        // (in a world still partly bartering, only towns that use coin sell ore to the mint: ctx.coinTown)
        for (const k of alive) {
            const list = towns.get(k.id) || [];
            MoneySupply.mintWeek(world, k, st.realms[k.id], typeof ctx.coinTown === 'function' ? list.filter(ctx.coinTown) : list);
        }

        // 3b. The coin in hand: after a debasement the old, finer pieces are brought
        // in to be restruck at the baser standard (the crown keeps the extra pieces
        // the same silver makes); after a better standard the finer new coin mixes
        // in; and the clippers shave the pieces, selling the silver in the realm's
        // largest market (the mint buys it back: the metal is never lost)
        const DB = C.debasement, CL = C.clip;
        const hasSilver = SettlementMarket.config().goodIds.indexOf('silver_ore') >= 0;
        const perSilver = _num(C.mint.fine.silver_ore, 16);
        for (const k of alive) {
            const R = st.realms[k.id];
            if (R.lag > 1e-6) MoneySupply.restrike(world, k, _num(DB.restrike, 0.12));
            else if (R.lag < -1e-6) R.lag = _r4(R.lag * (1 - _clamp(_num(DB.mix, 0.1), 0, 1)));
            const fn = MoneySupply.fineness(world, k);
            const unruly = 0.5 + _num(CL.unrest, 1) * (1 - _clamp(_num(k.stability, 50), 0, 100) / 100);
            const dclip = Math.min(Math.max(0, _num(CL.max, 0.12) - R.clip), _num(CL.rate) * unruly * fn.circulating);
            if (!(dclip > 0) || !(R.coin > 0)) continue;
            R.clip = Math.round((R.clip + dclip) * 1e6) / 1e6;
            const silver = R.coin * fn.circulating * dclip;
            R.shaved = _r2(R.shaved + silver);
            if (!hasSilver) continue;
            R.silverCarry = _num(R.silverCarry) + silver / perSilver;
            const units = Math.floor(R.silverCarry * 100) / 100;
            if (!(units >= 0.01)) continue;
            // (shared among the realm's markets by their people: the clippers are everywhere)
            const mk = (towns.get(k.id) || []).filter(s => s.market && _obj(s.market.stock));
            if (!mk.length) continue;
            const pop = mk.reduce((t, s) => t + Math.max(0, _num(s.population)), 0);
            let left = units;
            mk.forEach((s, i) => {
                const part = i === mk.length - 1 ? _r2(left) : Math.floor(units * (pop > 0 ? Math.max(0, _num(s.population)) / pop : 1 / mk.length) * 100) / 100;
                if (!(part > 0)) return;
                s.market.stock.silver_ore = _r2(_num(s.market.stock.silver_ore) + part);
                left = _r2(left - part);
            });
            R.silverCarry = _r4(R.silverCarry - units);
        }

        // 4. The invisible balance: pilgrims, mercenaries' pay, smugglers and
        // travellers carry coin from the realms that have much of it to those that
        // have little, trade or no trade (drift × the log gap): what leaves the rich
        // realms' towns is what reaches the poor realms'
        const D = _num(C.drift);
        if (D > 0 && alive.length > 1) {
            const adj = new Map();
            let up = 0, total = 0;
            for (const k of alive) {
                const R = st.realms[k.id];
                const a = R.coin * (Math.pow(Math.max(1e-3, ratio(k)), -D) - 1);
                adj.set(k.id, a);
                up += a;
                total += R.coin;
            }
            let pool = 0;
            const give = [];
            for (const k of alive) {
                const R = st.realms[k.id];
                const a = adj.get(k.id) - (total > 0 ? up * R.coin / total : 0);
                const list = towns.get(k.id) || [];
                if (a < 0) {
                    const drawn = _drawTowns(list, -a);
                    if (drawn > 0) {
                        pool = _r2(pool + drawn);
                        R.coin = _r2(Math.max(0, R.coin - drawn));
                        R.towns = _r2(Math.max(0, R.towns - drawn));
                        MoneySupply._book(R, 'drift', -drawn);
                    }
                } else if (a > 0 && list.some(s => s.economy && Number.isFinite(s.economy.gold))) give.push([k, a]);
            }
            const want = give.reduce((s, [, a]) => s + a, 0);
            let left = pool;
            give.forEach(([k, a], i) => {
                const part = i === give.length - 1 ? left : _r2(Math.min(left, pool * a / want));
                const paid = _payTowns(towns.get(k.id), part);
                if (!(paid > 0)) return;
                left = _r2(left - paid);
                const R = st.realms[k.id];
                R.coin = _r2(R.coin + paid);
                R.towns = _r2(R.towns + paid);
                MoneySupply._book(R, 'drift', paid);
            });
            // (no realm to take it: back to the first realm drawn on)
            if (left > 0) {
                const from = alive.find(k => _num(st.realms[k.id].wk.drift) < 0);
                if (from) {
                    const back = _payTowns(towns.get(from.id), left);
                    const R = st.realms[from.id];
                    R.coin = _r2(R.coin + back);
                    R.towns = _r2(R.towns + back);
                    MoneySupply._book(R, 'drift', back);
                }
            }
        }

        // 5. Wear, hoarding, and the price levels
        const V = C.velocity, L = C.level;
        let sumCV = 0, sumPop = 0;
        for (const k of alive) {
            const R = st.realms[k.id];
            const lost = _drawTowns(towns.get(k.id), R.towns * _num(C.wear));
            if (lost > 0) {
                R.coin = _r2(Math.max(0, R.coin - lost));
                R.towns = _r2(Math.max(0, R.towns - lost));
                MoneySupply._book(R, 'wear', -lost);
            }
            const war = Array.isArray(k.wars) && k.wars.length > 0;
            // (Gresham at home: while the old finer pieces are still about, people keep them back and spend the base ones)
            const hoardGood = Math.max(0, _num(R.lag)) * _num(DB.hoard, 0.6);
            const target = Math.max(_num(V.floor, 0.6), 1 - (war ? _num(V.war) : 0) - (inPanic(k) ? _num(V.panic) : 0) - hoardGood);
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
                const r = (R.coin * R.vel / R.pop) / norm;
                R.ratio = _r4(r);
                R.target = _r4(_clamp(Math.pow(Math.max(1e-6, r), _num(L.elasticity, 0.5)), _num(L.min, 0.9), _num(L.max, 1.12)));
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

        // 6. The changers' spread between every two coins (friction on the NPC trade
        // across their borders: collectTrade), and the people's trust in their coin —
        // a coin they do not trust sours the towns (settlement.happiness)
        st.spreads = {};
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const sp = MoneySupply.spread(world, alive[i].id, alive[j].id);
                if (sp > 0) st.spreads[_pairKey(alive[i].id, alive[j].id)] = _r4(sp);
            }
        }
        const TR = C.trust;
        for (const k of alive) {
            const R = st.realms[k.id];
            R.trust = MoneySupply.trust(world, k, day);
            const at = _num(TR.moodAt, 80);
            if (!(R.trust < at) || !(_num(TR.mood) > 0)) continue;
            const d = _num(TR.mood) * (at - R.trust) / at;
            for (const s of towns.get(k.id) || []) s.happiness = _r2(_clamp(_num(s.happiness, 50) - d, 0, 100));
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

    // ── Recoinage (the edict: systems/mints.js) ───────────

    /** The coin in a realm's town purses now (what a recoinage calls in). */
    townCoin(world, kid) {
        return _townCoin(MoneySupply.towns(world, kid)).towns;
    },

    /**
     * Call in a realm's town coin and strike it anew at full purity: each
     * town's purse is cut to `factor` of itself (holders get back purity +
     * crownShare × (1 − purity) of each piece; the crown's silver is melted
     * into the new coin). @returns the coin taken out of circulation
     */
    recoinTowns(world, k, factor) {
        const f = _clamp(_num(factor, 1), 0, 1);
        if (!k || f >= 1) return 0;
        let cut = 0;
        for (const s of MoneySupply.towns(world, k.id)) {
            const have = _purse(s);
            if (!(have > 0)) continue;
            const after = _r2(have * f);
            s.economy.gold = after;
            cut = _r2(cut + have - after);
        }
        if (cut > 0) {
            const R = MoneySupply.ensureRealm(world, k);
            MoneySupply._book(R, 'recoin', -cut);
            R.coin = _r2(Math.max(0, R.coin - cut));
            R.towns = _r2(Math.max(0, R.towns - cut));
        }
        return cut;
    },
};

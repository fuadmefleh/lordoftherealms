// ============================================
// TOWN TRADE — the townsfolk buy, sell and swap among themselves
// ============================================
// Every town with a roster (systems/townsfolk.js) trades within itself, with
// real goods and real coin moving between named holders:
//
//   HOUSEHOLDS keep a larder (settlement.townTrade.hh[key].l = { goodId:
//   units }) of what their people use — the market's own per-head need
//   (data/markets.json perCapita × the town's demand), food, fuel, drink,
//   clothes, tools, candles, salt — and shop to keep coverDays of it. A
//   purchase takes the units off the market's stock, into the larder, and
//   the coin out of the household's purses into the town's purse (the
//   market's), haggled a little either way. Every day they EAT from the
//   larder; what they eat is booked on the market (market.named), and the
//   market's next turn takes that much less from its own stock for the
//   town's people (world/settlementMarket.js processSettlement) — the named
//   households' share of the town's eating is theirs, not the market's, so
//   the town eats no more than before. What a household spent at market in
//   a season comes off its board (systems/townJobs.js payday: person.shopped)
//   — the coin goes to the town's purse once, not twice. A household that
//   cannot eat half its food goes hungry (person.hungry). Larders spoil as
//   the market's stores do. In a town that barters (world/barter.js
//   inKind) no coin passes: the household draws on the common store.
//
//   PRODUCERS (farmers, fishers, bakers, smiths…, data/townTrade.json wares)
//   keep back a share of what the town makes at its market turn
//   (`withhold`, read by processSettlement as ctx.withhold — market.withheld),
//   hold a little at home (their wares: what they sell a neighbour or the
//   player, or cry in the street) and take the rest to market at the next
//   step (`deliver`). Wages for that work stay townJobs' business: no coin
//   moves when the goods do.
//
//   NEIGHBOURS barter goods for goods of the same worth (eggs for bread) —
//   more in a barter town and among the poor; it warms them (ties) and
//   cools a grudge between them.
//
//   PEDLARS walk in from a neighbouring town with a pack bought at its
//   market (paid into its purse), sell door to door a little under the
//   stalls, sell what's left to the market, and move on with a new pack.
//   Their purse is first drawn from the town they set out from and is left
//   to the town where they give up the road (counted by coinCensus.js).
//
//   MERCHANTS: a caravan leaving a town with a roster (merchantCaravans.js
//   _spawn → `caravanMerchant`) is one of its merchants' ventures.
//
//   DISPUTES: a bargain driven too hard sours the buyer on the seller, and
//   a crooked seller now and then gives short weight (the overcharge into
//   their own purse) — caught, the market warden refunds the buyer and fines
//   them into the town's purse. Either leaves a grudge (systems/brawls.js
//   feuds, reason 'cheated') and a line in the buyer's life.
//
//   THE PLAYER buys from the same stock (so a player who buys a stall bare
//   leaves less, and dearer, for the town), and can buy a producer's wares
//   or a pedlar's pack direct (`sellToPlayer`, `sellFromPedlar`); free talk
//   (systems/npcChat.js) sells from the same real stock (`personStock`,
//   `consign` for those without a roster).
//
//   BURGLARS (systems/npcTheft.js) rob a household's pantry — this larder —
//   and its grown people's purses (`pantryOf`); what they take is gone from
//   it, so the household eats short and buys it again at its next step. The
//   watch's recovery puts it back (`toPantry`).
//
// Conservation: every unit moved is taken from one holder and given to
// another; `holdings` sums the larders, wares and packs, and the books
// (`book.eaten`, `book.spoiled`) count what left the economy. Deterministic:
// hashes of the world seed, the town, the day and the people — the shared
// RNG is never drawn. Old saves: the state is made on first sight.
// Data: data/townTrade.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Townsfolk } from './townsfolk.js';
import { TownJobs } from './townJobs.js';
import { Brawls } from './brawls.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _r2 = (v) => Math.round(v * 100) / 100;
const DUST = 1e-7;

let _cfg = null;
let _cfgSrc;

function _seed(world) {
    return (world && world.generationParams && world.generationParams.seed) || 1;
}

/** A single roll in [0, 1) from parts (well mixed). */
function _frac(...parts) {
    let h = Utils.hashStr(parts.join('|')) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function _pick(list, u) {
    return list && list.length ? list[Math.floor(u * list.length) % list.length] : null;
}

function _span(range, u) {
    const a = _arr(range);
    if (a.length < 2) return _num(a[0]);
    return _num(a[0]) + (_num(a[1]) - _num(a[0])) * u;
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/** The goods list entry (data/playerEconomy.json GOODS) for a good id. */
function _goodDef(id) {
    const g = DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS;
    return (g && g[String(id || '').toUpperCase()]) || null;
}

function _goodName(id) {
    const d = _goodDef(id);
    return String((d && d.name) || String(id || 'goods').replace(/_/g, ' ')).toLowerCase();
}

function _key(s) { return `${s.q},${s.r}`; }

/** A lot in whole hundredths, rounded down. */
function _lot(x) {
    return x > 0 ? Math.floor(x * 100 + 1e-6) / 100 : 0;
}

export const TownTrade = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.townTrade : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                enabled: d.enabled !== false && !!_obj(src),
                stepDays: Math.max(1, Math.round(_num(d.stepDays, 4))),
                household: { coverDays: 10, childShare: 0.6, minLot: 0.01, groups: ['food', 'fuel', 'drink', 'clothes', 'tools'], goods: ['candles', 'salt'], order: ['food', 'fuel', 'drink', 'clothes', 'tools', 'other'], poorBelow: 6, poorGroups: ['food', 'fuel'], maxStockShare: 0.5, hungryCover: 0.5, ...(_obj(d.household) || {}) },
                haggle: { spread: 0.08, souredAbove: 0.85, sourChance: 0.12, sourHeat: [12, 24], ...(_obj(d.haggle) || {}) },
                cheats: { chance: 0.04, crookedTraits: ['bold', 'stubborn'], crookedShare: 0.08, short: 0.2, caughtChance: 0.35, fineMult: 3, noticeChance: 0.4, heat: [25, 45], ...(_obj(d.cheats) || {}) },
                wares: { perHand: 0.06, maxShare: 0.25, keep: 2, trades: {}, ...(_obj(d.wares) || {}) },
                barter: { pairs: 3, chance: 0.25, inKind: 0.8, poorBonus: 0.25, minValue: 0.05, warm: 4, cool: 6, maxTies: 40, ...(_obj(d.barter) || {}) },
                pedlars: { enabled: true, everyDays: 24, seed: 30, seedShare: 0.02, packValue: 36, packUnits: 4, minMargin: 1.12, daysPerHex: 1, stayDays: 6, undercut: 0.06, sellShare: 0.9, maxTrips: 8, minPurse: 6, goods: [], names: ['Wat'], bynames: ['Pedlar'], ...(_obj(d.pedlars) || {}) },
                merchants: { jobs: ['merchant'], logEvery: 90, ...(_obj(d.merchants) || {}) },
                deals: { max: 30, ...(_obj(d.deals) || {}) },
                onMap: { deliverChance: 0.5, hawkChance: 0.25, hawkers: [], barterChance: 0.08, barterRadius: 12, hawkStay: [18, 30], barterStay: [10, 16], ...(_obj(d.onMap) || {}) },
                lines: _obj(d.lines) || {},
                annals: _obj(d.annals) || {},
            };
            // Which goods each producing trade keeps (and the trades of each good)
            _cfg.byGood = {};
            for (const [occ, goods] of Object.entries(_cfg.wares.trades || {})) {
                for (const g of _arr(goods)) (_cfg.byGood[g] = _cfg.byGood[g] || []).push(occ);
            }
        }
        return _cfg;
    },

    enabled() {
        return TownTrade.config().enabled;
    },

    // ──────────── STATE ────────────

    /** The town's trade record (made on first sight: old saves). */
    state(s, day = null) {
        if (!s || typeof s !== 'object') return null;
        let st = s.townTrade;
        if (!_obj(st)) {
            st = s.townTrade = { v: 1, day: day != null ? day : null, hh: {}, wares: {}, ties: {}, pedlars: [], book: {}, deals: [], lastPedlar: day != null ? day : null };
        }
        if (!_obj(st.hh)) st.hh = {};
        if (!_obj(st.wares)) st.wares = {};
        if (!_obj(st.ties)) st.ties = {};
        if (!Array.isArray(st.pedlars)) st.pedlars = [];
        if (!_obj(st.book)) st.book = {};
        if (!Array.isArray(st.deals)) st.deals = [];
        return st;
    },

    _book(st, k, n) {
        st.book[k] = _num(st.book[k]) + n;
    },

    /** Units that left the economy (eaten, worn out, spoiled): booked by kind and by good (st.gone). */
    _sink(st, kind, g, n) {
        if (!(n > 0)) return;
        st.book[kind] = _num(st.book[kind]) + n;
        if (!_obj(st.gone)) st.gone = {};
        st.gone[g] = _num(st.gone[g]) + n;
    },

    _deal(st, entry) {
        st.deals.push(entry);
        const max = Math.max(1, _num(TownTrade.config().deals.max, 30));
        if (st.deals.length > max) st.deals.splice(0, st.deals.length - max);
    },

    // ──────────── THE MARKET'S STOCK (exact) ────────────

    _stockTake(s, g, n) {
        if (!(n > 0) || !SettlementMarket.tracks(g)) return 0;
        const m = SettlementMarket.ensure(s);
        if (!m) return 0;
        const have = Math.max(0, _num(m.stock[g]));
        const got = Math.min(have, n);
        m.stock[g] = have - got;
        return got;
    },

    _stockAdd(s, g, n) {
        if (!(n > 0) || !SettlementMarket.tracks(g)) return 0;
        const m = SettlementMarket.ensure(s);
        if (!m) return 0;
        m.stock[g] = Math.max(0, _num(m.stock[g])) + n;
        return n;
    },

    /** The stall's price of one unit today (unrounded ask × the stock's scarcity), to the penny. */
    price(world, s, g, tile = null) {
        const def = _goodDef(g);
        if (!def) return null;
        const t = tile || (world && typeof world.getTile === 'function' ? world.getTile(s.q, s.r) : null);
        let v;
        try { v = Economy.marketAskBase(def, s, t, world) * SettlementMarket.scarcity(s, g); } catch (e) { v = _num(def.basePrice, 1); }
        return Math.max(0.01, _r2(_num(v, _num(def.basePrice, 1))));
    },

    _priceFn(world, s) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(s.q, s.r) : null;
        const cache = new Map();
        return (g) => {
            if (!cache.has(g)) cache.set(g, TownTrade.price(world, s, g, tile));
            return cache.get(g);
        };
    },

    /** Does the town barter (no coin passes)? */
    inKind(s) {
        return !!(s && s.inKind);
    },

    // ──────────── HOUSEHOLDS ────────────

    /** The household a person eats in: their family's house (townFamily hh), else the couple's, else their own. */
    hhKey(folk, p, day) {
        if (!p) return null;
        if (p.hh != null) return `h${p.hh}`;
        const adultAge = TownJobs.config().adultAge || 16;
        let head = p;
        if (Townsfolk.age(p, day) < adultAge) {
            const par = _arr(p.parents).map(id => Townsfolk.get(folk, id)).find(x => x && Townsfolk.isHere(x));
            if (par) {
                if (par.hh != null) return `h${par.hh}`;
                head = par;
            }
        }
        const sp = Townsfolk.get(folk, head.spouse);
        if (sp && Townsfolk.isHere(sp) && sp.hh == null) return `p${Math.min(head.id, sp.id)}`;
        return `p${head.id}`;
    },

    /** The town's households: [{ key, members, adults, weight }] in a fixed order. */
    households(folk, day) {
        const C = TownTrade.config().household;
        const adultAge = TownJobs.config().adultAge || 16;
        const map = new Map();
        for (const p of Townsfolk.residents(folk)) {
            if (p.jailedUntil != null && _num(p.jailedUntil) > day) continue;
            const key = TownTrade.hhKey(folk, p, day);
            let h = map.get(key);
            if (!h) map.set(key, h = { key, members: [], adults: [], weight: 0 });
            h.members.push(p);
            const grown = Townsfolk.age(p, day) >= adultAge;
            if (grown) h.adults.push(p);
            h.weight += grown ? 1 : _num(C.childShare, 0.6);
        }
        return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    },

    larder(st, key, day = null) {
        let h = st.hh[key];
        if (!_obj(h)) h = st.hh[key] = { l: {}, since: day };
        if (!_obj(h.l)) h.l = {};
        return h;
    },

    /** Coin the household's grown people hold between them. */
    purseOf(folk, hh, world) {
        let t = 0;
        for (const p of hh.adults) t += Math.max(0, Townsfolk.purse(folk, p, world));
        return _r2(t);
    },

    /**
     * Take `n` coin from the household's grown people — each their even share
     * first, the fullest purses making up what the others can't: what they
     * paid. Each one's share is board spent at market (p.shopped).
     */
    _payFrom(folk, hh, world, n) {
        let left = _r2(Math.max(0, n));
        const order = hh.adults.slice().sort((a, b) => Townsfolk.purse(folk, b, world) - Townsfolk.purse(folk, a, world) || a.id - b.id);
        let paid = 0;
        const share = order.length > 1 ? Math.floor(left / order.length * 100) / 100 : left;
        for (const pass of order.length > 1 ? [share, Infinity] : [Infinity]) {
            for (const p of order) {
                if (!(left > 0)) break;
                const have = Math.max(0, Townsfolk.purse(folk, p, world));
                const take = _r2(Math.min(have, left, pass));
                if (!(take > 0)) continue;
                p.purse = _r2(have - take);
                p.shopped = _r2(_num(p.shopped) + take);
                left = _r2(left - take);
                paid = _r2(paid + take);
            }
        }
        return paid;
    },

    /** Give `n` coin back to a household (a refund): to its first grown person. */
    _payTo(folk, hh, world, n) {
        const p = hh.adults[0];
        if (!p || !(n > 0)) return 0;
        p.purse = _r2(Townsfolk.purse(folk, p, world) + n);
        // (the refund comes off what they spent at market)
        if (_num(p.shopped) > 0) p.shopped = _r2(Math.max(0, p.shopped - n));
        return n;
    },

    /**
     * What one person a day uses of each good a household keeps, in this
     * town: [{ g, rate, group, spoil }] (the market's per-head need).
     */
    rates(s) {
        const C = TownTrade.config().household;
        const groups = new Set(_arr(C.groups));
        const goods = new Set(_arr(C.goods));
        const pop = Math.max(1, _num(s && s.population));
        const out = [];
        for (const g of SettlementMarket.config().goodIds) {
            const def = SettlementMarket.good(g);
            if (!def) continue;
            const grp = def.group || null;
            if (!(grp && groups.has(grp)) && !goods.has(g)) continue;
            const need = SettlementMarket.need(s, g);
            if (!(need > 0)) continue;
            out.push({ g, rate: need / pop, group: grp || 'other', spoil: _num(def.spoil) });
        }
        const order = _arr(C.order);
        const ix = (grp) => { const i = order.indexOf(grp); return i < 0 ? order.length : i; };
        out.sort((a, b) => ix(a.group) - ix(b.group) || b.rate - a.rate || (a.g < b.g ? -1 : 1));
        return out;
    },

    /** What the household wants to hold of each good: coverDays of its people's use (cover[group]: longer for what lasts — a month's candles, a season's clothes). */
    target(hh, r) {
        const H = TownTrade.config().household;
        const days = _obj(H.cover) && H.cover[r.group] != null ? H.cover[r.group] : H.coverDays;
        return r.rate * hh.weight * _num(days, 10);
    },

    // ──────────── THE OFF-MAP STEP ────────────

    /** The daily hook (from Townsfolk.processDay): every stepDays, each town with a roster trades. */
    processDay(world, player = null) {
        if (!TownTrade.enabled() || !world || typeof world.getSettlementViews !== 'function') return;
        const day = _num(world.day, 1);
        for (const v of world.getSettlementViews()) {
            const tile = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
            const s = (tile && tile.settlement) || v;
            if (!s || !_obj(s.folk) || !Array.isArray(s.folk.people)) continue;
            TownTrade.catchUp(world, s, day, player);
        }
    },

    /**
     * Every trade step of a town not yet lived, up to `upTo` — the same steps
     * whether lived day by day (processDay) or caught up late with the
     * town's other lives (systems/townsfolk.js _days, interleaved with the
     * sick by the day). Steps land on the town's own slot days (staggered by
     * place, so the towns don't all trade on the same day); the state is
     * anchored to the roster's own clock on first sight (not today), and
     * each step sees the world as of its own day.
     */
    catchUp(world, s, upTo, player = null) {
        if (!TownTrade.enabled() || !s || !_obj(s.folk) || !Array.isArray(s.folk.people)) return;
        const C = TownTrade.config();
        const step = C.stepDays;
        const fresh = !_obj(s.townTrade);
        const anchor = Math.min(_num(upTo, 1), _num(s.folk.tick, _num(upTo, 1)));
        const st = TownTrade.state(s, anchor);
        if (fresh || st.day == null) st.day = anchor - step;
        // (a town first seen is not between pedlars by chance on the day: one may be in its streets already)
        if (!st.pedSeeded) TownTrade._seedPedlars(world, s, st, anchor);
        const slot = (Utils.hashStr(`tt|${s.q},${s.r}`) >>> 0) % step;
        // (the first slot day after the last step at least a step on)
        let d = st.day + step;
        d += (((slot - d) % step) + step) % step;
        for (let guard = 0; d <= upTo && guard < 5000; d += step, guard++) {
            let at = world;
            if (world && _num(world.day) !== d) { at = Object.create(world); at.day = d; }
            TownTrade.step(at, s, d, player);
        }
    },

    /**
     * One step of a town's trade, for the days since the last: the withheld
     * wares handed out and taken to market, the households eat, a pedlar
     * at the door sells, neighbours barter, the households shop for the rest. → { bought, eaten, bartered }.
     */
    step(world, s, day, player = null) {
        const folk = s && s.folk;
        if (!_obj(folk) || !TownTrade.enabled()) return null;
        const C = TownTrade.config();
        const st = TownTrade.state(s, day);
        const last = st.day == null ? day - C.stepDays : st.day;
        const days = Math.max(1, Math.min(60, day - last));
        st.day = day;
        SettlementMarket.ensure(s);
        try { TownJobs.ensure(folk, s, world, day); } catch (e) { /* (a roster without jobs trades without producers) */ }
        const hhs = TownTrade.households(folk, day);
        const rates = TownTrade.rates(s);
        const price = TownTrade._priceFn(world, s);
        TownTrade._prune(s, st, folk, hhs, day);
        TownTrade._handOut(s, st, folk, day);
        TownTrade.deliver(s, st, folk, day);
        const out = { bought: 0, eaten: 0, bartered: 0 };
        for (const hh of hhs) out.eaten += TownTrade._eat(s, st, folk, hh, rates, days, day);
        // (a pedlar at the door comes first: a little under the stalls' price)
        TownTrade._pedlarStep(world, s, st, folk, hhs, rates, price, day, player);
        // (neighbours swap what they have over before going to market for the rest)
        out.bartered = TownTrade._barterRound(world, s, st, folk, hhs, rates, price, day);
        for (const hh of hhs) out.bought += TownTrade._shop(world, s, st, folk, hh, rates, price, day);
        return out;
    },

    /** Larders of households no more, and wares of producers no more, go to market. */
    _prune(s, st, folk, hhs, day) {
        const live = new Set(hhs.map(h => h.key));
        for (const key of Object.keys(st.hh)) {
            if (live.has(key)) continue;
            const L = _obj(st.hh[key] && st.hh[key].l) || {};
            for (const [g, n] of Object.entries(L)) if (n > 0) TownTrade._stockAdd(s, g, n);
            delete st.hh[key];
        }
        for (const pid of Object.keys(st.wares)) {
            const p = Townsfolk.get(folk, Number(pid));
            if (p && Townsfolk.isHere(p) && TownTrade.producerGoods(p).length) continue;
            for (const [g, n] of Object.entries(st.wares[pid] || {})) if (n > 0) TownTrade._stockAdd(s, g, n);
            delete st.wares[pid];
        }
        // Ties to households gone
        const keys = Object.keys(st.ties);
        const max = Math.max(4, _num(TownTrade.config().barter.maxTies, 40));
        if (keys.length > max) {
            keys.sort((a, b) => st.ties[a] - st.ties[b] || (a < b ? -1 : 1));
            for (const k of keys.slice(0, keys.length - max)) delete st.ties[k];
        }
        void day;
    },

    // ──────────── EATING ────────────

    _eat(s, st, folk, hh, rates, days, day) {
        const C = TownTrade.config().household;
        const H = TownTrade.larder(st, hh.key, day);
        const L = H.l;
        const m = SettlementMarket.ensure(s);
        const named = _obj(m.named) || (m.named = {});
        const short = {};
        let need = 0, ate = 0, total = 0;
        for (const r of rates) {
            const want = r.rate * hh.weight * days;
            let have = _num(L[r.g]);
            if (have > 0 && r.spoil > 0) {
                const keep = Math.pow(1 - r.spoil, days);
                const lost = have * (1 - keep);
                have -= lost;
                TownTrade._sink(st, 'spoiled', r.g, lost);
            }
            const eat = Math.min(have, want);
            have -= eat;
            if (eat > 0) { named[r.g] = _num(named[r.g]) + eat; total += eat; TownTrade._sink(st, 'eaten', r.g, eat); }
            if (r.group === 'food') { need += want; ate += eat; }
            if (want - eat > 0) short[r.group] = _num(short[r.group]) + (want - eat);
            TownTrade._setL(st, L, r.g, have);
        }
        // Staples stand in for each other within food and fuel (as at market)
        for (const grp of ['food', 'fuel']) {
            let left = _num(short[grp]);
            if (!(left > 0)) continue;
            for (const r of rates) {
                if (r.group !== grp || !(left > 0)) continue;
                const have = _num(L[r.g]);
                if (!(have > 0)) continue;
                const use = Math.min(have, left);
                left -= use;
                named[r.g] = _num(named[r.g]) + use;
                total += use;
                TownTrade._sink(st, 'eaten', r.g, use);
                if (grp === 'food') ate += use;
                TownTrade._setL(st, L, r.g, have - use);
            }
        }
        // Hungry: under half their food eaten in a dearth (not on the first step, the larder
        // still empty). Out of a dearth a household that can't buy is fed as before — by the
        // town's own stores, alms and plainer fare (the market's eating, not their larder)
        const cover = need > 0 ? ate / need : 1;
        H.cover = Math.round(cover * 100) / 100;
        let dearth = false;
        try { dearth = SettlementMarket.inDearth(s); } catch (e) { dearth = false; }
        if (dearth && H.since != null && H.since < day && cover < _num(C.hungryCover, 0.5)) {
            for (const p of hh.members) p.hungry = day;
        }
        return total;
    },

    /** Set a larder's units (dust to nothing: booked as eaten so not a unit is lost). */
    _setL(st, L, g, v) {
        if (v > DUST) { L[g] = v; return; }
        if (v > 0) TownTrade._sink(st, 'eaten', g, v);
        delete L[g];
    },

    // ──────────── SHOPPING ────────────

    /** The seller of a good in town: a named hand at its trade, else a stallkeeper or merchant, else null (the market's own). */
    sellerOf(folk, g, day, salt = '') {
        if (!folk) return null;
        const C = TownJobs.config();
        const occ = (C.goodOcc && C.goodOcc[g]) || null;
        const free = (p) => p.job && p.job.employer !== 'player' && Townsfolk.age(p, day) >= (C.adultAge || 16);
        let list = occ ? Townsfolk.residents(folk).filter(p => free(p) && p.job.id === occ) : [];
        if (!list.length) list = Townsfolk.residents(folk).filter(p => free(p) && (p.job.id === 'stallkeeper' || p.job.id === 'merchant'));
        if (!list.length) return null;
        list.sort((a, b) => a.id - b.id);
        return _pick(list, _frac('seller', folk.q, folk.r, g, day, salt));
    },

    /** Is this seller the crooked kind (their traits, or a hash share)? */
    crooked(p) {
        if (!p) return false;
        const K = TownTrade.config().cheats;
        if (_arr(p.traits).some(t => _arr(K.crookedTraits).includes(t))) return true;
        return _frac('crooked', p.id, p.born) < _num(K.crookedShare, 0.08);
    },

    /** Is this household poor (its purses under poorBelow)? */
    poor(folk, hh, world) {
        return TownTrade.purseOf(folk, hh, world) < _num(TownTrade.config().household.poorBelow, 6);
    },

    _shop(world, s, st, folk, hh, rates, price, day) {
        if (!hh.adults.length) return 0;
        const C = TownTrade.config().household;
        const H = TownTrade.larder(st, hh.key, day);
        const L = H.l;
        const kind = TownTrade.inKind(s);
        const poor = !kind && TownTrade.poor(folk, hh, world);
        const groups = poor ? new Set(_arr(C.poorGroups)) : null;
        // What lasts (clothes, tools, candles…) only from coin over a reserve for the
        // staples (reserveDays of their food and fuel at today's prices): bread first
        const staples = new Set(_arr(C.poorGroups));
        let reserve = 0;
        if (!kind) for (const r of rates) if (staples.has(r.group)) reserve += r.rate * hh.weight * _num(C.reserveDays, 20) * _num(price(r.g), 0);
        let spent = 0;
        // (a trip to market can go wrong once: the first lot bought is the one haggled hard over)
        let dispute = true;
        for (const r of rates) {
            if (groups && !groups.has(r.group)) continue;
            if (!kind && !staples.has(r.group) && TownTrade.purseOf(folk, hh, world) < reserve) continue;
            const deficit = TownTrade.target(hh, r) - _num(L[r.g]);
            let qty = _lot(deficit);
            if (qty < _num(C.minLot, 0.01)) continue;
            qty = Math.min(qty, _lot(SettlementMarket.stock(s, r.g) * _num(C.maxStockShare, 0.5)));
            if (qty < _num(C.minLot, 0.01)) continue;
            if (kind) {
                // Before coin: the household draws on the common store
                const got = TownTrade._stockTake(s, r.g, qty);
                L[r.g] = _num(L[r.g]) + got;
                TownTrade._book(st, 'common', got);
                continue;
            }
            const res = TownTrade.buy(world, s, st, folk, hh, r.g, qty, { price: price(r.g), day, dispute });
            // (the first lot with a named seller is the one a dispute can come of)
            if (res && res.qty > 0) { spent += res.cost; if (res.seller) dispute = false; }
            if (res && res.broke) break;
        }
        if (H.since == null) H.since = day;
        if (spent > 0) TownTrade._shareBoard(folk, hh, day);
        return spent;
    },

    /**
     * What the household spent at market is its grown people's board between
     * them (person.shopped, which townJobs' payday takes off each one's board):
     * shared by what each one's board is — their own, and the children they
     * keep — so no one is credited past their own board while another pays
     * theirs in full. Coin is not moved: the credit is.
     */
    _shareBoard(folk, hh, day) {
        if (hh.adults.length < 2) return;
        const L = TownJobs.config().living || {};
        const kidW = _num(L.child, 0.12) / Math.max(0.01, _num(L.perDay, 0.32));
        const adultAge = TownJobs.config().adultAge || 16;
        const w = hh.adults.map(p => 1 + kidW * hh.members.filter(k => Townsfolk.age(k, day) < adultAge && _arr(k.parents)[0] === p.id).length);
        const wT = w.reduce((a, b) => a + b, 0);
        const total = _r2(hh.adults.reduce((t, p) => t + _num(p.shopped), 0));
        let left = total;
        hh.adults.forEach((p, i) => {
            const share = i === hh.adults.length - 1 ? left : _r2(total * w[i] / wT);
            p.shopped = _r2(share);
            left = _r2(left - share);
        });
    },

    /**
     * A household buys `qty` units of `g` at the market: haggled from the
     * stall's price, off the market's stock into its larder, the coin from
     * its purses into the town's (the overcharge of short weight into the
     * crooked seller's). opts { price, day, seller, salt, haggle (0..1),
     * dispute (false: no short weight or souring on this lot — a trip's later lots) }
     * → { qty (received), cost, seller, cheated, caught, dear, broke }.
     */
    buy(world, s, st, folk, hh, g, qty, opts = {}) {
        const C = TownTrade.config();
        const day = _num(opts.day, _num(world && world.day, 1));
        const unit = _num(opts.price, 0) > 0 ? opts.price : TownTrade.price(world, s, g);
        if (!(unit > 0)) return null;
        const salt = opts.salt || '';
        const u = opts.haggle != null ? opts.haggle : _frac(_seed(world), 'hg', s.q, s.r, day, hh.key, g, salt);
        const factor = 1 + _num(C.haggle.spread) * (2 * u - 1);
        const each = unit * factor;
        const have = TownTrade.purseOf(folk, hh, world);
        let n = _lot(Math.min(qty, have / each));
        if (n < _num(C.household.minLot, 0.01)) return { qty: 0, cost: 0, broke: true };
        n = Math.min(n, _lot(SettlementMarket.stock(s, g)));
        if (!(n > 0)) return { qty: 0, cost: 0 };
        let cost = Math.max(0.01, _r2(n * each));
        if (cost > have) cost = _r2(have);
        // Short weight from a crooked seller
        const seller = opts.seller !== undefined ? opts.seller : TownTrade.sellerOf(folk, g, day, `${hh.key}${salt}`);
        const K = C.cheats;
        const cheat = !!(opts.dispute !== false && seller && !hh.members.includes(seller) && TownTrade.crooked(seller)
            && _frac(_seed(world), 'cheat', s.q, s.r, day, hh.key, g, salt) < _num(K.chance, 0.04));
        const got = cheat ? _lot(n * (1 - _num(K.short, 0.2))) : n;
        const over = cheat ? _r2(cost - _r2(got * each)) : 0;
        // The goods: what was handed over comes off the stock
        const taken = TownTrade._stockTake(s, g, got);
        const H = TownTrade.larder(st, hh.key, day);
        H.l[g] = _num(H.l[g]) + taken;
        // The coin
        const paid = TownTrade._payFrom(folk, hh, world, cost);
        const toSeller = Math.min(over, paid);
        if (toSeller > 0) seller.purse = _r2(Townsfolk.purse(folk, seller, world) + toSeller);
        Economy.payTown(s, _r2(paid - toSeller));
        TownTrade._book(st, 'bought', _r2(paid));
        TownTrade._book(st, 'units', taken);
        const out = { qty: taken, cost: _r2(paid), seller, cheated: cheat, caught: false, dear: u >= _num(C.haggle.souredAbove, 0.85) };
        // A bargain driven too hard: the buyer's sour on the seller
        const buyer = hh.adults[0];
        if (out.dear && opts.dispute !== false && seller && buyer && !hh.members.includes(seller)
            && _frac(_seed(world), 'sour', s.q, s.r, day, hh.key, g, salt) < _num(C.haggle.sourChance, 0.12)) {
            TownTrade.grudge(world, s, buyer, seller, day, _span(C.haggle.sourHeat, _frac('sh', day, hh.key, g)), 'dear', g);
        }
        if (cheat && toSeller > 0) TownTrade._cheatOut(world, s, st, folk, hh, seller, g, toSeller, day, salt, out);
        if (opts.log !== false) TownTrade._deal(st, { d: day, k: 'buy', a: buyer ? buyer.id : null, b: seller ? seller.id : null, g, n: _r2(taken), c: out.cost });
        return out;
    },

    /** Short weight found out (or not): refund and fine, or a grudge. */
    _cheatOut(world, s, st, folk, hh, seller, g, over, day, salt, out) {
        const K = TownTrade.config().cheats;
        const buyer = hh.adults[0];
        TownTrade._book(st, 'cheats', 1);
        if (_frac(_seed(world), 'caught', s.q, s.r, day, hh.key, g, salt) < _num(K.caughtChance, 0.35)) {
            // The market warden: the buyer refunded, the cheat fined into the town's purse
            const back = _r2(Math.min(over, Townsfolk.purse(folk, seller, world)));
            seller.purse = _r2(Townsfolk.purse(folk, seller, world) - back);
            TownTrade._payTo(folk, hh, world, back);
            const fine = _r2(Math.min(over * _num(K.fineMult, 3), Townsfolk.purse(folk, seller, world)));
            seller.purse = _r2(Townsfolk.purse(folk, seller, world) - fine);
            Economy.payTown(s, fine);
            TownTrade._book(st, 'caught', 1);
            TownTrade._book(st, 'fines', fine);
            Townsfolk.note(seller, day, 'fined', buyer ? buyer.id : null, g);
            Townsfolk.record(folk, world, day, { k: 'fined', a: seller.id, b: buyer ? buyer.id : null, x: g });
            if (buyer) TownTrade.grudge(world, s, buyer, seller, day, _span(K.heat, _frac('ch', day, seller.id)), 'short', g);
            out.caught = true;
        } else if (buyer && _frac(_seed(world), 'notice', s.q, s.r, day, hh.key, g, salt) < _num(K.noticeChance, 0.4)) {
            TownTrade.grudge(world, s, buyer, seller, day, _span(K.heat, _frac('ch', day, seller.id)), 'short', g);
        }
    },

    /**
     * A bad bargain between two townsfolk: the buyer's life remembers it
     * ('cheated') and a grudge starts or warms (systems/brawls.js feuds,
     * reason 'cheated') — what the brawls already read.
     */
    grudge(world, s, buyer, seller, day, heat, how = 'dear', g = null) {
        if (!buyer || !seller || buyer === seller) return null;
        Townsfolk.note(buyer, day, 'cheated', seller.id, `${how}|${g || ''}`);
        let f = null;
        try { f = Brawls.addFeud(s, buyer.id, seller.id, 'cheated', day, Math.round(_num(heat, 15))); } catch (e) { f = null; }
        TownTrade._book(TownTrade.state(s), 'grudges', 1);
        return f;
    },

    // ──────────── PRODUCERS ────────────

    /** The goods a person keeps as wares by their trade ([] for none). */
    producerGoods(p) {
        if (!p || !p.job || p.job.employer === 'player') return [];
        return _arr(TownTrade.config().wares.trades[p.job.id]);
    },

    _producers(folk, day, g = null) {
        const adult = TownJobs.config().adultAge || 16;
        return Townsfolk.residents(folk)
            .filter(p => Townsfolk.age(p, day) >= adult && TownTrade.producerGoods(p).length && (g == null || TownTrade.producerGoods(p).includes(g)))
            .sort((a, b) => a.id - b.id);
    },

    wares(st, pid) {
        const w = st.wares[pid];
        return _obj(w) ? w : (st.wares[pid] = {});
    },

    /**
     * What the town's named hands keep back of this market turn's output:
     * { goods: { goodId: units }, share } for SettlementMarket.processSettlement
     * (ctx.withhold; at most `share` of what the town made of each), or null.
     * `days`: the turn's length.
     */
    withhold(s, world, day, days = null) {
        if (!TownTrade.enabled() || !s || !_obj(s.folk) || !_obj(s.townTrade)) return null;
        const W = TownTrade.config().wares;
        const k = days != null ? days : SettlementMarket.tickDays();
        const m = s.market;
        const prod = m && Array.isArray(m.prod) ? m.prod : null;
        const C = SettlementMarket.config();
        let out = null;
        for (const p of TownTrade._producers(s.folk, _num(day, 1))) {
            const goods = TownTrade.producerGoods(p).filter(g => SettlementMarket.tracks(g) && (!prod || _num(prod[C.idx[g]]) > 0));
            if (!goods.length) continue;
            const each = _num(W.perHand, 0.06) * k / goods.length;
            for (const g of goods) (out || (out = {}))[g] = _num(out[g]) + each;
        }
        return out ? { goods: out, share: _num(W.maxShare, 0.25) } : null;
    },

    /** The units kept back at the market turn (market.withheld) to their producers' wares. */
    _handOut(s, st, folk, day) {
        const m = s.market;
        const held = m && _obj(m.withheld);
        if (!held) return;
        for (const [g, n] of Object.entries(held)) {
            if (!(n > 0)) continue;
            const hands = TownTrade._producers(folk, day, g);
            if (!hands.length) { TownTrade._stockAdd(s, g, n); continue; }
            const each = n / hands.length;
            for (const p of hands) {
                const w = TownTrade.wares(st, p.id);
                w[g] = _num(w[g]) + each;
            }
            TownTrade._book(st, 'withheld', n);
        }
        delete m.withheld;
    },

    /**
     * Producers take to market what's over their keep (dawn, off the map;
     * on the street map a producer carries it in). New producers first take
     * their keep from the market's stock, where it can spare it.
     * `only`: one person (the street map's delivery). → units delivered.
     */
    deliver(s, st, folk, day, only = null) {
        const W = TownTrade.config().wares;
        const keep = _num(W.keep, 2);
        let moved = 0;
        for (const p of only ? [only] : TownTrade._producers(folk, day)) {
            const w = TownTrade.wares(st, p.id);
            for (const g of TownTrade.producerGoods(p)) {
                if (!SettlementMarket.tracks(g)) continue;
                const have = _num(w[g]);
                if (have > keep) {
                    const over = have - keep;
                    TownTrade._stockAdd(s, g, over);
                    w[g] = keep;
                    moved += over;
                } else if (!(g in w) && SettlementMarket.uses(s, g)) {
                    // (a new hand: their keep from the stock the market can spare)
                    const spare = Math.floor(Math.max(0, SettlementMarket.stock(s, g) - SettlementMarket.target(s, g) * 0.5));
                    w[g] = TownTrade._stockTake(s, g, Math.min(keep, spare));
                }
            }
        }
        if (moved > 0) TownTrade._book(st, 'delivered', moved);
        return moved;
    },

    // ──────────── BARTER BETWEEN NEIGHBOURS ────────────

    /** What a household could spare of each good: its larder over target, and its producers' wares. */
    _surplus(st, hh, rates) {
        const H = st.hh[hh.key];
        const L = (H && H.l) || {};
        const out = {};
        const rOf = Object.fromEntries(rates.map(r => [r.g, r]));
        for (const [g, n] of Object.entries(L)) {
            const r = rOf[g];
            const over = r ? n - TownTrade.target(hh, r) : n;
            if (over > 0) out[g] = over;
        }
        for (const p of hh.adults) {
            for (const [g, n] of Object.entries(st.wares[p.id] || {})) if (n > 0) out[g] = _num(out[g]) + n;
        }
        return out;
    },

    _deficit(st, hh, rates) {
        const H = st.hh[hh.key];
        const L = (H && H.l) || {};
        const out = {};
        for (const r of rates) {
            const d = TownTrade.target(hh, r) - _num(L[r.g]);
            if (d > 0) out[r.g] = d;
        }
        return out;
    },

    /** Take `n` units of a household's spare `g`: larder surplus first, then its producers' wares. */
    _takeSpare(st, hh, rates, g, n) {
        let left = n;
        const H = TownTrade.larder(st, hh.key);
        const r = rates.find(x => x.g === g);
        const over = Math.max(0, _num(H.l[g]) - (r ? TownTrade.target(hh, r) : 0));
        const a = Math.min(over, left);
        if (a > 0) { TownTrade._setL(st, H.l, g, _num(H.l[g]) - a); left -= a; }
        for (const p of hh.adults) {
            if (!(left > 0)) break;
            const w = st.wares[p.id];
            if (!w || !(w[g] > 0)) continue;
            const b = Math.min(w[g], left);
            w[g] -= b;
            if (w[g] <= DUST) { if (w[g] > 0) TownTrade._sink(st, 'eaten', g, w[g]); w[g] = 0; }
            left -= b;
        }
        return n - left;
    },

    /**
     * Two households swap goods of the same worth: each's spare for what the
     * other lacks. → { give, get, gUnits, rUnits, value } or null.
     */
    barter(world, s, a, b, day, opts = {}) {
        if (!a || !b || a === b) return null;
        const C = TownTrade.config();
        const st = TownTrade.state(s, day);
        const rates = opts.rates || TownTrade.rates(s);
        const price = opts.price || TownTrade._priceFn(world, s);
        const lot = _num(C.household.minLot, 0.01);
        const sa = TownTrade._surplus(st, a, rates), sb = TownTrade._surplus(st, b, rates);
        const da = TownTrade._deficit(st, a, rates), db = TownTrade._deficit(st, b, rates);
        let best = null;
        for (const x of Object.keys(sa).sort()) {
            if (!(db[x] > 0)) continue;
            for (const y of Object.keys(sb).sort()) {
                if (y === x || !(da[y] > 0)) continue;
                const px = price(x), py = price(y);
                if (!(px > 0) || !(py > 0)) continue;
                const v = Math.min(sa[x] * px, db[x] * px, sb[y] * py, da[y] * py);
                if (!best || v > best.v) best = { x, y, v, px, py };
            }
        }
        if (!best || best.v < _num(C.barter.minValue, 0.05)) return null;
        const ux = _lot(best.v / best.px), uy = _lot(best.v / best.py);
        if (ux < lot || uy < lot) return null;
        const gx = TownTrade._takeSpare(st, a, rates, best.x, ux);
        const gy = TownTrade._takeSpare(st, b, rates, best.y, uy);
        const La = TownTrade.larder(st, a.key, day).l, Lb = TownTrade.larder(st, b.key, day).l;
        Lb[best.x] = _num(Lb[best.x]) + gx;
        La[best.y] = _num(La[best.y]) + gy;
        // They warm to each other, and a grudge between them cools
        const tk = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
        const first = !(st.ties[tk] > 0);
        st.ties[tk] = Math.min(100, _num(st.ties[tk]) + _num(C.barter.warm, 4));
        const pa = a.adults[0], pb = b.adults[0];
        if (pa && pb) {
            try {
                if (Brawls.feud(s, pa.id, pb.id)) Brawls.addFeud(s, pa.id, pb.id, null, day, -_num(C.barter.cool, 6));
            } catch (e) { /* (no brawls state) */ }
            if (first) {
                Townsfolk.note(pa, day, 'bartered', pb.id, `${best.x}|${best.y}`);
                Townsfolk.note(pb, day, 'bartered', pa.id, `${best.y}|${best.x}`);
            }
        }
        TownTrade._book(st, 'bartered', 1);
        TownTrade._deal(st, { d: day, k: 'barter', a: pa ? pa.id : null, b: pb ? pb.id : null, g: best.x, n: _r2(gx), h: best.y, m: _r2(gy) });
        return { give: best.x, get: best.y, gUnits: gx, rUnits: gy, value: _r2(best.v), first };
    },

    _barterRound(world, s, st, folk, hhs, rates, price, day) {
        if (hhs.length < 2) return 0;
        const B = TownTrade.config().barter;
        const kind = TownTrade.inKind(s);
        let n = 0;
        // (one with something to spare goes to a neighbour)
        const spare = hhs.filter(h => h.adults.length && Object.keys(TownTrade._surplus(st, h, rates)).length);
        for (let i = 0; i < Math.max(0, _num(B.pairs, 3)); i++) {
            const a = _pick(spare, _frac(_seed(world), 'bxa', s.q, s.r, day, i));
            const b = _pick(hhs.filter(h => h !== a), _frac(_seed(world), 'bxb', s.q, s.r, day, i));
            if (!a || !b || !a.adults.length || !b.adults.length) continue;
            let chance = kind ? _num(B.inKind, 0.8) : _num(B.chance, 0.25);
            if (!kind && (TownTrade.poor(folk, a, world) || TownTrade.poor(folk, b, world))) chance += _num(B.poorBonus, 0.25);
            if (_frac(_seed(world), 'bx', s.q, s.r, day, i) >= chance) continue;
            if (TownTrade.barter(world, s, a, b, day, { rates, price })) { n++; continue; }
            // Nothing the other has that they lack: in a coin town the neighbour buys it, purse to purse
            if (kind) continue;
            const lacks = TownTrade._deficit(st, b, rates);
            for (const p of a.adults) {
                const g = Object.keys(st.wares[p.id] || {}).sort().find(x => _num(st.wares[p.id][x]) > 0 && lacks[x] >= _num(TownTrade.config().household.minLot, 0.01));
                if (g && TownTrade.buyFrom(world, s, b.adults[0], p, g)) { TownTrade._book(st, 'neighbourSales', 1); break; }
            }
        }
        return n;
    },

    // ──────────── PEDLARS ────────────

    /**
     * The town's trade-link neighbours by land: [{ s, d }]. A link is kept on
     * one end's market only (systems/marketDynamics.js: market.links), so the
     * links of the towns round about that name this one count too; before the
     * links are first drawn (the first day), the nearest towns on the same land
     * within pedlars.nearRange.
     */
    neighbours(world, s) {
        if (!s || !world || typeof world.getTile !== 'function') return [];
        const out = [];
        const seen = new Set();
        const add = (o, d) => {
            if (!o || o === s || seen.has(o)) return;
            seen.add(o);
            out.push({ s: o, d: Math.max(1, _num(d, 1)) });
        };
        const own = s.market && Array.isArray(s.market.links) ? s.market.links : [];
        for (const l of own) {
            if (!Array.isArray(l) || l[3]) continue;
            const t = world.getTile(l[0], l[1]);
            add(t && t.settlement, l[2]);
        }
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const range = _num(TownTrade.config().pedlars.nearRange, 8);
        const here = world.getTile(s.q, s.r);
        const near = [];
        let drawn = own.length > 0;
        for (const v of views) {
            const t = world.getTile(v.q, v.r);
            const o = (t && t.settlement) || v;
            if (!o || o === s) continue;
            const links = o.market && Array.isArray(o.market.links) ? o.market.links : null;
            if (links && links.length) drawn = true;
            for (const l of links || []) if (Array.isArray(l) && !l[3] && l[0] === s.q && l[1] === s.r) add(o, l[2]);
            if (Math.abs(v.r - s.r) > range) continue;
            const d = Hex.wrappingDistance(s.q, s.r, v.q, v.r, world.width || 0);
            if (d <= range && here && t && here.regionId !== undefined && t.regionId === here.regionId) near.push({ o, d });
        }
        if (!drawn) for (const x of near.sort((a, b) => a.d - b.d || a.o.q - b.o.q || a.o.r - b.o.r).slice(0, 3)) add(x.o, x.d);
        return out;
    },

    /** The pedlars on the road to this town or in it. */
    pedlars(s) {
        return s && _obj(s.townTrade) && Array.isArray(s.townTrade.pedlars) ? s.townTrade.pedlars : [];
    },

    /** A pedlar in this town today (walking its streets), or null. */
    pedlarIn(s, day) {
        // (one come in off the road today walks the streets, though the town's trade step hasn't seen them yet)
        return TownTrade.pedlars(s).find(p => (p.phase === 'town' || p.phase === 'road') && _num(p.arrive) <= day
            && (p.until == null || _num(p.until) >= day)) || null;
    },

    /** Fill a pedlar's pack at `from`'s market for `to`: what's dearer there, within the pack's limits. → value bought. */
    _fillPack(world, from, to, ped, day) {
        const P = TownTrade.config().pedlars;
        if (TownTrade.inKind(from)) return 0;
        const pFrom = TownTrade._priceFn(world, from), pTo = TownTrade._priceFn(world, to);
        const goods = _arr(P.goods).filter(g => SettlementMarket.tracks(g) && SettlementMarket.uses(to, g))
            .map(g => ({ g, a: pFrom(g), b: pTo(g) }))
            .filter(x => x.a > 0 && x.b > 0 && x.b / x.a >= _num(P.minMargin, 1.12))
            .sort((x, y) => y.b / y.a - x.b / x.a || (x.g < y.g ? -1 : 1));
        let budget = _r2(Math.min(_num(P.packValue, 36), ped.purse * 0.8));
        let units = Object.values(ped.pack || {}).reduce((t, n) => t + n, 0);
        let spent = 0;
        for (const x of goods) {
            const room = _num(P.packUnits, 4) - units;
            if (!(room > 0.01) || !(budget > 0.01)) break;
            const spare = SettlementMarket.stock(from, x.g) - SettlementMarket.target(from, x.g) * 0.6;
            const n = _lot(Math.min(room, spare, budget / x.a, 1.5));
            if (n < 0.1) continue;
            const cost = _r2(n * x.a);
            const got = TownTrade._stockTake(from, x.g, n);
            const paid = _r2(Math.min(cost, ped.purse));
            ped.purse = _r2(ped.purse - paid);
            Economy.payTown(from, paid);
            ped.pack[x.g] = _num(ped.pack[x.g]) + got;
            units += got;
            budget = _r2(budget - paid);
            spent = _r2(spent + paid);
        }
        return spent;
    },

    _spawnPedlar(world, s, st, day) {
        const P = TownTrade.config().pedlars;
        // (from a town whose purse can stake one: a village with an empty purse sends none)
        const opts = TownTrade.neighbours(world, s).filter(n => !TownTrade.inKind(n.s) && Economy.townPurse(n.s) != null
            && Math.min(_num(P.seed, 30), Economy.townPurse(n.s) * _num(P.seedShare, 0.02)) >= _num(P.minPurse, 6));
        if (!opts.length) return null;
        const o = _pick(opts, _frac(_seed(world), 'pedfrom', s.q, s.r, day));
        const have = Economy.townPurse(o.s);
        const seed = _r2(Math.min(_num(P.seed, 30), have * _num(P.seedShare, 0.02)));
        if (seed < _num(P.minPurse, 6)) return null;
        const purse = Economy.drawTown(o.s, seed);
        const u = _frac(_seed(world), 'pedname', s.q, s.r, day);
        const name = `${_pick(P.names, u) || 'Wat'} ${_pick(P.bynames, _frac('by', u)) || 'Pedlar'}`;
        const ped = {
            id: `pd${s.q}_${s.r}_${day}`, name, home: _key(o.s), homeName: o.s.name || 'a town',
            from: _key(o.s), fromName: o.s.name || 'a town', purse: _r2(purse), pack: {},
            phase: 'road', arrive: day + Math.ceil(o.d * _num(P.daysPerHex, 1)), until: null, trips: 0, sold: 0,
        };
        TownTrade._fillPack(world, o.s, s, ped, day);
        st.pedlars.push(ped);
        st.lastPedlar = day;
        return ped;
    },

    /**
     * A town's pedlars on first sight: firstInTown of towns have one in their
     * streets already (come from a neighbour, purse and pack drawn there as
     * any pedlar's), the rest saw their last one a while ago by a hash of the place.
     */
    _seedPedlars(world, s, st, day) {
        st.pedSeeded = true;
        const P = TownTrade.config().pedlars;
        if (!P.enabled || TownTrade.inKind(s) || st.pedlars.length) return null;
        const every = Math.max(1, _num(P.everyDays, 10));
        const u = _frac(_seed(world), 'pedseed', s.q, s.r);
        if (u < _num(P.firstInTown, 0)) {
            const ped = TownTrade._spawnPedlar(world, s, st, day);
            if (ped) {
                ped.phase = 'town';
                ped.arrive = day;
                // (part way through their stay, a couple of days of it left at least)
                ped.until = day + 2 + Math.floor(_frac(u, 'stay') * Math.max(1, _num(P.stayDays, 6) - 1));
                return ped;
            }
        }
        st.lastPedlar = day - Math.floor(_frac(u, 'last') * every);
        return null;
    },

    /**
     * The player comes into a town (world/innerMap/townTrading.js): its pedlars
     * as first seen, before its trade has run a step (the state is left for
     * catchUp to anchor to the roster's clock).
     */
    seePedlars(world, s, day) {
        if (!TownTrade.enabled() || !s || !_obj(s.folk) || !Array.isArray(s.folk.people)) return null;
        const st = TownTrade.state(s, null);
        if (!st.pedSeeded) TownTrade._seedPedlars(world, s, st, _num(day, 1));
        return TownTrade.pedlarIn(s, _num(day, 1));
    },

    _pedlarStep(world, s, st, folk, hhs, rates, price, day, player) {
        const P = TownTrade.config().pedlars;
        if (!P.enabled) return;
        if (!TownTrade.inKind(s) && !st.pedlars.length && (st.lastPedlar == null || day - st.lastPedlar >= _num(P.everyDays, 24))) {
            if (st.lastPedlar == null) st.lastPedlar = day;
            else TownTrade._spawnPedlar(world, s, st, day);
        }
        for (const ped of st.pedlars.slice()) {
            if (ped.phase === 'road' && _num(ped.arrive) <= day) {
                ped.phase = 'town';
                ped.until = day + _num(P.stayDays, 6);
                st.lastPedlar = day;
                Townsfolk.record(folk, world, day, { k: 'pedlar', x: `${ped.name}|${ped.fromName}` });
            }
            if (ped.phase !== 'town') continue;
            TownTrade._doorToDoor(world, s, st, folk, hhs, rates, price, ped, day);
            if (_num(ped.until) <= day) TownTrade._pedlarMoveOn(world, s, st, ped, day, player);
        }
    },

    /** Door to door: each household buys what its larder lacks from the pack, a little under the stalls. */
    _doorToDoor(world, s, st, folk, hhs, rates, price, ped, day) {
        if (TownTrade.inKind(s)) return 0;
        const P = TownTrade.config().pedlars;
        const lot = _num(TownTrade.config().household.minLot, 0.01);
        let sold = 0;
        const start = Math.floor(_frac(ped.id, day, 'door') * hhs.length);
        for (let i = 0; i < hhs.length; i++) {
            const hh = hhs[(start + i) % hhs.length];
            if (!hh.adults.length) continue;
            const L = TownTrade.larder(st, hh.key, day).l;
            for (const g of Object.keys(ped.pack).sort()) {
                const r = rates.find(x => x.g === g);
                if (!r || !(ped.pack[g] > 0)) continue;
                const each = _r2(price(g) * (1 - _num(P.undercut, 0.06)));
                const have = TownTrade.purseOf(folk, hh, world);
                const n = _lot(Math.min(TownTrade.target(hh, r) - _num(L[g]), ped.pack[g], have / Math.max(0.01, each)));
                if (n < lot) continue;
                const cost = Math.max(0.01, _r2(n * each));
                const paid = TownTrade._payFrom(folk, hh, world, Math.min(cost, have));
                ped.purse = _r2(ped.purse + paid);
                ped.pack[g] -= n;
                if (ped.pack[g] <= DUST) { if (ped.pack[g] > 0) TownTrade._sink(st, 'eaten', g, ped.pack[g]); delete ped.pack[g]; }
                L[g] = _num(L[g]) + n;
                ped.sold = _r2(_num(ped.sold) + paid);
                sold = _r2(sold + paid);
                TownTrade._book(st, 'pedlarSales', paid);
                TownTrade._deal(st, { d: day, k: 'pedlar', a: hh.adults[0].id, b: null, g, n: _r2(n), c: paid, p: ped.name });
            }
        }
        return sold;
    },

    /** The stay over: what's left to the market, then on to the next town with a roster — or off the road for good. */
    _pedlarMoveOn(world, s, st, ped, day, player) {
        const P = TownTrade.config().pedlars;
        const price = TownTrade._priceFn(world, s);
        for (const g of Object.keys(ped.pack).sort()) {
            const n = ped.pack[g];
            const each = _r2(price(g) * _num(P.sellShare, 0.9));
            const purse = Economy.townPurse(s);
            const k = purse == null ? _lot(n) : _lot(Math.min(n, purse / Math.max(0.01, each)));
            if (!(k > 0)) continue;
            const pay = Economy.drawTown(s, _r2(k * each));
            ped.purse = _r2(ped.purse + pay);
            TownTrade._stockAdd(s, g, k);
            ped.pack[g] = n - k;
            if (ped.pack[g] <= DUST) { if (ped.pack[g] > 0) TownTrade._stockAdd(s, g, ped.pack[g]); delete ped.pack[g]; }
        }
        st.pedlars = st.pedlars.filter(x => x !== ped);
        ped.trips = _num(ped.trips) + 1;
        const next = TownTrade.neighbours(world, s).filter(n => _obj(n.s.folk) && !TownTrade.inKind(n.s) && _key(n.s) !== ped.from);
        const to = next.length ? _pick(next, _frac(ped.id, day, 'next')) : null;
        if (!to || ped.trips >= _num(P.maxTrips, 8) || ped.purse < _num(P.minPurse, 6)) {
            // Off the road: the purse and what's left stay here
            for (const [g, n] of Object.entries(ped.pack)) TownTrade._stockAdd(s, g, n);
            Economy.payTown(s, ped.purse);
            TownTrade._book(st, 'pedlarsSettled', 1);
            return null;
        }
        ped.from = _key(s);
        ped.fromName = s.name || 'a town';
        ped.phase = 'road';
        ped.arrive = day + Math.ceil(to.d * _num(P.daysPerHex, 1));
        ped.until = null;
        TownTrade._fillPack(world, s, to.s, ped, day);
        const nst = TownTrade.state(to.s, day);
        nst.pedlars.push(ped);
        nst.lastPedlar = day;
        void player;
        return ped;
    },

    // ──────────── MERCHANTS ────────────

    /** A merchant caravan leaving a town with a roster: one of its merchants' venture (merchantCaravans.js _spawn). */
    caravanMerchant(world, from, to, unit, day) {
        if (!TownTrade.enabled() || !from || !_obj(from.folk) || !unit) return null;
        const C = TownTrade.config().merchants;
        const d = _num(day, _num(world && world.day, 1));
        const list = Townsfolk.residents(from.folk).filter(p => p.job && _arr(C.jobs).includes(p.job.id) && p.job.employer !== 'player')
            .sort((a, b) => a.id - b.id);
        const p = _pick(list, _frac(_seed(world), 'carv', unit.id || '', d));
        if (!p) return null;
        unit.merchant = { name: Townsfolk.name(p), pid: p.id, town: from.name || null };
        const st = TownTrade.state(from, d);
        TownTrade._book(st, 'caravans', 1);
        TownTrade._deal(st, { d, k: 'caravan', a: p.id, b: null, g: unit.mainGood || null, n: Math.round(_num(unit.value)), to: (to && to.name) || unit.toName || null });
        const lastLog = _arr(p.log).filter(e => e.k === 'dealt').reduce((m, e) => Math.max(m, _num(e.d, -Infinity)), -Infinity);
        if (d - lastLog >= _num(C.logEvery, 90)) {
            Townsfolk.note(p, d, 'dealt', null, `${unit.mainGood || 'goods'}|${(to && to.name) || unit.toName || 'another town'}`);
        }
        return p;
    },

    // ──────────── THE PLAYER ────────────

    /** What a townsperson has to sell from their own stock (whole units): { goodId: { qty, price } }. */
    personStock(world, s, p) {
        const st = s && _obj(s.townTrade);
        if (!st || !p) return {};
        const out = {};
        const price = TownTrade._priceFn(world, s);
        for (const [g, n] of Object.entries(st.wares[p.id] || {})) {
            const q = Math.floor(_num(n) + 1e-9);
            if (q >= 1) out[g] = { qty: q, price: Math.max(1, Math.round(price(g))) };
        }
        return out;
    },

    /**
     * The player buys `qty` of a townsperson's wares: out of their stock into
     * the player's packs, the coin into their purse. → { ok, text, price }.
     */
    sellToPlayer(player, world, s, p, g, qty = 1) {
        const L = TownTrade.config().lines.sell || {};
        if (!player || !s || !p) return { ok: false, text: L.none || 'Nothing to spare.' };
        if (TownTrade.inKind(s)) return { ok: false, text: L.noCoin || 'No coin here.' };
        const stock = TownTrade.personStock(world, s, p)[g];
        const n = Math.max(1, Math.floor(_num(qty, 1)));
        if (!stock || stock.qty < n) return { ok: false, text: L.none || 'Nothing to spare.' };
        const total = stock.price * n;
        if (_num(player.gold) < total) return { ok: false, text: L.poor || 'You can\'t pay that.', price: total };
        const r = PlayerInventory.addItem(player, g, n);
        if (r && r.success === false) return { ok: false, text: r.reason || 'Your packs are full.' };
        const st = TownTrade.state(s);
        TownTrade.takeWares(s, p, g, n);
        player.gold = _num(player.gold) - total;
        const folk = s.folk;
        p.purse = _r2((folk ? Townsfolk.purse(folk, p, world) : _num(p.purse)) + total);
        TownTrade._book(st, 'toPlayer', total);
        TownTrade._deal(st, { d: _num(world && world.day, 1), k: 'player', a: null, b: p.id, g, n, c: total });
        return { ok: true, text: L.done || 'Done.', price: total, qty: n };
    },

    /** Take `n` of a person's wares (given away or sold in free talk): → units taken. */
    takeWares(s, p, g, n) {
        const st = s && _obj(s.townTrade);
        if (!st || !p || !(n > 0)) return 0;
        const w = TownTrade.wares(st, p.id);
        const got = Math.min(Math.max(0, _num(w[g])), n);
        w[g] = _num(w[g]) - got;
        if (w[g] <= DUST) { if (w[g] > 0) TownTrade._sink(st, 'eaten', g, w[g]); w[g] = 0; }
        return got;
    },

    /** What a pedlar in town has in the pack (whole units): { goodId: { qty, price } }. */
    pedlarStock(world, s, ped) {
        if (!ped) return {};
        const P = TownTrade.config().pedlars;
        const price = TownTrade._priceFn(world, s);
        const out = {};
        for (const [g, n] of Object.entries(ped.pack || {})) {
            const q = Math.floor(_num(n) + 1e-9);
            if (q >= 1) out[g] = { qty: q, price: Math.max(1, Math.round(price(g) * (1 - _num(P.undercut, 0.06)))) };
        }
        return out;
    },

    /** The player buys from a pedlar's pack: the coin into the pedlar's purse. */
    sellFromPedlar(player, world, s, ped, g, qty = 1) {
        const L = TownTrade.config().lines.sell || {};
        const stock = TownTrade.pedlarStock(world, s, ped)[g];
        const n = Math.max(1, Math.floor(_num(qty, 1)));
        if (!stock || stock.qty < n) return { ok: false, text: L.none || 'Nothing to spare.' };
        const total = stock.price * n;
        if (_num(player.gold) < total) return { ok: false, text: L.poor || 'You can\'t pay that.', price: total };
        const r = PlayerInventory.addItem(player, g, n);
        if (r && r.success === false) return { ok: false, text: r.reason || 'Your packs are full.' };
        ped.pack[g] -= n;
        if (ped.pack[g] <= DUST) { if (ped.pack[g] > 0) TownTrade._stockAdd(s, g, ped.pack[g]); delete ped.pack[g]; }
        player.gold = _num(player.gold) - total;
        ped.purse = _r2(_num(ped.purse) + total);
        ped.sold = _r2(_num(ped.sold) + total);
        return { ok: true, text: L.done || 'Done.', price: total, qty: n };
    },

    /**
     * Free talk's stock for someone without a roster record (systems/npcChat.js):
     * what they carry is the market's, on consignment — yesterday's leftovers
     * go back to the town's stock, today's come out of it (as far as it has
     * them). `store.stock` = { day, at: 'q,r', items: { id: { qty, price } } }.
     */
    consign(world, s, store, wanted) {
        const day = _num(world && world.day);
        if (!store) return {};
        const cur = store.stock;
        if (cur && cur.day === day && cur.items) return cur.items;
        // Yesterday's leftovers back to the market they came from
        if (cur && cur.items && cur.at) {
            const [q, r] = String(cur.at).split(',').map(Number);
            const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
            const home = t && t.settlement;
            for (const [id, e] of Object.entries(cur.items)) if (home && e && e.qty > 0 && e.real) TownTrade._stockAdd(home, id, e.qty);
        }
        const items = {};
        if (s) {
            const price = TownTrade._priceFn(world, s);
            for (const [id, qty] of Object.entries(wanted || {})) {
                if (!SettlementMarket.tracks(id) || !(qty > 0)) continue;
                const n = Math.min(qty, Math.floor(Math.max(0, SettlementMarket.stock(s, id) - SettlementMarket.target(s, id) * 0.25)));
                if (n < 1) continue;
                const got = TownTrade._stockTake(s, id, n);
                items[id] = { qty: got, price: Math.max(1, Math.round(price(id))), real: true };
            }
        }
        store.stock = { day, at: s ? _key(s) : null, items };
        return items;
    },

    /** Coin the player paid for consigned goods: to the town whose goods they were. */
    consignPaid(world, store, n) {
        const at = store && store.stock && store.stock.at;
        if (!at || !(n > 0)) return 0;
        const [q, r] = String(at).split(',').map(Number);
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        return t && t.settlement ? Economy.payTown(t.settlement, n) : 0;
    },

    // ──────────── THE PANTRY (burglars: systems/npcTheft.js) ────────────

    /**
     * A person's household pantry, the larder it eats from: { key, H, hh } —
     * H the larder record (H.l = { goodId: units }, null when it has never
     * shopped), hh the household (its grown people hold its purses). Null
     * where the town keeps no trade yet (an old save, a town never stepped).
     */
    pantryOf(s, p, day) {
        const st = s && _obj(s.townTrade);
        if (!st || !p || !_obj(s.folk) || !TownTrade.enabled()) return null;
        const key = TownTrade.hhKey(s.folk, p, day);
        if (!key) return null;
        const hh = TownTrade.households(s.folk, day).find(h => h.key === key) || null;
        const H = _obj(st.hh[key]) && _obj(st.hh[key].l) ? st.hh[key] : null;
        return { key, H, hh };
    },

    /** Goods back into a household's pantry (stolen goods recovered by the watch). → units */
    toPantry(s, key, g, n) {
        const st = s && _obj(s.townTrade);
        if (!st || !key || !(n > 0)) return 0;
        const H = TownTrade.larder(st, key);
        H.l[g] = _num(H.l[g]) + n;
        return n;
    },

    // ──────────── THE STREET MAP ────────────

    /**
     * A shopper at a stall on the street map (world/innerMap/townTrading.js):
     * their household buys what it lacks of the stall's goods, as it would off
     * the map (the off-map step then buys that much less). `goods`: the
     * stall's wares. → { ok, g, qty, cost, dear, cheated, caught, broke } or null.
     */
    stallBuy(world, s, p, goods, keeper = null) {
        if (!TownTrade.enabled() || !s || !_obj(s.folk) || !p || TownTrade.inKind(s)) return null;
        const day = _num(world && world.day, 1);
        const folk = s.folk;
        const st = TownTrade.state(s, day);
        const key = TownTrade.hhKey(folk, p, day);
        const hh = TownTrade.households(folk, day).find(h => h.key === key);
        if (!hh || !hh.adults.length) return null;
        const rates = TownTrade.rates(s);
        const H = TownTrade.larder(st, key, day);
        const want = _arr(goods).map(g => rates.find(r => r.g === g)).filter(Boolean)
            .map(r => ({ r, d: TownTrade.target(hh, r) - _num(H.l[r.g]) })).filter(x => x.d >= _num(TownTrade.config().household.minLot, 0.01))
            .sort((a, b) => b.d - a.d);
        if (!want.length) return { ok: false, look: true };
        const x = want[0];
        const seller = keeper && keeper._person && keeper._person !== p ? keeper._person : undefined;
        const res = TownTrade.buy(world, s, st, folk, hh, x.r.g, _lot(x.d), { day, salt: `map${p.id}`, seller });
        if (!res || !(res.qty > 0)) return { ok: false, broke: true, g: x.r.g };
        return { ok: true, g: x.r.g, ...res };
    },

    /**
     * A townsperson buys from another's wares (a hawker crying them in the
     * street): what their household lacks of it, at the stall's price, the
     * goods out of the seller's wares into the larder, the coin purse to
     * purse. → { g, qty, cost } or null.
     */
    buyFrom(world, s, buyer, seller, g) {
        if (!TownTrade.enabled() || !s || !_obj(s.folk) || !buyer || !seller || buyer === seller || TownTrade.inKind(s)) return null;
        const day = _num(world && world.day, 1);
        const folk = s.folk;
        const st = TownTrade.state(s, day);
        const key = TownTrade.hhKey(folk, buyer, day);
        if (key === TownTrade.hhKey(folk, seller, day)) return null;
        const hh = TownTrade.households(folk, day).find(h => h.key === key);
        const r = TownTrade.rates(s).find(x => x.g === g);
        if (!hh || !hh.adults.length || !r) return null;
        const H = TownTrade.larder(st, key, day);
        const each = TownTrade.price(world, s, g);
        const have = TownTrade.purseOf(folk, hh, world);
        const n = _lot(Math.min(TownTrade.target(hh, r) - _num(H.l[g]), _num((st.wares[seller.id] || {})[g]), have / Math.max(0.01, each)));
        if (n < _num(TownTrade.config().household.minLot, 0.01)) return null;
        const got = TownTrade.takeWares(s, seller, g, n);
        const paid = TownTrade._payFrom(folk, hh, world, Math.min(have, Math.max(0.01, _r2(got * each))));
        seller.purse = _r2(Townsfolk.purse(folk, seller, world) + paid);
        H.l[g] = _num(H.l[g]) + got;
        TownTrade._book(st, 'street', paid);
        TownTrade._deal(st, { d: day, k: 'street', a: buyer.id, b: seller.id, g, n: _r2(got), c: paid });
        return { g, qty: got, cost: paid };
    },

    /** Two neighbours on the street map swap (their households): → barter result or null. */
    streetBarter(world, s, pa, pb) {
        if (!TownTrade.enabled() || !s || !_obj(s.folk) || !pa || !pb) return null;
        const day = _num(world && world.day, 1);
        const folk = s.folk;
        const hhs = TownTrade.households(folk, day);
        const a = hhs.find(h => h.key === TownTrade.hhKey(folk, pa, day));
        const b = hhs.find(h => h.key === TownTrade.hhKey(folk, pb, day));
        if (!a || !b || a === b) return null;
        return TownTrade.barter(world, s, a, b, day);
    },

    /** A producer carries their wares over the keep to market (the street map's dawn delivery). → units. */
    deliverOne(world, s, p) {
        if (!s || !_obj(s.folk) || !p) return 0;
        const day = _num(world && world.day, 1);
        return TownTrade.deliver(s, TownTrade.state(s, day), s.folk, day, p);
    },

    /** A ware this person could cry in the street (one they hold at least a unit of), or null. */
    hawkGood(s, p) {
        const st = s && _obj(s.townTrade);
        if (!st || !p) return null;
        const w = st.wares[p.id] || {};
        const list = TownTrade.producerGoods(p).filter(g => _num(w[g]) >= 1);
        return list.length ? list[Math.floor(_frac('hawk', p.id, list.length) * list.length) % list.length] : null;
    },

    /** A street cry for a good ("Hot bread! Fresh from the oven!"). */
    cry(g, u = 0, vars = {}) {
        const H = (TownTrade.config().lines.hawk) || {};
        const list = _arr(H[g]).length ? H[g] : _arr(H.default);
        const name = _goodName(g);
        return _fill(_pick(list, u) || '{good}!', { good: name.charAt(0).toUpperCase() + name.slice(1), ...vars });
    },

    /** A line from data lines[key] by a roll. */
    line(key, u = 0, vars = {}) {
        const L = TownTrade.config().lines[key];
        const pick = _pick(_arr(L), u);
        if (Array.isArray(pick)) return pick.map(t => _fill(t, vars));
        return pick != null ? _fill(pick, vars) : null;
    },

    goodName(g) { return _goodName(g); },

    // ──────────── BOOKS AND WORDS ────────────

    /**
     * Every unit and coin TownTrade holds in a town: { goods: { id: units }
     * (larders, wares, pedlars' packs), coin (pedlars' purses), eaten, spoiled,
     * gone: { id: units eaten, worn out or spoiled } }.
     */
    holdings(s) {
        const st = s && _obj(s.townTrade);
        const goods = {};
        let coin = 0;
        if (!st) return { goods, coin, eaten: 0, spoiled: 0, gone: {} };
        const add = (g, n) => { if (n > 0) goods[g] = _num(goods[g]) + n; };
        for (const h of Object.values(st.hh)) for (const [g, n] of Object.entries((h && h.l) || {})) add(g, n);
        for (const w of Object.values(st.wares)) for (const [g, n] of Object.entries(w || {})) add(g, n);
        for (const ped of st.pedlars) {
            coin += _num(ped.purse);
            for (const [g, n] of Object.entries(ped.pack || {})) add(g, n);
        }
        return { goods, coin: _r2(coin), eaten: _num(st.book.eaten), spoiled: _num(st.book.spoiled), gone: { ...(_obj(st.gone) || {}) } };
    },

    isLog(k) { return ['cheated', 'fined', 'bartered', 'dealt'].includes(k); },

    /** A first-person line about a trading entry of a person's life. */
    lifeText(folk, p, e, world) {
        const o = Townsfolk.get(folk, e.o);
        const when = Townsfolk.when(e.d, world);
        const [a, b] = String(e.x || '').split('|');
        switch (e.k) {
            case 'cheated': return o ? (a === 'short'
                ? `${Townsfolk.name(o)} gave me short weight ${when}${b ? ` on the ${_goodName(b)}` : ''}. I'll not buy from them again.`
                : `${Townsfolk.name(o)} skinned me at market ${when}${b ? ` over some ${_goodName(b)}` : ''}. I've not forgotten.`) : null;
            case 'fined': return `I was fined at market ${when} for short weight${o ? ` — ${Townsfolk.name(o)} saw to that` : ''}. A misunderstanding.`;
            case 'bartered': return o ? `${Townsfolk.name(o)} and I have swapped ${a ? _goodName(a) : 'this'} for ${b ? _goodName(b) : 'that'} since ${when.replace(/^in /, '')}. Good neighbours.` : null;
            case 'dealt': return `I sent a caravan of ${a ? _goodName(a) : 'goods'} to ${b || 'another town'} ${when}.`;
            default: return null;
        }
    },

    /** A third-person line about a trading entry, for the journal. */
    biographyLine(folk, p, e, world) {
        const o = Townsfolk.get(folk, e.o);
        const when = Townsfolk.when(e.d, world);
        const [a, b] = String(e.x || '').split('|');
        switch (e.k) {
            case 'cheated': return o ? `Fell out with ${Townsfolk.name(o)} over a bargain ${when}.` : null;
            case 'fined': return `Fined at market for short weight ${when}.`;
            case 'bartered': return o ? `Began trading ${a ? _goodName(a) : 'goods'} with ${Townsfolk.name(o)} ${when}.` : null;
            case 'dealt': return `Sent a caravan of ${a ? _goodName(a) : 'goods'} to ${b || 'another town'} ${when}.`;
            default: return null;
        }
    },

    /** The town's annal lines for trading entries (Townsfolk.annalText's default). */
    annalText(folk, entry, world) {
        const A = TownTrade.config().annals;
        const a = Townsfolk.get(folk, entry.a);
        const [x, y] = String(entry.x || '').split('|');
        switch (entry.k) {
            case 'fined': return a ? _fill(A.fined || '{name} was fined at market for short weight.', { name: Townsfolk.name(a) }) : null;
            case 'pedlar': return _fill(A.pedlar || '{name} the pedlar came through from {from}.', { name: x || 'A pedlar', from: y || 'the road' });
            default: return null;
        }
    },

    isAnnal(k) { return k === 'fined' || k === 'pedlar'; },
};

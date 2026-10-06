// ============================================
// PRICE KNOWLEDGE — what the player knows of the markets, and since when
// ============================================
// The settlement markets (world/settlementMarket.js) are real and change
// every market day, but the player is not omniscient: they know a town's
// prices only from
//   - their own visits (the whole market, refreshed each day they stand there),
//   - their trading company's factors and their holdings' stewards (the whole
//     market of each post or holding, a report every reportEvery days),
//   - merchant caravans and trading ships met on the road (the goods they
//     carry, as priced at their origin and destination when they set out),
//   - tavern talk, bought or heard (a few goods, as reported — maybe wrong).
// Each quote keeps the day it was true and its source, so the trade map
// (ui/renderer/overlays.js 'prices' mode) and the Merchant's Ledger
// (ui/actionMenu/merchantLedger.js) can stamp it with its age. The ledger's
// best spreads are worked out only from these quotes.
//
// The book also keeps a short price history of the markets visited last, and
// the player's trading profit and loss by good and route (Trading.buyGoods /
// sellGoods report each deal: a sale is set against the average cost of what
// was bought, and the route is where it was bought → where it was sold).
//
// State on player.priceBook (systems/saveLoad.js; older saves backfill a blank
// book). Small by design: maxTowns towns, history for historyTowns, routesCap
// routes. Draws no RNG. Tuned in data/priceKnowledge.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';

const DEFAULTS = {
    maxTowns: 30, reportEvery: 3, historyTowns: 10, historySamples: 10, historyEvery: 3, hailRadius: 1,
    sellShare: 0.7, askBySize: { village: 1.2, town: 1, city: 0.9, capital: 0.8 },
    hexesPerDay: 3, maxTravelDays: 8, freshDays: 7, staleDays: 30, routesCap: 20,
    sources: {
        v: { name: 'your visit', icon: '👁️' }, f: { name: 'your factor', icon: '🏪' }, h: { name: 'your steward', icon: '🏰' },
        c: { name: 'a passing merchant', icon: '🐫' }, t: { name: 'tavern talk', icon: '🍺' },
    },
};

// Sources ranked by trust: a fresher quote always wins, a same-day one only from an equal or better source
const RANK = { v: 5, f: 4, h: 4, c: 2, t: 1 };

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _key = (q, r) => `${q},${r}`;
const _day = (world) => _num(world && world.day);

function _goods() {
    const gd = DataLoader._gamedata;
    return (gd && gd.playerEconomy && gd.playerEconomy.GOODS) || {};
}

function _good(id) {
    return _goods()[String(id).toUpperCase()] || null;
}

export const PriceKnowledge = {
    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.priceKnowledge) || {};
        return {
            ...DEFAULTS, ...d,
            askBySize: { ...DEFAULTS.askBySize, ...(d.askBySize || {}) },
            sources: { ...DEFAULTS.sources, ...(d.sources || {}) },
        };
    },

    _blank() {
        return { towns: {}, hist: { ids: [], towns: {} }, pnl: { goods: {}, routes: {}, held: {} }, lastReport: null };
    },

    /** The player's price book (created on first use; older saves backfill). */
    state(player) {
        if (!player) return PriceKnowledge._blank();
        let st = player.priceBook;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.priceBook = PriceKnowledge._blank();
            return player.priceBook;
        }
        if (!st.towns || typeof st.towns !== 'object') st.towns = {};
        if (!st.hist || typeof st.hist !== 'object') st.hist = { ids: [], towns: {} };
        if (!Array.isArray(st.hist.ids)) st.hist.ids = [];
        if (!st.hist.towns || typeof st.hist.towns !== 'object') st.hist.towns = {};
        if (!st.pnl || typeof st.pnl !== 'object') st.pnl = { goods: {}, routes: {}, held: {} };
        for (const k of ['goods', 'routes', 'held']) if (!st.pnl[k] || typeof st.pnl[k] !== 'object') st.pnl[k] = {};
        if (st.lastReport === undefined) st.lastReport = null;
        return st;
    },

    serialize(player) {
        return player && player.priceBook ? JSON.parse(JSON.stringify(player.priceBook)) : null;
    },

    /** After a load: a blank book for older saves, the shape checked for newer ones. */
    loadState(player) {
        if (!player) return;
        PriceKnowledge.state(player);
        PriceKnowledge._prune(player);
    },

    // ── Learning ───────────────────────────────────────────

    _town(st, s, day) {
        const key = _key(s.q, s.r);
        let t = st.towns[key];
        if (!t) t = st.towns[key] = { n: s.name || 'a town', t: s.type || null, d: day, g: {} };
        if (s.name) t.n = s.name;
        if (s.type) t.t = s.type;
        if (day > _num(t.d, -Infinity)) t.d = day;
        return t;
    },

    /** Keep a quote unless the book holds a fresher one (or a same-day one from a better source). */
    _put(t, goodId, entry) {
        const old = t.g[goodId];
        if (old && (old[3] > entry[3] || (old[3] === entry[3] && (RANK[old[4]] || 0) > (RANK[entry[4]] || 0)))) return false;
        t.g[goodId] = entry;
        return true;
    },

    /**
     * See a town's whole market as it stands today: its asking price, what
     * its stalls pay and its stock reading for every good it trades.
     * src: 'v' (a visit), 'f' (a factor's report), 'h' (a steward's report).
     */
    observe(player, world, settlement, src = 'v') {
        if (!player || !world || !settlement || !Number.isFinite(settlement.q)) return 0;
        const tile = typeof world.getTile === 'function' ? world.getTile(settlement.q, settlement.r) : null;
        const s = (tile && tile.settlement) || settlement;
        if (!s.market) return 0;
        const C = PriceKnowledge.config();
        const st = PriceKnowledge.state(player);
        const day = _day(world);
        const t = PriceKnowledge._town(st, s, day);
        const fair = SettlementMarket.fair(s);
        const share = fair && fair.sell > C.sellShare ? fair.sell : C.sellShare;
        let n = 0;
        for (const id of SettlementMarket.config().goodIds) {
            const good = _good(id);
            if (!good) continue;
            const ask = Economy.marketAsk(world, tile || { q: s.q, r: s.r, settlement: s }, id);
            if (ask == null) continue;
            const bid = Math.floor(SettlementMarket.value(world, s, tile, id, good.basePrice) * share);
            const sc = Math.round(SettlementMarket.scarcity(s, id) * 100);
            if (PriceKnowledge._put(t, id, [Math.max(0, Math.round(ask)), Math.max(0, bid), sc, day, src])) n++;
        }
        if (src === 'v') PriceKnowledge._sample(player, world, s, t);
        PriceKnowledge._prune(player);
        return n;
    },

    /**
     * Hearsay about one good in one town: `worth` is what it is worth there
     * (before the stalls' size markup), as reported on `day`. The asking
     * price is estimated from the town's size, the stalls' pay from sellShare.
     * src: 'c' (a merchant met on the road), 't' (tavern talk).
     */
    learn(player, world, town, goodId, worth, day = null, src = 't', scarcity = null) {
        if (!player || !town || !Number.isFinite(town.q) || !_good(goodId) || !(worth > 0)) return false;
        const C = PriceKnowledge.config();
        const st = PriceKnowledge.state(player);
        const d = Number.isFinite(day) ? day : _day(world);
        let type = town.type || null;
        if (!type && world && typeof world.getTile === 'function') {
            const tl = world.getTile(town.q, town.r);
            if (tl && tl.settlement) type = tl.settlement.type;
        }
        const t = PriceKnowledge._town(st, { q: town.q, r: town.r, name: town.name, type }, d);
        const ask = Math.max(1, Math.round(worth * _num(C.askBySize[t.t || type], 1)));
        const bid = Math.max(0, Math.floor(worth * C.sellShare));
        const base = _good(goodId).basePrice || 1;
        const sc = Math.round((Number.isFinite(scarcity) ? scarcity : worth / base) * 100);
        const ok = PriceKnowledge._put(t, goodId, [ask, bid, sc, d, src]);
        PriceKnowledge._prune(player);
        return ok;
    },

    /** A merchant met on the road tells what its goods were worth at both ends when it set out. */
    learnFromTrader(player, world, u) {
        if (!player || !u || !u.prices || u.destroyed) return 0;
        const day = Number.isFinite(u.departed) ? u.departed : _day(world);
        const ends = [
            { q: u.sourceQ, r: u.sourceR, name: u.fromName },
            { q: u.targetQ, r: u.targetR, name: u.toName },
        ];
        let n = 0;
        for (const [id, pair] of Object.entries(u.prices)) {
            if (!Array.isArray(pair)) continue;
            for (let i = 0; i < 2; i++) {
                if (Number.isFinite(ends[i].q) && PriceKnowledge.learn(player, world, ends[i], id, _num(pair[i]), day, 'c')) n++;
            }
        }
        return n;
    },

    /** Tavern talk with prices in it (rumor.quotes: [{ q, r, name, type, good, price }]). */
    learnFromRumor(player, rumor, world = null) {
        if (!player || !rumor || !Array.isArray(rumor.quotes)) return 0;
        let n = 0;
        for (const qt of rumor.quotes) {
            if (!qt || !Number.isFinite(qt.q)) continue;
            if (PriceKnowledge.learn(player, world, qt, qt.good, _num(qt.price), _num(rumor.day, _day(world)), 't')) n++;
        }
        return n;
    },

    /**
     * The day's news: the market the player stands in, merchants within a
     * hex, and every reportEvery days the factors' and stewards' reports.
     * `posts`: the company's posts ([{ q, r }]); `holdings`: the player's
     * holdings ([{ q, r, settlement }]) — passed in by the caller.
     */
    processDay(player, world, { posts = [], holdings = [], traders = [] } = {}) {
        const out = { observed: 0, reports: 0, hails: 0 };
        if (!player || !world || typeof world.getTile !== 'function') return out;
        const C = PriceKnowledge.config();
        const st = PriceKnowledge.state(player);
        const day = _day(world);
        const here = Number.isFinite(player.q) ? world.getTile(player.q, player.r) : null;
        if (here && here.settlement && !player.boardedShip) out.observed = PriceKnowledge.observe(player, world, here.settlement, 'v');
        for (const u of traders || []) {
            if (!u || u.destroyed || !Number.isFinite(player.q)) continue;
            if (Hex.wrappingDistance(player.q, player.r, u.q, u.r, world.width) <= C.hailRadius) out.hails += PriceKnowledge.learnFromTrader(player, world, u);
        }
        if (st.lastReport === null || day - st.lastReport >= C.reportEvery) {
            st.lastReport = day;
            for (const p of posts || []) {
                const t = p && world.getTile(p.q, p.r);
                if (t && t.settlement) { PriceKnowledge.observe(player, world, t.settlement, 'f'); out.reports++; }
            }
            for (const h of holdings || []) {
                const t = h && world.getTile(h.q, h.r);
                if (t && t.settlement) { PriceKnowledge.observe(player, world, t.settlement, 'h'); out.reports++; }
            }
        }
        return out;
    },

    // ── History of the markets visited ─────────────────────

    /** A sample of a visited market's asking prices (every historyEvery days). */
    _sample(player, world, s, t) {
        const C = PriceKnowledge.config();
        const st = PriceKnowledge.state(player);
        const day = _day(world);
        const ids = SettlementMarket.config().goodIds;
        PriceKnowledge._remapHistory(st, ids);
        const key = _key(s.q, s.r);
        const list = st.hist.towns[key] || (st.hist.towns[key] = []);
        const last = list[list.length - 1];
        if (last && day - last[0] < C.historyEvery) return false;
        list.push([day, ...ids.map(id => (t.g[id] && t.g[id][3] === day ? t.g[id][0] : 0))]);
        if (list.length > C.historySamples) list.splice(0, list.length - C.historySamples);
        // Only the markets visited last keep a history
        const keys = Object.keys(st.hist.towns);
        if (keys.length > C.historyTowns) {
            keys.sort((a, b) => _num(st.hist.towns[a].at(-1)[0]) - _num(st.hist.towns[b].at(-1)[0]));
            for (const k of keys.slice(0, keys.length - C.historyTowns)) delete st.hist.towns[k];
        }
        return true;
    },

    /** History samples are laid out in the goods order of the day; follow a changed goods list. */
    _remapHistory(st, ids) {
        const old = st.hist.ids;
        if (old.length === ids.length && old.every((id, i) => id === ids[i])) return;
        const pos = ids.map(id => old.indexOf(id));
        for (const list of Object.values(st.hist.towns)) {
            for (let i = 0; i < list.length; i++) {
                const row = list[i];
                list[i] = [row[0], ...pos.map(p => (p >= 0 ? _num(row[p + 1]) : 0))];
            }
        }
        st.hist.ids = ids.slice();
    },

    /** The asking price of a good at a visited market over time: [{ day, price }] (oldest first). */
    history(player, q, r, goodId) {
        const st = PriceKnowledge.state(player);
        const list = st.hist.towns[_key(q, r)];
        const i = st.hist.ids.indexOf(goodId);
        if (!list || i < 0) return [];
        return list.filter(row => _num(row[i + 1]) > 0).map(row => ({ day: row[0], price: row[i + 1] }));
    },

    /** Markets with a price history: [{ key, q, r, name, samples }] (latest first). */
    historyTowns(player) {
        const st = PriceKnowledge.state(player);
        return Object.entries(st.hist.towns).map(([key, list]) => {
            const [q, r] = key.split(',').map(Number);
            const t = st.towns[key];
            return { key, q, r, name: t ? t.n : key, samples: list.length, last: list.length ? list[list.length - 1][0] : 0 };
        }).sort((a, b) => b.last - a.last || (a.key < b.key ? -1 : 1));
    },

    // ── Reading the book ───────────────────────────────────

    /** Drop the stalest towns past maxTowns (towns with a history are kept as long as it is). */
    _prune(player) {
        const C = PriceKnowledge.config();
        const st = PriceKnowledge.state(player);
        const keys = Object.keys(st.towns);
        if (keys.length <= C.maxTowns) return;
        keys.sort((a, b) => _num(st.towns[a].d) - _num(st.towns[b].d) || (a < b ? -1 : 1));
        for (const k of keys.slice(0, keys.length - C.maxTowns)) {
            delete st.towns[k];
            delete st.hist.towns[k];
        }
    },

    /** How old a quote is, in days, and as words ('today', '1 day old', '12 days old'). */
    age(day, today) {
        return Math.max(0, Math.round(_num(today) - _num(day)));
    },

    ageText(days) {
        const d = Math.max(0, Math.round(_num(days)));
        return d === 0 ? 'today' : d === 1 ? '1 day old' : `${d} days old`;
    },

    sourceInfo(src) {
        return PriceKnowledge.config().sources[src] || { name: 'hearsay', icon: '❔' };
    },

    /** Every known town: [{ key, q, r, name, type, day, goods }]. */
    towns(player) {
        const st = PriceKnowledge.state(player);
        return Object.entries(st.towns).map(([key, t]) => {
            const [q, r] = key.split(',').map(Number);
            return { key, q, r, name: t.n, type: t.t, day: t.d, goods: Object.keys(t.g).length };
        }).sort((a, b) => (a.key < b.key ? -1 : 1));
    },

    /** One town's quote for a good, or null: { ask, bid, scarcity, day, age, src }. */
    quote(player, world, q, r, goodId) {
        const st = PriceKnowledge.state(player);
        const t = st.towns[_key(q, r)];
        const e = t && t.g[goodId];
        if (!e) return null;
        return { ask: e[0], bid: e[1], scarcity: e[2] / 100, day: e[3], age: PriceKnowledge.age(e[3], _day(world)), src: e[4] };
    },

    /** Every known quote for a good: [{ key, q, r, name, type, ask, bid, scarcity, day, age, src }]. */
    known(player, world, goodId) {
        const st = PriceKnowledge.state(player);
        const today = _day(world);
        const out = [];
        for (const [key, t] of Object.entries(st.towns)) {
            const e = t.g[goodId];
            if (!e) continue;
            const [q, r] = key.split(',').map(Number);
            out.push({ key, q, r, name: t.n, type: t.t, ask: e[0], bid: e[1], scarcity: e[2] / 100, day: e[3], age: PriceKnowledge.age(e[3], today), src: e[4] });
        }
        return out.sort((a, b) => a.ask - b.ask || (a.key < b.key ? -1 : 1));
    },

    /** Goods the book has any quote for (sorted by id). */
    knownGoods(player) {
        const st = PriceKnowledge.state(player);
        const set = new Set();
        for (const t of Object.values(st.towns)) for (const id of Object.keys(t.g)) set.add(id);
        return [...set].sort();
    },

    /**
     * The best known buy-here, sell-there margins within `days` of travel of
     * (q, r): for each good, buy where its known asking price is lowest and
     * sell where the stalls are known to pay most (both towns within reach),
     * from the book alone. [{ good, buy, sell, margin, pct, dist, age }],
     * best margin first. `maxAge` drops quotes older than that.
     */
    spreads(player, world, { q = player && player.q, r = player && player.r, days = null, maxAge = Infinity, goods = null, limit = 12 } = {}) {
        const C = PriceKnowledge.config();
        const reach = Math.max(0, _num(days, C.maxTravelDays)) * C.hexesPerDay;
        const W = world && world.width;
        const dist = (a, b) => (W ? Hex.wrappingDistance(a.q, a.r, b.q, b.r, W) : Hex.distance(a.q, a.r, b.q, b.r));
        const from = { q, r };
        const out = [];
        for (const id of goods || PriceKnowledge.knownGoods(player)) {
            const list = PriceKnowledge.known(player, world, id).filter(x => x.age <= maxAge && Number.isFinite(q) && dist(from, x) <= reach);
            let best = null;
            for (const b of list) {
                if (!(b.ask > 0)) continue;
                for (const s of list) {
                    if (s.key === b.key || !(s.bid > b.ask)) continue;
                    const margin = s.bid - b.ask;
                    if (!best || margin > best.margin || (margin === best.margin && s.key + b.key < best.sell.key + best.buy.key)) {
                        best = { good: id, buy: b, sell: s, margin, pct: margin / b.ask, dist: dist(b, s), age: Math.max(b.age, s.age) };
                    }
                }
            }
            if (best) out.push(best);
        }
        out.sort((a, b) => b.margin - a.margin || (a.good < b.good ? -1 : 1));
        return out.slice(0, limit);
    },

    // ── The player's own trading ───────────────────────────

    /** A purchase at a town's stalls: the cost goes into the good's average cost, and where it was bought. */
    recordBuy(player, settlement, goodId, qty, cost) {
        if (!player || !(qty > 0)) return;
        const P = PriceKnowledge.state(player).pnl;
        const h = P.held[goodId] || (P.held[goodId] = { qty: 0, cost: 0, from: null });
        h.qty += qty;
        h.cost = Math.round((h.cost + _num(cost)) * 100) / 100;
        h.from = (settlement && settlement.name) || h.from;
        const g = P.goods[goodId] || (P.goods[goodId] = { bought: 0, spent: 0, sold: 0, earned: 0, profit: 0 });
        g.bought += qty;
        g.spent = Math.round(g.spent + _num(cost));
    },

    /** A sale: set against the average cost of the good bought (nothing for goods found or made), by good and route. */
    recordSale(player, settlement, goodId, qty, earned) {
        if (!player || !(qty > 0)) return;
        const C = PriceKnowledge.config();
        const P = PriceKnowledge.state(player).pnl;
        const h = P.held[goodId];
        let basis = 0, from = 'found or made';
        if (h && h.qty > 0) {
            const n = Math.min(qty, h.qty);
            basis = h.cost * n / h.qty;
            h.cost = Math.round((h.cost - basis) * 100) / 100;
            h.qty -= n;
            from = h.from || from;
            if (!(h.qty > 0)) delete P.held[goodId];
        }
        const profit = Math.round(_num(earned) - basis);
        const g = P.goods[goodId] || (P.goods[goodId] = { bought: 0, spent: 0, sold: 0, earned: 0, profit: 0 });
        g.sold += qty;
        g.earned = Math.round(g.earned + _num(earned));
        g.profit += profit;
        const route = `${from} → ${(settlement && settlement.name) || 'a market'}`;
        const rt = P.routes[route] || (P.routes[route] = { trips: 0, profit: 0, goods: {} });
        rt.trips++;
        rt.profit += profit;
        rt.goods[goodId] = _num(rt.goods[goodId]) + profit;
        const keys = Object.keys(P.routes);
        if (keys.length > C.routesCap) {
            // Forget the route that mattered least
            keys.sort((a, b) => Math.abs(P.routes[a].profit) - Math.abs(P.routes[b].profit) || (a < b ? -1 : 1));
            delete P.routes[keys[0] === route ? keys[1] : keys[0]];
        }
    },

    /** Trading profit and loss: { goods: [...], routes: [...], total }. */
    pnl(player) {
        const P = PriceKnowledge.state(player).pnl;
        const goods = Object.entries(P.goods).map(([id, g]) => ({ id, ...g })).sort((a, b) => b.profit - a.profit || (a.id < b.id ? -1 : 1));
        const routes = Object.entries(P.routes).map(([route, x]) => ({ route, ...x })).sort((a, b) => b.profit - a.profit || (a.route < b.route ? -1 : 1));
        return { goods, routes, total: goods.reduce((a, g) => a + g.profit, 0) };
    },
};

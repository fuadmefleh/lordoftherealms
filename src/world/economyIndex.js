// ============================================
// ECONOMY INDEX — each realm's prices, trade, work and money, week by week
// ============================================
// Once a week every realm's economy is measured over its settlements
// (population-weighted), and the whole world's the same way:
//   food      what the food goods cost against their base price (1 = base):
//             the stock's scarcity × the season × debased coin
//   goods     the same over every market good, weighted by what people
//             spend on it — the realm's cost of living; its rise is
//             inflation (a mint clipping its coin shows here at once)
//   trade     goods the merchants moved through its towns in a market turn
//   short     towns short of something (scarcity at least shortageAt)
//   dearth    towns in a food dearth
//   idle      the share of hands with no work; welfare, how content they are
//   treasury, debt ratio and coin purity of its crown (systems/finance.js)
// A history of historyWeeks samples is kept, and the big moves (bread
// dear and rising, prices up since the season began) are recorded for the
// heralds (systems/heralds.js) and the townsfolk (systems/chatter.js).
//
// Readers: KingdomStability's target ('Cost of living', world/kingdomState.js),
// KingdomAI.considerWar (a realm whose bread is dear is slower to march),
// the gazette and the Economy panel (systems/economyChronicle.js,
// ui/actionMenu/economy.js), the Steward's counsel.
//
// Pure world model: reads the markets, labour and crowns, draws no RNG.
// State on world.economy (saved with the world). Tuned in data/chronicle.json
// → indices. Ticked weekly by systems/economyChronicle.js.

import { DataLoader } from '../core/dataLoader.js';
import { SettlementMarket } from './settlementMarket.js';
import { TownLabour } from './townLabour.js';
import { Coinage } from './coinage.js';
import { Seasons } from './seasons.js';

/** The fields of a history row, in order (rows are kept as arrays to keep saves small). */
export const INDEX_FIELDS = ['day', 'food', 'goods', 'trade', 'short', 'dearth', 'idle', 'welfare', 'pop', 'treasury', 'debt', 'purity', 'towns'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r3 = (v) => Math.round(v * 1000) / 1000;
const WORLD = '*';

const DEFAULTS = {
    every: 7, historyWeeks: 40, changeWeeks: 4, shortageAt: 1.6,
    foodGoods: ['grain', 'flour', 'bread', 'fish', 'meat', 'cheese'],
    dearAt: 1.3, dearRel: 1.08, cheapAt: 0.8, surgePct: 0.15, inflationPct: 0.15, inflationRel: 0.05, newsGapWeeks: 6, newsCap: 30,
    stability: { dearFrom: 1.1, perPoint: 30, max: 6, plentyBelow: 0.9, plenty: 2 },
    war: { dearFrom: 1.1, perPoint: 1, max: 0.2 },
};

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

let _cfgSrc;
let _cfg = null;

export const EconomyIndex = {
    FIELDS: INDEX_FIELDS,
    WORLD,

    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.chronicle && gd.chronicle.indices) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = d || {};
            _cfg = { ...DEFAULTS, ...o, stability: { ...DEFAULTS.stability, ...(o.stability || {}) }, war: { ...DEFAULTS.war, ...(o.war || {}) } };
        }
        return _cfg;
    },

    // ── State ─────────────────────────────────────────────

    state(world) {
        if (!world) return { lastDay: null, rows: {}, news: [], newsAt: {} };
        let st = world.economy;
        if (!_obj(st)) st = world.economy = { lastDay: null, rows: {}, news: [], newsAt: {} };
        if (!_obj(st.rows)) st.rows = {};
        if (!Array.isArray(st.news)) st.news = [];
        if (!_obj(st.newsAt)) st.newsAt = {};
        if (st.lastDay === undefined) st.lastDay = null;
        return st;
    },

    serialize(world) {
        const st = world && _obj(world.economy);
        return st ? JSON.parse(JSON.stringify(st)) : null;
    },

    /** After a load (older saves: no history yet — the first week measures afresh). */
    restore(saved, world) {
        if (!world) return;
        world.economy = _obj(saved) ? JSON.parse(JSON.stringify(saved)) : null;
        EconomyIndex.state(world);
    },

    // ── Measuring ─────────────────────────────────────────

    /** Spending weights of the market goods: perCapita × base price (food goods flagged). */
    _weights() {
        const C = SettlementMarket.config();
        const G = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS) || {};
        const food = new Set(EconomyIndex.config().foodGoods);
        return C.goodIds.map((id, i) => {
            const g = G[id.toUpperCase()];
            return { id, i, w: _num(C.goods[id] && C.goods[id].perCapita) * _num(g && g.basePrice, 1), food: food.has(id) };
        }).filter(x => x.w > 0);
    },

    /** One town's prices against base: { food, goods, worst } (null without a market). */
    townPrices(world, s, weights = EconomyIndex._weights(), season = null) {
        if (!s || !s.market || !s.market.stock) return null;
        const day = Seasons.today(world);
        const coin = Coinage.priceMultiplier(world, s);
        // (the scarcity curve inlined over the town's need table: this runs for every town and good)
        const sh = SettlementMarket._shape(s);
        const P = SettlementMarket.config().price;
        const stock = s.market.stock;
        let fN = 0, fD = 0, gN = 0, gD = 0, worst = 0;
        const usedA = sh.usedA, targetA = sh.targetA, e = -P.elasticity, lo = P.min, hi = P.max;
        for (let j = 0; j < weights.length; j++) {
            const x = weights[j];
            if (!usedA[x.i]) continue;
            const st = stock[x.id];
            const ratio = st > 0 ? st / targetA[x.i] : 0;
            const sc = ratio > 0 ? Math.max(lo, Math.min(hi, Math.pow(ratio, e))) : hi;
            if (sc > worst) worst = sc;
            const p = sc * (season ? season[x.i] : Seasons.priceMultiplier(x.id, day));
            gN += x.w * p; gD += x.w;
            if (x.food) { fN += x.w * p; fD += x.w; }
        }
        return { food: fD > 0 ? fN / fD * coin : coin, goods: gD > 0 ? gN / gD * coin : coin, worst };
    },

    /** Measure every realm and the world now: { rows: { kid|'*': row array } }. */
    measure(world) {
        const C = EconomyIndex.config();
        const weights = EconomyIndex._weights();
        const day = _num(world && world.day);
        const sday = Seasons.today(world);
        const season = new Float64Array(SettlementMarket.config().goodIds.length).fill(1);
        for (const x of weights) season[x.i] = Seasons.priceMultiplier(x.id, sday);
        const acc = new Map();
        const get = (k) => {
            let a = acc.get(k);
            if (!a) acc.set(k, a = { pop: 0, food: 0, goods: 0, trade: 0, short: 0, dearth: 0, idle: 0, wel: 0, lpop: 0, towns: 0 });
            return a;
        };
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) {
            const p = EconomyIndex.townPrices(world, s, weights, season);
            if (!p) continue;
            const pop = Math.max(1, _num(s.population));
            const m = s.market;
            const trade = m.trade ? _num(m.trade.in) + _num(m.trade.out) : 0;
            const short = p.worst >= C.shortageAt ? 1 : 0;
            const dearth = SettlementMarket.inDearth(s) ? 1 : 0;
            const lab = s.labour;
            const idle = lab && lab.sh ? TownLabour.idle(s) : 0;
            const wel = lab && Number.isFinite(lab.all) ? lab.all : null;
            for (const k of [WORLD, s.kingdom != null ? s.kingdom : null]) {
                if (k == null) continue;
                const a = get(k);
                a.pop += pop; a.towns++;
                a.food += p.food * pop; a.goods += p.goods * pop;
                a.trade += trade; a.short += short; a.dearth += dearth;
                if (wel != null) { a.idle += idle * pop; a.wel += wel * pop; a.lpop += pop; }
            }
        }
        const rows = {};
        for (const [k, a] of acc) {
            const kg = k === WORLD ? null : _kingdom(world, k);
            const f = kg && _obj(kg.finance);
            rows[k] = [
                day, _r3(a.food / a.pop), _r3(a.goods / a.pop), Math.round(a.trade), a.short, a.dearth,
                a.lpop > 0 ? _r3(a.idle / a.lpop) : 0, a.lpop > 0 ? _r3(a.wel / a.lpop) : 0, Math.round(a.pop),
                kg ? Math.round(_num(kg.treasury)) : null, f ? _r3(_num(f.debtRatio)) : null, kg ? _r3(Coinage.purity(kg)) : null, a.towns,
            ];
        }
        if (!rows[WORLD]) rows[WORLD] = [day, 1, 1, 0, 0, 0, 0, 0, 0, null, null, null, 0];
        return rows;
    },

    /**
     * The weekly turn: measure (every `every` days), keep the history and
     * note the big moves for the heralds. Returns the news made, or null when
     * it is not the day.
     */
    processDay(world) {
        if (!world) return null;
        const C = EconomyIndex.config();
        const st = EconomyIndex.state(world);
        const day = _num(world.day);
        if (st.lastDay != null && day - st.lastDay < C.every && day >= st.lastDay) return null;
        st.lastDay = day;
        const rows = EconomyIndex.measure(world);
        const cap = Math.max(2, Math.floor(_num(C.historyWeeks, 40)));
        for (const [k, row] of Object.entries(rows)) {
            const list = st.rows[k] || (st.rows[k] = []);
            list.push(row);
            if (list.length > cap) list.splice(0, list.length - cap);
        }
        // Realms that fell keep their history until it ages out of the window
        for (const [k, list] of Object.entries(st.rows)) {
            if (!list.length || day - list[list.length - 1][0] > cap * C.every) delete st.rows[k];
        }
        return EconomyIndex._news(world, st, C);
    },

    /**
     * Bread dear and rising (and dearer than the world's: the lean weeks
     * alone are no news), prices up since the season began faster than
     * elsewhere: one record per realm per gap.
     */
    _news(world, st, C) {
        const made = [];
        const day = _num(world.day);
        const wNow = EconomyIndex.latest(world, null);
        const wThen = EconomyIndex.ago(world, null, C.changeWeeks);
        const wUp = wNow && wThen && wThen.goods > 0 ? wNow.goods / wThen.goods - 1 : 0;
        for (const kg of world.kingdoms || []) {
            if (!kg || kg.isAlive === false) continue;
            const now = EconomyIndex.latest(world, kg.id);
            const then = EconomyIndex.ago(world, kg.id, C.changeWeeks);
            if (!now || !then || !(then.food > 0) || !(then.goods > 0)) continue;
            const last = st.newsAt[kg.id];
            if (last != null && day - last < C.newsGapWeeks * C.every) continue;
            const foodUp = now.food / then.food - 1;
            const goodsUp = now.goods / then.goods - 1;
            let kind = null, pct = 0;
            const rel = wNow && wNow.food > 0 ? now.food / wNow.food : 1;
            if (now.food >= C.dearAt && rel >= C.dearRel && foodUp >= C.surgePct) { kind = 'dear'; pct = foodUp; } else if (goodsUp >= C.inflationPct && goodsUp - wUp >= C.inflationRel) { kind = 'inflation'; pct = goodsUp; }
            if (!kind) continue;
            st.newsAt[kg.id] = day;
            const cap = kg.capital && Number.isFinite(kg.capital.q) ? kg.capital : null;
            const h = {
                key: `econ:${kind}:${kg.id}:${day}`, kind, day, kingdomId: kg.id, kingdom: kg.name,
                pct: Math.round(pct * 100), food: Math.round(now.food * 100), since: Seasons.seasonOf(then.day),
                q: cap ? cap.q : null, r: cap ? cap.r : null,
            };
            st.news.push(h);
            made.push(h);
        }
        if (st.news.length > C.newsCap) st.news.splice(0, st.news.length - C.newsCap);
        return made;
    },

    // ── Reading ───────────────────────────────────────────

    /** A history row as an object ({ day, food, goods, ... }), or null. */
    row(arr) {
        if (!Array.isArray(arr)) return null;
        const o = {};
        INDEX_FIELDS.forEach((f, i) => { o[f] = arr[i] === undefined ? null : arr[i]; });
        return o;
    },

    _list(world, kid) {
        const st = world && _obj(world.economy);
        if (!st || !_obj(st.rows)) return null;
        return st.rows[kid == null ? WORLD : kid] || null;
    },

    /** The realm's (or the world's, kid null) history up to `upTo` (a day), oldest first: [row objects]. */
    history(world, kid = null, upTo = Infinity) {
        const list = EconomyIndex._list(world, kid) || [];
        return list.filter(r => r[0] <= upTo).map(EconomyIndex.row);
    },

    /** The latest measure (as of `upTo`), or null. */
    latest(world, kid = null, upTo = Infinity) {
        const list = EconomyIndex._list(world, kid);
        if (!list) return null;
        for (let i = list.length - 1; i >= 0; i--) if (list[i][0] <= upTo) return EconomyIndex.row(list[i]);
        return null;
    },

    /** The measure `weeks` samples before the latest (as of `upTo`), or the oldest kept; null with fewer than two. */
    ago(world, kid = null, weeks = 4, upTo = Infinity) {
        const list = (EconomyIndex._list(world, kid) || []).filter(r => r[0] <= upTo);
        if (list.length < 2) return null;
        return EconomyIndex.row(list[Math.max(0, list.length - 1 - Math.max(1, Math.floor(weeks)))]);
    },

    /** How far an index moved over `weeks` (a ratio − 1, e.g. 0.2 for +20%), or null. */
    change(world, kid, field = 'goods', weeks = null, upTo = Infinity) {
        const C = EconomyIndex.config();
        const now = EconomyIndex.latest(world, kid, upTo);
        const then = EconomyIndex.ago(world, kid, weeks == null ? C.changeWeeks : weeks, upTo);
        if (!now || !then || !(then[field] > 0) || !Number.isFinite(now[field])) return null;
        return now[field] / then[field] - 1;
    },

    /** The heralds' records of the big moves (newest last). */
    news(world) {
        const st = world && _obj(world.economy);
        return st && Array.isArray(st.news) ? st.news : [];
    },

    // ── Readers for the crowns ────────────────────────────

    /**
     * How dear a realm's food is against the world's (1 = as dear as
     * anywhere), from the latest measure; null until measured. The lean
     * weeks raise every realm's bread together — what sours a people is
     * paying more than their neighbours.
     */
    relativeFood(world, kingdom) {
        const now = kingdom ? EconomyIndex.latest(world, kingdom.id) : null;
        const all = now ? EconomyIndex.latest(world, null) : null;
        if (!now || !all || !(now.food > 0) || !(all.food > 0)) return null;
        return now.food / all.food;
    },

    /**
     * Stability target term for the cost of living (world/kingdomState.js):
     * bread dearer than the world's costs up to stability.max, cheaper gives
     * stability.plenty. 0 until the realm has been measured.
     */
    stabilityMod(world, kingdom) {
        const rel = EconomyIndex.relativeFood(world, kingdom);
        if (rel == null) return 0;
        const S = EconomyIndex.config().stability;
        if (rel > S.dearFrom) return -Math.min(_num(S.max), (rel - S.dearFrom) * _num(S.perPoint));
        if (rel < S.plentyBelow) return _num(S.plenty);
        return 0;
    },

    /**
     * A crown's confidence to march (KingdomAI.considerWar): 1, less when
     * its bread is dearer than its neighbours' and the people want peace.
     * 1 until measured.
     */
    warConfidence(world, kingdom) {
        const rel = EconomyIndex.relativeFood(world, kingdom);
        if (rel == null) return 1;
        const W = EconomyIndex.config().war;
        if (rel <= W.dearFrom) return 1;
        return 1 - Math.min(_num(W.max), (rel - W.dearFrom) * _num(W.perPoint));
    },
};

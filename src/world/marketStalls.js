// ============================================================
// MARKET STALLS — each stall a trader of its own
// ============================================================
// The stalls of a town square (tp_stall, world/townPlanner.js) and of the
// marketplace hall (its 2×1 stall furniture, world/innerMap/interiors.js) are
// each one trader with a line of wares: a fishmonger, a baker, a draper...
// (data/marketStalls.json trades). A stall sells only its trade's goods, out
// of the town market's real stock (settlement.market, world/settlementMarket.js)
// at the market's own prices (player/playerEconomy/trading.js stallGoods), and
// its keeper buys back only goods of its trade (accepts).
//
// A stall's trade is drawn once, by a hash of the world seed, the town and the
// stall's place — never the generation RNG, so no frozen sequence shifts —
// weighted by what the town stocks, its wealth tier (world/settlementWealth.js,
// the tier its buildings stand in), its culture and the land around it, and no
// two alike in one square while another trade is open. The draw is kept on the
// settlement (settlement.stallTrades: { key: tradeId }, saved with it), so the
// same stall keeps its trade every visit; it is drawn again only if the town no
// longer allows the trade (a poorer tier, a culture that bars it).
//
// Pure: no randomness of its own, no globals; settlement, world and tile are
// passed in.

import { DataLoader } from '../core/dataLoader.js';
import { SettlementMarket } from './settlementMarket.js';
import { SettlementWealth } from './settlementWealth.js';
import { Cultures } from './cultures.js';
import { Economy } from './economy.js';

const TYPE_RANK = { hamlet: 0, village: 1, town: 2, city: 3, capital: 4 };
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = v => (Array.isArray(v) ? v : []);

/** A hash of its parts to [0, 1) (FNV-1a): the stalls' own stream. */
function _u(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/** The square ('o') or the hall a stall stands in ('in:q,r'): no two alike in one. */
function _groupOf(key) {
    const k = String(key);
    if (!k.startsWith('in:')) return 'o';
    return k.split(':').slice(0, 2).join(':');
}

export const MarketStalls = {
    data() {
        return (DataLoader._gamedata && DataLoader._gamedata.marketStalls) || { trades: {} };
    },

    trades() {
        return MarketStalls.data().trades || {};
    },

    trade(id) {
        return (id && MarketStalls.trades()[id]) || null;
    },

    /** The wealth tier a town's buildings stand in ('poor' | 'mid' | 'rich'). */
    tier(settlement) {
        return SettlementWealth.tierOf(SettlementWealth.standing(settlement));
    },

    /**
     * What a town is, for its stalls: { tier, type, culture, water, land, tradeIn, seed, town }.
     * `q, r`: the town's world hex (the settlement's own when left out).
     */
    context(settlement, world = null, q = null, r = null) {
        const sq = Number.isFinite(q) ? q : _num(settlement && settlement.q, 0);
        const sr = Number.isFinite(r) ? r : _num(settlement && settlement.r, 0);
        const land = world ? SettlementMarket.landProfile(world, sq, sr) : { shares: {}, river: false };
        const shares = land.shares || {};
        const m = settlement && settlement.market;
        return {
            tier: MarketStalls.tier(settlement),
            type: (settlement && settlement.type) || 'village',
            culture: world ? Cultures.cultureOf(world, settlement) : (settlement && settlement.culture) || null,
            water: (shares.water || 0) > 0 || !!land.river || !!(settlement && (settlement.isPort || settlement.coastal)),
            land: shares,
            tradeIn: m && m.trade ? _num(m.trade.in) : 0,
            seed: (world && world.generationParams && world.generationParams.seed) || 0,
            town: `${(settlement && settlement.name) || ''}@${sq},${sr}`,
        };
    },

    /** May the town have this trade at all (its tier, size, culture, water)? Not its stock. */
    allowed(tradeId, ctx) {
        const t = MarketStalls.trade(tradeId);
        if (!t || !ctx) return false;
        const tiers = _arr(t.tiers).length ? _arr(t.tiers) : ['poor', 'mid', 'rich'];
        const routeIn = _num(MarketStalls.data().routeIn, 3);
        const tierOk = tiers.includes(ctx.tier) || (_arr(t.routeTiers).includes(ctx.tier) && ctx.tradeIn >= routeIn);
        if (!tierOk) return false;
        if (t.minType && _num(TYPE_RANK[ctx.type], 1) < _num(TYPE_RANK[t.minType], 0)) return false;
        if (t.needsWater && !ctx.water) return false;
        if (ctx.culture && t.cultures && t.cultures[ctx.culture] === 0) return false;
        return true;
    },

    /**
     * The trade's goods the town's market has for sale today: tracked goods with a
     * whole unit in store, and the few the market lists without a store (seed).
     */
    wares(settlement, tradeId, tile = null) {
        const t = MarketStalls.trade(tradeId);
        if (!t || !settlement) return [];
        SettlementMarket.ensure(settlement);
        let listed = null;
        const out = [];
        for (const id of _arr(t.goods)) {
            if (SettlementMarket.tracks(id)) {
                if (SettlementMarket.available(settlement, id) >= 1) out.push(id);
                continue;
            }
            if (!listed) listed = new Map(Economy.marketGoods(settlement, tile).map(g => [String(g.key).toLowerCase(), g.qtyMult]));
            const mult = listed.get(id);
            if (mult != null && Math.floor(_num(settlement.population) * mult) >= 1) out.push(id);
        }
        return out;
    },

    /** Does the trade's keeper buy this good (its own goods and its buys)? */
    accepts(tradeId, goodId) {
        const t = MarketStalls.trade(tradeId);
        return !!t && (_arr(t.goods).includes(goodId) || _arr(t.buys).includes(goodId));
    },

    /**
     * How strongly the town calls for the trade: its weight × its culture × the land
     * × how well the market is stocked in its goods (0 when it isn't allowed, or the
     * market hasn't minWares of them).
     */
    weight(tradeId, settlement, ctx, tile = null) {
        const t = MarketStalls.trade(tradeId);
        if (!t || !MarketStalls.allowed(tradeId, ctx)) return 0;
        const wares = MarketStalls.wares(settlement, tradeId, tile);
        if (wares.length < Math.max(1, _num(t.minWares, 1))) return 0;
        let w = _num(t.weight, 1);
        if (ctx.culture && t.cultures && Number.isFinite(t.cultures[ctx.culture])) w *= t.cultures[ctx.culture];
        let landMult = 1;
        for (const [cls, k] of Object.entries(t.land || {})) landMult += _num(k) * _num(ctx.land && ctx.land[cls]);
        w *= landMult;
        // What the town really stocks: each ware's store against the stock the market aims at
        // (how full its stores are, on the mean; a little more for a wider line of wares)
        let stocked = 0;
        for (const id of wares) {
            if (!SettlementMarket.tracks(id)) { stocked += 0.3; continue; }
            const tgt = SettlementMarket.target(settlement, id);
            stocked += Math.min(2, SettlementMarket.stock(settlement, id) / Math.max(1, tgt));
        }
        return w * (0.4 + stocked / wares.length) * (1 + 0.15 * Math.min(4, wares.length - 1));
    },

    /** The trades the town can set up today: [{ id, weight }], by weight. */
    eligible(settlement, ctx, tile = null) {
        const out = [];
        for (const id of Object.keys(MarketStalls.trades())) {
            const weight = MarketStalls.weight(id, settlement, ctx, tile);
            if (weight > 0) out.push({ id, weight });
        }
        return out.sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1));
    },

    /**
     * Each stall's trade: { key: tradeId } for `keys` ('o:q,r' in the square,
     * 'in:bq,br:q,r' in the hall). A stall drawn before keeps its trade while the
     * town allows it (settlement.stallTrades); the rest are drawn in key order,
     * the trades not yet in their square first.
     */
    assign(settlement, keys, ctx, tile = null) {
        if (!settlement || !ctx) return {};
        const kept = settlement.stallTrades && typeof settlement.stallTrades === 'object' ? settlement.stallTrades : (settlement.stallTrades = {});
        const sorted = [...new Set(_arr(keys).map(String))].sort();
        const out = {};
        const used = {};
        const use = (key, id) => {
            const g = _groupOf(key);
            const m = used[g] || (used[g] = {});
            m[id] = (m[id] || 0) + 1;
        };
        // Those kept from before (in this square or another of the same town)
        for (const key of Object.keys(kept)) {
            if (MarketStalls.allowed(kept[key], ctx)) use(key, kept[key]);
        }
        for (const key of sorted) {
            if (kept[key] && MarketStalls.allowed(kept[key], ctx)) out[key] = kept[key];
        }
        let pool = null;
        for (const key of sorted) {
            if (out[key]) continue;
            if (!pool) {
                pool = MarketStalls.eligible(settlement, ctx, tile);
                // (a town whose market has nothing a trade sells: the trades it allows, at their weights)
                if (!pool.length) {
                    pool = Object.keys(MarketStalls.trades()).filter(id => MarketStalls.allowed(id, ctx))
                        .map(id => ({ id, weight: _num(MarketStalls.trade(id).weight, 1) }));
                }
                if (!pool.length) {
                    const fb = MarketStalls.data().fallback;
                    pool = MarketStalls.trade(fb) ? [{ id: fb, weight: 1 }] : [];
                }
            }
            if (!pool.length) continue;
            const inSquare = used[_groupOf(key)] || {};
            const open = pool.filter(p => !inSquare[p.id]);
            const cands = open.length ? open : pool.map(p => ({ id: p.id, weight: p.weight / (1 + 3 * (inSquare[p.id] || 0)) }));
            const total = cands.reduce((s, p) => s + p.weight, 0);
            let x = _u(ctx.seed, ctx.town, 'stall', key) * total;
            let pick = cands[cands.length - 1].id;
            for (const p of cands) {
                x -= p.weight;
                if (x < 0) { pick = p.id; break; }
            }
            out[key] = pick;
            kept[key] = pick;
            use(key, pick);
        }
        return out;
    },

    /** The stall's name: "Marta's Fish Stall", or "the Fish Stall" without a keeper. */
    stallName(tradeId, keeperName = null) {
        const t = MarketStalls.trade(tradeId);
        const stall = (t && (t.stall || t.name)) || 'Market Stall';
        if (!keeperName) return `The ${stall}`;
        const first = String(keeperName).trim().split(/\s+/)[0];
        return `${first}${/s$/i.test(first) ? "'" : "'s"} ${stall}`;
    },

    /** A keeper's cry (a hash `u` in [0, 1) picks it): their trade's own, with one of the wares named. */
    cry(tradeId, u, goodName = null, town = null) {
        const t = MarketStalls.trade(tradeId);
        const cries = _arr(t && t.cries).filter(c => goodName || !/\{good\}/.test(c));
        if (!cries.length) return null;
        const line = cries[Math.floor(_num(u) * cries.length) % cries.length];
        const out = line.replace(/\{good\}/g, goodName || '').replace(/\{town\}/g, town || 'town');
        return out.charAt(0).toUpperCase() + out.slice(1);
    },

    /** The art a trade's stall wears (data/townProps.json stallArt key). */
    artOf(tradeId) {
        const t = MarketStalls.trade(tradeId);
        return (t && t.art) || tradeId;
    },

    /**
     * The art a trade's stall wears with these wares in stock today: the first of
     * its artVariants whose goods it has at least `min` (and at most `max`) of —
     * the greengrocer heaped with fruit after the harvest, with roots in winter —
     * else its own art.
     */
    artFor(tradeId, wares = []) {
        const t = MarketStalls.trade(tradeId);
        const have = new Set(_arr(wares));
        for (const v of _arr(t && t.artVariants)) {
            if (!v || !v.art) continue;
            const n = _arr(v.goods).filter(id => have.has(id)).length;
            if (n >= _num(v.min, 0) && n <= _num(v.max, Infinity)) return v.art;
        }
        return MarketStalls.artOf(tradeId);
    },
};

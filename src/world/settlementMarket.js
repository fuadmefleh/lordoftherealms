// ============================================
// SETTLEMENT MARKET — one goods economy for every town
// ============================================
// Each settlement keeps a single inventory of goods (settlement.market.stock,
// saved with the tile). The land around it, its map resources, craftsmen and
// the player's properties nearby put goods in; its people eat, drink, burn
// and wear them out; a town with the trade mills grain, bakes bread, brews
// beer and smiths iron. NPC trade (flows) moves goods along trade routes
// from glut to dearth. Prices everywhere read this stock:
//
//   scarcity = (stock / (daily need × target days)) ^ -elasticity, clamped
//   value    = base × scarcity × season × cold demand × world events
//   ask      = value × settlement size × local-resource discount × monopoly
//              (Economy.marketPrice — what the market charges)
//
// Buying removes real stock (the price climbs with every unit), selling adds
// it (the price falls). Shortages bite: a sustained food dearth strains the
// granary (Economy.produceDaily, Kingship.hunger), missing tools slow every
// workshop, a winter without fuel sours the mood, and plenty of beer and
// fine things lifts it a little.
//
// Pure model, deterministic and RNG-free. The daily tick (production
// profiles, trade links and their disruptions) is driven from
// systems/marketDynamics.js, which owns the player-side state (lairs,
// sieges) this layer may not import. Tuned in data/markets.json.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Seasons } from './seasons.js';
import { WorldEvents } from './worldEvents.js';
import { Coinage } from './coinage.js';
import { TownLabour } from './townLabour.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _round2 = (v) => Math.round(v * 100) / 100;

const COLD_BIOMES = ['tundra', 'snowy_wasteland', 'ice_sheet', 'taiga', 'boreal_forest', 'snow', 'ice'];
const MINED = ['iron', 'gold_ore', 'gems', 'coal', 'stone', 'salt', 'oil'];
const PLENTY_GROUPS = ['drink', 'luxury'];

let _cfgSrc;
let _cfg = null;
const _shapes = new WeakMap();

/** The built config: data/markets.json merged over empty defaults. */
function buildConfig(src) {
    const d = src && typeof src === 'object' ? src : {};
    const goods = {};
    for (const [id, g] of Object.entries(d.goods || {})) {
        if (!g || typeof g !== 'object' || id.startsWith('_')) continue;
        goods[id] = {
            perCapita: _num(g.perCapita), days: Math.max(1, _num(g.days, 20)), spoil: _clamp(_num(g.spoil), 0, 0.5),
            cap: Math.max(1, _num(g.cap, 4)), group: g.group || null, coldMult: _num(g.coldMult, 1) || 1,
            minType: g.minType || 'village', minStock: Math.max(0, _num(g.minStock)),
        };
    }
    const groups = {};
    for (const [id, g] of Object.entries(goods)) if (g.group) (groups[g.group] = groups[g.group] || []).push(id);
    const isFood = {}, isMined = {};
    for (const id of groups.food || []) isFood[id] = true;
    for (const id of MINED) isMined[id] = true;
    const typeRank = { village: 0, town: 1, city: 2, capital: 3, ...(d.typeRank || {}) };
    const recipes = (Array.isArray(d.recipes) ? d.recipes : []).filter(r => r && r.in && r.out).map(r => ({
        ...r, cap: _num(r.cap), rank: Number.isFinite(typeRank[r.minType || 'village']) ? typeRank[r.minType || 'village'] : 0,
    }));
    // Index tables for the daily tick (typed arrays, one slot per good)
    const goodIds = Object.keys(goods);
    const n = goodIds.length;
    const idx = {};
    goodIds.forEach((id, i) => { idx[id] = i; });
    const A = {
        spoil: new Float64Array(n), cap: new Float64Array(n), cold: new Float64Array(n),
        food: new Uint8Array(n), mined: new Uint8Array(n),
    };
    goodIds.forEach((id, i) => {
        const g = goods[id];
        A.spoil[i] = g.spoil; A.cap[i] = g.cap; A.cold[i] = g.coldMult;
        A.food[i] = isFood[id] ? 1 : 0; A.mined[i] = isMined[id] ? 1 : 0;
    });
    const groupIdx = {};
    for (const [grp, gids] of Object.entries(groups)) groupIdx[grp] = Int32Array.from(gids.map(id => idx[id]));
    const toIdx = (o) => Object.entries(o || {}).filter(([id, per]) => idx[id] !== undefined && per > 0).map(([id, per]) => [idx[id], per]);
    const recipesI = recipes.map(r => ({ id: r.id, fill: Math.max(0.5, _num(r.fill, 1)), rank: r.rank, cap: r.cap, inI: toIdx(r.in), outI: toIdx(r.out) }))
        .filter(r => r.inI.length && r.outI.length)
        .map((r, ix) => ({
            id: r.id, ix, fill: r.fill, rank: r.rank, cap: r.cap,
            inIdx: Int32Array.from(r.inI.map(x => x[0])), inPer: Float64Array.from(r.inI.map(x => x[1])),
            outIdx: Int32Array.from(r.outI.map(x => x[0])), outPer: Float64Array.from(r.outI.map(x => x[1])),
        }));
    // Scratch buffers for the daily tick (reused: allocating typed arrays is slow)
    const buf = {
        st: new Float64Array(n), prod: new Float64Array(n), needs: new Float64Array(n), unmet: new Float64Array(n),
        // (each trade's runs and capacity this turn, for the works that take a share of them)
        trRuns: new Float64Array(recipesI.length), trCap: new Float64Array(recipesI.length),
    };
    const terrainClass = {};
    for (const [cls, ids] of Object.entries(d.terrain || {})) {
        if (!Array.isArray(ids)) continue;
        for (const id of ids) (terrainClass[id] = terrainClass[id] || []).push(cls);
    }
    return {
        price: { elasticity: 0.6, min: 0.55, max: 2.4, noNeedMax: 1, trendAlpha: 0.15, trendBand: 0.06, ...(d.price || {}) },
        typeDemand: { village: 0.8, town: 1, city: 1.1, capital: 1.25, ...(d.typeDemand || {}) },
        typeRank,
        goods,
        goodIds,
        idx,
        A,
        groupIdx,
        recipesI,
        buf,
        groups,
        groupNames: Object.keys(groups),
        isFood,
        isMined,
        noNeedRef: _num(d.noNeedRef, 0.25),
        terrainClass,
        terrainClasses: Object.keys(d.terrain || {}),
        fertility: d.fertility || {},
        food: { selfSupply: {}, fishWater: 0.6, fishResource: 0.25, meatPasture: 0.25, meatResource: 0.25, grainMin: 0.3, ...(d.food || {}) },
        supply: d.supply || {},
        resourceScale: _num(d.resourceScale, 0.35),
        craftScale: _num(d.craftScale, 0.04),
        itemGoods: d.itemGoods || {},
        extraResources: d.extraResources || {},
        propertySpill: { radius: 3, share: 0.25, ...(d.propertySpill || {}) },
        recipes,
        shortage: {
            alpha: 0.12, dearth: 0.25, foodStrain: 0.6, toolPenalty: 0.25, fuelMood: 6, plentyMood: 2, plentyAt: 1.15, moodStep: 0.5, eatShare: 0.5,
            ...(d.shortage || {}),
        },
        trade: {
            partners: 6, localRange: 7, seaRange: 14, maxRange: 16, perHex: 0.035, roadFactor: 0.6, seaFactor: 0.5,
            capacity: 60, perRoute: 25, maxRoutes: 4, share: 0.2, keepDays: 0.5, goldScale: 6,
            lairRadius: 3, lairCut: 0.6, raiderRadius: 2, raiderCut: 0.35, warCut: 1, siegeCut: 1, atWarFactor: 0.75,
            ...(d.trade || {}),
        },
        // Works the player built or funded (market.works; systems/merchantPrince.js)
        works: { fill: 2, keep: 0.75, minMargin: 0.1, steps: 4, lootDamage: 0.6, capture: 0, ...(d.works || {}) },
        recipeById: Object.fromEntries(recipesI.map(r => [r.id, r])),
        labels: Array.isArray(d.labels) && d.labels.length ? d.labels : [{ max: 99, label: 'Steady', color: '#aaa' }],
        tickDays: Number.isInteger(d.tickDays) && d.tickDays >= 1 ? d.tickDays : 1,
        // Identifies the goods list a market's tables were laid out for
        layout: goodIds.join(',').split('').reduce((h, ch) => ((h * 31) + ch.charCodeAt(0)) >>> 0, 7),
    };
}

export const SettlementMarket = {
    // ── Config ─────────────────────────────────────────────

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.markets : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = buildConfig(src);
        }
        return _cfg;
    },

    /** The market definition of a good (data/markets.json), or null when markets don't trade it. */
    good(goodId) {
        return SettlementMarket.config().goods[goodId] || null;
    },

    /** Does the settlement market keep this good in stock? */
    tracks(goodId) {
        return !!SettlementMarket.good(goodId);
    },

    _rank(type) {
        const r = SettlementMarket.config().typeRank;
        return Number.isFinite(r[type]) ? r[type] : 0;
    },

    /**
     * Per-settlement need table for its current size and type (memoised:
     * prices are read many times a day): { used, need, target } by good.
     */
    _shape(settlement) {
        const C = SettlementMarket.config();
        // Needs follow the population in steps of 25 people (so the table holds for days)
        const pop = Math.round(Math.max(0, _num(settlement.population)) / 25) * 25;
        const type = settlement.type;
        let sh = _shapes.get(settlement);
        // (the same labour record at the same mix key gives the same class demand:
        // skip asking for it — this is read hundreds of times a day)
        const lab = settlement.labour;
        const lcfg = TownLabour.config();
        if (sh && sh.pop === pop && sh.type === type && sh.cfg === C && sh.lab === lab && sh.lcfg === lcfg
            && (!lab || (sh.mk === lab.mk && sh.lsh === lab.sh))) return sh;
        // ...and the class mix: nobles buy wine, peasants grain (world/townLabour.js)
        const dm = TownLabour.demandMults(settlement, C);
        if (sh && sh.pop === pop && sh.type === type && sh.cfg === C && sh.dm === dm) {
            sh.lab = lab; sh.lcfg = lcfg; sh.mk = lab ? lab.mk : undefined; sh.lsh = lab ? lab.sh : undefined;
            return sh;
        }
        const n = C.goodIds.length;
        sh = {
            pop, type, cfg: C, dm, used: {}, need: {}, target: {},
            usedA: new Uint8Array(n), needA: new Float64Array(n), targetA: new Float64Array(n),
            lab, lcfg, mk: lab ? lab.mk : undefined, lsh: lab ? lab.sh : undefined,
        };
        const rank = Number.isFinite(C.typeRank[type]) ? C.typeRank[type] : 0;
        const td = _num(C.typeDemand[type], 1) || 1;
        C.goodIds.forEach((id, i) => {
            const g = C.goods[id];
            const minRank = Number.isFinite(C.typeRank[g.minType]) ? C.typeRank[g.minType] : 0;
            const used = g.perCapita > 0 && rank >= minRank;
            const need = used ? pop * g.perCapita * td * (dm ? dm[i] : 1) : 0;
            // (a town keeps at least the good's minStock of what its people use)
            const target = Math.max(Math.max(0.05, need > 0 ? need : pop * g.perCapita * C.noNeedRef) * g.days, used ? g.minStock : 0);
            sh.used[id] = used;
            sh.need[id] = need;
            sh.target[id] = target;
            sh.usedA[i] = used ? 1 : 0;
            sh.needA[i] = need;
            sh.targetA[i] = target;
        });
        _shapes.set(settlement, sh);
        return sh;
    },

    /**
     * Give the market's stock and trend tables every traded good, in config
     * order (0 where none) — one stable shape that the daily tick updates in
     * place. Done once per market (and again if the goods list changes).
     */
    _canon(m) {
        const C = SettlementMarket.config();
        if (m.layout === C.layout) return m;
        const stock = {}, trend = {};
        const oldS = m.stock || {}, oldT = m.trend || {};
        for (const id of C.goodIds) {
            stock[id] = Math.max(0, _num(oldS[id]));
            trend[id] = Math.max(0, _num(oldT[id]));
        }
        m.stock = stock;
        m.trend = trend;
        m.layout = C.layout;
        return m;
    },

    /** The market's stock as a typed array in config order (for the daily tick). */
    _load(m, into = null) {
        SettlementMarket._canon(m);
        const ids = SettlementMarket.config().goodIds;
        const arr = into || new Float64Array(ids.length);
        const st = m.stock;
        for (let i = 0; i < ids.length; i++) {
            const v = st[ids[i]];
            arr[i] = v > 0 ? v : 0;
        }
        return arr;
    },

    /** Write a typed stock array back into the market's stock (in place, rounded to hundredths). */
    _store(m, arr) {
        SettlementMarket._canon(m);
        const ids = SettlementMarket.config().goodIds;
        const st = m.stock;
        for (let i = 0; i < ids.length; i++) {
            st[ids[i]] = arr[i] > 0.004 ? Math.round(arr[i] * 100) / 100 : 0;
        }
    },

    /** Do this settlement's people use the good (its size is at least the good's minType)? */
    uses(settlement, goodId) {
        if (!settlement || !SettlementMarket.good(goodId)) return false;
        return SettlementMarket._shape(settlement).used[goodId];
    },

    _pop(settlement) {
        return Math.max(0, _num(settlement && settlement.population));
    },

    _typeDemand(settlement) {
        const t = SettlementMarket.config().typeDemand;
        return _num(t[settlement && settlement.type], 1) || 1;
    },

    /** Units a day the settlement's people use of a good in fair weather (0 when they don't use it). */
    need(settlement, goodId) {
        if (!settlement || !SettlementMarket.good(goodId)) return 0;
        return SettlementMarket._shape(settlement).need[goodId];
    },

    /** The daily need prices are measured against (a small trading need where nobody uses it). */
    refNeed(settlement, goodId) {
        const g = SettlementMarket.good(goodId);
        return g && settlement ? SettlementMarket._shape(settlement).target[goodId] / g.days : 0;
    },

    /** The stock a market aims to hold: its reference need × the good's target days. */
    target(settlement, goodId) {
        if (!settlement || !SettlementMarket.good(goodId)) return 0;
        return SettlementMarket._shape(settlement).target[goodId];
    },

    // ── State ─────────────────────────────────────────────

    /**
     * The settlement's market, created at its equilibrium (every good its
     * people use stocked to its target, so prices start at the old base)
     * the first time it is needed — new towns and old saves alike. Old
     * saves' bought-counters and the unused stockpile are dropped.
     */
    ensure(settlement) {
        if (!settlement || typeof settlement !== 'object') return null;
        let m = settlement.market;
        if (m && typeof m === 'object' && m.stock && typeof m.stock === 'object') return m;
        m = { stock: {}, trend: {}, short: { food: 0, tools: 0, fuel: 0 }, plenty: 0, trade: { in: 0, out: 0, cut: 0 } };
        for (const id of SettlementMarket.config().goodIds) {
            const used = SettlementMarket.uses(settlement, id);
            m.stock[id] = used ? _round2(SettlementMarket.target(settlement, id)) : 0;
            m.trend[id] = used ? 1 : 0;
        }
        m.layout = SettlementMarket.config().layout;
        settlement.market = m;
        if ('marketStock' in settlement) delete settlement.marketStock;
        if (settlement.economy && settlement.economy.stockpile) delete settlement.economy.stockpile;
        return m;
    },

    /** Units of a good in store (0 when none or not traded). */
    stock(settlement, goodId) {
        const m = settlement && settlement.market;
        return m && m.stock ? Math.max(0, _num(m.stock[goodId])) : 0;
    },

    /** Whole units a buyer can take. */
    available(settlement, goodId) {
        return Math.floor(SettlementMarket.stock(settlement, goodId) + 1e-9);
    },

    /** Take up to `n` units out of store (a purchase); returns what was taken. */
    take(settlement, goodId, n) {
        if (!SettlementMarket.tracks(goodId) || !(n > 0)) return 0;
        const m = SettlementMarket.ensure(settlement);
        if (!m) return 0;
        const have = Math.max(0, _num(m.stock[goodId]));
        const got = Math.min(have, n);
        m.stock[goodId] = _round2(have - got);
        return got;
    },

    /** Put `n` units into store (a sale, a delivery, a convoy's cargo). */
    add(settlement, goodId, n) {
        if (!SettlementMarket.tracks(goodId) || !(n > 0)) return 0;
        const m = SettlementMarket.ensure(settlement);
        if (!m) return 0;
        m.stock[goodId] = _round2(Math.max(0, _num(m.stock[goodId])) + n);
        return n;
    },

    /** Burn or carry off `share` of every store (a sack, a raid, a conquest). */
    loot(settlement, share) {
        const m = SettlementMarket.ensure(settlement);
        if (!m) return;
        const keep = 1 - _clamp(_num(share), 0, 1);
        for (const id in m.stock) m.stock[id] = _round2(Math.max(0, _num(m.stock[id])) * keep);
        // ...and the mills and workshops in town take their share of the damage
        SettlementMarket.damageWorks(settlement, _clamp(_num(share), 0, 1) * SettlementMarket.config().works.lootDamage);
    },

    // ── Works (industry the player built or funded) ───────

    /** A local industry by recipe id (data/markets.json recipes): { id, rank, cap, fill, inIdx, ... } or null. */
    recipe(recipeId) {
        return SettlementMarket.config().recipeById[recipeId] || null;
    },

    /** The recipe's inputs or outputs as { goodId: units per run }. */
    recipeGoods(recipeId, side = 'in') {
        const rc = SettlementMarket.recipe(recipeId);
        if (!rc) return {};
        const ids = SettlementMarket.config().goodIds;
        const idx = side === 'out' ? rc.outIdx : rc.inIdx, per = side === 'out' ? rc.outPer : rc.inPer;
        const out = {};
        for (let j = 0; j < idx.length; j++) out[ids[idx[j]]] = per[j];
        return out;
    },

    /** Can this settlement have the trade (its size is at least the recipe's minType)? */
    hasTrade(settlement, recipeId) {
        const rc = SettlementMarket.recipe(recipeId);
        return !!(rc && settlement && SettlementMarket._rank(settlement.type) >= rc.rank);
    },

    /** Runs a day the town's own trade can work at most (per 1000 people × its cap). */
    tradeCapacity(settlement, recipeId) {
        const rc = SettlementMarket.recipe(recipeId);
        if (!rc || !SettlementMarket.hasTrade(settlement, recipeId)) return 0;
        return rc.cap * SettlementMarket._pop(settlement) / 1000;
    },

    /** The works for a recipe at this settlement (market.works[recipeId]), or null. */
    works(settlement, recipeId) {
        const m = settlement && settlement.market;
        const w = m && m.works && m.works[recipeId];
        return w && typeof w === 'object' ? w : null;
    },

    /**
     * Build or extend works: `cap` runs a day at full repair, `lvl` levels,
     * `owner` who takes the profit ('player', 'crown', 'town'). Returns the entry.
     */
    setWorks(settlement, recipeId, fields) {
        const m = SettlementMarket.ensure(settlement);
        if (!m || !SettlementMarket.recipe(recipeId)) return null;
        if (!m.works || typeof m.works !== 'object') m.works = {};
        const w = m.works[recipeId] || (m.works[recipeId] = { cap: 0, lvl: 0, cond: 1, owner: 'player', runs: 0, va: 0, day: null });
        Object.assign(w, fields || {});
        w.cap = Math.max(0, _num(w.cap));
        w.cond = _clamp(_num(w.cond, 1), 0, 1);
        if (!(w.lvl > 0) || !(w.cap > 0)) delete m.works[recipeId];
        if (!Object.keys(m.works).length) delete m.works;
        return SettlementMarket.works(settlement, recipeId);
    },

    /** Knock `share` off the repair of every works in town (a raid, a sack, a bombardment). */
    damageWorks(settlement, share) {
        const m = settlement && settlement.market;
        if (!m || !m.works || !(share > 0)) return;
        for (const id in m.works) {
            const w = m.works[id];
            w.cond = _round2(_clamp(_num(w.cond, 1) * (1 - _clamp(share, 0, 1)), 0, 1));
        }
    },

    /** Base prices of the traded goods in config order (data/playerEconomy.json GOODS), memoised. */
    _bases() {
        const C = SettlementMarket.config();
        const G = DataLoader._gamedata && DataLoader._gamedata.playerEconomy ? DataLoader._gamedata.playerEconomy.GOODS : null;
        if (C._bases && C._basesSrc === G) return C._bases;
        const arr = new Float64Array(C.goodIds.length);
        C.goodIds.forEach((id, i) => {
            const g = G && G[id.toUpperCase()];
            arr[i] = g && g.basePrice > 0 ? g.basePrice : 0;
        });
        C._bases = arr;
        C._basesSrc = G;
        return arr;
    },

    /**
     * One turn of the player's works (from processSettlement, after the
     * town's own trades), up to cap × repair × `mult` runs:
     *   - first they take over a share of the runs the town's own trade
     *     made this turn (`trRuns`, its capacity `trCap`, by recipe index):
     *     capture × works / (works + trade capacity) of them — the town's
     *     craftsmen bring their work to the better-found works, so the
     *     stores are as the trade left them and only the margin changes
     *     hands. A big, busy trade gives a level its full share; a small or
     *     idle one little;
     *   - then they run on top while the town keeps `keep` of its target
     *     of the inputs and the output stays under `fill` × its target.
     * Every run must still add `minMargin` of its output's worth (and its
     * hands' wages) at today's stock. Records the turn's runs (`runs`, of
     * which `took` were the trade's) and the value added (gold, at the
     * town's scarcity) on the works.
     */
    _runWorks(m, st, sh, k, mult, day, settlement = null, trRuns = null, trCap = null) {
        const C = SettlementMarket.config();
        const W = C.works;
        const bases = SettlementMarket._bases();
        const target = sh.targetA, needOf = sh.needA, used = sh.usedA;
        const steps = Math.max(1, Math.floor(_num(W.steps, 4)));
        for (const id in m.works) {
            const w = m.works[id];
            const rc = C.recipeById[id];
            w.runs = 0;
            w.va = 0;
            if (day != null) w.day = day;
            if (!rc || !(w.cap > 0)) continue;
            let left = w.cap * _clamp(_num(w.cond, 1), 0, 1) * mult;
            const oi = rc.outIdx, op = rc.outPer, ii = rc.inIdx, ip = rc.inPer;
            // The hands' wages for a run (world/townLabour.js): a run must pay them too
            const wageRun = settlement ? TownLabour.worksWagePerRun(settlement, id, w) : 0;
            let runs = 0, va = 0, took = 0;
            // A share of the trade's own runs this turn (the stores already hold their output)
            const tRuns = trRuns ? trRuns[rc.ix] : 0;
            if (tRuns > 0 && W.capture > 0 && left > 0.005) {
                const share = _clamp(W.capture, 0, 1) * left / (left + Math.max(0, trCap[rc.ix]));
                const n = Math.min(left, tRuns * share);
                let outV = 0, inV = 0;
                for (let j = 0; j < oi.length; j++) outV += op[j] * bases[oi[j]] * SettlementMarket.curve(st[oi[j]] / target[oi[j]], used[oi[j]]);
                for (let j = 0; j < ii.length; j++) inV += ip[j] * bases[ii[j]] * SettlementMarket.curve(st[ii[j]] / target[ii[j]], used[ii[j]]);
                if (n > 0.005 && outV > 0 && outV - inV - wageRun >= outV * W.minMargin) {
                    took = n;
                    runs += n;
                    va += n * (outV - inV);
                    left -= n;
                }
            }
            for (let s = 0; s < steps && left > 0.005; s++) {
                let chunk = left / (steps - s);
                for (let j = 0; j < oi.length; j++) chunk = Math.min(chunk, Math.max(0, target[oi[j]] * W.fill - st[oi[j]]) / op[j]);
                for (let j = 0; j < ii.length; j++) {
                    const keep = Math.max(needOf[ii[j]] * k, target[ii[j]] * W.keep);
                    chunk = Math.min(chunk, Math.max(0, st[ii[j]] - keep) / ip[j]);
                }
                if (!(chunk > 0.005)) break;
                // What a run adds at today's stock: its output's worth less its inputs'
                let outV = 0, inV = 0;
                for (let j = 0; j < oi.length; j++) outV += op[j] * bases[oi[j]] * SettlementMarket.curve(st[oi[j]] / target[oi[j]], used[oi[j]]);
                for (let j = 0; j < ii.length; j++) inV += ip[j] * bases[ii[j]] * SettlementMarket.curve(st[ii[j]] / target[ii[j]], used[ii[j]]);
                if (!(outV > 0) || outV - inV - wageRun < outV * W.minMargin) break;
                for (let j = 0; j < ii.length; j++) st[ii[j]] = Math.max(0, st[ii[j]] - chunk * ip[j]);
                for (let j = 0; j < oi.length; j++) st[oi[j]] += chunk * op[j];
                runs += chunk;
                va += chunk * (outV - inV);
                left -= chunk;
            }
            w.runs = _round2(runs);
            w.va = _round2(va);
            if (took > 0) w.took = _round2(took);
            else delete w.took;
        }
    },

    // ── Fairs ─────────────────────────────────────────────

    /** The fair being held here ({ id, name, until, ask, sell }), or null (systems/marketFairs.js). */
    fair(settlement) {
        const m = settlement && settlement.market;
        return m && m.fair && typeof m.fair === 'object' ? m.fair : null;
    },

    /** Factor on what the market asks while a fair is on (merchants from afar undercut the stalls). */
    fairAsk(settlement) {
        const f = SettlementMarket.fair(settlement);
        return f ? _clamp(_num(f.ask, 1), 0.5, 1) : 1;
    },

    // ── Prices ────────────────────────────────────────────

    /** Scarcity multiplier for a stock/target ratio. */
    curve(ratio, used = true) {
        const P = SettlementMarket.config().price;
        const hi = used ? P.max : Math.min(P.max, P.noNeedMax);
        if (!(ratio > 0)) return hi;
        return _clamp(Math.pow(ratio, -P.elasticity), P.min, hi);
    },

    /**
     * How dear a good is here against its base: (stock / target) ^ -e,
     * clamped. 1 for a settlement without a market or a good it doesn't
     * trade (pure price fixtures and old code paths stay on the base
     * formula). `level` prices a hypothetical stock (a purchase path).
     */
    scarcity(settlement, goodId, level = null) {
        const m = settlement && settlement.market;
        if (!m || !m.stock || !SettlementMarket.tracks(goodId)) return 1;
        const stock = level == null ? Math.max(0, _num(m.stock[goodId])) : Math.max(0, level);
        const sh = SettlementMarket._shape(settlement);
        return SettlementMarket.curve(stock / sh.target[goodId], sh.used[goodId]);
    },

    /**
     * Factor on a unit's price at stock `level` against the price at the
     * current stock — what buying (level below) or selling (level above)
     * moves the price by.
     */
    levelFactor(settlement, goodId, level) {
        const now = SettlementMarket.scarcity(settlement, goodId);
        return now > 0 ? SettlementMarket.scarcity(settlement, goodId, level) / now : 1;
    },

    /**
     * Cold-weather demand for firewood and warm clothes. `world` is null in
     * headless fixtures, which falls back to the biome.
     */
    coldFactor(world, tile, goodId) {
        if (goodId !== 'firewood' && goodId !== 'clothes') return 1;
        if (world && world.weather && tile) {
            const temp = world.weather.getTemperature(tile.q, tile.r);
            const celsius = typeof temp === 'object' ? temp.celsius : 15;
            const wx = world.weather.getWeather(tile.q, tile.r).type;
            const isCold = celsius < 5 || wx === 'snow' || wx === 'blizzard';
            if (goodId === 'firewood') return isCold ? 1.5 : 0.8;
            return isCold ? 1.3 : 1;
        }
        if (goodId !== 'firewood') return 1;
        const biome = tile && tile.terrain && tile.terrain.id;
        return COLD_BIOMES.includes(biome) ? 1.5 : 0.8;
    },

    /** Running world events (a market crash, drought food prices, ...) on prices here. */
    eventFactor(world, tile, goodId) {
        if (!world || !Array.isArray(world.activeEvents) || !world.activeEvents.length) return 1;
        let mod = WorldEvents.getModifier(world, 'prices', tile);
        if (WorldEvents.FOOD_GOODS.includes(goodId)) mod += WorldEvents.getModifier(world, 'foodPrices', tile);
        return Math.max(0.1, 1 + mod);
    },

    /**
     * What a unit of the good is worth in this town today, before the
     * market's own markup: base × scarcity × season × cold × events. Sales,
     * caravans, ports and tavern talk read this.
     */
    value(world, settlement, tile, goodId, basePrice, level = null) {
        const base = _num(basePrice);
        if (!(base > 0)) return 0;
        return base * SettlementMarket.scarcity(settlement, goodId, level)
            * Seasons.priceMultiplier(goodId, Seasons.today(world))
            * SettlementMarket.coldFactor(world, tile, goodId)
            * SettlementMarket.eventFactor(world, tile, goodId)
            * Coinage.priceMultiplier(world, settlement); // a debased coin buys less (world/coinage.js)
    },

    /**
     * What `qty` units are worth to this town if they all land in its store
     * at once: each unit at the value the stock it finds commands (the
     * first at today's value, the last after the rest have glutted it).
     */
    lotValue(world, settlement, tile, goodId, basePrice, qty) {
        const q = Math.max(0, Math.floor(qty));
        if (!(q > 0)) return 0;
        const now = SettlementMarket.value(world, settlement, tile, goodId, basePrice);
        if (!settlement || !settlement.market || !SettlementMarket.tracks(goodId)) return now * q;
        const s0 = SettlementMarket.stock(settlement, goodId);
        let sum = 0;
        for (let j = 0; j < q; j++) sum += SettlementMarket.levelFactor(settlement, goodId, s0 + j);
        return now * sum;
    },

    /** Stock label for a scarcity: { label, color } (Glut … Dearth). */
    label(scarcity) {
        const labels = SettlementMarket.config().labels;
        for (const l of labels) if (scarcity <= l.max) return l;
        return labels[labels.length - 1];
    },

    /**
     * 'rising' | 'falling' | 'stable': today's scarcity against the scarcity
     * of the stock's moving average (market.trend keeps stock / target).
     */
    trend(settlement, goodId) {
        const m = settlement && settlement.market;
        if (!m || !m.trend || !(goodId in m.trend)) return 'stable';
        const now = SettlementMarket.scarcity(settlement, goodId);
        const used = SettlementMarket.uses(settlement, goodId);
        const avg = SettlementMarket.curve(_num(m.trend[goodId]), used);
        const band = SettlementMarket.config().price.trendBand;
        if (now > avg * (1 + band)) return 'rising';
        if (now < avg * (1 - band)) return 'falling';
        return 'stable';
    },

    /** One good at a settlement, for the market screen: stock, days of need, scarcity, label, trend. */
    info(settlement, goodId) {
        const stock = SettlementMarket.stock(settlement, goodId);
        const need = SettlementMarket.need(settlement, goodId);
        const scarcity = SettlementMarket.scarcity(settlement, goodId);
        const l = SettlementMarket.label(scarcity);
        return {
            stock, need, scarcity,
            days: need > 0 ? stock / need : null,
            label: l.label, color: l.color,
            trend: SettlementMarket.trend(settlement, goodId),
        };
    },

    // ── Shortages and their effects ────────────────────────

    /** Food shortage gauge 0..1 (moving average of the share of food need unmet). */
    foodShortage(settlement) {
        const m = settlement && settlement.market;
        return m && m.short ? _clamp(_num(m.short.food), 0, 1) : 0;
    },

    /** Is the town in dearth (a sustained food shortage)? */
    inDearth(settlement) {
        return SettlementMarket.foodShortage(settlement) >= SettlementMarket.config().shortage.dearth;
    },

    /**
     * Extra consumption a food dearth puts on the town's granary (fraction
     * for Economy._feedPopulation's consumption modifier): people who can't
     * buy bread eat harder into the stores.
     */
    foodStrain(settlement) {
        const S = SettlementMarket.config().shortage;
        const f = SettlementMarket.foodShortage(settlement);
        return f > S.dearth * 0.5 ? f * S.foodStrain : 0;
    },

    /** Output factor while tools are short (1 = no shortage). */
    toolFactor(settlement) {
        const m = settlement && settlement.market;
        if (!m || !m.short) return 1;
        return 1 - _clamp(_num(m.short.tools), 0, 1) * SettlementMarket.config().shortage.toolPenalty;
    },

    /**
     * The good this town is shortest of (scarcity at least `min`), or null:
     * { id, scarcity }. Food staples count first in a dearth.
     */
    worstShortage(settlement, min = 1.6) {
        const m = settlement && settlement.market;
        if (!m || !m.stock) return null;
        let best = null;
        for (const id of SettlementMarket.config().goodIds) {
            if (!SettlementMarket.uses(settlement, id)) continue;
            const s = SettlementMarket.scarcity(settlement, id);
            if (s >= min && (!best || s > best.scarcity)) best = { id, scarcity: s };
        }
        return best;
    },

    /** The good this town has most of (scarcity at most `max`), or null. */
    biggestGlut(settlement, max = 0.7) {
        const m = settlement && settlement.market;
        if (!m || !m.stock) return null;
        let best = null;
        for (const id of SettlementMarket.config().goodIds) {
            if (!(SettlementMarket.stock(settlement, id) >= 5)) continue;
            const s = SettlementMarket.scarcity(settlement, id);
            if (s <= max && (!best || s < best.scarcity)) best = { id, scarcity: s };
        }
        return best;
    },

    // ── Production profile ────────────────────────────────

    /**
     * What the land around a hex is like: shares of each terrain class over
     * the seven hexes, farmland fertility, a river, and the map resources
     * within two hexes ({ id, direct }). Static unless the land is changed.
     */
    landProfile(world, q, r) {
        const C = SettlementMarket.config();
        const shares = {};
        for (const cls of C.terrainClasses) shares[cls] = 0;
        const F = C.fertility;
        let fert = 0, fertN = 0, river = false, n = 0;
        if (world && typeof world.getTile === 'function') {
            for (const h of Hex.hexesInRange(q, r, 1)) {
                const t = world.getTile(world.width ? Hex.wrapQ(h.q, world.width) : h.q, h.r);
                if (!t || !t.terrain) continue;
                n++;
                const id = t.terrain.id;
                for (const cls of C.terrainClass[id] || []) shares[cls]++;
                if (t.hasRiver) river = true;
                if (!(C.terrainClass[id] || []).includes('water')) {
                    fert += _num(F[id], _num(F._default, 0.8));
                    fertN++;
                }
            }
        }
        if (n > 0) for (const cls in shares) shares[cls] /= n;
        let fertility = fertN > 0 ? fert / fertN : _num(F._default, 0.8);
        if (river) fertility += _num(F.riverBonus);
        fertility = _clamp(fertility, _num(F.min, 0.35), _num(F.max, 1.4));
        const resources = [];
        if (world && typeof world.getTile === 'function') {
            for (const h of Hex.hexesInRange(q, r, 2)) {
                const t = world.getTile(world.width ? Hex.wrapQ(h.q, world.width) : h.q, h.r);
                if (t && t.resource && t.resource.id) resources.push({ id: t.resource.id, direct: h.q === q && h.r === r });
            }
        }
        return { shares, fertility, river, resources };
    },

    /**
     * Units a day of each good the settlement brings to market before the
     * day's season, events, damage and tool shortages:
     *   food: need × selfSupply × fertility × food multiplier (the
     *         breakdown's resource and peoples bonuses), split into grain,
     *         fish and meat by the waters and pastures around;
     *   land and craftsmen: need × (base + terrain shares × weights);
     *   resources: the breakdown's items (iron, gems, timber, …);
     *   player properties nearby (`spill`: { goodId: units }).
     * `breakdown` is Economy.calculateDetailedProduction's (or the one
     * produceDaily stored today); `foodBase` the type's base food × popMod.
     */
    production(settlement, land, breakdown, foodBase, spill = null) {
        const C = SettlementMarket.config();
        const pop = SettlementMarket._pop(settlement);
        const out = {};
        if (!(pop > 0)) return out;
        const td = SettlementMarket._typeDemand(settlement);
        const add = (id, n) => { if (n > 0 && C.goods[id]) out[id] = (out[id] || 0) + n; };
        const baseNeed = (id) => pop * C.goods[id].perCapita * td;
        const shares = (land && land.shares) || {};

        // Food: the land's grain, the waters' fish, the pastures' meat
        const groups = C.groups.food || [];
        let foodNeed = 0;
        for (const id of groups) if (SettlementMarket.uses(settlement, id)) foodNeed += baseNeed(id);
        // ...and the grain its brewers and distillers turn into drink
        for (const [id, per] of Object.entries(C.food.grainFor || {})) {
            if (C.goods[id] && SettlementMarket.uses(settlement, id)) foodNeed += baseNeed(id) * _num(per);
        }
        const bdFood = breakdown && Number.isFinite(breakdown.food) ? breakdown.food : null;
        const foodMult = bdFood != null && foodBase > 0 ? _clamp(bdFood / foodBase, 0.2, 4) : 1;
        const selfSupply = _num(C.food.selfSupply[settlement.type], 1);
        let food = foodNeed * selfSupply * _num(land && land.fertility, 1) * foodMult;
        const items = (breakdown && breakdown.items) || {};
        food += _num(items.food) * C.resourceScale;
        const res = (land && land.resources) || [];
        const has = (id) => res.some(r => r.id === id);
        const wFish = _num(shares.water) * C.food.fishWater + (has('fish') ? C.food.fishResource : 0);
        const wMeat = _num(C.food.meatBase) + _num(shares.pasture) * C.food.meatPasture + (has('cattle') ? C.food.meatResource : 0);
        const wGrain = Math.max(C.food.grainMin, 1 - wFish - wMeat);
        const wSum = wFish + wMeat + wGrain;
        add('grain', food * wGrain / wSum);
        add('fish', food * wFish / wSum);
        add('meat', food * wMeat / wSum);

        // The land and the craftsmen
        for (const [id, def] of Object.entries(C.supply)) {
            if (!C.goods[id] || !def || typeof def !== 'object') continue;
            let k = _num(def.base);
            for (const cls of C.terrainClasses) if (def[cls]) k += _num(shares[cls]) * def[cls];
            add(id, baseNeed(id) * k);
        }

        // Map resources (after the goods bonus and the peoples' crafts)
        for (const [item, n] of Object.entries(items)) {
            if (item === 'food') continue;
            if (item === 'textiles') { add('textiles', n * C.craftScale); continue; }
            const goods = C.itemGoods[item] || (C.goods[item] ? [item] : []);
            goods.forEach((id, i) => add(id, n * C.resourceScale * (i > 0 ? 0.5 : 1)));
        }
        const popMod = 1 + (pop / 10000) * 0.5;
        for (const r of res) {
            const extra = C.extraResources[r.id];
            if (!extra) continue;
            for (const [id, per] of Object.entries(extra)) add(id, _num(per) * popMod * (r.direct ? 1 : 0.5));
        }
        if (spill) for (const [id, n] of Object.entries(spill)) add(id, n);
        return out;
    },

    /** A production table ({ goodId: units }) as a list in config order (rounded), for the market to keep. */
    productionList(prod) {
        return SettlementMarket.config().goodIds.map(id => (prod && prod[id] > 0 ? Math.round(prod[id] * 1000) / 1000 : 0));
    },

    /**
     * The agricultural year as the market feels it: the settlements' food
     * curve (Seasons.settlementFoodMultiplier, yearly mean 1) damped by
     * food.seasonality — granaries and cellars smooth the rest.
     */
    seasonalFood(day) {
        const k = _num(SettlementMarket.config().food.seasonality, 1);
        return 1 + (Seasons.settlementFoodMultiplier(day) - 1) * k;
    },

    /** Days between a market's (or a trade link's) turns in the daily tick (data/markets.json tickDays). */
    tickDays() {
        const v = SettlementMarket.config().tickDays;
        return Number.isInteger(v) && v >= 1 ? v : 1;
    },

    /** The turn (0 .. tickDays-1) of a market at (q, r), or of a link (sums of its towns' q and r). */
    slot(q, r) {
        const k = SettlementMarket.tickDays();
        const h = (Math.abs(Math.floor(q)) * 7 + Math.abs(Math.floor(r)) * 13) % k;
        return h;
    },

    /** Is it cold at the settlement today (fuel and warm clothes in demand)? */
    isCold(world, tile) {
        if (world && world.weather && tile && typeof world.weather.getTemperature === 'function') {
            const temp = world.weather.getTemperature(tile.q, tile.r);
            const celsius = temp && typeof temp === 'object' ? temp.celsius : 15;
            if (celsius < 5) return true;
            const wx = typeof world.weather.getWeather === 'function' ? world.weather.getWeather(tile.q, tile.r) : null;
            return !!(wx && (wx.type === 'snow' || wx.type === 'blizzard'));
        }
        const day = Seasons.today(world);
        if (day != null && Seasons.seasonOf(day) === 'Winter') return true;
        return !!(tile && tile.terrain && COLD_BIOMES.includes(tile.terrain.id));
    },

    // ── The day ───────────────────────────────────────────

    /**
     * One day of a settlement's market: production (× season for food, ×
     * droughts, mine output, damage, holdings and tool shortages), local
     * industry, the people's consumption (staples stand in for each other
     * within food and fuel), the shortage gauges and their mood, spoilage,
     * and the price trend. `prod` from SettlementMarket.production; `ctx`:
     * { day, cold, foodMult, mineMult, intact, goodsMult }.
     */
    processSettlement(settlement, prod, ctx = {}) {
        const m = SettlementMarket.ensure(settlement);
        if (!m) return null;
        const C = SettlementMarket.config();
        const S = C.shortage;
        const P = C.price;
        const A = C.A;
        const ids = C.goodIds;
        const n = ids.length;
        // A market may be worked several days at a time (ctx.days): output,
        // use and spoilage scale with it, the gauges move as many steps
        const k = Math.max(1, Math.floor(_num(ctx.days, 1)));
        const pop = Math.max(0, _num(settlement.population));
        const short = m.short || (m.short = { food: 0, tools: 0, fuel: 0 });
        const toolF = 1 - _clamp(_num(short.tools), 0, 1) * S.toolPenalty;
        // Hands at work (world/townLabour.js): a town short of peasants reaps
        // less, one short of artisans makes less, a strike idles the trades
        const lf = TownLabour.factors(settlement, ctx.day);
        const craftMask = TownLabour.craftMask(C);
        const foodMult = _num(ctx.foodMult, 1) * toolF * k * lf.land;
        const otherMult = _num(ctx.intact, 1) * _num(ctx.goodsMult, 1) * toolF * k;
        const minedMult = otherMult * _num(ctx.mineMult, 1) * lf.land;
        const landMult = otherMult * lf.land, craftMult = otherMult * lf.craft;
        const sh = SettlementMarket._shape(settlement);
        const target = sh.targetA, needOf = sh.needA, used = sh.usedA;
        const B = C.buf;
        const st = SettlementMarket._load(m, B.st);
        // Today's trade counters (filled by flows)
        m.trade = { in: 0, out: 0, cut: 0 };

        // Production
        // (`prod` is a list in config order — SettlementMarket.productionList — or { goodId: units })
        const prodA = B.prod;
        if (Array.isArray(prod) && prod.length === n) {
            for (let i = 0; i < n; i++) prodA[i] = prod[i] > 0 ? prod[i] : 0;
        } else {
            prodA.fill(0);
            for (const id in prod || {}) {
                const i = C.idx[id];
                if (i !== undefined && prod[id] > 0) prodA[i] = prod[id];
            }
        }
        // A trade on strike (market.idle[recipeId] = until-day, systems/guilds.js):
        // its craftsmen bring nothing of their goods to market and its recipe stands idle
        let idle = null;
        if (m.idle) {
            for (const rid in m.idle) {
                const until = m.idle[rid];
                if (ctx.day != null && !(until > ctx.day)) continue;
                const rc = C.recipeById[rid];
                if (!rc) continue;
                (idle || (idle = {}))[rid] = true;
                for (let j = 0; j < rc.outIdx.length; j++) prodA[rc.outIdx[j]] = 0;
            }
        }
        for (let i = 0; i < n; i++) {
            if (prodA[i] > 0) st[i] += prodA[i] * (A.food[i] ? foodMult : A.mined[i] ? minedMult : craftMask[i] ? craftMult : landMult);
        }

        // Local industry: only where the output runs below target
        const rank = Number.isFinite(C.typeRank[settlement.type]) ? C.typeRank[settlement.type] : 0;
        // (how busy the trades ran — read by the labour market as the artisans' work)
        let runsAll = 0, capAll = 0;
        const trRuns = m.works ? B.trRuns : null, trCap = m.works ? B.trCap : null;
        if (trRuns) { trRuns.fill(0); trCap.fill(0); }
        for (const rc of C.recipesI) {
            if (rank < rc.rank || (idle && idle[rc.id])) continue;
            let runs = rc.cap * pop / 1000 * toolF * k * lf.craft;
            if (!(runs > 0)) continue;
            capAll += runs;
            if (trCap) trCap[rc.ix] = runs;
            const oi = rc.outIdx, op = rc.outPer, ii = rc.inIdx, ip = rc.inPer;
            // A trade with `fill` works ahead of need while its inputs are in glut (brewers
            // brew the harvest's cheap grain): up to fill × target at twice the inputs' target
            let fill = 1;
            if (rc.fill > 1) {
                let glut = 1;
                for (let j = 0; j < ii.length; j++) glut = Math.min(glut, _clamp(st[ii[j]] / target[ii[j]] - 1, 0, 1));
                fill = 1 + (rc.fill - 1) * glut;
            }
            for (let j = 0; j < oi.length; j++) runs = Math.min(runs, Math.max(0, target[oi[j]] * fill - st[oi[j]] + needOf[oi[j]] * k) / op[j]);
            for (let j = 0; j < ii.length; j++) runs = Math.min(runs, Math.max(0, st[ii[j]] - needOf[ii[j]] * k) / ip[j]);
            if (!(runs > 0.01)) continue;
            runsAll += runs;
            if (trRuns) trRuns[rc.ix] = runs;
            for (let j = 0; j < ii.length; j++) st[ii[j]] = Math.max(0, st[ii[j]] - runs * ip[j]);
            for (let j = 0; j < oi.length; j++) st[oi[j]] += runs * op[j];
        }
        m.util = capAll > 0 ? Math.round(Math.min(1, runsAll / capAll) * 1000) / 1000 : 0;
        // Works the player built or funded here (market.works) run on after the town's own trades
        if (m.works) SettlementMarket._runWorks(m, st, sh, k, toolF * k * _num(ctx.intact, 1) * _num(ctx.worksMult, 1) * lf.craft, ctx.day, settlement, trRuns, trCap);

        // Consumption; staples stand in for one another within a group
        // (bread short: they eat porridge; no firewood: they burn coal)
        const needs = B.needs, unmet = B.unmet;
        needs.fill(0);
        unmet.fill(0);
        for (let i = 0; i < n; i++) {
            let need = needOf[i];
            if (!(need > 0)) continue;
            need *= k;
            if (ctx.cold) need *= A.cold[i];
            needs[i] = need;
            // Short of a good, people make do rather than strip the stalls
            // bare: they buy at most `eatShare` of what's left (the rest
            // stays on sale, dear)
            const avail = st[i] >= need ? need : st[i] * S.eatShare;
            st[i] -= avail;
            if (avail < need) unmet[i] = need - avail;
        }
        const cover = {};
        for (const grp of C.groupNames) {
            const gi = C.groupIdx[grp];
            let need = 0, left = 0;
            for (let j = 0; j < gi.length; j++) { need += needs[gi[j]]; left += unmet[gi[j]]; }
            if (!(need > 0)) continue;
            if (left > 0 && (grp === 'food' || grp === 'fuel')) {
                for (let j = 0; j < gi.length && left > 0; j++) {
                    const i = gi[j];
                    const spare = st[i] - needs[i];
                    if (spare <= 0) continue;
                    const use = Math.min(spare, left);
                    st[i] -= use;
                    left -= use;
                }
            }
            cover[grp] = 1 - left / need;
        }

        // Shortage gauges (moving averages of the unmet share)
        const a = 1 - Math.pow(1 - S.alpha, k);
        const ema = (cur, x, hi = 1) => Math.round(((1 - a) * _num(cur) + a * _clamp(x, 0, hi)) * 1000) / 1000;
        short.food = ema(short.food, 1 - (cover.food != null ? cover.food : 1));
        short.tools = ema(short.tools, 1 - (cover.tools != null ? cover.tools : 1));
        short.fuel = ema(short.fuel, 1 - (cover.fuel != null ? cover.fuel : 1));
        // How much of each want the market met (moving averages; the classes' welfare reads them)
        const metG = m.met || (m.met = {});
        for (const grp of C.groupNames) {
            if (cover[grp] == null) { delete metG[grp]; continue; }
            metG[grp] = Number.isFinite(metG[grp]) ? ema(metG[grp], cover[grp]) : Math.round(_clamp(cover[grp], 0, 1) * 1000) / 1000;
        }
        // Plenty: the drink and fine things wanted today, and more than enough on hand
        let want = 0, wantN = 0, lux = 0, luxN = 0;
        for (const grp of PLENTY_GROUPS) {
            if (cover[grp] == null) continue;
            want += cover[grp];
            wantN++;
            const gi = C.groupIdx[grp];
            for (let j = 0; j < gi.length; j++) {
                const i = gi[j];
                if (!(needs[i] > 0)) continue;
                lux += Math.min(1.5, st[i] / target[i]);
                luxN++;
            }
        }
        // (every want met: how far past their target the stores run, up to 1.5; else the share met)
        const met = wantN ? want / wantN : 0;
        m.plenty = ema(m.plenty, wantN && luxN ? (met >= 0.99 ? lux / luxN : Math.min(met, lux / luxN)) : 0, 1.5);

        // Mood: a cold hearth sours it, plenty lifts it (tracked so it's given back)
        const fuelPain = ctx.cold ? _num(short.fuel) * S.fuelMood : 0;
        const plentyJoy = m.plenty > S.plentyAt ? (m.plenty - S.plentyAt) / Math.max(0.01, 1.5 - S.plentyAt) * S.plentyMood : 0;
        const moodTarget = _round2(Math.min(S.plentyMood, plentyJoy) - fuelPain);
        const cur = _num(settlement.marketMood);
        const step = S.moodStep * k;
        const next = cur < moodTarget ? Math.min(moodTarget, cur + step) : Math.max(moodTarget, cur - step);
        const delta = next - cur;
        if (delta !== 0) {
            settlement.marketMood = _round2(next);
            if (settlement.marketMood === 0) delete settlement.marketMood;
            const h = typeof settlement.happiness === 'number' ? settlement.happiness : 50;
            settlement.happiness = _clamp(h + delta, 0, 100);
        }

        // Spoilage and storage limits; the trend (a moving average of the
        // stock against its target — the price moves the other way)
        const ta = 1 - Math.pow(1 - P.trendAlpha, k);
        const trend = m.trend;
        for (let i = 0; i < n; i++) {
            let s = st[i];
            if (s > 0) {
                const f = 1 - A.spoil[i];
                let keep = f;
                for (let j = 1; j < k; j++) keep *= f;
                s *= keep;
                const cap = target[i] * A.cap[i] + prodA[i] * 20;
                if (s > cap) s = cap;
                st[i] = s;
            }
            const prev = trend[ids[i]];
            if (!(s > 0.004) && !(prev > 0)) continue;
            const ratio = s > 0.004 ? Math.min(10, s / target[i]) : 0;
            trend[ids[i]] = Math.round(((1 - ta) * prev + ta * ratio) * 1000) / 1000;
        }
        SettlementMarket._store(m, st);
        m.day = ctx.day != null ? ctx.day : m.day;
        return m;
    },

    /**
     * NPC trade for the day: along each link { a, b, friction, capacity,
     * factor } (live settlements; factor 0 = cut), every good moves from the
     * town where it's cheap to the one where it's dear while the gap beats
     * the haul's friction — a share of the exporter's surplus, at most the
     * importer's shortfall, within the link's capacity in gold. Both towns
     * keep goldScale × the value gap of what moved as trade income
     * (economy.tradeIncome, credited by Economy.processTrade).
     * A link marked `embody` (systems/merchantCaravans.js picked it to send
     * a caravan) takes the goods out of the exporter as usual but does not
     * land them: they are left on link.cargoAB / link.cargoBA (typed arrays
     * in config order, a→b and b→a) for the caravan to carry, and reach the
     * importer only when it arrives. Its trade income is not credited here
     * either: the margin of each direction is left on link.goldAB /
     * link.goldBA, and the caravan pays it to both towns on arrival
     * (MerchantCaravans) — a cargo lost on the road earns them nothing.
     * @returns {{ moved:number, value:number, gold:number }}
     */
    flows(links, basePrices, day = null) {
        const C = SettlementMarket.config();
        const T = C.trade;
        // Each link trades every `tickDays` (staggered by its towns), moving that many days' worth
        const k = SettlementMarket.tickDays();
        const turn = Number.isFinite(day) && k > 1 ? ((day % k) + k) % k : null;
        const share = turn !== null ? 1 - Math.pow(1 - T.share, k) : T.share;
        const out = { moved: 0, value: 0, gold: 0 };
        const P = C.price;
        const lo = P.min, hiUsed = P.max, hiFree = Math.min(P.max, P.noNeedMax), e = -P.elasticity;
        const sc = (stock, target, used) => {
            const hi = used ? hiUsed : hiFree;
            if (!(stock > 0)) return hi;
            const v = Math.pow(stock / target, e);
            return v < lo ? lo : v > hi ? hi : v;
        };
        const kd = T.keepDays;
        const ids = C.goodIds;
        const n = ids.length;
        const bases = new Float64Array(n);
        for (let i = 0; i < n; i++) bases[i] = basePrices[ids[i]] > 0 ? basePrices[ids[i]] : 0;
        // Each town's stock as a typed array for the day's trading, written back after
        const arrays = new Map();
        const arr = (s) => {
            let x = arrays.get(s);
            if (!x) { x = SettlementMarket._load(s.market); arrays.set(s, x); }
            return x;
        };
        const income = (s, g) => { if (s.economy) s.economy.tradeIncome = _num(s.economy.tradeIncome) + g; };
        for (const link of links) {
            if (!(link.factor > 0)) continue;
            const a = link.a, b = link.b;
            if (turn !== null && link.slot !== undefined && link.slot !== turn) continue;
            const ma = SettlementMarket.ensure(a), mb = SettlementMarket.ensure(b);
            if (!ma || !mb) continue;
            const sha = SettlementMarket._shape(a), shb = SettlementMarket._shape(b);
            const xa = arr(a), xb = arr(b);
            let budget = link.capacity * link.factor * (turn !== null ? k : 1);
            const fr = 1 + link.friction;
            // Stock ratios further apart than this can't beat the friction (the curve is a power law)
            const frR = Math.pow(fr, 1 / P.elasticity);
            let movedA = 0, movedB = 0, goldLink = 0;
            const emb = link.embody === true;
            let cAB = null, cBA = null, gAB = 0, gBA = 0;
            for (let i = 0; i < n; i++) {
                if (!(budget > 0)) break;
                const base = bases[i];
                if (!(base > 0)) continue;
                const stA = xa[i], stB = xb[i];
                if (stA <= 0 && stB <= 0) continue;
                const ta = sha.targetA[i], tb = shb.targetA[i];
                // Neither way can trade (no surplus over keepDays on one side with room under
                // target on the other): skip before pricing — the checks below would anyway
                if (!((stA - ta * kd > 0 && tb - stB > 0) || (stB - tb * kd > 0 && ta - stA > 0))) continue;
                if (stA > 0 && stB > 0) {
                    const q = (stA / ta) / (stB / tb);
                    if (q < frR && q > 1 / frR) continue;
                }
                const sa = sc(stA, ta, sha.usedA[i]), sb = sc(stB, tb, shb.usedA[i]);
                let xe, xi, se, si, tE, tI, aExports;
                if (sb > sa * fr) { xe = xa; xi = xb; se = sa; si = sb; tE = ta; tI = tb; aExports = true; }
                else if (sa > sb * fr) { xe = xb; xi = xa; se = sb; si = sa; tE = tb; tI = ta; aExports = false; }
                else continue;
                const surplus = xe[i] - tE * T.keepDays;
                if (!(surplus > 0)) continue;
                const room = tI - xi[i];
                if (!(room > 0)) continue;
                const gap = (si - se * fr) / si;
                let qty = Math.min(surplus * share, room * 0.5 * gap + 0.05, budget / (base * se));
                if (!(qty >= 0.05)) continue;
                qty = Math.round(qty * 100) / 100;
                xe[i] -= qty;
                if (!emb) xi[i] += qty;
                else if (aExports) (cAB || (cAB = new Float64Array(n)))[i] += qty;
                else (cBA || (cBA = new Float64Array(n)))[i] += qty;
                budget -= qty * base * se;
                const g = qty * base * (si - se) * T.goldScale;
                goldLink += g;
                if (aExports) { movedA += qty; gAB += g; } else { movedB += qty; gBA += g; }
                out.moved += qty;
                out.value += qty * base * se;
            }
            if (emb) { link.cargoAB = cAB; link.cargoBA = cBA; link.goldAB = gAB; link.goldBA = gBA; }
            if (movedA > 0 || movedB > 0) {
                // An embodied link's margin rides with its caravans (paid on arrival)
                if (!emb) {
                    income(a, goldLink / 2);
                    income(b, goldLink / 2);
                }
                ma.trade.out = _round2(_num(ma.trade.out) + movedA);
                ma.trade.in = _round2(_num(ma.trade.in) + movedB);
                mb.trade.out = _round2(_num(mb.trade.out) + movedB);
                mb.trade.in = _round2(_num(mb.trade.in) + movedA);
                out.gold += goldLink;
            }
        }
        for (const [s, x] of arrays) {
            SettlementMarket._store(s.market, x, SettlementMarket._shape(s).usedA);
            if (s.economy && s.economy.tradeIncome) s.economy.tradeIncome = _round2(s.economy.tradeIncome);
        }
        return out;
    },
};

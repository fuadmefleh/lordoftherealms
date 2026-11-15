// ============================================
// PRICE ANCHORS — each good's sense of a normal price, learnt from the market
// ============================================
// A good's data price (data/playerEconomy.json basePrice) is where its
// anchor starts. Every month (data/markets.json anchors.sampleDays; never
// on day 0, so generation prices on the data alone) the world's
// need-weighted geometric mean of the good's scarcity across the towns that
// use it is folded into a running mean (about a year's memory), and the
// anchor creeps toward it, a few percent a month at most, within
// anchors.min..max of the data price. A good dear everywhere for years so
// becomes "normally" dear.
//
// How the anchor is read: it is the good's normal price — base(world, id)
// for anything that weighs a price against what the good "should" cost (the
// market summary's change, SettlementMarket.info's label: a good dear
// everywhere for years reads Steady). Today's price stays the stock's
// (scarcity × the ask's factors): the towns' need doesn't answer to price,
// so an anchor that moved the price would feed on itself — tried, leather
// ran from 18g to 78g in two years with the band clamped about the anchor.
// The anchors read the stock alone (not the coin's price level,
// world/coinage.js), so a debased coin is not learnt twice.
//
// The same daily call binds every market to the world's anchors and turns
// on the craftsmen's floor (SettlementMarket._craftFloor: a made good never
// sells below its inputs at that market plus the work).
//
// State: world.priceAnchors = { at (the last sample's month), f: { goodId:
// anchor }, obs: { goodId: running mean of log scarcity } } — saved with the
// game (systems/saveLoad.js). Deterministic; draws no randomness.

import { SettlementMarket } from './settlementMarket.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r4 = (v) => Math.round(v * 10000) / 10000;

/** Per world: the binding the markets share ({ f: Float64Array, floor }), rebuilt when its state changes. */
const _bindings = new WeakMap();

export const PriceAnchors = {
    config() {
        return SettlementMarket.config().anchors;
    },

    /** The world's anchor state, made on first use. */
    state(world) {
        if (!world) return null;
        const st = world.priceAnchors;
        if (st && typeof st === 'object' && st.f && typeof st.f === 'object') {
            if (!st.obs || typeof st.obs !== 'object') st.obs = {};
            return st;
        }
        world.priceAnchors = { at: null, f: {}, obs: {} };
        return world.priceAnchors;
    },

    /** The good's anchor against its data price (1 = the data price; 1 without a world). */
    factor(world, goodId) {
        const st = world && world.priceAnchors;
        const v = st && st.f ? st.f[goodId] : undefined;
        return v > 0 ? v : 1;
    },

    /** The good's normal price in this world: its data price × its anchor. */
    base(world, goodId, basePrice) {
        return _num(basePrice) * PriceAnchors.factor(world, goodId);
    },

    /**
     * The stock label ({ label, color }, Glut … Dearth) for a scarcity read at
     * one of this world's markets — weighed against the good's anchor, as
     * SettlementMarket.info labels it (the price book and the trade map).
     */
    label(world, goodId, scarcity) {
        return SettlementMarket.label(_num(scarcity, 1) / PriceAnchors.factor(world, goodId));
    },

    /** The binding every market of this world shares (SettlementMarket.bindAnchors), kept in step with the state. */
    binding(world) {
        const C = SettlementMarket.config();
        const st = PriceAnchors.state(world);
        let b = _bindings.get(world);
        if (!b || b.f.length !== C.goodIds.length || b.src !== st || b.ver !== st.at) {
            b = b && b.f.length === C.goodIds.length ? b : { f: new Float64Array(C.goodIds.length), floor: true };
            C.goodIds.forEach((id, i) => { b.f[i] = PriceAnchors.factor(world, id); });
            b.src = st;
            b.ver = st.at;
            _bindings.set(world, b);
        }
        b.floor = !!C.craftFloor.enabled;
        return b;
    },

    /** Binds these settlements' markets (default: every town of the world) to the world's anchors. */
    bindAll(world, lives = null) {
        if (!world) return 0;
        const b = PriceAnchors.binding(world);
        let list = lives;
        if (!list) {
            list = [];
            const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
                : typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
            for (const v of views) {
                const t = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
                list.push((t && t.settlement) || v);
            }
        }
        let n = 0;
        for (const s of list) if (s && s.market) { SettlementMarket.bindAnchors(s, b); n++; }
        return n;
    },

    /**
     * The day's call from the market tick (systems/marketDynamics.js, after
     * the towns' turns): a month on, sample the world and move the anchors;
     * then bind the markets. `lives` = the towns' live settlements.
     */
    update(world, lives, day) {
        if (!world || !Array.isArray(lives)) return null;
        const A = PriceAnchors.config();
        const st = PriceAnchors.state(world);
        const every = Math.max(1, Math.floor(_num(A.sampleDays, 30)));
        const month = Math.floor(_num(day) / every);
        let moved = null;
        if (A.enabled && Number.isFinite(day) && day > 0 && st.at !== month) {
            // (the first month seen only starts the count: no sample on the day the world began)
            if (st.at != null) moved = PriceAnchors._sample(world, st, lives, A);
            st.at = month;
        }
        PriceAnchors.bindAll(world, lives);
        return moved;
    },

    /** One sample: each good's world scarcity into its running mean, its anchor a step toward it. → goods moved */
    _sample(world, st, lives, A) {
        const C = SettlementMarket.config();
        const smooth = _clamp(_num(A.smooth, 0.1), 0, 1);
        const rate = _clamp(_num(A.rate, 0.3), 0, 1);
        const step = Math.max(0, _num(A.maxStep, 0.03));
        const lo = Math.max(0.01, _num(A.min, 0.5)), hi = Math.max(lo, _num(A.max, 2.5));
        let moved = 0;
        for (const id of C.goodIds) {
            let w = 0, sum = 0;
            for (const s of lives) {
                if (!s || !s.market || !s.market.stock || !SettlementMarket.uses(s, id)) continue;
                const need = SettlementMarket.need(s, id);
                if (!(need > 0)) continue;
                const sc = SettlementMarket.scarcity(s, id);
                if (!(sc > 0)) continue;
                w += need;
                sum += need * Math.log(sc);
            }
            if (!(w > 0)) continue;
            const o = sum / w;
            const prev = st.obs[id];
            const obs = Number.isFinite(prev) ? prev + smooth * (o - prev) : o;
            st.obs[id] = _r4(obs);
            const a = PriceAnchors.factor(world, id);
            const toward = Math.exp(rate * (obs - Math.log(a)));
            const next = _r4(_clamp(a * _clamp(toward, 1 - step, 1 + step), lo, hi));
            if (next !== a) moved++;
            if (next === 1) delete st.f[id]; else st.f[id] = next;
        }
        return moved;
    },

    serialize(world) {
        const st = world && world.priceAnchors;
        return st && typeof st === 'object' ? JSON.parse(JSON.stringify(st)) : null;
    },

    /** Restores the anchors (older saves: none — they start from the data prices) and binds the markets. */
    restore(saved, world) {
        if (!world) return;
        world.priceAnchors = saved && typeof saved === 'object' && saved.f && typeof saved.f === 'object'
            ? { at: Number.isFinite(saved.at) ? saved.at : null, f: { ...saved.f }, obs: saved.obs && typeof saved.obs === 'object' ? { ...saved.obs } : {} }
            : null;
        PriceAnchors.bindAll(world);
    },
};

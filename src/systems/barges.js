// ============================================
// BARGES — the river trade, seen on the water
// ============================================
// The towns' markets trade along their links every market turn
// (systems/marketDynamics.js → world/settlementMarket.js flows). A link that
// goes by river (link.river: world/rivers.js tradeByWater) moves its goods by
// barge: after each turn's flows, every river link that moved anything puts
// a barge on the river carrying the turn's biggest lot on that link
// (link.bigI / bigQ / bigAB, set in the flows: what really moved, which way),
// setting off from the exporter and poling down (or hauling up) the river's
// course to the importer at barges.hexesPerDay. The goods themselves moved
// with the flow — the barge is that flow made visible, not a second cargo.
//
// The route is the river between the towns: a breadth-first search over
// boatable river hexes and lakes (world/rivers.js boatable), cached per link.
// State is derived (a WeakMap per world, not saved: a loaded game shows its
// barges again after the next market turn). No randomness.
// Settings: data/ports.json `barges`. Drawn by ui/renderer/waterTraffic.js.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Rivers } from '../world/rivers.js';
import { SettlementMarket } from '../world/settlementMarket.js';

const DEFAULTS = { minQty: 1, maxShown: 40, hexesPerDay: 3, maxSearch: 900 };
const LAKE = 'lake';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const _key = (q, r) => `${q},${r}`;

/** world → { barges: [...], routes: Map } */
const _state = new WeakMap();

export const Barges = {
    config() {
        const g = DataLoader._gamedata;
        return { ...DEFAULTS, ..._obj(g && g.ports && g.ports.barges) };
    },

    _st(world) {
        let s = _state.get(world);
        if (!s || s.tiles !== world.tiles) {
            s = { tiles: world.tiles, barges: [], routes: new Map() };
            _state.set(world, s);
        }
        return s;
    },

    /** Forget a world's barges and routes. */
    reset(world) {
        if (world) _state.delete(world);
    },

    _water(world, q, r) {
        const t = world.getTile(q, r);
        if (!t) return false;
        if (t.terrain && t.terrain.id === LAKE) return true;
        return Rivers.boatable(world, q, r);
    },

    /**
     * The river route from town a to town b: [{ q, r }…] from a to b (the
     * towns' own hexes at the ends), or null when no river runs between them.
     */
    route(world, a, b) {
        if (!world || !a || !b || !Number.isFinite(a.q) || !Number.isFinite(a.r) || !Number.isFinite(b.q) || !Number.isFinite(b.r)) return null;
        const st = this._st(world);
        const k = `${_key(a.q, a.r)}>${_key(b.q, b.r)}`;
        if (st.routes.has(k)) return st.routes.get(k);
        const back = st.routes.get(`${_key(b.q, b.r)}>${_key(a.q, a.r)}`);
        if (back) { const r = back.slice().reverse(); st.routes.set(k, r); return r; }
        const W = world.width > 0 ? world.width : 0;
        const wrap = (q) => (W ? Hex.wrapQ(q, W) : q);
        const goal = _key(wrap(b.q), b.r);
        const prev = new Map();
        const start = _key(wrap(a.q), a.r);
        prev.set(start, null);
        const queue = [[wrap(a.q), a.r]];
        let found = false;
        const cap = Math.max(50, _num(this.config().maxSearch, 900));
        for (let h = 0; h < queue.length && h < cap; h++) {
            const [q, r] = queue[h];
            for (const n of Hex.neighbors(q, r)) {
                const nq = wrap(n.q), nr = n.r;
                if (Number.isFinite(world.height) && (nr < 0 || nr >= world.height)) continue;
                const nk = _key(nq, nr);
                if (prev.has(nk)) continue;
                if (nk === goal) { prev.set(nk, _key(q, r)); found = true; break; }
                if (!this._water(world, nq, nr)) continue;
                prev.set(nk, _key(q, r));
                queue.push([nq, nr]);
            }
            if (found) break;
        }
        let path = null;
        if (found) {
            path = [];
            for (let at = goal; at; at = prev.get(at)) {
                const [q, r] = at.split(',').map(Number);
                path.push({ q, r });
            }
            path.reverse();
            if (path.length < 3) path = null; // (next door: no river voyage to speak of)
        }
        st.routes.set(k, path);
        return path;
    },

    /**
     * After the turn's flows (systems/marketDynamics.js): a barge on each
     * river link that moved goods, carrying the turn's biggest lot, from the
     * exporter to the importer. → barges put on the water
     */
    afterFlows(world, links, day) {
        if (!world || !Array.isArray(links)) return 0;
        const C = this.config();
        const st = this._st(world);
        const d = _num(day);
        const per = Math.max(0.5, _num(C.hexesPerDay, 3));
        // (barges that have come in are gone)
        st.barges = st.barges.filter(b => d < b.start + b.days);
        const ids = SettlementMarket.config().goodIds;
        let n = 0;
        for (const link of links) {
            if (!link || !link.river || link.sea || link.embody === true) continue;
            if (!(link.bigQ >= _num(C.minQty, 1)) || !(link.bigI >= 0)) continue;
            if (st.barges.length >= Math.max(0, _num(C.maxShown, 40))) break;
            const from = link.bigAB ? link.a : link.b, to = link.bigAB ? link.b : link.a;
            const path = this.route(world, from, to);
            if (!path) continue;
            const id = `${_key(from.q, from.r)}>${_key(to.q, to.r)}`;
            if (st.barges.some(b => b.id === id)) continue;
            st.barges.push({
                id, good: ids[link.bigI], qty: Math.round(link.bigQ * 10) / 10,
                from: { q: from.q, r: from.r, name: from.name || 'a town' },
                to: { q: to.q, r: to.r, name: to.name || 'a town' },
                path, start: d, days: Math.max(1, Math.ceil((path.length - 1) / per)),
            });
            n++;
        }
        return n;
    },

    /** The barges on the rivers now. */
    list(world) {
        const st = world ? _state.get(world) : null;
        return st && st.tiles === world.tiles ? st.barges : [];
    },

    /**
     * Where a barge is at `t` (the world's day, fractional): { q, r, nq, nr,
     * f } — the hex it is in, the next one, and how far between (0..1) — or
     * null once it is in.
     */
    positionAt(barge, t) {
        if (!barge || !Array.isArray(barge.path) || barge.path.length < 2) return null;
        const k = (_num(t) - barge.start) / Math.max(0.1, barge.days);
        if (k < 0 || k >= 1) return null;
        const x = k * (barge.path.length - 1);
        const i = Math.floor(x);
        const a = barge.path[i], b = barge.path[Math.min(barge.path.length - 1, i + 1)];
        return { q: a.q, r: a.r, nq: b.q, nr: b.r, f: x - i };
    },
};

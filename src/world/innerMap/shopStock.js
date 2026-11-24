// ============================================
// InnerMap — a shop's real stock on its furniture
// ============================================
// The shelves, counters, barrels, sacks, crates and baskets in a market hall,
// warehouse, granary, bakery, apothecary or smithy show the goods the town's
// market holds (world/settlementMarket.js): a bare shelf in a shortage, full
// boards in plenty, a heap on the barrel's lid by how much is in store.
// data/shopStock.json says which buildings are shops, which goods they keep,
// which furniture holds what and how each good is drawn.
//
//   ShopStock.levelOf(settlement, goodId)    → { stock, target, ratio, level 0..3, fill 0..1 }
//   ShopStock.plan(tiles, w, h, settlement, type)
//                                             → [{ q, r, holder, kind, goods: [{ id, art, level,
//                                                fill }], rows?: [[art ids], …], ids?: [art ids] }]
//   InnerMap._dressShopStock(building, force) lays tile._stock on the room shown, once a day
//                                             for each building and floor (force: after a purchase)
//   InnerMap.shopStockAt(q, r)                the stock on a tile (its piece's head tile), or null
//
// ui/interiorDress.js drawWares draws tile._stock; ui/objectActions offers Buy from the
// Shelf (the market's buy window on just those goods). No randomness: which good a piece
// keeps is by its place in the room, in reading order.

import { InnerMap } from './_ref.js';
import { DataLoader, SettlementMarket } from './_imports.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _bare = (type) => String(type || '').replace(/^player_/, '');

const DEFAULTS = {
    buildings: {},
    holders: {},
    levels: { short: 0.5, plenty: 1.3, full: 1.5, minFill: 0.12 },
    labels: ['bare', 'short', 'in store', 'plenty'],
    goods: {},
};

export const ShopStock = {
    /** The rules (data/shopStock.json) over their defaults. */
    config() {
        const d = (DataLoader._gamedata && DataLoader._gamedata.shopStock) || (DataLoader.get && DataLoader.get('shopStock')) || {};
        return { ...DEFAULTS, ...d, levels: { ...DEFAULTS.levels, ...(d.levels || {}) } };
    },

    /** Is a building of this type a shop that shows its stock? */
    isShop(type, C = ShopStock.config()) {
        // (the player's own shop keeps its own stock, not the town market's)
        if (String(type || '').startsWith('player_')) return false;
        return !!(C.buildings || {})[_bare(type)];
    },

    /** The goods a shop of this type keeps (in the data's order). */
    pool(type, C = ShopStock.config()) {
        const b = (C.buildings || {})[_bare(type)];
        if (!b) return [];
        const all = Object.keys(C.goods || {});
        if (b.goods === '*') return all;
        return _arr(b.goods).filter(id => (C.goods || {})[id]);
    },

    /**
     * How much of a good the market holds: its stock against the stock it aims at.
     * level 0 bare (under a whole unit), 1 short, 2 in store, 3 plenty; fill 0..1 (a shelf's share full).
     */
    levelOf(settlement, goodId, C = ShopStock.config()) {
        const L = C.levels;
        const stock = SettlementMarket.stock(settlement, goodId);
        const target = SettlementMarket.target(settlement, goodId);
        const ratio = target > 0 ? stock / target : (stock >= 1 ? 1 : 0);
        let level;
        if (stock < 1) level = 0;
        else if (ratio < _num(L.short, 0.5)) level = 1;
        else if (ratio < _num(L.plenty, 1.3)) level = 2;
        else level = 3;
        const fill = level === 0 ? 0 : Math.max(_num(L.minFill, 0.12), Math.min(1, ratio / Math.max(0.01, _num(L.full, 1.5))));
        return { stock, target, ratio, level, fill };
    },

    /** Does the town trade this good at all (something its people use, or anything in store)? */
    trades(settlement, goodId) {
        if (!SettlementMarket.tracks(goodId)) return false;
        return SettlementMarket.target(settlement, goodId) > 0 || SettlementMarket.stock(settlement, goodId) >= 1;
    },

    /**
     * The wares on each holder in a room: [{ q, r, holder, kind, goods, rows | ids }]. A piece
     * is read once (its head tile); a broken piece shows nothing (looted, or fallen).
     */
    plan(tiles, w, h, settlement, type, C = ShopStock.config()) {
        if (!settlement || !tiles || !ShopStock.isShop(type, C)) return [];
        SettlementMarket.ensure(settlement);
        const pool = ShopStock.pool(type, C).filter(id => ShopStock.trades(settlement, id));
        const holders = C.holders || {};
        const goods = C.goods || {};
        // Goods for each holder kind: those kept first in it (a fish barrel, a grain sack, a bread
        // shelf) before those it only can hold, each in the pool's order
        const byKind = {};
        const cand = (kind) => {
            if (!byKind[kind]) {
                const can = pool.filter(id => _arr(goods[id] && goods[id].in).includes(kind));
                const first = can.filter(id => goods[id].in[0] === kind);
                byKind[kind] = [...first, ...can.filter(id => goods[id].in[0] !== kind)];
            }
            return byKind[kind];
        };
        const seen = {};
        const out = [];
        for (let r = 0; r < h; r++) {
            for (let q = 0; q < w; q++) {
                const t = tiles[r] && tiles[r][q];
                const f = t && t._furniture;
                if (!f) continue;
                const H = holders[f.type];
                if (!H) continue;
                // (a joined piece: only its head tile)
                if (f.piece && (f.piece.i || f.piece.j)) continue;
                const list = cand(H.kind);
                if (!list.length) continue;
                const n = seen[H.kind] = (seen[H.kind] || 0);
                const per = Math.max(1, Math.min(list.length, _num(H.goods, 1)));
                seen[H.kind] = n + per;
                const mine = [];
                for (let k = 0; k < per; k++) mine.push(list[(n + k) % list.length]);
                const gs = mine.map(id => ({ id, art: goods[id].art, ...ShopStock.levelOf(settlement, id, C) }));
                const entry = { q, r, holder: f.type, kind: H.kind, goods: gs };
                if (f.broken) gs.forEach(g => { g.level = 0; g.fill = 0; });
                if (H.rows) entry.rows = ShopStock.shelfRows(gs, H);
                else entry.ids = ShopStock.topIds(gs, H);
                out.push(entry);
            }
        }
        return out;
    },

    /**
     * A shelf's boards, top to bottom: the art ids on each (its goods take the boards in turn;
     * each fills its share of slots by how full it is, from the bottom board up).
     */
    shelfRows(gs, H) {
        const rows = _arr(H.rows).map(() => []);
        const perRow = Math.max(1, _num(H.perRow, 3));
        const n = gs.length;
        if (!n) return rows;
        // boards from the bottom; board i (counting up) to good i % n
        const order = rows.map((_, i) => rows.length - 1 - i);
        gs.forEach((g, gi) => {
            const mine = order.filter((_, i) => i % n === gi);
            let left = Math.round(g.fill * mine.length * perRow);
            if (g.level > 0) left = Math.max(1, left);
            for (const ri of mine) {
                const k = Math.min(perRow, left);
                for (let s = 0; s < k; s++) rows[ri].push(g.art);
                left -= k;
            }
        });
        return rows;
    },

    /** A counter's or container's wares: each good its count by level. */
    topIds(gs, H) {
        const counts = _arr(H.count).length ? H.count : [0, 1, 2, 3];
        const ids = [];
        for (const g of gs) {
            const k = _num(counts[Math.max(0, Math.min(counts.length - 1, g.level))], 0);
            for (let i = 0; i < k; i++) ids.push(g.art);
        }
        return ids;
    },

    /** A good's name (data playerEconomy GOODS), else its id in words: 'healing salve'. */
    goodName(goodId) {
        const g = DataLoader._gamedata && DataLoader._gamedata.playerEconomy ? (DataLoader._gamedata.playerEconomy.GOODS || {}) : {};
        const e = g[String(goodId).toUpperCase()];
        return (e && e.name) || String(goodId).replace(/_/g, ' ');
    },

    /** A word for a level ('bare', 'short', 'in store', 'plenty'). */
    label(level, C = ShopStock.config()) {
        return _arr(C.labels)[level] || '';
    },
};

Object.assign(InnerMap, {
    /**
     * Lay the shop's stock on the room shown (tile._stock), once a day for each building
     * and floor: the market's stock moves by the day. force: again now (after a purchase).
     */
    _dressShopStock(building = this._insideBuilding, force = false) {
        if (!building || !this.tiles) return null;
        const wt = this._currentWorldTileRef || null;
        const settlement = (wt && wt.settlement) || null;
        const C = ShopStock.config();
        if (!settlement || !ShopStock.isShop(building.type, C)) return null;
        const day = Math.floor(_num(this.worldDay, 0));
        const key = `${building.type}@${building.q},${building.r}|f${this._floor || 0}|${day}`;
        const S = this._shopStock;
        if (!force && S && S.key === key && S.tiles === this.tiles) return S.plan;
        // (yesterday's, or another floor's, taken off first)
        if (S && S.tiles) for (const p of S.plan) { const t = S.tiles[p.r] && S.tiles[p.r][p.q]; if (t) delete t._stock; }
        const plan = ShopStock.plan(this.tiles, this.width, this.height, settlement, building.type, C);
        for (const p of plan) {
            const H = (C.holders || {})[p.holder] || {};
            this.tiles[p.r][p.q]._stock = { kind: p.kind, goods: p.goods, rows: p.rows || null, ids: p.ids || null, bare: H.bare || null, rowBox: H.rows || null, top: H.top || null };
        }
        this._shopStock = { key, tiles: this.tiles, plan };
        return plan;
    },

    /** The shop's stock on a tile (any tile of a joined piece: its head's), or null. */
    shopStockAt(q, r) {
        const t = this.getTile ? this.getTile(q, r) : (this.tiles && this.tiles[r] && this.tiles[r][q]);
        if (!t) return null;
        if (t._stock) return t._stock;
        const f = t._furniture;
        if (f && f.piece && (f.piece.i || f.piece.j)) {
            const h = this.getTile ? this.getTile(q - f.piece.i, r - f.piece.j) : null;
            return (h && h._stock) || null;
        }
        return null;
    },
});

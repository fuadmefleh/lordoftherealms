// ============================================
// InnerMap — the market stalls' trades on the map
// ============================================
// Each stall in the square (tp_stall) and each 2×1 stall in the marketplace
// hall is one trader (world/marketStalls.js): on entering the town its stalls
// are given their trades (kept on the settlement, the same every visit), the
// square's stalls wear their goods on the counter (a colour variant of
// tp_stall, data/townProps.json stallArt) and the prop beside each is one of
// its trade's where one stands the same; the hall's stalls take their trade's
// name. The trade panel (ui/actionMenu/trade.js) asks stallAt / stallOfKeeper
// which stall it is and who keeps it.
//
// No randomness: the trades are the settlement's (MarketStalls.assign), the
// side props chosen by a hash of the stall's place.

import { InnerMap } from './_ref.js';
import { MarketStalls, TownProps } from './_imports.js';

const STALL_ID = 'tp_stall';

function _h(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
}

Object.assign(InnerMap, {
    /** The square's stall anchors on the town map: [{ q, r, key }]. */
    _squareStalls(tiles = this.tiles) {
        const out = [];
        for (const row of tiles || []) {
            for (const t of row || []) {
                if (t && t.customObject && t.customObject.defId === STALL_ID && !t._isInterior) out.push({ q: t.q, r: t.r, key: `o:${t.q},${t.r}` });
            }
        }
        return out;
    },

    /**
     * On entering a town: its square's stalls given their trades (settlement.stallTrades),
     * their goods on the counter and their trade's prop beside them. Returns { key: tradeId }.
     */
    _dressStalls(settlement, world) {
        this._stallSettlement = settlement || null;
        this._stallCtx = null;
        if (!settlement) return {};
        const wt = this.currentWorldTile || {};
        const ctx = this._stallCtx = MarketStalls.context(settlement, world, wt.q, wt.r);
        const stalls = this._squareStalls();
        const map = MarketStalls.assign(settlement, stalls.map(s => s.key), ctx, this._currentWorldTileRef || null);
        for (const s of stalls) {
            const trade = map[s.key];
            const obj = this.tiles[s.r][s.q].customObject;
            obj.stallTrade = trade || null;
            // (its look by what it has in stock today: the greengrocer's fruit after the harvest)
            const art = trade ? MarketStalls.artFor(trade, MarketStalls.wares(settlement, trade, this._currentWorldTileRef || null)) : null;
            obj.stallArt = art;
            const v = art ? TownProps.stallVariant(art) : 0;
            if (v > 0) obj.colorVariantIdx = v;
            else delete obj.colorVariantIdx;
            if (trade) this._stallSideProp(s, trade, art);
        }
        return map;
    },

    /** The prop the planner stood beside a stall, made one of its trade's where one stands the same. */
    _stallSideProp(s, trade, artKey = null) {
        const t = this.tiles[s.r] && this.tiles[s.r][s.q + 3];
        const obj = t && t.customObject;
        if (!obj) return;
        const tags = ['stall', 'wares'];
        const isSide = tags.some(tag => TownProps.idsWithTag(tag).includes(obj.defId));
        if (!isSide) return;
        const orig = obj.stallSideOf || obj.defId;
        const fp = TownProps.footprint(orig);
        const art = TownProps.stallArt(artKey || MarketStalls.artOf(trade));
        const pool = ((art && art.side) || []).filter(id => TownProps.footprint(id) === fp);
        if (!pool.length) {
            if (obj.stallSideOf) obj.defId = obj.stallSideOf;
            return;
        }
        obj.stallSideOf = orig;
        obj.defId = pool[Math.floor(_h('side', s.key, trade) * pool.length) % pool.length];
    },

    /** The hall's stall pieces (2×1 'stall' furniture, by their head tile): [{ q, r, key, tiles }]. */
    _hallStalls(building = this._insideBuilding) {
        if (!building || !this.tiles) return [];
        const heads = new Map();
        for (const row of this.tiles) {
            for (const t of row || []) {
                const f = t && t._furniture;
                if (!f || f.type !== 'stall' || /horse/i.test(f.name || '')) continue;
                const hq = f.piece ? f.piece.q : t.q, hr = f.piece ? f.piece.r : t.r;
                const key = `in:${building.q},${building.r}:${hq},${hr}`;
                if (!heads.has(key)) heads.set(key, { q: hq, r: hr, key, tiles: [] });
                heads.get(key).tiles.push(t);
            }
        }
        return [...heads.values()];
    },

    /** On entering the marketplace hall: its stalls given their trades and their names. */
    _dressHallStalls(building) {
        const settlement = this._stallSettlement;
        const ctx = this._stallCtx;
        if (!settlement || !ctx || !building || String(building.type || '').replace(/^player_/, '') !== 'marketplace') return {};
        const stalls = this._hallStalls(building);
        const map = MarketStalls.assign(settlement, stalls.map(s => s.key), ctx, this._currentWorldTileRef || null);
        for (const s of stalls) {
            const trade = map[s.key];
            const T = MarketStalls.trade(trade);
            if (!T) continue;
            // (its goods on the counter, as in the square: `stall_<art>_2x1` in
            // data/innerMapRenderer.json, the plain stall where a trade has none)
            const art = MarketStalls.artFor(trade, MarketStalls.wares(settlement, trade, this._currentWorldTileRef || null));
            for (const t of s.tiles) {
                t._furniture.stallTrade = trade;
                t._furniture.name = T.stall || T.name;
                t._furniture.art = this.hallStallArt(art);
            }
        }
        return map;
    },

    /** The furniture art a hall stall of this stallArt key wears (its 2×1 piece: `<art>_2x1`). */
    hallStallArt(artKey) {
        return artKey ? `stall_${artKey}` : 'stall';
    },

    /**
     * The stall at a tile (a square stall's any tile, a hall stall's either half):
     * { key, trade, keeper (the npc, or null), name ("Marta's Fish Stall"), indoor } or null.
     */
    stallAt(q, r) {
        const t = this.getTile ? this.getTile(q, r) : (this.tiles[r] && this.tiles[r][q]);
        if (!t || !this._stallSettlement) return null;
        // In the square
        let anchor = null;
        if (t.customObject && t.customObject.defId === STALL_ID) anchor = t;
        else if (t.customObjectPart) {
            const a = this.tiles[t.customObjectPart.anchorR] && this.tiles[t.customObjectPart.anchorR][t.customObjectPart.anchorQ];
            if (a && a.customObject && a.customObject.defId === STALL_ID) anchor = a;
        }
        if (anchor && !anchor._isInterior) {
            const key = `o:${anchor.q},${anchor.r}`;
            const trade = anchor.customObject.stallTrade || (this._stallSettlement.stallTrades || {})[key];
            if (!MarketStalls.trade(trade)) return null;
            const st = this._scn && (this._scn.stalls || []).find(s => s.q === anchor.q && s.r === anchor.r);
            const keeper = st && st.vendorId != null ? (this.npcs || []).find(n => n.id === st.vendorId) || null : null;
            return { key, trade, keeper, name: MarketStalls.stallName(trade, keeper && keeper.name), indoor: false, q: anchor.q, r: anchor.r };
        }
        // In the hall
        const f = t._furniture;
        if (f && f.type === 'stall' && f.stallTrade && this._insideBuilding) {
            const hq = f.piece ? f.piece.q : q, hr = f.piece ? f.piece.r : r;
            const key = `in:${this._insideBuilding.q},${this._insideBuilding.r}:${hq},${hr}`;
            const w = f.piece ? f.piece.w : 1;
            // (its keeper: whoever minds the hall from a tile behind or beside it)
            const keeper = (this.npcs || []).find(n => n._scene && n._scene.role === 'staff' && n._scene.phase !== 'leave'
                && n.q >= hq - 1 && n.q <= hq + w && Math.abs(n.r - hr) <= 1) || null;
            return { key, trade: f.stallTrade, keeper, name: MarketStalls.stallName(f.stallTrade, keeper && keeper.name), indoor: true, q: hq, r: hr };
        }
        return null;
    },

    /** The stall someone keeps (the square's vendor at theirs, the hall's keeper at the stall beside them), or null. */
    stallOfKeeper(npc) {
        if (!npc) return null;
        if (npc._stall && Number.isFinite(npc._stall.q)) {
            const s = this.stallAt(npc._stall.q, npc._stall.r);
            if (s) return { ...s, keeper: npc, name: MarketStalls.stallName(s.trade, npc.name) };
        }
        if (npc._scene && npc._scene.role === 'staff' && this._insideBuilding) {
            for (const [dq, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                const s = this.stallAt(npc.q + dq, npc.r + dr);
                if (s && s.indoor) return { ...s, keeper: npc, name: MarketStalls.stallName(s.trade, npc.name) };
            }
        }
        return null;
    },

    /** The goods a stall's trade has for sale today (for its keeper's cries). */
    stallWares(trade) {
        return this._stallSettlement && trade ? MarketStalls.wares(this._stallSettlement, trade, this._currentWorldTileRef || null) : [];
    },
});

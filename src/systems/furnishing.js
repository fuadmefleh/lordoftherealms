// ============================================
// FURNISHING — buying furniture, keeping it, selling it back
// ============================================
// A furniture maker works in every settlement; what they make depends on the
// size of the place (data/furniture.json → minSettlement). What the player
// buys goes into their furniture store — player.furnitureStore, a list apart
// from the goods inventory, so a bed doesn't take a pack slot — to be set
// down in any home they own (world/innerMap/furnishing.js, the edit mode in
// ui/innerMapFurnish.js). A piece taken up again goes back to the store; from
// there it can be sold back to a furniture maker for part of its price.
//
//   player.furnitureStore = [{ uid, id | null, look?, rot?, storage? }]
//   player.homeFurnishings = { homeKey: { name, town, adopted, pieces: [...] } }
//   player.furnitureSeq   = the last uid number given
//
// No import-time effects; no randomness.

import { FurnitureCatalogue } from '../world/furnitureCatalogue.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const Furnishing = {
    catalogue: FurnitureCatalogue,

    store(player) {
        if (!player) return [];
        if (!Array.isArray(player.furnitureStore)) player.furnitureStore = [];
        return player.furnitureStore;
    },

    nextUid(player) {
        player.furnitureSeq = Math.max(0, _num(player.furnitureSeq)) + 1;
        return `f${player.furnitureSeq}`;
    },

    /** What a furniture maker in this place sells: [{ ...item, affordable }]. */
    shopList(player, settlementType) {
        const gold = _num(player && player.gold);
        return FurnitureCatalogue.forSale(settlementType).map(i => ({ ...i, affordable: gold >= _num(i.price) }));
    },

    /**
     * Buy a piece from the furniture maker of a place of this type.
     * → { success, text, piece? } (the piece goes into the furniture store)
     */
    buy(player, world, itemId, settlementType, qty = 1) {
        const item = FurnitureCatalogue.item(itemId);
        if (!item) return { success: false, text: 'No such piece.' };
        if (FurnitureCatalogue.rank(item.minSettlement || 'village') > FurnitureCatalogue.rank(settlementType)) {
            return { success: false, text: `No one here makes a ${item.name}: try a bigger place.` };
        }
        const n = Math.max(1, Math.floor(_num(qty, 1)));
        const cost = _num(item.price) * n;
        if (_num(player.gold) < cost) return { success: false, text: `A ${item.name} costs ${cost}g. You have ${Math.floor(_num(player.gold))}g.` };
        player.gold = _num(player.gold) - cost;
        Ledger.record(player, 'housing', -cost);
        if (player.financeToday && player.financeToday.expenses) {
            player.financeToday.expenses.housing = _num(player.financeToday.expenses.housing) + cost;
        }
        let piece = null;
        for (let i = 0; i < n; i++) {
            piece = { uid: Furnishing.nextUid(player), id: item.id, rot: 0, bought: _num(world && world.day) };
            if (FurnitureCatalogue.holdsThings(item.type)) piece.storage = {};
            Furnishing.store(player).push(piece);
        }
        const many = n > 1 ? `${n} × ${item.name}` : `a ${item.name}`;
        return { success: true, text: `You buy ${many} for ${cost}g. It waits in your furniture store: set it down in a home of yours (Furnish, inside).`, piece };
    },

    /** Sell a stored piece back to a furniture maker. → { success, text, gold } */
    sell(player, uid) {
        const list = Furnishing.store(player);
        const i = list.findIndex(p => p && p.uid === uid);
        if (i < 0) return { success: false, text: 'You have no such piece in store.' };
        const piece = list[i];
        if (!FurnitureCatalogue.isEmpty(piece)) return { success: false, text: 'Empty it first: there are still things inside.' };
        const gold = FurnitureCatalogue.sellValue(piece);
        list.splice(i, 1);
        player.gold = _num(player.gold) + gold;
        Ledger.record(player, 'housing', gold);
        const v = FurnitureCatalogue.view(piece);
        return { success: true, gold, text: `You sell the ${v.name} for ${gold}g.` };
    },

    /** Put a piece taken up off a floor into the store. Refused while it still holds goods. */
    putAway(player, piece) {
        if (!piece) return { success: false, text: 'Nothing to put away.' };
        if (!FurnitureCatalogue.isEmpty(piece)) return { success: false, text: 'Empty it first: there are still things inside.' };
        delete piece.q; delete piece.r;
        Furnishing.store(player).push(piece);
        return { success: true, text: `The ${FurnitureCatalogue.view(piece).name} goes into your furniture store.` };
    },

    /** Take a piece out of the store (to be set down). → the piece, or null */
    takeFromStore(player, uid) {
        const list = Furnishing.store(player);
        const i = list.findIndex(p => p && p.uid === uid);
        return i < 0 ? null : list.splice(i, 1)[0];
    },

    /** The stored pieces with their looks: [{ piece, view, value }]. */
    storeView(player) {
        return Furnishing.store(player).map(piece => ({ piece, view: FurnitureCatalogue.view(piece), value: FurnitureCatalogue.sellValue(piece) }));
    },

    /** Every home the player has furnished: [{ key, name, town, pieces }]. */
    homesView(player) {
        const h = (player && player.homeFurnishings) || {};
        return Object.entries(h).map(([key, rec]) => ({ key, name: rec.name, town: rec.town, pieces: (rec.pieces || []).length }));
    },

    /** A bed's sleep bonus (from the furniture on the tile): +0.25 → a quarter more. */
    restBonus(furniture) {
        if (!furniture) return 0;
        return Number.isFinite(furniture.restBonus) ? Math.max(0, furniture.restBonus) : 0;
    },
};

// ============================================
// LOSS BOOK — the player's losses, as the places they happen report them
// ============================================
// A leaf module (imports only core) that the loss sites call when something
// of the player's is lost or damaged: cargo washed overboard or seized at
// sea, a hull battered (systems/ships.js, systems/shipVoyages.js), a caravan
// taken on the road (player/playerEconomy/caravans.js), a convoy lost or a
// post robbed (systems/merchantHouses.js), a store-room robbed or works
// seized (systems/merchantPrince.js). Each report is a plain record on
// player.lossBook.queue; the underwriters (systems/underwriting.js) read the
// queue on the daily tick and settle claims on the policies that cover it.
//
// Reporting draws no RNG and changes nothing else, so a loss site behaves
// exactly as before whether or not anything is insured. State:
// player.lossBook (saved with the player; the queue is short-lived).
//
// A record: { day, kind, cause, value, ref, place, q, r }
//   kind  'marine' (cargo or hull at sea), 'caravan' (goods on the road),
//         'stock' (a store-room or post), 'works' (works damaged or seized),
//         'crop' (a farm's harvest short)
//   value the loss in gold at the goods' sale value (or the repair bill)

import { PlayerInventory } from '../core/inventory.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const QUEUE_CAP = 60;
// What lost goods are worth: their sale value (a market pays this share of the base price)
const SALE_SHARE = 0.7;

export const LossBook = {
    /** The player's loss book (created / backfilled). */
    state(player) {
        if (!player) return { queue: [], total: 0 };
        let b = player.lossBook;
        if (!b || typeof b !== 'object' || Array.isArray(b)) b = player.lossBook = { queue: [], total: 0 };
        if (!Array.isArray(b.queue)) b.queue = [];
        b.total = _num(b.total);
        return b;
    },

    /**
     * Report a loss. `rec.value` is the gold it cost; nothing below a copper
     * is kept. `day` comes from the world when given. Returns the record.
     */
    report(player, world, rec) {
        if (!player || !rec) return null;
        const value = Math.round(_num(rec.value) * 100) / 100;
        if (!(value >= 1)) return null;
        const b = LossBook.state(player);
        const day = world && Number.isFinite(world.day) ? world.day : _num(rec.day);
        const r = {
            day, kind: String(rec.kind || 'other'), cause: rec.cause || 'loss', value,
            ref: rec.ref != null ? String(rec.ref) : null, place: rec.place || null,
            q: Number.isFinite(rec.q) ? rec.q : null, r: Number.isFinite(rec.r) ? rec.r : null,
        };
        b.queue.push(r);
        b.total = Math.round((b.total + value) * 100) / 100;
        if (b.queue.length > QUEUE_CAP) b.queue.splice(0, b.queue.length - QUEUE_CAP);
        return r;
    },

    /** The sale value of a bundle of goods { id: qty } (unknown goods at 5g). */
    saleValue(goods) {
        let v = 0;
        for (const [id, qty] of Object.entries(goods || {})) {
            if (!(qty > 0)) continue;
            v += (PlayerInventory.goodValue(id) || 5) * SALE_SHARE * qty;
        }
        return Math.round(v * 100) / 100;
    },

    /** Take every queued record (the underwriters' daily read). */
    drain(player) {
        const b = LossBook.state(player);
        const out = b.queue;
        b.queue = [];
        return out;
    },

    serialize(player) {
        return player && player.lossBook ? JSON.parse(JSON.stringify(player.lossBook)) : null;
    },

    loadState(player) {
        if (!player) return null;
        if (player.lossBook == null) return null;
        return LossBook.state(player);
    },
};

// ============================================
// HOTBAR LAYOUT — which goods sit in the street
// map's quick slots, kept on the player
// ============================================
// `player.hotbar = { slots: [itemId|null × SLOTS], manual }` is saved with the
// player (systems/saveLoad.js EXTRA_PLAYER_FIELDS), so the layout survives a
// save and load. The bar itself (ui/hotbar.js) and the Inventory window
// (ui/ui/inventoryPanel.js) both read and write it through here.
//
// Until the player arranges the bar by hand it lays itself out (`manual` false):
// goods used up leave their slot and new goods fill the empty ones, as the bar
// always did. Once the player assigns, moves or clears a slot (`manual` true)
// the layout is theirs: a slot whose good runs out keeps it (shown empty, and
// filled again when more is got), and nothing is put in a slot they emptied.
//
// Pure: no DOM, no globals, no randomness — tested in __tests__/hotbarLayout.test.js.

export const HOTBAR_SLOTS = 7;

/** Keys of `player.inventory` that are not goods. */
const NOT_GOODS = new Set(['gold']);

function _validIndex(i) {
    return Number.isInteger(i) && i >= 0 && i < HOTBAR_SLOTS;
}

export const HotbarLayout = {
    SLOTS: HOTBAR_SLOTS,

    /**
     * The player's layout, made (or mended) on first touch: a plain array from
     * an older save becomes { slots, manual: true }; a missing one starts empty
     * and automatic. → the layout object (live, on the player)
     */
    ensure(player) {
        if (!player) return { slots: new Array(HOTBAR_SLOTS).fill(null), manual: false };
        let hb = player.hotbar;
        if (Array.isArray(hb)) hb = { slots: hb, manual: true };
        if (!hb || typeof hb !== 'object') hb = { slots: [], manual: false };
        const slots = Array.isArray(hb.slots) ? hb.slots : [];
        const out = [];
        for (let i = 0; i < HOTBAR_SLOTS; i++) {
            const id = slots[i];
            out.push(typeof id === 'string' && id && !NOT_GOODS.has(id) ? id : null);
        }
        hb.slots = out;
        hb.manual = !!hb.manual;
        player.hotbar = hb;
        return hb;
    },

    /** A copy of the slots: [itemId|null × SLOTS]. */
    slots(player) {
        return HotbarLayout.ensure(player).slots.slice();
    },

    /** The good in slot `i` (0-based), or null. */
    itemAt(player, i) {
        return _validIndex(i) ? HotbarLayout.ensure(player).slots[i] : null;
    },

    /** The slot holding `itemId`, or -1. */
    indexOf(player, itemId) {
        return itemId ? HotbarLayout.ensure(player).slots.indexOf(itemId) : -1;
    },

    /** The first empty slot, or -1. */
    firstFree(player) {
        return HotbarLayout.ensure(player).slots.indexOf(null);
    },

    /**
     * Put `itemId` in slot `i`. A good already elsewhere on the bar moves here
     * (whatever was here takes its old place), so a good is never in two slots.
     * → true when the layout changed
     */
    assign(player, i, itemId) {
        if (!_validIndex(i) || !itemId || NOT_GOODS.has(itemId)) return false;
        const hb = HotbarLayout.ensure(player);
        hb.manual = true;
        const from = hb.slots.indexOf(itemId);
        if (from === i) return false;
        if (from >= 0) hb.slots[from] = hb.slots[i];
        hb.slots[i] = itemId;
        return true;
    },

    /** Swap slots `from` and `to` (dragging one slot onto another). → true when changed */
    move(player, from, to) {
        if (!_validIndex(from) || !_validIndex(to) || from === to) return false;
        const hb = HotbarLayout.ensure(player);
        hb.manual = true;
        const a = hb.slots[from];
        hb.slots[from] = hb.slots[to];
        hb.slots[to] = a;
        return true;
    },

    /** Empty slot `i`. → true when it held something */
    clear(player, i) {
        if (!_validIndex(i)) return false;
        const hb = HotbarLayout.ensure(player);
        hb.manual = true;
        const had = hb.slots[i] != null;
        hb.slots[i] = null;
        return had;
    },

    /** Take `itemId` off the bar wherever it is. → true when it was there */
    unassign(player, itemId) {
        const i = HotbarLayout.indexOf(player, itemId);
        return i >= 0 ? HotbarLayout.clear(player, i) : false;
    },

    /** Hand the bar back to laying itself out (and lay it out now). */
    reset(player, inventory) {
        const hb = HotbarLayout.ensure(player);
        hb.slots = new Array(HOTBAR_SLOTS).fill(null);
        hb.manual = false;
        HotbarLayout.reconcile(player, inventory);
        return hb;
    },

    /** The goods held (positive stacks), in the packs' own order. */
    held(inventory) {
        const out = [];
        for (const id in (inventory || {})) {
            if (NOT_GOODS.has(id)) continue;
            if (inventory[id] > 0) out.push(id);
        }
        return out;
    },

    /**
     * Bring an automatic layout up to date with the packs: slots whose good is
     * gone are emptied, and empty slots take the goods not yet on the bar. A
     * hand-arranged layout is left as it is. → true when anything changed
     */
    reconcile(player, inventory) {
        const hb = HotbarLayout.ensure(player);
        if (hb.manual) return false;
        const held = HotbarLayout.held(inventory);
        const has = new Set(held);
        let changed = false;
        for (let i = 0; i < HOTBAR_SLOTS; i++) {
            if (hb.slots[i] && !has.has(hb.slots[i])) { hb.slots[i] = null; changed = true; }
        }
        const on = new Set(hb.slots.filter(Boolean));
        const waiting = held.filter(id => !on.has(id));
        let w = 0;
        for (let i = 0; i < HOTBAR_SLOTS && w < waiting.length; i++) {
            if (!hb.slots[i]) { hb.slots[i] = waiting[w++]; changed = true; }
        }
        return changed;
    },

    /**
     * What each slot shows: [{ index, itemId, qty, ready }] — `ready` when the
     * slot holds a good the packs still have (a hand-kept slot whose good ran
     * out is not ready: drawn empty, its key left to the speed controls).
     */
    view(player, inventory) {
        const inv = inventory || {};
        return HotbarLayout.ensure(player).slots.map((itemId, index) => {
            const qty = itemId ? Math.max(0, Number(inv[itemId]) || 0) : 0;
            return { index, itemId, qty, ready: !!itemId && qty > 0 };
        });
    },
};

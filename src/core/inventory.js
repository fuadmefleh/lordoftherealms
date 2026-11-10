// ============================================
// PLAYER INVENTORY — carrying capacity
// ============================================
// `player.maxInventory` is the number of distinct kinds of goods (stacks) the
// player can carry. Stacks themselves are unbounded — a trader may haul 300
// grain — but every new kind of item needs a free slot. Adding to a stack the
// player already holds always succeeds.
//
// Capacity bonuses:
//   - a mount (player.mount, bought at a stable)  +MOUNT_SLOTS
//   - each owned house (player.houses) gives a home stash  +HOUSE_SLOTS
//   - the Endurance skill's carry perk (data/skillPacks/body.json)  +0..5
//
// All gain paths that hand the player new goods go through addItem(); paths
// where the goods are already owed (quest rewards, returned stock) use
// addOrSell(), which sells what doesn't fit at its base price instead of
// silently overfilling the packs. Lives in core/ so systems can use it too.

import { DataLoader } from './dataLoader.js';

export const BASE_INVENTORY_SLOTS = 20;
export const MOUNT_SLOTS = 5;
export const HOUSE_SLOTS = 3;

/** Keys that live in the inventory object but are not carried goods. */
const NON_ITEM_KEYS = new Set(['gold']);

export const PlayerInventory = {
    /** Base market value of one unit of a good (0 when unknown). */
    goodValue(itemId) {
        const goods = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS) || {};
        const good = goods[String(itemId).toUpperCase()];
        return (good && good.basePrice) || 0;
    },

    /** Total slots the player can fill. */
    getCapacity(player) {
        if (!player) return BASE_INVENTORY_SLOTS;
        const base = Number.isFinite(player.maxInventory) ? player.maxInventory : BASE_INVENTORY_SLOTS;
        const mount = player.mount ? MOUNT_SLOTS : 0;
        const houses = Array.isArray(player.houses) ? player.houses.length * HOUSE_SLOTS : 0;
        return base + mount + houses + PlayerInventory.enduranceSlots(player);
    },

    /**
     * Pack slots from the Endurance skill (perk carry). The level is worked out
     * here from the XP, as systems/practiceSkills.js does (core can't import it).
     */
    enduranceSlots(player) {
        const xp = player && player.practiceSkills && player.practiceSkills.endurance;
        const P = DataLoader._gamedata && DataLoader._gamedata.practiceSkills;
        const lv = P && P.skills && P.skills.endurance && P.skills.endurance.perks && P.skills.endurance.perks.carry && P.skills.endurance.perks.carry.levels;
        if (!(xp > 0) || !Array.isArray(lv)) return 0;
        const base = Number(P.xp && P.xp.base) || 40, growth = Number(P.xp && P.xp.growth) || 1.45;
        const max = Math.max(1, P.maxLevel | 0 || 10);
        let L = 1, t = 0;
        while (L < max) {
            t += Math.round(base * Math.pow(growth, L - 1));
            if (xp < t) break;
            L++;
        }
        return Math.max(0, Math.round(Number(lv[Math.min(lv.length, L) - 1]) || 0));
    },

    /** Number of occupied slots (distinct goods with a positive quantity). */
    getUsedSlots(player) {
        if (!player || !player.inventory) return 0;
        let used = 0;
        for (const [id, qty] of Object.entries(player.inventory)) {
            if (NON_ITEM_KEYS.has(id)) continue;
            if (qty > 0) used++;
        }
        return used;
    },

    /**
     * A cheap fingerprint of what the player carries: "id:qty;" for every good
     * held. Goods reach and leave `player.inventory` by many roads — addItem
     * here, but also direct writes all over the systems (eating, selling,
     * crafting, butchering, a whole new inventory on load) — so anything that
     * shows the packs (the street map's hotbar, ui/hotbar.js sync) compares
     * this each frame and redraws only when it differs: a new good, a stack
     * that grew or shrank, a good gone to nothing, or the packs swapped out.
     */
    stamp(player) {
        const inv = player && player.inventory;
        if (!inv) return '';
        let s = '';
        for (const id in inv) {
            const qty = inv[id];
            if (qty > 0) s += id + ':' + qty + ';';
        }
        return s;
    },

    getFreeSlots(player) {
        return Math.max(0, PlayerInventory.getCapacity(player) - PlayerInventory.getUsedSlots(player));
    },

    /** Can `itemId` be added (existing stack, or a free slot for a new one)? */
    canAdd(player, itemId) {
        if (!player) return false;
        if (NON_ITEM_KEYS.has(itemId)) return true;
        if (player.inventory && (player.inventory[itemId] || 0) > 0) return true;
        return PlayerInventory.getUsedSlots(player) < PlayerInventory.getCapacity(player);
    },

    /** Human-readable reason shown when the bag is full. */
    fullMessage(player) {
        const cap = PlayerInventory.getCapacity(player);
        return `Your packs are full (${PlayerInventory.getUsedSlots(player)}/${cap} kinds of goods). ` +
            'Sell or drop something — a mount or a house gives you more room.';
    },

    /**
     * Add `qty` of `itemId` to the player's inventory if there is room.
     * @param {object} [opts]
     * @param {boolean} [opts.force] add even when full (quest rewards etc.)
     * @returns {{ success: boolean, added: number, reason?: string }}
     */
    addItem(player, itemId, qty = 1, opts = {}) {
        if (!player || !itemId || !(qty > 0)) return { success: false, added: 0, reason: 'Nothing to add' };
        if (!player.inventory) player.inventory = {};
        if (!opts.force && !PlayerInventory.canAdd(player, itemId)) {
            return { success: false, added: 0, reason: PlayerInventory.fullMessage(player) };
        }
        player.inventory[itemId] = (player.inventory[itemId] || 0) + qty;
        return { success: true, added: qty };
    },

    /**
     * Add several items ({ id: qty }). Items that don't fit are returned in
     * `dropped` so callers can tell the player what was left behind.
     */
    addItems(player, items, opts = {}) {
        const added = {};
        const dropped = {};
        for (const [id, qty] of Object.entries(items || {})) {
            if (!(qty > 0)) continue;
            const r = PlayerInventory.addItem(player, id, qty, opts);
            if (r.success) added[id] = qty;
            else dropped[id] = qty;
        }
        return { added, dropped, full: Object.keys(dropped).length > 0 };
    },

    /**
     * Give the player goods they're owed. What fits goes in the packs; any
     * new kind of good that doesn't fit is sold on the spot at base price.
     * @returns {{ added: Object, sold: Object, gold: number }}
     */
    addOrSell(player, items) {
        const res = PlayerInventory.addItems(player, items);
        let gold = 0;
        for (const [id, qty] of Object.entries(res.dropped)) {
            gold += Math.floor(PlayerInventory.goodValue(id) * qty);
        }
        if (gold > 0) player.gold = (player.gold || 0) + gold;
        return { added: res.added, sold: res.dropped, gold };
    },

    /**
     * Old ids of goods that are now one market good (the hunt once gave
     * 'hides', 'feathers' and 'antlers' beside the market's hide, feather
     * and antler). Folds an old save's stacks into the good, once.
     */
    LEGACY_IDS: { hides: 'hide', feathers: 'feather', antlers: 'antler' },

    renameLegacy(player) {
        const inv = player && player.inventory;
        if (!inv) return;
        for (const [old, now] of Object.entries(PlayerInventory.LEGACY_IDS)) {
            if (!(inv[old] > 0)) { if (old in inv) delete inv[old]; continue; }
            inv[now] = (inv[now] || 0) + inv[old];
            delete inv[old];
        }
    },

    /** "3 iron, 2 weapons" */
    describe(items) {
        return Object.entries(items || {}).map(([id, n]) => `${n} ${id.replace(/_/g, ' ')}`).join(', ');
    },
};

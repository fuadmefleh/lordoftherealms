// ============================================
// PLAYER INVENTORY — carrying capacity
// ============================================
// Two limits. `player.maxInventory` is the number of distinct kinds of goods
// (stacks) the player can carry: every new kind needs a free slot. And every
// good weighs something (data/packLoad.json): the player carries so much on
// their back, more with a horse's packs, a handcart or a horse cart
// (getMaxLoad). Past that they are overburdened and travel slower
// (loadSpeed, read by Infrastructure.getPlayerHexDays); past hardShare x
// that they can pick up nothing more (canAdd / addItem / loadRoomFor). So a
// trader hauling 300 grain wants a cart, not a pair of shoulders.
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

    /** Is there a slot for `itemId` (an existing stack, or a free slot for a new kind)? */
    hasSlotFor(player, itemId) {
        if (!player) return false;
        if (NON_ITEM_KEYS.has(itemId)) return true;
        if (player.inventory && (player.inventory[itemId] || 0) > 0) return true;
        return PlayerInventory.getUsedSlots(player) < PlayerInventory.getCapacity(player);
    },

    /**
     * Can `qty` of `itemId` be added: a slot for it, and its weight within
     * what the player can carry (loadRoomFor)?
     */
    canAdd(player, itemId, qty = 1) {
        if (!PlayerInventory.hasSlotFor(player, itemId)) return false;
        if (NON_ITEM_KEYS.has(itemId)) return true;
        return PlayerInventory.loadRoomFor(player, itemId) >= Math.max(0, Number(qty) || 0);
    },

    /**
     * Human-readable reason shown when the goods won't go in: out of slots,
     * or (the usual case) too heavy to carry.
     */
    fullMessage(player) {
        const cap = PlayerInventory.getCapacity(player);
        if (PlayerInventory.getUsedSlots(player) >= cap) {
            return `Your packs are full (${PlayerInventory.getUsedSlots(player)}/${cap} kinds of goods). ` +
                'Sell or drop something — a mount or a house gives you more room.';
        }
        return PlayerInventory.heavyMessage(player);
    },

    /** "Too heavy to carry (load 84/90 lb) ..." with what would carry more. */
    heavyMessage(player) {
        const C = PlayerInventory.loadConfig();
        const u = C.unit || 'lb';
        const load = Math.round(PlayerInventory.getLoad(player));
        const max = Math.round(PlayerInventory.getMaxLoad(player));
        const have = new Set(PlayerInventory.carriers(player).map(c => c.id));
        const tips = [];
        if (!have.has('mount')) tips.push('a horse');
        if (!have.has('handcart')) tips.push('a handcart');
        if (!have.has('horse_cart')) tips.push(have.has('mount') ? 'a horse cart' : 'a horse cart (and a horse to draw it)');
        return `That is more than you can carry (load ${load}/${max} ${u}, overburdened past ${max}).` +
            (tips.length ? ` ${tips.join(', ').replace(/, ([^,]*)$/, ' or $1')} would carry more.` : ' Sell, store or drop something.');
    },

    // ── Weight ─────────────────────────────────────────────────────────

    /** data/packLoad.json, or null when the weight rules are off. */
    loadConfig() {
        const C = DataLoader._gamedata && DataLoader._gamedata.packLoad;
        return C && C.enabled !== false ? C : null;
    },

    /** Weight of one unit of a good (lb; 0 when the rules are off). */
    itemWeight(itemId) {
        const C = PlayerInventory.loadConfig();
        if (!C || NON_ITEM_KEYS.has(itemId)) return 0;
        const id = String(itemId);
        if (C.weights && Number.isFinite(C.weights[id])) return Math.max(0, C.weights[id]);
        const cat = PlayerInventory._categoryOf(id);
        if (cat && C.categoryWeights && Number.isFinite(C.categoryWeights[cat])) return Math.max(0, C.categoryWeights[cat]);
        return Number.isFinite(C.defaultWeight) ? Math.max(0, C.defaultWeight) : 1;
    },

    /** The Inventory window's category of a good (data/inventory.json), for its fallback weight. */
    _categoryOf(id) {
        const gd = DataLoader._gamedata;
        if (!gd) return null;
        if (!PlayerInventory._catMap || PlayerInventory._catSrc !== gd.inventory) {
            const m = {};
            const cats = gd.inventory && Array.isArray(gd.inventory.categories) ? gd.inventory.categories : [];
            for (const c of cats) for (const i of c.items || []) m[i] = c.id;
            PlayerInventory._catMap = m;
            PlayerInventory._catSrc = gd.inventory;
        }
        if (PlayerInventory._catMap[id]) return PlayerInventory._catMap[id];
        if (id.endsWith('_seed')) return 'seeds';
        const goods = gd.playerEconomy && gd.playerEconomy.GOODS;
        const g = goods && goods[id.toUpperCase()];
        if (g && g.treasure) return 'valuables';
        return null;
    },

    /**
     * Everything carried, by weight. A piece of arms or armour worn
     * (player.equipment[slot].id) counts wornShare of its weight.
     */
    getLoad(player) {
        const C = PlayerInventory.loadConfig();
        const inv = player && player.inventory;
        if (!C || !inv) return 0;
        let load = 0;
        for (const id in inv) {
            const qty = inv[id];
            if (!(qty > 0) || NON_ITEM_KEYS.has(id)) continue;
            load += qty * PlayerInventory.itemWeight(id);
        }
        const eq = player.equipment;
        if (eq && typeof eq === 'object') {
            const off = 1 - Math.max(0, Math.min(1, Number.isFinite(C.wornShare) ? C.wornShare : 0.4));
            const seen = {};
            for (const s in eq) {
                const id = eq[s] && eq[s].id;
                if (!id || !(inv[id] > 0)) continue;
                seen[id] = (seen[id] || 0) + 1;
                if (seen[id] > inv[id]) continue;
                load -= PlayerInventory.itemWeight(id) * off;
            }
        }
        return Math.max(0, load);
    },

    /** What the player carries on their own back: back + strength + Endurance's carry perk. */
    getBackLoad(player) {
        const C = PlayerInventory.loadConfig();
        if (!C) return Infinity;
        const back = Number.isFinite(C.back) ? C.back : 60;
        const str = player && Number.isFinite(player.strength) ? player.strength : 5;
        const strBonus = Math.max(0, str - 5) * (Number.isFinite(C.perStrength) ? C.perStrength : 5);
        const perk = PlayerInventory.enduranceSlots(player) * (Number.isFinite(C.perkLoad) ? C.perkLoad : 10);
        return back + strBonus + perk;
    },

    /**
     * What carries for the player: their horse's packs (player.mount), their
     * own handcart, their own horse cart (only with a horse to draw it).
     * → [{ id, name, icon, load }]
     */
    carriers(player) {
        const C = PlayerInventory.loadConfig();
        if (!C || !player) return [];
        const out = [];
        const inv = player.inventory || {};
        for (const [id, c] of Object.entries(C.carriers || {})) {
            if (!c || !(c.load > 0)) continue;
            if (id === 'mount') { if (!player.mount) continue; }
            else if (c.good && !(inv[c.good] > 0)) continue;
            if (c.needsHorse && !player.mount) continue;
            out.push({ id, name: c.name || id, icon: c.icon || '', load: c.load });
        }
        return out;
    },

    /** Most the player can carry at their full pace (back + carriers). Infinity when the rules are off. */
    getMaxLoad(player) {
        if (!PlayerInventory.loadConfig()) return Infinity;
        return PlayerInventory.getBackLoad(player) + PlayerInventory.carriers(player).reduce((s, c) => s + c.load, 0);
    },

    /** The most they can be laden with at all (hardShare x getMaxLoad): nothing more is picked up past it. */
    getHardLoad(player) {
        const C = PlayerInventory.loadConfig();
        if (!C) return Infinity;
        const h = Number.isFinite(C.hardShare) ? Math.max(1, C.hardShare) : 1.5;
        return PlayerInventory.getMaxLoad(player) * h;
    },

    /**
     * How many more units of `itemId` can be taken up before the hard limit
     * (Infinity for weightless goods). `ceiling`: a higher limit allowed this
     * once (crafting may leave you no heavier than before it began).
     */
    loadRoomFor(player, itemId, ceiling = 0) {
        const w = PlayerInventory.itemWeight(itemId);
        if (!(w > 0)) return Infinity;
        const room = Math.max(PlayerInventory.getHardLoad(player), Number(ceiling) || 0) - PlayerInventory.getLoad(player);
        return Math.max(0, Math.floor(room / w + 1e-9));
    },

    /** Is the player carrying more than their full pace allows? */
    isOverburdened(player) {
        return PlayerInventory.getLoad(player) > PlayerInventory.getMaxLoad(player) + 1e-9;
    },

    /**
     * Travel pace from the load: 1 up to getMaxLoad, falling to overSpeed at
     * the hard limit; past even that (goods that came by other roads),
     * crawlSpeed.
     */
    loadSpeed(player) {
        const C = PlayerInventory.loadConfig();
        if (!C || !player) return 1;
        const load = PlayerInventory.getLoad(player);
        const max = PlayerInventory.getMaxLoad(player);
        if (!(load > max)) return 1;
        const hard = PlayerInventory.getHardLoad(player);
        const over = Number.isFinite(C.overSpeed) ? C.overSpeed : 0.5;
        const crawl = Number.isFinite(C.crawlSpeed) ? C.crawlSpeed : 0.25;
        if (load > hard + 1e-9) return crawl;
        const t = hard > max ? (load - max) / (hard - max) : 1;
        return 1 - (1 - over) * t;
    },

    /**
     * loadSpeed, remembered on the player while the packs, horse and
     * strength stay as they are (the travel planner asks it for every hex
     * it weighs).
     */
    loadSpeedCached(player) {
        if (!player || !player.inventory || !PlayerInventory.loadConfig()) return 1;
        // A cheap numeric fingerprint of the packs (a string stamp costs too much here)
        const inv = player.inventory;
        let key = (player.mount ? 7 : 3) + (player.strength || 0) * 131;
        for (const id in inv) {
            const q = inv[id];
            if (q > 0) key += q * (id.length * 977 + id.charCodeAt(0) * 31 + id.charCodeAt(id.length - 1)) + 0.5;
        }
        const m = player._loadSpeedMemo;
        if (m && m.key === key && m.inv === inv && m.gd === DataLoader._gamedata) return m.speed;
        const speed = PlayerInventory.loadSpeed(player);
        Object.defineProperty(player, '_loadSpeedMemo', { value: { key, inv, speed, gd: DataLoader._gamedata }, writable: true, configurable: true, enumerable: false });
        return speed;
    },

    /**
     * The load at a glance: { load, max, hard, back, unit, share, speed,
     * over, carriers } (share of max, for a bar).
     */
    loadSummary(player) {
        const C = PlayerInventory.loadConfig();
        const load = PlayerInventory.getLoad(player);
        const max = PlayerInventory.getMaxLoad(player);
        return {
            load, max, hard: PlayerInventory.getHardLoad(player), back: PlayerInventory.getBackLoad(player),
            unit: (C && C.unit) || 'lb', share: max > 0 && Number.isFinite(max) ? load / max : 0,
            speed: PlayerInventory.loadSpeed(player), over: load > max + 1e-9,
            carriers: PlayerInventory.carriers(player),
        };
    },

    /**
     * Add `qty` of `itemId` to the player's inventory if there is room
     * (a slot, and the weight within what they can carry).
     * @param {object} [opts]
     * @param {boolean} [opts.force] add even when full (quest rewards etc.)
     * @param {boolean} [opts.partial] add as many as the weight allows when not all fit
     * @param {number} [opts.ceiling] a load allowed past the hard limit this once (loadRoomFor)
     * @returns {{ success: boolean, added: number, reason?: string }}
     */
    addItem(player, itemId, qty = 1, opts = {}) {
        if (!player || !itemId || !(qty > 0)) return { success: false, added: 0, reason: 'Nothing to add' };
        if (!player.inventory) player.inventory = {};
        if (!opts.force) {
            if (!PlayerInventory.hasSlotFor(player, itemId)) {
                return { success: false, added: 0, reason: PlayerInventory.fullMessage(player) };
            }
            const room = NON_ITEM_KEYS.has(itemId) ? Infinity : PlayerInventory.loadRoomFor(player, itemId, opts.ceiling);
            if (room < qty) {
                if (!opts.partial || !(room > 0)) return { success: false, added: 0, reason: PlayerInventory.heavyMessage(player), heavy: true };
                qty = room;
            }
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
     * `payer` (optional): fn(gold) → the coin the buyer could pay (the nearest
     * town's purse, capped by what it holds — callers in world/ and above pass
     * one, as core/ cannot reach the towns); the player gets only that. Without
     * a payer the caller settles the coin itself (quests, sagas).
     * @returns {{ added: Object, sold: Object, gold: number }}
     */
    addOrSell(player, items, payer = null) {
        // In a world still bartering (world/barter.js puts `player._inKind` on) there's
        // nobody to sell to for coin: what's owed goes in the packs regardless
        if (player && player._inKind) return { added: PlayerInventory.addItems(player, items, { force: true }).added, sold: {}, gold: 0 };
        // (as much of each as can be carried goes in the packs; only the rest is sold)
        const res = { added: {}, dropped: {} };
        for (const [id, qty] of Object.entries(items || {})) {
            if (!(qty > 0)) continue;
            const r = PlayerInventory.addItem(player, id, qty, { partial: true });
            const got = r.success ? r.added : 0;
            if (got > 0) res.added[id] = got;
            if (qty - got > 0) res.dropped[id] = qty - got;
        }
        let gold = 0;
        for (const [id, qty] of Object.entries(res.dropped)) {
            gold += Math.floor(PlayerInventory.goodValue(id) * qty);
        }
        if (gold > 0 && typeof payer === 'function') gold = Math.max(0, Math.min(gold, Number(payer(gold)) || 0));
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

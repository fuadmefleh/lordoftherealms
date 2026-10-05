// ============================================
// FORAGING & HUNTING — living off the land
// ============================================
// The rolls behind the Forage and Hunt actions, for both the quick path and
// the minigames (src/ui/actionMenu/jobs.js only presents them). Everything
// found is paid in goods through PlayerInventory (packs permitting), never in
// coin: herbs, berries, mushrooms, meat, pelts. Wild foods are edible
// (Player.FOOD_TYPES), so a broke traveller can live off the land.
//
// What shapes a haul:
//   - Intelligence widens a forager's search (more finds, a bigger bundle);
//     combat skill and strength steady a hunter's aim.
//   - Luck favours the rare finds (truffles, pearls, a bear pelt) and now and
//     then adds one more to the bundle.
//   - Experience: every outing counts (player.foragingTrips /
//     player.huntingTrips). The trips make a craft rank — Novice to Master —
//     that raises the odds of a find and the size of each bundle.
// Each loot entry's qty { min, max } range is honoured on every path.
// All randomness flows through Utils (seedable).

import { Utils } from '../core/utils.js';
import { PlayerInventory } from './inventory.js';

/** Rare finds (chance at or below this) are the ones luck favours. */
const RARE_CHANCE = 0.1;

/** Craft ranks by trips made. Effects grow with the rank's index. */
export const FORAGE_RANKS = [
    { min: 0, name: 'Novice', icon: '🌱' },
    { min: 5, name: 'Gatherer', icon: '🌿' },
    { min: 15, name: 'Woodwise', icon: '🍄' },
    { min: 35, name: 'Herb-wise', icon: '🌺' },
    { min: 60, name: 'Master Forager', icon: '🏵️' },
];

export const HUNT_RANKS = [
    { min: 0, name: 'Novice', icon: '🌱' },
    { min: 5, name: 'Tracker', icon: '🐾' },
    { min: 15, name: 'Huntsman', icon: '🏹' },
    { min: 35, name: 'Stalker', icon: '🦌' },
    { min: 60, name: 'Master of the Hunt', icon: '🐗' },
];

function _num(v, d = 0) {
    return typeof v === 'number' && isFinite(v) ? v : d;
}

function _rank(trips, ranks) {
    let level = 0;
    for (let i = 0; i < ranks.length; i++) if (trips >= ranks[i].min) level = i;
    const next = ranks[level + 1] || null;
    return { level, ...ranks[level], trips, next: next ? { name: next.name, at: next.min } : null };
}

/** Luck's pull on rare finds: ×(1 + (luck − 5) × 0.08), never below ×0.6. */
function _luckRare(player) {
    return Math.max(0.6, 1 + (_num(player && player.luck, 5) - 5) * 0.08);
}

/**
 * One weighted roll over a loot table. `mult` scales every entry; luck scales
 * rare entries again. Returns an entry or null (nothing found).
 */
function _rollEntry(table, player, mult) {
    const luck = _luckRare(player);
    const roll = Utils.random();
    let cum = 0;
    for (const e of table) {
        const c = _num(e.chance) * mult * (_num(e.chance) <= RARE_CHANCE ? luck : 1);
        cum += c;
        if (roll < cum) return e;
    }
    return null;
}

/** qty in the entry's range, plus a chance of one more per bonus. */
function _rollQty(entry, bonusChance) {
    const q = entry && entry.qty;
    const min = Math.max(1, Math.floor(_num(q && q.min, 1)));
    const max = Math.max(min, Math.floor(_num(q && q.max, min)));
    let qty = Utils.randInt(min, max);
    if (bonusChance > 0 && Utils.random() < Math.min(0.9, bonusChance)) qty++;
    return qty;
}

/**
 * Put a haul in the packs. found: [{ entry, qty }]. Returns
 * { kept: [{entry, qty}], lost: [{entry, qty, reason}], value } — value is
 * what the kept goods would fetch (entry.sellPrice), for the summary.
 */
function _bank(player, found) {
    const kept = [];
    const lost = [];
    let value = 0;
    for (const f of found || []) {
        if (!f || !f.entry || !(f.qty > 0)) continue;
        const res = PlayerInventory.addItem(player, f.entry.item, f.qty);
        if (res.success) {
            kept.push(f);
            value += f.qty * _num(f.entry.sellPrice || f.entry.sell, 0);
        } else {
            lost.push({ ...f, reason: res.reason });
        }
    }
    return { kept, lost, value };
}

export const Foraging = {
    RARE_CHANCE,

    /** The loot table for this tile's terrain, or null when nothing grows here. */
    lootTableFor(tile, forageData) {
        if (!tile || !tile.terrain || !forageData) return null;
        const category = (forageData.terrain_mapping || {})[tile.terrain.id];
        const table = category && forageData.loot_table && forageData.loot_table[category];
        return table && table.length ? table : null;
    },

    /** The forager's craft rank from trips made: { level, name, icon, trips, next }. */
    skill(player) {
        return _rank(_num(player && player.foragingTrips), FORAGE_RANKS);
    },

    /** Find-chance multiplier: intelligence widens the search, experience sharpens the eye. */
    findMultiplier(player) {
        const int = _num(player && player.intelligence, 5);
        return (1 + int * 0.05) * 0.6 * (1 + Foraging.skill(player).level * 0.08);
    },

    /** Chance of one more in each bundle: experience, luck and wits. */
    qtyBonusChance(player) {
        const lvl = Foraging.skill(player).level;
        return Math.max(0, lvl * 0.1 + (_num(player && player.luck, 5) - 5) * 0.04
            + (_num(player && player.intelligence, 5) - 5) * 0.03);
    },

    /** Patches a minigame forager may search: 4 + int/3, +1 at Woodwise and Master. */
    searches(player) {
        return 4 + Math.floor(_num(player && player.intelligence, 5) / 3) + Math.floor(Foraging.skill(player).level / 2);
    },

    /** One patch searched: an entry or null. */
    rollFind(table, player) {
        if (!Array.isArray(table) || !table.length) return null;
        return _rollEntry(table, player, Foraging.findMultiplier(player));
    },

    /** How many of an entry a find yields (its qty range plus bonuses). */
    rollQty(entry, player) {
        return _rollQty(entry, Foraging.qtyBonusChance(player));
    },

    /** The minigame's field: size×size cells, each { entry|null, nearbyCount }. */
    makeGrid(table, player, size = 4) {
        const grid = [];
        for (let y = 0; y < size; y++) {
            const row = [];
            for (let x = 0; x < size; x++) row.push({ entry: Foraging.rollFind(table, player), searched: false, nearbyCount: 0 });
            grid.push(row);
        }
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let n = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const ny = y + dy, nx = x + dx;
                        if (ny >= 0 && ny < size && nx >= 0 && nx < size && grid[ny][nx].entry) n++;
                    }
                }
                grid[y][x].nearbyCount = n;
            }
        }
        return grid;
    },

    /**
     * End of a foraging outing: put the finds in the packs, count the trip
     * (the craft rank grows with them) and note a good day's renown.
     * Returns { kept, lost, value, renown, rankUp } — rankUp is the new rank or null.
     */
    finishTrip(player, found) {
        const before = Foraging.skill(player).level;
        const res = _bank(player, found);
        player.foragingTrips = _num(player.foragingTrips) + 1;
        const renown = res.kept.length > 2 ? 1 : 0;
        if (renown) player.renown = _num(player.renown) + renown;
        const after = Foraging.skill(player);
        return { ...res, renown, rankUp: after.level > before ? after : null };
    },

    /**
     * Search the tile for one useful thing (the quick path). Intelligence
     * widens the search; the find comes in its qty range. Returns
     * { success, entry, qty, added, reason, rankUp } — success:false only
     * when the terrain has nothing; `added` is false when the packs were full.
     */
    quickForage(player, tile, forageData) {
        const table = Foraging.lootTableFor(tile, forageData);
        if (!table) return { success: false, reason: 'This terrain has nothing worth gathering.' };
        let entry = null;
        for (let attempt = 0; attempt < 5 && !entry; attempt++) entry = Foraging.rollFind(table, player);
        if (!entry) entry = table[0];
        const qty = Foraging.rollQty(entry, player);
        const trip = Foraging.finishTrip(player, [{ entry, qty }]);
        const lost = trip.lost[0];
        return { success: true, entry, qty, added: !lost, reason: lost ? lost.reason : undefined, rankUp: trip.rankUp };
    },
};

export const Hunting = {
    /** The hunter's craft rank from trips made: { level, name, icon, trips, next }. */
    skill(player) {
        return _rank(_num(player && player.huntingTrips), HUNT_RANKS);
    },

    /** Loot-chance multiplier on a clean hit: combat, strength and experience. */
    lootMultiplier(player) {
        const combat = _num(player && player.skills && player.skills.combat, 1) || 1;
        const str = _num(player && player.strength, 5);
        return (1 + combat * 0.08) * (1 + str * 0.03) * 1.3 * (1 + Hunting.skill(player).level * 0.08);
    },

    /** How much accuracy a shot needs to land (lower is easier). */
    hitThreshold(player) {
        const combat = _num(player && player.skills && player.skills.combat, 1) || 1;
        const str = _num(player && player.strength, 5);
        return 35 - combat * 2 - str - Hunting.skill(player).level * 2;
    },

    qtyBonusChance(player) {
        return Math.max(0, Hunting.skill(player).level * 0.1 + (_num(player && player.luck, 5) - 5) * 0.04);
    },

    rollQty(entry, player) {
        return _rollQty(entry, Hunting.qtyBonusChance(player));
    },

    /** The quarry the hunt follows: a weighted pick (luck favours the rare beasts). */
    pickPrey(table, player) {
        const pool = (table || []).filter(e => _num(e.chance) > 0);
        if (!pool.length) return null;
        const luck = _luckRare(player);
        const weights = pool.map(e => _num(e.chance) * (_num(e.chance) <= RARE_CHANCE ? luck : 1));
        const total = weights.reduce((s, w) => s + w, 0);
        let roll = Utils.random() * total;
        for (let i = 0; i < pool.length; i++) {
            roll -= weights[i];
            if (roll < 0) return pool[i];
        }
        return pool[pool.length - 1];
    },

    /** A clean kill: each entry may drop (in its qty range); at least the first. */
    strikeLoot(table, player) {
        const mult = Hunting.lootMultiplier(player);
        const luck = _luckRare(player);
        const found = [];
        for (const e of table || []) {
            const c = _num(e.chance) * mult * (_num(e.chance) <= RARE_CHANCE ? luck : 1);
            if (Utils.random() < c) found.push({ entry: e, qty: Hunting.rollQty(e, player) });
        }
        if (!found.length && table && table[0]) found.push({ entry: table[0], qty: Hunting.rollQty(table[0], player) });
        return found;
    },

    /** End of a hunt: bank the kill (if any) and count the trip. Same shape as Foraging.finishTrip. */
    finishTrip(player, found) {
        const before = Hunting.skill(player).level;
        const res = _bank(player, found || []);
        player.huntingTrips = _num(player.huntingTrips) + 1;
        const after = Hunting.skill(player);
        return { ...res, renown: 0, rankUp: after.level > before ? after : null };
    },

    /** The quick hunt: one quarry, in its qty range. Same shape as Foraging.quickForage. */
    quickHunt(player, table) {
        if (!Array.isArray(table) || !table.length) return { success: false, reason: 'There is nothing to hunt in this terrain.' };
        const entry = Hunting.pickPrey(table, player) || table[0];
        const qty = Hunting.rollQty(entry, player);
        const trip = Hunting.finishTrip(player, [{ entry, qty }]);
        const lost = trip.lost[0];
        return { success: true, entry, qty, added: !lost, reason: lost ? lost.reason : undefined, rankUp: trip.rankUp };
    },
};

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
//   - Practice: Foraging and Hunting & Butchering are practised skills in
//     levels (systems/practiceSkills.js; data/skillPacks/wild.json). Each
//     outing is XP (a find, a rare find, a part of a carcass, a butchering);
//     each level's perks widen the search, fatten the bundle, favour the rare
//     finds, steady the aim, bring the hides and the extra cuts. The old craft
//     rank (Novice … Master, 0..4) now follows the level (two levels a rank)
//     for whatever reads it; an old save's trips (player.foragingTrips /
//     player.huntingTrips, still counted) become XP once.
// Each loot entry's qty { min, max } range is honoured on every path.
// All randomness flows through Utils (seedable).

import { Utils } from '../core/utils.js';
import { PlayerInventory } from './inventory.js';
import { PracticeSkills } from '../systems/practiceSkills.js';

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

/** Practice levels to each old craft rank (level 1-2 the first, 9-10 the last). */
const LEVELS_PER_RANK = 2;

/**
 * The practised skill's level. An old save's trips become XP once (the
 * skill's xp.migrateTrips each), marked on the store so it isn't done twice;
 * nothing is written for a holder with no trips.
 */
function _practice(player, id, tripsField) {
    if (!player) return 1;
    const flag = `_${tripsField}`;
    const trips = _num(player[tripsField]);
    const s = player.practiceSkills;
    if (trips > 0 && !(s && s[flag]) && PracticeSkills.def(id)) {
        const store = s || (player.practiceSkills = {});
        const rate = _num((PracticeSkills.def(id).xp || {}).migrateTrips, 0);
        const cap = PracticeSkills.xpForLevel(PracticeSkills.maxLevel());
        if (rate > 0) store[id] = Math.min(cap, Math.max(_num(store[id]), trips * rate));
        store[flag] = 1;
    }
    return PracticeSkills.level(player, id);
}

/** Mark an old save's trips as counted (before a new trip is), so they aren't taken for old ones later. */
function _markMigrated(player, id, tripsField) {
    _practice(player, id, tripsField);
    if (!PracticeSkills.def(id)) return;
    const store = player.practiceSkills || (player.practiceSkills = {});
    store[`_${tripsField}`] = 1;
}

/** The old craft rank (0..4), from the practised level: { level, name, icon, trips, practice, levelName, next } */
function _rank(player, id, tripsField, ranks) {
    const L = _practice(player, id, tripsField);
    const level = Math.max(0, Math.min(ranks.length - 1, Math.floor((L - 1) / LEVELS_PER_RANK)));
    const next = ranks[level + 1] || null;
    return {
        level, ...ranks[level], trips: _num(player && player[tripsField]), practice: L,
        levelName: PracticeSkills.levelName(L),
        next: next ? { name: next.name, level: (level + 1) * LEVELS_PER_RANK + 1 } : null,
    };
}

/** A perk of the player's practised skill */
function _perk(player, id, perkId, tripsField) {
    _practice(player, id, tripsField);
    return PracticeSkills.perk(player, id, perkId);
}

/**
 * The XP an outing earned, as a level-up shaped for the old rankUp readers:
 * { ...event, name: 'Foraging 3 (Apprentice)' } or null.
 */
function _learn(player, id, xp) {
    const up = PracticeSkills.gain(player, id, xp);
    return up ? { ...up, skillName: up.name, name: `${up.name} ${up.to} (${up.levelName})` } : null;
}

/** Luck's pull on rare finds: ×(1 + (luck − 5) × 0.08), never below ×0.6. */
function _luckRare(player) {
    return Math.max(0.6, 1 + (_num(player && player.luck, 5) - 5) * 0.08);
}

/**
 * One weighted roll over a loot table. `mult` scales every entry; luck scales
 * rare entries again. Returns an entry or null (nothing found).
 */
function _rollEntry(table, player, mult, rareMult = 1) {
    const luck = _luckRare(player) * rareMult;
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

    /** The forager's craft rank (0..4) from the Foraging level: { level, name, icon, trips, practice, levelName, next }. */
    skill(player) {
        return _rank(player, 'foraging', 'foragingTrips', FORAGE_RANKS);
    },

    /** A Foraging perk's value for the player (data/skillPacks/wild.json) */
    perk(player, perkId) {
        return _perk(player, 'foraging', perkId, 'foragingTrips');
    },

    /** Find-chance multiplier: intelligence widens the search, Foraging (finds) sharpens the eye. */
    findMultiplier(player) {
        const int = _num(player && player.intelligence, 5);
        return (1 + int * 0.05) * 0.6 * (1 + Foraging.perk(player, 'finds') / 100);
    },

    /** Chance of one more in each bundle: Foraging (bundle), luck and wits. */
    qtyBonusChance(player) {
        return Math.max(0, Foraging.perk(player, 'bundle') / 100 + (_num(player && player.luck, 5) - 5) * 0.04
            + (_num(player && player.intelligence, 5) - 5) * 0.03);
    },

    /** Patches a minigame forager may search: 4 + int/3, + Foraging's searches. */
    searches(player) {
        return 4 + Math.floor(_num(player && player.intelligence, 5) / 3) + Math.floor(Foraging.perk(player, 'searches'));
    },

    /** One patch searched: an entry or null. */
    rollFind(table, player) {
        if (!Array.isArray(table) || !table.length) return null;
        return _rollEntry(table, player, Foraging.findMultiplier(player), 1 + Foraging.perk(player, 'rare') / 100);
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
     * End of a foraging outing: put the finds in the packs, count the trip,
     * the Foraging XP (a trip, each find, more for a rare one) and note a good
     * day's renown. Returns { kept, lost, value, renown, xp, rankUp } —
     * rankUp is a Foraging level-up ({ icon, name: 'Foraging 3 (Apprentice)', text, … }) or null.
     */
    finishTrip(player, found) {
        _markMigrated(player, 'foraging', 'foragingTrips');
        const res = _bank(player, found);
        player.foragingTrips = _num(player.foragingTrips) + 1;
        const renown = res.kept.length > 2 ? 1 : 0;
        if (renown) player.renown = _num(player.renown) + renown;
        const X = (PracticeSkills.def('foraging') || {}).xp || {};
        let xp = _num(X.perTrip, 3);
        for (const f of found || []) {
            if (!f || !f.entry || !(f.qty > 0)) continue;
            xp += _num(X.perFind, 5) + (_num(f.entry.chance, 1) <= RARE_CHANCE ? _num(X.rare, 15) : 0);
        }
        const rankUp = _learn(player, 'foraging', xp);
        return { ...res, renown, xp, rankUp };
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
    /** The hunter's craft rank (0..4) from the Hunting & Butchering level: same shape as Foraging.skill. */
    skill(player) {
        return _rank(player, 'hunting', 'huntingTrips', HUNT_RANKS);
    },

    /** A Hunting & Butchering perk's value for the player (data/skillPacks/wild.json) */
    perk(player, perkId) {
        return _perk(player, 'hunting', perkId, 'huntingTrips');
    },

    /** How much nearer you come before a beast notices you: 0..0.9 (the stalk perk) */
    stalk(player) {
        return Math.max(0, Math.min(0.9, Hunting.perk(player, 'stalk') / 100));
    },

    /** Butchering speed: the share of the time it still takes (the butcher perk) */
    butcherTimeMult(player) {
        return Math.max(0.1, 1 - Hunting.perk(player, 'butcher') / 100);
    },

    /** Loot-chance multiplier on a clean hit: combat, strength and the hides perk. */
    lootMultiplier(player) {
        const combat = _num(player && player.skills && player.skills.combat, 1) || 1;
        const str = _num(player && player.strength, 5);
        return (1 + combat * 0.08) * (1 + str * 0.03) * 1.3 * (1 + Hunting.perk(player, 'hides') / 100);
    },

    /** How much accuracy a shot needs to land (lower is easier): the aim perk steadies it. */
    hitThreshold(player) {
        const combat = _num(player && player.skills && player.skills.combat, 1) || 1;
        const str = _num(player && player.strength, 5);
        return 35 - combat * 2 - str - Hunting.perk(player, 'aim');
    },

    /**
     * What a bow's Archery aim (archeryAim, combat pack) adds to a hunting
     * shot on top of hitThreshold, which already holds the Hunting aim: the
     * better of the two governs — a seasoned hunter places a shot as well as
     * a fair archer, an archer shoots straight at any quarry — they never
     * stack. → max(0, archery − hunting aim)
     */
    bowAim(player, archeryAim) {
        return Math.max(0, _num(archeryAim) - Hunting.perk(player, 'aim'));
    },

    /** Chance of an extra cut from each part: the meat perk and luck. */
    qtyBonusChance(player) {
        return Math.max(0, Hunting.perk(player, 'meat') / 100 + (_num(player && player.luck, 5) - 5) * 0.04);
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

    /**
     * End of a hunt: bank the kill (if any), count the trip, and the Hunting
     * XP (a trip, each part taken, more for a rare one; butcherKg: a carcass
     * butchered by hand, by its weight). Same shape as Foraging.finishTrip.
     */
    finishTrip(player, found, { butcherKg = null } = {}) {
        _markMigrated(player, 'hunting', 'huntingTrips');
        const res = _bank(player, found || []);
        player.huntingTrips = _num(player.huntingTrips) + 1;
        const X = (PracticeSkills.def('hunting') || {}).xp || {};
        let xp = _num(X.perTrip, 4);
        for (const f of found || []) {
            if (!f || !f.entry || !(f.qty > 0)) continue;
            xp += _num(X.perPart, 4) + (_num(f.entry.chance, 1) <= RARE_CHANCE ? _num(X.rare, 12) : 0);
        }
        if (butcherKg != null) xp += _num(X.butcher, 6) + Math.max(0, _num(butcherKg)) * _num(X.butcherPerKg, 0.05);
        const rankUp = _learn(player, 'hunting', xp);
        return { ...res, renown: 0, xp, rankUp };
    },

    /**
     * The quick hunt's quarry taken: one, in its qty range (the shooting —
     * bow, arrows, misses — is player/huntingBow.js quickShots; `entry` the
     * quarry it brought down, else one is picked). Same shape as Foraging.quickForage.
     */
    quickHunt(player, table, entry = null) {
        if (!Array.isArray(table) || !table.length) return { success: false, reason: 'There is nothing to hunt in this terrain.' };
        entry = entry || Hunting.pickPrey(table, player) || table[0];
        const qty = Hunting.rollQty(entry, player);
        const trip = Hunting.finishTrip(player, [{ entry, qty }]);
        const lost = trip.lost[0];
        return { success: true, entry, qty, added: !lost, reason: lost ? lost.reason : undefined, rankUp: trip.rankUp };
    },
};

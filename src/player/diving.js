// ============================================
// DIVING — under the water of an inner map, scavenging the bottom
// ============================================
//
// The player swims out (world/innerMap/swimming.js, player/swimming.js) and
// goes under: they swim about below the surface on one breath, through water
// only, picking up what lies on the bottom. Going under, moving, picking up
// and surfacing on the map is ui/innerMapDiving.js; the view below is
// ui/innerMapLayers/underwater.js. What it does to the diver is here:
//
//   • breath(player): seconds you can stay down — the Diving skill's level
//     (systems/practiceSkills.js, data/practiceSkills.json perk breath). The
//     skill also eases the cold's drain (coldResist) and speeds you (speed).
//   • goUnder(player) → the dive (player.dive: { breath, max, haul, gold, under, past, finds, treasures }).
//   • tick(player, world, worldTile, dt): breath drains (faster in the cold);
//     out of it, each second hurts and risks a blackout; energy goes.
//     → { blackout, drowned, outOfBreath, low, cold }
//   • take(player, find): a find from the bottom into the packs (or the purse),
//     noted on the dive's haul.
//   • surface(player, { blackout }): a blackout loses the haul. The dive is
//     Diving XP (time under, more for pushing to the limit, finds and
//     treasure) and Swimming XP; level-ups come back on the result. Then the
//     diver must get their breath back before going under again
//     (player.breathRecovery): a few seconds after an easy dive, winded a
//     long while after one to the limit or a blackout — shorter as the skill
//     rises. recover(player, dt) counts it down; canDive refuses meanwhile.
//   • scatter(cells, opts) / bedFor(store, key, day, cells, opts): what lies on
//     the bottom of a map, seeded by the world, the map and the day, drawn
//     from the tables by water (sea, lake, river, pond: tile._waterKind) and
//     depth (tile._deep); treasure rare, likelier by a wreck. Kept for the day.
//
// Numbers and tables in data/diving.json. Randomness through Utils, or a local
// seeded stream for the bottom's scatter; player and world passed in.

import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { Utils } from '../core/utils.js';
import { Containers } from '../systems/containers.js';
import { Swimming } from './swimming.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { Endurance } from './endurance.js';

const DEFAULTS = {
    drainPerSecond: 1,
    underwaterSpeed: 0.75,
    energyPerSecond: 0.12,
    practiceEnergyCut: 0.5,
    recovery: { windedShare: 0.1, blackoutMult: 1.5, curve: 2 },
    minEnergy: 15,
    hygiene: 6,
    comfort: -3,
    lowBreath: 0.25,
    overHealthPerSecond: 1.5,
    blackout: { perSecond: 0.02, perOverSecond: 0.002, health: 25 },
    cold: { mult: 2, breathMult: 1.5, healthPerSecond: 0.3, comfort: -8, blackout: 0.02 },
    wreckRange: 3,
    bed: { perTile: 0.1, max: 60, looks: {} },
    treasure: { chance: {}, wreckMult: 4, luckPer: 0.05, finds: [] },
    tables: {},
};

const KINDS = ['sea', 'lake', 'river', 'pond'];

function _num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

function _qty(q, rng) {
    if (Array.isArray(q)) {
        const lo = Math.round(q[0]), hi = Math.round(q[1]);
        return lo + Math.floor(rng() * (hi - lo + 1));
    }
    return Math.max(1, Math.round(_num(q, 1)));
}

function _pick(list, weightOf, rng) {
    const total = list.reduce((s, e) => s + Math.max(0, weightOf(e)), 0);
    if (!(total > 0)) return null;
    let roll = rng() * total;
    for (const e of list) {
        roll -= Math.max(0, weightOf(e));
        if (roll <= 0) return e;
    }
    return list[list.length - 1];
}

/** A small seeded stream (mulberry32), for the bottom's scatter */
function _stream(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const Diving = {
    config() {
        const g = DataLoader._gamedata;
        const d = (g && g.diving) || {};
        return {
            ...DEFAULTS, ...d,
            recovery: { ...DEFAULTS.recovery, ...(d.recovery || {}) },
            blackout: { ...DEFAULTS.blackout, ...(d.blackout || {}) },
            cold: { ...DEFAULTS.cold, ...(d.cold || {}) },
            bed: { ...DEFAULTS.bed, ...(d.bed || {}) },
            treasure: { ...DEFAULTS.treasure, ...(d.treasure || {}) },
            tables: d.tables || DEFAULTS.tables,
        };
    },

    /** Seconds the player can stay under on one breath (by their Diving level). */
    breath(player) {
        return Math.max(1, Math.round(PracticeSkills.perk(player, 'diving', 'breath') || 20));
    },

    /** A multiplier on the speed under the water (by their Diving level). */
    speedMult(player) {
        return 1 + PracticeSkills.perk(player, 'diving', 'speed') / 100;
    },

    /** How much faster the cold drains this diver's breath (the skill shrugs some of it off). */
    coldBreathMult(player) {
        const C = Diving.config();
        const extra = Math.max(0, _num(C.cold.breathMult, 1) - 1);
        const resist = Math.max(0, Math.min(1, PracticeSkills.perk(player, 'diving', 'coldResist') / 100));
        return 1 + extra * (1 - resist);
    },

    // ══════════════════════════════════════════════
    // GETTING YOUR BREATH BACK
    // ══════════════════════════════════════════════

    /**
     * The seconds to get your breath back after a dive that left `share` of
     * it (0..1). → { seconds, winded }
     */
    recoveryFor(player, share, { blackout = false } = {}) {
        const R = Diving.config().recovery;
        const winded = PracticeSkills.perk(player, 'diving', 'winded') || 60;
        const easy = Math.min(winded, PracticeSkills.perk(player, 'diving', 'catchBreath') || 5);
        const at = Math.max(0, Math.min(0.99, _num(R.windedShare, 0.1)));
        if (blackout) return { seconds: Math.round(winded * _num(R.blackoutMult, 1.5)), winded: true };
        if (share <= at) return { seconds: Math.round(winded), winded: true };
        const spent = Math.max(0, Math.min(1, (1 - share) / (1 - at)));
        return { seconds: Math.round(easy + (winded - easy) * Math.pow(spent, _num(R.curve, 2))), winded: false };
    },

    /** Is the player still getting their breath back? */
    recovering(player) {
        const b = player && player.breathRecovery;
        return !!(b && b.left > 0);
    },

    /** Seconds left getting their breath back (whole, rounded up) */
    recoveryLeft(player) {
        const b = player && player.breathRecovery;
        return b && b.left > 0 ? Math.ceil(b.left) : 0;
    },

    /** The breath back so far, 0..1 (1 when not recovering) */
    recoveryShare(player) {
        const b = player && player.breathRecovery;
        if (!b || !(b.left > 0)) return 1;
        const from = Math.max(0, Math.min(1, _num(b.from, 0)));
        return Math.max(0, Math.min(1, from + (1 - from) * (1 - b.left / Math.max(1, b.total))));
    },

    /** "Catching your breath — 6s" / "Winded — catching your breath, 40s" */
    recoveryText(player) {
        const b = player && player.breathRecovery;
        if (!b || !(b.left > 0)) return null;
        const secs = Math.ceil(b.left);
        return b.winded ? `Winded — catching your breath, ${secs}s` : `Catching your breath — ${secs}s`;
    },

    /** `dt` seconds out of the water's grip. → true when a winded diver's breath has just come back */
    recover(player, dt) {
        const b = player && player.breathRecovery;
        if (!b || !(dt > 0)) return false;
        b.left = Math.max(0, b.left - dt);
        if (b.left > 0) return false;
        player.breathRecovery = null;
        return !!b.winded;
    },

    /** The water at a map tile: { kind: 'sea'|'lake'|'river'|'pond', deep } */
    waterOf(tile) {
        const kind = tile && KINDS.includes(tile._waterKind) ? tile._waterKind : (tile && tile._sea ? 'sea' : 'pond');
        return { kind, deep: !!(tile && tile._deep) };
    },

    /** May the player go under now? → { ok, reason } (as for a swim, and not too tired to hold a breath) */
    canDive(player) {
        const swim = Swimming.canSwim(player);
        if (!swim.ok) return swim;
        const energy = player.needs ? _num(player.needs.energy, 100) : 100;
        if (energy < Diving.config().minEnergy) return { ok: false, reason: 'You are too tired to hold your breath and go down. Rest first.' };
        if (Diving.recovering(player)) return { ok: false, reason: Diving.recoveryText(player), recovering: true };
        return { ok: true, reason: null };
    },

    // ══════════════════════════════════════════════
    // THE DIVE
    // ══════════════════════════════════════════════

    isUnder(player) {
        return !!(player && player.dive);
    },

    /** Fill your lungs and go under. */
    goUnder(player, world = null, worldTile = null) {
        const C = Diving.config();
        const max = Diving.breath(player);
        player.dive = { breath: max, max, haul: {}, gold: 0, under: 0, past: 0, warned: false, finds: 0, treasures: 0 };
        player.breathRecovery = null;
        player.dives = _num(player.dives, 0) + 1;
        if (typeof player.modifyNeed === 'function' && player.needs) {
            const SC = Swimming.config();
            if (_num(player.needs.hygiene, 100) < SC.hygieneMax) player.modifyNeed('hygiene', Math.min(C.hygiene, SC.hygieneMax - player.needs.hygiene));
            player.modifyNeed('comfort', C.comfort + (Swimming.isCold(world, worldTile) ? _num(C.cold.comfort, 0) : 0));
        }
        return player.dive;
    },

    /** The breath left, 0..1 */
    breathShare(player) {
        const d = player && player.dive;
        return d ? Math.max(0, Math.min(1, d.breath / Math.max(1, d.max))) : 1;
    },

    /**
     * `dt` seconds under the water.
     * → { blackout, drowned, outOfBreath (just ran out), low (just ran low), cold }
     */
    tick(player, world, worldTile, dt, rng = Utils.random) {
        const out = { blackout: false, drowned: false, outOfBreath: false, low: false, cold: false };
        const d = player && player.dive;
        if (!d || !(dt > 0)) return out;
        const C = Diving.config();
        const cold = Swimming.isCold(world, worldTile);
        out.cold = cold;
        d.under += dt;
        // The work of it (less for a strong swimmer)
        const prac = Swimming.practice(player);
        if (typeof player.modifyNeed === 'function' && player.needs) {
            player.modifyNeed('energy', -C.energyPerSecond * dt * (1 - prac * C.practiceEnergyCut) * Endurance.energyMult(player));
        }
        // The breath
        const had = d.breath;
        d.breath = Math.max(0, d.breath - C.drainPerSecond * dt * (cold ? Diving.coldBreathMult(player) : 1));
        const lowAt = d.max * _num(C.lowBreath, 0.25);
        if (had > lowAt && d.breath <= lowAt && d.breath > 0) out.low = true;
        if (had > 0 && d.breath <= 0) out.outOfBreath = true;
        let hurt = cold ? _num(C.cold.healthPerSecond, 0) * dt : 0;
        if (d.breath <= 0) {
            d.past += dt;
            hurt += C.overHealthPerSecond * dt * (cold ? _num(C.cold.mult, 1) : 1);
            const p = (_num(C.blackout.perSecond, 0) + d.past * _num(C.blackout.perOverSecond, 0) + (cold ? _num(C.cold.blackout, 0) : 0)) * dt;
            if (rng() < p) {
                out.blackout = true;
                hurt += _num(C.blackout.health, 25);
            }
        }
        if (hurt > 0) player.health = Math.max(0, _num(player.health, 100) - hurt);
        out.drowned = player.health <= 0;
        return out;
    },

    /** A find off the bottom into the packs (gold into the purse) → { ok, reason } */
    take(player, find) {
        if (!player || !find) return { ok: false, reason: 'Nothing there.' };
        const d = player.dive;
        if (find.gold > 0) {
            player.gold = _num(player.gold, 0) + find.gold;
            if (d) { d.gold += find.gold; if (find.rare) d.treasures++; else d.finds++; }
            return { ok: true, reason: null };
        }
        const res = PlayerInventory.addItem(player, find.item, find.qty);
        if (!res.success) return { ok: false, reason: res.reason || 'Your packs are full.' };
        if (d) {
            d.haul[find.item] = (d.haul[find.item] || 0) + find.qty;
            if (find.rare) d.treasures++; else d.finds++;
        }
        if (find.rare) player.diveTreasures = _num(player.diveTreasures, 0) + 1;
        return { ok: true, reason: null };
    },

    /** The Diving XP a dive earned → { xp, limit (pushed to the end of the breath) } */
    diveXp(dive, { blackout = false } = {}) {
        const X = (PracticeSkills.def('diving') || {}).xp || {};
        const share = dive.breath / Math.max(1, dive.max);
        const limit = blackout || dive.past > 0 || share <= _num(X.limitShare, 0.2);
        let xp = _num(dive.under, 0) * _num(X.perSecond, 0.6) * (limit ? _num(X.limitMult, 1.75) : 1);
        xp += _num(dive.finds, 0) * _num(X.find, 1) + _num(dive.treasures, 0) * _num(X.treasure, 15);
        return { xp, limit };
    },

    /**
     * Up for air. A blackout lets go of everything picked up on this dive.
     * The dive is Diving and Swimming XP; then the breath must come back.
     * → { seconds, haul, gold, lost, xp, limit, levelUps: [event], recovery: { seconds, winded } }
     */
    surface(player, { blackout = false } = {}) {
        const d = player && player.dive;
        if (!d) return null;
        const out = { seconds: Math.round(d.under), haul: { ...d.haul }, gold: d.gold, lost: false, xp: 0, limit: false, levelUps: [], recovery: null };
        // What it taught you
        const earned = Diving.diveXp(d, { blackout });
        out.xp = Math.round(earned.xp * 10) / 10;
        out.limit = earned.limit;
        const X = (PracticeSkills.def('diving') || {}).xp || {};
        const share = Math.max(0, Math.min(1, d.breath / Math.max(1, d.max)));
        const up = PracticeSkills.gain(player, 'diving', earned.xp);
        if (up) out.levelUps.push(up);
        const sw = PracticeSkills.gain(player, 'swimming', d.under * _num(X.swimmingPerSecond, 0));
        if (sw) out.levelUps.push(sw);
        // The breath to get back (at the level you came up with)
        const rec = Diving.recoveryFor(player, share, { blackout });
        out.recovery = rec;
        player.breathRecovery = rec.seconds > 0 ? { left: rec.seconds, total: rec.seconds, winded: rec.winded, from: share } : null;
        if (blackout) {
            out.lost = Object.keys(d.haul).length > 0 || d.gold > 0;
            for (const [id, q] of Object.entries(d.haul)) {
                const left = _num(player.inventory && player.inventory[id], 0) - q;
                if (left > 0) player.inventory[id] = left;
                else if (player.inventory) delete player.inventory[id];
            }
            player.gold = Math.max(0, _num(player.gold, 0) - d.gold);
        }
        player.dive = null;
        return out;
    },

    // ══════════════════════════════════════════════
    // WHAT LIES ON THE BOTTOM
    // ══════════════════════════════════════════════

    /** The common finds for this water (deep water with no table of its own uses the shallows'). */
    table(water) {
        const t = Diving.config().tables[water.kind] || {};
        return (water.deep ? t.deep || t.shallow : t.shallow || t.deep) || [];
    },

    /** The chance a find here is treasure. */
    treasureChance(player, water, { nearWreck = false } = {}) {
        const T = Diving.config().treasure;
        const byKind = (T.chance && T.chance[water.kind]) || {};
        let p = _num(water.deep ? byKind.deep : byKind.shallow, 0);
        if (nearWreck) p *= _num(T.wreckMult, 1);
        const luck = _num(player && player.luck, 5);
        p *= Math.max(0.5, 1 + (luck - 5) * _num(T.luckPer, 0));
        return Math.max(0, Math.min(0.5, p));
    },

    /** The treasures that can lie in this water. */
    treasures(water) {
        return (Diving.config().treasure.finds || []).filter(f =>
            (!f.kinds || f.kinds.includes(water.kind)) && (!f.deep || water.deep));
    },

    /**
     * One draw from the bottom → a find { item, qty, gold, name, icon, rare, text, look } or null.
     * opts: { nearWreck }
     */
    rollFind(player, water, { nearWreck = false } = {}, rng = Utils.random) {
        if (rng() < Diving.treasureChance(player, water, { nearWreck })) {
            const f = _pick(Diving.treasures(water), e => (nearWreck && e.wreckWeight != null ? e.wreckWeight : _num(e.weight, 1)), rng);
            if (f) return Diving._find(f, true, rng);
        }
        const e = _pick(Diving.table(water), x => _num(x.weight, 1), rng);
        return e && e.item ? Diving._find(e, false, rng) : null;
    },

    _find(e, rare, rng) {
        if (Array.isArray(e.gold)) {
            const gold = Math.round(e.gold[0]) + Math.floor(rng() * (Math.round(e.gold[1]) - Math.round(e.gold[0]) + 1));
            return { item: null, qty: 1, gold, name: e.name || 'Sunken Chest', icon: e.icon || '💰', rare, text: e.text || null, look: 'chest' };
        }
        const g = Containers.good(e.item);
        const look = rare ? 'treasure' : ((Diving.config().bed.looks || {})[e.item] || 'junk');
        return { item: e.item, qty: _qty(e.qty, rng), gold: 0, name: e.name || g.name, icon: e.icon || g.icon, rare, text: e.text || null, look };
    },

    /**
     * Scatter finds over the divable cells of a map: [{ q, r, kind, deep, nearWreck }]
     * → [{ q, r, ...find }]. opts: { seed, player }. The same seed lays the same bottom.
     */
    scatter(cells, { seed = 0, player = null } = {}) {
        const C = Diving.config();
        const rng = _stream(seed);
        const out = [];
        const max = Math.max(0, _num(C.bed.max, 60));
        for (const c of cells) {
            if (out.length >= max) break;
            if (rng() >= _num(C.bed.perTile, 0.1)) continue;
            const f = Diving.rollFind(player, { kind: c.kind, deep: !!c.deep }, { nearWreck: !!c.nearWreck }, rng);
            if (f) out.push({ q: c.q, r: c.r, ...f });
        }
        return out;
    },

    /** The seed of a map's bottom on a day */
    bedSeed(world, key, day) {
        const p = world && world.generationParams;
        return Utils.hashStr(`${(p && p.seed) || 0}|dive|${key}|${day}`) >>> 0;
    },

    /**
     * The bottom of the map `key` today, kept in `store` (scattered on the first
     * dive of the day; taken finds stay taken). `cells` may be a function, only
     * called when the bottom is new.
     */
    bedFor(store, key, day, cells, opts = {}) {
        const have = store[key];
        if (have && have.day === day) return have;
        const list = typeof cells === 'function' ? cells() : cells;
        store[key] = { day, finds: Diving.scatter(list || [], opts) };
        return store[key];
    },

    /** The find lying at (q, r) on a bottom, or null */
    findAt(bed, q, r) {
        return (bed && bed.finds.find(f => f.q === q && f.r === r)) || null;
    },

    /** Take a find off the bottom for good (for the rest of the day) */
    removeFind(bed, find) {
        if (!bed) return;
        const i = bed.finds.indexOf(find);
        if (i >= 0) bed.finds.splice(i, 1);
    },
};

// ============================================
// FISHING RODS — how far the line goes out
// ============================================
//
// Line fishing on the street map (ui/mapTasks/wildTasks.js) casts the float
// out over the water. How far it can go is the angler's reach:
//
//   reach = baseReach + the rod's reach + the Fishing skill's reach perk,
//           at most maxReach                       (data/skillPacks/food.json
//                                                   skills.fishing.tackle)
//
//   • best(player): the rod used — the best one in the packs (the longest
//     reach, then the surer hand), or null: with none you cut a pole by the
//     water and fish at baseReach, so fishing never needs a purchase.
//   • angler(player): the Fishing skill's edge (systems/foodSkills.js) with
//     the rod's added (bites, land) and the reach, the rod's name.
//   • wear(player, { lost }): a cast wears the rod in hand (more when a
//     hooked fish breaks away); at its durability it breaks and is gone from
//     the packs — the next best rod takes over. Kept on player.rodWear.
//   • castDepth(player, depth, offshore): a float landing far out from dry
//     land fishes one band deeper (shallow → mid; mid → deep only with the
//     deepReach perk).
//
// Rods are goods (ash_rod, greenheart_rod, master_rod), made by the carpenter
// from wood, cord, gut, silk and bronze and sold on the woodworker's stall.
// Player passed in; no globals, no randomness.

import { Grades } from '../core/grades.js';
import { FoodSkills } from '../systems/foodSkills.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const DEPTHS = ['shallow', 'mid', 'deep'];

export const FishingRods = {
    /** The tackle settings (with defaults). */
    cfg() {
        const t = FoodSkills.def('fishing').tackle || {};
        return {
            baseReach: _num(t.baseReach, 3),
            maxReach: _num(t.maxReach, 8),
            noRod: t.noRod || { name: 'cut pole' },
            wearPerCast: _num(t.wearPerCast, 1),
            wearPerLost: _num(t.wearPerLost, 1),
            longCast: { offshore: _num(t.longCast && t.longCast.offshore, 5) },
            rods: t.rods || {},
        };
    },

    /** Every rod's good id. */
    ids() {
        return Object.keys(FishingRods.cfg().rods);
    },

    /** A rod's numbers → { id, name, reach, bites (%), land (%), durability } or null. */
    rod(id) {
        const r = FishingRods.cfg().rods[id];
        if (!r) return null;
        return { id, name: r.name || id.replace(/_/g, ' '), reach: _num(r.reach), bites: _num(r.bites), land: _num(r.land), durability: Math.max(1, _num(r.durability, 60)) };
    },

    /** The rod in hand: the best held (longest reach, then the surer hand), or null (a cut pole). */
    best(player) {
        const inv = (player && player.inventory) || {};
        let best = null;
        for (const id of FishingRods.ids()) {
            if (!(_num(inv[id]) >= 1)) continue;
            const r = FishingRods.rod(id);
            if (!best || r.reach > best.reach || (r.reach === best.reach && r.land > best.land)) best = r;
        }
        return best;
    },

    /** The Fishing skill's share of the reach (its reach perk). */
    skillReach(player) {
        return Math.max(0, Math.round(_num(FoodSkills.fishing(player).reach)));
    },

    /** How far this angler casts (tiles from where they stand). */
    reach(player) {
        const c = FishingRods.cfg();
        const rod = FishingRods.best(player);
        const r = c.baseReach + (rod ? rod.reach : 0) + FishingRods.skillReach(player);
        return Math.max(1, Math.min(c.maxReach, r));
    },

    /** The Fishing edge with the rod in hand: FoodSkills.fishing + { reach, rod, rodName } (bites, land raised). */
    angler(player) {
        const sk = FoodSkills.fishing(player);
        const rod = FishingRods.best(player);
        return {
            ...sk,
            bites: sk.bites + (rod ? rod.bites / 100 : 0),
            land: sk.land + (rod ? rod.land / 100 : 0),
            reach: FishingRods.reach(player),
            rod: rod ? rod.id : null,
            rodName: rod ? rod.name : FishingRods.cfg().noRod.name,
        };
    },

    /** "your ash rod casts 5 tiles" */
    describe(player) {
        const a = FishingRods.angler(player);
        return `your ${a.rodName} casts ${a.reach} tile${a.reach === 1 ? '' : 's'}`;
    },

    /** How worn the rod in hand is → { rod, wear, durability, share } (rod null with none). */
    condition(player) {
        const rod = FishingRods.best(player);
        if (!rod) return { rod: null, wear: 0, durability: 0, share: 0 };
        const wear = Math.max(0, _num(player.rodWear && player.rodWear[rod.id]));
        return { rod: rod.id, wear, durability: rod.durability, share: Math.min(1, wear / rod.durability) };
    },

    /**
     * A cast made with the rod in hand (lost: a hooked fish broke away, which
     * strains it more). → { rod, wear, durability, broke, next } (rod null: a
     * cut pole, nothing to wear); a broken rod is gone and `next` names the
     * rod now in hand (null: back to a cut pole).
     */
    wear(player, opts = {}) {
        const rod = FishingRods.best(player);
        if (!rod) return { rod: null, wear: 0, durability: 0, broke: false, next: null };
        const c = FishingRods.cfg();
        if (!player.rodWear) player.rodWear = {};
        const w = _num(player.rodWear[rod.id]) + c.wearPerCast + (opts.lost ? c.wearPerLost : 0);
        if (w >= rod.durability) {
            Grades.remove(player, rod.id, 1);
            delete player.rodWear[rod.id];
            const next = FishingRods.best(player);
            return { rod: rod.id, name: rod.name, wear: rod.durability, durability: rod.durability, broke: true, next: next ? next.id : null, nextName: next ? next.name : c.noRod.name };
        }
        player.rodWear[rod.id] = Math.round(w * 100) / 100;
        return { rod: rod.id, name: rod.name, wear: player.rodWear[rod.id], durability: rod.durability, broke: false, next: rod.id };
    },

    /**
     * The depth a float fishes: one band deeper when it lands `offshore` or more
     * tiles out from dry land — shallow → mid, mid → deep only for an angler
     * with the deepReach perk; deep stays deep.
     */
    castDepth(player, depth, offshore) {
        const i = DEPTHS.indexOf(depth);
        if (i < 0 || !(_num(offshore) >= FishingRods.cfg().longCast.offshore)) return depth;
        if (i === 0) return 'mid';
        if (i === 1 && FoodSkills.fishing(player).deepReach) return 'deep';
        return depth;
    },
};

// ============================================
// WOODLANDS — a hex's trees: the blow that fells one, how many stand, and
// what the fellings on it left (data/townProps.json "felling")
// ============================================
// The one place the felling rules live, for every way a tree comes down:
//
//   • blowDamage(player, def): the % of a tree's (or rock's) health one swing
//     takes, by strength and luck, less its hardness (def.resistance). The
//     inner map's swing (world/innerMap/movement.js _computeObjectDamage) and
//     the "Fell timber" standing order (player/standingOrders.js) both read it;
//     the practised hand, the axe and a logging camp multiply it on top
//     (player/gathering.js damageMult).
//   • stage(rec, day): what stands where a tree was felled — 'stump' for
//     sproutDays, then 'sapling', and 'tree' again treeDays after the felling;
//     'clear' for good once its stump is grubbed out (world/innerMap/felling.js).
//   • The hex's stock: world.felled[hexKey] keeps every felling on the hex
//     (saved) — the inner map's by the spot it stood on ('q,r'), the standing
//     order's as 'order:<n>' (no spot: the inner map leaves them be). Trees
//     standing = the hex's stock (felling.hexTrees by terrain: the trees an
//     inner map of that ground is drawn with) less the fellings not yet grown
//     back. `fell` records one; `standing` counts; `prune` lets go of records
//     that have grown back into trees (order records only: the inner map
//     prunes its own as it lays them).
//
// Pure: world / player / day are parameters; no randomness.

import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const ORDER_KEY = /^order:/;

export const Woodlands = {
    /** The felling tunables: { sproutDays, treeDays, sapling, palmSapling, fallSeconds, hexTrees }. */
    config() {
        const d = (DataLoader.get && DataLoader.get('townProps')) || (DataLoader._gamedata && DataLoader._gamedata.townProps) || {};
        const f = d.felling || {};
        return {
            sproutDays: Number.isFinite(f.sproutDays) ? f.sproutDays : 120,
            treeDays: Number.isFinite(f.treeDays) ? f.treeDays : 360,
            sapling: f.sapling || 'tp_tree_sapling',
            palmSapling: f.palmSapling || 'tp_palm_young',
            fallSeconds: Number.isFinite(f.fallSeconds) ? f.fallSeconds : 1.1,
            hexTrees: f.hexTrees && typeof f.hexTrees === 'object' ? f.hexTrees : {},
        };
    },

    /**
     * One swing's damage, % of the object's health: str×3 + luck×0.5 + 3, less
     * its resistance (0–95). str 1 → ~8.5%, str 5 → ~20.5%, str 10 → ~35.5%.
     */
    blowDamage(player, def) {
        const str = (player && player.strength) || 5;
        const luck = (player && player.luck) || 5;
        const base = str * 3 + luck * 0.5 + 3;
        const resist = def && def.resistance != null ? Math.min(def.resistance, 95) : 0;
        return base * (1 - resist / 100);
    },

    /** What stands where a tree was felled, by the day: 'stump' | 'sapling' | 'tree' | 'clear'. */
    stage(rec, day) {
        if (!rec) return 'tree';
        if (rec.grubbed) return 'clear';
        const C = Woodlands.config();
        const age = Math.max(0, (day || 0) - (rec.day || 0));
        if (age >= C.treeDays) return 'tree';
        if (age >= C.sproutDays) return 'sapling';
        return 'stump';
    },

    /** The trees an inner map of this ground is drawn with (0: no woods to fell). */
    stock(terrainId) {
        const H = Woodlands.config().hexTrees;
        return Math.max(0, Math.floor(_num(H[terrainId], 0)));
    },

    /** Fellings on the hex still a stump, a sapling or cleared ground. */
    cut(world, hexKey, day = _num(world && world.day)) {
        const rec = world && world.felled && world.felled[hexKey];
        if (!rec) return 0;
        let n = 0;
        for (const k of Object.keys(rec)) if (Woodlands.stage(rec[k], day) !== 'tree') n++;
        return n;
    },

    /** Trees standing on the hex today: its stock less what is cut and not grown back. */
    standing(world, q, r, terrainId, day = _num(world && world.day)) {
        return Math.max(0, Woodlands.stock(terrainId) - Woodlands.cut(world, `${q},${r}`, day));
    },

    /** Let go of the order's fellings that have grown back into trees. */
    prune(world, hexKey, day = _num(world && world.day)) {
        const rec = world && world.felled && world.felled[hexKey];
        if (!rec) return;
        for (const k of Object.keys(rec)) if (ORDER_KEY.test(k) && Woodlands.stage(rec[k], day) === 'tree') delete rec[k];
    },

    /** Record a tree felled on the hex with no spot of its own (the standing order). */
    fell(world, q, r, tree, stump, day = _num(world && world.day), by = 'order') {
        if (!world) return null;
        if (!world.felled || typeof world.felled !== 'object') world.felled = {};
        const hexKey = `${q},${r}`;
        const rec = world.felled[hexKey] || (world.felled[hexKey] = {});
        Woodlands.prune(world, hexKey, day);
        let n = 0;
        while (rec[`order:${n}`]) n++;
        rec[`order:${n}`] = { tree, stump: stump || null, day, by };
        return rec[`order:${n}`];
    },

    /** Is this a felling key with a spot on the map ('q,r')? */
    isSpot(key) {
        return /^-?\d+,-?\d+$/.test(key);
    },
};

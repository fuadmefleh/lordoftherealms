// ============================================
// FOOD SKILLS — farming, fishing and cooking in levels
// ============================================
//
// Three practised skills (systems/practiceSkills.js; their numbers in
// data/skillPacks/food.json) and what each level does, read by the code that
// does the work:
//
//   • Farming (systems/crops.js, ui/innerMapFarming.js): bigger harvests,
//     crops that bear more dry days and live through a few frost days, quicker
//     field work. XP for tilling, sowing, watering and harvesting.
//   • Fishing (ui/actionMenu/skills.js doFish, ui/mapTasks/wildTasks.js fish,
//     player/seasonalWork.js iceFish): more bites and longer to strike, more
//     fish landed, bigger fish, less junk, more casts, deep-water fish (and
//     deep water from any shore) at the higher levels. XP per cast and catch.
//   • Cooking (player/crafting.js works it as a practised craft through
//     trades.craftSkills, like smithing — finer dishes, less waste, quicker,
//     an extra portion; here: heartier cooked food in the eat modal and the
//     world-map meal, and a well-fed spell after one — player/core/needs.js).
//     An inn's meals are as hearty as its keeper's cooking (hospitality.js).
//
// An old save's continuous player.skills.farming / fishing / cooking (0..10)
// become XP once (adopt). Pure functions of a holder; the one random choice
// (rollFish) takes an rng so the UI may draw from its own stream.

import { DataLoader } from '../core/dataLoader.js';
import { PracticeSkills } from './practiceSkills.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

let _cookedSrc;
let _cooked = null;

export const FoodSkills = {
    IDS: ['farming', 'fishing', 'cooking'],

    def(id) {
        return PracticeSkills.def(id) || {};
    },

    xpCfg(id) {
        return FoodSkills.def(id).xp || {};
    },

    /**
     * An old save's continuous skill (player.skills[id], 0..10, raised 0.1 at a
     * time) as XP of the levelled one, once: whole levels map 0 → level 1 …
     * 9 → level 10, the fraction into the next. Returns true when it adopted.
     */
    adopt(holder, id) {
        if (!holder || !PracticeSkills.def(id)) return false;
        if (holder.practiceSkills && holder.practiceSkills[id] != null) return false;
        const old = _num(holder.skills && holder.skills[id]);
        if (!(old > 0)) return false;
        const whole = Math.floor(old);
        const L = Math.min(PracticeSkills.maxLevel(), whole + 1);
        const frac = L >= PracticeSkills.maxLevel() ? 0 : old - whole;
        if (!holder.practiceSkills) holder.practiceSkills = {};
        holder.practiceSkills[id] = Math.round(PracticeSkills.xpForLevel(L) + frac * PracticeSkills.stepXp(L));
        return true;
    },

    level(holder, id) {
        FoodSkills.adopt(holder, id);
        return PracticeSkills.level(holder, id);
    },

    perk(holder, id, perkId) {
        FoodSkills.adopt(holder, id);
        return PracticeSkills.perk(holder, id, perkId);
    },

    /** XP into a food skill (the old value adopted first) → a level-up event or null */
    gain(holder, id, xp) {
        FoodSkills.adopt(holder, id);
        return PracticeSkills.gain(holder, id, xp);
    },

    // ── Farming ──────────────────────────────────────

    /** Harvest multiplier (1 + yield %) */
    farmYieldMult(player) {
        return 1 + FoodSkills.perk(player, 'farming', 'yield') / 100;
    },

    /** Extra dry days a crop bears */
    farmDryDays(player) {
        return Math.max(0, Math.round(FoodSkills.perk(player, 'farming', 'dryDays')));
    },

    /** Frost days a tender crop lives through */
    farmFrostDays(player) {
        return Math.max(0, Math.round(FoodSkills.perk(player, 'farming', 'frostDays')));
    },

    /** Work time multiplier (< 1 when practised) */
    farmWorkMult(player) {
        return Math.max(0.2, 1 - FoodSkills.perk(player, 'farming', 'speed') / 100);
    },

    /** XP for a piece of field work ('till' | 'sow' | 'water' | 'harvest'), units brought in → event or null */
    farmWork(player, kind, units = 0) {
        const X = FoodSkills.xpCfg('farming');
        const xp = _num(X[kind]) + (kind === 'harvest' ? _num(X.perUnit) * _num(units) : 0);
        return xp > 0 ? FoodSkills.gain(player, 'farming', xp) : null;
    },

    // ── Fishing ──────────────────────────────────────

    /** The angler's edge: { level, bites (0..1 added), window (s), land (0..1 added), bigger (0..1), junk (0..1 less), casts, deepReach } */
    fishing(player) {
        const P = (k) => FoodSkills.perk(player, 'fishing', k);
        return {
            level: FoodSkills.level(player, 'fishing'),
            bites: P('bites') / 100,
            window: P('window'),
            land: P('land') / 100,
            bigger: P('bigger') / 100,
            junk: Math.min(0.95, P('junk') / 100),
            casts: Math.max(0, Math.round(P('casts'))),
            deepReach: P('deepReach') > 0,
        };
    },

    /** The fish of a depth ('shallow' | 'mid' | 'deep') this angler can catch (deep-water fish need their level) */
    fishTable(depth, level = 1) {
        const all = FoodSkills.def('fishing').catches || {};
        const t = all[depth] || all.shallow || [];
        return t.filter(f => _num(f.minLevel, 1) <= level);
    },

    /** The fish that only a more practised angler would find at this depth: [{ fish, minLevel }] */
    lockedFish(depth, level = 1) {
        const all = FoodSkills.def('fishing').catches || {};
        return (all[depth] || []).filter(f => _num(f.minLevel, 1) > level);
    },

    /** The draw weights by rarity for this luck and skill */
    rarityWeights(player, luck = 5) {
        const W = { junk: 15, common: 40, uncommon: 25, rare: 10, legendary: 2, luckRare: 0.5, luckLegendary: 0.4, ...(FoodSkills.def('fishing').rarityWeights || {}) };
        const sk = FoodSkills.fishing(player);
        return {
            junk: W.junk * (1 - sk.junk),
            common: W.common,
            uncommon: W.uncommon,
            rare: W.rare + _num(luck, 5) * W.luckRare,
            legendary: W.legendary + _num(luck, 5) * W.luckLegendary,
        };
    },

    /**
     * Draw a fish for this angler at a depth: the table by level, weighted by
     * rarity (luck, less junk), then perhaps the bigger kind. rng() → 0..1.
     * → a copy of the fish ({ name, label, icon, value, rarity, fight, bigger? })
     */
    rollFish(player, depth, rng, luck = 5) {
        const sk = FoodSkills.fishing(player);
        const table = FoodSkills.fishTable(depth, sk.level);
        if (!table.length) return null;
        const W = FoodSkills.rarityWeights(player, luck);
        const weighted = table.map(f => ({ f, w: _num(W[f.rarity], 10) }));
        const total = weighted.reduce((s, x) => s + x.w, 0);
        let r = rng() * total;
        let pick = weighted[0].f;
        for (const x of weighted) {
            r -= x.w;
            if (r <= 0) { pick = x.f; break; }
        }
        const out = { ...pick };
        // A bigger one of its kind
        const up = (FoodSkills.def('fishing').bigger || {})[out.name];
        if (up && sk.bigger > 0 && rng() < sk.bigger) {
            const big = Object.values(FoodSkills.def('fishing').catches || {}).flat().find(f => f.name === up);
            if (big) return { ...big, bigger: true };
        }
        return out;
    },

    /** Can this angler choose deep water here? (deep sea beside, or practised enough on a sea shore) */
    canFishDeep(player, deepWaterNear, seaShore) {
        return !!deepWaterNear || (!!seaShore && FoodSkills.fishing(player).deepReach);
    },

    /** XP of a day's fishing: casts made, fish landed, fish lost; quick (a share) → event or null */
    fishXp(player, { casts = 0, catches = [], snapped = 0, quick = false } = {}) {
        const X = FoodSkills.xpCfg('fishing');
        let xp = _num(X.perCast, 0.5) * _num(casts) + _num(X.snapped, 1) * _num(snapped);
        for (const f of catches || []) xp += _num(X[f && f.rarity], 2);
        if (quick) xp *= _num(X.quickShare, 0.6);
        return xp > 0 ? FoodSkills.gain(player, 'fishing', xp) : null;
    },

    // ── Cooking ──────────────────────────────────────

    /** Goods the cook's hearth makes (the results of cooking recipes) */
    cookedGoods() {
        const g = DataLoader._gamedata;
        const src = g && g.crafting;
        if (_cooked && _cookedSrc === src) return _cooked;
        _cookedSrc = src;
        const set = new Set();
        for (const r of (src && Array.isArray(src.recipes) ? src.recipes : [])) {
            if (r.station !== 'cook') continue;
            if ((r.skill || 'cooking') !== 'cooking') continue;
            for (const k of Object.keys(r.result || {})) set.add(k);
        }
        set.delete('flour');
        set.delete('tallow');
        _cooked = set;
        return set;
    },

    isCooked(good) {
        return FoodSkills.cookedGoods().has(good);
    },

    /** How much more a cooked dish fills this eater (1 + hearty %); 1 for anything else */
    heartyMult(player, good) {
        if (!FoodSkills.isCooked(good)) return 1;
        return 1 + FoodSkills.perk(player, 'cooking', 'hearty') / 100;
    },

    /**
     * After eating `good`: a cooked dish leaves a practised cook well fed
     * (hunger drains slower a while — player/core/needs.js). → the spell or null
     */
    afterEating(player, good) {
        if (!player || !FoodSkills.isCooked(good)) return null;
        const slower = FoodSkills.perk(player, 'cooking', 'wellFed') / 100;
        if (!(slower > 0)) return null;
        const hours = _num(FoodSkills.def('cooking').wellFedHours, 8);
        player.wellFed = { hours, slower };
        return player.wellFed;
    },

    /** Hunger drain multiplier while well fed (1 when not) */
    hungerDrainMult(player) {
        const w = player && player.wellFed;
        return w && _num(w.hours) > 0 ? Math.max(0, 1 - _num(w.slower)) : 1;
    },

    /** An hour lived: the well-fed spell wears down */
    tickWellFed(player, hours = 1) {
        const w = player && player.wellFed;
        if (!w) return;
        w.hours = _num(w.hours) - hours;
        if (!(w.hours > 0)) player.wellFed = null;
    },

    /**
     * An inn's cook (its keeper, seeded as an innkeeper from the house's id —
     * no RNG, nothing saved): { level, levelName, mult (meals × this) }
     */
    innCook(house) {
        if (!house) return { level: 1, levelName: PracticeSkills.levelName(1), mult: 1 };
        let holder = house._cook;
        if (!holder) {
            holder = {};
            PracticeSkills.seedNpc(holder, { key: `inn|${house.id || house.name || ''}|${house.keeper || ''}`, role: 'innkeeper', age: 40 });
            Object.defineProperty(house, '_cook', { value: holder, configurable: true, enumerable: false, writable: true });
        }
        const level = PracticeSkills.level(holder, 'cooking');
        return { level, levelName: PracticeSkills.levelName(level), mult: 1 + PracticeSkills.perkAt('cooking', 'hearty', level) / 100 };
    },
};

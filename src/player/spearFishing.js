// ============================================
// SPEAR FISHING — striking at the fish under the water
// ============================================
//
// While diving (player/diving.js) a player with a fishing spear in their
// packs may strike at the fish swimming about them (seen and moved by
// ui/innerMapLayers/underwaterFish.js; aimed and thrown by
// ui/innerMapSpearFishing.js). This module is the part without a screen:
//
//   • spear(player): the spear in hand — the best grade held (core/grades.js)
//     → { item, index, grade, effect } or null without one.
//   • canStrike(player) → { ok, reason }: a spear, under the water, breath
//     left, the arm back from the last strike.
//   • modeFor(dist): 'strike' (a thrust, close), 'throw' (on its line,
//     farther) or null (out of reach).
//   • hitChance(player, target, mode): by the distance, the fish's speed
//     and size, the Fishing level (the rod's skill: systems/foodSkills.js)
//     and the spear's grade. target: { species, dist, speed }.
//   • strike(player, target, rng): the breath and the cooldown it costs, the
//     roll (seeded: Utils.random unless an rng is passed), the catch into
//     the packs and onto the dive's haul, Fishing XP, the spear's wear and
//     perhaps its breaking. → see strike().
//   • catchFor(player, species, rng): the good a species becomes.
//   • tick(player, dt): the cooldown runs down.
//
// Numbers in data/diving.json `spear`. Player passed in; no globals.

import { DataLoader } from '../core/dataLoader.js';
import { Grades } from '../core/grades.js';
import { PlayerInventory } from '../core/inventory.js';
import { Utils } from '../core/utils.js';
import { Containers } from '../systems/containers.js';
import { FoodSkills } from '../systems/foodSkills.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const DEFAULTS = {
    item: 'fishing_spear',
    aimRadius: 0.9,
    modes: {
        strike: { reach: 1.6, base: 0.72, near: 0.8, perTile: 0.15, breath: 1.5, cooldown: 0.8, wear: 1 },
        throw: { reach: 5, base: 0.58, near: 1.5, perTile: 0.09, breath: 3, cooldown: 2, wear: 1.5 },
    },
    hit: { speedPer: 0.12, sizePer: 0.35, sizeRef: 0.6, levelPer: 0.03, gradePer: 0.5, min: 0.03, max: 0.95 },
    wear: { durability: 40, gradePow: 1.5, hitWear: 1, snapPerLength: 0.01 },
    scare: { radius: 3, seconds: 2.5 },
    catches: {},
    bySize: [
        { max: 0.4, item: 'small_fish', rarity: 'common' },
        { max: 0.85, item: 'fish', rarity: 'common' },
        { max: null, item: 'large_fish', rarity: 'uncommon' },
    ],
    xp: { perStrike: 0.5 },
};

export const SpearFishing = {
    config() {
        const g = DataLoader._gamedata;
        const d = (g && g.diving && g.diving.spear) || {};
        const m = d.modes || {};
        return {
            ...DEFAULTS, ...d,
            modes: {
                strike: { ...DEFAULTS.modes.strike, ...(m.strike || {}) },
                throw: { ...DEFAULTS.modes.throw, ...(m.throw || {}) },
            },
            hit: { ...DEFAULTS.hit, ...(d.hit || {}) },
            wear: { ...DEFAULTS.wear, ...(d.wear || {}) },
            scare: { ...DEFAULTS.scare, ...(d.scare || {}) },
            catches: d.catches || DEFAULTS.catches,
            bySize: Array.isArray(d.bySize) && d.bySize.length ? d.bySize : DEFAULTS.bySize,
            xp: { ...DEFAULTS.xp, ...(d.xp || {}) },
        };
    },

    /** The good id of the spear. */
    itemId() {
        return SpearFishing.config().item || DEFAULTS.item;
    },

    /** Does the player carry a fishing spear? */
    hasSpear(player) {
        return _num(player && player.inventory && player.inventory[SpearFishing.itemId()]) >= 1;
    },

    /** The spear in hand: the best held → { item, index, grade (name), effect } or null. */
    spear(player) {
        if (!SpearFishing.hasSpear(player)) return null;
        const item = SpearFishing.itemId();
        const index = Grades.bestIndex(player, item);
        const i = index == null ? Grades.COMMON : index;
        const g = Grades.get(i);
        return { item, index: i, grade: g.name, effect: _num(g.effect, 1) };
    },

    /** The wear the spear in hand takes before it breaks (a finer one lasts longer). */
    durability(player) {
        const W = SpearFishing.config().wear;
        const s = SpearFishing.spear(player);
        const eff = s ? s.effect : 1;
        return Math.max(1, _num(W.durability, 40) * Math.pow(Math.max(0.1, eff), _num(W.gradePow, 1)));
    },

    /** The wear on the spear in hand (a different grade in hand, or none: a fresh one). */
    wearOf(player) {
        const s = SpearFishing.spear(player);
        const w = player && player.spearWear;
        if (!s || !w || w.grade !== s.index) return 0;
        return Math.max(0, _num(w.wear));
    },

    /** How worn the spear in hand is → { wear, durability, share (0..1 of its life used) } */
    condition(player) {
        const wear = SpearFishing.wearOf(player);
        const durability = SpearFishing.durability(player);
        return { wear, durability, share: _clamp(wear / durability, 0, 1) };
    },

    /** Seconds before the next strike (0 when ready). */
    cooldown(player) {
        const d = player && player.dive;
        return d ? Math.max(0, _num(d.spearCooldown)) : 0;
    },

    /** The cooldown runs down while under. */
    tick(player, dt) {
        const d = player && player.dive;
        if (d && d.spearCooldown > 0 && dt > 0) d.spearCooldown = Math.max(0, d.spearCooldown - dt);
    },

    /** May the player strike now? → { ok, reason, noSpear?, cooling? } */
    canStrike(player) {
        if (!SpearFishing.hasSpear(player)) {
            return { ok: false, noSpear: true, reason: 'You have no fishing spear. Without one you can only watch the fish go by.' };
        }
        const d = player.dive;
        if (!d) return { ok: false, reason: 'Go under the water first; the fish are below.' };
        if (!(d.breath > 0)) return { ok: false, reason: 'You have no breath left to strike with. Surface!' };
        if (SpearFishing.cooldown(player) > 0) return { ok: false, cooling: true, reason: 'Your spear is not back in hand yet.' };
        return { ok: true, reason: null };
    },

    /** A thrust close in, a throw farther off, or out of reach (null). */
    modeFor(dist) {
        const M = SpearFishing.config().modes;
        const d = _num(dist, Infinity);
        if (d <= _num(M.strike.reach, 1.6)) return 'strike';
        if (d <= _num(M.throw.reach, 5)) return 'throw';
        return null;
    },

    /**
     * The chance to hit a fish, 0..1. target: { species: { length, speed },
     * dist (tiles), speed (tiles a second as it moves now; its species' speed
     * when not given) }. mode: 'strike' | 'throw' (by the distance when not given).
     */
    hitChance(player, target, mode = null) {
        const C = SpearFishing.config();
        const t = target || {};
        const m = mode || SpearFishing.modeFor(t.dist);
        if (!m) return 0;
        const M = C.modes[m];
        const H = C.hit;
        const sp = t.species || {};
        const dist = Math.max(0, _num(t.dist, 0));
        if (dist > _num(M.reach, 0)) return 0;
        const speed = Math.max(0, _num(t.speed, _num(sp.speed, 1)));
        const length = _num(sp.length, _num(H.sizeRef, 0.6));
        const level = FoodSkills.level(player, 'fishing');
        const s = SpearFishing.spear(player);
        let p = _num(M.base, 0.5);
        p -= Math.max(0, dist - _num(M.near, 0)) * _num(M.perTile, 0);
        p -= speed * _num(H.speedPer, 0);
        p += (length - _num(H.sizeRef, 0.6)) * _num(H.sizePer, 0);
        p += (Math.max(1, level) - 1) * _num(H.levelPer, 0);
        p += ((s ? s.effect : 1) - 1) * _num(H.gradePer, 0);
        return _clamp(p, _num(H.min, 0), _num(H.max, 1));
    },

    /** The good a speared fish of this species becomes → { item, rarity, bigger? } */
    catchFor(player, species, rng = Utils.random) {
        const C = SpearFishing.config();
        const sp = species || {};
        let e = sp.id && C.catches[sp.id];
        if (!e || !e.item) {
            const len = _num(sp.length, 0.6);
            e = C.bySize.find(b => b.max == null || len <= _num(b.max, Infinity)) || C.bySize[C.bySize.length - 1];
        }
        const out = { item: e.item, rarity: e.rarity || 'common' };
        // The Fishing skill's bigger perk: now and then the bigger kind
        const up = (FoodSkills.def('fishing').bigger || {})[out.item];
        const chance = FoodSkills.fishing(player).bigger;
        if (up && chance > 0 && rng() < chance) return { ...out, item: up, bigger: true };
        return out;
    },

    /**
     * Strike at a fish (or throw at it, farther off). target: { species,
     * dist, speed }. The breath and cooldown are spent and the spear wears
     * whether it hits or not. rng() → 0..1 (Utils.random by default).
     * → { ok, reason, noSpear?, mode, chance, hit, catch: { item, qty, name, icon, rarity, bigger }|null,
     *     kept (into the packs), full (the packs were full: let go), wear, durability, broke, snapped,
     *     breath (left), cooldown, xp, levelUp, scare: { radius, seconds }|null }
     */
    strike(player, target, rng = Utils.random) {
        const can = SpearFishing.canStrike(player);
        if (!can.ok) return { ...can, hit: false };
        const C = SpearFishing.config();
        const t = target || {};
        const mode = SpearFishing.modeFor(t.dist);
        if (!mode) return { ok: false, reason: 'That fish is out of reach of your spear.', hit: false };
        const M = C.modes[mode];
        const d = player.dive;
        const chance = SpearFishing.hitChance(player, t, mode);
        const spear = SpearFishing.spear(player);
        const durability = SpearFishing.durability(player);
        let wear = SpearFishing.wearOf(player);
        // The breath it takes, and the arm back (or the line hauled in)
        d.breath = Math.max(0, d.breath - _num(M.breath, 0));
        d.spearCooldown = Math.max(0, _num(M.cooldown, 0));
        d.strikes = _num(d.strikes) + 1;
        const hit = rng() < chance;
        const out = {
            ok: true, reason: null, mode, chance, hit, catch: null, kept: false, full: false,
            wear: 0, durability, broke: false, snapped: false, breath: d.breath, cooldown: d.spearCooldown,
            xp: 0, levelUp: null, scare: null,
        };
        wear += _num(M.wear, 1);
        let xp = _num(C.xp.perStrike, 0);
        if (hit) {
            wear += _num(C.wear.hitWear, 0);
            const c = SpearFishing.catchFor(player, t.species, rng);
            const g = PlayerInventory.addItem(player, c.item, 1);
            const good = SpearFishing._good(c.item);
            out.catch = { item: c.item, qty: 1, name: good.name, icon: good.icon, rarity: c.rarity, bigger: !!c.bigger };
            if (g.success) {
                out.kept = true;
                d.haul[c.item] = (d.haul[c.item] || 0) + 1;
                d.finds = _num(d.finds) + 1;
                d.speared = _num(d.speared) + 1;
                player.fishSpeared = _num(player.fishSpeared) + 1;
                xp += _num((FoodSkills.xpCfg('fishing') || {})[c.rarity], 2);
            } else {
                out.full = true;
                out.reason = g.reason || 'Your packs are full.';
            }
            // A big fish may snap the shaft
            const snap = _num(C.wear.snapPerLength, 0) * _num(t.species && t.species.length, 0.6) / Math.max(0.1, spear.effect);
            if (snap > 0 && rng() < snap) out.snapped = true;
        } else {
            out.scare = { radius: _num(C.scare.radius, 3), seconds: _num(C.scare.seconds, 2.5) };
        }
        // The spear's wear, and perhaps its end
        if (out.snapped || wear >= durability) {
            Grades.remove(player, spear.item, 1, { grade: Grades.get(spear.index).id });
            out.broke = true;
            out.wear = durability;
            player.spearWear = null;
            player.spearsBroken = _num(player.spearsBroken) + 1;
        } else {
            out.wear = wear;
            player.spearWear = { grade: spear.index, wear: Math.round(wear * 100) / 100 };
        }
        out.xp = Math.round(xp * 10) / 10;
        if (xp > 0) out.levelUp = FoodSkills.gain(player, 'fishing', xp);
        return out;
    },

    /** A good's name and icon. */
    _good(id) {
        const g = Containers.good(id);
        return { name: g.name || id, icon: g.icon || '🐟' };
    },
};

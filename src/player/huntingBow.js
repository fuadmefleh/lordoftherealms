// ============================================
// HUNTING BOW — game shot with a bow and arrows
// ============================================
// Hunting at range needs a bow and arrows (or a crossbow and bolts) in the packs. Each
// shot uses an arrow; whether it strikes comes from the distance, how alert
// the beast is, its size and speed (data/animals.json species), the hunter's
// Hunting & Butchering rank and steadiness (Hunting.hitThreshold: combat,
// strength and the better of the Hunting and Archery aim), and the grade of
// the bow (core/grades.js — a finer bow shoots truer) and of the arrow. A hit
// may only wound: the beast runs and must be shot again. A miss spooks it
// (unless Archery's second arrow lets you loose again first). Missed arrows
// sometimes land whole where they fell; a kill sometimes gives its arrows
// back. Bows wear with every shot (player.bowWear, by bow and grade) and
// break; a better grade lasts longer.
//
// The stalk on the inner map (ui/mapTasks/wildTasks.js) and the quick hunt
// (ui/actionMenu/jobs.js) both shoot through loose(). Tunables live in
// data/wildTasks.json hunt.bow.
//
// Domain rules: player is a parameter, randomness from Utils (or an rng
// passed in), goods through Grades / PlayerInventory.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Grades } from '../core/grades.js';
import { PlayerInventory } from './inventory.js';
import { Hunting } from './foraging.js';
import { CombatSkills } from '../systems/combatSkills.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r3 = (v) => Math.round(v * 1000) / 1000;

const DEFAULTS = {
    weapons: { bow: { aim: 0, wear: 1 }, crossbow: { aim: 0.06, wear: 0.7, ammo: 'bolts' } },
    ammo: 'arrows',
    hit: {
        base: 0.8, freeTiles: 1, perTile: 0.07, alert: 0.3,
        sizeRef: 60, perSizeDecade: 0.12, sizeMin: -0.25, sizeMax: 0.12,
        speedRef: 4.8, perSpeed: 0.05,
        perRank: 0.03, perSteady: 0.008, perGradeEffect: 0.3, perArrowEffect: 0.1,
        wounded: 0.06, min: 0.05, max: 0.95,
    },
    kill: { base: 0.55, perRank: 0.04, perGradeEffect: 0.25, sizeRef: 60, perSizeDecade: 0.25, closeTiles: 2, close: 0.1, wounded: 0.45, min: 0.08, max: 0.97 },
    woundedBolt: 0.7,
    missesBeforeGone: 2,
    recover: { miss: 0.45, carcass: 0.55 },
    wear: { perShot: 4, snapBelow: 20, snapChance: 0.08 },
    fumble: { chance: 0.03, damage: [5, 16] },
    quick: { shots: 4, dist: 3, alert: 0.25, alertPerMiss: 0.25 },
    defaultKg: 30,
    defaultSpeed: 5,
    words: {},
};

function _fmt(str, vars = {}) {
    return String(str == null ? '' : str).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

function _name(id) {
    return String(id || '').replace(/_/g, ' ');
}

export const HuntingBow = {
    /** The tuning: data/wildTasks.json hunt.bow over the defaults. */
    cfg() {
        const wt = (DataLoader.get && DataLoader.get('wildTasks')) || {};
        const d = (wt.hunt && wt.hunt.bow) || {};
        return {
            ...DEFAULTS, ...d,
            weapons: d.weapons || DEFAULTS.weapons,
            hit: { ...DEFAULTS.hit, ...(d.hit || {}) },
            kill: { ...DEFAULTS.kill, ...(d.kill || {}) },
            recover: { ...DEFAULTS.recover, ...(d.recover || {}) },
            wear: { ...DEFAULTS.wear, ...(d.wear || {}) },
            fumble: { ...DEFAULTS.fumble, ...(d.fumble || {}) },
            quick: { ...DEFAULTS.quick, ...(d.quick || {}) },
            words: { ...DEFAULTS.words, ...(d.words || {}) },
        };
    },

    /** A line of wording (data words), filled in. */
    say(key, vars = {}, c = HuntingBow.cfg()) {
        return _fmt(c.words[key] || '', vars);
    },

    /**
     * The weapon in hand: the best of the bows held that has its missiles
     * in the packs (a crossbow shoots bolts, a bow arrows: each weapon's
     * ammo, else the hunt's), by grade, then the weapon's own aim
     * → { item, grade (index), gradeId, effect, aim, wear, ammo } or null.
     */
    weapon(player, c = HuntingBow.cfg()) {
        let best = null;
        for (const [item, w] of Object.entries(c.weapons || {})) {
            if (!(_num(player && player.inventory && player.inventory[item]) > 0)) continue;
            const idx = Grades.bestIndex(player, item);
            const grade = idx == null ? Grades.COMMON : idx;
            const effect = Grades.effectMult(grade);
            const aim = _num(w && w.aim);
            const ammo = (w && w.ammo) || c.ammo;
            // (a bow you have arrows for before a better one you have none for)
            const loaded = _num(player.inventory[ammo]) >= 1 ? 10 : 0;
            const value = loaded + (effect - 1) * c.hit.perGradeEffect + aim;
            if (!best || value > best.value) best = { item, grade, gradeId: Grades.get(grade).id, effect, aim, wear: _num(w && w.wear, 1), ammo, value };
        }
        return best;
    },

    /** The missile a weapon shoots (its own ammo, else the hunt's arrows). */
    ammoOf(weapon, c = HuntingBow.cfg()) {
        return (weapon && weapon.ammo) || c.ammo;
    },

    /** Missiles in the packs for the weapon in hand (arrows, or bolts for a crossbow). */
    arrows(player, c = HuntingBow.cfg(), weapon = undefined) {
        const w = weapon === undefined ? HuntingBow.weapon(player, c) : weapon;
        return Math.max(0, Math.floor(_num(player && player.inventory && player.inventory[HuntingBow.ammoOf(w, c)])));
    },

    /** Can the player shoot? → { ok, weapon, arrows, reason } (reason: what is missing, plainly). */
    gear(player, c = HuntingBow.cfg()) {
        const weapon = HuntingBow.weapon(player, c);
        const arrows = HuntingBow.arrows(player, c, weapon);
        if (!weapon) return { ok: false, weapon: null, arrows, missing: 'bow', reason: HuntingBow.say('noBow', {}, c) || 'You need a bow to hunt.' };
        if (!(arrows > 0)) return { ok: false, weapon, arrows, missing: 'arrows', reason: HuntingBow.say('noArrows', {}, c) || 'You have no arrows.' };
        return { ok: true, weapon, arrows, reason: '' };
    },

    /**
     * A species definition (data/animals.json species) by id, by the hunt's
     * beast name ('deer' → huntBeasts → 'doe'), or by its loot's name
     * ('Venison' → data/wildTasks.json hunt.beasts → 'deer' → 'doe'); null when none.
     */
    species(ref) {
        if (!ref) return null;
        if (typeof ref === 'object') return ref;
        const animals = (DataLoader.get && DataLoader.get('animals')) || {};
        const sp = animals.species || {};
        if (sp[ref]) return sp[ref];
        const wt = (DataLoader.get && DataLoader.get('wildTasks')) || {};
        const beasts = (wt.hunt && wt.hunt.beasts) || {};
        const beast = beasts[ref] || String(ref).toLowerCase();
        const id = (animals.huntBeasts || {})[beast] || beast.replace(/ /g, '_');
        return sp[id] || null;
    },

    /** A beast's weight (kg) and flight speed for the shot. */
    _body(species, c) {
        const s = HuntingBow.species(species) || {};
        return { kg: Math.max(0.5, _num(s.weight, c.defaultKg)), speed: _num(s.fleeSpeed, c.defaultSpeed) };
    },

    /**
     * The hand behind the bow: 35 - Hunting.hitThreshold (combat x 2 +
     * strength + the Hunting aim perk) + the part of Archery's aim above the
     * Hunting aim (Hunting.bowAim: the better of the two governs) + half of
     * Archery's steady perk.
     */
    steadiness(player) {
        const arch = CombatSkills.has('archery') ? CombatSkills.perk(player, 'archery', 'aim') : 0;
        const steady = CombatSkills.has('archery') ? CombatSkills.perk(player, 'archery', 'steady') : 0;
        return Math.max(0, 35 - Hunting.hitThreshold(player)) + Hunting.bowAim(player, arch) + _num(steady) / 2;
    },

    /**
     * The chance an arrow strikes, 0..1. o: { dist (tiles), alert (0..1),
     * species (id, name or definition), wounded, weapon, arrowEffect }.
     */
    hitChance(player, o = {}, c = HuntingBow.cfg()) {
        const H = c.hit;
        const weapon = o.weapon !== undefined ? o.weapon : HuntingBow.weapon(player, c);
        const body = HuntingBow._body(o.species, c);
        const alert = _clamp(_num(o.alert), 0, 1);
        const rank = _num(Hunting.skill(player).level);
        let p = H.base;
        p -= Math.max(0, _num(o.dist, 1) - H.freeTiles) * H.perTile;
        p -= alert * H.alert;
        p += _clamp(Math.log10(body.kg / H.sizeRef) * H.perSizeDecade, H.sizeMin, H.sizeMax);
        p -= (body.speed - H.speedRef) * H.perSpeed * (0.5 + alert);
        p += rank * H.perRank + HuntingBow.steadiness(player) * H.perSteady;
        if (weapon) p += (weapon.effect - 1) * H.perGradeEffect + _num(weapon.aim);
        p += (_num(o.arrowEffect, 1) - 1) * H.perArrowEffect;
        if (o.wounded) p += H.wounded;
        return _r3(_clamp(p, H.min, H.max));
    },

    /** The chance a strike kills outright (else it wounds), 0..1. o as hitChance. */
    killChance(player, o = {}, c = HuntingBow.cfg()) {
        const K = c.kill;
        const weapon = o.weapon !== undefined ? o.weapon : HuntingBow.weapon(player, c);
        const body = HuntingBow._body(o.species, c);
        const rank = _num(Hunting.skill(player).level);
        let p = K.base + rank * K.perRank;
        if (weapon) p += (weapon.effect - 1) * K.perGradeEffect;
        p -= Math.log10(body.kg / K.sizeRef) * K.perSizeDecade;
        if (_num(o.dist, 1) <= K.closeTiles) p += K.close;
        if (o.wounded) p += K.wounded;
        return _r3(_clamp(p, K.min, K.max));
    },

    _wearKey(weapon) {
        return `${weapon.item}:${weapon.gradeId}`;
    },

    /** The bow's condition, 100 (new) .. 0 (about to break). */
    condition(player, weapon = HuntingBow.weapon(player)) {
        if (!weapon) return 0;
        const w = _num(player && player.bowWear && player.bowWear[HuntingBow._wearKey(weapon)]);
        return Math.max(0, Math.round(100 - w));
    },

    /** One shot's wear on the bow in hand; at the end of its life it breaks (one of that grade gone). */
    _wear(player, weapon, rng, c) {
        const W = c.wear;
        if (!player.bowWear || typeof player.bowWear !== 'object') player.bowWear = {};
        const key = HuntingBow._wearKey(weapon);
        const add = W.perShot * weapon.wear / Math.max(0.5, weapon.effect) * (0.5 + rng());
        const wear = _num(player.bowWear[key]) + add;
        const snap = wear >= 100 - W.snapBelow && rng() < W.snapChance;
        if (wear >= 100 || snap) {
            delete player.bowWear[key];
            Grades.remove(player, weapon.item, 1, { grade: weapon.gradeId });
            return { broke: true, condition: 0 };
        }
        player.bowWear[key] = Math.round(wear * 100) / 100;
        return { broke: false, condition: Math.max(0, Math.round(100 - wear)) };
    },

    /** Put `n` arrows of a grade back in the packs (as many as fit) → how many. */
    _giveArrows(player, n, gradeId, c, ammo = c.ammo) {
        if (!(n > 0)) return 0;
        const res = PlayerInventory.addItem(player, ammo, n);
        if (!res.success) return 0;
        if (gradeId && gradeId !== 'common') Grades.add(player, ammo, n, gradeId);
        return n;
    },

    /**
     * Loose one arrow. o: { dist, alert, species, wounded, embedded (arrows
     * already in this beast from earlier hits) }. rng: 0..1 (Utils.random).
     * → { ok, reason?, hit, killed, wounded, chance, killChance, arrowGrade,
     *     missArrow (true: the missed arrow landed whole — lay it on the ground),
     *     recovered (arrows pulled back from a kill, into the packs),
     *     secondArrow (a miss, but you may loose again before it runs),
     *     fumble { damage } | null, broke, condition, worn, arrowsLeft, levelUp }
     */
    loose(player, o = {}, rng = Utils.random, c = HuntingBow.cfg()) {
        const g = HuntingBow.gear(player, c);
        if (!g.ok) return { ok: false, reason: g.reason, missing: g.missing };
        const weapon = g.weapon;
        // The arrow: the best first
        const ammo = HuntingBow.ammoOf(weapon, c);
        const drawn = Grades.remove(player, ammo, 1, { order: 'best' });
        const arrowGrade = Object.keys(drawn.drawn || {}).find(k => drawn.drawn[k] > 0) || 'common';
        const shot = { ...o, weapon, arrowEffect: _num(drawn.effect, 1) };
        const chance = HuntingBow.hitChance(player, shot, c);
        const kc = HuntingBow.killChance(player, shot, c);
        const hit = rng() < chance;
        let killed = false, wounded = false, missArrow = false, recovered = 0, secondArrow = false, fumble = null;
        if (hit) {
            killed = rng() < kc;
            wounded = !killed;
            if (killed) {
                // Every arrow in the carcass (this one and those from earlier hits) may come out whole
                const inIt = 1 + Math.max(0, Math.floor(_num(o.embedded)));
                let whole = 0;
                for (let i = 0; i < inIt; i++) if (rng() < c.recover.carcass) whole++;
                recovered = HuntingBow._giveArrows(player, whole, arrowGrade, c, ammo);
            }
        } else {
            missArrow = rng() < c.recover.miss;
            if (CombatSkills.has('archery')) {
                const ch = CombatSkills.chance(player, 'archery', 'secondArrow');
                secondArrow = ch > 0 && rng() < ch;
            }
            if (rng() < c.fumble.chance) {
                const [lo, hi] = Array.isArray(c.fumble.damage) ? c.fumble.damage : [5, 16];
                fumble = { damage: Math.round(lo + rng() * (hi - lo)) };
            }
        }
        const wear = HuntingBow._wear(player, weapon, rng, c);
        // Archery practice: every arrow loosed, more for one that strikes
        let levelUp = null;
        if (CombatSkills.has('archery')) {
            levelUp = CombatSkills.train(player, 'archery', CombatSkills.xpFor('archery', 'shot', 1) + (hit ? CombatSkills.xpFor('archery', 'hit') : 0)) || null;
        }
        return {
            ok: true, hit, killed, wounded, chance, killChance: kc, arrowGrade, missArrow, recovered, secondArrow, fumble,
            broke: wear.broke, condition: wear.condition, worn: !wear.broke && wear.condition <= c.wear.snapBelow,
            weapon, ammo, arrowsLeft: HuntingBow.arrows(player, c, weapon), levelUp,
        };
    },

    /**
     * The quick hunt's shooting (no walking): up to quick.shots arrows at the
     * quarry from quick.dist, the beast warier after each miss; missed arrows
     * that land whole are fetched. prey: a hunting loot entry or a species.
     * → { ok, reason?, killed, shots, recovered, broke, levelUps, fumble }
     */
    quickShots(player, prey, rng = Utils.random, c = HuntingBow.cfg()) {
        const g = HuntingBow.gear(player, c);
        if (!g.ok) return { ok: false, reason: g.reason, missing: g.missing, killed: false, shots: 0 };
        const species = prey && typeof prey === 'object' && prey.name && !prey.weight ? prey.name : prey;
        const Q = c.quick;
        let alert = Q.alert, wounded = false, embedded = 0, shots = 0, recovered = 0, broke = false, killed = false, fumble = null;
        const levelUps = [];
        while (shots < Q.shots && !killed && HuntingBow.gear(player, c).ok) {
            const r = HuntingBow.loose(player, { dist: Q.dist, alert, species, wounded, embedded }, rng, c);
            shots++;
            if (r.levelUp) levelUps.push(r.levelUp);
            if (r.broke) broke = true;
            if (r.fumble && !fumble) fumble = r.fumble;
            if (r.killed) { killed = true; recovered += r.recovered; break; }
            if (r.wounded) { wounded = true; embedded++; alert = Math.min(1, alert + Q.alertPerMiss); continue; }
            if (r.missArrow) recovered += HuntingBow._giveArrows(player, 1, r.arrowGrade, c, r.ammo);
            if (!r.secondArrow) alert = Math.min(1, alert + Q.alertPerMiss);
        }
        return { ok: true, killed, shots, recovered, broke, levelUps, fumble, wounded: wounded && !killed };
    },

    /** "a Fine bow", "a crossbow" */
    weaponLabel(weapon) {
        if (!weapon) return 'bow';
        const g = weapon.gradeId && weapon.gradeId !== 'common' ? `${Grades.get(weapon.gradeId).name.toLowerCase()} ` : '';
        return `${g}${_name(weapon.item)}`;
    },
};

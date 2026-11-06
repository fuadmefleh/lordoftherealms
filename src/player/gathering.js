// ============================================
// GATHERING — felling trees and breaking rock, by Woodcutting and Mining
// ============================================
// The swings at a tree or a rock on the inner map (world/innerMap/movement.js
// startInteraction / updateInteraction; ui/game/gameLoop.js runs them) and
// what comes of them, by the practised skill the object trains
// (systems/practiceSkills.js; data/skillPacks/wild.json):
//
//   • skillFor(def): 'woodcutting' for a tree (or wood), 'mining' for a rock
//     (or stone), else null — a chair struck is not a craft.
//   • damageMult(player, def): the skill's `blows` perk (+50% → ×1.5): fewer
//     swings to bring it down.
//   • swing(player, def): one blow landed → its energy (the skill's `effort`
//     perk eases it) and its XP. → { skill, energy, levelUp }
//   • felled(player, def, resource, terrainId): it came down → the resource,
//     maybe an extra share (logs / stone perk), for a rock maybe something
//     rarer (ore perk; gathering.rareFinds by the hex's terrain), and the
//     XP. → { skill, amount, extra, rare: { item, qty }|null, levelUps }
//
// Randomness through Utils (seedable); player passed in.

import { Utils } from '../core/utils.js';
import { PracticeSkills } from '../systems/practiceSkills.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const DEFAULTS = {
    byObjectType: { tree: 'woodcutting', rock: 'mining' },
    byResource: { wood: 'woodcutting', stone: 'mining' },
    energyPerSwing: 0.6,
    extraShare: 0.4,
    rareFinds: {},
};

export const Gathering = {
    config() {
        const g = PracticeSkills.config().gathering || {};
        return { ...DEFAULTS, ...g };
    },

    /** The practised skill swinging at this object trains, or null */
    skillFor(def) {
        if (!def) return null;
        const C = Gathering.config();
        const res = def.resource && def.resource.type;
        const id = (C.byObjectType || {})[def.objectType] || (res && (C.byResource || {})[res]) || null;
        return id && PracticeSkills.def(id) ? id : null;
    },

    /** How much harder the player's blows land on it (1 = no skill to it) */
    damageMult(player, def) {
        const id = Gathering.skillFor(def);
        if (!id || !player) return 1;
        return 1 + PracticeSkills.perk(player, id, 'blows') / 100;
    },

    /** The energy one swing costs the player */
    swingEnergy(player, def) {
        const id = Gathering.skillFor(def);
        if (!id) return 0;
        const ease = Math.max(0, Math.min(0.9, PracticeSkills.perk(player, id, 'effort') / 100));
        return _num(Gathering.config().energyPerSwing, 0.6) * (1 - ease);
    },

    /** One blow landed on it: tire the player, teach the skill. → { skill, energy, levelUp } | null */
    swing(player, def) {
        const id = Gathering.skillFor(def);
        if (!id || !player) return null;
        const energy = Gathering.swingEnergy(player, def);
        if (energy > 0 && typeof player.modifyNeed === 'function' && player.needs) player.modifyNeed('energy', -energy);
        const X = (PracticeSkills.def(id) || {}).xp || {};
        const levelUp = PracticeSkills.gain(player, id, _num(X.perSwing, 0.5));
        return { skill: id, energy, levelUp };
    },

    /** A rarer find out of the broken rock: { item, qty } or null (the ore perk's chance) */
    rollRare(player, terrainId) {
        const C = Gathering.config();
        const chance = PracticeSkills.perk(player, 'mining', 'ore') / 100;
        if (!(chance > 0) || Utils.random() >= chance) return null;
        const table = (C.rareFinds || {})[terrainId] || (C.rareFinds || {}).default || [];
        const total = table.reduce((s, e) => s + Math.max(0, _num(e.weight, 1)), 0);
        if (!(total > 0)) return null;
        let roll = Utils.random() * total;
        let pick = table[table.length - 1];
        for (const e of table) {
            roll -= Math.max(0, _num(e.weight, 1));
            if (roll < 0) { pick = e; break; }
        }
        const [lo, hi] = Array.isArray(pick.qty) ? pick.qty : [1, 1];
        return { item: pick.item, qty: Utils.randInt(Math.max(1, lo), Math.max(lo, hi)) };
    },

    /**
     * It came down. resource: { type, amount } (the object's). terrainId: the
     * world hex's terrain (for the rarer finds in rock).
     * → { skill, amount, extra, rare, levelUps: [event] }
     */
    felled(player, def, resource, terrainId = null) {
        const id = Gathering.skillFor(def);
        const base = Math.max(0, Math.round(_num(resource && resource.amount, 1)));
        const out = { skill: id, amount: base, extra: 0, rare: null, levelUps: [] };
        if (!id || !player) return out;
        const C = Gathering.config();
        const perkId = id === 'mining' ? 'stone' : 'logs';
        const chance = PracticeSkills.perk(player, id, perkId) / 100;
        if (chance > 0 && base > 0 && Utils.random() < chance) {
            out.extra = Math.max(1, Math.round(base * _num(C.extraShare, 0.4)));
            out.amount = base + out.extra;
        }
        if (id === 'mining') out.rare = Gathering.rollRare(player, terrainId);
        const X = (PracticeSkills.def(id) || {}).xp || {};
        let xp = _num(id === 'mining' ? X.perBreak : X.perFell, 10) + base * _num(X.perAmount, 0);
        if (out.rare) xp += _num(X.rare, 0);
        const up = PracticeSkills.gain(player, id, xp);
        if (up) out.levelUps.push(up);
        return out;
    },
};

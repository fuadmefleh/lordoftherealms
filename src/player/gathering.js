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
//   • damageMult(player, def): the skill's `blows` perk (+50% → ×1.5) and the
//     best axe (or pick) in the packs (toolFor; gathering.axes / picks): fewer
//     swings to bring it down. Its hardness (def.resistance, the tree's fell
//     block in data/townProps.json) takes off in InnerMap._computeObjectDamage.
//   • swing(player, def): one blow landed → its energy (the skill's `effort`
//     perk eases it) and its XP. → { skill, energy, levelUp }
//   • felled(player, def, resource, terrainId): it came down → the resource,
//     maybe an extra share (logs / stone perk), for a rock maybe something
//     rarer (ore perk; gathering.rareFinds by the hex's terrain), and the
//     XP (more for a harder one: xpPerHardness), and what else a tree gives
//     (fellGives: firewood, resin, fruit in season, a bees' nest...).
//     → { skill, amount, extra, rare: { item, qty }|null, gives: [{ item, qty }],
//         xp, tool: { item, name }|null, levelUps }
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
    axes: [],
    picks: [],
    xpPerHardness: 0,
    camps: {
        woodcutting: { types: ['logging_camp', 'lumber_mill', 'sawmill'], speed: 1.35, yield: 1.5, name: 'logging camp' },
        mining: { types: ['mine', 'quarry'], speed: 1.35, yield: 1.5, name: 'workings' },
    },
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

    /**
     * The best edge the player carries for it: an axe for a tree or stump, a
     * pick for rock (gathering.axes / picks, best first). → { item, name, mult } | null
     */
    toolFor(player, def) {
        const id = Gathering.skillFor(def);
        if (!id || !player || !player.inventory) return null;
        const list = (Gathering.config()[id === 'mining' ? 'picks' : 'axes']) || [];
        let best = null;
        for (const t of list) {
            if (!t || !t.item || !((player.inventory[t.item] || 0) > 0)) continue;
            const mult = _num(t.mult, 1);
            if (!best || mult > best.mult) best = { item: t.item, name: t.name || t.item, mult };
        }
        return best;
    },

    /**
     * A works of the player's standing finished on this hex for the skill — a
     * logging camp for trees, a mine or quarry for rock (gathering.camps).
     * tile: the world hex (InnerMap.currentWorldTile). → { type, name, speed, yield } | null
     */
    campBoost(player, def, tile) {
        const id = Gathering.skillFor(def);
        if (!id || !player || !tile) return null;
        const camp = ((Gathering.config().camps || {})[id]) || null;
        if (!camp || !Array.isArray(camp.types)) return null;
        const props = Array.isArray(tile.playerProperties) && tile.playerProperties.length ? tile.playerProperties : (tile.playerProperty ? [tile.playerProperty] : []);
        const p = props.find(x => x && camp.types.includes(x.type) && !x.underConstruction);
        if (!p) return null;
        return { type: p.type, name: p.name || camp.name || p.type, speed: _num(camp.speed, 1), yield: _num(camp.yield, 1) };
    },

    /** How much harder the player's blows land on it (1 = no skill to it): the skill, the tool, and a camp on the hex */
    damageMult(player, def, tile = null) {
        const id = Gathering.skillFor(def);
        if (!id || !player) return 1;
        const tool = Gathering.toolFor(player, def);
        const camp = Gathering.campBoost(player, def, tile);
        return (1 + PracticeSkills.perk(player, id, 'blows') / 100) * (tool ? tool.mult : 1) * (camp ? camp.speed : 1);
    },

    /**
     * What else comes of a felled tree or a grubbed stump besides its logs
     * (def.gives: { item, qty: [min, max], chance, seasons }), rolled now.
     * season: 'summer' etc. (fruit only in its season). → [{ item, qty }]
     */
    fellGives(def, season = null) {
        const out = [];
        const s = season ? String(season).toLowerCase() : null;
        for (const g of (def && Array.isArray(def.gives) ? def.gives : [])) {
            if (!g || !g.item) continue;
            if (Array.isArray(g.seasons) && (!s || !g.seasons.includes(s))) continue;
            if (g.chance != null && !(Utils.random() < _num(g.chance, 1))) continue;
            const [lo, hi] = Array.isArray(g.qty) ? g.qty : [1, 1];
            const qty = Utils.randInt(Math.max(1, lo), Math.max(lo, hi, 1));
            const same = out.find(o => o.item === g.item);
            if (same) same.qty += qty; else out.push({ item: g.item, qty });
        }
        return out;
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
     * world hex's terrain (for the rarer finds in rock). season: the map's
     * season, for the fruit a tree gives (fellGives).
     * → { skill, amount, extra, rare, gives, xp, tool, levelUps: [event] }
     */
    felled(player, def, resource, terrainId = null, season = null, tile = null) {
        const id = Gathering.skillFor(def);
        let base = Math.max(0, Math.round(_num(resource && resource.amount, 1)));
        const out = { skill: id, amount: base, extra: 0, rare: null, gives: [], xp: 0, tool: null, levelUps: [], camp: null, campExtra: 0 };
        if (!id || !player) return out;
        // A camp of yours on the hex: more from every tree or rock (campBoost)
        const camp = Gathering.campBoost(player, def, tile);
        if (camp && camp.yield > 1 && base > 0) {
            const boosted = Math.ceil(base * camp.yield);
            out.camp = { type: camp.type, name: camp.name };
            out.campExtra = boosted - base;
            base = boosted;
            out.amount = base;
        }
        const C = Gathering.config();
        const perkId = id === 'mining' ? 'stone' : 'logs';
        const chance = PracticeSkills.perk(player, id, perkId) / 100;
        if (chance > 0 && base > 0 && Utils.random() < chance) {
            out.extra = Math.max(1, Math.round(base * _num(C.extraShare, 0.4)));
            out.amount = base + out.extra;
        }
        if (id === 'mining') out.rare = Gathering.rollRare(player, terrainId);
        else out.gives = Gathering.fellGives(def, season);
        const tool = Gathering.toolFor(player, def);
        if (tool) out.tool = { item: tool.item, name: tool.name };
        const X = (PracticeSkills.def(id) || {}).xp || {};
        let xp = _num(id === 'mining' ? X.perBreak : X.perFell, 10) + base * _num(X.perAmount, 0);
        xp += Math.max(0, _num(def && def.resistance, 0)) * _num(C.xpPerHardness, 0);
        if (out.rare) xp += _num(X.rare, 0);
        out.xp = Math.round(xp * 10) / 10;
        const up = PracticeSkills.gain(player, id, xp);
        if (up) out.levelUps.push(up);
        return out;
    },
};

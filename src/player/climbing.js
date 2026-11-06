// ============================================
// CLIMBING — up and down the crags' rock faces
// ============================================
//
// Where the faces are is the map's business (world/innerMap/climbing.js);
// what a climb takes and how it goes is here, one face at a time. A practised
// skill (systems/practiceSkills.js; levels and perks in
// data/skillPacks/body.json → skills.climbing):
//
//   • reach(player): the tallest face (rows of rock) the player can climb;
//     hardship(world, worldTile): how many rows taller every face counts in
//     winter or snowy country; maxRows(...) the two together, for the map.
//   • canClimb(player, rows, ctx) → { ok, reason }: not too tall, not too
//     spent, not too laden.
//   • plan(player, { rows, down, world, worldTile }) → { duration, energy,
//     height, slip: null | { at (0..1 of the climb), fallRows, damage } }:
//     the time it takes (perk speed; down is quicker), the energy (less with
//     perk energySaved and Endurance), and whether they slip — the chance is
//     perk slip at a face at their reach, less on a shorter one. One RNG draw
//     (Utils, seeded) for the slip, one for where on the face.
//   • finish(player, plan) → { levelUp, enduranceUp, hurt, notices }:
//     the energy paid, a fall's hurt (perk breakFall), XP — more at the limit
//     of their reach, half for a fall — and a little Endurance.
//
// No globals: player, world and the tile are passed in.

import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { Seasons } from '../world/seasons.js';
import { Endurance } from './endurance.js';

const ID = 'climbing';

const DEFAULTS = {
    secondsPerRow: 1.6,
    energyPerRow: 2.5,
    downPace: 0.8,
    fallPerRow: 7,
    minEnergy: 8,
    ladenShare: 0.9,
    pathCost: 5,
    slipShape: 2,
    hardship: { seasons: ['Winter'], terrains: ['snow_peak', 'tundra', 'glacier', 'snow'], rows: 1 },
};

function _num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

export const Climbing = {
    ID,

    config() {
        const d = PracticeSkills.def(ID) || {};
        const c = d.climb || {};
        return { ...DEFAULTS, ...c, hardship: { ...DEFAULTS.hardship, ...(c.hardship || {}) } };
    },

    xpConfig() {
        const d = PracticeSkills.def(ID);
        return (d && d.xp) || {};
    },

    level(player) {
        return PracticeSkills.level(player, ID);
    },

    /** The tallest face (rows) the player can climb in fair weather */
    reach(player) {
        return Math.max(0, Math.round(PracticeSkills.perk(player, ID, 'reach')));
    },

    /** Rows every face counts taller here and now (winter, snowy country) */
    hardship(world, worldTile) {
        const H = Climbing.config().hardship;
        let season = world && world.season;
        if (!season && world) {
            const day = Seasons.today(world);
            if (Seasons._dated(day)) season = Seasons.seasonOf(day);
        }
        const terrain = worldTile && worldTile.terrain && worldTile.terrain.id;
        const cold = !!(season && (H.seasons || []).includes(season)) || !!(terrain && (H.terrains || []).includes(terrain));
        return cold ? Math.max(0, Math.round(_num(H.rows, 1))) : 0;
    },

    /** The tallest face (rows) the player can take on here and now */
    maxRows(player, world, worldTile) {
        return Math.max(0, Climbing.reach(player) - Climbing.hardship(world, worldTile));
    },

    /** The least Climbing level that reaches a face this tall here (null: none) */
    levelFor(rows, world, worldTile) {
        const need = rows + Climbing.hardship(world, worldTile);
        for (let L = 1; L <= PracticeSkills.maxLevel(); L++) {
            if (PracticeSkills.perkAt(ID, 'reach', L) >= need) return L;
        }
        return null;
    },

    /** May the player climb a face `rows` tall now? → { ok, reason } */
    canClimb(player, rows, { world = null, worldTile = null } = {}) {
        if (!player) return { ok: false, reason: 'No one to climb.' };
        const C = Climbing.config();
        const max = Climbing.maxRows(player, world, worldTile);
        if (rows > max) {
            const need = Climbing.levelFor(rows, world, worldTile);
            const hard = Climbing.hardship(world, worldTile) ? ' in this cold' : '';
            return { ok: false, reason: `This face is too tall for you to climb${hard}${need ? ` (Climbing ${need})` : ''}.` };
        }
        const energy = player.needs ? _num(player.needs.energy, 100) : 100;
        if (energy < C.minEnergy) return { ok: false, reason: 'You are too spent to climb. Rest first.' };
        const used = PlayerInventory.getUsedSlots(player), cap = PlayerInventory.getCapacity(player);
        if (cap > 0 && used / cap > C.ladenShare) return { ok: false, reason: `Your pack is too heavy to climb with (${used}/${cap}). Lighten it first.` };
        return { ok: true, reason: null };
    },

    /** The chance (0..1) of slipping on a face `rows` tall */
    slipChance(player, rows, world = null, worldTile = null) {
        const C = Climbing.config();
        const reach = Math.max(1, Climbing.reach(player));
        const eff = rows + Climbing.hardship(world, worldTile);
        const share = Math.max(0, Math.min(1, eff / reach));
        return Math.max(0, Math.min(0.95, PracticeSkills.perk(player, ID, 'slip') / 100 * Math.pow(share, _num(C.slipShape, 2))));
    },

    /** How a climb will go (draws the RNG for a slip) */
    plan(player, { rows = 2, down = false, world = null, worldTile = null } = {}) {
        const C = Climbing.config();
        const pace = _num(C.secondsPerRow, 1.6) / (1 + Math.max(0, PracticeSkills.perk(player, ID, 'speed')) / 100);
        const duration = rows * pace * (down ? _num(C.downPace, 0.8) : 1);
        const saved = Math.max(0, Math.min(0.9, PracticeSkills.perk(player, ID, 'energySaved') / 100));
        const energy = rows * _num(C.energyPerRow, 2.5) * (1 - saved) * Endurance.energyMult(player);
        const height = rows + Climbing.hardship(world, worldTile);
        const atLimit = height >= Climbing.reach(player);
        let slip = null;
        if (Utils.random() < Climbing.slipChance(player, rows, world, worldTile)) {
            const at = 0.25 + Utils.random() * 0.6;
            // how high they were when they came off: up the face, or still above its foot coming down
            const fallRows = Math.max(1, Math.round(rows * (down ? 1 - at : at)));
            const soften = Math.max(0, Math.min(0.9, PracticeSkills.perk(player, ID, 'breakFall') / 100));
            slip = { at, fallRows, damage: Math.max(1, Math.round(fallRows * _num(C.fallPerRow, 7) * (1 - soften))) };
        }
        return { rows, down, duration, energy, height, atLimit, slip };
    },

    /**
     * The climb is over (or they fell): pay its energy and hurt, earn XP.
     * → { levelUp, hurt, notices: [{ icon, title, text, type }] }
     */
    finish(player, plan) {
        const out = { levelUp: null, hurt: 0, notices: [] };
        if (!player || !plan) return out;
        const X = Climbing.xpConfig();
        const share = plan.slip ? plan.slip.at : 1;
        if (typeof player.modifyNeed === 'function') player.modifyNeed('energy', -plan.energy * share);
        let xp = plan.rows * _num(X.perRow, 2.5) * (plan.atLimit ? _num(X.limitMult, 1.6) : 1);
        if (plan.slip) {
            xp *= _num(X.slipMult, 0.5);
            out.hurt = plan.slip.damage;
            player.health = Math.max(0, _num(player.health, 100) - out.hurt);
            if (typeof player.modifyNeed === 'function') player.modifyNeed('comfort', -6);
            out.notices.push({ icon: '🤕', title: 'You Fell!', text: `Your hold gives and you drop ${plan.slip.fallRows} ${plan.slip.fallRows === 1 ? 'row' : 'rows'} of rock to the foot of the face (−${out.hurt} health).`, type: 'error' });
        }
        out.levelUp = PracticeSkills.gain(player, ID, xp);
        if (out.levelUp) out.notices.unshift({ icon: out.levelUp.icon, title: `${out.levelUp.name} Improved`, text: out.levelUp.text, type: 'success' });
        // The climb is hard work too
        const E = (PracticeSkills.def('endurance') || {}).xp || {};
        Endurance.train(player, plan.rows * share * _num(E.perClimbRow, 0.5));
        player.climbs = _num(player.climbs, 0) + (plan.slip ? 0 : 1);
        return out;
    },
};

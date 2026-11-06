// ============================================
// ENDURANCE — walking and working longer before tiring
// ============================================
//
// A practised skill (systems/practiceSkills.js; levels and perks in
// data/skillPacks/body.json) trained by the miles and the labour:
//
//   • walked(player, kind, n): XP for n tiles walked on an inner map
//     ('step') or n hexes travelled on the world map ('hex'; less mounted or
//     aboard ship: none).
//   • labour(player, energy): hard work — spends `energy` (less as the skill
//     rises) and is XP for what it cost you. → the energy actually spent.
//   • train(player, xp): XP from anything else (a climb, a swim).
//   • energyMult(player): the share of an energy cost still paid (perk
//     energySaved) — walking's hourly wear (player/core/needs.js), labour,
//     swimming and climbing.
//   • recoveryMult(player): more energy from a night's sleep (perk recovery).
//   • stride(player): more movement a day on the world map (perk stride).
//   • Carrying more (perk carry) is read by core/inventory.js getCapacity.
//
// A level-up is queued on player._skillUps for the UI to announce
// (ui/innerMapClimbing.js flushSkillUps), since the XP comes from all over.
// No randomness, no globals.

import { PracticeSkills } from '../systems/practiceSkills.js';

const ID = 'endurance';

function _num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

function _xpCfg() {
    const d = PracticeSkills.def(ID);
    return (d && d.xp) || {};
}

export const Endurance = {
    ID,

    /** Add XP; a level-up is queued for the UI (player._skillUps) and returned. */
    train(player, xp) {
        if (!player || !(xp > 0)) return null;
        const up = PracticeSkills.gain(player, ID, xp);
        if (up) Endurance.queue(player, up);
        return up;
    },

    /** Queue a level-up event for the UI to tell (unsaved). */
    queue(player, up) {
        PracticeSkills.queueUp(player, up);
    },

    /** Take the queued level-ups (empties the queue). */
    takeQueued(player) {
        if (!player || !Array.isArray(player._skillUps) || !player._skillUps.length) return [];
        return player._skillUps.splice(0);
    },

    /** Distance covered on foot: kind 'step' (an inner-map tile) or 'hex' (a world hex). */
    walked(player, kind = 'step', n = 1) {
        if (!player || !(n > 0) || player.boardedShip) return null;
        const X = _xpCfg();
        let xp = kind === 'hex' ? _num(X.perHex, 1.2) * n : _num(X.perStep, 0.04) * n;
        if (kind === 'hex' && player.mount) xp *= _num(X.mountedMult, 0.4);
        return Endurance.train(player, xp);
    },

    /** The share of an energy cost still paid, 0.1..1 */
    energyMult(player) {
        return PracticeSkills.energyMult(player);
    },

    /**
     * Hard work costing `energy` (a positive number): the cost, cut by the
     * skill, is taken from the player's energy and earns XP. → energy spent.
     */
    labour(player, energy) {
        return PracticeSkills.labour(player, energy);
    },

    /** Multiplier on energy restored by sleep */
    recoveryMult(player) {
        return 1 + PracticeSkills.perk(player, ID, 'recovery') / 100;
    },

    /** Extra movement a day on the world map */
    stride(player) {
        return Math.max(0, Math.round(PracticeSkills.perk(player, ID, 'stride')));
    },

    /** Extra pack slots */
    carry(player) {
        return Math.max(0, Math.round(PracticeSkills.perk(player, ID, 'carry')));
    },
};

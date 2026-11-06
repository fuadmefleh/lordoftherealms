// ============================================
// SWIMMING — the player in the water of an inner map
// ============================================
//
// Where the player may swim is the map's business (world/innerMap/swimming.js);
// what swimming does to them is here, a stroke (one tile of water) at a time:
//
//   • canSwim(player): not when too laden (a full pack drags you under) or
//     spent (no strength left to swim). → { ok, reason }.
//   • stroke(player, world, worldTile): each tile swum costs energy (less as
//     the Swimming skill rises: systems/practiceSkills.js, perk energySaved),
//     washes a little (a rough bath:
//     hygiene up to a cap, clothes soaked), and chills — a winter swim hurts.
//     Tired in deep water, the swimmer struggles; spent, they go under and
//     take hurt each stroke until they reach land. → { notices[], drowning,
//     cold, tired } for the game loop to tell.
//   • speedBonus(player): a better swimmer is a little faster (perk speed).
//   Each stroke is Swimming XP; a level-up comes back as a notice.
//
// Numbers in data/swimming.json; the skill's levels in data/practiceSkills.json.
// No randomness; player and world passed in.

import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { Seasons } from '../world/seasons.js';
import { PracticeSkills } from '../systems/practiceSkills.js';

const DEFAULTS = {
    pathCost: 3,
    speed: 0.45,
    energyPerStroke: 0.5,
    hygienePerStroke: 1.5,
    hygieneMax: 70,
    comfortPerStroke: -0.3,
    cold: { comfortPerStroke: -1.5, healthPerStroke: 1, seasons: ['Winter'] },
    tiredBelow: 15,
    spentBelow: 4,
    struggleHealth: 2,
    drownHealth: 6,
    ladenShare: 0.85,
    noticeEvery: 12,
};

function _num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

export const Swimming = {
    config() {
        const g = DataLoader._gamedata;
        const data = (g && g.swimming) || {};
        return { ...DEFAULTS, ...data, cold: { ...DEFAULTS.cold, ...(data.cold || {}) } };
    },

    /** How good a swimmer the player is, 0..1 (the Swimming level, from 1 to the top) */
    practice(player) {
        const max = PracticeSkills.maxLevel();
        return max > 1 ? (PracticeSkills.level(player, 'swimming') - 1) / (max - 1) : 0;
    },

    /** The skill's share of a stroke's energy saved, 0..1 */
    energySaved(player) {
        return Math.max(0, Math.min(0.9, PracticeSkills.perk(player, 'swimming', 'energySaved') / 100));
    },

    /** A better swimmer is faster: a multiplier on the stroke speed */
    speedBonus(player) {
        return 1 + PracticeSkills.perk(player, 'swimming', 'speed') / 100;
    },

    /** May the player take to the water now? → { ok, reason } */
    canSwim(player) {
        if (!player) return { ok: false, reason: 'No one to swim.' };
        const C = Swimming.config();
        const used = PlayerInventory.getUsedSlots(player);
        const cap = PlayerInventory.getCapacity(player);
        if (cap > 0 && used / cap > C.ladenShare) return { ok: false, reason: `Your pack is too heavy to swim with (${used}/${cap}). Lighten it first.` };
        const energy = player.needs ? _num(player.needs.energy, 100) : 100;
        if (energy < C.spentBelow) return { ok: false, reason: 'You are too spent to swim. Rest first.' };
        return { ok: true, reason: null };
    },

    /** Is the water here cold enough to hurt (winter, or a cold hex)? */
    isCold(world, worldTile) {
        const C = Swimming.config();
        const season = world && world.season;
        if (season && (C.cold.seasons || []).includes(season)) return true;
        return !!(worldTile && Seasons.isColdTile(worldTile, world));
    },

    /**
     * One tile swum. `deep`: water the player can't stand in (the map says);
     * the shallows are wading, and cost nothing here.
     * → { notices, drowning, struggling, cold, levelUp? }
     */
    stroke(player, world, worldTile, { deep = true } = {}) {
        const out = { notices: [], drowning: false, struggling: false, cold: false };
        if (!player || !deep) return out;
        const C = Swimming.config();
        const saved = Swimming.energySaved(player);
        const sk = PracticeSkills.def('swimming');
        const up = PracticeSkills.gain(player, 'swimming', _num(sk && sk.xp && sk.xp.perStroke, 0.5));
        if (up) out.levelUp = up;
        player.swimStrokes = _num(player.swimStrokes, 0) + 1;
        const n = player.swimStrokes;
        const every = Math.max(1, C.noticeEvery | 0);
        if (typeof player.modifyNeed === 'function' && player.needs) {
            player.modifyNeed('energy', -C.energyPerStroke * (1 - saved));
            // A rough wash: the water cleans you some way, and soaks your clothes
            if (_num(player.needs.hygiene, 100) < C.hygieneMax) player.modifyNeed('hygiene', Math.min(C.hygienePerStroke, C.hygieneMax - player.needs.hygiene));
            player.modifyNeed('comfort', C.comfortPerStroke);
        }
        if (n === 1) out.notices.push({ icon: '🏊', title: 'Into the Water', text: 'You wade out and swim. It is slow going, and tiring; a full pack would drag you under.', type: 'info' });
        if (up) out.notices.unshift({ icon: up.icon, title: `${up.name} Improved`, text: up.text, type: 'success' });
        // The cold
        if (Swimming.isCold(world, worldTile)) {
            out.cold = true;
            if (typeof player.modifyNeed === 'function') player.modifyNeed('comfort', C.cold.comfortPerStroke);
            player.health = Math.max(0, _num(player.health, 100) - C.cold.healthPerStroke);
            if (n % every === 1) out.notices.push({ icon: '🥶', title: 'Freezing Water', text: 'The cold bites to the bone. Get out of the water before it takes you.', type: 'warning' });
        }
        // Tired, then spent: struggling, then going under
        const energy = player.needs ? _num(player.needs.energy, 100) : 100;
        if (energy < C.spentBelow) {
            out.drowning = true;
            player.health = Math.max(0, _num(player.health, 100) - C.drownHealth);
            out.notices.push({ icon: '🌊', title: 'Going Under!', text: 'Your arms will not lift. You swallow water — get to land, now!', type: 'error' });
        } else if (energy < C.tiredBelow) {
            out.struggling = true;
            player.health = Math.max(0, _num(player.health, 100) - C.struggleHealth);
            if (n % every === 1 || !player._swimTiredWarned) {
                player._swimTiredWarned = true;
                out.notices.push({ icon: '😮‍💨', title: 'Struggling', text: 'You are tiring in the water. Make for the shore.', type: 'warning' });
            }
        } else {
            player._swimTiredWarned = false;
        }
        return out;
    },

    /** Back on dry land: the count of strokes starts again for the next swim. */
    ashore(player) {
        if (!player || !player.swimStrokes) return null;
        const strokes = player.swimStrokes;
        player.swimStrokes = 0;
        player._swimTiredWarned = false;
        return strokes;
    },
};

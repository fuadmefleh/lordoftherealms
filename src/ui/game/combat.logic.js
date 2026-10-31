// ============================================
// COMBAT LOGIC (pure) — hostile-encounter resolution
// ============================================
//
// The automatic resolution of a hostile encounter (robbed / mauled / a
// one-shot battle). It now lives in the player layer as
// RoadEncounters.ambush (player/roadEncounters.js), next to the choices the
// encounter dialog offers (flee, toll, parley, hide, fight). This module keeps
// the old entry point for the headless paths and their tests: the playtest
// harness resolves every encounter with it, so the soak's dice are unchanged.

import { RoadEncounters } from '../../player/roadEncounters.js';

/**
 * Resolve a hostile encounter between the player and an adjacent attacker unit
 * automatically. Mutates player/attacker/world in place.
 *
 * @returns {{kind:'robbed'|'victory'|'defeat',
 *            notification:{title:string, body:string, type:string},
 *            goldStolen?:number, healthLost?:number, stolenItems?:object,
 *            result?:object}}
 */
export function resolveHostileEncounter(player, attacker, world) {
    return RoadEncounters.ambush(player, attacker, world);
}

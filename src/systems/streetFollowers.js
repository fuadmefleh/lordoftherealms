// ============================================
// STREET FOLLOWERS — who walks with you on the street map
// ============================================
// The whole party can go about town with the player — the travelling
// companions (systems/companions.js), the realm's household guard
// (player/realmEscort.js) and the animals (systems/animalCompanions.js) —
// or wait (at the inn, the camp, the edge of town) while the player walks
// the streets alone. The choice is the player's, one key each:
//
//   'npc:<id>'      a travelling companion
//   'guard'         the household guard, all its companies
//   'animal:<id>'   one of your animals ('animal:mount' the horse)
//
// player.walkWith = { [key]: false } (saved: systems/saveLoad.js); a key not
// there walks (the default: everyone walks, as before). Read by
// ui/innerMapCompanions.js, ui/innerMapEscort.js and ui/innerMapPets.js;
// set from ui/animalsPanel.js (Who Walks With You) and a pet's own menu.

export const StreetFollowers = {
    GUARD: 'guard',

    npcKey(id) { return `npc:${id}`; },
    animalKey(id) { return `animal:${id}`; },

    /** The player's choices (created when missing). */
    state(player) {
        if (!player) return {};
        if (!player.walkWith || typeof player.walkWith !== 'object' || Array.isArray(player.walkWith)) player.walkWith = {};
        return player.walkWith;
    },

    /** Does this one walk with you on the street map? (yes unless told to wait) */
    walks(player, key) {
        const w = player && player.walkWith;
        return !(w && typeof w === 'object' && w[key] === false);
    },

    /** Walk with you (on) or wait (off). → the new value */
    set(player, key, on) {
        if (!player || !key) return true;
        const st = StreetFollowers.state(player);
        if (on) delete st[key];
        else st[key] = false;
        return !!on;
    },

    toggle(player, key) {
        return StreetFollowers.set(player, key, !StreetFollowers.walks(player, key));
    },

    /** Forget a choice for someone gone for good. */
    forget(player, key) {
        const w = player && player.walkWith;
        if (w && typeof w === 'object') delete w[key];
    },
};

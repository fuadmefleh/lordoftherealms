// Is this piece of furniture any use? — the one rule the player (player/furnitureActions.js
// usable) and the townsfolk indoors (world/innerMap/furnitureUse.js, townWork.js,
// householdRooms.js, floors.js) both go by.
//
// A piece broken in a raid or a fire (tile._furniture.broken: world/innerMap/interiorState.js)
// is no bed, seat, hearth, table or bench any more. What may still be done with one is a
// list of uses: the player's (data/furnitureActions.json broken.allow — looked into, emptied,
// prayed at) or the townsfolk's (NPC_BROKEN_OK: a chest or a crate rummaged, an altar prayed
// at). Pure; no state.

/** The pieces a townsperson still goes to broken (by furniture type). */
export const NPC_BROKEN_OK = ['chest', 'crate', 'altar', 'statue', 'shelf', 'cupboard'];

/**
 * May `furniture` be used for `use`? Unbroken: always. Broken: only for a use in `allow`.
 * @param {object|null} furniture  tile._furniture
 * @param {string|null} use        the use (a player's action key, or an NPC's furniture type)
 * @param {string[]} allow         the uses a broken piece still serves
 */
export function pieceUsable(furniture, use = null, allow = []) {
    if (!furniture || !furniture.broken) return true;
    return use != null && Array.isArray(allow) && allow.includes(use);
}

/** May a townsperson use this piece (by its type)? */
export function npcCanUse(furniture) {
    return pieceUsable(furniture, furniture && furniture.type, NPC_BROKEN_OK);
}

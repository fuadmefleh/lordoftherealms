// InnerMap — swimming: the player may take to the water (ponds, lakes,
// rivers, the sea) where they could not walk. Only the player: townsfolk,
// crew and beasts keep to the land (their paths never ask to swim).
//
//   • isSwimmable(q, r): water a body can swim in — not frozen, not under a
//     hull, a deck, a pier or a bridge.
//   • _playerMayEnter(tile): walkable, or swimmable while swimming is allowed
//     (InnerMap._swimAllowed, set each frame by the game loop from the
//     player's state: player/swimming.js decides).
//   • A stroke is slower than a step (swimming.speed), and a path counts
//     each water tile dearer (swimming.pathCost), so a walk round is taken
//     when it isn't much longer.
//
// What swimming does to the swimmer (tiredness, the cold, a wash, going
// under) is player/swimming.js, applied by the game loop on each stroke.

import { InnerMap } from './_ref.js';
import { DataLoader } from './_imports.js';

const DEFAULTS = { pathCost: 3, speed: 0.45 };

Object.assign(InnerMap, {
    _swimAllowed: true,
    _swimRefusal: null,

    swimConfig() {
        const g = DataLoader._gamedata;
        return { ...DEFAULTS, ...((g && g.swimming) || {}) };
    },

    /** Is (q, r) water the player could swim in? */
    isSwimmable(q, r) {
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        if (!t || this._insideBuilding) return false;
        if (t._deck || t._pier || t.isRoad || t.customObject || t.customObjectPart || t.building) return false;
        const id = (t.subTerrain && t.subTerrain.id) || '';
        if (/frozen|ice/.test(id)) return false;
        return !!(t._wet || t._sea || /_water$/.test(id));
    },

    /** May the player step onto this tile: dry land, or water they can swim in. */
    _playerMayEnter(tile, q, r) {
        if (!tile) return false;
        if (tile.subTerrain && tile.subTerrain.passable) return true;
        return !!(this._swimAllowed && this.isSwimmable(q, r));
    },

    /** Is the player in the water (not wading the shallows: in water they can't stand in)? */
    isPlayerSwimming() {
        const q = this.playerInnerQ, r = this.playerInnerR;
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        return !!(t && !(t.subTerrain && t.subTerrain.passable) && this.isSwimmable(q, r));
    },
});

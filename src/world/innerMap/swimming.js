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
//   • Under the water (InnerMap._underwater, set by ui/innerMapDiving.js):
//     the player keeps to water they can't stand in (isDivable) — no land,
//     no shallows — at _underwaterSpeed of a stroke.
//
// What swimming does to the swimmer (tiredness, the cold, a wash, going
// under) is player/swimming.js, applied by the game loop on each stroke.

import { InnerMap } from './_ref.js';
import { DataLoader } from './_imports.js';

const DEFAULTS = { pathCost: 3, speed: 0.45 };

Object.assign(InnerMap, {
    _swimAllowed: true,
    _swimRefusal: null,
    _underwater: false,
    _underwaterSpeed: 0.75,

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

    /** Water deep enough to go under in: swimmable, and not shallows you stand in. */
    isDivable(q, r) {
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        return !!(t && t.subTerrain && !t.subTerrain.passable && this.isSwimmable(q, r));
    },

    /** May the player step onto this tile: dry land, or water they can swim in (under the water: only that). */
    _playerMayEnter(tile, q, r) {
        if (!tile) return false;
        if (this._underwater) return this.isDivable(q, r);
        // Up on a crag, or below one: only ground at your own height (world/innerMap/climbing.js)
        const lv = this.standLevel(tile), mine = this.playerLevel();
        if (lv !== 0 || mine !== 0) return lv === mine;
        if (tile.subTerrain && tile.subTerrain.passable) return true;
        // A shut gate: walking into it opens it (world/innerMap/gates.js)
        if (this._isShutGateTile && this._isShutGateTile(tile)) return true;
        return !!(this._swimAllowed && this.isSwimmable(q, r));
    },

    /** Is the player in the water (not wading the shallows: in water they can't stand in)? */
    isPlayerSwimming() {
        const q = this.playerInnerQ, r = this.playerInnerR;
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        return !!(t && !(t.subTerrain && t.subTerrain.passable) && this.isSwimmable(q, r));
    },
});

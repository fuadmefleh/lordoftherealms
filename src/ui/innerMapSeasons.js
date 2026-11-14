// ============================================
// The season on the street map — the game loop's side
// ============================================
// Once a frame on the street map (ui/game/gameLoop.js):
//   - a new day while the player is on the map lays its season again
//     (world/innerMap/streetSeasons.js _bindStreetSeason: the ice, the going,
//     the fair's stalls or the bonfire, the snowmen);
//   - when the ice has changed (frozen over, thawed, broken through) the water's
//     surf and flow are laid out afresh (innerMapLayers/waterFx.js);
//   - the player is told: thin ice groaning underfoot, the ice giving way, the
//     harvest fair or the midwinter fire on in the town, the water frozen hard,
//     the ground gone to mud.
// Data: data/streetSeasons.json `notices`.

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { StreetSeasons } from '../world/streetSeasons.js';

function _note(game, key, vars = {}, type = 'info') {
    const N = StreetSeasons.config().notices || {};
    const n = N[key];
    if (!n || !game || !game.ui || typeof game.ui.showNotification !== 'function') return;
    const fill = s => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    game.ui.showNotification(fill(n[0]), fill(n[1]), type);
}

export const InnerMapSeasons = {
    _stamp: null,
    _tiles: null,
    _told: new Set(),

    update(game) {
        if (!InnerMap.active || !game || !game.world || !InnerMap._bindStreetSeason) return;
        const at = InnerMap.currentWorldTile;
        // A new day on this map: its season laid again (not while indoors: the street's tiles are put by)
        if (at && !InnerMap._insideBuilding && Number.isFinite(InnerMap.worldDay) && InnerMap._ssDay !== InnerMap.worldDay) {
            InnerMap._bindStreetSeason(game.world, game.world.getTile(at.q, at.r), at.q, at.r);
        }
        // The ice changed: the water's play laid out again
        const stamp = InnerMap._waterStamp || 0;
        if (stamp !== this._stamp || InnerMap.tiles !== this._tiles) {
            this._stamp = stamp;
            this._tiles = InnerMap.tiles;
            InnerMapRenderer._waterFxCache = null;
        }
        // Underfoot
        const ev = InnerMap._ssEvent;
        if (ev) {
            InnerMap._ssEvent = null;
            if (ev.kind === 'crack') _note(game, 'crack', {}, 'warning');
            else if (ev.kind === 'thin') _note(game, 'thinIce', {}, 'warning');
        }
        this._tell(game);
    },

    /** What the town and the ground are doing today, told once a day a map. */
    _tell(game) {
        const ss = InnerMap._ss;
        const at = InnerMap.currentWorldTile;
        if (!ss || !at || InnerMap._insideBuilding) return;
        const base = `${at.q},${at.r}|${ss.day}`;
        const once = (k) => { const key = `${base}|${k}`; if (this._told.has(key)) return false; this._told.add(key); return true; };
        if (this._told.size > 400) this._told.clear();
        const town = (InnerMap._ssSettlement && InnerMap._ssSettlement.name) || 'The town';
        const fest = InnerMap._ssFair;
        if (fest && fest.kind === 'fair' && once('fair')) _note(game, 'fair', { town });
        if (fest && fest.kind === 'midwinter' && once('midwinter')) _note(game, 'midwinter', { town });
        if (ss.solidCells > 0 && once('frozen')) _note(game, 'frozen');
        if (ss.mudShow >= 0.45 && once('mud')) _note(game, 'mud');
    },
};

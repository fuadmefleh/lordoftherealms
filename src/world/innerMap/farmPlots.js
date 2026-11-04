// ============================================
// InnerMap — the player's tilled fields, laid back on the map
// ============================================
// Tilled ground and what is sown on it are kept on the player, by hex
// (player.farmPlots, systems/crops.js), because inner maps are regenerated:
// the cache is cleared, a save brings back a map drawn afresh, a village
// grows into a town. Whenever a hex's map is entered (interiors.enter) every
// tilled cell of that hex turns back into tilled soil; a cell whose ground is
// gone (built over, a street through it, under water) is let go.

import { InnerMap } from './_ref.js';

export const TILLED_SOIL = { id: 'tilled_soil', name: 'Tilled Soil', icon: '🌾', color: '#8b7355', passable: true };

Object.assign(InnerMap, {
    /** Turn a tile into tilled soil (the grass stripped; call _refreshGrassLayer after). */
    setTilled(tile) {
        if (!tile) return;
        tile.baseTerrain = 'dirt';
        tile.subTerrain = { ...TILLED_SOIL };
        tile._tilled = true;
        tile._cachedFill = null;
        tile._cachedOverlay = undefined;
        tile.terrainDetail = null;
    },

    /** Can this tile still carry the player's field? */
    _farmCellFits(tile) {
        if (!tile || tile._isInterior) return false;
        if (tile.isRoad || tile.building || tile.customBuilding || tile.customObject || tile.customObjectPart || tile._doorMarker) return false;
        if (tile._dug && tile._dug.kind !== 'filled') return false;
        if (tile.subTerrain && tile.subTerrain.id === 'tilled_soil') return true;
        return !!(tile.subTerrain && tile.subTerrain.passable) && !tile._wet && !tile._sea;
    },

    /**
     * Lay the player's tilled cells of the current hex back onto its map.
     * @returns {number} cells laid
     */
    applyFarmPlots(player) {
        // (whose fields the renderer draws on this map: ui/innerMapFarming.js)
        this._farmOwner = player || null;
        const wt = this.currentWorldTile;
        if (!player || !player.farmPlots || !wt || !this.tiles || this._insideBuilding) return 0;
        const plot = player.farmPlots[`${wt.q},${wt.r}`];
        if (!plot || !plot.cells) return 0;
        let laid = 0, changed = false;
        for (const key of Object.keys(plot.cells)) {
            const [q, r] = key.split(',').map(Number);
            const tile = this.getTile(q, r);
            if (!this._farmCellFits(tile)) {
                delete plot.cells[key];
                continue;
            }
            laid++;
            if (tile.subTerrain && tile.subTerrain.id === 'tilled_soil' && tile._tilled) continue;
            this.setTilled(tile);
            changed = true;
        }
        if (!Object.keys(plot.cells).length) delete player.farmPlots[`${wt.q},${wt.r}`];
        if (changed) this._refreshGrassLayer(this.tiles);
        return laid;
    },
});

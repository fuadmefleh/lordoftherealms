// InnerMapRenderer — caves and mines underground (mixed in via Object.assign).
//
// An underground tile (world/innerMap/mines.js: tile._cave) is drawn from the
// cave sheet (ui/caveArt.js: the cells by the tile and its neighbours — the
// floor, the rock's face where open ground meets it from below, the rock's top
// rimmed where open ground meets it, ore in a face, rubble, loose stones,
// crystal, timbers, the way out). _renderInteriorTile (terrainRoads.js) hands
// such a tile here first. The cells are worked out once per change of the
// underground (InnerMap._caveStamp) and kept on the tile: no allocation a frame.
//
// drawCaveCell(): one cell of the sheet anywhere (the drifts and shafts on the
// street map: ui/innerMapMining.js).

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { caveCells, CAVE_SHEET, CAVE_BASE_WIDTH } from '../caveArt.js';

const _at = (q, r) => InnerMap.getTile(q, r);

Object.assign(InnerMapRenderer, {
    /** The cave sheet, once loaded, and its cell scale. → { img, k } | null */
    _caveSheet() {
        const img = this._getSheetByPath(CAVE_SHEET);
        if (!img) return null;
        const w = img.naturalWidth || img.width || 0;
        if (!w) return null;
        return { img, k: w / CAVE_BASE_WIDTH };
    },

    /** Draw an underground tile. True when drawn (always, once it is a cave tile). */
    _renderCaveTile(ctx, tile, dx, dy, sz) {
        const sheet = this._caveSheet();
        if (!sheet) {
            ctx.fillStyle = tile._cave === 'rock' ? '#1c1510' : '#4a3a28';
            ctx.fillRect(dx, dy, sz, sz);
            return true;
        }
        const stamp = InnerMap._caveStamp || 0;
        if (tile._caveArtStamp !== stamp || !tile._caveArt) {
            const u = InnerMap._insideBuilding && InnerMap._insideBuilding._underground;
            tile._caveArt = caveCells(_at, tile.q, tile.r, u ? u.kind : 'cave');
            tile._caveArtStamp = stamp;
        }
        const { img, k } = sheet;
        const cells = tile._caveArt;
        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            ctx.drawImage(img, c[0] * 32 * k, c[1] * 32 * k, 32 * k, 32 * k, dx, dy, sz, sz);
        }
        return true;
    },

    /** One cell [col, row] of the cave sheet at (dx, dy), sz square. False while the sheet loads. */
    drawCaveCell(ctx, cell, dx, dy, sz) {
        const sheet = cell && this._caveSheet();
        if (!sheet) return false;
        const { img, k } = sheet;
        ctx.drawImage(img, cell[0] * 32 * k, cell[1] * 32 * k, 32 * k, 32 * k, dx, dy, sz, sz);
        return true;
    },
});

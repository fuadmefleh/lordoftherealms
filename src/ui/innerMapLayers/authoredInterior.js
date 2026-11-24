// InnerMapRenderer — the dressing of a hand-authored interior (interior_editor.html; its tiles
// carry _customTile sprite cells: terrainRoads.js _renderCustomInteriorTile) and of a planned
// one laid with nine-tile brush sprites. What the planned rooms have, drawn over the sprites
// as ui/interiorDress.js draws it in a drawn room (world/innerMap/authoredInterior.js lays it):
//   inner walls (tile._innerWall) with no wall sprite painted: the game's own drawn wall
//   in the building's inside wall (tile._wallMaterial), over the cell's floor sprite
//   a typed piece (tile._furniture) with no sprite of its own: its interiorArt furniture
//   what lies on things (tile._decor) and hangs on walls (tile._wallDecor, _wallDecorFace),
//   windows shuttered and candles and torches lit as the hour's layer says
//   (world/innerMap/interiorState.js) — the light itself is ui/interiorLight.js, as indoors anywhere
// (mixed in via Object.assign)
import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { CAP, EXT, asIds, daylight, drawWallDecor, drawTableDecor, drawColdFire } from '../interiorDress.js';

/**
 * Where a sprite wall's face is, for what hangs on it (drawWallDecor's face): by the side its
 * room lies (tile._wallDecorFace). r: the tile's row (the back wall at 0 rises above the map).
 */
export function authoredFaceBox(dir, dx, dy, sz, r = 1) {
    const c = Math.max(2, Math.round(sz * CAP));
    const floor = dy + sz;
    if (dir === 'right') return { x: dx + sz - c, y: dy, w: c, h: sz, floor, kind: 'left' };
    if (dir === 'left') return { x: dx, y: dy, w: c, h: sz, floor, kind: 'right' };
    if (dir === 'up') return { x: dx, y: dy + c, w: sz, h: sz - c, floor, kind: 'front' };
    if (dir === 'down' || !dir) {
        if (r === 0) { const e = Math.round(sz * EXT * 0.5); return { x: dx, y: dy - e, w: sz, h: sz + e, floor, kind: 'back' }; }
        return { x: dx, y: dy + c, w: sz, h: sz - c, floor, kind: 'inner' };
    }
    return null;
}

Object.assign(InnerMapRenderer, {
    /**
     * A drawn inner wall on an authored tile with no wall sprite. floor(): draws the cell's floor
     * under it. → { face } when drawn, null when there's no art for it yet.
     */
    _authoredInnerWall(ctx, tile, dx, dy, sz, floor) {
        const art = this._interiorArt;
        const mat = art && art.walls && (art.walls[tile._wallMaterial] || art.walls[art.defaultWall]);
        const img = mat && this._getSheetByPath(mat.sheet);
        if (!img) return null;
        const face = this._drawWallTile(ctx, tile, mat, img, this._sheetScale(img), dx, dy, sz, floor);
        return { face: face || null };
    },

    /**
     * A typed piece with no sprite (the editor's furniture meta): its interiorArt look, on its
     * tile at its own scale, a hearth let die cold. → its drawn box (and art) or null.
     */
    _authoredFurniture(ctx, tile, dx, dy, sz) {
        const f = tile._furniture;
        const art = this._interiorArt;
        if (!f || !art || !art.furniture) return null;
        const A = art.furniture;
        const fa = (f.art && A[f.art]) || (f.lit === false && A[`${f.type}_unlit`]) || (f.facing === 'up' && A[`${f.type}_back`]) || A[f.type];
        const img = fa && this._getSheetByPath(fa.sheet);
        if (!img) return null;
        const k = this._sheetScale(img);
        const grid = fa.grid || 48;
        const sw = fa.sw || 32, sh = fa.sh || 32;
        const dw = sw * sz / grid, dh = sh * sz / grid;
        const box = { x: Math.round(dx + (sz - dw) / 2), y: Math.round(dy + sz - dh), w: Math.round(dw), h: Math.round(dh) };
        if (!fa.flat) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
            ctx.beginPath();
            ctx.ellipse(dx + sz / 2, dy + sz * 0.9, sz * 0.38, sz * 0.09, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.drawImage(img, fa.sx * k, fa.sy * k, sw * k, sh * k, box.x, box.y, box.w, box.h);
        if (fa.fire && f.lit === false) drawColdFire(ctx, box, fa.fire, sz, ((tile.q * 73856093) ^ (tile.r * 19349663)) >>> 0);
        return { box, art: fa };
    },

    /**
     * What lies on an authored tile and what hangs on it (wall decor after the row, as a drawn
     * room's: a painting may reach over the next tile). face: a drawn wall's own, else worked out.
     * piece: the drawn furniture's { box, art } (what lies on it rests on its top).
     */
    _authoredDecor(ctx, tile, dx, dy, sz, face = null, piece = null) {
        const art = this._interiorArt;
        if (!art) return;
        const getImg = (p) => this._getSheetByPath(p);
        const scale = (img) => this._sheetScale(img);
        const night = !!tile._cellar || daylight(InnerMap.timeOfDay) < 0.35;
        if (tile._wallDecor && art.wallDecor && tile.baseTerrain === 'wall' && !tile._doorway) {
            const fc = face || authoredFaceBox(tile._wallDecorFace, dx, dy, sz, tile.r);
            if (fc) this._interiorAfterRow.push(() => drawWallDecor(ctx, art.wallDecor, tile, fc, sz, getImg, scale, night));
        }
        const ids = asIds(tile._decor);
        if (ids.length && art.decor && tile.baseTerrain !== 'wall') {
            // (candles burn when lit — tile._decorLit — or after dark when nobody says: as ui/interiorLight.js)
            const lit = tile._decorLit === true || (tile._decorLit == null && night);
            const shown = lit ? ids : ids.map(id => ((id === 'candles' || id === 'candle') && art.decor.candles_unlit ? 'candles_unlit' : id));
            const hash = ((tile.q * 73856093) ^ (tile.r * 19349663)) >>> 0;
            // (on a piece: along its top; on the bare floor: at the tile's foot)
            const box = piece ? piece.box : { x: dx, y: dy, w: sz, h: sz };
            const top = piece ? piece.art.top : tile._furniture ? null : [0.18, 0.55, 0.82, 0.98];
            drawTableDecor(ctx, art.decor, shown, box, top, sz, getImg, scale, hash);
        }
    },
});

// Sheets drawn at more than the LPC grid's 32px a cell.
//
// Map code addresses a sheet's cells in 32px units (sx = col * 32 …). A sheet
// repainted at higher resolution in the same layout — the terrain sheets, the
// tilled soil, the wheat — is drawn from the same addresses scaled by the
// factor its width bears to the original's. The originals' widths are listed in
// data/innerMapRenderer.json `hiResSheets` (path -> width in px); every
// terrain_<season>.png is a 512px LPC sheet; the painted detail sheets under
// assets/modern/ take their original's width from `modernSheets`. Any other sheet: 1.
//
//   const k = sheetScale(img);
//   ctx.drawImage(img, sx * k, sy * k, sw * k, sh * k, dx, dy, dw, dh);

import { DataLoader } from '../core/dataLoader.js';
import { modernBaseWidth } from '../core/customSheets.js';

const TERRAIN = /Terrain\/terrain_[a-z_]+\.png/;

function _baseWidth(src) {
    const g = DataLoader._gamedata;
    const list = (g && g.innerMapRenderer && g.innerMapRenderer.hiResSheets) || {};
    let path = src;
    try { path = decodeURI(src); } catch { /* keep it as it is */ }
    const modern = modernBaseWidth(path, g);   // (a painted detail sheet: `modernSheets`)
    if (modern) return modern;
    for (const [p, w] of Object.entries(list)) {
        if (p.startsWith('_')) continue;
        if (path.includes(p)) return Number(w) || 0;
    }
    return TERRAIN.test(path) ? 512 : 0;
}

/** The factor a sheet's 32px cell addresses are scaled by (1 for an ordinary sheet). Cached on the image. */
export function sheetScale(img) {
    if (!img) return 1;
    if (img._cellScale !== undefined) return img._cellScale;
    const w = img.naturalWidth || img.width || 0;
    if (!w) return 1;   // (not loaded yet: ask again next frame)
    const base = _baseWidth(String(img.src || img.currentSrc || ''));
    img._cellScale = base && w > base && w % base === 0 ? w / base : 1;
    return img._cellScale;
}

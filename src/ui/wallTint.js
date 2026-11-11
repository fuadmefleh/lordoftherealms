// The inside wall in the outside wall's own colour.
//
// A building's interior walls are drawn from the interior art (data/innerMapRenderer.json
// interiorArt.walls); its outside walls from the building kit, each kit in its own colour
// (data/architecture.json wealth.wallColours: beige ashlar, pale or earthy mud brick, grey
// or brown planks). An interior wall tile carries that colour (tile._wallTint, set by
// world/innerMap/interiors.js); here the material's cells of its sheet (the face, the
// body and the top) are recoloured to it: each pixel keeps its brightness against the
// wall face's mean (the texture's pattern; the top keeps its shade against the face) and takes the colour, `strength` of the way
// (wealth.wallTint.strength). One recoloured copy of the sheet per material and colour,
// made the first time it is drawn and kept.

import { DataLoader } from '../core/dataLoader.js';

const _cache = new WeakMap();   // sheet image -> Map(key -> canvas | null)

function _hex(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The rectangles (sheet px at scale k) of a material's cells: its face, body and top */
function _regions(mat, k) {
    const w = (mat.tw || 32), h = (mat.th || 32);
    const out = [[mat.sx, mat.sy, w, mat.tw ? h : 32]];
    if (mat.face) out.push([mat.face.sx, mat.face.sy, mat.face.tw || w, 32]);
    if (mat.top) out.push([mat.top.sx, mat.top.sy, w, h]);
    return out.map(([x, y, rw, rh]) => [Math.round(x * k), Math.round(y * k), Math.round(rw * k), Math.round(rh * k)]);
}

/**
 * The sheet with this material's cells in colour `hex`, or the sheet itself where that
 * can't be done (no canvas, an unknown colour, a sheet not yet loaded).
 */
export function tintedWallSheet(img, mat, hex, k = 1) {
    const target = _hex(hex);
    if (!img || !mat || !target || typeof document === 'undefined' || !img.width) return img;
    let per = _cache.get(img);
    if (!per) { per = new Map(); _cache.set(img, per); }
    const key = `${mat.sx},${mat.sy}|${hex}`;
    if (per.has(key)) return per.get(key) || img;
    const T = ((DataLoader._gamedata && DataLoader._gamedata.architecture && DataLoader._gamedata.architecture.wealth) || {}).wallTint || {};
    const strength = Math.max(0, Math.min(1, Number.isFinite(T.strength) ? T.strength : 0.85));
    let canvas = null;
    try {
        canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const all = _regions(mat, k);
        if (all.some(([x, y, w, h]) => !(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= img.width && y + h <= img.height))) throw new Error('cells off the sheet');
        const regions = all;
        const datas = regions.map(([x, y, w, h]) => ctx.getImageData(x, y, w, h));
        // the brightness of the wall's face (the face cells, else the body): the face comes out in
        // the outside wall's colour, the top keeps its own shade against it
        const faceAt = mat.face ? 1 : 0;
        // (its body: the dark beams, posts and shadow lines a face is framed by are left out of
        // the mean, as an outside wall's colour is its body's)
        const lums = [];
        for (const d of datas.slice(faceAt, faceAt + 1)) {
            const p = d.data;
            for (let i = 0; i < p.length; i += 4) if (p[i + 3]) lums.push(p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114);
        }
        const sorted = [...lums].sort((a, b) => a - b);
        const median = sorted.length ? sorted[sorted.length >> 1] : 128;
        const body = lums.filter(l => l >= median * 0.6);
        const mean = body.length ? Math.max(1, body.reduce((a, b) => a + b, 0) / body.length) : 128;
        datas.forEach((d, j) => {
            const p = d.data;
            for (let i = 0; i < p.length; i += 4) {
                if (!p[i + 3]) continue;
                const rel = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) / mean;
                for (let c = 0; c < 3; c++) p[i + c] = Math.max(0, Math.min(255, Math.round(p[i + c] * (1 - strength) + target[c] * rel * strength)));
            }
            ctx.putImageData(d, regions[j][0], regions[j][1]);
        });
    } catch {
        canvas = null;   // (a tainted or unreadable sheet: drawn as it is)
    }
    per.set(key, canvas);
    return canvas || img;
}

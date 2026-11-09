// ============================================================
// BARE BUSHES — how a bush looks once it has been picked
// ============================================================
// A bush a town herbalist has gathered from (world/innerMap/townHerbalists.js:
// customObject.pickedDay, until it grows back) is drawn bare: made once from its
// own sprite, as it is drawn this season —
//   • berries and blossoms stripped: the bright reds, blues, pinks and purples of
//     the fruit and flowers turned to the bush's own leaf colour (the white of a
//     winter's snow and the browns of the wood are left as they are);
//   • and an herb (ferns, heather, lavender) cut back as well: the plant stands at
//     cutTo of its height, the top taken off.
// Pure presentation (ui/): made per sprite and season, kept, and reused.

const _cache = new Map();
const CUT_TO = { herbs: 0.6 };

function _hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
}

/** Is this the colour of fruit or a flower (not leaf, wood or snow)? */
function _bloom(r, g, b) {
    const [h, s, l] = _hsl(r, g, b);
    if (l < 0.1 || l > 0.93) return false;              // shadow, snow
    if (h >= 40 && h <= 170) return false;             // greens and yellow-greens: the leaves
    if (h > 18 && h < 40) return l > 0.6 && s > 0.5;   // browns (the wood), but a bright orange bloom
    // blues, purples, pinks (berries, lavender, heather) show even muted; reds a little stronger
    if (h >= 185 && h < 345) return s >= 0.12;
    return s >= 0.25;
}

export const BareBushes = {
    cutTo(good) {
        return CUT_TO[good] || 1;
    },

    /**
     * The picked-bare picture of an object drawn from `tiles` ({ localCol, localRow,
     * sx, sy, sw, sh, sheetPath }), each cell `cell` px; `imgOf(td)` gives a cell's
     * sheet and `scaleOf(img)` its scale. → { canvas, minCol, minRow, cols, rows } or
     * null while a sheet loads. top: where the plant starts, as a share of the height.
     */
    get(key, tiles, cell, imgOf, scaleOf) {
        const hit = _cache.get(key);
        if (hit) return hit;
        if (typeof document === 'undefined' || !tiles || !tiles.length) return null;
        let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
        for (const td of tiles) {
            minCol = Math.min(minCol, td.localCol); maxCol = Math.max(maxCol, td.localCol);
            minRow = Math.min(minRow, td.localRow); maxRow = Math.max(maxRow, td.localRow);
        }
        const cols = maxCol - minCol + 1, rows = maxRow - minRow + 1;
        const c = document.createElement('canvas');
        c.width = cols * cell; c.height = rows * cell;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        for (const td of tiles) {
            const img = imgOf(td);
            if (!img || !img.complete || !img.naturalWidth) return null;
            const k = scaleOf(img);
            g.drawImage(img, td.sx * k, td.sy * k, td.sw * k, td.sh * k, (td.localCol - minCol) * cell, (td.localRow - minRow) * cell, cell, cell);
        }
        let topFrac = 0;
        try {
            const data = g.getImageData(0, 0, c.width, c.height);
            const d = data.data;
            // the bush's own leaf colour, from its leaves (bare twigs in winter: its wood)
            let lr = 0, lg = 0, lb = 0, n = 0, wr = 0, wg = 0, wb = 0, wn = 0, opaque = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] < 200) continue;
                opaque++;
                const [h, s, l] = _hsl(d[i], d[i + 1], d[i + 2]);
                if (h >= 60 && h <= 160 && s > 0.2 && l > 0.15 && l < 0.7) { lr += d[i]; lg += d[i + 1]; lb += d[i + 2]; n++; }
                else if (h > 15 && h < 45 && s > 0.15 && l > 0.12 && l < 0.55) { wr += d[i]; wg += d[i + 1]; wb += d[i + 2]; wn++; }
            }
            const leafy = n > opaque * 0.12;
            const base = leafy ? [lr / n, lg / n, lb / n] : wn ? [wr / wn, wg / wn, wb / wn] : [96, 74, 52];
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] < 10 || !_bloom(d[i], d[i + 1], d[i + 2])) continue;
                // keep the shading: the leaf (or wood) colour at this pixel's lightness
                const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
                const f = 0.7 + l * 0.6;
                d[i] = Math.min(255, base[0] * f); d[i + 1] = Math.min(255, base[1] * f); d[i + 2] = Math.min(255, base[2] * f);
                // a bare twig in winter: the odd bloom pixel at the tip goes, not turned to wood
                if (!leafy && l > 0.45) d[i + 3] = 0;
            }
            // where the plant itself starts (the cut back is of the plant, not its empty cell above)
            let top = c.height;
            for (let y = 0; y < c.height && top === c.height; y++) {
                for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 40) { top = y; break; }
            }
            topFrac = top / c.height;
            g.putImageData(data, 0, 0);
        } catch { /* (a sheet from elsewhere: drawn as it is) */ }
        const out = { canvas: c, minCol, minRow, cols, rows, top: topFrac };
        _cache.set(key, out);
        if (_cache.size > 200) _cache.delete(_cache.keys().next().value);
        return out;
    },
};

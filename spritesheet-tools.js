/* ============================================================
   SheetTools — pure pixel + prompt logic for the spritesheet editor
   ------------------------------------------------------------
   Image models hand back opaque, roughly-pixel-art images that are
   not aligned to any grid. These helpers turn one into tiles the
   inner map can use: key out the flat background, snap the image
   onto an exact cols×rows×tile grid, limit the palette, find the
   occupied tiles, pack sprites onto a tile-aligned atlas, and
   measure how well a tile wraps. buildTilePrompt writes the
   generator prompt for each kind of inner-map tile sheet.

   Classic script (window.SheetTools / globalThis.SheetTools) so the
   editor loads it with one <script> tag and the node test suite can
   import it. Everything works on raw RGBA arrays — no DOM.

   API:
     keyOutColor(data, color, tol)            → pixels cleared
     dominantBorderColor(data, w, h)          → { r, g, b } | null
     snapToGrid(data, w, h, outW, outH)       → Uint8ClampedArray (outW×outH RGBA)
     quantize(data, maxColors)                → palette [{ r, g, b }]
     occupiedTiles(data, w, h, tile, minAlpha?) → [{ col, row }]
     gridPack(sizes, tile, maxCols)           → { placements, cols, rows }
     seamReport(data, w, h)                   → { horizontal, vertical }
     keyOutMagentaCast(data, minGap?, w?, h?) → pixels cleared (pink shadows, lines, fringe)
     contentBounds(data, w, h, rect?)         → { x, y, w, h } | null
     findSprites(data, w, h, opts?)           → [{ x, y, w, h, area }] in reading order
     detectPixelSize(data, w, h)              → { size, confidence } | null
     removeGridLines(data, w, h)              → pixels cleared (grid lines on a keyed sheet)
     relayoutSprites(data, w, h, opts)        → sprites re-laid on a clean tile grid
     fitTilesToGrid(data, w, h, opts)         → the tile grid cut out and snapped, gutters dropped
     healHairlines(data, w, h)                → fills 1-2px clear lines through drawn areas
     keyOutGuideGrey(data)                    → clears unpainted layout-guide grey
     keyOutGuideFill(data, w, h, tol?)        → clears grey guide boxes kept as a sprite backdrop
     sampleArtPixels(data, w, h, artW, artH)  → the art pixels of a sheet drawn on a magnified pixel grid
     nearestAspect(cols, rows)                → '1:1' | '4:3' | …
     tileKinds()                              → [{ id, label, cols, rows, layout, guide }]
     layoutGuide(kind, cols, rows, cell?, magnify?) → guide image + where its grid sits (+ art size)
     buildTilePrompt(opts)                    → { prompt, kind, layout, guide, pixel, cols, rows, tile, background }
   ============================================================ */
(function () {
    'use strict';

    var g = typeof globalThis !== 'undefined' ? globalThis : this;
    if (g && g.SheetTools) return;

    // The flat colour generated sheets are asked to sit on, then keyed out.
    var KEY_COLOR = { r: 255, g: 0, b: 255, hex: '#FF00FF', name: 'magenta' };

    function chanDiff(d, i, c) {
        return Math.max(Math.abs(d[i] - c.r), Math.abs(d[i + 1] - c.g), Math.abs(d[i + 2] - c.b));
    }

    // ── background keying ───────────────────────────────────

    /** Make every pixel within `tol` (max channel difference) of `color` transparent. */
    function keyOutColor(data, color, tol) {
        var n = 0;
        for (var i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 0 && chanDiff(data, i, color) <= tol) {
                data[i + 3] = 0;
                n++;
            }
        }
        return n;
    }

    /** The most common opaque colour on the image border (bucketed to 5 bits/channel). */
    function dominantBorderColor(data, w, h) {
        var counts = {};
        var best = null;
        function visit(x, y) {
            var i = (y * w + x) * 4;
            if (data[i + 3] < 200) return;
            var key = (data[i] >> 3) + ',' + (data[i + 1] >> 3) + ',' + (data[i + 2] >> 3);
            var e = counts[key] || (counts[key] = { n: 0, r: 0, g: 0, b: 0 });
            e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
            if (!best || e.n > best.n) best = e;
        }
        for (var x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
        for (var y = 1; y < h - 1; y++) { visit(0, y); visit(w - 1, y); }
        if (!best) return null;
        return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) };
    }

    // ── grid snapping ───────────────────────────────────────

    /**
     * Resample to outW×outH by majority vote: each output pixel takes the
     * most common colour (4 bits/channel buckets, averaged within the
     * winning bucket) of the source block it covers. Unlike smooth
     * scaling this keeps hard pixel-art edges and flat fills; a block that
     * is mostly transparent stays transparent.
     */
    function snapToGrid(data, w, h, outW, outH) {
        var out = new Uint8ClampedArray(outW * outH * 4);
        var sx = w / outW, sy = h / outH;
        for (var oy = 0; oy < outH; oy++) {
            var y0 = Math.floor(oy * sy), y1 = Math.max(y0 + 1, Math.floor((oy + 1) * sy));
            for (var ox = 0; ox < outW; ox++) {
                var x0 = Math.floor(ox * sx), x1 = Math.max(x0 + 1, Math.floor((ox + 1) * sx));
                var buckets = {}, clear = 0, total = 0, best = null;
                for (var y = y0; y < y1 && y < h; y++) {
                    for (var x = x0; x < x1 && x < w; x++) {
                        var i = (y * w + x) * 4;
                        total++;
                        if (data[i + 3] < 128) { clear++; continue; }
                        var key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
                        var b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0, a: 0 });
                        b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; b.a += data[i + 3];
                        if (!best || b.n > best.n) best = b;
                    }
                }
                var o = (oy * outW + ox) * 4;
                if (!best || clear * 2 > total) continue; // stays transparent
                out[o] = Math.round(best.r / best.n);
                out[o + 1] = Math.round(best.g / best.n);
                out[o + 2] = Math.round(best.b / best.n);
                out[o + 3] = Math.round(best.a / best.n);
            }
        }
        return out;
    }

    // ── palette ─────────────────────────────────────────────

    /**
     * Median-cut the opaque pixels down to at most `maxColors` and remap
     * every opaque pixel in place to its nearest palette colour.
     */
    function quantize(data, maxColors) {
        var px = [];
        for (var i = 0; i < data.length; i += 4) {
            if (data[i + 3] >= 128) px.push([data[i], data[i + 1], data[i + 2]]);
        }
        if (!px.length || maxColors < 1) return [];
        var boxes = [px];
        while (boxes.length < maxColors) {
            // Split the box with the widest channel range.
            var bi = -1, bc = 0, br = 0;
            for (var k = 0; k < boxes.length; k++) {
                if (boxes[k].length < 2) continue;
                for (var c = 0; c < 3; c++) {
                    var lo = 255, hi = 0;
                    for (var p = 0; p < boxes[k].length; p++) {
                        var v = boxes[k][p][c];
                        if (v < lo) lo = v;
                        if (v > hi) hi = v;
                    }
                    if (hi - lo > br) { br = hi - lo; bi = k; bc = c; }
                }
            }
            if (bi < 0 || br === 0) break;
            var box = boxes[bi].slice().sort(function (a, b) { return a[bc] - b[bc]; });
            var mid = box.length >> 1;
            boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
        }
        var palette = boxes.map(function (b) {
            var r = 0, gg = 0, bb = 0;
            for (var q = 0; q < b.length; q++) { r += b[q][0]; gg += b[q][1]; bb += b[q][2]; }
            return { r: Math.round(r / b.length), g: Math.round(gg / b.length), b: Math.round(bb / b.length) };
        });
        for (var j = 0; j < data.length; j += 4) {
            if (data[j + 3] < 128) continue;
            var bestD = Infinity, best = palette[0];
            for (var m = 0; m < palette.length; m++) {
                var dr = data[j] - palette[m].r, dg = data[j + 1] - palette[m].g, db = data[j + 2] - palette[m].b;
                var dist = dr * dr + dg * dg + db * db;
                if (dist < bestD) { bestD = dist; best = palette[m]; }
            }
            data[j] = best.r; data[j + 1] = best.g; data[j + 2] = best.b;
        }
        return palette;
    }

    // ── tiles ───────────────────────────────────────────────

    /** Grid cells (row-major) that hold at least one pixel with alpha > minAlpha. */
    function occupiedTiles(data, w, h, tile, minAlpha) {
        var thr = minAlpha == null ? 10 : minAlpha;
        var cols = Math.floor(w / tile), rows = Math.floor(h / tile);
        var out = [];
        for (var row = 0; row < rows; row++) {
            for (var col = 0; col < cols; col++) {
                var hit = false;
                for (var y = row * tile; y < (row + 1) * tile && !hit; y++) {
                    for (var x = col * tile; x < (col + 1) * tile; x++) {
                        if (data[(y * w + x) * 4 + 3] > thr) { hit = true; break; }
                    }
                }
                if (hit) out.push({ col: col, row: row });
            }
        }
        return out;
    }

    /**
     * Pack sprites onto a tile grid so every sprite starts on a tile
     * boundary (the tile painters pick tiles by grid cell). `sizes` is
     * [{ w, h }] in px; each takes ceil(w/tile)×ceil(h/tile) cells. Shelf
     * packing, in the given order, at most `maxCols` cells wide (widened
     * if one sprite needs more). Placements are in px.
     */
    function gridPack(sizes, tile, maxCols) {
        var cells = sizes.map(function (s) {
            return { cw: Math.max(1, Math.ceil(s.w / tile)), ch: Math.max(1, Math.ceil(s.h / tile)) };
        });
        var cols = Math.max(1, maxCols | 0);
        cells.forEach(function (c) { if (c.cw > cols) cols = c.cw; });
        var x = 0, y = 0, shelfH = 0, usedCols = 0;
        var placements = cells.map(function (c) {
            if (x + c.cw > cols) { y += shelfH; x = 0; shelfH = 0; }
            var p = { x: x * tile, y: y * tile, cols: c.cw, rows: c.ch };
            x += c.cw;
            if (x > usedCols) usedCols = x;
            if (c.ch > shelfH) shelfH = c.ch;
            return p;
        });
        return { placements: placements, cols: usedCols, rows: y + shelfH };
    }

    /**
     * How well an image wraps: mean max-channel difference between its
     * left and right edge columns (horizontal) and top and bottom rows
     * (vertical), over pixels opaque on both sides. 0 = seamless.
     */
    function seamReport(data, w, h) {
        function edge(n, idxA, idxB) {
            var sum = 0, cnt = 0;
            for (var k = 0; k < n; k++) {
                var a = idxA(k), b = idxB(k);
                if (data[a + 3] < 128 || data[b + 3] < 128) continue;
                sum += Math.max(Math.abs(data[a] - data[b]), Math.abs(data[a + 1] - data[b + 1]), Math.abs(data[a + 2] - data[b + 2]));
                cnt++;
            }
            return cnt ? Math.round(sum / cnt) : 0;
        }
        return {
            horizontal: edge(h, function (y) { return (y * w) * 4; }, function (y) { return (y * w + w - 1) * 4; }),
            vertical: edge(w, function (x) { return x * 4; }, function (x) { return ((h - 1) * w + x) * 4; }),
        };
    }

    // ── off-grid generator output ───────────────────────────
    // Image models ignore the requested grid: they add margins, pick their
    // own cell pitch, draw grid lines, let sprites overflow their cells and
    // tint the background and shadows a dull pink instead of #FF00FF. The
    // helpers below find what was actually drawn and put it on the grid.

    /**
     * Clear the magenta-ish pixels a chroma key misses: off-shade
     * backgrounds, pink drop shadows and grid lines. A pixel goes when its
     * green sits `minGap` below both red and blue and red ≈ blue. Purple
     * sprite colours can match too, so this is a separate toggle.
     */
    function keyOutMagentaCast(data, minGap, w, h) {
        var gap = minGap == null ? 60 : minGap;
        var n = 0;
        function cast(i, need) {
            var r = data[i], gg = data[i + 1], b = data[i + 2];
            var lo = Math.min(r, b);
            return lo - gg >= need && Math.abs(r - b) <= lo * 0.6;
        }
        for (var i = 0; i < data.length; i += 4) {
            if (data[i + 3] !== 0 && cast(i, gap)) {
                data[i + 3] = 0;
                n++;
            }
        }
        // With the size given, also eat the fainter pink fringe where a
        // sprite was faded into the background, up to 6 pixels deep.
        if (w && h) {
            for (var pass = 0; pass < 6; pass++) {
                var drop = [];
                for (var y = 0; y < h; y++) {
                    for (var x = 0; x < w; x++) {
                        var k = (y * w + x) * 4;
                        if (data[k + 3] === 0 || !cast(k, 12)) continue;
                        var edge = (x > 0 && data[k - 1] === 0) || (x < w - 1 && data[k + 7] === 0) ||
                            (y > 0 && data[k - w * 4 + 3] === 0) || (y < h - 1 && data[k + w * 4 + 3] === 0);
                        if (edge) drop.push(k);
                    }
                }
                drop.forEach(function (k) { data[k + 3] = 0; });
                n += drop.length;
                if (!drop.length) break;
            }
        }
        return n;
    }

    /** RGBA copy of the rect (x, y, cw, ch) of a w-wide image. */
    function cropRGBA(data, w, x, y, cw, ch) {
        var out = new Uint8ClampedArray(cw * ch * 4);
        for (var row = 0; row < ch; row++) {
            var s = ((y + row) * w + x) * 4;
            out.set(data.subarray(s, s + cw * 4), row * cw * 4);
        }
        return out;
    }

    /** Bounding box { x, y, w, h } of pixels with alpha ≥ 128 inside rect (default: whole image). */
    function contentBounds(data, w, h, rect) {
        var r = rect || { x: 0, y: 0, w: w, h: h };
        var x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        for (var y = r.y; y < r.y + r.h; y++) {
            for (var x = r.x; x < r.x + r.w; x++) {
                if (data[(y * w + x) * 4 + 3] < 128) continue;
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
        return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }

    /**
     * The separate sprites on a keyed image, in reading order (top row
     * first, left to right). Opaque pixels are grouped 8-connected; boxes
     * closer than `gap` px merge (a sprite's detached bits), slivers that
     * span the image (leftover grid lines) are dropped, and small
     * fragments join the nearest sprite or are dropped as specks.
     * opts: { gap?, minArea? } → [{ x, y, w, h, area }]
     */
    function findSprites(data, w, h, opts) {
        opts = opts || {};
        var gap = opts.gap != null ? opts.gap : Math.max(1, Math.round(Math.max(w, h) / 160));
        var minArea = opts.minArea != null ? opts.minArea : Math.max(4, Math.round(w * h / 20000));
        var n = w * h;
        var label = new Int32Array(n), queue = new Int32Array(n);
        var boxes = [];
        for (var s = 0; s < n; s++) {
            if (label[s] || data[s * 4 + 3] < 128) continue;
            var id = boxes.length + 1;
            var b = { x0: w, y0: h, x1: -1, y1: -1, area: 0 };
            var head = 0, tail = 0;
            label[s] = id;
            queue[tail++] = s;
            while (head < tail) {
                var p = queue[head++], px = p % w, py = (p - px) / w;
                b.area++;
                if (px < b.x0) b.x0 = px;
                if (px > b.x1) b.x1 = px;
                if (py < b.y0) b.y0 = py;
                if (py > b.y1) b.y1 = py;
                for (var dy = -1; dy <= 1; dy++) {
                    var ny = py + dy;
                    if (ny < 0 || ny >= h) continue;
                    for (var dx = -1; dx <= 1; dx++) {
                        var nx = px + dx;
                        if (nx < 0 || nx >= w) continue;
                        var q = ny * w + nx;
                        if (!label[q] && data[q * 4 + 3] >= 128) {
                            label[q] = id;
                            queue[tail++] = q;
                        }
                    }
                }
            }
            boxes.push(b);
        }

        boxes = boxes.filter(function (bx) {
            var bw = bx.x1 - bx.x0 + 1, bh = bx.y1 - bx.y0 + 1;
            if (bx.area < 3) return false;
            if (bw >= w * 0.8 && bh <= gap * 2) return false; // horizontal grid line
            if (bh >= h * 0.8 && bw <= gap * 2) return false; // vertical grid line
            return true;
        });

        function dist(a, c) {
            var dx = Math.max(0, a.x0 - c.x1, c.x0 - a.x1);
            var dy = Math.max(0, a.y0 - c.y1, c.y0 - a.y1);
            return Math.max(dx, dy);
        }
        function absorb(a, c) {
            a.x0 = Math.min(a.x0, c.x0); a.y0 = Math.min(a.y0, c.y0);
            a.x1 = Math.max(a.x1, c.x1); a.y1 = Math.max(a.y1, c.y1);
            a.area += c.area;
        }
        var merged = true;
        while (merged) {
            merged = false;
            for (var i = 0; i < boxes.length && !merged; i++) {
                for (var j = i + 1; j < boxes.length; j++) {
                    if (dist(boxes[i], boxes[j]) <= gap) {
                        absorb(boxes[i], boxes[j]);
                        boxes.splice(j, 1);
                        merged = true;
                        break;
                    }
                }
            }
        }

        // Fragments well under a typical sprite join a close neighbour or go.
        var areas = boxes.map(function (bx) { return bx.area; }).sort(function (a, c) { return a - c; });
        var typical = areas.length ? areas[Math.floor(areas.length * 0.75)] : 0;
        var big = boxes.filter(function (bx) { return bx.area >= typical * 0.08 && bx.area >= minArea; });
        boxes.forEach(function (bx) {
            if (big.indexOf(bx) >= 0) return;
            var best = null, bestD = gap * 4 + 1;
            big.forEach(function (c) {
                var d = dist(bx, c);
                if (d < bestD) { bestD = d; best = c; }
            });
            if (best) absorb(best, bx);
        });

        var out = big.map(function (bx) {
            return { x: bx.x0, y: bx.y0, w: bx.x1 - bx.x0 + 1, h: bx.y1 - bx.y0 + 1, area: bx.area };
        });
        if (!out.length) return out;
        // Reading order: band by vertical centre, then left to right.
        var hs = out.map(function (o) { return o.h; }).sort(function (a, c) { return a - c; });
        var band = hs[hs.length >> 1] * 0.5;
        out.sort(function (a, c) { return (a.y + a.h / 2) - (c.y + c.h / 2); });
        var rows = [], cur = null;
        out.forEach(function (o) {
            var cy = o.y + o.h / 2;
            if (!cur || cy - cur.cy > band) { cur = { cy: cy, items: [] }; rows.push(cur); }
            cur.items.push(o);
        });
        return rows.reduce(function (acc, r) {
            return acc.concat(r.items.sort(function (a, c) { return a.x - c.x; }));
        }, []);
    }

    /**
     * The size, in image px, of one "art pixel" of upscaled pixel art (the
     * models draw each pixel as a ~4-8px block, at a fractional pitch).
     * Colour changes cluster on the pixel boundaries, so the edge strength
     * summed per column (and per row) is periodic; the strongest period
     * wins, preferring the smallest of its multiples.
     * → { size, confidence } or null when no clear pixel grid shows.
     */
    function detectPixelSize(data, w, h) {
        function lum(i) { return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114; }
        var ex = new Float64Array(w), ey = new Float64Array(h);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var i = (y * w + x) * 4;
                if (data[i + 3] < 128) continue;
                if (x > 0 && data[i - 1] >= 128) ex[x] += Math.abs(lum(i) - lum(i - 4));
                if (y > 0 && data[i - w * 4 + 3] >= 128) ey[y] += Math.abs(lum(i) - lum(i - w * 4));
            }
        }
        function period(E) {
            var len = E.length, sum = 0;
            for (var k = 0; k < len; k++) sum += E[k];
            var mean = sum / len;
            if (!mean) return null;
            var maxP = Math.min(32, len / 6);
            var scored = [], best = 0;
            for (var p = 2; p <= maxP; p += 0.05) {
                var top = 0;
                for (var phi = 0; phi < p; phi += 0.25) {
                    var s = 0, c = 0;
                    for (var pos = phi; pos < len - 0.5; pos += p) { s += E[Math.round(pos)]; c++; }
                    if (c && s / c > top) top = s / c;
                }
                var ratio = top / mean;
                scored.push({ p: p, ratio: ratio });
                if (ratio > best) best = ratio;
            }
            if (best < 1.6) return null;
            for (var m = 0; m < scored.length; m++) {
                if (scored[m].ratio >= best * 0.85) {
                    // Refine to the local peak around the first strong period.
                    var pk = scored[m];
                    for (var t = m + 1; t < scored.length && scored[t].p < pk.p * 1.08; t++) {
                        if (scored[t].ratio > pk.ratio) pk = scored[t];
                    }
                    return { size: pk.p, confidence: pk.ratio };
                }
            }
            return null;
        }
        var px = period(ex), py = period(ey);
        if (px && py) {
            if (Math.abs(px.size - py.size) / Math.max(px.size, py.size) < 0.15) {
                return { size: (px.size + py.size) / 2, confidence: Math.min(px.confidence, py.confidence) };
            }
            return px.confidence >= py.confidence ? px : py;
        }
        return px || py;
    }

    /**
     * Lay the sprites of an off-grid sheet out again on a clean tile grid.
     * Every sprite is scaled by one common factor (so a barrel stays bigger
     * than a lantern): the image's native art-pixel size when the sprites
     * then fit, otherwise whatever fits the largest (90th percentile) one in
     * `span`×`span` tiles. Sprites are majority-vote resampled, packed
     * tile-aligned in reading order `cols` tiles wide, and centred in their
     * cells with a 1px margin.
     * Already at art resolution (a sheet read back by sampleArtPixels)?
     * Pass `keep: true`: nothing is resampled, and a sprite wider than its
     * span takes more tiles instead of shrinking.
     * opts: { tile, cols, span?, boxes?, pixelSize? (null = don't detect), keep? }
     * → { data, width, height, cols, rows, count, scale, native } | null
     */
    function relayoutSprites(data, w, h, opts) {
        var tile = opts.tile || 32, span = opts.span || 1;
        var boxes = opts.boxes || findSprites(data, w, h);
        if (!boxes.length) return null;
        var dims = boxes.map(function (b) { return Math.max(b.w, b.h); }).sort(function (a, c) { return a - c; });
        var big = dims[Math.min(dims.length - 1, Math.floor(dims.length * 0.9))];
        var limit = span * tile - 2;
        var ps = opts.keep ? { size: 1 } : opts.pixelSize === undefined ? detectPixelSize(data, w, h) : opts.pixelSize;
        var native = !!(ps && ps.size && (opts.keep || big / ps.size <= limit));
        var scale = native ? 1 / ps.size : limit / big;

        var items = boxes.map(function (b) {
            var dw = Math.max(1, Math.round(b.w * scale)), dh = Math.max(1, Math.round(b.h * scale));
            var over = opts.keep ? 0 : Math.max(dw, dh) / limit;
            if (over > 1) { dw = Math.max(1, Math.floor(dw / over)); dh = Math.max(1, Math.floor(dh / over)); }
            return { box: b, dw: dw, dh: dh };
        });
        // The margin keeps neighbours apart; a kept sprite that fills its
        // tiles exactly needs none.
        var pad = function (v) { return opts.keep && v % tile === 0 ? v : v + 2; };
        var pack = gridPack(items.map(function (it) { return { w: pad(it.dw), h: pad(it.dh) }; }), tile, opts.cols || 8);
        var W = pack.cols * tile, H = pack.rows * tile;
        var out = new Uint8ClampedArray(W * H * 4);
        items.forEach(function (it, k) {
            var b = it.box, pl = pack.placements[k];
            var crop = cropRGBA(data, w, b.x, b.y, b.w, b.h);
            var spr = it.dw === b.w && it.dh === b.h ? crop : snapToGrid(crop, b.w, b.h, it.dw, it.dh);
            var ox = pl.x + Math.floor((pl.cols * tile - it.dw) / 2);
            var oy = pl.y + Math.floor((pl.rows * tile - it.dh) / 2);
            for (var y = 0; y < it.dh; y++) {
                out.set(spr.subarray(y * it.dw * 4, (y + 1) * it.dw * 4), ((oy + y) * W + ox) * 4);
            }
        });
        return { data: out, width: W, height: H, cols: pack.cols, rows: pack.rows, count: boxes.length, scale: scale, native: native };
    }

    /**
     * Cut the tile grid out of a generated sheet and snap it to
     * cols×rows×tile. `region` is where the grid should be, as fractions
     * of the image (the layout guide's grid; default the whole image), and
     * `content` the fractions its drawn shapes should cover. When a
     * mask (alpha = drawn, e.g. the keyed image) is given, the drawn
     * content's actual bounds re-fit the region per axis, which corrects
     * the drift and margins the models add. → { data, width, height, rect }
     */
    function fitTilesToGrid(data, w, h, opts) {
        var reg = opts.region || { x0: 0, y0: 0, x1: 1, y1: 1 };
        var con = opts.content || reg;
        var gx0 = reg.x0 * w, gx1 = reg.x1 * w, gy0 = reg.y0 * h, gy1 = reg.y1 * h;
        if (opts.mask) {
            var mx = Math.round(w * 0.06), my = Math.round(h * 0.06);
            var sx0 = Math.max(0, Math.floor(con.x0 * w) - mx), sy0 = Math.max(0, Math.floor(con.y0 * h) - my);
            var sx1 = Math.min(w, Math.ceil(con.x1 * w) + mx), sy1 = Math.min(h, Math.ceil(con.y1 * h) + my);
            var bb = contentBounds(opts.mask, w, h, { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 });
            if (bb) {
                // Map the expected content box onto the found one, axis by axis.
                var ex0 = con.x0 * w, ew = (con.x1 - con.x0) * w, ey0 = con.y0 * h, eh = (con.y1 - con.y0) * h;
                var kx = bb.w / ew, ky = bb.h / eh;
                if (kx > 0.6 && kx < 1.4) { gx0 = bb.x + (gx0 - ex0) * kx; gx1 = bb.x + (gx1 - ex0) * kx; }
                if (ky > 0.6 && ky < 1.4) { gy0 = bb.y + (gy0 - ey0) * ky; gy1 = bb.y + (gy1 - ey0) * ky; }
            }
        }
        var rx = Math.max(0, Math.round(gx0)), ry = Math.max(0, Math.round(gy0));
        var rw = Math.max(1, Math.min(w, Math.round(gx1)) - rx), rh = Math.max(1, Math.min(h, Math.round(gy1)) - ry);
        var tile = opts.tile, W = opts.cols * tile, H = opts.rows * tile;

        // Brightness of drawn pixels per column / row of the region: gutters
        // (keyed to clear) and drawn grid lines (dark) show up as dips.
        var mask = opts.mask || data;
        var px = new Float64Array(rw), py = new Float64Array(rh);
        for (var y = 0; y < rh; y++) {
            for (var x = 0; x < rw; x++) {
                var i = ((ry + y) * w + rx + x) * 4;
                if (mask[i + 3] < 128) continue;
                var v = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 + 1;
                px[x] += v; py[y] += v;
            }
        }
        var colSegs = splitAxis(px, opts.cols), rowSegs = splitAxis(py, opts.rows);
        var out = new Uint8ClampedArray(W * H * 4);
        for (var r = 0; r < opts.rows; r++) {
            for (var c = 0; c < opts.cols; c++) {
                var cx = rx + colSegs[c][0], cy = ry + rowSegs[r][0];
                var cw = colSegs[c][1] - colSegs[c][0], ch = rowSegs[r][1] - rowSegs[r][0];
                var cell = snapToGrid(cropRGBA(data, w, cx, cy, cw, ch), cw, ch, tile, tile);
                for (var ty = 0; ty < tile; ty++) {
                    out.set(cell.subarray(ty * tile * 4, (ty + 1) * tile * 4), ((r * tile + ty) * W + c * tile) * 4);
                }
            }
        }
        return {
            data: out,
            width: W,
            height: H,
            rect: { x: rx, y: ry, w: rw, h: rh },
            gutters: colSegs.concat(rowSegs).filter(function (sg) { return sg[2]; }).length,
        };
    }

    /**
     * Fill transparent hairlines (1-2px) running through drawn areas — what
     * is left of a magenta outline the model drew round a cell. A clear
     * pixel with drawn pixels on both sides (left/right or above/below,
     * within 2px) copies the nearest one. → pixels filled
     */
    function healHairlines(data, w, h) {
        var filled = 0;
        function opaque(x, y) { return x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= 128; }
        function find(x, y, dx, dy) {
            for (var k = 1; k <= 2; k++) if (opaque(x + dx * k, y + dy * k)) return { x: x + dx * k, y: y + dy * k };
            return null;
        }
        var fills = [];
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                if (opaque(x, y)) continue;
                var a = find(x, y, -1, 0), b = a && find(x, y, 1, 0);
                if (!b) { a = find(x, y, 0, -1); b = a && find(x, y, 0, 1); }
                if (b) fills.push([(y * w + x) * 4, (a.y * w + a.x) * 4]);
            }
        }
        fills.forEach(function (f) {
            data[f[0]] = data[f[1]]; data[f[0] + 1] = data[f[1] + 1]; data[f[0] + 2] = data[f[1] + 2]; data[f[0] + 3] = data[f[1] + 3];
            filled++;
        });
        return filled;
    }

    /**
     * Split a profile into n cells. Near each expected boundary, a narrow
     * dip in the profile (a gutter or grid line the model drew across the
     * whole sheet) is cut out; otherwise the cut is the even split. Falls
     * back to even cells if the result is lopsided. → [[start, end)] × n
     */
    function splitAxis(P, n) {
        var len = P.length, c = len / n, segs = [], prev = 0;
        for (var k = 1; k < n; k++) {
            var e = k * c, lo = Math.max(0, Math.round(e - 0.3 * c)), hi = Math.min(len, Math.round(e + 0.3 * c));
            var win = Array.prototype.slice.call(P, lo, hi).sort(function (a, b) { return a - b; });
            var med = win[win.length >> 1], m = lo;
            for (var t = lo; t < hi; t++) if (P[t] < P[m] || (P[t] === P[m] && Math.abs(t - e) < Math.abs(m - e))) m = t;
            // A deep dip (a keyed gutter), or a shallow but hairline one (a
            // drawn grid line: averaged over the whole sheet, ordinary
            // texture never darkens one column this much).
            if (med > 0 && P[m] < med * 0.85) {
                var thr = (P[m] + med) / 2, s = m, f = m;
                while (s > lo && P[s - 1] < thr) s--;
                while (f < hi - 1 && P[f + 1] < thr) f++;
                var width = f - s + 1;
                // Take the line's darker shoulders (its anti-aliasing) too.
                for (var sh = 0; sh < Math.max(2, 0.04 * c) && s > lo && P[s - 1] < med * 0.92; sh++) s--;
                for (var sh2 = 0; sh2 < Math.max(2, 0.04 * c) && f < hi - 1 && P[f + 1] < med * 0.92; sh2++) f++;
                if (P[m] < med * 0.6 ? width <= 0.2 * c : width <= Math.max(2, 0.05 * c)) {
                    segs.push([prev, s, true]);
                    prev = f + 1;
                    continue;
                }
            }
            var cut = Math.round(e);
            segs.push([prev, cut]);
            prev = cut;
        }
        segs.push([prev, len]);
        var ok = segs.every(function (sg) { return sg[1] - sg[0] >= 0.6 * c && sg[1] - sg[0] <= 1.4 * c; });
        if (ok) return segs;
        var even = [];
        for (var q = 0; q < n; q++) even.push([Math.round(q * c), Math.round((q + 1) * c)]);
        return even;
    }

    /**
     * Clear grid lines drawn across a keyed sheet: runs of a few rows (or
     * columns) that are fully opaque, between rows that are not. A sprite
     * crossing a line loses a sliver, which findSprites' merge gap rejoins.
     * → pixels cleared
     */
    function removeGridLines(data, w, h) {
        var cleared = 0;
        var maxRun = Math.max(6, Math.round(Math.max(w, h) / 150));
        function scan(len, span, at) {
            var frac = new Float64Array(len);
            for (var a = 0; a < len; a++) {
                var n = 0;
                for (var b = 0; b < span; b++) if (data[at(a, b) + 3] >= 128) n++;
                frac[a] = n / span;
            }
            for (var s = 0; s < len; s++) {
                if (frac[s] < 0.9) continue;
                var f = s;
                while (f + 1 < len && frac[f + 1] >= 0.9) f++;
                var before = s > 0 ? frac[s - 1] : 0, after = f + 1 < len ? frac[f + 1] : 0;
                if (f - s + 1 <= maxRun && before < 0.85 && after < 0.85) {
                    // Clear the run and its anti-aliased rows either side.
                    for (var a3 = Math.max(0, s - 1); a3 <= Math.min(len - 1, f + 1); a3++) {
                        for (var b3 = 0; b3 < span; b3++) {
                            var i3 = at(a3, b3);
                            if (data[i3 + 3] === 0) continue;
                            data[i3 + 3] = 0;
                            cleared++;
                        }
                    }
                }
                s = f;
            }
        }
        scan(h, w, function (y, x) { return (y * w + x) * 4; });
        scan(w, h, function (x, y) { return (y * w + x) * 4; });
        return cleared;
    }

    /**
     * Read the art pixels back out of a sheet the model drew on a magnified
     * pixel grid (an art-res guide blown up to image size): no resampling,
     * one value per drawn block. The block pitch is w/artW (and h/artH),
     * refined within ±3% along with the grid phase by lining the block
     * edges up with the colour edges. Each art pixel takes the commonest
     * colour (4 bits/channel buckets) of its block's middle, so the
     * anti-aliased block borders never leak in; a mostly clear middle
     * stays clear. → { data, width: artW, height: artH, pitch: {x, y}, phase: {x, y} }
     */
    function sampleArtPixels(data, w, h, artW, artH) {
        function lum(i) { return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114; }
        var ex = new Float64Array(w), ey = new Float64Array(h);
        for (var y = 1; y < h; y++) {
            for (var x = 1; x < w; x++) {
                var i = (y * w + x) * 4;
                var a = data[i + 3] >= 128;
                if (a !== data[i - 1] >= 128) ex[x] += 255;
                else if (a) ex[x] += Math.abs(lum(i) - lum(i - 4));
                if (a !== data[i - w * 4 + 3] >= 128) ey[y] += 255;
                else if (a) ey[y] += Math.abs(lum(i) - lum(i - w * 4));
            }
        }
        // The pitch and phase whose block edges collect the most edge energy.
        function fit(E, len, n) {
            var p0 = len / n, best = { p: p0, phi: 0, s: -1 };
            for (var p = p0 * 0.97; p <= p0 * 1.03; p += p0 * 0.0025) {
                for (var phi = -p / 2; phi < p / 2; phi += 0.25) {
                    var s = 0;
                    for (var k = 0; k <= n; k++) {
                        var at = Math.round(phi + k * p);
                        if (at > 0 && at < len) s += E[at];
                    }
                    if (s > best.s) best = { p: p, phi: phi, s: s };
                }
            }
            return best;
        }
        var fx = fit(ex, w, artW), fy = fit(ey, h, artH);
        var out = new Uint8ClampedArray(artW * artH * 4);
        for (var ay = 0; ay < artH; ay++) {
            var cy = fy.phi + (ay + 0.5) * fy.p, ry = Math.max(0.5, fy.p * 0.25);
            var y0 = Math.max(0, Math.round(cy - ry)), y1 = Math.min(h, Math.max(y0 + 1, Math.round(cy + ry)));
            for (var ax = 0; ax < artW; ax++) {
                var cx = fx.phi + (ax + 0.5) * fx.p, rx = Math.max(0.5, fx.p * 0.25);
                var x0 = Math.max(0, Math.round(cx - rx)), x1 = Math.min(w, Math.max(x0 + 1, Math.round(cx + rx)));
                var buckets = {}, best = null, clear = 0, total = 0;
                for (var sy = y0; sy < y1; sy++) {
                    for (var sx = x0; sx < x1; sx++) {
                        var j = (sy * w + sx) * 4;
                        total++;
                        if (data[j + 3] < 128) { clear++; continue; }
                        var key = ((data[j] >> 4) << 8) | ((data[j + 1] >> 4) << 4) | (data[j + 2] >> 4);
                        var b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
                        b.n++; b.r += data[j]; b.g += data[j + 1]; b.b += data[j + 2];
                        if (!best || b.n > best.n) best = b;
                    }
                }
                if (!best || clear * 2 > total) continue;
                var o = (ay * artW + ax) * 4;
                out[o] = Math.round(best.r / best.n);
                out[o + 1] = Math.round(best.g / best.n);
                out[o + 2] = Math.round(best.b / best.n);
                out[o + 3] = 255;
            }
        }
        return { data: out, width: artW, height: artH, pitch: { x: fx.p, y: fy.p }, phase: { x: fx.phi, y: fy.phi } };
    }

    /**
     * Clear the guide's grey boxes where the model kept them as a backdrop
     * behind its sprites: flat, near-neutral grey close to the guide's fill
     * tone, flood-filled from the clear background (so grey inside a
     * sprite, walled off by its outline, stays). → pixels cleared
     */
    function keyOutGuideFill(data, w, h, tol) {
        tol = tol == null ? 16 : tol;
        var f = GUIDE_TONES.fill;
        function grey(i) {
            var r = data[i], g = data[i + 1], b = data[i + 2];
            // JPEG output bleeds the magenta into the grey, tinting it pink.
            var spread = Math.max(r, g, b) - Math.min(r, g, b);
            return data[i + 3] >= 128 && (spread <= 10 || (spread <= 28 && g <= r && g <= b)) &&
                Math.abs((r + g + b) / 3 - (f[0] + f[1] + f[2]) / 3) <= tol;
        }
        var seen = new Uint8Array(w * h), stack = [], n = 0;
        for (var p = 0; p < w * h; p++) {
            if (data[p * 4 + 3] >= 128) continue;
            var x = p % w, y = (p / w) | 0;
            [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(function (q) {
                if (q[0] < 0 || q[1] < 0 || q[0] >= w || q[1] >= h) return;
                var k = q[1] * w + q[0];
                if (!seen[k] && grey(k * 4)) { seen[k] = 1; stack.push(k); }
            });
        }
        while (stack.length) {
            var k = stack.pop();
            data[k * 4 + 3] = 0;
            n++;
            var kx = k % w, ky = (k / w) | 0;
            if (kx > 0 && !seen[k - 1] && grey((k - 1) * 4)) { seen[k - 1] = 1; stack.push(k - 1); }
            if (kx < w - 1 && !seen[k + 1] && grey((k + 1) * 4)) { seen[k + 1] = 1; stack.push(k + 1); }
            if (ky > 0 && !seen[k - w] && grey((k - w) * 4)) { seen[k - w] = 1; stack.push(k - w); }
            if (ky < h - 1 && !seen[k + w] && grey((k + w) * 4)) { seen[k + w] = 1; stack.push(k + w); }
        }
        if (!n) return 0;
        // Backdrop walled in by a sprite (inside a bucket's handle): a grey
        // patch of the very colour that was just cleared goes too.
        var mr = 0, mg = 0, mb = 0;
        for (var c = 0; c < w * h; c++) {
            if (seen[c]) { mr += data[c * 4]; mg += data[c * 4 + 1]; mb += data[c * 4 + 2]; }
        }
        mr /= n; mg /= n; mb /= n;
        for (var s0 = 0; s0 < w * h; s0++) {
            if (seen[s0] || !grey(s0 * 4)) continue;
            var comp = [s0], sr = 0, sg = 0, sb = 0;
            seen[s0] = 2;
            for (var ci = 0; ci < comp.length; ci++) {
                var q = comp[ci], qx = q % w, qy = (q / w) | 0;
                sr += data[q * 4]; sg += data[q * 4 + 1]; sb += data[q * 4 + 2];
                [qx > 0 ? q - 1 : -1, qx < w - 1 ? q + 1 : -1, qy > 0 ? q - w : -1, qy < h - 1 ? q + w : -1].forEach(function (nq) {
                    if (nq >= 0 && !seen[nq] && grey(nq * 4)) { seen[nq] = 2; comp.push(nq); }
                });
            }
            var len = comp.length;
            if (len >= 200 && Math.abs(sr / len - mr) <= 4 && Math.abs(sg / len - mg) <= 4 && Math.abs(sb / len - mb) <= 4) {
                comp.forEach(function (q2) { data[q2 * 4 + 3] = 0; });
                n += len;
            }
        }
        return n;
    }

    // ── generator prompts ───────────────────────────────────

    var ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

    /** The supported image aspect ratio closest to a cols×rows sheet. */
    function nearestAspect(cols, rows) {
        var want = Math.log(cols / rows), best = '1:1', bestD = Infinity;
        ASPECTS.forEach(function (a) {
            var p = a.split(':');
            var d = Math.abs(Math.log(p[0] / p[1]) - want);
            if (d < bestD) { bestD = d; best = a; }
        });
        return best;
    }

    var THEMES = {
        medieval: 'a grounded high-medieval European realm (timber, wattle and daub, fieldstone, thatch, iron, wool and linen); earthy palette of moss greens, ochres, umbers, slate greys and muted reds',
        nordic: 'a cold northern realm (pine, longhouses, carved wood, furs, grey granite, snow); palette of cold blues, pine greens, bark browns and bone whites',
        desert: 'a sun-baked southern realm (sandstone, mudbrick, palm wood, glazed tile, bright cloth); palette of sand, terracotta, turquoise, saffron and deep indigo',
        roman: 'a classical Roman-era realm (marble, travertine, terracotta, mosaic, bronze); palette of marble whites, travertine creams, terracotta reds, mosaic blues and bronze ambers',
        dark: 'a grim, war-torn realm (charred timber, rusted iron, wet stone, mud); desaturated palette of soot greys, rust, dried blood and sickly greens',
    };

    var SEASONS = {
        summer: 'high summer: full, saturated greens and warm light',
        spring: 'spring: fresh light greens, small flowers, damp earth',
        autumn: 'autumn: ambers, rusts and fallen leaves over the ground',
        winter: 'winter: frost and patchy snow, cold desaturated tones',
    };

    // cols×rows is the exact grid the result is snapped to afterwards.
    var KINDS = {
        terrain: {
            label: 'Terrain fill tiles', cols: 4, rows: 2, seasonal: true, opaque: true, layout: 'tiles',
            subject: 'grass',
            body: function (o) {
                return [
                    'A set of ' + (o.cols * o.rows) + ' interchangeable ground-fill tiles of ' + o.subject + ', seen from directly above.',
                    'Every tile must be SEAMLESS: its left edge continues its right edge and its top edge continues its bottom edge, and any tile can sit next to any other without a visible line.',
                    'Variants differ only in small details (a pebble, a tuft, a crack, a darker patch) so a large field of them reads as one natural surface with no obvious repetition.',
                    'Fill every tile edge to edge — no border, no outline, no background showing.',
                ];
            },
        },
        ninetile: {
            label: '9-tile terrain brush', cols: 5, rows: 3, seasonal: true, layout: 'tiles',
            subject: 'a dirt path',
            body: function (o) {
                return [
                    'An auto-tiling brush for ' + o.subject + ' painted over the background, in the exact slot layout below. Each slot is one ' + o.tile + 'px tile:',
                    '- Columns 1-3, rows 1-3: a 3×3 block that, assembled as-is, shows one solid rounded-rectangle patch of the terrain. Row 1 is the top edge (top-left corner, top edge, top-right corner), row 2 the middle (left edge, solid centre fill, right edge), row 3 the bottom edge (bottom-left corner, bottom edge, bottom-right corner). Edge and corner tiles fade or break up naturally into the background on their outer side only.',
                    '- Columns 4-5, rows 1-2: four INSIDE corners for concave turns — a fully filled tile with only a small notch of background cut into one corner: top-left notch, top-right notch (row 1); bottom-left notch, bottom-right notch (row 2).',
                    '- Columns 4-5, row 3: two alternate centre fills, interchangeable with the centre tile.',
                    'The centre fill and both alternates must be seamless with each other and with the inner sides of every edge tile.',
                ];
            },
        },
        floor: {
            label: 'Interior floor (9-tile)', cols: 5, rows: 3, layout: 'tiles',
            subject: 'worn oak floorboards',
            body: function (o) {
                return [
                    'An auto-tiling interior floor brush of ' + o.subject + ', viewed from directly above, in this slot layout (each slot one ' + o.tile + 'px tile):',
                    '- Columns 1-3, rows 1-3: a 3×3 block forming one rectangular room floor — corners, edges with a thin skirting/threshold on the outer side, and a solid centre fill.',
                    '- Columns 4-5, rows 1-2: four inside corners (fully floored, with a small notch of skirting in the top-left, top-right, bottom-left, bottom-right corner respectively).',
                    '- Columns 4-5, row 3: two alternate centre fills (a knot, a stain, a loose board) seamless with the centre tile.',
                ];
            },
        },
        wall: {
            label: 'Interior wall (9-tile)', cols: 5, rows: 3, layout: 'tiles',
            subject: 'whitewashed timber-framed walls',
            body: function (o) {
                return [
                    'An auto-tiling interior wall brush of ' + o.subject + ', drawn in the top-down 3/4 RPG view where wall tops are seen from above and the south-facing wall face is visible, in this slot layout (each slot one ' + o.tile + 'px tile):',
                    '- Columns 1-3, rows 1-3: a 3×3 block outlining a closed rectangular room — wall corners, straight wall runs on each side, and an empty centre that is pure background.',
                    '- Columns 4-5, rows 1-2: four inside corners where two wall runs meet at a concave turn (top-left, top-right, bottom-left, bottom-right).',
                    '- Columns 4-5, row 3: a wall run with a window and a wall run with a doorway, both matching the top straight run.',
                ];
            },
        },
        objects: {
            label: 'Props & objects', cols: 6, rows: 4, layout: 'sprites', span: 1,
            subject: 'household and workshop props for a village interior',
            body: function (o) {
                return [
                    'A sheet of ' + (o.cols * o.rows) + ' separate small props — ' + o.subject + ' — one prop centred in each ' + o.tile + 'px cell.',
                    'Each prop sits fully inside its own cell with a little background margin; nothing touches or crosses a cell boundary.',
                    'Vary the props; where a row repeats one object, show distinct variants (full / empty / broken, or colour variants).',
                ];
            },
        },
        structures: {
            label: 'Multi-tile structures', cols: 9, rows: 6, layout: 'sprites', span: 3,
            subject: 'village workshop structures (forge, well, market stall, haycart)',
            body: function (o) {
                return [
                    'A sheet of larger multi-tile structures — ' + o.subject + ' — each occupying a whole number of ' + o.tile + 'px cells (2×2, 3×2 or 2×3).',
                    'Each structure\'s footprint aligns exactly to the cell grid and is separated from its neighbours by at least one empty cell of background.',
                    'Draw roofs and tall parts so they read in the top-down 3/4 RPG view: the footprint on the ground, the front face visible below it.',
                ];
            },
        },
    };

    function tileKinds() {
        return Object.keys(KINDS).map(function (id) {
            var k = KINDS[id];
            return {
                id: id, label: k.label, cols: k.cols, rows: k.rows, seasonal: !!k.seasonal, subject: k.subject,
                layout: k.layout, span: k.span || 1, guide: !!GUIDES[id],
            };
        });
    }

    // ── layout guide ────────────────────────────────────────
    // A picture of where everything goes, sent with the prompt. The models
    // follow a picture's geometry far better than a described grid, so they
    // repaint the grey shapes in place. Shapes are in cell units:
    // { x, y, w, h, tone: 'fill'|'dark'|'light'|'bg', round? (fraction of a cell) }.

    var GUIDE_TONES = { fill: [128, 128, 128], dark: [72, 72, 72], light: [184, 184, 184], alt: [146, 146, 146] };
    var EDGE = 0.3; // how far a 9-tile brush's outer edge sits inside its edge tiles

    var GUIDES = {
        terrain: function (cols, rows) {
            var out = [];
            for (var r = 0; r < rows; r++) {
                for (var c = 0; c < cols; c++) out.push({ x: c, y: r, w: 1, h: 1, tone: (r + c) % 2 ? 'alt' : 'fill' });
            }
            return out;
        },
        ninetile: function () {
            return [
                { x: EDGE, y: EDGE, w: 3 - 2 * EDGE, h: 3 - 2 * EDGE, tone: 'fill', round: 0.45 },
                { x: 3, y: 0, w: 2, h: 3, tone: 'fill' },
                // Inside corners: the background notch sits in the missing diagonal.
                { x: 3, y: 0, w: EDGE, h: EDGE, tone: 'bg' },
                { x: 5 - EDGE, y: 0, w: EDGE, h: EDGE, tone: 'bg' },
                { x: 3, y: 2 - EDGE, w: EDGE, h: EDGE, tone: 'bg' },
                { x: 5 - EDGE, y: 2 - EDGE, w: EDGE, h: EDGE, tone: 'bg' },
                // Keep the alternates visibly apart from the corners above.
                { x: 3, y: 2, w: 2, h: 0.04, tone: 'bg' },
            ];
        },
        floor: function () {
            var k = 0.14;
            return [
                { x: 0, y: 0, w: 3, h: 3, tone: 'dark' },
                { x: k, y: k, w: 3 - 2 * k, h: 3 - 2 * k, tone: 'fill' },
                { x: 3, y: 0, w: 2, h: 2, tone: 'fill' },
                { x: 3, y: 0, w: EDGE, h: EDGE, tone: 'dark' },
                { x: 5 - EDGE, y: 0, w: EDGE, h: EDGE, tone: 'dark' },
                { x: 3, y: 2 - EDGE, w: EDGE, h: EDGE, tone: 'dark' },
                { x: 5 - EDGE, y: 2 - EDGE, w: EDGE, h: EDGE, tone: 'dark' },
                { x: 3, y: 2.04, w: 2, h: 0.96, tone: 'fill' },
            ];
        },
        wall: function () {
            var b = 0.45;
            return [
                { x: 0, y: 0, w: 3, h: b, tone: 'dark' },
                { x: 0, y: 3 - b, w: 3, h: b, tone: 'dark' },
                { x: 0, y: 0, w: b, h: 3, tone: 'dark' },
                { x: 3 - b, y: 0, w: b, h: 3, tone: 'dark' },
                { x: 3.1, y: 0.1, w: b, h: b, tone: 'dark' },
                { x: 4.9 - b, y: 0.1, w: b, h: b, tone: 'dark' },
                { x: 3.1, y: 1.9 - b, w: b, h: b, tone: 'dark' },
                { x: 4.9 - b, y: 1.9 - b, w: b, h: b, tone: 'dark' },
                { x: 3, y: 2, w: 1, h: b, tone: 'dark' },
                { x: 3.3, y: 2.08, w: 0.4, h: b - 0.16, tone: 'light' },
                { x: 4, y: 2, w: 1, h: b, tone: 'dark' },
                { x: 4.3, y: 2.08, w: 0.4, h: b - 0.08, tone: 'bg' },
            ];
        },
        objects: function (cols, rows) {
            var out = [];
            for (var r = 0; r < rows; r++) {
                for (var c = 0; c < cols; c++) out.push({ x: c + 0.08, y: r + 0.08, w: 0.84, h: 0.84, tone: 'fill', round: 0.16 });
            }
            return out;
        },
        // 3×3-tile plots with a tile of space between; the structures are
        // found and laid out again, so this mostly sets their pixel scale.
        structures: function (cols, rows) {
            var out = [];
            for (var r = 0; r + 3 <= rows; r += 3) {
                for (var c = 0; c + 3 <= cols; c += 3) out.push({ x: c + 0.15, y: r + 0.15, w: 2.7, h: 2.7, tone: 'fill', round: 0.2 });
            }
            return out;
        },
    };

    /**
     * Clear guide grey the model left unpainted (exact flat fill / alt /
     * light tones only — real pixel-art stone is never this flat).
     */
    function keyOutGuideGrey(data) {
        var n = 0;
        ['fill', 'alt', 'light'].forEach(function (t) {
            var c = GUIDE_TONES[t];
            n += keyOutColor(data, { r: c[0], g: c[1], b: c[2] }, 5);
        });
        return n;
    }

    /** The guide canvas for a cols×rows grid of `cell` px: padded to the requested aspect. */
    function guideSize(cols, rows, cell) {
        var gw = cols * cell, gh = rows * cell;
        var ar = nearestAspect(cols, rows).split(':');
        var ratio = ar[0] / ar[1];
        var W = gw, H = gh;
        if (W / H < ratio) W = Math.round(H * ratio); else H = Math.round(W / ratio);
        return { width: W, height: H, ox: Math.floor((W - gw) / 2), oy: Math.floor((H - gh) / 2) };
    }

    /** How much a pixel-grid guide magnifies the art: about 1024px across. */
    function guideMagnify(width, height) {
        return Math.max(1, Math.round(1024 / Math.max(width, height)));
    }

    /**
     * The layout-guide image for a kind: magenta everywhere except the grey
     * shapes, the grid centred on a canvas of the aspect ratio the model is
     * asked for (so its output has the guide's proportions). `region` is
     * the grid and `content` the shapes' bounds, both as fractions of the
     * image, for fitTilesToGrid.
     * Pixel mode (`magnify` > 1, `cell` = the tile size): the guide is the
     * sheet at its real art resolution, every art pixel blown up to a
     * magnify×magnify block, so the model can draw on that pixel grid;
     * `art` is the art-res canvas size, for sampleArtPixels.
     * → { width, height, data, region, content, art: { width, height, magnify } } | null
     */
    function layoutGuide(kindId, cols, rows, cell, magnify) {
        var shapesFn = GUIDES[kindId];
        if (!shapesFn) return null;
        cell = cell || 96;
        var mag = Math.max(1, magnify | 0);
        var gw = cols * cell, gh = rows * cell;
        var size = guideSize(cols, rows, cell);
        var W = size.width, H = size.height, ox = size.ox, oy = size.oy;
        var data = new Uint8ClampedArray(W * H * 4);
        for (var i = 0; i < data.length; i += 4) {
            data[i] = KEY_COLOR.r; data[i + 1] = KEY_COLOR.g; data[i + 2] = KEY_COLOR.b; data[i + 3] = 255;
        }
        var shapes = shapesFn(cols, rows);
        var cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity;
        shapes.forEach(function (sh) {
            var col = sh.tone === 'bg' ? [KEY_COLOR.r, KEY_COLOR.g, KEY_COLOR.b] : GUIDE_TONES[sh.tone];
            var x0 = Math.round(ox + sh.x * cell), y0 = Math.round(oy + sh.y * cell);
            var x1 = Math.round(ox + (sh.x + sh.w) * cell), y1 = Math.round(oy + (sh.y + sh.h) * cell);
            var rad = (sh.round || 0) * cell;
            if (sh.tone !== 'bg') {
                cx0 = Math.min(cx0, x0); cy0 = Math.min(cy0, y0); cx1 = Math.max(cx1, x1); cy1 = Math.max(cy1, y1);
            }
            for (var y = y0; y < y1; y++) {
                for (var x = x0; x < x1; x++) {
                    if (rad) {
                        var dx = Math.max(x0 + rad - x - 0.5, x + 0.5 - (x1 - rad), 0);
                        var dy = Math.max(y0 + rad - y - 0.5, y + 0.5 - (y1 - rad), 0);
                        if (dx * dx + dy * dy > rad * rad) continue;
                    }
                    var o = (y * W + x) * 4;
                    data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2];
                }
            }
        });
        if (mag > 1) {
            var big = new Uint8ClampedArray(W * mag * H * mag * 4);
            for (var by = 0; by < H * mag; by++) {
                for (var bx = 0; bx < W * mag; bx++) {
                    var s = (((by / mag) | 0) * W + ((bx / mag) | 0)) * 4, d = (by * W * mag + bx) * 4;
                    big[d] = data[s]; big[d + 1] = data[s + 1]; big[d + 2] = data[s + 2]; big[d + 3] = 255;
                }
            }
            data = big;
        }
        return {
            width: W * mag,
            height: H * mag,
            data: data,
            region: { x0: ox / W, y0: oy / H, x1: (ox + gw) / W, y1: (oy + gh) / H },
            content: { x0: cx0 / W, y0: cy0 / H, x1: cx1 / W, y1: cy1 / H },
            art: { width: W, height: H, magnify: mag },
        };
    }

    /**
     * opts: { kind, subject?, theme?, season?, cols?, rows?, tile?, notes?, withReference?, withGuide?, pixelGrid? }
     * Returns the prompt plus the grid the result should be fitted to.
     * withGuide: a layoutGuide() image is sent first (kinds that have one).
     * pixelGrid (default on with a guide): the guide is the sheet at its art
     * resolution, magnified, and `pixel` ({ width, height, magnify }) is
     * returned so the result can be read back one art pixel per block.
     */
    function buildTilePrompt(opts) {
        opts = opts || {};
        var kindId = KINDS[opts.kind] ? opts.kind : 'terrain';
        var kind = KINDS[kindId];
        var o = {
            subject: (opts.subject || '').trim() || kind.subject,
            cols: Math.max(1, opts.cols | 0 || kind.cols),
            rows: Math.max(1, opts.rows | 0 || kind.rows),
            tile: Math.max(8, opts.tile | 0 || 32),
        };
        var guide = !!(opts.withGuide && GUIDES[kindId]);
        var sprites = kind.layout === 'sprites';
        // Pixel mode: the guide is the sheet at its real resolution, magnified,
        // and the model draws on that grid (sampleArtPixels reads it back).
        var pixel = null;
        if (guide && opts.pixelGrid !== false) {
            var art = guideSize(o.cols, o.rows, o.tile);
            pixel = { width: art.width, height: art.height, magnify: guideMagnify(art.width, art.height) };
        }
        var theme = THEMES[opts.theme] || THEMES.medieval;
        var bgLine = '- Background: one perfectly flat, pure ' + KEY_COLOR.name + ' (' + KEY_COLOR.hex + ') everywhere that is not part of a sprite — it is keyed out to transparency afterwards, so never use ' + KEY_COLOR.name + ', pink or purple inside a sprite, do not anti-alias sprites against it, and cast no shadows onto it.';
        var resolution = pixel ? [
            '## Resolution (the most important rule)',
            '- The finished sheet is only ' + pixel.width + '×' + pixel.height + ' real pixels. The layout guide is that canvas magnified ' + pixel.magnify + '×: one art pixel = one solid ' + pixel.magnify + '×' + pixel.magnify + ' block of a single flat colour, aligned exactly to the guide\'s block grid.',
            '- Draw at that low resolution, placing every art pixel on purpose, the way a pixel artist works on a ' + o.tile + '×' + o.tile + ' tile' +
                (sprites ? ': each ' + (kind.span > 1 ? 'structure fills its plot' : 'prop is at most ' + (o.tile - 4) + '×' + (o.tile - 4) + ' art pixels') + ', with a 1-pixel dark outline and 3-4 shades per material.' : ', with 3-4 shades per material.'),
            '- No detail smaller than one block, no anti-aliasing, no soft edges, no gradients or noise inside a block.',
            '',
        ] : [];
        var layout = guide ? [
            '## Layout (strict — follow the attached layout guide)',
            '- The FIRST attached image is a layout guide at the exact proportions of the sheet: ' + o.cols + ' columns × ' + o.rows + ' rows of square tiles, each tile ' + o.tile + '×' + o.tile + ' game pixels.',
        ].concat(sprites ? [
            '- Each grey box marks where one ' + (kind.span > 1 ? 'structure' : 'prop') + ' goes. Draw it inside its box, as large as fits, and paint the rest of the box pure ' + KEY_COLOR.name + ' too: the grey is only a placeholder, no grey backdrop or tile behind the ' + (kind.span > 1 ? 'structure' : 'prop') + '. Nothing is drawn outside the boxes.',
            '- Do not draw the guide itself: no grid lines, borders, frames, labels, text or watermark.',
            bgLine,
        ] : [
            '- Repaint the guide: every pure ' + KEY_COLOR.name + ' area stays pure ' + KEY_COLOR.name + ', and every grey shape becomes the pixel art described below, filling that shape exactly — same position, same size, same outline. Nothing is drawn outside the grey shapes.',
            '- Darker grey marks edges, skirting or wall mass; lighter grey marks a window or opening.',
            '- Each grey shape is ONE continuous piece: the tiles inside it join seamlessly, with no gaps, gutters, seams or separately rounded tiles between them. Hard edges against the ' + KEY_COLOR.name + ' — no fade or glow into it.',
            '- Do not draw the guide itself: no grid lines, borders, labels, text or watermark, and no grey left over.',
            kind.opaque ? '- The tiles fill the grey area completely; only the padding around it is ' + KEY_COLOR.name + '.' : bgLine,
        ]) : [
            '## Layout (strict)',
            '- The sheet is an exact grid of ' + o.cols + ' columns × ' + o.rows + ' rows of square tiles; each tile represents ' + o.tile + '×' + o.tile + ' game pixels.',
            '- Keep the grid perfectly regular and use the whole image: no margins, no gaps, no gutters, no grid lines, no borders, no labels, no text, no watermark.',
            kind.opaque ? '- Every tile is fully filled; there is no background.' : bgLine,
        ];
        var lines = [
            'Pixel art spritesheet for a top-down 2D RPG, in the Liberated Pixel Cup (LPC) art style.',
            '',
        ].concat(resolution, layout, ['', '## Content'], kind.body(o), [
            '',
            '## Style',
            '- Setting: ' + theme + '.',
            kind.seasonal && SEASONS[opts.season] ? '- Season: ' + SEASONS[opts.season] + '.' : null,
            '- Crisp, hand-placed pixel art with a limited palette and 1-pixel detail; chunky readable shapes at ' + o.tile + 'px. No painterly blending, no gradients, no blur, no photographic texture, no dithering noise.',
            '- Orthographic top-down view with soft light from the upper left.',
            opts.withReference
                ? '- Match the palette, outline weight and shading of the ' + (guide ? 'second attached image (a reference sheet)' : 'attached reference sheet') + ' exactly.'
                : null,
        ]);
        if (opts.notes && opts.notes.trim()) lines.push('', '## Extra instructions', opts.notes.trim());
        return {
            prompt: lines.filter(function (l) { return l !== null; }).join('\n'),
            kind: kindId,
            layout: kind.layout || 'tiles',
            span: kind.span || 1,
            guide: guide,
            pixel: pixel,
            cols: o.cols,
            rows: o.rows,
            tile: o.tile,
            background: kind.opaque ? null : { r: KEY_COLOR.r, g: KEY_COLOR.g, b: KEY_COLOR.b },
        };
    }

    var SheetTools = {
        KEY_COLOR: KEY_COLOR,
        THEMES: Object.keys(THEMES),
        SEASONS: Object.keys(SEASONS),
        keyOutColor: keyOutColor,
        dominantBorderColor: dominantBorderColor,
        snapToGrid: snapToGrid,
        quantize: quantize,
        occupiedTiles: occupiedTiles,
        gridPack: gridPack,
        seamReport: seamReport,
        keyOutMagentaCast: keyOutMagentaCast,
        contentBounds: contentBounds,
        findSprites: findSprites,
        detectPixelSize: detectPixelSize,
        removeGridLines: removeGridLines,
        relayoutSprites: relayoutSprites,
        fitTilesToGrid: fitTilesToGrid,
        healHairlines: healHairlines,
        keyOutGuideGrey: keyOutGuideGrey,
        keyOutGuideFill: keyOutGuideFill,
        sampleArtPixels: sampleArtPixels,
        nearestAspect: nearestAspect,
        tileKinds: tileKinds,
        layoutGuide: layoutGuide,
        buildTilePrompt: buildTilePrompt,
    };

    g.SheetTools = SheetTools;
    if (typeof window !== 'undefined') window.SheetTools = window.SheetTools || SheetTools;
})();

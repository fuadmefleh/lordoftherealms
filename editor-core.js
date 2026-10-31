/* ============================================================
   EditorCore — shared pure helpers for the editor suite
   ------------------------------------------------------------
   The standalone tile-painter editors (sprite / interior / terrain
   / world) grew independent copies of the same primitives:
   screen↔cell math, flood-fill traversal, an undo/redo stack,
   occupied-bounds scans, tile-map (de)serialization, an image
   cache, zoom-to-cursor math, and a deterministic variant hash.
   This module is the single source of truth for that logic.

   Ships as a plain classic script (no ES module) so it loads in
   every editor with one <script src="editor-core.js">, exactly
   like editor-ui.js. Every function here is DOM-free and pure
   (randomness/image construction are injectable), so the suite
   under src/__tests__ can import this file and unit-test it in
   the node vitest environment.

   API (attached to window.EditorCore / globalThis.EditorCore):
     — strings —
     slugify(s), escHtml(s)
     — cell keys —
     cellKey(q, r), parseCellKey(key)
     — viewport math —
     screenToCell(sx, sy, view), screenToCellRaw(sx, sy, view)
     zoomStep(zoom, dir, steps?), zoomAtCursor(cx, cy, prev, next, panX, panY)
     — tile-map ops —
     computeBounds(stores), floodFillRegion(opts)
     serializeTileMap(dict, originQ, originR)
     deserializeTileMap(arr, offQ, offR)
     — variants —
     variantHash(q, r, n), pickWeightedVariant(variants, rand?)
     — undo/redo —
     createUndoStack({ max, snapshot, restore })
     — images —
     createImageCache(), loadImage(cache, path, ImageCtor?)
     — data patches (same format as src/core/dataPatch.js) —
     deepEqual(a, b), createDataPatch(base, target), applyDataPatch(base, patch)
     — data paths (the Game Data tab) —
     getAtPath(obj, path), setAtPath(obj, path, v), deleteAtPath(obj, path)
     searchData(root, query, { maxResults?, maxDepth? })
     — nine-tile brushes (same rules as src/core/nineTile.js) —
     pickNineTileSlot(has), resolveBrushSeason(brush, season), nineTileHash(q, r)
     resolveNineTileCell(brush, season, has, q, r, resolved?)
     erodeUntileableStubs(mask), nineTilePreviewMask(shape, w, h, seed?)
     — blocked tile sides (same rules as src/core/tileSides.js) —
     sidesMask(spec), sidesString(mask), outerSidesForSlot(row, col)
     toggleSide(spec, side, on?), sideAtPoint(fx, fy, band?)
   ============================================================ */
(function () {
    'use strict';

    // Resolve the global once; keep both bindings so browsers read
    // window.EditorCore and the node test env reads globalThis.EditorCore.
    var g = typeof globalThis !== 'undefined' ? globalThis : this;
    if (g && g.EditorCore) return; // idempotent across re-includes

    // ── strings ─────────────────────────────────────────────
    // Verbatim from sprite_editor.html:1085-1086 (and duplicated
    // across the other editors).
    function slugify(s) {
        return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }
    function escHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── cell keys ───────────────────────────────────────────
    // Editors key their layer maps by the string "q,r".
    function cellKey(q, r) {
        return q + ',' + r;
    }
    function parseCellKey(key) {
        var parts = String(key).split(',');
        return { q: Number(parts[0]), r: Number(parts[1]) };
    }

    // ── viewport math ───────────────────────────────────────
    // `view` = { tile, zoom, panX, panY, gridW, gridH }.
    // Matches sprite_editor.html:2003-2011 exactly.
    function screenToCell(sx, sy, view) {
        var ds = view.tile * view.zoom;
        var q = Math.floor((sx - view.panX) / ds);
        var r = Math.floor((sy - view.panY) / ds);
        return { q: q, r: r, valid: q >= 0 && q < view.gridW && r >= 0 && r < view.gridH };
    }
    function screenToCellRaw(sx, sy, view) {
        var ds = view.tile * view.zoom;
        return { q: Math.floor((sx - view.panX) / ds), r: Math.floor((sy - view.panY) / ds) };
    }

    // Default zoom ladder shared by the canvas editors.
    var ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
    // Step to the next/prev zoom on the ladder. Matches
    // sprite_editor.html:1797-1803.
    function zoomStep(zoom, dir, steps) {
        steps = steps || ZOOM_STEPS;
        var idx = steps.findIndex(function (s) { return s >= zoom - 0.01; });
        if (idx < 0) idx = steps.length - 1;
        idx = Math.max(0, Math.min(steps.length - 1, idx + dir));
        return steps[idx];
    }
    // Re-pan so the point (cx, cy) stays fixed while zoom changes
    // from `prev` to `next`. Matches sprite_editor.html:1804-1805.
    function zoomAtCursor(cx, cy, prev, next, panX, panY) {
        return {
            panX: Math.round(cx - (cx - panX) * (next / prev)),
            panY: Math.round(cy - (cy - panY) * (next / prev)),
        };
    }

    // ── tile-map ops ────────────────────────────────────────
    // Occupied bounds across one or more "q,r"-keyed layer stores.
    // Matches getLayersOccupiedBounds (sprite_editor.html:3328-3344):
    // returns null when nothing is occupied.
    function computeBounds(stores) {
        var minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
        for (var i = 0; i < stores.length; i++) {
            var store = stores[i] || {};
            for (var key in store) {
                if (!Object.prototype.hasOwnProperty.call(store, key)) continue;
                var qr = parseCellKey(key);
                if (!Number.isFinite(qr.q) || !Number.isFinite(qr.r)) continue;
                if (qr.q < minCol) minCol = qr.q;
                if (qr.r < minRow) minRow = qr.r;
                if (qr.q > maxCol) maxCol = qr.q;
                if (qr.r > maxRow) maxRow = qr.r;
            }
        }
        if (!Number.isFinite(minCol) || !Number.isFinite(minRow) ||
            !Number.isFinite(maxCol) || !Number.isFinite(maxRow)) {
            return null;
        }
        return { minCol: minCol, minRow: minRow, maxCol: maxCol, maxRow: maxRow };
    }

    // Generic 4-neighbour flood-fill traversal — the BFS skeleton
    // shared by every editor's floodFill (e.g. sprite_editor.html:2269-2281).
    // The caller supplies the region test and the per-cell action, so
    // stamp/tiling specifics stay editor-side.
    //   opts = { startQ, startR, gridW, gridH, match(q,r), visit(q,r) }
    // Returns the number of cells visited.
    function floodFillRegion(opts) {
        var startQ = opts.startQ, startR = opts.startR;
        var gridW = opts.gridW, gridH = opts.gridH;
        var match = opts.match, visit = opts.visit;
        var visited = new Set();
        var queue = [[startQ, startR]];
        var count = 0;
        while (queue.length) {
            var cell = queue.shift();
            var q = cell[0], r = cell[1];
            if (q < 0 || q >= gridW || r < 0 || r >= gridH) continue;
            var k = cellKey(q, r);
            if (visited.has(k)) continue;
            visited.add(k);
            if (!match(q, r)) continue;
            visit(q, r);
            count++;
            queue.push([q + 1, r], [q - 1, r], [q, r + 1], [q, r - 1]);
        }
        return count;
    }

    // Flatten a "q,r"-keyed dict to an origin-relative array.
    // Matches the _exportTileDict helper (sprite_editor.html:5125-5128).
    function serializeTileMap(dict, originQ, originR) {
        var out = [];
        dict = dict || {};
        for (var key in dict) {
            if (!Object.prototype.hasOwnProperty.call(dict, key)) continue;
            var qr = parseCellKey(key);
            var c = dict[key];
            out.push({
                localCol: qr.q - originQ,
                localRow: qr.r - originR,
                sheetPath: c.sheetPath,
                sx: c.sx, sy: c.sy, sw: c.sw, sh: c.sh,
            });
        }
        return out;
    }
    // Inverse of serializeTileMap: rebuild a "q,r"-keyed dict, offset
    // back onto the grid by (offQ, offR).
    function deserializeTileMap(arr, offQ, offR) {
        var dict = {};
        arr = arr || [];
        for (var i = 0; i < arr.length; i++) {
            var t = arr[i];
            dict[cellKey(t.localCol + offQ, t.localRow + offR)] = {
                sheetPath: t.sheetPath, sx: t.sx, sy: t.sy, sw: t.sw, sh: t.sh,
            };
        }
        return dict;
    }

    // ── variants ────────────────────────────────────────────
    // Deterministic sprite-variant index — the same hash the game
    // renderer uses (world_editor.html:411, terrain_editor.html:3359).
    function variantHash(q, r, n) {
        if (!n) return 0;
        return Math.abs((q * 73856093) ^ (r * 19349663)) % n;
    }
    // Weighted pick. `rand` is injectable for determinism/tests;
    // defaults to Math.random to preserve current behaviour
    // (terrain_editor.html:950-960).
    function pickWeightedVariant(variants, rand) {
        if (variants.length === 1) return variants[0];
        rand = rand || Math.random;
        var total = 0;
        for (var i = 0; i < variants.length; i++) total += (variants[i].probability || 1);
        var r = rand() * total;
        for (var j = 0; j < variants.length; j++) {
            r -= (variants[j].probability || 1);
            if (r <= 0) return variants[j];
        }
        return variants[0];
    }

    // ── undo/redo ───────────────────────────────────────────
    // Stack factory reconciling the sprite/interior/terrain undo
    // implementations. `snapshot()` returns an opaque state token;
    // `restore(token)` applies one. `max` caps the undo depth
    // (interior used 40, the others 50).
    function createUndoStack(opts) {
        opts = opts || {};
        var max = opts.max || 50;
        var snapshot = opts.snapshot;
        var restore = opts.restore;
        var undoStack = [];
        var redoStack = [];
        return {
            // Call before a mutation to record the pre-change state.
            push: function () {
                undoStack.push(snapshot());
                if (undoStack.length > max) undoStack.shift();
                redoStack = [];
            },
            undo: function () {
                if (!undoStack.length) return false;
                redoStack.push(snapshot());
                restore(undoStack.pop());
                return true;
            },
            redo: function () {
                if (!redoStack.length) return false;
                undoStack.push(snapshot());
                restore(redoStack.pop());
                return true;
            },
            clear: function () { undoStack = []; redoStack = []; },
            canUndo: function () { return undoStack.length > 0; },
            canRedo: function () { return redoStack.length > 0; },
            // Export/import the raw history — for editors (e.g. sprite) that
            // persist separate undo timelines across a mode switch. The
            // returned copies are safe to stash; setState replaces both stacks.
            getState: function () { return { undo: undoStack.slice(), redo: redoStack.slice() }; },
            setState: function (s) {
                undoStack = s && s.undo ? s.undo.slice() : [];
                redoStack = s && s.redo ? s.redo.slice() : [];
            },
        };
    }

    // ── images ──────────────────────────────────────────────
    function createImageCache() {
        return new Map();
    }
    // Promise-returning cached image loader. Matches
    // sprite_editor.html:2289-2296. `ImageCtor` is injectable so the
    // suite can test cache behaviour without a real DOM Image.
    function loadImage(cache, path, ImageCtor) {
        if (cache.has(path)) return Promise.resolve(cache.get(path));
        ImageCtor = ImageCtor || (typeof Image !== 'undefined' ? Image : null);
        return new Promise(function (resolve) {
            if (!ImageCtor) { cache.set(path, null); resolve(null); return; }
            var img = new ImageCtor();
            img.onload = function () { cache.set(path, img); resolve(img); };
            img.onerror = function () { cache.set(path, null); resolve(null); };
            img.src = path;
        });
    }

    // ── data patches ────────────────────────────────────────
    // Twin of src/core/dataPatch.js (the game applies these patches when it
    // loads mods); src/__tests__/dataPatch.test.js keeps the two in step.
    // A plain-object patch is applied key by key, "$delete" lists removed
    // keys and "$replace" swaps the whole value; anything else replaces.
    function isPlainObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }
    function cloneJson(v) {
        return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    }
    function hasOwn(o, k) {
        return Object.prototype.hasOwnProperty.call(o, k);
    }
    function deepEqual(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        var i;
        if (Array.isArray(a)) {
            if (a.length !== b.length) return false;
            for (i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
            return true;
        }
        var ka = Object.keys(a);
        if (ka.length !== Object.keys(b).length) return false;
        for (i = 0; i < ka.length; i++) {
            if (!hasOwn(b, ka[i]) || !deepEqual(a[ka[i]], b[ka[i]])) return false;
        }
        return true;
    }
    function createDataPatch(base, target) {
        if (deepEqual(base, target)) return undefined;
        if (!isPlainObject(base) || !isPlainObject(target)) {
            return isPlainObject(target) ? { $replace: cloneJson(target) } : cloneJson(target);
        }
        var patch = {};
        var removed = Object.keys(base).filter(function (k) { return !hasOwn(target, k); });
        if (removed.length) patch.$delete = removed;
        Object.keys(target).forEach(function (k) {
            var sub = hasOwn(base, k)
                ? createDataPatch(base[k], target[k])
                : (isPlainObject(target[k]) ? { $replace: cloneJson(target[k]) } : cloneJson(target[k]));
            if (sub !== undefined) patch[k] = sub;
        });
        return patch;
    }
    function applyDataPatch(base, patch) {
        if (patch === undefined) return cloneJson(base);
        if (!isPlainObject(patch)) return cloneJson(patch);
        if (hasOwn(patch, '$replace')) return cloneJson(patch.$replace);
        var out = isPlainObject(base) ? cloneJson(base) : {};
        (Array.isArray(patch.$delete) ? patch.$delete : []).forEach(function (k) { delete out[k]; });
        Object.keys(patch).forEach(function (k) {
            if (k !== '$delete') out[k] = applyDataPatch(out[k], patch[k]);
        });
        return out;
    }

    // ── data paths ──────────────────────────────────────────
    // A path is an array of keys/indices from a root value.
    function getAtPath(obj, path) {
        var cur = obj;
        for (var i = 0; i < path.length; i++) {
            if (cur === null || typeof cur !== 'object') return undefined;
            cur = cur[path[i]];
        }
        return cur;
    }
    // Set the value at a non-empty path, creating plain objects on the way.
    function setAtPath(obj, path, value) {
        var cur = obj;
        for (var i = 0; i < path.length - 1; i++) {
            if (cur[path[i]] === null || typeof cur[path[i]] !== 'object') cur[path[i]] = {};
            cur = cur[path[i]];
        }
        cur[path[path.length - 1]] = value;
    }
    // Remove the value at a non-empty path; array items are spliced out.
    function deleteAtPath(obj, path) {
        var parent = getAtPath(obj, path.slice(0, -1));
        var k = path[path.length - 1];
        if (Array.isArray(parent)) parent.splice(Number(k), 1);
        else if (parent && typeof parent === 'object') delete parent[k];
    }
    // Find keys and string values containing `query` (case-insensitive).
    // Returns [{ path, match: 'key'|'value', text }], shallowest first.
    function searchData(root, query, opts) {
        opts = opts || {};
        var maxResults = opts.maxResults || 200;
        var maxDepth = opts.maxDepth || 6;
        var q = String(query || '').trim().toLowerCase();
        var out = [];
        if (!q) return out;
        var queue = [{ v: root, path: [] }];
        while (queue.length && out.length < maxResults) {
            var node = queue.shift();
            var v = node.v;
            if (v === null || typeof v !== 'object' || node.path.length >= maxDepth) continue;
            var keys = Object.keys(v);
            for (var i = 0; i < keys.length && out.length < maxResults; i++) {
                var k = keys[i];
                var child = v[k];
                var p = node.path.concat(Array.isArray(v) ? Number(k) : k);
                if (!Array.isArray(v) && k.toLowerCase().indexOf(q) !== -1) {
                    out.push({ path: p, match: 'key', text: k });
                } else if (typeof child === 'string' && child.toLowerCase().indexOf(q) !== -1) {
                    out.push({ path: p, match: 'value', text: child });
                }
                if (child !== null && typeof child === 'object') queue.push({ v: child, path: p });
            }
        }
        return out;
    }

    // ── nine-tile brushes ───────────────────────────────────
    // Twin of src/core/nineTile.js, which the game stamps inner maps with;
    // src/__tests__/nineTile.test.js keeps the two in step. `has(dq, dr)`
    // says whether a neighbour is painted with the same brush.
    function pickNineTileSlot(has) {
        var hasTop = has(0, -1), hasBottom = has(0, 1), hasLeft = has(-1, 0), hasRight = has(1, 0);
        if (hasTop && hasBottom && hasLeft && hasRight) {
            var icIdx = !has(-1, -1) ? 0 : !has(1, -1) ? 1 : !has(-1, 1) ? 2 : !has(1, 1) ? 3 : -1;
            if (icIdx >= 0) return { ic: icIdx };
        }
        if ((!hasTop && !hasBottom) || (!hasLeft && !hasRight)) return null;
        var row = 1;
        if (!hasTop && hasBottom) row = 0;
        else if (hasTop && !hasBottom) row = 2;
        var col = 1;
        if (!hasLeft && hasRight) col = 0;
        else if (hasLeft && !hasRight) col = 2;
        return { row: row, col: col };
    }
    function ntHasTile(t) { return !!(t && t.sheetPath); }
    function ntGridHasTile(grid) {
        return Array.isArray(grid) && grid.some(function (row) { return Array.isArray(row) && row.some(ntHasTile); });
    }
    function ntListHasTile(list) { return Array.isArray(list) && list.some(ntHasTile); }
    function resolveBrushSeason(brush, season) {
        var st = season && brush.seasonTiles && brush.seasonTiles[season];
        var sc = season && brush.seasonInsideCorners && brush.seasonInsideCorners[season];
        var sa = season && brush.seasonAltFills && brush.seasonAltFills[season];
        return {
            tilesGrid: ntGridHasTile(st) ? st : (brush.tiles || null),
            cornersArr: ntListHasTile(sc) ? sc : (brush.insideCorners || null),
            altFills: ntListHasTile(sa) ? sa : null,
        };
    }
    function nineTileHash(q, r) {
        return Math.abs((q * 73856093) ^ (r * 19349663)) >>> 0;
    }
    // -> { slot: {row,col}|{ic}, tile|null, fallback: null|'strip'|'noInsideCorner'|'empty' }
    function resolveNineTileCell(brush, season, has, q, r, resolved) {
        var res = resolved || resolveBrushSeason(brush, season);
        var cornersArr = res.cornersArr;
        var slot = pickNineTileSlot(has);
        var fallback = null;
        if (!slot) {
            slot = { row: 1, col: 1 };
            fallback = 'strip';
        } else if (slot.ic !== undefined && !(cornersArr && ntHasTile(cornersArr[slot.ic]))) {
            slot = { row: 1, col: 1 };
            fallback = 'noInsideCorner';
        }
        var tile;
        if (slot.ic !== undefined) {
            tile = cornersArr[slot.ic];
        } else {
            tile = res.tilesGrid && res.tilesGrid[slot.row] ? res.tilesGrid[slot.row][slot.col] : null;
            if (slot.row === 1 && slot.col === 1 && res.altFills) {
                var pool = ntHasTile(tile) ? [tile].concat(res.altFills) : res.altFills;
                tile = pool[nineTileHash(q, r) % pool.length];
            }
        }
        if (!ntHasTile(tile)) {
            tile = null;
            if (!fallback) fallback = 'empty';
        }
        return { slot: slot, tile: tile, fallback: fallback };
    }
    function erodeUntileableStubs(mask) {
        var H = mask.length, W = H > 0 ? mask[0].length : 0;
        function inMask(q, r) { return r >= 0 && r < H && q >= 0 && q < W && !!mask[r][q]; }
        var eroded = true;
        while (eroded) {
            eroded = false;
            var toClear = [];
            for (var r = 0; r < H; r++) {
                for (var q = 0; q < W; q++) {
                    if (!mask[r][q]) continue;
                    var qq = q, rr = r;
                    if (!pickNineTileSlot(function (dq, dr) { return inMask(qq + dq, rr + dr); })) toClear.push([r, q]);
                }
            }
            for (var i = 0; i < toClear.length; i++) {
                mask[toClear[i][0]][toClear[i][1]] = false;
                eroded = true;
            }
        }
        return mask;
    }
    // A test shape for previewing a brush, as mask[r][q] booleans:
    //   'pond'   — a blob with bays and points (every corner kind)
    //   'ring'   — a field with a hole in it
    //   'coast'  — a wavy shore along the bottom
    //   'random' — scattered blobs from `seed`
    // Shapes are eroded the way the game erodes its masks.
    function nineTilePreviewMask(shape, w, h, seed) {
        var mask = [], r, q;
        for (r = 0; r < h; r++) { mask.push([]); for (q = 0; q < w; q++) mask[r].push(false); }
        function set(q0, r0, q1, r1, v) {
            for (var rr = Math.max(0, r0); rr <= Math.min(h - 1, r1); rr++)
                for (var qq = Math.max(0, q0); qq <= Math.min(w - 1, q1); qq++) mask[rr][qq] = v;
        }
        var cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        if (shape === 'ring') {
            set(1, 1, w - 2, h - 2, true);
            set(cx - 2, cy - 1, cx + 1, cy + 1, false);
            set(1, 1, 2, 2, false);
        } else if (shape === 'coast') {
            for (q = 0; q < w; q++) {
                var top = Math.round(h / 2 + Math.sin(q * 0.9) * 1.6 + (q % 4 === 0 ? 1 : 0));
                set(q, top, q, h - 1, true);
            }
        } else if (shape === 'random') {
            var s = (seed >>> 0) || 1;
            var rnd = function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
            for (var b = 0; b < 5; b++) {
                var bq = Math.floor(rnd() * w), br = Math.floor(rnd() * h);
                var bw = 2 + Math.floor(rnd() * 4), bh = 2 + Math.floor(rnd() * 3);
                set(bq - bw, br - bh, bq + bw, br + bh, true);
            }
            for (var k = 0; k < 4; k++) {
                var hq = Math.floor(rnd() * w), hr = Math.floor(rnd() * h);
                set(hq, hr, hq + 1, hr + 1, false);
            }
        } else {
            // pond: a body, a bay bitten from the top, a point to the right
            set(2, 2, w - 4, h - 3, true);
            set(cx - 1, 2, cx, 3, false);
            set(w - 4, cy - 1, w - 2, cy, true);
            set(3, h - 3, 5, h - 2, true);
            set(2, 2, 3, 3, false);
        }
        return erodeUntileableStubs(mask);
    }

    // ── blocked tile sides ──────────────────────────────────
    // Twin of src/core/tileSides.js. Sides are strings of n/e/s/w; nobody
    // crosses a blocked side of a tile, though they may stand on the tile.
    var SIDE_BITS = { n: 1, e: 2, s: 4, w: 8 };
    var SIDE_ORDER = ['n', 'e', 's', 'w'];
    function sidesMask(spec) {
        if (typeof spec === 'number') return spec & 15;
        if (!spec) return 0;
        var m = 0, list = Array.isArray(spec) ? spec : String(spec).split('');
        for (var i = 0; i < list.length; i++) m |= SIDE_BITS[String(list[i]).toLowerCase()] || 0;
        return m;
    }
    function sidesString(mask) {
        return SIDE_ORDER.filter(function (k) { return mask & SIDE_BITS[k]; }).join('');
    }
    function outerSidesForSlot(row, col) {
        return (row === 0 ? 'n' : '') + (col === 2 ? 'e' : '') + (row === 2 ? 's' : '') + (col === 0 ? 'w' : '');
    }
    // Turn one side on/off (flip when `on` is omitted); returns the new string.
    function toggleSide(spec, side, on) {
        var m = sidesMask(spec), bit = SIDE_BITS[side] || 0;
        if (on === undefined) on = !(m & bit);
        return sidesString(on ? (m | bit) : (m & ~bit));
    }
    // Which side of a tile a point is near: fx, fy are 0..1 within the tile.
    // Returns 'n'|'e'|'s'|'w', or null in the middle (outside the edge band).
    function sideAtPoint(fx, fy, band) {
        band = band || 0.25;
        var d = { n: fy, s: 1 - fy, w: fx, e: 1 - fx };
        var best = null;
        for (var i = 0; i < SIDE_ORDER.length; i++) {
            var k = SIDE_ORDER[i];
            if (d[k] <= band && (best === null || d[k] < d[best])) best = k;
        }
        return best;
    }

    var EditorCore = {
        slugify: slugify,
        escHtml: escHtml,
        cellKey: cellKey,
        parseCellKey: parseCellKey,
        screenToCell: screenToCell,
        screenToCellRaw: screenToCellRaw,
        ZOOM_STEPS: ZOOM_STEPS,
        zoomStep: zoomStep,
        zoomAtCursor: zoomAtCursor,
        computeBounds: computeBounds,
        floodFillRegion: floodFillRegion,
        serializeTileMap: serializeTileMap,
        deserializeTileMap: deserializeTileMap,
        variantHash: variantHash,
        pickWeightedVariant: pickWeightedVariant,
        createUndoStack: createUndoStack,
        createImageCache: createImageCache,
        loadImage: loadImage,
        deepEqual: deepEqual,
        createDataPatch: createDataPatch,
        applyDataPatch: applyDataPatch,
        getAtPath: getAtPath,
        setAtPath: setAtPath,
        deleteAtPath: deleteAtPath,
        searchData: searchData,
        pickNineTileSlot: pickNineTileSlot,
        resolveBrushSeason: resolveBrushSeason,
        nineTileHash: nineTileHash,
        resolveNineTileCell: resolveNineTileCell,
        erodeUntileableStubs: erodeUntileableStubs,
        nineTilePreviewMask: nineTilePreviewMask,
        sidesMask: sidesMask,
        sidesString: sidesString,
        outerSidesForSlot: outerSidesForSlot,
        toggleSide: toggleSide,
        sideAtPoint: sideAtPoint,
    };

    if (typeof window !== 'undefined') window.EditorCore = window.EditorCore || EditorCore;
    if (typeof globalThis !== 'undefined') globalThis.EditorCore = globalThis.EditorCore || EditorCore;
})();

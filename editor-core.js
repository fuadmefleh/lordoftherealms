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
    };

    if (typeof window !== 'undefined') window.EditorCore = window.EditorCore || EditorCore;
    if (typeof globalThis !== 'undefined') globalThis.EditorCore = globalThis.EditorCore || EditorCore;
})();

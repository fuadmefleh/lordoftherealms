/**
 * CustomObjects — runtime registry for editor-authored sprite objects.
 *
 * DATA CONTRACT
 * ─────────────
 * Two formats are supported:
 *
 * ── FORMAT A: Sheet-organized (legacy spritesheet_editor.html) ──
 *   {
 *     tileW: 32,  tileH: 32,
 *     sheets: {
 *       "<sheetName>": {
 *         path: "assets/lpc/...",
 *         width: <px>, height: <px>,
 *         objects: [
 *           {
 *             id, name, objectType,             // rock|tree|plant|decoration|building|furniture
 *             terrainBindings: [...],            // sub-terrain IDs
 *             spawnWeight: 1,
 *             sx, sy, sw, sh,                   // bounding box in sheet pixels
 *             bounds: { minCol, minRow, maxCol, maxRow },
 *             hasBlockedTiles, hasInteraction,
 *             tiles: [{ col, row, sx, sy, sw, sh, localCol, localRow,
 *                       impassable, interactionPoint }]
 *           }
 *         ]
 *       }
 *     }
 *   }
 *
 * ── FORMAT B: Composed / multi-sheet (from sprite_editor.html) ──
 *   {
 *     composed: true, tileW: 32, tileH: 32,
 *     objects: [
 *       {
 *         id, name, objectType,
 *         terrainBindings: [...],
 *         spawnWeight: 1,
 *         bounds: { minCol, minRow, maxCol, maxRow },
 *         hasBlockedTiles, hasInteraction,
 *         tiles: [{ localCol, localRow, sheetPath, sx, sy, sw, sh }],
 *         meta:  [{ localCol, localRow, impassable, interactionPoint }]
 *       }
 *     ]
 *   }
 *
 * USAGE (in innerMap.js generate()):
 *   // After terrain tiles are assigned, before returning:
 *   if (CustomObjects.isLoaded()) this._scatterCustomObjects(tiles, rng);
 *
 * TILE STORAGE (per InnerMap tile):
 *   tile.customObject = { defId, sheetPath }   — anchor tile (top-left of object footprint)
 *   tile.customObjectPart = { anchorQ, anchorR } — non-anchor footprint tiles
 *
 * RENDERING (in innerMapLayers.js _renderObjectLayer):
 *   If tile.customObject, look up def, draw each tile of the object.
 *   Skip tile.customObjectPart tiles during collection (avoid double-draw).
 */

const CustomObjects = (() => {
    // id → full definition (includes sheetName, sheetPath, tileW/H merged in)
    const _defs       = new Map();
    // sheetPath → HTMLImageElement
    const _images     = new Map();
    // subTerrainId → [def, ...]
    const _byTerrain  = new Map();
    // objects with no terrain bindings (placed on any passable terrain)
    const _unbound    = [];

    let _loaded = false;

    return {

        isLoaded() { return _loaded; },

        // ── Loading ────────────────────────────────────────────────

        /**
         * Load manifest + all referenced object files.
         * Uses DataLoader._gamedata when available; falls back to direct fetches.
         * Returns a Promise that resolves when all images are ready.
         */
        loadAll() {
            // ── shared per-file processor ───────────────────────────────────
            function processData(data) {
                if (!data) return;
                const tileW = data.tileW || 32;
                const tileH = data.tileH || 32;
                if (data.composed && Array.isArray(data.objects)) {
                    for (const obj of data.objects) {
                        const fullDef = { ...obj, sheetName: null, sheetPath: null, tileW, tileH };
                        _defs.set(obj.id, fullDef);
                        for (const terrainId of (obj.terrainBindings || [])) {
                            if (!_byTerrain.has(terrainId)) _byTerrain.set(terrainId, []);
                            _byTerrain.get(terrainId).push(fullDef);
                        }
                        if (!obj.terrainBindings || obj.terrainBindings.length === 0) _unbound.push(fullDef);
                        for (const td of (obj.tiles || [])) {
                            if (td.sheetPath && !_images.has(td.sheetPath)) _images.set(td.sheetPath, null);
                        }
                        for (const hs of (obj.healthStates || [])) {
                            for (const td of (hs.tiles || [])) {
                                if (td.sheetPath && !_images.has(td.sheetPath)) _images.set(td.sheetPath, null);
                            }
                        }
                        for (const sarr of Object.values(obj.seasonVariants || {})) {
                            for (const td of (sarr || [])) {
                                if (td.sheetPath && !_images.has(td.sheetPath)) _images.set(td.sheetPath, null);
                            }
                        }
                        for (const gs of (obj.growthStates || [])) {
                            for (const td of (gs.tiles || [])) {
                                if (td.sheetPath && !_images.has(td.sheetPath)) _images.set(td.sheetPath, null);
                            }
                        }
                    }
                    return;
                }
                for (const [sheetName, sheetDef] of Object.entries(data.sheets || {})) {
                    for (const obj of (sheetDef.objects || [])) {
                        const fullDef = { ...obj, sheetName, sheetPath: sheetDef.path, tileW, tileH };
                        _defs.set(obj.id, fullDef);
                        for (const terrainId of (obj.terrainBindings || [])) {
                            if (!_byTerrain.has(terrainId)) _byTerrain.set(terrainId, []);
                            _byTerrain.get(terrainId).push(fullDef);
                        }
                        if (!obj.terrainBindings || obj.terrainBindings.length === 0) _unbound.push(fullDef);
                    }
                    if (!_images.has(sheetDef.path)) _images.set(sheetDef.path, null);
                }
            }

            function loadImages() {
                const imgPromises = [];
                for (const [path] of _images) {
                    const p = new Promise(resolve => {
                        const img = new Image();
                        img.onload  = () => { _images.set(path, img); resolve(); };
                        img.onerror = () => { console.warn(`CustomObjects: image not found — ${path}`); resolve(); };
                        img.src = path;
                    });
                    imgPromises.push(p);
                }
                return Promise.all(imgPromises);
            }

            function finalize() {
                _loaded = true;
                console.log(`CustomObjects loaded: ${_defs.size} defs, ` +
                    `${_byTerrain.size} terrain bindings, ${_images.size} sheets`);
            }

            // ── Load from gamedata.json (single source of truth) ─────────
            if (typeof DataLoader !== 'undefined' && DataLoader._gamedata && DataLoader._gamedata.custom_objects) {
                const co = DataLoader._gamedata.custom_objects;
                const manifest = co.manifest || {};
                const files = co.files || {};
                if (Array.isArray(manifest.files)) {
                    for (const filename of manifest.files) {
                        const data = files[filename];
                        if (!data) { console.warn(`CustomObjects: missing file in gamedata: ${filename}`); continue; }
                        processData(data);
                    }
                }
                return loadImages().catch(err => {
                    console.warn('CustomObjects: image load error —', err);
                }).finally(finalize);
            }

            // No DataLoader / no custom_objects in gamedata — nothing to load
            console.info('CustomObjects: no custom_objects found in gamedata.json');
            finalize();
            return Promise.resolve();
        },

        // ── Queries ────────────────────────────────────────────────

        getObjectsForTerrain(terrainId) {
            return _byTerrain.get(terrainId) || [];
        },

        /**
         * Weighted-random pick for a given terrain.
         * rngVal should be a uniform [0, 1) value.
         */
        pickObjectForTerrain(terrainId, rngVal) {
            const pool = this.getObjectsForTerrain(terrainId);
            if (!pool.length) return null;

            const total = pool.reduce((s, d) => s + (d.spawnWeight || 1), 0);
            let r = rngVal * total;
            for (const def of pool) {
                r -= (def.spawnWeight || 1);
                if (r <= 0) return def;
            }
            return pool[pool.length - 1];
        },

        getImage(path)  { return _images.get(path) || null; },
        getDef(id)      { return _defs.get(id)     || null; },

        /** Return an iterable of all registered definitions. */
        getAllDefs() { return _defs.values(); },

        /** Return the list of objects with no terrain bindings (universal) */
        getUnboundObjects() { return _unbound; },

        /** True if there is at least one def available for scattering */
        hasAnyBindings() { return _byTerrain.size > 0 || _unbound.length > 0; },
    };
})();

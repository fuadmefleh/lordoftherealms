/**
 * CustomBuildings — runtime registry for editor-authored buildings.
 *
 * WORKFLOW
 * ────────
 * 1. Design buildings in sprite_editor.html (Building mode).
 * 2. Click "Export JSON" → enter a filename (e.g. "village_houses") → download.
 * 3. Move the file to  data/custom_buildings/<filename>.json
 * 4. Add the filename to  data/custom_buildings/manifest.json → "files" array.
 * 5. Repeat for as many packs as you like.  All are loaded at runtime automatically.
 *
 * MANIFEST FORMAT  (data/custom_buildings/manifest.json)
 * ───────────────────────────────────────────────────────
 * {
 *   "files": ["village_houses.json", "city_buildings.json", ...]
 * }
 *
 * BUILDING FILE FORMAT  (as exported by sprite_editor.html)
 * ─────────────────────────────────────────────────────────────
 * {
 *   "buildings": [
 *     {
 *       id, name, buildingType, width, height, tags,
 *       layers: { floor/walls/roof/overlay: [{q,r,sheetPath,sx,sy,sw,sh},...] },
 *       meta:   [{q,r,impassable,door},...]
 *     }, ...
 *   ]
 * }
 *
 * This module is referenced by:
 *   js/world/innerMap.js     → _placeCustomBuildings()
 *   js/ui/innerMapLayers.js  → _renderBuildingLayer() / _drawCustomBuilding()
 *   js/ui/innerMapRenderer.js → loadSheets()  (calls CustomBuildings.loadAll())
 */
const CustomBuildings = (() => {
    const _defs     = new Map();   // id → normalised def
    const _byType   = new Map();   // buildingType → [def, ...]
    const _imgCache = new Map();   // sheetPath → HTMLImageElement | null (pending)
    let   _loaded   = false;

    // Which building types are eligible for each settlement type.
    const SETTLEMENT_TYPES = {
        capital: ['castle', 'barracks', 'church', 'market', 'tavern', 'house', 'warehouse', 'tower', 'other'],
        city:    ['market', 'tavern', 'blacksmith', 'church', 'house', 'warehouse', 'barracks', 'other'],
        town:    ['market', 'tavern', 'blacksmith', 'church', 'house', 'farm', 'other'],
        village: ['house', 'farm', 'church', 'tavern', 'decoration', 'other'],
    };

    function loadImg(path) {
        if (_imgCache.get(path) instanceof HTMLImageElement) return Promise.resolve();
        return new Promise(resolve => {
            const img = new Image();
            img.onload  = () => { _imgCache.set(path, img); resolve(); };
            img.onerror = () => { console.warn(`[CustomBuildings] image missing: ${path}`); resolve(); };
            img.src = path;
        });
    }

    function registerBuilding(b) {
        if (!b.id || !b.layers) return;

        // Normalise layers to arrays and build per-cell lookup maps
        const layerMaps = {};
        let bMinQ = Infinity, bMinR = Infinity, bMaxQ = -Infinity, bMaxR = -Infinity;
        for (const [ln, arr] of Object.entries(b.layers)) {
            const cells = Array.isArray(arr) ? arr : Object.entries(arr).map(([k, v]) => {
                const [q, r] = k.split(',').map(Number);
                return { q, r, ...v };
            });
            layerMaps[ln] = {};
            for (const c of cells) {
                layerMaps[ln][`${c.q},${c.r}`] = c;
                if (c.sheetPath) _imgCache.set(c.sheetPath, _imgCache.get(c.sheetPath) || null);
                if (c.q < bMinQ) bMinQ = c.q; if (c.q > bMaxQ) bMaxQ = c.q;
                if (c.r < bMinR) bMinR = c.r; if (c.r > bMaxR) bMaxR = c.r;
            }
        }

        // Build meta lookup map
        const metaMap = {};
        for (const m of (Array.isArray(b.meta) ? b.meta : [])) {
            metaMap[`${m.q},${m.r}`] = m;
        }

        // Compute bounds if not present (backward compat: defaults to 0..width-1, 0..height-1)
        const bounds = b.bounds || (bMinQ !== Infinity
            ? { minCol: bMinQ, minRow: bMinR, maxCol: bMaxQ, maxRow: bMaxR }
            : { minCol: 0, minRow: 0, maxCol: (b.width || 1) - 1, maxRow: (b.height || 1) - 1 });

        const def = { ...b, bounds, _layerMaps: layerMaps, _metaMap: metaMap };
        _defs.set(b.id, def);

        const t = b.buildingType || 'other';
        if (!_byType.has(t)) _byType.set(t, []);
        _byType.get(t).push(def);
    }

    function loadFile(url) {
        return fetch(url)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
            .then(data => {
                if (!data) { console.warn(`[CustomBuildings] could not load: ${url}`); return; }
                const buildings = data.buildings || (Array.isArray(data) ? data : []);
                for (const b of buildings) registerBuilding(b);
            });
    }

    return {
        isLoaded() { return _loaded; },
        hasAny()   { return _defs.size > 0; },

        getBuilding(id) { return _defs.get(id) || null; },
        getByType(type) { return _byType.get(type) || []; },
        getImg(path)    { return _imgCache.get(path) || null; },

        /**
         * Return all building defs eligible for the given settlement type,
         * in a randomly-shuffled order (so each map gets different buildings).
         */
        getAllForSettlement(settlementType, rng) {
            const eligible = SETTLEMENT_TYPES[settlementType] || SETTLEMENT_TYPES.village;
            const pool = [];
            for (const t of eligible) {
                const arr = _byType.get(t);
                if (arr) pool.push(...arr);
            }
            // Fisher-Yates shuffle
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
            }
            return pool;
        },

        /**
         * Load custom buildings from gamedata.json (via DataLoader) when available,
         * otherwise fall back to direct fetches.
         * Returns a Promise that resolves when all buildings and images are ready.
         */
        loadAll() {
            if (_loaded) return Promise.resolve();

            // ── Load from gamedata.json (single source of truth) ─────────
            if (typeof DataLoader !== 'undefined' && DataLoader._gamedata && DataLoader._gamedata.custom_buildings) {
                const cb = DataLoader._gamedata.custom_buildings;
                const manifest = cb.manifest || {};
                const files = cb.files || {};
                if (Array.isArray(manifest.files) && manifest.files.length > 0) {
                    for (const filename of manifest.files) {
                        const data = files[filename];
                        if (!data) { console.warn(`[CustomBuildings] missing file in gamedata: ${filename}`); continue; }
                        const buildings = data.buildings || (Array.isArray(data) ? data : []);
                        for (const b of buildings) registerBuilding(b);
                    }
                }
                const pending = [];
                for (const [path, cached] of _imgCache) {
                    if (!(cached instanceof HTMLImageElement)) pending.push(loadImg(path));
                }
                return Promise.all(pending).finally(() => {
                    _loaded = true;
                    if (_defs.size > 0)
                        console.log(`[CustomBuildings] loaded ${_defs.size} building(s) across ${_byType.size} type(s)`);
                    else
                        console.info('[CustomBuildings] no buildings loaded — add entries via the editor and rebuild gamedata.json');
                });
            }

            // No DataLoader / no custom_buildings in gamedata — nothing to load
            console.info('[CustomBuildings] no custom_buildings found in gamedata.json');
            _loaded = true;
            return Promise.resolve();
        }
    };
})();

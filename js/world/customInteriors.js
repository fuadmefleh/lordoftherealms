// ═══════════════════════════════════════════════════════════
//  CUSTOM INTERIORS — Runtime loader & registry
//  Mirrors CustomBuildings: loads authored interior layouts
//  from gamedata.json and provides an API for the inner map
//  to pick interiors for buildings.
// ═══════════════════════════════════════════════════════════
//
//  Data flow:
//  1. Editor: interior_editor.html → saves to gamedata.json
//     under custom_interiors.files['interiors.json'].interiors[]
//  2. Runtime: DataLoader loads gamedata.json
//  3. CustomInteriors.loadAll() registers all interior defs
//  4. InnerMap._generateInterior() queries CustomInteriors
//     for available interiors matching the building type
//  5. One interior is chosen deterministically per building
//     instance and cached permanently.
//
//  Interior def format (exported from editor):
//  {
//    id: "cozy_tavern",
//    name: "Cozy Tavern",
//    buildingType: "tavern",
//    tags: ["cozy","wooden"],
//    variantGroup: "tavern_interiors",   // optional grouping
//    tileW: 32, tileH: 32,
//    width: 10, height: 8,
//    bounds: { minCol, minRow, maxCol, maxRow },
//    layers: {
//      floor: [{ q, r, sheetPath, sx, sy, sw, sh }, ...],
//      walls: [...],
//      overlay: [...]
//    },
//    meta: [
//      { q, r, impassable: true },
//      { q, r, door: true },
//      { q, r, furniture: { type, name, icon, passable } },
//      ...
//    ]
//  }
// ═══════════════════════════════════════════════════════════

const CustomInteriors = (() => {
    const _defs     = new Map();   // id → normalised def
    const _byType   = new Map();   // buildingType → [def, ...]
    const _byGroup  = new Map();   // variantGroup → [def, ...]
    const _imgCache = new Map();   // sheetPath → HTMLImageElement | null
    let   _loaded   = false;

    // ─── Image preloading ───
    function loadImg(path) {
        if (_imgCache.get(path) instanceof HTMLImageElement) return Promise.resolve();
        return new Promise(resolve => {
            const img = new Image();
            img.onload  = () => { _imgCache.set(path, img); resolve(); };
            img.onerror = () => { console.warn(`[CustomInteriors] image missing: ${path}`); _imgCache.set(path, null); resolve(); };
            img.src = path;
        });
    }

    // ─── Register an interior definition ───
    function registerInterior(raw) {
        if (!raw.id || !raw.layers) return;

        // Normalise layers to per-cell lookup maps (like CustomBuildings)
        const layerMaps = {};
        let bMinQ = Infinity, bMinR = Infinity, bMaxQ = -Infinity, bMaxR = -Infinity;
        for (const [ln, arr] of Object.entries(raw.layers)) {
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

        // Parse meta into lookup map
        const metaMap = {};
        const metaArr = Array.isArray(raw.meta) ? raw.meta : Object.entries(raw.meta || {}).map(([k, v]) => {
            const [q, r] = k.split(',').map(Number);
            return { q, r, ...v };
        });
        for (const m of metaArr) {
            metaMap[`${m.q},${m.r}`] = m;
        }

        const bounds = raw.bounds || (bMinQ !== Infinity
            ? { minCol: bMinQ, minRow: bMinR, maxCol: bMaxQ, maxRow: bMaxR }
            : { minCol: 0, minRow: 0, maxCol: (raw.width || 1) - 1, maxRow: (raw.height || 1) - 1 });

        const def = {
            ...raw,
            bounds,
            _layerMaps: layerMaps,
            _metaMap:   metaMap,
            width:  bounds.maxCol - bounds.minCol + 1,
            height: bounds.maxRow - bounds.minRow + 1,
        };
        _defs.set(raw.id, def);

        // Index by building type
        const bType = raw.buildingType || 'other';
        if (!_byType.has(bType)) _byType.set(bType, []);
        _byType.get(bType).push(def);

        // Index by variant group
        if (raw.variantGroup) {
            if (!_byGroup.has(raw.variantGroup)) _byGroup.set(raw.variantGroup, []);
            _byGroup.get(raw.variantGroup).push(def);
        }
    }

    // ─── Public API ───
    return {
        isLoaded() { return _loaded; },
        hasAny()   { return _defs.size > 0; },

        /** Get a specific interior definition by ID */
        getInterior(id) { return _defs.get(id) || null; },

        /** Get all interiors for a building type */
        getByType(type) { return _byType.get(type) || []; },

        /** Get all interiors in a variant group */
        getByGroup(group) { return _byGroup.get(group) || []; },

        /** Get a cached sprite image */
        getImg(path) { return _imgCache.get(path) || null; },

        /** Get all registered interiors */
        getAll() { return [..._defs.values()]; },

        /**
         * Pick an interior that is explicitly linked to a specific custom building
         * definition id (via linkedBuildingIds array in interior data).
         * @param {string} buildingDefId - The custom building definition id
         * @returns {Object|null} The linked interior def, or null if none
         */
        pickForBuildingId(buildingDefId) {
            if (!buildingDefId) return null;
            for (const def of _defs.values()) {
                const ids = def.linkedBuildingIds || (def.linkedBuildingId ? [def.linkedBuildingId] : []);
                if (ids.includes(buildingDefId)) return def;
            }
            return null;
        },

        /**
         * Pick a single interior for a building instance, deterministically.
         * Uses a seeded hash so the same building always gets the same interior.
         * @param {string} buildingType - The building type to match
         * @param {string} seed - A unique identifier for this building instance
         *                        (e.g. "worldQ,worldR_type_bldgQ_bldgR")
         * @returns {Object|null} The chosen interior def, or null if none available
         */
        pickForBuilding(buildingType, seed) {
            const pool = _byType.get(buildingType) || [];
            if (pool.length === 0) return null;
            if (pool.length === 1) return pool[0];

            // Simple deterministic hash from seed string
            let hash = 0;
            for (let i = 0; i < seed.length; i++) {
                hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
            }
            const idx = Math.abs(hash) % pool.length;
            return pool[idx];
        },

        /**
         * Load all interior definitions from DataLoader gamedata.
         * Reads from the flat `interiors` array, or falls back to legacy nested format.
         */
        loadAll() {
            _defs.clear();
            _byType.clear();
            _byGroup.clear();
            _loaded = false;

            const gd = (typeof DataLoader !== 'undefined' && DataLoader._gamedata)
                ? DataLoader._gamedata
                : null;

            if (!gd) {
                _loaded = true;
                console.info('[Interiors] No gamedata available');
                return Promise.resolve();
            }

            // ── New flat format: gamedata.interiors = [...]  ─────────
            const arr = gd.interiors;
            if (Array.isArray(arr)) {
                for (const raw of arr) registerInterior(raw);
            }

            // ── Legacy nested format (custom_interiors.manifest/files) ──
            if (!arr && gd.custom_interiors) {
                const section = gd.custom_interiors;
                const manifest = section.manifest || {};
                const files = section.files || {};
                const fileNames = manifest.files || Object.keys(files);
                for (const filename of fileNames) {
                    const data = files[filename];
                    if (!data) continue;
                    const interiorArr = data.interiors || (Array.isArray(data) ? data : []);
                    for (const raw of interiorArr) registerInterior(raw);
                }
            }

            console.info(`[Interiors] Loaded ${_defs.size} interior(s) for ${_byType.size} building type(s)`);

            // Preload all referenced spritesheet images
            const paths = [..._imgCache.keys()].filter(p => !(_imgCache.get(p) instanceof HTMLImageElement));
            if (paths.length === 0) {
                _loaded = true;
                return Promise.resolve();
            }

            return Promise.all(paths.map(loadImg)).then(() => {
                _loaded = true;
                console.info(`[Interiors] Preloaded ${paths.length} spritesheet(s)`);
            });
        },
    };
})();

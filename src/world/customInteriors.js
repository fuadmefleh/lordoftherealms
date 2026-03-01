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

import { DataLoader } from '../core/dataLoader.js';

const _defs     = new Map();   // id → normalised def
const _byType   = new Map();   // buildingType → [def, ...]
const _byGroup  = new Map();   // variantGroup → [def, ...]
const _imgCache = new Map();   // sheetPath → HTMLImageElement | null
const _brushes  = [];          // All nine-tile brush definitions (floor + wall)
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

// ─── Register a nine-tile brush definition ───
function registerBrush(raw) {
    if (!raw || !raw.id) return;
    // Avoid duplicates
    if (_brushes.find(b => b.id === raw.id)) return;
    _brushes.push(raw);
    // Register all sheet paths for preloading
    const registerTile = (t) => {
        if (t && t.sheetPath) _imgCache.set(t.sheetPath, _imgCache.get(t.sheetPath) || null);
    };
    if (raw.tiles) for (const row of raw.tiles) if (row) for (const t of row) registerTile(t);
    if (raw.insideCorners) for (const t of raw.insideCorners) registerTile(t);
    if (raw.corridors) for (const t of raw.corridors) registerTile(t);
    if (raw.endCaps) for (const t of raw.endCaps) registerTile(t);
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
export const CustomInteriors = {
    isLoaded() { return _loaded; },
    hasAny()   { return _defs.size > 0; },

    /** Register a player-built interior at runtime */
    registerInterior(raw) { registerInterior(raw); },

    /** Get all nine-tile brushes */
    getBrushes() { return _brushes; },

    /** Get all floor-type brushes */
    getFloorBrushes() { return _brushes.filter(b => b.brushType === 'floor'); },

    /** Get all wall-type brushes */
    getWallBrushes() { return _brushes.filter(b => b.brushType === 'wall'); },

    /**
     * Pick a floor brush deterministically from a seed string.
     * @param {string} [seed] - Seed for deterministic selection
     * @returns {Object|null} Brush definition or null
     */
    pickFloorBrush(seed) {
        const pool = _brushes.filter(b => b.brushType === 'floor');
        if (pool.length === 0) return null;
        if (pool.length === 1) return pool[0];
        let hash = 0;
        for (let i = 0; i < (seed||'').length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
        return pool[Math.abs(hash) % pool.length];
    },

    /**
     * Pick a wall brush deterministically from a seed string.
     * @param {string} [seed] - Seed for deterministic selection
     * @returns {Object|null} Brush definition or null
     */
    pickWallBrush(seed) {
        const pool = _brushes.filter(b => b.brushType === 'wall');
        if (pool.length === 0) return null;
        if (pool.length === 1) return pool[0];
        let hash = 0;
        for (let i = 0; i < (seed||'').length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
        return pool[Math.abs(hash) % pool.length];
    },

    /**
     * Resolve which brush tile to use for a given position using auto-tile logic.
     * Replicates the interior_editor's recomputeNineTile algorithm.
     * @param {Object} brush - Brush definition
     * @param {number} q - Column position
     * @param {number} r - Row position
     * @param {Object} brushGroupMap - Dict "q,r" → {brushId, layer}
     * @param {number} gridW - Grid width
     * @param {number} gridH - Grid height
     * @returns {Object|null} Tile ref {sheetPath, sx, sy, sw, sh} or null
     */
    resolveNineTile(brush, q, r, brushGroupMap, gridW, gridH) {
        if (!brush) return null;
        const key = `${q},${r}`;
        const entry = brushGroupMap[key];
        if (!entry) return null;
        const groupId = entry.brushId;

        // Check neighbor membership
        const has = (dq, dr) => {
            const nq = q + dq, nr = r + dr;
            if (nq < 0 || nq >= gridW || nr < 0 || nr >= gridH) return false;
            const nk = `${nq},${nr}`;
            return brushGroupMap[nk] && brushGroupMap[nk].brushId === groupId;
        };

        const hasTop = has(0, -1), hasBottom = has(0, 1), hasLeft = has(-1, 0), hasRight = has(1, 0);
        const hasTL = has(-1, -1), hasTR = has(1, -1), hasBL = has(-1, 1), hasBR = has(1, 1);
        const cardCount = (hasTop?1:0) + (hasBottom?1:0) + (hasLeft?1:0) + (hasRight?1:0);

        // Wall brush corridor / junction logic
        if (brush.brushType === 'wall' && brush.corridors) {
            // Solo tile
            if (cardCount === 0 && brush.corridors[7]) return brush.corridors[7];
            // End caps
            if (cardCount === 1 && brush.endCaps) {
                let ecIdx = -1;
                if (hasBottom && !hasTop && !hasLeft && !hasRight) ecIdx = 0;
                else if (hasTop && !hasBottom && !hasLeft && !hasRight) ecIdx = 1;
                else if (hasRight && !hasTop && !hasBottom && !hasLeft) ecIdx = 2;
                else if (hasLeft && !hasTop && !hasBottom && !hasRight) ecIdx = 3;
                if (ecIdx >= 0 && brush.endCaps[ecIdx]) return brush.endCaps[ecIdx];
            }
            // Vertical corridor
            if (hasTop && hasBottom && !hasLeft && !hasRight && brush.corridors[0]) return brush.corridors[0];
            // Horizontal corridor
            if (hasLeft && hasRight && !hasTop && !hasBottom && brush.corridors[1]) return brush.corridors[1];
            // T-junctions
            if (cardCount === 3) {
                let tIdx = -1;
                if (hasLeft && hasRight && hasBottom && !hasTop) tIdx = 2;
                else if (hasLeft && hasRight && hasTop && !hasBottom) tIdx = 3;
                else if (hasTop && hasBottom && hasRight && !hasLeft) tIdx = 4;
                else if (hasTop && hasBottom && hasLeft && !hasRight) tIdx = 5;
                if (tIdx >= 0 && brush.corridors[tIdx]) return brush.corridors[tIdx];
            }
            // Cross
            if (cardCount === 4 && brush.corridors[6]) {
                const diagCount = (hasTL?1:0) + (hasTR?1:0) + (hasBL?1:0) + (hasBR?1:0);
                if (diagCount < 4) { /* fall through to inside corners */ }
            }
        }

        // Inside corners: all 4 cardinals but missing diagonal
        if (hasTop && hasBottom && hasLeft && hasRight && brush.insideCorners) {
            const icIdx = !hasTL ? 0 : !hasTR ? 1 : !hasBL ? 2 : !hasBR ? 3 : -1;
            if (icIdx >= 0 && brush.insideCorners[icIdx]) return brush.insideCorners[icIdx];
        }

        // Standard 3×3 mapping
        let row = 1;
        if (!hasTop && hasBottom) row = 0;
        else if (hasTop && !hasBottom) row = 2;
        // else: both present OR both absent → center (row=1)

        let col = 1;
        if (!hasLeft && hasRight) col = 0;
        else if (hasLeft && !hasRight) col = 2;
        // else: both present OR both absent → center (col=1)

        const tileRef = brush.tiles && brush.tiles[row] && brush.tiles[row][col];
        return tileRef || null;
    },

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
        _brushes.length = 0;
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

        // ── Load nine-tile brushes ─────────────────────────────
        // 1. Top-level interiorBrushes array in gamedata
        if (Array.isArray(gd.interiorBrushes)) {
            for (const b of gd.interiorBrushes) registerBrush(b);
        }
        // 2. Extract brushes embedded inside individual interior definitions
        for (const def of _defs.values()) {
            if (Array.isArray(def.nineTileBrushes)) {
                for (const b of def.nineTileBrushes) registerBrush(b);
            }
        }

        console.info(`[Interiors] Loaded ${_defs.size} interior(s) for ${_byType.size} building type(s), ${_brushes.length} brush(es)`);

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

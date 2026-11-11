/**
 * CustomBuildings — runtime registry for building definitions.
 *
 * DATA FORMAT  (gamedata.json → "buildings" key)
 * ──────────────────────────────────────────────
 * "buildings": [
 *   {
 *     id, name, buildingType, width, height, tags,
 *     layers: { floor/walls/roof/overlay: [{q,r,sheetPath,sx,sy,sw,sh},...] },
 *     meta:   [{q,r,impassable,door},...]
 *   }, ...
 * ]
 *
 * Buildings are authored in sprite_editor.html (Building mode) and
 * stored directly in gamedata.json as the game's baseline data.
 *
 * This module is referenced by:
 *   src/world/innerMap.js      → _placeCustomBuildings()
 *   src/ui/innerMapLayers.js   → _renderBuildingLayer() / _drawCustomBuilding()
 *   src/ui/innerMapRenderer.js → loadSheets()  (calls CustomBuildings.loadAll())
 */

import { DataLoader } from '../core/dataLoader.js';
import { loadSheetInto } from '../core/customSheets.js';

const _defs     = new Map();   // id → normalised def
const _byType   = new Map();   // buildingType → [def, ...]
const _byCulture = new Map();  // 'Culture|buildingType' → [def, ...] (a culture's own buildings)
const _tiers    = new Map();   // 'baseId|tier' → the building as that tier builds it (kept out of every pool)
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
        // (a detail sheet repainted in the modern style loads its repaint, else the original: core/customSheets.js)
        loadSheetInto(img, path, DataLoader._gamedata, () => { console.warn(`[CustomBuildings] image missing: ${path}`); resolve(); });
    });
}

/**
 * A tier variant (scripts/compose-buildings.js `derive`): its building's layers with the
 * patch laid on: per layer the cells that differ by index, or the whole layer anew.
 */
function expandDerived(b) {
    const base = _defs.get(b.derivedFrom);
    if (!base || !base.layers) return null;
    const sheets = Array.isArray(b.sheets) ? b.sheets : [];
    const layers = {};
    for (const [ln, arr] of Object.entries(base.layers)) layers[ln] = Array.isArray(arr) ? arr.map(c => ({ ...c })) : arr;
    for (const [ln, p] of Object.entries(b.patch || {})) {
        if (p && Array.isArray(p.all)) {
            layers[ln] = p.all.map(([q, r, si, sx, sy, sw, sh]) => ({ q, r, sheetPath: sheets[si], sx, sy, sw, sh }));
            continue;
        }
        const cells = layers[ln];
        if (!Array.isArray(cells) || !Array.isArray(p)) continue;
        for (const [i, si, sx, sy, sw, sh] of p) {
            const c = cells[i];
            if (!c) continue;
            c.sheetPath = sheets[si];
            c.sx = sx; c.sy = sy;
            c.sw = sw != null ? sw : 32;
            c.sh = sh != null ? sh : 32;
        }
    }
    const { patch: _p, sheets: _s, ...rest } = b;
    return { ...base, ...rest, layers, meta: base.meta, bounds: base.bounds, _layerMaps: undefined, _metaMap: undefined };
}

function registerBuilding(b, pooled = true) {
    // A culture building as the poor, middling or rich build it: registered by its own id
    // (a tile names it) and found from its building by tierVariant, never drawn from a pool
    if (b && b.derivedFrom) {
        const full = expandDerived(b);
        if (!full) return;
        registerBuilding({ ...full, derivedFrom: undefined, _derivedFrom: b.derivedFrom }, false);
        _tiers.set(`${b.derivedFrom}|${b.tier}`, _defs.get(b.id));
        return;
    }
    if (!b.id || !b.layers) {
        console.warn(`[Buildings] skipping building: missing id=${b.id} or layers`, b.name || b);
        return;
    }

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
    if (!pooled) return;

    const t = b.buildingType || 'other';
    // A culture's own building (data/architecture.json) stands only in that culture's towns,
    // so it is kept out of the pools every other town (and every older save) draws from
    if (b.culture) {
        const k = `${b.culture}|${t}`;
        if (!_byCulture.has(k)) _byCulture.set(k, []);
        _byCulture.get(k).push(def);
        return;
    }
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

export const CustomBuildings = {
    isLoaded() { return _loaded; },
    hasAny()   { return _defs.size > 0; },

    /** Clear all registered defs and images so loadAll() can rebuild from fresh gamedata. */
    reset() {
        _defs.clear();
        _byType.clear();
        _byCulture.clear();
        _tiers.clear();
        _imgCache.clear();
        _loaded = false;
    },

    getBuilding(id) { return _defs.get(id) || null; },
    getByType(type) { return _byType.get(type) || []; },
    /** A culture's own buildings of a type (data/architecture.json), [] when it has none */
    getByCulture(culture, type) { return _byCulture.get(`${culture}|${type}`) || []; },
    getImg(path)    { return _imgCache.get(path) || null; },

    /**
     * The building as a wealth tier builds it ('poor' | 'mid' | 'rich': data/architecture.json
     * culture `tiers`): the same footprint in that tier's walls, roof and windows. The building
     * itself where it has no such variant (a common building, an unknown tier).
     */
    tierVariant(def, tier) {
        if (!def || !tier) return def;
        const id = def._derivedFrom || def.id;
        return _tiers.get(`${id}|${tier}`) || (def._derivedFrom ? _defs.get(id) || def : def);
    },

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
     * Load buildings from gamedata.json (via DataLoader).
     * Reads from the flat `buildings` array in gamedata.
     * Returns a Promise that resolves when all buildings and images are ready.
     */
    async loadAll() {
        if (_loaded) return;

        // Ensure gamedata is loaded (including IndexedDB merge) before reading buildings
        if (typeof DataLoader !== 'undefined') {
            if (!DataLoader._gamedata) {
                await DataLoader.load('buildings');  // triggers _loadGamedata() if needed
            }
        }

        if (typeof DataLoader !== 'undefined' && DataLoader._gamedata) {
            // ── New flat format: gamedata.buildings = [...]  ─────────
            const arr = DataLoader._gamedata.buildings;
            if (Array.isArray(arr)) {
                for (const b of arr) registerBuilding(b);
            }

            // ── Legacy nested format (custom_buildings.manifest/files) ──
            if (!arr && DataLoader._gamedata.custom_buildings) {
                const cb = DataLoader._gamedata.custom_buildings;
                const manifest = cb.manifest || {};
                const files = cb.files || {};
                for (const filename of (manifest.files || Object.keys(files))) {
                    const data = files[filename];
                    if (!data) continue;
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
                if (_defs.size > 0) {
                    console.log(`[Buildings] loaded ${_defs.size} building(s) across ${_byType.size} type(s)`);
                    for (const [type, arr] of _byType) {
                        console.log(`  type '${type}': ${arr.length} building(s) → [${arr.map(d => d.id).join(', ')}]`);
                    }
                } else
                    console.info('[Buildings] no buildings found in gamedata.json');
            });
        }

        console.info('[Buildings] no gamedata available');
        _loaded = true;
        return Promise.resolve();
    },

    /**
     * Register a player-built building at runtime.
     * @param {Object} def - Building definition (same format as gamedata buildings)
     */
    _registerPlayerBuilding(def) {
        registerBuilding(def);
    },

    /**
     * Inject a preloaded image into the building image cache.
     * Used by the building creator to share its already-loaded images.
     * @param {string} path
     * @param {HTMLImageElement} img
     */
    _injectImg(path, img) {
        if (img instanceof HTMLImageElement) {
            _imgCache.set(path, img);
        }
    },
};


import { InnerMap } from '../world/innerMap.js';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { CustomObjects } from '../world/customObjects.js';
import { CustomBuildings } from '../world/customBuildings.js';
import { CustomInteriors } from '../world/customInteriors.js';
import { LightSystem } from './lightSystem.js';
import { InnerMapCombat } from './innerMapCombat.js';

﻿// ============================================
// INNER MAP RENDERER — LPC (Liberated Pixel Cup) Style
// Multi-layer orthographic renderer using ONLY LPC sprite assets.
// Inspired by C# IsoMapRenderer: clear layer separation,
// camera-based coordinate transforms, native 32×32 tile grid.
//
// Layers (bottom to top):
//   0 — Terrain  (ground fills from LPC terrain sheets)
//   1 — Roads    (dirt-path fills on road tiles)
//   2 — Objects  (trees, plants, flowers, rocks — sorted by Y)
//   3 — Buildings (LPC structure sprites)
//   4 — Fog-of-war + weather tints
//   5 — Encounters
//   6 — NPCs
//   7 — Player
//   8 — Highlights (hover / selection)
//   9 — Ambient / weather overlays
//  10 — Weather particles
//  11 — HUD
// ============================================

export const InnerMapRenderer = {
    // ── Tile sizing ──────────────────────────────────────
    TILE_SIZE: 32,       // Native LPC tile size; world units per tile
    LPC_TILE_PX: 32,    // Source pixel size in sprite sheets

    // ── Render reference ─────────────────────────────────
    _renderer: null,     // World renderer ref (kept for compat, NOT used for sprites)

    // ── LPC sprite sheets ────────────────────────────────
    _sheets: new Map(),  // key → HTMLImageElement
    _loaded: false,

    // ── UI state ─────────────────────────────────────────
    _hoveredInnerHex: null,
    _selectedInnerHex: null,
    _selectedObject: null,   // { anchorQ, anchorR, defId } — currently left-clicked custom object

    // ── Runtime-analyzed sprites ─────────────────────────
    _analyzedTreeSprites: [],
    _analyzedPlantSprites: [],

    // ── Weather particles ────────────────────────────────
    _weatherParticles: [],
    _weatherParticleTimer: 0,

    // ── Compatibility alias ──────────────────────────────
    get tileSize() { return this.TILE_SIZE; },

    // ══════════════════════════════════════════════
    // INITIALIZATION
    // ══════════════════════════════════════════════

    setRenderer(renderer) {
        this._renderer = renderer;
        if (!this._loadingPromise) this._loadingPromise = this.loadSheets();
    },

    /** Resolves when all sheets and asset modules (CustomBuildings etc.) are ready. */
    whenLoaded() {
        if (this._loaded) return Promise.resolve();
        if (!this._loadingPromise) this._loadingPromise = this.loadSheets();
        return this._loadingPromise;
    },

    // ══════════════════════════════════════════════
    // LPC SHEET PATHS — loaded from data/innerMapRenderer.json
    // ══════════════════════════════════════════════

    SHEET_PATHS: {},  // Populated by _loadConfig()

    // ══════════════════════════════════════════════
    // SHEET LOADING
    // ══════════════════════════════════════════════

    loadSheets() {
        // First load config JSON, then load sheets from paths defined there
        const configP = this._loadConfig();

        return configP.then(() => {
            const promises = [];
            for (const [key, path] of Object.entries(this.SHEET_PATHS)) {
                const img = new Image();
                const p = new Promise(resolve => {
                    img.onload = () => { this._sheets.set(key, img); resolve(); };
                    img.onerror = () => { console.warn(`LPC sheet missing: ${path}`); resolve(); };
                });
                img.src = path;
                promises.push(p);
            }
            // Also load the spritesheet terrain JSON for fill definitions
            const jsonP = (typeof DataLoader !== 'undefined'
                ? DataLoader.load('spritesheets/terrain.json')
                : fetch('data/spritesheets/terrain.json').then(r => r.ok ? r.json() : null)
            ).then(data => { if (data) this._terrainJsonData = data; })
             .catch(() => { console.warn('Could not load spritesheets/terrain.json — using built-in fallback fills'); });
            promises.push(jsonP);

            // Configure and load character sprites
            if (this._configData && typeof InnerMapCharacters !== 'undefined') {
                InnerMapCharacters.configure(this._configData);
                const charPromise = InnerMapCharacters.loadAll().then(() => {
                    // Re-assign presets to any NPCs that were spawned before characters loaded
                    if (typeof InnerMap !== 'undefined' && InnerMap.npcs) {
                        for (const npc of InnerMap.npcs) {
                            if (!npc.preset) {
                                npc.preset = InnerMapCharacters.getPresetForNPC(npc.type, npc.id);
                            }
                        }
                    }
                });
                promises.push(charPromise);
            }

            // Load custom editor-authored objects (manifest-driven)
            if (typeof CustomObjects !== 'undefined') {
                promises.push(CustomObjects.loadAll());
            }

            // Load custom editor-authored buildings (exported from sprite_editor.html)
            if (typeof CustomBuildings !== 'undefined') {
                promises.push(CustomBuildings.loadAll());
            }

            // Load custom editor-authored interiors (exported from interior_editor.html)
            if (typeof CustomInteriors !== 'undefined') {
                promises.push(CustomInteriors.loadAll());
            }

            return Promise.all(promises).then(() => {
                this._loaded = true;
                this._initTerrainFills();
                this._analyzeTreeSheet();
                this._analyzePlantSheet();
                console.log(`LPC sheets loaded: ${this._sheets.size}/${Object.keys(this.SHEET_PATHS).length}`);
            });
        });
    },

    /**
     * Load renderer configuration from data/innerMapRenderer.json.
     * Populates SHEET_PATHS, _FALLBACK_COLORS, _OVERLAY_MAP, fallback sprites,
     * building mappings, action definitions, and fallback terrain fills.
     */
    _loadConfig() {
        const _fetch = (typeof DataLoader !== 'undefined')
            ? DataLoader.load('innerMapRenderer.json')
            : fetch('data/innerMapRenderer.json').then(r => r.ok ? r.json() : null);
        return _fetch
            .then(data => {
                if (!data) {
                    console.warn('innerMapRenderer.json not loaded — using built-in defaults');
                    return;
                }
                this._configData = data;

                // Sheet paths
                if (data.sheetPaths) {
                    this.SHEET_PATHS = data.sheetPaths;
                }
                // Fallback colors
                if (data.fallbackColors) {
                    this._FALLBACK_COLORS = data.fallbackColors;
                }
                // Overlay map (filter out _note keys)
                if (data.overlayMap) {
                    this._OVERLAY_MAP = {};
                    for (const [k, v] of Object.entries(data.overlayMap)) {
                        if (!k.startsWith('_')) this._OVERLAY_MAP[k] = v;
                    }
                }
                // Fallback sprites
                if (data.fallbackSprites) {
                    if (data.fallbackSprites.trees) this._TREE_SPRITES_FALLBACK = data.fallbackSprites.trees;
                    if (data.fallbackSprites.plants) this._PLANT_SPRITES_FALLBACK = data.fallbackSprites.plants;
                    if (data.fallbackSprites.rocks) this._ROCK_SPRITES = data.fallbackSprites.rocks;
                }
                // Fallback terrain fills
                if (data.fallbackTerrainFills) {
                    this._fallbackTerrainFills = data.fallbackTerrainFills;
                }
                // Building mappings (filter out _note keys)
                if (data.buildingToLPC) {
                    this._BUILDING_TO_LPC = {};
                    for (const [k, v] of Object.entries(data.buildingToLPC)) {
                        if (!k.startsWith('_')) this._BUILDING_TO_LPC[k] = v;
                    }
                }
                if (data.spritePathToLPC) {
                    this._SPRITE_PATH_TO_LPC = {};
                    for (const [k, v] of Object.entries(data.spritePathToLPC)) {
                        if (!k.startsWith('_')) this._SPRITE_PATH_TO_LPC[k] = v;
                    }
                }
                // Action definitions
                if (data.actionDefs) {
                    this._actionDefs = {};
                    for (const [k, v] of Object.entries(data.actionDefs)) {
                        if (!k.startsWith('_')) this._actionDefs[k] = v;
                    }
                }
                console.log('InnerMapRenderer config loaded from innerMapRenderer.json');
            })
            .catch(err => {
                console.warn('Failed to load innerMapRenderer.json:', err);
            });
    },

    /** Resolve seasonal sheet key (e.g. 'terrain' → 'terrain_summer') */
    _seasonKey(base) {
        const s = (InnerMap.season || 'Summer').toLowerCase();
        const k = `${base}_${s}`;
        return this._sheets.has(k) ? k : `${base}_summer`;
    },

    // ══════════════════════════════════════════════════════════════
    // TERRAIN FILL TILES
    //
    // Fill tile definitions are loaded from data/spritesheets/terrain.json
    // at startup (via loadSheets). A hardcoded fallback exists in
    // _getDefaultTerrainFills() in case the JSON fails to load.
    // See terrain.json "fills" section for the authoritative list.
    // ══════════════════════════════════════════════════════════════

    _terrainFills: null,
    _terrainJsonData: null, // Loaded from data/spritesheets/terrain.json

    _initTerrainFills() {
        // Try to build fills from the JSON data
        const jsonFills = this._terrainJsonData && this._terrainJsonData.fills;
        if (jsonFills) {
            this._terrainFills = {};
            for (const [category, def] of Object.entries(jsonFills)) {
                if (category.startsWith('_')) continue; // skip _note etc.
                if (!def.tiles || !Array.isArray(def.tiles)) continue;
                this._terrainFills[category] = def.tiles.map(t => ({ col: t.col, row: t.row }));
            }
            console.log('Terrain fills loaded from terrain.json:', Object.fromEntries(
                Object.entries(this._terrainFills).map(([k, v]) => [k, v.length])
            ));
        } else {
            // Fallback: hardcoded defaults (should not normally be reached)
            console.warn('Terrain fills: using hardcoded fallback (terrain.json not loaded)');
            this._terrainFills = this._getDefaultTerrainFills();
            console.log('Terrain fills initialized (fallback):', Object.fromEntries(
                Object.entries(this._terrainFills).map(([k, v]) => [k, v.length])
            ));
        }
    },

    /** Fallback fills — loaded from JSON, or empty if unavailable */
    _getDefaultTerrainFills() {
        return this._fallbackTerrainFills || {};
    },

    // ══════════════════════════════════════════════
    // RUNTIME TREE SHEET ANALYZER
    // Divides the tree sheet into a grid of blocks, scans each
    // for opaque pixel content, and extracts tight bounding boxes
    // for actual tree sprites (skipping shadows and empty cells).
    // ══════════════════════════════════════════════

    _analyzeTreeSheet() {
        const key = this._seasonKey('trees');
        const sheet = this._sheets.get(key);
        if (!sheet || !sheet.width) return;

        const cvs = document.createElement('canvas');
        cvs.width = sheet.width;
        cvs.height = sheet.height;
        const c = cvs.getContext('2d');
        c.drawImage(sheet, 0, 0);

        // Divide sheet into a 4×4 grid of blocks
        const GRID_COLS = 4;
        const GRID_ROWS = 4;
        const blockW = Math.floor(sheet.width / GRID_COLS);
        const blockH = Math.floor(sheet.height / GRID_ROWS);

        const sprites = [];

        for (let gr = 0; gr < GRID_ROWS; gr++) {
            for (let gc = 0; gc < GRID_COLS; gc++) {
                const bx = gc * blockW;
                const by = gr * blockH;
                const bw = Math.min(blockW, sheet.width - bx);
                const bh = Math.min(blockH, sheet.height - by);

                const data = c.getImageData(bx, by, bw, bh).data;

                // Find tight bounding box of opaque pixels within this block
                let minX = bw, minY = bh, maxX = 0, maxY = 0;
                let opaqueCount = 0;

                for (let py = 0; py < bh; py++) {
                    for (let px = 0; px < bw; px++) {
                        if (data[(py * bw + px) * 4 + 3] > 100) {
                            opaqueCount++;
                            if (px < minX) minX = px;
                            if (px > maxX) maxX = px;
                            if (py < minY) minY = py;
                            if (py > maxY) maxY = py;
                        }
                    }
                }

                const contentW = maxX - minX + 1;
                const contentH = maxY - minY + 1;

                // Accept tree-sized content: at least 48px wide and 64px tall
                // This filters out shadow blobs (~32×16) and empty cells
                if (opaqueCount > 300 && contentW >= 48 && contentH >= 64) {
                    sprites.push({
                        sx: bx + minX,
                        sy: by + minY,
                        sw: contentW,
                        sh: contentH
                    });
                }
            }
        }

        this._analyzedTreeSprites = sprites;
        console.log(`Tree sprites analyzed: ${sprites.length}`,
            sprites.map(s => `(${s.sx},${s.sy} ${s.sw}×${s.sh})`).join(', '));
    },

    // ══════════════════════════════════════════════
    // RUNTIME PLANT SHEET ANALYZER
    // Scans plant sheet 32×32 cells, keeps only cells with
    // transparent borders (standalone sprites, not autotile fills).
    // ══════════════════════════════════════════════

    _analyzePlantSheet() {
        const key = this._seasonKey('plants');
        const sheet = this._sheets.get(key);
        if (!sheet || !sheet.width) return;

        const cvs = document.createElement('canvas');
        cvs.width = sheet.width;
        cvs.height = sheet.height;
        const c = cvs.getContext('2d');
        c.drawImage(sheet, 0, 0);

        const T = 32;
        const cols = Math.floor(sheet.width / T);
        const rows = Math.floor(sheet.height / T);
        const sprites = [];

        for (let r = 0; r < rows; r++) {
            for (let col = 0; col < cols; col++) {
                const x = col * T, y = r * T;
                const data = c.getImageData(x, y, T, T).data;

                // Count opaque center pixels and border pixels
                let centerOpaque = 0, borderOpaque = 0, borderTotal = 0;

                for (let py = 0; py < T; py++) {
                    for (let px = 0; px < T; px++) {
                        const alpha = data[(py * T + px) * 4 + 3];
                        const isBorder = px <= 1 || px >= T - 2 || py <= 1 || py >= T - 2;
                        if (isBorder) {
                            borderTotal++;
                            if (alpha > 100) borderOpaque++;
                        } else {
                            if (alpha > 100) centerOpaque++;
                        }
                    }
                }

                const centerArea = (T - 4) * (T - 4);
                const centerRatio = centerOpaque / centerArea;
                const borderRatio = borderOpaque / borderTotal;

                // Good plant sprite: has some center content, mostly transparent borders
                // This rejects autotile fills (borders are opaque) and empty cells
                if (centerRatio > 0.08 && borderRatio < 0.5) {
                    sprites.push({ sx: x, sy: y, sw: T, sh: T });
                }
            }
        }

        this._analyzedPlantSprites = sprites;
        console.log(`Plant sprites analyzed: ${sprites.length}`);
    },

    // ══════════════════════════════════════════════
    // TERRAIN FILL — fallback colors
    // Base terrain fill category is now set on each tile at generation
    // time (tile.baseTerrain) by InnerMap._getBaseTerrain().
    // The renderer just reads it directly — no more mapping needed.
    // ══════════════════════════════════════════════

    // ══════════════════════════════════════════════
    // DATA — All loaded from data/innerMapRenderer.json via _loadConfig().
    // Inline defaults kept only as empty stubs for code that runs
    // before the JSON finishes loading.
    // ══════════════════════════════════════════════

    /** Fallback solid colors (used when no sprite sheet tile available) */
    _FALLBACK_COLORS: {},

    /** Sub-terrain → overlay category */
    _OVERLAY_MAP: {},

    /** Fallback tree sprites — used only if runtime analysis fails */
    _TREE_SPRITES_FALLBACK: [],

    /** Fallback plant sprites — used only if runtime analysis fails */
    _PLANT_SPRITES_FALLBACK: [],

    /** Rock sprites — each rock is 2×2 tiles (64×64 px) */
    _ROCK_SPRITES: [],

    /** Building type key → LPC structure sheet key */
    _BUILDING_TO_LPC: {},

    /** Hex sprite path substrings → LPC sheet key */
    _SPRITE_PATH_TO_LPC: {},

    // ══════════════════════════════════════════════
    // TERRAIN SOURCE LOOKUP
    // ══════════════════════════════════════════════

    _getTerrainFill(tile) {
        // Cache on tile — result is deterministic per position + baseTerrain
        if (tile._cachedFill) return tile._cachedFill;

        const hash = (Math.abs((tile.q * 73856093 ^ tile.r * 19349663))) >>> 0;
        // Use baseTerrain directly — set during generation, like C#'s tileType
        const fillCat = tile.baseTerrain || 'grass';
        let result;

        if (this._terrainFills) {
            let fills = this._terrainFills[fillCat];
            if (!fills || fills.length === 0) {
                // Fallback chain for missing categories
                const fb = {
                    dark_green: 'grass', dark_stone: 'stone',
                    dry_dirt: 'dirt', deep_water: 'water',
                    sand: 'dirt',
                };
                fills = this._terrainFills[fb[fillCat]] || this._terrainFills.grass;
            }
            if (fills && fills.length > 0) {
                const pick = fills[hash % fills.length];
                result = { sx: pick.col * 32, sy: pick.row * 32 };
            }
        }
        if (!result) {
            result = { sx: -1, sy: -1, fallbackColor: this._FALLBACK_COLORS[fillCat] || '#4B8434' };
        }
        tile._cachedFill = result;
        return result;
    },

    // ══════════════════════════════════════════════
    // OBJECT OVERLAY SOURCE LOOKUP
    // ══════════════════════════════════════════════

    _getObjectOverlay(tile) {
        // Cache on tile — result is deterministic per subTerrain.id + position
        if (tile._cachedOverlay !== undefined) return tile._cachedOverlay;

        const subId = tile.subTerrain.id;
        const cat = this._OVERLAY_MAP[subId];
        if (!cat) { tile._cachedOverlay = null; return null; }

        const hash = (Math.abs((tile.q * 19349663 ^ tile.r * 73856093))) >>> 0;
        let result = null;

        if (cat === 'trees') {
            const sheetKey = this._seasonKey('trees');
            if (this._sheets.has(sheetKey)) {
                const pool = this._analyzedTreeSprites.length > 0
                    ? this._analyzedTreeSprites : this._TREE_SPRITES_FALLBACK;
                const def = pool[hash % pool.length];
                result = { sheet: sheetKey, ...def, type: 'tree' };
            }
        } else if (cat === 'plants') {
            const sheetKey = this._seasonKey('plants');
            if (this._sheets.has(sheetKey)) {
                const pool = this._analyzedPlantSprites.length > 0
                    ? this._analyzedPlantSprites : this._PLANT_SPRITES_FALLBACK;
                const def = pool[hash % pool.length];
                result = { sheet: sheetKey, ...def, type: 'plant' };
            }
        } else if (cat === 'rocks') {
            const def = this._ROCK_SPRITES[hash % this._ROCK_SPRITES.length];
            if (this._sheets.has(def.sheet)) {
                result = { ...def, type: 'rock' };
            }
        } else if (cat === 'wildflowers') {
            let sheetKey = this._seasonKey('wildflowers');
            if (!this._sheets.has(sheetKey)) sheetKey = 'flowers';
            const sheet = this._sheets.get(sheetKey);
            if (sheet && sheet.width) {
                const cols = Math.floor(sheet.width / 32);
                const rows = Math.floor(sheet.height / 32);
                if (cols > 0 && rows > 0) {
                    result = { sheet: sheetKey, sx: (hash % cols) * 32, sy: ((hash >>> 8) % rows) * 32, sw: 32, sh: 32, type: 'flower' };
                }
            }
        } else if (cat === 'mushrooms') {
            if (this._sheets.has('mushrooms')) {
                const sheet = this._sheets.get('mushrooms');
                const cols = Math.floor(sheet.width / 32);
                const rows = Math.floor(sheet.height / 32);
                if (cols > 0 && rows > 0) {
                    result = { sheet: 'mushrooms', sx: (hash % cols) * 32, sy: ((hash >>> 8) % rows) * 32, sw: 32, sh: 32, type: 'mushroom' };
                }
            }
        } else if (cat === 'water_feature') {
            result = { type: 'water_overlay', tint: 'rgba(42,133,152,0.55)' };
        } else if (cat === 'ice_feature') {
            result = { type: 'ice_overlay', tint: 'rgba(180,220,240,0.50)' };
        } else if (cat === 'waterfall') {
            if (this._sheets.has('waterfall')) {
                result = { sheet: 'waterfall', sx: 0, sy: 0, sw: 32, sh: 64, type: 'waterfall' };
            } else {
                result = { type: 'water_overlay', tint: 'rgba(42,133,152,0.55)' };
            }
        }

        tile._cachedOverlay = result;
        return result;
    },

    // ══════════════════════════════════════════════
    // C#-INSPIRED TILE RENDERING HELPER
    // Mirrors IsoMapRenderer.RenderISOTile:
    //   screenX = (x * tileWidth) * zoom + cameraX
    //   screenY = (y * tileHeight) * zoom + cameraY
    //   destW   = texWidth * zoom + 1
    //   destH   = texHeight * zoom + 1
    // ══════════════════════════════════════════════

    /**
     * Draw a sprite at a world-pixel position using the camera transform.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} camera
     * @param {number} worldX - world X in pixels
     * @param {number} worldY - world Y in pixels
     * @param {HTMLImageElement} texture - sprite sheet
     * @param {number} srcX - source X in sheet
     * @param {number} srcY - source Y in sheet
     * @param {number} srcW - source width
     * @param {number} srcH - source height
     * @param {number} [destW] - dest width in world px (defaults to srcW)
     * @param {number} [destH] - dest height in world px (defaults to srcH)
     */
    _renderSprite(ctx, camera, worldX, worldY, texture, srcX, srcY, srcW, srcH, destW, destH) {
        const screen = camera.worldToScreenFast(worldX, worldY);
        const w = (destW || srcW) * camera.zoom;
        const h = (destH || srcH) * camera.zoom;
        ctx.drawImage(texture, srcX, srcY, srcW, srcH,
            Math.floor(screen.x), Math.floor(screen.y),
            Math.ceil(w) + 1, Math.ceil(h) + 1);
    },

    // ══════════════════════════════════════════════
    // MAIN RENDER — Layered approach
    // ══════════════════════════════════════════════

    render(ctx, canvas, camera, deltaTime) {
        if (!InnerMap.active || !InnerMap.tiles) return;

        const w = canvas.width, h = canvas.height;

        // Pixel-art: nearest-neighbor scaling
        ctx.imageSmoothingEnabled = false;

        // Clear
        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(0, 0, w, h);
        ctx.save();

        // Cache visible tile range once per frame for all layers
        this._frameRange = this._getVisibleTileRange(camera);

        // ── Layer 0: Terrain (ground) ──
        this._renderTerrainLayer(ctx, camera);

        // ── Layer 1: Roads ──
        this._renderRoadLayer(ctx, camera);

        // ── Layer 1.5: Ground overlays (water / ice / waterfall — flat tiles) ──
        this._renderGroundOverlays(ctx, camera);

        // ── Layer 2: Depth-sorted sprites ──
        // Objects, buildings, NPCs, and the player are merged into one
        // Y-sorted pass so characters correctly walk behind / in front
        // of tall scenery (trees, buildings, rocks) based on screen Y.
        this._renderDepthSortedSprites(ctx, camera, deltaTime);

        // ── Layer 3: Fog of war + weather tints ──
        this._renderFogLayer(ctx, camera);

        // ── Layer 8: Highlights ──
        if (this._hoveredInnerHex) {
            this.renderInnerHexHighlight(ctx, camera, this._hoveredInnerHex.q, this._hoveredInnerHex.r,
                'rgba(255,255,255,0.15)', 'rgba(255,255,255,0.4)');
        }
        if (this._selectedInnerHex) {
            this.renderInnerHexHighlight(ctx, camera, this._selectedInnerHex.q, this._selectedInnerHex.r,
                'rgba(245,197,66,0.15)', 'rgba(245,197,66,0.6)');
        }

        // ── Selected custom-object highlight (multi-tile gold outline) ──
        if (this._selectedObject && typeof CustomObjects !== 'undefined') {
            const def = CustomObjects.getDef(this._selectedObject.defId);
            if (def && def.tiles) {
                const T = this.TILE_SIZE;
                const ds = T * camera.zoom;
                const aq = this._selectedObject.anchorQ;
                const ar = this._selectedObject.anchorR;
                ctx.strokeStyle = 'rgba(245,197,66,0.85)';
                ctx.lineWidth = 2;
                ctx.shadowColor = 'rgba(245,197,66,0.5)';
                ctx.shadowBlur = 6;
                // Build a Set of occupied cells for edge-detection
                const occupied = new Set();
                for (const td of def.tiles) occupied.add(`${aq + td.localCol},${ar + td.localRow}`);
                for (const td of def.tiles) {
                    const cq = aq + td.localCol, cr = ar + td.localRow;
                    const s = camera.worldToScreen(cq * T, cr * T);
                    const sx = Math.floor(s.x), sy = Math.floor(s.y);
                    // Draw only outer edges
                    ctx.beginPath();
                    if (!occupied.has(`${cq},${cr - 1}`)) { ctx.moveTo(sx, sy); ctx.lineTo(sx + ds, sy); }         // top
                    if (!occupied.has(`${cq + 1},${cr}`)) { ctx.moveTo(sx + ds, sy); ctx.lineTo(sx + ds, sy + ds); } // right
                    if (!occupied.has(`${cq},${cr + 1}`)) { ctx.moveTo(sx, sy + ds); ctx.lineTo(sx + ds, sy + ds); } // bottom
                    if (!occupied.has(`${cq - 1},${cr}`)) { ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + ds); }          // left
                    ctx.stroke();
                }
                ctx.shadowBlur = 0;
            }
        }

        ctx.restore();

        // ── Layer 9: Dynamic lighting & ambient overlays ──
        // The light system replaces the old flat ambient overlay with proper
        // 2D radial lights (player torch, building lights, road torches, etc.)
        if (typeof LightSystem !== 'undefined' && LightSystem.enabled && LightSystem.ambientDarkness > 0.01) {
            // Render dynamic light/shadow overlay
            LightSystem.render(ctx, canvas, deltaTime);

            // Weather overlay on top of lighting (still additive)
            if (!InnerMap._insideBuilding) {
                const weatherColor = InnerMap.getWeatherOverlay();
                if (weatherColor) { ctx.fillStyle = weatherColor; ctx.fillRect(0, 0, w, h); }
                const tempColor = InnerMap.getTemperatureOverlay();
                if (tempColor) { ctx.fillStyle = tempColor; ctx.fillRect(0, 0, w, h); }
            }
        } else {
            // During full daylight: just draw weather/temperature overlays
            if (!InnerMap._insideBuilding) {
                const weatherColor = InnerMap.getWeatherOverlay();
                if (weatherColor) { ctx.fillStyle = weatherColor; ctx.fillRect(0, 0, w, h); }
                const tempColor = InnerMap.getTemperatureOverlay();
                if (tempColor) { ctx.fillStyle = tempColor; ctx.fillRect(0, 0, w, h); }
            }
        }

        // ── Layer 10: Weather particles (always rendered) ──
        if (!InnerMap._insideBuilding) {
            this._renderWeatherParticles(ctx, canvas, camera, deltaTime);
        } else {
            // Indoor ambient: warm interior tint
            ctx.fillStyle = 'rgba(245, 197, 66, 0.03)';
            ctx.fillRect(0, 0, w, h);
        }

        // ── Layer 11: HUD ──
        this._renderHUD(ctx, canvas);
    },

    // Render layers are defined in innerMapLayers.js
    // UI systems (weather, HUD, context menu) are in innerMapUI.js

    // ══════════════════════════════════════════════
    // SQUARE GRID POSITIONING & HIT DETECTION
    // (Method names kept for game.js compatibility)
    // ══════════════════════════════════════════════

    getInnerHexPixelPos(q, r) {
        const T = this.TILE_SIZE;
        return { x: q * T + T / 2, y: r * T + T / 2 };
    },

    getInnerHexAtScreen(screenX, screenY, camera) {
        const worldPos = camera.screenToWorld(screenX, screenY);
        const T = this.TILE_SIZE;
        const q = Math.floor(worldPos.x / T);
        const r = Math.floor(worldPos.y / T);
        if (q < 0 || q >= InnerMap.width || r < 0 || r >= InnerMap.height) return null;
        return { q, r };
    },

    renderInnerHexHighlight(ctx, camera, q, r, fillColor, strokeColor) {
        const T = this.TILE_SIZE;
        const screen = camera.worldToScreen(q * T, r * T);
        const ds = T * camera.zoom;

        ctx.fillStyle = fillColor;
        ctx.fillRect(screen.x, screen.y, ds, ds);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(screen.x, screen.y, ds, ds);
    },
};

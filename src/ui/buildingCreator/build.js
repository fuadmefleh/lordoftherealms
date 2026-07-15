// buildingCreator — build functions.
import { CustomInteriors } from '../../world/customInteriors.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';
import { TILE, CANVAS_ZOOM, PAL_ZOOM, bcState, _brushCosts, _imgCache, BUILDING_PALETTE, DEFAULT_COSTS, FALLBACK_RESOURCE_DEFS } from './shared.js';
import { _prettyResourceId, _getTerrainResourceDefs, _getResourceDefs, _getResourceDef, _loadImg, setBrushCost, getBrushCost, _getAllBrushes, _canAfford, _deductCost, _formatCost } from './resources.js';
import { _recomputeNineTile, _brushPaint, _brushErase, _metaToggle, _stampPaint, _renderCanvas } from './paint.js';
import { _showToast, _updateResourceDisplay, _buildUI, _handleCanvasClick, _buildToolButtons, _setTool, _buildLayerButtons, _buildBrushList, _selectBrush, _updateCostEditor, _updateStampPreview, _buildPaletteCats, _showPaletteCategory, _updateTotalCost } from './ui.js';

export function _finishExteriorPhase() {
    // Collect exterior tiles
    let hasTiles = false;
    for (const lyrName of ['floor', 'walls', 'roof', 'overlay']) {
        if (Object.keys(bcState._layers[lyrName]).length > 0) { hasTiles = true; break; }
    }
    if (!hasTiles) {
        _showToast('Place some tiles for the exterior first!', 'err');
        return;
    }

    // Save building name
    bcState._buildingName = (bcState._overlay.querySelector('#bc-name').value || '').trim() || 'Custom Building';

    // Build the exterior definition (same format as _finishBuilding)
    const extLayers = { floor: [], walls: [], roof: [], overlay: [] };
    let minQ = Infinity, minR = Infinity, maxQ = -Infinity, maxR = -Infinity;
    for (const lyrName of ['floor', 'walls', 'roof', 'overlay']) {
        for (const [key, cell] of Object.entries(bcState._layers[lyrName])) {
            const [q, r] = key.split(',').map(Number);
            extLayers[lyrName].push({ q, r, sheetPath: cell.sheetPath, sx: cell.sx, sy: cell.sy, sw: cell.sw || TILE, sh: cell.sh || TILE });
            if (q < minQ) minQ = q; if (q > maxQ) maxQ = q;
            if (r < minR) minR = r; if (r > maxR) maxR = r;
        }
    }
    const extMeta = [];
    for (const [key, m] of Object.entries(bcState._meta)) {
        const [q, r] = key.split(',').map(Number);
        extMeta.push({ q, r, impassable: !!m.impassable, door: !!m.door });
    }

    bcState._exteriorDef = {
        name: bcState._buildingName,
        gridW: bcState._gridW,
        gridH: bcState._gridH,
        layers: extLayers,
        meta: extMeta,
        brushGroupMap: JSON.parse(JSON.stringify(bcState._brushGroupMap)),
        bounds: { minCol: minQ, minRow: minR, maxCol: maxQ, maxRow: maxR },
        width: maxQ - minQ + 1,
        height: maxR - minR + 1,
    };

    // ── Transition to Phase 2: Interior ──
    bcState._phase = 'interior';
    // Keep the same grid dimensions
    const intW = bcState._gridW;
    const intH = bcState._gridH;

    // Reset layers/meta for interior
    bcState._layers = { floor: {}, walls: {}, roof: {}, overlay: {} };
    bcState._meta = {};
    bcState._brushGroupMap = {};
    bcState._activeLayer = 'floor';
    bcState._activeTool = 'paint';
    bcState._activeBrush = null;
    bcState._activeStamp = null;

    // Pre-populate outer walls from exterior
    // Scan the exterior's wall layer to find edge/boundary tiles
    _prePlaceOuterWalls(intW, intH);

    // Rebuild the UI for Phase 2
    if (bcState._overlay) { bcState._overlay.remove(); bcState._overlay = null; }
    bcState._cvs = null; bcState._ctx = null;
    _buildUI();

    _showToast('Exterior saved! Now design the interior. Outer walls are pre-placed.', 'ok');
}

export function _prePlaceOuterWalls(w, h) {
    if (!bcState._exteriorDef) return;

    // Collect all wall positions from the exterior's brushGroupMap
    const extWallPositions = new Set();
    for (const [key, entry] of Object.entries(bcState._exteriorDef.brushGroupMap)) {
        if (entry.layer === 'walls') extWallPositions.add(key);
    }

    // Also check exterior meta for impassable tiles
    for (const m of bcState._exteriorDef.meta) {
        if (m.impassable) extWallPositions.add(`${m.q},${m.r}`);
    }

    // If the exterior has wall brush group entries, copy them directly.
    // These become the immutable outer walls of the interior.
    if (extWallPositions.size > 0) {
        // Copy wall tiles from exterior layers
        for (const key of extWallPositions) {
            // Copy from exterior wall layer
            const extWallCell = bcState._exteriorDef.layers.walls.find(c => `${c.q},${c.r}` === key);
            if (extWallCell) {
                bcState._layers.walls[key] = {
                    sheetPath: extWallCell.sheetPath,
                    sx: extWallCell.sx, sy: extWallCell.sy,
                    sw: extWallCell.sw || TILE, sh: extWallCell.sh || TILE,
                };
            }
            // Mark as impassable
            bcState._meta[key] = { impassable: true, _exteriorWall: true };
        }
    } else {
        // No explicit wall brush used — generate perimeter walls
        // Place basic impassable markers around the border
        for (let q = 0; q < w; q++) {
            for (let r = 0; r < h; r++) {
                if (q === 0 || q === w - 1 || r === 0 || r === h - 1) {
                    const key = `${q},${r}`;
                    bcState._meta[key] = { impassable: true, _exteriorWall: true };
                }
            }
        }
    }

    // Copy floor tiles from exterior as the base interior floor
    for (const cell of bcState._exteriorDef.layers.floor) {
        const key = `${cell.q},${cell.r}`;
        // Don't overwrite walls
        if (!bcState._meta[key] || !bcState._meta[key]._exteriorWall) {
            bcState._layers.floor[key] = {
                sheetPath: cell.sheetPath,
                sx: cell.sx, sy: cell.sy,
                sw: cell.sw || TILE, sh: cell.sh || TILE,
            };
        }
    }
}

export function _finishBuilding() {
    // Collect interior tiles
    const intLayers = { floor: [], walls: [], overlay: [] };
    let hasTiles = false;

    for (const lyrName of ['floor', 'walls', 'overlay']) {
        for (const [key, cell] of Object.entries(bcState._layers[lyrName])) {
            const [q, r] = key.split(',').map(Number);
            intLayers[lyrName].push({
                q, r,
                sheetPath: cell.sheetPath,
                sx: cell.sx, sy: cell.sy,
                sw: cell.sw || TILE, sh: cell.sh || TILE
            });
            hasTiles = true;
        }
    }

    // Build interior meta
    const intMeta = [];
    for (const [key, m] of Object.entries(bcState._meta)) {
        const [q, r] = key.split(',').map(Number);
        intMeta.push({ q, r, impassable: !!m.impassable, door: !!m.door });
    }

    const name = (bcState._overlay.querySelector('#bc-name').value || '').trim() || bcState._buildingName || 'Custom Building';
    const buildingId = 'player_building_' + Date.now();

    // ── Register exterior building ──
    // Use the saved exterior def from Phase 1
    const extDef = bcState._exteriorDef;
    const extLayers = extDef ? extDef.layers : { floor: [], walls: [], roof: [], overlay: [] };
    const extMeta = extDef ? extDef.meta : [];
    const extBounds = extDef ? extDef.bounds : { minCol: 0, minRow: 0, maxCol: bcState._gridW - 1, maxRow: bcState._gridH - 1 };

    const buildingDef = {
        id: buildingId,
        name: name,
        buildingType: 'house',
        tags: ['player_built'],
        tileW: TILE,
        tileH: TILE,
        width: extDef ? extDef.width : bcState._gridW,
        height: extDef ? extDef.height : bcState._gridH,
        layers: extLayers,
        meta: extMeta,
        bounds: extBounds,
    };

    // Register with CustomBuildings
    if (typeof CustomBuildings !== 'undefined') {
        CustomBuildings._registerPlayerBuilding(buildingDef);
    }

    // ── Register interior (if any tiles were placed) ──
    if (hasTiles) {
        const interiorId = buildingId + '_interior';
        const interiorDef = {
            id: interiorId,
            name: name + ' Interior',
            linkedBuildingIds: [buildingId],
            buildingType: 'house',
            tags: ['player_built'],
            tileW: TILE,
            tileH: TILE,
            width: bcState._gridW,
            height: bcState._gridH,
            layers: intLayers,
            meta: intMeta,
            bounds: { minCol: 0, minRow: 0, maxCol: bcState._gridW - 1, maxRow: bcState._gridH - 1 },
        };
        // Register with CustomInteriors
        if (typeof CustomInteriors !== 'undefined' && CustomInteriors.registerInterior) {
            CustomInteriors.registerInterior(interiorDef);
        }
    }

    // Place the building on the inner map at the anchor position
    if (InnerMap.active && InnerMap.tiles) {
        _placeOnInnerMap(buildingDef);
    }

    _showToast('Building placed!', 'ok');

    if (bcState._game && bcState._game.ui) {
        bcState._game.ui.showNotification('🏗️ Building Complete',
            `"${name}" has been placed! (${buildingDef.width}×${buildingDef.height} tiles)`, 'success');
        bcState._game.ui.updateStats(bcState._game.player, bcState._game.world);
    }

    close();
}

export function _placeOnInnerMap(def) {
    // Place at the anchor position on the inner map
    const aq = bcState._anchorQ;
    const ar = bcState._anchorR;

    // Offset so the building's min corner lands at the anchor
    const offQ = aq - (def.bounds.minCol);
    const offR = ar - (def.bounds.minRow);

    for (const lyrName of ['floor', 'walls', 'roof', 'overlay']) {
        for (const cell of (def.layers[lyrName] || [])) {
            const tq = cell.q + offQ;
            const tr = cell.r + offR;
            if (tq < 0 || tq >= InnerMap.width || tr < 0 || tr >= InnerMap.height) continue;
            const tile = InnerMap.tiles[tr] && InnerMap.tiles[tr][tq];
            if (!tile) continue;

            // Mark the anchor tile with the custom building reference
            if (tq === aq && tr === ar) {
                tile.customBuilding = { defId: def.id };
            } else {
                tile.customBuildingPart = { anchorQ: aq, anchorR: ar };
            }
        }
    }

    // Apply meta (impassable)
    for (const m of def.meta) {
        const tq = m.q + offQ;
        const tr = m.r + offR;
        if (tq < 0 || tq >= InnerMap.width || tr < 0 || tr >= InnerMap.height) continue;
        const tile = InnerMap.tiles[tr] && InnerMap.tiles[tr][tq];
        if (!tile) continue;
        if (m.impassable) {
            tile.subTerrain = { ...tile.subTerrain, passable: false };
        }
    }

    // Preload images for the new building
    const paths = new Set();
    for (const lyrName of ['floor', 'walls', 'roof', 'overlay']) {
        for (const cell of (def.layers[lyrName] || [])) {
            if (cell.sheetPath) paths.add(cell.sheetPath);
        }
    }
    // Images are likely already cached via the palette, but ensure they're in CustomBuildings cache
    for (const p of paths) {
        const existing = CustomBuildings.getImg(p);
        if (!existing && _imgCache[p] instanceof HTMLImageElement) {
            // Inject into CustomBuildings' image cache
            CustomBuildings._injectImg(p, _imgCache[p]);
        }
    }
}

export function open(game, anchorQ, anchorR) {
    if (bcState._isOpen) return;
    bcState._isOpen = true;
    bcState._game = game;
    bcState._anchorQ = anchorQ;
    bcState._anchorR = anchorR;
    bcState._gridW = 8;
    bcState._gridH = 8;
    bcState._layers = { floor: {}, walls: {}, roof: {}, overlay: {} };
    bcState._meta = {};
    bcState._brushGroupMap = {};
    bcState._activeLayer = 'floor';
    bcState._activeTool = 'paint';
    bcState._activeBrush = null;
    bcState._activeStamp = null;
    bcState._buildingName = '';
    bcState._phase = 'exterior';
    bcState._exteriorDef = null;

    // Preload brush images
    const brushes = _getAllBrushes();
    const paths = new Set();
    for (const brush of brushes) {
        if (brush.tiles) {
            for (const row of brush.tiles) {
                for (const t of row) {
                    if (t && t.sheetPath) paths.add(t.sheetPath);
                }
            }
        }
        if (brush.insideCorners) for (const t of brush.insideCorners) if (t && t.sheetPath) paths.add(t.sheetPath);
        if (brush.corridors) for (const t of brush.corridors) if (t && t.sheetPath) paths.add(t.sheetPath);
        if (brush.endCaps) for (const t of brush.endCaps) if (t && t.sheetPath) paths.add(t.sheetPath);
    }
    Promise.all([...paths].map(_loadImg)).then(() => {
        _buildUI();
    });
}

export function close() {
    bcState._isOpen = false;
    if (bcState._overlay) {
        bcState._overlay.remove();
        bcState._overlay = null;
    }
    bcState._cvs = null;
    bcState._ctx = null;
    bcState._game = null;
}

export function isOpen() {
    return bcState._isOpen;
}

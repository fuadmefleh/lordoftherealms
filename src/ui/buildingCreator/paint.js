// buildingCreator — paint functions.
import { CustomInteriors } from '../../world/customInteriors.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';
import { TILE, CANVAS_ZOOM, PAL_ZOOM, bcState, _brushCosts, _imgCache, BUILDING_PALETTE, DEFAULT_COSTS, FALLBACK_RESOURCE_DEFS } from './shared.js';
import { _prettyResourceId, _getTerrainResourceDefs, _getResourceDefs, _getResourceDef, _loadImg, setBrushCost, getBrushCost, _getAllBrushes, _canAfford, _deductCost, _formatCost } from './resources.js';
import { _showToast, _updateResourceDisplay, _buildUI, _handleCanvasClick, _buildToolButtons, _setTool, _buildLayerButtons, _buildBrushList, _selectBrush, _updateCostEditor, _updateStampPreview, _buildPaletteCats, _showPaletteCategory, _updateTotalCost } from './ui.js';
import { _finishExteriorPhase, _prePlaceOuterWalls, _finishBuilding, _placeOnInnerMap, open, close, isOpen } from './build.js';

export function _recomputeNineTile(q, r) {
    const key = `${q},${r}`;
    const entry = bcState._brushGroupMap[key];
    if (!entry) return;
    const brushes = _getAllBrushes();
    const brush = brushes.find(b => b.id === entry.brushId);
    if (!brush) return;
    const targetLayer = entry.layer;
    const groupId = entry.brushId;

    const has = (dq, dr) => {
        const nq = q + dq, nr = r + dr;
        if (nq < 0 || nq >= bcState._gridW || nr < 0 || nr >= bcState._gridH) return false;
        const nk = `${nq},${nr}`;
        return bcState._brushGroupMap[nk] && bcState._brushGroupMap[nk].brushId === groupId;
    };

    const hasTop = has(0, -1), hasBottom = has(0, 1), hasLeft = has(-1, 0), hasRight = has(1, 0);
    const hasTL = has(-1, -1), hasTR = has(1, -1), hasBL = has(-1, 1), hasBR = has(1, 1);
    const cardCount = (hasTop ? 1 : 0) + (hasBottom ? 1 : 0) + (hasLeft ? 1 : 0) + (hasRight ? 1 : 0);

    // Wall brush corridor/junction logic
    if (brush.brushType === 'wall' && brush.corridors) {
        if (cardCount === 0 && brush.corridors[7]) {
            bcState._layers[targetLayer][key] = { sheetPath: brush.corridors[7].sheetPath, sx: brush.corridors[7].sx, sy: brush.corridors[7].sy, sw: TILE, sh: TILE };
            return;
        }
        if (cardCount === 1 && brush.endCaps) {
            let ec = hasBottom ? 0 : hasTop ? 1 : hasRight ? 2 : hasLeft ? 3 : -1;
            if (ec >= 0 && brush.endCaps[ec]) {
                bcState._layers[targetLayer][key] = { sheetPath: brush.endCaps[ec].sheetPath, sx: brush.endCaps[ec].sx, sy: brush.endCaps[ec].sy, sw: TILE, sh: TILE };
                return;
            }
        }
        if (hasTop && hasBottom && !hasLeft && !hasRight && brush.corridors[0]) {
            bcState._layers[targetLayer][key] = { sheetPath: brush.corridors[0].sheetPath, sx: brush.corridors[0].sx, sy: brush.corridors[0].sy, sw: TILE, sh: TILE };
            return;
        }
        if (hasLeft && hasRight && !hasTop && !hasBottom && brush.corridors[1]) {
            bcState._layers[targetLayer][key] = { sheetPath: brush.corridors[1].sheetPath, sx: brush.corridors[1].sx, sy: brush.corridors[1].sy, sw: TILE, sh: TILE };
            return;
        }
        if (cardCount === 3) {
            let tIdx = -1;
            if (hasLeft && hasRight && hasBottom && !hasTop) tIdx = 2;
            else if (hasLeft && hasRight && hasTop && !hasBottom) tIdx = 3;
            else if (hasTop && hasBottom && hasRight && !hasLeft) tIdx = 4;
            else if (hasTop && hasBottom && hasLeft && !hasRight) tIdx = 5;
            if (tIdx >= 0 && brush.corridors[tIdx]) {
                bcState._layers[targetLayer][key] = { sheetPath: brush.corridors[tIdx].sheetPath, sx: brush.corridors[tIdx].sx, sy: brush.corridors[tIdx].sy, sw: TILE, sh: TILE };
                return;
            }
        }
        if (cardCount === 4 && brush.corridors[6]) {
            const diagCount = (hasTL ? 1 : 0) + (hasTR ? 1 : 0) + (hasBL ? 1 : 0) + (hasBR ? 1 : 0);
            if (diagCount < 4) { /* fall through to IC check */ }
        }
    }

    // Inside corners
    if (hasTop && hasBottom && hasLeft && hasRight && brush.insideCorners) {
        const icIdx = !hasTL ? 0 : !hasTR ? 1 : !hasBL ? 2 : !hasBR ? 3 : -1;
        if (icIdx >= 0 && brush.insideCorners[icIdx]) {
            const ic = brush.insideCorners[icIdx];
            bcState._layers[targetLayer][key] = { sheetPath: ic.sheetPath, sx: ic.sx, sy: ic.sy, sw: TILE, sh: TILE };
            return;
        }
    }

    // Standard 3×3 mapping
    let row = 1;
    if (!hasTop && hasBottom) row = 0;
    else if (hasTop && !hasBottom) row = 2;
    let col = 1;
    if (!hasLeft && hasRight) col = 0;
    else if (hasLeft && !hasRight) col = 2;

    const tileRef = brush.tiles[row] && brush.tiles[row][col];
    if (tileRef) {
        bcState._layers[targetLayer][key] = { sheetPath: tileRef.sheetPath, sx: tileRef.sx, sy: tileRef.sy, sw: TILE, sh: TILE };
    }
}

export function _brushPaint(q, r) {
    if (bcState._activeBrush === null) return false;
    const brushes = _getAllBrushes();
    const brush = brushes[bcState._activeBrush];
    if (!brush) return false;

    const player = bcState._game && bcState._game.player;
    if (!player) return false;

    // Prevent painting on locked exterior walls during interior phase
    const key = `${q},${r}`;
    if (bcState._phase === 'interior' && bcState._meta[key] && bcState._meta[key]._exteriorWall) return false;

    // Check cost
    if (!_canAfford(player, brush.id)) {
        _showToast('Not enough resources!', 'err');
        return false;
    }

    const targetLayer = brush.brushType === 'wall' ? 'walls' : 'floor';

    // Don't charge again if already painted with the same brush
    const existing = bcState._brushGroupMap[key];
    if (!existing || existing.brushId !== brush.id) {
        _deductCost(player, brush.id);
    }

    bcState._brushGroupMap[key] = { brushId: brush.id, layer: targetLayer };

    // Mark wall tiles as impassable
    if (brush.brushType === 'wall') {
        bcState._meta[key] = { impassable: true };
    }

    // Recompute this cell and all neighbors
    const toUpdate = new Set();
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            const nq = q + dc, nr = r + dr;
            if (nq >= 0 && nq < bcState._gridW && nr >= 0 && nr < bcState._gridH) {
                const nk = `${nq},${nr}`;
                if (bcState._brushGroupMap[nk] && bcState._brushGroupMap[nk].brushId === brush.id) {
                    toUpdate.add(nk);
                }
            }
        }
    }
    toUpdate.add(key);
    for (const k of toUpdate) {
        const [uq, ur] = k.split(',').map(Number);
        _recomputeNineTile(uq, ur);
    }
    return true;
}

export function _brushErase(q, r) {
    const key = `${q},${r}`;
    // Prevent erasing locked exterior walls during interior phase
    if (bcState._phase === 'interior' && bcState._meta[key] && bcState._meta[key]._exteriorWall) return;
    const entry = bcState._brushGroupMap[key];
    if (!entry) {
        // Erase single-tile stamp
        delete bcState._layers[bcState._activeLayer][key];
        delete bcState._meta[key];
        return;
    }
    const brushId = entry.brushId;
    const targetLayer = entry.layer;
    delete bcState._brushGroupMap[key];
    delete bcState._layers[targetLayer][key];
    delete bcState._meta[key];

    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            const nq = q + dc, nr = r + dr;
            const nk = `${nq},${nr}`;
            if (nq >= 0 && nq < bcState._gridW && nr >= 0 && nr < bcState._gridH &&
                bcState._brushGroupMap[nk] && bcState._brushGroupMap[nk].brushId === brushId) {
                _recomputeNineTile(nq, nr);
            }
        }
    }
}

export function _metaToggle(q, r, type) {
    const key = `${q},${r}`;
    if (type === 'block') {
        // Toggle impassable on the tile (don't overwrite exteriorWall lock)
        const m = bcState._meta[key];
        if (m && m.impassable && !m.door && !m._exteriorWall) {
            delete bcState._meta[key];
        } else {
            bcState._meta[key] = { ...(m || {}), impassable: true, door: false };
        }
    } else if (type === 'door') {
        const m = bcState._meta[key];
        if (m && m.door) {
            // Toggle off
            const rest = { ...m };
            delete rest.door;
            if (Object.keys(rest).filter(k => k !== '_exteriorWall').length === 0) delete bcState._meta[key];
            else bcState._meta[key] = rest;
        } else {
            // Door is passable; clear impassable
            bcState._meta[key] = { ...(m || {}), door: true, impassable: false };
        }
    }
    _renderCanvas();
}

export function _stampPaint(q, r) {
    if (!bcState._activeStamp) return;
    const player = bcState._game && bcState._game.player;
    if (!player) return;

    // Prevent painting on locked exterior walls during interior phase
    const key = `${q},${r}`;
    if (bcState._phase === 'interior' && bcState._meta[key] && bcState._meta[key]._exteriorWall) return;

    // Stamp tiles cost gold only (no brush cost)
    const stampCost = { gold: 3, resources: {} };
    if (player.gold < stampCost.gold) {
        _showToast('Not enough gold!', 'err');
        return;
    }

    // Don't charge if same stamp already placed
    const existingTile = bcState._layers[bcState._activeLayer][key];
    if (!existingTile || existingTile.sheetPath !== bcState._activeStamp.sheetPath ||
        existingTile.sx !== bcState._activeStamp.sx || existingTile.sy !== bcState._activeStamp.sy) {
        player.gold -= stampCost.gold;
    }

    bcState._layers[bcState._activeLayer][key] = {
        sheetPath: bcState._activeStamp.sheetPath,
        sx: bcState._activeStamp.sx,
        sy: bcState._activeStamp.sy,
        sw: TILE, sh: TILE
    };
}

export function _renderCanvas() {
    if (!bcState._cvs || !bcState._ctx) return;
    const w = bcState._gridW * TILE * CANVAS_ZOOM;
    const h = bcState._gridH * TILE * CANVAS_ZOOM;
    bcState._cvs.width = Math.max(w + 40, 400);
    bcState._cvs.height = Math.max(h + 40, 300);
    bcState._ctx.clearRect(0, 0, bcState._cvs.width, bcState._cvs.height);

    // Background
    bcState._ctx.fillStyle = '#0a0e17';
    bcState._ctx.fillRect(0, 0, bcState._cvs.width, bcState._cvs.height);

    const ox = bcState._panX;
    const oy = bcState._panY;

    // Grid
    bcState._ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    bcState._ctx.lineWidth = 0.5;
    for (let c = 0; c <= bcState._gridW; c++) {
        bcState._ctx.beginPath();
        bcState._ctx.moveTo(ox + c * TILE * CANVAS_ZOOM, oy);
        bcState._ctx.lineTo(ox + c * TILE * CANVAS_ZOOM, oy + h);
        bcState._ctx.stroke();
    }
    for (let r = 0; r <= bcState._gridH; r++) {
        bcState._ctx.beginPath();
        bcState._ctx.moveTo(ox, oy + r * TILE * CANVAS_ZOOM);
        bcState._ctx.lineTo(ox + w, oy + r * TILE * CANVAS_ZOOM);
        bcState._ctx.stroke();
    }

    // Draw layers bottom to top
    const layerOrder = ['floor', 'walls', 'roof', 'overlay'];
    for (const lyrName of layerOrder) {
        const lyr = bcState._layers[lyrName];
        if (!lyr) continue;
        for (const [key, cell] of Object.entries(lyr)) {
            const [cq, cr] = key.split(',').map(Number);
            const img = _imgCache[cell.sheetPath];
            if (!(img instanceof HTMLImageElement)) continue;
            const dx = ox + cq * TILE * CANVAS_ZOOM;
            const dy = oy + cr * TILE * CANVAS_ZOOM;
            bcState._ctx.imageSmoothingEnabled = false;
            bcState._ctx.drawImage(img, cell.sx, cell.sy, cell.sw || TILE, cell.sh || TILE,
                dx, dy, TILE * CANVAS_ZOOM, TILE * CANVAS_ZOOM);
        }
    }

    // Meta overlay (impassable / door markers)
    for (const [key, m] of Object.entries(bcState._meta)) {
        const [cq, cr] = key.split(',').map(Number);
        const dx = ox + cq * TILE * CANVAS_ZOOM;
        const dy = oy + cr * TILE * CANVAS_ZOOM;
        const ds2 = TILE * CANVAS_ZOOM;
        if (m.door) {
            // Door — green tint + icon
            bcState._ctx.fillStyle = 'rgba(63, 185, 80, 0.30)';
            bcState._ctx.fillRect(dx, dy, ds2, ds2);
            bcState._ctx.strokeStyle = 'rgba(63, 185, 80, 0.8)';
            bcState._ctx.lineWidth = 1.5;
            bcState._ctx.strokeRect(dx + 1, dy + 1, ds2 - 2, ds2 - 2);
            bcState._ctx.fillStyle = '#3fb950';
            bcState._ctx.font = `${Math.floor(ds2 * 0.55)}px serif`;
            bcState._ctx.textAlign = 'center';
            bcState._ctx.textBaseline = 'middle';
            bcState._ctx.fillText('🚪', dx + ds2 / 2, dy + ds2 / 2);
        } else if (m.impassable) {
            if (m._exteriorWall) {
                // Exterior wall (locked) — blue tint
                bcState._ctx.fillStyle = 'rgba(88, 166, 255, 0.18)';
                bcState._ctx.fillRect(dx, dy, ds2, ds2);
                bcState._ctx.strokeStyle = 'rgba(88, 166, 255, 0.4)';
                bcState._ctx.lineWidth = 1;
                bcState._ctx.strokeRect(dx + 1, dy + 1, ds2 - 2, ds2 - 2);
            } else {
                // Manually blocked — red tint + X
                bcState._ctx.fillStyle = 'rgba(255, 50, 50, 0.22)';
                bcState._ctx.fillRect(dx, dy, ds2, ds2);
                bcState._ctx.strokeStyle = 'rgba(255, 80, 80, 0.6)';
                bcState._ctx.lineWidth = 1.5;
                bcState._ctx.strokeRect(dx + 1, dy + 1, ds2 - 2, ds2 - 2);
                bcState._ctx.strokeStyle = 'rgba(255, 80, 80, 0.5)';
                bcState._ctx.lineWidth = 1.5;
                bcState._ctx.beginPath();
                bcState._ctx.moveTo(dx + 4, dy + 4); bcState._ctx.lineTo(dx + ds2 - 4, dy + ds2 - 4);
                bcState._ctx.moveTo(dx + ds2 - 4, dy + 4); bcState._ctx.lineTo(dx + 4, dy + ds2 - 4);
                bcState._ctx.stroke();
            }
        }
    }

    // Active layer highlight
    bcState._ctx.strokeStyle = bcState._activeLayer === 'walls' ? 'rgba(230,168,23,0.3)' :
                       bcState._activeLayer === 'roof' ? 'rgba(163,113,247,0.3)' :
                       bcState._activeLayer === 'floor' ? 'rgba(63,185,80,0.3)' :
                       'rgba(88,166,255,0.3)';
    bcState._ctx.lineWidth = 2;
    bcState._ctx.strokeRect(ox - 1, oy - 1, w + 2, h + 2);

    // Update resource display
    _updateResourceDisplay();
}

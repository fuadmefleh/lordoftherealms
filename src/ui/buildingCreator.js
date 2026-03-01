// ═══════════════════════════════════════════════════════════
//  BUILDING CREATOR — In-game building designer
//  Lets the player paint walls, floors, and roofs using
//  nine-tile brushes from the editor.  Each brush tile has
//  a per-tile resource cost that is deducted from the
//  player's inventory / gold when placed.
// ═══════════════════════════════════════════════════════════

import { CustomInteriors } from '../world/customInteriors.js';
import { CustomBuildings } from '../world/customBuildings.js';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';

// ─── Constants ────────────────────────────────────────────
const TILE = 32;
const CANVAS_ZOOM = 2;
const PAL_ZOOM = 2;

// ─── Module state ─────────────────────────────────────────
let _overlay = null;          // Root DOM element
let _game = null;             // Game reference
let _anchorQ = 0;             // World inner-map anchor tile Q
let _anchorR = 0;             // World inner-map anchor tile R
let _gridW = 8;               // Grid width
let _gridH = 8;               // Grid height
let _layers = { floor: {}, walls: {}, roof: {}, overlay: {} };
let _meta = {};               // "q,r" → { impassable }
let _brushGroupMap = {};      // "q,r" → { brushId, layer }
let _activeLayer = 'floor';
let _activeTool = 'paint';    // paint | erase | fill
let _activeBrush = null;      // Index into combined brush list
let _activeStamp = null;      // Single-tile stamp { sheetPath, sx, sy }
let _panX = 10, _panY = 10;
let _buildingName = '';
let _isOpen = false;

// ─── Two-phase flow state ─────────────────────────────────
let _phase = 'exterior';      // 'exterior' | 'interior'
let _exteriorDef = null;      // Saved exterior building def from Phase 1

// Brush cost registry: brushId → { gold, resources: { [itemId]: qty } }
const _brushCosts = new Map();

// Image cache for palette rendering
const _imgCache = {};

// ─── LPC Palette for building materials ───
const BUILDING_PALETTE = {
    'Walls': [
        'assets/lpc/Structure/Walls/walls.png',
        'assets/lpc/Structure/Walls/Adobe Brick Wall.png',
        'assets/lpc/Structure/Walls/Adobe Stucco Wall.png',
        'assets/lpc/Structure/Walls/Brick Wall A.png',
        'assets/lpc/Structure/Walls/Brick Wall B.png',
        'assets/lpc/Structure/Walls/Jagged Stone Walls.png',
        'assets/lpc/Structure/Walls/Panels A.png',
    ],
    'Roofing': [
        'assets/lpc/Structure/Roofing/Adobe Brick Roof.png',
        'assets/lpc/Structure/Roofing/Adobe Stucco Roof.png',
        'assets/lpc/Structure/Roofing/Flat Shingle Roof A.png',
        'assets/lpc/Structure/Roofing/Gable Shingle Roof A.png',
        'assets/lpc/Structure/Roofing/Hipped Shingle Roof A.png',
        'assets/lpc/Structure/Roofing/Brick Chimney A.png',
    ],
    'Floors': [
        'assets/lpc/Structure/Floor/floors.png',
        'assets/lpc/Structure/Floor/Wood Floor A.png',
        'assets/lpc/Structure/Floor/Wood Floor B.png',
        'assets/lpc/Structure/Floor/Tile A.png',
        'assets/lpc/Structure/Floor/Tile B.png',
    ],
    'Doors': [
        'assets/lpc/Structure/Doors/32x48px Doors/Doorframe A.png',
        'assets/lpc/Structure/Doors/32x64px Doors/Doorframe A.png',
        'assets/lpc/Structure/Doors/32x64px Doors/15 Panel Door A.png',
    ],
    'Windows': [
        'assets/lpc/Structure/Windows/Ornamental Windows A.png',
        'assets/lpc/Structure/Windows/Stone Windows A.png',
    ],
    'Structures': [
        'assets/lpc/Structure/Structures/Brick House A.png',
        'assets/lpc/Structure/Structures/Brick House B.png',
        'assets/lpc/Structure/Structures/Paneled House A.png',
    ],
    'Pillars & Stairs': [
        'assets/lpc/Structure/Pillars/Stone Pillar A.png',
        'assets/lpc/Structure/Stairs/Formal Interior Stairs A.png',
        'assets/lpc/Structure/Stairs/Wood Interior Stairs A.png',
    ],
};

// ─── Default brush costs ──────────────────────────────────
// Applied when no explicit cost is set for a brush.
const DEFAULT_COSTS = {
    floor: { gold: 2, resources: { wood: 1 } },
    wall:  { gold: 5, resources: { stone: 1, wood: 1 } },
};

// ═══════════════════════════════════════════════════════════
//  IMAGE HELPERS
// ═══════════════════════════════════════════════════════════

function _loadImg(path) {
    if (_imgCache[path] instanceof HTMLImageElement) return Promise.resolve(_imgCache[path]);
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => { _imgCache[path] = img; resolve(img); };
        img.onerror = () => { _imgCache[path] = null; resolve(null); };
        img.src = path;
    });
}

// ═══════════════════════════════════════════════════════════
//  BRUSH COST API
// ═══════════════════════════════════════════════════════════

/**
 * Set the resource cost for a brush.
 * @param {string} brushId
 * @param {{ gold?: number, resources?: Record<string, number> }} cost
 */
function setBrushCost(brushId, cost) {
    _brushCosts.set(brushId, {
        gold: cost.gold || 0,
        resources: cost.resources || {},
    });
}

/**
 * Get the cost for a brush.
 * Priority: runtime override → editor-defined cost on brush → type-based default.
 */
function getBrushCost(brushId) {
    if (_brushCosts.has(brushId)) return _brushCosts.get(brushId);
    const brush = _getAllBrushes().find(b => b.id === brushId);
    if (brush && brush.cost && (brush.cost.gold > 0 || Object.keys(brush.cost.resources || {}).length > 0)) {
        return { gold: brush.cost.gold || 0, resources: brush.cost.resources || {} };
    }
    const type = brush ? brush.brushType : 'floor';
    return DEFAULT_COSTS[type] || DEFAULT_COSTS.floor;
}

/**
 * Get all available brushes (floor + wall from CustomInteriors).
 */
function _getAllBrushes() {
    if (typeof CustomInteriors !== 'undefined' && CustomInteriors.getBrushes) {
        return CustomInteriors.getBrushes();
    }
    return [];
}

/**
 * Check if the player can afford a single tile placement.
 */
function _canAfford(player, brushId) {
    const cost = getBrushCost(brushId);
    if (cost.gold > 0 && player.gold < cost.gold) return false;
    for (const [itemId, qty] of Object.entries(cost.resources)) {
        if ((player.inventory[itemId] || 0) < qty) return false;
    }
    return true;
}

/**
 * Deduct cost for placing one tile.
 */
function _deductCost(player, brushId) {
    const cost = getBrushCost(brushId);
    player.gold -= cost.gold;
    for (const [itemId, qty] of Object.entries(cost.resources)) {
        player.inventory[itemId] = (player.inventory[itemId] || 0) - qty;
        if (player.inventory[itemId] <= 0) delete player.inventory[itemId];
    }
}

/**
 * Format a cost object into a human-readable string.
 */
function _formatCost(cost) {
    const parts = [];
    if (cost.gold > 0) parts.push(`${cost.gold}g`);
    for (const [itemId, qty] of Object.entries(cost.resources || {})) {
        const name = itemId.replace(/_/g, ' ');
        parts.push(`${qty} ${name}`);
    }
    return parts.join(', ') || 'Free';
}

// ═══════════════════════════════════════════════════════════
//  NINE-TILE AUTO-TILING
// ═══════════════════════════════════════════════════════════

function _recomputeNineTile(q, r) {
    const key = `${q},${r}`;
    const entry = _brushGroupMap[key];
    if (!entry) return;
    const brushes = _getAllBrushes();
    const brush = brushes.find(b => b.id === entry.brushId);
    if (!brush) return;
    const targetLayer = entry.layer;
    const groupId = entry.brushId;

    const has = (dq, dr) => {
        const nq = q + dq, nr = r + dr;
        if (nq < 0 || nq >= _gridW || nr < 0 || nr >= _gridH) return false;
        const nk = `${nq},${nr}`;
        return _brushGroupMap[nk] && _brushGroupMap[nk].brushId === groupId;
    };

    const hasTop = has(0, -1), hasBottom = has(0, 1), hasLeft = has(-1, 0), hasRight = has(1, 0);
    const hasTL = has(-1, -1), hasTR = has(1, -1), hasBL = has(-1, 1), hasBR = has(1, 1);
    const cardCount = (hasTop ? 1 : 0) + (hasBottom ? 1 : 0) + (hasLeft ? 1 : 0) + (hasRight ? 1 : 0);

    // Wall brush corridor/junction logic
    if (brush.brushType === 'wall' && brush.corridors) {
        if (cardCount === 0 && brush.corridors[7]) {
            _layers[targetLayer][key] = { sheetPath: brush.corridors[7].sheetPath, sx: brush.corridors[7].sx, sy: brush.corridors[7].sy, sw: TILE, sh: TILE };
            return;
        }
        if (cardCount === 1 && brush.endCaps) {
            let ec = hasBottom ? 0 : hasTop ? 1 : hasRight ? 2 : hasLeft ? 3 : -1;
            if (ec >= 0 && brush.endCaps[ec]) {
                _layers[targetLayer][key] = { sheetPath: brush.endCaps[ec].sheetPath, sx: brush.endCaps[ec].sx, sy: brush.endCaps[ec].sy, sw: TILE, sh: TILE };
                return;
            }
        }
        if (hasTop && hasBottom && !hasLeft && !hasRight && brush.corridors[0]) {
            _layers[targetLayer][key] = { sheetPath: brush.corridors[0].sheetPath, sx: brush.corridors[0].sx, sy: brush.corridors[0].sy, sw: TILE, sh: TILE };
            return;
        }
        if (hasLeft && hasRight && !hasTop && !hasBottom && brush.corridors[1]) {
            _layers[targetLayer][key] = { sheetPath: brush.corridors[1].sheetPath, sx: brush.corridors[1].sx, sy: brush.corridors[1].sy, sw: TILE, sh: TILE };
            return;
        }
        if (cardCount === 3) {
            let tIdx = -1;
            if (hasLeft && hasRight && hasBottom && !hasTop) tIdx = 2;
            else if (hasLeft && hasRight && hasTop && !hasBottom) tIdx = 3;
            else if (hasTop && hasBottom && hasRight && !hasLeft) tIdx = 4;
            else if (hasTop && hasBottom && hasLeft && !hasRight) tIdx = 5;
            if (tIdx >= 0 && brush.corridors[tIdx]) {
                _layers[targetLayer][key] = { sheetPath: brush.corridors[tIdx].sheetPath, sx: brush.corridors[tIdx].sx, sy: brush.corridors[tIdx].sy, sw: TILE, sh: TILE };
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
            _layers[targetLayer][key] = { sheetPath: ic.sheetPath, sx: ic.sx, sy: ic.sy, sw: TILE, sh: TILE };
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
        _layers[targetLayer][key] = { sheetPath: tileRef.sheetPath, sx: tileRef.sx, sy: tileRef.sy, sw: TILE, sh: TILE };
    }
}

function _brushPaint(q, r) {
    if (_activeBrush === null) return false;
    const brushes = _getAllBrushes();
    const brush = brushes[_activeBrush];
    if (!brush) return false;

    const player = _game && _game.player;
    if (!player) return false;

    // Prevent painting on locked exterior walls during interior phase
    const key = `${q},${r}`;
    if (_phase === 'interior' && _meta[key] && _meta[key]._exteriorWall) return false;

    // Check cost
    if (!_canAfford(player, brush.id)) {
        _showToast('Not enough resources!', 'err');
        return false;
    }

    const targetLayer = brush.brushType === 'wall' ? 'walls' : 'floor';

    // Don't charge again if already painted with the same brush
    const existing = _brushGroupMap[key];
    if (!existing || existing.brushId !== brush.id) {
        _deductCost(player, brush.id);
    }

    _brushGroupMap[key] = { brushId: brush.id, layer: targetLayer };

    // Mark wall tiles as impassable
    if (brush.brushType === 'wall') {
        _meta[key] = { impassable: true };
    }

    // Recompute this cell and all neighbors
    const toUpdate = new Set();
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            const nq = q + dc, nr = r + dr;
            if (nq >= 0 && nq < _gridW && nr >= 0 && nr < _gridH) {
                const nk = `${nq},${nr}`;
                if (_brushGroupMap[nk] && _brushGroupMap[nk].brushId === brush.id) {
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

function _brushErase(q, r) {
    const key = `${q},${r}`;
    // Prevent erasing locked exterior walls during interior phase
    if (_phase === 'interior' && _meta[key] && _meta[key]._exteriorWall) return;
    const entry = _brushGroupMap[key];
    if (!entry) {
        // Erase single-tile stamp
        delete _layers[_activeLayer][key];
        delete _meta[key];
        return;
    }
    const brushId = entry.brushId;
    const targetLayer = entry.layer;
    delete _brushGroupMap[key];
    delete _layers[targetLayer][key];
    delete _meta[key];

    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            const nq = q + dc, nr = r + dr;
            const nk = `${nq},${nr}`;
            if (nq >= 0 && nq < _gridW && nr >= 0 && nr < _gridH &&
                _brushGroupMap[nk] && _brushGroupMap[nk].brushId === brushId) {
                _recomputeNineTile(nq, nr);
            }
        }
    }
}

function _stampPaint(q, r) {
    if (!_activeStamp) return;
    const player = _game && _game.player;
    if (!player) return;

    // Prevent painting on locked exterior walls during interior phase
    const key = `${q},${r}`;
    if (_phase === 'interior' && _meta[key] && _meta[key]._exteriorWall) return;

    // Stamp tiles cost gold only (no brush cost)
    const stampCost = { gold: 3, resources: {} };
    if (player.gold < stampCost.gold) {
        _showToast('Not enough gold!', 'err');
        return;
    }

    // Don't charge if same stamp already placed
    const existingTile = _layers[_activeLayer][key];
    if (!existingTile || existingTile.sheetPath !== _activeStamp.sheetPath ||
        existingTile.sx !== _activeStamp.sx || existingTile.sy !== _activeStamp.sy) {
        player.gold -= stampCost.gold;
    }

    _layers[_activeLayer][key] = {
        sheetPath: _activeStamp.sheetPath,
        sx: _activeStamp.sx,
        sy: _activeStamp.sy,
        sw: TILE, sh: TILE
    };
}

// ═══════════════════════════════════════════════════════════
//  CANVAS RENDERING
// ═══════════════════════════════════════════════════════════

let _cvs, _ctx;

function _renderCanvas() {
    if (!_cvs || !_ctx) return;
    const w = _gridW * TILE * CANVAS_ZOOM;
    const h = _gridH * TILE * CANVAS_ZOOM;
    _cvs.width = Math.max(w + 40, 400);
    _cvs.height = Math.max(h + 40, 300);
    _ctx.clearRect(0, 0, _cvs.width, _cvs.height);

    // Background
    _ctx.fillStyle = '#0a0e17';
    _ctx.fillRect(0, 0, _cvs.width, _cvs.height);

    const ox = _panX;
    const oy = _panY;

    // Grid
    _ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    _ctx.lineWidth = 0.5;
    for (let c = 0; c <= _gridW; c++) {
        _ctx.beginPath();
        _ctx.moveTo(ox + c * TILE * CANVAS_ZOOM, oy);
        _ctx.lineTo(ox + c * TILE * CANVAS_ZOOM, oy + h);
        _ctx.stroke();
    }
    for (let r = 0; r <= _gridH; r++) {
        _ctx.beginPath();
        _ctx.moveTo(ox, oy + r * TILE * CANVAS_ZOOM);
        _ctx.lineTo(ox + w, oy + r * TILE * CANVAS_ZOOM);
        _ctx.stroke();
    }

    // Draw layers bottom to top
    const layerOrder = ['floor', 'walls', 'roof', 'overlay'];
    for (const lyrName of layerOrder) {
        const lyr = _layers[lyrName];
        if (!lyr) continue;
        for (const [key, cell] of Object.entries(lyr)) {
            const [cq, cr] = key.split(',').map(Number);
            const img = _imgCache[cell.sheetPath];
            if (!(img instanceof HTMLImageElement)) continue;
            const dx = ox + cq * TILE * CANVAS_ZOOM;
            const dy = oy + cr * TILE * CANVAS_ZOOM;
            _ctx.imageSmoothingEnabled = false;
            _ctx.drawImage(img, cell.sx, cell.sy, cell.sw || TILE, cell.sh || TILE,
                dx, dy, TILE * CANVAS_ZOOM, TILE * CANVAS_ZOOM);
        }
    }

    // Meta overlay (impassable markers)
    for (const [key, m] of Object.entries(_meta)) {
        if (!m.impassable) continue;
        const [cq, cr] = key.split(',').map(Number);
        const dx = ox + cq * TILE * CANVAS_ZOOM;
        const dy = oy + cr * TILE * CANVAS_ZOOM;
        if (m._exteriorWall) {
            // Exterior wall (locked) — blue tint
            _ctx.fillStyle = 'rgba(88, 166, 255, 0.18)';
            _ctx.fillRect(dx, dy, TILE * CANVAS_ZOOM, TILE * CANVAS_ZOOM);
            _ctx.strokeStyle = 'rgba(88, 166, 255, 0.4)';
            _ctx.lineWidth = 1;
            _ctx.strokeRect(dx + 1, dy + 1, TILE * CANVAS_ZOOM - 2, TILE * CANVAS_ZOOM - 2);
        } else {
            _ctx.fillStyle = 'rgba(255, 50, 50, 0.15)';
            _ctx.fillRect(dx, dy, TILE * CANVAS_ZOOM, TILE * CANVAS_ZOOM);
        }
    }

    // Active layer highlight
    _ctx.strokeStyle = _activeLayer === 'walls' ? 'rgba(230,168,23,0.3)' :
                       _activeLayer === 'roof' ? 'rgba(163,113,247,0.3)' :
                       _activeLayer === 'floor' ? 'rgba(63,185,80,0.3)' :
                       'rgba(88,166,255,0.3)';
    _ctx.lineWidth = 2;
    _ctx.strokeRect(ox - 1, oy - 1, w + 2, h + 2);

    // Update resource display
    _updateResourceDisplay();
}

// ═══════════════════════════════════════════════════════════
//  UI CONSTRUCTION
// ═══════════════════════════════════════════════════════════

function _showToast(msg, type) {
    const toast = _overlay && _overlay.querySelector('#bc-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'bc-toast ' + (type || '');
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 2200);
}

function _updateResourceDisplay() {
    const el = _overlay && _overlay.querySelector('#bc-resources');
    if (!el || !_game || !_game.player) return;
    const p = _game.player;
    const items = [];
    items.push(`💰 ${p.gold}g`);
    if (p.inventory.wood)  items.push(`🌲 ${p.inventory.wood} wood`);
    if (p.inventory.stone) items.push(`⛰️ ${p.inventory.stone} stone`);
    if (p.inventory.iron)  items.push(`⚒️ ${p.inventory.iron} iron`);
    el.textContent = items.join('  ·  ');
}

function _buildUI() {
    // Root overlay
    _overlay = document.createElement('div');
    _overlay.id = 'buildingCreatorOverlay';
    _overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 1500;
        background: rgba(0,0,0,0.92); backdrop-filter: blur(6px);
        display: flex; flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; color: #c9d1d9;
    `;

    // ── Toolbar ──
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
        display: flex; align-items: center; gap: 8px; padding: 6px 12px;
        background: #161b22; border-bottom: 2px solid #21262d;
        height: 44px; flex-shrink: 0;
    `;
    toolbar.innerHTML = `
        <span style="font-size:14px;font-weight:700;color:#e6a817;margin-right:10px">🏗️ Building Creator</span>
        <span id="bc-phase-badge" style="font-size:10px;padding:2px 8px;border-radius:4px;text-transform:uppercase;font-weight:600;background:#0b2a4a;color:#58a6ff;border:1px solid #58a6ff">${_phase === 'exterior' ? 'Phase 1: Exterior' : 'Phase 2: Interior'}</span>
        <div style="width:1px;height:22px;background:#30363d;margin:0 4px"></div>
        <label style="font-size:11px;color:#8b949e">Name:</label>
        <input type="text" id="bc-name" value="${_buildingName || ''}" placeholder="My Building" style="width:140px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:3px 7px;border-radius:4px;font-size:12px">
        <div style="width:1px;height:22px;background:#30363d;margin:0 4px"></div>
        <label style="font-size:11px;color:#8b949e">W:</label>
        <input type="number" id="bc-grid-w" value="${_gridW}" min="3" max="20" style="width:42px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:3px 5px;border-radius:4px;font-size:12px" ${_phase === 'interior' ? 'disabled' : ''}>
        <label style="font-size:11px;color:#8b949e">H:</label>
        <input type="number" id="bc-grid-h" value="${_gridH}" min="3" max="20" style="width:42px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:3px 5px;border-radius:4px;font-size:12px" ${_phase === 'interior' ? 'disabled' : ''}>
        <button id="bc-resize-btn" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:3px 9px;border-radius:5px;cursor:pointer;font-size:12px" ${_phase === 'interior' ? 'disabled' : ''}>Resize</button>
        <div style="width:1px;height:22px;background:#30363d;margin:0 4px"></div>
        <div id="bc-tool-btns" style="display:flex;gap:3px"></div>
        <div style="width:1px;height:22px;background:#30363d;margin:0 4px"></div>
        <div id="bc-resources" style="font-size:11px;color:#8b949e;flex:1"></div>
        ${_phase === 'exterior'
            ? '<button id="bc-finish-btn" style="background:#0b2a4a;border:1px solid #58a6ff;color:#58a6ff;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600">▶ Finish Exterior → Interior</button>'
            : '<button id="bc-finish-btn" style="background:#0e2a17;border:1px solid #3fb950;color:#3fb950;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600">✅ Finish & Place</button>'
        }
        <button id="bc-cancel-btn" style="background:#2a0d0d;border:1px solid #f85149;color:#f85149;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:12px">Cancel</button>
    `;
    _overlay.appendChild(toolbar);

    // ── Main 3-column layout ──
    const main = document.createElement('div');
    main.style.cssText = 'display:flex;flex:1;overflow:hidden;min-height:0';

    // LEFT: Brush palette
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = `
        width: 280px; flex-shrink: 0; background: #161b22;
        border-right: 1px solid #21262d; display: flex;
        flex-direction: column; overflow: hidden;
    `;
    leftPanel.innerHTML = `
        <div style="padding:7px 10px;border-bottom:1px solid #21262d;flex-shrink:0">
            <div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.06em">Brushes & Tiles</div>
        </div>
        <div id="bc-brush-section" style="padding:6px;border-bottom:1px solid #21262d;overflow-y:auto;max-height:200px">
            <div style="font-size:10px;color:#8b949e;text-transform:uppercase;font-weight:600;margin-bottom:4px">Nine-Tile Brushes</div>
            <div id="bc-brush-list" style="display:flex;flex-direction:column;gap:3px"></div>
        </div>
        <div style="padding:7px 10px;border-bottom:1px solid #21262d;flex-shrink:0">
            <div style="font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.06em">Tile Palette</div>
        </div>
        <div id="bc-pal-cats" style="display:flex;flex-wrap:wrap;gap:3px;padding:4px 8px;border-bottom:1px solid #21262d;flex-shrink:0"></div>
        <div id="bc-pal-sheets" style="flex:1;overflow-y:auto;padding:6px"></div>
    `;
    main.appendChild(leftPanel);

    // CENTER: Canvas area
    const center = document.createElement('div');
    center.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';
    center.innerHTML = `
        <div id="bc-layer-bar" style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:#161b22;border-bottom:1px solid #21262d;flex-shrink:0"></div>
        <div id="bc-canvas-wrap" style="flex:1;position:relative;overflow:hidden;background:#0a0e17">
            <canvas id="bc-canvas" style="position:absolute;image-rendering:pixelated"></canvas>
        </div>
    `;
    main.appendChild(center);

    // RIGHT: Cost editor
    const rightPanel = document.createElement('div');
    rightPanel.style.cssText = `
        width: 260px; flex-shrink: 0; background: #161b22;
        border-left: 1px solid #21262d; display: flex;
        flex-direction: column; overflow-y: auto; padding: 10px;
    `;
    rightPanel.innerHTML = `
        <div style="margin-bottom:14px">
            <div style="font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Brush Cost Editor</div>
            <div id="bc-cost-editor" style="font-size:12px;color:#8b949e">Select a brush to edit its cost per tile</div>
        </div>
        <div style="margin-bottom:14px">
            <div style="font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Stamp Preview</div>
            <div id="bc-stamp-preview" style="height:60px;border:1px solid #21262d;border-radius:5px;background:#0d1117;display:flex;align-items:center;justify-content:center;overflow:hidden">
                <span style="color:#8b949e;font-size:11px">No tile selected</span>
            </div>
        </div>
        <div>
            <div style="font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Total Cost Summary</div>
            <div id="bc-total-cost" style="font-size:12px;color:#c9d1d9;padding:8px;background:#0d1117;border:1px solid #21262d;border-radius:5px"></div>
        </div>
    `;
    main.appendChild(rightPanel);

    _overlay.appendChild(main);

    // Toast
    const toast = document.createElement('div');
    toast.id = 'bc-toast';
    toast.className = 'bc-toast';
    toast.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: #161b22; border: 1px solid #21262d; color: #c9d1d9;
        padding: 8px 18px; border-radius: 6px; font-size: 12px;
        display: none; z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    `;
    _overlay.appendChild(toast);

    // Add style overrides
    const style = document.createElement('style');
    style.textContent = `
        .bc-toast.ok { border-color: #3fb950; color: #3fb950; }
        .bc-toast.err { border-color: #f85149; color: #f85149; }
        .bc-brush-card { display:flex;align-items:center;gap:8px;padding:5px 7px;border:1px solid #21262d;border-radius:5px;cursor:pointer;transition:border-color .12s,background .12s;background:#0d1117; }
        .bc-brush-card:hover { border-color:#58a6ff;background:#1c2129; }
        .bc-brush-card.selected { border-color:#e6a817;background:#1a1500; }
        .bc-cat-btn { font-size:10px;padding:3px 7px;border-radius:4px;background:#21262d;border:1px solid #30363d;color:#c9d1d9;cursor:pointer;white-space:nowrap; }
        .bc-cat-btn:hover { background:#2d333b;border-color:#484f58; }
        .bc-cat-btn.active { background:#0b2a4a;border-color:#58a6ff;color:#58a6ff; }
        .bc-layer-btn { font-size:11px;padding:3px 8px;border-radius:4px;background:#21262d;border:1px solid #30363d;color:#c9d1d9;cursor:pointer; }
        .bc-layer-btn:hover { background:#2d333b; }
        .bc-layer-btn.active { background:#0b2a4a;border-color:#58a6ff;color:#58a6ff; }
        .bc-tool-btn { background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:3px 9px;border-radius:5px;cursor:pointer;font-size:12px; }
        .bc-tool-btn:hover { background:#2d333b;border-color:#484f58; }
        .bc-tool-btn.active { background:#0b2a4a;border-color:#58a6ff;color:#58a6ff; }
        #bc-canvas-wrap { cursor: crosshair; }
    `;
    _overlay.appendChild(style);

    document.body.appendChild(_overlay);

    // ── Wire up events ──
    _cvs = _overlay.querySelector('#bc-canvas');
    _ctx = _cvs.getContext('2d');

    // Toolbar buttons
    _overlay.querySelector('#bc-cancel-btn').addEventListener('click', () => close());
    _overlay.querySelector('#bc-finish-btn').addEventListener('click', () => {
        if (_phase === 'exterior') {
            _finishExteriorPhase();
        } else {
            _finishBuilding();
        }
    });
    const resizeBtn = _overlay.querySelector('#bc-resize-btn');
    if (resizeBtn && !resizeBtn.disabled) {
        resizeBtn.addEventListener('click', () => {
            _gridW = Math.max(3, Math.min(20, parseInt(_overlay.querySelector('#bc-grid-w').value) || 8));
            _gridH = Math.max(3, Math.min(20, parseInt(_overlay.querySelector('#bc-grid-h').value) || 8));
            _renderCanvas();
        });
    }

    // Tool buttons
    _buildToolButtons();
    _buildLayerButtons();
    _buildBrushList();
    _buildPaletteCats();

    // Canvas mouse events
    let drawing = false;
    _cvs.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        drawing = true;
        _handleCanvasClick(e);
    });
    _cvs.addEventListener('mousemove', (e) => {
        if (!drawing) return;
        _handleCanvasClick(e);
    });
    window.addEventListener('mouseup', () => { drawing = false; });

    // Keyboard shortcuts
    _overlay.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        if (e.key === 'Escape') { close(); e.preventDefault(); }
        if (e.key === 'p' || e.key === 'P') _setTool('paint');
        if (e.key === 'e' || e.key === 'E') _setTool('erase');
    });
    _overlay.tabIndex = 0;
    _overlay.focus();

    _renderCanvas();
}

function _handleCanvasClick(e) {
    const rect = _cvs.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const q = Math.floor((mx - _panX) / (TILE * CANVAS_ZOOM));
    const r = Math.floor((my - _panY) / (TILE * CANVAS_ZOOM));
    if (q < 0 || q >= _gridW || r < 0 || r >= _gridH) return;

    if (_activeTool === 'paint') {
        if (_activeBrush !== null) {
            _brushPaint(q, r);
        } else if (_activeStamp) {
            _stampPaint(q, r);
        }
    } else if (_activeTool === 'erase') {
        _brushErase(q, r);
    }

    _renderCanvas();
    if (_game && _game.ui) _game.ui.updateStats(_game.player, _game.world);
}

function _buildToolButtons() {
    const container = _overlay.querySelector('#bc-tool-btns');
    if (!container) return;
    const tools = [
        { id: 'paint', label: '🖌 Paint', key: 'P' },
        { id: 'erase', label: '🗑 Erase', key: 'E' },
    ];
    container.innerHTML = '';
    for (const t of tools) {
        const btn = document.createElement('button');
        btn.className = 'bc-tool-btn' + (_activeTool === t.id ? ' active' : '');
        btn.textContent = t.label;
        btn.title = `${t.label} (${t.key})`;
        btn.addEventListener('click', () => _setTool(t.id));
        container.appendChild(btn);
    }
}

function _setTool(tool) {
    _activeTool = tool;
    _buildToolButtons();
}

function _buildLayerButtons() {
    const container = _overlay.querySelector('#bc-layer-bar');
    if (!container) return;
    const layerNames = ['floor', 'walls', 'roof', 'overlay'];
    const layerIcons = { floor: '🟫', walls: '🧱', roof: '🏠', overlay: '✨' };
    container.innerHTML = '';
    for (const ln of layerNames) {
        const btn = document.createElement('button');
        btn.className = 'bc-layer-btn' + (_activeLayer === ln ? ' active' : '');
        btn.textContent = `${layerIcons[ln] || ''} ${ln.charAt(0).toUpperCase() + ln.slice(1)}`;
        btn.addEventListener('click', () => {
            _activeLayer = ln;
            _buildLayerButtons();
        });
        container.appendChild(btn);
    }

    // Clear layer button
    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:22px;background:#30363d;margin:0 4px';
    container.appendChild(sep);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'bc-tool-btn';
    clearBtn.style.cssText = 'color:#f85149;border-color:#f85149';
    clearBtn.textContent = '🗑 Clear Layer';
    clearBtn.addEventListener('click', () => {
        _layers[_activeLayer] = {};
        // Remove brush group entries for this layer
        for (const [key, entry] of Object.entries(_brushGroupMap)) {
            if (entry.layer === _activeLayer) {
                delete _brushGroupMap[key];
                delete _meta[key];
            }
        }
        _renderCanvas();
    });
    container.appendChild(clearBtn);
}

function _buildBrushList() {
    const container = _overlay.querySelector('#bc-brush-list');
    if (!container) return;
    const brushes = _getAllBrushes();
    container.innerHTML = '';

    if (brushes.length === 0) {
        container.innerHTML = '<div style="font-size:11px;color:#8b949e;padding:4px 0">No brushes available. Create brushes in the Interior Editor first.</div>';
        return;
    }

    brushes.forEach((brush, i) => {
        const card = document.createElement('div');
        card.className = 'bc-brush-card' + (_activeBrush === i ? ' selected' : '');
        card.addEventListener('click', () => _selectBrush(i));

        // Thumbnail
        const cvs = document.createElement('canvas');
        cvs.width = 24; cvs.height = 24;
        cvs.style.cssText = 'image-rendering:pixelated;flex-shrink:0;border-radius:3px';
        const ctx2 = cvs.getContext('2d');
        ctx2.imageSmoothingEnabled = false;
        const ctr = brush.tiles[1] && brush.tiles[1][1];
        if (ctr) {
            const img = _imgCache[ctr.sheetPath];
            if (img instanceof HTMLImageElement) {
                ctx2.drawImage(img, ctr.sx, ctr.sy, TILE, TILE, 0, 0, 24, 24);
            } else {
                _loadImg(ctr.sheetPath).then(loadedImg => {
                    if (loadedImg) ctx2.drawImage(loadedImg, ctr.sx, ctr.sy, TILE, TILE, 0, 0, 24, 24);
                });
            }
        }
        card.appendChild(cvs);

        // Name
        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        nameSpan.textContent = brush.name;
        card.appendChild(nameSpan);

        // Type badge
        const badge = document.createElement('span');
        badge.style.cssText = `font-size:9px;padding:1px 5px;border-radius:3px;text-transform:uppercase;font-weight:600;${
            brush.brushType === 'wall' ? 'background:#2a1f00;color:#e6a817' : 'background:#0e2a17;color:#3fb950'
        }`;
        badge.textContent = brush.brushType || 'floor';
        card.appendChild(badge);

        // Cost label
        const costLabel = document.createElement('span');
        costLabel.style.cssText = 'font-size:9px;color:#8b949e;white-space:nowrap';
        costLabel.textContent = _formatCost(getBrushCost(brush.id));
        card.appendChild(costLabel);

        container.appendChild(card);
    });
}

function _selectBrush(idx) {
    _activeBrush = (_activeBrush === idx) ? null : idx;
    _activeStamp = null;
    if (_activeBrush !== null) {
        const brush = _getAllBrushes()[_activeBrush];
        if (brush) {
            _activeLayer = brush.brushType === 'wall' ? 'walls' : 'floor';
            _buildLayerButtons();
        }
        _setTool('paint');
    }
    _buildBrushList();
    _updateCostEditor();
    _updateStampPreview();
}

function _updateCostEditor() {
    const container = _overlay.querySelector('#bc-cost-editor');
    if (!container) return;

    if (_activeBrush === null) {
        container.innerHTML = '<div style="color:#8b949e">Select a brush to edit its cost per tile</div>';
        return;
    }

    const brushes = _getAllBrushes();
    const brush = brushes[_activeBrush];
    if (!brush) return;

    const cost = getBrushCost(brush.id);

    container.innerHTML = `
        <div style="margin-bottom:8px;font-weight:600;color:#e6a817">${brush.name}</div>
        <div style="margin-bottom:6px">
            <label style="font-size:11px;color:#8b949e;display:block;margin-bottom:2px">Gold per tile</label>
            <input type="number" id="bc-cost-gold" value="${cost.gold}" min="0" max="1000"
                style="width:80px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:3px 7px;border-radius:4px;font-size:12px">
        </div>
        <div style="font-size:11px;color:#8b949e;margin-bottom:4px">Resources per tile:</div>
        <div id="bc-cost-resources" style="display:flex;flex-direction:column;gap:4px"></div>
        <button id="bc-cost-add-res" style="margin-top:6px;font-size:10px;padding:2px 8px;background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:4px;cursor:pointer">+ Add Resource</button>
        <button id="bc-cost-save" style="margin-top:6px;margin-left:4px;font-size:10px;padding:2px 8px;background:#0e2a17;border:1px solid #3fb950;color:#3fb950;border-radius:4px;cursor:pointer">Save Cost</button>
    `;

    const resContainer = container.querySelector('#bc-cost-resources');
    const resourceOptions = ['wood', 'stone', 'iron', 'gold_ore', 'gems', 'tools', 'textiles'];

    function _renderResources() {
        resContainer.innerHTML = '';
        for (const [itemId, qty] of Object.entries(cost.resources)) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px';
            row.innerHTML = `
                <select style="flex:1;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:2px 4px;border-radius:3px;font-size:11px">
                    ${resourceOptions.map(r => `<option value="${r}" ${r === itemId ? 'selected' : ''}>${r.replace(/_/g, ' ')}</option>`).join('')}
                </select>
                <input type="number" value="${qty}" min="0" max="100" style="width:50px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:2px 4px;border-radius:3px;font-size:11px">
                <button style="font-size:10px;color:#f85149;background:none;border:none;cursor:pointer;padding:2px 4px">✕</button>
            `;
            const delBtn = row.querySelector('button');
            delBtn.addEventListener('click', () => {
                delete cost.resources[itemId];
                _renderResources();
            });
            resContainer.appendChild(row);
        }
    }
    _renderResources();

    container.querySelector('#bc-cost-add-res').addEventListener('click', () => {
        const unused = resourceOptions.find(r => !(r in cost.resources));
        if (unused) {
            cost.resources[unused] = 1;
            _renderResources();
        }
    });

    container.querySelector('#bc-cost-save').addEventListener('click', () => {
        const goldInput = container.querySelector('#bc-cost-gold');
        const newCost = {
            gold: parseInt(goldInput.value) || 0,
            resources: {},
        };
        const rows = resContainer.querySelectorAll('div');
        rows.forEach(row => {
            const select = row.querySelector('select');
            const input = row.querySelector('input');
            if (select && input) {
                const qty = parseInt(input.value) || 0;
                if (qty > 0) newCost.resources[select.value] = qty;
            }
        });
        setBrushCost(brush.id, newCost);
        _showToast('Cost saved!', 'ok');
        _buildBrushList();
    });
}

function _updateStampPreview() {
    const el = _overlay && _overlay.querySelector('#bc-stamp-preview');
    if (!el) return;
    if (!_activeStamp && _activeBrush === null) {
        el.innerHTML = '<span style="color:#8b949e;font-size:11px">No tile selected</span>';
        return;
    }
    if (_activeBrush !== null) {
        const brushes = _getAllBrushes();
        const brush = brushes[_activeBrush];
        if (!brush || !brush.tiles[1] || !brush.tiles[1][1]) {
            el.innerHTML = '<span style="color:#8b949e;font-size:11px">Brush has no center tile</span>';
            return;
        }
        const pc = document.createElement('canvas');
        pc.width = 3 * TILE; pc.height = 3 * TILE;
        pc.style.cssText = 'image-rendering:pixelated';
        const pctx = pc.getContext('2d');
        pctx.imageSmoothingEnabled = false;
        const paths = new Set();
        for (const row of brush.tiles) for (const t of row) if (t) paths.add(t.sheetPath);
        Promise.all([...paths].map(_loadImg)).then(() => {
            for (let rr = 0; rr < 3; rr++) {
                for (let cc = 0; cc < 3; cc++) {
                    const t = brush.tiles[rr] && brush.tiles[rr][cc];
                    if (!t) continue;
                    const img = _imgCache[t.sheetPath];
                    if (img instanceof HTMLImageElement) {
                        pctx.drawImage(img, t.sx, t.sy, TILE, TILE, cc * TILE, rr * TILE, TILE, TILE);
                    }
                }
            }
            el.innerHTML = '';
            el.appendChild(pc);
        });
        return;
    }
    if (_activeStamp) {
        const pc = document.createElement('canvas');
        pc.width = TILE; pc.height = TILE;
        pc.style.cssText = 'image-rendering:pixelated';
        const pctx = pc.getContext('2d');
        pctx.imageSmoothingEnabled = false;
        _loadImg(_activeStamp.sheetPath).then(img => {
            if (img) pctx.drawImage(img, _activeStamp.sx, _activeStamp.sy, TILE, TILE, 0, 0, TILE, TILE);
            el.innerHTML = '';
            el.appendChild(pc);
        });
    }
}

function _buildPaletteCats() {
    const container = _overlay.querySelector('#bc-pal-cats');
    if (!container) return;
    container.innerHTML = '';
    for (const cat of Object.keys(BUILDING_PALETTE)) {
        const btn = document.createElement('button');
        btn.className = 'bc-cat-btn';
        btn.textContent = cat;
        btn.addEventListener('click', () => _showPaletteCategory(cat, btn));
        container.appendChild(btn);
    }
    // Auto-select first category
    const first = container.querySelector('.bc-cat-btn');
    if (first) first.click();
}

function _showPaletteCategory(cat, btn) {
    _overlay.querySelectorAll('.bc-cat-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const container = _overlay.querySelector('#bc-pal-sheets');
    if (!container) return;
    container.innerHTML = '';

    const paths = BUILDING_PALETTE[cat] || [];
    for (const path of paths) {
        const block = document.createElement('div');
        block.style.cssText = 'margin-bottom:10px';
        const label = document.createElement('div');
        label.style.cssText = 'font-size:10px;color:#8b949e;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        label.textContent = path.split('/').pop().replace(/\.[^.]+$/, '');
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;overflow:hidden;border:1px solid #21262d;border-radius:3px;cursor:crosshair';
        const pcvs = document.createElement('canvas');
        pcvs.style.cssText = 'display:block;image-rendering:pixelated';
        wrap.appendChild(pcvs);
        block.appendChild(label);
        block.appendChild(wrap);
        container.appendChild(block);

        _loadImg(path).then(img => {
            if (!img) { label.textContent += ' ⚠'; return; }
            const cols = Math.floor(img.width / TILE);
            const rows = Math.floor(img.height / TILE);
            const dw = img.width * PAL_ZOOM, dh = img.height * PAL_ZOOM;
            pcvs.width = dw; pcvs.height = dh;
            const pctx = pcvs.getContext('2d');
            pctx.imageSmoothingEnabled = false;
            pctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, dw, dh);
            // Grid
            pctx.strokeStyle = 'rgba(255,255,255,0.18)';
            pctx.lineWidth = 0.5;
            for (let c = 0; c <= cols; c++) { pctx.beginPath(); pctx.moveTo(c * TILE * PAL_ZOOM, 0); pctx.lineTo(c * TILE * PAL_ZOOM, dh); pctx.stroke(); }
            for (let rr = 0; rr <= rows; rr++) { pctx.beginPath(); pctx.moveTo(0, rr * TILE * PAL_ZOOM); pctx.lineTo(dw, rr * TILE * PAL_ZOOM); pctx.stroke(); }

            pcvs.addEventListener('click', (e) => {
                const rect = pcvs.getBoundingClientRect();
                const col = Math.floor((e.clientX - rect.left) / PAL_ZOOM / TILE);
                const row = Math.floor((e.clientY - rect.top) / PAL_ZOOM / TILE);
                _activeStamp = { sheetPath: path, sx: col * TILE, sy: row * TILE };
                _activeBrush = null;
                _setTool('paint');
                _buildBrushList();
                _updateStampPreview();
                _updateCostEditor();
            });
        });
    }
}

function _updateTotalCost() {
    const el = _overlay && _overlay.querySelector('#bc-total-cost');
    if (!el) return;

    let totalGold = 0;
    const totalRes = {};
    let tileCount = 0;

    for (const [key, entry] of Object.entries(_brushGroupMap)) {
        const cost = getBrushCost(entry.brushId);
        totalGold += cost.gold;
        for (const [itemId, qty] of Object.entries(cost.resources)) {
            totalRes[itemId] = (totalRes[itemId] || 0) + qty;
        }
        tileCount++;
    }

    // Count non-brush tiles
    for (const lyrName of ['floor', 'walls', 'roof', 'overlay']) {
        for (const key of Object.keys(_layers[lyrName])) {
            if (!_brushGroupMap[key]) {
                totalGold += 3; // basic stamp cost
                tileCount++;
            }
        }
    }

    const parts = [`<b>${tileCount}</b> tiles placed`];
    if (totalGold > 0) parts.push(`💰 <b>${totalGold}</b> gold`);
    for (const [itemId, qty] of Object.entries(totalRes)) {
        parts.push(`${qty} ${itemId.replace(/_/g, ' ')}`);
    }
    el.innerHTML = parts.join('<br>');
}

// ═══════════════════════════════════════════════════════════
//  PHASE 1 → PHASE 2 TRANSITION
// ═══════════════════════════════════════════════════════════

function _finishExteriorPhase() {
    // Collect exterior tiles
    let hasTiles = false;
    for (const lyrName of ['floor', 'walls', 'roof', 'overlay']) {
        if (Object.keys(_layers[lyrName]).length > 0) { hasTiles = true; break; }
    }
    if (!hasTiles) {
        _showToast('Place some tiles for the exterior first!', 'err');
        return;
    }

    // Save building name
    _buildingName = (_overlay.querySelector('#bc-name').value || '').trim() || 'Custom Building';

    // Build the exterior definition (same format as _finishBuilding)
    const extLayers = { floor: [], walls: [], roof: [], overlay: [] };
    let minQ = Infinity, minR = Infinity, maxQ = -Infinity, maxR = -Infinity;
    for (const lyrName of ['floor', 'walls', 'roof', 'overlay']) {
        for (const [key, cell] of Object.entries(_layers[lyrName])) {
            const [q, r] = key.split(',').map(Number);
            extLayers[lyrName].push({ q, r, sheetPath: cell.sheetPath, sx: cell.sx, sy: cell.sy, sw: cell.sw || TILE, sh: cell.sh || TILE });
            if (q < minQ) minQ = q; if (q > maxQ) maxQ = q;
            if (r < minR) minR = r; if (r > maxR) maxR = r;
        }
    }
    const extMeta = [];
    for (const [key, m] of Object.entries(_meta)) {
        const [q, r] = key.split(',').map(Number);
        extMeta.push({ q, r, impassable: !!m.impassable, door: !!m.door });
    }

    _exteriorDef = {
        name: _buildingName,
        gridW: _gridW,
        gridH: _gridH,
        layers: extLayers,
        meta: extMeta,
        brushGroupMap: JSON.parse(JSON.stringify(_brushGroupMap)),
        bounds: { minCol: minQ, minRow: minR, maxCol: maxQ, maxRow: maxR },
        width: maxQ - minQ + 1,
        height: maxR - minR + 1,
    };

    // ── Transition to Phase 2: Interior ──
    _phase = 'interior';
    // Keep the same grid dimensions
    const intW = _gridW;
    const intH = _gridH;

    // Reset layers/meta for interior
    _layers = { floor: {}, walls: {}, roof: {}, overlay: {} };
    _meta = {};
    _brushGroupMap = {};
    _activeLayer = 'floor';
    _activeTool = 'paint';
    _activeBrush = null;
    _activeStamp = null;

    // Pre-populate outer walls from exterior
    // Scan the exterior's wall layer to find edge/boundary tiles
    _prePlaceOuterWalls(intW, intH);

    // Rebuild the UI for Phase 2
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _cvs = null; _ctx = null;
    _buildUI();

    _showToast('Exterior saved! Now design the interior. Outer walls are pre-placed.', 'ok');
}

/**
 * Pre-place outer walls from the exterior design onto the interior grid.
 * Uses the wall tiles from the exterior's perimeter as impassable boundary walls.
 */
function _prePlaceOuterWalls(w, h) {
    if (!_exteriorDef) return;

    // Collect all wall positions from the exterior's brushGroupMap
    const extWallPositions = new Set();
    for (const [key, entry] of Object.entries(_exteriorDef.brushGroupMap)) {
        if (entry.layer === 'walls') extWallPositions.add(key);
    }

    // Also check exterior meta for impassable tiles
    for (const m of _exteriorDef.meta) {
        if (m.impassable) extWallPositions.add(`${m.q},${m.r}`);
    }

    // If the exterior has wall brush group entries, copy them directly.
    // These become the immutable outer walls of the interior.
    if (extWallPositions.size > 0) {
        // Copy wall tiles from exterior layers
        for (const key of extWallPositions) {
            // Copy from exterior wall layer
            const extWallCell = _exteriorDef.layers.walls.find(c => `${c.q},${c.r}` === key);
            if (extWallCell) {
                _layers.walls[key] = {
                    sheetPath: extWallCell.sheetPath,
                    sx: extWallCell.sx, sy: extWallCell.sy,
                    sw: extWallCell.sw || TILE, sh: extWallCell.sh || TILE,
                };
            }
            // Mark as impassable
            _meta[key] = { impassable: true, _exteriorWall: true };
        }
    } else {
        // No explicit wall brush used — generate perimeter walls
        // Place basic impassable markers around the border
        for (let q = 0; q < w; q++) {
            for (let r = 0; r < h; r++) {
                if (q === 0 || q === w - 1 || r === 0 || r === h - 1) {
                    const key = `${q},${r}`;
                    _meta[key] = { impassable: true, _exteriorWall: true };
                }
            }
        }
    }

    // Copy floor tiles from exterior as the base interior floor
    for (const cell of _exteriorDef.layers.floor) {
        const key = `${cell.q},${cell.r}`;
        // Don't overwrite walls
        if (!_meta[key] || !_meta[key]._exteriorWall) {
            _layers.floor[key] = {
                sheetPath: cell.sheetPath,
                sx: cell.sx, sy: cell.sy,
                sw: cell.sw || TILE, sh: cell.sh || TILE,
            };
        }
    }
}

// ═══════════════════════════════════════════════════════════
//  FINISH BUILDING (Phase 2 → Register & Place)
// ═══════════════════════════════════════════════════════════

function _finishBuilding() {
    // Collect interior tiles
    const intLayers = { floor: [], walls: [], overlay: [] };
    let hasTiles = false;

    for (const lyrName of ['floor', 'walls', 'overlay']) {
        for (const [key, cell] of Object.entries(_layers[lyrName])) {
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
    for (const [key, m] of Object.entries(_meta)) {
        const [q, r] = key.split(',').map(Number);
        intMeta.push({ q, r, impassable: !!m.impassable, door: !!m.door });
    }

    const name = (_overlay.querySelector('#bc-name').value || '').trim() || _buildingName || 'Custom Building';
    const buildingId = 'player_building_' + Date.now();

    // ── Register exterior building ──
    // Use the saved exterior def from Phase 1
    const extDef = _exteriorDef;
    const extLayers = extDef ? extDef.layers : { floor: [], walls: [], roof: [], overlay: [] };
    const extMeta = extDef ? extDef.meta : [];
    const extBounds = extDef ? extDef.bounds : { minCol: 0, minRow: 0, maxCol: _gridW - 1, maxRow: _gridH - 1 };

    const buildingDef = {
        id: buildingId,
        name: name,
        buildingType: 'house',
        tags: ['player_built'],
        tileW: TILE,
        tileH: TILE,
        width: extDef ? extDef.width : _gridW,
        height: extDef ? extDef.height : _gridH,
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
            width: _gridW,
            height: _gridH,
            layers: intLayers,
            meta: intMeta,
            bounds: { minCol: 0, minRow: 0, maxCol: _gridW - 1, maxRow: _gridH - 1 },
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

    if (_game && _game.ui) {
        _game.ui.showNotification('🏗️ Building Complete',
            `"${name}" has been placed! (${buildingDef.width}×${buildingDef.height} tiles)`, 'success');
        _game.ui.updateStats(_game.player, _game.world);
    }

    close();
}

function _placeOnInnerMap(def) {
    // Place at the anchor position on the inner map
    const aq = _anchorQ;
    const ar = _anchorR;

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

// ═══════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════

/**
 * Open the building creator overlay.
 * @param {Object} game - Game instance
 * @param {number} anchorQ - Inner map tile Q
 * @param {number} anchorR - Inner map tile R
 */
function open(game, anchorQ, anchorR) {
    if (_isOpen) return;
    _isOpen = true;
    _game = game;
    _anchorQ = anchorQ;
    _anchorR = anchorR;
    _gridW = 8;
    _gridH = 8;
    _layers = { floor: {}, walls: {}, roof: {}, overlay: {} };
    _meta = {};
    _brushGroupMap = {};
    _activeLayer = 'floor';
    _activeTool = 'paint';
    _activeBrush = null;
    _activeStamp = null;
    _buildingName = '';
    _phase = 'exterior';
    _exteriorDef = null;

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

/**
 * Close the building creator overlay.
 */
function close() {
    _isOpen = false;
    if (_overlay) {
        _overlay.remove();
        _overlay = null;
    }
    _cvs = null;
    _ctx = null;
    _game = null;
}

/**
 * Check if the building creator is currently open.
 */
function isOpen() {
    return _isOpen;
}

export const BuildingCreator = {
    open,
    close,
    isOpen,
    setBrushCost,
    getBrushCost,
};

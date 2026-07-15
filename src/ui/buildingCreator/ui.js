// buildingCreator — ui functions.
import { CustomInteriors } from '../../world/customInteriors.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';
import { TILE, CANVAS_ZOOM, PAL_ZOOM, bcState, _brushCosts, _imgCache, BUILDING_PALETTE, DEFAULT_COSTS, FALLBACK_RESOURCE_DEFS } from './shared.js';
import { _prettyResourceId, _getTerrainResourceDefs, _getResourceDefs, _getResourceDef, _loadImg, setBrushCost, getBrushCost, _getAllBrushes, _canAfford, _deductCost, _formatCost } from './resources.js';
import { _recomputeNineTile, _brushPaint, _brushErase, _metaToggle, _stampPaint, _renderCanvas } from './paint.js';
import { _finishExteriorPhase, _prePlaceOuterWalls, _finishBuilding, _placeOnInnerMap, open, close, isOpen } from './build.js';

export function _showToast(msg, type) {
    const toast = bcState._overlay && bcState._overlay.querySelector('#bc-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'bc-toast ' + (type || '');
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 2200);
}

export function _updateResourceDisplay() {
    const el = bcState._overlay && bcState._overlay.querySelector('#bc-resources');
    if (!el || !bcState._game || !bcState._game.player) return;
    const p = bcState._game.player;
    const items = [];
    items.push(`💰 ${p.gold}g`);
    const invEntries = Object.entries(p.inventory || {}).filter(([, qty]) => qty > 0);
    for (const [itemId, qty] of invEntries.slice(0, 5)) {
        const def = _getResourceDef(itemId);
        items.push(`${def.icon} ${qty} ${def.name}`);
    }
    el.textContent = items.join('  ·  ');
}

export function _buildUI() {
    // Root overlay
    bcState._overlay = document.createElement('div');
    bcState._overlay.id = 'buildingCreatorOverlay';
    bcState._overlay.style.cssText = `
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
        <span id="bc-phase-badge" style="font-size:10px;padding:2px 8px;border-radius:4px;text-transform:uppercase;font-weight:600;background:#0b2a4a;color:#58a6ff;border:1px solid #58a6ff">${bcState._phase === 'exterior' ? 'Phase 1: Exterior' : 'Phase 2: Interior'}</span>
        <div style="width:1px;height:22px;background:#30363d;margin:0 4px"></div>
        <label style="font-size:11px;color:#8b949e">Name:</label>
        <input type="text" id="bc-name" value="${bcState._buildingName || ''}" placeholder="My Building" style="width:140px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:3px 7px;border-radius:4px;font-size:12px">
        <div style="width:1px;height:22px;background:#30363d;margin:0 4px"></div>
        <label style="font-size:11px;color:#8b949e">W:</label>
        <input type="number" id="bc-grid-w" value="${bcState._gridW}" min="3" max="20" style="width:42px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:3px 5px;border-radius:4px;font-size:12px" ${bcState._phase === 'interior' ? 'disabled' : ''}>
        <label style="font-size:11px;color:#8b949e">H:</label>
        <input type="number" id="bc-grid-h" value="${bcState._gridH}" min="3" max="20" style="width:42px;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:3px 5px;border-radius:4px;font-size:12px" ${bcState._phase === 'interior' ? 'disabled' : ''}>
        <button id="bc-resize-btn" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:3px 9px;border-radius:5px;cursor:pointer;font-size:12px" ${bcState._phase === 'interior' ? 'disabled' : ''}>Resize</button>
        <div style="width:1px;height:22px;background:#30363d;margin:0 4px"></div>
        <div id="bc-tool-btns" style="display:flex;gap:3px"></div>
        <div style="width:1px;height:22px;background:#30363d;margin:0 4px"></div>
        <div id="bc-resources" style="font-size:11px;color:#8b949e;flex:1"></div>
        ${bcState._phase === 'exterior'
            ? '<button id="bc-finish-btn" style="background:#0b2a4a;border:1px solid #58a6ff;color:#58a6ff;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600">▶ Finish Exterior → Interior</button>'
            : '<button id="bc-finish-btn" style="background:#0e2a17;border:1px solid #3fb950;color:#3fb950;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600">✅ Finish & Place</button>'
        }
        <button id="bc-cancel-btn" style="background:#2a0d0d;border:1px solid #f85149;color:#f85149;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:12px">Cancel</button>
    `;
    bcState._overlay.appendChild(toolbar);

    // ── Main 3-column layout ──
    const main = document.createElement('div');
    main.style.cssText = 'display:flex;flex:1;overflow:hidden;min-height:0';

    // LEFT: Brush palette
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = `
        width: 280px; min-width: 160px; max-width: 600px; flex-shrink: 0;
        background: #161b22; border-right: 1px solid #21262d; display: flex;
        flex-direction: column; overflow: hidden; position: relative;
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
        <div id="bc-pal-sheets" style="flex:1;overflow-y:auto;overflow-x:auto;padding:6px"></div>
        <div id="bc-left-resize" style="position:absolute;right:0;top:0;width:5px;height:100%;cursor:col-resize;z-index:10;background:transparent"></div>
    `;
    main.appendChild(leftPanel);

    // Drag-to-resize the left panel
    const leftResizeHandle = leftPanel.querySelector('#bc-left-resize');
    leftResizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = leftPanel.offsetWidth;
        const onMove = (ev) => {
            const newWidth = Math.max(160, Math.min(600, startWidth + (ev.clientX - startX)));
            leftPanel.style.width = newWidth + 'px';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            leftResizeHandle.style.background = 'transparent';
        };
        leftResizeHandle.style.background = 'rgba(88,166,255,0.25)';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
    leftResizeHandle.addEventListener('mouseenter', () => { leftResizeHandle.style.background = 'rgba(88,166,255,0.15)'; });
    leftResizeHandle.addEventListener('mouseleave', () => { leftResizeHandle.style.background = 'transparent'; });

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

    bcState._overlay.appendChild(main);

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
    bcState._overlay.appendChild(toast);

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
    bcState._overlay.appendChild(style);

    document.body.appendChild(bcState._overlay);

    // ── Wire up events ──
    bcState._cvs = bcState._overlay.querySelector('#bc-canvas');
    bcState._ctx = bcState._cvs.getContext('2d');

    // Toolbar buttons
    bcState._overlay.querySelector('#bc-cancel-btn').addEventListener('click', () => close());
    bcState._overlay.querySelector('#bc-finish-btn').addEventListener('click', () => {
        if (bcState._phase === 'exterior') {
            _finishExteriorPhase();
        } else {
            _finishBuilding();
        }
    });
    const resizeBtn = bcState._overlay.querySelector('#bc-resize-btn');
    if (resizeBtn && !resizeBtn.disabled) {
        resizeBtn.addEventListener('click', () => {
            bcState._gridW = Math.max(3, Math.min(20, parseInt(bcState._overlay.querySelector('#bc-grid-w').value) || 8));
            bcState._gridH = Math.max(3, Math.min(20, parseInt(bcState._overlay.querySelector('#bc-grid-h').value) || 8));
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
    bcState._cvs.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        drawing = true;
        _handleCanvasClick(e);
    });
    bcState._cvs.addEventListener('mousemove', (e) => {
        if (!drawing) return;
        _handleCanvasClick(e);
    });
    window.addEventListener('mouseup', () => { drawing = false; });

    // Keyboard shortcuts
    bcState._overlay.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        if (e.key === 'Escape') { close(); e.preventDefault(); }
        if (e.key === 'p' || e.key === 'P') _setTool('paint');
        if (e.key === 'e' || e.key === 'E') _setTool('erase');
        if (e.key === 'b' || e.key === 'B') _setTool('block');
        if (e.key === 'd' || e.key === 'D') _setTool('door');
    });
    bcState._overlay.tabIndex = 0;
    bcState._overlay.focus();

    _renderCanvas();
}

export function _handleCanvasClick(e) {
    const rect = bcState._cvs.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const q = Math.floor((mx - bcState._panX) / (TILE * CANVAS_ZOOM));
    const r = Math.floor((my - bcState._panY) / (TILE * CANVAS_ZOOM));
    if (q < 0 || q >= bcState._gridW || r < 0 || r >= bcState._gridH) return;

    if (bcState._activeTool === 'paint') {
        if (bcState._activeBrush !== null) {
            _brushPaint(q, r);
        } else if (bcState._activeStamp) {
            _stampPaint(q, r);
        }
    } else if (bcState._activeTool === 'erase') {
        _brushErase(q, r);
    } else if (bcState._activeTool === 'block') {
        _metaToggle(q, r, 'block');
    } else if (bcState._activeTool === 'door') {
        _metaToggle(q, r, 'door');
    }

    _renderCanvas();
    if (bcState._game && bcState._game.ui) bcState._game.ui.updateStats(bcState._game.player, bcState._game.world);
}

export function _buildToolButtons() {
    const container = bcState._overlay.querySelector('#bc-tool-btns');
    if (!container) return;
    const tools = [
        { id: 'paint', label: '🖌 Paint',  key: 'P' },
        { id: 'erase', label: '🗑 Erase',  key: 'E' },
        { id: 'block', label: '🚧 Block',  key: 'B' },
        { id: 'door',  label: '🚪 Door',   key: 'D' },
    ];
    container.innerHTML = '';
    for (const t of tools) {
        const btn = document.createElement('button');
        btn.className = 'bc-tool-btn' + (bcState._activeTool === t.id ? ' active' : '');
        btn.textContent = t.label;
        btn.title = `${t.label} (${t.key})`;
        btn.addEventListener('click', () => _setTool(t.id));
        container.appendChild(btn);
    }
}

export function _setTool(tool) {
    bcState._activeTool = tool;
    _buildToolButtons();
}

export function _buildLayerButtons() {
    const container = bcState._overlay.querySelector('#bc-layer-bar');
    if (!container) return;
    const layerNames = ['floor', 'walls', 'roof', 'overlay'];
    const layerIcons = { floor: '🟫', walls: '🧱', roof: '🏠', overlay: '✨' };
    container.innerHTML = '';
    for (const ln of layerNames) {
        const btn = document.createElement('button');
        btn.className = 'bc-layer-btn' + (bcState._activeLayer === ln ? ' active' : '');
        btn.textContent = `${layerIcons[ln] || ''} ${ln.charAt(0).toUpperCase() + ln.slice(1)}`;
        btn.addEventListener('click', () => {
            bcState._activeLayer = ln;
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
        bcState._layers[bcState._activeLayer] = {};
        // Remove brush group entries for this layer
        for (const [key, entry] of Object.entries(bcState._brushGroupMap)) {
            if (entry.layer === bcState._activeLayer) {
                delete bcState._brushGroupMap[key];
                delete bcState._meta[key];
            }
        }
        _renderCanvas();
    });
    container.appendChild(clearBtn);
}

export function _buildBrushList() {
    const container = bcState._overlay.querySelector('#bc-brush-list');
    if (!container) return;
    const brushes = _getAllBrushes();
    container.innerHTML = '';

    if (brushes.length === 0) {
        container.innerHTML = '<div style="font-size:11px;color:#8b949e;padding:4px 0">No brushes available. Create brushes in the Interior Editor first.</div>';
        return;
    }

    brushes.forEach((brush, i) => {
        const card = document.createElement('div');
        card.className = 'bc-brush-card' + (bcState._activeBrush === i ? ' selected' : '');
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

export function _selectBrush(idx) {
    bcState._activeBrush = (bcState._activeBrush === idx) ? null : idx;
    bcState._activeStamp = null;
    if (bcState._activeBrush !== null) {
        const brush = _getAllBrushes()[bcState._activeBrush];
        if (brush) {
            bcState._activeLayer = brush.brushType === 'wall' ? 'walls' : 'floor';
            _buildLayerButtons();
        }
        _setTool('paint');
    }
    _buildBrushList();
    _updateCostEditor();
    _updateStampPreview();
}

export function _updateCostEditor() {
    const container = bcState._overlay.querySelector('#bc-cost-editor');
    if (!container) return;

    if (bcState._activeBrush === null) {
        container.innerHTML = '<div style="color:#8b949e">Select a brush to edit its cost per tile</div>';
        return;
    }

    const brushes = _getAllBrushes();
    const brush = brushes[bcState._activeBrush];
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
    const resourceDefs = _getResourceDefs().sort((a, b) => a.name.localeCompare(b.name));

    function _renderResources() {
        resContainer.innerHTML = '';
        for (const [itemId, qty] of Object.entries(cost.resources)) {
            const rowOptions = [...resourceDefs];
            if (itemId && !rowOptions.some(r => r.id === itemId)) {
                rowOptions.push(_getResourceDef(itemId));
            }
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px';
            row.innerHTML = `
                <select style="flex:1;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:2px 4px;border-radius:3px;font-size:11px">
                    ${rowOptions.map(r => `<option value="${r.id}" ${r.id === itemId ? 'selected' : ''}>${r.icon || '📦'} ${r.name || _prettyResourceId(r.id)}</option>`).join('')}
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
        const unused = resourceDefs.find(r => !(r.id in cost.resources));
        if (unused && unused.id) {
            cost.resources[unused.id] = 1;
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

export function _updateStampPreview() {
    const el = bcState._overlay && bcState._overlay.querySelector('#bc-stamp-preview');
    if (!el) return;
    if (!bcState._activeStamp && bcState._activeBrush === null) {
        el.innerHTML = '<span style="color:#8b949e;font-size:11px">No tile selected</span>';
        return;
    }
    if (bcState._activeBrush !== null) {
        const brushes = _getAllBrushes();
        const brush = brushes[bcState._activeBrush];
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
    if (bcState._activeStamp) {
        const pc = document.createElement('canvas');
        pc.width = TILE; pc.height = TILE;
        pc.style.cssText = 'image-rendering:pixelated';
        const pctx = pc.getContext('2d');
        pctx.imageSmoothingEnabled = false;
        _loadImg(bcState._activeStamp.sheetPath).then(img => {
            if (img) pctx.drawImage(img, bcState._activeStamp.sx, bcState._activeStamp.sy, TILE, TILE, 0, 0, TILE, TILE);
            el.innerHTML = '';
            el.appendChild(pc);
        });
    }
}

export function _buildPaletteCats() {
    const container = bcState._overlay.querySelector('#bc-pal-cats');
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

export function _showPaletteCategory(cat, btn) {
    bcState._overlay.querySelectorAll('.bc-cat-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const container = bcState._overlay.querySelector('#bc-pal-sheets');
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
                bcState._activeStamp = { sheetPath: path, sx: col * TILE, sy: row * TILE };
                bcState._activeBrush = null;
                _setTool('paint');
                _buildBrushList();
                _updateStampPreview();
                _updateCostEditor();
            });
        });
    }
}

export function _updateTotalCost() {
    const el = bcState._overlay && bcState._overlay.querySelector('#bc-total-cost');
    if (!el) return;

    let totalGold = 0;
    const totalRes = {};
    let tileCount = 0;

    for (const [key, entry] of Object.entries(bcState._brushGroupMap)) {
        const cost = getBrushCost(entry.brushId);
        totalGold += cost.gold;
        for (const [itemId, qty] of Object.entries(cost.resources)) {
            totalRes[itemId] = (totalRes[itemId] || 0) + qty;
        }
        tileCount++;
    }

    // Count non-brush tiles
    for (const lyrName of ['floor', 'walls', 'roof', 'overlay']) {
        for (const key of Object.keys(bcState._layers[lyrName])) {
            if (!bcState._brushGroupMap[key]) {
                totalGold += 3; // basic stamp cost
                tileCount++;
            }
        }
    }

    const parts = [`<b>${tileCount}</b> tiles placed`];
    if (totalGold > 0) parts.push(`💰 <b>${totalGold}</b> gold`);
    for (const [itemId, qty] of Object.entries(totalRes)) {
        const def = _getResourceDef(itemId);
        parts.push(`${qty} ${def.icon} ${def.name}`);
    }
    el.innerHTML = parts.join('<br>');
}

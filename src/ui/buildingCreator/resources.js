// buildingCreator — resources functions.
import { CustomInteriors } from '../../world/customInteriors.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';
import { TILE, CANVAS_ZOOM, PAL_ZOOM, bcState, _brushCosts, _imgCache, BUILDING_PALETTE, DEFAULT_COSTS, FALLBACK_RESOURCE_DEFS } from './shared.js';
import { _recomputeNineTile, _brushPaint, _brushErase, _metaToggle, _stampPaint, _renderCanvas } from './paint.js';
import { _showToast, _updateResourceDisplay, _buildUI, _handleCanvasClick, _buildToolButtons, _setTool, _buildLayerButtons, _buildBrushList, _selectBrush, _updateCostEditor, _updateStampPreview, _buildPaletteCats, _showPaletteCategory, _updateTotalCost } from './ui.js';
import { _finishExteriorPhase, _prePlaceOuterWalls, _finishBuilding, _placeOnInnerMap, open, close, isOpen } from './build.js';

export function _prettyResourceId(itemId) {
    return String(itemId || '').trim().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown Resource';
}

export function _getTerrainResourceDefs() {
    const resources = DataLoader?.get?.('terrain.json')?.resources;
    if (!resources || typeof resources !== 'object') return [];
    return Object.entries(resources)
        .map(([key, r]) => {
            const id = String((r && r.id) || key || '').trim().toLowerCase();
            if (!id) return null;
            return {
                id,
                name: String((r && r.name) || id).trim() || _prettyResourceId(id),
                icon: String((r && r.icon) || '📦'),
                color: String((r && r.color) || '#888888'),
            };
        })
        .filter(Boolean);
}

export function _getResourceDefs() {
    const byId = new Map();
    for (const def of FALLBACK_RESOURCE_DEFS) byId.set(def.id, def);
    for (const def of _getTerrainResourceDefs()) byId.set(def.id, def);
    return [...byId.values()];
}

export function _getResourceDef(itemId) {
    const id = String(itemId || '').trim().toLowerCase();
    if (!id) return { id: '', name: 'Unknown Resource', icon: '📦', color: '#888888' };
    const found = _getResourceDefs().find(r => r.id === id);
    if (found) return found;
    return { id, name: _prettyResourceId(id), icon: '📦', color: '#888888' };
}

export function _loadImg(path) {
    if (_imgCache[path] instanceof HTMLImageElement) return Promise.resolve(_imgCache[path]);
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => { _imgCache[path] = img; resolve(img); };
        img.onerror = () => { _imgCache[path] = null; resolve(null); };
        img.src = path;
    });
}

export function setBrushCost(brushId, cost) {
    _brushCosts.set(brushId, {
        gold: cost.gold || 0,
        resources: cost.resources || {},
    });
}

export function getBrushCost(brushId) {
    if (_brushCosts.has(brushId)) return _brushCosts.get(brushId);
    const brush = _getAllBrushes().find(b => b.id === brushId);
    if (brush && brush.cost && (brush.cost.gold > 0 || Object.keys(brush.cost.resources || {}).length > 0)) {
        return { gold: brush.cost.gold || 0, resources: brush.cost.resources || {} };
    }
    const type = brush ? brush.brushType : 'floor';
    return DEFAULT_COSTS[type] || DEFAULT_COSTS.floor;
}

export function _getAllBrushes() {
    if (typeof CustomInteriors !== 'undefined' && CustomInteriors.getBrushes) {
        return CustomInteriors.getBrushes();
    }
    return [];
}

export function _canAfford(player, brushId) {
    const cost = getBrushCost(brushId);
    if (cost.gold > 0 && player.gold < cost.gold) return false;
    for (const [itemId, qty] of Object.entries(cost.resources)) {
        if ((player.inventory[itemId] || 0) < qty) return false;
    }
    return true;
}

export function _deductCost(player, brushId) {
    const cost = getBrushCost(brushId);
    player.gold -= cost.gold;
    for (const [itemId, qty] of Object.entries(cost.resources)) {
        player.inventory[itemId] = (player.inventory[itemId] || 0) - qty;
        if (player.inventory[itemId] <= 0) delete player.inventory[itemId];
    }
}

export function _formatCost(cost) {
    const parts = [];
    if (cost.gold > 0) parts.push(`${cost.gold}g`);
    for (const [itemId, qty] of Object.entries(cost.resources || {})) {
        const def = _getResourceDef(itemId);
        parts.push(`${qty} ${def.icon} ${def.name}`);
    }
    return parts.join(', ') || 'Free';
}

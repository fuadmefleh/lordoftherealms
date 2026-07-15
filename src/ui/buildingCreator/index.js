// BuildingCreator — assembled from ./buildingCreator/*.js
import { CustomInteriors } from '../../world/customInteriors.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';
import { TILE, CANVAS_ZOOM, PAL_ZOOM, bcState, _brushCosts, _imgCache, BUILDING_PALETTE, DEFAULT_COSTS, FALLBACK_RESOURCE_DEFS } from './shared.js';
import { _prettyResourceId, _getTerrainResourceDefs, _getResourceDefs, _getResourceDef, _loadImg, setBrushCost, getBrushCost, _getAllBrushes, _canAfford, _deductCost, _formatCost } from './resources.js';
import { _recomputeNineTile, _brushPaint, _brushErase, _metaToggle, _stampPaint, _renderCanvas } from './paint.js';
import { _showToast, _updateResourceDisplay, _buildUI, _handleCanvasClick, _buildToolButtons, _setTool, _buildLayerButtons, _buildBrushList, _selectBrush, _updateCostEditor, _updateStampPreview, _buildPaletteCats, _showPaletteCategory, _updateTotalCost } from './ui.js';
import { _finishExteriorPhase, _prePlaceOuterWalls, _finishBuilding, _placeOnInnerMap, open, close, isOpen } from './build.js';

export const BuildingCreator = {
    open,
    close,
    isOpen,
    setBrushCost,
    getBrushCost,
};

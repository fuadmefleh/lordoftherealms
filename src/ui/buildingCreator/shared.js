// buildingCreator shared state + data (mutable bcState object + tables).
import { CustomInteriors } from '../../world/customInteriors.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { InnerMap } from '../../world/innerMap.js';
import { DataLoader } from '../../core/dataLoader.js';

export const TILE = 32;

export const CANVAS_ZOOM = 2;

export const PAL_ZOOM = 2;

export const bcState = {
    _overlay: null,
    _game: null,
    _anchorQ: 0,
    _anchorR: 0,
    _gridW: 8,
    _gridH: 8,
    _layers: { floor: {}, walls: {}, roof: {}, overlay: {} },
    _meta: {},
    _brushGroupMap: {},
    _activeLayer: 'floor',
    _activeTool: 'paint',
    _activeBrush: null,
    _activeStamp: null,
    _panX: 10,
    _panY: 10,
    _buildingName: '',
    _isOpen: false,
    _phase: 'exterior',
    _exteriorDef: null,
    _cvs: null,
    _ctx: null,
};

export const _brushCosts = new Map();

export const _imgCache = {};

export const BUILDING_PALETTE = {
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

export const DEFAULT_COSTS = {
    floor: { gold: 2, resources: { wood: 1 } },
    wall:  { gold: 5, resources: { stone: 1, wood: 1 } },
};

export const FALLBACK_RESOURCE_DEFS = [
    { id: 'wood', name: 'Wood', icon: '🌲', color: '#8b5a2b' },
    { id: 'timber', name: 'Timber', icon: '🌲', color: '#8b5a2b' },
    { id: 'stone', name: 'Stone', icon: '⛰️', color: '#808080' },
    { id: 'iron', name: 'Iron', icon: '⛏️', color: '#8a7a7a' },
];

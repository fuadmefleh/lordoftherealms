/**
 * Structural regression guard for the Renderer monolith split.
 * renderer.js (class Renderer, 40 methods) -> renderer/core.js (constructor) +
 * assets/world/features/overlays.js (methods Object.assign'd onto the prototype).
 */
import { describe, it, expect } from 'vitest';
import { Renderer } from '../ui/renderer.js';

const METHODS = [
    'loadAssets', 'resize', 'setWorld', 'setPlayer', 'loadTileSprite', 'getTileImage', 'getRiverImage',
    'getRoadImage', 'getBridgeImage', 'render', 'addLabel', 'labelsOverlap', 'getLabelBounds',
    'renderLabels', 'renderCaravans', 'getHexPixelPos', 'renderHexGrid', 'renderColoredHex',
    'renderSpriteHex', 'renderTerritoryBorders', 'renderSettlements', 'renderImprovements',
    'renderHolySitesAndCulture', 'renderInfrastructure', 'renderBuiltStructures', 'renderResources',
    'renderPath', 'renderReachableHexes', 'renderHexHighlight', 'renderPlayer', '_drawWorldPlumbob',
    '_drawWorldDeadPlumbob', 'getHexAtScreen', 'dimColor', 'renderRivers', 'renderUnits',
    'renderWeather', 'renderMapModeOverlay', 'renderTradeRoutes', 'getMapModeColor',
];

describe('Renderer split — structural equivalence', () => {
    it('all 40 methods live on Renderer.prototype', () => {
        const missing = METHODS.filter((m) => typeof Renderer.prototype[m] !== 'function');
        expect(missing).toEqual([]);
        expect(METHODS).toHaveLength(40);
    });

    it('constructs with a canvas + camera', () => {
        // Constructor binds a window resize listener; node stub lacks it.
        if (typeof window.addEventListener !== 'function') window.addEventListener = () => {};
        const canvas = { getContext: () => ({}), width: 800, height: 600 };
        const r = new Renderer(canvas, { x: 0, y: 0, zoom: 1 });
        expect(r.canvas).toBe(canvas);
        expect(typeof r.render).toBe('function');
    });
});

/**
 * Structural guard for the innerMapLayers.js split. The file was one big
 * Object.assign(InnerMapRenderer, {...}) of 25 render-layer methods; it is now
 * a side-effect barrel importing ./innerMapLayers/{terrainRoads,objectsBuildings,
 * entities}.js, each Object.assign'ing its share onto InnerMapRenderer.
 */
import { describe, it, expect } from 'vitest';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import '../ui/innerMapLayers.js'; // side-effect: mixes the layer methods in

const METHODS = [
    '_deathAnim', 'startDeathAnimation', 'clearDeathAnimation', '_getDeathAnimState',
    '_getVisibleTileRange', '_renderTerrainLayer', '_renderTerrainDetailLayer', '_renderInteriorTile',
    '_renderCustomInteriorTile', '_renderRoadLayer', '_renderObjectLayer', '_renderBuildingLayer',
    '_drawCustomBuilding', '_drawLPCBuilding', '_drawBuildingLabel', '_renderFogLayer',
    '_renderEncounterLayer', '_renderNPCLayer', '_renderPlayerLayer', '_drawPlumbob', '_drawDeadPlumbob',
    '_renderGroundOverlays', '_flattenObjLayers', '_getActiveObjectTiles', '_renderDepthSortedSprites',
];

describe('innerMapLayers split — structural equivalence', () => {
    it('all 25 members are mixed onto InnerMapRenderer', () => {
        const missing = METHODS.filter((m) => !(m in InnerMapRenderer));
        expect(missing).toEqual([]);
        expect(METHODS).toHaveLength(25);
    });

    it('the render-layer methods are functions (_deathAnim is a state field)', () => {
        for (const m of ['_renderTerrainLayer', '_renderNPCLayer', '_renderPlayerLayer', 'startDeathAnimation']) {
            expect(typeof InnerMapRenderer[m], m).toBe('function');
        }
    });
});

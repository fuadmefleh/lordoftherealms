/**
 * The street map's kept drawings (ui/innerMapLayers/groundCache.js, and the
 * building canvases in objectsBuildings.js): what a ground chunk watches to know
 * it must be drawn again, and that without a real canvas (the node runner, a
 * recording stub) both fall back to drawing directly, exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import '../ui/innerMapLayers.js';
import { InnerMap } from '../world/innerMap.js';
import { BuildingWear } from '../ui/buildingWear.js';

function grid(w, h) {
    const tiles = [];
    for (let r = 0; r < h; r++) {
        const row = [];
        for (let q = 0; q < w; q++) row.push({ q, r, explored: true, visible: true, baseTerrain: 'grass', subTerrain: { id: 'grass' } });
        tiles.push(row);
    }
    return tiles;
}

describe('ground chunk change check', () => {
    it('reports a first look, then nothing till a cell it reads changes', () => {
        const saved = InnerMap.tiles;
        InnerMap.tiles = grid(30, 30);
        try {
            const sig = [];
            const R = InnerMapRenderer;
            expect(R._groundChunkChanged(sig, 8, 8, 6, 30, 30)).toBe(true);
            expect(R._groundChunkChanged(sig, 8, 8, 6, 30, 30)).toBe(false);
            // a cell inside it paved
            InnerMap.tiles[10][10].paving = { sheetPath: 'x.png', sx: 0, sy: 0 };
            expect(R._groundChunkChanged(sig, 8, 8, 6, 30, 30)).toBe(true);
            expect(R._groundChunkChanged(sig, 8, 8, 6, 30, 30)).toBe(false);
            // a neighbour just past its edge (its kerbs and tufts spill in) turned to a lane
            InnerMap.tiles[8][7].isRoad = true;
            expect(R._groundChunkChanged(sig, 8, 8, 6, 30, 30)).toBe(true);
            // fog: a cell seen or lost from sight
            InnerMap.tiles[12][12].visible = false;
            expect(R._groundChunkChanged(sig, 8, 8, 6, 30, 30)).toBe(true);
            // a cell well away from it: nothing
            InnerMap.tiles[25][25].paving = { sheetPath: 'y.png' };
            expect(R._groundChunkChanged(sig, 8, 8, 6, 30, 30)).toBe(false);
            // the lazy terrain-fill cache filling in is not a change
            InnerMap.tiles[9][9]._cachedFill = { sx: 0, sy: 0 };
            expect(R._groundChunkChanged(sig, 8, 8, 6, 30, 30)).toBe(false);
        } finally {
            InnerMap.tiles = saved;
        }
    });
});

describe('without a real canvas the caches stand aside', () => {
    const stubCtx = () => {
        const calls = [];
        return new Proxy({ canvas: { width: 800, height: 600 }, calls }, {
            get(t, k) { return k in t ? t[k] : (...a) => { calls.push(k); return { addColorStop() {} }; }; },
        });
    };
    const camera = { zoom: 2, targetZoom: 2, worldToScreenFast: (x, y) => ({ x: x * 2, y: y * 2 }) };

    it('the ground draws directly', () => {
        expect(InnerMapRenderer._groundCacheUsable(stubCtx(), camera)).toBe(false);
    });

    it('a building draws directly', () => {
        const def = { id: 'd', layers: { floor: [], walls: [], roof: [], overlay: [] } };
        expect(InnerMapRenderer._buildingCacheUsable(stubCtx(), camera, def, null, null, 0, null)).toBe(false);
    });

    it('wear art: a plain building needs none loaded', () => {
        expect(BuildingWear.artReady(0, null)).toBe(true);
    });
});

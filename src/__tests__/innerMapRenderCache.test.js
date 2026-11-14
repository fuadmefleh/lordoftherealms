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

describe('a new zoom reuses the kept drawings', () => {
    // A recording 2D context and a building cache whose drawing is stubbed (no canvas in node)
    const rec = () => {
        const draws = [];
        return { draws, canvas: { width: 2000, height: 2000, pixelRatio: 1 }, imageSmoothingEnabled: false, drawImage(...a) { draws.push(a); } };
    };
    const cam = (zoom, targetZoom = zoom) => ({ zoom, targetZoom, worldToScreenFast: (x, y) => ({ x: x * zoom, y: y * zoom }) });
    const def = { id: 'zoomTest', layers: { floor: [], walls: [], roof: [], overlay: [] } };

    function withStub(fn) {
        const R = InnerMapRenderer;
        const saved = { draw: R._drawBuildingToCache, cache: R._buildingCache, prev: R._buildingCachePrev, t0: R._frameT0, frame: R._renderFrame };
        const built = [];
        R._drawBuildingToCache = (d, q, r, ds) => { built.push(ds); return { canvas: { width: ds * 3, height: ds * 4 }, ox: ds, oy: ds, used: 0 }; };
        R._buildingCache = null; R._buildingCachePrev = null; R._renderFrame = 1;
        try { fn(R, built); } finally {
            R._drawBuildingToCache = saved.draw; R._buildingCache = saved.cache; R._buildingCachePrev = saved.prev;
            R._frameT0 = saved.t0; R._renderFrame = saved.frame;
        }
    }

    it('while the zoom glides a building is its last drawing scaled, not drawn anew', () => {
        withStub((R, built) => {
            R._frameT0 = performance.now();
            const a = rec();
            expect(R._blitCachedBuilding(a, cam(2), def, 5, 5, 64, null, 0, null)).toBe(true);
            expect(built).toEqual([64]);
            // gliding toward 3: drawn at its old size, scaled to the frame's
            const b = rec();
            expect(R._blitCachedBuilding(b, cam(2.2, 3), def, 5, 5, 70.4, null, 0, null)).toBe(true);
            expect(built).toEqual([64]);
            expect(b.draws[0][3]).toBeCloseTo((64 * 3) * 70.4 / 64, 5);
        });
    });

    it('settled on a new size, the old drawing stands in while the frame has no time left to draw', () => {
        withStub((R, built) => {
            R._frameT0 = performance.now();
            R._blitCachedBuilding(rec(), cam(2), def, 5, 5, 64, null, 0, null);
            // the frame's budget spent: the old one, scaled
            R._frameT0 = performance.now() - 1000;
            const late = rec();
            expect(R._blitCachedBuilding(late, cam(3), def, 5, 5, 96, null, 0, null)).toBe(true);
            expect(built).toEqual([64]);
            expect(late.draws[0][3]).toBeCloseTo(64 * 3 * 1.5, 5);
            // the next frame has time: drawn at the new size, 1:1
            R._frameT0 = performance.now();
            const fresh = rec();
            R._blitCachedBuilding(fresh, cam(3), def, 5, 5, 96, null, 0, null);
            expect(built).toEqual([64, 96]);
            expect(fresh.draws[0][3]).toBe(96 * 3);
        });
    });

    it('ground chunks drawn at one zoom blit scaled at another', () => {
        const ctx = rec();
        const gc = { zoom: 2 };
        const ch = { q0: 4, r0: 4, canvas: { width: 300, height: 300 } };
        InnerMapRenderer._blitGround(ctx, cam(3), gc, [ch], 1);
        const [, x, y, w] = ctx.draws[0];
        expect(x).toBe(4 * 32 * 3);
        expect(y).toBe(4 * 32 * 3);
        expect(w).toBeCloseTo(450, 5);
    });
});

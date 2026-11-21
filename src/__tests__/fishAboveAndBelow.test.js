// The fish seen from above (ui/innerMapLayers/surfaceFish.js) and the diver's
// (underwaterFish.js) are one lot: a dive takes those about the diver under,
// just where they were and of the same kinds; coming up lays the diver's back
// on the surface; and below there are as many as are seen from above.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import '../ui/innerMapLayers.js';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { SurfaceFish } from '../ui/innerMapLayers/surfaceFish.js';
import { UnderwaterFish } from '../ui/innerMapLayers/underwaterFish.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const N = 40;
/** A lake, a sandy bank down its left side (q < 6); the player at (20, 20). */
function lake() {
    const tiles = [];
    for (let r = 0; r < N; r++) {
        tiles[r] = [];
        for (let q = 0; q < N; q++) {
            tiles[r][q] = q < 6
                ? { q, r, subTerrain: { id: 'sand', passable: true } }
                : { q, r, _wet: true, _deep: true, _waterKind: 'lake', subTerrain: { id: 'lake_water', passable: false } };
        }
    }
    InnerMap.tiles = tiles;
    InnerMap.width = InnerMap.height = N;
    InnerMap._insideBuilding = null;
    InnerMap._underwater = false;
    InnerMap.playerInnerQ = 20;
    InnerMap.playerInnerR = 20;
    InnerMap.season = 'Summer';
    InnerMap._waterStamp = 0;
    return tiles;
}

const RANGE = { qMin: 8, qMax: 32, rMin: 10, rMax: 30 };

beforeEach(() => {
    SurfaceFish._tiles = null;
    SurfaceFish.mask = null;
    SurfaceFish.fish = [];
    SurfaceFish.shoals = [];
    SurfaceFish.ripples = [];
    SurfaceFish.baits = [];
    SurfaceFish.fed = [];
    UnderwaterFish.fish = [];
    UnderwaterFish._dive = null;
});

describe('one lot of fish, above the water and below', () => {
    it('a dive takes the fish about you under, where they were; coming up brings the diver\'s back', () => {
        const tiles = lake();
        SurfaceFish.cells(tiles);
        const C = SurfaceFish.config();
        for (let t = 0; t < 3; t += 0.05) SurfaceFish.update(0.05, RANGE, null, C);
        const R = UnderwaterFish.config().radius;
        const near = SurfaceFish.fish.filter(f => f.alive && Math.hypot(f.x - 20.5, f.y - 20.5) <= R).map(f => ({ id: f.sp.id, x: f.x, y: f.y }));
        expect(near.length).toBeGreaterThan(0);

        // Under: each of them is there, the same kind at the same spot
        const dive = { tiles };
        UnderwaterFish.reset(dive, 3);
        for (const s of near) {
            expect(UnderwaterFish.fish.some(f => f.sp.id === s.id && Math.hypot(f.x - s.x, f.y - s.y) < 1e-6)).toBe(true);
        }
        // (gone from the surface meanwhile)
        expect(SurfaceFish.fish.filter(f => f.alive && Math.hypot(f.x - 20.5, f.y - 20.5) <= R).length).toBe(0);
        // as many below as the water holds from above
        expect(UnderwaterFish._target).toBe(SurfaceFish.countNear(20.5, 20.5, R, Math.min(UnderwaterFish.config().max, C.max)));

        // Swim a while, then up: the diver's fish are the surface's now
        for (let t = 0; t < 2; t += 0.05) UnderwaterFish.update(0.05);
        const below = UnderwaterFish.fish.filter(f => SurfaceFish.swimmable(f.x, f.y)).map(f => ({ id: f.sp.id, x: f.x, y: f.y }));
        expect(below.length).toBeGreaterThan(0);
        const outside = SurfaceFish.fish.filter(f => f.alive && Math.hypot(f.x - 20.5, f.y - 20.5) > R).length;
        const back = SurfaceFish.giveBack(UnderwaterFish.handBack(), 20.5, 20.5, R);
        // (as many as the surface keeps at once: surfaceFish.max)
        expect(back).toBe(Math.min(below.length, C.max - outside));
        for (const s of below.slice(0, back)) {
            expect(SurfaceFish.fish.some(f => f.alive && f.sp.id === s.id && Math.hypot(f.x - s.x, f.y - s.y) < 1e-6)).toBe(true);
        }
        expect(UnderwaterFish.fish.length).toBe(0);
        expect(UnderwaterFish._dive).toBe(null);
    });

    it('the surface takes them back itself on the first frame up', () => {
        const tiles = lake();
        SurfaceFish.cells(tiles);
        UnderwaterFish.reset({ tiles }, 5);
        const n = UnderwaterFish.fish.filter(f => SurfaceFish.swimmable(f.x, f.y)).length;
        expect(n).toBeGreaterThan(0);
        // (the frame after a dive ends: no dive now, the fish not handed back yet)
        UnderwaterFish.reset(null, 1);
        expect(UnderwaterFish.fish.length).toBeGreaterThan(0);
        // The surface's first frame up (InnerMapRenderer._renderSurfaceFish), drawing stubbed
        const fake = { _frameRange: { ...RANGE }, TILE_SIZE: 32, _waterFxNow: () => 1, _waterFxDay: () => 1 };
        const camera = { zoom: 1, worldToScreenFast: (x, y) => ({ x, y }) };
        const draw = SurfaceFish.draw;
        const pos = InnerMap.getPlayerWorldPos;
        SurfaceFish.draw = () => {};
        InnerMap.getPlayerWorldPos = () => ({ x: 20.5 * 32, y: 20.5 * 32 });
        try {
            InnerMapRenderer._renderSurfaceFish.call(fake, {}, camera);
        } finally {
            SurfaceFish.draw = draw;
            InnerMap.getPlayerWorldPos = pos;
        }
        expect(UnderwaterFish.fish.length).toBe(0);
        expect(UnderwaterFish._dive).toBe(null);
        expect(SurfaceFish.alive()).toBeGreaterThanOrEqual(Math.min(n, SurfaceFish.config().max) - 2);
    });
});

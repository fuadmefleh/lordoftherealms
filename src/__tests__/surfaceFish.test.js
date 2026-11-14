/**
 * Fish seen from above in the street map's water (ui/innerMapLayers/surfaceFish.js):
 * only in deep water, never the shallows, a bridge or ice; capped; the same
 * fish for the same map; holding against a river's current; shy of a swimmer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import '../ui/innerMapLayers.js';
import { InnerMap } from '../world/innerMap.js';
import { DataLoader } from '../core/dataLoader.js';
import { SurfaceFish, isFishWater } from '../ui/innerMapLayers/surfaceFish.js';

const SPECIES = [
    { id: 'minnow', back: '#7d8a6a', length: 0.26, height: 0.34, speed: 1.5, school: [6, 12], weight: 5, waters: ['lake', 'river', 'pond'] },
    { id: 'trout', back: '#6f735e', length: 0.7, height: 0.3, speed: 1.1, school: [1, 2], weight: 3, waters: ['river', 'lake'] },
    { id: 'mackerel', back: '#2d5a74', length: 0.55, height: 0.3, speed: 1.4, school: [5, 9], weight: 5, waters: ['sea'] },
];

/** Land with a river band rows [r0, r1) running east (flow +x); its edge rows shallow; a bridge at column 12 */
function lay({ W = 30, H = 14, r0 = 4, r1 = 10, frozen = false } = {}) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const wet = r >= r0 && r < r1;
            const shallow = wet && (r === r0 || r === r1 - 1);
            row.push({
                q, r, explored: true, visible: true,
                subTerrain: { id: wet ? (frozen ? 'frozen_river' : 'river_water') : 'grass', passable: !wet || shallow },
                _wet: wet, _shallow: shallow, _waterKind: wet ? 'river' : undefined,
                _bridge: wet && q === 12,
                _flow: wet ? { x: 1, y: 0, d: 1 } : undefined,
            });
        }
        tiles.push(row);
    }
    InnerMap.tiles = tiles;
    InnerMap.width = W;
    InnerMap.height = H;
    return tiles;
}

const RANGE = { qMin: 0, qMax: 29, rMin: 0, rMax: 13 };

beforeEach(() => {
    DataLoader._gamedata = {
        ...(DataLoader._gamedata || {}),
        diving: { fish: { species: SPECIES } },
        innerMap: { ...((DataLoader._gamedata && DataLoader._gamedata.innerMap) || {}), surfaceFish: { max: 12, perCell: { river: 0.08 }, seasons: { winter: 0.3 } } },
    };
    SurfaceFish._tiles = null;
    SurfaceFish.mask = null;
    SurfaceFish.fish = [];
    SurfaceFish.shoals = [];
    SurfaceFish.ripples = [];
    InnerMap.season = 'Summer';
    InnerMap._waterStamp = 0;
});

function run(seconds, player = null) {
    for (let t = 0; t < seconds; t += 0.05) SurfaceFish.update(0.05, RANGE, player);
}

describe('fish in the water seen from above', () => {
    it('is mixed into the renderer', () => {
        expect(typeof InnerMapRenderer._renderSurfaceFish).toBe('function');
    });

    it('deep water only: not the shallows, a bridge, land or ice', () => {
        const tiles = lay();
        expect(isFishWater(tiles[6][3])).toBe(true);
        expect(isFishWater(tiles[4][3])).toBe(false);   // shallow edge
        expect(isFishWater(tiles[6][12])).toBe(false);  // under the bridge
        expect(isFishWater(tiles[1][3])).toBe(false);   // land
        // (the deep rows by the shallows are a bank's cells, half painted shore: kept off too)
        expect(SurfaceFish.cells(tiles)).toBe(2 * 29);
        expect(SurfaceFish.swimmable(3.5, 5.5)).toBe(false);
        expect(SurfaceFish.swimmable(3.5, 6.5)).toBe(true);
        lay({ frozen: true });
        expect(SurfaceFish.cells(InnerMap.tiles)).toBe(0);
    });

    it('they stay in the deep water, up to the cap', () => {
        lay();
        SurfaceFish.cells(InnerMap.tiles);
        run(20);
        const n = SurfaceFish.alive();
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThanOrEqual(12);
        for (const f of SurfaceFish.fish) {
            if (!f.alive) continue;
            expect(SurfaceFish.swimmable(f.x, f.y)).toBe(true);
            const t = InnerMap.tiles[Math.floor(f.y)][Math.floor(f.x)];
            // (in the deep, or passing under the bridge out of sight)
            expect(isFishWater(t) || (t._bridge && !t._shallow)).toBe(true);
            expect(['minnow', 'trout']).toContain(f.sp.id);   // river fish, not the sea's
        }
    });

    it('the same fish for the same map (their own seeded stream)', () => {
        lay();
        SurfaceFish.cells(InnerMap.tiles);
        run(5);
        const a = SurfaceFish.fish.filter(f => f.alive).map(f => `${f.sp.id}:${f.x.toFixed(3)},${f.y.toFixed(3)}`);
        SurfaceFish._tiles = null;
        SurfaceFish.fish = [];
        SurfaceFish.shoals = [];
        lay();
        SurfaceFish.cells(InnerMap.tiles);
        run(5);
        const b = SurfaceFish.fish.filter(f => f.alive).map(f => `${f.sp.id}:${f.x.toFixed(3)},${f.y.toFixed(3)}`);
        expect(b).toEqual(a);
    });

    it('fewer in winter', () => {
        lay();
        SurfaceFish.cells(InnerMap.tiles);
        const summer = SurfaceFish.target(RANGE);
        InnerMap.season = 'Winter';
        expect(SurfaceFish.target(RANGE)).toBeLessThan(summer);
    });

    it('in a river they face upstream more often than not', () => {
        lay();
        SurfaceFish.cells(InnerMap.tiles);
        run(30);
        let up = 0, down = 0;
        for (const f of SurfaceFish.fish) {
            if (!f.alive) continue;
            if (Math.cos(f.ang) < 0) up++; else down++;
        }
        expect(up).toBeGreaterThan(down);
    });

    it('a swimmer close by sends them off', () => {
        lay();
        SurfaceFish.cells(InnerMap.tiles);
        run(5);
        const f = SurfaceFish.fish.find(x => x.alive);
        const p = { x: f.x + 0.5, y: f.y, inWater: true };
        const d0 = Math.hypot(f.x - p.x, f.y - p.y);
        run(0.6, p);
        expect(f.scared).toBeGreaterThan(0);
        if (f.alive) expect(Math.hypot(f.x - p.x, f.y - p.y)).toBeGreaterThan(d0);
    });

    it('off screen they are gone', () => {
        lay();
        SurfaceFish.cells(InnerMap.tiles);
        run(5);
        expect(SurfaceFish.alive()).toBeGreaterThan(0);
        SurfaceFish.update(0.05, { qMin: 0, qMax: 3, rMin: 0, rMax: 2 }, null);
        // only fish within reach of that corner (3 tiles' pad) can stay
        for (const f of SurfaceFish.fish) if (f.alive) expect(f.x).toBeLessThan(8);
    });
});

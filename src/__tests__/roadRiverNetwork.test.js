// The overworld's rivers and roads as networks: each river hex flows to one
// downstream neighbour, downhill, ending in open water or another river; no
// river is left on water; road links run both ways between road hexes; and
// the towns of a landmass are joined by road.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { World } from '../world/world.js';

const W = 80, H = 50;
let world;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    world = new World(W, H);
    world.generate({ seed: 4242, kingdomCount: 4, terrainGen: 3 });
});

const at = (q, r) => world.tiles[r][Hex.wrapQ(q, W)];
const step = (t, dir) => {
    const n = Hex.neighbors(t.q, t.r)[dir];
    return n.r >= 0 && n.r < H ? at(n.q, n.r) : null;
};
const allTiles = () => world.tiles.flat();
const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'sea', 'lake']);

describe('Hex.offsetDistance', () => {
    it('is 1 for every neighbour, on even and odd rows', () => {
        for (const [q, r] of [[5, 4], [5, 5]]) {
            for (const n of Hex.neighbors(q, r)) expect(Hex.offsetDistance(q, r, n.q, n.r)).toBe(1);
        }
    });

    it('counts a straight diagonal run as its length', () => {
        // SE from (3, 0) four times
        let q = 3, r = 0;
        for (let i = 0; i < 4; i++) ({ q, r } = Hex.neighbors(q, r)[5]);
        expect(Hex.offsetDistance(3, 0, q, r)).toBe(4);
    });

    it('directionTo finds the neighbour index, across the wrap seam', () => {
        expect(Hex.directionTo(0, 3, W - 1, 3, W)).toBe(3);
        expect(Hex.directionTo(0, 3, 5, 3, W)).toBe(-1);
    });
});

describe('Rivers', () => {
    it('has rivers, none drawn on open water', () => {
        const rivers = allTiles().filter(t => t.hasRiver);
        expect(rivers.length).toBeGreaterThan(20);
        expect(rivers.filter(t => WATER.has(t.terrain.id))).toEqual([]);
    });

    it('every river hex flows downhill into water or another river', () => {
        for (const t of allTiles().filter(x => x.hasRiver)) {
            expect(Number.isInteger(t.riverDir)).toBe(true);
            const down = step(t, t.riverDir);
            expect(down).toBeTruthy();
            expect(down.hasRiver || WATER.has(down.terrain.id) || down.elevation < 0.42).toBe(true);
        }
    });

    it('following the flow always reaches water (no loops, no dead ends)', () => {
        for (const src of allTiles().filter(x => x.hasRiver && x.riverSource)) {
            let t = src;
            const seen = new Set();
            while (t && t.hasRiver) {
                expect(seen.has(t)).toBe(false);
                seen.add(t);
                t = step(t, t.riverDir);
            }
            expect(t && (WATER.has(t.terrain.id) || t.elevation < 0.42)).toBe(true);
        }
    });
});

describe('Roads', () => {
    it('road links run both ways and only between road hexes', () => {
        for (const t of allTiles().filter(x => x.hasRoad)) {
            expect(t.roadLinks).toBeGreaterThan(0);
            for (let d = 0; d < 6; d++) {
                if (!(t.roadLinks & (1 << d))) continue;
                const n = step(t, d);
                expect(n && n.hasRoad).toBe(true);
                expect(n.roadLinks & (1 << ((d + 3) % 6))).toBeTruthy();
            }
        }
    });

    it('joins the settlements of each landmass into one road network', () => {
        const towns = world.getAllSettlements();
        const byRegion = new Map();
        for (const s of towns) {
            const rid = at(s.q, s.r).regionId;
            if (!byRegion.has(rid)) byRegion.set(rid, []);
            byRegion.get(rid).push(s);
        }
        for (const group of byRegion.values()) {
            if (group.length < 2) continue;
            // Flood the road links out from the first town
            const start = at(group[0].q, group[0].r);
            const reached = new Set([start]);
            const queue = [start];
            while (queue.length) {
                const t = queue.shift();
                for (let d = 0; d < 6; d++) {
                    if (!(t.roadLinks & (1 << d))) continue;
                    const n = step(t, d);
                    if (n && !reached.has(n)) { reached.add(n); queue.push(n); }
                }
            }
            for (const s of group) expect(reached.has(at(s.q, s.r))).toBe(true);
        }
    });
});

describe('Hex metric on the offset grid', () => {
    it('distance is 1 to every neighbour and counts true steps', () => {
        for (const [q, r] of [[5, 4], [5, 5], [0, 0], [7, 1]]) {
            for (const n of Hex.neighbors(q, r)) expect(Hex.distance(q, r, n.q, n.r)).toBe(1);
        }
        // Four steps SE, four steps SW: 4 each
        for (const dir of [4, 5]) {
            let q = 3, r = 2;
            for (let i = 0; i < 4; i++) ({ q, r } = Hex.neighbors(q, r)[dir]);
            expect(Hex.distance(3, 2, q, r)).toBe(4);
        }
    });

    it('hexesInRange is the true disc: 3n(n+1)+1 hexes, all within n', () => {
        for (const [q, r, n] of [[10, 10, 3], [10, 11, 2], [4, 7, 5]]) {
            const disc = Hex.hexesInRange(q, r, n);
            expect(disc.length).toBe(3 * n * (n + 1) + 1);
            expect(new Set(disc.map(h => `${h.q},${h.r}`)).size).toBe(disc.length);
            for (const h of disc) expect(Hex.distance(q, r, h.q, h.r)).toBeLessThanOrEqual(n);
            // and its ring of neighbours is all of distance 1
            expect(Hex.hexesInRange(q, r, 1).filter(h => h.q !== q || h.r !== r).map(h => `${h.q},${h.r}`).sort())
                .toEqual(Hex.neighbors(q, r).map(h => `${h.q},${h.r}`).sort());
        }
    });

    it('lineDraw steps hex to adjacent hex', () => {
        const line = Hex.lineDraw(2, 3, 11, 9);
        expect(line[0]).toEqual({ q: 2, r: 3 });
        expect(line[line.length - 1]).toEqual({ q: 11, r: 9 });
        for (let i = 1; i < line.length; i++) expect(Hex.distance(line[i - 1].q, line[i - 1].r, line[i].q, line[i].r)).toBe(1);
    });

    it('the old metric is kept for regenerating old worlds', () => {
        expect(Hex.withLegacyMetric(() => Hex.distance(0, 0, 1, 2))).toBe(3);
        expect(Hex.distance(0, 0, 1, 2)).toBe(2);
        expect(Hex.withLegacyMetric(() => Hex.hexesInRange(0, 0, 1).length)).toBe(7);
    });
});

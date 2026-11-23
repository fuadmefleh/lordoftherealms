// Mountain ranges are walls, their passes the gates (world/mountainBarriers.js,
// data/travel.json hexDays / floorDays / mountains). A mountain hex is a hard climb
// for the player, a host or a caravan, a snow peak no way at all; in winter the
// peaks are snowbound while a pass (tile._pass, worlds since terrainGen 16) only
// slows; hosts plan their march by the ground, so they go by the pass; since
// terrainGen 17 the world's roads do too.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Terrain } from '../world/terrain.js';
import { WorldUnit } from '../world/units.js';
import { MountainBarriers } from '../world/mountainBarriers.js';
import { Infrastructure } from '../systems/infrastructure.js';

const SEEDS = [4711, 99, 7];
const PEAK = new Set(['mountain', 'snow_peak']);
const SUMMER = 40, EARLY_WINTER = 93, DEEP_WINTER = 110;

let T;
const worlds = {};
const tileOf = (id, extra = {}) => ({ terrain: T[id.toUpperCase()], ...extra });

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    T = Terrain.TYPES;
    for (const s of SEEDS) {
        const w = new World(120, 80);
        w.generate({ seed: s, kingdomCount: 6, terrainGen: 16, riverCount: 40 });
        worlds[s] = { w, passes: Terrain._lastPasses16.passes };
    }
});

// Cheapest way from a to b by cost(tile) (skip: hexes not to enter) → { d, path } or null
function cheapest(w, a, b, cost, skip = null) {
    const W = w.width, H = w.height;
    const id = (q, r) => r * W + q;
    const dist = new Map([[id(a.q, a.r), 0]]), from = new Map(), done = new Set();
    const open = [[0, a.q, a.r]];
    const end = id(Hex.wrapQ(b.q, W), b.r);
    while (open.length) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
        const [d, q, r] = open[bi];
        open[bi] = open[open.length - 1];
        open.pop();
        const k = id(q, r);
        if (done.has(k)) continue;
        done.add(k);
        if (k === end) {
            const path = [];
            for (let n = k; n !== undefined; n = from.get(n)) path.push(w.tiles[Math.floor(n / W)][n % W]);
            return { d, path: path.reverse() };
        }
        if (d > 150) break;
        for (const nb of Hex.neighbors(q, r)) {
            if (nb.r < 0 || nb.r >= H) continue;
            const nq = Hex.wrapQ(nb.q, W);
            const t = w.tiles[nb.r][nq];
            if (skip && skip(t)) continue;
            const c = cost(t);
            if (!Number.isFinite(c)) continue;
            const nk = id(nq, nb.r), nd = d + c;
            if (!dist.has(nk) || nd < dist.get(nk)) { dist.set(nk, nd); from.set(nk, k); open.push([nd, nq, nb.r]); }
        }
    }
    return null;
}

// Days on foot off the road (the terrain and the pass mark only)
const offRoad = (day) => (t) => Infrastructure.getPlayerHexDays({ terrain: t.terrain, _pass: t._pass }, null, day);

// A flat world of `id` with a wall of `wallId` in columns [c0, c1]
function stripWorld(wallId, c0 = 8, c1 = 11, width = 48, height = 9) {
    const tiles = [];
    for (let r = 0; r < height; r++) {
        tiles.push([]);
        // (and a sea on the far side of the map, so no way runs round the world)
        for (let q = 0; q < width; q++) tiles[r].push({ q, r, terrain: T[(q >= c0 && q <= c1 ? wallId : q >= width - 8 ? 'ocean' : 'plains').toUpperCase()], regionId: 1 });
    }
    return { width, height, day: SUMMER, tiles, units: [], events: [], getTile(q, r) { return r < 0 || r >= height ? null : tiles[r][Hex.wrapQ(q, width)]; } };
}

function marchDays(w, from, to, type = 'war_host', speed = 3) {
    const u = new WorldUnit(type, from.q, from.r, to.q, to.r);
    u.speed = speed;
    u.objectiveQ = to.q; u.objectiveR = to.r;
    u.maxAge = 1e9;
    let days = 0, viaPass = false, overPeak = false;
    const trail = [];
    while (days < 200 && !(u.q === Hex.wrapQ(to.q, w.width) && u.r === to.r)) {
        if (type === 'war_host') u.updateWarHost(w); else u.marchToward(w, speed);
        days++;
        const t = w.getTile(u.q, u.r);
        if (t._pass) viaPass = true;
        if (PEAK.has(t.terrain.id)) overPeak = true;
        trail.push(`${u.q},${u.r}`);
    }
    return { days, viaPass, overPeak, trail };
}

describe('Mountain barriers: on foot', () => {
    it('a mountain is a hard climb, a snow peak no way, the pass ground (hills, highlands) far cheaper', () => {
        const mtn = Infrastructure.getPlayerHexDays(tileOf('mountain'), null, SUMMER);
        expect(mtn).toBeGreaterThanOrEqual(6);
        expect(Infrastructure.getPlayerHexDays(tileOf('snow_peak'), null, SUMMER)).toBe(Infinity);
        const hills = Infrastructure.getPlayerHexDays(tileOf('hills', { _pass: 1 }), null, SUMMER);
        const high = Infrastructure.getPlayerHexDays(tileOf('highlands', { _pass: 1 }), null, SUMMER);
        expect(hills).toBeLessThanOrEqual(1.5);
        expect(high).toBeLessThanOrEqual(2.5);
        expect(mtn / high).toBeGreaterThanOrEqual(2.4);
        // (a fast traveller still never crosses a mountain under its floor)
        expect(Infrastructure.getPlayerHexDays(tileOf('mountain'), { _travelSpeed: 1.2 }, SUMMER)).toBeGreaterThanOrEqual(5);
    });

    it('winter: the peaks are snowbound in deep winter, a pass stays open', () => {
        const d = (id, day, extra) => Infrastructure.getPlayerHexDays(tileOf(id, extra), null, day);
        expect(d('mountain', EARLY_WINTER)).toBeGreaterThan(d('mountain', SUMMER));
        expect(d('mountain', DEEP_WINTER)).toBeGreaterThan(d('mountain', EARLY_WINTER));
        expect(d('mountain', DEEP_WINTER)).toBeGreaterThanOrEqual(12);
        expect(d('highlands', DEEP_WINTER)).toBeGreaterThan(d('highlands', SUMMER));
        // the pass: no dearer in early winter, a little in deep winter, and far under the peaks
        expect(d('highlands', EARLY_WINTER, { _pass: 1 })).toBe(d('highlands', SUMMER, { _pass: 1 }));
        expect(d('highlands', DEEP_WINTER, { _pass: 1 })).toBeLessThanOrEqual(1.5 * d('highlands', SUMMER, { _pass: 1 }));
        expect(d('mountain', DEEP_WINTER) / d('highlands', DEEP_WINTER, { _pass: 1 })).toBeGreaterThanOrEqual(4);
        // low ground and roads keep their figures
        expect(d('plains', DEEP_WINTER)).toBe(d('plains', SUMMER));
        expect(d('hills', DEEP_WINTER)).toBe(d('hills', SUMMER));
        // the player's day: their noted travel day is the default
        expect(Infrastructure.getPlayerHexDays(tileOf('mountain'), { _travelDay: DEEP_WINTER })).toBe(d('mountain', DEEP_WINTER));
    });

    it('on gen-16 worlds the pass is clearly the cheap way across a range, more so in winter', () => {
        let n = 0, usesPass = 0, ratio = 0, winterRatio = 0;
        for (const s of SEEDS) {
            const { w, passes } = worlds[s];
            for (const p of passes) {
                const A = p.path[0], B = p.path[p.path.length - 1];
                const best = cheapest(w, A, B, offRoad(SUMMER));
                const via = cheapest(w, A, B, offRoad(SUMMER), (t) => PEAK.has(t.terrain.id));
                const without = cheapest(w, A, B, offRoad(SUMMER), (t) => !!t._pass);
                const viaW = cheapest(w, A, B, offRoad(DEEP_WINTER), (t) => PEAK.has(t.terrain.id));
                const withoutW = cheapest(w, A, B, offRoad(DEEP_WINTER), (t) => !!t._pass);
                if (!best || !via || !without || !viaW || !withoutW) continue;
                n++;
                if (best.path.some(t => t._pass)) usesPass++;
                ratio += without.d / via.d;
                winterRatio += withoutW.d / viaW.d;
            }
        }
        expect(n).toBeGreaterThanOrEqual(4);
        expect(usesPass / n).toBeGreaterThanOrEqual(0.7);
        expect(ratio / n).toBeGreaterThanOrEqual(1.4);
        expect(winterRatio / n).toBeGreaterThan(ratio / n);
    });
});

describe('Mountain barriers: hosts and caravans', () => {
    it('a host marching over a mountain wall is slowed, more in deep winter; over plains it is not', () => {
        const from = { q: 2, r: 4 }, to = { q: 18, r: 4 };
        const plain = marchDays(stripWorld('plains'), from, to);
        const wall = marchDays(stripWorld('mountain'), from, to);
        const w = stripWorld('mountain');
        w.day = DEEP_WINTER;
        const winter = marchDays(w, from, to);
        expect(plain.days).toBe(Math.ceil(16 / 3));
        expect(wall.days).toBeGreaterThanOrEqual(plain.days + 4);
        expect(winter.days).toBeGreaterThan(wall.days);
        // a highland ridge is only a little slower
        const ridge = marchDays(stripWorld('highlands'), from, to);
        expect(ridge.days).toBeLessThan(wall.days);
        expect(ridge.days).toBeGreaterThanOrEqual(plain.days);
    });

    it('a host plans its march around a wall by its pass', () => {
        const w = stripWorld('mountain', 8, 11, 48, 15);
        // a pass of hills through the wall on row 12
        for (let q = 8; q <= 11; q++) { w.tiles[12][q].terrain = T.HILLS; w.tiles[12][q]._pass = 1; }
        const r = marchDays(w, { q: 2, r: 4 }, { q: 18, r: 4 });
        expect(r.viaPass).toBe(true);
        expect(r.overPeak).toBe(false);
    });

    it('a caravan pays the mountains on its straight way; a raider walks as before', () => {
        const from = { q: 2, r: 4 }, to = { q: 18, r: 4 };
        const plain = marchDays(stripWorld('plains'), from, to, 'caravan', 4);
        const wall = marchDays(stripWorld('mountain'), from, to, 'caravan', 4);
        expect(wall.days).toBeGreaterThan(plain.days);
        expect(MountainBarriers.paysMarch('raider')).toBe(false);
        expect(MountainBarriers.marchCost({ terrain: T.PLAINS })).toBe(1);
        expect(MountainBarriers.marchCost({ terrain: T.SNOW_PEAK })).toBe(Infinity);
        // a road over the mountains is the quick way, slower when snow closes it
        const road = { terrain: T.MOUNTAIN, hasRoad: true, roadMove: 0.5 };
        expect(MountainBarriers.marchCost(road, DEEP_WINTER)).toBeLessThan(MountainBarriers.marchCost({ terrain: T.MOUNTAIN }, SUMMER));
        expect(MountainBarriers.marchCost({ ...road, roadExtra: 3 }, DEEP_WINTER)).toBeGreaterThan(MountainBarriers.marchCost(road, DEEP_WINTER));
    });

    it('on gen-16 worlds a host goes over a range by its pass, not over the peaks', () => {
        let n = 0, viaPass = 0, overPeak = 0, arrived = 0;
        for (const s of SEEDS) {
            const { w, passes } = worlds[s];
            w.day = SUMMER;
            for (const p of passes) {
                const A = p.path[0], B = p.path[p.path.length - 1];
                const r = marchDays(w, A, B);
                n++;
                if (r.viaPass) viaPass++;
                if (r.overPeak) overPeak++;
                if (r.days < 200) arrived++;
            }
        }
        expect(n).toBeGreaterThanOrEqual(4);
        expect(arrived).toBe(n);
        expect(viaPass / n).toBeGreaterThanOrEqual(0.75);
        expect(overPeak / n).toBeLessThanOrEqual(0.25);
    });

    it('is deterministic: the same march twice is the same trail', () => {
        const { w, passes } = worlds[SEEDS[0]];
        const p = passes[0];
        const A = p.path[0], B = p.path[p.path.length - 1];
        Utils.setSeed(7);
        const a = marchDays(w, A, B);
        Utils.setSeed(7);
        const b = marchDays(w, A, B);
        expect(b.trail).toEqual(a.trail);
    });
});

describe('Mountain barriers: roads', () => {
    it('before terrainGen 17 the road builder pays the terrain move cost as it always did', () => {
        for (const id of ['plains', 'hills', 'highlands', 'mountain']) {
            expect(MountainBarriers.roadCost({ terrain: T[id.toUpperCase()], _pass: 1 }, 16)).toBe(T[id.toUpperCase()].moveCost);
        }
        expect(MountainBarriers.roadCost({ terrain: T.MOUNTAIN }, 17)).toBeGreaterThan(2 * T.MOUNTAIN.moveCost);
        expect(MountainBarriers.roadCost({ terrain: T.HIGHLANDS, _pass: 1 }, 17)).toBeLessThan(MountainBarriers.roadCost({ terrain: T.HIGHLANDS }, 17));
    });

    it('since terrainGen 17 the roads go through ranges by their passes', () => {
        const count = (gen) => {
            const w = new World(120, 80);
            w.generate({ seed: SEEDS[0], kingdomCount: 6, terrainGen: gen, riverCount: 40 });
            let mtn = 0, pass = 0;
            for (const t of w.tiles.flat()) if (t.hasRoad) { if (t.terrain.id === 'mountain') mtn++; if (t._pass) pass++; }
            return { mtn, pass };
        };
        const g16 = count(16), g17 = count(17);
        expect(g17.mtn).toBeLessThan(g16.mtn);
        expect(g17.pass).toBeGreaterThanOrEqual(g16.pass);
    });
});

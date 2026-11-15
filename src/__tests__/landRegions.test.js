// Landmasses (world/landRegions.js) and the walker's pathfinding: a hex over
// the sea is no overland trip, so Player.moveTo / travelEstimate say so at
// once instead of running the A* over the whole island ("[PATHFIND] FAILED",
// the century soak's commonest warning — the bot asked daily for towns on
// other islands).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { LandRegions } from '../world/landRegions.js';
import { Terrain } from '../world/terrain.js';
import { Hex } from '../core/hex.js';
import { Player } from '../player/player.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => { await loadData(); });

/**
 * 20×10, wrapping east–west: land in columns 0–3 and 16–19 (one landmass
 * across the seam), an island in columns 8–11, sea everywhere else.
 */
function islands() {
    const W = 20, H = 10;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const land = q <= 3 || q >= 16 || (q >= 8 && q <= 11);
            row.push({ q, r, terrain: land ? Terrain.TYPES.GRASSLAND : Terrain.TYPES.OCEAN, elevation: land ? 0.4 : 0.1 });
        }
        tiles.push(row);
    }
    return {
        width: W, height: H, tiles, day: 1,
        getTile(q, r) { return r < 0 || r >= H ? null : tiles[r][Hex.wrapQ(q, W)]; },
    };
}

describe('LandRegions', () => {
    it('labels landmasses across the east–west seam and keeps islands apart', () => {
        const w = islands();
        expect(LandRegions.connected(w, { q: 1, r: 4 }, { q: 18, r: 6 })).toBe(true);
        expect(LandRegions.connected(w, { q: 1, r: 4 }, { q: 9, r: 4 })).toBe(false);
        expect(LandRegions.connected(w, { q: 9, r: 0 }, { q: 11, r: 9 })).toBe(true);
        expect(LandRegions.of(w, 5, 5)).toBe(-1);
        expect(LandRegions.connected(w, { q: 1, r: 4 }, { q: 5, r: 4 })).toBe(false);
        expect(LandRegions.size(w, LandRegions.of(w, 0, 0))).toBe(8 * 10);
        expect(LandRegions.size(w, LandRegions.of(w, 9, 0))).toBe(4 * 10);
        // (off the map's top and bottom: nowhere)
        expect(LandRegions.of(w, 1, -1)).toBe(-1);
        expect(LandRegions.of(w, 1, 10)).toBe(-1);
    });

    it('labels afresh when the ground changes under it', () => {
        const w = islands();
        expect(LandRegions.of(w, 5, 5)).toBe(-1);
        // A hex asked about whose ground changed (sea become land) is seen at once
        w.tiles[5][4].terrain = Terrain.TYPES.GRASSLAND;
        expect(LandRegions.connected(w, { q: 2, r: 5 }, { q: 4, r: 5 })).toBe(true);
        // A causeway across the strait (as clearing or levelling ground does):
        // the terraforming code calls invalidate
        for (let q = 5; q <= 7; q++) w.tiles[5][q].terrain = Terrain.TYPES.GRASSLAND;
        expect(LandRegions.connected(w, { q: 2, r: 5 }, { q: 9, r: 5 })).toBe(false);
        LandRegions.invalidate(w);
        expect(LandRegions.connected(w, { q: 2, r: 5 }, { q: 9, r: 5 })).toBe(true);
    });

    it('has no opinion without a tile grid (a test mock)', () => {
        expect(LandRegions.of({}, 1, 1)).toBe(null);
        expect(LandRegions.connected({ width: 0 }, { q: 1, r: 1 }, { q: 2, r: 2 })).toBe(true);
    });
});

describe('walking to another island', () => {
    it('moveTo and travelEstimate refuse at once, without the A* failing', () => {
        const w = islands();
        const p = new Player();
        p.q = 1; p.r = 4;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const find = vi.spyOn(Hex, 'findPath');
        try {
            expect(p.moveTo(9, 4, w)).toBe(false);
            expect(p.travelEstimate(w, 10, 6)).toBe(null);
            expect(find).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
            // Across the seam, on the same land, the way is found
            expect(p.moveTo(18, 4, w)).toBe(true);
            expect(p.path[p.path.length - 1]).toEqual({ q: 18, r: 4 });
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
            find.mockRestore();
        }
    });

    it('aboard ship the landmass does not bar the way', () => {
        const p = new Player();
        p.boardedShip = 'ship_1';
        expect(p._overlandReachable(9, 4, islands())).toBe(true);
    });

    it('on a generated world, every town the walker is told is out of reach really has no overland way', () => {
        const { world, player } = newGame(202);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const pass = (q, r) => player._canEnterHex(q, r, world);
            let apart = 0;
            for (const s of world.getAllSettlements()) {
                if (player._overlandReachable(s.q, s.r, world)) continue;
                apart++;
                // the A* agrees (searching the whole island to say so)
                expect(Hex.findPath(player.q, player.r, s.q, s.r, world.width, world.height, pass)).toBe(null);
                if (apart >= 3) break;
            }
            expect(apart).toBeGreaterThan(0);
        } finally {
            warn.mockRestore();
        }
    }, 120000);
});

describe('Hex.findPath fails quietly', () => {
    it('counts a way that cannot be had (off the map, blocked, too far, searched out) instead of logging it', () => {
        const w = islands();
        const pass = (q, r) => { const t = w.getTile(q, r); return !!(t && t.terrain.passable); };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const before = { ...Hex.pathStats };
        try {
            expect(Hex.findPath(1, 4, 1, -2, w.width, w.height, pass)).toBe(null);       // off the top
            expect(Hex.findPath(1, 4, 1, 10, w.width, w.height, pass)).toBe(null);       // off the bottom
            expect(Hex.findPath(1, 4, 5, 4, w.width, w.height, pass)).toBe(null);        // the sea
            expect(Hex.findPath(1, 4, 9, 4, w.width, w.height, pass)).toBe(null);        // another island: searched out
            expect(Hex.findPath(1, 4, 1, 80, w.width, 200, () => true)).toBe(null);      // past 50 hexes
            expect(Hex.pathStats.offMap - before.offMap).toBe(2);
            expect(Hex.pathStats.blocked - before.blocked).toBe(1);
            expect(Hex.pathStats.exhausted - before.exhausted).toBe(1);
            expect(Hex.pathStats.tooFar - before.tooFar).toBe(1);
            expect(warn).not.toHaveBeenCalled();
            // (and the way that is there is still found)
            expect(Hex.findPath(1, 4, 18, 4, w.width, w.height, pass).pop()).toEqual({ q: 18, r: 4 });
        } finally {
            warn.mockRestore();
        }
    });
});

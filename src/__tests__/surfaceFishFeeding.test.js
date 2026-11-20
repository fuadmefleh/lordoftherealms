/**
 * Throwing food to the fish (ui/innerMapFeedFish.js, ui/innerMapLayers/surfaceFish.js):
 * the morsel lands and floats; the fish about come to it and take turns nibbling it
 * down, a ring at each bite; a line cast there after bites the readier; by the bank
 * it floats where the fish can't swim, and they nose up from the deep side; the menu
 * offers it only on fish water in a throw, and one goes from the packs a throw.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import '../ui/innerMapRenderer.js';
import '../ui/innerMapLayers.js';
import { InnerMap } from '../world/innerMap.js';
import { DataLoader } from '../core/dataLoader.js';
import { SurfaceFish } from '../ui/innerMapLayers/surfaceFish.js';
import { InnerMapFeedFish } from '../ui/innerMapFeedFish.js';

const SPECIES = [
    { id: 'perch', back: '#6f735e', length: 0.45, height: 0.32, speed: 1.2, school: [3, 5], weight: 5, waters: ['lake'] },
];
const FEEDING = {
    reach: 6, flight: 0.5, pull: 8, takers: 5, biteEvery: [0.5, 1], morselEvery: 1.2, life: 60, drift: 0.4,
    extra: 4, comeEvery: 1, near: 2.5, biteBonus: 0.15, fedSeconds: 120,
    foods: { bread: { bites: 8, draw: 1, color: '#d6a15a', what: 'a crust of bread' } },
};

/** A lake: rows [r0, r1) of deep water across the map, land above and below */
function lake({ W = 30, H = 16, r0 = 4, r1 = 13 } = {}) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const wet = r >= r0 && r < r1;
            row.push({
                q, r, explored: true, visible: true,
                subTerrain: { id: wet ? 'lake_water' : 'grass', passable: !wet },
                _wet: wet, _waterKind: wet ? 'lake' : undefined,
            });
        }
        tiles.push(row);
    }
    InnerMap.tiles = tiles;
    InnerMap.width = W;
    InnerMap.height = H;
    return tiles;
}

const RANGE = { qMin: 0, qMax: 29, rMin: 0, rMax: 15 };

beforeEach(() => {
    DataLoader._gamedata = {
        ...(DataLoader._gamedata || {}),
        diving: { fish: { species: SPECIES } },
        innerMap: { ...((DataLoader._gamedata && DataLoader._gamedata.innerMap) || {}), surfaceFish: { max: 14, perCell: { lake: 0.12 }, jump: 0, feeding: FEEDING } },
    };
    SurfaceFish._tiles = null;
    SurfaceFish.mask = null;
    SurfaceFish.fish = [];
    SurfaceFish.shoals = [];
    SurfaceFish.ripples = [];
    SurfaceFish.baits = [];
    SurfaceFish.fed = [];
    SurfaceFish._clock = 0;
    InnerMap.season = 'Summer';
    InnerMap._waterStamp = 0;
});

function run(seconds) {
    const C = SurfaceFish.config();
    for (let t = 0; t < seconds; t += 0.05) SurfaceFish.update(0.05, RANGE, null, C);
}

describe('food on the water', () => {
    it('the fish come to it and take turns at it, a ring at each bite, until it is gone', () => {
        lake();
        SurfaceFish.cells(InnerMap.tiles);
        run(2);
        expect(SurfaceFish.alive()).toBeGreaterThan(0);
        const b = SurfaceFish.throwBait(15.5, 2, 15.5, 8.5, FEEDING.foods.bread);
        run(1);
        expect(b.landed).toBe(true);
        expect(b.alive).toBe(true);
        // (some fish turn to it)
        run(3);
        expect(SurfaceFish.fish.some(f => f.alive && f.lure === b)).toBe(true);
        // nibbled down — at most one bite a morselEvery (×0.7) — and gone
        let rings = 0, seen = new Set();
        const C = SurfaceFish.config();
        let t = 0;
        for (; t < 40 && b.alive; t += 0.05) {
            SurfaceFish.update(0.05, RANGE, null, C);
            for (const r of SurfaceFish.ripples) if (r.alive && r.kind === 'nibble' && !seen.has(r)) { seen.add(r); rings++; }
        }
        expect(b.alive).toBe(false);
        expect(b.bites).toBe(0);
        expect(rings).toBeGreaterThan(0);
        expect(t).toBeGreaterThan((FEEDING.foods.bread.bites - 1) * FEEDING.morselEvery * 0.7 - 4);
        // let go of it
        expect(SurfaceFish.fish.some(f => f.alive && f.lure === b)).toBe(false);
        // a line cast there now bites the readier; well away from it, not
        expect(SurfaceFish.biteBonus(15, 8)).toBeCloseTo(0.15);
        expect(SurfaceFish.biteBonus(2, 12)).toBe(0);
    });

    it('by the bank it floats where no fish swims; they nose up from the deep side', () => {
        lake();
        SurfaceFish.cells(InnerMap.tiles);
        // row 4 is the water's edge: fish water, but not the fish's own (water all round)
        expect(SurfaceFish.floatable(10.5, 4.5)).toBe(true);
        expect(SurfaceFish.swimmable(10.5, 4.5)).toBe(false);
        const rp = SurfaceFish.reachPoint(10.5, 4.5);
        expect(rp).toBeTruthy();
        expect(SurfaceFish.swimmable(rp.x, rp.y)).toBe(true);
        run(2);
        const b = SurfaceFish.throwBait(10.5, 2, 10.5, 4.5, FEEDING.foods.bread);
        run(1.5);
        expect(b.alive).toBe(true);
        expect(b.ax).not.toBe(null);
        // on dry land it is simply lost
        const lost = SurfaceFish.throwBait(10.5, 1, 10.5, 1.5, FEEDING.foods.bread);
        run(1);
        expect(lost.alive).toBe(false);
    });
});

describe('the menu (ui/innerMapFeedFish.js)', () => {
    function game(inv = { bread: 2 }) {
        return { player: { inventory: { ...inv } }, world: {}, ui: { showNotification() {}, _logNotification() {}, updateStats() {} } };
    }

    it('on fish water in a throw: one from the packs a throw; too far, or nothing to throw, says so', () => {
        lake();
        SurfaceFish.cells(InnerMap.tiles);
        InnerMap.playerInnerQ = 10; InnerMap.playerInnerR = 2;
        InnerMap._underwater = false; InnerMap._insideBuilding = null;
        const saved = InnerMap.getPlayerWorldPos;
        InnerMap.getPlayerWorldPos = () => ({ x: 10 * 32 + 16, y: 2 * 32 + 16 });
        try {
            const g = game();
            const at = (q, r) => InnerMapFeedFish.menuItems(g, InnerMap.tiles[r][q], q, r);
            // land: nothing
            expect(at(10, 1)).toEqual([]);
            // deep water a throw off
            const items = at(11, 6);
            expect(items[0]).toMatchObject({ action: 'feedfish_throw', food: 'bread' });
            // too far
            expect(at(25, 8)[0].type).toBe('disabled');
            expect(at(25, 8)[0].label).toMatch(/too far/);
            InnerMapFeedFish.handle(g, items[0], 11, 6);
            expect(g.player.inventory.bread).toBe(1);
            expect(SurfaceFish.baits.filter(b => b.alive).length).toBe(1);
            InnerMapFeedFish.handle(g, items[0], 11, 6);
            expect(g.player.inventory.bread).toBeUndefined();
            // nothing left they'd eat
            expect(at(11, 6)[0].type).toBe('disabled');
        } finally {
            InnerMap.getPlayerWorldPos = saved;
        }
    });
});

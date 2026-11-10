/**
 * Living water on the inner map (ui/innerMapLayers/waterFx.js): which water
 * cells move (shore, open water, river), how far each spot of water is from
 * land (the surf's waterline), the river's flow, and the weather's hand.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import '../ui/innerMapLayers.js';
import { InnerMap } from '../world/innerMap.js';

/** A map: land to the west of column `coast`, sea from it east; a river row if asked */
function lay({ W = 24, H = 12, coast = 10, river = null } = {}) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const sea = q >= coast;
            const riv = river != null && r === river && q < coast;
            row.push({
                q, r, explored: true, visible: true,
                subTerrain: { id: sea ? 'sea_water' : riv ? 'river_water' : 'grass', passable: !(sea || riv) },
                _wet: sea || riv, _sea: sea, _waterKind: sea ? 'sea' : riv ? 'river' : undefined,
            });
        }
        tiles.push(row);
    }
    InnerMap.tiles = tiles;
    InnerMap.width = W;
    InnerMap.height = H;
    return tiles;
}

beforeEach(() => {
    InnerMapRenderer._waterFxCache = null;
    InnerMapRenderer._waterFxFieldCache = null;
    InnerMap._currentWorldTileRef = null;
    InnerMap.weather = null;
});

describe('the water that moves', () => {
    it('shore cells face the land; open water sparkles; the far side of the coast is still', () => {
        lay();
        const rows = InnerMapRenderer._waterFxCells();
        const cells = [...rows.values()].flat();
        const shore = cells.filter(c => c.sides);
        // the whole first column of sea, facing west (W = 8)
        expect(shore.length).toBe(12);
        for (const c of shore) {
            expect(c.q).toBe(10);
            expect(c.sides & 8).toBe(8);
            expect(c.strength).toBe(1);
        }
        // a few sparkle cells out on the open sea, none on land
        const glints = cells.filter(c => c.glint);
        expect(glints.length).toBeGreaterThan(0);
        expect(glints.every(c => c.q > 10)).toBe(true);
        // the same cells every time (hashed, not rolled)
        InnerMapRenderer._waterFxCache = null;
        expect([...InnerMapRenderer._waterFxCells().values()].flat().map(c => `${c.q},${c.r}`)).toEqual(cells.map(c => `${c.q},${c.r}`));
    });

    it('the distance to land grows out to sea, and is nothing on land', () => {
        lay();
        const F = InnerMapRenderer._waterFxField();
        const at = (q, r) => F.dist[(r * F.SUB + (F.SUB >> 1)) * F.w + q * F.SUB + (F.SUB >> 1)];
        expect(at(5, 5)).toBe(0);
        expect(at(9, 5)).toBe(0);
        // the middle of the first sea cell is half a tile from the shore
        expect(at(10, 5)).toBeCloseTo(0.5, 1);
        expect(at(12, 5)).toBeCloseTo(2.5, 1);
        expect(at(12, 5)).toBeGreaterThan(at(11, 5));
        // each shore cell knows where its waterline is (its west edge)
        const edge = F.edge.get(5 * F.Wd + 10);
        expect(edge[0]).toBeLessThan(0.15);
        expect(edge[1]).toBeCloseTo(0.5, 1);
        expect(F.strength[5 * F.Wd + 5]).toBe(0);
        expect(F.strength[5 * F.Wd + 10]).toBe(1);
    });

    it('the river runs the way the world river flows (else along its run), and has no breaking surf', () => {
        lay({ river: 6 });
        InnerMap._currentWorldTileRef = { riverDir: 3 }; // out by the west side
        const cells = [...InnerMapRenderer._waterFxCells().values()].flat();
        const river = cells.filter(c => c.river);
        expect(river.length).toBeGreaterThan(0);
        for (const c of river) expect([c.fx, c.fy]).toEqual([-1, 0]);
        expect(cells.some(c => c.kind === 'river' && c.sides)).toBe(false);
        // with no world river: along the river's run (a row, so east–west)
        InnerMapRenderer._waterFxCache = null;
        InnerMap._currentWorldTileRef = null;
        for (const c of [...InnerMapRenderer._waterFxCells().values()].flat().filter(c => c.river)) expect(c.fx).toBe(1);
    });

    it('a storm makes the waves come faster and reach further; a calm day leaves them be', () => {
        const cfg = InnerMapRenderer._waterFxCfg();
        InnerMap.weather = { type: 'storm', wind: 1 };
        const storm = InnerMapRenderer._waterFxWeather(cfg);
        InnerMap.weather = { type: 'clear' };
        const calm = InnerMapRenderer._waterFxWeather(cfg);
        expect(storm.speed).toBeGreaterThan(calm.speed);
        expect(storm.reach).toBeGreaterThan(calm.reach);
        expect(storm.splash).toBeGreaterThan(calm.splash);
        expect(storm.glint).toBeLessThan(calm.glint);
    });

    it('a ship mooring or casting off works the shore out again; a deck is not land', () => {
        const tiles = lay();
        const a = InnerMapRenderer._waterFxField();
        expect(InnerMapRenderer._waterFxField()).toBe(a);
        InnerMap._waterStamp = (InnerMap._waterStamp || 0) + 1;
        const b = InnerMapRenderer._waterFxField();
        expect(b).not.toBe(a);
        // a deck cell out on the water: neither land nor surf, so the sea beside it has no shore
        tiles[5][15]._deck = true;
        tiles[5][15]._wet = false;
        InnerMap._waterStamp++;
        const F = InnerMapRenderer._waterFxField();
        const at = (q, r) => F.dist[(r * F.SUB + (F.SUB >> 1)) * F.w + q * F.SUB + (F.SUB >> 1)];
        expect(at(16, 5)).toBeCloseTo(at(16, 4), 5);
        expect(F.strength[5 * F.Wd + 15]).toBe(0);
    });

    it('aboard and under way the bow wave and wake draw; hove to, they do not', () => {
        lay();
        InnerMapRenderer._frameRange = { qMin: 0, qMax: 23, rMin: 0, rMax: 11 };
        const calls = [];
        const ctx = { save() {}, restore() {}, drawImage() {}, fillRect: (...a) => calls.push(a), globalAlpha: 1, fillStyle: '' };
        const camera = { zoom: 1, worldToScreenFast: (x, y) => ({ x, y }) };
        const cfg = InnerMapRenderer._waterFxCfg();
        const wx = InnerMapRenderer._waterFxWeather(cfg);
        const L = { anchor: { q: 12, r: 8 }, defId: 'nope', helm: { q: 18, r: 6 }, bow: { q: 12, r: 6 } };
        // (no hull def to hand: nothing drawn, nothing thrown)
        expect(() => InnerMapRenderer._drawWake(ctx, camera, 1, wx, cfg, { L, flow: 1, underway: true })).not.toThrow();
        expect(calls.length).toBe(0);
        expect(() => InnerMapRenderer._drawSwell(ctx, { x: 0, y: 0 }, 32, InnerMapRenderer._frameRange, 1, wx, cfg, { L, flow: 1, underway: false })).not.toThrow();
    });

    it('reads the waterline off a sheet painted at 4× (the painted terrain), not the 32px spot of it', () => {
        // A 256×128 sheet at 4×: the 32px cell (32, 0) is pixels 128–255 across, all water (blue);
        // the same address unscaled (pixels 32–63) is grass, which once made every sea sample "land"
        const sw = 256, sh = 128;
        const data = new Uint8ClampedArray(sw * sh * 4);
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const o = (y * sw + x) * 4;
                if (x >= 128) { data[o] = 40; data[o + 1] = 110; data[o + 2] = 170; } else { data[o] = 80; data[o + 1] = 145; data[o + 2] = 16; }
                data[o + 3] = 255;
            }
        }
        const path = 'assets/lpc/Terrain/terrain_test.png';
        InnerMapRenderer._waterFxSheets = new Map([[path, { data, w: sw, h: sh, k: 4 }]]);
        const tiles = lay();
        for (const row of tiles) for (const t of row) if (t._wet) t.terrainDetail = { layer: 'water', sheetPath: path, sx: 32, sy: 0 };
        const F = InnerMapRenderer._waterFxField();
        const at = (q, r) => F.dist[(r * F.SUB + (F.SUB >> 1)) * F.w + q * F.SUB + (F.SUB >> 1)];
        expect(at(10, 5)).toBeCloseTo(0.5, 1);
        expect(at(12, 5)).toBeCloseTo(2.5, 1);
        expect(F.edge.get(5 * F.Wd + 10)).toBeTruthy();
        InnerMapRenderer._waterFxSheets = null;
    });

    it('river banks lap gently in the surf, and the river still runs', () => {
        lay({ river: 6 });
        const F = InnerMapRenderer._waterFxField();
        const cfg = InnerMapRenderer._waterFxCfg();
        const river = F.strength[6 * F.Wd + 4];
        expect(river).toBeGreaterThan(0);
        expect(river).toBeLessThan(F.strength[6 * F.Wd + 10]);
        expect(river).toBeLessThan(cfg.surf.kinds.lake);
        expect([...InnerMapRenderer._waterFxCells().values()].flat().some(c => c.river)).toBe(true);
    });

    it('the waves keep the ambient clock: on while the game runs, still while it is paused', () => {
        const R = InnerMapRenderer;
        const t0 = R._waterFxNow();
        R.tickAmbient(0.05, 0);            // paused
        expect(R._waterFxNow()).toBe(t0);
        R.tickAmbient(0.05, 1);            // running
        expect(R._waterFxNow()).toBeCloseTo(t0 + 0.05, 6);
    });

    it('no water, nothing to do; drawing with no canvas to hand is harmless', () => {
        const tiles = lay({ coast: 99 });
        expect(tiles[0][0]._wet).toBe(false);
        expect(InnerMapRenderer._waterFxCells()).toBeNull();
        lay();
        InnerMapRenderer._frameRange = { qMin: 0, qMax: 23, rMin: 0, rMax: 11 };
        const ctx = { save() {}, restore() {}, drawImage() {}, fillRect() {}, globalAlpha: 1 };
        const camera = { zoom: 1, worldToScreenFast: (x, y) => ({ x, y }) };
        expect(() => InnerMapRenderer._renderWaterFx(ctx, camera)).not.toThrow();
    });
});

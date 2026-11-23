// The light in a room (ui/interiorLight.js) and what time does to a room's look
// (ui/interiorDress.js): the light map answers its hearths lit or let die, candles,
// windows by the hour and shuttered; indoors it is the only light pass (LightSystem's
// night overlay left off: no room darkened twice); soot, broken pieces and cold hearths
// draw; a north–south inner wall is one unbroken cap, its joins one shape.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import { InnerMap } from '../world/innerMap.js';
import { LightSystem } from '../ui/lightSystem.js';
import { InteriorLight, interiorLightMap, lightAt, collectLightSources, sourceLit } from '../ui/interiorLight.js';
import { drawInnerWall, drawSoot, sootOf, fireOut, CAP } from '../ui/interiorDress.js';
import '../ui/innerMapLayers.js';

const ART = JSON.parse(fs.readFileSync('data/innerMapRenderer.json', 'utf8')).interiorArt;

/** A 2D context drawing nothing, remembering its drawImage calls */
function recCtx() {
    const calls = [];
    const ctx = new Proxy({ calls }, {
        get: (o, k) => (k in o ? o[k] : k === 'drawImage' ? (img, ...a) => calls.push({ src: img && img.src, a }) : () => {}),
        set: (o, k, v) => { o[k] = v; return true; },
    });
    return ctx;
}

/** A room w×h: walls round it, floor within; opts lay things in it */
function room(w = 10, h = 8) {
    const tiles = [];
    for (let r = 0; r < h; r++) {
        tiles[r] = [];
        for (let q = 0; q < w; q++) {
            const wall = r === 0 || q === 0 || q === w - 1 || r === h - 1;
            tiles[r][q] = { q, r, baseTerrain: wall ? 'wall' : 'wood_floor', subTerrain: { passable: !wall }, explored: true, visible: true, _isInterior: true, _wallMaterial: 'plaster', _furniture: null };
        }
    }
    return tiles;
}
const T = (tiles, q, r) => tiles[r][q];
const R = (map, q, r) => lightAt(map, q, r)[0];
const lum = (map, q, r) => lightAt(map, q, r).reduce((a, b) => a + b, 0) / 3;

describe('the light map', () => {
    it('a hearth lights its room warm at night; let die (lit false), it gives nothing', () => {
        const tiles = room();
        T(tiles, 3, 1)._furniture = { type: 'fireplace' };
        const lit = interiorLightMap(tiles, 23, { art: ART });
        const [r, g, b] = lightAt(lit, 3, 2);
        expect(r).toBeGreaterThan(0.85);
        expect(r).toBeGreaterThan(b + 0.2);           // (warm)
        expect(g).toBeGreaterThan(0.5);
        // fading with distance
        expect(R(lit, 3, 2)).toBeGreaterThan(R(lit, 8, 6));
        T(tiles, 3, 1)._furniture.lit = false;
        const cold = interiorLightMap(tiles, 23, { art: ART });
        expect(R(cold, 3, 2)).toBeLessThan(0.5);
        // (undefined lit is lit, as before)
        T(tiles, 3, 1)._furniture.lit = undefined;
        expect(R(interiorLightMap(tiles, 23, { art: ART }), 3, 2)).toBeCloseTo(r, 5);
    });

    it('a hearth lights through a doorway but not through a wall', () => {
        const tiles = room(12, 8);
        for (let r = 1; r <= 6; r++) Object.assign(T(tiles, 5, r), { baseTerrain: 'wall', _innerWall: true });
        T(tiles, 3, 3)._furniture = { type: 'fireplace' };
        const shut = interiorLightMap(tiles, 23, { art: ART });
        const dark = R(shut, 7, 3);
        Object.assign(T(tiles, 5, 3), { _doorway: true });
        const open = interiorLightMap(tiles, 23, { art: ART });
        expect(R(open, 7, 3)).toBeGreaterThan(dark + 0.05);
    });

    it('candles: lit by _decorLit, else at night only', () => {
        const tiles = room();
        const base = interiorLightMap(tiles, 23, { art: ART });
        T(tiles, 6, 4)._furniture = { type: 'table' };
        T(tiles, 6, 4)._decor = ['candles', 'mugs'];
        expect(R(interiorLightMap(tiles, 23, { art: ART }), 6, 4)).toBeGreaterThan(R(base, 6, 4) + 0.15);
        // by day, unsaid: not lit
        const dayBase = interiorLightMap(room(), 12, { art: ART });
        expect(R(interiorLightMap(tiles, 12, { art: ART }), 6, 4)).toBeCloseTo(R(dayBase, 6, 4), 5);
        // by day, lit
        T(tiles, 6, 4)._decorLit = true;
        expect(R(interiorLightMap(tiles, 12, { art: ART }), 6, 4)).toBeGreaterThan(R(dayBase, 6, 4) + 0.05);
        // at night, put out
        T(tiles, 6, 4)._decorLit = false;
        expect(R(interiorLightMap(tiles, 23, { art: ART }), 6, 4)).toBeCloseTo(R(base, 6, 4), 5);
    });

    it('a window: a soft pool of daylight by day, nothing at night, nothing shuttered', () => {
        const tiles = room();
        const plain = interiorLightMap(tiles, 12, { art: ART });
        T(tiles, 4, 0)._wallDecor = 'window';
        const noon = interiorLightMap(tiles, 12, { art: ART });
        // brighter before it, cool (blue at least red's share), fading into the room
        expect(lum(noon, 4, 1)).toBeGreaterThan(lum(plain, 4, 1) + 0.1);
        expect(lum(noon, 4, 1)).toBeGreaterThan(lum(noon, 4, 4));
        expect(noon.add[(1 * noon.w + 4) * 3 + 2]).toBeGreaterThan(noon.add[(1 * noon.w + 4) * 3]);
        // dawn: some, less than noon
        const dawn = interiorLightMap(tiles, 6.5, { art: ART });
        expect(dawn.add[(1 * dawn.w + 4) * 3]).toBeGreaterThan(0);
        expect(dawn.add[(1 * dawn.w + 4) * 3]).toBeLessThan(noon.add[(1 * noon.w + 4) * 3]);
        // night: as though there were none
        const night = interiorLightMap(tiles, 23, { art: ART });
        const nightPlain = interiorLightMap(room(), 23, { art: ART });
        expect(lum(night, 4, 1)).toBeCloseTo(lum(nightPlain, 4, 1), 5);
        expect(Math.max(...night.add)).toBe(0);
        // shuttered: as though there were none
        T(tiles, 4, 0)._wallDecorState = 'shut';
        expect(lum(interiorLightMap(tiles, 12, { art: ART }), 4, 1)).toBeCloseTo(lum(plain, 4, 1), 5);
    });

    it('the pool is soft: no tile-to-tile stripes across it', () => {
        const tiles = room(14, 9);
        T(tiles, 7, 0)._wallDecor = 'window';
        const m = interiorLightMap(tiles, 12, { art: ART });
        // along a row through the pool: one rise to its middle and one fall (no bands), each
        // step a little (drawn smooth between the tiles' values)
        for (const r of [1, 2, 3]) {
            const row = [];
            for (let q = 1; q <= 12; q++) row.push(lum(m, q, r));
            let turns = 0;
            for (let i = 1; i < row.length - 1; i++) {
                const a = row[i] - row[i - 1], b = row[i + 1] - row[i];
                if (Math.abs(a) > 1e-4 && Math.abs(b) > 1e-4 && Math.sign(a) !== Math.sign(b)) turns++;
                expect(Math.abs(a)).toBeLessThan(0.12);
            }
            expect(turns, `row ${r}`).toBeLessThanOrEqual(1);
        }
    });

    it('corners are darker than the middle of the room; by day dimmer than the street', () => {
        const m = interiorLightMap(room(12, 10), 12, { art: ART });
        expect(lum(m, 1, 1)).toBeLessThan(lum(m, 6, 5) - 0.05);
        expect(lum(m, 6, 5)).toBeLessThan(0.95);
        expect(lum(m, 6, 5)).toBeGreaterThan(0.6);
    });

    it('wall torches and candle stands light after dark; sources found once per piece', () => {
        const tiles = room();
        T(tiles, 9, 4)._wallDecor = 'torch';
        T(tiles, 2, 5)._furniture = { type: 'candle' };
        T(tiles, 5, 5)._furniture = { type: 'fireplace', piece: { q: 5, r: 5, w: 2, h: 1, i: 0, j: 0 } };
        T(tiles, 6, 5)._furniture = { type: 'fireplace', piece: { q: 5, r: 5, w: 2, h: 1, i: 1, j: 0 } };
        const src = collectLightSources(tiles, ART);
        expect(src.filter(s => s.kind === 'fire').length).toBe(1);
        expect(src.find(s => s.kind === 'torch')).toBeTruthy();
        expect(sourceLit(src.find(s => s.kind === 'torch'), true)).toBe(true);
        expect(sourceLit(src.find(s => s.kind === 'torch'), false)).toBe(false);
        expect(sourceLit(src.find(s => s.kind === 'candleStand'), true)).toBe(true);
        // one tile of the piece put out, none said lit: out
        T(tiles, 6, 5)._furniture.lit = false;
        expect(sourceLit(collectLightSources(tiles, ART).find(s => s.kind === 'fire'), true)).toBe(false);
        expect(fireOut([T(tiles, 5, 5)._furniture, T(tiles, 6, 5)._furniture])).toBe(true);
    });

    it('the map is kept till something changes (the hour band, a flag)', () => {
        const tiles = room();
        T(tiles, 3, 1)._furniture = { type: 'fireplace' };
        InteriorLight.invalidate();
        const a = InteriorLight.update(tiles, 23, ART);
        expect(InteriorLight.update(tiles, 23.2, ART)).toBe(a);
        T(tiles, 3, 1)._furniture.lit = false;
        const b = InteriorLight.update(tiles, 23.2, ART);
        expect(b).not.toBe(a);
        expect(InteriorLight.update(tiles, 12, ART)).not.toBe(b);
    });
});

describe('one light pass indoors (no double darkening)', () => {
    const was = {};
    beforeEach(() => {
        Object.assign(was, { tiles: InnerMap.tiles, w: InnerMap.width, h: InnerMap.height, inside: InnerMap._insideBuilding, tod: InnerMap.timeOfDay, active: InnerMap.active, dark: LightSystem.ambientDarkness, pos: InnerMap.getPlayerWorldPos });
    });
    afterEach(() => {
        InnerMap.tiles = was.tiles; InnerMap.width = was.w; InnerMap.height = was.h; InnerMap._insideBuilding = was.inside;
        InnerMap.timeOfDay = was.tod; InnerMap.active = was.active; LightSystem.ambientDarkness = was.dark; InnerMap.getPlayerWorldPos = was.pos;
        vi.restoreAllMocks();
    });

    function setup(tiles, inside, hour) {
        InnerMap.tiles = tiles; InnerMap.width = tiles[0].length; InnerMap.height = tiles.length;
        InnerMap._insideBuilding = inside; InnerMap.timeOfDay = hour; InnerMap.active = true;
        InnerMap.getPlayerWorldPos = () => ({ x: 80, y: 80 });
        LightSystem.ambientDarkness = inside ? 0.3 : 0.85;
        const R2 = Object.create(InnerMapRenderer);
        R2._interiorArt = ART;
        const canvas = { width: 640, height: 480 };
        const camera = { zoom: 1, worldToScreenFast: (x, y) => ({ x, y }), getVisibleBounds: () => ({ left: 0, right: 640, top: 0, bottom: 480 }) };
        return { R2, canvas, camera };
    }

    it('indoors at night only the room\'s light is laid on; its multiplier is the whole of it', () => {
        const tiles = room();
        T(tiles, 3, 1)._furniture = { type: 'fireplace' };
        const { R2, canvas, camera } = setup(tiles, { type: 'house' }, 23);
        const spy = vi.spyOn(LightSystem, 'render').mockImplementation(() => {});
        expect(R2._renderLighting(recCtx(), canvas, camera, 16)).toBe('interior');
        expect(spy).not.toHaveBeenCalled();
        // the effective multiplier: the room's map alone (LightSystem's multiply never applied)
        const m = InteriorLight.update(tiles, 23, ART);
        const far = lightAt(m, 8, 6);
        // dark but readable, cool
        for (const c of far) { expect(c).toBeGreaterThan(0.2); expect(c).toBeLessThan(0.55); }
        expect(far[2]).toBeGreaterThan(far[0]);
        // firelit: warm and near full
        const near = lightAt(m, 3, 2);
        expect(near[0]).toBeGreaterThan(0.85);
        expect(near[0]).toBeGreaterThan(near[2]);
    });

    it('in a cave or a mine, and out on the street, LightSystem lights as before', () => {
        const spy = vi.spyOn(LightSystem, 'render').mockImplementation(() => {});
        const tiles = room();
        const street = setup(tiles.map(row => row.map(t => ({ ...t, _isInterior: false }))), null, 23);
        expect(street.R2._renderLighting(recCtx(), street.canvas, street.camera, 16)).toBe('lightSystem');
        const mine = setup(room(), { type: 'mine', _underground: { dark: 0.9 } }, 12);
        LightSystem.ambientDarkness = 0.9;
        expect(mine.R2._renderLighting(recCtx(), mine.canvas, mine.camera, 16)).toBe('lightSystem');
        expect(spy).toHaveBeenCalledTimes(2);
    });
});

describe('time on a room: soot, broken pieces, cold hearths, shutters', () => {
    function paint(tiles, hour = 12) {
        InnerMap.tiles = tiles; InnerMap.width = tiles[0].length; InnerMap.height = tiles.length;
        InnerMap.timeOfDay = hour;
        const R2 = Object.create(InnerMapRenderer);
        R2._interiorArt = ART;
        R2._interiorAfterRow = [];
        const sizes = new Map();
        R2._getSheetByPath = (p) => {
            if (!sizes.has(p)) { const b = fs.readFileSync(p); sizes.set(p, { src: p, width: b.readUInt32BE(16), height: b.readUInt32BE(20) }); }
            return sizes.get(p);
        };
        R2._sheetScale = () => 1;
        const ctx = recCtx();
        for (let r = 0; r < tiles.length; r++) {
            for (let q = 0; q < tiles[0].length; q++) R2._renderInteriorTile(ctx, tiles[r][q], q * 48, 40 + r * 48, 48);
            R2._flushInteriorRow();
        }
        return ctx;
    }

    it('soot on floors and walls, broken pieces (single and big), a hearth let die: drawn without throwing', () => {
        const tiles = room(12, 8);
        T(tiles, 3, 0)._soot = 1; T(tiles, 3, 1)._soot = 0.5; T(tiles, 4, 2)._soot = true; T(tiles, 0, 3)._soot = 0.7;
        T(tiles, 2, 3)._furniture = { type: 'chair', broken: true };
        T(tiles, 4, 4)._furniture = { type: 'table', broken: true, piece: { q: 4, r: 4, w: 2, h: 1, i: 0, j: 0 } };
        T(tiles, 5, 4)._furniture = { type: 'table', piece: { q: 4, r: 4, w: 2, h: 1, i: 1, j: 0 } };
        T(tiles, 3, 1)._furniture = { type: 'fireplace', lit: false };
        T(tiles, 8, 1)._furniture = { type: 'fireplace', lit: false, piece: { q: 8, r: 1, w: 2, h: 1, i: 0, j: 0 } };
        T(tiles, 9, 1)._furniture = { type: 'fireplace', lit: false, piece: { q: 8, r: 1, w: 2, h: 1, i: 1, j: 0 } };
        T(tiles, 6, 6)._furniture = { type: 'oven', lit: false, broken: true };
        T(tiles, 7, 6)._furniture = { type: 'no_such_piece', broken: true };
        expect(() => paint(tiles)).not.toThrow();
        expect(() => paint(tiles, 23)).not.toThrow();
        expect(sootOf({ _soot: true })).toBeGreaterThan(0);
        expect(sootOf({ _soot: 3 })).toBe(1);
        expect(sootOf({})).toBe(0);
        expect(() => drawSoot(recCtx(), { q: 1, r: 1, _soot: 'lots' }, 0, 0, 48, null)).not.toThrow();
    });

    it('a broken piece is drawn darkened over itself (its sprite twice)', () => {
        const tiles = room();
        T(tiles, 2, 3)._furniture = { type: 'chair' };
        const whole = paint(tiles).calls.filter(c => c.src === ART.furniture.chair.sheet).length;
        T(tiles, 2, 3)._furniture.broken = true;
        expect(paint(tiles).calls.filter(c => c.src === ART.furniture.chair.sheet).length).toBe(whole + 1);
    });

    it('a shuttered window shows its shutters (the art\'s shut cell)', () => {
        for (const id of ['window', 'curtains']) {
            const a = ART.wallDecor[id];
            expect(a.shut, id).toBeTruthy();
            const b = fs.readFileSync(a.sheet);
            expect(a.shut.sx + a.shut.sw).toBeLessThanOrEqual(b.readUInt32BE(16));
            expect(a.shut.sy + a.shut.sh).toBeLessThanOrEqual(b.readUInt32BE(20));
        }
        const tiles = room();
        T(tiles, 4, 0)._wallDecor = 'window';
        T(tiles, 4, 0)._wallDecorState = 'shut';
        const s = ART.wallDecor.window.shut;
        const call = paint(tiles, 23).calls.find(c => c.src === ART.wallDecor.window.sheet && c.a[0] === s.sx && c.a[1] === s.sy);
        expect(call).toBeTruthy();
        // a side wall's window, shut: drawn too
        T(tiles, 0, 3)._wallDecor = 'window'; T(tiles, 0, 3)._wallDecorState = 'shut';
        expect(() => paint(tiles, 23)).not.toThrow();
    });
});

describe('inner walls north–south', () => {
    // A wall tile's shape (drawInnerWall's W.geom): its cap and face rectangles
    function shape(tiles, q, r, sz = 48) {
        InnerMap.tiles = tiles; InnerMap.width = tiles[0].length; InnerMap.height = tiles.length;
        const tile = T(tiles, q, r);
        const W = { ctx: recCtx(), img: { src: 'x' }, kb: 1, mat: ART.walls.plaster, tile, at: (dq, dr) => InnerMap.getTile(q + dq, r + dr), dx: 0, dy: 0, sz, geom: {} };
        const face = drawInnerWall(W, () => {});
        return { ...W.geom, face: W.geom.face, faceOut: face };
    }
    const c = Math.max(2, Math.round(48 * CAP));
    const cx0 = Math.round((48 - c) / 2);
    // a room with a run down q=5 (r 1..6), a doorway at r=3, a run east from (5,5) to the wall, a stub at q=8 (r 2..3)
    function walls() {
        const tiles = room(12, 9);
        for (let r = 1; r <= 7; r++) Object.assign(T(tiles, 5, r), { baseTerrain: 'wall', _innerWall: true });
        T(tiles, 5, 3)._doorway = true;
        for (let q = 6; q <= 10; q++) Object.assign(T(tiles, q, 5), { baseTerrain: 'wall', _innerWall: true });
        Object.assign(T(tiles, 8, 2), { baseTerrain: 'wall', _innerWall: true });
        Object.assign(T(tiles, 8, 3), { baseTerrain: 'wall', _innerWall: true });
        return tiles;
    }

    it('a run going on: one cap down the middle the tile\'s whole height, the same width, no face', () => {
        const g = shape(walls(), 5, 6);
        const xs = new Set(g.cap.map(([x]) => x)), ws = new Set(g.cap.map(([, , w]) => w));
        expect([...xs]).toEqual([cx0]);
        expect([...ws]).toEqual([c]);
        const top = Math.min(...g.cap.map(([, y]) => y)), bottom = Math.max(...g.cap.map(([, y, , h]) => y + h));
        expect(top).toBe(0);
        expect(bottom).toBe(48);
        expect(g.face.length).toBe(0);
    });

    it('its end (a doorway or nothing south of it): the cap stops a cap\'s depth down, its end face below in shade, no hanging face', () => {
        const g = shape(walls(), 5, 2);   // (the doorway at 5,3 below it)
        expect(Math.max(...g.cap.map(([, y, , h]) => y + h))).toBe(c);
        expect(g.face).toEqual([[cx0, c, c, 48 - c]]);
        expect(g.faceOut).toBe(null);
        const stub = shape(walls(), 8, 3);
        expect(stub.face).toEqual([[cx0, c, c, 48 - c]]);
    });

    it('a T (a run east joining it): the head strip to the tile\'s edge, the run on down, a face beside it', () => {
        const g = shape(walls(), 5, 5);
        // the head reaches the east edge at the cap's depth
        expect(g.cap).toContainEqual([cx0, 0, 48 - cx0, c]);
        // the run on south, the same width
        expect(g.cap).toContainEqual([cx0, c, c, 48 - c]);
        // the face east of the run, under the head
        expect(g.face).toContainEqual([cx0 + c, c, 48 - cx0 - c, 48 - c]);
        expect(g.faceOut).toBeTruthy();
    });

    it('an east–west run meeting it from the side at its foot (an L): one shape, faces under it', () => {
        const g = shape(walls(), 10, 5);   // (the run's east end meets the outside wall)
        expect(g.cap).toContainEqual([0, 0, 48, c]);
        expect(g.face).toContainEqual([0, c, 48, 48 - c]);
    });

    it('the doorway in it is drawn as floor, an opening', () => {
        const tiles = walls();
        InnerMap.tiles = tiles; InnerMap.width = 12; InnerMap.height = 9;
        const R2 = Object.create(InnerMapRenderer);
        R2._interiorArt = ART; R2._interiorAfterRow = [];
        R2._getSheetByPath = (p) => ({ src: p, width: 2048, height: 2048 });
        R2._sheetScale = () => 1;
        const ctx = recCtx();
        R2._renderInteriorTile(ctx, T(tiles, 5, 3), 0, 0, 48);
        // the floor's one cell and nothing of the wall (its cap and face are drawn from more)
        expect(ctx.calls.length).toBe(1);
        expect(ctx.calls[0].a.slice(4)).toEqual([0, 0, 48, 48]);
    });
});

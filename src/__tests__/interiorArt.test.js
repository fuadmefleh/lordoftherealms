// A room dressed (ui/interiorDress.js, drawn by ui/innerMapLayers/terrainRoads.js): every
// thing the room planner may set — what lies on a table (tile._decor), what hangs on a wall
// (tile._wallDecor), the smaller furniture — has its art in data/innerMapRenderer.json
// interiorArt, inside its sheet; the renderer draws a room holding all of them (inner walls,
// doorways, the door) without throwing, and a room with none of them as before.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import { InnerMap } from '../world/innerMap.js';
import { LightSystem } from '../ui/lightSystem.js';
import { asIds, artFor, daylight, wallSides } from '../ui/interiorDress.js';
import '../ui/innerMapLayers.js';

const ART = JSON.parse(fs.readFileSync('data/innerMapRenderer.json', 'utf8')).interiorArt;

const DECOR = ['mugs', 'plates', 'bread', 'candles', 'books', 'papers', 'pots', 'fruit', 'cloth', 'tools', 'flowers', 'bottles', 'bowls', 'coins', 'herbs'];
const WALL_DECOR = ['window', 'shelf', 'torch', 'painting', 'banner', 'curtains', 'mirror', 'antlers', 'hanging_pots', 'hanging_herbs', 'weapon_rack', 'map', 'tapestry', 'clock'];
const FURNITURE = ['dresser', 'cupboard', 'workbench', 'loom', 'spinning_wheel', 'basket', 'firewood', 'plant', 'washstand', 'chair', 'wardrobe', 'cradle', 'sack_pile', 'crate_stack', 'barrel_rack', 'coat_rack'];

const sizes = new Map();
function pngSize(p) {
    if (!sizes.has(p)) {
        const b = fs.readFileSync(p);
        sizes.set(p, { width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
    }
    return sizes.get(p);
}

function inSheet(e, label) {
    expect(e, label).toBeTruthy();
    expect(fs.existsSync(e.sheet), `${label}: ${e.sheet}`).toBe(true);
    const { width, height } = pngSize(e.sheet);
    const cells = [e, ...(e.variants || []).map(v => ({ ...e, ...v })), ...(e.night ? [{ ...e, ...e.night }] : [])];
    for (const c of cells) {
        expect(c.sw > 0 && c.sh > 0, `${label}: a size`).toBe(true);
        expect(c.sx >= 0 && c.sy >= 0 && c.sx + c.sw <= width && c.sy + c.sh <= height, `${label}: within ${e.sheet}`).toBe(true);
    }
}

/** A 2D context drawing nothing, remembering which sheets it drew from */
function recCtx() {
    const drawn = [];
    const ctx = new Proxy({ drawn }, {
        get: (o, k) => (k in o ? o[k] : k === 'drawImage' ? (img) => drawn.push(img.src) : () => {}),
        set: (o, k, v) => { o[k] = v; return true; },
    });
    return ctx;
}

function room(w = 12, h = 10, dress = true) {
    const tiles = [];
    for (let r = 0; r < h; r++) {
        tiles[r] = [];
        for (let q = 0; q < w; q++) {
            const door = r === h - 1 && q === 6;
            const wall = !door && (r === 0 || q === 0 || q === w - 1 || r === h - 1);
            tiles[r][q] = { q, r, baseTerrain: wall ? 'wall' : 'wood_floor', subTerrain: { passable: !wall }, explored: true, visible: true, _isInterior: true, _wallMaterial: 'plaster', _furniture: null };
            if (door) tiles[r][q]._isDoor = true;
        }
    }
    if (!dress) return tiles;
    const T = (q, r) => tiles[r][q];
    for (let q = 1; q <= 5; q++) Object.assign(T(q, 5), { baseTerrain: 'wall', _innerWall: true });
    Object.assign(T(3, 5), { _doorway: true });
    for (let r = 6; r <= 8; r++) Object.assign(T(5, r), { baseTerrain: 'wall', _innerWall: true });
    WALL_DECOR.forEach((d, i) => { T(1 + (i % 10), 0)._wallDecor = i < 10 ? d : [d, 'torch']; });
    T(1, 5)._wallDecor = 'tapestry'; T(4, 5)._wallDecor = ['clock', 'map'];
    T(0, 3)._wallDecor = 'window'; T(11, 3)._wallDecor = 'torch'; T(2, 9)._wallDecor = 'curtains'; T(9, 9)._wallDecor = 'painting';
    FURNITURE.forEach((f, i) => { T(1 + (i % 10), i < 10 ? 2 : 3)._furniture = { type: f }; });
    T(6, 7)._furniture = { type: 'table', piece: { w: 2, h: 1, i: 0, j: 0 } };
    T(7, 7)._furniture = { type: 'table', piece: { w: 2, h: 1, i: 1, j: 0 } };
    T(6, 7)._decor = DECOR.slice(0, 4); T(7, 7)._decor = [{ type: 'fruit' }, 'bowl'];
    T(8, 7)._furniture = { type: 'table' }; T(8, 7)._decor = DECOR.slice(4);
    T(1, 2)._decor = ['books', 'flowers'];   // (on the dresser)
    return tiles;
}

function paint(tiles, { loading = null } = {}) {
    InnerMap.tiles = tiles; InnerMap.width = tiles[0].length; InnerMap.height = tiles.length;
    const R = Object.create(InnerMapRenderer);
    R._interiorArt = ART;
    R._interiorAfterRow = [];
    R._getSheetByPath = (p) => (p === loading ? null : { src: p, ...pngSize(p) });
    R._sheetScale = () => 1;
    const ctx = recCtx();
    for (let r = 0; r < tiles.length; r++) {
        for (let q = 0; q < tiles[0].length; q++) R._renderInteriorTile(ctx, tiles[r][q], 100 + q * 48, 100 + r * 48, 48);
        R._flushInteriorRow();
    }
    return ctx.drawn;
}

describe('the art of a dressed room', () => {
    it('every decor, wall decor and new furniture id has art inside its sheet', () => {
        for (const id of DECOR) inSheet(ART.decor[id], `decor ${id}`);
        for (const id of WALL_DECOR) inSheet(ART.wallDecor[id], `wallDecor ${id}`);
        for (const id of FURNITURE) inSheet(ART.furniture[id], `furniture ${id}`);
        // (every entry, contract or not, lies within its sheet)
        for (const [g, d] of Object.entries({ decor: ART.decor, wallDecor: ART.wallDecor, furniture: ART.furniture })) {
            for (const [id, e] of Object.entries(d)) if (e.sheet) inSheet(e, `${g} ${id}`);
        }
    });

    it('the new sheet is small, and its credits are kept beside it', () => {
        expect(fs.statSync('assets/buildingKit/interior_decor.png').size).toBeLessThan(1024 * 1024);
        const credits = fs.readFileSync('assets/buildingKit/interior_decor_CREDITS.txt', 'utf8');
        expect(credits).toMatch(/OGA-BY 3\.0/);
        expect(credits).toMatch(/Lanea Zimmerman/);
    });

    it('a window darkens at night, a painting has more than one look', () => {
        expect(ART.wallDecor.window.night).toBeTruthy();
        expect(ART.wallDecor.painting.variants.length).toBeGreaterThan(1);
        expect(daylight(12)).toBe(1);
        expect(daylight(1)).toBe(0);
        expect(daylight(6.5)).toBeGreaterThan(0);
        expect(daylight(6.5)).toBeLessThan(1);
    });

    it('ids are read from a string, a list, or objects; plural or singular', () => {
        expect(asIds('mugs')).toEqual(['mugs']);
        expect(asIds(['mugs', { type: 'bread' }, { id: 'coins' }, null])).toEqual(['mugs', 'bread', 'coins']);
        expect(asIds(undefined)).toEqual([]);
        expect(artFor(ART.decor, 'mug')).toBe(ART.decor.mugs);
        expect(artFor(ART.decor, 'candle')).toBe(ART.decor.candles);
        expect(artFor(ART.decor, 'no_such_thing')).toBe(null);
    });
});

describe('drawing a dressed room', () => {
    beforeEach(() => { InnerMap.timeOfDay = 12; });

    it('draws every wall, floor, piece and thing in it without throwing', () => {
        const drawn = paint(room());
        const decorDraws = drawn.filter(s => s === 'assets/buildingKit/interior_decor.png').length;
        // every decor id (15), wall decor on the faces, and the new furniture from the sheet
        expect(decorDraws).toBeGreaterThan(DECOR.length + 10 + 14);
        expect(drawn).toContain('assets/buildingKit/interior_shell.png');
        expect(drawn).toContain(ART.door.sheet);
    });

    it('at night too (the windows dark), and whatever is unknown is passed over', () => {
        InnerMap.timeOfDay = 23;
        const tiles = room();
        tiles[0][3]._wallDecor = 'no_such_thing';
        tiles[2][2]._decor = ['no_such_thing', 'mugs'];
        expect(() => paint(tiles)).not.toThrow();
    });

    it('a room with none of it draws as before; a sheet still loading is waited for', () => {
        expect(() => paint(room(8, 7, false))).not.toThrow();
        expect(() => paint(room(), { loading: 'assets/buildingKit/interior_decor.png' })).not.toThrow();
    });

    it('the walls are told apart: the back, sides and front of the room, and walls within it', () => {
        const tiles = room();
        InnerMap.tiles = tiles; InnerMap.width = 12; InnerMap.height = 10;
        expect(wallSides(tiles[0][4])).toMatchObject({ top: true, left: false });
        expect(wallSides(tiles[4][0])).toMatchObject({ left: true });
        expect(wallSides(tiles[9][4])).toMatchObject({ bottom: true });
        expect(wallSides(tiles[5][2])).toBe(null);   // (_innerWall)
    });

    it('a torch on the wall and candles on a table give light indoors', () => {
        const tiles = room();
        InnerMap.tiles = tiles; InnerMap.width = 12; InnerMap.height = 10;
        const was = { active: InnerMap.active, inside: InnerMap._insideBuilding, pos: InnerMap.getPlayerWorldPos };
        InnerMap.active = true; InnerMap._insideBuilding = { type: 'house' };
        InnerMap.getPlayerWorldPos = () => ({ x: 100, y: 100 });
        LightSystem.ambientDarkness = 0.3;
        const camera = {
            zoom: 1,
            getVisibleBounds: () => ({ left: 0, right: 12 * 32, top: 0, bottom: 10 * 32 }),
            worldToScreenFast: (x, y) => ({ x, y }),
        };
        try {
            LightSystem.collectLights(camera);
            const torches = LightSystem._lights.filter(l => l.type === 'torch');
            // the torches on the walls (14th wall decor + the side wall's), the candles on the table
            expect(torches.length).toBeGreaterThanOrEqual(3);
        } finally {
            InnerMap.active = was.active; InnerMap._insideBuilding = was.inside; InnerMap.getPlayerWorldPos = was.pos;
        }
    });
});

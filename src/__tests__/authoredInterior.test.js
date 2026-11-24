// Hand-authored interiors (interior_editor.html → CustomInteriors → interiors.js
// _generateCustomInterior) given what a planned room has (world/innerMap/authoredInterior.js):
// inner walls and doorways, decor, wall decor and windows (faced into the room), rooms and the
// door; then the hour's layer (interiorState.js) lights their fires and candles and shutters
// their windows, the light model (ui/interiorLight.js) finds them, and the sprite renderer
// draws them (ui/innerMapLayers/authoredInterior.js). Older interiors without any of it load
// as they did.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { CustomInteriors } from '../world/customInteriors.js';
import { dressAuthoredTiles, authoredIds, authoredFace } from '../world/innerMap/authoredInterior.js';
import { applyInteriorStateTo, revertInteriorState } from '../world/innerMap/interiorState.js';
import { collectLightSources, interiorLightMap, lightAt } from '../ui/interiorLight.js';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import { authoredFaceBox } from '../ui/innerMapLayers/authoredInterior.js';
import '../ui/innerMapLayers.js';

const ART = JSON.parse(fs.readFileSync('data/innerMapRenderer.json', 'utf8')).interiorArt;
const SHEET = 'assets/lpc/Structure/Floor/floors.png';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

/**
 * An authored interior as the editor exports it: 9×7, the editor's grid offset by (2, 1)
 * (bounds), sprite walls round it, a door at the bottom, an inner wall down column 5 with a
 * doorway, a hearth, a table with candles, a window, a torch and curtained front window.
 */
function rawDef(extra = {}, metaExtra = true) {
    const W = 9, H = 7, OQ = 2, OR = 1;
    const floor = [], walls = [], meta = [];
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) {
        const cell = { q: q + OQ, r: r + OR, sheetPath: SHEET, sx: 0, sy: 0, sw: 32, sh: 32 };
        if (q === 0 || r === 0 || q === W - 1 || r === H - 1) { if (!(q === 4 && r === H - 1)) walls.push(cell); }
        floor.push(cell);
    }
    const M = (q, r, m) => meta.push({ q: q + OQ, r: r + OR, ...m });
    M(4, 6, { door: true });
    M(2, 1, { furniture: { type: 'fireplace', name: 'Fireplace', icon: '🔥', passable: false }, impassable: true });
    M(2, 3, { furniture: { type: 'table', name: 'Table', icon: '🪑', passable: false }, impassable: true, ...(metaExtra ? { decor: ['candles', 'bread'] } : {}) });
    if (metaExtra) {
        for (const r of [1, 2, 4, 5]) M(5, r, { innerWall: true });
        M(5, 3, { doorway: true });
        M(6, 2, { room: 'Kitchen' });
        M(3, 0, { wallDecor: 'window' });                          // (its face worked out: the room below)
        M(0, 2, { wallDecor: 'torch', wallDecorFace: 'right' });
        M(2, 6, { wallDecor: ['curtains'] });                      // (the front wall: faces up)
        M(7, 0, { wallDecor: 'painting' });
        M(6, 4, { decor: 'flowers' });                             // (on the bare floor)
    }
    return { id: `authored_${Object.keys(extra).join('_') || 'test'}${metaExtra ? '' : '_old'}`, name: 'Test Hall', buildingType: 'house',
        layers: { floor, walls }, meta, bounds: { minCol: OQ, minRow: OR, maxCol: OQ + W - 1, maxRow: OR + H - 1 }, ...extra };
}

function load(extra = {}, metaExtra = true) {
    const raw = rawDef(extra, metaExtra);
    CustomInteriors.registerInterior(raw);
    const def = CustomInteriors.getInterior(raw.id);
    const building = { type: 'house', name: 'House', q: 5, r: 6 };
    return { def, building, room: InnerMap._generateCustomInterior(def, building) };
}
const T = (room, q, r) => room.tiles[r][q];

describe('an authored interior carries the new things', () => {
    it('inner walls stand and block; doorways open; drawn in the interior\'s wall', () => {
        const { room } = load({ wallMaterial: 'timber' });
        for (const r of [1, 2, 4, 5]) {
            const t = T(room, 5, r);
            expect(t._innerWall).toBe(true);
            expect(t.baseTerrain).toBe('wall');
            expect(t.subTerrain.passable).toBe(false);
            expect(t._wallMaterial).toBe('timber');
        }
        const d = T(room, 5, 3);
        expect(d._doorway).toBe(true);
        expect(d._innerWall).toBeUndefined();
        expect(d.subTerrain.passable).toBe(true);
    });

    it('with no wall named, the drawn walls take the building\'s own inside wall', () => {
        const { room } = load({ variant: 'own' });
        expect(typeof T(room, 5, 1)._wallMaterial).toBe('string');
        expect(ART.walls[T(room, 5, 1)._wallMaterial] || ART.walls[ART.defaultWall]).toBeTruthy();
    });

    it('decor, wall decor and windows, each faced into its room', () => {
        const { room } = load();
        expect(authoredIds(T(room, 2, 3)._decor)).toEqual(['candles', 'bread']);
        expect(T(room, 6, 4)._decor).toBe('flowers');
        expect(T(room, 3, 0)._wallDecor).toBe('window');
        expect(T(room, 3, 0)._wallDecorFace).toBe('down');
        expect(T(room, 0, 2)._wallDecor).toBe('torch');
        expect(T(room, 0, 2)._wallDecorFace).toBe('right');
        expect(T(room, 2, 6)._wallDecor).toBe('curtains');
        expect(T(room, 2, 6)._wallDecorFace).toBe('up');
    });

    it('its rooms by its walls and doorways, a named one by its name; its door', () => {
        const { room } = load();
        expect(room.rooms.length).toBe(2);
        expect(room.rooms.map(r => r.name).sort()).toEqual(['Kitchen', 'Main room']);
        expect(T(room, 2, 2)._room).toBe('Main room');
        expect(T(room, 6, 2)._room).toBe('Kitchen');
        expect(T(room, 6, 2)._roomId).toBe('kitchen');
        expect(T(room, 5, 3)._room).toBeUndefined();
        expect(room.door).toEqual({ q: 4, r: 6 });
        expect(InnerMap._interiorDoorOf(room)).toEqual({ q: 4, r: 6 });
    });

    it('each interior its own copy of a piece: marking it never touches the design', () => {
        const { def, room } = load();
        T(room, 2, 1)._furniture.lit = false;
        T(room, 2, 1)._furniture.broken = true;
        const m = def._metaMap[`${2 + 2},${1 + 1}`];
        expect(m.furniture.lit).toBeUndefined();
        expect(m.furniture.broken).toBeUndefined();
        expect(load().room.tiles[1][2]._furniture.broken).toBeUndefined();
    });

    it('an older interior with none of it loads as before (one room, no decor), its door found', () => {
        const { room } = load({}, false);
        const flat = room.tiles.flat();
        expect(flat.some(t => t._innerWall || t._doorway || t._decor || t._wallDecor)).toBe(false);
        expect(room.rooms.length).toBe(1);
        expect(T(room, 2, 1)._furniture.type).toBe('fireplace');
        expect(room.door).toEqual({ q: 4, r: 6 });
    });

    it('the pure bridge: unknown faces are worked out, decor never on a wall, a wall decor never on floor', () => {
        const mk = (bt) => ({ baseTerrain: bt, subTerrain: { passable: bt !== 'wall' } });
        const tiles = [[mk('wall'), mk('wall'), mk('wall')], [mk('wall'), mk('custom_floor'), mk('wall')], [mk('wall'), mk('wall'), mk('wall')]];
        const meta = { '1,0': { wallDecor: 'map', wallDecorFace: 'sideways', decor: 'mugs' }, '1,1': { wallDecor: 'clock', decor: [{ type: 'bowls' }, 'bowls'] } };
        const out = dressAuthoredTiles(tiles, 3, 3, (q, r) => meta[`${q},${r}`]);
        expect(tiles[0][1]._wallDecorFace).toBe('down');
        expect(tiles[0][1]._decor).toBeUndefined();
        expect(tiles[1][1]._wallDecor).toBeUndefined();
        expect(tiles[1][1]._decor).toBe('bowls');
        expect(out.rooms).toEqual([{ id: 'main_room', name: 'Main room', cells: 1 }]);
        expect(authoredFace(tiles, 0, 1)).toBe('right');
        expect(authoredFace(tiles, 0, 0)).toBe(null);
    });
});

describe('the hour, the light and the drawing work in an authored room', () => {
    const ctxAt = (room, hour, day = 40) => ({ key: 'authored_test', building: { type: 'house', name: 'House', q: 5, r: 6 }, hour, day });

    it('the hearth lit of a morning, candles after dark, the windows shuttered at night; taken off again', () => {
        const { room } = load();
        const before = JSON.stringify(room.tiles.flat().map(t => [t._furniture, t._decor, t._wallDecorState, t._decorLit]));
        applyInteriorStateTo(room.tiles, room.width, room.height, ctxAt(room, 7));
        expect(T(room, 2, 1)._furniture.lit).toBe(true);
        applyInteriorStateTo(room.tiles, room.width, room.height, ctxAt(room, 20));
        expect(T(room, 2, 3)._decorLit).toBe(true);
        applyInteriorStateTo(room.tiles, room.width, room.height, ctxAt(room, 23));
        expect(T(room, 3, 0)._wallDecorState).toBe('shut');
        expect(T(room, 2, 6)._wallDecorState).toBe('shut');
        revertInteriorState(room.tiles);
        expect(JSON.stringify(room.tiles.flat().map(t => [t._furniture, t._decor, t._wallDecorState, t._decorLit]))).toBe(before);
    });

    it('the light model finds its window, torch, candles and hearth, and the inner wall holds the fire\'s light back', () => {
        const { room } = load();
        const kinds = collectLightSources(room.tiles, ART).map(s => s.kind).sort();
        expect(kinds).toEqual(expect.arrayContaining(['window', 'torch', 'candle', 'fire']));
        // by day the window's pool brightens the floor below it beyond the room's far corner
        const day = interiorLightMap(room.tiles, 12, { art: ART });
        expect(lightAt(day, 3, 1)[0]).toBeGreaterThan(lightAt(day, 7, 5)[0]);
        // at night the lit hearth warms its own side more than the far side of the inner wall
        T(room, 2, 1)._furniture.lit = true;
        const night = interiorLightMap(room.tiles, 22, { art: ART });
        expect(lightAt(night, 3, 1)[0]).toBeGreaterThan(lightAt(night, 7, 1)[0]);
    });

    it('drawn by the sprite renderer: the inner wall in its material, decor and wall decor from the decor sheet', () => {
        const { room } = load({ wallMaterial: 'timber', v: 2 });
        const was = { tiles: InnerMap.tiles, w: InnerMap.width, h: InnerMap.height, tod: InnerMap.timeOfDay };
        InnerMap.tiles = room.tiles; InnerMap.width = room.width; InnerMap.height = room.height; InnerMap.timeOfDay = 21;
        const R = Object.create(InnerMapRenderer);
        R._interiorArt = ART;
        R._interiorAfterRow = [];
        R._getSheetByPath = (p) => ({ src: p, width: 512, height: 512 });
        R._sheetScale = () => 1;
        const drawn = [];
        const ctx = new Proxy({}, {
            get: (o, k) => (k in o ? o[k] : k === 'drawImage' ? (img) => drawn.push(img && img.src) : () => {}),
            set: (o, k, v) => { o[k] = v; return true; },
        });
        try {
            for (let r = 0; r < room.height; r++) {
                for (let q = 0; q < room.width; q++) R._renderInteriorTile(ctx, room.tiles[r][q], q * 48, 40 + r * 48, 48);
                R._flushInteriorRow();
            }
        } finally {
            InnerMap.tiles = was.tiles; InnerMap.width = was.w; InnerMap.height = was.h; InnerMap.timeOfDay = was.tod;
        }
        expect(drawn).toContain(ART.walls.timber.sheet);
        const decor = drawn.filter(s => s === 'assets/buildingKit/interior_decor.png').length;
        // window, torch, curtains, painting, candles, bread, flowers (a typed piece with no sprite: its own art)
        expect(decor).toBeGreaterThanOrEqual(7);
        expect(drawn).toContain(ART.furniture.fireplace.sheet);
    });

    it('a sprite wall\'s face for what hangs on it, by the side its room lies', () => {
        expect(authoredFaceBox('down', 0, 0, 48, 0).kind).toBe('back');
        expect(authoredFaceBox('down', 0, 96, 48, 2).kind).toBe('inner');
        expect(authoredFaceBox('right', 0, 0, 48).kind).toBe('left');
        expect(authoredFaceBox('left', 0, 0, 48).kind).toBe('right');
        expect(authoredFaceBox('up', 0, 0, 48).kind).toBe('front');
    });
});

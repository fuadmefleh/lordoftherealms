/**
 * Blocked tile sides: an interior floor tile can be stood on while one of its
 * edges can't be crossed (e.g. the frame of an ornate rug or a stage's rim).
 * The interior editor sets them per tile (meta.blockSides) and per 9-tile
 * brush slot (exported as meta.brushSides); the game carries them onto
 * tile.blockedSides and every step (keyboard, A*, walk animation) honours them.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import '../../editor-core.js';
import { sidesMask, sidesString, outerSidesForSlot, stepBlockedBySides, brushSlotSides } from '../core/tileSides.js';
import { generateSpriteInterior } from '../world/interiorGenerator.js';
import { InnerMap } from '../world/innerMap.js';
import { CustomInteriors } from '../world/customInteriors.js';

let EC;
beforeAll(() => {
    EC = globalThis.EditorCore;
});

describe('side rules (game and editor agree)', () => {
    it('parses and prints sides the same way', () => {
        for (const spec of ['', 'n', 'nw', 'wn', 'NESW', 'sx', ['e', 's'], 5, 0]) {
            expect(EC.sidesMask(spec)).toBe(sidesMask(spec));
        }
        for (let m = 0; m < 16; m++) expect(EC.sidesString(m)).toBe(sidesString(m));
        expect(sidesString(sidesMask('wn'))).toBe('nw');
    });

    it('gives each 9-tile slot its outer sides', () => {
        const want = [['nw', 'n', 'ne'], ['w', '', 'e'], ['sw', 's', 'se']];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            expect(sidesMask(outerSidesForSlot(r, c))).toBe(sidesMask(want[r][c]));
            expect(EC.outerSidesForSlot(r, c)).toBe(outerSidesForSlot(r, c));
        }
    });

    it('blocks a step across a blocked side from either tile', () => {
        const N = sidesMask('n');
        // Leaving northward across my own north side
        expect(stepBlockedBySides(N, 0, 0, -1)).toBe(true);
        // Arriving from the north onto a tile whose north side is blocked
        expect(stepBlockedBySides(0, N, 0, 1)).toBe(true);
        // Sideways along the rim is fine
        expect(stepBlockedBySides(N, N, 1, 0)).toBe(false);
        // A diagonal is blocked if either of its sides is
        expect(stepBlockedBySides(N, 0, 1, -1)).toBe(true);
        expect(stepBlockedBySides(0, 0, 1, 1)).toBe(false);
    });

    it('editor helpers pick a side from where you click, and toggle it', () => {
        expect(EC.sideAtPoint(0.5, 0.05)).toBe('n');
        expect(EC.sideAtPoint(0.97, 0.5)).toBe('e');
        expect(EC.sideAtPoint(0.5, 0.5)).toBeNull();
        expect(EC.toggleSide('n', 'w')).toBe('nw');
        expect(EC.toggleSide('nw', 'n')).toBe('w');
        expect(EC.toggleSide('w', 'w', true)).toBe('w');
    });
});

// A 5×4 open room; the middle row's north edge (r=1) is a rim nobody crosses.
function fakeMap(w, h, sidesAt) {
    const tiles = [];
    for (let r = 0; r < h; r++) {
        tiles.push([]);
        for (let q = 0; q < w; q++) {
            tiles[r].push({ q, r, subTerrain: { passable: true }, blockedSides: sidesAt(q, r) });
        }
    }
    return Object.assign(Object.create(InnerMap), { width: w, height: h, tiles, playerInnerQ: 0, playerInnerR: 0 });
}

describe('movement honours blocked sides', () => {
    it('A* walks around a rim it cannot cross', () => {
        // Row 1 has its north side blocked from q=0..3; q=4 is the gap
        const map = fakeMap(5, 4, (q, r) => (r === 1 && q < 4 ? sidesMask('n') : 0));
        const path = map._findPath(1, 0, 1, 2);
        expect(path).not.toBeNull();
        // It must go through the gap at q=4 to get from row 0 to row 1
        const crossing = path.findIndex((p, i) => i > 0 && path[i - 1].r === 0 && p.r === 1);
        expect(path[crossing].q).toBe(4);
        // Without the rim it goes straight down
        const open = fakeMap(5, 4, () => 0)._findPath(1, 0, 1, 2);
        expect(open.length).toBe(3);
    });

    it('a fully enclosed rim has no path in', () => {
        const map = fakeMap(5, 4, (q, r) => (r === 1 ? sidesMask('n') : 0));
        expect(map._findPath(1, 0, 1, 2)).toBeNull();
    });

    it('the player can stand on a rim tile but not step across its edge', () => {
        const map = fakeMap(3, 3, (q, r) => (r === 1 ? sidesMask('n') : 0));
        map.playerInnerQ = 1; map.playerInnerR = 1;
        map.cancelPlayerWalk = () => {};
        map._revealAround = () => {};
        expect(map.movePlayer(0, -1).moved).toBe(false);
        expect(map.movePlayer(1, 0).moved).toBe(true);
        map.playerInnerQ = 1; map.playerInnerR = 0;
        expect(map.movePlayer(0, 1).moved).toBe(false);
    });
});

describe('custom interiors carry sides onto tiles', () => {
    it('unions hand-set sides and brush edge sides', () => {
        const cell = (q, r) => ({ q, r, sheetPath: 'assets/test/floor.png', sx: 0, sy: 0 });
        const floor = [];
        for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) floor.push(cell(q, r));
        CustomInteriors.registerInterior({
            id: 'test_rim_room',
            buildingType: 'test_rim',
            layers: { floor },
            meta: [
                { q: 0, r: 0, brushSides: 'nw' },
                { q: 1, r: 0, brushSides: 'n', blockSides: 's' },
            ],
        });
        const def = CustomInteriors.getInterior('test_rim_room');
        const { tiles } = InnerMap._generateCustomInterior(def, { type: 'test_rim', q: 0, r: 0 });
        expect(tiles[0][0].blockedSides).toBe(sidesMask('nw'));
        expect(tiles[0][1].blockedSides).toBe(sidesMask('ns'));
        expect(tiles[1][1].blockedSides).toBe(0);
        expect(tiles[0][0].subTerrain.passable).toBe(true);
    });
});

describe('generated interiors use the floor brush edges', () => {
    const t = (sx, sy) => ({ sheetPath: 'assets/test/rim.png', sx, sy, sw: 32, sh: 32 });
    const rimBrush = {
        id: 'test_rim_floor',
        brushType: 'interior_floor',
        tiles: [0, 1, 2].map(row => [0, 1, 2].map(col => t(col * 32, row * 32))),
        slotSides: [['nw', 'n', 'ne'], ['w', '', 'e'], ['sw', 's', 'se']],
    };

    it('the shared slot helper matches the editor rules', () => {
        const all = () => true;
        expect(brushSlotSides(rimBrush, all)).toBe(0);
        // Top-left corner: nothing above or to the left
        expect(brushSlotSides(rimBrush, (dq, dr) => dq >= 0 && dr >= 0)).toBe(sidesMask('nw'));
        expect(brushSlotSides({ ...rimBrush, brushType: 'interior_wall' }, () => false)).toBe(0);
        expect(brushSlotSides({ ...rimBrush, slotSides: undefined }, () => false)).toBe(0);
    });

    it('lays the border sprites and blocks its outer sides, never toward the door', () => {
        const brushes = CustomInteriors.getBrushes();
        brushes.push(rimBrush);
        const preload = vi.spyOn(CustomInteriors, 'preloadPaths').mockImplementation(() => {});
        try {
            const out = generateSpriteInterior({ type: 'test_rim_hall', q: 3, r: 4 }, 'rim_seed');
            const { tiles, width: w, height: h } = out;
            const doorQ = Math.floor(w / 2);
            // Top-left floor cell (walls on row 0 and columns 0 / w-1)
            expect(tiles[1][1].blockedSides).toBe(sidesMask('nw'));
            expect(tiles[1][1]._customTile.floor).toEqual(t(0, 0));
            expect(tiles[1][2].blockedSides).toBe(sidesMask('n'));
            expect(tiles[2][2].blockedSides).toBeUndefined();
            expect(tiles[2][2]._customTile.floor).toEqual(t(32, 32));
            // Bottom row runs along the map edge; the door sits in it, so the
            // cells beside and above the door are not edges toward it
            expect(tiles[h - 1][1].blockedSides).toBe(sidesMask('sw'));
            expect(tiles[h - 1][doorQ]._isDoor).toBe(true);
            expect(tiles[h - 1][doorQ].blockedSides).toBeUndefined();
            expect(tiles[h - 1][doorQ - 1].blockedSides).toBe(sidesMask('s'));
            expect(tiles[h - 2][doorQ].blockedSides).toBeUndefined();
            // Walls carry no sides
            expect(tiles[0][0].blockedSides).toBeUndefined();
        } finally {
            brushes.splice(brushes.indexOf(rimBrush), 1);
            preload.mockRestore();
        }
    });
});

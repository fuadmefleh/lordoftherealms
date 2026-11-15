// Snow on the roofs (ui/innerMapLayers/streetSeasons.js _seasonRoofSnow): the kit files cells
// by drawing order, not by what they are — a design's door sits in its "roof" layer and its
// roof in the "floor" layer with the wall faces. Snow goes by what a cell IS (a roof sheet),
// so every roof is snowed on, and no door, window or wall face, whatever layer it is in.

import { describe, it, expect } from 'vitest';
import { InnerMapRenderer } from '../ui/innerMapRenderer.js';
import '../ui/innerMapLayers/streetSeasons.js';

/** A 2D context that does nothing (and remembers nothing). */
function ctx2d() {
    return new Proxy({}, {
        get: (o, k) => (k in o ? o[k] : (k === 'getTransform' ? () => ({ a: 1 }) : () => {})),
        set: (o, k, v) => { o[k] = v; return true; },
    });
}

describe('snow lying on the roofs', () => {
    it('falls on the roofing, not on the door, windows or wall faces filed in the roof layer', () => {
        const drawn = [];
        const R = Object.create(InnerMapRenderer);
        R._ssRoofTmp = { width: 64, height: 64, getContext: () => ctx2d() };
        R._ssRoofMask = { width: 64, height: 64, getContext: () => ctx2d() };
        R._drawCustomBuildingDirect = (g, cam, def) => { drawn.push(...def.layers.roof.map(c => c.sheetPath)); };
        const def = {
            layers: {
                roof: [
                    { q: 0, r: -2, sheetPath: 'assets/buildingKit/modern/roofs_clay.png' },
                    { q: 0, r: -1, sheetPath: 'assets/lpc/Structure/Doors/32x64px Doors/15 Panel Door A.png' },
                    { q: 1, r: -1, sheetPath: 'assets/lpc/Structure/Windows/Window A.png' },
                    { q: 2, r: -1, sheetPath: 'assets/buildingKit/modern/walls_brick_red.png' },
                    { q: 1, r: -3, sheetPath: 'assets/lpc/Structure/Roofing/Chimney.png' },
                ],
            },
        };
        R._seasonRoofSnow(ctx2d(), { width: 64, height: 64 }, null, def, 0, 0, 32, 1);
        expect(drawn).toEqual(['assets/buildingKit/modern/roofs_clay.png', 'assets/lpc/Structure/Roofing/Chimney.png']);
    });

    it('a roof layer holding only a door gets no snow at all', () => {
        let calls = 0;
        const R = Object.create(InnerMapRenderer);
        R._ssRoofTmp = { width: 64, height: 64, getContext: () => ctx2d() };
        R._ssRoofMask = { width: 64, height: 64, getContext: () => ctx2d() };
        R._drawCustomBuildingDirect = () => { calls++; };
        const def = { layers: { roof: [{ q: 0, r: 0, sheetPath: 'assets/lpc/Structure/Doors/32x64px Doors/15 Panel Door A.png' }] } };
        R._seasonRoofSnow(ctx2d(), { width: 64, height: 64 }, null, def, 0, 0, 32, 1);
        expect(calls).toBe(0);
    });
});

describe('snow on roofs filed in any layer', () => {
    const cellsOf = def => ['floor', 'walls', 'roof', 'overlay'].flatMap(l => (def.layers[l] || []).map(c => `${l}:${c.sheetPath.split('/').pop()}`));
    it('the kit\'s roofs in the "floor" layer get snow; its wall faces, doorframe, windows and door do not', () => {
        const drawn = [];
        const R = Object.create(InnerMapRenderer);
        R._ssRoofTmp = { width: 64, height: 64, getContext: () => ctx2d() };
        R._ssRoofMask = { width: 64, height: 64, getContext: () => ctx2d() };
        R._drawCustomBuildingDirect = (g, cam, def) => { drawn.push(...cellsOf(def)); };
        // (as scripts/compose-buildings.js lays a house out)
        const def = {
            layers: {
                floor: [
                    { q: 0, r: -1, sheetPath: 'assets/buildingKit/modern/walls_plaster.png' },
                    { q: 0, r: -3, sheetPath: 'assets/buildingKit/modern/roofs_thatch.png' },
                    { q: 1, r: -3, sheetPath: 'assets/buildingKit/modern/roofs_slate_blue.png' },
                    { q: 2, r: -3, sheetPath: 'assets/buildingKit/modern/roofs_shingle_dark.png' },
                    { q: 3, r: -3, sheetPath: 'assets/buildingKit/modern/roofs_turf.png' },
                ],
                walls: [
                    { q: 1, r: -1, sheetPath: 'assets/lpc/Structure/Doors/32x64px Doors/Doorframe A.png' },
                    { q: 2, r: -1, sheetPath: 'assets/lpc/Structure/Windows/Stone Windows A.png' },
                ],
                roof: [{ q: 1, r: 0, sheetPath: 'assets/lpc/Structure/Doors/32x64px Doors/15 Panel Door A.png' }],
                overlay: [
                    { q: 1, r: -4, sheetPath: 'assets/lpc/Structure/Roofing/Brick Chimney A.png' },
                    { q: 2, r: -1, sheetPath: 'assets/lpc/Structure/Signs/Sign Backgrounds A.png' },
                    { q: 2, r: -1, sheetPath: 'assets/lpc/Structure/Windows/Window Awnings A.png' },
                ],
            },
        };
        R._seasonRoofSnow(ctx2d(), { width: 64, height: 64 }, null, def, 0, 0, 32, 2);
        expect(drawn).toEqual([
            'floor:roofs_thatch.png', 'floor:roofs_slate_blue.png', 'floor:roofs_shingle_dark.png', 'floor:roofs_turf.png',
            'overlay:Brick Chimney A.png',
        ]);
    });

    it('every roof in the town\'s building designs is snowed on, and no door, window or wall face', async () => {
        const { isRoofCell } = await import('../ui/innerMapLayers/streetSeasons.js');
        const fs = await import('fs');
        const designs = JSON.parse(fs.readFileSync('data/buildings.json', 'utf8')).filter(d => d.layers);
        let roofs = 0;
        for (const d of designs) {
            for (const lyr of ['floor', 'walls', 'roof', 'overlay']) {
                for (const cell of d.layers[lyr] || []) {
                    const p = cell.sheetPath || '';
                    if (/\/roofs_/.test(p)) { expect(isRoofCell(cell)).toBe(true); roofs++; }
                    if (/walls_|\/Doors\/|\/Windows\/|\/Signs\//.test(p)) expect(isRoofCell(cell)).toBe(false);
                }
            }
        }
        expect(roofs).toBeGreaterThan(1000);
    });

    it('a design with no roofing gets no snow', () => {
        let calls = 0;
        const R = Object.create(InnerMapRenderer);
        R._ssRoofTmp = { width: 64, height: 64, getContext: () => ctx2d() };
        R._ssRoofMask = { width: 64, height: 64, getContext: () => ctx2d() };
        R._drawCustomBuildingDirect = () => { calls++; };
        const def = { layers: { floor: [{ q: 0, r: 0, sheetPath: 'assets/buildingKit/modern/walls_brick_red.png' }], walls: [], roof: [], overlay: [] } };
        R._seasonRoofSnow(ctx2d(), { width: 64, height: 64 }, null, def, 0, 0, 32, 3);
        expect(calls).toBe(0);
    });
});

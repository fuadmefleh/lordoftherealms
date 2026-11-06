// Bare ground coming down to the water (world/innerMap/water.js _dirtBankShores):
// the grass-banked shore piece beside a road becomes the dirt-banked one in the
// same slot, so a road reaching a river doesn't butt against a square of grass.
import { describe, it, expect } from 'vitest';
import { InnerMap } from '../world/innerMap.js';

const SHEET = 'assets/lpc/Terrain/terrain_spring.png';
const shore = (c, r) => ({ terrainDetail: { sheetPath: SHEET, sx: c * 32, sy: r * 32, sw: 32, sh: 32, layer: 'water' }, _wet: true, subTerrain: { id: 'water', passable: true } });
const grass = () => ({ terrainDetail: { fillCategory: 'grass', layer: 'grass' }, subTerrain: { id: 'grass', passable: true } });
const road = () => ({ isRoad: true, terrainDetail: null, subTerrain: { id: 'dirt', passable: true } });

describe('dirt banks where bare ground meets the water', () => {
    it('a shore piece beside a road takes the dirt bank; one beside grass keeps its grass', () => {
        // a column of shore (left-edge pieces) with land to its left: a road beside the middle one
        const tiles = [
            [grass(), shore(0, 11)],
            [road(), shore(0, 11)],
            [grass(), shore(0, 11)],
        ];
        expect(InnerMap._dirtBankShores(tiles)).toBe(1);
        expect(tiles[1][1].terrainDetail.sx).toBe(6 * 32);
        expect(tiles[0][1].terrainDetail.sx).toBe(0);
        expect(tiles[2][1].terrainDetail.sx).toBe(0);
    });

    it('inside corners swap too; open water, a modder\'s sheet and pieces away from bare ground are left alone', () => {
        const custom = shore(0, 11); custom.terrainDetail.sheetPath = 'assets/custom/myshore.png';
        const tiles = [
            [road(), shore(1, 13), shore(1, 11), custom],
            [road(), road(), road(), road()],
        ];
        InnerMap._dirtBankShores(tiles);
        expect(tiles[0][1].terrainDetail.sx).toBe(7 * 32);   // inside corner 1,13 -> 7,13
        expect(tiles[0][2].terrainDetail.sx).toBe(1 * 32);   // open water (1,11) stays
        expect(tiles[0][3].terrainDetail.sx).toBe(0);        // a modder's sheet stays
    });
});

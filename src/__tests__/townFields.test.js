/**
 * Town fields (world/townProps.js): they lie on tilled soil the grass edges,
 * and grow through the year by their cycle (data/townProps.json growth).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { TownProps } from '../world/townProps.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const grid = (W, H) => Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, q) => ({ q, r, subTerrain: { id: 'grass', passable: true } })));
const defOf = (id) => TownProps.defs().find(d => d.id === id);

describe('town fields', () => {
    it('a wheat field is plowed, sown, green, ripe, then harvested through the year', () => {
        const at = (doy) => TownProps.fieldStage('wheat', doy);
        expect(at(1)).toBe('plowed');
        expect(at(15)).toBe('wheat_sprouts');
        expect(at(35)).toBe('greens');
        expect(at(60)).toBe('wheat');
        expect(at(100)).toBe('plowed');
        expect(TownProps.fieldStage('veg', 45)).toBe('veg');
        expect(TownProps.fieldStage('veg', 70)).toBe('veg_ripe');
    });

    it('lies on the grass as tilled soil (ragged-edged, drawn over it), with a green margin round it', () => {
        const tiles = grid(20, 20);
        expect(TownProps.place(tiles, defOf(TownProps.fieldId('wheat', 4, 3)), 8, 10)).toBe(true);
        expect(tiles[10][8]._fieldSoil).toBe(true);      // the field's own cells
        expect(tiles[10][8]._townSoil).toBeUndefined();  // not bare ground: the grass stays under it
        expect(tiles[10][8]._fieldGreen).toBe(true);
        expect(tiles[11][8]._fieldSoil).toBeUndefined(); // the ring round it is grass
        expect(tiles[12][8]._fieldGreen).toBe(true);     // the margin
    });

    it('grows the placed fields to the day, keeping each field to its cycle; fallow land stays', () => {
        const tiles = grid(30, 20);
        TownProps.place(tiles, defOf(TownProps.fieldId('wheat', 4, 3)), 3, 6);
        TownProps.place(tiles, defOf(TownProps.fieldId('veg', 4, 3)), 12, 6);
        TownProps.place(tiles, defOf(TownProps.fieldId('plowed', 4, 3)), 21, 6);
        TownProps.growFields(tiles, 1);
        expect(tiles[6][3].customObject.defId).toBe(TownProps.fieldId('plowed', 4, 3));
        TownProps.growFields(tiles, 65);
        expect(tiles[6][3].customObject.defId).toBe(TownProps.fieldId('wheat', 4, 3));
        expect(tiles[6][12].customObject.defId).toMatch(/tp_field_veg(_ripe)?_4x3/);
        expect(tiles[6][21].customObject.defId).toBe(TownProps.fieldId('plowed', 4, 3));
        // Every stage it can reach is a registered field of that size
        for (const k of ['wheat_sprouts', 'greens', 'veg_sprouts', 'veg_young', 'veg_ripe']) expect(defOf(TownProps.fieldId(k, 4, 3))).toBeTruthy();
    });

    it('a ripe field has a crop to bring in; taking it all leaves it harvested till the new year', () => {
        const tiles = grid(20, 20);
        TownProps.place(tiles, defOf(TownProps.fieldId('wheat', 4, 3)), 3, 6);
        const obj = tiles[6][3].customObject;
        TownProps.growFields(tiles, 20);
        expect(TownProps.fieldCrop(obj, 20).ripe).toBe(false);
        TownProps.growFields(tiles, 65);
        const c = TownProps.fieldCrop(obj, 65);
        expect(c).toMatchObject({ ripe: true, good: 'grain' });
        expect(c.left).toBe(c.total);
        expect(TownProps.takeFromField(obj, 65, 2, tiles)).toBe(2);
        expect(TownProps.fieldCrop(obj, 65).left).toBe(c.total - 2);
        expect(TownProps.takeFromField(obj, 65, 999, tiles)).toBe(c.total - 2);
        expect(obj.defId).toBe(TownProps.fieldId('plowed', 4, 3));
        TownProps.growFields(tiles, 70);
        expect(obj.defId).toBe(TownProps.fieldId('plowed', 4, 3));
        expect(TownProps.fieldCrop(obj, 70).left).toBe(0);
        // The next year it grows and ripens again
        TownProps.growFields(tiles, 120 + 65);
        expect(TownProps.fieldCrop(obj, 120 + 65).ripe).toBe(true);
    });

    it('a crop carried to the granary goes into the town food store', () => {
        const settlement = { economy: { food: 5 } };
        expect(TownProps.storeHarvest(settlement, 'grain', 3)).toBe(3);
        expect(settlement.economy.food).toBe(8);
        expect(TownProps.storeHarvest({}, 'grain', 3)).toBe(0);
    });
    it('fences join by their neighbours: closed corners, T-joins, run ends, gateposts by the gate', () => {
        const tiles = grid(12, 10);
        const put = (id, q, r) => expect(TownProps.place(tiles, defOf(id), q, r)).toBe(true);
        // A 4x3 ring (q 2..5, r 2..4) laid as plain runs, a gate in the bottom, a spur off the right side
        for (let q = 2; q <= 5; q++) { put('tp_fence_ew', q, 2); put(q === 3 ? 'tp_fence_gate' : 'tp_fence_ew', q, 4); }
        put('tp_fence_ns', 2, 3); put('tp_fence_ns', 5, 3);
        put('tp_fence_ew', 6, 3); put('tp_fence_ew', 7, 3);
        expect(TownProps.joinFences(tiles)).toBeGreaterThan(0);
        const at = (q, r) => tiles[r][q].customObject.defId;
        expect(at(2, 2)).toBe('tp_fence_es');   // top-left corner
        expect(at(5, 2)).toBe('tp_fence_sw');   // top-right
        expect(at(2, 4)).toBe('tp_fence_ne');   // bottom-left: its east neighbour is the gate, but it turns the corner
        expect(at(5, 4)).toBe('tp_fence_nw');   // bottom-right
        expect(at(3, 4)).toBe('tp_fence_gate');
        expect(at(4, 4)).toBe('tp_fence_gr');   // the run carries the gate's post
        expect(at(5, 3)).toBe('tp_fence_nes');  // the spur makes a T
        expect(at(7, 3)).toBe('tp_fence_w');    // and ends in a post
        // Every joined piece is a registered def; fences block, and so does the gate while it is shut (gates.test.js)
        for (const row of tiles) for (const t of row) if (t.customObject) expect(defOf(t.customObject.defId)).toBeTruthy();
        expect(tiles[2][2].subTerrain.passable).toBe(false);
        expect(tiles[4][3].subTerrain.passable).toBe(false);
        // Joining again changes nothing
        expect(TownProps.joinFences(tiles)).toBe(0);
    });
});

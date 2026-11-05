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

    it('lies on soil the grass leaves out, with a green margin round it', () => {
        const tiles = grid(20, 20);
        expect(TownProps.place(tiles, defOf(TownProps.fieldId('wheat', 4, 3)), 8, 10)).toBe(true);
        expect(tiles[10][8]._townSoil).toBe(true);
        expect(tiles[10][8].baseTerrain).toBe('dirt');
        expect(tiles[11][8]._soilFill).toBeTruthy();     // the ring round it
        expect(tiles[12][8]._fieldGreen).toBe(true);     // the margin
        expect(tiles[10][8]._fieldGreen).toBeUndefined();
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
});

/**
 * Trees, bushes and rocks block only where they stand (the bottom row's middle cell), so the crown
 * is walked behind; the new wild trees (data/townProps.json, sheet trees2)
 * grow out in the country and turn with the seasons.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { TownProps } from '../world/townProps.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const solidCells = (def) => def.meta.filter(m => m.impassable).map(m => `${m.localCol},${m.localRow}`);

describe('tree blocking', () => {
    it('a tree prop blocks only its trunk cell', () => {
        const defs = TownProps.defs();
        const trees = defs.filter(d => (d.tags || []).includes('tree') && d.hasBlockedTiles);
        expect(trees.length).toBeGreaterThan(16);
        for (const d of trees) {
            const mid = Math.floor((d.bounds.minCol + d.bounds.maxCol) / 2);
            expect(solidCells(d), d.id).toEqual([`${mid},0`]);
        }
    });

    it('other props still block their whole bottom rows', () => {
        const well = TownProps.defs().find(d => d.id === 'tp_tent_hide');
        expect(solidCells(well).length).toBe(6);
    });

    it('the new trees grow wild, are felled for wood, and turn with the seasons', () => {
        const defs = TownProps.defs().filter(d => /^tp_tree_/.test(d.id));
        expect(defs.length).toBe(16);
        for (const d of defs) {
            expect(d.objectType).toBe('tree');
            expect(d.terrainBindings).toContain('grass');
            expect(d.spawnWeight).toBeGreaterThan(0);
            expect(d.resource.type).toBe('wood');
            expect(Object.keys(d.seasonVariants).sort()).toEqual(['autumn', 'spring', 'summer', 'winter']);
            expect(d.seasonVariants.winter[0].sheetPath).toMatch(/trees2_winter\.png$/);
        }
    });

    it('a bush or rock blocks only where it stands too', () => {
        const defs = TownProps.defs().filter(d => /^tp_(bush|rock)_[a-z]+$/.test(d.id) && d.objectType !== 'decoration');
        expect(defs.length).toBe(32);
        for (const d of defs) expect(solidCells(d), d.id).toEqual(['1,0']);
    });

    it('the new bushes grow wild, give what they bear, and turn with the seasons', () => {
        const defs = TownProps.defs().filter(d => /^tp_bush_[a-z]+$/.test(d.id));
        expect(defs.length).toBe(16);
        for (const d of defs) {
            expect(d.objectType).toBe('plant');
            expect(d.terrainBindings).toContain('grass');
            expect(d.spawnWeight).toBeGreaterThan(0);
            expect(d.resource.amount).toBeGreaterThan(0);
            expect(d.spawnAfter).toBeUndefined();
            expect(d.seasonVariants.winter[0].sheetPath).toMatch(/bushes_winter\.png$/);
        }
        const give = (id) => defs.find(d => d.id === id).resource.type;
        expect(give('tp_bush_blueberry')).toBe('berries');
        expect(give('tp_bush_lavender')).toBe('herbs');
        expect(give('tp_bush_hedge')).toBe('firewood');
    });

    it('the new rocks are broken for stone, common on bare rock and rare elsewhere', () => {
        const defs = TownProps.defs().filter(d => /^tp_rock_[a-z]+$/.test(d.id));
        expect(defs.length).toBe(16);
        for (const d of defs) {
            expect(d.objectType).toBe('rock');
            expect(d.terrainBindings).toEqual(expect.arrayContaining(['rocks', 'grass']));
            expect(d.spawnWeightBy.rocks).toBeGreaterThan(d.spawnWeight * 9);
            expect(d.resistance).toBeGreaterThan(0);
            expect(d.seasonVariants).toBeUndefined();
        }
        expect(defs.find(d => d.id === 'tp_rock_ore').resource.type).toBe('ore');
        expect(defs.find(d => d.id === 'tp_rock_boulder').resource.type).toBe('stone');
    });

    it('a placed tree leaves its crown walkable', () => {
        const def = TownProps.defs().find(d => d.id === 'tp_tree_oak2');
        const tiles = [];
        for (let r = 0; r < 8; r++) {
            tiles.push([]);
            for (let q = 0; q < 8; q++) tiles[r].push({ q, r, subTerrain: { id: 'grass', passable: true } });
        }
        expect(TownProps.place(tiles, def, 2, 6)).toBe(true);
        expect(tiles[6][3].subTerrain.passable).toBe(false);   // the trunk
        expect(tiles[6][2].subTerrain.passable).toBe(true);    // beside it
        expect(tiles[6][4].subTerrain.passable).toBe(true);
        expect(tiles[4][3].subTerrain.passable).toBe(true);    // under the crown
    });
});

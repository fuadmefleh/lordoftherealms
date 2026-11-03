// Buildings and objects saved in an editor (IndexedDB) join the shipped ones
// rather than replacing the whole list — one building saved in the editor
// used to leave every town built of that single house.
import { describe, it, expect } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';

describe('merging editor-saved buildings', () => {
    it('keeps every shipped building and adds or replaces by id', () => {
        DataLoader._gamedata = {
            buildings: [{ id: 'cottage_1', name: 'Cottage' }, { id: 'adobe_house', name: 'Adobe (shipped)' }, { id: 'tavern_tudor', name: 'Tavern' }],
            objects: [{ id: 'large_tree_1' }],
        };
        DataLoader._mergeEditorData({
            buildings: [{ id: 'adobe_house', name: 'Adobe (edited)' }, { id: 'my_mill', name: 'Mill' }],
            objects: [{ id: 'my_rock' }],
        });
        const ids = DataLoader._gamedata.buildings.map(b => b.id);
        expect(ids).toEqual(['cottage_1', 'adobe_house', 'tavern_tudor', 'my_mill']);
        expect(DataLoader._gamedata.buildings.find(b => b.id === 'adobe_house').name).toBe('Adobe (edited)');
        expect(DataLoader._gamedata.objects.map(o => o.id)).toEqual(['large_tree_1', 'my_rock']);
    });

    it('ignores stale saved copies of kit-composed buildings', () => {
        DataLoader._gamedata = { buildings: [{ id: 'cottage_1', name: 'New', tags: ['composed'] }] };
        DataLoader._mergeEditorData({ buildings: [{ id: 'cottage_1', name: 'Old', tags: ['composed'] }] });
        expect(DataLoader._gamedata.buildings[0].name).toBe('New');
    });
});

/**
 * Mod patches: the Game Data tab (editor.html, via EditorCore) writes
 * per-section patches; the game applies them on load (core/dataPatch.js).
 * The two implementations must agree, and the DataLoader must actually
 * read the patches and the Tech Tree tab's custom techs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import '../../editor-core.js';
import { createDataPatch, applyDataPatch, applySectionPatches, mergeCustomTechs } from '../core/dataPatch.js';
import { DataLoader } from '../core/dataLoader.js';

let EC;
beforeAll(() => {
    EC = globalThis.EditorCore;
});

const BASE = {
    plague: { id: 'plague', name: 'Plague', severity: 3, cures: ['rest', 'herbs'], moveCost: null },
    flu: { id: 'flu', name: 'Flu', severity: 1, cures: ['rest'] },
    config: { dailyChance: 0.02, nested: { a: 1, b: 2 } },
};

const CASES = [
    ['a field changes', (d) => { d.plague.severity = 5; }],
    ['an entry is added', (d) => { d.pox = { id: 'pox', name: 'Pox' }; }],
    ['an entry is removed', (d) => { delete d.flu; }],
    ['an array is edited', (d) => { d.plague.cures.push('prayer'); }],
    ['a value becomes null', (d) => { d.config.dailyChance = null; }],
    ['a null becomes a value', (d) => { d.plague.moveCost = 4; }],
    ['an object becomes a list', (d) => { d.config.nested = [1, 2]; }],
    ['a value becomes an object', (d) => { d.flu.severity = { min: 1, max: 2 }; }],
    ['a nested key is removed', (d) => { delete d.config.nested.b; }],
];

describe('data patches', () => {
    for (const [label, edit] of CASES) {
        it(`round-trips when ${label} (game and editor agree)`, () => {
            const target = JSON.parse(JSON.stringify(BASE));
            edit(target);
            const patch = createDataPatch(BASE, target);
            expect(EC.createDataPatch(BASE, target)).toEqual(patch);
            expect(applyDataPatch(BASE, patch)).toEqual(target);
            expect(EC.applyDataPatch(BASE, patch)).toEqual(target);
        });
    }

    it('equal values give no patch', () => {
        expect(createDataPatch(BASE, JSON.parse(JSON.stringify(BASE)))).toBeUndefined();
        expect(EC.createDataPatch(BASE, JSON.parse(JSON.stringify(BASE)))).toBeUndefined();
    });

    it('patches hold only the change, so base updates elsewhere still arrive', () => {
        const target = JSON.parse(JSON.stringify(BASE));
        target.plague.severity = 5;
        const patch = createDataPatch(BASE, target);
        expect(patch).toEqual({ plague: { severity: 5 } });
        const updatedBase = JSON.parse(JSON.stringify(BASE));
        updatedBase.flu.name = 'Influenza';
        const out = applyDataPatch(updatedBase, patch);
        expect(out.flu.name).toBe('Influenza');
        expect(out.plague.severity).toBe(5);
    });

    it('never mutates its inputs', () => {
        const base = JSON.parse(JSON.stringify(BASE));
        const patch = { $delete: ['flu'], plague: { severity: 9 } };
        const frozen = JSON.stringify(patch);
        applyDataPatch(base, patch);
        expect(base).toEqual(BASE);
        expect(JSON.stringify(patch)).toBe(frozen);
    });

    it('applySectionPatches patches whole gamedata sections in place', () => {
        const gd = { ailments: JSON.parse(JSON.stringify(BASE)), other: { x: 1 } };
        const applied = applySectionPatches(gd, { ailments: { flu: { severity: 2 } }, brandNew: [1] });
        expect(applied).toEqual(['ailments', 'brandNew']);
        expect(gd.ailments.flu.severity).toBe(2);
        expect(gd.brandNew).toEqual([1]);
        expect(gd.other).toEqual({ x: 1 });
    });
});

describe('custom techs', () => {
    it('folds editor techs, categories and costs into the technology section', () => {
        const tech = { CATEGORIES: { AGRICULTURE: { id: 'agriculture' } }, TECHS: { CROP_ROTATION: { id: 'crop_rotation', cost: 100 } }, RESEARCH_COSTS: {} };
        mergeCustomTechs(tech, {
            categories: { alchemy: { id: 'alchemy', name: 'Alchemy', icon: '⚗', color: '#00ff00' } },
            techs: {
                CROP_ROTATION: { id: 'crop_rotation', cost: 50 },
                TRANSMUTATION: { id: 'transmutation', name: 'Transmutation', category: 'alchemy' },
            },
            researchCosts: { transmutation: { gold: 900, materials: { gold_ore: 3 }, days: 20 } },
        });
        expect(tech.CATEGORIES.ALCHEMY.name).toBe('Alchemy');
        expect(tech.CATEGORIES.AGRICULTURE).toEqual({ id: 'agriculture' });
        expect(tech.TECHS.CROP_ROTATION.cost).toBe(50);
        expect(tech.TECHS.TRANSMUTATION.category).toBe('alchemy');
        expect(tech.RESEARCH_COSTS.transmutation.gold).toBe(900);
    });
});

describe('DataLoader reads mod content', () => {
    it('applies Game Data patches and custom techs from the stored mod', () => {
        const saved = DataLoader._gamedata;
        try {
            DataLoader._gamedata = {
                technology: { TECHS: {}, CATEGORIES: {}, RESEARCH_COSTS: {} },
                ailments: JSON.parse(JSON.stringify(BASE)),
            };
            DataLoader._mergeEditorData({
                customTechs: { techs: { ALCHEMY: { id: 'alchemy', name: 'Alchemy' } } },
                dataPatches: { ailments: { $delete: ['flu'], plague: { severity: 7 } } },
            });
            expect(DataLoader._gamedata.technology.TECHS.ALCHEMY.name).toBe('Alchemy');
            expect(DataLoader._gamedata.ailments.flu).toBeUndefined();
            expect(DataLoader._gamedata.ailments.plague.severity).toBe(7);
            expect(DataLoader._gamedata.ailments.plague.cures).toEqual(['rest', 'herbs']);
        } finally {
            DataLoader._gamedata = saved;
        }
    });
});

describe('EditorCore data paths', () => {
    it('gets, sets and deletes along a path', () => {
        const d = JSON.parse(JSON.stringify(BASE));
        expect(EC.getAtPath(d, ['plague', 'cures', 1])).toBe('herbs');
        expect(EC.getAtPath(d, ['nope', 'x'])).toBeUndefined();
        EC.setAtPath(d, ['config', 'deep', 'z'], 3);
        expect(d.config.deep.z).toBe(3);
        EC.deleteAtPath(d, ['plague', 'cures', 0]);
        expect(d.plague.cures).toEqual(['herbs']);
        EC.deleteAtPath(d, ['flu']);
        expect(d.flu).toBeUndefined();
    });

    it('searchData finds keys and text, shallowest first', () => {
        const hits = EC.searchData(BASE, 'plag');
        expect(hits[0]).toEqual({ path: ['plague'], match: 'key', text: 'plague' });
        expect(hits.some(h => h.match === 'value' && h.text === 'Plague')).toBe(true);
        expect(EC.searchData(BASE, '')).toEqual([]);
        expect(EC.searchData(BASE, 'rest', { maxResults: 1 })).toHaveLength(1);
    });
});

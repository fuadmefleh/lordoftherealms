// The action menu files each action under a category (ui/actionMenu/core.js
// _categorizeActions). A type mapped to a category that doesn't exist used to
// throw — 'commissions' (→ 'trade') and 'manage_lodging' (→ 'economy') broke
// "Open Actions" in every town with a mill or bakery for hire, and in any town
// with the player's own inn.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';

let ActionMenu;
beforeAll(async () => {
    DataLoader.clearCache();
    await DataLoader.initializeAll();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
});

const CATEGORY_IDS = ['general', 'commerce', 'social', 'military', 'building', 'frontier', 'cartography', 'jail', 'servitude'];

describe('action menu categories', () => {
    it('every mapped action type names a real category', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../ui/actionMenu/core.js'), 'utf-8');
        const block = src.slice(src.indexOf('const mapping = {'), src.indexOf('for (const action of actions)'));
        const bad = [...block.matchAll(/([a-z_]+):\s*'([a-z]+)'/g)].filter(m => !CATEGORY_IDS.includes(m[2])).map(m => `${m[1]} → ${m[2]}`);
        expect(bad).toEqual([]);
    });

    it('files hired work and the player’s inns under Commerce, and an unknown type under General', () => {
        const cats = ActionMenu._categorizeActions([
            { type: 'commissions' }, { type: 'manage_lodging' }, { type: 'no_such_action' },
        ]);
        const of = (type) => cats.find(c => c.actions.some(a => a.type === type)).id;
        expect(of('commissions')).toBe('commerce');
        expect(of('manage_lodging')).toBe('commerce');
        expect(of('no_such_action')).toBe('general');
    });
});

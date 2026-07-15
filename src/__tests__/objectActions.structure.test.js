/**
 * Guard for the objectActions.js by-hand split. The stateless file was split
 * into objectActions/{data,logic,actions,index}.js. Beyond structure, this
 * exercises a cross-module reference at runtime — an OBJECT_ACTIONS handler in
 * actions.js calling a helper defined in logic.js — which is the thing a split
 * of interdependent free functions could break (and which the build alone would
 * not catch). A no-undef static pass over the dir also verified no dangling refs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { ObjectActions } from '../ui/objectActions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

describe('ObjectActions split', () => {
    it('facade exposes its methods', () => {
        for (const m of ['getAll', 'get', 'getActionsForObject', 'buildMenuItems', 'execute']) {
            expect(typeof ObjectActions[m], m).toBe('function');
        }
    });

    it('the action registry is populated (actions.js reachable)', () => {
        const all = ObjectActions.getAll();
        expect(all).toBeTruthy();
        expect(all.sleep).toBeTruthy();
        expect(Object.keys(all).length).toBeGreaterThan(10);
    });

    it('an action handler can call a logic.js helper (cross-module ref resolves)', () => {
        const fakeGame = {
            player: { inventory: { bread: 2, apple: 1 }, gold: 100, skills: {}, hunger: 50 },
            world: {},
            ui: {},
        };
        // Find any action whose condition/onExecute we can invoke without a DOM.
        const eat = ObjectActions.get('eat');
        expect(eat).toBeTruthy();
        // 'eat' condition calls _getPlayerFoods(game) from logic.js — must not
        // throw a ReferenceError (which is exactly what a broken split would).
        expect(() => (eat.condition ? eat.condition(fakeGame) : true)).not.toThrow();
    });
});

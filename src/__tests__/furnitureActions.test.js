/**
 * Interior furniture is usable, not just inspectable: each furniture type maps
 * to real OBJECT_ACTIONS, building context changes the offer (a tavern bed is
 * rented), and private furniture in someone else's home stays off-limits.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { ObjectActions } from '../ui/objectActions.js';
import { FURNITURE_ACTIONS, BUILDING_FURNITURE_ACTIONS } from '../ui/objectActions/data.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

describe('furniture actions', () => {
    it('every mapped action key exists in the registry', () => {
        const lists = [
            ...Object.values(FURNITURE_ACTIONS),
            ...Object.values(BUILDING_FURNITURE_ACTIONS).flatMap(m => Object.values(m)),
        ];
        for (const key of lists.flat()) {
            expect(ObjectActions.get(key), key).toBeTruthy();
        }
    });

    it('building context overrides the default offer', () => {
        expect(ObjectActions.getFurnitureActionKeys('bed', { type: 'tavern' })).toEqual(['rent_room']);
        expect(ObjectActions.getFurnitureActionKeys('stall', { type: 'marketplace' })).toContain('shop');
        expect(ObjectActions.getFurnitureActionKeys('rack', { type: 'barracks' })).toContain('hire_troops');
        expect(ObjectActions.getFurnitureActionKeys('forge', { type: 'player_blacksmith' })).toContain('smelt');
    });

    it("private furniture is usable only in the player's own buildings", () => {
        expect(ObjectActions.getFurnitureActionKeys('bed', { type: 'house' })).toEqual([]);
        expect(ObjectActions.getFurnitureActionKeys('chest', { type: 'manor' })).toEqual([]);
        expect(ObjectActions.getFurnitureActionKeys('bed', { type: 'house', isPlayerOwned: true })).toContain('sleep');
        expect(ObjectActions.getFurnitureActionKeys('chest', { type: 'farm', isPlayerProperty: true })).toContain('store');
    });

    it('infers furniture type from editor object names', () => {
        expect(ObjectActions.inferFurnitureType('Oak Bed')).toBe('bed');
        expect(ObjectActions.inferFurnitureType('Ale Barrel')).toBe('barrel');
        expect(ObjectActions.inferFurnitureType('Bar Counter')).toBe('bar');
        expect(ObjectActions.inferFurnitureType('Tall Bookshelf')).toBe('bookshelf');
        expect(ObjectActions.inferFurnitureType('Iron Anvil')).toBe('anvil');
        expect(ObjectActions.inferFurnitureType('Mossy Rock')).toBeNull();
    });

    it('service actions are unavailable outside a settlement', () => {
        const game = {
            player: { q: 0, r: 0, gold: 100, inventory: {} },
            world: { getTile: () => ({ settlement: null }) },
            ui: {},
        };
        const items = ObjectActions.buildFurnitureMenuItems(game, { type: 'stall', name: 'Stall' }, { type: 'marketplace' }, 1, 1);
        expect(items).toHaveLength(1);
        expect(items[0].type).toBe('disabled');

        game.world.getTile = () => ({ settlement: { name: 'Ashford' } });
        const open = ObjectActions.buildFurnitureMenuItems(game, { type: 'stall', name: 'Stall' }, { type: 'marketplace' }, 1, 1);
        expect(open[0].action).toBe('obj_action_shop');
    });
});

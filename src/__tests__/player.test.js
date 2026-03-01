import { describe, it, expect, beforeAll } from 'vitest';
import { Player } from '../player/player.js';
import { Economy } from '../world/economy.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

describe('Player', () => {
    it('constructor: initializes with defaults', () => {
        const player = new Player();
        expect(player.name).toBe('Wanderer');
        expect(player.gold).toBe(10000);
        expect(player.health).toBe(100);
        expect(player.stamina).toBe(10);
        expect(player.skills).toBeTruthy();
    });

    it('constructor: accepts custom profile', () => {
        const player = new Player({ firstName: 'Hero', gender: 'female', age: 25 });
        expect(player.name).toBe('Hero');
        expect(player.gender).toBe('female');
        expect(player.age).toBe(25);
    });

    it('skills: has all expected skills', () => {
        const player = new Player();
        expect(player.skills).toHaveProperty('commerce');
        expect(player.skills).toHaveProperty('combat');
        expect(player.skills).toHaveProperty('leadership');
        expect(player.skills).toHaveProperty('diplomacy');
        expect(player.skills).toHaveProperty('stealth');
        expect(player.skills).toHaveProperty('cartography');
    });

    it('inventory: starts with bread', () => {
        const player = new Player();
        expect(player.inventory.bread).toBeGreaterThanOrEqual(1);
    });

    it('movement: starts with full movement', () => {
        const player = new Player();
        expect(player.movementRemaining).toBe(player.stamina);
    });
});

describe('Economy System', () => {
    it('Economy: PRODUCTION_RATES loaded', () => {
        expect(Economy.PRODUCTION_RATES).toBeTruthy();
        expect(Economy.PRODUCTION_RATES).toHaveProperty('capital');
        expect(Economy.PRODUCTION_RATES).toHaveProperty('town');
    });

    it('Economy: RESOURCE_BONUSES loaded', () => {
        expect(Economy.RESOURCE_BONUSES).toBeTruthy();
        expect(Economy.RESOURCE_BONUSES).toHaveProperty('iron');
        expect(Economy.RESOURCE_BONUSES).toHaveProperty('wheat');
    });
});

describe('PlayerEconomy', () => {
    it('PROPERTY_TYPES: loaded from JSON', () => {
        expect(PlayerEconomy.PROPERTY_TYPES).toBeTruthy();
        expect(Object.keys(PlayerEconomy.PROPERTY_TYPES).length).toBeGreaterThanOrEqual(7);
    });

    it('GOODS: loaded with icons and names', () => {
        expect(PlayerEconomy.GOODS).toBeTruthy();
        for (const [key, good] of Object.entries(PlayerEconomy.GOODS)) {
            expect(good).toHaveProperty('name');
            expect(good).toHaveProperty('icon');
        }
    });

    it('RECIPES: all reference valid goods', () => {
        expect(PlayerEconomy.RECIPES).toBeTruthy();
        for (const [key, recipe] of Object.entries(PlayerEconomy.RECIPES)) {
            expect(recipe).toHaveProperty('output');
            expect(recipe).toHaveProperty('input');
        }
    });
});

describe('PlayerMilitary', () => {
    it('UNIT_TYPES: loaded from JSON', () => {
        expect(PlayerMilitary.UNIT_TYPES).toBeTruthy();
        expect(Object.keys(PlayerMilitary.UNIT_TYPES).length).toBeGreaterThanOrEqual(4);
    });

    it('CONTRACT_TYPES: loaded from JSON', () => {
        expect(PlayerMilitary.CONTRACT_TYPES).toBeTruthy();
        expect(Object.keys(PlayerMilitary.CONTRACT_TYPES).length).toBeGreaterThanOrEqual(4);
    });
});

// Butchering a carcass (ui/innerMapAnimals.js _butcherNow): a fresh stag gives
// its venison, antlers and hide; with the packs full what won't fit is laid on
// the ground by the carcass (not thrown away), and the player is told so.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapAnimals } from '../ui/innerMapAnimals.js';
import { Player } from '../player/player.js';
import { PlayerInventory } from '../core/inventory.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

let game, notes;
beforeEach(() => {
    notes = [];
    game = { player: new Player(), world: { day: 1 }, ui: { showNotification: (...a) => notes.push(a), updateStats() {} } };
    const tiles = [];
    for (let r = 0; r < 12; r++) {
        tiles[r] = [];
        for (let q = 0; q < 12; q++) tiles[r][q] = { q, r, subTerrain: { id: 'grass', passable: true } };
    }
    InnerMap.tiles = tiles;
    InnerMap.width = InnerMap.height = 12;
});

const stag = () => ({ id: 'stag1', species: 'stag', state: 'dead', q: 5, r: 5, diedDay: 1 });

describe('butchering', () => {
    it('a fresh stag gives venison and more', () => {
        const a = stag();
        InnerMap.animals = [a];
        InnerMapAnimals._butcherNow(game, a);
        expect(game.player.inventory.game_meat).toBeGreaterThan(0);
        expect(notes[0][1]).toMatch(/You butcher the stag: .*Venison/);
    });

    it('with the packs full, the meat is left on the ground beside the carcass', () => {
        const p = game.player;
        p.inventory = {};
        for (let i = 0; i < PlayerInventory.getCapacity(p); i++) p.inventory[`odd_thing_${i}`] = 1;
        const a = stag();
        InnerMap.animals = [a];
        InnerMapAnimals._butcherNow(game, a);
        expect(p.inventory.game_meat).toBeUndefined();
        const ground = InnerMap.tiles.flat().filter(t => t.groundItem && t.groundItem.placedBy === 'butcher');
        expect(ground.some(t => t.groundItem.itemId === 'game_meat' && t.groundItem.quantity > 0)).toBe(true);
        expect(ground.every(t => Math.max(Math.abs(t.q - 5), Math.abs(t.r - 5)) <= 2)).toBe(true);
        expect(notes[0][1]).toMatch(/packs are full/);
        expect(notes[0][1]).toMatch(/left on the ground beside it/);
        expect(notes[0][1]).not.toMatch(/nothing worth taking/);
    });
});

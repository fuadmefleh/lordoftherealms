// Over the side of a ship (ui/innerMapDiving.js): from her deck the hull walls
// the player in, so "Dive Over the Side" / "Jump Over the Side" put them in the
// water off her rail (under it, for a dive), and "Climb Aboard" brings a
// swimmer alongside back up onto the deck.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapDiving } from '../ui/innerMapDiving.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const N = 20;
let game, notes;
beforeEach(() => {
    // Open sea; a deck 3 wide (q 8-10) and 5 long (r 7-11), its hull a ring round it
    const tiles = [];
    for (let r = 0; r < N; r++) {
        tiles[r] = [];
        for (let q = 0; q < N; q++) {
            const deck = q >= 8 && q <= 10 && r >= 7 && r <= 11;
            const hull = !deck && q >= 7 && q <= 11 && r >= 6 && r <= 12;
            const t = { q, r, _sea: true, _deep: true, subTerrain: { id: 'sea_water', passable: false } };
            if (hull) t.customObjectPart = { anchorQ: 9, anchorR: 12 };
            if (deck) { t._deck = true; t.subTerrain = { id: 'deck', passable: true }; t.customObjectPart = { anchorQ: 9, anchorR: 12 }; }
            tiles[r][q] = t;
        }
    }
    tiles[12][9].customObjectPart = null;
    tiles[12][9].customObject = { defId: 'hull_sloop', aboard: true };
    InnerMap.tiles = tiles;
    InnerMap.width = InnerMap.height = N;
    InnerMap.active = true;
    InnerMap._insideBuilding = null;
    InnerMap.npcs = [];
    InnerMap.currentWorldTile = { q: 3, r: 3 };
    InnerMap.playerInnerQ = 9;
    InnerMap.playerInnerR = 9;
    notes = [];
    game = { player: new Player(), world: { day: 1, season: 'Summer', getTile: () => ({ terrain: { id: 'ocean' } }) }, ui: { showNotification: (...a) => notes.push(a), updateStats() {} } };
    if (InnerMapDiving._under) InnerMapDiving.surface(game, { quiet: true });
});

describe('over the side', () => {
    it('from the deck, the sea clicked offers a dive and a jump over the side', () => {
        expect(InnerMapDiving.onDeck()).toBe(true);
        const items = InnerMapDiving.menuItems(game, InnerMap.tiles[9][15], 15, 9);
        expect(items.map(i => i.action)).toEqual(['dive_overboard', 'dive_jump']);
        // and the ship's own menu offers them too
        expect(InnerMapDiving.shipItems(game, 7, 9).map(i => i.action)).toContain('dive_jump');
    });

    it('a jump puts you in the water off her rail, on the side you chose; you can climb back aboard', () => {
        InnerMapDiving.goOverboard(game, 15, 9, false);
        expect(InnerMap.isPlayerSwimming()).toBe(true);
        expect(InnerMap.playerInnerQ).toBe(12);
        expect(InnerMap.playerInnerR).toBe(9);
        const climb = InnerMapDiving.menuItems(game, InnerMap.tiles[9][13], 13, 9).find(i => i.action === 'dive_climb');
        expect(climb).toBeTruthy();
        InnerMapDiving.climbAboard(game);
        expect(InnerMapDiving.onDeck()).toBe(true);
        expect(InnerMap.playerInnerQ).toBe(10);
    });

    it('a dive takes you under at once', () => {
        InnerMapDiving.goOverboard(game, 2, 9, true);
        expect(InnerMap._underwater).toBe(true);
        expect(InnerMap.playerInnerQ).toBe(6);
        // Climbing aboard waits till you're up for air
        expect(InnerMapDiving.climbAboard(game)).toBe(false);
        InnerMapDiving.surface(game, { quiet: true });
        expect(InnerMap._underwater).toBe(false);
    });

    it('down to the end of your breath, you come up winded: the dive is barred, V refuses, until it passes', () => {
        InnerMapDiving.goOverboard(game, 2, 9, true);
        game.player.dive.under = 19;
        game.player.dive.breath = 1;           // 1s of 20 left
        InnerMapDiving.surface(game);
        expect(notes.some(n => /Winded/.test(n[0]))).toBe(true);
        const items = InnerMapDiving.menuItems(game, InnerMap.tiles[9][6], 6, 9);
        const barred = items.find(i => i.type === 'disabled');
        expect(barred.label).toMatch(/Dive — Winded — catching your breath, \d+s/);
        expect(typeof barred.live).toBe('function');
        notes.length = 0;
        InnerMapDiving.toggle(game);
        expect(InnerMapDiving.isUnder()).toBe(false);
        expect(notes.some(n => /catching your breath/.test(n[1]))).toBe(true);
        // the surface clock runs; the breath comes back
        InnerMapDiving.update(30, game);
        expect(barred.live()).toMatch(/\d+s/);
        InnerMapDiving.update(200, game);
        expect(notes.some(n => /Breath Back/.test(n[0]))).toBe(true);
        expect(InnerMapDiving.menuItems(game, InnerMap.tiles[9][6], 6, 9).some(i => i.action === 'dive_under')).toBe(true);
        InnerMapDiving.toggle(game);
        expect(InnerMapDiving.isUnder()).toBe(true);
    });

    it('too far off her side, there is no climbing aboard', () => {
        InnerMapDiving.goOverboard(game, 15, 9, false);
        InnerMap.playerInnerQ = 17;
        expect(InnerMapDiving.aboardSpot()).toBeNull();
        expect(InnerMapDiving.climbAboard(game)).toBe(false);
    });
});

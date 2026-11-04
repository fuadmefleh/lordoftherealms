// Furnishing a home: buying pieces from the furniture maker, setting them down
// inside a home the player owns (floor only, never walls, the door, other
// furniture or people), moving and putting away pieces (a chest's contents
// go with it, and a full chest can't be put away), the layout surviving
// leaving the house and a save/load, and what the furniture does.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { FurnitureCatalogue } from '../world/furnitureCatalogue.js';
import { Furnishing } from '../systems/furnishing.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { ObjectActions } from '../ui/objectActions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

/** A one-row street with the player's house on it, entered. */
function enterHouse(player, building = null) {
    const W = 12, H = 8;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        tiles[r] = [];
        for (let q = 0; q < W; q++) tiles[r][q] = { q, r, subTerrain: { id: 'grass', passable: true }, explored: true };
    }
    InnerMap.active = true;
    InnerMap._insideBuilding = null;
    InnerMap._outerMapState = null;
    InnerMap.tiles = tiles;
    InnerMap.width = W;
    InnerMap.height = H;
    InnerMap.buildings = [];
    InnerMap.roads = [];
    InnerMap.npcs = [];
    InnerMap.currentWorldTile = { q: 5, r: 6 };
    InnerMap._currentWorldTileRef = { q: 5, r: 6, settlement: { name: 'Oakby', type: 'town' } };
    const house = building || { type: 'house', name: 'House (Yours)', q: 3, r: 4, isPlayerOwned: true, ownerId: 'player' };
    expect(InnerMap.enterBuilding(house, { player, ui: { showNotification() {} } })).toBe(true);
    return house;
}

let player;
beforeEach(() => {
    InnerMap._interiorCache = {};
    player = new Player();
    player.gold = 1000;
});

describe('the furniture maker', () => {
    it('sells what the place can make, into the furniture store', () => {
        const village = Furnishing.shopList(player, 'village').map(i => i.id);
        const city = Furnishing.shopList(player, 'city').map(i => i.id);
        expect(village).toContain('plank_bed');
        expect(village).not.toContain('featherbed');
        expect(city).toContain('featherbed');
        expect(city).toContain('canopy_bed');

        const res = Furnishing.buy(player, { day: 3 }, 'storage_chest', 'village');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(1000 - FurnitureCatalogue.item('storage_chest').price);
        expect(player.furnitureStore).toHaveLength(1);
        expect(player.furnitureStore[0].storage).toEqual({});
        // Not the goods inventory
        expect(player.inventory.storage_chest).toBeUndefined();
    });

    it('refuses a piece the place cannot make, or the player cannot afford', () => {
        expect(Furnishing.buy(player, {}, 'canopy_bed', 'village').success).toBe(false);
        player.gold = 3;
        expect(Furnishing.buy(player, {}, 'plank_bed', 'town').success).toBe(false);
        expect(player.gold).toBe(3);
    });

    it('buys a stored piece back for part of its price', () => {
        Furnishing.buy(player, {}, 'plank_bed', 'town');
        const uid = player.furnitureStore[0].uid;
        const before = player.gold;
        const res = Furnishing.sell(player, uid);
        expect(res.success).toBe(true);
        expect(player.gold - before).toBe(Math.floor(30 * 0.5));
        expect(player.furnitureStore).toHaveLength(0);
    });
});

describe('placing furniture at home', () => {
    it('adopts the furniture the house came with into its layout', () => {
        enterHouse(player);
        const rec = InnerMap.adoptHomeFurniture(player);
        expect(rec.adopted).toBe(true);
        const types = rec.pieces.map(p => FurnitureCatalogue.view(p).type).sort();
        expect(types).toEqual(['barrel', 'bed', 'chest', 'fireplace', 'rug', 'table']);
        expect(InnerMap.getTile(1, 1)._furniture._piece).toBeTruthy();
        expect(InnerMap.furnishHomeKey()).toBe('house:5,6');
    });

    it('a piece stands on bare floor only', () => {
        enterHouse(player);
        const bed = { uid: 'x1', id: 'plank_bed' };
        InnerMap.playerInnerQ = 2; InnerMap.playerInnerR = 3;
        expect(InnerMap.furnishCheck(bed, 0, 3).ok).toBe(false);            // the side wall
        expect(InnerMap.furnishCheck(bed, 3, 0).ok).toBe(false);            // the back wall
        expect(InnerMap.furnishCheck(bed, 4, 6).ok).toBe(false);            // the door
        expect(InnerMap.furnishCheck(bed, 4, 5).reason).toMatch(/door/i);   // just inside the door
        expect(InnerMap.furnishCheck(bed, 4, 2).reason).toMatch(/in the way/); // the table
        expect(InnerMap.furnishCheck(bed, 2, 3).reason).toMatch(/standing/);   // the player
        InnerMap.npcs = [{ name: 'Wat', q: 5, r: 3 }];
        expect(InnerMap.furnishCheck(bed, 5, 3).reason).toMatch(/Wat/);
        InnerMap.npcs = [];
        expect(InnerMap.furnishCheck(bed, 5, 3).ok).toBe(true);
        // A rug can go under your feet
        expect(InnerMap.furnishCheck({ uid: 'x2', id: 'rag_rug' }, 2, 3).ok).toBe(true);
    });

    it('a long piece must fit its whole footprint, and turns to fit', () => {
        enterHouse(player);
        InnerMap.playerInnerQ = 2; InnerMap.playerInnerR = 3;
        const table = { uid: 'x3', id: 'long_table', rot: 0 };
        expect(InnerMap.furnishCheck(table, 6, 3).ok).toBe(false); // runs into the east wall
        expect(InnerMap.furnishCheck({ ...table, rot: 1 }, 6, 3).ok).toBe(true);
        expect(FurnitureCatalogue.footprint({ ...table, rot: 1 })).toEqual([1, 2]);
    });

    it('nothing may be placed in a house that is not yours', () => {
        enterHouse(player, { type: 'house', name: 'House', q: 3, r: 4, ownerId: 'npc_7' });
        expect(InnerMap.isOwnHome()).toBe(false);
        expect(InnerMap.furnishCheck({ uid: 'x', id: 'crate' }, 5, 3).ok).toBe(false);
        expect(InnerMap.placePiece(player, { uid: 'x', id: 'crate' }, 5, 3).ok).toBe(false);
    });

    it('sets a bought piece down; the bed sleeps better and the home is more comfortable', () => {
        enterHouse(player);
        InnerMap.playerInnerQ = 2; InnerMap.playerInnerR = 3;
        const comfortBefore = InnerMap.homeComfort();
        Furnishing.buy(player, {}, 'featherbed', 'town');
        const piece = Furnishing.takeFromStore(player, player.furnitureStore[0].uid);
        expect(InnerMap.placePiece(player, piece, 5, 3).ok).toBe(true);
        const t = InnerMap.getTile(5, 3);
        expect(t._furniture.type).toBe('bed');
        expect(t._furniture.restBonus).toBe(0.25);
        expect(t.subTerrain.passable).toBe(false);
        expect(InnerMap.homeComfort()).toBeGreaterThan(comfortBefore);
        // The sleep action carries the bed's bonus
        const items = ObjectActions.buildFurnitureMenuItems({ player }, t._furniture, InnerMap._insideBuilding, 5, 3);
        const sleep = items.find(i => i._objectActionKey === 'sleep');
        expect(sleep.customObjDef.restBonus).toBe(0.25);
        // A chest of your own opens as storage
        expect(ObjectActions.getFurnitureActionKeys('chest', InnerMap._insideBuilding)).toContain('store');
    });

    it('a furnished home adds comfort each hour spent in it', () => {
        const base = new Player();
        base.needs.comfort = 50;
        base.decayNeedsPerHour({ insideBuilding: true, inOwnHouse: true });
        const furnished = new Player();
        furnished.needs.comfort = 50;
        furnished.decayNeedsPerHour({ insideBuilding: true, inOwnHouse: true, homeComfort: 1 });
        expect(furnished.needs.comfort - base.needs.comfort).toBeCloseTo(1, 5);
    });
});

describe('moving and putting away', () => {
    it('moves a piece the house came with, freeing its old spot', () => {
        enterHouse(player);
        InnerMap.playerInnerQ = 2; InnerMap.playerInnerR = 3;
        const table = InnerMap.pieceAt(player, 4, 2) || (InnerMap.adoptHomeFurniture(player), InnerMap.pieceAt(player, 4, 2));
        expect(table).toBeTruthy();
        const lifted = InnerMap.liftPiece(player, table.uid);
        expect(lifted).toBe(table);
        expect(InnerMap.getTile(4, 2)._furniture).toBeNull();
        expect(InnerMap.getTile(4, 2).subTerrain.passable).toBe(true);
        expect(InnerMap.placePiece(player, lifted, 5, 4).ok).toBe(true);
        expect(InnerMap.getTile(5, 4)._furniture._piece).toBe(table.uid);
    });

    it('a chest carries its contents when moved, and is not put away full', () => {
        enterHouse(player);
        InnerMap.playerInnerQ = 2; InnerMap.playerInnerR = 3;
        InnerMap.adoptHomeFurniture(player);
        const chest = InnerMap.pieceAt(player, 1, 5);
        expect(FurnitureCatalogue.view(chest).type).toBe('chest');
        // Store something in it the way the storage window does (tile._furniture._storage)
        InnerMap.getTile(1, 5)._furniture._storage.wood = 3;
        expect(chest.storage).toEqual({ wood: 3 });

        const lifted = InnerMap.liftPiece(player, chest.uid);
        expect(InnerMap.placePiece(player, lifted, 2, 4).ok).toBe(true);
        expect(InnerMap.getTile(2, 4)._furniture._storage).toEqual({ wood: 3 });

        const again = InnerMap.liftPiece(player, chest.uid);
        expect(Furnishing.putAway(player, again).success).toBe(false);
        expect(Furnishing.sell(player, again.uid).success).toBe(false);
        again.storage = {};
        expect(Furnishing.putAway(player, again).success).toBe(true);
        expect(player.furnitureStore.map(p => p.uid)).toContain(chest.uid);
        expect(Furnishing.sell(player, chest.uid).success).toBe(true);
    });
});

describe('the layout lasts', () => {
    it('survives walking out, a fresh interior and a save/load', () => {
        const house = enterHouse(player);
        InnerMap.playerInnerQ = 2; InnerMap.playerInnerR = 3;
        InnerMap.adoptHomeFurniture(player);
        const bed = InnerMap.pieceAt(player, 1, 1);
        InnerMap.placePiece(player, InnerMap.liftPiece(player, bed.uid), 5, 3);
        Furnishing.buy(player, {}, 'hearth', 'village');
        InnerMap.placePiece(player, Furnishing.takeFromStore(player, player.furnitureStore[0].uid), 2, 2);
        InnerMap.getTile(1, 5)._furniture._storage.bread = 2;
        expect(InnerMap.exitBuilding({ player })).toBe(true);

        // Save, load into a new player, forget every cached interior
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.homeFurnishings['house:5,6'].pieces.length).toBe(7);
        InnerMap._interiorCache = {};

        enterHouse(back, { ...house });
        expect(InnerMap.getTile(1, 1)._furniture).toBeNull();
        expect(InnerMap.getTile(1, 1).subTerrain.passable).toBe(true);
        expect(InnerMap.getTile(5, 3)._furniture.type).toBe('bed');
        expect(InnerMap.getTile(2, 2)._furniture.type).toBe('fireplace');
        expect(InnerMap.getTile(1, 5)._furniture._storage).toEqual({ bread: 2 });
    });

    it('a piece that no longer fits goes back into the store', () => {
        enterHouse(player);
        InnerMap.adoptHomeFurniture(player);
        const rec = InnerMap.homeLayout(player);
        rec.pieces.push({ uid: 'zz', id: 'crate', q: 0, r: 0, rot: 0 }); // in the wall
        InnerMap.exitBuilding({ player });
        InnerMap._interiorCache = {};
        enterHouse(player);
        expect(rec.pieces.some(p => p.uid === 'zz')).toBe(false);
        expect(player.furnitureStore.some(p => p.uid === 'zz')).toBe(true);
    });
});

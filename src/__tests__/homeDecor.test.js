// Dressing a home: the new furniture (dressers, wardrobes, looms, chairs …)
// and the things set on its tables (tile._decor) and hung on its walls
// (tile._wallDecor) — bought, stored, placed only where they can go, kept in
// the home's layout through a walk out and a save/load, moved with the table
// they stand on, taken down and sold back; windows knocked through as
// building work; and what it all does (comfort, cheer, guests' Prestige), capped.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { FurnitureCatalogue } from '../world/furnitureCatalogue.js';
import { Furnishing } from '../systems/furnishing.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { Household } from '../player/household.js';

const DECOR = ['mugs', 'plates', 'bread', 'candles', 'books', 'papers', 'pots', 'fruit', 'cloth', 'tools', 'flowers', 'bottles', 'bowls', 'coins', 'herbs'];
const WALL = ['window', 'shelf', 'torch', 'painting', 'banner', 'curtains', 'mirror', 'antlers', 'hanging_pots', 'hanging_herbs', 'weapon_rack', 'map', 'tapestry', 'clock'];
const NEW_TYPES = ['dresser', 'cupboard', 'workbench', 'loom', 'spinning_wheel', 'basket', 'firewood', 'plant', 'washstand', 'chair', 'wardrobe', 'cradle', 'sack_pile', 'crate_stack', 'barrel_rack', 'coat_rack'];

// (these specs place by the old fixed house layout, as furnishing.test.js: the planned
// interiors (world/innerMap/interiorPlanner.js) are covered by interiorPlanner.test.js)
let planner = null;
let stateLayer = null;
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    planner = InnerMap._planInterior;
    InnerMap._planInterior = null;
    // (nor the hour's layer — meals laid, fires lit: world/innerMap/interiorState.js, its own spec)
    stateLayer = InnerMap._applyInteriorState;
    InnerMap._applyInteriorState = null;
}, 120000);
afterAll(() => { InnerMap._planInterior = planner; InnerMap._applyInteriorState = stateLayer; });

/** The player's house on a one-row street, entered (as furnishing.test.js). */
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
    InnerMap.playerInnerQ = 2; InnerMap.playerInnerR = 3;
    return house;
}

function buyOne(player, id, where = 'city') {
    const res = Furnishing.buy(player, { day: 1 }, id, where);
    expect(res.success, res.text).toBe(true);
    return Furnishing.takeFromStore(player, res.piece.uid);
}

/** The table the house came with (adopted into the layout). */
function tableTile() {
    for (let r = 0; r < InnerMap.height; r++) for (let q = 0; q < InnerMap.width; q++) {
        const t = InnerMap.getTile(q, r);
        if (t && t._furniture && t._furniture.type === 'table') return { q, r };
    }
    return null;
}

let player;
beforeEach(() => {
    InnerMap._interiorCache = {};
    player = new Player();
    player.gold = 5000;
});

describe('the catalogue', () => {
    it('sells every new furniture type, at sane prices, from a known maker', () => {
        const makers = FurnitureCatalogue.makers();
        const items = FurnitureCatalogue.items();
        for (const type of NEW_TYPES) expect(items.some(i => i.type === type), type).toBe(true);
        for (const it of items) {
            expect(makers[it.maker], `${it.id} maker`).toBeTruthy();
            expect(it.price, it.id).toBeGreaterThan(0);
            expect(it.price, it.id).toBeLessThanOrEqual(300);
            expect(FurnitureCatalogue.rank(it.minSettlement) >= 0).toBe(true);
            expect(new Set(items.map(i => i.id)).size).toBe(items.length);
        }
        for (const t of ['dresser', 'cupboard', 'wardrobe', 'basket', 'sack_pile', 'crate_stack', 'barrel_rack']) expect(FurnitureCatalogue.holdsThings(t), t).toBe(true);
        // A finer piece costs more, and only a bigger place makes it
        expect(FurnitureCatalogue.item('carved_wardrobe').price).toBeGreaterThan(FurnitureCatalogue.item('wardrobe').price);
        expect(Furnishing.shopList(player, 'village').map(i => i.id)).not.toContain('carved_wardrobe');
        expect(Furnishing.shopList(player, 'city').map(i => i.id)).toContain('carved_wardrobe');
    });

    it('sells something of every table thing and wall hanging but the window, which is building work', () => {
        const items = FurnitureCatalogue.items();
        for (const d of DECOR) expect(items.some(i => i.kind === 'decor' && i.decor === d), d).toBe(true);
        for (const w of WALL.filter(x => x !== 'window')) expect(items.some(i => i.kind === 'wall' && i.wallDecor === w), w).toBe(true);
        expect(items.some(i => i.wallDecor === 'window')).toBe(false);
        expect(Furnishing.windowJob().price).toBeGreaterThan(0);
        // The weaver makes the tapestry, the smith the weapon rack
        expect(FurnitureCatalogue.item('tapestry').maker).toBe('weaver');
        expect(FurnitureCatalogue.item('weapon_rack').maker).toBe('smith');
        expect(FurnitureCatalogue.item('torch_sconce').maker).toBe('smith');
        expect(FurnitureCatalogue.item('curtains').maker).toBe('weaver');
    });
});

describe('setting things on tables', () => {
    it('buy → store → set on a table → saved → back after a walk out and a save/load → taken down → sold', () => {
        const house = enterHouse(player);
        InnerMap.adoptHomeFurniture(player);
        const tbl = tableTile();
        expect(tbl).toBeTruthy();
        const candles = buyOne(player, 'candlesticks');
        expect(FurnitureCatalogue.decorKind(candles)).toBe('decor');
        expect(InnerMap.placeDecor(player, candles, tbl.q, tbl.r).ok).toBe(true);
        expect(InnerMap.getTile(tbl.q, tbl.r)._decor).toBe('candles');
        const rec = InnerMap.homeLayout(player);
        expect(rec.decor.map(d => d.uid)).toContain(candles.uid);
        // Decorations don't count against the furniture
        expect(rec.pieces.some(p => p.uid === candles.uid)).toBe(false);

        expect(InnerMap.exitBuilding({ player })).toBe(true);
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        InnerMap._interiorCache = {};
        enterHouse(back, { ...house });
        expect(InnerMap.getTile(tbl.q, tbl.r)._decor).toBe('candles');

        const d = InnerMap.decorAt(back, tbl.q, tbl.r);
        expect(d.uid).toBe(candles.uid);
        const lifted = InnerMap.liftDecor(back, d.uid);
        expect(InnerMap.getTile(tbl.q, tbl.r)._decor).toBeUndefined();
        expect(Furnishing.putAway(back, lifted).success).toBe(true);
        const gold = back.gold;
        expect(Furnishing.sell(back, lifted.uid).success).toBe(true);
        expect(back.gold - gold).toBe(Math.floor(FurnitureCatalogue.item('candlesticks').price * 0.5));
    });

    it('only on a table, desk, shelf or dresser with nothing on it yet', () => {
        enterHouse(player);
        InnerMap.adoptHomeFurniture(player);
        const tbl = tableTile();
        const mugs = buyOne(player, 'clay_mugs');
        const floor = InnerMap.decorCheck(mugs, 5, 3, { player });
        expect(floor.ok).toBe(false);
        expect(floor.reason).toMatch(/table/);
        expect(InnerMap.decorCheck(mugs, 3, 0, { player }).ok).toBe(false);           // a wall
        // A bed holds nothing
        const bed = (() => { for (let r = 0; r < InnerMap.height; r++) for (let q = 0; q < InnerMap.width; q++) { const t = InnerMap.getTile(q, r); if (t && t._furniture && t._furniture.type === 'bed') return { q, r }; } return null; })();
        expect(InnerMap.decorCheck(mugs, bed.q, bed.r, { player }).reason).toMatch(/Nothing can stand/);
        expect(InnerMap.placeDecor(player, mugs, tbl.q, tbl.r).ok).toBe(true);
        const bread = buyOne(player, 'bread_board');
        expect(InnerMap.decorCheck(bread, tbl.q, tbl.r, { player }).reason).toMatch(/already/);
        // A dresser of your own takes things
        const dresser = buyOne(player, 'dresser');
        expect(InnerMap.placePiece(player, dresser, 5, 3).ok).toBe(true);
        expect(InnerMap.placeDecor(player, bread, 5, 3).ok).toBe(true);
        // Not in a house that isn't yours
        InnerMap.exitBuilding({ player });
        enterHouse(player, { type: 'house', name: 'House', q: 3, r: 4, ownerId: 'npc_7' });
        expect(InnerMap.decorCheck(buyOne(player, 'fruit_bowl'), tbl.q, tbl.r, { player }).ok).toBe(false);
    });

    it('what stands on a table moves with it, and goes into the store when the table does', () => {
        enterHouse(player);
        InnerMap.adoptHomeFurniture(player);
        const tbl = tableTile();
        const vase = buyOne(player, 'flower_vase');
        InnerMap.placeDecor(player, vase, tbl.q, tbl.r);
        const table = InnerMap.pieceAt(player, tbl.q, tbl.r);
        const lifted = InnerMap.liftPiece(player, table.uid);
        expect(InnerMap.getTile(tbl.q, tbl.r)._decor).toBeUndefined();
        expect(InnerMap.placePiece(player, lifted, 5, 4).ok).toBe(true);
        expect(InnerMap.getTile(5, 4)._decor).toBe('flowers');
        expect(InnerMap.decorAt(player, 5, 4)).toBe(vase);

        InnerMap.liftPiece(player, table.uid);
        const off = InnerMap.releaseDecorOn(player, table.uid);
        expect(off).toEqual([vase]);
        expect(player.furnitureStore).toContain(vase);
        expect(InnerMap.homeLayout(player).decor).not.toContain(vase);
    });

    it('the house\'s own things on its tables and walls are adopted with its furniture', () => {
        enterHouse(player);
        const tbl = tableTile();
        InnerMap.getTile(tbl.q, tbl.r)._decor = 'bowls';
        Object.assign(InnerMap.getTile(3, 0), { _wallDecor: 'antlers', _wallDecorFace: 'down' });
        Object.assign(InnerMap.getTile(5, 0), { _wallDecor: 'window', _wallDecorFace: 'down' });
        const rec = InnerMap.adoptHomeFurniture(player);
        const looks = rec.decor.map(d => FurnitureCatalogue.view(d));
        expect(looks.map(v => v.decor || v.wallDecor).sort()).toEqual(['antlers', 'bowls']); // never the window
        expect(looks.every(v => v.original)).toBe(true);
        expect(InnerMap.getTile(tbl.q, tbl.r)._decor).toBe('bowls');
        expect(InnerMap.getTile(3, 0)._wallDecor).toBe('antlers');
        expect(InnerMap.getTile(5, 0)._wallDecor).toBe('window');
        // Taken down, valued at the original rate
        const antlers = InnerMap.liftDecor(player, InnerMap.decorAt(player, 3, 0).uid);
        expect(InnerMap.getTile(3, 0)._wallDecor).toBeUndefined();
        expect(FurnitureCatalogue.sellValue(antlers)).toBe(Math.floor(FurnitureCatalogue.item('mounted_antlers').price * 0.3));
    });
});

describe('hanging things on walls', () => {
    it('on a wall facing into a room, saved and restored, taken down and sold', () => {
        const house = enterHouse(player);
        const tapestry = buyOne(player, 'tapestry');
        expect(InnerMap.decorCheck(tapestry, 4, 3, { player }).reason).toMatch(/wall/);     // the floor
        expect(InnerMap.decorCheck(tapestry, 0, 0, { player }).reason).toMatch(/face/);     // a corner
        const door = InnerMap._furnishDoor();
        expect(InnerMap.decorCheck(tapestry, door.q, door.r, { player }).ok).toBe(false);  // the door
        expect(InnerMap.decorCheck(tapestry, 2, InnerMap.height - 1, { player }).reason).toMatch(/face/); // the front wall's outside
        const side = InnerMap.decorCheck(tapestry, 0, 3, { player });
        expect(side.ok).toBe(true);
        expect(side.face).toBe('right');
        expect(InnerMap.placeDecor(player, tapestry, 3, 0).ok).toBe(true);
        const t = InnerMap.getTile(3, 0);
        expect(t._wallDecor).toBe('tapestry');
        expect(t._wallDecorFace).toBe('down');
        const clock = buyOne(player, 'wall_clock');
        expect(InnerMap.decorCheck(clock, 3, 0, { player }).reason).toMatch(/hangs there/);

        InnerMap.exitBuilding({ player });
        const back = new Player();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player))), back);
        InnerMap._interiorCache = {};
        enterHouse(back, { ...house });
        expect(InnerMap.getTile(3, 0)._wallDecor).toBe('tapestry');
        expect(InnerMap.getTile(3, 0)._wallDecorFace).toBe('down');
        const down = InnerMap.liftDecor(back, InnerMap.decorAt(back, 3, 0).uid);
        expect(InnerMap.getTile(3, 0)._wallDecor).toBeUndefined();
        Furnishing.putAway(back, down);
        const gold = back.gold;
        expect(Furnishing.sell(back, down.uid).success).toBe(true);
        expect(back.gold - gold).toBe(Math.floor(140 * 0.5));
    });

    it('a window is knocked through for a price; curtains hang only at a window, and leave it when taken down', () => {
        const house = enterHouse(player);
        const curtains = buyOne(player, 'curtains');
        expect(InnerMap.decorCheck(curtains, 4, 0, { player }).reason).toMatch(/window/);
        expect(InnerMap.windowCheck(0, 0).ok).toBe(false);
        expect(InnerMap.windowCheck(4, 3).ok).toBe(false);
        expect(InnerMap.windowCheck(4, 0).ok).toBe(true);
        const gold = player.gold;
        expect(Furnishing.payWindowJob(player, null).success).toBe(true);
        expect(player.gold).toBe(gold - Furnishing.windowJob().price);
        expect(InnerMap.cutWindow(player, 4, 0).ok).toBe(true);
        expect(InnerMap.getTile(4, 0)._wallDecor).toBe('window');
        expect(InnerMap.windowCheck(4, 0).reason).toMatch(/already/);
        expect(InnerMap.decorCheck(buyOne(player, 'painting'), 4, 0, { player }).reason).toMatch(/window/);
        expect(InnerMap.placeDecor(player, curtains, 4, 0).ok).toBe(true);
        expect(InnerMap.getTile(4, 0)._wallDecor).toBe('curtains');

        // Kept through a walk out and a fresh interior
        InnerMap.exitBuilding({ player });
        InnerMap._interiorCache = {};
        enterHouse(player, { ...house });
        expect(InnerMap.getTile(4, 0)._wallDecor).toBe('curtains');
        InnerMap.liftDecor(player, InnerMap.decorAt(player, 4, 0).uid);
        expect(InnerMap.getTile(4, 0)._wallDecor).toBe('window');
        // Too poor for a mason
        player.gold = 1;
        expect(Furnishing.payWindowJob(player, null).success).toBe(false);
        expect(player.gold).toBe(1);
    });

    it('a decoration that no longer fits goes back into the store', () => {
        enterHouse(player);
        InnerMap.adoptHomeFurniture(player);
        const rec = InnerMap.homeLayout(player);
        rec.decor.push({ uid: 'zz', id: 'painting', q: 4, r: 3, face: 'down' }); // on the floor
        InnerMap.exitBuilding({ player });
        InnerMap._interiorCache = {};
        enterHouse(player);
        expect(rec.decor.some(d => d.uid === 'zz')).toBe(false);
        expect(player.furnitureStore.some(p => p.uid === 'zz')).toBe(true);
    });
});

describe('what it does', () => {
    it('comfort, cheer and guests\' Prestige, each capped', () => {
        const cap = FurnitureCatalogue.config().decorCap;
        const many = Array.from({ length: 30 }, () => ({ kind: 'wall', look: 'tapestry' }));
        const fx = FurnitureCatalogue.decorEffects(many);
        expect(fx.prestige).toBe(cap.prestige);
        expect(fx.comfort).toBe(cap.comfort);
        const flowers = FurnitureCatalogue.decorEffects(Array.from({ length: 50 }, () => ({ kind: 'decor', look: 'flowers' })));
        expect(flowers.cheer).toBe(cap.cheer);
        expect(FurnitureCatalogue.decorEffects([{ kind: 'decor', look: 'candles' }]).light).toBeGreaterThan(0);
        expect(FurnitureCatalogue.decorEffects([{ kind: 'decor', look: 'nonsense' }])).toEqual({ comfort: 0, cheer: 0, light: 0, prestige: 0 });
    });

    it('the home grows more comfortable and cheering, and guests speak of its finery', () => {
        enterHouse(player);
        InnerMap.adoptHomeFurniture(player);
        const comfort = InnerMap.homeComfort();
        expect(InnerMap.homeCheer()).toBe(0);
        InnerMap.placeDecor(player, buyOne(player, 'tapestry'), 3, 0);
        InnerMap.placeDecor(player, buyOne(player, 'painting'), 5, 0);
        InnerMap.placeDecor(player, buyOne(player, 'flower_vase'), tableTile().q, tableTile().r);
        expect(InnerMap.homeComfort()).toBeGreaterThan(comfort);
        expect(InnerMap.homeCheer()).toBeGreaterThan(0);
        const fx = Furnishing.homeDecor(player, InnerMap.furnishHomeKey());
        expect(fx.prestige).toBe(2);

        // Fun climbs faster in a cheerful home
        const a = new Player(); a.needs.fun = 50;
        a.decayNeedsPerHour({ insideBuilding: true, inOwnHouse: true });
        const b = new Player(); b.needs.fun = 50;
        b.decayNeedsPerHour({ insideBuilding: true, inOwnHouse: true, homeCheer: 0.4 });
        expect(b.needs.fun - a.needs.fun).toBeCloseTo(0.4, 5);

        // A guest well received at home: the welcome, and the finery spoken of
        const key = InnerMap.furnishHomeKey();
        const home = Household.home(player, key, true, { name: 'House', town: 'Oakby' });
        home.rooms = [{ id: 'r1', kind: 'hall', quality: 0.8 }];
        home.clean = 90;
        const g = { name: 'wat', refId: 'npc:none', icon: '🧑' };
        home.guests = [g];
        player.house = player.house || { prestige: 0 };
        const before = Number(player.house.prestige) || 0;
        const out = [];
        Household._depart(player, { day: 10 }, home, g, false, out);
        const welcome = Number(Household.config().guests.welcomePrestige) || 0;
        expect((Number(player.house.prestige) || 0) - before).toBe(welcome + 2);
        expect(out[0].text).toMatch(/fine hangings/);
    });
});

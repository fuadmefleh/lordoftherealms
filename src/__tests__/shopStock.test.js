/**
 * A shop's real stock on its furniture (world/innerMap/shopStock.js, data/shopStock.json):
 * the shelves, counters, barrels and sacks of a market hall (and a granary, bakery,
 * apothecary, smithy, warehouse) show the goods the town's market holds — bare in a
 * shortage, full in plenty — worked out once a day per building, and the menu's Buy from
 * the Shelf opens the market's buy window on just those goods. Broken furniture can't be
 * used (player/furnitureActions.js usable). The decor sheet's new pieces are in the art data.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { ShopStock } from '../world/innerMap/shopStock.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { FurnitureActions } from '../player/furnitureActions.js';
import { ObjectActions } from '../ui/objectActions.js';
import { decorPx, drawWares } from '../ui/interiorDress.js';
import { shelfDesc, shelfNames } from '../ui/objectActions/actions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const town = (extra = {}) => {
    const s = { name: 'Ashford', type: 'city', population: 6000, happiness: 50, culture: 'Imperial', q: 4, r: 4, buildWealth: { score: 0.6 }, ...extra };
    SettlementMarket.ensure(s);
    return s;
};

/** A room of w × h floor with pieces { type, q, r } on it. */
function room(pieces, w = 8, h = 6) {
    const tiles = [];
    for (let r = 0; r < h; r++) {
        tiles.push([]);
        for (let q = 0; q < w; q++) tiles[r].push({ q, r, baseTerrain: 'wood_floor', subTerrain: { passable: true } });
    }
    for (const p of pieces) tiles[p.r][p.q]._furniture = { type: p.type, name: p.name || p.type, ...(p.extra || {}) };
    return { tiles, width: w, height: h };
}

const setStock = (s, id, ratio) => { s.market.stock[id] = SettlementMarket.target(s, id) * ratio; };

describe('how full the market is', () => {
    it('levels a good by its stock against the stock the market aims at', () => {
        const s = town();
        setStock(s, 'bread', 0);
        expect(ShopStock.levelOf(s, 'bread').level).toBe(0);
        expect(ShopStock.levelOf(s, 'bread').fill).toBe(0);
        setStock(s, 'bread', 0.3);
        expect(ShopStock.levelOf(s, 'bread').level).toBe(1);
        setStock(s, 'bread', 1);
        expect(ShopStock.levelOf(s, 'bread').level).toBe(2);
        setStock(s, 'bread', 2);
        const p = ShopStock.levelOf(s, 'bread');
        expect(p.level).toBe(3);
        expect(p.fill).toBe(1);
    });

    it('knows which buildings are shops (not the player\'s own)', () => {
        expect(ShopStock.isShop('marketplace')).toBe(true);
        expect(ShopStock.isShop('bakery')).toBe(true);
        expect(ShopStock.isShop('house')).toBe(false);
        expect(ShopStock.isShop('player_marketplace')).toBe(false);
        expect(ShopStock.pool('marketplace').length).toBeGreaterThan(20);
        expect(ShopStock.pool('bakery')).toContain('bread');
    });

    it('every good the data names has art in the decor sheet and holders that exist', () => {
        const C = ShopStock.config();
        const decor = DataLoader._gamedata.innerMapRenderer.interiorArt.decor;
        const kinds = new Set(Object.values(C.holders).map(h => h.kind));
        for (const [id, g] of Object.entries(C.goods)) {
            expect(decor[g.art], `${id}: ${g.art}`).toBeTruthy();
            for (const k of g.in) expect(kinds.has(k), `${id} in ${k}`).toBe(true);
        }
        const furn = DataLoader._gamedata.innerMapRenderer.interiorArt.furniture;
        for (const h of Object.values(C.holders)) if (h.bare) expect(furn[h.bare]).toBeTruthy();
    });
});

describe('the shelves show what the market holds', () => {
    it('a bakery in plenty: full shelves and counters of bread', () => {
        const s = town();
        for (const id of ShopStock.pool('bakery')) setStock(s, id, 2);
        const R = room([{ type: 'shelf', q: 1, r: 1 }, { type: 'bar', q: 4, r: 2 }, { type: 'sack', q: 1, r: 4 }]);
        const plan = ShopStock.plan(R.tiles, R.width, R.height, s, 'bakery');
        expect(plan.length).toBe(3);
        const shelf = plan.find(p => p.holder === 'shelf');
        // every board full: 5 boards × 3
        expect(shelf.rows.flat().length).toBe(15);
        const bar = plan.find(p => p.holder === 'bar');
        expect(bar.ids.length).toBeGreaterThan(2);
        const sack = plan.find(p => p.holder === 'sack');
        expect(sack.goods[0].id).toMatch(/flour|grain/);
        expect(sack.ids.length).toBeGreaterThan(0);
    });

    it('a dearth leaves them bare, a shortage thin', () => {
        const s = town();
        for (const id of ShopStock.pool('bakery')) setStock(s, id, 0);
        const R = room([{ type: 'shelf', q: 1, r: 1 }, { type: 'bar', q: 4, r: 2 }]);
        let plan = ShopStock.plan(R.tiles, R.width, R.height, s, 'bakery');
        expect(plan.every(p => (p.rows ? p.rows.flat() : p.ids).length === 0)).toBe(true);
        expect(plan.every(p => p.goods.every(g => g.level === 0))).toBe(true);
        for (const id of ShopStock.pool('bakery')) setStock(s, id, 0.3);
        plan = ShopStock.plan(R.tiles, R.width, R.height, s, 'bakery');
        const shelf = plan.find(p => p.holder === 'shelf');
        const n = shelf.rows.flat().length;
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(15);
        // (filled from the bottom board up)
        expect(shelf.rows[shelf.rows.length - 1].length).toBeGreaterThan(0);
    });

    it('shows nothing the town never trades, and nothing on a broken piece', () => {
        const s = town();
        for (const id of ShopStock.pool('marketplace')) { s.market.stock[id] = 0; }
        const tradesNone = ShopStock.pool('marketplace').filter(id => SettlementMarket.target(s, id) <= 0);
        const R = room([{ type: 'shelf', q: 1, r: 1 }, { type: 'shelf', q: 2, r: 1 }, { type: 'barrel', q: 5, r: 1 }, { type: 'crate', q: 6, r: 1, extra: { broken: true } }]);
        setStock(s, 'apples', 2); setStock(s, 'cabbage', 2);
        const plan = ShopStock.plan(R.tiles, R.width, R.height, s, 'marketplace');
        for (const p of plan) for (const g of p.goods) expect(tradesNone).not.toContain(g.id);
        const crate = plan.find(p => p.holder === 'crate');
        if (crate) expect(crate.ids.length).toBe(0);
    });

    it('two shelves of a market hall keep different goods, the same each time', () => {
        const s = town();
        const R = room([{ type: 'shelf', q: 1, r: 1 }, { type: 'shelf', q: 2, r: 1 }]);
        const a = ShopStock.plan(R.tiles, R.width, R.height, s, 'marketplace');
        const b = ShopStock.plan(R.tiles, R.width, R.height, s, 'marketplace');
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        const ids = a.flatMap(p => p.goods.map(g => g.id));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('a house shows none of it', () => {
        const s = town();
        const R = room([{ type: 'shelf', q: 1, r: 1 }]);
        expect(ShopStock.plan(R.tiles, R.width, R.height, s, 'house')).toEqual([]);
    });
});

describe('laid on the room once a day', () => {
    const saved = {};
    afterEach(() => {
        Object.assign(InnerMap, saved);
        InnerMap._shopStock = null;
    });

    function enter(R, s, day) {
        for (const k of ['tiles', 'width', 'height', 'worldDay', '_currentWorldTileRef', '_floor', '_insideBuilding']) if (!(k in saved)) saved[k] = InnerMap[k];
        InnerMap.tiles = R.tiles; InnerMap.width = R.width; InnerMap.height = R.height;
        InnerMap.worldDay = day; InnerMap._floor = 0;
        InnerMap._currentWorldTileRef = { q: 4, r: 4, settlement: s };
        InnerMap._insideBuilding = { type: 'bakery', q: 3, r: 3 };
    }

    it('caches by the day, and again when forced (a purchase)', () => {
        const s = town();
        for (const id of ShopStock.pool('bakery')) setStock(s, id, 2);
        const R = room([{ type: 'shelf', q: 1, r: 1 }]);
        enter(R, s, 10);
        InnerMap._dressShopStock(InnerMap._insideBuilding);
        const full = R.tiles[1][1]._stock.rows.flat().length;
        expect(full).toBe(15);
        expect(InnerMap.shopStockAt(1, 1)).toBe(R.tiles[1][1]._stock);
        // the market sells out the same day: the shelf stays as the morning found it…
        for (const id of ShopStock.pool('bakery')) setStock(s, id, 0);
        InnerMap._dressShopStock(InnerMap._insideBuilding);
        expect(R.tiles[1][1]._stock.rows.flat().length).toBe(full);
        // …until a purchase from it, or the next day
        InnerMap._dressShopStock(InnerMap._insideBuilding, true);
        expect(R.tiles[1][1]._stock.rows.flat().length).toBe(0);
        for (const id of ShopStock.pool('bakery')) setStock(s, id, 2);
        InnerMap.worldDay = 11;
        InnerMap._dressShopStock(InnerMap._insideBuilding);
        expect(R.tiles[1][1]._stock.rows.flat().length).toBe(15);
        expect(R.tiles[1][1]._stock.bare).toBe('shelf_bare');
    });

    it('offers Buy from the Shelf on a stocked piece, greyed out when bare', () => {
        const s = town();
        for (const id of ShopStock.pool('bakery')) setStock(s, id, 2);
        const R = room([{ type: 'shelf', q: 1, r: 1 }]);
        enter(R, s, 12);
        InnerMap._dressShopStock(InnerMap._insideBuilding);
        const stock = InnerMap.shopStockAt(1, 1);
        const keys = ObjectActions.getFurnitureActionKeys('shelf', InnerMap._insideBuilding, { stock });
        expect(keys[0]).toBe('buy_shelf');
        expect(shelfDesc(stock)).toMatch(/\(plenty\)/);
        expect(shelfNames(stock)).toMatch(/\w/);
        const def = ObjectActions.get('buy_shelf');
        expect(def.check(null, {}, 1, 1).ok).toBe(true);
        for (const id of ShopStock.pool('bakery')) setStock(s, id, 0);
        InnerMap._dressShopStock(InnerMap._insideBuilding, true);
        const c = def.check(null, {}, 1, 1);
        expect(c.ok).toBe(false);
        expect(c.reason).toMatch(/^Bare/);
        // (no stock: no such entry)
        expect(ObjectActions.getFurnitureActionKeys('shelf', { type: 'house' }, {})).not.toContain('buy_shelf');
    });
});

describe('broken furniture', () => {
    it('a broken bed, chair or hearth cannot be used, with words for it', () => {
        const bed = { type: 'bed', broken: true };
        const u = FurnitureActions.usable('sleep', bed);
        expect(u.ok).toBe(false);
        expect(u.reason).toMatch(/no sleeping/);
        expect(FurnitureActions.usable('sit', { type: 'chair', broken: true }).reason).toMatch(/weight/);
        expect(FurnitureActions.check('warm', { furniture: { type: 'fireplace', broken: true }, player: {} }).ok).toBe(false);
        expect(FurnitureActions.usable('sit', { type: 'chair' }).ok).toBe(true);
        // (still looked into and emptied)
        expect(FurnitureActions.usable('look_inside', { type: 'chest', broken: true }).ok).toBe(true);
        expect(FurnitureActions.usable('craft', { type: 'workbench', broken: true }).reason).toMatch(/workbench is broken/);
        expect(FurnitureActions.usable('craft', { type: 'odd_thing', broken: true }).reason).toMatch(/odd thing is broken/);
    });

    it('the menu greys out every use of a broken piece', () => {
        const game = { player: { q: 0, r: 0, gold: 0, inventory: {} }, world: { day: 1, getTile: () => null } };
        const items = ObjectActions.buildMenuItems(game, { name: 'Broken Chair', actions: ['sit'], furnitureType: 'chair', furniture: { type: 'chair', broken: true } }, 1, 1);
        expect(items.length).toBe(1);
        expect(items[0].type).toBe('disabled');
        expect(items[0].desc).toMatch(/broken/);
    });
});

describe('drawing', () => {
    it('decor pixels are whole close in, untouched farther out', () => {
        expect(decorPx(96, 40)).toBe(2);
        expect(decorPx(128, 40)).toBe(3);
        expect(decorPx(48, 40)).toBeCloseTo(1.2);
        expect(decorPx(64, 32)).toBe(2);
    });

    it('draws a ware for each slot on a shelf, nothing for a bare one', () => {
        const calls = [];
        const ctx = { drawImage: (...a) => calls.push(a) };
        const art = DataLoader._gamedata.innerMapRenderer.interiorArt.decor;
        const H = ShopStock.config().holders.shelf;
        const stock = { rows: [['bread', 'bread'], [], ['ware_cheese'], [], []], rowBox: H.rows };
        const img = {};
        const ok = drawWares(ctx, art, stock, { x: 0, y: 0, w: 48, h: 101 }, 48, () => img, () => 1, 3);
        expect(ok).toBe(true);
        expect(calls.length).toBe(3);
        // each fitted under its board's height
        for (const c of calls) expect(c[8]).toBeLessThanOrEqual(Math.ceil(101 * 0.13) + 1);
        calls.length = 0;
        drawWares(ctx, art, { rows: [[], [], [], [], []], rowBox: H.rows }, { x: 0, y: 0, w: 48, h: 101 }, 48, () => img, () => 1);
        expect(calls.length).toBe(0);
    });
});

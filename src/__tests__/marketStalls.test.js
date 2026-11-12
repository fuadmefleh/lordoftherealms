/**
 * Market stalls (world/marketStalls.js, world/innerMap/stalls.js): each stall in
 * a town square or the marketplace hall is one trader with its own line of
 * wares, drawn from the town market's real stock at the market's prices; its
 * keeper buys back only goods of its trade; the trades are varied in a square,
 * stable across visits, and gated by the town's wealth, size, culture and water.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import { loadData } from './playtest/harness.js';

let MarketStalls, SettlementMarket, Trading, PlayerEconomy, InnerMap, DataLoader, Utils, TownProps;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    await loadData();
    ({ MarketStalls } = await import('../world/marketStalls.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
    ({ PlayerEconomy, Trading } = await import('../player/playerEconomy.js'));
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ TownProps } = await import('../world/townProps.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

/** A town at a wealth score (its buildings' standing: world/settlementWealth.js), its market at equilibrium. */
const town = (extra = {}, score = 0.6) => {
    const s = { name: 'Ashford', type: 'city', population: 6000, happiness: 50, culture: 'Imperial', q: 4, r: 4, buildWealth: { score }, ...extra };
    SettlementMarket.ensure(s);
    return s;
};
const plains = (s) => ({ q: s.q, r: s.r, terrain: { id: 'plains', passable: true }, resource: null, settlement: s });
const player = (extra = {}) => ({ gold: 100000, inventory: {}, maxInventory: 99, skills: { commerce: 0 }, ...extra });
const ctxOf = (s, extra = {}) => ({ ...MarketStalls.context(s, null), seed: 31, ...extra });
const keys = (n) => Array.from({ length: n }, (_, i) => `o:${10 + i * 4},40`);

describe('Market stall trades', () => {
    it('are defined in data with goods the game knows, and art for each', () => {
        const T = MarketStalls.trades();
        expect(Object.keys(T).length).toBeGreaterThanOrEqual(14);
        const known = new Set(Object.values(PlayerEconomy.GOODS).map(g => g.id));
        for (const [id, t] of Object.entries(T)) {
            expect(t.goods.length, id).toBeGreaterThan(0);
            for (const g of [...t.goods, ...(t.buys || [])]) expect(known.has(g), `${id}: ${g}`).toBe(true);
            expect(TownProps.stallVariant(MarketStalls.artOf(id)), id).toBeGreaterThan(0);
        }
    });

    it('vary across a square: no two stalls alike while other trades are open', () => {
        const s = town({ isPort: true }, 0.8);
        const ctx = ctxOf(s);
        const open = MarketStalls.eligible(s, ctx, plains(s)).length;
        expect(open).toBeGreaterThanOrEqual(6);
        const map = MarketStalls.assign(s, keys(6), ctx, plains(s));
        const trades = Object.values(map);
        expect(trades.length).toBe(6);
        expect(new Set(trades).size).toBe(6);
        // A hall's stalls are their own group: varied among themselves
        const hall = MarketStalls.assign(s, ['in:3,3:3,3', 'in:3,3:7,3', 'in:3,3:11,3'], ctx, plains(s));
        expect(new Set(Object.values(hall)).size).toBe(3);
    });

    it('are stable across visits: kept on the settlement, and the same draw for the same town', () => {
        const s = town({ isPort: true }, 0.8);
        const first = MarketStalls.assign(s, keys(5), ctxOf(s), plains(s));
        // The stocks move; the stalls keep their trades
        for (const id of Object.keys(s.market.stock)) s.market.stock[id] *= 0.2;
        expect(MarketStalls.assign(s, keys(5), ctxOf(s), plains(s))).toEqual(first);
        expect(s.stallTrades).toMatchObject(first);
        // A saved-and-loaded town (its stallTrades round-trip through JSON)
        const loaded = JSON.parse(JSON.stringify(s));
        expect(MarketStalls.assign(loaded, keys(5), ctxOf(loaded), plains(loaded))).toEqual(first);
        // An old save (no stallTrades): the same draw from the same seed and place
        const fresh = town({ isPort: true }, 0.8);
        expect(MarketStalls.assign(fresh, keys(5), ctxOf(fresh), plains(fresh))).toEqual(first);
        // ...and it draws nothing from the shared RNG
        Utils.setSeed(99);
        const before = Utils.random();
        Utils.setSeed(99);
        MarketStalls.assign(town({}, 0.5), keys(4), ctxOf(town({}, 0.5)));
        expect(Utils.random()).toBe(before);
    });

    it('are gated by wealth: no jeweller in a poor village, one possible in a rich city', () => {
        const poor = town({ type: 'village', population: 300 }, 0.2);
        const pctx = ctxOf(poor);
        expect(pctx.tier).toBe('poor');
        expect(MarketStalls.allowed('jeweller', pctx)).toBe(false);
        expect(MarketStalls.eligible(poor, pctx).map(e => e.id)).not.toContain('jeweller');
        const many = Array.from({ length: 40 }, (_, i) => `o:${i},${i}`);
        expect(Object.values(MarketStalls.assign(poor, many, pctx))).not.toContain('jeweller');
        // (nor a stationer in a village; a spice merchant only where traders bring goods in)
        expect(MarketStalls.allowed('stationer', pctx)).toBe(false);
        expect(MarketStalls.allowed('spicer', pctx)).toBe(false);
        const rich = town({}, 0.9);
        const rctx = ctxOf(rich);
        expect(rctx.tier).toBe('rich');
        expect(MarketStalls.allowed('jeweller', rctx)).toBe(true);
        rich.market.stock.silver_jewellery = Math.max(5, rich.market.stock.silver_jewellery || 0);
        expect(MarketStalls.eligible(rich, rctx).map(e => e.id)).toContain('jeweller');
    });

    it('a fishmonger only by water, and only with fish in the market', () => {
        const dry = town({}, 0.6);
        expect(MarketStalls.allowed('fishmonger', ctxOf(dry))).toBe(false);
        const port = town({ isPort: true }, 0.6);
        const ctx = ctxOf(port);
        expect(MarketStalls.allowed('fishmonger', ctx)).toBe(true);
        port.market.stock.fish = 0.5;
        port.market.stock.preserved_fish = 0;
        port.market.stock.crab = 0;
        expect(MarketStalls.weight('fishmonger', port, ctx)).toBe(0);
    });

    it('the fishmonger shows crabs on the counter only when the market has crabs', () => {
        const port = town({ isPort: true }, 0.6);
        port.market.stock.fish = 50;
        port.market.stock.crab = 0;
        expect(MarketStalls.wares(port, 'fishmonger')).not.toContain('crab');
        expect(MarketStalls.artFor('fishmonger', MarketStalls.wares(port, 'fishmonger'))).toBe('fishmonger_nocrab');
        port.market.stock.crab = 6;
        expect(MarketStalls.wares(port, 'fishmonger')).toContain('crab');
        expect(MarketStalls.artFor('fishmonger', MarketStalls.wares(port, 'fishmonger'))).toBe('fishmonger');
        // The crabless counter: fish only (the Seafood sheet's crab piles are its columns 7 and 11)
        const art = TownProps.stallArt('fishmonger_nocrab');
        expect(TownProps.stallVariant('fishmonger_nocrab')).toBeGreaterThan(0);
        expect(art.over.length).toBe(3);
        for (const [sheet, col] of art.over) expect(sheet === 'seafood' && (col === 7 || col === 11)).toBe(false);
    });

    it('the cheesemonger and the herbalist sell only what the market has made', () => {
        const s = town({}, 0.6);
        for (const id of ['butter', 'milk', 'healing_salve', 'tonic', 'poultice', 'rare_herbs']) expect(SettlementMarket.tracks(id), id).toBe(true);
        s.market.stock.butter = 0;
        s.market.stock.healing_salve = 0;
        expect(MarketStalls.wares(s, 'cheesemonger')).not.toContain('butter');
        expect(MarketStalls.wares(s, 'herbalist')).not.toContain('healing_salve');
        s.market.stock.butter = 5;
        s.market.stock.healing_salve = 3;
        s.market.stock.milk = 10;
        expect(MarketStalls.wares(s, 'cheesemonger')).toEqual(expect.arrayContaining(['butter', 'milk']));
        expect(MarketStalls.wares(s, 'herbalist')).toContain('healing_salve');
    });

    it("sell only their trade's goods, out of the market's stock, at the market's prices", () => {
        const s = town({ isPort: true }, 0.9);
        const tile = plains(s);
        const market = Trading.getAvailableGoods(s, tile, null);
        let compared = 0;
        for (const id of Object.keys(MarketStalls.trades())) {
            const T = MarketStalls.trade(id);
            const wares = Trading.stallGoods(s, tile, null, id);
            for (const w of wares) {
                expect(T.goods, `${id}: ${w.id}`).toContain(w.id);
                if (SettlementMarket.tracks(w.id)) {
                    expect(w.quantity).toBe(SettlementMarket.available(s, w.id));
                    expect(w.quantity).toBeGreaterThanOrEqual(1);
                }
                // The same price as the town market asks
                const m = market.find(g => g.id === w.id);
                if (m) { expect(w.price, `${id}: ${w.id}`).toBe(m.price); compared++; }
            }
        }
        expect(compared).toBeGreaterThan(5);
        // Nothing the market hasn't got: the fish gone, the fishmonger's slab is bare
        s.market.stock.fish = 0;
        s.market.stock.preserved_fish = 0;
        s.market.stock.crab = 0;
        expect(Trading.stallGoods(s, tile, null, 'fishmonger')).toEqual([]);
    });

    it("buy from a stall takes the town's stock and pays its purse", () => {
        const s = town({ economy: { gold: 5000 } }, 0.6);
        const tile = plains(s);
        const bread = Trading.stallGoods(s, tile, null, 'baker').find(g => g.id === 'bread');
        expect(bread).toBeTruthy();
        const before = SettlementMarket.stock(s, 'bread');
        const p = player();
        const res = Trading.buyGoods(p, bread, 5, s);
        expect(res.success).toBe(true);
        expect(SettlementMarket.stock(s, 'bread')).toBeCloseTo(before - 5, 1);
        expect(p.inventory.bread).toBe(5);
    });

    it("its keeper buys back only goods of the trade: the fishmonger takes your catch, not your bread", () => {
        const s = town({ isPort: true, economy: { gold: 50000 } }, 0.6);
        const p = player({ inventory: { small_fish: 4, bread: 3 } });
        const no = Trading.sellToStall(p, 'fishmonger', 'bread', 3, s, null);
        expect(no.success).toBe(false);
        expect(no.notTrade).toBe(true);
        expect(p.inventory.bread).toBe(3);
        const yes = Trading.sellToStall(p, 'fishmonger', 'small_fish', 4, s, null);
        expect(yes.success).toBe(true);
        expect(p.inventory.small_fish || 0).toBe(0);
        // ...at the price the town market would pay
        const q = town({ isPort: true, economy: { gold: 50000 } }, 0.6);
        const p2 = player({ inventory: { small_fish: 4 } });
        expect(Trading.sellGoods(p2, 'small_fish', 4, q, null).earned).toBe(yes.earned);
        expect(MarketStalls.accepts('fishmonger', 'crab')).toBe(true);
        expect(MarketStalls.accepts('baker', 'small_fish')).toBe(false);
    });

    it('name the stall by its trade and keeper', () => {
        expect(MarketStalls.stallName('fishmonger', 'Marta Holt')).toBe("Marta's Fish Stall");
        expect(MarketStalls.stallName('baker', 'Nils')).toBe("Nils' Bread Stall");
        expect(MarketStalls.stallName('baker')).toBe('The Bread Stall');
        expect(MarketStalls.cry('fishmonger', 0, 'fish', 'Ashford')).toBe('Fresh fish! Caught this morning!');
    });
});

describe('Market stalls on the town map', () => {
    function makeGame(type = 'city') {
        const settlement = { name: 'Testby', type, population: 4000, q: 5, r: 6, kingdom: 'k1', culture: 'Imperial' };
        const kingdom = { id: 'k1', name: 'Valdoria', ruler: 'King Aldric', religion: { faithId: 'solaris', name: 'The Solar Covenant' }, wars: [] };
        const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
        const world = {
            day: 3, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
            getTile: () => worldTile,
            getSettlementViews: () => [settlement],
            getKingdom: id => (id === 'k1' ? kingdom : null),
        };
        return { world, player: {}, settlement };
    }
    const enter = (game) => {
        InnerMap.timeOfDay = 10;
        InnerMap._timeAccumulator = 0;
        InnerMap.dayEnded = false;
        InnerMap._cache = {};
        InnerMap._interiorCache = {};
        InnerMap._insideBuilding = null;
        InnerMap._outerMapState = null;
        InnerMap.enter(game, 5, 6);
    };

    beforeEach(() => {
        InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
        Utils.setSeed(7);
    });

    it('gives each square stall its trade, its wares on the counter, its keeper named — the same next visit', () => {
        const game = makeGame('capital');
        enter(game);
        const stalls = InnerMap._squareStalls();
        expect(stalls.length).toBeGreaterThan(1);
        const first = {};
        for (const s of stalls) {
            const info = InnerMap.stallAt(s.q, s.r);
            expect(info).toBeTruthy();
            first[s.key] = info.trade;
            const obj = InnerMap.tiles[s.r][s.q].customObject;
            expect(obj.defId).toBe('tp_stall');
            expect(obj.colorVariantIdx).toBe(TownProps.stallVariant(MarketStalls.artOf(info.trade)));
            // (a click on the awning finds the same stall)
            expect(InnerMap.stallAt(s.q + 1, s.r - 2).trade).toBe(info.trade);
        }
        expect(new Set(Object.values(first)).size).toBe(stalls.length);
        // Its keeper, in market hours, gives the stall their name and sells its wares
        const st = InnerMap._scn.stalls.find(x => x.vendorId != null);
        expect(st).toBeTruthy();
        const v = InnerMap.npcs.find(n => n.id === st.vendorId);
        const kept = InnerMap.stallOfKeeper(v);
        expect(kept.trade).toBe(st.trade);
        expect(kept.name).toContain(String(v.name).split(' ')[0]);
        // ...and cries its own wares
        expect(typeof InnerMap._sceneHawk(v)).toBe('string');
        // Leave and come back: the same trades
        enter(game);
        for (const s of InnerMap._squareStalls()) expect(InnerMap.stallAt(s.q, s.r).trade).toBe(first[s.key]);
    });
    it("gives the marketplace hall's stalls their trades and names", () => {
        const game = makeGame('capital');
        enter(game);
        const hall = (InnerMap.buildings || []).find(b => String(b.type).replace(/^player_/, '') === 'marketplace');
        expect(hall).toBeTruthy();
        InnerMap.enterBuilding(hall, game);
        const stalls = InnerMap._hallStalls(hall);
        expect(stalls.length).toBeGreaterThan(0);
        const trades = stalls.map(s => {
            const info = InnerMap.stallAt(s.q, s.r);
            expect(info && info.indoor).toBe(true);
            for (const t of s.tiles) expect(t._furniture.name).toBe(MarketStalls.trade(info.trade).stall);
            return info.trade;
        });
        expect(new Set(trades).size).toBe(trades.length);
        expect(Object.keys(game.settlement.stallTrades).some(k => k.startsWith('in:'))).toBe(true);
        // Each wears its trade's goods on the counter: its 2×1 piece drawn from `stall_<art>_2x1`
        const F = DataLoader._gamedata.innerMapRenderer.interiorArt.furniture;
        for (const s of stalls) {
            const info = InnerMap.stallAt(s.q, s.r);
            const want = InnerMap.hallStallArt(MarketStalls.artFor(info.trade, MarketStalls.wares(game.settlement, info.trade, InnerMap._currentWorldTileRef || null)));
            for (const t of s.tiles) expect(t._furniture.art).toBe(want);
            if (s.tiles[0]._furniture.piece) expect(F[`${want}_2x1`]).toBeTruthy();
        }
    });
    it("has a hall stall look for every trade's stall art", () => {
        const F = DataLoader._gamedata.innerMapRenderer.interiorArt.furniture;
        const keys = Object.keys(DataLoader._gamedata.townProps.stallArt);
        expect(keys.length).toBeGreaterThan(10);
        for (const k of keys) {
            const a = F[`${InnerMap.hallStallArt(k)}_2x1`];
            expect(a, k).toBeTruthy();
            expect(a.sheet).toBe('assets/buildingKit/stalls_trade.png');
            expect([a.sw, a.sh]).toEqual([96, 92]);
            expect(fs.existsSync(a.sheet)).toBe(true);
        }
        expect(InnerMap.hallStallArt(null)).toBe('stall');
    });
});

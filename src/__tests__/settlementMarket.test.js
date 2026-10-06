/**
 * The settlement goods economy (world/settlementMarket.js, ticked by
 * systems/marketDynamics.js): production and consumption, the one price
 * model, buying and selling against real stock, NPC trade flows and their
 * disruption, shortage effects, save/load and determinism.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Kingship } from '../systems/kingship.js';
import { Ships } from '../systems/ships.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

const GOODS = () => PlayerEconomy.GOODS;
const town = (extra = {}) => ({ name: 'Ashford', type: 'town', population: 2000, happiness: 50, ...extra });
const plains = (q = 0, r = 0, settlement = null) => ({ q, r, terrain: { id: 'plains', passable: true }, resource: null, settlement });
const player = (extra = {}) => ({ gold: 100000, inventory: {}, maxInventory: 99, skills: { commerce: 0 }, ...extra });
const basePrices = () => Object.fromEntries(SettlementMarket.config().goodIds.map(id => [id, GOODS()[id.toUpperCase()].basePrice]));

/** A tiny world of settlements on plains, for the trade tick. */
function miniWorld(towns, opts = {}) {
    const tiles = new Map();
    for (const t of towns) tiles.set(`${t.q},${t.r}`, plains(t.q, t.r, t.settlement));
    const kingdoms = opts.kingdoms || [];
    return {
        width: 40, height: 40, day: opts.day || 50, activeEvents: [], units: opts.units || [],
        kingdoms,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || plains(q, r),
        getSettlementViews: () => towns.map(t => { t.settlement.q = t.q; t.settlement.r = t.r; return t.settlement; }),
    };
}

describe('production and consumption', () => {
    it('a new market starts at its equilibrium, so prices start at the old base', () => {
        const s = town();
        const m = SettlementMarket.ensure(s);
        expect(m.stock.grain).toBeCloseTo(SettlementMarket.target(s, 'grain'), 1);
        expect(SettlementMarket.scarcity(s, 'grain')).toBeCloseTo(1, 5);
        // Goods a town doesn't use start empty (a village keeps no weapons)
        expect(SettlementMarket.ensure({ type: 'village', population: 300 }).stock.weapons).toBe(0);
    });

    it('people eat the stores down without production, and fill them with it', () => {
        const hungry = town();
        SettlementMarket.ensure(hungry);
        const before = SettlementMarket.stock(hungry, 'grain');
        for (let d = 0; d < 10; d++) SettlementMarket.processSettlement(hungry, {}, { day: 40 + d });
        expect(SettlementMarket.stock(hungry, 'grain')).toBeLessThan(before);
        const fed = town();
        SettlementMarket.ensure(fed);
        for (let d = 0; d < 10; d++) SettlementMarket.processSettlement(fed, { grain: 60, fish: 5 }, { day: 40 + d });
        expect(SettlementMarket.stock(fed, 'grain')).toBeGreaterThan(before);
    });

    it('local industry works grain into bread, and iron and coal into tools where the town has smiths', () => {
        const s = town();
        const m = SettlementMarket.ensure(s);
        m.stock.bread = 0;
        m.stock.tools = 0;
        m.stock.grain = 500;
        m.stock.iron = 100;
        m.stock.coal = 100;
        SettlementMarket.processSettlement(s, {}, { day: 40 });
        expect(m.stock.bread).toBeGreaterThan(0);
        expect(m.stock.tools).toBeGreaterThan(0);
        expect(m.stock.iron).toBeLessThan(100);
        // A village has no smithy
        const v = { type: 'village', population: 400 };
        const mv = SettlementMarket.ensure(v);
        mv.stock.iron = 100; mv.stock.coal = 100; mv.stock.tools = 0;
        SettlementMarket.processSettlement(v, {}, { day: 40 });
        expect(mv.stock.tools).toBe(0);
    });

    it('cold weather burns through firewood faster', () => {
        const warm = town(), cold = town();
        SettlementMarket.ensure(warm); SettlementMarket.ensure(cold);
        SettlementMarket.processSettlement(warm, {}, { day: 100, cold: false });
        SettlementMarket.processSettlement(cold, {}, { day: 100, cold: true });
        expect(cold.market.stock.firewood).toBeLessThan(warm.market.stock.firewood);
    });

    it('the land, its resources and the breakdown shape what a town brings to market', () => {
        const s = town();
        const forest = { shares: { forest: 1, pasture: 0, upland: 0, water: 0, arid: 0, cold: 0 }, fertility: 0.8, resources: [] };
        const coast = { shares: { forest: 0, pasture: 0, upland: 0, water: 0.6, arid: 0, cold: 0 }, fertility: 1, resources: [{ id: 'fish', direct: true }] };
        const pf = SettlementMarket.production(s, forest, { food: 33, items: { textiles: 10 } }, 33);
        const pc = SettlementMarket.production(s, coast, { food: 33, items: { textiles: 10, iron: 8 } }, 33);
        expect(pf.wood).toBeGreaterThan(pc.wood);
        expect(pc.fish).toBeGreaterThan(pf.fish || 0);
        expect(pc.iron).toBeGreaterThan(0);
        // A richer harvest (the breakdown's food multiplier) grows more grain
        const rich = SettlementMarket.production(s, forest, { food: 66, items: {} }, 33);
        expect(rich.grain).toBeGreaterThan(pf.grain);
    });
});

describe('one price model', () => {
    it('price climbs as the stock falls and drops in a glut, within the clamps', () => {
        const s = town();
        const m = SettlementMarket.ensure(s);
        const P = SettlementMarket.config().price;
        const tile = plains(0, 0, s);
        const grain = GOODS().GRAIN;
        const at = (stock) => { m.stock.grain = stock; return Economy.marketPrice(grain, s, tile, null); };
        const t = SettlementMarket.target(s, 'grain');
        expect(at(t * 0.3)).toBeGreaterThan(at(t));
        expect(at(t * 4)).toBeLessThan(at(t));
        m.stock.grain = 0;
        expect(SettlementMarket.scarcity(s, 'grain')).toBe(P.max);
        m.stock.grain = t * 100;
        expect(SettlementMarket.scarcity(s, 'grain')).toBe(P.min);
    });

    it('every reader sees the same stock: market ask, sale value, regional price, caravans', () => {
        const s = town();
        const m = SettlementMarket.ensure(s);
        const tile = plains(3, 3, s);
        const world = { width: 20, day: 50, activeEvents: [], getTile: (q, r) => (q === 3 && r === 3 ? tile : plains(q, r)) };
        m.stock.tools = SettlementMarket.target(s, 'tools') * 0.2;
        const tools = GOODS().TOOLS;
        const value = SettlementMarket.value(world, s, tile, 'tools', tools.basePrice);
        expect(value).toBeGreaterThan(tools.basePrice * 1.5);
        expect(MarketDynamics.getPrice('tools', 3, 3, world)).toBe(Math.round(value));
        expect(Trading.getSellPrice(tools, world, s, tile)).toBe(Math.floor(value * Trading.SELL_SHARE));
        expect(Economy.marketPrice(tools, s, tile, world)).toBe(Math.floor(Economy.marketAskBase(tools, s, tile, world) * SettlementMarket.scarcity(s, 'tools')));
        // A big lot is worth less a unit than one: it floods the stalls
        const lot = SettlementMarket.lotValue(world, s, tile, 'tools', tools.basePrice, 200);
        expect(lot / 200).toBeLessThan(value);
    });

    it('keeps the old modifiers: size, season, cold demand, local resources and monopoly markups', () => {
        const grain = GOODS().GRAIN;
        const village = { type: 'village', population: 300 }, capital = { type: 'capital', population: 20000 };
        expect(Economy.marketPrice(grain, village, plains(), null)).toBeGreaterThan(Economy.marketPrice(grain, capital, plains(), null));
        expect(Economy.marketPrice(grain, capital, plains(), { day: 112 })).toBeGreaterThan(Economy.marketPrice(grain, capital, plains(), { day: 88 }));
        const wheat = { ...plains(), resource: { id: 'wheat' } };
        expect(Economy.marketPrice(grain, capital, wheat, null)).toBeLessThan(Economy.marketPrice(grain, capital, plains(), null));
        const crown = { type: 'town', population: 2000, monopolies: { grain: { holder: 'crown', markup: 0.5 } } };
        expect(Economy.marketPrice(grain, crown, plains(), null)).toBeGreaterThan(Economy.marketPrice(grain, town(), plains(), null));
    });
});

describe('buying and selling move real stock', () => {
    it('buying takes stock and raises the price; selling adds it back and lowers it', () => {
        const s = town();
        const tile = plains(0, 0, s);
        const p = player();
        const entry = () => Trading.getAvailableGoods(s, tile, null).find(g => g.id === 'bread');
        const e = entry();
        const before = SettlementMarket.stock(s, 'bread');
        const res = Trading.buyGoods(p, e, 30, s);
        expect(res.success).toBe(true);
        expect(SettlementMarket.stock(s, 'bread')).toBeCloseTo(before - 30, 1);
        expect(entry().scarcity).toBeGreaterThan(e.scarcity);
        expect(entry().price).toBeGreaterThanOrEqual(e.price);
        // Thirty units cost more than thirty at the first unit's price
        expect(res.spent).toBeGreaterThan(e.price * 30);
        const scarcityAfterBuy = entry().scarcity;
        expect(Trading.sellGoods(p, 'bread', 30, s, null).success).toBe(true);
        expect(SettlementMarket.stock(s, 'bread')).toBeCloseTo(before, 1);
        expect(entry().scarcity).toBeLessThan(scarcityAfterBuy);
    });

    it('cannot buy more than the stalls hold', () => {
        const s = town();
        const e = Trading.getAvailableGoods(s, plains(0, 0, s), null).find(g => g.id === 'bread');
        expect(Trading.buyGoods(player(), e, e.quantity + 1, s).success).toBe(false);
        expect(Trading.affordable(player({ gold: e.price * 3 }), e, s)).toBeLessThanOrEqual(3);
    });

    it('no buy-and-sell-back loop on the same tile, however big the trade bonuses or the lot', () => {
        const s = town({ kingdom: 'k1' });
        const tile = plains(4, 4, s);
        const world = { width: 20, height: 20, day: 30, activeEvents: [], getTile: (q, r) => (q === 4 && r === 4 ? tile : plains(q, r)), getKingdom: () => null };
        for (const id of ['grain', 'bread', 'tools', 'wood', 'beer']) {
            for (const qty of [1, 10, 40]) {
                const p = player({ tradeAgreements: { k1: { untilDay: 999 } }, skills: { commerce: 10 } });
                const e = Trading.getAvailableGoods(s, tile, world).find(g => g.id === id);
                if (!e || e.quantity < qty) continue;
                const goldBefore = p.gold;
                expect(Trading.buyGoods(p, e, qty, s).success).toBe(true);
                expect(Trading.sellGoods(p, id, qty, s, world).success).toBe(true);
                expect(p.gold, `${id} x${qty}`).toBeLessThan(goldBefore);
            }
        }
    });
});

describe('NPC trade flows', () => {
    const pair = () => {
        const a = town({ name: 'Glut' }), b = town({ name: 'Dearth' });
        SettlementMarket.ensure(a); SettlementMarket.ensure(b);
        a.economy = { gold: 0 }; b.economy = { gold: 0 };
        a.market.stock.grain = SettlementMarket.target(a, 'grain') * 4;
        b.market.stock.grain = SettlementMarket.target(b, 'grain') * 0.1;
        return { a, b };
    };
    const link = (a, b, extra = {}) => ({ a, b, dist: 3, sea: false, road: false, routes: 1, friction: 0.1, base: 200, capacity: 200, factor: 1, ...extra });

    it('move goods from glut to dearth until the prices meet, and pay both towns the margin', () => {
        const { a, b } = pair();
        const gap0 = SettlementMarket.scarcity(b, 'grain') / SettlementMarket.scarcity(a, 'grain');
        let gold = 0;
        for (let d = 0; d < 40; d++) gold += SettlementMarket.flows([link(a, b)], basePrices()).gold;
        const gap1 = SettlementMarket.scarcity(b, 'grain') / SettlementMarket.scarcity(a, 'grain');
        expect(gap1).toBeLessThan(gap0);
        expect(gap1).toBeLessThan(gap0 / 2);
        expect(gold).toBeGreaterThan(0);
        expect(a.economy.tradeIncome).toBeGreaterThan(0);
        // The settlement banks it through Economy.processTrade
        const credited = Economy.processTrade(b);
        expect(credited).toBeGreaterThan(0);
        expect(b.economy.gold).toBe(credited);
        expect(b.economy.tradeIncome).toBe(0);
    });

    it('a cut link (war, blockade, siege) moves nothing and the dearth stays', () => {
        const { a, b } = pair();
        const before = SettlementMarket.stock(b, 'grain');
        SettlementMarket.flows([link(a, b, { factor: 0 })], basePrices());
        expect(SettlementMarket.stock(b, 'grain')).toBe(before);
    });

    it('war between the realms, a closed blockade, a siege and an outlaw lair cut or thin the links', () => {
        const mk = () => {
            const a = town({ name: 'A', kingdom: 'k1', q: 5, r: 5 }), b = town({ name: 'B', kingdom: 'k2', q: 8, r: 5 });
            return { a, b, world: miniWorld([{ q: 5, r: 5, settlement: a }, { q: 8, r: 5, settlement: b }], {
                kingdoms: [{ id: 'k1', name: 'One', isAlive: true, wars: [] }, { id: 'k2', name: 'Two', isAlive: true, wars: [] }],
            }) };
        };
        const factor = (world, a, b, playerState = null, extra = {}) => {
            const l = link(a, b, extra);
            MarketDynamics._disrupt(world, playerState, [l]);
            return l.factor;
        };
        let g = mk();
        expect(factor(g.world, g.a, g.b)).toBe(1);
        g = mk();
        g.world.kingdoms[0].wars = ['k2']; g.world.kingdoms[1].wars = ['k1'];
        expect(factor(g.world, g.a, g.b)).toBe(0);
        g = mk();
        const besieger = { sieges: { active: { q: 8, r: 5 } } };
        expect(factor(g.world, g.a, g.b, besieger)).toBe(0);
        g = mk();
        const outlaws = { outlawLairs: { lairs: [{ id: 'l1', status: 'active', q: 6, r: 5, strength: 80 }] } };
        expect(factor(g.world, g.a, g.b, outlaws)).toBeLessThan(0.5);
        g = mk();
        g.world.units = [{ type: 'raider', q: 7, r: 5, destroyed: false }];
        expect(factor(g.world, g.a, g.b)).toBeLessThan(1);
    });

    it('a disrupted supply line leaves the importing town short', () => {
        const run = (cut) => {
            const { a, b } = pair();
            const l = link(a, b, { factor: cut ? 0 : 1 });
            for (let d = 0; d < 30; d++) {
                SettlementMarket.processSettlement(b, {}, { day: 30 + d });
                SettlementMarket.flows([l], basePrices());
            }
            return b;
        };
        const open = run(false), shut = run(true);
        const food = (s) => SettlementMarket.config().groups.food.reduce((n, id) => n + SettlementMarket.stock(s, id), 0);
        expect(food(shut)).toBeLessThan(food(open));
        expect(SettlementMarket.foodShortage(shut)).toBeGreaterThan(SettlementMarket.foodShortage(open));
    });
});

describe('shortages matter', () => {
    const starve = (s, days = 40) => {
        SettlementMarket.ensure(s);
        for (const id of SettlementMarket.config().groups.food) s.market.stock[id] = 0;
        for (let d = 0; d < days; d++) SettlementMarket.processSettlement(s, {}, { day: 30 + d });
        return s;
    };

    it('a sustained food shortage is a dearth: the granary is strained and the crown sees hunger', () => {
        const s = starve(town());
        expect(SettlementMarket.inDearth(s)).toBe(true);
        expect(SettlementMarket.foodStrain(s)).toBeGreaterThan(0);
        // Economy._feedPopulation eats harder into the granary
        const fed = town({ economy: { gold: 0, food: 500 } });
        const hungry = { ...s, economy: { gold: 0, food: 500 } };
        Economy._feedPopulation(fed, {});
        Economy._feedPopulation(hungry, { consumption: SettlementMarket.foodStrain(s) });
        expect(hungry.economy.food).toBeLessThan(fed.economy.food);
        // Kingship.hunger reads it outside the lean weeks too (the famine dole relieves it)
        expect(Kingship.hunger({ day: 60, activeEvents: [], getTile: () => plains() }, { settlement: s, tile: plains() })).toBe('lean');
    });

    it('missing tools slow a town\'s workshops (Economy.produceDaily reads the shortage)', () => {
        const s = town();
        SettlementMarket.ensure(s);
        s.market.stock.tools = 0;
        for (let d = 0; d < 40; d++) SettlementMarket.processSettlement(s, {}, { day: 30 + d });
        expect(SettlementMarket.toolFactor(s)).toBeLessThan(1);
        const t1 = plains(0, 0, s);
        const ok = town();
        const t2 = plains(0, 0, ok);
        const world = { width: 10, day: 30, activeEvents: [], getTile: () => null };
        Economy.produceDaily(s, t1, world);
        Economy.produceDaily(ok, t2, world);
        expect(s.economy.production.goods).toBeLessThanOrEqual(ok.economy.production.goods);
        expect(s.economy.gold).toBeLessThan(ok.economy.gold);
    });

    it('a cold winter without fuel sours the mood, and it comes back when the fuel does', () => {
        const s = town({ happiness: 60 });
        SettlementMarket.ensure(s);
        for (let d = 0; d < 30; d++) {
            s.market.stock.firewood = 0; s.market.stock.coal = 0;
            SettlementMarket.processSettlement(s, {}, { day: 90 + d, cold: true });
        }
        expect(s.happiness).toBeLessThan(60);
        expect(s.marketMood).toBeLessThan(0);
        for (let d = 0; d < 80; d++) SettlementMarket.processSettlement(s, { firewood: 50, coal: 5 }, { day: 1 + d, cold: false });
        expect(s.marketMood || 0).toBeGreaterThanOrEqual(0);
    });

    it('plenty of beer and fine things lifts the mood a little', () => {
        const s = { name: 'Gild', type: 'capital', population: 8000, happiness: 50 };
        SettlementMarket.ensure(s);
        const lots = {};
        for (const grp of ['drink', 'luxury']) for (const id of SettlementMarket.config().groups[grp]) lots[id] = SettlementMarket.need(s, id) * 6;
        for (let d = 0; d < 120; d++) SettlementMarket.processSettlement(s, lots, { day: 40 + d });
        expect(s.market.plenty).toBeGreaterThan(SettlementMarket.config().shortage.plentyAt);
        expect(s.marketMood).toBeGreaterThan(0);
        expect(s.happiness).toBeGreaterThan(50);
        expect(s.happiness).toBeLessThanOrEqual(50 + SettlementMarket.config().shortage.plentyMood + 0.01);
    });

    it('a sack or a raid carries off the stores', () => {
        const s = town();
        SettlementMarket.ensure(s);
        const before = SettlementMarket.stock(s, 'grain');
        SettlementMarket.loot(s, 0.5);
        expect(SettlementMarket.stock(s, 'grain')).toBeCloseTo(before / 2, 1);
    });
});

describe('ports and tavern talk read the same markets', () => {
    it('a port prices goods the town keeps from its stock, and cargo lands in it', () => {
        const s = town();
        const tile = { q: 5, r: 5, terrain: { id: 'grassland', passable: true }, settlement: s };
        const world = { width: 20, height: 20, day: 10, getTile: (q, r) => (q === 5 && r === 5 ? tile : { q, r, terrain: { id: 'ocean', passable: false } }) };
        SettlementMarket.ensure(s);
        s.market.stock.fish = 0;
        const dear = Ships.getPortMarket(world, 5, 5).find(e => e.id === 'fish');
        s.market.stock.fish = SettlementMarket.target(s, 'fish') * 5;
        const cheap = Ships.getPortMarket(world, 5, 5).find(e => e.id === 'fish');
        expect(dear.basePrice).toBeGreaterThan(cheap.basePrice);
    });
});

describe('save, load and determinism', () => {
    it('markets survive a save round trip and carry on exactly as before', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const marketsOf = (w) => JSON.stringify(w.getSettlementViews().map(s => [s.q, s.r, s.market, s.economy && s.economy.tradeIncome]));
        let a = newGame(5150);
        for (let i = 0; i < 12; i++) endDay(a);
        let b = roundTrip(a);
        expect(marketsOf(b.world)).toBe(marketsOf(a.world));
        // ...and the next days come out the same in both games
        MarketDynamics.updatePrices(a.world, a.player);
        MarketDynamics.updatePrices(b.world, b.player);
        expect(marketsOf(b.world)).toBe(marketsOf(a.world));
        vi.restoreAllMocks();
    });

    it('old saves get markets at equilibrium; their bought-counters and stockpiles are dropped', () => {
        const s = town({ marketStock: { grain: 40 }, economy: { gold: 0, food: 0, stockpile: { textiles: 9999 } } });
        const world = miniWorld([{ q: 1, r: 1, settlement: s }]);
        MarketDynamics.initialize();
        SaveLoad.restoreMarkets({ markets: { '1-1': { prices: {} } } }, world);
        expect(s.market && s.market.stock.grain).toBeGreaterThan(0);
        expect(s.marketStock).toBeUndefined();
        expect(s.economy.stockpile).toBeUndefined();
        expect(MarketDynamics.regionalMarkets).toEqual({});
    });

    it('the same seed gives the same markets (no RNG drawn by the market)', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const run = () => {
            const g = newGame(5151);
            for (let i = 0; i < 8; i++) endDay(g);
            return JSON.stringify(g.world.getSettlementViews().map(s => s.market));
        };
        expect(run()).toBe(run());
        // The market tick itself draws nothing from the shared stream
        const g = newGame(5152);
        endDay(g);
        Utils.setSeed(99);
        const before = Utils.random();
        Utils.setSeed(99);
        MarketDynamics.updatePrices(g.world, g.player);
        expect(Utils.random()).toBe(before);
        vi.restoreAllMocks();
    });
});

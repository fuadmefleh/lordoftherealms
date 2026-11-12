/**
 * Vegetables and fruit in the markets (data/markets.json produce;
 * world/settlementMarket.js): real goods grown by the land, the climate and
 * the season, eaten as food, spoiling, pressed into cider and wine, stocked
 * by the greengrocer, and backfilled into markets saved before them.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SettlementMarket } from '../world/settlementMarket.js';
import { MarketStalls } from '../world/marketStalls.js';
import { Harvests } from '../world/harvests.js';
import { TownProps } from '../world/townProps.js';
import { Crops } from '../systems/crops.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { DataLoader } from '../core/dataLoader.js';
import { loadData } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

const VEG = ['cabbage', 'turnips', 'carrots', 'onions', 'beans'];
const FRUIT = ['apples', 'pears', 'plums', 'cherries', 'grapes', 'olives', 'dates'];
const town = (extra = {}) => ({ name: 'Ashford', type: 'town', population: 2000, happiness: 50, ...extra });
// Days of the year: spring 1-30, summer 31-60, autumn 61-90, winter 91-120
const SPRING = 15, SUMMER = 45, AUTUMN = 75, WINTER = 105;

/** A one-hex world of `terrain` at `temp` (the tile's climate, 0 polar .. 1 tropical). */
function land(terrain, temp, river = false) {
    const tile = (q, r) => ({ q, r, terrain: { id: terrain, passable: true }, temperature: temp, hasRiver: river });
    const world = { width: 40, height: 40, getTile: (q, r) => tile(q, r) };
    return SettlementMarket.landProfile(world, 5, 5);
}

describe('the goods', () => {
    it('every vegetable and fruit is a traded good with a price, a store and a place among the foods', () => {
        const C = SettlementMarket.config();
        for (const id of [...VEG, ...FRUIT, 'berries', 'mushrooms', 'eggs', 'honey', 'herbs']) {
            expect(SettlementMarket.tracks(id), id).toBe(true);
            expect(PlayerEconomy.GOODS[id.toUpperCase()].basePrice, id).toBeGreaterThan(0);
            expect(SettlementMarket.produceDef(id), id).toBeTruthy();
        }
        for (const id of [...VEG, ...FRUIT, 'eggs']) expect(C.isFood[id], id).toBe(true);
        // A town's market keeps them from the start, at its target: prices start at the base
        const s = town();
        SettlementMarket.ensure(s);
        for (const id of ['cabbage', 'turnips', 'onions', 'apples', 'pears']) {
            expect(SettlementMarket.stock(s, id), id).toBeGreaterThan(0);
            expect(SettlementMarket.scarcity(s, id), id).toBeCloseTo(1, 5);
        }
        // ...and you can buy from it (the stock falls, the price climbs) and sell to it
        const before = SettlementMarket.stock(s, 'apples');
        expect(SettlementMarket.take(s, 'apples', 3)).toBe(3);
        expect(SettlementMarket.scarcity(s, 'apples')).toBeGreaterThan(1);
        SettlementMarket.add(s, 'apples', 3);
        expect(SettlementMarket.stock(s, 'apples')).toBeCloseTo(before, 5);
    });

    it('the exotic fruit is a city taste; a village does not use olives or dates', () => {
        expect(SettlementMarket.uses({ type: 'village', population: 400 }, 'dates')).toBe(false);
        expect(SettlementMarket.uses({ type: 'city', population: 9000 }, 'dates')).toBe(true);
        expect(SettlementMarket.uses({ type: 'village', population: 400 }, 'cabbage')).toBe(true);
    });

    it('moves from the town with a glut to the town without, and both are paid', () => {
        const a = town({ name: 'Orchard', economy: { gold: 5000 } }), b = town({ name: 'Mill', economy: { gold: 5000 } });
        SettlementMarket.ensure(a); SettlementMarket.ensure(b);
        a.market.stock.apples = SettlementMarket.target(a, 'apples') * 3;
        b.market.stock.apples = 0;
        const bases = Object.fromEntries(SettlementMarket.config().goodIds.map(id => [id, PlayerEconomy.GOODS[id.toUpperCase()].basePrice]));
        const flow = SettlementMarket.flows([{ a, b, friction: 0.1, capacity: 500, factor: 1 }], bases);
        expect(flow.moved).toBeGreaterThan(0);
        expect(SettlementMarket.stock(b, 'apples')).toBeGreaterThan(0);
        expect(a.economy.gold).toBeGreaterThan(5000);
    });
});

describe('where it comes from: the land, the climate and the season', () => {
    it('a cool farming town grows roots and apples, not dates; a hot desert town dates and olives, few apples', () => {
        const cool = SettlementMarket.production(town(), land('plains', 0.3), null, 0);
        const hot = SettlementMarket.production(town(), land('desert', 0.85), null, 0);
        expect(cool.cabbage).toBeGreaterThan(0);
        expect(cool.turnips).toBeGreaterThan(0);
        expect(cool.apples).toBeGreaterThan(0);
        expect(cool.dates || 0).toBe(0);
        expect(cool.olives || 0).toBe(0);
        expect(hot.dates).toBeGreaterThan(0);
        expect(hot.olives).toBeGreaterThan(0);
        expect(hot.grapes).toBeGreaterThan(0);
        expect(hot.apples || 0).toBeLessThan(cool.apples * 0.3);
        // Forest gives berries and mushrooms; open fields few
        const wood = SettlementMarket.production(town(), land('woodland', 0.45), null, 0);
        const field = SettlementMarket.production(town(), land('plains', 0.45), null, 0);
        expect(wood.mushrooms).toBeGreaterThan(field.mushrooms * 2);
        expect(wood.berries).toBeGreaterThan(field.berries * 2);
    });

    it('the culture tends its own crops: a Desert town more dates, a Nordic one more turnips', () => {
        const desertLand = land('desert', 0.85), coolLand = land('plains', 0.35);
        expect(SettlementMarket.production(town({ culture: 'Desert' }), desertLand, null, 0).dates)
            .toBeGreaterThan(SettlementMarket.production(town({ culture: 'Imperial' }), desertLand, null, 0).dates);
        expect(SettlementMarket.production(town({ culture: 'Nordic' }), coolLand, null, 0).turnips)
            .toBeGreaterThan(SettlementMarket.production(town({ culture: 'Imperial' }), coolLand, null, 0).turnips);
    });

    it('the grain, fish and meat the land yields are as they were (produce is grown beside them)', () => {
        const L = land('plains', 0.45);
        const prod = SettlementMarket.production(town(), L, null, 0);
        const C = SettlementMarket.config();
        const td = C.typeDemand.town;
        // food = staples' need x selfSupply x fertility, split by the land (no water, no herds: meatBase)
        let staples = 0;
        for (const id of C.groups.food) if (!C.produce[id] && SettlementMarket.uses(town(), id)) staples += 2000 * C.goods[id].perCapita * td;
        for (const [id, per] of Object.entries(C.food.grainFor)) staples += 2000 * C.goods[id].perCapita * td * per;
        const food = staples * C.food.selfSupply.town * L.fertility;
        expect(prod.grain + prod.meat + (prod.fish || 0)).toBeCloseTo(food, 3);
    });

    it('follows its season: cherries in summer, apples in autumn, nothing of either in winter', () => {
        const yieldOn = (id, day) => {
            const s = town();
            SettlementMarket.ensure(s);
            s.market.stock[id] = 0;
            SettlementMarket.processSettlement(s, { [id]: 1000 }, { day });
            return SettlementMarket.stock(s, id);
        };
        expect(yieldOn('cherries', SUMMER)).toBeGreaterThan(yieldOn('cherries', AUTUMN) * 5);
        expect(yieldOn('apples', AUTUMN)).toBeGreaterThan(yieldOn('apples', SUMMER) * 2);
        expect(yieldOn('apples', WINTER)).toBeLessThan(yieldOn('apples', AUTUMN) * 0.2);
        expect(yieldOn('cherries', WINTER)).toBe(0);
        // The staples' food curve is swapped out for the produce's own (ctx.foodSeason)
        expect(SettlementMarket.produceSeason('apples', AUTUMN)).toBeGreaterThan(2);
        expect(SettlementMarket.offSeason('cherries', WINTER)).toBe(true);
        expect(SettlementMarket.offSeason('onions', AUTUMN)).toBe(false);
        expect(SettlementMarket.offSeason('grain', WINTER)).toBe(false);
    });

    it('the harvest scales it: a blighted veg crop brings fewer cabbages, a bad vintage fewer grapes', () => {
        const s = town({ q: 0, r: 0 });
        s.farm = { mix: { grain: 0.5, veg: 0.2, fibre: 0.1, vine: 0.1, fallow: 0.1 }, ref: { grain: 0.5, veg: 0.2, fibre: 0.1, vine: 0.1, fallow: 0.1 }, soil: 1, y: { grain: 1, veg: 0.5, fibre: 1, vine: 0.4, stock: 1 }, yr: 0 };
        const prod = { cabbage: 10, grapes: 10, eggs: 10 };
        Harvests.applyToProduction(null, s, prod);
        expect(prod.cabbage).toBeCloseTo(5, 5);
        expect(prod.grapes).toBeCloseTo(4, 5);
        expect(prod.eggs).toBe(10);
    });

    it('the player grows it too: cabbage, turnip, carrot, onion and bean beds give their own goods', () => {
        expect(Crops.crop('cabbage').product).toBe('cabbage');
        expect(Crops.crop('turnip').product).toBe('turnips');
        expect(Crops.crop('carrot').product).toBe('carrots');
        expect(Crops.crop('onion').product).toBe('onions');
        expect(Crops.crop('beans').product).toBe('beans');
        for (const id of ['onion', 'beans']) expect(PlayerEconomy.GOODS[Crops.crop(id).seed.toUpperCase()]).toBeTruthy();
        // ...and a town's vegetable patch grows one of them a year, by where it lies
        const obj = { defId: 'tp_field_veg_ripe_4x3', fieldCycle: 'veg', fieldSeed: 3 };
        const crop = TownProps.fieldCrop(obj, 75);
        expect(VEG).toContain(crop.good);
        const goods = new Set([0, 1, 2, 3, 4].map(y => TownProps.fieldCrop(obj, 75 + y * 120).good));
        expect(goods.size).toBeGreaterThan(1);
    });

    it('fruit trees give their own fruit, palms dates', () => {
        const props = DataLoader._gamedata.townProps.props;
        const gives = (id) => (props.find(p => p.id === id).fell.gives || []).map(g => g.item);
        expect(gives('tp_tree_apple')).toContain('apples');
        expect(gives('tp_tree_pear')).toContain('pears');
        expect(gives('tp_tree_cherry')).toContain('cherries');
        expect(gives('tp_palm_1')).toContain('dates');
    });
});

describe('where it goes: eaten, spoiled, pressed', () => {
    it('counts toward feeding the town: a market of only vegetables and fruit still feeds its people', () => {
        const fed = town(), starved = town();
        for (const s of [fed, starved]) {
            SettlementMarket.ensure(s);
            for (const g of Object.keys(s.market.stock)) s.market.stock[g] = 0;
            s.market.short.food = 0;
        }
        for (const id of [...VEG, 'apples', 'pears']) fed.market.stock[id] = 400;
        for (let d = 0; d < 6; d++) {
            SettlementMarket.processSettlement(fed, {}, { day: AUTUMN + d });
            SettlementMarket.processSettlement(starved, {}, { day: AUTUMN + d });
        }
        expect(SettlementMarket.foodCover(fed)).toBeGreaterThan(0.95);
        expect(SettlementMarket.foodCover(starved)).toBeLessThan(0.5);
        // ...eaten out of the store
        expect(SettlementMarket.stock(fed, 'cabbage')).toBeLessThan(400);
    });

    it('spoils: fresh cherries and berries go first, cabbages soon, roots and onions keep, dried beans longest', () => {
        const left = (id) => {
            const s = { name: 'Store', type: 'town', population: 0 };
            SettlementMarket.ensure(s);
            s.market.stock[id] = 100;
            for (let d = 0; d < 10; d++) SettlementMarket.processSettlement(s, {}, { day: AUTUMN + d });
            return SettlementMarket.stock(s, id);
        };
        const cherries = left('cherries'), berries = left('berries'), cabbage = left('cabbage'), turnips = left('turnips'),
            onions = left('onions'), beans = left('beans'), grain = left('grain');
        expect(cherries).toBeLessThan(50);
        expect(berries).toBeLessThan(50);
        expect(cabbage).toBeGreaterThan(cherries);
        expect(turnips).toBeGreaterThan(cabbage);
        expect(onions).toBeGreaterThan(turnips);
        expect(beans).toBeGreaterThan(onions);
        // fresh produce spoils faster than grain
        expect(cabbage).toBeLessThan(grain);
    });

    it('the people eat what is in season: more cherries in summer than in winter', () => {
        const eaten = (day) => {
            const s = town();
            SettlementMarket.ensure(s);
            const t = SettlementMarket.target(s, 'cherries');
            s.market.stock.cherries = t;
            SettlementMarket.processSettlement(s, {}, { day });
            return t - SettlementMarket.stock(s, 'cherries');
        };
        expect(eaten(SUMMER)).toBeGreaterThan(eaten(WINTER) * 2);
    });

    it('the cider press takes the apple glut after the harvest, the winepress the grapes', () => {
        const s = town();
        SettlementMarket.ensure(s);
        s.market.stock.apples = SettlementMarket.target(s, 'apples') * 3;
        s.market.stock.cider = SettlementMarket.target(s, 'cider') * 0.5;
        s.market.stock.grapes = SettlementMarket.target(s, 'grapes') * 3;
        s.market.stock.wine = 0;
        const apples = s.market.stock.apples, cider = s.market.stock.cider;
        SettlementMarket.processSettlement(s, {}, { day: AUTUMN });
        expect(SettlementMarket.stock(s, 'cider')).toBeGreaterThan(cider);
        expect(SettlementMarket.stock(s, 'apples')).toBeLessThan(apples * 0.99 - SettlementMarket.need(s, 'apples') * 2);
        expect(SettlementMarket.stock(s, 'wine')).toBeGreaterThan(0);
        // The cook's recipes use them by name
        const recipes = DataLoader._gamedata.crafting.recipes;
        const r = (id) => recipes.find(x => x.id === id);
        expect(r('press_cider').ingredients.apples).toBeGreaterThan(0);
        expect(r('press_wine').ingredients.grapes).toBeGreaterThan(0);
        expect(r('pottage').ingredients.cabbage).toBeGreaterThan(0);
        expect(r('pickle_veg').ingredients.cabbage).toBeGreaterThan(0);
    });

    it('prices follow the seasons: dear produce in late winter, cheap at the harvest', () => {
        const world = (day) => ({ day, activeEvents: [] });
        const s = town();
        SettlementMarket.ensure(s);
        const base = PlayerEconomy.GOODS.TURNIPS.basePrice;
        const lateWinter = SettlementMarket.value(world(118), s, null, 'turnips', base);
        const harvest = SettlementMarket.value(world(80), s, null, 'turnips', base);
        expect(lateWinter).toBeGreaterThan(harvest * 1.2);
    });

    it('nobody frets over cherries in winter: out-of-season produce is no shortage', () => {
        const s = town();
        SettlementMarket.ensure(s);
        for (const g of Object.keys(s.market.stock)) s.market.stock[g] = SettlementMarket.target(s, g);
        s.market.stock.cherries = 0;
        s.market.day = WINTER;
        expect(SettlementMarket.worstShortage(s, 1.6)).toBeNull();
        s.market.day = SUMMER;
        expect(SettlementMarket.worstShortage(s, 1.6).id).toBe('cherries');
    });
});

describe('the greengrocer', () => {
    it('sells and buys the vegetables and fruit, and none of the vintner\'s cider', () => {
        const T = MarketStalls.trade('greengrocer');
        for (const id of [...VEG, ...FRUIT]) {
            expect(T.goods, id).toContain(id);
            expect(MarketStalls.accepts('greengrocer', id), id).toBe(true);
        }
        expect(T.goods).not.toContain('cider');
        const s = town();
        SettlementMarket.ensure(s);
        const wares = MarketStalls.wares(s, 'greengrocer');
        for (const id of ['cabbage', 'turnips', 'onions', 'beans', 'apples']) expect(wares, id).toContain(id);
        // The herbalist has herbs, mushrooms and berries of the market's own, the cheesemonger eggs
        expect(MarketStalls.wares(s, 'herbalist').filter(id => SettlementMarket.tracks(id)).length).toBeGreaterThanOrEqual(2);
        expect(MarketStalls.wares(s, 'cheesemonger')).toContain('eggs');
    });

    it('its stall wears what it has: fruit after the harvest, roots in winter', () => {
        expect(MarketStalls.artFor('greengrocer', ['apples', 'pears', 'plums', 'grapes', 'cabbage'])).toBe('greengrocer_orchard');
        expect(MarketStalls.artFor('greengrocer', ['cabbage', 'turnips', 'onions', 'beans'])).toBe('greengrocer_roots');
        expect(MarketStalls.artFor('greengrocer', ['cabbage', 'apples', 'pears'])).toBe('greengrocer');
        expect(MarketStalls.artFor('butcher', ['meat'])).toBe('butcher');
        for (const art of ['greengrocer', 'greengrocer_orchard', 'greengrocer_roots']) {
            expect(TownProps.stallVariant(art), art).toBeGreaterThan(0);
            expect(TownProps.stallArt(art).over.length, art).toBe(3);
        }
    });
});

describe('old saves', () => {
    it('a market saved before produce gets it stocked at its target; its other goods are kept as they were', () => {
        const s = town();
        SettlementMarket.ensure(s);
        // As an old save left it: no produce in its tables, another goods layout, a stale production list
        for (const id of SettlementMarket.config().produceIds) { delete s.market.stock[id]; delete s.market.trend[id]; }
        s.market.stock.grain = 7;
        s.market.layout = 12345;
        s.market.prod = [1, 2, 3];
        const m = SettlementMarket.ensure(s);
        expect(m.stock.cabbage).toBeCloseTo(SettlementMarket.target(s, 'cabbage'), 1);
        expect(m.stock.apples).toBeGreaterThan(0);
        expect(m.stock.dates).toBe(0); // (a town doesn't eat dates: nothing to seed)
        expect(m.stock.grain).toBe(7);
        expect(m.layout).toBe(SettlementMarket.config().layout);
        expect(m.prod).toBeUndefined();
        expect(Object.keys(m.stock)).toEqual(SettlementMarket.config().goodIds);
        // A second look leaves it be
        m.stock.cabbage = 1;
        SettlementMarket.ensure(s);
        expect(m.stock.cabbage).toBe(1);
    });
});

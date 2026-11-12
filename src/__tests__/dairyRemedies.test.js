/**
 * The dairy, the apothecary and the crab pots in the town markets
 * (data/markets.json; world/settlementMarket.js): milk from the town's cows and
 * goats, drunk fresh and made into cheese and butter; healing salves,
 * poultices and tonics made from the market's herbs; crabs from the towns by
 * the water. Every good comes from somewhere and goes somewhere.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { loadData } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

const town = (extra = {}) => ({ name: 'Ashford', type: 'town', population: 2000, happiness: 50, ...extra });
const AUTUMN = 75, SPRING = 15, WINTER = 105;

/** A one-hex world of `terrain` at `temp` (the tile's climate, 0 polar .. 1 tropical). */
function land(terrain, temp) {
    const tile = (q, r) => ({ q, r, terrain: { id: terrain, passable: true }, temperature: temp, hasRiver: false });
    const world = { width: 40, height: 40, getTile: (q, r) => tile(q, r) };
    return SettlementMarket.landProfile(world, 5, 5);
}

/** A town's market with every store at its target, then these stores set. */
function market(stock = {}, extra = {}) {
    const s = town(extra);
    SettlementMarket.ensure(s);
    for (const id of Object.keys(s.market.stock)) s.market.stock[id] = SettlementMarket.target(s, id);
    Object.assign(s.market.stock, stock);
    return s;
}

describe('the goods', () => {
    it('milk, butter, crabs, rare herbs, salves, poultices and tonics are traded goods with a price', () => {
        const C = SettlementMarket.config();
        for (const id of ['milk', 'butter', 'crab', 'rare_herbs', 'healing_salve', 'poultice', 'tonic']) {
            expect(SettlementMarket.tracks(id), id).toBe(true);
            expect(PlayerEconomy.GOODS[id.toUpperCase()].basePrice, id).toBeGreaterThan(0);
        }
        for (const id of ['milk', 'butter', 'crab']) expect(C.isFood[id], id).toBe(true);
        expect(SettlementMarket.uses(town(), 'milk')).toBe(true);
        expect(SettlementMarket.uses(town(), 'healing_salve')).toBe(true);
    });

    it('every one has a source (the land or a trade) and a sink (the people, or a trade that uses it)', () => {
        const C = SettlementMarket.config();
        const made = new Set(C.recipes.flatMap(r => Object.keys(r.out || {})));
        const used = new Set(C.recipes.flatMap(r => Object.keys(r.in || {})));
        for (const id of ['milk', 'butter', 'crab', 'rare_herbs', 'healing_salve', 'poultice', 'tonic']) {
            const source = !!C.produce[id] || !!C.supply[id] || made.has(id);
            const sink = C.goods[id].perCapita > 0 || used.has(id);
            expect(source, `${id} source`).toBe(true);
            expect(sink, `${id} sink`).toBe(true);
        }
        // The dairy makes its cheese of milk now, not of meat
        const dairy = C.recipes.find(r => r.id === 'dairy');
        expect(Object.keys(dairy.in)).toEqual(['milk']);
    });
});

describe('the dairy', () => {
    it('the pastures and the uplands give milk; a town of cows and goats more than a desert one', () => {
        const pasture = SettlementMarket.production(town(), land('grassland', 0.45), null, 0);
        const hills = SettlementMarket.production(town(), land('hills', 0.45), null, 0);
        const desert = SettlementMarket.production(town(), land('desert', 0.85), null, 0);
        expect(pasture.milk).toBeGreaterThan(0);
        expect(hills.milk).toBeGreaterThan(0);
        expect(desert.milk).toBeGreaterThan(0);
        expect(pasture.milk).toBeGreaterThan(desert.milk * 1.4);
        // More milk in spring than in winter
        expect(SettlementMarket.produceSeason('milk', SPRING)).toBeGreaterThan(SettlementMarket.produceSeason('milk', WINTER) * 1.8);
    });

    it('milk is drunk and turns in days', () => {
        const s = { name: 'Store', type: 'town', population: 0 };
        SettlementMarket.ensure(s);
        s.market.stock.milk = 100;
        for (let d = 0; d < 5; d++) SettlementMarket.processSettlement(s, {}, { day: AUTUMN + d });
        expect(SettlementMarket.stock(s, 'milk')).toBeLessThan(60);
    });

    it('the dairy makes the spare milk into cheese and the churn into butter', () => {
        // (the stores at half their target, so the dairy and the churn have work)
        const half = (s0, id) => SettlementMarket.target(s0, id) * 0.5;
        const probe = market();
        const s = market({ milk: 60, cheese: half(probe, 'cheese'), butter: half(probe, 'butter') });
        const dry = market({ milk: 0, cheese: half(probe, 'cheese'), butter: half(probe, 'butter') });
        SettlementMarket.processSettlement(s, {}, { day: AUTUMN });
        SettlementMarket.processSettlement(dry, {}, { day: AUTUMN });
        // ...and no milk, no cheese or butter from them
        expect(SettlementMarket.stock(s, 'cheese')).toBeGreaterThan(SettlementMarket.stock(dry, 'cheese') + 0.3);
        expect(SettlementMarket.stock(s, 'butter')).toBeGreaterThan(SettlementMarket.stock(dry, 'butter') + 0.1);
        // the milk they took: more than the people drank and the day turned
        expect(SettlementMarket.stock(s, 'milk')).toBeLessThan((60 - SettlementMarket.need(s, 'milk')) * 0.88 - 1);
    });
});

describe('the apothecary and the herbalist', () => {
    it('make salves, poultices and tonics of the market\'s herbs, honey, linen and mead', () => {
        const s = market({ healing_salve: 0, poultice: 0, tonic: 0, herbs: 200 });
        const herbs = s.market.stock.herbs, mead = s.market.stock.mead;
        SettlementMarket.processSettlement(s, {}, { day: AUTUMN });
        for (const id of ['healing_salve', 'poultice', 'tonic']) expect(SettlementMarket.stock(s, id), id).toBeGreaterThan(0);
        expect(SettlementMarket.stock(s, 'herbs')).toBeLessThan(herbs - SettlementMarket.need(s, 'herbs'));
        expect(SettlementMarket.stock(s, 'mead')).toBeLessThan(mead);
        // No herbs: no remedies
        const bare = market({ healing_salve: 0, poultice: 0, tonic: 0, herbs: 0 });
        SettlementMarket.processSettlement(bare, {}, { day: AUTUMN });
        for (const id of ['healing_salve', 'poultice', 'tonic']) expect(SettlementMarket.stock(bare, id), id).toBe(0);
    });

    it('the townsfolk buy the remedies: a store nobody makes runs down', () => {
        const s = market({ herbs: 0 });
        const salves = s.market.stock.healing_salve;
        for (let d = 0; d < 20; d++) SettlementMarket.processSettlement(s, {}, { day: AUTUMN + d });
        expect(SettlementMarket.stock(s, 'healing_salve')).toBeLessThan(salves * 0.8);
    });

    it('rare herbs grow wild in the deep woods', () => {
        const wood = SettlementMarket.production(town(), land('woodland', 0.45), null, 0);
        const field = SettlementMarket.production(town(), land('plains', 0.45), null, 0);
        expect(wood.rare_herbs).toBeGreaterThan(field.rare_herbs * 2);
    });
});

describe('crabs', () => {
    it('come from the towns by the water, none from inland', () => {
        const coast = SettlementMarket.production(town(), land('coast', 0.5), null, 0);
        const inland = SettlementMarket.production(town(), land('plains', 0.5), null, 0);
        expect(coast.crab).toBeGreaterThan(SettlementMarket.need(town(), 'crab'));
        expect(inland.crab || 0).toBe(0);
    });
});

describe('the stores keep near their target (2026-11 tuning)', () => {
    /** A year of a town's market on its own (no trade), from its land's production. */
    function year(terrain) {
        const s = town({ population: 6000, type: 'city' });
        SettlementMarket.ensure(s);
        const prod = SettlementMarket.production(s, land(terrain, 0.45), null, 0);
        const most = {};
        for (let d = 1; d <= 240; d++) {
            SettlementMarket.processSettlement(s, prod, { day: d });
            if (d <= 120) continue;
            for (const id of ['mead', 'beans', 'onions']) most[id] = Math.max(most[id] || 0, SettlementMarket.stock(s, id) / SettlementMarket.target(s, id));
        }
        return most;
    }

    it('mead does not pile up: it spoils a little and the craftsmen make less than the drinkers want', () => {
        const g = SettlementMarket.config().goods.mead;
        expect(g.spoil).toBeGreaterThan(0);
        const sup = SettlementMarket.config().supply.mead;
        expect(sup.base + sup.forest).toBeLessThan(1);
        expect(year('woodland').mead).toBeLessThan(1.5);
    });

    it('beans and onions: the fields grow a little more than the town eats, and the store slowly turns', () => {
        // (a town on good farmland grows them for its own table and a little over to sell, not half again)
        const s = town();
        const prod = SettlementMarket.production(s, land('grassland', 0.45), null, 0);
        for (const id of ['beans', 'onions']) {
            const ratio = prod[id] / SettlementMarket.need(s, id);
            expect(ratio, id).toBeGreaterThan(1);
            expect(ratio, id).toBeLessThan(1.6);
        }
        // A season in the store: dried beans keep best, onions well, but neither keeps for ever
        const kept = (id) => Math.pow(1 - SettlementMarket.config().goods[id].spoil, 30);
        expect(kept('beans')).toBeLessThan(0.97);
        expect(kept('onions')).toBeLessThan(kept('beans'));
        expect(kept('onions')).toBeGreaterThan(0.8);
    });
});

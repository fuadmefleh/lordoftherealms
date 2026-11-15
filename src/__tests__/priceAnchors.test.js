/**
 * Price anchors learnt from the market (world/priceAnchors.js) and the
 * craftsmen's floor (SettlementMarket._craftFloor): anchors start at the data
 * price, never move on day 0 or in the first month, creep toward the world's
 * scarcity a few percent a month within their bounds, are saved with the game
 * and don't move today's price; a made good never sells below its inputs at
 * that market plus the work, and only in a market bound to its world.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PriceAnchors } from '../world/priceAnchors.js';
import { Economy } from '../world/economy.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { loadData } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

const town = (name = 'Ashford') => ({ name, type: 'town', population: 2000, happiness: 50 });
const plains = (q, r, settlement = null) => ({ q, r, terrain: { id: 'plains', passable: true }, resource: null, settlement });

/** A tiny world of towns on plains. */
function miniWorld(n = 3) {
    const towns = [];
    for (let i = 0; i < n; i++) {
        const s = town(`Town${i}`);
        s.q = i * 3; s.r = 0;
        SettlementMarket.ensure(s);
        towns.push(s);
    }
    const tiles = new Map(towns.map(s => [`${s.q},${s.r}`, plains(s.q, s.r, s)]));
    return {
        towns,
        width: 40, height: 40, day: 1, activeEvents: [], units: [], kingdoms: [],
        getKingdom: () => null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || plains(q, r),
        getSettlementViews: () => towns,
    };
}

/** Empties (dearth) or gluts a good in every town. */
const setStock = (world, id, mult) => {
    for (const s of world.towns) s.market.stock[id] = SettlementMarket.target(s, id) * mult;
};

/** Runs the anchors' daily call from `from` to `to` (inclusive). */
const runDays = (world, from, to) => {
    for (let d = from; d <= to; d++) { world.day = d; PriceAnchors.update(world, world.towns, d); }
};

describe('the craftsmen\'s floor', () => {
    it('a made good never sells below its inputs here plus the work, once the market is bound', () => {
        const world = miniWorld(1);
        const s = world.towns[0];
        setStock(world, 'textiles', 0);
        setStock(world, 'wool', 0);
        setStock(world, 'gambeson', 6); // a glut of gambesons
        const raw = SettlementMarket.scarcity(s, 'gambeson');
        expect(raw).toBeLessThan(0.8);
        // (an unbound market — generation, bare fixtures — prices on its stock alone)
        PriceAnchors.bindAll(world);
        const G = PlayerEconomy.GOODS;
        const inputs = G.TEXTILES.basePrice * SettlementMarket.scarcity(s, 'textiles') + G.WOOL.basePrice * SettlementMarket.scarcity(s, 'wool');
        const work = SettlementMarket.config().craftFloor.work;
        const floored = SettlementMarket.scarcity(s, 'gambeson');
        expect(floored).toBeCloseTo(Math.min(SettlementMarket.config().craftFloor.max, inputs * (1 + work) / G.GAMBESON.basePrice), 5);
        expect(floored).toBeGreaterThan(raw);
        // ...and the ask follows: the quilter asks more than its cloth and wool cost
        const tile = world.getTile(s.q, s.r);
        expect(Economy.marketPrice(G.GAMBESON, s, tile, null)).toBeGreaterThanOrEqual(
            Math.floor(Economy.marketPrice(G.TEXTILES, s, tile, null) + Economy.marketPrice(G.WOOL, s, tile, null)));
    });

    it('never lowers a price, and takes the cheapest way of making the good', () => {
        const world = miniWorld(1);
        const s = world.towns[0];
        setStock(world, 'boots', 0.2); // dear boots
        const before = SettlementMarket.scarcity(s, 'boots');
        PriceAnchors.bindAll(world);
        expect(SettlementMarket.scarcity(s, 'boots')).toBeCloseTo(before, 10);
        // Glutted boots, dear leather: the cobbler's one leather a pair (not the
        // player's two-leather craft recipe) sets the floor
        setStock(world, 'boots', 8);
        setStock(world, 'leather', 0);
        const G = PlayerEconomy.GOODS;
        const want = G.LEATHER.basePrice * SettlementMarket.scarcity(s, 'leather') * (1 + SettlementMarket.config().craftFloor.work) / G.BOOTS.basePrice;
        expect(SettlementMarket.scarcity(s, 'boots')).toBeCloseTo(want, 5);
    });

    it('reaches down the chain: dear hides make dear leather make dear boots', () => {
        const world = miniWorld(1);
        const s = world.towns[0];
        PriceAnchors.bindAll(world);
        setStock(world, 'boots', 8);
        setStock(world, 'leather', 8);
        const cheap = SettlementMarket.scarcity(s, 'boots');
        setStock(world, 'hide', 0);
        expect(SettlementMarket.scarcity(s, 'leather')).toBeGreaterThan(1);
        expect(SettlementMarket.scarcity(s, 'boots')).toBeGreaterThan(cheap);
    });
});

describe('the price anchors', () => {
    it('start at the data price and don\'t move in the first month', () => {
        const world = miniWorld();
        setStock(world, 'leather', 0.05);
        runDays(world, 1, 29);
        expect(PriceAnchors.factor(world, 'leather')).toBe(1);
        expect(world.priceAnchors.at).toBe(0);
        // (and a day-0 call never samples: the world as generated prices on its data)
        const w0 = miniWorld();
        setStock(w0, 'leather', 0.05);
        PriceAnchors.update(w0, w0.towns, 0);
        expect(w0.priceAnchors.at).toBe(null);
    });

    it('creep toward what a good trades for, a few percent a month, within bounds', () => {
        const world = miniWorld();
        const A = PriceAnchors.config();
        setStock(world, 'leather', 0.05); // dear everywhere
        setStock(world, 'hide', 6); // cheap everywhere
        let prev = 1;
        for (let month = 1; month <= 6; month++) {
            runDays(world, (month - 1) * 30 + 1, month * 30);
            const a = PriceAnchors.factor(world, 'leather');
            expect(a).toBeGreaterThan(prev);
            expect(a / prev).toBeLessThanOrEqual(1 + A.maxStep + 1e-3); // (anchors are kept to 4 places)
            prev = a;
        }
        expect(PriceAnchors.factor(world, 'hide')).toBeLessThan(1);
        // Years of it: never past the world's own scarcity, nor the bounds
        runDays(world, 181, 30 * 120);
        const a = PriceAnchors.factor(world, 'leather');
        expect(a).toBeLessThanOrEqual(Math.min(A.max, SettlementMarket.config().price.max) + 1e-9);
        expect(a).toBeGreaterThan(1.5);
        expect(PriceAnchors.factor(world, 'hide')).toBeGreaterThanOrEqual(A.min);
        expect(PriceAnchors.base(world, 'leather', 18)).toBeCloseTo(18 * a, 6);
        // A good dear everywhere for years reads as its normal
        const info = SettlementMarket.info(world.towns[0], 'leather');
        expect(info.anchor).toBeCloseTo(a, 6);
        expect(SettlementMarket.label(info.scarcity / a).label).toBe(info.label);
    });

    it('don\'t move today\'s price (it stays the stock\'s)', () => {
        const world = miniWorld(1);
        const s = world.towns[0];
        const tile = world.getTile(s.q, s.r);
        setStock(world, 'wool', 0.3);
        PriceAnchors.bindAll(world);
        const before = Economy.marketPrice(PlayerEconomy.GOODS.WOOL, s, tile, null);
        world.priceAnchors.f.wool = 2;
        world.priceAnchors.at = 99; // (a new sample: the binding is rebuilt)
        PriceAnchors.bindAll(world);
        expect(SettlementMarket.anchorOf(s, 'wool')).toBe(2);
        expect(Economy.marketPrice(PlayerEconomy.GOODS.WOOL, s, tile, null)).toBe(before);
    });

    it('label the price book and the trade map as the market screen does', () => {
        // (PriceAnchors.label: ui/actionMenu/merchantLedger.js and ui/renderer/tradeMap.js)
        const world = miniWorld(1);
        const s = world.towns[0];
        setStock(world, 'leather', 0.2);
        world.priceAnchors = { at: 99, f: { leather: 2.2 }, obs: {} };
        PriceAnchors.bindAll(world);
        const info = SettlementMarket.info(s, 'leather');
        expect(info.scarcity).toBeGreaterThan(1.8);
        // A quote at that scarcity reads as the market screen reads it, not as a dearth
        expect(PriceAnchors.label(world, 'leather', info.scarcity).label).toBe(info.label);
        expect(PriceAnchors.label(world, 'leather', info.scarcity).label).not.toBe(SettlementMarket.label(info.scarcity).label);
        // An unanchored good (or no world) labels on its scarcity alone
        expect(PriceAnchors.label(world, 'wool', 0.5)).toEqual(SettlementMarket.label(0.5));
        expect(PriceAnchors.label(null, 'leather', 1.9)).toEqual(SettlementMarket.label(1.9));
    });

    it('are deterministic, and saved with the game', () => {
        const run = () => {
            const world = miniWorld();
            setStock(world, 'leather', 0.1);
            setStock(world, 'wool', 3);
            runDays(world, 1, 400);
            return world;
        };
        const a = run(), b = run();
        expect(JSON.stringify(a.priceAnchors)).toBe(JSON.stringify(b.priceAnchors));
        // Round trip through the save: the same anchors, the markets bound to them
        const saved = JSON.parse(JSON.stringify(PriceAnchors.serialize(a)));
        const c = miniWorld();
        setStock(c, 'leather', 0.1);
        setStock(c, 'wool', 3);
        PriceAnchors.restore(saved, c);
        expect(c.priceAnchors).toEqual(a.priceAnchors);
        expect(SettlementMarket.anchorOf(c.towns[0], 'leather')).toBe(PriceAnchors.factor(a, 'leather'));
        // ...and carry on alike
        runDays(a, 401, 500);
        runDays(c, 401, 500);
        expect(c.priceAnchors).toEqual(a.priceAnchors);
        // An older save without them starts from the data prices
        const d = miniWorld();
        PriceAnchors.restore(undefined, d);
        expect(PriceAnchors.factor(d, 'leather')).toBe(1);
    });
});

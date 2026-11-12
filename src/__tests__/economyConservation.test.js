/**
 * The world economy keeps real numbers (2026-11): goods and coin move between
 * named holders and are not made from nothing. NPC trade pays the exporter out
 * of the importer's purse; the player's purchases, sales, wages and rewards go
 * through the towns' purses; a caravan's cargo leaves one town and lands (and
 * is paid for) in another; prices follow stock, and demand follows the purse.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { CrownBooks } from '../world/crownBooks.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { Quests } from '../systems/quests.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { OddJobs } from '../player/oddJobs.js';
import { SettlementServices } from '../player/settlementServices.js';
import { loadData } from './playtest/harness.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownJobs } from '../systems/townJobs.js';
import { TownTrade } from '../systems/townTrade.js';

beforeAll(async () => {
    await loadData();
});

const GOODS = () => PlayerEconomy.GOODS;
const basePrices = () => Object.fromEntries(SettlementMarket.config().goodIds.map(id => [id, GOODS()[id.toUpperCase()].basePrice]));
const town = (extra = {}) => ({ name: 'Ashford', type: 'town', population: 2000, happiness: 50, ...extra });
const link = (a, b, extra = {}) => ({ a, b, dist: 3, sea: false, road: false, routes: 1, friction: 0.1, base: 200, capacity: 200, factor: 1, ...extra });
const player = (extra = {}) => ({ gold: 5000, inventory: {}, maxInventory: 99, skills: { commerce: 0 }, ...extra });

/** A glut town and a dearth town of grain, each with `gold` in its purse. */
function pair(goldA = 5000, goldB = 5000) {
    const a = town({ name: 'Glut' }), b = town({ name: 'Dearth' });
    SettlementMarket.ensure(a); SettlementMarket.ensure(b);
    a.economy = { gold: goldA }; b.economy = { gold: goldB };
    a.market.stock.grain = SettlementMarket.target(a, 'grain') * 4;
    b.market.stock.grain = SettlementMarket.target(b, 'grain') * 0.1;
    return { a, b };
}
const units = (s, id) => SettlementMarket.stock(s, id);

describe('NPC trade pays for the goods it moves', () => {
    it('grain leaves the glut town and lands in the dearth town, and the coin goes the other way: totals unchanged', () => {
        const { a, b } = pair();
        const goods0 = units(a, 'grain') + units(b, 'grain');
        const gold0 = a.economy.gold + b.economy.gold;
        for (let d = 0; d < 20; d++) SettlementMarket.flows([link(a, b)], basePrices());
        expect(units(b, 'grain')).toBeGreaterThan(SettlementMarket.target(b, 'grain') * 0.1);
        expect(units(a, 'grain') + units(b, 'grain')).toBeCloseTo(goods0, 0);
        expect(a.economy.gold).toBeGreaterThan(5000); // the exporter was paid...
        expect(b.economy.gold).toBeLessThan(5000); // ...by the importer
        expect(a.economy.gold + b.economy.gold).toBeCloseTo(gold0, 1);
        // The exporter's sales are on its books for the crown's land tax
        expect(a.economy.fySales).toBeGreaterThan(0);
    });

    it('a town without coin (and nothing to sell) imports nothing, however short it runs', () => {
        const { a, b } = pair(5000, 0);
        for (const id of Object.keys(b.market.stock)) if (id !== 'grain') b.market.stock[id] = 0;
        const before = units(b, 'grain');
        for (let d = 0; d < 10; d++) SettlementMarket.flows([link(a, b)], basePrices());
        expect(units(b, 'grain')).toBeCloseTo(before, 2);
        expect(a.economy.gold).toBe(5000);
    });

    it('the merchants\' margin is assessed for the excise but mints no coin', () => {
        const { a, b } = pair();
        for (let d = 0; d < 10; d++) SettlementMarket.flows([link(a, b)], basePrices());
        expect(a.economy.tradeIncome).toBeGreaterThan(0);
        const gold = a.economy.gold;
        const assessed = Economy.processTrade(a);
        expect(assessed).toBeGreaterThan(0);
        expect(a.economy.gold).toBe(gold);
    });

    it('an embodied lot leaves the exporter at once and is paid for only when it lands', () => {
        const { a, b } = pair();
        const l = link(a, b, { embody: true });
        const before = units(a, 'grain');
        SettlementMarket.flows([l], basePrices());
        expect(units(a, 'grain')).toBeLessThan(before);
        expect(l.cargoAB).toBeTruthy();
        expect(l.payAB).toBeGreaterThan(0);
        // On the road nothing is paid yet
        expect(a.economy.gold + b.economy.gold).toBe(10000);
        // It lands: the importer pays the exporter what was owed (no more than it holds)
        const paid = MerchantCaravans._settle(b, a, l.payAB);
        expect(paid).toBeCloseTo(l.payAB, 2);
        expect(a.economy.gold).toBeCloseTo(5000 + paid, 2);
        expect(b.economy.gold).toBeCloseTo(5000 - paid, 2);
        expect(MerchantCaravans._settle({ economy: { gold: 3 } }, a, 50)).toBe(3);
    });
});

describe('prices follow stock, demand follows the purse', () => {
    it('a town\'s price rises as its stock falls', () => {
        const s = town();
        SettlementMarket.ensure(s);
        const t = SettlementMarket.target(s, 'tools');
        const scar = [2, 1, 0.5, 0.2].map(k => SettlementMarket.scarcity(s, 'tools', t * k));
        for (let i = 1; i < scar.length; i++) expect(scar[i]).toBeGreaterThan(scar[i - 1]);
    });

    it('a town flush with coin wants more, a broke one less', () => {
        const rich = town({ economy: { gold: 2000 * 30 } });
        const poor = town({ economy: { gold: 0 } });
        const plain = town({ economy: { gold: 2000 * 2 } });
        expect(SettlementMarket.wealthMult(rich)).toBeGreaterThan(1);
        expect(SettlementMarket.wealthMult(poor)).toBeLessThan(1);
        expect(SettlementMarket.wealthMult(plain)).toBe(1);
        expect(SettlementMarket.need(rich, 'bread')).toBeGreaterThan(SettlementMarket.need(poor, 'bread'));
    });
});

describe('the player trades and works through the towns\' purses', () => {
    const plains = (q, r, st) => ({ q, r, terrain: { id: 'plains', passable: true }, resource: null, settlement: st });
    const entry = (s, id) => Trading.getAvailableGoods(s, plains(0, 0, s), null).find(g => g.id === id);

    it('a purchase takes the goods off the stalls and pays the town: the coin is only moved', () => {
        const s = town({ economy: { gold: 1000 } });
        SettlementMarket.ensure(s);
        const p = player();
        const stock0 = units(s, 'bread');
        const total0 = p.gold + s.economy.gold;
        const res = Trading.buyGoods(p, entry(s, 'bread'), 5, s);
        expect(res.success).toBe(true);
        expect(units(s, 'bread')).toBeCloseTo(stock0 - 5, 2);
        expect(p.gold + s.economy.gold).toBeCloseTo(total0, 2);
        expect(s.economy.gold).toBeGreaterThan(1000);
    });

    it('a sale is paid out of the town\'s purse, and a town without the coin refuses it', () => {
        const s = town({ economy: { gold: 1000 } });
        SettlementMarket.ensure(s);
        const p = player({ inventory: { tools: 20 } });
        const total0 = p.gold + s.economy.gold;
        const res = Trading.sellGoods(p, 'tools', 2, s, null);
        expect(res.success).toBe(true);
        expect(p.gold + s.economy.gold).toBeCloseTo(total0, 2);
        s.economy.gold = 3;
        const no = Trading.sellGoods(p, 'tools', 2, s, null);
        expect(no.success).toBe(false);
        expect(no.reason).toMatch(/only 3 gold/);
        expect(Trading.affordableSale(p, 'tools', 10, s, null)).toBe(0);
        s.economy.gold = 200;
        const n = Trading.affordableSale(p, 'tools', 20, s, null);
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(20);
    });

    it('a day\'s wages come out of the town\'s purse; a broke town pays what it has', () => {
        const job = { id: 'porter', stat: 'strength', pay: { min: 20, max: 20 } };
        const rich = town({ economy: { gold: 500 } });
        const p = player({ gold: 0 });
        const r1 = OddJobs.complete(p, null, rich, job, 100);
        expect(r1.pay).toBeGreaterThan(0);
        expect(p.gold + rich.economy.gold).toBeCloseTo(500, 2);
        const broke = town({ economy: { gold: 4 } });
        const r2 = OddJobs.complete(p, null, broke, job, 100);
        expect(r2.pay).toBe(4);
        expect(broke.economy.gold).toBe(0);
    });

    it('a service\'s fee goes to the town that gave it', () => {
        const s = town({ economy: { gold: 100 } });
        const p = player({ gold: 1000 });
        const res = SettlementServices.seekBlessing(p, s);
        expect(res.success).toBe(true);
        expect(p.gold + s.economy.gold).toBe(1100);
    });

    it('a quest\'s gold comes from the town it was taken in', () => {
        const s = town({ economy: { gold: 120 } });
        const world = { getTile: (q, r) => (q === 4 && r === 4 ? { q, r, settlement: s } : null) };
        const p = player({ gold: 0, karma: 0, renown: 0 });
        const quest = { type: 'board', rewards: { gold: 300 }, payer: { q: 4, r: 4 } };
        Quests.grantRewards(p, quest, world);
        expect(p.gold).toBe(120);
        expect(s.economy.gold).toBe(0);
        expect(quest.rewardShort).toBe(180);
    });
});

describe('the crown\'s spending reaches its capital', () => {
    it('spendAtCapital pays the capital town\'s purse', () => {
        const cap = town({ economy: { gold: 10 } });
        const world = { getTile: (q, r) => (q === 1 && r === 2 ? { settlement: cap } : null) };
        const k = { id: 'k1', capital: { q: 1, r: 2 }, treasury: 500 };
        k.treasury -= 80;
        expect(CrownBooks.spendAtCapital(world, k, 80)).toBe(80);
        expect(cap.economy.gold + k.treasury).toBe(510);
    });
});

describe('the townsfolk trade among themselves (systems/townTrade.js)', () => {
    /** A town with a roster (every purse rolled) and a neighbour a pedlar can come from. */
    function rosterTown() {
        const a = town({ q: 5, r: 7, economy: { gold: 3000 } }), b = town({ name: 'Brightwater', q: 8, r: 7, economy: { gold: 3000 } });
        const tiles = { '5,7': { q: 5, r: 7, settlement: a }, '8,7': { q: 8, r: 7, settlement: b } };
        const world = { day: 40, generationParams: { seed: 99 }, activeEvents: [], units: [], getSettlementViews: () => [a, b], getKingdom: () => null, getTile: (q, r) => tiles[`${q},${r}`] || null };
        SettlementMarket.ensure(a); SettlementMarket.ensure(b);
        a.market.links = [[8, 7, 2, false, true, 1]];
        Townsfolk.seed(a, world, { q: 5, r: 7 });
        TownJobs.ensure(a.folk, a, world, world.day);
        for (const p of a.folk.people) p.purse = Townsfolk.age(p, world.day) >= 16 ? 25 : 0;
        return { a, b, world };
    }
    const goods = (towns) => {
        const o = {};
        for (const s of towns) {
            for (const id of SettlementMarket.config().goodIds) o[id] = (o[id] || 0) + units(s, id);
            const h = TownTrade.holdings(s);
            for (const [id, n] of Object.entries(h.goods)) o[id] = (o[id] || 0) + n;
            for (const [id, n] of Object.entries(h.gone)) o[id] = (o[id] || 0) + n;
        }
        return o;
    };
    const coin = (towns) => towns.reduce((t, s) => t + s.economy.gold + TownTrade.holdings(s).coin
        + (s.folk ? s.folk.people.reduce((x, p) => x + (typeof p.purse === 'number' ? p.purse : 0), 0) : 0), 0);

    it('shopping, eating, barter, producers and pedlars only move goods and coin between holders (what is eaten is booked gone)', () => {
        const { a, b, world } = rosterTown();
        const g0 = goods([a, b]), c0 = coin([a, b]);
        for (let i = 0; i < 15; i++) {
            if (i === 2) a.townTrade.lastPedlar = world.day - 100;
            TownTrade.step(world, a, world.day);
            world.day += 4;
        }
        expect(a.townTrade.book.bought).toBeGreaterThan(0);
        expect(a.townTrade.book.eaten).toBeGreaterThan(0);
        const g1 = goods([a, b]);
        for (const id of SettlementMarket.config().goodIds) expect(g1[id] || 0, id).toBeCloseTo(g0[id] || 0, 5);
        expect(coin([a, b])).toBeCloseTo(c0, 5);
    });

    it('what the producers keep back at the market turn is exactly what the market did not stock', () => {
        const { a, world } = rosterTown();
        TownTrade.step(world, a, world.day);
        const W = TownTrade.withhold(a, world, world.day, 4);
        const prod = SettlementMarket.productionList(Object.fromEntries(Object.keys(W.goods).map(id => [id, 4])));
        const x = JSON.parse(JSON.stringify(a)), y = JSON.parse(JSON.stringify(a));
        SettlementMarket.processSettlement(x, prod, { day: world.day, days: 4, withhold: W });
        SettlementMarket.processSettlement(y, prod, { day: world.day, days: 4 });
        const held = x.market.withheld;
        expect(Object.keys(held).length).toBeGreaterThan(0);
        // (the stock is kept to the hundredth, and what's held spoils not at all meanwhile; the raw
        // produce no trade works up, so no mill or bakery makes up the difference)
        const raw = new Set(['eggs', 'cabbage', 'turnips', 'onions', 'apples', 'fish', 'wool', 'carrots', 'beans']);
        expect(Object.keys(held).some(id => raw.has(id))).toBe(true);
        for (const [id, n] of Object.entries(held)) if (raw.has(id)) expect(y.market.stock[id] - x.market.stock[id], id).toBeCloseTo(n * Math.pow(1 - SettlementMarket.good(id).spoil, 4), 1);
    });
});

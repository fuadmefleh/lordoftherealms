// The townsfolk trade with each other (systems/townTrade.js): households shop
// at the market into their larders and eat from them (the market eating that
// much less), producers keep back their wares and bring the rest to market,
// neighbours barter, pedlars carry real goods from another town, free talk
// sells from real stock, bad bargains leave grudges, the player's buying
// leaves less for the town — and no unit or coin is made or lost.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { loadData } from './playtest/harness.js';
import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownJobs } from '../systems/townJobs.js';
import { TownTrade } from '../systems/townTrade.js';
import { NpcChat } from '../systems/npcChat.js';
import { Relationships } from '../systems/relationships.js';
import { NpcFamily } from '../systems/npcFamily.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { InnerMap } from '../world/innerMap.js';

let BASE = null;
beforeAll(async () => {
    await loadData();
    BASE = DataLoader._gamedata.townTrade;
});
afterEach(() => { DataLoader._gamedata.townTrade = BASE; });

/** Override a section of the trade's data for one test. */
function tune(section, fields) {
    DataLoader._gamedata.townTrade = { ...BASE, [section]: { ...BASE[section], ...fields } };
}

function seedNpcs(types = { villager: 14, merchant: 2, guard: 1, farmer: 4, priest: 1, blacksmith_npc: 1, child: 5 }) {
    const npcs = [];
    let id = 0;
    for (const [type, n] of Object.entries(types)) for (let i = 0; i < n; i++) npcs.push({ id: id++, type, name: 'Ada', age: type === 'child' ? 6 + (i % 8) : 21 + ((i * 7) % 34) });
    let s = 77;
    NpcFamily.generateFamilies(npcs, () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; });
    return npcs;
}

/** A town with a roster (and a neighbour with none, a day away), on day `day`. */
function setup(day = 40, opts = {}) {
    const town = { name: 'Ashford', type: 'town', q: 5, r: 7, population: 1500, happiness: 50, economy: { gold: 3000 }, kingdom: 0 };
    const other = { name: 'Brightwater', type: 'town', q: 8, r: 7, population: 1500, happiness: 50, economy: { gold: 3000 }, kingdom: 0 };
    const tiles = { '5,7': { q: 5, r: 7, settlement: town }, '8,7': { q: 8, r: 7, settlement: other } };
    const world = {
        day, baseYear: 853, generationParams: { seed: 4242 }, activeEvents: [], units: [],
        getSettlementViews: () => [town, other], getKingdom: () => null,
        getTile: (q, r) => tiles[`${q},${r}`] || null,
    };
    SettlementMarket.ensure(town);
    SettlementMarket.ensure(other);
    town.market.links = [[8, 7, 3, false, true, 1]];
    other.market.links = [[5, 7, 3, false, true, 1]];
    Townsfolk.attach(town, world, seedNpcs(opts.types), { q: 5, r: 7, target: 28 });
    TownJobs.ensure(town.folk, town, world, day);
    // (every purse rolled: a child's empty, so none is rolled into being as they come of age)
    for (const p of town.folk.people) p.purse = Townsfolk.age(p, day) >= 16 ? (opts.purse != null ? opts.purse : 30) : 0;
    return { world, s: town, other, folk: town.folk };
}

const GOODS = () => SettlementMarket.config().goodIds;

/** Every unit of every good the two towns and the trade hold, and what left by eating or spoiling. */
function goodsTotal(towns) {
    const out = {};
    for (const s of towns) {
        for (const g of GOODS()) out[g] = (out[g] || 0) + SettlementMarket.stock(s, g);
        const h = TownTrade.holdings(s);
        for (const [g, n] of Object.entries(h.goods)) out[g] = (out[g] || 0) + n;
        // (and what was eaten, worn out or spoiled: gone from the economy, by good)
        for (const [g, n] of Object.entries(h.gone)) out[g] = (out[g] || 0) + n;
        out._gone = (out._gone || 0) + h.eaten + h.spoiled;
        const m = s.market;
        for (const [g, n] of Object.entries((m && m.withheld) || {})) out[g] = (out[g] || 0) + n;
    }
    return out;
}
function coinTotal(towns) {
    let t = 0;
    for (const s of towns) {
        t += s.economy.gold;
        if (s.folk) for (const p of s.folk.people) if (typeof p.purse === 'number') t += p.purse;
        t += TownTrade.holdings(s).coin;
    }
    return Math.round(t * 100) / 100;
}

function larderUnits(st) {
    let n = 0;
    for (const h of Object.values(st.hh)) for (const v of Object.values(h.l)) n += v;
    return n;
}

describe('households shop at market', () => {
    it('shopping moves goods and coin exactly: off the stock into the larders, out of the purses into the town\'s', () => {
        const { world, s, other } = setup();
        const g0 = goodsTotal([s, other]), c0 = coinTotal([s, other]);
        const gold0 = s.economy.gold;
        const out = TownTrade.step(world, s, world.day);
        const st = s.townTrade;
        expect(out.bought).toBeGreaterThan(0);
        expect(larderUnits(st)).toBeGreaterThan(0);
        expect(s.economy.gold).toBeGreaterThan(gold0);
        // Each good: what left the stock is in a larder or a producer's wares
        const g1 = goodsTotal([s, other]);
        for (const g of GOODS()) expect(g1[g] || 0, g).toBeCloseTo(g0[g] || 0, 6);
        expect(coinTotal([s, other])).toBeCloseTo(c0, 6);
        // What they spent at the stalls comes off their board (systems/townJobs.js payday)
        expect(s.folk.people.some(p => p.shopped > 0)).toBe(true);
    });

    it('household larders are stocked by purchase, and what is eaten from them the market need not feed', () => {
        const { world, s } = setup();
        TownTrade.step(world, s, world.day);
        const st = s.townTrade;
        const hhs = TownTrade.households(s.folk, world.day).filter(h => h.adults.length);
        const rates = TownTrade.rates(s);
        const bread = rates.find(r => r.g === 'bread');
        for (const hh of hhs) {
            expect(st.hh[hh.key], hh.key).toBeTruthy();
            // (bought up to coverDays of their bread, as far as their purse ran)
            expect(st.hh[hh.key].l.bread || 0).toBeGreaterThan(TownTrade.target(hh, bread) * 0.5);
        }
        // Four days on: they ate from the larders, booked on the market
        world.day += 4;
        TownTrade.step(world, s, world.day);
        expect(st.book.eaten).toBeGreaterThan(0);
        const named = { ...s.market.named };
        expect(named.bread).toBeGreaterThan(0);
        // The market's turn takes that much less bread off its stock for the town
        const zero = SettlementMarket.productionList({});
        const a = JSON.parse(JSON.stringify(s)), b = JSON.parse(JSON.stringify(s));
        delete b.market.named;
        SettlementMarket.processSettlement(a, zero, { day: world.day, days: 4 });
        SettlementMarket.processSettlement(b, zero, { day: world.day, days: 4 });
        // (that much more bread left, less what of it spoiled over the four days)
        const spoil = Math.pow(1 - SettlementMarket.good('bread').spoil, 4);
        expect(a.market.stock.bread - b.market.stock.bread).toBeCloseTo(Math.min(named.bread, SettlementMarket.need(s, 'bread') * 4) * spoil, 1);
        expect(a.market.named).toBeUndefined();
    });

    it('a household with an empty purse buys nothing, and in a dearth goes hungry once its larder is bare', () => {
        const { world, s } = setup(40, { purse: 0 });
        TownTrade.step(world, s, world.day);
        // (out of a dearth the town's own stores feed them as before: no one marked hungry)
        world.day += 4;
        TownTrade.step(world, s, world.day);
        expect(s.folk.people.some(p => p.hungry === world.day)).toBe(false);
        s.market.short.food = 0.6;
        expect(s.townTrade.book.bought || 0).toBe(0);
        world.day += 4;
        TownTrade.step(world, s, world.day);
        // (only a neighbour's swap or a producer's own wares feed anyone: most go hungry)
        const adults = s.folk.people.filter(p => Townsfolk.isHere(p) && Townsfolk.age(p, world.day) >= 16);
        expect(adults.filter(p => p.hungry === world.day).length).toBeGreaterThan(adults.length / 2);
    });
});

describe('producers bring their goods to market', () => {
    it('the named hands keep back a share of the market turn\'s output, and take what is over their keep to market', () => {
        const { world, s } = setup();
        TownTrade.step(world, s, world.day);
        const W = TownTrade.withhold(s, world, world.day, 4);
        expect(W && W.goods).toBeTruthy();
        // The market's turn: the producers' share is kept back (market.withheld), not stocked
        const prod = SettlementMarket.productionList(Object.fromEntries(Object.keys(W.goods).map(g => [g, 5])));
        s.market.prod = prod;
        SettlementMarket.processSettlement(s, prod, { day: world.day, days: 4, withhold: W });
        const held = { ...s.market.withheld };
        expect(Object.values(held).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        // Their next step: handed to them, and what's over the keep goes to market
        const farmer = s.folk.people.find(p => p.job && p.job.id === 'farmer');
        const w = s.townTrade.wares[farmer.id];
        const keep = TownTrade.config().wares.keep;
        w.cabbage = keep + 3;
        const before = SettlementMarket.stock(s, 'cabbage');
        world.day += 4;
        TownTrade.step(world, s, world.day);
        expect(s.market.withheld).toBeUndefined();
        expect(s.townTrade.book.withheld).toBeGreaterThan(0);
        expect(w.cabbage).toBe(keep);
        expect(s.townTrade.book.delivered).toBeGreaterThanOrEqual(3);
        // (some of the cabbage then sold to the households, but the 3 over the keep reached the stalls)
        expect(SettlementMarket.stock(s, 'cabbage') + larderUnits(s.townTrade)).toBeGreaterThan(before + 2.9);
    });
});

describe('neighbours barter', () => {
    it('two households swap goods for goods of the same worth; both larders change and they warm to each other', () => {
        const { world, s } = setup();
        TownTrade.step(world, s, world.day);
        const st = s.townTrade;
        const [a, b] = TownTrade.households(s.folk, world.day).filter(h => h.adults.length);
        const rates = TownTrade.rates(s);
        const tgt = (hh, g) => TownTrade.target(hh, rates.find(r => r.g === g));
        st.hh[a.key].l.fish = tgt(a, 'fish') + 1; st.hh[a.key].l.bread = 0;
        st.hh[b.key].l.bread = tgt(b, 'bread') + 1; st.hh[b.key].l.fish = 0;
        // (no wares in the way: only the larders' spare)
        for (const p of [...a.adults, ...b.adults]) delete st.wares[p.id];
        const g0 = goodsTotal([s]);
        const r = TownTrade.barter(world, s, a, b, world.day, { rates });
        expect(r).toBeTruthy();
        expect(st.hh[b.key].l[r.give]).toBeGreaterThan(0);
        expect(st.hh[a.key].l[r.get]).toBeGreaterThan(0);
        expect([r.give, r.get].sort()).toEqual(['bread', 'fish']);
        // Of the same worth (within a lot's rounding)
        const p = TownTrade._priceFn(world, s);
        expect(Math.abs(r.gUnits * p(r.give) - r.rUnits * p(r.get))).toBeLessThan(0.02 * Math.max(p(r.give), p(r.get)) + 1e-9);
        const g1 = goodsTotal([s]);
        for (const g of GOODS()) expect(g1[g] || 0, g).toBeCloseTo(g0[g] || 0, 9);
        expect(Object.values(st.ties).some(v => v > 0)).toBe(true);
        expect(a.adults[0].log.some(e => e.k === 'bartered')).toBe(true);
    });
});

describe('pedlars', () => {
    it('a pedlar carries real goods bought at another town\'s market, sells them door to door, and every coin is accounted for', () => {
        const { world, s, other } = setup();
        TownTrade.step(world, s, world.day);
        // Brightwater has salt and candles to spare and sells them cheap
        other.market.stock.salt = SettlementMarket.target(other, 'salt') * 3;
        other.market.stock.candles = SettlementMarket.target(other, 'candles') * 3;
        s.market.stock.salt = SettlementMarket.target(s, 'salt') * 0.3;
        s.market.stock.candles = SettlementMarket.target(s, 'candles') * 0.3;
        for (const h of Object.values(s.townTrade.hh)) for (const g of ['salt', 'candles']) { if (h.l[g]) SettlementMarket.add(s, g, h.l[g]); delete h.l[g]; }
        s.townTrade.lastPedlar = world.day - 100;
        const g0 = goodsTotal([s, other]), c0 = coinTotal([s, other]);
        const salt0 = SettlementMarket.stock(other, 'salt') + SettlementMarket.stock(other, 'candles');
        world.day += 4;
        TownTrade.step(world, s, world.day);
        const ped = s.townTrade.pedlars[0];
        expect(ped).toBeTruthy();
        expect(ped.fromName).toBe('Brightwater');
        const packed = Object.values(ped.pack).reduce((a, b) => a + b, 0);
        expect(packed).toBeGreaterThan(0);
        expect(SettlementMarket.stock(other, 'salt') + SettlementMarket.stock(other, 'candles')).toBeLessThan(salt0);
        // On arrival they go door to door (their salt and candles used up: back to the stalls, for the test)
        for (const h of Object.values(s.townTrade.hh)) for (const g of ['salt', 'candles']) { if (h.l[g]) SettlementMarket.add(s, g, h.l[g]); delete h.l[g]; }
        world.day = ped.arrive;
        TownTrade.step(world, s, world.day);
        expect(ped.phase).toBe('town');
        expect(s.townTrade.book.pedlarSales).toBeGreaterThan(0);
        // ...and when the stay is done they sell the rest and move on (or settle)
        world.day = ped.until;
        TownTrade.step(world, s, world.day);
        const g1 = goodsTotal([s, other]);
        for (const g of GOODS()) expect(g1[g] || 0, g).toBeCloseTo(g0[g] || 0, 6);
        expect(coinTotal([s, other])).toBeCloseTo(c0, 6);
        expect(s.folk.annals.some(e => e.k === 'pedlar')).toBe(true);
    });
});

describe('free talk sells from real stock', () => {
    it('a townsperson sells their own wares: out of their stock, the coin into their purse', () => {
        const { world, s } = setup();
        TownTrade.step(world, s, world.day);
        const farmer = s.folk.people.find(p => p.job && p.job.id === 'farmer');
        s.townTrade.wares[farmer.id] = { eggs: 3 };
        const npc = { id: 1, name: farmer.first, type: 'farmer', _person: farmer, _folk: s.folk };
        const player = { name: 'Ash', gold: 100, inventory: {}, maxInventory: 99, relationships: {} };
        const who = NpcChat.townSubject(player, npc, { place: s.name });
        const stock = who.stock(world);
        expect(stock.eggs.qty).toBe(3);
        const purse0 = farmer.purse;
        const session = NpcChat.startSession(player, world, who);
        NpcChat.applyActions(player, world, who, session, [{ fn: 'sell_item', item: 'eggs', qty: 2, price: 99 }]);
        expect(player.inventory.eggs).toBe(2);
        expect(s.townTrade.wares[farmer.id].eggs).toBeCloseTo(1, 9);
        expect(farmer.purse).toBeCloseTo(purse0 + (100 - player.gold), 6);
    });

    it('someone off the roster carries their town\'s goods on consignment: out of its stock, back the next day — nothing conjured', () => {
        const { world, s } = setup();
        Relationships._npcs = [];
        const baker = { id: 'tt_baker', firstName: 'Hal', occupation: 'baker', settlementName: 'Ashford', isAlive: true };
        Relationships._npcs.push(baker);
        const player = { name: 'Ash', q: 1, r: 1, gold: 100, inventory: {}, maxInventory: 99, relationships: {}, actionPoints: 5, army: [] };
        const bread0 = SettlementMarket.stock(s, 'bread');
        const who = NpcChat.relationshipSubject(player, baker);
        const stock = who.stock(world);
        const carried = stock.bread.qty;
        expect(carried).toBeGreaterThan(0);
        expect(SettlementMarket.stock(s, 'bread')).toBeCloseTo(bread0 - carried, 6);
        // Nowhere to draw on: nothing to give
        const lost = NpcChat.relationshipSubject(player, { id: 'tt_lost', firstName: 'Nobody', occupation: 'baker', settlementName: 'Nowhere' });
        expect(Object.keys(lost.stock(world))).toEqual([]);
        // The next day the leftovers go back to the market
        world.day += 1;
        who.stock(world);
        const now = Relationships.getRelationship(player, baker.id).stock.items.bread.qty;
        expect(SettlementMarket.stock(s, 'bread')).toBeCloseTo(bread0 - now, 6);
    });

    it('the player buys a producer\'s wares in the street dialog the same way', () => {
        const { world, s } = setup();
        TownTrade.step(world, s, world.day);
        const smith = s.folk.people.find(p => p.job && p.job.id === 'smith');
        s.townTrade.wares[smith.id] = { tools: 2 };
        const player = { gold: 500, inventory: {}, maxInventory: 99 };
        const purse0 = smith.purse;
        const r = TownTrade.sellToPlayer(player, world, s, smith, 'tools', 1);
        expect(r.ok).toBe(true);
        expect(player.inventory.tools).toBe(1);
        expect(s.townTrade.wares[smith.id].tools).toBeCloseTo(1, 9);
        expect(smith.purse).toBeCloseTo(purse0 + r.price, 6);
        expect(500 - player.gold).toBe(r.price);
        expect(TownTrade.sellToPlayer(player, world, s, smith, 'tools', 5).ok).toBe(false);
    });
});

describe('disputes', () => {
    it('short weight caught: the buyer refunded, the cheat fined into the town\'s purse, a grudge brawls reads, and a \'cheated\' line in the buyer\'s life', () => {
        tune('cheats', { chance: 1, crookedShare: 1, caughtChance: 1 });
        const { world, s, other } = setup();
        const c0 = coinTotal([s, other]);
        TownTrade.step(world, s, world.day);
        const st = s.townTrade;
        expect(st.book.cheats).toBeGreaterThan(0);
        expect(st.book.caught).toBe(st.book.cheats);
        expect(st.book.fines).toBeGreaterThan(0);
        expect(s.folk.people.some(p => p.log.some(e => e.k === 'fined'))).toBe(true);
        expect(s.folk.people.some(p => p.log.some(e => e.k === 'cheated'))).toBe(true);
        expect(Object.values(s.brawls.feuds).some(f => f.why === 'cheated')).toBe(true);
        expect(coinTotal([s, other])).toBeCloseTo(c0, 6);
        // (and the town's annals tell it)
        const e = s.folk.annals.find(x => x.k === 'fined');
        expect(Townsfolk.annalText(s.folk, e, world)).toMatch(/short weight/);
    });

    it('a bargain driven too hard sours the buyer on the seller', () => {
        const { world, s } = setup();
        const buyer = s.folk.people.find(p => Townsfolk.isHere(p) && p.job && p.job.id !== 'baker' && Townsfolk.age(p, world.day) >= 16);
        const baker = s.folk.people.find(p => p.job && p.job.id === 'baker');
        const f = TownTrade.grudge(world, s, buyer, baker, world.day, 20, 'dear', 'bread');
        expect(f.why).toBe('cheated');
        expect(buyer.log.at(-1)).toMatchObject({ k: 'cheated', o: baker.id });
        expect(Townsfolk.lifeText(s.folk, buyer, buyer.log.at(-1), world)).toMatch(/skinned me/);
    });
});

describe('on the street map', () => {
    it('a shopper at a stall buys for real and carries a sack home; a producer\'s sack to market lands in its stock', () => {
        const { world, s } = setup();
        TownTrade.step(world, s, world.day);
        const baker = s.folk.people.find(p => p.job && p.job.id === 'baker');
        const buyer = s.folk.people.find(p => Townsfolk.isHere(p) && p !== baker && p.purse > 0 && Townsfolk.age(p, world.day) >= 16);
        const st = s.townTrade;
        const key = TownTrade.hhKey(s.folk, buyer, world.day);
        if (st.hh[key].l.bread) SettlementMarket.add(s, 'bread', st.hh[key].l.bread);
        delete st.hh[key].l.bread;
        const bread0 = SettlementMarket.stock(s, 'bread');
        const stall = { vendorId: 9 };
        const vendor = { id: 9, name: baker.first, _vending: stall, _person: baker, q: 1, r: 1 };
        const npc = { id: 1, name: buyer.first, _person: buyer, _shopAt: stall, q: 1, r: 2 };
        const saved = { ref: InnerMap._currentWorldTileRef, world: InnerMap._tradeWorld, npcs: InnerMap.npcs, goods: InnerMap._sceneStallGoods };
        try {
            InnerMap._currentWorldTileRef = { settlement: s };
            InnerMap._tradeWorld = world;
            InnerMap.npcs = [npc, vendor];
            InnerMap._sceneStallGoods = () => ['bread'];
            InnerMap._tradeArrived(npc, 'shop');
            expect(npc._carry).toMatchObject({ good: 'bread', bought: true });
            expect(st.hh[key].l.bread).toBeGreaterThan(0);
            expect(SettlementMarket.stock(s, 'bread')).toBeCloseTo(bread0 - st.hh[key].l.bread, 6);
            // ...and home with it
            expect(InnerMap._tradeDelivered(npc, { type: 'house' })).toBe(true);
            expect(npc._carry).toBe(null);
            // A producer's sack to market
            const farmer = s.folk.people.find(p => p.job && p.job.id === 'farmer');
            st.wares[farmer.id] = { cabbage: 3 };
            const cab0 = SettlementMarket.stock(s, 'cabbage');
            const fnpc = { id: 2, _person: farmer, _carry: { good: 'cabbage', qty: 0, toMarket: true } };
            expect(InnerMap._tradeDelivered(fnpc, { type: 'marketplace' })).toBe(true);
            expect(SettlementMarket.stock(s, 'cabbage')).toBeCloseTo(cab0 + 3 - TownTrade.config().wares.keep, 6);
        } finally {
            InnerMap._currentWorldTileRef = saved.ref;
            InnerMap._tradeWorld = saved.world;
            InnerMap.npcs = saved.npcs;
            InnerMap._sceneStallGoods = saved.goods;
        }
    });
});

describe('the player at the stalls', () => {
    it('the player\'s purchase leaves less for the townsfolk, and dearer', () => {
        const a = setup(), b = setup();
        // The player buys most of Ashford's bread in one of them
        const take = SettlementMarket.stock(b.s, 'bread') - 0.1;
        SettlementMarket.take(b.s, 'bread', take);
        const pa = TownTrade.price(a.world, a.s, 'bread'), pb = TownTrade.price(b.world, b.s, 'bread');
        expect(pb).toBeGreaterThan(pa);
        TownTrade.step(a.world, a.s, a.world.day);
        TownTrade.step(b.world, b.s, b.world.day);
        const bought = (s) => Object.values(s.townTrade.hh).reduce((t, h) => t + (h.l.bread || 0), 0);
        expect(bought(b.s)).toBeLessThan(bought(a.s));
    });
});

describe('the books', () => {
    it('conservation holds over a season of steps: no unit or coin made or lost', () => {
        const { world, s, other } = setup();
        s.townTrade = undefined;
        const g0 = goodsTotal([s, other]), c0 = coinTotal([s, other]);
        for (let i = 0; i < 12; i++) {
            if (i === 3) s.townTrade.lastPedlar = world.day - 100;
            TownTrade.step(world, s, world.day);
            world.day += 4;
        }
        const g1 = goodsTotal([s, other]);
        for (const g of GOODS()) expect(g1[g] || 0, g).toBeCloseTo(g0[g] || 0, 5);
        expect(g1._gone).toBeGreaterThan(0);
        expect(coinTotal([s, other])).toBeCloseTo(c0, 5);
    });

    it('is deterministic: the same town trades the same way', () => {
        const run = () => {
            const { world, s, other } = setup();
            for (let i = 0; i < 8; i++) {
                if (i === 2) s.townTrade.lastPedlar = world.day - 100;
                TownTrade.step(world, s, world.day);
                world.day += 4;
            }
            return JSON.stringify({ t: s.townTrade, m: s.market.stock, o: other.market.stock, p: s.folk.people.map(p => [p.purse, p.shopped || 0]) });
        };
        expect(run()).toBe(run());
    });

    it('old saves load: a town with no trade record starts one, and a saved one carries on as if never saved', () => {
        const a = setup(), b = setup();
        delete a.s.townTrade;
        for (let i = 0; i < 3; i++) { TownTrade.step(a.world, a.s, a.world.day); TownTrade.step(b.world, b.s, b.world.day); a.world.day += 4; b.world.day += 4; }
        // b round-trips through JSON (as a save does)
        b.s.townTrade = JSON.parse(JSON.stringify(b.s.townTrade));
        b.s.market = JSON.parse(JSON.stringify(b.s.market));
        b.s.folk = JSON.parse(JSON.stringify(b.s.folk));
        TownTrade.step(a.world, a.s, a.world.day);
        TownTrade.step(b.world, b.s, b.world.day);
        expect(JSON.stringify(b.s.townTrade)).toBe(JSON.stringify(a.s.townTrade));
        // ...and processDay picks up a town that never had one
        const c = setup();
        delete c.s.townTrade;
        for (let d = 0; d < 9; d++) { c.world.day++; TownTrade.processDay(c.world, null); }
        expect(c.s.townTrade.book.bought).toBeGreaterThan(0);
    });
});

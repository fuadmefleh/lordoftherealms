/**
 * The player's price knowledge (systems/priceKnowledge.js): prices are known
 * only from visits, factors' and stewards' reports, merchants met on the road
 * and tavern talk; each quote ages; the book is capped; the ledger's spreads
 * use only what is known; the trading P&L; save round trip and determinism.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { PriceKnowledge } from '../systems/priceKnowledge.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Tavern } from '../player/tavern.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

let _saved = null;
function tune(fn) {
    const d = DataLoader._gamedata.priceKnowledge;
    if (!_saved) _saved = JSON.parse(JSON.stringify(d));
    fn(d);
}
afterEach(() => {
    if (_saved) DataLoader._gamedata.priceKnowledge = _saved;
    _saved = null;
    Utils.resetRng();
});

/** A few towns in a row on plains; the player stands in the first. */
function fixture(n = 4) {
    const towns = [];
    const tiles = new Map();
    const types = ['capital', 'town', 'village', 'city', 'town', 'village', 'town', 'town'];
    for (let i = 0; i < n; i++) {
        const s = { name: `T${i}`, type: types[i % types.length], population: 3000 + i * 500, kingdom: 'k1', q: 2 + i * 4, r: 5, economy: { gold: 0 } };
        SettlementMarket.ensure(s);
        towns.push(s);
        tiles.set(`${s.q},${s.r}`, { q: s.q, r: s.r, terrain: { id: 'plains', passable: true }, resource: null, settlement: s });
    }
    const kingdoms = [{ id: 'k1', name: 'Aster', isAlive: true, wars: [] }];
    const world = {
        width: 80, height: 40, day: 30, activeEvents: [], units: [], kingdoms,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || { q, r, terrain: { id: 'plains', passable: true } },
        getSettlementViews: () => towns, getAllSettlements: () => towns,
    };
    const player = { q: towns[0].q, r: towns[0].r, gold: 5000, inventory: {}, skills: { commerce: 0 }, reputation: {}, name: 'Tester' };
    return { world, player, towns };
}

describe('where price knowledge comes from', () => {
    it('a visit records the whole market as it stands, and only that town', () => {
        const { world, player, towns } = fixture();
        PriceKnowledge.processDay(player, world);
        const tile = world.getTile(towns[0].q, towns[0].r);
        const q = PriceKnowledge.quote(player, world, towns[0].q, towns[0].r, 'grain');
        expect(q.ask).toBe(Economy.marketAsk(world, tile, 'grain'));
        expect(q.scarcity).toBeCloseTo(SettlementMarket.scarcity(towns[0], 'grain'), 2);
        expect(q.age).toBe(0);
        expect(q.src).toBe('v');
        // Not omniscient: the other towns are unknown
        expect(PriceKnowledge.towns(player).map(t => t.name)).toEqual(['T0']);
        expect(PriceKnowledge.quote(player, world, towns[1].q, towns[1].r, 'grain')).toBe(null);
        expect(PriceKnowledge.known(player, world, 'grain').length).toBe(1);
    });

    it('no stall in the book pays more than it asks (a fair\'s generous stalls, a town that values a good dear)', () => {
        const { world, player, towns } = fixture();
        // (worth far more there than the stall asks: the book's "pays" still stops below the ask, as a sale does)
        vi.spyOn(SettlementMarket, 'value').mockReturnValue(1000);
        PriceKnowledge.processDay(player, world);
        vi.restoreAllMocks();
        const t = PriceKnowledge.towns(player)[0];
        expect(t).toBeTruthy();
        for (const id of SettlementMarket.config().goodIds) {
            const q = PriceKnowledge.quote(player, world, towns[0].q, towns[0].r, id);
            if (q && q.ask > 0) expect(q.bid, id).toBeLessThan(q.ask);
        }
    });

    it('quotes age, and the book shows how old they are', () => {
        const { world, player, towns } = fixture();
        PriceKnowledge.processDay(player, world);
        player.q = 60; player.r = 30; // gone travelling
        world.day += 12;
        // The market moves on, the book doesn't
        towns[0].market.stock.grain = 1;
        PriceKnowledge.processDay(player, world);
        const q = PriceKnowledge.quote(player, world, towns[0].q, towns[0].r, 'grain');
        expect(q.age).toBe(12);
        expect(PriceKnowledge.ageText(q.age)).toBe('12 days old');
        expect(PriceKnowledge.ageText(1)).toBe('1 day old');
        expect(PriceKnowledge.ageText(0)).toBe('today');
        expect(q.ask).toBeLessThan(Economy.marketAsk(world, world.getTile(towns[0].q, towns[0].r), 'grain'));
    });

    it('tavern talk gives a few goods, as reported, estimated from the town\'s size', () => {
        const { world, player, towns } = fixture();
        const t = towns[1];
        Tavern._storeRumors(player, [{
            category: 'market_prices', title: `Prices in ${t.name}`, text: '...', day: 25,
            quotes: [{ q: t.q, r: t.r, name: t.name, type: t.type, good: 'iron', price: 40 }],
        }]);
        const q = PriceKnowledge.quote(player, world, t.q, t.r, 'iron');
        expect(q.src).toBe('t');
        expect(q.day).toBe(25);
        expect(q.age).toBe(5);
        expect(q.ask).toBe(Math.round(40 * PriceKnowledge.config().askBySize[t.type]));
        expect(q.bid).toBe(Math.floor(40 * PriceKnowledge.config().sellShare));
        expect(PriceKnowledge.quote(player, world, t.q, t.r, 'grain')).toBe(null);
    });

    it('real tavern price intel feeds the book', () => {
        const g = newGame(101);
        const tile = g.world.getTile(g.player.q, g.player.r);
        const dest = g.world.getAllSettlements().find(s => s.q !== g.player.q || s.r !== g.player.r);
        const from = tile && tile.settlement ? tile : { q: g.player.q, r: g.player.r, settlement: { name: 'here' } };
        const rumor = Tavern._generatePriceIntel(dest, from, g.world, Tavern.RELIABILITY.MERCHANT_INFO);
        expect(rumor.quotes.length).toBeGreaterThanOrEqual(3);
        Tavern._storeRumors(g.player, [rumor]);
        const known = PriceKnowledge.towns(g.player).find(t => t.q === dest.q && t.r === dest.r);
        expect(known).toBeTruthy();
        expect(known.goods).toBe(new Set(rumor.quotes.map(x => x.good)).size);
    });

    it('a merchant met on the road tells its goods\' worth at both ends, as of its setting out', () => {
        const { world, player, towns } = fixture();
        const u = {
            id: 'trade_1', type: 'trade_caravan', q: player.q + 1, r: player.r, sourceQ: towns[2].q, sourceR: towns[2].r,
            targetQ: towns[3].q, targetR: towns[3].r, fromName: 'T2', toName: 'T3', departed: 27,
            prices: { salt: [12, 20] }, cargo: { salt: 30 }, destroyed: false,
        };
        PriceKnowledge.processDay(player, world, { traders: [u] });
        const a = PriceKnowledge.quote(player, world, towns[2].q, towns[2].r, 'salt');
        const b = PriceKnowledge.quote(player, world, towns[3].q, towns[3].r, 'salt');
        expect(a.src).toBe('c');
        expect(a.day).toBe(27);
        expect(a.bid).toBe(Math.floor(12 * 0.7));
        expect(b.bid).toBe(Math.floor(20 * 0.7));
        // ...but only one met (a caravan far off tells nothing)
        const far = { ...u, id: 'trade_2', q: player.q + 20, prices: { wool: [5, 9] } };
        PriceKnowledge.processDay(player, world, { traders: [far] });
        expect(PriceKnowledge.quote(player, world, towns[2].q, towns[2].r, 'wool')).toBe(null);
        expect(MerchantCaravans.isTrader(u)).toBe(true);
    });

    it('factors and stewards report their towns every few days', () => {
        const { world, player, towns } = fixture();
        player.q = 70; player.r = 30;
        PriceKnowledge.processDay(player, world, { posts: [{ q: towns[1].q, r: towns[1].r }], holdings: [{ q: towns[2].q, r: towns[2].r }] });
        expect(PriceKnowledge.quote(player, world, towns[1].q, towns[1].r, 'grain').src).toBe('f');
        expect(PriceKnowledge.quote(player, world, towns[2].q, towns[2].r, 'grain').src).toBe('h');
        world.day++;
        PriceKnowledge.processDay(player, world, { posts: [{ q: towns[1].q, r: towns[1].r }] });
        expect(PriceKnowledge.quote(player, world, towns[1].q, towns[1].r, 'grain').day).toBe(30);
        world.day += PriceKnowledge.config().reportEvery;
        PriceKnowledge.processDay(player, world, { posts: [{ q: towns[1].q, r: towns[1].r }] });
        expect(PriceKnowledge.quote(player, world, towns[1].q, towns[1].r, 'grain').day).toBe(world.day);
    });

    it('fresher news replaces older; older news never overwrites fresher', () => {
        const { world, player, towns } = fixture();
        const t = towns[1];
        PriceKnowledge.learn(player, world, t, 'iron', 30, 20, 't');
        PriceKnowledge.learn(player, world, t, 'iron', 50, 10, 'c');
        expect(PriceKnowledge.quote(player, world, t.q, t.r, 'iron').day).toBe(20);
        PriceKnowledge.learn(player, world, t, 'iron', 50, 25, 'c');
        expect(PriceKnowledge.quote(player, world, t.q, t.r, 'iron').day).toBe(25);
    });
});

describe('caps', () => {
    it('keeps at most maxTowns towns, dropping the stalest', () => {
        tune(d => { d.maxTowns = 3; });
        const { world, player, towns } = fixture(6);
        towns.forEach((t, i) => PriceKnowledge.learn(player, world, t, 'grain', 5, 10 + i, 't'));
        const names = PriceKnowledge.towns(player).map(t => t.name).sort();
        expect(names).toEqual(['T3', 'T4', 'T5']);
    });

    it('keeps a short price history for the markets visited last', () => {
        tune(d => { d.historySamples = 3; d.historyTowns = 2; d.historyEvery = 2; });
        const { world, player, towns } = fixture(4);
        for (let i = 0; i < 10; i++) {
            PriceKnowledge.processDay(player, world);
            world.day++;
        }
        const h = PriceKnowledge.history(player, towns[0].q, towns[0].r, 'grain');
        expect(h.length).toBe(3);
        expect(h.every(x => x.price > 0)).toBe(true);
        expect(h[2].day - h[1].day).toBeGreaterThanOrEqual(2);
        for (const t of towns.slice(1)) {
            player.q = t.q; player.r = t.r;
            PriceKnowledge.processDay(player, world);
            world.day++;
        }
        expect(PriceKnowledge.historyTowns(player).map(t => t.name)).toEqual(['T3', 'T2']);
    });

    it('stays small through a long game', () => {
        const g = newGame(202);
        const st = PriceKnowledge.state(g.player);
        for (const s of g.world.getAllSettlements()) PriceKnowledge.observe(g.player, g.world, s, 'f');
        expect(Object.keys(st.towns).length).toBeLessThanOrEqual(PriceKnowledge.config().maxTowns);
        expect(JSON.stringify(st).length).toBeLessThan(40000);
    });
});

describe('the ledger', () => {
    it('spreads come only from what is known, within reach', () => {
        const { world, player, towns } = fixture(4);
        // Known: iron cheap in T1, dear in T2; T3 (dearer still) is unknown
        PriceKnowledge.learn(player, world, towns[1], 'iron', 10, 28, 't');
        PriceKnowledge.learn(player, world, towns[2], 'iron', 40, 29, 't');
        towns[3].market.stock.iron = 0;
        const list = PriceKnowledge.spreads(player, world, { days: 8 });
        expect(list.length).toBe(1);
        expect(list[0].good).toBe('iron');
        expect(list[0].buy.name).toBe('T1');
        expect(list[0].sell.name).toBe('T2');
        expect(list[0].margin).toBe(Math.floor(40 * 0.7) - Math.round(10 * PriceKnowledge.config().askBySize[towns[1].type]));
        expect(list[0].age).toBe(2);
        // The live markets don't change what the ledger says
        towns[2].market.stock.iron = 1e6;
        expect(PriceKnowledge.spreads(player, world, { days: 8 })[0].margin).toBe(list[0].margin);
        // Out of reach: nothing
        expect(PriceKnowledge.spreads(player, world, { days: 0 }).length).toBe(0);
        expect(PriceKnowledge.spreads(player, world, { days: 8, maxAge: 1 }).length).toBe(0);
    });

    it('books trading profit by good and by route', () => {
        const { world, player, towns } = fixture(3);
        const buyTile = world.getTile(towns[0].q, towns[0].r);
        const entry = Trading.getAvailableGoods(towns[0], buyTile, world).find(g => g.id === 'wool');
        const res = Trading.buyGoods(player, entry, 10, towns[0]);
        expect(res.success).toBe(true);
        towns[2].market.stock.wool = 0.5; // a dearth of wool there
        const sale = Trading.sellGoods(player, 'wool', 10, towns[2], world);
        expect(sale.success).toBe(true);
        const p = PriceKnowledge.pnl(player);
        const g = p.goods.find(x => x.id === 'wool');
        expect(g.bought).toBe(10);
        expect(g.spent).toBe(res.spent);
        expect(g.earned).toBe(sale.earned);
        expect(g.profit).toBe(sale.earned - res.spent);
        expect(p.routes[0].route).toBe('T0 → T2');
        expect(p.total).toBe(g.profit);
        // Goods found or looted count as free
        player.inventory.salt = 5;
        Trading.sellGoods(player, 'salt', 5, towns[1], world);
        expect(PriceKnowledge.pnl(player).routes.some(r => r.route === 'found or made → T1')).toBe(true);
    });
});

describe('in the game', () => {
    it('the daily tick fills the book as the player goes, and a save round trip keeps it', () => {
        const g = newGame(101);
        for (let i = 0; i < 5; i++) endDay(g);
        const st = PriceKnowledge.state(g.player);
        const here = g.world.getTile(g.player.q, g.player.r);
        if (here && here.settlement) expect(st.towns[`${g.player.q},${g.player.r}`]).toBeTruthy();
        PriceKnowledge.learn(g.player, g.world, g.world.getAllSettlements()[3], 'iron', 33, g.world.day, 't');
        const before = JSON.stringify(g.player.priceBook);
        const g2 = roundTrip(g);
        expect(JSON.stringify(g2.player.priceBook)).toBe(before);
    });

    it('an older save without a book backfills a blank one', () => {
        const g = newGame(101);
        const data = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(g.player)));
        delete data.priceBook;
        const p = {};
        Object.assign(p, data);
        delete p.priceBook;
        PriceKnowledge.loadState(p);
        expect(p.priceBook).toEqual(PriceKnowledge._blank());
    });

    it('draws no dice, and two runs of a seed keep the same book', () => {
        const run = () => {
            const g = newGame(303);
            for (let i = 0; i < 12; i++) endDay(g);
            return JSON.stringify(g.player.priceBook);
        };
        expect(run()).toBe(run());
        const { world, player } = fixture(4);
        Utils.setSeed(77);
        const a = Utils.random();
        Utils.setSeed(77);
        PriceKnowledge.processDay(player, world, { posts: [{ q: 6, r: 5 }], holdings: [{ q: 10, r: 5 }] });
        expect(Utils.random()).toBe(a);
    });
});

describe('data', () => {
    it('is registered and every good it quotes is a real good', () => {
        expect(DataLoader._gamedata.priceKnowledge).toBeTruthy();
        const g = newGame(101);
        for (const s of g.world.getAllSettlements().slice(0, 3)) PriceKnowledge.observe(g.player, g.world, s, 'f');
        for (const id of PriceKnowledge.knownGoods(g.player)) expect(PlayerEconomy.GOODS[id.toUpperCase()]).toBeTruthy();
    });
});

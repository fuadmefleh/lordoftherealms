// Barter before coin (world/barter.js): a world begun at the dawn has no coin;
// the player pays and is paid in goods, the markets are barter tables, NPC
// trade is goods for goods, and coin emerges only when population and trade
// outgrow barter — at the busiest hub, spreading along the trade roads.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Barter } from '../world/barter.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Economy } from '../world/economy.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { Mints } from '../systems/mints.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { goodsText, goodsHtml, money, moneyWords, voice } from '../ui/barterVoice.js';

const GEN = { seed: 3131, kingdomCount: 4, startYear: 1, terrainGen: 3 };
let world;
let saved;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    saved = JSON.parse(JSON.stringify(DataLoader._gamedata.dawn.barter));
    // Six years of a dawn world: villages, a few towns, their barter trade
    Utils.setSeed(77);
    world = new World(80, 60);
    world.generate({ ...GEN });
    for (let d = 0; d < 720; d++) {
        world.advanceDay(null, {});
        MarketDynamics.updatePrices(world, null);
    }
}, 120000);

afterAll(() => {
    DataLoader._gamedata.dawn.barter = saved;
});

const towns = () => Barter._towns(world);
/** The town with the most to spare */
const richest = () => towns().slice().sort((a, b) => Barter.stockValue(b.s) - Barter.stockValue(a.s))[0];
const inv = (p) => ({ ...p.inventory });
const stockOf = (s) => ({ ...s.market.stock });

function playerAt(t, gold = 250) {
    const p = new Player({ firstName: 'Test' });
    p.q = t.q;
    p.r = t.r;
    p.gold = gold;
    return p;
}

describe('a world begun with coin', () => {
    it('has no barter: coin everywhere, the start purse is coin', () => {
        Utils.setSeed(5);
        const w = new World(40, 30);
        w.generate({ seed: 99 });
        expect(w.barter == null).toBe(true);
        expect(Barter.active(w)).toBe(false);
        expect(Barter.hasCoin(w, null)).toBe(true);
        expect(Barter.flowOpts(w)).toBe(null);
        const p = new Player({});
        p.gold = 250;
        expect(Barter.beginPlayer(p, w)).toBe(null);
        expect(p.gold).toBe(250);
        expect(Barter.installed(p)).toBe(false);
        expect(Barter.processDay(w)).toBe(null);
    }, 60000);
});

describe('the dawn: no coin', () => {
    it('barter is on from the first day, and no town or chiefdom holds coin', () => {
        expect(world.barter).toBeTruthy();
        expect(Barter.active(world)).toBe(true);
        expect(world.barter.coinDay).toBe(null);
        expect(towns().length).toBeGreaterThan(3);
        for (const t of towns()) {
            expect(Barter.hasCoin(world, t.s)).toBe(false);
            expect(Number(t.s.economy ? t.s.economy.gold : 0) || 0).toBe(0);
        }
        for (const k of world.kingdoms) expect(k.treasury).toBe(0);
    });

    it('NPC trade between the villages moves goods, not coin', () => {
        const booked = towns().reduce((s, t) => s + (Number(t.s.market.trade.bv) || 0) + (Number(t.s.market.trade.bvLast) || 0), 0);
        expect(booked).toBeGreaterThan(0);
        const moved = towns().reduce((s, t) => s + (Number(t.s.market.trade.in) || 0), 0);
        expect(moved).toBeGreaterThan(0);
        // ...and another day of it leaves every purse empty
        world.advanceDay(null, {});
        const flow = MarketDynamics.updatePrices(world, null);
        expect(flow.gold >= 0).toBe(true);
        for (const t of towns()) expect(Number(t.s.economy ? t.s.economy.gold : 0) || 0).toBe(0);
    });

    it('the money supply counts nothing and strikes nothing', () => {
        for (let i = 0; i < 3; i++) {
            world.money && (world.money.lastDay = null);
            Mints.processDay(world, null);
        }
        for (const k of world.kingdoms) {
            const c = MoneySupply.coin(world, k.id);
            expect(c === null || c === 0).toBe(true);
            const R = MoneySupply.realm(world, k.id);
            if (R) expect(R.tot.mint || 0).toBe(0);
        }
        const census = CoinCensus.count(world, null);
        for (const v of census.values()) expect(v.broad).toBe(0);
    });
});

describe("the player's purse in kind", () => {
    it('a dawn start: no coin, the start purse given as goods of its worth', () => {
        const t = richest();
        const p = playerAt(t, 250);
        const kit = Barter.beginPlayer(p, world);
        expect(Object.keys(kit).length).toBeGreaterThan(2);
        expect(Barter.coinOf(p)).toBe(0);
        expect(Barter.installed(p)).toBe(true);
        expect(Barter.inKind(p)).toBe(true);
        expect(p.gold).toBe(Barter.purse(p));
        let worth = 0;
        for (const [id, q] of Object.entries(kit)) worth += q * Barter.unitValue(id);
        expect(worth).toBeLessThanOrEqual(250);
        expect(worth).toBeGreaterThan(200);
        // ...and the census sees no coin in it
        expect(JSON.parse(JSON.stringify(p)).gold).toBeUndefined();
    });

    it('paying hands over goods of that worth to the town, food last', () => {
        const t = richest();
        const p = playerAt(t, 250);
        Barter.beginPlayer(p, world);
        const before = inv(p), st = stockOf(t.s), purse = p.gold;
        p.gold -= 20;
        const after = inv(p);
        let paid = 0;
        for (const [id, q] of Object.entries(before)) {
            const gone = q - (after[id] || 0);
            if (gone > 0) {
                paid += gone * Barter.unitValue(id);
                if (SettlementMarket.tracks(id)) expect(t.s.market.stock[id]).toBeCloseTo((st[id] || 0) + gone, 1);
            }
        }
        expect(paid).toBeGreaterThanOrEqual(20);
        expect(purse - p.gold).toBeGreaterThanOrEqual(20 - 0.01);
        expect(purse - p.gold).toBeLessThanOrEqual(paid + 0.01);
        expect(after.bread).toBe(before.bread);
        expect(Barter.coinOf(p)).toBe(0);
        // ...and the town takes no coin on top (the goods were the payment): payTown is a no-op there
        expect(t.s.inKind).toBe(true);
        expect(Economy.payTown(t.s, 20)).toBe(0);
        expect(Number(t.s.economy ? t.s.economy.gold : 0) || 0).toBe(0);
    });

    it('being paid takes goods out of the town\'s stock — and nothing from nobody', () => {
        const t = richest();
        const p = playerAt(t, 0);
        Barter.install(p, world);
        const before = inv(p), st = stockOf(t.s), purse = p.gold;
        p.gold += 60;
        const after = inv(p);
        let got = 0;
        for (const [id, q] of Object.entries(after)) {
            const came = q - (before[id] || 0);
            if (came > 0) {
                got += came * Barter.unitValue(id);
                expect(t.s.market.stock[id]).toBeCloseTo(st[id] - came, 1);
            }
        }
        expect(got).toBeGreaterThan(0);
        expect(got).toBeLessThanOrEqual(60);
        expect(p.gold - purse).toBe(got);
        // In the wild there's nobody to pay: nothing comes
        const wild = world.tiles.flat().find(x => x.terrain.passable && !x.settlement);
        p.q = wild.q;
        p.r = wild.r;
        const w0 = p.gold;
        p.gold += 60;
        expect(p.gold).toBe(w0);
    });

    it('a barter at the market: the offer must cover the ask, goods move both ways, no coin', () => {
        const t = richest();
        const tile = world.getTile(t.q, t.r);
        const p = playerAt(t, 0);
        Barter.install(p, world);
        p.inventory = { hide: 40, wool: 30 };
        const id = SettlementMarket.config().goodIds.find(g => !['hide', 'wool'].includes(g) && Barter.unitValue(g) > 0 && SettlementMarket.available(t.s, g) >= 3);
        expect(id).toBeTruthy();
        const want = { [id]: 2 };
        const ask = Barter.weigh(world, p, t.s, tile, want, {}).ask;
        // Not enough: refused
        const tiny = Barter.trade(world, p, t.s, tile, want, { hide: 1 });
        expect(tiny.success).toBe(false);
        expect(p.inventory.hide).toBe(40);
        // Enough: hides by the worth the town gives for them
        let n = 1;
        while (Barter.offerValue(world, t.s, tile, 'hide', n) < ask && n < 40) n++;
        const stHide = SettlementMarket.stock(t.s, 'hide'), stWant = SettlementMarket.stock(t.s, id);
        const res = Barter.trade(world, p, t.s, tile, want, { hide: n });
        expect(res.success).toBe(true);
        expect(res.offer).toBeGreaterThanOrEqual(res.ask);
        // The cut: the market asks more than it gives for the same good
        expect(Barter.askValue(world, t.s, tile, 'hide', 1)).toBeGreaterThan(Barter.offerValue(world, t.s, tile, 'hide', 1));
        expect(p.inventory[id]).toBe(2);
        expect(p.inventory.hide).toBe(40 - n);
        expect(SettlementMarket.stock(t.s, 'hide')).toBeCloseTo(stHide + n, 1);
        expect(SettlementMarket.stock(t.s, id)).toBeCloseTo(stWant - 2, 1);
        expect(Number(t.s.economy ? t.s.economy.gold : 0) || 0).toBe(0);
        expect(Barter.coinOf(p)).toBe(0);
    });
});

describe('a dawn world left to grow', () => {
    it('barters until its people and trade outgrow it; the first coin at the busiest hub, then along the trade roads', () => {
        Utils.setSeed(77);
        const w = new World(80, 60);
        w.generate({ ...GEN });
        let first = null;
        const spreads = [];
        for (let d = 0; d < 120 * 18 && spreads.length < 2; d++) {
            w.advanceDay(null, {});
            MarketDynamics.updatePrices(w, null);
            const rec = w.barter;
            if (!first && rec.coinDay != null) {
                first = rec.coinDay;
                // The strain the season it came: every threshold passed, at the busiest barter town
                const s = rec.season;
                const T = Barter.thresholds(w, s.towns);
                expect(s.population).toBeGreaterThanOrEqual(T.population);
                expect(s.trade).toBeGreaterThanOrEqual(T.trade);
                expect(s.trading).toBeGreaterThanOrEqual(T.trading);
                const ts = Barter._towns(w);
                const hub = ts.find(t => t.q === rec.hub.q && t.r === rec.hub.r);
                const best = Math.max(...ts.map(t => Number(t.s.market && t.s.market.trade && t.s.market.trade.bvLast) || 0));
                expect(hub.s.market.trade.bvLast).toBe(best);
                expect(hub.s.coinSince).toBe(first);
            } else if (!first && rec.season && rec.lastCheck === w.day) {
                // Before it: never all of them at once
                const s = rec.season;
                const T = Barter.thresholds(w, s.towns);
                expect(s.population >= T.population && s.trade >= T.trade && s.trading >= T.trading).toBe(false);
                for (const t of Barter._towns(w)) expect(Number(t.s.economy ? t.s.economy.gold : 0) || 0).toBe(0);
            }
            if (rec.news && rec.news.day === w.day && rec.news.kind === 'spread') {
                for (const t of Barter._towns(w)) {
                    if (t.s.coinSince === w.day) expect(t.s.market.trade.bvcLast).toBeGreaterThanOrEqual(DataLoader._gamedata.dawn.barter.spread.minValue);
                }
                spreads.push(w.day);
            }
        }
        expect(first).not.toBe(null);
        expect(spreads.length).toBeGreaterThan(0);
        expect(spreads[0]).toBeGreaterThan(first);
    }, 180000);
});

describe('coin emerges when barter breaks down', () => {
    const cfg = () => DataLoader._gamedata.dawn.barter;
    const check = () => {
        world.day = Math.floor(world.day / 30) * 30 + 30;
        return Barter.processDay(world);
    };
    const setBooks = (hub, hubBv) => {
        for (const t of towns()) { t.s.market.trade.bv = t.s === hub ? hubBv : 5; t.s.market.trade.bvc = 0; }
    };

    it('not before the world\'s people and trade pass the thresholds', () => {
        const hub = towns()[1].s;
        cfg().coinEmerges = { ...saved.coinEmerges, popPerLand: 1e9, fallbackYear: 1e9 };
        setBooks(hub, 900);
        expect(check()).toBe(null);
        cfg().coinEmerges = { ...saved.coinEmerges, popPerLand: 0, tradePerLand: 1e9, fallbackYear: 1e9 };
        setBooks(hub, 900);
        expect(check()).toBe(null);
        expect(towns().some(t => t.s.coinSince != null)).toBe(false);
        expect(Barter.active(world)).toBe(true);
    });

    it('then the first coin is struck at the busiest hub, from its metal, booked as new coin', () => {
        const hub = towns()[1].s;
        cfg().coinEmerges = { ...saved.coinEmerges, popPerLand: 0, tradePerLand: 0, tradingShare: 0, minTradingTowns: 2, hubTrade: 500, fallbackYear: 1e9 };
        SettlementMarket.add(hub, 'gold_ore', SettlementMarket.target(hub, 'gold_ore') + 50);
        const ore = SettlementMarket.stock(hub, 'gold_ore');
        const realmBefore = hub.kingdom != null && MoneySupply.realm(world, hub.kingdom) ? (MoneySupply.realm(world, hub.kingdom).tot.mint || 0) : 0;
        setBooks(hub, 900);
        const news = check();
        expect(news && news.kind).toBe('firstCoin');
        expect(hub.coinSince).toBe(world.day);
        expect(world.barter.hub.name).toBe(hub.name);
        expect(SettlementMarket.stock(hub, 'gold_ore')).toBeLessThan(ore);
        const taken = ore - SettlementMarket.stock(hub, 'gold_ore');
        expect(hub.economy.gold).toBeGreaterThanOrEqual(taken * cfg().firstCoin.fine.gold_ore - 0.01);
        expect(world.barter.struck).toBeGreaterThan(0);
        if (hub.kingdom != null) expect(MoneySupply.realm(world, hub.kingdom).tot.mint).toBeGreaterThan(realmBefore);
        // Mixed: coin at the hub, barter elsewhere
        expect(Barter.active(world)).toBe(false);
        expect(Barter.active(world, hub)).toBe(false);
        expect(towns().filter(t => t.s !== hub).every(t => Barter.active(world, t.s))).toBe(true);
        expect(world.events.some(e => /first coin/i.test(e.text))).toBe(true);
    });

    it('coin spreads to the towns that traded with coin towns, not the others', () => {
        cfg().spread = { minValue: 100, perSeason: 4 };
        const rest = towns().filter(t => t.s.coinSince == null);
        const [a, b] = rest;
        for (const t of towns()) { t.s.market.trade.bv = 10; t.s.market.trade.bvc = 0; }
        a.s.market.trade.bvc = 300;
        b.s.market.trade.bvc = 5;
        const news = check();
        expect(news && news.kind).toBe('spread');
        expect(a.s.coinSince).toBe(world.day);
        expect(b.s.coinSince == null).toBe(true);
        // NPC trade: a link with a barter town is still in kind (flowOpts)
        const opts = Barter.flowOpts(world);
        expect(opts.inKind(a.s)).toBe(false);
        expect(opts.inKind(b.s)).toBe(true);
    });

    it('the player deals in coin in a coin town and in kind in a barter town; coin waits', () => {
        const hub = towns().find(t => t.s.coinSince != null);
        const barter = towns().find(t => t.s.coinSince == null);
        const p = playerAt(hub, 0);
        p.inventory = { hide: 10, bread: 5 };
        Barter.install(p, world);
        expect(Barter.inKind(p)).toBe(false);
        p.gold = 50;
        expect(p.gold).toBe(50);
        expect(p.inventory.hide).toBe(10);
        p.q = barter.q;
        p.r = barter.r;
        expect(Barter.inKind(p)).toBe(true);
        expect(p.gold).toBe(Barter.purse(p));
        expect(Barter.coinOf(p)).toBe(50);
    });

    it('a save keeps the coin, the goods and the record; the purse in kind comes back on load', () => {
        const barter = towns().find(t => t.s.coinSince == null);
        const p = playerAt(barter, 0);
        p.inventory = { hide: 12, wool: 4, bread: 6 };
        Barter.install(p, world);
        p._inKind.coin = 75;
        const data = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        expect(data.gold).toBe(75);
        expect(data.inventory).toEqual({ hide: 12, wool: 4, bread: 6 });
        const q = new Player({});
        SaveLoad.restorePlayer(data, q, world);
        expect(Barter.installed(q)).toBe(true);
        expect(Barter.coinOf(q)).toBe(75);
        expect(q.inventory).toEqual({ hide: 12, wool: 4, bread: 6 });
        expect(q.gold).toBe(Barter.purse(q));
        const w = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(world)));
        expect(w.barter).toEqual(JSON.parse(JSON.stringify(world.barter)));
    }, 60000);

    it('a late fallback year brings the first coin even without the strain', () => {
        cfg().coinEmerges = { ...saved.coinEmerges, popPerLand: 1e9, fallbackYear: 5 };
        const s = { name: 'Hub', type: 'village', population: 120 };
        SettlementMarket.ensure(s);
        const tile = { q: 0, r: 0, settlement: s };
        const w = { day: 29, year: 4, events: [], kingdoms: [], getSettlementViews: () => [{ q: 0, r: 0 }], getTile: () => tile };
        Barter.fresh(w);
        w.day = 30;
        expect(Barter.processDay(w)).toBe(null);
        w.year = 5;
        w.day = 60;
        const news = Barter.processDay(w);
        expect(news && news.kind).toBe('allCoin');
        expect(w.barter.hub.why).toBe('fallback');
        expect(w.barter.allCoin).toBe(60);
        expect(Barter.active(w, s)).toBe(false);
    });
});

describe('the rough edges', () => {
    const cfg = () => DataLoader._gamedata.dawn.barter;

    it('panels speak in goods where the player deals in kind, and in gold where coin is used', () => {
        expect(goodsText('A private room — 11 gold. Laundry 4g. 💰 Purse. Not enough gold. Gold ore and a gold bar.'))
            .toBe('A private room — ~11 ⚖. Laundry ~4 ⚖. 🎒 Purse. Not enough goods. Gold ore and a gold bar.');
        const html = '<style>.x{padding:4px 8px}</style><button title="Costs 5 gold" data-am-args=\'["gold"]\'>Buy for 5 gold</button>';
        expect(goodsHtml(html)).toBe('<style>.x{padding:4px 8px}</style><button title="Costs ~5 ⚖" data-am-args=\'["gold"]\'>Buy for ~5 ⚖</button>');
        const t = towns().find(x => x.s.coinSince == null) || towns()[0];
        const p = playerAt(t, 0);
        Barter.install(p, world);
        const game = { player: p, world };
        expect(money(game, 12)).toBe(Barter.inKind(p) ? '~12 ⚖' : '12g');
        expect(moneyWords({ player: new Player({}) }, 12)).toBe('12 gold');
        expect(voice({ player: new Player({}) }, '5 gold')).toBe('5 gold');
    });

    it('a chiefdom spends from its seat\'s stores in kind; its chests never hold coin or go below nothing', () => {
        const k = world.kingdoms.find(x => x.isAlive !== false && x.capital && Barter.active(world, world.getTile(x.capital.q, x.capital.r).settlement));
        if (!k) return; // (no chiefdom yet in this world)
        const seat = world.getTile(k.capital.q, k.capital.r).settlement;
        const before = Barter.stockValue(seat);
        k.treasury = -120;
        const res = Barter.chiefsInKind(world);
        expect(k.treasury).toBe(0);
        expect(res.find(r => r.kingdom === k.id).drawn).toBeGreaterThan(0);
        expect(before - Barter.stockValue(seat)).toBeGreaterThan(0);
    });

    it('older dawn saves are brought into barter once: purses emptied, the player\'s coin turned to goods', () => {
        const data = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(world)));
        delete data.barter;
        const t0 = towns()[0];
        // (the old shape: coin in a town's purse, the player holding coin)
        const sv = data.tiles[t0.r][t0.q].settlement;
        sv.economy.gold = 333;
        delete sv.coinSince;
        delete sv.inKind;
        const w2 = new World(80, 60);
        w2.generate(data.generationParams);
        cfg().coinEmerges = { ...saved.coinEmerges };
        SaveLoad.restoreWorld(data, w2);
        expect(w2.barter).toBeTruthy();
        expect(w2.barter.migrated).toBe(w2.day);
        expect(Barter.active(w2)).toBe(true);
        expect(w2.getTile(t0.q, t0.r).settlement.economy.gold).toBe(0);
        expect(w2.getTile(t0.q, t0.r).settlement.inKind).toBe(true);
        const old = playerAt(t0, 0);
        old.gold = 300;
        old.inventory = { bread: 5 };
        const pdata = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(old)));
        const p = new Player({});
        SaveLoad.restorePlayer(pdata, p, w2);
        expect(Barter.installed(p)).toBe(true);
        expect(Barter.coinOf(p)).toBe(0);
        expect(Object.keys(p.inventory).length).toBeGreaterThan(2);
        expect(w2.barter.migratePlayer).toBeUndefined();
        // ...and only once: a save made now loads as it is
        p._inKind.coin = 40;
        const again = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const wdata = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(w2)));
        expect(wdata.barter.migrated).toBe(w2.day);
        const w3 = new World(80, 60);
        w3.generate(wdata.generationParams);
        SaveLoad.restoreWorld(wdata, w3);
        const q = new Player({});
        SaveLoad.restorePlayer(again, q, w3);
        expect(Barter.coinOf(q)).toBe(40);
        expect(q.inventory).toEqual(p.inventory);
    }, 120000);

    it('an older dawn save already past where coin would have come stays on coin', () => {
        const data = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(world)));
        delete data.barter;
        const w2 = new World(80, 60);
        w2.generate(data.generationParams);
        cfg().coinEmerges = { ...saved.coinEmerges, popPerLand: 0 };
        SaveLoad.restoreWorld(data, w2);
        cfg().coinEmerges = { ...saved.coinEmerges };
        expect(w2.barter.allCoin).toBe(w2.day);
        expect(w2.barter.hub.why).toBe('migrated');
        expect(Barter.active(w2)).toBe(false);
        expect(Barter.lingering(w2)).toBe(false);
    }, 120000);
});

describe('no coin from nowhere before the first coin', () => {
    it('a dawn game: nothing in the census, anywhere, day after day', async () => {
        const H = await import('./playtest/harness.js');
        await H.loadData();
        const game = H.newGame(4242, { startYear: 1, terrainGen: 3, kingdomCount: 3 });
        let worst = 0, days = 0;
        for (let d = 0; d < 240 && Barter.active(game.world); d++) {
            H.endDay(game);
            if (!Barter.active(game.world)) break;
            const c = CoinCensus.total(game.world, game.player);
            if (c.total > worst) worst = c.total;
            days++;
        }
        expect(days).toBeGreaterThan(100);
        expect(worst).toBe(0);
    }, 300000);
});

describe('coin carried into a barter town', () => {
    it('a barter town that comes to hold real coin takes up coin', () => {
        // (coin has come in the shared world by now: the emergence specs ran)
        expect(world.barter.coinDay).not.toBe(null);
        const t = towns().find(x => x.s.coinSince == null);
        expect(t).toBeTruthy();
        if (!t.s.economy) Economy.initSettlement(t.s, { fresh: true });
        t.s.economy.gold = Barter.config().spread.adoptAtCoin + 5;
        for (const x of towns()) { x.s.market.trade.bv = 0; x.s.market.trade.bvc = 0; }
        world.day = Math.floor(world.day / 30) * 30 + 30;
        const news = Barter.processDay(world);
        expect(t.s.coinSince).toBe(world.day);
        expect(news && news.text).toContain(t.s.name);
    });
});

describe('coin comes at the same stage on a small and a large map', () => {
    it('both reach coin at a like density of people per land tile, in like years', () => {
        const run = (w, h, seed) => {
            Utils.setSeed(77);
            const wd = new World(w, h);
            wd.generate({ seed, kingdomCount: 4, startYear: 1, terrainGen: 3 });
            for (let d = 0; d < 120 * 30 && wd.barter.coinDay == null; d++) {
                wd.advanceDay(null, {});
                MarketDynamics.updatePrices(wd, null);
            }
            const s = wd.barter.season;
            return { year: wd.barter.coinYear, land: Barter.land(wd), perLand: s.population / Barter.land(wd), trading: s.trading / s.towns, why: wd.barter.hub && wd.barter.hub.why };
        };
        const small = run(50, 36, 3131), large = run(120, 80, 4242);
        expect(large.land).toBeGreaterThan(small.land * 3);
        for (const r of [small, large]) {
            expect(r.why).toBe('strain');
            expect(r.trading).toBeGreaterThanOrEqual(DataLoader._gamedata.dawn.barter.coinEmerges.tradingShare);
        }
        expect(Math.max(small.perLand, large.perLand) / Math.min(small.perLand, large.perLand)).toBeLessThan(1.35);
        expect(Math.abs(small.year - large.year)).toBeLessThanOrEqual(6);
    }, 300000);
});

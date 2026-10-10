// Economy leftovers & deepening (2026-10): unique town names, the harvest
// panel's years, bourse panics → coin flight, the player's cross-realm trade
// in coin, and the grain dealers' engrossing. (The roads' pace is tested in
// transport.test.js; the bot's public works and bullion in the long soak.)
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Kingdom } from '../world/kingdom.js';
import { Harvests } from '../world/harvests.js';
import { MoneySupply } from '../world/moneySupply.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { Bourse } from '../systems/bourse.js';
import { Mints } from '../systems/mints.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { Engrossing } from '../systems/engrossing.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Trading } from '../player/playerEconomy.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

afterEach(() => {
    vi.restoreAllMocks();
});

function allSettlements(world) {
    const out = [];
    for (const row of world.tiles) for (const t of row) if (t.settlement) out.push(t.settlement);
    return out;
}

const keepFed = (g) => { g.player.health = 100; g.player.inventory.bread = 40; g.player.starvationDays = 0; };

// ── 1. Unique town names ──────────────────────────────────────────────
describe('unique settlement names', () => {
    it('every settlement in a generated world has its own name', () => {
        for (const seed of [101, 202, 303, 7, 25]) {
            const { world } = newGame(seed);
            const names = allSettlements(world).map(s => s.name);
            expect(new Set(names).size).toBe(names.length);
        }
    });

    it('generateCityName draws exactly one RNG value, with or without a world', () => {
        const { world } = newGame(101);
        Utils.setSeed(9);
        Kingdom.generateCityName('Religious');
        const a = Utils.random();
        Utils.setSeed(9);
        Kingdom.generateCityName('Religious', world);
        expect(Utils.random()).toBe(a);
    });

    it('a taken name is swapped for a free one', () => {
        const { world } = newGame(101);
        const taken = Kingdom.settlementNames(world);
        for (let i = 0; i < 40; i++) {
            const n = Kingdom.generateCityName('Religious', world);
            expect(taken.has(n)).toBe(false);
        }
        // when every listed name is gone, an affixed variant
        const full = new Set([].concat(...Object.values(Kingdom._cityNames)));
        const n = Kingdom.uniqueCityName('Soulkeep', 'Religious', full);
        expect(full.has(n)).toBe(false);
        expect(n).toMatch(/Soulkeep/);
    });

    it('dedupe renames only the later duplicates', () => {
        const { world } = newGame(202);
        const [a, b] = allSettlements(world);
        const name = a.name;
        b.name = a.name;
        expect(Kingdom.dedupeSettlementNames(world)).toBe(1);
        expect(a.name).toBe(name);
        expect(b.name).not.toBe(name);
        const names = allSettlements(world).map(s => s.name);
        expect(new Set(names).size).toBe(names.length);
    });
});

// ── 2. The harvest panel: which year each figure is ───────────────────
describe('the Harvest panel', () => {
    it('labels the town\'s reaped yields and the crop in the fields with their years', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const game = newGame(101);
        for (let d = 0; d < 165; d++) {
            keepFed(game);
            endDay(game);
        }
        const tiles = game.world.getSettlementViews().map(v => game.world.getTile(v.q, v.r));
        const tile = tiles.find(t => t.settlement && t.settlement.farm && Harvests.townHarvestYear(t.settlement) != null);
        expect(tile).toBeTruthy();
        const f = Harvests.forecast(game.world, Harvests.regionOfTown(game.world, tile.settlement));
        expect(f && !f.settled).toBe(true); // the second year's growing season
        const shown = [];
        game.ui = { showCustomPanel: (t, html) => shown.push(html), showNotification: () => {} };
        ActionMenu.showHarvests(game, tile);
        const html = shown.pop();
        const reaped = Harvests.townHarvestYear(tile.settlement);
        expect(reaped).toBe(f.year - 1);
        expect(html).toContain(`Last harvest (year ${reaped + 1}), now in the markets`);
        expect(html).toContain(`This year's crop (year ${f.year + 1}), still in the fields`);
        expect(html).toContain(`the crop of year ${f.year + 1} in the fields`);
    }, 120000);
});

// ── 4. Bourse panics send coin abroad ─────────────────────────────────
const realm = (id, name, pop) => ({
    id, name, isAlive: true, population: pop, treasury: 10000, wars: [], capital: null,
    finance: { purity: 1, debt: [], debtRatio: 0, missed: 0, unpaid: 0, defaults: 0, lastDefaultDay: null },
});
function bare(realms, day = 7) {
    return {
        day, kingdoms: realms, generationParams: { seed: 4242 }, activeEvents: [],
        getKingdom(id) { return this.kingdoms.find(k => k.id === id); },
        getSettlementViews() { return []; },
        getTile() { return null; },
    };
}
const bourseOf = (player, exchanges) => {
    const st = Bourse.state(player);
    st.initialized = true;
    st.exchanges = exchanges;
    return st;
};

describe('bourse panics and the coin', () => {
    it('a house failing or a crash on an exchange puts its realm in a panic for flightDays', () => {
        const w = bare([realm('a', 'Aster', 10000), realm('b', 'Brenn', 10000)], 30);
        const player = { finance: { history: [{ key: 'fin:bank_failed:30:x', kind: 'bank_failed', kingdomId: 'a', bank: 'Old House', day: 30 }], banks: [] } };
        const st = bourseOf(player, [{ kingdomId: 'a', name: 'Aster Bourse', q: 0, r: 0 }]);
        Bourse._panics(w, player, st);
        expect(st.panicDays.a).toBe(30);
        expect([...Bourse.panicRealms(w, player)]).toEqual(['a']);
        expect(Mints._panics(w, player).has('a')).toBe(true);
        expect(Mints._panics(w, player).has('b')).toBe(false);
        w.day = 30 + Bourse.config().flightDays + 1;
        // (the mood has recovered by then in play; hold it at 1 here)
        st.mood = 1;
        expect(Bourse.panicRealms(w, player).size).toBe(0);
        // A mania's burst is a panic on its exchange
        const def = Bourse.manias()[0];
        const l = { id: 'l1', name: 'Venture', kind: 'venture', kingdomId: 'a', shares: 1000, price: 10, capital: 10000,
            mania: { id: def.id, start: w.day - 30, peakDay: w.day - 1, endDay: w.day + 20, issued: true, burst: false, peak: 2, trough: 0.6 } };
        Bourse._maniaDay(w, player, st, l, { notices: [] });
        expect(st.panicDays.a).toBe(w.day);
        // A sour market (mood under flightMood) hits every exchange's realm
        st.panicDays = {};
        st.mood = Bourse.config().flightMood - 0.05;
        expect(Bourse.panicRealms(w, player).has('a')).toBe(true);
    });

    it('a realm in a bourse panic loses coin to flight and hoards it, as in a bank run', () => {
        const run = (panic) => {
            const w = bare([realm('a', 'Aster', 10000), realm('b', 'Brenn', 10000)]);
            const player = { finance: { history: [], banks: [] } };
            const st = bourseOf(player, [{ kingdomId: 'a', name: 'Aster Bourse', q: 0, r: 0 }]);
            MoneySupply.processDay(w, {});
            for (let i = 0; i < 3; i++) {
                w.day += 7;
                if (panic) st.panicDays.a = w.day;
                MoneySupply.processDay(w, { panic: Mints._panics(w, player) });
            }
            return MoneySupply.realm(w, 'a');
        };
        const calm = run(false), scared = run(true);
        expect(_num(calm.tot.flight)).toBe(0);
        expect(scared.tot.flight).toBeLessThan(0);
        expect(scared.coin).toBeLessThan(calm.coin);
        expect(scared.vel).toBeLessThan(calm.vel);
    });
});

function _num(v) { return Number.isFinite(v) ? v : 0; }

// ── 5. The player's cross-realm trade moves coin ──────────────────────
describe('the player\'s cross-realm trade in coin', () => {
    it('goods bought in one realm and sold in another book the trade into the week\'s specie', () => {
        const g = newGame(101);
        const views = g.world.getSettlementViews().map(v => g.world.getTile(v.q, v.r).settlement).filter(s => s && SettlementMarket.ensure(s) && s.kingdom != null);
        const A = views[0];
        const B = views.find(s => s.kingdom !== A.kingdom && !TradePolicy.embargoed(g.world.getKingdom(s.kingdom), g.world.getKingdom(A.kingdom)));
        expect(B).toBeTruthy();
        MoneySupply.state(g.world).trade = {};
        g.player.inventory.tools = 6;
        TradePolicy.onBuy(g.player, A, 'tools', 6);
        const res = Trading.sellGoods(g.player, 'tools', 6, B, g.world);
        expect(res.success).toBe(true);
        const key = `${A.kingdom}>${B.kingdom}`;
        expect(MoneySupply.state(g.world).trade[key]).toBeGreaterThan(0);
        // Home goods sold at home move no specie
        MoneySupply.state(g.world).trade = {};
        g.player.inventory.tools = 3;
        TradePolicy.onBuy(g.player, B, 'tools', 3);
        Trading.sellGoods(g.player, 'tools', 3, B, g.world);
        expect(MoneySupply.state(g.world).trade).toEqual({});
        // A consignment (caravan, hold, factor) books its units the same way
        const lots = {};
        TradePolicy.book(lots, A, 'tools', 10);
        const check = TradePolicy.consignCheck(g.player, g.world, lots, 10, B, 'tools', 10);
        TradePolicy.consignSale(g.player, g.world, lots, B, 'tools', 10, 200, check);
        expect(MoneySupply.state(g.world).trade[key]).toBeGreaterThan(150);
        // ...and the weekly turn settles it as coin from the importer to the exporter
        const before = MoneySupply.realm(g.world, A.kingdom) ? MoneySupply.realm(g.world, A.kingdom).tot.trade || 0 : 0;
        MoneySupply.state(g.world).trade[key] = 5000;
        g.world.day += 7;
        MoneySupply.processDay(g.world, {});
        expect(MoneySupply.realm(g.world, A.kingdom).tot.trade).toBeGreaterThan(before);
    });
});

// ── 7. Engrossing: the grain dealers' speculation ─────────────────────
describe('engrossing', () => {
    const towns = (w) => w.getSettlementViews().map(v => w.getTile(v.q, v.r).settlement).filter(s => s && SettlementMarket.ensure(s));
    const atDoy = (doy, year = 1) => year * Seasons.DAYS_PER_YEAR + doy;

    it('dealers buy into a failing forecast, hold the grain off the market and sell it when bread is dear', () => {
        const g = newGame(202);
        const w = g.world;
        vi.spyOn(Harvests, 'forecast').mockReturnValue({ est: 0.7, conf: 0.6, settled: false, year: 1 });
        w.day = atDoy(30);
        const list = towns(w).filter(s => s.population >= Engrossing.config().minPop);
        for (const s of list) s.market.stock.grain = SettlementMarket.target(s, 'grain') * 2;
        const before = list.reduce((a, s) => a + SettlementMarket.stock(s, 'grain'), 0);
        Engrossing.processDay(w);
        const held = list.reduce((a, s) => a + Engrossing.held(s), 0);
        const after = list.reduce((a, s) => a + SettlementMarket.stock(s, 'grain'), 0);
        expect(held).toBeGreaterThan(0);
        expect(before - after).toBeCloseTo(held, 0);
        // A good forecast: no buying
        Harvests.forecast.mockReturnValue({ est: 1.05, conf: 0.6, settled: false, year: 1 });
        w.day += 7;
        Engrossing.processDay(w);
        expect(w.engrossing.stats.bought).toBeCloseTo(held, 1);
        // In the lean months, where grain is dear, they sell a share of it back
        const s = list.find(x => Engrossing.held(x) > 0);
        s.market.stock.grain = SettlementMarket.target(s, 'grain') * 0.3;
        expect(SettlementMarket.scarcity(s, 'grain')).toBeGreaterThan(Engrossing.config().releaseAt);
        const h0 = Engrossing.held(s);
        w.day = atDoy(90);
        Engrossing.processDay(w);
        expect(Engrossing.held(s)).toBeLessThan(h0 * 0.8);
        // ...and nothing is left in the lofts at the turn of the year
        w.day = atDoy(5, 2);
        Engrossing.processDay(w);
        expect(towns(w).reduce((a, x) => a + Engrossing.held(x), 0)).toBe(0);
        // No grain is made or lost but the lofts' spoilage
        const st = w.engrossing.stats;
        expect(st.bought - st.released - st.spoiled).toBeCloseTo(0, 0);
    });

    it('in the Hungry Months a crown may forbid engrossing: the lofts open and the dealers stay out', () => {
        const g = newGame(202);
        const w = g.world;
        vi.spyOn(Harvests, 'forecast').mockReturnValue({ est: 0.6, conf: 0.8, settled: false, year: 1 });
        w.day = atDoy(30);
        for (const s of towns(w)) s.market.stock.grain = SettlementMarket.target(s, 'grain') * 2;
        Engrossing.processDay(w);
        const kid = towns(w).find(s => Engrossing.held(s) > 0 && s.kingdom != null).kingdom;
        w.activeEvents = [...(w.activeEvents || []), { id: 'famine', kingdomId: kid }];
        let edictDay = null;
        for (let i = 1; i <= 12 && edictDay == null; i++) {
            w.day = atDoy(30 + 7 * i > 70 ? 70 : 30 + 7 * i) + (30 + 7 * i > 70 ? i : 0);
            Engrossing.processDay(w);
            if (Engrossing.banned(w, kid)) edictDay = w.day;
        }
        expect(edictDay).not.toBe(null);
        expect(towns(w).filter(s => s.kingdom === kid).reduce((a, s) => a + Engrossing.held(s), 0)).toBe(0);
        expect(w.engrossing.history.some(h => h.kind === 'edict' && h.kingdomId === kid)).toBe(true);
        // While the ban holds the dealers buy nothing there
        const s = towns(w).find(x => x.kingdom === kid && x.population >= Engrossing.config().minPop);
        w.day = edictDay + 7;
        Engrossing.processDay(w);
        expect(Engrossing.held(s)).toBe(0);
    });

    it('draws no RNG and its state survives a save', () => {
        const g = newGame(202);
        const w = g.world;
        vi.spyOn(Harvests, 'forecast').mockReturnValue({ est: 0.7, conf: 0.6, settled: false, year: 1 });
        w.day = atDoy(30);
        for (const s of towns(w)) s.market.stock.grain = SettlementMarket.target(s, 'grain') * 2;
        Utils.setSeed(77);
        Engrossing.processDay(w);
        const r = Utils.random();
        Utils.setSeed(77);
        expect(Utils.random()).toBe(r);
        w.engrossing.bans.x = 999;
        const saved = SaveLoad.serializeWorld ? SaveLoad.serializeWorld(w) : null;
        if (saved) expect(saved.engrossing.bans.x).toBe(999);
        const copy = {};
        Engrossing.restore(Engrossing.serialize(w), copy);
        expect(copy.engrossing.bans.x).toBe(999);
        expect(copy.engrossing.stats.bought).toBeGreaterThan(0);
        // old saves: blank
        const old = {};
        Engrossing.restore(undefined, old);
        expect(old.engrossing.stats.bought).toBe(0);
        expect(DataLoader._gamedata.harvests.engrossing.enabled).toBe(true);
    });
});

// ── Found in the browser smoke test ───────────────────────────────────
describe('starting a new game', () => {
    it('reloads the game data after resetting it (else the markets, harvests and roads run on nothing)', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(new URL('../ui/game/gameSetup.js', import.meta.url), 'utf8');
        const at = src.indexOf('DataLoader.reset();');
        expect(at).toBeGreaterThan(0);
        const next = src.indexOf('await DataLoader.initializeAll();', at);
        expect(next).toBeGreaterThan(at);
        // ...before the world is generated
        expect(next).toBeLessThan(src.indexOf('new World(', at));
    });
});

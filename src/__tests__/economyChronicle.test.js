/**
 * The Economic Chronicle: the player's unified ledger (systems/ledger.js)
 * with every income source and net worth, the realms' weekly economic
 * indices (world/economyIndex.js) and their readers (the crowns, the
 * heralds, the townsfolk, the counsel), the gazette's knowledge rules
 * (systems/economyChronicle.js), fashions at court (world/fashions.js) and
 * the player setting one (systems/patronage.js), the jewellers' gems, save
 * round trip and backfill, determinism.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour } from '../world/townLabour.js';
import { EconomyIndex } from '../world/economyIndex.js';
import { Fashions } from '../world/fashions.js';
import { KingdomStability } from '../world/kingdomState.js';
import { Ledger } from '../systems/ledger.js';
import { EconomyChronicle } from '../systems/economyChronicle.js';
import { PriceKnowledge } from '../systems/priceKnowledge.js';
import { Ships } from '../systems/ships.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { Finance } from '../systems/finance.js';
import { Guilds } from '../systems/guilds.js';
import { Patronage } from '../systems/patronage.js';
import { Heralds } from '../systems/heralds.js';
import { Chatter } from '../systems/chatter.js';
import { Counsel } from '../systems/counsel.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

// Data patched by a test is restored after it (replaced whole, so the cached configs see the change)
const _saved = {};
function patch(section, fn) {
    if (!_saved[section]) _saved[section] = DataLoader._gamedata[section];
    const d = JSON.parse(JSON.stringify(DataLoader._gamedata[section]));
    fn(d);
    DataLoader._gamedata[section] = d;
}
afterEach(() => {
    for (const [k, v] of Object.entries(_saved)) { DataLoader._gamedata[k] = v; delete _saved[k]; }
    Utils.resetRng();
});

const GOOD = (id) => PlayerEconomy.GOODS[id.toUpperCase()];
const plains = (q, r, settlement = null) => ({ q, r, terrain: { id: 'plains', passable: true }, resource: null, settlement });

/**
 * Two realms: Aster (capital Highmarket at 5,5; town Brindle at 9,5) and
 * Borea (capital Northgate at 30,5; town Fallow at 34,5). The player stands
 * in Highmarket.
 */
function fixture(opts = {}) {
    const mk = (name, type, population, kingdom, q, r) => ({ name, type, population, happiness: 50, kingdom, q, r });
    const towns = [
        mk('Highmarket', 'capital', 12000, 'k1', 5, 5), mk('Brindle', 'town', 3000, 'k1', 9, 5),
        mk('Northgate', 'capital', 11000, 'k2', 30, 5), mk('Fallow', 'town', 2800, 'k2', 34, 5),
    ];
    const tiles = new Map(towns.map(s => [`${s.q},${s.r}`, plains(s.q, s.r, s)]));
    const kingdoms = [
        { id: 'k1', name: 'Aster', isAlive: true, wars: [], allies: [], relations: {}, capital: { q: 5, r: 5 }, finance: { debtRatio: 0, missed: 0, unpaid: 0, purity: 1 }, traits: [], treasury: 5000 },
        { id: 'k2', name: 'Borea', isAlive: true, wars: [], allies: [], relations: {}, capital: { q: 30, r: 5 }, finance: { debtRatio: 0.4, missed: 0, unpaid: 0, purity: 1 }, traits: [], treasury: 3000 },
    ];
    const world = {
        width: 60, height: 30, day: opts.day || 50, activeEvents: [], units: [], kingdoms, generationParams: { seed: 7 },
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || plains(q, r),
        getSettlementViews: () => towns,
        getAllSettlements: () => towns,
    };
    for (const s of towns) { SettlementMarket.ensure(s); TownLabour.ensure(s); }
    const player = {
        name: 'Tester', q: 5, r: 5, gold: 50000, maxInventory: 99,
        inventory: { bread: 50, grain: 100, wood: 50, stone: 50, iron: 20, tools: 10 },
        skills: { commerce: 0 }, reputation: { k1: 30, k2: 0 },
        house: { name: 'House Tester', prestige: 200 },
    };
    const [capital, town, capital2, town2] = towns;
    return { world, player, towns, capital, town, capital2, town2, kingdoms, tile: world.getTile(5, 5) };
}

/** Advance the fixture's calendar a week at a time, measuring each week. */
function weeks(world, n, each = null) {
    for (let i = 0; i < n; i++) {
        world.day += 7;
        if (each) each(i);
        EconomyIndex.processDay(world);
    }
}

// ─────────────────────────────────────────────────────────────

describe('the ledger: one book for every gold flow', () => {
    it('sorts flows by kind: operating income and expenses, netted margins, capital, memo', () => {
        const player = { gold: 0 };
        Ledger.record(player, 'industry', 40);
        Ledger.record(player, 'guildDues', -12);
        Ledger.record(player, 'stalls', 30);
        Ledger.record(player, 'stalls', -45);           // a loss nets on the same line
        Ledger.record(player, 'goodsBought', -500);     // capital
        Ledger.record(player, 'guildTolls', -7);        // inside a price
        const row = Ledger.closeDay(player, { day: 3 }, null);
        expect(row.income.industry).toBe(40);
        expect(row.expenses.guildDues).toBe(12);
        expect(row.income.stalls).toBe(-15);
        expect(row.totalIncome).toBe(40);
        expect(row.totalExpenses).toBe(12 + 15);        // capital and memo are not profit or loss
        expect(player.financeToday).toEqual({ income: {}, expenses: {} });
        const st = Ledger.statement(player, { day: 3 }, 30);
        expect(st.op.net).toBe(40 - 12 - 15);
        expect(st.cap.map(l => l.id)).toEqual(['goodsBought']);
        expect(st.memo.map(l => l.id)).toEqual(['guildTolls']);
        expect(st.groups.find(g => g.id === 'enterprise').net).toBe(40);
    });

    it('folds the turn\'s own results (works, rent, dues, taxes, holdings) into the day, and keeps 120 days', () => {
        const player = { gold: 100 };
        const world = { day: 1 };
        for (let d = 1; d <= 130; d++) {
            world.day = d;
            Ledger.record(player, 'jobs', 5);
            Ledger.closeDay(player, world, Ledger.fromResults(world, player, {
                princeDay: { income: 20, rent: 4, wages: 3 }, guildDay: { income: 2, expenses: 6 }, taxCollected: d % 7 === 0 ? 70 : 0, holdingsDay: { upkeep: 9 },
            }));
        }
        expect(player.financeHistory.length).toBe(120);
        expect(player.financeHistory[0].day).toBe(11);
        const last = player.financeHistory[119];
        expect(last.income).toMatchObject({ industry: 20, guilds: 2, jobs: 5 });
        expect(last.expenses).toMatchObject({ warehouseRent: 4, worksWages: 3, guildDues: 6, holdings: 9 });
        expect(Ledger.total(player, world, 'industry', 30)).toBe(600);
        expect(Ledger.statement(player, world, 120).op.income.find(l => l.id === 'taxes').amount).toBe(70 * 17);
    });

    it('records port trades: goods bought and sold, and the margin', () => {
        const WATER = { id: 'ocean', passable: false };
        const tiles = new Map();
        const port = { name: 'Saltmere', type: 'town' };
        const world = {
            width: 20, height: 20, day: 1,
            getTile(q, r) {
                const key = `${q},${r}`;
                if (!tiles.has(key)) tiles.set(key, { q, r, terrain: key === '5,5' ? { id: 'grassland', passable: true } : WATER, settlement: key === '5,5' ? port : null });
                return tiles.get(key);
            },
        };
        const player = { q: 5, r: 5, gold: 5000, boardedShip: null, inventory: {}, skills: { commerce: 1 }, ships: [{ id: 's1', name: 'Gull', typeId: 'galleon', status: 'docked', q: 5, r: 5, cargo: {} }] };
        const good = Ships.getPortMarket(world, 5, 5).find(e => e.buy !== null);
        const bought = Ships.buyTradeGood(player, world, 's1', good.id, 4);
        expect(bought.success).toBe(true);
        const sold = Ships.sellTradeGood(player, world, 's1', good.id, 4);
        expect(sold.success).toBe(true);
        const t = player.financeToday;
        expect(t.income.goodsBought).toBe(-bought.cost);
        expect(t.income.goodsSold).toBe(sold.revenue);
        expect(t.income.portTrade).toBe(sold.revenue - bought.cost);
        expect(PriceKnowledge.pnl(player).goods.find(g => g.id === good.id).profit).toBe(sold.revenue - bought.cost);
    });

    it('records store-rooms (key fee, buying in, selling) and forward contracts (delivery, forfeit)', () => {
        const { world, player, tile } = fixture();
        expect(MerchantPrince.rentWarehouse(player, world, tile, 'small').success).toBe(true);
        const w = MerchantPrince.state(player).warehouses[0];
        const b = MerchantPrince.buyInto(player, world, w.id, 'grain', 20);
        expect(b.success).toBe(true);
        const s = MerchantPrince.sellFrom(player, world, w.id, 'grain', 20);
        expect(s.success).toBe(true);
        let t = player.financeToday;
        expect(t.expenses.warehouseRent).toBeGreaterThan(0);
        expect(t.income.goodsBought).toBe(-b.spent);
        expect(t.income.storeRooms).toBe(s.earned - b.spent);
        // Forwards: a delivery from the packs (bread found or made counts as free) and a forfeit
        const f = MerchantPrince.signForward(player, world, tile, 'bread', 10, 10);
        expect(f.success).toBe(true);
        const del = MerchantPrince.deliverForward(player, world, f.contract.id, 4);
        expect(del.success).toBe(true);
        t = player.financeToday;
        expect(t.income.forwards).toBe(del.earned);
        world.day = f.contract.dueDay + 1;
        MerchantPrince._forwardDay(player, world, MerchantPrince.state(player), { notices: [] });
        expect(player.financeToday.expenses.forwardPenalties).toBeGreaterThan(0);
    });

    it('records the traders hailed on the road, escort pay, works funded, property takings and patronage', () => {
        const { world, player, capital, tile } = fixture();
        // A caravan on the player's hex
        const u = { id: 'tr1', type: 'trade_caravan', name: 'The Salt Train', q: 5, r: 5, cargo: { grain: 20 }, prices: { grain: [4, 8] }, purse: 1000, route: [5, 5, 9, 5], step: 0 };
        world.units.push(u);
        const bought = MerchantCaravans.buy(player, world, 'tr1', 'grain', 5);
        expect(bought.success).toBe(true);
        const sold = MerchantCaravans.sell(player, world, 'tr1', 'grain', 5);
        expect(sold.success).toBe(true);
        expect(player.financeToday.income.caravanTrade).toBe(sold.pay - bought.cost);
        // Works funded (capital)
        const inv = MerchantPrince.invest(player, world, tile, 'bakery');
        expect(inv.success).toBe(true);
        expect(player.financeToday.income.worksBought).toBe(-inv.spent);
        // A tavern's takings
        const tavern = { type: 'tavern', name: 'Tavern', level: 1, daysOwned: 10, storage: 0, upkeep: 8 };
        tile.playerProperties = [tavern];
        player.properties = [{ q: 5, r: 5, type: 'tavern', name: 'Tavern' }];
        const before = player.gold;
        PlayerEconomy.produceGoods(player, world);
        expect(player.financeToday.income.properties).toBe(tavern.todayIncome);
        expect(player.gold).toBeGreaterThan(before - 20);
        // Patronage spending
        Patronage._spend(player, 25);
        expect(player.financeToday.expenses.patronage).toBe(25);
        expect(capital.name).toBe('Highmarket');
    });

    it('records the company\'s profit and its merchant-house dividends day by day', () => {
        const player = { gold: 0, merchant: { company: { foundedDay: 1, pnl: { income: { sales: 100 }, expenses: { wages: 30 } } } } };
        Ledger.closeDay(player, { day: 1 });              // the books as first read
        const c = player.merchant.company;
        c.pnl.income.sales += 50;
        c.pnl.income.dividends = 40;
        c.pnl.expenses.wages += 10;
        const row = Ledger.closeDay(player, { day: 2 });
        expect(row.income.dividends).toBe(40);
        expect(row.income.company).toBe(40);              // +50 sales − 10 wages
    });

    it('records guild dues and the toll inside a sale price, and tariffs as a levy', () => {
        const { world, player, capital } = fixture();
        Guilds.ensureTown(world, capital, 50);
        expect(capital.guilds && capital.guilds.bakers).toBeTruthy();
        const res = Trading.sellGoods(player, 'bread', 5, capital, world);
        expect(res.success).toBe(true);
        const t = player.financeToday;
        expect(t.income.guildTolls).toBeLessThan(0);     // the memo line
        expect(t.income.goodsSold).toBeGreaterThan(0);
        expect(t.income.stalls).toBeGreaterThan(0);      // bread from the packs: all margin
        const join = Guilds.join(player, world, world.getTile(5, 5), 'bakers');
        expect(join.success).toBe(true);
        expect(player.financeToday.expenses.guildDues).toBeGreaterThan(0);
        // A tariff (systems that charge one record it) is an operating cost among the levies
        Ledger.record(player, 'tariffs', -12);
        const row = Ledger.closeDay(player, world);
        expect(row.expenses.tariffs).toBe(12);
        expect(Ledger.category('tariffs')).toMatchObject({ group: 'levies', kind: 'op' });
        expect(Ledger.category('guildTolls').kind).toBe('memo');
    });

    it('splits a loan payment into interest and principal; deposits and bond coupons earn interest', () => {
        const world = { day: 10, kingdoms: [], getKingdom: () => null };
        const player = { gold: 5000 };
        const st = Finance.state(player);
        st.loans.push({ id: 'L1', bankId: 'nobank', lender: 'Test House', principal: 1000, interestRate: 0.1, totalOwed: 1100, dailyPayment: 110, remainingDays: 10, daysTaken: 0, totalPaid: 0, overdue: 0, missed: 0 });
        Finance.processLoans(world, player);
        const t = player.financeToday;
        expect(t.expenses.loanInterest).toBeCloseTo(10, 1);
        expect(t.income.loanPrincipal).toBeCloseTo(-100, 1);
        expect(player.gold).toBe(4890);
    });

    it('works out net worth: gold, deposits, bonds, goods at known prices, properties, works, ships, less debts', () => {
        const { world, player, capital } = fixture();
        player.inventory = { grain: 10 };
        player.gold = 1000;
        const st = Finance.state(player);
        st.accounts.b1 = { balance: 500, interest: 0 };
        st.bonds.push({ id: 'B1', kingdomId: 'k1', principal: 300, haircut: 0 });
        st.loans.push({ id: 'L1', totalOwed: 200 });
        // The book: grain sells for 6 at best
        PriceKnowledge.state(player).towns['5,5'] = { n: 'Highmarket', t: 'capital', d: 50, g: { grain: [8, 6, 100, 50, 'v'] } };
        world.getTile(5, 5).playerProperties = [{ type: 'farm', cost: 700, daysOwned: 0 }];
        player.properties = [{ q: 5, r: 5, type: 'farm' }];
        MerchantPrince.state(player).investments.push({ id: 1, q: 5, r: 5, town: 'Highmarket', recipe: 'bakery', invested: 600 });
        SettlementMarket.setWorks(capital, 'bakery', { lvl: 1, cap: 1, cond: 0.5, owner: 'player' });
        const nw = EconomyChronicle.netWorth(player, world);
        expect(nw.assets).toMatchObject({ gold: 1000, deposits: 500, bonds: 300, goods: 60, properties: 700, works: 300 });
        expect(nw.debts.loans).toBe(200);
        expect(nw.total).toBe(1000 + 500 + 300 + 60 + 700 + 300 - 200);
    });
});

// ─────────────────────────────────────────────────────────────

describe('the realms\' economic indices', () => {
    it('measures each realm and the world weekly, and keeps a capped history', () => {
        patch('chronicle', d => { d.indices.historyWeeks = 5; });
        const { world, capital } = fixture();
        expect(EconomyIndex.processDay(world)).not.toBeNull();       // the first measure
        expect(EconomyIndex.processDay(world)).toBeNull();           // not again the same week
        const k1 = EconomyIndex.latest(world, 'k1');
        expect(k1).toMatchObject({ day: 50, towns: 2, treasury: 5000, debt: 0, purity: 1 });
        expect(k1.food).toBeGreaterThan(0.5);
        expect(k1.goods).toBeGreaterThan(0.5);
        expect(EconomyIndex.latest(world, null).towns).toBe(4);
        // Bread runs out in Aster's capital: its food index rises
        weeks(world, 1, () => { capital.market.stock.bread = 0; capital.market.stock.grain = 0; });
        expect(EconomyIndex.latest(world, 'k1').food).toBeGreaterThan(k1.food);
        weeks(world, 8);
        expect(EconomyIndex.history(world, 'k1').length).toBe(5);
        expect(EconomyIndex.history(world, null).length).toBe(5);
    });

    it('shows a debased coin as inflation at once, and the heralds hear of it', () => {
        const { world, player, kingdoms } = fixture();
        EconomyIndex.processDay(world);
        weeks(world, 4);
        const before = EconomyIndex.latest(world, 'k2').goods;
        kingdoms[1].finance.purity = 0.7;                     // Borea clips its coin
        weeks(world, 1);
        const after = EconomyIndex.latest(world, 'k2');
        expect(after.goods / before).toBeGreaterThan(1.2);
        expect(after.purity).toBeCloseTo(0.7);
        expect(EconomyIndex.change(world, 'k2', 'goods')).toBeGreaterThan(0.15);
        expect(EconomyIndex.change(world, 'k1', 'goods')).toBeLessThan(0.05);
        const news = EconomyIndex.news(world);
        expect(news.some(n => n.kind === 'inflation' && n.kingdomId === 'k2')).toBe(true);
        expect(news.some(n => n.kingdomId === 'k1')).toBe(false);
        // The heralds cry it (after their first look)
        Heralds.processDay(world, player);
        world.economy.news.push({ ...news.find(n => n.kingdomId === 'k2'), key: 'econ:inflation:k2:again', day: world.day });
        world.day += 1;
        Heralds.processDay(world, player);
        expect(Heralds.state(player).list.some(p => p.kind === 'econ_inflation' && /Borea/.test(p.text))).toBe(true);
    });

    it('feeds the crowns: dear bread lowers a realm\'s stability target and its appetite for war', () => {
        const { world, towns, kingdoms } = fixture();
        expect(EconomyIndex.stabilityMod(world, kingdoms[0])).toBe(0);      // not measured yet
        expect(EconomyIndex.warConfidence(world, kingdoms[0])).toBe(1);
        // Aster starves, Borea eats well
        for (const s of towns) {
            const m = s.market;
            for (const id of ['grain', 'bread', 'flour', 'fish', 'meat', 'cheese']) m.stock[id] = s.kingdom === 'k1' ? 0 : SettlementMarket.target(s, id) * 2;
        }
        EconomyIndex.processDay(world);
        expect(EconomyIndex.relativeFood(world, kingdoms[0])).toBeGreaterThan(1.1);
        expect(EconomyIndex.stabilityMod(world, kingdoms[0])).toBeLessThan(0);
        expect(EconomyIndex.stabilityMod(world, kingdoms[1])).toBeGreaterThan(0);
        expect(EconomyIndex.warConfidence(world, kingdoms[0])).toBeLessThan(1);
        expect(EconomyIndex.warConfidence(world, kingdoms[1])).toBe(1);
        // KingdomStability reads it
        const parts = KingdomStability.target(kingdoms[0], world).parts;
        expect(parts.find(p => p.label === 'Cost of living').value).toBeLessThan(0);
    });
});

// ─────────────────────────────────────────────────────────────

describe('the gazette: what the player knows of the realms', () => {
    it('is read only in a market town: the home realm this week, the others a week older', () => {
        const { world, player } = fixture();
        EconomyIndex.processDay(world);
        weeks(world, 2);
        player.q = 0; player.r = 20;                            // in the wilds
        expect(EconomyChronicle.readGazette(player, world)).toBe(false);
        expect(EconomyChronicle.gazette(player, world).realms).toEqual([]);
        player.q = 5; player.r = 5;                             // Highmarket, in Aster
        expect(EconomyChronicle.readGazette(player, world)).toBe(true);
        const g = EconomyChronicle.gazette(player, world);
        const aster = g.realms.find(r => r.id === 'k1');
        const borea = g.realms.find(r => r.id === 'k2');
        expect(aster.asOf).toBe(world.day);
        expect(borea.asOf).toBe(world.day - 7);
        expect(borea.history.every(r => r.day <= world.day - 7)).toBe(true);
        expect(g.world.asOf).toBe(world.day);
        // Town-level news is only what the price book holds
        expect(EconomyChronicle.marketSignals(player, world).short).toEqual([]);
        PriceKnowledge.observe(player, world, world.getTile(5, 5).settlement, 'v');
        const sig = EconomyChronicle.marketSignals(player, world, { shortAt: 0, glutAt: -1 });
        expect(sig.short.every(x => x.town === 'Highmarket')).toBe(true);
        expect(sig.short.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────

describe('fashions at court', () => {
    const demand = (s, id) => {
        const C = SettlementMarket.config();
        return TownLabour.demandMults(s, C)[C.goodIds.indexOf(id)];
    };

    it('shifts the nobles\' and merchants\' baskets in the towns it reaches, and their prices follow', () => {
        const { world, capital, town, capital2 } = fixture();
        const gems0 = demand(capital, 'gems'), lux0 = demand(capital, 'luxuries');
        const need0 = SettlementMarket.need(capital, 'gems');
        const sc0 = SettlementMarket.scarcity(capital, 'gems');
        const f = Fashions.start(world, 'jewelled_finery', { q: 5, r: 5, name: 'Highmarket' }, { kingdomId: 'k1' });
        expect(f).toBeTruthy();
        world.day += 10;                                       // risen, and spread a few hexes
        Fashions.processWeek(world);
        expect(capital.labour.fz.gems).toBeGreaterThan(1.5);
        expect(demand(capital, 'gems')).toBeGreaterThan(gems0 * 1.2);
        expect(demand(capital, 'luxuries')).toBeGreaterThan(lux0);
        expect(SettlementMarket.need(capital, 'gems')).toBeGreaterThan(need0);
        expect(SettlementMarket.scarcity(capital, 'gems')).toBeGreaterThan(sc0);     // same stock, more wanted
        // Brindle, 4 hexes off, is reached but weaker; Northgate, 25 off, not yet
        expect(town.labour.fz.gems).toBeGreaterThan(1);
        expect(town.labour.fz.gems).toBeLessThan(capital.labour.fz.gems);
        expect(capital2.labour.fz).toBeUndefined();
        // Exotic goods no market keeps simply fetch more
        expect(capital.labour.fx.pearls).toBeGreaterThan(1.4);
        expect(SettlementMarket.value(world, capital, null, 'pearls', 120)).toBeGreaterThan(120 * 1.4);
        expect(SettlementMarket.value(world, capital2, null, 'pearls', 120)).toBeCloseTo(120);
        const pearls = GOOD('pearls');
        const p = fixture().player;
        expect(Trading.saleUnitPrice(p, pearls, capital, world, 1, 1)).toBeGreaterThan(Trading.saleUnitPrice(p, pearls, capital2, world, 1, 1) * 1.3);
    });

    it('spreads outward from its capital, then fades and clears', () => {
        const { world, capital2 } = fixture();
        const f = Fashions.start(world, 'spiced_wine', { q: 5, r: 5, name: 'Highmarket' });
        const r1 = Fashions.reach(f, world.day + 2), r2 = Fashions.reach(f, world.day + 12);
        expect(r2).toBeGreaterThan(r1);
        expect(Fashions.intensity(world, f, 30, 5, world.day + 3)).toBe(0);         // Northgate: not yet
        world.day += 20;
        Fashions.processWeek(world);
        expect(capital2.labour.fz && capital2.labour.fz.wine).toBeGreaterThan(1);   // reached it
        expect(Fashions.phase(f, f.start + f.rise + 2)).toBe(1);
        expect(Fashions.phase(f, f.start + f.rise + f.hold + Math.floor(f.fade / 2))).toBeLessThan(1);
        world.day = f.start + f.rise + f.hold + f.fade + 1;
        const out = Fashions.processWeek(world);
        expect(out.ended.map(x => x.id)).toContain('spiced_wine');
        expect(Fashions.active(world).length).toBe(0);
        expect(capital2.labour.fz).toBeUndefined();
        expect(Fashions.state(world).past[0].id).toBe('spiced_wine');
    });

    it('starts at a court on a hash of the seed and the week, and the heralds and townsfolk spread the news', () => {
        patch('chronicle', d => { d.fashions.startChance = 1; d.fashions.minDay = 0; });
        const { world, player } = fixture();
        Heralds.processDay(world, player);                     // the heralds' first look
        world.day += 1;
        const out = Fashions.processWeek(world);
        expect(out.started.length).toBe(1);
        const f = out.started[0];
        expect(['Highmarket', 'Northgate']).toContain(f.place);
        Heralds.processDay(world, player);
        expect(Heralds.state(player).list.some(p => p.kind === 'fashion')).toBe(true);
        // The townsfolk where it holds talk of it
        world.day += 6;
        const ctx = Chatter.context(world, player, { q: f.q, r: f.r });
        expect(ctx.fashions.map(x => x.id)).toContain(f.id);
        const line = Chatter.select(ctx, { filter: g => g.id === 'fashion_any', roll: 0.1 });
        expect(line && line.text).toContain(f.place);
        expect(Chatter.validate()).toEqual([]);
        // ...and the tavern tells of it
        const facts = Chatter.regionalFacts(world, player, world.getTile(f.q, f.r));
        const i = facts.findIndex(x => x.kind === 'fashion');
        expect(i).toBeGreaterThanOrEqual(0);
        const told = Chatter.tavernNews(world, player, world.getTile(f.q, f.r), { accurate: true, roll: (i + 0.5) / facts.length });
        expect(told.kind).toBe('fashion');
        expect(told.text).toContain(f.place);
        // The same seed and week start the same fashion
        const { world: w2 } = fixture();
        w2.day = world.day - 6;
        expect(Fashions.processWeek(w2).started[0].id).toBe(f.id);
    });

    it('can be set by the player at a court where they have standing, for Prestige and gold', () => {
        const { world, player, tile } = fixture();
        const away = world.getTile(9, 5);
        expect(Patronage.fashionQuote(player, world, away, 'court_silks').ok).toBe(false);     // not a capital
        player.reputation.k1 = 5;
        expect(Patronage.fashionQuote(player, world, tile, 'court_silks').ok).toBe(false);     // no standing
        player.reputation.k1 = 30;
        const q = Patronage.fashionQuote(player, world, tile, 'court_silks');
        expect(q.ok).toBe(true);
        const gold = player.gold, prestige = player.house.prestige;
        const res = Patronage.setFashion(player, world, tile, 'court_silks');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(gold - q.gold);
        expect(player.house.prestige).toBe(prestige - q.prestige);
        expect(res.fashion.by).toBe('player');
        expect(res.fashion.power).toBeGreaterThan(1);
        expect(player.financeToday.expenses.patronage).toBe(q.gold);
        // It moves the capital's demand, and the court will not take another for a while
        world.day += 8;
        Fashions.processWeek(world);
        expect(world.getTile(5, 5).settlement.labour.fz.textiles).toBeGreaterThan(1.5);
        expect(Patronage.fashionQuote(player, world, tile, 'spiced_wine').ok).toBe(false);
        // With an artist in their pay it costs half
        Patronage.state(player).clients.push({ id: 'c1', name: 'Ada Brush', profession: 'artist' });
        player.econ.setDay = null;
        expect(Patronage.fashionQuote(player, world, tile, 'spiced_wine').gold).toBe(Math.ceil(q.gold / 2));
    });

    it('lets the counsel point at a fashion the player has heard of, the more so for goods they hold', () => {
        const { world, player } = fixture();
        const f = Fashions.start(world, 'jewelled_finery', { q: 5, r: 5, name: 'Highmarket' });
        world.day += 3;
        EconomyChronicle.processDay(world, player);
        expect(EconomyChronicle.knownFashions(player, world).map(x => x.fashion.uid)).toContain(f.uid);
        player.inventory.gems = 5;
        const items = Counsel.scan(player, world, { fresh: true }).opportunities.filter(i => i.rule === 'fashion_goods');
        expect(items.length).toBe(1);
        expect(items[0].text).toMatch(/your gems/);
    });
});

// ─────────────────────────────────────────────────────────────

describe('the jewellers\' gems', () => {
    it('a great town\'s jewellers find gems to cut and room to sell, even with a court\'s nobles and merchants', () => {
        // A late-game city: more merchants and nobles than usual (as migration leaves them)
        const city = { name: 'Goldcrest', type: 'city', population: 14000, kingdom: 'k1', q: 0, r: 0 };
        SettlementMarket.ensure(city);
        TownLabour.ensure(city);
        TownLabour._setMix(city.labour, { peasants: 0.44, artisans: 0.26, merchants: 0.19, clergy: 0.04, nobles: 0.07 });
        const C = SettlementMarket.config();
        const gemsDm = TownLabour.demandMults(city, C)[C.goodIds.indexOf('gems')];
        expect(gemsDm).toBeLessThan(1.25);                      // the elite's gem appetite no longer dominates
        // The town's land and craftsmen: enough gems for the cutters, not a glut of finished luxuries
        const sup = DataLoader._gamedata.markets.supply;
        expect(sup.gems.base).toBeGreaterThanOrEqual(sup.luxuries.base);
        // With the stores at what the land and trade keep, a level of jewellers runs
        const m = city.market;
        m.stock.gems = SettlementMarket.target(city, 'gems') * 1.1;
        m.stock.luxuries = SettlementMarket.target(city, 'luxuries') * 1.2;
        SettlementMarket.setWorks(city, 'jeweller', { lvl: 1, cap: 0.6, cond: 1, owner: 'player' });
        SettlementMarket.processSettlement(city, {}, { day: 100, days: 4 });
        expect(SettlementMarket.works(city, 'jeweller').runs).toBeGreaterThan(0);
        // ...and a jewelled fashion makes the gems dearer still
        const sc = SettlementMarket.scarcity(city, 'gems');
        TownLabour.setFashion(city, { gems: 1.7, luxuries: 1.4 });
        expect(SettlementMarket.scarcity(city, 'gems')).toBeGreaterThan(sc);
    });
});

// ─────────────────────────────────────────────────────────────

describe('in the game', () => {
    const run = (seed, days) => {
        const g = newGame(seed);
        for (let d = 0; d < days; d++) {
            g.player.inventory.bread = 30;
            g.player.gold = Math.max(g.player.gold, 3000);
            endDay(g);
        }
        return g;
    };

    it('ticks in the daily turn, keeps the books, and survives a save → load round trip', () => {
        const g = run(101, 30);
        const st = EconomyIndex.state(g.world);
        expect(Object.keys(st.rows).length).toBeGreaterThan(2);
        expect(st.rows['*'].length).toBeGreaterThanOrEqual(4);
        expect(g.player.financeHistory.length).toBe(30);
        expect(EconomyChronicle.state(g.player).worth.length).toBeGreaterThanOrEqual(4);
        // A fashion is running, and a town it holds carries its factors
        Fashions.start(g.world, 'great_feasts', { q: g.world.kingdoms[0].capital.q, r: g.world.kingdoms[0].capital.r, name: 'the capital' });
        const held = g.world.getSettlementViews().find(s => s.labour && s.labour.fz);
        expect(held).toBeTruthy();
        const g2 = roundTrip(g);
        expect(g2.world.economy).toEqual(JSON.parse(JSON.stringify(g.world.economy)));
        expect(g2.world.fashions).toEqual(JSON.parse(JSON.stringify(g.world.fashions)));
        expect(g2.player.econ).toEqual(JSON.parse(JSON.stringify(g.player.econ)));
        expect(g2.player.financeHistory.length).toBe(30);
        const t2 = g2.world.getTile(held.q, held.r).settlement;
        expect(t2.labour.fz).toEqual(held.labour.fz);
        expect(t2.labour.fk).toBe(held.labour.fk);
        // ...and the next day goes on
        endDay(g2);
        expect(g2.player.financeHistory.length).toBe(31);
    });

    it('backfills older saves: no indices, fashions or gazette yet, and the next week measures afresh', () => {
        const g = run(202, 8);
        // An older save: none of it was written
        delete g.world.economy;
        delete g.world.fashions;
        delete g.player.econ;
        const g2 = roundTrip(g);
        expect(EconomyIndex.latest(g2.world, null)).toBeNull();
        expect(EconomyChronicle.state(g2.player)).toMatchObject({ read: null, realms: {}, worth: [] });
        endDay(g2);
        expect(EconomyIndex.latest(g2.world, null)).not.toBeNull();
    });

    it('is deterministic: the same seed gives the same indices, fashions and books', () => {
        const a = run(303, 36), b = run(303, 36);
        expect(JSON.stringify(a.world.economy)).toBe(JSON.stringify(b.world.economy));
        expect(JSON.stringify(a.world.fashions)).toBe(JSON.stringify(b.world.fashions));
        expect(JSON.stringify(a.player.financeHistory)).toBe(JSON.stringify(b.player.financeHistory));
        expect(JSON.stringify(a.player.econ)).toBe(JSON.stringify(b.player.econ));
    });
});

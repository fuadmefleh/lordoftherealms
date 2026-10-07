/**
 * Economy integration gaps (2026-10): the crowns' trade policy reaches every
 * way the player sells abroad — caravans and trade routes, ships' holds,
 * the trading company's factors (systems/tradePolicy.js consignments); the
 * factors' sales count against a guild's outsider cap and pay its toll;
 * copper and bronze; tools no longer short in many towns; the day's ledger
 * open from the first day; ships bought as capital; the kingdoms' last
 * stand, capitulation and first peace (world/kingdomAI.js).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Hinterland } from '../world/hinterland.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { Ships } from '../systems/ships.js';
import { Guilds } from '../systems/guilds.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { Ledger } from '../systems/ledger.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { Player } from '../player/player.js';
import { Hex } from '../core/hex.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => logSpy && logSpy.mockRestore());

/** A generated world, and two towns of different realms 4–18 hexes apart with no treaty or embargo between them. */
function crossBorder(seed = 4242) {
    const game = newGame(seed);
    const { world } = game;
    const towns = world.getAllSettlements().filter(s => s.kingdom != null && s.type !== 'village');
    for (const a of towns) {
        for (const b of towns) {
            if (a.kingdom === b.kingdom) continue;
            const d = Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width);
            if (d < 4 || d > 18) continue;
            const ka = world.getKingdom(a.kingdom), kb = world.getKingdom(b.kingdom);
            if (!ka || !kb || TradePolicy.hasTreaty(ka, kb) || TradePolicy.embargoed(ka, kb)) continue;
            return { ...game, a: world.getTile(a.q, a.r).settlement, b: world.getTile(b.q, b.r).settlement, ka, kb };
        }
    }
    throw new Error('no cross-border pair');
}

/** Give the player `qty` of a good bought in `town` (booked to its realm). */
function stock(player, town, goodId, qty) {
    player.inventory[goodId] = (player.inventory[goodId] || 0) + qty;
    TradePolicy.onBuy(player, town, goodId, qty);
}

/** A caravan to `b`, brought in at once (the timer-only kind). */
function runCaravan(g, goods) {
    const { player, world, a, b } = g;
    const res = PlayerEconomy.startCaravan(player, { q: a.q, r: a.r, name: a.name }, b, goods, world);
    if (!res.success) return res;
    res.caravan.daysRemaining = 1;
    const done = PlayerEconomy.updateCaravans(player, world).find(c => c.to === b.name && c.finalProfit !== undefined);
    return { ...res, done };
}

describe('trade policy reaches the player\'s caravans and routes', () => {
    it('a caravan pays the destination\'s import tariff on goods booked abroad, into its treasury', () => {
        const g = crossBorder();
        const { player, a, ka, kb } = g;
        player.q = a.q; player.r = a.r;
        player.gold = 5000;
        player.financeToday = { income: {}, expenses: {} };
        stock(player, a, 'tools', 20);
        TradePolicy.realm(kb).imp.wares = 0.25;
        const t0 = kb.treasury;
        const run = runCaravan(g, { tools: 10 });
        expect(run.success).toBe(true);
        // The bookings went with the goods (half the player's tools, booked to the home realm)
        expect(TradePolicy.playerState(player).ledger.tools[String(ka.id)]).toBeCloseTo(10, 1);
        expect(run.done).toBeTruthy();
        expect(run.done.duty).toBeGreaterThan(0);
        expect(kb.treasury).toBe(t0 + run.done.duty);
        // A quarter of the takings: the duty against what the caravan kept
        expect(run.done.duty / (run.done.duty + run.done.finalProfit)).toBeCloseTo(0.25, 1);
        // ...a memo line in the books (paid inside the price)
        expect(player.financeToday.income.saleDuties).toBe(-run.done.duty);
        expect(Ledger.category('saleDuties').kind).toBe('memo');
    });

    it('goods bought at home pay nothing at home; a treaty waives the duty', () => {
        const g = crossBorder();
        const { player, a, b, ka, kb } = g;
        player.q = a.q; player.r = a.r;
        player.gold = 5000;
        TradePolicy.realm(kb).imp.wares = 0.25;
        stock(player, b, 'tools', 10);
        const home = runCaravan(g, { tools: 10 });
        expect(home.success).toBe(true);
        expect(home.done.duty).toBe(0);
        TradePolicy._sign(g.world, ka, kb);
        stock(player, a, 'tools', 10);
        const treaty = runCaravan(g, { tools: 10 });
        expect(treaty.done.duty).toBe(0);
    });

    it('an export ban keeps the caravan at home (a licence lets it go); an embargo stops goods of the realm', () => {
        const g = crossBorder();
        const { player, world, a, b, ka, kb } = g;
        player.q = a.q; player.r = a.r;
        player.gold = 5000;
        stock(player, a, 'tools', 30);
        TradePolicy.realm(ka).bans.wares = { since: 0, why: 'test' };
        const banned = PlayerEconomy.startCaravan(player, a, b, { tools: 5 }, world);
        expect(banned.success).toBe(false);
        expect(banned.reason).toMatch(/bans the export/);
        TradePolicy.playerState(player).licences[ka.id] = world.day + 50;
        expect(PlayerEconomy.startCaravan(player, a, b, { tools: 5 }, world).success).toBe(true);
        delete TradePolicy.realm(ka).bans.wares;
        TradePolicy._embargo(world, kb, ka, 'rival');
        const emb = PlayerEconomy.startCaravan(player, a, b, { tools: 5 }, world);
        expect(emb.success).toBe(false);
        expect(emb.reason).toMatch(/embargo/);
    });

    it('a caravan already on the road when the embargo falls pays double at the border', () => {
        const g = crossBorder();
        const { player, world, a, b, ka, kb } = g;
        player.q = a.q; player.r = a.r;
        player.gold = 5000;
        stock(player, a, 'tools', 10);
        TradePolicy.realm(kb).imp.wares = 0.1;
        const res = PlayerEconomy.startCaravan(player, a, b, { tools: 10 }, world);
        expect(res.success).toBe(true);
        TradePolicy._embargo(world, kb, ka, 'rival');
        res.caravan.daysRemaining = 1;
        const done = PlayerEconomy.updateCaravans(player, world).find(c => c.to === b.name && c.finalProfit !== undefined);
        expect(done.duty / (done.duty + done.finalProfit)).toBeCloseTo(0.2, 1);
    });

    it('a legal trade route stalls under an export ban and carries its bookings once it is lifted', () => {
        const g = crossBorder();
        const { player, world, a, b, ka } = g;
        player.gold = 5000;
        stock(player, a, 'tools', 20);
        const made = PlayerEconomy.createPersistentRoute(player, world, { fromPos: { q: a.q, r: a.r }, toPos: { q: b.q, r: b.r }, goodId: 'tools', quantity: 5 });
        expect(made.success).toBe(true);
        TradePolicy.realm(ka).bans.wares = { since: 0, why: 'test' };
        const stalled = PlayerEconomy._dispatchRouteCaravan(player, made.route, world);
        expect(stalled.success).toBe(false);
        expect(made.route.lastResult).toBe('stalled_policy');
        expect(player.inventory.tools).toBe(20);
        delete TradePolicy.realm(ka).bans.wares;
        const ok = PlayerEconomy._dispatchRouteCaravan(player, made.route, world);
        expect(ok.success).toBe(true);
        expect(ok.caravan.lots.tools[String(ka.id)]).toBeCloseTo(5, 1);
    });

    it('no money loop: a caravan never earns more for a duty paid, and customs never pay the player', () => {
        const g = crossBorder();
        const { player, a, kb } = g;
        player.q = a.q; player.r = a.r;
        player.gold = 5000;
        stock(player, a, 'tools', 10);
        TradePolicy.realm(kb).imp.wares = 0.3;
        const gold0 = player.gold;
        const run = runCaravan(g, { tools: 10 });
        expect(player.gold).toBe(gold0 - 200 + run.done.finalProfit);
        expect(run.done.finalProfit).toBeGreaterThanOrEqual(0);
    });
});

// ── Ships ───────────────────────────────────────────────

const WATER = { id: 'ocean', name: 'Ocean', passable: false, moveCost: 99 };
const GRASS = { id: 'grassland', name: 'Grassland', passable: true, moveCost: 1 };

/** Two ports on a sea: Saltmere (5,5) in Aster (k1), Brinehold (12,3) in Brenn (k2). */
function seaWorld() {
    const kingdoms = ['k1', 'k2'].map((id, i) => ({ id, name: ['Aster', 'Brenn'][i], isAlive: true, wars: [], allies: [], relations: {}, treasury: 5000, traits: ['peaceful'] }));
    const land = {
        '5,5': { q: 5, r: 5, kingdom: 'k1', terrain: GRASS, settlement: { name: 'Saltmere', type: 'town', kingdom: 'k1', q: 5, r: 5 } },
        '12,3': { q: 12, r: 3, kingdom: 'k2', terrain: GRASS, settlement: { name: 'Brinehold', type: 'town', kingdom: 'k2', q: 12, r: 3 } },
    };
    const tiles = new Map();
    return {
        width: 20, height: 20, day: 10, kingdoms, units: [],
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile(q, r) {
            if (r < 0 || r >= 20) return null;
            q = ((q % 20) + 20) % 20;
            const key = `${q},${r}`;
            if (!tiles.has(key)) tiles.set(key, land[key] || { q, r, terrain: WATER, settlement: null });
            return tiles.get(key);
        },
    };
}

function sailor(q, r) {
    return {
        q, r, gold: 5000, boardedShip: null, inventory: {}, skills: { commerce: 1 }, reputation: {},
        ships: [{ id: 's1', name: 'Gull', typeId: 'galleon', status: 'docked', q, r, cargo: {} }],
    };
}

describe('trade policy reaches the ships', () => {
    it('cargo bought at one realm\'s port pays the other\'s import tariff where it lands', () => {
        const world = seaWorld();
        const good = Ships.getPortMarket(world, 12, 3)[0];
        const cat = TradePolicy.categoryOf(good.id);
        const sell = (tariff) => {
            const w = seaWorld();
            if (tariff) TradePolicy.realm(w.getKingdom('k2')).imp[cat] = tariff;
            const p = sailor(12, 3);
            p.ships[0].cargo[good.id] = 10;
            p.ships[0].lots = { [good.id]: { k1: 10 } };
            const t0 = w.getKingdom('k2').treasury;
            const res = Ships.sellTradeGood(p, w, 's1', good.id, 5);
            return { res, paid: w.getKingdom('k2').treasury - t0, p };
        };
        const free = sell(0);
        const taxed = sell(0.2);
        expect(free.res.success && taxed.res.success).toBe(true);
        expect(free.res.duty).toBe(0);
        expect(taxed.res.duty).toBeGreaterThan(0);
        expect(taxed.paid).toBe(taxed.res.duty);
        expect(taxed.res.revenue).toBeLessThan(free.res.revenue);
        expect(taxed.res.revenue).toBeGreaterThanOrEqual(Math.floor(free.res.revenue * 0.8) - 1);
        // The bookings shrink with the cargo sold
        expect(taxed.p.ships[0].lots[good.id].k1).toBeCloseTo(5, 1);
    });

    it('a port under embargo lands none of the enemy\'s cargo openly; a ban stops a hold being filled', () => {
        const w = seaWorld();
        const k1 = w.getKingdom('k1'), k2 = w.getKingdom('k2');
        TradePolicy._embargo(w, k2, k1, 'rival');
        const good = Ships.getPortMarket(w, 12, 3)[0];
        const p = sailor(12, 3);
        p.ships[0].cargo[good.id] = 4;
        p.ships[0].lots = { [good.id]: { k1: 4 } };
        const res = Ships.sellTradeGood(p, w, 's1', good.id, 2);
        expect(res.success).toBe(false);
        expect(res.message).toMatch(/embargo/);

        const w2 = seaWorld();
        const buyable = Ships.getPortMarket(w2, 5, 5).find(e => e.buy !== null);
        TradePolicy.realm(w2.getKingdom('k1')).bans[TradePolicy.categoryOf(buyable.id)] = { since: 0, why: 'test' };
        const q = sailor(5, 5);
        const bought = Ships.buyTradeGood(q, w2, 's1', buyable.id, 3);
        expect(bought.success).toBe(false);
        expect(bought.message).toMatch(/bans the export/);
    });

    it('a hold filled at port is booked to the port\'s realm; packs and hold swap bookings', () => {
        const w = seaWorld();
        const buyable = Ships.getPortMarket(w, 5, 5).find(e => e.buy !== null);
        const p = sailor(5, 5);
        expect(Ships.buyTradeGood(p, w, 's1', buyable.id, 3).success).toBe(true);
        expect(p.ships[0].lots[buyable.id].k1).toBe(3);
        // Tools bought in Brenn go aboard with their booking, and come back with it
        p.inventory.tools = 6;
        TradePolicy.onBuy(p, { kingdom: 'k2' }, 'tools', 6);
        expect(Ships.loadCargo(p, w, 's1', 'tools', 4).success).toBe(true);
        expect(p.ships[0].lots.tools.k2).toBeCloseTo(4, 1);
        expect(TradePolicy.playerState(p).ledger.tools.k2).toBeCloseTo(2, 1);
        Ships.unloadCargo(p.ships[0], p, Infinity, 'tools');
        expect(TradePolicy.playerState(p).ledger.tools.k2).toBeCloseTo(6, 1);
        expect(p.ships[0].lots.tools).toBeUndefined();
    });

    it('a ship bought or commissioned is capital in the ledger, not upkeep', () => {
        const p = new Player({ firstName: 'Cap', lastName: 'Tain', gender: 'male', age: 30 });
        p.gold = 20000; p.q = 5; p.r = 5;
        const w = { day: 1, width: 50, getTile: (q, r) => (q === 5 && r === 5)
            ? { q, r, settlement: { name: 'Saltmere', type: 'capital' }, terrain: { id: 'plains', passable: true } }
            : { q, r, terrain: { id: 'ocean', passable: false } } };
        const before = p.gold;
        expect(Ships.commissionShip(p, 5, 5, 'sloop', 'Gull', [], w).success).toBe(true);
        const cost = before - p.gold;
        expect(p.financeToday.income.shipsBought).toBe(-cost);
        expect(p.financeToday.expenses.ships).toBeUndefined();
        expect(Ledger.category('shipsBought').kind).toBe('cap');
        const row = Ledger.closeDay(p, w);
        // Capital: not an expense in the day's net
        expect(row.totalExpenses || 0).toBe(0);
    });
});

// ── The trading company ─────────────────────────────────

describe('the trading company\'s factors', () => {
    /** A company with a post in a town whose guild guards a good the factors deal in. */
    function guildPost() {
        for (const seed of [4242, 101, 202, 303]) {
            const game = newGame(seed);
            const { world, player } = game;
            player.gold = 60000;
            player.reputation = Object.fromEntries(world.kingdoms.map(k => [k.id, 20]));
            for (const s of world.getAllSettlements().filter(x => x.kingdom != null && x.type !== 'village')) {
                const tile = world.getTile(s.q, s.r);
                Guilds.ensureTown(world, tile.settlement, world.day);
                const goods = Object.keys(Guilds.config().goodOf).filter(id => Guilds.guardOf(tile.settlement, id) && MerchantHouses._good(id));
                if (!goods.length) continue;
                player.q = s.q; player.r = s.r;
                if (!MerchantHouses.company(player)) {
                    if (!MerchantHouses.buyCharter(player, world, tile).success) continue;
                    if (!MerchantHouses.found(player, world, { capital: 20000 }).success) continue;
                }
                const opened = MerchantHouses.openPost(player, world, tile, 0);
                if (!opened.success) continue;
                return { ...game, tile, s: tile.settlement, post: opened.post, good: goods[0] };
            }
        }
        throw new Error('no guild town');
    }

    it('count against the guild\'s outsider cap and pay its toll into the guildhall', () => {
        const g = guildPost();
        const { player, world, tile, s, post, good } = g;
        const guild = Guilds.guardOf(s, good);
        guild.week = { outsider: {}, toll: 0 };
        const room = Guilds.outsiderRoom(player, s, good);
        expect(Number.isFinite(room)).toBe(true);
        post.stock[good] = room + 50;
        const sale = MerchantHouses._factorSale(player, world, tile, post.lots, post.stock[good], good, room + 50);
        // The factor sells no more than the guild lets an outsider sell this week
        expect(sale.n).toBe(room);
        const treasury0 = guild.treasury || 0;
        MerchantHouses._settleFactorSale(player, world, s, post.lots, good, sale);
        expect(guild.week.outsider[good]).toBe(room);
        expect(sale.earned).toBeGreaterThan(0);
        if (Guilds.tollRate(player, s, good) > 0) expect(guild.treasury).toBeGreaterThan(treasury0);
        expect(Guilds.outsiderRoom(player, s, good)).toBe(0);
        // ...and the weekly run sells nothing more of it
        expect(MerchantHouses._factorSale(player, world, tile, post.lots, 50, good, 10).n).toBe(0);
    });

    it('pay the import tariff on stock bought in another realm, into the crown\'s treasury', () => {
        const g = guildPost();
        const { player, world, tile, s, post } = g;
        const good = 'tools';
        const here = world.getKingdom(s.kingdom);
        const other = world.kingdoms.find(k => k.isAlive && k.id !== s.kingdom && !TradePolicy.hasTreaty(k, here) && !TradePolicy.embargoed(k, here));
        TradePolicy.realm(here).imp[TradePolicy.categoryOf(good)] = 0.2;
        post.stock[good] = 10;
        post.lots = {};
        TradePolicy.book(post.lots, { kingdom: other.id }, good, 10);
        const taxed = MerchantHouses._factorSale(player, world, tile, post.lots, 10, good, 4);
        const free = MerchantHouses._factorSale(player, world, tile, {}, 10, good, 4);
        expect(taxed.check.rate).toBeCloseTo(0.2, 5);
        expect(free.earned).toBeGreaterThan(0);
        {
            expect(taxed.earned).toBeLessThan(free.earned);
            const t0 = here.treasury;
            const duty = MerchantHouses._settleFactorSale(player, world, s, post.lots, good, taxed);
            expect(duty).toBeGreaterThan(0);
            expect(here.treasury).toBe(t0 + duty);
            expect(post.lots[good][String(other.id)]).toBeCloseTo(6, 1);
        }
        // A convoy can't carry it out of a realm that bans its export
        TradePolicy.realm(here).bans[TradePolicy.categoryOf(good)] = { since: 0, why: 'test' };
        const other2 = world.getAllSettlements().find(x => x.kingdom === other.id);
        const dest = MerchantHouses.openPost(player, world, world.getTile(other2.q, other2.r), 0);
        expect(dest.success).toBe(true);
        {
            const sent = MerchantHouses.dispatchConvoy(player, world, post.id, { postId: dest.post.id }, good, 3);
            expect(sent.success).toBe(false);
            expect(sent.reason).toMatch(/bans the export/);
        }
    });
});

// ── Copper, bronze and tools ────────────────────────────

describe('copper and bronze', () => {
    it('are market goods with a founders\' trade, a works, a player recipe and leasable mines', () => {
        expect(SettlementMarket.tracks('copper')).toBe(true);
        expect(SettlementMarket.tracks('bronze')).toBe(true);
        const founder = DataLoader._gamedata.markets.recipes.find(r => r.id === 'founder');
        expect(founder.in.copper).toBeGreaterThan(0);
        expect(founder.out.bronze).toBeGreaterThan(0);
        expect(MerchantPrince.kind('founder')).toBeTruthy();
        expect(PlayerEconomy.RECIPES.CAST_BRONZE.input).toBe('copper');
        expect(PlayerEconomy.GOODS.COPPER.basePrice).toBeGreaterThan(0);
        expect(Guilds.def('smiths').recipes).toContain('founder');
        expect(TradePolicy.categoryOf('copper')).toBe('raw');
        const k = Hinterland.kind('copper_mine');
        expect(k.leasable && k.deposit).toBe(true);
    });

    it('copper mines open in the hills of a generated world and dig copper for their towns', () => {
        const game = newGame(101);
        const { world } = game;
        Hinterland.backfill(world);
        const mines = Hinterland.sites(world).filter(s => s.kind === 'copper_mine');
        expect(mines.length).toBeGreaterThan(0);
        const site = mines[0];
        const home = world.getTile(...site.h.split(',').map(Number)).settlement;
        const out = Hinterland.output(world, site, home, 4, world.day);
        expect(out.goods.copper).toBeGreaterThan(0);
        expect(out.dug).toBeGreaterThan(0);
    });
});

describe('tools after the hinterland', () => {
    it('run short only now and then: few towns past the shortage line after a season', () => {
        const game = newGame(202);
        for (let d = 0; d < 100; d++) {
            game.player.health = 100;
            game.player.starvationDays = 0;
            game.player.inventory.bread = 30;
            endDay(game);
        }
        const towns = game.world.getAllSettlements().filter(s => s.market);
        const short = towns.filter(s => s.market.short && s.market.short.tools > 0.1);
        expect(towns.length).toBeGreaterThan(30);
        expect(short.length / towns.length).toBeLessThan(0.06);
    }, 60000);
});

// ── The ledger and saving ───────────────────────────────

describe('the day\'s ledger from the first day', () => {
    it('a new character has today\'s tally open: flows written before the first close are kept', () => {
        const p = new Player({ firstName: 'New', lastName: 'Born', gender: 'female', age: 18 });
        expect(p.financeToday).toEqual({ income: {}, expenses: {} });
        // A system that writes only into an open tally (the older style)
        if (p.financeToday) p.financeToday.income.jobs = (p.financeToday.income.jobs || 0) + 12;
        const row = Ledger.closeDay(p, { day: 1 });
        expect(row.income.jobs).toBe(12);
        expect(p.financeHistory.length).toBe(1);
    });

    it('an older save with no tally loads with one open', () => {
        const p = new Player({ firstName: 'Old', lastName: 'Save', gender: 'male', age: 40 });
        SaveLoad.restorePlayer({ financeToday: null, gold: 10 }, p, null);
        expect(p.financeToday).toEqual({ income: {}, expenses: {} });
    });
});

// ── The kingdoms ────────────────────────────────────────

describe('the realms\' last stand and first peace', () => {
    function twoRealms() {
        const game = newGame(4242);
        const { world } = game;
        const [a, b] = world.kingdoms.filter(k => k.isAlive);
        return { world, a, b };
    }

    it('no realm marches on another in the first weeks; the first wars come staggered', () => {
        const { world, a, b } = twoRealms();
        world.day = 1;
        expect(KingdomAI.foundingPeace(a, b, world)).toBe(true);
        world.day = KingdomAI.WAR.foundingPeace[1];
        expect(KingdomAI.foundingPeace(a, b, world)).toBe(false);
        // Symmetric and draws no RNG
        world.day = 50;
        Utils.setSeed(3);
        const r = Utils.random();
        Utils.setSeed(3);
        expect(KingdomAI.foundingPeace(a, b, world)).toBe(KingdomAI.foundingPeace(b, a, world));
        expect(Utils.random()).toBe(r);
    });

    it('a realm whose last town is about to fall may capitulate: tribute and a truce, not annihilation', () => {
        const { world, a, b } = twoRealms();
        KingdomAI.startWar(a, b, world);
        b.treasury = 10000;
        const ta = a.treasury;
        let tries = 0;
        Utils.setSeed(11);
        while (!KingdomAI._capitulates(a, b, world) && tries < 50) tries++;
        expect(tries).toBeLessThan(50);
        expect(a.wars).not.toContain(b.id);
        expect(b.isAlive).toBe(true);
        expect(a.treasury).toBe(ta + Math.floor(10000 * KingdomAI.WAR.capitulateTribute));
        expect(KingdomAI.hasTruce(a, b, world)).toBe(true);
    });
});

/**
 * Merchant Prince (systems/merchantPrince.js, systems/marketFairs.js): works
 * the player funds in a town's market, store-rooms, forward contracts, fairs
 * and market news — and that none of it is a money loop.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { MarketFairs } from '../systems/marketFairs.js';
import { Heralds } from '../systems/heralds.js';
import { Counsel } from '../systems/counsel.js';
import { PlayerEconomy, Trading } from '../player/playerEconomy.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { TownLabour } from '../world/townLabour.js';

beforeAll(async () => {
    await loadData();
});

// Restore any data patched by a test
let _saved = null;
function patch(section, path, value) {
    if (!_saved) _saved = JSON.parse(JSON.stringify(DataLoader._gamedata.merchantPrince));
    const d = JSON.parse(JSON.stringify(DataLoader._gamedata.merchantPrince));
    const keys = path.split('.');
    let o = d[section];
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = value;
    DataLoader._gamedata.merchantPrince = d;
}
afterEach(() => {
    if (_saved) DataLoader._gamedata.merchantPrince = _saved;
    _saved = null;
});

const GOODS = () => PlayerEconomy.GOODS;
const plains = (q, r, settlement = null) => ({ q, r, terrain: { id: 'plains', passable: true }, resource: null, settlement });

/** A small world: a capital at (5,5) of realm k1, a town at (9,5); the player stands in the capital. */
function fixture(opts = {}) {
    const capital = { name: 'Highmarket', type: 'capital', population: 12000, happiness: 50, kingdom: 'k1', q: 5, r: 5 };
    const town = { name: 'Brindle', type: 'town', population: 3000, happiness: 50, kingdom: 'k1', q: 9, r: 5 };
    const tiles = new Map([['5,5', plains(5, 5, capital)], ['9,5', plains(9, 5, town)]]);
    const kingdoms = [{ id: 'k1', name: 'Aster', isAlive: true, wars: [], capital: { q: 5, r: 5 }, finance: { debtRatio: 0, missed: 0, unpaid: 0 }, traits: [] }];
    const world = {
        width: 40, height: 40, day: opts.day || 50, activeEvents: [], units: [], kingdoms,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || plains(q, r),
        getSettlementViews: () => [capital, town],
        getAllSettlements: () => [capital, town],
    };
    for (const s of [capital, town]) SettlementMarket.ensure(s);
    const player = {
        q: 5, r: 5, gold: 50000, inventory: { wood: 100, stone: 100, iron: 50, tools: 20, textiles: 20 }, maxInventory: 99,
        skills: { commerce: 0 }, reputation: { k1: 10 }, name: 'Tester',
    };
    return { world, player, capital, town, tiles, kingdoms };
}

/** Run the capital's market day (k days at once) the way MarketDynamics does. */
function marketDay(world, s, days = 4, extra = {}) {
    SettlementMarket.processSettlement(s, {}, { day: world.day, days, ...extra });
}

describe('industry: works in a town market', () => {
    it('funding a bakehouse raises the town\'s processing and pays a share of the value it adds', () => {
        const { world, player, capital } = fixture();
        const tile = world.getTile(5, 5);
        const m = capital.market;
        // Grain in glut, bread short: a baker's dream
        const glut = () => { m.stock.grain = SettlementMarket.target(capital, 'grain') * 1.5; m.stock.bread = SettlementMarket.target(capital, 'bread') * 0.5; };
        const control = JSON.parse(JSON.stringify(capital));
        glut();
        Object.assign(control.market.stock, m.stock);
        const res = MerchantPrince.invest(player, world, tile, 'bakery');
        expect(res.success).toBe(true);
        expect(player.inventory.wood).toBe(90);
        const w = SettlementMarket.works(capital, 'bakery');
        expect(w.lvl).toBe(1);
        expect(w.cap).toBe(MerchantPrince.kind('bakery').runsPerLevel);
        marketDay(world, capital);
        marketDay(world, control);
        // The works baked real bread out of real grain, on top of the town's own bakers
        expect(w.runs).toBeGreaterThan(0);
        expect(w.va).toBeGreaterThan(0);
        expect(capital.market.stock.bread).toBeGreaterThan(control.market.stock.bread);
        expect(capital.market.stock.grain).toBeLessThan(control.market.stock.grain);
        // Market day pays the investor's share less the crown's tithe and the hands' wages
        const gold = player.gold;
        MerchantPrince.processDay(player, world);
        const wages = TownLabour.worksWageBill(capital, 'bakery', w, SettlementMarket.tickDays());
        expect(wages).toBeGreaterThan(0);
        const expected = Math.floor(w.va * MerchantPrince.config().industry.investorShare * (1 - 0.1) - wages);
        expect(player.gold - gold).toBe(expected);
        expect(MerchantPrince.state(player).investments[0].earned).toBe(expected);
        // ...once per market day
        world.day++;
        MerchantPrince.processDay(player, world);
        expect(player.gold - gold).toBe(expected);
    });

    it('idles when the input runs short or the output gluts, and stops short of the town\'s own needs', () => {
        const { world, player, capital } = fixture();
        MerchantPrince.invest(player, world, world.getTile(5, 5), 'bakery');
        const m = capital.market;
        const keep = SettlementMarket.target(capital, 'grain') * SettlementMarket.config().works.keep;
        m.stock.grain = keep * 0.9;
        m.stock.bread = 0;
        marketDay(world, capital);
        expect(SettlementMarket.works(capital, 'bakery').runs).toBe(0);
        m.stock.grain = SettlementMarket.target(capital, 'grain') * 2;
        m.stock.bread = SettlementMarket.target(capital, 'bread') * 2.5;
        marketDay(world, capital);
        expect(SettlementMarket.works(capital, 'bakery').runs).toBe(0);
    });

    it('needs the player in town, the gold and the materials; extends by levels up to the cap', () => {
        const { world, player, capital } = fixture();
        const tile = world.getTile(5, 5);
        player.q = 9;
        expect(MerchantPrince.invest(player, world, tile, 'bakery').success).toBe(false);
        player.q = 5;
        player.inventory = {};
        expect(MerchantPrince.invest(player, world, tile, 'bakery').reason).toMatch(/packs/);
        player.inventory = { wood: 100, stone: 100 };
        const c1 = MerchantPrince.investQuote(player, world, tile, 'bakery').gold;
        expect(MerchantPrince.invest(player, world, tile, 'bakery').success).toBe(true);
        const c2 = MerchantPrince.investQuote(player, world, tile, 'bakery').gold;
        expect(c2).toBeGreaterThan(c1);
        expect(MerchantPrince.invest(player, world, tile, 'bakery').success).toBe(true);
        expect(MerchantPrince.invest(player, world, tile, 'bakery').success).toBe(true);
        expect(MerchantPrince.invest(player, world, tile, 'bakery').success).toBe(false);
        expect(SettlementMarket.works(capital, 'bakery').cap).toBe(MerchantPrince.kind('bakery').runsPerLevel * 3);
        expect(MerchantPrince.state(player).investments).toHaveLength(1);
        // A village has no jeweller
        expect(MerchantPrince.investQuote(player, world, { q: 0, r: 0, settlement: { type: 'village', population: 300, name: 'X' } }, 'jeweller').ok).toBe(false);
    });

    it('a town the player holds builds cheaper, pays more and owes no tithe', () => {
        const { world, player, capital } = fixture();
        const tile = world.getTile(5, 5);
        const foreign = MerchantPrince.investQuote(player, world, tile, 'bakery');
        player.settlements = [{ q: 5, r: 5 }];
        const own = MerchantPrince.investQuote(player, world, tile, 'bakery');
        expect(own.gold).toBeLessThan(foreign.gold);
        expect(own.share).toBeGreaterThan(foreign.share);
        expect(own.tithe).toBe(0);
        expect(MerchantPrince.titheRate(player, world, capital)).toBe(0);
    });

    it('the tithe rises at war and in a treasury crisis; merchant charters halve it', () => {
        const { world, player, capital, kingdoms } = fixture();
        const base = MerchantPrince.titheRate(player, world, capital);
        kingdoms[0].wars = ['k9'];
        const war = MerchantPrince.titheRate(player, world, capital);
        kingdoms[0].finance.debtRatio = 2;
        const crisis = MerchantPrince.titheRate(player, world, capital);
        expect(war).toBeGreaterThan(base);
        expect(crisis).toBeGreaterThan(war);
        // A player-king enforcing Merchant charters (systems/kingship.js)
        kingdoms.push({ id: 'k2', name: 'Mine', isAlive: true, wars: [] });
        player.throne = { ruling: { kingdomId: 'k2', court: { edicts: { merchant_charters: { since: 1 } } } } };
        expect(MerchantPrince.titheRate(player, world, capital)).toBeCloseTo(crisis * 0.5, 5);
    });
});

describe('industry: seizure, expropriation and damage', () => {
    it('a realm at war with the player seizes the works; they keep running for the crown', () => {
        const { world, player, capital } = fixture();
        MerchantPrince.invest(player, world, world.getTile(5, 5), 'bakery');
        player.realmWars = { wars: { k1: { since: 40 } }, ultimatums: {}, truces: {} };
        const out = MerchantPrince.processDay(player, world);
        expect(out.notices.some(n => /Seized/.test(n.title))).toBe(true);
        expect(MerchantPrince.state(player).investments).toHaveLength(0);
        const w = SettlementMarket.works(capital, 'bakery');
        expect(w.owner).toBe('crown');
        expect(MerchantPrince.investQuote(player, world, world.getTile(5, 5), 'bakery').ok).toBe(false);
        capital.market.stock.bread = 0;
        marketDay(world, capital);
        expect(w.runs).toBeGreaterThan(0);
        expect(MerchantPrince.state(player).stats.seized).toBe(1);
    });

    it('a crown in crisis may seize the works on its weekly reckoning (no dice: a hash of the day)', () => {
        patch('industry', 'seizure.crisisChance', 1);
        const { world, player, kingdoms } = fixture({ day: 50 });
        MerchantPrince.invest(player, world, world.getTile(5, 5), 'bakery');
        kingdoms[0].finance.debtRatio = 2;
        world.day = 55;
        MerchantPrince.processDay(player, world);
        expect(MerchantPrince.state(player).investments).toHaveLength(1);
        world.day = 56;
        MerchantPrince.processDay(player, world);
        expect(MerchantPrince.state(player).investments).toHaveLength(0);
    });

    it('a collapsed name in the realm gets the works expropriated after a grace period', () => {
        const { world, player, capital } = fixture();
        MerchantPrince.invest(player, world, world.getTile(5, 5), 'bakery');
        player.reputation.k1 = -60;
        const grace = MerchantPrince.config().industry.seizure.graceDays;
        for (let d = 0; d < grace - 1; d++) { world.day++; MerchantPrince.processDay(player, world); }
        expect(MerchantPrince.state(player).investments).toHaveLength(1);
        // The counsel warns while there's time
        Counsel.invalidate(player);
        expect(Counsel.scan(player, world, { fresh: true }).items.some(i => /guilds talk of taking/.test(i.text))).toBe(true);
        world.day++;
        MerchantPrince.processDay(player, world);
        expect(MerchantPrince.state(player).investments).toHaveLength(0);
        expect(SettlementMarket.works(capital, 'bakery').owner).toBe('town');
        expect(MerchantPrince.state(player).stats.expropriated).toBe(1);
    });

    it('a sack damages the works, a siege idles them, and repair costs gold', () => {
        const { world, player, capital } = fixture();
        MerchantPrince.invest(player, world, world.getTile(5, 5), 'bakery');
        const w = SettlementMarket.works(capital, 'bakery');
        SettlementMarket.loot(capital, 0.8);
        expect(w.cond).toBeCloseTo(1 - 0.8 * SettlementMarket.config().works.lootDamage, 2);
        // Under siege (MarketDynamics passes worksMult 0) the works stand idle
        capital.market.stock.grain = SettlementMarket.target(capital, 'grain') * 1.5;
        capital.market.stock.bread = 0;
        marketDay(world, capital, 4, { worksMult: 0 });
        expect(w.runs).toBe(0);
        // ...and a siege of the town wears them
        const before = w.cond;
        player.sieges = { active: { q: 5, r: 5 } };
        world.day++;
        MerchantPrince.processDay(player, world);
        expect(w.cond).toBeLessThan(before);
        delete player.sieges;
        const inv = MerchantPrince.state(player).investments[0];
        const cost = MerchantPrince.repairCost(player, world, inv);
        expect(cost).toBeGreaterThan(0);
        const gold = player.gold;
        expect(MerchantPrince.repair(player, world, inv.id).success).toBe(true);
        expect(player.gold).toBe(gold - cost);
        expect(w.cond).toBe(1);
    });

    it('selling the stake back returns less than was put in', () => {
        const { world, player, capital } = fixture();
        const gold = player.gold;
        MerchantPrince.invest(player, world, world.getTile(5, 5), 'bakery');
        const r = MerchantPrince.sellStake(player, world, MerchantPrince.state(player).investments[0].id);
        expect(r.success).toBe(true);
        expect(player.gold).toBeLessThan(gold);
        expect(SettlementMarket.works(capital, 'bakery').owner).toBe('town');
    });
});

describe('warehouses', () => {
    it('stores goods outside the packs, spoils them at half the stalls\' rate, and sells into the town later', () => {
        const { world, player, capital } = fixture();
        const tile = world.getTile(5, 5);
        expect(MerchantPrince.rentWarehouse(player, world, tile, 'small').success).toBe(true);
        const w = MerchantPrince.warehouseAt(player, 5, 5);
        // Bought straight from the stalls: the price climbs, the stock falls, the packs stay empty
        const stock = SettlementMarket.stock(capital, 'fish');
        const b = MerchantPrince.buyInto(player, world, w.id, 'fish', 40);
        expect(b.success).toBe(true);
        expect(SettlementMarket.stock(capital, 'fish')).toBeCloseTo(stock - 40, 1);
        expect(player.inventory.fish).toBeUndefined();
        expect(w.goods.fish).toBe(40);
        // Fish spoils (5% a day on a stall, half that in store)
        const rate = MerchantPrince.spoilRate('fish');
        expect(rate).toBeCloseTo(SettlementMarket.good('fish').spoil * 0.5, 6);
        world.day++;
        MerchantPrince.processDay(player, world);
        expect(w.goods.fish).toBeCloseTo(40 * (1 - rate), 1);
        // The room holds no more than its units
        player.inventory.stone = 1000;
        const d = MerchantPrince.deposit(player, world, w.id, 'stone', 1000);
        expect(d.qty).toBe(MerchantPrince.capacity(w) - Math.ceil(MerchantPrince.used(w) - d.qty));
        // A sale goes into the town's market at its price today
        const before = SettlementMarket.stock(capital, 'stone');
        const quote = MerchantPrince.saleQuote(player, world, w, 'stone', 20);
        const s = MerchantPrince.sellFrom(player, world, w.id, 'stone', 20);
        expect(s.earned).toBe(Math.floor(quote * 20));
        expect(SettlementMarket.stock(capital, 'stone')).toBeCloseTo(before + 20, 1);
        // Into the packs (a free slot), and away from town it can't be touched
        expect(MerchantPrince.withdraw(player, world, w.id, 'fish', 5).success).toBe(true);
        player.q = 9;
        expect(MerchantPrince.sellFrom(player, world, w.id, 'stone', 5).success).toBe(false);
    });

    it('thieves strike on the lease\'s weekly day when the odds say so (no dice drawn)', () => {
        patch('warehouse', 'theft.base', 0.95);
        const { world, player } = fixture({ day: 50 });
        MerchantPrince.rentWarehouse(player, world, world.getTile(5, 5), 'large');
        const w = MerchantPrince.warehouseAt(player, 5, 5);
        player.inventory.iron = 50;
        MerchantPrince.deposit(player, world, w.id, 'iron', 50);
        let robbed = null;
        for (let d = 0; d < 7 && !robbed; d++) {
            world.day++;
            const out = MerchantPrince.processDay(player, world);
            robbed = out.notices.find(n => /Robbed/.test(n.title));
        }
        expect(robbed).toBeTruthy();
        expect(w.goods.iron).toBeLessThan(50);
        expect(MerchantPrince.state(player).stats.stolen).toBeGreaterThan(0);
        // Heat and the guild raise the odds; a guildmate is spared
        const base = MerchantPrince.theftChance(player, world, w);
        player.underworld = { heat: { k1: 80 }, guild: { member: true, rank: 3 } };
        expect(MerchantPrince.theftChance(player, world, w)).toBeLessThan(base + 80 * 0.0006 + 1e-9);
    });

    it('rent falls due weekly; two weeks unpaid and the landlord sells the stock off', () => {
        const { world, player, capital } = fixture({ day: 50 });
        MerchantPrince.rentWarehouse(player, world, world.getTile(5, 5), 'small');
        const w = MerchantPrince.warehouseAt(player, 5, 5);
        player.inventory.iron = 20;
        MerchantPrince.deposit(player, world, w.id, 'iron', 20);
        const iron = SettlementMarket.stock(capital, 'iron');
        player.gold = 0;
        for (let d = 0; d < 15; d++) { world.day++; MerchantPrince.processDay(player, world); }
        expect(MerchantPrince.state(player).warehouses).toHaveLength(0);
        expect(SettlementMarket.stock(capital, 'iron')).toBeCloseTo(iron + 20, 1);
    });
});

describe('forward contracts', () => {
    it('quotes from the town\'s real price curve, never above buying the lot back here', () => {
        const { world, player, capital } = fixture();
        const tile = world.getTile(5, 5);
        const q = MerchantPrince.forwardQuote(player, world, tile, 'grain', 50, 30);
        expect(q.ok).toBe(true);
        const spot = Trading.saleUnitPrice(player, GOODS().GRAIN, capital, world, 1, 50);
        expect(q.unitPrice).toBeGreaterThanOrEqual(Math.floor(spot * 100) / 100);
        expect(q.unitPrice).toBeLessThanOrEqual(Trading.saleUnitCap(player, 'grain', capital, world, tile, 50));
        // A scarcer town pays more for the same promise
        capital.market.stock.grain = SettlementMarket.target(capital, 'grain') * 0.3;
        expect(MerchantPrince.forwardQuote(player, world, tile, 'grain', 50, 30).unitPrice).toBeGreaterThan(q.unitPrice);
        // Only goods the town uses, and not more than its needs
        expect(MerchantPrince.forwardQuote(player, world, world.getTile(9, 5), 'gold_ore', 5, 30).ok).toBe(false);
        expect(MerchantPrince.forwardQuote(player, world, tile, 'grain', 1e6, 30).qty).toBe(q.maxQty);
    });

    it('fulfilled in parts: each delivery is paid at the fixed price and joins the town\'s stock', () => {
        const { world, player, capital } = fixture();
        const tile = world.getTile(5, 5);
        const r = MerchantPrince.signForward(player, world, tile, 'grain', 40, 20);
        expect(r.success).toBe(true);
        const f = r.contract;
        player.inventory.grain = 25;
        const gold = player.gold;
        const stock = SettlementMarket.stock(capital, 'grain');
        expect(MerchantPrince.deliverForward(player, world, f.id, 25).qty).toBe(25);
        expect(player.gold).toBe(gold + Math.floor(25 * f.unitPrice));
        expect(SettlementMarket.stock(capital, 'grain')).toBeCloseTo(stock + 25, 1);
        // The rest from the store-room
        MerchantPrince.rentWarehouse(player, world, tile, 'small');
        const w = MerchantPrince.warehouseAt(player, 5, 5);
        w.goods.grain = 30;
        const done = MerchantPrince.deliverForward(player, world, f.id, 99, 'warehouse');
        expect(done.qty).toBe(15);
        expect(done.done).toBe(true);
        expect(w.goods.grain).toBe(15);
        expect(MerchantPrince.state(player).stats.forwardsDone).toBe(1);
        expect(player.reputation.k1).toBe(11);
    });

    it('missed: a quarter of the undelivered value is forfeit and the name suffers', () => {
        const { world, player } = fixture();
        const tile = world.getTile(5, 5);
        const f = MerchantPrince.signForward(player, world, tile, 'grain', 40, 10).contract;
        world.day = f.dueDay - 3;
        Counsel.invalidate(player);
        expect(Counsel.scan(player, world, { fresh: true }).items.some(i => /Deliver 40 grain/.test(i.text))).toBe(true);
        world.day = f.dueDay + 1;
        const gold = player.gold;
        const out = MerchantPrince.processDay(player, world);
        expect(out.notices.some(n => /Broken/.test(n.title))).toBe(true);
        expect(gold - player.gold).toBe(Math.ceil(40 * f.unitPrice * 0.25));
        expect(player.reputation.k1).toBeLessThan(10);
        expect(MerchantPrince.state(player).forwards).toHaveLength(0);
    });
});

describe('fairs and market news', () => {
    it('a fair opens at the capital on its day: merchants\' stock lands, the stalls deal closer, and it closes', () => {
        const fair = MarketFairs.list()[0];
        const { world, player, capital, town } = fixture({ day: fair.day - 1 });
        // The heralds take their first look the day before (a first tick only takes a snapshot)
        Heralds.processDay(world, player);
        world.day = fair.day;
        const good = Object.keys(fair.goods).find(id => SettlementMarket.uses(capital, id));
        const before = SettlementMarket.stock(capital, good);
        const tile = world.getTile(5, 5);
        const g = GOODS()[good.toUpperCase()];
        const ask = Economy.marketAskBase(g, capital, tile, world);
        const sell = Trading.sellShare(capital);
        const out = MarketFairs.processDay(world, player);
        expect(out.opened.map(o => o.town)).toEqual(['Highmarket']);
        expect(SettlementMarket.fair(town)).toBe(null);
        expect(SettlementMarket.stock(capital, good)).toBeGreaterThan(before);
        expect(Economy.marketAskBase(g, capital, tile, world)).toBeLessThan(ask);
        expect(Trading.sellShare(capital)).toBeGreaterThan(sell);
        // Same-tile safety still holds: a sale never beats buying back here
        expect(Trading.saleUnitPrice(player, g, capital, world, 1, 1)).toBeLessThanOrEqual(Trading.saleUnitCap(player, good, capital, world, tile, 1));
        // The heralds cry it
        Heralds.processDay(world, player);
        expect(player.heralds.list.some(p => p.kind === 'market_fair' && /Highmarket/.test(p.text))).toBe(true);
        // The tavern and the counsel know of it
        expect(MarketFairs.fairsNear(world, 9, 5)[0].on).toBe(true);
        world.day = fair.day + fair.days;
        MarketFairs.processDay(world, player);
        expect(SettlementMarket.fair(capital)).toBe(null);
    });

    it('the week\'s worst dearth and a harvest glut go on record for the heralds', () => {
        const { world, player, capital, town } = fixture({ day: 77 });
        town.market.short.food = 0.6;
        town.market.stock.bread = 0;
        town.market.stock.grain = 1;
        capital.market.stock.grain = SettlementMarket.target(capital, 'grain') * 4;
        const out = MarketFairs.processDay(world, player);
        expect(out.news.map(h => h.kind).sort()).toEqual(['dearth', 'glut']);
        // ...and not again next week for the same towns
        world.day = 84;
        expect(MarketFairs.processDay(world, player).news).toHaveLength(0);
    });
});

describe('in the game: save, determinism, no money loop', () => {
    const quiet = () => {
        const a = vi.spyOn(console, 'log').mockImplementation(() => {});
        const b = vi.spyOn(console, 'warn').mockImplementation(() => {});
        return () => { a.mockRestore(); b.mockRestore(); };
    };

    /** A harness game with works, a store-room and a contract in the biggest town. */
    function setup(seed) {
        const game = newGame(seed);
        const { world, player } = game;
        const s = world.getSettlementViews().slice().sort((a, b) => b.population - a.population)[0];
        const tile = world.getTile(s.q, s.r);
        player.q = s.q; player.r = s.r;
        player.gold = 20000;
        player.inventory = { ...player.inventory, wood: 60, stone: 60, grain: 40 };
        expect(MerchantPrince.invest(player, world, tile, 'bakery').success).toBe(true);
        expect(MerchantPrince.invest(player, world, tile, 'brewery').success).toBe(true);
        expect(MerchantPrince.rentWarehouse(player, world, tile, 'small').success).toBe(true);
        const w = MerchantPrince.warehouseAt(player, s.q, s.r);
        MerchantPrince.buyInto(player, world, w.id, 'grain', 30);
        expect(MerchantPrince.signForward(player, world, tile, 'grain', 20, 40).success).toBe(true);
        return { game, s, tile };
    }
    const keep = (game) => { game.player.health = 100; game.player.inventory.bread = 40; game.player.starvationDays = 0; };

    it('works, store-rooms and contracts survive a save round trip and carry on identically', () => {
        const restore = quiet();
        try {
            const a = setup(101);
            for (let d = 0; d < 6; d++) { keep(a.game); endDay(a.game); }
            const b = roundTrip(a.game);
            expect(JSON.stringify(b.player.merchantPrince)).toBe(JSON.stringify(a.game.player.merchantPrince));
            const works = (g) => JSON.stringify(g.world.getTile(a.s.q, a.s.r).settlement.market.works);
            expect(works(b)).toBe(works(a.game));
            // ...and the loaded game carries on: the works pay on their market days
            const earned = MerchantPrince.state(b.player).stats.earned;
            for (let d = 0; d < 8; d++) { keep(b); endDay(b); }
            expect(MerchantPrince.state(b.player).stats.earned).toBeGreaterThan(earned);
            // An old save without the record loads clean
            const p = { merchantPrince: undefined };
            MerchantPrince.loadState(p);
            expect(p.merchantPrince).toBe(null);
            expect(MerchantPrince.processDay(p, a.game.world).notices).toEqual([]);
        } finally { restore(); }
    }, 120000);

    it('is deterministic: the same seed and the same moves give the same books', () => {
        const restore = quiet();
        try {
            const run = () => {
                const { game } = setup(202);
                for (let d = 0; d < 12; d++) { keep(game); endDay(game); }
                return [game.player.gold, JSON.stringify(game.player.merchantPrince)];
            };
            expect(run()).toEqual(run());
        } finally { restore(); }
    }, 120000);

    it('is no money loop: a store-room round trip loses, a forward bought here loses, works repay in weeks, not days', () => {
        const restore = quiet();
        try {
            const { game, s, tile } = setup(303);
            const { player, world } = game;
            const w = MerchantPrince.warehouseAt(player, s.q, s.r);
            // Buy into store and sell straight back: the curve and the 70% share eat it
            for (const id of ['grain', 'wood', 'tools', 'beer']) {
                const gold = player.gold;
                const got = MerchantPrince.buyInto(player, world, w.id, id, 20);
                if (!got.success) continue;
                MerchantPrince.sellFrom(player, world, w.id, id, got.qty);
                expect(player.gold, id).toBeLessThan(gold);
            }
            // Sign a forward and fill it at once with goods bought here: a loss
            for (const id of ['grain', 'bread', 'tools']) {
                const q = MerchantPrince.forwardQuote(player, world, tile, id, 20, 10);
                if (!q.ok) continue;
                const entry = Trading.getAvailableGoods(s, tile, world).find(g => g.id === id);
                if (!entry || entry.quantity < q.qty) continue;
                const cost = Trading.buyCost(player, entry, q.qty, s);
                expect(Math.floor(q.unitPrice * q.qty), id).toBeLessThan(cost);
            }
            // The works: three weeks of a great town's bakehouse and brewhouse repay well under the stake
            const invested = MerchantPrince.state(player).stats.invested;
            for (let d = 0; d < 21; d++) { keep(game); endDay(game); }
            const earned = MerchantPrince.state(player).stats.earned;
            expect(earned).toBeGreaterThan(0);
            expect(earned).toBeLessThan(invested * 0.75);
        } finally { restore(); }
    }, 120000);
});

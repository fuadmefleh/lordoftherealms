/**
 * Kingdom trade policy (systems/tradePolicy.js): tariffs on the NPC trade
 * between realms (revenue to the treasuries, dearer landed prices), export
 * bans in a famine, embargoes cutting the links, treaties waiving duties,
 * state granaries, NPC crowns choosing a policy and retaliating in trade
 * wars, the player's crown setting it, the player as a merchant (duties on
 * goods bought abroad, smuggling past embargoes and bans, licences, brokered
 * treaties), saving and backfill, determinism — and no money loop.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Underworld } from '../systems/underworld.js';
import { Councils } from '../systems/councils.js';
import { Heralds } from '../systems/heralds.js';
import { Counsel } from '../systems/counsel.js';
import { KingdomStability } from '../world/kingdomState.js';
import { Trading } from '../player/playerEconomy.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

let _saved = null;
function patch(path, value) {
    if (!_saved) _saved = JSON.parse(JSON.stringify(DataLoader._gamedata.tradePolicy));
    const d = JSON.parse(JSON.stringify(DataLoader._gamedata.tradePolicy));
    const keys = path.split('.');
    let o = d;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = value;
    DataLoader._gamedata.tradePolicy = d;
}
afterEach(() => {
    if (_saved) DataLoader._gamedata.tradePolicy = _saved;
    _saved = null;
    vi.restoreAllMocks();
});

const plains = (q, r, settlement = null, kingdom = null) => ({ q, r, kingdom, terrain: { id: 'plains', passable: true }, resource: null, settlement });

/**
 * Three realms: Aster (k1) with Highmarket at (5,5), Brenn (k2) with
 * Brindle at (9,5), Calder (k3) with Coldwater at (13,5); trade links
 * Highmarket–Brindle and Brindle–Coldwater (saved on the markets).
 */
function fixture(opts = {}) {
    const a = { name: 'Highmarket', type: 'city', population: 8000, happiness: 50, kingdom: 'k1', q: 5, r: 5 };
    const b = { name: 'Brindle', type: 'city', population: 8000, happiness: 50, kingdom: 'k2', q: 9, r: 5 };
    const c = { name: 'Coldwater', type: 'town', population: 3000, happiness: 50, kingdom: 'k3', q: 13, r: 5 };
    const tiles = new Map([['5,5', plains(5, 5, a, 'k1')], ['9,5', plains(9, 5, b, 'k2')], ['13,5', plains(13, 5, c, 'k3')]]);
    const realm = (id, name, traits, extra = {}) => ({
        id, name, isAlive: true, wars: [], allies: [], relations: {}, traits, culture: 'Plains', treasury: 5000,
        capital: null, finance: { debtRatio: 0, missed: 0 }, settlements: [], ...extra,
    });
    const kingdoms = [
        realm('k1', 'Aster', opts.t1 || ['peaceful']),
        realm('k2', 'Brenn', opts.t2 || ['peaceful']),
        realm('k3', 'Calder', opts.t3 || ['peaceful']),
    ];
    const world = {
        width: 40, height: 40, day: opts.day || 70, activeEvents: [], units: [], kingdoms, events: [],
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || plains(q, r),
        getSettlementViews: () => [a, b, c],
        getAllSettlements: () => [a, b, c],
    };
    for (const s of [a, b, c]) SettlementMarket.ensure(s);
    a.market.links = [[9, 5, 4, 0, 1, 0]];
    b.market.links = [[13, 5, 4, 0, 1, 0]];
    for (const s of [a, b, c]) s.market.linksAt = 2;
    const player = {
        name: 'Tester', q: 9, r: 5, gold: 5000, actionPoints: 5, maxInventory: 99,
        inventory: {}, skills: { commerce: 3, stealth: 1 }, reputation: { k1: 10, k2: 10, k3: 10 },
    };
    return { world, player, a, b, c, kingdoms, k1: kingdoms[0], k2: kingdoms[1], k3: kingdoms[2] };
}

/** A trade link between two towns, laid out as MarketDynamics draws them. */
function link(a, b) {
    return {
        a, b, dist: 4, sea: false, road: true, routes: 0, friction: 0.08, base: 100000, capacity: 100000, factor: 1,
        dutyAB: null, dutyBA: null, impAB: 1, impBA: 1, paidAB: 0, paidBA: 0, _tp: null, _tpA: null, _tpB: null, _tpF: 1,
    };
}

/** Glut of `good` in a, dearth in b. */
function gap(a, b, good) {
    a.market.stock[good] = SettlementMarket.target(a, good) * 3;
    b.market.stock[good] = SettlementMarket.target(b, good) * 0.2;
}

/** Advance `world.day` to the next day that is `k`'s turn (and, with council, its trade council's). */
/** A day of the harness with the player kept fed (the harness stops the day for a dead player). */
function liveDay(game) {
    const p = game.player;
    p.health = p.maxHealth || 100;
    p.starvationDays = 0;
    p.inventory = p.inventory || {};
    p.inventory.bread = 30;
    endDay(game);
}

function toTurn(world, k, council = true) {
    for (let i = 0; i < 60; i++) {
        if (TradePolicy.isTurn(world, k) && (!council || TradePolicy.isCouncil(world, k))) return world.day;
        world.day++;
    }
    throw new Error('no turn');
}

/** NPC trade along one link for a day, the duties banked. */
function trade(world, l) {
    const ka = world.getKingdom(l.a.kingdom), kb = world.getKingdom(l.b.kingdom);
    l.factor = TradePolicy.linkFactor(world, l, ka, kb);
    const bases = {};
    SettlementMarket.config().goodIds.forEach((id, i) => { bases[id] = SettlementMarket._bases()[i]; });
    const flow = SettlementMarket.flows([l], bases, null);
    flow.duties = TradePolicy.collect(world, [l]);
    return flow;
}

describe('tariffs on the trade between realms', () => {
    it('a tariff thins the flow, keeps the importer dearer and pays the treasuries', () => {
        const free = fixture();
        const taxed = fixture();
        for (const f of [free, taxed]) gap(f.a, f.b, 'tools');
        TradePolicy.realm(taxed.k2).imp.wares = 0.3;
        TradePolicy._bump(taxed.world);
        const t0 = taxed.k2.treasury;
        const ff = trade(free.world, link(free.a, free.b));
        const ft = trade(taxed.world, link(taxed.a, taxed.b));
        expect(ff.moved).toBeGreaterThan(0);
        expect(ft.moved).toBeLessThan(ff.moved);
        // The importer's stock stays thinner: its price higher
        expect(SettlementMarket.stock(taxed.b, 'tools')).toBeLessThan(SettlementMarket.stock(free.b, 'tools'));
        expect(SettlementMarket.scarcity(taxed.b, 'tools')).toBeGreaterThan(SettlementMarket.scarcity(free.b, 'tools'));
        // ...and the duty on what crossed goes to the importer's treasury
        expect(ft.duties).toBeGreaterThan(0);
        expect(taxed.k2.treasury).toBeGreaterThan(t0);
        expect(TradePolicy.realm(taxed.k2).rev.week).toBeGreaterThan(0);
        expect(free.k2.treasury).toBe(5000);
    });

    it('trade inside one realm pays no duty', () => {
        const f = fixture();
        f.b.kingdom = 'k1';
        TradePolicy.realm(f.k1).imp.wares = 0.3;
        const l = link(f.a, f.b);
        expect(TradePolicy.linkFactor(f.world, l, f.k1, f.k1)).toBe(1);
        expect(l.dutyAB).toBe(null);
    });

    it('a caravan pays the realm\'s import duty as its toll, waived by a treaty', () => {
        const f = fixture();
        TradePolicy.realm(f.k2).imp.wares = 0.2;
        expect(TradePolicy.tollRate(f.world, 'k2', 'k1', 'tools', 0.03)).toBeCloseTo(0.2, 5);
        // Never under the customary rate
        expect(TradePolicy.tollRate(f.world, 'k2', 'k1', 'grain', 0.03)).toBeCloseTo(0.03, 5);
        TradePolicy._sign(f.world, f.k1, f.k2);
        expect(TradePolicy.tollRate(f.world, 'k2', 'k1', 'tools', 0.03)).toBe(0);
        // The caravan code reads it at the border
        const u = { kingdomId: 'k3', mainGood: 'tools', value: 1000, purse: 500, tolls: [], cargo: {} };
        const st = { stats: { tolls: 0 } };
        const paid = MerchantCaravans._toll(f.world, st, u, 'k2');
        expect(paid).toBe(200);
        expect(TradePolicy.realm(f.k2).rev.tolls).toBe(200);
    });
});

describe('export bans, embargoes and treaties', () => {
    it('a realm in famine bans the export of grain, and none leaves', () => {
        const f = fixture();
        f.world.activeEvents = [{ id: 'famine', kingdomId: 'k1', effects: {}, daysLeft: 30 }];
        toTurn(f.world, f.k1, false);
        TradePolicy.processDay(f.world, null);
        expect(TradePolicy.banned(f.k1, 'staples')).toBe(true);
        expect(TradePolicy.recent(f.world).some(h => h.kind === 'ban' && h.kingdomId === 'k1')).toBe(true);
        gap(f.a, f.b, 'grain');
        const before = SettlementMarket.stock(f.a, 'grain');
        trade(f.world, link(f.a, f.b));
        expect(SettlementMarket.stock(f.a, 'grain')).toBe(before);
        // ...lifted once the realm is fed (after minDays)
        f.world.activeEvents = [];
        for (let i = 0; i < 40; i++) { f.world.day++; TradePolicy.processDay(f.world, null); }
        expect(TradePolicy.banned(f.k1, 'staples')).toBe(false);
    });

    it('war embargoes the enemy: the links between them are cut', () => {
        const f = fixture();
        f.k1.wars = ['k2'];
        f.k2.wars = ['k1'];
        toTurn(f.world, f.k1, false);
        TradePolicy.processDay(f.world, null);
        expect(TradePolicy.embargoed(f.k1, f.k2)).toBe(true);
        const l = link(f.a, f.b);
        expect(TradePolicy.linkFactor(f.world, l, f.k1, f.k2)).toBe(0);
        // A bitter rival is embargoed too (on a roll), and its relations sour
        const g = fixture();
        g.k1.relations.k2 = -90;
        patch('embargo.chance', 1);
        toTurn(g.world, g.k1, true);
        TradePolicy.processDay(g.world, null);
        expect(TradePolicy.embargoed(g.k1, g.k2)).toBe(true);
        expect(g.k2.relations.k1).toBeLessThan(0);
        expect(TradePolicy.recent(g.world).some(h => h.kind === 'embargo' && h.why === 'rival')).toBe(true);
    });

    it('friends sign a treaty: duties waived, more trade, warmer relations', () => {
        const f = fixture();
        f.k1.relations.k2 = 60;
        f.k2.relations.k1 = 60;
        TradePolicy.realm(f.k2).imp.wares = 0.3;
        patch('treaty.chance', 1);
        toTurn(f.world, f.k1, true);
        TradePolicy.processDay(f.world, null);
        expect(TradePolicy.hasTreaty(f.k1, f.k2)).toBe(true);
        const l = link(f.a, f.b);
        expect(TradePolicy.linkFactor(f.world, l, f.k1, f.k2)).toBeGreaterThan(1);
        expect(l.dutyAB).toBe(null);
        expect(TradePolicy.duty(f.k1, f.k2, 'wares').total).toBe(0);
        // Relations warm week by week (to the cap)
        const r0 = f.k1.relations.k2;
        f.world.day++;
        toTurn(f.world, f.k1, false);
        TradePolicy.processDay(f.world, null);
        expect(f.k1.relations.k2).toBeGreaterThanOrEqual(r0);
        // ...and the realm is steadier for it
        expect(TradePolicy.realm(f.k1).stab).toBeGreaterThan(0);
        expect(KingdomStability.target(f.k1, f.world).parts.some(p => p.label === 'Trade policy')).toBe(true);
        // War breaks it
        f.k1.wars = ['k2'];
        f.world.day++;
        toTurn(f.world, f.k1, false);
        TradePolicy.processDay(f.world, null);
        expect(TradePolicy.hasTreaty(f.k1, f.k2)).toBe(false);
    });
});

describe('the state granary', () => {
    it('buys grain in glut and releases it to hungry towns, paid from the treasury', () => {
        const f = fixture();
        f.k1.treasury = 20000;
        f.a.market.stock.grain = SettlementMarket.target(f.a, 'grain') * 4;
        f.a.market.trend.grain = 4;
        toTurn(f.world, f.k1, true);
        const s0 = SettlementMarket.stock(f.a, 'grain');
        TradePolicy.processDay(f.world, null);
        const g = TradePolicy.realm(f.k1).granary;
        expect(g.on).toBe(true);
        expect(g.grain).toBeGreaterThan(0);
        expect(SettlementMarket.stock(f.a, 'grain')).toBeLessThan(s0);
        expect(f.k1.treasury).toBeLessThan(20000);
        expect(g.spent).toBeGreaterThan(0);
        // A famine: the stores go out to the hungry town
        f.world.activeEvents = [{ id: 'famine', kingdomId: 'k1', effects: {}, daysLeft: 30 }];
        f.a.economy = f.a.economy || { food: 0, gold: 0 };
        const food0 = f.a.economy.food || 0;
        const held = g.grain;
        f.world.day++;
        toTurn(f.world, f.k1, false);
        TradePolicy.processDay(f.world, null);
        expect(g.grain).toBeLessThan(held);
        expect(g.released).toBeGreaterThan(0);
        expect(f.a.economy.food).toBeGreaterThan(food0);
    });
});

describe('NPC crowns', () => {
    it('lean to free trade or mercantilism by personality and culture', () => {
        const f = fixture({ t1: ['mercantile'], t2: ['aggressive'] });
        f.k2.culture = 'Imperial';
        expect(TradePolicy.protectionism(f.k2, 0)).toBeGreaterThan(TradePolicy.protectionism(f.k1, 0) + 0.3);
        expect(TradePolicy.naturalStance(f.k2, 0)).toBe('mercantilist');
        f.k1.culture = 'Maritime';
        expect(TradePolicy.naturalStance(f.k1, 0)).toBe('free_trade');
        // A mercantilist crown sets higher duties than a free-trading one
        toTurn(f.world, f.k1, true);
        TradePolicy._setTariffs(f.world, f.k1, TradePolicy.realm(f.k1), [], f.world.day);
        TradePolicy._setTariffs(f.world, f.k2, TradePolicy.realm(f.k2), [], f.world.day);
        expect(TradePolicy.avgImport(f.k2)).toBeGreaterThan(TradePolicy.avgImport(f.k1));
    });

    it('raise duties in a treasury crisis, and the guilds lobby for their goods', () => {
        const f = fixture();
        const p = TradePolicy.realm(f.k1);
        TradePolicy._setTariffs(f.world, f.k1, p, [], f.world.day);
        const calm = TradePolicy.avgImport(f.k1);
        f.k1.treasury = 0;
        TradePolicy._setTariffs(f.world, f.k1, p, [], f.world.day);
        expect(p.crisis).toBe(true);
        expect(TradePolicy.avgImport(f.k1)).toBeGreaterThan(calm);
        f.k1.treasury = 5000;
        TradePolicy._setTariffs(f.world, f.k1, p, [], f.world.day);
        const bare = p.imp.staples;
        f.a.guilds = { bakers: {}, millers: {} };
        TradePolicy._setTariffs(f.world, f.k1, p, [{ q: 5, r: 5, settlement: f.a }], f.world.day);
        expect(p.lobby.staples).toBeGreaterThan(0);
        expect(p.imp.staples).toBeGreaterThan(bare);
    });

    it('answer a partner\'s higher duties with their own: a trade war', () => {
        const f = fixture({ t1: ['balanced'] });
        TradePolicy.realm(f.k1);
        const p2 = TradePolicy.realm(f.k2);
        for (const c of TradePolicy.config().catIds) p2.imp[c] = 0.3;
        patch('tradeWar.chance', 1);
        toTurn(f.world, f.k1, true);
        TradePolicy.processDay(f.world, null);
        const p1 = TradePolicy.realm(f.k1);
        expect(p1.retal.k2).toBeGreaterThan(0);
        expect(p1.wars.k2).toBeTruthy();
        expect(f.k1.relations.k2).toBeLessThan(0);
        expect(TradePolicy.recent(f.world).some(h => h.kind === 'trade_war' && h.kingdomId === 'k1')).toBe(true);
        // The heralds cry it
        const player = { q: 5, r: 5 };
        Heralds.processDay(f.world, player);
        f.world.day++;
        TradePolicy._record(f.world, 'trade_war', { kingdomId: 'k1', kingdom: 'Aster', other: 'k2', otherName: 'Brenn' });
        Heralds.processDay(f.world, player);
        expect(Heralds.state(player).list.some(x => x.kind === 'trade_war')).toBe(true);
    });
});

describe('the player\'s crown', () => {
    function rule(f) {
        f.player.throne = { ruling: { kingdomId: 'k1', since: 0 } };
        return f;
    }

    it('sets duties and bans, with the Guild Coalition watching', () => {
        const f = rule(fixture());
        const st = Councils._ensureState(f.player);
        const m0 = st.factions.merchants.support;
        const res = TradePolicy.setTariff(f.player, f.world, 'imp', 'luxury', 0.25);
        expect(res.success).toBe(true);
        expect(TradePolicy.realm(f.k1).imp.luxury).toBe(0.25);
        expect(st.factions.merchants.support).toBeLessThan(m0);
        expect(TradePolicy.toggleBan(f.player, f.world, 'raw').success).toBe(true);
        expect(TradePolicy.banned(f.k1, 'raw')).toBe(true);
        // The crown's settings stand on its turns (an NPC turn would reset them)
        toTurn(f.world, f.k1, true);
        TradePolicy.processDay(f.world, f.player);
        expect(TradePolicy.realm(f.k1).imp.luxury).toBe(0.25);
        // Not a ruler: no say
        expect(TradePolicy.setTariff({}, f.world, 'imp', 'raw', 0.1).success).toBe(false);
    });

    it('lays embargoes and signs treaties; the neighbours answer high duties', () => {
        const f = rule(fixture());
        expect(TradePolicy.setEmbargo(f.player, f.world, 'k3', true).success).toBe(true);
        expect(TradePolicy.embargoed(f.k1, f.k3)).toBe(true);
        expect(f.k3.relations.k1).toBeLessThan(0);
        expect(TradePolicy.setEmbargo(f.player, f.world, 'k3', false).success).toBe(true);
        // A treaty needs a willing partner
        expect(TradePolicy.proposeTreaty(f.player, f.world, 'k2').success).toBe(false);
        f.k2.relations.k1 = 60;
        expect(TradePolicy.proposeTreaty(f.player, f.world, 'k2').success).toBe(true);
        expect(TradePolicy.hasTreaty(f.k1, f.k2)).toBe(true);
        expect(TradePolicy.cancelTreaty(f.player, f.world, 'k2').success).toBe(true);
        // Heavy duties on Brenn's goods: Brenn retaliates on its council turn, and the player hears of it
        for (const c of TradePolicy.config().catIds) TradePolicy.setTariff(f.player, f.world, 'imp', c, 0.25);
        patch('tradeWar.chance', 1);
        toTurn(f.world, f.k2, true);
        const out = TradePolicy.processDay(f.world, f.player);
        expect(TradePolicy.realm(f.k2).retal.k1).toBeGreaterThan(0);
        expect(out.notices.some(n => n.title === 'Retaliatory Tariffs')).toBe(true);
        // ...and the Steward says so
        Counsel.invalidate(f.player);
        const scan = Counsel.scan(f.player, f.world);
        expect([...scan.threats, ...scan.opportunities].some(i => i.rule === 'trade_against_realm')).toBe(true);
    });
});

describe('the player as a merchant', () => {
    it('goods bought abroad pay the import duty where they are sold', () => {
        const f = fixture();
        TradePolicy.realm(f.k2).imp.wares = 0.2;
        f.player.inventory.tools = 10;
        TradePolicy.onBuy(f.player, f.a, 'tools', 10);
        const check = TradePolicy.saleCheck(f.player, f.world, f.b, 'tools', 5);
        expect(check.ok).toBe(true);
        expect(check.rate).toBeCloseTo(0.2, 5);
        const t0 = f.k2.treasury;
        const res = Trading.sellGoods(f.player, 'tools', 5, f.b, f.world);
        expect(res.success).toBe(true);
        expect(res.duty).toBeGreaterThan(0);
        expect(f.k2.treasury).toBe(t0 + res.duty);
        // The player's books show it, inside the sale price (systems/ledger.js)
        expect(f.player.financeToday.income.saleDuties).toBe(-res.duty);
        // The ledger draws down with the sale
        expect(TradePolicy.playerState(f.player).ledger.tools.k1).toBeCloseTo(5, 1);
        // Home-bought goods pay nothing at home
        const g = fixture();
        g.player.inventory.tools = 5;
        TradePolicy.onBuy(g.player, g.b, 'tools', 5);
        TradePolicy.realm(g.k2).imp.wares = 0.2;
        expect(TradePolicy.saleCheck(g.player, g.world, g.b, 'tools', 5).rate).toBe(0);
    });

    it('can\'t sell embargoed goods openly, but can smuggle them — with heat', () => {
        const f = fixture();
        TradePolicy._embargo(f.world, f.k2, f.k1, 'rival');
        f.player.inventory.tools = 6;
        TradePolicy.onBuy(f.player, f.a, 'tools', 6);
        const res = Trading.sellGoods(f.player, 'tools', 3, f.b, f.world);
        expect(res.success).toBe(false);
        expect(res.reason).toMatch(/embargo/);
        const tile = f.world.getTile(9, 5);
        const q = TradePolicy.smuggleQuote(f.player, f.world, tile, 'tools');
        expect(q.ok).toBe(true);
        expect(q.units).toBe(6);
        Utils.setSeed(7);
        const gold0 = f.player.gold;
        const run = TradePolicy.smuggle(f.player, f.world, tile, 'tools', 3);
        expect(run.success).toBe(true);
        expect(Underworld.getHeat(f.player, 'k2')).toBeGreaterThan(0);
        expect(f.player.inventory.tools).toBe(3);
        if (run.caught) expect(f.player.gold).toBeLessThanOrEqual(gold0);
        else expect(f.player.gold).toBe(gold0 + run.earned);
        // ...and the Steward warns of the rest
        Counsel.invalidate(f.player);
        const scan = Counsel.scan(f.player, f.world);
        expect(scan.threats.some(i => i.rule === 'trade_embargoed')).toBe(true);
    });

    it('selling abroad goods whose export the origin crown bans breaks its ban: heat there', () => {
        const f = fixture();
        TradePolicy.realm(f.k1).bans.staples = { since: 0, why: 'famine' };
        f.player.inventory.grain = 20;
        TradePolicy.onBuy(f.player, f.a, 'grain', 20);
        const res = Trading.sellGoods(f.player, 'grain', 10, f.b, f.world);
        expect(res.success).toBe(true);
        expect(res.breachHeat).toBeGreaterThan(0);
        expect(Underworld.getHeat(f.player, 'k1')).toBeGreaterThan(0);
        expect(TradePolicy.playerState(f.player).stats.breaches).toBe(1);
    });

    it('a licence from the crown waives its duties and bans, for a fee into its treasury', () => {
        const f = fixture();
        TradePolicy.realm(f.k2).imp.wares = 0.2;
        const q = TradePolicy.licenceQuote(f.player, f.world, 'k2');
        expect(q.ok).toBe(true);
        const t0 = f.k2.treasury, g0 = f.player.gold;
        const res = TradePolicy.petitionLicence(f.player, f.world, 'k2');
        expect(res.success).toBe(true);
        expect(f.player.gold).toBe(g0 - q.cost);
        expect(f.k2.treasury).toBe(t0 + q.cost);
        expect(f.player.financeToday.expenses.tariffs).toBe(q.cost);
        f.player.inventory.tools = 4;
        TradePolicy.onBuy(f.player, f.a, 'tools', 4);
        expect(TradePolicy.saleCheck(f.player, f.world, f.b, 'tools', 4).rate).toBe(0);
        // A disgraced name gets no hearing
        f.player.reputation.k3 = -50;
        expect(TradePolicy.licenceQuote(f.player, f.world, 'k3').ok).toBe(false);
        // ...and it lapses
        f.world.day += q.days + 1;
        expect(TradePolicy.hasLicence(f.player, f.world, 'k2')).toBe(false);
    });

    it('brokers a treaty between two realms for prestige', () => {
        const f = fixture();
        f.k1.relations.k3 = 20;
        f.k3.relations.k1 = 20;
        f.player.house = { prestige: 0, log: [], lastNotableDay: 0 };
        const q = TradePolicy.brokerQuote(f.player, f.world, 'k1', 'k3');
        expect(q.ok).toBe(true);
        const res = TradePolicy.brokerTreaty(f.player, f.world, 'k1', 'k3');
        expect(res.success).toBe(true);
        expect(TradePolicy.hasTreaty(f.k1, f.k3)).toBe(true);
        expect(f.player.house.prestige).toBeGreaterThan(0);
        expect(f.player.reputation.k1).toBeGreaterThan(10);
        expect(f.k1.relations.k3).toBeGreaterThan(20);
        // Cold realms won't sit at one table
        f.k2.relations.k3 = -30;
        expect(TradePolicy.brokerQuote(f.player, f.world, 'k2', 'k3').ok).toBe(false);
    });

    it('a supply contract delivered from abroad pays the town\'s import duty, as a sale would; embargoed goods are refused', () => {
        const f = fixture();
        TradePolicy.realm(f.k2).imp.wares = 0.2;
        const company = { name: 'Ash & Co', capital: 0, ledger: [], stats: {}, contracts: [], posts: [], convoys: [], flows: {}, pnl: { income: {}, expenses: {} }, week: {} };
        f.player.merchant = { company };
        vi.spyOn(MerchantHouses, 'contractUnitPay').mockReturnValue(10);
        const contract = () => ({ id: `ctr${Utils.randInt(1, 1e9)}`, status: 'accepted', good: 'tools', qty: 40, delivered: 0, q: 9, r: 5, town: 'Brindle', kingdomId: 'k2', reputation: 1 });
        // By hand, from the packs: bought in Aster (k1), delivered in Brindle (k2)
        const c1 = contract();
        company.contracts.push(c1);
        f.player.inventory.tools = 10;
        TradePolicy.onBuy(f.player, f.a, 'tools', 10);
        const t0 = f.k2.treasury;
        const res = MerchantHouses.deliverContract(f.player, f.world, c1.id, 'inventory');
        expect(res.success).toBe(true);
        expect(res.delivered).toBe(10);
        expect(company.capital).toBeCloseTo(10 * 10 * 0.8, 5);
        expect(f.k2.treasury - t0).toBe(20);
        expect(TradePolicy.playerState(f.player).ledger.tools).toBeUndefined();
        // From a post's warehouse: its own bookings
        const c2 = contract();
        company.contracts.push(c2);
        const post = { id: 'post1', name: 'Brindle', q: 9, r: 5, stock: { tools: 10 }, lots: { tools: { k1: 5 } }, orders: [] };
        company.posts.push(post);
        const cap0 = company.capital;
        expect(MerchantHouses.deliverContract(f.player, f.world, c2.id, 'post').success).toBe(true);
        // half of it booked abroad: a 10% duty on the lot
        expect(company.capital - cap0).toBeCloseTo(100 * 0.9, 5);
        expect(post.lots.tools).toBeUndefined();
        // A convoy's goods from a realm under embargo there are refused (and sold off elsewhere by the caller)
        TradePolicy._embargo(f.world, f.k2, f.k1, 'rival');
        const c3 = contract();
        const out = { notices: [] };
        expect(MerchantHouses._deliver(f.player, f.world, c3, 6, 'by caravan', out, { lots: { tools: { k1: 6 } }, held: 6 })).toBe(0);
        expect(c3.delivered).toBe(0);
        expect(out.reason).toMatch(/embargo/);
        // Home-bought (or unbooked) goods pay nothing
        const c4 = contract();
        const cap1 = company.capital;
        expect(MerchantHouses._deliver(f.player, f.world, c4, 6, 'by caravan', out, { lots: {}, held: 6 })).toBe(6);
        expect(company.capital - cap1).toBe(60);
    });

    it('is no money loop: buying and selling back in one town never profits from the duty book', () => {
        const f = fixture();
        f.player.q = 5;
        const tile = f.world.getTile(5, 5);
        const gold0 = f.player.gold;
        for (let i = 0; i < 5; i++) {
            const goods = Trading.getAvailableGoods(f.a, tile, f.world);
            const tools = goods.find(g => g.id === 'tools');
            if (!tools || tools.quantity < 2) break;
            const buy = Trading.buyGoods(f.player, tools, 2, f.a);
            expect(buy.success).toBe(true);
            const sell = Trading.sellGoods(f.player, 'tools', 2, f.a, f.world);
            expect(sell.success).toBe(true);
        }
        expect(f.player.gold).toBeLessThanOrEqual(gold0);
        // The crowns' revenue never reaches the player's purse
        TradePolicy.realm(f.k2).imp.wares = 0.3;
        gap(f.a, f.b, 'tools');
        trade(f.world, link(f.a, f.b));
        expect(f.player.gold).toBeLessThanOrEqual(gold0);
    });
});

describe('saving and determinism', () => {
    it('round-trips realm policies, the news and the player\'s book; older saves are backfilled', () => {
        let game = newGame(4242);
        for (let i = 0; i < 30; i++) liveDay(game);
        const k = game.world.kingdoms.find(x => x.isAlive !== false && x.tradePolicy);
        expect(k).toBeTruthy();
        TradePolicy.realm(k).embargo.someone = { since: 3, why: 'rival' };
        game.player.tradePolicy = { ledger: { tools: { [k.id]: 3 } }, licences: { [k.id]: 999 }, stats: { duties: 7 } };
        const back = roundTrip(game);
        const k2 = back.world.getKingdom(k.id);
        expect(k2.tradePolicy.stance).toBe(k.tradePolicy.stance);
        expect(k2.tradePolicy.imp).toEqual(k.tradePolicy.imp);
        expect(k2.tradePolicy.embargo.someone).toEqual({ since: 3, why: 'rival' });
        expect(back.world.tradePolicy.history.length).toBe(game.world.tradePolicy.history.length);
        expect(back.player.tradePolicy.ledger.tools[k.id]).toBe(3);
        expect(back.player.tradePolicy.stats.duties).toBe(7);
        // An older save: no policy anywhere — the game carries on and the realms set theirs
        for (const kk of back.world.kingdoms) delete kk.tradePolicy;
        delete back.world.tradePolicy;
        delete back.player.tradePolicy;
        TradePolicy.restore(undefined, back.world);
        TradePolicy.loadPlayer(back.player);
        game = back;
        for (let i = 0; i < 10; i++) liveDay(game);
        expect(game.world.kingdoms.some(x => x.isAlive !== false && x.tradePolicy && x.tradePolicy.lastTurn != null)).toBe(true);
    }, 120000);

    it('is deterministic: two runs of one seed agree, and no RNG is drawn by the crowns', () => {
        const run = () => {
            const game = newGame(777);
            for (let i = 0; i < 45; i++) liveDay(game);
            return JSON.stringify({
                realms: game.world.kingdoms.map(k => k.tradePolicy || null),
                news: game.world.tradePolicy.history,
                treasuries: game.world.kingdoms.map(k => Math.round(k.treasury)),
            });
        };
        expect(run()).toBe(run());
        const f = fixture();
        toTurn(f.world, f.k1, true);
        Utils.setSeed(99);
        const before = Utils.random();
        Utils.setSeed(99);
        TradePolicy.processDay(f.world, null);
        expect(Utils.random()).toBe(before);
    }, 120000);
});

describe('the panels', () => {
    it('render every tab and route their buttons', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const f = fixture();
        f.player.throne = { ruling: { kingdomId: 'k1', since: 0 } };
        TradePolicy._embargo(f.world, f.k2, f.k1, 'rival');
        f.player.inventory.tools = 4;
        TradePolicy.onBuy(f.player, f.a, 'tools', 4);
        const shown = [];
        const game = {
            player: f.player, world: f.world,
            ui: { showCustomPanel: (title, html) => shown.push(html), showNotification: () => {}, updateStats: () => {} },
        };
        ActionMenu.showTradePolicy(game, 'here');
        expect(shown.pop()).toMatch(/under embargo here/);
        ActionMenu.showTradePolicy(game, 'realms');
        expect(shown.pop()).toMatch(/Brenn/);
        ActionMenu.showTradePolicy(game, 'crown');
        expect(shown.pop()).toMatch(/royal granaries/);
        ActionMenu.tradePolicyAct(game, 'tariff', 'imp', 'luxury', 0.15);
        expect(TradePolicy.realm(f.k1).imp.luxury).toBe(0.15);
    });
});

/**
 * Economy leftovers: a caravan's trade income is earned on arrival (lost with
 * a robbed cargo, the seizer's when seized); leather — the tannery recipe, the
 * market good, the player's tannery and a 'tannery' works; holdings' own
 * bandit raids loot the market and damage the merchant-prince works there.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { Holdings } from '../systems/holdings.js';
import { Relationships } from '../systems/relationships.js';
import { House } from '../systems/house.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { loadData } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

let _saved = null;
function tune(fn) {
    const d = DataLoader._gamedata.merchantCaravans;
    if (!_saved) _saved = JSON.parse(JSON.stringify(d));
    fn(d);
}
afterEach(() => {
    if (_saved) DataLoader._gamedata.merchantCaravans = _saved;
    _saved = null;
    Utils.resetRng();
    vi.restoreAllMocks();
});

const basePrices = () => Object.fromEntries(SettlementMarket.config().goodIds.map(id => [id, PlayerEconomy.GOODS[id.toUpperCase()].basePrice]));
const income = (s) => (s.economy && s.economy.tradeIncome) || 0;

/** Glut at (3,5) and Dearth at (13,5) on a road; east of q=8 is realm k2 unless oneRealm. */
function strip(opts = {}) {
    const W = 30, H = 12;
    const kingdoms = [
        { id: 'k1', name: 'Westmark', isAlive: true, wars: [], treasury: 1000 },
        { id: 'k2', name: 'Eastreach', isAlive: true, wars: [], treasury: 1000 },
    ];
    const realmOf = (q) => (opts.oneRealm || q < 8 ? 'k1' : 'k2');
    const a = { name: 'Glut', type: 'town', population: 2000, kingdom: 'k1', economy: { gold: 0 } };
    const b = { name: 'Dearth', type: 'town', population: 2000, kingdom: realmOf(13), economy: { gold: 0 } };
    SettlementMarket.ensure(a);
    SettlementMarket.ensure(b);
    a.market.stock.grain = SettlementMarket.target(a, 'grain') * 4;
    b.market.stock.grain = SettlementMarket.target(b, 'grain') * 0.1;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            row.push({ q, r, terrain: { id: 'plains', passable: true, moveCost: 1 }, regionId: 1, kingdom: realmOf(q), hasRoad: r === 5 && q >= 3 && q <= 13 });
        }
        tiles.push(row);
    }
    tiles[5][3].settlement = a;
    tiles[5][13].settlement = b;
    a.q = 3; a.r = 5; b.q = 13; b.r = 5;
    const world = {
        width: W, height: H, day: 40, tiles, units: [], events: [], activeEvents: [], kingdoms,
        generationParams: { seed: 4242 },
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => (r >= 0 && r < H ? tiles[r][((q % W) + W) % W] : null),
        getSettlementViews: () => [a, b],
    };
    const link = { a, b, dist: 10, sea: false, road: true, routes: 1, friction: 0.1, base: 200, capacity: 200, factor: 1 };
    return { world, a, b, link, kingdoms };
}

function marketTurn(g, embody = true) {
    if (embody) MerchantCaravans.selectLinks(g.world, [g.link], null, g.world.day);
    const bases = basePrices();
    const flow = SettlementMarket.flows([g.link], bases);
    MerchantCaravans.dispatch(g.world, [g.link], bases, g.world.day, null);
    return flow;
}

function days(g, n) {
    for (let i = 0; i < n; i++) {
        g.world.day++;
        MerchantCaravans.processDay(g.world, null);
    }
}

describe('caravan trade income is earned on arrival', () => {
    it('neither town banks the margin while the cargo is on the road; both bank half when it arrives', () => {
        const g = strip({ oneRealm: true });
        const flow = marketTurn(g);
        const [u] = MerchantCaravans.traders(g.world);
        expect(u).toBeTruthy();
        expect(u.margin).toBeGreaterThan(0);
        expect(u.margin).toBeCloseTo(flow.gold, 1);
        expect(income(g.a)).toBe(0);
        expect(income(g.b)).toBe(0);
        days(g, 6);
        expect(u.arrived).toBe(true);
        expect(income(g.a)).toBeCloseTo(flow.gold / 2, 1);
        expect(income(g.b)).toBeCloseTo(flow.gold / 2, 1);
        expect(MerchantCaravans.state(g.world).stats.marginPaid).toBeCloseTo(flow.gold, 1);
    });

    it('a robbed cargo earns neither town anything', () => {
        const g = strip({ oneRealm: true });
        const flow = marketTurn(g);
        g.world.units.push({ type: 'raider', name: 'Red Hand', q: 8, r: 4, strength: 1e7, inventory: {}, destroyed: false });
        days(g, 6);
        const st = MerchantCaravans.state(g.world);
        expect(st.stats.taken).toBe(1);
        expect(income(g.a)).toBe(0);
        expect(income(g.b)).toBe(0);
        expect(st.stats.marginLost).toBeCloseTo(flow.gold, 1);
    });

    it('a seized cargo earns the seizing realm\'s nearest market the whole margin, the other town nothing', () => {
        tune(d => { d.ambush.warSeize = 1; });
        const g = strip();
        g.kingdoms[0].wars = ['k2']; g.kingdoms[1].wars = ['k1'];
        const flow = marketTurn(g);
        const [u] = MerchantCaravans.traders(g.world);
        days(g, 6);
        const st = MerchantCaravans.state(g.world);
        expect(st.stats.seized).toBe(1);
        expect(st.stats.marginPaid).toBe(0);
        expect(st.stats.marginSeized).toBeCloseTo(flow.gold, 1);
        // Seized in Westmark's land, so Westmark's nearest market (Glut) sold the goods
        const seizer = u.q < 8 ? g.a : g.b;
        const other = seizer === g.a ? g.b : g.a;
        expect(income(seizer)).toBeCloseTo(flow.gold, 1);
        expect(income(other)).toBe(0);
    });

    it('unembodied flows and lots that land at once still credit both towns at once', () => {
        const g = strip({ oneRealm: true });
        const flow = marketTurn(g, false);
        expect(flow.gold).toBeGreaterThan(0);
        expect(income(g.a) + income(g.b)).toBeCloseTo(flow.gold, 1);
        tune(d => { d.spawn.minValue = 1e9; });
        const g2 = strip({ oneRealm: true });
        const flow2 = marketTurn(g2);
        expect(MerchantCaravans.traders(g2.world).length).toBe(0);
        expect(income(g2.a)).toBeCloseTo(flow2.gold / 2, 1);
        expect(income(g2.b)).toBeCloseTo(flow2.gold / 2, 1);
    });

    it('the margin survives a save (it rides on the unit)', () => {
        const g = strip({ oneRealm: true });
        marketTurn(g);
        const [u] = MerchantCaravans.traders(g.world);
        const copy = JSON.parse(JSON.stringify(u));
        expect(copy.margin).toBe(u.margin);
    });
});

describe('leather', () => {
    it('is a market good, made from hides by the town tannery', () => {
        const C = SettlementMarket.config();
        expect(C.goodIds).toContain('leather');
        expect(C.goodIds).toContain('hide');
        expect(PlayerEconomy.GOODS.LEATHER.id).toBe('leather');
        expect(SettlementMarket.recipeGoods('tannery', 'in')).toEqual({ hide: 1.5 });
        expect(SettlementMarket.recipeGoods('tannery', 'out')).toEqual({ leather: 1 });
        // A town with hides to spare tans them; one without hides can't
        const run = (hides) => {
            const s = { name: 'Tanner', type: 'town', population: 4000, economy: { gold: 0 } };
            SettlementMarket.ensure(s);
            s.market.stock.hide = SettlementMarket.target(s, 'hide') * hides;
            s.market.stock.leather = SettlementMarket.target(s, 'leather') * 0.1;
            const hide0 = s.market.stock.hide;
            SettlementMarket.processSettlement(s, {}, { day: 10, days: 4 });
            return { s, hideUsed: hide0 - s.market.stock.hide };
        };
        const rich = run(3), bare = run(0);
        expect(rich.hideUsed).toBeGreaterThan(0);
        expect(rich.s.market.stock.leather).toBeGreaterThan(bare.s.market.stock.leather);
    });

    it('the player\'s tannery can tan leather, and the ids line up', () => {
        const tannery = PlayerEconomy.PROPERTY_TYPES ? PlayerEconomy.PROPERTY_TYPES.TANNERY : DataLoader._gamedata.playerEconomy.PROPERTY_TYPES.TANNERY;
        expect(tannery.allowedRecipes).toContain('TAN_LEATHER');
        const r = DataLoader._gamedata.playerEconomy.RECIPES.TAN_LEATHER;
        expect(r.input).toBe('hide');
        expect(r.output).toBe('leather');
        expect(PlayerEconomy.GOODS[r.input.toUpperCase()]).toBeTruthy();
        expect(PlayerEconomy.GOODS[r.output.toUpperCase()]).toBeTruthy();
        // Leather armour still comes from hides
        expect(DataLoader._gamedata.playerEconomy.RECIPES.LEATHER_ARMOR.input).toBe('hide');
    });

    it('a tannery is a works the player can fund, and it pays from the value it adds', () => {
        expect(MerchantPrince.kinds().tannery).toBeTruthy();
        const s = { name: 'Hidegate', type: 'city', population: 9000, happiness: 50, kingdom: 'k1', q: 5, r: 5 };
        const tile = { q: 5, r: 5, terrain: { id: 'plains', passable: true }, resource: null, settlement: s };
        const kingdoms = [{ id: 'k1', name: 'Aster', isAlive: true, wars: [], finance: { debtRatio: 0, missed: 0, unpaid: 0 }, traits: [] }];
        const world = {
            width: 40, height: 40, day: 50, activeEvents: [], units: [], kingdoms,
            getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
            getTile: (q, r) => (q === 5 && r === 5 ? tile : { q, r, terrain: { id: 'plains', passable: true } }),
            getSettlementViews: () => [s], getAllSettlements: () => [s],
        };
        SettlementMarket.ensure(s);
        const player = { q: 5, r: 5, gold: 5000, inventory: { wood: 50, stone: 50 }, maxInventory: 99, skills: { commerce: 0 }, reputation: { k1: 10 }, name: 'Tester' };
        const res = MerchantPrince.invest(player, world, tile, 'tannery');
        expect(res.success).toBe(true);
        const w = SettlementMarket.works(s, 'tannery');
        expect(w.lvl).toBe(1);
        // Hides to spare, leather short: the works run and add value
        s.market.stock.hide = SettlementMarket.target(s, 'hide') * 3;
        s.market.stock.leather = SettlementMarket.target(s, 'leather') * 0.2;
        SettlementMarket.processSettlement(s, {}, { day: 52, days: 4 });
        expect(SettlementMarket.works(s, 'tannery').runs).toBeGreaterThan(0);
        expect(SettlementMarket.works(s, 'tannery').va).toBeGreaterThan(0);
    });
});

describe('holdings\' own bandit raids damage the works in town', () => {
    function holdingWorld() {
        const tiles = new Map();
        for (let q = 0; q < 16; q++) for (let r = 0; r < 16; r++) tiles.set(`${q},${r}`, { q, r, terrain: { id: 'plains', passable: true } });
        const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, territory: [], population: 5000 };
        const world = {
            day: 10, width: 16, kingdoms: [kingdom], units: [], events: [],
            getTile: (q, r) => tiles.get(`${q},${r}`) || null,
            getKingdom: (id) => (id === 'k1' ? kingdom : null),
            getAllSettlements: () => [...tiles.values()].filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
        };
        const s = { name: 'Holdfast', type: 'town', population: 3000, level: 2, kingdom: null, happiness: 60, colony: { isPlayerColony: true, loyalty: 60, garrisonStrength: 0 } };
        Economy.initSettlement(s);
        s.q = 5; s.r = 5;
        world.getTile(5, 5).settlement = s;
        SettlementMarket.ensure(s);
        SettlementMarket.setWorks(s, 'bakery', { cap: 6, lvl: 1, cond: 1, owner: 'player' });
        const player = {
            id: 'p1', name: 'Ash', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', gold: 10000, renown: 20, karma: 0,
            reputation: {}, properties: [], colonies: [{ q: 5, r: 5, name: s.name, foundedDay: 0 }], children: [], inventory: {}, army: [],
            q: 0, r: 0, taxRate: 'moderate', skills: { commerce: 3, combat: 4, leadership: 3, diplomacy: 4, stealth: 2, cartography: 1 },
        };
        Relationships.initialize(player);
        House.initialize(player, world);
        return { world, s, player };
    }

    it('a raid that gets in burns the market\'s stores and knocks the works\' repair', () => {
        const { world, s, player } = holdingWorld();
        const grain0 = s.market.stock.grain;
        world.units.push({ type: 'raider', name: 'Raider Band', q: 6, r: 5, strength: 400 });
        Utils.setRng(() => 0);
        const day = Holdings.processDay(player, world);
        expect(day.raids[0].repelled).toBe(false);
        expect(s.market.stock.grain).toBeLessThan(grain0);
        expect(SettlementMarket.works(s, 'bakery').cond).toBeLessThan(1);
    });

    it('a raid beaten off leaves them be', () => {
        const { world, s, player } = holdingWorld();
        Holdings.ensure(s).garrison.push(...Array.from({ length: 40 }, () => ({ type: 'soldier', name: 'Soldier', strength: 10, upkeep: 5, experience: 0, level: 1 })));
        world.units.push({ type: 'raider', name: 'Raider Band', q: 6, r: 5, strength: 5 });
        Utils.setRng(() => 0);
        const day = Holdings.processDay(player, world);
        expect(day.raids[0].repelled).toBe(true);
        expect(SettlementMarket.works(s, 'bakery').cond).toBe(1);
    });
});

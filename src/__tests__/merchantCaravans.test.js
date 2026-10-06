/**
 * Merchant caravans and trading ships (systems/merchantCaravans.js): a
 * sampled share of the NPC trade flows travels the map as real units whose
 * cargo lands only on arrival; robbers, lairs and warring realms take them
 * (a dearth follows downstream); escorts, robbery, tolls, road wardens,
 * save/load, determinism and the caps.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { MerchantCaravans } from '../systems/merchantCaravans.js';
import { Underworld } from '../systems/underworld.js';
import { Heralds } from '../systems/heralds.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

// Tune data/merchantCaravans.json for one test, put it back after
let _saved = null;
function tune(fn) {
    const d = DataLoader._gamedata.merchantCaravans;
    if (!_saved) _saved = JSON.parse(JSON.stringify(d));
    fn(d);
}
afterEach(() => {
    if (_saved) {
        DataLoader._gamedata.merchantCaravans = _saved;
        _saved = null;
    }
    vi.restoreAllMocks();
});

const basePrices = () => Object.fromEntries(SettlementMarket.config().goodIds.map(id => [id, PlayerEconomy.GOODS[id.toUpperCase()].basePrice]));

/**
 * A strip of plains with a road along row 5: Glut at (3,5) and Dearth at
 * (13,5). Land east of q=8 belongs to realm k2 (a toll border), unless
 * `oneRealm`.
 */
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

/** One market turn on the strip's link: pick, trade, dispatch. */
function marketTurn(g, player = null) {
    MerchantCaravans.selectLinks(g.world, [g.link], null, g.world.day);
    const bases = basePrices();
    SettlementMarket.flows([g.link], bases);
    return MerchantCaravans.dispatch(g.world, [g.link], bases, g.world.day, player);
}

function day(g, player = null) {
    g.world.day++;
    return MerchantCaravans.processDay(g.world, player);
}

describe('caravans embody the trade flows', () => {
    it('a picked link sends a caravan carrying the goods instead of landing them', () => {
        const g = strip();
        const before = SettlementMarket.stock(g.b, 'grain');
        const glut = SettlementMarket.stock(g.a, 'grain');
        expect(marketTurn(g)).toBe(1);
        const [u] = MerchantCaravans.traders(g.world);
        expect(u.type).toBe('trade_caravan');
        expect(u.cargo.grain).toBeGreaterThan(0);
        expect(u.name).toMatch(/Caravan/);
        expect(u.house && u.house.name).toBeTruthy();
        // The goods left Glut but have not reached Dearth
        expect(SettlementMarket.stock(g.a, 'grain')).toBeCloseTo(glut - u.cargo.grain, 1);
        expect(SettlementMarket.stock(g.b, 'grain')).toBe(before);
        // Its route follows the road, origin to destination
        expect(u.route.slice(0, 2)).toEqual([3, 5]);
        expect(u.route.slice(-2)).toEqual([13, 5]);
        expect(u.inventory.grain).toBe(Math.floor(u.cargo.grain));
    });

    it('lands the cargo only when it arrives', () => {
        const g = strip({ oneRealm: true });
        marketTurn(g);
        const u = MerchantCaravans.traders(g.world)[0];
        const cargo = u.cargo.grain;
        const before = SettlementMarket.stock(g.b, 'grain');
        day(g);
        expect(u.destroyed).toBe(false);
        expect(SettlementMarket.stock(g.b, 'grain')).toBe(before);
        for (let i = 0; i < 5 && !u.destroyed; i++) day(g);
        expect(u.destroyed).toBe(true);
        expect(u.arrived).toBe(true);
        expect(SettlementMarket.stock(g.b, 'grain')).toBeCloseTo(before + cargo, 1);
        expect(MerchantCaravans.state(g.world).stats.delivered).toBe(1);
    });

    it('an unembodied link still trades in aggregate, and a small lot lands at once', () => {
        const g = strip();
        tune(d => { d.spawn.minValue = 1e9; });
        const before = SettlementMarket.stock(g.b, 'grain');
        expect(marketTurn(g)).toBe(0);
        expect(MerchantCaravans.traders(g.world).length).toBe(0);
        expect(SettlementMarket.stock(g.b, 'grain')).toBeGreaterThan(before);
    });

    it('never puts more traders on the road than the cap, nor two on one link', () => {
        const g = strip();
        marketTurn(g);
        g.world.day++;
        expect(marketTurn(g)).toBe(0); // the link already carries one
        tune(d => { d.cap.min = 0; d.cap.max = 0; d.cap.perSettlement = 0; });
        const g2 = strip();
        expect(marketTurn(g2)).toBe(0);
        expect(MerchantCaravans.cap(g2.world)).toBe(0);
        // The cap scales with the towns
        tune(d => { d.cap.min = 4; d.cap.max = 24; d.cap.perSettlement = 0.25; });
        expect(MerchantCaravans.cap(null, 40)).toBe(10);
        expect(MerchantCaravans.cap(null, 400)).toBe(24);
        expect(MerchantCaravans.cap(null, 2)).toBe(4);
    });
});

describe('on the road', () => {
    it('raiders take a caravan: its cargo never arrives and the town downstream goes short', () => {
        const run = (robbers) => {
            const g = strip({ oneRealm: true });
            // Dearth has nothing else to eat
            for (const id of SettlementMarket.config().groups.food) if (id !== 'grain') g.b.market.stock[id] = 0;
            marketTurn(g);
            if (robbers) g.world.units.push({ type: 'raider', name: 'Red Hand', q: 8, r: 4, strength: 1e7, inventory: {}, destroyed: false });
            for (let i = 0; i < 6; i++) day(g);
            g.grainAfter = SettlementMarket.stock(g.b, 'grain');
            // ...and the town lives on what came in (or didn't)
            for (let i = 0; i < 4; i++) SettlementMarket.processSettlement(g.b, {}, { day: g.world.day + i });
            return g;
        };
        const safe = run(false), robbed = run(true);
        expect(robbed.grainAfter).toBeLessThan(safe.grainAfter);
        expect(SettlementMarket.foodShortage(robbed.b)).toBeGreaterThan(SettlementMarket.foodShortage(safe.b));
        const st = MerchantCaravans.state(robbed.world);
        expect(st.stats.taken).toBe(1);
        expect(st.stats.delivered).toBe(0);
        // The raiders carry it off; merchants shun the road for a while
        const raider = robbed.world.units.find(u => u.type === 'raider');
        expect(raider.inventory.grain).toBeGreaterThan(0);
        expect(MerchantCaravans.fearFactor(robbed.world, robbed.link)).toBeLessThan(1);
        expect(MerchantCaravans.selectLinks(robbed.world, [robbed.link], null, robbed.world.day)).toBe(0);
        // The loss is news for the heralds
        expect(st.history.some(h => h.kind === 'taken' && h.to === 'Dearth')).toBe(true);
        expect(robbed.world.events.some(e => /taken by Red Hand/.test(e.text))).toBe(true);
    });

    it('feeds the link disruption: a shunned road trades less in aggregate', () => {
        const g = strip({ oneRealm: true });
        g.world.merchantTrade = MerchantCaravans._blank();
        g.world.merchantTrade.fear[MerchantCaravans.linkKey(g.a, g.b)] = g.world.day + 5;
        const l = { ...g.link };
        MarketDynamics._disrupt(g.world, null, [l]);
        expect(l.factor).toBeLessThan(1);
    });

    it('an outlaw lair near the road ambushes it, and the hoard takes the cargo', () => {
        tune(d => { d.ambush.lairChance = 1; });
        let taken = 0;
        for (let trial = 0; trial < 4; trial++) {
            const g = strip({ oneRealm: true });
            g.world.generationParams.seed = 100 + trial;
            marketTurn(g);
            const lair = { id: 7, status: 'active', q: 8, r: 3, strength: 400, leader: { name: 'Black Wen' }, name: 'the Hollow', parties: [], hoard: { gold: 0, goods: {} } };
            const player = { q: 20, r: 10, gold: 0, outlawLairs: { lairs: [lair] } };
            for (let i = 0; i < 6; i++) day(g, player);
            if (MerchantCaravans.state(g.world).stats.taken) {
                taken++;
                expect(lair.hoard.goods.grain).toBeGreaterThan(0);
            }
        }
        expect(taken).toBeGreaterThan(0);
    });

    it('a realm at war with its realms seizes it in its own land', () => {
        tune(d => { d.ambush.warSeize = 1; });
        const g = strip();
        g.kingdoms[0].wars = ['k2']; g.kingdoms[1].wars = ['k1'];
        // (the war would cut this link; set the trader out by hand)
        marketTurn(g);
        for (let i = 0; i < 6; i++) day(g);
        expect(MerchantCaravans.state(g.world).stats.seized).toBe(1);
    });

    it('pays tolls into the treasury of the realm whose border it crosses', () => {
        const g = strip();
        marketTurn(g);
        const u = MerchantCaravans.traders(g.world)[0];
        const purse = u.purse;
        const t0 = g.kingdoms[1].treasury;
        for (let i = 0; i < 6; i++) day(g);
        expect(g.kingdoms[1].treasury).toBeGreaterThan(t0);
        expect(u.tollsPaid).toBe(g.kingdoms[1].treasury - t0);
        expect(u.tollsPaid).toBeLessThanOrEqual(purse);
        expect(MerchantCaravans.state(g.world).stats.tolls).toBe(u.tollsPaid);
        // ...and none in its own realm
        expect(g.kingdoms[0].treasury).toBe(1000);
    });
});

describe('the player and the caravan', () => {
    it('trades with it at a price between the two markets, and buying takes cargo off the road', () => {
        const g = strip({ oneRealm: true });
        marketTurn(g);
        const u = MerchantCaravans.traders(g.world)[0];
        const player = { q: 3, r: 5, gold: 1000, inventory: {}, maxInventory: 99 };
        const [o] = MerchantCaravans.offers(u);
        const [from, to] = u.prices.grain;
        expect(o.buy).toBeGreaterThanOrEqual(Math.floor(Math.min(from, to)));
        expect(o.sell).toBeLessThan(o.buy);
        const cargo = u.cargo.grain;
        const r = MerchantCaravans.buy(player, g.world, u.id, 'grain', 3);
        expect(r.success).toBe(true);
        expect(player.inventory.grain).toBe(3);
        expect(player.gold).toBe(1000 - o.buy * 3);
        expect(u.cargo.grain).toBeCloseTo(cargo - 3, 2);
        // Selling back pays less than it cost (no loop)
        const s = MerchantCaravans.sell(player, g.world, u.id, 'grain', 3);
        expect(s.success).toBe(true);
        expect(player.gold).toBeLessThan(1000);
        // Too far away: no deal
        player.q = 20;
        expect(MerchantCaravans.buy(player, g.world, u.id, 'grain', 1).success).toBe(false);
    });

    it('an escort who stays with the caravan is paid on arrival', () => {
        const g = strip({ oneRealm: true });
        marketTurn(g);
        const u = MerchantCaravans.traders(g.world)[0];
        const player = { q: 3, r: 5, gold: 0, renown: 0, reputation: {} };
        const hire = MerchantCaravans.hireEscort(player, g.world, u.id);
        expect(hire.success).toBe(true);
        expect(MerchantCaravans.hireEscort(player, g.world, u.id).success).toBe(false);
        const pay = u.escortPay;
        expect(pay).toBeGreaterThan(0);
        let notices = [];
        for (let i = 0; i < 6 && !u.destroyed; i++) {
            notices = notices.concat(day(g, player).notices);
            player.q = u.q; player.r = u.r; // rides alongside
        }
        expect(player.gold).toBe(pay);
        expect(player.reputation.k1).toBeGreaterThan(0);
        expect(notices.some(n => n.title === 'Escort Paid')).toBe(true);
        expect(MerchantCaravans.state(g.world).stats.escorts).toBe(1);
    });

    it('an ambush on a caravan the player guards is a fight through PlayerMilitary', async () => {
        const { PlayerMilitary } = await import('../player/playerMilitary.js');
        const spy = vi.spyOn(PlayerMilitary, 'attackUnit').mockImplementation((p, foe) => { foe.destroyed = true; return { victory: true, loot: 0 }; });
        const g = strip({ oneRealm: true });
        marketTurn(g);
        const u = MerchantCaravans.traders(g.world)[0];
        const player = { q: 3, r: 5, gold: 0, renown: 0, reputation: {} };
        MerchantCaravans.hireEscort(player, g.world, u.id);
        const band = { type: 'raider', name: 'Red Hand', q: 6, r: 4, strength: 1e7, inventory: {}, destroyed: false };
        g.world.units.push(band);
        const notices = [];
        for (let i = 0; i < 6 && !u.destroyed; i++) {
            player.q = u.q; player.r = u.r;
            notices.push(...day(g, player).notices);
            player.q = u.q; player.r = u.r;
        }
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0][1]).toBe(band);
        expect(spy.mock.calls[0][3]).toEqual({ defending: true });
        expect(notices.some(n => n.title === 'Ambush Beaten Off')).toBe(true);
        expect(u.arrived).toBe(true);
        expect(player.gold).toBe(u.escortPay);
    });

    it('an escort who wanders off is dismissed unpaid', () => {
        const g = strip({ oneRealm: true });
        tune(d => { d.land.roadSpeed = 1; });
        marketTurn(g);
        const u = MerchantCaravans.traders(g.world)[0];
        const player = { q: 3, r: 5, gold: 0, renown: 0, reputation: {} };
        MerchantCaravans.hireEscort(player, g.world, u.id);
        player.q = 25; player.r = 10;
        const notices = [];
        for (let i = 0; i < 4; i++) notices.push(...day(g, player).notices);
        expect(u.escort).toBe(null);
        expect(notices.some(n => n.title === 'Escort Dismissed')).toBe(true);
        expect(player.gold).toBe(0);
    });

    it('the counsel points out an escort job nearby', async () => {
        const { Counsel } = await import('../systems/counsel.js');
        const g = strip({ oneRealm: true });
        marketTurn(g);
        const player = { q: 4, r: 5, gold: 0 };
        const facts = Counsel.READERS.escortJobs({ world: g.world, player, dist: (q, r) => Math.abs(q - player.q) + Math.abs(r - player.r) }, { radius: 4 });
        expect(facts.length).toBe(1);
        expect(facts[0].pay).toBeGreaterThan(0);
        expect(facts[0].to).toBe('Dearth');
    });

    it('robbing one: hot goods, heat and a witnessed crime, the realm\'s displeasure, a shunned road', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const game = newGame(9191);
        let u = null;
        for (let i = 0; i < 30 && !u; i++) {
            endDay(game);
            u = MerchantCaravans.traders(game.world).find(t => t.kingdomId != null) || null;
        }
        expect(u).toBeTruthy();
        const { player, world } = game;
        player.q = u.q; player.r = u.r;
        const kid = u.kingdomId;
        const rep0 = (player.reputation && player.reputation[kid]) || 0;
        const heat0 = Underworld.getHeat(player, kid);
        const loot = { ...u.inventory };
        delete loot.gold;
        for (const [id, n] of Object.entries(loot)) player.inventory[id] = (player.inventory[id] || 0) + n;
        const res = MerchantCaravans.onRobbed(player, world, u, loot);
        expect(res.kingdomId).toBe(kid);
        expect(Underworld.getHeat(player, kid)).toBeGreaterThan(heat0);
        expect(player.reputation[kid]).toBeLessThan(rep0);
        const id = Object.keys(loot)[0];
        expect(Underworld.hotQty(player, id, world.day)).toBe(loot[id]);
        expect(MerchantCaravans.state(world).stats.robbed).toBe(1);
        expect(world.merchantTrade.fear[u.linkKey]).toBeGreaterThan(world.day);
    });
});

describe('the realms protect their roads', () => {
    it('a rich realm sends road wardens up its busiest road, paid from the treasury, and they break raiders', () => {
        tune(d => { d.patrols.chance = 1; d.patrols.every = 1; });
        const g = strip({ oneRealm: true });
        g.kingdoms[0].treasury = 5000;
        g.kingdoms[1].isAlive = false;
        g.a.market.links = [[13, 5, 10, 0, 1, 2]];
        const st = MerchantCaravans.state(g.world);
        Utils.withRng(Utils.seededRandom(5), () => MerchantCaravans._sendPatrols(g.world, st, g.world.day));
        const p = g.world.units.find(u => u.type === 'road_patrol');
        expect(p).toBeTruthy();
        expect(p.kingdom).toBe('k1');
        expect(g.kingdoms[0].treasury).toBe(5000 - MerchantCaravans.config().patrols.cost);
        // A weak band in its way is broken
        g.world.units.push({ type: 'raider', name: 'Footpads', q: 5, r: 5, strength: 2, inventory: {}, destroyed: false });
        for (let i = 0; i < 3; i++) day(g);
        expect(g.world.units.find(u => u.name === 'Footpads').destroyed).toBe(true);
        expect(st.stats.raidersBroken).toBeGreaterThan(0);
        // A poor realm without a lawful lord sends none
        const g2 = strip({ oneRealm: true });
        g2.kingdoms[0].treasury = 10;
        g2.a.market.links = [[13, 5, 10, 0, 1, 2]];
        MerchantCaravans._sendPatrols(g2.world, MerchantCaravans.state(g2.world), g2.world.day);
        expect(g2.world.units.some(u => u.type === 'road_patrol')).toBe(false);
    });

    it('wardens near a caravan stand with its guards', () => {
        const g = strip({ oneRealm: true });
        marketTurn(g);
        const u = MerchantCaravans.traders(g.world)[0];
        const patrols = [{ type: 'road_patrol', q: u.q, r: u.r, strength: 50 }];
        expect(MerchantCaravans._patrolStrengthNear(g.world, patrols, u.q, u.r, 2)).toBe(50);
    });
});

describe('in the whole game', () => {
    const quiet = () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    };

    it('caravans take the road in a generated world, within the cap', () => {
        quiet();
        const game = newGame(3131);
        let most = 0;
        for (let i = 0; i < 40; i++) {
            endDay(game);
            most = Math.max(most, MerchantCaravans.traders(game.world).length);
            expect(MerchantCaravans.traders(game.world).length).toBeLessThanOrEqual(MerchantCaravans.cap(game.world));
        }
        expect(most).toBeGreaterThan(0);
        expect(MerchantCaravans.state(game.world).stats.spawned).toBeGreaterThan(0);
    });

    it('survives a save round trip and carries on exactly as before', () => {
        quiet();
        let a = newGame(5150);
        for (let i = 0; i < 25; i++) endDay(a);
        const b = roundTrip(a);
        const snap = (w) => JSON.stringify({ t: MerchantCaravans.traders(w).map(u => ({ ...u })), s: w.merchantTrade });
        expect(MerchantCaravans.traders(a.world).length).toBeGreaterThan(0);
        expect(snap(b.world)).toBe(snap(a.world));
        for (const g of [a, b]) {
            g.world.day++;
            MerchantCaravans.processDay(g.world, g.player);
            MarketDynamics.updatePrices(g.world, g.player);
        }
        expect(snap(b.world)).toBe(snap(a.world));
    });

    it('old saves get a blank record', () => {
        const w = { units: [] };
        MerchantCaravans.restore(undefined, w);
        expect(w.merchantTrade.stats.spawned).toBe(0);
        expect(w.merchantTrade.history).toEqual([]);
    });

    it('is deterministic and never draws from the shared stream', () => {
        quiet();
        const run = () => {
            const g = newGame(6262);
            for (let i = 0; i < 30; i++) endDay(g);
            return JSON.stringify({ t: MerchantCaravans.traders(g.world).map(u => [u.id, u.q, u.r, u.cargo]), s: g.world.merchantTrade });
        };
        expect(run()).toBe(run());
        const g = newGame(6263);
        for (let i = 0; i < 12; i++) endDay(g);
        g.world.day++;
        Utils.setSeed(99);
        const expected = Utils.random();
        Utils.setSeed(99);
        MerchantCaravans.processDay(g.world, null);
        MarketDynamics.updatePrices(g.world, null);
        expect(Utils.random()).toBe(expected);
    });

    it('the heralds cry a notable loss', () => {
        const world = { day: 50, kingdoms: [], merchantTrade: MerchantCaravans._blank() };
        const player = { q: 5, r: 5 };
        Heralds.processDay(world, player);
        world.day = 51;
        world.merchantTrade.history.push({ key: 'caravan:x:taken', kind: 'taken', day: 51, good: 'salt', carrier: 'caravan', house: 'House Medrano', from: 'Glut', to: 'Dearth', by: 'the Red Hand', q: 5, r: 5 });
        const out = Heralds.processDay(world, player);
        expect(out.notices.some(n => /salt caravan/.test(n.text))).toBe(true);
    });
});

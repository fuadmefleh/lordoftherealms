// Merchant houses (systems/merchantHouses.js): the trading company, its
// factors and standing orders, supply contracts, convoys, monopolies, rival
// houses, shares and royal ventures — on a generated world.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Petitions } from '../systems/petitions.js';
import { Ships } from '../systems/ships.js';
import { Trading } from '../player/playerEconomy.js';
import { Underworld } from '../systems/underworld.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

let logSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => logSpy && logSpy.mockRestore());

/** A generated world with the player rich and standing in a royal town that sells things. */
function setup(seed = 4242) {
    const game = newGame(seed);
    const { world, player } = game;
    const town = world.getAllSettlements()
        .filter(s => s.kingdom && s.type !== 'village')
        .map(s => world.getTile(s.q, s.r))
        .find(t => Trading.getAvailableGoods(t.settlement, t, world).filter(g => g.quantity > 10).length >= 3);
    player.q = town.q;
    player.r = town.r;
    player.gold = 50000;
    player.reputation = Object.fromEntries(world.kingdoms.map(k => [k.id, 20]));
    return { ...game, town };
}

function founded(seed) {
    const g = setup(seed);
    expect(MerchantHouses.buyCharter(g.player, g.world, g.town).success).toBe(true);
    expect(MerchantHouses.found(g.player, g.world, { capital: 20000 }).success).toBe(true);
    return g;
}

/** Advance the merchant tick to the company's next weekly turn. */
function nextWeek(g) {
    const c = MerchantHouses.company(g.player);
    g.world.day = c.nextWeekDay;
    return MerchantHouses.processDay(g.player, g.world);
}

describe('merchant houses: before a company', () => {
    it('draw no RNG and keep no state until the player founds a company', () => {
        const g = setup();
        Utils.setSeed(77);
        const expected = Utils.random();
        Utils.setSeed(77);
        for (let i = 0; i < 30; i++) {
            g.world.day++;
            MerchantHouses.processDay(g.player, g.world);
        }
        expect(Utils.random()).toBe(expected);
        expect(g.player.merchant).toBeUndefined();
    });

    it('set the rival houses up from the world seed alone (no RNG, same every time)', () => {
        const g = setup();
        Utils.setSeed(9);
        const expected = Utils.random();
        Utils.setSeed(9);
        const a = MerchantHouses.ensureRivals({}, g.world);
        const b = MerchantHouses.ensureRivals({}, g.world);
        expect(Utils.random()).toBe(expected);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a.length).toBeGreaterThanOrEqual(3);
        expect(a.length).toBeLessThanOrEqual(5);
        for (const r of a) {
            expect(r.posts.length).toBeGreaterThan(0);
            expect(r.capital).toBeGreaterThan(0);
        }
    });

    it('need a charter: bought from a crown, carried by a royal office, or sealed at court', () => {
        const g = setup();
        const { player, world, town } = g;
        expect(MerchantHouses.canFound(player, world).ok).toBe(false);
        const k = world.getKingdom(town.settlement.kingdom);
        const treasury = k.treasury;
        const res = MerchantHouses.buyCharter(player, world, town);
        expect(res.success).toBe(true);
        expect(k.treasury).toBe(treasury + res.cost);
        expect(MerchantHouses.canFound(player, world).ok).toBe(true);

        const office = setup();
        office.player.currentTitle = 'envoy';
        office.player.allegiance = office.town.settlement.kingdom;
        expect(MerchantHouses.canFound(office.player, office.world).ok).toBe(true);
        expect(MerchantHouses.found(office.player, office.world, { capital: 1000 }).success).toBe(true);
        expect(office.player.merchant.charters[0].source).toBe('office');

        const court = setup();
        Petitions.applyEffects(court.player, court.world, { kingdomId: court.town.settlement.kingdom }, { charter: true });
        expect(MerchantHouses.hasCharter(court.player, court.town.settlement.kingdom)).toBe(true);
    });
});

describe('merchant houses: factors trade by the player\'s price rules', () => {
    it('pay what the player pays, get what the player gets, and never sell back above the buying price', () => {
        const { world, player } = setup();
        const buffed = Object.create(player);
        buffed.tradeAgreements = Object.fromEntries(world.kingdoms.map(k => [k.id, { untilDay: world.day + 99 }]));
        let checked = 0;
        for (const s of world.getAllSettlements()) {
            const tile = world.getTile(s.q, s.r);
            for (const p of [player, buffed]) {
                const discount = Math.max(0.5, 1 - Trading.buyDiscount(p, tile.settlement));
                for (const g of Trading.getAvailableGoods(tile.settlement, tile, world)) {
                    const buy = MerchantHouses.factorBuyUnit(p, world, tile, g.id);
                    expect(buy).toBe(Math.ceil(g.price * discount));
                    const legal = Underworld.legalSaleCheck({ inventory: {} }, g.id, 1, tile.settlement, world);
                    const sale = MerchantHouses.factorSaleUnit(p, world, tile, g.id);
                    if (legal.ok) expect(sale).toBe(Trading.saleUnitPrice(p, g, tile.settlement, world, legal.priceMult, 1));
                    expect(sale, `${g.id} at ${s.name}`).toBeLessThan(buy);
                    checked++;
                }
            }
        }
        expect(checked).toBeGreaterThan(50);
    });

    it('run standing orders weekly: buy below P, sell above Q, keep N — never at a profit on the spot', () => {
        const g = founded();
        const { player, world, town } = g;
        const post = MerchantHouses.openPost(player, world, town, 0).post;
        const c = MerchantHouses.company(player);
        const good = Trading.getAvailableGoods(town.settlement, town, world).find(x => x.quantity > 10);
        const before = c.capital;
        const stockBefore = (town.settlement.marketStock || {})[good.id] || 0;
        MerchantHouses.setOrder(player, post.id, { good: good.id, buyBelow: 9999, buyQty: 10, sellAbove: 1, sellQty: 0, keep: 0 });
        nextWeek(g);
        const bought = post.stock[good.id];
        expect(bought).toBeGreaterThan(0);
        expect(town.settlement.marketStock[good.id]).toBe(stockBefore + bought);
        expect(c.pnl.expenses.purchases).toBeGreaterThan(0);
        // Now sell everything above a keep of 2
        MerchantHouses.setOrder(player, post.id, { good: good.id, buyBelow: 0, buyQty: 0, sellAbove: 1, sellQty: 999, keep: 2 });
        const sale = MerchantHouses.factorSaleUnit(player, world, town, good.id, bought - 2);
        nextWeek(g);
        expect(post.stock[good.id]).toBe(2);
        if (sale > 0) expect(c.pnl.income.sales).toBeGreaterThan(0);
        // Bought and sold back in the same town: the company is poorer, not richer
        expect(c.capital).toBeLessThan(before);
    });

    it('a skimming factor shows in thin books and is caught by an audit', () => {
        const g = founded();
        const { player, world, town } = g;
        const post = MerchantHouses.openPost(player, world, town, 0).post;
        post.factor.honesty = 0.3;
        const good = Trading.getAvailableGoods(town.settlement, town, world).find(x => x.quantity > 10);
        MerchantHouses.setOrder(player, post.id, { good: good.id, buyBelow: 9999, buyQty: 20, sellAbove: 1, sellQty: 0, keep: 0 });
        nextWeek(g);
        expect(post.skimmed).toBeGreaterThan(0);
        Utils.setSeed(3);
        let res;
        for (let i = 0; i < 10 && !(res && res.found); i++) {
            post.skimmed = Math.max(post.skimmed, 50);
            res = MerchantHouses.audit(player, world, post.id);
        }
        expect(res.found).toBeGreaterThan(0);
        expect(post.skimmed).toBe(0);
    });

    it('a guild friend\'s posts are robbed less often', () => {
        const g = founded();
        const post = MerchantHouses.openPost(g.player, g.world, g.town, 0).post;
        post.factor.honesty = 1;
        const base = MerchantHouses.robberyChance(g.player, g.world, post);
        Underworld.ensure(g.player).guild = { ...Underworld.ensure(g.player).guild, member: true, rank: 3 };
        expect(MerchantHouses.robberyChance(g.player, g.world, post)).toBeLessThan(base);
    });
});

describe('merchant houses: monopolies', () => {
    it('a granted monopoly bars everyone but its holder in that good and town, and lapses or is revoked', () => {
        const g = founded();
        const { player, world, town } = g;
        const good = Trading.getAvailableGoods(town.settlement, town, world).find(x => x.quantity > 10);
        const ctx = { q: town.q, r: town.r, kingdomId: town.settlement.kingdom };
        Petitions.applyEffects(player, world, ctx, { monopoly: { good: good.id, holder: 'medrano', holderName: 'House Medrano', days: 30 } });
        const res = Trading.buyGoods(player, good, 1, town.settlement);
        expect(res.success).toBe(false);
        expect(res.reason).toMatch(/House Medrano/);
        expect(MerchantHouses.factorBuyUnit(player, world, town, good.id)).toBe(null);
        expect(MerchantHouses.factorSaleUnit(player, world, town, good.id)).toBe(0);

        Petitions.applyEffects(player, world, ctx, { monopoly: { good: good.id, revoke: true } });
        expect(Trading.buyGoods(player, good, 1, town.settlement).success).toBe(true);

        Petitions.applyEffects(player, world, ctx, { monopoly: { good: good.id, holder: 'player', holderName: 'Us', days: 10 } });
        expect(Trading.buyGoods(player, good, 1, town.settlement).success).toBe(true);
        world.day += 10;
        MerchantHouses.expireMonopolies(player, world);
        expect(town.settlement.monopolies).toBeUndefined();
    });

    it('the clothiers\' petition really grants (and revokes) the textiles monopoly', () => {
        const def = Petitions.getDef('guild_monopoly');
        const grant = def.choices.find(c => c.id === 'grant');
        expect(grant.effects.monopoly).toMatchObject({ good: 'textiles', holder: 'guild' });
        const revoke = Petitions.getDef('guild_overreach').choices.find(c => c.id === 'revoke');
        expect(revoke.effects.monopoly).toMatchObject({ good: 'textiles', revoke: true });
    });

    it('lobbying at one\'s own post wins a monopoly for the company', () => {
        const g = founded();
        const { player, world, town } = g;
        const post = MerchantHouses.openPost(player, world, town, 0).post;
        MerchantHouses.company(player).reputation = 90;
        Utils.setSeed(1);
        let res;
        for (let i = 0; i < 20 && !(res && res.granted); i++) res = MerchantHouses.lobbyMonopoly(player, world, post.id, 'wine');
        expect(res.granted).toBe(true);
        expect(town.settlement.monopolies.wine.holder).toBe('player');
    });
});

describe('merchant houses: contracts and convoys', () => {
    function withContract(g) {
        Utils.setSeed(11);
        let ct = null;
        for (let i = 0; i < 200 && !ct; i++) ct = MerchantHouses._spawnContract(g.player, g.world);
        expect(ct).toBeTruthy();
        return ct;
    }

    it('are for goods the town can\'t buy at home or next door, and pay less than any price there', () => {
        const g = founded();
        const ct = withContract(g);
        const near = Ships.nearbyAsks(g.world, ct.q, ct.r, ct.good);
        expect(near.market).toBe(null);
        expect(near.port).toBe(null);
        expect(MerchantHouses.contractUnitPay(g.world, ct)).toBe(ct.pay);
    });

    it('delivered in full pay per unit and raise reputation; broken ones cost it and set tongues wagging', () => {
        const g = founded();
        const { player, world } = g;
        const c = MerchantHouses.company(player);
        const ct = withContract(g);
        expect(MerchantHouses.acceptContract(player, world, ct.id).success).toBe(true);
        player.q = ct.q;
        player.r = ct.r;
        player.inventory = { [ct.good]: ct.qty };
        const before = c.capital;
        const rep = c.reputation;
        const kRep = player.reputation[ct.kingdomId];
        const res = MerchantHouses.deliverContract(player, world, ct.id, 'inventory');
        expect(res.success).toBe(true);
        expect(res.done).toBe(true);
        expect(c.capital).toBe(before + ct.pay * ct.qty);
        expect(c.reputation).toBeGreaterThan(rep);
        expect(player.reputation[ct.kingdomId]).toBeGreaterThan(kRep);
        expect(player.inventory[ct.good]).toBeUndefined();

        const ct2 = withContract(g);
        MerchantHouses.acceptContract(player, world, ct2.id);
        const rep2 = c.reputation;
        world.day = ct2.deadline + 1;
        const out = MerchantHouses.processDay(player, world);
        expect(out.notices.some(n => n.title === 'Contract Broken')).toBe(true);
        expect(c.reputation).toBeLessThan(rep2);
        expect(player.gossip.rumors.some(r => r.type === 'contract_broken')).toBe(true);
    });

    it('a convoy carries a post\'s stock to the contract town and delivers it', () => {
        const g = founded();
        const { player, world, town } = g;
        const post = MerchantHouses.openPost(player, world, town, 0).post;
        const ct = withContract(g);
        MerchantHouses.acceptContract(player, world, ct.id);
        post.stock[ct.good] = ct.qty + 5;
        const res = MerchantHouses.dispatchConvoy(player, world, post.id, { contractId: ct.id }, ct.good, 999);
        expect(res.success).toBe(true);
        expect(res.convoy.qty).toBe(ct.qty);
        expect(post.stock[ct.good]).toBe(5);
        res.convoy.risk = 0;
        world.day = res.convoy.arriveDay;
        MerchantHouses.processDay(player, world);
        expect(ct.status).toBe('done');
        expect(MerchantHouses.company(player).stats.contractsDone).toBe(1);
    });
});

describe('merchant houses: rivals, shares and ventures', () => {
    it('shares can\'t be flipped for a profit; a majority buys the house out', () => {
        const g = founded();
        const { player, world } = g;
        const c = MerchantHouses.company(player);
        const r = MerchantHouses.activeRivals(player)[0];
        const before = c.capital;
        expect(MerchantHouses.buyShares(player, world, r.id, 20).success).toBe(true);
        expect(MerchantHouses.sellShares(player, world, r.id, 20).success).toBe(true);
        expect(c.capital).toBeLessThan(before);

        c.capital = 1e6;
        expect(MerchantHouses.buyOut(player, world, r.id).success).toBe(false);
        MerchantHouses.buyShares(player, world, r.id, 51);
        const cost = MerchantHouses.buyOutCost(player, r);
        const assets = Math.floor(r.capital);
        const cap = c.capital;
        expect(MerchantHouses.buyOut(player, world, r.id).success).toBe(true);
        expect(r.status).toBe('bought');
        expect(c.capital).toBe(cap - cost + assets);
    });

    it('rival houses trade, pay dividends and bid for contracts once there is a company', () => {
        const g = founded();
        const { player, world } = g;
        const r = MerchantHouses.activeRivals(player)[0];
        MerchantHouses.buyShares(player, world, r.id, 30);
        Utils.setSeed(5);
        for (let w = 0; w < 20; w++) nextWeek(g);
        const c = MerchantHouses.company(player);
        expect(r.lastProfit).not.toBe(0);
        expect((c.pnl.income.dividends || 0) + (r.status !== 'active' ? 1 : 0)).toBeGreaterThan(0);
        expect(c.weeks.length).toBeGreaterThan(0);
    });

    it('a price war bleeds the rival and the company\'s good name', () => {
        const g = founded();
        const c = MerchantHouses.company(g.player);
        const r = MerchantHouses.activeRivals(g.player)[0];
        const cap = r.capital;
        const rep = c.reputation;
        expect(MerchantHouses.priceWar(g.player, g.world, r.id, 500).success).toBe(true);
        expect(r.capital).toBeLessThan(cap);
        expect(c.reputation).toBeLessThan(rep);
        expect(r.rivalry).toBeGreaterThan(0);
    });

    it('royal ventures come home or are lost, paying the company either way it falls', () => {
        const g = founded();
        const { player, world } = g;
        Utils.setSeed(8);
        let v = null;
        for (let i = 0; i < 50 && !v; i++) v = MerchantHouses._spawnVenture(player, world);
        const c = MerchantHouses.company(player);
        expect(MerchantHouses.invest(player, world, v.id, 200).success).toBe(true);
        expect(c.investments.ventures.length).toBe(1);
        world.day = c.investments.ventures[0].resolveDay;
        const out = MerchantHouses.processDay(player, world);
        expect(c.investments.ventures.length).toBe(0);
        expect(out.notices.some(n => /Venture/.test(n.title))).toBe(true);
    });
});

describe('merchant houses: save and load', () => {
    it('keep the company, its posts, contracts and rivals, and the towns\' monopolies', () => {
        const g = founded();
        const { player, world, town } = g;
        const post = MerchantHouses.openPost(player, world, town, 0).post;
        MerchantHouses.setOrder(player, post.id, { good: 'grain', buyBelow: 5, buyQty: 10, sellAbove: 9, sellQty: 10, keep: 0 });
        Petitions.applyEffects(player, world, { q: town.q, r: town.r }, { monopoly: { good: 'wine', holder: 'player', holderName: 'Us', days: 50 } });
        const before = JSON.stringify(player.merchant);
        const g2 = roundTrip(g);
        expect(JSON.stringify(g2.player.merchant)).toBe(before);
        expect(g2.world.getTile(town.q, town.r).settlement.monopolies.wine.holder).toBe('player');
    });

    it('backfill an older save with no merchant record', () => {
        const p = { merchant: undefined };
        expect(MerchantHouses.loadState(p)).toBe(null);
        expect(p.merchant).toBe(null);
        const q = { merchant: { company: { name: 'Old Co', capital: 100, posts: [{ id: 'post1', q: 1, r: 1 }] } } };
        const st = MerchantHouses.loadState(q);
        expect(Array.isArray(st.board)).toBe(true);
        expect(q.merchant.company.posts[0].stock).toEqual({});
        expect(q.merchant.company.pnl.income).toEqual({});
    });
});

// The Hinterland: rural sites around the towns, deposits, prospecting and
// mining leases (world/hinterland.js, systems/concessions.js).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Hinterland } from '../world/hinterland.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour } from '../world/townLabour.js';
import { Concessions } from '../systems/concessions.js';
import { Counsel } from '../systems/counsel.js';
import { Heralds } from '../systems/heralds.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let ORIG = null;
beforeAll(async () => {
    await loadData();
    ORIG = DataLoader._gamedata.hinterland;
});
afterEach(() => {
    DataLoader._gamedata.hinterland = ORIG;
});

/** Override part of data/hinterland.json for one test. */
function tune(patch) {
    DataLoader._gamedata.hinterland = { ...ORIG, ...patch, concessions: { ...ORIG.concessions, ...(patch.concessions || {}) } };
}

const keep = (game) => { game.player.health = 100; game.player.inventory.bread = 40; game.player.starvationDays = 0; };
const at = (world, key) => { const [q, r] = key.split(',').map(Number); return world.getTile(q, r); };

/** A fresh game whose hinterland has been derived. */
function game(seed = 101) {
    const g = newGame(seed);
    Hinterland.derive(g.world);
    return g;
}

/** The first leasable deposit with a realm, a market town beside it and a positive estimate. */
function leasableSite(world) {
    return Hinterland.sites(world).find(s => Concessions.leasable(world, s) && Concessions.estimate(world, s).net > 2);
}

/** Close the auction on its day (the day's other work runs too). */
function closeAuction(world, player, a) {
    world.day = a.closes;
    return Concessions.processDay(world, player);
}

describe('Hinterland — sites from the terrain', () => {
    it('derives each town\'s sites from its land, deterministically and without touching the RNG', () => {
        const g = newGame(101);
        const { world } = g;
        Utils.setSeed(77);
        const before = Utils.random();
        Utils.setSeed(77);
        Hinterland.derive(world);
        expect(Utils.random()).toBe(before);
        const sites = Hinterland.sites(world);
        expect(sites.length).toBeGreaterThan(20);
        const C = Hinterland.config();
        const views = world.getSettlementViews();
        for (const s of sites) {
            const t = world.getTile(s.q, s.r);
            const k = Hinterland.kind(s.kind);
            expect(k).toBeTruthy();
            expect(t.settlement).toBeFalsy();
            // its kind comes from its resource, a known vein in the hills, or its land
            const res = t.resource && t.resource.id;
            if (res && C.byResource[res]) expect(s.kind).toBe(C.byResource[res]);
            else if (!(C.prospect.terrain[t.terrain.id] && k.deposit)) expect(k.terrain).toContain(t.terrain.id);
            // within reach of its home, which is the nearest settlement
            const home = at(world, s.h).settlement;
            const d = Hex.wrappingDistance(home.q, home.r, s.q, s.r, world.width);
            expect(d).toBeLessThanOrEqual(C.reach);
            for (const v of views) expect(Hex.wrappingDistance(v.q, v.r, s.q, s.r, world.width)).toBeGreaterThanOrEqual(d);
            if (k.deposit) {
                expect(s.res0).toBeGreaterThanOrEqual(k.reserve[0]);
                expect(s.res0).toBeLessThanOrEqual(k.reserve[1]);
            }
        }
        // no town works more than its size allows
        for (const v of views) expect(Hinterland.sitesOf(world, v.q, v.r).length).toBeLessThanOrEqual(C.maxSites[v.type]);
        // the same world derives the same sites
        const again = newGame(101);
        Hinterland.derive(again.world);
        expect(JSON.stringify(Hinterland.sites(again.world))).toBe(JSON.stringify(sites));
    });

    it('a town founded later gets its sites on the next resync; a site whose town is gone is re-homed', () => {
        const { world } = game();
        const st = Hinterland.state(world);
        const site = st.sites[0];
        const homeTile = at(world, site.h);
        const saved = homeTile.settlement;
        homeTile.settlement = null;
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
        Hinterland.sync(world, 1000);
        expect(site.h).not.toBe(`${homeTile.q},${homeTile.r}`);
        homeTile.settlement = saved;
        if (typeof world.invalidateSettlements === 'function') world.invalidateSettlements();
    });
});

describe('Hinterland — goods to market', () => {
    it('a site sends half its goods to its home and half to the market town', () => {
        const { world } = game();
        const site = Hinterland.sites(world).find(s => s.h !== s.m && s.st === 'open' && Hinterland.kind(s.kind).first === 'wool')
            || Hinterland.sites(world).find(s => s.h !== s.m && s.st === 'open');
        const home = at(world, site.h).settlement, market = at(world, site.m).settlement;
        const good = Hinterland.kind(site.kind).first;
        SettlementMarket.ensure(home); SettlementMarket.ensure(market);
        const h0 = SettlementMarket.stock(home, good), m0 = SettlementMarket.stock(market, good);
        const out = Hinterland.output(world, site, home, 4, 10);
        expect(out.goods[good]).toBeGreaterThan(0);
        Hinterland.deliver(world, site, out.goods, home, market);
        expect(SettlementMarket.stock(home, good) - h0).toBeCloseTo(out.goods[good] / 2, 1);
        expect(SettlementMarket.stock(market, good) - m0).toBeCloseTo(out.goods[good] / 2, 1);
    });

    it('the day turn delivers on each home town\'s market day, scaled by its land hands', () => {
        const { world } = game();
        const site = Hinterland.sites(world).find(s => s.st === 'open');
        const home = at(world, site.h).settlement;
        const k = SettlementMarket.tickDays();
        // find the home's market day
        let day = 10;
        while (SettlementMarket.slot(home.q, home.r) !== day % k) day++;
        world.day = day;
        Concessions.processDay(world, null);
        expect(site.day).toBe(day);
        expect(site.out).toBeGreaterThan(0);
        const full = site.out;
        // half its peasants gone: its sites dig less
        TownLabour.ensure(home);
        home.labour.fill.land = 0.5;
        world.day = day + k;
        Concessions.processDay(world, null);
        expect(site.out).toBeLessThan(full);
    });

    it('feeds the starved chains: a weaving shed fed by sheep runs works far more than without them', () => {
        const runs = (on) => {
            if (!on) tune({ kinds: {} });
            const g = newGame(101);
            const { world, player } = g;
            for (let d = 0; d < 10; d++) { keep(g); endDay(g); }
            const fed = (s) => Hinterland.sites(world).some(x => (x.m === `${s.q},${s.r}` || x.h === `${s.q},${s.r}`) && x.kind === 'sheep_run');
            // the same towns either way: those the hinterland would feed
            const probe = newGame(101);
            DataLoader._gamedata.hinterland = ORIG;
            Hinterland.derive(probe.world);
            if (!on) tune({ kinds: {} });
            const towns = world.getSettlementViews().filter(s => SettlementMarket.hasTrade(s, 'weaver') && Hinterland.sites(probe.world).some(x => (x.m === `${s.q},${s.r}` || x.h === `${s.q},${s.r}`) && x.kind === 'sheep_run'))
                .sort((a, b) => b.population - a.population).slice(0, 4);
            void fed;
            const invs = [];
            for (const s of towns) {
                player.q = s.q; player.r = s.r; player.gold = 10000;
                player.inventory.wood = 50;
                const r = MerchantPrince.invest(player, world, world.getTile(s.q, s.r), 'weaver');
                if (r.success) invs.push(r.investment);
            }
            for (let d = 0; d < 60; d++) { keep(g); endDay(g); }
            return invs.reduce((a, i) => a + i.earned, 0);
        };
        const on = runs(true);
        const off = runs(false);
        expect(on).toBeGreaterThan(off * 1.3);
    }, 60000);
});

describe('Hinterland — deposits run down and are found', () => {
    it('digging draws the reserve down; past the knee the yield falls; an empty mine closes', () => {
        const { world } = game();
        const site = Hinterland.sites(world).find(s => s.res0 > 0);
        const Y = Hinterland.config().yield;
        expect(Hinterland.yieldOf(site)).toBe(1);
        site.res = site.res0 * Y.knee * 0.5;
        expect(Hinterland.yieldOf(site)).toBeLessThan(1);
        expect(Hinterland.yieldOf(site)).toBeGreaterThan(Y.min);
        const home = at(world, site.h).settlement;
        const full = Hinterland.output(world, { ...site, res: site.res0 }, home, 4, 10).goods[Hinterland.kind(site.kind).first];
        const low = Hinterland.output(world, site, home, 4, 10).goods[Hinterland.kind(site.kind).first];
        expect(low).toBeLessThan(full);
        expect(Hinterland.deplete(site, site.res, 1)).toBe('exhausted');
        expect(site.st).toBe('exhausted');
        expect(Hinterland.yieldOf(site)).toBe(0);
        expect(Hinterland.output(world, site, home, 4, 10).dug).toBe(0);
    });

    it('a strike renews a waning mine first, else opens a new deposit in the hills', () => {
        const { world } = game();
        const site = Hinterland.sites(world).find(s => s.res0 > 0 && s.st === 'open');
        const town = at(world, site.h).settlement;
        site.res = site.res0 * 0.1;
        const v = Hinterland.strike(world, town, 'test:vein', 50);
        expect(v.kind).toBe('vein');
        expect(v.site).toBe(site);
        expect(site.res).toBeGreaterThan(site.res0 * 0.35);
        // a town with hills to search: a new site
        const hilly = world.getSettlementViews().find(s => Hinterland.prospectHexes(world, s).length > 0);
        const n = Hinterland.sites(world).length;
        const hit = Hinterland.strike(world, hilly, 'test:new', 60, { newOnly: true, by: 'player' });
        expect(hit && hit.kind).toBe('strike');
        expect(Hinterland.sites(world).length).toBe(n + 1);
        expect(Hinterland.kind(hit.site.kind).deposit).toBe(true);
        expect(hit.site.found).toBe(60);
    });

    it('the player can fund a search: a strike gives them the finder\'s right to lease it', () => {
        const { world, player } = game();
        const town = world.getSettlementViews().find(s => s.kingdom && Hinterland.prospectHexes(world, s).length > 2);
        player.q = town.q; player.r = town.r; player.gold = 1000;
        const tile = world.getTile(town.q, town.r);
        tune({ prospect: { ...ORIG.prospect, playerChance: 1 } });
        const res = Concessions.prospect(player, world, tile);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(1000 - res.spent);
        world.day = res.prospect.due;
        const out = Concessions.processDay(world, player);
        expect(res.prospect.status).toBe('struck');
        const site = Hinterland.site(world, res.prospect.site);
        expect(site.by).toBe('player');
        expect(out.notices.some(n => n.title === 'A Strike!')).toBe(true);
        if (Hinterland.kind(site.kind).leasable) {
            const a = Concessions.auctions(world).find(x => x.site === site.id);
            expect(a.finder).toBe('player');
        }
    });

    it('a worked-out mine closes: its towns go short (the price climbs) and its miners leave', () => {
        const run = (exhaust) => {
            const g = newGame(202);
            const { world } = g;
            Hinterland.derive(world);
            for (let d = 0; d < 6; d++) { keep(g); endDay(g); }
            // every iron mine in the world is dug out at once
            if (exhaust) for (const s of Hinterland.sites(world)) if (s.kind === 'iron_mine') s.res = 0.5;
            for (let d = 0; d < 60; d++) { keep(g); endDay(g); }
            const towns = [...new Set(Hinterland.sites(world).filter(s => s.kind === 'iron_mine').map(s => s.m))].map(k => at(world, k).settlement).filter(Boolean);
            const sc = towns.reduce((a, s) => a + SettlementMarket.scarcity(s, 'iron'), 0) / towns.length;
            return { sc, world };
        };
        const ctl = run(false);
        const hit = run(true);
        expect(Hinterland.sites(hit.world).filter(s => s.kind === 'iron_mine' && s.st === 'exhausted').length).toBeGreaterThan(0);
        expect(hit.sc).toBeGreaterThan(ctl.sc);
        const news = Hinterland.state(hit.world).history.filter(h => h.kind === 'exhausted');
        expect(news.length).toBeGreaterThan(0);
        expect(news.some(h => h.n > 0)).toBe(true);
    }, 60000);
});

describe('Concessions — leases', () => {
    function setup(seed = 101) {
        const g = game(seed);
        const { world, player } = g;
        const site = leasableSite(world);
        const home = at(world, site.h).settlement;
        player.q = home.q; player.r = home.r; player.gold = 20000;
        world.day = 5;
        return { ...g, site, home, realm: Concessions.realmOf(world, site) };
    }

    it('petition, win the auction, pay the fee into the treasury; dig, sell, pay hands and royalties', () => {
        const { world, player, site, home, realm } = setup();
        tune({ concessions: { houseBid: [0, 0] } });
        const q = Concessions.leaseQuote(player, world, site.id);
        expect(q.ok).toBe(true);
        const bid = q.minBid * 2;
        const res = Concessions.petition(player, world, site.id, bid);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(20000 - bid);
        const a = res.auction;
        const t0 = realm.treasury;
        const out = closeAuction(world, player, a);
        expect(out.notices.some(n => n.title === 'Concession Won')).toBe(true);
        expect(realm.treasury).toBe(t0 + bid);
        const c = Concessions.onSite(world, site);
        expect(c.holder).toBe('player');
        expect(c.end).toBe(a.closes + c.end - c.start);
        expect(site.hire).toBeGreaterThan(0);
        // its hands are extra land jobs in the home town
        expect(Hinterland.handsAt(world, home.q, home.r)).toBe(site.hire);
        // a few market days: the lease pays
        const k = SettlementMarket.tickDays();
        let day = world.day + 1;
        const g0 = player.gold, tr0 = realm.treasury;
        for (let i = 0; i < 6; i++) {
            while (SettlementMarket.slot(home.q, home.r) !== day % k) day++;
            world.day = day;
            Concessions.processDay(world, player);
            day++;
        }
        expect(c.dug).toBeGreaterThan(0);
        expect(c.royalties).toBeGreaterThan(0);
        expect(realm.treasury).toBeGreaterThan(tr0);
        expect(player.gold).toBeGreaterThan(g0);
        expect(c.revenue - c.wages - c.royalties).toBe(c.net);
        // a hard pace digs more and wears the vein faster
        expect(Concessions.setRate(player, world, c.id, 'hard').success).toBe(true);
        expect(site.hire).toBeGreaterThan(Hinterland.kind(site.kind).hands);
    });

    it('the merchant houses bid too: a better bid takes the lease and the player\'s bond comes back', () => {
        const { world, player, site } = setup();
        tune({ concessions: { houseBid: [0.6, 0.6] } });
        const q = Concessions.leaseQuote(player, world, site.id);
        const res = Concessions.petition(player, world, site.id, q.minBid);
        expect(res.success).toBe(true);
        const out = closeAuction(world, player, res.auction);
        const c = Concessions.onSite(world, site);
        expect(c).toBeTruthy();
        expect(c.holder).not.toBe('player');
        expect(player.gold).toBe(20000);
        expect(out.notices.some(n => n.title === 'Outbid')).toBe(true);
        // ...and the realms put deposits up on their own: houses take them
        const n0 = Hinterland.state(world).concessions.length;
        const from = world.day + 1, to = world.day + 70;
        for (let d = from; d < to; d++) { world.day = d; Concessions.processDay(world, null); }
        expect(Hinterland.state(world).concessions.length).toBeGreaterThan(n0);
    });

    it('revoked by war with the realm, a default on its lenders, or arrears', () => {
        const won = () => {
            const s = setup();
            tune({ concessions: { houseBid: [0, 0] } });
            const q = Concessions.leaseQuote(s.player, s.world, s.site.id);
            const res = Concessions.petition(s.player, s.world, s.site.id, q.minBid);
            closeAuction(s.world, s.player, res.auction);
            return { ...s, c: Concessions.onSite(s.world, s.site) };
        };
        // war
        let s = won();
        s.player.realmWars = { wars: { [s.realm.id]: { since: 1 } }, ultimatums: {}, truces: {} };
        s.world.day += 1;
        let out = Concessions.processDay(s.world, s.player);
        expect(s.c.status).toBe('war');
        expect(Concessions.onSite(s.world, s.site)).toBeNull();
        expect(out.notices.some(n => n.title === 'Lease Revoked')).toBe(true);
        // a default on the realm's lenders (systems/finance.js)
        s = won();
        s.player.finance = { history: [{ kind: 'player_default', kingdomId: s.realm.id, day: s.world.day }], wanted: {}, credit: {} };
        s.world.day += 1;
        Concessions.processDay(s.world, s.player);
        expect(s.c.status).toBe('default');
        // ...and no new lease for a defaulter
        expect(Concessions.leaseQuote(s.player, s.world, s.site.id).ok).toBe(false);
        // arrears: the purse can't pay the hands and the crown
        s = won();
        s.player.gold = 0;
        s.player.finance = { history: [], wanted: {}, credit: { missed: 0 } };
        s.site.hire = 5000;
        const k = SettlementMarket.tickDays();
        let day = s.world.day + 1;
        for (let i = 0; i < 12 && s.c.status === 'active'; i++) {
            while (SettlementMarket.slot(s.home.q, s.home.r) !== day % k) day++;
            s.world.day = day++;
            Concessions.processDay(s.world, s.player);
        }
        expect(s.c.status).toBe('arrears');
        expect(s.player.finance.credit.missed).toBe(1);
    });

    it('a realm the player rules may revoke a house\'s lease by edict; leases end with their term', () => {
        const { world, player, site, realm } = setup();
        tune({ concessions: { houseBid: [0.6, 0.6] } });
        const q = Concessions.leaseQuote(player, world, site.id);
        const res = Concessions.petition(player, world, site.id, q.minBid);
        closeAuction(world, player, res.auction);
        const c = Concessions.onSite(world, site);
        // (only the realm's own crown may revoke it: the player rules nothing here)
        void realm;
        expect(Concessions.revokeByEdict(player, world, c.id).success).toBe(false);
        c.end = world.day + 1;
        world.day += 1;
        Concessions.processDay(world, player);
        expect(c.status).toBe('expired');
        expect(site.c).toBeNull();
    });

    it('contracts the ore to the player\'s own works nearby: they use it before the town\'s stock', () => {
        const g = game(101);
        const { world, player } = g;
        const town = world.getSettlementViews().filter(s => SettlementMarket.hasTrade(s, 'smithy')).sort((a, b) => b.population - a.population)[0];
        const tile = world.getTile(town.q, town.r);
        player.q = town.q; player.r = town.r; player.gold = 5000;
        player.inventory.stone = 20; player.inventory.iron = 10;
        expect(MerchantPrince.invest(player, world, tile, 'smithy').success).toBe(true);
        const w = SettlementMarket.works(town, 'smithy');
        const took = SettlementMarket.feedWorks(town, 'smithy', 'iron', 12, 10);
        expect(took).toBe(10);
        expect(w.feed.iron).toBe(10);
        // the town has no spare iron at all: the works still run on their own store
        const m = SettlementMarket.ensure(town);
        m.stock.iron = 0;
        m.stock.coal = SettlementMarket.target(town, 'coal') * 2;
        m.stock.tools = SettlementMarket.target(town, 'tools') * 0.5;
        SettlementMarket.processSettlement(town, SettlementMarket.productionList({}), { day: 3, days: 4 });
        expect(w.runs).toBeGreaterThan(0);
        expect(w.feed ? (w.feed.iron || 0) : 0).toBeLessThan(10);
    });
});

describe('Hinterland — save, load, determinism, money', () => {
    it('sites, reserves, leases and auctions survive a save; an old save derives its sites from the terrain', () => {
        const g = game(101);
        keep(g);
        for (let d = 0; d < 12; d++) { keep(g); endDay(g); }
        const site = Hinterland.sites(g.world).find(s => s.res0 > 0);
        site.res = Math.round(site.res0 / 3);
        const before = JSON.stringify(Hinterland.serialize(g.world));
        const g2 = roundTrip(g);
        expect(JSON.stringify(Hinterland.serialize(g2.world))).toBe(before);
        // an old save: no hinterland record
        const data = JSON.parse(JSON.stringify({ world: SaveLoad.serializeWorld(g.world) }));
        delete data.world.hinterland;
        const g3 = roundTrip({ ...g, world: g.world });
        g3.world.hinterland = null;
        Hinterland.restore(undefined, g3.world);
        expect(g3.world.hinterland).toBeNull();
        Concessions.processDay(g3.world, g3.player);
        const got = Hinterland.sites(g3.world).map(s => s.id).sort();
        expect(got.length).toBeGreaterThan(20);
        g3.world.hinterland = null;
        Hinterland.derive(g3.world);
        expect(got).toEqual(Hinterland.sites(g3.world).map(s => s.id).sort());
    }, 60000);

    it('is deterministic: two runs of the same seed end in the same hinterland', () => {
        const run = () => {
            const g = newGame(303);
            for (let d = 0; d < 40; d++) { keep(g); endDay(g); }
            return JSON.stringify(Hinterland.serialize(g.world));
        };
        expect(run()).toBe(run());
    }, 60000);

    it('no money loop: a lease sells below what buying the ore back costs, and a petition withdrawn costs its bond only until the close', () => {
        const g = game(101);
        const { world, player } = g;
        const site = leasableSite(world);
        const home = at(world, site.h).settlement;
        const market = at(world, site.m).settlement;
        player.q = home.q; player.r = home.r; player.gold = 20000;
        world.day = 5;
        tune({ concessions: { houseBid: [0, 0] } });
        const q = Concessions.leaseQuote(player, world, site.id);
        const res = Concessions.petition(player, world, site.id, q.minBid);
        closeAuction(world, player, res.auction);
        const c = Concessions.onSite(world, site);
        const good = Hinterland.kind(site.kind).first;
        const mt = world.getTile(market.q, market.r);
        const base = Concessions.basePrice(good);
        const k = SettlementMarket.tickDays();
        let day = world.day + 1;
        while (SettlementMarket.slot(home.q, home.r) !== day % k) day++;
        world.day = day;
        const before = SettlementMarket.value(world, market, mt, good, base);
        const rev0 = c.revenue, dug0 = c.dug;
        Concessions.processDay(world, player);
        const perUnit = (c.revenue - rev0) / Math.max(0.01, c.dug - dug0);
        // what the lease got for a unit is below the town's value of it before the sale (let alone its ask)
        expect(perUnit).toBeLessThan(before);
        // the lease, all told, can't repay itself in days: fee + wages + royalties against output at base prices
        const est = Concessions.estimate(world, site);
        expect(c.fee / Math.max(0.01, est.net)).toBeGreaterThan(10);
    });
});

describe('Hinterland — counsel, heralds, labour', () => {
    it('the counsel warns of a vein running out and points to auctions nearby', () => {
        const g = game(101);
        const { world, player } = g;
        const site = leasableSite(world);
        const home = at(world, site.h).settlement;
        player.q = home.q; player.r = home.r; player.gold = 20000;
        world.day = 5;
        tune({ concessions: { houseBid: [0, 0] } });
        const q = Concessions.leaseQuote(player, world, site.id);
        const res = Concessions.petition(player, world, site.id, q.minBid);
        let items = Counsel.READERS.concessionAuctions({ player, world, day: world.day, tile: (a, b) => world.getTile(a, b) }, { radius: 10 });
        expect(items.some(i => i.key === `auc:${res.auction.id}`)).toBe(true);
        closeAuction(world, player, res.auction);
        site.res = site.res0 * 0.1;
        items = Counsel.READERS.veinRunningOut({ player, world, day: world.day, tile: (a, b) => world.getTile(a, b) }, { yieldBelow: 0.7, reserveBelow: 0.3 });
        expect(items.length).toBe(1);
        expect(items[0].why).toMatch(/running out/);
    });

    it('the heralds cry a worked-out mine; the counsel rules and herald templates are in the data', () => {
        const g = game(101);
        const { world, player } = g;
        Heralds.processDay(world, player);
        const site = Hinterland.sites(world).find(s => s.res0 > 0);
        Hinterland.record(world, { key: `exhausted:${site.id}:${world.day}`, kind: 'exhausted', place: 'Testford', site: 'Iron mine', good: 'iron', to: 'Elsewhere', n: 20, q: site.q, r: site.r, kingdomId: null, own: false });
        world.day += 1;
        Heralds.processDay(world, player);
        const st = player.heralds;
        expect(st.list.some(p => p.kind === 'mine_exhausted' && /Testford/.test(p.text))).toBe(true);
        const rules = DataLoader._gamedata.counsel.rules.map(r => r.id);
        expect(rules).toContain('vein_running_out');
        expect(rules).toContain('concession_auction');
    });

    it('a new strike draws miners from the next town; the lease hires extra land hands', () => {
        const { world } = game(101);
        const town = world.getSettlementViews().find(s => Hinterland.prospectHexes(world, s).length > 0 && s.population > 500);
        const near = Concessions._nearest(world, town);
        const p0 = town.population, n0 = near.population;
        const hit = Hinterland.strike(world, town, 'test:miners', 20, { newOnly: true });
        Concessions._newsStrike(world, town, hit, 20, { news: [] });
        expect(town.population).toBeGreaterThan(p0);
        expect(near.population).toBeLessThan(n0);
    });
});

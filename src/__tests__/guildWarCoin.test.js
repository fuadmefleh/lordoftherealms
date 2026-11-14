// Real coin for guilds and wars: every gold piece a guild or a war moves
// comes out of a real purse (a town's, a guildhall's, a crown's chests, the
// player's, a war host's bags) and goes into one — guild dues, founding,
// strike pay, lobbying, charters, abolition and dissolution
// (systems/guilds.js); the crowns' wars, collapses and risings
// (world/kingdomAI.js); the player's wars: war hosts' muster and chests,
// tribute, the price of peace, reparations (systems/realmWars.js); siege
// ransoms, tribute and plunder (systems/sieges.js) and besieged holdings'
// supplies and terms (systems/holdingSieges.js). Measured with the coin
// census (systems/coinCensus.js) or, on hand-built worlds, a sum of every
// purse there is: nothing made, nothing lost.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Guilds } from '../systems/guilds.js';
import { RealmWars } from '../systems/realmWars.js';
import { Sieges } from '../systems/sieges.js';
import { HoldingSieges } from '../systems/holdingSieges.js';
import { House } from '../systems/house.js';
import { Fiscal } from '../systems/fiscal.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
}, 120000);
afterEach(() => {
    Guilds._townCache = null;
    Utils.resetRng();
});

const near = (a, b) => expect(Math.abs(a - b)).toBeLessThan(0.5);

// ── Guilds on a hand-built realm ───────────────────────────────

const plains = (q, r, settlement = null) => ({ q, r, terrain: { id: 'plains', passable: true }, resource: null, settlement });

/** A capital and a town of realm k1 with real purses; the player stands in the capital. */
function guildRealm() {
    const capital = { name: 'Highmarket', type: 'capital', population: 12000, happiness: 50, kingdom: 'k1', q: 5, r: 5, economy: { gold: 30000, food: 0, goods: 0 } };
    const town = { name: 'Brindle', type: 'town', population: 3000, happiness: 50, kingdom: 'k1', q: 9, r: 5, economy: { gold: 8000, food: 0, goods: 0 } };
    const tiles = new Map([['5,5', plains(5, 5, capital)], ['9,5', plains(9, 5, town)]]);
    const kingdoms = [{ id: 'k1', name: 'Aster', isAlive: true, wars: [], capital: { q: 5, r: 5 }, finance: { debtRatio: 0, missed: 0, unpaid: 0 }, traits: [], treasury: 1000 }];
    const world = {
        width: 40, height: 40, day: 50, activeEvents: [], units: [], kingdoms,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || plains(q, r),
        getSettlementViews: () => [capital, town],
        getAllSettlements: () => [capital, town],
    };
    for (const s of [capital, town]) SettlementMarket.ensure(s);
    const player = { name: 'Tester', q: 5, r: 5, gold: 5000, maxInventory: 99, inventory: {}, skills: { commerce: 3 }, reputation: { k1: 10 } };
    return { world, player, capital, town, kingdoms };
}

/** Every purse on the hand-built realm: towns, guildhalls (and purses out lobbying, escrow), the crown, the player. */
function guildCoin({ world, player, capital, town, kingdoms }) {
    let c = player.gold + kingdoms.reduce((s, k) => s + (k.treasury || 0), 0);
    for (const s of [capital, town]) {
        c += s.economy.gold;
        for (const g of Object.values(s.guilds || {})) c += (g.treasury || 0) + ((g.lobbying && g.lobbying.purse) || 0);
    }
    for (const x of (player.guilds && player.guilds.contracts) || []) c += x.escrow || 0;
    return c;
}

describe('guild coin is real coin', () => {
    it('a new guild\'s first dues come out of its town\'s purse', () => {
        const r = guildRealm();
        const before = guildCoin(r);
        const purse = r.capital.economy.gold;
        Guilds.ensureTown(r.world, r.capital, 50);
        const halls = Object.values(r.capital.guilds).reduce((s, g) => s + g.treasury, 0);
        expect(halls).toBeGreaterThan(0);
        near(r.capital.economy.gold, purse - halls);
        near(guildCoin(r), before);
    });

    it('a guild in a town with an empty purse starts with an empty hall', () => {
        const r = guildRealm();
        r.town.economy.gold = 0;
        Guilds.ensureTown(r.world, r.town, 50);
        for (const g of Object.values(r.town.guilds)) expect(g.treasury).toBe(0);
    });

    it('a year of dues, strikes and lobbying moves the guilds\' coin but makes and loses none', () => {
        const r = guildRealm();
        const { world, player, capital, town, kingdoms } = r;
        for (const s of [capital, town]) Guilds.ensureTown(world, s, 49);
        // Hard times: war levies, a crown in crisis, heavy taxes — strikes come
        kingdoms[0].wars = ['k2'];
        kingdoms[0].finance = { debtRatio: 2, missed: 3, unpaid: 20 };
        kingdoms[0].crown = { policies: { tax: 'heavy' } };
        // Halls rich enough to lobby: the members pay in out of the town's purse (moved, not made)
        for (const s of [capital, town]) for (const g of Object.values(s.guilds)) {
            const put = Math.min(2000, s.economy.gold * 0.05);
            s.economy.gold -= put;
            g.treasury += put;
        }
        const before = guildCoin(r);
        const k0 = kingdoms[0].treasury;
        let strikes = 0;
        for (let day = 50; day < 50 + 364; day++) {
            world.day = day;
            Guilds.processDay(world, player);
            for (const s of [capital, town]) for (const g of Object.values(s.guilds || {})) if (g.strike && g.strike.since === day) strikes++;
        }
        expect(strikes).toBeGreaterThan(0);
        // (the crown took lobbying fees: coin moved out of the halls into its chests)
        expect(kingdoms[0].treasury).toBeGreaterThan(k0);
        near(guildCoin(r), before);
    });

    it('lobbying an NPC crown: half the purse a fee to the crown, the rest spent at court, whether it wins or not', () => {
        const r = guildRealm();
        Guilds.ensureTown(r.world, r.town, 50);
        const g = r.town.guilds.bakers;
        g.treasury = 2000;
        g.crown = 60;
        for (let d = 50; d < 50 + 28 * 12; d += 28) {
            const before = guildCoin(r);
            const hall = g.treasury, chests = r.kingdoms[0].treasury, court = r.capital.economy.gold;
            Guilds._lobby(r.world, r.player, r.town, g, Guilds.def('bakers'), d, { notices: [] });
            const cost = hall - g.treasury;
            expect(cost).toBeGreaterThan(0);
            near((r.kingdoms[0].treasury - chests) + (r.capital.economy.gold - court), cost);
            near(guildCoin(r), before);
            g.treasury = 2000; r.town.economy.gold -= cost; // (the members chip in again, from their town)
        }
    });

    it('a crown breaking a striking guild takes half its chest; the members share the rest', () => {
        const r = guildRealm();
        Guilds.ensureTown(r.world, r.capital, 50);
        const g = r.capital.guilds.bakers;
        const cfg = Guilds.config().crown;
        const chance = cfg.abolishChance;
        cfg.abolishChance = 1;
        try {
            g.crown = -80;
            g.strike = { since: 50, until: 90, reason: 'test' };
            r.capital.economy.gold -= 5000;
            g.treasury = 5000;
            const before = guildCoin(r);
            const chests = r.kingdoms[0].treasury;
            r.world.day = 57;
            Guilds._townWeek(r.world, r.player, r.capital, 57, { notices: [], income: 0, expenses: 0 });
            expect(r.capital.guilds && r.capital.guilds.bakers).toBeFalsy();
            expect(r.kingdoms[0].treasury - chests).toBeGreaterThan(2000);
            near(guildCoin(r), before);
        } finally {
            cfg.abolishChance = chance;
        }
    });

    it('a ruler abolishing a guild takes half its chest; the rest goes back to the town', () => {
        const r = guildRealm();
        Guilds.ensureTown(r.world, r.capital, 50);
        r.player.throne = { ruling: { kingdomId: 'k1' } };
        const g = r.capital.guilds.bakers;
        r.capital.economy.gold -= 3000;
        g.treasury += 3000;
        const half = Math.floor(g.treasury * 0.5);
        const before = guildCoin(r);
        const purse = r.capital.economy.gold, chests = r.kingdoms[0].treasury;
        expect(Guilds.abolish(r.player, r.world, r.capital, 'bakers').success).toBe(true);
        expect(r.kingdoms[0].treasury).toBe(chests + half);
        expect(r.capital.economy.gold).toBeGreaterThan(purse + 1000);
        near(guildCoin(r), before);
    });

    it('a guild that dissolves pays its chest and a lobbying purse back into its town', () => {
        const r = guildRealm();
        Guilds.ensureTown(r.world, r.town, 50);
        const g = r.town.guilds.weavers;
        g.treasury = 700;
        g.lobbying = { petition: 1, purse: 150, good: 'cloth' };
        r.town.economy.gold -= 850;
        const before = guildCoin(r);
        const purse = r.town.economy.gold;
        Guilds._dissolve(r.world, r.player, r.town, 'weavers', 'test');
        expect((r.town.guilds || {}).weavers).toBeUndefined();
        near(r.town.economy.gold, purse + 850);
        near(guildCoin(r), before);
    });

    it('an outsider\'s toll on a sale outside the stalls\' path (a factor, a store-room) is paid by the town', () => {
        const r = guildRealm();
        Guilds.ensureTown(r.world, r.capital, 50);
        const g = r.capital.guilds.bakers;
        const hall = g.treasury, purse = r.capital.economy.gold;
        Guilds.onSale(r.player, r.capital, 'bread', 10, 100);
        const toll = g.treasury - hall;
        expect(toll).toBeGreaterThan(0);
        near(r.capital.economy.gold, purse - toll);
        // ...and the stalls' own sale (Trading.sellGoods) draws it with the price: not twice
        const purse2 = r.capital.economy.gold;
        Guilds.onSale(r.player, r.capital, 'bread', 10, 100, { tollPaid: true });
        expect(r.capital.economy.gold).toBe(purse2);
    });
});

// ── The crowns' wars on a generated world ─────────────────────

/**
 * A generated world in the age of coin (the harness's starts at the dawn,
 * bartering): every town with a purse, every crown with chests — set up
 * before anything is measured.
 */
function coinGame(seed) {
    const game = newGame(seed);
    const { world } = game;
    if (world.barter) world.barter.allCoin = world.day;
    for (const v of world.getSettlementViews()) {
        const s = world.getTile(v.q, v.r).settlement;
        delete s.inKind;
        if (!s.economy) Economy.initSettlement(s);
        if (!(s.economy.gold > 0)) s.economy.gold = 500 + Math.round((s.population || 0) * 2);
    }
    for (const k of world.kingdoms) if (k.isAlive && !(k.treasury > 0)) k.treasury = 3000;
    return game;
}

describe('the crowns\' wars run on real coin', () => {
    it('two years of war among the crowns — battles, towns taken, wages, risings — make and lose no coin', () => {
        const game = coinGame(9191);
        const { world, player } = game;
        const alive = world.kingdoms.filter(k => k.isAlive);
        for (let i = 0; i + 1 < alive.length; i += 2) KingdomAI.startWar(alive[i], alive[i + 1], world);
        const total = () => CoinCensus.total(world, player).total;
        const before = total();
        const towns0 = alive.map(k => k.territory.length).join(',');
        for (let d = 0; d < 730; d++) {
            world.day++;
            for (const k of world.kingdoms) if (k.isAlive) KingdomAI.updateMilitary(k, world);
            KingdomAI.processWars(world);
            KingdomAI.processRestorations(world);
            Fiscal.processDay(world, null);
            // (the wars go on: a peace is broken again at once)
            for (let i = 0; i + 1 < alive.length; i += 2) {
                const a = alive[i], b = alive[i + 1];
                if (a.isAlive && b.isAlive && !a.wars.includes(b.id)) KingdomAI.startWar(a, b, world);
            }
        }
        expect(alive.map(k => k.territory.length).join(',')).not.toBe(towns0);
        // (the purses are kept to the hundredth: a few pieces of rounding over two years
        // of daily taxes and wages in every town, nothing more)
        expect(Math.abs(total() - before)).toBeLessThan(before * 5e-5);
    }, 120000);

    it('a fallen crown\'s chests (treasury and royal bank) pass to its conqueror', () => {
        const { world } = coinGame(9192);
        const [a, b] = world.kingdoms.filter(k => k.isAlive);
        KingdomAI.startWar(a, b, world);
        b.treasury = 4321;
        if (b.royalBank) b.royalBank.treasury = 1000;
        const total = () => CoinCensus.total(world, null).total;
        const before = total();
        const ta = a.treasury;
        KingdomAI._collapse(b, a, world);
        expect(b.isAlive).toBe(false);
        expect(b.treasury).toBe(0);
        expect(a.treasury).toBe(ta + 4321 + (b.royalBank ? 1000 : 0));
        near(total(), before);
    });

    it('a rising raises its war chest from the town that rises', () => {
        const { world } = coinGame(9193);
        const [a, b] = world.kingdoms.filter(k => k.isAlive);
        const seat = KingdomAI._settlementsOf(b, world)[0];
        KingdomAI.takeTile(a, b, world, seat.q, seat.r);
        b.isAlive = false;
        b.conqueredDay = world.day;
        b.treasury = 0;
        const total = () => CoinCensus.total(world, null).total;
        const purse = seat.settlement.economy.gold;
        b.isAlive = true; // (counted on both sides of the rising)
        const before = total();
        b.isAlive = false;
        KingdomAI.restoreKingdom(b, a, { q: seat.q, r: seat.r, tile: world.getTile(seat.q, seat.r) }, world);
        expect(b.treasury).toBe(Math.min(200, purse));
        near(seat.settlement.economy.gold, purse - b.treasury);
        near(total(), before);
    });
});

// ── The player's wars ─────────────────────────────────────────

function warWorld(day = 10) {
    const tiles = new Map();
    const terrain = { id: 'plains', passable: true };
    for (let q = 0; q < 12; q++) for (let r = 0; r < 12; r++) tiles.set(`${q},${r}`, { q, r, terrain });
    const seat = { name: 'Varrholt', q: 9, r: 9, kingdom: 'k1', population: 2000, economy: { gold: 3000, food: 0, goods: 0 } };
    const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, treasury: 5000, territory: [{ q: 9, r: 9 }], population: 5000, capital: { q: 9, r: 9 } };
    tiles.get('9,9').settlement = seat;
    tiles.get('9,9').kingdom = 'k1';
    const world = {
        day, width: 12, kingdoms: [kingdom], units: [], events: [],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => (id === 'k1' ? kingdom : null),
        getAllSettlements: () => [seat],
        getSettlementViews: () => [seat],
    };
    const player = { id: 'p1', name: 'Ash', lastName: 'Ashborne', gold: 5000, reputation: { k1: 0 }, properties: [], colonies: [] };
    House.initialize(player, world);
    const prop = { type: 'farm', level: 2, storage: 10 };
    world.getTile(2, 2).playerProperties = [prop];
    player.properties.push({ q: 2, r: 2, type: 'farm' });
    return { world, player, kingdom, seat };
}

/** The crown, its town, the player and every unit's bags. */
const warCoin = ({ world, player, kingdom, seat }) => kingdom.treasury + seat.economy.gold + player.gold
    + world.units.filter(u => !u.destroyed).reduce((s, u) => s + ((u.inventory && u.inventory.gold) || 0), 0);

describe('the player\'s wars draw on real treasuries', () => {
    it('a war host is mustered and its chest carried out of the treasury, and the chest comes home', () => {
        const w = warWorld();
        const before = warCoin(w);
        RealmWars.declareWar(w.player, w.world, w.kingdom);
        w.world.day += RealmWars.CONFIG.hostCadence;
        const t0 = w.kingdom.treasury, p0 = w.seat.economy.gold;
        RealmWars.processDaily(w.player, w.world);
        const unit = w.world.units.find(u => u.type === 'war_host');
        expect(unit).toBeTruthy();
        expect(unit.inventory.gold).toBeGreaterThan(0);
        // (the muster paid into the capital, the chest in the host's bags)
        near(t0 - w.kingdom.treasury, (w.seat.economy.gold - p0) + unit.inventory.gold);
        near(warCoin(w), before);
        // It strikes the farm and goes home with its chest
        unit.q = 2; unit.r = 2;
        w.world.day += 1;
        RealmWars.processDaily(w.player, w.world);
        expect(unit.destroyed).toBe(true);
        near(warCoin(w), before);
    });

    it('a crown with empty chests sends no host', () => {
        const w = warWorld();
        w.kingdom.treasury = 0;
        RealmWars.declareWar(w.player, w.world, w.kingdom);
        w.world.day += RealmWars.CONFIG.hostCadence;
        RealmWars.processDaily(w.player, w.world);
        expect(w.world.units.filter(u => u.type === 'war_host')).toHaveLength(0);
    });

    it('tribute and the price of peace go into the crown\'s chests; reparations come out of them', () => {
        const w = warWorld(RealmWars.CONFIG.checkCadence);
        const before = warCoin(w);
        RealmWars.issueUltimatum(w.player, w.world, w.kingdom);
        const t0 = w.kingdom.treasury;
        const paid = RealmWars.payTribute(w.player, w.world, 'k1');
        expect(paid.success).toBe(true);
        expect(w.kingdom.treasury).toBe(t0 + paid.cost);
        near(warCoin(w), before);
        // A war, bought off
        delete w.player.realmWars.truces.k1;
        RealmWars.declareWar(w.player, w.world, w.kingdom);
        const bought = RealmWars.sueForPeace(w.player, w.world, 'k1');
        expect(bought.success).toBe(true);
        near(warCoin(w), before);
        // A war won: the reparations out of the chests (then the towns), never more than they hold
        delete w.player.realmWars.truces.k1;
        const war = RealmWars.declareWar(w.player, w.world, w.kingdom);
        war.score = 100;
        w.seat.economy.gold += w.kingdom.treasury - 10; // (the chests nearly bare: spent in the town)
        w.kingdom.treasury = 10;
        const won = RealmWars.demandPeace(w.player, w.world, 'k1');
        expect(won.success).toBe(true);
        expect(won.gold).toBeGreaterThan(10);
        expect(w.kingdom.treasury).toBe(0);
        near(warCoin(w), before);
    });

    it('a beaten host\'s chest is the victor\'s spoils; what it does not take goes home', () => {
        const w = warWorld();
        RealmWars.declareWar(w.player, w.world, w.kingdom);
        w.world.day += RealmWars.CONFIG.hostCadence;
        RealmWars.processDaily(w.player, w.world);
        const unit = w.world.units.find(u => u.type === 'war_host');
        const before = warCoin(w);
        const spoils = PlayerMilitary._spoilsSource(PlayerMilitary._unitLoot(unit, w.world)).take(5);
        w.player.gold += spoils;
        unit.destroyed = true;
        const t0 = w.kingdom.treasury, left = unit.inventory.gold;
        RealmWars.onHostDefeated(w.player, w.world, unit);
        expect(w.kingdom.treasury).toBe(t0 + left);
        near(warCoin(w), before);
    });
});

describe('sieges pay in real coin', () => {
    /** The player before a kingdom's inland town on a generated world. */
    function siege(seed = 4242) {
        const game = coinGame(seed);
        const { world, player } = game;
        const found = world.getAllSettlements().find(s => s.kingdom && s.type !== 'capital');
        const tile = world.getTile(found.q, found.r);
        const settlement = tile.settlement;
        player.q = settlement.q; player.r = settlement.r;
        const def = Object.values(PlayerMilitary.UNIT_TYPES).find(u => u.id === 'knight');
        player.army = Array.from({ length: 30 }, () => PlayerMilitary.makeArmyUnit(def));
        player.gold = 5000;
        player.allegiance = null;
        player.inventory = { bread: 40 };
        const relief = Sieges.config().relief.chance;
        Sieges.config().relief.chance = {};
        expect(Sieges.invest(player, world, tile).success).toBe(true);
        Sieges.config().relief.chance = relief;
        return { world, player, tile, settlement, total: () => CoinCensus.total(world, player).total };
    }

    it('a ransom is raised from the town and its crown, and is what the player gets', () => {
        const s = siege();
        const before = s.total();
        const gold = s.player.gold;
        Utils.setRng(() => 0);
        const res = Sieges.negotiate(s.player, s.world, 'ransom');
        expect(res.accepted).toBe(true);
        expect(s.player.gold).toBe(gold + res.gold);
        near(s.total(), before);
    });

    it('weekly siege tribute comes out of the town', () => {
        const s = siege();
        Utils.setRng(() => 0);
        expect(Sieges.negotiate(s.player, s.world, 'tribute').accepted).toBe(true);
        Utils.resetRng();
        const before = s.total();
        const purse = s.settlement.economy.gold, gold = s.player.gold;
        s.world.day += 7;
        Sieges.processDay(s.world, s.player);
        expect(s.player.gold).toBeGreaterThan(gold);
        near(s.settlement.economy.gold, purse - (s.player.gold - gold));
        near(s.total(), before);
    });

    it('a sack\'s plunder comes out of the town\'s purse, never more than it holds', () => {
        const s = siege();
        s.settlement.economy.gold = 37;
        const before = s.total();
        const result = {};
        Sieges._sack(s.player, s.world, Sieges.active(s.player), s.tile, result);
        expect(result.plunder).toBe(37);
        expect(s.settlement.economy.gold).toBe(0);
        near(s.total(), before);
    });

    it('siege works are bought in a nearby town', () => {
        const s = siege();
        const opt = Sieges.workOptions(s.player, Sieges.active(s.player)).find(o => o.can && !o.building);
        if (!opt) return;
        const before = s.total();
        expect(Sieges.setStance(s.player, s.world, 'works', opt.id).success).toBe(true);
        near(s.total(), before);
    });
});

describe('a besieged holding\'s supplies and terms are real coin', () => {
    it('gold sent in hires men in the town; terms pay the besiegers\' crown', () => {
        // (HoldingSieges' own spec covers the siege; here only where its coin goes)
        const kingdom = { id: 'k1', treasury: 100 };
        const town = { name: 'Fort', q: 1, r: 1, economy: { gold: 50 } };
        const world = { day: 20, units: [], getTile: () => ({ settlement: town }), getKingdom: () => kingdom };
        const s = { key: '1,1', q: 1, r: 1, kingdomId: 'k1', hostId: 'h', garrison: 10, morale: 50, stores: 5, convoys: [{ via: 'caravan', gold: 300, food: 0, arriveDay: 20, catch: 0 }], log: [] };
        const player = { gold: 0 };
        HoldingSieges._convoysDay(player, world, s, { notices: [] });
        expect(town.economy.gold).toBe(350);
        // Caught on the way in: into the besiegers' chest (no host on the map: their crown's)
        s.convoys = [{ via: 'caravan', gold: 200, food: 0, arriveDay: 20, catch: 1 }];
        s.besiegerStores = 0;
        HoldingSieges._convoysDay(player, world, s, { notices: [] });
        expect(kingdom.treasury).toBe(300);
        expect(Economy.townPurse(town)).toBe(350);
    });
});

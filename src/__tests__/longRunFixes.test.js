/**
 * The slow failures the 85-year soak found (2026-11-17, longRun.soak.test.js),
 * each in normal time:
 *   - a rival House's land with no House to sweep it (died out, or let go with a
 *     new life) kept taking rents into a purse nobody spent — a third of the
 *     world's coin by year 85 on seed 202 (LandMarket._orphanMonth);
 *   - a landless holder's debt compounded for ever (written off);
 *   - with no company of the player's, ruined merchant houses were never
 *     replaced, and a house name was never borne again (MerchantHouses._newcomer);
 *   - a new life let the world's merchant houses and underwriters go, and with
 *     no company of its own never saw merchant houses again (Afterlife.becomeStranger);
 *   - the yearly letting-go of long-dead and long-unseen NPCs took their purses out
 *     of the world with them (Relationships.pruneKnown);
 *   - a reload refilled a fallen realm's royal bank to its generated vault (the
 *     vault wasn't saved), and the coin rose with the realm: +6.5–10k a restoration;
 *   - coin paid into a fallen crown's chests (a courier charter's fee, a guild
 *     broken) sat in no counted purse until the realm rose (KingdomAI.processRestorations).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { Estates } from '../world/estates.js';
import { LandMarket } from '../systems/landMarket.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Underwriting } from '../systems/underwriting.js';
import { Afterlife } from '../player/afterlife.js';
import { Relationships } from '../systems/relationships.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { MoneySupply } from '../world/moneySupply.js';
import { coinGame, measure, coinTowns } from './playtest/coinCheck.js';
import { Concessions } from '../systems/concessions.js';
import { Fiscal } from '../systems/fiscal.js';
import { CrownBooks } from '../world/crownBooks.js';
import { DataLoader } from '../core/dataLoader.js';
import { Scenarios } from '../player/scenarios.js';

beforeAll(async () => { await loadData(); });

/** An estate given to a made-up rival House's holder, with a purse of rents in it. */
function orphanedLand(world, day, purse = 5000) {
    const e = Object.values(world.estates.estates).find(x => x && x.holder && String(x.holder).startsWith('crown:'))
        || Object.values(world.estates.estates)[0];
    const kid = String(e.holder).startsWith('crown:') ? String(e.holder).slice(6) : world.kingdoms[0].id;
    const id = `rival:test-${kid}`;
    const h = Estates.ensureHolder(world, id);
    h.kid = kid;
    h.name = 'House Test';
    h.purse = purse;
    LandMarket._setHolder(world, e, id, day);
    return { e, h, id };
}

describe('orphaned rival-House land', () => {
    it('a House that looks in on its land keeps it; unswept, its purse is spent into the towns, coin conserved', () => {
        const g = coinGame(101, 2);
        const { world, player } = g;
        const day = world.day;
        const { e, h, id } = orphanedLand(world, day);
        // A living House sweeps it weekly (RivalHouses._landWeek stamps h.swept)
        const rival = { landKey: id, kingdomId: h.kid, gold: 0, stats: { rents: 0, estatesSold: 0 } };
        RivalHouses._landWeek(world, rival);
        expect(h.swept).toBe(day);
        expect(rival.gold).toBe(5000);
        h.purse = 5000;
        expect(LandMarket._orphanMonth(world, h, Estates.heldBy(world, id), day + 30)).toBe(0);
        expect(h.purse).toBe(5000);
        // No House for orphanDays: the stewards spend it out (no coin made or lost)
        const N = Estates.config().npc;
        const m = measure(world, player, () => LandMarket._orphanMonth(world, h, Estates.heldBy(world, id), day + N.orphanDays + 1));
        expect(m.result).toBeGreaterThan(4000);
        expect(h.purse).toBeLessThan(1000);
        expect(Math.abs(m.unbooked)).toBeLessThan(0.02);
        // ...and past orphanSellDays its land goes on the market
        expect(world.estates.sales.some(x => x.seller === id)).toBe(false);
        LandMarket._orphanMonth(world, h, Estates.heldBy(world, id), day + N.orphanSellDays + 1);
        expect(world.estates.sales.some(x => x.seller === id && x.id === e.id && x.reason === 'heirless')).toBe(true);
    }, 120000);

    it('an orphaned holder takes its month in the land market (it was skipped, and hoarded)', () => {
        const g = coinGame(101, 2);
        const { world } = g;
        const { h } = orphanedLand(world, world.day, 3000);
        h.swept = world.day - 400;
        for (let i = 0; i < 31; i++) endDay(g);
        expect(h.purse).toBeLessThan(3000 * 0.5);
    }, 120000);

    it('a landless holder with an empty purse has its debt written off', () => {
        const g = coinGame(101, 2);
        const { world, player } = g;
        const h = Estates.ensureHolder(world, 'noble:free:test');
        h.kid = 'nowhere';
        h.purse = 0;
        h.debt = 12345;
        LandMarket._holderMonth(world, player, h, world.day, { notices: [] });
        expect(h.debt).toBe(0);
    }, 120000);
});

describe('merchant houses over the long game', () => {
    it('with no company, a fallen house is replaced, and an old name can be borne again under a new id', () => {
        const g = coinGame(101, 2);
        const { world, player } = g;
        MerchantHouses.ensureRivals(player, world);
        const m = MerchantHouses.state(player);
        expect(m.company).toBeFalsy();
        // Every house that could ever be is ruined, long ago
        const defs = MerchantHouses.data().rivalHouses;
        for (const d of defs) if (!m.rivals.some(r => r.id === d.id)) m.rivals.push({ ...m.rivals[0], id: d.id, name: d.name, shares: { player: 0 } });
        for (const r of m.rivals) { r.status = 'ruined'; r.capital = 0; r.endedDay = world.day - 1000; }
        Utils.setSeed(7);
        for (let w = 0; w < 40 && !m.rivals.some(r => r.status === 'active'); w++) {
            world.day += 7;
            MerchantHouses.quietWeek(player, world);
        }
        const fresh = m.rivals.filter(r => r.status === 'active');
        expect(fresh.length).toBeGreaterThan(0);
        // (a new house under an old name: its own id, so the old one's shares and listing stay its own)
        expect(new Set(m.rivals.map(r => r.id)).size).toBe(m.rivals.length);
        expect(fresh[0].defId).toBeTruthy();
        expect(fresh[0].capital).toBeGreaterThan(0);
    }, 120000);

    it('a name whose last house fell lately is not borne again yet', () => {
        const g = coinGame(101, 2);
        const { world, player } = g;
        MerchantHouses.ensureRivals(player, world);
        const m = MerchantHouses.state(player);
        const defs = MerchantHouses.data().rivalHouses;
        for (const d of defs) if (!m.rivals.some(r => r.id === d.id)) m.rivals.push({ ...m.rivals[0], id: d.id, name: d.name, shares: { player: 0 } });
        for (const r of m.rivals) { r.status = 'ruined'; r.capital = 0; r.endedDay = world.day; }
        Utils.setSeed(7);
        for (let w = 0; w < 20; w++) MerchantHouses._newcomer(player, world, m, { ...MerchantHouses.config().rivals, newcomerChance: 1 }, world.day + w * 7);
        expect(m.rivals.filter(r => r.status === 'active').length).toBe(0);
    }, 120000);
});

describe('a new life keeps the world\'s merchant houses and underwriters', () => {
    it('the same houses and guilds trade on, capital and all, with the late ruler\'s shares ended', () => {
        const g = coinGame(101, 3);
        const { world } = g;
        const old = g.player;
        MerchantHouses.ensureRivals(old, world);
        Underwriting.processDay(world, old);
        const rivals = MerchantHouses.state(old).rivals;
        const guilds = Underwriting.state(old).guilds;
        expect(rivals.length).toBeGreaterThan(0);
        expect(guilds.length).toBeGreaterThan(0);
        rivals[0].shares.player = 10;
        const caps = rivals.map(r => r.capital);
        const gcaps = guilds.map(x => x.capital);
        Afterlife.begin(old, world, 'old age');
        const cand = Afterlife.candidates(world)[0];
        const res = Afterlife.becomeStranger(old, world, cand);
        expect(res.success).toBe(true);
        const me = res.player;
        expect(MerchantHouses.state(me).rivals.map(r => r.id)).toEqual(rivals.map(r => r.id));
        expect(MerchantHouses.state(me).rivals.map(r => r.capital)).toEqual(caps);
        expect(MerchantHouses.state(me).rivals[0].shares.player).toBe(0);
        expect(Underwriting.state(me).guilds.map(x => x.id)).toEqual(guilds.map(x => x.id));
        expect(Underwriting.state(me).guilds.map(x => x.capital)).toEqual(gcaps);
    }, 120000);
});

describe('known NPCs let go keep their coin in the world', () => {
    it("a long-dead NPC's purse is spent in the town nearest where they lived", () => {
        const g = coinGame(101, 2);
        const { world, player } = g;
        const town = world.getSettlementViews().find(v => v.kingdom != null && v.type !== 'village');
        const npc = { id: 'npc_longrun_test', firstName: 'Old', lastName: 'Coin', isAlive: false, deathDay: 1, metDay: 1, lastInteraction: 1, purse: 777.77, settlementQ: town.q, settlementR: town.r };
        Relationships._npcs.push(npc);
        world.day += 6 * 120;
        const m = measure(world, player, () => Relationships.pruneKnown(player, world));
        expect(m.result).toBeGreaterThan(0);
        expect(Relationships._npcs.includes(npc)).toBe(false);
        expect(m.unbooked).toBe(0);
        expect(m.delta).toBe(0);
    }, 120000);
});

describe("a fallen realm's chests", () => {
    /** Realm b falls to a: its towns go over, then the collapse. */
    function fall(world, a, b) {
        for (const v of world.getSettlementViews().filter(x => x.kingdom === b.id)) {
            const t = world.getTile(v.q, v.r);
            t.settlement.kingdom = a.id;
            t.kingdom = a.id;
            t.settlement.formerKingdom = b.id;
        }
        KingdomAI._collapse(b, a, world);
    }
    const unbooked = (g) => CoinCensus.total(g.world, g.player).total - MoneySupply.bookedChange(g.world);

    it('a save and reload keeps the emptied royal bank empty, and the census with it', () => {
        let g = coinGame(101, 2);
        const [a, b] = g.world.kingdoms.filter(k => k.isAlive);
        expect(b.royalBank.treasury).toBeGreaterThan(0);
        fall(g.world, a, b);
        expect(b.royalBank.treasury).toBe(0);
        const u0 = unbooked(g);
        g = roundTrip(g);
        const b2 = g.world.kingdoms.find(k => k.id === b.id);
        expect(b2.royalBank.treasury).toBe(0);
        expect(Math.abs(unbooked(g) - u0)).toBeLessThan(0.01);
        // ...and an alive realm's vault comes back as it was
        const a2 = g.world.kingdoms.find(k => k.id === a.id);
        expect(a2.royalBank.treasury).toBe(a.royalBank.treasury);
    }, 120000);

    it('coin paid into a fallen crown goes on to its conqueror', () => {
        const g = coinGame(101, 2);
        const { world, player } = g;
        const [a, b] = world.kingdoms.filter(k => k.isAlive);
        fall(world, a, b);
        const before = a.treasury;
        b.treasury = 250;
        const m = measure(world, player, () => KingdomAI.processRestorations(world));
        expect(b.treasury).toBe(0);
        expect(a.treasury).toBeCloseTo(before + 250, 2);
        // (the 250 was out of the census in the dead chest: back in it now)
        expect(m.delta).toBeCloseTo(250, 2);
    }, 120000);
});

// ── 2026-11-17, second pass: the royal bank's job, the bakers, a great lord's land ──

describe("the royal bank is the crown's reserve", () => {
    /** A realm with its books on record: `exp` a day of spending, `treasury` and `vault` set. */
    function realm(g, { exp = 100, treasury = 0, vault = 5000 } = {}) {
        const k = g.world.kingdoms.find(x => x.isAlive);
        const f = CrownBooks.state(k);
        f.avg = { n: 30, rev: exp, exp, demesne: 0, purse: 0 };
        f.arrears = { army: 0, court: 0 };
        k.wars = [];
        k.treasury = treasury;
        k.royalBank.treasury = vault;
        return { k, f };
    }

    it('a crown with its chests run low draws on its bank: booked on the reserve line, coin conserved', () => {
        const g = coinGame(101, 2);
        const { k, f } = realm(g, { treasury: 100, vault: 5000 });
        const m = measure(g.world, g.player, () => Fiscal._reserve(g.world, k, f));
        expect(m.result).toBeGreaterThan(0);
        expect(k.royalBank.treasury).toBeCloseTo(5000 - m.result, 2);
        expect(k.treasury).toBeCloseTo(100 + m.result, 2);
        expect(f.day.reserve).toBeCloseTo(m.result, 2);
        expect(Math.abs(m.unbooked)).toBeLessThan(0.01);
        // (the books' 'other' line leaves it out: a draw is financing, not a mystery)
        expect(CrownBooks.FINANCE_LINES).toContain('reserve');
    }, 120000);

    it('a crown with its soldiers unpaid draws too; a flush one lays its surplus by, up to the mark', () => {
        const g = coinGame(101, 2);
        const { k, f } = realm(g, { treasury: 5000, vault: 3000 });
        f.arrears.army = 300;
        expect(Fiscal._reserve(g.world, k, f)).toBeGreaterThan(0);
        f.arrears.army = 0;
        k.treasury = 100 * 400;
        k.royalBank.treasury = 100;
        const before = k.royalBank.treasury;
        const laid = Fiscal._reserve(g.world, k, f);
        expect(laid).toBeLessThan(0);
        expect(k.royalBank.treasury).toBeCloseTo(before - laid, 2);
        expect(f.stats.reserveLaid).toBeGreaterThan(0);
    }, 120000);

    it('is bounded: a year of deficit never empties it, and a vault far past its mark is let back out', () => {
        const g = coinGame(101, 2);
        const { k, f } = realm(g, { treasury: 0, vault: 6000 });
        for (let w = 0; w < 52; w++) { k.treasury = 0; Fiscal._reserve(g.world, k, f); }
        // (never drawn below `keep` of its mark, at most drawShare of it a week)
        expect(k.royalBank.treasury).toBeGreaterThan(0);
        const R = Fiscal.config().reserve;
        const v = k.royalBank.treasury;
        k.treasury = 0;
        const d = Fiscal._reserve(g.world, k, f);
        expect(d).toBeLessThanOrEqual(v * R.drawShare + 0.01);
        // A vault ten times its mark lets some of it go each week (no hoard)
        k.treasury = 100 * 40;
        k.royalBank.treasury = 100 * R.markDays * 10;
        const out = Fiscal._reserve(g.world, k, f);
        expect(out).toBeGreaterThan(0);
    }, 120000);

    it('over two years of play the vaults are drawn and refilled, the census closed', () => {
        const g = coinGame(303, 1);
        const c0 = CoinCensus.total(g.world, g.player).total;
        const b0 = MoneySupply.bookedChange(g.world);
        for (let i = 0; i < 240; i++) { g.player.inventory.bread = 20; g.player.health = 100; endDay(g); }
        const alive = g.world.kingdoms.filter(k => k.isAlive);
        const drawn = alive.reduce((s, k) => s + (Number(k.fisc.stats.reserveDrawn) || 0), 0);
        expect(drawn).toBeGreaterThan(0);
        for (const k of alive) expect(k.royalBank.treasury).toBeGreaterThan(0);
        const c1 = CoinCensus.total(g.world, g.player).total;
        const unbooked = (c1 - c0) - (MoneySupply.bookedChange(g.world) - b0);
        expect(Math.abs(unbooked)).toBeLessThan(25);
    }, 600000);
});

describe('the bakers keep up with the bread', () => {
    it("a town's mill and bakery can make more than a turn's eating, so a run-down stock is baked back up", () => {
        const M = DataLoader._gamedata.markets;
        const bake = M.recipes.find(r => r.id === 'bakery');
        const mill = M.recipes.find(r => r.id === 'mill');
        const bread = M.goods.bread;
        // loaves per 1000 a day against the need of a city (typeDemand) and a day's staling of the target
        const td = Math.max(...Object.values(M.typeDemand));
        const want = 1000 * bread.perCapita * td * (1 + bread.spoil * bread.days);
        expect(bake.cap * bake.out.bread).toBeGreaterThan(want * 1.2);
        expect(mill.cap * mill.out.flour).toBeGreaterThanOrEqual(bake.cap * bake.in.flour);
    });
});

describe("a great lord's own estates on the first day", () => {
    it('show their tenants, crop and worth before any month has turned, and no coin moves', () => {
        const g = newGame(81);
        const m = measure(g.world, g.player, () => Scenarios.apply(g.player, g.world, { origin: 'great_lord' }));
        const mine = Estates.heldBy(g.world, 'player');
        expect(mine.length).toBeGreaterThan(0);
        for (const e of mine) {
            expect(e.hh).toBeGreaterThan(0);
            expect(e.avg).toBeGreaterThan(0);
            expect(e.value).toBeGreaterThan(0);
            expect(LandMarket.value(g.world, e)).toBeGreaterThan(0);
            expect(LandMarket.monthlyRent(g.world, e)).toBeGreaterThan(0);
            // as the town's month would set them
            expect(e.hh).toBe(Estates.households(g.world, e));
        }
        // The seat's library holds the rolls of the player's own House (the start makes them its
        // head); the house whose lands they were is named on its first page, not its title
        const roll = (g.player.library.books || []).find(b => b && b.kind === 'roll');
        expect(roll).toBeTruthy();
        expect(roll.title).toBe(`The Rolls of ${g.player.house.name}`);
        const from = g.player.scenario.start.house;
        if (from && from !== g.player.house.name) expect(roll.pages[0]).toContain(`the lands of ${from}`);
        // (the start's purse is the origin's own; the land survey moved nothing)
        expect(Math.abs(m.unbooked - (m.delta - m.booked))).toBeLessThan(0.01);
        const s0 = CoinCensus.total(g.world, g.player).total;
        LandMarket.surveyHeld(g.world, 'player');
        expect(CoinCensus.total(g.world, g.player).total).toBeCloseTo(s0, 2);
    }, 120000);
});

describe('the residual drift (2026-11-17)', () => {
    it("a player's lease worked at a loss takes the hands' wages to the cent, not a whole coin rounded up into no one's purse", () => {
        const g = coinGame(101, 2);
        const t = coinTowns(g.world)[0];
        const home = t.settlement;
        home.labour = home.labour || {};
        home.labour.wage = { ...(home.labour.wage || {}), land: 0.37 };
        g.player.gold = 500;
        const c = { id: 'Ctest', holder: 'player', rate: 'light', royalty: 0, kingdomId: home.kingdom };
        const site = { id: 'Stest', hire: 3, dug: 0 };
        const out = { income: 0, wages: 0, royalties: 0, news: [] };
        const m = measure(g.world, g.player, () => Concessions._leaseTurn(g.world, g.player, c, site, {}, {}, home, home, 1, g.world.day, out));
        // (3 hands at 0.37: 1.11g out of the purse and into the home town, not 2g)
        expect(out.wages).toBeCloseTo(1.11, 2);
        expect(Math.abs(m.unbooked)).toBeLessThan(0.005);
    }, 120000);
});

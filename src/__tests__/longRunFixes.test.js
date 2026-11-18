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
import { loadData, endDay, roundTrip } from './playtest/harness.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { MoneySupply } from '../world/moneySupply.js';
import { coinGame, measure } from './playtest/coinCheck.js';

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

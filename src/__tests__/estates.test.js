/**
 * Land, Estates & the Putting-Out System (world/estates.js,
 * systems/landMarket.js, systems/puttingOut.js): estates derived as shares of
 * every town's farmland (a hash, no RNG), the production hook that changes a
 * town's crops only by what holders change (no double-counted harvest),
 * rents from the town's own coin (no money creation), land values over the
 * realm's land rate, rents and loyalty, flight and enclosure moving people
 * (conserved), the land market (distress sales, NPC buyers, the player's
 * purchases and sales losing on a round trip), confiscation and cession, the
 * putting-out batches (seasons, guild resistance, the houses' weekly work,
 * the fields' draw), flax and linen in the market, the heralds' and the
 * townsfolk's news, the counsel, saving and determinism.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Estates } from '../world/estates.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Harvests } from '../world/harvests.js';
import { TownLabour } from '../world/townLabour.js';
import { Seasons } from '../world/seasons.js';
import { LandMarket } from '../systems/landMarket.js';
import { PuttingOut } from '../systems/puttingOut.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { Ledger } from '../systems/ledger.js';
import { Counsel } from '../systems/counsel.js';
import { Chatter } from '../systems/chatter.js';
import { Heralds } from '../systems/heralds.js';
import { Guilds } from '../systems/guilds.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let _saved = null;
function patch(path, value) {
    if (!_saved) _saved = JSON.parse(JSON.stringify(DataLoader._gamedata.estates));
    const d = JSON.parse(JSON.stringify(DataLoader._gamedata.estates));
    const keys = path.split('.');
    let o = d;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = value;
    DataLoader._gamedata.estates = d;
}
afterEach(() => {
    if (_saved) DataLoader._gamedata.estates = _saved;
    _saved = null;
});

const live = (w, s) => (w.getTile(s.q, s.r) || {}).settlement;
const towns = (w) => w.getSettlementViews().map(v => live(w, v)).filter(Boolean);
function play(g, days) {
    for (let d = 0; d < days; d++) {
        g.player.health = 100;
        g.player.inventory.bread = 40;
        endDay(g);
    }
}
/** A town with a market profile and estates, preferring `type`. */
function townWith(w, type = 'town') {
    const all = towns(w).filter(s => s.market && Array.isArray(s.market.prod) && Estates.estatesOf(w, s.q, s.r).length);
    return all.find(s => s.type === type) || all.sort((a, b) => b.population - a.population)[0];
}
function giveEstate(g, s) {
    const e = Estates.estatesOf(g.world, s.q, s.r)[0];
    Estates.setHolder(g.world, e, 'player');
    return e;
}
const sumPop = (w) => towns(w).reduce((a, s) => a + s.population, 0);

let G = null;
beforeAll(async () => {
    await loadData();
    G = newGame(101);
    play(G, 12);
}, 120000);

describe('the estates about the towns', () => {
    it('every settlement has its estates, shares of its farmland that sum to one, held by crown, nobles, church, burghers or houses', () => {
        const w = G.world;
        const st = w.estates;
        Estates.derive(w, w.day); // (towns founded since the last survey)
        for (const s of towns(w)) {
            expect(Estates.town(w, s.q, s.r)).toBeTruthy();
            const ests = Estates.estatesOf(w, s.q, s.r);
            expect(ests.length).toBeGreaterThanOrEqual(1);
            expect(ests.length).toBeLessThanOrEqual(4);
            expect(ests.reduce((a, e) => a + e.share, 0)).toBeCloseTo(1, 2);
            for (const e of ests) expect(['crown', 'noble', 'church', 'town', 'house']).toContain(Estates.kindOf(e.holder));
            if (s.type === 'capital' && s.kingdom != null) expect(ests[0].holder).toBe(`crown:${s.kingdom}`);
        }
        const kinds = new Set(Object.values(st.estates).map(e => Estates.kindOf(e.holder)));
        expect(kinds.size).toBeGreaterThanOrEqual(4);
    });

    it('derives from a hash of the seed: the same world gets the same estates, and no RNG is drawn', () => {
        const a = newGame(202);
        const b = newGame(202);
        Utils.setSeed(77);
        Estates.derive(a.world, 1);
        const r1 = Utils.random();
        Utils.setSeed(77);
        const r0 = Utils.random();
        expect(r1).toBe(r0);
        Estates.derive(b.world, 1);
        expect(JSON.stringify(a.world.estates.estates)).toBe(JSON.stringify(b.world.estates.estates));
    });
});

describe('the harvest is not counted twice', () => {
    it('a town whose estates are as they were makes exactly what it did', () => {
        const w = G.world;
        for (const s of towns(w).filter(x => Estates.town(w, x.q, x.r)).slice(0, 12)) {
            // (no cottage work out of season drawing on the fields, either)
            const rec = Estates.town(w, s.q, s.r);
            const draw = rec.draw;
            rec.draw = 0;
            const prod = { grain: 10, flax: 2, wine: 1, wool: 3 };
            const out = Estates.applyToProduction(w, s, { ...prod });
            rec.draw = draw;
            expect(out).toEqual(prod);
        }
    });

    it('the estates\' crops are their shares of the town\'s farm crops, never more', () => {
        const w = G.world;
        const s = townWith(w);
        const rec = Estates.town(w, s.q, s.r);
        expect(rec.base && rec.base.grain).toBeGreaterThan(0);
        let grain = 0;
        for (const e of Estates.estatesOf(w, s.q, s.r)) grain += Estates.output(w, e, s).goods.grain || 0;
        expect(grain).toBeCloseTo(rec.base.grain * Estates.config().derive.estateShare, 3);
        expect(grain).toBeLessThan(rec.base.grain);
    });

    it('the market tick with the estates gives the same profiles as without them', () => {
        // (the cottagers' work out of season does take hands from the fields: not here)
        patch('puttingOut.npcShare', 0);
        const a = newGame(303);
        play(a, 6);
        DataLoader._gamedata.estates = _saved;
        _saved = null;
        const b = newGame(303);
        patch('enabled', false);
        play(b, 6);
        DataLoader._gamedata.estates = _saved;
        _saved = null;
        const pa = towns(a.world).map(s => (s.market.prod || []).join(','));
        const pb = towns(b.world).map(s => (s.market.prod || []).join(','));
        expect(pa).toEqual(pb);
        expect(Object.keys(a.world.estates.estates).length).toBeGreaterThan(0);
    });

    it('drainage raises the town\'s crops by the estate\'s share; enclosure trades grain for wool', () => {
        const w = G.world;
        const s = townWith(w);
        const rec = Estates.town(w, s.q, s.r);
        const e = Estates.estatesOf(w, s.q, s.r)[0];
        const sh = Estates.config().derive.estateShare * e.share;
        const base = { ...rec.base };
        const old = { soil: e.soil, enclosed: e.enclosed };
        e.soil = 1.1;
        const p1 = Estates.applyToProduction(w, s, { grain: base.grain, flax: base.flax, wine: base.wine });
        expect(p1.grain).toBeCloseTo(base.grain * (1 + sh * 0.1), 3);
        e.soil = 1;
        e.enclosed = 1;
        const p2 = Estates.applyToProduction(w, s, { grain: base.grain, flax: base.flax, wine: base.wine, wool: 0 });
        expect(p2.grain).toBeCloseTo(base.grain * (1 - sh), 3);
        expect(p2.wool).toBeGreaterThan(0);
        Object.assign(e, old);
    });
});

describe('rents, values and the tenants', () => {
    it('the player\'s rent comes out of the town\'s own coin and through the Ledger: no money is made', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const s = townWith(w);
        const e = giveEstate(g, s);
        s.economy.gold = 100000;
        const rec = Estates.town(w, s.q, s.r);
        const gold0 = g.player.gold, town0 = s.economy.gold;
        LandMarket._townMonth(w, g.player, rec, w.day, { notices: [] });
        const got = g.player.gold - gold0;
        expect(got).toBeGreaterThan(0);
        expect(town0 - s.economy.gold).toBe(got);
        expect(Ledger.today(g.player).income.estateRents).toBe(got);
        // ...and never more than the crop's worth: a month's rent is a share of its gross
        const gross = Estates.output(w, e, s).gross * 30;
        expect(got).toBeLessThanOrEqual(gross * Estates.config().rent.capacity);
        // A town without coin pays nothing
        s.economy.gold = 0;
        const g1 = g.player.gold;
        LandMarket._townMonth(w, g.player, rec, w.day + 30, { notices: [] });
        expect(g.player.gold).toBe(g1);
    });

    it('a coin rent falls into arrears in a bad year; a share of the crop follows it down', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const s = townWith(w);
        const e = giveEstate(g, s);
        s.economy.gold = 100000;
        const rec = Estates.town(w, s.q, s.r);
        LandMarket._townMonth(w, g.player, rec, w.day, { notices: [] });
        const normal = e.lastRent;
        // The crop fails: half the grain, flax and wine
        for (const k of Object.keys(rec.base)) rec.base[k] *= 0.4;
        e.mode = 'coin';
        LandMarket._townMonth(w, g.player, rec, w.day + 30, { notices: [] });
        expect(e.arrears).toBeGreaterThan(0);
        e.mode = 'kind';
        e.arrears = 0;
        e.avg = null;
        LandMarket._townMonth(w, g.player, rec, w.day + 60, { notices: [] });
        expect(e.arrears).toBe(0);
        expect(e.lastRent).toBeLessThan(normal);
    });

    it('land is worth its yearly net rent over the realm\'s land rate, which follows the crown\'s bond rate', () => {
        const w = G.world;
        const s = towns(w).find(x => x.kingdom != null && Estates.estatesOf(w, x.q, x.r).length);
        const e = Estates.estatesOf(w, s.q, s.r)[0];
        const k = w.getKingdom(s.kingdom);
        const rate = LandMarket.landRate(w, k.id);
        expect(rate).toBeGreaterThanOrEqual(0.04);
        expect(rate).toBeLessThanOrEqual(0.09);
        expect(LandMarket.value(w, e, s)).toBe(Math.round(LandMarket.annualRent(w, e, s) / rate));
        const f = k.finance || (k.finance = {});
        const old = f.debtRatio;
        f.debtRatio = 1.2;
        expect(LandMarket.landRate(w, k.id)).toBeGreaterThan(rate);
        expect(LandMarket.value(w, e, s)).toBeLessThan(Math.round(LandMarket.annualRent(w, e, s) / rate));
        f.debtRatio = old;
    });

    it('returns 4-8% a year on the price paid in a normal year', () => {
        const w = G.world;
        let n = 0;
        for (const s of towns(w)) {
            for (const e of Estates.estatesOf(w, s.q, s.r)) {
                const q = LandMarket.buyQuote(G.player, w, e.id);
                if (!q.ok) continue;
                const ret = LandMarket.annualRent(w, e, s) / q.cost;
                expect(ret).toBeGreaterThan(0.03);
                expect(ret).toBeLessThan(0.09);
                n++;
            }
        }
        expect(n).toBeGreaterThan(10);
    });

    it('high rents drive tenants to the next town (people conserved) and sour them; low rents content them', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const s = townWith(w, 'village');
        const e = giveEstate(g, s);
        s.economy.gold = 100000;
        const rec = Estates.town(w, s.q, s.r);
        const pop0 = sumPop(w), here0 = s.population;
        LandMarket.setRent(g.player, w, e.id, 'high');
        for (let m = 0; m < 4; m++) LandMarket._townMonth(w, g.player, rec, w.day + m * 30, { notices: [] });
        expect(e.loyalty).toBeLessThan(45);
        expect(s.population).toBeLessThan(here0);
        expect(sumPop(w)).toBe(pop0);
        LandMarket.setRent(g.player, w, e.id, 'low');
        for (let m = 4; m < 10; m++) LandMarket._townMonth(w, g.player, rec, w.day + m * 30, { notices: [] });
        expect(e.loyalty).toBeGreaterThan(65);
    });

    it('enclosure turns tenants out to a town (people conserved) and may raise a riot', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const s = townWith(w, 'village');
        const e = giveEstate(g, s);
        g.player.gold = 50000;
        const q = LandMarket.worksQuote(g.player, w, e.id, 'enclose');
        expect(q.ok).toBe(true);
        const town0 = s.economy.gold;
        expect(LandMarket.improve(g.player, w, e.id, 'enclose').success).toBe(true);
        expect(s.economy.gold - town0).toBe(Math.round(q.cost * Estates.config().works.wageShare));
        const pop0 = sumPop(w), here0 = s.population, hh0 = e.hh || Estates.households(w, e, s);
        w.day = e.works.until;
        LandMarket._playerDay(w, g.player, w.day, { notices: [] });
        expect(e.enclosed).toBe(1);
        expect(s.population).toBeLessThan(here0);
        expect(sumPop(w)).toBe(pop0);
        expect(Estates.households(w, e, s)).toBeLessThan(hh0);
        expect(Estates.history(w).some(h => h.kind === 'enclosure' && h.own)).toBe(true);
    });
});

describe('the land market', () => {
    it('buying pays the seller and the crown\'s duty; selling back at once loses: no money loop', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const s = towns(w).find(x => x.kingdom != null && Estates.estatesOf(w, x.q, x.r).some(e => Estates.kindOf(e.holder) === 'noble'));
        const e = Estates.estatesOf(w, s.q, s.r).find(x => Estates.kindOf(x.holder) === 'noble');
        const seller = Estates.ensureHolder(w, e.holder);
        seller.purse = 0;
        const k = w.getKingdom(s.kingdom);
        const q = LandMarket.buyQuote(g.player, w, e.id);
        expect(q.ok).toBe(true);
        g.player.gold = q.cost + 10;
        const t0 = k.treasury;
        expect(LandMarket.buy(g.player, w, e.id).success).toBe(true);
        expect(g.player.gold).toBe(10);
        expect(seller.purse).toBe(q.price);
        expect(k.treasury - t0).toBe(q.duty);
        expect(Ledger.today(g.player).income.estatesBought).toBe(-q.cost);
        // A rich buyer about takes it at the quick price — less than was paid
        const rich = Estates.ensureHolder(w, 'house:orsini');
        rich.purse = 1e7;
        rich.debt = 0;
        const sq = LandMarket.sellQuote(g.player, w, e.id);
        const r = LandMarket.sell(g.player, w, e.id, 'quick');
        expect(r.success).toBe(true);
        expect(g.player.gold - 10).toBe(sq.quick);
        expect(sq.quick).toBeLessThan(q.cost);
        expect(rich.purse).toBe(1e7 - sq.quick);
    });

    it('a noble deep in debt puts land on the market; after a week the richest purse buys it, gold conserved', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const e = Object.values(w.estates.estates).find(x => Estates.kindOf(x.holder) === 'noble');
        const h = Estates.ensureHolder(w, e.holder);
        for (const x of Estates.heldBy(w, h.id)) x.value = LandMarket.value(w, x);
        h.purse = 0;
        h.debt = 1e6;
        h.inc = 0;
        LandMarket._holderMonth(w, g.player, h, w.day, { notices: [] });
        const x = w.estates.sales.find(y => y.seller === h.id);
        expect(x).toBeTruthy();
        expect(x.reason).toBe('debts');
        const buyer = Estates.ensureHolder(w, 'house:orsini');
        buyer.purse = 1e7;
        buyer.debt = 0;
        const sold = Estates.estate(w, x.id);
        const before = buyer.purse + h.purse;
        for (let d = 0; d <= 12; d++) LandMarket._sales(w, g.player, x.day + d, { notices: [] });
        expect(sold.holder).not.toBe(h.id);
        const nb = Estates.holder(w, sold.holder);
        expect(nb.purse).toBeGreaterThanOrEqual(0);
        expect(buyer.purse + h.purse).toBe(before);
        expect(Estates.history(w).some(r => r.kind === 'sold' && r.estate === sold.name)).toBe(true);
    });

    it('conquest passes the old crown\'s and nobles\' land to the new crown; a hostile realm confiscates the player\'s', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const s = towns(w).find(x => x.kingdom != null && Estates.estatesOf(w, x.q, x.r).length >= 2);
        const ests = Estates.estatesOf(w, s.q, s.r);
        Estates.setHolder(w, ests[0], 'player');
        Estates.setHolder(w, ests[1], `noble:${s.kingdom}:0`);
        const other = w.kingdoms.find(k => k.id !== s.kingdom && k.isAlive !== false);
        g.player.reputation = { ...(g.player.reputation || {}), [other.id]: -50 };
        const rec = Estates.town(w, s.q, s.r);
        s.kingdom = other.id;
        const out = { notices: [] };
        LandMarket._townMonth(w, g.player, rec, w.day, out);
        expect(ests[1].holder).toBe(`crown:${other.id}`);
        expect(ests[0].holder).toBe(`crown:${other.id}`);
        expect(out.notices.some(n => n.title === 'Estate Confiscated')).toBe(true);
    });

    it('a realm that loses a war may cede its best crown estate to the victor', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        patch('war.cedeChance', 1);
        const e = Object.values(w.estates.estates).find(x => Estates.kindOf(x.holder) === 'crown');
        const loser = e.holder.slice(6);
        const victor = w.kingdoms.find(k => String(k.id) !== loser && k.isAlive !== false);
        w.warHistory = w.warHistory || [];
        w.estates.warSeq = 999;
        w.warHistory.push({ id: 1000, day: w.day, a: victor.id, b: loser, victor: victor.id, tribute: 0 });
        LandMarket._warTerms(w, g.player, w.day, { notices: [] });
        expect(Estates.heldBy(w, `crown:${victor.id}`).length).toBeGreaterThan(0);
        expect(Estates.history(w).some(h => h.kind === 'ceded')).toBe(true);
    });

    it('an estate settled as a dowry buys reputation in the realm', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const s = towns(w).find(x => x.kingdom != null && Estates.estatesOf(w, x.q, x.r).length);
        const e = giveEstate(g, s);
        const rep0 = (g.player.reputation && g.player.reputation[s.kingdom]) || 0;
        const r = LandMarket.dowry(g.player, w, e.id, s.kingdom);
        expect(r.success).toBe(true);
        expect(Estates.kindOf(e.holder)).toBe('noble');
        expect(g.player.reputation[s.kingdom]).toBeGreaterThan(rep0);
    });
});

describe('the putting-out system', () => {
    function setup(type = 'village') {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const s = townWith(w, type);
        const tile = w.getTile(s.q, s.r);
        g.player.q = s.q; g.player.r = s.r;
        g.player.gold = 5000;
        g.player.inventory.wool = 60;
        return { g, w, s, tile };
    }

    it('wool goes out, the piece wages go to the households, cloth comes back: faster in winter than at harvest', () => {
        const { g, w, s, tile } = setup();
        const town0 = s.economy.gold;
        const winter = 91;
        w.day = winter;
        const r = PuttingOut.putOut(g.player, w, tile, 'wool', 20, 'fair');
        expect(r.success).toBe(true);
        expect(g.player.inventory.wool).toBe(40);
        expect(s.economy.gold - town0).toBe(r.batch.wage);
        expect(Ledger.today(g.player).expenses.puttingOut).toBe(r.batch.wage);
        let d = 0;
        while (!r.batch.done && d < 200) { w.day = winter + d; PuttingOut.processDay(w, g.player); d++; }
        const summer = 31 + 120;
        w.day = summer;
        const r2 = PuttingOut.putOut(g.player, w, tile, 'wool', 20, 'fair');
        expect(r2.success).toBe(true);
        let d2 = 0;
        while (!r2.batch.done && d2 < 400) { w.day = summer + d2; PuttingOut.processDay(w, g.player); d2++; }
        expect(r.batch.done).toBe(true);
        expect(d).toBeLessThan(d2);
        // Collect: cloth at the ratio × the quality, never more fibre than went in
        const tex0 = g.player.inventory.textiles || 0;
        const c = PuttingOut.collect(g.player, w, tile);
        expect(c.success).toBe(true);
        const got = (g.player.inventory.textiles || 0) - tex0;
        expect(got).toBeGreaterThan(0);
        expect(got).toBeLessThanOrEqual(40 * 0.9 * 1.05);
    });

    it('a chartered weavers\' guild seizes cloth and fines the merchant; the guild\'s men are let be', () => {
        const { g, w, s, tile } = setup('town');
        Guilds.ensureTown(w, s, w.day);
        let gd = Guilds.guild(s, 'weavers');
        if (!gd) gd = Guilds._form(s, 'weavers', w.day, { chartered: true });
        gd.chartered = true;
        patch('puttingOut.chartered.chance', 1);
        w.day = 91;
        const r = PuttingOut.putOut(g.player, w, tile, 'wool', 30, 'fair');
        expect(r.success).toBe(true);
        r.batch.done = true;
        r.batch.units = 27;
        r.batch.readyDay = w.day;
        const hall = gd.treasury, gold0 = g.player.gold;
        const c = PuttingOut.collect(g.player, w, tile);
        expect(c.text).toMatch(/seized/);
        expect(g.player.gold).toBeLessThan(gold0);
        expect(gd.treasury - hall).toBe(gold0 - g.player.gold);
        expect(g.player.inventory.textiles).toBeLessThan(27);
    });

    it('the merchant houses put out a town\'s surplus wool and bring the cloth a week later: nothing made from nothing', () => {
        const { w, s } = setup('village');
        const rec = Estates.town(w, s.q, s.r);
        w.day = 95;
        s.market.stock.wool = SettlementMarket.target(s, 'wool') * 3;
        s.market.stock.textiles = 0;
        const wool0 = s.market.stock.wool;
        PuttingOut._npcWeek(w, null, rec, w.day);
        const took = wool0 - s.market.stock.wool;
        expect(took).toBeGreaterThan(0);
        expect(rec.npcOut.textiles).toBeLessThanOrEqual(took * 0.9);
        const tex = s.market.stock.textiles;
        PuttingOut._npcWeek(w, null, rec, w.day + 7);
        expect(s.market.stock.textiles - tex).toBeCloseTo(took * 0.9 * 0.95, 1);
    });

    it('out of the slack season the cottage work draws hands from the fields; in winter it does not', () => {
        const { g, w, s, tile } = setup('village');
        const rec = Estates.town(w, s.q, s.r);
        w.day = 125; // spring
        expect(PuttingOut.putOut(g.player, w, tile, 'wool', 40, 'generous').success).toBe(true);
        PuttingOut.processDay(w, g.player);
        expect(rec.draw).toBeGreaterThan(0);
        const base = { ...rec.base };
        const p = Estates.applyToProduction(w, s, { grain: base.grain, flax: base.flax, wine: base.wine });
        expect(p.grain).toBeLessThan(base.grain);
        w.day = 211; // winter
        PuttingOut.processDay(w, g.player);
        expect(rec.draw).toBe(0);
    });
});

describe('flax and linen', () => {
    it('the flax fields bring flax to market (not textiles), the linen weavers and the classes want linen', () => {
        expect(SettlementMarket.tracks('flax')).toBe(true);
        expect(SettlementMarket.tracks('linen')).toBe(true);
        expect(SettlementMarket.recipe('linen_weaver')).toBeTruthy();
        const w = G.world;
        const s = townWith(w, 'city') || townWith(w);
        const p = Harvests.applyToProduction(w, s, { grain: 5 });
        expect(p.flax).toBeGreaterThan(0);
        expect(p.textiles || 0).toBe(0);
        const B = TownLabour.config().baskets;
        expect(B.nobles.linen).toBeGreaterThan(B.peasants.linen);
        expect(SettlementMarket.need(s, 'linen')).toBeGreaterThan(0);
    });
});

describe('news, talk and counsel', () => {
    it('the heralds proclaim an enclosure riot; townsfolk talk of enclosures and the cottage looms', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const s = townWith(w, 'village');
        const e = Estates.estatesOf(w, s.q, s.r)[0];
        e.loyalty = 0;
        LandMarket._enclose(w, null, e, s, w.day, { notices: [] }, false);
        expect(Estates.history(w).some(h => h.kind === 'riot')).toBe(true);
        const t = Estates.talk(w, s);
        expect(t.labour).toContain('enclosure');
        expect(t.labour).toContain('enclosure_riot');
        g.player.q = s.q; g.player.r = s.r;
        w.day += 1;
        Heralds.processDay(w, g.player);
        const st = g.player.heralds;
        expect(st.list.some(p => p.kind === 'estate_riot')).toBe(true);
        expect(Chatter.validate ? Chatter.validate() : []).toEqual([]);
    });

    it('the counsel points at land for sale, restless tenants and cloth to collect', () => {
        const g = newGame(101);
        play(g, 8);
        const w = g.world;
        const s = townWith(w);
        g.player.q = s.q; g.player.r = s.r;
        g.player.gold = 1e6;
        const e = Estates.estatesOf(w, s.q, s.r)[0];
        const value = LandMarket.value(w, e, s);
        LandMarket._list(w, e, Math.round(value * 0.9), e.holder, 'debts', w.day);
        const e2 = Estates.estatesOf(w, s.q, s.r)[1] || null;
        if (e2) { Estates.setHolder(w, e2, 'player'); e2.loyalty = 10; }
        LandMarket.playerState(g.player).batches.push({ id: 'P99', town: `${s.q},${s.r}`, q: s.q, r: s.r, name: s.name, input: 'wool', output: 'textiles', qty: 10, worked: 10, rate: 'fair', wage: 5, quality: 1, start: 1, done: true, readyDay: w.day, basis: 0, units: 9 });
        const items = Counsel.scan(g.player, w, { fresh: true });
        const ids = JSON.stringify(items);
        expect(ids).toMatch(/estate_for_sale/);
        expect(ids).toMatch(/cloth_ready/);
        if (e2) expect(ids).toMatch(/estate_unrest/);
    });
});

describe('saving and determinism', () => {
    it('a save carries the estates, the land market and the work put out; an old save derives them anew', () => {
        const g = newGame(101);
        play(g, 8);
        const s = townWith(g.world, 'village');
        giveEstate(g, s);
        g.player.q = s.q; g.player.r = s.r;
        g.player.inventory.wool = 30;
        g.player.gold = 2000;
        g.world.day = 95;
        PuttingOut.putOut(g.player, g.world, g.world.getTile(s.q, s.r), 'wool', 20, 'fair');
        const g2 = roundTrip(g);
        expect(JSON.stringify(g2.world.estates)).toBe(JSON.stringify(g.world.estates));
        expect(g2.player.land.batches.length).toBe(1);
        expect(LandMarket.mine(g2.player, g2.world).length).toBe(1);
        // An old save: no estates — derived on the next day
        Estates.restore(null, g2.world);
        LandMarket.processDay(g2.world, g2.player);
        expect(Object.keys(g2.world.estates.estates).length).toBeGreaterThan(0);
    });

    it('two runs of a seed hold the same land', () => {
        const a = newGame(404);
        play(a, 40);
        const b = newGame(404);
        play(b, 40);
        expect(JSON.stringify(a.world.estates)).toBe(JSON.stringify(b.world.estates));
        expect(Seasons.dayOfYear(a.world.day)).toBe(Seasons.dayOfYear(b.world.day));
    });
});

describe('the daily tick is cheap', () => {
    it('the land market and the cottage work cost a small share of the market tick', () => {
        const w = G.world;
        const p = G.player;
        const d0 = w.day;
        // (the best of three rounds, after a warm-up: the machine may be busy)
        const round = () => {
            const t0 = performance.now();
            for (let i = 0; i < 20; i++) MarketDynamics.updatePrices(w, p);
            const mkt = (performance.now() - t0) / 20;
            const t1 = performance.now();
            for (let i = 0; i < 60; i++) { w.day = d0 + i; LandMarket.processDay(w, p); PuttingOut.processDay(w, p); }
            w.day = d0;
            return { mkt, land: (performance.now() - t1) / 60 };
        };
        round();
        const rs = [round(), round(), round()];
        const best = Math.min(...rs.map(r => r.land / r.mkt));
        expect(best).toBeLessThan(0.3);
    });
});

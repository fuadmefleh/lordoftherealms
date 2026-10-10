// The Crown's Purse (systems/fiscal.js, world/crownBooks.js): taxes out of
// the towns' purses, wages back into them, arrears and desertion, tax farms,
// tax revolts, NPC tax reviews, the books Finance reads, save and load.
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { CrownBooks } from '../world/crownBooks.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomStability } from '../world/kingdomState.js';
import { Fiscal } from '../systems/fiscal.js';
import { Finance } from '../systems/finance.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

function play(game, days) {
    for (let d = 0; d < days; d++) {
        game.player.health = 100;
        game.player.starvationDays = 0;
        game.player.inventory.bread = 30;
        endDay(game);
    }
    return game;
}

let _base = null;
/** A world 40 days in (labour, markets and the books running); a fresh copy each time. */
function world40() {
    if (!_base) _base = play(newGame(101), 40);
    return roundTrip(_base);
}

function townsOf(world, k) {
    return world.getAllSettlements().filter(s => s.kingdom === k.id).map(s => world.getTile(s.q, s.r).settlement);
}

function bigRealm(world) {
    return world.kingdoms.filter(k => k.isAlive).map(k => ({ k, n: townsOf(world, k).length })).sort((a, b) => b.n - a.n)[0].k;
}

/** Every coin the fiscal day could move between: town purses, treasuries, banks, the player, bids held. */
function moneyTotal(game) {
    const { world, player } = game;
    let t = 0;
    for (const s of world.getAllSettlements()) {
        const live = world.getTile(s.q, s.r).settlement;
        t += (live.economy && live.economy.gold) || 0;
    }
    for (const k of world.kingdoms) t += k.treasury || 0;
    for (const b of Finance.state(player).banks) t += b.capital || 0;
    t += player.gold || 0;
    for (const lot of Fiscal.state(world).lots) t += lot.player ? lot.player.bid : 0;
    return t;
}

/** No tax farms or auctions in a realm (so its towns pay the crown). */
function unfarm(world, k) {
    const st = Fiscal.state(world);
    st.farms = st.farms.filter(f => f.kid !== k.id);
    st.lots = st.lots.filter(l => l.kid !== k.id);
    for (const t of townsOf(world, k)) { delete t.taxFarm; delete t.taxRevolt; }
}

function fiscalDay(game) {
    game.world.day++;
    return Fiscal.processDay(game.world, game.player);
}

describe('the books', () => {
    it('every realm keeps books: taxes and wages on their lines, the rest reconciled under other', () => {
        const game = world40();
        for (const k of game.world.kingdoms.filter(x => x.isAlive)) {
            const f = k.fisc;
            expect(f).toBeTruthy();
            // (each town's collectors come round once a week: last week's page has them all)
            const L = f.lastWeek;
            expect(L.land).toBeGreaterThan(0);
            expect(L.poll).toBeGreaterThan(0);
            expect(L.excise).toBeGreaterThan(0);
            expect(L.army).toBeGreaterThan(0);
            expect(L.court).toBeGreaterThan(0);
            expect(f.hist.length).toBeGreaterThan(0);
        }
        // The lines reconcile the treasury's change exactly (fiscal day to fiscal day)
        const k = bigRealm(game.world);
        const t0 = k.fisc.openTreasury;
        fiscalDay(game);
        const L = k.fisc.last;
        let net = L.other + L.loans + L.debase;
        for (const l of CrownBooks.REVENUE_LINES) net += L[l];
        for (const l of CrownBooks.EXPENSE_LINES) net -= L[l];
        expect(k.treasury - t0).toBeCloseTo(net, 1);
    }, 120000);

    it('taxes do not mint gold: the fiscal day only moves it between purses, chests, banks and farmers', () => {
        const game = world40();
        // Put a tax farm and an auction in play too
        const k = bigRealm(game.world);
        k.treasury = 0;
        for (let i = 0; i < 3; i++) fiscalDay(game);
        const before = moneyTotal(game);
        for (let i = 0; i < 10; i++) fiscalDay(game);
        const after = moneyTotal(game);
        const towns = game.world.getAllSettlements().length;
        // (purses round to the hundredth each day)
        expect(Math.abs(after - before)).toBeLessThan(towns * 10 * 0.02 + 1);
        // ...while it did collect and spend
        expect(k.fisc.stats.revenue).toBeGreaterThan(0);
        expect(k.fisc.stats.expense).toBeGreaterThan(0);
    }, 120000);

    it('the towns pay: their purses fall by what the crown collects', () => {
        const game = world40();
        const k = bigRealm(game.world);
        unfarm(game.world, k);
        const towns = townsOf(game.world, k);
        // (the collectors come to every town today)
        for (const t of towns) delete t.economy.fyDay;
        const purse0 = towns.reduce((s, t) => s + t.economy.gold, 0);
        const t0 = k.treasury;
        // No wages flow back today: an empty army and a court of nobody (to isolate the taxes)
        const mil = k.military;
        k.military = 0;
        k.fisc.lastMil = 0;
        k.fisc.arrears = { army: 0, court: 0 };
        const C = Fiscal.config().court;
        const keep = { ...C };
        C.base = 0; C.perTown = 0; C.perHead = 0;
        try {
            fiscalDay(game);
        } finally {
            Object.assign(C, keep);
            k.military = mil;
        }
        const purse1 = towns.reduce((s, t) => s + t.economy.gold, 0);
        const L = k.fisc.last;
        const taxed = L.land + L.poll + L.excise + L.levy + L.demesne;
        expect(taxed).toBeGreaterThan(0);
        expect(purse0 - purse1).toBeCloseTo(taxed, 0);
        expect(k.treasury - t0).toBeCloseTo(taxed, 0);
    }, 120000);

    it('heavier taxes yield more and weigh on the people and the realm', () => {
        const game = world40();
        const k = bigRealm(game.world);
        const f = CrownBooks.state(k);
        const town = townsOf(game.world, k)[0];
        const dues = (level) => {
            for (const l of ['land', 'poll', 'excise']) f.rates[l] = level;
            town.economy.fyProd = 10;
            town.economy.fyTrade = 20;
            return Fiscal.townDues(game.world, k, town, f, game.world.day, false, false);
        };
        const light = dues('light'), heavy = dues('heavy');
        expect(heavy.land / light.land).toBeCloseTo(1.3 / 0.75, 2);
        expect(heavy.poll).toBeGreaterThan(light.poll);
        expect(heavy.excise).toBeGreaterThan(light.excise);
        // The people's burden and the realm's stability term
        expect(CrownBooks.burden(k)).toBeGreaterThan(0.15);
        expect(Fiscal.townBurden(game.world, town)).toBeCloseTo(CrownBooks.burden(k), 5);
        expect(CrownBooks.stabilityMod(k)).toBeLessThan(0);
        expect(KingdomStability.target(k, game.world).parts.some(p => p.label === 'Taxes & pay')).toBe(true);
        dues('light');
        expect(CrownBooks.burden(k)).toBeLessThan(0.15);
        expect(CrownBooks.stabilityMod(k)).toBeGreaterThan(0);
    }, 120000);
});

describe('arrears', () => {
    it('unpaid soldiers desert after a week; unpaid clerks grow corrupt', () => {
        const game = world40();
        const k = bigRealm(game.world);
        const f = CrownBooks.state(k);
        for (const t of townsOf(game.world, k)) t.economy.gold = 0;
        k.treasury = 0;
        const corr0 = f.corruption;
        for (let i = 0; i < 12; i++) {
            for (const t of townsOf(game.world, k)) t.economy.gold = 0;
            k.treasury = 0;
            fiscalDay(game);
        }
        expect(f.arrears.army).toBeGreaterThan(0);
        expect(f.arrearsDays).toBeGreaterThanOrEqual(12);
        expect(f.corruption).toBeGreaterThan(corr0);
        expect(CrownBooks.armyFactor(k)).toBeLessThan(1);
        const capBefore = k.militaryCap;
        KingdomAI.updateMilitary(k, game.world);
        expect(k.militaryCap).toBeLessThan(capBefore + 1);
        expect(CrownBooks.stabilityMod(k)).toBeLessThan(0);
        // Finance sees the unpaid days
        Finance.processDay(game.world, game.player);
        expect(Finance.kingdomState(k).unpaid).toBe(f.arrearsDays);
        // Paid again, the back pay goes out and the men come back
        k.treasury = 1e6;
        fiscalDay(game);
        expect(f.arrears.army).toBe(0);
        for (let i = 0; i < 6; i++) fiscalDay(game);
        expect(f.arrearsDays).toBe(0);
        expect(CrownBooks.armyFactor(k)).toBe(Fiscal.config().army.levels[f.armyPay].cap);
    }, 120000);
});

describe('the crowns\' reviews and crises', () => {
    it('a rich crown lightens its taxes, a broke one raises them', () => {
        const game = world40();
        const [a, b] = game.world.kingdoms.filter(k => k.isAlive);
        const fa = CrownBooks.state(a), fb = CrownBooks.state(b);
        fa.level = fb.level = 'standard';
        fa.avg.exp = fb.avg.exp = 300;
        a.wars = []; b.wars = [];
        a.treasury = 300 * 1000;
        b.treasury = 0;
        const st = Fiscal.state(game.world);
        Fiscal._review(game.world, st, a, fa, game.world.day);
        Fiscal._review(game.world, st, b, fb, game.world.day);
        expect(CrownBooks.LEVELS.indexOf(fa.level)).toBeLessThan(1);
        expect(CrownBooks.LEVELS.indexOf(fb.level)).toBeGreaterThan(1);
        expect(fa.courtLevel).toBe('lavish');
        expect(fb.courtLevel).toBe('frugal');
    }, 120000);

    it('Finance reads the books: income is the budget\'s revenue, no war burn, offices and land for sale', () => {
        const game = world40();
        const k = bigRealm(game.world);
        Finance.processDay(game.world, game.player);
        expect(Finance.kingdomState(k).income).toBe(Math.round(Math.max(1, k.fisc.avg.rev)));
        // Selling offices raises corruption; selling crown land shrinks the demesne
        const f = CrownBooks.state(k);
        const t0 = k.treasury, c0 = f.corruption, d0 = f.demesne;
        expect(CrownBooks.sellOffices(k)).toBeGreaterThan(0);
        expect(f.corruption).toBeGreaterThan(c0);
        expect(CrownBooks.sellLand(k)).toBeGreaterThan(0);
        expect(f.demesne).toBeLessThan(d0);
        expect(k.treasury).toBeGreaterThan(t0);
        expect(f.day.sales).toBeGreaterThan(0);
        // ...and a crisis can choose them
        const out = { notices: [] };
        k.finance.missed = 5;
        const choice = Finance._crownCrisis(game.world, game.player, Finance.state(game.player), k, out);
        expect(['levy', 'debase', 'default', 'offices', 'land']).toContain(choice);
    }, 120000);

    it('heavily taxed, hard-pressed towns rise in tax revolts and withhold their taxes', () => {
        const game = world40();
        const k = bigRealm(game.world);
        const f = CrownBooks.state(k);
        for (const l of ['land', 'poll', 'excise']) f.rates[l] = 'crushing';
        f.corruption = 0.5;
        const towns = townsOf(game.world, k);
        for (const t of towns) if (t.labour && t.labour.wel) t.labour.wel.peasants = 0.3;
        const st = Fiscal.state(game.world);
        for (let w = 0; w < 30 && !st.history.some(h => h.kind === 'tax_revolt' && h.kingdomId === k.id); w++) {
            game.world.day += 7;
            Fiscal._revolts(game.world, game.player, st, k, f, towns.map(s => ({ s, q: s.q, r: s.r, key: `${s.q},${s.r}` })), null, game.world.day, { notices: [] });
        }
        const rec = st.history.find(h => h.kind === 'tax_revolt' && h.kingdomId === k.id);
        expect(rec).toBeTruthy();
        const town = towns.find(t => t.name === rec.town);
        expect(town.taxRevolt).toBeGreaterThan(game.world.day);
        const d = Fiscal.townDues(game.world, k, town, f, game.world.day, false, false);
        expect(d.due).toBeGreaterThan(0);
    }, 120000);
});

describe('tax farms', () => {
    it('a crown short of money auctions a town\'s taxes; the player outbids, collects, is resented', () => {
        const game = world40();
        const { world, player } = game;
        const k = bigRealm(world);
        const f = CrownBooks.state(k);
        k.treasury = 0;
        f.deficitWeeks = 5;
        delete f.lastLot;
        const st = Fiscal.state(world);
        unfarm(world, k);
        const towns = townsOf(world, k).map(s => ({ s, q: s.q, r: s.r, key: `${s.q},${s.r}` }));
        for (const t of towns) f.towns[t.key] = 30;
        Fiscal._offerFarm(world, player, st, k, f, towns, world.day, { notices: [] });
        const lot = Fiscal.lots(world, k.id)[0];
        expect(lot).toBeTruthy();
        expect(lot.est).toBe(30 * Fiscal.config().farms.term);
        expect(!(k.capital && lot.key === `${k.capital.q},${k.capital.r}`)).toBe(true);
        // Bid from a town of that realm
        player.q = lot.q; player.r = lot.r;
        player.gold = 1e6;
        const res = Fiscal.bid(player, world, lot.id, 'harsh');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(1e6 - res.bid);
        expect(player.financeToday.income.taxFarmBids).toBe(-res.bid);
        // The lot closes; the crown gets the lump; the town is farmed
        const t0 = k.treasury;
        world.day = lot.closes;
        st.lastDay = null;
        Fiscal.processDay(world, player);
        const farm = Fiscal.playerFarms(world)[0];
        expect(farm).toBeTruthy();
        expect(farm.paid).toBe(res.bid);
        const town = world.getTile(lot.q, lot.r).settlement;
        expect(town.taxFarm.holder).toBe('player');
        expect(k.fisc.day.farms).toBe(res.bid); // (booked on today's open page: the realm's day closed before the auctions)
        expect(k.treasury).toBeGreaterThan(t0 - 1);
        // The squeeze weighs on the town
        expect(Fiscal.townBurden(world, town)).toBeGreaterThan(CrownBooks.burden(k) + 0.1);
        // Collections reach the player's purse, booked in the ledger; the realm resents it
        player.reputation = player.reputation || {};
        player.reputation[k.id] = 0;
        town.economy.gold = 1e5;
        const g0 = player.gold;
        for (let i = 0; i < 8; i++) fiscalDay(game);
        expect(player.gold).toBeGreaterThan(g0);
        expect(farm.collected).toBeCloseTo(player.gold - g0, 0);
        expect(player.reputation[k.id]).toBeLessThan(0);
        // The term runs out
        world.day = farm.until;
        st.lastDay = null;
        Fiscal.processDay(world, player);
        expect(Fiscal.playerFarms(world).length).toBe(0);
        expect(town.taxFarm).toBeUndefined();
    }, 120000);

    it('a banking house wins an auction nobody else bids on, and its capital collects', () => {
        const game = world40();
        const { world, player } = game;
        const k = bigRealm(world);
        const f = CrownBooks.state(k);
        const st = Fiscal.state(world);
        st.lots = [];
        const towns = townsOf(world, k).map(s => ({ s, q: s.q, r: s.r, key: `${s.q},${s.r}` }));
        const pick = towns.find(t => !(k.capital && t.key === `${k.capital.q},${k.capital.r}`) && !t.s.taxFarm);
        f.towns[pick.key] = 40;
        const lot = Fiscal._openLot(world, player, st, k, f, pick, world.day);
        expect(lot.bank).toBeTruthy();
        const bank = Finance.bank(player, lot.bank.id);
        const cap0 = bank.capital;
        world.day = lot.closes;
        st.lastDay = null;
        Fiscal.processDay(world, player);
        const farm = st.farms.find(x => x.key === pick.key);
        expect(farm.holder).toBe(bank.id);
        expect(bank.capital).toBeGreaterThanOrEqual(cap0 - lot.bank.bid);
        expect(st.history.some(h => h.kind === 'tax_farm' && h.town === pick.s.name)).toBe(true);
    }, 120000);
});

describe('the ruler\'s purse', () => {
    it('a ruler sets each tax, the army\'s pay and the court; NPC reviews leave the realm alone', () => {
        const game = world40();
        const { world, player } = game;
        const k = bigRealm(world);
        player.throne = player.throne || {};
        player.throne.ruling = { kingdomId: k.id, policies: { tax: 'standard', stance: 'defensive', faith: 'devout' } };
        expect(Fiscal.setRate(player, world, 'land', 'heavy').success).toBe(true);
        expect(Fiscal.setRate(player, world, 'poll', 'light').success).toBe(true);
        expect(Fiscal.setArmyPay(player, world, 'generous').success).toBe(true);
        expect(Fiscal.setCourt(player, world, 'frugal').success).toBe(true);
        const f = CrownBooks.state(k);
        expect(f.rates).toMatchObject({ land: 'heavy', poll: 'light' });
        expect(CrownBooks.armyFactor(k)).toBeGreaterThan(1);
        expect(Fiscal.setRate(player, world, 'land', 'bogus').success).toBe(false);
        const b = Fiscal.budget(world, k);
        expect(b.rates.land).toBe('heavy');
        expect(Fiscal.realmTable(world).length).toBe(world.kingdoms.filter(x => x.isAlive).length);
    }, 120000);
});

describe('saving', () => {
    it('the books, the farms and their auctions survive a save', () => {
        const game = world40();
        const k = bigRealm(game.world);
        CrownBooks.state(k).corruption = 0.2;
        Fiscal.state(game.world).history.push({ kind: 'tax_revolt', key: 'x', day: 1, kingdomId: k.id });
        const g2 = roundTrip(game);
        const k2 = g2.world.getKingdom(k.id);
        expect(k2.fisc.corruption).toBe(0.2);
        expect(k2.fisc.rates).toEqual(k.fisc.rates);
        expect(Fiscal.news(g2.world).some(h => h.key === 'x')).toBe(true);
        // An old save with no books: backfilled on first sight
        delete k2.fisc;
        delete g2.world.fiscal;
        expect(CrownBooks.state(k2).level).toBe('standard');
        expect(Fiscal.state(g2.world).farms).toEqual([]);
    }, 120000);

    it('with the books off, nothing ticks and the old income returns', () => {
        const fiscal = DataLoader._gamedata.fiscal;
        DataLoader._gamedata.fiscal = { ...fiscal, enabled: false };
        try {
            const game = world40();
            const out = fiscalDay(game);
            expect(out.notices).toEqual([]);
            expect(CrownBooks.burden(bigRealm(game.world))).toBe(null);
            expect(CrownBooks.armyFactor(bigRealm(game.world))).toBe(1);
        } finally {
            DataLoader._gamedata.fiscal = fiscal;
        }
    }, 120000);
});

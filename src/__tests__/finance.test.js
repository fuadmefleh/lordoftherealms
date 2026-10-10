// Banks, Credit & Coin (systems/finance.js, world/coinage.js): banking houses
// placed from the seed without RNG, deposit and loan rates, deposit
// interest, the credit report, what a default costs (bailiffs, seizure,
// write-off, bounty, debtors' prison), crowns borrowing, servicing and
// getting into crisis (levy, debasement, default), debased coin in
// Economy.marketPrice and the stability target, runs on the bank and
// failures, heralds/chatter/counsel readers, the Banking facade, save
// round-trip with old-save migration, and determinism.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { Coinage } from '../world/coinage.js';
import { KingdomStability } from '../world/kingdomState.js';
import { Finance, Banking } from '../systems/finance.js';
import { Fiscal } from '../systems/fiscal.js';
import { Technology } from '../systems/technology.js';
import { Banking as BankingReexport } from '../systems/marketDynamics.js';
import { House } from '../systems/house.js';
import { Heralds } from '../systems/heralds.js';
import { Chatter } from '../systems/chatter.js';
import { Counsel } from '../systems/counsel.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';

let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});

/** A fresh game with its banking houses set up (no daily tick yet). */
function fresh(seed = 777) {
    const game = newGame(seed);
    game.world.day = 1;
    Finance.loadState(game.player, game.world);
    return game;
}

/** Stand the player at a bank's seat. */
function atBank(game, bank) {
    game.player.q = bank.q;
    game.player.r = bank.r;
}

/** Run only the finance tick for n days. */
function runDays(game, n) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        game.world.day++;
        notices.push(...Finance.processDay(game.world, game.player).notices);
    }
    return notices;
}

function firstBank(game) {
    return Finance.openBanks(game.player)[0];
}

/** A settlement tile of the realm (a town if it has one) other than the bank's seat. */
function realmTown(game, kingdomId, exclude = null) {
    for (const s of game.world.getSettlementViews()) {
        if (s.kingdom !== kingdomId) continue;
        if (exclude && s.q === exclude.q && s.r === exclude.r) continue;
        return game.world.getTile(s.q, s.r);
    }
    return null;
}

function loanWith(game, bank, product = 'small') {
    atBank(game, bank);
    game.player.gold = Math.max(game.player.gold, 2000);
    const res = Finance.takeLoan(game.player, game.world, bank.id, product);
    expect(res.success, res.reason).toBe(true);
    return res.loan;
}

describe('content and banking houses', () => {
    it('data/finance.json is loaded with config, names and events', () => {
        const D = Finance.data();
        expect(D.config.yearDays).toBe(120);
        expect(D.names.length).toBeGreaterThanOrEqual(5);
        for (const id of ['bank_run', 'venture_loss', 'royal_seizure', 'silver_find']) expect(Finance.event(id), id).toBeTruthy();
        expect(Finance.products().map(p => p.id)).toEqual(['small', 'medium', 'large', 'great']);
    });

    it('sets up 3-5 named houses in capitals and cities, one per realm, without drawing RNG', () => {
        const game = newGame(777);
        Utils.setSeed(99);
        const expected = Utils.random();
        Utils.setSeed(99);
        Finance.loadState(game.player, game.world);
        expect(Utils.random()).toBe(expected);
        const banks = game.player.finance.banks;
        expect(banks.length).toBeGreaterThanOrEqual(3);
        expect(banks.length).toBeLessThanOrEqual(5);
        expect(new Set(banks.map(b => b.name)).size).toBe(banks.length);
        expect(new Set(banks.map(b => b.kingdomId)).size).toBe(banks.length);
        for (const b of banks) {
            const tile = game.world.getTile(b.q, b.r);
            expect(['capital', 'city']).toContain(tile.settlement.type);
            expect(tile.settlement.kingdom).toBe(b.kingdomId);
            expect(b.capital).toBeGreaterThan(15000);
            expect(b.relations[b.kingdomId]).toBeGreaterThan(b.relations[Object.keys(b.relations).find(k => k !== b.kingdomId)]);
        }
    });

    it('is deterministic per world: the same seed gives the same houses', () => {
        const a = fresh(321).player.finance.banks;
        const b = fresh(321).player.finance.banks;
        expect(a).toEqual(b);
    });

    it('a house serves its seat and the cities of its realm, not a foreign town', () => {
        const game = fresh();
        const bank = firstBank(game);
        expect(Finance.banksAt(game.player, game.world, game.world.getTile(bank.q, bank.r)).map(b => b.id)).toContain(bank.id);
        const foreign = game.world.getSettlementViews().find(s => s.kingdom !== bank.kingdomId);
        expect(Finance.banksAt(game.player, game.world, game.world.getTile(foreign.q, foreign.r)).some(b => b.id === bank.id)).toBe(false);
    });
});

describe('rates', () => {
    it('a house pays more on deposits and charges more on loans when its reserves are low', () => {
        const game = fresh();
        const bank = firstBank(game);
        atBank(game, bank);
        game.player.gold = 3000;
        const fullApr = Finance.depositApr(bank);
        const fullRate = Finance.loanOffers(game.player, game.world, bank.id)[0].rate;
        bank.capital = bank.baseCapital * 0.3;
        expect(Finance.depositApr(bank)).toBeGreaterThan(fullApr);
        expect(Finance.loanOffers(game.player, game.world, bank.id)[0].rate).toBeGreaterThan(fullRate);
        expect(fullApr).toBeGreaterThanOrEqual(0.03);
        expect(fullApr).toBeLessThanOrEqual(0.075);
    });

    it('a poor credit score costs more and gates the bigger loans', () => {
        expect(Finance.creditFactor(400)).toBeGreaterThan(Finance.creditFactor(600));
        expect(Finance.creditFactor(800)).toBeLessThan(1);
        const game = fresh();
        const bank = firstBank(game);
        atBank(game, bank);
        game.player.gold = 100000;
        const good = Finance.loanOffers(game.player, game.world, bank.id).find(o => o.id === 'small');
        game.player.finance.credit.missed = 60;
        game.player.finance.credit.defaults = 1;
        game.player.finance.credit.lastDefaultDay = 1;
        const offers = Finance.loanOffers(game.player, game.world, bank.id);
        expect(offers.find(o => o.id === 'small').rate).toBeGreaterThan(good.rate);
        expect(offers.find(o => o.id === 'great').available).toBe(false);
    });

    it('technology still cuts loan interest', () => {
        const game = fresh();
        const bank = firstBank(game);
        atBank(game, bank);
        game.player.gold = 3000;
        const base = Finance.loanOffers(game.player, game.world, bank.id)[0].rate;
        const tech = vi.spyOn(Technology, 'getEffectTotal').mockImplementation((pl, key) => (key === 'loanInterestReduction' ? 0.5 : 0));
        try {
            expect(Finance.loanOffers(game.player, game.world, bank.id)[0].rate).toBeCloseTo(base / 2, 3);
        } finally {
            tech.mockRestore();
        }
        expect(base).toBeGreaterThan(0);
    });
});

describe('deposits', () => {
    it('earn a slow, safe interest compounded daily, and can be withdrawn at a branch', () => {
        const game = fresh();
        const bank = firstBank(game);
        atBank(game, bank);
        game.player.gold = 2000;
        expect(Finance.deposit(game.player, game.world, bank.id, 1000).success).toBe(true);
        expect(game.player.gold).toBe(1000);
        runDays(game, 120);
        const bal = game.player.finance.accounts[bank.id].balance;
        // ≈3–8% over a game year: well below a property or the company
        expect(bal).toBeGreaterThan(1030);
        expect(bal).toBeLessThan(1080);
        // Not from a foreign town
        const foreign = game.world.getSettlementViews().find(s => s.kingdom !== bank.kingdomId);
        game.player.q = foreign.q; game.player.r = foreign.r;
        expect(Finance.withdraw(game.player, game.world, bank.id).success).toBe(false);
        atBank(game, bank);
        const res = Finance.withdraw(game.player, game.world, bank.id);
        expect(res.success).toBe(true);
        expect(game.player.gold).toBe(1000 + res.amount);
        expect(game.player.finance.accounts[bank.id]).toBeUndefined();
    });

    it('a deposit is part of the house reserves', () => {
        const game = fresh();
        const bank = firstBank(game);
        atBank(game, bank);
        game.player.gold = 5000;
        const before = bank.capital;
        Finance.deposit(game.player, game.world, bank.id, 4000);
        expect(bank.capital).toBe(before + 4000);
    });
});

describe('credit', () => {
    it('builds a 300–850 score from history, collateral, Prestige and debt load, with readers for every part', () => {
        const game = fresh();
        const p = game.player;
        p.gold = 500;
        const base = Finance.creditReport(p, game.world);
        expect(base.score).toBeGreaterThanOrEqual(300);
        expect(base.score).toBeLessThanOrEqual(850);
        expect(['excellent', 'good', 'fair', 'poor', 'bad']).toContain(base.band);
        // Collateral
        p.properties.push({ q: 0, r: 0, type: 'farm', name: 'Farm' }, { q: 0, r: 0, type: 'mine', name: 'Mine' });
        const withProps = Finance.creditReport(p, game.world);
        expect(withProps.collateral.properties).toBeGreaterThan(0);
        expect(withProps.score).toBeGreaterThan(base.score);
        expect(withProps.limit).toBeGreaterThan(base.limit);
        // Prestige
        House.award(p.house, 400, 'test', 1);
        expect(Finance.creditReport(p, game.world).score).toBeGreaterThan(withProps.score);
        // History
        p.finance.credit.repaid = 3;
        const repaid = Finance.creditReport(p, game.world);
        p.finance.credit.missed = 30;
        p.finance.credit.defaults = 1;
        const bad = Finance.creditReport(p, game.world);
        expect(bad.score).toBeLessThan(repaid.score - 100);
        expect(bad.parts.map(x => x.label)).toEqual(expect.arrayContaining(['Missed payments', 'Defaults', 'Collateral', 'House Prestige']));
    });
});

describe('loans', () => {
    it('are taken at a house, draw on its reserves and are repaid day by day into them', () => {
        const game = fresh();
        const bank = firstBank(game);
        const p = game.player;
        p.gold = 0;
        atBank(game, bank);
        const cap0 = bank.capital;
        p.gold = 2000;
        const loan = loanWith(game, bank, 'small');
        expect(p.gold).toBe(2000 + 500);
        expect(bank.capital).toBeCloseTo(cap0 - 500, 0);
        const owed = loan.totalOwed;
        expect(owed).toBeGreaterThan(500);
        runDays(game, loan.remainingDays + 2);
        expect(p.finance.loans).toHaveLength(0);
        expect(p.finance.credit.repaid).toBe(1);
        expect(p.gold).toBeLessThan(2500 - 500);
    });

    it('need the house (or a branch) and refuse beyond the credit limit', () => {
        const game = fresh();
        const bank = firstBank(game);
        const foreign = game.world.getSettlementViews().find(s => s.kingdom !== bank.kingdomId);
        game.player.q = foreign.q; game.player.r = foreign.r;
        game.player.gold = 5000;
        expect(Finance.takeLoan(game.player, game.world, bank.id, 'small').success).toBe(false);
        atBank(game, bank);
        game.player.gold = 0;
        game.player.properties = [];
        const great = Finance.loanOffers(game.player, game.world, bank.id).find(o => o.id === 'great');
        expect(great.available).toBe(false);
    });

    it('repay early in full from anywhere', () => {
        const game = fresh();
        const bank = firstBank(game);
        const loan = loanWith(game, bank);
        game.player.q = 0; game.player.r = 0;
        game.player.gold = 5000;
        const res = Finance.repayLoan(game.player, game.world, loan.id);
        expect(res.success).toBe(true);
        expect(game.player.finance.loans).toHaveLength(0);
    });
});

describe('default has teeth', () => {
    it('late fees, then bailiffs take goods, then collateral is seized, then a write-off with reputation, Prestige and a bounty', () => {
        const game = fresh();
        const bank = firstBank(game);
        const p = game.player;
        p.gold = 100000;
        House.award(p.house, 200, 'test', 1);
        // A large loan, then the purse is empty
        const loan = loanWith(game, bank, 'medium');
        p.gold = 0;
        p.inventory = { iron: 5, grain: 10 };
        const farmTile = realmTown(game, bank.kingdomId, bank);
        p.properties = [{ q: farmTile.q, r: farmTile.r, type: 'farm', name: 'Farm' }];
        farmTile.playerProperties = [{ type: 'farm' }];
        farmTile.playerProperty = farmTile.playerProperties[0];
        p.reputation[bank.kingdomId] = 10;
        const owed0 = loan.totalOwed;

        runDays(game, 1);
        expect(loan.overdue).toBe(1);
        expect(loan.totalOwed).toBeGreaterThan(owed0);
        expect(p.finance.credit.missed).toBe(1);

        const n7 = runDays(game, 6);
        expect(n7.some(n => n.title === 'Bailiffs!')).toBe(true);
        expect(p.inventory.iron || 0).toBe(0);
        expect(p.reputation[bank.kingdomId]).toBeLessThan(10);

        const n14 = runDays(game, 7);
        expect(n14.some(n => n.title === 'Property Seized')).toBe(true);
        expect(p.properties).toHaveLength(0);
        expect(farmTile.playerProperties).toBeNull();

        const prestige0 = House.getPrestige(p);
        const n30 = runDays(game, 16);
        expect(n30.some(n => n.title === 'Declared a Defaulter')).toBe(true);
        expect(p.finance.loans).toHaveLength(0);
        expect(p.finance.credit.defaults).toBe(1);
        expect(p.finance.blacklist[bank.id]).toBeGreaterThan(1500);
        expect(House.getPrestige(p)).toBeLessThan(prestige0);
        expect(p.gossip.bounties.some(b => b.kingdom === bank.kingdomId && b.description === 'debt')).toBe(true);
        // The house will not lend again; the history records it
        atBank(game, bank);
        p.gold = 50000;
        expect(Finance.loanOffers(p, game.world, bank.id).every(o => !o.available)).toBe(true);
        expect(p.finance.history.some(h => h.kind === 'player_default')).toBe(true);
        // Making it good clears the name
        const res = Finance.settleDefault(p, game.world, bank.id);
        expect(res.success).toBe(true);
        expect(p.finance.blacklist[bank.id]).toBeUndefined();
        expect(p.gossip.bounties.some(b => b.description === 'debt')).toBe(false);
        expect(p.finance.credit.settled).toBe(1);
    });

    it('seizes the deposits with the lender first, then a docked ship, then the company coffers', () => {
        const game = fresh();
        const bank = firstBank(game);
        const p = game.player;
        const loan = loanWith(game, bank, 'small');
        p.gold = 0;
        p.finance.accounts[bank.id] = { balance: 100, interest: 0, opened: 1 };
        p.ships = [{ id: 's1', name: 'Gull', typeId: 'cog', condition: 100, status: 'docked' }];
        loan.overdue = 13;
        runDays(game, 1);
        expect(p.finance.accounts[bank.id]).toBeUndefined();
        expect(p.ships).toHaveLength(0);
    });

    it("a very large default sends the player to the debtors' prison in that realm's towns", () => {
        const game = fresh();
        const bank = firstBank(game);
        const p = game.player;
        p.finance.wanted[bank.kingdomId] = { amount: 8000, bankId: bank.id, day: 1 };
        atBank(game, bank);
        for (let i = 0; i < 60 && !p.jailState; i++) runDays(game, 1);
        expect(p.jailState).toBeTruthy();
        expect(p.jailState.offense).toBe('unpaid debts');
        expect(p.jailState.daysRemaining).toBeGreaterThanOrEqual(5);
        expect(p.finance.wanted[bank.kingdomId]).toBeUndefined();
    });
});

describe('crowns', () => {
    function warRealm(game) {
        const k = game.world.kingdoms.find(x => x.isAlive !== false && game.world.kingdoms.some(y => y !== x && y.isAlive !== false));
        const foe = game.world.kingdoms.find(y => y !== k && y.isAlive !== false);
        k.wars = [foe.id];
        return k;
    }

    it('a crown at war below its reserve borrows from a house, and pays back weekly from its treasury', () => {
        const game = fresh();
        const k = warRealm(game);
        k.treasury = 1000;
        const f = Finance.kingdomState(k);
        f.income = 2000;
        f.lastTreasury = 1000;
        const capital0 = Finance.openBanks(game.player).reduce((s, b) => s + b.capital, 0);
        runDays(game, 1);
        expect(f.debt.length).toBeGreaterThan(0);
        expect(Finance.crownDebt(k)).toBeGreaterThan(0);
        expect(Finance.openBanks(game.player).reduce((s, b) => s + b.capital, 0)).toBeLessThan(capital0);
        // Peace and a full treasury: the debt is paid down
        k.wars = [];
        const debt0 = Finance.crownDebt(k);
        k.treasury = 10000000;
        runDays(game, 14);
        expect(Finance.crownDebt(k)).toBeLessThan(debt0);
    });

    it('a crown in crisis levies, debases or defaults', () => {
        const game = fresh();
        const choices = new Set();
        for (let i = 0; i < 40 && choices.size < 3; i++) {
            const k = game.world.kingdoms[i % game.world.kingdoms.length];
            if (k.isAlive === false) continue;
            const f = Finance.kingdomState(k);
            f.levy = null;
            f.purity = 1;
            const bank = firstBank(game);
            f.debt = [{ id: `T${i}`, bankId: bank.id, principal: 1000, owed: 1000, apr: 0.1, day: 1 }];
            Utils.setSeed(1000 + i);
            choices.add(Finance._crownCrisis(game.world, game.player, game.player.finance, k, { notices: [], paid: 0, defaulted: [] }));
        }
        expect([...choices].sort()).toEqual(['debase', 'default', 'levy']);
    });

    it('a levy fills the treasury while it lasts and costs stability', () => {
        const game = fresh();
        const k = game.world.kingdoms.find(x => x.isAlive !== false);
        const f = Finance.kingdomState(k);
        f.income = 1000;
        Finance._levy(game.world, game.player, game.player.finance, k, { notices: [] });
        expect(Coinage.stabilityMod(k, game.world.day)).toBeLessThan(0);
        // With the Crown's Purse the levy is an extra tax on the towns (systems/fiscal.js)
        runDays(game, 1);
        for (const s of game.world.getAllSettlements()) {
            const live = game.world.getTile(s.q, s.r).settlement;
            if (live.kingdom === k.id) { Economy.initSettlement(live); live.economy.gold = 5000; }
        }
        game.world.day++;
        Fiscal.processDay(game.world, game.player);
        expect(k.fisc.last.levy).toBeGreaterThan(0);
        expect(k.fisc.last.levy).toBeCloseTo((k.fisc.last.land + k.fisc.last.poll + k.fisc.last.excise) * 0.3, 0);
    });

    it('a default costs the lenders capital, the realm stability, and bondholders a haircut', () => {
        const game = fresh();
        const bank = firstBank(game);
        const k = game.world.kingdoms.find(x => x.isAlive !== false && x.id !== bank.kingdomId);
        const f = Finance.kingdomState(k);
        f.debt = [{ id: 'D1', bankId: bank.id, principal: 10000, owed: 10000, apr: 0.12, day: 1 }];
        game.player.finance.bonds.push({ id: 'B1', kingdomId: k.id, kingdomName: k.name, principal: 2000, apr: 0.08, term: 120, start: 1, maturity: 121, missed: 0, coupons: 0, haircut: 0 });
        const capital0 = bank.capital;
        const stab0 = k.stability = 60;
        const res = Finance.crownDefault(game.world, game.player, k, { notices: [], paid: 0, defaulted: [] }, 0.5);
        expect(res.amount).toBe(5000);
        expect(bank.capital).toBe(capital0 - 5000);
        expect(k.stability).toBeLessThan(stab0);
        expect(bank.relations[k.id]).toBeLessThan(0);
        expect(game.player.finance.bonds[0].principal).toBe(1000);
        expect(f.defaults).toBe(1);
        expect(Coinage.stabilityMod(k, game.world.day)).toBeLessThan(0);
        // Houses won't lend to it for a while
        k.wars = ['x'];
        expect(Finance._crownBorrow(game.world, game.player, game.player.finance, k, 50000, null)).toBeNull();
    });
});

describe('royal bonds', () => {
    it('lend to a crown for coupons, reputation and Prestige, and are repaid at maturity', () => {
        const game = fresh();
        const bank = firstBank(game);
        atBank(game, bank);
        const p = game.player;
        p.gold = 10000;
        const k = game.world.kingdoms.find(x => x.isAlive !== false);
        k.treasury = 1000000;
        const rep0 = p.reputation[k.id] || 0;
        const prestige0 = House.getPrestige(p);
        const res = Finance.buyBond(p, game.world, k.id, 5000, 120);
        expect(res.success, res.reason).toBe(true);
        expect(p.gold).toBe(5000);
        expect(p.reputation[k.id]).toBeGreaterThan(rep0);
        expect(House.getPrestige(p)).toBeGreaterThan(prestige0);
        runDays(game, 121);
        expect(p.finance.bonds).toHaveLength(0);
        // Principal back plus coupons: a slow return (≈6–20% a year)
        expect(p.gold).toBeGreaterThan(10000);
        expect(p.gold).toBeLessThan(10000 + 5000 * 0.2);
        expect(p.finance.stats.couponsEarned).toBeGreaterThan(0);
    });

    it('a crown with no coin misses coupons and puts off repayment', () => {
        const game = fresh();
        const bank = firstBank(game);
        atBank(game, bank);
        const p = game.player;
        p.gold = 1000;
        const k = game.world.kingdoms.find(x => x.isAlive !== false);
        expect(Finance.buyBond(p, game.world, k.id, 1000, 120).success).toBe(true);
        const notices = [];
        for (let i = 0; i < 8; i++) {
            k.treasury = 0;
            notices.push(...runDays(game, 1));
        }
        expect(notices.some(n => n.title === 'Coupon Missed')).toBe(true);
        expect(p.finance.bonds[0].missed).toBeGreaterThan(0);
    });
});

describe('coinage and debasement', () => {
    it('debasement gives the crown gold and raises prices in its markets only, via Economy.marketPrice', () => {
        const game = fresh();
        const w = game.world;
        const k = w.kingdoms.find(x => x.isAlive !== false);
        const home = realmTown(game, k.id);
        const away = w.getTile(...(() => { const s = w.getSettlementViews().find(x => x.kingdom !== k.id); return [s.q, s.r]; })());
        const good = Economy._goods().GRAIN;
        const homeBefore = Economy.marketPrice(good, home.settlement, home, w);
        const awayBefore = Economy.marketPrice(good, away.settlement, away, w);
        expect(Finance.coinPriceMultiplier(w, home.settlement)).toBe(1);
        const t0 = k.treasury;
        const res = Finance.debase(w, game.player, k);
        expect(res.success).toBe(true);
        expect(k.treasury).toBeGreaterThan(t0);
        expect(Coinage.purity(k)).toBeCloseTo(0.9, 5);
        expect(Finance.coinPriceMultiplier(w, home.settlement)).toBeCloseTo(1.09, 5);
        expect(Economy.marketPrice(good, home.settlement, home, w)).toBeGreaterThanOrEqual(homeBefore);
        expect(Economy.marketPrice(good, away.settlement, away, w)).toBe(awayBefore);
        // Big-ticket goods show the 9%
        const big = { ...good, id: 'test_big', basePrice: 10000 };
        const kBig = Economy.marketPrice(big, home.settlement, home, w);
        k.finance.purity = 1;
        expect(kBig / Economy.marketPrice(big, home.settlement, home, w)).toBeCloseTo(1.09, 2);
    });

    it('multiplier is exactly 1 without a world, outside a realm, or for pure coin', () => {
        expect(Coinage.priceMultiplier(null, { kingdom: 'x' })).toBe(1);
        expect(Coinage.priceMultiplier({ kingdoms: [] }, { kingdom: null })).toBe(1);
        expect(Coinage.priceMultiplier({ kingdoms: [{ id: 'a' }] }, { kingdom: 'a' })).toBe(1);
        expect(Coinage.stabilityMod({ id: 'a' }, 10)).toBe(0);
    });

    it('debased coin lowers the stability target and trust; the floor stops further clipping', () => {
        const game = fresh();
        const k = game.world.kingdoms.find(x => x.isAlive !== false);
        const before = KingdomStability.target(k, game.world).value;
        for (let i = 0; i < 10; i++) Finance.debase(game.world, game.player, k);
        expect(Coinage.purity(k)).toBeCloseTo(0.5, 5);
        expect(Finance.debase(game.world, game.player, k).success).toBe(false);
        const after = KingdomStability.target(k, game.world);
        expect(after.value).toBeLessThan(before);
        expect(after.parts.some(p => p.label === 'Crown finances')).toBe(true);
        expect(Coinage.trust(k, game.world.day)).toBeLessThan(50);
    });
});

describe('panics and failures', () => {
    it('a run rations withdrawals and stops lending; a house that cannot weather it fails and repays depositors in part', () => {
        const game = fresh();
        const bank = firstBank(game);
        const p = game.player;
        atBank(game, bank);
        p.gold = 5000;
        Finance.deposit(p, game.world, bank.id, 4000);
        const out = { notices: [], paid: 0, defaulted: [] };
        Finance._startRun(game.world, p, p.finance, bank, out, 'a test');
        expect(out.notices.length).toBe(1);
        expect(Finance.loanOffers(p, game.world, bank.id).every(o => !o.available)).toBe(true);
        bank.capital = 5000;
        const w1 = Finance.withdraw(p, game.world, bank.id, 4000);
        expect(w1.success).toBe(true);
        expect(w1.amount).toBeLessThan(4000); // rationed
        expect(Finance.withdraw(p, game.world, bank.id, 100).success).toBe(false);
        // Empty the vaults: the run ends in failure
        bank.capital = 0;
        const gold0 = p.gold;
        const left = p.finance.accounts[bank.id].balance;
        const notices = runDays(game, 12);
        expect(bank.status).toBe('failed');
        expect(notices.some(n => n.title === 'A Banking House Fails')).toBe(true);
        expect(p.gold).toBeGreaterThan(gold0);
        expect(p.gold).toBeLessThan(gold0 + left);
        expect(p.finance.stats.lostInFailures).toBeGreaterThan(0);
        expect(p.finance.history.some(h => h.kind === 'bank_failed')).toBe(true);
        // A new house opens at the seat in time
        runDays(game, 95);
        expect(Finance.openBanks(p).some(b => b.q === bank.q && b.r === bank.r && b.id !== bank.id)).toBe(true);
    });

    it('heralds proclaim a failure and townsfolk talk of debased coin', () => {
        const game = fresh();
        const bank = firstBank(game);
        const p = game.player;
        Heralds.processDay(game.world, p);
        bank.capital = 0;
        Finance._startRun(game.world, p, p.finance, bank, null, null);
        runDays(game, 12);
        expect(bank.status).toBe('failed');
        Heralds.processDay(game.world, p);
        expect(p.heralds.list.some(h => h.kind === 'bank_failed')).toBe(true);
        const k = game.world.getKingdom(bank.kingdomId);
        Finance.debase(game.world, p, k);
        const ctx = Chatter.context(game.world, p, { q: bank.q, r: bank.r });
        expect(ctx.money.map(m => m.kind)).toEqual(expect.arrayContaining(['debased', 'bank_failed']));
    });

    it('rare events are rare: a quiet world sees few panics in a year', () => {
        const game = fresh(4242);
        runDays(game, 120);
        const runs = game.player.finance.history.filter(h => h.kind === 'bank_run').length;
        expect(runs).toBeLessThanOrEqual(3);
    });
});

describe('counsel', () => {
    it('warns of an overdue loan and what comes next', () => {
        const game = fresh();
        const bank = firstBank(game);
        const loan = loanWith(game, bank);
        game.player.gold = 0;
        loan.overdue = 5;
        const items = Counsel.READERS.loanDefault({ player: game.player, world: game.world, day: game.world.day });
        expect(items).toHaveLength(1);
        expect(items[0].next).toMatch(/bailiffs/);
        expect(items[0].severity).toBe('critical');
        loan.overdue = 0;
        const due = Counsel.READERS.loanDue({ player: game.player, world: game.world, day: game.world.day }, { warnDays: 5 });
        expect(due).toHaveLength(1);
    });
});

describe('Banking facade', () => {
    it('is re-exported from marketDynamics and routes to the banking houses', () => {
        expect(BankingReexport).toBe(Banking);
        const game = fresh();
        const bank = firstBank(game);
        atBank(game, bank);
        game.player.gold = 1000;
        expect(Banking.takeLoan(game.player, 'small', bank.kingdomId).success).toBe(false); // no world
        const res = Banking.takeLoan(game.player, 'small', bank.kingdomId, game.world);
        expect(res.success).toBe(true);
        const r = Banking.processLoans(game.player, game.world);
        expect(r.paid).toBeGreaterThan(0);
        expect(Banking.repayLoan(game.player, res.loan.id, game.world).success).toBe(true);
    });
});

describe('save and load', () => {
    it('round-trips banks, deposits, loans, bonds and the crowns\' finances', () => {
        const game = fresh(555);
        const bank = firstBank(game);
        const p = game.player;
        atBank(game, bank);
        p.gold = 20000;
        Finance.deposit(p, game.world, bank.id, 3000);
        loanWith(game, bank, 'small');
        const k = game.world.kingdoms.find(x => x.isAlive !== false);
        Finance.buyBond(p, game.world, k.id, 1000, 240);
        Finance.debase(game.world, p, k);
        runDays(game, 5);
        const g2 = roundTrip(game);
        expect(Finance.serialize(g2.player)).toEqual(Finance.serialize(p));
        expect(g2.world.getKingdom(k.id).finance).toEqual(k.finance);
        expect(Coinage.purity(g2.world.getKingdom(k.id))).toBe(Coinage.purity(k));
        expect(Coinage.purity(k)).toBeLessThan(1);
        // And it keeps going
        g2.world.day++;
        Finance.processDay(g2.world, g2.player);
        expect(g2.player.finance.lastDay).toBe(g2.world.day);
    });

    it('an old save: no finance record, loans in the old royal-bank model are migrated', () => {
        const game = fresh(556);
        const bank = firstBank(game);
        const data = JSON.parse(JSON.stringify({ world: SaveLoad.serializeWorld(game.world), player: SaveLoad.serializePlayer(game.player) }));
        delete data.player.finance;
        for (const k of data.world.kingdoms) delete k.finance;
        data.player.loans = {
            [bank.kingdomId]: [{ id: 'old1', type: 'medium', kingdomId: bank.kingdomId, principal: 2000, interestRate: 0.15, totalOwed: 1800, remainingDays: 40, dailyPayment: 45, daysTaken: 20 }],
            nowhere_realm: [{ id: 'old2', type: 'small', kingdomId: 'nowhere_realm', principal: 500, interestRate: 0.1, totalOwed: 300, remainingDays: 10, dailyPayment: 30, daysTaken: 20 }],
        };
        const g2 = roundTrip({ ...game, world: game.world, player: game.player });
        // Restore the hand-edited save on top of the fresh world/player
        SaveLoad.restorePlayer(data.player, g2.player, g2.world);
        const st = g2.player.finance;
        expect(st.banks.length).toBeGreaterThanOrEqual(3);
        expect(g2.player.loans).toEqual({});
        const m1 = st.loans.find(l => l.principal === 2000);
        expect(m1.bankId).toBe(st.banks.find(b => b.kingdomId === bank.kingdomId).id);
        expect(m1.totalOwed).toBe(1800);
        expect(m1.dailyPayment).toBe(45);
        const m2 = st.loans.find(l => l.principal === 500);
        expect(m2.bankId).toBe('crown:nowhere_realm');
        // It pays like any other loan
        g2.player.gold = 1000;
        g2.world.day++;
        const day = Finance.processDay(g2.world, g2.player);
        expect(day.paid).toBe(75);
    });
});

describe('determinism', () => {
    function run(seed, days) {
        const game = fresh(seed);
        for (const k of game.world.kingdoms.slice(0, 3)) {
            const foe = game.world.kingdoms.find(x => x !== k);
            k.wars = [foe.id];
            k.treasury = 500;
        }
        runDays(game, days);
        return JSON.stringify({ fin: Finance.serialize(game.player), k: game.world.kingdoms.map(k => [k.treasury, k.stability, k.finance]) });
    }

    it('the same world and days give the same banks, debts and coin', () => {
        expect(run(888, 90)).toEqual(run(888, 90));
    });

    it('the daily tick draws from its own stream, never the main RNG', () => {
        const game = fresh(889);
        Utils.setSeed(5);
        const a = [Utils.random(), Utils.random()];
        Utils.setSeed(5);
        runDays(game, 30);
        expect([Utils.random(), Utils.random()]).toEqual(a);
    });
});

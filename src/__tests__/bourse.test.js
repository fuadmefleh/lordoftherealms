// The Bourse (systems/bourse.js) and bills of exchange (systems/bills.js):
// exchanges in the greatest capitals, listings for the rival houses, the
// banking houses and the chartered companies; prices that follow book value
// and profit (and a bank's vaults, runs and crown loans); dividends paid from
// real profit; floating the player's company (dilution, outside dividends,
// the owner's draws); manias that burst and panics; round trips that lose
// money; spies' insight; bills drawn, fees, presentation, theft and stopping,
// failed houses and forgeries; save round-trip with backfill; determinism.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Finance } from '../systems/finance.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { Underworld } from '../systems/underworld.js';
import { Bourse } from '../systems/bourse.js';
import { Bills } from '../systems/bills.js';
import { Heralds } from '../systems/heralds.js';
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

function fresh(seed = 5151) {
    const game = newGame(seed);
    game.world.day = 1;
    Finance.loadState(game.player, game.world);
    game.player.gold = 100000;
    Bourse.processDay(game.world, game.player);
    return game;
}

function days(game, n) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        game.world.day++;
        notices.push(...Bourse.processDay(game.world, game.player).notices);
    }
    return notices;
}

function atExchange(game) {
    const ex = Bourse.state(game.player).exchanges[0];
    game.player.q = ex.q;
    game.player.r = ex.r;
    return ex;
}

function listing(game, kind) {
    return Bourse.listed(game.player).find(l => l.kind === kind);
}

describe('the board', () => {
    it('opens exchanges in the greatest capitals and lists the houses, the banks and the chartered companies', () => {
        const game = fresh();
        const st = Bourse.state(game.player);
        expect(st.exchanges.length).toBe(Bourse.config().exchanges);
        for (const ex of st.exchanges) expect(game.world.getTile(ex.q, ex.r).settlement.type).toBe('capital');
        const kinds = new Set(Bourse.listed(game.player).map(l => l.kind));
        for (const k of ['house', 'bank', 'venture', 'monopoly']) expect(kinds.has(k), k).toBe(true);
        expect(Bourse.listed(game.player).filter(l => l.kind === 'bank').length).toBe(Finance.openBanks(game.player).length);
        for (const l of Bourse.listed(game.player)) expect(l.price).toBeGreaterThan(0);
        // Trading needs the floor
        game.player.q = -99;
        expect(Bourse.buy(game.player, game.world, listing(game, 'house').id, 1).success).toBe(false);
    });

    it('a house\'s price follows its book and its profits', () => {
        const game = fresh();
        const l = listing(game, 'house');
        const r = MerchantHouses.getRival(game.player, l.ref);
        days(game, 14);
        const before = l.fair;
        r.capital *= 2;
        days(game, 7);
        expect(l.book).toBeCloseTo(r.capital / 100, 5);
        expect(l.fair).toBeGreaterThan(before * 1.6);
        // A return above the hurdle earns a multiple of book; below, a discount
        expect(Bourse.multiple(0.3)).toBeGreaterThan(1);
        expect(Bourse.multiple(-0.2)).toBeLessThan(1);
    });

    it('a bank\'s price falls with its vaults and in a run, and its shares die with it', () => {
        const game = fresh();
        const l = listing(game, 'bank');
        const b = Finance.bank(game.player, l.ref);
        days(game, 2);
        const calm = l.fair;
        b.panic = { since: game.world.day, until: game.world.day + 10, paid: 0, paidDay: null };
        days(game, 1);
        expect(l.fair).toBeLessThan(calm * 0.7);
        b.panic = null;
        atExchange(game);
        expect(Bourse.buy(game.player, game.world, l.id, 10).success).toBe(true);
        b.status = 'failed';
        days(game, 7);
        expect(l.status).toBe('delisted');
        expect(Bourse.state(game.player).holdings[l.id]).toBeUndefined();
    });
});

describe('dividends from real profit', () => {
    it('a house pays its holders their part of the dividend it really paid', () => {
        const game = fresh();
        const l = listing(game, 'house');
        const r = MerchantHouses.getRival(game.player, l.ref);
        atExchange(game);
        expect(Bourse.buy(game.player, game.world, l.id, 20).success).toBe(true);
        expect(r.shares.purse).toBe(20);
        const st = Bourse.state(game.player);
        let paid = 0;
        let owed = 0;
        for (let w = 0; w < 10; w++) {
            const before = st.stats.dividends;
            days(game, 7);
            paid += st.stats.dividends - before;
            if (r.lastWeek === st.lastWeek) owed += _div(r) * 20 / 100;
        }
        expect(paid).toBeGreaterThan(0);
        expect(paid).toBeCloseTo(owed, 0);
    });

    it('a bank pays its holders out of its own reserves', () => {
        const game = fresh();
        const l = listing(game, 'bank');
        const b = Finance.bank(game.player, l.ref);
        atExchange(game);
        expect(Bourse.buy(game.player, game.world, l.id, 100).success).toBe(true);
        days(game, 7);
        const cap = b.capital;
        b.capital += 7000; // a fine week for the house
        const gold = game.player.gold;
        days(game, 7);
        const div = game.player.gold - gold;
        expect(div).toBeGreaterThan(0);
        expect(div).toBeCloseTo(7000 * Bourse.config().bankPayout * 100 / l.shares, 0);
        expect(b.capital).toBeCloseTo(cap + 7000 - div, 0);
    });

    it('a share held for a year returns roughly what the house earned', () => {
        const game = fresh(7373);
        const l = listing(game, 'bank');
        atExchange(game);
        const cost = Bourse.buy(game.player, game.world, l.id, 50).cost;
        days(game, 120);
        const h = Bourse.state(game.player).holdings[l.id];
        const value = 50 * l.price + h.dividends;
        const ret = value / cost - 1;
        // Banks earn their lending yield, give or take the market's moods
        expect(ret).toBeGreaterThan(-0.35);
        expect(ret).toBeLessThan(0.45);
    });
});

function _div(r) {
    return r.lastDividend || 0;
}

describe('no money loops', () => {
    it('buying and selling straight back always loses the spread and the broker', () => {
        const game = fresh();
        atExchange(game);
        for (const l of Bourse.listed(game.player).slice(0, 4)) {
            const gold = game.player.gold;
            const n = Math.max(1, Math.floor(Math.min(20, l.shares * 0.2)));
            expect(Bourse.buy(game.player, game.world, l.id, n).success).toBe(true);
            expect(Bourse.sell(game.player, game.world, l.id, n).success).toBe(true);
            expect(game.player.gold).toBeLessThan(gold);
        }
    });

    it('buying pushes the price up only for a while: pumping your holding costs more than it makes', () => {
        const game = fresh();
        const l = listing(game, 'venture');
        atExchange(game);
        const gold = game.player.gold;
        expect(Bourse.buy(game.player, game.world, l.id, 200).success).toBe(true);
        days(game, 1);
        expect(l.impact).toBeGreaterThan(0);
        days(game, 30);
        expect(Math.abs(l.impact)).toBeLessThan(0.01);
        expect(Bourse.sell(game.player, game.world, l.id, 200).success).toBe(true);
        // Without a mania, a month's dividends do not cover the round trip's costs and impact
        expect(game.player.gold).toBeLessThan(gold + 200 * l.book * 0.2);
        expect(Bourse.buy(game.player, game.world, l.id, l.shares).success).toBe(false); // a quarter at most
    });
});

describe('floating your company', () => {
    function withCompany(game, capital = 8000) {
        const p = game.player;
        p.gold += capital;
        MerchantHouses.state(p).charters.push({ kingdomId: game.world.kingdoms[0].id, day: 0 });
        const res = MerchantHouses.found(p, game.world, { capital });
        if (!res.success) {
            MerchantHouses.state(p).company = { name: 'Test & Co', capital, reputation: 30, posts: [], foundedDay: 0 };
            MerchantHouses.state(p);
        }
        return MerchantHouses.company(p);
    }

    it('raises capital below fair, owes dividends, dilutes control and taxes the owner\'s draws', () => {
        const game = fresh();
        const c = withCompany(game);
        atExchange(game);
        const cap = c.capital;
        const q = Bourse.floatQuote(game.player, game.world, 20);
        expect(q.price).toBeLessThan(q.fair);
        const res = Bourse.float(game.player, game.world, 20);
        expect(res.success, res.reason).toBe(true);
        expect(c.capital - cap).toBe(q.cash);
        expect(c.float.outside).toBe(20);
        expect(Bourse.float(game.player, game.world, 40).success).toBe(false); // keep control
        // A profitable week: the shareholders take their part
        c.weeks.unshift({ day: game.world.day, income: 1000, expenses: 0, capital: c.capital });
        const before = c.capital;
        days(game, 7);
        expect(before - c.capital).toBeCloseTo(1000 * Bourse.config().float.payout * 0.2, 0);
        // The owner draws 800: the shareholders get theirs too (20/80 of it)
        const left = c.capital;
        expect(MerchantHouses.withdraw(game.player, game.world, 800).success).toBe(true);
        expect(left - c.capital).toBe(800 + 200);
        // Buying it back costs more than the float raised
        const gold = game.player.gold;
        expect(Bourse.buyBack(game.player, game.world, 20).success).toBe(true);
        expect(gold - game.player.gold).toBeGreaterThan(q.cash);
        expect(c.float.outside).toBe(0);
    });
});

describe('manias and panics', () => {
    it('a mania inflates its listing, sells new stock into it, then bursts: the mood sours and a bank pays', () => {
        const game = fresh();
        const st = Bourse.state(game.player);
        const l = listing(game, 'venture');
        const day = game.world.day;
        l.mania = { id: 'isles_mania', start: day, peakDay: day + 20, endDay: day + 40, peak: 3, trough: 0.5, issued: false, burst: false };
        const shares = l.shares;
        const banks = Finance.openBanks(game.player).map(b => b.capital);
        days(game, 18);
        expect(Bourse.maniaMult(l, game.world.day)).toBeGreaterThan(2.5);
        expect(l.price).toBeGreaterThan(l.fair * 2);
        expect(l.shares).toBeGreaterThan(shares);
        const notes = days(game, 4);
        expect(notes.some(n => n.title === 'The Bubble Bursts')).toBe(true);
        expect(l.price).toBeLessThan(l.fair * 0.8);
        expect(st.mood).toBeLessThan(1);
        expect(Finance.openBanks(game.player).some((b, i) => b.capital < banks[i])).toBe(true);
        expect(st.history.some(h => h.kind === 'crash')).toBe(true);
        expect(Heralds._records(game.player).bourse.some(x => x.h.kind === 'crash')).toBe(true);
        days(game, 20);
        expect(l.mania).toBe(null);
    });

    it('manias come from the data, now and then, and pick a listing of their kind', () => {
        const game = fresh();
        const defs = Bourse.manias();
        expect(defs.length).toBeGreaterThan(0);
        const saved = defs.map(d => d.chance);
        try {
            for (const d of defs) d.chance = 1;
            days(game, 8);
        } finally {
            defs.forEach((d, i) => { d.chance = saved[i]; });
        }
        const m = Bourse.listed(game.player).find(l => l.mania);
        expect(m).toBeTruthy();
        expect(defs.find(d => d.id === m.mania.id).targets).toContain(m.kind);
    });

    it('a banking house failing or a crown defaulting sends the market into a panic', () => {
        const game = fresh();
        const st = Bourse.state(game.player);
        const b = Finance.openBanks(game.player)[0];
        Finance._fail(game.world, game.player, Finance.state(game.player), b, { notices: [] });
        days(game, 1);
        expect(st.mood).toBeLessThan(0.97);
        expect(st.history.some(h => h.kind === 'panic')).toBe(true);
    });

    it('spies in a listing\'s realm let you see its worth', () => {
        const game = fresh();
        const l = listing(game, 'monopoly');
        expect(Bourse.insight(game.player, game.world, l)).toBe(false);
        const town = game.world.getSettlementViews().find(s => s.kingdom === l.kingdomId);
        game.player.espionage = { spies: [{ id: 'sp1', location: { q: town.q, r: town.r } }], activeMissions: [] };
        expect(Bourse.insight(game.player, game.world, l)).toBe(true);
    });
});

describe('bills of exchange', () => {
    function twoBanks(game) {
        const [a, b] = Finance.openBanks(game.player);
        game.player.q = a.q;
        game.player.r = a.r;
        return [a, b];
    }

    it('gold paid in at one house is paid out at another, less a fee that grows with the distance', () => {
        const game = fresh();
        const [a, b] = twoBanks(game);
        const gold = game.player.gold;
        const capB = b.capital;
        const t = Bills.terms(game.player, game.world, a.id, b.id, 2000);
        const res = Bills.draw(game.player, game.world, a.id, b.id, 2000);
        expect(res.success, res.reason).toBe(true);
        expect(gold - game.player.gold).toBe(2000 + t.fee);
        expect(b.capital - capB).toBe(2000);
        expect(t.fee).toBeGreaterThanOrEqual(Bills.config().minFee);
        const far = Bills.terms(game.player, game.world, a.id, b.id, 100000);
        expect(far.rate).toBeGreaterThan(Bills.config().base);
        // Not at the paying house, and not before it is due
        expect(Bills.present(game.player, game.world, res.bill.id).success).toBe(false);
        game.player.q = b.q;
        game.player.r = b.r;
        if (res.bill.payableFrom > game.world.day) expect(Bills.present(game.player, game.world, res.bill.id).success).toBe(false);
        game.world.day = res.bill.payableFrom;
        const before = game.player.gold;
        expect(Bills.present(game.player, game.world, res.bill.id).success).toBe(true);
        expect(game.player.gold - before).toBe(2000);
    });

    it('robbers take bills; stop one in time and it is safe, too late and a forger has cashed it', () => {
        const game = fresh();
        const [a, b] = twoBanks(game);
        Bills.config().stealChance = 1;
        try {
            Bills.draw(game.player, game.world, a.id, b.id, 1000);
            Bills.draw(game.player, game.world, a.id, b.id, 1000);
            const taken = Bills.onRobbed(game.player, game.world);
            expect(taken.length).toBe(2);
            game.player.q = b.q;
            game.player.r = b.r;
            expect(Bills.stop(game.player, game.world, taken[0].id).success).toBe(true);
            expect(taken[0].status).toBe('held');
            const capB = b.capital;
            game.world.day = taken[1].cashDay;
            const notes = Bills.processDay(game.world, game.player).notices;
            expect(taken[1].status).toBe('lost');
            expect(b.capital).toBe(capB - 1000);
            expect(notes.some(n => n.title === 'A Stolen Bill Cashed')).toBe(true);
        } finally {
            Bills.config().stealChance = 0.5;
        }
    });

    it('a bill on a failed house falls on the house that drew it; if both fail, the receivers pay part', () => {
        const game = fresh();
        const [a, b] = twoBanks(game);
        const one = Bills.draw(game.player, game.world, a.id, b.id, 1000).bill;
        b.status = 'failed';
        Bills.processDay(game.world, game.player);
        expect(one.protested).toBe(true);
        expect(Bills.payer(game.player, one)).toBe(a);
        a.status = 'failed';
        const gold = game.player.gold;
        Bills.processDay(game.world, game.player);
        expect(one.status).toBe('failed');
        const back = game.player.gold - gold;
        expect(back).toBeGreaterThan(0);
        expect(back).toBeLessThan(1000);
    });

    it('a forged bill needs the guild and may be seen through', () => {
        const game = fresh();
        const [a] = twoBanks(game);
        expect(Bills.forge(game.player, game.world, a.id, 1000).success).toBe(false);
        const g = Underworld.ensure(game.player).guild;
        g.member = true;
        g.rank = 3;
        const res = Bills.forge(game.player, game.world, a.id, 1000);
        expect(res.success || res.caught).toBe(true);
        if (res.caught) expect(Underworld.getHeat(game.player, a.kingdomId)).toBeGreaterThan(0);
        // The forger lies low between jobs
        expect(Bills.forge(game.player, game.world, a.id, 1000).success).toBe(false);
    });
});

describe('save, load and determinism', () => {
    it('the board, holdings and bills survive a save; an old save opens the Bourse on its next day', () => {
        const game = fresh();
        atExchange(game);
        Bourse.buy(game.player, game.world, listing(game, 'house').id, 5);
        const [a, b] = Finance.openBanks(game.player);
        game.player.q = a.q;
        game.player.r = a.r;
        Bills.draw(game.player, game.world, a.id, b.id, 500);
        days(game, 9);
        const before = { bourse: JSON.stringify(game.player.bourse), bills: JSON.stringify(game.player.bills) };
        const g2 = roundTrip(game);
        expect(JSON.stringify(g2.player.bourse)).toBe(before.bourse);
        expect(JSON.stringify(g2.player.bills)).toBe(before.bills);
        g2.player.bourse = undefined;
        expect(Bourse.loadState(g2.player)).toBe(null);
        g2.world.day++;
        Bourse.processDay(g2.world, g2.player);
        expect(Bourse.listed(g2.player).length).toBeGreaterThan(0);
    });

    it('the same seed gives the same prices, and the tick leaves the shared dice alone', () => {
        const run = () => {
            const game = fresh(3131);
            Utils.setSeed(9);
            days(game, 40);
            return { prices: Bourse.listed(game.player).map(l => l.price).join(','), next: Utils.random() };
        };
        const a = run();
        const b = run();
        expect(a.prices).toBe(b.prices);
        Utils.setSeed(9);
        expect(a.next).toBe(Utils.random());
    });
});

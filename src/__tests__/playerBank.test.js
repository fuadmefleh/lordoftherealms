// A banking house of the player's own (Finance.foundBank): the charter's
// conditions, the house's books day by day (deposits, the merchant loan book,
// interest, bad debts, clerks), the owner's desk (put in, draw, policy, wind
// up), a run that empties the vault, what the player may not do with their
// own house, net worth, and the save round-trip.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Finance } from '../systems/finance.js';
import { Bourse } from '../systems/bourse.js';
import { Underwriting } from '../systems/underwriting.js';
import { EconomyChronicle } from '../systems/economyChronicle.js';
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

function settlements(world) {
    return typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : world.getAllSettlements();
}

/** A fresh game, the player rich and well thought of, standing in a city with no house seated. */
function inFreeCity(seed = 777) {
    const game = newGame(seed);
    game.world.day = 1;
    Finance.loadState(game.player, game.world);
    const seats = new Set(Finance.openBanks(game.player).map(b => `${b.q},${b.r}`));
    const city = settlements(game.world).find(s => (s.type === 'city' || s.type === 'capital') && s.kingdom != null && !seats.has(`${s.q},${s.r}`));
    expect(city, 'a city with no banking house').toBeTruthy();
    const p = game.player;
    p.q = city.q;
    p.r = city.r;
    p.gold = 60000;
    p.reputation = p.reputation || {};
    p.reputation[city.kingdom] = 40;
    return { game, city };
}

function runDays(game, n) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        game.world.day++;
        notices.push(...Finance.processDay(game.world, game.player).notices);
    }
    return notices;
}

describe('Chartering a banking house', () => {
    it('is refused without standing, in a village, or where a house is seated', () => {
        const { game, city } = inFreeCity();
        const p = game.player;
        p.reputation[city.kingdom] = 0;
        expect(Finance.charterTerms(p, game.world).ok).toBe(false);
        p.reputation[city.kingdom] = 40;
        expect(Finance.charterTerms(p, game.world).ok).toBe(true);

        const village = settlements(game.world).find(s => s.type === 'village');
        p.q = village.q; p.r = village.r;
        expect(Finance.charterTerms(p, game.world).reason).toMatch(/city or capital/);

        const npc = Finance.openBanks(p)[0];
        p.q = npc.q; p.r = npc.r;
        p.reputation[npc.kingdomId] = 40;
        expect(Finance.charterTerms(p, game.world).reason).toMatch(/already seats/);
    });

    it('pays the fee to the crown and the capital into the vault', () => {
        const { game, city } = inFreeCity();
        const p = game.player;
        const k = game.world.getKingdom(city.kingdom);
        const treasury = k.treasury || 0;
        const terms = Finance.charterTerms(p, game.world);
        const res = Finance.foundBank(p, game.world, 10000);
        expect(res.success).toBe(true);
        expect(p.gold).toBe(60000 - 10000 - terms.fee);
        expect(k.treasury).toBe(treasury + terms.fee);
        const own = Finance.ownBank(p);
        expect(own.capital).toBe(10000);
        expect(own.owner).toBe('player');
        expect(Finance.openBanks(p)).toContain(own);
        // One house at a time
        expect(Finance.foundBank(p, game.world, 10000).success).toBe(false);
    });

    it('is not floated on the Bourse, keeps no insurance desk, and will not lend to or hold deposits for its owner', () => {
        const { game } = inFreeCity();
        const p = game.player;
        Finance.foundBank(p, game.world, 10000);
        const own = Finance.ownBank(p);
        Bourse.listed(p);
        runDays(game, 2);
        expect(Bourse.listed(p).some(l => l.kind === 'bank' && l.ref === own.id)).toBe(false);
        expect(Underwriting.underwriters(p).some(u => u.id === own.id)).toBe(false);
        expect(Finance.deposit(p, game.world, own.id, 1000).success).toBe(false);
        expect(Finance.loanOffers(p, game.world, own.id).every(o => !o.available)).toBe(true);
    });
});

describe("The house's books", () => {
    it('draws deposits, lends them on and keeps balanced books', () => {
        const { game } = inFreeCity();
        const p = game.player;
        Finance.foundBank(p, game.world, 10000);
        runDays(game, 120);
        const book = Finance.ownBook(p, game.world);
        expect(book.deposits).toBeGreaterThan(1000);
        expect(book.loanBook).toBeGreaterThan(1000);
        expect(book.interest30).toBeGreaterThan(book.paidOut30);
        expect(book.vault).toBeGreaterThan(0);
        // equity = vault + loan book + crown loans − deposits
        expect(Math.abs(book.equity - (book.vault + book.loanBook + book.crownLoans - book.deposits))).toBeLessThanOrEqual(3);
        // and every gold of it is paid-in capital plus the profit since
        expect(Math.abs(book.equity - (10000 + book.profitAll))).toBeLessThanOrEqual(5);
    });

    it('a steady house pays over a year, taken across worlds', () => {
        let profit = 0;
        for (const seed of [777, 12, 4242]) {
            const { game } = inFreeCity(seed);
            Finance.foundBank(game.player, game.world, 10000);
            runDays(game, 120);
            profit += Finance.ownBook(game.player, game.world).profitAll;
        }
        expect(profit).toBeGreaterThan(0);
    });

    it('lends more and keeps a thinner vault when bold than when cautious', () => {
        const share = (policy) => {
            const { game } = inFreeCity();
            Finance.foundBank(game.player, game.world, 10000);
            Finance.setBankPolicy(game.player, policy);
            runDays(game, 90);
            const b = Finance.ownBank(game.player);
            return b.loanBook / (b.loanBook + b.capital);
        };
        expect(share('bold')).toBeGreaterThan(share('cautious') + 0.15);
    });

    it('a cautious house lends nothing to the crowns', () => {
        const { game } = inFreeCity();
        const p = game.player;
        Finance.foundBank(p, game.world, 25000);
        Finance.setBankPolicy(p, 'cautious');
        const own = Finance.ownBank(p);
        // Make every other house unwilling, so a crown in need would come to ours
        for (const b of Finance.openBanks(p)) if (b !== own) for (const id of Object.keys(b.relations)) b.relations[id] = -50;
        const k = game.world.kingdoms.find(x => x && x.isAlive !== false);
        const before = Finance.crownLoansOf(game.world, own.id);
        Finance._crownBorrow(game.world, p, Finance.state(p), k, 5000, null, { force: true });
        expect(Finance.crownLoansOf(game.world, own.id)).toBe(before);
    });
});

describe("The owner's desk", () => {
    it('puts coin in and draws only what the depositors can spare', () => {
        const { game } = inFreeCity();
        const p = game.player;
        Finance.foundBank(p, game.world, 10000);
        expect(Finance.injectCapital(p, game.world, 5000).success).toBe(true);
        expect(Finance.ownBank(p).capital).toBe(15000);
        runDays(game, 60);
        const own = Finance.ownBank(p);
        const room = Finance.drawable(own);
        const gold = p.gold;
        const res = Finance.drawFromBank(p, game.world, null);
        expect(res.success).toBe(room > 0);
        expect(p.gold).toBe(gold + room);
        expect(Finance.drawFromBank(p, game.world, 1000).success).toBe(false);
        expect(own.capital).toBeGreaterThanOrEqual(Finance.ownReserveNeed(own) * 1.2 - 1);
    });

    it('needs the owner at the seat for coin to move', () => {
        const { game } = inFreeCity();
        const p = game.player;
        Finance.foundBank(p, game.world, 10000);
        p.q = (p.q + 5) % game.world.width;
        expect(Finance.injectCapital(p, game.world, 1000).success).toBe(false);
        expect(Finance.drawFromBank(p, game.world).success).toBe(false);
        expect(Finance.setBankPolicy(p, 'bold').success).toBe(true);
    });

    it('winds up: the depositors are paid and the rest comes home', () => {
        const { game } = inFreeCity();
        const p = game.player;
        Finance.foundBank(p, game.world, 10000);
        runDays(game, 40);
        const own = Finance.ownBank(p);
        const gold = p.gold;
        const equity = Finance.ownEquity(game.world, own);
        const res = Finance.windUpBank(p, game.world);
        expect(res.success).toBe(true);
        expect(own.status).toBe('closed');
        expect(Finance.ownBank(p)).toBe(null);
        expect(p.gold - gold).toBeGreaterThan(equity * 0.7);
        expect(p.gold - gold).toBeLessThanOrEqual(equity + 1);
        // Free to charter again
        expect(Finance.charterTerms(p, game.world).ok).toBe(true);
    });
});

describe('Runs and failure', () => {
    it('a run on a house that cannot pay its depositors ruins it and the owner', () => {
        const { game, city } = inFreeCity();
        const p = game.player;
        Finance.foundBank(p, game.world, 10000);
        const own = Finance.ownBank(p);
        own.publicDeposits = 50000;
        own.capital = 100;
        own.loanBook = 0;
        Finance._startRun(game.world, p, Finance.state(p), own, null, 'a test');
        const rep = p.reputation[city.kingdom];
        const notices = runDays(game, 1);
        expect(own.status).toBe('failed');
        expect(Finance.ownBank(p)).toBe(null);
        expect(p.reputation[city.kingdom]).toBeLessThan(rep);
        expect(notices.some(n => /failed/.test(n.text))).toBe(true);
    });

    it('a house with coin to spare pays the run out and stands', () => {
        const { game } = inFreeCity();
        const p = game.player;
        Finance.foundBank(p, game.world, 25000);
        const own = Finance.ownBank(p);
        own.publicDeposits = 8000;
        own.capital += 8000;
        Finance._startRun(game.world, p, Finance.state(p), own, null, 'a test');
        runDays(game, 15);
        expect(own.status).toBe('open');
        expect(own.publicDeposits).toBeLessThan(8000);
        expect(Finance.ownTrust(p, game.world, own)).toBeLessThan(1);
    });
});

describe('Worth and saves', () => {
    it('counts the house in net worth', () => {
        const { game } = inFreeCity();
        const p = game.player;
        Finance.foundBank(p, game.world, 10000);
        expect(EconomyChronicle.netWorth(p, game.world).assets.bank).toBe(10000);
    });

    it('survives a save and load', () => {
        const { game } = inFreeCity();
        const p = game.player;
        Finance.foundBank(p, game.world, 10000);
        runDays(game, 10);
        const g2 = roundTrip(game);
        expect(Finance.serialize(g2.player)).toEqual(Finance.serialize(p));
        expect(Finance.ownBank(g2.player).owner).toBe('player');
    });
});

describe('The Your House tab', () => {
    function shell(game) {
        const rec = { panels: [], notices: [] };
        game.ui = new Proxy({
            showCustomPanel: (title, html) => rec.panels.push(String(html)),
            showNotification: (title, msg) => rec.notices.push(`${title}: ${msg}`),
        }, { get: (t, prop) => (prop in t ? t[prop] : (typeof prop === 'symbol' ? undefined : () => {})) });
        return rec;
    }
    const clean = (html) => {
        expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
    };

    it('offers a charter, founds the house from its button, then shows the books and the desk', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { game } = inFreeCity();
        const rec = shell(game);
        const tile = game.world.getTile(game.player.q, game.player.r);
        ActionMenu.showBank(game, tile, 'house');
        let html = rec.panels.at(-1);
        clean(html);
        expect(html).toMatch(/Charter with/);
        // Every owner-desk op the panel offers routes to a real action
        ActionMenu.bankAct(game, 'foundBank', 10000);
        expect(Finance.ownBank(game.player)).toBeTruthy();
        runDays(game, 30);
        ActionMenu.showBank(game, tile, 'house');
        html = rec.panels.at(-1);
        clean(html);
        for (const label of ['Equity', 'Lending policy', 'Put in', 'Wind up']) expect(html).toContain(label);
        ActionMenu.bankAct(game, 'bankPolicy', 'bold');
        expect(Finance.ownBank(game.player).policy).toBe('bold');
        ActionMenu.bankAct(game, 'bankPutIn', 1000);
        clean(rec.panels.at(-1));
        expect(rec.notices.some(n => /vault/.test(n))).toBe(true);
    });
});

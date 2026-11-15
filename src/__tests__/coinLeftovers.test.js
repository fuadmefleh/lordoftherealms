// The coin sweep's leftovers (2026-11): the last places coin was made from or
// lost into nothing after the three-agent sweep (coinSystems.*). Goods sold on
// the spot for want of pack room were paid from nothing (PlayerInventory.addOrSell
// now takes a payer: the nearest town's purse); a company contract's import duty
// was credited to the crown from nothing; the chief factor's wage, the bourse's
// dividends and a mint's bullion price moved coin unrouted or unbooked until the
// week's turn; a dead townsperson's purse went uncounted until their estate was
// settled — and vanished when the forgotten dead were pruned; the inns rounded
// their cash to whole coins; a town with no purse record paid without limit;
// pirate captains' takings, public works' budgets, an avenger's purse and the
// stranger's purse were booked as coin lost though they still held it; the
// player's purse dropped out of the realms' count in the wilds. Each case
// below measures the census against the books around one action.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Economy } from '../world/economy.js';
import { Transport } from '../world/transport.js';
import { PlayerInventory } from '../core/inventory.js';
import { PlayerCoin } from '../player/playerCoin.js';
import { MercContracts } from '../player/mercContracts.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { TradePolicy } from '../systems/tradePolicy.js';
import { Stewards } from '../systems/stewards.js';
import { Bourse } from '../systems/bourse.js';
import { Mints } from '../systems/mints.js';
import { Titles } from '../systems/titles.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Hospitality } from '../systems/hospitality.js';
import { Pirates } from '../systems/pirates.js';
import { PublicWorks } from '../systems/publicWorks.js';
import { Nemesis } from '../systems/nemesis.js';
import { SoulPact } from '../systems/soulPact.js';
import { EstateSettlement } from '../player/estateSettlement.js';

let logSpy, warnSpy, g, towns;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    g = coinGame(303, 1);
    towns = coinTowns(g.world);
    g.player.gold = 20000;
}, 120000);
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

const TOL = 0.05;
const kingdomOf = (t) => g.world.kingdoms.find(k => k.id === t.settlement.kingdom);

/** Packs that hold nothing new: whatever is handed over is sold on the spot. */
function fullPacks(fn) {
    const was = g.player.maxInventory;
    g.player.maxInventory = -1000;
    try { return fn(); } finally { g.player.maxInventory = was; }
}

describe('the sweep\'s leftovers close', () => {
    it('goods sold for want of pack room are paid by the nearest town, never more than it holds', () => {
        const t = towns[0];
        standIn(g.player, t);
        const town0 = t.settlement.economy.gold;
        const c = {};
        const m = measure(g.world, g.player, () => fullPacks(() => MercContracts._takeItems(g.player, c, { iron: 6 }, g.world)));
        expect(c.loot).toBeGreaterThan(0);
        expect(t.settlement.economy.gold).toBeCloseTo(town0 - c.loot, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        // A town short of coin pays what it holds, and the player gets only that
        const saved = t.settlement.economy.gold;
        t.settlement.economy.gold = 3;
        const poor = measure(g.world, g.player, () => fullPacks(() => PlayerInventory.addOrSell(g.player, { iron: 20 }, PlayerCoin.payerHere(g.world, g.player))));
        expect(poor.result.gold).toBe(3);
        expect(t.settlement.economy.gold).toBe(0);
        expect(Math.abs(poor.unbooked)).toBeLessThan(TOL);
        t.settlement.economy.gold = saved;
    });

    it("a company contract's import duty comes out of the town that pays for the goods, not from nothing", () => {
        const t = towns[1];
        const other = towns.find(x => x.settlement.kingdom !== t.settlement.kingdom);
        standIn(g.player, t);
        const m = MerchantHouses.state(g.player);
        if (!MerchantHouses.company(g.player)) {
            m.charters.push({ kingdomId: t.settlement.kingdom, source: 'test', day: g.world.day });
            expect(MerchantHouses.found(g.player, g.world, { capital: Math.max(2000, MerchantHouses.config().found.minCapital) }).success).toBe(true);
        }
        const k = kingdomOf(t);
        const good = 'iron';
        TradePolicy.realm(k).imp[TradePolicy.categoryOf(good)] = 0.25;
        const contract = { id: 'ctT', status: 'accepted', good, qty: 10, delivered: 0, pay: 30, q: t.q, r: t.r, town: t.settlement.name };
        MerchantHouses.company(g.player).contracts.push(contract);
        const lots = { [good]: { [String(other.settlement.kingdom)]: 10 } };
        const tr0 = k.treasury;
        const r = measure(g.world, g.player, () => MerchantHouses._deliver(g.player, g.world, contract, 6, 'test', {}, { lots, held: 10 }));
        expect(r.result).toBeGreaterThan(0);
        expect(k.treasury).toBeGreaterThan(tr0);
        expect(Math.abs(r.unbooked)).toBeLessThan(TOL);
    });

    it("the chief factor's wage and skim leave the company's coffers for real purses", () => {
        const t = towns[1];
        standIn(g.player, t);
        const c = MerchantHouses.company(g.player);
        expect(c).toBeTruthy();
        c.capital = Math.max(c.capital, 3000);
        const seat = Stewards.seat(g.player, g.world, 'company') || { id: 'company', kind: 'company', place: c.name };
        const office = { id: 'cfT', kind: 'steward', name: 'Aldo', wage: 3, loyalty: 50, stewardship: 5 };
        const cap0 = c.capital;
        const w = measure(g.world, g.player, () => Stewards._week(g.player, g.world, seat, office, null, { notices: [] }));
        expect(c.capital).toBeLessThan(cap0);
        expect(Math.abs(w.unbooked)).toBeLessThan(TOL);
    });

    it("the bourse's dividend never pays out more than the company holds", () => {
        const c = MerchantHouses.company(g.player);
        const cap = c.capital;
        c.capital = 10.4;
        expect(Bourse._companyOut(c, g.world, 50, 'Dividend to the shareholders')).toBe(10);
        expect(c.capital).toBeCloseTo(0.4, 6);
        c.capital = cap;
    });

    it("bullion sold to a mint is on the books from the sale, not only at the week's strike", () => {
        const k = g.world.kingdoms.find(x => x.isAlive && x.capital);
        const tile = g.world.getTile(k.capital.q, k.capital.r);
        g.player.q = tile.q; g.player.r = tile.r;
        g.player.inventory.silver_ore = 50;
        const sold = measure(g.world, g.player, () => Mints.sellBullion(g.player, g.world, tile, 'silver_ore', 50));
        if (sold.result.success) {
            expect(sold.delta).toBeGreaterThan(0);
            expect(Math.abs(sold.unbooked)).toBeLessThan(TOL);
            // ...and the strike moves it into the mint's struck coin without booking it twice
            const R = MoneySupply.realm(g.world, k.id);
            const towns = g.world.getSettlementViews().filter(s => s.kingdom === k.id);
            const strike = measure(g.world, g.player, () => MoneySupply.mintWeek(g.world, k, R, towns));
            expect(R.mint.pendingPaid).toBe(0);
            expect(Math.abs(strike.unbooked)).toBeLessThan(TOL);
        }
        delete g.player.inventory.silver_ore;
    });

    it("a Royal Cartographer's commission, given the world, is paid by the crown at once", () => {
        const t = towns[0];
        const k = kingdomOf(t);
        standIn(g.player, t);
        g.player.allegiance = k.id;
        g.player.currentTitle = 'royal_cartographer';
        delete g.player.titlePayOwed;
        k.treasury = Math.max(k.treasury, 1000);
        const tr0 = k.treasury;
        const m = measure(g.world, g.player, () => Titles.recordSurvey(g.player, g.world));
        expect(m.result).toBeGreaterThan(0);
        expect(g.player.titlePayOwed).toBeUndefined();
        expect(k.treasury).toBeCloseTo(tr0 - m.result, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        g.player.currentTitle = null;
    });

    it("a townsperson slain without the world keeps their coin counted, and the forgotten dead leave it to the town", () => {
        const t = towns[2];
        if (!t.settlement.folk) Townsfolk.seed(t.settlement, g.world, { q: t.q, r: t.r });
        const folk = t.settlement.folk;
        const p = Townsfolk.residents(folk).find(x => x.purse > 0) || Townsfolk.residents(folk)[0];
        p.purse = 37.5;
        const slain = measure(g.world, g.player, () => Townsfolk.slay(folk, p, g.world.day, 'a brawl'));
        expect(Math.abs(slain.unbooked)).toBeLessThan(TOL);
        // (in the realm's count too, until the estate settles)
        const kid = t.settlement.kingdom;
        const before = CoinCensus.count(g.world, null).get(kid).folk;
        expect(before).toBeGreaterThan(0);
        // Long forgotten: the purse goes to the heir or the town before the record goes
        p.died = g.world.day - 400 * 120;
        delete p.mem;
        const pruned = measure(g.world, g.player, () => Townsfolk._prune(folk, g.world.day, null, g.world));
        expect(Math.abs(pruned.unbooked)).toBeLessThan(TOL);
    });

    it("the inns keep their cash to the copper: a week's takings from a town short of coin lose none of it", () => {
        const st = Hospitality.state(g.world);
        const h = Object.values(st.houses || {})[0];
        if (!h) return;
        const tile = g.world.getTile(h.q, h.r);
        const s = tile && tile.settlement;
        if (!s || !s.economy) return;
        const saved = s.economy.gold;
        s.economy.gold = 17.37;
        h.cash = 12.25;
        const wk = measure(g.world, g.player, () => Hospitality._npcWeek(g.world, g.player));
        expect(Math.abs(wk.unbooked)).toBeLessThan(0.01);
        s.economy.gold = saved + (s.economy.gold - 17.37);
    });

    it('every town keeps a purse record once coin is counted, so a draw is capped by what it holds', () => {
        const t = towns[towns.length - 1];
        const s = t.settlement;
        const econ = s.economy;
        delete s.economy;
        expect(Economy.drawTown(s, 50)).toBe(50); // (record-less: drawTown's old rule)
        const made = measure(g.world, g.player, () => Economy.ensurePurses(g.world));
        expect(made.result).toBeGreaterThanOrEqual(1);
        expect(Math.abs(made.unbooked)).toBeLessThan(TOL);
        expect(Economy.drawTown(s, 50)).toBe(0);
        s.economy = econ;
    });

    it("a pirate captain's takings are counted coin: what they take and what is won back from them is no leak", () => {
        const st = Pirates.ensure(g.player, g.world);
        const cap = st.captains[0];
        cap.loot = 0;
        const lostTo = measure(g.world, g.player, () => { g.player.gold -= 120; cap.loot += 120; });
        expect(Math.abs(lostTo.unbooked)).toBeLessThan(TOL);
        expect(lostTo.delta).toBe(0);
        // A haven raided: the captains' takings come back to the player with the haven's hoard
        const h = Pirates.haven(g.player, cap.havenId);
        const ship = { id: 's', cargo: {}, condition: 100 };
        const gold0 = g.player.gold;
        const raid = measure(g.world, g.player, () => Pirates._havenWon(g.player, g.world, { havenId: cap.havenId, enemy: { str0: 5 } }, ship));
        expect(g.player.gold - gold0).toBeGreaterThanOrEqual(120);
        expect(cap.loot).toBe(0);
        expect(Math.abs(raid.unbooked)).toBeLessThan(TOL);
        expect(h).toBeTruthy();
    });

    it("a public work's budget is counted with its paymaster: commissioning, paying and forgetting it close", () => {
        const t = towns[1];
        standIn(g.player, t);
        const st = Transport.state(g.world);
        const w = {
            id: 'pwL', kind: 'repair', name: 'Leftover Works', owner: 'player', payer: 'player', kid: t.settlement.kingdom,
            status: 'building', est: 300, budget: 0, spent: 0, days: 10, daysDone: 0, hands: 4,
            need: {}, got: {}, tq: t.q, tr: t.r, q: t.q, r: t.r,
        };
        st.works.push(w);
        const put = measure(g.world, g.player, () => { g.player.gold -= 200; w.budget = 200; });
        expect(put.delta).toBe(0);
        const kid = t.settlement.kingdom;
        expect(CoinCensus.count(g.world, g.player).get(kid).coffers).toBeGreaterThanOrEqual(200);
        const pay = measure(g.world, g.player, () => PublicWorks._pay(g.world, g.player, w, 50, t.settlement));
        expect(Math.abs(pay.unbooked)).toBeLessThan(TOL);
        const back = measure(g.world, g.player, () => PublicWorks.abandon(g.world, g.player, 'pwL'));
        expect(back.result.success).toBe(true);
        expect(Math.abs(back.unbooked)).toBeLessThan(TOL);
        expect(back.booked).toBe(0);
    });

    it("an avenger's purse is counted: born booked found, spending moves it, the feud's end books what is left lost", () => {
        const t = towns[0];
        standIn(g.player, t);
        const st = Nemesis.state(g.player);
        const born = measure(g.world, g.player, () => Nemesis._birth(g.player, g.world, { kind: 'blood', name: 'Edric Vane', ref: { folkRef: 'x#1' }, score: 50, deed: { key: 'wrong', label: 'a wrong' } }, { notices: [] }));
        const nm = st.list.find(n => n.name === 'Edric Vane');
        expect(nm).toBeTruthy();
        expect(born.booked).toBeCloseTo(nm.purse, 6);
        expect(Math.abs(born.unbooked)).toBeLessThan(TOL);
        const k = kingdomOf(t);
        const spend = measure(g.world, g.player, () => { const paid = -Nemesis._pay(g.player, g.world, nm, -40); k.treasury += paid; });
        expect(spend.booked).toBe(0);
        expect(Math.abs(spend.unbooked)).toBeLessThan(TOL);
        const ended = measure(g.world, g.player, () => Nemesis._end(g.player, g.world, nm, 'reconciled', null));
        expect(Math.abs(ended.unbooked)).toBeLessThan(TOL);
    });

    it("the stranger keeps what souls pay and pays the next price out of it", () => {
        const t = towns[1];
        standIn(g.player, t);
        const sp = SoulPact.state(g.player);
        sp.state = 'due';
        sp.buyer = 'the stranger';
        sp.demand = { kind: 'pay', gold: 60 };
        const paid = measure(g.world, g.player, () => SoulPact.answer(g.player, g.world, 'pay'));
        expect(paid.result.success).toBe(true);
        expect(paid.delta).toBe(0);
        expect(sp.purse).toBe(60);
        expect(Math.abs(paid.unbooked)).toBeLessThan(TOL);
    });

    it("the player's purse is counted in a realm even in the wilds, and walking out of a town moves no coin", () => {
        const t = towns[0];
        standIn(g.player, t);
        let wild = null;
        for (let r = 0; r < g.world.height && !wild; r++) {
            for (let q = 0; q < g.world.width; q++) {
                const tile = g.world.getTile(q, r);
                if (tile && !tile.settlement && tile.kingdom == null && tile.terrain && tile.terrain.passable) { wild = tile; break; }
            }
        }
        expect(wild).toBeTruthy();
        const sum = (m) => [...m.values()].reduce((a, o) => a + o.player, 0);
        const inTown = sum(CoinCensus.count(g.world, g.player));
        const walk = measure(g.world, g.player, () => { g.player.q = wild.q; g.player.r = wild.r; });
        expect(walk.delta).toBe(0);
        expect(sum(CoinCensus.count(g.world, g.player))).toBeCloseTo(inTown, 2);
        standIn(g.player, t);
    });

    it("an estate's company capital is counted coin before and after it is settled", () => {
        const c = MerchantHouses.company(g.player);
        expect(c).toBeTruthy();
        const before = CoinCensus.total(g.world, g.player).byKind.banks;
        expect(before).toBeGreaterThanOrEqual(c.capital);
        const settled = measure(g.world, g.player, () => EstateSettlement.settle(g.player, g.world, { cause: 'test' }));
        expect(c.capital).toBe(0);
        expect(Math.abs(settled.unbooked)).toBeLessThan(TOL);
    });
});

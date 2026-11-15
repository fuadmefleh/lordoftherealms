// Coin conservation in systems m–n (2026-11, mzA sweep): each action below
// moved coin from or into nowhere before — a letter's enclosed gold went to no
// one unless a lord got it, a lost letter's coin was never booked, a merchant
// house's threat paid from nothing; the player's merchant company sold to
// towns that never paid and bought from towns that were never paid (and its
// coffers are not in the census: what crosses into them is booked); the
// merchant prince's builders, landlords and stallholders went unpaid; a
// migrant column's purses dropped out of the census on the road; an avenger's
// purse paid allies and assassins more than it held; a favour's loan and its
// repayment came from and went to no one; a map trader's coin sat in an
// uncounted purse. Now each draws from a real purse, pays into one, or is
// booked (MoneySupply.leak).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { Mail } from '../systems/mail.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { Migration } from '../systems/migration.js';
import { Nemesis } from '../systems/nemesis.js';
import { NpcKnowledge } from '../systems/npcKnowledge.js';
import { NpcShops } from '../systems/npcShops.js';
import { MapTheft } from '../systems/mapTheft.js';
import { Economy } from '../world/economy.js';

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

describe('systems m–n move real coin', () => {
    it("a letter's enclosed gold reaches the lord's chests; a lost letter's coin is booked lost; one that came back returns it", () => {
        const t = towns[0];
        standIn(g.player, t);
        const k = kingdomOf(t);
        const tr0 = k.treasury;
        const L = { id: 9001, kind: 'gift', gold: 80, rider: null, to: { type: 'lord', name: 'a lord', q: t.q, r: t.r }, courier: { id: 'own', name: 'a rider', reliability: 1 } };
        const sent = measure(g.world, g.player, () => {
            g.player.gold -= 80; // (sent)
            Mail._landCoin(g.world, g.player, L, L.to, { kingdom: k });
        });
        expect(k.treasury).toBeCloseTo(tr0 + 80, 6);
        expect(L.gold).toBe(0);
        expect(Math.abs(sent.unbooked)).toBeLessThan(TOL);

        // Lost on the road with no rider: booked out of the world
        const L2 = { ...L, id: 9002, gold: 40 };
        const lost = measure(g.world, g.player, () => {
            g.player.gold -= 40;
            Mail.robLetter(g.world, g.player, L2, { notices: [] });
        });
        expect(lost.booked).toBeCloseTo(-40, 6);
        expect(Math.abs(lost.unbooked)).toBeLessThan(TOL);

        // Came back: the coin with it
        const L3 = { ...L, id: 9003, gold: 25 };
        const g0 = g.player.gold;
        const back = measure(g.world, g.player, () => {
            g.player.gold -= 25;
            Mail._returnCoin(g.world, g.player, L3);
        });
        expect(g.player.gold).toBeCloseTo(g0, 6);
        expect(Math.abs(back.unbooked)).toBeLessThan(TOL);
    });

    it('coin in transit with a letter or a reply is counted on the road until it is handed over', () => {
        const t = towns[0];
        standIn(g.player, t);
        const k = kingdomOf(t);
        const st = Mail.state(g.player);
        const L = { id: 9101, kind: 'gift', gold: 60, rider: null, status: 'transit', from: { q: t.q, r: t.r, name: t.settlement.name }, to: { type: 'lord', name: 'a lord', q: t.q, r: t.r }, courier: { id: 'own', name: 'a rider', reliability: 1 }, sentDay: g.world.day };
        // Sent: out of the purse, onto the road (Mail.send's two steps)
        const send = measure(g.world, g.player, () => { g.player.gold -= 60; st.outbox.push(L); });
        expect(send.delta).toBeCloseTo(0, 6);
        expect(Math.abs(send.unbooked)).toBeLessThan(TOL);
        // Delivered: into the crown's chests, off the road
        const tr0 = k.treasury;
        const land = measure(g.world, g.player, () => {
            Mail._landCoin(g.world, g.player, L, L.to, { kingdom: k });
            Mail._done(g.player, L, 'delivered', 'test');
        });
        expect(k.treasury).toBeCloseTo(tr0 + 60, 6);
        expect(Math.abs(land.unbooked)).toBeLessThan(TOL);
        // A reply's purse and its writer's enclosure, drawn as it is written, paid as it comes home
        const R = { id: 9102, gold: 0, from: { q: t.q, r: t.r, name: 'a lord' }, hooks: [] };
        const write = measure(g.world, g.player, () => {
            R.gold = Math.floor(Economy.drawTown(t.settlement, 30));
            R.hooks.push({ k: 'enclose_coin', arrive: { gold: Math.floor(Economy.drawTown(t.settlement, 5)) } });
            st.replies.push(R);
        });
        expect(Math.abs(write.unbooked)).toBeLessThan(TOL);
        const home = measure(g.world, g.player, () => {
            st.replies = st.replies.filter(x => x !== R);
            g.player.gold += R.gold;
            Mail._arrive(g.world, g.player, R, { notices: [] });
        });
        expect(Math.abs(home.unbooked)).toBeLessThan(TOL);
    });

    it("the player's company: capital paid in and drawn, its fees to towns and its sales from them, all booked", () => {
        const t = towns[1];
        standIn(g.player, t);
        const m = MerchantHouses.state(g.player);
        m.charters.push({ kingdomId: t.settlement.kingdom, source: 'test', day: g.world.day });
        const gold0 = g.player.gold;
        const founded = measure(g.world, g.player, () => {
            const res = MerchantHouses.found(g.player, g.world, { capital: Math.max(2000, MerchantHouses.config().found.minCapital) });
            expect(res.success).toBe(true);
            MerchantHouses.deposit(g.player, g.world, 500);
            MerchantHouses.withdraw(g.player, g.world, 300);
        });
        expect(g.player.gold).toBeLessThan(gold0);
        expect(Math.abs(founded.unbooked)).toBeLessThan(TOL);

        // A fee into a town, and a sale the town's buyers pay for
        const c = MerchantHouses.company(g.player);
        const town0 = t.settlement.economy.gold;
        const flows = measure(g.world, g.player, () => {
            MerchantHouses._toTown(g.world, t.settlement, MerchantHouses._debit(c, g.world, 120, 'audits', 'test'));
            MerchantHouses._credit(c, g.world, MerchantHouses._fromTown(g.world, t.settlement, 200, 0), 'sales', 'test');
        });
        expect(t.settlement.economy.gold).toBeCloseTo(town0 + 120 - 200, 6);
        expect(Math.abs(flows.unbooked)).toBeLessThan(TOL);

        // A price war: the company's coin and the rival's losses go to the rival's towns
        const r = MerchantHouses.activeRivals(g.player).find(x => x.capital > 2000);
        expect(r).toBeTruthy();
        {
            const war = measure(g.world, g.player, () => MerchantHouses.priceWar(g.player, g.world, r.id, MerchantHouses.config().rivals.priceWar.minSpend));
            expect(Math.abs(war.unbooked)).toBeLessThan(TOL);
        }
        // Shares bought from a house's partners and sold back to them: the coin to and from its towns
        const r2 = MerchantHouses.activeRivals(g.player).find(x => x.capital > 0 && x.status === 'active');
        if (r2) {
            MerchantHouses.deposit(g.player, g.world, 3000);
            const shares = measure(g.world, g.player, () => {
                const b = MerchantHouses.buyShares(g.player, g.world, r2.id, 5);
                expect(b.success).toBe(true);
                MerchantHouses.sellShares(g.player, g.world, r2.id, 5);
            });
            expect(Math.abs(shares.unbooked)).toBeLessThan(TOL);
        }
    });

    it("the merchant prince's key fee goes to the town's landlords", () => {
        const t = towns[2];
        standIn(g.player, t);
        const tile = g.world.getTile(t.q, t.r);
        const town0 = t.settlement.economy.gold;
        const gold0 = g.player.gold;
        const m = measure(g.world, g.player, () => {
            const res = MerchantPrince.rentWarehouse(g.player, g.world, tile, 'small');
            expect(res.success).toBe(true);
        });
        const fee = gold0 - g.player.gold;
        expect(fee).toBeGreaterThan(0);
        expect(t.settlement.economy.gold).toBeCloseTo(town0 + fee, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("a migrant column carries its households' coin on the road, and hands it over when robbed or when it arrives", () => {
        const [a, b] = [towns[0], towns[3] || towns[1]];
        const mk = (purse) => [{ people: [{ oid: 1, purse }, { oid: 2, purse: purse / 2 }] }];
        // Spawned with coin taken from the town's people: the unit's purse counts it
        const spawn = measure(g.world, g.player, () => {
            a.settlement.economy.gold -= 30; // (their purses leave the town with them)
            Migration._spawnColumn(g.world, a.settlement, b.settlement, 2, 'settlers', 'work', mk(20), g.world.day);
        });
        const u = g.world.units[g.world.units.length - 1];
        expect(u.purse).toBeCloseTo(30, 6);
        // (in the census only while it stands in a realm)
        if (Math.abs(spawn.delta) < TOL) expect(Math.abs(spawn.unbooked)).toBeLessThan(TOL);
        standIn(g.player, a);
        u.q = a.q; u.r = a.r;
        const robbed = measure(g.world, g.player, () => Migration.onAttacked(g.player, g.world, u, true, {}));
        expect(Math.abs(robbed.unbooked)).toBeLessThan(TOL);
        expect(u.purse).toBe(0);
    });

    it("an avenger's purse pays no more than it holds, and its coin crossing into the world is booked", () => {
        // (an avenger's own purse is counted coin since 2026-11 — coinLeftovers.test.js — so the
        // avenger must be on the list the census walks; the coin then moves unbooked)
        const nm = { id: 'nmT', kind: 'blood', ref: {}, name: 'An Avenger', purse: 100, hatred: 60 };
        Nemesis.state(g.player).list.push(nm);
        const t = towns[0];
        standIn(g.player, t);
        const m = measure(g.world, g.player, () => {
            const paid = -Nemesis._pay(g.player, g.world, nm, -500); // (wants 500, holds 100)
            expect(paid).toBeCloseTo(100, 6);
            g.world.kingdoms[0].treasury += paid;
            g.player.gold -= 70;
            Nemesis._pay(g.player, g.world, nm, 70); // (a fine paid to them)
        });
        expect(nm.purse).toBeCloseTo(70, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        Nemesis.state(g.player).list = Nemesis.state(g.player).list.filter(n => n !== nm);
    });

    it("a favour's loan comes out of the town's purse and its repayment goes back in", () => {
        const t = towns[1];
        standIn(g.player, t);
        const mem = { disposition: 80, timesSpoken: 3 };
        const npc = { id: 77, uid: 'npcLoanT', type: 'villager' };
        // (the favour's loan: what askFavour lends when no other kindness comes first)
        const lend = measure(g.world, g.player, () => {
            const gold = NpcKnowledge._lenderPurse(g.world, npc, t.settlement, t.q, t.r).take(18);
            g.player.gold += gold;
            mem.owed = { amount: gold, day: g.world.day, due: g.world.day + 30, dunned: false, q: t.q, r: t.r };
        });
        expect(Math.abs(lend.unbooked)).toBeLessThan(TOL);
        expect(mem.owed.amount).toBe(18);
        {
            const town0 = t.settlement.economy.gold;
            const pay = measure(g.world, g.player, () => NpcKnowledge.repay(g.player, mem, g.world.day, g.world, npc));
            expect(t.settlement.economy.gold).toBeGreaterThan(town0);
            expect(Math.abs(pay.unbooked)).toBeLessThan(TOL);
        }
    });

    it("a map trader's own coin goes into the town's purse; restitution for a stolen chart goes to its owner's town", () => {
        const t = towns[2];
        standIn(g.player, t);
        const npc = { id: 'shopT', name: 'A Trader' };
        const town0 = t.settlement.economy.gold;
        const shop = measure(g.world, g.player, () => {
            g.player.gold -= 30;
            NpcShops.pay(g.world, t.settlement, npc, { n: 3, own: 3, town: t.settlement }, 30);
        });
        expect(t.settlement.economy.gold).toBeCloseTo(town0 + 30, 6);
        expect(Math.abs(shop.unbooked)).toBeLessThan(TOL);

        MapTheft.grudges(g.player).push({ id: 'mgT', owner: 'A Cartographer', settlement: t.settlement.name, q: t.q, r: t.r, kingdom: t.settlement.kingdom, mapIds: [], value: 60, day: g.world.day, status: 'bounty' });
        const pay = measure(g.world, g.player, () => MapTheft.answer(g.player, g.world, 'mgT', 'pay'));
        expect(Math.abs(pay.unbooked)).toBeLessThan(TOL);
    });
});

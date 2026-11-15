// Coin conservation in systems r–s (2026-11): each action below moved coin
// from or into nowhere before — a fine paid to the watch, the stranger's
// gold for a soul, a purse fished from a river (booked on a realm line the
// books never summed), a race's wager doubled from no one, a rival House's
// coin spent at a seat that keeps no purse, a treasury theft whose haul went
// nowhere, sailors' signing money and wages, a ship sold for coin no port
// paid, a relief host's war chest, a steward's wage to a holder with no
// purse. Now each draws from a real purse, pays into one, or is booked.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { coinGame, measure, coinTowns, standIn } from './playtest/coinCheck.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { SoulPact } from '../systems/soulPact.js';
import { RiverFlotsam } from '../systems/riverFlotsam.js';
import { Rivals } from '../systems/rivals.js';
import { RivalHouses } from '../systems/rivalHouses.js';
import { Schemes } from '../systems/schemes.js';
import { Sagas } from '../systems/sagas.js';
import { Ships } from '../systems/ships.js';
import { Sieges } from '../systems/sieges.js';
import { Stewards } from '../systems/stewards.js';
import { Scavengers } from '../systems/scavengers.js';

let logSpy, warnSpy, g, towns;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    g = coinGame(303, 1);
    towns = coinTowns(g.world);
    g.player.gold = 5000;
}, 120000);
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

const TOL = 0.05;
const P = () => g.player;
const W = () => g.world;

/** A rival House record with a purse, seated in `town` (counted by the census as coffers). */
function rivalHouse(key, town, gold = 800) {
    const p = P();
    if (!p.house) p.house = { name: 'House Test', rivals: {} };
    if (!p.house.rivals) p.house.rivals = {};
    const r = { name: `House ${key}`, kingdomId: town.settlement.kingdom, gold, feud: 60, seat: { q: town.q, r: town.r, name: town.settlement.name } };
    p.house.rivals[key] = r;
    return r;
}

describe('systems r–s move real coin', () => {
    it("a fine paid to the watch goes into the town's purse", () => {
        const t = towns[0];
        const s = standIn(P(), t);
        const st = StreetCrime.ensure(P());
        const inc = { id: st.nextId++, k: 'assault', victim: 'Bram', town: s.name, key: `${t.q},${t.r}`, kingdom: s.kingdom, d: W().day, witnessed: true, witnesses: [], answered: false };
        st.incidents.push(inc);
        const town0 = s.economy.gold, gold0 = P().gold;
        const m = measure(W(), P(), () => StreetCrime.answerWatch(P(), W(), inc.id, 'fine', s));
        expect(m.result.outcome).toBe('fined');
        expect(gold0 - P().gold).toBeGreaterThan(0);
        expect(s.economy.gold - town0).toBeCloseTo(gold0 - P().gold, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("the stranger's gold for a soul is booked found, the debt paid back held in the stranger's purse, the temple's offerings go to the town", () => {
        const t = towns[1];
        standIn(P(), t);
        const tile = W().getTile(t.q, t.r);
        const sold = measure(W(), P(), () => SoulPact.sell(P(), W(), tile));
        expect(sold.result.success).toBe(true);
        expect(sold.delta).toBeGreaterThan(0);
        expect(Math.abs(sold.unbooked)).toBeLessThan(TOL);
        const st = SoulPact.state(P());
        st.state = 'due';
        st.demand = { kind: 'pay', gold: 50 };
        const paid = measure(W(), P(), () => SoulPact.answer(P(), W(), 'pay'));
        expect(paid.result.success).toBe(true);
        // (since 2026-11 the debt goes into the stranger's purse — counted coin, paid out again to
        // the next soul sold — so the world's coin does not fall: coinLeftovers.test.js)
        expect(paid.delta).toBeCloseTo(0, 6);
        expect(Math.abs(paid.unbooked)).toBeLessThan(TOL);
        const town0 = t.settlement.economy.gold;
        const red = measure(W(), P(), () => SoulPact.redeem(P(), W(), 'temple', 0));
        expect(red.result.success).toBe(true);
        expect(t.settlement.economy.gold - town0).toBeCloseTo(red.result.cost, 6);
        expect(Math.abs(red.unbooked)).toBeLessThan(TOL);
    });

    it('a purse fished out of a river is booked as found', () => {
        standIn(P(), towns[0]);
        const m = measure(W(), P(), () => RiverFlotsam.receive(W(), P(), { itemId: 'driftwood', qty: 1, coins: 23 }));
        if (m.result.ok) {
            expect(m.result.coins).toBe(23);
            expect(m.delta).toBeCloseTo(23, 6);
        }
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("a race lost pays the rival your stake (not a double one from nowhere); sabotage pays the cutthroats' town", () => {
        const t = towns[0];
        standIn(P(), t);
        const rival = Rivals._makeRival(P(), W());
        rival.q = t.q; rival.r = t.r;
        const st = Rivals.state(P());
        // (the stake was booked out when laid down)
        st.race = { rivalId: rival.id, key: 'nowhere', q: t.q, r: t.r, siteName: 'the old barrow', wager: 75, deadline: W().day };
        const r0 = rival.gold;
        const m = measure(W(), P(), () => Rivals._settleRace(P(), W(), () => {}));
        expect(rival.gold - r0).toBeCloseTo(75, 6);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        const cost = Rivals.config().sabotage.cost;
        const gold0 = P().gold;
        const sab = measure(W(), P(), () => Rivals.sabotage(P(), W(), rival.id));
        expect(sab.result.success).toBe(true);
        expect(gold0 - P().gold).toBe(cost);
        expect(Math.abs(sab.unbooked)).toBeLessThan(TOL);
    });

    it("a rival House's spending at a seat that keeps no coin goes to the nearest town that does", () => {
        const t = towns[2];
        const rival = rivalHouse('rhTest', t, 600);
        rival.seat = { q: -999, r: -999, name: 'nowhere' };
        const m = measure(W(), P(), () => { rival.gold -= 40; return RivalHouses._spendAtSeat(W(), rival, 40); });
        expect(m.result).toBe(40);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
    });

    it("a treasury theft's haul goes to the plotting House; buying off a plot pays it; guards are paid in town", () => {
        const t = towns[0];
        standIn(P(), t);
        const rival = rivalHouse('rhThief', t, 300);
        const scheme = { id: 'sc_t1', type: 'theft', rivalId: 'rhThief', rivalName: rival.name, revealed: true, target: { label: 'your treasury' } };
        const r0 = rival.gold;
        const gold0 = P().gold;
        const theft = measure(W(), P(), () => Schemes.TYPES.theft.resolve(P(), W(), scheme));
        const lost = gold0 - P().gold;
        expect(lost).toBeGreaterThan(0);
        expect(rival.gold - r0).toBeCloseTo(lost, 6);
        expect(Math.abs(theft.unbooked)).toBeLessThan(TOL);
        // a House without a record: the coin is spent in the nearest town
        const gone = measure(W(), P(), () => { P().gold -= 30; return Schemes._toRival(P(), W(), 'noSuchHouse', 30); });
        expect(Math.abs(gone.unbooked)).toBeLessThan(TOL);
        if (!Array.isArray(P().house.schemes)) P().house.schemes = [];
        P().house.schemes.push(scheme);
        const g1 = P().gold, r1 = rival.gold;
        const bribe = measure(W(), P(), () => Schemes.bribe(P(), W(), 'sc_t1', 'gold'));
        expect(bribe.result.success).toBe(true);
        expect(rival.gold - r1).toBeCloseTo(g1 - P().gold, 6);
        expect(Math.abs(bribe.unbooked)).toBeLessThan(TOL);
    });

    it("a saga's treasury gain is the coin the player paid in, the rest raised from the realm's towns", () => {
        const t = towns[0];
        const kid = t.settlement.kingdom;
        const saga = { id: 'sea_reavers', anchor: { kingdomId: kid }, flags: {}, involved: true };
        const c = { player: P(), world: W(), saga, notify: () => {}, paidIn: 300 };
        const m = measure(W(), P(), () => { P().gold -= 300; Sagas._apply(c, { do: 'treasury', amount: 300, scope: 'kingdom' }); });
        expect(c.paidIn).toBe(0);
        expect(Math.abs(m.unbooked)).toBeLessThan(TOL);
        const raise = measure(W(), P(), () => Sagas._apply({ ...c, paidIn: 0 }, { do: 'treasury', amount: 120, scope: 'kingdom' }));
        expect(Math.abs(raise.unbooked)).toBeLessThan(TOL);
    });

    it("a ship's sailors, wages, repairs and sale are paid by and into the port's purse; a sea find is booked", () => {
        const port = towns.find(x => Ships.isPortTile(W(), x.q, x.r));
        expect(port).toBeTruthy();
        standIn(P(), port);
        const typeId = 'sloop';
        const ship = { id: 'ship_mzC', typeId, name: 'Gull', q: port.q, r: port.r, status: 'docked', condition: 70, customizations: [], cargo: {}, crew: 0, morale: 60 };
        P().ships = [ship];
        const hire = measure(W(), P(), () => Ships.hireCrew(P(), W(), ship.id, 3));
        expect(hire.result.success).toBe(true);
        expect(Math.abs(hire.unbooked)).toBeLessThan(TOL);
        const wages = measure(W(), P(), () => Ships._payCrews(P(), P().ships, W()));
        expect(Math.abs(wages.unbooked)).toBeLessThan(TOL);
        const repair = measure(W(), P(), () => Ships.repairShip(P(), ship.id, W()));
        expect(repair.result.success).toBe(true);
        expect(Math.abs(repair.unbooked)).toBeLessThan(TOL);
        const find = measure(W(), P(), () => Ships._applyReward(P(), { gold: [40, 60] }, ship, W()));
        expect(find.delta).toBeGreaterThan(0);
        expect(Math.abs(find.unbooked)).toBeLessThan(TOL);
        const sale = measure(W(), P(), () => Ships.sellShip(P(), ship.id, W()));
        expect(sale.result.success).toBe(true);
        expect(Math.abs(sale.unbooked)).toBeLessThan(TOL);
    });

    it("a siege camp's spending reaches a purse; a relief host's war chest is drawn from its realm's towns", () => {
        const t = towns[0];
        const other = towns.find(x => x.settlement.kingdom === t.settlement.kingdom && x !== t) || towns[1];
        const s = { q: t.q, r: t.r, name: t.settlement.name, relief: { id: 'relief_mzC', name: 'The Relief', q: other.q, r: other.r, strength: 40, kingdomId: other.settlement.kingdom, departDay: W().day + 5 } };
        const spend = measure(W(), P(), () => { P().gold -= 60; return Sieges._spendNear(W(), s, 60); });
        expect(spend.result).toBe(60);
        expect(Math.abs(spend.unbooked)).toBeLessThan(TOL);
        const spawn = measure(W(), P(), () => Sieges._spawnRelief(W(), s));
        expect(spawn.result.inventory.gold).toBeGreaterThan(0);
        expect(Math.abs(spawn.unbooked)).toBeLessThan(TOL);
        spawn.result.destroyed = true;
    });

    it("a steward's wage, with no purse of their own, is spent in their seat's town; their pocket is drawn out of it", () => {
        const t = towns[1];
        const seat = { id: `holding:${t.q},${t.r}`, kind: 'holding', q: t.q, r: t.r, settlement: t.settlement, place: t.settlement.name };
        const office = { id: 'stw_mzC', kind: 'steward', name: 'Osric' };
        const town0 = t.settlement.economy.gold;
        const wage = measure(W(), P(), () => { P().gold -= 25; return Stewards._payHolder(P(), W(), seat, office, 25); });
        expect(t.settlement.economy.gold - town0).toBeCloseTo(25, 6);
        expect(Math.abs(wage.unbooked)).toBeLessThan(TOL);
        const seize = measure(W(), P(), () => { const got = Stewards._fromPocket(P(), W(), seat, 40); P().gold += got; return got; });
        expect(seize.result).toBeCloseTo(40, 6);
        expect(Math.abs(seize.unbooked)).toBeLessThan(TOL);
    });

    it("a looter who is no townsperson spends the player's coin in the town; coin dug from a grave by a townsperson is found again", () => {
        const t = towns[0];
        standIn(P(), t);
        const loot = measure(W(), P(), () => {
            const took = Scavengers.lootPlayer(P(), { name: 'a cutpurse' }, W().day, {});
            Scavengers.fence(t.settlement, { pid: null }, took);
            return took;
        });
        expect(loot.result.gold).toBeGreaterThan(0);
        expect(Math.abs(loot.unbooked)).toBeLessThan(TOL);
    });
});

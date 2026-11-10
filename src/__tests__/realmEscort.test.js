// The household guard a realm keeps for its lords and its crown
// (player/realmEscort.js): its men come out of the realm's army and go back
// to it, its arms out of the armoury and back, its pay out of the treasury
// on the crown's 'guard' line into the men's pockets (spent in town), its
// bread out of a town's granary for coin into the town's purse; unpaid it
// shrinks; it leaves with the rank; it fights as the player's own companies;
// a coup weighs it; it saves and loads.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadData, newGame, roundTrip } from './playtest/harness.js';
import { RealmEscort } from '../player/realmEscort.js';
import { Scenarios } from '../player/scenarios.js';
import { Generalship } from '../player/generalship.js';
import { Battlefield } from '../player/battlefield.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { RoadEncounters } from '../player/roadEncounters.js';
import { Throne } from '../systems/throne.js';
import { Titles } from '../systems/titles.js';
import { CrownBooks } from '../world/crownBooks.js';
import { RealmArms } from '../world/realmArms.js';
import { Economy } from '../world/economy.js';
import { WorldUnit } from '../world/units.js';
import { KingdomAI } from '../world/kingdomAI.js';

beforeAll(async () => {
    await loadData();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const _num = v => (Number.isFinite(v) ? v : 0);
const stockSum = k => Object.values(RealmArms.state(k).stock).reduce((s, v) => s + _num(v), 0);

/** A realm of 2+ towns, rich and well manned, the player sworn to it and standing in its capital. */
function sworn(seed = 301) {
    const g = newGame(seed);
    const w = g.world;
    const k = w.kingdoms.find(x => x.isAlive !== false && Economy.realmTowns(x, w).length >= 2);
    k.military = Math.max(_num(k.military), 3000);
    k.treasury = Math.max(_num(k.treasury), 20000);
    g.player.allegiance = k.id;
    g.player.reputation = { ...(g.player.reputation || {}), [k.id]: 50 };
    g.player.q = k.capital.q;
    g.player.r = k.capital.r;
    const s = w.getTile(k.capital.q, k.capital.r).settlement;
    if (!s.economy) Economy.initSettlement(s);
    return { g, w, k, p: g.player, s };
}

/** Make the player a Marshal of the realm (a Lord's office). */
function marshal(p) {
    Titles.initialize(p);
    p.currentTitle = 'marshal';
}

describe('who rates a guard', () => {
    it('none for a plain subject; a lord for a Lord\'s office; great for a Chancellor; the crown for a ruler', () => {
        const { w, k, p } = sworn();
        expect(RealmEscort.standing(p, w)).toBe(null);
        marshal(p);
        expect(RealmEscort.standing(p, w)).toMatchObject({ rank: 'lord' });
        p.currentTitle = 'chancellor';
        expect(RealmEscort.standing(p, w).rank).toBe('great');
        Throne._takeThrone(p, w, k);
        expect(RealmEscort.standing(p, w)).toMatchObject({ rank: 'crown' });
        expect(RealmEscort.standing(p, w).kingdom.id).toBe(k.id);
    });
});

describe('the guard is the realm\'s own men, arms and coin', () => {
    it('a lord is sent a guard out of the realm\'s army, armed from its armoury, paid by the crown', () => {
        const { w, k, p } = sworn();
        marshal(p);
        const mil0 = k.military;
        const arms0 = stockSum(k);
        const army0 = (p.army || []).length;
        const out = RealmEscort.processDay(p, w);
        const g = RealmEscort.guard(p);
        expect(g).toBeTruthy();
        expect(g.rank).toBe('lord');
        expect(out.notices.some(n => /sends/.test(n.text))).toBe(true);
        const units = RealmEscort.units(p, k.id);
        const want = RealmEscort.spec('lord');
        expect(units.length).toBe(Object.values(want).reduce((s, n) => s + n, 0));
        expect(p.army.length).toBe(army0 + units.length);
        const men = RealmEscort.men(p);
        // (the men left the realm's army: nothing minted)
        expect(k.military).toBe(mil0 - men);
        // (their kits left the armoury)
        expect(units.every(u => u.kit && u.kit.main)).toBe(true);
        expect(stockSum(k)).toBeLessThan(arms0);
        // (the player pays them nothing)
        expect(units.every(u => u.upkeep === 0)).toBe(true);
        expect(PlayerMilitary.getUpkeepCost(p)).toBe(0);
    });

    it('wages leave the treasury on the guard line into the men\'s pockets, spent in town', () => {
        const { w, k, p, s } = sworn();
        marshal(p);
        const granary0 = s.economy.food;
        RealmEscort.processDay(p, w);
        const g = RealmEscort.guard(p);
        // Bread came out of the granary (ten days' worth on the first day)
        expect(s.economy.food).toBeLessThan(granary0);
        expect(g.supplies).toBeGreaterThan(0);
        const wage = RealmEscort.wage(p);
        expect(wage).toBeGreaterThan(0);
        const t0 = k.treasury;
        const town0 = s.economy.gold;
        const guard0 = CrownBooks.state(k).day.guard || 0;
        const pockets0 = g.pockets;
        RealmEscort.processDay(p, w);
        const spent = t0 - k.treasury;
        // (wage + the bread bought from the capital's granary)
        expect(spent).toBeGreaterThanOrEqual(wage - 0.01);
        expect((CrownBooks.state(k).day.guard || 0) - guard0).toBeCloseTo(spent, 1);
        // Every coin went somewhere: the town's purse, or the men's pockets
        expect(s.economy.gold - town0 + (g.pockets - pockets0)).toBeCloseTo(spent, 1);
        expect(g.pockets).toBeGreaterThan(0);
        expect(s.economy.gold).toBeGreaterThan(town0);
    });

    it('an empty treasury falls into arrears; past a week the unpaid slip away', () => {
        const { w, k, p } = sworn();
        marshal(p);
        RealmEscort.processDay(p, w);
        const g = RealmEscort.guard(p);
        const men0 = RealmEscort.men(p);
        const mil0 = k.military;
        k.treasury = 0;
        p.q = -99; // (out in the wilds: no town to buy bread from either)
        for (let i = 0; i < 10; i++) { w.day = _num(w.day) + 1; RealmEscort.processDay(p, w); }
        expect(k.treasury).toBe(0);
        const now = RealmEscort.guard(p);
        const left = now ? RealmEscort.men(p) : 0;
        expect(left).toBeLessThan(men0);
        if (now) expect(now.owed).toBeGreaterThan(0);
        expect(g.record.deserted).toBeGreaterThan(0);
        // (deserters do not go back to the army)
        expect(k.military).toBe(mil0);
    });

    it('sent home, the men and their arms go back; what the men carry goes to the capital', () => {
        const { w, k, p } = sworn();
        marshal(p);
        const mil0 = k.military;
        const arms0 = stockSum(k);
        RealmEscort.processDay(p, w);
        const g = RealmEscort.guard(p);
        g.owed = 12;
        g.pockets = 30;
        const cap = w.getTile(k.capital.q, k.capital.r).settlement;
        const capGold = cap.economy.gold;
        const arrears0 = CrownBooks.state(k).arrears.army;
        const r = RealmEscort.sendHome(p, w);
        expect(r.success).toBe(true);
        expect(RealmEscort.guard(p)).toBe(null);
        expect(RealmEscort.units(p).length).toBe(0);
        expect(k.military).toBe(mil0);
        expect(stockSum(k)).toBeCloseTo(arms0, 1);
        expect(cap.economy.gold).toBeCloseTo(capGold + 30, 1);
        expect(CrownBooks.state(k).arrears.army).toBeCloseTo(arrears0 + 12, 1);
        // (not sent again unasked for a while)
        RealmEscort.processDay(p, w);
        expect(RealmEscort.guard(p)).toBe(null);
        // ...but asked for, it comes
        const a = RealmEscort.ask(p, w);
        expect(a.success).toBe(true);
        expect(RealmEscort.guard(p)).toBeTruthy();
    });

    it('leaves with the rank, with an oath sworn elsewhere, with exile', () => {
        const { w, k, p } = sworn();
        marshal(p);
        RealmEscort.processDay(p, w);
        expect(RealmEscort.guard(p)).toBeTruthy();
        p.currentTitle = null;
        const out = RealmEscort.processDay(p, w);
        expect(RealmEscort.guard(p)).toBe(null);
        expect(out.notices.some(n => /no rank/.test(n.text))).toBe(true);
        marshal(p);
        RealmEscort.processDay(p, w);
        const other = w.kingdoms.find(x => x.id !== k.id && x.isAlive !== false);
        p.allegiance = other.id;
        p.currentTitle = null;
        RealmEscort.processDay(p, w);
        expect(RealmEscort.guard(p)).toBe(null);
        expect(RealmEscort.units(p).length).toBe(0);
        marshal(p);
        p.allegiance = k.id;
        RealmEscort.processDay(p, w);
        expect(RealmEscort.guard(p)).toBeTruthy();
        Throne.state(p).exile[k.id] = _num(w.day) + 100;
        RealmEscort.processDay(p, w);
        expect(RealmEscort.guard(p)).toBe(null);
    });

    it('asking for more costs standing and is refused when the treasury is poor', () => {
        const { w, k, p } = sworn();
        marshal(p);
        RealmEscort.processDay(p, w);
        const men0 = RealmEscort.men(p);
        const rep0 = p.reputation[k.id];
        const a = RealmEscort.ask(p, w);
        expect(a.success).toBe(true);
        expect(RealmEscort.men(p)).toBeGreaterThan(men0);
        expect(p.reputation[k.id]).toBeLessThan(rep0);
        RealmEscort.guard(p).lastAsk = -1e9;
        k.treasury = 50;
        const b = RealmEscort.askOdds(p, w);
        expect(b.ok).toBe(false);
        expect(b.reason).toMatch(/treasury/);
    });

    it('a rise to the crown makes it the Royal Guard', () => {
        const { w, k, p } = sworn();
        marshal(p);
        RealmEscort.processDay(p, w);
        const men0 = RealmEscort.men(p);
        Throne._takeThrone(p, w, k);
        RealmEscort.processDay(p, w);
        const g = RealmEscort.guard(p);
        expect(g.rank).toBe('crown');
        expect(RealmEscort.men(p)).toBeGreaterThan(men0);
        expect(RealmEscort.hudLine(p)).toMatch(/Royal Guard of .*: \d+ men, paid by the crown/);
    });
});

describe('the advanced starts\' guards are the escort', () => {
    it('the Monarch\'s royal guard is the realm\'s, and the crown pays it', () => {
        const g = newGame(61);
        g.player.age = 30;
        Scenarios.apply(g.player, g.world, { origin: 'monarch' });
        const p = g.player;
        const k = Throne.ruledKingdom(p, g.world);
        const guard = RealmEscort.guard(p);
        expect(guard.rank).toBe('crown');
        expect(RealmEscort.units(p, k.id).length).toBe(p.army.length);
        expect(PlayerMilitary.getUpkeepCost(p)).toBe(0);
    });

    it('the Great Lord\'s household knights are the realm\'s', () => {
        const g = newGame(62);
        Scenarios.apply(g.player, g.world, { origin: 'great_lord' });
        const p = g.player;
        expect(RealmEscort.guard(p).rank).toBe('great');
        expect(RealmEscort.standing(p, g.world).rank).toBe('great');
    });
});

describe('fights and deters', () => {
    it('stands on the battlefield as its own companies', () => {
        const { w, k, p } = sworn();
        marshal(p);
        p.army.push(PlayerMilitary.makeArmyUnit(PlayerMilitary.getUnitDef('soldier')));
        RealmEscort.processDay(p, w);
        const groups = Battlefield._playerGroups(p);
        expect(groups.some(gr => gr.guard === k.id)).toBe(true);
        expect(groups.some(gr => gr.guard == null)).toBe(true);
        const guardUnits = groups.filter(gr => gr.guard === k.id).flatMap(gr => gr.units);
        expect(guardUnits.every(u => u.realmGuard === k.id)).toBe(true);
    });

    it('its fallen are counted, the realm\'s losses, and the guard ends with its last man', () => {
        const { w, k, p } = sworn();
        marshal(p);
        RealmEscort.processDay(p, w);
        const mil = k.military;
        const n = RealmEscort.units(p).length;
        PlayerMilitary._applyCasualties(p, 'land', 1, { pick: RealmEscort.units(p).slice(-1) });
        RealmEscort.processDay(p, w);
        const g = RealmEscort.guard(p);
        expect(RealmEscort.units(p).length).toBe(n - 1);
        expect(g.record.fallen).toBeGreaterThan(0);
        // (the dead do not come back to the army)
        expect(k.military).toBe(mil);
    });

    it('bands are slower to set on a party in a crown\'s livery, and parley goes better', () => {
        const { w, p } = sworn();
        marshal(p);
        p.gold = 500;
        p.army = [PlayerMilitary.makeArmyUnit(PlayerMilitary.getUnitDef('soldier')), PlayerMilitary.makeArmyUnit(PlayerMilitary.getUnitDef('soldier')), PlayerMilitary.makeArmyUnit(PlayerMilitary.getUnitDef('knight'))];
        const band = { strength: 60, type: 'raider', name: 'Bandits' };
        const before = WorldUnit.pursuitChance(p, band);
        const sitB = RoadEncounters.situation(p, band, w);
        const parB = RoadEncounters.parleyChance(p, band, sitB);
        for (const u of p.army) u.realmGuard = 'x';
        expect(WorldUnit.pursuitChance(p, band)).toBeLessThan(before);
        const sitA = RoadEncounters.situation(p, band, w);
        expect(RoadEncounters.parleyChance(p, band, sitA)).toBeGreaterThan(parB);
    });

    it('a guard loyal enough joins a coup; otherwise it stands with the crown', () => {
        const { w, k, p } = sworn();
        const b = w.kingdoms.find(x => x.id !== k.id && x.isAlive !== false);
        if (!(k.wars || []).includes(b.id)) KingdomAI.startWar(k, b, w);
        marshal(p);
        RealmEscort.processDay(p, w);
        Generalship._grant(p, w, k, { rank: 3, favour: 50, morale: 80 });
        p.q = k.capital.q; p.r = k.capital.r;
        const g = RealmEscort.guard(p);
        g.loyalty = 10;
        const loyal = Generalship.coupOdds(p, w);
        g.loyalty = 90;
        const joins = Generalship.coupOdds(p, w);
        expect(loyal.guard.joins).toBe(false);
        expect(joins.guard.joins).toBe(true);
        expect(joins.rebels).toBeGreaterThan(loyal.rebels);
        expect(joins.loyalists).toBeLessThan(loyal.loyalists);
    });
});

describe('saved', () => {
    it('the guard and its companies survive a save and load', () => {
        const { g, w, p } = sworn();
        marshal(p);
        RealmEscort.processDay(p, w);
        const men = RealmEscort.men(p);
        const kid = RealmEscort.guard(p).kingdomId;
        const back = roundTrip(g);
        const q = back.player;
        expect(RealmEscort.guard(q)).toMatchObject({ kingdomId: kid, rank: 'lord' });
        expect(RealmEscort.men(q)).toBe(men);
        expect(RealmEscort.units(q).every(u => u.upkeep === 0 && u.kit)).toBe(true);
    });
});

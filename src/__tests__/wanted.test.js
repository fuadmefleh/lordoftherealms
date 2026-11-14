// Wanted (systems/wanted.js): each realm's long charge sheet, posters and the
// watch who know your face, bounty hunters on the world map, the orphans of
// those you killed who come of age as avengers, and the ways out — pardon,
// weregild, penance, flight and time.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Wanted, HUNTER_TYPE } from '../systems/wanted.js';
import { Underworld } from '../systems/underworld.js';
import { Gossip } from '../systems/gossip.js';
import { Nemesis } from '../systems/nemesis.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { RoadEncounters } from '../player/roadEncounters.js';
import { SettlementServices } from '../player/settlementServices.js';
import { Utils } from '../core/utils.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

let _game = null;
function game() {
    if (!_game) _game = newGame(5151);
    return _game;
}

/** A fresh slate: no charges, no heat, no gossip, no nemeses. */
function fresh(g) {
    const { player, world } = g;
    player.wanted = null;
    player.underworld = null;
    player.nemesis = null;
    player.jailState = null;
    Gossip.initializePlayer(player);
    player.gossip.bounties = [];
    player.gossip.warrants = {};
    player.reputation = {};
    player.throne = player.throne || {};
    player.throne.ruling = null;
    Underworld.ensure(player);
    Wanted.state(player);
    world.units = (world.units || []).filter(u => u.type !== HUNTER_TYPE);
    return g;
}

function towns(world) {
    return world.getSettlementViews().filter(s => s && s.kingdom != null);
}

/** A realm with a town, the town, and the player stood in it. */
function inTown(g, idx = 0) {
    const s = towns(g.world)[idx];
    g.player.q = s.q;
    g.player.r = s.r;
    return s;
}

function tick(g, days = 1) {
    const out = { notices: [] };
    for (let i = 0; i < days; i++) {
        g.world.day += 1;
        out.notices.push(...Wanted.processDay(g.world, g.player).notices);
    }
    return out;
}

describe('the charge sheet', () => {
    it('a witnessed murder goes on the realm\'s sheet as a grave charge and the posters go up', () => {
        const g = fresh(game());
        const s = inTown(g);
        Underworld.recordCrime(g.player, g.world, 'murder', { kingdom: s.kingdom, caught: true });
        const out = tick(g);
        const rec = Wanted.realm(g.player, s.kingdom);
        expect(rec).toBeTruthy();
        expect(rec.grave).toBeGreaterThan(0);
        expect(rec.charges.murder.grave).toBe(true);
        expect(rec.posted).toBe(true);
        expect(out.notices.some(n => n.title === 'Wanted')).toBe(true);
        expect(Wanted.posterAt(g.player, g.world, s).charges).toMatch(/murder/);
        // The heat read in is cleared, not read twice
        expect(g.player.underworld.charges.length).toBe(0);
        const before = Wanted.bounty(g.player, s.kingdom);
        tick(g);
        expect(Wanted.bounty(g.player, s.kingdom)).toBeGreaterThanOrEqual(before);
    }, 120000);

    it('rumour bounties from witnessed crimes are read in once', () => {
        const g = fresh(game());
        const s = inTown(g);
        g.player.gossip.bounties.push({ rumorId: 'r1', kingdom: s.kingdom, gold: 200, issuedDay: g.world.day, description: 'murder' });
        tick(g, 3);
        const rec = Wanted.realm(g.player, s.kingdom);
        expect(rec.grave).toBeGreaterThan(100);
        expect(rec.graveN).toBe(1);
    });

    it('the price grows while you are at large, and lesser charges fade in time (faster abroad)', () => {
        const g = fresh(game());
        const s = inTown(g);
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'theft', gold: 100 });
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'murder', grave: true, gold: 200 });
        tick(g);
        const rec = Wanted.realm(g.player, s.kingdom);
        const grave0 = rec.grave;
        // Abroad: somewhere that is not this realm
        const other = towns(g.world).find(t => String(t.kingdom) !== String(s.kingdom));
        g.player.q = other.q;
        g.player.r = other.r;
        tick(g, Wanted.config().fade.afterDays + 400);
        expect(rec.lesser).toBe(0);
        expect(rec.charges.theft).toBeUndefined();
        expect(rec.grave).toBeGreaterThan(grave0);
        expect(rec.grave).toBeLessThanOrEqual(Wanted.config().growth.graveCap);
    });

    it('answering to the guards clears the lesser charges, not a killing; the guard tower bills the lesser part', () => {
        const g = fresh(game());
        const s = inTown(g);
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'theft', gold: 90 });
        expect(SettlementServices.bountyOwed(g.player, s)).toBe(90);
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'murder', grave: true, gold: 300 });
        Gossip.settleWithKingdom(g.player, s.kingdom);
        const rec = Wanted.realm(g.player, s.kingdom);
        expect(rec.lesser).toBe(0);
        expect(rec.grave).toBe(300);
        expect(rec.charges.theft).toBeUndefined();
    });

    it('a ruler is above the law of their own realm', () => {
        const g = fresh(game());
        const s = inTown(g);
        g.player.throne.ruling = { kingdomId: s.kingdom };
        expect(Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'murder', grave: true, gold: 300 })).toBeNull();
        g.player.throne.ruling = null;
    });
});

describe('the watch', () => {
    it('the watch know your face from the posters and take you past arrestFrom', () => {
        const g = fresh(game());
        const s = inTown(g);
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'murder', grave: true, gold: 400 });
        tick(g);
        expect(Wanted.recogniseChance(g.player, g.world, s)).toBeGreaterThan(0.2);
        const tile = g.world.getTile(s.q, s.r);
        const notes = Utils.withRng(() => 0, () => Wanted.onEnterSettlement(g.player, g.world, tile));
        expect(notes[0].title).toBe('Known by the Watch');
        expect(g.player.jailState).toBeTruthy();
        expect(g.player.jailState.daysRemaining).toBeGreaterThan(2);
        expect(Wanted.realm(g.player, s.kingdom)).toBeNull();
        g.player.jailState = null;
    });

    it('not wanted, not known', () => {
        const g = fresh(game());
        const s = inTown(g);
        const notes = Utils.withRng(() => 0, () => Wanted.onEnterSettlement(g.player, g.world, g.world.getTile(s.q, s.r)));
        expect(notes).toEqual([]);
    });
});

describe('bounty hunters', () => {
    function hunted(g) {
        const s = inTown(g);
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'murder', grave: true, gold: 600 });
        tick(g);
        const h = Wanted.startHunt(g.player, g.world, s.kingdom);
        return { s, h, unit: Wanted.hunterUnit(g.player, g.world) };
    }

    it('a party rides out on the notice, scaled by the bounty, and closes on the player', () => {
        const g = fresh(game());
        const { s, h, unit } = hunted(g);
        expect(h).toBeTruthy();
        expect(unit.type).toBe(HUNTER_TYPE);
        expect(unit.hostile).toBe(true);
        expect(unit.strength).toBeGreaterThanOrEqual(Wanted.config().hunters.strengthBase + 10);
        // Step away from the town: they follow
        const far = towns(g.world).filter(t => String(t.kingdom) === String(s.kingdom)).find(t => t !== s) || s;
        g.player.q = far.q; g.player.r = far.r;
        unit.q = s.q; unit.r = s.r;
        const d0 = Math.abs(unit.q - g.player.q) + Math.abs(unit.r - g.player.r);
        tick(g, 3);
        const d1 = Math.abs(unit.q - g.player.q) + Math.abs(unit.r - g.player.r);
        if (far !== s) expect(d1).toBeLessThan(d0);
    });

    it('the road encounter: no toll, but a bribe and surrender; paid off they ride away', () => {
        const g = fresh(game());
        const { s, unit } = hunted(g);
        g.player.gold = 5000;
        const opts = RoadEncounters.options(g.player, unit, g.world);
        expect(opts.some(o => o.id === 'toll')).toBe(false);
        expect(opts.some(o => o.id === 'payoff')).toBe(true);
        expect(opts.some(o => o.id === 'surrender')).toBe(true);
        const res = RoadEncounters.resolve(g.player, unit, g.world, 'payoff');
        expect(res.kind).toBe('paid');
        expect(unit.destroyed).toBe(true);
        expect(Wanted.state(g.player).hunt).toBeNull();
        expect(Wanted.bounty(g.player, s.kingdom)).toBeGreaterThan(0);
    });

    it('surrender: delivered to the realm\'s cells, the charges answered, the crown pays the hunters', () => {
        const g = fresh(game());
        const { s, unit } = hunted(g);
        const k = g.world.getKingdom(s.kingdom);
        k.treasury = 10000;
        const res = RoadEncounters.resolve(g.player, unit, g.world, 'surrender');
        expect(res.kind).toBe('surrendered');
        expect(g.player.jailState).toBeTruthy();
        expect(Wanted.realm(g.player, s.kingdom)).toBeNull();
        expect(k.treasury).toBeLessThan(10000);
        expect(unit.inventory.gold).toBeGreaterThan(0);
        g.player.jailState = null;
    });

    it('run down (a lost fight, a failed flight): taken in irons, not robbed', () => {
        const g = fresh(game());
        const { unit } = hunted(g);
        const res = RoadEncounters._caught(g.player, unit, g.world, 'They ran you down.');
        expect(res.kind).toBe('taken');
        expect(g.player.jailState).toBeTruthy();
        g.player.jailState = null;
    });

    it('beaten, they add the slaying to your sheet', () => {
        const g = fresh(game());
        const { s, unit } = hunted(g);
        const before = Wanted.bounty(g.player, s.kingdom);
        unit.destroyed = true;
        const out = tick(g);
        expect(out.notices.some(n => n.title === 'Hunters Broken')).toBe(true);
        expect(Wanted.bounty(g.player, s.kingdom)).toBeGreaterThan(before);
        expect(Wanted.realm(g.player, s.kingdom).huntersBeaten).toBe(1);
    });

    it('a realm at war with theirs is a refuge', () => {
        const g = fresh(game());
        const { s } = hunted(g);
        const theirs = g.world.getKingdom(s.kingdom);
        const other = towns(g.world).find(t => String(t.kingdom) !== String(s.kingdom));
        theirs.wars = [...(theirs.wars || []), other.kingdom];
        g.player.q = other.q; g.player.r = other.r;
        tick(g);
        expect(Wanted.state(g.player).hunt).toBeNull();
        theirs.wars = theirs.wars.filter(w => w !== other.kingdom);
    });
});

describe('the ways out', () => {
    it('a pardon: granted by a crown that favours you, bought in one of its towns otherwise', () => {
        const g = fresh(game());
        const s = inTown(g);
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'murder', grave: true, gold: 200 });
        g.player.reputation[s.kingdom] = 80;
        expect(Wanted.pardonQuote(g.player, g.world, s.kingdom).kind).toBe('grant');
        g.player.reputation[s.kingdom] = 0;
        g.player.gold = 5000;
        const q = Wanted.pardonQuote(g.player, g.world, s.kingdom);
        expect(q.ok).toBe(true);
        expect(q.cost).toBeGreaterThanOrEqual(300);
        const k = g.world.getKingdom(s.kingdom);
        const t0 = k.treasury || 0;
        const res = Wanted.pardon(g.player, g.world, s.kingdom);
        expect(res.success).toBe(true);
        expect(g.player.gold).toBe(5000 - q.cost);
        expect(k.treasury).toBe(t0 + q.cost);
        expect(Wanted.realm(g.player, s.kingdom)).toBeNull();
        // Hated, the crown sells no mercy
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'theft', gold: 100 });
        g.player.reputation[s.kingdom] = -80;
        expect(Wanted.pardonQuote(g.player, g.world, s.kingdom).ok).toBe(false);
    });

    it('penance at a church: alms to the town, charges eased, once a season', () => {
        const g = fresh(game());
        const s = inTown(g);
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'theft', gold: 200 });
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'murder', grave: true, gold: 200 });
        g.player.gold = 1000;
        const res = Wanted.penance(g.player, g.world);
        expect(res.success).toBe(true);
        const rec = Wanted.realm(g.player, s.kingdom);
        expect(rec.lesser).toBeCloseTo(80, 0);
        expect(rec.grave).toBeCloseTo(170, 0);
        expect(Wanted.penance(g.player, g.world).success).toBe(false);
    });

    it('a new head on the seat: the crowns\' charges die with the old one', () => {
        const g = fresh(game());
        const s = inTown(g);
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'murder', grave: true, gold: 500 });
        tick(g);
        g.player.house.generation = (g.player.house.generation || 1) + 1;
        const out = tick(g);
        expect(Wanted.realm(g.player, s.kingdom)).toBeNull();
        expect(out.notices.some(n => n.title === 'Old Charges Lapse')).toBe(true);
    });
});

describe('blood debts and avengers', () => {
    /** A townsman the player killed, and his young son, in a town of the world. */
    function orphan(g) {
        const s = inTown(g, 1);
        const Y = Wanted.config().daysPerYear;
        const day = g.world.day;
        const father = { id: 9001, first: 'Hob', last: 'Miller', gender: 'male', born: day - 35 * Y, parents: [], kids: [9002], died: day };
        const son = { id: 9002, first: 'Wat', last: 'Miller', gender: 'male', born: day - 6 * Y, parents: [9001], kids: [], nm: [] };
        s.folk = { q: s.q, r: s.r, people: [father, son], nm: [] };
        NpcMemory.rememberKin(g.world, { folk: s.folk, person: father }, { kind: 'murdered', player: g.player });
        return { s, father, son };
    }

    it('the son of a man you killed is noted, grows up, and swears vengeance through the nemesis layer', () => {
        const g = fresh(game());
        const { son } = orphan(g);
        expect(son.nm.length).toBe(1);
        Wanted.state(g.player).lastScanDay = -1e9;
        tick(g);
        const debts = Wanted.openDebts(g.player, g.world);
        expect(debts.length).toBe(1);
        expect(debts[0].debt.victim).toMatch(/Hob/);
        expect(debts[0].years).toBe(10);
        // Ten years on
        g.world.day = debts[0].debt.comeOfAgeDay - 1;
        const out = tick(g);
        expect(out.notices.some(n => n.title === 'An Avenger Comes of Age')).toBe(true);
        const grudge = Nemesis.state(g.player).grudges.find(x => x.ref && x.ref.folkRef && x.ref.folkRef.endsWith('#9002'));
        expect(grudge).toBeTruthy();
        expect(grudge.kind).toBe('blood');
        expect(grudge.age).toBe(16);
        expect(Wanted.openDebts(g.player, g.world).length).toBe(0);
    });

    it('weregild paid to the family cancels the debt, fills their purse and softens the memory', () => {
        const g = fresh(game());
        const { s, son } = orphan(g);
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'murder', grave: true, gold: 300 });
        Wanted.state(g.player).lastScanDay = -1e9;
        tick(g);
        const [d] = Wanted.openDebts(g.player, g.world);
        g.player.gold = 2000;
        const w0 = son.nm.find(e => e.k === 'murdered').w;
        const res = Wanted.weregild(g.player, g.world, d.debt.id);
        expect(res.success).toBe(true);
        expect(son.purse).toBeGreaterThanOrEqual(d.cost);
        expect(Math.abs(son.nm.find(e => e.k === 'murdered').w)).toBeLessThan(Math.abs(w0));
        expect(Wanted.openDebts(g.player, g.world).length).toBe(0);
        expect(Wanted.realm(g.player, s.kingdom).grave).toBe(0);
        // Grown, nothing rises
        g.world.day = d.debt.comeOfAgeDay + 1;
        tick(g);
        expect(Nemesis.state(g.player).grudges.some(x => x.ref && x.ref.folkRef && x.ref.folkRef.endsWith('#9002'))).toBe(false);
    });
});

describe('save', () => {
    it('round-trips through serialize / loadState', () => {
        const g = fresh(game());
        const s = inTown(g);
        Wanted.charge(g.player, g.world, { kingdomId: s.kingdom, crime: 'murder', grave: true, gold: 250 });
        const saved = Wanted.serialize(g.player);
        const p2 = { wanted: JSON.parse(JSON.stringify(saved)) };
        Wanted.loadState(p2);
        expect(Wanted.bounty(p2, s.kingdom)).toBe(250);
        const p3 = {};
        Wanted.loadState(p3);
        expect(p3.wanted.realms).toEqual({});
    });
});

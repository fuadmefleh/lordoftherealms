// The very brutal, part two: flaying (systems/flaying.js: the scaffold's 'flay', the skin on
// the gate or the judge's chair, the stewards' dread, the crown's corruption cut, the cruel
// realms), walling up alive (systems/immurement.js: the deed unseen, the servants' talk, the
// haunting and what it does to a house, the priest's rite and the broken wall, the realms),
// decimation (player/decimation.js: the broken companies, the lot, steel and hatred, deserters,
// a host, the realms' own) and eating the dead in a siege (systems/eatingTheDead.js: the AI
// garrison, your holding's — ordered, forbidden or the governor's — and the town's name).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Executions } from '../systems/executions.js';
import { Gibbets } from '../systems/gibbets.js';
import { DeadDisplays } from '../world/deadDisplays.js';
import { Flaying } from '../systems/flaying.js';
import { Immurement } from '../systems/immurement.js';
import { EatingTheDead } from '../systems/eatingTheDead.js';
import { Decimation } from '../player/decimation.js';
import { Atrocities } from '../systems/atrocities.js';
import { CrownBooks } from '../world/crownBooks.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Relationships } from '../systems/relationships.js';
import { TownMarks } from '../world/townMarks.js';

beforeAll(async () => { await loadData(); }, 120000);
beforeEach(() => { Utils.setSeed(4242); });

const P = (id, first, gender, o = {}) => ({ id, first, last: 'Cole', gender, born: -40 * 360, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [], purse: 20, ...o });

function makeWorld({ day = 700 } = {}) {
    const hal = P(0, 'Hal', 'male', { spouse: 1, kids: [2] });
    const meg = P(1, 'Meg', 'female', { spouse: 0, kids: [2] });
    const rob = P(2, 'Rob', 'male', { parents: [0, 1], born: -20 * 360 });
    const folk = { q: 3, r: 4, n: 3, people: [hal, meg, rob], annals: [] };
    const kingdom = { id: 1, name: 'Varn', isAlive: true, treasury: 5000, stability: 60, military: 1000, culture: 'Imperial', laws: {}, capital: { q: 3, r: 4 }, lord: { name: 'King Odo', memory: [], traits: [{ id: 'just' }] }, religion: { faithId: 'old_gods' } };
    const town = { name: 'Ashford', q: 3, r: 4, kingdom: 1, folk, economy: { gold: 2000 }, type: 'town', population: 900, happiness: 60 };
    const other = { id: 2, name: 'Oster', isAlive: true, treasury: 3000, stability: 55, military: 800, culture: 'Imperial', laws: {}, capital: { q: 8, r: 8 }, lord: { name: 'King Ulf', memory: [], traits: [{ id: 'cruel' }] }, religion: { faithId: 'old_gods' } };
    const otown = { name: 'Osterburg', q: 8, r: 8, kingdom: 2, folk: { q: 8, r: 8, n: 1, people: [P(10, 'Wat', 'male')], annals: [] }, economy: { gold: 1500 }, type: 'city', population: 4000, happiness: 50 };
    const tiles = { '3,4': town, '8,8': otown };
    const world = {
        day, generationParams: { seed: 7 }, kingdoms: [kingdom, other], events: [], width: 40, height: 40,
        getTile: (q, r) => (tiles[`${q},${r}`] ? { q, r, settlement: tiles[`${q},${r}`], explored: true } : null),
        getSettlementViews: () => [town, otown],
        getKingdom: (id) => (String(id) === '1' ? kingdom : String(id) === '2' ? other : null),
    };
    return { world, folk, town, kingdom, other, otown, hal, meg, rob };
}

function makePlayer(o = {}) {
    return {
        name: 'Aldric Voss', firstName: 'Aldric', gender: 'male', gold: 2000, karma: 0, renown: 0, reputation: { 1: 20 }, q: 3, r: 4,
        strength: 8, charisma: 7, intelligence: 6, faith: 5, luck: 5,
        skills: { combat: 8, commerce: 5, leadership: 6, diplomacy: 7, stealth: 5 },
        inventory: {}, children: [], army: [],
        house: { name: 'House Voss', generation: 1, prestige: 100, history: [], rivals: {} },
        throne: { ruling: { kingdomId: 1 } }, ...o,
    };
}

// Pin config values for one test, put back after
const pinned = [];
function pin(obj, o) {
    pinned.push([obj, JSON.parse(JSON.stringify(Object.fromEntries(Object.keys(o).map(k => [k, obj[k]]))))]);
    Object.assign(obj, o);
}
afterEach(() => { while (pinned.length) { const [obj, old] = pinned.pop(); Object.assign(obj, old); } });

function calm() {
    const C = Executions.config();
    pin(C, { disruption: { ...C.disruption, rescue: { ...C.disruption.rescue, max: 0, base: 0, perKin: 0, perPopularity: 0, house: 0, band: 0, angry: 0 }, riot: {}, rope: { chance: 0 } } });
}

/** Flay Hal on the scaffold for `crime`; his body comes into your hands. */
function flayHal(world, p, crime = 'treason') {
    calm();
    const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 0 }, { crime, guilty: true, quiet: true });
    const m = Executions.methods(p, world, e, { kingdomId: 1 }).find(x => x.id === 'flay');
    expect(m.ok).toBe(true);
    const r = Executions.carryOut(p, world, e.id, 'flay', '3,4', { proclaimed: false, present: true });
    expect(r.outcome).toBe('executed');
    const bodies = Gibbets.collect(p, world);
    expect(bodies).toHaveLength(1);
    return bodies[0];
}

describe('Flaying — the skin, the chair, the stewards\' dread', () => {
    it('flaying is for treason and corruption only; the flayed body leaves a skin to hang', () => {
        const { world } = makeWorld();
        const p = makePlayer();
        calm();
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 2 }, { crime: 'theft', guilty: true, quiet: true });
        const m = Executions.methods(p, world, e, { kingdomId: 1 }).find(x => x.id === 'flay');
        expect(m.ok).toBe(false);
        expect(m.why).toMatch(/treason or an official's corruption/);
        Executions._drop(p, e);
        const b = flayHal(world, p);
        expect(b.flayed).toBe(true);
        const opts = Object.fromEntries(Gibbets.displayOptions(p, world, b).map(o => [o.id, o]));
        expect(opts.skin.ok && opts.chair.ok).toBe(true);
        expect(Flaying.state(p).stats.flayed).toBe(1);
        expect(Flaying.state(p).stats.traitors).toBe(1);
        // A body not flayed has no skin to hang
        const plain = Gibbets.offerBody(p, world, { name: 'Ned Hay', key: 'plain' });
        const po = Object.fromEntries(Gibbets.displayOptions(p, world, plain).map(o => [o.id, o]));
        expect(po.skin.ok).toBe(false);
        expect(po.spike.ok).toBe(true);
    });

    it('an official flayed for corruption cuts the crown\'s corruption and frightens every steward', () => {
        const { world, kingdom } = makeWorld();
        const p = makePlayer();
        CrownBooks.state(kingdom).corruption = 0.4;
        expect(Flaying.stewardDread(p, world)).toBe(0);
        flayHal(world, p, 'corruption');
        expect(CrownBooks.state(kingdom).corruption).toBeCloseTo(0.4 * (1 - Flaying.config().corruptionCut), 3);
        // The fresh terror, then fading over its days
        const fresh = Flaying.stewardDread(p, world);
        expect(fresh).toBeGreaterThan(0.2);
        world.day += Flaying.config().fresh.days + 1;
        expect(Flaying.stewardDread(p, world)).toBe(0);
    });

    it('a skin over the judge\'s chair keeps the stewards afraid for decades; it stays indoors', () => {
        const { world, town } = makeWorld();
        const p = makePlayer();
        const b = flayHal(world, p, 'corruption');
        world.day += 1000; // (the fresh terror has passed)
        const r = Gibbets.display(p, world, b.id, 'chair', '3,4');
        expect(r.success).toBe(true);
        const d = town.displays.find(x => x.kind === 'chair');
        expect(d.lasts).toBe(Gibbets.kind('chair').lasts);
        expect(d.flayed).toBe(true);
        // Not laid on the street map
        expect(DeadDisplays.propOf(d, world.day)).toBe(null);
        expect(DeadDisplays.stamp(town, world.day)).toBe('');
        const chairDread = Flaying.stewardDread(p, world);
        expect(chairDread).toBeGreaterThanOrEqual(Flaying.config().chair.dread * 0.99);
        expect(Flaying.state(p).stats.chairs).toBe(1);
        // Five years on, darkened; twenty years on it still stands, cracked and old
        world.day += 5 * 120;
        expect(DeadDisplays.stage(d, world.day).label).toBe('darkened with years');
        world.day += 15 * 120;
        expect(DeadDisplays.stage(d, world.day)).not.toBe(null);
        expect(DeadDisplays.stage(d, world.day).label).toBe('cracked and old');
        expect(Flaying.stewardDread(p, world)).toBeGreaterThan(0);
    });

    it('a skin on the gate stands on the street map, raw then dried to leather', () => {
        const { world, town } = makeWorld();
        const p = makePlayer();
        const b = flayHal(world, p);
        Gibbets.display(p, world, b.id, 'skin', '3,4');
        const d = town.displays.find(x => x.kind === 'skin');
        expect(DeadDisplays.propOf(d, world.day)).toBe('gb_skin_fresh');
        expect(DeadDisplays.stage(d, world.day).label).toBe('raw');
        expect(DeadDisplays.propOf(d, world.day + 200)).toBe('gb_skin_rotting');
        expect(DeadDisplays.stamp(town, world.day)).toMatch(/dd:/);
        const gate = Flaying.stewardDread(p, world);
        expect(gate).toBeGreaterThan(0);
        expect(gate).toBeLessThan(Flaying.config().chair.dread);
    });

    it('a steward sent to the scaffold dies on it (Stewards.onExecuted)', async () => {
        const { Stewards } = await import('../systems/stewards.js');
        const { world } = makeWorld();
        const p = makePlayer();
        const npc = { id: 'npc_st', firstName: 'Osric', gender: 'male', isAlive: true };
        Relationships._npcs = [npc];
        calm();
        const e = Executions.condemn(p, world, { kind: 'other', id: 'steward:npc_st', name: 'Osric Pell', q: 3, r: 4, kingdomId: 1 }, { crime: 'corruption', source: 'steward', ref: 'npc_st', guilty: true, quiet: true });
        e.ref.npcId = 'npc_st';
        const r = Executions.carryOut(p, world, e.id, 'flay', '3,4', { proclaimed: false, present: true });
        expect(r.outcome).toBe('executed');
        expect(npc.isAlive).toBe(false);
        expect(npc.deathCause).toBe('flaying');
        expect(typeof Stewards._toScaffold).toBe('function');
        Relationships._npcs = [];
    });

    it('a cruel crown flays now and then: the skin by its capital\'s gate, its books cut', () => {
        const { world, other, otown } = makeWorld({ day: 707 });
        CrownBooks.state(other).corruption = 0.3;
        pin(Flaying.config().ai, { chance: 1 });
        Flaying.processDay(world, null);
        expect((otown.displays || []).some(d => d.kind === 'skin' && d.by.kind === 'realm')).toBe(true);
        expect(CrownBooks.state(other).corruption).toBeLessThan(0.3);
        expect(world.events.some(e => /flayed/.test(e.text))).toBe(true);
        // The just king of Varn does not
        expect(makeWorld().town.displays).toBeUndefined();
    });
});

describe('Walling up alive — unseen, then the servants talk; the house haunted', () => {
    it('only traitors, heretics and the disgraced; you must stand in your seat', () => {
        const { world } = makeWorld();
        const p = makePlayer();
        Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 2 }, { crime: 'murder', guilty: true, quiet: true });
        const her = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 1 }, { crime: 'heresy', guilty: true, quiet: true });
        const t = Immurement.targets(p, world);
        expect(t.map(x => x.id)).toEqual([her.id]);
        const away = makePlayer({ q: 0, r: 0 });
        away.executions = p.executions;
        expect(Immurement.wallUp(away, world, 'condemned', her.id).success).toBe(false);
    });

    it('the victim vanishes, the deed is secret, the house is haunted and its servants and guests feel it', () => {
        const { world, town, meg } = makeWorld();
        const p = makePlayer();
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 1 }, { crime: 'heresy', guilty: true, quiet: true });
        const r = Immurement.wallUp(p, world, 'condemned', e.id, '3,4');
        expect(r.success).toBe(true);
        expect(meg.died).not.toBe(null);
        expect(Executions.list(p)).toHaveLength(0);
        expect(p.karma).toBeLessThan(0);
        // Secret: no butcher's name yet
        expect(Atrocities.butcher(p)).toBe(0);
        expect(Immurement.state(p).secrets[0].revealed).toBe(false);
        expect(Immurement.ghosts(town)).toHaveLength(1);
        expect(Immurement.servantDread(town)).toBeLessThan(0);
        expect(Immurement.guestArrival(town)).toBeLessThan(1);
        // (the scaffold's history keeps it as walled up, and gives no body)
        expect(Gibbets.collect(p, world)).toHaveLength(0);
    });

    it('the servants talk: the whole weight falls then', () => {
        const { world } = makeWorld({ day: 700 });
        const p = makePlayer();
        const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 0 }, { crime: 'treason', guilty: true, quiet: true });
        Immurement.wallUp(p, world, 'condemned', e.id, '3,4');
        pin(Immurement.config().reveal, { perWeek: 1, max: 1 });
        world.day = 728; // (four weeks on: past afterDays, a week's turn)
        const out = Immurement.processDay(world, p);
        expect(Immurement.state(p).secrets[0].revealed).toBe(true);
        expect(out.notices.some(n => n.title === 'The Servants Talk')).toBe(true);
        expect(Atrocities.butcher(p)).toBeGreaterThan(0);
        expect((p.gossip && p.gossip.rumors || []).some(r => r.type === 'immured')).toBe(true);
    });

    it('a disgraced spouse simply vanishes', () => {
        const { world, town } = makeWorld();
        const wife = { id: 'npc_wife', firstName: 'Isolde', lastName: 'Voss', gender: 'female', isAlive: true };
        Relationships._npcs = [wife];
        const p = makePlayer({ spouse: 'npc_wife', marriageDay: 10 });
        const t = Immurement.targets(p, world).find(x => x.kind === 'spouse');
        expect(t).toBeTruthy();
        const r = Immurement.wallUp(p, world, 'spouse', 'npc_wife', '3,4');
        expect(r.success).toBe(true);
        expect(wife.isAlive).toBe(false);
        expect(p.spouse).toBe(null);
        // An innocent haunts the harder
        expect(Immurement.ghosts(town)[0].strength).toBeGreaterThan(Immurement.config().haunt.start);
        Relationships._npcs = [];
    });

    it('the haunting fades over generations; a rite quiets it, a broken wall ends it and tells the town', () => {
        const { world, town } = makeWorld({ day: 7 });
        const p = makePlayer();
        const h = Immurement.haunt(world, town, { name: 'Ser Grey', by: { kind: 'realm', name: 'a lord long dead' }, known: true });
        const s0 = h.strength;
        // A generation on (30 years of weeks) it still walks, weaker
        for (let w = 1; w <= 30 * 120 / 7; w++) { world.day = 7 * (w + 1); Immurement._hauntWeek(world, null, world.day, { notices: [] }); }
        expect(h.strength).toBeLessThan(s0);
        expect(Immurement.ghosts(town)).toHaveLength(1);
        const gold = p.gold;
        const purse = town.economy.gold;
        const lay = Immurement.layGhost(p, world, h.id);
        expect(lay.success).toBe(true);
        expect(p.gold).toBeLessThan(gold);
        expect(town.economy.gold).toBeGreaterThan(purse);
        expect(Immurement.layGhost(p, world, h.id).success).toBe(false); // (not so soon again)
        const br = Immurement.breakWall(p, world, h.id);
        expect(br.success).toBe(true);
        expect(Immurement.ghosts(town)).toHaveLength(0);
    });

    it('a guest in a haunted house may leave unsettled (hash roll, fixed for the guest and day)', () => {
        const { world, town } = makeWorld();
        Immurement.haunt(world, town, { name: 'X', by: { kind: 'realm', name: 'y' } });
        Immurement.haunt(world, town, { name: 'Z', by: { kind: 'realm', name: 'y' } });
        let n = 0;
        for (let i = 0; i < 200; i++) if (Immurement.unsettles(world, town, `g${i}`)) n++;
        expect(n).toBeGreaterThan(60);
        expect(Immurement.unsettles(world, town, 'g1')).toBe(Immurement.unsettles(world, town, 'g1'));
        expect(Immurement.unsettles(world, makeWorld().town, 'g1')).toBe(false);
    });

    it('a cruel crown walls up its traitors; the talk comes out later as news', () => {
        const { world, otown } = makeWorld({ day: 707 });
        pin(Immurement.config().ai, { chance: 1, reveal: 1 });
        Immurement.processDay(world, null);
        expect(Immurement.ghosts(otown)).toHaveLength(1);
        world.day = 707 + 21;
        Immurement.processDay(world, null);
        expect(world.events.some(e => /walled/.test(e.text))).toBe(true);
        const saved = Immurement.serialize(world);
        const w2 = { ...world, immurement: null };
        Immurement.restore(saved, w2);
        expect(w2.immurement.towns).toEqual(world.immurement.towns);
    });
});

function soldiers(n) {
    return Array.from({ length: n }, (_, i) => ({ type: 'pikeman', name: `Pikemen ${i + 1}`, strength: 10, upkeep: 1, experience: 0, level: 1, kit: { main: 'iron_spear', body: 'gambeson' } }));
}

describe('Decimation — the lot, steel and hatred', () => {
    it('a rout leaves the companies on your word; the lot kills a tenth, their kit stripped back', () => {
        const { world } = makeWorld();
        const p = makePlayer({ army: soldiers(12) });
        const b = Decimation.noteBroken(p, world, { kind: 'army', foe: 'the host of Oster' });
        expect(b).toBeTruthy();
        expect(Decimation.noteBroken(p, world, { kind: 'army', foe: 'again' })).toBe(null); // (one shame a day)
        expect(Decimation.toll(p, b)).toBe(1);
        const r = Decimation.decimate(p, world, b.id);
        expect(r.success).toBe(true);
        expect(p.army).toHaveLength(11);
        expect(p.inventory.iron_spear).toBe(1);
        expect(Decimation.breakMult(p)).toBeLessThan(1);
        expect(Decimation.state(p).hate).toBeGreaterThan(0);
        expect(Atrocities.butcher(p)).toBeGreaterThan(0);
        expect(Decimation.pending(p, world)).toHaveLength(0);
    });

    it('a decimated army breaks less (the morale-break chance x breakMult)', () => {
        let broke = 0, held = 0;
        Utils.setSeed(1);
        for (let i = 0; i < 200; i++) if (PlayerMilitary._checkMoraleBreak(100, 300, 0.6)) broke++;
        Utils.setSeed(1);
        for (let i = 0; i < 200; i++) if (PlayerMilitary._checkMoraleBreak(100, 300, 0.6, 0.4)) held++;
        expect(held).toBeLessThan(broke * 0.7);
    });

    it('the hatred makes deserters; the window closes; letting it go spares them', () => {
        const { world } = makeWorld({ day: 700 });
        const p = makePlayer({ army: soldiers(10) });
        Decimation.decimate(p, world, Decimation.noteBroken(p, world, { foe: 'x' }).id);
        pin(Decimation.config().hate, { desertPerWeek: 50 });
        world.day = 707;
        const out = Decimation.processDay(world, p);
        expect(p.army).toHaveLength(8);
        expect(out.notices.some(n => n.title === 'Deserters')).toBe(true);
        const b = Decimation.noteBroken(p, world, { foe: 'y' });
        expect(Decimation.spare(p, world, b.id).success).toBe(true);
        Decimation.noteBroken(p, world, { foe: 'z' });
        world.day += Decimation.config().windowDays + 1;
        expect(Decimation.pending(p, world)).toHaveLength(0);
    });

    it('a beaten host: a tenth of its men, lost to its realm; the lieutenants hate it; the host stands', () => {
        const { world, kingdom } = makeWorld();
        const p = makePlayer({ commission: { kingdomId: 1, men: 200, morale: 40, lieutenants: [{ name: 'Ser Kay', loyalty: 50 }] } });
        const b = Decimation.noteBroken(p, world, { kind: 'host', foe: 'Oster' });
        const mil = kingdom.military;
        expect(Decimation.decimate(p, world, b.id).success).toBe(true);
        expect(p.commission.men).toBe(180);
        expect(kingdom.military).toBe(mil - 20);
        expect(p.commission.lieutenants[0].loyalty).toBeLessThan(50);
        expect(Decimation.hostMorale(p)).toBeGreaterThan(0);
    });

    it('a realm\'s broken lines: its cruel lord decimates them, and they break less', () => {
        const { world, other } = makeWorld();
        world.routFeed = [{ day: 700, kingdomId: 2, foe: 1 }];
        pin(Decimation.config().ai, { chance: 1 });
        const mil = other.military;
        Decimation.processDay(world, null);
        expect(other.military).toBeLessThan(mil);
        expect(other.decimation.until).toBeGreaterThan(world.day);
        expect(KingdomAI._breakMult(other, world)).toBeLessThan(1);
        expect(world.routFeed).toHaveLength(0);
    });
});

function siegeOf(o = {}) {
    return { q: 3, r: 4, name: 'Ashford', kingdomId: 1, kingdomName: 'Varn', garrison: 60, garrisonStart: 140, stores: 0, storesStart: 20, morale: 40, townSick: false, ...o };
}

describe('Eating the dead — a starving garrison holds on', () => {
    it('not before the stores are gone and they have starved some days', () => {
        const { town } = makeWorld();
        const s = siegeOf({ stores: 4 });
        expect(EatingTheDead.canEat(s, town).ok).toBe(false);
        s.stores = 0;
        EatingTheDead._count(s, town);
        expect(EatingTheDead.canEat(s, town).why).toMatch(/starved only/);
        EatingTheDead._count(s, town); EatingTheDead._count(s, town);
        expect(EatingTheDead.canEat(s, town).ok).toBe(true);
    });

    it('the AI garrison you besiege eats its dead: weeks more, and the town\'s name is never the same', () => {
        const { world, town, kingdom } = makeWorld();
        pin(EatingTheDead.config().ai, { chance: 1 });
        const s = siegeOf();
        const stab = kingdom.stability;
        let res = null;
        for (let i = 0; i < 12 && !res; i++) { world.day++; res = EatingTheDead.siegeDay(world, s, town, { kingdomId: 1 }); }
        expect(res).toBeTruthy();
        expect(s.stores).toBeGreaterThanOrEqual(EatingTheDead.config().base);
        expect(town.ateDead.epithet).toBeTruthy();
        expect(EatingTheDead.nameOf(town)).toBe(`Ashford ${town.ateDead.epithet}`);
        expect(kingdom.stability).toBeLessThan(stab);
        expect(town.folk.people.every(p => p.ateDead != null)).toBe(true);
        expect(TownMarks.memory(town).marks.some(m => m.k === 'atrocity' && m.what === 'ateDead')).toBe(true);
        // A second time gives less; never a third
        const first = res.days;
        s.stores = 0; s.dead.starvedDays = 5;
        const second = EatingTheDead.eat(world, s, town, { kind: 'ai', kingdomId: 1 });
        expect(second.days).toBeLessThan(first);
        s.stores = 0; s.dead.starvedDays = 5;
        expect(EatingTheDead.canEat(s, town).ok).toBe(false);
    });

    it('your own holding: ordered by you it brands you; forbidden, the governor will not', () => {
        const { world, town } = makeWorld();
        const p = makePlayer();
        const s = siegeOf();
        for (let i = 0; i < 3; i++) EatingTheDead._count(s, town);
        const karma = p.karma;
        const r = EatingTheDead.order(p, world, s, town);
        expect(r.success).toBe(true);
        expect(p.karma).toBeLessThan(karma);
        expect(Atrocities.butcher(p)).toBeGreaterThan(0);
        // Another holding: forbidden — the governor never does it however long they starve
        const { world: w2, town: t2 } = makeWorld();
        const s2 = siegeOf();
        EatingTheDead.forbid(p, w2, s2, t2, true);
        pin(EatingTheDead.config().governor, { chance: 1, afterDays: 1 });
        for (let i = 0; i < 10; i++) expect(EatingTheDead.holdingDay(w2, p, s2, t2, 'Ser Hugh')).toBe(null);
        EatingTheDead.forbid(p, w2, s2, t2, false);
        let got = null;
        for (let i = 0; i < 12 && !got; i++) { w2.day++; got = EatingTheDead.holdingDay(w2, p, s2, t2, 'Ser Hugh', { notices: [] }); }
        expect(got).toBeTruthy();
        expect(got.text).toMatch(/Ser Hugh/);
    });

    it('a town a commissioned host besieges holds on longer once it eats its dead', () => {
        const { world, town } = makeWorld();
        pin(EatingTheDead.config().ai, { chance: 1 });
        const sg = { q: 3, r: 4, name: 'Ashford', kingdomId: 1 };
        let holding = false;
        for (let i = 0; i < 12 && !holding; i++) { world.day++; holding = EatingTheDead.generalDay(world, sg, town, true); }
        expect(holding).toBe(true);
        expect(town.ateDead).toBeTruthy();
        world.day += 5;
        expect(EatingTheDead.generalDay(world, sg, town, true)).toBe(true);
    });
});

describe('Flaying — your stewards and the skin over the chair', () => {
    async function stewardSetup() {
        const { Stewards } = await import('../systems/stewards.js');
        const { Holdings } = await import('../systems/holdings.js');
        const { Economy } = await import('../world/economy.js');
        const { House } = await import('../systems/house.js');
        Utils.setSeed(7);
        const tiles = new Map();
        for (let q = 0; q < 16; q++) for (let r = 0; r < 16; r++) tiles.set(`${q},${r}`, { q, r, terrain: { id: 'plains', passable: true } });
        const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, territory: [{ q: 5, r: 5 }], population: 5000 };
        const world = {
            day: 7, width: 16, kingdoms: [kingdom], units: [], events: [], generationParams: { seed: 42 },
            getTile: (q, r) => tiles.get(`${q},${r}`) || null, getKingdom: (id) => (id === 'k1' ? kingdom : null),
            getAllSettlements: () => [...tiles.values()].filter(t => t.settlement).map(t => ({ ...t.settlement, q: t.q, r: t.r })),
        };
        const player = {
            id: 'p1', name: 'Ash Ashborne', firstName: 'Ash', lastName: 'Ashborne', gender: 'male', gold: 10000, renown: 20, karma: 0, reputation: {}, properties: [], colonies: [],
            children: [], inventory: {}, army: [], q: 9, r: 9, taxRate: 'moderate', skills: { commerce: 20, combat: 4, leadership: 3, diplomacy: 4, stealth: 2 },
        };
        Relationships.initialize(player);
        House.initialize(player, world);
        const s = { name: 'Town55', type: 'village', population: 900, level: 1, kingdom: null, colony: { isPlayerColony: true, loyalty: 60, garrisonStrength: 0 } };
        Economy.initSettlement(s);
        s.economy.gold = 5000;
        world.getTile(5, 5).settlement = s;
        s.q = 5; s.r = 5;
        player.colonies.push({ q: 5, r: 5, name: s.name, foundedDay: 0 });
        const folk = Stewards.candidates(player, world, 'holding:5,5').find(c => c.kind === 'townsfolk');
        expect(Stewards.appoint(player, world, 'holding:5,5', folk.key).success).toBe(true);
        const g = s.holding.governor;
        g.st.honesty = 0.1;
        g.st.orders = 'revenue';
        const run = (n) => { for (let i = 0; i < n; i++) { world.day++; Holdings.processDay(player, world); Stewards.processDay(world, player); } };
        return { Stewards, world, player, s, g, run };
    }

    it('a crooked steward skims less with a flayed skin over the judge\'s chair', async () => {
        const { world, player, s, g, run } = await stewardSetup();
        run(14);
        const bold = g.st.skim;
        expect(bold).toBeGreaterThan(0);
        Gibbets.raise(world, s, { kind: 'chair', name: 'Old Pell', by: { kind: 'player', id: player.name, name: player.name }, flayed: true }, null);
        expect(Flaying.stewardDread(player, world)).toBeGreaterThan(0.5);
        run(14);
        expect(g.st.fear).toBeGreaterThanOrEqual(Flaying.stewardDread(player, world) - 1e-9);
        expect(g.st.skim).toBeLessThan(bold * 0.6);
    });

    it('a steward sent to the scaffold leaves the seat for the cells, awaiting the rope or the knife', async () => {
        const { Stewards, world, player, s, g } = await stewardSetup();
        g.st.caught = true;
        const r = Stewards.punish(player, world, 'holding:5,5', 'scaffold');
        expect(r.success).toBe(true);
        expect(s.holding.governor).toBe(null);
        const e = Executions.list(player).find(x => x.source === 'steward');
        expect(e.crime).toBe('corruption');
        expect(e.guilty).toBe(true);
    });
});

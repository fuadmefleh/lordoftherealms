// Heads on spikes, gibbets and war trophies (systems/gibbets.js, world/deadDisplays.js): the
// bodies the scaffold and the field leave in your hands, the displays at a town's gate,
// crossroads and gallows and how they rot, what reads them (thieves, the commons' grievance,
// the town's temper), the kin's, the House's, the realm's and the faith's reckoning, the
// trophies kept as heirlooms (prestige, dread at siege terms, the heirs' hatred, envoys and
// their price), the realms' own dead on show, and taking them down.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Executions } from '../systems/executions.js';
import { Gibbets } from '../systems/gibbets.js';
import { DeadDisplays } from '../world/deadDisplays.js';
import { Heirlooms } from '../systems/heirlooms.js';
import { Atrocities } from '../systems/atrocities.js';
import { PeasantRevolts } from '../systems/peasantRevolts.js';
import { NpcTheft } from '../systems/npcTheft.js';
import { NPCLords } from '../world/npcLords.js';
import { Devotion } from '../systems/devotion.js';

let CustomObjects;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    await loadData();
    ({ CustomObjects } = await import('../world/customObjects.js'));
    CustomObjects.reset();
    await CustomObjects.loadAll();
}, 120000);
beforeEach(() => { Utils.setSeed(4242); });

const P = (id, first, gender, o = {}) => ({ id, first, last: 'Cole', gender, born: -40 * 360, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [], purse: 20, ...o });

function makeWorld({ day = 700 } = {}) {
    const hal = P(0, 'Hal', 'male', { spouse: 1, kids: [2] });
    const meg = P(1, 'Meg', 'female', { spouse: 0, kids: [2] });
    const rob = P(2, 'Rob', 'male', { parents: [0, 1], born: -20 * 360 });
    const nell = P(3, 'Nell', 'female');
    const folk = { q: 3, r: 4, n: 4, people: [hal, meg, rob, nell], annals: [] };
    const kingdom = { id: 1, name: 'Varn', isAlive: true, treasury: 5000, stability: 60, culture: 'Imperial', laws: {}, capital: { q: 3, r: 4 }, lord: { name: 'King Odo', memory: [] }, religion: { faithId: 'old_gods' } };
    const town = { name: 'Ashford', q: 3, r: 4, kingdom: 1, folk, economy: { gold: 2000 }, type: 'town', population: 900, happiness: 60 };
    const ofolk = { q: 8, r: 8, n: 2, people: [P(10, 'Wat', 'male'), P(11, 'Ivo', 'male')], annals: [] };
    const other = { id: 2, name: 'Oster', isAlive: true, treasury: 3000, stability: 55, culture: 'Imperial', laws: {}, capital: { q: 8, r: 8 }, lord: { name: 'King Ulf', memory: [] }, religion: { faithId: 'old_gods' } };
    const otown = { name: 'Osterburg', q: 8, r: 8, kingdom: 2, folk: ofolk, economy: { gold: 1500 }, type: 'city', population: 4000, happiness: 50 };
    const near = { name: 'Brookend', q: 4, r: 5, kingdom: 1, economy: { gold: 300 }, type: 'village', population: 200, happiness: 55 };
    const tiles = { '3,4': town, '8,8': otown, '4,5': near };
    const world = {
        day, generationParams: { seed: 7 }, kingdoms: [kingdom, other], events: [], width: 40, height: 40,
        getTile: (q, r) => (tiles[`${q},${r}`] ? { q, r, settlement: tiles[`${q},${r}`], explored: true } : null),
        getSettlementViews: () => [town, otown, near],
        getKingdom: (id) => (String(id) === '1' ? kingdom : String(id) === '2' ? other : null),
    };
    return { world, folk, town, kingdom, other, otown, ofolk, near, hal, meg, rob, nell };
}

function makePlayer(o = {}) {
    return {
        name: 'Aldric Voss', firstName: 'Aldric', gender: 'male', gold: 500, karma: 0, renown: 0, reputation: { 1: 20 }, q: 3, r: 4,
        strength: 8, charisma: 7, intelligence: 6, faith: 5, luck: 5,
        skills: { combat: 8, commerce: 5, leadership: 6, diplomacy: 7, stealth: 5 },
        inventory: {}, children: [],
        house: { name: 'House Voss', generation: 1, prestige: 100, history: [], rivals: { 2: { kingdomId: 2, name: 'House Brand', feud: 10, memory: [] } } },
        throne: { ruling: { kingdomId: 1 } }, ...o,
    };
}

// Pin the scaffold's dice: no rescue, no riot, no broken rope
let savedEx = null;
let savedG = null;
function calm() {
    const C = Executions.config();
    savedEx = savedEx || JSON.parse(JSON.stringify({ disruption: C.disruption }));
    C.disruption = { ...C.disruption, rescue: { ...C.disruption.rescue, max: 0, base: 0, perKin: 0, perPopularity: 0, house: 0, band: 0, angry: 0 }, riot: {}, rope: { chance: 0 } };
}
function pinG(o) {
    const C = Gibbets.config();
    savedG = savedG || JSON.parse(JSON.stringify({ kinTakeDown: C.kinTakeDown, faithTakeDown: C.faithTakeDown, ai: C.ai, field: C.field, trophies: C.trophies }));
    Object.assign(C, o);
}
afterEach(() => {
    if (savedEx) { Executions.config().disruption = savedEx.disruption; savedEx = null; }
    if (savedG) { Object.assign(Gibbets.config(), savedG); savedG = null; }
});

/** Hang Hal here and now; his body comes into your hands. */
function hangHal(world, p) {
    calm();
    const e = Executions.condemn(p, world, { kind: 'folk', q: 3, r: 4, pid: 0 }, { crime: 'murder', guilty: true, quiet: true });
    const r = Executions.carryOut(p, world, e.id, 'hang', '3,4', { proclaimed: false, present: true });
    expect(r.outcome).toBe('executed');
    const bodies = Gibbets.collect(p, world);
    expect(bodies).toHaveLength(1);
    return bodies[0];
}

describe('Gibbets — the bodies and the display', () => {
    it('the scaffold\'s dead come into your hands once, and go up over the gate of your seat', () => {
        const { world, town, folk } = makeWorld();
        const p = makePlayer();
        const b = hangHal(world, p);
        expect(b.name).toBe('Hal Cole');
        expect(b.kin).toEqual({ q: 3, r: 4, pid: 0 });
        expect(Gibbets.collect(p, world)).toHaveLength(0); // (once)
        const opts = Object.fromEntries(Gibbets.displayOptions(p, world, b).map(o => [o.id, o]));
        expect(opts.spike.ok && opts.gibbet.ok && opts.gallows.ok).toBe(true);
        const happy = town.happiness;
        const r = Gibbets.display(p, world, b.id, 'spike', '3,4');
        expect(r.success).toBe(true);
        expect(town.displays).toHaveLength(1);
        expect(town.displays[0]).toMatchObject({ kind: 'spike', name: 'Hal Cole', by: { kind: 'player' } });
        expect(Gibbets.bodies(p, world)).toHaveLength(0);
        expect(town.happiness).toBeLessThan(happy);
        expect(world.gibbets.towns).toContain('3,4');
        // The town remembers who hung it there
        expect((folk.nm || []).some(m => m.k === 'dead_displayed')).toBe(true);
    });

    it('it rots: fresh, rotting, bones — then falls, and the street map is laid anew at each', () => {
        const { world, town } = makeWorld();
        const p = makePlayer();
        Gibbets.display(p, world, hangHal(world, p).id, 'gibbet', '3,4');
        const d = town.displays[0];
        const at = (n) => DeadDisplays.stage(d, d.day + n);
        expect(at(2).id).toBe('fresh');
        expect(at(40).id).toBe('rotting');
        expect(at(200).id).toBe('bones');
        expect(at(400)).toBe(null);
        expect(DeadDisplays.propOf(d, d.day + 2)).toBe('gb_gibbet_fresh');
        expect(DeadDisplays.propOf(d, d.day + 200)).toBe('gb_gibbet_bones');
        expect(DeadDisplays.stamp(town, d.day + 2)).not.toBe(DeadDisplays.stamp(town, d.day + 40));
        // Gone to pieces: the week's turn takes it off the town
        world.day = d.day + 406; // (a week day)
        while (world.day % 7) world.day++;
        const out = Gibbets.processDay(world, p);
        expect(town.displays).toBeUndefined();
        expect(out.notices.some(n => /Fallen/.test(n.title))).toBe(true);
    });

    it('on the street map: the head beside the road out of town, the body on the gallows in the square', () => {
        for (const id of ['gb_spike_fresh', 'gb_gibbet_rotting', 'gb_gallows_bones']) expect(CustomObjects.getDef(id), id).toBeTruthy();
        // A 40x30 town: grass, a cross of roads through the middle, a square
        const tiles = Array.from({ length: 30 }, (_, r) => Array.from({ length: 40 }, (_, q) => ({
            q, r, explored: true, visible: true, isRoad: q === 20 || r === 15, subTerrain: { id: q === 20 || r === 15 ? 'cobble' : 'grass', passable: true },
        })));
        const s = { name: 'Ashford', displays: [
            { id: 'd1', kind: 'spike', day: 100, name: 'Hal Cole', by: { kind: 'player' } },
            { id: 'd2', kind: 'gallows', day: 100, name: 'Rob Cole', by: { kind: 'realm' } },
            { id: 'd3', kind: 'gibbet', day: 100, name: 'Wat Cole', by: { kind: 'realm' } },
        ] };
        const laid = DeadDisplays.lay(tiles, s, 103, { plaza: { q: 14, r: 8, w: 12, h: 12 }, center: { q: 20, r: 15 } });
        expect(laid.map(x => x.id).sort()).toEqual(['d1', 'd2', 'd3']);
        const spike = laid.find(x => x.id === 'd1');
        expect(tiles[spike.r][spike.q].customObject.defId).toBe('gb_spike_fresh');
        expect(tiles[spike.r][spike.q].customObject.display).toBe('d1');
        // (by a road out of town, away from the middle)
        expect(Math.hypot(spike.q - 20, spike.r - 15)).toBeGreaterThan(5);
        const gal = laid.find(x => x.id === 'd2');
        expect(tiles[gal.r][gal.q].customObject.defId).toBe('gb_gallows_fresh');
    });

    it('by the gate of a walled town: never just behind the wall, which would hide all but its top', () => {
        // A walled box (rows 5..25, cols 8..32), its south gate where the road crosses row 25
        const tiles = Array.from({ length: 30 }, (_, r) => Array.from({ length: 40 }, (_, q) => {
            const onBox = (r === 5 || r === 25) ? (q >= 8 && q <= 32) : ((q === 8 || q === 32) && r > 5 && r < 25);
            const isRoad = q === 20 || r === 15;
            const t = { q, r, explored: true, visible: true, isRoad, subTerrain: { id: isRoad ? 'cobble' : 'grass', passable: true } };
            if (onBox && !isRoad) { t._townWall = 'stone'; t.subTerrain.passable = false; }
            return t;
        }));
        tiles._townWalls = { kind: 'stone', material: 'stone', box: { q0: 8, q1: 32, r0: 5, r1: 25 }, gates: 4, open: 0 };
        const s = { name: 'Ashford', displays: [1, 2, 3, 4].map(i => ({ id: `d${i}`, kind: 'skin', day: 100, name: `Man ${i}`, by: { kind: 'player' } })) };
        const laid = DeadDisplays.lay(tiles, s, 103, { center: { q: 20, r: 15 } });
        expect(laid.length).toBeGreaterThan(0);
        const def = CustomObjects.getDef('gb_skin_fresh');
        const rows = 1 + Math.max(...(def.tiles || [{ localRow: 0 }]).map(t => t.localRow || 0));
        for (const d of laid) {
            for (let k = 0; k <= rows + 3; k++) expect(tiles[d.r + k] && tiles[d.r + k][d.q] && tiles[d.r + k][d.q]._townWall, `${d.id} at ${d.q},${d.r}`).toBeFalsy();
        }
    });
});

describe('Gibbets — what it does while it stands', () => {
    it('thieves are cowed: the burglar\'s and the cutpurse\'s chance reads the deterrence', () => {
        const { world, town } = makeWorld();
        const p = makePlayer();
        expect(Gibbets.deterrence(town, world.day)).toBe(1);
        Gibbets.display(p, world, hangHal(world, p).id, 'spike', '3,4');
        const fresh = Gibbets.deterrence(town, world.day);
        expect(fresh).toBeLessThan(1);
        expect(Gibbets.deterrence(town, world.day + 200)).toBeGreaterThan(fresh); // (bones cow less)
        const spy = vi.spyOn(Gibbets, 'deterrence');
        NpcTheft.pickNpcs(world, town, world.day);
        NpcTheft.planBurglary(world, town, world.day);
        expect(spy.mock.calls.some(c => c[0] === town)).toBe(true);
        spy.mockRestore();
    });

    it('the commons are afraid to rise: a fear part in the grievance pressure, here and in the next village', () => {
        const { world, town, near, otown } = makeWorld();
        const p = makePlayer();
        const before = PeasantRevolts.pressure(world, town);
        expect(before.parts.some(x => x.id === 'gibbets')).toBe(false);
        Gibbets.display(p, world, hangHal(world, p).id, 'gibbet', '3,4');
        const part = PeasantRevolts.pressure(world, town).parts.find(x => x.id === 'gibbets');
        expect(part.v).toBeLessThan(0);
        const nb = Gibbets.revoltDread(world, near, world.day);
        expect(nb).toBeGreaterThan(0);
        expect(nb).toBeLessThan(Gibbets.revoltDread(world, town, world.day));
        expect(Gibbets.revoltDread(world, otown, world.day)).toBe(0); // (too far)
    });

    it('the town sours week by week while it stands', () => {
        const { world, town } = makeWorld();
        const p = makePlayer();
        Gibbets.display(p, world, hangHal(world, p).id, 'gallows', '3,4');
        pinG({ kinTakeDown: { base: 0, perKin: 0, house: 0, max: 0 }, faithTakeDown: { sacred: 0, mild: 0, harsh: 0, afterDays: 0 } });
        const h0 = town.happiness;
        world.day += 7 - (world.day % 7);
        Gibbets.processDay(world, p);
        expect(town.happiness).toBeLessThan(h0);
    });

    it('the kin, the House, the realm and the faith count it a desecration; your name is dreaded', () => {
        const { world, meg, rob, kingdom } = makeWorld();
        const p = makePlayer();
        Gibbets.display(p, world, hangHal(world, p).id, 'spike', '3,4');
        // The kin: a blood memory the Nemesis reads
        expect((meg.nm || []).some(m => m.k === 'desecrated_dead')).toBe(true);
        expect((rob.nm || []).some(m => m.k === 'desecrated_dead')).toBe(true);
        // The faith's clergy think less of you
        expect(Devotion.standing(p, 'old_gods')).toBeLessThan(0);
        expect(p.renown).toBeGreaterThan(0);
        expect(Gibbets.grievances(world, { by: 'player' })).toHaveLength(1);
        // A great man's House and realm: a feud and a vendetta deed
        const b2 = Gibbets.offerBody(p, world, { name: 'Lord Ivo Brand', rank: 'lord', source: 'field', kingdomId: 2, house: { id: 2, name: 'House Brand' }, q: 3, r: 4 });
        const feud = p.house.rivals[2].feud;
        expect(Gibbets.display(p, world, b2.id, 'gibbet', '3,4').success).toBe(true);
        expect(p.house.rivals[2].feud).toBeGreaterThan(feud);
        expect(p.house.rivals[2].memory.some(m => m.kind === 'kinDisplayed')).toBe(true);
        const other = world.getKingdom(2);
        expect(NPCLords.memoryOf(other.lord, world.day).some(m => m.key === 'kin_displayed')).toBe(true);
        expect(NPCLords.vendettaOf(other.lord, world.day).weight).toBeGreaterThan(0);
        expect(Gibbets.grievances(world, { house: 2 })).toHaveLength(1);
        void kingdom;
    });
});

describe('Gibbets — taking them down', () => {
    it('you cut your own down: gone from the town, the kin grateful', () => {
        const { world, town, meg } = makeWorld();
        const p = makePlayer();
        Gibbets.display(p, world, hangHal(world, p).id, 'spike', '3,4');
        const id = town.displays[0].id;
        expect(Gibbets.takeDown(makePlayer({ q: 0, r: 0 }), world, 3, 4, id).success).toBe(false); // (not there)
        const r = Gibbets.takeDown(p, world, 3, 4, id);
        expect(r.success).toBe(true);
        expect(town.displays).toBeUndefined();
        expect(world.gibbets.towns).not.toContain('3,4');
        expect((meg.nm || []).some(m => m.k === 'body_returned')).toBe(true);
        expect(Gibbets.deterrence(town, world.day)).toBe(1);
    });

    it('cutting down another lord\'s dead is a crime against his justice', () => {
        const { world, otown } = makeWorld();
        Gibbets.raise(world, otown, { kind: 'gibbet', name: 'Wat Cole', by: { kind: 'realm', id: 2, name: 'King Ulf' }, kin: { q: 8, r: 8, pid: 10 } });
        const p = makePlayer({ q: 8, r: 8, reputation: { 2: 10 } });
        const r = Gibbets.takeDown(p, world, 8, 8, otown.displays[0].id);
        expect(r.success).toBe(true);
        expect(p.reputation[2]).toBeLessThan(10);
        expect(otown.displays).toBeUndefined();
    });

    it('the kin cut it down in the night; the priests of a faith that holds the body sacred take theirs back', () => {
        const { world, town } = makeWorld();
        const p = makePlayer();
        Gibbets.display(p, world, hangHal(world, p).id, 'gibbet', '3,4');
        pinG({ kinTakeDown: { base: 1, perKin: 0, house: 0, max: 1, afterDays: 0 } });
        world.day += 7 - (world.day % 7);
        const out = Gibbets.processDay(world, p);
        expect(town.displays).toBeUndefined();
        expect(out.notices.some(n => /Night/.test(n.title))).toBe(true);
        expect(world.gibbets.log[0].by).toBe('kin');
        // The faith
        const w2 = makeWorld();
        const p2 = makePlayer();
        Gibbets.display(p2, w2.world, hangHal(w2.world, p2).id, 'gibbet', '3,4');
        Object.assign(Gibbets.config(), { kinTakeDown: { base: 0, perKin: 0, house: 0, max: 0 }, faithTakeDown: { sacred: 1, mild: 1, harsh: 1, afterDays: 0 } });
        w2.world.day += 7 - (w2.world.day % 7);
        const out2 = Gibbets.processDay(w2.world, p2);
        expect(w2.town.displays).toBeUndefined();
        expect(out2.notices.some(n => /Priests/.test(n.title))).toBe(true);
    });

    it('the realms put their own executed up at their capitals', () => {
        const { world, otown } = makeWorld();
        pinG({ ai: { highborn: 1, treason: 1, common: 1 } });
        Executions.worldState(world).public.push({ id: 91, q: 8, r: 8, town: 'Osterburg', kingdomId: 2, day: world.day, pid: 10, name: 'Wat Cole', gender: 'male', crime: 'treason', crimeLabel: 'treason', method: 'behead', highborn: false, guilty: true, resolved: true, outcome: 'executed' });
        Gibbets.processDay(world, null);
        expect(otown.displays).toHaveLength(1);
        expect(otown.displays[0]).toMatchObject({ kind: 'spike', name: 'Wat Cole', by: { kind: 'realm', id: 2 } });
        Gibbets.processDay(world, null); // (once)
        expect(otown.displays).toHaveLength(1);
        expect(Gibbets.deterrence(otown, world.day)).toBeLessThan(1);
    });
});

describe('Gibbets — war trophies', () => {
    it('a king slain in the field: his realm passes to his heir, his body is yours', () => {
        const { world, other } = makeWorld();
        const p = makePlayer();
        pinG({ field: { minStrength: 10, lordAt: 90, kingAt: 100, kingChance: 1 } });
        other.ruler = 'King Ulf';
        const lordDies = vi.spyOn(NPCLords, 'lordDies').mockImplementation(() => {});
        const b = Gibbets.onFieldSlain(p, world, { kingdomId: 2, foe: 'the royal host', strength: 400 });
        expect(lordDies).toHaveBeenCalled();
        lordDies.mockRestore();
        expect(b).toMatchObject({ name: 'King Ulf', rank: 'king', great: true, kingdomId: 2 });
        // A small host: a captain, no king
        pinG({ field: { minStrength: 10, lordAt: 90, kingAt: 1000, kingChance: 0 } });
        const c = Gibbets.onFieldSlain(p, world, { kingdomId: 2, foe: 'a war band', strength: 30 });
        expect(c.rank).toBe('commander');
        expect(Gibbets.trophyOptions(p, world, c).every(o => !o.ok)).toBe(true);
    });

    it('a skull cup is an heirloom with real effects: prestige, dread at their siege terms, the heirs\' vendetta, the faith\'s frown', () => {
        const { world, otown, other } = makeWorld();
        const p = makePlayer();
        const b = Gibbets.offerBody(p, world, { name: 'King Ulf', rank: 'king', source: 'field', kingdomId: 2, q: 3, r: 4 });
        const prestige = p.house.prestige;
        const terms0 = Atrocities.termsShift(p, otown, 'tribute');
        const r = Gibbets.takeTrophy(p, world, b.id, 'skull_cup');
        expect(r.success).toBe(true);
        const h = r.item;
        expect(h.kind).toBe('skull_cup');
        expect(h.trophy).toMatchObject({ of: 'King Ulf', kingdomId: 2, rank: 'king' });
        expect(Heirlooms.get(p, h.id)).toBe(h);
        expect(h.history[0].text).toMatch(/King Ulf/);
        expect(Heirlooms.prestigeOf(h)).toBeGreaterThan(0); // (Prestige a year, read by the heirlooms' year)
        expect(p.house.prestige).toBeGreaterThan(prestige);
        expect(Gibbets.trophyDread(p, 2)).toBeGreaterThan(0);
        expect(Gibbets.trophyDread(p, 1)).toBe(0);
        expect(Atrocities.termsShift(p, otown, 'tribute')).toBeGreaterThan(terms0);
        expect(NPCLords.memoryOf(other.lord, world.day).some(m => m.key === 'trophy_held')).toBe(true);
        expect(Devotion.standing(p, 'old_gods')).toBeLessThan(0);
        // The head is gone: no spike, no second cup; the banner can still be taken
        const opts = Object.fromEntries(Gibbets.trophyOptions(p, world, b).map(o => [o.id, o]));
        expect(opts.skull_cup.ok).toBe(false);
        expect(opts.trophy_banner.ok).toBe(true);
        expect(Gibbets.displayOptions(p, world, b).find(o => o.id === 'spike').ok).toBe(false);
        // (no delve or dig ever turns up a trophy)
        expect(Object.keys(Heirlooms.config().kinds)).toContain('skull_cup');
    });

    it('his realm wants it back: envoys with a price out of its treasury; refused, they remember; returned, it goes home', () => {
        const { world, other } = makeWorld();
        const p = makePlayer();
        const b = Gibbets.offerBody(p, world, { name: 'Lord Ivo Brand', rank: 'lord', source: 'field', kingdomId: 2, q: 3, r: 4 });
        const h = Gibbets.takeTrophy(p, world, b.id, 'trophy_banner').item;
        world.day = h.trophy.nextDemand;
        const out = Gibbets.processDay(world, p);
        expect(out.notices.some(n => /Want It Back/.test(n.title))).toBe(true);
        expect(h.trophy.demand.price).toBeGreaterThan(0);
        const v0 = NPCLords.vendettaOf(other.lord, world.day).weight;
        expect(Gibbets.refuseDemand(p, world, h.id).success).toBe(true);
        expect(NPCLords.vendettaOf(other.lord, world.day).weight).toBeGreaterThan(v0);
        expect(h.trophy.demand).toBe(null);
        // Sell it back: their treasury pays, it leaves the House
        const gold = p.gold, treasury = other.treasury;
        const r = Gibbets.returnTrophy(p, world, h.id, 'price');
        expect(r.success).toBe(true);
        expect(p.gold).toBeGreaterThan(gold);
        expect(other.treasury).toBe(treasury - r.paid);
        expect(Heirlooms.get(p, h.id)).toBe(null);
        expect(Gibbets.trophies(p)).toHaveLength(0);
    });

    it('a body given back to the kin eases the House\'s feud', () => {
        const { world } = makeWorld();
        const p = makePlayer();
        p.house.rivals[2].feud = 50;
        const b = Gibbets.offerBody(p, world, { name: 'Lord Ivo Brand', rank: 'lord', kingdomId: 2, house: { id: 2, name: 'House Brand' } });
        expect(Gibbets.returnBody(p, world, b.id).success).toBe(true);
        expect(p.house.rivals[2].feud).toBeLessThan(50);
        expect(Gibbets.bodies(p, world)).toHaveLength(0);
    });

    it('state survives a save: the world\'s record round-trips', () => {
        const { world, town } = makeWorld();
        const p = makePlayer();
        Gibbets.display(p, world, hangHal(world, p).id, 'spike', '3,4');
        const saved = Gibbets.serializeWorld(world);
        const w2 = { ...world };
        Gibbets.restoreWorld(saved, w2);
        expect(w2.gibbets.towns).toEqual(['3,4']);
        expect(Gibbets.all(w2, world.day).map(x => x.d.name)).toEqual(['Hal Cole']);
        void town;
    });
});

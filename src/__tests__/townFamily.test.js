/**
 * Family life among the townsfolk (systems/townFamily.js): conception and a
 * pregnancy's length, a birth that makes a real child, youths coming of age,
 * greying and retirement, inheritance, orphans taken in, a long run's
 * population, determinism and old saves.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownFamily } from '../systems/townFamily.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf-8'));
const DATA = { romance: read('romance.json'), townsfolk: read('townsfolk.json'), townFamily: read('townFamily.json'), townSchool: read('townSchool.json') };
const saved = DataLoader._gamedata;
const Y = 120;

function makeWorld(seed = 4242) {
    const towns = [
        { name: 'Ashford', type: 'town', q: 5, r: 7 },
        { name: 'Highmere', type: 'city', q: 20, r: 3 },
    ];
    return {
        day: 1, baseYear: 853, generationParams: { seed }, activeEvents: [], towns,
        getSettlementViews: () => towns, getKingdom: () => null,
        getTile: (q, r) => { const s = towns.find(t => t.q === q && t.r === r); return s ? { q, r, settlement: s } : null; },
    };
}

function seeded(seed = 4242) {
    const world = makeWorld(seed);
    for (const t of world.towns) Townsfolk.seed(t, world, { q: t.q, r: t.r });
    return world;
}

function liveUntil(world, to) {
    while (world.day < to) { world.day++; Townsfolk.processDay(world, null); }
}

/** A bare town with hand-made people (romance and the seasons' own events kept out of the way). */
function bare(world) {
    const s = world.towns[0];
    s.folk = { v: 1, q: s.q, r: s.r, n: 0, target: 0, tick: 0, people: [], annals: [], romance: { v: 1, n: 0, tick: 0, list: [], past: [], grudges: [] } };
    return s;
}

function person(folk, o) {
    const p = { id: folk.n++, first: o.first || `P${folk.n}`, last: o.last || 'Test', gender: o.gender || 'male', born: (o.day || 1) - (o.age || 25) * Y, died: null, cause: null,
        role: o.role || 'villager', traits: [], spouse: null, parents: o.parents || [], kids: [], away: null, log: [] };
    folk.people.push(p);
    delete folk._index;
    for (const id of p.parents) Townsfolk.get(folk, id).kids.push(p.id);
    return p;
}

function wed(folk, a, b) { a.spouse = b.id; b.spouse = a.id; }

/** Step the family book only, from its tick to `to`. */
function steps(world, s, to) {
    world.day = to;
    TownFamily.catchUp(world, s, s.folk, to, []);
}

beforeEach(() => {
    DataLoader._gamedata = { ...DATA, townFamily: JSON.parse(JSON.stringify(DATA.townFamily)) };
});
afterAll(() => { DataLoader._gamedata = saved; });

describe('TownFamily — conception and birth', () => {
    it('a wedded couple conceive; the babe comes a pregnancy later, a real child on the roster', () => {
        DataLoader._gamedata.townFamily.conception.byAge = [{ under: 18, rate: 0 }, { under: 40, rate: 0.99 }, { under: 999, rate: 0 }];
        const world = makeWorld();
        const s = bare(world);
        const folk = s.folk;
        const mum = person(folk, { gender: 'female', age: 24, last: 'Ashborne' });
        const dad = person(folk, { gender: 'male', age: 26, last: 'Millbrook' });
        wed(folk, mum, dad);
        TownFamily.state(folk, world, 0);
        let t = 0;
        while (!mum.preg && t < 400) { t += 10; steps(world, s, t); }
        expect(mum.preg).toBeTruthy();
        expect(mum.preg.due - mum.preg.d).toBe(TownFamily.config().pregnancyDays);
        expect(Townsfolk.status(mum, world).text).toMatch(/with child/);
        expect(Townsfolk.familyLines({ _person: mum, _folk: folk }, world)).toMatch(/due/);
        const due = mum.preg.due;
        steps(world, s, due - 10);
        expect(mum.kids.length).toBe(0);
        steps(world, s, Math.ceil(due / 10) * 10);
        const born = folk.people.filter(p => p.parents.includes(mum.id));
        // (a few in a hundred are lost at birth)
        if (!mum.log.some(e => e.k === 'stillborn')) {
            expect(born.length).toBe(1);
            const kid = born[0];
            expect(kid.parents).toEqual([mum.id, dad.id]);
            expect(kid.last).toBe('Millbrook');
            expect(kid.role).toBe('child');
            expect(kid.hh).toBe(mum.hh);
            expect(folk.annals.some(e => e.k === 'born' && e.a === kid.id)).toBe(true);
        }
        expect(TownFamily.isPostpartum(mum, world.day)).toBe(true);
        expect(TownFamily.isPostpartum(mum, world.day + 60)).toBe(false);
    });

    it('the unwed, the too old and same-sex couples do not conceive', () => {
        DataLoader._gamedata.townFamily.conception.byAge = [{ under: 18, rate: 0 }, { under: 43, rate: 0.99 }, { under: 999, rate: 0 }];
        const world = makeWorld();
        const s = bare(world);
        const folk = s.folk;
        const single = person(folk, { gender: 'female', age: 24 });
        const old = person(folk, { gender: 'female', age: 50 });
        const oldMan = person(folk, { gender: 'male', age: 52 });
        wed(folk, old, oldMan);
        const a = person(folk, { gender: 'female', age: 25 });
        const b = person(folk, { gender: 'female', age: 26 });
        wed(folk, a, b);
        TownFamily.state(folk, world, 0);
        steps(world, s, 2 * Y);
        expect([single, old, a, b].some(p => p.preg || p.kids.length)).toBe(false);
    });
});

describe('TownFamily — growing up and growing old', () => {
    it('children become youths and the coming-of-age hook fires', () => {
        const world = makeWorld();
        const s = bare(world);
        const folk = s.folk;
        const kid = person(folk, { gender: 'female', age: 11, role: 'child' });
        kid.born = 50 - 12 * Y; // (turns 12 at day 50)
        TownFamily.state(folk, world, 0);
        expect(TownFamily.comingOfAge(folk)).toEqual([]);
        steps(world, s, Y);
        const came = TownFamily.comingOfAge(folk);
        expect(came.map(e => e.person.id)).toContain(kid.id);
        expect(TownFamily.isYouth(kid, world.day)).toBe(true);
        expect(TownFamily.ageStage(kid, world.day)).toBe('youth');
    });

    it('hair greys, the old retire from heavy work, frailty rises', () => {
        const world = makeWorld();
        const folk = bare(world).folk;
        const young = person(folk, { age: 30, role: 'farmer' });
        const mid = person(folk, { age: 63, role: 'farmer' });
        const clerk = person(folk, { age: 63, role: 'villager' });
        const old = person(folk, { age: 88, role: 'villager' });
        expect(TownFamily.greyShade(world, folk, young, 1)).toBe(null);
        expect(['Gray', 'Silver']).toContain(TownFamily.greyShade(world, folk, mid, 1));
        expect(TownFamily.greyShade(world, folk, old, 1)).toBe('White');
        expect(TownFamily.canWork(young, 1)).toBe(true);
        expect(TownFamily.canWork(mid, 1)).toBe(false);
        expect(TownFamily.canWork(clerk, 1)).toBe(true);
        expect(TownFamily.canWork(old, 1)).toBe(false);
        expect(TownFamily.frailty(young, 1)).toBe(0);
        expect(TownFamily.frailty(old, 1)).toBe(1);
        expect(TownFamily.ageStage(old, 1)).toBe('elder');
    });
});

describe('TownFamily — households, inheritance, orphans', () => {
    it('when the last of a house dies, the eldest child inherits the house and the purse', () => {
        const world = makeWorld();
        const s = bare(world);
        const folk = s.folk;
        const widow = person(folk, { gender: 'female', age: 70 });
        const son = person(folk, { gender: 'male', age: 40, parents: [widow.id] });
        const wife = person(folk, { gender: 'female', age: 38 });
        wed(folk, son, wife);
        TownFamily.state(folk, world, 0);
        // (the son and his wife live apart from his mother)
        son.hh = wife.hh = 99;
        widow.purse = 30;
        son.purse = 5;
        Townsfolk._die(folk, widow, 5, 'old age');
        steps(world, s, 10);
        expect(widow.heir).toBe(son.id);
        expect(son.purse).toBe(35);
        expect(son.hh).toBe(widow.hh);
        expect(wife.hh).toBe(widow.hh);
        expect(son.log.some(e => e.k === 'inherited' && e.o === widow.id)).toBe(true);
        expect(folk.annals.some(e => e.k === 'inherited')).toBe(true);
        expect(Townsfolk.annalText(folk, folk.annals.find(e => e.k === 'inherited'), world)).toMatch(/inherited/);
    });

    it('an orphan is taken in by kin, else a neighbour', () => {
        const world = makeWorld();
        const s = bare(world);
        const folk = s.folk;
        const gran = person(folk, { gender: 'female', age: 60 });
        const mum = person(folk, { gender: 'female', age: 32, parents: [gran.id] });
        const dad = person(folk, { gender: 'male', age: 34 });
        wed(folk, mum, dad);
        const kid = person(folk, { gender: 'male', age: 8, role: 'child', parents: [mum.id, dad.id] });
        const widow = person(folk, { gender: 'female', age: 30 });
        Townsfolk._die(folk, widow, 1, 'a fever');
        const other = person(folk, { gender: 'male', age: 6, role: 'child', parents: [widow.id] });
        const nb = person(folk, { gender: 'female', age: 35 });
        const nh = person(folk, { gender: 'male', age: 36 });
        wed(folk, nb, nh);
        TownFamily.state(folk, world, 0);
        Townsfolk._die(folk, mum, 3, 'a fever');
        Townsfolk._die(folk, dad, 4, 'a fever');
        steps(world, s, 10);
        expect(kid.ward).toBe(gran.id);
        expect(kid.hh).toBe(gran.hh);
        expect(gran.log.some(e => e.k === 'tookIn' && e.o === kid.id)).toBe(true);
        // A child with no kin at all goes to a wedded neighbour
        expect(other.ward).toBe(nb.id);
        expect(TownFamily.familyLine(folk, gran, world)).toMatch(/took in/);
    });

    it('newly-weds set up house, and their household is one roof on the map', () => {
        const world = seeded(5);
        liveUntil(world, 1 + 3 * Y);
        const folk = world.towns[1].folk;
        const couples = Townsfolk.residents(folk).filter(p => { const sp = Townsfolk.get(folk, p.spouse); return sp && Townsfolk.isHere(sp); });
        expect(couples.length).toBeGreaterThan(0);
        for (const p of couples) expect(p.hh).toBe(Townsfolk.get(folk, p.spouse).hh);
        const npcs = Townsfolk.residents(folk).map((p, i) => { const n = { id: i }; Townsfolk.dress(n, p, folk, world); return n; });
        Townsfolk.linkFamilies(npcs);
        for (const n of npcs) expect(n._hh).toBe(n._person.hh);
    });
});

describe('TownFamily — the long run, determinism, old saves', () => {
    it('over twenty years the towns hold their own, with children among them', () => {
        const world = seeded(7);
        const start = world.towns.reduce((t, s) => t + Townsfolk.residents(s.folk).length, 0);
        liveUntil(world, 1 + 20 * Y);
        const people = world.towns.flatMap(s => Townsfolk.residents(s.folk));
        expect(people.length).toBeGreaterThan(start * 0.8);
        expect(people.length).toBeLessThan(start * 1.6);
        const kids = people.filter(p => Townsfolk.age(p, world.day) < 16).length / people.length;
        expect(kids).toBeGreaterThan(0.1);
        expect(kids).toBeLessThan(0.5);
        expect(world.towns.some(s => s.folk.annals.some(e => e.k === 'born'))).toBe(true);
    });

    it('lived day by day or caught up on entry, the same families', () => {
        const w1 = seeded(33);
        liveUntil(w1, 1 + 4 * Y);
        const w2 = seeded(33);
        w2.day = 1 + 4 * Y;
        for (const t of w2.towns) Townsfolk.catchUp(w2, t, w2.day);
        expect(JSON.stringify(w2.towns[1].folk.people)).toBe(JSON.stringify(w1.towns[1].folk.people));
        expect(JSON.stringify(w2.towns[1].folk.family)).toBe(JSON.stringify(w1.towns[1].folk.family));
    });

    it('an old save: households and youths filled in, no back-dated events', () => {
        const world = seeded(44);
        liveUntil(world, 1 + Y);
        const folk = world.towns[1].folk;
        delete folk.family;
        for (const p of folk.people) { delete p.hh; delete p.youth; delete p.preg; delete p.estate; }
        const copy = JSON.parse(JSON.stringify(folk));
        world.towns[1].folk = copy;
        liveUntil(world, world.day + 10);
        expect(Townsfolk.residents(copy).every(p => p.hh != null)).toBe(true);
        const youths = Townsfolk.residents(copy).filter(p => p.role === 'child' && Townsfolk.age(p, world.day) >= 12);
        for (const y of youths) expect(y.youth).toBeDefined();
        expect(TownFamily.comingOfAge(copy).length).toBe(0);
        expect(copy.annals.some(e => e.k === 'inherited' && e.d <= world.day - 10)).toBe(false);
    });
});

describe('TownFamily — christenings and orphans from afar', () => {
    it('a babe is christened a few days on: godparents of kin, the offering to the priest, the town told', () => {
        DataLoader._gamedata.townFamily.conception.byAge = [{ under: 18, rate: 0 }, { under: 40, rate: 0.99 }, { under: 999, rate: 0 }];
        DataLoader._gamedata.townFamily.birth.stillbirth = 0;
        DataLoader._gamedata.townFamily.birth.childbedDeath = 0;
        const world = makeWorld();
        const s = bare(world);
        const folk = s.folk;
        const priest = person(folk, { role: 'priest', age: 50 });
        const gran = person(folk, { gender: 'female', age: 60 });
        const mum = person(folk, { gender: 'female', age: 24, parents: [gran.id] });
        const aunt = person(folk, { gender: 'female', age: 28, parents: [gran.id] });
        const dad = person(folk, { gender: 'male', age: 26 });
        wed(folk, mum, dad);
        TownFamily.state(folk, world, 0);
        for (const p of folk.people) Townsfolk.purse(folk, p, world, [10, 10]);
        let t = 0;
        while (!folk.people.some(p => p.parents.includes(mum.id)) && t < 600) { t += 10; steps(world, s, t); }
        const kid = folk.people.find(p => p.parents.includes(mum.id));
        expect(kid).toBeTruthy();
        expect(kid.christen).toBeGreaterThan(kid.born);
        const before = mum.purse + dad.purse + priest.purse;
        steps(world, s, t + 10);
        expect(kid.christened).toBeTruthy();
        expect(kid.godparents).toContain(aunt.id);
        expect(aunt.log.some(e => e.k === 'godparent' && e.o === kid.id)).toBe(true);
        expect(priest.purse).toBe(11);
        expect(mum.purse + dad.purse + priest.purse).toBeCloseTo(before, 6);
        const e = folk.annals.find(x => x.k === 'christened');
        expect(Townsfolk.annalText(folk, e, world)).toMatch(/christened/);
        expect(TownFamily.christeningsOn(folk, kid.christened)[0].child).toBe(kid);
    });

    it('an orphan with no one at home is taken in by a childless couple of a nearby town', () => {
        const world = makeWorld();
        const s = bare(world);
        const folk = s.folk;
        const lost = person(folk, { gender: 'female', age: 30 });
        Townsfolk._die(folk, lost, 1, 'a fever');
        const kid = person(folk, { gender: 'female', age: 7, role: 'child', parents: [lost.id] });
        // (no kin, no wedded couple in this town)
        person(folk, { gender: 'male', age: 70 });
        const t2 = world.towns[1];
        t2.q = 9; t2.r = 9;
        t2.folk = { v: 1, q: 9, r: 9, n: 0, target: 0, tick: 0, people: [], annals: [] };
        const a = person(t2.folk, { gender: 'female', age: 30 });
        const b = person(t2.folk, { gender: 'male', age: 32 });
        wed(t2.folk, a, b);
        TownFamily.state(folk, world, 0);
        TownFamily.state(t2.folk, world, 0);
        steps(world, s, 10);
        expect(kid.away && kid.away.to).toBe(t2.name);
        const there = t2.folk.people.find(p => p.from && p.from.id === kid.id);
        expect(there).toBeTruthy();
        expect([a.id, b.id]).toContain(there.ward);
        expect(Townsfolk.isHere(there)).toBe(true);
        expect(folk.annals.some(e => e.k === 'adoptedAway')).toBe(true);
        expect(t2.folk.annals.some(e => e.k === 'adoptedFrom')).toBe(true);
        expect(Townsfolk.annalText(t2.folk, t2.folk.annals.find(e => e.k === 'adoptedFrom'), world)).toMatch(/orphan from Ashford/);
    });
});

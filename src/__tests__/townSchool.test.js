/**
 * Schooling for the townsfolk's children (systems/townSchool.js): who goes by
 * the family's wealth, the class hours, literacy that lets them write their
 * own letters, fees as real coin, a patron's gift, determinism, old saves.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownFamily } from '../systems/townFamily.js';
import { TownSchool } from '../systems/townSchool.js';
import { MailVoice } from '../systems/mailVoice.js';
import { Mail } from '../systems/mail.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf-8'));
const DATA = { romance: read('romance.json'), townsfolk: read('townsfolk.json'), townFamily: read('townFamily.json'), townSchool: read('townSchool.json'), house: read('house.json') };
const saved = DataLoader._gamedata;
const Y = 120;

function makeWorld(seed = 4242, type = 'town') {
    const towns = [{ name: 'Ashford', type, q: 5, r: 7 }];
    return {
        day: 1, baseYear: 853, generationParams: { seed }, activeEvents: [], towns,
        getSettlementViews: () => towns, getKingdom: () => null,
        getTile: (q, r) => { const s = towns.find(t => t.q === q && t.r === r); return s ? { q, r, settlement: s } : null; },
    };
}

function bare(world) {
    const s = world.towns[0];
    s.folk = { v: 1, q: s.q, r: s.r, n: 0, target: 0, tick: 0, people: [], annals: [], romance: { v: 1, n: 0, tick: 0, list: [], past: [], grudges: [] } };
    return s;
}

function person(folk, o) {
    const p = { id: folk.n++, first: o.first || `P${folk.n}`, last: 'Test', gender: o.gender || 'male', born: (o.day || 1) - (o.age || 25) * Y, died: null, cause: null,
        role: o.role || 'villager', traits: [], spouse: null, parents: o.parents || [], kids: [], away: null, log: [] };
    folk.people.push(p);
    delete folk._index;
    for (const id of p.parents) Townsfolk.get(folk, id).kids.push(p.id);
    return p;
}

/** A town of `n` families of a station, each with a child of 8; a priest. */
function town(world, role, n = 40) {
    const s = bare(world);
    const folk = s.folk;
    person(folk, { role: 'priest', age: 50 });
    const kids = [];
    for (let i = 0; i < n; i++) {
        const mum = person(folk, { gender: 'female', age: 32, role });
        const dad = person(folk, { gender: 'male', age: 34, role });
        mum.spouse = dad.id; dad.spouse = mum.id;
        kids.push(person(folk, { gender: i % 2 ? 'male' : 'female', age: 8, role: 'child', parents: [mum.id, dad.id] }));
    }
    return { s, folk, kids };
}

beforeEach(() => {
    DataLoader._gamedata = { ...DATA, townSchool: JSON.parse(JSON.stringify(DATA.townSchool)) };
});
afterAll(() => { DataLoader._gamedata = saved; });

describe('TownSchool — who goes', () => {
    it('the well-off school their children; the poor mostly put them to work; girls and boys alike', () => {
        const world = makeWorld();
        const rich = town(world, 'noble');
        const going = rich.kids.filter(k => TownSchool.kindFor(world, rich.s, rich.folk, k, 1)).length / rich.kids.length;
        const world2 = makeWorld();
        const poor = town(world2, 'beggar');
        const poorGoing = poor.kids.filter(k => TownSchool.kindFor(world2, poor.s, poor.folk, k, 1)).length / poor.kids.length;
        const world3 = makeWorld();
        const mid = town(world3, 'farmer', 120);
        const midGoing = mid.kids.filter(k => TownSchool.kindFor(world3, mid.s, mid.folk, k, 1));
        expect(going).toBeGreaterThan(0.9);
        expect(poorGoing).toBeLessThan(0.2);
        expect(midGoing.length / mid.kids.length).toBeGreaterThan(0.15);
        expect(midGoing.length / mid.kids.length).toBeLessThan(0.6);
        // (no rule by sex: both are among the schooled)
        expect(midGoing.some(k => k.gender === 'female') && midGoing.some(k => k.gender === 'male')).toBe(true);
        // The rich are often tutored at home
        expect(rich.kids.some(k => TownSchool.kindFor(world, rich.s, rich.folk, k, 1) === 'tutor')).toBe(true);
    });

    it('class is on school-day mornings, not in the afternoon nor on the day of rest', () => {
        const world = makeWorld();
        const { s, folk, kids } = town(world, 'merchant', 10);
        const k = kids.find(x => ['parish', 'grammar'].includes(TownSchool.kindFor(world, s, folk, x, 1)));
        expect(k).toBeTruthy();
        const day = 8; // (not a 7th day)
        const cls = TownSchool.inClass(world, s, folk, k, day, 9);
        expect(cls === null || cls.kind).toBeTruthy();
        let inClass = 0;
        for (let d = 1; d < 60; d++) if (TownSchool.inClass(world, s, folk, k, d, 9) && !TownSchool.inClass(world, s, folk, k, d, 9).truant) inClass++;
        expect(inClass).toBeGreaterThan(30);
        expect(TownSchool.inClass(world, s, folk, k, day, 15)).toBe(null);
        expect(TownSchool.inClass(world, s, folk, k, 14, 9)).toBe(null);
    });

    it('a pupil carries a satchel on school days, to class and home again; not on the day of rest, nor a child kept at work', () => {
        const world = makeWorld();
        const { s, folk, kids } = town(world, 'merchant', 10);
        const k = kids.find(x => ['parish', 'grammar'].includes(TownSchool.kindFor(world, s, folk, x, 8)));
        expect(k).toBeTruthy();
        expect(TownSchool.carriesSatchel(world, s, folk, k, 8, 7)).toBe(true);    // (on the way)
        expect(TownSchool.carriesSatchel(world, s, folk, k, 8, 10)).toBe(true);
        expect(TownSchool.carriesSatchel(world, s, folk, k, 8, 13)).toBe(true);   // (home again)
        expect(TownSchool.carriesSatchel(world, s, folk, k, 8, 20)).toBe(false);
        expect(TownSchool.carriesSatchel(world, s, folk, k, 14, 10)).toBe(false); // (the day of rest)
        const worker = kids.find(x => TownSchool.kindFor(world, s, folk, x, 8) === null);
        if (worker) expect(TownSchool.carriesSatchel(world, s, folk, worker, 8, 10)).toBe(false);
    });
});

describe('TownSchool — learning and coin', () => {
    it('schooled children grow up able to write their own letters; the unschooled need a scribe', () => {
        const world = makeWorld();
        const { s, folk, kids } = town(world, 'merchant', 12);
        const poorMum = person(folk, { gender: 'female', age: 30, role: 'beggar' });
        const poorKid = person(folk, { age: 8, role: 'child', parents: [poorMum.id] });
        TownFamily.state(folk, world, 0);
        for (let d = 10; d <= 9 * Y; d += 10) { world.day = d; TownFamily.catchUp(world, s, folk, d, []); }
        const schooled = kids.filter(k => k.school && k.school.yrs >= 4);
        expect(schooled.length).toBeGreaterThan(0);
        for (const k of schooled) {
            expect(k.literacy).toBeGreaterThanOrEqual(TownSchool.config().writeAt);
            expect(TownSchool.canWrite(k)).toBe(true);
            expect(k.log.some(e => e.k === 'schooled')).toBe(true);
        }
        if (!poorKid.school) {
            expect(poorKid.literacy).toBeLessThan(TownSchool.config().writeAt);
            expect(TownSchool.canWrite(poorKid)).toBe(false);
        }
        // mailVoice reads it: a schooled townsperson writes in their own hand
        const k = schooled[0];
        const W = MailVoice.writer({ name: 'Rowan', firstName: 'Rowan' }, world, { type: 'folk', key: `${folk.q},${folk.r}#${k.id}`, name: Townsfolk.name(k) }, { person: k, settlement: s });
        expect(W.literate).toBe(true);
        expect(W.scribe).toBeFalsy();
    });

    it('the season\'s fee goes from a parent\'s purse to the teacher\'s — no coin made or lost', () => {
        const world = makeWorld();
        const { s, folk, kids } = town(world, 'merchant', 10);
        TownFamily.state(folk, world, 0);
        for (const p of folk.people) Townsfolk.purse(folk, p, world, [20, 20]);
        const total = () => folk.people.reduce((t, p) => t + (p.purse || 0), 0) + (TownSchool.state(folk).fund || 0);
        const before = total();
        world.day = 30;
        TownFamily.catchUp(world, s, folk, 30, []);
        expect(total()).toBeCloseTo(before, 6);
        expect(TownSchool.state(folk).fees).toBeGreaterThan(0);
        const teacherCoin = folk.people.filter(p => p.role === 'priest' || p.teaches).reduce((t, p) => t + p.purse, 0);
        expect(teacherCoin).toBeGreaterThan(20);
        void kids;
    });

    it('a patron\'s gift puts more of the poor at school; the player\'s standing rises', () => {
        const world = makeWorld();
        const a = town(world, 'farmer', 80);
        const plain = a.kids.filter(k => TownSchool.kindFor(world, a.s, a.folk, k, 1)).length;
        const player = { gold: 500, name: 'Rowan', firstName: 'Rowan' };
        const r = TownSchool.donate(player, world, a.s, 100);
        expect(r.success).toBe(true);
        expect(player.gold).toBe(400);
        const funded = a.kids.filter(k => TownSchool.kindFor(world, a.s, a.folk, k, 1)).length;
        expect(funded).toBeGreaterThan(plain);
        expect(TownSchool.priest(a.folk).mem.disposition).toBeGreaterThan(50);
        // Sponsoring a poor child: at school, and grateful
        const kid = TownSchool.sponsorable(world, a.s, a.folk, 1)[0];
        expect(kid).toBeTruthy();
        const sp = TownSchool.sponsor(player, world, a.s, kid);
        expect(sp.success).toBe(true);
        expect(TownSchool.kindFor(world, a.s, a.folk, kid, 1)).toBeTruthy();
        expect(kid.mem.disposition).toBeGreaterThan(60);
    });
});

describe('TownSchool — determinism and old saves', () => {
    it('the same seed schools the same children', () => {
        const run = () => {
            const world = makeWorld(9);
            const { s, folk } = town(world, 'merchant', 15);
            TownFamily.state(folk, world, 0);
            for (let d = 10; d <= 3 * Y; d += 10) { world.day = d; TownFamily.catchUp(world, s, folk, d, []); }
            return JSON.stringify(folk.people.map(p => [p.school, p.literacy]));
        };
        expect(run()).toBe(run());
    });

    it('an old save: grown folk keep the old guess at their letters; children start learning', () => {
        const world = makeWorld();
        const { s, folk, kids } = town(world, 'merchant', 5);
        const adult = folk.people.find(p => p.role === 'merchant');
        TownFamily.state(folk, world, 0);
        world.day = 60;
        TownFamily.catchUp(world, s, folk, 60, []);
        expect(adult.literacy).toBeUndefined();
        expect(TownSchool.canWrite(adult)).toBe(null);
        expect(kids.some(k => k.school && k.school.lit > 0)).toBe(true);
    });
});

describe('TownSchool — founded by decree; the schooled grow up loyal', () => {
    it('the ruler founds a school: the crown pays, a schoolmaster is named, more of the town goes, year on year', () => {
        const world = makeWorld(4242, 'village');
        const a = town(world, 'farmer', 60);
        // A lettered townsman to be the master
        const clerk = person(a.folk, { role: 'merchant', age: 40 });
        const realm = { id: 3, name: 'Arden', treasury: 1000, stability: 50 };
        a.s.kingdom = 3;
        a.s.economy = { gold: 100 };
        world.getKingdom = id => (id === 3 ? realm : null);
        const stranger = { gold: 1000 };
        expect(TownSchool.canFound(stranger, world, a.s).ok).toBe(false);
        const ruler = { gold: 0, name: 'Rowan', throne: { ruling: { kingdomId: 3 } } };
        const before = a.kids.filter(k => TownSchool.kindFor(world, a.s, a.folk, k, 1)).length;
        const res = TownSchool.found(ruler, world, a.s);
        expect(res.success).toBe(true);
        expect(realm.treasury).toBe(700);
        expect(a.s.economy.gold).toBe(250);
        expect(TownSchool.state(a.folk).fund).toBe(150);
        expect(clerk.teaches).toBe('schoolmaster');
        const after = a.kids.filter(k => TownSchool.kindFor(world, a.s, a.folk, k, 1)).length;
        expect(after).toBeGreaterThan(before);
        // (a town school even in a village)
        expect(a.kids.some(k => TownSchool.kindFor(world, a.s, a.folk, k, 1) === 'grammar')).toBe(true);
        expect(TownSchool.foundedShare(a.folk, 1 + 3 * Y)).toBeGreaterThan(TownSchool.foundedShare(a.folk, 1));
        expect(TownSchool.found(ruler, world, a.s).success).toBe(false);
        expect(a.folk.annals.some(e => e.k === 'schoolFounded')).toBe(true);
        expect(Townsfolk.annalText(a.folk, a.folk.annals.find(e => e.k === 'schoolFounded'), world)).toMatch(/school was founded/);
    });

    it('a child the player schooled comes of age loyal: high regard, a memory, ready to serve', () => {
        const world = makeWorld();
        const { s, folk } = town(world, 'farmer', 4);
        const poorMum = person(folk, { gender: 'female', age: 30, role: 'beggar' });
        const kid = person(folk, { age: 13, role: 'child', parents: [poorMum.id] });
        kid.born = 1 - 13 * Y;
        const player = { gold: 100, name: 'Rowan', firstName: 'Rowan' };
        expect(TownSchool.sponsor(player, world, s, kid).success).toBe(true);
        TownFamily.state(folk, world, 0);
        vi.spyOn(Mail, 'recipients').mockImplementation(() => [{ key: 'folk:' + folk.q + ',' + folk.r + ':' + kid.id, type: 'folk', personId: kid.id, name: Townsfolk.name(kid), q: folk.q, r: folk.r }]);
        const sent = [];
        vi.spyOn(Mail, '_sendUnprompted').mockImplementation((...a) => { sent.push(a); return { id: 1 }; });
        for (let d = 10; d <= 3 * Y + 10; d += 10) { world.day = d; TownFamily.catchUp(world, s, folk, d, [], player); }
        vi.restoreAllMocks();
        expect(Townsfolk.age(kid, world.day)).toBeGreaterThanOrEqual(16);
        expect(kid.loyal).toBe('player');
        expect(kid.mem.disposition).toBeGreaterThanOrEqual(85);
        expect(kid.log.some(e => e.k === 'sponsoredGrown')).toBe(true);
        expect(kid.literacy).toBeGreaterThan(10);
        // ...and wrote to thank the player, in their own hand (systems/mail.js)
        expect(sent.some(c => c[3] === 'grateful')).toBe(true);
        expect(Townsfolk.biographyLine(folk, kid, kid.log.find(e => e.k === 'sponsoredGrown'), world)).toMatch(/loyal/);
    });
});

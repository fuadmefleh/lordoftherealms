/**
 * Literacy (systems/literacy.js): grown folk given their letters once and
 * keeping them, a town's rate measured from its folk (or estimated and
 * drifting), its yearly history, every effect neutral until a town is
 * reckoned, endowing a school (materials, a schoolmaster from real folk,
 * monthly upkeep, closing unpaid), the player's own letters (books, scribes,
 * lessons), the heirs', letters read aloud, broadsheets.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownSchool } from '../systems/townSchool.js';
import { Literacy } from '../systems/literacy.js';
import { Books } from '../systems/books.js';
import { Whispers } from '../systems/whispers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf-8'));
const DATA = {
    romance: read('romance.json'), townsfolk: read('townsfolk.json'), townFamily: read('townFamily.json'), townSchool: read('townSchool.json'),
    house: read('house.json'), literacy: read('literacy.json'), gossip: read('gossip.json'), books: read('books.json'),
};
const saved = DataLoader._gamedata;
const savedGossip = DataLoader.gossip;
const Y = 120;

function makeWorld(seed = 4242, types = ['town']) {
    const towns = types.map((type, i) => ({ name: `Town${i}`, type, q: 5 + i * 2, r: 7, kingdom: 1, population: 1000 }));
    return {
        day: 1, generationParams: { seed }, activeEvents: [], towns, width: 50,
        getSettlementViews: () => towns, getAllSettlements: () => towns, getKingdom: () => null, kingdoms: [],
        getTile: (q, r) => { const s = towns.find(t => t.q === q && t.r === r); return s ? { q, r, settlement: s } : null; },
    };
}

function folkOf(s) {
    s.folk = { v: 1, q: s.q, r: s.r, n: 0, target: 0, tick: 0, people: [], annals: [], romance: { v: 1, n: 0, tick: 0, list: [], past: [], grudges: [] } };
    return s.folk;
}

function person(folk, o) {
    const p = { id: folk.n++, first: o.first || `P${folk.n}`, last: 'Test', gender: o.gender || 'male', born: (o.day || 1) - (o.age || 30) * Y, died: null, cause: null,
        role: o.role || 'villager', traits: [], spouse: null, parents: o.parents || [], kids: [], away: null, log: [] };
    if (o.literacy != null) p.literacy = o.literacy;
    folk.people.push(p);
    delete folk._index;
    return p;
}

function populate(folk, roles) {
    for (const [role, n] of Object.entries(roles)) for (let i = 0; i < n; i++) person(folk, { role });
}

function makePlayer(o = {}) {
    return { name: 'Ada Vell', firstName: 'Ada', gold: 1000, inventory: {}, intelligence: 5, q: 5, r: 7, children: [], ...o };
}

beforeEach(() => {
    DataLoader._gamedata = JSON.parse(JSON.stringify(DATA));
    DataLoader.gossip = DataLoader._gamedata.gossip;
    Utils.setSeed(7);
});
afterAll(() => { DataLoader._gamedata = saved; DataLoader.gossip = savedGossip; });

describe('Literacy — the people', () => {
    it('grown folk the school book never saw are given letters once, by their trade, and keep them', () => {
        const world = makeWorld();
        const s = world.towns[0];
        const folk = folkOf(s);
        populate(folk, { priest: 10, merchant: 30, farmer: 60 });
        Literacy.seedFolk(world, s, 1);
        const lit = r => folk.people.filter(p => p.role === r && p.literacy >= 50).length / folk.people.filter(p => p.role === r).length;
        expect(folk.people.every(p => typeof p.literacy === 'number')).toBe(true);
        expect(lit('priest')).toBeGreaterThanOrEqual(0.6);
        expect(lit('merchant')).toBeGreaterThan(lit('farmer'));
        expect(lit('farmer')).toBeLessThan(0.25);
        // Kept on the person: seeding again changes nothing; a person moving town takes theirs along
        const before = folk.people.map(p => p.literacy);
        Literacy.seedFolk(world, s, 500);
        expect(folk.people.map(p => p.literacy)).toEqual(before);
    });

    it('is deterministic: the same seed, the same letters', () => {
        const a = makeWorld(99); const b = makeWorld(99);
        const fa = folkOf(a.towns[0]); const fb = folkOf(b.towns[0]);
        populate(fa, { villager: 40 }); populate(fb, { villager: 40 });
        Literacy.seedFolk(a, a.towns[0], 1); Literacy.seedFolk(b, b.towns[0], 1);
        expect(fa.people.map(p => p.literacy)).toEqual(fb.people.map(p => p.literacy));
    });

    it('leaves a schooled child, and one born after the school book opened, to TownSchool', () => {
        const world = makeWorld();
        const s = world.towns[0];
        const folk = folkOf(s);
        const schooled = person(folk, { age: 20 });
        schooled.school = { yrs: 5, lit: 60, kind: 'parish' };
        const young = person(folk, { age: 17, day: 3000 });
        TownSchool.state(folk).since = 1;
        Literacy.seedFolk(world, s, 3000);
        expect(schooled.literacy).toBeUndefined();
        expect(young.literacy).toBeUndefined();
    });
});

describe('Literacy — the town', () => {
    it('measures the rate from its folk and keeps a yearly history', () => {
        const world = makeWorld();
        const s = world.towns[0];
        const folk = folkOf(s);
        populate(folk, { villager: 20 });
        folk.people.forEach((p, i) => { p.literacy = i < 5 ? 80 : 10; });
        expect(Literacy.rate(world, s)).toBeNull();
        Literacy.refresh(world, s, 10);
        expect(Literacy.rate(world, s)).toBeCloseTo(0.25, 5);
        expect(s.letters.src).toBe('folk');
        folk.people.forEach((p, i) => { p.literacy = i < 10 ? 80 : 10; });
        Literacy.refresh(world, s, 10 + Y * 30);
        expect(Literacy.rate(world, s)).toBeCloseTo(0.5, 5);
        expect(s.letters.hist.length).toBe(2);
        expect(Literacy.rateYearsAgo(s, 30, 10 + Y * 30)).toBeCloseTo(0.25, 5);
        world.day = 10 + Y * 30;
        expect(Literacy.infoLine(world, s)).toMatch(/50 in 100 read & write \(↑ from 25\)/);
    });

    it('estimates a town with no roster by its size, and drifts toward a new target', () => {
        const world = makeWorld(1, ['village', 'capital']);
        const [v, c] = world.towns;
        Literacy.refresh(world, v, 1);
        Literacy.refresh(world, c, 1);
        expect(Literacy.rate(world, c)).toBeGreaterThan(Literacy.rate(world, v));
        // A school founded: the estimate climbs over the years, not at once
        folkOf(v).school = { v: 1, fund: 0, founded: { d: 1 } };
        const was = Literacy.rate(world, v);
        Literacy.refresh(world, v, 1 + Y);
        const year1 = Literacy.rate(world, v);
        Literacy.refresh(world, v, 1 + Y * 20);
        expect(year1).toBeGreaterThan(was);
        expect(Literacy.rate(world, v)).toBeGreaterThan(year1);
        expect(Literacy.rate(world, v)).toBeLessThanOrEqual(Literacy.target(world, v) + 1e-9);
    });

    it('every effect is neutral in a town not yet reckoned; lettered towns pay and read more', () => {
        const world = makeWorld(1, ['town', 'town']);
        const [a, b] = world.towns;
        expect(Literacy.taxFactor(world, a)).toBe(1);
        expect(Literacy.noticeFactor(world, a)).toBe(1);
        expect(Literacy.bankTrust(world, a)).toBe(0);
        expect(Literacy.lawStabilityFactor(world, 1)).toBe(1);
        a.letters = { rate: 0.02, hist: [] };
        b.letters = { rate: 0.6, hist: [] };
        expect(Literacy.taxFactor(world, b)).toBeGreaterThan(Literacy.taxFactor(world, a));
        expect(Literacy.noticeFactor(world, b)).toBeGreaterThan(1);
        expect(Literacy.oralDistort(world, a)).toBeGreaterThan(Literacy.oralDistort(world, b));
        expect(Literacy.writtenSpread(world, b)).toBeGreaterThan(Literacy.writtenSpread(world, a));
        expect(Literacy.bankTrust(world, b)).toBeGreaterThan(0);
        expect(Literacy.lawStabilityFactor(world, 1)).toBeLessThan(1);
    });

    it('the church tithes and the richest guild pays into the school fund once a year', () => {
        const world = makeWorld(1, ['city']);
        const s = world.towns[0];
        s.economy = { gold: 500 };
        s.guilds = { bakers: { name: 'Bakers\' Guild', treasury: 200 }, smiths: { name: 'Smiths\' Guild', treasury: 80 } };
        const folk = folkOf(s);
        person(folk, { role: 'priest', age: 50 });
        populate(folk, { villager: 10 });
        Literacy.refresh(world, s, 1);
        Literacy.refresh(world, s, 1 + Y);
        const sc = folk.school;
        expect(sc.church).toBeTruthy();
        expect(sc.guild && sc.guild.id).toBe('bakers');
        expect(s.economy.gold).toBeLessThan(500);
        expect(s.guilds.bakers.treasury).toBeLessThan(200);
        expect(sc.fund).toBeGreaterThan(0);
    });
});

describe('Literacy — endowing a school', () => {
    function setup() {
        const world = makeWorld();
        const s = world.towns[0];
        s.economy = { gold: 100 };
        const folk = folkOf(s);
        const scholar = person(folk, { role: 'merchant', age: 40, literacy: 85, first: 'Orm' });
        person(folk, { role: 'farmer', age: 40, literacy: 5 });
        const player = makePlayer({ inventory: { planks: 30, stone: 20 } });
        return { world, s, folk, scholar, player };
    }

    it('takes coin and materials, hires a real schoolmaster, makes it a town school', () => {
        const { world, s, folk, scholar, player } = setup();
        const t = Literacy.endowTerms(player, world, s);
        expect(t.ok).toBe(true);
        expect(t.candidates.map(c => c.id)).toEqual([scholar.id]);
        const res = Literacy.endow(player, world, s, scholar.id);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(1000 - t.total);
        expect(player.inventory.planks).toBe(10);
        expect(player.inventory.stone).toBe(5);
        expect(folk.school.master).toBe(scholar.id);
        expect(scholar.teaches).toBe('schoolmaster');
        expect(folk.school.founded.payer).toBe('patron');
        expect(TownSchool.foundedShare(folk, world.day)).toBeGreaterThan(0);
        expect(s.economy.gold).toBeGreaterThan(100);
        expect(player.literacy.schools).toEqual(['5,7']);
        expect(Literacy.endowTerms(player, world, s).ok).toBe(false);
    });

    it('refuses with no one lettered to teach', () => {
        const { world, s, folk, player } = setup();
        folk.people[0].literacy = 20;
        const t = Literacy.endowTerms(player, world, s);
        expect(t.ok).toBe(false);
        expect(t.reason).toMatch(/lettered/);
    });

    it('pays the master and the fund monthly from the purse; unpaid past grace, it closes', () => {
        const { world, s, folk, scholar, player } = setup();
        Literacy.endow(player, world, s, scholar.id);
        const out = { notices: [] };
        const purseBefore = Townsfolk.purse(folk, scholar, world);
        const fundBefore = folk.school.fund;
        world.day = 31;
        const gold = player.gold;
        Literacy._upkeep(world, player, out);
        expect(player.gold).toBe(gold - 12);
        expect(scholar.purse).toBe(purseBefore + 8);
        expect(folk.school.fund).toBe(fundBefore + 4);
        player.gold = 0;
        for (const d of [61, 91, 121]) { world.day = d; Literacy._upkeep(world, player, out); }
        expect(folk.school.endowed.closed).toBe(121);
        expect(folk.school.founded).toBeUndefined();
        expect(player.literacy.schools).toEqual([]);
        expect(out.notices.some(n => n.title === 'A School Closes')).toBe(true);
    });
});

describe('Literacy — the player and the heirs', () => {
    it('a new life is reckoned from wits and station; a wanderer reads haltingly and needs a scribe', () => {
        const wanderer = makePlayer();
        expect(Literacy.level(wanderer)).toBeNull();
        expect(Literacy.canWrite(wanderer)).toBe(true); // (not yet reckoned: as before)
        Literacy.ensurePlayer(wanderer);
        expect(Literacy.level(wanderer)).toBe(40);
        expect(Literacy.canRead(wanderer)).toBe(true);
        expect(Literacy.canWrite(wanderer)).toBe(false);
        expect(Literacy.scribeFee(wanderer)).toBeGreaterThan(0);
        const lord = makePlayer({ scenario: { start: { kind: 'great_lord' } } });
        Literacy.ensurePlayer(lord);
        expect(Literacy.canWrite(lord)).toBe(true);
        // Another life: reckoned afresh
        wanderer.name = 'Bran Holt';
        expect(Literacy.level(wanderer)).toBeNull();
    });

    it('one who cannot read cannot read a book; lessons with the town teacher help', () => {
        const world = makeWorld();
        const s = world.towns[0];
        const folk = folkOf(s);
        const teacher = person(folk, { role: 'priest', age: 45, literacy: 95 });
        const p = makePlayer({ intelligence: 1 });
        Literacy.ensurePlayer(p);
        expect(Literacy.canRead(p)).toBe(false);
        const r = Books.read(p, world, { settlementType: 'town' });
        expect(r.counted).toBe(false);
        expect(r.cannotRead).toBe(true);
        const lesson = Literacy.takeLesson(p, world, s);
        expect(lesson.success).toBe(true);
        expect(Literacy.level(p)).toBeGreaterThan(20);
        expect(teacher.purse).toBeGreaterThan(0);
        expect(Literacy.takeLesson(p, world, s).success).toBe(false); // once a day
        world.day = 2;
        expect(Literacy.takeLesson(p, world, s).success).toBe(true);
    });

    it('children learn faster with a tutor and a learning focus; the heir carries it into rule', () => {
        const p = makePlayer({ children: [
            { id: 1, firstName: 'Tam', age: 8, isAlive: true, upbringing: { focus: 'learning', tutor: { quality: 1.5 } } },
            { id: 2, firstName: 'Ivo', age: 8, isAlive: true, upbringing: { focus: 'martial', tutor: null } },
        ] });
        Literacy.ensurePlayer(p);
        Literacy._heirs(p, makeWorld(), Y * 4);
        const [tam, ivo] = p.children;
        expect(tam.literacy).toBeGreaterThan(ivo.literacy);
        expect(tam.literacy).toBeGreaterThan(50);
        p.name = 'Tam Vell';
        Literacy.takeHeir(p, tam);
        expect(Literacy.level(p)).toBe(Math.round(tam.literacy));
    });
});

describe('Literacy — letters read aloud', () => {
    it('a letter to one who cannot read waits for the priest, who may tell the town', () => {
        const world = makeWorld();
        const s = world.towns[0];
        const folk = folkOf(s);
        const priest = person(folk, { role: 'priest', age: 50, literacy: 95, first: 'Odo' });
        const farmer = person(folk, { role: 'farmer', age: 30, literacy: 5, first: 'Gil' });
        const lettered = person(folk, { role: 'merchant', age: 30, literacy: 80 });
        const to = { type: 'folk', key: 'folk:5,7:1', name: 'Gil Test', q: 5, r: 7, place: 'Town0' };
        expect(Literacy.recipientReads(world, to, { person: lettered })).toBe(true);
        expect(Literacy.readerFor(world, s, farmer)).toBe(priest);
        const L = { id: 1, kind: 'love', arriveDay: 1 };
        const waits = Literacy.atDoor(world, makePlayer(), L, to, { person: farmer });
        expect(L.aloud.by).toBe('Father Odo');
        expect(waits).toBe(true);
        expect(L.arriveDay).toBeGreaterThan(1);
        // At the door already: not delayed again
        expect(Literacy.atDoor(world, makePlayer(), L, to, { person: farmer })).toBe(false);
        // Over many letters, some leak (a rumour); a priest keeps more confidences than not
        const player = makePlayer({ gossip: undefined });
        let leaks = 0;
        for (let i = 0; i < 60; i++) {
            const M = { id: i, kind: 'threat', aloud: { by: 'Gil\'s neighbour', role: 'villager', wait: 2 } };
            const note = Literacy.afterAloud(world, player, M, to, { notices: [] });
            expect(note).toMatch(/read it aloud/);
            if (M.aloud.leaked) leaks++;
        }
        expect(leaks).toBeGreaterThan(5);
        expect(leaks).toBeLessThan(55);
        expect(player.gossip.rumors.some(r => r.type === 'letter_aloud')).toBe(true);
    });
});

describe('Literacy — broadsheets', () => {
    it('a tale printed and posted costs the printer, runs hotter and is marked written', () => {
        const world = makeWorld(3, ['town', 'town', 'town']);
        world.towns.forEach(t => { t.letters = { rate: 0.5, hist: [] }; });
        const player = makePlayer();
        const st = Whispers.state(player);
        const sc = { id: 1, kind: 'bastard', subject: { type: 'ruler', name: 'King Ulf', kingdomId: 1 }, kingdomId: 1, state: 'live', spreadTo: ['5,7'], heat: 10, extra: 0, born: 1, ends: 200 };
        st.scandals.push(sc);
        const t = Literacy.pamphletTerms(player, world, 1, 5, 7);
        expect(t.ok).toBe(true);
        const res = Literacy.pamphlet(player, world, 1, 5, 7);
        expect(res.ok).toBe(true);
        expect(player.gold).toBe(1000 - t.cost);
        expect(sc.written).toBeTruthy();
        expect(sc.extra).toBeGreaterThan(0);
        expect(Literacy.pamphletTerms(player, world, 1, 5, 7).ok).toBe(false);
    });
});

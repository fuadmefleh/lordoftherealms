// Names: no two living people of a town answer to the same full name across
// decades of births and arrivals; a child never takes a living sibling's
// name; a House child may be named for a dead forebear (never a living one).
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Names } from '../core/names.js';
import { Utils } from '../core/utils.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Relationships } from '../systems/relationships.js';

const Y = 120;

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

function makeWorld(culture, day = 1) {
    const town = { name: 'Ashford', type: 'city', q: 5, r: 7, culture };
    return {
        day, baseYear: 853, generationParams: { seed: 777 }, activeEvents: [],
        town, getSettlementViews: () => [town], getKingdom: () => null,
    };
}

function dupes(folk) {
    const seen = new Map();
    for (const p of folk.people) {
        if (p.died != null) continue;
        const n = `${p.first} ${p.last}`;
        seen.set(n, (seen.get(n) || 0) + 1);
    }
    return [...seen].filter(([, c]) => c > 1).map(([n]) => n);
}

function siblingClash(folk) {
    for (const p of folk.people) {
        if (p.died != null) continue;
        const kids = p.kids.map(id => Townsfolk.get(folk, id)).filter(k => k && k.died == null);
        const firsts = kids.map(k => k.first);
        if (new Set(firsts).size !== firsts.length) return `${Townsfolk.name(p)}: ${firsts.join(', ')}`;
    }
    return null;
}

describe('Names.pickFree', () => {
    it('walks on from the drawn name past the taken ones, and falls back when all are taken', () => {
        const pool = ['Ada', 'Bram', 'Cora', 'Dag'];
        expect(Names.pickFree(pool, 0.3, () => false)).toBe('Bram');
        expect(Names.pickFree(pool, 0.3, n => n === 'Bram' || n === 'Cora')).toBe('Dag');
        expect(Names.pickFree(pool, 0.9, n => n !== 'Ada')).toBe('Ada');
        expect(Names.pickFree(pool, 0.6, () => true)).toBe('Cora');
        expect(Names.pickFree([], 0.5, () => false)).toBe(null);
    });

    it('merges pools, each name once', () => {
        expect(Names.merge(['A', 'B'], null, ['B', 'C'])).toEqual(['A', 'B', 'C']);
    });
});

describe('Townsfolk names', () => {
    for (const culture of [undefined, 'Nordic', 'Imperial']) {
        it(`no two living folk of a ${culture || 'common'} town share a full name over decades`, () => {
            const world = makeWorld(culture);
            const folk = Townsfolk.seed(world.town, world);
            expect(folk.people.length).toBeGreaterThan(20);
            expect(dupes(folk)).toEqual([]);
            let births = 0;
            for (let y = 0; y < 30; y++) {
                for (let d = 0; d < Y; d++) {
                    world.day++;
                    Townsfolk.processDay(world);
                }
                expect(dupes(folk)).toEqual([]);
                expect(siblingClash(folk)).toBe(null);
                births = folk.people.filter(p => p.parents.length && p.born > 1).length;
            }
            expect(births).toBeGreaterThan(5);
        });
    }

    it('a first roster of NPCs all called the same is given names of its own', () => {
        const world = makeWorld(undefined);
        const npcs = [];
        for (let i = 0; i < 16; i++) npcs.push({ id: i, type: 'villager', name: 'Ada', lastName: 'Stone', gender: 'female', age: 30 });
        Townsfolk.attach(world.town, world, npcs, { q: 5, r: 7, target: 16 });
        expect(dupes(world.town.folk)).toEqual([]);
    });

    it('a child is never given a living sibling\'s name, and may be named for a dead grandparent', () => {
        const world = makeWorld('Nordic');
        const folk = Townsfolk.seed(world.town, world);
        const mother = folk.people.find(p => p.gender === 'female' && p.died == null);
        const father = folk.people.find(p => p.gender === 'male' && p.died == null && p !== mother);
        let s = 5;
        const rng = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
        for (let i = 0; i < 12; i++) Townsfolk._born(folk, mother, father, world.day, rng, true);
        const firsts = mother.kids.map(id => Townsfolk.get(folk, id)).filter(k => k.gender === 'male').map(k => k.first);
        expect(new Set(firsts).size).toBe(firsts.length);
        expect(dupes(folk)).toEqual([]);
    });
});

describe('House children names', () => {
    const player = () => ({
        name: 'Harald Stormborn', firstName: 'Harald', gender: 'male', children: [],
        house: { lineage: { people: {
            g1: { id: 'g1', name: 'Eirik Stormborn', first: 'Eirik', gender: 'male', kind: 'ruler', alive: false, died: 10 },
            g2: { id: 'g2', name: 'Leif Stormborn', first: 'Leif', gender: 'male', kind: 'blood', alive: true, died: null },
        } } },
    });

    it('never a living kinsman\'s name, and sometimes a dead forebear\'s', () => {
        const pool = ['Harald', 'Leif', 'Bjorn', 'Ivar', 'Eirik'];
        Utils.setSeed(1);
        let namesakes = 0;
        for (let i = 0; i < 200; i++) {
            const p = player();
            p.children.push({ firstName: 'Bjorn', isAlive: true });
            const { firstName, namedFor } = Relationships._childName(p, { firstName: 'Ivar' }, pool, 'male');
            expect(['Harald', 'Leif', 'Bjorn', 'Ivar']).not.toContain(firstName);
            if (namedFor) { namesakes++; expect(namedFor.id).toBe('g1'); expect(firstName).toBe('Eirik'); }
        }
        expect(namesakes).toBeGreaterThan(10);
        expect(namesakes).toBeLessThan(120);
    });

    it('a dead sibling\'s name may come back; a living one\'s never', () => {
        Utils.setSeed(3);
        const pool = ['Asa', 'Sif'];
        const p = { name: 'Freya', firstName: 'Freya', children: [{ firstName: 'Asa', isAlive: true }, { firstName: 'Sif', isAlive: false }] };
        for (let i = 0; i < 20; i++) expect(Relationships._childName(p, null, pool, 'female').firstName).toBe('Sif');
    });
});

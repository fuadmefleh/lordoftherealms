import { describe, it, expect } from 'vitest';
import { Townsfolk } from '../systems/townsfolk.js';
import { NpcFamily } from '../systems/npcFamily.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Utils } from '../core/utils.js';

const Y = 120;

function makeWorld(day = 1) {
    const town = { name: 'Ashford', type: 'town', q: 5, r: 7 };
    const other = { name: 'Greymoor', type: 'village', q: 20, r: 3 };
    return {
        day, baseYear: 853, generationParams: { seed: 4242 }, activeEvents: [],
        town, getSettlementViews: () => [town, other], getKingdom: () => null,
    };
}

function seedNpcs() {
    const types = { villager: 6, merchant: 3, guard: 2, farmer: 2, priest: 1, blacksmith_npc: 1, child: 3, traveler: 2 };
    const npcs = [];
    let id = 0;
    for (const [type, n] of Object.entries(types)) for (let i = 0; i < n; i++) npcs.push({ id: id++, type, name: 'Ada' });
    let s = 99;
    NpcFamily.generateFamilies(npcs, () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; });
    return npcs;
}

/** Advance day by day, running the daily hook, until `to`. */
function liveUntil(world, to) {
    while (world.day < to) {
        world.day++;
        Townsfolk.processDay(world);
    }
}

function setup() {
    const world = makeWorld(1);
    const npcs = seedNpcs();
    const shown = Townsfolk.attach(world.town, world, npcs, { q: 5, r: 7, target: 18 });
    return { world, npcs, shown, folk: world.town.folk };
}

describe('Townsfolk', () => {
    it('builds a roster from the first visit, leaving travelers out', () => {
        const { folk, shown } = setup();
        expect(folk.people.length).toBe(18);
        expect(folk.people.every(p => p.role !== 'traveler')).toBe(true);
        expect(shown.length).toBe(18);
        // Children are young enough for the parents they were given
        for (const p of folk.people) {
            for (const id of p.parents) {
                const par = Townsfolk.get(folk, id);
                expect(par.born).toBeLessThan(p.born - 16 * Y);
                expect(par.born).toBeGreaterThanOrEqual(p.born - (par.gender === 'female' ? 40 : 50) * Y);
            }
        }
    });

    it('ages people: a child met now is grown ten years on', () => {
        const { world, folk } = setup();
        const child = folk.people.find(p => p.role === 'child');
        const age0 = Townsfolk.age(child, world.day);
        liveUntil(world, 1 + 10 * Y);
        expect(Townsfolk.age(child, world.day)).toBe(age0 + 10);
        if (child.died == null) expect(child.role).not.toBe('child');
    });

    it('lives out births, deaths and weddings over the years, keeping the town alive', () => {
        const { world, folk } = setup();
        liveUntil(world, 1 + 100 * Y);
        const kinds = new Set(folk.annals.map(a => a.k));
        expect(kinds.has('died')).toBe(true);
        expect(kinds.has('born')).toBe(true);
        const here = Townsfolk.residents(folk).length;
        expect(here).toBeGreaterThan(18 * 0.5);
        expect(here).toBeLessThan(18 * 2.5);
        // Everyone of the first generation is gone after a century
        expect(folk.people.filter(p => p.id < 18 && p.died == null && !p.away).length).toBe(0);
    });

    it('is deterministic and draws nothing from the shared RNG', () => {
        Utils.setSeed(1234);
        const expected = Utils.random();
        const a = setup();
        Utils.setSeed(1234);
        liveUntil(a.world, 1 + 20 * Y);
        expect(Utils.random()).toBe(expected);
        const b = setup();
        liveUntil(b.world, 1 + 20 * Y);
        expect(JSON.stringify(b.folk.people)).toBe(JSON.stringify(a.folk.people));
    });

    it('catches up lazily on a later visit the same as living day by day', () => {
        const a = setup();
        liveUntil(a.world, 1 + 7 * Y);
        const b = setup();
        b.world.day = 1 + 7 * Y;
        Townsfolk.attach(b.world.town, b.world, [], { q: 5, r: 7, target: 18 });
        expect(b.folk.people.map(p => [p.first, p.died, p.role])).toEqual(a.folk.people.map(p => [p.first, p.died, p.role]));
    });

    it('keeps dialog memory on the person across visits and remembers the player', () => {
        const { world, folk } = setup();
        const child = folk.people.find(p => p.role === 'child');
        const npc = Townsfolk.dress({ id: 0 }, child, folk, world);
        NpcDisposition.getMemory(npc).timesSpoken = 3;
        Townsfolk.noteSeen(npc, world.day);
        expect(child.mem.timesSpoken).toBe(3);

        liveUntil(world, 1 + 12 * Y);
        if (child.died != null) return;
        const again = Townsfolk.dress({ id: 5 }, child, folk, world);
        expect(NpcDisposition.getMemory(again).timesSpoken).toBe(3);
        expect(again.age).toBe(child.seen.age + 12);
        const line = Townsfolk.reunionLine(again, world);
        expect(line).toMatch(/I was only a child of/);
    });

    it('sends word of the death of someone the player knew', () => {
        const { world, folk } = setup();
        for (const p of folk.people) p.mem = { timesSpoken: 1, disposition: 50 };
        const news = [];
        while (world.day < 1 + 60 * Y) {
            world.day++;
            news.push(...Townsfolk.processDay(world));
        }
        const deaths = news.filter(n => n.kind === 'died');
        expect(deaths.length).toBeGreaterThan(0);
        expect(deaths[0].text).toMatch(/died in the (spring|summer|autumn|winter) of \d+, aged \d+/);
    });

    it('tells the family story, the dead included', () => {
        const { world, folk } = setup();
        liveUntil(world, 1 + 40 * Y);
        const widow = folk.people.find(p => p.died == null && p.log.some(e => e.k === 'widowed'));
        if (!widow) return;
        const npc = Townsfolk.dress({ id: 0 }, widow, folk, world);
        expect(Townsfolk.familyLines(npc, world)).toMatch(/died in the/);
    });

    it('links the kin of NPCs on the map by their map ids', () => {
        const { world, folk } = setup();
        const npcs = Townsfolk.residents(folk).map((p, i) => Townsfolk.dress({ id: i }, p, folk, world));
        Townsfolk.linkFamilies(npcs);
        const couple = npcs.find(n => n.spouseId != null);
        expect(couple).toBeTruthy();
        expect(npcs.find(n => n.id === couple.spouseId).spouseId).toBe(couple.id);
        NpcFamily.adoptFamilies(npcs, () => 0.5);
        expect(NpcFamily.getFamilyGroup(couple)).toBeTruthy();
    });
});

describe('Townsfolk — told by a townsperson', () => {
    it('speaks of kin as kin and leaves out their own news', () => {
        const { world, folk } = setup();
        liveUntil(world, 1 + 30 * Y);
        folk.prevVisit = -1;
        const speaker = folk.people.find(p => p.died == null && p.parents.some(id => Townsfolk.get(folk, id).died != null));
        if (!speaker) return;
        const lines = Townsfolk.townNews(folk, world, 60, speaker);
        expect(lines.some(l => /^My (mother|father) /.test(l))).toBe(true);
        expect(lines.some(l => l.includes(Townsfolk.name(speaker)))).toBe(false);
    });

    it('waits a while after a wedding before the first child', () => {
        const { world, folk } = setup();
        liveUntil(world, 1 + 40 * Y);
        for (const e of folk.annals.filter(a => a.k === 'born')) {
            const mother = Townsfolk.get(folk, e.b);
            const wed = folk.annals.find(a => a.k === 'wed' && (a.a === mother.id || a.b === mother.id) && a.d <= e.d);
            if (wed) expect(e.d - wed.d).toBeGreaterThanOrEqual(0.75 * Y);
        }
    });
});

describe('Townsfolk — the player\'s journal', () => {
    it('lists the people the player has spoken with, with their story and the latest word', () => {
        const { world, folk } = setup();
        for (const p of folk.people.slice(0, 8)) p.mem = { timesSpoken: 2, disposition: 70 };
        liveUntil(world, 1 + 30 * Y);
        const known = Townsfolk.acquaintances(world);
        expect(known.length).toBe(8);
        expect(known.every(a => a.town === 'Ashford')).toBe(true);
        const order = { here: 0, away: 1, dead: 2 };
        for (let i = 1; i < known.length; i++) expect(order[known[i].status.kind]).toBeGreaterThanOrEqual(order[known[i - 1].status.kind]);
        const dead = known.find(a => a.status.kind === 'dead');
        if (dead) {
            expect(dead.status.text).toMatch(/^Died in the/);
            expect(dead.lines[dead.lines.length - 1]).toMatch(/^Died in the/);
        }
        const word = Townsfolk.recentWord(world, 5);
        expect(word.length).toBeGreaterThan(0);
        for (let i = 1; i < word.length; i++) expect(word[i].d).toBeLessThanOrEqual(word[i - 1].d);
    });
});

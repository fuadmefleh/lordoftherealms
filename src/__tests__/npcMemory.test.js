// Long-term NPC memory (systems/npcMemory.js): townsfolk remember what the player's
// House did to them and their kin, for years and across generations; lords route to
// NPCLords' memory; the memory moves prices, work, testimony and unrest.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData } from './playtest/harness.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { TownJobs } from '../systems/townJobs.js';
import { NPCLords } from '../world/npcLords.js';

beforeAll(async () => { await loadData(); });

const P = (id, first, gender, o = {}) => ({ id, first, last: 'Miller', gender, born: -3000, died: null, role: 'villager', parents: [], kids: [], spouse: null, away: null, log: [], ...o });

/** Bran (grandfather) + Elsa → Hal (father) + Una → Wren (child, born later). */
function makeWorld(day = 100) {
    const bran = P(0, 'Bran', 'male', { spouse: 1, kids: [2] });
    const elsa = P(1, 'Elsa', 'female', { spouse: 0, kids: [2] });
    const hal = P(2, 'Hal', 'male', { parents: [0, 1], spouse: 3, kids: [4] });
    const una = P(3, 'Una', 'female', { spouse: 2, kids: [4], last: 'Ash' });
    const wren = P(4, 'Wren', 'female', { parents: [2, 3], born: 0 });
    const folk = { q: 3, r: 4, n: 5, people: [bran, elsa, hal, una, wren], annals: [] };
    const town = { name: 'Ashford', q: 3, r: 4, kingdom: 0, folk };
    const world = {
        day, generationParams: { seed: 1 },
        getTile: (q, r) => (q === 3 && r === 4 ? { settlement: town } : null),
        getSettlementViews: () => [town],
        getKingdom: () => null,
    };
    return { world, folk, town, bran, elsa, hal, una, wren };
}

function makePlayer(name = 'Aldric Voss', gen = 1) {
    return { name, firstName: name.split(' ')[0], gender: 'male', gold: 1000, house: { name: 'House Voss', generation: gen } };
}

describe('NpcMemory — remembering', () => {
    it('stores an episode on the person and recalls it with the actor and victim words', () => {
        const { world, folk, hal } = makeWorld();
        const player = makePlayer();
        const ep = NpcMemory.remember(world, { folk, person: hal }, { kind: 'alms', player });
        expect(ep).toBeTruthy();
        expect(hal.nm).toHaveLength(1);
        const [m] = NpcMemory.recall(world, `3,4#${hal.id}`, { about: player });
        expect(m.kind).toBe('alms');
        expect(m.actor).toBe('you');
        expect(m.text).toMatch(/^You gave me coin/);
        expect(m.weight).toBeGreaterThan(0);
    });

    it('fades by half-life, but the strongest are kept forever', () => {
        const { world, folk, hal } = makeWorld();
        const player = makePlayer();
        NpcMemory.remember(world, { folk, person: hal }, { kind: 'gift', player });
        NpcMemory.remember(world, { folk, person: hal }, { kind: 'assaulted', player });
        world.day = 100 + 120 * 80; // eighty years on
        const left = NpcMemory.recall(world, { folk, person: hal }, { about: player });
        expect(left.map(m => m.kind)).toEqual(['assaulted']);
        expect(left[0].raw).toBeCloseTo(-14 * NpcMemory.config().foreverFloor, 1);
    });

    it('tells the victim\'s family, each naming their kin', () => {
        const { world, folk, bran, elsa, hal, wren } = makeWorld();
        const player = makePlayer();
        const told = NpcMemory.rememberKin(world, { folk, person: hal }, { kind: 'burial', player });
        expect(told).toEqual(expect.arrayContaining([bran, elsa, wren]));
        expect(hal.nm).toBeUndefined();
        const [m] = NpcMemory.recall(world, { folk, person: wren }, { about: player, includeKin: false });
        expect(m.text).toBe("You paid for my father Hal Miller's burial. We have not forgotten it.");
    });

    it('caps each person and each town', () => {
        const { world, folk, hal, town } = makeWorld();
        const player = makePlayer();
        const kinds = ['gift', 'alms', 'healed', 'hired', 'dismissed', 'wages_unpaid', 'robbed', 'assaulted', 'burial'];
        kinds.forEach((k, i) => NpcMemory.remember(world, { folk, person: hal }, { kind: k, player, day: 100 + i * 10 }));
        expect(hal.nm.length).toBe(NpcMemory.config().perPerson);
        for (let i = 0; i < 12; i++) NpcMemory.rememberTown(world, town, { kind: 'ruled_harsh', player, victim: `Tam ${i}`, day: 100 + i * 10 });
        expect(folk.nm.length).toBe(NpcMemory.config().perTown);
    });

    it('merges a repeat within days, stacking to a cap', () => {
        const { world, folk, hal } = makeWorld();
        const player = makePlayer();
        for (let i = 0; i < 6; i++) NpcMemory.remember(world, { folk, person: hal }, { kind: 'gift', player });
        expect(hal.nm).toHaveLength(1);
        expect(hal.nm[0].w).toBe(12);
    });
});

describe('NpcMemory — across generations', () => {
    it('"Your grandfather hanged my father": a dead holder hands down, the House moves on', () => {
        const { world, folk, bran, hal, wren } = makeWorld();
        const grandfather = makePlayer('Aldric Voss', 1);
        // Bran is hanged by Aldric's order: his son Hal holds it
        NpcMemory.rememberKin(world, { folk, person: bran }, { kind: 'hanged', player: grandfather });
        bran.died = 100;
        const [halSays] = NpcMemory.recall(world, { folk, person: hal }, { about: grandfather });
        expect(halSays.text).toBe('You hanged my father Bran Miller.');

        // Two generations later Hal dies; Wren is told it as a family story
        world.day = 120 * 50;
        hal.died = world.day - 5;
        NpcMemory.processDay(world, null);
        expect(hal.nm).toBeUndefined();
        expect(wren.nm).toHaveLength(1);
        expect(wren.nm[0]).toMatchObject({ k: 'hanged', vr: 'grandfather', vn: 'Bran Miller', g: 1, fr: 'father' });

        const grandson = makePlayer('Osric Voss', 3);
        const [w] = NpcMemory.recall(world, { folk, person: wren }, { about: grandson });
        expect(w.actor).toBe('your grandfather');
        expect(w.text).toBe('Your grandfather hanged my grandfather Bran Miller. My father told me of it.');
        expect(w.weight).toBeLessThan(0);
        expect(NpcMemory.familyStories(world, { folk, person: wren }, { about: grandson })).toHaveLength(1);
    });

    it('reads a living parent\'s memory through, weaker, without copying it', () => {
        const { world, folk, hal, wren } = makeWorld();
        const player = makePlayer();
        NpcMemory.remember(world, { folk, person: hal }, { kind: 'healed', player });
        const [m] = NpcMemory.recall(world, { folk, person: wren }, { about: player });
        expect(m.source).toBe('parent');
        expect(m.victimRel).toBe('father');
        expect(wren.nm).toBeUndefined();
        expect(NpcMemory.opinion(world, { folk, person: wren }, player)).toBe(Math.round(10 * NpcMemory.config().parentShare));
    });

    it('a stranger\'s House counts for nothing with the player, and is named as such', () => {
        const { world, folk, hal } = makeWorld();
        NpcMemory.remember(world, { folk, person: hal }, { kind: 'assaulted', player: { name: 'Gort', gender: 'male', house: { name: 'House Grim', generation: 1 } } });
        const player = makePlayer();
        expect(NpcMemory.opinion(world, { folk, person: hal }, player)).toBe(0);
        const [m] = NpcMemory.recall(world, { folk, person: hal }, { about: player, scope: 'all' });
        expect(m.actor).toBe('Gort of House Grim');
    });

    it('stays bounded over a century of deaths', () => {
        const { world, folk } = makeWorld();
        const player = makePlayer();
        // A line of 30 generations, each remembered by the House and dying in turn
        let parent = folk.people[4];
        for (let g = 0; g < 30; g++) {
            const kid = P(folk.n++, `K${g}`, g % 2 ? 'female' : 'male', { parents: [parent.id] });
            parent.kids.push(kid.id);
            folk.people.push(kid);
            NpcMemory.remember(world, { folk, person: parent }, { kind: g % 2 ? 'murdered' : 'gift', player, victim: { name: `V${g}`, rel: 'brother' } });
            world.day = 120 * 25 * (g + 1);
            parent.died = world.day - 1;
            NpcMemory.processDay(world, null);
            parent = kid;
        }
        const st = NpcMemory.stats(world);
        expect(st.holders).toBeLessThanOrEqual(2);
        for (const p of folk.people) if (p.nm) expect(p.nm.length).toBeLessThanOrEqual(NpcMemory.config().perPerson);
        for (const p of folk.people) if (p.nm) for (const e of p.nm) expect(e.g || 0).toBeLessThanOrEqual(NpcMemory.config().maxGenerations);
    });
});

describe('NpcMemory — what it does', () => {
    it('moves a trader\'s prices, and a bitter one refuses to trade', () => {
        const { world, folk, hal } = makeWorld();
        const player = makePlayer();
        const npc = { name: 'Hal', type: 'merchant', personalityTraits: [] };
        Object.defineProperty(npc, '_person', { value: hal });
        Object.defineProperty(npc, '_folk', { value: folk });
        const base = NpcDisposition.getPriceModifiers(npc, { player, world }).buy;
        NpcMemory.remember(world, npc, { kind: 'healed', player });
        expect(NpcDisposition.getPriceModifiers(npc, { player, world }).buy).toBeLessThan(base);
        hal.nm = [];
        NpcMemory.rememberKin(world, { folk, person: folk.people[0] }, { kind: 'murdered', player });
        const pm = NpcDisposition.getPriceModifiers(npc, { player, world });
        expect(pm.refuses).toBe(true);
        expect(pm.refuseReason).toMatch(/Not after the killing of my father Bran Miller by you/);
    });

    it('refuses the player\'s work after a blood wrong; takes it gladder after kindness', () => {
        const { world, folk, hal, una } = makeWorld();
        const player = makePlayer();
        hal.job = { id: 'labourer', rank: 'journeyman' };
        una.job = { id: 'labourer', rank: 'journeyman' };
        const kind = Object.keys(TownJobs.config().playerJobs.kinds)[0];
        const before = TownJobs.offerTerms(player, world, folk, una, kind).chance;
        NpcMemory.remember(world, { folk, person: una }, { kind: 'burial', player });
        expect(TownJobs.offerTerms(player, world, folk, una, kind).chance).toBeGreaterThan(before);
        NpcMemory.rememberKin(world, { folk, person: folk.people[0] }, { kind: 'hanged', player });
        expect(TownJobs.offerTerms(player, world, folk, hal, kind).refuse).toMatch(/^Work for you\? After the hanging of my father/);
    });

    it('a witness who owes the House keeps quiet', () => {
        const { world, folk, hal } = makeWorld();
        const player = makePlayer();
        NpcMemory.remember(world, { folk, person: hal }, { kind: 'healed', player, weight: 30 });
        expect(NpcMemory.shields(world, { folk, person: hal }, player)).toBe(true);
    });

    it('a town that remembers a raid is restless; one fed in a famine is calm', () => {
        const { world, town } = makeWorld();
        const player = makePlayer();
        NpcMemory.rememberTown(world, town, { kind: 'raided', player });
        expect(NpcMemory.unrestPressure(world, town, player)).toBeGreaterThan(0);
        world.day++;
        town.folk.nm = [];
        NpcMemory.rememberTown(world, town, { kind: 'dole', player, weight: 20 });
        expect(NpcMemory.unrestPressure(world, town, player)).toBeLessThan(0);
    });

    it('a hanging at court is the town\'s memory, told to everyone', () => {
        const { world, folk, wren } = makeWorld();
        const player = makePlayer();
        NpcMemory.onRuling(world, player, { q: 3, r: 4, name: 'Tam Fletcher' }, { label: 'Hang him now', effects: { court: { severity: 3 } } });
        expect(folk.nm[0]).toMatchObject({ k: 'hanged', vn: 'Tam Fletcher' });
        const [m] = NpcMemory.recall(world, { folk, person: wren }, { about: player });
        expect(m.source).toBe('town');
        expect(m.text).toBe('You hanged Tam Fletcher in this town. The square remembers it.');
    });

    it('greets once in a while from the strongest memory', () => {
        const { world, folk, hal } = makeWorld();
        const player = makePlayer();
        NpcMemory.remember(world, { folk, person: hal }, { kind: 'healed', player });
        const npc = {};
        Object.defineProperty(npc, '_person', { value: hal });
        Object.defineProperty(npc, '_folk', { value: folk });
        expect(NpcMemory.greetLine(world, npc, player)).toMatch(/You saw me through a sickness/);
        expect(NpcMemory.greetLine(world, npc, player)).toBeNull();
        world.day += 40;
        expect(NpcMemory.greetLine(world, npc, player)).toBeTruthy();
    });

    it('writes the top memories for the language model', () => {
        const { world, folk, bran, wren } = makeWorld();
        const player = makePlayer();
        NpcMemory.rememberKin(world, { folk, person: bran }, { kind: 'burial', player });
        const lines = NpcMemory.llmLines(world, { folk, person: wren }, player);
        expect(lines[0]).toMatch(/^you remember with gratitude: the burial the player gave your grandfather Bran Miller/);
    });

    it('asks the prose writer for a family story\'s durable telling, when one is set', () => {
        const { world, folk, bran, hal, wren } = makeWorld();
        const player = makePlayer();
        NpcMemory.rememberKin(world, { folk, person: bran }, { kind: 'burial', player });
        hal.died = world.day;
        world.day = 120;
        NpcMemory.processDay(world, null);
        const writes = [];
        NpcMemory.setProse({ text: () => null, write: (w, req) => { writes.push(req); return Promise.resolve('x'); } });
        try {
            const [s] = NpcMemory.familyStories(world, { folk, person: wren }, { about: player });
            expect(s.text).toMatch(/burial/);
            expect(writes[0]).toMatchObject({ kind: 'familyStory', key: expect.stringMatching(/^npcMemory:3,4#4:burial/) });
            NpcMemory.setProse({ text: () => 'A told tale.' });
            expect(NpcMemory.familyStories(world, { folk, person: wren }, { about: player })[0].text).toBe('A told tale.');
        } finally { NpcMemory.setProse(null); }
    });

    it('routes a lord to NPCLords\' memory', () => {
        const lord = { name: 'Lord Brand', kingdomId: 7, memory: [] };
        const world = { day: 50, getKingdom: (id) => (id === 7 ? { id: 7, lord } : null) };
        const player = makePlayer();
        expect(NpcMemory.remember(world, 'lord:7', { kind: 'gift', player })).toBeTruthy();
        expect(NPCLords.memoryOf(lord, 50)[0].key).toBe('gift');
        expect(NpcMemory.recall(world, { lord })[0]).toMatchObject({ kind: 'gift', source: 'lord' });
        expect(NpcMemory.refOf(world, { lord })).toBe('lord:7');
        expect(NpcMemory.remember(world, { lord }, { kind: 'hired', player })).toBeNull();
    });
});

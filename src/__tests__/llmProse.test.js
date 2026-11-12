// The court chronicler's pen (systems/llmProse.js): one prose service for
// every system. The contract: the fallback comes back at once, the model's
// retelling lands later on world.prose[key].text, it is saved with the world,
// nothing ever throws, prompts carry only the facts, and the budget holds.
// Plus: the Annals write a closed chapter (and the reign summary) by themselves.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadData, newGame, roundTrip } from './playtest/harness.js';
import { LlmProse } from '../systems/llmProse.js';
import { NpcBrain } from '../systems/npcBrain.js';
import { Annals } from '../systems/annals.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { Utils } from '../core/utils.js';
import { Nemesis } from '../systems/nemesis.js';
import { NpcMemory } from '../systems/npcMemory.js';

beforeAll(async () => {
    await loadData();
});

afterEach(() => {
    LlmProse._reset();
    NpcBrain._reset();
    vi.restoreAllMocks();
});

/** A mocked transport: answers each chat with `reply(messages)` after the test lets it. */
function mockClient(reply = () => 'Aldric ruled with a firm hand.', opts = {}) {
    const calls = [];
    let open = 0, maxOpen = 0;
    const client = {
        calls,
        get maxOpen() { return maxOpen; },
        isAvailable: vi.fn(async () => opts.available !== false),
        chat: vi.fn(async (messages, o) => {
            calls.push({ messages, o });
            open++; maxOpen = Math.max(maxOpen, open);
            await new Promise(r => setTimeout(r, 1));
            open--;
            const text = reply(messages);
            return text == null ? { ok: false, reason: 'http 500' } : { ok: true, text };
        }),
    };
    return client;
}

const world0 = (day = 10) => ({ day });

describe('LlmProse — the API contract', () => {
    it('with the model off, write returns the fallback and records the facts, status off', () => {
        const w = world0();
        const out = LlmProse.write(w, { kind: 'annals', key: 'annals:h:g1_0', facts: { ruler: 'Aldric' }, fallback: 'Aldric ruled.' });
        expect(out).toBe('Aldric ruled.');
        expect(w.prose['annals:h:g1_0']).toMatchObject({ kind: 'annals', facts: { ruler: 'Aldric' }, fallback: 'Aldric ruled.', status: 'off' });
        expect(LlmProse.text(w, 'annals:h:g1_0', 'x')).toBe('Aldric ruled.');
        expect(LlmProse.status(w, 'annals:h:g1_0')).toBe('off');
        expect(LlmProse.status(w, 'nope')).toBe(null);
        expect(LlmProse.text(w, 'nope', 'given')).toBe('given');
        expect(LlmProse.pending(w)).toBe(0);
    });

    it('returns the fallback immediately and fills the text in the background', async () => {
        const client = mockClient(() => 'In those days Aldric ruled, and the realm was quiet.');
        LlmProse._setClient(client);
        LlmProse._setEnabled(true);
        const w = world0();
        const out = LlmProse.write(w, { kind: 'reign', key: 'reign:h:g1_0', facts: { ruler: 'Aldric', years: 20 }, fallback: 'Aldric ruled 20 years.' });
        expect(out).toBe('Aldric ruled 20 years.');
        expect(['queued', 'writing']).toContain(LlmProse.status(w, 'reign:h:g1_0'));
        expect(LlmProse.pending(w)).toBe(1);
        expect(LlmProse.text(w, 'reign:h:g1_0', null)).toBe('Aldric ruled 20 years.');
        await LlmProse._flush();
        expect(LlmProse.status(w, 'reign:h:g1_0')).toBe('done');
        expect(w.prose['reign:h:g1_0'].text).toBe('In those days Aldric ruled, and the realm was quiet.');
        expect(LlmProse.text(w, 'reign:h:g1_0', null)).toBe('In those days Aldric ruled, and the realm was quiet.');
        expect(LlmProse.pending(w)).toBe(0);
        // The same facts again: no new request, and the text comes straight back
        expect(LlmProse.write(w, { kind: 'reign', key: 'reign:h:g1_0', facts: { ruler: 'Aldric', years: 20 }, fallback: 'Aldric ruled 20 years.' })).toBe('In those days Aldric ruled, and the realm was quiet.');
        expect(client.chat).toHaveBeenCalledTimes(1);
    });

    it('new facts under a key replace the entry; the old retelling shows until the new is done', async () => {
        let n = 0;
        LlmProse._setClient(mockClient(() => (++n === 1 ? 'Aldric ruled.' : 'Aldric ruled, and Aldric fought.')));
        LlmProse._setEnabled(true);
        const w = world0();
        LlmProse.write(w, { kind: 'annals', key: 'k', facts: { a: 'Aldric ruled' }, fallback: 'Aldric ruled' });
        await LlmProse._flush();
        LlmProse.write(w, { kind: 'annals', key: 'k', facts: { a: 'Aldric ruled', b: 'Aldric fought' }, fallback: 'Aldric ruled. Aldric fought.' });
        expect(LlmProse.text(w, 'k', null)).toBe('Aldric ruled.');
        await LlmProse._flush();
        expect(LlmProse.text(w, 'k', null)).toBe('Aldric ruled, and Aldric fought.');
    });

    it('a failed or refused reply leaves the fallback standing', async () => {
        LlmProse._setClient(mockClient(() => null));
        LlmProse._setEnabled(true);
        const w = world0();
        LlmProse.write(w, { kind: 'letter', key: 'l1', facts: { body: 'Come.' }, fallback: 'Come to the feast.' });
        await LlmProse._flush();
        expect(LlmProse.status(w, 'l1')).toBe('failed');
        expect(LlmProse.text(w, 'l1', 'x')).toBe('Come to the feast.');

        LlmProse._setClient(mockClient(() => 'yes', { available: false }));
        LlmProse.write(w, { kind: 'letter', key: 'l2', facts: {}, fallback: 'Plain.' });
        await LlmProse._flush();
        expect(LlmProse.status(w, 'l2')).toBe('failed');
        expect(LlmProse.text(w, 'l2')).toBe('Plain.');
    });

    it('never throws: bad worlds, bad options, cyclic facts, a throwing client', async () => {
        const cyc = { a: 1 }; cyc.self = cyc;
        expect(() => LlmProse.write(null, { key: 'k', fallback: 'f' })).not.toThrow();
        expect(LlmProse.write(null, { key: 'k', fallback: 'f' })).toBe('f');
        expect(LlmProse.write({}, null)).toBe(null);
        expect(LlmProse.write({}, { fallback: 'no key' })).toBe('no key');
        expect(LlmProse.write({ prose: 'garbage' }, { key: 'k', facts: cyc, fallback: 'f' })).toBe('f');
        expect(LlmProse.text(null, 'k', 'f')).toBe('f');
        expect(LlmProse.status(undefined, 'k')).toBe(null);
        expect(LlmProse.pending('nonsense')).toBe(0);
        expect(() => LlmProse.restore('junk', {})).not.toThrow();
        expect(LlmProse.serialize(null)).toBe(null);
        LlmProse._setClient({ isAvailable: async () => { throw new Error('boom'); }, chat: async () => { throw new Error('boom'); } });
        LlmProse._setEnabled(true);
        const w = world0();
        expect(LlmProse.write(w, { kind: 'heralds', key: 'h', facts: { news: ['x'] }, fallback: 'News.' })).toBe('News.');
        await LlmProse._flush();
        expect(LlmProse.status(w, 'h')).toBe('failed');
        expect(LlmProse.text(w, 'h')).toBe('News.');
    });

    it('draws no randomness: the RNG stream is untouched with the model on or off', async () => {
        Utils.setSeed(1234);
        const a = [Utils.random(), Utils.random()];
        Utils.setSeed(1234);
        LlmProse.write(world0(), { kind: 'annals', key: 'k', facts: { x: 1 }, fallback: 'f' });
        LlmProse._setClient(mockClient());
        LlmProse._setEnabled(true);
        LlmProse.write(world0(), { kind: 'annals', key: 'k', facts: { x: 1 }, fallback: 'f' });
        await LlmProse._flush();
        expect([Utils.random(), Utils.random()]).toEqual(a);
    });
});

describe('LlmProse — prompts from facts only', () => {
    it('the prompt holds the facts and the strict instruction, and nothing else of the world', () => {
        const msgs = LlmProse.buildPrompt('reign', { ruler: 'Aldric Ashford', yearsReigned: 20, deeds: ['12 battles won'] }, 'Aldric Ashford ruled 20 years.');
        expect(msgs[0].role).toBe('system');
        expect(msgs[0].content).toMatch(/Never invent events/);
        expect(msgs[0].content).toMatch(/no modern idiom/);
        expect(msgs[0].content).toMatch(/chronicler/);
        const user = msgs[1].content;
        expect(user).toContain('Aldric Ashford');
        expect(user).toContain('12 battles won');
        expect(user).toContain('years reigned: 20');
        expect(user).toMatch(/Invent nothing/);
        // Only the words of the facts and the fixed instructions: no stray names
        const fixed = LlmProse.buildPrompt('reign', {}, null)[1].content;
        const extra = user.replace(fixed.split('\n\nThe facts')[0], '');
        expect(extra).not.toMatch(/Kettlemoor|Red Crown/);
    });

    it('validate throws out invented numbers and names, keeps a faithful retelling', () => {
        const facts = { ruler: 'Aldric Ashford', yearsReigned: 20, deeds: ['12 battles won'], place: 'Kettlemoor' };
        expect(LlmProse.validate('For 20 years Aldric Ashford ruled, and won 12 battles; Kettlemoor was his.', facts)).toBe(true);
        expect(LlmProse.validate('Thus the Lord Aldric held the realm.', facts)).toBe(true);
        expect(LlmProse.validate('Aldric ruled 30 years.', facts)).toBe(false); // a number not in the facts
        expect(LlmProse.validate('Aldric wed the lady Morwenna of the hills.', facts)).toBe(false); // a name not in the facts
        expect(LlmProse.validate('Morwenna mourned him.', facts)).toBe(false); // an invented name opening a sentence
    });

    it('a retelling that invents is rejected and the fallback stands', async () => {
        LlmProse._setClient(mockClient(() => 'Aldric reigned 99 years beside Queen Morwenna.'));
        LlmProse._setEnabled(true);
        const w = world0();
        LlmProse.write(w, { kind: 'reign', key: 'r', facts: { ruler: 'Aldric', yearsReigned: 20 }, fallback: 'Aldric ruled 20 years.' });
        await LlmProse._flush();
        expect(LlmProse.status(w, 'r')).toBe('rejected');
        expect(LlmProse.text(w, 'r')).toBe('Aldric ruled 20 years.');
    });
});

describe('LlmProse — budget and priority', () => {
    it('never runs more at once than the concurrency cap, and the Annals go before flavour', async () => {
        const order = [];
        const client = mockClient((m) => { order.push(/heralds/.test(m[1].content) ? 'heralds' : 'annals'); return 'It was so, and so it stood.'; });
        LlmProse._setClient(client);
        LlmProse._setEnabled(true);
        NpcBrain.configure({ maxConcurrent: 1 });
        const w = world0();
        // The first starts at once; the rest queue, flavour first in time, history first in rank
        LlmProse.write(w, { kind: 'heralds', key: 'h0', facts: { n: 'so' }, fallback: 'It was so, and so it stood.' });
        for (let i = 1; i <= 3; i++) LlmProse.write(w, { kind: 'heralds', key: `h${i}`, facts: { n: 'so', i }, fallback: 'It was so, and so it stood.' });
        LlmProse.write(w, { kind: 'annals', key: 'a1', facts: { n: 'so' }, fallback: 'It was so, and so it stood.' });
        for (let i = 0; i < 10; i++) await LlmProse._flush();
        expect(client.maxOpen).toBe(1);
        expect(order[0]).toBe('heralds'); // already under way
        expect(order[1]).toBe('annals'); // jumped the queue
        expect(order.length).toBe(5);
    });

    it('holds to the per-day budget until the next day', async () => {
        const client = mockClient(() => 'It was so, and so it stood.');
        LlmProse._setClient(client);
        LlmProse._setEnabled(true);
        LlmProse.configure({ maxPerDay: 2 });
        const w = world0(5);
        for (let i = 0; i < 4; i++) LlmProse.write(w, { kind: 'heralds', key: `h${i}`, facts: { i }, fallback: 'It was so, and so it stood.' });
        for (let i = 0; i < 4; i++) await LlmProse._flush();
        expect(client.chat).toHaveBeenCalledTimes(2);
        expect(LlmProse.pending(w)).toBe(2);
        w.day = 6;
        LlmProse.processDay(w);
        for (let i = 0; i < 4; i++) await LlmProse._flush();
        expect(client.chat).toHaveBeenCalledTimes(4);
        expect(LlmProse.pending(w)).toBe(0);
    });

    it('a category switched off is not written (letters off, annals on)', async () => {
        const client = mockClient(() => 'It was so, and so it stood.');
        LlmProse._setClient(client);
        LlmProse._setEnabled(true);
        LlmProse.applyFromSettings({ llmProseLetters: false });
        const w = world0();
        LlmProse.write(w, { kind: 'letter', key: 'l', facts: {}, fallback: 'It was so, and so it stood.' });
        LlmProse.write(w, { kind: 'annals', key: 'a', facts: {}, fallback: 'It was so, and so it stood.' });
        await LlmProse._flush();
        expect(LlmProse.status(w, 'l')).toBe('off');
        expect(LlmProse.status(w, 'a')).toBe('done');
        // ...and the saved settings NpcBrain applies count too
        NpcBrain.applyFromSettings({ llmEnabled: true, llmProseHeralds: false });
        expect(LlmProse.canWrite('heralds')).toBe(false);
        expect(LlmProse.canWrite('epitaph')).toBe(true);
    });
});

describe('LlmProse — saving', () => {
    it('round-trips: history kept whole, unwritten flavour dropped, unfinished work queued again', async () => {
        LlmProse._setClient(mockClient(() => 'Aldric ruled.'));
        LlmProse._setEnabled(true);
        const w = world0();
        LlmProse.write(w, { kind: 'annals', key: 'annals:h:g1_0', facts: { ruler: 'Aldric' }, fallback: 'Aldric ruled' });
        LlmProse.write(w, { kind: 'letter', key: 'letter:1', facts: { body: 'Aldric ruled' }, fallback: 'Aldric ruled' });
        await LlmProse._flush();
        LlmProse._setEnabled(false);
        LlmProse.write(w, { kind: 'heralds', key: 'heralds:10', facts: { news: ['x'] }, fallback: 'x' }); // flavour, never written
        LlmProse.write(w, { kind: 'epitaph', key: 'epitaph:h', facts: { house: 'h' }, fallback: 'Here ends h.' }); // history, not yet written
        const saved = JSON.parse(JSON.stringify(LlmProse.serialize(w)));
        expect(saved['annals:h:g1_0'].text).toBe('Aldric ruled.');
        expect(saved['letter:1'].text).toBe('Aldric ruled.');
        expect(saved['heralds:10']).toBeUndefined();
        expect(saved['epitaph:h'].fallback).toBe('Here ends h.');
        const w2 = world0();
        LlmProse.restore(saved, w2);
        expect(LlmProse.text(w2, 'annals:h:g1_0')).toBe('Aldric ruled.');
        expect(LlmProse.text(w2, 'epitaph:h')).toBe('Here ends h.');
        expect(LlmProse.status(w2, 'epitaph:h')).toBe('off');
        // With the model back on, the same facts are written now
        LlmProse._setEnabled(true);
        LlmProse._setClient(mockClient(() => 'Here ends h, as the chronicle tells.'));
        LlmProse.write(w2, { kind: 'epitaph', key: 'epitaph:h', facts: { house: 'h' }, fallback: 'Here ends h.' });
        await LlmProse._flush();
        expect(LlmProse.status(w2, 'epitaph:h')).toBe('done');
    });

    it('flavour is bounded; the run\'s history is kept forever', () => {
        LlmProse.configure({ cap: 10 });
        const w = world0();
        for (let i = 0; i < 5; i++) LlmProse.write(w, { kind: 'annals', key: `annals:${i}`, facts: { i }, fallback: 'x' });
        for (let i = 0; i < 30; i++) { w.day = 100 + i; LlmProse.write(w, { kind: 'heralds', key: `heralds:${i}`, facts: { i }, fallback: 'x' }); }
        const keys = Object.keys(w.prose);
        expect(keys.length).toBe(10);
        for (let i = 0; i < 5; i++) expect(w.prose[`annals:${i}`]).toBeTruthy();
        expect(w.prose['heralds:29']).toBeTruthy();
        expect(w.prose['heralds:0']).toBeUndefined();
    });

    it('goes through the save file with the world (systems/saveLoad.js)', () => {
        const game = newGame(4242);
        LlmProse.write(game.world, { kind: 'reign', key: 'reign:x:g1_0', facts: { ruler: 'Bot' }, fallback: 'Bot ruled.' });
        game.world.prose['reign:x:g1_0'].text = 'Bot ruled, as the chronicle tells.';
        game.world.prose['reign:x:g1_0'].status = 'done';
        const back = roundTrip(game);
        expect(LlmProse.text(back.world, 'reign:x:g1_0')).toBe('Bot ruled, as the chronicle tells.');
    });
});

// ── The Annals write themselves ─────────────────────────

function dynasty() {
    const h = (day, generation, text, tags) => ({ day, generation, text, tags });
    const house = {
        id: 'house_ashford', name: 'House Ashford', motto: 'Ash before oak', sigil: { icon: '🛡️' },
        foundedDay: 1, prestige: 140, generation: 2, headId: null, stats: {}, rivals: {},
        honours: [], prestigeLog: [], roles: {},
        history: [
            h(1, 1, 'House Ashford enters history.', ['founding']),
            h(40, 1, 'Aldric Ashford weds Mira Vell.', ['marriage', 'love']),
            h(150, 1, 'Bran is born to Aldric Ashford.', ['heirs', 'birth']),
            h(260, 1, 'House Ashford conquers Kettlemoor.', ['conquest', 'war']),
            h(2400, 2, 'Generation 2: Bran Ashford succeeds.', ['succession']),
        ],
        reigns: [{
            name: 'Aldric Ashford', generation: 1, startDay: 1, endDay: 2400, startAge: 22, endAge: 42, years: 20,
            cause: 'old age', traits: ['brave'], title: null, crown: null, crownsWon: 0, battles: 12, quests: 4,
            titles: 1, settlements: 1, ambitionMilestones: 0, ambitionCapstones: 0, nobleMarriages: 0, wars: 1,
            delves: 0, delvesCleared: 0, rivalsBested: 0, petitionsRuled: 0, holdingProjects: 0, raidsRepelled: 0,
            rebellionsCrushed: 0, holdingsLost: 0, notableRulings: [], children: 1, prestigeGained: 120,
            highlights: [], court: {}, crownsLost: [], epithet: 'the Brave', score: 300, gender: 'male',
        }],
        currentReign: { name: 'Bran Ashford', generation: 2, startDay: 2400, startAge: 18, snapshot: null },
        ended: null, wealthMarks: [], wealthPeak: null,
    };
    return {
        name: 'Bran Ashford', firstName: 'Bran', lastName: 'Ashford', gender: 'male', age: 21, gold: 2200,
        karma: 0, renown: 10, house,
        children: [{ id: 'c1', firstName: 'Kael', birthDay: 2500, isAlive: true, age: 1 }],
        traits: { deeds: {}, progress: {}, earned: {}, notices: [] },
    };
}

describe('Annals — the scribe writes a closed chapter by itself', () => {
    it('with the model off, the daily tick files nothing and the annals compose as before', () => {
        const player = dynasty();
        const w = { day: 2600, baseYear: 1000, kingdoms: [], getKingdom: () => null };
        Annals.processDay(w, player);
        expect(Object.keys(w.prose || {}).length).toBe(0);
    });

    it('writes the closed chapter, the reign summary and the living chapter, kept in world.prose', async () => {
        const client = mockClient((m) => (/summary of the reign/.test(m[1].content)
            ? 'Aldric Ashford ruled 20 years and died of old age.'
            : 'In those days Aldric Ashford wed Mira Vell, and House Ashford took Kettlemoor.'));
        LlmProse._setClient(client);
        LlmProse._setEnabled(true);
        const player = dynasty();
        const w = { day: 2600, baseYear: 1000, kingdoms: [], getKingdom: () => null };
        Annals.processDay(w, player);
        const book = Annals.compose(player, w);
        const closed = book.chapters.find(c => !c.live);
        const live = book.chapters.find(c => c.live);
        const ck = Annals.chapterKey(player, closed);
        expect(ck).toBe(`annals:house_ashford:${closed.id}`);
        expect(w.prose[ck]).toBeTruthy();
        expect(w.prose[ck].fallback).toBe(closed.text);
        expect(w.prose[Annals.chapterKey(player, live)]).toBeTruthy();
        expect(w.prose[Annals.reignKey(player, closed)]).toBeTruthy();
        for (let i = 0; i < 6; i++) await LlmProse._flush();
        expect(LlmProse.status(w, ck)).toBe('done');
        expect(LlmProse.written(w, ck)).toMatch(/Kettlemoor/);
        expect(LlmProse.written(w, Annals.reignKey(player, closed))).toMatch(/old age/);
        // The chapter prompt was built from the chapter's own sentences
        const chapterCall = client.calls.find(c => /chapter of the Annals/.test(c.messages[1].content));
        expect(chapterCall.messages[1].content).toContain('Aldric Ashford wed Mira Vell');
        // Kept in the save: the closed chapter's prose stays
        const saved = JSON.parse(JSON.stringify(LlmProse.serialize(w)));
        expect(saved[ck].text).toMatch(/Kettlemoor/);
        // The next day asks for nothing more (the year has not turned)
        const n = client.chat.mock.calls.length;
        w.day = 2601;
        Annals.processDay(w, player);
        await LlmProse._flush();
        expect(client.chat.mock.calls.length).toBe(n);
    });

    it('the epitaph is filed under the key the chronicle book reads', () => {
        const player = dynasty();
        player.house.ended = { day: 3000, cause: 'fever', lastRuler: 'Bran Ashford' };
        const w = { day: 3000, baseYear: 1000 };
        const ep = { houseName: 'House Ashford', motto: 'Ash before oak', generations: 2, years: 25, crowns: 0, rank: { label: 'Minor House' }, best: { name: 'Aldric Ashford', epithet: 'the Brave' }, reigns: player.house.reigns, line: 'Remembered for Aldric Ashford the Brave.' };
        const text = Annals.writeEpitaph(w, player, ep);
        expect(text).toMatch(/^Here ends the line of House Ashford/);
        expect(LlmProse.text(w, 'epitaph:house_ashford')).toBe(text);
    });
});

describe('Court letters through the pen', () => {
    it('a delivered letter keeps its written body with the model off', () => {
        const w = { day: 50, kingdoms: [] };
        const player = {};
        const letter = CourtLetters.deliver(player, { kind: 'feast_invite', day: 50, expires: 60, from: { type: 'lord', name: 'Lord Vell' }, key: 'k1', vars: {}, data: {}, subject: 'A feast', body: 'Come to my feast.' }, w);
        expect(letter.proseKey).toBeTruthy();
        expect(CourtLetters.bodyOf(w, letter)).toBe('Come to my feast.');
    });
});

describe('The injected seams write through the pen (nemesis, family stories)', () => {
    afterEach(() => { Nemesis.resetProse(); NpcMemory.setProse(null); });

    it('with a provider on, Nemesis and NpcMemory hand their prose to LlmProse without error', async () => {
        const client = mockClient((m) => (/Gorrik/.test(m[1].content) ? 'Gorrik the Red swore to see House Ashford fall.' : 'Mira Vell was wronged, and her kin remember.'));
        LlmProse._setClient(client);
        LlmProse._setEnabled(true);
        Nemesis.setProse(LlmProse);
        NpcMemory.setProse(LlmProse);
        const w = { day: 900, kingdoms: [] };
        // A nemesis taunt: the template now, the chronicler's line later
        const t = Nemesis._write(w, 'nemesisTaunt', 'nemesis:n1:taunt:900', { name: 'Gorrik the Red', house: 'House Ashford' }, 'Gorrik the Red swears vengeance on House Ashford.');
        expect(t).toBe('Gorrik the Red swears vengeance on House Ashford.');
        // A family story in NpcMemory's own shape (familyStories itself runs over an empty world without error)
        expect(() => NpcMemory.familyStories(w, { type: 'npc', id: 'nobody' })).not.toThrow();
        const f = LlmProse.write(w, { kind: 'familyStory', key: 'npcMemory:p1:wronged:800:Mira Vell', facts: { kind: 'wronged', victim: 'Mira Vell', feeling: 'bitterness' }, fallback: 'They say Mira Vell was wronged.' });
        expect(f).toBe('They say Mira Vell was wronged.');
        for (let i = 0; i < 4; i++) await LlmProse._flush();
        expect(LlmProse.status(w, 'nemesis:n1:taunt:900')).toBe('done');
        expect(Nemesis.prose(w, 'nemesis:n1:taunt:900', 'x')).toBe('Gorrik the Red swore to see House Ashford fall.');
        expect(LlmProse.status(w, 'npcMemory:p1:wronged:800:Mira Vell')).toBe('done');
    });
});

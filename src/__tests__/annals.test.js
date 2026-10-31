// The Annals (systems/annals.js): the player's life and dynasty told as a
// book from what the systems already record. Composed on demand, the same
// state always reads the same; one chapter per ruler; old saves and fresh
// players compose without error; a new life carries the old line as
// "Before"; the court scribe (a local LLM) is optional and never needed.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { Annals } from '../systems/annals.js';
import { House } from '../systems/house.js';
import { NpcBrain } from '../systems/npcBrain.js';
import { LlmClient } from '../systems/llmClient.js';
import { Afterlife } from '../player/afterlife.js';

beforeAll(async () => {
    await loadData();
});

afterEach(() => {
    NpcBrain._reset();
    vi.restoreAllMocks();
});

const Y = 120; // days a year

function mockWorld(day) {
    return { day, baseYear: 1000, kingdoms: [], getKingdom: () => null };
}

/** A House two generations deep: Aldric (dead), Bran (reigning). */
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
            h(200, 1, 'The Red Crown declares war on House Ashford.', ['war']),
            h(260, 1, 'House Ashford conquers Kettlemoor.', ['conquest', 'war']),
            h(265, 1, 'Grey Guild demands a benevolence of House Ashford.', ['demand', 'guild']),
            h(266, 1, 'Grey Guild presses again.', ['demand', 'guild']),
            h(267, 1, 'Grey Guild presses a third time.', ['demand', 'guild']),
            h(268, 1, 'Grey Guild presses a fourth time.', ['demand', 'guild']),
            h(300, 1, 'The war with The Red Crown ends: a victory.', ['war', 'peace']),
            h(1500, 1, 'House Ashford gains the office of Marshal.', ['title']),
            h(2400, 2, 'Generation 2: Bran Ashford succeeds amid a disputed succession.', ['succession']),
            h(2460, 2, 'Bran Ashford weds Tamsin Reed.', ['marriage', 'love']),
            h(2500, 2, 'Kael is born to Bran Ashford.', ['heirs', 'birth']),
        ],
        reigns: [{
            name: 'Aldric Ashford', generation: 1, startDay: 1, endDay: 2400, startAge: 22, endAge: 42, years: 20,
            cause: 'old age', traits: ['brave'], title: null, crown: null, crownsWon: 0, battles: 12, quests: 4,
            titles: 1, settlements: 1, ambitionMilestones: 0, ambitionCapstones: 0, nobleMarriages: 0, wars: 1,
            delves: 0, delvesCleared: 0, rivalsBested: 0, petitionsRuled: 0, holdingProjects: 0, raidsRepelled: 0,
            rebellionsCrushed: 0, holdingsLost: 0, notableRulings: [], children: 1, prestigeGained: 120,
            highlights: [], court: {}, crownsLost: [], epithet: 'the Brave', score: 300, gender: 'male',
            deedsDelta: { 'gossip.kills': 3, 'gossip.witnessedKills': 1 },
        }],
        currentReign: { name: 'Bran Ashford', generation: 2, startDay: 2400, startAge: 18, snapshot: null },
        ended: null,
        wealthMarks: [
            { day: 30, gold: 300, generation: 1 }, { day: 600, gold: 4200, generation: 1 },
            { day: 1200, gold: 900, generation: 1 }, { day: 2370, gold: 1800, generation: 1 },
            { day: 2430, gold: 1500, generation: 2 }, { day: 2520, gold: 2100, generation: 2 },
        ],
        wealthPeak: { gold: 4200, day: 600, generation: 1 },
    };
    return {
        name: 'Bran Ashford', firstName: 'Bran', lastName: 'Ashford', gender: 'male', age: 21, gold: 2200,
        karma: 0, renown: 10, house,
        children: [{ id: 'c1', firstName: 'Kael', birthDay: 2500, isAlive: true, age: 1 }],
        traits: { deeds: {}, progress: {}, earned: {}, notices: [] },
    };
}

describe('Annals.compose — a synthetic dynasty', () => {
    it('writes one chapter per ruler, each with its own generation\'s events', () => {
        const book = Annals.compose(dynasty(), mockWorld(2600));
        expect(book.title).toMatch(/House Ashford/);
        expect(book.chapters).toHaveLength(2);
        const [a, b] = book.chapters;
        expect(a.title).toContain('Aldric the Brave');
        expect(a.title).toContain('1st of House Ashford');
        expect(a.title).toContain('years 1000–1019');
        expect(a.text).toContain('Mira Vell');
        expect(a.text).toContain('conquers Kettlemoor');
        expect(a.text).not.toContain('Tamsin');
        expect(a.text).toMatch(/old age/);
        expect(a.text).toMatch(/3 lives/); // the deeds the reign added (infamy)
        expect(a.text).toContain('4,200'); // the fortune's peak
        expect(a.paragraphs.map(p => p.theme)).toEqual(expect.arrayContaining(['rise', 'war', 'family', 'death']));
        expect(b.live).toBe(true);
        expect(b.title).toContain('2nd of House Ashford');
        expect(b.title).toContain('to the present');
        expect(b.text).toContain('Tamsin Reed');
        expect(b.text).toContain('Kael');
        expect(b.text).toMatch(/disputed|agreed/); // the contested succession
        expect(book.legacy.paragraphs.length).toBeGreaterThan(0);
        expect(book.legacy.text).toContain('Kael');
    });

    it('turns a bare noun-phrase chronicle line into a sentence (data rewrites)', () => {
        const p = dynasty();
        p.house.history.push({ day: 2550, generation: 2, text: '👑 A claim on the throne of The Red Crown (Birthright, now 45).', tags: ['throne', 'claim'] });
        const text = Annals.compose(p, mockWorld(2600)).chapters[1].text;
        expect(text).toContain('Bran gained a claim on the throne of The Red Crown.');
    });

    it('read from the deathbed, the living reign reads as closed', () => {
        const p = dynasty();
        p._isDead = true;
        p.ailments = { deathCause: { name: 'Camp Fever' } };
        const b = Annals.compose(p, mockWorld(2600)).chapters[1];
        expect(b.live).toBe(false);
        expect(b.title).not.toContain('to the present');
        expect(b.text).not.toMatch(/not yet closed/);
    });

    it('keeps the notable: a run of petty demands does not make the book', () => {
        const book = Annals.compose(dynasty(), mockWorld(2600));
        expect(book.chapters[0].text).not.toMatch(/Grey Guild/);
    });

    it('is deterministic: the same state reads the same, and draws no RNG', async () => {
        const { Utils } = await import('../core/utils.js');
        Utils.setSeed(7);
        const before = Utils.random();
        Utils.setSeed(7);
        const one = Annals.compose(dynasty(), mockWorld(2600));
        const two = Annals.compose(dynasty(), mockWorld(2600));
        expect(Utils.random()).toBe(before); // the shared stream untouched
        expect(JSON.stringify(two)).toBe(JSON.stringify(one));
        expect(Annals.toText(two)).toBe(Annals.toText(one));
    });

    it('exports the whole book as text', () => {
        const text = Annals.toText(Annals.compose(dynasty(), mockWorld(2600)));
        expect(text.split('\n')[0]).toContain('House Ashford');
        expect(text).toContain('Legacy');
        expect(text).toContain('Aldric the Brave');
        expect(text.split('\n').length).toBeGreaterThan(10);
    });
});

describe('Annals.compose — edge cases', () => {
    it('composes for no player, a player with no House, and a legacy House without the new fields', () => {
        expect(Annals.compose(null, null).chapters).toEqual([]);
        const bare = { name: 'Wat Tyler', gender: 'male', age: 30, gold: 5 };
        const b1 = Annals.compose(bare, mockWorld(50));
        expect(b1.chapters).toHaveLength(1);
        expect(b1.chapters[0].text.length).toBeGreaterThan(20);
        // An old save: a House with a chronicle but no reigns, marks or peak
        const old = { name: 'Edda Holt', gender: 'female', age: 35, gold: 80, house: { name: 'House Holt', generation: 1, foundedDay: 1, prestige: 3, history: [{ day: 1, text: 'House Holt enters history.', tags: ['founding'] }] } };
        const b2 = Annals.compose(old, mockWorld(400));
        expect(b2.chapters).toHaveLength(1);
        expect(b2.chapters[0].text).toMatch(/Edda/);
        expect(b2.chapters[0].text).not.toMatch(/\bhis\b|\bhim\b/);
    });

    it('a fresh House marks its wealth a season at a time', () => {
        const player = { name: 'A B', gold: 100 };
        const world = mockWorld(1);
        House.initialize(player, world);
        for (let d = 1; d <= 95; d++) {
            world.day = d;
            player.gold = 100 + d;
            House.markWealth(player, world);
        }
        expect(player.house.wealthMarks.map(m => m.day)).toEqual([1, 31, 61, 91]);
        expect(player.house.wealthPeak.gold).toBe(195);
    });

    it('a new life carries the old line\'s book as "Before"', () => {
        const old = dynasty();
        const past = Annals.archive(old, mockWorld(2600));
        expect(past).toHaveLength(1);
        expect(past[0].title).toMatch(/^Before/);
        expect(past[0].chapters).toHaveLength(2);
        const stranger = { name: 'Nell Cobb', gender: 'female', age: 19, gold: 90, annalsPast: past };
        const book = Annals.compose(stranger, mockWorld(2700));
        expect(book.before).toHaveLength(1);
        expect(Annals.toText(book)).toContain('Aldric');
        // and survives a JSON round trip (it is saved with the player)
        expect(JSON.parse(JSON.stringify(past))).toEqual(past);
    });
});

describe('Annals — the court scribe', () => {
    it('is inert when the brain is off: no network, the template stands', async () => {
        const spy = vi.spyOn(LlmClient, 'isAvailable');
        const ch = Annals.compose(dynasty(), mockWorld(2600)).chapters[0];
        expect(Annals.scribeAvailable()).toBe(false);
        const res = await Annals.scribe(ch);
        expect(res.ok).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });

    it('retells a chapter when the model answers, and caches it', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        const prose = 'In the year one thousand, Aldric Ashford took the mantle of his House, and the annals remember him well. '.repeat(3);
        const chat = vi.spyOn(LlmClient, 'chat').mockResolvedValue({ ok: true, text: `<think>hmm</think>${prose}` });
        const ch = Annals.compose(dynasty(), mockWorld(2600)).chapters[0];
        const res = await Annals.scribe(ch);
        expect(res.ok).toBe(true);
        expect(res.text).toContain('Aldric Ashford');
        expect(res.text).not.toContain('think');
        const again = await Annals.scribe(ch);
        expect(again.cached).toBe(true);
        expect(chat).toHaveBeenCalledTimes(1);
        const sent = chat.mock.calls[0][0];
        expect(sent[1].content).toContain(ch.title);
        expect(sent[1].content).toContain('Mira Vell'); // the template text is the source
    });

    it('falls back on a failure or a reply too short to be a chapter', async () => {
        NpcBrain.enable(true);
        vi.spyOn(LlmClient, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(LlmClient, 'chat').mockResolvedValueOnce({ ok: false, reason: 'timeout' }).mockResolvedValueOnce({ ok: true, text: 'Too short.' });
        const ch = Annals.compose(dynasty(), mockWorld(2600)).chapters[1];
        expect((await Annals.scribe(ch)).ok).toBe(false);
        expect((await Annals.scribe(ch)).ok).toBe(false);
    });
});

describe('Annals — a played game (playtest harness)', () => {
    it('composes a non-empty book after 200 days, the same after a save and load', () => {
        const game = newGame(4242);
        for (let d = 0; d < 200; d++) {
            botDay(game, {});
            if (endDay(game).died) break;
        }
        const book = Annals.compose(game.player, game.world);
        expect(book.chapters.length).toBeGreaterThanOrEqual(1);
        const text = Annals.toText(book);
        expect(text.length).toBeGreaterThan(300);
        expect(text).toContain(game.player.firstName);
        expect(game.player.house.wealthMarks.length).toBeGreaterThanOrEqual(6);
        if (process.env.ANNALS_SAMPLE) console.log(text);

        const loaded = roundTrip(game);
        const again = Annals.compose(loaded.player, loaded.world);
        expect(again.chapters.map(c => c.title)).toEqual(book.chapters.map(c => c.title));
    }, 300000);

    it('after a new life, the old line is "Before" and the new House starts its own book', () => {
        const game = newGame(9090);
        for (let d = 0; d < 120; d++) {
            botDay(game, {});
            if (endDay(game).died) break;
        }
        const old = game.player;
        Afterlife.begin(old, game.world, 'a fever');
        const cand = Afterlife.candidates(game.world)[0];
        const res = Afterlife.becomeStranger(old, game.world, cand);
        expect(res.success).toBe(true);
        const me = res.player;
        expect(me.annalsPast).toHaveLength(1);
        expect(me.annalsPast[0].chapters[0].text).toMatch(/a fever/);
        game.player = me;
        for (let d = 0; d < 30; d++) {
            botDay(game, {});
            if (endDay(game).died) break;
        }
        const book = Annals.compose(me, game.world);
        expect(book.chapters).toHaveLength(1);
        expect(book.chapters[0].text).toContain(me.firstName);
        expect(book.before[0].title).toMatch(/^Before/);
        const loaded = roundTrip(game);
        expect(loaded.player.annalsPast).toEqual(me.annalsPast);
    }, 300000);
});

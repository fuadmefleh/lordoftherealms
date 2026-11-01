// The Annals read in the past tense: the House chronicle's lines (most
// written in the present — "Bran weds Tamsin.") are put into the past by
// data/annals.json → pastTense before they make the book. Sampled from the
// chronicle lines the systems write, and from a played game.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { Annals } from '../systems/annals.js';

beforeAll(async () => {
    await loadData();
});

// Common present-tense forms a chronicle line is written with
const PRESENT = /\b(is|are|has|weds|marries|dies|declares|ends|goes|comes|returns|swears|keeps|conquers|gains|presses|pays|grows|succeeds|stands|turns|rises|unmasks|breaks|lays|sues|cedes|demands|refuses|ignores|lends|gives|advances|raises|calls|completes|lures|buys|rides|holds|storms|besieges|enters|disbands|achieves|defaults|cools|quiets)\b/;

/** The present-tense words left in a text, outside quotes. */
function presentWords(text) {
    const bare = String(text).replace(/"[^"]*"|“[^”]*”/g, '');
    const out = [];
    const re = new RegExp(PRESENT.source, 'g');
    let m;
    while ((m = re.exec(bare))) out.push(m[1]);
    return out;
}

/** The chapter paragraphs told from the chronicle (the years), not the summaries or the legacy. */
function yearParagraphs(book) {
    return book.chapters.flatMap(c => c.paragraphs || []).filter(p => p.year != null && !p.quiet);
}

// Chronicle lines as the systems write them (House._chronicle call sites, names filled in)
const LINES = [
    ['Aldric Ashford weds Mira Vell.', ['marriage', 'love']],
    ['Bran is born to Aldric Ashford.', ['heirs', 'birth']],
    ['The Red Crown declares war on House Ashford.', ['war']],
    ['House Ashford conquers Kettlemoor.', ['conquest', 'war']],
    ['The war with The Red Crown ends: a victory.', ['war', 'peace']],
    ['House Ashford gains the office of Marshal.', ['title']],
    ['House Ashford presses its claim to the office of Chancellor.', ['title']],
    ['The Grey Crown lays siege to Kettlemoor.', ['war', 'siege']],
    ['The Grey Crown sues for peace and pays 400 gold in reparations.', ['war', 'peace']],
    ['Kettlemoor rebels and casts off House Ashford.', ['war']],
    ['The rising in Kettlemoor is crushed.', ['war']],
    ['Bran is betrothed to Isolde Varr, binding House Ashford to the Grey Crown.', ['marriage', 'heirs']],
    ['Bran is taken captive by the Grey Crown.', ['heirs', 'war']],
    ['Bran is ransomed from the Grey Crown.', ['heirs']],
    ['Bran is let go by the Grey Crown, unransomed. It is said the House would not pay for its own.', ['heirs']],
    ['Bran returns from an embassy to the Grey Crown.', ['heirs', 'court']],
    ['Bran rides as envoy to the court of the Grey Crown.', ['heirs', 'court']],
    ['Bran is fostered at the court of House Varr, a rival House — the feud cools, for now.', ['heirs', 'rival']],
    ['Come of age, Bran weds Isolde Varr as was promised, binding House Ashford to the Grey Crown.', ['marriage', 'heirs']],
    ['Mira, wife of Aldric Ashford, dies of a fever.', ['widowed']],
    ['Aldric Ashford and Mira part; the marriage is ended.', ['divorce']],
    ['The League of the Thorn is sworn against House Ashford — the Grey Crown, Varr, led by the Grey Crown.', ['coalition', 'war']],
    ['The League of the Thorn goes to war against House Ashford.', ['coalition', 'war']],
    ['The League of the Thorn breaks apart: its leader fell.', ['coalition', 'war']],
    ['House Ashford cedes Kettlemoor to the Grey Crown to break the League of the Thorn.', ['coalition', 'war']],
    ['Lord Varr of the Grey Crown swears a blood feud against House Ashford.', ['rival', 'feud', 'vendetta']],
    ['House Varr rises to rival House Ashford.', ['rival', 'war']],
    ['House Varr grows openly hostile to House Ashford.', ['rival', 'war']],
    ['House Ashford unmasks Tom Reed of Kettlemoor as an agent of House Varr.', ['rival', 'war']],
    ['Tom Reed of Kettlemoor turns against House Varr for House Ashford\'s coin.', ['rival', 'war']],
    ['House Ashford advances "Seat of Power" — hold a town.', ['ambition']],
    ['Brother Anselm completes "The Ashford Book", a chronicle of House Ashford.', ['chronicle', 'patronage', 'war']],
    ['House Ashford raises the Great Bridge at Kettlemoor.', ['greatWork', 'patronage']],
    ['The Grey Guild demands a benevolence of House Ashford.', ['demand', 'war']],
    ['House Ashford refuses the Grey Guild\'s demand. Their feud burns hotter.', ['demand', 'war']],
    ['House Ashford lends the Grey Crown 500 gold, due back in 60 days.', ['demand', 'war']],
    ['The Grey Crown defaults on House Ashford\'s loan of 500 gold.', ['demand', 'war']],
    ['Bran comes of age, raised in martial arts.', ['upbringing', 'heirs']],
    ['Mira of House Varr marries into the family.', ['marriage']],
    ['House Ashford arranges a noble match in Kettlemoor.', ['marriage']],
    ['The crisis in the Grey Crown ends: Lord Varr holds the throne.', ['throne']],
    ['The Grey Crown makes peace with the Red Crown.', ['throne']],
    ['House Ashford calls in a favor from an allied House.', ['war']],
];

function fixturePlayer(lines = LINES) {
    const day0 = 1;
    const history = [{ day: day0, generation: 1, text: 'House Ashford enters history.', tags: ['founding'] }];
    // A year apart, with a weighty tag, so each makes the book (a chapter keeps 40 at most)
    lines.forEach(([text, tags], i) => history.push({ day: day0 + 121 * (i + 1), generation: 1, text, tags: [...tags, 'war'] }));
    const house = {
        id: 'house_ashford', name: 'House Ashford', motto: '', sigil: { icon: '🛡️' },
        foundedDay: 1, prestige: 50, generation: 1, headId: 'p', stats: {}, rivals: {},
        honours: [], prestigeLog: [], roles: {}, history, reigns: [],
    };
    return {
        id: 'p', firstName: 'Aldric', lastName: 'Ashford', name: 'Aldric Ashford', gender: 'male', age: 30,
        gold: 500, renown: 0, karma: 0, house, traits: [], children: [],
    };
}

describe('the Annals read in the past tense', () => {
    it('every chronicle line the systems write is put into the past', () => {
        const world = { day: 121 * (LINES.length + 2), baseYear: 1000, kingdoms: [], getKingdom: () => null };
        // In two books: a chapter keeps its 40 weightiest events at most
        const half = Math.ceil(LINES.length / 2);
        const text = [LINES.slice(0, half), LINES.slice(half)].map(lines => {
            const paras = yearParagraphs(Annals.compose(fixturePlayer(lines), world));
            expect(paras.length).toBeGreaterThan(0);
            return paras.map(p => p.text).join('\n');
        }).join('\n');
        expect(text.split('\n').length).toBe(LINES.length);
        // Each line made the book…
        for (const needle of ['wed Mira Vell', 'was born to', 'declared war', 'conquered Kettlemoor', 'sued for peace and paid',
            'rebelled and cast off', 'was crushed', 'It was said', 'the feud cooled, for a time', 'parted; the marriage ended',
            'swore a blood feud', 'rose to rival', 'unmasked Tom Reed', 'came of age', 'made peace with', 'demanded a benevolence',
            'defaulted on']) {
            expect(text).toContain(needle);
        }
        // …and none in the present
        expect(presentWords(text)).toEqual([]);
        // Quoted titles are left as they were written
        expect(text).toContain('"The Ashford Book"');
    });

    it('plain past-tense and noun phrases are left alone', () => {
        const player = fixturePlayer();
        player.house.history = [
            { day: 1, generation: 1, text: 'House Ashford enters history.', tags: ['founding'] },
            { day: 50, generation: 1, text: 'House Ashford fed Kettlemoor through a hungry winter.', tags: ['war'] },
            { day: 90, generation: 1, text: 'The refugees of Kettlemoor became loyal subjects of House Ashford; its lands were spared.', tags: ['war'] },
        ];
        const book = Annals.compose(player, { day: 200, baseYear: 1000, kingdoms: [], getKingdom: () => null });
        const text = yearParagraphs(book).map(p => p.text).join('\n');
        expect(text).toContain('fed Kettlemoor through a hungry winter');
        expect(text).toContain('its lands were spared');
    });

    it('a played game\'s annals carry no present-tense chronicle lines', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const game = newGame(808);
            const stats = {};
            for (let d = 0; d < 160; d++) {
                botDay(game, stats);
                endDay(game);
                if (game.player.isAlive === false) break;
            }
            const book = Annals.compose(game.player, game.world);
            const bad = yearParagraphs(book).filter(p => presentWords(p.text).length).map(p => p.text);
            expect(bad).toEqual([]);
        } finally {
            logSpy.mockRestore();
            warnSpy.mockRestore();
        }
    }, 120000);
});

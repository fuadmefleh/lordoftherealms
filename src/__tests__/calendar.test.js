// The Calendar (systems/calendar.js + ui/actionMenu/calendar.js): today's
// date, the days played, the year's marks (fairs, lean weeks, harvest,
// seasons' turns, the family's aging day) and the player's own dated matters.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Calendar } from '../systems/calendar.js';
import { Upbringing } from '../systems/upbringing.js';
import { loadData, newGame } from './playtest/harness.js';

let ActionMenu;
beforeAll(async () => {
    await loadData();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
});

describe('the date', () => {
    it('reads the day of the year, of the season, the season and the year', () => {
        const w = { day: 1, baseYear: 853 };
        expect(Calendar.date(w)).toMatchObject({ day: 1, year: 853, season: 'Spring', dayOfYear: 1, dayInSeason: 1, daysInYear: 120 });
        expect(Calendar.date({ day: 51, baseYear: 853 })).toMatchObject({ season: 'Summer', dayOfYear: 51, dayInSeason: 21, year: 853 });
        expect(Calendar.date({ day: 121, baseYear: 853 })).toMatchObject({ season: 'Spring', dayOfYear: 1, year: 854 });
        expect(Calendar.label({ day: 240, baseYear: 853 })).toBe('Day 30 of Winter, Year 854');
        expect(Calendar.date({ day: 1, baseYear: 853 }).lean).toBe(true);
        expect(Calendar.date({ day: 60, baseYear: 853 }).lean).toBe(false);
    });

    it('counts the days played from the chronicle\'s first day', () => {
        expect(Calendar.daysPlayed({ day: 1 })).toBe(1);
        expect(Calendar.daysPlayed({ day: 4312 })).toBe(4312);
    });

    it('finds the next occurrence of a day of the year', () => {
        expect(Calendar.nextOn({ day: 10 }, 22)).toBe(22);
        expect(Calendar.nextOn({ day: 30 }, 22)).toBe(142);
        expect(Calendar.nextOn({ day: 22 }, 22)).toBe(142);
        expect(Calendar.nextOn({ day: 22 }, 22, true)).toBe(22);
        // Everyone ages on the year's last day
        expect(Calendar.agingDay({ day: 1 })).toBe(120);
        expect(Calendar.agingDay({ day: 120 })).toBe(240);
    });
});

describe('the year\'s marks', () => {
    it('marks the fairs, the lean weeks, the harvest, the seasons\' turns and the aging day', () => {
        const marks = Calendar.yearMarks();
        const kinds = new Set(marks.map(m => m.kind));
        for (const k of ['fair', 'lean', 'harvest', 'season', 'birthday']) expect(kinds.has(k), k).toBe(true);
        expect(Calendar.marksOn(22, marks).some(m => m.kind === 'fair' && /Spring Fair/.test(m.text))).toBe(true);
        expect(Calendar.marksOn(60, marks).some(m => m.kind === 'harvest')).toBe(true);
        expect(Calendar.marksOn(31, marks).some(m => m.kind === 'season' && /Summer/.test(m.text))).toBe(true);
        expect(Calendar.marksOn(110, marks).some(m => m.kind === 'lean')).toBe(true);
        expect(Calendar.marksOn(120, marks).some(m => m.kind === 'birthday')).toBe(true);
    });

    it('lists the coming marks with their real dates, a fair under way first', () => {
        const ahead = Calendar.yearAhead({ day: 23 }, 40);
        expect(ahead[0]).toMatchObject({ kind: 'fair', inDays: 0, now: true });
        expect(ahead.map(e => e.day)).toEqual([...ahead.map(e => e.day)].sort((a, b) => a - b));
        expect(ahead.every(e => e.inDays <= 40)).toBe(true);
    });
});

describe('the player\'s dated matters', () => {
    it('gathers letters, petitions, ultimatums, quests, birthdays and children coming of age', () => {
        const game = newGame(91);
        const { world, player } = game;
        world.day = 130; // day 10 of the year
        player.age = 30;
        player.petitions = { pending: [{ title: 'A boundary dispute', expiresDay: 140 }], scheduled: [], history: [], notable: [] };
        player.realmWars = { wars: {}, ultimatums: { k1: { name: 'Valdoria', dueDay: 135, tribute: 400 } }, truces: {} };
        player.quests.active.push({ id: 'q1', title: 'Clear the road', deadlineDay: 200, objectives: [] });
        const child = { id: 'c1', firstName: 'Ada', age: 14, isAlive: true, traits: [], skills: {} };
        Upbringing.ensure(child);
        player.children = [child, { id: 's1', firstName: 'Bram', age: 10, isAlive: true, isSibling: true }];

        const up = Calendar.upcoming(world, player, 120 * 5);
        const by = (k) => up.filter(e => e.kind === k);
        expect(by('ultimatum')[0]).toMatchObject({ day: 135, inDays: 5 });
        expect(by('petition')[0]).toMatchObject({ day: 140, inDays: 10 });
        expect(by('quest')[0]).toMatchObject({ day: 200 });
        // Ages turn on the year's last day: 31 on day 240, Ada 16 two aging days on (day 360)
        expect(by('birthday')[0]).toMatchObject({ day: 240, text: expect.stringMatching(/31/) });
        expect(by('child')).toHaveLength(1); // a sibling's coming of age is not yours to mark
        expect(by('child')[0]).toMatchObject({ day: 360, text: expect.stringMatching(/Ada/) });
        // Soonest first, and nothing past the horizon
        expect(up.map(e => e.day)).toEqual([...up.map(e => e.day)].sort((a, b) => a - b));
        expect(Calendar.upcoming(world, player, 7).map(e => e.kind)).toEqual(['ultimatum']);
    }, 60000);

    it('marks nothing without a player and survives a broken system', () => {
        expect(Calendar.upcoming({ day: 5 }, null)).toEqual([]);
        const odd = { age: 20, quests: { active: [{ deadlineDay: 'soon' }] }, children: [null], realmWars: { ultimatums: { a: null } } };
        expect(() => Calendar.upcoming({ day: 5 }, odd)).not.toThrow();
    });
});

describe('the Calendar panel', () => {
    it('shows the date, the days played, the year\'s grid and what is coming up', () => {
        const game = newGame(92);
        game.world.day = 251; // day 11 of Spring, the third year
        game.player.age = 22;
        let shown = null;
        game.ui = { showCustomPanel: vi.fn((title, html) => { shown = { title, html }; }), showNotification: vi.fn() };
        ActionMenu.showCalendar(game);
        expect(shown.title).toMatch(/Calendar/);
        expect(shown.html).toContain(`Day 11 of Spring, Year ${game.world.baseYear + 2}`);
        expect(shown.html).toContain('Day 11 of 120 of the year');
        expect(shown.html).toContain('251');
        expect(shown.html).toMatch(/days played \(2 years, 11 days\)/);
        // Four seasons of thirty day cells, today outlined
        expect((shown.html.match(/title="Day \d+ of (Spring|Summer|Autumn|Winter) \(day \d+ of the year\)/g) || []).length).toBe(120);
        expect(shown.html).toContain('outline:2px solid var(--gold)');
        expect(shown.html).toContain('Coming up');
        expect(shown.html).toMatch(/Spring Fair/);
    }, 60000);
});

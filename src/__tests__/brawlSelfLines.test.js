// A townsperson asked about a fight can say why (systems/brawls.js selfLines,
// fed to the AI voice's prompt by ui/npcDialog/helpers.js).
import { describe, it, expect, beforeAll } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Brawls } from '../systems/brawls.js';

beforeAll(async () => { await loadData(); });

describe('a fighter knows their own fight', () => {
    const s = {
        folk: { people: [{ id: 1, name: 'Ada Reed' }, { id: 2, name: 'Bram Cole' }] },
        brawls: { feuds: { '1|2': { a: 1, b: 2, why: 'fight', d: 10, heat: 40 } }, log: [{ d: 10, a: 'Ada Reed', b: 'Bram Cole', ap: 1, bp: 2, how: 'watch', cause: 'tavern', place: 'tavern', arrested: true }], barred: {} },
    };
    it('names the other, the cause, who started it and how it ended', () => {
        const lines = Brawls.selfLines({ day: 11 }, s, s.folk.people[1], 11);
        expect(lines[0]).toMatch(/Yesterday you came to blows with Ada Reed over drink and hot tempers/);
        expect(lines[0]).toMatch(/they started it/);
        expect(lines.some(l => /grudge against Ada Reed/.test(l))).toBe(true);
        const mine = Brawls.selfLines({ day: 11 }, s, s.folk.people[0], 11);
        expect(mine[0]).toMatch(/you started it.*watch took you/);
    });
    it('a fight on the street now, even for someone off the roll', () => {
        const lines = Brawls.selfLines({ day: 11 }, s, null, 11, { foe: 'a drunk', cause: 'market' });
        expect(lines).toEqual([expect.stringMatching(/fight right now .* with a drunk, over a haggle gone wrong/)]);
    });
    it('nothing to say for someone who has not fought', () => {
        expect(Brawls.selfLines({ day: 11 }, s, { id: 9, name: 'Cy' }, 11)).toEqual([]);
    });
});

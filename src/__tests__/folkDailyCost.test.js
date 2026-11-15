// The towns' daily trade and sickness do their per-town lookups once, not once
// per pair or per purchase (systems/illness.js _travel; systems/townTrade.js step),
// the barter round asks who has anything to spare without listing it all
// (_hasSurplus), and the burials look only at the unburied (townWorship.js
// catchUp) — the same results, for less work.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { Illness } from '../systems/illness.js';
import { TownTrade } from '../systems/townTrade.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { TownWorship } from '../systems/townWorship.js';

beforeAll(() => {
    DataLoader._gamedata = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/gamedata.json'), 'utf-8'));
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Illness._travel', () => {
    it('asks whether a town has shut its gates once a town, however many sick towns are near', () => {
        const towns = [];
        for (let i = 0; i < 8; i++) {
            towns.push({ name: `T${i}`, type: 'village', q: 10 + i, r: 10, population: 300, kingdom: 1, sickness: { k: 'flux', d: 1, until: 999, abs: true, from: null } });
        }
        const world = { day: 2, generationParams: { seed: 7 }, activeEvents: [] };
        const spy = vi.spyOn(Illness, 'quarantined').mockReturnValue(false);
        Illness._travel(world, towns, 2);
        expect(spy.mock.calls.length).toBeLessThanOrEqual(towns.length);
        expect(spy.mock.calls.length).toBeGreaterThan(0);
    });
});

describe('TownTrade.sellerOf', () => {
    function folkWithHands() {
        const people = [];
        for (let i = 0; i < 12; i++) {
            people.push({ id: i, first: `P${i}`, last: 'Stone', gender: 'male', born: -40 * 120, died: null, role: 'villager', traits: [], parents: [], kids: [], away: null, log: [], job: { id: i % 3 ? 'stallkeeper' : 'merchant' } });
        }
        return { q: 3, r: 4, people, annals: [] };
    }

    it('picks the same seller within a trade step as outside one, reckoning the hands once a step', () => {
        const folk = folkWithHands();
        const outside = ['grain', 'bread', 'tools', 'cloth'].map(g => TownTrade.sellerOf(folk, g, 50, 'h1').id);
        const spy = vi.spyOn(Townsfolk, 'residents');
        // (a step's memo, as TownTrade.step makes it)
        vi.spyOn(TownTrade, '_step').mockImplementation((world, s, f, day) => ['grain', 'bread', 'tools', 'cloth', 'grain', 'bread'].map(g => TownTrade.sellerOf(f, g, day, 'h1').id));
        const inside = TownTrade.step({ day: 50 }, { folk, q: 3, r: 4 }, 50);
        expect(inside.slice(0, 4)).toEqual(outside);
        expect(spy.mock.calls.length).toBe(1);
    });
});

describe('TownTrade._hasSurplus', () => {
    it('says the same as a non-empty _surplus, for larders over and under target and producers\' wares', () => {
        const rates = [{ g: 'grain', rate: 0.5, group: 'food', spoil: 0 }, { g: 'cloth', rate: 0.01, group: 'clothes', spoil: 0 }];
        const adults = [{ id: 1 }, { id: 2 }];
        const hh = (key) => ({ key, adults, members: adults, weight: 2 });
        const cases = [
            { hh: { a: { l: { grain: 1 } } }, wares: {} },              // under target
            { hh: { a: { l: { grain: 40 } } }, wares: {} },             // over target
            { hh: { a: { l: { salt: 0.3 } } }, wares: {} },             // a good no rate asks for
            { hh: { a: { l: {} } }, wares: { 2: { tools: 0 } } },       // nothing in the wares
            { hh: { a: { l: {} } }, wares: { 2: { tools: 1.5 } } },     // a producer's wares
            { hh: {}, wares: {} },                                      // no larder yet
        ];
        for (const st of cases) {
            expect(TownTrade._hasSurplus(st, hh('a'), rates)).toBe(Object.keys(TownTrade._surplus(st, hh('a'), rates)).length > 0);
        }
    });
});

describe('TownWorship.catchUp', () => {
    it('buries the dead once, however many days are caught up, and leaves the long-buried alone', () => {
        const people = [
            { id: 1, first: 'A', last: 'Stone', gender: 'male', born: -4000, died: 103, cause: 'a fever', parents: [], kids: [], log: [], away: null },
            { id: 2, first: 'B', last: 'Stone', gender: 'female', born: -4000, died: 20, buried: 21, parents: [], kids: [], log: [], away: null },
            { id: 3, first: 'C', last: 'Stone', gender: 'female', born: -4000, died: null, parents: [], kids: [], log: [], away: null },
        ];
        const folk = { q: 1, r: 1, people, annals: [], worshipDay: 100 };
        const s = { name: 'Ashford', q: 1, r: 1, folk };
        const annal = vi.spyOn(Townsfolk, '_annal').mockImplementation(() => {});
        vi.spyOn(TownWorship, 'isHolyDay').mockReturnValue(false);
        TownWorship.catchUp({ day: 110, generationParams: { seed: 7 } }, s, 110, null);
        expect(people[0].buried).toBe(103);
        expect(people[1].buried).toBe(21);
        expect(people[2].buried).toBeUndefined();
        expect(annal.mock.calls.length).toBe(1);
        expect(folk.worshipDay).toBe(110);
    });
});

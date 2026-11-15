// The towns' daily trade and sickness do their per-town lookups once, not once
// per pair or per purchase (systems/illness.js _travel; systems/townTrade.js step)
// — the same results, for less work.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { Illness } from '../systems/illness.js';
import { TownTrade } from '../systems/townTrade.js';
import { Townsfolk } from '../systems/townsfolk.js';

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

// The rosters stay affordable over a century (2026-11-17, TODO "Townsfolk cost grows
// with the towns rostered"): towns far from the player live their trade and their sick
// in longer steps (Townsfolk.distantEvery), and the save writes a town's arrays of
// like records as tables (core/saveCodec.js) — the same data back.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { SaveCodec } from '../core/saveCodec.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Illness } from '../systems/illness.js';
import { TownTrade } from '../systems/townTrade.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(() => {
    DataLoader._gamedata = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/gamedata.json'), 'utf-8'));
});
afterEach(() => { vi.restoreAllMocks(); });

const Y = 120;

function townAt(q, r, n = 12) {
    const people = [];
    for (let i = 0; i < n; i++) {
        people.push({
            id: i, first: `P${i}`, last: 'Stone', gender: i % 2 ? 'male' : 'female', born: -30 * Y - i * 40, died: null, cause: null,
            role: i < 3 ? 'child' : 'villager', traits: ['kind'], spouse: null, parents: [], kids: [], away: null, log: [],
        });
    }
    const folk = { v: 1, q, r, n, tick: 1000, people, annals: [] };
    return { name: `T${q}`, type: 'village', q, r, population: 200, kingdom: null, folk };
}

describe('Townsfolk.distantEvery', () => {
    it('is 1 near the player, with no player, or off; the configured steps far off', () => {
        const D = Townsfolk.config().distant;
        const s = townAt(10, 10);
        expect(Townsfolk.distantEvery({}, s, null, 'trade')).toBe(1);
        expect(Townsfolk.distantEvery({}, s, { q: 12, r: 11 }, 'trade')).toBe(1);
        // (a couple of days off: the distant steps; beyond farHexes the far ones)
        expect(Townsfolk.distantEvery({}, s, { q: 20, r: 10 }, 'trade')).toBe(D.tradeEvery);
        expect(Townsfolk.distantEvery({}, s, { q: 20, r: 10 }, 'illness')).toBe(D.illnessEvery);
        expect(Townsfolk.distantEvery({}, s, { q: 40, r: 10 }, 'trade')).toBe(D.farTradeEvery);
        expect(Townsfolk.distantEvery({}, s, { q: 40, r: 10 }, 'illness')).toBe(D.farIllnessEvery);
        expect(D.farTradeEvery).toBeGreaterThanOrEqual(D.tradeEvery);
        expect(D.farIllnessEvery).toBeGreaterThanOrEqual(D.illnessEvery);
        const was = D.enabled;
        D.enabled = false;
        try { expect(Townsfolk.distantEvery({}, s, { q: 40, r: 10 }, 'trade')).toBe(1); } finally { D.enabled = was; }
    });
});

describe('Illness.catchUp far from the player', () => {
    it('lives the sick in steps of illnessEvery × stepDays, the steps\' length passed on', () => {
        const step = Illness.config().stepDays;
        const every = Townsfolk.config().distant.farIllnessEvery;
        const world = { day: 1000, generationParams: { seed: 3 }, activeEvents: [] };
        const near = townAt(10, 10), far = townAt(10, 10);
        const spy = vi.spyOn(Illness, '_step');
        Illness.catchUp(world, near, near.folk, 1000, [], { q: 10, r: 10 });
        const t0 = near.folk.ill.tick;
        Illness.catchUp(world, far, far.folk, 1000, [], { q: 10, r: 10 });
        spy.mockClear();
        Illness.catchUp(world, near, near.folk, t0 + 24, [], { q: 11, r: 10 });
        const nearSteps = spy.mock.calls.map(c => c[6]);
        spy.mockClear();
        Illness.catchUp(world, far, far.folk, t0 + 24, [], { q: 45, r: 10 });
        const farSteps = spy.mock.calls.map(c => c[6]);
        expect(nearSteps.length).toBe(24 / step);
        expect(farSteps.length).toBe(24 / (step * every));
        expect(farSteps.every(n => n === step * every)).toBe(true);
        // (either way the town's clock reaches the day)
        expect(near.folk.ill.tick).toBe(t0 + 24);
        expect(far.folk.ill.tick).toBe(t0 + 24);
    });
});

describe('TownTrade far from the player', () => {
    it('trades in longer steps, each household\'s larder stocked to last the step', () => {
        const every = Townsfolk.config().distant.tradeEvery;
        const C = TownTrade.config();
        const r = { g: 'bread', rate: 0.5, group: 'food', spoil: 0 };
        const hh = { key: 'h1', weight: 2, adults: [], members: [] };
        const plain = TownTrade.target(hh, r);
        let inStep = null;
        vi.spyOn(TownTrade, '_step').mockImplementation(() => { inStep = TownTrade.target(hh, r); return {}; });
        TownTrade.step({ day: 50 }, { folk: { q: 1, r: 1, people: [] }, q: 1, r: 1 }, 50, null, C.stepDays * every);
        const cover = C.household.cover.food;
        expect(inStep).toBeCloseTo(plain * Math.max(1, C.stepDays * every / cover), 6);
        // (outside a step, or a near town's step: as before)
        TownTrade.step({ day: 54 }, { folk: { q: 1, r: 1, people: [] }, q: 1, r: 1 }, 54);
        expect(inStep).toBeCloseTo(plain, 6);
        expect(TownTrade.target(hh, r)).toBeCloseTo(plain, 6);
    });

    it('a far town\'s catch-up steps every farTradeEvery × stepDays', () => {
        const every = Townsfolk.config().distant.farTradeEvery;
        const step = TownTrade.config().stepDays;
        const s = townAt(10, 10);
        const calls = [];
        vi.spyOn(TownTrade, 'step').mockImplementation((w, t, d, p, span) => { calls.push([d, span]); t.townTrade.day = d; return {}; });
        vi.spyOn(TownTrade, '_seedPedlars').mockImplementation(() => {});
        const world = { day: 1000 };
        TownTrade.catchUp(world, s, 1000, { q: 45, r: 10 });
        calls.length = 0;
        TownTrade.catchUp(world, s, 1000 + step * every * 4, { q: 45, r: 10 });
        expect(calls.length).toBe(4);
        expect(calls.every(([, span]) => span === step * every)).toBe(true);
        calls.length = 0;
        TownTrade.catchUp(world, s, 1000 + step * every * 4 + step * 3, { q: 10, r: 10 });
        expect(calls.length).toBeGreaterThanOrEqual(2);
        expect(calls.every(([, span]) => span == null)).toBe(true);
    });
});

describe('SaveCodec', () => {
    const clone = (v) => JSON.parse(JSON.stringify(v));

    it('gives back what a JSON round trip would, key order and all', () => {
        const town = townAt(3, 4, 30);
        town.folk.people[5].log = [{ d: 1, k: 'wed', o: 2 }, { d: 4, k: 'sick', x: 'flux' }, { d: 9, k: 'job', x: 'tookUp|miller' }, { d: 12, k: 'brawl', o: 3, x: 'won' }];
        town.folk.people[6].away = { d: 5, to: 'Greymoor', mig: 1 };
        town.folk.people[7].gone = undefined;          // (JSON drops it)
        town.folk.people[8].fn = () => 1;               // (and this)
        town.folk.people[9].when = new Date(0);         // (toJSON)
        town.folk.people[10].odd = [1, undefined, NaN, { a: 1 }];
        town.folk._index = new Map([[1, 2]]);           // (a Map: {} as JSON writes it)
        town.graveyard = { grounds: { town: { plots: [{ pid: 1, name: 'A' }, null, { pid: 2, name: 'B' }, { pid: 3 }, { pid: 4, name: 'D' }] } } };
        town.mixed = [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }, { e: 5 }];   // (too many shapes: left as it is)
        const packed = SaveCodec.pack(town);
        const json = JSON.stringify(packed);
        expect(json.length).toBeLessThan(JSON.stringify(town).length);
        const back = SaveCodec.unpack(JSON.parse(json));
        expect(back).toEqual(clone(town));
        expect(JSON.stringify(back)).toBe(JSON.stringify(town));
        // (the tables are there: the people written once by their keys)
        expect(Array.isArray(packed.folk.people)).toBe(false);
        expect(Array.isArray(packed.mixed)).toBe(true);
    });

    it('passes unpacked data (an older save) through unchanged; never sets a prototype', () => {
        const old = clone(townAt(1, 2, 6));
        expect(SaveCodec.unpack(clone(old))).toEqual(old);
        const evil = SaveCodec.unpack(JSON.parse('{"__proto__": {"x": 1}, "a": [{"__proto__": 1}, {"__proto__": 2}, {"__proto__": 3}, {"__proto__": 4}]}'));
        expect(evil.x).toBeUndefined();
        expect(Object.getPrototypeOf(evil)).toBe(Object.prototype);
        const again = SaveCodec.unpack(JSON.parse(JSON.stringify(SaveCodec.pack(evil))));
        expect(JSON.stringify(again)).toBe(JSON.stringify(evil));
    });
});

describe('SaveLoad.serializeTiles', () => {
    it('leaves the empty wild\'s nulls out and packs the settlement; the shared first property not written twice', () => {
        const prop = { type: 'farm' };
        const s = townAt(1, 0, 8);
        const tiles = [[
            { explored: false, kingdom: null, settlement: null, improvement: null },
            { explored: true, kingdom: 2, settlement: s, improvement: null, playerProperties: [prop], playerProperty: prop },
        ]];
        const out = JSON.parse(JSON.stringify(SaveLoad.serializeTiles(tiles)));
        expect(out[0][0]).toEqual({});
        expect(out[0][1].playerProperty).toBeUndefined();
        expect(out[0][1].kingdom).toBe(2);
        expect(SaveCodec.unpack(out[0][1].settlement)).toEqual(JSON.parse(JSON.stringify(s)));
    });
});

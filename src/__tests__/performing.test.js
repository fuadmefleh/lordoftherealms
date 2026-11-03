// systems/performing.js — the arithmetic of busking, prayer rites and
// meditation done in person on the street map.
import { describe, it, expect, beforeAll } from 'vitest';
import { Performing } from '../systems/performing.js';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const rng = () => Utils.random();

describe('Performing data', () => {
    it('has every busking act from earlyJobs', () => {
        const ids = DataLoader.get('earlyJobs').busking.performances.map(p => p.id);
        for (const id of ids) expect(Performing.act(id), id).toBeTruthy();
    });
    it('has a tell for every townsfolk type and a fitting fortune for each', () => {
        const b = Performing.data().busking;
        for (const type of Object.keys(b.tells)) {
            expect(b.fortunes.some(f => Performing.fortuneFits(f, type)), type).toBe(true);
        }
    });
});

describe('crowd and score', () => {
    it('expects bigger crowds in bigger places, never below the floor', () => {
        const cfg = { expectedPerCrowd: 4, minExpected: 1.5 };
        expect(Performing.expectedCrowd(1.8, cfg)).toBeGreaterThan(Performing.expectedCrowd(1, cfg));
        expect(Performing.expectedCrowd(0.1, cfg)).toBe(1.5);
    });
    it('crowd quality is the average set worth against the expected crowd, capped at 1', () => {
        expect(Performing.crowdQuality([2, 4], 6)).toBeCloseTo(0.5);
        expect(Performing.crowdQuality([20], 4)).toBe(1);
        expect(Performing.crowdQuality([], 4)).toBe(0);
    });
    it('an empty street scores nothing; a full one on time scores 100; slow costs', () => {
        expect(Performing.performScore({ done: 3, total: 3, elapsedHours: 1, parHours: 1.5, quality: 0 })).toBe(0);
        expect(Performing.performScore({ done: 3, total: 3, elapsedHours: 1, parHours: 1.5, quality: 1 })).toBe(100);
        expect(Performing.performScore({ done: 3, total: 3, elapsedHours: 3, parHours: 1.5, quality: 1 })).toBe(50);
        expect(Performing.performScore({ done: 1, total: 3, elapsedHours: 0.5, parHours: 1.5, quality: 1 })).toBe(33);
    });
});

describe('the acts', () => {
    it('a deft juggler fumbles less', () => {
        const cfg = { base: 0.45, perStat: 0.04, min: 0.05, max: 0.4 };
        expect(Performing.dropChance(9, cfg)).toBeLessThan(Performing.dropChance(3, cfg));
        expect(Performing.dropChance(20, cfg)).toBe(0.05);
        expect(Performing.dropChance(0, cfg)).toBe(0.4);
    });
    it('songs suit their hours, including past midnight, and repeating one costs', () => {
        const cfg = { inHours: 1.25, outHours: 0.7, repeat: 0.8 };
        const drinking = { id: 'drinking', hours: [17, 26] };
        expect(Performing.inHours(drinking.hours, 1)).toBe(true);
        expect(Performing.inHours(drinking.hours, 9)).toBe(false);
        expect(Performing.songMult(drinking, 20, null, cfg)).toBe(1.25);
        expect(Performing.songMult(drinking, 9, null, cfg)).toBe(0.7);
        expect(Performing.songMult(drinking, 20, 'drinking', cfg)).toBeCloseTo(1.0);
    });
    it("a tale's same turn twice running falls flat; a fresh kind lands best", () => {
        const cfg = { repeat: 0.5, fresh: 1.2, again: 1.0 };
        expect(Performing.beatMult('laugh', 'laugh', ['laugh'], cfg)).toBe(0.5);
        expect(Performing.beatMult('thrill', 'laugh', ['laugh'], cfg)).toBe(1.2);
        expect(Performing.beatMult('laugh', 'thrill', ['laugh', 'thrill'], cfg)).toBe(1.0);
    });
    it('offers beats of distinct moods', () => {
        Utils.setSeed(7);
        const beats = Performing.data().busking.beats;
        const picks = Performing.pickBeats(beats, 3, rng);
        expect(picks).toHaveLength(3);
        expect(new Set(picks.map(b => b.mood)).size).toBe(3);
    });
    it('a sermon too cold drifts, the sweet spot pays, too hot frightens', () => {
        const cfg = Performing.data().busking.fervor;
        const tones = Object.fromEntries(Performing.data().busking.tones.map(t => [t.id, t]));
        expect(Performing.fervorStep(20, tones.mercy, cfg).mood).toBe('cold');
        const s = Performing.fervorStep(40, tones.fire, cfg);
        expect(s.mood).toBe('sweet');
        expect(s.mult).toBeGreaterThan(1);
        const f = Performing.fervorStep(80, tones.doom, cfg);
        expect(f.mood).toBe('frightened');
        expect(f.mult).toBeLessThan(1);
    });
    it('fortune choices hold exactly one that fits the hearer, shuffled', () => {
        Utils.setSeed(11);
        const fortunes = Performing.data().busking.fortunes;
        for (const type of ['farmer', 'guard', 'noble', 'child']) {
            const c = Performing.fortuneChoices(fortunes, type, rng);
            expect(c).toHaveLength(3);
            expect(c.filter(f => Performing.fortuneFits(f, type))).toHaveLength(1);
        }
    });
    it('is reproducible for a seed', () => {
        const fortunes = Performing.data().busking.fortunes;
        Utils.setSeed(99);
        const a = Performing.fortuneChoices(fortunes, 'merchant', rng).map(f => f.text);
        Utils.setSeed(99);
        const b = Performing.fortuneChoices(fortunes, 'merchant', rng).map(f => f.text);
        expect(a).toEqual(b);
    });
});

describe('rites and stillness', () => {
    it('a whole, quiet, timely rite is near 1; disturbances and slowness cost', () => {
        const base = { done: 5, total: 5, elapsedHours: 0.5, parHours: 1, disturbances: 0, stat: 10 };
        expect(Performing.riteQuality(base)).toBe(1);
        expect(Performing.riteQuality({ ...base, disturbances: 3 })).toBeLessThan(Performing.riteQuality(base));
        expect(Performing.riteQuality({ ...base, elapsedHours: 3 })).toBeLessThan(Performing.riteQuality(base));
        expect(Performing.riteQuality({ ...base, done: 0 })).toBe(0);
    });
    it('stillness: sitting the full time undisturbed is best; passers-by and getting up cost, less at a holy site', () => {
        const cfg = Performing.data().meditation;
        const full = { sat: 30, needed: 30, disturbances: 0, breaks: 0, stat: 5 };
        const q = Performing.stillnessQuality(full, cfg);
        expect(q).toBe(1);
        const busy = Performing.stillnessQuality({ ...full, disturbances: 3 }, cfg);
        expect(busy).toBeLessThan(q);
        expect(Performing.stillnessQuality({ ...full, disturbances: 3, holy: true }, cfg)).toBeGreaterThan(busy);
        expect(Performing.stillnessQuality({ ...full, breaks: 2 }, cfg)).toBeLessThan(q);
        expect(Performing.stillnessQuality({ ...full, sat: 0 }, cfg)).toBe(0);
        expect(Performing.stillnessQuality({ ...full, disturbances: 50 }, cfg)).toBe(0.05);
    });
    it('fills placeholders in lines', () => {
        expect(Performing.line('{n} stopped to watch.', { n: 4 })).toBe('4 stopped to watch.');
        expect(Performing.line('{x} stays', {})).toBe('{x} stays');
    });
});

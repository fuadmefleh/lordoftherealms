/**
 * Pure logic tests for The Forge minigame (src/ui/minigames/forge/forgeLogic.js).
 *
 * The scoring model is deterministic and DOM-free, so these are plain unit tests
 * with no fixtures beyond the functions themselves.
 */
import { describe, it, expect } from 'vitest';
import {
    FORGE,
    computeZones,
    classifyStrike,
    updateHeat,
    strikePoints,
    masterworkBonus,
    idealPoints,
    aggregateScore,
} from '../ui/minigames/forge/forgeLogic.js';

describe('computeZones', () => {
    it('nests perfect < good < weak', () => {
        const z = computeZones(5, 0);
        expect(z.perfect).toBeLessThan(z.good);
        expect(z.good).toBeLessThan(z.weak);
    });

    it('widens zones as Strength increases', () => {
        const weak = computeZones(2, 0);
        const strong = computeZones(9, 0);
        expect(strong.perfect).toBeGreaterThan(weak.perfect);
        expect(strong.good).toBeGreaterThan(weak.good);
        expect(strong.weak).toBeGreaterThan(weak.weak);
    });

    it('shrinks zones across rounds', () => {
        const early = computeZones(5, 0);
        const late = computeZones(5, 4);
        expect(late.perfect).toBeLessThan(early.perfect);
        expect(late.good).toBeLessThan(early.good);
    });

    it('never shrinks below the floor fraction of the base width', () => {
        const base = computeZones(5, 0);
        const veryLate = computeZones(5, 999);
        expect(veryLate.perfect).toBeGreaterThanOrEqual(base.perfect * FORGE.SHRINK_FLOOR - 1e-9);
    });

    it('clamps out-of-range Strength without producing negative widths', () => {
        const z = computeZones(50, 3);
        expect(z.perfect).toBeGreaterThan(0);
        expect(z.good).toBeGreaterThan(0);
    });
});

describe('classifyStrike', () => {
    const zones = { perfect: 5, good: 12, weak: 20 };

    it('dead center is a perfect strike', () => {
        const r = classifyStrike(50, zones);
        expect(r.tier).toBe('perfect');
        expect(r.quality).toBe(1.0);
    });

    it('classifies each nested band at its boundary', () => {
        expect(classifyStrike(50 + zones.perfect, zones).tier).toBe('perfect'); // inclusive edge
        expect(classifyStrike(50 + zones.perfect + 0.01, zones).tier).toBe('good');
        expect(classifyStrike(50 + zones.good, zones).tier).toBe('good');
        expect(classifyStrike(50 + zones.good + 0.01, zones).tier).toBe('weak');
        expect(classifyStrike(50 + zones.weak, zones).tier).toBe('weak');
        expect(classifyStrike(50 + zones.weak + 0.01, zones).tier).toBe('miss');
    });

    it('good quality rises toward the center', () => {
        const near = classifyStrike(50 + zones.perfect + 0.5, zones).quality;
        const far = classifyStrike(50 + zones.good, zones).quality;
        expect(near).toBeGreaterThan(far);
        expect(far).toBeCloseTo(0.6, 5);
    });

    it('charged halves the perfect window', () => {
        // A point just inside the normal perfect window falls to Good when charged.
        const pos = 50 + zones.perfect * 0.75;
        expect(classifyStrike(pos, zones, { charged: false }).tier).toBe('perfect');
        expect(classifyStrike(pos, zones, { charged: true }).tier).toBe('good');
    });

    it('is symmetric around the center', () => {
        expect(classifyStrike(50 - 8, zones).tier).toBe(classifyStrike(50 + 8, zones).tier);
    });
});

describe('updateHeat', () => {
    it('adds heat on perfect and good', () => {
        expect(updateHeat(0, 'perfect')).toBe(1);
        expect(updateHeat(2, 'good')).toBe(3);
    });

    it('holds heat on weak', () => {
        expect(updateHeat(3, 'weak')).toBe(3);
    });

    it('resets heat on miss', () => {
        expect(updateHeat(5, 'miss')).toBe(0);
    });

    it('clamps at HEAT_MAX', () => {
        expect(updateHeat(FORGE.HEAT_MAX, 'perfect')).toBe(FORGE.HEAT_MAX);
    });
});

describe('strikePoints', () => {
    it('is monotonic in quality', () => {
        expect(strikePoints(1.0, 2)).toBeGreaterThan(strikePoints(0.5, 2));
    });

    it('is monotonic in heat for positive quality', () => {
        expect(strikePoints(1.0, 5)).toBeGreaterThan(strikePoints(1.0, 0));
    });

    it('doubles when charged', () => {
        expect(strikePoints(1.0, 3, { charged: true })).toBeCloseTo(strikePoints(1.0, 3) * 2, 9);
    });

    it('is zero for a missed (zero-quality) strike regardless of heat', () => {
        expect(strikePoints(0, 5)).toBe(0);
    });
});

describe('masterworkBonus', () => {
    it('rewards a perfect finale most', () => {
        expect(masterworkBonus('perfect')).toBeGreaterThan(masterworkBonus('good'));
        expect(masterworkBonus('good')).toBeGreaterThan(masterworkBonus('weak'));
        expect(masterworkBonus('weak')).toBe(1.0);
        expect(masterworkBonus('miss')).toBe(1.0);
    });
});

describe('aggregateScore', () => {
    const perfectStrike = (heat, masterwork = false) => ({
        tier: 'perfect',
        points: strikePoints(1.0, heat),
        masterwork,
    });

    // A flawless, non-charged run building heat 1..5,5 with a perfect masterwork.
    const flawlessRun = () => {
        let heat = 0;
        const strikes = [];
        for (let i = 0; i < FORGE.TOTAL_ROUNDS; i++) {
            heat = updateHeat(heat, 'perfect');
            strikes.push(perfectStrike(heat, i === FORGE.TOTAL_ROUNDS - 1));
        }
        return strikes;
    };

    it('returns 0 for an empty run', () => {
        expect(aggregateScore([])).toBe(0);
    });

    it('a flawless perfect run scores 100', () => {
        expect(aggregateScore(flawlessRun())).toBe(100);
    });

    it('an all-miss run scores 0', () => {
        const strikes = Array.from({ length: FORGE.TOTAL_ROUNDS }, (_, i) => ({
            tier: 'miss',
            points: 0,
            masterwork: i === FORGE.TOTAL_ROUNDS - 1,
        }));
        expect(aggregateScore(strikes)).toBe(0);
    });

    it('is bounded to 0..100 even for charged over-performance', () => {
        const strikes = flawlessRun().map((s) => ({ ...s, points: s.points * FORGE.CHARGED_MULT }));
        expect(aggregateScore(strikes)).toBeLessThanOrEqual(100);
        expect(aggregateScore(strikes)).toBeGreaterThanOrEqual(0);
    });

    it('a worse-timed run never scores higher than a better one (monotonicity)', () => {
        const better = flawlessRun();

        // Same shape, but two rounds downgraded to weak (no heat gain, low quality).
        let heat = 0;
        const worse = [];
        for (let i = 0; i < FORGE.TOTAL_ROUNDS; i++) {
            const tier = i === 1 || i === 3 ? 'weak' : 'perfect';
            const quality = tier === 'weak' ? 0.3 : 1.0;
            heat = updateHeat(heat, tier);
            worse.push({ tier, points: strikePoints(quality, heat), masterwork: i === FORGE.TOTAL_ROUNDS - 1 });
        }

        expect(aggregateScore(worse)).toBeLessThanOrEqual(aggregateScore(better));
    });

    it('a perfect masterwork finale beats a merely-good one', () => {
        const withPerfect = flawlessRun();
        const withGood = flawlessRun();
        const last = withGood[withGood.length - 1];
        withGood[withGood.length - 1] = { ...last, tier: 'good' };
        expect(aggregateScore(withGood)).toBeLessThan(aggregateScore(withPerfect));
    });
});

describe('idealPoints', () => {
    it('grows with round count', () => {
        expect(idealPoints(6)).toBeGreaterThan(idealPoints(3));
    });

    it('is positive', () => {
        expect(idealPoints(FORGE.TOTAL_ROUNDS)).toBeGreaterThan(0);
    });
});

// The Forge — pure scoring/difficulty logic.
//
// DOM-free and deterministic: no `game`/`window` globals, no Math.random. Every
// function is a pure function of its arguments so the whole scoring model can be
// unit-tested. The rendering game module (forgeGame.js) owns all I/O and calls
// into here for every gameplay decision.
//
// Position scale: the strike bar runs 0..100 with the zones centered on 50.
// Zones are nested half-widths: perfect < good < weak.

// ── Tunable constants ───────────────────────────────────────────────────────
export const FORGE = {
    TOTAL_ROUNDS: 6, // 5 regular strikes + 1 masterwork finale
    HEAT_MAX: 5,
    HEAT_MULT: 0.15, // each heat level adds this fraction to a strike's points
    CHARGED_MULT: 2, // a charged strike doubles points (and halves the perfect window)
    SHRINK_FLOOR: 0.35, // zones never shrink below this fraction of their base width

    // Base half-widths at round 0 and per-Strength growth.
    PERFECT_BASE: 4, PERFECT_STR: 0.4,
    GOOD_BASE: 12, GOOD_STR: 1.0,
    WEAK_BASE: 22, WEAK_STR: 1.0,

    // Masterwork finale multipliers applied to the final aggregate.
    MASTERWORK: { perfect: 1.25, good: 1.10, weak: 1.0, miss: 1.0 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Compute the nested zone half-widths for a given Strength and round.
 * Higher Strength widens the zones; later rounds shrink them (Strength softens
 * the shrink). Widths never drop below SHRINK_FLOOR of their base.
 * @returns {{perfect:number, good:number, weak:number}}
 */
export function computeZones(str, round) {
    const s = clamp(str, 0, 10);
    const shrinkRate = (9 - s * 0.5) / 100;
    const shrink = Math.max(FORGE.SHRINK_FLOOR, 1 - round * shrinkRate);
    return {
        perfect: (FORGE.PERFECT_BASE + s * FORGE.PERFECT_STR) * shrink,
        good: (FORGE.GOOD_BASE + s * FORGE.GOOD_STR) * shrink,
        weak: (FORGE.WEAK_BASE + s * FORGE.WEAK_STR) * shrink,
    };
}

/**
 * Classify a strike at `position` (0..100) against the zones.
 * A charged strike halves the Perfect window (higher risk, doubled reward).
 * @returns {{tier:'perfect'|'good'|'weak'|'miss', quality:number, distToCenter:number}}
 */
export function classifyStrike(position, zones, { charged = false } = {}) {
    const distToCenter = Math.abs(position - 50);
    const perfectHalf = charged ? zones.perfect / 2 : zones.perfect;

    if (distToCenter <= perfectHalf) {
        return { tier: 'perfect', quality: 1.0, distToCenter };
    }
    if (distToCenter <= zones.good) {
        // Quality rises toward 1.0 as the hit nears the center.
        const quality = 0.6 + 0.4 * (1 - distToCenter / zones.good);
        return { tier: 'good', quality, distToCenter };
    }
    if (distToCenter <= zones.weak) {
        return { tier: 'weak', quality: 0.3, distToCenter };
    }
    return { tier: 'miss', quality: 0, distToCenter };
}

/**
 * Update the heat/combo level after a strike of the given tier.
 * Perfect/Good add heat; Weak holds; Miss resets. Clamped 0..HEAT_MAX.
 */
export function updateHeat(heat, tier) {
    if (tier === 'perfect' || tier === 'good') {
        return clamp(heat + 1, 0, FORGE.HEAT_MAX);
    }
    if (tier === 'miss') return 0;
    return clamp(heat, 0, FORGE.HEAT_MAX); // weak: unchanged
}

/**
 * Points earned for a single strike. Monotonic in quality and heat; a charged
 * strike doubles the result. `heat` is the level in effect for this strike
 * (the game passes the heat *after* applying this strike's contribution).
 */
export function strikePoints(quality, heat, { charged = false } = {}) {
    let pts = quality * (1 + heat * FORGE.HEAT_MULT);
    if (charged) pts *= FORGE.CHARGED_MULT;
    return pts;
}

/**
 * Masterwork finale multiplier for the final strike's tier.
 */
export function masterworkBonus(tier) {
    return FORGE.MASTERWORK[tier] ?? 1.0;
}

/**
 * The maximum non-charged perfect-run point total for `numRounds` strikes,
 * used to normalize the final score. Simulated with the same functions so the
 * model stays self-consistent.
 */
export function idealPoints(numRounds) {
    let heat = 0;
    let sum = 0;
    for (let i = 0; i < numRounds; i++) {
        heat = updateHeat(heat, 'perfect');
        sum += strikePoints(1.0, heat, { charged: false });
    }
    return sum;
}

/**
 * Aggregate a completed run into a 0..100 score for _laborReward.
 * `strikes` is an array of records: { tier, points, masterwork? }. The final
 * strike's masterwork multiplier scales the whole aggregate. Charged runs can
 * exceed the ideal and are clamped to 100.
 */
export function aggregateScore(strikes) {
    if (!strikes || strikes.length === 0) return 0;

    const rawSum = strikes.reduce((acc, s) => acc + (s.points || 0), 0);
    const last = strikes[strikes.length - 1];
    const mwMult = last && last.masterwork ? masterworkBonus(last.tier) : 1.0;
    const total = rawSum * mwMult;

    const max = idealPoints(strikes.length) * masterworkBonus('perfect');
    if (max <= 0) return 0;

    return clamp(Math.round((total / max) * 100), 0, 100);
}

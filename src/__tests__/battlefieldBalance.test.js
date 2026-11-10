/**
 * The battlefield's odds against the phased battle's (player/battlefield.js
 * vs player/fieldBattle.js): the same battle, drawn up from the same seed,
 * fought out on the field with both sides in the captains' hands and settled
 * by FieldBattle.auto, over many seeds. Their win rates agree within ten
 * points across even, lopsided, horse-heavy and archer-heavy matchups — the
 * field is the phased battle fought out, not a different game. (Tuning:
 * data/military.json → battlefield; helpers: playtest/battleOdds.js.)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { rates } from './playtest/battleOdds.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

// The enemy: a pike-heavy host with bows and some horse (as a realm's levy is)
const COMP = { pikeman: 0.55, archer: 0.3, cavalry: 0.15 };
const MIXED = [['soldier', 6, 10], ['archer', 3, 8], ['cavalry', 1, 18]];
// (each matchup's enemy strength sits where the phased battle's odds are telling)
const MATCHUPS = {
    even: { army: MIXED, enemy: 113 },
    lopsided: { army: MIXED, enemy: 90 },
    outmatched: { army: MIXED, enemy: 125 },
    horseHeavy: { army: [['cavalry', 5, 18], ['soldier', 2, 10]], enemy: 125 },
    archerHeavy: { army: [['archer', 10, 8], ['soldier', 3, 10]], enemy: 148 },
};

describe('the field battle and the phased battle give the same odds', () => {
    for (const [name, m] of Object.entries(MATCHUPS)) {
        it(`${name}: win rates within ten points`, () => {
            const r = rates({ ...m, comp: COMP }, 40);
            console.log(`[battlefield balance] ${name}: auto ${(r.auto * 100).toFixed(0)}% · field ${(r.field * 100).toFixed(0)}%`);
            expect(Math.abs(r.auto - r.field)).toBeLessThanOrEqual(0.1 + 1e-9);
        }, 180000);
    }
});

// A festival host's record matters: fame, veteran contestants, vigilance, novelty.

import { describe, it, expect } from 'vitest';
import { Utils } from '../core/utils.js';
import { Festivals } from '../systems/festivals.js';
import { Achievements } from '../systems/achievements.js';

const player = (over = {}) => ({ gold: 5000, renown: 0, karma: 0, skills: { combat: 3, leadership: 3, diplomacy: 1 }, reputation: {}, ...over });
const world = { day: 100, season: 'Spring', width: 40, getAllSettlements: () => [], getKingdom: () => null };
const town = (name = 'Holt') => ({ q: 1, r: 1, settlement: { name, type: 'town' } });

describe('Festival record', () => {
    it('a seasoned host earns fame, envoys, contest skill and vigilance', () => {
        const p = player();
        Festivals.initialize(p);
        expect(Festivals.getReputation(p)).toEqual({ hostBonus: 0, extraEnvoys: 0, contestVeteran: 0, vigilance: 0 });
        Object.assign(p.festivals, { hosted: 10, successfulContests: 4, sabotageEvents: 20 });
        expect(Festivals.getReputation(p)).toMatchObject({ hostBonus: 3, extraEnvoys: 2, vigilance: 0.1 });
        expect(Festivals.getReputation(p).contestVeteran).toBeCloseTo(1.2);
    });

    it('the same town tires of your festivals', () => {
        const p = player();
        Festivals.initialize(p);
        p.festivals.history = [{ settlement: 'Holt' }, { settlement: 'Holt' }, { settlement: 'Varn' }];
        expect(Festivals.noveltyMultiplier(p, 'Holt')).toBeCloseTo(0.4);
        expect(Festivals.noveltyMultiplier(p, 'Elsewhere')).toBe(1);
    });

    it('hosting twice in one town earns less renown the second time', () => {
        Utils.setSeed(2);
        const p = player();
        const first = Festivals.hostFestival(p, { ...world }, town(), { tier: 'modest' });
        p.festivals.lastHostedDay = -100;
        Utils.setSeed(2);
        const second = Festivals.hostFestival(p, { ...world }, town(), { tier: 'modest' });
        expect(first.success && second.success).toBe(true);
        expect(second.novelty).toBeCloseTo(0.7);
    });

    it('awards festival achievements', () => {
        expect(Achievements.ACHIEVEMENTS.MASTER_OF_REVELS.check({ festivals: { hosted: 10 } })).toBe(true);
        expect(Achievements.ACHIEVEMENTS.CHAMPION_OF_THE_LISTS.check({ festivals: { successfulContests: 4 } })).toBe(false);
    });
});

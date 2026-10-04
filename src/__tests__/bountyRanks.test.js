// Bounty hunter rank now matters: capture power, pay, wary quarries, achievements.

import { describe, it, expect } from 'vitest';
import { Utils } from '../core/utils.js';
import { BountyHunting } from '../systems/bountyHunting.js';
import { Achievements } from '../systems/achievements.js';

const target = (over = {}) => ({ id: 'b1', type: 'criminal_hunt', status: 'captured_pending_decision', targetName: 'Venn', difficulty: 4, actualPay: 200, recruitedUnit: { strength: 10, upkeep: 6 }, ...over });

describe('Bounty hunter ranks', () => {
    it('ranks bring titles, capture power and better pay', () => {
        const p = { skills: {} };
        BountyHunting.initialize(p);
        expect(BountyHunting.getRankInfo(p)).toMatchObject({ rank: 1, captureBonus: 0, payBonus: 0 });
        p.bountyHunter.rank = 3;
        expect(BountyHunting.getRankInfo(p)).toMatchObject({ title: 'Seasoned Hunter', captureBonus: 2 });
        p.bountyHunter.rank = 9;
        expect(BountyHunting.getRankInfo(p)).toMatchObject({ rank: 9, captureBonus: 4, payBonus: 0.4 });
    });

    it('a ranked hunter is paid more and is told of promotion', () => {
        const p = { gold: 0, renown: 0, skills: {}, activeBounties: [] };
        BountyHunting.initialize(p);
        p.bountyHunter.rank = 2;
        p.bountyHunter.capturesTurnedIn = 5;
        const b = target();
        p.activeBounties.push(b);
        const res = BountyHunting.resolveCapturedTarget(p, b, 'turn_in');
        expect(res.pay).toBe(220);
        expect(p.gold).toBe(220);
        expect(res.promoted).toMatchObject({ rank: 3 });
    });

    it('a quarry that escapes grows warier', () => {
        Utils.setSeed(1);
        const p = { skills: { combat: 1 }, army: [] };
        BountyHunting.initialize(p);
        const b = target({ status: 'active', difficulty: 30, targetQ: 5, targetR: 5 });
        BountyHunting.attemptCapture(p, b, { width: 20, height: 20 });
        BountyHunting.attemptCapture(p, b, { width: 20, height: 20 });
        expect(b.escapes).toBe(2);
    });

    it('awards hunting achievements', () => {
        const p = { gold: 0, bountiesCompleted: 5, bountyHunter: { rank: 5 } };
        expect(Achievements.ACHIEVEMENTS.DEAD_OR_ALIVE.check(p)).toBe(true);
        expect(Achievements.ACHIEVEMENTS.LEGENDARY_HUNTER.check(p)).toBe(true);
        expect(Achievements.ACHIEVEMENTS.LEGENDARY_HUNTER.check({ bountyHunter: { rank: 2 } })).toBe(false);
    });
});

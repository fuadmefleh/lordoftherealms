/**
 * Smoke tests for the reusable minigame effects layer. Only the update/lifecycle
 * logic is exercised (no canvas rendering).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Utils } from '../core/utils.js';
import { Effects } from '../ui/minigames/effects.js';

beforeEach(() => Utils.setSeed(1234));

describe('Effects', () => {
    it('spawns and ages particles, reaping them when their life ends', () => {
        const fx = new Effects();
        fx.spawnParticles(10, 10, { count: 8, life: 0.5 });
        expect(fx.particles.length).toBe(8);

        // Advance well past the longest possible life.
        for (let i = 0; i < 30; i++) fx.update(0.05);
        expect(fx.particles.length).toBe(0);
    });

    it('caps particle counts under reduced motion', () => {
        const fx = new Effects({ reducedMotion: true });
        fx.spawnParticles(0, 0, { count: 40 });
        expect(fx.particles.length).toBeLessThanOrEqual(4);
    });

    it('ignores shake and hit-stop under reduced motion', () => {
        const fx = new Effects({ reducedMotion: true });
        fx.shake(1);
        fx.hitStop(200);
        expect(fx.isFrozen()).toBe(false);
        fx.update(0.016);
        expect(fx.shakeOffset).toEqual({ ox: 0, oy: 0 });
    });

    it('decays hit-stop over real time', () => {
        const fx = new Effects();
        fx.hitStop(80);
        expect(fx.isFrozen()).toBe(true);
        fx.update(0.05); // 50ms
        expect(fx.isFrozen()).toBe(true);
        fx.update(0.05); // 100ms total > 80ms
        expect(fx.isFrozen()).toBe(false);
    });

    it('reaps floating text after its life', () => {
        const fx = new Effects();
        fx.popText(0, 0, 'PERFECT!', { life: 0.4 });
        expect(fx.texts.length).toBe(1);
        for (let i = 0; i < 20; i++) fx.update(0.05);
        expect(fx.texts.length).toBe(0);
    });
});

/**
 * Headless integration tests for the Forge game module's state machine.
 * Rendering is not exercised (no canvas); we drive input + update directly.
 */
import { describe, it, expect } from 'vitest';
import { ForgeGame } from '../ui/minigames/forge/forgeGame.js';
import { FORGE } from '../ui/minigames/forge/forgeLogic.js';

// Minimal host stand-in: geometry + no-op juice helpers.
const fakeHost = () => ({
    width: 480,
    height: 380,
    shake() {}, spawnParticles() {}, hitStop() {}, popText() {}, playSFX() {},
});

// Play a full run where every strike lands at `cursorPos` (0..100).
function playRun(strength, cursorPos) {
    let score = null;
    const game = new ForgeGame({ strength, onComplete: (s) => { score = s; } });
    game.init(fakeHost());

    // Start (intro → playing).
    game.onInput({ type: 'down' });
    game.onInput({ type: 'up' });

    for (let r = 0; r < FORGE.TOTAL_ROUNDS; r++) {
        expect(game.phase).toBe('playing');
        game.cursor = cursorPos;      // place the strike deterministically
        game.onInput({ type: 'down' });
        game.onInput({ type: 'up' }); // held ~0 → not charged
        expect(game.phase).toBe('flash');
        game.update(FORGE.TOTAL_ROUNDS); // expire the flash window
    }

    // Win screen, then leave it.
    expect(game.phase).toBe('done');
    game.onInput({ type: 'up' });
    return { score, strikes: game.strikes };
}

describe('ForgeGame run flow', () => {
    it('a flawless centered run completes with a top score', () => {
        const { score, strikes } = playRun(5, 50);
        expect(strikes).toHaveLength(FORGE.TOTAL_ROUNDS);
        expect(strikes[strikes.length - 1].masterwork).toBe(true);
        expect(score).toBe(100);
    });

    it('a run that always misses (edge of bar) scores 0', () => {
        const { score } = playRun(5, 0); // far from center → miss every time
        expect(score).toBe(0);
    });

    it('a centered run beats a badly-timed one', () => {
        const good = playRun(5, 50).score;
        const bad = playRun(5, 100).score;
        expect(good).toBeGreaterThan(bad);
    });

    it('does not fire onComplete until the player leaves the win screen', () => {
        let fired = 0;
        const game = new ForgeGame({ strength: 5, onComplete: () => { fired++; } });
        game.init(fakeHost());
        game.onInput({ type: 'down' });
        game.onInput({ type: 'up' });
        for (let r = 0; r < FORGE.TOTAL_ROUNDS; r++) {
            game.cursor = 50;
            game.onInput({ type: 'down' });
            game.onInput({ type: 'up' });
            game.update(FORGE.TOTAL_ROUNDS);
        }
        expect(game.phase).toBe('done');
        expect(fired).toBe(0); // still on the win screen
        game.onInput({ type: 'up' });
        expect(fired).toBe(1);
    });

    it('registers a charged strike when the press is held past the threshold', () => {
        const game = new ForgeGame({ strength: 5, onComplete: () => {} });
        game.init(fakeHost());
        game.onInput({ type: 'down' });
        game.onInput({ type: 'up' });

        game.cursor = 50;
        game.onInput({ type: 'down' });
        game.clock += 0.5; // hold longer than CHARGE_HOLD
        game.onInput({ type: 'up' });
        expect(game.strikes[0].charged).toBe(true);
    });
});

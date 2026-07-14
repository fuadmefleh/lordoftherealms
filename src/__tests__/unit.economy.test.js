/**
 * Pure unit tests for Trading.calculatePrice — enabled by the Phase-3 DI.
 *
 * calculatePrice now takes an explicit `world` param instead of reading
 * window.game, so it's a pure function of its arguments: no DataLoader, no
 * globals. We synthesize goods/settlement/tile fixtures directly.
 */
import { describe, it, expect } from 'vitest';
import { Trading } from '../player/playerEconomy.js';

const firewood = { id: 'firewood', basePrice: 100 };
const settlement = { type: 'town', population: 1000, marketStock: {} };
const plainsTile = (temperature) => ({
    temperature,
    terrain: { id: 'plains' },
    resource: { id: 'none' },
});

describe('Trading.calculatePrice — injected world', () => {
    it('is a pure, deterministic function of its args', () => {
        const world = { weather: {} };
        const a = Trading.calculatePrice(firewood, settlement, plainsTile(20), world);
        const b = Trading.calculatePrice(firewood, settlement, plainsTile(20), world);
        expect(a).toBe(b);
        expect(Number.isFinite(a)).toBe(true);
        expect(a).toBeGreaterThan(0);
    });

    it('cold weather raises firewood price vs warm weather (weather branch)', () => {
        const world = { weather: {} };
        const warm = Trading.calculatePrice(firewood, settlement, plainsTile(20), world);
        const cold = Trading.calculatePrice(firewood, settlement, plainsTile(-10), world);
        expect(cold).toBeGreaterThan(warm);
    });

    it('skips the weather branch when world is null (headless path)', () => {
        const world = { weather: {} };
        const withWeather = Trading.calculatePrice(firewood, settlement, plainsTile(-10), world);
        const headless = Trading.calculatePrice(firewood, settlement, plainsTile(-10), null);
        expect(withWeather).not.toBe(headless);
    });
});

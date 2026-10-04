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
// `temperature` here is °C as the weather system reports it for the tile
const plainsTile = (temperature) => ({
    q: 0, r: 0,
    celsius: temperature,
    terrain: { id: 'plains' },
    resource: { id: 'none' },
});

// Minimal weather: reports the fixture tile's °C, always fair skies
const fairWeather = (tile) => ({
    weather: {
        getTemperature: () => ({ celsius: tile.celsius }),
        getWeather: () => ({ type: 'clear', intensity: 0 }),
    },
});

describe('Trading.calculatePrice — injected world', () => {
    it('is a pure, deterministic function of its args', () => {
        const tile = plainsTile(20);
        const world = fairWeather(tile);
        const a = Trading.calculatePrice(firewood, settlement, tile, world);
        const b = Trading.calculatePrice(firewood, settlement, tile, world);
        expect(a).toBe(b);
        expect(Number.isFinite(a)).toBe(true);
        expect(a).toBeGreaterThan(0);
    });

    it('cold weather raises firewood price vs warm weather (weather branch)', () => {
        const warmTile = plainsTile(20);
        const coldTile = plainsTile(-10);
        const warm = Trading.calculatePrice(firewood, settlement, warmTile, fairWeather(warmTile));
        const cold = Trading.calculatePrice(firewood, settlement, coldTile, fairWeather(coldTile));
        expect(cold).toBeGreaterThan(warm);
    });

    it('snow on the ground raises firewood prices even on a mild day', () => {
        const tile = plainsTile(10);
        const snowy = { weather: { getTemperature: () => ({ celsius: 10 }), getWeather: () => ({ type: 'snow' }) } };
        expect(Trading.calculatePrice(firewood, settlement, tile, snowy))
            .toBeGreaterThan(Trading.calculatePrice(firewood, settlement, tile, fairWeather(tile)));
    });

    it('skips the weather branch when world is null (headless path)', () => {
        const tile = plainsTile(-10);
        const withWeather = Trading.calculatePrice(firewood, settlement, tile, fairWeather(tile));
        const headless = Trading.calculatePrice(firewood, settlement, tile, null);
        expect(withWeather).not.toBe(headless);
    });
});

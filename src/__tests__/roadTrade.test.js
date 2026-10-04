// Roads speed trade: a road-linked caravan is faster, safer and earns more.

import { describe, it, expect } from 'vitest';
import { PlayerEconomy } from '../player/playerEconomy.js';

function makeWorld(roadTiles) {
    const tiles = new Map();
    return {
        width: 30, height: 30, units: [],
        getTile(q, r) {
            if (r < 0 || r >= 30) return null;
            const key = `${q},${r}`;
            if (!tiles.has(key)) tiles.set(key, { q, r, hasRoad: roadTiles.has(key), terrain: { passable: true } });
            return tiles.get(key);
        },
    };
}

const road = new Set(['2,5', '3,5', '4,5', '5,5', '6,5']);

describe('Roads and trade', () => {
    it('marks a caravan road-linked when roads join both ends, and speeds its wagon', () => {
        const world = makeWorld(road);
        const caravan = { fromPos: { q: 2, r: 5 }, toPos: { q: 6, r: 5 }, daysRemaining: 6 };
        const unit = { speed: 4 };
        expect(PlayerEconomy._applyRoadLink(world, caravan, unit)).toBe(true);
        expect(caravan.roadLinked).toBe(true);
        expect(unit.speed).toBe(5);
        expect(unit.roadLinked).toBe(true);
    });

    it('a timer-only caravan on roads arrives sooner', () => {
        const world = makeWorld(road);
        const caravan = { fromPos: { q: 2, r: 5 }, toPos: { q: 6, r: 5 }, daysRemaining: 6 };
        PlayerEconomy._applyRoadLink(world, caravan, null);
        expect(caravan.daysRemaining).toBe(4);
    });

    it('no road, no bonus', () => {
        const world = makeWorld(new Set(['2,5', '3,5']));
        const caravan = { fromPos: { q: 2, r: 5 }, toPos: { q: 6, r: 5 }, daysRemaining: 6 };
        const unit = { speed: 4 };
        expect(PlayerEconomy._applyRoadLink(world, caravan, unit)).toBe(false);
        expect(caravan.roadLinked).toBeUndefined();
        expect(unit.speed).toBe(4);
    });
});

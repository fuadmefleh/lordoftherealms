// A logging camp (or a mine / quarry) of yours on a hex speeds and swells the
// gathering there (player/gathering.js campBoost); and a day's walk is scaled
// by data/travel.json dayScale (player/core/lifecycle.js).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Gathering } from '../player/gathering.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const tree = { objectType: 'tree', resource: { type: 'wood', amount: 4 } };
const rock = { objectType: 'rock', resource: { type: 'stone', amount: 4 } };

describe('a camp on the hex', () => {
    it('a finished logging camp makes blows land harder and each tree give more', () => {
        const { player } = newGame(4242);
        player.inventory = {};
        const bare = { terrain: { id: 'woodland' } };
        const camp = { terrain: { id: 'woodland' }, playerProperties: [{ type: 'logging_camp', name: 'Logging Camp', underConstruction: false }] };
        const C = Gathering.config().camps.woodcutting;
        expect(Gathering.campBoost(player, tree, bare)).toBeNull();
        expect(Gathering.campBoost(player, tree, camp)).toMatchObject({ type: 'logging_camp' });
        expect(Gathering.damageMult(player, tree, camp)).toBeCloseTo(Gathering.damageMult(player, tree, bare) * C.speed, 6);
        const plain = Gathering.felled(player, tree, tree.resource, 'woodland', null, bare);
        const more = Gathering.felled(player, tree, tree.resource, 'woodland', null, camp);
        expect(more.campExtra).toBe(Math.ceil(4 * C.yield) - 4);
        expect(more.amount - more.extra).toBe(plain.amount - plain.extra + more.campExtra);
        // A logging camp does nothing for rock; one still being built does nothing at all
        expect(Gathering.campBoost(player, rock, camp)).toBeNull();
        const building = { playerProperties: [{ type: 'logging_camp', underConstruction: true }] };
        expect(Gathering.campBoost(player, tree, building)).toBeNull();
        // A quarry speeds the rock
        expect(Gathering.campBoost(player, rock, { playerProperties: [{ type: 'quarry', underConstruction: false }] })).toMatchObject({ type: 'quarry' });
    });
});

describe('a day\'s walk', () => {
    it('the day\'s movement is the budget scaled by travel.dayScale', () => {
        const game = newGame(4242);
        const { player } = game;
        const scale = DataLoader._gamedata.travel.dayScale;
        expect(scale).toBeGreaterThan(0);
        expect(scale).toBeLessThan(1);
        endDay(game);
        const scaled = player.movementRemaining;
        DataLoader._gamedata.travel.dayScale = 1;
        try {
            endDay(game);
            const full = player.movementRemaining;
            // (two different days: mood and needs may move the budget by a point)
            expect(Math.abs(scaled - Math.round(full * scale))).toBeLessThanOrEqual(1);
            expect(scaled).toBeLessThan(full);
        } finally {
            DataLoader._gamedata.travel.dayScale = scale;
        }
    });
});

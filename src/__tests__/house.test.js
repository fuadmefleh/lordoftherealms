// Phase 0 scaffolding tests for the House (dynasty spine).
// Verifies the blank House is created deterministically, ticks as a no-op,
// and round-trips through serialize/deserialize. No Prestige/ambition/
// succession behaviour exists yet — those arrive in later phases.

import { describe, it, expect } from 'vitest';
import { House } from '../systems/house.js';

function makePlayer(overrides = {}) {
    return { id: 'p1', lastName: 'Ashborne', ...overrides };
}

describe('House — Phase 0 scaffolding', () => {
    it('initialize() creates a blank House with expected defaults', () => {
        const player = makePlayer();
        const house = House.initialize(player, { day: 5 });

        expect(player.house).toBe(house);
        expect(house.name).toBe('House Ashborne');
        expect(house.prestige).toBe(0);
        expect(house.generation).toBe(1);
        expect(house.foundedDay).toBe(5);
        expect(house.ambition).toBeNull();
        expect(house.history).toEqual([]);
        // Every role slot exists and starts empty.
        for (const roleId of House.ROLE_IDS) {
            expect(house.roles[roleId]).toBeNull();
        }
    });

    it('derives a deterministic id from the surname (no RNG)', () => {
        const a = House._blankHouse(makePlayer(), { day: 0 });
        const b = House._blankHouse(makePlayer(), { day: 99 });
        expect(a.id).toBe('house_ashborne');
        expect(b.id).toBe('house_ashborne');
    });

    it('falls back to a sensible name when the player has no surname', () => {
        const house = House.initialize(makePlayer({ lastName: '' }), { day: 1 });
        expect(house.name).toBe('Your House');
        expect(house.id).toBe('house_player');
    });

    it('initialize() is idempotent — it does not clobber an existing House', () => {
        const player = makePlayer();
        const first = House.initialize(player, { day: 1 });
        first.prestige = 42;
        const second = House.initialize(player, { day: 1 });
        expect(second).toBe(first);
        expect(player.house.prestige).toBe(42);
    });

    it('processDaily() is a no-op that returns an empty results bag', () => {
        const player = makePlayer();
        House.initialize(player, { day: 1 });
        const before = JSON.stringify(player.house);
        const result = House.processDaily(player, { day: 2 });
        expect(result).toEqual({});
        expect(JSON.stringify(player.house)).toBe(before);
    });

    it('processDaily() tolerates a player with no House', () => {
        expect(House.processDaily({ id: 'x' }, { day: 1 })).toEqual({});
        expect(House.processDaily(null, null)).toEqual({});
    });

    it('serialize() → deserialize() round-trips House state', () => {
        const player = makePlayer();
        const house = House.initialize(player, { day: 3 });
        house.prestige = 120;
        house.motto = 'We Endure';
        house.history.push({ day: 3, generation: 1, text: 'Founded', tags: ['founding'] });
        house.roles.steward = 'child_7';

        const data = House.serialize(house);
        // Serialized form is JSON-safe.
        expect(JSON.parse(JSON.stringify(data))).toEqual(data);

        const restored = House.deserialize(makePlayer(), { day: 3 }, data);
        expect(restored.prestige).toBe(120);
        expect(restored.motto).toBe('We Endure');
        expect(restored.roles.steward).toBe('child_7');
        expect(restored.history).toHaveLength(1);
    });

    it('deserialize(null) backfills a blank House for legacy saves', () => {
        const player = makePlayer();
        const restored = House.deserialize(player, { day: 0 }, null);
        expect(restored).toBe(player.house);
        expect(restored.prestige).toBe(0);
        expect(restored.name).toBe('House Ashborne');
    });

    it('deserialize() merges defaults for partial/legacy House data', () => {
        // A save missing the newer sigil/roles fields still restores cleanly.
        const restored = House.deserialize(makePlayer(), { day: 0 }, { prestige: 5 });
        expect(restored.prestige).toBe(5);
        expect(restored.sigil).toEqual({ icon: '🛡️', color: '#c9a227' });
        for (const roleId of House.ROLE_IDS) {
            expect(restored.roles[roleId]).toBeNull();
        }
    });
});

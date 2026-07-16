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
        // A founding entry is chronicled at creation.
        expect(house.history).toHaveLength(1);
        expect(house.history[0].tags).toContain('founding');
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
        // Founding entry (from initialize) + the one pushed above.
        expect(restored.history).toHaveLength(2);
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

describe('House — Phase 1: founding & Prestige', () => {
    it('found() sets name (prefixing "House"), motto, and sigil', () => {
        const player = makePlayer({ lastName: '' });
        const house = House.found(player, { day: 2 }, {
            name: 'Blackwood', motto: 'Rooted and Rising', sigil: { icon: '🌳' },
        });
        expect(house.name).toBe('House Blackwood');
        expect(house.motto).toBe('Rooted and Rising');
        expect(house.sigil.icon).toBe('🌳');
        expect(house.sigil.color).toBe('#c9a227'); // untouched default preserved
    });

    it('found() does not double-prefix an already-"House" name', () => {
        const house = House.found(makePlayer(), { day: 0 }, { name: 'House Vale' });
        expect(house.name).toBe('House Vale');
    });

    it('award() adds Prestige, logs it, and resets the decay clock', () => {
        const house = House.initialize(makePlayer(), { day: 10 });
        const total = House.award(house, 25, 'won a battle', 12);
        expect(total).toBe(25);
        expect(house.prestige).toBe(25);
        expect(house.lastNotableDay).toBe(12);
        const last = house.prestigeLog[house.prestigeLog.length - 1];
        expect(last).toMatchObject({ delta: 25, reason: 'won a battle', day: 12 });
    });

    it('award() ignores non-positive amounts', () => {
        const house = House.initialize(makePlayer(), { day: 0 });
        House.award(house, 0, 'noop', 1);
        House.award(house, -5, 'noop', 1);
        expect(house.prestige).toBe(0);
    });

    it('spend() debits when affordable and refuses when not', () => {
        const house = House.initialize(makePlayer(), { day: 0 });
        House.award(house, 30, 'deeds', 1);
        expect(House.spend(house, 20, 'press claim', 5)).toBe(true);
        expect(house.prestige).toBe(10);
        expect(House.spend(house, 50, 'too costly', 6)).toBe(false);
        expect(house.prestige).toBe(10); // unchanged on refusal
    });

    it('applyDecay() only erodes after the idle window elapses', () => {
        const house = House.initialize(makePlayer(), { day: 0 });
        House.award(house, 10, 'deed', 0);
        const cfg = House._getConfig();
        // Within the window: no decay.
        expect(House.applyDecay(house, cfg.idleWindow)).toBe(0);
        expect(house.prestige).toBe(10);
        // One day past the window: erode by decayPerDay.
        const decayed = House.applyDecay(house, cfg.idleWindow + 1);
        expect(decayed).toBe(cfg.decayPerDay);
        expect(house.prestige).toBe(10 - cfg.decayPerDay);
    });

    it('applyDecay() never drives Prestige below zero', () => {
        const house = House.initialize(makePlayer(), { day: 0 });
        House.award(house, 1, 'deed', 0);
        const cfg = House._getConfig();
        House.applyDecay(house, cfg.idleWindow + 1); // 1 -> 0
        expect(house.prestige).toBe(0);
        expect(House.applyDecay(house, cfg.idleWindow + 2)).toBe(0); // stays 0
    });

    it('processDaily() applies decay and reports it', () => {
        const player = makePlayer();
        House.initialize(player, { day: 0 });
        House.award(player.house, 5, 'deed', 0);
        const cfg = House._getConfig();
        const res = House.processDaily(player, { day: cfg.idleWindow + 1 });
        expect(res.prestigeDecayed).toBe(cfg.decayPerDay);
    });

    it('prestigeLog is capped at config.logCap entries', () => {
        const house = House.initialize(makePlayer(), { day: 0 });
        const cfg = House._getConfig();
        for (let i = 0; i < cfg.logCap + 15; i++) House.award(house, 1, `deed ${i}`, i);
        expect(house.prestigeLog.length).toBe(cfg.logCap);
    });
});

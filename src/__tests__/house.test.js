// Phase 0 scaffolding tests for the House (dynasty spine).
// Verifies the blank House is created deterministically, ticks as a no-op,
// and round-trips through serialize/deserialize. No Prestige/ambition/
// succession behaviour exists yet — those arrive in later phases.

import { describe, it, expect } from 'vitest';
import { House } from '../systems/house.js';
import { Utils } from '../core/utils.js';

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

describe('House — Phase 2: sources & sinks', () => {
    it('recordDeed() awards the SOURCES value for a known deed', () => {
        const house = House.initialize(makePlayer(), { day: 1 });
        const src = House._getSources();
        const awarded = House.recordDeed(house, { day: 2 }, 'titleGained');
        expect(awarded).toBe(src.titleGained);
        expect(house.prestige).toBe(src.titleGained);
    });

    it('recordDeed() scales by count and ignores unknown deeds', () => {
        const house = House.initialize(makePlayer(), { day: 1 });
        const src = House._getSources();
        expect(House.recordDeed(house, { day: 1 }, 'quest', { count: 3 })).toBe(src.quest * 3);
        expect(House.recordDeed(house, { day: 1 }, 'not_a_deed')).toBe(0);
    });

    it('recordDeed() chronicles only when given chronicle text', () => {
        const house = House.initialize(makePlayer(), { day: 1 });
        const before = house.history.length;
        House.recordDeed(house, { day: 1 }, 'quest'); // no chronicle
        expect(house.history.length).toBe(before);
        House.recordDeed(house, { day: 1 }, 'settlementHeld', { chronicle: 'Took the city.' });
        expect(house.history.length).toBe(before + 1);
    });

    it('recordPlayerDeed() is a no-op when the player has no House', () => {
        expect(House.recordPlayerDeed({ id: 'x' }, { day: 1 }, 'quest')).toBe(0);
    });

    it('sink: pressClaim spends when affordable, refuses when not', () => {
        const player = makePlayer();
        House.initialize(player, { day: 0 });
        const sinks = House._getSinks();
        House.award(player.house, sinks.pressClaim, 'deeds', 1);

        const ok = House.pressClaim(player, { day: 5 });
        expect(ok.success).toBe(true);
        expect(ok.cost).toBe(sinks.pressClaim);
        expect(player.house.prestige).toBe(0);

        const no = House.pressClaim(player, { day: 6 });
        expect(no.success).toBe(false);
        expect(no.reason).toBe('Not enough Prestige');
    });

    it('sink: accepts a cost override and chronicles when asked', () => {
        const player = makePlayer();
        House.initialize(player, { day: 0 });
        House.award(player.house, 100, 'deeds', 1);
        const before = player.house.history.length;
        const res = House.callInFavor(player, { day: 3 }, { cost: 40, chronicle: 'Called in a favor.' });
        expect(res.success).toBe(true);
        expect(res.cost).toBe(40);
        expect(res.remaining).toBe(60);
        expect(player.house.history.length).toBe(before + 1);
    });

    it('sink: refuses without a House', () => {
        const res = House.secureSuccession({ id: 'x' }, { day: 1 });
        expect(res.success).toBe(false);
        expect(res.reason).toBe('No House');
    });

    it('recordDeed() increments a durable stats counter', () => {
        const house = House.initialize(makePlayer(), { day: 1 });
        House.recordDeed(house, { day: 1 }, 'settlementHeld');
        House.recordDeed(house, { day: 2 }, 'settlementHeld');
        expect(house.stats.settlementHeld).toBe(2);
    });
});

describe('House — Phase 3: ambitions', () => {
    it('ambitions() lists the catalog and chooseAmbition() sets progress', () => {
        const list = House.ambitions();
        expect(list.length).toBeGreaterThanOrEqual(5);
        const house = House.initialize(makePlayer(), { day: 1 });
        const prog = House.chooseAmbition(house, 'merchant_dynasty', 1);
        expect(prog.id).toBe('merchant_dynasty');
        expect(prog.capstoneDone).toBe(false);
        expect(prog.milestones.every(ms => ms.done === false)).toBe(true);
    });

    it('chooseAmbition() rejects an unknown ambition', () => {
        const house = House.initialize(makePlayer(), { day: 1 });
        expect(House.chooseAmbition(house, 'nonsense', 1)).toBeNull();
        expect(house.ambition).toBeNull();
    });

    it('evaluateAmbition() marks milestones met and awards Prestige', () => {
        const player = makePlayer({ properties: [{}, {}, {}, {}, {}], tradeRoutes: [] });
        House.initialize(player, { day: 1 });
        House.chooseAmbition(player.house, 'merchant_dynasty', 1);
        const before = player.house.prestige;

        const res = House.evaluateAmbition(player, { day: 5 });
        expect(res.milestonesCompleted).toContain('estates'); // 5 properties
        expect(res.milestonesCompleted).not.toContain('routes'); // 0 routes
        expect(player.house.prestige).toBeGreaterThan(before);

        // Idempotent: a completed milestone is not re-awarded.
        const p2 = player.house.prestige;
        const res2 = House.evaluateAmbition(player, { day: 6 });
        expect(res2.milestonesCompleted).not.toContain('estates');
        expect(player.house.prestige).toBe(p2);
    });

    it('evaluateAmbition() detects the capstone exactly once', () => {
        const player = makePlayer({ gold: 60000, tradeRoutes: [{}, {}, {}, {}, {}] });
        House.initialize(player, { day: 1 });
        House.chooseAmbition(player.house, 'merchant_dynasty', 1);

        const res = House.evaluateAmbition(player, { day: 10 });
        expect(res.capstoneCompleted).toBe(true);
        expect(player.house.ambition.capstoneDone).toBe(true);

        const res2 = House.evaluateAmbition(player, { day: 11 });
        expect(res2.capstoneCompleted).toBe(false); // not re-fired
    });

    it('evaluateAmbition() returns null with no active ambition', () => {
        const player = makePlayer();
        House.initialize(player, { day: 1 });
        expect(House.evaluateAmbition(player, { day: 2 })).toBeNull();
    });

    it('processDaily() surfaces ambition progress in its results', () => {
        const player = makePlayer({ properties: [{}, {}, {}, {}, {}] });
        House.initialize(player, { day: 1 });
        House.chooseAmbition(player.house, 'merchant_dynasty', 1);
        const res = House.processDaily(player, { day: 3 });
        expect(res.ambition).toBeTruthy();
        expect(res.ambition.milestonesCompleted).toContain('estates');
    });
});

describe('House — Phase 4: succession with stakes', () => {
    it('assessSuccession classifies adult and minor heirs', () => {
        const player = makePlayer({
            children: [
                { id: 'a', isAlive: true, age: 20, firstName: 'Ada' },
                { id: 'b', isAlive: true, age: 8, firstName: 'Bram' },
                { id: 'c', isAlive: false, age: 30, firstName: 'Ghost' },
            ],
        });
        const s = House.assessSuccession(player, 16);
        expect(s.hasAdultHeir).toBe(true);
        expect(s.hasMinorHeir).toBe(true);
        expect(s.regent.id).toBe('b');
    });

    it('processSuccession advances the generation and chronicles it', () => {
        Utils.setSeed(1);
        const player = makePlayer({ gold: 1000, name: 'Ada Ashborne' });
        House.initialize(player, { day: 100 });
        const g0 = player.house.generation;
        const res = House.processSuccession(player, { day: 200 }, { disputeChance: 0 });
        expect(res.generation).toBe(g0 + 1);
        expect(res.disputed).toBe(false);
        expect(player.house.history.some(h => h.tags.includes('succession'))).toBe(true);
    });

    it('a disputed succession fragments holdings when not secured', () => {
        const player = makePlayer({ gold: 1000, currentTitle: 'tax_collector', name: 'Ada' });
        House.initialize(player, { day: 0 });
        const res = House.processSuccession(player, { day: 1 }, { disputeChance: 1, secure: false });
        expect(res.disputed).toBe(true);
        expect(res.secured).toBe(false);
        expect(res.fragmented.length).toBeGreaterThan(0);
        expect(player.currentTitle).toBeNull(); // office lost
        expect(player.gold).toBeLessThan(1000);  // gold skimmed
    });

    it('a disputed succession can be secured by spending Prestige', () => {
        const player = makePlayer({ gold: 1000, currentTitle: 'tax_collector', name: 'Ada' });
        House.initialize(player, { day: 0 });
        const cost = House._getSinks().secureSuccession;
        House.award(player.house, cost, 'deeds', 0);
        const res = House.processSuccession(player, { day: 1 }, { disputeChance: 1, secure: true });
        expect(res.disputed).toBe(true);
        expect(res.secured).toBe(true);
        expect(res.fragmented.length).toBe(0);
        expect(player.currentTitle).toBe('tax_collector'); // office kept
        expect(player.house.prestige).toBe(0);              // paid for it
    });

    it('a regency always costs holdings even without a dispute', () => {
        const player = makePlayer({ gold: 1000, currentTitle: 'jailer', name: 'Bram' });
        House.initialize(player, { day: 0 });
        const res = House.processSuccession(player, { day: 1 }, { disputeChance: 0, regency: true });
        expect(res.regency).toBe(true);
        expect(res.fragmented.length).toBeGreaterThan(0);
    });

    it('higher Prestige lowers the dispute chance', () => {
        const poor = House.initialize(makePlayer(), { day: 0 });
        const rich = House.initialize(makePlayer({ id: 'p2' }), { day: 0 });
        rich.prestige = 400;
        expect(House._disputeChance(rich)).toBeLessThan(House._disputeChance(poor));
    });
});

describe('House — Phase 5: family roles', () => {
    function playerWithKids() {
        return makePlayer({
            children: [
                { id: 'k1', firstName: 'Mara', isAlive: true, age: 22, skills: { commerce: 8, combat: 2 }, traits: [] },
                { id: 'k2', firstName: 'Rulf', isAlive: true, age: 19, skills: { combat: 10, commerce: 1 }, traits: [{ id: 'ambitious' }] },
            ],
        });
    }

    it('assignRole appoints a living child and seeds loyalty', () => {
        const player = playerWithKids();
        House.initialize(player, { day: 0 });
        const res = House.assignRole(player, 'steward', 'k1');
        expect(res.success).toBe(true);
        expect(player.house.roles.steward).toBe('k1');
        expect(player.house.roleLoyalty.k1).toBe(House._getConfig().roleBaseLoyalty);
    });

    it('assignRole rejects non-family and unknown roles', () => {
        const player = playerWithKids();
        House.initialize(player, { day: 0 });
        expect(House.assignRole(player, 'steward', 'nope').success).toBe(false);
        expect(House.assignRole(player, 'wizard', 'k1').success).toBe(false);
    });

    it('a member holds at most one role', () => {
        const player = playerWithKids();
        House.initialize(player, { day: 0 });
        House.assignRole(player, 'steward', 'k1');
        House.assignRole(player, 'marshal', 'k1');
        expect(player.house.roles.steward).toBeNull();
        expect(player.house.roles.marshal).toBe('k1');
    });

    it('assigning the heir role syncs player.heir', () => {
        const player = playerWithKids();
        House.initialize(player, { day: 0 });
        House.assignRole(player, 'heir', 'k2');
        expect(player.heir).toBe('k2');
        House.clearRole(player, 'heir');
        expect(player.heir).toBeNull();
    });

    it('getRoleBonuses scales with skill and reduces upkeep for a Marshal', () => {
        const player = playerWithKids();
        House.initialize(player, { day: 0 });
        House.assignRole(player, 'steward', 'k1');  // commerce 8
        House.assignRole(player, 'marshal', 'k2');  // combat 10
        // Full loyalty isolates the skill scaling (base loyalty 60 = 0.6 factor).
        player.house.roleLoyalty.k1 = 100;
        player.house.roleLoyalty.k2 = 100;
        const b = House.getRoleBonuses(player);
        expect(b.propertyIncomeMult).toBeCloseTo(1 + 8 * 0.03, 5);
        expect(b.armyUpkeepMult).toBeCloseTo(1 - 10 * 0.03, 5);
    });

    it('low loyalty weakens the bonus', () => {
        const player = playerWithKids();
        House.initialize(player, { day: 0 });
        House.assignRole(player, 'marshal', 'k2');
        player.house.roleLoyalty.k2 = 50; // half strength
        const b = House.getRoleBonuses(player);
        expect(b.armyUpkeepMult).toBeCloseTo(1 - (10 * 0.5) * 0.03, 5);
    });

    it('loyalty drift can produce a claimant and set a pending claim', () => {
        Utils.setSeed(7);
        const player = playerWithKids();
        House.initialize(player, { day: 0 });
        House.assignRole(player, 'heir', 'k1');
        House.assignRole(player, 'marshal', 'k2'); // ambitious, not the heir
        // Drive k2 to the brink, then drift on a cadence day.
        player.house.roleLoyalty.k2 = House._getConfig().roleDisloyaltyThreshold;
        const driftDay = House._getConfig().roleLoyaltyDriftDays;
        let sawClaimant = false;
        for (let i = 1; i <= 10 && !sawClaimant; i++) {
            const res = House._driftRoleLoyalty(player, { day: driftDay * i });
            if (res.claimant === 'k2') sawClaimant = true;
        }
        expect(sawClaimant).toBe(true);
        expect(player.house._pendingClaim).toBe(true);
    });

    it('getRoleBonuses is identity when no roles are filled', () => {
        const player = playerWithKids();
        House.initialize(player, { day: 0 });
        expect(House.getRoleBonuses(player)).toEqual({
            propertyIncomeMult: 1, armyUpkeepMult: 1, diplomacyBonus: 0, espionageBonus: 0,
        });
    });
});

describe('House — Phase 6: rival Houses', () => {
    function worldWithKingdoms() {
        return {
            day: 0,
            kingdoms: [
                { id: 'k1', name: 'Valdoria', isAlive: true, military: 300, characterData: { dynasty: { name: 'Vale' } } },
                { id: 'k2', name: 'Durheim', isAlive: true, military: 500, characterData: { dynasty: { name: 'Stone' } } },
                { id: 'k3', name: 'Sylvaris', isAlive: true, military: 100 },
                { id: 'k4', name: 'Dead', isAlive: false, military: 999 },
            ],
        };
    }

    it('seedRivals picks the strongest living kingdoms (deterministic)', () => {
        const player = makePlayer();
        House.initialize(player, { day: 0 });
        const keys = House.seedRivals(player, worldWithKingdoms(), 2);
        expect(keys).toEqual(['k2', 'k1']); // by military desc, excludes the dead one
        expect(player.house.rivals.k2.name).toBe('House Stone');
        expect(player.house.rivals.k1.name).toBe('House Vale');
    });

    it('seedRivals is idempotent and excludes the player\'s own kingdom', () => {
        const player = makePlayer({ allegiance: 'k2' });
        House.initialize(player, { day: 0 });
        const keys = House.seedRivals(player, worldWithKingdoms(), 3);
        expect(keys).not.toContain('k2');
        const again = House.seedRivals(player, worldWithKingdoms(), 3);
        expect(again).toEqual(keys); // not re-seeded
    });

    it('accrueRivalFeud raises feud for a rival and ignores non-rivals', () => {
        const player = makePlayer();
        House.initialize(player, { day: 0 });
        House.seedRivals(player, worldWithKingdoms(), 2);
        expect(House.accrueRivalFeud(player, { day: 5 }, 'k1', 25)).toBe(25);
        expect(House.accrueRivalFeud(player, { day: 5 }, 'k1', 200)).toBe(100); // clamped
        expect(House.accrueRivalFeud(player, { day: 5 }, 'k3', 40)).toBe(0);   // k3 not a rival
    });

    it('crossing a hostility threshold is chronicled', () => {
        const player = makePlayer();
        House.initialize(player, { day: 0 });
        House.seedRivals(player, worldWithKingdoms(), 1);
        const before = player.house.history.length;
        House.accrueRivalFeud(player, { day: 1 }, 'k2', 35); // crosses 30
        expect(player.house.history.length).toBe(before + 1);
        expect(player.house.history.at(-1).tags).toContain('feud');
    });

    it('rival feud feeds the succession dispute chance', () => {
        const calm = makePlayer();
        House.initialize(calm, { day: 0 });
        House.seedRivals(calm, worldWithKingdoms(), 1);
        const base = House._disputeChance(calm.house);

        const angry = makePlayer({ id: 'p2' });
        House.initialize(angry, { day: 0 });
        House.seedRivals(angry, worldWithKingdoms(), 1);
        House.accrueRivalFeud(angry, { day: 1 }, 'k2', 100);
        expect(House._disputeChance(angry.house)).toBeGreaterThan(base);
    });

    it('a hot rival can threaten a claim, setting a pending claim', () => {
        Utils.setSeed(3);
        const player = makePlayer();
        House.initialize(player, { day: 0 });
        House.seedRivals(player, worldWithKingdoms(), 1);
        House.accrueRivalFeud(player, { day: 1 }, 'k2', 100); // max feud
        const cadence = House._getConfig().rivalActionCadence;
        let threatened = false;
        for (let i = 1; i <= 20 && !threatened; i++) {
            const action = House._processRivals(player, { day: cadence * i });
            if (action && action.type === 'claim_threat') threatened = true;
        }
        expect(threatened).toBe(true);
        expect(player.house._pendingClaim).toBe(true);
    });
});

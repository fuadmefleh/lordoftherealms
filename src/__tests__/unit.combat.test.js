/**
 * Pure unit tests for hostile-encounter resolution — enabled by the Phase-5
 * logic/render split (src/ui/game/combat.logic.js).
 *
 * Previously this logic lived inside a Game mixin method that called
 * this.ui.showNotification / audioManager / setTimeout, so it could only run
 * inside a fully-constructed Game. Now it's a pure function we can seed and
 * assert on directly.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolveHostileEncounter } from '../ui/game/combat.logic.js';
import { Utils } from '../core/utils.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Quests } from '../systems/quests.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makePlayer() {
    return {
        name: 'Hero',
        gold: 1000,
        health: 100,
        army: [], // no army => robbery path
        inventory: { bread: 10, iron: 4, quest: 1 },
    };
}
function makeAttacker() {
    return { name: 'Raider', strength: 5, inventory: {}, targetQ: 3, targetR: 3 };
}

describe('resolveHostileEncounter — robbery (no army)', () => {
    it('mutates player/attacker/world and returns a render descriptor', () => {
        Utils.setSeed(5);
        const player = makePlayer();
        const attacker = makeAttacker();
        const world = { events: [] };

        const out = resolveHostileEncounter(player, attacker, world);

        expect(out.kind).toBe('robbed');
        expect(out.notification.type).toBe('error');
        // gold and health were taken
        expect(player.gold).toBe(1000 - out.goldStolen);
        expect(out.goldStolen).toBeGreaterThanOrEqual(0);
        expect(player.health).toBe(100 - out.healthLost);
        expect(out.healthLost).toBeGreaterThanOrEqual(5);
        expect(out.healthLost).toBeLessThanOrEqual(15);
        // stolen gold transferred to the attacker
        expect(attacker.inventory.gold).toBe(out.goldStolen);
        // a world event was recorded and the raider released its target
        expect(world.events).toHaveLength(1);
        expect(attacker.targetQ).toBeNull();
        // the "quest" item is never stolen
        expect(player.inventory.quest).toBe(1);
    });

    it('is reproducible under a fixed seed', () => {
        const run = () => {
            Utils.setSeed(99);
            const player = makePlayer();
            const attacker = makeAttacker();
            const out = resolveHostileEncounter(player, attacker, { events: [] });
            return { gold: player.gold, health: player.health, out };
        };
        expect(run()).toEqual(run());
    });
});

describe('raiding settlements', () => {
    function raider() {
        const p = { gold: 0, karma: 0, renown: 0, reputation: {}, skills: { leadership: 5, combat: 5 }, health: 100, maxHealth: 100,
            army: Array.from({ length: 40 }, () => ({ type: 'knight', strength: 30, level: 1 })) };
        Quests.initialize(p);
        return p;
    }
    const village = () => ({ name: 'Ashby', type: 'village', population: 200, kingdom: 'k1' });
    const world = (day) => ({ day, getTile: () => null, getKingdom: () => null, kingdoms: [], settlements: [] });

    it('a strong army plunders a village, which then cannot be raided again for a while', () => {
        Utils.setSeed(7);
        const player = raider();
        const s = village();
        const first = PlayerMilitary.raidSettlement(player, s, { terrain: { id: 'plains' } }, world(10));
        expect(first.victory).toBe(true);
        expect(player.gold).toBeGreaterThanOrEqual(first.plunder);
        expect(s.lastRaidedDay).toBe(10);
        const again = PlayerMilitary.raidSettlement(player, s, { terrain: { id: 'plains' } }, world(20));
        expect(again.success).toBe(false);
        const later = PlayerMilitary.raidSettlement(player, s, { terrain: { id: 'plains' } }, world(10 + PlayerMilitary.RAID_COOLDOWN_DAYS));
        expect(later.success).not.toBe(false);
    });
});

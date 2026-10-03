// World unit types defined in data/units.json beyond the hand-written ones:
// they build from data, behave (travel, hunt pirates, settle refugees),
// spawn, and creatures maul rather than rob an unarmed player.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { WorldUnit } from '../world/units.js';
import { resolveHostileEncounter } from '../ui/game/combat.logic.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(21));

describe('Data-defined world units', () => {
    it('build every data unit type with stats from units.json', () => {
        for (const [type, def] of Object.entries(WorldUnit.TYPES)) {
            const u = new WorldUnit(type, 1, 1);
            expect(u.name, type).toBe(def.name);
            expect(u.icon, type).toBe(def.icon);
        }
        const monster = new WorldUnit('monster', 0, 0);
        expect(monster.strength).toBeGreaterThanOrEqual(80);
        expect(monster.inventory.gold).toBeGreaterThan(0);
    });

    it('war fleets sink pirates within a hex', () => {
        const fleet = new WorldUnit('war_fleet', 5, 5);
        const pirate = new WorldUnit('pirate', 6, 5);
        const world = { width: 20, units: [fleet, pirate], events: [] };
        fleet._sinkNearbyPirates(world);
        expect(pirate.destroyed).toBe(true);
        expect(world.events).toHaveLength(1);
    });

    it('refugees swell the settlement they reach', () => {
        const refugees = new WorldUnit('refugee', 3, 3);
        const settlement = { name: 'Ashby', population: 100 };
        refugees._onArrive({ getTile: () => ({ settlement }), events: [] });
        expect(settlement.population).toBe(100 + Math.floor(refugees.population / 2));
    });

    it('a beast mauls an unarmed player without stealing anything', () => {
        const beast = new WorldUnit('beast', 2, 2);
        const player = { gold: 500, health: 100, army: [], inventory: { bread: 5 } };
        const res = resolveHostileEncounter(player, beast, { events: [] });
        expect(res.goldStolen).toBe(0);
        expect(player.gold).toBe(500);
        expect(player.inventory.bread).toBe(5);
        expect(player.health).toBeLessThan(100);
    });
});

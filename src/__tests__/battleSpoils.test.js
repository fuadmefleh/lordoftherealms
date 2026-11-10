// Every battle's spoils come out of something (PlayerMilitary._battleSpoils /
// _spoilsSource / _armsSource, systems/arms.js battleSpoils): the beaten
// band's purse and packs, the defeated realm's treasury and armoury share, the
// plundered town's purse — capped at what each holds. No source, no coin and
// no stripped arms.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerMilitary } from '../player/playerMilitary.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function player(gold = 0) {
    return {
        name: 'Ash', gold, karma: 0, renown: 0, inventory: {}, maxInventory: 200,
        skills: { combat: 1, leadership: 1 },
        army: [{ type: 'soldier', strength: 10, level: 1, experience: 0 }],
    };
}

describe('the spoils of victory come from somewhere', () => {
    it('no source: no coin, no stripped arms', () => {
        Utils.setSeed(1);
        const p = player();
        const s = PlayerMilitary._battleSpoils(p, true, 200, {});
        expect(s.loot).toBe(0);
        expect(p.gold).toBe(0);
        expect(s.armsTaken || {}).toEqual({});
    });

    it('a band\'s purse and packs: taken out of them, never more than they held', () => {
        Utils.setSeed(2);
        const p = player();
        const unit = { id: 'u1', type: 'raider', inventory: { gold: 30, spear: 1, weapons: 0 } };
        const s = PlayerMilitary._battleSpoils(p, true, 200, { ...PlayerMilitary._unitLoot(unit, null) });
        expect(s.loot).toBeLessThanOrEqual(30);
        expect(p.gold).toBe(s.loot);
        expect(unit.inventory.gold).toBe(30 - s.loot);
        // one spear carried: at most one stripped, and it leaves their packs
        if (s.armsTaken && s.armsTaken.spear) {
            expect(s.armsTaken.spear).toBe(1);
            expect(unit.inventory.spear).toBe(0);
        }
        expect((s.armsTaken || {}).weapons || 0).toBe(0);
    });

    it('a realm\'s men: the coin out of its treasury, the arms out of its armoury share', () => {
        Utils.setSeed(3);
        const p = player();
        const k = { id: 'k1', treasury: 50, military: 200, armoury: { stock: { weapons: 100, spear: 100, shield: 100 } } };
        const s = PlayerMilitary._battleSpoils(p, true, 200, { lootKingdom: k, world: { getKingdom: () => k } });
        expect(s.loot).toBeLessThanOrEqual(50);
        expect(k.treasury).toBe(50 - s.loot);
        const took = Object.values(s.armsTaken || {}).reduce((a, b) => a + b, 0);
        expect(took).toBeGreaterThan(0);
        expect(k.armoury.stock.spear + k.armoury.stock.weapons + k.armoury.stock.shield).toBe(300 - took);
    });

    it('a town\'s garrison: the coin out of the town\'s purse', () => {
        Utils.setSeed(4);
        const p = player();
        const town = { name: 'Ford', population: 400, economy: { gold: 12 } };
        const s = PlayerMilitary._battleSpoils(p, true, 200, { lootTown: town });
        expect(s.loot).toBeLessThanOrEqual(12);
        expect(town.economy.gold).toBe(12 - s.loot);
    });
});

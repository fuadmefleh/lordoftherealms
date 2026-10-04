// Espionage numbers that used to be display-only now act: war risk,
// popular unrest, mission traits, critical-success rewards.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Espionage } from '../systems/espionage.js';
import { RealmWars } from '../systems/realmWars.js';

const kingdom = () => ({ id: 'k2', name: 'Varn', isAlive: true, treasury: 1000, military: 100, stability: 60, territory: [], relations: {} });
const world = (k) => ({ day: 50, events: [], getKingdom: () => k, getTile: () => null });

describe('Espionage consequences', () => {
    beforeAll(async () => {
        await DataLoader.initializeAll();
    });

    it('a captured spy can provoke an ultimatum; never against your own liege', () => {
        const k = kingdom();
        const def = { consequences: { warChanceIncrease: 1 } };
        const player = { gold: 0 };
        const u = Espionage._provokeKingdom(player, world(k), k, def, 'captured');
        expect(u).toBeTruthy();
        expect(RealmWars._state(player).ultimatums.k2).toBeTruthy();
        // already under ultimatum: no second one
        expect(Espionage._provokeKingdom(player, world(k), k, def, 'captured')).toBeNull();

        const sworn = { gold: 0, allegiance: 'k2' };
        expect(Espionage._provokeKingdom(sworn, world(k), k, def, 'captured')).toBeNull();
    });

    it('a quiet success is far less provocative than getting caught', () => {
        const def = { consequences: { warChanceIncrease: 0.4 } };
        let caught = 0;
        let quiet = 0;
        Utils.setSeed(9);
        for (let i = 0; i < 400; i++) {
            const k = kingdom();
            if (Espionage._provokeKingdom({}, world(k), k, def, 'captured')) caught++;
            if (Espionage._provokeKingdom({}, world(k), k, def, 'success')) quiet++;
        }
        expect(caught).toBeGreaterThan(quiet * 2);
    });

    it('rebellion unrest drains stability each day it lasts', () => {
        const k = kingdom();
        Espionage._applyRebellionDailyEffect({ kingdomId: 'k2', unrestPerDay: 1 }, world(k));
        expect(k.stability).toBe(59);
    });

    it('spy traits help on their speciality', () => {
        const traits = Espionage._getSpyTraits();
        const alchemist = traits.find(t => t.id === 'alchemist');
        expect(alchemist).toBeTruthy();
        const spy = { traits: ['alchemist'] };
        expect(Espionage._traitMissionBonus(spy, 'assassinate')).toBeCloseTo(alchemist.effect.assassinBonus);
        expect(Espionage._traitMissionBonus(spy, 'gather_intel')).toBe(0);
    });
});

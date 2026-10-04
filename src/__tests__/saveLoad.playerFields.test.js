// Player state the game reads back survives a save/load round trip: trained
// attributes, debts, contracts, tax policy, map deceptions and the marriage
// alliance used to be dropped by serializePlayer and reset on load.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

describe('save/load keeps player fields', () => {
    it('round-trips attributes, loans, tax rate, contracts and alliances', () => {
        const p = new Player();
        p.charisma = 9;
        p.intelligence = 11;
        p.faith = 7;
        p.maxInventory = 24;
        p.loans = { k1: [{ amount: 500, dueDay: 40 }] };
        p.taxRate = 'high';
        p.activeContract = { kingdomId: 'k2', daysLeft: 12 };
        p.mapDeceptions = { m1: { kind: 'doctored' } };
        p.marriageAllianceKingdom = 'k3';
        p.jobsCompleted = 4;

        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);

        expect(back.charisma).toBe(9);
        expect(back.intelligence).toBe(11);
        expect(back.faith).toBe(7);
        expect(back.maxInventory).toBe(24);
        expect(back.loans).toEqual({ k1: [{ amount: 500, dueDay: 40 }] });
        expect(back.taxRate).toBe('high');
        expect(back.activeContract).toEqual({ kingdomId: 'k2', daysLeft: 12 });
        expect(back.mapDeceptions).toEqual({ m1: { kind: 'doctored' } });
        expect(back.marriageAllianceKingdom).toBe('k3');
        expect(back.jobsCompleted).toBe(4);
    });

    it('older saves without the fields still load with defaults', () => {
        const data = SaveLoad.serializePlayer(new Player());
        for (const k of SaveLoad.EXTRA_PLAYER_FIELDS) delete data[k];
        const back = new Player();
        SaveLoad.restorePlayer(data, back);
        expect(back.charisma).toBe(new Player().charisma);
        expect(back.loans).toEqual({});
    });
});

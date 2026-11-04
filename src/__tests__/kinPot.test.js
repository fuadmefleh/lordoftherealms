// The kin's pot at the Dawn of Man (player/dawnBirth.js): a child of the clan
// is fed at its family's fire while they pull their weight, and turned away
// once they have taken too many meals without giving back.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { DawnBirth } from '../player/dawnBirth.js';
import { Relationships } from '../systems/relationships.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

let spy;
beforeEach(() => {
    spy = vi.spyOn(Relationships, 'getNPC').mockImplementation((id) => (id === 'kin1' ? { id, firstName: 'Bran', kin: 'father', isAlive: true } : null));
});
afterEach(() => spy.mockRestore());

function world({ clanAt = { q: 5, r: 5 }, village = false } = {}) {
    const units = clanAt ? [{ id: 'c1', type: 'clan', q: clanAt.q, r: clanAt.r }] : [];
    return {
        day: 10, width: 40, height: 40, units, dawn: {},
        getTile: (q, r) => ({ q, r, terrain: { id: 'plains', passable: true }, settlement: village && q === 9 && r === 9 ? { name: 'Ashford', type: 'village' } : null }),
    };
}

function child() {
    const p = new Player();
    p.inventory = {};
    p.q = 5; p.r = 5;
    p.dawnClan = 'c1';
    p.dawnKin = ['kin1'];
    p.health = 100;
    return p;
}

const maxOwed = () => DawnBirth._hearthCfg().maxOwed;

describe('the kin\'s pot', () => {
    it('feeds a child of the clan at the camp, never one far from it', () => {
        const w = world();
        const p = child();
        expect(DawnBirth.kinHearth(p, w)).toBe('clan');
        p.endDay(w);
        expect(p.starvationDays).toBe(0);
        expect(p._kinMeal.from).toBe('clan');
        expect(p.kinOwed).toBe(1);
        p.q = 20;
        expect(DawnBirth.kinHearth(p, w)).toBeNull();
        p.endDay(w);
        expect(p.starvationDays).toBe(1);
    });

    it('feeds them at home in the village once the clan has settled', () => {
        const w = world({ clanAt: null, village: true });
        const p = child();
        p.dawnClan = null;
        p.dawnHome = { q: 9, r: 9, name: 'Ashford' };
        p.q = 9; p.r = 9;
        expect(DawnBirth.kinHearth(p, w)).toBe('home');
        // An orphan has no pot to eat from
        spy.mockImplementation(() => null);
        expect(DawnBirth.kinHearth(p, w)).toBeNull();
    });

    it('turns an idle mouth away after maxOwed meals', () => {
        const w = world();
        const p = child();
        for (let i = 0; i < maxOwed(); i++) p.endDay(w);
        expect(p.starvationDays).toBe(0);
        expect(p.kinOwed).toBe(maxOwed());
        p.endDay(w);
        expect(p.starvationDays).toBe(1);
        expect(p._kinMeal.refused).toBe(true);
    });

    it('a day out foraging or hunting earns the meal and pays one back', () => {
        const w = world();
        const p = child();
        p.kinOwed = maxOwed();
        p.endDay(w); // refused, but the kin have now seen what work you have done
        p.huntingTrips = (p.huntingTrips || 0) + 1;
        p.endDay(w);
        expect(p.starvationDays).toBe(0);
        expect(p._kinMeal.earned).toBe(true);
        expect(p.kinOwed).toBe(maxOwed() - 1);
    });

    it('food brought home beyond what you keep goes into the pot', () => {
        const w = world();
        const p = child();
        p.kinOwed = 4;
        p.inventory = { berries: 10 };
        p.endDay(w); // eats one of its own, then hands over what is owed
        expect(p._kinMeal.qty).toBe(Math.min(4, 9 - DawnBirth._hearthCfg().keepFood));
        expect(p.getFoodCount()).toBe(9 - p._kinMeal.qty);
        expect(p.kinOwed || 0).toBe(4 - p._kinMeal.qty);
    });

    it('no dawn, no pot: a world without kin starves the foodless as before', () => {
        const p = child();
        p.dawnKin = null;
        p.endDay(world());
        expect(p.starvationDays).toBe(1);
    });

    it('what is owed survives a save', () => {
        const p = child();
        p.kinOwed = 3;
        p.kinWorkSeen = 7;
        const back = new Player();
        SaveLoad.restorePlayer(JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p))), back);
        expect(back.kinOwed).toBe(3);
        expect(back.kinWorkSeen).toBe(7);
    });
});

/**
 * The day's one clock (ui/game/dayClock.js): action points spent anywhere pass the
 * day's hours, and the hours left cap the points, so time spent in person costs
 * points too; a new day wakes at the wake hour; the clock is kept with the save.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

let DayClock, InnerMap, DataLoader;

beforeAll(async () => {
    ({ DataLoader } = await import('../core/dataLoader.js'));
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DayClock } = await import('../ui/game/dayClock.js'));
}, 120000);

const game = (ap = 10, day = 3) => ({ player: { actionPoints: ap, maxActionPoints: 10 }, world: { day }, ui: null });

beforeEach(() => {
    InnerMap.timeOfDay = 8;
    InnerMap._timeAccumulator = 0;
    InnerMap.dayEnded = false;
    DayClock._seenAP = null;
    DayClock._seenDay = null;
});

describe('the day clock', () => {
    it('a full day of points fills the waking day', () => {
        const { hoursPerAP, wakeHour } = DayClock.config();
        expect(wakeHour).toBe(8);
        expect(wakeHour + 10 * hoursPerAP).toBeLessThanOrEqual(24);
        expect(wakeHour + 11 * hoursPerAP).toBeGreaterThan(22);
    });

    it('points spent pass the hours, however they were spent', () => {
        const g = game();
        DayClock.sync(g);
        expect(DayClock.now()).toBe(8);
        g.player.actionPoints -= 2;              // (two hexes walked, say)
        DayClock.sync(g);
        expect(DayClock.now()).toBeCloseTo(8 + 2 * DayClock.config().hoursPerAP);
        expect(g.player.actionPoints).toBe(8);
        g.player.actionPoints -= 5;              // (a day's labour)
        DayClock.sync(g);
        expect(DayClock.now()).toBeCloseTo(8 + 7 * DayClock.config().hoursPerAP);
        expect(g.player.actionPoints).toBe(3);
    });

    it('hours passed in person cost points: never more than the hours left allow', () => {
        const g = game();
        DayClock.sync(g);
        InnerMap.passHours(6);                   // an afternoon walking the town, work in a field…
        DayClock.sync(g);
        expect(DayClock.now()).toBe(14);
        expect(g.player.actionPoints).toBe(Math.floor(10 / DayClock.config().hoursPerAP));
        // and that cut isn't counted as points spent (the clock doesn't jump again)
        DayClock.sync(g);
        expect(DayClock.now()).toBe(14);
        InnerMap.timeOfDay = 23;
        DayClock.sync(g);
        expect(g.player.actionPoints).toBe(0);
    });

    it('a new day (or points given back) is taken as it is, and wakes at the wake hour', () => {
        const g = game(4);
        DayClock.sync(g);
        g.player.actionPoints = 6;               // a bonus: no time back
        DayClock.sync(g);
        expect(DayClock.now()).toBe(8);
        InnerMap.timeOfDay = 22;
        DayClock.wake();
        g.world.day = 4;
        g.player.actionPoints = 10;
        DayClock.sync(g);
        expect(DayClock.now()).toBe(8);
        expect(g.player.actionPoints).toBe(10);
    });

    it('stands still while the day is being turned', () => {
        const g = game();
        DayClock.sync(g);
        g.isProcessingTurn = true;
        g.player.actionPoints = 0;
        DayClock.sync(g);
        expect(DayClock.now()).toBe(8);
    });

    it('the clock is kept with the save', () => {
        InnerMap.timeOfDay = 15;
        InnerMap._timeAccumulator = 30;
        const data = JSON.parse(JSON.stringify(InnerMap.serialize()));
        InnerMap.timeOfDay = 8;
        InnerMap._timeAccumulator = 0;
        InnerMap.deserialize(data);
        expect(InnerMap.timeOfDay).toBe(15);
        expect(InnerMap._timeAccumulator).toBe(30);
    });
});

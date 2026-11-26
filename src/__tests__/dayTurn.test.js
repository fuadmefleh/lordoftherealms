// The day's end in steps (ui/game/dayTurn.js): the world's day, the markets and the
// autosave as generators, driven at once (tests, the harness) or a slice a frame
// (the browser). The steps must come out exactly as the one-go versions.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { DayTurn } from '../ui/game/dayTurn.js';

beforeAll(async () => {
    await loadData();
});

/** Drive a generator to the end, counting its steps. */
function drive(gen) {
    let steps = 0;
    let r = gen.next();
    while (!r.done) { steps++; r = gen.next(); }
    return { value: r.value, steps };
}

describe('the world\'s day in steps', () => {
    it('advanceDaySteps is advanceDay: the same world and the same draws after', () => {
        const a = newGame(4242);
        a.world.advanceDay(a.player, {});
        a.world.advanceDay(a.player, {});
        const ra = Utils.random();
        const sa = SaveLoad._jsonSteps({ world: SaveLoad.serializeWorld(a.world) });

        const b = newGame(4242);
        let steps = 0;
        for (let d = 0; d < 2; d++) {
            const it = b.world.advanceDaySteps(b.player, {});
            const out = drive(it);
            steps += out.steps;
            expect(out.value.day).toBe(b.world.day);
            // (the per-day caches are dropped once the day is done)
            expect(b.world.isSimulatingDay()).toBe(false);
        }
        const rb = Utils.random();
        const sb = SaveLoad._jsonSteps({ world: SaveLoad.serializeWorld(b.world) });
        expect(steps).toBeGreaterThan(10);
        expect(b.world.day).toBe(a.world.day);
        expect(rb).toBe(ra);
        expect(drive(sb).value).toBe(drive(sa).value);
    }, 60000);

    it('updatePricesSteps is updatePrices', () => {
        const a = newGame(777);
        a.world.advanceDay(a.player, {});
        const fa = MarketDynamics.updatePrices(a.world, a.player);
        const ra = Utils.random();
        const b = newGame(777);
        b.world.advanceDay(b.player, {});
        const out = drive(MarketDynamics.updatePricesSteps(b.world, b.player));
        expect(out.steps).toBeGreaterThan(3);
        expect(Utils.random()).toBe(ra);
        expect(JSON.stringify(out.value)).toBe(JSON.stringify(fa));
    }, 60000);
});

describe('the autosave in steps', () => {
    it('_jsonSteps writes exactly what JSON.stringify writes', () => {
        const tiles = Array.from({ length: 30 }, (_, r) => Array.from({ length: 4 }, (_, q) => (q % 2 ? {} : { explored: true, kingdom: r, s: 'a"b\n' })));
        const data = {
            version: '1.0',
            timestamp: 123,
            skip: undefined,
            fn: () => 1,
            meta: { ironman: false, name: 'Ældric 🗡️' },
            world: { width: 4, tiles, gone: undefined, when: new Date(0), list: [1, undefined, null], nested: { a: [{ b: 2 }] } },
            player: { gold: 10.5, inv: { bread: 3 } },
            notificationLog: [],
        };
        const out = drive(SaveLoad._jsonSteps(data));
        expect(out.steps).toBeGreaterThan(2);
        expect(out.value).toBe(JSON.stringify(data));
    });

    it('serializeWorldSteps is serializeWorld', () => {
        const g = newGame(31);
        g.world.advanceDay(g.player, {});
        const one = JSON.stringify(SaveLoad.serializeWorld(g.world));
        const out = drive(SaveLoad.serializeWorldSteps(g.world));
        expect(out.steps).toBeGreaterThanOrEqual(Math.ceil(g.world.tiles.length / 12));
        expect(JSON.stringify(out.value)).toBe(one);
    }, 60000);
});

describe('DayTurn', () => {
    function* busySteps(log, n, ms) {
        for (let i = 0; i < n; i++) {
            const t = performance.now();
            while (performance.now() - t < ms) { /* a step's work */ }
            log.push(i);
            yield;
        }
        return 'done';
    }

    it('runSync drives every step at once', () => {
        const log = [];
        expect(DayTurn.runSync(busySteps(log, 5, 0))).toBe('done');
        expect(log).toEqual([0, 1, 2, 3, 4]);
    });

    it('runSliced runs the steps in order a budget at a time, holding the notices till the end', async () => {
        const log = [];
        const cards = [];
        const ui = {
            _held: null,
            holdNotifications() { this._held = []; },
            releaseNotifications() { cards.push(...this._held); this._held = null; },
            showNotification(t) { if (this._held) this._held.push(t); else cards.push(t); },
        };
        const game = { ui };
        function* steps() {
            ui.showNotification('first');
            yield* busySteps(log, 6, 3);
            ui.showNotification('second');
        }
        await new Promise((res) => {
            DayTurn.runSliced(game, steps(), { budgetMs: 4, onDone: res });
            expect(game._dayTurning).toBe(true);
            expect(log).toEqual([]);
        });
        expect(log).toEqual([0, 1, 2, 3, 4, 5]);
        expect(game._dayTurning).toBe(false);
        expect(cards).toEqual(['first', 'second']);
        expect(game._lastDayTurn.slices).toBeGreaterThan(1);
    });

    it('letting days pass keeps its own notices', async () => {
        const ui = { holdNotifications() { throw new Error('held'); }, releaseNotifications() {} };
        const game = { ui };
        await new Promise((res) => DayTurn.runSliced(game, busySteps([], 2, 0), { mode: 'skip', onDone: res }));
        expect(game._dayTurning).toBe(false);
    });
});

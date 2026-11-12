// Time skip (ui/timeSkip.js) and the central interrupt queue (core/interrupts.js):
// a week passes as seven real turns on a headless game, and the wait stops
// early on an injected interrupt, a serious notice, or Stop.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Interrupts } from '../core/interrupts.js';
import { TimeSkip } from '../ui/timeSkip.js';
import { Hospitality } from '../systems/hospitality.js';

beforeAll(async () => {
    await loadData();
});

const noYield = () => Promise.resolve();

/** A harness game dressed as the live one: a ui whose notices the skip captures. */
function harnessGame(seed = 4242) {
    const g = newGame(seed);
    g.isProcessingTurn = false;
    g.shown = [];
    g.ui = { showNotification: (title, message, type) => g.shown.push({ title, message, type }), _logNotification() {} };
    // A well-fed, rested traveller, so the body's thresholds don't cut the week short
    g.player.needs = { hunger: 100, energy: 100, social: 100, fun: 100, hygiene: 100, comfort: 100 };
    g.player.inventory = { ...(g.player.inventory || {}), bread: 30 };
    // No bands about: this test is about the days, not the road
    g.world.units = (g.world.units || []).filter(u => !['raider', 'pirate', 'beast', 'monster', 'war_host'].includes(u.type) && !u.hostile);
    return g;
}

/** One harness turn as the skip's runDay. */
const harnessDay = g => {
    const r = endDay(g);
    return !(r && r.died);
};

describe('Interrupts (core/interrupts.js)', () => {
    it('raises, takes and clears', () => {
        const world = { day: 5 };
        expect(Interrupts.take(world)).toEqual([]);
        Interrupts.raise(world, { reason: 'War!', icon: '⚔️', source: 'test' });
        Interrupts.raise(world, 'A letter');
        expect(Interrupts.pending(world).map(e => e.reason)).toEqual(['War!', 'A letter']);
        const taken = Interrupts.take(world);
        expect(taken).toHaveLength(2);
        expect(taken[0]).toMatchObject({ reason: 'War!', icon: '⚔️', source: 'test', day: 5 });
        expect(Interrupts.pending(world)).toEqual([]);
        Interrupts.raise(world, 'x');
        Interrupts.clear(world);
        expect(Interrupts.pending(world)).toEqual([]);
    });

    it('drops entries nobody took and caps the queue', () => {
        const world = { day: 1 };
        Interrupts.raise(world, 'old');
        world.day = 5;
        Interrupts.raise(world, 'new');
        expect(Interrupts.pending(world).map(e => e.reason)).toEqual(['new']);
        for (let i = 0; i < 40; i++) Interrupts.raise(world, `n${i}`);
        expect(Interrupts.pending(world).length).toBeLessThanOrEqual(24);
        expect(Interrupts.raise(null, 'x')).toBeNull();
    });
});

describe('TimeSkip (ui/timeSkip.js)', () => {
    it('counts the days to the season turn', () => {
        expect(TimeSkip.daysToSeason({ day: 1 })).toBe(30);
        expect(TimeSkip.daysToSeason({ day: 30 })).toBe(1);
        expect(TimeSkip.daysToSeason({ day: 31 })).toBe(30);
        expect(TimeSkip.daysFor({ day: 25 }, 'season')).toBe(6);
        expect(TimeSkip.daysFor({ day: 25 }, 7)).toBe(7);
    });

    it('skips a week: seven real turns, the day moved on by 7', async () => {
        const g = harnessGame();
        const start = g.world.day;
        const skip = await TimeSkip.run(g, 7, { runDay: harnessDay, yieldFn: noYield });
        expect(skip.reason).toBeNull();
        expect(skip.done).toBe(7);
        expect(g.world.day).toBe(start + 7);
        expect(g._timeSkip).toBeNull();
        expect(g.isProcessingTurn).toBe(false);
    }, 120000);

    it('stops early on an interrupt a system raises', async () => {
        const g = harnessGame(777);
        const start = g.world.day;
        let n = 0;
        const runDay = game => {
            const ok = harnessDay(game);
            if (++n === 3) Interrupts.raise(game.world, { reason: 'The king summons you', icon: '👑', source: 'test' });
            return ok;
        };
        const skip = await TimeSkip.run(g, 7, { runDay, yieldFn: noYield });
        expect(skip.done).toBe(3);
        expect(g.world.day).toBe(start + 3);
        expect(skip.reason).toMatchObject({ reason: 'The king summons you', icon: '👑' });
    }, 120000);

    it('gathers notices for one digest, and a serious one stops the wait', async () => {
        const g = harnessGame(778);
        let n = 0;
        const runDay = game => {
            const ok = harnessDay(game);
            n++;
            game.ui.showNotification('Tax Collection', '+3 gold from settlements', 'success');
            if (n === 2) game.ui.showNotification('⚔️ War Declared!', 'The north marches on you.', 'error');
            return ok;
        };
        const ui = g.ui;
        const skip = await TimeSkip.run(g, 7, { runDay, yieldFn: noYield });
        expect(skip.done).toBe(2);
        expect(skip.reason.reason).toMatch(/War Declared/);
        // Nothing reached the toasts; the ui's own showNotification is back afterwards
        expect(g.shown).toEqual([]);
        expect(g.ui).toBe(ui);
        g.ui.showNotification('after', 'x', 'info');
        expect(g.shown).toHaveLength(1);
        const d = TimeSkip.digestOf(skip);
        expect(d.important.map(i => i.title)).toContain('⚔️ War Declared!');
        const tax = d.routine.concat(d.important).find(i => i.title === 'Tax Collection');
        expect(tax.count).toBe(2);
    }, 120000);

    it('stops when asked, after the day under way', async () => {
        const g = harnessGame(779);
        const skip = await TimeSkip.run(g, 7, { runDay: harnessDay, yieldFn: noYield, onProgress: s => { s.stop = true; } });
        expect(skip.done).toBe(1);
        expect(skip.cancelled).toBe(true);
    }, 120000);

    it('refuses while travelling, mid-scene or mid-turn', async () => {
        const g = harnessGame(780);
        g.player.queuedPath = [{ q: 0, r: 0 }];
        expect(TimeSkip.canSkip(g).ok).toBe(false);
        const skip = await TimeSkip.run(g, 7, { runDay: harnessDay, yieldFn: noYield });
        expect(skip.done).toBe(0);
        expect(skip.refused).toMatch(/road/);
        g.player.queuedPath = null;
        g._scene = { kind: 'sea' };
        expect(TimeSkip.canSkip(g).ok).toBe(false);
        g._scene = null;
        g.isProcessingTurn = true;
        expect(TimeSkip.canSkip(g).ok).toBe(false);
        g.isProcessingTurn = false;
        expect(TimeSkip.canSkip(g).ok).toBe(true);
    }, 120000);

    it('takes the room again each night and pays for it', async () => {
        const g = harnessGame(781);
        const { world, player } = g;
        // Stand in a town with a house that lets rooms
        const towns = world.getSettlementViews ? world.getSettlementViews() : [];
        const town = towns.find(s => Hospitality.listAt(world, player, s.q, s.r).length);
        expect(town).toBeTruthy();
        player.q = town.q; player.r = town.r;
        player.gold = 5000;
        const room = TimeSkip.cheapestRoom(world, player);
        expect(room).toBeTruthy();
        const skip = await TimeSkip.run(g, 3, { runDay: harnessDay, yieldFn: noYield, lodge: room });
        expect(skip.done).toBe(3);
        expect(skip.nights).toBe(3);
        expect(skip.lodgingPaid).toBeGreaterThanOrEqual(0);
    }, 120000);
});

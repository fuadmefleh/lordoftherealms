// The cheats panel's Family & Court row (src/ui/ui/cheats.js): the parents'
// trust, a pardon, coming of age at once, filling the court, loyal courtiers.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Scenarios } from '../player/scenarios.js';
import { Parentage } from '../player/parentage.js';
import { Court } from '../systems/court.js';

let UI;
beforeAll(async () => {
    await loadData();
    ({ UI } = await import('../ui/ui/index.js'));
});

/** The cheats' `this`: the game, and quiet notices. */
function host(g) {
    const notes = [];
    const h = Object.create(UI.prototype);
    h.game = g;
    h._cheatDone = (t, m) => notes.push(`${t}: ${m}`);
    h.showNotification = (t, m) => notes.push(`${t}: ${m}`);
    return { h, notes };
}

describe('Family & Court cheats', () => {
    it('trust, a pardon and coming of age end the parents\' rule', () => {
        const g = newGame(81);
        Scenarios.apply(g.player, g.world, { origin: 'born', parents: 'farmer', birthAge: 14 });
        const { h } = host(g);
        const pa = Parentage.state(g.player);
        const t = pa.trust;
        h.cheatParentTrust(25);
        expect(pa.trust).toBe(Math.min(100, t + 25));
        h.cheatParentTrust(1000);
        expect(pa.trust).toBe(Number((Parentage.data().trust || {}).max) || 100);
        pa.strikes = [{ d: g.world.day, n: 3 }];
        pa.grounded = { until: g.world.day + 5, since: g.world.day };
        h.cheatParentPardon();
        expect(pa.strikes).toEqual([]);
        expect(pa.grounded).toBe(null);
        h.cheatComeOfAge();
        expect(pa.active).toBe(false);
        expect(g.player.age).toBeGreaterThanOrEqual(16);
    });

    it('fills the court to capacity with people you know, and makes them loyal', () => {
        const g = newGame(82);
        Scenarios.apply(g.player, g.world, { origin: 'great_lord' });
        const { h } = host(g);
        h.cheatCourtFill();
        const n = Court.members(g.player).length;
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThanOrEqual(Court.capacity(g.player));
        h.cheatCourtLoyal();
        for (const e of Court.ensure(g.player)) expect(e.loyalty).toBe(100);
    });
});

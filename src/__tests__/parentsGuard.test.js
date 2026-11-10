// Your parents' rules at every door (ui/parentsGuard.js): not only the action
// menu but the panels reached other ways (the tavern's dice tables open the
// gambling den, Counsel opens the contracts) and the street map's own deeds
// (taking from a stall, setting on someone, robbing a body) are checked. A
// panel's door is one defiance a day at a place; each deed is weighed anew.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Parentage } from '../player/parentage.js';
import { Scenarios } from '../player/scenarios.js';
import { ParentsGuard } from '../ui/parentsGuard.js';

beforeAll(async () => {
    await loadData();
});

function born(seed, parents = 'farmer') {
    const g = newGame(seed);
    Scenarios.apply(g.player, g.world, { origin: 'born', parents, birthAge: 14 });
    const notes = [];
    g.ui = { showNotification: (t, b, k) => notes.push({ t, b, k }) };
    return { g, notes };
}

describe('parents at every door', () => {
    it('a gambling den reached from the tavern is defiance, found out at home', () => {
        const { g, notes } = born(71);
        const pa = g.player.parentage;
        expect(pa.active).toBe(true);
        const trust = pa.trust;
        expect(ParentsGuard.ok(g, 'gambling')).toBe(true); // defiance goes ahead
        expect(pa.trust).toBeLessThan(trust);               // and at home they always hear
        expect(notes.some(n => /Your Parents/.test(n.t))).toBe(true);
    });

    it('going on through the same door that day asks nothing more; a deed is weighed every time', () => {
        const { g } = born(72);
        const pa = g.player.parentage;
        ParentsGuard.ok(g, 'tavern');
        const after = pa.trust;
        ParentsGuard.ok(g, 'tavern');
        ParentsGuard.ok(g, 'tavern');
        expect(pa.trust).toBe(after);
        // (a fresh life: one with strikes already piling up is soon grounded or sent away)
        const fresh = born(76);
        ParentsGuard.ok(fresh.g, 'theft', null, { each: true });
        const n1 = fresh.notes.length;
        ParentsGuard.ok(fresh.g, 'theft', null, { each: true });
        expect(n1).toBeGreaterThan(0);
        expect(fresh.notes.length).toBeGreaterThan(n1);
    });

    it('theft and setting on someone on the street map are crimes to them', () => {
        const { g } = born(73);
        expect(Parentage.check(g.player, g.world, 'theft')).toMatchObject({ rule: 'crime' });
        expect(Parentage.check(g.player, g.world, 'assault')).toMatchObject({ rule: 'crime' });
    });

    it('grounded, the door is shut', () => {
        const { g, notes } = born(74);
        const pa = g.player.parentage;
        pa.grounded = { until: g.world.day + 5, since: g.world.day };
        const grounded = Parentage.data().grounded || {};
        const refusedType = (grounded.actions || ['tavern'])[0];
        expect(ParentsGuard.ok(g, refusedType)).toBe(false);
        expect(notes.some(n => /Grounded/.test(n.t))).toBe(true);
    });

    it('no parents\' rule over a grown player: every door opens without a word', () => {
        const g = newGame(75);
        Utils.setSeed(75);
        const notes = [];
        g.ui = { showNotification: (t) => notes.push(t) };
        expect(ParentsGuard.ok(g, 'gambling')).toBe(true);
        expect(ParentsGuard.ok(g, 'theft', null, { each: true })).toBe(true);
        expect(notes.length).toBe(0);
    });
});

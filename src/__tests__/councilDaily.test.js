// The council lives between sessions: factions drift with your policies,
// approval follows them, and a council in revolt removes you from office.

import { describe, it, expect } from 'vitest';
import { Councils } from '../systems/councils.js';

const world = (day = 1) => ({ day, getKingdom: () => ({ wars: [] }), getTile: () => null });

function official(over = {}) {
    const p = { allegiance: 'k1', kingdomTitle: 'chancellor', reputation: { k1: 0 }, taxRate: 'moderate', karma: 0, renown: 0, army: [], settlements: [], ...over };
    Councils.initializePlayer(p);
    return p;
}

describe('Councils.processDaily', () => {
    it('does nothing for someone without council office', () => {
        const p = { allegiance: 'k1', kingdomTitle: 'citizen' };
        expect(Councils.processDaily(p, world())).toEqual({ removed: false, warning: null });
        expect(p.council).toBeUndefined();
    });

    it('crushing taxes turn merchants and commons against you and drag approval down', () => {
        const p = official({ taxRate: 'very_high' });
        const before = p.council.factions.merchants.support;
        for (let d = 1; d <= 60; d++) Councils.processDaily(p, world(d));
        expect(p.council.factions.merchants.support).toBeLessThan(before);
        expect(p.council.factions.commons.support).toBeLessThan(before);
        expect(p.council.approval).toBeLessThan(55);
    });

    it('light taxes, trade and a clean conscience win the council over and please your liege', () => {
        const p = official({ taxRate: 'very_low', tradeRoutes: [1, 2, 3, 4], karma: 300, renown: 500, army: new Array(30).fill({}) });
        for (let d = 1; d <= 150; d++) Councils.processDaily(p, world(d));
        expect(p.council.approval).toBeGreaterThan(60);
        expect(p.reputation.k1).toBeGreaterThanOrEqual(0);
    });

    it('a council in revolt warns, then removes you from office', () => {
        const p = official({ currentTitle: null });
        p.council.approval = 5;
        for (const f of Object.values(p.council.factions)) f.support = 0;
        p.taxRate = 'very_high';
        const first = Councils.processDaily(p, world(1));
        expect(first.warning).toMatch(/uproar/);
        let removed = false;
        for (let d = 2; d <= Councils.NO_CONFIDENCE_DAYS; d++) removed = Councils.processDaily(p, world(d)).removed || removed;
        expect(removed).toBe(true);
    });
});

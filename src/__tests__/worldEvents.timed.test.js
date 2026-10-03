// Timed world events from data/worldEvents.json: they start, last their
// duration, expire, and while running modify production/trade/prices in
// their region (or realm-wide).

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { WorldEvents } from '../world/worldEvents.js';
import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(99));

function makeWorld() {
    const settlement = { name: 'Ashby', kingdom: 'k1', population: 1000, q: 2, r: 2 };
    return {
        day: 1,
        activeEvents: [],
        getAllSettlements: () => [settlement],
        getKingdom: (id) => (id === 'k1' ? { id: 'k1', name: 'Valemark' } : null),
        settlement,
    };
}

describe('Timed world events', () => {
    it('loads every event template from data', () => {
        expect(Object.keys(WorldEvents.TEMPLATES).length).toBe(23);
    });

    it('starts an event, which then expires after its duration', () => {
        const world = makeWorld();
        const chance = WorldEvents.DAILY_EVENT_CHANCE;
        WorldEvents.DAILY_EVENT_CHANCE = 1;
        try {
            const { started } = WorldEvents.processTimedEvents(world);
            expect(started).toHaveLength(1);
            const ev = started[0];
            expect(ev.daysLeft).toBeGreaterThan(0);
            expect(ev.text).not.toMatch(/\{(settlement|region|kingdom)\}/);
            WorldEvents.DAILY_EVENT_CHANCE = 0;
            let ended = [];
            for (let d = 0; d < 100 && ended.length === 0; d++) ended = WorldEvents.processTimedEvents(world).ended;
            expect(ended.map(e => e.id)).toEqual([ev.id]);
            expect(world.activeEvents).toHaveLength(0);
        } finally {
            WorldEvents.DAILY_EVENT_CHANCE = chance;
        }
    });

    it('a regional drought cuts farm output only inside its kingdom', () => {
        const world = makeWorld();
        const drought = WorldEvents._startTimedEvent(world, WorldEvents.TEMPLATES.DROUGHT);
        expect(drought.kingdomId).toBe('k1');
        expect(WorldEvents.getModifier(world, 'farmProduction', { kingdom: 'k1' })).toBe(-0.4);
        expect(WorldEvents.getModifier(world, 'farmProduction', { kingdom: 'k2' })).toBe(0);
    });

    it('a plague strikes its settlement\'s population when it begins', () => {
        const world = makeWorld();
        WorldEvents._startTimedEvent(world, WorldEvents.TEMPLATES.PLAGUE);
        expect(world.settlement.population).toBe(850);
    });
});

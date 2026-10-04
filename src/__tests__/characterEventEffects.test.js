/**
 * Court and realm events in the event log do what they say: every
 * characters.json event either has a hand-written case in
 * Characters._applyEventEffects or a data `effects` block.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Characters } from '../world/characters.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

/** Events with bespoke code in _applyEventEffects / _triggerCharacterEvent. */
const CODED = new Set(['heir_born', 'ruler_ill', 'ruler_recovers', 'assassination_attempt', 'trait_gained',
    'advisor_scandal', 'succession_crisis', 'feast', 'tournament', 'advisor_betrayal']);

function makeRealm() {
    const tiles = {};
    const territory = [];
    for (let i = 0; i < 3; i++) {
        tiles[`${i},0`] = { q: i, r: 0, settlement: { name: `S${i}`, kingdom: 'a', population: 1000 } };
        territory.push({ q: i, r: 0 });
    }
    const a = { id: 'a', isAlive: true, treasury: 1000, military: 500, stability: 60, territory, relations: { b: 0 } };
    const b = { id: 'b', isAlive: true, treasury: 1000, military: 500, stability: 60, territory: [], relations: { a: 0 } };
    const world = { kingdoms: [a, b], getTile: (q, r) => tiles[`${q},${r}`] || null };
    return { a, b, world, tiles };
}

describe('character event effects', () => {
    it('every event has a mechanical effect', () => {
        const hollow = Characters.CHARACTER_EVENTS
            .filter(e => !CODED.has(e.id) && !(e.effects && Object.keys(e.effects).length))
            .map(e => e.id);
        expect(hollow).toEqual([]);
    });

    it('a trade boom fills the treasury', () => {
        const { a, world } = makeRealm();
        const ev = Characters.CHARACTER_EVENTS.find(e => e.id === 'trade_boom');
        Characters.applyEventDataEffects(ev.effects, a, world);
        expect(a.treasury).toBe(1100);
    });

    it('a plague thins every settlement and shakes stability', () => {
        const { a, world, tiles } = makeRealm();
        const ev = Characters.CHARACTER_EVENTS.find(e => e.id === 'plague_outbreak');
        const out = Characters.applyEventDataEffects(ev.effects, a, world);
        expect(tiles['0,0'].settlement.population).toBe(970);
        expect(out.population).toBe(-90);
        expect(a.stability).toBeLessThan(60);
    });

    it('a flood damages settlements until repaired', () => {
        const { a, world, tiles } = makeRealm();
        const ev = Characters.CHARACTER_EVENTS.find(e => e.id === 'natural_disaster');
        Characters.applyEventDataEffects(ev.effects, a, world);
        expect(tiles['1,0'].settlement.damage).toBeCloseTo(0.15);
    });

    it('a diplomatic insult sours relations both ways', () => {
        const { a, b, world } = makeRealm();
        Utils.setSeed(1);
        const ev = Characters.CHARACTER_EVENTS.find(e => e.id === 'diplomatic_insult');
        Characters.applyEventDataEffects(ev.effects, a, world);
        expect(a.relations.b).toBe(-15);
        expect(b.relations.a).toBe(-15);
    });

    it('a marriage proposal warms relations with the named realm', () => {
        const { a, b, world } = makeRealm();
        const ev = Characters.CHARACTER_EVENTS.find(e => e.id === 'marriage_proposal');
        Characters.applyEventDataEffects(ev.effects, a, world, b);
        expect(a.relations.b).toBe(8);
    });

    it('stability stays within 0-100', () => {
        const { a, world } = makeRealm();
        a.stability = 2;
        Characters.applyEventDataEffects({ stability: -6 }, a, world);
        expect(a.stability).toBe(0);
    });
});

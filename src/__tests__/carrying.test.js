// Carrying someone senseless over the shoulder, and the blood a body leaves
// (systems/carrying.js; the street's eyes: systems/streetCrime.js foundReaction).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Carrying } from '../systems/carrying.js';
import { StreetCrime } from '../systems/streetCrime.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});
beforeEach(() => Utils.setSeed(7));

let nextId = 1;
const npc = (extra = {}) => ({ id: nextId++, type: 'villager', name: 'Bram', personalityTraits: [], state: 'unconscious', q: 5, r: 5, ...extra });

describe('Picking someone up', () => {
    it('only the senseless, not one already carried, and only with free hands', () => {
        expect(Carrying.canPickUp(npc()).ok).toBe(true);
        expect(Carrying.canPickUp(npc({ state: 'idle' })).reason).toBe('awake');
        expect(Carrying.canPickUp(npc({ _carried: true })).ok).toBe(false);
        expect(Carrying.canPickUp(npc(), { handsFull: true }).reason).toBe('hands full');
        expect(Carrying.canPickUp(npc(), { playerOut: true }).ok).toBe(false);
        expect(Carrying.canPickUp(null).ok).toBe(false);
    });

    it('slows the walk: the strong less, a child less still, never past the cap', () => {
        const C = Carrying.config().speed;
        const weak = Carrying.speedFactor({ strength: 5 }, npc());
        const strong = Carrying.speedFactor({ strength: 9 }, npc());
        const child = Carrying.speedFactor({ strength: 5 }, npc({ type: 'child' }));
        expect(weak).toBeCloseTo(C.base, 5);
        expect(strong).toBeGreaterThan(weak);
        expect(child).toBeGreaterThan(weak);
        expect(Carrying.speedFactor({ strength: 40 }, npc())).toBeLessThanOrEqual(C.max);
        expect(weak).toBeLessThan(1);
    });

    it('blocks what needs free hands, not walking, talking or the door', () => {
        for (const a of ['attack_npc', 'harvest_object', 'dig_hole', 'pickup_ground_item', 'ko_rob', 'carry_body']) expect(Carrying.handsBlocked(a)).toBe(true);
        for (const a of ['move_here', 'talk_npc', 'enter_building', 'exit_building', 'carry_put_down', 'carry_lay_bed', 'drop_body', 'bury_body']) expect(Carrying.handsBlocked(a)).toBe(false);
    });
});

describe('Putting them down', () => {
    it('on a free tile beside the player: the one clicked if it is free and beside them, else the first free around', () => {
        const free = (q, r) => !(q === 5 && r === 6);   // (the tile below is taken)
        expect(Carrying.dropSpot(5, 5, free)).toEqual({ q: 6, r: 5 });
        expect(Carrying.dropSpot(5, 5, free, { q: 4, r: 4 })).toEqual({ q: 4, r: 4 });
        // (a tile two away is no drop spot)
        expect(Carrying.dropSpot(5, 5, free, { q: 8, r: 5 })).toEqual({ q: 6, r: 5 });
        expect(Carrying.dropSpot(5, 5, () => false)).toBeNull();
    });

    it('on a bed: one beside the player that no one lies in', () => {
        const beds = { '6,5': { type: 'bed' }, '4,5': { type: 'bed' }, '5,4': { type: 'table' } };
        const at = (q, r) => beds[`${q},${r}`] || null;
        expect(Carrying.bedSpot(5, 5, at, () => false)).toEqual({ q: 6, r: 5 });
        expect(Carrying.bedSpot(5, 5, at, (q, r) => q === 6 && r === 5)).toEqual({ q: 4, r: 5 });
        expect(Carrying.bedSpot(5, 5, at, () => false, { q: 4, r: 5 })).toEqual({ q: 4, r: 5 });
        expect(Carrying.bedSpot(5, 5, at, () => true)).toBeNull();
        expect(Carrying.bedSpot(9, 9, at, () => false)).toBeNull();
    });
});

describe('Coming round on the shoulder', () => {
    it('the bold kick free in anger, the rest in fear, the same way every time', () => {
        const bold = npc({ personalityTraits: ['bold'] });
        const meek = npc({ personalityTraits: ['quiet'] });
        expect(Carrying.struggle(bold, 'd1').mood).toBe('anger');
        expect(Carrying.struggle(meek, 'd1').mood).toBe('fear');
        expect(Carrying.struggle(npc({ type: 'child', personalityTraits: ['bold'] })).mood).toBe('fear');
        const a = Carrying.struggle(meek, 'd1'), b = Carrying.struggle(meek, 'd1');
        expect(a.bark).toBeTruthy();
        expect(a).toEqual(b);
        // (no draw on the shared stream)
        Utils.setSeed(3); const x = Utils.random();
        Utils.setSeed(3); Carrying.struggle(meek, 'd2'); expect(Utils.random()).toBe(x);
    });
});

describe('Blood', () => {
    it('the pool is laid where they fell and stays there when the body is moved', () => {
        const body = { name: 'Bram', q: 3, r: 4, key: 'k', _npc: { id: 1 } };
        const pool = Carrying.bloodPool(body, 1000, 12);
        body.q = 9; body.r = 9;   // carried off
        expect(pool).toMatchObject({ q: 3, r: 4, key: 'k', day: 12, name: 'Bram', drip: false });
        expect(pool.victim).toBe(body._npc);
        expect(Carrying.bloodKept(pool, 12 + Carrying.config().blood.keepDays)).toBe(true);
        expect(Carrying.bloodKept(pool, 13 + Carrying.config().blood.keepDays)).toBe(false);
    });

    it('a fresh body drips every few steps; an old one does not', () => {
        const B = Carrying.config().blood;
        const body = { at: 0 };
        let drops = 0;
        for (let i = 0; i < 10; i++) if (Carrying.drips(body, 1000)) drops++;
        expect(drops).toBe(Math.floor(10 / B.dripEvery));
        expect(Carrying.drips({ at: 0 }, (B.dripSeconds + 1) * 1000)).toBe(false);
    });
});

describe('Seen carrying', () => {
    const victim = { id: 99, name: 'Bram', type: 'villager' };
    it('the watch who sees someone carried off senseless arrests, and says so in the carrying words', () => {
        const guard = { id: 5, type: 'guard', name: 'Watchman', personalityTraits: [] };
        const r = StreetCrime.foundReaction(guard, { name: 'Bram', _npc: victim }, { carried: true, alive: true, seed: 's' });
        expect(r.act).toBe('arrest');
        expect(r.implicates).toBe(true);
        const pool = StreetCrime.config().found.barks.carriedAlive.guard.map(l => l.replace('{victim}', 'Bram'));
        expect(pool).toContain(r.bark);
    });

    it('the ruler\'s own watch looks away', () => {
        const guard = { id: 6, type: 'guard', name: 'Watchman', personalityTraits: [] };
        const r = StreetCrime.foundReaction(guard, { name: 'Bram', _npc: victim }, { carried: true, alive: true, royal: true, seed: 's' });
        expect(r.act).toBe('stare');
    });

    it('blood with no body: the watch looks into it, folk stare or back away; standing in it implicates', () => {
        const guard = { id: 7, type: 'guard', name: 'Watchman', personalityTraits: [] };
        const folk = { id: 8, type: 'villager', name: 'Ada', personalityTraits: ['cautious'] };
        const g = StreetCrime.foundReaction(guard, { name: 'Bram', _npc: victim, _blood: true }, { blood: true, seed: 's' });
        expect(g.act).toBe('investigate');
        expect(g.implicates).toBe(false);
        expect(StreetCrime.config().found.barks.blood.guard).toContain(g.bark);
        expect(['flee', 'cower']).toContain(StreetCrime.foundReaction(folk, { name: 'Bram', _blood: true }, { blood: true, seed: 's' }).act);
        expect(StreetCrime.foundReaction(guard, { name: 'Bram', _blood: true }, { blood: true, playerOver: true, seed: 's' }).act).toBe('arrest');
    });
});

// Someone downed — unconscious, bleeding out, bound, dead — and buried alive (systems/downed.js).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Downed } from '../systems/downed.js';
import { Carrying } from '../systems/carrying.js';
import { Burials } from '../world/burials.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});
beforeEach(() => Utils.setSeed(21));

let nextId = 1;
const npc = (extra = {}) => ({ id: nextId++, type: 'villager', name: 'Bram', personalityTraits: [], state: 'idle', q: 4, r: 4, ...extra });

describe('The state of someone downed', () => {
    it('names each state as shown on hover and inspect', () => {
        const S = Downed.config().states;
        expect(Downed.stateOf(npc())).toBeNull();
        expect(Downed.label(npc({ state: 'unconscious' }))).toBe(S.unconscious);
        expect(Downed.label(npc({ state: 'unconscious', _bleed: { until: 9 } }))).toBe(S.bleeding);
        expect(Downed.label(npc({ dead: true }))).toBe(S.dead);
        expect(Downed.stateOf(npc({ state: 'bound', _bound: true }))).toBe('bound');
        // (senseless and tied: both said)
        expect(Downed.label(npc({ state: 'unconscious', _bound: true, _gagged: true }))).toBe(`${S.unconscious}, ${S.bound}, Gagged`);
    });

    it('is down when senseless, bleeding or bound awake — not when standing or dead', () => {
        expect(Downed.isDown(npc({ state: 'unconscious' }))).toBe(true);
        expect(Downed.isDown(npc({ state: 'unconscious', _bleed: {} }))).toBe(true);
        expect(Downed.isDown(npc({ state: 'bound', _bound: true }))).toBe(true);
        expect(Downed.isDown(npc())).toBe(false);
        expect(Downed.isDown(npc({ dead: true }))).toBe(false);
    });

    it('a hard blow is likelier to leave them bleeding out, on the seeded stream, and it runs out', () => {
        let soft = 0, hard = 0;
        Utils.setSeed(5);
        for (let i = 0; i < 400; i++) if (Downed.rollBleed(0, 0)) soft++;
        Utils.setSeed(5);
        for (let i = 0; i < 400; i++) if (Downed.rollBleed(0, 1)) hard++;
        expect(hard).toBeGreaterThan(soft);
        expect(soft).toBeGreaterThan(0);
        Utils.setSeed(9); const a = Downed.rollBleed(1000, 1);
        Utils.setSeed(9); const b = Downed.rollBleed(1000, 1);
        expect(a).toEqual(b);
        const [lo, hi] = Downed.config().bleed.bleedSeconds;
        const bleeding = npc({ state: 'unconscious', _bleed: { until: 1000 + lo * 1000 } });
        expect(Downed.bledOut(bleeding, 1000 + lo * 1000 - 1)).toBe(false);
        expect(Downed.bledOut(bleeding, 1000 + hi * 1000)).toBe(true);
        expect(Downed.bledOut(npc({ state: 'unconscious' }), 1e12)).toBe(false);
    });

    it('rope, cloth, a poultice and drink come from the pack (the first carried of each list)', () => {
        expect(Downed.bindItem({ rope: 2 })).toBe('rope');
        expect(Downed.bindItem({})).toBeNull();
        expect(Downed.tendItem({ linen: 1, poultice: 1 })).toBe('poultice');
        expect(Downed.gagItem({ clothes: 1 })).toBe('clothes');
        expect(Downed.douseItem({ wine: 0 })).toBeNull();
    });

    it('a slap or a douse brings them round sooner, never later', () => {
        const R = Downed.config().rouse;
        expect(Downed.rouse({ until: 100000 }, 'slap', 0)).toBe(R.slapSeconds * 1000);
        expect(Downed.rouse({ until: 100000 }, 'douse', 0)).toBe(R.douseSeconds * 1000);
        expect(Downed.rouse({ until: 500 }, 'slap', 0)).toBe(500);
    });

    it('the bound plead or threaten (the bold threaten), call for help — and only mumble when gagged', () => {
        const seen = new Set();
        for (let i = 0; i < 40; i++) seen.add(Downed.boundLine(npc({ _bound: true, personalityTraits: ['bold'] }), `s${i}`).kind);
        expect(seen.has('threaten')).toBe(true);
        expect(seen.has('call')).toBe(true);
        expect(seen.has('plead')).toBe(false);
        const g = Downed.boundLine(npc({ _bound: true, _gagged: true }), 's1');
        expect(g.kind).toBe('gagged');
        expect(g.heard).toBe(false);
        expect(Downed.config().lines.gagged).toContain(g.line);
    });

    it('a bound man awake can still be carried off; one on his feet cannot', () => {
        expect(Carrying.canPickUp(npc({ state: 'bound', _bound: true })).ok).toBe(true);
        expect(Carrying.canPickUp(npc()).ok).toBe(false);
        expect(Downed.dragSpeed()).toBeLessThan(Carrying.speedFactor({ strength: 5 }, npc()));
    });
});

describe('Buried alive', () => {
    const A = () => Downed.config().buryAlive;

    it('cries out longer when awake (bound awake) than senseless; waking under the earth stretches it', () => {
        const asleep = Downed.liveBurial(npc({ state: 'unconscious' }), 0);
        const awake = Downed.liveBurial(npc({ state: 'bound', _bound: true }), 0);
        expect(asleep.until).toBe(A().windowSeconds * 1000);
        expect(awake.until).toBe(A().awakeWindowSeconds * 1000);
        expect(awake.awake).toBe(true);
        Downed.wakeUnderEarth(asleep, 10000);
        expect(asleep.awake).toBe(true);
        expect(asleep.until).toBeGreaterThan(A().windowSeconds * 1000);
    });

    it('cries come at intervals, further apart as the air runs out, then silence', () => {
        const lb = Downed.liveBurial(npc({ state: 'bound', _bound: true }), 0);
        const times = [];
        for (let t = 0; t < lb.until + 5000; t += 250) if (Downed.cry(lb, t, 'x')) times.push(t);
        expect(times.length).toBeGreaterThan(3);
        const gaps = times.slice(1).map((t, i) => t - times[i]);
        expect(gaps[gaps.length - 1]).toBeGreaterThanOrEqual(gaps[0]);
        expect(times[times.length - 1]).toBeLessThan(lb.until);
        expect(Downed.stillAlive(lb, lb.until)).toBe(false);
        expect(Downed.stir(lb, 0)).toBeGreaterThan(Downed.stir(lb, lb.until - 1000));
        expect(Downed.stir(lb, lb.until)).toBe(0);
    });

    it('the grave keeps that they were buried living; it settles once as died (the true cause) or rescued', () => {
        const world = { day: 30 };
        const g = Burials.bury(world, '3,4', 5, 6, { name: 'Bram', type: 'villager', day: 30 }, 30);
        g.buriedAlive = true;
        expect(Downed.unresolved(g)).toBe(true);
        Downed.settleBurial(g, 'died', 31);
        expect(g.aliveOutcome).toBe('died');
        expect(g.cause).toBe(A().cause);
        expect(g.died).toBe(31);
        Downed.settleBurial(g, 'rescued', 32);   // (settled once)
        expect(g.aliveOutcome).toBe('died');
        expect(Downed.unresolved(g)).toBe(false);
        // A rescue leaves no death
        const h = { buriedAlive: true, day: 30, died: 30 };
        Downed.settleBurial(h, 'rescued', 31);
        expect(h.aliveOutcome).toBe('rescued');
        expect(h.cause).toBeUndefined();
        // The record keeps (and saves) the mark of it
        expect(JSON.parse(JSON.stringify(world.burials))['3,4']['5,6'].buriedAlive).toBe(true);
    });

    it('a passer-by digs on the seeded stream; so does someone after the player has gone', () => {
        Utils.setSeed(4);
        const a = Array.from({ length: 50 }, () => Downed.rescueRoll());
        Utils.setSeed(4);
        const b = Array.from({ length: 50 }, () => Downed.rescueRoll());
        expect(a).toEqual(b);
        expect(a.some(Boolean)).toBe(true);
        expect(a.every(Boolean)).toBe(false);
        expect(Downed.offMapRescue(null)).toBe(false);
    });
});

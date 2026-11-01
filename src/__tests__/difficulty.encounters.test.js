/**
 * The difficulty's enemyStrength knob on the road (player/roadEncounters.js)
 * and in the wilds' fights (player/wilds.js): Easy and Hard move the odds and
 * the harm; Normal is bit-identical to a game with no difficulty at all.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Difficulty } from '../core/difficulty.js';
import { WorldUnit } from '../world/units.js';
import { RoadEncounters } from '../player/roadEncounters.js';
import { Wilds } from '../player/wilds.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    Wilds._loaded = false;
    Wilds._ensureLoaded();
});

function makeWorld(terrain = 'plains') {
    const tiles = new Map();
    const getTile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) tiles.set(key, { q, r, terrain: { id: terrain, passable: true }, settlement: null });
        return tiles.get(key);
    };
    return { width: 60, height: 60, day: 10, events: [], units: [], kingdoms: [], getTile, getKingdom: () => null };
}

function makePlayer(difficulty, overrides = {}) {
    const p = {
        name: 'Ash', q: 0, r: 0, gold: 1000, karma: 0, renown: 0, health: 100, maxHealth: 100,
        strength: 5, charisma: 5, intelligence: 5, luck: 5, faith: 5,
        inventory: { bread: 10, firewood: 2 }, properties: [], reputation: {}, blessings: {},
        skills: { combat: 2, commerce: 1, leadership: 1, diplomacy: 2, stealth: 2 },
        army: [], colonies: [],
        ...overrides,
    };
    if (difficulty) p.scenario = { ...Difficulty.blank(), difficulty };
    return p;
}

function makeUnit(type, strength, world) {
    const u = new WorldUnit(type, 1, 0);
    u.strength = strength;
    u.inventory = u.inventory || {};
    world.units.push(u);
    return u;
}

const LEVELS = [null, 'easy', 'normal', 'hard'];

describe('Difficulty helpers', () => {
    it('againstFoe and foeHarm are exact on Normal and with no record', () => {
        for (const p of [0.05, 0.1234567, 0.5, 0.95]) {
            expect(Difficulty.againstFoe(makePlayer('normal'), p)).toBe(p);
            expect(Difficulty.againstFoe(makePlayer(null), p)).toBe(p);
            expect(Difficulty.againstFoe(makePlayer('easy'), p)).toBeGreaterThan(p);
            expect(Difficulty.againstFoe(makePlayer('hard'), p)).toBeLessThan(p);
        }
        expect(Difficulty.foeHarm(makePlayer('normal'), 7)).toBe(7);
        expect(Difficulty.foeHarm(makePlayer('hard'), 10)).toBe(12);
        expect(Difficulty.foeHarm(makePlayer('easy'), 10)).toBe(8);
    });
});

describe('road encounters and the enemyStrength knob', () => {
    it('every shown chance (and the toll) is identical on Normal; Easy is kinder and Hard harsher', () => {
        for (const type of ['raider', 'beast']) {
            const world = makeWorld();
            const unit = makeUnit(type, 14, world);
            const opts = {};
            for (const lvl of LEVELS) opts[lvl] = RoadEncounters.options(makePlayer(lvl), unit, world);
            expect(opts.normal).toEqual(opts[null]);
            for (let i = 0; i < opts.normal.length; i++) {
                const n = opts.normal[i];
                if (n.chance === null) continue;
                expect(opts.easy[i].chance).toBeGreaterThanOrEqual(n.chance);
                expect(opts.hard[i].chance).toBeLessThanOrEqual(n.chance);
            }
            const duel = (lvl) => opts[lvl].find(o => o.id === 'fight').chance;
            expect(duel('easy')).toBeGreaterThan(duel('normal'));
            expect(duel('hard')).toBeLessThan(duel('normal'));
            if (type === 'raider') {
                const toll = (lvl) => opts[lvl].find(o => o.id === 'toll').amount;
                expect(toll('hard')).toBeGreaterThan(toll('normal'));
                expect(toll('easy')).toBeLessThan(toll('normal'));
            }
        }
    });

    it('the old headless ambush is bit-identical on Normal; Hard robs and hurts more', () => {
        const run = (lvl, type) => {
            Utils.setSeed(4242);
            const world = makeWorld();
            const unit = makeUnit(type, 14, world);
            const p = makePlayer(lvl);
            const out = RoadEncounters.ambush(p, unit, world);
            return { gold: p.gold, health: p.health, inv: { ...p.inventory }, kind: out.kind, next: Utils.random() };
        };
        for (const type of ['raider', 'beast', 'monster']) {
            expect(run('normal', type)).toEqual(run(null, type));
            expect(run('hard', type).health).toBeLessThanOrEqual(run('normal', type).health);
            expect(run('easy', type).health).toBeGreaterThanOrEqual(run('normal', type).health);
        }
        expect(run('hard', 'raider').gold).toBeLessThan(run('normal', 'raider').gold);
        expect(run('easy', 'raider').gold).toBeGreaterThan(run('normal', 'raider').gold);
        expect(run('hard', 'beast').health).toBeLessThan(run('easy', 'beast').health);
    });

    it('over many fights alone, Hard loses more often than Easy; Normal resolves exactly as without a record', () => {
        const tally = (lvl) => {
            Utils.setSeed(99);
            let wins = 0;
            const trace = [];
            for (let i = 0; i < 200; i++) {
                const world = makeWorld();
                const unit = makeUnit('raider', 14, world);
                const p = makePlayer(lvl);
                const out = RoadEncounters.resolve(p, unit, world, 'fight');
                if (out.success) wins++;
                trace.push(out.kind, p.health, p.gold);
            }
            return { wins, trace };
        };
        const none = tally(null);
        const normal = tally('normal');
        expect(normal).toEqual(none);
        expect(tally('easy').wins).toBeGreaterThan(tally('hard').wins);
    });
});

describe('wilds fights and the enemyStrength knob', () => {
    const choice = (enc, id) => Wilds.def(enc).choices.find(c => c.id === id);

    it('only fights are re-weighed; Normal is exact', () => {
        expect(Wilds.isFight(choice('bear', 'fight'))).toBe(true);
        expect(Wilds.isFight(choice('ice_elemental', 'fight'))).toBe(true);
        expect(Wilds.isFight(choice('herb_patch', 'search'))).toBe(false);
        expect(Wilds.isFight(choice('bear', 'back_off'))).toBe(false);
        const fight = choice('bear', 'fight');
        const search = choice('herb_patch', 'search');
        const c = (lvl, ch) => Wilds.chance(makePlayer(lvl), ch);
        expect(c('normal', fight)).toBe(c(null, fight));
        expect(c('easy', fight)).toBeGreaterThan(c('normal', fight));
        expect(c('hard', fight)).toBeLessThan(c('normal', fight));
        expect(c('hard', search)).toBe(c('normal', search));
        expect(c('easy', search)).toBe(c('normal', search));
    });

    it('a lost fight hurts more on Hard; Normal resolves exactly as without a record', () => {
        const run = (lvl) => {
            Utils.setSeed(7);
            const p = makePlayer(lvl, { health: 100, movementRemaining: 10, stamina: 10 });
            // Make it a sure loss so the harm is compared like for like
            const enc = Wilds.def('bear');
            const fight = enc.choices.find(c => c.id === 'fight');
            const saved = fight.check.base;
            fight.check.base = -5;
            try {
                Wilds.resolve(p, makeWorld(), { id: 'bear', wq: 1, wr: 1, slot: 0 }, 'fight');
            } finally {
                fight.check.base = saved;
            }
            return { health: p.health, next: Utils.random() };
        };
        expect(run('normal')).toEqual(run(null));
        expect(run('hard').health).toBeLessThan(run('normal').health);
        expect(run('easy').health).toBeGreaterThan(run('normal').health);
    });
});

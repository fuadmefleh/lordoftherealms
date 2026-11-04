/**
 * Road encounters (player/roadEncounters.js) and phased field battles
 * (player/fieldBattle.js): the choices and their shown odds, the outcomes'
 * consequences, the phases, stances and withdrawal, and that the old
 * automatic resolution is unchanged for the headless paths.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { WorldUnit } from '../world/units.js';
import { RoadEncounters } from '../player/roadEncounters.js';
import { FieldBattle } from '../player/fieldBattle.js';
import { resolveHostileEncounter } from '../ui/game/combat.logic.js';
import { Ledger } from '../systems/ledger.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
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

function makePlayer(overrides = {}) {
    return {
        name: 'Ash', q: 0, r: 0, gold: 1000, karma: 0, renown: 0, health: 100, maxHealth: 100,
        strength: 5, charisma: 5,
        inventory: { bread: 10 }, properties: [], reputation: {}, blessings: {},
        skills: { combat: 1, commerce: 1, leadership: 1, diplomacy: 1, stealth: 1 },
        army: [], colonies: [],
        ...overrides,
    };
}

function army(n, type = 'pikeman', strength = 10) {
    return Array.from({ length: n }, (_, i) => ({ type, name: `${type}${i}`, strength, level: 1, upkeep: 1, experience: 0 }));
}

function makeUnit(type, strength, world) {
    const u = new WorldUnit(type, 1, 0);
    u.strength = strength;
    u.inventory = u.inventory || {};
    world.units.push(u);
    return u;
}

describe('road encounter choices', () => {
    it('bandits offer flee / toll / parley / hide / fight with odds; beasts offer bait and fire instead', () => {
        const world = makeWorld();
        const player = makePlayer();
        const ids = RoadEncounters.options(player, makeUnit('raider', 12, world), world).map(o => o.id);
        expect(ids).toEqual(['flee', 'toll', 'parley', 'hide', 'fight']);
        const beastIds = RoadEncounters.options(player, makeUnit('beast', 12, world), world).map(o => o.id);
        expect(beastIds).toEqual(['flee', 'bait', 'fire', 'hide', 'fight']);
        for (const o of RoadEncounters.options(player, makeUnit('raider', 12, world), world)) {
            if (o.chance !== null) {
                expect(o.chance).toBeGreaterThanOrEqual(0.05);
                expect(o.chance).toBeLessThanOrEqual(0.95);
                expect(typeof o.odds).toBe('string');
            }
        }
    });

    it('odds respond to skill, horse, ground and traits', () => {
        const world = makeWorld('plains');
        const forest = makeWorld('seasonal_forest');
        const raider = makeUnit('raider', 12, world);
        const sit = (p, w) => RoadEncounters.situation(p, raider, w);
        const novice = makePlayer();
        const rider = makePlayer({ mount: { name: 'Bramble' }, skills: { ...novice.skills, stealth: 6 } });
        expect(RoadEncounters.fleeChance(rider, raider, sit(rider, world))).toBeGreaterThan(RoadEncounters.fleeChance(novice, raider, sit(novice, world)));
        expect(RoadEncounters.hideChance(novice, raider, sit(novice, forest))).toBeGreaterThan(RoadEncounters.hideChance(novice, raider, sit(novice, world)));
        const dread = makePlayer({ traits: { earned: { dread_lord: true }, progress: {} } });
        expect(RoadEncounters.parleyChance(dread, raider, sit(dread, world))).toBeGreaterThan(RoadEncounters.parleyChance(novice, raider, sit(novice, world)));
        // Hiding at sea is impossible
        const sea = makeWorld('ocean');
        const hide = RoadEncounters.options(novice, raider, sea).find(o => o.id === 'hide');
        expect(hide.can).toBe(false);
    });

    it('options draw no randomness from the game stream', () => {
        const world = makeWorld();
        const player = makePlayer({ army: army(6) });
        const raider = makeUnit('raider', 30, world);
        Utils.setSeed(5);
        const before = Utils.random();
        Utils.setSeed(5);
        RoadEncounters.options(player, raider, world);
        expect(Utils.random()).toBe(before);
    });
});

describe('road encounter outcomes', () => {
    it('paying the toll moves gold into the band\'s coffers, onto the Ledger, and buys a respite', () => {
        const world = makeWorld();
        const player = makePlayer({ gold: 400 });
        const raider = makeUnit('raider', 12, world);
        const coffers = raider.inventory.gold || 0;
        const out = RoadEncounters.resolve(player, raider, world, 'toll');
        expect(out.kind).toBe('paid');
        expect(out.goldPaid).toBeGreaterThan(0);
        expect(player.gold).toBe(400 - out.goldPaid);
        expect(raider.inventory.gold).toBe(coffers + out.goldPaid);
        expect(Ledger.today(player).expenses.banditTolls).toBe(out.goldPaid);
        expect(RoadEncounters.isSparing(raider, world.day)).toBe(true);
        expect(RoadEncounters.isSparing(raider, world.day + 30)).toBe(false);
    });

    it('a successful flight trains stealth; a failed one ends in the old robbery (on the Ledger)', () => {
        Utils.setSeed(11);
        const world = makeWorld();
        let escaped = 0, robbed = 0;
        for (let i = 0; i < 40; i++) {
            const player = makePlayer();
            const raider = makeUnit('raider', 12, world);
            const out = RoadEncounters.resolve(player, raider, world, 'flee');
            if (out.kind === 'escaped') {
                escaped++;
                expect(player.skills.stealth).toBeGreaterThan(1);
                expect(player.gold).toBe(1000);
            } else {
                robbed++;
                expect(out.kind).toBe('robbed');
                if (out.goldStolen > 0) expect(Ledger.today(player).expenses.robbery).toBe(out.goldStolen);
            }
        }
        expect(escaped).toBeGreaterThan(0);
        expect(robbed).toBeGreaterThan(0);
    });

    it('throwing food to beasts spends the food either way', () => {
        Utils.setSeed(3);
        const world = makeWorld();
        const player = makePlayer({ inventory: { bread: 10 } });
        const beast = makeUnit('beast', 15, world);
        RoadEncounters.resolve(player, beast, world, 'bait');
        expect(player.inventory.bread).toBe(10 - RoadEncounters.config().bait.food);
    });

    it('is deterministic under a seed', () => {
        const run = () => {
            Utils.setSeed(77);
            const world = makeWorld();
            const player = makePlayer();
            const raider = makeUnit('raider', 12, world);
            const out = RoadEncounters.resolve(player, raider, world, 'parley');
            return [out.kind, player.gold, player.health, player.skills.diplomacy];
        };
        expect(run()).toEqual(run());
    });

    it('standing alone: a win drives them off or cuts them down and earns renown', () => {
        Utils.setSeed(9);
        const world = makeWorld();
        let wins = 0;
        for (let i = 0; i < 30; i++) {
            const player = makePlayer({ skills: { combat: 10, stealth: 1, diplomacy: 1, leadership: 1, commerce: 1 }, strength: 15 });
            const raider = makeUnit('raider', 10, world);
            const out = RoadEncounters.resolve(player, raider, world, 'fight');
            if (out.kind === 'duel_won') {
                wins++;
                expect(player.renown).toBeGreaterThan(0);
                expect(raider.destroyed || raider.strength < 10).toBe(true);
            }
        }
        expect(wins).toBeGreaterThan(0);
    });

    it('with an army, fight returns a phased battle; auto fights it through', () => {
        Utils.setSeed(21);
        const world = makeWorld();
        const player = makePlayer({ army: army(12, 'pikeman', 10) });
        const raider = makeUnit('raider', 20, world);
        const out = RoadEncounters.resolve(player, raider, world, 'fight');
        expect(out.kind).toBe('battle');
        expect(out.battle.sim.phase).toBe(0);

        const player2 = makePlayer({ army: army(12, 'pikeman', 10) });
        const raider2 = makeUnit('raider', 20, world);
        const auto = RoadEncounters.resolve(player2, raider2, world, 'fight', { auto: true });
        expect(['victory', 'defeat']).toContain(auto.kind);
        expect(auto.result.phased).toBe(true);
        expect(auto.result.phases.length).toBeGreaterThan(0);
    });

    it('the headless resolution is the old one, draw for draw', () => {
        const run = (fn) => {
            Utils.setSeed(1234);
            const world = makeWorld();
            const player = makePlayer({ inventory: { bread: 10, iron: 4, quest: 1 } });
            const raider = makeUnit('raider', 12, world);
            const out = fn(player, raider, world);
            return [out.kind, out.goldStolen, out.healthLost, JSON.stringify(out.stolenItems), Utils.random()];
        };
        expect(run(resolveHostileEncounter)).toEqual(run((p, a, w) => RoadEncounters.ambush(p, a, w)));
    });

    it('a band that robbed you, or a beast that mauled you, leaves you be for a while', () => {
        // (a band camped by an unprotected village used to rob the player every
        // morning until they starved with no food left to buy)
        Utils.setSeed(77);
        const world = makeWorld();
        const player = makePlayer();
        const raider = makeUnit('raider', 12, world);
        expect(RoadEncounters.ambush(player, raider, world).kind).toBe('robbed');
        expect(RoadEncounters.isSparing(raider, world.day + 1)).toBe(true);
        expect(RoadEncounters.isSparing(raider, world.day + RoadEncounters.config().toll.respiteDays)).toBe(false);
        const wolf = makeUnit('beast', 8, world);
        RoadEncounters.ambush(player, wolf, world);
        expect(RoadEncounters.isSparing(wolf, world.day + 1)).toBe(true);
    });
});

describe('phased field battle', () => {
    const enemyOf = (strength, name = 'Raider Band') => ({ strength, name, composition: { cavalry: 0.65, archer: 0.1, pikeman: 0.25 } });

    it('fights three phases with real losses on both sides', () => {
        Utils.setSeed(42);
        const world = makeWorld();
        const player = makePlayer({ army: army(20, 'pikeman', 10) });
        const b = FieldBattle.start(player, enemyOf(150), world, { terrainId: 'plains' });
        expect(b.pStr0).toBeGreaterThan(0);
        let guard = 5;
        while (!b.done && guard--) FieldBattle.play(player, b, 'hold', world);
        expect(b.done).toBe(true);
        expect(b.log.length).toBeGreaterThanOrEqual(1);
        expect(b.log.length).toBeLessThanOrEqual(3);
        expect(b.result.phased).toBe(true);
        expect(b.result.casualties + b.result.wounded).toBe(20 - player.army.length);
        expect(b.result.enemyRemaining).toBeLessThan(150);
    });

    it('a lopsided battle is won with light losses; a hopeless one is lost', () => {
        Utils.setSeed(8);
        const world = makeWorld();
        const strong = makePlayer({ army: army(30, 'pikeman', 15) });
        const b1 = FieldBattle.start(strong, enemyOf(40), world, {});
        FieldBattle.auto(strong, b1, world);
        expect(b1.result.victory).toBe(true);
        expect(strong.army.length).toBeGreaterThanOrEqual(25);

        const weak = makePlayer({ army: army(4, 'militia', 5) });
        const b2 = FieldBattle.start(weak, enemyOf(400), world, {});
        FieldBattle.auto(weak, b2, world);
        expect(b2.result.victory).toBe(false);
    });

    it('stances matter: holding the line loses fewer men than attacking', () => {
        const world = makeWorld();
        const losses = (stance) => {
            let lost = 0;
            for (let s = 1; s <= 30; s++) {
                Utils.setSeed(s);
                const player = makePlayer({ army: army(20, 'pikeman', 10) });
                const b = FieldBattle.start(player, enemyOf(200), world, {});
                FieldBattle.play(player, b, stance, world);
                lost += 20 - player.army.length;
            }
            return lost;
        };
        expect(losses('hold')).toBeLessThan(losses('aggressive'));
    });

    it('feigned retreat needs horse or leadership; reserves only once', () => {
        Utils.setSeed(4);
        const world = makeWorld();
        const foot = makePlayer({ army: army(10, 'pikeman', 10) });
        const b = FieldBattle.start(foot, enemyOf(80), world, {});
        expect(FieldBattle.stanceAllowed(b, 'feint').can).toBe(false);
        const horse = makePlayer({ army: army(10, 'cavalry', 10) });
        const hb = FieldBattle.start(horse, enemyOf(80), world, {});
        expect(FieldBattle.stanceAllowed(hb, 'feint').can).toBe(true);
        FieldBattle.play(horse, hb, 'reserves', world);
        if (!hb.done) expect(FieldBattle.stanceAllowed(hb, 'reserves').can).toBe(false);
    });

    it('withdrawal is only between phases, costs a rear-guard and takes no loot', () => {
        Utils.setSeed(15);
        const world = makeWorld();
        const player = makePlayer({ army: army(20, 'pikeman', 10), gold: 100 });
        const b = FieldBattle.start(player, enemyOf(220), world, {});
        expect(FieldBattle.canWithdraw(b)).toBe(false);
        expect(FieldBattle.options(b).some(o => o.id === 'withdraw')).toBe(false);
        FieldBattle.play(player, b, 'hold', world);
        if (b.done) return; // a rout in the opening ends it before any choice
        expect(FieldBattle.options(b).find(o => o.id === 'withdraw').loss).toBeGreaterThan(0);
        FieldBattle.play(player, b, 'withdraw', world);
        expect(b.done).toBe(true);
        expect(b.result.withdrew).toBe(true);
        expect(b.result.victory).toBe(false);
        expect(b.result.loot).toBe(0);
        expect(b.result.captured).toBeUndefined();
        expect(player.gold).toBe(100);
    });

    it('estimates are shown without moving the game\'s dice, and track the odds', () => {
        const world = makeWorld();
        Utils.setSeed(99);
        const player = makePlayer({ army: army(20, 'pikeman', 10) });
        const even = FieldBattle.start(player, enemyOf(260), world, {});
        const marker = Utils.random();
        Utils.setSeed(99);
        const again = FieldBattle.start(makePlayer({ army: army(20, 'pikeman', 10) }), enemyOf(260), world, {});
        const est = FieldBattle.estimate(again, 'hold');
        expect(Utils.random()).toBe(marker);
        expect(est.win).toBeGreaterThanOrEqual(0);
        expect(est.win).toBeLessThanOrEqual(1);
        expect(FieldBattle.estimate(again, 'hold')).toEqual(est); // same question, same answer
        const easy = FieldBattle.start(makePlayer({ army: army(20, 'pikeman', 10) }), enemyOf(40), world, {});
        expect(FieldBattle.estimate(easy, 'hold').win).toBeGreaterThan(FieldBattle.estimate(even, 'hold').win);
    });

    it('against a world unit, the unit\'s fate follows the usual rules', () => {
        Utils.setSeed(31);
        const world = makeWorld();
        const player = makePlayer({ army: army(30, 'pikeman', 15) });
        const raider = makeUnit('raider', 30, world);
        const { enemy, ctx } = FieldBattle.unitEnemy(player, raider, world);
        const b = FieldBattle.start(player, enemy, world, ctx);
        const result = FieldBattle.auto(player, b, world);
        expect(result.victory).toBe(true);
        expect(raider.destroyed).toBe(true);
        expect(result.renownChange).toBeGreaterThan(0); // attackUnit's raider rewards
    });

    it('is deterministic under a seed', () => {
        const run = () => {
            Utils.setSeed(2024);
            const world = makeWorld();
            const player = makePlayer({ army: army(15, 'archer', 10) });
            const b = FieldBattle.start(player, enemyOf(150), world, { terrainId: 'hills' });
            FieldBattle.auto(player, b, world);
            return [b.result.victory, b.result.casualties, b.result.enemyRemaining, b.log.map(e => e.stance).join(',')];
        };
        expect(run()).toEqual(run());
    });
});

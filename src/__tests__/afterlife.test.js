// After death (player/afterlife.js): the world turns on without the player
// while the House waits in trust; an heir comes of age and returns; or the
// player becomes someone else in the world and the old House's holdings pass
// to crowns and towns.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { Afterlife } from '../player/afterlife.js';
import { Relationships } from '../systems/relationships.js';

beforeAll(async () => {
    await loadData();
});

/** A game the bot has played for `days` (rich enough to buy into the world). */
function played(seed, days) {
    const game = newGame(seed);
    game.player.gold += 30000;
    for (let d = 0; d < days; d++) {
        botDay(game, {});
        if (endDay(game).died) break;
    }
    return game;
}

/** Paths in the world still marked as the player's (owner/holder/payer). */
function playerMarks(world) {
    const hits = [];
    const seen = new WeakSet();
    const walk = (o, path, depth) => {
        if (!o || typeof o !== 'object' || seen.has(o) || depth > 11) return;
        seen.add(o);
        for (const k of Object.keys(o)) {
            const v = o[k];
            if (v === 'player' && ['owner', 'holder', 'payer'].includes(k)) hits.push(`${path}.${k}`);
            else if (v && typeof v === 'object') walk(v, `${path}.${k}`, depth + 1);
        }
    };
    walk(world, 'world', 0);
    return hits;
}

function addChild(player, world, age) {
    const child = Relationships.generateChild(player, { culture: 'Imperial' }, world);
    child.age = age;
    return child;
}

describe('the interregnum', () => {
    it('the world turns for two years without the player; the House waits in trust', () => {
        const game = played(31, 120);
        const { world, player } = game;
        const gold = player.gold;
        const kid = addChild(player, world, 10);
        const begun = Afterlife.begin(player, world, 'a fever');
        expect(Afterlife.active(player)).toBe(true);
        expect(player.army).toEqual([]);
        expect(begun).toHaveProperty('disbanded');

        const start = world.day;
        const Y = Relationships._getHeirSettings().daysPerYear;
        for (let d = 0; d < 2 * Y; d++) Afterlife.passDay(world, player);
        expect(world.day).toBe(start + 2 * Y);
        expect(kid.age).toBe(12);
        expect(player.gold).toBe(gold);              // held in trust, untouched
        expect(Afterlife.yearsWaited(player, world)).toBe(2);
        expect(world.kingdoms.some(k => k.isAlive)).toBe(true);
    }, 240000);

    it('an heir who comes of age while the world turns takes up the mantle', () => {
        const game = played(32, 60);
        const { world, player } = game;
        const min = Relationships._getHeirSettings().minAgeToPlay;
        const kid = addChild(player, world, min - 1);
        Afterlife.begin(player, world, 'old age');
        expect(Afterlife.heirsReady(player)).toEqual([]);
        expect(Afterlife.futureHeirs(player)[0]).toMatchObject({ child: kid, years: 1 });

        const Y = Relationships._getHeirSettings().daysPerYear;
        let days = 0;
        while (!Afterlife.heirsReady(player).length && days++ < Y + 1) Afterlife.passDay(world, player);
        expect(Afterlife.heirsReady(player).map(c => c.id)).toContain(kid.id);

        const res = Afterlife.returnAsHeir(player, world, kid.id);
        expect(res.success).toBe(true);
        expect(Afterlife.active(player)).toBe(false);
        expect(player.firstName).toBe(kid.firstName);
        // ...and the day goes on as usual
        for (let d = 0; d < 10; d++) endDay(game);
    }, 240000);

    it('survives a save and load while waiting', () => {
        const game = played(33, 30);
        Afterlife.begin(game.player, game.world, 'a fall');
        Afterlife.passDay(game.world, game.player);
        const back = roundTrip(game);
        expect(back.player.interregnum).toMatchObject({ cause: 'a fall' });
    }, 240000);
});

describe('a new life', () => {
    it('offers distinct people of the world, the same ones for the same day', () => {
        const game = played(34, 20);
        const a = Afterlife.candidates(game.world);
        const b = Afterlife.candidates(game.world);
        expect(a.length).toBe(Afterlife.config().candidates);
        expect(a).toEqual(b);
        expect(new Set(a.map(c => c.key)).size).toBe(a.length);
        for (const c of a) {
            expect(c.age).toBeGreaterThanOrEqual(Afterlife.config().minAge);
            expect(game.world.getTile(c.q, c.r).settlement).toBeTruthy();
            expect(c.gold).toBeGreaterThan(0);
        }
        expect(Afterlife.candidates(game.world, 1)).not.toEqual(a);
    }, 240000);

    // (seeds where the bot has bought into the world by day 300: since the towns' gangs
    // turn weekly (systems/gangs.js), seed 36's bot ends the run owning nothing)
    for (const seed of [35, 37]) {
        it(`hands the old House's holdings on and plays on as someone new (seed ${seed})`, () => {
            const game = played(seed, 300);
            const { world } = game;
            const old = game.player;
            Afterlife.begin(old, world, 'old age');
            expect(playerMarks(world).length).toBeGreaterThan(0);   // the bot bought into the world
            const cand = Afterlife.candidates(world)[0];
            const res = Afterlife.becomeStranger(old, world, cand);
            expect(res.success).toBe(true);
            expect(playerMarks(world)).toEqual([]);
            const me = res.player;
            expect(me.name).toBe(`${cand.first} ${cand.last}`);
            expect([me.q, me.r]).toEqual([cand.q, cand.r]);
            expect(me.gold).toBe(cand.gold);
            expect(me.house).toBeTruthy();
            expect(me.house.name).not.toBe(old.house.name);
            expect(me.interregnum).toBeUndefined();

            // The new life goes on: the bot plays them for a season
            game.player = me;
            for (let d = 0; d < 60; d++) {
                botDay(game, {});
                if (endDay(game).died) break;
            }
            expect(world.day).toBeGreaterThan(300);
        }, 300000);
    }
});

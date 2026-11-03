// Rival agents without an inner-map visit: a rival House can buy someone in a
// town the player never walked through (the roster is seeded lazily on the
// town's own hash stream, Townsfolk.seed), the player can ask around there,
// a first visit dresses the walking NPCs from that roster, and the playtest
// bot finds and deals with them.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { RivalAgents } from '../systems/rivalAgents.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { loadData, newGame, roundTrip } from './playtest/harness.js';
import { rivalAgents as botRivalAgents } from './playtest/bot.js';

let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});

const SEED = 4242;

/** The player holds a town no one has walked through (no roster); a rival burns for them. */
function setup(game) {
    const { world, player } = game;
    const s = world.getSettlementViews().find(x => x.kingdom && x.kingdom !== player.allegiance && !x.folk);
    player.settlements = [{ q: s.q, r: s.r }];
    const rivalId = Object.keys(player.house.rivals)[0];
    player.house.rivals[rivalId].feud = 80;
    return { s, tile: world.getTile(s.q, s.r), rivalId };
}

describe('Rival agents reach towns with no roster', () => {
    it('a town never visited is offered lazily, and recruiting seeds its roster without touching the shared RNG', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const { s, tile, rivalId } = setup(game);
        const key = `${s.q},${s.r}`;
        expect(RivalAgents.towns(player, world, { lazy: false })[key]).toBeUndefined();
        expect(RivalAgents.towns(player, world)[key]).toBeTruthy();
        Utils.setSeed(77);
        const a = RivalAgents.recruit(player, world, rivalId, { town: key });
        const next = Utils.random();
        Utils.setSeed(77);
        expect(Utils.random()).toBe(next);
        expect(a).toBeTruthy();
        expect(tile.settlement.folk).toBeTruthy();
        expect(tile.settlement.folk.seeded).toBe(world.day);
        expect(Townsfolk.residents(tile.settlement.folk).length).toBeGreaterThanOrEqual(3);
        const person = Townsfolk.get(tile.settlement.folk, a.pid);
        expect(Townsfolk.isHere(person)).toBe(true);
        expect(a.name).toBe(Townsfolk.name(person));
        // Now rostered, the strict view finds it too
        expect(RivalAgents.towns(player, world, { lazy: false })[key]).toBeTruthy();
    });

    it('the seeded roster is deterministic for a seed and a day', () => {
        const rosterOf = () => {
            const game = newGame(SEED);
            const { tile } = setup(game);
            Townsfolk.seed(tile.settlement, game.world, { q: tile.q, r: tile.r });
            return tile.settlement.folk.people.map(p => `${p.first} ${p.last} ${p.role} ${p.born}`);
        };
        expect(rosterOf()).toEqual(rosterOf());
    });

    it('the weekly tick recruits with no inner-map visit at all', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        setup(game);
        const st = RivalAgents.state(player);
        for (let i = 0; i < 160 && !st.agents.length; i++) { world.day++; RivalAgents.processDay(world, player); }
        expect(st.agents.length).toBeGreaterThan(0);
    });

    it('asking around a town with no roster works; a first visit dresses NPCs from the seeded roster', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const { s, tile, rivalId } = setup(game);
        const a = RivalAgents.recruit(player, world, rivalId, { town: `${s.q},${s.r}` });
        player.q = s.q; player.r = s.r; player.gold = 1000;
        a.suspicion = 80;
        const inq = RivalAgents.inquire(player, world, s.q, s.r);
        expect(inq.success).toBe(true);
        expect(a.known).toBe(true);
        // The inner map's first visit: freshly generated NPCs are replaced by the roster's people
        const fresh = Array.from({ length: 12 }, (_, i) => ({ id: i, type: 'villager', name: 'Zed', age: 30 }));
        const shown = Townsfolk.attach(tile.settlement, world, fresh, { q: s.q, r: s.r, target: Townsfolk.residents(tile.settlement.folk).length });
        expect(shown.some(p => p.id === a.pid)).toBe(true);
        expect(shown.every(p => p.first !== 'Zed')).toBe(true);
        // ...and an unrostered town with no agent can still be asked
        const other = world.getSettlementViews().find(x => !x.folk && (x.q !== s.q || x.r !== s.r));
        player.q = other.q; player.r = other.r;
        const res = RivalAgents.inquire(player, world, other.q, other.r);
        expect(res.success).toBe(true);
        expect(other.folk || world.getTile(other.q, other.r).settlement.folk).toBeTruthy();
    });

    it('agents in a seeded town survive a save/load round trip', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const { s, rivalId } = setup(game);
        const a = RivalAgents.recruit(player, world, rivalId, { town: `${s.q},${s.r}` });
        const g2 = roundTrip(game);
        const folk = g2.world.getTile(s.q, s.r).settlement.folk;
        expect(folk).toBeTruthy();
        expect(Townsfolk.isHere(Townsfolk.get(folk, a.pid))).toBe(true);
        expect(RivalAgents.state(g2.player).agents).toEqual(RivalAgents.state(player).agents);
    });
});

describe('The playtest bot and rival agents', () => {
    it('asks around a town where agents could be, and turns or exposes the ones it finds', () => {
        const game = newGame(SEED);
        const { world, player } = game;
        const { s, rivalId } = setup(game);
        const a = RivalAgents.recruit(player, world, rivalId, { town: `${s.q},${s.r}` });
        const b = RivalAgents.recruit(player, world, rivalId, { town: `${s.q},${s.r}` });
        expect(a && b).toBeTruthy();
        player.q = s.q; player.r = s.r;
        world.day = 160;
        player.gold = 1000;
        a.suspicion = 90;
        b.suspicion = 90;
        const stats = {};
        botRivalAgents(game, stats);
        expect(stats.agentInquiries).toBe(1);
        expect(a.known && b.known).toBe(true);
        // The next day it deals with them: rich enough to turn one, then exposes the rest
        world.day = 161;
        player.gold = RivalAgents.turnCost(player, a) * 4 + 1;
        botRivalAgents(game, stats);
        expect((stats.agentsTurned || 0) + (stats.agentsExposed || 0)).toBe(2);
        expect(RivalAgents.known(player).filter(x => !x.turned)).toHaveLength(0);
    });

    it('stays out of the short soak (day 150 and before)', () => {
        const game = newGame(SEED);
        const { s } = setup(game);
        game.player.q = s.q; game.player.r = s.r;
        game.world.day = 140;
        const stats = {};
        botRivalAgents(game, stats);
        expect(stats).toEqual({});
    });
});

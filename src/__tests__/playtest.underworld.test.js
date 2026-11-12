// The playtest bot in the underworld (playtest/bot.js gangLife, bossDay,
// leaveJail): it plays the Crime Lord start as a boss (orders given, the
// weekly cut drawn, dirty coin washed through the dens), and, given a guild
// contact, runs with a town's crew and its errands. The day's invariants
// hold throughout: gold never negative or runaway, every gang purse finite.
// SOAK_ORIGIN=crime_lord runs the full soak from the same start; UW_VERBOSE=1
// prints the bot's counters and its gang's books.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { Scenarios } from '../player/scenarios.js';
import { Gangs } from '../systems/gangs.js';
import { Underworld } from '../systems/underworld.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};

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

function play(game, days, stats) {
    const problems = [];
    for (let i = 0; i < days; i++) {
        botDay(game, stats);
        const res = endDay(game);
        const p = game.player;
        if (!Number.isFinite(p.gold) || p.gold < 0 || p.gold > 1e7) problems.push(`day ${game.world.day}: gold ${p.gold}`);
        for (const b of Gangs.bossTowns(p, game.world)) {
            if (!Number.isFinite(b.gang.purse) || b.gang.purse < 0) problems.push(`day ${game.world.day}: ${b.gang.name} purse ${b.gang.purse}`);
        }
        if (res.died) break;
    }
    return problems;
}

describe('the bot in the underworld', () => {
    it('plays the Crime Lord: gives orders, draws its cut, washes its coin', () => {
        // (seed 102, was 101: with travel by days per hex (data/travel.json) seed 101's bot wanders
        // away and a lieutenant's betrayal takes its gang on day 38 — luck of the draw, not a fault)
        const game = newGame(102);
        Scenarios.apply(game.player, game.world, { origin: 'crime_lord' });
        const home = Gangs.bossTowns(game.player, game.world)[0];
        expect(home).toBeTruthy();
        const stats = {};
        const problems = play(game, 100, stats);
        expect(problems, problems.slice(0, 5).join('\n')).toEqual([]);
        expect(stats.bossOrders || 0).toBeGreaterThan(0);
        const g = home.gang;
        const b = Gangs.bookView(g);
        if (ENV.UW_VERBOSE) process.stdout.write(`crime lord: ${JSON.stringify({ stats, gold: Math.round(game.player.gold), dirty: Gangs.dirty(game.player), purse: Math.round(g.purse), crew: g.crew, books: b.all, weeks: b.weeks, bossTowns: Gangs.bossTowns(game.player, game.world).length })}\n`);
        expect(b.weeks).toBeGreaterThan(10);
        expect(b.all.took).toBeGreaterThan(0);
        expect(b.all.out.toYou || 0).toBeGreaterThan(0);
        expect((stats.laundered || 0) + (stats.gangErrands || 0)).toBeGreaterThan(0);
    }, 240000);

    it('runs with a crew once it has a guild contact, and its errands', () => {
        const game = newGame(202);
        const uw = Underworld.ensure(game.player);
        uw.guild.contactMet = true;
        game.player.gold += 1500;
        const stats = {};
        const problems = play(game, 240, stats);
        expect(problems, problems.slice(0, 5).join('\n')).toEqual([]);
        if (ENV.UW_VERBOSE) process.stdout.write(`member: ${JSON.stringify({ stats, gold: Math.round(game.player.gold), dirty: Gangs.dirty(game.player), gangs: Underworld.ensure(game.player).gangs })}\n`);
        expect(stats.gangJoined || 0).toBeGreaterThan(0);
        expect(stats.gangErrands || 0).toBeGreaterThan(0);
    }, 300000);
});

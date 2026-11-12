// Lay a line of works at once (systems/infrastructure.js planRoute /
// commissionRoute, ui/actionMenu/roadPlan.js): every hex of a road from here
// to there commissioned in one go, paid for whole, each its own work site.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Hex } from '../core/hex.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/** Two passable hexes about `n` apart, off any settlement, with a route between. */
function endsApart(world, n) {
    const land = world.tiles.flat().filter(t => t.terrain && t.terrain.passable && !t.settlement && !t.infrastructure);
    for (const a of land) {
        const b = land.find(t => Hex.wrappingDistance(a.q, a.r, t.q, t.r, world.width) === n);
        if (!b) continue;
        const plan = Infrastructure.planRoute({ gold: 0 }, 'DIRT_ROAD', world, a, b);
        if (plan.ok && plan.build.length >= n - 1) return { a, b, plan };
    }
    return null;
}

describe('a line of works', () => {
    it('surveys a route: hexes, cost and time, without touching the purse', () => {
        const { world, player } = newGame(4242);
        const ends = endsApart(world, 6);
        expect(ends).toBeTruthy();
        const { plan } = ends;
        expect(plan.path[0]).toEqual({ q: ends.a.q, r: ends.a.r });
        expect(plan.path[plan.path.length - 1]).toEqual({ q: ends.b.q, r: ends.b.r });
        expect(plan.cost).toBe(plan.build.reduce((s, x) => s + x.cost, 0));
        expect(plan.days).toBeGreaterThan(0);
        const gold = player.gold;
        Infrastructure.planRoute(player, 'DIRT_ROAD', world, ends.a, ends.b);
        expect(player.gold).toBe(gold);
    });

    it('commissions every hex at once, all or nothing on the purse, and the works go up day by day', () => {
        const game = newGame(4242);
        const { world, player } = game;
        const { a, b, plan } = endsApart(world, 6);
        player.gold = plan.cost - 1;
        const short = Infrastructure.commissionRoute(player, 'DIRT_ROAD', world, plan);
        expect(short.success).toBe(false);
        expect(player.gold).toBe(plan.cost - 1);
        expect(plan.build.every(s => !world.getTile(s.q, s.r).infrastructure)).toBe(true);

        player.gold = plan.cost + 500;
        const res = Infrastructure.commissionRoute(player, 'DIRT_ROAD', world, plan);
        expect(res.success).toBe(true);
        expect(res.built.length).toBe(plan.build.length);
        expect(player.gold).toBe(500 + plan.cost - res.cost);
        for (const s of plan.build) {
            const t = world.getTile(s.q, s.r);
            expect(t.infrastructure && t.infrastructure.id).toBe('dirt_road');
            expect(player.infrastructureUnderConstruction.some(x => x.q === s.q && x.r === s.r)).toBe(true);
        }
        // A second survey of the same line finds it all under way
        const again = Infrastructure.planRoute(player, 'DIRT_ROAD', world, a, b);
        expect(again.build.length).toBe(0);
        // Day by day, every site advances
        const t0 = world.getTile(plan.build[0].q, plan.build[0].r).infrastructure.constructionDaysLeft;
        endDay(game);
        expect(world.getTile(plan.build[0].q, plan.build[0].r).infrastructure.constructionDaysLeft).toBeLessThan(t0);
    });

    it('refuses the same hex, an unknown work, or nowhere to go', () => {
        const { world, player } = newGame(4242);
        const t = world.tiles.flat().find(x => x.terrain && x.terrain.passable);
        expect(Infrastructure.planRoute(player, 'DIRT_ROAD', world, t, t).ok).toBe(false);
        expect(Infrastructure.planRoute(player, 'NOPE', world, t, t).ok).toBe(false);
    });
});

// A property's panels show what it really makes: the same reckoning as the
// day's production (PlayerEconomy.outputFactors), not productionRate × level.
import { describe, it, expect, beforeAll } from 'vitest';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { loadData, newGame } from './playtest/harness.js';

beforeAll(async () => { await loadData(); });

describe('property output shown = output made', () => {
    it("a hemp farm's shown rate is what lands in its store, not base × level", () => {
        const { world, player } = newGame(101);
        const t = world.getTile(player.q, player.r);
        const farm = { type: 'hemp_farm', name: 'Hemp Farm', produces: 'hemp', productionRate: 5, level: 3, storage: 0, daysOwned: 0 };
        t.playerProperties = [farm];
        player.properties = [{ q: t.q, r: t.r, type: 'hemp_farm', produces: 'hemp', productionRate: 5, level: 3 }];
        player.gold = 100000;
        const days = 30;
        let shown = 0;
        for (let i = 0; i < days; i++) {
            const s = PlayerEconomy.outputSummary(world, player, player.properties[0]);
            expect(s).not.toBeNull();
            shown += s.now;
            PlayerEconomy.produceGoods(player, world);
            expect(farm.lastOutput).toBe(Math.max(0, farm.lastOutput));
            world.day++;
        }
        // The store grew by what was shown (fractions carry from day to day)
        expect(Math.abs(farm.storage - shown)).toBeLessThanOrEqual(1.01);
        // And the old panel number (5 × level 3 = 15) is not what it makes
        const s = PlayerEconomy.outputSummary(world, player, player.properties[0]);
        expect(s.why).toMatch(/^base 5/);
        expect(s.line).toMatch(/made yesterday/);
        // The manage menu passes the tile's own record (no q/r): with its tile it reads,
        // without one it gives null rather than looking up tile (NaN, NaN)
        expect(PlayerEconomy.outputSummary(world, player, farm, t)).not.toBeNull();
        expect(PlayerEconomy.outputSummary(world, player, farm)).toBeNull();
    });
});

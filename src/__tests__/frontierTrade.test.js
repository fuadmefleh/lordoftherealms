// The long-haul frontier trade (systems/marketDynamics.js _frontierPairs): two
// realms whose towns lie too far apart for neighbours' trade still trade over
// their nearest pair of towns within trade.frontierRange, so coin crosses the
// border and the realms' balance of trade (world/moneySupply.js) is real.
import { describe, it, expect, beforeAll } from 'vitest';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

const pk = (i, j) => (i < j ? i * 100000 + j : j * 100000 + i);
const town = (name, q, r, kingdom) => ({ name, q, r, kingdom });

describe('frontier trade links', () => {
    const world = { width: 200 };
    const T = { frontierRange: 30 };

    it('links two unlinked realms over their nearest pair on one land', () => {
        const lives = [town('A1', 10, 10, 'a'), town('A2', 14, 10, 'a'), town('B1', 34, 10, 'b'), town('B2', 40, 10, 'b')];
        const tiles = lives.map(() => ({ regionId: 1 }));
        const pairs = new Map([[pk(0, 1), { i: 0, j: 1, d: 4, sea: false }]]);
        MarketDynamics._frontierPairs(world, lives, tiles, lives.map(() => false), pairs, pk, T);
        expect(pairs.size).toBe(2);
        expect(pairs.get(pk(1, 2))).toMatchObject({ i: 1, j: 2, d: 20, sea: false });
    });

    it('adds nothing when the realms already trade, are too far, or are on other lands without ports', () => {
        const lives = [town('A', 10, 10, 'a'), town('B', 30, 10, 'b')];
        const linked = new Map([[pk(0, 1), { i: 0, j: 1, d: 20, sea: false }]]);
        MarketDynamics._frontierPairs(world, lives, [{ regionId: 1 }, { regionId: 1 }], [false, false], linked, pk, T);
        expect(linked.size).toBe(1);

        const far = [town('A', 10, 10, 'a'), town('B', 50, 10, 'b')];
        const none = new Map();
        MarketDynamics._frontierPairs(world, far, [{ regionId: 1 }, { regionId: 1 }], [false, false], none, pk, T);
        expect(none.size).toBe(0);

        MarketDynamics._frontierPairs(world, lives, [{ regionId: 1 }, { regionId: 2 }], [true, false], none, pk, T);
        expect(none.size).toBe(0);
        // ...but two ports trade by sea
        MarketDynamics._frontierPairs(world, lives, [{ regionId: 1 }, { regionId: 2 }], [true, true], none, pk, T);
        expect(none.get(pk(0, 1))).toMatchObject({ sea: true });
    });

    it('independent towns do not count as a realm', () => {
        const lives = [town('A', 10, 10, 'a'), town('Free', 20, 10, null)];
        const pairs = new Map();
        MarketDynamics._frontierPairs(world, lives, [{ regionId: 1 }, { regionId: 1 }], [false, false], pairs, pk, T);
        expect(pairs.size).toBe(0);
    });
});

describe('frontier trade in a real small world', () => {
    beforeAll(loadData);

    it('books cross-border trade on the money supply within a few weeks (4 realms)', () => {
        const g = newGame(23, { kingdomCount: 4 });
        for (let d = 0; d < 18; d++) endDay(g);
        const book = (g.world.money && g.world.money.trade) || {};
        const booked = Object.values(book).reduce((s, v) => s + v, 0);
        expect(booked).toBeGreaterThan(0);
    }, 60000);
});

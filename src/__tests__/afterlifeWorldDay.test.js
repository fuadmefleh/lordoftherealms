// The interregnum's world day (player/afterlife.js WORLD_DAY) keeps step with
// ui/game/endDay.js: every daily system endDay calls is either run in the wait
// (with no player) or listed as skipped, with the reason. A new daily system
// added to endDay.js and not classified fails here. And the world can turn for
// years with no one alive without a system falling over on the missing player.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadData, newGame } from './playtest/harness.js';
import { Afterlife } from '../player/afterlife.js';
import { Relationships } from '../systems/relationships.js';

const END_DAY = fileURLToPath(new URL('../ui/game/endDay.js', import.meta.url));

/** The systems endDay.js runs each day: `X.process…(this.world|this.player…)`, `X.updatePrices(…)`, and `for (const sys of [A, B])` loops. */
function endDaySystems() {
    const src = readFileSync(END_DAY, 'utf8');
    const names = new Set();
    for (const m of src.matchAll(/\b([A-Z][A-Za-z0-9]+)\.(process[A-Za-z]*|updatePrices)\(\s*this\.(?:world|player)\b/g)) names.add(m[1]);
    for (const m of src.matchAll(/for \(const \w+ of \[([A-Z][A-Za-z0-9, ]*)\]\)/g)) {
        for (const n of m[1].split(',').map(x => x.trim()).filter(Boolean)) names.add(n);
    }
    return [...names];
}

beforeAll(async () => {
    await loadData();
});

describe('the world day of the interregnum', () => {
    it('classifies every daily system of endDay.js: run in the wait, or skipped with a reason', () => {
        const found = endDaySystems();
        // (the reader works: these are certainly there)
        expect(found).toEqual(expect.arrayContaining(['Townsfolk', 'MarketDynamics', 'Hearsay', 'RiverLife', 'LandMarket', 'Bourse']));
        const run = new Set(Afterlife.worldDaySystems());
        const skipped = Afterlife.worldDaySkipped();
        const missing = found.filter(n => !run.has(n) && !(n in skipped));
        expect(missing).toEqual([]);
        // ...and no system is both, nor skipped without a reason
        expect(found.filter(n => run.has(n) && n in skipped)).toEqual([]);
        for (const [n, why] of Object.entries(skipped)) expect(typeof why === 'string' && why.length > 8, n).toBe(true);
    });

    it('runs the world systems found in the wait (the rivers among them)', () => {
        const run = Afterlife.worldDaySystems();
        for (const n of ['RiverFlotsam', 'RiverDrift', 'RiverNets', 'RiverLife', 'Labour', 'Literacy', 'Plague', 'IllnessPlayer']) expect(run).toContain(n);
        // (no stale step: every step names a system endDay.js still runs)
        const found = new Set(endDaySystems());
        expect(run.filter(n => !found.has(n))).toEqual([]);
    });

    it('the world turns for three years with no one alive, the distant years included', () => {
        const game = newGame(41);
        const { world, player } = game;
        Afterlife.begin(player, world, 'a fever');
        const Y = Relationships._getHeirSettings().daysPerYear;
        const start = world.day;
        const gold = player.gold;
        // A season day by day, then the distant years (a long wait, as the panel runs it)
        for (let d = 0; d < 30; d++) Afterlife.passDay(world, player);
        while (world.day < start + 3 * Y) Afterlife.passDay(world, player, { distant: true });
        expect(world.day).toBe(start + 3 * Y);
        expect(world._distant).toBeUndefined();
        expect(player.gold).toBe(gold);
        expect(Afterlife.yearsWaited(player, world)).toBe(3);
        expect(world.kingdoms.some(k => k.isAlive)).toBe(true);
    }, 300000);
});

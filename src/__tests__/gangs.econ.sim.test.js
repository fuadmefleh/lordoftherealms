// Opt-in probe: what do the towns' gangs (systems/gangs.js) do to the towns'
// purses? Each seed's harness world (the player kept fed and idle) is run
// twice for the same days: once as the game plays it, and once with the
// gangs' week switched off (no gang is ever seeded, so none takes a coin).
// The difference between the two runs, seed by seed, separates the gangs'
// drain from the sim's own variance (the runs diverge from the first gang
// week, so look at the spread across seeds, not one seed).
//
//   GANGSIM=1 npx vitest run src/__tests__/gangs.econ.sim.test.js
//   GSEEDS=101,202,303 GDAYS=480 GSAMPLE=120
//
// Prints per sample: the coin in the towns that keep gangs (town, city,
// capital), their median purse, how many are under 50g, the coin the gangs
// and the bought watch hold, and the gangs' books (taken from / paid into
// the towns, by kind) since the start.

import { it, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Gangs } from '../systems/gangs.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const med = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor((s.length - 1) / 2)];
};
const r0 = (v) => Math.round(v);

function measure(game) {
    const { world } = game;
    const purses = [];
    let all = 0, held = 0, watch = 0, gangs = 0, wkTook = 0, wkPaid = 0;
    const took = {}, paid = {};
    for (const s of world.getSettlementViews()) {
        const g = (s.economy && s.economy.gold) || 0;
        all += g;
        if (!Gangs.hasGangs(s)) continue;
        purses.push(g);
        const st = s.underworld;
        if (!st || !Array.isArray(st.gangs)) continue;
        watch += (st.watch.captain.purse || 0) + (st.watch.magistrate.purse || 0);
        for (const x of st.gangs) {
            if (x.dissolved) continue;
            gangs++;
            held += x.purse;
            const lw = x.books && x.books.last;
            if (lw) {
                wkTook += Object.values(lw.in || {}).reduce((a, v) => a + v, 0);
                wkPaid += Object.values(lw.out || {}).reduce((a, v) => a + v, 0);
            }
            const b = x.books && x.books.all;
            if (!b) continue;
            for (const [k, v] of Object.entries(b.in || {})) took[k] = (took[k] || 0) + v;
            for (const [k, v] of Object.entries(b.out || {})) paid[k] = (paid[k] || 0) + v;
        }
    }
    return {
        day: world.day, gangTowns: purses.length, gangTownCoin: purses.reduce((a, b) => a + b, 0), allTownCoin: all,
        median: med(purses), under50: purses.filter(v => v < 50).length, held, watch, gangs, took, paid, wkTook, wkPaid,
    };
}

function run(seed, days, sample, withGangs) {
    const spy = withGangs ? null : vi.spyOn(Gangs, 'processDay').mockImplementation(() => ({ notices: [] }));
    try {
        const game = newGame(seed);
        const rows = [];
        for (let i = 1; i <= days; i++) {
            game.player.health = 100;
            game.player.inventory.bread = 40;
            game.player.starvationDays = 0;
            endDay(game);
            if (i % sample === 0) rows.push(measure(game));
        }
        return rows;
    } finally {
        if (spy) spy.mockRestore();
    }
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${r0(v)}`).join(', ');

it.skipIf(!ENV.GANGSIM)('gangs against the towns\' purses, with and without', () => {
    const SEEDS = (ENV.GSEEDS || '101,202,303').split(',').map(Number);
    const DAYS = Number(ENV.GDAYS || 480);
    const SAMPLE = Number(ENV.GSAMPLE || 120);
    const out = [];
    for (const seed of SEEDS) {
        const on = run(seed, DAYS, SAMPLE, true);
        const off = run(seed, DAYS, SAMPLE, false);
        out.push(`seed ${seed}`);
        for (let i = 0; i < on.length; i++) {
            const a = on[i], b = off[i];
            const weeks = Math.max(1, Math.floor(a.day / 7));
            out.push(`  d${a.day}: gang towns ${a.gangTowns} coin ${r0(a.gangTownCoin)} vs ${r0(b.gangTownCoin)} without (${r0((a.gangTownCoin / Math.max(1, b.gangTownCoin) - 1) * 100)}%),`
                + ` median ${r0(a.median)} vs ${r0(b.median)}, under 50g ${a.under50} vs ${b.under50}; all towns ${r0(a.allTownCoin)} vs ${r0(b.allTownCoin)};`
                + ` ${a.gangs} gangs hold ${r0(a.held)}g, the watch ${r0(a.watch)}g;`
                + ` last week took ${r0(a.wkTook)}, paid ${r0(a.wkPaid)};`
                + ` all time (live gangs) taken ${r0(sum(a.took))} (${r0(sum(a.took) / weeks)}/wk), paid ${r0(sum(a.paid))} (${r0(sum(a.paid) / weeks)}/wk)`);
        }
        const last = on[on.length - 1];
        out.push(`    taken: ${fmt(last.took)}`);
        out.push(`    paid:  ${fmt(last.paid)}`);
    }
    process.stdout.write(`\n${out.join('\n')}\n`);
}, 3_600_000);

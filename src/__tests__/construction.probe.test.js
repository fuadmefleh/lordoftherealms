// Construction-time probe (opt-in): CPROBE=1 npx vitest run src/__tests__/construction.probe.test.js
//
// How long the builds really take on the calendar now that work goes by
// work-days (systems/construction.js, data/construction.json): for each kind
// of build, at towns of several generated worlds, the days from the order to
// the building standing when work starts on the first day of each season, with
// no hired crews and with the most crews, and what those crews cost. The
// figures feed docs/economy-balance.md ("Construction takes real time").
// Knobs: CPROBE_SEEDS=101,202,303  CPROBE_SITES=8 (towns per seed).
// It reads the weather by day and moves world.day by hand (no endDay); it draws no RNG.

import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Seasons } from '../world/seasons.js';
import { Economy } from '../world/economy.js';
import { Construction } from '../systems/construction.js';
import { loadData, newGame } from './playtest/harness.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.CPROBE;
const SEEDS = ENV.CPROBE_SEEDS ? ENV.CPROBE_SEEDS.split(',').map(Number) : [101, 202, 303];
const SITES = Number(ENV.CPROBE_SITES) || 8;
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

/** Every build kind worth a row: [label, work-days on open ground, scaled by the site's stone and timber?]. */
function builds() {
    const g = DataLoader._gamedata;
    const out = [];
    const pt = g.playerEconomy.PROPERTY_TYPES;
    for (const id of ['FORAGER_HUT', 'APIARY', 'FARM', 'SALT_PANS', 'TAVERN', 'INN', 'MINE', 'HOTEL']) {
        if (pt[id]) out.push([`property ${id.toLowerCase()} (${pt[id].cost}g)`, pt[id].constructionDays, true]);
    }
    for (const inf of Object.values(g.infrastructure.types || {})) {
        if (inf && inf.buildTime) out.push([`infrastructure ${inf.id}`, inf.buildTime, true]);
    }
    const rel = g.religion.buildingTypes || {};
    for (const [id, b] of Object.entries(rel)) if (b && b.constructionDays) out.push([`religious ${b.id || id}`, b.constructionDays, false]);
    const cul = g.culture.buildingTypes || {};
    for (const [id, b] of Object.entries(cul)) if (b && b.constructionDays) out.push([`cultural ${b.id || id}`, b.constructionDays, false]);
    return out;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** Calendar days to finish `work` work-days at (q, r) starting on `start`, with `crews` kept on; and the crew wages paid. */
function build(world, q, r, work, start, crews) {
    const rec = { underConstruction: true, constructionDaysTotal: work, constructionDaysLeft: work, crews };
    const wage = crews ? Construction.crewWage(world, q, r) : 0;
    let days = 0;
    let paid = 0;
    world.day = start;
    while (days < 3000) {
        paid += wage * crews;
        days++;
        if (Construction.advance(rec, world, q, r)) break;
        world.day++;
    }
    return { days, paid };
}

let logSpy;
let warnSpy;
beforeAll(async () => {
    if (!ON) return;
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});

describe.skipIf(!ON)('construction probe (CPROBE=1)', () => {
    it('measures build times on the calendar', () => {
        const kinds = builds();
        // label → { work:[], free:{season:[days]}, crewed:{season:[days]}, cost:[] }
        const rows = {};
        const wages = [];
        for (const seed of SEEDS) {
            const { world } = newGame(seed);
            const day0 = world.day;
            // the first day of the next year, then each season's first day
            const yearStart = day0 + (120 - ((Seasons.dayOfYear(day0) - 1) % 120));
            const towns = world.getAllSettlements().filter(s => s.type !== 'village').slice(0, SITES);
            for (const s of towns) {
                wages.push(Construction.crewWage(world, s.q, s.r));
                for (const [label, base, scaled] of kinds) {
                    const work = scaled ? Economy.scaleBuildDays(base, world, s.q, s.r) : base;
                    const row = rows[label] || (rows[label] = { base, work: [], free: {}, crewed: {}, cost: [] });
                    row.work.push(work);
                    SEASONS.forEach((season, i) => {
                        const start = yearStart + i * 30;
                        (row.free[season] || (row.free[season] = [])).push(build(world, s.q, s.r, work, start, 0).days);
                        const c = build(world, s.q, s.r, work, start, 3);
                        (row.crewed[season] || (row.crewed[season] = [])).push(c.days);
                        if (season === 'Spring') row.cost.push(c.paid);
                    });
                }
            }
            world.day = day0;
        }
        const lines = [`seeds ${SEEDS.join(',')}, ${SITES} towns each; crew wage median ${median(wages)}g/day (p10 ${[...wages].sort((a, b) => a - b)[Math.floor(wages.length / 10)]}, p90 ${[...wages].sort((a, b) => a - b)[Math.floor(wages.length * 0.9)]})`,
            '| Build | Work-days (base → median at a town) | Calendar days, no crews: spring / summer / autumn / winter start | With 3 crews (spring / winter start) | 3 crews cost (spring start) |',
            '|---|---|---|---|---|'];
        for (const [label, row] of Object.entries(rows)) {
            const free = SEASONS.map(se => median(row.free[se])).join(' / ');
            lines.push(`| ${label} | ${row.base} → ${median(row.work)} | ${free} | ${median(row.crewed.Spring)} / ${median(row.crewed.Winter)} | ${Math.round(median(row.cost))}g |`);
        }
        process.stdout.write(`${lines.join('\n')}\n`);
    }, 600000);
});

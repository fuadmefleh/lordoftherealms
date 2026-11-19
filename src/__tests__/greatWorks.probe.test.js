// A probe, not a spec: GW_PROBE=1 runs a headless world for GW_YEARS years
// (default 100) and prints, every GW_EVERY years (10), the state of the Works
// of the Ages (systems/greatWorks.js): how many are live / done / ruined,
// each live work's progress, its pledges against the full-pace cost, the
// good that held it back, and the world cap. Then the price-news trade
// (systems/priceNews.js → merchantCaravans.js): caravans that set out on news.
// Skipped otherwise.
//   GW_SEED   the world (default 777; several: GW_SEEDS=777,101)
//   GW_MODE   'distant' (default: the world-only years, coarse and fast),
//             'daily' (world-only, day by day), 'living' (the bot plays)
//
//   GW_PROBE=1 GW_YEARS=40 npx vitest run src/__tests__/greatWorks.probe.test.js

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { Afterlife } from '../player/afterlife.js';
import { GreatWorks } from '../systems/greatWorks.js';
import { PriceNews } from '../systems/priceNews.js';
import { DataLoader } from '../core/dataLoader.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.GW_PROBE;
const YEARS = Number(ENV.GW_YEARS) || 100;
const EVERY = Number(ENV.GW_EVERY) || 10;
const SEEDS = (ENV.GW_SEEDS || ENV.GW_SEED || '777').split(',').map(Number);
const MODE = ENV.GW_MODE || 'distant';
const DAYS = Number(ENV.GW_DAYS) || 0;
const Y = 120;

beforeAll(async () => {
    if (!ON) return;
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
}, 120000);

const out = (...a) => process.stdout.write(a.join(' ') + '\n');

function row(world, year) {
    const ws = GreatWorks.works(world);
    const st = GreatWorks.state(world);
    const by = s => ws.filter(w => w.status === s);
    const views = world.getSettlementViews().length;
    const C = GreatWorks.config();
    const cap = Math.min(C.maxLive, Math.max(1, Math.floor(views / C.townsPerWork)));
    out(`  y${year}: live ${by('building').length}+${by('stalled').length} stalled / cap ${cap}, done ${by('done').length}, ruin ${by('ruin').length}, total ${ws.length}, capHits ${st._capHits || 0}`);
    for (const w of ws.filter(x => x.status === 'building' || x.status === 'stalled')) {
        const age = ((world.day - w.founded) / Y).toFixed(0);
        out(`     ${w.type.padEnd(13)} ${w.status.padEnd(8)} ${String(Math.round(w.prog * 100)).padStart(3)}% age ${age.padStart(3)}y pledged ${GreatWorks.pledged(w).toFixed(0)}/${w.full.toFixed(0)} matF ${w.matF != null ? w.matF.toFixed(2) : '-'} short ${w.short || '-'} funders ${w.funders.filter(f => f.status === 'active').map(f => f.kind).join(',')}`);
    }
}

describe.skipIf(!ON)('Works of the Ages probe', () => {
    for (const seed of SEEDS) {
        it(`seed ${seed}: ${YEARS} years (${MODE})`, () => {
            // (GW_NORUNS=1: the caravans' news runs off — the 'before' of the price-news trade)
            const K = DataLoader._gamedata.priceKnowledge.news.caravans;
            if (ENV.GW_NORUNS) K.runsPerDay = 0;
            let game = newGame(seed);
            const { world } = game;
            const player = game.player;
            out(`\n[gw probe] seed ${seed}, ${MODE}, towns ${world.getSettlementViews().length}`);
            let caravansOnNews = 0;
            const t0 = performance.now();
            const total = DAYS || YEARS * Y;
            for (let d = 1; d <= total; d++) {
                if (MODE === 'living') {
                    try { botDay(game, {}); } catch (e) { /* the bot's own trouble */ }
                    const res = endDay(game) || {};
                    if (res.died && !carryOn(game, res.died).how) break;
                } else Afterlife.passDay(world, player, { distant: MODE === 'distant' });
                if (d % (EVERY * Y) === 0) row(world, d / Y);
            }
            const ws = GreatWorks.works(world);
            const done = ws.filter(w => w.status === 'done').map(w => `${w.type} ${((w.done - w.founded) / Y).toFixed(0)}y`);
            out(`  finished: ${done.join(', ') || 'none'}`);
            const ns = PriceNews.state ? PriceNews.state(world) : null;
            if (ns) out(`  price news stats: ${JSON.stringify(ns.stats || {})}`);
            const mt = world.merchantTrade && world.merchantTrade.stats;
            if (mt) out(`  caravans: spawned ${mt.spawned}, news runs ${mt.newsRuns || 0}, delivered ${mt.delivered}`);
            out(`  ${((performance.now() - t0) / total).toFixed(1)} ms/day over ${total} days`);
            expect(world.day).toBeGreaterThan(0);
            void caravansOnNews;
        }, 24 * 3600 * 1000);
    }
});

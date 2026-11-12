// A probe, not a spec: ABD_PROBE=1 runs the playtest bot for decades on a few
// seeds (deaths carried on to heirs) and reports how often the court's
// pressure to step down reaches the Counsel, how often the lords demand it,
// and how often a ruler is deposed (systems/abdication.js). Skipped otherwise.
// ABD_YEARS (default 30) and ABD_SEEDS (default 101,202,303) tune it.

import { describe, it, expect, beforeAll } from 'vitest';
import { Abdication } from '../systems/abdication.js';
import { loadData, newGame, endDay, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.ABD_PROBE;
const YEARS = Number(ENV.ABD_YEARS) || 30;
const SEEDS = ENV.ABD_SEEDS ? ENV.ABD_SEEDS.split(',').map(Number) : [101, 202, 303];

beforeAll(async () => {
    if (ON) await loadData();
});

function run(seed) {
    let game = newGame(seed);
    const stats = {};
    const out = { seed, weeks: 0, counselWeeks: 0, demands: 0, depositions: 0, abdications: 0, rulers: 1, peak: 0, reasons: {}, lines: [] };
    const P = Abdication.config().pressure;
    let hadDemand = false;
    let seen = 0;
    for (let i = 0; i < YEARS * 120; i++) {
        botDay(game, stats);
        const res = endDay(game);
        const p = game.player;
        if (res.died) {
            const next = carryOn(game, res.died);
            out.lines.push(`day ${game.world.day}: ${res.died} → ${next.how || 'the end'}`);
            if (!next.how) break;
            out.rulers++;
        }
        if (game.world.day % 7 === 0) {
            const pr = Abdication.pressure(p, game.world);
            out.weeks++;
            out.peak = Math.max(out.peak, pr.score);
            if (pr.score >= P.counselAt && Abdication.rightfulHeirId(p)) {
                out.counselWeeks++;
                for (const r of pr.reasons) out.reasons[r.key] = (out.reasons[r.key] || 0) + 1;
            }
        }
        const st = p.abdication;
        const demand = !!(st && st.demand);
        if (demand && !hadDemand) {
            out.demands++;
            out.lines.push(`day ${game.world.day}: demand (${st.demand.reasons.join('; ')})`);
        }
        hadDemand = demand;
        const rec = (st && st.record) || [];
        for (; seen < rec.length; seen++) {
            out.abdications++;
            out.rulers++;
            if (rec[seen].how === 'forced') out.depositions++;
            out.lines.push(`day ${rec[seen].day}: ${rec[seen].name} → ${rec[seen].to} (${rec[seen].how})`);
        }
    }
    return out;
}

describe.skipIf(!ON)('abdication probe', () => {
    for (const seed of SEEDS) {
        it(`seed ${seed}: ${YEARS} years`, () => {
            const r = run(seed);
            console.log(`[ABD] seed ${r.seed}: rulers ${r.rulers}, weeks ${r.weeks}, counsel weeks ${r.counselWeeks} (${(100 * r.counselWeeks / Math.max(1, r.weeks)).toFixed(1)}%), demands ${r.demands}, depositions ${r.depositions}, peak ${r.peak}, reasons ${JSON.stringify(r.reasons)}\n  ${r.lines.join('\n  ')}`);
            expect(r.weeks).toBeGreaterThan(0);
        }, YEARS * 120 * 400);
    }
});

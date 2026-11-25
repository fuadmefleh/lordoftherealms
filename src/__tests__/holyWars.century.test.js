// A probe, not a spec: HW_CENTURY=1 runs the world alone (no player: the
// afterlife's world day, player/afterlife.js passDay — every AI system that
// runs while no one lives) for HW_YEARS (default 100) on HW_SEEDS (default
// 101,202,303) and tallies the holy wars (systems/holyWars.js): how many are
// called a century, by which cause, how long they last, who wins, and whether
// two ever ran against one foe at once. HW_LIGHT=1 runs only the world's own
// day (world.advanceDay: the realms' wars and sieges), the crises and the
// Church — faster, coarser.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { HolyWars } from '../systems/holyWars.js';
import { Inquisition } from '../systems/inquisition.js';
import { Crises } from '../systems/crises.js';
import { Afterlife } from '../player/afterlife.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { loadData, WORLD_W, WORLD_H, GEN } from './playtest/harness.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.HW_CENTURY;
const YEARS = Number(ENV.HW_YEARS) || 100;
const SEEDS = ENV.HW_SEEDS ? ENV.HW_SEEDS.split(',').map(Number) : [101, 202, 303];
const LIGHT = !!ENV.HW_LIGHT;

beforeAll(async () => {
    if (!ON) return;
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function run(seed) {
    Utils.setSeed(seed);
    const world = new World(WORLD_W, WORLD_H);
    world.generate({ ...GEN });
    const seen = new Map();
    let overlapDays = 0;
    let maxSameFoe = 1;
    const t0 = Date.now();
    for (let i = 0; i < YEARS * 120; i++) {
        if (LIGHT) {
            world.advanceDay(null, {});
            Crises.processDay(world, null);
            HolyWars.processDay(world, null);
            Inquisition.processDay(world, null);
        } else {
            Afterlife.passDay(world, null);
        }
        const st = HolyWars.state(world);
        const foes = {};
        for (const w of st.wars) {
            if (!seen.has(w.id)) seen.set(w.id, { id: w.id, see: w.seeKey, casus: w.casus, target: w.targetName, called: w.called });
            seen.get(w.id).joint = (w.joint || []).length;
            foes[w.target] = (foes[w.target] || 0) + 1;
        }
        const top = Math.max(1, ...Object.values(foes));
        if (top > 1) overlapDays++;
        maxSameFoe = Math.max(maxSameFoe, top);
        for (const p of st.past) {
            const r = seen.get(p.id);
            if (r && r.outcome == null) Object.assign(r, { outcome: p.outcome, to: p.to, members: (p.members || []).length, gained: (p.gained || []).length });
        }
    }
    const wars = [...seen.values()];
    const fought = wars.filter(w => w.outcome && w.outcome !== 'unanswered');
    const lens = fought.map(w => w.to - w.called).sort((a, b) => a - b);
    const tally = (k) => wars.reduce((o, w) => { o[w[k] || 'open'] = (o[w[k] || 'open'] || 0) + 1; return o; }, {});
    return {
        seed, years: YEARS, ms: Date.now() - t0,
        called: wars.length, fought: fought.length,
        outcomes: tally('outcome'), casus: tally('casus'),
        daysMedian: lens.length ? lens[Math.floor(lens.length / 2)] : null,
        daysMin: lens[0] || null, daysMax: lens[lens.length - 1] || null,
        towns: fought.reduce((s, w) => s + (w.gained || 0), 0),
        overlapDays, maxSameFoe, joint: wars.filter(w => w.joint).length,
        list: wars.map(w => `y${Math.floor(w.called / 120)} ${w.see} vs ${w.target} (${w.casus}): ${w.outcome || 'open'} ${w.to ? w.to - w.called : '-'}d, ${w.members || 0} crowns, ${w.gained || 0} towns${w.joint ? `, joint +${w.joint}` : ''}`),
    };
}

describe.skipIf(!ON)('holy wars over a century (probe)', () => {
    it('reports', () => {
        for (const seed of SEEDS) {
            const r = run(seed);
            process.stdout.write(`HWC ${JSON.stringify(r, null, 1)}\n`);
            expect(r.years).toBeGreaterThan(0);
        }
    }, 36000000);
});

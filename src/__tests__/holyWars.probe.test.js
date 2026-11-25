// A probe, not a spec: HW_PROBE=1 runs the playtest harness's day for some
// years on a seed and reports what the Church did (systems/holyWars.js,
// systems/inquisition.js): the sees and their coffers, holy wars called, who
// answered and what they took, the rulers cast out and lifted, the inquisitors'
// tallies, and the time HolyWars + Inquisition cost a day — the check that holy
// wars come now and then (not every year), bans stay rare and the inquisition
// does not empty the towns. HW_YEARS (default 10) and HW_SEEDS (default 101).
import { describe, it, expect, beforeAll } from 'vitest';
import { HolyWars } from '../systems/holyWars.js';
import { Inquisition } from '../systems/inquisition.js';
import { loadData, newGame, endDay, carryOn } from './playtest/harness.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.HW_PROBE;
const YEARS = Number(ENV.HW_YEARS) || 10;
const SEEDS = ENV.HW_SEEDS ? ENV.HW_SEEDS.split(',').map(Number) : [101];

beforeAll(async () => {
    if (ON) await loadData();
});

function run(seed) {
    const game = newGame(seed);
    game.timing = {};
    const bans = new Set();
    for (let i = 0; i < YEARS * 120; i++) {
        const res = endDay(game);
        if (res && res.died) carryOn(game, 'probe');
        for (const see of Object.values(HolyWars.state(game.world).sees)) for (const who of Object.keys(see.bans)) bans.add(`${see.key}:${who}`);
    }
    const st = HolyWars.state(game.world);
    const iq = Inquisition.state(game.world);
    const out = {
        seed, days: YEARS * 120, msPerDay: Math.round((((game.timing['HolyWars.processDay'] || 0) + (game.timing['Inquisition.processDay'] || 0)) / (YEARS * 120)) * 1000) / 1000,
        sees: Object.values(st.sees).map(s => `${HolyWars.headLabel(s)} @ ${s.town} (${Math.round(s.coffers)}g, ${Object.keys(s.bans).length} banned)`),
        wars: [...st.past, ...st.wars].map(w => `${w.name}: ${w.outcome || w.phase} [${(w.members || []).join(',')}] took ${(w.gained || []).join(', ') || 'nothing'}`),
        bansEver: bans.size,
        inquisitors: [...iq.list, ...iq.past].map(i => `${i.name} (${i.kingdomId}) tried ${i.tally.tried} burned ${i.tally.burned} seized ${i.tally.seized} coin ${Math.round(i.tally.coin || 0)}`),
        player: { cross: game.player.holyWars, summons: game.player.inquisition && game.player.inquisition.record },
    };
    return out;
}

describe.skipIf(!ON)('holy wars probe', () => {
    it('reports', () => {
        for (const seed of SEEDS) {
            const r = run(seed);
            console.warn(JSON.stringify(r, null, 1));
            expect(r.days).toBeGreaterThan(0);
        }
    }, 3600000);
});

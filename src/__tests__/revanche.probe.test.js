// A probe, not a spec: RV_PROBE=1 runs the world alone (the afterlife's world
// day, player/afterlife.js passDay) for RV_YEARS (default 40) on RV_SEEDS
// (default 101,202), once with revanche off and once on (world/revanche.js,
// data/kingship.json config.revanche.enabled), and reports the realms alive
// each decade, the wars declared (per realm a decade), the reclaim wars, the
// towns won back in the field and returned by a peace, and the claims standing
// at the end.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Afterlife } from '../player/afterlife.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Revanche } from '../world/revanche.js';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { loadData, WORLD_W, WORLD_H, GEN } from './playtest/harness.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.RV_PROBE;
const YEARS = Number(ENV.RV_YEARS) || 40;
const SEEDS = ENV.RV_SEEDS ? ENV.RV_SEEDS.split(',').map(Number) : [101, 202];
const MODES = ENV.RV_MODES ? ENV.RV_MODES.split(',').map(s => s === 'on') : [false, true];

beforeAll(async () => {
    if (!ON) return;
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function run(seed, on) {
    DataLoader.kingship.config.revanche.enabled = on;
    const tally = { wars: 0, reclaimWars: 0, wonBack: 0, returned: 0, capitalsLost: 0 };
    const sw = KingdomAI.startWar, tt = KingdomAI.takeTile, pr = KingdomAI.peaceReturn;
    KingdomAI.startWar = function (a, b, w) {
        const fresh = !(a.wars || []).includes(b.id);
        const r = sw.call(KingdomAI, a, b, w);
        if (fresh) { tally.wars++; if (a.warState && a.warState[b.id] && a.warState[b.id].reclaim) tally.reclaimWars++; }
        return r;
    };
    KingdomAI.takeTile = function (a, d, w, q, r) {
        const cap = d && d.capital && d.capital.q === q && d.capital.r === r && w.getTile(q, r) && w.getTile(q, r).settlement;
        const out = tt.call(KingdomAI, a, d, w, q, r);
        if (out.reclaimed) tally.wonBack++;
        if (out.town && cap) tally.capitalsLost++;
        return out;
    };
    KingdomAI.peaceReturn = function (...args) { const s = pr.apply(KingdomAI, args); if (s) tally.returned++; return s; };
    try {
        Utils.setSeed(seed);
        const world = new World(WORLD_W, WORLD_H);
        world.generate({ ...GEN });
        const alive = [];
        const t0 = Date.now();
        for (let i = 1; i <= YEARS * 120; i++) {
            Afterlife.passDay(world, null);
            if (i % 1200 === 0) alive.push(world.kingdoms.filter(k => k.isAlive).length);
        }
        const realms = world.kingdoms.length;
        const claims = world.kingdoms.filter(k => k.isAlive).flatMap(k => Revanche.claims(world, k).map(c => `${k.name}→${c.holder.name}: ${c.rec.name}${c.rec.capital ? ' (seat)' : ''} ${Math.round(c.w * 100) / 100}`));
        return {
            seed, revanche: on, ms: Date.now() - t0, realms, alive, ...tally,
            warsPerRealmDecade: Math.round(tally.wars / realms / (YEARS / 10) * 100) / 100,
            peaces: world.warHistorySeq || 0, claims,
        };
    } finally {
        KingdomAI.startWar = sw; KingdomAI.takeTile = tt; KingdomAI.peaceReturn = pr;
        DataLoader.kingship.config.revanche.enabled = true;
    }
}

describe.skipIf(!ON)('revanche (probe)', () => {
    it('reports', () => {
        const out = [];
        for (const seed of SEEDS) for (const on of MODES) {
            const r = run(seed, on);
            process.stdout.write(`${JSON.stringify(r)}\n`);
            out.push(r);
        }
        expect(out.length).toBeGreaterThan(0);
    }, 20000000);
});

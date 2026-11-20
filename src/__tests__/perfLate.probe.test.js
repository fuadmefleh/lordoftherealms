// A probe, not a spec: PERF_PROBE=1 (skipped otherwise). Late-game simulation cost
// measured on a saved state rather than re-running 85 years each time.
//   PERF_MAKE=1 PERF_YEARS=40,85 PERF_DIR=dir   plays seed 101 as the long soak does
//                                                 (bot + endDay, a save round trip every 20 years)
//                                                 and saves dir/save<year>.json at those years
//   PERF_LOAD=file PERF_DAYS=100 [PERF_WARM=10]  loads a save, plays PERF_DAYS bot days (after
//                                                 PERF_WARM), prints ms/day (wall, CPU) and the
//                                                 harness's per-step marks (PERF_TOP rows)
//   PERF_DIGEST=1   a hash of the world and player after the days: two trees (say HEAD's files
//                   and the working tree's) on the same save must print the same digest
//   PERF_CPU=1      a V8 CPU profile: top functions by self and inclusive time, with
//                   PERF_CALLERS=a,b (who calls them), PERF_CHILDREN=a,b (what they call),
//                   PERF_LINES=a,b (their hottest lines), PERF_CPUFILE=f (the raw profile)
//   PERF_WRAP=systems/townTrade.js:TownTrade,…  every method of those objects timed (inclusive, calls/day)
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import { loadData, newGame, endDay, roundTrip, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Terrain } from '../world/terrain.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { Relationships } from '../systems/relationships.js';
import { Ships } from '../systems/ships.js';
import { Titles } from '../systems/titles.js';
import { Espionage } from '../systems/espionage.js';
import { CoinCensus } from '../systems/coinCensus.js';

const ENV = process.env;
const ON = !!ENV.PERF_PROBE;
const DPY = 120;

beforeAll(async () => {
    if (!ON) return;
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
}, 120000);
const out = (s) => process.stdout.write(s + '\n');

function save(game, file) {
    const { world, player } = game;
    Relationships.prepareForSave(player);
    Espionage.prepareForSave(player);
    const extra = {};
    for (const [k, v] of Object.entries(game)) {
        if (['world', 'player', 'log', 'trace', 'timing', '_lastMark', 'moneyTrace'].includes(k)) continue;
        if (v instanceof Set || v instanceof Map || typeof v === 'function') continue;
        try { JSON.stringify(v); extra[k] = v; } catch (e) { /* skip */ }
    }
    fs.writeFileSync(file, JSON.stringify({ world: SaveLoad.serializeWorld(world), player: SaveLoad.serializePlayer(player), extra }));
}

function load(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const w2 = new World(data.world.width, data.world.height);
    w2.generate(data.world.generationParams || {});
    SaveLoad.restoreWorld(data.world, w2);
    Terrain.identifyRegions(w2.tiles, w2.width, w2.height);
    const p2 = new Player();
    SaveLoad.restorePlayer(data.player, p2, w2);
    p2.updateVisibility(w2, 4);
    MarketDynamics.initialize();
    SaveLoad.restoreMarkets(data.world, w2);
    Relationships.initialize(p2);
    Ships.restoreFromSave(p2);
    Titles.initialize(p2);
    return { ...data.extra, world: w2, player: p2, log: [] };
}

async function cpuProfile(fn, top = 45) {
    const inspector = await import('node:inspector');
    const session = new inspector.Session();
    session.connect();
    const post = (m, p) => new Promise((res, rej) => session.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 500 });
    await post('Profiler.start');
    await fn();
    const { profile } = await post('Profiler.stop');
    session.disconnect();
    if (ENV.PERF_CPUFILE) fs.writeFileSync(ENV.PERF_CPUFILE, JSON.stringify(profile));
    const dt = new Map();
    for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
    const byId = new Map(profile.nodes.map(nd => [nd.id, nd]));
    const parent = new Map();
    for (const nd of profile.nodes) for (const c of nd.children || []) parent.set(c, nd.id);
    const keyOf = nd => `${nd.callFrame.functionName || '(anon)'} ${String(nd.callFrame.url || '').replace(/^.*\/src\//, '')}:${nd.callFrame.lineNumber + 1}`;
    const self = new Map(), incl = new Map();
    for (const [id, t] of dt) {
        const k0 = keyOf(byId.get(id));
        self.set(k0, (self.get(k0) || 0) + t);
        const seen = new Set();
        for (let cur = id; cur != null; cur = parent.get(cur)) {
            const k = keyOf(byId.get(cur));
            if (seen.has(k)) continue;
            seen.add(k);
            incl.set(k, (incl.get(k) || 0) + t);
        }
    }
    const callers = [];
    for (const w of String(ENV.PERF_CALLERS || '').split(',').filter(Boolean)) {
        const by = new Map();
        for (const [id, t] of dt) {
            for (let cur = id; cur != null; cur = parent.get(cur)) {
                if (!keyOf(byId.get(cur)).startsWith(w + ' ')) continue;
                const pk = parent.has(cur) ? keyOf(byId.get(parent.get(cur))) : '-';
                by.set(pk, (by.get(pk) || 0) + t);
                break;
            }
        }
        callers.push(`-- callers of ${w} --`, ...[...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`));
    }
    // PERF_CHILDREN=a,b: the inclusive time of what a (any node of it) calls directly
    const inclOf = new Map();
    const inclNode = (nd) => {
        if (inclOf.has(nd.id)) return inclOf.get(nd.id);
        let t = dt.get(nd.id) || 0;
        for (const c of nd.children || []) t += inclNode(byId.get(c));
        inclOf.set(nd.id, t);
        return t;
    };
    for (const w of String(ENV.PERF_CHILDREN || '').split(',').filter(Boolean)) {
        const by = new Map();
        for (const nd of profile.nodes) {
            if (!keyOf(nd).startsWith(w + ' ')) continue;
            by.set('(self)', (by.get('(self)') || 0) + (dt.get(nd.id) || 0));
            for (const c of nd.children || []) { const cn = byId.get(c); const k = keyOf(cn); by.set(k, (by.get(k) || 0) + inclNode(cn)); }
        }
        callers.push(`-- children of ${w} --`, ...[...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`));
    }
    for (const w of String(ENV.PERF_LINES || '').split(',').filter(Boolean)) {
        const lines = new Map();
        for (const nd of profile.nodes) {
            if (!keyOf(nd).startsWith(w + ' ')) continue;
            for (const pt of nd.positionTicks || []) lines.set(pt.line, (lines.get(pt.line) || 0) + pt.ticks);
        }
        callers.push(`-- lines of ${w} (ticks) --`, ...[...lines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([l, t]) => `${String(t).padStart(7)}  line ${l}`));
    }
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    const fmt = ([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms ${((100 * us) / total).toFixed(1).padStart(5)}%  ${k}`;
    return ['-- self --', ...[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(fmt),
        '-- inclusive --', ...[...incl.entries()].filter(([k]) => !/vitest|node:|harness|perfLate|^\(root\)|^\(program\)/.test(k))
            .sort((a, b) => b[1] - a[1]).slice(0, top * 2).map(fmt), ...callers];
}

describe.skipIf(!ON)('late perf probe', () => {
    it.skipIf(!ENV.PERF_MAKE)('plays and saves', () => {
        const years = ENV.PERF_YEARS.split(',').map(Number);
        const dir = ENV.PERF_DIR;
        let game = newGame(101);
        const last = Math.max(...years);
        for (let i = 0; i < last * DPY; i++) {
            try { botDay(game, {}); } catch (e) { /* as the soak */ }
            let res = {};
            try { res = endDay(game) || {}; } catch (e) { /* as the soak */ }
            if (res.died) { const n = carryOn(game, res.died); if (!n.how) break; }
            if (i > 0 && i % (20 * DPY) === 0) game = roundTrip(game);
            if (years.includes((i + 1) / DPY)) {
                save(game, `${dir}/save${(i + 1) / DPY}.json`);
                out(`saved year ${(i + 1) / DPY} day ${game.world.day}`);
            }
        }
        expect(true).toBe(true);
    }, 6 * 3600 * 1000);

    it.skipIf(!ENV.PERF_LOAD)('loads and times', async () => {
        const days = Number(ENV.PERF_DAYS) || 100;
        const game = load(ENV.PERF_LOAD);
        Utils.setSeed(Number(ENV.PERF_SEED) || 4242);
        const c0 = CoinCensus.total(game.world, game.player).total;
        {
            let towns = 0, ppl = 0, live = 0;
            for (const v of game.world.getSettlementViews()) if (v.folk && Array.isArray(v.folk.people)) { towns++; ppl += v.folk.people.length; live += v.folk.people.filter(p => p.died == null && !p.away).length; }
            out(`[perf] rostered towns ${towns}, records ${ppl}, residents ${live}, views ${game.world.getSettlementViews().length}`);
        }
        // warm up
        const warm = Number(ENV.PERF_WARM) || 10;
        for (let i = 0; i < warm; i++) { try { botDay(game, {}); } catch (e) { /* */ } endDay(game); }
        game.timing = {};
        let hot = null;
        const t0 = performance.now();
        const c = process.cpuUsage();
        const run = async () => {
            for (let i = 0; i < days; i++) {
                try { botDay(game, {}); } catch (e) { /* */ }
                game._lastMark = performance.now();
                const r = endDay(game);
                if (r && r.died) { out('died ' + r.died); carryOn(game, r.died); }
            }
        };
        // PERF_WRAP=systems/townTrade.js:TownTrade,world/settlementMarket.js:SettlementMarket — every method timed (inclusive)
        const wrapT = new Map();
        for (const spec of String(ENV.PERF_WRAP || '').split(',').filter(Boolean)) {
            const [file, name] = spec.split(':');
            const mod = await import(/* @vite-ignore */ `../${file}`);
            const obj = mod[name];
            for (const k of Object.keys(obj)) {
                const fn = obj[k];
                if (typeof fn !== 'function') continue;
                const label = `${name}.${k}`;
                let depth = 0;
                obj[k] = function (...a) {
                    if (depth++ > 0) { try { return fn.apply(this, a); } finally { depth--; } }
                    const t0 = performance.now();
                    try { return fn.apply(this, a); } finally { depth--; const r = wrapT.get(label) || [0, 0]; r[0] += performance.now() - t0; r[1]++; wrapT.set(label, r); }
                };
            }
        }
        if (ENV.PERF_CPU) hot = await cpuProfile(run); else await run();
        if (wrapT.size) out([...wrapT.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 40).map(([k, [ms, n]]) => `  W ${(ms / days).toFixed(2).padStart(8)} ms/day ${String(Math.round(n / days)).padStart(7)}/day  ${k}`).join(String.fromCharCode(10)));
        const wall = (performance.now() - t0) / days;
        const cu = process.cpuUsage(c);
        const cpu = (cu.user + cu.system) / 1000 / days;
        out(`\n[perf] ${ENV.PERF_LOAD} ${days} days: ${wall.toFixed(1)} ms/day wall, ${cpu.toFixed(1)} cpu; day ${game.world.day}; coin ${Math.round(CoinCensus.total(game.world, game.player).total - c0)}`);
        const rows = Object.entries(game.timing).sort((a, b) => b[1] - a[1]).slice(0, Number(ENV.PERF_TOP) || 25);
        for (const [k, v] of rows) out(`  ${(v / days).toFixed(2).padStart(8)} ms/day  ${k}`);
        if (hot) out(hot.join('\n'));
        if (ENV.PERF_DIGEST) {
            const s = JSON.stringify({ w: SaveLoad.serializeWorld(game.world), p: SaveLoad.serializePlayer(game.player) });
            let h = 0x811c9dc5;
            for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
            out(`[perf] digest ${(h >>> 0).toString(16)} len ${s.length}`);
        }
    }, 3600000);
});

// A probe, not a spec: SKIP_PROBE=1 times long waits on a headless game —
// the living player's End Turn (playtest/harness.js endDay, as ui/timeSkip.js
// runs it day after day) and the interregnum's world-only days
// (player/afterlife.js passDay, as ui/actionMenu/afterlife.js runs them),
// day by day and as the distant years (passDay's opts.distant) — and prints
// ms/day (wall and CPU), the per-step costs, a digest of the world's state
// (same seed → same digest: SKIP_HASH compares two runs), and how far the
// distant years drift from the daily ones. Skipped otherwise.
//   SKIP_DAYS   living days (default 120)
//   SKIP_YEARS  afterlife years (default 10; a year is daysPerYear days)
//   SKIP_SEED   the world (default 777)
//   SKIP_STEPS=1  per-system ms/day (processDay / processTurn / … wrapped)
//   SKIP_CPU=1    a V8 CPU profile: top functions by self and inclusive time
//   SKIP_CALLERS=a,b  with SKIP_CPU: who calls the functions named a, b
//   SKIP_ONLY=living|afterlife|distant  run one part

import { describe, it, expect, beforeAll } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Afterlife } from '../player/afterlife.js';
import { Relationships } from '../systems/relationships.js';
import { Utils } from '../core/utils.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.SKIP_PROBE;
const DAYS = Number(ENV.SKIP_DAYS) || 120;
const YEARS = Number(ENV.SKIP_YEARS) || 10;
const SEED = Number(ENV.SKIP_SEED) || 777;
const CPU = !!ENV.SKIP_CPU;
const ONLY = ENV.SKIP_ONLY || '';
const part = (name) => !ONLY || ONLY.split(',').includes(name);

beforeAll(async () => {
    if (ON) await loadData();
}, 120000);

/** Wall and CPU milliseconds around fn. */
async function timed(fn) {
    const c0 = process.cpuUsage();
    const t0 = performance.now();
    await fn();
    const c = process.cpuUsage(c0);
    return { wall: performance.now() - t0, cpu: (c.user + c.system) / 1000 };
}

/** FNV-1a of a string → 8 hex digits. */
function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** The world in a few numbers (and a digest of more): towns, purses, stock, realms, units. */
function stateOf(world) {
    const views = world.getSettlementViews();
    let pop = 0, gold = 0, stock = 0, food = 0;
    const towns = [];
    for (const v of views) {
        const s = world.getTile(v.q, v.r).settlement;
        const e = s.economy || {};
        let st = 0;
        for (const x of Object.values((s.market && s.market.stock) || {})) st += x > 0 ? x : 0;
        pop += s.population || 0;
        gold += e.gold || 0;
        food += e.food || 0;
        stock += st;
        towns.push([v.q, v.r, s.population, Math.round((e.gold || 0) * 100), Math.round(st * 100), s.kingdom]);
    }
    const realms = (world.kingdoms || []).map(k => [k.id, k.isAlive, Math.round(k.treasury || 0), k.population, Math.round(k.military || 0), (k.wars || []).length]);
    const alive = realms.filter(k => k[1]).length;
    const treasury = realms.reduce((a, k) => a + k[2], 0);
    const units = (world.units || []).length;
    return {
        day: world.day, towns: views.length, pop, gold: Math.round(gold), food: Math.round(food), stock: Math.round(stock), alive, treasury, units,
        digest: fnv(JSON.stringify([world.day, towns, realms, units])),
    };
}

const fmtState = (s) => `day ${s.day}: ${s.towns} towns, ${s.pop} people, town purses ${s.gold}g, market stock ${s.stock}, granaries ${s.food}, ${s.alive} realms alive (treasuries ${s.treasury}g), ${s.units} units — digest ${s.digest}`;

/** A V8 CPU profile around fn → lines: top functions by self and inclusive time (and callers). */
async function cpuProfile(fn, top = 40) {
    if (!CPU) { await fn(); return null; }
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
    for (const w of String(ENV.SKIP_CALLERS || '').split(',').filter(Boolean)) {
        const by = new Map();
        for (const [id, t] of dt) {
            for (let cur = id; cur != null; cur = parent.get(cur)) {
                if (!keyOf(byId.get(cur)).startsWith(w + ' ')) continue;
                const pk = parent.has(cur) ? keyOf(byId.get(parent.get(cur))) : '-';
                by.set(pk, (by.get(pk) || 0) + t);
                break;
            }
        }
        callers.push(`-- callers of ${w} --`, ...[...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`));
    }
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    const fmt = ([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms ${((100 * us) / total).toFixed(1).padStart(5)}%  ${k}`;
    return ['-- self --', ...[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(fmt),
        '-- inclusive --', ...[...incl.entries()].filter(([k]) => !/vitest|node:|harness|skipSpeed|^\(root\)|^\(program\)/.test(k))
            .sort((a, b) => b[1] - a[1]).slice(0, top * 2).map(fmt), ...callers];
}

/**
 * Time every system's daily entry point (processDay / processTurn /
 * updatePrices …) on the objects the systems, world and player modules
 * export, inclusive. → { report(days), restore() }
 */
async function stepTimer() {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(process.cwd(), 'src');
    const names = /^(processDay|processDaily|processTurn|updatePrices|processUnits|advanceDay|_advanceDay|processWars|processRestorations|processTimedEvents|generateEvents|processLordActions|daily|syncCamps|sync|ageChildren|processAging|processDailyEvents|syncFolk|prepareForSave|updateEconomy|updateMilitary|updateFleet|considerWar|tryExpand|establishRoutes)$/;
    const t = new Map();
    const undo = [];
    for (const dir of ['systems', 'world', 'player']) {
        for (const f of fs.readdirSync(path.join(root, dir))) {
            if (!f.endsWith('.js')) continue;
            let mod;
            try { mod = await import(/* @vite-ignore */ `../${dir}/${f}`); } catch (e) { continue; }
            for (const [ex, obj] of Object.entries(mod)) {
                if (!obj || typeof obj !== 'object') continue;
                for (const k of Object.keys(obj)) {
                    if (!names.test(k) || typeof obj[k] !== 'function' || obj[k]._timed) continue;
                    const fn = obj[k];
                    const label = `${ex}.${k}`;
                    const w = function (...a) {
                        const t0 = performance.now();
                        try { return fn.apply(this, a); } finally { t.set(label, (t.get(label) || 0) + performance.now() - t0); }
                    };
                    w._timed = true;
                    obj[k] = w;
                    undo.push(() => { obj[k] = fn; });
                }
            }
        }
    }
    return {
        report(days) {
            return [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, ms]) => `${(ms / days).toFixed(2).padStart(8)} ms/day  ${k}`);
        },
        restore() { for (const u of undo) u(); },
    };
}

/** A game whose player has died and let time pass (the interregnum), on `seed`. */
function interregnum(seed) {
    const game = newGame(seed);
    for (let i = 0; i < 30; i++) endDay(game);
    Afterlife.begin(game.player, game.world, 'probe');
    // (the afterlife's days from here on draw from a stream of their own seed, so two runs line up)
    Utils.setSeed(seed * 31 + 7);
    return game;
}

/** Let `days` pass in the interregnum → { wall, cpu, state }. */
async function wait(game, days, distant) {
    let hot = null;
    const t = await timed(async () => {
        hot = await cpuProfile(async () => {
            for (let i = 0; i < days; i++) Afterlife.passDay(game.world, game.player, { distant });
        });
    });
    return { ...t, state: stateOf(game.world), hot };
}

describe.skipIf(!ON)('skip speed probe', () => {
    it.skipIf(!part('living'))('times the living daily turn', async () => {
        const game = newGame(SEED);
        game.timing = {};
        let died = null;
        let ran = 0;
        const steps = ENV.SKIP_STEPS ? await stepTimer() : null;
        let hot = null;
        const t = await timed(async () => {
            hot = await cpuProfile(async () => {
                for (let i = 0; i < DAYS; i++) {
                    // (fed and rested, as a wait the body doesn't cut short)
                    const pl = game.player;
                    pl.needs = { ...(pl.needs || {}), hunger: 100, energy: 100 };
                    pl.starvationDays = 0;
                    pl.health = Math.max(pl.health || 0, pl.maxHealth || 100);
                    pl.inventory = pl.inventory || {};
                    if ((pl.inventory.bread || 0) < 5) pl.inventory.bread = 10;
                    game._lastMark = performance.now();
                    const r = endDay(game);
                    ran++;
                    if (r && r.died) { died = r.died; break; }
                }
            });
        });
        if (steps) steps.restore();
        console.log(`\n[skip probe] living: ${ran} days, ${(t.wall / ran).toFixed(1)} ms/day wall, ${(t.cpu / ran).toFixed(1)} ms/day CPU${died ? ` (died: ${died})` : ''}`);
        console.log(`[skip probe] living ${fmtState(stateOf(game.world))}`);
        const rows = Object.entries(game.timing).sort((a, b) => b[1] - a[1]).slice(0, 25);
        for (const [k, v] of rows) console.log(`  ${(v / ran).toFixed(2).padStart(8)} ms/day  ${k}`);
        if (steps) console.log(steps.report(ran).join('\n'));
        if (hot) console.log(hot.join('\n'));
        expect(ran).toBeGreaterThan(0);
    }, 3600000);

    it.skipIf(!part('afterlife'))('times a long afterlife wait, day by day', async () => {
        const Y = Relationships._getHeirSettings().daysPerYear || 120;
        const days = YEARS * Y;
        const game = interregnum(SEED + 1);
        const steps = ENV.SKIP_STEPS ? await stepTimer() : null;
        const r = await wait(game, days, false);
        if (steps) steps.restore();
        console.log(`\n[skip probe] afterlife (daily): ${YEARS} years (${days} days) in ${(r.wall / 1000).toFixed(1)} s wall, ${(r.cpu / 1000).toFixed(1)} s CPU = ${(r.wall / days).toFixed(1)} ms/day`);
        console.log(`[skip probe] afterlife (daily) ${fmtState(r.state)}`);
        if (steps) console.log(steps.report(days).join('\n'));
        if (r.hot) console.log(r.hot.join('\n'));
        expect(game.world.day).toBeGreaterThan(days);
    }, 3600000);

    it.skipIf(!part('distant'))('times the same wait as the distant years, twice (same seed, same years)', async () => {
        const Y = Relationships._getHeirSettings().daysPerYear || 120;
        const days = YEARS * Y;
        const game = interregnum(SEED + 1);
        const steps = ENV.SKIP_STEPS ? await stepTimer() : null;
        const r = await wait(game, days, true);
        if (steps) steps.restore();
        console.log(`\n[skip probe] afterlife (distant): ${YEARS} years (${days} days) in ${(r.wall / 1000).toFixed(1)} s wall, ${(r.cpu / 1000).toFixed(1)} s CPU = ${(r.wall / days).toFixed(1)} ms/day`);
        console.log(`[skip probe] afterlife (distant) ${fmtState(r.state)}`);
        if (steps) console.log(steps.report(days).join('\n'));
        if (r.hot) console.log(r.hot.join('\n'));
        expect(game.world._distant).toBeUndefined();
        // Determinism: the same seed's first year again, distant, gives the same digest
        // (one after the other: the RNG stream is the game's, Utils's one stream)
        const ra = await wait(interregnum(SEED + 2), Y, true);
        const rb = await wait(interregnum(SEED + 2), Y, true);
        console.log(`[skip probe] distant determinism: ${ra.state.digest} vs ${rb.state.digest}`);
        expect(ra.state.digest).toBe(rb.state.digest);
    }, 3600000);
});

// A probe, not a spec: RL_PROBE=1 runs the world alone (the afterlife's world
// day, player/afterlife.js passDay) for RL_YEARS (default 30) on RL_SEEDS
// (default 101,202), once with the leagues against AI realms off and once on
// (systems/coalitions.js processRealms), and reports the realms alive each
// decade and every league: its target, members, how it ended.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Afterlife } from '../player/afterlife.js';
import { Coalitions } from '../systems/coalitions.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { loadData, WORLD_W, WORLD_H, GEN } from './playtest/harness.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.RL_PROBE;
const YEARS = Number(ENV.RL_YEARS) || 30;
const SEEDS = ENV.RL_SEEDS ? ENV.RL_SEEDS.split(',').map(Number) : [101, 202];

beforeAll(async () => {
    if (!ON) return;
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function run(seed, leagues) {
    Coalitions.config().realms.enabled = leagues;
    Utils.setSeed(seed);
    const world = new World(WORLD_W, WORLD_H);
    world.generate({ ...GEN });
    const alive = [];
    const t0 = Date.now();
    for (let i = 1; i <= YEARS * 120; i++) {
        Afterlife.passDay(world, null);
        if (i % 1200 === 0) alive.push(world.kingdoms.filter(k => k.isAlive).length);
    }
    const st = world.realmLeagues ? Coalitions.realmsState(world) : null;
    return {
        seed, leagues, ms: Date.now() - t0, start: world.kingdoms.length, alive,
        wars: (world.warHistory || []).length,
        stats: st ? st.stats : null,
        survived: world.kingdoms.filter(k => k.isAlive).map(k => k.name).length,
        list: st ? [...st.active.map(l => ({ ...l, how: 'standing' })), ...st.history].map(l => `y${Math.floor(l.formed / 120)} ${l.name} vs ${l.targetName}: ${l.members.length || Object.keys(l.members || {}).length} members, ${l.answer || '-'} -> ${l.how}${l.activeDay != null ? ' (marched)' : ''}${l.bought ? ` bought ${l.bought}` : ''}${l.terms ? ` terms ${l.terms.gold}/${l.terms.asked || '?'}g ${l.terms.prestige}p` : ''}${l.weighed ? ` weighed ${JSON.stringify(l.weighed)}` : ''}${l.yielded ? ` yielded ${l.yielded.town} to ${l.yielded.to}` : ''}`) : [],
    };
}

describe.skipIf(!ON)('leagues against AI realms (probe)', () => {
    it('reports', () => {
        const out = [];
        for (const seed of SEEDS) for (const on of (ENV.RL_ON_ONLY ? [true] : [false, true])) out.push(run(seed, on));
        Coalitions.config().realms.enabled = true;
        process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
        expect(out.length).toBeGreaterThan(0);
    }, 20000000);
});

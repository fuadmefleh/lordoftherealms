// A probe, not a spec: RU_CENTURY=1 runs the world alone (no player: the
// afterlife's world day, player/afterlife.js passDay) for RU_YEARS (default
// 100) on RU_SEEDS (default 101,202,303) and tallies the AI personal unions
// (systems/realmUnions.js): how many form and how (a marriage, an
// inheritance), how long they last, how they end, how often the seat moves,
// the royal children born to spouses of two realms, and two checks — married
// reigning rulers of one sex, and a realm's shown ruler apart from its record.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { RealmUnions } from '../systems/realmUnions.js';
import { Characters } from '../world/characters.js';
import { Afterlife } from '../player/afterlife.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { loadData, WORLD_W, WORLD_H, GEN } from './playtest/harness.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.RU_CENTURY;
const YEARS = Number(ENV.RU_YEARS) || 100;
const SEEDS = ENV.RU_SEEDS ? ENV.RU_SEEDS.split(',').map(Number) : [101, 202, 303];

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
    const births = { cross: 0, inUnion: 0, all: 0 };
    const orig = Characters._birthChild;
    const spy = vi.spyOn(Characters, '_birthChild').mockImplementation(function (kingdom, p1, p2, w, other) {
        births.all++;
        if (other) {
            births.cross++;
            if (kingdom.personalUnion && String(kingdom.personalUnion.partnerId) === String(other.id)) births.inUnion++;
        }
        return orig.call(Characters, kingdom, p1, p2, w, other);
    });
    const seen = new Map();
    let sameSex = 0;
    let drift = 0;
    let crossCouples = 0;
    const t0 = Date.now();
    try {
        for (let i = 0; i < YEARS * 120; i++) {
            Afterlife.passDay(world, null);
            for (const h of RealmUnions.history(world)) seen.set(h.id, JSON.parse(JSON.stringify(h)));
            if (world.day % 30 !== 0) continue;
            const live = world.kingdoms.filter(k => k && k.isAlive && k.characterData && k.characterData.ruler);
            for (const k of live) {
                const r = k.characterData.ruler;
                const pu = k.personalUnion;
                if (!(pu && pu.role === 'junior') && !r.isPlayer && k.ruler !== Characters.getDisplayName(r, k)) drift++;
                if (r.spouseId == null) continue;
                const o = live.find(x => x !== k && x.characterData.ruler.id === r.spouseId);
                if (!o) continue;
                if (String(k.id) < String(o.id)) crossCouples++;
                if (o.characterData.ruler.gender === r.gender) sameSex++;
            }
        }
    } finally {
        spy.mockRestore();
    }
    const unions = [...seen.values()];
    const end = world.day;
    return {
        seed, years: YEARS, ms: Date.now() - t0,
        formed: unions.length,
        byHow: unions.reduce((o, u) => { o[u.how] = (o[u.how] || 0) + 1; return o; }, {}),
        ends: unions.reduce((o, u) => { const e = u.end || 'standing'; o[e] = (o[e] || 0) + 1; return o; }, {}),
        crossBirths: births.cross, crossBirthsInUnion: births.inUnion, royalBirths: births.all,
        crossCoupleMonths: crossCouples, sameSexRulerPairs: sameSex, nameDriftChecks: drift,
        list: unions.map(u => `y${Math.floor(u.from / 120)} ${u.senior.name} + ${u.junior.name} (${u.how}): ${u.end || 'standing'} after ${((u.to != null ? u.to : end) - u.from)}d; monarchs ${(u.monarchs || [u.monarch]).join(' → ')}${u.seatMoved ? `; seat moved ${u.seatMoved}x` : ''}`),
    };
}

describe.skipIf(!ON)('realm unions over a century (probe)', () => {
    it('reports', () => {
        for (const seed of SEEDS) {
            const r = run(seed);
            process.stdout.write(`RUC ${JSON.stringify(r, null, 1)}\n`);
            expect(r.years).toBeGreaterThan(0);
        }
    }, 36000000);
});

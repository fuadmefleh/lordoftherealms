// Worlds since terrainGen 16 (world/townSiting.js, data/kingdoms.json `siting`): capitals,
// their first towns and the free villages stand where real towns grow — on rivers, at river
// mouths, confluences and lake shores, on sheltered coasts, on good farmland, some by ore
// fields — and not in swamp, waterless desert or the frozen north. Older worlds keep every
// settlement exactly where it was (their saves regenerate from the seed).

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { TownSiting } from '../world/townSiting.js';

const SEEDS = [4711, 1234, 31337];
const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'lake', 'sea']);
const make = (gen, seed) => {
    const w = new World(120, 80);
    w.generate({ seed, kingdomCount: 6, terrainGen: gen, riverCount: 40 });
    return w;
};
const fingerprint = (w) => Utils.hashStr(w.getAllSettlements()
    .map(x => `${x.type}@${x.q},${x.r}:${x.name}:${x.kingdom}`).sort().join('|'));

// What a settlement stands on, judged from the map alone (not from TownSiting)
const look = (w) => {
    const at = (q, r) => (r < 0 || r >= w.height ? null : w.tiles[r][Hex.wrapQ(q, w.width)]);
    const nb = (t) => Hex.neighbors(t.q, t.r).map(n => at(n.q, n.r)).filter(Boolean);
    const isLake = (t) => WATER.has(t.terrain.id) && (t.terrain.id === 'lake' || t._lake || t.waterBodyType === 'lake');
    const isSea = (t) => WATER.has(t.terrain.id) && !isLake(t);
    return w.getAllSettlements().map(s => {
        const t = at(s.q, s.r);
        const ns = nb(t);
        const wet = !!t.hasRiver || ns.some(n => n.hasRiver || WATER.has(n.terrain.id));
        const inflow = ns.filter(n => {
            if (!n.hasRiver || !Number.isInteger(n.riverDir) || n.riverDir < 0) return false;
            const d = Hex.neighbors(n.q, n.r)[n.riverDir];
            return at(d.q, d.r) === t;
        }).length;
        const id = t.terrain.id;
        return {
            ...s, t, wet,
            prime: (t.hasRiver && ns.some(isSea)) || (t.hasRiver && inflow >= 2) || ns.some(isLake),
            bad: ['swamp', 'snow', 'ice', 'tundra'].includes(id) || (id === 'desert' && !wet),
        };
    });
};

let w15 = {};
let w16 = {};
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    for (const seed of SEEDS) {
        w15[seed] = make(15, seed);
        w16[seed] = make(16, seed);
    }
}, 600000);

const all = (ws) => SEEDS.flatMap(s => look(ws[s]));
const share = (list, f) => list.filter(f).length / list.length;

describe('Town siting (terrainGen 16)', () => {
    it('keeps every gen-15 settlement exactly where it was', () => {
        // fingerprints taken from the code before townSiting existed
        expect(fingerprint(w15[4711])).toBe(31724402);
        expect(fingerprint(w15[1234])).toBe(1597850082);
        expect(fingerprint(w15[31337])).toBe(402057148);
    });

    it('puts more settlements on or beside a river, lake or coast', () => {
        const a = share(all(w15), s => s.wet);
        const b = share(all(w16), s => s.wet);
        expect(b).toBeGreaterThan(a + 0.15);
        expect(b).toBeGreaterThan(0.75);
    });

    it('seats more capitals at river mouths, confluences and lake shores', () => {
        const caps = (ws) => all(ws).filter(s => s.type === 'capital');
        expect(caps(w16).filter(s => s.prime).length).toBeGreaterThan(caps(w15).filter(s => s.prime).length + 2);
        expect(share(caps(w16), s => s.wet)).toBeGreaterThan(share(caps(w15), s => s.wet));
    });

    it('keeps out of swamp, waterless desert and the frozen north', () => {
        const bad15 = all(w15).filter(s => s.bad).length;
        const bad16 = all(w16).filter(s => s.bad).length;
        expect(bad15).toBeGreaterThan(0);
        expect(bad16).toBeLessThan(bad15);
        expect(bad16).toBeLessThanOrEqual(1);
    });

    it('gives capitals one of the best sites of their realm', () => {
        for (const seed of SEEDS) {
            const w = w16[seed];
            const site = TownSiting.map(w.tiles, w.width, w.height);
            for (const k of w.kingdoms) {
                const scores = k.territory.map(h => site.score(h.q, h.r, 'capital')).filter(Number.isFinite).sort((a, b) => b - a);
                const mine = site.score(k.capital.q, k.capital.r, 'capital');
                // in the top fifth of its own land
                expect(mine).toBeGreaterThanOrEqual(scores[Math.floor(scores.length * 0.2)]);
            }
        }
    });

    it('makes some towns, not all, mining towns', () => {
        const nearOre = (w, s) => Hex.hexesInRange(s.q, s.r, 2).some(h => {
            const t = h.r >= 0 && h.r < w.height ? w.tiles[h.r][Hex.wrapQ(h.q, w.width)] : null;
            return t && t.ores && Object.values(t.ores).some(v => v > 0.3);
        });
        const list = SEEDS.flatMap(seed => w16[seed].getAllSettlements().map(s => nearOre(w16[seed], s)));
        const f = list.filter(Boolean).length / list.length;
        expect(f).toBeGreaterThan(0.1);
        expect(f).toBeLessThan(0.75);
    });

    it('keeps the spacing rules and about the same counts', () => {
        for (const ws of [w15, w16]) {
            for (const seed of SEEDS) {
                const w = ws[seed];
                const S = w.getAllSettlements();
                const d = (a, b) => Hex.wrappingDistance(a.q, a.r, b.q, b.r, w.width);
                const caps = S.filter(s => s.type === 'capital');
                for (const a of caps) for (const b of caps) if (a !== b) expect(d(a, b)).toBeGreaterThanOrEqual(12);
                for (const v of S.filter(s => s.type === 'village')) {
                    for (const o of S) if (o !== v) expect(d(v, o)).toBeGreaterThanOrEqual(4);
                }
                const towns = S.filter(s => s.type === 'town');
                for (const t of towns) {
                    for (const o of towns) if (o !== t) expect(d(t, o)).toBeGreaterThanOrEqual(3);
                    const cap = caps.find(c => c.kingdom === t.kingdom);
                    expect(d(t, cap)).toBeGreaterThanOrEqual(3);
                }
            }
        }
        for (const seed of SEEDS) {
            expect(w16[seed].kingdoms.length).toBe(6);
            const n15 = w15[seed].getAllSettlements().length;
            const n16 = w16[seed].getAllSettlements().length;
            expect(Math.abs(n16 - n15)).toBeLessThanOrEqual(Math.ceil(n15 * 0.35));
        }
    });

    it('is deterministic', () => {
        expect(fingerprint(make(16, 4711))).toBe(fingerprint(w16[4711]));
    });
});

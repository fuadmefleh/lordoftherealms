// Worlds since terrainGen 17 (Terrain._fishingGrounds17, data/terrain.json fishingGrounds): fish
// follow the sea as ore follows the rock. Every sea hex carries tile.fishing (0..1): rich on the
// shallow shelves, where the currents run over them or two streams meet, off the river mouths and
// deltas, in cold water; poor in the deep open ocean and small enclosed seas. Fish map resources
// lie only on the grounds, coastal towns land fish by the grounds off them (SettlementMarket
// landProfile/production) and fisheries work the richer grounds (Hinterland). Gen 16 unchanged.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { World } from '../world/world.js';
import { Terrain } from '../world/terrain.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Hinterland } from '../world/hinterland.js';

const SEA = new Set(['coast', 'sea', 'ocean', 'deep_ocean']);
const isSea = (t) => !!(t && t.terrain && SEA.has(t.terrain.id) && !t._lake);
const make = (gen, seed) => {
    const w = new World(120, 80);
    w.generate({ seed, kingdomCount: 6, terrainGen: gen, riverCount: 40 });
    return w;
};
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const nb = (w, t) => Hex.neighbors(t.q, t.r).map(n => (n.r < 0 || n.r >= w.height ? null : w.getTile(Hex.wrapQ(n.q, w.width), n.r)));

/** Each sea hex's distance from land over the water. */
function landDist(w) {
    const d = new Map();
    const q = [];
    for (const t of w.tiles.flat()) {
        if (isSea(t) && nb(w, t).some(n => n && !isSea(n) && n.terrain.id !== 'lake')) { d.set(t, 1); q.push(t); }
    }
    for (let i = 0; i < q.length; i++) {
        for (const n of nb(w, q[i])) {
            if (!isSea(n) || d.has(n)) continue;
            d.set(n, d.get(q[i]) + 1);
            q.push(n);
        }
    }
    return d;
}

const SEEDS = [4711, 99];
let w16, w17s, dists;
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    w16 = make(16, 4711);
    w17s = SEEDS.map(s => make(17, s));
    dists = w17s.map(landDist);
});

describe('Fishing grounds (terrainGen 17)', () => {
    it('marks every hex with a strength 0..1, grounds only in the sea', () => {
        for (const w of w17s) {
            for (const t of w.tiles.flat()) {
                expect(typeof t.fishing).toBe('number');
                expect(t.fishing).toBeGreaterThanOrEqual(0);
                expect(t.fishing).toBeLessThanOrEqual(1);
                if (!isSea(t)) expect(t.fishing).toBe(0);
            }
            const grounds = w.tiles.flat().filter(t => t.fishing > 0);
            expect(grounds.length).toBeGreaterThan(300);
            expect(grounds.filter(t => t.fishing >= 0.6).length).toBeGreaterThan(20);
        }
    });

    it('lies on the shelves: near-shore water is rich, the deep open ocean poor', () => {
        w17s.forEach((w, i) => {
            const d = dists[i];
            const shelf = [...d].filter(([t, k]) => k <= 2).map(([t]) => t.fishing);
            const open = [...d].filter(([t, k]) => k > 6 && t.terrain.id === 'deep_ocean').map(([t]) => t.fishing);
            expect(open.length).toBeGreaterThan(500);
            expect(mean(shelf)).toBeGreaterThan(0.3);
            expect(mean(open)).toBeLessThan(0.02);
            // nearly all of the open deep is no ground at all
            expect(open.filter(v => v > 0).length / open.length).toBeLessThan(0.02);
        });
    });

    it('clusters: a ground hex mostly has ground beside it', () => {
        for (const w of w17s) {
            const g = w.tiles.flat().filter(t => t.fishing >= 0.3);
            const with2 = g.filter(t => nb(w, t).filter(n => n && n.fishing >= 0.15).length >= 2).length;
            expect(with2 / g.length).toBeGreaterThan(0.85);
        }
    });

    it('is richer off river mouths and in cold water, at the same distance from land', () => {
        const mouthNear = [], mouthFar = [], cold = [], warm = [];
        w17s.forEach((w, i) => {
            const d = dists[i];
            const mouths = [];
            for (const t of w.tiles.flat()) {
                if (!t.hasRiver || !Number.isInteger(t.riverDir)) continue;
                const o = nb(w, t)[t.riverDir];
                if (isSea(o)) mouths.push(o);
            }
            expect(mouths.length).toBeGreaterThan(3);
            for (const [t, k] of d) {
                if (k > 2) continue;
                const near = mouths.some(m => Hex.wrappingDistance(m.q, m.r, t.q, t.r, w.width) <= 1);
                (near ? mouthNear : mouthFar).push(t.fishing);
                if (t.temperature <= 0.3) cold.push(t.fishing);
                else if (t.temperature >= 0.75) warm.push(t.fishing);
            }
        });
        expect(mean(mouthNear)).toBeGreaterThan(mean(mouthFar) + 0.08);
        expect(cold.length).toBeGreaterThan(30);
        expect(warm.length).toBeGreaterThan(30);
        expect(mean(cold)).toBeGreaterThan(mean(warm) * 1.3);
    });

    it('is richer where two currents meet', () => {
        const cfg = DataLoader._gamedata.currents;
        const edges = cfg.bands.slice(0, -1).map(b => b.to);
        const inBand = [], outBand = [];
        w17s.forEach((w, i) => {
            for (const [t, k] of dists[i]) {
                if (k > 3) continue;
                const lat = Math.abs((t.r / (w.height - 1)) * 2 - 1);
                const e = Math.min(...edges.map(x => Math.abs(lat - x)));
                if (e <= 0.03) inBand.push(t.fishing);
                else if (e >= 0.1 && Math.abs(lat - 0.5) < 0.35) outBand.push(t.fishing);
            }
        });
        expect(inBand.length).toBeGreaterThan(20);
        expect(mean(inBand)).toBeGreaterThan(mean(outBand));
    });

    it('lays fish map resources only on or beside the grounds (lakes keep theirs)', () => {
        const minGround = (Terrain.FISHING_GROUNDS && Terrain.FISHING_GROUNDS.minGround) || 0.05;
        for (const w of w17s) {
            const fish = w.tiles.flat().filter(t => t.resource && t.resource.id === 'fish');
            const seaFish = fish.filter(t => isSea(t) || t.terrain.id === 'island');
            expect(seaFish.length).toBeGreaterThan(50);
            for (const t of seaFish) {
                const k = Math.max(t.fishing, ...nb(w, t).map(n => (n ? n.fishing * 0.7 : 0)));
                expect(k).toBeGreaterThanOrEqual(minGround - 1e-9);
            }
            expect(seaFish.filter(t => t.terrain.id === 'deep_ocean').length).toBeLessThan(5);
            // richer grounds hold fish banks far more often
            const rich = w.tiles.flat().filter(t => isSea(t) && t.fishing >= 0.6);
            const poor = w.tiles.flat().filter(t => isSea(t) && t.fishing > 0 && t.fishing < 0.2);
            const share = (a) => a.filter(t => t.resource && t.resource.id === 'fish').length / a.length;
            expect(share(rich)).toBeGreaterThan(share(poor) * 1.8);
        }
        // lakes still have fish
        const lakeFish = w17s.flatMap(w => w.tiles.flat().filter(t => t.terrain.id === 'lake' && t.resource && t.resource.id === 'fish'));
        expect(lakeFish.length).toBeGreaterThan(0);
    });

    it('feeds coastal towns by the grounds off them', () => {
        const town = { type: 'town', population: 3000 };
        const bd = { food: 33, items: {} };
        const rows = [];
        for (const w of w17s) {
            for (const s of w.getSettlementViews()) {
                const land = SettlementMarket.landProfile(w, s.q, s.r);
                if (!(land.seaShare > 0.15)) continue;
                const out = SettlementMarket.production(town, land, bd, 33);
                rows.push({ k: land.fishing, fish: out.fish || 0, sea: land.seaShare });
            }
        }
        rows.sort((a, b) => a.k - b.k);
        expect(rows.length).toBeGreaterThan(8);
        const q = Math.max(2, Math.floor(rows.length / 4));
        const poor = rows.slice(0, q), rich = rows.slice(-q);
        // per share of sea, a town on rich grounds lands far more fish
        const per = (a) => mean(a.map(r => r.fish / r.sea));
        expect(mean(rich.map(r => r.k))).toBeGreaterThan(mean(poor.map(r => r.k)) + 0.2);
        expect(per(rich)).toBeGreaterThan(per(poor) * 1.4);

        // the same town on the same coast: rich grounds against barren ones
        const coast = { shares: { water: 0.5 }, fertility: 1, river: false, resources: [], temp: 0.5, seaShare: 0.5 };
        const a = SettlementMarket.production(town, { ...coast, fishing: 0.9 }, bd, 33).fish;
        const b = SettlementMarket.production(town, { ...coast, fishing: 0.05 }, bd, 33).fish;
        const old = SettlementMarket.production(town, coast, bd, 33).fish;
        expect(a).toBeGreaterThan(b * 2);
        expect(old).toBeGreaterThan(b);
        expect(old).toBeLessThan(a);
    });

    it('has fisheries work the richer grounds and land more there', () => {
        const w = w17s[0];
        const rich = w.tiles.flat().find(t => isSea(t) && t.fishing >= 0.8);
        const poor = w.tiles.flat().find(t => isSea(t) && t.fishing === 0 && nb(w, t).every(n => !n || n.fishing === 0));
        expect(rich && poor).toBeTruthy();
        const fr = Hinterland.groundFactor(w, { kind: 'fishery', q: rich.q, r: rich.r });
        const fp = Hinterland.groundFactor(w, { kind: 'fishery', q: poor.q, r: poor.r });
        expect(fr).toBeGreaterThan(fp * 2);
        expect(Hinterland.groundFactor(w, { kind: 'quarry', q: rich.q, r: rich.r })).toBe(1);
        // the fisheries the towns work lie on grounds
        const st = Hinterland.state(w);
        if (!st.derived) Hinterland.derive(w);
        const fisheries = Hinterland.state(w).sites.filter(s => s.kind === 'fishery');
        if (fisheries.length) {
            expect(mean(fisheries.map(s => Hinterland.groundOf(w, s.q, s.r)))).toBeGreaterThan(0.3);
        }
    });

    it('is deterministic for a seed', () => {
        const again = make(17, SEEDS[0]);
        const a = w17s[0].tiles.flat(), b = again.tiles.flat();
        for (let i = 0; i < a.length; i++) {
            expect(b[i].fishing).toBe(a[i].fishing);
            expect(b[i].resource && b[i].resource.id).toBe(a[i].resource && a[i].resource.id);
        }
    });
});

describe('Older worlds (terrainGen 16) keep their fish', () => {
    it('carries no fishing grounds and the old supply', () => {
        expect(w16.tiles.flat().some(t => 'fishing' in t)).toBe(false);
        const s = w16.getSettlementViews()[0];
        const land = SettlementMarket.landProfile(w16, s.q, s.r);
        expect('fishing' in land).toBe(false);
        expect('seaShare' in land).toBe(false);
        // fish banks still lie by the old chances, out in the deep too
        const fish = w16.tiles.flat().filter(t => t.resource && t.resource.id === 'fish');
        expect(fish.length).toBeGreaterThan(50);
        const site = { kind: 'fishery', q: fish[0].q, r: fish[0].r };
        expect(Hinterland.groundFactor(w16, site)).toBe(1);
    });
});

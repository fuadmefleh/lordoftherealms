// Worlds since terrainGen 16 (Terrain._fjords16, Terrain._shores16, data/terrain.json coasts):
// coasts with character. Cold high coasts are cut by a few narrow winding fjords of
// navigable coastal water; low warm shores get patchy runs of beach while steep coasts
// stay rocky; a few one-hex skerries lie off the rocky shores. Older worlds are untouched.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Terrain } from '../world/terrain.js';
import { World } from '../world/world.js';

const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'lake', 'sea']);
const HIGH = new Set(['hills', 'highlands', 'mountain', 'snow_peak']);
const SEEDS = [4711, 1234, 2024];
const make = (gen, seed) => {
    const w = new World(120, 80);
    w.generate({ seed, kingdomCount: 6, terrainGen: gen, riverCount: 40 });
    return w;
};
const at = (w, q, r) => (r < 0 || r >= w.height) ? null : w.tiles[r][Hex.wrapQ(q, w.width)];
const nbrs = (w, t) => Hex.neighbors(t.q, t.r).map(n => at(w, n.q, n.r)).filter(Boolean);
const lat = (w, t) => Math.abs((t.r / (w.height - 1)) - 0.5) * 2;
const landCount = (w) => w.tiles.flat().filter(t => !WATER.has(t.terrain.id)).length;

const worlds = {};
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    for (const seed of SEEDS) worlds[seed] = { 15: make(15, seed), 16: make(16, seed) };
}, 120000);

describe('Fjords (terrainGen 16)', () => {
    it('cuts a few fjords into cold high coasts, none toward the equator', () => {
        const minLat = Terrain._coastCfg().fjords.minLatitude;
        for (const seed of SEEDS) {
            const w = worlds[seed][16];
            const fj = w.tiles.flat().filter(t => t._fjord);
            expect(fj.length).toBeGreaterThanOrEqual(3);
            expect(fj.length).toBeLessThan(80);
            for (const t of fj) expect(lat(w, t)).toBeGreaterThanOrEqual(minLat);
            // flanked by high ground: most fjord hexes have hills or higher beside them
            const flanked = fj.filter(t => nbrs(w, t).filter(o => HIGH.has(o.terrain.id)).length >= 2).length;
            expect(flanked / fj.length).toBeGreaterThan(0.7);
        }
    });

    it('fills them with navigable coastal water joined to the open sea', () => {
        for (const seed of SEEDS) {
            const w = worlds[seed][16];
            for (const t of w.tiles.flat().filter(o => o._fjord)) {
                expect(t.terrain.id).toBe('coast');
                expect(t.waterBodyType).toBe('ocean');
                expect(t.hasRiver).toBe(false);
                // walk the water out of it: it reaches deep water
                const seen = new Set([t]);
                const queue = [t];
                let open = false;
                for (let k = 0; k < queue.length && !open && k < 3000; k++) {
                    for (const o of nbrs(w, queue[k])) {
                        if (seen.has(o) || !WATER.has(o.terrain.id) || o.terrain.id === 'lake') continue;
                        if (o.terrain.id === 'ocean' || o.terrain.id === 'deep_ocean') { open = true; break; }
                        seen.add(o);
                        queue.push(o);
                    }
                }
                expect(open).toBe(true);
            }
        }
    });

    it('changes the land share only a little and never leaves a settlement on water', () => {
        for (const seed of SEEDS) {
            const a = landCount(worlds[seed][15]), b = landCount(worlds[seed][16]);
            expect(Math.abs(b - a) / a).toBeLessThan(0.01);
            for (const t of worlds[seed][16].tiles.flat()) {
                if (t.settlement) expect(WATER.has(t.terrain.id)).toBe(false);
            }
        }
    });
});

describe('Beaches and rocky shores (terrainGen 16)', () => {
    it('puts thin patchy beaches on low warm shores, never under hills or mountains', () => {
        const B = Terrain._coastCfg().beaches;
        for (const seed of SEEDS) {
            const w = worlds[seed][16];
            const flat = w.tiles.flat();
            const beaches = flat.filter(t => t.terrain.id === 'beach');
            expect(beaches.length).toBeGreaterThan(15);
            for (const t of beaches) {
                const ns = nbrs(w, t);
                expect(ns.some(o => WATER.has(o.terrain.id) && o.terrain.id !== 'lake')).toBe(true);
                expect(ns.some(o => HIGH.has(o.terrain.id))).toBe(false);
                expect(t.temperature).toBeGreaterThanOrEqual(B.minTemp);
            }
            // a band along some of the shore, not every shore hex
            const shore = flat.filter(t => !WATER.has(t.terrain.id) && t.terrain.id !== 'island'
                && nbrs(w, t).some(o => WATER.has(o.terrain.id) && o.terrain.id !== 'lake'));
            expect(beaches.length / shore.length).toBeLessThan(0.25);
            // steep coasts stay rocky: high shore hexes are still high
            expect(shore.filter(t => HIGH.has(t.terrain.id)).length).toBeGreaterThan(0);
        }
    });

    it('had no beaches before terrainGen 16', () => {
        for (const seed of SEEDS) {
            const flat = worlds[seed][15].tiles.flat();
            expect(flat.filter(t => t.terrain.id === 'beach').length).toBe(0);
            expect(flat.some(t => t._fjord || t._skerry)).toBe(false);
        }
    });
});

describe('Skerries (terrainGen 16)', () => {
    it('scatters a few one-hex islets near rocky shores, never in a river mouth', () => {
        const reach = Terrain._coastCfg().skerries.reach;
        let total = 0;
        for (const seed of SEEDS) {
            const w = worlds[seed][16];
            const sk = w.tiles.flat().filter(t => t._skerry);
            total += sk.length;
            expect(sk.length).toBeLessThan(40);
            for (const t of sk) {
                expect(t.terrain.id).toBe('island');
                const ns = Hex.neighbors(t.q, t.r).map(n => at(w, n.q, n.r));
                // tiny: open water all round
                for (const o of ns) expect(WATER.has(o.terrain.id)).toBe(true);
                expect(ns.some((o, i) => o.hasRiver && o.riverDir === (i + 3) % 6)).toBe(false);
                // near shore: land within reach
                let near = false;
                for (let dr = -reach; dr <= reach && !near; dr++) for (let dq = -reach - 1; dq <= reach + 1 && !near; dq++) {
                    const o = at(w, t.q + dq, t.r + dr);
                    if (o && o !== t && HIGH.has(o.terrain.id) && Hex.wrappingDistance(t.q, t.r, o.q, o.r, w.width) <= reach) near = true;
                }
                expect(near).toBe(true);
            }
        }
        expect(total).toBeGreaterThan(5);
    });
});

describe('Coasts determinism', () => {
    it('makes the same coasts from the same seed', () => {
        const sig = (w) => w.tiles.flat().map(t => t.terrain.id + (t._fjord ? 'F' : '') + (t._skerry ? 'S' : '')).join('|');
        expect(sig(make(16, 4711))).toBe(sig(worlds[4711][16]));
    });
});

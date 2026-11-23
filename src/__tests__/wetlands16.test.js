// Worlds since terrainGen 16 (Terrain._wetlands16, data/terrain.json wetlands): marshes lie
// in patches on the low wet flats (by lowland rivers, lake margins, river mouths), and the
// greatest rivers that reach the sea across a flat coast end in a delta of marsh, split
// into a second channel (tile.riverBranch) where it fits.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { World } from '../world/world.js';
import { Terrain } from '../world/terrain.js';

const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'lake', 'sea']);
const SEA = new Set(['ocean', 'deep_ocean', 'coast', 'sea']);
const make = (gen, seed = 4711, extra = {}) => {
    const w = new World(120, 80);
    w.generate({ seed, kingdomCount: 6, terrainGen: gen, riverCount: 40, ...extra });
    return w;
};
const at = (w, q, r) => (r < 0 || r >= w.height) ? null : w.tiles[r][Hex.wrapQ(q, w.width)];
const nbrs = (w, t) => Hex.neighbors(t.q, t.r).map(n => at(w, n.q, n.r));
const land = (w) => w.tiles.flat().filter(t => t.terrain.passable && !WATER.has(t.terrain.id));
const swamps = (w) => w.tiles.flat().filter(t => t.terrain.id === 'swamp');
const share = (w) => swamps(w).length / land(w).length;

let w15, w16, wWet, wDry;
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    w15 = make(15);
    w16 = make(16);
    wWet = make(16, 4711, { rainfall: 'tropical' });
    wDry = make(16, 4711, { rainfall: 'arid' });
});

describe('Wetlands (terrainGen 16)', () => {
    it('makes marshes in gen 16 worlds, none in gen 15', () => {
        expect(swamps(w15).length).toBe(0);
        expect(swamps(w16).length).toBeGreaterThan(20);
    });

    it('covers a sane share of the land: more when it rains, almost none in the arid', () => {
        expect(share(w16)).toBeGreaterThan(0.01);
        expect(share(w16)).toBeLessThan(0.035);
        expect(share(wWet)).toBeGreaterThan(share(w16) * 1.4);
        expect(share(wWet)).toBeLessThan(0.08);
        expect(share(wDry)).toBeLessThan(0.01);
    });

    it('lies in patches, not single speckles', () => {
        const sw = swamps(w16);
        const set = new Set(sw);
        const alone = sw.filter(t => !nbrs(w16, t).some(n => n && set.has(n))).length;
        expect(alone / sw.length).toBeLessThan(0.1);
        // no blanket: the largest patch is a handful of hexes
        const seen = new Set();
        let largest = 0;
        for (const t of sw) {
            if (seen.has(t)) continue;
            let size = 0;
            const stack = [t];
            seen.add(t);
            while (stack.length) {
                const x = stack.pop();
                size++;
                for (const n of nbrs(w16, x)) if (n && set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
            }
            largest = Math.max(largest, size);
        }
        expect(largest).toBeLessThanOrEqual(30);
    });

    it('lies low and wet, never cold or up in the hills', () => {
        const sw = swamps(w16);
        const all = land(w16);
        const mean = (xs, f) => xs.reduce((s, t) => s + f(t), 0) / xs.length;
        for (const t of sw) {
            expect(t.elevation).toBeGreaterThanOrEqual(0.42);
            expect(t.elevation).toBeLessThan(0.42 + 0.07);
            expect(t.temperature).toBeGreaterThanOrEqual(0.3);
        }
        expect(mean(sw, t => t.moisture)).toBeGreaterThan(mean(all, t => t.moisture) + 0.1);
        expect(mean(sw, t => t.elevation)).toBeLessThan(mean(all, t => t.elevation));
        // most of it by a river, a lake or the sea
        const watered = sw.filter(t => t.hasRiver || nbrs(w16, t).some(n => n && (n.hasRiver || WATER.has(n.terrain.id)))).length;
        expect(watered / sw.length).toBeGreaterThan(0.6);
    });

    it('marshes bear no mines', () => {
        const mines = ['iron', 'coal', 'copper', 'silver', 'gold_ore', 'gems', 'salt', 'oil'];
        for (const t of swamps(w16)) expect(t.resource && mines.includes(t.resource.id)).toBeFalsy();
    });

    it('every river still reaches water, the distributaries too', () => {
        // (not the arid world: there a small river may die out in the dry country, as in gen 15)
        for (const w of [w16, wWet]) {
            for (const t of w.tiles.flat().filter(x => x.hasRiver)) {
                expect(Number.isInteger(t.riverDir)).toBe(true);
                expect(WATER.has(t.terrain.id)).toBe(false);
                let c = t;
                const seen = new Set();
                while (c && c.hasRiver) {
                    expect(seen.has(c)).toBe(false);
                    seen.add(c);
                    c = nbrs(w, c)[c.riverDir];
                }
                expect(c && (WATER.has(c.terrain.id) || c.elevation < 0.42)).toBeTruthy();
            }
        }
    });

    it('gives the greatest rivers a delta: marsh at the mouth and a second channel to the sea', () => {
        const mouths = w16.tiles.flat().filter(t => t._delta);
        expect(mouths.length).toBeGreaterThanOrEqual(1);
        expect(mouths.length).toBeLessThanOrEqual(Terrain.WETLANDS.delta.maxDeltas);
        for (const m of mouths) {
            expect(m.terrain.id).toBe('swamp');
            expect(SEA.has(nbrs(w16, m)[m.riverDir].terrain.id)).toBe(true);
            expect(nbrs(w16, m).filter(n => n && n.terrain.id === 'swamp').length).toBeGreaterThanOrEqual(2);
        }
        const splits = w16.tiles.flat().filter(t => Number.isInteger(t.riverBranch));
        expect(splits.length).toBeGreaterThanOrEqual(1);
        for (const s of splits) {
            expect(s.hasRiver).toBe(true);
            expect(s.riverBranch).not.toBe(s.riverDir);
            const d = nbrs(w16, s)[s.riverBranch];
            expect(d.hasRiver && d.riverDistributary).toBe(true);
            expect(SEA.has(nbrs(w16, d)[d.riverDir].terrain.id)).toBe(true);
            // its own outlet is not the main river's
            const main = s._delta ? nbrs(w16, s)[s.riverDir] : nbrs(w16, nbrs(w16, s)[s.riverDir])[nbrs(w16, s)[s.riverDir].riverDir];
            expect(nbrs(w16, d)[d.riverDir]).not.toBe(main);
        }
    });

    it('puts no town in a marsh', () => {
        for (const t of swamps(w16)) expect(t.settlement).toBeFalsy();
    });

    it('is the same world from the same seed', () => {
        const sig = (wd) => wd.tiles.flat().map(t => `${t.terrain.id[0]}${t.hasRiver ? t.riverDir : '-'}${Number.isInteger(t.riverBranch) ? t.riverBranch : ''}`).join('');
        expect(sig(make(16))).toBe(sig(w16));
    });
});

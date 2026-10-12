/**
 * world-editor-tools.js — the world editor's pure map logic: hex math in the
 * game's even-r layout, sculpting, coastlines, the seamless generator with
 * rivers, symmetry, and the map check. A classic global script; importing it
 * assigns WorldTools onto globalThis.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import '../../world-editor-tools.js';
import { Hex } from '../core/hex.js';

let WT;
beforeAll(() => { WT = globalThis.WorldTools; });

const fill = (W, H, id) => new Array(W * H).fill(id);

describe('WorldTools — hex math', () => {
    it('neighbours match the game (Hex.neighbors) on even and odd rows', () => {
        for (const [q, r] of [[5, 4], [5, 5]]) {
            const ours = WT.neighbors(q, r, 20, 20, false).map(n => `${n.q},${n.r}`);
            const game = Hex.neighbors(q, r).map(n => `${n.q},${n.r}`);
            expect(ours).toEqual(game);
        }
    });

    it('wraps east-west only when asked', () => {
        expect(WT.neighbors(0, 4, 10, 10, false).some(n => n.q === 9)).toBe(false);
        // Even rows sit half a hex east: only the west neighbour wraps
        expect(WT.neighbors(0, 4, 10, 10, true).filter(n => n.q === 9).length).toBe(1);
        expect(WT.neighbors(0, 5, 10, 10, true).filter(n => n.q === 9).length).toBe(3);
    });

    it('distance and line agree, and a line steps between neighbours', () => {
        const ln = WT.line(2, 3, 11, 9);
        expect(ln.length).toBe(WT.distance(2, 3, 11, 9) + 1);
        expect(ln[0]).toEqual({ q: 2, r: 3 });
        expect(ln[ln.length - 1]).toEqual({ q: 11, r: 9 });
        for (let i = 1; i < ln.length; i++) expect(WT.distance(ln[i - 1].q, ln[i - 1].r, ln[i].q, ln[i].r)).toBe(1);
    });

    it('a disc of radius n holds 3n(n+1)+1 hexes away from the edge', () => {
        expect(WT.disc(10, 10, 0, 30, 30).length).toBe(1);
        expect(WT.disc(10, 10, 2, 30, 30).length).toBe(19);
        expect(WT.disc(0, 0, 2, 30, 30).length).toBeLessThan(19);
    });

    it('flood region stops at a different value', () => {
        const W = 6, H = 4, t = fill(W, H, 'ocean');
        t[1 * W + 1] = t[1 * W + 2] = t[2 * W + 2] = 'grassland';
        expect(WT.floodRegion(1, 1, W, H, (q, r) => t[r * W + q]).length).toBe(3);
    });
});

describe('WorldTools — sculpting', () => {
    it('raise and lower walk the height ladder', () => {
        expect(WT.stepTerrain('ocean', 1)).toBe('coast');
        expect(WT.stepTerrain('beach', 1, 'woodland')).toBe('woodland');
        expect(WT.stepTerrain('desert', 1)).toBe('hills');
        expect(WT.stepTerrain('mountain', 1)).toBe('snow_peak');
        expect(WT.stepTerrain('snow_peak', 1)).toBe('snow_peak');
        expect(WT.stepTerrain('hills', -1, 'plains')).toBe('plains');
        expect(WT.stepTerrain('deep_ocean', -1)).toBe('deep_ocean');
    });

    it('smooth swallows a lone speck but keeps the coastline', () => {
        const W = 9, H = 9, t = fill(W, H, 'grassland');
        t[4 * W + 4] = 'desert';
        for (let q = 0; q < W; q++) t[8 * W + q] = 'ocean';
        const out = WT.smooth(t, W, H);
        expect(out[4 * W + 4]).toBe('grassland');
        expect(out[8 * W + 3]).toBe('ocean');
        expect(out[7 * W + 3]).toBe('grassland');
    });

    it('shapeCoast rings land with coast, then ocean, then the deep', () => {
        const W = 20, H = 20, t = fill(W, H, 'deep_ocean');
        t[10 * W + 10] = 'grassland';
        t[2 * W + 2] = 'lake';
        const out = WT.shapeCoast(t, W, H, { deep: 4 });
        expect(out[10 * W + 11]).toBe('coast');
        expect(out[10 * W + 13]).toBe('ocean');
        expect(out[10 * W + 18]).toBe('deep_ocean');
        expect(out[2 * W + 2]).toBe('lake');
    });

    it('symmetry gives the mirror partners inside the map', () => {
        expect(WT.symmetry(2, 3, 10, 8, 'none')).toEqual([{ q: 2, r: 3 }]);
        expect(WT.symmetry(2, 3, 10, 8, 'x')).toEqual([{ q: 2, r: 3 }, { q: 7, r: 3 }]);
        expect(WT.symmetry(2, 3, 10, 8, 'quad').length).toBe(4);
        expect(WT.symmetry(2, 3, 10, 8, 'radial')).toEqual([{ q: 2, r: 3 }, { q: 7, r: 4 }]);
    });

    it('connection masks use the game sprite bit order', () => {
        // Neighbour to the east (dir 0) sets bit 3
        const W = 10, H = 10;
        const mask = WT.connectionMask(4, 4, W, H, (q, r) => q === 5 && r === 4);
        expect(mask).toBe('001000');
    });
});

describe('WorldTools — generator', () => {
    const opts = { width: 60, height: 40, seed: 1234, style: 'continents', land: 0.4 };

    it('is deterministic for a seed and varies with it', () => {
        const a = WT.generate(opts), b = WT.generate(opts), c = WT.generate({ ...opts, seed: 99 });
        expect(a.tiles).toEqual(b.tiles);
        expect(a.tiles).not.toEqual(c.tiles);
    });

    it('lands near the asked share of land, for every style', () => {
        for (const style of Object.keys(WT.STYLES)) {
            const { tiles } = WT.generate({ ...opts, style, land: 0.35 });
            const land = tiles.filter(WT.isLand).length / tiles.length;
            expect(land, style).toBeGreaterThan(0.25);
            expect(land, style).toBeLessThan(0.45);
        }
    });

    it('is seamless east-west: the wrap seam is no rougher than the map', () => {
        const { tiles } = WT.generate({ ...opts, width: 80, height: 50 });
        const W = 80, H = 50;
        const diff = (qa, qb) => {
            let d = 0;
            for (let r = 0; r < H; r++) d += WT.isLand(tiles[r * W + qa]) !== WT.isLand(tiles[r * W + qb]) ? 1 : 0;
            return d;
        };
        let inner = 0;
        for (let q = 0; q < W - 1; q++) inner += diff(q, q + 1);
        expect(diff(W - 1, 0)).toBeLessThanOrEqual(Math.max(4, (inner / (W - 1)) * 3));
    });

    // Separate landmasses across the east-west wrap, polar ice aside
    const masses = (tiles, W, H) => {
        const solid = k => WT.isLand(tiles[k]) && tiles[k] !== 'ice';
        const seen = new Uint8Array(W * H), sizes = [];
        for (let k = 0; k < W * H; k++) {
            if (seen[k] || !solid(k)) continue;
            const stack = [k];
            let size = 0;
            seen[k] = 1;
            while (stack.length) {
                const c = stack.pop();
                size++;
                for (const nb of WT.neighbors(c % W, (c / W) | 0, W, H, true)) {
                    const j = nb.r * W + nb.q;
                    if (!seen[j] && solid(j)) { seen[j] = 1; stack.push(j); }
                }
            }
            sizes.push(size);
        }
        return sizes.sort((a, b) => b - a);
    };

    it('makes exactly the asked number of continents', () => {
        const W = 90, H = 60;
        for (const continents of [1, 2, 4, 7]) {
            for (const seed of [3, 77]) {
                const { tiles } = WT.generate({ ...opts, width: W, height: H, seed, continents });
                const sizes = masses(tiles, W, H);
                const total = sizes.reduce((a, b) => a + b, 0);
                // Continents vary in size; offshore isles stay far smaller
                expect(sizes.filter(s => s >= total * 0.12 / continents).length, `${continents} @ ${seed}`).toBe(continents);
            }
        }
    });

    it('grows continents of unequal size from the plates', () => {
        const W = 90, H = 60;
        const { tiles } = WT.generate({ ...opts, width: W, height: H, seed: 5, continents: 5 });
        const sizes = masses(tiles, W, H).slice(0, 5);
        expect(sizes[0] / sizes[4]).toBeGreaterThan(1.5);
    });

    it('raises mountains in ranges where plates meet, not as scattered specks', () => {
        const W = 90, H = 60;
        for (const seed of [2, 11]) {
            const { tiles } = WT.generate({ ...opts, width: W, height: H, seed, continents: 4 });
            const high = k => tiles[k] === 'mountain' || tiles[k] === 'snow_peak';
            let peaks = 0, joined = 0;
            for (let k = 0; k < W * H; k++) {
                if (!high(k)) continue;
                peaks++;
                if (WT.neighbors(k % W, (k / W) | 0, W, H, true).some(nb => high(nb.r * W + nb.q))) joined++;
            }
            expect(peaks).toBeGreaterThan(20);
            expect(joined / peaks).toBeGreaterThan(0.85);
        }
    });

    it('lays beaches only where they would form, not along every shore', () => {
        const W = 100, H = 60;
        const { tiles } = WT.generate({ ...opts, width: W, height: H, seed: 3, continents: 4, beaches: true });
        const open = t => t === 'coast' || t === 'ocean' || t === 'deep_ocean';
        let shore = 0, beach = 0;
        for (let k = 0; k < W * H; k++) {
            const ns = WT.neighbors(k % W, (k / W) | 0, W, H, true).map(n => tiles[n.r * W + n.q]);
            if (!WT.isLand(tiles[k]) || !ns.some(open)) continue;
            shore++;
            if (tiles[k] !== 'beach') continue;
            beach++;
            // Never under cliffs: no hills or mountains right behind the sand
            expect(ns.some(t => ['hills', 'highlands', 'mountain', 'snow_peak'].includes(t))).toBe(false);
        }
        expect(beach / shore).toBeGreaterThan(0.1);
        expect(beach / shore).toBeLessThan(0.5);
    });

    it('keeps cold and marshy shores free of sand', () => {
        const W = 6, H = 6, t = fill(W, H, 'tundra');
        for (let q = 0; q < W; q++) t[q] = 'coast';
        t[1 * W + 2] = 'swamp';
        const out = WT.placeBeaches(t, W, H, { seed: 1 });
        expect(out.includes('beach')).toBe(false);
        const warm = WT.placeBeaches(t.map(x => (x === 'tundra' ? 'desert' : x)), W, H, { seed: 1 });
        expect(warm[1 * W + 2]).toBe('swamp');
    });

    it('runs rivers over land down to the water', () => {
        const W = 60;
        const { tiles, rivers } = WT.generate({ ...opts, rivers: 6 });
        const keys = Object.keys(rivers);
        expect(keys.length).toBeGreaterThan(5);
        for (const k of keys) {
            const [q, r] = k.split(',').map(Number);
            expect(WT.isLand(tiles[r * W + q])).toBe(true);
        }
    });
});

describe('WorldTools — map check', () => {
    const base = () => {
        const W = 10, H = 10, tiles = fill(W, H, 'grassland');
        for (let q = 0; q < W; q++) tiles[q] = 'ocean';
        return { width: W, height: H, tiles };
    };

    it('flags towns in the sea and realms without capitals', () => {
        const issues = WT.validate({
            ...base(),
            overlays: { '3,0': { type: 'town', name: 'Sunk' }, '4,4': { type: 'village' } },
            realms: [{ id: 'a', name: 'Ashmark' }, { id: 'b', name: 'Bree', capital: { q: 5, r: 5 } }],
            territory: { '1,1': 'a' },
        });
        expect(issues.some(i => i.level === 'error' && /Sunk/.test(i.msg) && i.q === 3)).toBe(true);
        expect(issues.some(i => i.level === 'error' && /Ashmark/.test(i.msg))).toBe(true);
        expect(issues.some(i => /Bree/.test(i.msg) && i.level !== 'info')).toBe(false);
    });

    it('a sound map raises no errors', () => {
        const issues = WT.validate({ ...base(), playerStart: { q: 5, r: 5 } });
        expect(issues.filter(i => i.level === 'error')).toEqual([]);
    });
});

describe('WorldTools — snapshots', () => {
    it('encode/decode and rle/unrle round-trip', () => {
        const order = ['ocean', 'grassland', 'hills'];
        const t = ['ocean', 'ocean', 'hills', 'grassland', 'grassland', 'grassland'];
        expect(WT.decode(WT.encode(t, order), order)).toEqual(t);
        expect(WT.rle(t)).toBe('ocean*2,hills,grassland*3');
        expect(WT.unrle(WT.rle(t))).toEqual(t);
    });
});

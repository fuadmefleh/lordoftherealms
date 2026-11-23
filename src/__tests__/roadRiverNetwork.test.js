// The overworld's rivers and roads as networks: each river hex flows to one
// downstream neighbour, downhill, ending in open water or another river; no
// river is left on water; road links run both ways between road hexes; and
// the towns of a landmass are joined by road.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { World } from '../world/world.js';

const W = 80, H = 50;
let world;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    world = new World(W, H);
    world.generate({ seed: 4242, kingdomCount: 4, terrainGen: 3 });
});

const at = (q, r) => world.tiles[r][Hex.wrapQ(q, W)];
const step = (t, dir) => {
    const n = Hex.neighbors(t.q, t.r)[dir];
    return n.r >= 0 && n.r < H ? at(n.q, n.r) : null;
};
const allTiles = () => world.tiles.flat();
const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'sea', 'lake']);

describe('Hex.offsetDistance', () => {
    it('is 1 for every neighbour, on even and odd rows', () => {
        for (const [q, r] of [[5, 4], [5, 5]]) {
            for (const n of Hex.neighbors(q, r)) expect(Hex.offsetDistance(q, r, n.q, n.r)).toBe(1);
        }
    });

    it('counts a straight diagonal run as its length', () => {
        // SE from (3, 0) four times
        let q = 3, r = 0;
        for (let i = 0; i < 4; i++) ({ q, r } = Hex.neighbors(q, r)[5]);
        expect(Hex.offsetDistance(3, 0, q, r)).toBe(4);
    });

    it('directionTo finds the neighbour index, across the wrap seam', () => {
        expect(Hex.directionTo(0, 3, W - 1, 3, W)).toBe(3);
        expect(Hex.directionTo(0, 3, 5, 3, W)).toBe(-1);
    });
});

describe('Rivers', () => {
    it('has rivers, none drawn on open water', () => {
        const rivers = allTiles().filter(t => t.hasRiver);
        expect(rivers.length).toBeGreaterThan(20);
        expect(rivers.filter(t => WATER.has(t.terrain.id))).toEqual([]);
    });

    it('every river hex flows downhill into water or another river', () => {
        for (const t of allTiles().filter(x => x.hasRiver)) {
            expect(Number.isInteger(t.riverDir)).toBe(true);
            const down = step(t, t.riverDir);
            expect(down).toBeTruthy();
            expect(down.hasRiver || WATER.has(down.terrain.id) || down.elevation < 0.42).toBe(true);
        }
    });

    it('following the flow always reaches water (no loops, no dead ends)', () => {
        for (const src of allTiles().filter(x => x.hasRiver && x.riverSource)) {
            let t = src;
            const seen = new Set();
            while (t && t.hasRiver) {
                expect(seen.has(t)).toBe(false);
                seen.add(t);
                t = step(t, t.riverDir);
            }
            expect(t && (WATER.has(t.terrain.id) || t.elevation < 0.42)).toBe(true);
        }
    });
});

describe('Roads', () => {
    it('road links run both ways and only between road hexes', () => {
        for (const t of allTiles().filter(x => x.hasRoad)) {
            expect(t.roadLinks).toBeGreaterThan(0);
            for (let d = 0; d < 6; d++) {
                if (!(t.roadLinks & (1 << d))) continue;
                const n = step(t, d);
                expect(n && n.hasRoad).toBe(true);
                expect(n.roadLinks & (1 << ((d + 3) % 6))).toBeTruthy();
            }
        }
    });

    it('joins the settlements of each landmass into one road network', () => {
        const towns = world.getAllSettlements();
        const byRegion = new Map();
        for (const s of towns) {
            const rid = at(s.q, s.r).regionId;
            if (!byRegion.has(rid)) byRegion.set(rid, []);
            byRegion.get(rid).push(s);
        }
        for (const group of byRegion.values()) {
            if (group.length < 2) continue;
            // Flood the road links out from the first town
            const start = at(group[0].q, group[0].r);
            const reached = new Set([start]);
            const queue = [start];
            while (queue.length) {
                const t = queue.shift();
                for (let d = 0; d < 6; d++) {
                    if (!(t.roadLinks & (1 << d))) continue;
                    const n = step(t, d);
                    if (n && !reached.has(n)) { reached.add(n); queue.push(n); }
                }
            }
            for (const s of group) expect(reached.has(at(s.q, s.r))).toBe(true);
        }
    });
});

describe('Hex metric on the offset grid', () => {
    it('distance is 1 to every neighbour and counts true steps', () => {
        for (const [q, r] of [[5, 4], [5, 5], [0, 0], [7, 1]]) {
            for (const n of Hex.neighbors(q, r)) expect(Hex.distance(q, r, n.q, n.r)).toBe(1);
        }
        // Four steps SE, four steps SW: 4 each
        for (const dir of [4, 5]) {
            let q = 3, r = 2;
            for (let i = 0; i < 4; i++) ({ q, r } = Hex.neighbors(q, r)[dir]);
            expect(Hex.distance(3, 2, q, r)).toBe(4);
        }
    });

    it('hexesInRange is the true disc: 3n(n+1)+1 hexes, all within n', () => {
        for (const [q, r, n] of [[10, 10, 3], [10, 11, 2], [4, 7, 5]]) {
            const disc = Hex.hexesInRange(q, r, n);
            expect(disc.length).toBe(3 * n * (n + 1) + 1);
            expect(new Set(disc.map(h => `${h.q},${h.r}`)).size).toBe(disc.length);
            for (const h of disc) expect(Hex.distance(q, r, h.q, h.r)).toBeLessThanOrEqual(n);
            // and its ring of neighbours is all of distance 1
            expect(Hex.hexesInRange(q, r, 1).filter(h => h.q !== q || h.r !== r).map(h => `${h.q},${h.r}`).sort())
                .toEqual(Hex.neighbors(q, r).map(h => `${h.q},${h.r}`).sort());
        }
    });

    it('lineDraw steps hex to adjacent hex', () => {
        const line = Hex.lineDraw(2, 3, 11, 9);
        expect(line[0]).toEqual({ q: 2, r: 3 });
        expect(line[line.length - 1]).toEqual({ q: 11, r: 9 });
        for (let i = 1; i < line.length; i++) expect(Hex.distance(line[i - 1].q, line[i - 1].r, line[i].q, line[i].r)).toBe(1);
    });

    it('the old metric is kept for regenerating old worlds', () => {
        expect(Hex.withLegacyMetric(() => Hex.distance(0, 0, 1, 2))).toBe(3);
        expect(Hex.distance(0, 0, 1, 2)).toBe(2);
        expect(Hex.withLegacyMetric(() => Hex.hexesInRange(0, 0, 1).length)).toBe(7);
    });
});

describe('Water that drains (terrainGen 10: Terrain.generateHydrology)', () => {
    const GEN = { seed: 31337, kingdomCount: 4, terrainGen: 10, riverCount: 40, lakeFreq: 'normal' };
    let w10;
    const at10 = (q, r) => w10.tiles[r][Hex.wrapQ(q, w10.width)];
    const step10 = (t, dir) => {
        const n = Hex.neighbors(t.q, t.r)[dir];
        return n.r >= 0 && n.r < w10.height ? at10(n.q, n.r) : null;
    };
    beforeAll(() => {
        w10 = new World(120, 80);
        w10.generate({ ...GEN });
    });

    it('has rivers and lakes, no river on water', () => {
        const flat = w10.tiles.flat();
        const rivers = flat.filter(t => t.hasRiver);
        expect(rivers.length).toBeGreaterThan(30);
        expect(rivers.filter(t => WATER.has(t.terrain.id))).toEqual([]);
        expect(flat.filter(t => t.terrain.id === 'lake').length).toBeGreaterThanOrEqual(5);
    });

    it('rivers branch: tributaries join trunks (more sources than mouths)', () => {
        const flat = w10.tiles.flat();
        const rivers = flat.filter(t => t.hasRiver);
        const mouths = rivers.filter(t => { const d = step10(t, t.riverDir); return d && !d.hasRiver; });
        const sources = rivers.filter(t => t.riverSource);
        expect(sources.length).toBeGreaterThan(mouths.length);
    });

    it('following the flow always reaches water (no loops, no dead ends)', () => {
        for (const src of w10.tiles.flat().filter(x => x.hasRiver && x.riverSource)) {
            let t = src;
            const seen = new Set();
            while (t && t.hasRiver) {
                expect(seen.has(t)).toBe(false);
                seen.add(t);
                t = step10(t, t.riverDir);
            }
            expect(t && (WATER.has(t.terrain.id) || t.elevation < 0.42 || t.terrain.id === 'island')).toBe(true);
        }
    });

    it('some river runs out of a lake (a lake fills and spills)', () => {
        const flat = w10.tiles.flat();
        const outflow = flat.some(t => t.hasRiver && t.riverSource && Hex.neighbors(t.q, t.r)
            .some(n => n.r >= 0 && n.r < w10.height && at10(n.q, n.r).terrain.id === 'lake'));
        const intoLake = flat.some(t => t.hasRiver && (() => { const d = step10(t, t.riverDir); return d && d.terrain.id === 'lake'; })());
        expect(outflow || intoLake).toBe(true);
    });

    it('is the same world from the same seed', () => {
        const again = new World(120, 80);
        again.generate({ ...GEN });
        const sig = (wd) => wd.tiles.flat().map(t => `${t.terrain.id[0]}${t.hasRiver ? t.riverDir : '-'}`).join('');
        expect(sig(again)).toBe(sig(w10));
    });

    it('lakeFreq none makes no lakes of the drainage; many makes more than normal', () => {
        const count = (lakeFreq) => {
            const wd = new World(120, 80);
            wd.generate({ ...GEN, lakeFreq });
            return wd.tiles.flat().filter(t => t._lake).length;
        };
        expect(count('none')).toBe(0);
        expect(count('many')).toBeGreaterThan(count('normal'));
    });
});

describe('Lakes in the valleys (terrainGen 11: Terrain._valleyLakes)', () => {
    const GEN = { seed: 31337, kingdomCount: 4, terrainGen: 11, riverCount: 40, lakeFreq: 'normal' };
    let w;
    const at = (q, r) => w.tiles[r][Hex.wrapQ(q, w.width)];
    const lakeGroups = (wd) => {
        const seen = new Set();
        const groups = [];
        for (const t of wd.tiles.flat()) {
            if (t.terrain.id !== 'lake' || seen.has(t)) continue;
            const g = [t];
            seen.add(t);
            for (let i = 0; i < g.length; i++) {
                for (const n of Hex.neighbors(g[i].q, g[i].r)) {
                    if (n.r < 0 || n.r >= wd.height) continue;
                    const nt = wd.tiles[n.r][Hex.wrapQ(n.q, wd.width)];
                    if (nt.terrain.id === 'lake' && !seen.has(nt)) { seen.add(nt); g.push(nt); }
                }
            }
            groups.push(g);
        }
        return groups;
    };
    beforeAll(() => {
        w = new World(120, 80);
        w.generate({ ...GEN });
    });

    it('lakes are real bodies of water, not scattered single-hex ponds', () => {
        const groups = lakeGroups(w);
        expect(groups.length).toBeGreaterThanOrEqual(4);
        const big = groups.filter(g => g.length >= 3);
        expect(big.length).toBeGreaterThanOrEqual(3);
        expect(Math.max(...groups.map(g => g.length))).toBeGreaterThanOrEqual(6);
    });

    it('lakes sit on the rivers: water runs into them and out of them', () => {
        const flat = w.tiles.flat();
        const intoLake = flat.filter(t => t.hasRiver && (() => {
            const n = Hex.neighbors(t.q, t.r)[t.riverDir];
            return n.r >= 0 && n.r < w.height && at(n.q, n.r).terrain.id === 'lake';
        })());
        const outOf = flat.filter(t => t.hasRiver && Hex.neighbors(t.q, t.r)
            .some((n, i) => n.r >= 0 && n.r < w.height && i !== t.riverDir && at(n.q, n.r).terrain.id === 'lake'));
        expect(intoLake.length).toBeGreaterThanOrEqual(2);
        expect(outOf.length).toBeGreaterThanOrEqual(2);
    });

    it('rivers rise at springs in the hills and mountains, a handful per land, not a brook to every cove', () => {
        const flat = w.tiles.flat();
        const land = flat.filter(t => t.terrain.passable).length;
        const rivers = flat.filter(t => t.hasRiver);
        const springs = rivers.filter(t => t.riverSource);
        expect(springs.length).toBeGreaterThan(3);
        for (const t of springs) expect(t.elevation).toBeGreaterThanOrEqual(0.52);
        expect(springs.length).toBeLessThanOrEqual(Math.ceil(land / 70));
        expect(rivers.length / land).toBeLessThan(0.15);
    });

    it('every lake of 3 hexes or more drains by a river', () => {
        const drains = (g) => g.some(t => Hex.neighbors(t.q, t.r).some(n => {
            if (n.r < 0 || n.r >= w.height) return false;
            const nt = at(n.q, n.r);
            if (!nt.hasRiver) return false;
            const d = Hex.neighbors(nt.q, nt.r)[nt.riverDir];
            return !(d.r >= 0 && d.r < w.height && at(d.q, d.r) === t);
        }) || Hex.neighbors(t.q, t.r).some(n => n.r >= 0 && n.r < w.height && ['ocean', 'coast', 'deep_ocean', 'sea'].includes(at(n.q, n.r).terrain.id)));
        // (lakes the drainage filled; a little landlocked pool of the sea itself has no river)
        for (const g of lakeGroups(w).filter(g => g.length >= 3 && g.every(t => t._lake))) expect(drains(g)).toBe(true);
    });

    it('no lake touches the sea', () => {
        for (const t of w.tiles.flat().filter(x => x.terrain.id === 'lake')) {
            for (const n of Hex.neighbors(t.q, t.r)) {
                if (n.r < 0 || n.r >= w.height) continue;
                expect(['ocean', 'deep_ocean', 'coast', 'sea']).not.toContain(at(n.q, n.r).terrain.id);
            }
        }
    });

    it('lakeFreq none makes none; abundant makes more', () => {
        const count = (lakeFreq) => {
            const wd = new World(120, 80);
            wd.generate({ ...GEN, lakeFreq });
            return wd.tiles.flat().filter(t => t._lake).length;
        };
        expect(count('none')).toBe(0);
        expect(count('abundant')).toBeGreaterThan(count('normal'));
    });
});

describe('Land as asked for (terrainGen 11: Terrain._land11 / _seaLevel11)', () => {
    const make = (extra = {}) => {
        const wd = new World(120, 80);
        wd.generate({ seed: 4711, kingdomCount: 6, terrainGen: 11, riverCount: 40, lakeFreq: 'normal', ...extra });
        return wd;
    };
    const landShare = (wd) => wd.tiles.flat().filter(t => !['ocean', 'deep_ocean', 'coast', 'sea', 'lake'].includes(t.terrain.id)).length / (wd.width * wd.height);
    it('Land Coverage is the share of the map that is land', () => {
        expect(landShare(make())).toBeGreaterThan(0.38);
        expect(landShare(make())).toBeLessThan(0.5);
        expect(landShare(make({ landMass: 25 }))).toBeLessThan(0.3);
        expect(landShare(make({ landMass: 70 }))).toBeGreaterThan(0.6);
    });
    it('most of the land is lowland, with hills and a fringe of mountains', () => {
        const flat = make().tiles.flat();
        const land = flat.filter(t => t.terrain.passable || ['mountain', 'snow_peak'].includes(t.terrain.id));
        const share = (ids) => land.filter(t => ids.includes(t.terrain.id)).length / land.length;
        expect(share(['mountain', 'snow_peak'])).toBeLessThan(0.18);
        expect(share(['mountain', 'snow_peak'])).toBeGreaterThan(0.04);
        expect(share(['hills', 'highlands'])).toBeGreaterThan(0.15);
    });
    it('is the same world from the same seed', () => {
        const sig = (wd) => wd.tiles.flat().map(t => t.terrain.id[0] + (t.hasRiver ? t.riverDir : '-')).join('');
        expect(sig(make())).toBe(sig(make()));
    });
});

describe('Water on an Epic map (terrainGen 11, 350x240)', () => {
    it('a big continent gets longer rivers, not a web of them, and lakes stay a small share', () => {
        const wd = new World(350, 240);
        wd.generate({ seed: 4711, kingdomCount: 16, terrainGen: 11, riverCount: 40, lakeFreq: 'normal' });
        const flat = wd.tiles.flat();
        const land = flat.filter(t => t.terrain.passable).length;
        const springs = flat.filter(t => t.hasRiver && t.riverSource).length;
        const lakes = flat.filter(t => t.terrain.id === 'lake').length;
        expect(springs).toBeGreaterThan(10);
        expect(springs).toBeLessThanOrEqual(Math.ceil(Math.sqrt(land) * 0.5));
        expect(lakes / land).toBeLessThan(0.06);
    }, 60000);
});

describe('Ranges and climate (terrainGen 12: Terrain._plates / _climate12 / _riverbanks12)', () => {
    let w;
    const WATER_IDS = ['ocean', 'deep_ocean', 'coast', 'sea', 'lake'];
    beforeAll(() => {
        w = new World(120, 80);
        w.generate({ seed: 4711, kingdomCount: 6, terrainGen: 12, riverCount: 40, lakeFreq: 'normal' });
    });
    const land = () => w.tiles.flat().filter(t => !WATER_IDS.includes(t.terrain.id));
    const mean = (a, f) => a.reduce((s, t) => s + f(t), 0) / Math.max(1, a.length);

    it('still makes the land asked for, with a fringe of mountains', () => {
        const l = land();
        expect(l.length / (w.width * w.height)).toBeGreaterThan(0.38);
        const mtn = l.filter(t => ['mountain', 'snow_peak'].includes(t.terrain.id)).length / l.length;
        expect(mtn).toBeGreaterThan(0.04);
        expect(mtn).toBeLessThan(0.18);
    });

    it('high ground is colder than the lowland of the same latitude', () => {
        const band = land().filter(t => Math.abs(t.r / w.height - 0.5) < 0.15);
        const high = band.filter(t => t.elevation >= 0.6);
        const low = band.filter(t => t.elevation < 0.5);
        expect(high.length).toBeGreaterThan(5);
        expect(mean(high, t => t.temperature)).toBeLessThan(mean(low, t => t.temperature));
    });

    it('the country by a river is wetter than the land at large', () => {
        const l = land();
        expect(mean(l.filter(t => t.hasRiver), t => t.moisture)).toBeGreaterThan(mean(l, t => t.moisture));
    });

    it('rain falls on the windward coast and the lee of the land is drier (tropical easterlies)', () => {
        // in the tropics the wind blows from the east: east-facing coasts wetter than west-facing ones
        const at = (q, r) => w.tiles[r][Hex.wrapQ(q, w.width)];
        const isSea = (t) => t && ['ocean', 'deep_ocean', 'coast', 'sea'].includes(t.terrain.id);
        const tropic = land().filter(t => Math.abs(t.r / (w.height - 1) - 0.5) * 2 < 0.2);
        const eastCoast = tropic.filter(t => isSea(at(t.q + 1, t.r)) && !isSea(at(t.q - 1, t.r)));
        const westCoast = tropic.filter(t => isSea(at(t.q - 1, t.r)) && !isSea(at(t.q + 1, t.r)));
        expect(eastCoast.length).toBeGreaterThan(3);
        expect(westCoast.length).toBeGreaterThan(3);
        expect(mean(eastCoast, t => t.moisture)).toBeGreaterThan(mean(westCoast, t => t.moisture));
    });
});

describe('Desert belts (terrainGen 13)', () => {
    it('the subtropical dry belts have deserts; gen 12 hardly any', () => {
        const deserts = (gen) => {
            const wd = new World(120, 80);
            wd.generate({ seed: 4711, kingdomCount: 6, terrainGen: gen, riverCount: 40, lakeFreq: 'normal' });
            const land = wd.tiles.flat().filter(t => !['ocean', 'deep_ocean', 'coast', 'sea', 'lake'].includes(t.terrain.id));
            const d = land.filter(t => t.terrain.id === 'desert');
            return { share: d.length / land.length, lat: d.map(t => Math.abs(t.r / (wd.height - 1) - 0.5) * 2) };
        };
        const g13 = deserts(13);
        expect(g13.share).toBeGreaterThan(0.02);
        expect(g13.share).toBeGreaterThan(deserts(12).share);
        // most of them a quarter to a half of the way to the poles
        const inBelt = g13.lat.filter(l => l > 0.12 && l < 0.5).length / Math.max(1, g13.lat.length);
        expect(inBelt).toBeGreaterThan(0.7);
    });
});

describe('Lobed continents, archipelagos and relief (terrainGen 14)', () => {
    const make = (extra = {}, seed = 4711) => {
        const wd = new World(120, 80);
        wd.generate({ seed, kingdomCount: 6, terrainGen: 14, riverCount: 40, lakeFreq: 'normal', ...extra });
        return wd;
    };
    const isLand = (t) => !WATER.has(t.terrain.id);
    const nb = (wd, t) => Hex.neighbors(t.q, t.r).filter(n => n.r >= 0 && n.r < wd.height).map(n => wd.tiles[n.r][Hex.wrapQ(n.q, wd.width)]);
    // the land's separate bodies, by size
    const bodies = (wd) => {
        const seen = new Set(), sizes = [];
        for (const t of wd.tiles.flat()) {
            if (!isLand(t) || seen.has(t)) continue;
            let n = 0; const stack = [t]; seen.add(t);
            while (stack.length) { const c = stack.pop(); n++; for (const o of nb(wd, c)) if (isLand(o) && !seen.has(o)) { seen.add(o); stack.push(o); } }
            sizes.push(n);
        }
        return sizes.sort((a, b) => b - a);
    };
    let w14;
    beforeAll(() => { w14 = make(); });

    it('keeps the land share and the mix of lowland, hills and mountains', () => {
        const flat = w14.tiles.flat();
        const land = flat.filter(isLand);
        expect(land.length / flat.length).toBeGreaterThan(0.38);
        expect(land.length / flat.length).toBeLessThan(0.5);
        const share = (ids) => land.filter(t => ids.includes(t.terrain.id)).length / land.length;
        expect(share(['mountain', 'snow_peak'])).toBeGreaterThan(0.05);
        expect(share(['mountain', 'snow_peak'])).toBeLessThan(0.12);
        expect(share(['hills', 'highlands'])).toBeGreaterThan(0.15);
        expect(share(['hills', 'highlands'])).toBeLessThan(0.32);
    });

    it('stands its mountains in chains, not scattered alone', () => {
        const high = new Set(['mountain', 'snow_peak']);
        const mtns = w14.tiles.flat().filter(t => high.has(t.terrain.id));
        const chained = mtns.filter(t => nb(w14, t).filter(o => high.has(o.terrain.id)).length >= 2).length;
        expect(chained / mtns.length).toBeGreaterThan(0.75);
    });

    it('leaves the heart of a continent a lowland in good part', () => {
        // land four or more hexes from any sea is not all hills and mountains
        const flat = w14.tiles.flat();
        const dist = new Map();
        let front = flat.filter(t => isLand(t) && nb(w14, t).some(o => !isLand(o)));
        front.forEach(t => dist.set(t, 0));
        for (let d = 1; front.length; d++) {
            const next = [];
            for (const t of front) for (const o of nb(w14, t)) if (isLand(o) && !dist.has(o)) { dist.set(o, d); next.push(o); }
            front = next;
        }
        const inland = flat.filter(t => (dist.get(t) ?? -1) >= 4);
        const low = inland.filter(t => !['hills', 'highlands', 'mountain', 'snow_peak'].includes(t.terrain.id));
        expect(inland.length).toBeGreaterThan(200);
        expect(low.length / inland.length).toBeGreaterThan(0.5);
    });

    it('scatters islands and archipelagos as the Islands setting asks', () => {
        const isles = (wd) => bodies(wd).filter(n => n >= 2 && n <= 60).length;
        const many = isles(make({ islandFreq: 2 }));
        const none = isles(make({ islandFreq: 0 }));
        expect(isles(w14)).toBeGreaterThan(3);
        expect(many).toBeGreaterThan(none);
    });

    it('has no deserts when Deserts is none (it used to fall back to normal)', () => {
        const d = make({ desertFreq: 'none' }).tiles.flat().filter(t => t.terrain.id === 'desert').length;
        expect(d).toBe(0);
    });

    it('is the same world from the same seed', () => {
        const sig = (wd) => wd.tiles.flat().map(t => t.terrain.id[0] + (t.hasRiver ? t.riverDir : '-')).join('');
        expect(sig(make({}, 99))).toBe(sig(make({}, 99)));
    });
});

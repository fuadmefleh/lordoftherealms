/**
 * Water on the inner map beyond the shore (world/innerMap/water.js): bigger,
 * varied ponds scaled by the terrain and the hex's moisture; the world river
 * of a hex drawn across its map from the sides it flows in by to the side it
 * flows out by, with fords in the wilds and a bridge where a town street
 * crosses it, never over buildings, lots or the town's heart; a lake hex as a
 * large lake with shore along the sides that face land; sparse shore dressing.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Hex;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ Hex } = await import('../core/hex.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

const innerMapData = () => DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8'));

beforeEach(() => {
    InnerMap.initialize(innerMapData());
    InnerMap._cache = {};
    InnerMap.season = 'summer';
    Utils.setSeed(7);
});

const HQ = 20, HR = 20; // the hex we look at

/**
 * A mock world: land everywhere (`land` terrain) unless `terrainAt(q, r)` says
 * otherwise; `rivers` maps 'q,r' → riverDir for river hexes.
 */
function makeWorld({ land = 'grassland', terrainAt = () => null, rivers = {}, settlement = null, extra = {} } = {}) {
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) {
            const id = terrainAt(q, r) || land;
            const t = { q, r, terrain: { id, passable: !['ocean', 'lake'].includes(id) }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
            if (rivers[k] !== undefined) { t.hasRiver = true; t.riverDir = rivers[k]; }
            if (q === HQ && r === HR) { Object.assign(t, extra); if (settlement) { t.settlement = settlement; settlement.q = q; settlement.r = r; } }
            tiles.set(k, t);
        }
        return tiles.get(k);
    };
    const world = {
        day: 1, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: 3 }, activeEvents: [], kingdoms: [],
        getTile: (q, r) => at(q, r),
        getSettlementViews: () => (settlement ? [settlement] : []),
        getKingdom: () => null,
    };
    return { world, player: { ships: [] } };
}

/** A river flowing in from the east neighbour and out to the west one */
function riverEW(opts = {}) {
    const e = Hex.neighbors(HQ, HR)[0];
    return makeWorld({ ...opts, rivers: { [`${HQ},${HR}`]: 3, [`${e.q},${e.r}`]: 3, ...(opts.rivers || {}) } });
}

const gen = (g) => InnerMap.generate(g.world.getTile(HQ, HR), HQ, HR, g);
const cells = (tiles, pred) => { const out = []; tiles.forEach((row, r) => row.forEach((t, q) => { if (pred(t, q, r)) out.push({ q, r, t }); })); return out; };

/** Flood the walkable cells from (q, r) (4-way): how many can be reached */
function reach(tiles, q0, r0) {
    const H = tiles.length, W = tiles[0].length;
    const seen = new Uint8Array(W * H);
    const stack = [r0 * W + q0];
    seen[r0 * W + q0] = 1;
    let n = 0;
    while (stack.length) {
        const i = stack.pop();
        n++;
        const q = i % W, r = (i - q) / W;
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = q + dq, y = r + dr;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const k = y * W + x;
            if (seen[k] || !tiles[y][x].subTerrain.passable) continue;
            seen[k] = 1;
            stack.push(k);
        }
    }
    return { n, seen };
}

describe('ponds', () => {
    it('are big organic blobs, more and larger on a wet swamp than on dry plains', () => {
        let swamp = 0, plains = 0, biggest = 0;
        for (let i = 0; i < 12; i++) {
            const s = gen(makeWorld({ land: 'swamp', extra: { moisture: 0.8 } }));
            const n = cells(s, t => t._waterKind === 'pond').length;
            swamp += n;
            biggest = Math.max(biggest, n);
            InnerMap.width = InnerMap.height = InnerMap.INNER_MAP_SIZE;
            plains += cells(InnerMap.generate({ q: 40 + i, r: 9, terrain: { id: 'plains' }, elevation: 0.5, temperature: 0.5, moisture: 0.2 }, 40 + i, 9, null), t => t._waterKind === 'pond').length;
        }
        expect(swamp).toBeGreaterThan(plains * 2);
        expect(biggest).toBeGreaterThan(150);
    });

    it('vary in size from hex to hex', () => {
        const sizes = [];
        for (let i = 0; i < 16; i++) {
            const tiles = InnerMap.generate({ q: i, r: 3, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.6 }, i, 3, null);
            const n = cells(tiles, t => t._waterKind === 'pond').length;
            if (n) sizes.push(n);
        }
        expect(sizes.length).toBeGreaterThan(4);
        expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes) * 3);
    });

    it('leave no dry pocket cut off: every walkable cell is reachable from the start', () => {
        for (let i = 0; i < 6; i++) {
            const tiles = InnerMap.generate({ q: i, r: 11, terrain: { id: 'swamp' }, elevation: 0.5, temperature: 0.5, moisture: 0.9 }, i, 11, null);
            const W = tiles[0].length;
            const { seen } = reach(tiles, W >> 1, tiles.length >> 1);
            const stranded = cells(tiles, (t, q, r) => t.subTerrain.passable && !t._wet && !seen[r * W + q] && !t.customObject && !t.customObjectPart);
            expect(stranded.length).toBe(0);
        }
    });
});

describe('a river across the map', () => {
    it('runs from the east edge to the west edge in river water', () => {
        const tiles = gen(riverEW());
        const W = tiles[0].length, H = tiles.length;
        const river = cells(tiles, t => t._waterKind === 'river');
        expect(river.length).toBeGreaterThan(400);
        expect(river.some(c => c.q === W - 1)).toBe(true);
        expect(river.some(c => c.q === 0)).toBe(true);
        // not the top or bottom
        expect(river.some(c => c.r === 0 || c.r === H - 1)).toBe(false);
        // impassable river water in the middle of it, walkable shallows at its banks
        expect(river.some(c => c.t.subTerrain.id === 'river_water' && !c.t.subTerrain.passable)).toBe(true);
        expect(river.some(c => c.t._shallow && c.t.subTerrain.passable)).toBe(true);
        // drawn with the LPC water (and its deep water down the middle)
        expect(river.every(c => c.t.terrainDetail && c.t.terrainDetail.layer === 'water')).toBe(true);
        expect(river.some(c => c.t._deep)).toBe(true);
    });

    it('is the same every time (seeded by the hex)', () => {
        const key = (tiles) => cells(tiles, t => t._waterKind === 'river').map(c => `${c.q},${c.r}`).join('|');
        expect(key(gen(riverEW()))).toBe(key(gen(riverEW())));
    });

    it('comes into the next hex where it left this one', () => {
        const g = riverEW();
        const tiles = gen(g);
        const out = cells(tiles, (t, q) => q === 0 && t._waterKind === 'river').map(c => c.r);
        // the west neighbour: the river flows in by its east side
        const w = Hex.neighbors(HQ, HR)[3];
        g.world.getTile(w.q, w.r).hasRiver = true;
        g.world.getTile(w.q, w.r).riverDir = 3;
        const next = InnerMap.generate(g.world.getTile(w.q, w.r), w.q, w.r, g);
        const W = next[0].length;
        const inn = cells(next, (t, q) => q === W - 1 && t._waterKind === 'river').map(c => c.r);
        const mid = (a) => a.reduce((s, v) => s + v, 0) / a.length;
        expect(Math.abs(mid(out) - mid(inn))).toBeLessThan(4);
    });

    it('has a ford across it in the wilds, so the map is never cut in two', () => {
        const tiles = gen(riverEW());
        const fords = cells(tiles, t => t._ford);
        expect(fords.length).toBeGreaterThan(2);
        expect(fords.every(c => c.t.subTerrain.passable && c.t.subTerrain.id === 'ford')).toBe(true);
        // north of the river and south of it are joined: the top-left and bottom-left corners both reachable from the start
        const W = tiles[0].length, H = tiles.length;
        const { seen } = reach(tiles, W >> 1, H >> 1);
        const firstDry = (r0, dr) => { for (let r = r0; r >= 0 && r < H; r += dr) if (tiles[r][4].subTerrain.passable && !tiles[r][4]._wet) return r * W + 4; return -1; };
        expect(seen[firstDry(2, 1)]).toBe(1);
        expect(seen[firstDry(H - 3, -1)]).toBe(1);
    });

    it('keeps the middle of the map (where you come in) dry', () => {
        const tiles = gen(riverEW());
        const c = tiles.length >> 1;
        for (let dr = -3; dr <= 3; dr++) for (let dq = -3; dq <= 3; dq++) expect(tiles[c + dr][c + dq]._wet).toBeFalsy();
    });

    it('a source hex starts at a spring and runs out by its side', () => {
        const g = makeWorld({ rivers: { [`${HQ},${HR}`]: 5 }, extra: { riverSource: true } });
        const tiles = gen(g);
        const H = tiles.length;
        const river = cells(tiles, t => t._waterKind === 'river');
        expect(river.length).toBeGreaterThan(150);
        expect(river.some(c => c.r === H - 1)).toBe(true);
        expect(river.some(c => c.q === 0 || c.q === tiles[0].length - 1 || c.r === 0)).toBe(false);
    });

    it('a river running into the sea joins it', () => {
        const e = Hex.neighbors(HQ, HR)[0];
        const w = Hex.neighbors(HQ, HR)[3];
        const g = makeWorld({ terrainAt: (q, r) => (q === w.q && r === w.r ? 'ocean' : null), rivers: { [`${HQ},${HR}`]: 3, [`${e.q},${e.r}`]: 3 } });
        const tiles = gen(g);
        const river = cells(tiles, t => t._waterKind === 'river');
        expect(river.length).toBeGreaterThan(200);
        // the river reaches sea water: some river cell touches a sea cell
        const touches = river.some(({ q, r }) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dq, dr]) => tiles[r + dr] && tiles[r + dr][q + dq] && tiles[r + dr][q + dq]._waterKind === 'sea'));
        expect(touches).toBe(true);
    });

    it('in a town: bridged where a street crosses, never over a building, lot or the town\'s heart', () => {
        for (const type of ['village', 'town', 'city']) {
            InnerMap._cache = {};
            const g = riverEW({ settlement: { name: 'Riverby', type, population: 1500, kingdom: null } });
            const tiles = gen(g);
            const wet = cells(tiles, t => t._wet);
            expect(wet.length, type).toBeGreaterThan(100);
            for (const { t } of wet) {
                expect(t.building || t.customBuilding || t.customBuildingPart || t._lot || t._townCore, type).toBeFalsy();
            }
            const bridges = cells(tiles, t => t._bridge);
            expect(bridges.length, type).toBeGreaterThan(0);
            for (const { t } of bridges) {
                expect(t.isRoad).toBe(true);
                expect(t.subTerrain.passable).toBe(true);
                expect(t.paving && t.paving.sheetPath).toMatch(/Bridge/);
            }
            // the streets still run on: the road tiles kept for enter() are dry or bridged
            for (const p of tiles._settlementLayout.roadTiles) {
                const t = tiles[p.r][p.q];
                expect(!t._wet || t._bridge || t._ford).toBe(true);
            }
        }
    });

    it('a crowded capital still has its river (a narrower stream threads the town)', () => {
        InnerMap._cache = {};
        const tiles = gen(riverEW({ settlement: { name: 'Crownmere', type: 'capital', population: 30000, kingdom: null } }));
        const river = cells(tiles, t => t._waterKind === 'river');
        expect(river.length).toBeGreaterThan(60);
        for (const { t } of river) expect(t.building || t.customBuilding || t.customBuildingPart || t._lot || t._townCore).toBeFalsy();
    });

    it('a bridge runs straight across, even where the street wanders', () => {
        // a street that jogs sideways under the river: the planks become one straight span
        const W = 20;
        const at = (q, r) => r * W + q;
        const road = [at(5, 2), at(5, 3), at(6, 4), at(6, 5), at(7, 6)];
        const near = new Map();
        for (let r = 2; r <= 6; r++) for (let q = 0; q < W; q++) near.set(at(q, r), {});
        const { cells, dropped } = InnerMap._straightBridges(road, near, W, () => 'EW');
        const cols = new Set(cells.map(c => c % W));
        expect([...cols].sort()).toEqual([5, 6, 7]);
        // every row of the span has the same width: no jogs
        for (let r = 2; r <= 6; r++) expect(cells.filter(c => Math.floor(c / W) === r).length).toBe(3);
        expect(dropped).toEqual([]);
    });

    it('a world road that fords the river fords it in town too', () => {
        const tiles = gen(riverEW({ settlement: { name: 'Fordham', type: 'village', population: 400, kingdom: null }, extra: { roadCross: 'ford' } }));
        expect(cells(tiles, t => t._bridge).length).toBe(0);
        const fords = cells(tiles, t => t._ford && t.isRoad);
        expect(fords.length).toBeGreaterThan(0);
        expect(fords.every(c => c.t.subTerrain.passable)).toBe(true);
    });

    it('no river on a hex without one', () => {
        const tiles = gen(makeWorld());
        expect(cells(tiles, t => t._waterKind === 'river').length).toBe(0);
    });
});

describe('a lake hex', () => {
    it('is a large lake with shore along the sides facing land, your ship in the middle', () => {
        const g = makeWorld({ terrainAt: (q, r) => (q === HQ && r === HR ? 'lake' : null) });
        g.player.ships = [{ id: 's1', typeId: 'sloop', name: 'Heron', q: HQ, r: HR, status: 'sailing' }];
        g.player.boardedShip = 's1';
        const tiles = gen(g);
        const W = tiles[0].length, H = tiles.length;
        const lake = cells(tiles, t => t._wet);
        expect(lake.length).toBeGreaterThan(W * H * 0.35);
        expect(lake.length).toBeLessThan(W * H * 0.85);
        // land all round the edge (every neighbour is land)
        expect(tiles[2][2]._wet).toBeFalsy();
        expect(tiles[H >> 1][1]._wet).toBeFalsy();
        expect(tiles[H - 2][W >> 1]._wet).toBeFalsy();
        // lake water, open for the ship, with the ship and you on its deck
        expect(lake.some(c => c.t.subTerrain.id === 'lake_water' && c.t._sea)).toBe(true);
        const me = tiles[H >> 1][W >> 1];
        expect(me._deck).toBe(true);
        // the shore is the land about it: grass and the like, not lake
        expect(tiles[3][3].subTerrain.id).not.toMatch(/lake/);
    });

    it('runs off the map toward more water', () => {
        const e = Hex.neighbors(HQ, HR)[0];
        const g = makeWorld({ terrainAt: (q, r) => ((q === HQ && r === HR) || (q === e.q && r === e.r) ? 'lake' : null) });
        const tiles = gen(g);
        const W = tiles[0].length, H = tiles.length;
        expect(tiles[H >> 1][W - 1]._wet).toBe(true);
        expect(tiles[H >> 1][0]._wet).toBeFalsy();
    });

    it('a river flowing into the lake runs into it', () => {
        const e = Hex.neighbors(HQ, HR)[0];
        const g = makeWorld({ terrainAt: (q, r) => (q === HQ && r === HR ? 'lake' : null), rivers: { [`${e.q},${e.r}`]: 3 } });
        const tiles = gen(g);
        const W = tiles[0].length;
        const river = cells(tiles, t => t._waterKind === 'river');
        expect(river.some(c => c.q === W - 1)).toBe(true);
    });
});

describe('shore dressing', () => {
    it('sparse reeds, lilies and stones by the water — decals only, never on a bridge', () => {
        let dressed = 0, wetCells = 0;
        for (let i = 0; i < 4; i++) {
            const tiles = InnerMap.generate({ q: i, r: 30, terrain: { id: 'swamp' }, elevation: 0.5, temperature: 0.5, moisture: 0.8 }, i, 30, null);
            wetCells += cells(tiles, t => t._wet).length;
            for (const { t } of cells(tiles, x => x.decor)) {
                dressed++;
                for (const d of t.decor) expect(d.sheetPath).toMatch(/assets\/lpc\/Terrain\//);
                expect(t._bridge).toBeFalsy();
            }
        }
        expect(dressed).toBeGreaterThan(10);
        expect(dressed).toBeLessThan(wetCells * 0.2);
    });
});

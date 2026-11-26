/**
 * The player's properties out in the country stand where their trade puts them
 * (world/innerMap/propertySites.js, data/lots.json wildSites): a mill on the
 * riverbank with its wheel's wall against the stream, a windmill on open ground
 * away from water when the hex has none, a farm beside its fenced field, a
 * wharf at the shore, a mine against the rock face — tile-composed buildings of
 * their kind, never on each other, a road or the water, the same every visit.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Hex, CustomBuildings, CustomObjects;

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
    ({ CustomBuildings } = await import('../world/customBuildings.js'));
    ({ CustomObjects } = await import('../world/customObjects.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
    vi.spyOn(console, 'log').mockImplementation(() => {});
}, 120000);

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    InnerMap.season = 'summer';
    Utils.setSeed(7);
});

const prop = (type, name) => ({ type, name: name || type, icon: '🏠', underConstruction: false, level: 1 });

/** A mock world: `rivers` maps 'q,r' → riverDir; the properties on (hq, hr) */
function makeWorld({ hq, hr, rivers = {}, terrain = 'grassland', terrainAt = () => null, props = [] }) {
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) {
            const id = terrainAt(q, r) || terrain;
            const t = { q, r, terrain: { id, passable: !['ocean', 'lake'].includes(id) }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
            if (rivers[k] !== undefined) { t.hasRiver = true; t.riverDir = rivers[k]; }
            if (q === hq && r === hr) { t.playerProperties = props; t.playerProperty = props[0]; }
            tiles.set(k, t);
        }
        return tiles.get(k);
    };
    const world = {
        day: 40, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: 9 }, activeEvents: [], kingdoms: [],
        getTile: (q, r) => at(q, r), getSettlementViews: () => [], getKingdom: () => null,
    };
    return { world, player: { ships: [] } };
}

function riverWorld(hq, hr, inDir, outDir, props) {
    const up = Hex.neighbors(hq, hr)[inDir];
    return makeWorld({ hq, hr, props, rivers: { [`${hq},${hr}`]: outDir, [`${up.q},${up.r}`]: (inDir + 3) % 6 } });
}

const gen = (g, hq, hr) => { InnerMap._cache = {}; return InnerMap.generate(g.world.getTile(hq, hr), hq, hr, g); };

const isWater = t => !!(t && t._wet && !t._bridge && !t._ford);

/** Where a property stands: its anchor tile's building and design */
function standing(tiles, p) {
    const t = tiles[p.innerR] && tiles[p.innerR][p.innerQ];
    expect(t, `${p.type} has a spot`).toBeTruthy();
    expect(t._propertyRef).toBe(p);
    const def = t.customBuilding && CustomBuildings.getBuilding(t.customBuilding.defId);
    return { t, def, q: p.innerQ, r: p.innerR };
}

/** Every cell each property's building covers (its bounds), keyed 'q,r' → the property */
function footprints(tiles, props) {
    const cells = new Map();
    for (const p of props) {
        const { def, q, r } = standing(tiles, p);
        if (!def) continue;
        const b = def.bounds;
        for (let y = r + b.minRow; y <= r + b.maxRow; y++) for (let x = q + b.minCol; x <= q + b.maxCol; x++) {
            expect(cells.has(`${x},${y}`), `${p.type} overlaps ${cells.get(`${x},${y}`) && cells.get(`${x},${y}`).type} at ${x},${y}`).toBe(false);
            cells.set(`${x},${y}`, p);
        }
    }
    return cells;
}

const CASES = [[20, 20, 0, 3], [21, 18, 1, 4], [17, 24, 2, 5], [30, 12, 0, 2], [12, 30, 5, 1], [26, 26, 4, 0]];

describe('a mill out in the country', () => {
    it('stands on the riverbank, a gable wall against the stream, its wheel in the race', () => {
        let onBank = 0;
        for (const [hq, hr, i, o] of CASES) {
            const mill = prop('grain_mill', 'Mill');
            const g = riverWorld(hq, hr, i, o, [mill]);
            const tiles = gen(g, hq, hr);
            const { def, t, q, r } = standing(tiles, mill);
            expect(def && def.buildingType, `${hq},${hr}`).toBe('mill');
            const wheel = t.customBuilding.wheel;
            if (!wheel) continue;
            const { minCol, maxCol, maxRow } = def.bounds;
            const col = wheel.side > 0 ? q + maxCol + 1 : q + minCol - 1;
            const foot = r + maxRow;
            // the water at the wall's foot and running on out from it
            expect(isWater(tiles[foot][col]) && isWater(tiles[foot][col + wheel.side]) && isWater(tiles[foot][col + 2 * wheel.side]), `${hq},${hr}`).toBe(true);
            // its footprint dry, its door onto dry land
            for (const c of def.meta) expect(tiles[r + c.r][q + c.q]._wet).toBeFalsy();
            const door = def.meta.find(c => c.door);
            expect(tiles[r + door.r + 1][q + door.q]._wet).toBeFalsy();
            onBank++;
        }
        expect(onBank).toBeGreaterThanOrEqual(CASES.length - 1);
    });

    it('with no water on the hex is a windmill on open ground, well back from any water', () => {
        for (let k = 0; k < 4; k++) {
            const mill = prop('grain_mill', 'Mill');
            const g = makeWorld({ hq: 40 + k, hr: 10, props: [mill] });
            const tiles = gen(g, 40 + k, 10);
            const { def, t, q, r } = standing(tiles, mill);
            expect(def.buildingType).toBe('mill');
            expect(t.customBuilding.wheel).toBeUndefined();
            const b = def.bounds;
            for (let y = r + b.minRow - 3; y <= r + b.maxRow + 3; y++) for (let x = q + b.minCol - 3; x <= q + b.maxCol + 3; x++) {
                expect(isWater(tiles[y] && tiles[y][x])).toBe(false);
            }
        }
    });

    it('stands in the same place, of the same design, every time', () => {
        const a = prop('grain_mill'), b = prop('farm');
        const t1 = gen(riverWorld(20, 20, 0, 3, [a, b]), 20, 20);
        const first = [a.innerQ, a.innerR, b.innerQ, b.innerR, t1[a.innerR][a.innerQ].customBuilding.defId];
        const a2 = prop('grain_mill'), b2 = prop('farm');
        const t2 = gen(riverWorld(20, 20, 0, 3, [a2, b2]), 20, 20);
        expect([a2.innerQ, a2.innerR, b2.innerQ, b2.innerR, t2[a2.innerR][a2.innerQ].customBuilding.defId]).toEqual(first);
    });
});

describe('each kind where its trade puts it', () => {
    it('several properties on one hex never stand on each other, a road or the water, nor near the middle', () => {
        const props = [prop('grain_mill'), prop('sawmill'), prop('farm'), prop('logging_camp'), prop('workshop'), prop('pasture'), prop('orchard'), prop('tavern')];
        const g = riverWorld(21, 18, 1, 4, props);
        const tiles = gen(g, 21, 18);
        const cells = footprints(tiles, props);
        const H = tiles.length, W = tiles[0].length;
        for (const k of cells.keys()) {
            const [x, y] = k.split(',').map(Number);
            const t = tiles[y][x];
            expect(t._wet, `wet under ${cells.get(k).type}`).toBeFalsy();
            expect(t.isRoad).toBeFalsy();
            expect(Math.abs(x - Math.floor(W / 2)) <= 5 && Math.abs(y - Math.floor(H / 2)) <= 5, `${cells.get(k).type} in the middle`).toBe(false);
        }
        // every one a tile-composed building, none a pasted sprite
        for (const p of props) expect(standing(tiles, p).def, p.type).toBeTruthy();
        for (const row of tiles) for (const t of row) expect(!!(t.building && t._buildingTypeHint === 'player_property')).toBe(false);
    });

    it('a farm stands by its fenced field, a pasture by its fenced paddock', () => {
        const farm = prop('farm'), pasture = prop('pasture');
        const g = makeWorld({ hq: 44, hr: 30, props: [farm, pasture] });
        const tiles = gen(g, 44, 30);
        const near = (p, test, reach = 14) => {
            const { def, q, r } = standing(tiles, p);
            let n = 0;
            for (let y = r + def.bounds.minRow - reach; y <= r + reach; y++) for (let x = q + def.bounds.minCol - reach; x <= q + def.bounds.maxCol + reach; x++) {
                const o = tiles[y] && tiles[y][x] && tiles[y][x].customObject;
                if (o && test(o.defId)) n++;
            }
            return n;
        };
        expect(near(farm, id => /^tp_field_/.test(id))).toBeGreaterThan(0);
        expect(near(farm, id => /^tp_fence_/.test(id))).toBeGreaterThan(8);
        expect(near(pasture, id => /^tp_fence_/.test(id))).toBeGreaterThan(8);
        expect(near(pasture, id => id === 'tp_fence_gate')).toBe(1);
    });

    it('a fishing wharf stands at the water\'s edge, a mine against a crag\'s rock face', () => {
        const wharf = prop('fishing_wharf');
        const tiles = gen(riverWorld(17, 24, 2, 5, [wharf]), 17, 24);
        const w = standing(tiles, wharf);
        const b = w.def.bounds;
        let wet = 0;
        for (let y = w.r + b.minRow - 1; y <= w.r + b.maxRow + 1; y++) for (let x = w.q + b.minCol - 3; x <= w.q + b.maxCol + 3; x++) if (isWater(tiles[y] && tiles[y][x])) wet++;
        expect(wet).toBeGreaterThan(0);

        const mine = prop('mine');
        const g = makeWorld({ hq: 33, hr: 9, terrain: 'mountain', props: [mine] });
        const mt = gen(g, 33, 9);
        const m = standing(mt, mine);
        const mb = m.def.bounds;
        let face = false;
        for (let y = m.r + mb.minRow - 4; y <= m.r + mb.maxRow + 4 && !face; y++) for (let x = m.q + mb.minCol - 4; x <= m.q + mb.maxCol + 4; x++) {
            const t = mt[y] && mt[y][x];
            if (t && t.subTerrain && t.subTerrain.id === 'cliff') { face = true; break; }
        }
        expect(face).toBe(true);
    });

    it('enters as a property of its own: named, managed, its design\'s interior', () => {
        const mill = prop('grain_mill', 'Old Mill');
        const g = riverWorld(20, 20, 0, 3, [mill]);
        InnerMap._cache = {};
        InnerMap.enter({ ...g, world: g.world }, 20, 20);
        const b = InnerMap.buildings.find(x => x.propertyRef === mill);
        expect(b).toBeTruthy();
        expect(b.name).toBe('Old Mill');
        expect(b.actions).toContain('manage_property');
        expect(b._customDefId).toBe(InnerMap.getTile(mill.innerQ, mill.innerR).customBuilding.defId);
    });
});

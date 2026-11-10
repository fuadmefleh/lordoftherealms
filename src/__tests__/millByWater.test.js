/**
 * The town's mill on the water (world/innerMap/mills.js): in a world made
 * since terrainGen 5, a town with a river (or a shore) beside it stands its
 * mill on the bank with a gable wall against the water, where its wheel turns
 * (ui/innerMapLayers/ambient.js); an older world's town keeps its mill where
 * the planner put it; a town with no water keeps it at its edge.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Hex, CustomBuildings;

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
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    InnerMap.season = 'summer';
    Utils.setSeed(7);
});

/** A mock world: `rivers` maps 'q,r' → riverDir; the town on (hq, hr) */
function makeWorld({ hq, hr, terrainGen = 5, rivers = {}, terrainAt = () => null, settlement }) {
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) {
            const id = terrainAt(q, r) || 'grassland';
            const t = { q, r, terrain: { id, passable: !['ocean', 'lake'].includes(id) }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
            if (rivers[k] !== undefined) { t.hasRiver = true; t.riverDir = rivers[k]; }
            if (q === hq && r === hr && settlement) { t.settlement = settlement; settlement.q = q; settlement.r = r; }
            tiles.set(k, t);
        }
        return tiles.get(k);
    };
    const world = {
        day: 1, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen }, activeEvents: [], kingdoms: [],
        getTile: (q, r) => at(q, r),
        getSettlementViews: () => [settlement],
        getKingdom: () => null,
    };
    return { world, player: { ships: [] } };
}

/** A river through (hq, hr), in by side `inDir` and out by side `outDir` (Hex directions) */
function riverWorld(hq, hr, inDir, outDir, type = 'town', terrainGen = 5) {
    const up = Hex.neighbors(hq, hr)[inDir];
    const settlement = { name: `Mill${hq}x${hr}`, type, population: 1500, kingdom: null };
    return makeWorld({ hq, hr, terrainGen, settlement, rivers: { [`${hq},${hr}`]: outDir, [`${up.q},${up.r}`]: (inDir + 3) % 6 } });
}

function mills(tiles) {
    const out = [];
    tiles.forEach((row, r) => row.forEach((t, q) => {
        const def = t.customBuilding && CustomBuildings.getBuilding(t.customBuilding.defId);
        if (def && def.buildingType === 'mill') out.push({ q, r, def, wheel: t.customBuilding.wheel || null });
    }));
    return out;
}

const isWater = t => !!(t && t._wet && !t._bridge && !t._ford);

/** Does a gable wall's foot stand in the water? */
function touchesWater(tiles, m) {
    const { minCol, maxCol, maxRow } = m.def.bounds;
    for (const side of [1, -1]) {
        const col = side > 0 ? m.q + maxCol + 1 : m.q + minCol - 1;
        if (isWater(tiles[m.r + maxRow][col]) && isWater(tiles[m.r + maxRow + 1][col + side]) && isWater(tiles[m.r + maxRow][col + 2 * side])) return side;
    }
    return 0;
}

const CASES = [
    [20, 20, 0, 3], [21, 18, 1, 4], [17, 24, 2, 5], [30, 12, 0, 2],
    [12, 30, 5, 1], [26, 26, 4, 0], [33, 9, 3, 0], [8, 15, 2, 4],
];

describe('the mill on the water', () => {
    it('a riverside town stands its mill on the bank, a gable wall against the river', () => {
        let towns = 0, byWater = 0;
        for (const [hq, hr, i, o] of CASES) {
            const g = riverWorld(hq, hr, i, o);
            InnerMap._cache = {};
            const tiles = InnerMap.generate(g.world.getTile(hq, hr), hq, hr, g);
            const ms = mills(tiles);
            // a town by the water always has its mill (built if the plan had none)
            expect(ms.length, `${hq},${hr}`).toBeGreaterThan(0);
            towns++;
            for (const m of ms) {
                if (!m.wheel) continue;
                const side = touchesWater(tiles, m);
                expect(side, `${hq},${hr} mill at ${m.q},${m.r}`).toBe(m.wheel.side);
                // its footprint on dry ground, its door onto dry land
                for (const c of m.def.meta) expect(tiles[m.r + c.r][m.q + c.q]._wet).toBeFalsy();
                const door = m.def.meta.find(c => c.door);
                expect(tiles[m.r + door.r + 1][m.q + door.q]._wet).toBeFalsy();
                // the race runs up the wall's foot, so the water meets the wall where the wheel hangs
                const col = side > 0 ? m.q + m.def.bounds.maxCol + 1 : m.q + m.def.bounds.minCol - 1;
                const foot = m.r + m.def.bounds.maxRow;
                expect(isWater(tiles[foot - 1][col]) && isWater(tiles[foot - 2][col]), `race at ${m.q},${m.r}`).toBe(true);
                // a river runs one way or the other past it
                expect([1, -1]).toContain(m.wheel.flow);
                byWater++;
            }
        }
        // (a bank with room for it is found nearly everywhere)
        expect(byWater).toBeGreaterThanOrEqual(Math.ceil(towns * 0.75));
    });

    it('the same town puts its mill in the same place every time', () => {
        const a = riverWorld(20, 20, 0, 3);
        const t1 = InnerMap.generate(a.world.getTile(20, 20), 20, 20, a);
        InnerMap._cache = {};
        const b = riverWorld(20, 20, 0, 3);
        const t2 = InnerMap.generate(b.world.getTile(20, 20), 20, 20, b);
        expect(mills(t2).map(m => [m.q, m.r, m.def.id])).toEqual(mills(t1).map(m => [m.q, m.r, m.def.id]));
    });

    it('a world made before terrainGen 5 keeps its mill where the planner stood it', () => {
        for (const [hq, hr, i, o] of CASES.slice(0, 4)) {
            const g = riverWorld(hq, hr, i, o, 'town', 4);
            InnerMap._cache = {};
            const tiles = InnerMap.generate(g.world.getTile(hq, hr), hq, hr, g);
            for (const m of mills(tiles)) expect(m.wheel).toBeNull();
        }
    });

    it('a town with no water keeps its mill at its edge, on its street', () => {
        for (let k = 0; k < 6; k++) {
            const settlement = { name: `Dry${k}`, type: 'town', population: 1500, kingdom: null };
            const g = makeWorld({ hq: 40 + k, hr: 10, settlement });
            InnerMap._cache = {};
            const tiles = InnerMap.generate(g.world.getTile(40 + k, 10), 40 + k, 10, g);
            for (const m of mills(tiles)) {
                expect(m.wheel).toBeNull();
                const door = m.def.meta.find(c => c.door);
                expect(tiles[m.r + door.r + 1][m.q + door.q].isRoad).toBe(true);
            }
        }
    });
});

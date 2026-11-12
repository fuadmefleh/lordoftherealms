// Each culture builds its towns its own way, in worlds made since terrainGen 4
// (data/architecture.json, world/townPlanner.js): its own buildings out of the
// building kit, its own street plan, paving and square. Every such town is
// still a valid one (doors on the streets, nothing overlapping, the streets
// joined up), and towns of older worlds are laid out exactly as before.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

let InnerMap, CustomBuildings, CustomObjects, DataLoader, Cultures;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ CustomBuildings } = await import('../world/customBuildings.js'));
    ({ CustomObjects } = await import('../world/customObjects.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Cultures } = await import('../world/cultures.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

const CULTURES = ['Imperial', 'Religious', 'Arcane', 'Woodland', 'Swamp', 'Nordic', 'Mountain', 'Nomadic', 'Desert', 'Maritime'];

/** The town at (q, r) of a culture, in a world of terrainGen `gen` */
function town(culture, type = 'town', gen = 4, q = 9, r = 14) {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    const settlement = { name: 'Testby', type, population: 3000, q, r, culture };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.55, moisture: 0.5, settlement };
    const world = {
        day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31, terrainGen: gen }, activeEvents: [], kingdoms: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    InnerMap.enter({ world, player: {} }, q, r);
    return InnerMap.tiles;
}

function survey(tiles) {
    const buildings = [];
    const roads = [];
    const paving = new Set();
    let props = 0;
    for (const row of tiles) for (const t of row) {
        if (t.customBuilding) buildings.push({ q: t.q, r: t.r, def: CustomBuildings.getBuilding(t.customBuilding.defId) });
        if (t.isRoad) roads.push(t);
        if (t.paving) paving.add(`${t.paving.sx},${t.paving.sy}`);
        if (t.customObject && t.customObject.defId.startsWith('tp_')) props++;
    }
    return { buildings, roads, paving, props };
}

/** Every road tile joined to every other (four-way steps over roads) */
function roadsJoined(tiles, roads) {
    if (!roads.length) return true;
    const key = t => `${t.q},${t.r}`;
    const seen = new Set([key(roads[0])]);
    const stack = [roads[0]];
    while (stack.length) {
        const t = stack.pop();
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = tiles[t.r + dr] && tiles[t.r + dr][t.q + dq];
            if (n && n.isRoad && !seen.has(key(n))) { seen.add(key(n)); stack.push(n); }
        }
    }
    return seen.size === roads.length;
}

/** A town's layout in a line: every building's design and place, and its streets */
function signature(tiles) {
    const s = survey(tiles);
    const b = s.buildings.map(x => `${x.def.id}@${x.q},${x.r}`).sort().join(';');
    let h = 2166136261;
    const str = `${b}|${s.roads.length}`;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return `${s.buildings.length}:${s.roads.length}:${(h >>> 0).toString(16)}`;
}

describe('every culture has an architecture of its own', () => {
    it('each culture has its own buildings, kept out of the common pool', () => {
        for (const c of CULTURES) {
            expect(Cultures.architecture(c), c).toBeTruthy();
            const houses = CustomBuildings.getByCulture(c, 'house');
            expect(houses.length, c).toBeGreaterThan(8);
            for (const t of ['tavern', 'town_hall', 'church', 'blacksmith', 'granary']) expect(CustomBuildings.getByCulture(c, t).length, `${c} ${t}`).toBeGreaterThan(0);
            expect(CustomBuildings.getByType('house').some(d => d.culture)).toBe(false);
        }
    });

    it('the cultures build of different stuff: few wall-and-roof pairs are shared', () => {
        const pairs = {};
        for (const c of CULTURES) pairs[c] = new Set(CustomBuildings.getByCulture(c, 'house').map(d => `${d.wall}/${d.roof}`));
        for (let i = 0; i < CULTURES.length; i++) {
            for (let j = i + 1; j < CULTURES.length; j++) {
                const a = pairs[CULTURES[i]], b = pairs[CULTURES[j]];
                const shared = [...a].filter(p => b.has(p)).length;
                expect(shared / Math.min(a.size, b.size), `${CULTURES[i]} / ${CULTURES[j]}`).toBeLessThan(0.34);
            }
        }
    });
});

describe('a culture lays out its towns its own way (terrainGen 4)', () => {
    const towns = {};
    beforeAll(() => {
        for (const c of CULTURES) towns[c] = { tiles: town(c) };
        for (const c of CULTURES) towns[c].s = survey(towns[c].tiles);
    }, 300000);

    it('a culture\'s town is built of that culture\'s own buildings', () => {
        for (const c of CULTURES) {
            const own = towns[c].s.buildings.filter(b => b.def.culture === c).length;
            expect(own / towns[c].s.buildings.length, c).toBeGreaterThan(0.85);
            expect(towns[c].s.buildings.some(b => b.def.culture && b.def.culture !== c), c).toBe(false);
        }
    });

    it('the same place comes out differently for each culture: buildings, streets and paving', () => {
        const sigs = new Set(CULTURES.map(c => signature(towns[c].tiles)));
        expect(sigs.size).toBe(CULTURES.length);
        // Stone-paved towns and dirt-track towns
        expect(towns.Imperial.s.paving.size).toBeGreaterThan(0);
        expect(towns.Desert.s.paving.size).toBeGreaterThan(0);
        expect(towns.Woodland.s.paving.size).toBe(0);
        expect(towns.Nordic.s.paving.size).toBe(0);
        const pave = c => [...towns[c].s.paving].sort().join(';');
        expect(pave('Imperial')).not.toBe(pave('Desert'));
        expect(pave('Arcane')).not.toBe(pave('Mountain'));
        // Winding lanes against a straight grid: a winding street runs east-west in short stretches
        const meanRun = tiles => {
            const runs = [];
            for (const row of tiles) {
                let n = 0;
                for (const t of [...row, null]) {
                    if (t && t.isRoad && t._townCore) { n++; continue; }
                    if (n >= 2) runs.push(n);
                    n = 0;
                }
            }
            return runs.reduce((a, b) => a + b, 0) / Math.max(1, runs.length);
        };
        expect(meanRun(towns.Woodland.tiles)).toBeLessThan(meanRun(towns.Imperial.tiles) * 0.7);
        expect(meanRun(towns.Swamp.tiles)).toBeLessThan(meanRun(towns.Desert.tiles) * 0.7);
    });

    it('each square has its own centre piece', () => {
        const centre = (tiles) => {
            const ids = new Set();
            for (const row of tiles) for (const t of row) if (t._plaza && t.customObject) ids.add(t.customObject.defId);
            return ids;
        };
        expect(centre(towns.Imperial.tiles).has('tp_fountain')).toBe(true);
        expect(centre(towns.Desert.tiles).has('tp_pool')).toBe(true);
        expect(centre(towns.Nordic.tiles).has('tp_runestone')).toBe(true);
        // (the great oak drawn for the green: data/architecture.json Woodland plaza.centre)
        expect(centre(towns.Woodland.tiles).has('tp_tree_great_oak')).toBe(true);
        expect(centre(towns.Arcane.tiles).has('tp_column_dark')).toBe(true);
    });

    it('every town is still a sound one: doors on a road, nothing overlapping, the streets joined', () => {
        for (const c of CULTURES) {
            for (const type of ['town', 'city']) {
                const tiles = type === 'town' ? towns[c].tiles : town(c, type);
                const s = type === 'town' ? towns[c].s : survey(tiles);
                expect(s.buildings.length, `${c} ${type}`).toBeGreaterThan(15);
                const seen = new Set();
                for (const b of s.buildings) {
                    for (const m of b.def.meta || []) {
                        const k = `${b.q + m.q},${b.r + m.r}`;
                        expect(seen.has(k), `${c} ${type}: overlap at ${k}`).toBe(false);
                        seen.add(k);
                        const ft = tiles[b.r + m.r][b.q + m.q];
                        expect(!!(ft.isRoad && !m.door), `${c} ${type}: ${b.def.id} on a road`).toBe(false);
                        expect(!!(ft.customObject || ft.customObjectPart), `${c} ${type}: ${b.def.id} under a prop`).toBe(false);
                    }
                    const door = (b.def.meta || []).find(m => m.door);
                    if (!door) continue;
                    const below = tiles[b.r + door.r + 1][b.q + door.q];
                    expect(below.isRoad, `${c} ${type}: ${b.def.id} at ${b.q},${b.r}`).toBe(true);
                    expect(below.subTerrain.passable, `${c} ${type}: ${b.def.id} door blocked`).toBe(true);
                }
                expect(roadsJoined(tiles, s.roads), `${c} ${type}: streets joined`).toBe(true);
            }
        }
    }, 300000);

    it('the same culture town is planned the same way every time', () => {
        expect(signature(town('Maritime'))).toBe(signature(towns.Maritime.tiles));
    });
});

describe('inside a culture\'s houses', () => {
    it('walls and floors of the culture\'s own stuff; the common houses as before', () => {
        const inside = (def) => {
            const room = InnerMap._generateInterior({ type: def.buildingType, name: def.name, q: 3, r: 4, _customDefId: def.id }, `t_${def.id}`);
            const tiles = room.tiles || room;
            const flat = tiles.flat();
            return { wall: flat.find(t => t.baseTerrain === 'wall')._wallMaterial, floor: flat.find(t => t.baseTerrain !== 'wall' && !t._isDoor).baseTerrain };
        };
        expect(inside(CustomBuildings.getByCulture('Desert', 'house')[0])).toEqual({ wall: 'adobe', floor: 'tile_floor' });
        expect(inside(CustomBuildings.getByCulture('Nordic', 'house')[0])).toEqual({ wall: 'siding_red', floor: 'wood_floor' });
        expect(inside(CustomBuildings.getByCulture('Mountain', 'tavern')[0]).wall).toBe('fieldstone');
        expect(inside(CustomBuildings.getByType('house')[0]).wall).toBe(InnerMap.INTERIOR_LAYOUTS.house.wall);
        const art = DataLoader._gamedata.innerMapRenderer.interiorArt.walls;
        for (const c of CULTURES) expect(art[Cultures.architecture(c).interior.wall], c).toBeTruthy();
    });
});

describe('towns of older worlds are laid out as they always were', () => {
    it('a terrainGen 3 town keeps the common buildings and its old plan', () => {
        // Signatures taken from the planner before culture architecture (terrainGen 3 and 2)
        const t3 = town('Desert', 'town', 3);
        expect(survey(t3).buildings.some(b => b.def.culture)).toBe(false);
        expect(signature(t3)).toBe(OLD.desertTown3);
        expect(signature(town('Nordic', 'city', 3))).toBe(OLD.nordicCity3);
        expect(signature(town('Imperial', 'village', 2))).toBe(OLD.imperialVillage2);
    }, 120000);
});

const OLD = {
    desertTown3: '27:1046:e6da65c3',
    nordicCity3: '52:1545:bd0389db',
    imperialVillage2: '11:639:fa5dd1a7',
};

describe('a nomadic town', () => {
    it('pitches no tents among its houses', () => {
        for (const [type, q] of [['village', 4], ['town', 9], ['city', 12], ['capital', 17]]) {
            const tiles = town('Nomadic', type, 4, q, 14);
            const tents = tiles.flat().filter(t => t.customObject && /tent/.test(t.customObject.defId || ''));
            expect(tents.length).toBe(0);
        }
    });
});

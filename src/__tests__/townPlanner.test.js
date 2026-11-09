// Settlements lay themselves out along their streets (world/townPlanner.js):
// buildings front the lanes with their doors on a road, the square has its
// fountain and stalls, farmland lies round the edge, and no wild tree grows
// in the middle of town. The same place always plans the same way.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

let InnerMap, CustomBuildings, CustomObjects, DataLoader;

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
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
}, 120000);

function town(type, q = 9, r = 14) {
    const settlement = { name: `Test ${type}`, type, population: 2000, q, r };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.55, moisture: 0.5, settlement };
    const game = { world: { day: 1, season: 'Spring', generationParams: { seed: 5 }, activeEvents: [], getTile: () => worldTile, getKingdom: () => null } };
    InnerMap._cache = {};
    return InnerMap.generate(worldTile, q, r, game);
}

function survey(tiles) {
    const buildings = [];
    let trees = 0, props = 0, fountain = 0, stalls = 0, fields = 0;
    for (const row of tiles) for (const t of row) {
        if (t.customBuilding) buildings.push({ q: t.q, r: t.r, def: CustomBuildings.getBuilding(t.customBuilding.defId) });
        if (t.customObject) {
            const id = t.customObject.defId;
            if ((id === 'large_tree_1' || String(id).startsWith('tp_tree_')) && t._townCore && !t.customObject.planted) trees++;
            if (id.startsWith('tp_')) props++;
            if (id === 'tp_fountain') fountain++;
            if (id === 'tp_stall') stalls++;
            if (id.startsWith('tp_field_')) fields++;
        }
    }
    return { buildings, trees, props, fountain, stalls, fields };
}

describe('town planner', () => {
    it('a town has a street plan, a square and buildings whose doors open on a road', () => {
        const tiles = town('town');
        const s = survey(tiles);
        expect(s.buildings.length).toBeGreaterThan(20);
        expect(s.fountain).toBe(1);
        expect(s.stalls).toBeGreaterThan(0);
        expect(s.fields).toBeGreaterThan(0);
        expect(s.props).toBeGreaterThan(20);
        for (const b of s.buildings) {
            const door = (b.def.meta || []).find(m => m.door);
            if (!door) continue;
            const below = tiles[b.r + door.r + 1][b.q + door.q];
            expect(below.isRoad, `${b.def.id} at ${b.q},${b.r}`).toBe(true);
        }
    });

    it('buildings never overlap each other, the roads or a prop', () => {
        const tiles = town('capital');
        const seen = new Map();
        for (const row of tiles) for (const t of row) {
            if (!t.customBuilding) continue;
            const def = CustomBuildings.getBuilding(t.customBuilding.defId);
            for (const m of def.meta || []) {
                const k = `${t.q + m.q},${t.r + m.r}`;
                expect(seen.has(k), `overlap at ${k}`).toBe(false);
                seen.set(k, def.id);
                const ft = tiles[t.r + m.r][t.q + m.q];
                expect(ft.isRoad && !m.door).toBeFalsy();
                expect(!!ft.customObject || !!ft.customObjectPart).toBe(false);
            }
        }
        expect(seen.size).toBeGreaterThan(500);
    });

    it('the bigger the place, the more there is of it', () => {
        const counts = ['village', 'town', 'city', 'capital'].map(t => survey(town(t)).buildings.length);
        for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    });

    it('no wild trees in the middle of town', () => {
        expect(survey(town('city')).trees).toBe(0);
    });

    it('the same place is planned the same way every time', () => {
        const a = survey(town('town', 4, 4)).buildings.map(b => `${b.def.id}@${b.q},${b.r}`);
        const b = survey(town('town', 4, 4)).buildings.map(x => `${x.def.id}@${x.q},${x.r}`);
        expect(b).toEqual(a);
        const c = survey(town('town', 5, 4)).buildings.map(x => `${x.def.id}@${x.q},${x.r}`);
        expect(c).not.toEqual(a);
    });
    it('a fenced field gate stands shut, and nothing in the pen bars the way in behind it', async () => {
        const { TownProps } = await import('../world/townProps.js');
        let gates = 0;
        for (const [type, q, r] of [['village', 9, 14], ['village', 3, 7], ['town', 12, 5], ['village', 21, 30], ['town', 30, 8]]) {
            const tiles = town(type, q, r);
            for (const g of TownProps.gates(tiles)) {
                gates++;
                expect(g.open).toBe(false);
                expect(tiles[g.r][g.q].subTerrain.passable).toBe(false);
                // The gate is in the bottom run: behind it (north) lies open ground or the field itself, never a bale
                const behind = tiles[g.r - 1][g.q];
                const part = behind.customObjectPart;
                const anchor = part ? tiles[part.anchorR][part.anchorQ].customObject : behind.customObject;
                if (anchor) expect(TownProps.parseFieldId(anchor.defId), `${type} ${q},${r} gate ${g.q},${g.r}`).toBeTruthy();
                else expect(behind.subTerrain.passable).toBe(true);
            }
        }
        expect(gates).toBeGreaterThan(0);
    });
});

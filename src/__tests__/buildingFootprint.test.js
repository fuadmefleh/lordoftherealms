/**
 * Tall buildings block only their ground footprint (world/customBuildings.js footprintOf):
 * the storeys and roof above are walked behind, drawn over whoever is there
 * (ui/innerMapLayers/buildingDepth.js), and may overhang yards, paths and back gardens
 * behind a lot (world/innerMap/lots.js _reachOk / _overNearLot).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, CustomBuildings, footprintOf, Depth;

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
    ({ CustomBuildings, footprintOf } = await import('../world/customBuildings.js'));
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
    Depth = await import('../ui/innerMapLayers/buildingDepth.js');
}, 120000);

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(7);
});

const ids = () => (DataLoader._gamedata.buildings || []).map(b => b.id);

describe('Footprint-only blocking', () => {
    it('a tenement blocks its ground storey (3 rows); its upper storeys and roof are walked behind; its door is open', () => {
        const def = CustomBuildings.getBuilding('tenement_8');
        expect(def).toBeTruthy();
        const foot = CustomBuildings.footprint(def);
        expect(foot.footTop).toBe(-2);
        for (const m of def.meta) {
            if (m.door) { expect(m.impassable).toBeFalsy(); expect(m.walkBehind).toBeFalsy(); continue; }
            if (m.r >= -2) expect(m.impassable).toBe(true);
            else { expect(m.impassable).toBe(false); expect(m.walkBehind).toBe(true); }
        }
        // (the data itself is left as it was: every cell impassable)
        const raw = DataLoader._gamedata.buildings.find(b => b.id === 'tenement_8');
        expect(raw.meta.filter(m => !m.door).every(m => m.impassable)).toBe(true);
    });

    it('every design blocks at most its ground storey: never a roof cell, never more than 4 rows, doors open', () => {
        let tall = 0;
        for (const id of ids()) {
            const def = CustomBuildings.getBuilding(id);
            if (!def || !def.meta || !def.bounds) continue;
            const rows = new Set(def.meta.filter(m => m.impassable).map(m => m.r));
            expect(rows.size).toBeLessThanOrEqual(4);
            for (const m of def.meta) if (m.door) expect(m.impassable && !m.walkBehind).toBeFalsy();
            // (no roof sheet in a blocked cell's floor)
            for (const m of def.meta.filter(x => x.impassable)) {
                const c = def._layerMaps.floor && def._layerMaps.floor[`${m.q},${m.r}`];
                if (c) expect(/roofs_/.test(c.sheetPath || '')).toBe(false);
            }
            if (def.meta.some(m => m.walkBehind)) tall++;
        }
        expect(tall).toBeGreaterThan(500);
    });

    it('a cottage of three wall rows blocks its walls and not its roof; footprintRows overrides the depth', () => {
        const def = CustomBuildings.getBuilding('cottage_1');
        const f = CustomBuildings.footprint(def);
        expect(f.footTop).toBe(-2);
        expect(def.meta.filter(m => m.r < -2).every(m => m.walkBehind && !m.impassable)).toBe(true);
        const deep = footprintOf({ ...DataLoader._gamedata.buildings.find(b => b.id === 'tenement_8'), footprintRows: 5 });
        expect(deep.footTop).toBe(-4);
        expect(deep.blocks(0, -4)).toBe(true);
        expect(deep.blocks(0, -5)).toBe(false);
    });
});

/** A bare grid of grass for _standOnLot. */
function grid(W, H) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, baseTerrain: 'grassland', subTerrain: { id: 'grass', passable: true }, visible: true, explored: true });
        tiles.push(row);
    }
    return tiles;
}

describe('Tall buildings on crowded lots', () => {
    const lot = { id: 'lotA', q0: 10, q1: 16, r0: 20, r1: 23, w: 7, h: 4, gate: 'south' };

    function crowd(extra) {
        const tiles = grid(30, 30);
        for (let r = lot.r0; r <= lot.r1; r++) for (let q = lot.q0; q <= lot.q1; q++) tiles[r][q]._lot = lot.id;
        // behind the lot: a lane, then the back garden of another lot
        for (let q = 5; q < 25; q++) { tiles[18][q].isRoad = true; tiles[18][q].subTerrain.id = 'road'; }
        for (let r = 12; r <= 16; r++) for (let q = 8; q <= 18; q++) tiles[r][q]._lot = 'lotB';
        if (extra) extra(tiles);
        InnerMap.tiles = tiles;
        tiles._lots = [lot, { id: 'lotB', q0: 8, q1: 18, r0: 12, r1: 16, w: 11, h: 5 }];
        return tiles;
    }

    it('stands where only its footprint fits, its storeys over the lane and the next lot\'s garden — walked under, not blocking', () => {
        const tiles = crowd();
        // (the old rule wanted open ground behind: the lane and the other lot refused it)
        expect(InnerMap._openNearLot(lot, 12, 14, 12, 19, true)).toBe(false);
        const put = InnerMap._standOnLot(lot, 'tenement', 3, null, { overhang: 12, exact: true });
        expect(put).toBeTruthy();
        const def = CustomBuildings.getBuilding(put.defId);
        expect(def.buildingType).toBe('tenement');
        expect(put.r).toBe(lot.r1);
        let over = 0;
        for (const m of def.meta) {
            const t = tiles[put.r + m.r][put.q + m.q];
            if (m.door) expect(t.subTerrain.passable).toBe(true);
            else if (m.walkBehind) {
                expect(t.subTerrain.passable).toBe(true);
                if (m.q || m.r) expect(t.customBuildingPart.over).toBe(true);
                if (put.r + m.r < lot.r0) over++;
            } else expect(t.subTerrain.passable).toBe(false);
        }
        expect(over).toBeGreaterThan(0);
        // (the lane is still a lane; the garden lot is still free to build on)
        expect(tiles[18][put.q].isRoad).toBe(true);
        expect(InnerMap._lotHasBuilding(tiles._lots[1])).toBe(false);
        // (whoever walks the lane behind it is hidden by it; whoever is before it is not)
        expect(Depth.hidesCell(def, put.q, put.r, put.q, 18)).toBe(true);
        expect(Depth.hidesCell(def, put.q, put.r, put.q, put.r + 1)).toBe(false);
        // (and can walk the lane straight through behind it)
        InnerMap.width = 30; InnerMap.height = 30;
        const path = InnerMap._findPath(6, 18, 23, 18);
        expect(path && path.length).toBeGreaterThan(0);
    });

    it('never over water, a town wall or another building\'s ground floor', () => {
        crowd(tiles => { for (let q = 5; q < 25; q++) tiles[17][q]._wet = true; });
        expect(InnerMap._standOnLot(lot, 'tenement', 3, null, { overhang: 12, exact: true })).toBe(false);
        crowd(tiles => { for (let q = 5; q < 25; q++) tiles[16][q]._townWall = true; });
        expect(InnerMap._standOnLot(lot, 'tenement', 3, null, { overhang: 12, exact: true })).toBe(false);
        crowd(tiles => { for (let q = 5; q < 25; q++) tiles[19][q].customBuildingPart = { anchorQ: 1, anchorR: 1 }; });
        expect(InnerMap._standOnLot(lot, 'tenement', 3, null, { overhang: 12, exact: true })).toBe(false);
        // (over another's upper storeys it may: the nearer is drawn over the farther)
        const t2 = crowd(tiles => { for (let q = 5; q < 25; q++) tiles[19][q].customBuildingPart = { anchorQ: 1, anchorR: 1, over: true }; });
        expect(InnerMap._standOnLot(lot, 'tenement', 3, null, { overhang: 12, exact: true })).toBeTruthy();
        expect(t2[19][13].customBuildingPart.anchorQ).toBe(1);
    });

    it('a town\'s buildings on its map: footprints block, storeys above are passable and marked walked-behind', () => {
        const settlement = { name: 'Highrow', type: 'city', population: 9000, q: 5, r: 6, kingdom: 'k1' };
        const worldTile = { q: 5, r: 6, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
        const world = { day: 10, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
            getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null };
        InnerMap.enter({ world, player: { gold: 10, name: 'Ada' }, settlement }, 5, 6);
        let anchors = 0, behind = 0, reached = 0;
        const tiles = InnerMap.tiles;
        for (const row of tiles) for (const t of row) {
            if (!t.customBuilding) continue;
            const def = CustomBuildings.getBuilding(t.customBuilding.defId);
            if (!def || !def.meta) continue;
            anchors++;
            for (const m of def.meta) {
                const c = tiles[t.r + m.r] && tiles[t.r + m.r][t.q + m.q];
                if (!c) continue;
                if (m.door) expect(c.subTerrain.passable).toBe(true);
                else if (m.impassable) expect(c.subTerrain.passable).toBe(false);
                else if (m.walkBehind && c.customBuildingPart && c.customBuildingPart.anchorQ === t.q && c.customBuildingPart.anchorR === t.r) {
                    expect(c.customBuildingPart.over).toBe(true);
                    behind++;
                    if (reached < 1 && c.subTerrain.passable && !c._wet) {
                        const p = InnerMap._findPath(InnerMap.playerInnerQ, InnerMap.playerInnerR, t.q + m.q, t.r + m.r);
                        if (p && p.length) reached++;
                    }
                }
            }
        }
        expect(anchors).toBeGreaterThan(10);
        expect(behind).toBeGreaterThan(50);
        expect(reached).toBe(1);
    });
});

describe('Rebuilt houses (world/townRebuilds.js)', () => {
    it('a tenement put up in a house\'s place reaches its storeys over the lane and the next lot behind, never its ground floor', async () => {
        const { TownRebuilds } = await import('../world/townRebuilds.js');
        const { TownMarks } = await import('../world/townMarks.js');
        const tiles = grid(30, 30);
        const house = CustomBuildings.getBuilding('cottage_1');
        TownMarks._stand(tiles, house, 14, 22);
        const old = TownMarks._rec(14, 22, house);
        for (let q = 5; q < 25; q++) tiles[16][q].isRoad = true;
        for (let r = 11; r <= 15; r++) for (let q = 8; q <= 18; q++) tiles[r][q]._lot = 'lotB';
        const ten = CustomBuildings.getBuilding('tenement_8');
        expect(TownRebuilds._open(tiles, 14, 16, old)).toBe(false);
        expect(TownRebuilds._openOver(tiles, 14, 16, old)).toBe(true);
        const at = TownRebuilds._fit(tiles, [old], old, ten);
        expect(at).toBeTruthy();
        expect(at.y0).toBeLessThan(16);
        // (water behind: no)
        for (let q = 5; q < 25; q++) tiles[15][q]._wet = true;
        expect(TownRebuilds._fit(tiles, [old], old, ten)).toBe(null);
    });
});

describe('Depth helpers (ui/innerMapLayers/buildingDepth.js)', () => {
    it('the cutaway thins the storey above the ground floor least and the roof most', () => {
        const foot = CustomBuildings.footprint(CustomBuildings.getBuilding('tenement_8'));
        const bands = Depth.cutBands(foot);
        expect(bands[0][0]).toBe(-Infinity);
        const alphas = bands.map(b => b[2]);
        expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
        expect(bands[bands.length - 1][1]).toBe(foot.footTop);
    });

    it('shadows: west and long at morning, short at noon, east at evening, none at night', () => {
        const m = Depth.shadowVector(7.5, 8), n = Depth.shadowVector(12, 8), e = Depth.shadowVector(16.5, 8);
        expect(m.dx).toBeLessThan(0);
        expect(e.dx).toBeGreaterThan(0);
        expect(Math.hypot(m.dx, m.dy)).toBeGreaterThan(Math.hypot(n.dx, n.dy) * 2);
        expect(Depth.shadowVector(22, 8)).toBe(null);
        expect(Depth.shadowVector(3, 8)).toBe(null);
        expect(Depth.shadowVector(12, 0)).toBe(null);
    });
});

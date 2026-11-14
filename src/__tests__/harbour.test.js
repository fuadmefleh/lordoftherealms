/**
 * The shore and harbours on the inner map (world/innerMap/harbour.js) with the
 * LPC ships (world/shipHulls.js): water along the side facing the sea, a pier
 * and the town's ships in a settlement, the player's docked ships at the pier,
 * open sea and a walkable deck aboard; ships only of the kinds the town's
 * shipwrights know.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, ShipHulls, CustomObjects, TownProps;

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
    ({ ShipHulls } = await import('../world/shipHulls.js'));
    ({ TownProps } = await import('../world/townProps.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    ({ CustomObjects } = await import('../world/customObjects.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(7);
});

/** A hex at (5, 6) with the sea to the east (its E, NE and SE neighbours) */
function coastGame({ settlement = null, dawn = false, ships = [], boarded = null, here = 'grassland' } = {}) {
    const tiles = new Map();
    const land = { id: 'grassland', passable: true };
    const sea = { id: 'ocean', passable: false };
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) tiles.set(k, { q, r, terrain: q >= 6 ? sea : land, elevation: 0.5, temperature: 0.5, moisture: 0.5 });
        return tiles.get(k);
    };
    const center = at(5, 6);
    center.terrain = here === 'ocean' ? sea : land;
    center.settlement = settlement;
    if (settlement) { settlement.q = 5; settlement.r = 6; }
    const world = {
        day: 1, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: 3 }, activeEvents: [], kingdoms: [],
        dawn: dawn ? { over: false } : null,
        getTile: (q, r) => at(q, r),
        getSettlementViews: () => (settlement ? [settlement] : []),
        getKingdom: () => null,
    };
    const player = { ships, boardedShip: boarded };
    return { world, player };
}

const objects = (pred) => {
    const out = [];
    InnerMap.tiles.forEach((row, r) => row.forEach((t, q) => { if (t.customObject && pred(t.customObject)) out.push({ q, r, o: t.customObject }); }));
    return out;
};

describe('the LPC ships', () => {
    it('four hulls, each a full ship, registered as objects', () => {
        expect(ShipHulls.ids()).toEqual(['hull_skiff', 'hull_sloop', 'hull_brig', 'hull_galleon']);
        for (const id of ShipHulls.ids()) {
            const def = CustomObjects.getDef(id);
            expect(def, id).toBeTruthy();
            expect(def.tiles.length).toBeGreaterThan(100);
            expect(ShipHulls.footprint(def).length).toBeGreaterThan(10);
            // every tile is a 32px piece (the 64px cannon ports are cut up)
            for (const t of def.tiles) { expect(t.sw).toBe(32); expect(t.sh).toBe(32); }
            expect(def.sortRow).toBeLessThan(0);
        }
        expect(ShipHulls.hullFor('galleon')).toBe('hull_galleon');
    });
});

describe('the shore and the harbour', () => {
    it('a town on the sea: water on the east side, a pier into it, the town\'s ships moored', () => {
        const g = coastGame({ settlement: { name: 'Portby', type: 'town', population: 2000, kingdom: null } });
        InnerMap.enter(g, 5, 6);
        const W = InnerMap.width;
        // (the sea lies east, north-east and south-east: the western third stays dry)
        let east = 0, west = 0;
        InnerMap.tiles.forEach(row => row.forEach((t, q) => { if (t._sea) { if (q > W / 2) east++; else if (q < W * 0.3) west++; } }));
        expect(east).toBeGreaterThan(500);
        // the sea is drawn as water, not left under the grass layer
        expect(InnerMap.tiles.flat().filter(t => t._sea && t.subTerrain.id === 'sea_water').every(t => !t.terrainDetail || t.terrainDetail.layer === 'water')).toBe(true);
        expect(west).toBe(0);
        const pier = [];
        InnerMap.tiles.forEach((row, r) => row.forEach((t, q) => { if (t._pier) pier.push({ q, r, t }); }));
        expect(pier.length).toBeGreaterThan(20);
        expect(pier.every(p => p.t.subTerrain.passable && p.t.paving)).toBe(true);
        const ships = objects(o => o.harbour);
        expect(ships.length).toBe(2);
        // every hull cell of every ship lies on water
        for (const s of ships) {
            const def = CustomObjects.getDef(s.o.defId);
            for (const m of ShipHulls.footprint(def)) expect(InnerMap.tiles[s.r + m.localRow][s.q + m.localCol]._sea).toBe(true);
        }
    });

    it('a coast with no town: water, but no pier or ships', () => {
        const g = coastGame();
        InnerMap.enter(g, 5, 6);
        expect(InnerMap.tiles.some(row => row.some(t => t._sea))).toBe(true);
        expect(InnerMap.tiles.some(row => row.some(t => t._pier))).toBe(false);
        expect(objects(o => o.harbour).length).toBe(0);
    });

    it('at the dawn the shipwrights know nothing: no pier, no ships', () => {
        const g = coastGame({ settlement: { name: 'Fishby', type: 'town', population: 900, kingdom: null }, dawn: true });
        InnerMap.enter(g, 5, 6);
        expect(InnerMap.tiles.some(row => row.some(t => t._sea))).toBe(true);
        expect(InnerMap.tiles.some(row => row.some(t => t._pier))).toBe(false);
        expect(objects(o => o.harbour).length).toBe(0);
    });

    it('a village founded this year has no pier yet; a few years on it has one', () => {
        const g = coastGame({ settlement: { name: 'Newby', type: 'village', population: 40, kingdom: null, founded: 1000 } });
        g.world.year = 1001;
        InnerMap.enter(g, 5, 6);
        expect(InnerMap.tiles.some(row => row.some(t => t._pier))).toBe(false);
        const old = coastGame({ settlement: { name: 'Oldby', type: 'village', population: 40, kingdom: null, founded: 1000 } });
        old.world.year = 1004;
        InnerMap.enter(old, 5, 6);
        expect(InnerMap.tiles.some(row => row.some(t => t._pier))).toBe(true);
    });

    it('your ships docked here lie at the pier — once, however often you come', () => {
        const ships = [{ id: 'ship_1', typeId: 'galleon', name: 'Sea Wolf', q: 5, r: 6, status: 'docked' }];
        const g = coastGame({ settlement: { name: 'Portby', type: 'town', population: 2000, kingdom: null }, ships });
        InnerMap.enter(g, 5, 6);
        InnerMap.enter(g, 5, 6);
        const mine = objects(o => o.playerShip === 'ship_1');
        expect(mine.length).toBe(1);
        expect(mine[0].o.defId).toBe('hull_galleon');
        expect(mine[0].o.label).toBe('Sea Wolf');
        // sailed away: gone from the pier
        ships[0].q = 9;
        InnerMap.enter(g, 5, 6);
        expect(objects(o => o.playerShip === 'ship_1').length).toBe(0);
    });

    it('at sea aboard your ship: open water, your ship in the middle, you on its deck', () => {
        const ships = [{ id: 'ship_1', typeId: 'sloop', name: 'Gull', q: 5, r: 6, status: 'sailing' }];
        const g = coastGame({ ships, boarded: 'ship_1', here: 'ocean' });
        InnerMap.enter(g, 5, 6);
        const mine = objects(o => o.aboard);
        expect(mine.length).toBe(1);
        expect(mine[0].o.defId).toBe('hull_sloop');
        const me = InnerMap.tiles[InnerMap.playerInnerR][InnerMap.playerInnerQ];
        expect(me._deck).toBe(true);
        expect(me.subTerrain.passable).toBe(true);
        expect(InnerMap.tiles[2][2]._sea).toBe(true);
        // the deck isn't counted as deep water
        for (const row of InnerMap.tiles) {
            for (const t of row) {
                if (!t._deck) continue;
                expect(t._deep).toBeFalsy();
            }
        }
    });
});

describe('a ship struck down', () => {
    it('breaks up: the hull is gone, the water knows it, salvage floats where she lay', () => {
        const g = coastGame({ settlement: { name: 'Portby', type: 'town', population: 2000, kingdom: null } });
        InnerMap.enter(g, 5, 6);
        const [ship] = objects(o => o.harbour);
        const def = CustomObjects.getDef(ship.o.defId);
        const stamp = InnerMap._waterStamp || 0;
        InnerMap._lastWreck = null;
        InnerMap._removeCustomObject(ship.q, ship.r);
        const wreck = InnerMap._lastWreck;
        expect(wreck && wreck.defId).toBe(ship.o.defId);
        expect(InnerMap._waterStamp).toBeGreaterThan(stamp);
        expect(InnerMap.tiles[ship.r][ship.q].customObject).toBeFalsy();
        for (const m of ShipHulls.footprint(def)) expect(InnerMap.tiles[ship.r + m.localRow][ship.q + m.localCol].customObjectPart).toBeFalsy();
        const pieces = InnerMap.scatterWreck(wreck, { cargo: { wine: 6, salt: 3 } });
        const [lo, hi] = InnerMap.wreckConfig().pieces[ship.o.defId];
        expect(pieces.length).toBeGreaterThanOrEqual(Math.min(lo, 3));
        expect(pieces.length).toBeLessThanOrEqual(hi);
        for (const p of pieces) {
            const t = InnerMap.tiles[p.r][p.q];
            expect(t._sea || t._wet).toBeTruthy();
            expect(t.groundItem.placedBy).toBe('wreck');
            expect(t.groundItem.salvage.kind).toBeTruthy();
        }
        // her hold floats off in crates
        const goods = pieces.map(p => p.item.itemId);
        expect(goods).toContain('wine');
        expect(goods).toContain('salt');
        // the swimmer can reach every piece
        for (const p of pieces) expect(InnerMap.isSwimmable(p.q, p.r) || InnerMap.tiles[p.r][p.q].subTerrain.passable).toBe(true);
    });

    it('your own ship struck down leaves your fleet, her hold handed back', async () => {
        const { Ships } = await import('../systems/ships.js');
        const p = { ships: [{ id: 'ship_1', typeId: 'sloop', name: 'Gull', cargo: { fish: 4 }, customizations: [] }], boardedShip: 'ship_1' };
        const res = Ships.wreckShip(p, 'ship_1');
        expect(res.success).toBe(true);
        expect(res.cargo).toEqual({ fish: 4 });
        expect(p.ships).toEqual([]);
        expect(p.boardedShip).toBeNull();
        expect(Ships.wreckShip(p, 'ship_1').success).toBe(false);
    });
});

describe('nothing of the town lies out on the water', () => {
    it('fields, fences and props the sea reaches go whole: no part on the water, no part without its anchor', () => {
        for (const seed of [7, 19, 33]) {
            Utils.setSeed(seed);
            InnerMap._cache = {};
            const g = coastGame({ settlement: { name: 'Portby', type: 'town', population: 3000, kingdom: null } });
            g.world.generationParams.seed = 31 + seed;
            InnerMap.enter(g, 5, 6);
            const T = InnerMap.tiles;
            T.forEach((row, r) => row.forEach((t, q) => {
                if (t.customObjectPart) {
                    const a = T[t.customObjectPart.anchorR] && T[t.customObjectPart.anchorR][t.customObjectPart.anchorQ];
                    expect(a && a.customObject, `orphan part at ${q},${r} (seed ${seed})`).toBeTruthy();
                    if (!/^hull_/.test(a.customObject.defId)) expect(!!t._wet, `object part on the water at ${q},${r}`).toBe(false);
                }
                if (t.customObject && !/^hull_/.test(t.customObject.defId)) {
                    expect(!!t._wet, `object on the water at ${q},${r}`).toBe(false);
                    // all of it: every cell it draws over
                    const def = CustomObjects.getDef(t.customObject.defId) || TownProps.defs().find(d => d.id === t.customObject.defId);
                    for (const m of (def && (def.meta && def.meta.length ? def.meta : def.tiles)) || []) {
                        const c = T[r + m.localRow] && T[r + m.localRow][q + m.localCol];
                        if (c) expect(!!c._wet, `${t.customObject.defId} at ${q},${r} reaches the water at ${q + m.localCol},${r + m.localRow}`).toBe(false);
                    }
                }
            }));
        }
    });
});

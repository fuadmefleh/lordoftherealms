/**
 * The player's properties in town stand on building lots as tile-composed
 * buildings of their kind (systems/lots.js claimLotForProperty, world/lotBook.js,
 * world/innerMap/lots.js _standPlayerProperties, ui/innerMapLayers building site),
 * never as pasted whole sprites; the lot binding survives a save and load.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Lots, LotBook, PlayerEconomy, CustomBuildings, InnerMapRenderer, Construction;
let H;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    H = await import('./playtest/harness.js');
    await H.loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ Lots } = await import('../systems/lots.js'));
    ({ LotBook } = await import('../world/lotBook.js'));
    ({ PlayerEconomy } = await import('../player/playerEconomy.js'));
    ({ CustomBuildings } = await import('../world/customBuildings.js'));
    ({ Construction } = await import('../systems/construction.js'));
    ({ InnerMapRenderer } = await import('../ui/innerMapRenderer.js'));
    await import('../ui/innerMapLayers.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
    vi.spyOn(console, 'log').mockImplementation(() => {});
}, 120000);

function setup(type) {
    const settlement = { name: `Plotby-${type}`, type, population: 2000, q: 5, r: 6, kingdom: 'k1' };
    const worldTile = { q: 5, r: 6, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 10, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
        getAllSettlements: () => [settlement],
    };
    const player = { gold: 20000, name: 'Ada', skills: { commerce: 0 }, properties: [], q: 5, r: 6 };
    return { game: { world, player, settlement }, settlement, world, worldTile, player };
}

function enter(ctx) {
    InnerMap._cache = {};
    InnerMap.enter(ctx.game, 5, 6);
    return ctx;
}

/** A building's anchor on its lot: within its stakes (a tall design may reach up to 4 rows past its back). */
function inLot(lot, q, r) { return q >= lot.q0 && q <= lot.q1 && r >= lot.r0 && r <= lot.r1 + 4; }

/** No player property pasted as a whole sprite anywhere on the map. */
function noPastedSprites() {
    for (const row of InnerMap.tiles) for (const t of row) {
        if (t && t.building && t._buildingTypeHint === 'player_property') return false;
    }
    return true;
}

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(7);
});

describe('A property built in town takes a lot', () => {
    it('buys a free lot with the build, and binds the property to it', () => {
        const ctx = enter(setup('town'));
        const { player, worldTile, settlement, world } = ctx;
        const free = LotBook.freeLots(settlement).sort((a, b) => a.price - b.price)[0];
        expect(free).toBeTruthy();
        const gold = player.gold;
        const res = PlayerEconomy.buildProperty(player, 'WORKSHOP', worldTile, world);
        expect(res.success).toBe(true);
        expect(res.lotId).toBe(free.id);
        expect(res.lotPrice).toBe(free.price);
        expect(res.property.lotId).toBe(free.id);
        const cost = res.property.cost;
        expect(player.gold).toBe(gold - cost - free.price);
        const rec = LotBook.lot(settlement, free.id);
        expect(LotBook.isPlayer(rec)).toBe(true);
        expect(rec.built).toMatchObject({ kind: 'property', type: 'workshop', by: 'player' });
        expect(player.lotHoldings.some(h => h.kind === 'lot' && h.id === free.id)).toBe(true);
        // A second property takes the next lot, not the same one
        const res2 = PlayerEconomy.buildProperty(player, 'TAVERN', worldTile, world);
        expect(res2.success).toBe(true);
        expect(res2.lotId).not.toBe(free.id);
    });

    it('uses a bare lot the player already holds before buying another', () => {
        const ctx = enter(setup('village'));
        const lot = InnerMap.townLots()[2];
        expect(Lots.buyLot(ctx.player, ctx.world, ctx.settlement, lot).success).toBe(true);
        const res = PlayerEconomy.buildProperty(ctx.player, 'WORKSHOP', ctx.worldTile, ctx.world);
        expect(res.success).toBe(true);
        expect(res.lotId).toBe(lot.id);
        expect(res.lotPrice).toBe(0);
    });

    it('a lot chosen on the town map is the one built on', () => {
        const ctx = enter(setup('village'));
        const lot = InnerMap.townLots()[3];
        const res = PlayerEconomy.buildProperty(ctx.player, 'WORKSHOP', ctx.worldTile, ctx.world, { lotId: lot.id });
        expect(res.success).toBe(true);
        expect(res.lotId).toBe(lot.id);
    });

    it('cannot build when every lot is taken, or the lot cannot be paid for', () => {
        const ctx = enter(setup('city'));
        const book = LotBook.of(ctx.settlement);
        for (const l of LotBook.freeLots(ctx.settlement)) book.lots[l.id] = { holder: 'npc:Bram', holderName: 'Bram', price: 1, day: 0, built: null };
        const r1 = PlayerEconomy.buildProperty(ctx.player, 'WORKSHOP', ctx.worldTile, ctx.world);
        expect(r1.success).toBe(false);
        expect(r1.reason).toMatch(/lot/i);
        const ctx2 = enter(setup('city'));
        const cost = PlayerEconomy.getBuildCost(ctx2.player, PlayerEconomy.canBuildProperty(ctx2.player, 'WORKSHOP', ctx2.worldTile, ctx2.world).property, ctx2.worldTile, ctx2.world);
        ctx2.player.gold = cost; // the build, but not the lot
        const r2 = PlayerEconomy.buildProperty(ctx2.player, 'WORKSHOP', ctx2.worldTile, ctx2.world);
        expect(r2.success).toBe(false);
        expect(ctx2.player.gold).toBe(cost);
    });
});

describe('It stands on its lot as a building of its kind', () => {
    it('a workshop is a smithy, a tavern a tavern: tile-composed, inside the lot, no whole sprite', () => {
        const ctx = setup('town');
        enter(ctx);
        const shop = PlayerEconomy.buildProperty(ctx.player, 'WORKSHOP', ctx.worldTile, ctx.world).property;
        const inn = PlayerEconomy.buildProperty(ctx.player, 'TAVERN', ctx.worldTile, ctx.world).property;
        shop.underConstruction = false; inn.underConstruction = false;
        enter(ctx);
        expect(noPastedSprites()).toBe(true);
        for (const p of [shop, inn]) {
            const lot = InnerMap.townLots().find(l => l.id === p.lotId);
            expect(lot).toBeTruthy();
            expect(inLot(lot, p.innerQ, p.innerR)).toBe(true);
            const t = InnerMap.getTile(p.innerQ, p.innerR);
            expect(t.building).toBeFalsy();
            expect(t.customBuilding && t.customBuilding.lotId).toBe(lot.id);
            expect(t._propertyRef).toBe(p);
            const def = CustomBuildings.getBuilding(t.customBuilding.defId);
            expect(LotBook.propertyKinds(p.type)).toContain(def.buildingType);
            const b = InnerMap.buildings.find(x => x.propertyRef === p);
            expect(b).toBeTruthy();
            expect(b.isPlayerProperty).toBe(true);
            expect(b.type).toBe(`player_${p.type}`);
            expect(b._customDefId).toBe(t.customBuilding.defId);
        }
        expect(CustomBuildings.getBuilding(InnerMap.getTile(shop.innerQ, shop.innerR).customBuilding.defId).buildingType).toBe('blacksmith');
        expect(['tavern', 'inn']).toContain(CustomBuildings.getBuilding(InnerMap.getTile(inn.innerQ, inn.innerR).customBuilding.defId).buildingType);
    });

    it('a tall tavern reaches past its lot over bushes and trees (grubbed up), never over a memorial', () => {
        const W = 24, H = 30;
        const grid = () => Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, q) => ({ q, r, subTerrain: { passable: true } })));
        const lot = { id: 'lotT', q0: 8, q1: 15, r0: 6, r1: 12, w: 8, h: 7, gate: 'north' };
        const mark = (tiles) => { for (let r = lot.r0; r <= lot.r1; r++) for (let q = lot.q0; q <= lot.q1; q++) tiles[r][q]._lot = lot.id; };
        const bush = (tiles, q, r, memory = null) => { tiles[r][q].customObject = { defId: 'tp_bush_leafy', ...(memory ? { memory } : {}) }; tiles[r][q].subTerrain.passable = false; };
        const saved = InnerMap.tiles;
        try {
            // Bushes in the ground behind the lot: grubbed up, the tavern stands
            InnerMap.tiles = grid(); mark(InnerMap.tiles);
            for (let q = lot.q0; q <= lot.q1; q++) bush(InnerMap.tiles, q, lot.r1 + 2);
            const at = InnerMap._standOnLot(lot, 'tavern', 3, null, { exact: true, overhang: 4 });
            expect(at).toBeTruthy();
            expect(['tavern', 'inn']).toContain(CustomBuildings.getBuilding(at.defId).buildingType);
            const def = CustomBuildings.getBuilding(at.defId);
            expect(def.bounds.maxRow - def.bounds.minRow + 1).toBeGreaterThan(lot.h);
            // (under its own columns the ground is clear; beside it the bushes stand)
            for (let q = at.q + def.bounds.minCol; q <= at.q + def.bounds.maxCol; q++) {
                const t = InnerMap.tiles[lot.r1 + 2][q];
                expect(t.customObject || null).toBe(null);
            }
            // A memorial (world/townMarks.js) is never grubbed up: no overhang there
            InnerMap.tiles = grid(); mark(InnerMap.tiles);
            for (let q = lot.q0; q <= lot.q1; q++) bush(InnerMap.tiles, q, lot.r1 + 2, 'm1');
            const none = InnerMap._standOnLot(lot, 'tavern', 3, null, { exact: true, overhang: 4 });
            expect(none === false || CustomBuildings.getBuilding(none.defId).bounds.maxRow - CustomBuildings.getBuilding(none.defId).bounds.minRow + 1 <= lot.h + 1).toBe(true);
        } finally {
            InnerMap.tiles = saved;
        }
    });

    it('built while the town map is open, it stands there at once', () => {
        const ctx = enter(setup('village'));
        const res = PlayerEconomy.buildProperty(ctx.player, 'WORKSHOP', ctx.worldTile, ctx.world);
        InnerMap.placePropertyOnInnerMap(ctx.worldTile, res.property, 5, 6);
        const p = res.property;
        expect(p.innerQ).toBeDefined();
        expect(InnerMap.getTile(p.innerQ, p.innerR).customBuilding.lotId).toBe(p.lotId);
        expect(InnerMap.buildings.some(b => b.propertyRef === p)).toBe(true);
        expect(noPastedSprites()).toBe(true);
    });

    it('an older property with no lot takes one on entering; a lot whose property is gone stands bare', () => {
        const ctx = setup('village');
        const old = { type: 'workshop', name: 'Workshop', underConstruction: false, innerQ: 3, innerR: 3 };
        ctx.worldTile.playerProperties = [old];
        enter(ctx);
        expect(old.lotId).toBeTruthy();
        expect(LotBook.lot(ctx.settlement, old.lotId).built.kind).toBe('property');
        expect(ctx.player.lotHoldings.some(h => h.id === old.lotId)).toBe(true);
        expect(noPastedSprites()).toBe(true);
        // Sold off: the lot is bare again (still the player's)
        const id = old.lotId;
        ctx.worldTile.playerProperties = [];
        enter(ctx);
        expect(LotBook.lot(ctx.settlement, id).built).toBe(null);
        expect(Lots.canBuildOnLot(ctx.settlement, id).ok).toBe(true);
    });

    it('a property out in the wilds keeps its own place, off any lot', () => {
        const ctx = setup('village');
        delete ctx.worldTile.settlement;
        const res = PlayerEconomy.buildProperty(ctx.player, 'FARM', ctx.worldTile, ctx.world);
        expect(res.success).toBe(true);
        expect(res.lotId).toBe(null);
        expect(res.property.lotId).toBeUndefined();
    });
});

describe('Save and load keep the lot binding', () => {
    it('the property, its lot and the lot book come back bound; it stands on the same lot after', () => {
        let game = H.newGame(4242);
        const view = game.world.getSettlementViews().find(v => v && v.type === 'village') || game.world.getSettlementViews()[0];
        const tile = game.world.getTile(view.q, view.r);
        game.player.gold = 50000;
        const res = PlayerEconomy.buildProperty(game.player, 'WORKSHOP', tile, game.world);
        expect(res.success).toBe(true);
        const lotId = res.lotId;
        expect(lotId).toBeTruthy();
        game = H.roundTrip(game);
        const t2 = game.world.getTile(view.q, view.r);
        const p2 = (t2.playerProperties || []).find(p => p.type === 'workshop');
        expect(p2.lotId).toBe(lotId);
        const rec = LotBook.lot(t2.settlement, lotId);
        expect(LotBook.isPlayer(rec)).toBe(true);
        expect(rec.built).toMatchObject({ kind: 'property', type: 'workshop' });
        expect(game.player.lotHoldings.some(h => h.kind === 'lot' && h.id === lotId)).toBe(true);
        // Entering the town after the load: on its lot (the plan's own, or rebound to one it has)
        InnerMap._cache = {};
        game.player.q = view.q; game.player.r = view.r;
        InnerMap.enter(game, view.q, view.r);
        const lot = InnerMap.townLots().find(l => l.id === p2.lotId);
        expect(lot).toBeTruthy();
        expect(inLot(lot, p2.innerQ, p2.innerR)).toBe(true);
        expect(InnerMap.getTile(p2.innerQ, p2.innerR).customBuilding.lotId).toBe(lot.id);
        expect(noPastedSprites()).toBe(true);
    }, 120000);
});

describe('Render check: the building site and the finished building (recording canvas)', () => {
    /** A 2D context that records what is drawn. */
    function recorder() {
        const calls = [];
        const ctx = new Proxy({ canvas: { width: 4000, height: 4000 }, calls }, {
            get(target, k) {
                if (k in target) return target[k];
                return (...args) => { calls.push({ fn: k, args }); return { addColorStop() {}, width: 10 }; };
            },
            set(target, k, v) { target[k] = v; return true; },
        });
        return { ctx, calls };
    }
    const camera = { zoom: 2, worldToScreenFast: (x, y) => ({ x: x * 2 + 400, y: y * 2 + 400 }) };

    function aDesign(type) {
        return CustomBuildings.getByType(type).find(d => d.layers && (d.layers.walls || []).length > 4 && d.bounds.maxRow <= 0);
    }

    it('the walls rise course by course; the roof goes on only at the last', () => {
        const def = aDesign('blacksmith');
        expect(def).toBeTruthy();
        const at = p => InnerMapRenderer._siteCells(def, p);
        const n = p => at(p).cells.length;
        expect(n(0)).toBeLessThan(n(0.4));
        expect(n(0.4)).toBeLessThanOrEqual(n(0.79));
        expect(n(0.79)).toBeLessThan(n(0.95));
        expect(at(0.5).cells.some(c => c.layer === 'roof')).toBe(false);
        expect(at(0.9).cells.some(c => c.layer === 'roof')).toBe(true);
        // (whatever layer the kit filed them in: no roof sheet before 80%, no wall face on the first day)
        expect(at(0.5).cells.some(c => /roofs_|\/Roofing\//i.test(c.cell.sheetPath || ''))).toBe(false);
        expect(at(0).cells.some(c => /walls_|\/Walls?\/|\/Doors\//i.test(c.cell.sheetPath || ''))).toBe(false);
        // every cell shown is the design's own, never a whole sprite
        const own = new Set(['floor', 'walls', 'roof', 'overlay'].flatMap(l => (def.layers[l] || [])));
        for (const c of at(0.6).cells) expect(own.has(c.cell)).toBe(true);
    });

    it('a property under way draws as a site (fewer cells, scaffolding); finished, as the whole design', () => {
        const def = aDesign('blacksmith');
        const rec = { underConstruction: true, constructionDaysTotal: 100, constructionDaysLeft: 70, workDone: 30 };
        const site = InnerMapRenderer._siteProgress(rec);
        expect(site).toBeCloseTo(Construction.progress(rec));
        const a = recorder();
        InnerMapRenderer._drawCustomBuilding(a.ctx, camera, def, 20, 20, 64, null, site);
        const b = recorder();
        InnerMapRenderer._drawCustomBuilding(b.ctx, camera, def, 20, 20, 64, null, InnerMapRenderer._siteProgress({ ...rec, underConstruction: false }));
        const imgs = cs => cs.filter(c => c.fn === 'drawImage').length;
        expect(imgs(a.calls)).toBeGreaterThan(0);
        expect(imgs(a.calls)).toBeLessThan(imgs(b.calls));
        expect(a.calls.some(c => c.fn === 'lineTo')).toBe(true);   // the scaffolding
        expect(b.calls.some(c => c.fn === 'lineTo')).toBe(false);
    });
});

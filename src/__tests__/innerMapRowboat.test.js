/**
 * A rowboat on the street map's water (player/rowboats.js, ui/innerMapRowboat.js):
 * bought from a town's boatwright (the price into the town's purse, in whole
 * cents) or built from the packs; boarded from the bank, rowed over water and
 * never onto land, not swimming; carried by a river's current with the oars
 * at rest (not tied up), and on through the river's edge into the next hex
 * still aboard; left where it was tied up when you leave the map, and kept
 * through a save; fished and fed from where it lies.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Hex, RiverEdge, edgeCrossing, Rowboats, InnerMapRowboat, InnerMapFeedFish, SurfaceFish, SaveLoad, Player;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    await import('../ui/innerMapRenderer.js');
    await import('../ui/innerMapLayers.js');
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ Hex } = await import('../core/hex.js'));
    RiverEdge = await import('../ui/innerMapRiverEdge.js');
    ({ _edgeCrossing: edgeCrossing } = await import('../ui/game/gameLoop.js'));
    ({ Rowboats } = await import('../player/rowboats.js'));
    ({ InnerMapRowboat } = await import('../ui/innerMapRowboat.js'));
    ({ InnerMapFeedFish } = await import('../ui/innerMapFeedFish.js'));
    ({ SurfaceFish } = await import('../ui/innerMapLayers/surfaceFish.js'));
    ({ SaveLoad } = await import('../systems/saveLoad.js'));
    ({ Player } = await import('../player/player.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

const innerMapData = () => DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8'));
const HQ = 20, HR = 20;

beforeEach(() => {
    InnerMap.initialize(innerMapData());
    InnerMap._cache = {};
    InnerMap.season = 'summer';
    Utils.setSeed(7);
    InnerMapRowboat._set(null);
    InnerMapRowboat._carry = null;
    InnerMapRowboat._player = null;
});

/** A world of land; the player's hex a town with `gold` in its purse (or none) */
function townWorld(gold = 100, rivers = {}) {
    const town = gold == null ? null : { name: 'Riverby', type: 'town', population: 800, kingdom: 1, economy: { gold } };
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) {
            const t = { q, r, terrain: { id: 'grassland', name: 'Grassland', passable: true }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
            if (rivers[k] !== undefined) { t.hasRiver = true; t.riverDir = rivers[k]; }
            if (q === HQ && r === HR && town) t.settlement = town;
            tiles.set(k, t);
        }
        return tiles.get(k);
    };
    return {
        town, width: 60, height: 60, day: 3, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: 3 }, activeEvents: [], kingdoms: [],
        getTile: (q, r) => at(q, r),
        getSettlementViews: () => (town ? [{ ...town, q: HQ, r: HR }] : []),
        getKingdom: () => null,
    };
}

function makeGame(world, player = { q: HQ, r: HR, gold: 200, inventory: {}, ships: [] }) {
    const notes = [];
    const game = {
        world, player, notes, arrived: 0,
        ui: { showNotification: (title, text) => notes.push({ title, text }), updateStats() {} },
        innerMapCamera: { centerOn() {}, precomputeFrame() {} },
        exitInnerMap() { InnerMap.active = false; },
        enterInnerMap(q, r) { openGenerated(game, q, r); },
        onPlayerArrived() { game.arrived++; },
    };
    return game;
}

/** A lake across rows [r0, r1) of a W×H street map, land above and below */
function lakeMap({ W = 30, H = 16, r0 = 4, r1 = 13 } = {}) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const wet = r >= r0 && r < r1;
            row.push({ q, r, explored: true, visible: true, subTerrain: { id: wet ? 'lake_water' : 'grass', passable: !wet }, _wet: wet, _waterKind: wet ? 'lake' : undefined });
        }
        tiles.push(row);
    }
    Object.assign(InnerMap, {
        tiles, width: W, height: H, active: true, _insideBuilding: null, currentWorldTile: { q: HQ, r: HR },
        _swimAllowed: true, _driftPx: null, _deck: null, _climb: null, _climbRequest: null, _underwater: false,
    });
    InnerMap.cancelPlayerWalk();
    return tiles;
}

function openGenerated(game, q, r) {
    const tiles = InnerMap.generate(game.world.getTile(q, r), q, r, { world: game.world, player: game.player });
    Object.assign(InnerMap, {
        tiles, width: tiles[0].length, height: tiles.length, active: true, _insideBuilding: null,
        currentWorldTile: { q, r }, _swimAllowed: true, _driftPx: null, _deck: null, _climb: null, _climbRequest: null,
    });
    InnerMap.cancelPlayerWalk();
}

/** Walk (row) the whole way: the frames of updatePlayer until it stops; → seconds taken */
function walkOut(limit = 120) {
    let t = 0;
    for (; t < limit && InnerMap._playerWalking; t += 0.05) InnerMap.updatePlayer(0.05);
    return t;
}

/** Into the boat at once (the player stands beside it) */
function board(game, boat) {
    InnerMapRowboat._player = game.player;
    InnerMapRowboat.board(game, boat);
}

describe('getting a rowboat', () => {
    it('bought from the boatwright: the price goes into the town\'s purse, to the cent', () => {
        const world = townWorld(100);
        const game = makeGame(world);
        const before = game.player.gold + world.town.economy.gold;
        const res = Rowboats.buy(world, game.player, { hq: HQ, hr: HR, q: 5, r: 4 });
        expect(res.success).toBe(true);
        const price = Rowboats.price();
        expect(price).toBe(Utils.cents(Rowboats.config().price));
        expect(game.player.gold).toBe(Utils.cents(200 - price));
        expect(world.town.economy.gold).toBe(Utils.cents(100 + price));
        // (no coin made or lost: it changed hands)
        expect(game.player.gold + world.town.economy.gold).toBeCloseTo(before, 6);
        expect(game.player.rowboats).toHaveLength(1);
        expect(game.player.rowboats[0]).toMatchObject({ hq: HQ, hr: HR, q: 5, r: 4 });
    });

    it('no boatwright out in the wilds, and not on a short purse', () => {
        const wild = townWorld(null);
        expect(Rowboats.buy(wild, makeGame(wild).player, { hq: HQ, hr: HR, q: 5, r: 4 }).success).toBe(false);
        const world = townWorld(100);
        const poor = makeGame(world, { q: HQ, r: HR, gold: 10, inventory: {} }).player;
        expect(Rowboats.buy(world, poor, { hq: HQ, hr: HR, q: 5, r: 4 }).success).toBe(false);
        expect(poor.gold).toBe(10);
        expect(world.town.economy.gold).toBe(100);
    });

    it('built from the packs: the goods used up, no coin moves', () => {
        const world = townWorld(100);
        const game = makeGame(world, { q: HQ, r: HR, gold: 200, inventory: { planks: 7, rope: 1, resin: 2 } });
        const res = Rowboats.build(world, game.player, { hq: HQ, hr: HR, q: 6, r: 4 });
        expect(res.success).toBe(true);
        expect(res.hours).toBeGreaterThan(0);
        expect(game.player.inventory).toEqual({ planks: 1, resin: 1 });
        expect(game.player.gold).toBe(200);
        expect(world.town.economy.gold).toBe(100);
        expect(Rowboats.build(world, game.player, { hq: HQ, hr: HR, q: 7, r: 4 }).success).toBe(false);
    });

    it('sold back to the boatwright out of the town\'s purse', () => {
        const world = townWorld(100);
        const game = makeGame(world);
        Rowboats.buy(world, game.player, { hq: HQ, hr: HR, q: 5, r: 4 });
        const purse = world.town.economy.gold, gold = game.player.gold;
        const v = Rowboats.saleValue(world, game.player);
        expect(v).toBeGreaterThan(0);
        const res = Rowboats.sell(world, game.player, game.player.rowboats[0].id);
        expect(res.success).toBe(true);
        expect(game.player.gold).toBe(Utils.cents(gold + v));
        expect(world.town.economy.gold).toBe(Utils.cents(purse - v));
        expect(game.player.rowboats).toHaveLength(0);
    });

    it('the menu offers it on water by the bank in a town', () => {
        lakeMap();
        const world = townWorld(100);
        const game = makeGame(world);
        InnerMap.playerInnerQ = 5; InnerMap.playerInnerR = 3;
        const items = InnerMapRowboat.menuItems(game, InnerMap.tiles[4][5], 5, 4);
        expect(items.some(i => i.action === 'rowboat_buy')).toBe(true);
        // (the middle of the lake is no place to launch her)
        expect(InnerMapRowboat.menuItems(game, InnerMap.tiles[8][5], 5, 8).some(i => i.action === 'rowboat_buy')).toBe(false);
    });
});

describe('aboard: rowing over the water, not the land', () => {
    it('board from the bank, row across the lake dry, never onto land, step ashore and she stays', () => {
        lakeMap();
        const world = townWorld(100);
        const game = makeGame(world);
        const boat = Rowboats.buy(world, game.player, { hq: HQ, hr: HR, q: 5, r: 4 }).boat;
        InnerMap.playerInnerQ = 5; InnerMap.playerInnerR = 3;
        board(game, boat);
        expect(InnerMapRowboat.aboard).toBe(boat.id);
        expect(InnerMap._aboardBoat).toBe(true);
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).toEqual([5, 4]);
        // not swimming: dry, no strokes
        expect(InnerMap.isPlayerSwimming()).toBe(false);
        // the land is shut to her, the water open
        expect(InnerMap._playerMayEnter(InnerMap.tiles[3][6], 6, 3)).toBe(false);
        expect(InnerMap._playerMayEnter(InnerMap.tiles[8][6], 6, 8)).toBe(true);
        expect(InnerMap.movePlayerTo(5, 1).started).toBe(false);
        // even in winter, when no one could swim
        InnerMap._swimAllowed = false;
        const go = InnerMap.movePlayerTo(20, 12);
        expect(go.started).toBe(true);
        expect(InnerMap._playerPath.every(p => InnerMap.isSwimmable(p.q, p.r))).toBe(true);
        const steps = InnerMap._playerPath.length - 1;
        const secs = walkOut();
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).toEqual([20, 12]);
        // (about a walk's pace: far quicker than a swim)
        const swim = InnerMap.swimConfig().speed;
        expect(secs).toBeLessThan(steps / (InnerMap._playerSpeed * swim) * 0.7);
        InnerMapRowboat.update(0.05, game);
        expect(boat).toMatchObject({ q: 20, r: 12 });
        // ashore: onto the bank, the boat tied up where she lay
        expect(InnerMapRowboat.stepAshore(game)).toBe(true);
        expect(InnerMap._aboardBoat).toBe(false);
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).toEqual([20, 13]);
        expect(boat).toMatchObject({ hq: HQ, hr: HR, q: 20, r: 12 });
    });

    it('Row Ashore Here: a click on the bank rows in and steps out there', () => {
        lakeMap();
        const world = townWorld(100);
        const game = makeGame(world);
        const boat = Rowboats.buy(world, game.player, { hq: HQ, hr: HR, q: 5, r: 4 }).boat;
        InnerMap.playerInnerQ = 5; InnerMap.playerInnerR = 3;
        board(game, boat);
        expect(InnerMapRowboat.handle(game, { action: 'move_here' }, 14, 13)).toBe(true);
        walkOut();
        expect(InnerMap.runPendingAction()).toBe(true);
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).toEqual([14, 13]);
        expect(boat).toMatchObject({ q: 14, r: 12 });
    });
});

describe('the river\'s current', () => {
    function riverWorld(onward) {
        const e = Hex.neighbors(HQ, HR)[0], w = Hex.neighbors(HQ, HR)[3];
        const rivers = { [`${HQ},${HR}`]: 3, [`${e.q},${e.r}`]: 3 };
        if (onward) rivers[`${w.q},${w.r}`] = 3;
        return townWorld(100, rivers);
    }

    /** A deep river cell well away from the edges, the current running there */
    function midRiver() {
        for (let q = Math.floor(InnerMap.width / 2); q < InnerMap.width - 4; q++) {
            for (let r = 2; r < InnerMap.height - 2; r++) {
                if (!RiverEdge.isRiverSwim(InnerMap.tiles, q, r) || InnerMap._besideBank(q, r)) continue;
                if (InnerMap.currentAt(q, r)) return { q, r };
            }
        }
        return null;
    }

    function aboardAt(game, at) {
        const p = game.player;
        p.rowboats = [{ id: 'rb1', name: 'Dipper', hq: HQ, hr: HR, q: at.q, r: at.r }];
        InnerMap.playerInnerQ = at.q; InnerMap.playerInnerR = at.r;
        InnerMapRowboat._player = p;
        InnerMapRowboat._map = InnerMap.tiles;
        InnerMapRowboat._set('rb1');
        return p.rowboats[0];
    }

    it('the oars at rest, she drifts downstream; tied up or rowing, she doesn\'t', () => {
        const world = riverWorld(true);
        const game = makeGame(world);
        openGenerated(game, HQ, HR);
        const at = midRiver();
        expect(at).not.toBeNull();
        aboardAt(game, at);
        InnerMapRowboat.tied = true; InnerMap._boatTied = true;
        for (let i = 0; i < 60; i++) InnerMap.driftPlayer(0.05);
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).toEqual([at.q, at.r]);
        InnerMapRowboat.castOff(game);
        // (pulling at the oars: she holds her course)
        InnerMap._playerWalking = true;
        for (let i = 0; i < 60; i++) expect(InnerMap.driftPlayer(0.05)).toBe(null);
        InnerMap._playerWalking = false;
        let carried = null;
        for (let i = 0; i < 200 && !carried; i++) carried = InnerMap.driftPlayer(0.05);
        expect(carried && carried.carried).toBe(true);
        // (this river runs west: downstream is toward q 0)
        expect(InnerMap.playerInnerQ).toBeLessThanOrEqual(at.q);
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).not.toEqual([at.q, at.r]);
        expect(InnerMap.isPlayerSwimming()).toBe(false);
    });

    it('carried out at the river\'s edge into the next hex, still aboard: the boat comes too', async () => {
        const world = riverWorld(true);
        const game = makeGame(world);
        openGenerated(game, HQ, HR);
        let at = null;
        for (let r = 0; r < InnerMap.height && !at; r++) {
            if (RiverEdge.isRiverSwim(InnerMap.tiles, 0, r) && RiverEdge.riverCarriesOut(InnerMap.currentAt(0, r), 3)) at = { q: 0, r };
        }
        expect(at).not.toBeNull();
        const boat = aboardAt(game, at);
        edgeCrossing.riverStep(game);
        for (let i = 0; i < 50 && game._crossingEdge; i++) await new Promise(res => setTimeout(res, 0));
        const w = Hex.neighbors(HQ, HR)[3];
        expect([game.player.q, game.player.r]).toEqual([w.q, w.r]);
        expect(InnerMap._aboardBoat).toBe(true);
        expect(InnerMapRowboat.aboard).toBe('rb1');
        expect(boat).toMatchObject({ hq: w.q, hr: w.r, q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR });
        expect(game.notes.some(n => /Downstream/.test(n.title))).toBe(true);
    });

    it('where the river goes no further, the boat is held: no crossing', async () => {
        const world = riverWorld(false);
        const game = makeGame(world);
        openGenerated(game, HQ, HR);
        let at = null;
        for (let r = 0; r < InnerMap.height && !at; r++) {
            if (RiverEdge.isRiverSwim(InnerMap.tiles, 0, r) && RiverEdge.riverCarriesOut(InnerMap.currentAt(0, r), 3)) at = { q: 0, r };
        }
        expect(at).not.toBeNull();
        aboardAt(game, at);
        edgeCrossing.riverStep(game);
        expect([game.player.q, game.player.r]).toEqual([HQ, HR]);
        expect(InnerMap._aboardBoat).toBe(true);
    });
});

describe('she stays where you left her', () => {
    it('leaving the map puts you ashore; she is still there on the hex when you come back', () => {
        lakeMap();
        const world = townWorld(100);
        const game = makeGame(world);
        const boat = Rowboats.buy(world, game.player, { hq: HQ, hr: HR, q: 5, r: 4 }).boat;
        InnerMap.playerInnerQ = 5; InnerMap.playerInnerR = 3;
        board(game, boat);
        InnerMap.movePlayerTo(9, 8);
        walkOut();
        InnerMapRowboat.update(0.05, game);
        InnerMap.active = false;
        InnerMapRowboat.update(0.05, game);
        expect(InnerMap._aboardBoat).toBe(false);
        expect(InnerMapRowboat.aboard).toBe(null);
        lakeMap();
        expect(InnerMapRowboat.here(game).map(b => [b.q, b.r])).toEqual([[9, 8]]);
        expect(InnerMapRowboat.menuItems(game, InnerMap.tiles[8][9], 9, 8).some(i => i.action === 'rowboat_board')).toBe(true);
    });

    it('a save keeps your boats and where they are tied up', () => {
        const p = new Player();
        p.rowboats = [{ id: 'rb2', name: 'Heron', hq: 4, hr: 9, q: 11, r: 7, day: 3, built: true }];
        p.rowboatSeq = 2;
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.rowboats).toEqual(p.rowboats);
        expect(back.rowboatSeq).toBe(2);
        expect(Rowboats.boatAt(back, 4, 9, 11, 7)).toMatchObject({ name: 'Heron' });
    });
});

describe('fishing and feeding from the boat', () => {
    it('a line is cast from where you sit, within a cast; a throw to the fish is measured from the boat', () => {
        lakeMap();
        const world = townWorld(100);
        const game = makeGame(world, { q: HQ, r: HR, gold: 200, inventory: { bread: 2 }, ships: [] });
        const boat = Rowboats.buy(world, game.player, { hq: HQ, hr: HR, q: 15, r: 4 }).boat;
        InnerMap.playerInnerQ = 15; InnerMap.playerInnerR = 3;
        expect(InnerMapRowboat.castFrom(15, 8)).toBe(null);
        board(game, boat);
        InnerMap.movePlayerTo(15, 8);
        walkOut();
        expect(InnerMapRowboat.castFrom(17, 10)).toEqual({ q: 15, r: 8 });
        expect(InnerMapRowboat.castFrom(15, 11, 3)).toEqual({ q: 15, r: 8 });
        expect(InnerMapRowboat.castFrom(15, 12, 3)).toBe(null);
        expect(InnerMapRowboat.castFrom(25, 8, 3)).toBe(null);
        // the fish: in a throw of the boat out in the lake, far from any bank
        SurfaceFish._tiles = null; SurfaceFish.mask = null;
        const reach = SurfaceFish.feeding().reach || 6;
        expect(InnerMapFeedFish.whyNot(game, InnerMap.tiles[8][15 + reach], 15 + reach, 8)).toBe(null);
        expect(InnerMapFeedFish.whyNot(game, InnerMap.tiles[8][15 + reach + 3], 15 + reach + 3, 8)).toMatch(/too far/);
        expect(InnerMap.isPlayerSwimming()).toBe(false);
    });

    it('dive from the boat leaves her moored where you went in; surfacing beside her you climb back in', () => {
        lakeMap();
        const world = townWorld(100);
        const game = makeGame(world, { q: HQ, r: HR, gold: 200, inventory: {}, ships: [], health: 100, stamina: 100 });
        const boat = Rowboats.buy(world, game.player, { hq: HQ, hr: HR, q: 15, r: 4 }).boat;
        InnerMap.playerInnerQ = 15; InnerMap.playerInnerR = 3;
        board(game, boat);
        InnerMap.movePlayerTo(15, 8);
        walkOut();
        InnerMapRowboat.overSide(game, false);
        expect(InnerMap._aboardBoat).toBe(false);
        expect(InnerMap.isPlayerSwimming()).toBe(true);
        expect(boat).toMatchObject({ q: 15, r: 8 });
        InnerMap.playerInnerQ = 16;
        const items = InnerMapRowboat.menuItems(game, InnerMap.tiles[8][15], 15, 8);
        expect(items.find(i => i.action === 'rowboat_board').label).toBe('Climb into the Boat');
        InnerMapRowboat.board(game, boat);
        expect(InnerMap._aboardBoat).toBe(true);
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).toEqual([15, 8]);
    });
});

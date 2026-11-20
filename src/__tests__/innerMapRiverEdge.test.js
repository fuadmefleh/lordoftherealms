/**
 * Carried down the river into the next hex (ui/innerMapRiverEdge.js, through
 * ui/game/gameLoop.js's edge crossing): a swimmer the current takes to the
 * map's edge where the river runs off it goes on into the next hex's map, in
 * the same river at the matching edge, still in the water; where the river
 * goes no further they are held at the edge, told once.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Hex, RiverEdge, edgeSide, edgeCrossing;

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
    RiverEdge = await import('../ui/innerMapRiverEdge.js');
    ({ edgeSide, _edgeCrossing: edgeCrossing } = await import('../ui/game/gameLoop.js'));
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

const HQ = 20, HR = 20;

/** Land everywhere; `rivers` maps 'q,r' → riverDir */
function makeWorld(rivers) {
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) {
            const t = { q, r, terrain: { id: 'grassland', name: 'Grassland', passable: true }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
            if (rivers[k] !== undefined) { t.hasRiver = true; t.riverDir = rivers[k]; }
            tiles.set(k, t);
        }
        return tiles.get(k);
    };
    return {
        width: 60, height: 60, day: 1, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: 3 }, activeEvents: [], kingdoms: [],
        getTile: (q, r) => at(q, r),
        getSettlementViews: () => [],
        getKingdom: () => null,
    };
}

/** A river in from the east neighbour, across HQ, out to the west one — on into it if `onward` */
function riverWorld(onward) {
    const e = Hex.neighbors(HQ, HR)[0], w = Hex.neighbors(HQ, HR)[3];
    const rivers = { [`${HQ},${HR}`]: 3, [`${e.q},${e.r}`]: 3 };
    if (onward) rivers[`${w.q},${w.r}`] = 3;
    return makeWorld(rivers);
}

/** A game just enough for the crossing: entering a map generates it and sets it up */
function makeGame(world) {
    const player = { q: HQ, r: HR, ships: [] };
    const notes = [];
    const game = {
        world, player, notes, arrived: 0,
        ui: { showNotification: (title, text) => notes.push({ title, text }), updateStats() {} },
        innerMapCamera: { centerOn() {}, precomputeFrame() {} },
        exitInnerMap() { InnerMap.active = false; },
        enterInnerMap(q, r) { open(game, q, r); },
        onPlayerArrived() { game.arrived++; },
    };
    return game;
}

function open(game, q, r) {
    const tiles = InnerMap.generate(game.world.getTile(q, r), q, r, { world: game.world, player: game.player });
    Object.assign(InnerMap, {
        tiles, width: tiles[0].length, height: tiles.length, active: true, _insideBuilding: null,
        currentWorldTile: { q, r }, _swimAllowed: true, _driftPx: null, _deck: null, _climb: null, _climbRequest: null,
    });
    InnerMap.cancelPlayerWalk();
}

/** A deep river cell on the west edge with the stream running off the map */
function westOutlet() {
    for (let r = 0; r < InnerMap.height; r++) {
        if (!RiverEdge.isRiverSwim(InnerMap.tiles, 0, r)) continue;
        if (RiverEdge.riverCarriesOut(InnerMap.currentAt(0, r), 3)) return { q: 0, r };
    }
    return null;
}

const settle = async (game) => { for (let i = 0; i < 50 && game._crossingEdge; i++) await new Promise(res => setTimeout(res, 0)); };

describe('the current out of the map', () => {
    it('runs off by the side it faces, not back in', () => {
        expect(RiverEdge.riverCarriesOut({ x: -1, y: 0, kind: 'river' }, 3)).toBe(true);
        expect(RiverEdge.riverCarriesOut({ x: 1, y: 0, kind: 'river' }, 3)).toBe(false);
        expect(RiverEdge.riverCarriesOut({ x: 0, y: -1, kind: 'river' }, 1)).toBe(true);
        expect(RiverEdge.riverCarriesOut({ x: 0.2, y: 1, kind: 'river' }, 5)).toBe(true);
        expect(RiverEdge.riverCarriesOut({ x: -1, y: 0, kind: 'sea' }, 3)).toBe(false);
    });

    it('a river runs on across a side only where the next hex has it', () => {
        const w = Hex.neighbors(HQ, HR)[3];
        expect(RiverEdge.riverRunsOn(riverWorld(true), w.q, w.r, 0)).toBe(true);
        expect(RiverEdge.riverRunsOn(riverWorld(false), w.q, w.r, 0)).toBe(false);
    });
});

describe('carried on down the river into the next hex', () => {
    it('comes in at the matching edge of the next map, in the river, still swimming', async () => {
        const world = riverWorld(true);
        const game = makeGame(world);
        open(game, HQ, HR);
        const at = westOutlet();
        expect(at).not.toBeNull();
        InnerMap.playerInnerQ = at.q; InnerMap.playerInnerR = at.r;
        expect(InnerMap.isPlayerSwimming()).toBe(true);

        edgeCrossing.riverStep(game);
        await settle(game);

        const w = Hex.neighbors(HQ, HR)[3];
        expect([game.player.q, game.player.r]).toEqual([w.q, w.r]);
        expect(game.arrived).toBe(1);
        expect(InnerMap.currentWorldTile).toEqual({ q: w.q, r: w.r });
        // on the east edge of the new map, in its river, in the water
        const W = InnerMap.width, H = InnerMap.height;
        expect(edgeSide(Math.min(W - 1, InnerMap.playerInnerQ + 3), InnerMap.playerInnerR, W, H)).toBe(0);
        const t = InnerMap.tiles[InnerMap.playerInnerR][InnerMap.playerInnerQ];
        expect(t._waterKind).toBe('river');
        expect(InnerMap.isPlayerSwimming()).toBe(true);
        expect(game.notes.some(n => /Downstream/.test(n.title))).toBe(true);
        // and the current there still takes them on (downstream, away from the edge they came in by)
        const cur = InnerMap.currentAt(InnerMap.playerInnerQ, InnerMap.playerInnerR);
        expect(cur && cur.kind).toBe('river');
        expect(cur.x).toBeLessThan(0);
    });

    it('where the river goes no further, the current holds them at the edge — told once', async () => {
        const game = makeGame(riverWorld(false));
        open(game, HQ, HR);
        const at = westOutlet();
        expect(at).not.toBeNull();
        InnerMap.playerInnerQ = at.q; InnerMap.playerInnerR = at.r;

        edgeCrossing.riverStep(game);
        await settle(game);
        edgeCrossing.riverStep(game);

        expect([game.player.q, game.player.r]).toEqual([HQ, HR]);
        expect(InnerMap.currentWorldTile).toEqual({ q: HQ, r: HR });
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).toEqual([at.q, at.r]);
        expect(game.notes.filter(n => /River Ends/.test(n.title)).length).toBe(1);
    });

    it('swum out upstream on purpose: into the river above, and not swept straight back', async () => {
        const game = makeGame(riverWorld(true));
        open(game, HQ, HR);
        const W = InnerMap.width;
        let r0 = -1;
        for (let r = 0; r < InnerMap.height && r0 < 0; r++) if (RiverEdge.isRiverSwim(InnerMap.tiles, W - 1, r)) r0 = r;
        expect(r0).toBeGreaterThanOrEqual(0);
        InnerMap.playerInnerQ = W - 1; InnerMap.playerInnerR = r0;
        edgeCrossing.cross(game); // (as the swim's arrival at the edge calls it)
        await settle(game);
        const e = Hex.neighbors(HQ, HR)[0];
        expect([game.player.q, game.player.r]).toEqual([e.q, e.r]);
        expect(InnerMap.isPlayerSwimming()).toBe(true);
        expect(InnerMap.playerInnerQ).toBeLessThanOrEqual(3);
        edgeCrossing.riverStep(game);
        await settle(game);
        expect([game.player.q, game.player.r]).toEqual([e.q, e.r]);
    });

    it('a swim under way is left to its own arrival', () => {
        const game = makeGame(riverWorld(true));
        open(game, HQ, HR);
        const at = westOutlet();
        InnerMap.playerInnerQ = at.q; InnerMap.playerInnerR = at.r;
        InnerMap._playerWalking = true;
        edgeCrossing.riverStep(game);
        InnerMap._playerWalking = false;
        expect(game._crossingEdge).toBeFalsy();
        expect([game.player.q, game.player.r]).toEqual([HQ, HR]);
    });
});

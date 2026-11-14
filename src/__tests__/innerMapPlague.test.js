/**
 * The plague on the street map (ui/innerMapPlague.js): the day's plan (stalls
 * under a cloth, shops shut, the dead's houses, the open grave), the houses'
 * menus and their acts, the boards and barriers drawn, the gate turning the
 * player back on the world map.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DataLoader } from '../core/dataLoader.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Illness } from '../systems/illness.js';
import { Plague } from '../systems/plague.js';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapPlague } from '../ui/innerMapPlague.js';

beforeAll(() => {
    DataLoader._gamedata = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/gamedata.json'), 'utf-8'));
});

const saved = {};
function stub(name, value) {
    if (!(name in saved)) saved[name] = InnerMap[name];
    InnerMap[name] = value;
}
afterEach(() => {
    for (const [k, v] of Object.entries(saved)) InnerMap[k] = v;
    for (const k of Object.keys(saved)) delete saved[k];
    InnerMapPlague._reset();
});

function scene() {
    const town = { name: 'Ashford', type: 'town', q: 5, r: 7, population: 2500, kingdom: 1 };
    const world = {
        day: 400, generationParams: { seed: 99 }, activeEvents: [], kingdoms: [], width: 40, height: 40,
        getSettlementViews: () => [town], getKingdom: () => null,
        getTile: (q, r) => ({ q, r, settlement: q === town.q && r === town.r ? town : null }),
    };
    Townsfolk.seed(town, world, { q: town.q, r: town.r });
    Illness.state(world, town, town.folk, world.day);
    const res = Townsfolk.residents(town.folk);
    const sick = res.slice(0, 8);
    for (const p of sick) p.ill = { k: 'plague', d: 397, on: 398, end: 405, sv: 0.95, fam: false, hl: 1, hb: false, v: 0 };
    town.sickness = { d: 400, n: 8, abed: 8, share: 8 / res.length, k: 'plague', epi: true, closed: false };
    // three plague deaths these weeks
    town.folk.ill.deaths = [{ d: 390, a: res[20].id, k: 'plague' }, { d: 392, a: res[21].id, k: 'plague' }, { d: 395, a: res[22].id, k: 'plague' }];
    for (const p of res.slice(20, 23)) { p.died = 391; p.purse = 12; }
    // the map: four houses, a smithy, a stall; one house lived in by the sick
    const H = (q, r, type = 'house') => ({ q, r, type, name: type, icon: '🏠' });
    const houses = [H(10, 10), H(14, 10), H(18, 10), H(22, 10)];
    const smithy = H(10, 16, 'blacksmith');
    const buildings = [...houses, smithy];
    const npcs = [{ id: 1, uid: 'n1', _person: sick[0], _folk: town.folk, _home: houses[0], _sick: { k: 'plague', abed: true }, state: 'idle', q: 10, r: 11 }];
    const tiles = [];
    for (let r = 0; r < 30; r++) { const row = []; for (let q = 0; q < 30; q++) row.push({ q, r, subTerrain: { passable: true }, visible: true, explored: true }); tiles.push(row); }
    stub('tiles', tiles);
    stub('active', true);
    stub('_insideBuilding', null);
    stub('_currentWorldTileRef', { settlement: town });
    stub('npcs', npcs);
    stub('buildings', buildings);
    stub('_townBuildings', () => buildings);
    stub('_squareStalls', () => Array.from({ length: 20 }, (_, i) => ({ q: i, r: 20, key: `o:${i},20` })));
    stub('_sickHomes', [houses[0]]);
    stub('_plagueDoors', [houses[0]]);
    stub('_findPassableAdjacentTile', (q, r) => ({ q, r: r + 1 }));
    stub('townArea', () => ({ center: { q: 15, r: 15 }, R: 10, square: [{ q: 15, r: 15 }, { q: 16, r: 15 }], streets: [], gates: [{ q: 2, r: 15, face: 1 }], margin: 1 }));
    stub('townYard', () => null);
    stub('streetCarts', () => []);
    InnerMapPlague._reset();
    return { world, town, houses, smithy, npcs, sick, res };
}

describe('InnerMapPlague — the day\'s plan', () => {
    it('takes houses no one lives in for the dead\'s, covers stalls, and finds no grave without a churchyard or church', () => {
        const { world, town, houses } = scene();
        const sev = Plague.severityAt(world, town);
        expect(sev).toBeGreaterThan(0.4);
        InnerMapPlague._townKey = '5,7';
        InnerMapPlague._plan(world, town, 400, sev);
        // 3 dead: two houses' worth (ceil(3/2)), never the one the sick live in
        expect(InnerMapPlague._abandoned.length).toBe(2);
        expect(InnerMapPlague._abandoned.some(b => b === houses[0])).toBe(false);
        expect(InnerMap._plagueStalls && InnerMap._plagueStalls.size).toBeGreaterThan(0);
        expect(InnerMap._plagueStay).toBe(0);   // (set by update, not the plan)
        expect(InnerMapPlague._pit).toBe(null);
    });

    it('lights herb fires in the square as real campfire props, and puts them out when it passes', () => {
        const { world, town } = scene();
        InnerMapPlague._outer = InnerMap.tiles;
        InnerMapPlague._townKey = '5,7';
        // (no object defs loaded in the test: a stand-in campfire def)
        const CO = InnerMapPlague._putFire;
        let placed = 0;
        InnerMapPlague._putFire = function (q, r, tag) { placed++; InnerMap.tiles[r][q].customObject = { defId: 'tp_campfire', _plagueFire: tag }; this._fires.push({ q, r, tag }); return true; };
        InnerMapPlague._lightFires(world, town, 400, 0.9);
        expect(placed).toBeGreaterThan(0);
        InnerMapPlague._lightFires(world, town, 400, 0);
        expect(InnerMapPlague._fires.length).toBe(0);
        InnerMapPlague._putFire = CO;
    });
});

describe('InnerMapPlague — the houses', () => {
    function game(world, player) {
        const notes = [];
        return { world, player, notes, ui: { showNotification: (t, x, k) => notes.push({ t, x, k }), updateStats() {}, showCustomPanel: (t, h) => notes.push({ t, h }) } };
    }

    it('offers nursing at a sick house, burning and looting at a dead household\'s, and runs them', () => {
        const { world, town, houses } = scene();
        InnerMapPlague._townKey = '5,7';
        InnerMapPlague._sev = Plague.severityAt(world, town);
        InnerMapPlague._plan(world, town, 400, InnerMapPlague._sev);
        const player = { id: 'p', q: 5, r: 7, gold: 100, karma: 0, inventory: {}, skills: {} };
        const g = game(world, player);
        const sickMenu = InnerMapPlague.buildingItems(g, houses[0]).map(i => i.action).filter(Boolean);
        expect(sickMenu).toContain('plague_nurse');
        const dead = InnerMapPlague._abandoned[0];
        const deadMenu = InnerMapPlague.buildingItems(g, dead).map(i => i.action).filter(Boolean);
        expect(deadMenu).toEqual(expect.arrayContaining(['plague_burn', 'plague_loot']));
        // nurse
        expect(InnerMapPlague.handle(g, { action: 'plague_nurse', building: houses[0] })).toBe(true);
        expect(player.karma).toBeGreaterThan(0);
        // burn the one, loot the other
        InnerMapPlague.handle(g, { action: 'plague_burn', building: dead });
        expect(Plague.burnt(town, `${dead.q},${dead.r}`)).toBe(true);
        expect(InnerMapPlague.buildingItems(g, dead).map(i => i.action).filter(Boolean)).not.toContain('plague_loot');
        const other = InnerMapPlague._abandoned[1];
        const gold0 = player.gold;
        InnerMapPlague.handle(g, { action: 'plague_loot', building: other });
        expect(Plague.looted(town, `${other.q},${other.r}`)).toBe(true);
        expect(player.gold).toBeGreaterThanOrEqual(gold0);
    });

    it('draws boards, the dead\'s crosses, covered stalls and the gate barrier without error', () => {
        const { world, town } = scene();
        Plague.shut(world, town, 'ruler', 400);
        InnerMapPlague._townKey = '5,7';
        InnerMapPlague._sev = Plague.severityAt(world, town);
        InnerMapPlague._quarantined = true;
        InnerMapPlague._plan(world, town, 400, InnerMapPlague._sev);
        const rects = [];
        const ctx = { canvas: { width: 2000, height: 2000 }, set fillStyle(c) { this._c = c; }, get fillStyle() { return this._c; }, fillRect(x, y, w, h) { rects.push([x, y, w, h]); } };
        const camera = { zoom: 1, worldToScreenFast: (x, y) => ({ x, y }) };
        const items = [];
        InnerMapPlague.collect(items, ctx, camera, 32);
        // two boarded plague-door/dead houses at least, stalls, a barrier
        expect(items.length).toBeGreaterThan(4);
        for (const it of items) it.draw();
        expect(rects.length).toBeGreaterThan(100);
    });

    it('tells the player turned back at a shut gate, with the bribe on offer', () => {
        const { world, town } = scene();
        Plague.shut(world, town, 'ruler', 400);
        const player = { id: 'p', q: 4, r: 7, gold: 100, turnedAway: { q: 5, r: 7, why: 'Shut.', bribe: 15 } };
        const g = game(world, player);
        InnerMapPlague.turnedAway(g);
        expect(player.turnedAway).toBe(null);
        expect(g.notes[0].h).toContain('sicknessAct');
    });
});

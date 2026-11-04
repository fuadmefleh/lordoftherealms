/**
 * A clan's camp on the inner map at the Dawn of Man (world/innerMap/camp.js):
 * tents round a campfire where a clan stands, its people about the fire (the
 * player's own family by name), struck when the clan moves on; and a village
 * founded where the map was drawn wild gets laid out as a village.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils;

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
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

function makeGame() {
    const worldTile = { q: 5, r: 6, terrain: { id: 'grassland', passable: true }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement: null };
    const clan = { type: 'clan', id: 'clan_a', name: 'Elk Clan', clanName: 'Elk', population: 48, q: 5, r: 6, destroyed: false };
    const kin = [
        { id: 'rnpc_1', firstName: 'Bran', kin: 'father', gender: 'male', isAlive: true },
        { id: 'rnpc_2', firstName: 'Ide', kin: 'mother', gender: 'female', isAlive: true },
    ];
    const world = {
        day: 3, season: 'Spring', baseYear: 1, generationParams: { seed: 31 }, activeEvents: [], units: [clan],
        getTile: () => worldTile,
        getSettlementViews: () => (worldTile.settlement ? [worldTile.settlement] : []),
        getKingdom: () => null,
    };
    const player = { dawnClan: 'clan_a', dawnKin: kin.map(k => k.id), _relationshipNpcs: kin };
    return { world, player, worldTile, clan };
}

const objectsOf = (id) => {
    const out = [];
    for (const row of InnerMap.tiles) for (const t of row) if (t.customObject && t.customObject.defId === id) out.push(t);
    return out;
};

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(7);
});

describe('a clan camp on the inner map', () => {
    it('the camp props are registered', async () => {
        const { CustomObjects } = await import('../world/customObjects.js');
        for (const id of ['tp_tent_hide', 'tp_tent_fell', 'tp_campfire', 'tp_campfire_out']) expect(CustomObjects.getDef(id), id).toBeTruthy();
    });

    it('where a clan stands: a fire, tents round it, and its people — your family by name', () => {
        const game = makeGame();
        InnerMap.enter(game, 5, 6);
        expect(objectsOf('tp_campfire').length).toBe(1);
        const tents = objectsOf('tp_tent_hide').length + objectsOf('tp_tent_fell').length;
        expect(tents).toBeGreaterThanOrEqual(2);
        const folk = InnerMap.npcs.filter(n => n.campHub);
        expect(folk.length).toBeGreaterThanOrEqual(4);
        const names = folk.filter(n => n.isKin).map(n => `${n.name}:${n.roleTitle}`);
        expect(names).toEqual(['Bran:your father', 'Ide:your mother']);
        // they keep about the fire
        const hub = folk[0].campHub;
        for (let t = 0; t < 30; t += 0.25) InnerMap.updateNPCs(0.25);
        for (const n of folk) expect(Math.abs(n.q - hub.q) + Math.abs(n.r - hub.r)).toBeLessThan(16);
    });

    it('coming back: the same camp, not a second one', () => {
        const game = makeGame();
        InnerMap.enter(game, 5, 6);
        const tents = objectsOf('tp_tent_hide').length + objectsOf('tp_tent_fell').length;
        InnerMap.enter(game, 5, 6);
        expect(objectsOf('tp_campfire').length).toBe(1);
        expect(objectsOf('tp_tent_hide').length + objectsOf('tp_tent_fell').length).toBe(tents);
    });

    it('once the clan has moved on, the tents are gone and a cold fire ring is left', () => {
        const game = makeGame();
        InnerMap.enter(game, 5, 6);
        game.clan.q = 9;
        InnerMap.enter(game, 5, 6);
        expect(objectsOf('tp_campfire').length).toBe(0);
        expect(objectsOf('tp_tent_hide').length + objectsOf('tp_tent_fell').length).toBe(0);
        expect(objectsOf('tp_campfire_out').length).toBe(1);
        expect(InnerMap.npcs.filter(n => n.campHub).length).toBe(0);
    });

    it('a village founded where the map was drawn wild is laid out as a village', () => {
        const game = makeGame();
        InnerMap.enter(game, 5, 6);
        expect(InnerMap.tiles.some(row => row.some(t => t.isRoad))).toBe(false);
        game.clan.destroyed = true;
        game.worldTile.settlement = { name: 'Moongrove', type: 'village', population: 120, q: 5, r: 6, kingdom: null, dawnBorn: true };
        InnerMap.enter(game, 5, 6);
        expect(InnerMap.tiles.some(row => row.some(t => t.isRoad))).toBe(true);
        // (a dawn village: tents, not houses)
        expect(objectsOf('tp_tent_hide').length + objectsOf('tp_tent_fell').length).toBeGreaterThan(0);
        expect(InnerMap.npcs.length).toBeGreaterThan(0);
    });
});

describe('a dawn village on the inner map', () => {
    it('is tents round a great fire with trodden paths, its folk about it — not streets of stone', () => {
        const game = makeGame();
        game.clan.destroyed = true;
        game.worldTile.settlement = { name: 'Moongrove', type: 'village', population: 160, q: 5, r: 6, kingdom: null, dawnBorn: true };
        InnerMap.enter(game, 5, 6);
        const tents = objectsOf('tp_tent_hide').length + objectsOf('tp_tent_fell').length;
        expect(tents).toBeGreaterThanOrEqual(8);
        expect(objectsOf('tp_campfire').length).toBeGreaterThanOrEqual(2);
        expect(InnerMap.tiles.some(row => row.some(t => t.customBuilding))).toBe(false);
        expect(InnerMap.tiles.some(row => row.some(t => t.paving))).toBe(false);
        expect(InnerMap.roads.length).toBeGreaterThan(20);
        const hub = InnerMap._villageHub(InnerMap.tiles);
        expect(InnerMap.npcs.length).toBeGreaterThan(0);
        for (const n of InnerMap.npcs) expect(Math.abs(n.q - hub.q) + Math.abs(n.r - hub.r)).toBeLessThan(25);
    });

    it('grown into a town, it is laid out anew as a town', () => {
        const game = makeGame();
        game.clan.destroyed = true;
        game.worldTile.settlement = { name: 'Moongrove', type: 'village', population: 160, q: 5, r: 6, kingdom: null, dawnBorn: true };
        InnerMap.enter(game, 5, 6);
        game.worldTile.settlement.type = 'town';
        game.worldTile.settlement.population = 700;
        InnerMap.enter(game, 5, 6);
        expect(InnerMap.tiles.some(row => row.some(t => t.customBuilding))).toBe(true);
        expect(objectsOf('tp_tent_hide').length + objectsOf('tp_tent_fell').length).toBe(0);
    });
});

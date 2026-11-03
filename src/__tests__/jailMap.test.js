/**
 * The jail map (world/innerMap/jail.js): a prisoner is locked in their own
 * cell with their cellmates; there's no walking out (nor leaving the
 * building) until the cell is unlocked — then the way to the jail door is open.
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

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    InnerMap._insideBuilding = null;
    InnerMap._outerMapState = null;
    InnerMap._jail = null;
    Utils.setSeed(3);
});

function enterTown() {
    const settlement = { name: 'Gaolby', type: 'town', population: 1500, q: 5, r: 6 };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = { day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [], getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null };
    const game = { world, player: {}, settlement };
    InnerMap.enter(game, 5, 6);
    return game;
}

const cellmates = [{ id: 'cm0', name: 'Odo the Grey', archetype: 'smuggler', label: 'Smuggler' }, { id: 'cm1', name: 'Wil Crook', archetype: 'informant', label: 'Informant' }];

function find(kind) {
    for (let r = 0; r < InnerMap.height; r++) for (let q = 0; q < InnerMap.width; q++) if (InnerMap.tiles[r][q]._jailKind === kind) return { q, r };
    return null;
}

describe('The jail map', () => {
    it('locks the player in their cell with their cellmates, the gaoler outside', () => {
        const game = enterTown();
        const outer = InnerMap.tiles;
        let s = 1;
        expect(InnerMap.enterJail(game, { town: 'Gaolby', cellmates, rng: () => ((s = (s * 16807) % 2147483647) / 2147483647) })).toBe(true);
        expect(InnerMap.inJail()).toBe(true);
        expect(InnerMap.jailLocked()).toBe(true);
        expect(InnerMap.tiles).not.toBe(outer);
        for (const k of ['bed', 'stone', 'door', 'exit', 'desk']) expect(find(k)).toBeTruthy();
        const mates = InnerMap.npcs.filter(n => n._cellmateId);
        expect(mates.map(n => n.name).sort()).toEqual(['Odo the Grey', 'Wil Crook']);
        expect(InnerMap.npcs.some(n => n._gaoler)).toBe(true);
        expect(InnerMap.npcs.filter(n => n._prisoner).length).toBeGreaterThan(0);
        // Cellmates share the cell: they can reach the player; the gaoler can't get in
        const exit = find('exit');
        expect(InnerMap._findPath(InnerMap.playerInnerQ, InnerMap.playerInnerR, exit.q, exit.r)).toBeFalsy();
        for (const m of mates) expect(InnerMap._findPath(m.q, m.r, InnerMap.playerInnerQ, InnerMap.playerInnerR)).toBeTruthy();
        const g = InnerMap.npcs.find(n => n._gaoler);
        expect(InnerMap._findPath(g.q, g.r, InnerMap.playerInnerQ, InnerMap.playerInnerR)).toBeFalsy();
        // No leaving the building while locked
        expect(InnerMap.exitBuilding(game)).toBe(false);
        expect(InnerMap.inJail()).toBe(true);
    });

    it('once unlocked, the way out is open and the player walks back into town', () => {
        const game = enterTown();
        const outer = InnerMap.tiles;
        InnerMap.enterJail(game, { town: 'Gaolby', cellmates, rng: Math.random });
        InnerMap.unlockJail();
        expect(InnerMap.jailLocked()).toBe(false);
        const exit = find('exit');
        expect(InnerMap._findPath(InnerMap.playerInnerQ, InnerMap.playerInnerR, exit.q, exit.r)).toBeTruthy();
        expect(InnerMap.exitBuilding(game)).toBe(true);
        expect(InnerMap.inJail()).toBe(false);
        expect(InnerMap.tiles).toBe(outer);
        // The next stay is locked again (the jail is built afresh)
        InnerMap.enterJail(game, { town: 'Gaolby', cellmates, rng: Math.random });
        expect(InnerMap.jailLocked()).toBe(true);
        expect(InnerMap._findPath(InnerMap.playerInnerQ, InnerMap.playerInnerR, find('exit').q, find('exit').r)).toBeFalsy();
    });
it('the gaol is a building of the town: walk back in and it is the gaol still, prisoners behind its bars', () => {
        const game = enterTown();
        const gaol = InnerMap.jailBuilding();
        expect(gaol).toBeTruthy();
        InnerMap.enterJail(game, { town: 'Gaolby', cellmates, rng: Math.random });
        expect(InnerMap._insideBuilding.q).toBe(gaol.q);
        InnerMap.unlockJail();
        expect(InnerMap.exitBuilding(game)).toBe(true);
        // In again, free, by its own door
        expect(InnerMap.enterBuilding(gaol, game)).toBe(true);
        expect(InnerMap.inJail()).toBe(true);
        expect(InnerMap.jailLocked()).toBe(false);
        expect(find('door')).toBeTruthy();
        expect(find('exit')).toBeTruthy();
        expect(InnerMap.npcs.filter(n => n._prisoner).length).toBeGreaterThan(2);
        expect(InnerMap.npcs.some(n => n._gaoler)).toBe(true);
        // A visitor walks in and out as they please
        expect(InnerMap.exitBuilding(game)).toBe(true);
        expect(InnerMap.inJail()).toBe(false);
    });
it('the cells are no place for a visitor: a warning, then the gaoler comes at them', async () => {
        const { InnerMapZones } = await import('../ui/innerMapZones.js');
        const { InnerMapReactions } = await import('../ui/innerMapReactions.js');
        const notes = [];
        const game = enterTown();
        game.ui = { showNotification: (t) => notes.push(t) };
        InnerMap.enterBuilding(InnerMap.jailBuilding(), game);
        InnerMapReactions.reset();
        InnerMapZones.reset();
        const gaoler = InnerMap.npcs.find(n => n._gaoler);
        // The front room is open to them
        InnerMapZones.update(game);
        expect(notes.length).toBe(0);
        // Into the corridor: warned
        InnerMap.playerInnerQ = 8; InnerMap.playerInnerR = 6;
        InnerMapZones.update(game);
        expect(notes.some(n => /Gaoler|⚠️/.test(n))).toBe(true);
        expect(InnerMapReactions._responders.has(gaoler.id)).toBe(false);
        // Back out front, then in again: he comes at them
        InnerMap.playerInnerQ = 8; InnerMap.playerInnerR = 10;
        InnerMapZones.update(game);
        InnerMap.playerInnerQ = 8; InnerMap.playerInnerR = 5;
        InnerMapZones.update(game);
        expect(InnerMapReactions._responders.get(gaoler.id).mode).toBe('fight');
        expect(notes.some(n => /Attacks/.test(n))).toBe(true);
    });

    it('a prisoner let out walks the corridor unchallenged', async () => {
        const { InnerMapZones } = await import('../ui/innerMapZones.js');
        const { InnerMapReactions } = await import('../ui/innerMapReactions.js');
        const notes = [];
        const game = enterTown();
        game.ui = { showNotification: (t) => notes.push(t) };
        InnerMap.enterJail(game, { town: 'Gaolby', cellmates, rng: Math.random });
        InnerMap.unlockJail();
        InnerMapReactions.reset();
        InnerMapZones.reset();
        InnerMap.playerInnerQ = 8; InnerMap.playerInnerR = 6;
        InnerMapZones.update(game);
        InnerMap.playerInnerQ = 8; InnerMap.playerInnerR = 10;
        InnerMapZones.update(game);
        InnerMap.playerInnerQ = 8; InnerMap.playerInnerR = 5;
        InnerMapZones.update(game);
        expect(notes.length).toBe(0);
    });
});

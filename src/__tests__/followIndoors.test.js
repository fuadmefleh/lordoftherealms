/**
 * No hiding indoors from the watch (ui/innerMapReactions.js): whoever is
 * chasing the player follows them in through the door, and out again.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

let InnerMap, InnerMapReactions, DataLoader;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ InnerMapReactions } = await import('../ui/innerMapReactions.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

describe('Followed indoors', () => {
    it('a guard chasing the player comes in after them, and out after them', () => {
        InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
        InnerMap._cache = {};
        const settlement = { name: 'Chaseby', type: 'town', population: 1500, q: 5, r: 6 };
        const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
        const world = { day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [], getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null };
        const game = { world, player: {}, settlement, ui: { showNotification() {} } };
        InnerMap.enter(game, 5, 6);
        const house = InnerMap.buildings.find(b => b.type === 'house') || InnerMap.buildings[0];
        const door = InnerMap._findPassableAdjacentTile(house.q, house.r);
        InnerMap.playerInnerQ = door.q;
        InnerMap.playerInnerR = door.r;
        const guard = InnerMap.npcs.find(n => n.type === 'guard');
        guard.q = guard.prevQ = door.q + 4;
        guard.r = guard.prevR = door.r;
        guard.state = 'idle';
        InnerMapReactions.reset();
        const wt = InnerMap.currentWorldTile || {};
        InnerMapReactions._visitKey = `${wt.q},${wt.r}`;
        InnerMapReactions._lastTick = performance.now();
        InnerMapReactions._respond(guard, 'arrest', null);

        expect(InnerMap.enterBuilding(house, game)).toBe(true);
        InnerMapReactions.update(0.05, game);
        expect(InnerMapReactions._followers.has(guard.id)).toBe(true);
        expect(InnerMapReactions._responders.has(guard.id)).toBe(true);
        // Time enough to reach the door
        InnerMapReactions._followers.get(guard.id).at = 0;
        InnerMapReactions.update(0.05, game);
        expect(InnerMap.npcs).toContain(guard);
        expect(guard._followedFrom).toEqual(door);
        expect(guard.q).toBeLessThan(InnerMap.width);
        expect(guard.r).toBeLessThan(InnerMap.height);

        // Out again: he comes out at the door with the player
        expect(InnerMap.exitBuilding(game)).toBe(true);
        InnerMapReactions.update(0.05, game);
        expect(guard._followedFrom).toBeNull();
        expect(guard.q).toBe(door.q);
        expect(guard.r).toBe(door.r);
    });
});

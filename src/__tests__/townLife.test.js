/**
 * Town life on the inner map: folk keep to the town (never the map's edge),
 * have homes and work, follow the hour, talk to each other; the watch stands
 * its posts and walks its beat (world/innerMap/townLife.js).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, TownProps;
const TOWN_LIFE = JSON.parse(fs.readFileSync('data/townLife.json', 'utf-8'));

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
    ({ TownProps } = await import('../world/townProps.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

function makeGame(type = 'town') {
    const settlement = { name: 'Testby', type, population: 1200, q: 5, r: 6 };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
        getTile: () => worldTile,
        getSettlementViews: () => [settlement],
        getKingdom: () => null,
    };
    return { world, player: {}, settlement };
}

function enter(type = 'town', hour = 9) {
    const game = makeGame(type);
    InnerMap.enter(game, 5, 6);
    InnerMap.timeOfDay = hour;
    return game;
}

function run(seconds, step = 0.25) {
    for (let t = 0; t < seconds; t += step) InnerMap.updateNPCs(step);
}

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(7);
});

describe('Town life', () => {
    it('folk start in town, well clear of the map\'s edge', () => {
        enter('town');
        const A = InnerMap.townArea();
        expect(A).toBeTruthy();
        expect(InnerMap.npcs.length).toBeGreaterThan(10);
        for (const n of InnerMap.npcs) {
            expect(n.q).toBeGreaterThanOrEqual(A.margin);
            expect(n.r).toBeGreaterThanOrEqual(A.margin);
            expect(n.q).toBeLessThan(InnerMap.width - A.margin);
            expect(n.r).toBeLessThan(InnerMap.height - A.margin);
            expect(InnerMap.inTown(n.q, n.r)).toBe(true);
        }
    });

    it('keeps a watch, and gives everyone a home', () => {
        enter('city');
        const guards = InnerMap.npcs.filter(n => n.type === 'guard');
        expect(guards.length).toBeGreaterThanOrEqual(TOWN_LIFE.watch.city);
        expect(guards.some(g => g._nightWatch)).toBe(true);
        const settled = InnerMap.npcs.filter(n => n.type !== 'traveler');
        expect(settled.filter(n => n._home).length / settled.length).toBeGreaterThan(0.9);
    });

    it('through a day, no one wanders out of town (save the departing, and hands out in the fields)', () => {
        enter('town');
        const m = InnerMap.townArea().margin;
        for (let h = 7; h < 23; h++) {
            InnerMap.timeOfDay = h;
            run(60, 0.5);
            for (const n of InnerMap.npcs) {
                if (n.departing || n.state === 'inside_building') continue;
                const end = n.path && n.path.length ? n.path[n.path.length - 1] : { q: n.q, r: n.r };
                if (n._field || n._carry) {
                    expect(end.q >= m && end.r >= m && end.q < InnerMap.width - m && end.r < InnerMap.height - m).toBe(true);
                    continue;
                }
                expect(InnerMap.inTown(end.q, end.r)).toBe(true);
            }
        }
    });

    it('farmers go out to work the fields, and cut a ripe one down', () => {
        const game = enter('town', 9);
        const fields = InnerMap._townFields();
        expect(fields.length).toBeGreaterThan(0);
        // High summer: the wheat and the vegetables are ripe
        InnerMap.worldDay = 66;
        TownProps.growFields(InnerMap.tiles, 66);
        const left = () => fields.reduce((s, f) => s + TownProps.fieldCrop(InnerMap.tiles[f.r][f.q].customObject, 66).left, 0);
        const before = left();
        let working = 0;
        for (let i = 0; i < 600; i++) {
            InnerMap.timeOfDay = 9 + Math.floor(i / 120);
            InnerMap.updateNPCs(0.5);
            working = Math.max(working, InnerMap.npcs.filter(n => n.activity && n.activity.type === 'field').length);
        }
        expect(game).toBeTruthy();
        expect(working).toBeGreaterThan(0);
        expect(left()).toBeLessThan(before);
    });

    it('the hands carry what they cut to the granary, into the town food store', () => {
        const game = enter('town', 9);
        game.settlement.economy = { food: 0 };
        InnerMap.worldDay = 66;
        TownProps.growFields(InnerMap.tiles, 66);
        let carried = 0;
        for (let i = 0; i < 900; i++) {
            InnerMap.timeOfDay = 9 + Math.floor(i / 150);
            InnerMap.updateNPCs(0.5);
            carried = Math.max(carried, InnerMap.npcs.filter(n => n._carry && n.state === 'walking').length);
        }
        expect(carried).toBeGreaterThan(0);
        expect(game.settlement.economy.food).toBeGreaterThan(0);
    });

    it('goes about the day: some at work, some talking; most abed at night', () => {
        enter('town', 9);
        let inside = 0, chats = 0;
        for (let i = 0; i < 240; i++) {
            InnerMap.updateNPCs(0.5);
            inside = Math.max(inside, InnerMap.npcs.filter(n => n.state === 'inside_building').length);
            chats += InnerMap.npcs.filter(n => n._bark && n._bark.text).length;
        }
        expect(inside).toBeGreaterThan(2);
        expect(chats).toBeGreaterThan(0);

        // Arriving at night: they're abed
        const game = enter('town', 23);
        InnerMap._settleTownLife(game.settlement, () => Utils.random());
        const settled = InnerMap.npcs.filter(n => n.type !== 'guard' && n.type !== 'traveler');
        expect(settled.filter(n => n.state === 'inside_building').length / settled.length).toBeGreaterThan(0.8);
        run(120, 0.5);
        expect(settled.filter(n => n.state === 'inside_building').length / settled.length).toBeGreaterThan(0.7);
        // Night falling on a busy day: they walk home
        enter('town', 15);
        run(60, 0.5);
        InnerMap.timeOfDay = 22;
        run(150, 0.5);
        const folk = InnerMap.npcs.filter(n => n.type !== 'guard' && n.type !== 'traveler');
        const home = folk.filter(n => n.state === 'inside_building' && n._home && n._insideBuildingQ === n._home.q && n._insideBuildingR === n._home.r);
        expect(home.length / folk.length).toBeGreaterThan(0.6);
        // The night watch is out
        expect(InnerMap.npcs.some(n => n.type === 'guard' && n.state !== 'inside_building')).toBe(true);
    });
});

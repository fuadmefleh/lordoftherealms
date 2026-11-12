/**
 * Sweethearts on the street map: a courting pair keep each other's company of
 * an evening and say sweet things (world/innerMap/townCourting.js,
 * ui/innerMapCourting.js); a wedding gathers the couple and guests.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Romance, InnerMapCourting;

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
    ({ Romance } = await import('../systems/romance.js'));
    ({ InnerMapCourting } = await import('../ui/innerMapCourting.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

function enter(hour) {
    const settlement = { name: 'Testby', type: 'town', population: 1200, q: 5, r: 6 };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 40, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    const game = { world, player: {}, settlement, ui: { showNotification() {} } };
    InnerMap.enter(game, 5, 6);
    InnerMap.timeOfDay = hour;
    return game;
}

/** Two grown townsfolk on the map made sweethearts at `st`. */
function pair(game, st = 'love') {
    const folk = game.settlement.folk;
    const adults = InnerMap.npcs.filter(n => n._person && n.type !== 'guard' && n.type !== 'child' && n.age >= 18 && n.age <= 50);
    const a = adults[0];
    const b = adults.find(n => n !== a && n._person.gender !== a._person.gender) || adults[1];
    const rm = Romance.state(folk, game.world, game.world.day);
    rm.list = rm.list.filter(c => ![c.a, c.b].some(id => id === a._person.id || id === b._person.id));
    const c = { id: rm.n++, a: a._person.id, b: b._person.id, st, d: 1, sd: 1, heat: 60 };
    rm.list.push(c);
    return { a, b, c, folk };
}

// (barks last real seconds: the test's clock runs at the simulation's pace)
let simNow = 1e6;
function run(game, seconds, step = 0.25, watch = null) {
    const real = performance.now;
    performance.now = () => simNow;
    try {
        for (let t = 0; t < seconds; t += step) {
            simNow += step * 1000;
            InnerMap.updateNPCs(step);
            InnerMapCourting.update(step, game);
            if (watch) watch();
        }
    } finally { performance.now = real; }
}

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(11);
});

describe('Sweethearts on the street map', () => {
    it('a courting pair keep company of an evening and say sweet things', () => {
        const game = enter(19);
        const { a, b } = pair(game, 'love');
        let close = 0;
        const said = new Set();
        run(game, 240, 0.25, () => {
            InnerMap.playerInnerQ = a.q; InnerMap.playerInnerR = a.r;
            if (a.state !== 'inside_building' && b.state !== 'inside_building' && Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r)) <= 1) close++;
            for (const n of [a, b]) if (n._bark && n._bark.text) said.add(n._bark.text);
        });
        expect(close).toBeGreaterThan(20);
        // ...and what they said was a sweetheart's (data/romance.json lines)
        const L = Romance.config().lines;
        const ours = new Set();
        for (const k of ['sweet', 'sweetReply', 'quarrel', 'quarrelReply', 'heart', 'gift', 'giftReply']) {
            for (const l of L[k] || []) for (const n of [a, b]) ours.add((typeof l === 'string' ? l : l.t).split('{name}').join(n._person.first));
        }
        expect([...said].some(t => ours.has(t))).toBe(true);
    });

    it('a wedding today gathers the couple and their guests, then lets them go', () => {
        const game = enter(11);
        const { a, b, folk } = pair(game, 'betrothed');
        folk.annals.push({ k: 'wed', a: a._person.id, b: b._person.id, d: game.world.day });
        if (a.state === 'inside_building') { a.state = 'idle'; a.currentBuilding = null; }
        if (b.state === 'inside_building') { b.state = 'idle'; b.currentBuilding = null; }
        run(game, 4);
        expect(a._wedding).toBeTruthy();
        expect(b._wedding).toBe(a._wedding);
        const guests = InnerMap.npcs.filter(n => n._wedding && n !== a && n !== b);
        expect(guests.length).toBeGreaterThan(0);
        const w = [...InnerMapCourting._weddings.values()][0];
        run(game, 30);
        expect(Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r))).toBeLessThanOrEqual(3);
        if (w && w.church) {
            // With a church: in for the service (the couple, the guests, the priest), then out to the door, wed
            expect(w.phase).toBe('service');
            expect([a, b].every(n => n.state === 'inside_building' && n._insideBuildingQ === w.church.q && n._insideBuildingR === w.church.r)).toBe(true);
            run(game, 40);
            expect(w.phase).toBe('out');
            expect([a, b].some(n => n.state === 'inside_building')).toBe(false);
            expect(Math.max(Math.abs(a.q - w.door.q), Math.abs(a.r - w.door.r))).toBeLessThanOrEqual(5);
        }
        run(game, 80);
        expect(InnerMap.npcs.some(n => n._wedding || n._rite)).toBe(false);
    });
});

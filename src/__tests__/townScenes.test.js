/**
 * Town scenes (world/innerMap/townScenes.js): market stalls staffed in market
 * hours by real townsfolk hawking what the market stocks; church services
 * that gather a congregation and end; a tavern fuller of an evening than of a
 * morning; all of it a hash of town, day and hour — never the shared RNG.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils;
const SCENES = JSON.parse(fs.readFileSync('data/townScenes.json', 'utf-8'));

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

function makeGame(type = 'city', day = 3, market = null) {
    const settlement = { name: 'Testby', type, population: 4000, q: 5, r: 6, kingdom: 'k1' };
    if (market) settlement.market = market;
    const kingdom = { id: 'k1', name: 'Valdoria', ruler: 'King Aldric', religion: { faithId: 'solaris', name: 'The Solar Covenant' }, wars: [] };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
        getTile: () => worldTile,
        getSettlementViews: () => [settlement],
        getKingdom: id => (id === 'k1' ? kingdom : null),
    };
    return { world, player: {}, settlement };
}

function enter(type = 'city', hour = 9, day = 3, market = null) {
    InnerMap.timeOfDay = hour;
    InnerMap._timeAccumulator = 0;
    InnerMap.dayEnded = false;
    const game = makeGame(type, day, market);
    InnerMap.enter(game, 5, 6);
    return game;
}

function run(seconds, step = 0.25) {
    for (let t = 0; t < seconds; t += step) {
        InnerMap.updateTime(step);
        InnerMap.updateNPCs(step);
    }
}

function setClock(h) {
    InnerMap.timeOfDay = Math.floor(h);
    InnerMap._timeAccumulator = (h - Math.floor(h)) * (InnerMap.TIME_SCALE || 60);
}

const patrons = () => InnerMap.npcs.filter(n => n._scene && n._scene.role === 'patron' && n._scene.phase !== 'leave');

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    InnerMap._interiorCache = {};
    InnerMap._insideBuilding = null;
    InnerMap._outerMapState = null;
    Utils.setSeed(7);
});

describe('Town scenes', () => {
    it('staffs each stall in market hours with a townsperson behind the counter', () => {
        enter('city', 10);
        const S = InnerMap._scn;
        expect(S.stalls.length).toBeGreaterThan(0);
        for (const st of S.stalls) {
            const v = InnerMap.npcs.find(n => n.id === st.vendorId);
            expect(v).toBeTruthy();
            expect(SCENES.market.vendorRoles).toContain(v.type);
            expect(v._vending).toBe(st);
            expect([v.q, v.r]).toEqual([st.behind.q, st.behind.r]);
            expect(v.facing).toBe(2);
        }
        // Merchants first
        if (InnerMap.npcs.some(n => n.type === 'merchant')) {
            expect(InnerMap.npcs.find(n => n.id === S.stalls[0].vendorId).type).toBe('merchant');
        }
    });

    it('packs the stalls up at the close and leaves them empty at night', () => {
        enter('city', 21);
        for (const st of InnerMap._scn.stalls) {
            const v = InnerMap.npcs.find(n => n.id === st.vendorId);
            expect(v._vending).toBeFalsy();
        }
        const v = InnerMap.npcs.find(n => n._stall);
        expect(InnerMap._scenePick(v, 'night')).toBe(false);
    });

    it('hawks what the market really has in stock, of its own stall trade (world/marketStalls.js)', () => {
        enter('city', 10, 3, { stock: { salt: 80 } });
        const v = InnerMap.npcs.find(n => n._vending && n._stall);
        expect(v).toBeTruthy();
        // A spice merchant's stall, with only salt in the market: salt is the one ware it names
        v._stall.trade = 'spicer';
        const lines = Array.from({ length: 24 }, () => InnerMap._sceneHawk(v).toLowerCase());
        expect(lines.some(l => l.includes('salt'))).toBe(true);
        for (const l of lines) for (const g of ['tea', 'incense', 'perfume', 'exotic', 'luxur']) expect(l).not.toContain(g);
    });

    it('a service gathers the congregation into the pews, and ends', () => {
        const game = enter('town', 7, 3);
        setClock(7.95);
        const church = InnerMap.buildings.find(b => b.type === 'church');
        expect(church).toBeTruthy();
        InnerMap.enterBuilding(church, game);
        run(2);
        const priest = InnerMap.npcs.find(n => n._scene && n._scene.role === 'staff');
        expect(priest && priest.type).toBe('priest');
        setClock(8.3);
        run(40);
        const sv = InnerMap.serviceAt(InnerMap._sceneClock(), 3, false);
        expect(sv).toBeTruthy();
        const flock = patrons();
        expect(flock.length).toBeGreaterThanOrEqual(2);
        const seated = flock.filter(n => n._scene.phase === 'at');
        expect(seated.length).toBeGreaterThan(0);
        for (const n of seated) {
            expect(n.activity.anim).toBe('sitting');
            expect(n.facing).toBe(0);
        }
        // Past its end: they get up and go
        setClock(9.6);
        run(30);
        expect(patrons().length).toBeLessThanOrEqual(SCENES.interiors.church.between);
        InnerMap.exitBuilding(game);
    });

    it('a holy day draws more of the town than a weekday', () => {
        enter('city', 9);
        const outer = InnerMap.npcs;
        const sv = d => InnerMap.serviceAt(8.5, d, false);
        const holy = [0, 1, 2, 3, 4, 5, 6, 7].find(d => InnerMap.isHolyDay(d));
        const week = [0, 1, 2, 3, 4, 5, 6, 7].find(d => !InnerMap.isHolyDay(d));
        const count = d => outer.filter(n => InnerMap._sceneAttends(n, sv(d))).length;
        expect(count(holy)).toBeGreaterThan(count(week));
    });

    it('the tavern is fuller of an evening than of a morning, the keeper behind the bar', () => {
        const count = hour => {
            InnerMap._cache = {};
            InnerMap._interiorCache = {};
            const game = enter('city', hour);
            const tav = InnerMap.buildings.find(b => b.type === 'tavern');
            InnerMap.enterBuilding(tav, game);
            run(20);
            const n = patrons().length;
            const keeper = InnerMap.npcs.find(x => x._scene && x._scene.role === 'staff');
            InnerMap.exitBuilding(game);
            return { n, keeper };
        };
        const morning = count(9);
        const evening = count(20);
        expect(evening.n).toBeGreaterThan(morning.n);
        expect(evening.keeper).toBeTruthy();
        expect(InnerMap.sceneCrowd('tavern', 20)).toBeGreaterThan(InnerMap.sceneCrowd('tavern', 9));
    });

    it('the same town, day and hour give the same scene', () => {
        const snap = () => {
            InnerMap._cache = {};
            InnerMap._interiorCache = {};
            Utils.setSeed(7);
            const game = enter('city', 20);
            const tav = InnerMap.buildings.find(b => b.type === 'tavern');
            InnerMap.enterBuilding(tav, game);
            run(1);
            const out = InnerMap.npcs.filter(n => n._scene).map(n => `${n.id}:${n._scene.role}@${n._scene.spot.q},${n._scene.spot.r}`).sort();
            InnerMap.exitBuilding(game);
            return { out, stalls: InnerMap._scn.stalls.map(s => s.vendorId) };
        };
        const a = snap();
        const b = snap();
        expect(a.out.length).toBeGreaterThan(0);
        expect(a).toEqual(b);
    });

    it('at a Dawn of Man camp, the eldest tells stories by the fire of an evening — no stalls, no church', () => {
        const worldTile = { q: 5, r: 6, terrain: { id: 'grassland', passable: true }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement: null };
        const clan = { type: 'clan', id: 'clan_a', name: 'Elk Clan', clanName: 'Elk', population: 48, q: 5, r: 6, destroyed: false };
        const world = {
            day: 3, season: 'Spring', baseYear: 1, generationParams: { seed: 31 }, activeEvents: [], units: [clan],
            getTile: () => worldTile, getSettlementViews: () => [], getKingdom: () => null,
        };
        InnerMap.timeOfDay = 19;
        InnerMap._timeAccumulator = 0;
        InnerMap.dayEnded = false;
        InnerMap.enter({ world, player: {} }, 5, 6);
        InnerMap.timeOfDay = 19;
        expect(InnerMap.npcs.some(n => n.campHub)).toBe(true);
        run(60);
        const teller = InnerMap.npcs.filter(n => n.activity && n.activity.label === 'Telling a story');
        const ears = InnerMap.npcs.filter(n => n.activity && n.activity.label === 'Listening to the story');
        expect(teller.length).toBe(1);
        expect(ears.length).toBeGreaterThan(0);
        expect((InnerMap._scn && InnerMap._scn.stalls) || []).toEqual([]);
        // By day they go about the camp
        setClock(10);
        run(40);
        expect(InnerMap.npcs.filter(n => n.activity && n.activity.label === 'Telling a story').length).toBe(0);
    });

    it('never draws on the shared RNG', () => {
        const game = enter('city', 20);
        const tav = InnerMap.buildings.find(b => b.type === 'tavern');
        InnerMap.enterBuilding(tav, game);
        Utils.setSeed(99);
        const ref = (() => { Utils.setSeed(99); const x = Utils.random(); Utils.setSeed(99); return x; })();
        InnerMap._scnIn = null;
        for (let i = 0; i < 40; i++) InnerMap._sceneInteriorTick(0.5);
        InnerMap.serviceAt(8.5, 3);
        InnerMap.sceneCrowd('tavern', 20);
        InnerMap._sceneNews(game.settlement, game.world, game.world.getKingdom('k1'));
        expect(Utils.random()).toBe(ref);
        InnerMap.exitBuilding(game);
    });
});

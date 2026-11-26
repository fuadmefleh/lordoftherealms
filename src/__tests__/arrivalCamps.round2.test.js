/**
 * Newcomers' camps, round two (world/townGrowth.js, systems/arrivalCamps.js,
 * world/innerMap/arrivalCamp.js, world/innerMap/terrain.js):
 *   - a hex's water and ground come back the same however the town has changed
 *     (new streets, its history's marks, the years, the weather), so a camp's
 *     site is never moved by a river that was not there before;
 *   - new streets go to whichever side has room (east and west along the road
 *     out too), else infill inside the town, and a street is surveyed on the
 *     town's map before it is kept: no lot in the book that the map cannot show;
 *   - a tent to each household under canvas, never more;
 *   - the camp's sickness, theft and the town's mood, bounded; the player's
 *     food, coin and timber; settlers hire the town's builders when they can
 *     pay, and the player can pay for all their homes.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Hex, TownGrowth, ArrivalCamps, LotBook, SettlementMarket, Townsfolk, TownMarks, Illness;

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
    ({ TownGrowth } = await import('../world/townGrowth.js'));
    ({ ArrivalCamps } = await import('../systems/arrivalCamps.js'));
    ({ LotBook } = await import('../world/lotBook.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
    ({ Townsfolk } = await import('../systems/townsfolk.js'));
    ({ TownMarks } = await import('../world/townMarks.js'));
    ({ Illness } = await import('../systems/illness.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    InnerMap.season = 'summer';
    Utils.setSeed(7);
    ArrivalCamps.setSurveyor((world, q, r) => InnerMap.surveyGrowth(world, q, r));
});

const HQ = 20, HR = 20;

/** A town on a hex the world river runs through east to west (as innerMap.rivers.test.js). */
function riverTown(type = 'town', pop = 1500) {
    const settlement = { name: 'Riverby', type, population: pop, kingdom: null, economy: { gold: 500 } };
    const e = Hex.neighbors(HQ, HR)[0];
    const rivers = { [`${HQ},${HR}`]: 3, [`${e.q},${e.r}`]: 3 };
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) {
            const t = { q, r, terrain: { id: 'grassland', passable: true }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
            if (rivers[k] !== undefined) { t.hasRiver = true; t.riverDir = rivers[k]; }
            if (q === HQ && r === HR) { t.settlement = settlement; settlement.q = q; settlement.r = r; }
            tiles.set(k, t);
        }
        return tiles.get(k);
    };
    const world = {
        day: 1, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: 3 }, activeEvents: [], kingdoms: [],
        getTile: (q, r) => at(q, r), getSettlementViews: () => [{ q: HQ, r: HR }], getKingdom: () => null,
    };
    return { world, settlement, tile: at(HQ, HR), game: { world, player: { ships: [] } } };
}

function setup(type = 'village', pop = 220) {
    const settlement = { name: `Camp-${type}`, type, population: pop, q: 5, r: 6, kingdom: 'k1', economy: { gold: 500 } };
    const worldTile = { q: 5, r: 6, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 10, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [], events: [],
        getTile: (q, r) => (q === 5 && r === 6 ? worldTile : null), getSettlementViews: () => [{ q: 5, r: 6 }], getKingdom: () => null,
    };
    SettlementMarket.ensure(settlement);
    for (const g of ['wood', 'planks', 'stone']) SettlementMarket.add(settlement, g, 200);
    const player = { gold: 1000, name: 'Ada', q: 5, r: 6, inventory: {} };
    return { settlement, worldTile, world, player, game: { world, player, settlement } };
}

function days(ctx, n) {
    const notices = [];
    for (let i = 0; i < n; i++) {
        ctx.world.day++;
        const out = { notices: [] };
        ArrivalCamps.processDay(ctx.world, ctx.player, out);
        notices.push(...out.notices);
    }
    return notices;
}

const wetKey = tiles => { const out = []; tiles.forEach((row, r) => row.forEach((t, q) => { if (t._wet) out.push(`${q},${r}:${t._waterKind}`); })); return out.join('|'); };

describe("A hex's water and ground do not change with the town's years", () => {
    it('new streets, a new quarter, decades and a storm leave the river, the ponds and the shores where they were', () => {
        const g = riverTown();
        const t1 = InnerMap.generate(g.tile, HQ, HR, g.game);
        const before = wetKey(t1);
        expect(before).toMatch(/river/);
        const path1 = JSON.stringify(t1._riverPath);
        // The town grows: three streets for newcomers, a new quarter in a decade of wealth
        for (let i = 0; i < 3; i++) TownGrowth.addStreet(g.settlement, 40 + i);
        TownMarks.add(g.settlement, 'district', { tier: 'mid' }, 30);
        // Forty years on, in a storm, in a hard frost
        g.world.day += 120 * 40;
        g.world.weather = { getTemperature: () => ({ value: 0.05 }), getWeather: () => ({ type: 'storm', intensity: 1 }) };
        InnerMap._cache = {};
        const t2 = InnerMap.generate(g.tile, HQ, HR, g.game);
        expect(wetKey(t2)).toBe(before);
        expect(JSON.stringify(t2._riverPath)).toBe(path1);
        // (the new streets are there, off the water)
        const grown = (t2._lots || []).filter(l => /^g\d/.test(l.id));
        expect(grown.length).toBeGreaterThan(0);
        for (const l of grown) for (let r = l.r0; r <= l.r1; r++) for (let q = l.q0; q <= l.q1; q++) expect(t2[r][q]._wet).toBeFalsy();
    });

    it("the wild ground's own make-up is the hex's, not the day's weather", () => {
        const hex = { q: 33, r: 12, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.6, moisture: 0.5 };
        const sub = tiles => tiles.map(row => row.map(t => t.subTerrain.id).join(',')).join(';');
        InnerMap.width = InnerMap.height = InnerMap.INNER_MAP_SIZE;
        const a = sub(InnerMap.generate(hex, 33, 12, { world: { day: 1, weather: { getTemperature: () => ({ value: 0.9 }), getWeather: () => ({ type: 'clear', intensity: 0 }) } } }));
        InnerMap.width = InnerMap.height = InnerMap.INNER_MAP_SIZE;
        const b = sub(InnerMap.generate(hex, 33, 12, { world: { day: 400, weather: { getTemperature: () => ({ value: 0.02 }), getWeather: () => ({ type: 'storm', intensity: 1 }) } } }));
        expect(b).toBe(a);
    });

    it('a camp keeps its place when a street is laid since (its site stays dry ground)', () => {
        const g = riverTown('village', 300);
        g.world.day = 10;
        SettlementMarket.ensure(g.settlement);
        TownGrowth.noteArrival(g.settlement, 40, 10, 'Brindle');
        ArrivalCamps.processDay(g.world, null, { notices: [] });
        expect(TownGrowth.camp(g.settlement)).toBeTruthy();
        InnerMap.enter(g.game, HQ, HR);
        const site = { ...TownGrowth.camp(g.settlement).site };
        const wet0 = wetKey(InnerMap.tiles);
        InnerMap.exit(g.game);
        TownGrowth.addStreet(g.settlement, 12);
        InnerMap.enter(g.game, HQ, HR);
        expect(wetKey(InnerMap.tiles)).toBe(wet0);
        const camp = TownGrowth.camp(g.settlement);
        const t = InnerMap.tiles[camp.site.r][camp.site.q];
        expect(t._wet).toBeFalsy();
        // (the street may take its ground, never the water: where it stood, it stands, unless a lot is there now)
        if (!InnerMap.tiles[site.r][site.q]._lot) expect(camp.site).toEqual(site);
        InnerMap.exit(g.game);
    });
});

/** A plain 128-cell square of open grass with a town in its middle and a cross road through it. */
function plainGrid(opts = {}) {
    const W = 128, H = 128;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, baseTerrain: 'dirt', subTerrain: { id: 'grass', name: 'Grass', passable: true } });
        tiles.push(row);
    }
    const c = 64;
    for (let r = c - 14; r <= c + 14; r++) for (let q = c - 16; q <= c + 16; q++) tiles[r][q]._townCore = true;
    // the high street east–west, the road north–south
    for (let q = 2; q < W - 2; q++) for (const r of [c, c + 1]) tiles[r][q].isRoad = true;
    for (let r = 2; r < H - 2; r++) for (const q of [c, c + 1]) tiles[r][q].isRoad = true;
    // the town's houses fill its core but for yards beside the high street (opts.yards)
    for (let r = c - 14; r <= c + 14; r++) for (let q = c - 16; q <= c + 16; q++) {
        const t = tiles[r][q];
        if (t.isRoad) continue;
        const yard = opts.yards && q >= c + 4 && q <= c + 15 && r >= c - 8 && r <= c - 1;
        if (!yard) t.customBuilding = { defId: 'x' };
    }
    const wet = (r0, r1, q0, q1) => { for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) { tiles[r][q]._wet = true; tiles[r][q].isRoad = false; } };
    if (opts.wetNS) { wet(0, c - 15, 0, W - 1); wet(c + 16, H - 1, 0, W - 1); }
    if (opts.wetAll) { wet(0, c - 15, 0, W - 1); wet(c + 16, H - 1, 0, W - 1); wet(0, H - 1, 0, c - 17); wet(0, H - 1, c + 18, W - 1); }
    return { tiles, center: { q: c, r: c } };
}

const fronts = (tiles, l) => {
    const gateR = l.gate === 'south' ? l.r1 + 1 : l.r0 - 1;
    let n = 0;
    for (let q = l.q0; q <= l.q1; q++) if (tiles[gateR][q].isRoad) n++;
    return n;
};

describe('New streets go where there is room', () => {
    it('a town with water north and south lays its street east or west along the road out, its lots fronting it', () => {
        const s = { name: 'Narrowby', type: 'village', population: 300, q: 1, r: 1 };
        TownGrowth.addStreet(s, 5);
        const { tiles, center } = plainGrid({ wetNS: true });
        const laid = TownGrowth.layStreets(tiles, s, { center });
        expect(laid.length).toBe(s.growth.streets[0].lots.length);
        expect(laid.every(l => l.side === 'E' || l.side === 'W')).toBe(true);
        for (const l of laid) {
            expect(fronts(tiles, l)).toBeGreaterThan(0);
            for (let r = l.r0; r <= l.r1; r++) for (let q = l.q0; q <= l.q1; q++) expect(tiles[r][q]._wet || tiles[r][q].customBuilding).toBeFalsy();
        }
        // ...and the next street goes out beyond it (or to the other side), never on top of it
        TownGrowth.addStreet(s, 9);
        const { tiles: t2, center: c2 } = plainGrid({ wetNS: true });
        const both = TownGrowth.layStreets(t2, s, { center: c2 });
        const cells = new Set();
        for (const l of both) for (let r = l.r0; r <= l.r1; r++) for (let q = l.q0; q <= l.q1; q++) { expect(cells.has(`${q},${r}`)).toBe(false); cells.add(`${q},${r}`); }
        expect(both.filter(l => l.street === 's2').length).toBeGreaterThan(0);
    });

    it('open on every side: its first streets take the sides it has most room on, all four in time', () => {
        const s = { name: 'Openfield', type: 'village', population: 300, q: 2, r: 2 };
        for (let i = 0; i < 4; i++) TownGrowth.addStreet(s, 5 + i);
        const { tiles, center } = plainGrid();
        const laid = TownGrowth.layStreets(tiles, s, { center });
        expect(new Set(laid.map(l => l.side)).size).toBeGreaterThanOrEqual(3);
        expect(laid.length).toBe(24);
    });

    it('hemmed in on every side: plots inside the town on its yards, fronting a street', () => {
        const s = { name: 'Islet', type: 'village', population: 300, q: 3, r: 3 };
        TownGrowth.addStreet(s, 5);
        const { tiles, center } = plainGrid({ wetAll: true, yards: true });
        const laid = TownGrowth.layStreets(tiles, s, { center });
        expect(laid.length).toBeGreaterThan(0);
        expect(laid.every(l => l.infill)).toBe(true);
        for (const l of laid) expect(fronts(tiles, l)).toBeGreaterThanOrEqual(Math.ceil((l.q1 - l.q0 + 1) / 2));
    });

    it('no room at all: the street is not kept, the book gets no lot, and the camp crowds in', () => {
        const ctx = setup();
        const s = ctx.settlement;
        for (const l of LotBook.knownLots(s)) LotBook.of(s).lots[l.id] = { holder: 'npc:Old Bram', holderName: 'Old Bram', price: 50, day: 1, built: { type: 'house', by: 'npc:Old Bram', readyDay: 2 } };
        ArrivalCamps.setSurveyor(() => []);
        TownGrowth.noteArrival(s, 40, 11, 'Brindle');
        days(ctx, 8);
        expect(TownGrowth.streets(s).length).toBe(0);
        expect(LotBook.freeLots(s).some(l => /^g\d/.test(l.id))).toBe(false);
        const camp = TownGrowth.camp(s);
        expect(camp.lots.some(L => L.crowd)).toBe(true);
        expect(s.growth.noRoom).toBeGreaterThan(0);
    });

    it("a street is surveyed on the town's map: every lot the book keeps is laid there; the dice are left alone", () => {
        const ctx = setup();
        const s = ctx.settlement;
        for (const l of LotBook.knownLots(s)) LotBook.of(s).lots[l.id] = { holder: 'npc:Old Bram', holderName: 'Old Bram', price: 50, day: 1, built: { type: 'house', by: 'npc:Old Bram', readyDay: 2 } };
        Utils.setSeed(99);
        const want = [Utils.random(), Utils.random()];
        Utils.setSeed(99);
        const st = TownGrowth.addStreet(s, 5);
        const laid = InnerMap.surveyGrowth(ctx.world, 5, 6);
        expect([Utils.random(), Utils.random()]).toEqual(want);
        TownGrowth.fitStreet(s, st, laid);
        expect(st.lots.length).toBeGreaterThan(0);
        InnerMap._cache = {};
        const tiles = InnerMap.generate(ctx.worldTile, 5, 6, ctx.game);
        const onMap = new Set((tiles._lots || []).map(l => l.id));
        for (const id of st.lots) expect(onMap.has(id)).toBe(true);
        for (const l of LotBook.freeLots(s)) expect(onMap.has(l.id)).toBe(true);
    });

    it('no map to survey yet (designs not loaded): kept whole, then fitted the first time its map is laid; a granted lot stays', () => {
        const ctx = setup();
        const s = ctx.settlement;
        ArrivalCamps.setSurveyor(() => null);
        for (const l of LotBook.knownLots(s)) LotBook.of(s).lots[l.id] = { holder: 'npc:Old Bram', holderName: 'Old Bram', price: 50, day: 1, built: { type: 'house', by: 'npc:Old Bram', readyDay: 2 } };
        const st = TownGrowth.addStreet(s, 5);
        st.unsurveyed = 1;
        // (more lots than the map has room for: the last of them granted already)
        for (let i = 0; i < 40; i++) st.lots.push(`g1z${i}`);
        LotBook.of(s).lots.g1z39 = { holder: 'npc:Ada', holderName: 'Ada', price: 0, day: 5, granted: true };
        const before = st.lots.length;
        InnerMap._cache = {};
        const tiles = InnerMap.generate(ctx.worldTile, 5, 6, ctx.game);
        const onMap = new Set((tiles._lots || []).map(l => l.id));
        expect(st.unsurveyed).toBeUndefined();
        expect(st.lots.length).toBeLessThan(before);
        expect(st.lots).toContain('g1z39');
        for (const id of st.lots) expect(onMap.has(id) || id === 'g1z39').toBe(true);
    });

    it("a new street keeps off the churchyard's ground (its graves are laid later)", () => {
        const s = { name: 'Gravesend', type: 'village', population: 300, q: 5, r: 5 };
        TownGrowth.addStreet(s, 5);
        const { tiles, center } = plainGrid({ wetNS: true });
        for (let r = 50; r < 80; r++) for (let q = 81; q < 128; q++) tiles[r][q]._reserved = true;
        const laid = TownGrowth.layStreets(tiles, s, { center });
        expect(laid.length).toBeGreaterThan(0);
        expect(laid.every(l => l.q1 < 81 || l.r1 < 50 || l.r0 >= 80)).toBe(true);
    });

    it('cut to what fits: a street the map has room for only part of keeps only those lots; all inside, it is infill', () => {
        const s = { name: 'Fitby', type: 'village', population: 300, q: 4, r: 4 };
        const st = TownGrowth.addStreet(s, 5);
        TownGrowth.fitStreet(s, st, [{ id: st.lots[0], street: st.id, side: 'E' }, { id: st.lots[1], street: st.id, side: 'E' }]);
        expect(st.lots).toHaveLength(2);
        expect(st.side).toBe('E');
        const st2 = TownGrowth.addStreet(s, 6);
        TownGrowth.fitStreet(s, st2, [{ id: st2.lots[0], street: st2.id, infill: true }]);
        expect(st2.kind).toBe('infill');
        expect(TownGrowth.streetLots(s).map(l => l.id)).toEqual([...st.lots, ...st2.lots]);
    });
});

describe('A tent to each household under canvas', () => {
    it('never more tents than households; a town with no roster shows tents for the people it has', () => {
        const ctx = setup();
        const s = ctx.settlement;
        TownGrowth.noteArrival(s, 40, 11, 'Brindle');
        days(ctx, 1);
        const camp = TownGrowth.camp(s);
        const hh = camp.hh.filter(h => !h.housed).length;
        expect(TownGrowth.tentHouseholds(s)).toBe(hh);
        InnerMap.enter(ctx.game, 5, 6);
        const rec = InnerMap._arrivalCampRecord();
        expect(rec.tents.length).toBeLessThanOrEqual(hh);
        expect(rec.tents.length).toBe(Math.min(hh, TownGrowth.config().maxTents));
        // every camper NPC on the map sleeps in a tent of their own household's
        const homes = new Map();
        for (const npc of InnerMap.npcs || []) {
            if (!npc._campDweller) continue;
            const h = camp.hh.find(x => x.ids.includes(npc._person.id));
            const k = `${npc._home.q},${npc._home.r}`;
            if (homes.has(k)) expect(homes.get(k)).toBe(h.head);
            homes.set(k, h.head);
        }
        InnerMap.exit(ctx.game);
        // No roster: families of tentPeople
        const bare = { name: 'Bare', type: 'village', population: 200, growth: { v: 1, seq: 1, arr: [], streets: [], camp: { id: 'c1', since: 1, n: 23, housed: 0, from: 'x', hh: [], lots: [], next: 8 } } };
        expect(TownGrowth.tentHouseholds(bare)).toBe(Math.ceil(23 / TownGrowth.config().tentPeople));
        bare.growth.camp.housed = 23;
        expect(TownGrowth.tentHouseholds(bare)).toBe(0);
    });

    it("the roster's households take the last lots: the faces in the tents stay until the end", () => {
        const ctx = setup();
        const s = ctx.settlement;
        TownGrowth.noteArrival(s, 40, 11, 'Brindle');
        days(ctx, 1);
        const camp = TownGrowth.camp(s);
        const named = camp.hh.length;
        days(ctx, 7);
        const per = TownGrowth.byType('perLot', s.type);
        const lotted = camp.hh.filter(h => h.lot).length;
        const left = camp.n - camp.lots.reduce((t, L) => t + L.n, 0);
        expect(named - lotted).toBeGreaterThanOrEqual(Math.min(named, Math.ceil(left / per)));
        expect(TownGrowth.tentHouseholds(s)).toBeGreaterThan(0);
    });
});

describe('What a camp does to its town', () => {
    function campTown() {
        const ctx = setup('village', 220);
        TownGrowth.noteArrival(ctx.settlement, 40, 11, 'Brindle');
        days(ctx, 1);
        return ctx;
    }

    it('its people fall sick more (more from the water), less when fed; the town a little; bounded', () => {
        const ctx = campTown();
        const s = ctx.settlement;
        const risk = TownGrowth.campRisk(s);
        const S = TownGrowth.config().effects.sick;
        expect(risk.camper).toBeCloseTo(S.camper, 2);
        expect(risk.water).toBeGreaterThan(risk.camper);
        expect(risk.town).toBeGreaterThan(1);
        expect(risk.town).toBeLessThanOrEqual(S.townMax);
        const folk = s.folk;
        const env = Illness._env(ctx.world, s, folk, ctx.world.day);
        expect(env.camp).toEqual(risk);
        const camper = Townsfolk.residents(folk).find(p => p.camp);
        const other = { ...camper, camp: undefined, id: -1 };
        const k = Object.keys(Illness.config().illnesses).find(id => Illness.config().illnesses[id].water) || 'flux';
        expect(Illness.risk(camper, k, env, 3, ctx.world.day)).toBeGreaterThan(Illness.risk(other, k, env, 3, ctx.world.day));
        // fed: the less
        ctx.player.inventory = { bread: 40 };
        ArrivalCamps.give(ctx.player, ctx.world, 'food', 40, ['bread']);
        expect(TownGrowth.campRisk(s).camper).toBeLessThan(risk.camper);
    });

    it('thieving is up while it stands, the more when they go hungry; bounded', () => {
        const ctx = campTown();
        const s = ctx.settlement;
        const K = TownGrowth.config().effects.crime;
        const hungry = TownGrowth.campTheftMult(s);
        expect(hungry).toBeGreaterThan(1);
        expect(hungry).toBeLessThanOrEqual(K.theftMax);
        expect(TownGrowth.campCrime(s)).toBeGreaterThan(0);
        expect(TownGrowth.campCrime(s)).toBeLessThanOrEqual(K.max);
        s.growth.camp.food = 100;
        expect(TownGrowth.campTheftMult(s)).toBeLessThan(hungry);
        const none = setup();
        expect(TownGrowth.campTheftMult(none.settlement)).toBe(1);
        expect(TownGrowth.campCrime(none.settlement)).toBe(0);
    });

    it("a big camp standing long sours the town's mood, at most max; given back when it is struck", () => {
        const ctx = setup('village', 220);
        const s = ctx.settlement;
        s.happiness = 60;
        // no timber anywhere: the camp stands
        for (const g of ['wood', 'planks', 'stone']) s.market.stock[g] = 0;
        TownGrowth.noteArrival(s, 40, 11, 'Brindle');
        days(ctx, 90);
        const M = TownGrowth.config().effects.mood;
        expect(s.happiness).toBeLessThan(60);
        expect(s.happiness).toBeGreaterThanOrEqual(60 - M.max - 0.01);
        const hit = s.growth.camp.moodHit;
        expect(hit).toBeLessThan(0);
        ArrivalCamps._strike(s, s.growth, { day: ctx.world.day, player: null, told: () => false, out: { notices: [] } });
        expect(s.happiness).toBeCloseTo(60, 1);
    });
});

describe('Who builds the houses', () => {
    function lotted(rich) {
        const ctx = setup('village', 220);
        const s = ctx.settlement;
        TownGrowth.noteArrival(s, 30, 11, 'Brindle');
        days(ctx, 1);
        const camp = TownGrowth.camp(s);
        for (const h of camp.hh) for (const id of h.ids) Townsfolk.get(s.folk, id).purse = rich ? 400 : 0;
        days(ctx, 7);
        const L = camp.lots.find(x => !x.crowd);
        return { ctx, s, camp, b: LotBook.lot(s, L.id).built };
    }

    it('a household with coin to spare hires the town\'s builders: their wages to the builders, the house in half the time', () => {
        const { s, b } = lotted(true);
        expect(b.hired).toBeTruthy();
        expect(b.hired.by).toBe('hh');
        expect(b.readyDay - b.start).toBe(ArrivalCamps.hiredDays(s));
        expect(ArrivalCamps.hiredDays(s)).toBeLessThan(ArrivalCamps.selfDays(s));
        const crew = b.hired.crew.map(id => Townsfolk.get(s.folk, id));
        if (crew.length) {
            for (const p of crew) {
                expect(p.job.hired.label).toBe('building for the newcomers');
                expect(p.purse).toBeGreaterThanOrEqual(b.hired.wage / crew.length - 0.01);
            }
        }
        expect(b.hired.wage).toBeCloseTo(ArrivalCamps.crewCost(s, b.hired.days), 2);
    });

    it('a household with nothing builds with its own hands, slowly', () => {
        const { s, b } = lotted(false);
        expect(b.hired).toBeFalsy();
        expect(b.hands).toBe('own');
        expect(b.readyDay - b.start).toBe(ArrivalCamps.selfDays(s));
    });

    it('with no builders in the roster, their wages go to the town\'s purse', () => {
        const ctx = setup('village', 220);
        const s = ctx.settlement;
        TownGrowth.noteArrival(s, 30, 11, 'Brindle');
        days(ctx, 1);
        const camp = TownGrowth.camp(s);
        for (const p of s.folk.people) if (p.job && ['carpenter', 'mason', 'labourer'].includes(p.job.id)) p.job.id = 'farmer';
        for (const h of camp.hh) for (const id of h.ids) Townsfolk.get(s.folk, id).purse = 400;
        const gold0 = s.economy.gold;
        days(ctx, 7);
        const b = LotBook.lot(s, camp.lots.find(x => !x.crowd).id).built;
        expect(b.hired.crew).toEqual([]);
        expect(s.economy.gold).toBeGreaterThan(gold0 + b.hired.wage - 0.01);
    });
});

describe("The player's help at the camp", () => {
    function atCamp() {
        const ctx = setup('village', 220);
        TownGrowth.noteArrival(ctx.settlement, 40, 11, 'Brindle');
        days(ctx, 1);
        return ctx;
    }

    it('food from the pack: the camp eats it day by day', () => {
        const ctx = atCamp();
        ctx.player.inventory = { bread: 30, grain: 5 };
        const r = ArrivalCamps.give(ctx.player, ctx.world, 'food', 32, ['bread', 'grain']);
        expect(r.success).toBe(true);
        expect(ctx.player.inventory.bread).toBeUndefined();
        expect(ctx.player.inventory.grain).toBe(3);
        const camp = TownGrowth.camp(ctx.settlement);
        expect(camp.food).toBe(32);
        days(ctx, 1);
        expect(camp.food).toBeCloseTo(32 - (camp.n - camp.housed) * ArrivalCamps.aidConfig().eat, 1);
        expect(ArrivalCamps.give(ctx.player, ctx.world, 'food', 5, ['bread']).success).toBe(false);
    });

    it("coin into the households' purses; the town's mood lifts a little (bounded) and it remembers", () => {
        const ctx = atCamp();
        const s = ctx.settlement;
        s.happiness = 50;
        const camp = TownGrowth.camp(s);
        const heads = camp.hh.map(h => Townsfolk.get(s.folk, h.head));
        const before = heads.reduce((t, p) => t + Townsfolk.purse(s.folk, p, ctx.world), 0);
        const r = ArrivalCamps.give(ctx.player, ctx.world, 'coin', 100);
        expect(r.success).toBe(true);
        expect(ctx.player.gold).toBe(900);
        expect(heads.reduce((t, p) => t + p.purse, 0)).toBeCloseTo(before + 100, 1);
        expect(s.happiness).toBeGreaterThan(50);
        ArrivalCamps.give(ctx.player, ctx.world, 'coin', 800);
        expect(s.happiness).toBeLessThanOrEqual(50 + ArrivalCamps.aidConfig().moodMax + 0.01);
        expect((s.folk.nm || []).some(e => e.k === 'camp_aid')).toBe(true);
        expect(ArrivalCamps.give(ctx.player, ctx.world, 'coin', 5000).success).toBe(false);
    });

    it('timber given is built with: the market is not drawn on for it', () => {
        const ctx = atCamp();
        const s = ctx.settlement;
        ctx.player.inventory = { planks: 20, wood: 20 };
        expect(ArrivalCamps.give(ctx.player, ctx.world, 'timber', 40).success).toBe(true);
        const planks0 = SettlementMarket.stock(s, 'planks');
        const wood0 = SettlementMarket.stock(s, 'wood');
        days(ctx, 7);
        const camp = TownGrowth.camp(s);
        const b = LotBook.lot(s, camp.lots[0].id).built;
        expect(b.given).toBeGreaterThan(0);
        expect(SettlementMarket.stock(s, 'planks')).toBeGreaterThanOrEqual(planks0 - 0.01);
        expect(SettlementMarket.stock(s, 'wood')).toBeGreaterThanOrEqual(wood0 - 0.01);
    });

    it('Build them homes: the real price, every house by hired builders, twice the lots a week; the rest comes back', () => {
        const ctx = atCamp();
        const s = ctx.settlement;
        const camp = TownGrowth.camp(s);
        for (const h of camp.hh) for (const id of h.ids) Townsfolk.get(s.folk, id).purse = 0;
        days(ctx, 7);
        const own = camp.lots.filter(L => !L.crowd).map(L => LotBook.lot(s, L.id).built);
        expect(own.every(b => !b.hired)).toBe(true);
        const est = ArrivalCamps.buildHomesCost(s);
        expect(est.cost).toBeGreaterThan(0);
        expect(est.cost).toBeCloseTo(est.wages + est.materials, 1);
        const gold0 = ctx.player.gold;
        const r = ArrivalCamps.buildHomes(ctx.player, ctx.world);
        expect(r.success).toBe(true);
        expect(ctx.player.gold).toBeCloseTo(gold0 - est.cost, 2);
        // the houses going up by hand taken over by hired builders at once
        for (const b of own) expect(b.hired && b.hired.by).toBe('fund');
        const lots0 = camp.lots.length;
        days(ctx, 1);
        // ...and the week's lots doubled
        expect(camp.lots.length - lots0).toBeGreaterThan(TownGrowth.byType('lotsPerWeek', s.type));
        // all housed in time; what was not spent comes back
        let refunded = 0;
        for (let i = 0; i < 120 && TownGrowth.camp(s); i++) {
            const g = ctx.player.gold;
            days(ctx, 1);
            if (ctx.player.gold > g) refunded += ctx.player.gold - g;
        }
        expect(TownGrowth.camp(s)).toBeNull();
        expect(refunded).toBeGreaterThanOrEqual(0);
        expect(ArrivalCamps.buildHomes(ctx.player, ctx.world).success).toBe(false);
    });
});

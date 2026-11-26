/**
 * Newcomers' camps and the streets laid out for them (world/townGrowth.js,
 * systems/arrivalCamps.js, world/innerMap/arrivalCamp.js): a big arrival camps
 * on the outskirts, its households take free lots then a new street, houses
 * go up paid from real purses and real stock, the camp is struck; the street
 * plan with its extensions comes back the same on every regeneration and
 * through a save.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, TownGrowth, ArrivalCamps, LotBook, SettlementMarket, Townsfolk, Migration;

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
    ({ TownGrowth } = await import('../world/townGrowth.js'));
    ({ ArrivalCamps } = await import('../systems/arrivalCamps.js'));
    ({ LotBook } = await import('../world/lotBook.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
    ({ Townsfolk } = await import('../systems/townsfolk.js'));
    ({ Migration } = await import('../systems/migration.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(7);
});

function setup(type = 'village', pop = 220) {
    const settlement = { name: `Camp-${type}`, type, population: pop, q: 5, r: 6, kingdom: 'k1', economy: { gold: 500 } };
    const worldTile = { q: 5, r: 6, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 10, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [], events: [],
        getTile: (q, r) => (q === 5 && r === 6 ? worldTile : null), getSettlementViews: () => [{ q: 5, r: 6 }], getKingdom: () => null,
    };
    SettlementMarket.ensure(settlement);
    for (const g of ['wood', 'planks', 'stone']) SettlementMarket.add(settlement, g, 200);
    const player = { gold: 100, name: 'Ada', q: 5, r: 6 };
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

describe('A big arrival camps outside the town', () => {
    it('a handful settle in; a crowd at once pitches a camp of real households', () => {
        const ctx = setup();
        TownGrowth.noteArrival(ctx.settlement, 6, 10, 'Brindle');
        ArrivalCamps.processDay(ctx.world, ctx.player, { notices: [] });
        expect(TownGrowth.camp(ctx.settlement)).toBeNull();

        TownGrowth.noteArrival(ctx.settlement, 28, 11, 'Brindle');
        const notes = days(ctx, 1);
        const camp = TownGrowth.camp(ctx.settlement);
        expect(camp).toBeTruthy();
        expect(camp.n).toBe(34);
        expect(notes.some(n => /Newcomers Camp Outside/.test(n.title))).toBe(true);
        // Real townsfolk: households of the roster, marked as camping
        expect(camp.hh.length).toBeGreaterThan(0);
        const folk = ctx.settlement.folk;
        for (const h of camp.hh) for (const id of h.ids) expect(Townsfolk.get(folk, id).camp).toBe(camp.id);
        expect(ArrivalCamps.unhoused(ctx.settlement)).toBe(34);
    });

    it('empty houses take people in before anyone camps', () => {
        const ctx = setup();
        ctx.settlement.migr = { vac: 0.2 };
        TownGrowth.noteArrival(ctx.settlement, 30, 11, 'Brindle');
        days(ctx, 1);
        expect(TownGrowth.camp(ctx.settlement)).toBeNull();
    });

    it('camp households take free lots first, then a new street is laid out; houses are paid from real purses and stock; the camp is struck', () => {
        const ctx = setup();
        const s = ctx.settlement;
        // Every lot of the town's plan but two already held
        const ids = LotBook.knownLots(s).map(l => l.id);
        ids.slice(2).forEach(id => { LotBook.of(s).lots[id] = { holder: 'npc:Old Bram', holderName: 'Old Bram', price: 50, day: 1, built: { type: 'house', by: 'npc:Old Bram', readyDay: 2 } }; });
        TownGrowth.noteArrival(s, 40, 11, 'Brindle');
        days(ctx, 1);
        const camp = TownGrowth.camp(s);
        expect(camp.n).toBe(40);
        // A purse on the first household's eldest: it pays for its house
        const folk = s.folk;
        const head = Townsfolk.get(folk, camp.hh[0].head);
        head.purse = 30;
        const gold0 = s.economy.gold;
        const planks0 = SettlementMarket.stock(s, 'planks');
        const notes = days(ctx, 7);
        // The week's two lots: the town's last free ones
        expect(camp.lots.map(l => l.id)).toEqual(ids.slice(0, 2));
        const rec = LotBook.lot(s, ids[0]);
        expect(rec.built.kind).toBe('settler');
        expect(rec.built.readyDay).toBe(rec.built.start + TownGrowth.byType('buildDays', 'village'));
        expect(SettlementMarket.stock(s, 'planks')).toBeLessThan(planks0);
        expect(rec.built.paid).toBeGreaterThan(0);
        expect(head.purse).toBeLessThan(30);
        expect(s.economy.gold).toBeCloseTo(gold0 + rec.built.paid, 2);
        expect(rec.built.paid + rec.built.granted).toBeCloseTo(rec.built.cost, 2);
        // Next week no free lot is left: a new street
        notes.push(...days(ctx, 7));
        const streets = TownGrowth.streets(s);
        expect(streets.length).toBe(1);
        expect(notes.some(n => /A New Street in/.test(n.title) && n.text.includes(streets[0].name))).toBe(true);
        expect(camp.lots.some(l => streets[0].lots.includes(l.id))).toBe(true);
        // In time everyone is housed and the camp struck
        for (let i = 0; i < 80 && TownGrowth.camp(s); i++) notes.push(...days(ctx, 1));
        expect(TownGrowth.camp(s)).toBeNull();
        expect(s.growth.cleared).toBeTruthy();
        expect(notes.some(n => /The Camp Is Gone/.test(n.title))).toBe(true);
        expect(Townsfolk.residents(folk).some(p => p.camp)).toBe(false);
        expect(head.lotHome).toBe(ids[0]);
    });

    it('no timber in the market: the house waits for it', () => {
        const ctx = setup();
        const s = ctx.settlement;
        s.market.stock.planks = 0;
        TownGrowth.noteArrival(s, 30, 11, 'Brindle');
        days(ctx, 8);
        const camp = TownGrowth.camp(s);
        const rec = LotBook.lot(s, camp.lots[0].id);
        expect(rec.built.wait).toBe(true);
        expect(rec.built.readyDay).toBeNull();
        SettlementMarket.add(s, 'planks', 50);
        days(ctx, 1);
        expect(LotBook.lot(s, camp.lots[0].id).built.wait).toBe(false);
    });

    it('colonists delivered to a village too big for tents arrive into the camp', async () => {
        const { Colonization } = await import('../world/colonization.js');
        const ctx = setup('village', 180);
        ctx.settlement.colony = { isPlayerColony: true, recruitment: { enRoute: 30, recruited: 30, incentive: 'none' } };
        ctx.settlement.campOutgrown = true;
        for (let i = 0; i < 5; i++) { Colonization._deliverSettlers(ctx.worldTile, ctx.world); ctx.world.day++; }
        ArrivalCamps.processDay(ctx.world, ctx.player, { notices: [] });
        expect(TownGrowth.camp(ctx.settlement)).toBeTruthy();
    });

    it('a migrant column arriving notes its people on the town', () => {
        const ctx = setup();
        const u = { type: 'migrants', q: 5, r: 6, targetQ: 5, targetR: 6, population: 40, households: [], fromName: 'Brindle', migKind: 'migrants', start: 10 };
        Migration._columnDay(ctx.world, null, u, 11, { notices: [] }, new Set());
        expect(TownGrowth.recent(ctx.settlement, 11)).toBe(40);
    });
});

describe('The new streets on the town map', () => {
    function grownTown() {
        const ctx = setup();
        TownGrowth.addStreet(ctx.settlement, 5);
        TownGrowth.addStreet(ctx.settlement, 9);
        return ctx;
    }
    const lotsOf = tiles => (tiles._lots || []).filter(l => /^g\d/.test(l.id)).map(l => `${l.id}:${l.q0},${l.r0}-${l.q1},${l.r1}`).sort();

    it('lays its streets beyond the town with their lots, fronting a road, the same every time', () => {
        const ctx = grownTown();
        const t1 = InnerMap.generate(ctx.worldTile, 5, 6, ctx.game);
        const a = lotsOf(t1);
        expect(a.length).toBeGreaterThanOrEqual(8);
        for (const l of t1._lots.filter(x => /^g\d/.test(x.id))) {
            const mid = Math.floor((l.q0 + l.q1) / 2);
            const gateR = l.gate === 'south' ? l.r1 + 1 : l.r0 - 1;
            expect(t1[gateR][mid].isRoad).toBe(true);
            for (let r = l.r0; r <= l.r1; r++) for (let q = l.q0; q <= l.q1; q++) {
                expect(t1[r][q].customBuilding || t1[r][q].customBuildingPart || t1[r][q].isRoad).toBeFalsy();
            }
        }
        InnerMap._cache = {};
        const t2 = InnerMap.generate(ctx.worldTile, 5, 6, ctx.game);
        expect(lotsOf(t2)).toEqual(a);
        // ...and after a save: the settlement's record alone brings them back
        const saved = JSON.parse(JSON.stringify(ctx.settlement));
        const tile2 = { ...ctx.worldTile, settlement: saved };
        InnerMap._cache = {};
        const t3 = InnerMap.generate(tile2, 5, 6, { ...ctx.game, world: { ...ctx.world, getTile: () => tile2 } });
        expect(lotsOf(t3)).toEqual(a);
    });

    it('the town underneath stands as it stood: its own buildings and lots unmoved', () => {
        const plain = setup();
        const base = InnerMap.generate(plain.worldTile, 5, 6, plain.game);
        const keyB = tiles => { const out = []; for (const row of tiles) for (const t of row) if (t.customBuilding) out.push(`${t.q},${t.r}`); return out.sort(); };
        const baseLots = (base._lots || []).map(l => `${l.id}:${l.q0},${l.r0}`).sort();
        const grown = grownTown();
        InnerMap._cache = {};
        const g = InnerMap.generate(grown.worldTile, 5, 6, grown.game);
        expect(keyB(g)).toEqual(keyB(base).filter(k => keyB(g).includes(k)));
        expect(keyB(g).length).toBeGreaterThan(keyB(base).length * 0.85);
        expect((g._lots || []).filter(l => !/^g\d/.test(l.id)).map(l => `${l.id}:${l.q0},${l.r0}`).sort()).toEqual(baseLots);
    });

    it('a street laid since the last visit lays the map out anew', () => {
        const ctx = setup();
        InnerMap.enter(ctx.game, 5, 6);
        const before = InnerMap.tiles;
        InnerMap.exit(ctx.game);
        InnerMap.enter(ctx.game, 5, 6);
        expect(InnerMap.tiles).toBe(before);
        InnerMap.exit(ctx.game);
        TownGrowth.addStreet(ctx.settlement, 12);
        InnerMap.enter(ctx.game, 5, 6);
        expect(InnerMap.tiles).not.toBe(before);
        expect(InnerMap.townLots().some(l => l.id === 'g1a')).toBe(true);
        // the map's lots are what the town knows of, its new street's among them
        expect(LotBook.knownLots(ctx.settlement).some(l => l.id === 'g1a')).toBe(true);
    });
});

describe('The camp on the street map', () => {
    it('tents, fires and washing lines on the outskirts; its households sleep in the tents; struck, it leaves a cold fire', () => {
        const ctx = setup();
        const s = ctx.settlement;
        TownGrowth.noteArrival(s, 40, 11, 'Brindle');
        days(ctx, 1);
        InnerMap.enter(ctx.game, 5, 6);
        const rec = InnerMap._arrivalCampRecord();
        expect(rec).toBeTruthy();
        expect(rec.tents.length).toBe(InnerMap._campTentCount(s));
        expect(rec.tents.length).toBeGreaterThanOrEqual(3);
        expect(rec.fires.length).toBeGreaterThanOrEqual(1);
        expect(rec.lines.length).toBeGreaterThanOrEqual(1);
        // Outside the built town
        const A = InnerMap.townArea();
        expect(Math.hypot(rec.hub.q - A.center.q, rec.hub.r - A.center.r)).toBeGreaterThan(A.R * 0.9);
        let tagged = 0;
        for (const row of InnerMap.tiles) for (const t of row) if (t.customObject && t.customObject.arrivalCamp) tagged++;
        expect(tagged).toBeGreaterThanOrEqual(rec.tents.length + rec.fires.length);
        // The campers live in its tents
        const campers = InnerMap.npcs.filter(n => n._person && n._person.camp);
        expect(campers.length).toBeGreaterThan(0);
        for (const n of campers) {
            expect(n._home && n._home._tent).toBe(true);
            expect(rec.tents.some(t => t.q === n._home.q && t.r === n._home.r)).toBe(true);
        }
        // The same again on the next visit (nothing laid twice)
        InnerMap.exit(ctx.game);
        InnerMap.enter(ctx.game, 5, 6);
        let again = 0;
        for (const row of InnerMap.tiles) for (const t of row) if (t.customObject && t.customObject.arrivalCamp) again++;
        expect(again).toBe(tagged);
        // Struck: the tents gone, a cold fire ring
        InnerMap.exit(ctx.game);
        s.growth.cleared = { id: s.growth.camp.id, d: ctx.world.day };
        s.growth.camp = null;
        InnerMap.enter(ctx.game, 5, 6);
        const ids = [];
        for (const row of InnerMap.tiles) for (const t of row) if (t.customObject && t.customObject.arrivalCamp) ids.push(t.customObject.defId);
        expect(ids).toEqual(['tp_campfire_out']);
        // ...and in time the trodden ground grows back
        InnerMap.exit(ctx.game);
        ctx.world.day += TownGrowth.config().fadeDays + 1;
        InnerMap.enter(ctx.game, 5, 6);
        let soil = 0, objs = 0;
        for (const row of InnerMap.tiles) for (const t of row) { if (t._campSoil) soil++; if (t.customObject && t.customObject.arrivalCamp) objs++; }
        expect(soil + objs).toBe(0);
    });

    it('a house going up stands as a building site, and as the home of its household once done', () => {
        const ctx = setup();
        const s = ctx.settlement;
        TownGrowth.noteArrival(s, 30, 11, 'Brindle');
        days(ctx, 8);
        const camp = TownGrowth.camp(s);
        const L = camp.lots[0];
        const b = LotBook.lot(s, L.id).built;
        ctx.world.day = b.start + Math.floor((b.readyDay - b.start) / 2);
        InnerMap.enter(ctx.game, 5, 6);
        const lot = InnerMap.townLots().find(l => l.id === L.id);
        const at = InnerMap._lotAnchor(lot);
        expect(at).toBeTruthy();
        const cb = InnerMap.tiles[at.r][at.q].customBuilding;
        expect(cb.siteP).toBeGreaterThan(0.3);
        expect(cb.siteP).toBeLessThan(0.7);
        expect(InnerMap.buildings.some(x => x._lotId === L.id)).toBe(false);
        InnerMap.exit(ctx.game);
        // Done: the household moves in
        for (let d = ctx.world.day; d <= b.readyDay; d++) { ctx.world.day = d; ArrivalCamps.processDay(ctx.world, ctx.player, { notices: [] }); }
        InnerMap.enter(ctx.game, 5, 6);
        expect(InnerMap.tiles[at.r][at.q].customBuilding.siteP).toBeUndefined();
        const house = InnerMap.buildings.find(x => x._lotId === L.id);
        expect(house).toBeTruthy();
        const h = camp.hh.find(x => x.head === L.hh);
        const movers = InnerMap.npcs.filter(n => n._person && h.ids.includes(n._person.id));
        for (const n of movers) expect(n._home).toBe(house);
    });
});

/**
 * When a town's ground runs out (world/townLand.js, world/townHousing.js,
 * systems/townSprawl.js, world/townRebuilds.js):
 *   - each town's ground is counted from its hex (terrain, water), its
 *     neighbours and its walls, and edge plots stop at it;
 *   - its ground gone and its people crowded, old cottages come down for
 *     denser dwellings: their people put out meanwhile, rehoused after;
 *   - a walled town builds a suburb outside its walls on its hex, or a quarter
 *     on the next hex; an open town with no ground founds a satellite village
 *     with real people of its roster;
 *   - the street map shows the rebuilt houses, the same every time, across a
 *     save, the water untouched; a suburb's streets beyond the walls.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let TownPoor, InnerMap, DataLoader, Utils, Hex, TownHousing, TownLand, TownSprawl, TownGrowth, TownEras, ArrivalCamps, Townsfolk, SettlementMarket, CustomBuildings, Economy;

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
    ({ TownHousing } = await import('../world/townHousing.js'));
    ({ TownLand } = await import('../world/townLand.js'));
    ({ TownSprawl } = await import('../systems/townSprawl.js'));
    ({ TownGrowth } = await import('../world/townGrowth.js'));
    ({ TownEras } = await import('../world/townEras.js'));
    ({ ArrivalCamps } = await import('../systems/arrivalCamps.js'));
    ({ Townsfolk } = await import('../systems/townsfolk.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
    ({ Economy } = await import('../world/economy.js'));
    ({ TownPoor } = await import('../systems/townPoor.js'));
    ({ CustomBuildings } = await import('../world/customBuildings.js'));
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

beforeEach(() => {
    Utils.setSeed(11);
    ArrivalCamps.setSurveyor(null);
});

/** A little world of hexes: `hexes` { 'q,r': { terrain, ...tile } }, every other hex grassland. */
function mkWorld(hexes = {}, opts = {}) {
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) tiles.set(k, { q, r, terrain: { id: 'grassland', passable: true }, elevation: 0.5, temperature: 0.55, moisture: 0.5, kingdom: null, ...(hexes[k] || {}) });
        return tiles.get(k);
    };
    const world = {
        day: 10, year: 900, baseYear: 853, season: 'Spring', generationParams: { seed: 31, terrainGen: opts.gen || 3 }, activeEvents: [], events: [], kingdoms: opts.kingdoms || [],
        getTile: (q, r) => at(q, r),
        getSettlementViews: () => [...tiles.values()].filter(t => t.settlement).map(t => { t.settlement.q = t.q; t.settlement.r = t.r; return t.settlement; }),
        getKingdom: (id) => (opts.kingdoms || []).find(k => k.id === id) || null,
        invalidateSettlements() {},
    };
    return { world, at };
}

function placeTown(world, at, q, r, s) {
    const t = at(q, r);
    t.settlement = { q, r, economy: { gold: 2000, food: 5000, goods: 0 }, ...s };
    SettlementMarket.ensure(t.settlement);
    for (const g of ['wood', 'planks', 'stone']) SettlementMarket.add(t.settlement, g, 2000);
    return t.settlement;
}

const dwellings = s => Object.values(s.housing.d).reduce((a, b) => a + b, 0);

describe("a town's ground: its hex, its neighbours, its walls", () => {
    it('hills and mountains hold fewer plots than open grass; water and neighbours take their share', () => {
        const { world, at } = mkWorld({ '10,10': { terrain: { id: 'grassland', passable: true } }, '20,10': { terrain: { id: 'hills', passable: true } }, '30,10': { terrain: { id: 'mountain', passable: true } } });
        const grass = TownLand.count(world, 10, 10).max;
        const hills = TownLand.count(world, 20, 10).max;
        const mount = TownLand.count(world, 30, 10).max;
        expect(grass).toBe(TownHousing.config().land.hexPlots);
        expect(hills).toBeLessThan(grass);
        expect(mount).toBeLessThan(hills);
        // A river through it, the sea on two sides
        at(10, 10).hasRiver = true;
        const n = Hex.neighbors(10, 10);
        at(n[0].q, n[0].r).terrain = { id: 'ocean', passable: false };
        at(n[1].q, n[1].r).terrain = { id: 'coast', passable: false };
        const wet = TownLand.count(world, 10, 10);
        expect(wet.parts.sides).toBe(2);
        expect(wet.max).toBeLessThan(grass);
        // A town next door and an estate's farm on another side
        at(n[2].q, n[2].r).settlement = { name: 'Nextby', type: 'village', population: 100 };
        at(n[3].q, n[3].r).improvement = { type: 'farm', name: 'A farm' };
        const hemmed = TownLand.count(world, 10, 10);
        expect(hemmed.parts.towns).toBe(1);
        expect(hemmed.parts.fields).toBe(1);
        expect(hemmed.max).toBeLessThan(wet.max);
    });

    it('beyond the ground it stands on, a wooded hex is under trees: cleared plot by plot for wood and wages', () => {
        const { world, at } = mkWorld({ '5,5': { terrain: { id: 'seasonal_forest', passable: true } } });
        const s = placeTown(world, at, 5, 5, { name: 'Woodby', type: 'town', population: 2000 });
        const L = TownLand.refresh(world, s, 10);
        expect(L.wood).toBeGreaterThan(0);
        expect(TownHousing.landCap(s)).toBe(L.max - L.wood);
        const wood0 = SettlementMarket.stock(s, 'wood');
        const c = TownLand.clear(s, 3);
        expect(c.plots).toBe(3);
        expect(SettlementMarket.stock(s, 'wood')).toBeGreaterThan(wood0);
        expect(TownHousing.landCap(s)).toBe(L.max - L.wood);
    });

    it("a walled town's ground is its walls' circuit (never more than the hex) until it builds outside them", () => {
        const { world, at } = mkWorld();
        const s = placeTown(world, at, 5, 5, { name: 'Wallby', type: 'city', population: 6000 });
        s.townEra = { history: [['stone', 600, 1]], walls: { kind: 'stone', year: 800 }, lastYear: 900, salt: 1 };
        const L = TownLand.refresh(world, s, 10);
        expect(L.wall).toBe(Math.min(L.max, Math.round(s.housing.plots * TownHousing.config().land.wallSlack)));
        expect(TownHousing.landCap(s)).toBe(L.wall);
        L.sub = { name: 'Wallby Without', day: 10, d: {} };
        expect(TownHousing.landCap(s)).toBe(L.max - L.wood);
    });
});

describe('edge plots stop at the limit', () => {
    it("a growing town lays plots at its edge until its ground is gone, then lays none", () => {
        const { world, at } = mkWorld({ '5,5': { terrain: { id: 'mountain', passable: true } } });
        const s = placeTown(world, at, 5, 5, { name: 'Crag', type: 'town', population: 3000 });
        TownHousing.ensure(s);
        const L = TownLand.refresh(world, s, 0);
        L.max = Math.round(s.housing.plots + 40);
        L.wood = 0;
        s.population = 9000;
        let noLand = false;
        for (let d = 7; d < 7 * 120; d += 7) {
            const r = TownHousing.week(s, d);
            expect(s.housing.plots).toBeLessThanOrEqual(L.max + 1e-6);
            if (r.noLand) noLand = true;
        }
        expect(noLand).toBe(true);
        expect(TownHousing.landLeft(s)).toBeLessThan(1);
        // (and a camp's new street finds no ground either)
        const g = TownGrowth.of(s, true);
        expect(ArrivalCamps._newStreet(s, g, { day: 900, world, out: { notices: [] }, told: () => false })).toBe(null);
    });
});

describe('redevelopment: old cottages come down for denser houses', () => {
    it('pulls down the oldest, puts their people out for the build, then houses more than before', () => {
        const { world, at } = mkWorld();
        const s = placeTown(world, at, 5, 5, { name: 'Packton', type: 'town', population: 2500 });
        TownHousing.ensure(s);
        const L = TownLand.refresh(world, s, 0);
        L.max = s.housing.plots; L.wood = 0;
        s.housing.plots = Math.round(s.housing.foot);
        L.max = s.housing.plots;
        const cottages0 = s.housing.d.cottage;
        const cap0 = TownHousing.capacity(s);
        s.population = Math.round(cap0 * 1.15);
        const r1 = TownHousing.week(s, 7);
        expect(r1.razed.length).toBeGreaterThan(0);
        expect(r1.razed[0][0]).toBe('cottage');
        // (their people are put out: the town houses fewer while the work goes on)
        expect(s.housing.d.cottage).toBeLessThan(cottages0);
        expect(TownHousing.capacity(s)).toBeLessThan(cap0);
        expect(TownHousing.redeveloping(s)).toBe(r1.razed.length);
        let day = 7;
        for (; day < 400 && !TownHousing.redeveloped(s).n; day += 7) TownHousing.week(s, day);
        expect(TownHousing.redeveloped(s).n).toBeGreaterThan(0);
        for (let i = 0; i < 30; i++, day += 7) TownHousing.week(s, day);
        expect(TownHousing.capacity(s)).toBeGreaterThan(cap0);
        // (row houses and townhouses in the timber age; tenements once it builds in stone)
        expect(Object.keys(TownHousing.redeveloped(s).by).every(id => ['row', 'townhouse'].includes(id))).toBe(true);
        s.townEra = { history: [['stone', 800, 1]], walls: null };
        expect(TownHousing.redevTarget(s, 'cottage')).toBe('tenement');
        // (a village builds houses only)
        expect(TownHousing.redevTarget({ type: 'village', townEra: { history: [['stone', 800, 1]] } }, 'cottage')).toBe('house');
    });

    it("the crew's wages go from the town's purse into its builders' purses", () => {
        const { world, at } = mkWorld();
        const s = placeTown(world, at, 5, 5, { name: 'Payton', type: 'town', population: 2500 });
        Townsfolk.seed(s, world);
        const folk = s.folk;
        const trades = ['carpenter', 'mason', 'labourer'];
        let n = 0;
        for (const p of folk.people) if (Townsfolk.isHere(p) && Townsfolk.age(p, world.day) >= 18 && n < 3) { p.job = { id: trades[n], employer: null }; p.purse = 1; n++; }
        const purse0 = Economy.townPurse(s);
        const paid = TownSprawl._payCrew(world, s, 10, 3, trades, 20, 'rebuilding old houses');
        expect(paid).toBeGreaterThan(0);
        expect(Economy.townPurse(s)).toBeCloseTo(purse0 - paid, 2);
        const got = folk.people.filter(p => p.job && trades.includes(p.job.id)).reduce((a, p) => a + p.purse - 1, 0);
        expect(got).toBeCloseTo(paid, 2);
    });
});

describe('suburbs and satellites', () => {
    function crowdedFull(world, at, q, r, s0, walls = null) {
        const s = placeTown(world, at, q, r, s0);
        TownHousing.ensure(s);
        if (walls) s.townEra = { history: [['stone', 600, 1]], walls: { kind: walls, year: 800 }, lastYear: 900, salt: 1 };
        TownLand.refresh(world, s, 0);
        s.housing.plots = Math.round(s.housing.foot);
        return s;
    }

    it('a walled town with ground outside its walls on its hex builds a faubourg there', () => {
        const { world, at } = mkWorld();
        const s = crowdedFull(world, at, 5, 5, { name: 'Gatesby', type: 'city', population: 6000 }, 'stone');
        const L = s.housing.land;
        L.wall = s.housing.plots;
        s.population = Math.round(TownHousing.capacity(s) * 1.1);
        const out = { notices: [] };
        TownSprawl.week(world, null, s, 7, out, () => true);
        expect(L.wallFull).toBe(7);
        expect(L.sub && L.sub.name).toMatch(/Gatesby/);
        expect(out.notices.map(n => n.title).join('|')).toMatch(/Filled Its Walls/);
        expect(out.notices.map(n => n.title).join('|')).toMatch(/New Quarter Outside Gatesby/);
        // what goes up next is outside the walls, poorer, and counted the suburb's
        for (let d = 14; d < 400; d += 7) TownSprawl.week(world, null, s, d, null, null);
        expect(TownHousing.suburbDwellings(s)).toBeGreaterThan(0);
        expect(TownHousing.suburbCrime(s)).toBeGreaterThan(0);
        // a raid takes more of the suburb than of the town within
        const sub0 = TownHousing.suburbDwellings(s), all0 = dwellings(s);
        TownHousing.lose(s, 0.2);
        const subLost = (sub0 - TownHousing.suburbDwellings(s)) / sub0;
        const inLost = ((all0 - sub0) - (dwellings(s) - TownHousing.suburbDwellings(s))) / (all0 - sub0);
        expect(subLost).toBeGreaterThan(inLost);
    });

    it("a walled town whose walls take the whole hex founds its quarter on the next hex, of its realm", () => {
        const realm = { id: 'k1', territory: [{ q: 5, r: 5 }], isAlive: true };
        const { world, at } = mkWorld({}, { kingdoms: [realm] });
        const s = crowdedFull(world, at, 5, 5, { name: 'Tightwall', type: 'city', population: 6000, kingdom: 'k1' }, 'stone');
        at(5, 5).kingdom = 'k1';
        const L = s.housing.land;
        L.max = s.housing.plots; L.wall = s.housing.plots; L.wood = 0;
        s.population = Math.round(TownHousing.capacity(s) * 1.1);
        const pop0 = s.population;
        TownSprawl.week(world, null, s, 7, { notices: [] }, () => false);
        expect(L.sub).toBe(null);
        expect(L.subAt).toBeTruthy();
        const [q, r] = L.subAt.split(',').map(Number);
        const v = at(q, r).settlement;
        expect(v.suburbOf.name).toBe('Tightwall');
        expect(v.name).toMatch(/Tightwall/);
        expect(v.kingdom).toBe('k1');
        expect(at(q, r).kingdom).toBe('k1');
        expect(realm.territory.some(h => h.q === q && h.r === r)).toBe(true);
        expect(s.population + v.population).toBe(pop0);
    });

    it('an open town with no ground left founds a satellite village: real households of its roster, their share of its purse', () => {
        const { world, at } = mkWorld();
        const s = crowdedFull(world, at, 5, 5, { name: 'Brimful', type: 'town', population: 3000, culture: 'Imperial' });
        Townsfolk.seed(s, world);
        const L = s.housing.land;
        L.max = s.housing.plots; L.wood = 0;
        s.population = Math.round(TownHousing.capacity(s) * 1.2);
        const pop0 = s.population;
        const gold0 = Economy.townPurse(s);
        const res0 = Townsfolk.residents(s.folk).length;
        const out = { notices: [] };
        TownSprawl.week(world, null, s, 7, out, () => true);
        expect(L.sats.length).toBe(1);
        const sat = L.sats[0];
        const v = at(sat.q, sat.r).settlement;
        expect(v.satelliteOf.name).toBe('Brimful');
        expect(v.type).toBe('village');
        expect(s.population + v.population).toBe(pop0);
        expect(Economy.townPurse(s) + Economy.townPurse(v)).toBeCloseTo(gold0, 2);
        // its people are the town's own: gone from its roster, written into the village's
        expect(v.folk && v.folk.people.length).toBeGreaterThan(0);
        expect(Townsfolk.residents(s.folk).length).toBe(res0 - v.folk.people.length);
        for (const p of v.folk.people) expect(p.from.town).toBe('Brimful');
        expect(out.notices.map(n => n.title).join('|')).toMatch(/Settlers from Brimful/);
        // ...and no second village until everyYears have passed
        TownSprawl.week(world, null, s, 14, null, null);
        expect(L.sats.length).toBe(1);
    });

    it('no satellite where every neighbouring hex is water, peaks or held', () => {
        const { world, at } = mkWorld();
        for (const n of Hex.neighbors(5, 5)) at(n.q, n.r).terrain = { id: 'ocean', passable: false };
        const s = crowdedFull(world, at, 5, 5, { name: 'Isle', type: 'town', population: 3000 });
        const L = s.housing.land;
        L.max = s.housing.plots; L.wood = 0;
        s.population = Math.round(TownHousing.capacity(s) * 1.3);
        TownSprawl.week(world, null, s, 7, null, null);
        expect(L.sats.length).toBe(0);
    });
});

describe('the street map follows', () => {
    const wetKey = tiles => { const out = []; tiles.forEach((row, r) => row.forEach((t, q) => { if (t._wet) out.push(`${q},${r}:${t._waterKind}`); })); return out.join('|'); };
    const rebuilt = tiles => { const out = []; for (const row of tiles) for (const t of row) if (t.customBuilding && t.customBuilding.redev) out.push(`${t.q},${t.r}:${t.customBuilding.defId}:${t.customBuilding.siteP != null ? 'site' : 'done'}`); return out.sort().join('|'); };

    function riverTown() {
        const HQ = 20, HR = 20;
        const { world, at } = mkWorld({ [`${HQ},${HR}`]: { hasRiver: true, riverDir: 3 } });
        const e = Hex.neighbors(HQ, HR)[0];
        Object.assign(at(e.q, e.r), { hasRiver: true, riverDir: 3 });
        const s = placeTown(world, at, HQ, HR, { name: 'Rebuildham', type: 'town', population: 2000 });
        TownHousing.ensure(s);
        return { world, at, s, tile: at(HQ, HR), game: { world, player: { ships: [] } }, HQ, HR };
    }

    function gen(g) {
        InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
        InnerMap._cache = {};
        InnerMap.season = 'summer';
        InnerMap.width = InnerMap.height = InnerMap.INNER_MAP_SIZE;
        return InnerMap.generate(g.tile, g.HQ, g.HR, g.game);
    }

    it('rebuilt houses stand as row houses and tenements in place of old ones — the same on every visit, after a save, the water unchanged', () => {
        const g = riverTown();
        const t0 = gen(g);
        const water0 = wetKey(t0);
        expect(rebuilt(t0)).toBe('');
        // A tenth of its dwellings rebuilt denser, two more going up
        const h = g.s.housing;
        const all = dwellings(g.s);
        h.rd = { n: Math.round(all * 0.1), by: { row: Math.round(all * 0.05), tenement: Math.round(all * 0.05) } };
        h.q.push(['tenement', 999, 0, 'cottage'], ['row', 999, 0, 'cottage']);
        const t1 = gen(g);
        const a = rebuilt(t1);
        expect(a.length).toBeGreaterThan(0);
        expect(a).toMatch(/done/);
        expect(a).toMatch(/site/);
        expect(a).toMatch(/tenement|terrace/);
        expect(wetKey(t1)).toBe(water0);
        expect(h.rdMap.length).toBeGreaterThan(0);
        // (no rebuilt house over a street, the water or another building)
        for (const row of t1) for (const t of row) {
            if (!t.customBuilding || !t.customBuilding.redev) continue;
            const def = CustomBuildings.getBuilding(t.customBuilding.defId);
            for (const m of def.meta) { const c = t1[t.r + m.r][t.q + m.q]; expect(c.isRoad && m.impassable).toBeFalsy(); expect(c._wet).toBeFalsy(); }
        }
        // again: the same houses, the same designs
        expect(rebuilt(gen(g))).toBe(a);
        // through a save and a load: the record travels with the town
        const saved = JSON.parse(JSON.stringify(g.s));
        g.tile.settlement = saved;
        g.s = saved;
        expect(rebuilt(gen(g))).toBe(a);
        // more rebuilt later: the first stay as they were
        saved.housing.rd.n *= 2;
        const b = rebuilt(gen(g));
        for (const x of a.split('|').filter(y => /done/.test(y))) expect(b).toContain(x);
        expect(wetKey(gen(g))).toBe(water0);
    });

    it("a suburb's streets are laid beyond the town's walls", () => {
        const g = riverTown();
        g.world.generationParams.terrainGen = 8;
        g.s.culture = 'Imperial';
        g.s.type = 'city';
        g.s.population = 6000;
        delete g.s.housing;
        TownHousing.ensure(g.s);
        TownEras.ensure(g.world, g.s);
        g.s.townEra.walls = { kind: 'stone', year: 800 };
        const L = TownLand.refresh(g.world, g.s, 10);
        L.sub = { name: 'Rebuildham Without', day: 10, d: { cottage: 40 } };
        ArrivalCamps.setSurveyor((world, q, r) => InnerMap.surveyGrowth(world, q, r));
        const st = TownSprawl._suburbStreets(g.world, g.s, 20);
        expect(st).toBeTruthy();
        expect(st.suburb).toBe(1);
        expect(st.kind).not.toBe('infill');
        const tiles = gen(g);
        const box = tiles._townWalls && tiles._townWalls.box;
        expect(box).toBeTruthy();
        const lots = (tiles._lots || []).filter(l => st.lots.includes(l.id));
        expect(lots.length).toBe(st.lots.length);
        for (const l of lots) {
            const outside = l.q1 < box.q0 || l.q0 > box.q1 || l.r1 < box.r0 || l.r0 > box.r1;
            expect(outside, `${l.id} ${JSON.stringify(l)} box ${JSON.stringify(box)}`).toBe(true);
        }
        // its lots carry the suburb's houses, already counted: the lot book never adds them twice
        const cap0 = TownHousing.capacity(g.s);
        TownPoor.countLots(g.s, 30);
        expect(TownHousing.capacity(g.s)).toBe(cap0);
    });
});

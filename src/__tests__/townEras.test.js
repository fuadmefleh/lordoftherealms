// The world ages visibly (world/townEras.js, worlds made since terrainGen 8):
// towns pass through architectural eras over the centuries, their houses
// weather and are rebuilt in the style of the day, their streets are paved
// out from the square and they raise walls — deterministic per seed, saved
// with the settlement, and never touching the world's generation.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

let InnerMap, CustomBuildings, CustomObjects, DataLoader, TownEras, TownWalls, SettlementWealth;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ CustomBuildings } = await import('../world/customBuildings.js'));
    ({ CustomObjects } = await import('../world/customObjects.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ TownEras } = await import('../world/townEras.js'));
    ({ TownWalls } = await import('../world/townWalls.js'));
    ({ SettlementWealth } = await import('../world/settlementWealth.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

/** A small world of towns, at a year, made with a terrainGen. */
function mkWorld({ year = 853, gen = 8, seed = 31, towns = null } = {}) {
    const settlements = towns || [
        { name: 'Oldport', type: 'capital', population: 9000, q: 4, r: 4, culture: 'Imperial', economy: { gold: 40000 } },
        { name: 'Mudby', type: 'village', population: 120, q: 9, r: 2, culture: 'Woodland', economy: { gold: 60 } },
        { name: 'Stonegate', type: 'town', population: 2500, q: 12, r: 8, culture: 'Mountain', economy: { gold: 6000 } },
        { name: 'Fjordham', type: 'city', population: 5000, q: 2, r: 12, culture: 'Nordic', economy: { gold: 12000 } },
    ];
    return {
        year, baseYear: year, day: 1, season: 'Spring', generationParams: { seed, terrainGen: gen }, activeEvents: [], kingdoms: [],
        getSettlementViews: () => settlements, getKingdom: () => null, settlements,
    };
}

/** Run a world's years forward a day at a time (the yearly tick fires as the year turns). */
function runYears(world, years) {
    for (let y = 0; y < years; y++) {
        world.year += 1;
        world.day += 120;
        TownEras.processDay(world, null);
    }
}

/** A town's street map, generated under a world (as InnerMap.enter does). */
function town(world, settlement, worldTile = null) {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    const wt = worldTile || { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.55, moisture: 0.5, settlement };
    world.getTile = () => wt;
    InnerMap.enter({ world, player: {} }, settlement.q, settlement.r);
    return InnerMap.tiles;
}

function survey(tiles) {
    const out = { buildings: [], tiers: { poor: 0, mid: 0, rich: 0, none: 0 }, wear: [0, 0, 0], walls: 0, wallKinds: new Set(), paved: 0, roads: 0, lamps: 0 };
    for (const row of tiles) for (const t of row) {
        if (t.customBuilding) {
            const def = CustomBuildings.getBuilding(t.customBuilding.defId);
            out.buildings.push({ q: t.q, r: t.r, def, wear: t.customBuilding.wear || 0 });
            if (def && def.culture) out.tiers[def.tier || 'none']++;
            out.wear[t.customBuilding.wear || 0]++;
        }
        if (t.customObject && TownWalls.isWall(t.customObject.defId)) { out.walls++; out.wallKinds.add(t.customObject.townWall); }
        if (t.customObject && /^tp_lamp/.test(t.customObject.defId)) out.lamps++;
        if (t.isRoad) out.roads++;
        if (t.paving) out.paved++;
    }
    return out;
}

describe('eras: a town takes the next era as the centuries, its wealth and its size allow', () => {
    it('a world made before terrainGen 8 has no ages: no record, no look, no stamp', () => {
        const w = mkWorld({ gen: 7 });
        expect(TownEras.enabled(w)).toBe(false);
        expect(TownEras.look(w, w.settlements[0])).toBe(null);
        expect(TownEras.stamp(w, w.settlements[0])).toBe('');
        expect(TownEras.processDay(w, null).changed).toBe(0);
        expect(w.settlements[0].townEra).toBeUndefined();
    });

    it('in the mature world a rich capital stands in the Guild Age, a poor hamlet still in timber or before', () => {
        const w = mkWorld();
        const [cap, hamlet] = w.settlements;
        expect(TownEras.look(w, cap).era).toBe('guild');
        expect(['hearth', 'timber']).toContain(TownEras.look(w, hamlet).era);
        // the history runs in order, never back, each era after the last
        const H = cap.townEra.history;
        expect(H.map(h => h[0])).toEqual(['hearth', 'timber', 'stone', 'guild']);
        for (let i = 1; i < H.length; i++) expect(H[i][1]).toBeGreaterThan(H[i - 1][1]);
    });

    it('over five simulated centuries from the dawn a growing town climbs every era, in order, and never goes back', () => {
        const s = { name: 'Riverbend', type: 'village', population: 150, q: 5, r: 5, culture: 'Imperial', economy: { gold: 200 }, founded: 120 };
        const w = mkWorld({ year: 120, towns: [s] });
        TownEras.ensure(w, s);
        expect(s.townEra.history.map(h => h[0])).toEqual(['hearth']);
        const seen = [];
        for (let y = 0; y < 760; y++) {
            // it grows as the centuries pass: a village, a town, a city
            const f = y / 760;
            s.population = Math.round(150 + 7000 * f * f);
            s.economy.gold = s.population * (2 + 4 * f);
            s.type = s.population > 4000 ? 'city' : s.population > 900 ? 'town' : 'village';
            runYears(w, 1);
            const era = TownEras.look(w, s).era;
            if (seen[seen.length - 1] !== era) seen.push(era);
        }
        expect(seen).toEqual(['hearth', 'timber', 'stone', 'guild']);
        const years = s.townEra.history.map(h => h[1]);
        expect(years).toEqual([...years].sort((a, b) => a - b));
        // it took each era no sooner than its year (and its culture's shift)
        const E = TownEras.eras();
        for (const [id, y] of s.townEra.history.slice(1)) {
            const e = E.find(x => x.id === id);
            expect(y).toBeGreaterThanOrEqual(e.from + TownEras.shift('Imperial', id));
        }
    });

    it('a people of stonemasons builds in stone before forest folk of the same wealth', () => {
        const mk = (culture, q) => ({ name: culture, type: 'town', population: 2500, q, r: 3, culture, economy: { gold: 6000 } });
        const towns = [mk('Mountain', 3), mk('Woodland', 4)];
        const w = mkWorld({ year: 300, towns });
        for (const s of towns) TownEras.ensure(w, s);
        runYears(w, 500);
        const stoneAt = s => (s.townEra.history.find(h => h[0] === 'stone') || [null, Infinity])[1];
        expect(stoneAt(towns[0])).toBeLessThan(stoneAt(towns[1]));
    });
});

describe('weathering and rebuilding: each house stands in the style of the era it was last built in', () => {
    it('houses are rebuilt at their era\'s pace: over a century of stone a good share renewed, not all at once', () => {
        const w = mkWorld();
        const s = w.settlements[2];
        const st = TownEras.ensure(w, s);
        let renewed = 0, n = 0;
        const yearsOut = 100;
        for (let q = 0; q < 120; q += 3) {
            for (let r = 0; r < 120; r += 3) {
                const a = TownEras.buildState(st, q, r, 853);
                const b = TownEras.buildState(st, q, r, 853 + yearsOut);
                n++;
                if (b.built !== a.built) renewed++;
            }
        }
        // stone lasts 110-190 years (× the town's pace): a century renews roughly half to all but a few
        expect(renewed / n).toBeGreaterThan(0.35);
        expect(renewed / n).toBeLessThan(0.98);
    });

    it('a building\'s state is a pure function of its place and the year: the same answer every time', () => {
        const w = mkWorld();
        const st = TownEras.ensure(w, w.settlements[1]);
        const a = TownEras.buildState(st, 40, 50, 900, 0.3);
        const b = TownEras.buildState(JSON.parse(JSON.stringify(st)), 40, 50, 900, 0.3);
        expect(b).toEqual(a);
        expect([0, 1, 2]).toContain(a.wear);
    });

    it('a quarter weathers together: neighbours share their district\'s age more than strangers do', () => {
        const w = mkWorld();
        const st = TownEras.ensure(w, w.settlements[0]);
        let near = 0, far = 0, n = 0;
        for (let i = 0; i < 60; i++) {
            const q = 9 * (i % 10) + 2, r = 9 * Math.floor(i / 10) + 2;
            const a = TownEras.buildState(st, q, r, 853).built;
            near += Math.abs(a - TownEras.buildState(st, q + 1, r + 1, 853).built);
            far += Math.abs(a - TownEras.buildState(st, (q + 45) % 90, (r + 27) % 54, 853).built);
            n++;
        }
        expect(near / n).toBeLessThan(far / n);
    });

    it('right after a town turns to stone most of its houses still stand in timber, worn; a lifetime on, they are stone', () => {
        const s = { name: 'Halton', type: 'town', population: 2600, q: 7, r: 7, culture: 'Imperial', economy: { gold: 9000 } };
        const w = mkWorld({ year: 380, towns: [s] });
        const st = TownEras.ensure(w, s);
        runYears(w, 300);
        const stoneAt = st.history.find(h => h[0] === 'stone')[1];
        const stoneIdx = TownEras.eraIndex('stone');
        const share = (year) => {
            let st0 = 0, n = 0;
            for (let q = 0; q < 100; q += 4) for (let r = 0; r < 100; r += 4) { n++; if (TownEras.buildState(st, q, r, year).eraIdx >= stoneIdx) st0++; }
            return st0 / n;
        };
        expect(share(stoneAt + 5)).toBeLessThan(0.3);
        expect(share(stoneAt + 200)).toBeGreaterThan(0.9);
    });
});

describe('walls: raised when size, wealth and threat allow, palisade before stone', () => {
    it('a threatened town raises its walls sooner than a quiet one', () => {
        const mk = q => ({ name: `T${q}`, type: 'town', population: 3000, q, r: 1, culture: 'Imperial', economy: { gold: 9000 } });
        let quiet = 0, threatened = 0;
        for (let q = 0; q < 40; q++) {
            const a = mk(q), b = mk(q + 100);
            const w = mkWorld({ year: 600, towns: [a, b] });
            b.kingdom = 'k'; w.getKingdom = (id) => (id === 'k' ? { id: 'k', wars: ['x'] } : null);
            TownEras.ensure(w, a); TownEras.ensure(w, b);
            a.townEra.walls = null; b.townEra.walls = null;
            runYears(w, 60);
            if (a.townEra.walls) quiet++;
            if (b.townEra.walls) threatened++;
        }
        expect(threatened).toBeGreaterThan(quiet);
    });

    it('stone is raised over a palisade, never the other way', () => {
        const s = { name: 'Brack', type: 'city', population: 6000, q: 3, r: 3, culture: 'Imperial', economy: { gold: 30000 } };
        const w = mkWorld({ year: 853, towns: [s] });
        const st = TownEras.ensure(w, s);
        st.walls = { kind: 'stone', year: 700 };
        for (let y = 0; y < 200; y++) TownEras._rollWalls(st, s, 853 + y, 0.9, 10);
        expect(st.walls.kind).toBe('stone');
    });
});

describe('the street map shows the age', () => {
    const forceLook = (w, s, look) => { TownEras.force(w, s, look); return survey(town(w, s)); };

    it('a Hearth Age town is all poor huts, unpaved and unlit; the Guild Age paves and lights it', () => {
        const w = mkWorld();
        const s = w.settlements[0];
        const hearth = forceLook(w, s, { era: 'hearth', walls: null, wear: 0 });
        expect(hearth.buildings.length).toBeGreaterThan(20);
        expect(hearth.tiers.mid + hearth.tiers.rich).toBe(0);
        expect(hearth.paved).toBe(0);
        expect(hearth.lamps).toBe(0);
        const guild = forceLook(w, s, { era: 'guild', walls: null, wear: 0 });
        expect(guild.tiers.rich).toBeGreaterThan(0);
        expect(guild.paved).toBeGreaterThan(guild.roads * 0.5);
        expect(guild.lamps).toBeGreaterThan(0);
        // the same streets: an era changes what stands along them, not where they run
        expect(Math.abs(guild.roads - hearth.roads)).toBeLessThan(hearth.roads * 0.1);
        TownEras.force(w, s, null);
    });

    it('in the Timber Age nothing is built richer than middling; in the Age of Stone the high street is paved, the lanes not', () => {
        const w = mkWorld();
        const s = w.settlements[0];
        const timber = forceLook(w, s, { era: 'timber', walls: null });
        expect(timber.tiers.rich).toBe(0);
        expect(timber.tiers.mid).toBeGreaterThan(0);
        const tiles = town(w, s);
        TownEras.force(w, s, { era: 'stone', walls: null });
        const stone = town(w, s);
        let lanePaved = 0, mainPaved = 0;
        for (const row of stone) for (const t of row) if (t.paving) { if (t._pave === 'lane') lanePaved++; else mainPaved++; }
        expect(mainPaved).toBeGreaterThan(0);
        expect(lanePaved).toBe(0);
        expect(tiles.length).toBe(stone.length);
        TownEras.force(w, s, null);
    });

    it('worn houses are marked for the renderer; forcing fresh leaves none', () => {
        const w = mkWorld();
        const s = w.settlements[2];
        const old = forceLook(w, s, { era: 'stone', walls: null, wear: 2 });
        expect(old.wear[2]).toBeGreaterThan(10);
        const fresh = forceLook(w, s, { era: 'stone', walls: null, wear: 0 });
        expect(fresh.wear[1] + fresh.wear[2]).toBe(0);
        TownEras.force(w, s, null);
        // unforced in the mature world some stand weathered and most do not
        const real = survey(town(w, s));
        expect(real.wear[0]).toBeGreaterThan(real.wear[2]);
    });

    it('walls ring the town: unbroken but for the gates, every building inside, pieces registered', () => {
        const w = mkWorld();
        for (const [s, kind] of [[w.settlements[0], 'stone'], [w.settlements[2], 'palisade']]) {
            TownEras.force(w, s, { walls: kind });
            const tiles = town(w, s);
            const info = tiles._townWalls;
            expect(info, s.name).toBeTruthy();
            expect(info.kind).toBe(kind);
            expect(info.gates).toBeGreaterThanOrEqual(2);
            const { q0, q1, r0, r1 } = info.box;
            let holes = 0;
            const ring = [];
            for (let q = q0; q <= q1; q++) ring.push([q, r0], [q, r1]);
            for (let r = r0 + 1; r < r1; r++) ring.push([q0, r], [q1, r]);
            for (const [q, r] of ring) {
                const t = tiles[r][q];
                const wall = t.customObject && TownWalls.isWall(t.customObject.defId);
                if (wall) {
                    expect(CustomObjects.getDef(t.customObject.defId), t.customObject.defId).toBeTruthy();
                    expect(t.subTerrain.passable).toBe(false);
                } else if (!t.isRoad && !/water/.test((t.subTerrain && t.subTerrain.id) || '')) holes++;
            }
            // (beyond the gates, only the openings left below a side gate, where the wall would rise over the road)
            expect(holes, `${s.name} holes`).toBe(info.open);
            // every building of the town proper inside (farmsteads may stand out among the fields)
            const s2 = survey(tiles);
            const inside = s2.buildings.filter(b => b.q > q0 && b.q < q1 && b.r > r0 && b.r < r1).length;
            expect(inside / s2.buildings.length).toBeGreaterThan(0.8);
            TownEras.force(w, s, null);
        }
    });

    it('gates are drawn whole: a gatehouse arch (stone) or a gate frame (palisade) over each north or south gate', () => {
        const w = mkWorld();
        for (const [s, kind] of [[w.settlements[0], 'stone'], [w.settlements[2], 'palisade']]) {
            TownEras.force(w, s, { walls: kind });
            const tiles = town(w, s);
            const gates = [];
            for (const row of tiles) for (const t of row) if (t.customObject && t.customObject.gate) gates.push(t.customObject.defId);
            expect(gates.length, s.name).toBeGreaterThan(0);
            for (const id of gates) {
                const def = CustomObjects.getDef(id);
                expect(def, id).toBeTruthy();
                // it reaches over the way, but only its own tile blocks
                expect(def.bounds.maxCol).toBeGreaterThan(0);
                expect(def.meta.filter(m => m.impassable).length).toBe(1);
            }
            TownEras.force(w, s, null);
        }
    });

    it('a small town\'s walls hug its houses: little empty ground inside', () => {
        const w = mkWorld();
        const s = w.settlements[2];
        TownEras.force(w, s, { walls: 'stone' });
        const tiles = town(w, s);
        const { q0, q1, r0, r1 } = tiles._townWalls.box;
        let inside = 0, built = 0;
        for (let r = r0 + 1; r < r1; r++) for (let q = q0 + 1; q < q1; q++) {
            inside++;
            const t = tiles[r][q];
            if (t.customBuilding || t.customBuildingPart || t.isRoad || t._plaza || t.customObject || t.customObjectPart) built++;
        }
        expect(built / inside).toBeGreaterThan(0.3);
        TownEras.force(w, s, null);
    });

    it('in the Guild Age the church and the guildhall raise belltowers', () => {
        const w = mkWorld();
        const s = w.settlements[0];
        TownEras.force(w, s, { era: 'guild', walls: null });
        const tiles = town(w, s);
        const spires = [];
        for (const row of tiles) for (const t of row) if (t.customBuilding && t.customBuilding.spire) spires.push(CustomBuildings.getBuilding(t.customBuilding.defId).buildingType);
        expect(spires.length).toBeGreaterThan(0);
        for (const type of spires) expect(['church', 'temple', 'chapel', 'guildhall', 'town_hall']).toContain(type);
        TownEras.force(w, s, { era: 'stone', walls: null });
        const stone = town(w, s);
        let none = 0;
        for (const row of stone) for (const t of row) if (t.customBuilding && t.customBuilding.spire) none++;
        expect(none).toBe(0);
        TownEras.force(w, s, null);
    });

    it('the same seed lays the same aged town; another seed ages it otherwise', () => {
        const sig = (seed) => {
            const w = mkWorld({ seed });
            const s = w.settlements[3];
            const tiles = town(w, s);
            const v = survey(tiles);
            return `${v.buildings.map(b => `${b.def.id}~${b.wear}`).join(',')}|${v.paved}|${v.walls}|${JSON.stringify(s.townEra.history)}`;
        };
        expect(sig(31)).toBe(sig(31));
        expect(sig(31)).not.toBe(sig(77));
    });

    it('the map is laid anew when the age moves on (its cache stamp changes with era, walls and decade)', () => {
        const w = mkWorld();
        const s = w.settlements[1];
        const a = TownEras.stamp(w, s);
        w.year += 10;
        expect(TownEras.stamp(w, s)).not.toBe(a);
    });
});

describe('save and load', () => {
    it('the record is plain data on the settlement and survives a round trip unchanged', () => {
        const w = mkWorld();
        runYears(w, 30);
        const s = w.settlements[0];
        const saved = JSON.parse(JSON.stringify(s));
        const w2 = mkWorld({ year: w.year, towns: [saved] });
        expect(saved.townEra).toEqual(s.townEra);
        expect(TownEras.look(w2, saved).era).toBe(TownEras.look(w, s).era);
        expect(TownEras.stamp(w2, saved)).toBe(TownEras.stamp(w, s));
        // a loaded record is advanced from where it left off, not filled afresh
        runYears(w, 5); runYears(w2, 5);
        expect(saved.townEra).toEqual(s.townEra);
    });

    it('the saveLoad tile serialiser keeps the settlement whole (townEra rides along)', async () => {
        const src = fs.readFileSync('src/systems/saveLoad.js', 'utf8');
        expect(src).toMatch(/settlement: tile\.settlement/);
    });
});

describe('the world\'s generation is untouched', () => {
    it('no era state exists until a town is looked at or the year turns', () => {
        const w = mkWorld();
        for (const s of w.settlements) expect(s.townEra).toBeUndefined();
        expect(typeof SettlementWealth.score(w.settlements[0])).toBe('number');
    });
});

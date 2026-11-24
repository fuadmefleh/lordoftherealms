// Wind at sea (world/seaWinds.js), storms that cross the sea over days, and
// the new coast's dangers with pilots, charts and lighthouses
// (systems/seaPassage.js), as voyages feel them (systems/shipVoyages.js).

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Ships } from '../systems/ships.js';
import { SeaWinds, SeaStorms } from '../world/seaWinds.js';
import { SeaPassage } from '../systems/seaPassage.js';
import { ShipOfficers } from '../systems/shipOfficers.js';
import { vi } from 'vitest';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

let savedChance;
beforeEach(() => {
    Utils.setSeed(9191);
    savedChance = DataLoader.ships.settings.voyage.eventChance;
    DataLoader.ships.settings.voyage.eventChance = 0;
    return () => { DataLoader.ships.settings.voyage.eventChance = savedChance; };
});

const OCEAN = { id: 'ocean', passable: false };
const COAST = { id: 'coast', passable: false };
const PLAINS = { id: 'plains', passable: true };

/** A sea world felt by the wind (seaWinds: true); land and marks where listed. */
function seaWorld(land = {}, { width = 80, height = 60, day = 1, winds = true, marks = {} } = {}) {
    const tiles = new Map();
    const w = {
        width, height, day, seaWinds: winds, generationParams: winds ? { seed: 7 } : undefined,
        getTile(q, r) {
            if (r < 0 || r >= height) return null;
            q = ((q % width) + width) % width;
            const key = `${q},${r}`;
            if (!tiles.has(key)) {
                const spec = land[key];
                const t = {
                    q, r, terrain: spec ? spec.terrain || PLAINS : OCEAN,
                    settlement: spec && spec.settlement ? { q, r, ...spec.settlement } : null,
                    ...(marks[key] || {}),
                };
                tiles.set(key, t);
            }
            return tiles.get(key);
        },
        getSettlementViews() {
            const out = [];
            for (const [k, spec] of Object.entries(land)) {
                if (!spec.settlement) continue;
                const [q, r] = k.split(',').map(Number);
                out.push({ q, r, name: spec.settlement.name, type: spec.settlement.type });
            }
            return out;
        },
    };
    if (!winds) delete w.generationParams;
    return w;
}

const ship = (typeId, extra = {}) => ({
    id: 'ship_1', typeId, name: 'Gull', q: 5, r: 10, status: 'docked', condition: 100,
    customizations: [], cargo: {}, crew: Ships.getShipEffectiveStats({ typeId }).crewRequired, morale: 70, ...extra,
});
const captain = (s, extra = {}) => ({
    gold: 5000, renown: 0, karma: 0, health: 100, reputation: {}, inventory: {}, skills: {},
    ships: [s], army: [], q: s.q, r: s.r, boardedShip: null, maps: [], ...extra,
});

/** A row in the middle of a band: |latitude| a (0 equator .. 1 pole), northern half. */
const rowAt = (H, a) => Math.round((1 - a) * (H - 1) / 2);

describe('the prevailing winds by latitude', () => {
    it('trades blow west, westerlies east, polar easterlies west — mirrored in the south', () => {
        const w = seaWorld();
        const H = w.height;
        // day 15: the sun over the equator (no seasonal shift of the belts)
        const trade = SeaWinds.prevailing(w, 10, rowAt(H, 0.18), 15);
        const west = SeaWinds.prevailing(w, 10, rowAt(H, 0.5), 15);
        const polar = SeaWinds.prevailing(w, 10, rowAt(H, 0.85), 15);
        expect(trade.x).toBeLessThan(0);
        expect(trade.y).toBeGreaterThan(0);        // toward the equator (screen y down)
        expect(west.x).toBeGreaterThan(0);
        expect(west.y).toBeLessThan(0);            // poleward
        expect(polar.x).toBeLessThan(0);
        const southTrade = SeaWinds.prevailing(w, 10, H - 1 - rowAt(H, 0.18), 15);
        expect(southTrade.x).toBeLessThan(0);
        expect(southTrade.y).toBeLessThan(0);      // toward the equator from the south
        expect(SeaWinds.describe(west)).toMatch(/westerly/);
    });

    it('the doldrums are near calm; the belts follow the sun and blow harder in winter', () => {
        const w = seaWorld();
        const H = w.height;
        const eq = SeaWinds.prevailing(w, 10, Math.round((H - 1) / 2), 15);
        expect(eq.band).toBe('doldrums');
        expect(eq.strength).toBeLessThan(0.2);
        // a northern row by the trades' edge: westerlies in winter (the belts south), trades in summer
        const r = rowAt(H, 0.33);
        expect(SeaWinds.prevailing(w, 10, r, 45).band).toBe('trades');
        expect(SeaWinds.prevailing(w, 10, r, 105).band).toBe('westerlies');
        // the trades of the north blow hardest in the northern winter
        const tr = rowAt(H, 0.15);
        expect(SeaWinds.prevailing(w, 10, tr, 105).strength).toBeGreaterThan(SeaWinds.prevailing(w, 10, tr, 45).strength);
    });

    it('today\'s wind veers about the prevailing one, the same for the same world and day', () => {
        const w = seaWorld();
        const a = SeaWinds.at(w, 20, rowAt(w.height, 0.5), 30);
        const b = SeaWinds.at(seaWorld(), 20, rowAt(w.height, 0.5), 30);
        expect(a).toEqual(b);
        const angles = new Set();
        for (let d = 1; d < 60; d += 3) angles.add(Math.round(SeaWinds.at(w, 20, rowAt(w.height, 0.5), d).angle / 10));
        expect(angles.size).toBeGreaterThan(3);
    });
});

describe('the point of sail', () => {
    const wind = { x: 1, y: 0, strength: 0.8 };     // blowing east
    it('a beam reach is best, running fair, dead upwind slow (tacking)', () => {
        const rig = { rig: 'fore', oars: 0 };
        const run = SeaWinds.pointOfSail(wind, 0, rig);       // heading east
        const beam = SeaWinds.pointOfSail(wind, 1, rig);      // north-east (60°)
        const up = SeaWinds.pointOfSail(wind, 3, rig);        // west: dead into it
        expect(beam.factor).toBeGreaterThan(run.factor);
        expect(run.factor).toBeGreaterThan(up.factor);
        expect(up.factor).toBeLessThan(0.6);
        expect(up.point).toBe('tacking');
        expect(run.point).toBe('running');
    });
    it('a square-rigger sails worse to windward than a fore-and-aft rig; oars do not care', () => {
        const close = 2;    // north-west: 120° off the wind
        expect(SeaWinds.pointOfSail(wind, close, { rig: 'square' }).factor).toBeLessThan(SeaWinds.pointOfSail(wind, close, { rig: 'fore' }).factor);
        expect(SeaWinds.pointOfSail(wind, 3, { rig: 'oars', oars: 1 }).factor).toBe(1);
    });
    it('in light airs every point drifts toward the calm', () => {
        const light = SeaWinds.pointOfSail({ x: 1, y: 0, strength: 0.05 }, 1, { rig: 'fore' });
        expect(light.factor).toBeLessThan(0.6);
    });
});

describe('wind on a voyage', () => {
    it('downwind in the westerlies is quicker than the same way back against it', () => {
        const r = rowAt(60, 0.5);
        const w = seaWorld({ [`5,${r}`]: { settlement: { name: 'Westport', type: 'town' } }, [`35,${r}`]: { settlement: { name: 'Eastport', type: 'town' } } });
        const s = ship('cog', { q: 5, r });
        const p = captain(s);
        const east = Ships.seaPath(w, { q: 5, r }, { q: 35, r }, { player: p, ship: s });
        const west = Ships.seaPath(w, { q: 35, r }, { q: 5, r }, { player: p, ship: s });
        const ctx = { player: p, ship: s };
        const costE = SeaPassage.routeCost(w, ctx, { q: 5, r }, east, 0);
        const costW = SeaPassage.routeCost(w, ctx, { q: 35, r }, west, 0);
        expect(costE).toBeLessThan(costW);
        const res = Ships.startVoyage(p, w, s.id, 35, r, 'Eastport');
        expect(res.success).toBe(true);
        expect(s.voyage.log.some(e => /The wind/.test(e.text))).toBe(true);
    });

    it('a world the wind is not felt in sails a hex a league, as before', () => {
        const w = seaWorld({ '5,10': { settlement: { name: 'A', type: 'town' } }, '25,10': { settlement: { name: 'B', type: 'town' } } }, { winds: false });
        expect(SeaWinds.active(w)).toBe(false);
        const s = ship('sloop');
        const p = captain(s);
        const route = Ships.seaPath(w, s, { q: 25, r: 10 }, { player: p, ship: s });
        expect(route.length).toBe(20);
        expect(SeaPassage.routeCost(w, { player: p, ship: s }, s, route, 0)).toBe(20);
    });
});

describe('storms that cross the sea', () => {
    const big = () => seaWorld({}, { width: 160, height: 100 });

    it('are born in their belts and seasons, move day by day, and are the same for the same world', () => {
        const w = big();
        let found = null;
        for (let d = 1; d <= 240 && !found; d++) {
            const st = SeaStorms.active(w, d).find(x => x.age === 1);
            if (st) found = { st, d };
        }
        expect(found).not.toBe(null);
        const { st, d } = found;
        const next = SeaStorms.active(w, d + 1).find(x => x.id === st.id);
        if (next) expect(next.q !== st.q || next.r !== st.r).toBe(true);
        expect(SeaStorms.active(big(), d).map(x => x.id)).toEqual(SeaStorms.active(w, d).map(x => x.id));
        // hurricanes in the warm belt, gales in the middle latitudes
        const lat = Math.abs(1 - 2 * (st.r / (w.height - 1)));
        expect(lat).toBeLessThan(0.85);
    });

    it('a ship inside one is caught in it (Ships._stormAtSea), and the planner steers wide of it', () => {
        const w = big();
        let st = null, day = 0;
        for (let d = 1; d <= 300 && !st; d++) {
            st = SeaStorms.active(w, d).find(x => x.intensity > 0.8) || null;
            day = d;
        }
        expect(st).not.toBe(null);
        w.day = day;
        const s = ship('cog', { q: st.q, r: st.r, status: 'at_sea' });
        const storm = Ships._stormAtSea(s, w);
        expect(storm).not.toBe(null);
        expect(storm.danger).toBeGreaterThan(0.4);
        expect(['gale', 'hurricane']).toContain(storm.type);
        expect(SeaStorms.dangerAt(w, Hex.wrapQ(st.q + st.radius + 3, w.width), st.r, day)).toBe(null);
    });
});

describe('the new coast: reefs, shoals, bars and fjords', () => {
    it('knows a reef, the shoals by a skerry, a river\'s bar and a fjord', () => {
        const w = seaWorld({
            '20,20': { terrain: { id: 'island', passable: true } },
            '30,20': { terrain: PLAINS },
        }, {
            marks: {
                '10,10': { _reef: true },
                '20,20': { _skerry: true },
                '30,20': { hasRiver: true, riverDir: 0 },    // runs east, into (31, 20)
                '40,40': { _fjord: true, terrain: COAST },
            },
        });
        expect(SeaPassage.hazardAt(w, 10, 10).reef).toBe(true);
        expect(SeaPassage.hazardAt(w, 21, 20).shoal).toBe(true);
        expect(SeaPassage.hazardAt(w, 31, 20).bar).toBe(true);
        expect(SeaPassage.hazardAt(w, 40, 40).fjord).toBe(true);
        expect(SeaPassage.hazardAt(w, 50, 50)).toBe(null);
    });

    it('a reef is worse at speed and in the dark; a pilot, a chart and a lighthouse make it safer', () => {
        const w = seaWorld({ '14,10': { settlement: { name: 'Lampwick', type: 'capital' } } }, { marks: { '10,10': { _reef: true } } });
        const s = ship('cog', { q: 9, r: 10 });
        const p = captain(s);
        const day = SeaPassage.strikeChance(w, p, s, 10, 10, {}).p;
        const fast = SeaPassage.strikeChance(w, p, s, 10, 10, { atSpeed: true }).p;
        // in the dark, far from any light
        const far = seaWorld({}, { marks: { '10,10': { _reef: true } } });
        const dark = SeaPassage.strikeChance(far, p, s, 10, 10, { night: true }).p;
        expect(fast).toBeGreaterThan(day);
        expect(dark).toBeGreaterThan(fast);
        // the capital's lighthouse reaches it: the night is hardly darker than day
        expect(SeaPassage.litAt(w, p, 10, 10)).not.toBe(null);
        expect(SeaPassage.strikeChance(w, p, s, 10, 10, { night: true }).p).toBeLessThan(dark / 3);
        // a chart of the hex halves it, a pilot in his waters takes most of it away
        p.maps = [{ type: 'regional', tiles: [{ q: 10, r: 10 }] }];
        expect(SeaPassage.strikeChance(w, p, s, 10, 10, {}).p).toBeCloseTo(day * 0.5, 6);
        s.pilot = { name: 'Old Tam', port: 'Lampwick', q: 14, r: 10, radius: 6, until: 999 };
        expect(SeaPassage.strikeChance(w, p, s, 10, 10, {}).p).toBeCloseTo(day * 0.5 * 0.1, 6);
        // a rowboat floats over most of it
        expect(SeaPassage.strikeChance(w, captain(ship('rowboat')), ship('rowboat'), 10, 10, {}).p).toBeLessThan(day);
    });

    it('a navigator keeps her off the reef (ShipOfficers routeSafety)', () => {
        const w = seaWorld({}, { marks: { '10,10': { _reef: true } } });
        const s = ship('cog', { q: 9, r: 10 });
        const p = captain(s);
        const bare = SeaPassage.strikeChance(w, p, s, 10, 10, {}).p;
        const spy = vi.spyOn(ShipOfficers, 'bonus').mockImplementation((sh, kind) => (kind === 'routeSafety' ? 0.3 : 0));
        try {
            expect(SeaPassage.strikeChance(w, p, s, 10, 10, {}).p).toBeCloseTo(bare * 0.7, 6);
        } finally {
            spy.mockRestore();
        }
    });

    it('the route planner steers round a reef unpiloted, and through it with a pilot', () => {
        // a wall of reef across row 10 but for a gap far round
        const marks = {};
        for (let q = 12; q <= 16; q++) for (let r = 5; r <= 15; r++) marks[`${q},${r}`] = { _reef: true };
        const land = { '8,10': { settlement: { name: 'Here', type: 'town' } }, '20,10': { settlement: { name: 'There', type: 'town' } } };
        const w = seaWorld(land, { winds: false, marks });
        const s = ship('cog', { q: 8, r: 10 });
        const p = captain(s);
        const wide = Ships.seaPath(w, { q: 8, r: 10 }, { q: 20, r: 10 }, { player: p, ship: s });
        expect(wide.some(h => SeaPassage.hazardAt(w, h.q, h.r))).toBe(false);
        s.pilot = { name: 'Old Tam', port: 'Here', q: 8, r: 10, radius: 12, until: 999 };
        const straight = Ships.seaPath(w, { q: 8, r: 10 }, { q: 20, r: 10 }, { player: p, ship: s });
        expect(straight.some(h => SeaPassage.hazardAt(w, h.q, h.r))).toBe(true);
        expect(straight.length).toBeLessThan(wide.length);
    });

    it('cautious orders lie to at night before an unpiloted reef; pressing on runs it', () => {
        const marks = {};
        for (let q = 9; q <= 30; q++) marks[`${q},10`] = { _reef: q === 12 };
        const land = { '5,10': { settlement: { name: 'A', type: 'town' } }, '30,10': { settlement: { name: 'B', type: 'town' } } };
        const mk = () => {
            const w = seaWorld(land, { winds: false, marks });
            const s = ship('cog', { q: 5, r: 10, status: 'at_sea' });
            const p = captain(s, { boardedShip: s.id });
            s.voyage = { destQ: 30, destR: 10, destName: 'B', fromQ: 5, fromR: 10, route: [], step: 0, day: 0, delay: 0, log: [] };
            for (let q = 6; q <= 30; q++) s.voyage.route.push([q, 10]);
            return { w, s, p };
        };
        // budget 10 leagues: daylight is about half the run, the reef (7th hex) in the dark
        const a = mk();
        const lay = SeaPassage.sailDay(Ships, a.p, a.w, a.s, 10);
        expect(lay.lay).toBe('reef');
        expect(a.s.voyage.step).toBe(6);
        const b = mk();
        SeaPassage.setOrders(Ships, b.p, 'press');
        const run = SeaPassage.sailDay(Ships, b.p, b.w, b.s, 10);
        expect(run.lay).toBe(null);
        expect(b.s.voyage.step).toBeGreaterThan(6);
    });

    it('striking a reef tears the hull and loses the rest of the day', () => {
        const marks = { '7,10': { _reef: true } };
        const w = seaWorld({ '5,10': { settlement: { name: 'A', type: 'town' } }, '30,10': { settlement: { name: 'B', type: 'town' } } }, { winds: false, marks });
        const s = ship('galleon', { q: 5, r: 10, status: 'at_sea', cargo: { cloth: 20 } });
        const p = captain(s, { boardedShip: s.id });
        s.voyage = { destQ: 30, destR: 10, destName: 'B', fromQ: 5, fromR: 10, route: [], step: 0, day: 0, delay: 0, log: [], orders: 'press' };
        for (let q = 6; q <= 30; q++) s.voyage.route.push([q, 10]);
        const orig = DataLoader._gamedata.seaWinds.coast.hazards.reef.risk;
        const rand = Utils.random;
        DataLoader._gamedata.seaWinds.coast.hazards.reef.risk = 5;    // as likely as it gets
        SeaPassage.resetConfig();
        Utils.random = () => 0.01;
        try {
            const out = SeaPassage.sailDay(Ships, p, w, s, 10);
            expect(out.strikes.length).toBe(1);
            expect(out.strikes[0].kind).toBe('reef');
            expect(s.condition).toBeLessThan(100);
            expect(s.voyage.step).toBe(2);
            expect(s.voyage.delay).toBe(1);
        } finally {
            Utils.random = rand;
            DataLoader._gamedata.seaWinds.coast.hazards.reef.risk = orig;
            SeaPassage.resetConfig();
        }
    });
});

describe('pilots and lighthouses', () => {
    it('a pilot is hired at a port, the fee into its purse, and goes ashore at the voyage\'s end', () => {
        const land = { '5,10': { settlement: { name: 'Saltmere', type: 'city', economy: { gold: 100 } } }, '15,10': { settlement: { name: 'Gullhaven', type: 'town' } } };
        const w = seaWorld(land, { winds: false });
        const s = ship('sloop');
        const p = captain(s);
        const offer = SeaPassage.pilotOffer(w, 5, 10);
        expect(offer.radius).toBeGreaterThan(SeaPassage.config().pilots.byType.town.radius);
        const res = SeaPassage.hirePilot(Ships, p, w, s.id);
        expect(res.success).toBe(true);
        expect(p.gold).toBe(5000 - offer.fee);
        expect(w.getTile(5, 10).settlement.economy.gold).toBe(100 + offer.fee);
        expect(SeaPassage.pilotCovers(s, w, 5 + offer.radius, 10)).toBe(true);
        expect(SeaPassage.pilotCovers(s, w, 5 + offer.radius + 2, 10)).toBe(false);
        expect(Ships.startVoyage(p, w, s.id, 15, 10, 'Gullhaven').success).toBe(true);
        for (let i = 0; i < 10 && Ships.getVoyage(p); i++) { w.day++; Ships.processDaily(p, w); }
        expect(s.status).toBe('docked');
        expect(s.pilot).toBeUndefined();
        expect(s.lastVoyage.log.some(e => /goes ashore/.test(e.text))).toBe(true);
    });

    it('the major ports keep lighthouses, and send a pilot cutter to a ship making for them', () => {
        const land = { '5,10': { settlement: { name: 'Hamlet', type: 'village' } }, '25,10': { settlement: { name: 'Crownhaven', type: 'capital', economy: { gold: 0 } } } };
        const w = seaWorld(land, { winds: false });
        const lights = SeaPassage.lighthouses(w, null);
        expect(lights.map(l => l.name)).toEqual(['Crownhaven']);
        const s = ship('sloop');
        const p = captain(s);
        expect(Ships.startVoyage(p, w, s.id, 25, 10, 'Crownhaven').success).toBe(true);
        for (let i = 0; i < 10 && Ships.getVoyage(p); i++) { w.day++; Ships.processDaily(p, w); }
        expect(s.lastVoyage.log.some(e => /pilot cutter/.test(e.text))).toBe(true);
        expect(w.getTile(25, 10).settlement.economy.gold).toBeGreaterThan(0);
    });

    it('the player\'s own lighthouse lights the coast about it', () => {
        const w = seaWorld({}, { winds: false });
        const p = captain(ship('sloop'), { properties: [{ type: 'lighthouse_building', q: 30, r: 30 }] });
        expect(SeaPassage.litAt(w, p, 32, 30)).not.toBe(null);
        expect(SeaPassage.litAt(w, p, 40, 30)).toBe(null);
    });
});

describe('the panels', () => {
    it('the voyage view tells the wind, the pilot and the coast ahead', () => {
        const r = rowAt(60, 0.5);
        const marks = { [`9,${r}`]: { _reef: true } };
        const w = seaWorld({ [`5,${r}`]: { settlement: { name: 'A', type: 'town' } }, [`30,${r}`]: { settlement: { name: 'B', type: 'town' } } }, { marks });
        const s = ship('cog', { q: 5, r });
        const p = captain(s);
        s.pilot = { name: 'Old Tam', port: 'A', q: 5, r, radius: 7, until: 999 };
        expect(Ships.startVoyage(p, w, s.id, 30, r, 'B').success).toBe(true);
        const view = SeaPassage.voyageView(Ships, p, w);
        expect(view.wind).toMatch(/[a-z]/);
        expect(view.pilot.name).toBe('Old Tam');
        expect(view.orders).toBe('cautious');
        const notes = SeaPassage.hexNotes(w, p, 9, r);
        expect(notes.some(n => /Wind/.test(n))).toBe(true);
        expect(notes.some(n => /Reef/.test(n))).toBe(true);
    });
});

describe('on a generated world', () => {
    it('has a coast to mind, lighthouses at the great ports, storms in a year, and plans quickly', async () => {
        const { newGame, loadData } = await import('./playtest/harness.js');
        await loadData();
        // (a new game's world: terrainGen 17, as ui/game/worldParams.js)
        const { world } = newGame(4401, { width: 120, height: 80, terrainGen: 17, riverCount: 40, kingdomCount: 6 });
        expect(SeaWinds.active(world)).toBe(true);
        let hazards = 0;
        const kinds = new Set();
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const h = SeaPassage.hazardAt(world, q, r);
                if (h) { hazards++; h.kinds.forEach(k => kinds.add(k)); }
            }
        }
        expect(hazards).toBeGreaterThan(0);
        expect(kinds.has('bar')).toBe(true);
        const lights = SeaPassage.lighthouses(world, null);
        expect(lights.length).toBeGreaterThan(0);
        let stormDays = 0;
        for (let d = world.day; d < world.day + 120; d++) if (SeaStorms.active(world, d).length) stormDays++;
        expect(stormDays).toBeGreaterThan(10);
        // the Set Sail plan from a port, out to every other
        const port = lights[0];
        const t0 = Date.now();
        const plan = SeaPassage.planFrom(Ships, world, port, { maxNodes: 60000 });
        const routes = Ships.seaRoutes(world, port.q, port.r);
        let planned = 0;
        for (const dest of routes.slice(0, 10)) if (plan.routeTo(dest.q, dest.r)) planned++;
        expect(Date.now() - t0).toBeLessThan(3000);
        expect(planned).toBe(Math.min(10, routes.length));
        // a voyage across it: the wind felt, the ship arrives
        const far = routes[routes.length - 1];
        const s = ship('caravel', { q: port.q, r: port.r });
        const p = captain(s);
        expect(Ships.startVoyage(p, world, s.id, far.q, far.r, far.name).success).toBe(true);
        for (let i = 0; i < 80 && Ships.getVoyage(p); i++) {
            world.day++;
            Ships.processDaily(p, world);
            if (Ships.describeVoyageEvent(p)) Ships.resolveVoyageEvent(p, world, null);
            if (s.voyage && s.voyage.delay > 3) s.voyage.delay = 0;
        }
        expect(s.status).toBe('docked');
        expect(s.lastVoyage.log.some(e => /leagues?, (running|on a|close|beating)/.test(e.text))).toBe(true);
    }, 60000);
});

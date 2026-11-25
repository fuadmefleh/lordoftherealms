// Ports as places and the working boats: river ferries (world/ferries.js)
// and the fare at them, strait ferries, the harbourmaster's dues and berths,
// the shipyard's slip drawing on the town's market, careening, the fishing
// fleet kept in by the weather, and the barges of the river trade
// (systems/ports.js, systems/barges.js).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

let DataLoader, Rivers, Ferries, Ports, Barges, Ships, SettlementMarket, Player, WorldUnit;

beforeAll(async () => {
    ({ DataLoader } = await import('../core/dataLoader.js'));
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    ({ Rivers } = await import('../world/rivers.js'));
    ({ Ferries } = await import('../world/ferries.js'));
    ({ Ports } = await import('../systems/ports.js'));
    ({ Barges } = await import('../systems/barges.js'));
    ({ Ships } = await import('../systems/ships.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
    ({ Player } = await import('../player/player.js'));
    ({ WorldUnit } = await import('../world/units.js'));
}, 120000);

let baseRivers;
beforeEach(() => {
    if (baseRivers === undefined) baseRivers = DataLoader._gamedata.rivers || null;
    // (the fixture's river is short: smaller bands, so it has a great river)
    DataLoader._gamedata.rivers = { ...(baseRivers || {}), bands: { river: 4, great: 10 } };
});
afterEach(() => {
    DataLoader._gamedata.rivers = baseRivers;
});

const PLAINS = { id: 'plains', passable: true, moveCost: 1 };
const OCEAN = { id: 'ocean', passable: false, moveCost: Infinity };

/**
 * A 20 x 12 world of plains, the sea in columns 18-19. A river along row 6
 * from q=1 flowing east to the sea (a great river from q 10 with bands
 * river 4 / great 10). Towns may be put on it.
 */
function makeWorld({ towns = [] } = {}) {
    const W = 20, H = 12;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const t = { q, r, terrain: q >= 18 ? OCEAN : PLAINS, elevation: q >= 18 ? 0.3 : 0.5, hasRiver: false, explored: true };
            if (r === 6 && q >= 1 && q <= 17) { t.hasRiver = true; t.riverDir = 0; t.elevation = 0.5 - q * 0.002; }
            row.push(t);
        }
        tiles.push(row);
    }
    for (const [q, r, name, type = 'town'] of towns) tiles[r][q].settlement = { name, type, economy: { gold: 100 } };
    return {
        width: W, height: H, tiles, day: 100, units: [],
        generationParams: { seed: 7, terrainGen: 16 },
        getTile(q, r) {
            if (r < 0 || r >= H) return null;
            return tiles[r][((q % W) + W) % W];
        },
    };
}

describe('river ferries', () => {
    it('ply the great river near a town where it has no crossing, deterministically', () => {
        const w = makeWorld({ towns: [[13, 4, 'Ferrybridge']] });
        const list = Ferries.riverFerries(w);
        expect(list.length).toBe(1);
        const f = list[0];
        expect(f.r).toBe(6);
        expect(Rivers.band(w, f.q, f.r)).toBe('great');
        expect(f.town.name).toBe('Ferrybridge');
        expect(f.fare).toBeGreaterThan(0);
        expect(f.hours.length).toBeGreaterThan(2);
        expect(Ferries.at(w, f.q, f.r)).toBe(f);
        // the same world, the same ferry
        const again = Ferries.riverFerries(makeWorld({ towns: [[13, 4, 'Ferrybridge']] }))[0];
        expect([again.q, again.r, again.ferryman]).toEqual([f.q, f.r, f.ferryman]);
    });

    it('none on a brook or a river, nor far from any town, nor where a road crosses', () => {
        expect(Ferries.riverFerries(makeWorld({ towns: [[4, 4, 'Brookby']] })).length).toBe(0);
        expect(Ferries.riverFerries(makeWorld({ towns: [[13, 0, 'Farfield']] })).length).toBe(0);
        const w = makeWorld({ towns: [[13, 5, 'Roadend']] });
        for (const t of w.tiles[6]) t.hasRoad = true;
        expect(Ferries.riverFerries(w).length).toBe(0);
    });

    it('cross for a share of the wade and the wait; the fare goes to the ferry town', () => {
        const w = makeWorld({ towns: [[13, 4, 'Ferrybridge']] });
        const f = Ferries.riverFerries(w)[0];
        const C = Rivers.config().crossing;
        const wade = Rivers.crossExtra(w, f.q, 5, f.q, 6, 'player');
        expect(wade).toBeCloseTo(C.player.great, 6);
        const soft = Ferries.soften(f, wade, 'player');
        expect(soft).toBeLessThan(wade * 0.5);
        expect(soft).toBeGreaterThan(0);
        // the player walking: the ferry's cost while there's coin for the fare, the wade without
        const p = new Player({ firstName: 'Test', lastName: 'Walker', gender: 'male', age: 20 });
        p.q = f.q; p.r = 5; p.gold = 50;
        const tile = w.getTile(f.q, 6);
        const plain = p._hexMoveCost(tile);
        const pace = p._travelPace();
        expect(p._legMoveCost(w, tile, f.q, 5, f.q, 6)).toBeCloseTo(plain + soft * pace, 6);
        p.gold = 0;
        expect(p._legMoveCost(w, tile, f.q, 5, f.q, 6)).toBeCloseTo(plain + wade * pace, 6);
        // stepping across pays the ferryman (into the town's purse)
        p.gold = 50;
        const purse = w.getTile(13, 4).settlement.economy.gold;
        const res = Ports.ferryStep(w, p, f.q, 5, f.q, 6);
        expect(res.paid).toBe(f.fare);
        expect(p.gold).toBe(50 - f.fare);
        expect(w.getTile(13, 4).settlement.economy.gold).toBe(purse + f.fare);
        expect(p.lastFerry.ferryman).toBe(f.ferryman);
        // ...and told: the ferryman, the fare, the time saved on the wade
        expect(res.text).toContain(f.ferryman);
        expect(res.text).toContain(`${f.fare}g`);
        expect(res.extra).toBeLessThan(res.wade);
        // ...in the time the road really takes: a bridging reduction shortens it (Infrastructure.riverCrossFactor)
        p.gold = 50;
        p.patronage = { fx: { riverCross: 0.5 } };
        const road = p._riverCrossDays(w, f.q, 5, f.q, 6);
        const half = Ports.ferryStep(w, p, f.q, 5, f.q, 6);
        expect(half.extra).toBeCloseTo(res.extra * 0.5, 6);
        expect(half.extra).toBeCloseTo(road, 6);
        delete p.patronage;
        // ...and nothing going along the river or on dry land
        expect(Ports.ferryStep(w, p, f.q - 1, 6, f.q, 6)).toBe(null);
        expect(Ports.ferryStep(w, p, 3, 3, 3, 4)).toBe(null);
    });

    it('carry a war host over quicker than it could wade', () => {
        const march = (town) => {
            const w = makeWorld({ towns: town ? [[12, 4, 'Ferrybridge']] : [] });
            const f = town ? Ferries.riverFerries(w)[0] : null;
            const q = f ? f.q : 12;
            const u = new WorldUnit('war_host', q, 2);
            u.speed = 3;
            u.objectiveQ = q; u.objectiveR = 10;
            let days = 0;
            while (!(u.q === q && u.r === 10) && days < 20) { u.updateWarHost(w); days++; }
            return { days, debt: u._riverDebt || 0 };
        };
        const wade = march(false), ferried = march(true);
        expect(ferried.days).toBeLessThanOrEqual(wade.days);
        expect(Ferries.soften({ hours: [6, 12, 18] }, 2, 'army')).toBeCloseTo(2 * Ferries.config().share.army, 6);
    });

    it('wait for the next sailing by the timetable', () => {
        const f = { hours: [6, 9, 12, 15, 18] };
        expect(Ferries.nextSailing(f, 7.5)).toEqual({ hour: 9, tomorrow: false });
        expect(Ferries.nextSailing(f, 19)).toEqual({ hour: 6, tomorrow: true });
        // 3-hour gaps by daylight: an hour and a half on average
        expect(Ferries.waitDays(f)).toBeCloseTo(1.5 / 24, 2);
    });
});

describe('strait ferries', () => {
    /** Two islands two hexes of sea apart, a port on each. */
    function islands() {
        const W = 16, H = 10;
        const tiles = [];
        for (let r = 0; r < H; r++) {
            const row = [];
            for (let q = 0; q < W; q++) {
                const land = (q >= 2 && q <= 5 && r >= 3 && r <= 6) || (q >= 8 && q <= 11 && r >= 3 && r <= 6);
                row.push({ q, r, terrain: land ? PLAINS : OCEAN, explored: true });
            }
            tiles.push(row);
        }
        tiles[4][5].settlement = { name: 'Westhaven', type: 'town', economy: { gold: 10 } };
        tiles[4][8].settlement = { name: 'Easthaven', type: 'village', economy: { gold: 10 } };
        return { width: W, height: H, tiles, day: 10, units: [], getTile(q, r) { return r < 0 || r >= H ? null : tiles[r][((q % W) + W) % W]; } };
    }

    it('run between ports on different landmasses, and carry the player across for the fare and the day', () => {
        const w = islands();
        const st = Ferries.straits(w);
        expect(st.length).toBe(1);
        expect([st[0].a.name, st[0].b.name].sort()).toEqual(['Easthaven', 'Westhaven']);
        const p = { q: 5, r: 4, gold: 100, army: [], movementRemaining: 5 };
        const offers = Ports.straitOffers(w, p);
        expect(offers.length).toBe(1);
        expect(offers[0].to.name).toBe('Easthaven');
        const res = Ports.takeStrait(w, p, offers[0].ferry.id);
        expect(res.ok).toBe(true);
        expect([p.q, p.r]).toEqual([8, 4]);
        expect(p.gold).toBe(100 - res.fare);
        expect(p.movementRemaining).toBe(0);
        expect(w.getTile(5, 4).settlement.economy.gold).toBe(10 + res.fare);
        // and back costs the same; without the fare, no passage
        const broke = { q: 8, r: 4, gold: 0, army: [] };
        expect(Ports.takeStrait(w, broke, offers[0].ferry.id).ok).toBe(false);
    });

    it('none between ports on one landmass', () => {
        const w = islands();
        for (let q = 6; q <= 7; q++) w.tiles[4][q].terrain = PLAINS;
        Ferries.reset(w);
        expect(Ferries.straits(w).length).toBe(0);
    });
});

/** A port town on the coast at (5, 5), the sea at q >= 6. */
function portWorld(day = 100) {
    const W = 14, H = 10;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: q >= 6 ? OCEAN : PLAINS, explored: true });
        tiles.push(row);
    }
    const s = { name: 'Saltmere', type: 'town', population: 1200, economy: { gold: 500 } };
    tiles[5][5].settlement = s;
    s.q = 5; s.r = 5;
    return { width: W, height: H, tiles, day, units: [], getTile(q, r) { return r < 0 || r >= H ? null : tiles[r][((q % W) + W) % W]; } };
}

const sloop = (over = {}) => ({ id: 'ship_9001', name: 'Gull', typeId: 'sloop', status: 'docked', q: 5, r: 5, cargo: {}, crew: 4, morale: 70, condition: 100, ...over });

describe('the harbour', () => {
    it('has a harbourmaster and berths by the town\'s size', () => {
        const w = portWorld();
        const s = w.getTile(5, 5).settlement;
        const m = Ports.master(w, s);
        expect(typeof m.name).toBe('string');
        expect(Ports.master(w, s).name).toBe(m.name);
        const b = Ports.berths(w, { ships: [] }, 5, 5);
        expect(b.total).toBe(Ports.config().harbour.berths.town);
        expect(b.free).toBe(b.total - b.town);
        expect(Ports.portAt(w, 2, 2)).toBe(null);
    });

    it('takes dues when a ship of yours makes port, into the town\'s purse — not at first sight, not twice', () => {
        const w = portWorld();
        const s = w.getTile(5, 5).settlement;
        const player = { gold: 100, ships: [sloop()] };
        Ports.processDay(w, player);
        expect(player.gold).toBe(100); // (first sight: she was here)
        player.ships[0].status = 'moving';
        Ports.processDay(w, player);
        player.ships[0].status = 'docked';
        const due = Ports.duesFor(w, player, player.ships[0], 5, 5).fee;
        expect(due).toBeGreaterThan(0);
        const purse = s.economy.gold;
        const out = Ports.processDay(w, player);
        expect(player.gold).toBe(100 - due);
        expect(s.economy.gold).toBe(purse + due);
        expect(out.notices.some(n => n.title === 'Harbour Dues')).toBe(true);
        Ports.processDay(w, player);
        expect(player.gold).toBe(100 - due);
        expect(Ports.state(s).calls).toBe(1);
    });

    it('charges the lighters when every berth is taken, and nothing in your own realm', () => {
        const w = portWorld();
        const s = w.getTile(5, 5).settlement;
        const player = { gold: 100, ships: [sloop()] };
        const open = Ports.duesFor(w, player, player.ships[0], 5, 5);
        for (let i = 0; i < 6; i++) player.ships.push(sloop({ id: `ship_${i}`, name: `Hulk ${i}` }));
        const full = Ports.duesFor(w, player, player.ships[0], 5, 5);
        expect(full.roads).toBe(true);
        expect(full.fee).toBeGreaterThan(open.fee);
        s.kingdom = 'k1';
        player.throne = { ruling: { kingdomId: 'k1' } };
        expect(Ports.duesFor(w, player, player.ships[0], 5, 5).fee).toBe(0);
    });

    it('books what you cannot pay, and takes it the next day you have it', () => {
        const w = portWorld();
        const s = w.getTile(5, 5).settlement;
        const player = { gold: 0, ships: [sloop({ portCall: null })] };
        Ports.processDay(w, player);
        const owed = Ports.state(s).owed;
        expect(owed).toBeGreaterThan(0);
        expect(player.ships[0].duesOwed.amount).toBe(owed);
        player.gold = 200;
        const out = Ports.processDay(w, player);
        expect(Ports.state(s).owed).toBe(0);
        expect(player.gold).toBe(200 - owed);
        expect(player.ships[0].duesOwed).toBeUndefined();
        expect(out.notices.some(n => n.title === 'Dues Paid')).toBe(true);
    });
});

describe('the shipyard', () => {
    it('goes up stage by stage', () => {
        const stages = Ports.stages();
        expect(stages.map(s => s.id)).toEqual(['keel', 'frames', 'planked', 'decked', 'rigged']);
        expect(Ports.stageAt(0).stage.id).toBe('keel');
        expect(Ports.stageAt(0.3).stage.id).toBe('frames');
        expect(Ports.stageAt(0.999).stage.id).toBe('rigged');
        const st = Ships.getShipType('sloop');
        const ship = sloop({ status: 'building', buildDaysLeft: st.buildDays });
        expect(Ports.stageOf(ship).stage.id).toBe('keel');
        ship.buildDaysLeft = 1;
        expect(Ports.stageOf(ship).stage.id).toBe('rigged');
    });

    it('draws the stage\'s timber from the town\'s market — and the slip waits when there is none', () => {
        const w = portWorld();
        const s = w.getTile(5, 5).settlement;
        SettlementMarket.ensure(s);
        s.market.stock.wood = 0;
        const st = Ships.getShipType('sloop');
        const ship = sloop({ status: 'building', buildDaysLeft: st.buildDays });
        const player = { gold: 0, ships: [ship] };
        const out = Ports.yardDay(w, player);
        // (the day is given back: Ships.processDaily will take it off again)
        expect(ship.buildDaysLeft).toBe(st.buildDays + 1);
        expect(ship.yardWaiting).toBe('wood');
        expect(out.notices.length).toBe(1);
        s.market.stock.wood = 100;
        ship.buildDaysLeft = st.buildDays;
        Ports.yardDay(w, player);
        expect(ship.buildDaysLeft).toBe(st.buildDays);
        expect(ship.yardWaiting).toBeUndefined();
        expect(s.market.stock.wood).toBeLessThan(100);
        expect(ship.yardUsed.wood).toBeGreaterThan(0);
        // the stall is capped: a yard short for ever makes do
        s.market.stock.wood = 0;
        ship.yardStall = 999;
        Ports.yardDay(w, player);
        expect(ship.buildDaysLeft).toBe(st.buildDays);
    });

    it('shows your ship on the slip, else now and then a hull of the town\'s own', () => {
        const w = portWorld();
        const st = Ships.getShipType('sloop');
        const player = { ships: [sloop({ status: 'building', buildDaysLeft: Math.round(st.buildDays / 2) })] };
        const slip = Ports.slipAt(w, player, 5, 5);
        expect(slip.length).toBe(1);
        expect(slip[0].kind).toBe('yours');
        let town = 0;
        for (let d = 0; d < 140; d++) if (Ports.slipAt(w, { ships: [] }, 5, 5, d).length) town++;
        expect(town).toBeGreaterThan(0);
        expect(town).toBeLessThan(140);
    });
});

describe('careening', () => {
    it('mends the hull over days with the ship out of service, cheaper than the quick repair', () => {
        const w = portWorld();
        const s = w.getTile(5, 5).settlement;
        const ship = sloop({ condition: 58 });
        const player = { gold: 1000, ships: [ship] };
        const opts = Ports.careenOptions(w, player, ship);
        const beach = opts.find(o => o.kind === 'beach');
        const dock = opts.find(o => o.kind === 'dock');
        expect(beach.ok).toBe(true);
        expect(beach.cost).toBeLessThan(Ships.getRepairCost(ship));
        // (a town has no dry dock)
        expect(dock.ok).toBe(false);
        s.type = 'city';
        expect(Ports.careenOptions(w, player, ship).find(o => o.kind === 'dock').ok).toBe(true);
        expect(Ports.careenOptions(w, player, ship).find(o => o.kind === 'dock').days).toBeLessThan(beach.days);
        s.type = 'town';
        const res = Ports.careen(w, player, ship.id, 'beach');
        expect(res.ok).toBe(true);
        expect(player.gold).toBe(1000 - beach.cost);
        expect(ship.status).toBe('careened');
        // out of service: she cannot sail or be sold
        expect(Ships.moveShip(player, ship.id, 8, 5, 'Away', w).success).toBe(false);
        expect(Ships.sellShip(player, ship.id, w).success).toBe(false);
        let afloat = null;
        for (let d = 0; d < beach.days; d++) {
            const out = Ports.processDay(w, player);
            if (out.notices.some(n => n.title === 'Afloat Again')) afloat = d + 1;
        }
        expect(afloat).toBe(beach.days);
        expect(ship.status).toBe('docked');
        expect(ship.condition).toBe(100);
    });

    it('is refused for a sound hull, away from harbour, or without the coin', () => {
        const w = portWorld();
        const player = { gold: 0, ships: [sloop({ condition: 99 })] };
        expect(Ports.careen(w, player, 'ship_9001', 'beach').ok).toBe(false);
        player.ships[0].condition = 50;
        expect(Ports.careen(w, player, 'ship_9001', 'beach').ok).toBe(false);
        player.gold = 1000;
        player.ships[0].q = 9;
        expect(Ports.careen(w, player, 'ship_9001', 'beach').ok).toBe(false);
    });
});

describe('the fishing fleet', () => {
    it('stays in through a storm, and the market\'s fish falls by the days lost', () => {
        const w = portWorld();
        const s = w.getTile(5, 5).settlement;
        const fl = Ports.fleet(w, 5, 5);
        expect(fl.boats).toBe(Ports.config().fishing.boatsBySize.town);
        expect(fl.water).toBe('sea');
        // no weather at all: every day out, the crew untouched
        const crew = { g: { fish: 1, grain: 1 }, r: {}, occ: {} };
        expect(Ports.fishCrew(crew, w, s, 5, 5, 100, 4)).toBe(crew);
        // two storm days of four
        w.weather = { getWeather: (q, r, day) => ({ type: day % 2 ? 'storm' : 'clear' }) };
        expect(Ports.keptIn(w, 5, 5, 101)).toBe('storm');
        expect(Ports.outShare(w, 5, 5, 100, 4)).toBe(0.5);
        const out = Ports.fishCrew(crew, w, s, 5, 5, 100, 4);
        expect(out).not.toBe(crew);
        expect(crew.g.fish).toBe(1); // (the cached crew is left alone)
        const floor = Ports.config().fishing.shoreFloor;
        expect(out.g.fish).toBeCloseTo(floor + (1 - floor) * 0.5, 6);
        expect(out.g.grain).toBe(1);
        // a town with no roster's crew (null) still loses its fish
        expect(Ports.fishCrew(null, w, s, 5, 5, 100, 4).g.fish).toBeCloseTo(floor + (1 - floor) * 0.5, 6);
    });

    it('is none for an inland town', () => {
        const w = portWorld();
        w.tiles[2][2].settlement = { name: 'Inland', type: 'town' };
        expect(Ports.fleet(w, 2, 2)).toBe(null);
    });
});

describe('barges', () => {
    it('carry the river link\'s biggest lot along the river from the exporter to the importer', () => {
        const w = makeWorld({ towns: [[3, 6, 'Upton'], [14, 6, 'Downey']] });
        const a = w.getTile(3, 6).settlement, b = w.getTile(14, 6).settlement;
        Object.assign(a, { q: 3, r: 6 });
        Object.assign(b, { q: 14, r: 6 });
        const ids = SettlementMarket.config().goodIds;
        const link = { a, b, river: true, sea: false, bigQ: 12.5, bigI: ids.indexOf('grain'), bigAB: false };
        expect(Barges.afterFlows(w, [link], 100)).toBe(1);
        const [barge] = Barges.list(w);
        expect(barge.good).toBe('grain');
        expect(barge.from.name).toBe('Downey');
        expect(barge.to.name).toBe('Upton');
        expect(barge.path[0]).toEqual({ q: 14, r: 6 });
        expect(barge.path[barge.path.length - 1]).toEqual({ q: 3, r: 6 });
        for (const p of barge.path.slice(1, -1)) expect(w.getTile(p.q, p.r).hasRiver).toBe(true);
        const mid = Barges.positionAt(barge, 100 + barge.days / 2);
        expect(mid.r).toBe(6);
        expect(Barges.positionAt(barge, 100 + barge.days + 1)).toBe(null);
        // the same link again while she is under way: no second barge
        expect(Barges.afterFlows(w, [link], 101)).toBe(0);
        // not by road, nor a link that moved nothing
        Barges.reset(w);
        expect(Barges.afterFlows(w, [{ ...link, river: false }], 100)).toBe(0);
        expect(Barges.afterFlows(w, [{ ...link, bigQ: 0 }], 100)).toBe(0);
    });

    it('are set by the market flows: the biggest lot on each link', () => {
        const ids = SettlementMarket.config().goodIds;
        const mk = (name, stock) => {
            const s = { name, type: 'town', population: 1500, economy: { gold: 5000 } };
            SettlementMarket.ensure(s);
            for (const id of ids) s.market.stock[id] = 0;
            Object.assign(s.market.stock, stock);
            return s;
        };
        const a = mk('Glut', { grain: 4000 });
        const b = mk('Want', {});
        const link = { a, b, dist: 2, sea: false, road: true, river: true, routes: 1, friction: 0.05, fr0: 0.05, base: 40, capacity: 40, factor: 1, perish: 0, loss: 0, toll: 0, tolls: null, val: 0, closed: false, _speed: 1, rate: 1, keep: 1, _tf: NaN, bigQ: 0, bigI: -1, bigAB: true };
        const bases = {};
        for (const id of ids) bases[id] = (SettlementMarket.good(id) && SettlementMarket.good(id).base) || 5;
        SettlementMarket.flows([link], bases, null);
        expect(link.val).toBeGreaterThan(0);
        expect(link.bigQ).toBeGreaterThan(0);
        expect(ids[link.bigI]).toBe('grain');
        expect(link.bigAB).toBe(true);
    });
});

describe('in a generated world', () => {
    it('sites its ferries quickly, and a fortnight of days puts barges on its rivers without a fault', async () => {
        const { newGame, endDay } = await import('./playtest/harness.js');
        DataLoader._gamedata.rivers = baseRivers;
        // (the New Game sheet's default size and terrain: world/ui/game/worldParams.js)
        const game = newGame(41, { width: 120, height: 80, terrainGen: 17 });
        const { world } = game;
        const t0 = performance.now();
        Ferries.reset(world);
        const sites = Ferries.sites(world);
        expect(performance.now() - t0).toBeLessThan(1500);
        for (const f of sites.list) {
            expect(Rivers.band(world, f.q, f.r)).toBe('great');
            expect(Rivers.crossingAt(world.getTile(f.q, f.r))).toBe(null);
        }
        expect(sites.list.length).toBeGreaterThan(0);
        expect(sites.straits.length).toBeGreaterThan(0);
        for (const s of sites.straits) expect(s.dist).toBeGreaterThanOrEqual(2);
        for (let d = 0; d < 14; d++) endDay(game);
        expect(Barges.list(world).length).toBeGreaterThan(0);
        for (const b of Barges.list(world)) {
            expect(b.qty).toBeGreaterThan(0);
            expect(SettlementMarket.tracks(b.good)).toBe(true);
            expect(b.path.length).toBeGreaterThanOrEqual(3);
        }
    }, 240000);
});

describe('the harbour on screen', () => {
    it('the Harbour panel shows the harbourmaster, the slip, careening and its buttons work', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const w = portWorld();
        const st = Ships.getShipType('sloop');
        const player = { q: 5, r: 5, gold: 1000, army: [], ships: [sloop({ condition: 60 }), sloop({ id: 'ship_9002', name: 'Tern', status: 'building', buildDaysLeft: Math.round(st.buildDays / 2) })] };
        const panels = [], notes = [];
        const game = { player, world: w, ui: { showCustomPanel: (t, h) => panels.push({ t: String(t), h: String(h) }), showNotification: (...a) => notes.push(a), hideCustomPanel() {}, updateStats() {} } };
        ActionMenu.showHarbour(game);
        const html = panels[panels.length - 1].h;
        expect(panels[panels.length - 1].t).toContain('Saltmere');
        expect(html).toContain(Ports.master(w, w.getTile(5, 5).settlement).name);
        expect(html).toContain('Tern on the slip');
        expect(html).toContain('Careen her on the beach');
        ActionMenu.harbourAct(game, 'careen', 'ship_9001', 'beach');
        expect(player.ships[0].status).toBe('careened');
        expect(panels[panels.length - 1].h).toContain('hauled down on the beach');
    }, 120000);

    it('the Fleet panel words every ship status, careened too, never the raw id', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        for (const id of ['docked', 'anchored', 'at_sea', 'moving', 'building', 'careened']) {
            const L = Ships.statusLabel(id);
            expect(L.text).not.toBe(id);
            expect(L.text).not.toContain('_');
        }
        expect(Ships.statusLabel('some_new_state').text).toBe('some new state');
        const w = portWorld();
        const player = { q: 5, r: 5, gold: 1000, army: [], ships: [sloop({ condition: 60 })] };
        const panels = [];
        const game = { player, world: w, ui: { showCustomPanel: (t, h) => panels.push({ t: String(t), h: String(h) }), showNotification() {}, hideCustomPanel() {}, updateStats() {} } };
        expect(Ports.careen(w, player, 'ship_9001', 'beach').ok).toBe(true);
        ActionMenu.showFleetMenu(game, w.getTile(5, 5));
        const html = panels[panels.length - 1].h;
        expect(html).toContain('careened for repair');
        expect(html).toContain('afloat in');
        expect(html).not.toMatch(/(⚓|🛠️) careened</u);
    }, 120000);

    it('the harbourmaster keeps his post as one of the street\'s people, and talks harbour business', async () => {
        const { InnerMap } = await import('../world/innerMap.js');
        const { InnerMapPort } = await import('../ui/innerMapPort.js');
        const { _harbourChoices } = await import('../ui/npcDialog/harbour.js');
        const { dialogState } = await import('../ui/npcDialog/shared.js');
        const w = portWorld();
        const s = w.getTile(5, 5).settlement;
        const keep = { npcs: InnerMap.npcs, make: InnerMap._makeNpc };
        InnerMap.npcs = [{ id: 0, type: 'villager', name: 'Ada', q: 1, r: 1, state: 'idle' }];
        InnerMap._makeNpc = (type, id) => ({ id, type, name: 'X', q: 0, r: 0, state: 'idle' });
        try {
            const m = Ports.master(w, s);
            const sc = { post: { q: 7, r: 8 } };
            const npc = InnerMapPort._keepMaster(w, s, sc, { q: 5, r: 5 }, m, true);
            expect(npc.harbourmaster).toBe(true);
            expect(npc.fullName).toBe(m.name);
            expect([npc.q, npc.r]).toEqual([7, 8]);
            expect(npc._doorPost).toEqual({ q: 7, r: 8, face: 2 });
            expect(npc.id).toBe(1);
            // the same man the next frame, not another; off duty at night
            expect(InnerMapPort._keepMaster(w, s, sc, { q: 5, r: 5 }, m, false)).toBe(npc);
            expect(InnerMap.npcs.length).toBe(2);
            expect(npc._doorPost).toBe(null);
            // talking to him: the Harbour panel, the ships in, paying what's in his book
            Ports.state(s).owed = 30;
            const panels = [];
            const player = { q: 5, r: 5, gold: 100, army: [], ships: [sloop()] };
            const game = { player, world: w, ui: { showCustomPanel: (t, h) => panels.push({ t: String(t), h: String(h) }), showNotification() {}, hideCustomPanel() {}, updateStats() {} } };
            Object.assign(dialogState, { _game: game, _npc: npc, _lines: [], _lineIndex: 0 });
            const ch = _harbourChoices();
            const labels = ch.map(c => c.label);
            expect(labels).toContain('The harbour\'s business.');
            expect(labels).toContain('What ships are in?');
            ch.find(c => c.label === 'What ships are in?').onPick();
            expect(dialogState._lines[dialogState._lines.length - 1].text).toMatch(/berth/);
            ch.find(c => /what I owe you/.test(c.label)).onPick();
            expect(player.gold).toBe(70);
            expect(Ports.state(s).owed).toBe(0);
            // (anyone else has nothing of the harbour to say)
            dialogState._npc = InnerMap.npcs[0];
            expect(_harbourChoices()).toEqual([]);
        } finally {
            InnerMap.npcs = keep.npcs;
            InnerMap._makeNpc = keep.make;
            Object.assign(dialogState, { _game: null, _npc: null, _lines: [], _lineIndex: 0 });
        }
    }, 120000);

    it('the street map finds the pier, its foot, the moorings and the slip from the cells', async () => {
        const { InnerMapPort } = await import('../ui/innerMapPort.js');
        // a 60 x 40 map: land to row 24, the sea below; a pier down from (30, 22) to (30, 33)
        const tiles = [];
        for (let r = 0; r < 40; r++) {
            const row = [];
            for (let q = 0; q < 60; q++) row.push(r >= 25 ? { _sea: true, _wet: true, subTerrain: { passable: false } } : { subTerrain: { passable: true } });
            tiles.push(row);
        }
        for (let r = 22; r <= 33; r++) for (let q = 29; q <= 31; q++) tiles[r][q]._pier = true;
        tiles[33][30]._pierTip = 'S';
        const sc = InnerMapPort.scene(tiles);
        expect(sc.tip).toEqual({ q: 30, r: 33 });
        expect(sc.base).toEqual({ q: 30, r: 22 });
        expect(sc.moorings.length).toBeGreaterThan(0);
        for (const m of sc.moorings) expect(tiles[m.r][m.q]._sea).toBe(true);
        expect(sc.slip).not.toBe(null);
        expect(tiles[sc.slip.r][sc.slip.q]._sea).toBeFalsy();
        expect(tiles[sc.slip.r + 1][sc.slip.q]._sea).toBe(true);
        expect(sc.beach).not.toBe(null);
        expect(Math.sign(sc.slip.q - 30)).not.toBe(Math.sign(sc.beach.q - 30));
        expect(sc.sea.r).toBeGreaterThan(33);
    });

    it('draws the street map\'s port life and the world map\'s water traffic without a fault (a canvas that takes any call)', async () => {
        const calls = { n: 0 };
        const ctx = new Proxy({}, {
            get(t, k) {
                if (k in t) return t[k];
                if (k === 'measureText') return () => ({ width: 40 });
                return () => { calls.n++; };
            },
            set(t, k, v) { t[k] = v; return true; },
        });
        const { InnerMapRenderer } = await import('../ui/innerMapRenderer.js');
        await import('../ui/innerMapLayers/portLife.js');
        const { InnerMap } = await import('../world/innerMap.js');
        const { InnerMapPort } = await import('../ui/innerMapPort.js');
        const keep = { active: InnerMap.active, getTile: InnerMap.getTile };
        InnerMap.active = true;
        InnerMap.getTile = () => ({ explored: true });
        const along = { x: 1, y: 0 }, out = { x: 0, y: 1 };
        InnerMapPort.view = {
            hour: 10,
            slip: [0, 1, 2, 3, 4].map(i => ({ x: 10, y: 10, along, out, index: i, within: 0.5, progress: i / 5, working: true, typeId: i % 2 ? 'cog' : 'sloop', waiting: i === 2 ? 'wood' : null })),
            careened: [{ x: 20, y: 10, along, out, dock: true, working: true }, { x: 25, y: 10, along, out, dock: false, working: true }],
            boats: [{ x: 5, y: 30, dir: out, heading: 1, sail: true, fish: false, i: 0 }, { x: 8, y: 34, dir: out, heading: 0, sail: false, fish: true, i: 1 }],
            dockers: [{ x: 9, y: 9, carry: true, i: 0, walk: 1 }, { x: 9, y: 9, carry: false, i: 1, walk: 2 }],
            crates: 7, baskets: 3, master: { x: 7, y: 8, name: 'Agnes Quay' }, quay: { x: 7, y: 9, along },
            punts: [{ x: 3, y: 3, fx: 1, fy: 0, i: 0 }], barges: [{ x: 4, y: 4, fx: 0, fy: 1, good: 'grain', qty: 5, to: 'Downey' }],
            ferry: { a: { x: 1, y: 1 }, b: { x: 1, y: 6 }, pos: { x: 1, y: 3 }, fx: 1, fy: 0, ferryman: 'Old Tam', fare: 3, next: 12 },
        };
        const camera = { zoom: 1.5, worldToScreenFast: (x, y) => ({ x, y }) };
        try {
            InnerMapRenderer._renderPortLife(ctx, camera);
        } finally {
            InnerMap.active = keep.active;
            InnerMap.getTile = keep.getTile;
            InnerMapPort.view = null;
        }
        expect(calls.n).toBeGreaterThan(100);
        // the world map
        const { Renderer } = await import('../ui/renderer/index.js');
        const w = makeWorld({ towns: [[13, 4, 'Ferrybridge'], [3, 6, 'Upton'], [17, 5, 'Mouth']] });
        w.getSettlementViews = () => [w.tiles[4][13].settlement, w.tiles[6][3].settlement, w.tiles[5][17].settlement].map((s, i) => Object.assign(s, [{ q: 13, r: 4 }, { q: 3, r: 6 }, { q: 17, r: 5 }][i]));
        w.getSettlementViews();
        const ids = SettlementMarket.config().goodIds;
        Barges.afterFlows(w, [{ a: w.tiles[6][3].settlement, b: w.tiles[5][17].settlement, river: true, sea: false, bigQ: 4, bigI: ids.indexOf('grain'), bigAB: true }], w.day);
        const fake = {
            world: w, time: 3, mapMode: 'normal', hexSize: 32, canvas: { width: 1000, height: 800 },
            camera: { zoom: 1.4, worldToScreen: (x, y) => ({ x, y }) },
            getHexPixelPos: (q, r) => ({ x: q * 50 + (r % 2 ? 25 : 0), y: r * 40 }),
        };
        const before = calls.n;
        Renderer.prototype.renderWaterTraffic.call(Object.assign(Object.create(Renderer.prototype), fake), ctx);
        expect(calls.n).toBeGreaterThan(before);
    }, 120000);
});

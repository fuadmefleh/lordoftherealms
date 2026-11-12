// Travel by days per hex (data/travel.json, Infrastructure.getPlayerHexDays,
// Player._hexMoveCost / stepAlongPath / travelEstimate / getReachableHexes):
// open land ¾ of a day, a dirt road ½, a paved road ¼, a forest a whole day,
// a mountain three. A hex longer than what is left of the day is crossed over
// several days (player.crossing), camping on the way.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Player } from '../player/player.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Technology } from '../systems/technology.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { TimeSkip } from '../ui/timeSkip.js';
import { StandingOrders } from '../player/standingOrders.js';
import { Devotion } from '../systems/devotion.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const T = (id) => ({ id, name: id, passable: true, moveCost: 2 });
const PEAK = { id: 'snow_peak', name: 'Snow Peak', passable: false, moveCost: Infinity };

/** A one-row world: `row` is a list of terrain ids (or tile specs); walled by peaks so the path runs along it. */
function strip(row) {
    const tiles = row.map((spec, q) => {
        const s = typeof spec === 'string' ? { terrain: spec } : spec;
        return { q, r: 0, terrain: T(s.terrain), hasRiver: false, hasRoad: false, infrastructure: null, ...s, ...{ terrain: T(s.terrain) } };
    });
    tiles.push({ q: tiles.length, r: 0, terrain: PEAK }, { q: tiles.length + 1, r: 0, terrain: PEAK });
    const W = tiles.length;
    return { width: W, height: 1, day: 1, tiles: [tiles], getTile: (q, r) => (r === 0 ? tiles[((q % W) + W) % W] : null) };
}

/** A walker on (0, 0) with a day of pace 6, fresh this morning. */
function walker(world, pace = 6) {
    const p = new Player();
    p.q = 0; p.r = 0;
    p._dayPace = pace; p._dayMovement = pace; p.movementRemaining = pace;
    p._travelSpeed = 1;
    p.actionPoints = 10; p.maxActionPoints = 10;
    p.updateVisibility = () => {};
    p.revealArea = () => {};
    p.discoverNearbyHolySites = () => {};
    return p;
}

/** Walk until the day's strength gives out. */
function walkDay(p, world) {
    if (!p.isMoving && p.queuedPath) p.resumeQueuedPath();
    let guard = 0;
    while (p.isMoving && guard++ < 100) p.stepAlongPath(world, 1);
}

/** The next morning: a fresh day's strength. */
function nextDay(p, world) {
    world.day++;
    p.movementRemaining = p._dayMovement;
    p.actionPoints = p.maxActionPoints;
}

const dirt = { id: 'dirt_road', moveCostOverride: null, moveCostReduction: 0.5, underConstruction: false };
const stone = { id: 'stone_road', moveCostOverride: 1, moveCostReduction: null, underConstruction: false };

describe('days per hex', () => {
    it('reads the terrain and road figures from data/travel.json', () => {
        const tile = (terrain, extra = {}) => ({ terrain: T(terrain), hasRiver: false, hasRoad: false, infrastructure: null, ...extra });
        const D = (t) => Infrastructure.getPlayerHexDays(t, { _travelSpeed: 1 });
        expect(D(tile('grassland'))).toBeCloseTo(0.75);
        expect(D(tile('plains'))).toBeCloseTo(0.75);
        expect(D(tile('woodland'))).toBeCloseTo(1);
        expect(D(tile('boreal_forest'))).toBeCloseTo(1);
        expect(D(tile('desert'))).toBeCloseTo(1);
        expect(D(tile('hills'))).toBeCloseTo(1.5);
        expect(D(tile('swamp'))).toBeCloseTo(2);
        expect(D(tile('mountain'))).toBeCloseTo(3);
        // Roads: a dirt road ½, a paved road ¼ — whatever the ground under them
        expect(D(tile('grassland', { infrastructure: dirt }))).toBeCloseTo(0.5);
        expect(D(tile('woodland', { infrastructure: stone }))).toBeCloseTo(0.25);
        // The world's roads by tier; a little slower over a mountain pass
        expect(D(tile('grassland', { hasRoad: true }))).toBeCloseTo(0.5);
        expect(D(tile('grassland', { hasRoad: true, roadTier: 'highway', roadMove: 0.33 }))).toBeCloseTo(0.25);
        expect(D(tile('mountain', { hasRoad: true }))).toBeCloseTo(0.75);
        // A ruined road is no road
        expect(D(tile('woodland', { hasRoad: true, roadMove: 1 }))).toBeCloseTo(1);
        // A ford with no bridge adds a quarter day
        expect(D(tile('grassland', { hasRiver: true }))).toBeCloseTo(1);
        expect(D({ terrain: PEAK })).toBe(Infinity);
        expect(Infrastructure.formatDays(0.75)).toBe('¾ day');
        expect(Infrastructure.formatDays(1)).toBe('1 day');
        expect(Infrastructure.formatDays(1.5)).toBe('1½ days');
        expect(Infrastructure.formatDays(3)).toBe('3 days');
    });
});

describe('walking by the day', () => {
    it('a forest hex takes a whole day', () => {
        const world = strip(['grassland', 'woodland', 'woodland', 'woodland']);
        const p = walker(world);
        expect(p.moveTo(3, 0, world)).toBe(true);
        walkDay(p, world);
        expect(p.q).toBe(1);
        expect(p.movementRemaining).toBe(0);
        nextDay(p, world);
        walkDay(p, world);
        expect(p.q).toBe(2);
        nextDay(p, world);
        walkDay(p, world);
        expect(p.q).toBe(3);
        expect(p.queuedPath).toBe(null);
    });

    it('a mountain hex takes three days, camping on the way', () => {
        const world = strip(['grassland', 'mountain', 'grassland']);
        const p = walker(world);
        expect(p.moveTo(2, 0, world)).toBe(true);
        // Day 1: the whole day goes into the mountain; still at its foot
        walkDay(p, world);
        expect(p.q).toBe(0);
        expect(p.crossing).toMatchObject({ q: 1, r: 0, day: 1, days: 3, longHex: true, name: 'the mountains' });
        expect(p.crossingText(world)).toBe('crossing the mountains, day 1 of 3');
        expect(p.crossingProgress()).toBeCloseTo(1 / 3);
        // The next morning reads as day 2
        nextDay(p, world);
        expect(p.crossingText(world)).toBe('crossing the mountains, day 2 of 3');
        walkDay(p, world);
        expect(p.q).toBe(0);
        expect(p.crossing.day).toBe(2);
        // Day 3: over the top
        nextDay(p, world);
        walkDay(p, world);
        expect(p.q).toBe(1);
        expect(p.crossing).toBe(null);
        expect(p.queuedPath).toBeTruthy(); // the plains beyond wait for tomorrow
        nextDay(p, world);
        walkDay(p, world);
        expect(p.q).toBe(2);
    });

    it('roads: about six hexes a day on a paved road, four on a dirt road, open land ¾ of a day each', () => {
        const row = (inf) => Array.from({ length: 12 }, () => ({ terrain: 'grassland', infrastructure: inf }));
        const paved = strip(row(stone));
        const p1 = walker(paved);
        p1.moveTo(11, 0, paved);
        walkDay(p1, paved);
        expect(p1.q).toBe(4); // ¼ day a hex
        const dirtWorld = strip(row(dirt));
        const p2 = walker(dirtWorld);
        p2.moveTo(11, 0, dirtWorld);
        walkDay(p2, dirtWorld);
        expect(p2.q).toBe(2); // ½ day a hex
        // Open land: one hex today, a quarter of the next already walked
        const open = strip(row(null));
        const p3 = walker(open);
        p3.moveTo(11, 0, open);
        walkDay(p3, open);
        expect(p3.q).toBe(1);
        expect(p3.crossing).toMatchObject({ q: 2, longHex: false });
        // 4 hexes in 3 days
        for (let d = 0; d < 2; d++) { nextDay(p3, open); walkDay(p3, open); }
        expect(p3.q).toBe(4);
    });

    it('bonuses only shave a little off, and never take a forest under ¾ day or a mountain under 2½ off the road', () => {
        const p = new Player();
        const spy = vi.spyOn(Technology, 'getMovementBonus').mockReturnValue(100);
        try {
            p.endDay(null);
        } finally {
            spy.mockRestore();
        }
        const cap = DataLoader._gamedata.travel.speed.cap;
        expect(p._travelSpeed).toBeCloseTo(1 + cap);
        const tile = (terrain, extra = {}) => ({ terrain: T(terrain), hasRiver: false, hasRoad: false, infrastructure: null, ...extra });
        expect(Infrastructure.getPlayerHexDays(tile('grassland'), p)).toBeCloseTo(0.75 / (1 + cap));
        // However fast (even past the cap), the floors hold off the road…
        const fast = { _travelSpeed: 10 };
        expect(Infrastructure.getPlayerHexDays(tile('woodland'), fast)).toBeCloseTo(0.75);
        expect(Infrastructure.getPlayerHexDays(tile('mountain'), fast)).toBeCloseTo(2.5);
        expect(Infrastructure.getPlayerHexDays(tile('mountain'), p)).toBeGreaterThanOrEqual(2.5);
        // …but a road through the mountains is the road's figure
        expect(Infrastructure.getPlayerHexDays(tile('mountain', { infrastructure: stone }), fast)).toBeLessThan(0.1);
    });
});

describe('a crossing survives save and load, and time let pass', () => {
    it('saves the crossing mid-way and finishes it after loading', () => {
        const world = strip(['grassland', 'mountain', 'grassland']);
        const p = walker(world);
        p.moveTo(1, 0, world);
        walkDay(p, world);
        nextDay(p, world);
        walkDay(p, world);
        expect(p.crossing.done).toBeCloseTo(12);
        const data = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(data, back);
        Object.assign(back, { updateVisibility: () => {}, revealArea: () => {}, discoverNearbyHolySites: () => {} });
        expect(back.crossing).toMatchObject({ q: 1, r: 0, day: 2, days: 3, done: 12, need: 18 });
        expect(back._dayPace).toBe(6);
        expect(back.queuedPath).toBeTruthy();
        nextDay(back, world);
        walkDay(back, world);
        expect(back.q).toBe(1);
        expect(back.crossing).toBe(null);
    });

    it('advanceCrossing carries a crossing through days let pass, without the walk', () => {
        const world = strip(['grassland', 'mountain', 'grassland']);
        const p = walker(world);
        p.moveTo(2, 0, world);
        walkDay(p, world);
        nextDay(p, world);
        expect(p.advanceCrossing(world)).toMatchObject({ arrived: false, day: 2, days: 3, name: 'the mountains' });
        expect(p.isMoving).toBe(false);
        nextDay(p, world);
        expect(p.advanceCrossing(world)).toMatchObject({ arrived: true, day: 3 });
        expect(p.q).toBe(1);
        expect(p.queuedPath).toBeTruthy();
        expect(p.advanceCrossing(world)).toBe(null);
    });

    it('days may be let pass mid-crossing (⏩), no standing order runs, and arriving ends the wait', () => {
        const world = strip(['grassland', 'mountain', 'grassland']);
        const p = walker(world);
        p.moveTo(2, 0, world);
        walkDay(p, world);
        const game = { world, player: p, isProcessingTurn: false };
        expect(TimeSkip.canSkip(game)).toMatchObject({ ok: true });
        expect(StandingOrders.blocked(p, world)).toBe('You are crossing the mountains.');
        const before = TimeSkip.snapshot(game);
        expect(before.crossing).toBe(true);
        expect(TimeSkip.check(game, before)).toBe(null);
        nextDay(p, world); p.advanceCrossing(world);
        nextDay(p, world); p.advanceCrossing(world);
        expect(TimeSkip.check(game, before)).toMatchObject({ reason: 'You have made the crossing.' });
        // An ordinary night's camp on the road still refuses the wait
        expect(TimeSkip.canSkip(game).ok).toBe(false);
    });

    it('turning back (Escape) gives the crossing up', () => {
        const world = strip(['grassland', 'mountain', 'grassland']);
        const p = walker(world);
        p.moveTo(1, 0, world);
        walkDay(p, world);
        expect(p.crossing).toBeTruthy();
        p.cancelTravel();
        expect(p.crossing).toBe(null);
        expect(p.crossingStatus(world)).toBe(null);
    });
});

describe('planning: the route preview and the reachable hexes count the days', () => {
    it('travelEstimate marks each night, part-way into a mountain, and names the crossing', () => {
        const world = strip(['grassland', 'mountain', 'grassland']);
        const p = walker(world);
        const est = p.travelEstimate(world, 2, 0);
        // Mountain: 3 days (two nights on its slopes), then ¾ day of plains on day 4
        expect(est.days).toBe(3);
        expect(est.stops).toHaveLength(3);
        expect(est.stops[0]).toMatchObject({ q: 0, r: 0, toQ: 1, toR: 0 });
        expect(est.stops[0].t).toBeCloseTo(1 / 3);
        expect(est.stops[1].t).toBeCloseTo(2 / 3);
        expect(est.crossings).toEqual([{ q: 1, r: 0, days: 3, name: 'the mountains' }]);
        expect(est.travelDays).toBeCloseTo(3.75);
        // A forest: a day exactly
        const woods = strip(['grassland', 'woodland']);
        const w = walker(woods);
        expect(w.travelEstimate(woods, 1, 0).days).toBe(0);
        w.movementRemaining = 3;
        expect(w.travelEstimate(woods, 1, 0).days).toBe(1);
    });

    it('getReachableHexes: today\'s hexes, and the later days counted on .days', () => {
        const world = strip(['grassland', 'mountain', 'woodland']);
        const p = walker(world);
        const reach = p.getReachableHexes(world);
        expect(reach.has('1,0')).toBe(false);
        expect(reach.days.get('1,0')).toBe(2); // the mountain: arrive two days after today (the 3rd day)
        expect(reach.days.has('2,0')).toBe(false); // beyond the overlay's reach
        expect(p.getReachableHexes(world, { days: 4 }).days.get('2,0')).toBe(3);
        // A forest next door is today's, all of the day
        const woods = strip(['grassland', 'woodland']);
        expect(walker(woods).getReachableHexes(woods).get('1,0')).toBeCloseTo(6);
    });
});

describe('the systems that reckon a journey in days', () => {
    it('travelDaysFrom / routeDays walk the quickest way in days', () => {
        const world = strip(['grassland', 'mountain', 'grassland', { terrain: 'grassland', infrastructure: stone }]);
        expect(Infrastructure.routeDays(world, { q: 0, r: 0 }, { q: 1, r: 0 })).toBeCloseTo(3);
        expect(Infrastructure.routeDays(world, { q: 0, r: 0 }, { q: 3, r: 0 })).toBeCloseTo(4);
        const m = Infrastructure.travelDaysFrom(world, 0, 0, 3.5);
        expect(m.get('1,0')).toBeCloseTo(3);
        expect(m.has('2,0')).toBe(false);
        expect(Infrastructure.routeDays(world, { q: 0, r: 0 }, { q: 4, r: 0 })).toBe(null); // a peak
    });

    it('a release from a cell gives one scaled day\'s walk, not the raw stamina', () => {
        const p = new Player();
        p.movementRemaining = 0;
        p._dayPace = 1;
        const full = p.restoreDayMovement();
        expect(full).toBe(Math.round(p.maxStamina * DataLoader._gamedata.travel.dayScale));
        expect(p.movementRemaining).toBe(full);
        expect(p._dayPace).toBe(full);
    });

    it('a pilgrimage allows baseDays + perWalkDay x the days on foot (a mountain on the way counts three)', () => {
        const world = strip(['grassland', 'mountain', 'grassland']);
        world.tiles[0][2].holySite = { name: 'Shrine', faithId: null };
        world.kingdoms = [];
        world.getKingdom = () => null;
        const p = walker(world);
        const P = DataLoader._gamedata.devotion.vows.pilgrimage;
        const t = Devotion.pilgrimageTargets(p, world).find(x => x.q === 2);
        expect(t.walkDays).toBeCloseTo(3.8, 1);
        expect(t.days).toBe(Math.round(P.baseDays + 3.75 * P.perWalkDay));
    });
});

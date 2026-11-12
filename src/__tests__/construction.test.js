/**
 * Construction takes real time — systems/construction.js, player/playerWorks.js.
 * Roads are days-to-weeks a hex and slower over hard ground; work goes at the
 * pace of the season and the weather; hired crews speed it and are paid in
 * real coin to the nearest town; the work goes on with the builder away.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Infrastructure } from '../systems/infrastructure.js';
import { Construction } from '../systems/construction.js';
import { PlayerWorks } from '../player/playerWorks.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Holdings } from '../systems/holdings.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const T = (id) => ({ id, passable: true, moveCost: 2 });

function makeWorld(day = 10, terrainAt = () => 'plains') {
    const W = 12, H = 10;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: T(terrainAt(q, r)), regionId: 1, kingdom: 'k1', infrastructure: null });
        tiles.push(row);
    }
    const kingdom = { id: 'k1', name: 'Testland', isAlive: true, treasury: 5000, wars: [], finance: { debtRatio: 0, missed: 0 } };
    const town = { name: 'Aston', q: 2, r: 5, type: 'town', population: 2000, kingdom: 'k1', economy: { gold: 500, tradeIncome: 0 } };
    tiles[5][2].settlement = town;
    const world = {
        width: W, height: H, day, tiles, units: [], kingdoms: [kingdom], events: [],
        generationParams: { seed: 'construction' },
        getTile(q, r) { return r < 0 || r >= H ? null : tiles[r][((q % W) + W) % W]; },
        getSettlementViews() { return [town]; },
        getAllSettlements() { return [town]; },
        getKingdom(id) { return id === 'k1' ? kingdom : null; },
    };
    return { world, town };
}

function startRoad(world, player, q, r) {
    const tile = world.getTile(q, r);
    const res = Infrastructure.build(player, 'DIRT_ROAD', tile, world);
    expect(res.success).toBe(true);
    player.infrastructureUnderConstruction = player.infrastructureUnderConstruction || [];
    player.infrastructureUnderConstruction.push({ q, r });
    return { tile, res };
}

describe('roads take real time, by the ground', () => {
    it('a dirt road hex is more than a week on open ground, and longer over hills, forest and marsh', () => {
        const ground = { 4: 'plains', 5: 'hills', 6: 'seasonal_forest', 7: 'swamp', 8: 'mountain' };
        const { world } = makeWorld(10, (q) => ground[q] || 'plains');
        const days = {};
        for (const [q, id] of Object.entries(ground)) {
            const check = Infrastructure.canBuild({ gold: 1e6 }, 'DIRT_ROAD', world.getTile(Number(q), 2), world);
            expect(check.can).toBe(true);
            days[id] = check.buildDays;
        }
        expect(days.plains).toBeGreaterThanOrEqual(7);
        expect(days.hills).toBeGreaterThan(days.plains);
        expect(days.seasonal_forest).toBeGreaterThan(days.plains);
        expect(days.swamp).toBeGreaterThan(days.hills);
        expect(days.mountain).toBeGreaterThan(days.swamp);
        // a bridge is a season's work at least
        const bridge = Infrastructure.TYPES.BRIDGE;
        expect(bridge.buildTime).toBeGreaterThanOrEqual(60);
    });

    it('the work goes on day by day with the builder away, then the road opens', () => {
        const { world } = makeWorld(10);
        const player = { gold: 5000, q: 0, r: 0 };
        const { tile, res } = startRoad(world, player, 5, 5);
        expect(tile.infrastructure.underConstruction).toBe(true);
        let days = 0;
        while (tile.infrastructure.underConstruction && days < 400) {
            PlayerWorks.processDay(player, world);
            world.day++;
            days++;
        }
        expect(tile.infrastructure.underConstruction).toBe(false);
        expect(tile.hasRoad).toBe(true);
        expect(days).toBeGreaterThanOrEqual(res.buildDays * 0.8);
        expect(player.infrastructureUnderConstruction).toHaveLength(0);
    });
});

describe('the pace of the work', () => {
    it('winter halves it; crews quicken it', () => {
        const { world } = makeWorld(10); // Spring
        const spring = Construction.pace(world, 5, 5).pace;
        world.day = 100; // Winter
        const winter = Construction.pace(world, 5, 5).pace;
        expect(winter).toBeLessThan(spring);
        expect(winter).toBeCloseTo(spring * 0.5, 1);
        const crewed = Construction.pace(world, 5, 5, { crews: 2 }).pace;
        expect(crewed).toBeGreaterThan(winter);
    });

    it('a build started in late autumn is quoted longer than its work-days', () => {
        const { world } = makeWorld(85);
        const rec = { underConstruction: true, constructionDaysTotal: 30, constructionDaysLeft: 30 };
        const eta = Construction.eta(rec, world, 5, 5);
        expect(eta).toBeGreaterThan(30);
        world.day = 31; // summer
        expect(Construction.eta(rec, world, 5, 5)).toBeLessThan(eta);
    });

    it('older records (days left only) carry on from where they were', () => {
        const { world } = makeWorld(10);
        const rec = { underConstruction: true, constructionDaysTotal: 10, constructionDaysLeft: 4 };
        expect(Construction.progress(rec)).toBeCloseTo(0.6, 5);
        Construction.advance(rec, world, 5, 5);
        expect(rec.workDone).toBeGreaterThan(6);
        expect(rec.constructionDaysLeft).toBeLessThanOrEqual(3);
    });
});

describe('crews are real labour', () => {
    it('their wages leave the purse and reach the town; unpaid crews walk off', () => {
        const { world, town } = makeWorld(10);
        const player = { gold: 5000, q: 0, r: 0 };
        const { tile } = startRoad(world, player, 5, 5);
        const rec = tile.infrastructure;
        expect(Construction.hireCrew(player, rec, world, 5, 5).success).toBe(true);
        expect(Construction.hireCrew(player, rec, world, 5, 5).success).toBe(true);
        const wage = Construction.crewWage(world, 5, 5);
        const gold0 = player.gold, purse0 = town.economy.gold;
        const out = PlayerWorks.processDay(player, world);
        expect(out.wages).toBeCloseTo(2 * wage, 5);
        expect(gold0 - player.gold).toBeCloseTo(2 * wage, 5);
        expect(town.economy.gold - purse0).toBeCloseTo(2 * wage, 5);
        // crews worked: more than a day's work done
        expect(rec.workDone).toBeGreaterThan(1.5);
        // the purse runs dry: they leave
        player.gold = wage * 0.5;
        const out2 = PlayerWorks.processDay(player, world);
        expect(out2.crewsLeft[0].n).toBe(2);
        expect(rec.crews).toBe(0);
        // never more than the cap
        player.gold = 1e6;
        const max = Construction.config().crews.max;
        for (let i = 0; i < max; i++) Construction.hireCrew(player, rec, world, 5, 5);
        expect(Construction.hireCrew(player, rec, world, 5, 5).success).toBe(false);
    });
});

describe('durations feel medieval', () => {
    it('properties take weeks to months, mines and inns longer than huts', () => {
        const P = PlayerEconomy.PROPERTY_TYPES;
        expect(P.FARM.constructionDays).toBeGreaterThanOrEqual(20);
        expect(P.MINE.constructionDays).toBeGreaterThanOrEqual(60);
        expect(P.HOTEL.constructionDays).toBeGreaterThanOrEqual(90);
        expect(P.FORAGER_HUT.constructionDays).toBeLessThan(P.FARM.constructionDays);
    });

    it('a holding\'s stone walls and temple are years, not days', () => {
        const defs = Holdings.projects();
        expect(defs.stone_walls.days).toBeGreaterThanOrEqual(240);
        expect(defs.temple.days).toBeGreaterThanOrEqual(120);
        expect(defs.palisade.days).toBeLessThan(defs.stone_walls.days);
    });
});

// Seasons that matter: the agricultural year shapes production, prices,
// settlement mood, war timing and the work on offer — without changing
// yearly totals and without drawing randomness.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Seasons } from '../world/seasons.js';
import { Economy } from '../world/economy.js';
import { WorldEvents } from '../world/worldEvents.js';
import { Technology } from '../systems/technology.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Trading } from '../player/playerEconomy/trading.js';
import { SeasonalWork } from '../player/seasonalWork.js';
import { addWildernessActions } from '../player/actions/wildernessActions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const YEAR = 120;
const SPRING = 10, SUMMER = 40, AUTUMN = 75, WINTER = 100, LATE_WINTER = 115;

function player(extra = {}) {
    const p = { gold: 10000, health: 50, maxHealth: 100, q: 5, r: 5, properties: [], inventory: {}, skills: { commerce: 0, combat: 0 }, ...extra };
    Technology.initPlayer(p);
    return p;
}

// One-tile world holding the given player properties at (5,5)
function worldWith(props, day, tileExtra = {}) {
    const tile = { q: 5, r: 5, terrain: { id: 'plains', passable: true }, playerProperties: props, playerProperty: props[0] || null, ...tileExtra };
    return { day, activeEvents: [], tile, getTile: (q, r) => (q === 5 && r === 5 ? tile : null) };
}

describe('the calendar', () => {
    it('matches World.advanceDay: 30-day seasons in a 120-day year', () => {
        expect(Seasons.seasonOf(1)).toBe('Spring');
        expect(Seasons.seasonOf(30)).toBe('Spring');
        expect(Seasons.seasonOf(31)).toBe('Summer');
        expect(Seasons.seasonOf(61)).toBe('Autumn');
        expect(Seasons.seasonOf(91)).toBe('Winter');
        expect(Seasons.seasonOf(121)).toBe('Spring');
        expect(Seasons.dayInSeason(95)).toBe(5);
    });

    it('draws no randomness', () => {
        Utils.setSeed(7);
        const before = Utils.random();
        Utils.setSeed(7);
        for (let d = 1; d <= YEAR; d++) {
            Seasons.productionMultiplier('crops', d);
            Seasons.priceModifier('grain', d);
            Seasons.outlook(d);
            Seasons.campaignFactor(d);
        }
        expect(Utils.random()).toBe(before);
    });

    it('is neutral for a world outside the calendar (no day)', () => {
        expect(Seasons.today({})).toBe(null);
        expect(Seasons.productionMultiplier('crops', null)).toBe(1);
        expect(Seasons.priceModifier('grain', null)).toBe(0);
        expect(Seasons.isLean(null)).toBe(false);
    });
});

describe('harvest cycle', () => {
    it('every curve averages exactly 1 over the year, so yearly totals hold', () => {
        for (const kind of Object.keys(Seasons.CONFIG.curves)) {
            let sum = 0;
            for (let d = 1; d <= YEAR; d++) sum += Seasons.productionMultiplier(kind, d);
            expect(sum / YEAR).toBeCloseTo(1, 10);
        }
    });

    it('crops: low at planting, a big autumn harvest, almost nothing in winter', () => {
        const m = (d) => Seasons.productionMultiplier('crops', d);
        expect(m(AUTUMN)).toBeGreaterThan(2);
        expect(m(SPRING)).toBeLessThan(0.5);
        expect(m(WINTER)).toBeLessThan(0.5);
        expect(m(SUMMER)).toBeCloseTo(1);
        // fishing and hunting follow their own curves
        expect(Seasons.productionMultiplier('fishing', SUMMER)).toBeGreaterThan(Seasons.productionMultiplier('fishing', WINTER));
        expect(Seasons.productionMultiplier('hunting', AUTUMN)).toBeGreaterThan(Seasons.productionMultiplier('hunting', SPRING));
    });

    it("a player's farm yields the same grain over a year, just at different times", () => {
        const farm = { type: 'farm', produces: 'grain', productionRate: 10, upkeep: 0, level: 1, storage: 0, daysOwned: 0 };
        const p = player({ properties: [{ q: 5, r: 5, type: 'farm' }] });
        const bySeason = { Spring: 0, Summer: 0, Autumn: 0, Winter: 0 };
        let total = 0;
        for (let d = 1; d <= YEAR; d++) {
            const got = PlayerEconomy.produceGoods(p, worldWith([farm], d)).grain || 0;
            farm.storage = 0; // collected every day: storage caps are tested elsewhere
            total += got;
            bySeason[Seasons.seasonOf(d)] += got;
        }
        expect(Math.abs(total - YEAR * 10)).toBeLessThanOrEqual(1);
        expect(bySeason.Autumn).toBeGreaterThan(bySeason.Summer * 2);
        expect(bySeason.Winter).toBeLessThan(bySeason.Summer / 2);
    });

    it('non-seasonal properties are untouched (a quarry digs the same stone all year)', () => {
        const quarry = { type: 'quarry', produces: 'stone', productionRate: 8, upkeep: 0, level: 1, storage: 0, daysOwned: 0 };
        const p = player({ properties: [{ q: 5, r: 5, type: 'quarry' }] });
        expect(PlayerEconomy.produceGoods(p, worldWith([quarry], WINTER)).stone).toBe(8);
        quarry.storage = 0;
        expect(PlayerEconomy.produceGoods(p, worldWith([quarry], AUTUMN)).stone).toBe(8);
    });

    it('a settlement brings the same food to market over a year, mostly at harvest', () => {
        const tile = { q: 0, r: 0 };
        const world = { day: 1 };
        const prod = { gold: 0, food: 100, goods: 0, breakdown: { items: {} } };
        const orig = Economy.calculateProduction;
        Economy.calculateProduction = (s) => { s.economy.production = { ...prod }; return s.economy.production; };
        try {
            const bySeason = { Spring: 0, Summer: 0, Autumn: 0, Winter: 0 };
            let total = 0;
            for (let d = 1; d <= YEAR; d++) {
                world.day = d;
                const s = { population: 0, type: 'village' };
                Economy.produceDaily(s, tile, world);
                total += s.economy.food;
                bySeason[Seasons.seasonOf(d)] += s.economy.food;
            }
            expect(total).toBe(YEAR * 100);
            expect(bySeason.Autumn).toBeGreaterThan(bySeason.Spring * 2);
        } finally {
            Economy.calculateProduction = orig;
        }
    });
});

describe('food prices follow scarcity', () => {
    it('food is cheap after the harvest and dear in late winter and early spring', () => {
        const mod = (d) => Seasons.priceModifier('grain', d);
        expect(mod(88)).toBeLessThan(-0.2);       // end of autumn: the glut
        expect(mod(LATE_WINTER)).toBeGreaterThan(0.15);
        expect(mod(1)).toBeGreaterThan(0.2);       // early spring: dearest
        expect(mod(LATE_WINTER)).toBeGreaterThan(mod(AUTUMN));
        // the curve is continuous across the new year
        expect(Math.abs(mod(120) - mod(121))).toBeLessThan(0.05);
        // non-food goods are not seasonal
        expect(Seasons.priceModifier('iron', LATE_WINTER)).toBe(0);
    });

    it('trend arrows say where the price is heading', () => {
        expect(Seasons.priceTrend('grain', AUTUMN)).toBe('falling');
        expect(Seasons.priceTrend('grain', LATE_WINTER - 10)).toBe('rising');
        expect(Seasons.priceTrend('iron', AUTUMN)).toBe('stable');
        expect(Seasons.trendArrow('rising')).toBe('▲');
        expect(Seasons.trendArrow('falling')).toBe('▼');
    });

    it('settlement markets buy low after harvest and sell high in the lean months', () => {
        const grain = PlayerEconomy.GOODS.GRAIN;
        const settlement = { type: 'capital', population: 20000 };
        const tile = { q: 0, r: 0, terrain: { id: 'plains' }, resource: null };
        const buyAutumn = Trading.calculatePrice({ ...grain, basePrice: 100 }, settlement, tile, { day: 88 });
        const sellLate = Trading.getSellPrice({ ...grain, basePrice: 100 }, { day: LATE_WINTER });
        expect(buyAutumn).toBeLessThan(60);
        expect(sellLate).toBeGreaterThan(buyAutumn);
        // a store of grain bought at harvest sells at a profit in late winter
        const p = player({ inventory: { grain: 10 } });
        const res = Trading.sellGoods(p, 'grain', 10, null, { day: LATE_WINTER });
        expect(res.earned).toBe(Trading.getSellPrice(grain, { day: LATE_WINTER }) * 10);
        expect(res.earned).toBeGreaterThan(Math.floor(grain.basePrice * 0.7) * 10);
    });

    it('regional market prices carry the seasonal swing too', () => {
        MarketDynamics.initialize();
        const s = { q: 0, r: 0, name: 'Ash', population: 500 };
        const world = { width: 10, day: 88, activeEvents: [], getAllSettlements: () => [s], getTile: () => ({ q: 0, r: 0 }) };
        const autumn = MarketDynamics.getPrice('bread', 0, 0, world);
        world.day = LATE_WINTER;
        expect(MarketDynamics.getPrice('bread', 0, 0, world)).toBeGreaterThan(autumn);
    });

    it('food sold to a settlement fills its granary', () => {
        const p = player({ inventory: { grain: 30 } });
        const settlement = { type: 'town', population: 1000, economy: { food: 0 } };
        Trading.sellGoods(p, 'grain', 30, settlement, { day: LATE_WINTER });
        expect(settlement.economy.food).toBe(30);
    });
});

describe('the lean season', () => {
    const town = (food) => ({ name: 'Ashford', type: 'town', population: 2000, happiness: 60, economy: { food } });

    it('is late winter and early spring', () => {
        expect(Seasons.isLean(LATE_WINTER)).toBe(true);
        expect(Seasons.isLean(5)).toBe(true);
        expect(Seasons.isLean(AUTUMN)).toBe(false);
        expect(Seasons.isLean(SUMMER)).toBe(false);
    });

    it('settlements with empty granaries lose happiness; well-stocked ones do not', () => {
        const hungry = town(0);
        const stocked = town(2000); // 2000 pop × 0.1 × 8% = 16/day → 125 days in store
        for (let d = 106; d <= 120; d++) {
            Economy.applyLeanSeason(hungry, d);
            Economy.applyLeanSeason(stocked, d);
        }
        const max = Seasons.CONFIG.lean.maxPenalty;
        expect(hungry.happiness).toBeCloseTo(60 - max);
        expect(stocked.happiness).toBe(60);
    });

    it('the mood comes back once the season turns, so nothing is lost over the year', () => {
        const s = town(0);
        for (let d = 106; d <= 140; d++) Economy.applyLeanSeason(s, d);
        expect(s.happiness).toBeLessThan(60);
        for (let d = 146; d <= 170; d++) Economy.applyLeanSeason(s, d); // summer
        expect(s.happiness).toBeCloseTo(60);
        expect(s.leanMood).toBeUndefined();
    });

    it('has no effect outside the lean weeks', () => {
        const s = town(0);
        for (let d = 40; d <= 80; d++) Economy.applyLeanSeason(s, d);
        expect(s.happiness).toBe(60);
    });

    it('runs from the daily settlement economy on the live settlement', () => {
        const live = town(0);
        const tile = { q: 0, r: 0, settlement: live };
        const copy = { ...live };
        Economy.produceDaily(copy, tile, { day: LATE_WINTER, getTile: () => tile }, {}, {});
        expect(live.happiness).toBeLessThan(60);
    });
});

describe('famine, floods and campaign season', () => {
    it('war declarations are likelier in summer and autumn, rarer in winter, and average out', () => {
        let sum = 0;
        for (let d = 1; d <= YEAR; d++) sum += Seasons.campaignFactor(d);
        expect(sum / YEAR).toBeCloseTo(1, 2);
        expect(Seasons.campaignFactor(SUMMER)).toBeGreaterThan(1);
        expect(Seasons.campaignFactor(AUTUMN)).toBeGreaterThan(1);
        expect(Seasons.campaignFactor(WINTER)).toBeLessThan(1);
    });

    it('floods come in spring, famine in the lean months, bountiful harvests in autumn', () => {
        expect(Seasons.eventWeight('flood', SPRING)).toBeGreaterThan(Seasons.eventWeight('flood', SUMMER));
        expect(Seasons.eventWeight('famine', LATE_WINTER)).toBeGreaterThan(1);
        expect(Seasons.eventWeight('famine', AUTUMN)).toBe(0);
        expect(Seasons.eventWeight('bountiful_harvest', AUTUMN)).toBeGreaterThan(1);
        expect(Seasons.eventWeight('plague', AUTUMN)).toBe(1);
        expect(WorldEvents.TEMPLATES.FAMINE.id).toBe('famine');
    });

    it('the timed-event pick honours the season (never a famine at harvest time)', () => {
        const chance = WorldEvents.DAILY_EVENT_CHANCE;
        WorldEvents.DAILY_EVENT_CHANCE = 1;
        try {
            const settlements = [{ name: 'Ash', q: 0, r: 0, kingdom: 'k1' }];
            for (let seed = 1; seed <= 60; seed++) {
                Utils.setSeed(seed);
                const world = {
                    day: AUTUMN, activeEvents: [], kingdoms: [],
                    getAllSettlements: () => settlements, getKingdom: () => ({ id: 'k1', name: 'Vale' }), getTile: () => null,
                };
                const { started } = WorldEvents.processTimedEvents(world);
                for (const ev of started) expect(ev.id).not.toBe('famine');
            }
        } finally {
            WorldEvents.DAILY_EVENT_CHANCE = chance;
        }
    });
});

describe('seasonal work', () => {
    const jobData = () => DataLoader.earlyJobs.oddJobs;
    const regularVillageMax = () => Math.max(...jobData().settlement_jobs.village.map(j => j.pay.max));

    it('autumn brings harvest-labour jobs that pay well', () => {
        const autumn = SeasonalWork.jobsFor('village', AUTUMN, jobData());
        const reaper = autumn.find(j => j.id === 'harvest_reaper');
        expect(reaper).toBeTruthy();
        expect(reaper.seasonal).toBe(true);
        expect(reaper.pay.min).toBeGreaterThan(regularVillageMax());
        expect(SeasonalWork.jobsFor('village', SPRING, jobData()).some(j => j.id === 'harvest_reaper')).toBe(false);
        expect(SeasonalWork.jobsFor('village', SPRING, jobData()).some(j => j.id === 'sowing_hand')).toBe(true);
        for (const job of jobData().seasonal_jobs) {
            expect(['strength', 'intelligence', 'combat', 'stealth', 'stamina', 'charisma']).toContain(job.stat);
            expect(job.seasons.every(s => Seasons.NAMES.includes(s))).toBe(true);
        }
    });

    it('spring planting contracts pay a small advance now and a share at harvest', () => {
        const village = { name: 'Barley', type: 'village', q: 5, r: 5, population: 400 };
        const world = worldWith([], SPRING, { settlement: village });
        const p = player({ gold: 0 });
        Utils.setSeed(3);
        const res = SeasonalWork.signPlantingContract(p, village, world);
        expect(res.success).toBe(true);
        expect(p.gold).toBe(res.advance);
        expect(Seasons.seasonOf(res.contract.dueDay)).toBe('Autumn');
        // once a year per village
        expect(SeasonalWork.signPlantingContract(p, village, world).success).toBe(false);
        // nothing until the harvest
        world.day = SUMMER;
        expect(SeasonalWork.processDaily(p, world)).toEqual([]);
        world.day = res.contract.dueDay;
        const paid = SeasonalWork.processDaily(p, world);
        expect(paid).toHaveLength(1);
        expect(paid[0].paid).toBe(res.contract.payout);
        expect(p.gold).toBe(res.advance + res.contract.payout);
        expect(p.plantingContracts).toBeUndefined();
    });

    it('a drought at harvest time shrinks the share', () => {
        const village = { name: 'Barley', type: 'village', q: 5, r: 5, population: 400 };
        const world = worldWith([], SPRING, { settlement: village });
        const p = player({ gold: 0 });
        const res = SeasonalWork.signPlantingContract(p, village, world);
        world.day = res.contract.dueDay;
        world.activeEvents = [{ id: 'drought', effects: { farmProduction: -0.4 }, kingdomId: null }];
        const [paid] = SeasonalWork.processDaily(p, world);
        expect(paid.paid).toBe(Math.round(res.contract.payout * 0.6));
    });

    it('planting contracts are only signed in spring', () => {
        const village = { name: 'Barley', type: 'village', q: 5, r: 5 };
        const p = player();
        expect(SeasonalWork.canSignPlantingContract(p, village, { day: SUMMER }).ok).toBe(false);
        expect(SeasonalWork.canSignPlantingContract(p, { ...village, type: 'capital' }, { day: SPRING }).ok).toBe(false);
    });

    it('winter brings fur trapping and ice fishing on cold ground only', () => {
        const forest = { q: 5, r: 5, terrain: { id: 'boreal_forest', passable: true }, temperature: 0.3, hasRiver: true };
        const winter = { day: WINTER, width: 40, height: 40, units: [], kingdoms: [], getAllSettlements: () => [], getKingdom: () => null, getTile: (q, r) => (q === 5 && r === 5 ? forest : { q, r, terrain: { id: 'plains', passable: true } }) };
        const summer = { ...winter, day: SUMMER };
        const actions = (world) => { const a = []; addWildernessActions(a, player(), forest, world); return a.map(x => x.type); };
        expect(actions(winter)).toEqual(expect.arrayContaining(['trap_furs', 'ice_fish']));
        expect(actions(summer)).not.toContain('trap_furs');
        expect(actions(summer)).not.toContain('ice_fish');
        // a warm southern forest never freezes
        const warm = { ...forest, temperature: 0.9 };
        expect(SeasonalWork.canTrapFurs(warm, winter)).toBe(false);

        Utils.setSeed(11);
        const p = player();
        const trap = SeasonalWork.trapFurs(p, forest, winter);
        expect(trap.success).toBe(true);
        expect(p.inventory.pelts).toBeGreaterThanOrEqual(1);
        const fish = SeasonalWork.iceFish(p, forest, winter);
        expect(fish.success).toBe(true);
        expect(p.inventory.fish).toBeGreaterThanOrEqual(2);
        expect(SeasonalWork.trapFurs(p, forest, summer).success).toBe(false);
    });

    it('the outlook names what is cheap, dear and producing', () => {
        const autumn = Seasons.outlook(85);
        expect(autumn.season).toBe('Autumn');
        expect(autumn.cheap.map(c => c.id)).toContain('food');
        expect(autumn.producing.map(p => p.kind)).toContain('crops');
        const late = Seasons.outlook(LATE_WINTER);
        expect(late.dear.map(c => c.id)).toContain('food');
        expect(late.lean).toBe(true);
        expect(late.summary).toMatch(/Lean season/);
    });
});

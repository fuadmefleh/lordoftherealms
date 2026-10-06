// Labour, classes & migration (world/townLabour.js, systems/labour.js,
// data/labour.json): strata, class demand, the labour market and wages,
// labour caps on output, the player's wage bills, idle hands and crime,
// migration toward prosperity, refugees from war, long-run stability,
// save/load with backfill, determinism.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TownLabour, STRATA } from '../world/townLabour.js';
import { Labour } from '../systems/labour.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { Underworld } from '../systems/underworld.js';
import { Heralds } from '../systems/heralds.js';
import { Chatter } from '../systems/chatter.js';
import { Counsel } from '../systems/counsel.js';
import { MerchantPrince } from '../systems/merchantPrince.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

function quiet() {
    const a = vi.spyOn(console, 'log').mockImplementation(() => {});
    const b = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => { a.mockRestore(); b.mockRestore(); };
}

const plains = (q, r, settlement = null) => ({ q, r, terrain: { id: 'plains', passable: true }, resource: null, settlement });

/** Two linked towns of one realm: a capital at (5,5) and a town at (9,5). */
function fixture() {
    const capital = { name: 'Highmarket', type: 'capital', population: 12000, happiness: 50, kingdom: 'k1', q: 5, r: 5 };
    const town = { name: 'Brindle', type: 'town', population: 3000, happiness: 50, kingdom: 'k1', q: 9, r: 5 };
    const tiles = new Map([['5,5', plains(5, 5, capital)], ['9,5', plains(9, 5, town)]]);
    const kingdoms = [{ id: 'k1', name: 'Aster', isAlive: true, wars: [], capital: { q: 5, r: 5 }, traits: [] }];
    const world = {
        width: 40, height: 40, day: 50, activeEvents: [], units: [], kingdoms,
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile: (q, r) => tiles.get(`${q},${r}`) || plains(q, r),
        getSettlementViews: () => [capital, town],
        getAllSettlements: () => [capital, town],
    };
    for (const s of [capital, town]) SettlementMarket.ensure(s);
    return { world, capital, town, tiles, kingdoms };
}

const sumShares = (lab) => STRATA.reduce((a, s) => a + lab.sh[s], 0);
const totalPop = (world) => world.getSettlementViews().reduce((a, s) => a + s.population, 0);

describe('strata', () => {
    it('derives a town\'s classes from its size, peoples and works', () => {
        const village = { name: 'V', type: 'village', population: 400 };
        const capital = { name: 'C', type: 'capital', population: 12000 };
        const lv = TownLabour.ensure(village), lc = TownLabour.ensure(capital);
        expect(sumShares(lv)).toBeCloseTo(1, 3);
        expect(sumShares(lc)).toBeCloseTo(1, 3);
        expect(lv.sh.peasants).toBeGreaterThan(0.8);
        expect(lc.sh.nobles).toBeGreaterThan(lv.sh.nobles);
        expect(lc.sh.merchants).toBeGreaterThan(lv.sh.merchants);
        // Hands: half the peasants work the land
        expect(lv.hands.land).toBe(Math.round(400 * lv.sh.peasants * 0.5));
        // A crafty people and a funded works lean the mix toward the artisans
        const crafty = { name: 'K', type: 'town', population: 3000, peoplesEffects: { goods: 0.2 } };
        const plain = { name: 'P', type: 'town', population: 3000 };
        expect(TownLabour.targetMix(crafty).artisans).toBeGreaterThan(TownLabour.targetMix(plain).artisans);
        const works = { name: 'W', type: 'town', population: 3000, market: { works: { bakery: { lvl: 3, cap: 18 } } } };
        expect(TownLabour.targetMix(works).artisans).toBeGreaterThan(TownLabour.targetMix(plain).artisans);
    });
});

describe('class demand', () => {
    it('nobles and merchants buy wine and luxuries, peasants grain — and the usual mix buys what it always did', () => {
        const { capital } = fixture();
        const C = SettlementMarket.config();
        const flat = { wine: SettlementMarket.need(capital, 'wine'), grain: SettlementMarket.need(capital, 'grain'), luxuries: SettlementMarket.need(capital, 'luxuries') };
        // The usual mix for its size: the same need as without classes
        const lab = TownLabour.ensure(capital);
        TownLabour._setMix(lab, TownLabour.baseMix('capital'));
        expect(SettlementMarket.need(capital, 'wine')).toBeCloseTo(flat.wine, 6);
        expect(SettlementMarket.need(capital, 'grain')).toBeCloseTo(flat.grain, 6);
        // ...weighted over the usual mix, every good's factor is 1 (demand stays balanced)
        const dm = TownLabour.demandMults(capital, C);
        for (let i = 0; i < C.goodIds.length; i++) expect(dm[i]).toBeCloseTo(1, 6);
        // A court town: more nobles and merchants, fewer peasants
        TownLabour._setMix(lab, { peasants: 0.3, artisans: 0.28, merchants: 0.22, clergy: 0.07, nobles: 0.13 });
        expect(SettlementMarket.need(capital, 'wine')).toBeGreaterThan(flat.wine * 1.3);
        expect(SettlementMarket.need(capital, 'luxuries')).toBeGreaterThan(flat.luxuries * 1.3);
        expect(SettlementMarket.need(capital, 'grain')).toBeLessThan(flat.grain);
        // ...and the price of wine reads the new need
        capital.market.stock.wine = SettlementMarket.target(capital, 'wine') * 0.7;
        expect(SettlementMarket.scarcity(capital, 'wine')).toBeGreaterThan(1);
    });
});

describe('the labour market', () => {
    it('wages rise when hands are scarce and fall when they are idle', () => {
        const { capital, town } = fixture();
        TownLabour.ensure(capital);
        const base = TownLabour.baseWage('capital', 'craft');
        // The works hire far more artisans than the town has spare
        for (let t = 0; t < 8; t++) TownLabour.update(capital, { day: 50 + t * 4, k: 4, hands: { craft: 800 } });
        expect(capital.labour.fill.craft).toBeLessThan(1);
        expect(capital.labour.wage.craft).toBeGreaterThan(base * 1.1);
        // ...which the town guilds read as the wage index (1 = the customary wage at today's bread)
        expect(capital.wageIndex).toBeGreaterThan(1.05);
        // A town flooded with newcomers: its workshops have no place for them yet
        const lt = TownLabour.ensure(town);
        TownLabour.update(town, { day: 50, k: 4 });
        town.population += 1500;
        lt.sh.artisans += 0.1;
        TownLabour._setMix(lt, lt.sh);
        for (let t = 0; t < 4; t++) TownLabour.update(town, { day: 54 + t * 4, k: 4 });
        expect(town.labour.idle.craft).toBeGreaterThan(0.1);
        expect(town.labour.wage.craft).toBeLessThan(TownLabour.baseWage('town', 'craft'));
    });

    it('a town short of hands makes and reaps less', () => {
        const a = fixture().capital, b = fixture().capital;
        for (const s of [a, b]) {
            TownLabour.ensure(s);
            s.market.stock.grain = SettlementMarket.target(s, 'grain') * 1.6;
            s.market.stock.bread = SettlementMarket.target(s, 'bread') * 0.3;
        }
        // b has lost most of its artisans and peasants
        b.labour.fill = { land: 0.5, craft: 0.4, trade: 1 };
        const prod = { grain: 60, clothes: 10 };
        SettlementMarket.processSettlement(a, prod, { day: 50, days: 4 });
        SettlementMarket.processSettlement(b, prod, { day: 50, days: 4 });
        expect(b.market.stock.bread).toBeLessThan(a.market.stock.bread);
        expect(b.market.stock.clothes).toBeLessThan(a.market.stock.clothes);
        expect(b.market.util).toBeLessThanOrEqual(1);
        // A strike idles most of the craft fill
        a.labour.strike = 60;
        expect(TownLabour.factors(a, 55).craft).toBeLessThanOrEqual(0.4);
        expect(TownLabour.factors(a, 61).craft).toBe(1);
    });
});

describe('the player pays wages', () => {
    it('properties pay their hands at the local wage and are staffed only as far as the town can', () => {
        const player = { properties: [{ type: 'farm' }], skills: { commerce: 0 } };
        const prop = { type: 'farm', upkeep: 6, level: 1 };
        const plain = PlayerEconomy.getPropertyUpkeep(player, prop);
        prop.hire = { ratio: 1, fill: 1 };
        expect(PlayerEconomy.getPropertyUpkeep(player, prop)).toBe(plain);
        prop.hire = { ratio: 1.8, fill: 0.6 };
        expect(PlayerEconomy.getPropertyUpkeep(player, prop)).toBeGreaterThan(plain);
        expect(TownLabour.staffing(prop.hire)).toBeCloseTo(0.6, 6);
        prop.hire = { ratio: 0.7, fill: 1 };
        expect(PlayerEconomy.getPropertyUpkeep(player, prop)).toBeLessThanOrEqual(plain);
    });

    it('the labour day finds each property its town and counts its hands there', () => {
        const restore = quiet();
        try {
            const game = newGame(101);
            const { world, player } = game;
            const s = world.getSettlementViews().slice().sort((a, b) => b.population - a.population)[0];
            const tile = world.getTile(s.q, s.r);
            tile.playerProperties = [{ type: 'workshop', name: 'Workshop', upkeep: 10, level: 1, productionRate: 3 }];
            player.properties = [{ q: s.q, r: s.r, type: 'workshop', name: 'Workshop' }];
            for (let d = 0; d < 5; d++) { game.player.health = 100; game.player.inventory.bread = 40; endDay(game); }
            const hire = tile.playerProperties[0].hire;
            expect(hire).toBeTruthy();
            expect(hire.town).toBe(s.name);
            expect(hire.sector).toBe('craft');
            expect(hire.hands).toBeGreaterThan(0);
            expect(hire.wage).toBeGreaterThan(0);
        } finally { restore(); }
    });

    it('works pay their hands out of the investor\'s share', () => {
        const { capital } = fixture();
        const w = { lvl: 2, cap: 12, cond: 1, runs: 0 };
        const idle = TownLabour.worksWageBill(capital, 'bakery', w, 4);
        w.runs = 24;
        const half = TownLabour.worksWageBill(capital, 'bakery', w, 4);
        w.runs = 48;
        const busy = TownLabour.worksWageBill(capital, 'bakery', w, 4);
        // Paid for the runs they make (no skeleton crew by default)
        expect(idle).toBe(0);
        expect(half).toBeGreaterThan(0);
        expect(busy).toBeCloseTo(half * 2, 6);
        // ...and a run must earn its wages: the wage per run is what the run decision weighs
        expect(TownLabour.worksWagePerRun(capital, 'bakery', w)).toBeCloseTo(busy / 48, 6);
        expect(busy).toBeCloseTo(TownLabour.worksHands('bakery', 2) * TownLabour.baseWage('capital', 'craft') * 4, 6);
    });
});

describe('idle hands', () => {
    it('breed crime and unrest and sour the mood', () => {
        const { town } = fixture();
        const lab = TownLabour.ensure(town);
        TownLabour.update(town, { day: 50, k: 4 });
        const happy = town.happiness;
        // Twice the people the town's trades and land were built for
        town.population = 9000;
        lab.base = 3000;
        for (let t = 0; t < 10; t++) TownLabour.update(town, { day: 54 + t * 4, k: 4, fertility: 0.7 });
        expect(TownLabour.idle(town)).toBeGreaterThan(0.1);
        expect(TownLabour.crime(town)).toBeGreaterThan(0.1);
        expect(town.labourMood).toBeLessThan(0);
        expect(town.happiness).toBeLessThan(happy);
        expect(TownLabour.unrestPressure(town)).toBeGreaterThan(0);
        expect(TownLabour.crimeOdds(town)).toBeGreaterThan(0);
        expect(TownLabour.theftBonus(town)).toBeGreaterThan(0);
        // The thieves' guild finds it easier
        const player = { skills: { stealth: 3 }, underworld: null };
        const quietTown = { name: 'Q', type: 'town', population: 3000 };
        const a = Underworld.jobOdds(player, null, town, 'pickpocket');
        const b = Underworld.jobOdds(player, null, quietTown, 'pickpocket');
        expect(a).toBeGreaterThan(b);
    });
});

describe('migration and refugees', () => {
    function linkedGame(seed = 101) {
        const game = newGame(seed);
        for (let d = 0; d < 8; d++) { game.player.health = 100; game.player.inventory.bread = 40; endDay(game); }
        const links = MarketDynamics._cache(game.world).links.list;
        const link = links.find(l => l.a.population > 600 && l.b.population > 600 && l.a.kingdom === l.b.kingdom);
        return { game, link };
    }

    it('people drift toward the town where their class fares better', () => {
        const restore = quiet();
        try {
            const { game, link } = linkedGame();
            const { world } = game;
            const { a, b } = link;
            const before = totalPop(world);
            const popA = a.population, popB = b.population;
            for (const s of STRATA) { a.labour.wel[s] = 0.6; b.labour.wel[s] = 0.92; }
            const lives = world.getSettlementViews();
            Labour._week(world, null, lives, [link], Labour._dangerCtx(world, null, [link]), new Set(), world.day, { notices: [], news: [] });
            expect(a.population).toBeLessThan(popA);
            expect(b.population).toBeGreaterThan(popB);
            expect(a.population + b.population).toBe(popA + popB);
            expect(totalPop(world)).toBe(before);
            // ...but slowly: at most a percent of the town a week
            expect(popA - a.population).toBeLessThanOrEqual(Math.floor(popA * 0.01));
            expect(sumShares(a.labour)).toBeCloseTo(1, 3);
            expect(sumShares(b.labour)).toBeCloseTo(1, 3);
        } finally { restore(); }
    });

    it('refugees flee a conquered town for safe neighbours and go home when it is safe', () => {
        const restore = quiet();
        try {
            const { game, link } = linkedGame(202);
            const { world } = game;
            const { a, b } = link;
            const before = totalPop(world);
            const popA = a.population;
            a.labour.conq = world.day;          // just taken by a new crown
            const lives = world.getSettlementViews();
            const out = { notices: [], news: [] };
            Labour._week(world, null, lives, [link], Labour._dangerCtx(world, null, [link]), new Set(), world.day, out);
            const fled = popA - a.population;
            expect(fled).toBeGreaterThan(0);
            expect(b.labour.refugees).toBeGreaterThan(0);
            expect(b.labour.from[`${a.q},${a.r}`]).toBeGreaterThan(0);
            expect(totalPop(world)).toBe(before);
            if (fled >= 40) expect(out.news.some(n => n.kind === 'refugees')).toBe(true);
            // A month later the danger has passed: some go home
            delete a.labour.conq;
            const back = a.population;
            Labour._week(world, null, lives, [link], Labour._dangerCtx(world, null, [link]), new Set(), world.day + 35, { notices: [], news: [] });
            expect(a.population).toBeGreaterThan(back);
            expect(totalPop(world)).toBe(before);
        } finally { restore(); }
    });

    it('the heralds cry a refugee column and the tavern talks of it', () => {
        const restore = quiet();
        try {
            const game = newGame(303);
            const { world, player } = game;
            endDay(game);
            const s = world.getSettlementViews()[0];
            Heralds.processDay(world, player);
            Labour.record(world, { key: 'refugees:test', kind: 'refugees', place: s.name, to: 'Elsewhere', q: s.q, r: s.r, n: 120, why: 'war', kingdomId: s.kingdom || null });
            world.day++;
            Heralds.processDay(world, player);
            expect(player.heralds.list.some(p => p.kind === 'labour_refugees' && p.text.includes(s.name))).toBe(true);
            expect(Chatter.validate()).toEqual([]);
            TownLabour.ensure(s);
            s.labour.refugees = 50;
            const ctx = Chatter.context(world, player, { q: s.q, r: s.r });
            expect(ctx.labour).toContain('refugees');
        } finally { restore(); }
    });
});

describe('in the whole game', () => {
    it('keeps populations stable and shares whole over a long run', () => {
        const restore = quiet();
        try {
            const game = newGame(101);
            const { world } = game;
            const pop0 = totalPop(world);
            for (let d = 0; d < 240; d++) { game.player.health = 100; game.player.inventory.bread = 40; game.player.starvationDays = 0; endDay(game); }
            const pop = totalPop(world);
            // The world grows as it always did (about 10% a year), not lurching
            expect(pop).toBeGreaterThan(pop0 * 0.95);
            expect(pop).toBeLessThan(pop0 * 1.35);
            for (const s of world.getSettlementViews()) {
                const lab = s.labour;
                expect(lab, s.name).toBeTruthy();
                expect(sumShares(lab)).toBeCloseTo(1, 2);
                for (const st of STRATA) {
                    expect(Number.isFinite(lab.sh[st])).toBe(true);
                    expect(Number.isFinite(lab.wel[st])).toBe(true);
                }
                expect(Number.isFinite(lab.wage.craft) && lab.wage.craft > 0).toBe(true);
                expect(Number.isFinite(s.population) && s.population >= 1).toBe(true);
            }
            // Most towns are at work and content
            const idle = world.getSettlementViews().map(s => TownLabour.idle(s)).sort((x, y) => x - y);
            expect(idle[Math.floor(idle.length / 2)]).toBeLessThan(0.08);
        } finally { restore(); }
    }, 120000);

    it('survives a save round trip and carries on identically; old saves derive their classes', () => {
        const restore = quiet();
        try {
            const run = (seed, days) => {
                const g = newGame(seed);
                for (let d = 0; d < days; d++) { g.player.health = 100; g.player.inventory.bread = 40; endDay(g); }
                return g;
            };
            const a = run(202, 12);
            const b = roundTrip(a);
            const labs = (g) => JSON.stringify(g.world.getSettlementViews().map(s => [s.name, s.population, s.labour]));
            expect(labs(b)).toBe(labs(a));
            expect(JSON.stringify(b.world.labour)).toBe(JSON.stringify(a.world.labour));
            // The markets' and the labour days draw no dice, so both games carry on alike
            // (the full endDay shares one RNG stream between them)
            for (let d = 0; d < 9; d++) {
                for (const g of [a, b]) {
                    g.world.day++;
                    MarketDynamics.updatePrices(g.world, g.player);
                    Labour.processDay(g.world, g.player);
                }
            }
            expect(labs(b)).toBe(labs(a));
            // An old save: no labour anywhere — the next labour day derives it from the people
            for (const s of b.world.getSettlementViews()) { delete s.labour; delete s.labourMood; }
            delete b.world.labour;
            const c = roundTrip(b);
            c.player.health = 100;
            endDay(c);
            for (const s of c.world.getSettlementViews()) {
                expect(s.labour, s.name).toBeTruthy();
                expect(sumShares(s.labour)).toBeCloseTo(1, 2);
            }
        } finally { restore(); }
    }, 120000);

    it('is deterministic and draws nothing from the shared RNG', () => {
        const restore = quiet();
        try {
            const run = () => {
                const g = newGame(404);
                for (let d = 0; d < 10; d++) { g.player.health = 100; g.player.inventory.bread = 40; endDay(g); }
                return JSON.stringify(g.world.getSettlementViews().map(s => [s.population, s.labour]));
            };
            expect(run()).toBe(run());
            // The labour day itself touches no dice
            const g = newGame(505);
            for (let d = 0; d < 3; d++) { g.player.health = 100; endDay(g); }
            Utils.setSeed(99);
            const r1 = Utils.random();
            Utils.setSeed(99);
            g.world.day++;
            for (const s of g.world.getSettlementViews()) if (s.market) s.market.day = g.world.day;
            Labour.processDay(g.world, g.player);
            expect(Utils.random()).toBe(r1);
        } finally { restore(); }
    }, 60000);
});

describe('the steward', () => {
    it('warns when the player\'s works cannot find hands', () => {
        const restore = quiet();
        try {
            const game = newGame(101);
            const { world, player } = game;
            endDay(game);
            const s = world.getSettlementViews().slice().sort((a, b) => b.population - a.population)[0];
            player.q = s.q; player.r = s.r;
            player.gold = 20000;
            player.inventory = { ...player.inventory, wood: 60, stone: 60 };
            expect(MerchantPrince.invest(player, world, world.getTile(s.q, s.r), 'bakery').success).toBe(true);
            TownLabour.ensure(s);
            s.labour.fill.craft = 0.5;
            const facts = Counsel.READERS.worksShortHands(Counsel._ctx(player, world), { below: 0.85 });
            expect(facts.length).toBe(1);
            expect(facts[0].town).toBe(s.name);
            expect(Labour.worksShortHands(player, world).length).toBe(1);
        } finally { restore(); }
    });
});

// Harvests & the agricultural year (world/harvests.js): regional yields from
// the season's weather, war and blights; crop mixes, soil and rotations; the
// forecast as summer goes; what a harvest does to the towns' output, prices,
// the player's farms; saves; determinism; and a survival guard.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Harvests } from '../world/harvests.js';
import { Seasons } from '../world/seasons.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Heralds } from '../systems/heralds.js';
import { Chatter } from '../systems/chatter.js';
import { Counsel } from '../systems/counsel.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Taxation } from '../systems/marketDynamics.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

let ORIG = null;
beforeAll(async () => {
    await loadData();
    ORIG = DataLoader._gamedata.harvests;
});
afterEach(() => {
    DataLoader._gamedata.harvests = ORIG;
});

/** Override part of data/harvests.json for one test. */
function tune(patch) {
    DataLoader._gamedata.harvests = { ...ORIG, ...patch };
}

const Y = Seasons.DAYS_PER_YEAR;
const keep = (game) => { game.player.health = 100; game.player.inventory.bread = 40; game.player.starvationDays = 0; };
const live = (world, s) => world.getTile(s.q, s.r).settlement;

/** Run Harvests alone (no other system) from `from` to `to` (world days). */
function runHarvests(world, from, to, player = null) {
    for (let d = from; d <= to; d++) {
        world.day = d;
        Harvests.processDay(world, player);
    }
}

/** A world whose weather is `wx(day)` in the growing season of `year` and clear otherwise. */
function weatherWorld(seed, year, wx) {
    const g = newGame(seed);
    const w = g.world;
    w.weather.getWeather = (q, r, day) => {
        const d = day == null ? w.day : day;
        return { type: Harvests.yearOf(d) === year ? wx(q, r, d) : 'clear', intensity: 0 };
    };
    return g;
}

/** The region of the realm with the most towns. */
function bigRealm(world) {
    const count = {};
    for (const s of world.getSettlementViews()) if (s.kingdom != null) count[s.kingdom] = (count[s.kingdom] || 0) + 1;
    const id = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
    return { kingdomId: (world.kingdoms.find(k => String(k.id) === id) || {}).id, region: `k:${id}` };
}

describe('Harvests — the weather sets the year', () => {
    it('a wet growing season against a clear climate gives a bumper harvest, a heat wave a failed one', () => {
        tune({ blights: {} });
        const wet = weatherWorld(101, 7, () => 'rain');
        runHarvests(wet.world, 7 * Y + 1, 7 * Y + 65);
        const dry = weatherWorld(101, 7, () => 'heatwave');
        runHarvests(dry.world, 7 * Y + 1, 7 * Y + 65);
        const { region } = bigRealm(wet.world);
        const a = Harvests.outcome(wet.world, region, 7);
        const b = Harvests.outcome(dry.world, region, 7);
        expect(a).toBeTruthy();
        expect(b).toBeTruthy();
        expect(a.weather).toBeGreaterThan(1.1);
        expect(b.weather).toBeLessThan(0.7);
        expect(a.grain).toBeGreaterThan(b.grain);
        // A normal year (the same weather as the climate) is a normal harvest
        const plain = weatherWorld(101, 7, () => 'clear');
        runHarvests(plain.world, 7 * Y + 1, 7 * Y + 65);
        expect(Harvests.outcome(plain.world, region, 7).weather).toBeCloseTo(1, 5);
    });

    it('real weather varies the harvest from year to year and region to region', () => {
        tune({ blights: {} });
        const g = newGame(202);
        runHarvests(g.world, 2, 6 * Y);
        const ys = [];
        for (const p of g.world.harvests.past) for (const o of Object.values(p.out)) ys.push(o.weather);
        const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
        const sd = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length);
        expect(ys.length).toBeGreaterThan(20);
        expect(mean).toBeGreaterThan(0.93);
        expect(mean).toBeLessThan(1.07);
        expect(sd).toBeGreaterThan(0.05);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(Harvests.config().weather.min);
        expect(Math.max(...ys)).toBeLessThanOrEqual(Harvests.config().weather.max);
    });
});

describe('Harvests — war, blights and labour', () => {
    it('a realm at war, its fields fought over, reaps less than in peace', () => {
        tune({ blights: {} });
        const plain = weatherWorld(101, 7, () => 'clear');
        const war = weatherWorld(101, 7, () => 'clear');
        const { kingdomId, region } = bigRealm(war.world);
        const k = war.world.kingdoms.find(x => x.id === kingdomId);
        const enemy = war.world.kingdoms.find(x => x.id !== kingdomId && x.isAlive !== false);
        for (let d = 7 * Y + 1; d <= 7 * Y + 65; d++) {
            war.world.day = d;
            k.wars = [enemy.id];
            if (d % 10 === 0) Harvests.noteBattle(war.world, kingdomId);
            Harvests.processDay(war.world, null);
        }
        runHarvests(plain.world, 7 * Y + 1, 7 * Y + 65);
        const a = Harvests.outcome(war.world, region, 7);
        const b = Harvests.outcome(plain.world, region, 7);
        expect(a.war).toBeGreaterThan(0.1);
        expect(a.war).toBeLessThanOrEqual(Harvests.config().war.max);
        expect(a.grain).toBeLessThan(b.grain * 0.9);
        // Its towns' fields take the cut
        const town = war.world.getSettlementViews().find(s => s.kingdom === kingdomId);
        expect(Harvests.townYield(live(war.world, town)).grain).toBeLessThan(Harvests.townYield(live(plain.world, town)).grain);
    });

    it('a blight starts on its day, spreads to neighbouring regions and not to distant ones', () => {
        tune({ blights: { rust: { name: 'grain rust', hits: ['grain'], chance: 0, start: [10, 10], severity: [0.4, 0.4], spread: 30, decay: 0.8 } } });
        const g = weatherWorld(101, 7, () => 'clear');
        const w = g.world;
        runHarvests(w, 7 * Y + 1, 7 * Y + 1);
        const cur = w.harvests.cur;
        const { region } = bigRealm(w);
        cur.regions[region].plan.push({ kind: 'rust', day: 10, sev: 0.4 });
        runHarvests(w, 7 * Y + 2, 7 * Y + 65);
        const hit = Object.entries(cur.regions).filter(([, r]) => r.blights.some(b => b.kind === 'rust')).map(([id]) => id);
        expect(hit).toContain(region);
        const nb = cur.regions[region].nb;
        expect(nb.length).toBeGreaterThan(0);
        for (const id of nb) expect(hit).toContain(id);
        // A spread blight is weaker; every hit region reaps less grain, the rest not
        const o = Harvests.outcome(w, region, 7);
        expect(o.grain).toBeCloseTo(0.6, 2);
        expect(o.veg).toBeCloseTo(1, 2);
        for (const [id, r] of Object.entries(cur.regions)) {
            const b = r.blights.find(x => x.kind === 'rust');
            if (!b) expect(Harvests.outcome(w, id, 7).grain).toBeCloseTo(1, 2);
            else if (b.from) expect(b.sev).toBeLessThan(0.4);
        }
        // News for the heralds: one record per region hit
        const rec = Harvests.history(w).filter(h => h.kind === 'blight');
        expect(rec.length).toBe(hit.length);
    });

    it('blights are hash-rolled: the same world and year give the same blights', () => {
        const a = newGame(303);
        const b = newGame(303);
        runHarvests(a.world, 2, 3 * Y);
        runHarvests(b.world, 2, 3 * Y);
        expect(JSON.stringify(a.world.harvests.past)).toBe(JSON.stringify(b.world.harvests.past));
        const plans = Object.values(a.world.harvests.cur.regions).flatMap(r => r.plan);
        for (const p of plans) expect(Harvests.config().blights[p.kind]).toBeTruthy();
    });
});

describe('Harvests — the harvest reaches the economy', () => {
    it('scales a town\'s grain, wine, linen and herds by its yields and mix', () => {
        const g = newGame(101);
        const w = g.world;
        runHarvests(w, 2, 2);
        const s = w.getSettlementViews().map(v => live(w, v)).find(x => x.type === 'city' || x.type === 'capital');
        const f = s.farm;
        expect(f && f.mix).toBeTruthy();
        expect(Object.values(f.mix).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
        const base = { grain: 10, wine: 2, meat: 3, cheese: 1 };
        // Before any harvest: nothing changes but the flax
        const p0 = Harvests.applyToProduction(w, s, { ...base });
        expect(p0.grain).toBe(10);
        expect(p0.meat).toBe(3);
        f.y = { grain: 0.6, veg: 0.6, fibre: 0.6, vine: 0.5, fodder: 0.6, stock: 0.7 };
        const bad = Harvests.applyToProduction(w, s, { ...base });
        f.y = { grain: 1.25, veg: 1.25, fibre: 1.25, vine: 1.2, fodder: 1.2, stock: 1.1 };
        const good = Harvests.applyToProduction(w, s, { ...base });
        expect(bad.grain).toBeLessThan(7);
        expect(good.grain).toBeGreaterThan(11);
        expect(bad.wine).toBeLessThan(good.wine);
        expect(bad.meat).toBeCloseTo(3 * 0.7, 3);
        // (flax comes to market as flax for the linen weavers and the cottagers, not as textiles)
        expect(good.flax || 0).toBeGreaterThan(bad.flax || 0);
        expect(good.textiles || 0).toBe(0);
        // ...the granary food the people eat and the tithe follow, damped
        expect(Harvests.foodFactor(w, s)).toBeGreaterThan(1);
        expect(Harvests.foodFactor(w, s)).toBeLessThan(Harvests.grainFactor(s));
        f.y = { grain: 0.6, veg: 0.6, fibre: 0.6, vine: 0.5, fodder: 0.6, stock: 0.7 };
        expect(Harvests.rentFactor(s)).toBeLessThan(1);
    });

    it('a failed harvest makes grain dear in the town, a bumper one cheap', () => {
        const mk = () => {
            const s = { name: 'Testford', type: 'town', population: 3000, q: 5, r: 5 };
            SettlementMarket.ensure(s);
            return s;
        };
        const run = (y) => {
            const s = mk();
            s.farm = { mix: { grain: 0.55, veg: 0.15, fibre: 0.07, vine: 0.05, fallow: 0.18 }, ref: { grain: 0.55, veg: 0.15, fibre: 0.07, vine: 0.05, fallow: 0.18 }, soil: 1, y: { grain: y, veg: y, fibre: y, vine: y, fodder: y, stock: 1 } };
            // Grain enough for the town's grain, flour and bread with a margin in a normal year
            const need = SettlementMarket.need(s, 'grain') + SettlementMarket.need(s, 'flour') + SettlementMarket.need(s, 'bread') / 1.25;
            // (a town alone, no trade: what it grows is all it has)
            const prod = Harvests.applyToProduction(null, s, { grain: need * 2, fish: SettlementMarket.need(s, 'fish'), meat: SettlementMarket.need(s, 'meat') });
            for (let d = 1; d <= 60; d++) SettlementMarket.processSettlement(s, prod, { day: 200 + d });
            return { scarcity: SettlementMarket.scarcity(s, 'grain'), stock: s.market.stock.grain, short: SettlementMarket.foodShortage(s) };
        };
        const bad = run(0.6), normal = run(1), good = run(1.3);
        expect(bad.scarcity).toBeGreaterThan(normal.scarcity * 1.5);
        expect(bad.stock).toBeLessThan(normal.stock);
        expect(good.stock).toBeGreaterThan(normal.stock * 1.3);
        expect(good.scarcity).toBeLessThanOrEqual(normal.scarcity);
    });

    it('the tithe of a holding follows its harvest (Taxation.collectTaxes)', () => {
        const g = newGame(101);
        const { world, player } = g;
        const v = world.getSettlementViews().find(s => s.population > 500);
        const s = live(world, v);
        const settle = (y) => { s.farm = { mix: { grain: 0.55, veg: 0.15, fibre: 0.07, vine: 0.05, fallow: 0.18 }, ref: { grain: 0.55, veg: 0.15, fibre: 0.07, vine: 0.05, fallow: 0.18 }, soil: 1, y: { grain: y, veg: y, fibre: y, vine: y, fodder: y, stock: 1 } }; };
        const orig = Taxation.getPlayerSettlements;
        Taxation.getPlayerSettlements = () => [{ q: v.q, r: v.r, settlement: s }];
        try {
            settle(0.6);
            const lean = Taxation.collectTaxes(player, world, { dryRun: true });
            settle(1.3);
            const rich = Taxation.collectTaxes(player, world, { dryRun: true });
            expect(lean.settlements[0].harvest).toBeLessThan(1);
            expect(rich.collected).toBeGreaterThan(lean.collected);
        } finally {
            Taxation.getPlayerSettlements = orig;
        }
    });
});

describe('Harvests — crop mix, soil and rotation', () => {
    it('the mix drifts toward the crop that sells dear, and over-cropping thins the soil', () => {
        const g = newGame(101);
        const w = g.world;
        runHarvests(w, 2, 2);
        const s = w.getSettlementViews().map(v => live(w, v)).find(x => x.type !== 'village');
        SettlementMarket.ensure(s);
        const f = s.farm;
        const grain0 = f.mix.grain;
        // Grain runs short in the market: the farmers sow more of it
        s.market.stock.grain = 0;
        for (let i = 0; i < 3; i++) Harvests._drift(w, s, f);
        expect(f.mix.grain).toBeGreaterThan(grain0);
        // No rest for the land: the soil thins, and the farmers rest more of it
        f.mix = { grain: 0.8, veg: 0.05, fibre: 0.07, vine: 0.02, fallow: 0.06 };
        const before = f.soil;
        Harvests._drift(w, s, f);
        expect(f.soil).toBeLessThan(before);
        // Fallow and legumes restore it
        f.soil = 0.7;
        f.mix = { grain: 0.4, veg: 0.25, fibre: 0.05, vine: 0.05, fallow: 0.25 };
        Harvests._drift(w, s, f);
        expect(f.soil).toBeGreaterThan(0.7);
        expect(f.mix.fallow).toBeGreaterThanOrEqual(Harvests.config().crops.minFallow);
    });

    it('a player farm\'s rotation trades yield now for soil later', () => {
        const g = newGame(101);
        const { world, player } = g;
        const t = world.getTile(player.q, player.r);
        const farm = { type: 'farm', name: 'Home Farm', produces: 'grain', productionRate: 8, level: 1, storage: 0 };
        t.playerProperties = [farm];
        player.properties = [{ q: t.q, r: t.r, type: 'farm' }];
        expect(Harvests.propertyFactor(world, t, farm)).toBe(1);
        expect(Harvests.setRotation(player, world, t.q, t.r, 'farm', 'intensive').success).toBe(true);
        expect(Harvests.setRotation(player, world, t.q, t.r, 'farm', 'nonsense').success).toBe(false);
        expect(Harvests.propertyFactor(world, t, farm)).toBeCloseTo(1.15, 5);
        // Year after year of intensive cropping wears the soil down toward 0.7
        runHarvests(world, 2, 4 * Y + 61, player);
        expect(farm.soil).toBeLessThan(0.85);
        const worn = farm.soil;
        Harvests.setRotation(player, world, t.q, t.r, 'farm', 'rest');
        runHarvests(world, 4 * Y + 62, 6 * Y + 61, player);
        expect(farm.soil).toBeGreaterThan(worn);
        const o = Harvests.outcome(world, Harvests.regionOf(world, t.q, t.r));
        expect(Harvests.propertyFactor(world, t, farm)).toBeCloseTo(Math.min(2, o.grain * farm.soil * 0.8), 3);
    });

    it('a player farm follows the regional harvest (PlayerEconomy.produceGoods)', () => {
        const g = newGame(101);
        const { world, player } = g;
        const t = world.getTile(player.q, player.r);
        runHarvests(world, 2, 61, player);
        const region = Harvests.regionOf(world, t.q, t.r);
        const out = world.harvests.last.out;
        if (!out[region]) out[region] = { name: 'here', y: 1, grain: 1, veg: 1, fibre: 1, vine: 1, fodder: 1, stock: 1, weather: 1, war: 0, blights: [] };
        const make = () => {
            const farm = { type: 'farm', name: 'Home Farm', produces: 'grain', productionRate: 6, level: 1, storage: 0, daysOwned: 0 };
            t.playerProperties = [farm];
            player.properties = [{ q: t.q, r: t.r, type: 'farm' }];
            player.gold = 10000;
            return farm;
        };
        const yieldAt = (y) => {
            out[region].grain = y;
            const farm = make();
            world.day = 75; // autumn
            for (let i = 0; i < 3; i++) PlayerEconomy.produceGoods(player, world);
            return farm.storage;
        };
        const bad = yieldAt(0.5);
        const good = yieldAt(1.3);
        expect(good).toBeGreaterThan(0);
        expect(bad).toBeLessThan(good * 0.6);
    });
});

describe('Harvests — forecasts as summer goes', () => {
    it('the estimate firms up through the season and the player hears of it', () => {
        tune({ blights: {} });
        const g = weatherWorld(101, 7, () => 'heatwave');
        const { world, player } = g;
        const { region } = bigRealm(world);
        runHarvests(world, 7 * Y + 1, 7 * Y + 15);
        const early = Harvests.forecast(world, region);
        runHarvests(world, 7 * Y + 16, 7 * Y + 50);
        const late = Harvests.forecast(world, region);
        expect(early.settled).toBe(false);
        expect(late.conf).toBeGreaterThan(early.conf);
        expect(late.est).toBeLessThan(early.est);
        expect(Harvests.expectedYield(world, region)).toBe(late.est);
        // A failing harvest is cried and talked of
        expect(Harvests.history(world).some(h => h.kind === 'failing' && h.region === region)).toBe(true);
        const town = world.getSettlementViews().find(s => `k:${s.kingdom}` === region);
        expect(Harvests.talk(world, live(world, town))).toContain('failing');
        // The player standing in a market town hears the crop reports
        player.q = town.q; player.r = town.r;
        SettlementMarket.ensure(live(world, town));
        runHarvests(world, 7 * Y + 51, 7 * Y + 52, player);
        const known = Harvests.known(player, world);
        expect(known.length).toBeGreaterThan(1);
        expect(known.find(k => k.id === region).est).toBeLessThan(0.85);
        // ...and the Steward points at it
        const facts = Counsel.READERS.harvestFailing({ player, world, day: world.day }, {});
        expect(facts.some(f => f.place === Harvests.regionName(world, region))).toBe(true);
        // After the reckoning the forecast is the outcome
        runHarvests(world, 7 * Y + 53, 7 * Y + 62, player);
        const after = Harvests.forecast(world, region);
        expect(after.settled).toBe(true);
        expect(after.est).toBe(Harvests.outcome(world, region, 7).y);
    });

    it('the heralds cry the harvest news and the townsfolk talk of it', () => {
        tune({ blights: {} });
        const g = weatherWorld(101, 7, () => 'heatwave');
        const { world, player } = g;
        world.day = 7 * Y;
        Heralds.processDay(world, player);
        runHarvests(world, 7 * Y + 1, 7 * Y + 46);
        Heralds.processDay(world, player);
        const st = player.heralds;
        expect(st.list.some(p => p.kind === 'harvest_failing')).toBe(true);
        expect(st.list.find(p => p.kind === 'harvest_failing').text).toMatch(/harvest|crop/i);
        // The tavern talk's harvest lines and the heralds' templates are well-formed
        DataLoader._gamedata.harvests = ORIG;
        expect(Chatter.validate()).toEqual([]);
        const town = world.getSettlementViews().find(s => Harvests.talk(world, live(world, s)).includes('failing'));
        expect(town).toBeTruthy();
        const ctx = Chatter.context(world, player, { q: town.q, r: town.r });
        expect(ctx.harvest).toContain('failing');
        expect(Chatter.candidates(ctx).some(c => c.groupId === 'harvest_failing')).toBe(true);
    });
});

describe('Harvests — saves and determinism', () => {
    it('round-trips through a save, and an older save without harvests sows on the next day', () => {
        const g = newGame(101);
        for (let d = 0; d < 70; d++) { keep(g); endDay(g); }
        const before = JSON.stringify(g.world.harvests);
        const town = g.world.getSettlementViews()[0];
        const farm = JSON.stringify(live(g.world, town).farm);
        const g2 = roundTrip(g);
        expect(JSON.stringify(g2.world.harvests)).toBe(before);
        expect(JSON.stringify(live(g2.world, town).farm)).toBe(farm);
        expect(JSON.stringify(g2.player.harvests)).toBe(JSON.stringify(g.player.harvests));
        // Backfill: no harvests in the save
        const data = JSON.parse(JSON.stringify({ world: SaveLoad.serializeWorld(g.world) }));
        delete data.world.harvests;
        const w3 = g2.world;
        SaveLoad.restoreWorld(data.world, w3);
        expect(w3.harvests.cur).toBe(null);
        w3.day += 1;
        Harvests.processDay(w3, null);
        expect(w3.harvests.cur).toBeTruthy();
        expect(w3.harvests.cur.settled).toBe(true); // joined after the reckoning: no harvest to reckon this year
        expect(Harvests.grainFactor(live(w3, town))).toBeGreaterThan(0);
    });

    it('draws nothing from the game\'s RNG and repeats exactly', () => {
        const a = newGame(404);
        Utils.setSeed(9);
        const r0 = [Utils.random(), Utils.random()];
        Utils.setSeed(9);
        runHarvests(a.world, 2, 2 * Y + 105);
        expect([Utils.random(), Utils.random()]).toEqual(r0);
        const b = newGame(404);
        runHarvests(b.world, 2, 2 * Y + 105);
        expect(JSON.stringify(b.world.harvests)).toBe(JSON.stringify(a.world.harvests));
    });
});

describe('Harvests — survival guard', () => {
    it('bad years hurt without collapsing the realms (seed 7, 250 days, the player kept fed)', () => {
        const g = newGame(7);
        const pop0 = g.world.getAllSettlements().reduce((a, s) => a + (s.population || 0), 0);
        for (let d = 0; d < 250; d++) { keep(g); endDay(g); }
        const w = g.world;
        const alive = w.kingdoms.filter(k => k.isAlive !== false).length;
        const pop = w.getAllSettlements().reduce((a, s) => a + (s.population || 0), 0);
        expect(alive).toBeGreaterThanOrEqual(8);
        expect(pop).toBeGreaterThan(pop0 * 0.95);
        // ...and the years did differ
        const ys = w.harvests.past.flatMap(p => Object.values(p.out).map(o => o.y));
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.2);
    }, 120000);
});

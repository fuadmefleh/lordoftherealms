// The player's own fields (systems/crops.js, data/crops.json): tilled cells
// kept on the player by hex, sowing only on tilled ground with seed in
// season, growth per world day by rain or watering, wilting, frost, ripe
// harvest and rot; saved with the player and laid back on a regenerated
// inner map (world/innerMap/farmPlots.js); seed sold at market.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Crops } from '../systems/crops.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { InnerMap } from '../world/innerMap.js';
import { Economy } from '../world/economy.js';
import { Trading } from '../player/playerEconomy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

beforeAll(async () => {
    if (!DataLoader._gamedata || !DataLoader._gamedata.crops) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const W = { q: 4, r: 7 };

/** A world whose weather and season the test sets. */
function makeWorld({ day = 10, season = 'Spring', weather = 'clear' } = {}) {
    return {
        day, season,
        weather: { getWeather: () => ({ type: weather, intensity: 1 }) },
        getTile: () => null,
    };
}

function makePlayer(inv = {}) {
    return { inventory: { ...inv }, skills: {}, maxInventory: 20 };
}

/** Advance the world one day and run the crops' day. */
function nextDay(world, player, weather = null) {
    world.day += 1;
    if (weather) world.weather = { getWeather: () => ({ type: weather, intensity: 1 }) };
    return Crops.processDay(world, player);
}

describe('data', () => {
    it('defines crops whose seeds and products are real goods', () => {
        const goods = DataLoader._gamedata.playerEconomy.GOODS;
        const list = Crops.list();
        expect(list.length).toBeGreaterThanOrEqual(6);
        for (const c of list) {
            expect(goods[c.seed.toUpperCase()], c.seed).toBeTruthy();
            expect(goods[c.product.toUpperCase()], c.product).toBeTruthy();
            expect(c.art.stages.length).toBe(3);
            expect(Array.isArray(c.art.ripe)).toBe(true);
            expect(Crops.growDays(c)).toBeGreaterThan(0);
            expect(c.sow.length).toBeGreaterThan(0);
        }
    });

    it('draws only art that exists', () => {
        const C = Crops.config();
        for (const p of Object.values(C.sheets)) {
            expect(fs.existsSync(path.resolve(__dirname, '../..', p)), p).toBe(true);
        }
    });
});

describe('tilling and planting', () => {
    let world, player;
    beforeEach(() => {
        world = makeWorld();
        player = makePlayer({ cabbage_seed: 3, carrot_seed: 1, turnip_seed: 2 });
    });

    it('only sows on tilled ground', () => {
        const res = Crops.plant(player, world, W.q, W.r, 10, 10, 'cabbage');
        expect(res.ok).toBe(false);
        expect(player.inventory.cabbage_seed).toBe(3);
        expect(Crops.markTilled(player, W.q, W.r, 10, 10).ok).toBe(true);
        expect(Crops.plant(player, world, W.q, W.r, 10, 10, 'cabbage').ok).toBe(true);
    });

    it('consumes one seed, and the last seed empties the stack', () => {
        Crops.markTilled(player, W.q, W.r, 1, 1);
        Crops.markTilled(player, W.q, W.r, 2, 1);
        Crops.plant(player, world, W.q, W.r, 1, 1, 'carrot');
        expect(player.inventory.carrot_seed).toBeUndefined();
        const again = Crops.plant(player, world, W.q, W.r, 2, 1, 'carrot');
        expect(again.ok).toBe(false);
        expect(again.reason).toMatch(/no carrots seed/i);
    });

    it('refuses a sown cell and seed out of season', () => {
        Crops.markTilled(player, W.q, W.r, 1, 1);
        Crops.plant(player, world, W.q, W.r, 1, 1, 'cabbage');
        expect(Crops.plant(player, world, W.q, W.r, 1, 1, 'cabbage').ok).toBe(false);
        Crops.markTilled(player, W.q, W.r, 3, 3);
        const summer = makeWorld({ season: 'Summer' });
        const r = Crops.canPlant(player, summer, W.q, W.r, 3, 3, 'turnip');
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/Spring or Autumn/);
        const held = Crops.seedsHeld(player, 'Summer');
        expect(held.find(s => s.seed === 'turnip_seed').inSeason).toBe(false);
        expect(held.find(s => s.seed === 'cabbage_seed').inSeason).toBe(true);
    });

    it('caps the tilled cells of one hex', () => {
        const cap = Crops.config().maxCellsPerHex;
        for (let i = 0; i < cap; i++) expect(Crops.markTilled(player, W.q, W.r, i, 0).ok).toBe(true);
        expect(Crops.markTilled(player, W.q, W.r, 0, 1).ok).toBe(false);
        // ...another hex has its own room
        expect(Crops.markTilled(player, W.q + 1, W.r, 0, 1).ok).toBe(true);
    });
});

describe('growing', () => {
    let world, player;
    beforeEach(() => {
        world = makeWorld();
        player = makePlayer({ cabbage_seed: 5, strawberry_seed: 5, wheat_seed: 5, turnip_seed: 5 });
        Crops.markTilled(player, W.q, W.r, 5, 5);
    });

    it('ripens in its grow days of rain, through the stages', () => {
        Crops.plant(player, world, W.q, W.r, 5, 5, 'cabbage');
        const cell = Crops.cell(player, W.q, W.r, 5, 5);
        const total = Crops.growDays(Crops.crop('cabbage'));
        expect(Crops.status(cell).phase).toBe('sown');
        const seen = new Set();
        let ripened = null;
        for (let d = 0; d < total; d++) {
            const res = nextDay(world, player, 'rain');
            const s = Crops.status(cell);
            seen.add(s.phase === 'growing' ? `g${s.artIndex}` : s.phase);
            if (res.notices.some(n => n.title === 'Crops Ripe')) ripened = d + 1;
        }
        expect(Crops.status(cell).phase).toBe('ripe');
        expect(ripened).toBe(total);
        expect(seen.has('g0') && seen.has('g1') && seen.has('g2')).toBe(true);
    });

    it('grows half as fast on dry days, and watering counts as rain', () => {
        Crops.plant(player, world, W.q, W.r, 5, 5, 'cabbage');
        const cell = Crops.cell(player, W.q, W.r, 5, 5);
        nextDay(world, player, 'clear');
        expect(cell.growth).toBe(0.5);
        expect(cell.dry).toBe(1);
        expect(Crops.water(player, W.q, W.r, 5, 5).ok).toBe(true);
        expect(Crops.water(player, W.q, W.r, 5, 5).ok).toBe(false); // already watered today
        expect(Crops.describe(cell)).toMatch(/watered today/);
        nextDay(world, player, 'clear');
        expect(cell.growth).toBe(1.5);
        expect(cell.dry).toBe(0);
        expect(cell.watered).toBe(false);
        expect(cell.wetDays).toBe(1);
    });

    it('does not count the same day twice', () => {
        Crops.plant(player, world, W.q, W.r, 5, 5, 'cabbage');
        const cell = Crops.cell(player, W.q, W.r, 5, 5);
        nextDay(world, player, 'rain');
        Crops.processDay(world, player);
        expect(cell.growth).toBe(1);
    });

    it('wilts after too many dry days in a row', () => {
        Crops.plant(player, world, W.q, W.r, 5, 5, 'strawberry');
        const cell = Crops.cell(player, W.q, W.r, 5, 5);
        const tol = Crops.config().dryTolerance.high;
        let wilted = false;
        for (let d = 0; d <= tol; d++) wilted = nextDay(world, player, 'clear').notices.some(n => n.title === 'Crops Wilted') || wilted;
        expect(cell.dead).toBe('wilted');
        expect(wilted).toBe(true);
        expect(Crops.status(cell).phase).toBe('dead');
        expect(Crops.harvest(player, W.q, W.r, 5, 5).ok).toBe(false);
        expect(Crops.clear(player, W.q, W.r, 5, 5).ok).toBe(true);
        expect(Crops.status(cell).phase).toBe('tilled');
    });

    it('winter frost kills a tender crop but not a hardy one', () => {
        Crops.markTilled(player, W.q, W.r, 6, 5);
        Crops.plant(player, world, W.q, W.r, 5, 5, 'wheat');
        world.season = 'Autumn';
        Crops.plant(player, world, W.q, W.r, 6, 5, 'turnip');
        world.season = 'Winter';
        const res = nextDay(world, player, 'snow');
        expect(Crops.cell(player, W.q, W.r, 5, 5).dead).toBe('frost');
        const turnip = Crops.cell(player, W.q, W.r, 6, 5);
        expect(turnip.dead).toBeNull();
        expect(turnip.growth).toBe(Crops.config().winterGrowth);
        expect(res.notices.some(n => n.title === 'Frost')).toBe(true);
    });

    it('keeps growing while the player is away (any hex, every day)', () => {
        Crops.markTilled(player, 30, 40, 1, 1);
        Crops.plant(player, world, 30, 40, 1, 1, 'turnip');
        for (let d = 0; d < 3; d++) nextDay(world, player, 'rain');
        expect(Crops.cell(player, 30, 40, 1, 1).growth).toBe(3);
    });

    it('rots in the ground when left ripe too long', () => {
        Crops.plant(player, world, W.q, W.r, 5, 5, 'turnip');
        const cell = Crops.cell(player, W.q, W.r, 5, 5);
        const total = Crops.growDays(Crops.crop('turnip'));
        for (let d = 0; d < total; d++) nextDay(world, player, 'rain');
        expect(Crops.isRipe(cell)).toBe(true);
        const spoil = Crops.config().spoilDays;
        for (let d = 0; d < spoil; d++) nextDay(world, player, 'clear');
        expect(cell.dead).toBeNull(); // ripe crops don't thirst
        const res = nextDay(world, player, 'clear');
        expect(cell.dead).toBe('spoiled');
        expect(res.notices.some(n => n.title === 'Crops Rotted')).toBe(true);
    });

    it('does nothing for a dead player or no fields', () => {
        expect(Crops.processDay(world, null).notices).toEqual([]);
        expect(Crops.processDay(world, makePlayer()).notices).toEqual([]);
    });
});

describe('harvest', () => {
    function ripen(player, world, cropId, weather = 'rain') {
        Crops.markTilled(player, W.q, W.r, 2, 2);
        Crops.plant(player, world, W.q, W.r, 2, 2, cropId);
        let guard = 0;
        while (!Crops.isRipe(Crops.cell(player, W.q, W.r, 2, 2)) && guard++ < 60) {
            if (weather === 'water') Crops.water(player, W.q, W.r, 2, 2);
            nextDay(world, player, weather === 'water' ? 'clear' : weather);
        }
        return Crops.cell(player, W.q, W.r, 2, 2);
    }

    it('gives the product in its yield range and leaves tilled soil', () => {
        Utils.setSeed(7);
        const world = makeWorld();
        const player = makePlayer({ cabbage_seed: 1 });
        ripen(player, world, 'cabbage');
        expect(Crops.harvest(player, W.q, W.r, 9, 9).ok).toBe(false);
        const res = Crops.harvest(player, W.q, W.r, 2, 2);
        expect(res.ok).toBe(true);
        expect(res.good).toBe('vegetables');
        const [lo, hi] = Crops.crop('cabbage').yield;
        expect(res.qty).toBeGreaterThanOrEqual(lo);
        expect(res.qty).toBeLessThanOrEqual(hi);
        expect(player.inventory.vegetables).toBe(res.qty);
        const cell = Crops.cell(player, W.q, W.r, 2, 2);
        expect(cell).toEqual({ crop: null });
        expect(Crops.status(cell).phase).toBe('tilled');
    });

    it('refuses before it is ripe', () => {
        const world = makeWorld();
        const player = makePlayer({ cabbage_seed: 1 });
        Crops.markTilled(player, W.q, W.r, 2, 2);
        Crops.plant(player, world, W.q, W.r, 2, 2, 'cabbage');
        nextDay(world, player, 'rain');
        expect(Crops.harvest(player, W.q, W.r, 2, 2).ok).toBe(false);
    });

    it('yields more for care and farming skill', () => {
        const C = Crops.config();
        const cared = { crop: 'wheat', days: 10, wetDays: 10, growth: 16 };
        const neglected = { crop: 'wheat', days: 20, wetDays: 0, growth: 16 };
        const sum = (player, cell) => {
            Utils.setSeed(3);
            let s = 0;
            for (let i = 0; i < 200; i++) s += Crops.yieldFor(player, cell);
            return s;
        };
        const novice = makePlayer();
        const farmer = { ...makePlayer(), skills: { farming: 5 } };
        expect(sum(novice, cared)).toBeGreaterThan(sum(novice, neglected));
        expect(sum(farmer, cared)).toBeGreaterThan(sum(novice, cared));
        expect(C.careFloor).toBeGreaterThan(0);
        // the neglected crop still yields something
        expect(Crops.yieldFor(novice, neglected)).toBeGreaterThanOrEqual(1);
    });

    it('keeps the crop when the packs are full', () => {
        const world = makeWorld();
        const player = makePlayer({ cabbage_seed: 1 });
        ripen(player, world, 'cabbage', 'water');
        player.maxInventory = 0;
        const res = Crops.harvest(player, W.q, W.r, 2, 2);
        expect(res.ok).toBe(false);
        expect(res.full).toBe(true);
        expect(Crops.isRipe(Crops.cell(player, W.q, W.r, 2, 2))).toBe(true);
    });
});

describe('persistence', () => {
    it('round-trips player.farmPlots through save/load', () => {
        const world = makeWorld();
        const p = new Player();
        p.inventory = { cabbage_seed: 2 };
        Crops.markTilled(p, W.q, W.r, 3, 4);
        Crops.markTilled(p, W.q, W.r, 3, 5);
        Crops.plant(p, world, W.q, W.r, 3, 4, 'cabbage');
        nextDay(world, p, 'rain');
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.farmPlots).toEqual(p.farmPlots);
        expect(Crops.cell(back, W.q, W.r, 3, 4).growth).toBe(1);
        expect(Crops.cell(back, W.q, W.r, 3, 5)).toEqual({ crop: null });
    });

    it('lays tilled cells back on a regenerated inner map, and lets go of lost ground', () => {
        const INNER = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/innerMap.json'), 'utf-8'));
        InnerMap.initialize(INNER);
        InnerMap._cache = {};
        const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
        const player = makePlayer({ cabbage_seed: 1 });
        const game = { world: { getTile: () => worldTile, season: 'Spring', day: 3 }, player };
        InnerMap.enter(game, W.q, W.r);
        // Two open cells, and one we'll later build over
        const open = InnerMap.tiles.flat().filter(t => t.subTerrain && t.subTerrain.passable && !t._wet && !t.isRoad && !t.customObject && !t.customObjectPart && !t.building).slice(0, 3);
        expect(open.length).toBe(3);
        for (const t of open) {
            Crops.markTilled(player, W.q, W.r, t.q, t.r);
            InnerMap.setTilled(t);
        }
        Crops.plant(player, game.world, W.q, W.r, open[0].q, open[0].r, 'cabbage');
        InnerMap.exit(game);

        // The cache is lost (a save, a cleared cache): the map is drawn afresh
        InnerMap.clearCache();
        const fresh = InnerMap.getOrGenerate(worldTile, W.q, W.r, game);
        expect(fresh[open[0].r][open[0].q].subTerrain.id).not.toBe('tilled_soil');
        fresh[open[2].r][open[2].q].isRoad = true; // a street through the third
        InnerMap.enter(game, W.q, W.r);
        expect(InnerMap.tiles).toBe(fresh);
        for (const t of open.slice(0, 2)) {
            const tile = InnerMap.getTile(t.q, t.r);
            expect(tile.subTerrain.id).toBe('tilled_soil');
            expect(tile._tilled).toBe(true);
        }
        expect(Crops.cell(player, W.q, W.r, open[0].q, open[0].r).crop).toBe('cabbage');
        expect(Crops.cell(player, W.q, W.r, open[2].q, open[2].r)).toBeNull();
        expect(Crops.cellCount(player, W.q, W.r)).toBe(2);
        expect(InnerMap._farmOwner).toBe(player);
        InnerMap.exit(game);
    });
});

describe('seed at market', () => {
    it('every settlement lists seed; towns more kinds than villages', () => {
        const village = Economy.marketGoods({ type: 'village', population: 300 }, null).map(g => g.key);
        const town = Economy.marketGoods({ type: 'town', population: 3000 }, null).map(g => g.key);
        expect(village).toContain('WHEAT_SEED');
        expect(village).toContain('CABBAGE_SEED');
        expect(village).not.toContain('STRAWBERRY_SEED');
        for (const c of Crops.list()) expect(town).toContain(c.seed.toUpperCase());
    });

    it('seed can be bought from a town market', () => {
        const s = { name: 'Seedham', type: 'town', population: 3000 };
        const goods = Trading.getAvailableGoods(s, null, null);
        const seed = goods.find(g => g.id === 'cabbage_seed');
        expect(seed).toBeTruthy();
        expect(seed.quantity).toBeGreaterThan(0);
        expect(seed.price).toBeGreaterThan(0);
        const player = new Player();
        player.gold = 500;
        player.inventory = {};
        const res = Trading.buyGoods(player, seed, 3, s);
        expect(res.success).toBe(true);
        expect(player.inventory.cabbage_seed).toBe(3);
    });

    it('foraging can turn up seed', () => {
        const forage = DataLoader._gamedata.earlyJobs.foraging.loot_table;
        const items = Object.values(forage).flat().map(e => e.item);
        expect(items.some(id => Crops.isSeed(id))).toBe(true);
    });
});

describe('the inner-map menu and art (ui/innerMapFarming.js)', () => {
    const INNER = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/innerMap.json'), 'utf-8'));
    const open = (x) => x.subTerrain && x.subTerrain.passable && !x._wet && !x.isRoad && !x.customObject && !x.customObjectPart && !x.building && !x.groundItem;

    it('offers Till Land on open ground, then planting, watering and harvest', async () => {
        const { InnerMapFarming } = await import('../ui/innerMapFarming.js');
        InnerMap.initialize(INNER());
        InnerMap._cache = {};
        const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
        const player = makePlayer({ cabbage_seed: 2, turnip_seed: 1 });
        const world = { getTile: () => worldTile, season: 'Summer', day: 3 };
        const game = { world, player };
        InnerMap.enter(game, 9, 9);
        world.weather = { getWeather: () => ({ type: 'clear' }) };
        const t = InnerMap.tiles.flat().find(x => open(x) && (x.q !== InnerMap.playerInnerQ || x.r !== InnerMap.playerInnerR));
        const acts = (items) => items.filter(i => i.type === 'action').map(i => i.action);
        expect(acts(InnerMapFarming.menuItems(game, t, t.q, t.r))).toEqual(['farm_till']);

        Crops.markTilled(player, 9, 9, t.q, t.r);
        InnerMap.setTilled(t);
        const sow = InnerMapFarming.menuItems(game, t, t.q, t.r);
        expect(acts(sow)).toContain('farm_plant');
        // turnips are not sown in summer: shown, but greyed out
        expect(sow.some(i => i.type === 'disabled' && /Turnips/.test(i.label))).toBe(true);

        Crops.plant(player, world, 9, 9, t.q, t.r, 'cabbage');
        expect(acts(InnerMapFarming.menuItems(game, t, t.q, t.r))).toContain('farm_clear');
        const cell = Crops.cell(player, 9, 9, t.q, t.r);
        cell.growth = Crops.growDays(Crops.crop('cabbage'));
        expect(acts(InnerMapFarming.menuItems(game, t, t.q, t.r))).toContain('farm_harvest');

        // The art: sown mound, each stage, ripe — all cells on the sheets
        const C = Crops.config();
        for (const g of [0, 1, 4, 8, 12]) {
            cell.growth = g;
            const art = InnerMapFarming.artFor(Crops.status(cell));
            expect(art && art.sheet).toBe(g === 0 ? C.sheets.crops : C.sheets[Crops.crop('cabbage').art.sheet]);
            expect(art.c).toBeGreaterThanOrEqual(0);
        }
        InnerMap.exit(game);
    });

    it('refuses to till a street in town', async () => {
        const { InnerMapFarming } = await import('../ui/innerMapFarming.js');
        InnerMap.initialize(INNER());
        InnerMap._cache = {};
        const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement: { name: 'Testby', type: 'village', population: 300 } };
        const game = { world: { getTile: () => worldTile, season: 'Spring', day: 1 }, player: makePlayer() };
        InnerMap.enter(game, 5, 6);
        const road = InnerMap.tiles.flat().find(x => x.isRoad);
        expect(road).toBeTruthy();
        expect(InnerMapFarming.canTill(game, road, road.q, road.r).ok).toBe(false);
        // the verge beside the street is town ground
        const verge = InnerMap.tiles.flat().find(x => open(x) && !x._lot && Math.abs(x.q - road.q) + Math.abs(x.r - road.r) === 1);
        if (verge) expect(InnerMapFarming.canTill(game, verge, verge.q, verge.r).ok).toBe(false);
        InnerMap.exit(game);
    });
});

describe('the clock for work in person (InnerMap.passHours)', () => {
    it('keeps the hour whole and carries minutes in the accumulator', () => {
        InnerMap.timeOfDay = 10;
        InnerMap._timeAccumulator = InnerMap.TIME_SCALE * 0.75; // 10:45
        InnerMap.passHours(20 / 60);
        expect(InnerMap.timeOfDay).toBe(11);
        expect(Math.round(InnerMap._timeAccumulator / InnerMap.TIME_SCALE * 60)).toBe(5);
    });
    it('heals a fractional hour and stops at 11:59 PM', () => {
        InnerMap.timeOfDay = 10 + 1 / 3;
        InnerMap._timeAccumulator = 0;
        InnerMap.passHours(0.5);
        expect(InnerMap.timeOfDay).toBe(10);
        expect(Math.round(InnerMap._timeAccumulator / InnerMap.TIME_SCALE * 60)).toBe(50);
        InnerMap.passHours(30);
        expect(InnerMap.timeOfDay).toBe(23);
        expect(Math.round(InnerMap._timeAccumulator / InnerMap.TIME_SCALE * 60)).toBe(59);
    });
});

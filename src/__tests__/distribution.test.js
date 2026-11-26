/**
 * Distribution plans (player/distribution.js): a property's daily output is
 * split by shares in whole units (fractions carried), moved at once on the
 * same hex, else carried by hired carters who are paid in their home town,
 * take days by the way, pay the tolls of the realm entered, deliver into a
 * workshop's inputs or sell at a market out of its purse; a full destination
 * keeps the goods waiting and then sends them back; it all saves.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Distribution } from '../player/distribution.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Utils } from '../core/utils.js';
import { loadData } from './playtest/harness.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    await loadData();
});

const GRASS = { id: 'grassland', name: 'Grassland', passable: true, moveCost: 1 };

function town(name, extra = {}) {
    const s = { name, type: 'town', population: 2000, happiness: 50, ...extra };
    SettlementMarket.ensure(s);
    s.economy = { gold: 20000 };
    return s;
}

function makeWorld(towns, { W = 40, H = 20, realm = () => null, kingdoms = [] } = {}) {
    const tiles = new Map();
    return {
        width: W, height: H, day: 10, units: [], events: [], kingdoms,
        getTile(q, r) {
            if (r < 0 || r >= H) return null;
            q = ((q % W) + W) % W;
            const key = `${q},${r}`;
            if (!tiles.has(key)) {
                const s = towns[key] || null;
                if (s) s.kingdom = realm(q, r);
                tiles.set(key, { q, r, terrain: GRASS, settlement: s, kingdom: realm(q, r), regionId: 1 });
            }
            return tiles.get(key);
        },
        getSettlementViews() {
            return Object.entries(towns).map(([k, s]) => { const [q, r] = k.split(',').map(Number); return { q, r, name: s.name }; });
        },
        getKingdom(id) { return kingdoms.find(k => k.id === id) || null; },
    };
}

const mkPlayer = (extra = {}) => ({ name: 'Tester', q: 5, r: 5, gold: 5000, inventory: {}, maxInventory: 99, skills: { commerce: 0 }, properties: [], ...extra });

/** Put a finished property of `type` on a tile (and on the player's books). */
function own(player, world, q, r, type, extra = {}) {
    const def = PlayerEconomy.getPropertyDef(type);
    const tile = world.getTile(q, r);
    const p = { type, name: def.name, produces: def.produces, productionRate: def.productionRate, upkeep: 0, level: 1, daysOwned: 1, storage: 0, inputStorage: 0, activeRecipe: null, ...extra };
    tile.playerProperties = [...(tile.playerProperties || []), p];
    tile.playerProperty = tile.playerProperties[0];
    player.properties.push({ q, r, type, name: def.name, produces: def.produces });
    return p;
}

/** A day's output: what produceGoods leaves behind (n stored today). */
function makes(world, prop, n) {
    prop.storage = (prop.storage || 0) + n;
    prop.lastOutput = n;
    prop.lastGood = Distribution.goodOf(prop);
    prop.outputDay = world.day;
}

function day(world, player, prop, n) {
    world.day++;
    if (prop) makes(world, prop, n);
    return Distribution.processDay(world, player);
}

describe('Shares and the rest', () => {
    it('splits whole units, carrying each share\'s fraction, so 10% of 3 a day comes right over time', () => {
        const legs = [{ carry: 0 }, { carry: 0 }, { carry: 0 }];
        const tot = [0, 0, 0];
        for (let d = 0; d < 100; d++) {
            const got = Distribution.apportion(legs, [10, 50, 40], 3);
            expect(got.reduce((a, n) => a + n, 0)).toBe(3);
            got.forEach((n, i) => { tot[i] += n; });
            for (const l of legs) expect(Math.abs(l.carry)).toBeLessThan(1);
        }
        expect(tot).toEqual([30, 150, 120]);
    });

    it('will not share out more than the whole', () => {
        const s = town('Hempton');
        const world = makeWorld({ '5,5': s, '12,5': town('Ropeford') });
        const player = mkPlayer();
        own(player, world, 5, 5, 'hemp_farm');
        own(player, world, 12, 5, 'rope_walk', { activeRecipe: 'ROPE' });
        const plan = Distribution.ensurePlan(player, world, 5, 5, 'hemp_farm').plan;
        expect(plan.good).toBe('hemp');
        expect(Distribution.addShare(player, world, plan.id, { kind: 'property', q: 12, r: 5, type: 'rope_walk' }, 60).success).toBe(true);
        const r = Distribution.addShare(player, world, plan.id, { kind: 'market', q: 12, r: 5 }, 50);
        expect(r.success).toBe(false);
        expect(r.reason).toMatch(/40%/);
    });
});

describe('Moving the goods', () => {
    it('moves a share to a workshop on the same hex at once, with no carriage', () => {
        const s = town('Hempton');
        const world = makeWorld({ '5,5': s });
        const player = mkPlayer();
        const farm = own(player, world, 5, 5, 'hemp_farm');
        const walk = own(player, world, 5, 5, 'rope_walk', { activeRecipe: 'ROPE' });
        const plan = Distribution.ensurePlan(player, world, 5, 5, 'hemp_farm').plan;
        Distribution.addShare(player, world, plan.id, { kind: 'property', q: 5, r: 5, type: 'rope_walk' }, 50);
        const gold0 = player.gold;
        day(world, player, farm, 10);
        expect(walk.inputStorage).toBe(5);
        expect(farm.storage).toBe(5);
        expect(player.gold).toBe(gold0);
        expect(Distribution.inTransit(player).length).toBe(0);
    });

    it('sends the carters: days by the way, carriage paid to the source town, delivered on arrival', () => {
        const home = town('Hempton');
        const world = makeWorld({ '5,5': home });
        const player = mkPlayer();
        const farm = own(player, world, 5, 5, 'hemp_farm');
        const walk = own(player, world, 15, 5, 'rope_walk', { activeRecipe: 'ROPE' });
        const plan = Distribution.ensurePlan(player, world, 5, 5, 'hemp_farm').plan;
        Distribution.addShare(player, world, plan.id, { kind: 'property', q: 15, r: 5, type: 'rope_walk' }, 50);
        Distribution.setBatch(player, plan.id, 'load', 10);
        const coin0 = player.gold + home.economy.gold;
        // 5 a day to the rope walk: nothing goes until 10 have gathered
        day(world, player, farm, 10);
        expect(Distribution.inTransit(player).length).toBe(0);
        expect(plan.shares[0].pending).toBe(5);
        day(world, player, farm, 10);
        const [c] = Distribution.inTransit(player);
        expect(c.qty).toBe(10);
        expect(c.arriveDay - c.departDay).toBeGreaterThan(1);
        expect(c.cost).toBeGreaterThan(0);
        expect(home.economy.gold).toBeCloseTo(20000 + c.cost, 2);
        expect(player.gold + home.economy.gold).toBeCloseTo(coin0, 2);
        expect(farm.storage).toBe(10);
        // On the road until the day it arrives
        while (world.day < c.arriveDay - 1) day(world, player, null, 0);
        expect(walk.inputStorage).toBe(0);
        day(world, player, null, 0);
        expect(walk.inputStorage).toBe(10);
        expect(plan.shares[0].delivered).toBe(10);
        expect(Distribution.inTransit(player).length).toBe(0);
    });

    it('a road makes the carriage cheaper and quicker', () => {
        const world = makeWorld({ '5,5': town('A') });
        const open = Distribution.route(world, { q: 5, r: 5 }, { q: 15, r: 5 });
        for (let q = 5; q <= 15; q++) { const t = world.getTile(q, 5); t.hasRoad = true; t.infrastructure = { type: 'road', id: 'road' }; }
        const road = Distribution.route(world, { q: 5, r: 5 }, { q: 15, r: 5 });
        expect(road.days).toBeLessThanOrEqual(open.days);
        expect(Distribution.carriage('hemp', 20, road)).toBeLessThanOrEqual(Distribution.carriage('hemp', 20, open));
    });

    it('pays the tolls of the realm entered into its treasury', () => {
        const k1 = { id: 'k1', name: 'Westmark', treasury: 0, isAlive: true };
        const k2 = { id: 'k2', name: 'Eastreach', treasury: 0, isAlive: true };
        const world = makeWorld({ '5,5': town('Hempton'), '15,5': town('Ropeford') }, { realm: (q) => (q < 10 ? 'k1' : 'k2'), kingdoms: [k1, k2] });
        const player = mkPlayer();
        const farm = own(player, world, 5, 5, 'hemp_farm');
        own(player, world, 15, 5, 'rope_walk', { activeRecipe: 'ROPE' });
        const plan = Distribution.ensurePlan(player, world, 5, 5, 'hemp_farm').plan;
        Distribution.addShare(player, world, plan.id, { kind: 'property', q: 15, r: 5, type: 'rope_walk' }, 100);
        Distribution.setBatch(player, plan.id, 'daily');
        day(world, player, farm, 40);
        const [c] = Distribution.inTransit(player);
        const gold = player.gold;
        while (world.day < c.arriveDay) day(world, player, null, 0);
        expect(k2.treasury).toBeGreaterThan(0);
        expect(player.gold).toBeCloseTo(gold - k2.treasury, 2);
        expect(plan.shares[0].tolls).toBe(k2.treasury);
    });
});

describe('Where it is bound', () => {
    it('a full workshop keeps the goods in store; one filled on the way keeps them waiting, then sends them back', () => {
        const home = town('Hempton');
        const world = makeWorld({ '5,5': home, '15,5': town('Ropeford') });
        const player = mkPlayer();
        const farm = own(player, world, 5, 5, 'hemp_farm');
        const walk = own(player, world, 15, 5, 'rope_walk', { activeRecipe: 'ROPE' });
        const cap = PlayerEconomy.getStorageCapacity(player, walk);
        const plan = Distribution.ensurePlan(player, world, 5, 5, 'hemp_farm').plan;
        Distribution.addShare(player, world, plan.id, { kind: 'property', q: 15, r: 5, type: 'rope_walk' }, 100);
        Distribution.setBatch(player, plan.id, 'daily');
        walk.inputStorage = cap;
        day(world, player, farm, 8);
        expect(Distribution.inTransit(player).length).toBe(0);
        expect(plan.shares[0].warn).toMatch(/full/);
        expect(farm.storage).toBe(8);
        // Room again: off it goes — and the store fills before it arrives
        walk.inputStorage = 0;
        day(world, player, farm, 0);
        const [c] = Distribution.inTransit(player);
        expect(c.qty).toBe(8);
        walk.inputStorage = cap;
        while (world.day < c.arriveDay) day(world, player, null, 0);
        expect(c.status).toBe('waiting');
        expect(farm.storage).toBe(0);
        const back = { notices: [] };
        while (c.status === 'waiting') back.notices.push(...day(world, player, null, 0).notices);
        expect(c.status).toBe('return');
        expect(back.notices.some(n => n.title === 'Consignment Returned')).toBe(true);
        while (!c.done) day(world, player, null, 0);
        expect(farm.storage).toBe(8);
        expect(walk.inputStorage).toBe(cap);
    });

    it('sells at a market town out of its purse, into its stock, and books it', () => {
        const home = town('Hempton');
        const mkt = town('Markby');
        const world = makeWorld({ '5,5': home, '12,5': mkt });
        const player = mkPlayer();
        const farm = own(player, world, 5, 5, 'hemp_farm');
        const plan = Distribution.ensurePlan(player, world, 5, 5, 'hemp_farm').plan;
        Distribution.setRest(player, world, plan.id, { kind: 'market', q: 12, r: 5 });
        Distribution.setBatch(player, plan.id, 'daily');
        const coin0 = player.gold + home.economy.gold + mkt.economy.gold;
        const stock0 = SettlementMarket.stock(mkt, 'hemp');
        day(world, player, farm, 12);
        const [c] = Distribution.inTransit(player);
        const goldOut = player.gold;
        while (!c.done) day(world, player, null, 0);
        expect(player.gold).toBeGreaterThan(goldOut);
        expect(SettlementMarket.stock(mkt, 'hemp')).toBe(stock0 + 12);
        expect(mkt.economy.gold).toBeLessThan(20000);
        expect(plan.rest.earned).toBeGreaterThan(0);
        // Coin only changes hands: the player, the carters' town and the market
        expect(player.gold + home.economy.gold + mkt.economy.gold).toBeCloseTo(coin0, 1);
    });

    it('10% to a store-room, 50% to the rope walk, the rest sold: every unit accounted for', () => {
        Utils.setSeed(3);
        const home = town('Hempton');
        const mkt = town('Markby');
        const world = makeWorld({ '5,5': home, '12,5': mkt });
        const player = mkPlayer();
        player.merchantPrince = { warehouses: [{ id: 1, q: 5, r: 5, town: 'Hempton', size: 'small', goods: {}, since: 0, nextRent: 99, unpaid: 0, arrears: 0 }] };
        const farm = own(player, world, 5, 5, 'hemp_farm');
        const walk = own(player, world, 9, 5, 'rope_walk', { activeRecipe: 'ROPE' });
        const plan = Distribution.ensurePlan(player, world, 5, 5, 'hemp_farm').plan;
        expect(Distribution.addShare(player, world, plan.id, { kind: 'warehouse', id: 1, q: 5, r: 5 }, 10).success).toBe(true);
        expect(Distribution.addShare(player, world, plan.id, { kind: 'property', q: 9, r: 5, type: 'rope_walk' }, 50).success).toBe(true);
        Distribution.setRest(player, world, plan.id, { kind: 'market', q: 12, r: 5 });
        Distribution.setBatch(player, plan.id, 'weekly');
        const stock0 = SettlementMarket.stock(mkt, 'hemp');
        for (let d = 0; d < 40; d++) day(world, player, farm, 3);
        for (let d = 0; d < 30; d++) day(world, player, null, 0);
        const wh = player.merchantPrince.warehouses[0].goods.hemp || 0;
        const sold = SettlementMarket.stock(mkt, 'hemp') - stock0;
        const onRoad = Distribution.inTransit(player).reduce((a, c) => a + c.qty, 0);
        const gathered = plan.shares.reduce((a, s) => a + s.pending, 0) + plan.rest.pending;
        expect(wh + walk.inputStorage + sold + onRoad + farm.storage).toBe(120);
        expect(wh).toBe(12);
        expect(walk.inputStorage + plan.shares[1].pending).toBe(60);
        expect(sold + plan.rest.pending).toBe(48);
        expect(farm.storage).toBe(gathered);
    });
});

describe('Telling the player', () => {
    it('rolls the week arrivals into one notice, not one a consignment', () => {
        const world = makeWorld({ '5,5': town('Hempton'), '12,5': town('Markby') });
        const player = mkPlayer();
        const farm = own(player, world, 5, 5, 'hemp_farm');
        const plan = Distribution.ensurePlan(player, world, 5, 5, 'hemp_farm').plan;
        Distribution.setRest(player, world, plan.id, { kind: 'market', q: 12, r: 5 });
        Distribution.setBatch(player, plan.id, 'daily');
        let notices = [];
        for (let d = 0; d < 30; d++) notices = notices.concat(day(world, player, farm, 4).notices);
        const week = notices.filter(n => n.title === 'Distribution: the Week');
        expect(week.length).toBeGreaterThanOrEqual(2);
        expect(week.length).toBeLessThanOrEqual(5);
        expect(week[0].text).toMatch(/hemp fiber/);
    });
});

describe('Saving', () => {
    it('keeps plans and goods on the road through a save', () => {
        const world = makeWorld({ '5,5': town('Hempton') });
        const player = mkPlayer();
        const farm = own(player, world, 5, 5, 'hemp_farm');
        own(player, world, 15, 5, 'rope_walk', { activeRecipe: 'ROPE' });
        const plan = Distribution.ensurePlan(player, world, 5, 5, 'hemp_farm').plan;
        Distribution.addShare(player, world, plan.id, { kind: 'property', q: 15, r: 5, type: 'rope_walk' }, 30);
        Distribution.setBatch(player, plan.id, 'daily');
        day(world, player, farm, 10);
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        const p2 = Distribution.plan(back, plan.id);
        expect(p2.shares[0].pct).toBe(30);
        expect(p2.shares[0].carry).toBeCloseTo(plan.shares[0].carry, 6);
        expect(p2.batch.mode).toBe('daily');
        expect(Distribution.inTransit(back).length).toBe(1);
        expect(Distribution.inTransit(back)[0].qty).toBe(3);
    });
});

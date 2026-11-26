// The player's caravans sell only what the destination's merchants can pay
// for (player/playerEconomy/caravanSales.js): the rest is not given away but
// waits for coin, goes on to a town that can pay, or comes home; the dispatch
// shows the purse, the capped sale, the hire and the net.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Player } from '../player/player.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { SettlementMarket } from '../world/settlementMarket.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const GRASS = { id: 'grassland', name: 'Grassland', passable: true, moveCost: 1 };
const WATER = { id: 'ocean', name: 'Ocean', passable: false, moveCost: 99 };

/** A strip of grass on row 5 with towns on it: Ashford (1), Thornfield (10), Ashby (13). */
function setup({ purse = 50, ashbyPurse = null, market = true } = {}) {
    const size = 24;
    const from = { name: 'Ashford', type: 'town', population: 3000, q: 1, r: 5, economy: { gold: 1000 } };
    const to = { name: 'Thornfield', type: 'town', population: 3000, q: 10, r: 5, economy: { gold: purse } };
    const ashby = { name: 'Ashby', type: 'town', population: 3000, q: 13, r: 5, economy: { gold: ashbyPurse == null ? 0 : ashbyPurse } };
    const towns = [from, to, ashby];
    if (market) for (const t of [to, ashby]) SettlementMarket.ensure(t);
    const tiles = [];
    for (let r = 0; r < size; r++) {
        const row = [];
        for (let q = 0; q < size; q++) {
            const land = r === 5 && q < 16;
            row.push({ q, r, terrain: land ? GRASS : WATER, settlement: land ? towns.find(t => t.q === q) || null : null, resource: null });
        }
        tiles.push(row);
    }
    const world = {
        width: size, height: size, day: 1, tiles, kingdoms: [], units: [], events: [],
        getTile(q, r) { return r >= 0 && r < size ? tiles[r][((q % size) + size) % size] : null; },
        getKingdom() { return null; },
        getAllSettlements: () => towns,
    };
    const player = new Player();
    player.gold = 5000;
    player.inventory = { tools: 20 };
    return { world, player, from, to, ashby };
}

/** Run the caravans day by day until `pred` matches an event (or `days` pass). → [events] */
function run(player, world, days, pred = null) {
    const all = [];
    for (let d = 0; d < days; d++) {
        world.day++;
        for (const u of world.units) if (u.playerOwned && !u.destroyed) { u.q = u.targetQ; u.r = u.targetR; u.arrived = true; }
        const ev = PlayerEconomy.updateCaravans(player, world).filter(e => !e.eventType);
        all.push(...ev);
        if (pred && ev.some(pred)) break;
    }
    return all;
}

beforeEach(() => Utils.setSeed(11));

describe('a caravan sells what the town can pay for', () => {
    it('caps the sale at the purse and keeps the rest on the wagons', () => {
        const { world, player, from, to } = setup({ purse: 50 });
        const stock0 = SettlementMarket.stock(to, 'tools');
        const res = PlayerEconomy.startCaravan(player, { q: from.q, r: from.r, name: from.name }, to, { tools: 20 }, world, { findBuyer: false });
        expect(res.success).toBe(true);
        const gold0 = player.gold;
        const ev = run(player, world, 20, e => e.to === 'Thornfield' && e.status === 'selling');
        const arrive = ev.find(e => e.status === 'selling');
        expect(arrive).toBeTruthy();
        const c = player.caravans[0];
        const sold = (c.sold && c.sold.tools) || 0;
        expect(sold).toBeLessThan(20);
        // The town paid no more than it held; the player got what it paid
        expect(to.economy.gold).toBeGreaterThanOrEqual(0);
        expect(player.gold - gold0).toBeLessThanOrEqual(50);
        expect(player.gold - gold0 + to.economy.gold).toBeCloseTo(50, 0);
        // Only the units paid for joined the town's stock; the rest is still the player's
        expect(SettlementMarket.stock(to, 'tools') - stock0).toBeCloseTo(sold, 5);
        expect(c.goods.tools).toBe(20 - sold);
        expect(c.status).toBe('selling');
        expect(arrive.message).toMatch(/Thornfield's merchants (had only|have no coin)/);
        expect(arrive.message).toMatch(new RegExp(`${20 - sold} tools wait for coin`));
        // ...and the panel says so
        expect(PlayerEconomy.caravanStatusText(c)).toMatch(/wait for coin/);
    });

    it('waits and sells more as the purse refills, then is done', () => {
        const { world, player, from, to } = setup({ purse: 50 });
        PlayerEconomy.startCaravan(player, { q: from.q, r: from.r, name: from.name }, to, { tools: 20 }, world, { findBuyer: false });
        run(player, world, 20, e => e.status === 'selling');
        to.economy.gold += 100000;
        const ev = run(player, world, 2, e => e.status === 'completed');
        const done = ev.find(e => e.status === 'completed');
        expect(done).toBeTruthy();
        expect(done.finalProfit).toBeGreaterThan(0);
        expect(done.message).toMatch(/last \d+ tools/);
        expect(done.sold.tools).toBe(20);
        expect(player.caravans.length).toBe(0);
    });

    it('comes home with the rest when no one can pay, and nothing is lost', () => {
        const { world, player, from, to } = setup({ purse: 0 });
        PlayerEconomy.startCaravan(player, { q: from.q, r: from.r, name: from.name }, to, { tools: 20 }, world, { findBuyer: false });
        expect(player.inventory.tools).toBe(0);
        const wait = PlayerEconomy.caravanConfig().waitDays;
        const ev = run(player, world, 60, e => e.status === 'returned');
        const turn = ev.find(e => e.status === 'returning');
        expect(turn).toBeTruthy();
        expect(turn.message).toMatch(/carries them back to Ashford/);
        // It waited its days first
        const arrivedDay = ev.findIndex(e => e.status === 'selling');
        expect(ev.filter(e => e.status === 'selling').length).toBeGreaterThanOrEqual(1);
        expect(arrivedDay).toBeGreaterThanOrEqual(0);
        const home = ev.find(e => e.status === 'returned');
        expect(home).toBeTruthy();
        expect(home.message).toMatch(/back at Ashford with 20 tools unsold/);
        // Into the packs; what they cannot carry is sold at home (never left behind)
        const noRoom = home.message.match(/No room for (\d+) tools/);
        expect(player.inventory.tools + (noRoom ? Number(noRoom[1]) : 0)).toBe(20);
        expect(SettlementMarket.stock(to, 'tools')).toBeGreaterThanOrEqual(0);
        expect(wait).toBeGreaterThan(0);
    });

    it('goes on to the nearest town that can pay when allowed', () => {
        const { world, player, from, to, ashby } = setup({ purse: 0, ashbyPurse: 100000 });
        PlayerEconomy.startCaravan(player, { q: from.q, r: from.r, name: from.name }, to, { tools: 20 }, world, { findBuyer: true });
        const ev = run(player, world, 60, e => e.status === 'completed');
        const on = ev.find(e => e.status === 'onward');
        expect(on).toBeTruthy();
        expect(on.message).toMatch(/go on to Ashby/);
        const done = ev.find(e => e.status === 'completed');
        expect(done).toBeTruthy();
        expect(done.to).toBe('Ashby');
        expect(ashby.economy.gold).toBeLessThan(100000);
        expect(player.caravans.length).toBe(0);
    });

    it('a storage caravan brings what is unsold back into the property\'s store', () => {
        const { world, player, to } = setup({ purse: 0 });
        const tile = world.getTile(3, 5);
        tile.playerProperty = { type: 'farm', name: 'Your farm', produces: 'grain', storage: 30, level: 1, q: 3, r: 5 };
        const res = PlayerEconomy.startStorageCaravan(player, tile, { ...to, isPlayerProperty: false }, world, { findBuyer: false });
        expect(res.success).toBe(true);
        expect(tile.playerProperty.storage).toBe(0);
        const ev = run(player, world, 60, e => e.status === 'returned');
        expect(ev.find(e => e.status === 'returned')).toBeTruthy();
        expect(tile.playerProperty.storage).toBe(30);
    });
});

describe('the dispatch shows the real picture', () => {
    it('the destination\'s purse, the capped sale, the hire and the net', () => {
        const { world, player, from, to } = setup({ purse: 40 });
        const pv = PlayerEconomy.caravanPreview(player, world, from, to, { tools: 20 });
        expect(pv.ok).toBe(true);
        expect(pv.purse).toBe(40);
        expect(pv.purseText).toBe('~40g');
        expect(pv.payable).toBeLessThanOrEqual(40);
        expect(pv.value).toBeGreaterThan(pv.payable);
        expect(pv.sellable).toBeLessThan(20);
        expect(pv.net).toBe(pv.payable - pv.fee);
        expect(pv.warnings.join(' ')).toMatch(/enough for \d+ of 20|not enough for even one/);
        expect(pv.warnings.join(' ')).toMatch(/costs more than they can pay/);
        // A rich town pays for it all, no warning about the purse
        to.economy.gold = 100000;
        const rich = PlayerEconomy.caravanPreview(player, world, from, to, { tools: 20 });
        expect(rich.sellable).toBe(20);
        expect(rich.payable).toBe(rich.value);
        // expectedProfit on the caravan is the purse-capped figure
        const res = PlayerEconomy.startCaravan(player, { q: from.q, r: from.r, name: from.name }, to, { tools: 20 }, world);
        expect(res.caravan.expectedProfit).toBe(rich.payable);
    });

    it('the hire scales with load and distance and goes to the carters\' town', () => {
        const near = PlayerEconomy.caravanFee({ grain: 20 }, 5);
        const far = PlayerEconomy.caravanFee({ grain: 20 }, 15);
        const heavy = PlayerEconomy.caravanFee({ grain: 2000 }, 15);
        expect(far).toBeGreaterThan(near);
        expect(heavy).toBeGreaterThan(far);
        const { world, player, from, to } = setup({ purse: 100000 });
        const purse0 = from.economy.gold;
        const gold0 = player.gold;
        const res = PlayerEconomy.startCaravan(player, { q: from.q, r: from.r, name: from.name }, to, { tools: 20 }, world);
        expect(res.cost).toBe(PlayerEconomy.caravanFee({ tools: 20 }, 9));
        expect(gold0 - player.gold).toBeCloseTo(res.cost, 2);
        expect(from.economy.gold - purse0).toBeCloseTo(res.cost, 2);
    });

    it('goods without a GOODS entry (cloth) are priced as they sell, not at 0', () => {
        const { world, player, from, to } = setup({ purse: 100000 });
        player.inventory = { cloth: 10 };
        const res = PlayerEconomy.startCaravan(player, { q: from.q, r: from.r, name: from.name }, to, { cloth: 10 }, world);
        expect(res.success).toBe(true);
        expect(res.caravan.expectedProfit).toBeGreaterThan(0);
        const ev = run(player, world, 20, e => e.status === 'completed');
        const done = ev.find(e => e.status === 'completed');
        // (the dispatch's figure, before the haul's bit of commerce practice)
        expect(Math.abs(done.finalProfit - res.caravan.expectedProfit)).toBeLessThanOrEqual(Math.ceil(res.caravan.expectedProfit * 0.03));
    });
});

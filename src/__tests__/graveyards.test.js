/**
 * Graveyards and the trade in death (world/graveBook.js, world/graveArt.js,
 * world/churchyard.js, world/innerMap/graves.js, systems/graveyards.js).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Graveyards, GraveBook, GraveArt, LotBook, Lots, SaveLoad, SettlementMarket, CustomObjects;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ Graveyards } = await import('../systems/graveyards.js'));
    ({ GraveBook } = await import('../world/graveBook.js'));
    ({ GraveArt } = await import('../world/graveArt.js'));
    ({ LotBook } = await import('../world/lotBook.js'));
    ({ Lots } = await import('../systems/lots.js'));
    ({ SaveLoad } = await import('../systems/saveLoad.js'));
    ({ SettlementMarket } = await import('../world/settlementMarket.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    ({ CustomObjects } = await import('../world/customObjects.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(7);
});

const Y = 120;

function person(id, o = {}) {
    return { id, first: `P${id}`, last: 'Stoneheart', gender: 'male', born: -40 * Y, died: null, cause: null, role: 'villager', spouse: null, parents: [], kids: [], away: null, log: [], traits: [], ...o };
}

function setup(type = 'town', opts = {}) {
    const settlement = { name: `Graveby-${type}`, type, population: 2000, q: 5, r: 6, kingdom: 'k1', economy: { gold: 5000, food: 100, goods: 0, production: {} } };
    if (opts.folk !== false) {
        settlement.folk = { v: 1, q: 5, r: 6, n: 10, target: 10, tick: 0, people: Array.from({ length: 10 }, (_, i) => person(i)), annals: [] };
    }
    SettlementMarket.ensure(settlement);
    settlement.market.stock.planks = 50;
    settlement.market.stock.stone = 50;
    settlement.market.stock.wood = 50;
    const worldTile = { q: 5, r: 6, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 600, season: 'Spring', baseYear: 853, generationParams: { seed: 31, terrainGen: 5 }, activeEvents: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    const player = { gold: 5000, name: 'Ada', inventory: {}, reputation: { k1: 0 }, lotHoldings: [], q: 5, r: 6, maxInventory: 20, children: [] };
    const game = { world, player, settlement };
    return { game, settlement, world, worldTile, player };
}

function enter(ctx) {
    InnerMap._cache = {};
    InnerMap.enter(ctx.game, 5, 6);
    return ctx;
}

/** Kill townsperson `id` on `day` and reckon the season. */
function die(ctx, id, extra = {}) {
    const p = ctx.settlement.folk.people.find(x => x.id === id);
    Object.assign(p, { died: ctx.world.day, cause: 'a fever', ...extra });
    ctx.settlement.folk.tick = ctx.world.day;
    return Graveyards.processDay(ctx.world, ctx.player);
}

describe('The churchyard on the map', () => {
    it('a town plans a churchyard of plots fronting a street, and stands its graves', () => {
        const ctx = enter(setup('town'));
        const yard = InnerMap.townYard();
        expect(yard).toBeTruthy();
        expect(yard.plots.length).toBeGreaterThanOrEqual(6);
        // The gate opens on a street
        const gateR = yard.front === 'south' ? yard.r1 + 1 : yard.r0 - 1;
        expect(InnerMap.getTile(yard.gate.q, gateR).isRoad).toBe(true);
        for (const p of yard.plots) {
            const t = InnerMap.getTile(p.q, p.r);
            expect(t._grave).toBe('town');
            expect(t.customBuilding || t.customBuildingPart).toBeFalsy();
        }
        // The years before: some plots already hold the dead, with markers from the art
        const town = Graveyards.ground(ctx.settlement, 'town');
        expect(town.cap).toBe(yard.plots.length);
        const graves = GraveBook.gravesIn(town);
        expect(graves.length).toBeGreaterThan(0);
        const stood = yard.plots.filter(p => {
            const co = InnerMap.getTile(p.q, p.r).customObject;
            return co && /^grave_/.test(co.defId);
        });
        expect(stood.length).toBeGreaterThan(0);
        expect(CustomObjects.getDef(GraveArt.defId('headstone_round'))).toBeTruthy();
    });

    it('the same town lays the same churchyard every visit', () => {
        enter(setup('village'));
        const a = JSON.stringify(InnerMap.townYard());
        enter(setup('village'));
        expect(JSON.stringify(InnerMap.townYard())).toBe(a);
    });

    it('a sprite is cut into 128px tiles of its box, stood on the bottom and centred', () => {
        const tiles = GraveArt.slice('tomb', 169, 110);
        expect(tiles.length).toBe(2);
        expect(tiles[0].sw).toBe(128);
        expect(tiles[0].sx).toBeCloseTo(-(256 - 169) / 2);
        expect(tiles[0].sy).toBe(110 - 128);
    });
});

describe('Burials', () => {
    it('a townsperson who dies is laid in the churchyard with their name and dates; the undertaker takes planks', () => {
        const ctx = setup('town');
        Graveyards.ensure(ctx.world, ctx.settlement);
        const planks0 = SettlementMarket.stock(ctx.settlement, 'planks');
        ctx.world.day += 30;
        die(ctx, 3, { role: 'merchant' });
        const town = Graveyards.ground(ctx.settlement, 'town');
        const g = GraveBook.gravesIn(town).find(x => x.pid === 3);
        expect(g).toBeTruthy();
        expect(g.name).toBe('P3 Stoneheart');
        expect(g.cls).toBe('middling');
        expect(g.term).toBe('t50');
        expect(g.until).toBe(ctx.world.day + 50 * Y);
        expect(SettlementMarket.stock(ctx.settlement, 'planks')).toBeLessThan(planks0);
        expect(GraveBook.epitaph(g, ctx.world)).toMatch(/P3 Stoneheart, \d+–\d+/);
    });

    it('markers weather: wood rots to a mound and then nothing, stone weathers and breaks', () => {
        const g = { died: 0, marker: 'cross_wood', until: null };
        expect(GraveBook.markerNow(g, 5 * Y)).toBe('cross_wood');
        expect(GraveBook.markerNow(g, 35 * Y)).toBe('grave_mound');
        expect(GraveBook.markerNow(g, 70 * Y)).toBe(null);
        const s = { died: 0, marker: 'headstone_round', until: null };
        expect(GraveBook.markerNow(s, 70 * Y)).toBe('headstone_old');
        expect(GraveBook.markerNow(s, 140 * Y)).toBe('headstone_broken');
    });

    it('plots grow dear as the town fills', () => {
        const ctx = setup('town');
        Graveyards.ensure(ctx.world, ctx.settlement);
        const town = Graveyards.ground(ctx.settlement, 'town');
        const before = GraveBook.leasePrice(ctx.settlement, town, 't25', ctx.world.day, 10);
        for (const i of GraveBook.freePlots(town)) town.plots[i] = { id: `x${i}`, name: 'x', died: 0, until: null, marker: 'cross_wood' };
        town.plots[0] = null;
        const after = GraveBook.leasePrice(ctx.settlement, town, 't25', ctx.world.day, 10);
        expect(after).toBeGreaterThan(before);
    });
});

describe('Your burial ground', () => {
    function withLot(ctx) {
        enter(ctx);
        const lot = InnerMap.townLots()[0];
        const res = Lots.buyLot(ctx.player, ctx.world, ctx.settlement, lot);
        expect(res.success).toBe(true);
        return lot;
    }

    it('consecrating a lot pays the temple; a family leases a plot, its coin out of the town purse into yours', () => {
        const ctx = setup('town');
        const lot = withLot(ctx);
        const purse0 = ctx.settlement.economy.gold;
        const gold0 = ctx.player.gold;
        const res = Graveyards.consecrate(ctx.player, ctx.world, ctx.settlement, lot);
        expect(res.success).toBe(true);
        expect(ctx.player.gold).toBe(gold0 - res.fee);
        expect(ctx.settlement.economy.gold).toBeCloseTo(purse0 + res.fee);
        expect(LotBook.lot(ctx.settlement, lot.id).built.kind).toBe('burial');
        // Cheaper than the parish: the next of the town's dead lie in your ground
        Graveyards.setPolicy(ctx.player, ctx.world, ctx.settlement, lot.id, 'cheap');
        ctx.world.day += 30;
        const sum0 = ctx.player.gold + ctx.settlement.economy.gold;
        die(ctx, 4);
        const mine = Graveyards.ground(ctx.settlement, lot.id);
        const g = GraveBook.gravesIn(mine).find(x => x.pid === 4);
        expect(g).toBeTruthy();
        expect(g.paid).toBeGreaterThan(0);
        expect(ctx.player.gold + ctx.settlement.economy.gold).toBeCloseTo(sum0);
        const paid = GraveBook.gravesIn(mine).reduce((a, x) => a + (x.paid || 0), 0);
        expect(ctx.player.gold).toBe(gold0 - res.fee + paid);
        // And it stands on the map within the lot
        InnerMap.refreshGraves(ctx.world);
        const cells = InnerMap.groundCells(ctx.settlement, mine);
        const c = cells[g.plot];
        expect(c.q).toBeGreaterThanOrEqual(lot.q0);
        expect(c.q + 1).toBeLessThanOrEqual(lot.q1);
        expect(InnerMap.plotAt(c.q, c.r).i).toBe(g.plot);
    });

    it('a poor town cannot lease: the family takes the churchyard', () => {
        const ctx = setup('town');
        const lot = withLot(ctx);
        Graveyards.consecrate(ctx.player, ctx.world, ctx.settlement, lot);
        Graveyards.setPolicy(ctx.player, ctx.world, ctx.settlement, lot.id, 'cheap');
        ctx.settlement.economy.gold = 0;
        ctx.world.day += 30;
        const gold0 = ctx.player.gold;
        die(ctx, 5);
        expect(ctx.player.gold).toBe(gold0);
        expect(GraveBook.gravesIn(Graveyards.ground(ctx.settlement, 'town')).some(x => x.pid === 5)).toBe(true);
    });

    it('a lease runs out unrenewed: cleared, its bones are yours; bones to the mill, meal to the farms', () => {
        const ctx = setup('city');
        const lot = withLot(ctx);
        Graveyards.consecrate(ctx.player, ctx.world, ctx.settlement, lot);
        Graveyards.setPolicy(ctx.player, ctx.world, ctx.settlement, lot.id, 'cheap');
        ctx.world.day += 30;
        die(ctx, 6, { role: 'beggar' });
        const mine = Graveyards.ground(ctx.settlement, lot.id);
        const g = GraveBook.gravesIn(mine).find(x => x.pid === 6);
        expect(g.term).toBe('t10');
        // Too soon to clear
        expect(Graveyards.clearPlot(ctx.player, ctx.world, ctx.settlement, lot.id, g.plot).success).toBe(false);
        ctx.world.day = g.until + 1;
        ctx.settlement.economy.gold = 0;   // no one can pay to renew
        Graveyards.processDay(ctx.world, ctx.player);
        expect(g.lapsed).toBe(ctx.world.day);
        ctx.settlement.economy.gold = 1000;
        const res = Graveyards.clearPlot(ctx.player, ctx.world, ctx.settlement, lot.id, g.plot, 'sexton');
        expect(res.success).toBe(true);
        expect(ctx.player.inventory.bones).toBe(1);
        expect(mine.plots[g.plot]).toBe(null);
        // The city's bone-grinder pays from the purse
        const purse = ctx.settlement.economy.gold;
        ctx.player.inventory.bones = 4;
        const sold = Graveyards.sellBones(ctx.player, ctx.world, ctx.settlement, 2);
        expect(sold.success).toBe(true);
        expect(ctx.settlement.economy.gold).toBeCloseTo(purse - sold.total);
        // A bone mill on a second lot grinds the rest into meal
        const lot2 = InnerMap.townLots()[1];
        Lots.buyLot(ctx.player, ctx.world, ctx.settlement, lot2);
        const stone0 = SettlementMarket.stock(ctx.settlement, 'stone');
        const mill = Graveyards.buildMill(ctx.player, ctx.world, ctx.settlement, lot2);
        expect(mill.success).toBe(true);
        expect(SettlementMarket.stock(ctx.settlement, 'stone')).toBeLessThan(stone0);
        expect(Graveyards.loadMill(ctx.player, ctx.world, ctx.settlement, lot2.id, 2).success).toBe(true);
        ctx.world.day += 10;
        Graveyards.processDay(ctx.world, ctx.player);
        expect(Graveyards.collectMeal(ctx.player, ctx.world, ctx.settlement, lot2.id).success).toBe(true);
        expect(ctx.player.inventory.bone_meal).toBe(4);
        ctx.settlement.farm = null;
        const meal = Graveyards.sellMeal(ctx.player, ctx.world, ctx.settlement, 4);
        expect(meal.success).toBe(true);
        expect(ctx.settlement.farm.soil).toBeGreaterThan(1);
    });

    it('no market stall buys bones', async () => {
        const { Trading } = await import('../player/playerEconomy/trading.js');
        const ctx = setup('town');
        ctx.player.inventory.bones = 3;
        const res = Trading.sellGoods(ctx.player, 'bones', 1, ctx.settlement, ctx.world);
        expect(res.success).toBe(false);
        expect(ctx.player.inventory.bones).toBe(3);
    });
});

describe('Your own dead, the sexton, the robber', () => {
    it('a child of yours who dies awaits burial, then lies in perpetuity', () => {
        const ctx = setup('town');
        Graveyards.ensure(ctx.world, ctx.settlement);
        Graveyards.processDay(ctx.world, ctx.player);
        ctx.player.children.push({ id: 'c1', firstName: 'Wren', isAlive: false, deathDay: ctx.world.day, deathCause: 'a fever' });
        const n = Graveyards.processDay(ctx.world, ctx.player).notices;
        expect(n.some(x => /Wren/.test(x.text))).toBe(true);
        const k = Graveyards.kinWaiting(ctx.player)[0];
        const res = Graveyards.buryKin(ctx.player, ctx.world, ctx.settlement, k.key, 'town', 'headstone_carved');
        expect(res.success).toBe(true);
        const g = GraveBook.gravesIn(Graveyards.ground(ctx.settlement, 'town')).find(x => x.kin);
        expect(g.until).toBe(null);
        expect(Graveyards.kinWaiting(ctx.player).length).toBe(0);
    });

    it('a day digging graves pays from the town purse', () => {
        const ctx = setup('town');
        Graveyards.ensure(ctx.world, ctx.settlement);
        ctx.settlement.graveyard.digWork = 3;
        ctx.settlement.graveyard.glutDay = ctx.world.day;
        const purse = ctx.settlement.economy.gold;
        const res = Graveyards.workAsGravedigger(ctx.player, ctx.world, ctx.settlement);
        expect(res.success).toBe(true);
        expect(res.dug).toBe(3);
        expect(ctx.settlement.economy.gold).toBeCloseTo(purse - res.pay);
        expect(Graveyards.workAsGravedigger(ctx.player, ctx.world, ctx.settlement).success).toBe(false);
    });

    it('robbing a grave is a theft: caught, a fine and lost standing; away, the goods hot', () => {
        const ctx = setup('town');
        Graveyards.ensure(ctx.world, ctx.settlement);
        const town = Graveyards.ground(ctx.settlement, 'town');
        const i = GraveBook.freePlots(town)[0];
        town.plots[i] = { id: 'rob', name: 'Rich Man', died: 0, until: null, marker: 'tomb', cls: 'rich', goods: 2 };
        const caught = Graveyards.robGrave(ctx.player, ctx.world, ctx.settlement, 'town', i, { witnesses: 30, guards: 5, hour: 12 });
        expect(caught.caught).toBe(true);
        expect(ctx.player.reputation.k1).toBeLessThan(0);
        expect(town.plots[i]).toBeTruthy();
        const away = Graveyards.robGrave(ctx.player, ctx.world, ctx.settlement, 'town', i, { witnesses: 0, guards: 0, hour: 2 });
        if (away.success) {
            expect(ctx.player.inventory.grave_goods).toBe(2);
            expect(town.plots[i]).toBe(null);
        }
    });

    it('the graveyard and the player\'s book survive a save', () => {
        const ctx = setup('town');
        Graveyards.ensure(ctx.world, ctx.settlement);
        ctx.player.graves = { sites: [{ kind: 'mill', q: 5, r: 6, lot: 'lot1', hopper: 3, meal: 2 }], kin: [], seen: {}, book: { leases: 9 } };
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('graves');
        const back = JSON.parse(JSON.stringify({ g: ctx.settlement.graveyard, p: ctx.player.graves }));
        expect(back.g.grounds.town.plots.length).toBe(ctx.settlement.graveyard.grounds.town.plots.length);
        expect(back.p.sites[0].hopper).toBe(3);
    });
});

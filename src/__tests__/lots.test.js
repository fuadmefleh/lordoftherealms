/**
 * Building lots and vacant houses on the town map (world/townPlanner.js,
 * world/lotBook.js, world/innerMap/lots.js, systems/lots.js).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Lots, LotBook;

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
    ({ Lots } = await import('../systems/lots.js'));
    ({ LotBook } = await import('../world/lotBook.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

function setup(type) {
    const settlement = { name: `Lotby-${type}`, type, population: 2000, q: 5, r: 6, kingdom: 'k1' };
    const worldTile = { q: 5, r: 6, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 10, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    const game = { world, player: { gold: 5000, name: 'Ada' }, settlement };
    return { game, settlement, world, worldTile };
}

function enter(type) {
    const ctx = setup(type);
    InnerMap._cache = {};
    InnerMap.enter(ctx.game, 5, 6);
    return ctx;
}

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    Utils.setSeed(7);
});

describe('Building lots', () => {
    it('a village keeps many lots, a city few; each empty, fronting a street', () => {
        const counts = {};
        for (const type of ['village', 'city']) {
            enter(type);
            const lots = InnerMap.townLots();
            counts[type] = lots.length;
            for (const l of lots) {
                for (let r = l.r0; r <= l.r1; r++) for (let q = l.q0; q <= l.q1; q++) {
                    const t = InnerMap.getTile(q, r);
                    expect(t._lot).toBe(l.id);
                    expect(t.customBuilding || t.customBuildingPart || t.customObject || t.customObjectPart || t.isRoad).toBeFalsy();
                }
                // Its gate stands on the street
                const mid = Math.floor((l.q0 + l.q1) / 2);
                expect(InnerMap.getTile(mid, l.gate === 'north' ? l.r0 - 1 : l.r1 + 1).isRoad).toBe(true);
            }
        }
        expect(counts.village).toBeGreaterThanOrEqual(6);
        expect(counts.city).toBeGreaterThanOrEqual(2);
        expect(counts.village).toBeGreaterThan(counts.city);
    });

    it('the same town plans the same lots every visit', () => {
        enter('town');
        const a = JSON.stringify(InnerMap.townLots());
        enter('town');
        expect(JSON.stringify(InnerMap.townLots())).toBe(a);
    });

    it('the player buys a lot, then may build on it — and nowhere else in town', () => {
        const { game, settlement } = enter('village');
        const lot = InnerMap.townLots()[0];
        const at = InnerMap.lotAt(lot.q0, lot.r0);
        expect(at.forSale).toBe(true);
        expect(Lots.canBuildOnLot(settlement, lot.id).ok).toBe(false);
        const gold = game.player.gold;
        const res = Lots.buyLot(game.player, game.world, settlement, lot);
        expect(res.success).toBe(true);
        expect(game.player.gold).toBe(gold - at.price);
        expect(InnerMap.lotAt(lot.q0, lot.r0).mine).toBe(true);
        expect(Lots.canBuildOnLot(settlement, lot.id).ok).toBe(true);
        expect(Lots.buyLot(game.player, game.world, settlement, lot).success).toBe(false);
        // Building: the lot's middle, inside its stakes
        const spot = InnerMap.lotBuildSpot(lot);
        expect(spot.q).toBeGreaterThan(lot.q0); expect(spot.q).toBeLessThan(lot.q1);
        expect(Lots.buildOnLot(game.player, game.world, settlement, lot.id, { type: 'workshop', name: 'Workshop' })).toBe(true);
        expect(Lots.canBuildOnLot(settlement, lot.id).ok).toBe(false);
    });

    it('the AI buys free lots over time, and its building stands on the lot next visit', () => {
        const { world, settlement, game } = enter('village');
        const before = Object.keys(LotBook.of(settlement).lots).length;
        for (let d = 0; d < 1500; d++) { world.day = 10 + d; Lots.processDay(world, null); }
        const book = LotBook.of(settlement);
        const sold = Object.entries(book.lots).filter(([, r]) => r.holder !== 'player');
        expect(sold.length).toBeGreaterThan(before);
        // Next visit (fresh plan): their buildings stand within their lots
        InnerMap._cache = {};
        InnerMap.enter(game, 5, 6);
        const raised = InnerMap.buildings.filter(b => b._lotId);
        expect(raised.length).toBeGreaterThan(0);
        for (const b of raised) {
            const lot = InnerMap.townLots().find(l => l.id === b._lotId);
            expect(b.q).toBeGreaterThanOrEqual(lot.q0); expect(b.q).toBeLessThanOrEqual(lot.q1);
            expect(b.r).toBe(lot.r1);
            expect(b.ownerName).toBe(book.lots[b._lotId].holderName);
        }
    });

    it('a rival House of the realm pays for its lot out of its purse', () => {
        const { world, settlement } = enter('capital');
        const player = { gold: 0, house: { rivals: { k1: { kingdomId: 'k1', name: 'House Varn', gold: 100000 } } } };
        for (let d = 0; d < 800; d++) { world.day = 10 + d; Lots.processDay(world, player); }
        const theirs = Object.values(LotBook.of(settlement).lots).filter(r => r.holder === 'rival:k1');
        expect(theirs.length).toBeGreaterThan(0);
        expect(player.house.rivals.k1.gold).toBeLessThan(100000);
    });
});

describe('Vacant houses', () => {
    it('a city keeps houses to let, empty of residents; a village none', () => {
        enter('village');
        expect(InnerMap.buildings.filter(b => b._vacancy).length).toBe(0);
        enter('city');
        const vac = InnerMap.buildings.filter(b => b._vacancy);
        expect(vac.length).toBeGreaterThanOrEqual(2);
        for (const b of vac) {
            expect(b.ownerName).toBeFalsy();
            expect(b.name).toMatch(/To Let/);
            expect(InnerMap.npcs.some(n => n._home === b)).toBe(false);
        }
    });

    it('rent by the day (put out when you can\'t pay), or buy outright', () => {
        const { game, settlement, world } = enter('city');
        const b = InnerMap.buildings.find(x => x._vacancy);
        const res = Lots.rentHouse(game.player, world, settlement, b._vacancy, 'The House');
        expect(res.success).toBe(true);
        InnerMap._applyLotHolders(settlement);
        expect(b.isPlayerOwned).toBe(true);
        expect(b.name).toMatch(/Rented/);
        const rent = LotBook.rentPerDay('city');
        world.day++;
        const g = game.player.gold;
        Lots._rentDay(world, game.player, world.day, []);
        expect(game.player.gold).toBe(g - rent);
        // Broke: out on the street
        game.player.gold = 0;
        world.day++;
        const notices = [];
        Lots._rentDay(world, game.player, world.day, notices);
        expect(LotBook.vacancy(settlement, b._vacancy)).toBeNull();
        expect(notices[0].title).toMatch(/Put Out/);
        // Buy it outright
        game.player.gold = 5000;
        expect(Lots.buyHouse(game.player, world, settlement, b._vacancy, 'The House').success).toBe(true);
        expect(LotBook.vacancy(settlement, b._vacancy).status).toBe('owned');
        expect(game.player.lotHoldings.some(h => h.kind === 'house')).toBe(true);
    });
});

describe('Your lots and houses: building to let, tenants, rents, selling', () => {
    /** A town with a lot of the player's (no town map needed). */
    function owned(type = 'town') {
        const ctx = setup(type);
        ctx.game.player.financeToday = { income: {}, expenses: {} };
        const res = Lots.buyLot(ctx.game.player, ctx.world, ctx.settlement, { id: 'lot0', w: 6, h: 6 });
        expect(res.success).toBe(true);
        return ctx;
    }
    const runDays = (world, player, n) => {
        const notices = [];
        for (let i = 0; i < n; i++) { world.day++; notices.push(...Lots.processDay(world, player).notices); }
        return notices;
    };
    /** Run with the tenants' chance of missing the rent set to `p`. */
    const withMiss = (p, fn) => {
        const L = DataLoader._gamedata.lots.letting;
        const was = L.missChance;
        L.missChance = p;
        try { return fn(); } finally { L.missChance = was; }
    };

    it('raises a house to let on your lot, finds a tenant once it stands, and the rent comes in under its own ledger line', () => {
        const { game, world, settlement } = owned('town');
        const p = game.player;
        const g0 = p.gold;
        const res = Lots.buildHouseOnLot(p, world, settlement, 'lot0');
        expect(res.success).toBe(true);
        expect(p.gold).toBe(g0 - LotBook.houseCost('town'));
        expect(Lots.canBuildOnLot(settlement, 'lot0').ok).toBe(false);
        let view = Lots.holdingsView(world, p)[0];
        expect(view.state).toBe('building');
        expect(view.daysLeft).toBe(LotBook.houseDays('town'));
        expect(view.canSell).toBe(true);
        // While it is going up no one moves in
        runDays(world, p, LotBook.houseDays('town') - 1);
        expect(LotBook.lot(settlement, 'lot0').built.tenant).toBeNull();
        // Standing: a tenant is found, and pays
        const notices = withMiss(0, () => runDays(world, p, 90));
        view = Lots.holdingsView(world, p)[0];
        expect(view.state).toBe('built');
        expect(notices.some(n => n.title === 'A Tenant')).toBe(true);
        const t = LotBook.lot(settlement, 'lot0').built.tenant;
        expect(view.tenant).toBe(t.name);
        expect(view.rent).toBe(Lots.rentFor(settlement));
        expect(view.paidDay).toBe(world.day);
        expect(view.canEvict).toBe(true);
        expect(p.financeToday.income.townRentIncome).toBeGreaterThan(0);
        // The monthly word of rents
        expect(notices.some(n => n.title === 'Rents of the Month' && /Rents collected: \d+g from 1 house\./.test(n.text))).toBe(true);
    });

    it('warns when a tenant can\'t pay, and they slip away after long enough behind', () => {
        const { game, world, settlement } = owned('city');
        const p = game.player;
        Lots.buildHouseOnLot(p, world, settlement, 'lot0');
        const rec = LotBook.lot(settlement, 'lot0').built;
        rec.readyDay = world.day;
        rec.tenant = { name: 'Widow Maud', since: world.day, rent: 4, paidDay: null, owed: 0, missed: 0 };
        const notices = withMiss(1, () => runDays(world, p, 10));
        expect(notices.find(n => n.title === 'Rent Unpaid').text).toMatch(/Widow Maud couldn't pay/);
        expect(notices.some(n => n.title === 'Rent in Arrears')).toBe(true);
        expect(notices.some(n => n.title === 'A Tenant Gone' && /owing you 40g/.test(n.text))).toBe(true);
        expect(rec.tenant).toBeNull();
        expect(p.financeToday.income.townRentIncome || 0).toBe(0);
    });

    it('a tenant behind pays back arrears with the day\'s rent; putting them out forfeits the rest', () => {
        const { game, world, settlement } = owned('town');
        const p = game.player;
        Lots.buildHouseOnLot(p, world, settlement, 'lot0');
        const rec = LotBook.lot(settlement, 'lot0').built;
        rec.readyDay = world.day;
        rec.tenant = { name: 'Old Bram', since: world.day - 5, rent: 2, paidDay: null, owed: 6, missed: 0 };
        const g = p.gold;
        withMiss(0, () => runDays(world, p, 1));
        expect(p.gold).toBe(g + 4);
        expect(rec.tenant.owed).toBe(4);
        expect(p.financeToday.income.townRentIncome).toBe(4);
        const res = Lots.evictTenant(p, world, 5, 6, 'lot0');
        expect(res.success).toBe(true);
        expect(res.text).toMatch(/4g of rent still unpaid/);
        expect(rec.tenant).toBeNull();
        expect(rec.let).toBe(true);
        expect(Lots.stopLetting(p, world, 5, 6, 'lot0').success).toBe(true);
        expect(Lots.holdingsView(world, p)[0].canLet).toBe(true);
        expect(Lots.letHouse(p, world, 5, 6, 'lot0').success).toBe(true);
    });

    it('a bought house can be let and sold; a lot sold bare goes back on the market', () => {
        const { game, world, settlement } = owned('city');
        const p = game.player;
        expect(Lots.buyHouse(p, world, settlement, '20,20', 'The Corner House').success).toBe(true);
        const house = Lots.holdingsView(world, p).find(r => r.kind === 'house');
        expect(house.state).toBe('owned');
        expect(house.canLet).toBe(true);
        expect(Lots.letHouse(p, world, 5, 6, '20,20').success).toBe(true);
        expect(LotBook.vacancy(settlement, '20,20').let).toBe(true);
        // Sell the house: a townsperson has it
        const g = p.gold;
        const sold = Lots.sellHouse(p, world, 5, 6, '20,20');
        expect(sold.success).toBe(true);
        expect(p.gold).toBe(g + Math.round(LotBook.salePrice('city') * 0.75));
        expect(LotBook.vacancy(settlement, '20,20').holder).toMatch(/^npc:/);
        // Sell the bare lot
        const lotSale = Lots.sellLot(p, world, 5, 6, 'lot0');
        expect(lotSale.success).toBe(true);
        expect(LotBook.lot(settlement, 'lot0')).toBeNull();
        expect(Lots.holdingsView(world, p)).toEqual([]);
        expect(p.financeToday.income.townLand).toBe(-LotBook.lotPrice('city', 6, 6) - LotBook.salePrice('city') + sold.value + lotSale.value);
    });

    it('a lot with a property of yours on it is not sold from the panel; a rented house shows its rent and the day last paid', () => {
        const { game, world, settlement, worldTile } = owned('town');
        const p = game.player;
        const prop = { type: 'workshop', name: 'Workshop', underConstruction: true, constructionDaysLeft: 4 };
        worldTile.playerProperties = [prop];
        Lots.buildOnLot(p, world, settlement, 'lot0', prop);
        let row = Lots.holdingsView(world, p)[0];
        expect(row.state).toBe('building');
        expect(row.daysLeft).toBe(4);
        expect(row.canSell).toBe(false);
        expect(Lots.sellLot(p, world, 5, 6, 'lot0').success).toBe(false);
        prop.underConstruction = false;
        expect(Lots.holdingsView(world, p)[0].state).toBe('built');
        expect(Lots.rentHouse(p, world, settlement, '30,30', 'The Lane House').success).toBe(true);
        runDays(world, p, 2);
        row = Lots.holdingsView(world, p).find(r => r.kind === 'rent');
        expect(row.state).toBe('rented');
        expect(row.rent).toBe(LotBook.rentPerDay('town'));
        expect(row.paidDay).toBe(world.day);
        expect(row.canLeave).toBe(true);
        expect(p.financeToday.expenses.townRent).toBe(3 * LotBook.rentPerDay('town'));
    });

    it('the Lots & Town Houses panel lists each holding and its buttons work', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const { game, world, settlement } = owned('town');
        const p = game.player;
        p.q = 5; p.r = 6;
        Lots.buyHouse(p, world, settlement, '20,20', 'The Corner House');
        let html = '';
        game.ui = { showCustomPanel: (t, h) => { html = h; }, updateStats() {} };
        ActionMenu.showTownLots(game);
        expect(html).toContain('Lot #0');
        expect(html).toContain('The Corner House');
        expect(html).toContain('Lotby-town');
        expect(html).toContain('Build a House to Let');
        ActionMenu.townLotsAct(game, 'build', 5, 6, 'lot0');
        expect(html).toMatch(/Masons set to work/);
        expect(html).toMatch(/Building — \d+ days left/);
        ActionMenu.townLotsAct(game, 'let', 5, 6, '20,20');
        expect(LotBook.vacancy(settlement, '20,20').let).toBe(true);
        ActionMenu.townLotsAct(game, 'sell', 5, 6, '20,20');
        expect(html).toMatch(/is sold to/);
        expect(html).not.toContain('The Corner House</');
    });
});

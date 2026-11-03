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

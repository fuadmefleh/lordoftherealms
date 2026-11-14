// The player's own house, lived in (player/household.js, world/innerMap/
// household.js, ui/actionMenu/household.js): rooms marked in the house and
// their furniture's quality, servants paid from the purse who quit when
// unpaid, a larder the household eats from, guests who remark on the hall's
// displays, and the household walking the house on the inner map.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { Household } from '../player/household.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';
import '../ui/actionMenu/household.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const KEY = 'house:5,6';

function mockWorld(day = 10) {
    const settlement = { name: 'Oakby', type: 'town', economy: { gold: 500 } };
    const tile = { q: 5, r: 6, settlement };
    return { day, seed: 7, settlement, getTile: (q, r) => (q === 5 && r === 6 ? tile : null) };
}

function homePlayer() {
    const p = new Player();
    p.q = 5; p.r = 6;
    p.gold = 1000;
    p.houses = [{ q: 5, r: 6, typeId: 'cottage', upgrades: [], condition: 100, settlementName: 'Oakby' }];
    p.inventory = { bread: 20, cooked_meat: 5 };
    return p;
}

const BED = { types: { bed: 1, chest: 1, rug: 1 }, value: 200 };

describe('rooms', () => {
    it('a room is only any use with its needed furniture, and better the more and finer it is', () => {
        expect(Household.roomQuality('bedchamber', { types: { chest: 2 }, value: 40 })).toBe(0);
        const poor = Household.roomQuality('bedchamber', { types: { bed: 1 }, value: 8 });
        const fine = Household.roomQuality('bedchamber', BED);
        expect(poor).toBeGreaterThan(0);
        expect(fine).toBeGreaterThan(poor);
        expect(fine).toBeLessThanOrEqual(1);
    });

    it('marking a bedchamber makes sleep at home restore more', () => {
        const p = homePlayer();
        const w = mockWorld();
        expect(Household.sleepBonus(p, KEY)).toBe(0);
        const res = Household.designate(p, w, KEY, { kind: 'bedchamber', floor: 0, q: 2, r: 2, tally: BED }, { name: 'Cottage', town: 'Oakby' });
        expect(res.success).toBe(true);
        expect(Household.sleepBonus(p, KEY)).toBeGreaterThan(0.1);
        // Marking it again moves it: one of each kind
        Household.designate(p, w, KEY, { kind: 'bedchamber', floor: 0, q: 4, r: 2, tally: BED });
        expect(Household.home(p, KEY).rooms.filter(r => r.kind === 'bedchamber')).toHaveLength(1);
    });

    it('the study and the chapel do their good each day at home', () => {
        const p = homePlayer();
        const w = mockWorld();
        Household.designate(p, w, KEY, { kind: 'study', floor: 0, q: 1, r: 1, tally: { types: { desk: 1, bookshelf: 2 }, value: 145 } });
        Household.designate(p, w, KEY, { kind: 'chapel', floor: 0, q: 3, r: 1, tally: { types: { altar: 1, candle: 1 }, value: 85 } });
        const faith = p.faith;
        const xp = (p.attrXp && p.attrXp.intelligence) || 0;
        Household.processDay(p, w);
        expect((p.attrXp && p.attrXp.intelligence) || 0).toBeGreaterThan(xp);
        expect(p.faith).toBeGreaterThan(faith);
    });
});

describe('servants', () => {
    it('are paid from the purse each day, and spend it in the home town', () => {
        const p = homePlayer();
        const w = mockWorld();
        Household.home(p, KEY, true);
        const c = Household.candidates(p, w, KEY, 'maid');
        expect(c.length).toBeGreaterThan(0);
        const res = Household.hire(p, w, KEY, 'maid', c[0].id);
        expect(res.success).toBe(true);
        const s = res.servant;
        const gold = p.gold;
        const town = w.settlement.economy.gold;
        Household.home(p, KEY).larder = { bread: 10 };
        Household.processDay(p, w);
        expect(p.gold).toBeCloseTo(gold - s.wage, 5);
        expect(w.settlement.economy.gold).toBeGreaterThan(town);
        expect(s.purse).toBeLessThan(s.wage);
    });

    it('unpaid and unfed, they quit', () => {
        const p = homePlayer();
        const w = mockWorld();
        Household.home(p, KEY, true);
        const c = Household.candidates(p, w, KEY, 'cook');
        Household.hire(p, w, KEY, 'cook', c[0].id);
        p.gold = 0;
        p.q = 0; // away: the larder is bare and nobody pays
        let quit = null;
        for (let d = 11; d < 40 && !quit; d++) {
            w.day = d;
            const n = Household.processDay(p, w).notices.find(x => x.title === 'A Servant Quits');
            if (n) quit = n;
        }
        expect(quit).toBeTruthy();
        expect(Household.home(p, KEY).servants).toHaveLength(0);
    });

    it('a maid keeps the house clean', () => {
        const p = homePlayer();
        const w = mockWorld();
        const home = Household.home(p, KEY, true);
        home.larder = { grain: 40 };
        for (let d = 0; d < 10; d++) { w.day = 10 + d; Household.processDay(p, w); }
        const dirty = home.clean;
        Household.hire(p, w, KEY, 'maid', Household.candidates(p, w, KEY, 'maid')[0].id);
        for (let d = 0; d < 10; d++) { w.day = 30 + d; Household.processDay(p, w); }
        expect(home.clean).toBeGreaterThan(dirty);
    });
});

describe('the larder', () => {
    it('is stocked from the packs and eaten from by every mouth', () => {
        const p = homePlayer();
        const w = mockWorld();
        Household.home(p, KEY, true);
        expect(Household.stock(p, KEY, 'bread', 10).success).toBe(true);
        expect(p.inventory.bread).toBe(10);
        expect(Household.rations(Household.home(p, KEY))).toBeGreaterThan(5);
        const before = Household.units(Household.home(p, KEY));
        Household.processDay(p, w);
        expect(Household.units(Household.home(p, KEY))).toBeLessThan(before);
        expect(Household.stock(p, KEY, 'iron', 1).success).toBe(false);
    });

    it('a bare larder at home leaves the household hungry', () => {
        const p = homePlayer();
        const w = mockWorld();
        Household.home(p, KEY, true);
        Household.hire(p, w, KEY, 'maid', Household.candidates(p, w, KEY, 'maid')[0].id);
        const s = Household.home(p, KEY).servants[0];
        const mood = s.mood;
        const out = Household.processDay(p, w).notices;
        expect(out.some(n => /larder/.test(n.text))).toBe(true);
        expect(s.mood).toBeLessThan(mood);
    });
});

describe('the hall', () => {
    it('shows trophies on its display pieces, and guests remark on them for Prestige', () => {
        const p = homePlayer();
        const w = mockWorld();
        p.house = { prestige: 0, prestigeLog: [], stats: { battleWon: 3 }, rivals: {}, court: [] };
        p.children = [{ id: 'k1', firstName: 'Edda', age: 22, isAlive: true }];
        Household.designate(p, w, KEY, { kind: 'hall', floor: 0, q: 3, r: 3, tally: { types: { table: 2, rack: 1, fireplace: 1 }, value: 120, displaySlots: 1 } });
        const things = Household.displayables(p, KEY);
        expect(things.some(t => t.ref === 'trophy:captured_banner')).toBe(true);
        expect(Household.setDisplay(p, KEY, 'trophy:captured_banner').success).toBe(true);
        expect(Household.setDisplay(p, KEY, 'trophy:captured_banner').success).toBe(true);
        Household.home(p, KEY).larder = { bread: 30 };
        expect(Household.invite(p, w, KEY).success).toBe(true);
        let remark = null;
        for (let d = 11; d < 20 && !remark; d++) {
            w.day = d;
            remark = Household.processDay(p, w).notices.find(n => n.title === 'In the Hall');
        }
        expect(remark).toBeTruthy();
        expect(p.house.prestige).toBeGreaterThan(0);
    });
});

describe('a house sold', () => {
    it('breaks up its household', () => {
        const p = homePlayer();
        const w = mockWorld();
        Household.home(p, KEY, true);
        Household.hire(p, w, KEY, 'maid', Household.candidates(p, w, KEY, 'maid')[0].id);
        p.houses = [];
        Household.processDay(p, w);
        expect(Household.home(p, KEY)).toBeNull();
    });
});

describe('save and load', () => {
    it('keeps the household', () => {
        expect(SaveLoad.EXTRA_PLAYER_FIELDS).toContain('household');
    });
});

describe('on the inner map', () => {
    function enterHouse(player) {
        const W = 12, H = 8;
        const tiles = [];
        for (let r = 0; r < H; r++) {
            tiles[r] = [];
            for (let q = 0; q < W; q++) tiles[r][q] = { q, r, subTerrain: { id: 'grass', passable: true }, explored: true };
        }
        Object.assign(InnerMap, {
            active: true, _insideBuilding: null, _outerMapState: null, tiles, width: W, height: H,
            buildings: [], roads: [], npcs: [], currentWorldTile: { q: 5, r: 6 },
            _currentWorldTileRef: { q: 5, r: 6, settlement: { name: 'Oakby', type: 'town' } },
        });
        const house = { type: 'house', name: 'House (Yours)', q: 3, r: 4, isPlayerOwned: true, ownerId: 'player' };
        expect(InnerMap.enterBuilding(house, { player, world: mockWorld(), ui: { showNotification() {} } })).toBe(true);
        return house;
    }

    beforeEach(() => { InnerMap._interiorCache = {}; });

    it('surveys the furniture around a mark, and the servants walk the house', () => {
        const p = homePlayer();
        const w = mockWorld();
        enterHouse(p);
        expect(InnerMap.furnishHomeKey()).toBe(KEY);
        const spot = InnerMap.householdSpot();
        const tallies = InnerMap.surveyHomeRooms([{ id: 'x', kind: 'bedchamber', floor: 0, q: spot.q, r: spot.r }], p);
        expect(tallies.x).toBeTruthy();
        expect(typeof tallies.x.value).toBe('number');
        Household.designate(p, w, KEY, { kind: 'kitchen', floor: 0, q: spot.q, r: spot.r, tally: tallies.x });
        Household.hire(p, w, KEY, 'cook', Household.candidates(p, w, KEY, 'cook')[0].id);
        Household.hire(p, w, KEY, 'maid', Household.candidates(p, w, KEY, 'maid')[0].id);
        InnerMap.exitBuilding({ player: p });
        enterHouse(p);
        const folk = InnerMap.npcs.filter(n => n._householdFolk);
        expect(folk.map(n => n._homeRole).sort()).toEqual(['cook', 'maid']);
        // They go to their own furniture, and are never seen lying in the family's beds
        const cook = folk.find(n => n._homeRole === 'cook');
        expect(InnerMap._jobFurniture(cook)).toContain('fireplace');
        expect(cook._homeActs.bed.on).toBeUndefined();
        InnerMap.exitBuilding({ player: p });
    });
});

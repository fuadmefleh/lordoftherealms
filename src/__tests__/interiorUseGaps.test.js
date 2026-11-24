// Who uses which piece indoors: the servants' cots are the servants' (never the family's),
// a guest room's beds left to callers (world/innerMap/householdRooms.js); nobody sits,
// sleeps, eats or works at a broken piece — the same rule the player's actions go by
// (world/furnitureUsable.js); and a tavern's keeper goes down to the cellar now and then
// and comes back up (world/innerMap/cellarTrips.js).

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { InnerMap } from '../world/innerMap.js';
import { pieceUsable, npcCanUse } from '../world/furnitureUsable.js';
import { FurnitureActions } from '../player/furnitureActions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const W = 12, H = 8;
function street(settlementType = 'town') {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        tiles[r] = [];
        for (let q = 0; q < W; q++) tiles[r][q] = { q, r, subTerrain: { id: 'grass', passable: true }, explored: true };
    }
    InnerMap.active = true;
    InnerMap._insideBuilding = null;
    InnerMap._outerMapState = null;
    InnerMap.tiles = tiles;
    InnerMap.width = W;
    InnerMap.height = H;
    InnerMap.buildings = [];
    InnerMap.roads = [];
    InnerMap.npcs = [];
    InnerMap.worldDay = 40;
    InnerMap.timeOfDay = 12;
    InnerMap._timeAccumulator = 0;
    InnerMap.currentWorldTile = { q: 5, r: 6 };
    InnerMap._currentWorldTileRef = { q: 5, r: 6, settlement: { name: 'Oakby', type: settlementType } };
}
const game = () => ({ player: { technology: { researched: [], implemented: [] }, inventory: {} }, ui: { showNotification() {} } });

/** A bare room of floor tiles (walls round it), for pieces set down by hand. */
function room(w = 9, h = 7) {
    const tiles = [];
    for (let r = 0; r < h; r++) {
        tiles[r] = [];
        for (let q = 0; q < w; q++) {
            const wall = q === 0 || r === 0 || q === w - 1 || r === h - 1;
            tiles[r][q] = { q, r, _isInterior: true, baseTerrain: wall ? 'wall' : 'floor', subTerrain: { id: wall ? 'wall' : 'floor', passable: !wall } };
        }
    }
    return tiles;
}
const put = (tiles, q, r, f, extra = {}) => {
    const t = tiles[r][q];
    t._furniture = { icon: '', name: f.type, passable: false, ...f };
    if (!t._furniture.passable) t.subTerrain = { id: `furniture_${f.type}`, passable: false };
    Object.assign(t, extra);
    return t;
};
const person = (id, b, extra = {}) => ({
    id, name: id, type: 'villager', state: 'inside_building', _home: b, currentBuilding: b.type,
    _insideBuildingQ: b.q, _insideBuildingR: b.r, q: 2, r: 2, spouseId: null, parentIds: [], age: 30, ...extra,
});

let hour0;
beforeEach(() => { InnerMap._interiorCache = {}; InnerMap._hhPlanCache = null; hour0 = InnerMap.timeOfDay; Utils.setSeed(7); });
afterEach(() => { if (InnerMap._insideBuilding) InnerMap.exitBuilding(game()); InnerMap.timeOfDay = hour0; InnerMap._timeAccumulator = 0; });

describe('the servants\' cots and the guest rooms are not the family\'s', () => {
    it('sorts a floor\'s beds by their room: the family\'s, the servants\', none for a guest room', () => {
        street();
        const tiles = room();
        put(tiles, 1, 1, { type: 'bed', name: 'Bed' });
        put(tiles, 3, 1, { type: 'bed', name: 'Servant\'s Cot', art: 'straw', noJoin: true }, { _roomId: 'servants', _room: 'Servants\' Room' });
        put(tiles, 5, 1, { type: 'bed', name: 'Bed' }, { _roomId: 'guest', _room: 'Guest Room' });
        put(tiles, 7, 1, { type: 'bed', name: 'Straw Pallet', art: 'straw' });
        const P = InnerMap._hhPieces(tiles);
        expect(P.adult.map(t => t.q)).toEqual([1]);
        expect(P.child.map(t => t.q)).toEqual([7]);
        expect(P.servant.map(t => t.q)).toEqual([3]);
        // (a dormitory floor's beds are nobody's of the family)
        expect(InnerMap._hhPieces(tiles, 'dormitory').adult).toEqual([]);
    });

    it('the couple in the family\'s bed, the servant in the cot, the brother never in the guest room\'s bed', () => {
        street();
        const house = { type: 'house', name: 'Hall House', q: 4, r: 3 };
        const tiles = room();
        put(tiles, 1, 1, { type: 'bed', name: 'Bed' });
        put(tiles, 3, 1, { type: 'bed', name: 'Servant\'s Cot', art: 'straw', noJoin: true }, { _roomId: 'servants' });
        put(tiles, 5, 1, { type: 'bed', name: 'Bed' }, { _roomId: 'guest' });
        const lord = person('lord', house, { age: 44, spouseId: 'lady' });
        const lady = person('lady', house, { age: 40, spouseId: 'lord' });
        const brother = person('bro', house, { age: 38 });
        const maid = person('maid', house, { age: 22, job: 'servant', _work: house, _liveIn: true });
        InnerMap.npcs = [lord, lady, brother, maid];
        const plan = InnerMap.householdBedPlan(house, tiles);
        expect(plan.get('lord').q).toBe(1);
        expect(plan.get('lady').q).toBe(1);
        expect(plan.get('maid')).toMatchObject({ q: 3, kind: 'bed', cot: true });
        // No family bed left for him: not the guest room's, nor the cot (a bedroll: floors.js)
        expect(plan.get('bro')).toBeUndefined();
        // The cots are kept from callers too, while another bed is free
        InnerMap._insideBuilding = house;
        const reserved = InnerMap._householdReserved({ tiles });
        InnerMap._insideBuilding = null;
        expect(reserved.has('3,1')).toBe(true);
        expect(reserved.has('5,1')).toBe(false);
    });

    it('with no cot, a servant is left to a bedroll — never given a family bed', () => {
        street();
        const house = { type: 'house', name: 'Cottage', q: 4, r: 3 };
        const tiles = room();
        put(tiles, 1, 1, { type: 'bed', name: 'Bed' });
        put(tiles, 3, 1, { type: 'bed', name: 'Bed' });
        const man = person('man', house, { age: 50 });
        const maid = person('maid', house, { age: 20, job: 'servant', _work: house, _liveIn: true });
        InnerMap.npcs = [maid, man];
        const plan = InnerMap.householdBedPlan(house, tiles);
        expect(plan.get('man')).toBeTruthy();
        expect(plan.get('maid')).toBeUndefined();
    });

    it('a servant with no family of their own lives in at the house they serve', () => {
        street();
        const manor = { type: 'manor', q: 2, r: 2 };
        const single = { id: 's', type: 'villager', spouseId: null, childIds: [] };
        expect(InnerMap._liveInService(single, { p: { spouse: null, kids: [] } }, manor)).toBe(true);
        expect(InnerMap._liveInService(single, { p: { spouse: 9, kids: [] } }, manor)).toBe(false);
        expect(InnerMap._liveInService(single, { p: { spouse: null, kids: [3] } }, manor)).toBe(false);
        expect(InnerMap._liveInService(single, { p: { spouse: null, kids: [] } }, { type: 'house', q: 1, r: 1, isPlayerOwned: true })).toBe(false);
        expect(InnerMap._liveInService(single, { p: { spouse: null, kids: [] } }, { type: 'blacksmith', q: 1, r: 1 })).toBe(false);
    });

    it('in a manor with a servants\' room, the servant sleeps in its cot and the lord and lady in their bed', () => {
        street('city');
        const g = game();
        let checked = 0;
        for (let i = 0; i < 10 && checked < 2; i++) {
            InnerMap._interiorCache = {};
            InnerMap._hhPlanCache = null;
            const manor = { type: 'manor', name: 'Manor', q: i, r: 5 };
            const lord = person(`lord${i}`, manor, { type: 'noble', age: 46, spouseId: `lady${i}` });
            const lady = person(`lady${i}`, manor, { type: 'noble', age: 41, spouseId: `lord${i}` });
            const maid = person(`maid${i}`, manor, { age: 24, job: 'servant', _work: manor, _liveIn: true });
            street('city');
            InnerMap.npcs = [lord, lady, maid];
            InnerMap.timeOfDay = 23;
            expect(InnerMap.enterBuilding(manor, g, { force: true })).toBe(true);
            const plan = InnerMap.householdBedPlan(manor);
            const cot = plan.get(maid.id);
            const has = (InnerMap._hhFloors(manor) || []).some(f => InnerMap._hhPieces(f.tiles, f.kind).servant.length);
            if (has) {
                expect(cot && cot.cot).toBe(true);
                expect(cot.tiles[cot.r][cot.q]._roomId).toBe('servants');
                for (const who of [lord, lady]) {
                    const s = plan.get(who.id);
                    if (s) expect(InnerMap._hhBedRole(s.tiles[s.r][s.q])).toBe('family');
                }
                checked++;
            }
            InnerMap.exitBuilding(g);
        }
        expect(checked).toBeGreaterThan(0);
    });
});

describe('a broken piece is nobody\'s to use', () => {
    it('one rule for the player and the townsfolk', () => {
        expect(pieceUsable(null)).toBe(true);
        expect(pieceUsable({ type: 'bed' }, 'sleep')).toBe(true);
        expect(pieceUsable({ type: 'bed', broken: true }, 'sleep', ['look_inside'])).toBe(false);
        expect(pieceUsable({ type: 'chest', broken: true }, 'look_inside', ['look_inside'])).toBe(true);
        expect(npcCanUse({ type: 'table', broken: true })).toBe(false);
        expect(npcCanUse({ type: 'chest', broken: true })).toBe(true);
        expect(FurnitureActions.usable('sleep', { type: 'bed', broken: true }).ok).toBe(false);
        expect(FurnitureActions.usable('look_inside', { type: 'chest', broken: true }).ok).toBe(true);
    });

    it('townsfolk pick another piece, never the broken one', () => {
        street();
        const tiles = room();
        put(tiles, 2, 2, { type: 'table', broken: true });
        put(tiles, 6, 2, { type: 'table' });
        put(tiles, 4, 5, { type: 'fireplace', broken: true });
        InnerMap.tiles = tiles; InnerMap.width = 9; InnerMap.height = 7;
        InnerMap._furnitureSpots = null;
        const npc = person('v', { type: 'house', q: 1, r: 1 }, { q: 4, r: 3 });
        InnerMap.npcs = [npc];
        for (let i = 0; i < 40; i++) {
            const s = InnerMap._pickFurnitureFor(npc);
            expect(s).toBeTruthy();
            expect(`${s.q},${s.r}`).toBe('6,2');
        }
        // All of it broken: nothing to use — they stand and mill about
        tiles[2][6]._furniture.broken = true;
        expect(InnerMap._pickFurnitureFor(npc)).toBeNull();
    });

    it('supper at the whole table, not the broken one, and no stool drawn up to a broken hearth', () => {
        street();
        const house = { type: 'house', q: 4, r: 3 };
        const tiles = room();
        put(tiles, 2, 3, { type: 'table', broken: true });
        put(tiles, 6, 3, { type: 'table' });
        InnerMap.tiles = tiles; InnerMap.width = 9; InnerMap.height = 7;
        InnerMap._furnitureSpots = null; InnerMap._mealSeats = null;
        InnerMap._insideBuilding = house;
        const npc = person('m', house, { q: 4, r: 1, _meal: 'supper', idleTimer: 30 });
        InnerMap.npcs = [npc];
        expect(InnerMap._jobTableMeal(npc, 0.1)).toBe(true);
        expect(npc._mealSeat.at).toEqual({ q: 6, r: 3 });
        InnerMap._insideBuilding = null;
    });

    it('nobody lies in a broken bed: the plan leaves it, and a sleeper takes a bedroll', () => {
        street();
        const house = { type: 'house', q: 4, r: 3 };
        const tiles = room();
        put(tiles, 2, 2, { type: 'bed', name: 'Bed', broken: true });
        InnerMap.tiles = tiles; InnerMap.width = 9; InnerMap.height = 7;
        const man = person('man', house, { age: 40 });
        InnerMap.npcs = [man];
        expect(InnerMap.householdBedPlan(house, tiles).size).toBe(0);
        const abed = InnerMap._townAbed;
        InnerMap._townAbed = (n) => n === man;
        InnerMap._sleepersPlaced = [];
        InnerMap._placeNpcOnFloor(man, { tiles, width: 9, height: 7 });
        InnerMap._townAbed = abed;
        InnerMap._sleepersPlaced = null;
        expect(man._asleep).toBeTruthy();
        expect(man._asleep.bedroll).toBe(true);
        expect(`${man.q},${man.r}`).not.toBe('2,2');
    });
});

describe('down to the cellar and back', () => {
    const stairsTo = (to) => {
        for (const row of InnerMap.tiles) for (const t of row) if (t._stairs && t._stairs.to === to) return { q: t.q, r: t.r };
        return null;
    };
    /** The first trip of `npc` after 8 o'clock: [startMinute, endMinute]. */
    function firstTrip(npc, kind = 'ale_cellar') {
        let start = null;
        for (let m = 8 * 60; m < 22 * 60; m++) {
            const on = InnerMap._cellarTripAt(npc, m / 60, InnerMap.worldDay, kind);
            if (on && start == null) start = m;
            if (!on && start != null) return [start, m];
        }
        return null;
    }
    const setClock = (m) => { InnerMap.timeOfDay = Math.floor(m / 60); InnerMap._timeAccumulator = (m % 60) / 60 * (InnerMap.TIME_SCALE || 60); };

    it('trips are fixed by the keeper, the day and the hour, and only in the waking hours', () => {
        street();
        const npc = { id: 'keeper' };
        const a = firstTrip(npc);
        expect(a).toBeTruthy();
        expect(firstTrip(npc)).toEqual(a);
        expect(a[1] - a[0]).toBeGreaterThanOrEqual(8);
        expect(a[1] - a[0]).toBeLessThanOrEqual(15);
        for (let m = 0; m < 6 * 60; m += 5) expect(InnerMap._cellarTripAt(npc, m / 60, 40, 'ale_cellar')).toBe(false);
        // Over a day, a few trips — not every hour
        let n = 0;
        for (let m = 6 * 60, on = false; m < 23 * 60; m++) { const t = InnerMap._cellarTripAt(npc, m / 60, 40, 'ale_cellar'); if (t && !on) n++; on = t; }
        expect(n).toBeGreaterThan(3);
        expect(n).toBeLessThan(30);
    });

    it('the innkeeper goes down the cellar steps, is found below, and comes back up with ale', () => {
        street();
        const g = game();
        const tavern = { type: 'tavern', name: 'The Bell', q: 3, r: 4 };
        const keeper = person('keeper', { type: 'house', q: 9, r: 9 }, { _work: tavern, job: 'innkeeper', currentBuilding: 'tavern', _insideBuildingQ: 3, _insideBuildingR: 4 });
        const drinker = person('drinker', { type: 'house', q: 8, r: 8 }, { currentBuilding: 'tavern', _insideBuildingQ: 3, _insideBuildingR: 4 });
        InnerMap.npcs = [keeper, drinker];
        const trip = firstTrip(keeper);
        expect(trip).toBeTruthy();
        // Just before the trip: on the ground floor with the player
        setClock(trip[0] - 1);
        expect(InnerMap.enterBuilding(tavern, g, { force: true })).toBe(true);
        expect(InnerMap._hasCellar).toBe(true);
        expect(InnerMap._cellarKeeper(keeper)).toBe(true);
        expect(InnerMap._cellarKeeper(drinker)).toBe(false);
        expect(InnerMap.npcs).toContain(keeper);
        // The trip starts: off to the cellar steps, and gone down them
        setClock(trip[0]);
        InnerMap._updateCellarTrips(1);
        expect(keeper._cellarWalk).toBeTruthy();
        for (let i = 0; i < 400 && keeper._cellarWalk; i++) InnerMap._updateInteriorNpc(keeper, 0.25);
        InnerMap._updateCellarTrips(0);
        expect(InnerMap.npcs).not.toContain(keeper);
        expect(InnerMap.npcs).toContain(drinker);
        expect(InnerMap.npcFloor(keeper)).toBe(-1);
        // Follow them down: there among the casks
        expect(InnerMap.goToFloor(-1, g).ok).toBe(true);
        expect(InnerMap.npcs).toContain(keeper);
        expect(InnerMap.npcs).not.toContain(drinker);
        // The trip is up: back to the steps and up them
        setClock(trip[1]);
        InnerMap._updateCellarTrips(1);
        expect(keeper._cellarWalk && keeper._cellarWalk.dir).toBe('up');
        for (let i = 0; i < 400 && keeper._cellarWalk; i++) InnerMap._updateInteriorNpc(keeper, 0.25);
        InnerMap._updateCellarTrips(0);
        expect(InnerMap.npcs).not.toContain(keeper);
        expect(InnerMap.goToFloor(0, g).ok).toBe(true);
        expect(InnerMap.npcs).toContain(keeper);
    });

    it('seen from the ground floor: they come up the cellar steps carrying what they fetched', () => {
        street();
        const g = game();
        const tavern = { type: 'tavern', name: 'The Bell', q: 3, r: 4 };
        const keeper = person('keeper', { type: 'house', q: 9, r: 9 }, { _work: tavern, job: 'innkeeper', currentBuilding: 'tavern', _insideBuildingQ: 3, _insideBuildingR: 4 });
        InnerMap.npcs = [keeper];
        const trip = firstTrip(keeper);
        // In the middle of the trip: not on the ground floor
        setClock(trip[0] + 1);
        expect(InnerMap.enterBuilding(tavern, g, { force: true })).toBe(true);
        expect(InnerMap.npcs).not.toContain(keeper);
        expect(keeper._cellarBelow).toBe(true);
        setClock(trip[1]);
        InnerMap._updateCellarTrips(1);
        expect(InnerMap.npcs).toContain(keeper);
        const steps = stairsTo(-1);
        expect(Math.max(Math.abs(keeper.q - steps.q), Math.abs(keeper.r - steps.r))).toBeLessThanOrEqual(1);
        expect(keeper.activity && keeper.activity.type).toBe('cellar');
        expect(keeper.activity.label).toMatch(/cellar/);
        // and set it down a moment later
        for (let i = 0; i < 30; i++) InnerMap._cellarTripStep(keeper, 0.5);
        expect(keeper.activity && keeper.activity.type === 'cellar').toBeFalsy();
    });

    it('a customer never goes down; nor anyone where there is no cellar', () => {
        street();
        const g = game();
        const church = { type: 'church', name: 'Church', q: 3, r: 4 };
        const sexton = person('sexton', { type: 'house', q: 9, r: 9 }, { _work: church, currentBuilding: 'church', _insideBuildingQ: 3, _insideBuildingR: 4 });
        InnerMap.npcs = [sexton];
        InnerMap.enterBuilding(church, g, { force: true });
        expect(InnerMap._hasCellar).toBe(false);
        expect(InnerMap._cellarKeeper(sexton)).toBe(false);
        expect(InnerMap._cellarFloorFor(sexton)).toBeNull();
    });
});

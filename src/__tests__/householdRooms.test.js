// A household in its own rooms (world/innerMap/householdRooms.js): by night the
// couple side by side in one bed, the children paired in theirs, the babe in its
// cradle (and in it by day too); awake at home, the day's hearth-keeper to the fire,
// a babe's parents to the cradle, the children by it; supper at the table still.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const W = 14, H = 10;
function street() {
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
    InnerMap.worldDay = 12;
    InnerMap.currentWorldTile = { q: 5, r: 6 };
    InnerMap._currentWorldTileRef = { q: 5, r: 6, settlement: { name: 'Oakby', type: 'village' } };
}
const game = () => ({ player: { technology: { researched: [], implemented: [] }, inventory: {} }, ui: { showNotification() {} } });

function family(house) {
    const at = (id, extra) => ({
        id, name: id, type: 'villager', state: 'inside_building', _home: house, currentBuilding: house.type,
        _insideBuildingQ: house.q, _insideBuildingR: house.r, q: house.q, r: house.r, spouseId: null, parentIds: [], ...extra,
    });
    const father = at('f', { age: 34, spouseId: 'm' });
    const mother = at('m', { age: 31, spouseId: 'f' });
    const kids = [at('k1', { age: 9, type: 'child', parentIds: ['f', 'm'] }), at('k2', { age: 6, type: 'child', parentIds: ['f', 'm'] })];
    const babe = at('b', { age: 1, type: 'child', parentIds: ['f', 'm'] });
    return { father, mother, kids, babe, all: [father, mother, ...kids, babe] };
}

let hour0;
beforeEach(() => { InnerMap._interiorCache = {}; InnerMap._hhPlanCache = null; hour0 = InnerMap.timeOfDay; });
afterEach(() => { if (InnerMap._insideBuilding) InnerMap.exitBuilding(game()); InnerMap.timeOfDay = hour0; });

describe('a household abed in its own beds', () => {
    it('lays the couple side by side, the children in their bed, the babe in its cradle', () => {
        street();
        const g = game();
        const house = { type: 'house', name: 'Cottage', q: 4, r: 3 };
        const fam = family(house);
        InnerMap.npcs = fam.all.slice();
        InnerMap.timeOfDay = 23;
        expect(InnerMap.enterBuilding(house, g)).toBe(true);
        const { father, mother, kids, babe } = fam;
        const plan = InnerMap.householdBedPlan(house);
        for (const n of fam.all) expect(plan.get(n.id)).toBeTruthy();
        // The couple: one bed, a side each; the children paired in another; the babe in the cradle
        const P = id => plan.get(id);
        expect(`${P('f').k}:${P('f').q},${P('f').r}`).toBe(`${P('m').k}:${P('m').q},${P('m').r}`);
        expect([P('f').side, P('m').side].sort()).toEqual([-1, 1]);
        expect(`${P('k1').k}:${P('k1').q},${P('k1').r}`).toBe(`${P('k2').k}:${P('k2').q},${P('k2').r}`);
        expect(`${P('k1').k}:${P('k1').q},${P('k1').r}`).not.toBe(`${P('f').k}:${P('f').q},${P('f').r}`);
        expect(P('b').kind).toBe('cradle');
        // Walk each floor they sleep on: each one laid where the plan has them
        const floors = [...new Set([...plan.values()].map(s => s.k))];
        for (const k of floors) {
            if (k !== (InnerMap._floor || 0)) InnerMap.goToFloor(k, g);
            for (const n of fam.all.filter(x => P(x.id).k === k)) {
                expect(InnerMap.npcs).toContain(n);
                expect(n._asleep).toBeTruthy();
                expect(`${n.q},${n.r}`).toBe(`${P(n.id).q},${P(n.id).r}`);
                expect(InnerMap.tiles[n.r][n.q]._furniture.type).toBe(n === babe ? 'cradle' : 'bed');
            }
        }
        expect([father._asleep.side, mother._asleep.side].sort()).toEqual([-1, 1]);
        expect(babe._asleep.cradle).toBe(true);
        expect(kids[0]._asleep.side).not.toBe(kids[1]._asleep.side);
        // Asleep they stay till the hour comes round
        if (P('f').k !== (InnerMap._floor || 0)) InnerMap.goToFloor(P('f').k, g);
        InnerMap._updateInteriorNpc(father, 1);
        expect(father._asleep).toBeTruthy();
    });

    it('a caller does not take the household\'s beds while others are free', () => {
        street();
        const house = { type: 'house', name: 'Cottage', q: 4, r: 3 };
        const fam = family(house);
        InnerMap.npcs = fam.all.slice();
        InnerMap.timeOfDay = 23;
        const g = game();
        InnerMap.enterBuilding(house, g);
        const plan = InnerMap.householdBedPlan(house);
        // Five people, three pieces: the couple's bed, the children's, the cradle
        expect(plan.size).toBe(5);
        expect(new Set([...plan.values()].map(s => `${s.k}:${s.q},${s.r}`)).size).toBe(3);
        // A traveller put up for the night lies in a bed the household doesn't sleep in, where there is one
        const k = plan.get('f').k;
        if (k !== (InnerMap._floor || 0)) InnerMap.goToFloor(k, g);
        const reserved = InnerMap._householdReserved({ tiles: InnerMap.tiles });
        expect(reserved.size).toBeGreaterThan(0);
        const spare = [];
        for (const row of InnerMap.tiles) for (const t of row) if (t._furniture && t._furniture.type === 'bed' && !(t._furniture.piece && t._furniture.piece.j) && !reserved.has(`${t.q},${t.r}`)) spare.push(t);
        const guest = { id: 'g', name: 'Guest', type: 'villager', state: 'inside_building', _insideBuildingQ: 4, _insideBuildingR: 3, q: 4, r: 3 };
        const abed = InnerMap._townAbed;
        InnerMap._townAbed = (n) => n === guest || abed.call(InnerMap, n);
        InnerMap._sleepersPlaced = [];
        InnerMap._placeNpcOnFloor(guest, { tiles: InnerMap.tiles, width: InnerMap.width, height: InnerMap.height });
        InnerMap._townAbed = abed;
        InnerMap._sleepersPlaced = null;
        expect(guest._asleep).toBeTruthy();
        if (spare.length) expect(reserved.has(`${guest.q},${guest.r}`)).toBe(false);
    });
});

describe('awake at home', () => {
    it('the babe stays in its cradle by day; the parents and children go to it; one keeps the fire', () => {
        street();
        const house = { type: 'house', name: 'Cottage', q: 4, r: 3 };
        const fam = family(house);
        InnerMap.npcs = fam.all.slice();
        InnerMap.timeOfDay = 15;
        const g = game();
        InnerMap.enterBuilding(house, g);
        const { father, mother, kids, babe } = fam;
        // The babe's floor: its parents and the children keep about it by day
        const k = InnerMap.householdBedPlan(house).get('b').k;
        if (k !== (InnerMap._floor || 0)) InnerMap.goToFloor(k, g);
        for (const n of fam.all) expect(InnerMap.npcs).toContain(n);
        expect(babe._asleep && babe._asleep.cradle).toBe(true);
        expect(babe.activity.label).toBe('in the cradle');
        expect(InnerMap._inCradle(babe)).toBe(true);
        // Kept there however long the frame
        InnerMap._updateInteriorNpc(babe, 30);
        expect(babe._asleep && babe._asleep.cradle).toBe(true);
        expect(father._asleep).toBeFalsy();
        // The parents of a babe mind the cradle; the children keep by it
        expect(InnerMap._householdLikes(father)).toEqual(['cradle']);
        expect(InnerMap._householdLikes(mother)).toEqual(['cradle']);
        expect(InnerMap._householdLikes(kids[0])[0]).toBe('cradle');
        expect(InnerMap._householdActFor(mother, 'cradle').label).toBe('minding the baby');
        expect(InnerMap._householdActFor(kids[1], 'cradle').label).toBe('by the cradle');
        // The cradle with the babe in it is still there to be rocked
        const spot = InnerMap._pickFurnitureFor(mother);
        expect(spot).toBeTruthy();
    });

    it('without a babe, the day\'s hearth-keeper tends the fire', () => {
        street();
        const house = { type: 'house', name: 'Cottage', q: 4, r: 3 };
        const fam = family(house);
        const folk = [fam.father, fam.mother, ...fam.kids];
        InnerMap.npcs = folk.slice();
        InnerMap.timeOfDay = 15;
        InnerMap.enterBuilding(house, game());
        const keeper = InnerMap._hearthKeeper(house);
        expect([fam.father, fam.mother]).toContain(keeper);
        expect(InnerMap._householdLikes(keeper)).toEqual(['fireplace']);
        expect(InnerMap._householdActFor(keeper, 'fireplace').label).toBe('tending the fire');
        const other = keeper === fam.father ? fam.mother : fam.father;
        expect(InnerMap._householdLikes(other)).toBeNull();
        // Children by the hearth and the rug
        expect(InnerMap._householdLikes(fam.kids[0])).toEqual(['rug', 'fireplace', 'table']);
        // The same keeper all day (a hash of the day, not a roll)
        expect(InnerMap._hearthKeeper(house)).toBe(keeper);
        // At supper they're at the table, not the fire
        keeper._meal = 'supper';
        expect(InnerMap._householdLikes(keeper)).toBeNull();
        keeper._meal = null;
    });

    it('a caller in the house is no one\'s keeper', () => {
        street();
        const house = { type: 'house', name: 'Cottage', q: 4, r: 3 };
        const fam = family(house);
        const caller = { id: 'c', name: 'Caller', type: 'merchant', state: 'inside_building', currentBuilding: 'house', _insideBuildingQ: 4, _insideBuildingR: 3, q: 4, r: 3 };
        InnerMap.npcs = [fam.father, caller];
        InnerMap.timeOfDay = 15;
        InnerMap.enterBuilding(house, game());
        expect(InnerMap.householdOf(house)).toEqual([fam.father]);
        expect(InnerMap._householdLikes(caller)).toBeNull();
    });
});

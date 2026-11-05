// Buildings of several floors (world/innerMap/floors.js): how many a building
// has (its type, and how high its builders could raise it), the stairs up on
// the ground floor, climbing them to a floor of the same footprint with the
// stairs down where you came up, the folk inside keeping to their own floors,
// and going straight up to a floor from the front door.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const W = 12, H = 8;
function street(settlementType = 'city') {
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
    InnerMap.currentWorldTile = { q: 5, r: 6 };
    InnerMap._currentWorldTileRef = { q: 5, r: 6, settlement: { name: 'Oakby', type: settlementType } };
}
const game = (researched = []) => ({ player: { technology: { researched, implemented: [] }, inventory: {} }, ui: { showNotification() {} } });
const find = (pred) => {
    for (let r = 0; r < InnerMap.height; r++) for (let q = 0; q < InnerMap.width; q++) if (pred(InnerMap.tiles[r][q])) return { q, r };
    return null;
};
/** Every walkable tile of the floor reached from (q, r)? */
function allReached(q0, r0) {
    const seen = new Set([`${q0},${r0}`]);
    const queue = [[q0, r0]];
    while (queue.length) {
        const [q, r] = queue.shift();
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const t = InnerMap.tiles[r + dr] && InnerMap.tiles[r + dr][q + dq];
            const k = `${q + dq},${r + dr}`;
            if (!t || seen.has(k) || !t.subTerrain.passable) continue;
            seen.add(k); queue.push([q + dq, r + dr]);
        }
    }
    for (const row of InnerMap.tiles) for (const t of row) if (t.subTerrain.passable && !seen.has(`${t.q},${t.r}`)) return false;
    return true;
}

beforeEach(() => { InnerMap._interiorCache = {}; });

describe('how many floors a building has', () => {
    it('by its type, and never higher than its builders could raise it', () => {
        street('city');
        expect(InnerMap.floorsOf({ type: 'church', q: 1, r: 1 }, game())).toBe(1);
        const hotel = InnerMap.floorsOf({ type: 'hotel', q: 2, r: 2 }, game());
        expect(hotel).toBeGreaterThanOrEqual(2);
        expect(hotel).toBeLessThanOrEqual(4);
        street('village');
        for (let i = 0; i < 12; i++) expect(InnerMap.floorsOf({ type: 'hotel', q: i, r: 3 }, game())).toBeLessThanOrEqual(2);
    });

    it('the player raises their own as high as the techs they know allow', () => {
        street('town');
        const manor = { type: 'manor', q: 2, r: 2, isPlayerOwned: true };
        expect(InnerMap.floorsOf(manor, game())).toBe(2);
        expect(InnerMap.floorsOf(manor, game(['stonecutting']))).toBe(3);
        expect(InnerMap.floorsOf({ type: 'house', q: 2, r: 2, isPlayerOwned: true }, game(['stonecutting', 'fortification']))).toBe(2);
    });
});

describe('the stairs', () => {
    it('lead up to a floor of the same footprint, the stairs down where you came up', () => {
        street('city');
        const g = game();
        const inn = { type: 'inn', name: 'The Wheel', q: 3, r: 4 };
        expect(InnerMap.enterBuilding(inn, g)).toBe(true);
        expect(InnerMap._floorCount).toBeGreaterThanOrEqual(2);
        const up = find(t => t._stairs && t._stairs.to === 1);
        expect(up).not.toBeNull();
        const ground = { w: InnerMap.width, h: InnerMap.height };
        expect(InnerMap.goToFloor(1, g).ok).toBe(true);
        expect(InnerMap._floor).toBe(1);
        expect({ w: InnerMap.width, h: InnerMap.height }).toEqual(ground);
        const down = InnerMap.tiles[up.r][up.q];
        expect(down._stairs.to).toBe(0);
        expect(find(t => t._isDoor)).toBeNull();
        // Beside the stairs, and the whole floor walkable from them
        expect(Math.max(Math.abs(InnerMap.playerInnerQ - up.q), Math.abs(InnerMap.playerInnerR - up.r))).toBe(1);
        expect(allReached(up.q, up.r)).toBe(true);
        expect(find(t => t._furniture && t._furniture.type === 'bed')).not.toBeNull();
        // Back down, and out
        expect(InnerMap.goToFloor(0, g).ok).toBe(true);
        expect(find(t => t._isDoor)).not.toBeNull();
        expect(InnerMap.exitBuilding(g)).toBe(true);
        expect(InnerMap._floor).toBe(0);
    });

    it('a one-floor building has no stairs going nowhere', () => {
        street('village');
        const g = game();
        expect(InnerMap.enterBuilding({ type: 'church', name: 'Chapel', q: 3, r: 4 }, g)).toBe(true);
        expect(find(t => t._stairs)).toBeNull();
        expect(InnerMap.goToFloor(1, g).ok).toBe(false);
    });

    it('the same floor each time you climb to it', () => {
        street('city');
        const g = game();
        const b = { type: 'town_hall', name: 'Hall', q: 6, r: 2 };
        InnerMap.enterBuilding(b, g);
        InnerMap.goToFloor(1, g);
        const first = JSON.stringify(InnerMap.tiles.map(row => row.map(t => (t._furniture ? t._furniture.type : t.baseTerrain))));
        InnerMap.exitBuilding(g);
        InnerMap.enterBuilding(b, g);
        InnerMap.goToFloor(1, g);
        expect(JSON.stringify(InnerMap.tiles.map(row => row.map(t => (t._furniture ? t._furniture.type : t.baseTerrain))))).toBe(first);
    });
});

describe('the folk inside', () => {
    it('each keep to a floor of their own', () => {
        street('city');
        const g = game();
        const b = { type: 'hotel', name: 'The Crown', q: 3, r: 4 };
        const folk = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, state: 'inside_building', _insideBuildingQ: 3, _insideBuildingR: 4, q: 3, r: 4 }));
        InnerMap.npcs = folk;
        InnerMap.enterBuilding(b, g);
        const ground = InnerMap.npcs.map(n => n.id);
        expect(ground.every(id => InnerMap.npcFloor(folk.find(n => n.id === id)) === 0)).toBe(true);
        InnerMap.goToFloor(1, g);
        expect(InnerMap.npcs.every(n => InnerMap.npcFloor(n) === 1)).toBe(true);
        expect(InnerMap.npcs.length + ground.length).toBeLessThanOrEqual(12);
    });
});

describe('living and sleeping upstairs', () => {
    const resident = (i, home) => ({ id: `r${i}`, name: `R${i}`, type: 'villager', state: 'inside_building', _home: home, currentBuilding: home.type, _insideBuildingQ: home.q, _insideBuildingR: home.r, q: home.q, r: home.r });

    it('by night the household sleeps in the beds upstairs; a caller stays downstairs', () => {
        street('city');
        const g = game();
        const house = { type: 'manor', name: 'Manor', q: 3, r: 4 };
        const folk = [0, 1, 2].map(i => resident(i, house));
        const caller = { id: 'c1', name: 'Caller', type: 'merchant', state: 'inside_building', currentBuilding: 'manor', _insideBuildingQ: 3, _insideBuildingR: 4, q: 3, r: 4 };
        InnerMap.npcs = [...folk, caller];
        InnerMap.timeOfDay = 23;
        InnerMap.enterBuilding(house, g);
        const beds = InnerMap.bedFloors(house);
        expect(beds.every(k => k > 0)).toBe(true);
        expect(InnerMap.npcs.map(n => n.id)).toEqual(['c1']);
        for (const n of folk) expect(beds).toContain(InnerMap.npcFloor(n));
        InnerMap.goToFloor(beds[0], g);
        const sleepers = InnerMap.npcs.filter(n => n._asleep);
        expect(sleepers.length).toBe(InnerMap.npcs.length);
        expect(sleepers.length).toBeGreaterThan(0);
        // Each in a bed of their own (or a bedroll when the beds run out)
        const spots = new Set(sleepers.map(n => `${n.q},${n.r}`));
        expect(spots.size).toBe(sleepers.length);
        for (const n of sleepers.filter(s => !s._asleep.bedroll)) expect(InnerMap.tiles[n.r][n.q]._furniture.type).toBe('bed');
        InnerMap.exitBuilding(g);
        InnerMap.timeOfDay = 8;
    });

    it('come the morning they wake, get up, and go down the stairs', () => {
        street('city');
        const g = game();
        const house = { type: 'manor', name: 'Manor', q: 5, r: 2 };
        const folk = [0, 1, 2, 3].map(i => resident(i, house));
        InnerMap.npcs = folk;
        InnerMap.timeOfDay = 23;
        InnerMap.enterBuilding(house, g);
        InnerMap.goToFloor(InnerMap.bedFloors(house)[0], g);
        const sleeper = InnerMap.npcs.find(n => n._asleep);
        expect(sleeper).toBeTruthy();
        InnerMap._updateInteriorNpc(sleeper, 1);
        expect(sleeper._asleep).toBeTruthy();
        InnerMap.timeOfDay = 9;
        InnerMap._updateInteriorNpc(sleeper, 1);
        expect(sleeper._asleep).toBeNull();
        // Their visit up here over, they make for the stairs down
        sleeper.idleTimer = 0;
        InnerMap._updateInteriorNpc(sleeper, 0.01);
        expect(sleeper._act.phase === 'exit' || sleeper.state === 'leaving_building').toBe(true);
        InnerMap.exitBuilding(g);
        InnerMap.timeOfDay = 8;
    });

    it('by day those who live there keep about the whole house', () => {
        street('city');
        const g = game();
        const house = { type: 'manor', name: 'Manor', q: 7, r: 3 };
        InnerMap.timeOfDay = 11;
        InnerMap.npcs = [];
        InnerMap.enterBuilding(house, g);
        const floors = new Set(Array.from({ length: 30 }, (_, i) => InnerMap.npcFloor(resident(i, house))));
        expect(floors.size).toBe(InnerMap._floorCount);
        InnerMap.exitBuilding(g);
    });
});

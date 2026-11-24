// Upper floors and cellars planned by the interior planner (world/innerMap/floors.js
// _planFloor, data/interiorPlans.json `floors`, data/buildingFloors.json `cellars`),
// and the insides of buildings kept once visited (world/interiorRecords.js,
// world/innerMap/persistInteriors.js): the same plan every time, the stairs lined
// up floor over floor, the cellars under taverns, manors and shops, and a robbed or
// wrecked house staying so across a save and a load, the hour's layer still laid on top.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { InteriorRecords, encodeFloors, decodeFloors, VERSION, CELLAR_VERSION } from '../world/interiorRecords.js';
import { interiorLightMap } from '../ui/interiorLight.js';

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
    InnerMap.timeOfDay = 11;
    InnerMap.currentWorldTile = { q: 5, r: 6 };
    InnerMap._currentWorldTileRef = { q: 5, r: 6, settlement: { name: 'Oakby', type: settlementType } };
}
const newWorld = () => ({ day: 120 });
const game = (world = null) => ({ player: { technology: { researched: [], implemented: [] }, inventory: {} }, ui: { showNotification() {} }, world });

const sig = (interior) => interior.tiles.map(row => row.map(t => (t._stairs ? (t._stairs.to < 0 ? 'v' : t._stairs.to > (interior._floor || 0) ? '^' : 'v')
    : t.baseTerrain === 'wall' ? (t._innerWall ? '+' : '#') : t._furniture ? t._furniture.type[0] : t._doorway ? ':' : '.')).join('')).join('/');
const stairsTo = (interior, to) => {
    for (const row of interior.tiles) for (const t of row) if (t._stairs && t._stairs.to === to) return { q: t.q, r: t.r };
    return null;
};
/** Every walkable tile reached from (q, r)? */
function allReached(interior, q0, r0) {
    const seen = new Set([`${q0},${r0}`]);
    const queue = [[q0, r0]];
    while (queue.length) {
        const [q, r] = queue.shift();
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const t = interior.tiles[r + dr] && interior.tiles[r + dr][q + dq];
            const k = `${q + dq},${r + dr}`;
            if (!t || seen.has(k) || !t.subTerrain.passable) continue;
            seen.add(k); queue.push([q + dq, r + dr]);
        }
    }
    for (const row of interior.tiles) for (const t of row) if (t.subTerrain.passable && !seen.has(`${t.q},${t.r}`)) return false;
    return true;
}
/** Enter, build every floor (the cellar too), and come out (the hour's layer off): → { [floor]: interior }, with n and cellar. */
function visit(b, g) {
    // (forced: a manor is a lord's seat, barred when nobody is home — seats.js)
    expect(InnerMap.enterBuilding(b, g, { force: true })).toBe(true);
    const out = { 0: InnerMap._floorInterior(0) };
    for (let k = 1; k < InnerMap._floorCount; k++) out[k] = InnerMap._floorInterior(k);
    if (InnerMap._hasCellar) out[-1] = InnerMap._floorInterior(-1);
    const info = { n: InnerMap._floorCount, cellar: InnerMap._hasCellar };
    InnerMap.exitBuilding(g);
    Object.defineProperty(out, 'n', { value: info.n });
    Object.defineProperty(out, 'cellar', { value: info.cellar });
    return out;
}

beforeEach(() => { InnerMap._interiorCache = {}; InnerMap._interiorCacheWorld = null; InnerMap._interiorDirty = new Set(); });

describe('upper floors planned, not copied', () => {
    it('the same building is planned the same way every time, floor by floor', () => {
        for (const type of ['inn', 'manor', 'hotel', 'town_hall', 'tavern']) {
            street('city');
            const b = { type, name: type, q: 3, r: 4 };
            const a = visit(b, game());
            const first = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, sig(v)]));
            InnerMap._interiorCache = {};
            const again = visit(b, game());
            expect(Object.fromEntries(Object.entries(again).map(([k, v]) => [k, sig(v)])), type).toEqual(first);
        }
    });

    it('its own rooms upstairs: guest rooms off a landing, a manor\'s bedchambers, solar and servants\' room', () => {
        street('city');
        let found = { guest: 0, solar: 0, servants: 0, differ: 0 };
        for (let i = 0; i < 8; i++) {
            const inn = visit({ type: 'inn', name: 'Inn', q: i, r: 2 }, game());
            const up = inn[1];
            expect(up._planned).toBe(true);
            if (up.tiles.flat().some(t => t._room === 'Guest Room')) found.guest++;
            // the inner walls are its own, not the ground floor's
            const walls = (fl) => fl.tiles.flat().filter(t => t._innerWall).map(t => `${t.q},${t.r}`).join(' ');
            if (walls(up) !== walls(inn[0])) found.differ++;
            const manor = visit({ type: 'manor', name: 'Manor', q: i, r: 5 }, game());
            const rooms = new Set(manor[1].tiles.flat().map(t => t._room).filter(Boolean));
            if (rooms.has('Solar')) found.solar++;
            if (rooms.has('Servants\' Room')) found.servants++;
            expect(manor[1].tiles.flat().some(t => t._furniture && t._furniture.type === 'bed'), 'beds upstairs').toBe(true);
        }
        expect(found.guest).toBeGreaterThan(4);
        expect(found.solar).toBeGreaterThan(2);
        expect(found.servants).toBeGreaterThan(0);
        expect(found.differ).toBeGreaterThan(4);
    });

    it('the stairs line up floor over floor; each floor walkable from its stairs, no door in its front wall', () => {
        street('city');
        for (const type of ['hotel', 'guard_tower', 'manor', 'inn', 'town_hall', 'house']) {
            for (let i = 0; i < 4; i++) {
                const fl = visit({ type, name: type, q: 2 + i, r: 3 }, game());
                const n = fl.n;
                for (let k = 1; k < n; k++) {
                    const up = stairsTo(fl[k - 1], k), down = stairsTo(fl[k], k - 1);
                    expect(up, `${type} ${k}`).not.toBeNull();
                    expect(down, `${type} ${k}`).toEqual(up);
                    expect(fl[k].width).toBe(fl[0].width);
                    expect(fl[k].height).toBe(fl[0].height);
                    expect(fl[k].tiles.flat().some(t => t._isDoor)).toBe(false);
                    expect(allReached(fl[k], down.q, down.r), `${type} ${k} reached`).toBe(true);
                    if (k < n - 1) expect(stairsTo(fl[k], k + 1), `${type} ${k} up`).not.toBeNull();
                }
            }
        }
    });

    it('climbing and coming down, the player stands by the stairs that brought them', () => {
        street('city');
        const g = game();
        InnerMap.enterBuilding({ type: 'hotel', name: 'Crown', q: 4, r: 4 }, g);
        const up = stairsTo(InnerMap._floorInterior(0), 1);
        expect(InnerMap.goToFloor(1, g).ok).toBe(true);
        expect(Math.max(Math.abs(InnerMap.playerInnerQ - up.q), Math.abs(InnerMap.playerInnerR - up.r))).toBe(1);
        expect(InnerMap.goToFloor(0, g).ok).toBe(true);
        InnerMap.exitBuilding(g);
    });
});

describe('cellars', () => {
    it('under taverns, manors and shops — barrels, racks and stores — and none under a church', () => {
        street('city');
        for (const type of ['tavern', 'inn', 'manor', 'bakery', 'apothecary', 'bank']) {
            const fl = visit({ type, name: type, q: 3, r: 4 }, game());
            expect(fl.cellar, type).toBe(true);
            const cellar = fl[-1];
            expect(cellar, type).toBeTruthy();
            const types = new Set(cellar.tiles.flat().filter(t => t._furniture).map(t => t._furniture.type));
            expect(['barrel', 'barrel_rack', 'crate', 'sack', 'chest', 'shelf'].some(x => types.has(x)), type).toBe(true);
            // its steps up where the ground floor's go down; underground: no windows, no door
            const down = stairsTo(fl[0], -1), back = stairsTo(cellar, 0);
            expect(back, type).toEqual(down);
            expect(cellar.tiles.flat().some(t => t._wallDecor === 'window' || t._wallDecor === 'curtains'), type).toBe(false);
            expect(cellar.tiles.flat().some(t => t._isDoor)).toBe(false);
            expect(allReached(cellar, back.q, back.r), type).toBe(true);
            // and never on the stairs up
            const up = stairsTo(fl[0], 1);
            if (up) expect(up).not.toEqual(down);
        }
        const church = visit({ type: 'church', name: 'Church', q: 3, r: 4 }, game());
        expect(church.cellar).toBe(false);
        expect(church[-1]).toBeUndefined();
        expect(stairsTo(church[0], -1)).toBeNull();
        expect(InnerMap.goToFloor(-1, game()).ok).toBe(false);
    });

    it('a manor\'s wine cellar keeps its wine racks; down and up again by the steps', () => {
        street('city');
        const g = game();
        InnerMap.enterBuilding({ type: 'manor', name: 'Manor', q: 6, r: 2 }, g, { force: true });
        const down = stairsTo(InnerMap._floorInterior(0), -1);
        const res = InnerMap.goToFloor(-1, g);
        expect(res.ok).toBe(true);
        expect(res.room.name).toBe('Wine Cellar');
        expect(InnerMap._floor).toBe(-1);
        expect(InnerMap.floorLabel(-1)).toBe('the cellar');
        expect(InnerMap.tiles.flat().some(t => t._furniture && t._furniture.name === 'Wine Rack')).toBe(true);
        expect(Math.max(Math.abs(InnerMap.playerInnerQ - down.q), Math.abs(InnerMap.playerInnerR - down.r))).toBe(1);
        expect(InnerMap._stairsDownTile()).toEqual(down);
        expect(InnerMap.goToFloor(0, g).ok).toBe(true);
        expect(Math.max(Math.abs(InnerMap.playerInnerQ - down.q), Math.abs(InnerMap.playerInnerR - down.r))).toBe(1);
        InnerMap.exitBuilding(g);
    });
});

describe('interiors that persist', () => {
    it('encode and decode give back the same tiles, each its own objects', () => {
        street('city');
        const fl = visit({ type: 'manor', name: 'Manor', q: 1, r: 1 }, game());
        const rec = encodeFloors(fl);
        const back = decodeFloors(JSON.parse(JSON.stringify(rec)));
        for (const k of Object.keys(fl)) {
            expect(back[k].width).toBe(fl[k].width);
            expect(back[k].tiles).toEqual(JSON.parse(JSON.stringify(fl[k].tiles)));
            expect(back[k]._stairs).toEqual(fl[k]._stairs);
            expect(back[k].rooms).toEqual(fl[k].rooms);
        }
        // (two chairs alike are two chairs: breaking one leaves the other whole)
        const chairs = back[0].tiles.flat().filter(t => t._furniture && t._furniture.type === 'chair');
        if (chairs.length > 1) {
            chairs[0]._furniture.broken = true;
            expect(chairs[1]._furniture.broken).toBeUndefined();
        }
        // compact: a manor of every floor and its cellar in well under 40 KB
        expect(JSON.stringify(rec).length).toBeLessThan(40000);
        expect(decodeFloors({ o: [], t: [], f: { 0: { w: 2, h: 2, g: [0] } } })).toBeNull();
    });

    it('a wrecked, robbed house stays so after a save and a load, even when the plans change', () => {
        street('city');
        const world = newWorld();
        const g = game(world);
        const b = { type: 'tavern', name: 'The Boar', q: 4, r: 3 };
        InnerMap.enterBuilding(b, g);
        // every floor built and kept on the first visit
        const kept = InteriorRecords.get(world, InnerMap._floorKey);
        expect(kept).toBeTruthy();
        expect(Object.keys(kept.f).sort()).toEqual(Object.keys(InnerMap._cachedFloors(InnerMap._floorKey)).sort());
        const before = Object.fromEntries(Object.entries(InnerMap._cachedFloors(InnerMap._floorKey)).map(([k, v]) => [k, sig(v)]));
        // Wreck a table and carry off a chest
        const ground = InnerMap._floorInterior(0);
        const table = ground.tiles.flat().find(t => t._furniture && t._furniture.type === 'table');
        table._furniture.broken = true;
        table._furniture.name = 'Broken Table';
        const chest = ground.tiles.flat().find(t => t._furniture && !t._furniture.passable && t._furniture.type !== 'table' && !t._stairs && !t._furniture.piece);
        const at = { q: chest.q, r: chest.r };
        chest._furniture = null;
        chest.subTerrain = { ...chest.subTerrain, id: 'wood_floor', passable: true };
        InnerMap.exitBuilding(g);

        // Saved and loaded: a new world object from the save's JSON (and a new session's cache)
        const saved = JSON.parse(JSON.stringify({ interiors: InteriorRecords.serialize(world) }));
        const loaded = newWorld();
        InteriorRecords.restore(saved.interiors, loaded);
        // …and meanwhile the plans changed (another update): taverns planned without their kitchen
        const P = DataLoader._gamedata.interiorPlans;
        const rooms = P.types.tavern.rooms;
        P.types.tavern.rooms = [];
        try {
            const g2 = game(loaded);
            InnerMap.enterBuilding(b, g2);
            const after = Object.fromEntries(Object.entries(InnerMap._cachedFloors(InnerMap._floorKey)).map(([k, v]) => [k, sig(v)]));
            // the same building as kept, the table still broken and the chest still gone
            expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
            const g0 = InnerMap._floorInterior(0);
            const t2 = g0.tiles[table.r][table.q];
            expect(t2._furniture.broken).toBe(true);
            expect(t2._furniture.name).toBe('Broken Table');
            expect(g0.tiles[at.r][at.q]._furniture).toBeFalsy();
            for (const k of Object.keys(before)) if (Number(k) !== 0) expect(after[k]).toBe(before[k]);
            InnerMap.exitBuilding(g2);
            // a building never visited is planned by the new rules
            InnerMap._interiorCache = {};
            const fresh = { type: 'tavern', name: 'New', q: 9, r: 9 };
            InnerMap.enterBuilding(fresh, game(newWorld()));
            expect(InnerMap.tiles.flat().some(t => t._room === 'Kitchen')).toBe(false);
            InnerMap.exitBuilding(game());
        } finally {
            P.types.tavern.rooms = rooms;
        }
    });

    it('the hour\'s layer still lies over the kept plan, and is never written into it', () => {
        street('city');
        const world = newWorld();
        const g = game(world);
        const b = { type: 'tavern', name: 'Night Owl', q: 2, r: 5 };
        InnerMap.timeOfDay = 23;
        InnerMap.enterBuilding(b, g);
        InnerMap.exitBuilding(g);
        // a new session: laid back from the record
        InnerMap._interiorCache = {};
        InnerMap._interiorCacheWorld = null;
        InnerMap.enterBuilding(b, g);
        const shut = InnerMap.tiles.flat().filter(t => t._wallDecorState === 'shut');
        const lit = InnerMap.tiles.flat().filter(t => t._furniture && t._furniture.lit !== undefined);
        expect(shut.length + lit.length).toBeGreaterThan(0);
        // a save while inside writes the plan, not the night
        expect(InnerMap.flushInteriorRecords(world)).toBeGreaterThan(0);
        const json = JSON.stringify(InteriorRecords.get(world, InnerMap._floorKey));
        expect(json.includes('_wallDecorState')).toBe(false);
        expect(json.includes('"lit"')).toBe(false);
        // …and the night is still on the tiles in front of the player
        expect(InnerMap.tiles.flat().filter(t => t._wallDecorState === 'shut').length).toBe(shut.length);
        InnerMap.exitBuilding(g);
        InnerMap.timeOfDay = 11;
    });

    it('versioned: an older save (none, or another version) loads with none kept; the oldest unvisited let go', () => {
        const w1 = {};
        InteriorRecords.restore(undefined, w1);
        expect(w1.interiors).toEqual({ v: VERSION, b: {} });
        const w2 = {};
        InteriorRecords.restore({ v: VERSION + 1, b: { x: {} } }, w2);
        expect(w2.interiors.b).toEqual({});
        expect(InteriorRecords.serialize(w2)).toBeNull();
        const w3 = {};
        const one = { 0: { tiles: [[{ q: 0, r: 0, baseTerrain: 'wall' }]], width: 1, height: 1 } };
        for (let i = 0; i < 6; i++) InteriorRecords.put(w3, `k${i}`, one, i, 4);
        expect(Object.keys(w3.interiors.b).sort()).toEqual(['k2', 'k3', 'k4', 'k5']);
        InteriorRecords.touch(w3, 'k2', 10);
        InteriorRecords.put(w3, 'k6', one, 7, 4);
        expect(Object.keys(w3.interiors.b)).toContain('k2');
        expect(Object.keys(w3.interiors.b)).not.toContain('k3');
    });

    it('the jail is never kept; a new world starts with an empty cache', () => {
        street('city');
        const world = newWorld();
        expect(InnerMap.keepsInterior({ type: 'jail' })).toBe(false);
        expect(InnerMap.keepsInterior({ type: 'castle' })).toBe(false);
        expect(InnerMap.keepsInterior({ type: 'house' })).toBe(true);
        InnerMap.enterBuilding({ type: 'house', name: 'H', q: 1, r: 2 }, game(world));
        InnerMap.exitBuilding(game(world));
        expect(Object.keys(InnerMap._interiorCache).length).toBeGreaterThan(0);
        InnerMap._interiorCacheFor(newWorld());
        expect(Object.keys(InnerMap._interiorCache).length).toBe(0);
    });
});

// ── Cellars planned as cellars: rows of stores with aisles, a room split off, the landing
// clear, torches spaced for the light, straw and webs (floors.js _dressCellar) ──
const STORES = new Set(['barrel', 'barrel_rack', 'crate', 'crate_stack', 'sack', 'sack_pile', 'chest', 'basket']);
const open = (t) => !!t && t.baseTerrain !== 'wall' && !!t.subTerrain && t.subTerrain.passable;
// (the light spreads over every tile that is no wall, the pieces' too: ui/interiorLight.js)
const bright = (t) => !!t && (t.baseTerrain !== 'wall' || !!t._doorway);
/** The light's distance (8-steps, a diagonal only past two sides it spreads over) from seeds [[q, r, d0]]. */
function floorDist(interior, seeds) {
    const { tiles, width: w, height: h } = interior;
    const d = new Map();
    const get = (q, r) => d.get(`${q},${r}`) ?? Infinity;
    for (const [q, r, d0] of seeds) d.set(`${q},${r}`, Math.min(get(q, r), d0));
    for (let changed = true, pass = 0; changed && pass < w + h; pass++) {
        changed = false;
        for (let r = 1; r < h - 1; r++) for (let q = 1; q < w - 1; q++) {
            if (!bright(tiles[r][q])) continue;
            let best = get(q, r);
            for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
                if ((!i && !j) || !bright(tiles[r + j] && tiles[r + j][q + i])) continue;
                if (i && j && !(bright(tiles[r][q + i]) && bright(tiles[r + j][q]))) continue;
                best = Math.min(best, get(q + i, r + j) + (i && j ? 1.414 : 1));
            }
            if (best < get(q, r)) { d.set(`${q},${r}`, best); changed = true; }
        }
    }
    return get;
}
/** Every piece that stands in the way has a walkable side reached from the steps. */
function piecesReached(interior, q0, r0) {
    const seen = new Set([`${q0},${r0}`]);
    const queue = [[q0, r0]];
    while (queue.length) {
        const [q, r] = queue.shift();
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const t = interior.tiles[r + dr] && interior.tiles[r + dr][q + dq];
            if (!t || seen.has(`${q + dq},${r + dr}`) || !t.subTerrain.passable) continue;
            seen.add(`${q + dq},${r + dr}`); queue.push([q + dq, r + dr]);
        }
    }
    for (const row of interior.tiles) for (const t of row) {
        if (!t._furniture || t._furniture.passable || t._stairs) continue;
        if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dq, dr]) => seen.has(`${t.q + dq},${t.r + dr}`))) return false;
    }
    return true;
}

describe('cellars planned as cellars', () => {
    const kinds = { tavern: 'Cold Store', inn: 'Cold Store', manor: 'Wine Vault', warehouse: 'Grain Store', guildhall: 'Grain Store', bank: 'Strongroom', mint: 'Strongroom' };
    const vaulted = (type) => type === 'bank' || type === 'mint';

    it('stores in rows with aisles, filled out by the cellar\'s size; every piece reached from the steps', () => {
        street('city');
        for (const type of Object.keys(kinds)) {
            for (let i = 0; i < 3; i++) {
                const c = visit({ type, name: type, q: 2 + i * 5, r: 3 + i }, game())[-1];
                const up = stairsTo(c, 0);
                expect(allReached(c, up.q, up.r), `${type} ${i}`).toBe(true);
                expect(piecesReached(c, up.q, up.r), `${type} ${i}`).toBe(true);
                const floor = c.tiles.flat().filter(t => t.baseTerrain !== 'wall').length;
                const stores = c.tiles.flat().filter(t => t._furniture && STORES.has(t._furniture.type));
                // (no longer a line along the back wall: a good share of the floor is stores)
                expect(stores.length / floor, `${type} ${i}`).toBeGreaterThan(vaulted(type) ? 0.08 : 0.18);
                const offBack = stores.filter(t => t.r > 1).length;
                expect(offBack, `${type} ${i}: stores off the back wall`).toBeGreaterThan(vaulted(type) ? 1 : 4);
                // rows: a run of three or more stores side by side, off the back wall
                let rowRun = false;
                for (const row of c.tiles) {
                    let n = 0;
                    for (const t of row) {
                        n = t._furniture && STORES.has(t._furniture.type) && t.r > 1 ? n + 1 : 0;
                        if (n >= 3) rowRun = true;
                    }
                }
                if (!vaulted(type)) expect(rowRun, `${type} ${i}: a row of stores`).toBe(true);
            }
        }
    });

    it('a room split off behind an inner wall and its doorway: a cold store, a wine vault, a grain store, a strongroom', () => {
        street('city');
        for (const [type, room] of Object.entries(kinds)) {
            let found = 0;
            for (let i = 0; i < 3; i++) {
                const c = visit({ type, name: type, q: 3 + i * 4, r: 2 + i }, game())[-1];
                const cells = c.tiles.flat().filter(t => t._room === room);
                if (!cells.length) continue;
                found++;
                expect(c.tiles.flat().some(t => t._innerWall), type).toBe(true);
                expect(c.tiles.flat().some(t => t._doorway), type).toBe(true);
                // (the strongroom keeps the strongboxes)
                if (room === 'Strongroom') expect(cells.some(t => t._furniture && t._furniture.type === 'chest'), type).toBe(true);
            }
            expect(found, `${type}: ${room}`).toBeGreaterThan(0);
        }
    });

    it('the landing round the steps kept clear; floor decor only on bare floor; torches cover the floor, none side by side', () => {
        street('city');
        const dress = DataLoader._gamedata.buildingFloors.cellarDress._default;
        const R = dress.torch.cover, Rc = dress.stand.cover;
        let webs = 0, strewn = 0;
        for (const type of Object.keys(kinds)) {
            for (let i = 0; i < 2; i++) {
                const c = visit({ type, name: type, q: 4 + i * 6, r: 1 + i * 2 }, game())[-1];
                const up = stairsTo(c, 0);
                for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
                    const t = c.tiles[up.r + dr] && c.tiles[up.r + dr][up.q + dq];
                    if (!t || t.baseTerrain === 'wall' || (!dq && !dr)) continue;
                    expect(t._furniture, `${type} landing`).toBeFalsy();
                    expect(t._decor, `${type} landing`).toBeFalsy();
                }
                for (const t of c.tiles.flat()) {
                    if (['straw_loose', 'grain_spill', 'puddle'].includes(t._decor)) {
                        strewn++;
                        expect(t._furniture || t.baseTerrain === 'wall' || t._doorway).toBeFalsy();
                        expect(t.subTerrain.passable).toBe(true);
                    }
                    if (t._wallDecor === 'cobweb' || t._wallDecor === 'cobweb_r') { webs++; expect(t.r).toBe(0); }
                }
                // lights: wall torches (the floor before them) and candles (less far)
                const seeds = [], candles = [];
                const torches = [];
                for (const t of c.tiles.flat()) {
                    if (t._wallDecor === 'torch') {
                        torches.push(t);
                        for (const [dq, dr] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) if (bright(c.tiles[t.r + dr] && c.tiles[t.r + dr][t.q + dq])) seeds.push([t.q + dq, t.r + dr, 0.6]);
                    } else if (t._furniture && t._furniture.type === 'candle') candles.push([t.q, t.r, 0]);
                }
                expect(torches.length, type).toBeGreaterThan(0);
                for (const a of torches) for (const b of torches) if (a !== b) expect(Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r)), `${type} torches apart`).toBeGreaterThan(1);
                const dist = floorDist(c, seeds), distC = floorDist(c, candles);
                for (const t of c.tiles.flat()) {
                    if (!open(t) || t._stairs) continue;
                    expect(dist(t.q, t.r) <= R + 1e-6 || distC(t.q, t.r) <= Rc + 1e-6, `${type} ${t.q},${t.r} lit`).toBe(true);
                }
                // never a painting or a window down here
                expect(c.tiles.flat().some(t => /painting|window|curtains/.test(String(t._wallDecor || ''))), type).toBe(false);
            }
        }
        expect(webs).toBeGreaterThan(0);
        expect(strewn).toBeGreaterThan(0);
    });

    it('dark at every hour: no daylight down a cellar, its torches lit at noon', () => {
        street('city');
        const c = visit({ type: 'tavern', name: 'Cask', q: 5, r: 5 }, game())[-1];
        const ART = DataLoader._gamedata.innerMapRenderer && DataLoader._gamedata.innerMapRenderer.interiorArt;
        const noon = interiorLightMap(c.tiles, 12, { art: ART });
        expect(noon.d).toBe(0);
        expect(noon.night).toBe(true);
        expect(noon.sources.some(s => s.kind === 'torch')).toBe(true);
        const night = interiorLightMap(c.tiles, 0, { art: ART });
        expect(Array.from(noon.mul)).toEqual(Array.from(night.mul));
    });

    it('versioned cellars: a cellar kept from an older plan is planned afresh, the floors above stay as kept', () => {
        street('city');
        const world = newWorld();
        const g = game(world);
        const b = { type: 'tavern', name: 'Old Cask', q: 7, r: 2 };
        InnerMap.enterBuilding(b, g);
        const key = InnerMap._floorKey;
        InnerMap.exitBuilding(g);
        const rec = InteriorRecords.get(world, key);
        expect(rec.cv).toBe(CELLAR_VERSION);
        const freshCellar = sig(InnerMap._cachedFloors(key)[-1]);
        // An older save's record: its cellar of the old plan (here: emptied), its ground floor changed by the player
        const old = InteriorRecords.load(world, key);
        for (const t of old[-1].tiles.flat()) if (t._furniture && !t._stairs) { t._furniture = null; t.subTerrain = { ...t.subTerrain, passable: true }; }
        const table = old[0].tiles.flat().find(t => t._furniture && t._furniture.type === 'table');
        table._furniture.name = 'Scarred Table';
        InteriorRecords.put(world, key, old, 100);
        world.interiors.b[key].cv = 1;
        expect(InteriorRecords.staleCellar(world.interiors.b[key])).toBe(true);
        // A new session: the ground floor as kept, the cellar planned again by today's plan
        InnerMap._interiorCache = {};
        InnerMap._interiorCacheWorld = null;
        InnerMap.enterBuilding(b, g);
        const after = InnerMap._cachedFloors(key);
        expect(after[0].tiles[table.r][table.q]._furniture.name).toBe('Scarred Table');
        expect(sig(after[-1])).toBe(freshCellar);
        InnerMap.exitBuilding(g);
        // …and kept anew under the current plan
        expect(world.interiors.b[key].cv).toBe(CELLAR_VERSION);
        expect(InteriorRecords.staleCellar(world.interiors.b[key])).toBe(false);
        expect(InteriorRecords.staleCellar({ cv: CELLAR_VERSION, f: { '-1': {} } })).toBe(false);
        expect(InteriorRecords.staleCellar({ f: { 0: {} } })).toBe(false);
    });
});

// Interiors planned by rules (world/innerMap/interiorPlanner.js, data/interiorPlans.json):
// each building its own size, rooms, furniture and decor from its seed; the way in and
// every room reached from the door; every piece usable from a side; the pieces the
// systems look for still there; the decor from its vocabulary.
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const TYPES = () => Object.keys(InnerMap.INTERIOR_LAYOUTS);
const P = () => DataLoader._gamedata.interiorPlans;

/** Plan one building directly (the jail and castle have their own generators on entry). */
function plan(type, q = 3, r = 4, tier = null, key = null) {
    const base = InnerMap.INTERIOR_LAYOUTS[type];
    const look = { wall: base.wall, floor: base.floor, tier, kind: (DataLoader._gamedata.architecture.wealth.floors.work || []).includes(type) ? 'work' : 'home', tint: null };
    const seed = key || `9,14_${type}_${q}_${r}`;
    const out = InnerMap._planInterior({ type, name: type, q, r }, seed, base, look, null);
    InnerMap._joinPieces(out.tiles, out.width, out.height, { q: Math.floor(out.width / 2), r: out.height - 1 });
    InnerMap._decorateInterior(out.tiles, out.width, out.height, out.info);
    return out;
}

const sig = (room) => room.tiles.map(row => row.map(t => (t.baseTerrain === 'wall' ? '#' : t._furniture ? t._furniture.type[0] : '.')).join('')).join('/');

/** BFS from the door over passable tiles. */
function reached(room) {
    const { tiles, width: w, height: h } = room;
    const start = { q: Math.floor(w / 2), r: h - 1 };
    const seen = new Set([`${start.q},${start.r}`]), queue = [start];
    while (queue.length) {
        const { q, r } = queue.shift();
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const t = tiles[r + dr] && tiles[r + dr][q + dq];
            if (!t || seen.has(`${q + dq},${r + dr}`) || !t.subTerrain.passable) continue;
            seen.add(`${q + dq},${r + dr}`); queue.push({ q: q + dq, r: r + dr });
        }
    }
    return seen;
}

const furniture = (room) => room.tiles.flat().filter(t => t._furniture).map(t => t._furniture);

describe('interiors planned by rules', () => {
    it('the same building is planned the same way every time; two of a type differ', () => {
        for (const type of TYPES()) {
            expect(sig(plan(type, 3, 4)), type).toBe(sig(plan(type, 3, 4)));
        }
        for (const type of ['house', 'tavern', 'inn', 'blacksmith', 'church', 'manor', 'warehouse']) {
            const a = sig(plan(type, 3, 4)), b = sig(plan(type, 11, 7)), c = sig(plan(type, 20, 2));
            expect(a !== b || a !== c, type).toBe(true);
        }
        // (and across a street of houses, many plans)
        const houses = new Set();
        for (let i = 0; i < 12; i++) houses.add(sig(plan('house', i, 2 * i)));
        expect(houses.size).toBeGreaterThan(8);
    });

    it('every type generates, its required pieces there; the way in and every piece reached', () => {
        const need = {
            inn: ['bed', 'bar', 'fireplace'], tavern: ['bar', 'table', 'barrel', 'fireplace'], guest_house: ['bed', 'bar'], hotel: ['bed', 'bar'],
            roadhouse: ['bed', 'bar'], blacksmith: ['anvil', 'forge', 'chest'], church: ['altar', 'pew'], chapel: ['altar', 'pew'],
            temple: ['altar', 'pew'], house: ['bed', 'fireplace', 'chest', 'table'], manor: ['throne', 'bed', 'chest', 'fireplace'],
            town_hall: ['throne', 'table', 'desk'], barracks: ['bed', 'rack'], bank: ['bar', 'chest'], bathhouse: ['tub', 'fireplace'],
            bakery: ['oven'], mill: ['millstone'], mint: ['forge', 'press', 'anvil'], marketplace: ['stall'], stable: ['stall'],
            well: ['well'], warehouse: ['crate', 'chest'], granary: ['barrel', 'sack'], apothecary: ['cauldron', 'bed', 'bar'],
        };
        for (const type of TYPES()) {
            for (const tier of ['poor', 'mid', 'rich']) for (const [q, r] of [[3, 4], [8, 1], [15, 12], [2, 30]]) {
                const room = plan(type, q, r, tier);
                const tag = `${type}/${tier}@${q},${r}`;
                const types = new Set(furniture(room).map(f => f.type));
                // every required piece's type (INTERIOR_LAYOUTS), as the tier keeps house
                const kind = (DataLoader._gamedata.architecture.wealth.floors.work || []).includes(type) ? 'work' : 'home';
                for (const f of InnerMap._furnishByTier(InnerMap.INTERIOR_LAYOUTS[type].furniture, tier, kind)) {
                    if (f.type === 'stairs') continue;
                    expect(types.has(f.type), `${tag} ${f.type}`).toBe(true);
                }
                for (const t of need[type] || []) expect(types.has(t), `${tag} ${t}`).toBe(true);
                // the door at the bottom middle, the tile inside it open
                const { tiles, width: w, height: h } = room;
                expect(tiles[h - 1][Math.floor(w / 2)]._isDoor, tag).toBe(true);
                expect(tiles[h - 2][Math.floor(w / 2)].subTerrain.passable, tag).toBe(true);
                // every walkable tile (every room) reached from the door
                const seen = reached(room);
                for (const t of tiles.flat()) if (t.subTerrain.passable) expect(seen.has(`${t.q},${t.r}`), `${tag} ${t.q},${t.r}`).toBe(true);
                // every impassable piece has a reachable side to be used from
                const pieces = new Map();
                for (const t of tiles.flat()) {
                    const f = t._furniture;
                    if (!f || f.passable) continue;
                    const k = f.piece ? `${f.piece.q},${f.piece.r}` : `${t.q},${t.r}`;
                    if (!pieces.has(k)) pieces.set(k, []);
                    pieces.get(k).push(t);
                }
                for (const [k, cells] of pieces) {
                    const usable = cells.some(t => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dq, dr]) => seen.has(`${t.q + dq},${t.r + dr}`)));
                    expect(usable, `${tag} piece ${k} ${cells[0]._furniture.type}`).toBe(true);
                }
            }
        }
    });

    it('the bigger buildings have rooms: inner walls with doorways, each room reached', () => {
        for (const type of ['inn', 'tavern', 'manor', 'blacksmith', 'town_hall', 'barracks', 'hotel', 'guest_house', 'bank']) {
            for (let i = 0; i < 6; i++) {
                const room = plan(type, i * 3, i + 1, 'mid');
                const flat = room.tiles.flat();
                expect(flat.some(t => t._innerWall && t.baseTerrain === 'wall'), `${type} ${i}`).toBe(true);
                const doorways = flat.filter(t => t._doorway);
                expect(doorways.length, `${type} ${i}`).toBeGreaterThan(0);
                expect(doorways.every(t => t.subTerrain.passable && t.baseTerrain !== 'wall')).toBe(true);
                expect(room.rooms.length, `${type} ${i}`).toBeGreaterThan(1);
                const seen = reached(room);
                for (const rm of room.rooms) {
                    const cells = flat.filter(t => t._roomId === rm.id);
                    expect(cells.some(t => seen.has(`${t.q},${t.r}`)), `${type} ${rm.id}`).toBe(true);
                }
            }
        }
        // the inn's guest rooms have its room beds; a poor house is one room
        const inn = plan('inn', 4, 4, 'mid');
        expect(inn.tiles.flat().some(t => t._room === 'Guest Room' && t._furniture && t._furniture.type === 'bed')).toBe(true);
        expect(plan('house', 4, 4, 'poor').rooms.length).toBe(1);
    });

    it('decor only from its vocabulary: things on the furniture, hangings on walls, windows on the back wall', () => {
        const items = new Set(P().decorItems), walls = new Set(P().wallDecor);
        expect(items.size).toBe(15);
        expect(walls.size).toBe(14);
        const on = new Set(P().decorOn);
        let decor = 0, wallDecor = 0, windows = 0;
        for (const type of TYPES()) for (const tier of ['poor', 'mid', 'rich']) for (let i = 0; i < 3; i++) {
            const room = plan(type, i * 5, i * 2 + 1, tier);
            for (const t of room.tiles.flat()) {
                if (t._decor) {
                    decor++;
                    expect(items.has(t._decor), t._decor).toBe(true);
                    expect(t._furniture && on.has(t._furniture.type)).toBe(true);
                }
                if (t._wallDecor) {
                    wallDecor++;
                    expect(walls.has(t._wallDecor), t._wallDecor).toBe(true);
                    expect(t.baseTerrain).toBe('wall');
                    expect(['down', 'left', 'right']).toContain(t._wallDecorFace);
                    if ((t._wallDecor === 'window' || t._wallDecor === 'curtains') && t.r === 0) windows++;
                }
            }
        }
        expect(decor).toBeGreaterThan(100);
        expect(wallDecor).toBeGreaterThan(200);
        expect(windows).toBeGreaterThan(50);
        // a tavern's drink on its tables and counter; a smithy's tools; a town hall's papers
        const all = (type, f) => { const s = new Set(); for (let i = 0; i < 8; i++) for (const t of plan(type, i, i * 3).tiles.flat()) if (f(t)) s.add(f(t)); return s; };
        expect([...all('tavern', t => t._decor)].some(x => x === 'mugs' || x === 'bottles')).toBe(true);
        expect(all('blacksmith', t => t._decor).has('tools')).toBe(true);
        expect([...all('town_hall', t => t._decor)].some(x => x === 'papers' || x === 'books')).toBe(true);
        expect(all('blacksmith', t => t._wallDecor).has('weapon_rack')).toBe(true);
        // the rich hang finery the poor never do
        const fine = (tier) => { let n = 0; for (let i = 0; i < 10; i++) for (const t of plan('house', i, i, tier).tiles.flat()) if (['painting', 'tapestry', 'mirror', 'clock'].includes(t._wallDecor)) n++; return n; };
        expect(fine('poor')).toBe(0);
        expect(fine('rich')).toBeGreaterThan(fine('mid'));
    });

    it('wealth still changes the furnishing: more pieces up the tiers, straw for the poor', () => {
        const count = (tier) => { let n = 0; for (let i = 0; i < 8; i++) n += furniture(plan('house', i, 2 * i, tier)).length; return n; };
        expect(count('rich')).toBeGreaterThan(count('mid'));
        expect(count('mid')).toBeGreaterThan(count('poor'));
        const poor = furniture(plan('house', 1, 1, 'poor'));
        expect(poor.filter(f => f.type === 'bed').every(f => f.art === 'straw')).toBe(true);
        expect(poor.some(f => f.type === 'rug' || f.type === 'candle')).toBe(false);
    });

    it('the planner\'s new pieces come from the vocabulary; pews face the altar', () => {
        const known = new Set([...Object.keys(InnerMap.FURNITURE_COLORS), ...Object.keys(P().pieces)]);
        for (const type of TYPES()) for (const tier of ['poor', 'rich']) {
            for (const f of furniture(plan(type, 6, 6, tier))) expect(known.has(f.type), `${type} ${f.type}`).toBe(true);
        }
        const church = plan('church', 2, 2, 'mid');
        const pews = church.tiles.flat().filter(t => t._furniture && t._furniture.type === 'pew');
        expect(pews.length).toBeGreaterThan(3);
        expect(pews.every(t => t._furniture.facing === 'up')).toBe(true);
    });

    it('entering a building plans it, caches it, and the player starts inside the door', () => {
        InnerMap.active = true;
        InnerMap._insideBuilding = null;
        InnerMap.currentWorldTile = { q: 9, r: 14 };
        InnerMap.tiles = [[{ q: 0, r: 0, subTerrain: { passable: true } }]];
        InnerMap.width = 1; InnerMap.height = 1;
        InnerMap.npcs = []; InnerMap.buildings = []; InnerMap.roads = [];
        InnerMap._interiorCache = {};
        const b = { type: 'tavern', name: 'The Bell', q: 7, r: 9 };
        expect(InnerMap.enterBuilding(b, { player: null, world: null })).toBe(true);
        const t = InnerMap.tiles[InnerMap.playerInnerR][InnerMap.playerInnerQ];
        expect(t.subTerrain.passable).toBe(true);
        expect(InnerMap.tiles.flat().some(x => x._room === 'Kitchen' || x._room === 'Taproom')).toBe(true);
        const first = sig({ tiles: InnerMap.tiles });
        InnerMap.exitBuilding({ player: null, world: null });
        InnerMap.enterBuilding(b, { player: null, world: null });
        expect(sig({ tiles: InnerMap.tiles })).toBe(first);
        InnerMap.exitBuilding({ player: null, world: null });
    });

    it('a planned home of the player\'s takes all its pieces into its layout; what stood on one goes with it', async () => {
        const { Player } = await import('../player/player.js');
        const player = new Player();
        InnerMap.active = true;
        InnerMap._insideBuilding = null;
        InnerMap.currentWorldTile = { q: 5, r: 6 };
        InnerMap._currentWorldTileRef = { q: 5, r: 6, settlement: { name: 'Oakby', type: 'town' } };
        InnerMap.tiles = [[{ q: 0, r: 0, subTerrain: { passable: true } }]];
        InnerMap.width = 1; InnerMap.height = 1;
        InnerMap.npcs = []; InnerMap.buildings = []; InnerMap.roads = [];
        InnerMap._interiorCache = {};
        const house = { type: 'house', name: 'House (Yours)', q: 13, r: 2, isPlayerOwned: true, ownerId: 'player' };
        expect(InnerMap.enterBuilding(house, { player, ui: { showNotification() {} } })).toBe(true);
        const before = InnerMap.tiles.flat().filter(t => t._furniture && !t._stairs && !(t._furniture.piece && (t._furniture.piece.i || t._furniture.piece.j))).length;
        const rec = InnerMap.adoptHomeFurniture(player);
        expect(rec.adopted).toBe(true);
        expect(rec.pieces.length).toBe(before);
        const withDecor = InnerMap.tiles.flat().find(t => t._decor && t._furniture && t._furniture._piece);
        if (withDecor) {
            InnerMap.liftPiece(player, withDecor._furniture._piece);
            expect(withDecor._decor).toBeFalsy();
        }
        InnerMap.exitBuilding({ player, world: null });
    });
});

// (a picture of a plan for the eye: npx vitest run src/__tests__/interiorPlanner.test.js with PLAN_DUMP=type)
if (typeof process !== 'undefined' && process.env && process.env.PLAN_DUMP) {
    describe('dump', () => {
        it('draws', () => {
            const G = { bed: 'B', table: 'T', bar: '=', barrel: 'o', fireplace: 'F', chest: 'c', rug: '~', candle: 'i', banner: '^', stairs: 'S', altar: 'A', pew: 'p',
                forge: 'F', anvil: 'n', rack: 'R', sack: 's', crate: 'x', throne: 'K', bookshelf: 'L', desk: 'D', shelf: 'h', bucket: 'u', tub: 'U', chair: 'h', cupboard: 'C',
                workbench: 'W', dresser: 'd', wardrobe: 'w', firewood: 'f', basket: 'b', plant: '*', washstand: 'v', sack_pile: 's', crate_stack: 'X', barrel_rack: 'O', coat_rack: 'k', spinning_wheel: 'g', loom: 'l', cradle: 'y', lectern: 'e', candle_: 'i' };
            if (process.env.PLAN_DUMP === 'stats') {
                for (const type of TYPES()) for (const tier of ['poor', 'mid', 'rich']) {
                    const got = {};
                    let ms = 0;
                    for (let i = 0; i < 40; i++) {
                        const t0 = performance.now();
                        const room = plan(type, i, i * 7 % 13, tier);
                        ms += performance.now() - t0;
                        for (const rm of room.rooms) got[rm.name] = (got[rm.name] || 0) + 1;
                    }
                    console.log(`${type}/${tier} ${(ms / 40).toFixed(2)}ms ${JSON.stringify(got)}`);
                }
                return;
            }
            for (const spec of process.env.PLAN_DUMP.split(',')) {
                const [type, tier = 'mid', q = '3', r = '4'] = spec.split('/');
                const room = plan(type, Number(q), Number(r), tier);
                const lines = room.tiles.map(row => row.map(t => (t._isDoor ? 'D' : t._doorway ? ':' : t.baseTerrain === 'wall' ? (t._wallDecor === 'window' || t._wallDecor === 'curtains' ? 'w' : t._wallDecor ? '+' : '#') : t._furniture ? (G[t._furniture.type] || '?') : '.')).join(''));
                console.log(`${type} ${tier} @${q},${r}  ${room.width}x${room.height}  rooms: ${room.rooms.map(x => x.name).join(', ')}\n${lines.join('\n')}`);
            }
        });
    });
}

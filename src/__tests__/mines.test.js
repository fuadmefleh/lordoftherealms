/**
 * Caves and mines (world/innerMap/mines.js, ui/innerMapMining.js, ui/caveArt.js)
 * and the bigger crags of terrainGen 9 (world/innerMap/cliffs.js).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { InnerMap } from '../world/innerMap.js';
import { Mines } from '../world/innerMap/mines.js';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { caveCells, aditCell, shaftCell } from '../ui/caveArt.js';
import { InnerMapMining } from '../ui/innerMapMining.js';
import { InnerMapDigging } from '../ui/innerMapDigging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = f => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data', f), 'utf-8'));
const INNER_MAP_JSON = read('innerMap.json');
const MINING = read('mining.json');
const PRACTICE = read('practiceSkills.json');
const WILD = read('skillPacks/wild.json');

/** A blank street map of grass, W x H. */
function blank(W = 128, H = 128) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, baseTerrain: 'grass', subTerrain: { id: 'grass', name: 'Grass', passable: true }, explored: true, visible: true });
        tiles.push(row);
    }
    return tiles;
}

/** Lay the bigger crags of a terrainGen 9 world on a blank map and make it the map. */
function bigMap(wq, wr, terrain = 'mountain') {
    const tiles = blank();
    InnerMap.tiles = tiles;
    InnerMap.width = 128;
    InnerMap.height = 128;
    InnerMap._climbLinkCache = null;
    const n = InnerMap._layCliffs(tiles, { terrain: { id: terrain } }, wq, wr, { terrainGen: 9 });
    return { tiles, n };
}

/** Into an underground site's map without the street map (the record on world). */
function under(kind, world, opts = {}) {
    const hexKey = '4,4';
    const key = Mines.siteKey(kind, 10, 10);
    InnerMap._mineWorld = world;
    const building = { type: kind === 'cave' ? 'cave' : 'mine', name: 'x', q: 10, r: 10, _underground: { kind, key, hexKey, seed: opts.seed || 99, terrainId: opts.terrain || 'mountain', resource: opts.resource || null } };
    const it = InnerMap._generateUnderground(building);
    InnerMap._insideBuilding = building;
    InnerMap.tiles = it.tiles;
    InnerMap.width = it.width;
    InnerMap.height = it.height;
    return it;
}

beforeEach(() => {
    InnerMap.initialize(JSON.parse(JSON.stringify(INNER_MAP_JSON)));
    InnerMap._cache = {};
    InnerMap.season = 'summer';
    InnerMap.active = true;
    DataLoader._gamedata = { terrainNineTileBrushes: [], mining: JSON.parse(JSON.stringify(MINING)), practiceSkills: { ...PRACTICE, skills: { ...PRACTICE.skills, ...WILD.skills } }, playerEconomy: { GOODS: {} } };
    Utils.setSeed(4242);
});

afterEach(() => {
    InnerMap._insideBuilding = null;
    InnerMap._outerMapState = null;
    InnerMapDigging.cancel();
});

describe('the underground layout', () => {
    it('is the same for the same seed; a cave opens from its mouth, all of a piece', () => {
        const a = Mines.layout({ kind: 'cave', seed: 123, terrainId: 'mountain' });
        const b = Mines.layout({ kind: 'cave', seed: 123, terrainId: 'mountain' });
        expect(a.cell.join('')).toBe(b.cell.join(''));
        expect(a.vein.join(',')).toBe(b.vein.join(','));
        const open = a.cell.filter(c => c === 'F').length;
        expect(open).toBeGreaterThan(100);
        // every open cell joins the entry
        const seen = new Set([a.entry.r * a.w + a.entry.q]);
        const stack = [a.entry.r * a.w + a.entry.q];
        while (stack.length) {
            const i = stack.pop();
            const q = i % a.w, r = (i / a.w) | 0;
            for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const j = (r + dr) * a.w + q + dq;
                if (!seen.has(j) && a.cell[j] === 'F') { seen.add(j); stack.push(j); }
            }
        }
        expect(seen.size).toBe(open);
        // the rim is bedrock, the way out at the bottom
        expect(a.cell[0]).toBe('B');
        expect(a.cell[a.exit.r * a.w + a.exit.q]).toBe('X');
        expect(a.vein.some(Boolean)).toBe(true);
    });

    it('a mine is solid rock but its first cell, veined by the hex\'s geology', () => {
        const L = Mines.layout({ kind: 'adit', seed: 7, terrainId: 'hills' });
        expect(L.cell.filter(c => c === 'F').length).toBe(1);
        const ores = new Set(L.vein.filter(Boolean));
        for (const o of ores) expect(MINING.geology.terrains.hills.map(e => e.item)).toContain(o);
        expect(L.loose.every(x => x === null)).toBe(true);
    });

    it('the hex\'s own resource weighs its veins', () => {
        const plain = Mines.veinTable('hills', null);
        const gold = Mines.veinTable('hills', 'gold_ore');
        expect(plain.find(e => e.item === 'gold_ore')).toBeUndefined();
        const g = gold.find(e => e.item === 'gold_ore');
        expect(g.weight).toBeGreaterThanOrEqual(Math.max(...plain.map(e => e.weight)));
        const iron = Mines.veinTable('hills', 'iron').find(e => e.item === 'ore');
        expect(iron.weight).toBeGreaterThan(plain.find(e => e.item === 'ore').weight);
    });
});

describe('cutting a mine by hand', () => {
    it('cuts rock beside open ground to rubble, hauls it to floor, and the record keeps it', () => {
        const world = { day: 3 };
        const { tiles } = under('adit', world);
        const e = tiles._underground.entry;
        expect(InnerMap.mineCanCut(e.q, e.r - 1)).toBe(true);
        expect(InnerMap.mineCanCut(e.q, e.r - 2)).toBe(false);   // not beside open ground
        expect(InnerMap.mineCanCut(0, 5)).toBe(false);           // bedrock
        const cut = InnerMap.mineCut(e.q, e.r - 1);
        expect(cut).not.toBeNull();
        const t = InnerMap.getTile(e.q, e.r - 1);
        expect(t._cave).toBe('rubble');
        expect(t.subTerrain.passable).toBe(false);
        expect(InnerMap.mineHaul(e.q, e.r - 1)).toBe(true);
        expect(t._cave).toBe('floor');
        expect(t.subTerrain.passable).toBe(true);
        expect(t._mined).toBe(true);
        const site = world.mines['4,4'].sites['adit:10,10'];
        expect(site.cells[`${e.q},${e.r - 1}`]).toBe('f');
        // drawn again from the record (as after a save): the same
        const again = under('adit', JSON.parse(JSON.stringify(world))).tiles;
        expect(again[e.r - 1][e.q]._cave).toBe('floor');
        expect(again[e.r - 1][e.q]._mined).toBe(true);
    });

    it('the roof grows heavy over unpropped dug ground; timbers hold it', () => {
        const world = { day: 3 };
        const { tiles } = under('adit', world);
        const e = tiles._underground.entry;
        // a gallery five deep, cut and hauled
        for (let i = 1; i <= 6; i++) { InnerMap.mineCut(e.q, e.r - i); InnerMap.mineHaul(e.q, e.r - i); }
        const risk = InnerMap.mineRoofRisk(e.q, e.r - 6);
        expect(risk.open).toBeGreaterThan(MINING.support.free);
        expect(risk.chance).toBeGreaterThan(0);
        InnerMap.mineProp(e.q, e.r - 4);
        expect(InnerMap.mineRoofRisk(e.q, e.r - 6).chance).toBe(0);
        // a collapse fills unpropped dug cells with rubble, never the propped
        const down = InnerMap.mineCollapse(e.q, e.r - 2, () => 0.5);
        expect(down.length).toBeGreaterThan(0);
        for (const c of down) expect(InnerMap.getTile(c.q, c.r)._cave).toBe('rubble');
        expect(InnerMap.getTile(e.q, e.r - 4)._cave).toBe('floor');
    });

    it('a cave\'s loose stones and crystal are taken once', () => {
        const world = { day: 1 };
        let found = null;
        for (let s = 1; s < 40 && !found; s++) {
            const { tiles } = under('cave', world, { seed: s });
            found = tiles.flat().find(t => t._loose);
        }
        expect(found).toBeTruthy();
        const what = InnerMap.mineTakeLoose(found.q, found.r);
        expect(['stone', 'crystal']).toContain(what);
        expect(InnerMap.mineTakeLoose(found.q, found.r)).toBeNull();
    });
});

describe('the work, in the packs', () => {
    const player = () => ({ inventory: { tools: 1, wood: 4 }, needs: { energy: 100, hygiene: 100 }, health: 100, modifyNeed() {} });
    const game = (p) => ({ player: p, world: { day: 2 }, ui: { notes: [], showNotification(t, b) { this.notes.push(t + ': ' + b); }, updateStats() {} } });

    it('wants a pick; a better pick and the skill cut faster', () => {
        expect(InnerMapMining.pickOf({ inventory: {} })).toBeNull();
        const p = player();
        const base = InnerMapMining.secondsFor({ inventory: {} }, 'cut');
        expect(InnerMapMining.secondsFor(p, 'cut')).toBeLessThan(base);
        p.inventory.steel_tools = 1;
        expect(InnerMapMining.pickOf(p).item).toBe('steel_tools');
    });

    it('a cut gives the vein\'s ore; hauling gives stone and opens the cell', () => {
        const world = { day: 3 };
        const { tiles } = under('adit', world, { terrain: 'mountain' });
        const e = tiles._underground.entry;
        const p = player();
        const g = game(p);
        g.world = world;
        const t = InnerMap.getTile(e.q, e.r - 1);
        t._vein = 'copper';
        InnerMapMining._cutDone(g, e.q, e.r - 1);
        expect(p.inventory.copper).toBeGreaterThan(0);
        expect(t._cave).toBe('rubble');
        InnerMapMining._haulDone(g, e.q, e.r - 1);
        expect(p.inventory.stone).toBeGreaterThan(0);
        expect(t._cave).toBe('floor');
        expect(world.mines['4,4'].sites['adit:10,10'].got.copper).toBe(p.inventory.copper);
        // timbers from the packs
        InnerMapMining._propDone(g, e.q, e.r - 1);
        expect(t._support).toBe(true);
        expect(p.inventory.wood).toBe(2);
    });

    it('rubble stays when the packs are full', () => {
        const world = { day: 3 };
        const { tiles } = under('adit', world);
        const e = tiles._underground.entry;
        const p = player();
        p.maxInventory = 2;
        p.inventory = { tools: 1, wood: 1 };
        const g = game(p);
        InnerMap.mineCut(e.q, e.r - 1);
        InnerMapMining._haulDone(g, e.q, e.r - 1);
        expect(InnerMap.getTile(e.q, e.r - 1)._cave).toBe('rubble');
        expect(g.ui.notes.join(' ')).toMatch(/full/i);
    });

    it('underground the menu offers cutting, hauling and timbers', () => {
        const world = { day: 3 };
        const { tiles } = under('adit', world);
        const e = tiles._underground.entry;
        const p = player();
        const g = game(p);
        const acts = (q, r) => InnerMapMining.menuItems(g, InnerMap.getTile(q, r), q, r).filter(i => i.type === 'action').map(i => i.action);
        expect(acts(e.q, e.r - 1)).toContain('mine_cut');
        InnerMap.mineCut(e.q, e.r - 1);
        expect(acts(e.q, e.r - 1)).toContain('mine_haul');
        InnerMap.mineHaul(e.q, e.r - 1);
        expect(acts(e.q, e.r - 1)).toContain('mine_prop');
        // without a pick, no cutting
        p.inventory = {};
        expect(acts(e.q - 1, e.r)).not.toContain('mine_cut');
    });
});

describe('the bigger crags of terrainGen 9', () => {
    it('stand in up to three tiers, with cave mouths at the foot of some faces', () => {
        let top = 0, mouths = 0;
        for (let i = 0; i < 8; i++) {
            const { tiles } = bigMap(20 + i, 9);
            for (const t of tiles.flat()) if (t._cragTop) top = Math.max(top, t._cragLevel);
            for (const t of tiles.flat()) {
                if (!t._caveMouth) continue;
                mouths++;
                // the entry is the face's foot row; below it a place to stand
                const foot = tiles[t.r + 1][t.q];
                expect(InnerMap.standLevel(foot)).not.toBeNull();
                expect(foot.subTerrain.id === 'cliff' && !foot._cragTop).toBe(false);
                expect(InnerMap.caveMouthAt(t.q, t.r)).toEqual({ q: t.q, r: t.r });
            }
        }
        expect(top).toBe(3);
        expect(mouths).toBeGreaterThan(0);
    });

    it('nobody climbs a face through a cave mouth', () => {
        for (let i = 0; i < 8; i++) {
            const { tiles } = bigMap(20 + i, 9);
            const mouth = tiles.flat().find(t => t._caveMouth);
            if (!mouth) continue;
            // (from its foot, no way up the face the mouth is in: a way down the rock below it may be)
            expect(InnerMap.linksFrom(mouth.q, mouth.r + 1).filter(l => l.up).length).toBe(0);
            return;
        }
        throw new Error('no cave mouth in eight hexes');
    });

    it('an older world keeps its crags as they were', () => {
        const a = blank();
        InnerMap._layCliffs(a, { terrain: { id: 'mountain' } }, 5, 7, { terrainGen: 8 });
        const b = blank();
        InnerMap._layCliffs(b, { terrain: { id: 'mountain' } }, 5, 7, null);
        const key = (tiles) => tiles.flat().filter(t => t._crag).map(t => `${t.q},${t.r}:${t._crag.c},${t._crag.r}`).join('|');
        expect(key(a)).toBe(key(b));
        expect(a.flat().some(t => t._caveMouth)).toBe(false);
    });
});

describe('a drift and a shaft on the street map', () => {
    it('a drift is cut into a face from its foot, stage by stage, and kept on the record', () => {
        const world = { day: 5 };
        const { tiles } = bigMap(30, 9);
        InnerMap._mineWorld = world;
        InnerMap._mineHex = '30,9';
        const face = tiles.flat().find(t => InnerMap.canStartAdit(t.q, t.r));
        expect(face).toBeTruthy();
        const n = MINING.adit.stages;
        let st = null;
        for (let i = 0; i < n; i++) st = InnerMap.advanceAdit(face.q, face.r);
        expect(st.open).toBe(true);
        expect(InnerMap.mineWorkAt(face.q, face.r)).toMatchObject({ kind: 'adit', open: true });
        // a fresh drawing of the map, bound to the record: the drift is there again
        const { tiles: again } = bigMap(30, 9);
        expect(again[face.r][face.q]._adit).toBeUndefined();
        InnerMap._bindMines(world, '30,9');
        expect(again[face.r][face.q]._adit).toEqual({ stage: n, open: true });
    });

    it('a shaft sinks into open ground and stands impassable', () => {
        const world = { day: 5 };
        const tiles = blank(20, 20);
        InnerMap.tiles = tiles;
        InnerMap.width = 20;
        InnerMap.height = 20;
        InnerMap._mineWorld = world;
        InnerMap._mineHex = '1,1';
        InnerMap.playerInnerQ = 2;
        InnerMap.playerInnerR = 2;
        InnerMap.npcs = [];
        expect(InnerMapMining.canSinkShaft(tiles[10][10])).toBe(true);
        InnerMap.advanceShaft(10, 10);
        expect(tiles[10][10].subTerrain.passable).toBe(false);
        for (let i = 1; i < MINING.shaft.stages; i++) InnerMap.advanceShaft(10, 10);
        expect(world.mines['1,1'].sites['shaft:10,10'].open).toBe(true);
        expect(InnerMapMining.canSinkShaft(tiles[10][10])).toBe(false);
    });
});

describe('the cave art', () => {
    const grid = (rows) => {
        const k = { '#': 'rock', '.': 'floor', 'o': 'rubble' };
        const tiles = rows.map((s, r) => [...s].map((ch, q) => ({ q, r, _cave: k[ch] })));
        return (q, r) => (tiles[r] && tiles[r][q]) || null;
    };

    it('a face where the floor meets the rock from below, the rock\'s top rimmed, rubble over the floor', () => {
        const at = grid(['#####', '#####', '#...#', '##o##']);
        expect(caveCells(at, 2, 1)[0]).toEqual([0, 1]);     // a face, floor below
        expect(caveCells(at, 2, 0)[0]).toEqual([4, 2]);     // the top: its south rim over the face
        expect(caveCells(at, 0, 2)[0][1]).toBeGreaterThanOrEqual(2);   // rock beside the floor: a rimmed top
        expect(caveCells(at, 2, 3)).toContainEqual([5, 0]); // rubble
        at(2, 1)._vein = 'gold_ore';
        expect(caveCells(at, 2, 1)).toContainEqual([4, 4]);
    });

    it('drifts and shafts show their stage', () => {
        expect(aditCell(0, 3, false)).toBeNull();
        expect(aditCell(1, 3, false)).toEqual([3, 5]);
        expect(aditCell(3, 3, true)).toEqual([5, 5]);
        expect(shaftCell(1, 4, false)).toEqual([0, 6]);
        expect(shaftCell(3, 4, false)).toEqual([2, 6]);
        expect(shaftCell(4, 4, true)).toEqual([3, 6]);
    });
});

describe('going underground and out', () => {
    it('a cave is entered like a building: dark, the player at its mouth, out again at the foot of the face', () => {
        const tiles = blank(40, 40);
        tiles[20][10]._caveMouthOf = { q: 10, r: 20 };
        InnerMap.tiles = tiles; InnerMap.width = 40; InnerMap.height = 40;
        InnerMap.active = true;
        InnerMap.currentWorldTile = { q: 4, r: 4 };
        InnerMap.npcs = []; InnerMap.buildings = []; InnerMap.roads = [];
        InnerMap._interiorCache = {};
        InnerMap.playerInnerQ = 10; InnerMap.playerInnerR = 21;
        const world = { day: 9, getTile: () => ({ terrain: { id: 'mountain' }, resource: 'iron' }) };
        const game = { world, player: { inventory: {} } };
        expect(InnerMap.enterUnderground(game, 'cave', 10, 20)).toBe(true);
        expect(InnerMap.isUnderground()).toBe(true);
        const here = InnerMap.getTile(InnerMap.playerInnerQ, InnerMap.playerInnerR);
        expect(here._cave).toBe('floor');
        expect(InnerMap.tiles.flat().some(t => t._isDoor)).toBe(true);
        expect(world.mines['4,4'].sites['cave:10,20'].visits).toBe(1);
        expect(InnerMap.exitBuilding(game)).toBe(true);
        expect(InnerMap.isUnderground()).toBe(false);
        expect(InnerMap.tiles).toBe(tiles);
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).toEqual([10, 21]);
    });
});

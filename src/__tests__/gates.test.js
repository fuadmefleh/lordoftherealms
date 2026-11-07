/**
 * Gates (world/townProps.js setGate/applyGates/gateRecord; world/innerMap/gates.js):
 * a gate stands shut and blocks like the fence; the player opens and shuts it
 * (by menu, or by walking into it) and it stays as they leave it, saved on the
 * world; townsfolk open a shut gate to pass and shut it behind them.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { TownProps } from '../world/townProps.js';
import { InnerMap } from '../world/innerMap.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const defOf = (id) => TownProps.defs().find(d => d.id === id);

/**
 * A 12×10 meadow with a fenced pen: fence ring q 3..8, r 2..6, its gate at
 * (5, 6) in the bottom run. Inside (q 4..7, r 3..5) is open grass.
 */
function lay() {
    const tiles = Array.from({ length: 10 }, (_, r) => Array.from({ length: 12 }, (_, q) => ({
        q, r, explored: true, visible: true, subTerrain: { id: 'grass', passable: true },
    })));
    const put = (id, q, r) => expect(TownProps.place(tiles, defOf(id), q, r)).toBe(true);
    for (let q = 3; q <= 8; q++) { put('tp_fence_ew', q, 2); put(q === 5 ? 'tp_fence_gate' : 'tp_fence_ew', q, 6); }
    for (let r = 3; r <= 5; r++) { put('tp_fence_ns', 3, r); put('tp_fence_ns', 8, r); }
    TownProps.joinFences(tiles);
    InnerMap.tiles = tiles;
    InnerMap.width = 12;
    InnerMap.height = 10;
    InnerMap._insideBuilding = null;
    InnerMap._underwater = false;
    InnerMap._swimAllowed = false;
    InnerMap.npcs = [];
    InnerMap.playerInnerQ = 5;
    InnerMap.playerInnerR = 8;
    InnerMap.cancelPlayerWalk();
    return tiles;
}

/** Walk the player's current path to its end (or until it stops). */
function walkOut() {
    for (let i = 0; i < 200 && InnerMap._playerWalking; i++) InnerMap.updatePlayer(1);
}

describe('a gate\'s two pieces', () => {
    it('a gate is registered shut (blocks) and open (walked through), both fence and gate', () => {
        const shut = defOf('tp_fence_gate'), open = defOf('tp_fence_gate_open');
        expect(shut && open).toBeTruthy();
        expect(shut.meta[0].impassable).toBe(true);
        expect(open.meta[0].impassable).toBe(false);
        expect(shut.tags).toContain('gate');
        expect(TownProps.isFence('tp_fence_gate_open')).toBe(true);
        expect(TownProps.isGate('tp_fence_gate_open')).toBe(true);
        expect(TownProps.isGate('tp_fence_ew')).toBe(false);
        // The open leaf is its own cell of the sheet, below the shut gate's row
        expect(open.tiles[0].sy).toBeGreaterThan(shut.tiles[0].sy);
    });

    it('stands shut when laid, and swaps piece and passability when opened and shut', () => {
        const tiles = lay();
        expect(tiles[6][5].customObject.defId).toBe('tp_fence_gate');
        expect(tiles[6][5].subTerrain.passable).toBe(false);
        expect(TownProps.setGate(tiles, 5, 6, true)).toBe(true);
        expect(tiles[6][5].customObject.defId).toBe('tp_fence_gate_open');
        expect(tiles[6][5].subTerrain.passable).toBe(true);
        expect(TownProps.setGate(tiles, 5, 6, true)).toBe(false);
        expect(TownProps.setGate(tiles, 5, 6, false)).toBe(true);
        expect(tiles[6][5].subTerrain.passable).toBe(false);
        expect(TownProps.setGate(tiles, 4, 6, true)).toBe(null);   // a fence, not a gate
        // The gateposts either side still join to it, open or shut
        TownProps.setGate(tiles, 5, 6, true);
        expect(TownProps.joinFences(tiles)).toBe(0);
        expect(tiles[6][4].customObject.defId).toBe('tp_fence_gl');
        expect(tiles[6][6].customObject.defId).toBe('tp_fence_gr');
    });
});

describe('the player and a gate', () => {
    beforeEach(() => lay());

    it('opens and shuts it from the menu, and it is recorded on the world', () => {
        const world = {};
        InnerMap._bindGates(world, '7,9');
        expect(InnerMap.gateAt(5, 6)).toEqual({ q: 5, r: 6, open: false });
        expect(InnerMap.setGateOpen(5, 6, true)).toBe('opened');
        expect(InnerMap.gateAt(5, 6).open).toBe(true);
        expect(world.gates['7,9']).toEqual({ '5,6': true });
        expect(InnerMap.setGateOpen(5, 6, true)).toBe('already');
        expect(InnerMap.setGateOpen(5, 6, false)).toBe('shut');
        expect(world.gates['7,9']).toEqual({});
        expect(InnerMap.setGateOpen(4, 6, true)).toBe(null);
    });

    it('can\'t shut it on someone standing in the gateway', () => {
        InnerMap._bindGates({}, '0,0');
        InnerMap.setGateOpen(5, 6, true);
        InnerMap.playerInnerQ = 5; InnerMap.playerInnerR = 6;
        expect(InnerMap.setGateOpen(5, 6, false)).toBe('occupied');
        InnerMap.playerInnerQ = 5; InnerMap.playerInnerR = 8;
        InnerMap.npcs = [{ id: 'n1', q: 5, r: 6, state: 'idle' }];
        expect(InnerMap.setGateOpen(5, 6, false)).toBe('occupied');
        InnerMap.npcs = [];
        expect(InnerMap.setGateOpen(5, 6, false)).toBe('shut');
    });

    it('a path into the pen goes through the shut gate, which opens on reaching it and stays open', () => {
        const world = {};
        InnerMap._bindGates(world, '1,1');
        const path = InnerMap._findPath(5, 8, 5, 4);
        expect(path).toBeTruthy();
        expect(path.some(s => s.q === 5 && s.r === 6)).toBe(true);
        expect(InnerMap.movePlayerTo(5, 4).started).toBe(true);
        walkOut();
        expect(InnerMap.playerInnerQ).toBe(5);
        expect(InnerMap.playerInnerR).toBe(4);
        expect(InnerMap.gateAt(5, 6).open).toBe(true);
        expect(world.gates['1,1']['5,6']).toBe(true);
    });

    it('a click on the shut gate itself walks there, and it opens as they step in', () => {
        InnerMap._bindGates({}, '1,1');
        // Clicking the shut gate: the player may make for it, and it opens as they step in
        expect(InnerMap.movePlayerTo(5, 6).started).toBe(true);
        walkOut();
        expect(InnerMap.playerInnerR).toBe(6);
        expect(InnerMap.gateAt(5, 6).open).toBe(true);
    });

    it('walking into it with a key step opens it', () => {
        InnerMap._bindGates({}, '1,1');
        InnerMap.playerInnerQ = 5; InnerMap.playerInnerR = 7;
        expect(InnerMap.movePlayer(0, -1).moved).toBe(true);
        expect(InnerMap.gateAt(5, 6).open).toBe(true);
        // …but the fence beside it still stops you
        InnerMap.playerInnerQ = 4; InnerMap.playerInnerR = 7;
        expect(InnerMap.movePlayer(0, -1).moved).toBe(false);
    });
});

describe('townsfolk and a gate', () => {
    beforeEach(() => lay());

    it('a townsperson walking into the pen opens the shut gate, and it is shut behind them', () => {
        const world = {};
        InnerMap._bindGates(world, '2,2');
        InnerMap.active = true;
        const npc = { id: 'f1', type: 'farmer', q: 5, r: 8, prevQ: 5, prevR: 8, state: 'walking', speed: 1, moveProgress: 0 };
        InnerMap.npcs = [npc];
        expect(InnerMap._npcWalkTo(npc, 5, 4)).toBe(true);
        let sawOpen = false;
        for (let i = 0; i < 40 && npc.path; i++) {
            InnerMap._npcStep(npc, 0.5);
            InnerMap._closeGatesBehind();
            if (npc.q === 5 && npc.r === 6) {
                sawOpen = InnerMap.gateAt(5, 6).open;
                expect(InnerMap.tiles[6][5].subTerrain.passable).toBe(true);
            }
        }
        expect(sawOpen).toBe(true);
        expect([npc.q, npc.r]).toEqual([5, 4]);
        // Through and shut behind them; nothing recorded (the gate is as the player left it)
        expect(InnerMap.gateAt(5, 6).open).toBe(false);
        expect(InnerMap.tiles[6][5].subTerrain.passable).toBe(false);
        expect(world.gates).toBeUndefined();
    });

    it('a gate the player left open they leave open', () => {
        InnerMap._bindGates({}, '2,2');
        InnerMap.setGateOpen(5, 6, true);
        const npc = { id: 'f1', type: 'farmer', q: 5, r: 8, state: 'walking', speed: 1, moveProgress: 0 };
        InnerMap.npcs = [npc];
        InnerMap._npcWalkTo(npc, 5, 4);
        for (let i = 0; i < 40 && npc.path; i++) { InnerMap._npcStep(npc, 0.5); InnerMap._closeGatesBehind(); }
        expect([npc.q, npc.r]).toEqual([5, 4]);
        expect(InnerMap.gateAt(5, 6).open).toBe(true);
    });

    it('the gate is shut through updateNPCs too, once the gateway is clear', () => {
        InnerMap._bindGates({}, '2,2');
        InnerMap.active = true;
        const npc = { id: 'f1', type: 'farmer', q: 5, r: 7, state: 'idle', idleTimer: 99 };
        InnerMap.npcs = [npc];
        expect(InnerMap._npcPassGate(npc, InnerMap.tiles[6][5], 5, 6)).toBe(true);
        npc.q = 5; npc.r = 6;
        InnerMap.updateNPCs(0.01);
        expect(InnerMap.gateAt(5, 6).open).toBe(true);    // they're in it
        npc.r = 5;
        InnerMap.updateNPCs(0.01);
        expect(InnerMap.gateAt(5, 6).open).toBe(false);
    });
});

describe('gates kept with the save', () => {
    it('the open gates go out with the world and are laid back on the map on entry', () => {
        lay();
        const world = {};
        InnerMap._bindGates(world, '3,4');
        InnerMap.setGateOpen(5, 6, true);
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializeWorld({ ...world, tiles: [], kingdoms: [], units: [] }).gates));
        expect(saved).toEqual({ '3,4': { '5,6': true } });
        // A fresh map of the same town (gates laid shut), bound to the loaded record
        lay();
        expect(InnerMap.gateAt(5, 6).open).toBe(false);
        InnerMap._bindGates({ gates: saved }, '3,4');
        expect(InnerMap.gateAt(5, 6).open).toBe(true);
        expect(InnerMap.tiles[6][5].subTerrain.passable).toBe(true);
        // Another town's map: its gates stand shut
        lay();
        InnerMap._bindGates({ gates: saved }, '9,9');
        expect(InnerMap.gateAt(5, 6).open).toBe(false);
    });
});

describe('beasts kept in their pens', () => {
    it('a fenced pen behind a gate is found (a fenced field is not), and a village keeps its flock in it', () => {
        const tiles = lay();
        const pens = InnerMap.findPens(tiles);
        expect(pens.length).toBe(1);
        expect(pens[0].cells.length).toBe(12); // q 4..7, r 3..5
        // A village's flock stands in the pen, and none graze loose
        for (let i = 0; i < 6; i++) {
            const plan = InnerMap.planHerds(tiles, 'grassland', i, 2, 'pen', { settlementType: 'village' });
            const flock = plan.filter(a => a.livestock);
            expect(flock.length).toBeGreaterThan(0);
            for (const a of flock) {
                expect(a.penned).toBe(true);
                expect(pens[0].cells).toContain(`${a.q},${a.r}`);
            }
        }
        // Crops in the pen make it a field: beasts are kept off them
        tiles[4][5]._fieldSoil = true;
        expect(InnerMap.findPens(tiles)).toEqual([]);
    });

    it('the shut gate keeps them in; left open, they can step out', () => {
        lay();
        InnerMap.animals = [];
        InnerMap._animalBuiltDist = null;
        expect(InnerMap._animalCanStep(5, 5, 5, 6)).toBe(false);
        InnerMap.setGateOpen(5, 6, true);
        expect(InnerMap._animalCanStep(5, 5, 5, 6)).toBe(true);
    });

    it('a town field is walked into (dearer than open ground on a path)', () => {
        const field = TownProps.defs().find(d => /^tp_field_wheat_/.test(d.id));
        expect(field.meta.every(m => !m.impassable)).toBe(true);
    });
});

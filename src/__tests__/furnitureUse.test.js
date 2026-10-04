/**
 * Using furniture happens in person: the player walks up to it before the
 * action fires, and NPCs inside the interior walk to furniture, use it for a
 * while, and walk out through the door when their visit is over.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InnerMap } from '../world/innerMap.js';
import { Utils } from '../core/utils.js';

/** A 9×7 room: walls on the border, a door bottom-centre, a bar and an anvil. */
function buildRoom() {
    const W = 9, H = 7;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        tiles[r] = [];
        for (let q = 0; q < W; q++) {
            const wall = r === 0 || q === 0 || q === W - 1 || (r === H - 1 && q !== 4);
            tiles[r][q] = {
                q, r, _isInterior: true, _furniture: null,
                subTerrain: { id: wall ? 'wall' : 'floor', passable: !wall },
            };
        }
    }
    tiles[H - 1][4]._isDoor = true;
    const place = (q, r, type, name) => {
        tiles[r][q]._furniture = { type, name, icon: '🪑', passable: false };
        tiles[r][q].subTerrain = { id: `furniture_${type}`, passable: false };
    };
    place(1, 1, 'bar', 'Bar Counter');
    place(7, 1, 'anvil', 'Anvil');
    InnerMap.tiles = tiles;
    InnerMap.width = W;
    InnerMap.height = H;
    InnerMap.active = true;
    InnerMap.npcs = [];
    InnerMap._insideBuilding = { type: 'tavern', q: 0, r: 0 };
    InnerMap.playerInnerQ = 4;
    InnerMap.playerInnerR = 5;
    InnerMap.cancelPlayerWalk();
}

/** Tick the player's walk until it arrives, mimicking the game loop. */
function walkPlayer() {
    for (let i = 0; i < 200; i++) {
        const res = InnerMap.updatePlayer(0.1);
        if (res && res.arrived) { InnerMap.runPendingAction(); return true; }
        if (!InnerMap._playerWalking) return false;
    }
    return false;
}

function makeNpc(type, q, r) {
    return { id: 7, type, name: 'Bram', q, r, prevQ: q, prevR: r, speed: 0.5,
        state: 'inside_building', idleTimer: 120, path: null, moveProgress: 0 };
}

beforeEach(() => {
    Utils.setSeed(1234);
    buildRoom();
});

describe('player approaches furniture before using it', () => {
    it('walks next to distant furniture, then runs the action on arrival', () => {
        let used = 0;
        expect(InnerMap.approachAndThen(1, 1, () => used++)).toBe('walking');
        expect(used).toBe(0);
        expect(walkPlayer()).toBe(true);
        expect(used).toBe(1);
        expect(InnerMap.isPlayerNextTo(1, 1)).toBe(true);
    });

    it('acts immediately when already beside it', () => {
        InnerMap.playerInnerQ = 2;
        InnerMap.playerInnerR = 2;
        let used = 0;
        expect(InnerMap.approachAndThen(1, 1, () => used++)).toBe('now');
        expect(used).toBe(1);
    });

    it('a cancelled walk drops the queued action', () => {
        let used = 0;
        InnerMap.approachAndThen(7, 1, () => used++);
        InnerMap.cancelPlayerWalk();
        expect(InnerMap._pendingAction).toBe(null);
        expect(used).toBe(0);
    });

    it('reports unreachable furniture instead of acting from afar', () => {
        // Wall the bar in completely.
        for (const [q, r] of [[2, 1], [1, 2], [2, 2]]) InnerMap.tiles[r][q].subTerrain.passable = false;
        let used = 0;
        expect(InnerMap.approachAndThen(1, 1, () => used++)).toBe('unreachable');
        expect(used).toBe(0);
    });
});

describe('interior NPCs use furniture', () => {
    it('a blacksmith walks to the anvil and hammers at it', () => {
        const npc = makeNpc('blacksmith_npc', 4, 3);
        InnerMap.npcs = [npc];
        for (let i = 0; i < 400 && !npc.activity; i++) InnerMap.updateNPCs(0.1);
        expect(npc.activity).toBeTruthy();
        expect(npc.activity.type).toBe('anvil');
        expect(npc.activity.anim).toBe('slash');
        expect(Math.max(Math.abs(npc.q - 7), Math.abs(npc.r - 1))).toBeLessThanOrEqual(1);
        expect(InnerMap.getFurnitureOccupant(7, 1)).toBe(npc);
    });

    it('two NPCs never claim the same piece of furniture', () => {
        const a = makeNpc('blacksmith_npc', 3, 3);
        const b = { ...makeNpc('blacksmith_npc', 5, 3), id: 8 };
        InnerMap.npcs = [a, b];
        for (let i = 0; i < 600; i++) {
            InnerMap.updateNPCs(0.1);
            const spots = InnerMap.npcs.filter(n => n._act && n._act.spot).map(n => `${n._act.spot.q},${n._act.spot.r}`);
            expect(new Set(spots).size).toBe(spots.length);
        }
    });

    it('yields furniture the player wants', () => {
        const npc = makeNpc('blacksmith_npc', 4, 3);
        InnerMap.npcs = [npc];
        for (let i = 0; i < 400 && !npc.activity; i++) InnerMap.updateNPCs(0.1);
        InnerMap.yieldFurniture(npc);
        expect(npc.activity).toBe(null);
        expect(InnerMap.getFurnitureOccupant(7, 1)).toBe(null);
    });

    it('walks out through the door when the visit is over', () => {
        const npc = makeNpc('villager', 4, 2);
        npc.idleTimer = 0.05;
        InnerMap.npcs = [npc];
        let reachedDoor = false;
        for (let i = 0; i < 400 && InnerMap.npcs.length; i++) {
            InnerMap.updateNPCs(0.1);
            if (npc.q === 4 && npc.r === 6) reachedDoor = true;
        }
        expect(reachedDoor).toBe(true);
        expect(InnerMap.npcs).toHaveLength(0);
    });

    it('recognises editor objects by name', () => {
        expect(InnerMap.inferFurnitureTypeFromName('Oak Bed')).toBe('bed');
        expect(InnerMap.inferFurnitureTypeFromName('Iron Anvil')).toBe('anvil');
        expect(InnerMap.inferFurnitureTypeFromName('Rock')).toBe(null);
    });
});

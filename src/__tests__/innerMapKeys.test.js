// WASD / arrow keys walk the street map (ui/innerMapKeys.js)
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { InnerMapKeys } from '../ui/innerMapKeys.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

function lay() {
    const tiles = [];
    for (let r = 0; r < 10; r++) {
        const row = [];
        for (let q = 0; q < 10; q++) {
            const wall = q === 7;
            row.push({ q, r, explored: true, visible: true, subTerrain: { id: wall ? 'rock' : 'grass', passable: !wall } });
        }
        tiles.push(row);
    }
    Object.assign(InnerMap, { active: true, tiles, width: 10, height: 10, _insideBuilding: null, _swimAllowed: false, playerInnerQ: 4, playerInnerR: 5, _climb: null, _climbRequest: null });
    InnerMap.cancelPlayerWalk();
    InnerMapKeys._kbWalk = false;
}

/** Hold `keys` for `secs` of frames */
function hold(keys, secs) {
    for (let i = 0; i < secs * 30; i++) {
        InnerMapKeys.update({}, keys);
        InnerMap.updatePlayer(1 / 30);
    }
}

describe('walking the street map with the keys', () => {
    beforeEach(lay);

    it('reads WASD and the arrows, eight ways', () => {
        expect(InnerMapKeys.heldDir({ w: true })).toEqual({ dq: 0, dr: -1 });
        expect(InnerMapKeys.heldDir({ ArrowDown: true, d: true })).toEqual({ dq: 1, dr: 1 });
        expect(InnerMapKeys.heldDir({ a: true, d: true })).toBe(null);
        expect(InnerMapKeys.heldDir({})).toBe(null);
    });

    it('walks on without stopping while held, and stops when let go', () => {
        hold({ w: true }, 0.9);
        const r = InnerMap.playerInnerR;
        expect(r).toBeLessThanOrEqual(3);
        expect(InnerMap.playerInnerQ).toBe(4);
        hold({}, 1);
        expect(InnerMap._playerWalking).toBe(false);
        expect(InnerMap.playerInnerR).toBeGreaterThanOrEqual(r - 1);
    });

    it('stops at a wall, and a blocked diagonal slides along the open side', () => {
        hold({ d: true }, 2);
        expect(InnerMap.playerInnerQ).toBe(6);
        hold({ d: true, s: true }, 1);
        expect(InnerMap.playerInnerQ).toBe(6);
        expect(InnerMap.playerInnerR).toBeGreaterThan(5);
    });

    it('takes over from a clicked walk', () => {
        InnerMap.movePlayerTo(0, 5);
        InnerMap.updatePlayer(0.1);
        hold({ s: true }, 0.6);
        expect(InnerMap.playerInnerR).toBeGreaterThan(5);
    });
});

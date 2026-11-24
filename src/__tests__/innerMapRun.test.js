/**
 * Hold Shift to run on the street map (world/innerMap/movement.js reads
 * InnerMap._runHeld, set from the keyboard in ui/game/gameLoop.js).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

/** A W×8 green, with a pond across columns a..b when given. */
function lay({ W = 40, a = -1, b = -1 } = {}) {
    const tiles = [];
    for (let r = 0; r < 8; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const wet = q >= a && q <= b;
            row.push({
                q, r, explored: true, visible: true, baseTerrain: wet ? 'water' : 'grass',
                subTerrain: wet ? { id: 'pond_water', passable: false } : { id: 'grass', passable: true },
                _wet: wet, _waterKind: wet ? 'pond' : undefined,
            });
        }
        tiles.push(row);
    }
    Object.assign(InnerMap, {
        tiles, width: W, height: 8, _insideBuilding: null, _underwater: false, _aboardBoat: false,
        _swimAllowed: true, _rideSpeed: 0, _iceGear: null, _skate: null, _boatCarried: false,
        playerInnerQ: 1, playerInnerR: 3, npcs: [], _runHeld: false,
    });
    InnerMap.cancelPlayerWalk();
}

/** Walk east for `secs` seconds; → how many tiles were covered. */
function walk(run, secs = 2) {
    InnerMap._runHeld = run;
    InnerMap.movePlayerTo(InnerMap.width - 2, 3);
    const from = InnerMap.playerInnerQ;
    for (let i = 0; i < secs * 60; i++) InnerMap.updatePlayer(1 / 60);
    InnerMap._runHeld = false;
    return InnerMap.playerInnerQ - from;
}

describe('running', () => {
    beforeEach(() => lay());

    it('with Shift held you cover more ground than a walk', () => {
        const strolled = walk(false);
        lay();
        const ran = walk(true);
        expect(strolled).toBeGreaterThan(0);
        expect(ran).toBeGreaterThan(strolled * 1.5);
        expect(InnerMap.runPace()).toBeGreaterThan(1);
    });

    it('you can\'t run through deep water: a swim is a swim', () => {
        lay({ a: 2, b: 37 });
        InnerMap.playerInnerQ = 2;
        const swam = walk(false);
        lay({ a: 2, b: 37 });
        InnerMap.playerInnerQ = 2;
        expect(walk(true)).toBe(swam);
    });
});

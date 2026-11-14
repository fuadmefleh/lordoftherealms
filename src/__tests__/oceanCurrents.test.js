/**
 * Ocean currents (world/oceanCurrents.js) and the water that carries you:
 * a ship on the world map (player/core/movement.js) and a swimmer on the
 * street map (world/innerMap/currents.js).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { OceanCurrents } from '../world/oceanCurrents.js';
import { InnerMap } from '../world/innerMap.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const OCEAN = { id: 'ocean', passable: false };
const PLAINS = { id: 'plains', passable: true };

function seaWorld({ width = 60, height = 60, seed = 77, land = () => false } = {}) {
    const tiles = Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, q) => ({ q, r, terrain: land(q, r) ? PLAINS : OCEAN })));
    return {
        width, height, day: 1, generationParams: { seed }, tiles,
        getTile(q, r) {
            if (r < 0 || r >= height) return null;
            q = ((q % width) + width) % width;
            return tiles[r][q];
        },
    };
}

describe('the currents of the sea', () => {
    it('run west in the warm belt and east in the middle latitudes, the same for the same world', () => {
        const w = seaWorld();
        const eq = OceanCurrents.at(w, 10, 30);
        const mid = OceanCurrents.at(w, 10, 13); // |lat| ≈ 0.56
        expect(eq.x).toBeLessThan(0);
        expect(mid.x).toBeGreaterThan(0);
        expect(eq.strength).toBeGreaterThan(0);
        expect(OceanCurrents.at(seaWorld(), 10, 30)).toEqual(eq);
        // land has none; a coastal hex's street map takes the sea's beside it
        const lw = seaWorld({ land: (q, r) => q === 10 && r === 30 });
        expect(OceanCurrents.at(lw, 10, 30)).toBe(null);
        expect(OceanCurrents.near(lw, 10, 30).x).toBeLessThan(0);
    });

    it('make sailing with the current cheaper and against it dearer', () => {
        const w = seaWorld();
        const cur = OceanCurrents.at(w, 10, 30);
        const back = (cur.dir + 3) % 6;
        expect(OceanCurrents.sailFactor(w, 10, 30, cur.dir)).toBeLessThan(1);
        expect(OceanCurrents.sailFactor(w, 10, 30, back)).toBeGreaterThan(1);
    });

    it('carry a ship lying at sea downstream overnight, never one in port or under way', () => {
        const w = seaWorld();
        const p = new Player();
        p.q = 10; p.r = 30; p.boardedShip = 's1';
        const cur = OceanCurrents.at(w, 10, 30);
        let moved = null;
        for (let i = 0; i < 12 && !moved; i++) moved = p.driftWithCurrent(w);
        expect(moved).toBeTruthy();
        expect(moved.dir).toBe(cur.dir);
        expect(p.q !== 10 || p.r !== 30).toBe(true);
        // under way: no drift
        p.queuedPath = [{ q: 0, r: 0 }];
        const at = { q: p.q, r: p.r };
        for (let i = 0; i < 12; i++) p.driftWithCurrent(w);
        expect({ q: p.q, r: p.r }).toEqual(at);
        // ashore: none
        p.queuedPath = null; p.boardedShip = null;
        for (let i = 0; i < 12; i++) p.driftWithCurrent(w);
        expect({ q: p.q, r: p.r }).toEqual(at);
    });
});

/** A 14×10 meadow with a river running east down rows 3–8, deep in rows 4–7 */
function riverMap() {
    const tiles = [];
    for (let r = 0; r < 10; r++) {
        const row = [];
        for (let q = 0; q < 14; q++) {
            const wet = r >= 3 && r <= 8;
            const deep = r >= 4 && r <= 7;
            row.push({
                q, r, explored: true, visible: true,
                subTerrain: deep ? { id: 'river_water', passable: false } : { id: wet ? 'shallows' : 'grass', passable: true },
                _wet: wet, _waterKind: wet ? 'river' : undefined,
                _flow: wet ? { x: 1, y: 0, cx: 0, cy: 0, d: 0, k: q, n: 14, run: 0 } : undefined,
            });
        }
        tiles.push(row);
    }
    Object.assign(InnerMap, { active: true, tiles, width: 14, height: 10, _insideBuilding: null, _swimAllowed: true, playerInnerQ: 2, playerInnerR: 5, _driftPx: null });
    InnerMap.cancelPlayerWalk();
}

describe('the river carries a swimmer', () => {
    beforeEach(() => riverMap());

    it('downstream, smoothly, a cell at a time', () => {
        const p0 = InnerMap.getPlayerWorldPos().x;
        InnerMap.driftPlayer(0.1, null, 0);
        expect(InnerMap.getPlayerWorldPos().x).toBeGreaterThan(p0);
        for (let i = 0; i < 40; i++) InnerMap.driftPlayer(0.1, null, 0);
        expect(InnerMap.playerInnerQ).toBeGreaterThan(4);
        expect(InnerMap.playerInnerR).toBe(5);
    });

    it('not on dry land, and less for a strong swimmer', () => {
        InnerMap.playerInnerR = 1;
        for (let i = 0; i < 40; i++) InnerMap.driftPlayer(0.1, null, 0);
        expect(InnerMap.playerInnerQ).toBe(2);
        riverMap();
        for (let i = 0; i < 20; i++) InnerMap.driftPlayer(0.1, null, 0);
        const weak = InnerMap.playerInnerQ;
        riverMap();
        for (let i = 0; i < 20; i++) InnerMap.driftPlayer(0.1, null, 0.5);
        expect(InnerMap.playerInnerQ).toBeLessThan(weak);
    });

    it('held at the map edge', () => {
        InnerMap.playerInnerQ = 13;
        for (let i = 0; i < 40; i++) InnerMap.driftPlayer(0.1, null, 0);
        expect(InnerMap.playerInnerQ).toBe(13);
    });
});

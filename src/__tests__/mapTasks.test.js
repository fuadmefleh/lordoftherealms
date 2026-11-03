// Work done in person on the street map (systems/mapTasks.js): how a task is
// scored, which task a job is, and where on the map a task can send you.
import { describe, it, expect, beforeAll } from 'vitest';
import { MapTasks } from '../systems/mapTasks.js';
import { loadData } from './playtest/harness.js';
import { Utils } from '../core/utils.js';

beforeAll(async () => { await loadData(); });

describe('scoring a task', () => {
    it('all of it, on time, done well is full marks', () => {
        expect(MapTasks.score({ done: 4, total: 4, elapsedHours: 2, parHours: 2.5 })).toBe(100);
    });
    it('half the work is half the score', () => {
        expect(MapTasks.score({ done: 2, total: 4, elapsedHours: 1, parHours: 2.5 })).toBe(50);
    });
    it('slow work pays less, but never nothing for finishing', () => {
        const slow = MapTasks.score({ done: 4, total: 4, elapsedHours: 5, parHours: 2.5 });
        expect(slow).toBe(50);
        expect(MapTasks.score({ done: 4, total: 4, elapsedHours: 40, parHours: 2.5 })).toBe(35);
    });
    it('quality shades the score', () => {
        expect(MapTasks.score({ done: 3, total: 3, elapsedHours: 1, parHours: 2, quality: 0 })).toBe(70);
    });
});

describe('which task a job is', () => {
    it('named jobs have their own plan; others fall back by stat', () => {
        expect(MapTasks.jobPlan({ id: 'rat_catcher', stat: 'stealth' }).template).toBe('catch');
        expect(MapTasks.jobPlan({ id: 'dock_worker', stat: 'strength' }).template).toBe('haul');
        expect(MapTasks.jobPlan({ id: 'unknown_job', stat: 'charisma' }).template).toBe('cry');
        const p = MapTasks.jobPlan({ id: 'dock_worker', stat: 'strength' });
        expect(p.parHours).toBeGreaterThan(0);
        expect(p.trips).toEqual([3, 5]);
    });
    it('every day-labour job in the data maps to a known template', () => {
        const d = MapTasks.data();
        for (const [id, plan] of Object.entries(d.jobs)) {
            expect(d.templates[plan.template], id).toBeTruthy();
        }
    });
});

describe('places on the map', () => {
    function map() {
        const W = 20, H = 20;
        const tiles = [];
        for (let r = 0; r < H; r++) {
            const row = [];
            for (let q = 0; q < W; q++) row.push({ q, r, subTerrain: { passable: true }, terrainDetail: { layer: 'grass' } });
            tiles.push(row);
        }
        for (let q = 0; q < W; q++) { tiles[10][q].isRoad = true; tiles[10][q].terrainDetail = null; }
        tiles[9][5]._doorMarker = { anchorQ: 5, anchorR: 9 };
        tiles[9][5].subTerrain.passable = true;
        tiles[9][15]._doorMarker = { anchorQ: 15, anchorR: 9 };
        tiles[4][4].customObject = { defId: 'tp_crate' };
        return { tiles, width: W, height: H, buildings: [{ q: 5, r: 9, type: 'warehouse', name: 'Warehouse' }, { q: 15, r: 9, type: 'house', name: 'House' }] };
    }
    it('finds doors (with the spot in front of them), props, roads and ground', () => {
        const s = MapTasks.spots(map());
        expect(s.doors.map(d => [d.q, d.r, d.type])).toEqual([[5, 10, 'warehouse'], [15, 10, 'house']]);
        expect(MapTasks.doorsOf(s, ['warehouse']).length).toBe(1);
        expect(MapTasks.propsOf(s, ['tp_crate'])[0]).toMatchObject({ q: 4, r: 5 });
        expect(s.roads.length).toBeGreaterThan(10);
        expect(s.ground.length).toBeGreaterThan(100);
    });
    it('spreads picks out', () => {
        const s = MapTasks.spots(map());
        const picks = MapTasks.pickSpread(s.ground, 4, Utils.seededRandom(7), 6);
        expect(picks.length).toBe(4);
        for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) {
            expect(Math.abs(picks[i].q - picks[j].q) + Math.abs(picks[i].r - picks[j].r)).toBeGreaterThanOrEqual(6);
        }
    });
});

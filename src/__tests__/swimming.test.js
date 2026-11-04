/**
 * Swimming (world/innerMap/swimming.js: where the player may swim and how
 * paths use it; player/swimming.js: what a stroke does to the swimmer).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { Swimming } from '../player/swimming.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

/** A 12×8 meadow with a pond across the middle columns 4–7 */
function lay({ frozen = false } = {}) {
    const tiles = [];
    for (let r = 0; r < 8; r++) {
        const row = [];
        for (let q = 0; q < 12; q++) {
            const wet = q >= 4 && q <= 7;
            row.push({
                q, r, explored: true, visible: true,
                subTerrain: wet ? { id: frozen ? 'frozen_pool' : 'pond_water', passable: false } : { id: 'grass', passable: true },
                _wet: wet, _waterKind: wet ? 'pond' : undefined,
            });
        }
        tiles.push(row);
    }
    InnerMap.tiles = tiles;
    InnerMap.width = 12;
    InnerMap.height = 8;
    InnerMap._insideBuilding = null;
    InnerMap._swimAllowed = true;
    InnerMap.playerInnerQ = 1;
    InnerMap.playerInnerR = 3;
    InnerMap.cancelPlayerWalk();
    return tiles;
}

const swimmer = () => {
    const p = new Player();
    p.inventory = {};
    p.health = 100;
    return p;
};

describe('where you can swim', () => {
    beforeEach(() => lay());

    it('water is swimmable; not frozen water, a deck, a pier, a hull or a bridge', () => {
        expect(InnerMap.isSwimmable(5, 3)).toBe(true);
        expect(InnerMap.isSwimmable(1, 3)).toBe(false);
        for (const flag of ['_deck', '_pier', 'isRoad']) {
            const t = InnerMap.tiles[3][5];
            t[flag] = true;
            expect(InnerMap.isSwimmable(5, 3), flag).toBe(false);
            delete t[flag];
        }
        InnerMap.tiles[3][5].customObjectPart = { anchorQ: 5, anchorR: 4 };
        expect(InnerMap.isSwimmable(5, 3)).toBe(false);
        lay({ frozen: true });
        expect(InnerMap.isSwimmable(5, 3)).toBe(false);
    });

    it('the player\'s path swims across; nobody else\'s does', () => {
        const path = InnerMap._findPath(1, 3, 10, 3, { swim: true });
        expect(path).toBeTruthy();
        expect(path.some(s => InnerMap.tiles[s.r][s.q]._wet)).toBe(true);
        // an NPC's path (no swim): the pond cuts the map, no way across
        expect(InnerMap._findPath(1, 3, 10, 3)).toBeNull();
    });

    it('a walk round is taken when not much longer than the swim', () => {
        // a land bridge across the pond at the bottom row
        for (let q = 4; q <= 7; q++) { const t = InnerMap.tiles[7][q]; t._wet = false; t.subTerrain = { id: 'grass', passable: true }; }
        const path = InnerMap._findPath(1, 6, 10, 6, { swim: true });
        // 13 steps round vs 4 water tiles at 3 each: the walk wins
        expect(path.every(s => !InnerMap.tiles[s.r][s.q]._wet)).toBe(true);
    });

    it('walking into the water starts the swim; barred when swimming is not allowed', () => {
        const go = InnerMap.movePlayerTo(5, 3);
        expect(go.started).toBe(true);
        InnerMap.cancelPlayerWalk();
        InnerMap._swimAllowed = false;
        InnerMap._swimRefusal = 'Too heavy.';
        const no = InnerMap.movePlayerTo(5, 3);
        expect(no.started).toBe(false);
        expect(no.refused).toBe('Too heavy.');
        InnerMap.playerInnerQ = 5;
        expect(InnerMap.isPlayerSwimming()).toBe(true);
        InnerMap.playerInnerQ = 1;
        expect(InnerMap.isPlayerSwimming()).toBe(false);
    });

    it('a stroke is slower than a step', () => {
        InnerMap._swimSpeedBonus = 1;
        InnerMap.movePlayerTo(5, 3);
        const steps = [];
        for (let i = 0; i < 200 && InnerMap._playerWalking; i++) {
            const q0 = InnerMap.playerInnerQ;
            InnerMap.updatePlayer(0.05);
            if (InnerMap.playerInnerQ !== q0) steps.push(i);
        }
        expect(InnerMap.playerInnerQ).toBe(5);
        // three land steps, then the strokes take longer each
        const gaps = steps.slice(1).map((s, i) => s - steps[i]);
        expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[0]);
    });
});

describe('what a swim does to you', () => {
    it('a stroke tires and washes you; practice makes it easier', () => {
        const p = swimmer();
        p.needs.energy = 80;
        p.needs.hygiene = 20;
        p.washClothes && p.washClothes(100);
        const world = { season: 'Summer', day: 40 };
        const out = Swimming.stroke(p, world, null);
        expect(p.needs.energy).toBeLessThan(80);
        expect(p.needs.hygiene).toBeGreaterThan(20);
        expect(out.notices[0].title).toMatch(/Water/);
        const fresh = 80 - p.needs.energy;
        p.swimPractice = Swimming.config().practiceMax;
        const e0 = p.needs.energy;
        Swimming.stroke(p, world, null);
        expect(e0 - p.needs.energy).toBeLessThan(fresh);
        expect(Swimming.speedBonus(p)).toBeGreaterThan(1);
        expect(Swimming.ashore(p)).toBe(2);
        expect(p.swimStrokes).toBe(0);
    });

    it('winter water hurts; spent in the water, you go under', () => {
        const p = swimmer();
        p.needs.energy = 80;
        const cold = Swimming.stroke(p, { season: 'Winter', day: 100 }, null);
        expect(cold.cold).toBe(true);
        expect(p.health).toBeLessThan(100);
        const p2 = swimmer();
        p2.needs.energy = 2;
        const h = p2.health;
        const sink = Swimming.stroke(p2, { season: 'Summer', day: 40 }, null);
        expect(sink.drowning).toBe(true);
        expect(p2.health).toBe(h - Swimming.config().drownHealth);
        // tired: struggling, a lighter hurt
        const p3 = swimmer();
        p3.needs.energy = 10;
        const s = Swimming.stroke(p3, { season: 'Summer', day: 40 }, null);
        expect(s.struggling).toBe(true);
        expect(s.drowning).toBe(false);
    });

    it('no swimming spent, or with a full pack', () => {
        const p = swimmer();
        p.needs.energy = 2;
        expect(Swimming.canSwim(p).ok).toBe(false);
        p.needs.energy = 60;
        expect(Swimming.canSwim(p).ok).toBe(true);
        p.inventory = {};
        for (let i = 0; i < 40; i++) p.inventory['good' + i] = 1;
        const no = Swimming.canSwim(p);
        expect(no.ok).toBe(false);
        expect(no.reason).toMatch(/heavy/);
    });
});

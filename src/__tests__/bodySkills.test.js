/**
 * Body skills (data/skillPacks/body.json): Climbing — up and down the crags'
 * faces (world/innerMap/climbing.js, player/climbing.js) — and Endurance —
 * walking and working longer before tiring (player/endurance.js).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { PlayerInventory } from '../core/inventory.js';
import { InnerMap } from '../world/innerMap.js';
import { Climbing } from '../player/climbing.js';
import { Endurance } from '../player/endurance.js';
import { Swimming } from '../player/swimming.js';
import { Player } from '../player/player.js';

let gamedata;
beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    gamedata = DataLoader._gamedata;
});
beforeEach(() => {
    DataLoader._gamedata = gamedata;
    InnerMap._climbMax = 0;
    InnerMap._climb = null;
    InnerMap._climbRequest = null;
    InnerMap._underwater = false;
    InnerMap._swimAllowed = false;
    InnerMap._insideBuilding = false;
});

const summer = { season: 'Summer', day: 10 };
const winter = { season: 'Winter', day: 10 };
const hills = { terrain: { id: 'hills' } };

const body = (skills = {}) => {
    const p = new Player();
    p.inventory = {};
    p.health = 100;
    if (p.needs) p.needs.energy = 100;
    for (const [id, L] of Object.entries(skills)) PracticeSkills.setLevel(p, id, L);
    return p;
};

/**
 * A 12×14 map of grass with one crag laid by cliffs.js: a square crag 5 wide,
 * 3 deep, with a face `face` rows tall below it, at (3, 2).
 */
function craggyMap(face = 2) {
    const W = 12, H = 14;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, subTerrain: { id: 'grass', passable: true } });
        tiles.push(row);
    }
    InnerMap._standCrag(tiles, 3, 2, 5, 3, face);
    InnerMap.tiles = tiles;
    InnerMap.width = W;
    InnerMap.height = H;
    InnerMap._climbLinkCache = null;
    InnerMap.playerInnerQ = 5;
    InnerMap.playerInnerR = 2 + 3 + face; // the face's foot
    InnerMap.cancelPlayerWalk();
    return tiles;
}

describe('the crags as a climber sees them', () => {
    it('a crag top stands a level up, its face is no place to stand, the ground is 0', () => {
        const tiles = craggyMap(2);
        expect(InnerMap.standLevel(tiles[3][5])).toBe(1);   // the open top
        expect(InnerMap.standLevel(tiles[5][5])).toBeNull(); // the face
        expect(InnerMap.standLevel(tiles[9][5])).toBe(0);
        expect(InnerMap.playerLevel()).toBe(0);
    });

    it('each column of the face is a climb, both ways, as tall as its rows', () => {
        craggyMap(3);
        const foot = 2 + 3 + 3; // row below the face
        const up = InnerMap.linksFrom(5, foot);
        expect(up).toHaveLength(1);
        expect(up[0]).toMatchObject({ toQ: 5, toR: 4, rows: 3, up: true, fromLevel: 0, toLevel: 1 });
        const down = InnerMap.linksFrom(5, 4);
        expect(down[0]).toMatchObject({ toQ: 5, toR: foot, rows: 3, up: false });
        // every column of the 5-wide crag
        for (let q = 3; q < 8; q++) expect(InnerMap.linksFrom(q, foot)).toHaveLength(1);
        expect(InnerMap.linksFrom(2, foot)).toHaveLength(0);
    });

    it('a second crag on a first one stands two up, climbed from the first top', () => {
        const W = 20, H = 20;
        const tiles = [];
        for (let r = 0; r < H; r++) tiles.push(Array.from({ length: W }, (_, q) => ({ q, r, subTerrain: { id: 'grass', passable: true } })));
        InnerMap._standCrag(tiles, 2, 2, 12, 8, 2);
        InnerMap._standCrag(tiles, 5, 3, 4, 2, 2);
        InnerMap.tiles = tiles; InnerMap.width = W; InnerMap.height = H; InnerMap._climbLinkCache = null;
        expect(InnerMap.standLevel(tiles[3][6])).toBe(2);
        const l = InnerMap.linksFrom(6, 7)[0];
        expect(l).toMatchObject({ fromLevel: 1, toLevel: 2, rows: 2, toR: 4 });
    });
});

describe('a generated mountain map', () => {
    it('has faces to climb on its crags, square and angled, each from ground to a top', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const json = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'data/innerMap.json'), 'utf-8'));
        InnerMap.initialize(json);
        InnerMap._cache = {};
        InnerMap.season = 'summer';
        DataLoader._gamedata = { ...gamedata, terrainNineTileBrushes: [] };
        const tiles = InnerMap.generate({ terrain: { id: 'mountain' }, elevation: 0.7, temperature: 0.4, moisture: 0.4 }, 5, 7, null);
        InnerMap.tiles = tiles; InnerMap.width = tiles[0].length; InnerMap.height = tiles.length; InnerMap._climbLinkCache = null;
        const links = [...InnerMap.climbLinks().values()].flat().filter(l => l.up);
        expect(links.length).toBeGreaterThan(30);
        for (const l of links) {
            expect(InnerMap.standLevel(tiles[l.toR][l.toQ])).toBe(l.toLevel);
            expect(l.toLevel).toBeGreaterThan(l.fromLevel);
            expect(l.rows).toBeGreaterThanOrEqual(2);
        }
        expect(links.some(l => l.toLevel === 2)).toBe(true); // a second step up somewhere
    });
});

describe('the player on the crags', () => {
    it('walkers never path over a crag; a climber goes up the face', () => {
        const tiles = craggyMap(2);
        // nobody else's paths climb
        expect(InnerMap._findPath(5, 8, 5, 3)).toBeNull();
        // no climbing: refused
        expect(InnerMap.movePlayerTo(5, 3).started).toBe(false);
        InnerMap._climbMax = 2;
        const walk = InnerMap.movePlayerTo(5, 3);
        expect(walk.started).toBe(true);
        const path = InnerMap._playerPath;
        const jump = path.findIndex((s, i) => i > 0 && Math.abs(s.r - path[i - 1].r) > 1);
        expect(jump).toBeGreaterThan(0);
        // the walk waits at the foot for the climb
        InnerMap.updatePlayer(5);
        expect(InnerMap._climbRequest).toMatchObject({ rows: 2, up: true });
        expect(InnerMap.playerInnerR).toBe(7);
        // up, and on along the top
        InnerMap._climb = { link: InnerMap._climbRequest, elapsed: 0, duration: 1, tiles };
        InnerMap._climbRequest = null;
        expect(InnerMap.getPlayerWorldPos().climbing).toBe(true);
        InnerMap.finishClimb(5, 4);
        expect(InnerMap.playerLevel()).toBe(1);
        for (let i = 0; i < 5 && InnerMap._playerWalking; i++) InnerMap.updatePlayer(5);
        expect([InnerMap.playerInnerQ, InnerMap.playerInnerR]).toEqual([5, 3]);
    });

    it('up top, only the top is ground; a face too tall for you is no way at all', () => {
        craggyMap(3);
        InnerMap.playerInnerR = 3; // on the top
        expect(InnerMap._playerMayEnter(InnerMap.tiles[3][6], 6, 3)).toBe(true);
        expect(InnerMap._playerMayEnter(InnerMap.tiles[1][5], 5, 1)).toBe(false); // the ground behind: a drop
        InnerMap._climbMax = 2;
        expect(InnerMap.movePlayerTo(5, 11).started).toBe(false);
        InnerMap._climbMax = 3;
        expect(InnerMap.movePlayerTo(5, 11).started).toBe(true);
    });

    it('a click on the face goes to its far end', () => {
        craggyMap(2);
        expect(InnerMap.climbTargetFor(5, 6)).toEqual({ q: 5, r: 4 });
        InnerMap.playerInnerR = 3;
        expect(InnerMap.climbTargetFor(5, 6)).toEqual({ q: 5, r: 7 });
    });
});

describe('Climbing, by level', () => {
    it('reaches taller faces, quicker, with less slipping and less tiring', () => {
        const lo = body(), hi = body({ climbing: 8 });
        expect(Climbing.reach(lo)).toBe(2);
        expect(Climbing.reach(hi)).toBeGreaterThanOrEqual(4);
        Utils.setSeed(1);
        const a = Climbing.plan(lo, { rows: 2, world: summer, worldTile: hills });
        const b = Climbing.plan(hi, { rows: 2, world: summer, worldTile: hills });
        expect(b.duration).toBeLessThan(a.duration);
        expect(b.energy).toBeLessThan(a.energy);
        expect(Climbing.slipChance(hi, 2, summer, hills)).toBeLessThan(Climbing.slipChance(lo, 2, summer, hills));
        // climbing down is quicker
        expect(Climbing.plan(lo, { rows: 2, down: true, world: summer }).duration).toBeLessThan(a.duration);
    });

    it('winter and the snows make every face taller', () => {
        const p = body({ climbing: 3 });
        expect(Climbing.canClimb(p, 3, { world: summer, worldTile: hills }).ok).toBe(true);
        const no = Climbing.canClimb(p, 3, { world: winter, worldTile: hills });
        expect(no.ok).toBe(false);
        expect(no.reason).toMatch(/Climbing \d/);
        expect(Climbing.maxRows(p, summer, { terrain: { id: 'snow_peak' } })).toBe(Climbing.reach(p) - 1);
    });

    it('too spent or too laden, you will not try', () => {
        const p = body();
        p.needs.energy = 2;
        expect(Climbing.canClimb(p, 2, { world: summer }).ok).toBe(false);
    });

    it('a climb pays its energy and earns XP, more at your limit; a fall hurts and teaches less', () => {
        const p = body();
        const plan = { rows: 2, down: false, duration: 6, energy: 5, height: 2, atLimit: true, slip: null };
        const e0 = p.needs.energy;
        Climbing.finish(p, plan);
        expect(p.needs.energy).toBeCloseTo(e0 - 5, 5);
        const clean = PracticeSkills.xp(p, 'climbing');
        expect(clean).toBeGreaterThan(0);
        const q = body();
        const res = Climbing.finish(q, { ...plan, slip: { at: 0.5, fallRows: 1, damage: 7 } });
        expect(q.health).toBe(93);
        expect(res.notices.some(n => /Fell/.test(n.title))).toBe(true);
        expect(PracticeSkills.xp(q, 'climbing')).toBeLessThan(clean);
    });

    it('slips at the limit come from the seeded RNG, the same for the same seed', () => {
        const p = body();
        const roll = () => {
            Utils.setSeed(42);
            return Array.from({ length: 40 }, () => !!Climbing.plan(p, { rows: 2, world: summer }).slip).join('');
        };
        const first = roll();
        expect(roll()).toBe(first);
        expect(first).toContain('true');
        expect(first).toContain('false');
    });
});

describe('Endurance', () => {
    it('labour costs less energy as it rises, and builds it', () => {
        const lo = body(), hi = body({ endurance: 7 });
        const a = Endurance.labour(lo, 10), b = Endurance.labour(hi, 10);
        expect(a).toBe(10);
        expect(b).toBeLessThan(a);
        expect(PracticeSkills.xp(lo, 'endurance')).toBeGreaterThan(0);
    });

    it('the miles build it, and a level-up is queued for the UI to tell', () => {
        const p = body();
        for (let i = 0; i < 40; i++) Endurance.walked(p, 'hex', 1);
        expect(PracticeSkills.level(p, 'endurance')).toBeGreaterThan(1);
        const ups = Endurance.takeQueued(p);
        expect(ups.length).toBeGreaterThan(0);
        expect(ups[0].text).toMatch(/Endurance rose to level/);
        expect(Endurance.takeQueued(p)).toEqual([]);
        // aboard ship it's no walk
        const s = body();
        s.boardedShip = 'x';
        Endurance.walked(s, 'hex', 10);
        expect(PracticeSkills.xp(s, 'endurance')).toBe(0);
    });

    it('the hardy tire slower by the hour, sleep better, carry more and go further', () => {
        const lo = body(), hi = body({ endurance: 9 });
        lo.decayNeedsPerHour({});
        hi.decayNeedsPerHour({});
        expect(hi.needs.energy).toBeGreaterThan(lo.needs.energy);
        lo.needs.energy = 10; hi.needs.energy = 10;
        lo.restOvernight('camp'); hi.restOvernight('camp');
        expect(hi.needs.energy).toBeGreaterThan(lo.needs.energy);
        expect(PlayerInventory.getCapacity(hi) - PlayerInventory.getCapacity(lo)).toBe(Endurance.carry(hi));
        expect(Endurance.carry(hi)).toBeGreaterThan(0);
        expect(Endurance.stride(hi)).toBeGreaterThan(0);
        expect(Endurance.stride(lo)).toBe(0);
        expect(PlayerInventory.getCapacity(lo)).toBe(PlayerInventory.getCapacity(body()));
    });

    it('a stroke costs the hardy less and teaches a little', () => {
        const lo = body(), hi = body({ endurance: 9 });
        Swimming.stroke(lo, summer, null);
        Swimming.stroke(hi, summer, null);
        expect(hi.needs.energy).toBeGreaterThan(lo.needs.energy);
        expect(PracticeSkills.xp(lo, 'endurance')).toBeGreaterThan(0);
    });
});

describe('NPCs', () => {
    it('mountain folk climb; labourers and porters are hardy', () => {
        const level = (who, id) => {
            const h = {};
            PracticeSkills.seedNpc(h, who);
            return PracticeSkills.level(h, id);
        };
        const avg = (fn) => { let t = 0; for (let i = 0; i < 200; i++) t += fn(i); return t / 200; };
        const hill = avg(i => level({ key: `m${i}`, role: 'villager', age: 30, mountain: true }, 'climbing'));
        const flat = avg(i => level({ key: `m${i}`, role: 'villager', age: 30 }, 'climbing'));
        expect(hill).toBeGreaterThan(flat + 1.5);
        // some villagers are labourers or porters: hardier on average than nobles
        const vill = avg(i => level({ key: `v${i}`, role: 'villager', age: 30 }, 'endurance'));
        const noble = avg(i => level({ key: `v${i}`, role: 'noble', age: 30 }, 'endurance'));
        expect(vill).toBeGreaterThan(noble);
        expect(PracticeSkills.bodyTradesOf({ key: 'v1', role: 'noble' })).toEqual([]);
    });

    it('a porter grows hardier with the work', () => {
        let key = null;
        for (let i = 0; i < 400 && !key; i++) if (PracticeSkills.bodyTradesOf({ key: `p${i}`, role: 'villager' }).includes('porter')) key = `p${i}`;
        expect(key).not.toBeNull();
        const h = { practiceSkills: {} };
        PracticeSkills.growNpc(h, { key, role: 'villager', age: 30 }, 60);
        expect(PracticeSkills.xp(h, 'endurance')).toBeGreaterThan(50);
    });
});

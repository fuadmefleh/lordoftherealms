// Living animals on the inner map (world/innerMap/animals.js, data/animals.json):
// the deer sheets' frame grid, herds hash-placed by terrain (none at sea, in a
// city or on a town's built ground), grazing and wandering on open ground,
// bolting from the player and calming again, and the hunt of a deer you can
// see (ui/mapTasks/wildTasks.js) — a kill culls it from its hex's herd.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import { DataLoader } from '../core/dataLoader.js';
import { WildTasks } from '../systems/wildTasks.js';

let InnerMap, InnerMapTasks, WildTaskRunner, SaveLoad;

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ InnerMapTasks } = await import('../ui/innerMapTasks.js'));
    ({ WildTaskRunner } = await import('../ui/mapTasks/wildTasks.js'));
    ({ SaveLoad } = await import('../systems/saveLoad.js'));
    for (const k of ['_mountHud', '_unmountHud', '_renderHud']) vi.spyOn(InnerMapTasks, k).mockImplementation(() => {});
});

const cfg = () => DataLoader.get('animals');

/** An open map of grass, W×H; `mark(t, q, r)` dresses tiles. */
function openTiles(W = 128, H = 128, mark = null) {
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) {
            const t = { q, r, subTerrain: { id: 'grass', passable: true }, visible: true, explored: true };
            if (mark) mark(t, q, r);
            row.push(t);
        }
        tiles.push(row);
    }
    return tiles;
}

const saved = {};
const KEYS = ['active', 'tiles', 'width', 'height', 'playerInnerQ', 'playerInnerR', '_playerWalking', '_insideBuilding', 'buildings', 'animals', 'npcs', 'currentWorldTile', '_animalRng', '_animalBuiltDist'];
function openMap(tiles, at = { q: 64, r: 64 }) {
    for (const k of KEYS) saved[k] = InnerMap[k];
    Object.assign(InnerMap, {
        active: true, tiles, width: tiles[0].length, height: tiles.length, playerInnerQ: at.q, playerInnerR: at.r,
        _playerWalking: false, _insideBuilding: null, buildings: [], animals: [], npcs: [], currentWorldTile: { q: 5, r: 7 },
    });
}
afterEach(() => {
    if (InnerMapTasks.active) InnerMapTasks.abandon(true);
    if (saved.tiles !== undefined) Object.assign(InnerMap, saved);
});

/** A wild hex of `terrain` with a herd (the first of a run of hexes that has one). */
function wildHerd(terrain = 'woodland', world = null) {
    for (let i = 0; i < 40; i++) {
        const plan = InnerMap.planHerds(openTiles(), terrain, 5 + i, 7, 'deer-seed', { season: 'Summer', culled: InnerMap.culledAnimals(world, 5 + i, 7) });
        if (plan.length) return { plan, q: 5 + i, r: 7 };
    }
    return null;
}

describe('the deer sheets', () => {
    it('name sheets on disk with a 4×4 grid (up, left, down, right) whose cells hold the art', () => {
        const c = cfg();
        expect(c && c.species).toBeTruthy();
        for (const id of ['stag', 'doe', 'fawn']) {
            const sp = c.species[id];
            expect(sp, id).toBeTruthy();
            expect(fs.existsSync(sp.sheet), sp.sheet).toBe(true);
            expect(sp.cols).toBe(4);
            expect(Object.keys(sp.rows).sort()).toEqual(['down', 'left', 'right', 'up']);
            expect(new Set(Object.values(sp.rows)).size).toBe(4);
            // PNG header: the sheet is exactly cols × frameW wide and 4 × frameH high
            const buf = fs.readFileSync(sp.sheet);
            expect(buf.readUInt32BE(16)).toBe(sp.cols * sp.frameW);
            expect(buf.readUInt32BE(20)).toBe(4 * sp.frameH);
            // the feet anchor lies inside a cell
            expect(sp.anchor[0]).toBeGreaterThan(0);
            expect(sp.anchor[0]).toBeLessThan(sp.frameW);
            expect(sp.anchor[1]).toBeLessThanOrEqual(sp.frameH);
            expect(sp.fleeSpeed).toBeGreaterThan(sp.walkSpeed);
        }
        // the trail hunt's deer and stag are drawn from these sheets
        expect(c.species[c.huntBeasts.deer]).toBeTruthy();
        expect(c.species[c.huntBeasts.stag]).toBeTruthy();
        expect(fs.existsSync('assets/lpc/Animals/Credits.txt')).toBe(true);
    });
});

describe('herds by terrain', () => {
    it('woods hold herds: a stag and does (fawns in summer), the same each visit', () => {
        const h = wildHerd('woodland');
        expect(h).toBeTruthy();
        const again = InnerMap.planHerds(openTiles(), 'woodland', h.q, h.r, 'deer-seed', { season: 'Summer' });
        expect(again).toEqual(h.plan);
        const kinds = new Set(h.plan.map(a => a.species));
        expect(kinds.has('doe')).toBe(true);
        // every member about its herd's home, inside the map's margin, off the centre where you arrive
        for (const a of h.plan) {
            expect(Math.max(Math.abs(a.q - a.homeQ), Math.abs(a.r - a.homeR))).toBeLessThanOrEqual(cfg().herds.deer.spread);
            expect(Math.max(Math.abs(a.homeQ - 64), Math.abs(a.homeR - 64))).toBeGreaterThanOrEqual(cfg().placement.minFromCentre);
        }
        // no two on one tile
        expect(new Set(h.plan.map(a => `${a.q},${a.r}`)).size).toBe(h.plan.length);
        // across many woods hexes some herd has a stag; winter has no fawns
        let stags = 0, winterFawns = 0;
        for (let i = 0; i < 30; i++) {
            stags += InnerMap.planHerds(openTiles(), 'woodland', i, 3, 's', { season: 'Summer' }).filter(a => a.species === 'stag').length;
            winterFawns += InnerMap.planHerds(openTiles(), 'woodland', i, 3, 's', { season: 'Winter' }).filter(a => a.species === 'fawn').length;
        }
        expect(stags).toBeGreaterThan(0);
        expect(winterFawns).toBe(0);
    });

    it('none at sea, in the desert, on a mountain, in a city or a capital', () => {
        for (let i = 0; i < 30; i++) {
            for (const t of ['ocean', 'deep_ocean', 'sea', 'lake', 'desert', 'mountain', 'snow_peak', 'beach']) {
                expect(InnerMap.planHerds(openTiles(), t, i, 2, 'x')).toEqual([]);
            }
            for (const st of ['city', 'capital']) {
                expect(InnerMap.planHerds(openTiles(), 'woodland', i, 2, 'x', { settlementType: st })).toEqual([]);
            }
        }
    });

    it('fewer by a village and next to a town; never on or near its built ground', () => {
        let wild = 0, village = 0, near = 0;
        // a village's built ground: a block of houses and streets in the middle
        const town = () => openTiles(128, 128, (t, q, r) => {
            if (q >= 34 && q <= 94 && r >= 34 && r <= 94) {
                if ((q + r) % 6 === 0) t.isRoad = true;
                else if (q % 9 === 0 && r % 9 === 0) { t.building = { type: 'house' }; t.subTerrain.passable = false; }
                else t._lot = true;
            }
        });
        const margin = cfg().placement.builtMargin;
        for (let i = 0; i < 60; i++) {
            wild += InnerMap.planHerds(openTiles(), 'woodland', i, 9, 'y').length ? 1 : 0;
            near += InnerMap.planHerds(openTiles(), 'woodland', i, 9, 'y', { nearTown: true }).length ? 1 : 0;
            const tiles = town();
            const plan = InnerMap.planHerds(tiles, 'woodland', i, 9, 'y', { settlementType: 'village' });
            if (plan.length) village++;
            for (const a of plan) {
                // outside the built block by the margin
                const dq = Math.max(0, 34 - a.q, a.q - 94), dr = Math.max(0, 34 - a.r, a.r - 94);
                expect(Math.max(dq, dr)).toBeGreaterThanOrEqual(margin);
            }
        }
        expect(wild).toBeGreaterThan(village);
        expect(wild).toBeGreaterThanOrEqual(near);
        expect(near).toBeGreaterThan(0);
    });

    it('never on water, a house or a tree trunk, and keep away from folk on the map', () => {
        const tiles = openTiles(128, 128, (t, q, r) => {
            if ((q * 7 + r * 13) % 5 === 0) { t.subTerrain = { id: 'pond_water', passable: false }; }
            else if ((q + r * 3) % 11 === 0) { t.customObjectPart = { anchorQ: q, anchorR: r }; t.subTerrain.passable = false; }
        });
        const people = [{ q: 30, r: 30 }, { q: 100, r: 100 }];
        for (let i = 0; i < 25; i++) {
            for (const a of InnerMap.planHerds(tiles, 'seasonal_forest', i, 4, 'z', { people })) {
                const t = tiles[a.r][a.q];
                expect(t.subTerrain.passable).toBe(true);
                expect(t.customObjectPart).toBeFalsy();
                for (const p of people) expect(Math.max(Math.abs(p.q - a.homeQ), Math.abs(p.r - a.homeR))).toBeGreaterThanOrEqual(cfg().placement.peopleMargin);
            }
        }
    });

    it('come onto the map on entering (their own list, not the townsfolk)', () => {
        const h = wildHerd('woodland');
        openMap(openTiles());
        const world = { day: 3, season: 'Summer', generationParams: { seed: 'deer-seed' }, getTile: () => null };
        InnerMap._spawnAnimals({ world }, { terrain: { id: 'woodland' } }, h.q, h.r);
        expect(InnerMap.animals.map(a => a.id)).toEqual(h.plan.map(a => a.id));
        expect(InnerMap.npcs).toEqual([]);
        // and none on a sea hex (your deck at sea)
        InnerMap._spawnAnimals({ world }, { terrain: { id: 'ocean' } }, h.q, h.r);
        expect(InnerMap.animals).toEqual([]);
    });
});

describe('how they live', () => {
    /** One deer (and its herd mates) on an open map, the player at `me`. */
    function herdAt(members, me = { q: 64, r: 64 }, tiles = openTiles()) {
        openMap(tiles, me);
        InnerMap.animals = members.map((m, i) => InnerMap._makeAnimal({ id: `t:${i}`, herd: 'h', homeQ: m.q, homeR: m.r, ...m }, cfg()));
        InnerMap._animalRng = null;
        return InnerMap.animals;
    }
    const run = (secs, o = {}) => { for (let t = 0; t < secs; t += 0.05) InnerMap.updateAnimals(0.05, o); };
    const far = (a, me) => Math.hypot(a.q - me.q, a.r - me.r);

    it('graze and amble about their home, never off open ground', () => {
        const tiles = openTiles(128, 128, (t, q, r) => {
            // a pond and a wall of houses round about
            if (Math.hypot(q - 30, r - 36) < 4) t.subTerrain = { id: 'pond_water', passable: false };
            if (r === 24 && q > 20 && q < 40) { t.building = { type: 'house' }; t.subTerrain.passable = false; }
        });
        const [doe] = herdAt([{ species: 'doe', q: 30, r: 30 }], { q: 110, r: 110 }, tiles);
        const seen = new Set();
        let walked = false;
        for (let i = 0; i < 1200; i++) {
            InnerMap.updateAnimals(0.1, {});
            const t = tiles[doe.r][doe.q];
            expect(t.subTerrain.passable).toBe(true);
            expect(t.building).toBeFalsy();
            if (doe.next) walked = true;
            seen.add(`${doe.q},${doe.r}`);
            expect(Math.max(Math.abs(doe.q - 30), Math.abs(doe.r - 30))).toBeLessThanOrEqual(cfg().behaviour.homeRange + 1);
        }
        expect(walked).toBe(true);
        expect(seen.size).toBeGreaterThan(3);
    });

    it('bolt from the player who comes near, away from them, the herd with them — then stop and stare', () => {
        const me = { q: 60, r: 60 };
        const [stag, doe] = herdAt([{ species: 'stag', q: 64, r: 60 }, { species: 'doe', q: 66, r: 62 }], me);
        const before = far(stag, me);
        InnerMap.updateAnimals(0.05, { walking: true });
        expect(stag.state).toBe('flee');
        expect(doe.state).toBe('flee');
        run(1, { walking: true });
        expect(far(stag, me)).toBeGreaterThan(before + 3);
        expect(stag.q).toBeGreaterThan(64); // the player is to the west: it runs east
        run(8, { walking: true });
        expect(far(stag, me)).toBeGreaterThanOrEqual(cfg().behaviour.calmDistance - 1);
        expect(['alert', 'graze', 'walk']).toContain(stag.state);
        // it settles where it stopped
        run(12);
        expect(stag.state).not.toBe('flee');
        expect(Math.max(Math.abs(stag.homeQ - 64), Math.abs(stag.homeR - 60))).toBeGreaterThan(5);
    });

    it('a hunter standing still (or stealthy) can come nearer before it notices', () => {
        const [doe] = herdAt([{ species: 'doe', q: 64, r: 64 }]);
        const walk = InnerMap.animalNoticeRadius(doe, { walking: true, stealth: 1 });
        const still = InnerMap.animalNoticeRadius(doe, { walking: false, stealth: 1 });
        const sly = InnerMap.animalNoticeRadius(doe, { walking: true, stealth: 8 });
        expect(still).toBeLessThan(walk);
        expect(sly).toBeLessThan(walk);
        // six tiles off: walking puts it up, standing does not
        herdAt([{ species: 'doe', q: 70, r: 64 }]);
        InnerMap.updateAnimals(0.05, { walking: false });
        expect(InnerMap.animals[0].state).not.toBe('flee');
        InnerMap.updateAnimals(0.05, { walking: true });
        expect(InnerMap.animals[0].state).toBe('flee');
    });

    it('run round water, not into it; cornered, they stand', () => {
        // a lake east of the deer: fleeing east from the player it must go round
        const tiles = openTiles(128, 128, (t, q, r) => { if (q >= 70 && q <= 74 && r >= 40 && r <= 80) t.subTerrain = { id: 'lake_water', passable: false }; });
        const me = { q: 62, r: 60 };
        const [doe] = herdAt([{ species: 'doe', q: 66, r: 60 }], me, tiles);
        for (let i = 0; i < 200; i++) {
            InnerMap.updateAnimals(0.05, { walking: true });
            expect(tiles[doe.r][doe.q].subTerrain.passable).toBe(true);
            if (doe.next) expect(tiles[doe.next.r][doe.next.q].subTerrain.passable).toBe(true);
        }
        expect(far(doe, me)).toBeGreaterThan(5);
        // boxed in on three sides with the player on the fourth: no step, it stands at bay
        const box = openTiles(128, 128, (t, q, r) => {
            if ((q === 9 && r >= 9 && r <= 11) || (r === 9 && q >= 9 && q <= 11) || (r === 11 && q >= 9 && q <= 11)) t.subTerrain = { id: 'x', passable: false };
        });
        const [cor] = herdAt([{ species: 'doe', q: 10, r: 10 }], { q: 12, r: 10 }, box);
        run(1, { walking: true });
        expect(cor.q).toBe(10);
        expect(cor.r).toBe(10);
        expect(cor.state).not.toBe('walk');
    });

    it('are not moved while inside a building or once hunted', () => {
        const [doe] = herdAt([{ species: 'doe', q: 64, r: 66 }]);
        InnerMap._insideBuilding = { name: 'Inn' };
        run(1, { walking: true });
        expect(doe.state).toBe('graze');
        InnerMap._insideBuilding = null;
        doe.hunted = true;
        run(1, { walking: true });
        expect(doe.state).toBe('graze');
        expect([doe.q, doe.r]).toEqual([64, 66]);
    });
});

describe('the hunt', () => {
    it('a living deer\'s loot is the hunting table\'s own entries, venison first', () => {
        const tables = DataLoader.get('earlyJobs').hunting.loot_table;
        const stag = WildTasks.animalLoot(cfg().species.stag, tables);
        expect(stag.map(e => e.name)).toEqual(['Venison', 'Antlers', 'Hides']);
        expect(stag[0].item).toBe('game_meat');
        expect(stag[0].chance).toBe(1);
        expect(WildTasks.animalLoot(cfg().species.doe, tables).map(e => e.name)).toEqual(['Venison', 'Hides']);
        // the tables themselves are untouched
        expect(tables.forest[0].chance).toBe(0.35);
    });

    it('hunting a deer you can see: straight to the stalk of that very animal, and a kill culls it from the herd', async () => {
        const world = { day: 50, generationParams: { seed: 'deer-seed' }, getTile: () => null };
        const h = wildHerd('woodland', world);
        openMap(openTiles(), { q: 64, r: 64 });
        InnerMap.currentWorldTile = { q: h.q, r: h.r };
        InnerMap._spawnAnimals({ world }, { terrain: { id: 'woodland' } }, h.q, h.r);
        const deer = InnerMap.animals[0];
        const g = { world, player: { name: 'T', luck: 5, skills: { stealth: 3 }, q: 0, r: 0 }, ui: { hideCustomPanel() {}, showCustomPanel() {} } };
        let out;
        await WildTaskRunner.hunt(g, { player: g.player, prey: { name: 'Stag' }, animal: deer }, (o) => { out = o; });
        const ctx = InnerMapTasks.active;
        expect(ctx).toBeTruthy();
        expect(ctx.phase).toBe('stalk');
        expect(ctx.animal).toBe(deer);
        expect(deer.hunted).toBe(true);
        // the ambient life leaves it to the hunt
        InnerMap.updateAnimals(0.5, { walking: true });
        expect(deer.state).not.toBe('flee');
        // creep up beside it (standing still) and loose
        InnerMap.playerInnerQ = deer.q - 2; InnerMap.playerInnerR = deer.r;
        InnerMapTasks.update(0.1, g);
        const shoot = ctx.tpl.buttons(ctx).find(b => b.label === WildTasks.cfg('hunt').shoot);
        expect(shoot).toBeTruthy();
        shoot.act();
        expect(out && out.result).toBe('shot');
        expect(out.animal).toBe(deer);
        // the kill: off the map, and missing from the herd on the next visit until it grows back
        InnerMap.cullAnimal(world, deer);
        expect(InnerMap.animals).not.toContain(deer);
        expect(world.wildlife.culled[`${h.q},${h.r}`].map(c => c.id)).toEqual([deer.id]);
        const next = InnerMap.planHerds(openTiles(), 'woodland', h.q, h.r, 'deer-seed', { season: 'Summer', culled: InnerMap.culledAnimals(world, h.q, h.r) });
        expect(next.map(a => a.id)).not.toContain(deer.id);
        expect(next.length).toBe(h.plan.length - 1);
        world.day += cfg().respawnDays;
        expect(InnerMap.culledAnimals(world, h.q, h.r)).toEqual([]);
    });

    it('a deer that lives goes back to its own life, running from you', () => {
        openMap(openTiles(), { q: 64, r: 64 });
        const a = InnerMap._makeAnimal({ id: 'x', species: 'doe', q: 66, r: 64 }, cfg());
        InnerMap.animals = [a];
        a.hunted = true; a.drawQ = 66; a.drawR = 64;
        InnerMap.releaseAnimal(a, { q: 64, r: 64 });
        expect(a.hunted).toBe(false);
        expect(a.drawQ).toBe(null);
        expect(a.state).toBe('flee');
        // a beast put on the map only for the hunt leaves with it
        const t = InnerMap.addTaskAnimal('stag', 70, 70);
        expect(InnerMap.animals).toContain(t);
        InnerMap.releaseAnimal(t);
        expect(InnerMap.animals).not.toContain(t);
    });

    it('the trail hunt of a deer is drawn as a deer, and follows one grazing on the map', async () => {
        openMap(openTiles(), { q: 64, r: 64 });
        const grazing = InnerMap._makeAnimal({ id: 'g', species: 'doe', q: 90, r: 70 }, cfg());
        InnerMap.animals = [grazing];
        const g = { world: { day: 1 }, player: { name: 'T', luck: 5, skills: {}, q: 0, r: 0 }, ui: { hideCustomPanel() {}, showCustomPanel() {} } };
        await WildTaskRunner.hunt(g, { player: g.player, prey: { name: 'Venison' } }, () => {});
        const ctx = InnerMapTasks.active;
        expect(ctx.phase).toBe('track');
        expect(ctx.home).toEqual({ q: 90, r: 70 });
        expect(grazing.hunted).toBe(true);
        ctx.tpl._sight(ctx);
        expect(ctx.animal).toBe(grazing);
        expect(ctx.beast.animal).toBe(grazing);
        InnerMapTasks.abandon(true);
        // no deer on the map: one is put there for the hunt, drawn from its sheet
        InnerMap.animals = [];
        await WildTaskRunner.hunt(g, { player: g.player, prey: { name: 'Antlers' } }, () => {});
        const ctx2 = InnerMapTasks.active;
        ctx2.tpl._sight(ctx2);
        expect(ctx2.animal && ctx2.animal.species).toBe('stag');
        expect(ctx2.animal.temporary).toBe(true);
        // a fox stays a paw token
        InnerMapTasks.abandon(true);
        InnerMap.animals = [];
        await WildTaskRunner.hunt(g, { player: g.player, prey: { name: 'Fur Pelts' } }, () => {});
        const ctx3 = InnerMapTasks.active;
        ctx3.tpl._sight(ctx3);
        expect(ctx3.animal).toBe(null);
    });

    it('the kills travel with the save', () => {
        const world = { wildlife: { culled: { '5,7': [{ id: '5,7:0:doe0', day: 3 }] } } };
        const back = JSON.parse(JSON.stringify(SaveLoad.serializeWorld({ ...stubWorld(), ...world })));
        expect(back.wildlife).toEqual(world.wildlife);
    });
});

function stubWorld() {
    return { width: 1, height: 1, day: 1, season: 'Spring', year: 1, tiles: [], kingdoms: [], events: [], units: [] };
}

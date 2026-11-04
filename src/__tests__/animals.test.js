// Living animals on the inner map (world/innerMap/animals.js, data/animals.json):
// the deer sheets' frame grid, herds hash-placed by terrain (none at sea, in a
// city or on a town's built ground), grazing and wandering on open ground,
// bolting from the player and calming again, and the hunt of a deer you can
// see (ui/mapTasks/wildTasks.js) — a kill culls it from its hex's herd.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import { DataLoader } from '../core/dataLoader.js';
import { WildTasks } from '../systems/wildTasks.js';

let InnerMap, InnerMapTasks, WildTaskRunner, SaveLoad, InnerMapAnimals, InnerMapCombat;

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ InnerMapTasks } = await import('../ui/innerMapTasks.js'));
    ({ WildTaskRunner } = await import('../ui/mapTasks/wildTasks.js'));
    ({ SaveLoad } = await import('../systems/saveLoad.js'));
    ({ InnerMapAnimals } = await import('../ui/innerMapAnimals.js'));
    ({ InnerMapCombat } = await import('../ui/innerMapCombat.js'));
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
const KEYS = ['active', 'tiles', 'width', 'height', 'playerInnerQ', 'playerInnerR', '_playerWalking', '_insideBuilding', 'buildings', 'animals', 'npcs', 'currentWorldTile', '_animalRng', '_animalBuiltDist', 'timeOfDay'];
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

    it('none at sea, in the desert, on a snow peak, in a city or a capital', () => {
        for (let i = 0; i < 30; i++) {
            for (const t of ['ocean', 'deep_ocean', 'sea', 'lake', 'desert', 'snow_peak', 'beach']) {
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
            near += InnerMap.planHerds(openTiles(), 'woodland', i, 9, 'y', { nearTown: true }).filter(a => !a.livestock).length ? 1 : 0;
            const tiles = town();
            const plan = InnerMap.planHerds(tiles, 'woodland', i, 9, 'y', { settlementType: 'village' }).filter(a => !a.livestock);
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
        const [cor] = herdAt([{ species: 'fawn', q: 10, r: 10 }], { q: 12, r: 10 }, box);
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
        // a fox is drawn as a fox now; an eagle stays a paw token
        InnerMapTasks.abandon(true);
        InnerMap.animals = [];
        await WildTaskRunner.hunt(g, { player: g.player, prey: { name: 'Fur Pelts' } }, () => {});
        const ctxF = InnerMapTasks.active;
        ctxF.tpl._sight(ctxF);
        expect(ctxF.animal && ctxF.animal.species).toBe('fox');
        InnerMapTasks.abandon(true);
        InnerMap.animals = [];
        await WildTaskRunner.hunt(g, { player: g.player, prey: { name: 'Eagle Feathers' } }, () => {});
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

// ── The wider bestiary: every species, predators, livestock, carcasses ──

const SPECIES = ['stag', 'doe', 'fawn', 'elk', 'reindeer', 'mountain_goat', 'rabbit', 'snow_rabbit', 'sheep', 'highland_cow',
    'boar', 'fox', 'arctic_fox', 'wolf', 'bear', 'polar_bear', 'lion', 'panther', 'elephant'];

/** Species seen across many hexes of a terrain (o: planHerds options). */
function speciesIn(terrain, o = {}, n = 60) {
    const seen = new Set();
    for (let i = 0; i < n; i++) for (const a of InnerMap.planHerds(openTiles(), terrain, i, 11, 'beasts', { season: 'Summer', ...o })) seen.add(a.species);
    return seen;
}

/** A game stub for the UI layer: a player with health, a world, a quiet UI. */
function stubGame(extra = {}) {
    const notes = [];
    const player = { name: 'T', health: 100, maxHealth: 100, gold: 100, strength: 6, luck: 5, skills: { combat: 3, stealth: 1 }, inventory: {}, reputation: {}, q: 0, r: 0, ...extra };
    const world = { day: 10, generationParams: { seed: 's' }, getTile: () => null };
    return { player, world, notes, ui: { showNotification: (t, b, k) => notes.push({ t, b, k }), updateStats() {}, hideCustomPanel() {}, showCustomPanel() {} } };
}

describe('the bestiary', () => {
    /** Beasts on an open map, the player at `me`. */
    function beastsAt(members, me = { q: 64, r: 64 }, tiles = openTiles()) {
        openMap(tiles, me);
        InnerMap.timeOfDay = 12;
        InnerMap.animals = members.map((m, i) => InnerMap._makeAnimal({ id: `b:${i}`, herd: m.herd || `h${i}`, homeQ: m.q, homeR: m.r, ...m }, cfg()));
        InnerMap._animalRng = null;
        InnerMapAnimals._fight = null;
        return InnerMap.animals;
    }
    const tick = (secs, o = {}) => {
        const evs = [];
        for (let t = 0; t < secs; t += 0.05) evs.push(...InnerMap.updateAnimals(0.05, o));
        return evs;
    };

    it('every species has walk, attack and death sheets on disk, sharing one cell and anchor, and loot that resolves', () => {
        const c = cfg();
        const tables = DataLoader.get('earlyJobs').hunting.loot_table;
        const tempers = new Set(['skittish', 'defensive', 'territorial', 'hunter']);
        for (const id of SPECIES) {
            const sp = c.species[id];
            expect(sp, id).toBeTruthy();
            expect(tempers.has(sp.temper), id).toBe(true);
            for (const act of ['walk', 'attack', 'death']) {
                const path = sp.sheets[act];
                expect(fs.existsSync(path), path).toBe(true);
                const buf = fs.readFileSync(path);
                expect(buf.readUInt32BE(16)).toBe(4 * sp.frameW);
                expect(buf.readUInt32BE(20)).toBe(4 * sp.frameH);
            }
            expect(sp.sheet).toBe(sp.sheets.walk);
            expect(sp.hp).toBeGreaterThan(0);
            expect(sp.bite[1]).toBeGreaterThanOrEqual(sp.bite[0]);
            expect(sp.fleeSpeed).toBeGreaterThan(sp.walkSpeed);
            const loot = WildTasks.animalLoot(sp, tables);
            expect(loot.length, id).toBe(sp.loot.length);
            for (const e of loot) {
                expect(e.item, `${id} ${e.name}`).toBeTruthy();
                expect(e.sellPrice).toBeGreaterThan(0);
            }
        }
        // sizes run from the rabbit to the elephant
        const len = (id) => c.species[id].drawTiles * (c.species[id].scale || 1);
        expect(len('rabbit')).toBeLessThan(len('fox'));
        expect(len('fox')).toBeLessThan(len('wolf'));
        expect(len('wolf')).toBeLessThan(len('bear'));
        expect(len('bear')).toBeLessThan(len('elephant'));
        // the elephant gives ivory, the sheep its fleece, the bear its pelt
        expect(WildTasks.animalLoot(c.species.elephant, tables).map(e => e.item)).toContain('ivory');
        expect(WildTasks.animalLoot(c.species.sheep, tables).map(e => e.item)).toContain('wool');
        expect(WildTasks.animalLoot(c.species.bear, tables).map(e => e.item)).toContain('bear_pelt');
    });

    it('live where they belong: snow beasts in the cold, lions and elephants where it is hot, panthers in the jungle, goats on the heights', () => {
        const tundra = speciesIn('tundra');
        for (const sp of ['reindeer', 'arctic_fox', 'snow_rabbit']) expect(tundra.has(sp), sp).toBe(true);
        for (const sp of ['lion', 'elephant', 'panther', 'sheep']) expect(tundra.has(sp), sp).toBe(false);
        const savanna = speciesIn('savanna');
        expect(savanna.has('lion')).toBe(true);
        expect(savanna.has('elephant')).toBe(true);
        expect(savanna.has('polar_bear')).toBe(false);
        expect(speciesIn('tropical_rainforest').has('panther')).toBe(true);
        expect(speciesIn('mountain').has('mountain_goat')).toBe(true);
        expect(speciesIn('hills').has('mountain_goat')).toBe(true);
        expect(speciesIn('ice').has('polar_bear')).toBe(true);
        expect(speciesIn('boreal_forest').has('wolf')).toBe(true);
        expect(speciesIn('woodland', {}, 120).has('bear')).toBe(true);
        // grassland: lions only where it is hot
        expect(speciesIn('grassland', { temperature: 0.4 }, 120).has('lion')).toBe(false);
        expect(speciesIn('grassland', { temperature: 0.8 }, 120).has('lion')).toBe(true);
        // the beasts of an encounter come with it: a wolf encounter brings its pack
        const plan = InnerMap.planHerds(openTiles(), 'desert', 3, 3, 'x', { encounters: [{ id: 'wolf', slot: 1, q: 40, r: 40 }] });
        expect(plan.length).toBeGreaterThanOrEqual(2);
        for (const a of plan) {
            expect(a.species).toBe('wolf');
            expect(a.herd).toBe('3,3:enc1');
            expect(Math.max(Math.abs(a.q - 40), Math.abs(a.r - 40))).toBeLessThanOrEqual(cfg().herds.wolves.spread);
        }
    });

    it('livestock: a village\'s flocks graze its pastures (none in the wild), owned — and killing one is theft', () => {
        expect(speciesIn('grassland').has('sheep')).toBe(false);
        const town = () => openTiles(128, 128, (t, q, r) => {
            if (q >= 44 && q <= 84 && r >= 44 && r <= 84) {
                if ((q + r) % 6 === 0) t.isRoad = true;
                else if (q % 9 === 0 && r % 9 === 0) { t.building = { type: 'house' }; t.subTerrain.passable = false; }
                else t._lot = true;
            }
        });
        let flocks = 0;
        const [lo, hi] = cfg().livestock.nearBuilt;
        for (let i = 0; i < 30; i++) {
            const plan = InnerMap.planHerds(town(), 'grassland', i, 2, 'v', { settlementType: 'village' });
            const sheep = plan.filter(a => a.livestock);
            if (sheep.length) flocks++;
            for (const a of sheep) {
                const d = Math.max(0, 44 - a.homeQ, a.homeQ - 84, 44 - a.homeR, a.homeR - 84);
                expect(d).toBeGreaterThanOrEqual(lo);
                expect(d).toBeLessThanOrEqual(hi + 1);
            }
            // no wolves, bears, lions or elephants in a village's hex
            expect(plan.some(a => ['wolf', 'bear', 'lion', 'elephant'].includes(a.species))).toBe(false);
        }
        expect(flocks).toBeGreaterThan(5);
        // on the map: owned by the village
        openMap(town());
        let flock = null;
        for (let i = 0; i < 30 && !flock; i++) {
            const world = { day: 1, season: 'Summer', generationParams: { seed: 'v' }, getTile: () => null };
            InnerMap._spawnAnimals({ world }, { terrain: { id: 'grassland' }, settlement: { type: 'village', name: 'Oakby', kingdom: 2 } }, i, 2);
            flock = InnerMap.animals.find(a => a.livestock);
        }
        expect(flock.owner).toEqual({ name: 'Oakby', kingdom: 2 });
        // killed unseen: no fine; seen by a villager: a fine and lost standing
        const g = stubGame();
        InnerMap.npcs = [];
        expect(InnerMapAnimals.livestockTheft(g, flock).seen).toBe(false);
        expect(g.player.gold).toBe(100);
        InnerMap.npcs = [{ id: 'n', q: flock.q + 3, r: flock.r, state: 'idle' }];
        const seen = InnerMapAnimals.livestockTheft(g, flock);
        expect(seen.seen).toBe(true);
        expect(seen.fine).toBeGreaterThan(0);
        expect(g.player.gold).toBe(100 - seen.fine);
        expect(g.player.reputation[2]).toBeLessThan(0);
        // the menu calls it what it is, and offers no hunt
        const items = InnerMapAnimals.menuItems(g, flock.q, flock.r).filter(i => i.animal === flock);
        expect(items.some(i => i.action === 'hunt_animal')).toBe(false);
        expect(items.find(i => i.action === 'animal_fight').label).toMatch(/^Slaughter/);
    });

    it('a wolf pack that means it stalks, charges and bites — the bite comes off the player\'s health', () => {
        const me = { q: 64, r: 64 };
        const pack = beastsAt([{ species: 'wolf', q: 70, r: 64, herd: 'p' }, { species: 'wolf', q: 71, r: 66, herd: 'p' }, { species: 'wolf', q: 72, r: 62, herd: 'p' }], me);
        for (const w of pack) w.aggro = true; // the pack has decided
        const evs = tick(0.1, { walking: true });
        expect(evs.some(e => e.type === 'stalk')).toBe(true);
        expect(pack.every(w => ['stalk', 'charge', 'attack'].includes(w.state))).toBe(true);
        const later = tick(8, { walking: false });
        expect(later.some(e => e.type === 'charge')).toBe(true);
        const bites = later.filter(e => e.type === 'bite');
        expect(bites.length).toBeGreaterThan(0);
        for (const b of bites) {
            expect(b.dmg).toBeGreaterThanOrEqual(cfg().species.wolf.bite[0]);
            expect(b.dmg).toBeLessThanOrEqual(cfg().species.wolf.bite[1]);
        }
        // never more on you at once than the cap, and never on your tile
        expect(InnerMap._attackers()).toBeLessThanOrEqual(cfg().behaviour.maxAttackers);
        for (const w of pack) expect(w.q === me.q && w.r === me.r).toBe(false);
        // through the UI layer the bite lands on the player
        const g = stubGame();
        const before = g.player.health;
        for (let t = 0; t < 4 && g.player.health === before; t += 0.05) InnerMapAnimals.update(0.05, g);
        expect(g.player.health).toBeLessThan(before);
        // bitten standing about, the player turns on it
        expect(InnerMapAnimals._fight && InnerMapAnimals._fight.a.species).toBe('wolf');
    });

    it('a pack that does not mean it only watches; and none attacks one who is down', () => {
        const wolves = beastsAt([{ species: 'wolf', q: 70, r: 64, herd: 'p' }, { species: 'wolf', q: 71, r: 66, herd: 'p' }]);
        for (const w of wolves) w.aggro = false;
        const evs = tick(3, { walking: true });
        expect(evs.some(e => e.type === 'bite' || e.type === 'stalk')).toBe(false);
        const [w] = beastsAt([{ species: 'wolf', q: 65, r: 64 }]);
        w.aggro = true;
        w.state = 'attack';
        expect(tick(3, { noTarget: true }).some(e => e.type === 'bite')).toBe(false);
        expect(['stalk', 'charge', 'attack'].includes(w.state)).toBe(false);
    });

    it('a bear warns you off, charges if you stay, and backs off after its bout', () => {
        const [bear] = beastsAt([{ species: 'bear', q: 69, r: 64 }]);
        let evs = tick(0.1, { walking: true });
        expect(evs.some(e => e.type === 'threat')).toBe(true);
        expect(bear.state).toBe('threat');
        evs = tick(cfg().behaviour.threatSeconds + 1, { walking: false });
        expect(evs.some(e => e.type === 'charge')).toBe(true);
        evs = tick(12, { walking: false });
        const bites = evs.filter(e => e.type === 'bite').length;
        expect(bites).toBeGreaterThan(0);
        expect(bites).toBeLessThanOrEqual(cfg().species.bear.maxBites);
        expect(evs.some(e => e.type === 'backsOff')).toBe(true);
        expect(bear.cool).toBeGreaterThan(0);
        // the deer are no danger: a doe only runs
        const [doe] = beastsAt([{ species: 'doe', q: 67, r: 64 }]);
        expect(tick(3, { walking: true }).some(e => e.type === 'bite' || e.type === 'threat')).toBe(false);
        expect(doe.state === 'flee' || doe.state === 'alert').toBe(true);
    });

    it('struck, a fighter turns on you and one beaten low runs; an elephant charges when hurt', () => {
        const me = { q: 64, r: 64 };
        const world = { day: 3 };
        const [bear] = beastsAt([{ species: 'bear', q: 66, r: 64 }], me);
        expect(InnerMap.hurtAnimal(world, bear, 10, me).killed).toBe(false);
        expect(bear.state).toBe('charge');
        InnerMap.hurtAnimal(world, bear, bear.hp - 5, me);
        expect(bear.state).toBe('flee');
        const [ele] = beastsAt([{ species: 'elephant', q: 66, r: 64 }], me);
        tick(0.2, { walking: true });
        expect(ele.state).toBe('alert'); // it watches you, mostly peaceful
        InnerMap.hurtAnimal(world, ele, 20, me);
        expect(ele.state).toBe('charge');
        // a rabbit only ever runs
        const [rab] = beastsAt([{ species: 'rabbit', q: 66, r: 64 }], me);
        InnerMap.hurtAnimal(world, rab, 2, me);
        expect(rab.state).toBe('flee');
        // a wolf struck brings its pack down on you
        const pack = beastsAt([{ species: 'wolf', q: 66, r: 64, herd: 'p' }, { species: 'wolf', q: 69, r: 66, herd: 'p' }], me);
        InnerMap.hurtAnimal(world, pack[0], 5, me);
        expect(pack.every(w => w.state === 'charge')).toBe(true);
    });

    it('killed: the death plays and a carcass lies to butcher; butchered it soon goes; the kill is culled from its hex', () => {
        const me = { q: 64, r: 64 };
        const world = { day: 5 };
        const [wolf] = beastsAt([{ species: 'wolf', q: 65, r: 64, id: '5,7:wolves0:wolf0' }], me);
        const res = InnerMap.hurtAnimal(world, wolf, 999, me);
        expect(res.killed).toBe(true);
        expect(wolf.state).toBe('dead');
        expect(world.wildlife.culled['5,7'].map(c => c.id)).toEqual(['5,7:wolves0:wolf0']);
        // the death sheet, played once and held on its last frame
        const sp = cfg().species.wolf;
        expect(InnerMapAnimals.frame(wolf, sp).sheet).toBe(sp.sheets.death);
        tick(5);
        expect(InnerMap.animals).toContain(wolf);
        expect(InnerMapAnimals.frame(wolf, sp).col).toBe(3);
        // the menu offers to butcher it, and not to hunt it
        const g = stubGame();
        const items = InnerMapAnimals.menuItems(g, wolf.q, wolf.r);
        expect(items.find(i => i.action === 'animal_butcher')).toBeTruthy();
        expect(items.find(i => i.action === 'hunt_animal' && i.animal === wolf)).toBeFalsy();
        // it lies there: no clock takes it away while you are on the map
        tick(1000);
        expect(InnerMap.animals).toContain(wolf);
        expect(world.wildlife.carcasses['5,7'].map(c => c.animal)).toEqual(['5,7:wolves0:wolf0']);
        // butchered (fresh, the same day): the pelt in the packs, and it is off the books
        g.world = world;
        const trip = InnerMapAnimals._butcherNow(g, wolf);
        expect(trip.kept.length).toBeGreaterThan(0);
        expect(g.player.inventory.pelts).toBeGreaterThan(0);
        expect(world.wildlife.carcasses['5,7']).toBeUndefined();
        expect(InnerMapAnimals._butcherNow(g, wolf)).toBe(null); // once
        tick(cfg().behaviour.butcheredSeconds + 1);
        expect(InnerMap.animals).not.toContain(wolf);
        // the next visit's plan leaves it out
        const plan = InnerMap.planHerds(openTiles(), 'boreal_forest', 5, 7, 's', { culled: InnerMap.culledAnimals(world, 5, 7) });
        expect(plan.map(a => a.id)).not.toContain('5,7:wolves0:wolf0');
    });

    it('fought hand to hand: the player closes and swings until it falls', () => {
        const g = stubGame();
        const [fox] = beastsAt([{ species: 'fox', q: 65, r: 64 }]);
        fox.hp = 1;
        InnerMapAnimals.startFight(g, fox);
        for (let t = 0; t < 2 && fox.state !== 'dead'; t += 0.05) InnerMapAnimals.update(0.05, g);
        expect(fox.state).toBe('dead');
        expect(InnerMapAnimals._fight).toBe(null);
        expect(g.notes.some(n => /Killed/.test(n.t))).toBe(true);
    });

    it('hunting maps onto the species, and a missed bear turns on the hunter', () => {
        const c = cfg();
        for (const [beast, id] of Object.entries(c.huntBeasts)) expect(c.species[id], beast).toBeTruthy();
        // the hunt's beasts with a sprite are drawn as themselves
        const names = Object.values(WildTasks.cfg('hunt').beasts);
        for (const n of Object.keys(c.huntBeasts)) expect(names, n).toContain(n);
        // "Hunt the X" for every huntable beast; "Fight" for all
        const g = stubGame();
        for (const id of SPECIES) {
            const [a] = beastsAt([{ species: id, q: 70, r: 70 }]);
            const items = InnerMapAnimals.menuItems(g, 70, 70);
            const hunt = items.find(i => i.action === 'hunt_animal');
            if (c.species[id].huntable === false) expect(hunt, id).toBeFalsy();
            else expect(hunt && hunt.animal, id).toBe(a);
            expect(items.find(i => i.action === 'animal_fight'), id).toBeTruthy();
        }
        // a miss: the bear comes for you; the doe runs
        const me = { q: 64, r: 64 };
        const [bear] = beastsAt([{ species: 'bear', q: 68, r: 64 }], me);
        bear.hunted = true;
        InnerMap.releaseAnimal(bear, me, { provoked: 'shot' });
        expect(bear.state).toBe('charge');
        const [doe] = beastsAt([{ species: 'doe', q: 68, r: 64 }], me);
        doe.hunted = true;
        InnerMap.releaseAnimal(doe, me, { provoked: 'near' });
        expect(doe.state).toBe('flee');
    });

    it('mauled to nothing, the player blacks out and comes round, the beasts gone off', () => {
        const g = stubGame({ health: 4 });
        const spy = vi.spyOn(InnerMapCombat, '_blackout').mockImplementation((game, ms, then) => then());
        const [bear] = beastsAt([{ species: 'bear', q: 65, r: 64 }]);
        bear.state = 'attack';
        InnerMapAnimals._bite(g, bear, cfg().species.bear, 30);
        expect(g.player.health).toBeGreaterThan(0);
        expect(InnerMapCombat._playerOut).toBe(false);
        expect(['stalk', 'charge', 'attack'].includes(bear.state)).toBe(false);
        expect(bear.cool).toBeGreaterThan(0);
        expect(g.notes.some(n => /Come Round/.test(n.t))).toBe(true);
        spy.mockRestore();
    });

    it('none inside a building, and none at sea', () => {
        const [w] = beastsAt([{ species: 'wolf', q: 65, r: 64 }]);
        w.aggro = true;
        InnerMap._insideBuilding = { name: 'Inn' };
        expect(tick(2, { walking: true })).toEqual([]);
        InnerMap._insideBuilding = null;
        for (const t of ['ocean', 'deep_ocean', 'sea', 'coast']) expect(speciesIn(t, {}, 20).size, t).toBe(0);
    });
});

// ── Carcasses: they lie where they fell, are carried, and butchered by hand ──

describe('carcasses', () => {
    let ActionMenu, InnerMapDigging;
    beforeAll(async () => {
        ({ ActionMenu } = await import('../ui/actionMenu.js'));
        ({ InnerMapDigging } = await import('../ui/innerMapDigging.js'));
    });
    afterEach(() => {
        if (InnerMapAnimals._carry) InnerMapAnimals.drop(null, { quiet: true });
        InnerMapDigging.cancel();
    });

    /** A game on an open map with one beast of `species` at `at`, the player at `me`. */
    function scene(species, at = { q: 65, r: 64 }, me = { q: 64, r: 64 }, extra = {}) {
        const g = stubGame(extra);
        g.world.day = 20;
        openMap(openTiles(), me);
        InnerMap.timeOfDay = 9;
        InnerMap._timeAccumulator = 0;
        InnerMap._playerSpeed = 4;
        InnerMap.animals = [InnerMap._makeAnimal({ id: `5,7:h0:${species}0`, species, q: at.q, r: at.r }, cfg())];
        InnerMap._animalRng = null;
        InnerMapAnimals._fight = null;
        InnerMapAnimals.update(0.01, g); // (a new map: the visit's state is reset)
        return { g, a: InnerMap.animals[0] };
    }
    const kill = (g, a) => InnerMap.hurtAnimal(g.world, a, 9999, { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR });

    it('a hunt\'s kill falls and lies unbutchered: nothing in the packs until you butcher it', async () => {
        const { g, a } = scene('doe', { q: 66, r: 64 });
        g.player.skills.combat = 10;
        g.player.strength = 30; // every shot lands
        g.world.getTile = () => ({ terrain: { id: 'woodland' } });
        ActionMenu.huntAnimal(g, a);
        for (let i = 0; i < 20 && !InnerMapTasks.active; i++) await new Promise(res => setTimeout(res, 0));
        const ctx = InnerMapTasks.active;
        expect(ctx && ctx.animal).toBe(a);
        InnerMap.playerInnerQ = a.q - 2; InnerMap.playerInnerR = a.r;
        InnerMapTasks.update(0.1, g);
        ctx.tpl.buttons(ctx).find(b => b.label === WildTasks.cfg('hunt').shoot).act();
        for (let i = 0; i < 20 && a.state !== 'dead'; i++) await new Promise(res => setTimeout(res, 0));
        expect(a.state).toBe('dead');
        expect(a.butchered).toBe(false);
        expect(Object.values(g.player.inventory).reduce((s, n) => s + n, 0)).toBe(0);
        expect(g.notes.some(n => /Clean Kill/.test(n.t))).toBe(true);
        // culled from the herd, and kept on the books where it lies
        expect(g.world.wildlife.culled['5,7'].map(c => c.id)).toEqual([a.id]);
        expect(g.world.wildlife.carcasses['5,7']).toEqual([expect.objectContaining({ animal: a.id, species: 'doe', q: a.q, r: a.r, day: 20 })]);
    });

    it('every kill leaves one: a fight, and a village beast slaughtered', () => {
        const { g, a } = scene('fox');
        a.hp = 1;
        InnerMapAnimals.startFight(g, a);
        for (let t = 0; t < 2 && a.state !== 'dead'; t += 0.05) InnerMapAnimals.update(0.05, g);
        expect(a.state).toBe('dead');
        expect(a.butchered).toBe(false);
        expect(g.world.wildlife.carcasses['5,7'].length).toBe(1);
        const s = scene('sheep');
        s.a.livestock = true;
        s.a.owner = { name: 'Ashby', kingdom: null };
        kill(s.g, s.a);
        expect(s.a.butchered).toBe(false);
        expect(s.g.world.wildlife.carcasses['5,7'][0]).toEqual(expect.objectContaining({ species: 'sheep', livestock: true, owner: { name: 'Ashby', kingdom: null } }));
    });

    it('persists: it lies there all visit, and is there again (dead, where you left it) on the next', () => {
        const { g, a } = scene('stag', { q: 70, r: 66 });
        kill(g, a);
        for (let t = 0; t < 3000; t += 1) InnerMap.updateAnimals(1);
        expect(InnerMap.animals).toContain(a);
        // leave and come back another day: the hex's beasts are planned again, the carcass with them
        g.world.day += 2;
        openMap(openTiles(), { q: 64, r: 64 });
        InnerMap._spawnAnimals(g, { terrain: { id: 'woodland' } }, 5, 7);
        const back = InnerMap.animals.filter(x => x.state === 'dead');
        expect(back.length).toBe(1);
        expect(back[0]).toEqual(expect.objectContaining({ species: 'stag', q: 70, r: 66, butchered: false, carcassId: a.carcassId }));
        // and its living self is not grazing there too
        expect(InnerMap.animals.filter(x => x.id === a.id && x.state !== 'dead')).toEqual([]);
        // it travels with the save
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializeWorld({ ...stubWorld(), wildlife: g.world.wildlife })));
        expect(saved.wildlife.carcasses['5,7'][0].species).toBe('stag');
        // the scavengers have it in the end
        g.world.day += cfg().carcass.lifetimeDays;
        InnerMap._spawnAnimals(g, { terrain: { id: 'woodland' } }, 5, 7);
        expect(InnerMap.animals.some(x => x.state === 'dead')).toBe(false);
        expect(g.world.wildlife.carcasses['5,7']).toBeUndefined();
    });

    it('rots by the day: fresh at first, then less worth taking, never below the floor', () => {
        const C = cfg().carcass;
        const { g, a } = scene('elk');
        kill(g, a);
        expect(InnerMap.carcassYield(g.world, a)).toBe(1);
        g.world.day += C.freshDays;
        expect(InnerMap.carcassYield(g.world, a)).toBe(1);
        g.world.day += 2;
        expect(InnerMap.carcassYield(g.world, a)).toBeCloseTo(1 - 2 * C.rotPerDay);
        g.world.day += 30;
        expect(InnerMap.carcassYield(g.world, a)).toBe(C.minYield);
        // the menu says so
        const head = InnerMapAnimals.menuItems(g, a.q, a.r).find(i => i.type === 'header');
        expect(head.label).toMatch(/rotting/);
        // and the butchering yields less: an elk gives 2-4 venison fresh
        let fresh = 0, rotten = 0;
        for (let i = 0; i < 20; i++) {
            const f = scene('elk', { q: 65, r: 64 }, { q: 64, r: 64 }, { inventory: {} });
            kill(f.g, f.a);
            const old = i % 2 === 1;
            if (old) f.g.world.day += 30;
            InnerMapAnimals._butcherNow(f.g, f.a);
            const meat = f.g.player.inventory.game_meat || 0;
            if (old) rotten += meat; else fresh += meat;
        }
        expect(rotten).toBeLessThan(fresh * 0.6);
    });

    it('carried: it goes where you go, you walk slower, and it lies where you put it down', () => {
        const { g, a } = scene('doe');
        kill(g, a);
        const items = InnerMapAnimals.menuItems(g, a.q, a.r);
        const carry = items.find(i => i.action === 'animal_carry');
        expect(carry && carry.animal).toBe(a);
        expect(InnerMapAnimals.handle(g, carry)).toBe(true);
        expect(InnerMapAnimals._carry && InnerMapAnimals._carry.a).toBe(a);
        expect(a.carried).toBe(true);
        const chk = InnerMap.canCarryAnimal(a, g.player.strength);
        expect(chk.speed).toBeLessThan(1);
        expect(InnerMap._playerSpeed).toBeCloseTo(4 * chk.speed);
        // walk on: it comes with you, and the books keep up
        InnerMap.playerInnerQ = 80; InnerMap.playerInnerR = 72;
        InnerMapAnimals.update(0.05, g);
        expect([a.q, a.r]).toEqual([80, 72]);
        expect(g.world.wildlife.carcasses['5,7'][0]).toEqual(expect.objectContaining({ q: 80, r: 72 }));
        // the menu anywhere offers to put it down (and no second carry)
        const m = InnerMapAnimals.menuItems(g, 10, 10);
        expect(m.find(i => i.action === 'animal_drop')).toBeTruthy();
        expect(m.find(i => i.action === 'animal_carry')).toBeFalsy();
        InnerMapAnimals.handle(g, m.find(i => i.action === 'animal_drop'));
        expect(InnerMapAnimals._carry).toBe(null);
        expect(a.carried).toBe(false);
        expect(InnerMap._playerSpeed).toBe(4);
        InnerMap.playerInnerQ = 60;
        InnerMapAnimals.update(0.05, g);
        expect([a.q, a.r]).toEqual([80, 72]);
        // a rabbit hardly slows you and rides on your shoulders; a stag is dragged
        expect(InnerMap.canCarryAnimal({ species: 'rabbit', state: 'dead' }).how).toBe('shoulder');
        expect(InnerMap.canCarryAnimal({ species: 'rabbit', state: 'dead' }).speed).toBeGreaterThan(0.95);
        expect(InnerMap.canCarryAnimal({ species: 'stag', state: 'dead' }).how).toBe('drag');
    });

    it('carried off the map, it is left at the edge where you crossed, and lies there next time', () => {
        const { g, a } = scene('doe');
        kill(g, a);
        InnerMapAnimals.pickUp(g, a);
        InnerMap.playerInnerQ = 127; InnerMap.playerInnerR = 40;
        InnerMapAnimals.update(0.05, g);
        // over the edge: another map
        openMap(openTiles(), { q: 0, r: 40 });
        InnerMap.currentWorldTile = { q: 6, r: 7 };
        InnerMapAnimals.update(0.05, g);
        expect(InnerMapAnimals._carry).toBe(null);
        expect(InnerMap._playerSpeed).toBe(4);
        expect(g.notes.some(n => /Left behind/.test(n.t))).toBe(true);
        expect(g.world.wildlife.carcasses['5,7'][0]).toEqual(expect.objectContaining({ q: 127, r: 40 }));
    });

    it('too heavy to carry: an elephant (and a bear, for most), said so in a greyed-out entry', () => {
        const { g, a } = scene('elephant');
        kill(g, a);
        const items = InnerMapAnimals.menuItems(g, a.q, a.r);
        expect(items.find(i => i.action === 'animal_carry')).toBeFalsy();
        const no = items.find(i => i.type === 'disabled' && /Carry the elephant/.test(i.label));
        expect(no && no.label).toMatch(/too heavy \(4000 kg\)/);
        expect(items.find(i => i.action === 'animal_butcher')).toBeTruthy();
        InnerMapAnimals.handle(g, { action: 'animal_carry', animal: a });
        expect(InnerMapAnimals._carry).toBe(null);
        expect(InnerMap.canCarryAnimal({ species: 'bear', state: 'dead' }, 5).ok).toBe(false);
        expect(InnerMap.canCarryAnimal({ species: 'bear', state: 'dead' }, 10).ok).toBe(true);
        expect(InnerMap.canCarryAnimal({ species: 'highland_cow', state: 'dead' }, 10).ok).toBe(false);
        // and a body in your arms: your hands are full
        const d = scene('doe');
        kill(d.g, d.a);
        InnerMapCombat._carrying = { name: 'X' };
        try {
            expect(InnerMapAnimals.canCarry(d.g, d.a)).toEqual(expect.objectContaining({ ok: false, reason: 'hands full' }));
        } finally { InnerMapCombat._carrying = null; }
    });

    it('butchered by hand: work at the spot and time on the clock, then the loot, and it is gone', () => {
        const { g, a } = scene('doe');
        kill(g, a);
        const time = InnerMap.butcherTime(a);
        expect(time.minutes).toBeGreaterThan(0);
        // carried, "Butcher" puts it down first
        InnerMapAnimals.pickUp(g, a);
        const item = InnerMapAnimals.menuItems(g, 30, 30).find(i => i.action === 'animal_butcher');
        expect(item && item.animal).toBe(a);
        expect(InnerMapAnimals.butcher(g, a)).toBe('now');
        expect(InnerMapAnimals._carry).toBe(null);
        expect(InnerMapDigging.isWorking()).toBe(true);
        // not done at once
        InnerMapDigging.update(0.1, g);
        expect(a.butchered).toBe(false);
        expect(g.player.inventory.game_meat || 0).toBe(0);
        for (let t = 0; t < time.seconds + 1; t += 0.1) InnerMapDigging.update(0.1, g);
        expect(a.butchered).toBe(true);
        expect(g.player.inventory.game_meat).toBeGreaterThan(0);
        expect(g.notes.some(n => /Butchered/.test(n.t))).toBe(true);
        // the clock moved on by the work
        expect(InnerMap.timeOfDay * 60 + InnerMap._timeAccumulator / (InnerMap.TIME_SCALE || 60) * 60).toBeCloseTo(9 * 60 + time.minutes, 0);
        // off the books, and soon off the map
        expect(g.world.wildlife.carcasses['5,7']).toBeUndefined();
        for (let t = 0; t < cfg().behaviour.butcheredSeconds + 1; t += 0.5) InnerMap.updateAnimals(0.5);
        expect(InnerMap.animals).not.toContain(a);
        // walking off stops the work
        const s = scene('doe');
        kill(s.g, s.a);
        InnerMapAnimals.butcher(s.g, s.a);
        InnerMap.playerInnerQ += 3;
        for (let t = 0; t < 12; t += 0.1) InnerMapDigging.update(0.1, s.g);
        expect(s.a.butchered).toBe(false);
    });
});

function stubWorld() {
    return { width: 1, height: 1, day: 1, season: 'Spring', year: 1, tiles: [], kingdoms: [], events: [], units: [] };
}

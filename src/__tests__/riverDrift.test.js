/**
 * Things thrown in a river and carried down it: the street map's river knows
 * which way its water runs in every cell (world/innerMap/water.js t._flow);
 * a thing thrown in drifts downstream on the map (ui/innerMapRiverDrift.js),
 * and off it the world carries it hex by hex along the river until the sea
 * (systems/riverDrift.js); a weir — a built timber dam or a town's mill —
 * catches it; a save keeps what is adrift.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Hex, RiverDrift, InnerMapRiverDrift, Infrastructure;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    ({ Hex } = await import('../core/hex.js'));
    ({ RiverDrift } = await import('../systems/riverDrift.js'));
    ({ InnerMapRiverDrift } = await import('../ui/innerMapRiverDrift.js'));
    ({ Infrastructure } = await import('../systems/infrastructure.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

const innerMapData = () => DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8'));

beforeEach(() => {
    InnerMap.initialize(innerMapData());
    InnerMap._cache = {};
    InnerMap.season = 'summer';
    InnerMap.active = false;
    InnerMap._insideBuilding = null;
    InnerMap.timeOfDay = 10;
    InnerMap._timeAccumulator = 0;
    InnerMapRiverDrift._live.clear();
    InnerMapRiverDrift._liveTiles = null;
    InnerMapRiverDrift._lastNow = null;
    InnerMapRiverDrift._shown = [];
    InnerMapRiverDrift._fading = [];
    Utils.setSeed(7);
});

const HQ = 20, HR = 20;
const nb = (q, r, d) => Hex.neighbors(q, r)[d];

/**
 * A mock world: land everywhere unless `terrainAt` says otherwise; `rivers`
 * maps 'q,r' → riverDir; `extra` (by 'q,r') is laid on those hexes.
 */
function makeWorld({ terrainAt = () => null, rivers = {}, extra = {}, gen = 3 } = {}) {
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) {
            const id = terrainAt(q, r) || 'grassland';
            const t = { q, r, terrain: { id, passable: !['ocean', 'lake'].includes(id) }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
            if (rivers[k] !== undefined) { t.hasRiver = true; t.riverDir = rivers[k]; }
            if (extra[k]) Object.assign(t, extra[k]);
            tiles.set(k, t);
        }
        return tiles.get(k);
    };
    return {
        day: 3, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: gen }, activeEvents: [], kingdoms: [],
        getTile: (q, r) => at(q, r),
        getSettlementViews: () => [],
        getKingdom: () => null,
    };
}

/** A river running west: (HQ, HR) → two more hexes west → the sea */
function westToSea(opts = {}) {
    const e = nb(HQ, HR, 0), w1 = nb(HQ, HR, 3), w2 = nb(w1.q, w1.r, 3), sea = nb(w2.q, w2.r, 3);
    const world = makeWorld({
        ...opts,
        terrainAt: (q, r) => (q === sea.q && r === sea.r ? 'ocean' : null),
        rivers: { [`${e.q},${e.r}`]: 3, [`${HQ},${HR}`]: 3, [`${w1.q},${w1.r}`]: 3, [`${w2.q},${w2.r}`]: 3 },
    });
    return { world, e, w1, w2, sea };
}

const cells = (tiles, pred) => { const out = []; tiles.forEach((row, r) => row.forEach((t, q) => { if (pred(t, q, r)) out.push({ q, r, t }); })); return out; };

function gameOn(world) {
    const notes = [];
    const game = {
        world,
        player: { inventory: { bread: 3, stone: 2 }, ships: [] },
        ui: { showNotification: (t, x) => notes.push(`${t}: ${x}`), updateStats() {}, showCustomPanel() {}, hideCustomPanel() {} },
        notes,
    };
    return game;
}

function enterMap(game, q = HQ, r = HR) {
    const tiles = InnerMap.generate(game.world.getTile(q, r), q, r, game);
    InnerMap.tiles = tiles;
    InnerMap.width = tiles[0].length;
    InnerMap.height = tiles.length;
    InnerMap.currentWorldTile = { q, r };
    InnerMap.active = true;
    return tiles;
}

describe('the river runs: every cell knows which way', () => {
    it('cells of a westward river flow west, along its run, toward its foot', () => {
        const { world } = westToSea();
        const tiles = InnerMap.generate(world.getTile(HQ, HR), HQ, HR, { world, player: { ships: [] } });
        const flowing = cells(tiles, t => t._flow && t._wet);
        expect(flowing.length).toBeGreaterThan(300);
        const main = flowing.filter(c => c.t._flow.run === 0);
        // unit vectors, overwhelmingly westward
        for (const c of main) expect(Math.hypot(c.t._flow.x, c.t._flow.y)).toBeCloseTo(1, 1);
        expect(main.filter(c => c.t._flow.x < 0).length / main.length).toBeGreaterThan(0.85);
        // ...and down the run: the further down (k), the further west
        const east = main.filter(c => c.t._flow.k < 20), west = main.filter(c => c.t._flow.k > c.t._flow.n - 20);
        const mean = (a) => a.reduce((s, c) => s + c.q, 0) / a.length;
        expect(mean(east)).toBeGreaterThan(mean(west) + 60);
        // pools and the sea have none; nor dry land
        expect(cells(tiles, t => t._flow && !t._wet && !t.isRoad).length).toBeLessThan(main.length * 0.05);
    });

    it('a tributary runs toward where it joins the main stream', () => {
        const e = nb(HQ, HR, 0), ne = nb(HQ, HR, 1);
        const world = makeWorld({ rivers: { [`${e.q},${e.r}`]: 3, [`${ne.q},${ne.r}`]: 4, [`${HQ},${HR}`]: 3 } });
        const tiles = InnerMap.generate(world.getTile(HQ, HR), HQ, HR, { world, player: { ships: [] } });
        const trib = cells(tiles, t => t._flow && t._wet && t._flow.run === 1);
        expect(trib.length).toBeGreaterThan(20);
        const course = (() => { InnerMap.tiles = tiles; return InnerMapRiverDrift.course(tiles); })();
        const run = course.runs[1];
        const foot = run.pts[run.hi];
        // each cell's flow points (on the whole) toward the foot of its run
        let toward = 0;
        for (const c of trib) {
            const dx = foot[0] - c.q, dy = foot[1] - c.r;
            if (Math.hypot(dx, dy) < 3) { toward++; continue; }
            if (dx * c.t._flow.x + dy * c.t._flow.y > 0) toward++;
        }
        expect(toward / trib.length).toBeGreaterThan(0.85);
        expect(run.join).toBeGreaterThanOrEqual(course.runs[0].lo);
    });
});

// open water as painted (the bank's edge cells are wet but drawn as grass)
const _open = t => !!(t._wet && (t._ford || /water/.test((t.subTerrain && t.subTerrain.id) || '')));

describe('a thing thrown in drifts downstream on the map', () => {
    it('goes in from the packs, floats west, and leaves the map into the next hex', () => {
        const { world, w1 } = westToSea();
        const game = gameOn(world);
        const tiles = enterMap(game);
        // a river cell near the head of the main run, the player on the bank beside it
        const spot = cells(tiles, t => t._flow && t._flow.run === 0 && t._flow.k > 25 && t._flow.k < 35 && !t._bridge && _open(t))[0];
        InnerMap.playerInnerQ = spot.q;
        InnerMap.playerInnerR = spot.r + 3;
        expect(InnerMapRiverDrift.isRiverCell(spot.q, spot.r)).toBe(true);
        expect(InnerMapRiverDrift.throwItem(game, 'bread', spot.q, spot.r)).toBe(true);
        expect(game.player.inventory.bread).toBe(2);
        const st = RiverDrift.state(world);
        expect(st.items.length).toBe(1);
        const it = st.items[0];
        InnerMapRiverDrift.update(game, 0.01);
        const p0 = { ...InnerMapRiverDrift._shown[0] };
        const s0 = InnerMapRiverDrift._live.get(it.id).s;
        for (let i = 0; i < 20; i++) InnerMapRiverDrift.update(game, 0.5);
        const p1 = InnerMapRiverDrift._shown[0];
        // ten seconds on: well down its run (further from the head), the way the water runs
        expect(InnerMapRiverDrift._live.get(it.id).s).toBeGreaterThan(s0 + 5);
        expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeGreaterThan(5);
        const f = tiles[Math.round(p0.y)][Math.round(p0.x)]._flow || spot.t._flow;
        expect((p1.x - p0.x) * f.x + (p1.y - p0.y) * f.y).toBeGreaterThan(0);
        // held on the map while the player watches: the world doesn't move it on
        expect(it.q).toBe(HQ);
        // on down to the edge and off the map
        for (let i = 0; i < 600 && it.q === HQ; i++) InnerMapRiverDrift.update(game, 0.5);
        expect(it.q).toBe(w1.q);
        expect(it.r).toBe(w1.r);
        expect(it.state).toBe('drift');
        expect(it.inDir).toBe(0); // in by the east side
    });

    it('a stone sinks', () => {
        const { world } = westToSea();
        const game = gameOn(world);
        const tiles = enterMap(game);
        const spot = cells(tiles, t => t._flow && t._flow.run === 0 && !t._bridge && _open(t))[40];
        InnerMap.playerInnerQ = spot.q; InnerMap.playerInnerR = spot.r;
        expect(InnerMapRiverDrift.throwItem(game, 'stone', spot.q, spot.r)).toBe(true);
        expect(game.player.inventory.stone).toBe(1);
        expect(RiverDrift.state(world).items.length).toBe(0);
    });

    it('can be fished out from the bank as it passes', () => {
        const { world } = westToSea();
        const game = gameOn(world);
        const tiles = enterMap(game);
        const spot = cells(tiles, t => t._flow && t._flow.run === 0 && t._flow.k > 30 && !t._bridge && _open(t))[0];
        InnerMap.playerInnerQ = spot.q; InnerMap.playerInnerR = spot.r;
        InnerMapRiverDrift.throwItem(game, 'bread', spot.q, spot.r);
        InnerMapRiverDrift.update(game, 0.01);
        const s = InnerMapRiverDrift._shown[0];
        const items = InnerMapRiverDrift.menuItems(game, tiles[Math.round(s.y)][Math.round(s.x)], Math.round(s.x), Math.round(s.y));
        const take = items.find(i => i.action === 'drift_take');
        expect(take).toBeTruthy();
        InnerMapRiverDrift.handle(game, take, Math.round(s.x), Math.round(s.y));
        expect(game.player.inventory.bread).toBe(3);
        expect(RiverDrift.state(world).items.length).toBe(0);
    });
});

describe('the world carries it on, hex by hex', () => {
    it('along riverDir, then lost at the sea', () => {
        const { world, w1, w2 } = westToSea();
        const hph = RiverDrift.config().hoursPerHex;
        const t = 100;
        const { item } = RiverDrift.throwIn(world, HQ, HR, { itemId: 'bread', name: 'Bread' }, t, { frac: 0 });
        RiverDrift.advance(world, t + hph * 0.5);
        expect([item.q, item.r]).toEqual([HQ, HR]);
        RiverDrift.advance(world, t + hph * 1.2);
        expect([item.q, item.r]).toEqual([w1.q, w1.r]);
        RiverDrift.advance(world, t + hph * 2.2);
        expect([item.q, item.r]).toEqual([w2.q, w2.r]);
        const ev = RiverDrift.advance(world, t + hph * 3.5);
        expect(ev.map(e => e.type)).toEqual(['lost']);
        expect(RiverDrift.state(world).items.length).toBe(0);
    });

    it('into a lake it lies on the water a while, then sinks; where a river ends it rests in the pool', () => {
        const w1 = nb(HQ, HR, 3);
        const world = makeWorld({ terrainAt: (q, r) => (q === w1.q && r === w1.r ? 'lake' : null), rivers: { [`${HQ},${HR}`]: 3 } });
        const { item } = RiverDrift.throwIn(world, HQ, HR, { itemId: 'bread' }, 0, { frac: 0.5 });
        RiverDrift.advance(world, 5);
        expect(item.state).toBe('rest');
        expect(item.where).toBe('lake');
        expect([item.q, item.r]).toEqual([w1.q, w1.r]);
        RiverDrift.advance(world, 5 + RiverDrift.config().restDays.lake * 24);
        expect(RiverDrift.state(world).items.length).toBe(0);

        const end = makeWorld({ extra: { [`${HQ},${HR}`]: { hasRiver: true } } });
        const r2 = RiverDrift.throwIn(end, HQ, HR, { itemId: 'bread' }, 0, { frac: 0.5 });
        RiverDrift.advance(end, 50);
        expect(r2.item.state).toBe('rest');
        expect(r2.item.where).toBe('pool');
    });
});

describe('a weir catches it', () => {
    it('a built timber dam (finished) catches what comes down; a full one lets the rest over', () => {
        const { world, w1, w2 } = westToSea();
        world.getTile(w1.q, w1.r).infrastructure = { id: 'river_dam', name: 'Timber Dam', underConstruction: true };
        const hph = RiverDrift.config().hoursPerHex;
        const a = RiverDrift.throwIn(world, HQ, HR, { itemId: 'bread' }, 0, { frac: 0 }).item;
        RiverDrift.advance(world, hph * 1.8);
        expect(a.q).toBe(w1.q); // still building: no weir yet
        expect(a.state).toBe('drift');
        RiverDrift.take(world, a.id);
        world.getTile(w1.q, w1.r).infrastructure.underConstruction = false;
        const cap = RiverDrift.config().damCap;
        const many = [];
        for (let i = 0; i < cap + 1; i++) many.push(RiverDrift.throwIn(world, HQ, HR, { itemId: 'bread' }, 10, { frac: 0 }).item);
        RiverDrift.advance(world, 10 + hph * 1.9);
        expect(many.slice(0, cap).every(it => it.state === 'caught' && it.where === 'dam' && it.q === w1.q)).toBe(true);
        expect(RiverDrift.pileAt(world, w1.q, w1.r).length).toBe(cap);
        // the last spills over, on downstream
        expect(many[cap].state).toBe('drift');
        expect(many[cap].passed).toBe(true);
        RiverDrift.advance(world, 10 + hph * 2.2);
        expect([many[cap].q, many[cap].r]).toEqual([w2.q, w2.r]);
        expect(many[cap].state).toBe('drift');
        // taken off the weir
        expect(RiverDrift.take(world, many[0].id).id).toBe(many[0].id);
        expect(RiverDrift.pileAt(world, w1.q, w1.r).length).toBe(cap - 1);
    });

    it('a town\'s water mill on a river hex weirs it (worlds since millWeirGen)', () => {
        const old = westToSea();
        const w1 = old.w1;
        old.world.getTile(w1.q, w1.r).settlement = { name: 'Millby', type: 'town' };
        expect(RiverDrift.damAt(old.world, w1.q, w1.r)).toBe(null); // an old world: no mills on the water
        const { world } = westToSea({ gen: 5 });
        world.getTile(w1.q, w1.r).settlement = { name: 'Millby', type: 'town' };
        expect(RiverDrift.damAt(world, w1.q, w1.r).kind).toBe('mill');
        const { item } = RiverDrift.throwIn(world, HQ, HR, { itemId: 'bread' }, 0, { frac: 0 });
        RiverDrift.advance(world, 50);
        expect(item.state).toBe('caught');
        expect(item.where).toBe('mill');
    });

    it('on the street map the dam stands across the river and the thing fetches up against it', () => {
        const { world } = westToSea();
        world.getTile(HQ, HR).infrastructure = { id: 'river_dam', name: 'Timber Dam', underConstruction: false };
        const game = gameOn(world);
        const tiles = enterMap(game);
        const dam = InnerMapRiverDrift.damLine(world, tiles);
        expect(dam).toBeTruthy();
        expect(dam.b - dam.a).toBeGreaterThan(3); // across the channel
        const spot = cells(tiles, t => t._flow && t._flow.run === 0 && t._flow.k < dam.k - 15 && t._flow.k > dam.k - 25 && !t._bridge && _open(t))[0];
        InnerMap.playerInnerQ = spot.q; InnerMap.playerInnerR = spot.r;
        InnerMapRiverDrift.throwItem(game, 'bread', spot.q, spot.r);
        const it = RiverDrift.state(world).items[0];
        for (let i = 0; i < 200 && it.state === 'drift'; i++) InnerMapRiverDrift.update(game, 0.5);
        expect(it.state).toBe('caught');
        expect(it.q).toBe(HQ);
        const shown = InnerMapRiverDrift._shown.find(s => s.item.id === it.id);
        expect(shown.kind).toBe('caught');
        expect(Math.hypot(shown.x - dam.x, shown.y - dam.y)).toBeLessThan(5);
    });

    it('the dam is built on a river hex only', () => {
        const { world } = westToSea();
        const player = { gold: 5000 };
        const dry = world.getTile(HQ, HR + 6);
        expect(Infrastructure.canBuild(player, 'RIVER_DAM', dry, null).can).toBe(false);
        expect(Infrastructure.canBuild(player, 'RIVER_DAM', world.getTile(HQ, HR), null).can).toBe(true);
    });
});

describe('a save keeps what is adrift', () => {
    it('round-trips through the world save', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const { newGame, roundTrip } = await import('./playtest/harness.js');
            let game = newGame(4242);
            let river = null;
            for (const row of game.world.tiles) for (const t of row) if (!river && RiverDrift.isRiverHex(t)) river = t;
            expect(river).toBeTruthy();
            const { item } = RiverDrift.throwIn(game.world, river.q, river.r, { itemId: 'bread', name: 'Bread', icon: '🍞' }, 77, { frac: 0.3 });
            RiverDrift.catchAt(game.world, RiverDrift.throwIn(game.world, river.q, river.r, { itemId: 'wool' }, 77).item, { kind: 'dam' }, 78);
            const before = JSON.stringify(game.world.riverDrift);
            game = roundTrip(game);
            expect(JSON.stringify(game.world.riverDrift)).toBe(before);
            expect(RiverDrift.find(game.world, item.id).name).toBe('Bread');
            expect(RiverDrift.pileAt(game.world, river.q, river.r).length).toBe(1);
        } finally {
            logSpy.mockRestore();
        }
    }, 120000);
});

/**
 * Your horse in the water on the street map (player/horseSwim.js, ui/innerMapHorseSwim.js):
 * through a ford or the shallows at a careful walk with the rider's legs a
 * little wet; ridden into deep water it swims you over (slow, the current a
 * little weaker on it, you soaked), only so far before it flags and throws you;
 * blown, it rests before it will swim again; a foal, or water near freezing, it
 * refuses; led on its rein it follows you swimming on the same rules; carried
 * out of the map by the river you come into the next one still on its back.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils, Hex, RiverEdge, edgeCrossing, InnerMapPets, InnerMapHorseSwim, HorseSwim;

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
    RiverEdge = await import('../ui/innerMapRiverEdge.js');
    ({ _edgeCrossing: edgeCrossing } = await import('../ui/game/gameLoop.js'));
    ({ InnerMapPets } = await import('../ui/innerMapPets.js'));
    ({ InnerMapHorseSwim } = await import('../ui/innerMapHorseSwim.js'));
    ({ HorseSwim } = await import('../player/horseSwim.js'));
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
    Utils.setSeed(7);
});

afterEach(() => {
    Object.assign(InnerMapPets, { _pets: [], _trail: [], _sig: '', _map: null, _shown: false, _stray: null, riding: null, hitched: null });
    InnerMap._rideSpeed = 0;
    InnerMap._sw = null;
    InnerMap._ss = null;
    InnerMap._playerWalking = false;
    InnerMapHorseSwim._player = null;
});

const HQ = 20, HR = 20;

function makeWorld(rivers) {
    const tiles = new Map();
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) {
            const t = { q, r, terrain: { id: 'grassland', name: 'Grassland', passable: true }, elevation: 0.5, temperature: 0.5, moisture: 0.5 };
            if (rivers[k] !== undefined) { t.hasRiver = true; t.riverDir = rivers[k]; }
            tiles.set(k, t);
        }
        return tiles.get(k);
    };
    return {
        width: 60, height: 60, day: 4000, season: 'Summer', baseYear: 853, generationParams: { seed: 31, terrainGen: 3 }, activeEvents: [], kingdoms: [],
        getTile: (q, r) => at(q, r),
        getSettlementViews: () => [],
        getKingdom: () => null,
    };
}

/** A river in from the east neighbour, across HQ, out to the west one and on into it */
function riverWorld() {
    const e = Hex.neighbors(HQ, HR)[0], w = Hex.neighbors(HQ, HR)[3];
    return makeWorld({ [`${HQ},${HR}`]: 3, [`${e.q},${e.r}`]: 3, [`${w.q},${w.r}`]: 3 });
}

function makeGame(world) {
    const player = { name: 'T', q: HQ, r: HR, ships: [], health: 100, maxHealth: 100, gold: 100, skills: {}, inventory: {}, reputation: {} };
    player.mount = { name: 'Bramble', price: 120, acquiredDay: 3990 };
    const notes = [];
    const game = {
        world, player, notes, arrived: 0,
        ui: { showNotification: (title, text) => notes.push({ title, text }), updateStats() {} },
        innerMapCamera: { centerOn() {}, precomputeFrame() {} },
        exitInnerMap() { InnerMap.active = false; },
        enterInnerMap(q, r) { open(game, q, r); },
        onPlayerArrived() { game.arrived++; },
    };
    return game;
}

function open(game, q, r) {
    const tiles = InnerMap.generate(game.world.getTile(q, r), q, r, { world: game.world, player: game.player });
    Object.assign(InnerMap, {
        tiles, width: tiles[0].length, height: tiles.length, active: true, _insideBuilding: null,
        currentWorldTile: { q, r }, _swimAllowed: true, _driftPx: null, _deck: null, _climb: null, _climbRequest: null,
    });
    InnerMap.cancelPlayerWalk();
}

const tileAt = (q, r) => InnerMap.tiles[r] && InnerMap.tiles[r][q];
const isDeep = (q, r) => { const t = tileAt(q, r); return !!(t && !t.subTerrain.passable && InnerMap.isSwimmable(q, r)); };
const isWade = (q, r) => { const t = tileAt(q, r); return !!(t && t._wet && t.subTerrain.passable && !t._bridge && !t._pier && !t._deck); };
const isDry = (q, r) => { const t = tileAt(q, r); return !!(t && !t._wet && t.subTerrain.passable && !t.building && !t.customObject && !t.customBuildingPart); };

/** A cell matching `f` with a neighbour matching `g` (4-way), away from the edge */
function find(f, g = null) {
    for (let r = 4; r < InnerMap.height - 4; r++) {
        for (let q = 4; q < InnerMap.width - 4; q++) {
            if (!f(q, r)) continue;
            if (!g) return { q, r };
            for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g(q + dq, r + dr)) return { q, r, n: { q: q + dq, r: r + dr } };
        }
    }
    return null;
}

/** Deep water with deep water beside it and, all round it, more of it (mid-channel) */
const midChannel = () => find((q, r) => isDeep(q, r) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => isDeep(q + a, r + b)), isDeep);

function put(q, r) {
    InnerMap.playerInnerQ = q; InnerMap.playerInnerR = r;
    InnerMap._driftPx = null;
}

/** Up into the saddle on the mount (the pets brought onto the map first) */
function mount(game) {
    // (up into the saddle on dry ground, then back where we were)
    const was = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
    const dry = find(isDry);
    put(dry.q, dry.r);
    InnerMapHorseSwim.update(0, game);
    InnerMapPets.update(1 / 30, game);
    const m = InnerMapPets._pets.find(p => p.a.id === 'mount');
    expect(m).toBeTruthy();
    m.x = InnerMap.playerInnerQ * 32 + 16; m.y = InnerMap.playerInnerR * 32 + 16;
    expect(InnerMapPets.ride(game, m)).toBe(true);
    expect(InnerMapPets.riding).toBe('mount');
    put(was.q, was.r);
    return m;
}

const frame = (game, dt = 1 / 30) => { InnerMapPets.update(dt, game); InnerMapHorseSwim.update(dt, game); };

describe('the rules (player/horseSwim.js)', () => {
    it('a ford wets the legs a little, no further than the cap; a swim soaks the rider', () => {
        const C = HorseSwim.config();
        const p = { wetness: 0 };
        HorseSwim.wade(p);
        expect(p.wetness).toBe(C.wadeWet);
        for (let i = 0; i < 50; i++) HorseSwim.wade(p);
        expect(p.wetness).toBe(C.wadeWetCap);
        expect(p.wetness).toBeLessThan(40);
        HorseSwim.soakRider(p);
        expect(p.wetness).toBeGreaterThanOrEqual(75);
    });

    it('its strength runs down cell by cell: flagging told once, then spent; ashore it gets it back', () => {
        const a = { id: 'mount', name: 'Bramble', health: 100 };
        const st = HorseSwim.fresh(a);
        expect(st.max).toBe(HorseSwim.config().stamina);
        let flags = 0, spent = 0;
        for (let i = 0; i < 60 && st.stamina > 0; i++) {
            const r = HorseSwim.swim(st, { cells: 1, dt: 0.5 });
            flags += r.flagging ? 1 : 0; spent += r.spent ? 1 : 0;
        }
        expect(flags).toBe(1);
        expect(spent).toBe(1);
        expect(st.blown).toBe(true);
        expect(HorseSwim.refusal(a, st, {})).toMatch(/nothing left|blown/);
        let back = false;
        for (let i = 0; i < 400 && !back; i++) back = HorseSwim.rest(st, 0.25);
        expect(back).toBe(true);
        expect(HorseSwim.refusal(a, st, {})).toBe(null);
        // (a hurt horse has less in it)
        expect(HorseSwim.maxStamina({ health: 20 })).toBeLessThan(st.max);
    });

    it('a foal, near-freezing water and frozen water are refused', () => {
        const a = { id: 'mount', name: 'Bramble' };
        expect(HorseSwim.refusal(a, null, { young: true })).toMatch(/foal/);
        expect(HorseSwim.refusal(a, null, { celsius: 1 })).toMatch(/cold/);
        expect(HorseSwim.refusal(a, null, { frozen: true })).toMatch(/cold/);
        expect(HorseSwim.refusal(a, null, { celsius: 14 })).toBe(null);
    });

    it('a long swim wets the packs once: a share of what spoils in water is lost', () => {
        const player = { inventory: { flour: 20, bread: 3, iron: 10 } };
        const st = HorseSwim.fresh({ health: 100 });
        expect(HorseSwim.soakPacks(player, st)).toEqual([]);
        st.strokes = 10;
        const lost = HorseSwim.soakPacks(player, st);
        expect(lost).toEqual([{ id: 'flour', n: 3 }]);
        expect(player.inventory).toEqual({ flour: 17, bread: 3, iron: 10 });
        expect(HorseSwim.soakPacks(player, st)).toEqual([]);
    });
});

describe('riding through the water on the street map', () => {
    it('a ford or the shallows: a slower, splashing pace and wet legs', () => {
        const game = makeGame(riverWorld());
        open(game, HQ, HR);
        const spot = find(isDry, isWade);
        expect(spot).not.toBeNull();
        put(spot.q, spot.r);
        mount(game);
        // The pace hook: a careful walk through the water, nothing on dry ground
        expect(InnerMap._horsePace(spot.n, false)).toBe(HorseSwim.config().wadePace);
        expect(InnerMap._horsePace(spot, false)).toBe(0);
        // ...as the walk takes it: the same stride with and without it
        const stride = () => {
            put(spot.q, spot.r);
            Object.assign(InnerMap, { _playerWalking: true, _playerPath: [spot.n], _playerPathIndex: 0, _playerMoveProgress: 0 });
            InnerMap.updatePlayer(0.05);
            const p = InnerMap._playerMoveProgress;
            InnerMap.cancelPlayerWalk();
            return p;
        };
        const slow = stride();
        const hook = InnerMap._horsePace;
        InnerMap._horsePace = null;
        const brisk = stride();
        InnerMap._horsePace = hook;
        expect(slow / brisk).toBeCloseTo(HorseSwim.config().wadePace, 5);
        // Into the water: legs wet, not soaked
        game.player.wetness = 0;
        frame(game);
        put(spot.n.q, spot.n.r);
        frame(game);
        expect(InnerMapPets.riding).toBe('mount');
        expect(game.player.wetness).toBeGreaterThan(0);
        expect(game.player.wetness).toBeLessThanOrEqual(HorseSwim.config().wadeWetCap);
    });

    it('deep water: the horse swims you, even with packs too heavy to swim with yourself', () => {
        const game = makeGame(riverWorld());
        open(game, HQ, HR);
        const spot = find(isDeep, (q, r) => isDeep(q, r));
        put(spot.q, spot.r);
        mount(game);
        InnerMap._swimAllowed = false; // (as player/swimming.js would say, laden)
        put(find(isDry).q, find(isDry).r);
        InnerMapHorseSwim.gate(game);
        expect(InnerMap._swimAllowed).toBe(true);
        put(spot.q, spot.r);
        expect(InnerMap.isPlayerSwimming()).toBe(true);
        frame(game);
        expect(InnerMapPets.riding).toBe('mount');
        expect(InnerMapHorseSwim.carrying()).toBe(true);
        expect(game.player.wetness).toBeGreaterThanOrEqual(75);
        expect(game.notes.some(n => /Swims/.test(n.title))).toBe(true);
        // slow: its own swimming pace, not a stroke's
        expect(InnerMap._horsePace(spot.n, true)).toBe(HorseSwim.config().swimSpeed);
    });

    it('the current takes a swimming horse, a little less than a swimmer', () => {
        const game = makeGame(riverWorld());
        open(game, HQ, HR);
        const spot = midChannel();
        expect(spot).not.toBeNull();
        put(spot.q, spot.r);
        mount(game);
        expect(InnerMap.currentAt(spot.q, spot.r)).toBeTruthy();
        put(spot.q, spot.r);
        InnerMap.driftPlayer(0.05, null, 0);
        const free = Math.hypot(InnerMap._driftPx.x, InnerMap._driftPx.y);
        put(spot.q, spot.r);
        InnerMap.driftPlayer(0.05, null, InnerMapHorseSwim.resist());
        const held = Math.hypot(InnerMap._driftPx.x, InnerMap._driftPx.y);
        expect(free).toBeGreaterThan(0);
        expect(held).toBeGreaterThan(0);
        expect(held / free).toBeCloseTo(1 - HorseSwim.config().currentResist, 5);
    });

    it('only so far: it flags, then throws you and waits on the bank; blown, it refuses until rested', () => {
        const game = makeGame(riverWorld());
        open(game, HQ, HR);
        const spot = find(isDeep, isDeep);
        put(spot.q, spot.r);
        const m = mount(game);
        InnerMap._playerWalking = true;
        for (let i = 0; i < 200 && InnerMapPets.riding; i++) {
            put(i % 2 ? spot.n.q : spot.q, i % 2 ? spot.n.r : spot.r);
            frame(game, 0.1);
        }
        InnerMap._playerWalking = false;
        expect(InnerMapPets.riding).toBe(null);
        expect(game.notes.some(n => /Flagging/.test(n.title))).toBe(true);
        expect(game.notes.some(n => /Panics/.test(n.title))).toBe(true);
        // it makes for ground it can stand on, and waits there
        expect(m.stay).toBeTruthy();
        const bank = tileAt(Math.floor(m.stay.x / 32), Math.floor(m.stay.y / 32));
        expect(bank.subTerrain.passable).toBe(true);
        // blown: it won't swim again yet
        const st = InnerMapHorseSwim.state(m.a);
        expect(InnerMapHorseSwim.refusal(game, m)).toMatch(/blown|nothing left/);
        // ashore, it gets its wind back
        m.x = m.stay.x; m.y = m.stay.y;
        for (let i = 0; i < 600 && st.blown; i++) InnerMapHorseSwim._ledHorse(game, m, st, 0.25);
        expect(st.blown).toBe(false);
        expect(InnerMapHorseSwim.refusal(game, m)).toBe(null);
    });

    it('near-freezing water: it won\'t go in (and carried in, you slide off)', () => {
        const game = makeGame(riverWorld());
        open(game, HQ, HR);
        const dry = find(isDry);
        put(dry.q, dry.r);
        mount(game);
        InnerMap._sw = { celsius: 1 };
        InnerMapHorseSwim.gate(game);
        expect(InnerMap._swimAllowed).toBe(false);
        expect(InnerMap._swimRefusal).toMatch(/cold/);
        const deep = find(isDeep);
        put(deep.q, deep.r);
        frame(game);
        expect(InnerMapPets.riding).toBe(null);
    });
});

describe('a led horse in the water', () => {
    function ledOnDeep(game) {
        const spot = find(isDeep, isDeep);
        put(spot.q, spot.r);
        InnerMapPets.update(1 / 30, game);
        const m = InnerMapPets._pets.find(p => p.a.id === 'mount');
        m.x = spot.q * 32 + 16; m.y = spot.r * 32 + 16;
        return { m, spot };
    }

    it('follows you swimming, its strength spent as it swims, drawn sunk', () => {
        const game = makeGame(riverWorld());
        open(game, HQ, HR);
        const { m } = ledOnDeep(game);
        InnerMapHorseSwim.update(0.5, game);
        const st = InnerMapHorseSwim.state(m.a);
        expect(m.stay).toBeFalsy();
        expect(st.inWater).toBe(true);
        expect(st.stamina).toBeLessThan(st.max);
        expect(InnerMapHorseSwim.swimDraw(m)).toBe(true);
    });

    it('a foal balks at the water and waits on the bank', () => {
        const game = makeGame(riverWorld());
        open(game, HQ, HR);
        const { m } = ledOnDeep(game);
        m.a.bornDay = game.world.day - 10;
        InnerMapHorseSwim.update(0.1, game);
        expect(m.stay).toBeTruthy();
        expect(game.notes.some(n => /Won't Follow/.test(n.title) && /foal/.test(n.text))).toBe(true);
    });
});

describe('the river out of the map', () => {
    it('carried off the edge on its back: into the next map still riding, still swimming', async () => {
        const game = makeGame(riverWorld());
        open(game, HQ, HR);
        let at = null;
        for (let r = 0; r < InnerMap.height && !at; r++) {
            if (RiverEdge.isRiverSwim(InnerMap.tiles, 0, r) && RiverEdge.riverCarriesOut(InnerMap.currentAt(0, r), 3)) at = { q: 0, r };
        }
        expect(at).not.toBeNull();
        put(at.q, at.r);
        mount(game);
        frame(game);
        expect(InnerMapHorseSwim.carrying()).toBe(true);
        const st = InnerMapHorseSwim.state({ id: 'mount' });
        const left = st.stamina;

        edgeCrossing.riverStep(game);
        for (let i = 0; i < 50 && game._crossingEdge; i++) await new Promise(res => setTimeout(res, 0));

        const w = Hex.neighbors(HQ, HR)[3];
        expect([game.player.q, game.player.r]).toEqual([w.q, w.r]);
        frame(game);
        frame(game);
        expect(InnerMapPets.riding).toBe('mount');
        expect(InnerMapPets.mounted()).toBeTruthy();
        expect(InnerMap.isPlayerSwimming()).toBe(true);
        expect(InnerMapHorseSwim.carrying()).toBe(true);
        // (the same horse, its strength carried over, not fresh)
        expect(InnerMapHorseSwim.state({ id: 'mount' }).stamina).toBeLessThanOrEqual(left);
    });
});

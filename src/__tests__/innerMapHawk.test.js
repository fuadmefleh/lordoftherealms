// Hawking on the street map (systems/falconry.js rules, ui/innerMapHawk.js the flight):
// who can be flown at what, from how far; outcomes fixed by the seed; a kill is a real
// carcass (world.wildlife.carcasses), the hawk mantling on it until you take it; the
// abstract daily hawk game cut on a day it was flown; a raked hawk lured down with meat.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { AnimalCompanions } from '../systems/animalCompanions.js';
import { Falconry } from '../systems/falconry.js';

let InnerMap, InnerMapPets, InnerMapHawk, InnerMapAnimals, InnerMapTasks;

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ InnerMapPets } = await import('../ui/innerMapPets.js'));
    ({ InnerMapHawk } = await import('../ui/innerMapHawk.js'));
    ({ InnerMapAnimals } = await import('../ui/innerMapAnimals.js'));
    ({ InnerMapTasks } = await import('../ui/innerMapTasks.js'));
});

const saved = {};
const KEYS = ['active', 'tiles', 'width', 'height', 'playerInnerQ', 'playerInnerR', '_playerWalking', '_insideBuilding', 'animals', 'npcs', 'currentWorldTile', '_playerSpeed'];
let pos = { x: 0, y: 0 };
function openMap() {
    for (const k of KEYS) saved[k] = InnerMap[k];
    Object.assign(InnerMap, { active: true, tiles: [[]], width: 128, height: 128, playerInnerQ: 64, playerInnerR: 64, _playerWalking: false, _insideBuilding: null, animals: [], npcs: [], currentWorldTile: { q: 50, r: 50 } });
    pos = { x: 64 * 32 + 16, y: 64 * 32 + 16 };
    vi.spyOn(InnerMap, 'getPlayerWorldPos').mockImplementation(() => ({ x: pos.x, y: pos.y }));
    vi.spyOn(InnerMap, 'getTile').mockImplementation(() => null);
    for (const k of ['_mountHud', '_unmountHud', '_renderHud']) vi.spyOn(InnerMapTasks, k).mockImplementation(() => {});
}
afterEach(() => {
    vi.restoreAllMocks();
    if (InnerMapAnimals._carry) InnerMapAnimals._carry = null;
    if (saved.tiles !== undefined) Object.assign(InnerMap, saved);
    Object.assign(InnerMapPets, { _pets: [], _trail: [], _sig: '', _map: null, _shown: false, _stray: null, riding: null });
    Object.assign(InnerMapHawk, { st: null, _map: null, _game: null });
});

function mkWorld(seed = 5) {
    return { day: 400, generationParams: { seed }, getTile: () => ({ settlement: null }) };
}
function game(world = mkWorld()) {
    const player = { name: 'T', q: 50, r: 50, health: 100, maxHealth: 100, gold: 100, skills: {}, inventory: { game_meat: 2 }, reputation: {}, strength: 5 };
    const notes = [];
    return { player, world, notes, ui: { showNotification: (t, b, k) => notes.push({ t, b, k }), updateStats() {} } };
}
function hawkFor(g, o = {}) {
    const h = AnimalCompanions.acquire(g.world, g.player, 'hawk', { ageDays: 400, bond: 70, ...o });
    h.hunger = 70;
    return h;
}
function beast(species, q, r, id = `${species}:${q},${r}`) {
    const a = InnerMap._makeAnimal({ id, species, q, r }, InnerMap.animalConfig());
    InnerMap.animals.push(a);
    return a;
}
function tick(g, secs) {
    for (let i = 0; i < secs * 30; i++) {
        InnerMapPets.update(1 / 30, g);
        InnerMapHawk.update(1 / 30, g);
    }
}

describe('falconry rules', () => {
    it('needs a hawk, quarry small enough, within range', () => {
        const g = game();
        const rabbit = { id: 'r1', species: 'rabbit', state: 'graze' };
        expect(Falconry.canFly(g.world, g.player, null, rabbit, 4).ok).toBe(false);
        const hawk = hawkFor(g);
        expect(Falconry.hawkOf(g.player)).toBe(hawk);
        expect(Falconry.canFly(g.world, g.player, hawk, rabbit, 4).ok).toBe(true);
        // a deer is no hawk's quarry; a village duck is someone's
        expect(Falconry.canFly(g.world, g.player, hawk, { id: 'd', species: 'doe', state: 'graze' }, 4)).toMatchObject({ ok: false, reason: expect.stringMatching(/Too big/) });
        expect(Falconry.canFly(g.world, g.player, hawk, { id: 'p', species: 'pheasant', state: 'graze', livestock: true }, 4).ok).toBe(false);
        // too far, dead, off the fist
        expect(Falconry.canFly(g.world, g.player, hawk, rabbit, Falconry.config().range + 1)).toMatchObject({ ok: false, reason: expect.stringMatching(/Too far/) });
        expect(Falconry.canFly(g.world, g.player, hawk, { ...rabbit, state: 'dead' }, 4).ok).toBe(false);
        expect(Falconry.canFly(g.world, g.player, hawk, rabbit, 4, { onFist: false }).ok).toBe(false);
        // wild fowl are quarry (data/animals.json pheasant, wild_duck)
        for (const sp of ['pheasant', 'wild_duck']) {
            expect(InnerMap.animalSpecies(sp)).toBeTruthy();
            expect(Falconry.canFly(g.world, g.player, hawk, { id: sp, species: sp, state: 'graze' }, 4).ok).toBe(true);
        }
    });

    it('the chance answers training, distance and weather', () => {
        const g = game();
        const hawk = hawkFor(g);
        const rabbit = { id: 'r1', species: 'rabbit', state: 'graze' };
        const base = Falconry.chance(g.world, g.player, hawk, rabbit, 3);
        expect(base).toBeGreaterThan(0.3);
        expect(Falconry.chance(g.world, g.player, hawk, rabbit, 11)).toBeLessThan(base);
        expect(Falconry.chance(g.world, g.player, hawk, rabbit, 3, { weather: 'storm' })).toBeLessThan(base);
        hawk.hawking = { flights: 40, kills: 25 };
        expect(Falconry.chance(g.world, g.player, hawk, rabbit, 3)).toBeGreaterThan(base);
        expect(Falconry.chance(g.world, g.player, hawk, { id: 'f', species: 'fox', state: 'graze' }, 3)).toBeLessThan(Falconry.chance(g.world, g.player, hawk, rabbit, 3));
    });

    it('outcomes are fixed by the seed', () => {
        const run = (seed) => {
            const g = game(mkWorld(seed));
            const hawk = hawkFor(g, { bond: 90 });
            hawk.hawking = { flights: 0, kills: 30 };
            const out = [];
            for (let i = 0; i < 30; i++) {
                hawk.raked = null; hawk.hawked = null; hawk.hunger = 70; hawk.bond = 90;
                out.push(Falconry.launch(g.world, g.player, hawk, { id: `r${i}`, species: 'rabbit', state: 'graze' }, 4).outcome);
            }
            return out;
        };
        const a = run(7), b = run(7), c = run(8);
        expect(a).toEqual(b);
        expect(a).not.toEqual(c);
        expect(a).toContain('kill');
        expect(a).toContain('miss');
    });

    it('the day it was flown, its own hunting is cut and it has no share in the hunt\'s small game', () => {
        const g = game();
        const hawk = hawkFor(g);
        const entry = { item: 'game_meat' };
        expect(AnimalCompanions.huntQtyBonus(g.player, entry, g.world)).toBeGreaterThan(0);
        // a control hawk, not flown
        const g2 = game();
        const ctl = hawkFor(g2);
        g2.player.inventory = {}; g.player.inventory = {};
        // flown, and fed off the kill
        Falconry.launch(g.world, g.player, hawk, { id: 'r', species: 'rabbit', state: 'graze' }, 4);
        Falconry.reward(g.world, hawk);
        expect(hawk.hawked).toMatchObject({ day: 400, flights: 1, fed: true });
        expect(AnimalCompanions.huntQtyBonus(g.player, entry, g.world)).toBe(0);
        const before = hawk.hunger;
        ctl.hunger = before;
        AnimalCompanions.processDay(g.world, g.player);
        AnimalCompanions.processDay(g2.world, g2.player);
        const wild = AnimalCompanions.species('hawk').forage.wild;
        expect(ctl.hunger - hawk.hunger).toBeCloseTo(wild, 5);
        // read and cleared: the next day it hunts for itself again
        expect(hawk.hawked).toBeNull();
        expect(AnimalCompanions.huntQtyBonus(g.player, entry, g.world)).toBeGreaterThan(0);
    });

    it('a green, hungry hawk rakes away; meat lures it down (only eaten when it comes)', () => {
        const g = game();
        const hawk = hawkFor(g, { bond: 10, ageDays: 20 });
        hawk.hunger = 10;
        expect(Falconry.rakeChance(g.world, hawk)).toBeGreaterThan(Falconry.rakeChance(g.world, { ...hawkFor(game(), { bond: 90 }), hawking: { kills: 30 } }));
        vi.spyOn(Falconry, 'rakeChance').mockReturnValue(1);
        const bond = hawk.bond;
        expect(Falconry.launch(g.world, g.player, hawk, { id: 'r', species: 'rabbit', state: 'graze' }, 4).outcome).toBe('rake');
        expect(hawk.raked).toBeTruthy();
        expect(hawk.bond).toBeLessThan(bond);
        expect(Falconry.canFly(g.world, g.player, hawk, { id: 'r2', species: 'rabbit', state: 'graze' }, 4).ok).toBe(false);
        // nothing to lure with
        g.player.inventory = {};
        expect(Falconry.lure(g.world, g.player, hawk).success).toBe(false);
        g.player.inventory = { game_meat: 1 };
        let res, n = 0;
        do { res = Falconry.lure(g.world, g.player, hawk); n++; if (!res.came) expect(g.player.inventory.game_meat).toBe(1); } while (!res.came && n < 50);
        expect(res.came).toBe(true);
        expect(hawk.raked).toBeNull();
        expect(g.player.inventory.game_meat).toBeUndefined();
        expect(hawk.hunger).toBeGreaterThan(10);
    });

    it('raked when you leave the map: back by nightfall, a little wilder', () => {
        const g = game();
        const hawk = hawkFor(g);
        Falconry.rakeAway(g.world, hawk);
        const b = hawk.bond;
        expect(Falconry.leftRaked(g.world, hawk).text).toMatch(hawk.name);
        expect(hawk.raked).toBeNull();
        expect(hawk.bond).toBeLessThan(b);
    });
});

describe('the hawk on the street map', () => {
    it('rides the fist; "Fly the Hawk at the rabbit"; a kill is a real carcass it mantles on until you take it', () => {
        openMap();
        const g = game();
        const hawk = hawkFor(g);
        tick(g, 0.5);
        expect(InnerMapHawk.onFist()).toBe(true);
        const rec = InnerMapPets._pets.find(p => p.a.id === hawk.id);
        expect(rec.hawkHeld).toBe(true);
        expect(Math.hypot(rec.x - pos.x, rec.y - pos.y)).toBeLessThan(1);
        const rabbit = beast('rabbit', 70, 64);
        const deer = beast('doe', 60, 64);
        const items = InnerMapHawk.menuItems(g, 70, 64);
        const fly = items.find(i => i.action === 'hawk_fly');
        expect(fly.label).toBe('Fly the Hawk at the rabbit');
        expect(fly.animal).toBe(rabbit);
        // a deer: not offered
        expect(InnerMapHawk.menuItems(g, 60, 64).some(i => i.action === 'hawk_fly')).toBe(false);
        // too far: shown, not flyable
        beast('rabbit', 64, 90, 'far');
        expect(InnerMapHawk.menuItems(g, 64, 90).find(i => /Fly the Hawk/.test(i.label)).type).toBe('disabled');
        expect(deer.state).not.toBe('dead');
        // fly it: the seed's dice say kill here
        const launch = Falconry.launch;
        vi.spyOn(Falconry, 'launch').mockImplementation((...a) => ({ ...launch(...a), outcome: 'kill' }));
        expect(InnerMapHawk.handle(g, fly)).toBe(true);
        expect(InnerMapHawk.st.phase).toBe('launch');
        const seen = new Set();
        for (let i = 0; i < 30 * 8 && InnerMapHawk.st.phase !== 'mantle'; i++) {
            InnerMapPets.update(1 / 30, g); InnerMapHawk.update(1 / 30, g);
            seen.add(InnerMapHawk.st.phase);
        }
        expect([...seen]).toEqual(expect.arrayContaining(['launch', 'circle', 'stoop', 'mantle']));
        expect(rabbit.state).toBe('dead');
        const carcasses = g.world.wildlife && g.world.wildlife.carcasses && g.world.wildlife.carcasses['50,50'];
        expect(carcasses && carcasses.length).toBe(1);
        expect(hawk.hawked).toMatchObject({ day: 400, flights: 1, kills: 1 });
        expect(Math.hypot(InnerMapHawk.st.x - (70 * 32 + 16), InnerMapHawk.st.y - (64 * 32 + 16))).toBeLessThan(2);
        // on its kill: Take the Kill on its tile; you walk up and take it
        expect(InnerMapHawk.menuItems(g, 70, 64).some(i => i.action === 'hawk_take' && i.label === 'Take the Kill')).toBe(true);
        const hunger = hawk.hunger;
        pos = { x: 69 * 32 + 16, y: 64 * 32 + 16 };
        InnerMap.playerInnerQ = 69;
        tick(g, 0.2);
        expect(InnerMapHawk.st.phase).toBe('fist');
        expect(hawk.hunger).toBeGreaterThan(hunger);
        expect(hawk.hawked.fed).toBe(true);
        // the kill over your shoulder: a carcass to butcher
        expect(InnerMapAnimals._carry && InnerMapAnimals._carry.a).toBe(rabbit);
    });

    it('a miss: the quarry bolts, the hawk throws up and comes back to the fist', () => {
        openMap();
        const g = game();
        hawkFor(g);
        tick(g, 0.2);
        const rabbit = beast('rabbit', 68, 64);
        const launch = Falconry.launch;
        vi.spyOn(Falconry, 'launch').mockImplementation((...a) => ({ ...launch(...a), outcome: 'miss' }));
        InnerMapHawk.handle(g, InnerMapHawk.menuItems(g, 68, 64).find(i => i.action === 'hawk_fly'));
        const seen = new Set();
        for (let i = 0; i < 30 * 12 && !(seen.has('return') && InnerMapHawk.st.phase === 'fist'); i++) {
            InnerMapPets.update(1 / 30, g); InnerMapHawk.update(1 / 30, g);
            seen.add(InnerMapHawk.st.phase);
        }
        expect([...seen]).toEqual(expect.arrayContaining(['stoop', 'throwup', 'return', 'fist']));
        expect(rabbit.state).not.toBe('dead');
        expect(rabbit.hunted).toBe(false);
        expect(InnerMapHawk.st.phase).toBe('fist');
    });

    it('raked away into a tree: Call won\'t fetch it, the lure does', () => {
        openMap();
        const g = game();
        const hawk = hawkFor(g);
        tick(g, 0.2);
        beast('rabbit', 68, 64);
        vi.spyOn(Falconry, 'rakeChance').mockReturnValue(1);
        InnerMapHawk.handle(g, InnerMapHawk.menuItems(g, 68, 64).find(i => i.action === 'hawk_fly'));
        tick(g, 6);
        expect(InnerMapHawk.st.phase).toBe('raked');
        expect(InnerMapHawk.call(g)).toBe(false);
        const mine = InnerMapHawk.menuItems(g, 64, 64);
        const lure = mine.find(i => i.action === 'hawk_lure');
        expect(lure.label).toBe('Lure the Hawk Back (game meat)');
        vi.spyOn(Falconry, 'lureChance').mockReturnValue(0.99);
        InnerMapHawk.handle(g, lure);
        expect(hawk.raked).toBeNull();
        tick(g, 6);
        expect(InnerMapHawk.st.phase).toBe('fist');
    });

    it('cast off to wheel overhead, the pets module flies it again; back on the fist', () => {
        openMap();
        const g = game();
        const hawk = hawkFor(g);
        tick(g, 0.2);
        const mine = InnerMapHawk.menuItems(g, 64, 64);
        InnerMapHawk.handle(g, mine.find(i => i.action === 'hawk_wheel'));
        tick(g, 0.5);
        expect(InnerMapPets._pets.find(p => p.a.id === hawk.id).hawkHeld).toBe(false);
        beast('rabbit', 68, 64);
        expect(InnerMapHawk.menuItems(g, 68, 64).find(i => /Fly the Hawk/.test(i.label)).type).toBe('disabled');
        InnerMapHawk.handle(g, InnerMapHawk.menuItems(g, 64, 64).find(i => i.action === 'hawk_fist'));
        tick(g, 0.2);
        expect(InnerMapPets._pets.find(p => p.a.id === hawk.id).hawkHeld).toBe(true);
    });

    it('on the seat of your horse cart: drawn on your fist up there, and flown from it', async () => {
        const { InnerMapCarts } = await import('../ui/innerMapCarts.js');
        const { InnerMapHitch } = await import('../ui/innerMapHitch.js');
        openMap();
        const g = game();
        hawkFor(g);
        tick(g, 0.3);
        const was = InnerMapCarts.pushing;
        InnerMapCarts.pushing = { horse: 'h1', trail: [{ q: 64, r: 65 }] };
        try {
            vi.spyOn(InnerMapHitch, 'seat').mockImplementation(() => ({ px: 300, seatY: 200, dir: 2, sortY: 999, sortX: 64.1, ds: 32 }));
            tick(g, 0.2);
            expect(InnerMapHawk.onFist()).toBe(true);
            const items = [];
            const ctx = { canvas: { width: 800, height: 600 } };
            const camera = { zoom: 1, worldToScreenFast: (x, y) => ({ x, y }) };
            InnerMapHawk.collect(items, ctx, camera, 32, 2);
            expect(items.length).toBe(1);
            expect(items[0].sortY).toBeGreaterThan(999);
            // the glove up by the seated driver's left hand: above the seat, to the screen's right
            const f = InnerMapHawk._fistAt(300, 200, 32, 2, false, 0, true);
            expect(f.y).toBeLessThan(200);
            expect(f.y).toBeGreaterThan(200 - 32 * 1.8 * 42 / 64);
            expect(f.x).toBeGreaterThan(300);
            // and "Fly the Hawk" from the seat
            const rabbit = beast('rabbit', 70, 64);
            const fly = InnerMapHawk.menuItems(g, 70, 64).find(i => i.action === 'hawk_fly');
            expect(fly && fly.type).toBe('action');
            expect(fly.animal).toBe(rabbit);
        } finally {
            InnerMapCarts.pushing = was;
        }
    });
});

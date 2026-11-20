// Your animals on the street map (ui/innerMapPets.js) and Who Walks With You
// (systems/streetFollowers.js): the dog and the led horse fall in behind your
// companions along your trail, the hawk wheels overhead; anyone told to wait
// — a companion, the household guard, an animal — stays off the map; a dog
// fights beside you through the escort's strike; the pet menu's choices.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { AnimalCompanions } from '../systems/animalCompanions.js';
import { StreetFollowers } from '../systems/streetFollowers.js';

let InnerMap, InnerMapPets, InnerMapCompanions, InnerMapEscort, Companions, RealmEscort, InnerMapTasks, InnerMapAnimals;

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ InnerMapPets } = await import('../ui/innerMapPets.js'));
    ({ InnerMapCompanions } = await import('../ui/innerMapCompanions.js'));
    ({ InnerMapEscort } = await import('../ui/innerMapEscort.js'));
    ({ Companions } = await import('../systems/companions.js'));
    ({ RealmEscort } = await import('../player/realmEscort.js'));
    ({ InnerMapTasks } = await import('../ui/innerMapTasks.js'));
    ({ InnerMapAnimals } = await import('../ui/innerMapAnimals.js'));
});

const saved = {};
const KEYS = ['active', 'tiles', 'width', 'height', 'playerInnerQ', 'playerInnerR', '_playerWalking', '_insideBuilding', 'animals', 'npcs'];
let pos = { x: 0, y: 0 };
function openMap() {
    for (const k of KEYS) saved[k] = InnerMap[k];
    Object.assign(InnerMap, { active: true, tiles: [[]], width: 128, height: 128, playerInnerQ: 64, playerInnerR: 64, _playerWalking: false, _insideBuilding: null, animals: [], npcs: [] });
    pos = { x: 64 * 32 + 16, y: 64 * 32 + 16 };
    vi.spyOn(InnerMap, 'getPlayerWorldPos').mockImplementation(() => ({ x: pos.x, y: pos.y }));
    for (const k of ['_mountHud', '_unmountHud', '_renderHud']) vi.spyOn(InnerMapTasks, k).mockImplementation(() => {});
}
afterEach(() => {
    vi.restoreAllMocks();
    InnerMapAnimals._fight = null;
    if (saved.tiles !== undefined) Object.assign(InnerMap, saved);
    Object.assign(InnerMapPets, { _pets: [], _trail: [], _sig: '', _map: null, _shown: false, _stray: null, riding: null });
    InnerMap._rideSpeed = 0;
    Object.assign(InnerMapCompanions, { _men: [], _trail: [], _sig: '', _map: null, _shown: false });
    Object.assign(InnerMapEscort, { _men: [], _trail: [], _sig: '', _map: null, _shown: false });
});

const world = { day: 400, generationParams: { seed: 5 }, getTile: () => ({ settlement: null }) };
function game() {
    const player = { name: 'T', q: 50, r: 50, health: 100, maxHealth: 100, gold: 100, skills: {}, inventory: { game_meat: 2 }, reputation: {} };
    return { player, world, ui: { showNotification() {}, updateStats() {} } };
}

function step(g, tiles) {
    for (let i = 0; i < tiles * 10; i++) {
        pos.y -= 3.2;
        InnerMapCompanions.update(1 / 30, g);
        InnerMapPets.update(1 / 30, g);
        InnerMapEscort.update(1 / 30, g);
    }
    for (let i = 0; i < 90; i++) {
        InnerMapCompanions.update(1 / 30, g);
        InnerMapPets.update(1 / 30, g);
        InnerMapEscort.update(1 / 30, g);
    }
}

describe('animals on the street map', () => {
    it('the horse and dog follow in file behind the companions; the hawk wheels overhead', () => {
        openMap();
        vi.spyOn(Companions, 'members').mockReturnValue([{ id: 'c1', firstName: 'Ann', isAlive: true }]);
        const g = game();
        g.player.mount = { name: 'Bramble', price: 120, acquiredDay: 1 };
        AnimalCompanions.acquire(world, g.player, 'dog', { ageDays: 400 });
        AnimalCompanions.acquire(world, g.player, 'hawk', { ageDays: 400 });
        step(g, 8);
        const pets = InnerMapPets._pets;
        expect(pets.map(p => p.a.species)).toEqual(['horse', 'dog', 'hawk']);
        expect(InnerMapPets.count()).toBe(4);   // (the led horse takes three places)
        const comp = InnerMapCompanions._men[0];
        const horse = pets[0], dog = pets[1], hawk = pets[2];
        // behind the player, and behind the companion
        expect(horse.y).toBeGreaterThan(comp.y);
        expect(dog.y).toBeGreaterThan(horse.y);
        expect(dog.y - pos.y).toBeLessThan(32 * 5);
        // the hawk is near the player, not in the file
        expect(Math.hypot(hawk.x - pos.x, hawk.y - pos.y)).toBeLessThan(32 * 3);
        // walking, they walk (a walk frame)
        expect(['up', 'down', 'left', 'right']).toContain(dog.facing);
    });

    it('the horse can be ridden: under you, out of the file, quicker; down of yourself at a door', () => {
        openMap();
        const g = game();
        g.player.mount = { name: 'Bramble', price: 120, acquiredDay: 1 };
        step(g, 4);
        const horse = InnerMapPets._pets.find(p => p.a.id === 'mount');
        // (beside you: up at once)
        horse.x = pos.x; horse.y = pos.y + 32;
        const tileOf = (m) => [Math.floor(m.x / 32), Math.floor(m.y / 32)];
        const items = InnerMapPets.menuItems(g, ...tileOf(horse)).map(i => i.action);
        expect(items).toContain('pet_ride');
        expect(InnerMapPets.handle(g, { action: 'pet_ride', petId: 'mount' })).toBe(true);
        expect(InnerMapPets.riding).toBe('mount');
        expect(InnerMap._rideSpeed).toBeGreaterThan(1);
        expect(InnerMapPets.count()).toBe(0);   // (not led in the file: under you)
        step(g, 3);
        expect(Math.hypot(horse.x - pos.x, horse.y - pos.y)).toBeLessThan(1);
        // on your own tile: Dismount, not Stay Here
        const mine = InnerMapPets.menuItems(g, ...tileOf({ x: pos.x, y: pos.y })).map(i => i.action);
        expect(mine).toContain('pet_dismount');
        expect(mine).not.toContain('pet_stay');
        // through a door: down you get, the horse left outside
        InnerMap._insideBuilding = { id: 'house' };
        InnerMapPets.update(1 / 30, g);
        expect(InnerMapPets.riding).toBe(null);
        expect(InnerMap._rideSpeed).toBe(0);
        InnerMap._insideBuilding = null;
        // and up again, then down by the menu
        InnerMapPets.update(1 / 30, g);
        InnerMapPets.handle(g, { action: 'pet_ride', petId: 'mount' });
        expect(InnerMapPets.riding).toBe('mount');
        InnerMapPets.handle(g, { action: 'pet_dismount', petId: 'mount' });
        expect(InnerMapPets.riding).toBe(null);
        expect(InnerMap._rideSpeed).toBe(0);
    });

    it('a foal is too young to ride', () => {
        openMap();
        const g = game();
        g.player.mount = { name: 'Pip', price: 120, acquiredDay: 400, age: 0, bornDay: 399 };
        step(g, 2);
        const horse = InnerMapPets._pets.find(p => p.a.id === 'mount');
        horse.x = pos.x; horse.y = pos.y + 32;
        expect(InnerMapPets.menuItems(g, Math.floor(horse.x / 32), Math.floor(horse.y / 32)).map(i => i.action)).not.toContain('pet_ride');
        InnerMapPets.handle(g, { action: 'pet_ride', petId: 'mount' });
        expect(InnerMapPets.riding).toBe(null);
    });

    it('none indoors, none with nobody', () => {
        openMap();
        const g = game();
        InnerMapPets.update(1 / 30, g);
        expect(InnerMapPets.count()).toBe(0);
        AnimalCompanions.acquire(world, g.player, 'cat', { ageDays: 400 });
        InnerMap._insideBuilding = { type: 'house' };
        InnerMapPets.update(1 / 30, g);
        expect(InnerMapPets._shown).toBe(false);
    });

    it('a dog fights the beast you fight, through the escort\'s strike', () => {
        openMap();
        const g = game();
        AnimalCompanions.acquire(world, g.player, 'dog', { breed: 'mastiff', ageDays: 400, bond: 90 });
        const wolf = { id: 'w1', species: 'wolf', state: 'attack', hp: 30, maxHp: 30, q: 65, r: 64 };
        InnerMap.animals = [wolf];
        vi.spyOn(InnerMap, 'animalPos').mockReturnValue({ q: 65, r: 64 });
        const strike = vi.spyOn(InnerMapEscort, '_strike').mockImplementation(() => {});
        for (let i = 0; i < 120; i++) InnerMapPets.update(1 / 30, g);
        expect(strike).toHaveBeenCalled();
        const [, m, foe, dmg] = strike.mock.calls[0];
        expect(m.a.species).toBe('dog');
        expect(foe.a).toBe(wolf);
        expect(dmg).toBeGreaterThan(5);
    });

    it('the dog, cat and hawk are drawn from the painted series\' 128px sheets; standing, the dog and cat play their idle', async () => {
        const fs = await import('fs');
        for (const sp of ['dog', 'cat', 'hawk']) {
            const s = InnerMapPets.sprite({ species: sp, breed: Object.keys(AnimalCompanions.species(sp).breeds)[0] });
            expect(s.frameW).toBe(128);
            expect(s.anchor).toEqual([64, sp === 'hawk' ? 84 : 124]);
            for (const [k, path] of Object.entries(s.sheets)) {
                const buf = fs.readFileSync(path);
                // (the attack sheet is as many cells wide as it has frames: the dog's bite six)
                expect(buf.readUInt32BE(16)).toBe(128 * (k === 'attack' ? (s.attackCols || 4) : 4));
                expect(buf.readUInt32BE(20)).toBe(512);
            }
        }
        const dog = InnerMapPets.sprite({ species: 'dog', breed: 'hound' });
        const cat = InnerMapPets.sprite({ species: 'cat', breed: 'tabby' });
        expect(dog.sheets.idle && dog.sheets.attack && cat.sheets.idle).toBeTruthy();
        // still: the idle sheet, its frames turning over with the clock; walking: the walk; biting: the attack
        const still = { id: 'a1', facing: 'left', state: 'walk', moving: false, idleT: 0 };
        const cols = new Set();
        for (let t = 0; t < 1; t += 0.1) cols.add(InnerMapAnimals.frame({ ...still, idleT: t }, dog).col);
        expect(InnerMapAnimals.frame(still, dog).sheet).toBe(dog.sheets.idle);
        expect(InnerMapAnimals.frame(still, dog).row).toBe(1);
        expect(cols.size).toBeGreaterThan(1);
        expect(InnerMapAnimals.frame({ ...still, moving: true, animT: 0.3 }, dog).sheet).toBe(dog.sheets.walk);
        expect(InnerMapAnimals.frame({ ...still, state: 'attack', atkT: 0.1 }, dog).sheet).toBe(dog.sheets.attack);
        // the bite plays all seven frames (crouch, lunge, jaws agape, the snap, back in its stance), carried forward
        // along its facing at the height of the lunge, and then it stands poised on the walk
        expect(dog.attackCols).toBe(7);
        const bite = [];
        for (let t = 0; t < 7 / 12; t += 1 / 24) bite.push(InnerMapAnimals.frame({ ...still, state: 'attack', atkT: t }, dog));
        expect(new Set(bite.map(f => f.col)).size).toBe(7);
        // (it ends where it started: the last frame carries it no further than the first)
        expect(Math.abs(InnerMapAnimals.lungeOffset(still, dog, bite[bite.length - 1]).dx)).toBe(0);
        expect(bite.every(f => f.sheet === dog.sheets.attack && f.attack)).toBe(true);
        const mid = InnerMapAnimals.frame({ ...still, state: 'attack', atkT: 3.2 / dog.attackFps }, dog);
        expect(InnerMapAnimals.lungeOffset(still, dog, mid).dx).toBeLessThan(-10);
        expect(InnerMapAnimals.lungeOffset({ ...still, facing: 'down' }, dog, mid).dy).toBeGreaterThan(5);
        const after = InnerMapAnimals.frame({ ...still, state: 'attack', atkT: 0.7 }, dog);
        expect(after.sheet).toBe(dog.sheets.walk);
        expect(InnerMapAnimals.lungeOffset(still, dog, after)).toEqual({ dx: 0, dy: 0 });
        // a wild beast with no idle sheet stands on its walk sheet (and breathes as it is drawn)
        const wolf = InnerMap.animalSpecies('wolf', InnerMap.animalConfig());
        expect(InnerMapAnimals.frame({ id: 'w', facing: 'down', state: 'graze', animT: 0 }, wolf)).toMatchObject({ sheet: wolf.sheets.walk, col: 0 });
    });
});

describe('who walks with you', () => {
    it('one told to wait stays off the street map: an animal, a companion, the guard', () => {
        openMap();
        const g = game();
        const dog = AnimalCompanions.acquire(world, g.player, 'dog', { ageDays: 400 });
        const cat = AnimalCompanions.acquire(world, g.player, 'cat', { ageDays: 400 });
        vi.spyOn(Companions, 'members').mockReturnValue([{ id: 'c1', firstName: 'Ann', isAlive: true }, { id: 'c2', firstName: 'Bob', isAlive: true }]);
        vi.spyOn(RealmEscort, 'guard').mockReturnValue({ rank: 'lord', kingdomName: 'Vel' });
        vi.spyOn(RealmEscort, 'units').mockReturnValue([{ type: 'foot', realmGuard: 'k1', strength: 20 }]);
        // everyone walks by default
        expect(InnerMapPets.walkers(g.player).map(a => a.id)).toEqual([dog.id, cat.id]);
        StreetFollowers.set(g.player, StreetFollowers.animalKey(dog.id), false);
        StreetFollowers.set(g.player, StreetFollowers.npcKey('c1'), false);
        StreetFollowers.set(g.player, StreetFollowers.GUARD, false);
        step(g, 3);
        expect(InnerMapPets._pets.map(p => p.a.id)).toEqual([cat.id]);
        expect(InnerMapCompanions._men.map(m => m.npc.id)).toEqual(['c2']);
        expect(InnerMapEscort._men).toHaveLength(0);
        // and back again
        StreetFollowers.set(g.player, StreetFollowers.GUARD, true);
        StreetFollowers.set(g.player, StreetFollowers.animalKey(dog.id), true);
        step(g, 1);
        expect(InnerMapEscort._shown).toBe(true);
        expect(InnerMapPets._pets.map(p => p.a.id)).toEqual([dog.id, cat.id]);
        expect(g.player.walkWith).toEqual({ 'npc:c1': false });
    });

    it('a kept-at-home animal doesn\'t walk; the pet menu feeds, stays and sends one back', () => {
        openMap();
        const g = game();
        const dog = AnimalCompanions.acquire(world, g.player, 'dog', { ageDays: 400 });
        dog.hunger = 20;
        step(g, 2);
        const m = InnerMapPets._pets[0];
        const q = Math.round((m.x - 16) / 32), r = Math.round((m.y - 16) / 32);
        const items = InnerMapPets.menuItems(g, q, r);
        expect(items.some(i => i.action === 'pet_feed')).toBe(true);
        expect(InnerMapPets.handle(g, { action: 'pet_feed', petId: dog.id })).toBe(true);
        expect(dog.hunger).toBeGreaterThan(20);
        expect(g.player.inventory.game_meat).toBe(1);
        InnerMapPets.handle(g, { action: 'pet_stay', petId: dog.id });
        expect(InnerMapPets.count()).toBe(0);
        InnerMapPets.handle(g, { action: 'pet_wait', petId: dog.id });
        InnerMapPets.update(1 / 30, g);
        expect(InnerMapPets._pets).toHaveLength(0);
        StreetFollowers.set(g.player, StreetFollowers.animalKey(dog.id), true);
        AnimalCompanions.keepAt(g.player, dog.id, 'home:1');
        expect(InnerMapPets.walkers(g.player)).toHaveLength(0);
    });
});

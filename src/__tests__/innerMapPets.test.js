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
    Object.assign(InnerMapPets, { _pets: [], _trail: [], _sig: '', _map: null, _shown: false, _stray: null });
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

// Your own animals (systems/animalCompanions.js, data/animalCompanions.json):
// bought at a town's market (the price to the town's purse), a stray won over
// with food, fed from the packs or with scraps bought in town, older by the
// day and dead of old age, starved or run off; the horse bridged in from
// player.mount; their effects read by the hunt, the cutpurse, the road and
// the larder; saved with the player, and an old save without them loads.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { AnimalCompanions } from '../systems/animalCompanions.js';
import { StreetFollowers } from '../systems/streetFollowers.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { NpcTheft } from '../systems/npcTheft.js';
import { Player } from '../player/player.js';
import { Hunting } from '../player/foraging.js';
import { RoadEncounters } from '../player/roadEncounters.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(4242));

function makeWorld(o = {}) {
    const tiles = new Map();
    const settlement = { name: 'Hornby', type: o.type || 'capital', population: 9000, q: 5, r: 6, kingdom: 'k1', economy: { gold: 1000 } };
    const at = (q, r) => {
        const k = `${q},${r}`;
        if (!tiles.has(k)) tiles.set(k, { q, r, terrain: { id: 'grassland', passable: true }, settlement: null });
        return tiles.get(k);
    };
    at(5, 6).settlement = settlement;
    const world = { day: o.day || 100, season: o.season || 'Spring', generationParams: { seed: 77 }, getTile: (q, r) => at(q, r) };
    return { world, settlement };
}

function makePlayer(o = {}) {
    const p = new Player();
    p.q = o.q != null ? o.q : 5; p.r = o.r != null ? o.r : 6;
    p.gold = o.gold != null ? o.gold : 500;
    p.inventory = o.inventory || {};
    return p;
}

describe('getting one', () => {
    it('the market sells pups, kittens and hawks; the price goes to the town purse', () => {
        // find a month when the capital has a dog for sale
        let world, settlement, offer;
        for (let day = 0; day < 3000 && !offer; day += 30) {
            ({ world, settlement } = makeWorld({ day }));
            offer = AnimalCompanions.market(world, settlement).find(o => o.species === 'dog');
        }
        expect(offer).toBeTruthy();
        const p = makePlayer({ gold: 500 });
        const purse = settlement.economy.gold;
        const res = AnimalCompanions.buy(world, p, settlement, offer.key);
        expect(res.success).toBe(true);
        expect(p.gold).toBe(500 - offer.price);
        expect(settlement.economy.gold).toBe(purse + offer.price);
        const a = res.animal;
        expect(a.species).toBe('dog');
        expect(a.name).toBeTruthy();
        expect(AnimalCompanions.isYoung(a, world)).toBe(true);
        // one fewer in the pens
        const after = AnimalCompanions.market(world, settlement).find(o => o.key === offer.key);
        expect(after ? after.stock : 0).toBe(offer.stock - 1);
    });

    it('refuses when the purse is short', () => {
        let world, settlement, offer;
        for (let day = 0; day < 3000 && !offer; day += 30) {
            ({ world, settlement } = makeWorld({ day }));
            offer = AnimalCompanions.market(world, settlement)[0];
        }
        const p = makePlayer({ gold: 0 });
        expect(AnimalCompanions.buy(world, p, settlement, offer.key).success).toBe(false);
        expect(AnimalCompanions.list(p)).toHaveLength(0);
    });

    it('a stray dog is won over with food from your packs', () => {
        let world, settlement, stray;
        for (let day = 0; day < 2000 && !stray; day += 10) {
            ({ world, settlement } = makeWorld({ day }));
            stray = AnimalCompanions.strayAt(world, settlement);
        }
        expect(stray).toBeTruthy();
        const p = makePlayer({ inventory: { game_meat: 2, cabbage: 3 } });
        const first = AnimalCompanions.offerFood(world, p, settlement, 'game_meat');
        expect(first.success).toBe(true);
        expect(first.joined).toBe(false);
        expect(p.inventory.game_meat).toBe(1);
        // a dog won't eat cabbage
        expect(AnimalCompanions.offerFood(world, p, settlement, 'cabbage').success).toBe(false);
        expect(p.inventory.cabbage).toBe(3);
        const res = AnimalCompanions.offerFood(world, p, settlement, 'game_meat');
        expect(res.joined).toBe(true);
        expect(res.animal.from).toBe('stray');
        expect(AnimalCompanions.list(p).map(a => a.species)).toEqual(['dog']);
        // and it is gone from the streets
        expect(AnimalCompanions.strayAt(world, settlement, p)).toBeNull();
    });
});

describe('by the day', () => {
    it('eats from your packs, else scraps bought in town (paid to the town)', () => {
        const { world, settlement } = makeWorld();
        const p = makePlayer({ inventory: { game_meat: 1 } });
        const dog = AnimalCompanions.acquire(world, p, 'dog', { breed: 'hound', ageDays: 400 });
        dog.hunger = 50;
        AnimalCompanions.processDay(world, p);
        expect(p.inventory.game_meat).toBeUndefined();
        expect(dog.hunger).toBeGreaterThan(30);
        // nothing left in the packs: the town's butcher sells scraps
        dog.hunger = 10;
        const gold = p.gold, purse = settlement.economy.gold;
        AnimalCompanions.processDay(world, p);
        expect(p.gold).toBeLessThan(gold);
        expect(settlement.economy.gold).toBe(purse + (gold - p.gold));
        expect(dog.hunger).toBeGreaterThanOrEqual(75);
    });

    it('a well-fed one grows closer; a starved, neglected one runs off', () => {
        const { world } = makeWorld();
        const p = makePlayer({ q: 50, r: 50, gold: 0 });   // out in the wild, nothing to eat, no coin
        const dog = AnimalCompanions.acquire(world, p, 'dog', { ageDays: 400, bond: 40 });
        dog.hunger = 100;
        AnimalCompanions.processDay(world, p);
        expect(dog.bond).toBeGreaterThan(40);
        dog.bond = 12;
        let out = [];
        for (let i = 0; i < 40 && AnimalCompanions.list(p).length; i++) out = out.concat(AnimalCompanions.processDay(world, p).notices);
        expect(AnimalCompanions.list(p)).toHaveLength(0);
        expect(AnimalCompanions.state(p).gone[0].how).toMatch(/ran off|starved/);
    });

    it('ages, and dies of old age at its day', () => {
        const { world } = makeWorld();
        const p = makePlayer();
        const cat = AnimalCompanions.acquire(world, p, 'cat', { ageDays: 60 });
        expect(AnimalCompanions.isYoung(cat, world)).toBe(true);
        const sp = AnimalCompanions.species('cat');
        expect(cat.deathDay - cat.bornDay).toBeGreaterThanOrEqual(sp.lifeYears[0] * 120);
        expect(cat.deathDay - cat.bornDay).toBeLessThanOrEqual(sp.lifeYears[1] * 120);
        world.day = cat.bornDay + 3 * 120;
        expect(AnimalCompanions.ageYears(cat, world)).toBe(3);
        world.day = cat.deathDay;
        const { notices } = AnimalCompanions.processDay(world, p);
        expect(AnimalCompanions.list(p)).toHaveLength(0);
        expect(notices[0].title).toMatch(/Dead/);
        expect(AnimalCompanions.state(p).gone[0].how).toBe('old age');
    });

    it('one kept at a home eats from its larder', () => {
        const { world } = makeWorld();
        const p = makePlayer({ q: 50, r: 50 });
        const dog = AnimalCompanions.acquire(world, p, 'dog', { ageDays: 400 });
        AnimalCompanions.keepAt(p, dog.id, 'home:1');
        dog.hunger = 40;
        const larder = { game_meat: 3 };
        AnimalCompanions.processDay(world, p, { larder: (k) => (k === 'home:1' ? larder : null) });
        expect(larder.game_meat).toBeLessThan(3);
        expect(dog.hunger).toBeGreaterThan(30);
    });
});

describe('the horse', () => {
    it('player.mount is one of your animals, backfilled, and dies of old age', () => {
        const { world } = makeWorld();
        const p = makePlayer();
        p.mount = { name: 'Bramble', price: 120, acquiredDay: 50 };
        const list = AnimalCompanions.list(p, world);
        expect(list).toHaveLength(1);
        const h = list[0];
        expect(h).toBe(p.mount);
        expect(h.species).toBe('horse');
        expect(h.bornDay).toBe(50 - 5 * 120);
        expect(AnimalCompanions.rename(p, 'mount', 'Thunder').success).toBe(true);
        expect(p.mount.name).toBe('Thunder');
        world.day = h.deathDay;
        AnimalCompanions.processDay(world, p);
        expect(p.mount).toBeNull();
    });
});

describe('what they do (read by the game)', () => {
    it('a dog with you adds to the hunt; a hawk only to small game', () => {
        const { world } = makeWorld();
        const p = makePlayer();
        const deer = { item: 'antler', qty: { min: 1, max: 1 }, chance: 0.2 };
        const rabbit = { item: 'game_meat', qty: { min: 1, max: 1 }, chance: 0.4 };
        expect(AnimalCompanions.huntQtyBonus(p, rabbit)).toBe(0);
        const hawk = AnimalCompanions.acquire(world, p, 'hawk', { breed: 'goshawk', ageDays: 300, bond: 100 });
        expect(AnimalCompanions.huntQtyBonus(p, rabbit)).toBeGreaterThan(0.2);
        expect(AnimalCompanions.huntQtyBonus(p, deer)).toBe(0);
        // Hunting.rollQty reads it: more second cuts of small game with the hawk
        const roll = (n) => { let t = 0; for (let i = 0; i < n; i++) t += Hunting.rollQty(rabbit, p); return t; };
        Utils.setSeed(9);
        const withHawk = roll(400);
        AnimalCompanions.release(p, hawk.id);
        Utils.setSeed(9);
        const without = roll(400);
        expect(withHawk).toBeGreaterThan(without + 40);
    });

    it('a dog walking with you warns of a cutpurse (not one left waiting); it helps you flee a band', () => {
        const { world } = makeWorld();
        const p = makePlayer();
        const base = NpcTheft.awareness('player', p, 100);
        const dog = AnimalCompanions.acquire(world, p, 'dog', { breed: 'mastiff', ageDays: 400, bond: 90 });
        expect(NpcTheft.awareness('player', p, 100)).toBeGreaterThan(base);
        StreetFollowers.set(p, StreetFollowers.animalKey(dog.id), false);
        expect(NpcTheft.awareness('player', p, 100)).toBeCloseTo(base, 6);
        expect(AnimalCompanions.roadWarning(p)).toBeGreaterThan(0);
        // the flee odds include it
        const attacker = { name: 'Bandits', type: 'bandit', strength: 10, speed: 5 };
        const sit = { hasArmy: false, comp: {}, units: 0, terrainId: 'grassland' };
        const withDog = RoadEncounters.fleeChance(p, attacker, sit);
        AnimalCompanions.keepAt(p, dog.id, 'home:x');
        expect(withDog).toBeGreaterThan(RoadEncounters.fleeChance(p, attacker, sit));
    });

    it('a dog takes part of a beast\'s mauling on the road', () => {
        const { world } = makeWorld();
        const p = makePlayer({ q: 50, r: 50 });
        p.army = [];
        p.health = 100; p.maxHealth = 100;
        const beast = { name: 'Wolf Pack', type: 'beast', strength: 10 };
        Utils.setSeed(3);
        const alone = RoadEncounters.ambush(p, { ...beast }, world).healthLost;
        p.health = 100;
        const dog = AnimalCompanions.acquire(world, p, 'dog', { breed: 'mastiff', ageDays: 400, bond: 100 });
        Utils.setSeed(3);
        const out = RoadEncounters.ambush(p, { ...beast }, world);
        expect(out.healthLost).toBeLessThan(alone);
        expect(out.notification.body).toContain(dog.name);
        expect(dog.health).toBeLessThan(100);
    });

    it('a cat kept at a house cuts its larder\'s spoilage', () => {
        const { world } = makeWorld();
        const p = makePlayer();
        const cat = AnimalCompanions.acquire(world, p, 'cat', { ageDays: 400, bond: 80 });
        expect(AnimalCompanions.mouserCut(p, 'home:1')).toBe(0);
        AnimalCompanions.keepAt(p, cat.id, 'home:1');
        expect(AnimalCompanions.mouserCut(p, 'home:1')).toBeGreaterThan(0.3);
        expect(AnimalCompanions.mouserCut(p, 'home:2')).toBe(0);
    });
});

describe('saved with the player', () => {
    it('round-trips the animals, the horse\'s own fields and who walks with you', () => {
        const { world } = makeWorld();
        const p = makePlayer();
        p.mount = { name: 'Bramble', price: 120, acquiredDay: 50 };
        const dog = AnimalCompanions.acquire(world, p, 'dog', { breed: 'hound', ageDays: 300 });
        AnimalCompanions.list(p, world);
        StreetFollowers.set(p, StreetFollowers.animalKey(dog.id), false);
        StreetFollowers.set(p, StreetFollowers.GUARD, false);
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.animalCompanions).toEqual(p.animalCompanions);
        expect(back.mount.bornDay).toBe(p.mount.bornDay);
        expect(StreetFollowers.walks(back, StreetFollowers.animalKey(dog.id))).toBe(false);
        expect(StreetFollowers.walks(back, StreetFollowers.GUARD)).toBe(false);
        expect(StreetFollowers.walks(back, StreetFollowers.npcKey('x'))).toBe(true);
        // the next one gets a fresh id
        expect(AnimalCompanions.acquire(world, back, 'cat', {}).id).not.toBe(dog.id);
    });

    it('an old save without them (and a plain old mount) loads and plays on', () => {
        const { world } = makeWorld();
        const old = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(makePlayer())));
        delete old.animalCompanions;
        delete old.walkWith;
        old.mount = { name: 'Old Nell', price: 90, acquiredDay: 3 };
        const back = new Player();
        SaveLoad.restorePlayer(old, back);
        expect(AnimalCompanions.list(back, world).map(a => a.name)).toEqual(['Old Nell']);
        expect(StreetFollowers.walks(back, StreetFollowers.GUARD)).toBe(true);
        expect(() => AnimalCompanions.processDay(world, back)).not.toThrow();
        expect(back.mount.health).toBeGreaterThan(0);
    });
});

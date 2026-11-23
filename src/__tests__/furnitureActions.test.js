/**
 * Interior furniture is usable, not just inspectable: each furniture type maps
 * to real OBJECT_ACTIONS, building context changes the offer (a tavern bed is
 * rented), and private furniture in someone else's home stays off-limits.
 * The rules behind Sit, Sleep (and Sleep Here as a trespass), Warm Up, Read,
 * Order a Meal, Eat from the Larder, Wash at the Basin and Take a Bath are
 * player/furnitureActions.js (data/furnitureActions.json).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { ObjectActions } from '../ui/objectActions.js';
import { FURNITURE_ACTIONS, BUILDING_FURNITURE_ACTIONS, FOOD_ITEMS } from '../ui/objectActions/data.js';
import { FurnitureActions } from '../player/furnitureActions.js';
import { Containers } from '../systems/containers.js';
import { Underworld } from '../systems/underworld.js';
import { InnerMap } from '../world/innerMap.js';
import { newGame } from './playtest/harness.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/** A player with needs (0..100), a purse, packs and clothes. */
function mockPlayer(over = {}) {
    const p = {
        q: 0, r: 0, gold: 100, inventory: {}, skills: {}, reputation: { k1: 10 },
        needs: { energy: 50, comfort: 50, fun: 50, hygiene: 30, hunger: 40, social: 50 },
        clothesFreshness: 40,
        modifyNeed(n, a) { this.needs[n] = Math.max(0, Math.min(100, (this.needs[n] || 0) + a)); },
        getClothesFreshness() { return this.clothesFreshness; },
        washClothes(f) { const before = this.clothesFreshness; this.clothesFreshness = Math.min(100, before + f); return this.clothesFreshness - before; },
        useSoap() { if (!(this.inventory.soap > 0)) return null; this.inventory.soap--; return { hygiene: 15, clothes: 15 }; },
        ...over,
    };
    return p;
}

const keysFor = (type, building, furniture = null, player = null, world = null) =>
    ObjectActions.getFurnitureActionKeys(type, building, { furniture, player, world });

describe('furniture actions', () => {
    it('every mapped action key exists in the registry', () => {
        const fa = FurnitureActions.data();
        const lists = [
            ...Object.values(FURNITURE_ACTIONS),
            ...Object.values(BUILDING_FURNITURE_ACTIONS).flatMap(m => Object.values(m)),
            ...Object.values(fa.offers),
            ...Object.values(fa.byBuilding).flatMap(m => Object.values(m)),
            ...Object.values(fa.decorOffers).flatMap(o => (Array.isArray(o) ? [o] : Object.values(o))),
        ];
        for (const key of lists.flat()) {
            expect(ObjectActions.get(key), key).toBeTruthy();
        }
    });

    it('building context overrides the default offer', () => {
        expect(ObjectActions.getFurnitureActionKeys('bed', { type: 'tavern' })).toEqual(['rent_room']);
        expect(ObjectActions.getFurnitureActionKeys('stall', { type: 'marketplace' })).toContain('shop');
        expect(ObjectActions.getFurnitureActionKeys('rack', { type: 'barracks' })).toContain('hire_troops');
        expect(ObjectActions.getFurnitureActionKeys('forge', { type: 'player_blacksmith' })).toContain('smelt');
    });

    it("private furniture is usable only in the player's own buildings", () => {
        // Someone else's bed: Sleep (greyed out, not yours) and Sleep Here Anyway (a trespass)
        expect(ObjectActions.getFurnitureActionKeys('bed', { type: 'house' })).toEqual(['sleep', 'sleep_trespass']);
        // Someone else's chest can't be used — only looked into (and its contents stolen)
        expect(ObjectActions.getFurnitureActionKeys('chest', { type: 'manor' })).toEqual(['look_inside']);
        expect(ObjectActions.getFurnitureActionKeys('bed', { type: 'house', isPlayerOwned: true })).toContain('sleep');
        expect(ObjectActions.getFurnitureActionKeys('chest', { type: 'farm', isPlayerProperty: true })).toContain('store');
        expect(ObjectActions.getFurnitureActionKeys('chest', { type: 'farm', isPlayerProperty: true })).not.toContain('look_inside');
    });

    it('infers furniture type from editor object names', () => {
        expect(ObjectActions.inferFurnitureType('Oak Bed')).toBe('bed');
        expect(ObjectActions.inferFurnitureType('Ale Barrel')).toBe('barrel');
        expect(ObjectActions.inferFurnitureType('Bar Counter')).toBe('bar');
        expect(ObjectActions.inferFurnitureType('Tall Bookshelf')).toBe('bookshelf');
        expect(ObjectActions.inferFurnitureType('Iron Anvil')).toBe('anvil');
        expect(ObjectActions.inferFurnitureType('Mossy Rock')).toBeNull();
    });

    it('service actions are unavailable outside a settlement', () => {
        const game = {
            player: { q: 0, r: 0, gold: 100, inventory: {} },
            world: { getTile: () => ({ settlement: null }) },
            ui: {},
        };
        const items = ObjectActions.buildFurnitureMenuItems(game, { type: 'stall', name: 'Stall' }, { type: 'marketplace' }, 1, 1);
        expect(items[0].type).toBe('disabled');
        // A stall's goods can still be looked over (and lifted) without a market around
        expect(items.map(i => i._objectActionKey).filter(Boolean)).toEqual(['look_inside']);

        game.world.getTile = () => ({ settlement: { name: 'Ashford' } });
        const open = ObjectActions.buildFurnitureMenuItems(game, { type: 'stall', name: 'Stall' }, { type: 'marketplace' }, 1, 1);
        expect(open[0].action).toBe('obj_action_shop');
    });
});

describe('furniture offers: the new pieces and what stands on them', () => {
    it('chairs, benches and stools seat you; a washstand washes, a tub bathes', () => {
        for (const t of ['chair', 'bench', 'stool']) expect(keysFor(t, { type: 'house' })).toContain('sit');
        expect(keysFor('washstand', { type: 'house', isPlayerOwned: true })).toEqual(['wash_basin']);
        expect(keysFor('tub', { type: 'house', isPlayerOwned: true })).toEqual(['bathe_tub']);
        expect(keysFor('oven', { type: 'house' })).toContain('warm');
        // the bathhouse's tub is its paid bath; an inn's washstand its own bath service
        expect(keysFor('tub', { type: 'bathhouse' })).toEqual(['public_bath']);
        expect(keysFor('washstand', { type: 'inn' })).toEqual(['bathe_here']);
    });

    it('cupboards, dressers, wardrobes, baskets and stores open as containers', () => {
        for (const t of ['dresser', 'cupboard', 'wardrobe', 'basket', 'sack_pile', 'crate_stack', 'barrel_rack', 'firewood']) {
            expect(Containers.isContainer(t), t).toBe(true);
            expect(keysFor(t, { type: 'house' }), t).toContain('look_inside');
            expect(Containers.table({ furnitureType: t, building: { type: 'house' } }).length, t).toBeGreaterThan(0);
            for (const row of Containers.table({ furnitureType: t, building: { type: 'house' } })) {
                if (row[0][0] !== '@') expect(Containers.good(row[0]).basePrice, `${t}: ${row[0]}`).toBeGreaterThan(0);
            }
        }
        // a manor's wardrobe holds finer things than a cottage's
        const manor = Containers.table({ furnitureType: 'wardrobe', building: { type: 'manor' } }).map(r => r[0]);
        expect(manor).toContain('fine_garments');
    });

    it("helping yourself from someone's cupboard is theft; from your own, it's yours", () => {
        const ctx = { worldQ: 1, worldR: 1, q: 2, r: 2, furnitureType: 'cupboard', building: { type: 'house', q: 3, r: 3 }, inSettlement: true };
        expect(Containers.access(ctx)).toBe('steal');
        expect(Containers.access({ ...ctx, building: { ...ctx.building, isPlayerOwned: true } })).toBe('own');
        // (your own cupboard opens as storage, not "look inside")
        expect(keysFor('cupboard', { type: 'house', isPlayerOwned: true })).not.toContain('look_inside');
    });

    it('books on a table offer a read; mugs on a tavern table a drink; nothing stood there, nothing extra', () => {
        expect(keysFor('table', { type: 'house' }, { type: 'table', _decor: ['books', 'candles'] })).toContain('read');
        expect(keysFor('table', { type: 'house' }, { type: 'table' })).not.toContain('read');
        expect(keysFor('table', { type: 'tavern' }, { type: 'table', _decor: [{ type: 'mugs' }] })).toContain('drink');
        // (mugs in a house are the household's: no ale for sale)
        expect(keysFor('table', { type: 'house' }, { type: 'table', _decor: 'mugs' })).not.toContain('drink');
        expect(FurnitureActions.decor({ _decor: { items: ['books', { kind: 'papers' }] } })).toEqual(['books', 'papers']);
        expect(FurnitureActions.decor({})).toEqual([]);
    });

    it("a tavern table serves the house's hot meal", () => {
        expect(keysFor('table', { type: 'tavern' })).toContain('order_meal');
    });
});

describe('sit a while', () => {
    it('energy and comfort come by the hour sat, capped, nothing for a moment', () => {
        const S = FurnitureActions.cfg('sit');
        expect(FurnitureActions.sitGains(1)).toEqual(Object.fromEntries(Object.entries(S.perHour).filter(([, v]) => v)));
        expect(FurnitureActions.sitGains(50)).toEqual(FurnitureActions.sitGains(S.maxHours));
        expect(FurnitureActions.sitGains(1 / 60)).toEqual({});
        const p = mockPlayer();
        const res = FurnitureActions.standUp(p, { since: 100 }, 102);
        expect(res.hours).toBe(2);
        expect(p.needs.energy).toBe(50 + S.perHour.energy * 2);
        expect(p.needs.comfort).toBe(50 + S.perHour.comfort * 2);
        expect(res.text).toMatch(/2 hours/);
    });

    it('the player stays sat (the frame held) until they move, then the seat is settled', () => {
        const tiles = [];
        for (let r = 0; r < 5; r++) {
            tiles[r] = [];
            for (let q = 0; q < 5; q++) tiles[r][q] = { q, r, subTerrain: { id: 'floor', passable: true } };
        }
        tiles[2][2]._furniture = { type: 'chair', name: 'Chair' };
        tiles[2][2].subTerrain = { id: 'furniture_chair', passable: false };
        Object.assign(InnerMap, { tiles, width: 5, height: 5, active: true, npcs: [], playerInnerQ: 2, playerInnerR: 3, _climb: null });
        InnerMap.startInteraction(2, 2, null, 0, 'sitting');
        let stood = null;
        InnerMap.seatPlayer({ q: 2, r: 2, type: 'chair', since: 0, onStand: s => { stood = s; } });
        expect(InnerMap.isPlayerSeated()).toBe(true);
        // a long while: still sat (the moment's 3 seconds no longer end it)
        expect(InnerMap.updateInteraction(60)).toBe(null);
        expect(InnerMap._activeInteraction.held).toBe(true);
        InnerMap.movePlayer(1, 0);
        expect(stood && stood.type).toBe('chair');
        expect(InnerMap.isPlayerSeated()).toBe(false);
        expect(InnerMap._activeInteraction).toBe(null);
    });

    it('a chair is sat on, facing the way it is set', () => {
        expect(InnerMap.FURNITURE_ACTIVITIES.chair.on).toBe('sit');
        expect(InnerMap._pieceFacing({ type: 'chair', facing: 'left' })).toBe(1);
        expect(InnerMap._pieceFacing({ type: 'bed', facing: 'left' })).toBe(2);
    });
});

describe('beds: your own, a room you took, or a trespass', () => {
    const house = { type: 'house', q: 4, r: 4, name: 'Cottage' };
    const inn = { type: 'inn', q: 5, r: 5, name: 'The Gilded Goose', establishmentId: 'h1' };

    it("your own bed is yours; a stranger's is not (with the reason), but Sleep Here Anyway is there", () => {
        const p = mockPlayer();
        expect(FurnitureActions.check('sleep', { player: p, building: { ...house, isPlayerOwned: true } }).ok).toBe(true);
        const theirs = FurnitureActions.check('sleep', { player: p, building: house });
        expect(theirs.ok).toBe(false);
        expect(theirs.reason).toMatch(/isn't your bed/i);
        expect(FurnitureActions.check('sleep_trespass', { player: p, building: house }).ok).toBe(true);
        // offered the bed: sleep openly, no trespass
        expect(FurnitureActions.check('sleep', { player: p, building: house, permitted: true }).ok).toBe(true);
        expect(FurnitureActions.check('sleep_trespass', { player: p, building: house, permitted: true }).ok).toBe(false);
    });

    it("an inn's beds are let: take a room first; the room you took is yours tonight, as good as its tier", () => {
        const world = { day: 30 };
        const p = mockPlayer();
        expect(keysFor('bed', inn, null, p, world)).toEqual(['take_room']);
        expect(FurnitureActions.check('sleep', { player: p, world, building: inn }).reason).toMatch(/room first/i);
        p.lodging = { id: 'h1', name: inn.name, tier: 'suite', night: 30, services: [] };
        expect(keysFor('bed', inn, null, p, world)).toEqual(['sleep', 'take_room']);
        const a = FurnitureActions.bedAccess({ player: p, world, building: inn });
        expect(a.mode).toBe('rented');
        expect(a.mult).toBeGreaterThan(1);
        p.lodging.tier = 'common';
        expect(FurnitureActions.bedAccess({ player: p, world, building: inn }).mult).toBeLessThan(1);
        // a room at another house isn't this one
        p.lodging.id = 'h2';
        expect(FurnitureActions.bedAccess({ player: p, world, building: inn }).mode).toBe('lodging');
    });

    it('the odds of being found: the owner at home and onlookers raise them, the bounds hold', () => {
        const p = mockPlayer();
        const lone = FurnitureActions.trespassOdds(p, {}, 14);
        const watched = FurnitureActions.trespassOdds(p, { witnesses: 2, ownerInside: true }, 14);
        expect(watched).toBeGreaterThan(lone);
        expect(FurnitureActions.trespassOdds(p, { witnesses: 20, ownerInside: true }, 23)).toBeLessThanOrEqual(FurnitureActions.cfg('sleep').trespassOdds.max);
    });
});

describe('a night in a stranger\'s bed (a real world)', () => {
    let world, player, town;
    beforeAll(() => {
        ({ world, player } = newGame(4242, { terrainGen: 3 }));
        town = world.tiles.flat().find(t => t.settlement && t.settlement.kingdom);
    });

    it('found: no sleep, a fine into the town, standing lost, a caught trespass on the charge sheet', () => {
        const ctx = { building: { type: 'house', q: 1, r: 1 }, kingdom: town.settlement.kingdom, worldQ: town.q, worldR: town.r, hour: 23, scene: { ownerInside: true, ownerName: 'Old Wat' } };
        player.gold = 200;
        player.reputation[town.settlement.kingdom] = 10;
        const charges = (Underworld.ensure(player).charges || []).length;
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        const res = FurnitureActions.trespassSleep(player, world, ctx, 8);
        expect(res.caught).toBe(true);
        expect(res.fine).toBeGreaterThan(0);
        expect(player.gold).toBe(200 - res.fine);
        expect(player.reputation[town.settlement.kingdom]).toBeLessThan(10);
        expect(res.text).toMatch(/Old Wat/);
        const st = Underworld.ensure(player);
        expect(st.charges.length).toBe(charges + 1);
        expect(st.charges[st.charges.length - 1]).toMatchObject({ crime: 'trespass', caught: true });
    });

    it('unseen: you sleep (less well than in your own), and the realm half knows of it', () => {
        const ctx = { building: { type: 'house', q: 1, r: 1 }, kingdom: town.settlement.kingdom, worldQ: town.q, worldR: town.r, hour: 14, scene: {} };
        const gold = player.gold;
        vi.spyOn(Utils, 'random').mockReturnValue(0.99);
        const res = FurnitureActions.trespassSleep(player, world, ctx, 8);
        expect(res.caught).toBe(false);
        expect(res.mult).toBeLessThan(1);
        expect(player.gold).toBe(gold);
    });

    it("a tavern table's hot meal is paid at the tavern's price (or refused when the purse is short)", () => {
        const p = mockPlayer({ gold: 100 });
        const ctx = { player: p, world, tile: town, building: { type: 'tavern', q: 1, r: 1 } };
        expect(FurnitureActions.check('order_meal', ctx).ok).toBe(true);
        const res = FurnitureActions.apply('order_meal', ctx);
        expect(res.ok).toBe(true);
        expect(p.gold).toBe(100 - FurnitureActions.cfg('order_meal').cost);
        expect(p.needs.hunger).toBeGreaterThan(40);
        expect(res.hours).toBeGreaterThan(0);
        const poor = mockPlayer({ gold: 2 });
        const no = FurnitureActions.check('order_meal', { ...ctx, player: poor });
        expect(no.ok).toBe(false);
        expect(no.reason).toMatch(/gold/);
        // (no town around: no tavern's kitchen)
        expect(FurnitureActions.check('order_meal', { ...ctx, tile: null }).ok).toBe(false);
    });
});

describe('warm up at a lit fire', () => {
    it('dries the wet out of your clothes, takes the chill off, and warms you', () => {
        const p = mockPlayer({ wetness: 80, _soakedColdHours: 1.5 });
        const res = FurnitureActions.apply('warm', { player: p, type: 'fireplace', furniture: { type: 'fireplace', name: 'Hearth' } });
        expect(res.ok).toBe(true);
        expect(p.wetness).toBe(80 - FurnitureActions.cfg('warm').dry);
        expect(p._soakedColdHours).toBe(0);
        expect(p.needs.comfort).toBeGreaterThan(50 + FurnitureActions.cfg('warm').effects.comfort);
        expect(res.hours).toBe(FurnitureActions.cfg('warm').hours);
        expect(res.text).toMatch(/hearth/);
    });

    it('a cold hearth gives no warmth (greyed out, with the reason)', () => {
        const p = mockPlayer({ wetness: 50 });
        const c = FurnitureActions.check('warm', { player: p, furniture: { type: 'fireplace', lit: false } });
        expect(c.ok).toBe(false);
        expect(c.reason).toMatch(/fire is out/i);
        expect(FurnitureActions.apply('warm', { player: p, furniture: { type: 'fireplace', lit: false } }).ok).toBe(false);
        expect(p.wetness).toBe(50);
    });
});

describe('eating at your own table', () => {
    it('sits you down to the best of what the house has put by', () => {
        const p = mockPlayer();
        const stores = [{ wood: 4 }, { bread: 1, apples: 3 }];
        const ctx = { player: p, building: { type: 'house', isPlayerOwned: true }, homeStores: stores, foodTable: FOOD_ITEMS };
        expect(FurnitureActions.check('eat_home', ctx).ok).toBe(true);
        const res = FurnitureActions.apply('eat_home', ctx);
        expect(res.food).toBe('bread');
        expect(stores[1].bread).toBeUndefined();
        expect(p.needs.hunger).toBe(40 + FOOD_ITEMS.bread.hunger);
        // next the apples; then nothing
        expect(FurnitureActions.apply('eat_home', ctx).food).toBe('apples');
        stores[1] = {};
        expect(FurnitureActions.check('eat_home', ctx).reason).toMatch(/nothing to eat/i);
    });

    it("not at someone else's table", () => {
        const c = FurnitureActions.check('eat_home', { player: mockPlayer(), building: { type: 'house' }, homeStores: [{ bread: 3 }] });
        expect(c.ok).toBe(false);
    });
});

describe('washing: a basin, a bath', () => {
    it('a washstand gives a quick wash, less than a bath', () => {
        const a = mockPlayer();
        const b = mockPlayer();
        const own = { type: 'house', isPlayerOwned: true };
        const basin = FurnitureActions.apply('wash_basin', { player: a, building: own });
        const bath = FurnitureActions.apply('bathe_tub', { player: b, building: own });
        expect(basin.ok && bath.ok).toBe(true);
        expect(a.needs.hygiene - 30).toBe(FurnitureActions.cfg('wash_basin').effects.hygiene);
        expect(b.needs.hygiene - 30).toBeGreaterThan(a.needs.hygiene - 30);
        expect(basin.hours).toBeLessThan(bath.hours);
    });

    it('a bath scrubs grubby clothes and uses a cake of soap from the pack', () => {
        const p = mockPlayer({ inventory: { soap: 1 }, clothesFreshness: 20 });
        const res = FurnitureActions.apply('bathe_tub', { player: p, building: { type: 'house', isPlayerOwned: true } });
        expect(res.soap).toBe(true);
        expect(res.clothes).toBeGreaterThan(0);
        expect(p.inventory.soap).toBe(0);
        expect(p.needs.hygiene).toBe(30 + FurnitureActions.cfg('bathe_tub').effects.hygiene + 15);
    });

    it("the household's washstand and tub are theirs; a public bathhouse's basin is anyone's", () => {
        const p = mockPlayer();
        const c = FurnitureActions.check('wash_basin', { player: p, building: { type: 'house' } });
        expect(c.ok).toBe(false);
        expect(c.reason).toMatch(/washstand/);
        expect(FurnitureActions.check('bathe_tub', { player: p, building: { type: 'manor' } }).ok).toBe(false);
        expect(FurnitureActions.check('wash_basin', { player: p, building: { type: 'bathhouse' } }).ok).toBe(true);
        expect(FurnitureActions.apply('wash_basin', { player: p, building: { type: 'house' } }).ok).toBe(false);
        expect(p.needs.hygiene).toBe(30);
    });
});

describe('the menu greys out what you may not do, and says why', () => {
    function inside(building, furniture) {
        const tiles = [[{ q: 0, r: 0, _furniture: furniture, subTerrain: { passable: false } }]];
        Object.assign(InnerMap, { tiles, width: 1, height: 1, active: true, npcs: [], _insideBuilding: building, currentWorldTile: { q: 0, r: 0 }, timeOfDay: 14 });
        return {
            player: mockPlayer(),
            world: { day: 10, getTile: () => ({ q: 0, r: 0, settlement: null }) },
            ui: {},
        };
    }

    it("a stranger's bed: Sleep greyed out, Sleep Here Anyway with the odds", () => {
        const bed = { type: 'bed', name: 'Bed' };
        const game = inside({ type: 'house', q: 2, r: 2 }, bed);
        const items = ObjectActions.buildFurnitureMenuItems(game, bed, InnerMap._insideBuilding, 0, 0);
        const sleep = items.find(i => /Sleep$/.test(i.label));
        expect(sleep.type).toBe('disabled');
        expect(sleep.desc).toMatch(/isn't your bed/i);
        const tres = items.find(i => i._objectActionKey === 'sleep_trespass');
        expect(tres.type).toBe('action');
        expect(tres.desc).toMatch(/\d+% someone finds you/);
    });

    it('an unlit hearth: Warm Up greyed out; your own washstand: Wash at the Basin ready', () => {
        const hearth = { type: 'fireplace', name: 'Hearth', lit: false };
        const game = inside({ type: 'house', q: 2, r: 2 }, hearth);
        const warm = ObjectActions.buildFurnitureMenuItems(game, hearth, InnerMap._insideBuilding, 0, 0).find(i => /Warm Up/.test(i.label));
        expect(warm.type).toBe('disabled');
        const ws = { type: 'washstand', name: 'Washstand' };
        const g2 = inside({ type: 'house', q: 2, r: 2, isPlayerOwned: true }, ws);
        const wash = ObjectActions.buildFurnitureMenuItems(g2, ws, InnerMap._insideBuilding, 0, 0).find(i => i._objectActionKey === 'wash_basin');
        expect(wash && wash.type).toBe('action');
    });
});

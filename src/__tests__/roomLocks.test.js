// Locked rooms at an inn (systems/roomLocks.js, world/innerMap/guestRooms.js):
// the let rooms' doors are locked but for the one your key opens, the key
// comes with a private room and goes back in the morning, your own house
// opens every door, a door can be picked (success, a hold, heard → fined,
// thrown out and barred), a picked door stays open the day, and all of it
// survives a save. Run on a real generated world and a planned inn interior.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Utils } from '../core/utils.js';
import { Hospitality } from '../systems/hospitality.js';
import { RoomLocks } from '../systems/roomLocks.js';
import { Locks } from '../systems/locks.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Player } from '../player/player.js';
import { InnerMap } from '../world/innerMap.js';
import { loadData, newGame } from './playtest/harness.js';

let game, town, house;
beforeAll(async () => {
    await loadData();
    game = newGame(4242);
    const { world } = game;
    town = world.getSettlementViews().find(s => Hospitality.townHouses(world, s.q, s.r).some(h => h.kind === 'inn'));
    house = Hospitality.townHouses(game.world, town.q, town.r).find(h => h.kind === 'inn');
}, 60000);

beforeEach(() => {
    const { world, player } = game;
    world.day = 40;
    player.gold = 5000;
    player.lodging = null;
    player._restTypeOverride = null;
    player.pickedDoors = {};
    player.innBans = {};
    player.financeToday = { income: {}, expenses: {} };
    PracticeSkills.setLevel(player, 'lockpicking', 6);
});
afterEach(() => {
    vi.restoreAllMocks();
    if (InnerMap._insideBuilding) InnerMap.exitBuilding(game);
});

/** Walk into the town's inn (planned, every floor), as the inner map does. */
function enterInn(over = {}) {
    InnerMap.active = true;
    InnerMap._insideBuilding = null;
    InnerMap.currentWorldTile = { q: town.q, r: town.r };
    InnerMap._currentWorldTileRef = game.world.getTile(town.q, town.r);
    InnerMap.tiles = [[{ q: 0, r: 0, subTerrain: { passable: true } }]];
    InnerMap.width = 1; InnerMap.height = 1;
    InnerMap.npcs = []; InnerMap.buildings = []; InnerMap.roads = [];
    InnerMap._interiorCache = {};
    const b = { type: 'inn', name: house.name, q: 21, r: 13, establishmentId: house.id, ownerName: house.keeper, ownerTitle: 'Innkeeper', ...over };
    expect(InnerMap.enterBuilding(b, game)).toBe(true);
    return b;
}

const doorTile = d => InnerMap.tiles[d.r][d.q];
const atFloor = (k) => { InnerMap._floor = k; InnerMap.tiles = InnerMap._floorInterior(k).tiles; };

describe('the rooms and their numbers', () => {
    it('let rooms and the kitchen are locked; the common room and landings are not', () => {
        expect(RoomLocks.roomKind('guest_2')).toBe('guest');
        expect(RoomLocks.roomKind('suite')).toBe('guest');
        expect(RoomLocks.roomKind('kitchen')).toBe('staff');
        expect(RoomLocks.roomKind('main')).toBeNull();
        expect(RoomLocks.roomKind('bunks')).toBeNull();
        expect(RoomLocks.roomKind('baths')).toBeNull();
        expect(RoomLocks.appliesTo({ type: 'inn' })).toBe(true);
        expect(RoomLocks.appliesTo({ type: 'player_hotel' })).toBe(true);
        expect(RoomLocks.appliesTo({ type: 'tavern' })).toBe(false);
    });

    it('numbers the let rooms by floor: 1, 2… below, 21, 22… on the 2nd floor; staff rooms none', () => {
        const doors = RoomLocks.numberDoors([
            { floor: 1, roomId: 'guest_2', kind: 'guest' }, { floor: 0, roomId: 'kitchen', kind: 'staff' },
            { floor: 0, roomId: 'guest_1', kind: 'guest' }, { floor: 1, roomId: 'guest_1', kind: 'guest' }, { floor: 0, roomId: 'guest_2', kind: 'guest' },
        ]);
        expect(doors.map(d => d.no)).toEqual([22, undefined, 1, 21, 2]);
    });

    it('an inn\'s doors are found on every floor, numbered, and locked to a stranger', () => {
        enterInn();
        const doors = InnerMap._guestDoors;
        expect(doors.length).toBeGreaterThan(2);
        expect(doors.some(d => d.floor > 0)).toBe(true);
        expect(doors.filter(d => d.kind === 'guest').every(d => Number.isFinite(d.no))).toBe(true);
        expect(new Set(doors.map(d => d.key)).size).toBe(doors.length);
        for (const d of doors) expect(InnerMap.guestDoorLocked(d)).toBe(true);
        const d0 = doors.find(d => d.floor === 0);
        expect(InnerMap._playerMayEnter(doorTile(d0), d0.q, d0.r)).toBe(false);
        // (the common room's floor is no door)
        expect(InnerMap.guestDoorAt(InnerMap.playerInnerQ, InnerMap.playerInnerR)).toBeNull();
    });
});

describe('your key', () => {
    it('a private room hands you one room\'s key; the rest stay locked; a bunk gets none', () => {
        const { world, player } = game;
        const res = Hospitality.book(world, player, house.id, 'private');
        expect(res.ok).toBe(true);
        expect(res.text).toMatch(/key/);
        enterInn();
        const mine = InnerMap.yourGuestRoom();
        expect(mine && Number.isFinite(mine.no)).toBe(true);
        expect(player.lodging.room.key).toBe(mine.key);
        const doors = InnerMap._guestDoors;
        const yours = doors.find(d => d.key === mine.key);
        expect(InnerMap.guestDoorLocked(yours)).toBe(false);
        expect(doors.filter(d => d !== yours).every(d => InnerMap.guestDoorLocked(d))).toBe(true);
        expect(doors.find(d => d.kind === 'staff') ? InnerMap.guestDoorLocked(doors.find(d => d.kind === 'staff')) : true).toBe(true);
        // You can walk through your own door (on its floor)
        atFloor(yours.floor);
        expect(InnerMap._playerMayEnter(doorTile(yours), yours.q, yours.r)).toBe(true);
        // The same room every time you ask, that night
        InnerMap.exitBuilding(game);
        enterInn();
        expect(InnerMap.yourGuestRoom().key).toBe(mine.key);

        player.lodging = null;
        expect(Hospitality.book(world, player, house.id, 'common').ok).toBe(true);
        expect(RoomLocks.yourRoom(player, world, house.id, doors)).toBeNull();
    });

    it('the key goes back with the booking in the morning, and the door locks again', () => {
        const { world, player } = game;
        Hospitality.book(world, player, house.id, 'private');
        enterInn();
        const mine = InnerMap.yourGuestRoom();
        const yours = InnerMap._guestDoors.find(d => d.key === mine.key);
        InnerMap.exitBuilding(game);
        world.day += 1;
        const out = Hospitality.processDay(world, player);
        expect(player.lodging).toBeNull();
        expect(out.notices.some(n => /hand back the key of No\. \d+/.test(n.text))).toBe(true);
        expect(RoomLocks.lockedFor(player, world, { houseId: house.id, door: yours })).toBe(true);
    });

    it('in your own house every door opens', () => {
        enterInn({ type: 'player_inn', isPlayerOwned: true, establishmentId: 'p:1,1:inn' });
        expect(InnerMap._guestDoors.length).toBeGreaterThan(0);
        for (const d of InnerMap._guestDoors) expect(InnerMap.guestDoorLocked(d)).toBe(false);
    });
});

describe('picking a room\'s lock', () => {
    const ctxOf = (d, extra = {}) => ({ ...InnerMap.guestDoorCtx(d), keeper: house.keeper, kingdom: null, ...extra });

    it('an inn\'s room lock is easier than a manor\'s door; the kitchen\'s a step harder', () => {
        expect(RoomLocks.doorLock('inn', 'guest').difficulty).toBeLessThan(Locks.doorLock({ type: 'manor' }).difficulty);
        expect(RoomLocks.doorLock('inn', 'staff').difficulty).toBe(RoomLocks.doorLock('inn', 'guest').difficulty + 1);
        expect(RoomLocks.doorLock('hotel').difficulty).toBeGreaterThan(RoomLocks.doorLock('guest_house').difficulty);
    });

    it('success opens the door for the day; the keeper may lock it on your way out; tomorrow it is locked', () => {
        const { world, player } = game;
        enterInn();
        const d = InnerMap._guestDoors.find(x => x.kind === 'guest' && x.floor === 0) || InnerMap._guestDoors[0];
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        const res = RoomLocks.pick(player, world, ctxOf(d), {});
        expect(res.ok).toBe(true);
        expect(player.pickedDoors[d.key]).toBe(world.day);
        expect(InnerMap.guestDoorLocked(d)).toBe(false);
        atFloor(d.floor);
        expect(InnerMap._playerMayEnter(doorTile(d), d.q, d.r)).toBe(true);
        // (the keeper's rounds: by a hash, each door the same way)
        const relocked = RoomLocks.relockOnLeave(player, world, house.id);
        expect(relocked.length === 0 || relocked[0] === d.key).toBe(true);
        player.pickedDoors[d.key] = world.day;
        world.day += 1;
        Hospitality.processDay(world, player);
        expect(player.pickedDoors[d.key]).toBeUndefined();
    });

    it('a lock that holds unheard costs time and nothing else', () => {
        const { world, player } = game;
        enterInn();
        const d = InnerMap._guestDoors[0];
        const gold = player.gold;
        vi.spyOn(Utils, 'random').mockReturnValueOnce(0.99).mockReturnValueOnce(0.99);
        const res = RoomLocks.pick(player, world, ctxOf(d), {});
        expect(res.ok).toBe(false);
        expect(res.noticed).toBe(false);
        expect(res.minutes).toBeGreaterThan(0);
        expect(player.gold).toBe(gold);
        expect(InnerMap.guestDoorLocked(d)).toBe(true);
    });

    it('heard: fined, the booking forfeit, thrown out and barred from the house', () => {
        const { world, player } = game;
        Hospitality.book(world, player, house.id, 'private');
        enterInn();
        const mine = InnerMap.yourGuestRoom();
        const d = InnerMap._guestDoors.find(x => x.key !== mine.key);
        const gold = player.gold;
        vi.spyOn(Utils, 'random').mockReturnValueOnce(0.99).mockReturnValueOnce(0.0);
        const res = RoomLocks.pick(player, world, ctxOf(d), { witnesses: 2 });
        expect(res.caught).toBe(true);
        expect(res.thrownOut).toBe(true);
        expect(res.fine).toBeGreaterThan(0);
        expect(player.gold).toBe(gold - res.fine);
        expect(player.lodging).toBeNull();
        expect(RoomLocks.bannedUntil(player, world, house.id)).toBe(world.day + res.banDays);
        // The house won't let you a room, nor in at the door
        const q = Hospitality.quote(world, player, house.id);
        expect(q.tiers.every(t => !t.ok && /barred/.test(t.reason))).toBe(true);
        InnerMap.exitBuilding(game);
        InnerMap._insideBuilding = null;
        expect(InnerMap.enterBuilding({ type: 'inn', name: house.name, q: 21, r: 13, establishmentId: house.id }, game)).toBe(false);
        expect(InnerMap._entryRefused.text).toMatch(/Barred/);
        // ...until the ban runs out
        world.day += res.banDays;
        Hospitality.processDay(world, player);
        expect(RoomLocks.bannedUntil(player, world, house.id)).toBeNull();
    });

    it('walking in on a guest who is up is as good as heard; one asleep sleeps on', () => {
        const { world, player } = game;
        enterInn();
        const d = InnerMap._guestDoors[0];
        vi.spyOn(Utils, 'random').mockReturnValue(0.01);
        const up = RoomLocks.pick(player, world, ctxOf(d, { occupants: [{ name: 'Wat', asleep: false }] }), {});
        expect(up.ok).toBe(true);
        expect(up.caught).toBe(true);
        expect(up.walkedIn).toBe('Wat');
        player.innBans = {};
        player.pickedDoors = {};
        const asleep = RoomLocks.pick(player, world, ctxOf(d, { occupants: [{ name: 'Wat', asleep: true }] }), {});
        expect(asleep.caught).toBeFalsy();
        expect(asleep.text).toMatch(/sleeps on/);
        expect(RoomLocks.knock(player, world, d, [{ name: 'Wat', asleep: false }]).answered).toBe(true);
        expect(RoomLocks.knock(player, world, d, []).text).toMatch(/out/);
    });

    it('beyond your reach you won\'t try', () => {
        const { world, player } = game;
        PracticeSkills.setLevel(player, 'lockpicking', 1);
        const res = RoomLocks.pick(player, world, { houseId: 'h', kind: 'hotel', door: { key: 'h|0|suite', kind: 'staff', no: 1 } }, {});
        if (RoomLocks.doorLock('hotel', 'staff').difficulty > Locks.reach(player)) expect(res.beyond).toBe(true);
    });
});

describe('saved', () => {
    it('the booked room, the picked doors and the bans round-trip with the player', () => {
        const p = new Player();
        p.lodging = { id: 'h1', name: 'The Bell', kind: 'inn', tier: 'private', night: 40, services: [], room: { key: 'h1|1|guest_2', no: 12, floor: 1 } };
        p.pickedDoors = { 'h1|0|guest_1': 40 };
        p.innBans = { h2: 48 };
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.lodging.room).toEqual({ key: 'h1|1|guest_2', no: 12, floor: 1 });
        expect(back.pickedDoors).toEqual({ 'h1|0|guest_1': 40 });
        expect(back.innBans).toEqual({ h2: 48 });
    });
});

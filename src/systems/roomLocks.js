// ============================================
// ROOM LOCKS — the let rooms of inns, hotels, guest houses and roadhouses
// ============================================
//
// Inside a house of hospitality (systems/hospitality.js) the rooms carved off
// the common room (world/innerMap/interiorPlanner.js, data/interiorPlans.json)
// are let to paying guests, so their doors are kept locked: which rooms are
// let ('guest') and which are the staff's ('staff': the kitchen) is data
// (data/hospitality.json config.roomLocks.rooms, by the planner's room id).
// The common room, a roadhouse's bunk room, a hotel's bath room and the
// landings stay open. World/innerMap/guestRooms.js finds each such room's
// doorway on every floor and numbers the let rooms (No. 1, 2… on the ground
// floor, No. 21, 22… on the 2nd floor, No. 31… on the 3rd).
//
// Booking a private room or a suite (Hospitality.book) hands you a key: the
// first time you are inside the house that night `yourRoom` picks the room
// (a hash of the world seed, the night and the house; a suite prefers a room
// the planner calls a suite) and keeps it on the booking
// (player.lodging.room = { key, no }, saved with the lodging). The key goes
// back with the booking in the morning (Hospitality._morning). Your own house:
// every door opens for you.
//
// Any other let room's door can be picked (`pick`, through Locks.attempt; the
// door's difficulty by kind from data/skillPacks/social.json
// lockpicking.locks.roomDoors, staff doors a step harder). A picked door stays
// open the rest of the day (player.pickedDoors[key] = day, saved; the
// morning's Hospitality.processDay locks them again), unless the
// keeper finds it open when you leave (`relockOnLeave`, a hash roll). Heard
// at it — or walking in on a guest who is awake — is Locks' heard path (a
// fine, standing, a caught theft on the Underworld record) and the keeper
// throws you out: your booking here forfeit and the house barred to you for
// some days (player.innBans[houseId] = until day; Hospitality.quote refuses
// you, the door turns you away).
//
// Randomness: the attempt and the noticing draw from Utils.random (as Locks
// does); the room you are given, the keeper's relocking and the ban's length
// from hashes. World / player are passed in; no import-time effects.

import { Utils } from '../core/utils.js';
import { Hospitality } from './hospitality.js';
import { Locks } from './locks.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _bare = t => String(t || '').replace(/^player_/, '');

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _u(str) {
    return (Utils.hashStr(String(str)) >>> 0) / 4294967296;
}

export const RoomLocks = {
    cfg() {
        const o = (Hospitality.data().config || {}).roomLocks || {};
        return {
            kinds: Array.isArray(o.kinds) ? o.kinds : ['inn', 'hotel', 'guest_house', 'roadhouse'],
            rooms: o.rooms || { guest: 'guest', suite: 'guest', kitchen: 'staff' },
            keyTiers: Array.isArray(o.keyTiers) ? o.keyTiers : ['private', 'suite'],
            tierRooms: o.tierRooms || { suite: ['suite'] },
            relock: _num(o.relock, 0.35),
            banDays: Array.isArray(o.banDays) ? o.banDays : [4, 10],
            perFloor: Math.max(2, _num(o.perFloor, 10)),
        };
    },

    /** Is this building a house whose rooms are let (by its type)? */
    appliesTo(building) {
        return !!building && RoomLocks.cfg().kinds.includes(_bare(building.type));
    },

    /** What a planner room id ('guest_2', 'kitchen', 'suite') is here: 'guest' | 'staff' | null (open). */
    roomKind(roomId) {
        if (!roomId || roomId === 'main') return null;
        const base = String(roomId).replace(/_\d+$/, '');
        const k = RoomLocks.cfg().rooms[base];
        return k === 'guest' || k === 'staff' ? k : null;
    },

    /** The key of a room's door: the house, the floor, the planner's room id. */
    doorKey(houseId, floor, roomId) {
        return `${houseId}|${floor}|${roomId}`;
    },

    /**
     * Number a house's let rooms in place: by floor, then the order the
     * planner carved them — No. 1… on the ground floor, No. 21… on the
     * 2nd floor (the floor above the ground). Staff rooms get none. doors: [{ floor, roomId, kind }]
     */
    numberDoors(doors) {
        const per = RoomLocks.cfg().perFloor;
        const byFloor = {};
        for (const d of doors || []) if (d.kind === 'guest') (byFloor[d.floor] = byFloor[d.floor] || []).push(d);
        const order = id => { const m = /_(\d+)$/.exec(String(id)); return m ? Number(m[1]) : 0; };
        for (const [k, list] of Object.entries(byFloor)) {
            list.sort((a, b) => String(a.roomId).replace(/_\d+$/, '').localeCompare(String(b.roomId).replace(/_\d+$/, '')) || order(a.roomId) - order(b.roomId));
            list.forEach((d, i) => { d.no = (Number(k) > 0 ? (Number(k) + 1) * per : 0) + i + 1; });
        }
        return doors;
    },

    /** The player's booking at this house that still holds (tonight's, until the morning clears it). */
    lodgingHere(player, world, houseId) {
        const L = player && player.lodging;
        if (!L || houseId == null || L.id !== houseId) return null;
        if (_num(L.night, -1) < _day(world) - 1) return null;
        return L;
    },

    /** Does that booking come with a key (a private room, a suite)? */
    hasKey(L) {
        return !!L && RoomLocks.cfg().keyTiers.includes(L.tier);
    },

    /**
     * The room the player's key opens here: given out the first time it is
     * asked for (a hash of the seed, the night and the house among the let
     * rooms; a suite booking prefers the rooms its tier names). → { key, no } or null
     */
    yourRoom(player, world, houseId, doors) {
        const L = RoomLocks.lodgingHere(player, world, houseId);
        if (!RoomLocks.hasKey(L)) return null;
        const guest = (doors || []).filter(d => d.kind === 'guest');
        if (L.room && L.room.key && (!guest.length || guest.some(d => d.key === L.room.key))) return L.room;
        if (!guest.length) return null;
        const want = RoomLocks.cfg().tierRooms[L.tier] || [];
        const pref = guest.filter(d => want.includes(String(d.roomId).replace(/_\d+$/, '')));
        const pool = pref.length ? pref : guest;
        const d = pool[Math.floor(_u(`${_seed(world)}|${L.night}|${houseId}|room`) * pool.length)];
        L.room = { key: d.key, no: d.no != null ? d.no : null, floor: d.floor };
        return L.room;
    },

    /** Has the player picked this door today? */
    isPicked(player, world, key) {
        const m = player && player.pickedDoors;
        return !!(m && m[key] === _day(world));
    },

    /**
     * Is this door locked against the player? ctx: { houseId, own, door: { key, kind } }.
     * Open: their own house, the room their key opens, a door they picked today.
     */
    lockedFor(player, world, ctx) {
        const door = ctx && ctx.door;
        if (!door || !door.kind) return false;
        if (ctx.own) return false;
        if (RoomLocks.isPicked(player, world, door.key)) return false;
        if (door.kind === 'guest') {
            const L = RoomLocks.lodgingHere(player, world, ctx.houseId);
            if (L && L.room && L.room.key === door.key) return false;
        }
        return true;
    },

    /** The day the player may come back to this house, or null when they are welcome. */
    bannedUntil(player, world, houseId) {
        const until = player && player.innBans ? player.innBans[houseId] : null;
        return Number.isFinite(until) && until > _day(world) ? until : null;
    },

    /** The lock on a let room's door (by the house's kind; a staff door a step harder). */
    doorLock(kind, doorKind = 'guest') {
        return Locks.roomDoorLock(kind, doorKind);
    },

    /**
     * Try a locked room's door. ctx: { houseId, kind, own, door, building, kingdom,
     * worldQ, worldR, ownerName, keeper, occupants: [{ name, asleep }] }; scene as
     * Locks.attempt takes it. → attempt() + { text, caught, fine, thrownOut, banDays, walkedIn }
     */
    pick(player, world, ctx, scene = {}) {
        if (!RoomLocks.lockedFor(player, world, ctx)) return { ok: true, noticed: false, text: 'The door isn\'t locked to you.' };
        const lock = RoomLocks.doorLock(ctx.kind, ctx.door.kind);
        const what = ctx.door.no != null ? `No. ${ctx.door.no}` : (ctx.door.name || 'the room').toLowerCase();
        if (!lock) return { ok: false, noticed: false, text: 'There is no lock here to pick.' };
        const awake = (ctx.occupants || []).filter(o => o && !o.asleep);
        const res = Locks.attempt(player, lock.difficulty, { ...scene, ownerInside: !!scene.ownerInside || awake.length > 0 });
        if (res.beyond) return { ...res, text: `The door of ${what} has a ${lock.name.toLowerCase()} lock: beyond your skill (you can try locks up to difficulty ${Locks.reach(player)}).` };
        if (res.ok) {
            if (!player.pickedDoors || typeof player.pickedDoors !== 'object') player.pickedDoors = {};
            player.pickedDoors[ctx.door.key] = _day(world);
            if (awake.length) {
                // The door swings in on a guest who is up: they cry thief
                const out = RoomLocks._caught(player, world, ctx, lock, `in at the door of ${what}`);
                return { ...res, ...out, walkedIn: awake[0].name || 'a guest', text: `The lock of ${what} turns — and the door swings in on ${awake[0].name || 'a guest'}, who is on their feet at once: "Thief! Thief in the house!" ${out.text}` };
            }
            const sleeper = (ctx.occupants || []).find(o => o && o.asleep);
            const tail = sleeper ? ` Inside, ${sleeper.name || 'a guest'} sleeps on.` : '';
            return { ...res, text: `After ${res.minutes} minutes' work the ${lock.name.toLowerCase()} lock of ${what} turns. The door is open to you for the rest of the day.${tail}` };
        }
        if (!res.noticed) return { ...res, text: `${res.minutes} minutes at the door of ${what}, and the lock holds. No one seems to have heard.` };
        return { ...res, ...RoomLocks._caught(player, world, ctx, lock, `at the door of ${what}`) };
    },

    /** Caught at a let room: Locks' heard path, then the keeper throws you out and bars the house. */
    _caught(player, world, ctx, lock, where) {
        const heard = Locks._heard(player, world, { ...ctx, ownerName: ctx.ownerName || ctx.keeper || null }, lock, where);
        const [lo, hi] = RoomLocks.cfg().banDays;
        const days = Math.round(lo + (Math.max(lo, hi) - lo) * _u(`${_seed(world)}|${_day(world)}|${ctx.houseId}|ban`));
        if (!player.innBans || typeof player.innBans !== 'object') player.innBans = {};
        player.innBans[ctx.houseId] = _day(world) + days;
        // The booking here is forfeit, and the key taken back
        const L = RoomLocks.lodgingHere(player, world, ctx.houseId);
        let lost = '';
        if (L && !L.own) {
            player.lodging = null;
            if (player._restTypeOverride === 'inn') player._restTypeOverride = null;
            lost = ' Your room is forfeit, and the key taken back.';
        }
        // (and the doors picked here are shut again)
        for (const k of Object.keys(player.pickedDoors || {})) if (k.startsWith(`${ctx.houseId}|`)) delete player.pickedDoors[k];
        const keeper = ctx.keeper || 'The keeper';
        return {
            caught: true, noticed: true, fine: heard.fine, thrownOut: true, banDays: days,
            text: `${heard.text} ${keeper} throws you out into the street: you are not to show your face here for ${days} days.${lost}`,
        };
    },

    /**
     * Leaving the house: the keeper may make the rounds and find a door you
     * picked standing open (a hash roll each). → the keys locked again
     */
    relockOnLeave(player, world, houseId) {
        const m = player && player.pickedDoors;
        if (!m) return [];
        const out = [];
        const share = RoomLocks.cfg().relock;
        for (const [k, day] of Object.entries(m)) {
            if (!k.startsWith(`${houseId}|`)) continue;
            if (day !== _day(world) || _u(`${_seed(world)}|${_day(world)}|${k}|relock`) < share) {
                delete m[k];
                out.push(k);
            }
        }
        return out;
    },

    /**
     * Knock at a locked room. occupants: [{ name, asleep }]. → { text, answered }
     * (a guest who is up answers and sends you off; one asleep, snoring; none, silence)
     */
    knock(player, world, door, occupants = []) {
        const what = door && door.no != null ? `No. ${door.no}` : ((door && door.name) || 'the room').toLowerCase();
        const awake = occupants.find(o => o && !o.asleep);
        if (awake) {
            const lines = ['"Who\'s there? I\'ve paid for the night — leave me be."', '"Wrong door, friend."', '"Not now!"', '"If it\'s the keeper, the water can wait till morning."'];
            const line = lines[Math.floor(_u(`${_seed(world)}|${_day(world)}|${door && door.key}|knock`) * lines.length)];
            return { answered: true, text: `You knock at ${what}. ${awake.name || 'A guest'} opens it a crack. ${line} The door shuts again, and the key turns.` };
        }
        if (occupants.length) return { answered: false, text: `You knock at ${what}. No answer — only slow, heavy snoring from within.` };
        return { answered: false, text: `You knock at ${what}. No answer. Whoever has it is out.` };
    },
};

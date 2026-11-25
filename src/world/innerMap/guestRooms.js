// InnerMap — the let rooms of a house of hospitality, behind their locked doors.
//
// On walking into an inn, a hotel, a guest house or a roadhouse
// (systems/roomLocks.js appliesTo), every floor's rooms carved off its main
// room (world/innerMap/interiorPlanner.js: tile._roomId, the doorway between
// on tile._doorway) are looked over: each let room's or staff room's doorway
// is its door (a WeakMap from the doorway tile, so nothing is written on the
// kept interior), the let rooms numbered. While the player is inside, a door
// locked to them (RoomLocks.lockedFor: not their house, not the room their
// key opens, not picked today) can't be walked through — `_roomLockBlocks`,
// read by _playerMayEnter (world/innerMap/swimming.js) and the player's paths
// (movement.js _findPath) — unless they are already in that room, so no one
// is shut in. Everyone else comes and goes with their keys. On leaving, the
// keeper may find a picked door open and lock it again (relockOnLeave).
// The menu and the picking: ui/innerMapRoomLocks.js.
import { InnerMap } from './_ref.js';
import { RoomLocks } from './_imports.js';

const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

Object.assign(InnerMap, {
    /** The house id (Hospitality's) of a building whose rooms are let, or null. */
    _guestHouseOf(building) {
        if (!building || !RoomLocks.appliesTo(building)) return null;
        return building.establishmentId || null;
    },

    /** The let and staff rooms' doors of one floor's interior. → [{ tile, q, r, outside, floor, roomId, name, kind, key }] */
    _guestDoorsOn(interior, k, houseId) {
        const out = [];
        if (!interior || !interior.tiles) return out;
        const { tiles } = interior;
        const seen = new Set();
        for (let r = 0; r < tiles.length; r++) {
            const row = tiles[r];
            for (let q = 0; row && q < row.length; q++) {
                const t = row[q];
                if (!t || !t._doorway) continue;
                for (const [dq, dr] of D4) {
                    const n = tiles[r + dr] && tiles[r + dr][q + dq];
                    const kind = n && RoomLocks.roomKind(n._roomId);
                    if (!kind || seen.has(n._roomId)) continue;
                    const o = tiles[r - dr] && tiles[r - dr][q - dq];
                    seen.add(n._roomId);
                    out.push({
                        tile: t, q, r, outside: o ? { q: q - dq, r: r - dr } : null, inside: { q: q + dq, r: r + dr },
                        floor: k, roomId: n._roomId, name: n._room || 'Room', kind, key: RoomLocks.doorKey(houseId, k, n._roomId),
                    });
                    break;
                }
            }
        }
        return out;
    },

    /**
     * In at the door (interiors.js enterBuilding): every floor's let rooms
     * found and numbered, the player's key matched to its room.
     */
    _guestRoomsArrive(game) {
        this._roomLockGame = game || null;
        this._guestDoors = null;
        this._guestDoorMap = null;
        const houseId = this._guestHouseOf(this._insideBuilding);
        if (!houseId) return;
        const doors = [];
        const n = Math.max(1, this._floorCount || 1);
        for (let k = 0; k < n; k++) {
            const fi = k === 0 ? (this._floorInteriors && this._floorInteriors[0]) : (this._floorInterior ? this._floorInterior(k) : null);
            if (!fi) continue;
            doors.push(...this._guestDoorsOn(fi, k, houseId));
        }
        if (!doors.length) return;
        RoomLocks.numberDoors(doors);
        this._guestDoors = doors;
        this._guestDoorMap = new WeakMap(doors.map(d => [d.tile, d]));
        if (game && game.player) RoomLocks.yourRoom(game.player, game.world, houseId, doors);
    },

    /** Out of the door: the keeper's rounds (a picked door found open, locked again). → keys relocked */
    _guestRoomsLeave(game) {
        const houseId = this._guestDoors ? this._guestHouseOf(this._insideBuilding) : null;
        const res = houseId && game && game.player ? RoomLocks.relockOnLeave(game.player, game.world, houseId) : [];
        this._guestDoors = null;
        this._guestDoorMap = null;
        this._roomLockGame = null;
        return res;
    },

    /** The room door at (q, r) on the floor shown, or null. */
    guestDoorAt(q, r) {
        const t = this._guestDoorMap && this.tiles && this.tiles[r] && this.tiles[r][q];
        return t ? this._guestDoorMap.get(t) || null : null;
    },

    /** The context RoomLocks takes for a door of the house the player is in. */
    guestDoorCtx(door) {
        const b = this._insideBuilding;
        const own = !!(b && (b.isPlayerOwned || b.isPlayerProperty || String(b.type || '').startsWith('player_')));
        return { houseId: this._guestHouseOf(b), kind: String((b && b.type) || '').replace(/^player_/, ''), own, door, building: b };
    },

    /** Is this door locked against the player right now? */
    guestDoorLocked(door) {
        const g = this._roomLockGame;
        if (!door || !g || !g.player) return false;
        return RoomLocks.lockedFor(g.player, g.world, this.guestDoorCtx(door));
    },

    /** The player's room here tonight: { key, no, floor } or null. */
    yourGuestRoom() {
        const g = this._roomLockGame;
        if (!g || !g.player || !this._guestDoors) return null;
        return RoomLocks.yourRoom(g.player, g.world, this._guestHouseOf(this._insideBuilding), this._guestDoors);
    },

    /** Is the player standing in this door's room (or in the doorway)? */
    _playerInGuestRoom(door) {
        const t = this.tiles && this.tiles[this.playerInnerR] && this.tiles[this.playerInnerR][this.playerInnerQ];
        return !!t && (t === door.tile || t._roomId === door.roomId);
    },

    /** May the player not step onto this tile: a room door locked to them, from outside the room? */
    _roomLockBlocks(tile) {
        if (!this._guestDoorMap || !tile || !tile._doorway) return false;
        const d = this._guestDoorMap.get(tile);
        if (!d || d.floor !== (this._floor || 0)) return false;
        if (this._playerInGuestRoom(d)) return false;
        return this.guestDoorLocked(d);
    },

    /** Who is in this door's room on the floor shown: [npc] */
    guestRoomOccupants(door) {
        if (!door || door.floor !== (this._floor || 0)) return [];
        return (this.npcs || []).filter(n => {
            if (!n || n.departed || n.state === 'gone' || n.state === 'dead' || n.dead) return false;
            const t = this.tiles[n.r] && this.tiles[n.r][n.q];
            return !!t && t._roomId === door.roomId;
        });
    },

    /** The house turns away a guest it has thrown out (interiors.js enterBuilding). → refusal or null */
    _lodgingRefusal(building, game) {
        const houseId = this._guestHouseOf(building);
        if (!houseId || !game || !game.player || building.isPlayerOwned) return null;
        const until = RoomLocks.bannedUntil(game.player, game.world, houseId);
        if (!until) return null;
        const days = until - ((game.world && game.world.day) || 0);
        const keeper = building.ownerName || 'The keeper';
        return { ok: false, text: `${keeper} blocks the door of ${building.name || 'the house'}: "Not you. Not after last time." (Barred ${days} more day${days === 1 ? '' : 's'}.)` };
    },
});

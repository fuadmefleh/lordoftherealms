// ============================================
// INNER MAP — the locked rooms of an inn: your key, knocking, picking a lock
// ============================================
// Inside an inn, a hotel, a guest house or a roadhouse the let rooms' doors
// are locked to all but the guest with the key (systems/roomLocks.js; the
// doors found by world/innerMap/guestRooms.js). Clicking a room's doorway
// says whose it is — "Locked — your room is No. 3" — and offers a knock and,
// for a door locked to you, Pick the Lock: a short wait at the door, the roll
// (Locks.attempt), and on success the door stays open the rest of the day.
// Heard at it, or walking in on a guest who is up: the fine and the record
// (Locks' heard path), the keeper and whoever saw it think the worse of you,
// and the keeper throws you out and bars the house for some days.

import { InnerMap } from '../world/innerMap.js';
import { Locks } from '../systems/locks.js';
import { RoomLocks } from '../systems/roomLocks.js';
import { SocialSkills } from '../systems/socialSkills.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { containerContext, theftScene } from './objectActions/contents.js';

const _asleep = n => !!(n && (n._asleep || n.state === 'sleeping' || (n.activity && n.activity.type === 'bed')));
const _out = n => ({ name: n.fullName || n.name || 'a guest', asleep: _asleep(n) });
const _roomName = d => (d.no != null ? `No. ${d.no}` : d.name || 'the room');

export const InnerMapRoomLocks = {
    /** The doorway's entries: whose room it is, and (locked) a knock and the lock. */
    menuItems(game, tile, q, r) {
        if (!game || !game.player || !InnerMap._insideBuilding || !InnerMap.guestDoorAt) return [];
        const door = InnerMap.guestDoorAt(q, r);
        if (!door) return [];
        const items = [{ type: 'header', label: door.kind === 'staff' ? `🚪 ${door.name} — staff only` : `🚪 Room ${_roomName(door)}` }];
        const ctx = InnerMap.guestDoorCtx(door);
        if (ctx.own) {
            items.push({ type: 'disabled', label: '🗝️ Your own house: every key is on your ring' });
            return items;
        }
        const mine = InnerMap.yourGuestRoom();
        if (mine && mine.key === door.key) {
            items.push({ type: 'disabled', label: '🗝️ Your room tonight: the key is yours' });
            return items;
        }
        if (!InnerMap.guestDoorLocked(door)) {
            items.push({ type: 'disabled', label: '🔓 You picked this lock: open until the keeper notices' });
            return items;
        }
        const L = RoomLocks.lodgingHere(game.player, game.world, ctx.houseId);
        const why = door.kind === 'staff' ? 'the keeper\'s own'
            : mine ? `your room is No. ${mine.no}` : L ? 'you have a bunk in the common room' : 'let to a paying guest';
        items.push({ type: 'disabled', label: `🔒 Locked — ${why}` });
        if (door.kind === 'guest') items.push({ type: 'action', action: 'roomlock_knock', icon: '✊', label: 'Knock', desc: 'Someone may be in', door });
        const lock = RoomLocks.doorLock(ctx.kind, door.kind);
        if (!lock) return items;
        const chance = Locks.chance(game.player, lock.difficulty);
        const lv = SocialSkills.level(game.player, 'lockpicking');
        if (chance <= 0) {
            items.push({ type: 'disabled', label: `🔒 A ${lock.name.toLowerCase()} lock (${lock.difficulty}), beyond Lockpicking ${lv}` });
        } else {
            items.push({
                type: 'action', action: 'roomlock_pick', icon: '🗝️', door,
                label: `Pick the Lock (${Math.round(chance * 100)}%)`,
                desc: `A ${lock.name.toLowerCase()} lock (difficulty ${lock.difficulty}). ${Locks.minutes(game.player)} minutes a try; a botched one may be heard, and the keeper will throw you out.`,
            });
        }
        return items;
    },

    /** Run 'roomlock_*'. Returns true when it was ours. */
    handle(game, item) {
        if (!item || !/^roomlock_/.test(item.action || '')) return false;
        const door = item.door;
        if (!door) return true;
        const run = item.action === 'roomlock_pick'
            ? () => {
                game.ui.showNotification('🗝️ At the Lock', `You crouch at the door of ${_roomName(door)} and set to work…`, 'info');
                setTimeout(() => InnerMapRoomLocks._finishPick(game, door), 1200);
            }
            : () => InnerMapRoomLocks._knock(game, door);
        InnerMapRoomLocks._approach(game, door, run);
        return true;
    },

    /** Walk up to the door from the corridor side (never into the room), then run. */
    _approach(game, door, run) {
        InnerMap.cancelPlayerWalk();
        InnerMap._pendingAction = null;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const at = door.outside || { q: door.q, r: door.r };
        if ((pq === at.q && pr === at.r) || (pq === door.q && pr === door.r)
            || (InnerMap._playerInGuestRoom(door) && Math.abs(pq - door.q) + Math.abs(pr - door.r) <= 1)) { run(); return; }
        const walk = InnerMap.movePlayerTo(at.q, at.r);
        if (!walk || !walk.started) { game.ui.showNotification('Blocked', `You can't reach the door of ${_roomName(door)}.`, 'error'); return; }
        InnerMap._pendingAction = { q: door.q, r: door.r, run };
    },

    _knock(game, door) {
        const res = RoomLocks.knock(game.player, game.world, door, InnerMap.guestRoomOccupants(door).map(_out));
        game.ui.showNotification('✊ A Knock', res.text, 'info');
    },

    _finishPick(game, door) {
        if (!InnerMap.active || !InnerMap._insideBuilding || !InnerMap.guestDoorLocked(door)) return;
        const player = game.player;
        const b = InnerMap._insideBuilding;
        const base = containerContext(game, 'door', door.q, door.r);
        const scene = theftScene(game, base);
        const occupants = InnerMap.guestRoomOccupants(door);
        const ctx = { ...InnerMap.guestDoorCtx(door), kingdom: base.kingdom, worldQ: base.worldQ, worldR: base.worldR,
            keeper: b.ownerName || null, ownerName: b.ownerName ? `${b.ownerTitle || 'Keeper'} ${b.ownerName}` : null, occupants: occupants.map(_out) };
        const res = RoomLocks.pick(player, game.world, ctx, scene);
        if (res.minutes && typeof InnerMap.passHours === 'function') InnerMap.passHours(res.minutes / 60);
        if (res.caught) {
            const keeperId = b.ownerId;
            const all = [...(scene.near || []), ...occupants];
            for (const npc of new Set(all)) {
                NpcDisposition.adjustDisposition(npc, npc.id === keeperId || occupants.includes(npc) ? -20 : -8, player);
                NpcDisposition.getMemory(npc).lastAction = 'caught_stealing';
            }
            game.ui.showNotification(res.walkedIn ? '🚨 Thief in the House!' : '🚨 Heard at the Door', res.text, 'error');
            game.ui.updateStats(player, game.world);
            if (res.thrownOut && typeof game._leaveBuilding === 'function') setTimeout(() => { if (InnerMap._insideBuilding === b) game._leaveBuilding(); }, 600);
            return;
        }
        game.ui.showNotification(res.ok ? '🔓 The Lock Gives' : '🔒 The Lock Holds', res.text, res.ok ? 'success' : 'warning');
        game.ui.updateStats(player, game.world);
    },
};

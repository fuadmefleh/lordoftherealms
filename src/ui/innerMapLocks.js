// ============================================
// INNER MAP — picking a barred door's lock
// ============================================
// A lord's seat with nobody at home and no guard standing at its door is
// barred (world/innerMap/seats.js). Lockpicking lets the player try its lock
// (systems/locks.js): a short wait at the door, the roll, and on success the
// door opens (building._lockPicked, which seatEntry honours while no guard
// stands there) and the player goes in. A botched try may be heard by the
// street.

import { InnerMap } from '../world/innerMap.js';
import { Locks } from '../systems/locks.js';
import { SocialSkills } from '../systems/socialSkills.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { containerContext, theftScene } from './objectActions/contents.js';

const _awake = n => n && n.state !== 'unconscious' && n.state !== 'gone' && n.state !== 'dead' && !n.dead && !n._knockedOut;

/** Is this seat barred to the player right now: nobody home, no guard on the door, not theirs? */
function _barred(game, building) {
    if (!building || !InnerMap.isSeat || !InnerMap.isSeat(building) || InnerMap._insideBuilding) return false;
    if (building._lockPicked) return false;
    if (InnerMap.playerHoldsSeat && InnerMap.playerHoldsSeat(building, game)) return false;
    if (String(building.type).replace(/^player_/, '') === 'castle') return false;
    if (InnerMap.seatGuards(building).some(_awake)) return false;
    return InnerMap.whoIsHome(building).length === 0;
}

export const InnerMapLocks = {
    /** The "Pick the Lock" entry for a barred seat. */
    menuItems(game, building) {
        if (!game || !game.player || !_barred(game, building)) return [];
        const lock = Locks.doorLock(building);
        if (!lock) return [];
        const chance = Locks.chance(game.player, lock.difficulty);
        const lv = SocialSkills.level(game.player, 'lockpicking');
        if (chance <= 0) {
            return [{ type: 'disabled', label: `🔒 Barred: a ${lock.name.toLowerCase()} lock (${lock.difficulty}), beyond Lockpicking ${lv}` }];
        }
        return [{
            type: 'action', action: 'lock_door', icon: '🗝️', building,
            label: `Pick the Lock (${Math.round(chance * 100)}%)`,
            desc: `A ${lock.name.toLowerCase()} lock (difficulty ${lock.difficulty}). ${Locks.minutes(game.player)} minutes a try; a botched one may be heard.`,
        }];
    },

    /** Run 'lock_door'. enter(item): re-dispatch an action (the way in). Returns true when it was ours. */
    handle(game, item, q, r, enter) {
        if (!item || item.action !== 'lock_door') return false;
        const building = item.building;
        const go = () => {
            if (!_barred(game, building)) return;
            game.ui.showNotification('🗝️ At the Lock', `You kneel at the door of ${building.name} and set to work…`, 'info');
            setTimeout(() => InnerMapLocks._finish(game, building, enter), 1400);
        };
        const res = InnerMap.approachAndThen(q, r, go);
        if (res === 'unreachable') game.ui.showNotification('Blocked', `You can't reach the door of ${building.name}.`, 'error');
        return true;
    },

    _finish(game, building, enter) {
        if (!InnerMap.active || InnerMap._insideBuilding || !_barred(game, building)) return;
        const player = game.player;
        const ctx = containerContext(game, 'door', building.q, building.r);
        const scene = theftScene(game, { ...ctx, building: null });
        ctx.ownerName = building.ownerName ? `${building.ownerTitle || 'Lord'} ${building.ownerName}` : null;
        const res = Locks.pickDoor(player, game.world, building, ctx, scene);
        if (res.minutes && typeof InnerMap.passHours === 'function') InnerMap.passHours(res.minutes / 60);
        if (res.noticed) {
            for (const npc of scene.near || []) {
                NpcDisposition.adjustDisposition(npc, -8, player);
                NpcDisposition.getMemory(npc).lastAction = 'caught_stealing';
            }
            game.ui.showNotification('🚨 Heard at the Door', res.text, 'error');
        } else {
            game.ui.showNotification(res.ok ? '🔓 The Lock Gives' : '🔒 The Lock Holds', res.text, res.ok ? 'success' : 'warning');
        }
        game.ui.updateStats(player, game.world);
        if (res.ok) {
            building._lockPicked = true;
            if (typeof enter === 'function') enter({ type: 'action', action: 'enter_building', building, label: 'Enter', _approached: true });
        }
    },
};

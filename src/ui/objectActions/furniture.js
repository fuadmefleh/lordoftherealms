// Using the furniture indoors (player/furnitureActions.js): the context a rule
// needs (where, whose, what stands on it, who's watching, the house's larder)
// and the handlers behind the menu's Sit, Sleep (and Sleep Here as a
// trespass), Warm Up, Order a Meal, Eat from the Larder, Wash and Bathe.
import { InnerMap } from '../../world/innerMap.js';
import { Hotbar } from '../hotbar.js';
import { FurnitureActions } from '../../player/furnitureActions.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { FOOD_ITEMS } from './data.js';
import { _advanceTime, _showSleepModal } from './logic.js';
import { theftScene } from './contents.js';

/** The piece at (q, r): the objDef's own furniture, else the tile's. */
function _piece(objDef, q, r) {
    if (objDef && objDef.furniture) return objDef.furniture;
    const t = q != null && InnerMap.getTile ? InnerMap.getTile(q, r) : null;
    return (t && t._furniture) || null;
}

/** Everything put by in the house's chests, cupboards and shelves (their _storage). */
export function homeStores() {
    const out = [];
    for (const row of InnerMap.tiles || []) {
        for (const t of row || []) {
            if (!t) continue;
            if (t._furniture && t._furniture._storage) out.push(t._furniture._storage);
            if (t.customObject && t.customObject._storage) out.push(t.customObject._storage);
        }
    }
    return out;
}

/** Has the household asked the player to stay? (a building flag, or the player's list of houses that have) */
function _permitted(game, b, worldQ, worldR) {
    if (!b) return false;
    if (b.permitted || b.guestOf || b.hostsPlayer) return true;
    const list = game.player && game.player.guestAt;
    return Array.isArray(list) && list.includes(`${worldQ},${worldR}|${b.type}@${b.q},${b.r}`);
}

/** The ctx player/furnitureActions.js reads, for the piece at (q, r). */
export function furnitureCtx(game, objDef, q, r) {
    const furniture = _piece(objDef, q, r);
    const b = InnerMap._insideBuilding || null;
    const wt = InnerMap.currentWorldTile || { q: game.player.q, r: game.player.r };
    const wTile = game.world && game.world.getTile ? game.world.getTile(wt.q, wt.r) : null;
    const settlement = wTile && wTile.settlement;
    const ctx = {
        player: game.player,
        world: game.world,
        type: (objDef && objDef.furnitureType) || (furniture && furniture.type) || null,
        furniture,
        building: b,
        hour: InnerMap.timeOfDay,
        tile: settlement ? wTile : null,
        kingdom: (settlement && settlement.kingdom) || (wTile && wTile.kingdom) || null,
        worldQ: wt.q,
        worldR: wt.r,
        q, r,
        permitted: _permitted(game, b, wt.q, wt.r),
        foodTable: FOOD_ITEMS,
    };
    ctx.homeStores = FurnitureActions.standing(b) === 'own' ? homeStores() : [];
    return ctx;
}

/** The absolute game hour now (day × 24 + the hour and its minutes). */
export function gameHourNow(game) {
    const day = game.world && Number.isFinite(game.world.day) ? game.world.day : 0;
    const scale = InnerMap.TIME_SCALE || 60;
    return day * 24 + (InnerMap.timeOfDay || 0) + (InnerMap._timeAccumulator || 0) / scale;
}

function _done(game) {
    game.ui.updateStats(game.player, game.world);
    Hotbar.refresh();
}

/**
 * Sit down and stay sat (the seated frame held: world/innerMap/furnitureUse.js
 * seatPlayer) till the next step; the hours sat are settled on standing.
 */
export function sitDown(game, objDef, q, r) {
    const type = (objDef && objDef.furnitureType) || null;
    const name = String((objDef && objDef.name) || type || 'seat').toLowerCase();
    InnerMap.seatPlayer({
        q, r, type,
        since: gameHourNow(game),
        onStand: (seat) => {
            const res = FurnitureActions.standUp(game.player, seat, gameHourNow(game));
            if (res.text) game.ui.showNotification('💺 Up Again', res.text, 'info');
            _done(game);
        },
    });
    return `You sit down on the ${name}. Stay a while: you rest as the time passes, and get up when you move.`;
}

/** The instant furniture actions (warm, wash, bathe, a meal, the larder): apply, pass the time, tell. */
export function runFurnitureAction(game, key, objDef, q, r) {
    const res = FurnitureActions.apply(key, furnitureCtx(game, objDef, q, r));
    if (!res.ok) {
        game.ui.showNotification('🚫 Not Here', res.text || 'Not now.', 'error');
        return null;
    }
    if (res.hours > 0) _advanceTime(res.hours);
    return res.text;
}

/** Sleep in a bed: as you may (own, rented, offered), at the bed's quality for it. */
export function sleepHere(game, objDef, q, r) {
    const ctx = furnitureCtx(game, objDef, q, r);
    const a = FurnitureActions.bedAccess(ctx);
    const note = a.mode === 'rented' ? 'The room you took tonight' : a.mode === 'permitted' ? "The household's guest bed" : null;
    _showSleepModal(game, objDef, 0, { mult: a.mult, note });
}

/** The odds shown on Sleep Here (Trespass). */
export function trespassDesc(game, objDef, q, r) {
    const ctx = furnitureCtx(game, objDef, q, r);
    const scene = theftScene(game, { building: ctx.building, inSettlement: !!ctx.tile });
    const odds = FurnitureActions.trespassOdds(game.player, scene, ctx.hour);
    return `Not yours: ${Math.round(odds * 100)}% someone finds you (a fine, and a trespass on your record)`;
}

/** Lie down in a stranger's bed: the sleep window, and the roll when you lie down. */
export function sleepTrespass(game, objDef, q, r) {
    const ctx = furnitureCtx(game, objDef, q, r);
    _showSleepModal(game, objDef, 0, {
        mult: FurnitureActions.cfg('sleep').trespass,
        note: "Someone else's bed: you may be found in it",
        before: (hours) => {
            const scene = theftScene(game, { building: ctx.building, inSettlement: !!ctx.tile });
            const res = FurnitureActions.trespassSleep(game.player, game.world, { ...ctx, scene, hour: InnerMap.timeOfDay }, hours);
            if (res.caught) {
                game.ui.showNotification('🚨 Caught in their bed!', res.text, 'error');
                for (const npc of scene.near || []) {
                    const isOwner = scene.ownerName && npc.name === scene.ownerName;
                    NpcDisposition.adjustDisposition(npc, isOwner ? -15 : -6, game.player);
                    NpcDisposition.getMemory(npc).lastAction = 'trespass';
                }
                _done(game);
                return false;
            }
            return res.text;
        },
    });
}

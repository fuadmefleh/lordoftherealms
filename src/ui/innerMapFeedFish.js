// ============================================
// INNER MAP — throwing food to the fish
// ============================================
// On deep water within a throw of you (the fish's own water: surfaceFish.js
// isFishWater — not the shallows, a ford, under a bridge or on ice), the menu
// offers to throw them something from your packs: bread, grain, a little
// flour, berries, cheese, a scrap of meat, a small fish cut up (data/
// innerMap.json surfaceFish.feeding.foods). One goes from the packs a throw.
// It arcs out and lands with a splash; the fish near turn and come to it,
// more come up from deeper while it floats, and they nibble it down, a ring
// at each bite, until it is gone or sinks (ui/innerMapLayers/surfaceFish.js).
// A line cast near where they were fed bites the readier for a while
// (SurfaceFish.biteBonus, read by ui/mapTasks/wildTasks.js).
//
//   menuItems(game, tile, q, r)   the throws on offer at this water
//   handle(game, item, q, r)      'feedfish_throw'

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { SurfaceFish, isFishWater } from './innerMapLayers/surfaceFish.js';

const T = 32; // the inner map's tile size
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _log(game, title, text) {
    const ui = game && game.ui;
    if (!ui) return;
    if (typeof ui._logNotification === 'function') ui._logNotification(title, text, 'info');
    else if (typeof ui.showNotification === 'function') ui.showNotification(title, text, 'info');
}

export const InnerMapFeedFish = {
    /** The foods fish take (feeding.foods), with how many of each are in the packs: [{ id, food, have }] */
    foodsInPacks(player) {
        const foods = SurfaceFish.feeding().foods || {};
        const inv = (player && player.inventory) || {};
        return Object.keys(foods).filter(id => _num(inv[id]) >= 1).map(id => ({ id, food: foods[id], have: Math.floor(_num(inv[id])) }));
    },

    /** Can you throw to (q, r) from where you stand? → null, or why not (for a line in the menu) */
    whyNot(game, tile, q, r) {
        if (!tile || !isFishWater(tile)) return 'no fish water';
        if (InnerMap._underwater || InnerMap._insideBuilding) return 'not from here';
        const reach = _num(SurfaceFish.feeding().reach, 6);
        const d = Math.max(Math.abs(q - InnerMap.playerInnerQ), Math.abs(r - InnerMap.playerInnerR));
        if (d > reach) return `too far to throw (${reach} paces at most)`;
        // (so near the bank no fish comes in for it: SurfaceFish keeps to water with water all round)
        if (SurfaceFish.cells && SurfaceFish.cells(InnerMap.tiles) >= 0 && !SurfaceFish.reachPoint(q + 0.5, r + 0.5)) return 'too near the bank: no fish come in so close';
        return null;
    },

    menuItems(game, tile, q, r) {
        const why = this.whyNot(game, tile, q, r);
        if (why === 'no fish water' || why === 'not from here') return [];
        const player = game && game.player;
        const foods = this.foodsInPacks(player);
        if (why) return [{ type: 'disabled', label: `🐟 Feed the Fish — ${why}` }];
        if (!foods.length) return [{ type: 'disabled', label: '🐟 Feed the Fish — nothing in your packs they would eat (bread, grain, berries, cheese, meat…)' }];
        return foods.slice(0, 4).map(f => ({
            type: 'action', action: 'feedfish_throw', food: f.id, icon: '🐟',
            label: `Throw ${f.food.what || f.id.replace(/_/g, ' ')} to the Fish`,
            desc: `One from your packs (${f.id.replace(/_/g, ' ')} ×${f.have}): watch them come up for it. A line cast here after bites the readier.`,
        }));
    },

    handle(game, item, q, r) {
        if (!item || item.action !== 'feedfish_throw') return false;
        const player = game && game.player;
        const tile = InnerMap.getTile ? InnerMap.getTile(q, r) : null;
        const why = this.whyNot(game, tile, q, r);
        const food = (SurfaceFish.feeding().foods || {})[item.food];
        const inv = (player && player.inventory) || {};
        if (why || !food || !(_num(inv[item.food]) >= 1)) {
            const reason = why || (!food ? 'The fish won\'t take that.' : 'You have none of that left.');
            if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification('🐟 Not There', reason.charAt(0).toUpperCase() + reason.slice(1) + (why ? '.' : ''), 'warning');
            return true;
        }
        // One from the packs
        inv[item.food] -= 1;
        if (inv[item.food] <= 0) delete inv[item.food];
        // Turned to the water, and away it goes (from the hand, to a spot near where you pointed)
        const pos = InnerMap.getPlayerWorldPos();
        const fx = pos.x / T, fy = pos.y / T;
        const jx = (Math.sin(fx * 12.9898 + fy * 78.233) * 0.5) * 0.4, jy = (Math.cos(fx * 39.346 + fy * 11.135) * 0.5) * 0.4;
        let tx = q + 0.5 + jx, ty = r + 0.5 + jy;
        if (!SurfaceFish.floatable(tx, ty)) { tx = q + 0.5; ty = r + 0.5; }
        const dq = q - InnerMap.playerInnerQ, dr = r - InnerMap.playerInnerR;
        if (dq || dr) InnerMapRenderer._playerFacing = InnerMapCharacters.getDirection(Math.abs(dq) >= Math.abs(dr) ? Math.sign(dq) : 0, Math.abs(dq) >= Math.abs(dr) ? 0 : Math.sign(dr));
        SurfaceFish.throwBait(fx, fy - 0.5, tx, ty, food);
        _log(game, '🐟 Feeding the Fish', `You toss ${food.what || item.food.replace(/_/g, ' ')} onto the water.`);
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        return true;
    },
};

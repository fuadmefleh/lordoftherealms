// ============================================
// InnerMap — carts on the street: where they stand, and who they block
// ============================================
// The street map's carts (handcarts and merchants' wagons) are entities of
// their own, kept in InnerMap.carts while the player is on the street map
// they stand on (ui/innerMapCarts.js spawns, drives and draws them; the rules
// are systems/carts.js). This file is only the ground they take up:
//
//   - cartAt(q, r): the cart standing on a tile (its body, or its horse);
//   - _cartBlocks(q, r, who): a cart is in the way of `who` there (an NPC, or
//     'player') — its own driver and the one pushing it are never blocked by it;
//   - a cart parked (no one at its handles) is a solid thing: paths go round
//     it (InnerMap._findPath reads _cartParkedIdx); a moving cart is waited for.
//
// Carts never go indoors: indoors (InnerMap._insideBuilding) there are none.
// Nothing here is saved: the street maps are dealt again on the next visit.

import { InnerMap } from './_ref.js';

Object.assign(InnerMap, {
    /** The carts on this street map: [{ id, kind, tiles:[{q,r}], driver, pusher, parked, ... }] */
    carts: [],
    // (the street map they stand on: a new map has none)
    _cartsTiles: null,
    // tile index (r * width + q) of every parked cart's ground, for the pathfinder
    _cartParkedIdx: null,

    /** The carts on the street map the player is on (none indoors, none on another map). */
    streetCarts() {
        if (this._insideBuilding) return [];
        if (this._cartsTiles !== this.tiles) return [];
        return this.carts || [];
    },

    /** Start a new map's list (ui/innerMapCarts.js, when the street map changes). */
    _resetCarts() {
        this.carts = [];
        this._cartsTiles = this.tiles;
        this._cartsW = this.width;
        this._cartParkedIdx = null;
    },

    /** The cart taking up (q, r), or null. */
    cartAt(q, r) {
        for (const c of this.streetCarts()) {
            for (const t of c.tiles || []) if (t.q === q && t.r === r) return c;
        }
        return null;
    },

    /**
     * Is a cart in `who`'s way at (q, r)? Its own driver, the one pushing it, and
     * whoever lies on it are not stopped by it.
     * @param {object|'player'} who an NPC, or 'player'
     */
    _cartBlocks(q, r, who) {
        let c = this.cartAt(q, r);
        // (an NPC keeps off the ground a moving cart is about to take: its leader's tile and the next)
        if (!c && who !== 'player') c = this.streetCarts().find(x => x.claim && x.claim.some(t => t.q === q && t.r === r)) || null;
        if (!c) return false;
        if (who === 'player') return !(c.pusher === 'player');
        if (who && (c.driver === who || c.load === who)) return false;
        return true;
    },

    /**
     * An NPC's next step is onto a cart (npcs.js updateNPCs): they wait a moment; a cart
     * that is parked they go round; one that does not move on, they give up on the walk.
     * @returns {boolean} true: the step is not taken this time
     */
    _npcWaitForCart(npc, step) {
        npc._cartWait = (npc._cartWait || 0) + 1;
        const c = this.cartAt(step.q, step.r);
        if (npc._cartWait >= 3 && c && c.parked && npc.path && npc.path.length) {
            const end = npc.path[npc.path.length - 1];
            const path = this._findPath(npc.q, npc.r, end.q, end.r);
            npc._cartWait = 0;
            if (path && path.length >= 2) {
                npc.path = path.slice(1);
                npc.pathIndex = 0;
                return true;
            }
        }
        if (npc._cartWait >= 12) {
            npc._cartWait = 0;
            npc.path = null;
            npc.state = 'idle';
            npc.idleTimer = 1;
        }
        return true;
    },

    /** Is anyone standing on (q, r) — the player, or an NPC on their feet (not `except`)? */
    _cartTileTaken(q, r, except = null) {
        if (q === this.playerInnerQ && r === this.playerInnerR) return true;
        for (const n of this.npcs || []) {
            if (n === except || n.state === 'gone' || n.state === 'inside_building' || n._onCart) continue;
            if (n.q === q && n.r === r) return true;
            // (one stepping onto it this moment)
            if (n.state === 'walking' && n.path && n.pathIndex < n.path.length && n.moveProgress > 0) {
                const s = n.path[n.pathIndex];
                if (s && s.q === q && s.r === r) return true;
            }
        }
        return false;
    },

    /** Can a cart's wheels go onto (q, r): open ground or a gateway (never water, a wall, a door into a house). */
    _cartGround(q, r) {
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        if (!t || t.isWater || t._isDoor || t._stairs) return false;
        if (t.building || t.customObjectPart) return false;
        if (t.subTerrain && t.subTerrain.passable) return true;
        // (a shut gate: opened as the cart goes through — world/innerMap/gates.js)
        return !!(this._isShutGateTile && this._isShutGateTile(t));
    },

    /** Rebuild the parked carts' ground for the pathfinder (after a cart stops or moves off). */
    _cartsChanged() {
        // (the street's width, even from indoors: the list is the street's)
        const W = this._cartsW || this.width;
        const set = new Set();
        for (const c of this.carts || []) {
            if (!c.parked) continue;
            for (const t of c.tiles || []) set.add(t.r * W + t.q);
        }
        this._cartParkedIdx = set.size ? set : null;
        if (set.size) set.w = W;
    },
});

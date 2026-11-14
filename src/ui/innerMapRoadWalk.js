// ============================================
// INNER MAP ROAD WALK — "Follow the road" on the street map (R, or a road's menu)
// ============================================
// The player walks on along the road they stand on (or one a step or three
// away), the way they face or the way they chose, through the ordinary walk
// (InnerMap._playerPath / updatePlayer: gates, encounters), until the road
// meets a junction, runs out, or reaches the map's edge — and there on into
// the next hex as edge-walking does (ui/game/gameLoop.js _crossEdge), picking
// the road up again on the far side. A WASD key (ui/innerMapKeys.js takes
// over), a click elsewhere, or R again stops it. The road's course is traced
// by world/roadTrace.js.

import { InnerMap } from '../world/innerMap.js';
import { traceRoad, bestRoadHeading } from '../world/roadTrace.js';
import { InnerMapRenderer } from './innerMapRenderer.js';

// The facing constants of InnerMapCharacters (0 up, 1 left, 2 down, 3 right) as a heading
const FACING_DIR = [{ dq: 0, dr: -1 }, { dq: -1, dr: 0 }, { dq: 0, dr: 1 }, { dq: 1, dr: 0 }];
// How far off a road you may be and still take it up
const PICKUP_REACH = 3;

const _isRoadTile = t => !!(t && (t.isRoad || t._bridge) && t.subTerrain && t.subTerrain.passable && !t.building);

export const InnerMapRoadWalk = {
    _path: null,     // the path handed to the walk (its identity tells a takeover)
    _cont: null,     // { heading, hex }: crossing into the next hex, the road taken up on arrival
    _end: null,

    /** The street map as roadTrace reads it. */
    _map() {
        return {
            W: InnerMap.width, H: InnerMap.height,
            isRoad: (q, r) => _isRoadTile(InnerMap.tiles[r] && InnerMap.tiles[r][q]),
            canStep: (fq, fr, tq, tr) => {
                const t = InnerMap.tiles[tr] && InnerMap.tiles[tr][tq];
                return !!t && InnerMap._playerMayEnter(t, tq, tr) && !InnerMap._stepBlocked(fq, fr, tq, tr);
            },
        };
    },

    /** Is a road walk under way? */
    isWalking() {
        return !!this._path && InnerMap._playerPath === this._path && InnerMap._playerWalking;
    },

    /** Menu items for a road cell's context menu (ui/innerMapUI.js). */
    menuItems(game, tile, q, r) {
        if (!InnerMap.active || InnerMap._insideBuilding || !_isRoadTile(tile)) return [];
        if (this.isWalking()) return [{ type: 'action', action: 'roadwalk_stop', label: 'Stop Following the Road', icon: '✋', desc: 'Halt here' }];
        return [{ type: 'action', action: 'roadwalk_follow', label: 'Follow the Road', icon: '🛤️', desc: 'Walk on along it to the next crossroads, or on into the next hex (R)' }];
    },

    /** Context-menu actions (roadwalk_*). @returns {boolean} handled */
    handle(game, item, q, r) {
        if (item.action === 'roadwalk_stop') { this.stop(); return true; }
        if (item.action !== 'roadwalk_follow') return false;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        // Toward the cell chosen; on it, the way you face
        const dir = (q !== pq || r !== pr) ? { dq: Math.sign(q - pq), dr: Math.sign(r - pr) } : null;
        const res = this.start(game, { dir, via: (q !== pq || r !== pr) ? { q, r } : null });
        if (!res.ok && game && game.ui) game.ui.showNotification('🛤️ Follow the Road', res.reason, 'warning');
        return true;
    },

    /** R on the street map: follow the road, or stop following it. */
    toggle(game) {
        if (this.isWalking()) { this.stop(); return; }
        const res = this.start(game, {});
        if (!res.ok && game && game.ui) game.ui.showNotification('🛤️ Follow the Road', res.reason, 'warning');
    },

    stop() {
        if (this.isWalking()) {
            // (finish the stride under way, and no further)
            InnerMap._playerPath.length = Math.min(InnerMap._playerPath.length, InnerMap._playerPathIndex + 1);
        }
        this._path = null;
        this._cont = null;
    },

    /**
     * Start along the road. opts: dir ({dq, dr}: the way to go; else the way the
     * player faces), via ({q, r}: a road cell to make for first).
     * @returns {{ ok: boolean, reason?: string, end?: string, steps?: number }}
     */
    start(game, opts = {}) {
        if (!InnerMap.active || !InnerMap.tiles) return { ok: false, reason: 'Not on the street map.' };
        if (InnerMap._insideBuilding) return { ok: false, reason: 'There are no roads indoors.' };
        if (InnerMap._climb || InnerMap._climbRequest) return { ok: false, reason: 'Not halfway up a rock face.' };
        if (InnerMap.isPlayerSwimming && InnerMap.isPlayerSwimming()) return { ok: false, reason: 'Get out of the water first.' };
        const map = this._map();
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        let prefer = opts.dir || FACING_DIR[InnerMapRenderer._playerFacing != null ? InnerMapRenderer._playerFacing : 2] || FACING_DIR[2];

        // Onto the road first: the cell chosen, or the nearest road cell (ahead of you the likelier)
        let lead = [{ q: pq, r: pr }];
        let from = opts.via || (map.isRoad(pq, pr) ? { q: pq, r: pr } : this._nearestRoad(map, pq, pr, prefer));
        if (!from) return { ok: false, reason: 'There is no road here to follow.' };
        if (from.q !== pq || from.r !== pr) {
            const p = InnerMap._findPath(pq, pr, from.q, from.r);
            if (!p || p.length < 2) return { ok: false, reason: 'You cannot get onto that road from here.' };
            lead = p;
        }
        const heading = bestRoadHeading(map, from.q, from.r, prefer);
        if (!heading) return { ok: false, reason: 'The road goes nowhere from here.' };
        const tr = traceRoad(map, from, heading);
        const path = lead.concat(tr.cells);
        if (path.length < 2) {
            if (tr.end === 'edge') return { ok: false, reason: 'You stand at the edge of the map — step on, and the road goes with you.' };
            return { ok: false, reason: 'The road ends here.' };
        }
        InnerMap.cancelPlayerWalk();
        InnerMap._playerPath = path;
        InnerMap._playerPathIndex = 1;
        InnerMap._playerMoveProgress = 0;
        InnerMap._playerPrevQ = pq;
        InnerMap._playerPrevR = pr;
        InnerMap._playerWalking = true;
        InnerMap._playerArrivalResult = null;
        this._path = path;
        this._end = tr.end;
        const p = game && game.player;
        this._cont = tr.end === 'edge' && p ? { heading: tr.heading, hex: `${p.q},${p.r}` } : null;
        return { ok: true, end: tr.end, steps: path.length - 1 };
    },

    /** The nearest road cell within PICKUP_REACH, those ahead (along `prefer`) first. */
    _nearestRoad(map, q, r, prefer) {
        let best = null;
        for (let dr = -PICKUP_REACH; dr <= PICKUP_REACH; dr++) {
            for (let dq = -PICKUP_REACH; dq <= PICKUP_REACH; dq++) {
                const x = q + dq, y = r + dr;
                if (!map.isRoad(x, y)) continue;
                const d = Math.max(Math.abs(dq), Math.abs(dr)) - 0.3 * (dq * (prefer.dq || 0) + dr * (prefer.dr || 0)) / Math.max(1, Math.hypot(dq, dr));
                if (!best || d < best.d) best = { q: x, r: y, d };
            }
        }
        return best && { q: best.q, r: best.r };
    },

    /**
     * Each frame on the street map (ui/game/gameLoop.js): forget a walk taken
     * over (keys, a click) or ended; across an edge, take the road up again in
     * the new hex the same way.
     */
    update(game) {
        if (this._path && InnerMap._playerPath !== this._path) this._path = null;
        const c = this._cont;
        if (!c || this._path) return;
        if (!InnerMap.active || (game && game._crossingEdge)) return;
        const p = game && game.player;
        if (!p || `${p.q},${p.r}` === c.hex) {
            // Stopped short of the edge, or the crossing refused (open water, the world's end)
            if (!InnerMap._playerWalking) this._cont = null;
            return;
        }
        this._cont = null;
        if (InnerMap._playerWalking) return; // (already off another way)
        this.start(game, { dir: c.heading });
    },
};

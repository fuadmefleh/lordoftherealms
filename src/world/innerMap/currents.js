// InnerMap — the current carries the swimmer: down the river, along the sea.
//
// In water the player can't stand in, the current takes them:
//   • a river runs down its own course (each cell's t._flow, laid with the
//     river: world/innerMap/water.js), hard mid-channel and gentler next to
//     the bank or over a ford;
//   • the sea runs with the hex's ocean current (world/oceanCurrents.js —
//     the caller passes it in: OceanCurrents.near of the world hex).
// Lakes and ponds lie still.
//
// The push is smooth: the player drifts off their cell (InnerMap._driftPx,
// added to where they are drawn: getPlayerWorldPos) and over half a cell
// they are set on the next cell downstream — between strides, never
// mid-stride. A walk under way is routed afresh from there, so swimming
// against the stream is slow and crossing it a slant. The bank, a bridge,
// a hull or the map's edge stops them. Out of the water the drift eases off.
// The Swimming skill holds against it (the caller's `resist`).
// Settings: data/currents.json `swim`.

import { InnerMap } from './_ref.js';
import { OceanCurrents } from '../oceanCurrents.js';

const T = 32;

function _num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

Object.assign(InnerMap, {
    /** World px the current has carried the player off their cell ({ x, y }) */
    _driftPx: null,
    _driftTiles: null,

    /**
     * The current at cell (q, r) for a swimmer: { x, y (unit, screen axes),
     * speed (cells a second), kind: 'river' | 'sea' } or null (still water, land).
     * `sea`: the hex's ocean current (OceanCurrents.near), or null.
     */
    currentAt(q, r, sea = null) {
        const t = this.tiles && this.tiles[r] && this.tiles[r][q];
        if (!t || this._insideBuilding || !this.isSwimmable(q, r)) return null;
        const cfg = OceanCurrents.config();
        if (!cfg.enabled) return null;
        const sw = cfg.swim || {};
        const f = t._flow;
        if (t._waterKind === 'river' && f && Number.isFinite(f.x) && Number.isFinite(f.y) && (f.x || f.y)) {
            const l = Math.hypot(f.x, f.y) || 1;
            let speed = _num(sw.river, 1.05);
            if (t._ford || this._besideBank(q, r)) speed *= _num(sw.bankShare, 0.4);
            return { x: f.x / l, y: f.y / l, speed, kind: 'river' };
        }
        if ((t._sea || t._waterKind === 'sea') && sea && sea.strength > 0) {
            return { x: sea.x, y: sea.y, speed: _num(sw.sea, 0.45) * sea.strength, kind: 'sea' };
        }
        return null;
    },

    /** Is ground you can stand on beside this cell (the bank)? */
    _besideBank(q, r) {
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = this.tiles[r + dr] && this.tiles[r + dr][q + dq];
            if (n && n.subTerrain && n.subTerrain.passable && !n._bridge) return true;
        }
        return false;
    },

    /** May the current set the swimmer down on (q, r)? Water, or the wet shallows of a bank — not a bridge or a deck. */
    _driftMayEnter(fromQ, fromR, q, r) {
        if (q < 0 || r < 0 || q >= this.width || r >= this.height) return false;
        const t = this.tiles[r] && this.tiles[r][q];
        if (!t || !this._playerMayEnter(t, q, r) || this._stepBlocked(fromQ, fromR, q, r)) return false;
        if (this.isSwimmable(q, r)) return true;
        return !!(t._wet && t.subTerrain && t.subTerrain.passable && !t._bridge && !t._deck && !t._pier && !t.isRoad);
    },

    /**
     * The current's frame: carry the swimmer. `sea` the hex's ocean current
     * (or null), `resist` 0..1 how much of it they hold against.
     * → { carried: true, q, r, kind } when it set them on a new cell, else null.
     */
    driftPlayer(dt, sea = null, resist = 0) {
        if (this._driftTiles !== this.tiles) { this._driftTiles = this.tiles; this._driftPx = null; }
        if (!this.active || this._insideBuilding || this._climb || this._climbRequest || !(dt > 0)) {
            if (this._insideBuilding || !this.active) this._driftPx = null;
            return null;
        }
        const off = this._driftPx || (this._driftPx = { x: 0, y: 0 });
        const cur = this.isPlayerSwimming() ? this.currentAt(this.playerInnerQ, this.playerInnerR, sea) : null;
        if (!cur) {
            // Out of the stream: the drift eases off onto the cell
            const k = Math.min(1, dt * 5);
            off.x -= off.x * k; off.y -= off.y * k;
            if (Math.abs(off.x) < 0.2 && Math.abs(off.y) < 0.2) { off.x = 0; off.y = 0; }
            return null;
        }
        const v = cur.speed * Math.max(0, 1 - Math.max(0, Math.min(1, resist))) * T * Math.min(dt, 0.1);
        off.x += cur.x * v;
        off.y += cur.y * v;
        const lim = T * 0.95;
        off.x = Math.max(-lim, Math.min(lim, off.x));
        off.y = Math.max(-lim, Math.min(lim, off.y));
        // (between strides only: mid-stride the walk is under way between two cells)
        if (this._playerWalking && this._playerMoveProgress > 0.25) return null;
        const sq = Math.abs(off.x) >= T / 2 ? Math.sign(off.x) : 0;
        const sr = Math.abs(off.y) >= T / 2 ? Math.sign(off.y) : 0;
        if (!sq && !sr) return null;
        const q0 = this.playerInnerQ, r0 = this.playerInnerR;
        const tries = [[sq, sr], [sq, 0], [0, sr]].filter(([a, b]) => a || b);
        const step = tries.find(([a, b]) => this._driftMayEnter(q0, r0, q0 + a, r0 + b));
        if (!step) {
            // Against the bank (or the edge): held there
            const hold = T * 0.45;
            if (sq) off.x = Math.sign(off.x) * Math.min(Math.abs(off.x), hold);
            if (sr) off.y = Math.sign(off.y) * Math.min(Math.abs(off.y), hold);
            return null;
        }
        const [dq, dr] = step;
        const dest = this._playerWalking && this._playerPath ? this._playerPath[this._playerPath.length - 1] : null;
        const progress = this._playerWalking ? this._playerMoveProgress : 0;
        this._playerPrevQ = q0;
        this._playerPrevR = r0;
        this.playerInnerQ = q0 + dq;
        this.playerInnerR = r0 + dr;
        off.x -= dq * T;
        off.y -= dr * T;
        if (this._revealAround) this._revealAround(this.tiles, this.playerInnerQ, this.playerInnerR, 2);
        if (dest) {
            // On to where they were swimming, from where the water has put them
            if (dest.q === this.playerInnerQ && dest.r === this.playerInnerR) this.cancelPlayerWalk();
            else {
                const res = this.movePlayerTo(dest.q, dest.r);
                if (res && res.started) this._playerMoveProgress = Math.min(progress, 0.25);
            }
        }
        return { carried: true, q: this.playerInnerQ, r: this.playerInnerR, kind: cur.kind };
    },

    /** A drawn position with the current's carry added */
    _drifted(p) {
        const off = this._driftPx;
        if (off && (off.x || off.y) && this._driftTiles === this.tiles && !this._insideBuilding) {
            p.x += off.x;
            p.y += off.y;
        }
        return p;
    },
});

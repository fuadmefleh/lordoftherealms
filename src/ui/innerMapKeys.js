// ============================================
// INNER MAP KEYS — walk the street map with WASD (or the arrow keys)
// ============================================
// Held keys walk the player a cell at a time, eight ways (W+D: north-east),
// through the same walk as a click (InnerMap.movePlayerTo / updatePlayer:
// swimming, gates, encounters, the edge of the map into the next hex). While
// a key stays held the next cell is added to the walk before the step ends,
// so the stride never stops between cells. A key pressed during a clicked
// walk takes over from it. A blocked diagonal slides along the open side;
// a wall stops you. Not while typing, in a conversation or a panel that
// takes the keys, on a rock face, or while a battle is fought on the map.
// The street map's camera is locked to the player, so it never pans on
// these keys (ui/camera.js reads them for the world map's camera).

import { InnerMap } from '../world/innerMap.js';

const BLOCKING_OVERLAYS = ['npcDialogOverlay', 'wildsEncounterOverlay', 'actionMenu', 'customPanel'];

export const InnerMapKeys = {
    _kbWalk: false,

    /** The direction held now: { dq, dr } (each -1..1), or null. */
    heldDir(keys) {
        if (!keys) return null;
        let dq = 0, dr = 0;
        if (keys['a'] || keys['ArrowLeft']) dq -= 1;
        if (keys['d'] || keys['ArrowRight']) dq += 1;
        if (keys['w'] || keys['ArrowUp']) dr -= 1;
        if (keys['s'] || keys['ArrowDown']) dr += 1;
        return dq || dr ? { dq, dr } : null;
    },

    _blocked(game) {
        if (!InnerMap.active || InnerMap._climb || InnerMap._climbRequest) return true;
        if (game && game.isProcessingTurn) return true;
        if (typeof document !== 'undefined') {
            const a = document.activeElement;
            const tag = a && a.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (a && a.isContentEditable)) return true;
            for (const id of BLOCKING_OVERLAYS) if (document.getElementById(id)) return true;
        }
        return false;
    },

    /** The cell one step `dir` from (q, r) the player may walk onto (a blocked diagonal slides along an open side), or null. */
    stepFrom(q, r, dir) {
        const tries = [[dir.dq, dir.dr]];
        if (dir.dq && dir.dr) tries.push([dir.dq, 0], [0, dir.dr]);
        for (const [dq, dr] of tries) {
            const nq = q + dq, nr = r + dr;
            if (nq < 0 || nr < 0 || nq >= InnerMap.width || nr >= InnerMap.height) continue;
            const t = InnerMap.tiles[nr] && InnerMap.tiles[nr][nq];
            if (!t || !InnerMap._playerMayEnter(t, nq, nr) || InnerMap._stepBlocked(q, r, nq, nr)) continue;
            // (a diagonal squeezing between two blocked cells is no way through)
            if (dq && dr) {
                const a = InnerMap.tiles[r] && InnerMap.tiles[r][nq], b = InnerMap.tiles[nr] && InnerMap.tiles[nr][q];
                if (!(a && InnerMap._playerMayEnter(a, nq, r)) && !(b && InnerMap._playerMayEnter(b, q, nr))) continue;
            }
            return { q: nq, r: nr };
        }
        return null;
    },

    /** Each frame, before the walk is advanced: start, extend or take over the walk from the held keys. */
    update(game, keys) {
        if (this._blocked(game)) return;
        const dir = this.heldDir(keys);
        if (!dir) {
            // Let go: finish the stride under way, and no further
            if (this._kbWalk && InnerMap._playerWalking && InnerMap._playerPath) {
                InnerMap._playerPath.length = Math.min(InnerMap._playerPath.length, InnerMap._playerPathIndex + 1);
            }
            this._kbWalk = false;
            return;
        }
        // A clicked walk (or an errand's) under way: the keys take over
        if (InnerMap._playerWalking && !this._kbWalk) {
            InnerMap.cancelPlayerWalk();
            InnerMap._pendingAction = null;
        }
        if (InnerMap._playerWalking && InnerMap._playerPath) {
            // On the last stride: add the next cell before it ends, so the walk runs on
            const path = InnerMap._playerPath;
            // (the cells walked are dropped as it goes, so a long walk never grows the path)
            if (InnerMap._playerPathIndex > 8) {
                path.splice(0, InnerMap._playerPathIndex - 1);
                InnerMap._playerPathIndex = 1;
            }
            if (InnerMap._playerPathIndex === path.length - 1) {
                const last = path[path.length - 1];
                const next = this.stepFrom(last.q, last.r, dir);
                if (next) path.push(next);
            }
            return;
        }
        const next = this.stepFrom(InnerMap.playerInnerQ, InnerMap.playerInnerR, dir);
        if (!next) return;
        const res = InnerMap.movePlayerTo(next.q, next.r);
        this._kbWalk = !!(res && res.started);
        if (res && res.refused && game && game.ui && !this._toldRefusal) {
            this._toldRefusal = true;
            game.ui.showNotification('🏊 Not Now', res.refused, 'warning');
        }
        if (res && res.started) this._toldRefusal = false;
    },
};

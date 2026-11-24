// ============================================
// InnerMap — the crowd at the fighting pit
// ============================================
// On a town's fight nights (world/pitRing.js nightOf: its market night, the
// feasts), in the hours of the bouts, a share of the town's grown folk go and
// stand at the pit's fence (railCells), facing the ring, and shout at what
// they see (data/pitFights.json crowdStreet). Every choice is a hash of the
// town, the day and the person: the shared RNG is never drawn.

import { InnerMap } from './_ref.js';
import { DataLoader } from './_imports.js';
import { PitRing } from '../pitRing.js';

function _hs(...parts) {
    let h = 2166136261 >>> 0;
    for (const p of parts) {
        const s = String(p);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 0x6e; h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

function _cfg() {
    const d = (DataLoader._gamedata && DataLoader._gamedata.pitFights && DataLoader._gamedata.pitFights.crowdStreet) || {};
    return { share: 0.3, lines: [], ...d };
}

Object.assign(InnerMap, {
    /** A townsperson's claim to a place at the pit's fence; true when it set them going (or stood them there). */
    _pitPick(npc) {
        const ring = this.tiles && this.tiles._pit;
        if (!ring || !npc || npc.type === 'guard' || npc.type === 'child' || npc.type === 'priest' || npc._stall || (npc.age != null && npc.age < 16)) return false;
        const day = this.worldDay || 0;
        const h = Number(this._sceneClock ? this._sceneClock() : this.timeOfDay) || 8;
        const [a, b] = PitRing.HOURS;
        if (!(h >= a && h < b)) return false;
        if (!PitRing.nightOf(ring.town, day).fight) return false;
        const C = _cfg();
        const who = npc.uid || npc.id;
        if (_hs('pit', ring.key, day, who) >= Number(C.share)) return false;
        const rail = PitRing.railCells(ring);
        if (!rail.length) return false;
        const u = _hs('rail', ring.key, who);
        let spot = null;
        for (let k = 0; k < 10 && !spot; k++) {
            const c = rail[Math.floor(_hs(u, k) * rail.length) % rail.length];
            if ((npc.q === c.q && npc.r === c.r) || (this._scenePassable && this._scenePassable(c.q, c.r))) spot = c;
        }
        if (!spot) return false;
        if (npc.q !== spot.q || npc.r !== spot.r) {
            const path = this._findPath(npc.q, npc.r, spot.q, spot.r);
            if (!path || path.length < 2) return false;
            npc.path = path.slice(1);
            npc.pathIndex = 0;
            npc.moveProgress = 0;
            npc.prevQ = npc.q; npc.prevR = npc.r;
            npc.state = 'walking';
            return true;
        }
        npc.state = 'idle';
        npc.facing = spot.facing;
        npc.idleTimer = 20;
        npc.activity = { type: 'scene', icon: '🥊', label: 'Watching the bouts at the pit', anim: 'emotes', _scene: true };
        if (this._sceneNear && this._sceneNear(npc.q, npc.r) && this._sceneSay && _hs('say', ring.key, day, who, Math.floor(h * 4)) < 0.2) {
            const pool = Array.isArray(C.lines) ? C.lines : [];
            const line = pool.length ? pool[Math.floor(_hs('line', ring.key, who, day, Math.floor(h * 4)) * pool.length) % pool.length] : null;
            if (line) this._sceneSay(npc, String(line), 0, 3);
        }
        return true;
    },

    /** The pit's ring on this street map (for the panels: world/pitRing.js), or null. */
    pitHere() {
        return PitRing.spot(this.tiles);
    },
});

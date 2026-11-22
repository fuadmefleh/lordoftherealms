// ============================================
// InnerMap — the crowd at the scaffold
// ============================================
// While a scaffold stands in the square (world/scaffolds.js: from the day an
// execution is proclaimed — systems/executions.js — to the day it is done) a
// few townsfolk stop to gawk at it; on the day itself, in the hours of the
// crowd, most of the town's grown folk come and stand packed before it, facing
// it, and mutter, jeer or pray (data/executions.json street). Every choice is
// a hash of the town, the day and the person: the shared RNG is never drawn.

import { InnerMap } from './_ref.js';
import { DataLoader } from './_imports.js';
import { Scaffolds } from '../scaffolds.js';

function _hs(...parts) {
    let h = 2166136261 >>> 0;
    for (const p of parts) {
        const s = String(p);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 0x5c; h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

const STREET = { hours: [9, 15], share: 0.65, gawkers: 0.1, gawkHours: [8, 18], rows: 6, lines: [], cruel: [], gawk: [] };

function _cfg() {
    const d = (DataLoader._gamedata && DataLoader._gamedata.executions && DataLoader._gamedata.executions.street) || {};
    return { ...STREET, ...d };
}

Object.assign(InnerMap, {
    /** A townsperson's claim to the scaffold's crowd; true when it set them going (or stood them there). */
    _scaffoldPick(npc) {
        const sc = this.tiles && this.tiles._scaffold;
        if (!sc || !npc || npc.type === 'guard' || npc.type === 'child' || npc._stall || (npc.age != null && npc.age < 14)) return false;
        const C = _cfg();
        const day = this.worldDay || 0;
        const h = Number(this._sceneClock ? this._sceneClock() : this.timeOfDay) || 8;
        const theDay = Number(sc.day) === day;
        const [a, b] = theDay ? C.hours : C.gawkHours;
        if (!(h >= a && h < b) || day > Number(sc.day)) return false;
        const who = npc.uid || npc.id;
        if (_hs('scaffold', sc.id, day, who) >= (theDay ? Number(C.share) : Number(C.gawkers))) return false;
        // A place in the crowd before the scaffold (it is 3 tiles wide; the crowd packs the rows below it)
        const rows = Math.max(2, Number(C.rows) || 6);
        const u = _hs('slot', sc.id, who);
        let spot = null;
        for (let k = 0; k < 14 && !spot; k++) {
            const dr = 1 + Math.floor(_hs(u, k, 'r') * rows);
            const dq = -3 + Math.floor(_hs(u, k, 'q') * (7 + dr));
            const s = { q: sc.q + dq - Math.floor(dr / 2) + 1, r: sc.r + dr };
            if ((npc.q === s.q && npc.r === s.r) || (this._scenePassable && this._scenePassable(s.q, s.r))) spot = s;
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
        npc.facing = 0;
        npc.idleTimer = theDay ? 25 : 8;
        npc.activity = { type: 'scene', icon: '💀', label: theDay ? `Come to see ${sc.name || 'the condemned'} die` : 'Gawking at the scaffold', anim: 'emotes', _scene: true };
        if (this._sceneNear && this._sceneNear(npc.q, npc.r) && this._sceneSay && _hs('say', sc.id, day, who, Math.floor(h * 4)) < (theDay ? 0.25 : 0.15)) {
            const pool = theDay ? (sc.method === 'burn' || sc.method === 'quarter' ? [...C.cruel, ...C.lines] : C.lines) : C.gawk;
            const line = pool.length ? pool[Math.floor(_hs('line', sc.id, who, day, Math.floor(h * 4)) * pool.length) % pool.length] : null;
            if (line) this._sceneSay(npc, String(line).replace(/\{name\}/g, sc.name || 'the condemned'), 0, 3.4);
        }
        return true;
    },

    /** Is the scaffold up on this street map (for the panels: world/scaffolds.js)? */
    scaffoldHere() {
        return Scaffolds.spot(this.tiles);
    },
});

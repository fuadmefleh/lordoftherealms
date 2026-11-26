// ============================================
// InnerMap — the realm's affairs in the streets: who stays in, who stands where
// ============================================
// ui/innerMapTownWorld.js reads systems/townWorld.js for the town the player is
// in and puts what it found on InnerMap._townWorld:
//   { stay, famineStalls: Set('q,r'), shut: Set('q,r') }
// Here, over world/innerMap/townLife.js's hour by hour:
//   - the figures it brought into town (soldiers, crusaders, the preacher, the
//     inquisitor and his clerks, the wounded, beggars, someone come to speak to
//     the player: npc._tw) are its to walk — townLife leaves them where they are;
//   - in a siege or a famine a share of the healthy keep indoors (stay);
//   - the keepers of stalls left empty in a famine stay at home;
//   - a temple shut under the Church's ban is closed to them and the player
//     (getBuildingActions reads _shutDoors).
// Every choice is a hash of the town, the day, the hour and the person: the
// shared RNG is never drawn here.

import { InnerMap } from './_ref.js';

function _hs(...parts) {
    let h = 2166136261 >>> 0;
    for (const p of parts) {
        const s = String(p);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 0x71; h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

Object.assign(InnerMap, {
    /** The doors shut today (a temple under the ban): 'q,r' of the building, or a falsy value. */
    _shutDoors: null,

    /**
     * The hour's pick for the town's affairs: true when it settled the npc
     * (townLife then leaves them be).
     */
    _townWorldPick(npc, period) {
        if (!npc) return false;
        // Brought into town by ui/innerMapTownWorld.js: it walks them
        if (npc._tw) {
            // (never stopped mid-step, nor taken from a wagon's head: ui/innerMapCarts.js drives that)
            if (npc.state !== 'walking' && !npc._cartDriver) {
                npc.state = 'idle';
                npc.idleTimer = 4;
            }
            return true;
        }
        const T = this._townWorld;
        if (!T || period === 'night' || !npc._home || npc.type === 'guard') return false;
        const day = this.worldDay || 0;
        const h = Math.floor(Number(this._sceneClock ? this._sceneClock() : this.timeOfDay) || 8);
        const who = npc.uid || npc.id;
        // A stall left empty in the famine: its keeper stays at home
        const st = npc._stall;
        if (st && T.famineStalls && T.famineStalls.has(`${st.q},${st.r}`)) return this._goHome(npc, 'home');
        // A siege or a famine: the frightened and the hungry keep in
        if (T.stay > 0 && _hs('stay', day, h, who) < T.stay) return this._goHome(npc, 'home');
        return false;
    },
});

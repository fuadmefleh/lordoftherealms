// ============================================
// CARRYING — someone senseless over the shoulder, and the blood a body leaves
// ============================================
// The rules of carrying a person on the street map; ui/innerMapCarry.js applies
// them (the shoulder, the walk, the door, the menu). Pure decisions, explicit
// params, no globals, no dice (the one choice that could be random — how a
// sleeper reacts when they come round on the shoulder — is a hash of who they
// are, so a reload tells the same story).
//
//   canPickUp(npc, ctx)   — senseless, not already carried, hands free
//   speedFactor(...)      — the walk while carrying (strength helps; a child is light)
//   handsBlocked(action)  — the orders refused while carrying anyone
//   dropSpot(...)         — a free tile beside the player to set them down on
//   bedSpot(...)          — a bed beside the player (or the one clicked) to lay them in
//   struggle(npc, seed)   — coming round on the shoulder: they kick free, in fear or anger
//   bloodPool / drips     — a body's pool stays where it fell; a carried body drips behind
//
// Data: data/carrying.json.

import { DataLoader } from '../core/dataLoader.js';

const DEFAULTS = {
    speed: { base: 0.55, perStrength: 0.03, max: 0.8, childShare: 0.6 },
    handsActions: [],
    struggle: { angerTraits: ['bold', 'stern', 'stubborn'], lines: { anger: ['Put me down!'], fear: ['Help!'] } },
    blood: { dripSeconds: 90, dripEvery: 2, keepDays: 3 },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** A well-mixed hash of a string, in [0, 1). */
function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

// The tiles beside one, the facing side first: down, right, left, up, then the corners
const AROUND = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

let _cfg = null;
let _cfgSrc;

export const Carrying = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.carrying : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const st = _obj(d.struggle) || {};
            _cfg = {
                speed: { ...DEFAULTS.speed, ...(_obj(d.speed) || {}) },
                handsActions: Array.isArray(d.handsActions) ? d.handsActions.slice() : DEFAULTS.handsActions.slice(),
                struggle: {
                    angerTraits: Array.isArray(st.angerTraits) ? st.angerTraits : DEFAULTS.struggle.angerTraits,
                    lines: { ...DEFAULTS.struggle.lines, ...(_obj(st.lines) || {}) },
                },
                blood: { ...DEFAULTS.blood, ...(_obj(d.blood) || {}) },
            };
        }
        return _cfg;
    },

    /**
     * Can the player pick this person up?
     * @param {object} npc an inner-map NPC
     * @param {object} [ctx] { handsFull: already carrying something, playerOut: the player senseless }
     * @returns {{ ok:boolean, reason:string|null }}
     */
    canPickUp(npc, ctx = {}) {
        if (!npc) return { ok: false, reason: 'no one' };
        if (ctx.playerOut) return { ok: false, reason: 'you are senseless' };
        // (senseless, or tied up: a bound man can't stop you)
        if (npc.state !== 'unconscious' && !npc._bound) return { ok: false, reason: 'awake' };
        if (npc._carried) return { ok: false, reason: 'already carried' };
        if (ctx.handsFull) return { ok: false, reason: 'hands full' };
        return { ok: true, reason: null };
    },

    /** The share of the player's walking speed while carrying `npc` (strength helps; a child is light). */
    speedFactor(player, npc) {
        const S = Carrying.config().speed;
        const str = _num(player && player.strength, 5);
        let f = _num(S.base, 0.55) + Math.max(0, str - 5) * _num(S.perStrength, 0);
        if (npc && npc.type === 'child') f = 1 - (1 - f) * _num(S.childShare, 0.6);
        return Math.max(0.2, Math.min(_num(S.max, 0.8), f));
    },

    /** Does this menu order need free hands (refused while carrying anyone)? */
    handsBlocked(action) {
        return !!action && Carrying.config().handsActions.includes(action);
    },

    /**
     * A free tile beside (pq, pr) to set someone down on.
     * @param {number} pq @param {number} pr the player's tile
     * @param {(q:number, r:number) => boolean} isFree walkable, clear of furniture, people and doors
     * @param {{q:number,r:number}} [prefer] a tile to try first (the one clicked)
     * @returns {{q:number,r:number}|null}
     */
    dropSpot(pq, pr, isFree, prefer = null) {
        if (prefer && Math.max(Math.abs(prefer.q - pq), Math.abs(prefer.r - pr)) === 1 && isFree(prefer.q, prefer.r)) return { q: prefer.q, r: prefer.r };
        for (const [dq, dr] of AROUND) {
            if (isFree(pq + dq, pr + dr)) return { q: pq + dq, r: pr + dr };
        }
        return null;
    },

    /**
     * A bed beside the player to lay someone in.
     * @param {(q:number, r:number) => object|null} furnitureAt the tile's furniture (tile._furniture)
     * @param {(q:number, r:number) => boolean} occupied someone already lies there
     * @param {{q:number,r:number}} [prefer] the bed clicked
     * @returns {{q:number,r:number}|null} the bed tile (a two-tile bed: whichever half is beside the player)
     */
    bedSpot(pq, pr, furnitureAt, occupied, prefer = null) {
        const isBed = (q, r) => {
            const f = furnitureAt(q, r);
            return !!(f && f.type === 'bed') && !occupied(q, r);
        };
        if (prefer && Math.max(Math.abs(prefer.q - pq), Math.abs(prefer.r - pr)) <= 1 && isBed(prefer.q, prefer.r)) return { q: prefer.q, r: prefer.r };
        for (const [dq, dr] of AROUND) {
            if (isBed(pq + dq, pr + dr)) return { q: pq + dq, r: pr + dr };
        }
        return null;
    },

    /**
     * Someone who comes round over the player's shoulder: they kick free, in fear or anger.
     * @param {object} npc
     * @param {string} [seed]
     * @returns {{ mood:'fear'|'anger', bark:string|null }}
     */
    struggle(npc, seed = '') {
        const S = Carrying.config().struggle;
        const traits = (npc && npc.personalityTraits) || [];
        const angry = npc && npc.type !== 'child' && (npc.type === 'guard' || traits.some(t => S.angerTraits.includes(t)));
        const mood = angry ? 'anger' : 'fear';
        const pool = S.lines[mood] || [];
        const bark = pool.length ? pool[Math.floor(_frac(`${seed}|${npc && (npc.id != null ? npc.id : npc.name)}|struggle`) * pool.length) % pool.length] : null;
        return { mood, bark };
    },

    // ──────────── BLOOD ────────────

    /**
     * The pool of blood under someone who fell: it stays where they fell, whoever moves the body.
     * @returns {{ q, r, key, at, day, size, name, drip:boolean, victim }}
     */
    bloodPool(body, at, day, size = 1) {
        return { q: body.q, r: body.r, key: body.key, at, day, size, name: body.name || 'someone', drip: false, victim: body._npc || null };
    },

    /**
     * A carried body bleeds on the ground behind it, while it is fresh: a drop every few tiles.
     * @param {object} body the corpse ({ at: when it fell (ms), _steps })
     * @param {number} now ms
     * @returns {boolean} a drop falls on this step
     */
    drips(body, now) {
        const B = Carrying.config().blood;
        if (!body || now - _num(body.at) > _num(B.dripSeconds, 90) * 1000) return false;
        body._steps = (body._steps || 0) + 1;
        return body._steps % Math.max(1, Math.round(_num(B.dripEvery, 2))) === 0;
    },

    /** Pools older than keepDays are washed away by the rain and the town's feet. */
    bloodKept(pool, today) {
        return !!pool && today - _num(pool.day) <= _num(Carrying.config().blood.keepDays, 3);
    },
};

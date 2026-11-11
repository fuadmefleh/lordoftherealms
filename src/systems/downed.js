// ============================================
// DOWNED — someone on the ground: senseless, bleeding out, bound, dead
// ============================================
// The state machine of a person brought down on the street map, and what can
// be done to them (ui/innerMapDowned.js applies it; the knockout itself is
// systems/knockout.js, carrying systems/carrying.js):
//
//   unconscious ──(time; sooner if roused)──▶ awake (bound: stays bound)
//        │  └─(a hard blow: rollBleed)─▶ bleeding ──(bleedSeconds)──▶ dead
//        │                                  └──(tended)──▶ unconscious
//        └─(finished off / bled out / buried and left)──▶ dead
//   bound: rope on them (bind); awake and bound they can't flee or fight —
//   they plead, threaten or call for help (gag stops the calling)
//
//   Buried alive (buryAlive / liveBurial): the mound cries out for a window
//   (longer if they woke or were bound awake), then they die under it. Dug
//   out in time (by the player, or a passer-by who heard), they live,
//   terrified. A burial record carries `buriedAlive`; one left unresolved
//   (a save in the window, the player gone) settles as a death (settleBurial).
//
// Pure: explicit params, no globals; timings in ms passed in; the dice are
// Utils' seedable stream (or a hash of who and when, where a reload must tell
// the same story). Data: data/downed.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';

const DEFAULTS = {
    states: { unconscious: 'Unconscious', bleeding: 'Bleeding out', bound: 'Bound', dead: 'Dead' },
    bleed: { chance: 0.25, overkillAt: 0.2, overkillChance: 0.35, bleedSeconds: [70, 130], tendItems: ['poultice', 'linen'] },
    bind: { items: ['rope'] },
    gag: { items: ['linen'] },
    rouse: { slapSeconds: 6, douseSeconds: 2, douseItems: ['wine'] },
    drag: { speed: 0.38 },
    boundCall: { callSeconds: 7, hearRadius: 9 },
    buryAlive: { cryEvery: 3.5, windowSeconds: 40, awakeWindowSeconds: 120, hearRadius: 8, rescueChance: 0.12, rescueSeconds: 10, offMapRescue: 0.15, rescuedDisposition: -70, cause: 'buried alive' },
    lines: {},
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

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

let _cfg = null;
let _cfgSrc;

export const Downed = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.downed : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const m = (k) => ({ ...DEFAULTS[k], ...(_obj(d[k]) || {}) });
            _cfg = {
                states: m('states'), bleed: m('bleed'), bind: m('bind'), gag: m('gag'), rouse: m('rouse'), drag: m('drag'),
                boundCall: m('boundCall'), buryAlive: m('buryAlive'), lines: { ...(_obj(d.lines) || {}) },
            };
        }
        return _cfg;
    },

    // ──────────── THE STATE ────────────

    /**
     * What a downed person is: 'dead' | 'bleeding' | 'unconscious' | 'bound' (awake, tied) | null (on their feet).
     * @param {object} npc an inner-map NPC (or a corpse: { dead: true })
     */
    stateOf(npc) {
        if (!npc) return null;
        if (npc.dead || npc.state === 'dead') return 'dead';
        if (npc.state === 'unconscious') return npc._bleed ? 'bleeding' : 'unconscious';
        if (npc._bound) return 'bound';
        return null;
    },

    /** The state as shown on hover and inspect ("Unconscious", "Bleeding out", "Dead"), and what else is so of them. */
    label(npc) {
        const st = Downed.stateOf(npc);
        if (!st) return null;
        const S = Downed.config().states;
        const extra = [];
        if (st !== 'bound' && npc._bound) extra.push(S.bound || 'Bound');
        if (npc._gagged) extra.push('Gagged');
        return [S[st] || st, ...extra].join(', ');
    },

    /** Is this person down (anything can be done to them)? */
    isDown(npc) {
        const st = Downed.stateOf(npc);
        return st === 'unconscious' || st === 'bleeding' || st === 'bound';
    },

    // ──────────── BLEEDING ────────────

    /**
     * Knocked out: are they bleeding out? A hard blow (overkill: the damage past 0 as a
     * share of their health) more likely. Draws on Utils' stream.
     * @returns {{ until:number }|null} when they die unless tended (ms, from now)
     */
    rollBleed(now, overkill = 0, rnd = Utils.random) {
        const B = Downed.config().bleed;
        let p = _num(B.chance, 0.25);
        if (_num(overkill) >= _num(B.overkillAt, 0.2)) p += _num(B.overkillChance, 0);
        if (rnd() >= Math.min(1, p)) return null;
        const [a, b] = Array.isArray(B.bleedSeconds) ? B.bleedSeconds : [70, 130];
        return { until: now + (a + rnd() * (b - a)) * 1000, at: now };
    },

    /** The item that would stop the bleeding (the first of tendItems the player carries), or null. */
    tendItem(inv) { return Downed._firstHeld(inv, Downed.config().bleed.tendItems); },
    bindItem(inv) { return Downed._firstHeld(inv, Downed.config().bind.items); },
    gagItem(inv) { return Downed._firstHeld(inv, Downed.config().gag.items); },
    douseItem(inv) { return Downed._firstHeld(inv, Downed.config().rouse.douseItems); },

    _firstHeld(inv, list) {
        for (const id of list || []) if (inv && _num(inv[id]) > 0) return id;
        return null;
    },

    /** Has their time run out (bled to death)? */
    bledOut(npc, now) {
        return !!(npc && npc._bleed && now >= _num(npc._bleed.until, Infinity));
    },

    // ──────────── ROUSING ────────────

    /**
     * Bring them round sooner: a slap or a douse cuts what's left of their senselessness.
     * @returns {number} the new wake time (ms)
     */
    rouse(ko, how, now) {
        const R = Downed.config().rouse;
        const secs = how === 'douse' ? _num(R.douseSeconds, 2) : _num(R.slapSeconds, 6);
        const until = _num(ko && ko.until, now);
        return Math.min(until, now + secs * 1000);
    },

    // ──────────── BOUND ────────────

    /**
     * What a bound person awake says now: they call for help (unless gagged — a muffled
     * cry), plead or threaten (the bold threaten). A hash of who and when.
     * @returns {{ kind:'call'|'plead'|'threaten'|'gagged', line:string|null, heard:boolean }}
     */
    boundLine(npc, seed = '') {
        const L = Downed.config().lines;
        const traits = (npc && npc.personalityTraits) || [];
        const bold = traits.some(t => ['bold', 'stern', 'stubborn', 'aggressive', 'proud'].includes(t));
        const f = _frac(`${seed}|${npc && npc.id}|bound`);
        let kind;
        if (npc && npc._gagged) kind = 'gagged';
        else if (f < 0.45) kind = 'call';
        else kind = bold ? 'threaten' : 'plead';
        const pool = L[kind] || [];
        const line = pool.length ? pool[Math.floor(_frac(`${seed}|${npc && npc.id}|line`) * pool.length) % pool.length] : null;
        return { kind, line, heard: kind === 'call' };
    },

    /** A drag's walk (slower than a carry: they are hauled along the ground). */
    dragSpeed() {
        return Math.max(0.1, Math.min(1, _num(Downed.config().drag.speed, 0.38)));
    },

    // ──────────── BURIED ALIVE ────────────

    /**
     * Lay someone living under the earth: how long they cry out before they die.
     * @param {object} npc
     * @param {number} now ms
     * @returns {{ until:number, awake:boolean, nextCry:number }}
     */
    liveBurial(npc, now) {
        const A = Downed.config().buryAlive;
        const awake = !!(npc && (npc._bound && npc.state !== 'unconscious'));
        const secs = awake ? _num(A.awakeWindowSeconds, 120) : _num(A.windowSeconds, 40);
        // (gagged: only a muffled mumble comes up through the earth)
        return { at: now, until: now + secs * 1000, awake, gagged: !!(npc && npc._gagged), nextCry: now + _num(A.cryEvery, 3.5) * 1000 };
    },

    /** They came round under the earth: the window stretches to the waking one (counted from now). */
    wakeUnderEarth(lb, now) {
        if (!lb || lb.awake) return lb;
        const A = Downed.config().buryAlive;
        lb.awake = true;
        lb.until = Math.max(lb.until, now + _num(A.awakeWindowSeconds, 120) * 1000 * 0.75);
        return lb;
    },

    /** Is there still breath under the mound? */
    stillAlive(lb, now) {
        return !!lb && now < _num(lb.until, 0);
    },

    /** A cry from under the earth, due now? (advances the next) Returns the line, or null. */
    cry(lb, now, seed = '') {
        if (!lb || now < lb.nextCry || now >= lb.until) return null;
        const A = Downed.config().buryAlive;
        const L = Downed.config().lines;
        // (fainter and further apart as the air runs out)
        const left = (lb.until - now) / Math.max(1, lb.until - lb.at);
        lb.nextCry = now + _num(A.cryEvery, 3.5) * 1000 * (1 + (1 - left));
        lb.cries = (lb.cries || 0) + 1;
        const pool = (lb.gagged ? (L.gagged || L.buriedWake) : lb.awake ? L.buried : (L.buriedWake || L.buried)) || [];
        return pool.length ? pool[Math.floor(_frac(`${seed}|${lb.cries}`) * pool.length) % pool.length] : '*muffled cries*';
    },

    /** How hard the earth stirs over them (0..1): strongest at first, fading as the air runs out. */
    stir(lb, now) {
        if (!Downed.stillAlive(lb, now)) return 0;
        const left = (lb.until - now) / Math.max(1, lb.until - lb.at);
        return (lb.awake ? 0.5 : 0.25) + 0.5 * left;
    },

    /** Does a passer-by who heard the cries go to dig? (Utils' stream) */
    rescueRoll(rnd = Utils.random) {
        return rnd() < _num(Downed.config().buryAlive.rescueChance, 0.12);
    },

    /** The player leaves the map with someone under the earth: was anyone near enough to hear and dig? */
    offMapRescue(lb, rnd = Utils.random) {
        if (!lb) return false;
        return rnd() < _num(Downed.config().buryAlive.offMapRescue, 0.15);
    },

    /**
     * Settle a burial record of someone buried alive: died under the earth (the true cause),
     * or rescued. Idempotent. Returns the record.
     * @param {object} g a world/burials.js record ({ buriedAlive: true })
     * @param {'died'|'rescued'} how
     * @param {number} day
     */
    settleBurial(g, how, day) {
        if (!g || !g.buriedAlive || g.aliveOutcome) return g;
        g.aliveOutcome = how === 'rescued' ? 'rescued' : 'died';
        if (g.aliveOutcome === 'died') {
            g.died = _num(day, _num(g.day));
            g.cause = Downed.config().buryAlive.cause || 'buried alive';
        }
        return g;
    },

    /** A burial of someone alive left unresolved (a save in the window; the player gone): they died there. */
    unresolved(g) {
        return !!(g && g.buriedAlive && !g.aliveOutcome);
    },

    /** A line from the pool (a hash of the seed). */
    line(kind, seed = '') {
        const pool = Downed.config().lines[kind] || [];
        return pool.length ? pool[Math.floor(_frac(`${seed}|${kind}`) * pool.length) % pool.length] : null;
    },
};

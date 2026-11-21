// ============================================
// LISTS — the rules of a tournament fought in person
// ============================================
// The street map's lists (world/innerMap/lists.js lays out the field,
// ui/innerMapTournament.js runs it) fight the same three-bout bracket as the
// menu's tournament (Duels.tournamentField / Duels.settleTournament), but in
// person: each bout is a JOUST or a MELEE on foot.
//
//   THE TOWNS' OWN TOURNAMENTS — townTourney(settlement, day): every
//   schedule.periodDays a town of a listed type holds one with chance[type],
//   on a day of the period hashed from the town (the shared RNG is never
//   drawn: the same towns hold them on the same days in every run of a seed).
//   The purse is the sponsor's (the crown's chests for a capital, else the
//   town's market purse) and the entry fee goes into that purse.
//
//   THE JOUST — a pass is the two riders charging along the tilt barrier.
//   A lance-meter runs from 0 to 1 over the charge; the strike lands best
//   in a window round impactAt (widened by the rider's skill, their own
//   horse, their armour), with the lance tip steadied by skill (aim).
//   strikeQuality → resolveLance: under missBelow the lance misses; else its
//   force (quality × the rider's attack, a jitter) against the other's seat
//   (defence, armour) is a glance, a broken lance or the man unhorsed.
//   Points per glance / broken lance; an unhorsing wins it outright. Best of
//   three passes, tie-breaks to maxPasses. An opponent's strike: aiStrike.
//
//   THE MELEE — blunted steel on the street map (ui/innerMapCombat.js): a
//   fighter yields at melee.yieldAt of their health; nobody dies.
//
// Every result comes back as a bout result Duels.settleTournament reads
// ({ playerWon, aLost, yielded }). Coin moves are the UI's (PlayerCoin):
// these are only the sums. Data: data/lists.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';

const DEFAULTS = {
    schedule: { periodDays: 40, chance: { capital: 0.7, city: 0.5, town: 0.3 }, announceDays: 4, openHour: 9, closeHour: 18 },
    prize: { capital: 360, city: 240, town: 150 },
    feeShare: 0.15,
    minFee: 10,
    hireHorse: 15,
    boutKinds: ['joust', 'melee', 'joust'],
    joust: {
        chargeSeconds: 2.6, impactAt: 0.86, window: 0.06, perSkill: 0.006, ownHorse: 0.012, perArmour: 0.03,
        aimSwing: 0.5, perSkillAim: 0.035, missBelow: 0.3,
        seat: { base: 0.42, perDefense: 0.04, perArmour: 0.35 },
        force: { base: 0.7, perAttack: 0.08, jitter: 0.12 },
        unhorseOver: 0.45, breakOver: 0.12,
        points: { glance: 1, broken: 2, unhorsed: 3 },
        passes: 3, maxPasses: 5,
        harm: { glance: 0.06, broken: 0.16, unhorsed: 0.55 },
    },
    ai: { timingSpread: 0.16, timingPerAttack: 0.012, aimSpread: 0.55, aimPerSkill: 0.04 },
    melee: { yieldAt: 0.2, hpScale: 3.5, forfeitDistance: 9 },
    wager: { stakes: [10, 25, 50], minOdds: 1.5, maxOdds: 6 },
    crowd: { miss: -0.1, glance: 0.05, broken: 0.15, unhorsed: 0.35, unhorsedYou: -0.3, won: 0.2, lost: -0.15, loveAt: 0.5, loveRenown: 1 },
    watch: { secondsBetween: 7 },
    barks: { cheer: ['Huzzah!'], groan: ['Ohh…'], unhorsed: ['Unhorsed!'], herald: ['Hear ye! The lists are open!'] },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A hash of the parts → [0, 1) (FNV-1a, finished). */
function _hash(...parts) {
    let h = 2166136261 >>> 0;
    for (const p of parts) {
        const s = String(p);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 0x7c; h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

/** A small seeded stream from a hash key (for the passes you only watch). */
function _stream(key) {
    let s = Math.floor(_hash(key) * 4294967296) >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

let _cfg = null;
let _cfgSrc;

export const Lists = {
    hash: _hash,
    stream: _stream,

    /** Settings (data/lists.json) over the defaults, one level merged. */
    config() {
        const src = DataLoader.get ? DataLoader.get('lists') : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const out = { ...DEFAULTS, ...d };
            for (const k of Object.keys(DEFAULTS)) {
                if (_obj(DEFAULTS[k])) out[k] = { ...DEFAULTS[k], ...(_obj(d[k]) || {}) };
            }
            out.joust = { ...out.joust, seat: { ...DEFAULTS.joust.seat, ...(_obj(out.joust.seat) || {}) }, force: { ...DEFAULTS.joust.force, ...(_obj(out.joust.force) || {}) }, points: { ...DEFAULTS.joust.points, ...(_obj(out.joust.points) || {}) }, harm: { ...DEFAULTS.joust.harm, ...(_obj(out.joust.harm) || {}) } };
            _cfg = out;
        }
        return _cfg;
    },

    // ──────────── THE TOWNS' OWN TOURNAMENTS ────────────

    /** A settlement's key for the schedule (its id, else its name and place). */
    townKey(s) {
        if (!s) return '';
        return s.id != null ? `s${s.id}` : `${s.name || 'town'}@${_num(s.q)},${_num(s.r)}`;
    },

    /** The entry fee for a purse: feeShare of it, whole gold, at least minFee. */
    entryFee(prizePool) {
        const C = Lists.config();
        return Math.max(_num(C.minFee, 10), Math.round(_num(prizePool) * _num(C.feeShare, 0.15)));
    },

    /**
     * The tournament a town holds in the schedule period that `day` falls in,
     * or null: { day, key, prizePool, fee, host: 'town' }. Pure hash.
     */
    townTourneyInPeriod(settlement, period) {
        const C = Lists.config();
        const S = C.schedule;
        const chance = _num((S.chance || {})[settlement && settlement.type], 0);
        if (!settlement || !(chance > 0) || settlement.dawnBorn) return null;
        const key = Lists.townKey(settlement);
        if (_hash(key, period, 'held') >= chance) return null;
        const len = Math.max(1, Math.round(_num(S.periodDays, 40)));
        const day = period * len + Math.floor(_hash(key, period, 'day') * len);
        const prizePool = Math.round(_num((C.prize || {})[settlement.type], 150));
        return { day, key, prizePool, fee: Lists.entryFee(prizePool), host: 'town' };
    },

    /** The town's own tournament held on `day` exactly, or null. */
    townTourney(settlement, day) {
        const len = Math.max(1, Math.round(_num(Lists.config().schedule.periodDays, 40)));
        const t = Lists.townTourneyInPeriod(settlement, Math.floor(_num(day) / len));
        return t && t.day === Math.floor(_num(day)) ? t : null;
    },

    /** The next town tournament from `day` on (within announceDays), or null: { ...t, inDays }. */
    upcoming(settlement, day) {
        const C = Lists.config();
        const len = Math.max(1, Math.round(_num(C.schedule.periodDays, 40)));
        const d = Math.floor(_num(day));
        const ahead = Math.max(0, _num(C.schedule.announceDays, 4));
        for (const p of [Math.floor(d / len), Math.floor(d / len) + 1]) {
            const t = Lists.townTourneyInPeriod(settlement, p);
            if (t && t.day >= d && t.day - d <= ahead) return { ...t, inDays: t.day - d };
        }
        return null;
    },

    /** Is the field up at this hour? */
    open(hour) {
        const S = Lists.config().schedule;
        return _num(hour, 12) >= _num(S.openHour, 9) && _num(hour, 12) < _num(S.closeHour, 18);
    },

    /**
     * Who pays the purse of a town's own tournament: the crown's chests for a
     * capital of a realm (world.getKingdom), else the town itself.
     */
    sponsor(settlement, world) {
        if (settlement && settlement.type === 'capital' && settlement.kingdom != null && world && typeof world.getKingdom === 'function') {
            const k = world.getKingdom(settlement.kingdom);
            if (k && 'treasury' in k) return k;
        }
        return settlement || null;
    },

    // ──────────── THE JOUST ────────────

    /**
     * A combatant as a rider: { attack, defense, armour, skill, ownHorse }.
     * opts.skill overrides the combatant's (the player's combat level).
     */
    riderOf(c, opts = {}) {
        return {
            attack: _num(c && c.attack, 3),
            defense: _num(c && c.defense, 3),
            armour: _clamp(_num(c && c.armour), 0, 0.9),
            skill: _num(opts.skill, _num(c && c.skill, 3)),
            ownHorse: !!opts.ownHorse,
        };
    },

    /** The half-width of the strike window on the lance-meter (0..1) for a rider. */
    window(rider) {
        const J = Lists.config().joust;
        const sk = Math.max(0, _num(rider && rider.skill, 1) - 1);
        return _clamp(_num(J.window, 0.06) + sk * _num(J.perSkill, 0.006)
            + (rider && rider.ownHorse ? _num(J.ownHorse, 0.012) : 0)
            + _clamp(_num(rider && rider.armour), 0, 0.9) * _num(J.perArmour, 0.03), 0.02, 0.2);
    },

    /** How far the lance tip wobbles (the aim's amplitude, 0..1) for a rider. */
    aimSwing(rider) {
        const J = Lists.config().joust;
        const sk = Math.max(0, _num(rider && rider.skill, 1) - 1);
        return _clamp(_num(J.aimSwing, 0.5) - sk * _num(J.perSkillAim, 0.035), 0.08, 1);
    },

    /** Where the lance-meter's needle stands `t` seconds into a charge (0..1+). */
    meterAt(t) {
        return Math.max(0, _num(t)) / Math.max(0.1, _num(Lists.config().joust.chargeSeconds, 2.6));
    },

    /** The lance tip's wobble `t` seconds into a charge, for a rider (−amp..amp). */
    aimAt(t, rider, phase = 0) {
        const amp = Lists.aimSwing(rider);
        return amp * Math.sin(_num(t) * 5.3 + phase) * (0.75 + 0.25 * Math.sin(_num(t) * 2.1 + phase * 1.7));
    },

    /**
     * How good a strike is (0..1): its timing on the meter against the window
     * round impactAt, and how true the lance tip was (aim: 0 dead on, ±1 wide).
     * timing null (no strike made) is 0.
     */
    strikeQuality({ timing, aim = 0, window = 0.06 } = {}) {
        if (timing == null || !Number.isFinite(timing)) return 0;
        const J = Lists.config().joust;
        const W = Math.max(0.01, _num(window, 0.06));
        const err = Math.abs(timing - _num(J.impactAt, 0.86));
        const tq = err <= W ? 1 - 0.25 * (err / W) : Math.max(0, 0.75 * (1 - (err - W) / (3 * W)));
        const aq = Math.max(0, 1 - Math.abs(_num(aim)));
        return _clamp(tq * (0.55 + 0.45 * aq), 0, 1);
    },

    /** What a lance of `quality` from `attacker` does to `defender`: 'miss' | 'glance' | 'broken' | 'unhorsed'. */
    resolveLance(quality, attacker, defender, rng = () => Utils.random()) {
        const J = Lists.config().joust;
        if (!(quality >= _num(J.missBelow, 0.3))) return 'miss';
        const F = J.force, S = J.seat;
        const force = quality * (_num(F.base, 0.7) + _num(attacker && attacker.attack, 3) * _num(F.perAttack, 0.08))
            + (rng() * 2 - 1) * _num(F.jitter, 0.12);
        const seat = _num(S.base, 0.42) + _num(defender && defender.defense, 3) * _num(S.perDefense, 0.04)
            + _clamp(_num(defender && defender.armour), 0, 0.9) * _num(S.perArmour, 0.35);
        const margin = force - seat;
        if (margin > _num(J.unhorseOver, 0.45)) return 'unhorsed';
        if (margin > _num(J.breakOver, 0.12)) return 'broken';
        return 'glance';
    },

    /** An opponent's strike: { timing, aim }, its spread narrowing with their attack and skill. */
    aiStrike(rider, rng = () => Utils.random()) {
        const A = Lists.config().ai;
        const J = Lists.config().joust;
        const tSpread = Math.max(0.02, _num(A.timingSpread, 0.16) - _num(rider && rider.attack, 3) * _num(A.timingPerAttack, 0.012));
        const aSpread = Math.max(0.05, _num(A.aimSpread, 0.55) - _num(rider && rider.skill, 3) * _num(A.aimPerSkill, 0.04));
        return {
            timing: _num(J.impactAt, 0.86) + (rng() - rng()) * tSpread * 2,
            aim: (rng() * 2 - 1) * aSpread,
        };
    },

    /**
     * One pass. a / b: { rider, strike: { timing, aim } } (a the player's side).
     * → { a: what a's lance did to b, b: what b's lance did to a, aQ, bQ }
     */
    resolvePass(a, b, rng = () => Utils.random()) {
        const aQ = Lists.strikeQuality({ ...(a.strike || {}), window: Lists.window(a.rider) });
        const bQ = Lists.strikeQuality({ ...(b.strike || {}), window: Lists.window(b.rider) });
        return {
            a: Lists.resolveLance(aQ, a.rider, b.rider, rng),
            b: Lists.resolveLance(bQ, b.rider, a.rider, rng),
            aQ: Math.round(aQ * 100) / 100,
            bQ: Math.round(bQ * 100) / 100,
        };
    },

    /** A fresh joust's score sheet. */
    newJoust() {
        return { passes: [], aPts: 0, bPts: 0, aQ: 0, bQ: 0, over: false, winner: null };
    },

    /**
     * Score a pass onto the sheet: points for each lance, an unhorsing ends it
     * (both unhorsed: the points decide); best of `passes`, tie-breaks to maxPasses.
     */
    scorePass(state, pass) {
        const J = Lists.config().joust;
        const P = J.points;
        state.passes.push(pass);
        state.aPts += _num(P[pass.a]);
        state.bPts += _num(P[pass.b]);
        state.aQ += _num(pass.aQ);
        state.bQ += _num(pass.bQ);
        const n = state.passes.length;
        const aDown = pass.b === 'unhorsed', bDown = pass.a === 'unhorsed';
        if (aDown !== bDown) { state.over = true; state.winner = bDown ? 'a' : 'b'; return state; }
        if (aDown && bDown) {
            state.over = true;
            state.winner = state.aPts !== state.bPts ? (state.aPts > state.bPts ? 'a' : 'b') : (state.aQ >= state.bQ ? 'a' : 'b');
            return state;
        }
        if (n >= _num(J.passes, 3) && state.aPts !== state.bPts) { state.over = true; state.winner = state.aPts > state.bPts ? 'a' : 'b'; return state; }
        if (n >= _num(J.maxPasses, 5)) { state.over = true; state.winner = state.aQ >= state.bQ ? 'a' : 'b'; }
        return state;
    },

    /** A finished joust as a bout result for Duels.settleTournament. */
    joustResult(state) {
        const H = Lists.config().joust.harm;
        const lost = (side) => _clamp(state.passes.reduce((t, p) => t + _num(H[p[side]]), 0), 0, 1);
        return {
            mode: 'tournament', kind: 'joust',
            winner: state.winner, playerWon: state.winner === 'a', draw: false, yielded: null,
            aLost: Math.round(lost('b') * 100) / 100,
            bLost: Math.round(lost('a') * 100) / 100,
            passes: state.passes.slice(), aPts: state.aPts, bPts: state.bPts,
        };
    },

    /**
     * A whole joust fought without input (the dice's joust, or one you watch):
     * both sides strike as aiStrike has them. → the finished score sheet.
     */
    autoJoust(aRider, bRider, rng = () => Utils.random()) {
        const st = Lists.newJoust();
        let guard = 0;
        while (!st.over && guard++ < 10) {
            const pass = Lists.resolvePass({ rider: aRider, strike: Lists.aiStrike(aRider, rng) }, { rider: bRider, strike: Lists.aiStrike(bRider, rng) }, rng);
            Lists.scorePass(st, pass);
        }
        return st;
    },

    // ──────────── THE MELEE ────────────

    /** A knight's health for the melee on the street map (their duel hp, scaled to the map's numbers). */
    meleeHp(c) {
        return Math.max(20, Math.round(_num(c && c.maxHp, 28) * _num(Lists.config().melee.hpScale, 3.5)));
    },

    /** Does a fighter at `hp` of `max` yield now? */
    shouldYield(hp, max) {
        return _num(hp) <= Math.max(1, _num(max, 100)) * _num(Lists.config().melee.yieldAt, 0.2);
    },

    /**
     * A finished melee as a bout result. { playerWon, hpBefore, hpAfter,
     * maxHealth, foeHp, foeMax } — the player's health lost is the share of
     * the bout pool (Duels.settleTournament's harm reads it).
     */
    meleeResult({ playerWon, hpBefore, hpAfter, maxHealth, foeHp, foeMax } = {}) {
        const max = Math.max(1, _num(maxHealth, 100));
        return {
            mode: 'tournament', kind: 'melee',
            winner: playerWon ? 'a' : 'b', playerWon: !!playerWon, draw: false,
            yielded: playerWon ? 'b' : 'a',
            aLost: Math.round(_clamp((_num(hpBefore, max) - _num(hpAfter, max)) / max, 0, 1) * 100) / 100,
            bLost: Math.round(_clamp(1 - _num(foeHp) / Math.max(1, _num(foeMax, 1)), 0, 1) * 100) / 100,
        };
    },

    // ──────────── WAGERS AND THE CROWD ────────────

    /** A combatant's strength (as the bracket sorts them). */
    strength(c) {
        return _num(c && c.attack) + _num(c && c.defense) * 0.6 + _num(c && c.power) * 0.3 + _num(c && c.maxHp) * 0.05;
    },

    /** The odds a bookie gives on you taking the whole tournament (×, the stake back included), to the half. */
    wagerOdds(me, field) {
        const W = Lists.config().wager;
        const s = Lists.strength(me);
        let p = 1;
        for (const o of field || []) p *= _clamp(0.5 + (s - Lists.strength(o)) * 0.05, 0.12, 0.92);
        const odds = Math.round((0.9 / Math.max(0.01, p)) * 2) / 2;
        return _clamp(odds, _num(W.minOdds, 1.5), _num(W.maxOdds, 6));
    },

    /** What a wager pays (the stake back included): stake × odds on a champion, nothing otherwise. Whole cents. */
    wagerPayout(stake, odds, champion) {
        return champion ? Utils.cents(_num(stake) * _num(odds, 1)) : 0;
    },

    /** The crowd's mood after an event (miss / glance / broken / unhorsed / unhorsedYou / won / lost): −1..1. */
    crowdStep(mood, event) {
        return Math.round(_clamp(_num(mood) + _num(Lists.config().crowd[event]), -1, 1) * 100) / 100;
    },

    /** A bark for the crowd or the herald: kind cheer / groan / unhorsed / herald, picked by `u` in [0, 1). */
    bark(kind, u = 0) {
        const list = (Lists.config().barks || {})[kind] || DEFAULTS.barks[kind] || [];
        return list.length ? list[Math.floor(_clamp(u, 0, 0.9999) * list.length)] : '';
    },
};

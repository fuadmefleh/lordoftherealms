// ============================================
// PERFORMING — street acts, rites and stillness, scored
// ============================================
// Busking, devotion rites and meditation are done in person on the street
// map (ui/mapTasks/performTasks.js). This module holds the arithmetic that
// can be reasoned about without a screen: how big a crowd a town should
// give, how each act's choices land (songs by the hour, a tale's turns, a
// sermon's fervour, a fortune that fits its hearer), and the final score.
//
// Pure: everything is a parameter, randomness only from the rng passed in.
// Settings come from data/performTasks.json (`cfg` arguments).

import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function _data() {
    return (DataLoader.get && DataLoader.get('performTasks')) || {};
}

/** Time factor shared by every score: full on par, falling to `floor` when slow. */
function _timeFactor(elapsedHours, parHours, floor = 0.35) {
    const par = Math.max(0.1, _num(parHours, 1.5));
    const el = Math.max(0, _num(elapsedHours));
    return el <= par ? 1 : Math.max(floor, par / el);
}

export const Performing = {
    data: _data,

    /** Settings of a busking act (data busking.acts[id]). */
    act(id) {
        const b = _data().busking || {};
        return (b.acts || {})[id] || null;
    },

    /** The crowd a town of this size should give at a good pitch. */
    expectedCrowd(crowdMult, cfg = {}) {
        return Math.max(_num(cfg.minExpected, 1.5), _num(cfg.expectedPerCrowd, 4) * _num(crowdMult, 1));
    },

    /**
     * How the show went, 0..1, from what each set was worth (listeners ×
     * that set's multiplier) against the crowd the town should give.
     */
    crowdQuality(setValues, expected) {
        if (!setValues || !setValues.length) return 0;
        const avg = setValues.reduce((a, b) => a + _num(b), 0) / setValues.length;
        return _clamp(avg / Math.max(0.5, _num(expected, 4)), 0, 1);
    },

    /**
     * The busking reward's 0–100 score. Unlike day labour the crowd is the
     * whole of it: an empty street pays (almost) nothing however tidily done.
     * @param {object} o { done, total, elapsedHours, parHours, quality 0..1 }
     */
    performScore(o) {
        const total = Math.max(1, _num(o.total, 1));
        const done = _clamp(_num(o.done), 0, total);
        const q = _clamp(_num(o.quality), 0, 1);
        return Math.round(_clamp(100 * (done / total) * _timeFactor(o.elapsedHours, o.parHours) * q, 0, 100));
    },

    /** Chance to fumble a juggling set at this dexterity. */
    dropChance(stat, cfg = {}) {
        return _clamp(_num(cfg.base, 0.45) - _num(stat, 5) * _num(cfg.perStat, 0.04), _num(cfg.min, 0.05), _num(cfg.max, 0.4));
    },

    /** Whether the hour falls in a song's hours [from, to) (to may run past midnight: 26 = 2am). */
    inHours(hours, hour) {
        if (!hours) return true;
        const [a, b] = hours;
        const h = ((_num(hour) % 24) + 24) % 24;
        return (h >= a && h < b) || (h + 24 >= a && h + 24 < b);
    },

    /** A song's worth at this hour; singing the same song again is worth less. */
    songMult(song, hour, prevId, cfg = {}) {
        let m = Performing.inHours(song && song.hours, hour) ? _num(cfg.inHours, 1.25) : _num(cfg.outHours, 0.7);
        if (prevId && song && song.id === prevId) m *= _num(cfg.repeat, 0.8);
        return m;
    },

    /**
     * A tale's turn: the same kind of turn twice running falls flat; a kind
     * not yet told in this tale lands best.
     */
    beatMult(mood, prevMood, usedMoods, cfg = {}) {
        if (prevMood && mood === prevMood) return _num(cfg.repeat, 0.5);
        if (!usedMoods || !usedMoods.includes(mood)) return _num(cfg.fresh, 1.2);
        return _num(cfg.again, 1.0);
    },

    /** n beats of distinct moods, drawn with the rng. */
    pickBeats(beats, n, rng) {
        const pool = beats.slice();
        const out = [];
        while (out.length < n && pool.length) {
            const i = Math.floor(rng() * pool.length);
            const b = pool.splice(i, 1)[0];
            if (!out.some(o => o.mood === b.mood)) out.push(b);
        }
        return out;
    },

    /**
     * A sermon's next tone: fervour falls a little each set and rises by the
     * tone. Too cold and they drift off; too hot and they're frightened away.
     * @returns {{ fervor, mood: 'cold'|'warm'|'sweet'|'frightened', mult }}
     */
    fervorStep(fervor, tone, cfg = {}) {
        const f = _clamp(_num(fervor, _num(cfg.start, 30)) - _num(cfg.decay, 6) + _num(tone && tone.fervor), 0, 100);
        const sweet = cfg.sweet || [50, 85];
        let mood = 'warm';
        if (f >= _num(cfg.frightened, 90)) mood = 'frightened';
        else if (f >= sweet[0] && f <= sweet[1]) mood = 'sweet';
        else if (f < _num(cfg.cold, 30)) mood = 'cold';
        const mult = { cold: _num(cfg.multCold, 0.6), warm: _num(cfg.multWarm, 1), sweet: _num(cfg.multSweet, 1.25), frightened: _num(cfg.multFrightened, 0.5) }[mood];
        return { fervor: f, mood, mult };
    },

    /** Whether a fortune fits the hearer (an NPC type). */
    fortuneFits(fortune, npcType) {
        return !!(fortune && fortune.fits && fortune.fits.includes(npcType));
    },

    /**
     * Three fortunes to choose from for a hearer: one that fits (when any
     * does) and two that don't, shuffled.
     */
    fortuneChoices(fortunes, npcType, rng, n = 3) {
        const fits = fortunes.filter(f => Performing.fortuneFits(f, npcType));
        const misses = fortunes.filter(f => !Performing.fortuneFits(f, npcType));
        const out = [];
        if (fits.length) out.push(fits[Math.floor(rng() * fits.length)]);
        const pool = misses.slice();
        while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    },

    /**
     * A prayer rite's quality 0..1: the steps done, in good time, unbroken.
     * @param {object} o { done, total, elapsedHours, parHours, disturbances, stat (faith), perDisturb }
     */
    riteQuality(o) {
        const total = Math.max(1, _num(o.total, 1));
        const done = _clamp(_num(o.done), 0, total);
        const calm = Math.max(0.4, 1 - _num(o.disturbances) * _num(o.perDisturb, 0.08));
        const faith = 0.85 + _clamp(_num(o.stat, 5), 0, 10) * 0.015;
        return _clamp((done / total) * _timeFactor(o.elapsedHours, o.parHours, 0.5) * calm * faith, 0, 1);
    },

    /**
     * A meditation's quality 0..1: how long you sat against how long was
     * needed, less every passer-by who broke your focus (fewer at a holy
     * site) and every time you got up.
     * @param {object} o { sat, needed, disturbances, breaks, stat, holy }, cfg = data meditation
     */
    stillnessQuality(o, cfg = {}) {
        const part = _clamp(_num(o.sat) / Math.max(1, _num(o.needed, _num(cfg.sitSeconds, 30))), 0, 1);
        const per = _num(cfg.perDisturb, 0.12) * (o.holy ? _num(cfg.holyFactor, 0.5) : 1);
        const lost = _num(o.disturbances) * per + _num(o.breaks) * _num(cfg.perBreak, 0.15);
        const mind = _clamp(_num(o.stat, 5), 0, 10) * 0.01;
        if (part <= 0) return 0;
        return _clamp(part * (1 - lost) + mind, 0.05, 1);
    },

    /** Fill {key} placeholders in a data line. */
    line(text, vars = {}) {
        return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    },
};

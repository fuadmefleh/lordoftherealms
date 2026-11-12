// ============================================
// DIFFICULTY — the game's challenge, and the life's scenario record
// ============================================
// player.scenario = { id, difficulty, victory, guidedStart, victoryAchieved, startDay }
// is set at game start (player/scenarios.js applies the chosen Origin) and
// saved with the player. Old saves and hand-made maps carry none: they read as
// the Wanderer on Normal with no victory goal.
//
// Difficulty is a handful of multipliers (data/scenarios.json → difficulty),
// each read at one place in the rules:
//   startGold      — the purse an Origin starts with (player/scenarios.js)
//   buyPrice       — what the player pays at a market (player/playerEconomy/trading.js)
//   sellPrice      — what the player is paid at a market (trading.js)
//   hostility      — how badly realms want war with the player (systems/realmWars.js)
//   enemyStrength  — the foe's might in the player's battles (playerMilitary/combat.js, fieldBattle.js),
//                    on the road (player/roadEncounters.js: every escape/fight chance, the toll,
//                    the harm of the old ambush) and in the wilds' fights (player/wilds.js)
//   illness        — how often sickness is caught (systems/ailments.js _tryCatch) and how
//                    often wounds fester and sickness kills (ailments.js careFactor)
// Normal is 1 on every knob, so a Normal game runs exactly as one without
// difficulty did. No RNG here.

import { DataLoader } from './dataLoader.js';

const EMPTY = Object.freeze({});
const KNOBS = ['startGold', 'buyPrice', 'sellPrice', 'hostility', 'enemyStrength', 'illness'];

const DEFAULT_LEVELS = {
    easy:   { name: 'Easy',   startGold: 1.5, buyPrice: 0.9,  sellPrice: 1.1,  hostility: 0.6, enemyStrength: 0.8, illness: 0.6 },
    normal: { name: 'Normal', startGold: 1,   buyPrice: 1,    sellPrice: 1,    hostility: 1,   enemyStrength: 1,   illness: 1 },
    hard:   { name: 'Hard',   startGold: 0.6, buyPrice: 1.1,  sellPrice: 0.92, hostility: 1.3, enemyStrength: 1.2, illness: 1.3 },
    brutal: { name: 'Brutal', startGold: 0.3, buyPrice: 1.2,  sellPrice: 0.85, hostility: 1.6, enemyStrength: 1.4, illness: 1.6 },
};

const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const Difficulty = {
    KNOBS,
    DEFAULT_KEY: 'normal',

    /** { key: { name, blurb, ...knobs } } — data/scenarios.json over the code defaults. */
    levels() {
        const src = _obj(DataLoader._gamedata && DataLoader._gamedata.scenarios);
        const data = (src && _obj(src.difficulty)) || EMPTY;
        if (Difficulty._cache && Difficulty._cacheSrc === data) return Difficulty._cache;
        const out = {};
        for (const key of new Set([...Object.keys(DEFAULT_LEVELS), ...Object.keys(data)])) {
            if (key.startsWith('_')) continue;
            const base = DEFAULT_LEVELS[key] || DEFAULT_LEVELS.normal;
            const over = _obj(data[key]) || {};
            const lvl = { ...base, ...over, key };
            for (const k of KNOBS) lvl[k] = _num(lvl[k], 1);
            out[key] = lvl;
        }
        // Normal is the game as it was: always 1 on every knob
        for (const k of KNOBS) out.normal[k] = 1;
        Difficulty._cache = out;
        Difficulty._cacheSrc = data;
        return out;
    },

    /** A blank scenario record: the Wanderer on Normal, no goal. */
    blank() {
        return { id: 'wanderer', difficulty: 'normal', victory: 'none', guidedStart: true, victoryAchieved: null, startDay: 0 };
    },

    /** The player's scenario record, backfilled for old saves (and repaired if damaged). */
    state(player) {
        if (!player) return Difficulty.blank();
        const blank = Difficulty.blank();
        if (!_obj(player.scenario)) player.scenario = blank;
        const sc = player.scenario;
        if (typeof sc.id !== 'string' || !sc.id) sc.id = blank.id;
        if (!Difficulty.levels()[sc.difficulty]) sc.difficulty = blank.difficulty;
        if (typeof sc.victory !== 'string' || !sc.victory) sc.victory = blank.victory;
        if (typeof sc.guidedStart !== 'boolean') sc.guidedStart = sc.id === 'wanderer';
        if (sc.victoryAchieved === undefined) sc.victoryAchieved = null;
        if (!Number.isFinite(sc.startDay)) sc.startDay = 0;
        return sc;
    },

    /** The difficulty key the player is on ('normal' without a record). Never writes. */
    key(player) {
        const k = player && _obj(player.scenario) ? player.scenario.difficulty : null;
        return k && Difficulty.levels()[k] ? k : Difficulty.DEFAULT_KEY;
    },

    /** The difficulty level definition the player is on. */
    level(player) {
        return Difficulty.levels()[Difficulty.key(player)];
    },

    /** A knob's multiplier for the player (1 on Normal, or with no player). Never writes. */
    mult(player, knob) {
        if (!player || !_obj(player.scenario)) return 1;
        const lvl = Difficulty.levels()[player.scenario.difficulty];
        return lvl ? _num(lvl[knob], 1) : 1;
    },

    /**
     * A chance of getting the better of a foe, re-weighed by the enemyStrength
     * knob as odds: p / (p + (1 - p) * m). Exactly p on Normal (m = 1) and at
     * the certain/impossible ends.
     */
    againstFoe(player, p) {
        const m = Difficulty.mult(player, 'enemyStrength');
        if (m === 1 || !(p > 0 && p < 1)) return p;
        return p / (p + (1 - p) * m);
    },

    /** Harm (or a toll) a foe deals, scaled by the enemyStrength knob; exactly n on Normal. */
    foeHarm(player, n) {
        const m = Difficulty.mult(player, 'enemyStrength');
        if (m === 1 || !Number.isFinite(n)) return n;
        return Math.round(n * m);
    },

    /**
     * The scenario a new life inherits from the old one (player/afterlife.js
     * becomeStranger): the same difficulty and goal, a new origin, no guided
     * start, and the goal not yet won in this life.
     */
    carry(old, world = null) {
        const prev = old && _obj(old.scenario) ? old.scenario : Difficulty.blank();
        return {
            ...Difficulty.blank(),
            id: 'stranger',
            difficulty: Difficulty.levels()[prev.difficulty] ? prev.difficulty : 'normal',
            victory: typeof prev.victory === 'string' ? prev.victory : 'none',
            guidedStart: false,
            victoryAchieved: null,
            startDay: _num(world && world.day, 0),
            pastVictories: [
                ...(Array.isArray(prev.pastVictories) ? prev.pastVictories : []),
                ...(prev.victoryAchieved ? [prev.victoryAchieved] : []),
            ],
        };
    },
};

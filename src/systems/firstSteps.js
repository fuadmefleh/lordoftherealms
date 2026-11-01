// ============================================
// FIRST STEPS — the guided first month
// ============================================
// A short chain of beginner steps (data/firstSteps.json): see a day through,
// scout, take day work, trade, talk to the townsfolk, take a task, sleep at an
// inn, give the House an Ambition, travel to a second town. Each step names a
// reader (READERS below) that looks at real player/world state — the odd-jobs
// count, the price book's deals, the relationships, the notice board's
// bounties and the quest log, the night's rest, the House's ambition, the
// towns visited — so a step is done when the thing is done, by whatever path
// and in any order. The tracker shows the first step not yet done.
//
// Counters the player may already have at the start (a scenario's family or
// trade, say) are taken as a baseline at initialize, so a step asks for one
// MORE than there was.
//
// check(player, world) is cheap and is run on each HUD refresh (ui/ui/hud.js
// → ui/firstStepsCard.js) and at the end of each day (processDay); a newly
// done step pays its reward once (gold on the ledger as `firstSteps`,
// renown), and the last one pays the final reward (gold, renown, House
// Prestige) and is read by the First Steps achievement.
//
// Only the character the game began with is guided: an heir or a new life
// (another House generation, or a Player without the record) is not, and
// saves from before this system load with it off (legacy). Skipping stops
// the tracking; resuming picks it up again (steps done meanwhile then count).
//
// State: player.firstSteps (saved with the player — systems/saveLoad.js).
// Draws no RNG; world / player are passed in; no import-time effects.

import { DataLoader } from '../core/dataLoader.js';
import { Ledger } from './ledger.js';
import { House } from './house.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _day = (world) => _num(world && world.day, 0);
const _size = (v) => (v instanceof Set ? v.size : Array.isArray(v) ? v.length : 0);

const STARTER_QUEST = 'a_new_beginning';

const DEFAULTS = { ledgerCategory: 'firstSteps', steps: [], final: { title: 'First Steps taken', text: '', gold: 0, renown: 0, prestige: 0 } };

let _cfgSrc;
let _cfg = null;

// ── Counters the readers compare with their baseline ─────────────

/** Deals struck at any market (units bought + sold, from the price book). */
function _trades(player) {
    const book = _obj(player && player.priceBook);
    const goods = book && _obj(book.pnl) && _obj(book.pnl.goods);
    if (!goods) return 0;
    let n = 0;
    for (const g of Object.values(goods)) if (_obj(g)) n += _num(g.bought) + _num(g.sold);
    return n;
}

/** People the player has actually dealt with (a conversation on record or a changed regard). */
function _people(player) {
    const rels = _obj(player && player.relationships);
    if (!rels) return 0;
    let n = 0;
    for (const r of Object.values(rels)) if (_obj(r) && (_arr(r.history).length > 0 || _num(r.score) !== 0)) n++;
    return n;
}

/** Bounties taken (open and finished). */
function _bounties(player) {
    return _arr(player && player.activeBounties).length + _num(player && player.bountiesCompleted);
}

/** Quests taken other than the starter (open and finished). */
function _quests(player) {
    const qs = _obj(player && player.quests);
    if (!qs) return 0;
    const notStarter = (q) => q && q.id !== STARTER_QUEST;
    return _arr(qs.active).filter(notStarter).length + _arr(qs.completed).filter(notStarter).length;
}

function _visits(player) {
    const qs = _obj(player && player.quests);
    return qs ? _size(qs.settlementsVisited) : 0;
}

function _baseline(player) {
    return {
        jobs: _num(player && player.jobsCompleted),
        trades: _trades(player),
        people: _people(player),
        bounties: _bounties(player),
        quests: _quests(player),
        visits: _visits(player),
    };
}

/**
 * Step readers: (player, world, fs) → true when the step is done. Each reads
 * state another system keeps; none writes.
 */
const READERS = {
    dayPassed: (p, w, fs) => _day(w) > _num(fs.startDay),
    starterQuest: (p) => {
        const qs = _obj(p.quests);
        if (!qs) return false;
        if (_arr(qs.completed).some(q => q && q.id === STARTER_QUEST)) return true;
        // Never granted (a custom start): there is nothing to finish
        return !_arr(qs.active).some(q => q && q.id === STARTER_QUEST);
    },
    oddJob: (p, w, fs) => _num(p.jobsCompleted) > fs.base.jobs,
    market: (p, w, fs) => _trades(p) > fs.base.trades,
    meetPeople: (p, w, fs) => _people(p) > fs.base.people,
    noticeBoard: (p, w, fs) => _bounties(p) > fs.base.bounties || _quests(p) > fs.base.quests,
    // The night just slept at an inn (player/core/lifecycle.js), or a room booked for tonight (systems/hospitality.js)
    inn: (p, w) => p._lastRestType === 'inn' || !!(_obj(p.lodging) && p.lodging.night === _day(w)),
    ambition: (p) => !_obj(p.house) || !!p.house.ambition,
    secondTown: (p, w, fs) => _visits(p) >= Math.max(2, fs.base.visits + 1),
};

export const FirstSteps = {
    READERS,

    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.firstSteps) || null;
        if (!_cfg || d !== _cfgSrc) {
            _cfgSrc = d;
            const o = d || {};
            _cfg = {
                ...DEFAULTS, ...o,
                steps: _arr(o.steps).filter(s => _obj(s) && s.id && READERS[s.check]),
                final: { ...DEFAULTS.final, ...(_obj(o.final) || {}) },
            };
        }
        return _cfg;
    },

    steps() {
        return FirstSteps.config().steps;
    },

    /** Begin the guided month for a new character (enabled: false keeps the record but guides nothing). */
    initialize(player, world, { enabled = true } = {}) {
        if (!player) return null;
        player.firstSteps = {
            enabled: !!enabled,
            skipped: false,
            collapsed: false,
            legacy: false,
            retired: false,
            startDay: _day(world),
            generation: _num(player.house && player.house.generation, 1),
            base: _baseline(player),
            done: {},
            finishedDay: null,
        };
        return player.firstSteps;
    },

    /** The record, or null (heirs, new lives and players from before the system have none). */
    state(player) {
        return _obj(player && player.firstSteps);
    },

    /** Guiding now: on, not skipped, not finished, still the character it began with. */
    isActive(player) {
        const fs = FirstSteps.state(player);
        return !!(fs && fs.enabled && !fs.skipped && !fs.retired && fs.finishedDay == null);
    },

    /** Can the player (re)open the guidance? Not for old saves, heirs or a finished month. */
    canResume(player) {
        const fs = FirstSteps.state(player);
        // (an heir never resumes the founder's guidance: check() would retire it at once)
        const heir = _obj(player.house) && _num(player.house.generation, 1) > _num(fs && fs.generation, 1);
        return !!(fs && !fs.legacy && !fs.retired && !heir && fs.finishedDay == null && (!fs.enabled || fs.skipped));
    },

    isDone(player, id) {
        const fs = FirstSteps.state(player);
        return !!(fs && fs.done && fs.done[id] != null);
    },

    /** The first step not yet done (the tracker's), or null. */
    current(player) {
        const fs = FirstSteps.state(player);
        if (!fs) return null;
        return FirstSteps.steps().find(s => fs.done[s.id] == null) || null;
    },

    /** What the tracker card shows. */
    view(player) {
        const fs = FirstSteps.state(player);
        const steps = FirstSteps.steps();
        const doneCount = fs ? steps.filter(s => fs.done[s.id] != null).length : 0;
        const step = FirstSteps.current(player);
        return {
            active: FirstSteps.isActive(player),
            canResume: FirstSteps.canResume(player),
            collapsed: !!(fs && fs.collapsed),
            step,
            index: step ? steps.indexOf(step) : steps.length,
            doneCount,
            total: steps.length,
            finished: !!(fs && fs.finishedDay != null),
        };
    },

    /** Pay a reward: gold (on the ledger), renown, House Prestige. Returns the reward's words. */
    _pay(player, world, reward, reason) {
        const r = _obj(reward) || {};
        const parts = [];
        const gold = Math.round(_num(r.gold));
        if (gold > 0) {
            player.gold = _num(player.gold) + gold;
            Ledger.record(player, FirstSteps.config().ledgerCategory || 'firstSteps', gold);
            parts.push(`+${gold} gold`);
        }
        const renown = Math.round(_num(r.renown));
        if (renown > 0) {
            player.renown = _num(player.renown) + renown;
            parts.push(`+${renown} renown`);
        }
        const prestige = Math.round(_num(r.prestige));
        if (prestige > 0 && _obj(player.house)) {
            House.award(player.house, prestige, reason, _day(world));
            parts.push(`+${prestige} Prestige`);
        }
        return parts.join(', ');
    },

    /**
     * Read every step not yet done; mark and reward the ones now done.
     * Returns notices for them (and for the month's end).
     */
    check(player, world) {
        const notices = [];
        if (!FirstSteps.isActive(player)) return notices;
        const fs = player.firstSteps;
        if (!_obj(fs.done)) fs.done = {};
        if (!_obj(fs.base)) fs.base = _baseline(player);
        // Only the character the guidance began with: an heir is not guided again
        if (_obj(player.house) && _num(player.house.generation, 1) > _num(fs.generation, 1)) {
            fs.retired = true;
            return notices;
        }
        const steps = FirstSteps.steps();
        for (const s of steps) {
            if (fs.done[s.id] != null) continue;
            let ok = false;
            try {
                ok = !!READERS[s.check](player, world, fs);
            } catch (e) {
                ok = false;
            }
            if (!ok) continue;
            fs.done[s.id] = _day(world);
            const paid = FirstSteps._pay(player, world, s.reward, `First Steps: ${s.title}`);
            const next = FirstSteps.current(player);
            notices.push({
                icon: s.icon || '✅',
                title: `First Steps — ${s.title}`,
                text: `Done${paid ? ` (${paid})` : ''}.${next ? ` Next: ${next.title}.` : ''}`,
                type: 'success',
                step: s.id,
            });
        }
        if (steps.length && steps.every(s => fs.done[s.id] != null)) {
            const fin = FirstSteps.config().final;
            fs.finishedDay = _day(world);
            const paid = FirstSteps._pay(player, world, fin, 'First Steps taken');
            notices.push({
                icon: '🎓',
                title: fin.title || 'First Steps taken',
                text: `${fin.text || ''}${paid ? ` (${paid})` : ''}`.trim(),
                type: 'success',
                step: null,
            });
        }
        return notices;
    },

    /** The day's end: the same check (a night at an inn shows only the morning after). */
    processDay(world, player) {
        return { notices: FirstSteps.check(player, world) };
    },

    /** Stop guiding ("Skip guidance"). */
    skip(player) {
        const fs = FirstSteps.state(player);
        if (!fs) return false;
        fs.skipped = true;
        return true;
    },

    /** Start (or restart) guiding a character whose guidance was skipped or switched off. */
    resume(player) {
        if (!FirstSteps.canResume(player)) return false;
        const fs = player.firstSteps;
        fs.enabled = true;
        fs.skipped = false;
        fs.collapsed = false;
        return true;
    },

    setCollapsed(player, collapsed) {
        const fs = FirstSteps.state(player);
        if (fs) fs.collapsed = !!collapsed;
    },

    serialize(player) {
        const fs = FirstSteps.state(player);
        return fs ? JSON.parse(JSON.stringify(fs)) : null;
    },

    /**
     * After a load (saveLoad.restorePlayer has copied the saved fields): a save
     * from before First Steps gets a record that is off and never offered, so
     * an old game does not suddenly start a tutorial; a newer one is checked.
     */
    loadState(player) {
        if (!player) return;
        const fs = _obj(player.firstSteps);
        if (!fs) {
            player.firstSteps = {
                enabled: false, skipped: false, collapsed: false, legacy: true, retired: false,
                startDay: 0, generation: _num(player.house && player.house.generation, 1),
                base: _baseline(player), done: {}, finishedDay: null,
            };
            return;
        }
        if (!_obj(fs.done)) fs.done = {};
        if (!_obj(fs.base)) fs.base = _baseline(player);
        for (const k of ['jobs', 'trades', 'people', 'bounties', 'quests', 'visits']) fs.base[k] = _num(fs.base[k]);
        fs.enabled = !!fs.enabled;
        fs.skipped = !!fs.skipped;
        fs.collapsed = !!fs.collapsed;
        fs.legacy = !!fs.legacy;
        fs.retired = !!fs.retired;
        fs.startDay = _num(fs.startDay);
        fs.generation = _num(fs.generation, 1);
        if (fs.finishedDay !== null && !Number.isFinite(fs.finishedDay)) fs.finishedDay = null;
    },
};

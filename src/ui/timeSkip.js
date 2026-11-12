// ============================================
// TIME SKIP — wait a day, three, a week, a fortnight, a season
// ============================================
// `TimeSkip.start(game, days)` runs `days` real turns, one after another, each
// through game.endDay() (ui/game/endDay.js), so every system ticks exactly as
// it does when the player presses End Turn. Between days it yields to the
// browser (the map keeps drawing, the progress bar moves, Stop / Escape work).
//
// The skip stops early on anything that needs the player (`check`):
//   - the central interrupt queue (core/interrupts.js) — any system may raise
//     one; serious notices (type 'error', or a title naming war, a siege, an
//     ambush, a crisis …) are raised into it by the capture below;
//   - a band on the player (game._pendingEncounter), a choice scene
//     (game._scene), a field battle, a panel or menu that opened by itself;
//   - death, or the day failing to end;
//   - a hostile band newly within APPROACH hexes, a new illness or wound,
//     a letter arriving, a death in the House, hunger / tiredness / health
//     falling past a threshold, starvation setting in;
//   - no bed for the night where the player had taken one.
//
// Notifications during the skip are not shown one by one: they go to the
// activity log as usual and are collected for one digest at the end ("While
// the days passed…", ui/actionMenu/timeSkip.js).
//
// Nights: in the player's own house they rest there as usual; a room taken
// at an inn is taken again each night and paid for (systems/hospitality.js
// `book`); elsewhere they make camp (as Rest / Camp does).
//
// Not while travelling, at sea, in a battle or a choice scene (`canSkip`).
// Dead and waiting (the interregnum), the wait goes to
// ActionMenu.passInterregnumDays (player/afterlife.js's world-only days).

import { Interrupts } from '../core/interrupts.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';
import { Seasons } from '../world/seasons.js';
import { Hospitality } from '../systems/hospitality.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { Ailments } from '../systems/ailments.js';
import { Afterlife } from '../player/afterlife.js';

/** Hexes within which a hostile band counts as approaching. */
const APPROACH = 3;
/** Needs and health thresholds (falling past one stops the skip). */
const THRESHOLDS = { hunger: 20, energy: 12, healthPct: 0.35 };
/** Serious notices: these stop a skip whatever their type. */
const SERIOUS = /war declared|besieged|siege|attacked|ambush|waylaid|crisis|rebellion|arrested|assassin|scheme strikes|struck without|ultimatum|kidnap|captured|abducted|fire!|plague in|starving/i;
/** Routine notices folded away in the digest. */
const ROUTINE_TITLES = /^(auto-saved|tax collection|army upkeep|mercenary wages|informants|loan payment|production|storage|faith income|cultural income|🌙 the day's last hours|🛏️ a good night)/i;
const BRIEF_TITLE = /steward's brief/i;
/** Comfort needs running low (ui/game/innerMap.js _checkNeedWarnings): logged, never a reason to stop a wait. */
const MINOR_NEEDS = /^\S*\s*(bored|lonely|dirty|uncomfortable)!?$/i;

/** The choices offered in the Wait menu: [days or 'season', label]. */
export const SKIP_CHOICES = [
    { id: 1, days: 1, label: 'A day', icon: '🌙' },
    { id: 3, days: 3, label: 'Three days', icon: '🌗' },
    { id: 7, days: 7, label: 'A week', icon: '📅' },
    { id: 14, days: 14, label: 'A fortnight', icon: '🗓️' },
    { id: 30, days: 30, label: 'A month', icon: '🌕' },
    { id: 'season', days: null, label: 'Until the season turns', icon: '🍂' },
];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _hasDoc = () => typeof document !== 'undefined' && !!document.getElementById;

function _yield() {
    // One frame (the map redraws, input is handled), or a macrotask headless
    return new Promise(res => {
        if (typeof requestAnimationFrame === 'function' && _hasDoc()) requestAnimationFrame(() => setTimeout(res, 0));
        else setTimeout(res, 0);
    });
}

/** Run one real turn through game.endDay(); resolves true once the day has moved on. */
async function _realDay(game) {
    const before = game.world.day;
    game._endDayConfirmed = true;
    game.endDay();
    const started = performance.now();
    while (game.isProcessingTurn) {
        await new Promise(res => setTimeout(res, 8));
        if (performance.now() - started > 60000) return false; // a day that never ends
    }
    return !!game.world && game.world.day > before;
}

export const TimeSkip = {
    APPROACH,
    THRESHOLDS,

    /** Days until the next season's turn (1–30). */
    daysToSeason(world) {
        const per = Seasons.DAYS_PER_SEASON || 30;
        const day = _num(world && world.day, 1);
        return per - ((Math.max(1, day) - 1) % per);
    },

    /** How many days a choice means today. */
    daysFor(world, choice) {
        if (choice === 'season' || (choice && choice.id === 'season')) return this.daysToSeason(world);
        const n = typeof choice === 'object' && choice ? choice.days : Number(choice);
        return Math.max(1, Math.floor(_num(n, 1)));
    },

    /** Is a skip running? */
    active(game) {
        return !!(game && game._timeSkip);
    },

    /**
     * May the player let days pass now? → { ok, reason }. `game.isProcessingTurn`
     * aside, these are the states a run of End Turns would break or skip past.
     */
    canSkip(game) {
        const p = game && game.player;
        if (!game || !game.world || !p) return { ok: false, reason: 'No game is running.' };
        if (game._timeSkip) return { ok: false, reason: 'The days are already passing.' };
        if (game.isProcessingTurn) return { ok: false, reason: 'The day is still ending.' };
        if (Afterlife.active(p)) return { ok: true, interregnum: true };
        if (p._isDead) return { ok: false, reason: 'You are dead.' };
        if (p.isMoving || p.queuedPath || p.autoChart) return { ok: false, reason: 'You are on the road. Arrive first, or stop the journey (Escape).' };
        if ((p.ships || []).some(s => s && s.voyage)) return { ok: false, reason: 'You are at sea. The voyage goes a day at a time.' };
        if (game._pendingEncounter) return { ok: false, reason: 'A band stands in your way.' };
        if (game._scene) return { ok: false, reason: 'A matter waits on your choice.' };
        if (game._fieldBattle) return { ok: false, reason: 'A battle is under way.' };
        return { ok: true };
    },

    /** How the player will sleep: { kind: 'house'|'inn'|'camp'|'town', house?, tier?, price?, text }. */
    lodgingPlan(game) {
        const { world, player: p } = game;
        const ownHouse = (p.houses || []).some(h => h.q === p.q && h.r === p.r);
        if (ownHouse) return { kind: 'house', text: 'You sleep under your own roof.' };
        const L = p.lodging;
        if (L && L.night === world.day) {
            const price = this._nightPrice(world, p, L.id, L.tier);
            return { kind: 'inn', id: L.id, tier: L.tier, name: L.name, price, text: `You keep your room at ${L.name}${price ? `, ${price} gold a night` : ''}.` };
        }
        const tile = world.getTile ? world.getTile(p.q, p.r) : null;
        if (tile && tile.settlement) {
            const cheapest = this.cheapestRoom(world, p);
            return { kind: 'town', cheapest, text: cheapest
                ? `No room taken: a common-room bench, or take ${String(cheapest.tierName).toLowerCase()} at ${cheapest.name} (${cheapest.price} gold a night).`
                : 'No room taken: you find a bench in a common room.' };
        }
        return { kind: 'camp', text: 'You make camp each night.' };
    },

    /** The price of another night of a room (null when it can't be had). */
    _nightPrice(world, player, id, tierId) {
        try {
            const v = Hospitality.get(world, player, id);
            return v ? Hospitality.roomPrice(world, player, v, tierId) : null;
        } catch (e) {
            return null;
        }
    },

    /** The cheapest room for tonight where the player stands: { id, tier, tierName, name, price } or null. */
    cheapestRoom(world, player) {
        let best = null;
        try {
            for (const v of Hospitality.listAt(world, player, player.q, player.r)) {
                const q = Hospitality.quote(world, player, v.id);
                if (!q) continue;
                for (const t of q.tiers) {
                    if (!t.ok) continue;
                    if (!best || t.price < best.price) best = { id: v.id, tier: t.id, tierName: t.name, name: v.name, price: t.price };
                }
            }
        } catch (e) {
            return null;
        }
        return best;
    },

    /** What the player's state is before a day, for `check` to compare against. */
    snapshot(game) {
        const { world, player: p } = game;
        const near = new Set();
        try {
            for (const u of world.units || []) {
                if (u && !u.destroyed && WorldUnit.isHostile(u) && !u.sparesPlayer
                    && Hex.wrappingDistance(u.q, u.r, p.q, p.r, world.width) <= APPROACH) near.add(u.id);
            }
        } catch (e) { /* a world without units */ }
        let letters = 0;
        try { letters = _num(CourtLetters.state(p).stats.received); } catch (e) { letters = 0; }
        let ailments = [];
        try { ailments = Ailments.list(p).map(a => a.id); } catch (e) { ailments = []; }
        return {
            day: world.day,
            near,
            letters,
            ailments,
            kin: (p.children || []).filter(c => c && c.deathDay == null).length,
            spouse: p.spouse || null,
            needs: { ...(p.needs || {}) },
            health: _num(p.health, 100),
            maxHealth: _num(p.maxHealth, 100),
            starving: _num(p.starvationDays),
            panelOpen: _hasDoc() && !!document.getElementById('customPanel'),
        };
    },

    /**
     * After a day: why the skip must stop, or null. `before` is the snapshot
     * taken before the day. Returns { icon, reason, quiet? } (quiet: no digest —
     * the death screen is coming).
     */
    check(game, before) {
        const { world, player: p } = game;
        if (!p || p._isDead) return { icon: '💀', reason: 'Death came for you.', quiet: true };
        if (Afterlife.active(p)) return { icon: '💀', reason: 'Your life has ended.', quiet: true };
        // The central queue first: systems and serious notices feed it
        const raised = Interrupts.take(world);
        if (raised.length) {
            const top = raised[raised.length - 1];
            return { icon: top.icon || '⚠️', reason: top.reason, all: raised };
        }
        if (game._pendingEncounter) return { icon: '⚔️', reason: 'A band fell on you on the road.' };
        if (game._scene) return { icon: '❗', reason: 'A matter needs your choice.' };
        if (game._fieldBattle) return { icon: '🚩', reason: 'A battle is joined.' };
        if (p.isMoving || p.queuedPath) return { icon: '🧭', reason: 'You are on the move.' };
        if (_hasDoc()) {
            if (document.getElementById('actionMenu')) return { icon: '❗', reason: 'Something needs your attention.' };
            if (!before.panelOpen && document.getElementById('customPanel')) return { icon: '📜', reason: 'Something needs your attention.' };
        }
        // Hostile bands newly in sight
        try {
            for (const u of world.units || []) {
                if (!u || u.destroyed || !WorldUnit.isHostile(u) || u.sparesPlayer || before.near.has(u.id)) continue;
                if (Hex.wrappingDistance(u.q, u.r, p.q, p.r, world.width) <= APPROACH && !WorldUnit.isSafeHaven(world, p.q, p.r)) {
                    return { icon: '🏴', reason: `${u.name || 'A hostile band'} is on the road nearby.` };
                }
            }
        } catch (e) { /* no units */ }
        // A new illness or wound
        try {
            const fresh = Ailments.list(p).find(a => !before.ailments.includes(a.id));
            if (fresh) return { icon: '🤒', reason: `You have taken ${Ailments.displayName ? Ailments.displayName(fresh) : 'ill'}.` };
        } catch (e) { /* no ailments */ }
        // A letter to answer
        try {
            if (_num(CourtLetters.state(p).stats.received) > before.letters) return { icon: '✉️', reason: 'A letter has come that wants an answer.' };
        } catch (e) { /* no letters */ }
        // A death in the House
        const kin = (p.children || []).filter(c => c && c.deathDay == null).length;
        if (kin < before.kin) return { icon: '🕯️', reason: 'A death in your House.' };
        if (before.spouse && !p.spouse) return { icon: '🕯️', reason: 'Your marriage is ended.' };
        // The body: starvation, hunger, tiredness, health
        if (_num(p.starvationDays) > before.starving && before.starving === 0) return { icon: '💀', reason: 'You are starving.' };
        const needs = p.needs || {};
        if (_num(needs.hunger, 100) < THRESHOLDS.hunger && _num(before.needs.hunger, 100) >= THRESHOLDS.hunger) return { icon: '🍽️', reason: 'You are hungry.' };
        if (_num(needs.energy, 100) < THRESHOLDS.energy && _num(before.needs.energy, 100) >= THRESHOLDS.energy) return { icon: '😴', reason: 'You are exhausted.' };
        const line = _num(p.maxHealth, 100) * THRESHOLDS.healthPct;
        if (_num(p.health, 100) < line && before.health >= line) return { icon: '❤️', reason: 'Your health is failing.' };
        return null;
    },

    /** A notice is serious enough to stop a skip. */
    isSerious(title, type) {
        const t = String(title || '').trim();
        if (MINOR_NEEDS.test(t)) return false;
        return type === 'error' || SERIOUS.test(t);
    },

    /** A notice the digest folds away as routine. */
    isRoutine(title, type) {
        return type === 'default' || ROUTINE_TITLES.test(String(title || '').trim());
    },

    /**
     * Put the night's bed in order before a day ends: the room again (paid),
     * or a camp. → null, or { icon, reason } when the room can't be had.
     */
    _prepareNight(game, skip) {
        const { world, player: p } = game;
        if ((p.houses || []).some(h => h.q === p.q && h.r === p.r)) return null;
        if (skip.lodge) {
            if (p.lodging && p.lodging.night === world.day) return null;
            const r = Hospitality.book(world, p, skip.lodge.id, skip.lodge.tier);
            if (!r.ok) return { icon: '🛏️', reason: `No bed at ${skip.lodge.name || 'the inn'} tonight: ${r.text}` };
            skip.lodgingPaid += _num(r.cost);
            skip.nights++;
            return null;
        }
        const tile = world.getTile ? world.getTile(p.q, p.r) : null;
        if (!(tile && tile.settlement) && !p._restTypeOverride) p._restTypeOverride = 'camp';
        return null;
    },

    /**
     * The skip itself (awaitable). opts:
     *   runDay(game) → bool|Promise<bool>  one day (default: the real game.endDay())
     *   yieldFn() → Promise                 between days (default: a frame)
     *   onProgress(skip)                    after each day
     *   lodge: { id, tier, name }           take this room each night (else the room taken tonight, if any)
     * Resolves to the skip record: { total, done, startDay, endDay, reason, cancelled, digest, … }.
     */
    async run(game, days, opts = {}) {
        const total = Math.max(1, Math.floor(_num(days, 1)));
        const can = this.canSkip(game);
        if (!can.ok) return { total, done: 0, refused: can.reason, digest: [] };
        const { world, player: p } = game;
        const runDay = opts.runDay || _realDay;
        const yieldFn = opts.yieldFn || _yield;
        const plan = this.lodgingPlan(game);
        const skip = game._timeSkip = {
            total, done: 0, stop: false, cancelled: false, reason: null,
            startDay: world.day, endDay: world.day,
            startGold: _num(p.gold), startHealth: _num(p.health, 100),
            lodge: opts.lodge || (plan.kind === 'inn' ? { id: plan.id, tier: plan.tier, name: plan.name } : null),
            lodgingPaid: 0, nights: 0,
            digest: [],
        };
        Interrupts.clear(world);
        const restore = this._capture(game, skip);
        try {
            while (skip.done < total) {
                if (skip.stop) { skip.cancelled = true; skip.reason = { icon: '✋', reason: 'You stopped the wait.' }; break; }
                const bed = this._prepareNight(game, skip);
                if (bed) { skip.reason = bed; break; }
                const before = this.snapshot(game);
                skip.dayIndex = skip.done + 1;
                let ok = false;
                // (between days the turn counts as processing, so End Turn / Enter / the
                // travel loop can't slip a day in; endDay itself needs it clear)
                game.isProcessingTurn = false;
                try {
                    ok = await runDay(game);
                } catch (e) {
                    console.error('[TimeSkip] a day failed', e);
                    ok = false;
                }
                if (!ok) { skip.reason = skip.reason || { icon: '⚠️', reason: 'The day could not end.' }; break; }
                skip.done++;
                skip.endDay = world.day;
                game.isProcessingTurn = true;
                await yieldFn();
                const why = this.check(game, before);
                if (why) { skip.reason = why; break; }
                if (opts.onProgress) opts.onProgress(skip);
            }
        } finally {
            game.isProcessingTurn = false;
            restore();
            if (game._timeSkip === skip) game._timeSkip = null;
            skip.endDay = game.world ? game.world.day : skip.endDay;
            skip.goldChange = _num(game.player && game.player.gold) - skip.startGold;
            skip.healthChange = _num(game.player && game.player.health, 100) - skip.startHealth;
        }
        return skip;
    },

    /** Ask a running skip to stop after the day under way. */
    cancel(game) {
        if (game && game._timeSkip) game._timeSkip.stop = true;
    },

    /**
     * Collect notifications while the skip runs: logged as usual (the activity
     * log), gathered for the digest, serious ones raised as interrupts. Returns
     * the function that puts showNotification back.
     */
    _capture(game, skip) {
        const ui = game.ui;
        if (!ui || typeof ui.showNotification !== 'function') return () => {};
        const own = Object.prototype.hasOwnProperty.call(ui, 'showNotification');
        const orig = ui.showNotification;
        ui.showNotification = (title, message, type = 'default') => {
            const world = game.world;
            skip.digest.push({ day: world ? world.day : 0, title: String(title || ''), message: String(message || ''), type });
            if (typeof ui._logNotification === 'function') {
                try { ui._logNotification(title, message, type); } catch (e) { /* no log */ }
            }
            if (world && this.isSerious(title, type)) Interrupts.raise(world, { reason: String(title || '').trim(), icon: '⚠️', source: 'notice' });
        };
        return () => {
            if (own) ui.showNotification = orig;
            else delete ui.showNotification;
        };
    },

    /**
     * The digest, grouped: { stoppedBy, important: [...], routine: [...], brief }.
     * Duplicates (same title and text) fold into one with a count.
     */
    digestOf(skip) {
        const important = [], routine = [];
        let brief = null;
        const seen = new Map();
        for (const n of skip.digest || []) {
            if (BRIEF_TITLE.test(n.title)) { brief = n; continue; }
            const key = `${n.title}|${n.message}`;
            if (seen.has(key)) { seen.get(key).count++; continue; }
            const item = { ...n, count: 1 };
            seen.set(key, item);
            (this.isRoutine(n.title, n.type) ? routine : important).push(item);
        }
        return { stoppedBy: skip.cancelled ? null : skip.reason, important, routine, brief };
    },
};

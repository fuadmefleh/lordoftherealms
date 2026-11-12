// Engagement + health audit (opt-in): AUDIT=1 npx vitest run src/__tests__/audit.health.test.js
//
// The playtest bot (playtest/bot.js) plays several seeds for a long run through
// the harness's daily turn (playtest/harness.js) while this file watches:
//   - every daily tick (each system's processDay & co.): calls, ms, the notices
//     it returns, and — on sampled days — which top-level player/world state it
//     changed (a hash of each key before and after the call);
//   - world events, achievements, quests, sagas, the ledger's categories;
//   - the gold / net worth / prestige curve;
//   - decision density: distinct actions offered per week, pending choices;
//   - novelty: the first time anything happens, and the flat stretches after.
// A death does not end a run: the heir takes over, or a new life begins
// (harness.carryOn, as in the soak), so a long run crosses generations;
// run.lives lists each death and who carried on.
// The report goes to AUDIT_OUT (JSON; default: the OS temp dir) and a summary
// to stdout. Knobs: AUDIT_SEEDS=1,2,3  AUDIT_DAYS=1200  AUDIT_SAMPLE=10.
// The audit draws no RNG of its own and wraps no RNG-drawing code, so a run
// plays exactly as the soak would. Without AUDIT the suite skips it.

import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import path from 'path';
import { Utils } from '../core/utils.js';
import { loadData, newGame, endDay, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { PlayerActions } from '../player/playerActions.js';
import { Ledger } from '../systems/ledger.js';
import { EconomyChronicle } from '../systems/economyChronicle.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { CourierRiders } from '../systems/courierRiders.js';
import { Victory } from '../systems/victory.js';
import { Annals } from '../systems/annals.js';

// Every module of the domain layers (their exported singletons carry the ticks)
const MODULES = {
    ...import.meta.glob('../systems/*.js', { eager: true }),
    ...import.meta.glob('../world/*.js', { eager: true }),
    ...import.meta.glob('../player/*.js', { eager: true }),
};

const ENV = (typeof process !== 'undefined' && process.env) || {};
const ON = !!ENV.AUDIT;
const SEEDS = ENV.AUDIT_SEEDS ? ENV.AUDIT_SEEDS.split(',').map(Number) : [101, 202, 303, 404];
const DAYS = Number(ENV.AUDIT_DAYS) || 1200;
const SAMPLE = Number(ENV.AUDIT_SAMPLE) || 20;
const OUT = ENV.AUDIT_OUT || path.join(os.tmpdir(), 'lotr-health-audit.json');

// The daily ticks worth watching, by method name
const TICKS = new Set(['processDay', 'processDaily', 'processTurn', 'processDailyEvents', 'processAging', 'updatePrices',
    'checkAchievements', 'updateProgress', 'collectTaxes', 'processWars', 'processRestorations', 'generateEvents',
    'processTimedEvents', 'applyPlayerDailyEffects', 'processLordActions', 'processInformants', 'endDay', 'exposeDeceptions',
    'applySpyVision', 'syncFolk', 'processUnits', 'check', 'spawnTravelingMerchant', 'expireOldIntel', 'closeDay']);
// Objects whose 'check'/'endDay' are not daily ticks
const SKIP_METHOD = { check: (name) => !['Victory', 'FirstSteps'].includes(name), endDay: (name) => name !== 'PlayerActions' };

const finiteR = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/** JSON with cycles cut (a shared object is written once) — for hashing only. */
function stableJson(v) {
    try { return JSON.stringify(v); } catch { /* a cycle: cut it below */ }
    const seen = new WeakSet();
    try {
        return JSON.stringify(v, (k, x) => {
            if (k === '_dayMemo' || k === '_scanHolds' || k === '_settlementScan') return undefined;
            if (x && typeof x === 'object') {
                if (seen.has(x)) return '#';
                seen.add(x);
            }
            return x;
        });
    } catch { return 'ERR'; }
}

const h = (s) => crypto.createHash('md5').update(s || '').digest('base64');

/** A hash per top-level key of the player and the world (tiles summarised by their settlements). */
function digest(game) {
    const out = new Map();
    const { player, world } = game;
    for (const k of Object.keys(player)) out.set(`player.${k}`, h(stableJson(player[k])));
    for (const k of Object.keys(world)) {
        if (k === 'tiles' || k === '_dayMemo') continue;
        out.set(`world.${k}`, h(stableJson(world[k])));
    }
    out.set('world.settlements', h(stableJson(world.getAllSettlements())));
    return out;
}

function diffKeys(a, b) {
    const keys = [];
    for (const [k, h] of b) if (a.get(k) !== h) keys.push(k);
    for (const k of a.keys()) if (!b.has(k)) keys.push(k);
    return keys;
}

/** Notices a tick returned, as titles. */
function noticeTitles(res) {
    const list = Array.isArray(res) ? res : res && typeof res === 'object' ? [
        ...(Array.isArray(res.notices) ? res.notices : []), ...(Array.isArray(res.notifications) ? res.notifications : []),
        ...(Array.isArray(res.events) ? res.events : []), ...(Array.isArray(res.messages) ? res.messages : []),
    ] : [];
    return list.filter(n => n && typeof n === 'object').map(n => String(n.title || n.name || n.type || n.kind || '?')
        .replace(/\d+/g, '#').replace(/[^\w #'-]/g, '').trim().slice(0, 48)).filter(Boolean);
}

// ── Instrumentation (wraps the tick methods; the wrappers draw no RNG) ──
const S = {
    ticks: {}, // label → { calls, ms, sampled, changedOn, keys:{}, notices:{} }
    sampling: false,
    stack: 0,
    game: null,
};
const restores = [];

function wrapAll() {
    const groups = [...Object.values(MODULES).map(m => ['', m]), ['', { Townsfolk, CourierRiders, Victory }]];
    const done = new Set();
    for (const [, mod] of groups) {
        for (const [name, obj] of Object.entries(mod)) {
            if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) continue;
            const target = typeof obj === 'function' && obj.prototype && /^[A-Z]/.test(name) && Object.getOwnPropertyNames(obj).length <= 3 ? null : obj;
            if (!target || done.has(target)) continue;
            done.add(target);
            for (const m of Object.getOwnPropertyNames(target)) {
                if (!TICKS.has(m)) continue;
                if (SKIP_METHOD[m] && SKIP_METHOD[m](name)) continue;
                const desc = Object.getOwnPropertyDescriptor(target, m);
                if (!desc || typeof desc.value !== 'function' || !desc.writable) continue;
                const fn = desc.value;
                const label = `${name}.${m}`;
                target[m] = function (...args) {
                    const t = S.ticks[label] || (S.ticks[label] = { calls: 0, ms: 0, sampled: 0, changedOn: 0, keys: {}, notices: {} });
                    const top = S.stack === 0;
                    // (per-realm ticks, called many times a day, are timed but not diffed)
                    const sample = top && S.sampling && S.game && !t.multi;
                    const before = sample ? (S.last || digest(S.game)) : null;
                    if (top && S.sampling) t.today = (t.today || 0) + 1;
                    S.stack++;
                    const t0 = performance.now();
                    let res;
                    try {
                        res = fn.apply(this, args);
                    } finally {
                        t.ms += performance.now() - t0;
                        S.stack--;
                    }
                    t.calls++;
                    if (sample) {
                        const after = digest(S.game);
                        S.last = after;
                        const changed = diffKeys(before, after);
                        t.sampled++;
                        if (changed.length) t.changedOn++;
                        for (const k of changed) t.keys[k] = (t.keys[k] || 0) + 1;
                    }
                    for (const title of noticeTitles(res)) t.notices[title] = (t.notices[title] || 0) + 1;
                    return res;
                };
                restores.push(() => { target[m] = fn; });
            }
        }
    }
}

/** Distinct action types offered where the player stands. */
function actionsOffered(game) {
    const tile = game.world.getTile(game.player.q, game.player.r);
    if (!tile) return [];
    try {
        return [...new Set((PlayerActions.getAvailableActions(game.player, tile, game.world) || []).map(a => a.type))];
    } catch { return []; }
}

/** Matters waiting on the player's say (petitions, quests on the board, letters, child events, ...). */
function pendingChoices(player) {
    const n = (v) => (Array.isArray(v) ? v.length : 0);
    const out = {
        petitions: n(player.petitions && player.petitions.pending),
        questsOffered: n(player.quests && player.quests.available),
        demands: n(player.demands && (player.demands.active || player.demands.pending)),
        letters: n(((player.courtLetters && (player.courtLetters.inbox || player.courtLetters.letters)) || []).filter(l => l && !l.answered && !l.read)),
        mail: n(((player.mail && player.mail.inbox) || []).filter(l => l && !l.read)),
        coalitionTerms: player.coalitions && player.coalitions.active && player.coalitions.active.terms ? 1 : 0,
    };
    out.total = Object.values(out).reduce((a, b) => a + b, 0);
    return out;
}

function runAudit(seed) {
    let game = newGame(seed);
    S.game = game;
    const stats = {};
    const run = {
        seed, days: 0, died: null, lives: [], curve: [], weeks: [], firsts: {}, ledger: {}, events: {}, achievements: [],
        actionTypes: {}, botMs: 0, tickMs: 0, extraNotices: {},
    };
    const novel = (kind, key) => {
        const id = `${kind}:${key}`;
        if (run.firsts[id] == null) { run.firsts[id] = game.world.day; return 1; }
        return 0;
    };
    // World events come back from advanceDay
    const adv = game.world.advanceDay.bind(game.world);
    game.world.advanceDay = (...a) => {
        const res = adv(...a);
        for (const e of (res && res.events) || []) {
            const key = `${e.type || '?'}:${(e.timedEvent && (e.timedEvent.type || e.timedEvent.id)) || e.eventType || e.id || e.subtype || ''}`;
            run.events[key] = (run.events[key] || 0) + 1;
            week.novel += novel('event', key);
        }
        return res;
    };
    let week = { start: game.world.day, novel: 0, actionTypes: new Set(), pending: 0, notices: 0, gold: 0 };
    let unlockedSeen = 0;
    let questsDone = 0;
    for (let i = 0; i < DAYS; i++) {
        const day = game.world.day;
        const statsBefore = { ...stats };
        const b0 = performance.now();
        botDay(game, stats);
        run.botMs += performance.now() - b0;
        for (const [k, v] of Object.entries(stats)) if (v !== statsBefore[k]) week.novel += novel('bot', k);
        for (const t of actionsOffered(game)) {
            week.actionTypes.add(t);
            run.actionTypes[t] = (run.actionTypes[t] || 0) + 1;
            week.novel += novel('offered', t);
        }
        week.pending += pendingChoices(game.player).total;
        S.sampling = i % SAMPLE === 0;
        S.last = null;
        for (const t of Object.values(S.ticks)) t.today = 0;
        const noticesBefore = Object.values(S.ticks).reduce((a, t) => a + Object.values(t.notices).reduce((x, y) => x + y, 0), 0);
        const t0 = performance.now();
        game._lastMark = performance.now();
        const res = endDay(game);
        // The real endDay's ticks the harness leaves out (ui/game/endDay.js): townsfolk, couriers on horseback, victory
        if (!res.died) {
            for (const nn of noticeTitles(Townsfolk.processDay(game.world, game.player))) run.extraNotices[`Townsfolk:${nn}`] = (run.extraNotices[`Townsfolk:${nn}`] || 0) + 1;
            for (const nn of noticeTitles(CourierRiders.processDay(game.world, game.player))) run.extraNotices[`CourierRiders:${nn}`] = (run.extraNotices[`CourierRiders:${nn}`] || 0) + 1;
            const won = Victory.check(game.player, game.world);
            if (won) week.novel += novel('victory', won.id || String(won));
        }
        run.tickMs += performance.now() - t0;
        if (S.sampling) for (const t of Object.values(S.ticks)) if (t.today > 1) t.multi = true;
        S.sampling = false;
        S.last = null;
        const p = game.player;
        // Notices the ticks returned today: new titles are novelty
        for (const [label, t] of Object.entries(S.ticks)) for (const title of Object.keys(t.notices)) week.novel += novel('notice', `${label}:${title}`);
        week.notices += Object.values(S.ticks).reduce((a, t) => a + Object.values(t.notices).reduce((x, y) => x + y, 0), 0) - noticesBefore;
        // Achievements, quests, sagas
        const unlocked = (p.achievements && p.achievements.unlocked) || [];
        for (const id of unlocked.slice(unlockedSeen)) { run.achievements.push([id, game.world.day]); week.novel += novel('achievement', id); }
        unlockedSeen = unlocked.length;
        const done = (p.quests && p.quests.completed) || [];
        for (const q of done.slice(questsDone)) week.novel += novel('quest', (q && (q.type || q.templateId || q.id)) || String(q));
        questsDone = done.length;
        // The day's books (the row Ledger.closeDay just kept)
        const row = (p.financeHistory || [])[p.financeHistory.length - 1];
        if (row && row.day === game.world.day) {
            for (const [k, v] of Object.entries(row.income || {})) {
                const L = run.ledger[k] || (run.ledger[k] = { in: 0, out: 0, days: 0 });
                if (v > 0) L.in += v; else L.out -= v;
                if (v) { L.days++; week.novel += novel('ledger', k); }
            }
            for (const [k, v] of Object.entries(row.expenses || {})) {
                const L = run.ledger[k] || (run.ledger[k] = { in: 0, out: 0, days: 0 });
                L.out += v;
                if (v) { L.days++; week.novel += novel('ledger', k); }
            }
        }
        run.days++;
        let theEnd = false;
        if (res.died) {
            // The death screen's choice: the heir, else a new life (harness.carryOn).
            // An heir takes over the same player object; a stranger is a new one
            const was = { name: p.name, age: finiteR(p.age), gold: finiteR(p.gold) };
            const next = carryOn(game, res.died);
            run.lives.push({ day: game.world.day, cause: res.died, ...was, next: next.how, nextName: next.how ? game.player.name : null });
            week.novel += novel('death', res.died);
            if (next.how) week.novel += novel('succession', next.how);
            if (game.player !== p) {
                // (a new life's own record: what it starts with is not news)
                unlockedSeen = ((game.player.achievements && game.player.achievements.unlocked) || []).length;
                questsDone = ((game.player.quests && game.player.quests.completed) || []).length;
            }
            if (!next.how) { run.died = `${res.died} on day ${game.world.day}`; theEnd = true; }
        }
        if (game.world.day % 7 === 0 || theEnd || i === DAYS - 1) {
            run.weeks.push({ day: game.world.day, novel: week.novel, actions: week.actionTypes.size, pending: Math.round(week.pending / 7 * 10) / 10, notices: week.notices });
            week = { start: game.world.day, novel: 0, actionTypes: new Set(), pending: 0, notices: 0 };
        }
        if (game.world.day % 50 === 0 || res.died || i === DAYS - 1) {
            // (after a death this is the life that carries on)
            const cp = game.player;
            let worth = null;
            try { worth = finiteR(EconomyChronicle.netWorth(cp, game.world).total); } catch { /* */ }
            run.curve.push({
                day: game.world.day, life: run.lives.length + 1, gold: finiteR(cp.gold), worth, prestige: finiteR(cp.house && cp.house.prestige), renown: finiteR(cp.renown),
                army: (cp.army || []).length, props: (cp.properties || []).length, colonies: (cp.colonies || []).length, ships: (cp.ships || []).length,
                title: (cp.titles && cp.titles.current) || cp.title || null, health: finiteR(cp.health),
            });
        }
        if (theEnd) break;
    }
    run.stats = stats;
    run.gameLedger = game.ledger;
    run.sagas = p0(game.player.sagas && game.player.sagas.stats);
    run.quests = { completed: ((game.player.quests && game.player.quests.completed) || []).length, active: ((game.player.quests && game.player.quests.active) || []).length };
    try {
        const book = Annals.compose(game.player, game.world, {});
        run.annals = { chapters: (book.chapters || []).length, events: JSON.stringify(book).length };
    } catch (e) { run.annals = { error: String(e.message || e) }; }
    return run;
}
const p0 = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

let logSpy;
let warnSpy;
beforeAll(async () => {
    if (!ON) return;
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    wrapAll();
});
afterAll(() => {
    for (const r of restores) r();
    if (logSpy) logSpy.mockRestore();
    if (warnSpy) warnSpy.mockRestore();
});

describe.skipIf(!ON)('health audit (AUDIT=1)', () => {
    it(`plays ${SEEDS.length} seeds × ${DAYS} days and writes the report`, () => {
        const runs = [];
        for (const seed of SEEDS) {
            const before = JSON.parse(JSON.stringify(S.ticks));
            const r = runAudit(seed);
            // This run's share of the tick table
            r.ticks = {};
            for (const [label, t] of Object.entries(S.ticks)) {
                const b = before[label] || { calls: 0, ms: 0, sampled: 0, changedOn: 0 };
                r.ticks[label] = { calls: t.calls - b.calls, ms: Math.round(t.ms - b.ms), changedOn: t.changedOn - b.changedOn, sampled: t.sampled - b.sampled };
            }
            runs.push(r);
            process.stdout.write(`seed ${seed}: ${r.days} days, ${r.lives.length + 1} li${r.lives.length ? 'ves' : 'fe'} ${r.died ? `(the line ended: ${r.died})` : ''} bot ${Math.round(r.botMs)}ms ticks ${Math.round(r.tickMs)}ms\n`);
        }
        const ticks = {};
        for (const [label, t] of Object.entries(S.ticks)) {
            ticks[label] = { ...t, ms: Math.round(t.ms), msPerCall: Math.round(t.ms / Math.max(1, t.calls) * 1000) / 1000 };
        }
        const allCategories = Object.keys(Ledger.config().categories);
        fs.writeFileSync(OUT, JSON.stringify({ seeds: SEEDS, days: DAYS, sample: SAMPLE, ticks, runs, allCategories }, null, 1));
        process.stdout.write(`audit report: ${OUT}\n`);
    }, 3600000);
});

// ActionMenu — ⏳ Pass the Time: wait a day, three, a week, a fortnight, a
// month or until the season turns; the progress bar while the days pass (Stop
// / Escape); and the digest after ("While the days passed…"). The skip itself
// is ui/timeSkip.js — each day the real End Turn (ui/game/endDay.js).
//
// Openers: ActionMenu.showWaitMenu(game) — the top bar's ⏳ (#btnWait), the
// 'pass_time' action (Camp & Wilds / Hearth), Shift+Enter skips a week at
// once (ActionMenu.waitDays(game, 7)). `installTimeSkipControls(game)` wires
// the button and the keys (from ui/ui/hud.js).
import { ActionMenu } from './_ref.js';
import { TimeSkip, SKIP_CHOICES } from '../timeSkip.js';
import { Afterlife } from '../../player/afterlife.js';
import { Seasons } from '../../world/seasons.js';
import { showMorningBrief } from './counsel.js';
import { esc, lede, chips, rowList, card, price, sectionHead, more, BTN_GOLD, BTN_PLAIN } from './uiKit.js';

const BAR_ID = 'timeSkipBar';

// The chronicler's paragraph over the digest (systems/llmProse.js, when it exists):
// import.meta.glob finds nothing — and so breaks nothing — while the module is absent
const _proseModules = import.meta.glob('../../systems/llmProse.js');
let _prose = null;
function _loadProse() {
    const load = Object.values(_proseModules)[0];
    if (!load || _prose) return Promise.resolve(_prose);
    return load().then(m => (_prose = m && m.LlmProse ? m.LlmProse : null)).catch(() => null);
}

/** Ask for the paragraph (never awaited by the skip) and fill #skipProse when it comes. */
function _proseFor(game, skip, d) {
    const key = `skip:${skip.startDay}-${skip.endDay}`;
    const facts = {
        days: skip.done, planned: skip.total, from: _dateOf(game.world, skip.startDay), to: _dateOf(game.world, skip.endDay),
        goldChange: Math.round(skip.goldChange || 0), healthChange: Math.round(skip.healthChange || 0),
        stoppedBy: d.stoppedBy ? d.stoppedBy.reason : null,
        events: d.important.slice(-12).map(n => String(n.title).replace(/<[^>]*>/g, '')),
    };
    _loadProse().then(P => {
        if (!P || typeof P.write !== 'function') return;
        const world = game.world;
        let text = '';
        try { text = P.write(world, { kind: 'skip_digest', key, facts, fallback: '' }) || ''; } catch (e) { return; }
        const put = (t) => {
            const el = typeof document !== 'undefined' && document.getElementById('skipProse');
            if (!el || el.dataset.key !== key) return false;
            if (t) { el.textContent = t; el.style.display = ''; }
            return true;
        };
        put(text);
        // The LLM fills the text in later: look again for a while, quietly
        let tries = 0;
        const poll = setInterval(() => {
            let t = '';
            try { t = typeof P.text === 'function' ? P.text(world, key, '') : ''; } catch (e) { t = ''; }
            if (!put(t) || t || ++tries > 60) clearInterval(poll);
        }, 1000);
    });
}
const SHOWN = 40;

function _plural(n, one, many = `${one}s`) {
    return `${n} ${n === 1 ? one : many}`;
}

/** "Day 12 of Summer, Year 3" for a world day. */
function _dateOf(world, day) {
    return `Day ${Seasons.dayInSeason(day)} of ${Seasons.seasonOf(day) || world.season}`;
}

/** The progress strip at the top of the map while the days pass. */
function _renderBar(game, skip) {
    if (typeof document === 'undefined') return;
    let el = document.getElementById(BAR_ID);
    if (!skip) { if (el) el.remove(); return; }
    if (!el) {
        el = document.createElement('div');
        el.id = BAR_ID;
        el.setAttribute('role', 'status');
        el.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:9000;'
            + 'background:linear-gradient(180deg,rgba(28,22,14,0.96),rgba(18,14,9,0.96));border:1px solid rgba(245,197,66,0.45);'
            + 'border-radius:10px;padding:8px 14px;min-width:280px;box-shadow:0 6px 24px rgba(0,0,0,0.5);'
            + 'font-family:var(--font-body);color:#ece2c8;font-size:12px;display:flex;align-items:center;gap:10px;';
        el.innerHTML = '<span style="font-size:16px;">⏳</span>'
            + '<div style="flex:1;"><div id="timeSkipLabel" style="margin-bottom:4px;"></div>'
            + '<div style="height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">'
            + '<div id="timeSkipFill" style="height:100%;width:0;background:linear-gradient(90deg,#b8862b,#f5c542);transition:width .15s;"></div></div></div>'
            + `<button type="button" id="timeSkipStop" style="${BTN_PLAIN}margin:0;" title="Stop after this day (Escape)">Stop</button>`;
        document.body.appendChild(el);
        el.querySelector('#timeSkipStop').addEventListener('click', () => TimeSkip.cancel(game));
    }
    const label = el.querySelector('#timeSkipLabel');
    const fill = el.querySelector('#timeSkipFill');
    if (label) label.textContent = `The days pass… ${skip.done} of ${_plural(skip.total, 'day')} · ${_dateOf(game.world, game.world.day)}${skip.stop ? ' · stopping' : ''}`;
    if (fill) fill.style.width = `${Math.round((skip.done / Math.max(1, skip.total)) * 100)}%`;
}

function _entryRow(n) {
    const many = n.count > 1 ? ` <span style="color:var(--text-secondary);">×${n.count}</span>` : '';
    const tone = n.type === 'error' ? 'bad' : n.type === 'warning' ? 'warn' : n.type === 'success' ? 'good' : '';
    // (notification titles and messages are the game's own HTML, as the toasts render them)
    return { icon: '', name: `${n.title}${many}`, desc: n.message, side: `<span style="font-size:10px;color:var(--text-secondary);">day ${n.day}</span>`, tone };
}

Object.assign(ActionMenu, {
    /** ⏳ Pass the Time: how long, and how the nights are spent. */
    showWaitMenu(game, lodgeCheapest = false) {
        const { world, player } = game;
        if (!world || !player) return;
        const can = TimeSkip.canSkip(game);
        let html = lede('Let the days go by. Each passes as an ordinary day would — the realms move, your holdings run, the bills come due — and the wait stops at once on anything that needs you.');
        if (can.interregnum) {
            html += lede('You are gone from the world; it turns on without you.');
        }
        const plan = can.interregnum ? null : TimeSkip.lodgingPlan(game);
        let nightly = 0;
        let lodge = null;
        if (plan) {
            const rows = [];
            if (plan.kind === 'inn') { nightly = plan.price || 0; }
            if (plan.kind === 'town' && plan.cheapest) {
                rows.push({ icon: '🛏️', name: lodgeCheapest ? `A room at ${esc(plan.cheapest.name)} each night` : 'A bench in a common room',
                    desc: lodgeCheapest ? `${esc(plan.cheapest.tierName)}, paid each night` : `Or take ${esc(String(plan.cheapest.tierName).toLowerCase())} at ${esc(plan.cheapest.name)}`,
                    side: lodgeCheapest ? 'switch back' : price(plan.cheapest.price, player.gold >= plan.cheapest.price),
                    act: 'showWaitMenu', args: [!lodgeCheapest] });
                if (lodgeCheapest) { nightly = plan.cheapest.price; lodge = { id: plan.cheapest.id, tier: plan.cheapest.tier, name: plan.cheapest.name }; }
            } else {
                rows.push({ icon: plan.kind === 'house' ? '🏠' : plan.kind === 'inn' ? '🛏️' : '⛺', name: 'The nights', desc: esc(plan.text) });
            }
            html += rowList(rows, 'Where you sleep');
        }
        // (when the season turns on the same day as a fixed choice — a month from its first day —
        // the one row says so, not two rows ending the same day)
        const toSeason = TimeSkip.daysFor(world, 'season');
        const sameAsSeason = SKIP_CHOICES.find(c => c.id !== 'season' && TimeSkip.daysFor(world, c) === toSeason);
        const choices = SKIP_CHOICES.filter(c => !(c.id === 'season' && sameAsSeason)).map(c => {
            const days = TimeSkip.daysFor(world, c);
            const until = _dateOf(world, world.day + days);
            const cost = nightly * days;
            return {
                icon: c.icon,
                name: c.id === 'season' ? `${c.label} (${_plural(days, 'day')})` : c === sameAsSeason ? `${c.label}, to the season's turn` : c.label,
                desc: `Until ${until}${cost ? ` · about ${cost} gold for the beds` : ''}`,
                side: c.id === 7 ? '<span style="font-size:10px;color:var(--text-secondary);">Shift+Enter</span>' : '',
                act: 'waitDays', args: lodge ? [c.id, lodge] : [c.id],
                off: !can.ok, why: can.reason ? esc(can.reason) : '',
            };
        });
        html += rowList(choices, 'How long');
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-top:8px;">The wait stops early for a band on the road, a fight, a letter, an illness, a death in your House, hunger or exhaustion, a crisis — or press Stop / Escape.</div>`;
        game.ui.showCustomPanel('⏳ Pass the Time', html);
    },

    /** Let `choice` days pass (a number, or 'season'); `lodge` = a room to take each night. */
    async waitDays(game, choice = 7, lodge = null) {
        const { world, player } = game;
        if (!world || !player) return null;
        const days = TimeSkip.daysFor(world, choice);
        if (Afterlife.active(player)) {
            game.ui.hideCustomPanel();
            ActionMenu.passInterregnumDays(game, days);
            return null;
        }
        const can = TimeSkip.canSkip(game);
        if (!can.ok) {
            game.ui.showNotification('⏳ Not Now', esc(can.reason), 'warning');
            return null;
        }
        if (document.getElementById('customPanel')) game.ui.hideCustomPanel();
        if (document.getElementById('actionMenu') && ActionMenu.close) ActionMenu.close();
        // (a long wait is a long wait: no "confirm End Day" per day — ui/timeSkip.js sets the flag)
        const skip = TimeSkip.run(game, days, {
            lodge,
            onProgress: s => _renderBar(game, s),
        });
        // The bar from the first day on
        setTimeout(() => { if (game._timeSkip) _renderBar(game, game._timeSkip); }, 0);
        const done = await skip;
        _renderBar(game, null);
        if (done.refused) {
            game.ui.showNotification('⏳ Not Now', esc(done.refused), 'warning');
            return done;
        }
        game._lastTimeSkip = done;
        if (game.ui && game.player) game.ui.updateStats(game.player, game.world);
        if (done.reason && done.reason.quiet) return done; // the death screen takes over
        // A panel that opened by itself (a season's reckoning, a scene) stays up; the digest waits behind a toast
        if (document.getElementById('customPanel') || document.getElementById('actionMenu')) {
            game.ui.showNotification(`⏳ ${_plural(done.done, 'day')} passed`,
                `${done.reason ? `${esc(done.reason.icon || '')} ${esc(done.reason.reason)} ` : ''}<button type="button" data-am-act="showSkipDigest" style="${BTN_GOLD}">What happened</button>`, 'info');
        } else {
            ActionMenu.showSkipDigest(game);
        }
        showMorningBrief(game);
        return done;
    },

    /** "While the days passed…": one digest of the skip just run (game._lastTimeSkip). */
    showSkipDigest(game) {
        const skip = game._lastTimeSkip;
        if (!skip) { game.ui.showNotification('⏳ Pass the Time', 'No days have been let pass yet.', 'info'); return; }
        const d = TimeSkip.digestOf(skip);
        const gold = Math.round(skip.goldChange || 0);
        const hp = Math.round(skip.healthChange || 0);
        const proseKey = `skip:${skip.startDay}-${skip.endDay}`;
        let html = `<div id="skipProse" data-key="${esc(proseKey)}" style="display:none;font-style:italic;font-size:12px;line-height:1.5;color:#e6d9b8;margin-bottom:8px;"></div>`;
        html += lede(`${_plural(skip.done, 'day')} went by — ${_dateOf(game.world, skip.startDay)} to ${_dateOf(game.world, skip.endDay)}.`);
        html += chips([
            ['📅', 'Days', `${skip.done} / ${skip.total}`],
            ['💰', 'Purse', `${gold >= 0 ? '+' : ''}${gold.toLocaleString('en-US')}g`, gold < 0 ? 'bad' : 'good'],
            ['❤️', 'Health', `${hp >= 0 ? '+' : ''}${hp}`, hp < 0 ? 'bad' : ''],
            ...(skip.nights ? [['🛏️', 'Beds', `${skip.nights} nights · ${skip.lodgingPaid}g`]] : []),
        ]);
        if (d.stoppedBy) {
            html += card(`<div>${esc(d.stoppedBy.reason)}</div>`, { title: 'The wait was cut short', icon: esc(d.stoppedBy.icon || '⚠️'), tone: 'warn' });
        } else if (skip.cancelled) {
            html += card('<div>You stopped the wait.</div>', { title: 'Stopped', icon: '✋' });
        }
        if (d.important.length) {
            html += rowList(d.important.slice(-SHOWN).reverse().map(_entryRow), 'While the days passed…');
            if (d.important.length > SHOWN) html += `<div style="font-size:11px;color:var(--text-secondary);">…and ${d.important.length - SHOWN} earlier — all of it in the Event Log.</div>`;
        } else {
            html += sectionHead('While the days passed…') + '<div style="font-size:12px;color:var(--text-secondary);">Nothing of note. The days were quiet.</div>';
        }
        if (d.routine.length) {
            html += more(`The daily round (${d.routine.length})`, rowList(d.routine.slice(-SHOWN).reverse().map(_entryRow)));
        }
        html += `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">`
            + `<button type="button" data-am-act="showWaitMenu" style="${BTN_GOLD}">⏳ Wait longer</button>`
            + `<button type="button" data-am-act="closePanel" style="${BTN_PLAIN}">Carry on</button></div>`;
        game.ui.showCustomPanel('⏳ While the Days Passed', html);
        _proseFor(game, skip, d);
    },
});

/**
 * Wire the controls once per game: the top bar's ⏳ button (#btnWait),
 * Shift+Enter (a week at once) and Escape (stop a skip under way).
 */
export function installTimeSkipControls(game) {
    if (typeof document === 'undefined' || !game) return;
    _game = game;
    const btn = document.getElementById('btnWait');
    if (btn && !btn._timeSkipWired) {
        btn._timeSkipWired = true;
        btn.addEventListener('click', () => {
            if (!_game) return;
            if (_game._timeSkip) TimeSkip.cancel(_game);
            else ActionMenu.showWaitMenu(_game);
        });
    }
    // The bottom bar's Wait… and ⏩ Week, beside End Turn (components/GameView.jsx)
    const wait = document.getElementById('simsWait');
    if (wait && !wait._timeSkipWired) {
        wait._timeSkipWired = true;
        wait.addEventListener('click', () => {
            if (!_game) return;
            if (_game._timeSkip) TimeSkip.cancel(_game);
            else ActionMenu.showWaitMenu(_game);
        });
    }
    const week = document.getElementById('simsSkipWeek');
    if (week && !week._timeSkipWired) {
        week._timeSkipWired = true;
        week.addEventListener('click', () => {
            if (!_game) return;
            if (_game._timeSkip) TimeSkip.cancel(_game);
            else ActionMenu.waitDays(_game, 7);
        });
    }
    if (_keysInstalled) return;
    _keysInstalled = true;
    // (capture: Escape stops the wait before it closes panels or cancels travel)
    window.addEventListener('keydown', _onKey, true);
}

let _game = null;
let _keysInstalled = false;

function _onKey(e) {
    const game = _game;
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (!game || !game.world || !game.player) return;
    if (e.key === 'Escape' && game._timeSkip) {
        TimeSkip.cancel(game);
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.repeat && !game._timeSkip) {
        if (document.getElementById('customPanel') || document.getElementById('actionMenu')) return;
        e.preventDefault();
        ActionMenu.waitDays(game, 7);
    }
}

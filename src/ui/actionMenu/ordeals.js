// ActionMenu — trial by combat and by ordeal, as rows of the ⚖️ Courts &
// Lawsuits panel (ui/actionMenu/trials.js): "Another judgement" at your own
// trial (combat in person or by a champion, the iron, the water, the bread,
// oath-helpers, paying the priest), the same for a case before your court
// (and the right the accused demands), the wager of battle in a lawsuit, and
// the 🛡️ Champions & Kin tab (a kinsman accused, champions wanted, the
// realm's customs). Every click routes through trialsAct('ordeal', sub, args)
// — no ActionMenu members of its own. Fights open the duel panel
// (ui/actionMenu/duel.js). Logic in player/ordeals.js.
import { ActionMenu } from './_ref.js';
import { Ordeals, ordealOddsWord } from '../../player/ordeals.js';
import { Trials } from '../../player/trials.js';
import { DuelPanel } from './duel.js';
import { lede, chips, rowList, card, price, purse, bullets, more, esc } from './uiKit.js';
import { Utils } from '../../core/utils.js';

const _row = (o, sub, args) => ({ ...o, act: 'trialsAct', args: ['ordeal', sub, args] });
const _pct = p => `${Math.round(p * 100)}%`;

/** "Another judgement" rows for the trial you await. */
export function ordealTrialRows(player, world, trial) {
    if (!trial) return '';
    const o = trial.ordeal;
    if (o && !o.pending) {
        const M = Ordeals.method(o.method);
        const desc = o.method === 'iron' ? `Your hand is bound and sealed until day ${o.unbind}: the court sits then` : (o.text || '');
        return rowList([{ icon: M.icon, name: esc(M.name), desc: esc(desc), tone: 'warn' }], 'Another judgement');
    }
    const opts = Ordeals.trialOptions(player, world, trial);
    if (!opts.length) return '';
    const rows = [];
    const cv = Ordeals.customsView(world, trial.kingdomId);
    for (const op of opts) {
        if (op.id === 'combat') {
            if (!op.ok) { rows.push({ icon: op.icon, name: esc(op.name), off: true, why: esc(op.why) }); continue; }
            for (const ch of Ordeals.champions(player, world, trial)) {
                rows.push(_row({ icon: ch.self ? '⚔️' : '🛡️', name: ch.self ? 'Demand trial by combat: fight yourself' : `Trial by combat: ${esc(ch.name)} fights for you`, desc: esc(ch.self ? 'Against the accusers\' champion, to the yield or the fall. Yield, and it is guilt' : ch.desc), side: ch.fee ? price(ch.fee, player.gold >= ch.fee) : '', off: ch.fee > player.gold, why: 'You cannot pay the fee.', tone: 'gold' }, 'trialCombat', [ch.id]));
            }
            continue;
        }
        if (op.id === 'compurgation') {
            rows.push(op.ok
                ? _row({ icon: op.icon, name: 'Swear with oath-helpers', desc: esc(`${op.helpers} of your people might swear with you; the custom here asks ${op.need}. Too few, and it is guilt`), tone: op.helpers >= op.need ? 'good' : 'warn' }, 'trialOath', [])
                : { icon: op.icon, name: esc(op.name), off: true, why: esc(op.why) });
            continue;
        }
        rows.push(op.ok
            ? _row({ icon: op.icon, name: esc(op.name), desc: esc(`${op.desc} (${ordealOddsWord(op.odds)}: ${_pct(op.odds)})`), tone: 'warn' }, 'trialOrdeal', [op.id])
            : { icon: op.icon, name: esc(op.name), off: true, why: esc(op.why) });
    }
    if (opts.some(x => x.ok && Ordeals.method(x.id).kind === 'ordeal') && !trial.priestPaid && !trial.priestRefused) {
        const fee = Ordeals.priestFee(trial);
        rows.push(_row({ icon: '🤫', name: 'Pay the priest', desc: cv.stanceDef.priestBribe ? 'A cooler iron, a looser rope, softer bread' : 'This faith holds the ordeal sacred: the priest will tell the court', side: price(fee, player.gold >= fee), off: player.gold < fee, why: 'You cannot pay it.', tone: cv.stanceDef.priestBribe ? 'warn' : 'bad' }, 'priest', ['trial']));
    }
    const lead = `${cv.stanceDef.icon} The law of the realm: <b>${esc(cv.law.label)}</b>.${cv.faith ? ` Its faith, ${esc(cv.faith)}, ${esc(cv.stanceDef.label)}.` : ''}`;
    return `<div class="pk-row-why" style="font-size:11px; margin:6px 0 2px;">${lead}</div>${rowList(rows, 'Another judgement')}`;
}

/** Rows for a case before your court: the right demanded, the ordeals the law allows. */
export function ordealCaseRows(player, world, c) {
    if (c.ordeal && !c.ordeal.pending) {
        return `<div style="margin:4px 0; color:${c.ordeal.guilty ? '#e08a7a' : '#9fd89f'};">${Ordeals.method(c.ordeal.method).icon} ${esc(c.ordeal.text || '')} ${c.ordeal.guilty ? 'Now pass sentence: heed God\'s judgement, or pardon.' : ''}</div>`;
    }
    const opts = Ordeals.caseOptions(player, world, c);
    if (!opts.length) return '';
    const rows = [];
    for (const op of opts) {
        const tag = op.demanded ? ' (they demand it)' : '';
        if (!op.ok) { rows.push({ icon: op.icon, name: `${esc(op.name)}${tag}`, off: true, why: esc(op.why) }); continue; }
        if (op.id === 'combat') {
            rows.push(_row({ icon: op.icon, name: `Grant trial by combat${tag}`, desc: 'The accused against the accuser, or the champion they hire', tone: op.demanded ? 'gold' : '' }, 'caseJudge', [c.id, 'combat']));
            rows.push(_row({ icon: '⚔️', name: 'Fight the accused yourself', desc: 'As your own court\'s champion: if you fall, they go free', tone: 'warn' }, 'caseSelf', [c.id]));
        } else rows.push(_row({ icon: op.icon, name: `${esc(op.name)}${tag}`, desc: esc(op.desc), tone: op.demanded ? 'gold' : '' }, 'caseJudge', [c.id, op.id]));
    }
    const head = c.demand ? `${esc(c.accused.name)} demands ${esc(Ordeals.method(c.demand).name.toLowerCase())}. Refuse it and convict, and the town will say you denied a right.` : 'Or let God decide';
    return rowList(rows, head);
}

/** Rows for an open lawsuit: the wager of battle. */
export function ordealSuitRows(player, world, suit) {
    if (!suit || suit.status !== 'open') return '';
    if (suit.combat && suit.combat.done) return '';
    const a = Ordeals.allowed(world, suit.kingdomId, 'combat');
    if (!a.ok) return '';
    const rows = [];
    if (suit.combatDemand) rows.push({ icon: '⚔️', name: `${esc(suit.rivalName)} demands the wager of battle`, desc: 'Answer it, or refuse and lose face', tone: 'warn' });
    else if (suit.combatRefused) return '';
    for (const ch of Ordeals.champions(player, world, suit)) {
        rows.push(_row({ icon: ch.self ? '⚔️' : '🛡️', name: ch.self ? (suit.combatDemand ? 'Take up the wager: fight yourself' : 'Offer the wager of battle: fight yourself') : `${suit.combatDemand ? 'Take up the wager' : 'Offer the wager'}: ${esc(ch.name)} fights for you`, desc: esc(ch.self ? 'Against their head, to the yield or the fall: the suit goes with the victor' : ch.desc), side: ch.fee ? price(ch.fee, player.gold >= ch.fee) : '', off: ch.fee > player.gold, why: 'You cannot pay the fee.', tone: 'gold' }, 'suitCombat', [suit.id, ch.id]));
    }
    if (suit.combatDemand) rows.push(_row({ icon: '✋', name: 'Refuse the wager', desc: 'Let the judge decide. Prestige lost', tone: 'bad' }, 'suitRefuse', [suit.id]));
    return rowList(rows);
}

/** The 🛡️ Champions & Kin tab. */
export function championsTab(player, world) {
    const v = Ordeals.view(player, world);
    let html = lede('Where the law and the faith allow, a case may go to God\'s judgement: the lists, the hot iron, the water, the bread, or oath-helpers who swear with the accused. Your kin may need you as their champion, and strangers will pay one.');
    if (v.here) {
        html += chips([
            ['📕', 'Here', esc(v.here.law.label)],
            [v.here.stanceDef.icon, 'Faith', esc(v.here.faith ? `${v.here.faith}: ${v.here.stanceDef.label}` : 'none')],
            ['🏆', 'Your fights', `${v.stats.wins} won · ${v.stats.losses} lost`],
        ]);
    }
    if (v.kin) {
        const k = v.kin;
        let body = `<div style="margin-bottom:4px;">${esc(k.name)} stands accused of <b>${esc(k.label)}</b>${k.accuser ? ` by ${esc(k.accuser.name)}` : ''} before the court of ${esc(k.town)}, on day ${k.day}.</div>`;
        body += rowList(v.kinOptions.map(o => (o.ok
            ? _row({ icon: o.icon, name: esc(o.name), desc: esc(o.desc || ''), side: o.fee ? price(o.fee, player.gold >= o.fee) : '', tone: o.id === 'champion' ? 'gold' : '' }, 'kin', [o.id])
            : { icon: o.icon, name: esc(o.name), off: true, why: esc(o.why || '') })));
        if (!k.priestPaid && v.kinOptions.some(o => o.ok && Ordeals.method(o.id).kind === 'ordeal')) {
            const fee = Ordeals.priestFee(k);
            body += rowList([_row({ icon: '🤫', name: 'Pay the priest first', desc: 'A cooler iron, a looser rope, softer bread', side: price(fee, player.gold >= fee), off: player.gold < fee, why: 'You cannot pay it.', tone: 'warn' }, 'priest', ['kin'])]);
        }
        html += card(body, { icon: '⚖️', title: `${esc(k.name)} accused`, side: `day ${k.day}`, tone: 'warn' });
    }
    if (v.calls.length) {
        const rows = v.calls.map(c => _row({ icon: '🛡️', name: `Fight for ${esc(c.client)}`, desc: esc(`${c.side === 'accused' ? 'Accused of' : 'Bringing a charge of'} ${c.crimeLabel} at ${c.town}. Against ${c.foe.name}. Until day ${c.expires}`), side: price(c.fee, true), off: player.q !== c.q || player.r !== c.r, why: esc(`You must be at ${c.town}.`), tone: 'gold' }, 'call', [c.id]));
        html += rowList(rows, 'Champions wanted');
    } else html += card('No one here needs a champion now. In a town whose law allows trial by combat, those with a case before the court look for one; a champion with wins behind them is sought more, and paid more.', { icon: '🛡️', title: 'A champion for hire' });
    if (v.perjuries) html += card(`${v.perjuries} oath${v.perjuries === 1 ? '' : 's'} sworn for you against the plain proof. If the truth comes out, all who swore are shamed.`, { icon: '🤝', title: 'Oaths that may come out', tone: 'bad' });
    if (v.history.length) html += more('Ordeals and fights', bullets(v.history.slice(0, 10).map(h => `${esc(h.text)} <span style="color:#8f8a7e;">(day ${h.day})</span>`)));
    html += chips([purse(player.gold)]);
    return html;
}

function _show(game, res, tone = null) {
    ActionMenu.showTrialsPanel(game, { html: esc(res.text || 'Done.'), raw: res.text, tone: tone || (res.refused ? 'bad' : 'good') });
}

/** Run a fight in the duel panel, then settle it. */
function _fight(game, spec, settle) {
    DuelPanel.open(game, {
        ...spec,
        continueLabel: 'Hear the judgement',
        onFinish: (outcome) => {
            const res = settle(outcome);
            if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
            if (!res || !res.success) { game.ui.showNotification('⚔️ Trial by Combat', (res && res.reason) || 'The fight came to nothing.', 'error'); return; }
            _after(game, res);
        },
    });
}

/** After an ordeal that decides at once: the court gives its verdict, the case its end. */
function _after(game, res, ctx = {}) {
    const { player, world } = game;
    if (res.resolveNow) {
        const r = Trials.resolveTrial(player, world);
        if (r) { _show(game, { text: r.text }, r.convicted ? 'bad' : 'good'); return; }
    }
    if (res.resolveSuit) {
        const suit = (player.trials && player.trials.suits || []).find(s => s.combat && s.combat.done && s.status === 'open');
        if (suit) {
            const r = Trials.resolveSuit(player, world, suit, () => Utils.random());
            _show(game, { text: `${res.text} ${r.text}` }, r.won ? 'good' : 'bad');
            return;
        }
    }
    if (ctx.caseId != null && res.cleared && !res.dead) {
        const r = Trials.rule(player, world, ctx.caseId, 'acquit');
        _show(game, { text: `${res.text} ${r && r.text ? r.text : ''}` }, 'good');
        return;
    }
    _show(game, res, res.guilty || res.cleared === false ? 'bad' : 'good');
}

/** trialsAct('ordeal', sub, args): every ordeal click. */
export function ordealsAct(game, sub, args = []) {
    const { player, world } = game;
    if (!player || !world) return;
    const [x, y] = Array.isArray(args) ? args : [];
    let res;
    let ctx = {};
    switch (sub) {
        case 'trialCombat': res = Ordeals.trialCombat(player, world, x); if (res.duel) { _fight(game, res.duel, o => Ordeals.settleTrialCombat(player, world, o)); return; } break;
        case 'trialOrdeal': res = Ordeals.trialOrdeal(player, world, x); break;
        case 'trialOath': res = Ordeals.trialOath(player, world); break;
        case 'priest': {
            const target = x === 'kin' ? Ordeals.state(player).kin : player.trials && player.trials.trial;
            res = Ordeals.payPriest(player, world, target);
            break;
        }
        case 'caseJudge': res = Ordeals.judgeCase(player, world, x, y); ctx = { caseId: x }; break;
        case 'caseSelf': res = Ordeals.judgeCase(player, world, x, 'combat', { self: true }); if (res.duel) { _fight(game, res.duel, o => { const r = Ordeals.settleCaseCombat(player, world, x, o); if (r.success && r.cleared && !r.dead) { const rr = Trials.rule(player, world, x, 'acquit'); r.text = `${r.text} ${rr && rr.text ? rr.text : ''}`; } return r; }); return; } break;
        case 'suitCombat': res = Ordeals.suitCombat(player, world, x, y); if (res.duel) { _fight(game, res.duel, o => Ordeals.settleSuitCombat(player, world, x, o)); return; } break;
        case 'suitRefuse': res = Ordeals.refuseSuitCombat(player, world, x); break;
        case 'kin': res = Ordeals.kinAct(player, world, x); if (res.duel) { _fight(game, res.duel, o => Ordeals.settleKinCombat(player, world, o)); return; } break;
        case 'call': res = Ordeals.takeCall(player, world, x); if (res.duel) { _fight(game, res.duel, o => Ordeals.settleCall(player, world, x, o)); return; } break;
        default: return;
    }
    if (!res || !res.success) {
        game.ui.showNotification('⚖️ Courts', (res && res.reason) || 'That cannot be done.', 'error');
        return;
    }
    game.ui.updateStats(player, world);
    // (an ordeal or a champion's bout is told before its judgement: the picture, the beats, the exchanges)
    if (res.scene || res.bout) { showOrdealScene(game, res, () => _after(game, res, ctx)); return; }
    _after(game, res, ctx);
}

// ── The ordeal told: a drawn picture and its beats ─────────────────────

const _fire = (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M0 0 C-8 -10 -4 -18 0 -26 C2 -18 10 -14 6 -4 C10 -8 10 -14 8 -18 C16 -8 12 4 0 4 C-10 4 -12 -4 0 0 Z" fill="#e8742a"/><path d="M0 0 C-4 -6 -2 -11 0 -15 C3 -10 6 -6 2 0 Z" fill="#ffd25a"/></g>`;
const _figure = (x, y, c = '#cdbb94', s = 1) => `<g transform="translate(${x},${y}) scale(${s})" fill="${c}"><circle cx="0" cy="-34" r="6"/><path d="M-7 -26 h14 l3 22 h-6 l-1 18 h-6 l-1 -18 h-6 Z"/></g>`;

/**
 * A small picture of the ordeal (inline SVG in the panel's dark voice).
 * method: combat | iron | water | bread | compurgation; stage: 0.. the beat;
 * done: the outcome (true cleared, false guilty, null not yet).
 */
export function ordealPicture(method, stage = 0, done = null) {
    const W = 320;
    const H = 150;
    let g = `<rect width="${W}" height="${H}" fill="#1b1712"/><rect y="112" width="${W}" height="38" fill="#2a231a"/>`;
    const glow = done === true ? '#9fd89f' : done === false ? '#e08a7a' : '#f5c542';
    if (method === 'iron') {
        g += `<rect x="40" y="88" width="40" height="24" fill="#3b2f25"/>${_fire(60, 88, 1)}`;
        const ix = 60 + Math.min(2, stage) * 90;
        g += `<rect x="${ix - 14}" y="70" width="28" height="6" rx="2" fill="${stage === 0 ? '#ff6a2a' : '#c94a1e'}"/>`;
        g += _figure(ix, 112, '#cdbb94');
        for (let i = 0; i < 9; i++) g += `<circle cx="${70 + i * 24}" cy="124" r="2" fill="${i * 24 <= (ix - 60) ? glow : '#4a3e30'}"/>`;
        if (stage >= 2) g += `<rect x="${ix + 6}" y="76" width="10" height="10" rx="3" fill="#e9e1cc"/><circle cx="${ix + 11}" cy="81" r="2.5" fill="#a8322a"/>`;
    } else if (method === 'water') {
        g += `<rect x="120" y="96" width="200" height="54" fill="#1f3a52"/><path d="M120 100 q12 -6 24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0" stroke="#5c8fb3" fill="none"/>`;
        g += `<line x1="70" y1="60" x2="${190}" y2="${stage >= 1 ? 96 + stage * 10 : 70}" stroke="#a08a63" stroke-width="2"/>${_figure(60, 112, '#cdbb94')}`;
        const by = done === true ? 136 : done === false ? 98 : 82 + stage * 12;
        g += `<ellipse cx="190" cy="${by}" rx="12" ry="9" fill="#cdbb94"/><line x1="182" y1="${by}" x2="198" y2="${by}" stroke="#6b5a40" stroke-width="2"/>`;
    } else if (method === 'bread') {
        g += `<rect x="110" y="70" width="100" height="42" fill="#4a3b2c"/><rect x="104" y="64" width="112" height="8" fill="#e9e1cc"/><rect x="155" y="34" width="10" height="30" fill="#c9a86a"/><rect x="146" y="42" width="28" height="6" fill="#c9a86a"/>`;
        g += `<ellipse cx="140" cy="62" rx="10" ry="5" fill="#d9b06a"/><rect x="170" y="57" width="14" height="6" fill="#efe1a0"/>`;
        g += _figure(80, 112, '#9d8a68') + _figure(240, 112, done === false ? '#e08a7a' : '#cdbb94');
    } else if (method === 'compurgation') {
        g += `<rect x="140" y="80" width="40" height="22" rx="3" fill="#c9a86a"/><rect x="136" y="100" width="48" height="12" fill="#7a5a2a"/>`;
        const n = Math.min(10, 2 + stage * 4);
        for (let i = 0; i < n; i++) g += _figure(i < 5 ? 20 + i * 24 : 204 + (i - 5) * 24, 112, i === 0 ? '#e9d9a8' : '#9d8a68', 0.8);
    } else {
        // The lists: two fighters, a barrier, the crowd
        g += `<rect x="0" y="96" width="${W}" height="4" fill="#6b5a40"/>`;
        for (let i = 0; i < 12; i++) g += `<circle cx="${14 + i * 27}" cy="${30 + (i % 2) * 6}" r="7" fill="#3a3128"/>`;
        const gap = Math.max(10, 80 - stage * 30);
        g += _figure(160 - gap, 112, '#cdbb94') + _figure(160 + gap, 112, '#b08a7a');
        g += `<line x1="${160 - gap + 8}" y1="${82}" x2="${160 - gap + 26}" y2="${66}" stroke="#e9e1cc" stroke-width="2"/><line x1="${160 + gap - 8}" y1="${82}" x2="${160 + gap - 26}" y2="${66}" stroke="#e9e1cc" stroke-width="2"/>`;
    }
    if (done !== null) g += `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="${glow}" stroke-width="3"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:460px; display:block; margin:0 auto 6px; border-radius:6px;" role="img" aria-label="${esc(Ordeals.method(method).name)}">${g}</svg>`;
}

/** The beats of an ordeal, then its judgement; `then` gives the court's verdict. */
export function showOrdealScene(game, res, then) {
    const sc = res.scene || { method: 'combat', who: res.bout ? res.bout.a : 'you', cleared: res.bout ? res.bout.won : null };
    const method = sc.method === 'champion' || String(sc.method).startsWith('hire') ? 'combat' : sc.method;
    const beats = (((Ordeals.config().scenes || {})[method]) || []).map(t => String(t).replace(/\{Who\}/g, sc.who === 'you' ? 'You' : (sc.who || 'They')).replace(/\{who\}/g, sc.who || 'they'));
    let i = 0;
    const render = () => {
        const last = i >= beats.length;
        const done = last && !sc.pending ? (sc.cleared != null ? !!sc.cleared : null) : null;
        let h = '<div style="font-size:12px; max-width:480px;">';
        h += ordealPicture(method, Math.min(i, 2), done);
        h += beats.slice(0, Math.min(i + 1, beats.length)).map((b, k) => `<div style="margin:3px 0; ${k < i ? 'opacity:0.6;' : ''}">${esc(b)}</div>`).join('');
        if (last && res.bout) {
            const b = res.bout;
            h += `<div class="pk-head">${esc(b.a)} against ${esc(b.b)}</div>`;
            h += b.log.map(e => `<div style="font-size:11px; margin:2px 0;"><b>R${e.round}</b> ${esc(e.text || '')}</div>`).join('');
        }
        if (last && sc.method === 'compurgation' && sc.need) h += `<div style="margin:4px 0;">🤝 <b>${sc.n}</b> of ${sc.need} swear.</div>`;
        if (last) h += `<div style="margin:6px 0; color:${done === false ? '#e08a7a' : done === true ? '#9fd89f' : '#e9d9a8'};">${esc(res.text || '')}</div>`;
        h += rowList([last
            ? { icon: '⚖️', name: sc.pending ? 'Back to the court' : 'Hear the judgement', tone: 'gold', attrs: 'onclick="window._ordealScene.done()"' }
            : { icon: '➡️', name: 'Go on', attrs: 'onclick="window._ordealScene.next()"' }]);
        h += '</div>';
        game.ui.showCustomPanel(`${Ordeals.method(method).icon} ${Ordeals.method(method).name}`, h);
    };
    let finished = false;
    window._ordealScene = {
        next: () => { if (i < beats.length) { i++; render(); } },
        done: () => { if (finished) return; finished = true; then(); },
    };
    render();
}

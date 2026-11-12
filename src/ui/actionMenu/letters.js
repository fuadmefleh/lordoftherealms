// ActionMenu — the Letters panel (Journal → Letters, Dynasty → Letters, a
// town's Post House): letters from lords, your liege, rival Houses, your
// spouse and your children abroad, each with its answers and deadline; the
// letters already answered or left to lapse (and the replies to your own
// mail); your loans to lords and promises to ride; what each lord remembers
// of you; writing letters of your own (Write), the letters on the road
// (In Transit) and the courier houses — yours to found and run, the Royal
// Post (Post). Logic lives in systems/courtLetters.js, systems/mail.js,
// systems/couriers.js and world/npcLords.js (memory); buttons route through
// data-am-act → ActionMenu.lettersAct.
import { ActionMenu } from './_ref.js';
import { NPCLords } from './_imports.js';
import { CourtLetters } from '../../systems/courtLetters.js';
import { Mail } from '../../systems/mail.js';
import { MailVoice } from '../../systems/mailVoice.js';
import { Couriers } from '../../systems/couriers.js';
import { CourierRiders } from '../../systems/courierRiders.js';
import { Kingship } from '../../systems/kingship.js';
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, BTN_RED, esc, panelTabs, sectionHead, lede, chips, card, actRow, rowList, price } from './uiKit.js';

// A recipient's note, skipped when the name already says it ("King X of Valdoria" · "Valdoria")
const _subOf = (r) => (r.sub && !String(r.name || '').includes(r.sub) ? r.sub : '');

const TABS = [['inbox', '✉️ Inbox'], ['write', '✍️ Write'], ['transit', '📮 In Transit'], ['post', '🐎 Post'], ['answered', '📜 Answered'], ['accounts', '🏦 Debts & Promises'], ['memory', '🧠 What Lords Remember']];
const FROM = { lord: 'Lord', liege: 'Your liege', rival: 'Rival House', spouse: 'Your spouse', child: 'Your child', mail: 'In answer to your letter', courier: 'Your courier house' };
const OUTCOME = { ignored: ['🕯️', '#e0846a', 'Left unanswered'], reply: ['📨', '#9fc8ff', 'A reply'], letter: ['✉️', '#d8c89f', 'Unbidden'] };
const STATUS = { delivered: ['✔', '#8fd18a', 'Delivered'], lost: ['📭', '#e0846a', 'Lost'], robbed: ['🗡️', '#e0846a', 'Robbed'], undelivered: ['↩️', '#cbbf9f', 'Returned'] };
const TONE = { warm: ['#8fd18a', 'warmly received'], cool: ['#d8c89f', 'coolly received'], hostile: ['#e0846a', 'badly received'] };
const MUTED = 'font-size:11px; color:#9d937c;';

let _tab = 'inbox';
let _reading = null; // the archived letter open in full (Answered)
let _draft = { to: null, kind: null, courier: null, gold: 0, item: null };

/** A small button routed to ActionMenu.lettersAct (several on one line: toggles, staff ±). */
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_OFF}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="lettersAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

/** One action-menu row routed to ActionMenu.lettersAct; `enabled` false greys it with `why`. */
function row(o, args, enabled = true, why = '') {
    return enabled ? { ...o, act: 'lettersAct', args } : { ...o, off: true, why: why || o.why || o.desc || '' };
}

/** A quiet "nothing here" line. */
const none = (text) => `<div style="${MUTED} margin:2px 2px 8px;">${text}</div>`;

const pct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;
const dangerWord = (d) => (d >= 0.4 ? ['#e0846a', 'dangerous roads'] : d >= 0.15 ? ['#d8c89f', 'some danger'] : ['#8fd18a', 'safe roads']);

// A letter in its writer's hand (systems/mailVoice.js): who held the pen, the
// tongue it came in, the salutation, the body, a P.S., the closing and the
// signature on a sheet of parchment; what came with it underneath.
const SHEET = 'background:linear-gradient(175deg,#efe1bd 0%,#e6d3a6 60%,#dcc694 100%); color:#3a2a17; border-radius:4px; padding:12px 16px 10px; margin:6px 0 4px; box-shadow:inset 0 0 24px rgba(120,84,30,0.28), 0 1px 3px rgba(0,0,0,0.45); font-family:Georgia,serif; font-size:13px; line-height:1.5;';
export function letterSheet(player, letter) {
    const r = MailVoice.read(player, letter);
    if (!r) return '';
    let html = '';
    for (const n of r.notes) html += `<div style="font-size:11px; color:#b9ad8e; font-style:italic; margin:2px 0;">✒️ ${esc(n)}</div>`;
    html += `<div style="${SHEET}">`;
    if (r.salutation) html += `<div style="margin-bottom:6px;">${esc(r.salutation)}</div>`;
    for (const p of r.paras) html += `<p style="margin:0 0 7px; text-indent:1.2em;">${esc(p)}</p>`;
    if (r.ps) html += `<p style="margin:4px 0 7px; font-style:italic;">${esc(r.ps)}</p>`;
    if (r.closing || r.signature) {
        html += '<div style="text-align:right; margin-top:6px;">';
        if (r.closing) html += `<div>${esc(r.closing)}</div>`;
        if (r.signature) html += `<div style="font-style:italic; font-size:14px;">${esc(r.signature)}</div>`;
        html += '</div>';
    }
    html += '</div>';
    const came = [...(r.enclosed || []).map(e => `📎 ${esc(e)}`), ...((letter.received || []).map(x => esc(x)))];
    if (came.length) html += `<div style="font-size:11px; color:#d8c89f; margin:2px 0 4px;">${came.join(' · ')}</div>`;
    if (r.voiced) html += `<div style="${MUTED}">(in their own words, by the AI voice)</div>`;
    return html;
}

function inboxTab(v, player) {
    const year = v.unansweredThisYear ? ` ${v.unansweredThisYear} letter${v.unansweredThisYear === 1 ? '' : 's'} went unanswered this past year, and the senders keep count.` : '';
    if (!v.open.length) return lede(`No letters await an answer. When the great write to you, a herald will say so. (Write your own from the ✍️ Write tab.)${year}`);
    let html = year ? lede(`Silence has a price.${year}`) : '';
    for (const l of v.open) {
        const urgent = l.urgent != null ? l.urgent : l.daysLeft <= 2;
        let body = `<div style="${MUTED}">${esc(FROM[l.fromType] || 'From')}: ${esc(l.from)} · awaiting your reply since day ${l.since}${l.waited ? ` (${l.waited} day${l.waited === 1 ? '' : 's'})` : ' (today)'} · answer by day ${l.due}</div>`;
        if (l.ifIgnored && l.ifIgnored.length) {
            const heavy = l.ignoreScale >= 1.5 ? ' <b>They will not take silence lightly.</b>' : '';
            const again = l.snubs ? ` You have left ${l.snubs} of their letters unanswered this year.` : '';
            body += `<div style="font-size:11px; color:${urgent ? '#e0846a' : '#cf9f84'}; margin:2px 0;">🕯️ If left unanswered: ${esc(l.ifIgnored.join('; '))}.${again}${heavy}</div>`;
        }
        body += l.letter ? letterSheet(player, l.letter) : `<div style="color:#ece2c8; font-style:italic; margin:6px 0;">${esc(l.body)}</div>`;
        body += rowList(l.choices.map((c, i) => row({
            icon: i === 0 ? '✒️' : '·', name: esc(c.label), desc: c.tooltip ? esc(c.tooltip) : '', title: c.ok ? c.tooltip : c.why,
            why: c.why ? esc(c.why) : '', tone: i === 0 ? 'gold' : '',
        }, ['answer', l.id, c.id], c.ok, c.why ? esc(c.why) : 'Not possible now')));
        const block = card(body, {
            icon: l.icon, title: esc(l.subject), tone: urgent ? 'bad' : '',
            side: l.daysLeft === 0 ? 'answer today' : `${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'} left`,
        });
        html += l.read ? block : block.replace('<div class="pk-card', '<div style="border-color: rgba(245,197,66,0.45);" class="pk-card');
    }
    return html;
}

function answeredTab(v, game) {
    if (!v.archive.length) return none('No letters answered yet.');
    let html = '';
    const open = _reading != null ? v.archive.find(a => a.id === _reading && a.letter) : null;
    if (open) {
        html += card(letterSheet(game.player, open.letter), {
            icon: '📜', title: `${esc(open.subject || 'A letter')} <span style="${MUTED}">— ${esc(open.from && open.from.name)}, day ${open.day}</span>`,
            side: act('Fold it away', ['read', null], BTN_PLAIN),
        });
    }
    html += rowList(v.archive.map(a => {
        const [icon, color, label] = OUTCOME[a.outcome] || ['✔', '#8fd18a', 'Answered'];
        // A lapsed letter's history: how long it waited, and what the silence cost
        const lapsed = a.outcome === 'ignored' && a.lapsed != null
            ? `<br><span style="color:#e0846a;">🕯️ Waited ${a.waited || 0} days; lapsed on day ${a.lapsed}${a.costs && a.costs.length ? ` · cost: ${esc(a.costs.join('; '))}` : ''}</span>` : '';
        const text = a.outcome === 'ignored' && a.costs && a.costs.length ? String(a.text || '').replace(/ Cost: .*$/, '') : a.text;
        const row0 = {
            icon, name: esc(a.subject || 'A letter'), desc: `— ${esc(a.from && a.from.name)}`,
            note: text || lapsed ? `<span style="color:#cbbf9f;">${esc(text || '')}</span>${lapsed}` : '',
            side: `<span style="color:${color};">${label}</span><br><span style="${MUTED}">day ${a.day}${a.letter ? ' · read ›' : ''}</span>`,
        };
        return a.letter ? row(row0, ['read', a.id]) : row0;
    }), 'Letters answered');
    const keep = Mail.view(game.player, game.world).keepsakes || [];
    if (keep.length) html += sectionHead('Keepsakes') + `<div style="font-size:11.5px; color:#d8c89f; margin:0 2px 8px;">${keep.map(k => `${esc(k.what)} <span style="${MUTED}">(from ${esc(k.from)}, day ${k.day})</span>`).join('<br>')}</div>`;
    return html;
}

function accountsTab(v, game) {
    let html = '';
    const visits = game ? (Mail.view(game.player, game.world).visits || []) : [];
    if (visits.length) {
        html += sectionHead('Visits promised');
        html += rowList(visits.map(x => ({
            icon: '🏡', name: `You promised <b>${esc(x.name)}</b> to come to ${esc(x.town)}`,
            desc: 'Stand in the town before the day is out', side: `<b>${x.daysLeft}</b> day${x.daysLeft === 1 ? '' : 's'}`, tone: x.daysLeft <= 3 ? 'bad' : 'warn',
        })));
    }
    html += sectionHead('Gold lent to crowns');
    if (!v.loans.length) html += none('You hold no crown\'s debt.');
    html += rowList(v.loans.map(l => ({
        icon: '🏦', name: `<b>${esc(l.kingdomName)}</b> owes ${l.principal + l.interest} gold`,
        desc: `${l.principal} lent + ${l.interest} interest, due on day ${l.due}`,
        side: price(l.principal + l.interest), tone: 'gold',
    })));
    html += sectionHead('Promises given');
    if (!v.promises.length) html += none('You have promised no one anything.');
    html += rowList(v.promises.map(p => ({
        icon: '⚔️', name: `You swore to ${esc(p.lordName)} to ride against <b>${esc(p.enemyName)}</b>`,
        desc: 'Win a campaign battle (Realm Politics → Campaign) in time',
        side: `<b>${p.daysLeft}</b> day${p.daysLeft === 1 ? '' : 's'}`, tone: p.daysLeft <= 3 ? 'bad' : 'warn',
    })));
    const s = v.stats;
    html += chips([
        ['✉️', 'Received', s.received], ['✒️', 'Answered', s.answered], ['🕯️', 'Unanswered', s.ignored], ['📜', 'Grievances', s.grievances || 0],
        ['🤝', 'Promises kept', s.kept], ['💔', 'Broken', s.broken],
        ['🏦', 'Loans made', s.lent], ['💰', 'Repaid', s.repaid], ['📉', 'Defaulted', s.defaulted],
    ]);
    return html;
}

function memoryTab(game) {
    const world = game.world;
    let html = lede('What each ruler holds against you, or in your favour. Memories fade with time; an heir inherits part of what a dead lord remembered.');
    let any = false;
    for (const k of (world.kingdoms || []).filter(x => x && x.isAlive !== false && x.lord)) {
        const mem = NPCLords.memoryOf(k.lord, world.day);
        if (!mem.length) continue;
        any = true;
        const total = NPCLords.memoryOpinion(k.lord, world.day);
        let body = '';
        for (const m of mem.slice(0, 5)) {
            const line = m.inherited ? `Heard from ${esc(m.from || 'the old ruler')}: ${esc(m.label)}` : `${esc(m.label)}${m.note ? ` (${esc(m.note)})` : ''}`;
            body += `<div style="font-size:11.5px; color:${m.weight >= 0 ? '#8fd18a' : '#e0846a'};">${m.icon} ${line} <span style="color:#9d937c;">· day ${m.day}</span></div>`;
        }
        html += card(body, {
            title: `<span style="color:${k.color || '#ffe9a8'};">${esc(k.lord.name)} of ${esc(k.name)}</span>`,
            side: `${total >= 0 ? '+' : ''}${total} opinion`, tone: total >= 0 ? 'good' : 'bad',
        });
    }
    if (!any) html += none('No ruler remembers anything of you yet — for good or ill.');
    return html;
}

// ──────────── WRITE ────────────

function recipientList(game) {
    const { player, world } = game;
    const recs = Mail.recipients(player, world);
    const types = Mail.recipientTypes();
    if (!recs.length) return none('You know no one to write to yet.');
    let html = lede('Choose who to write to. Their regard for you decides how a letter is taken.');
    const order = Object.keys(types).length ? Object.keys(types) : [...new Set(recs.map(r => r.type))];
    for (const type of order) {
        const group = recs.filter(r => r.type === type);
        if (!group.length) continue;
        const T = types[type] || {};
        html += rowList(group.slice(0, 20).map(r => {
            const reg = Mail.regard(player, world, r);
            return row({
                icon: T.icon || '✉️', name: esc(r.name),
                desc: `${esc(_subOf(r))} · ${esc(r.place || '')}${r.held && r.held.length ? ` · holds ${esc(r.held.map(h => h.name).join(', '))}` : ''}`,
                side: `<span style="font-size:11px; color:${reg >= 15 ? '#8fd18a' : reg <= -25 ? '#e0846a' : '#d8c89f'};">regard ${reg >= 0 ? '+' : ''}${Math.round(reg)}</span><br><span style="${MUTED}">Write ›</span>`,
            }, ['pick', r.key]);
        }), `${T.icon || '✉️'} ${esc(T.name || type)}`);
        if (group.length > 20) html += none(`…and ${group.length - 20} more.`);
    }
    return html;
}

function writeTab(game) {
    const { player, world } = game;
    const mv = Mail.view(player, world);
    let html = chips([
        ['🏇', 'On the road', `${mv.limits.inTransit}/${mv.limits.maxInTransit}`],
        ['✍️', 'Written today', `${mv.limits.today}/${mv.limits.perDay}`],
    ]);
    const to = _draft.to ? Mail.recipient(player, world, _draft.to) : null;
    if (!to) {
        _draft = { to: null, kind: null, courier: null, gold: 0, item: null };
        return html + recipientList(game);
    }
    html += card(`<div style="${MUTED}">${esc(_subOf(to))} · at ${esc(to.place || '?')} · regard ${Math.round(Mail.regard(player, world, to))}</div>`, {
        icon: '✉️', title: `To ${esc(to.name)}`, side: act('Someone else', ['clear'], BTN_PLAIN),
    });

    // The kind of letter
    const kinds = Mail.kindOptions(player, world, to);
    html += rowList(kinds.map(k => {
        const on = _draft.kind === k.id;
        return row({
            icon: k.icon, name: esc(k.name), desc: esc(k.desc), title: k.ok ? k.desc : k.why,
            side: on ? '✓ chosen' : '', tone: on ? 'gold' : '',
        }, ['kind', k.id], k.ok, esc(k.why || ''));
    }), 'What to write');
    const K = _draft.kind ? kinds.find(k => k.id === _draft.kind) : null;
    if (K && K.enclose) {
        html += sectionHead('Enclose');
        html += '<div style="margin:0 0 8px;">';
        for (const g of Mail.config().giftPresets || []) html += act(`💰 ${g}g`, ['gold', _draft.gold === g ? 0 : g], _draft.gold === g ? BTN_GOLD : BTN_PLAIN, (player.gold || 0) >= g);
        for (const it of Mail.itemOptions(player)) {
            const on = _draft.item === it.id;
            html += act(`📦 ${esc(String(it.id).replace(/_/g, ' '))} (~${it.value}g)`, ['item', on ? null : it.id], on ? BTN_GOLD : BTN_PLAIN);
        }
        html += '</div>';
    }

    // The courier
    if (K) {
        html += sectionHead('Who carries it');
        const opts = Mail.courierOptions(player, world, to);
        if (!Couriers.townHere(world, player)) html += none('Out here only your own rider can take it. In a town, the post houses there will carry it.');
        html += rowList(opts.map(c => {
            const [dc, dw] = dangerWord(c.danger);
            const sel = String(_draft.courier) === String(c.id);
            return row({
                icon: c.icon || '✉️',
                name: `${esc(c.name)}${c.own ? ' <span style="color:#8fd18a; font-size:11px; font-weight:400;">(your house — free)</span>' : ''}`,
                desc: `about ${c.days} day${c.days === 1 ? '' : 's'} · ${pct(c.reliability)} reliable${c.offNetwork ? ' · no station there (slower)' : ''}${c.guardCover ? ` · guarded ${pct(c.guardCover)}` : ''} · <span style="color:${dc};">${dw}</span>`,
                side: `${price(c.price)}<br><span style="${MUTED}">${sel ? '✓ Chosen' : 'Choose'}</span>`, tone: sel ? 'gold' : '',
            }, ['courier', String(c.id)]);
        }));
        const chosen = opts.find(c => String(c.id) === String(_draft.courier));
        const cost = (chosen ? chosen.price : 0) + (K.enclose ? (_draft.gold || 0) : 0);
        const ready = !!chosen && (!K.enclose || _draft.gold > 0 || _draft.item);
        html += `<div style="margin-top:6px;">${act(`✉️ Send${cost ? ` (${cost}g)` : ''}`, ['send'], BTN_GOLD, ready, ready ? '' : (chosen ? 'Enclose something first.' : 'Choose a courier.'))}</div>`;
    }
    return html;
}

// ──────────── IN TRANSIT ────────────

function transitTab(game) {
    const v = Mail.view(game.player, game.world);
    let html = sectionHead('On the road');
    if (!v.transit.length) html += none('No letters of yours are on the road.');
    html += rowList(v.transit.map(t => {
        const rider = CourierRiders.riderFor(game.world, t.id);
        const where = rider ? `🏇 on the map, ${Math.round(CourierRiders.progress(rider) * 100)}% of the way (${rider.q}, ${rider.r})` : '';
        return {
            icon: t.icon, name: `${esc(t.name)} to ${esc(t.to)}`,
            desc: `at ${esc(t.place || '?')} — with ${esc(t.courier)}${t.delayed ? ' <span style="color:#d8c89f;">(held up on the road)</span>' : ''}${t.gold ? ` · 💰 ${t.gold}g enclosed` : ''}${t.item ? ` · 📦 ${esc(String(t.item.id).replace(/_/g, ' '))}` : ''}`,
            note: where ? `<span style="color:#9d937c;">${where}</span>` : '',
            side: t.daysLeft ? `due in ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'}` : 'due today',
        };
    }));
    html += sectionHead('Replies on the way');
    if (!v.replies.length) html += none('No replies are riding back to you.');
    html += rowList(v.replies.map(r => ({ icon: '📨', name: `${esc(r.from)}'s answer`, side: `about ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} away` })));
    html += sectionHead('Letters sent');
    if (!v.sent.length) html += none('You have sent no letters yet.');
    html += rowList(v.sent.map(s => {
        const [icon, color, label] = STATUS[s.status] || ['•', '#cbbf9f', s.status];
        const tone = s.tone && TONE[s.tone];
        const notes = [];
        if (s.text) notes.push(`<span style="color:#cbbf9f;">${esc(s.text)}</span>`);
        if (s.intercepted) notes.push(`<span style="color:#e0a080;">🔓 Read on the way by ${esc(s.intercepted)}.</span>`);
        return {
            icon, name: `${esc((Mail.kind(s.kind) || {}).name || s.kind)} to <b>${esc(s.to)}</b>`,
            desc: `via ${esc(s.courier)}`, note: notes.join('<br>'),
            side: `<span style="color:${color};">${label}</span>${tone ? `<br><span style="color:${tone[0]}; font-size:11px;">${tone[1]}</span>` : ''}<br><span style="${MUTED}">day ${s.day != null ? s.day : s.sentDay}</span>`,
        };
    }));
    const st = v.stats;
    html += chips([
        ['✉️', 'Sent', st.sent], ['✔', 'Delivered', st.delivered], ['📭', 'Lost', st.lost], ['🗡️', 'Robbed', st.robbed],
        ['🔓', 'Opened on the way', st.intercepted], ['📨', 'Replies', st.replies],
    ]);
    return html;
}

// ──────────── POST ────────────

/** A courier house as a row (a listing, not a button). */
function houseRow(c, extra = '') {
    return {
        icon: c.icon,
        name: `${esc(c.name)} <span style="color:#9d937c; font-size:11px; font-weight:400;">${c.owner === 'player' ? 'yours' : esc(c.ownerName || '')} · of ${esc(c.homeName || '?')}</span>`,
        desc: `${c.stations.length} station${c.stations.length === 1 ? '' : 's'}: ${esc(c.stations.join(', '))}${c.charters.length ? ` · 📜 Royal Post of ${esc(c.charters.join(', '))}` : ''}`,
        note: extra,
        side: `${price(c.price)}<br><span style="${MUTED}">${esc(c.speedName)} · rep ${c.reputation} · ${pct(c.reliability)}</span>`,
    };
}

/** "🏇 Riders 3 [+1][−1]" — a staff line with its buttons. */
function staffLine(icon, label, n, plus, minus) {
    return `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:3px 0; border-bottom:1px solid rgba(245,197,66,0.07);"><span>${icon} ${label} <b style="color:#ece2c8;">${n}</b></span><span style="white-space:nowrap;">${plus}${minus}</span></div>`;
}

function myHouse(game, v) {
    const { player, world } = game;
    const C = Couriers.config();
    const m = v.mine;
    let html = sectionHead('Your courier house');
    if (!m) {
        const q = Couriers.foundQuote(player, world);
        html += rowList([row({
            icon: '📮', name: `Found a courier house${q.town ? ` here at <b>${esc(q.town.name)}</b>` : ''}`,
            desc: `${q.cost} gold for the yard, stables and two riders, and a ${q.licence} gold licence to the crown. Open stations in other towns, hire riders and relay horses, set your postage — and win the towns' mail from the houses already there. Your own letters ride free.`,
            side: price(q.cost + q.licence, q.ok), tone: 'gold',
        }, ['found'], q.ok, esc(q.why || ''))]);
        return html;
    }
    const last = m.last;
    html += rowList([houseRow(m)]);
    let body = '';
    body += staffLine('🏇', 'Riders', m.riders, act('+1', ['staff', 'riders', 1], BTN_PLAIN, true, `${C.costs.riderHire}g to hire, ${C.costs.riderWage}g a week`), act('−1', ['staff', 'riders', -1], BTN_PLAIN, m.riders > 0));
    body += staffLine('🐎', 'Relay horses', m.horses, act('+1', ['staff', 'horses', 1], BTN_PLAIN, true, `${C.costs.horsePrice}g, ${C.costs.horseUpkeep}g a week`), act('−1', ['staff', 'horses', -1], BTN_PLAIN, m.horses > 0, 'Sold at half price'));
    body += staffLine('🛡️', 'Guards', m.guards, act('+1', ['staff', 'guards', 1], BTN_PLAIN, true, `${C.costs.guardHire}g to hire, ${C.costs.guardWage}g a week — fewer riders robbed`), act('−1', ['staff', 'guards', -1], BTN_PLAIN, m.guards > 0));
    body += staffLine('✉️', 'Postage', `${m.price}g a letter`, act('−0.5', ['price', Math.max(C.price.min, m.price - 0.5)], BTN_PLAIN, m.price > C.price.min), act('+0.5', ['price', Math.min(C.price.max, m.price + 0.5)], BTN_PLAIN, m.price < C.price.max));
    body += '<div style="margin-top:6px;"><span style="color:#9d937c;">Pace:</span> ';
    for (const [id, S] of Object.entries(C.speeds)) body += act(`${S.icon} ${esc(S.name)}`, ['speed', id], m.speed === id ? BTN_GOLD : BTN_PLAIN, true, `${S.hexesPerDay} hexes a day · price ×${S.price} · wages ×${S.wage}${S.horsesPerStation ? ` · needs ${S.horsesPerStation} relay horses a station` : ''}`);
    body += '</div>';
    body += `<div style="${MUTED} margin-top:6px;">Reputation ${m.reputation} · reliability ${pct(m.reliability)}${last ? ` · last week: ${Math.round(last.letters)} letters, takings ${last.revenue}g, costs ${last.costs}g, <b style="color:${last.profit >= 0 ? '#8fd18a' : '#e0846a'};">${last.profit >= 0 ? '+' : ''}${last.profit}g</b>${last.robbed ? `, ${last.robbed} robbed` : ''}` : ' · the first week is not yet reckoned'}</div>`;
    if (m.history.length > 1) {
        body += `<div style="${MUTED} margin-top:4px;">Weeks: ` + m.history.map(h => `<span style="color:${h.profit >= 0 ? '#8fd18a' : '#e0846a'};">${h.profit >= 0 ? '+' : ''}${h.profit}</span>`).join(' · ') + '</div>';
    }
    const riders = CourierRiders.ownRiders(world).filter(u => u.letterId == null);
    if (riders.length) body += `<div style="${MUTED} margin-top:4px;">🏇 On the road: ${riders.map(u => `${esc(u.fromName)} → ${esc(u.toName)} (${Math.round(CourierRiders.progress(u) * 100)}%, at ${u.q}, ${u.r})`).join(' · ')}</div>`;
    html += card(body, { icon: '⚙️', title: 'The yard' });

    // Stations and the towns within reach
    const houseRec = Couriers.playerHouse(world);
    html += rowList((houseRec ? houseRec.stations : []).map(s => {
        const rivals = Couriers.alive(world).filter(o => o.owner !== 'player' && Couriers.hasStation(o, s.key));
        return {
            icon: '📮', name: esc(s.name),
            desc: rivals.length ? `vs ${esc(rivals.map(o => `${o.name} (${o.price}g)`).join(', '))}` : '<span style="color:#8fd18a;">the only post</span>',
            side: s.key === houseRec.home ? `<span style="${MUTED}">(home)</span>` : act('Close', ['closeStation', s.key], BTN_RED),
        };
    }), 'Stations');
    const opts = Couriers.stationOptions(world, player);
    if (opts.length) {
        html += rowList(opts.map(o => row({
            icon: '🏘️', name: esc(o.town.name),
            desc: `${o.dist} hexes · ~${Math.round(o.demand)} letters a week${o.servers.length ? ` · served by ${esc(o.servers.join(', '))}` : ' · no post'}`,
            side: price(o.cost, o.ok),
        }, ['station', o.town.key], o.ok, `${esc(o.why || '')}${o.why ? ' · ' : ''}${o.dist} hexes · ~${Math.round(o.demand)} letters a week`)), 'Open a station');
    }

    // The Royal Post
    const realms = [...new Set((houseRec ? houseRec.stations : []).map(s => s.kingdomId).filter(Boolean))];
    if (realms.length) {
        const rows = [];
        for (const kid of realms) {
            const k = world.getKingdom(kid);
            if (!k) continue;
            const q = Couriers.bidQuote(player, world, kid);
            const ch = Couriers.charter(world, kid);
            const holder = ch ? Couriers.get(world, ch.courierId) : null;
            const desc = `${holder ? `held by ${esc(holder.name)}` : 'no charter'}${q.ok ? ` · ${pct(q.chance)} chance` : ''}`;
            if (holder && holder.owner === 'player') rows.push({ icon: '📜', name: esc(k.name), desc, side: 'yours', tone: 'good' });
            else rows.push(row({ icon: '📜', name: esc(k.name), desc, side: `Petition ${price(q.cost, q.ok)}` }, ['bid', kid], q.ok, `${esc(q.why || '')}${q.why ? ' · ' : ''}${desc}`));
        }
        html += rowList(rows, 'The Royal Post');
    }
    return html;
}

function postTab(game) {
    const { player, world } = game;
    const v = Couriers.view(world, player);
    let html = '';
    if (v.here) {
        html += sectionHead(`The post at ${esc(v.here.name)}`);
        if (v.here.charter) html += `<div style="font-size:11px; color:#d8c89f; margin:0 2px 6px;">📜 The Royal Post: only ${esc((Couriers.get(world, v.here.charter.courierId) || {}).name || '?')} may carry this realm's mail.</div>`;
        if (!v.here.couriers.length) html += none('No courier house keeps a station here. Your own rider can still take a letter — or found a house yourself.');
        html += rowList([
            ...v.here.couriers.map(c => houseRow(c)),
            row({ icon: '✍️', name: 'Write a letter from here' }, ['tab', 'write']),
        ]);
    } else {
        html += lede('You are not in a town. The post houses keep their stations in towns.');
    }
    html += myHouse(game, v);
    if (v.ruled) {
        const def = Kingship.edicts().royal_post || {};
        const cost = def.passCost != null ? def.passCost : 150;
        html += sectionHead('Your realm\'s Royal Post');
        html += lede(v.ruled.holder ? `Held by <b>${esc(v.ruled.holder)}</b> by your edict. ${act('Revoke the edict', ['revoke'], BTN_RED)}` : `No house holds it. Proclaim the Royal Post edict (${cost}g from the royal treasury, an edict slot) for a house with a station in your realm: its weekly fee comes to the crown's books.`);
        html += rowList(Kingship.royalPostCandidates(player, world).filter(x => !x.holder).map(c => row({
            icon: '📜', name: `${v.ruled.holder ? 'Transfer' : 'Grant'} to ${esc(c.name)}`,
            desc: `${c.stations} station${c.stations === 1 ? '' : 's'} in your realm`,
            side: `${c.fee}g/wk`,
        }, ['grant', c.id])));
    }
    html += sectionHead('Every courier house');
    if (!v.all.length) html += none('No courier houses yet.');
    html += rowList(v.all.filter(x => x.owner !== 'player').map(c => houseRow(c, c.last ? `<span style="color:#9d937c;">about ${Math.round(c.last.letters)} letters a week</span>` : '')));
    if (v.charters.length) html += `<div style="${MUTED} margin-top:6px;">📜 Royal Posts: ${esc(v.charters.map(ch => `${ch.realm} — ${ch.holder}`).join(' · '))}</div>`;
    if (v.news.length) {
        html += rowList(v.news.map(n => ({ icon: n.icon, name: esc(n.text), side: `day ${n.day}` })), 'News of the post');
    }
    return html;
}

Object.assign(ActionMenu, {
    /** Journal → Letters: the inbox, writing, letters in transit, the post, answered letters, debts & promises, what lords remember. */
    showLetters(game, message = null) {
        const player = game.player;
        const world = game.world;
        const v = CourtLetters.view(player, world);
        let html = '<div style="font-size: 12px;">';
        if (message) html += `<div class="pk-card" style="border-color: ${message.color || 'rgba(245,197,66,0.4)'}; color:#ece2c8;">${message.html}</div>`;
        html += panelTabs(game, {
            id: 'letters', title: '✉️ Letters', tabs: TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showLetters(game); },
            attrsFor: (k) => `data-am-act="lettersAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        try {
            if (_tab === 'answered') html += answeredTab(v, game);
            else if (_tab === 'accounts') html += accountsTab(v, game);
            else if (_tab === 'memory') html += memoryTab(game);
            else if (_tab === 'write') html += writeTab(game);
            else if (_tab === 'transit') html += transitTab(game);
            else if (_tab === 'post') html += postTab(game);
            else html += inboxTab(v, player);
        } catch (e) {
            html += `<div class="pk-card" style="color:#e0846a;">This page could not be drawn (${esc(e && e.message)}).</div>`;
        }
        html += '</div>';
        game.ui.showCustomPanel('✉️ Letters', html);
        if (_tab === 'inbox') {
            CourtLetters.markRead(player);
            ActionMenu.updateLettersBadge(game);
        }
    },

    /** The count of unread letters on Journal → Letters (TopBar #lettersBadge). */
    updateLettersBadge(game) {
        if (typeof document === 'undefined' || typeof document.getElementById !== 'function' || !game || !game.player) return;
        const el = document.getElementById('lettersBadge');
        if (!el) return;
        const n = CourtLetters.state(game.player).unread || 0;
        el.textContent = n ? String(n) : '';
        if (el.style) el.style.display = n ? 'inline-block' : 'none';
    },

    lettersAct(game, op, a = null, b = null) {
        const player = game.player;
        const world = game.world;
        const done = (res, okText) => {
            if (game.ui.updateStats) game.ui.updateStats(player, world);
            if (!res || !res.success) {
                const why = (res && res.reason) || 'Not possible.';
                game.ui.showNotification('✉️ Letters', why, 'error');
                ActionMenu.showLetters(game, { html: esc(why), color: 'rgba(224,128,128,0.5)' });
                return;
            }
            ActionMenu.showLetters(game, { html: [okText || res.text, ...(res.lines || [])].filter(Boolean).map(esc).join('<br>') });
        };
        switch (op) {
            case 'tab':
                _tab = a || 'inbox';
                _reading = null;
                ActionMenu.showLetters(game);
                return;
            case 'read':
                _reading = a;
                _tab = 'answered';
                ActionMenu.showLetters(game);
                return;
            case 'answer': {
                const res = CourtLetters.answer(player, world, a, b);
                if (res.success) res.text = `✉️ ${res.text || ''}`;
                done(res);
                return;
            }
            case 'pick': _draft = { to: a, kind: null, courier: null, gold: 0, item: null }; _tab = 'write'; break;
            case 'clear': _draft = { to: null, kind: null, courier: null, gold: 0, item: null }; break;
            case 'kind': _draft.kind = a; break;
            case 'gold': _draft.gold = Number(a) || 0; break;
            case 'item': _draft.item = a || null; break;
            case 'courier': _draft.courier = a; break;
            case 'send': {
                const res = Mail.send(player, world, { to: _draft.to, kind: _draft.kind, courier: _draft.courier, gold: _draft.gold, item: _draft.item });
                if (res.success) {
                    _draft = { to: null, kind: null, courier: null, gold: 0, item: null };
                    _tab = 'transit';
                    // The letter rides as a rider on the map (systems/courierRiders.js)
                    CourierRiders.dispatchLetter(world, player, res.letter);
                }
                done(res);
                return;
            }
            case 'found': done(Couriers.found(player, world)); return;
            case 'station': done(Couriers.openStation(player, world, a)); return;
            case 'closeStation': done(Couriers.closeStation(player, world, a)); return;
            case 'staff': done(Couriers.staff(player, world, a, b)); return;
            case 'price': done(Couriers.setPrice(player, world, a)); return;
            case 'speed': done(Couriers.setSpeed(player, world, a)); return;
            case 'bid': done(Couriers.bidCharter(player, world, a)); return;
            case 'grant': { const r = Kingship.grantRoyalPost(player, world, a); done({ ...r, text: r.message }); return; }
            case 'revoke': { const r = Kingship.revokeRoyalPost(player, world); done({ ...r, text: r.message }); return; }
            default: return;
        }
        ActionMenu.showLetters(game);
    },
});

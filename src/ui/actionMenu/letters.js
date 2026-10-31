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
import { Couriers } from '../../systems/couriers.js';
import { CourierRiders } from '../../systems/courierRiders.js';
import { Kingship } from '../../systems/kingship.js';
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, BTN_RED, CARD, esc, panelTabs } from './uiKit.js';

// A recipient's note, skipped when the name already says it ("King X of Valdoria" · "Valdoria")
const _subOf = (r) => (r.sub && !String(r.name || '').includes(r.sub) ? r.sub : '');

const TABS = [['inbox', '✉️ Inbox'], ['write', '✍️ Write'], ['transit', '📮 In Transit'], ['post', '🐎 Post'], ['answered', '📜 Answered'], ['accounts', '🏦 Debts & Promises'], ['memory', '🧠 What Lords Remember']];
const FROM = { lord: 'Lord', liege: 'Your liege', rival: 'Rival House', spouse: 'Your spouse', child: 'Your child', mail: 'In answer to your letter', courier: 'Your courier house' };
const OUTCOME = { ignored: ['🕯️', '#e08080', 'Left unanswered'], reply: ['📨', '#9fc8ff', 'A reply'] };
const STATUS = { delivered: ['✔', '#9fd89f', 'Delivered'], lost: ['📭', '#e08080', 'Lost'], robbed: ['🗡️', '#e08080', 'Robbed'], undelivered: ['↩️', '#bbb', 'Returned'] };
const TONE = { warm: ['#9fd89f', 'warmly received'], cool: ['#d8c89f', 'coolly received'], hostile: ['#e08080', 'badly received'] };
const HEAD = 'font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--gold); margin:10px 0 2px;';

let _tab = 'inbox';
let _draft = { to: null, kind: null, courier: null, gold: 0, item: null };

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_OFF}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="lettersAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

const pct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;
const dangerWord = (d) => (d >= 0.4 ? ['#e08080', 'dangerous roads'] : d >= 0.15 ? ['#d8c89f', 'some danger'] : ['#9fd89f', 'safe roads']);

function inboxTab(v) {
    if (!v.open.length) return `<div style="${CARD} color:#999;">No letters await an answer. When the great write to you, a herald will say so. (Write your own from the ✍️ Write tab.)</div>`;
    let html = '';
    for (const l of v.open) {
        const urgent = l.daysLeft <= 2;
        html += `<div style="${CARD}${l.read ? '' : ' border-color: rgba(245,197,66,0.45);'}">`;
        html += `<div style="display:flex; justify-content:space-between; gap:8px;"><strong style="color:var(--gold);">${l.icon} ${esc(l.subject)}</strong>`;
        html += `<span style="font-size:11px; color:${urgent ? '#e08080' : '#999'}; white-space:nowrap;">${l.daysLeft === 0 ? 'answer today' : `${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'} left`}</span></div>`;
        html += `<div style="font-size:11px; color:#aaa;">${esc(FROM[l.fromType] || 'From')}: ${esc(l.from)}</div>`;
        html += `<div style="color:#ddd; font-style:italic; margin:6px 0;">${esc(l.body)}</div><div>`;
        l.choices.forEach((c, i) => {
            html += act(esc(c.label), ['answer', l.id, c.id], i === 0 ? BTN_GOLD : BTN_PLAIN, c.ok, c.ok ? c.tooltip : c.why);
        });
        html += '</div></div>';
    }
    return html;
}

function answeredTab(v) {
    if (!v.archive.length) return `<div style="${CARD} color:#999;">No letters answered yet.</div>`;
    let html = '';
    for (const a of v.archive) {
        const [icon, color, label] = OUTCOME[a.outcome] || ['✔', '#9fd89f', 'Answered'];
        html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between; gap:8px;"><span>${esc(a.subject)} <span style="color:#999; font-size:11px;">— ${esc(a.from && a.from.name)}</span></span>`;
        html += `<span style="color:${color}; font-size:11px; white-space:nowrap;">${icon} ${label} · day ${a.day}</span></div>`;
        if (a.text) html += `<div style="font-size:11px; color:#bbb; margin-top:3px;">${esc(a.text)}</div>`;
        html += '</div>';
    }
    return html;
}

function accountsTab(v) {
    let html = `<div style="${HEAD} margin-top:6px;">Gold lent to crowns</div>`;
    if (!v.loans.length) html += `<div style="${CARD} color:#999;">You hold no crown's debt.</div>`;
    for (const l of v.loans) {
        html += `<div style="${CARD}">🏦 <b>${esc(l.kingdomName)}</b> owes ${l.principal + l.interest} gold (${l.principal} lent + ${l.interest} interest), due on day ${l.due}.</div>`;
    }
    html += `<div style="${HEAD}">Promises given</div>`;
    if (!v.promises.length) html += `<div style="${CARD} color:#999;">You have promised no one anything.</div>`;
    for (const p of v.promises) {
        html += `<div style="${CARD}">⚔️ You swore to ${esc(p.lordName)} to ride against <b>${esc(p.enemyName)}</b>: win a campaign battle (Realm Politics → Campaign) within <b>${p.daysLeft}</b> day${p.daysLeft === 1 ? '' : 's'}.</div>`;
    }
    const s = v.stats;
    html += `<div style="font-size:11px; color:#999; margin-top:8px;">Letters received ${s.received} · answered ${s.answered} · left unanswered ${s.ignored} · promises kept ${s.kept}, broken ${s.broken} · loans made ${s.lent}, repaid ${s.repaid}, defaulted ${s.defaulted}</div>`;
    return html;
}

function memoryTab(game) {
    const world = game.world;
    let html = '<div style="font-size:11px; color:#999;">What each ruler holds against you, or in your favour. Memories fade with time; an heir inherits part of what a dead lord remembered.</div>';
    let any = false;
    for (const k of (world.kingdoms || []).filter(x => x && x.isAlive !== false && x.lord)) {
        const mem = NPCLords.memoryOf(k.lord, world.day);
        if (!mem.length) continue;
        any = true;
        const total = NPCLords.memoryOpinion(k.lord, world.day);
        html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between;"><b style="color:${k.color || 'var(--gold)'};">${esc(k.lord.name)} of ${esc(k.name)}</b>`;
        html += `<span style="color:${total >= 0 ? '#9fd89f' : '#e08080'}; font-size:11px;">${total >= 0 ? '+' : ''}${total} opinion</span></div>`;
        for (const m of mem.slice(0, 5)) {
            const line = m.inherited ? `Heard from ${esc(m.from || 'the old ruler')}: ${esc(m.label)}` : `${esc(m.label)}${m.note ? ` (${esc(m.note)})` : ''}`;
            html += `<div style="font-size:11px; color:${m.weight >= 0 ? '#9fd89f' : '#e89090'};">${m.icon} ${line} · day ${m.day}</div>`;
        }
        html += '</div>';
    }
    if (!any) html += `<div style="${CARD} color:#999;">No ruler remembers anything of you yet — for good or ill.</div>`;
    return html;
}

// ──────────── WRITE ────────────

function recipientList(game) {
    const { player, world } = game;
    const recs = Mail.recipients(player, world);
    const types = Mail.recipientTypes();
    if (!recs.length) return `<div style="${CARD} color:#999;">You know no one to write to yet.</div>`;
    let html = '<div style="font-size:11px; color:#999;">Choose who to write to. Their regard for you decides how a letter is taken.</div>';
    const order = Object.keys(types).length ? Object.keys(types) : [...new Set(recs.map(r => r.type))];
    for (const type of order) {
        const group = recs.filter(r => r.type === type);
        if (!group.length) continue;
        const T = types[type] || {};
        html += `<div style="${HEAD}">${T.icon || '✉️'} ${esc(T.name || type)}</div>`;
        for (const r of group.slice(0, 20)) {
            const reg = Mail.regard(player, world, r);
            html += `<div style="${CARD} display:flex; justify-content:space-between; align-items:center; gap:8px; padding:5px 8px; margin:4px 0;">`;
            html += `<span><b>${esc(r.name)}</b> <span style="color:#999; font-size:11px;">${esc(_subOf(r))} · ${esc(r.place || '')}${r.held && r.held.length ? ` · holds ${esc(r.held.map(h => h.name).join(', '))}` : ''}</span></span>`;
            html += `<span style="white-space:nowrap;"><span style="font-size:11px; color:${reg >= 15 ? '#9fd89f' : reg <= -25 ? '#e08080' : '#d8c89f'};">regard ${reg >= 0 ? '+' : ''}${Math.round(reg)}</span> ${act('Write', ['pick', r.key], BTN_PLAIN)}</span></div>`;
        }
        if (group.length > 20) html += `<div style="font-size:11px; color:#999;">…and ${group.length - 20} more.</div>`;
    }
    return html;
}

function writeTab(game) {
    const { player, world } = game;
    const mv = Mail.view(player, world);
    let html = `<div style="font-size:11px; color:#999;">On the road: ${mv.limits.inTransit}/${mv.limits.maxInTransit} · written today: ${mv.limits.today}/${mv.limits.perDay}</div>`;
    const to = _draft.to ? Mail.recipient(player, world, _draft.to) : null;
    if (!to) {
        _draft = { to: null, kind: null, courier: null, gold: 0, item: null };
        return html + recipientList(game);
    }
    html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between;"><b style="color:var(--gold);">To ${esc(to.name)}</b>${act('Someone else', ['clear'], BTN_PLAIN)}</div>`;
    html += `<div style="font-size:11px; color:#aaa;">${esc(_subOf(to))} · at ${esc(to.place || '?')} · regard ${Math.round(Mail.regard(player, world, to))}</div></div>`;

    // The kind of letter
    html += `<div style="${HEAD}">What to write</div><div>`;
    const kinds = Mail.kindOptions(player, world, to);
    for (const k of kinds) {
        const style = _draft.kind === k.id ? BTN_GOLD : BTN_PLAIN;
        html += act(`${k.icon} ${esc(k.name)}`, ['kind', k.id], style, k.ok, k.ok ? k.desc : k.why);
    }
    html += '</div>';
    const K = _draft.kind ? kinds.find(k => k.id === _draft.kind) : null;
    if (K) html += `<div style="font-size:11px; color:#bbb; margin:4px 0;">${esc(K.desc)}</div>`;
    if (K && K.enclose) {
        html += `<div style="${HEAD}">Enclose</div><div>`;
        for (const g of Mail.config().giftPresets || []) html += act(`💰 ${g}g`, ['gold', _draft.gold === g ? 0 : g], _draft.gold === g ? BTN_GOLD : BTN_PLAIN, (player.gold || 0) >= g);
        for (const it of Mail.itemOptions(player)) {
            const on = _draft.item === it.id;
            html += act(`📦 ${esc(String(it.id).replace(/_/g, ' '))} (~${it.value}g)`, ['item', on ? null : it.id], on ? BTN_GOLD : BTN_PLAIN);
        }
        html += '</div>';
    }

    // The courier
    if (K) {
        html += `<div style="${HEAD}">Who carries it</div>`;
        const opts = Mail.courierOptions(player, world, to);
        if (!Couriers.townHere(world, player)) html += '<div style="font-size:11px; color:#999;">Out here only your own rider can take it. In a town, the post houses there will carry it.</div>';
        for (const c of opts) {
            const [dc, dw] = dangerWord(c.danger);
            const sel = String(_draft.courier) === String(c.id);
            html += `<div style="${CARD} padding:5px 8px; margin:4px 0;${sel ? ' border-color: rgba(245,197,66,0.6);' : ''} display:flex; justify-content:space-between; align-items:center; gap:8px;">`;
            html += `<span>${c.icon || '✉️'} <b>${esc(c.name)}</b>${c.own ? ' <span style="color:#9fd89f; font-size:11px;">(your house — free)</span>' : ''}<br><span style="font-size:11px; color:#aaa;">${c.price} gold · about ${c.days} day${c.days === 1 ? '' : 's'} · ${pct(c.reliability)} reliable${c.offNetwork ? ' · no station there (slower)' : ''}${c.guardCover ? ` · guarded ${pct(c.guardCover)}` : ''} · <span style="color:${dc};">${dw}</span></span></span>`;
            html += act(sel ? 'Chosen' : 'Choose', ['courier', String(c.id)], sel ? BTN_GOLD : BTN_PLAIN);
            html += '</div>';
        }
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
    let html = `<div style="${HEAD} margin-top:6px;">On the road</div>`;
    if (!v.transit.length) html += `<div style="${CARD} color:#999;">No letters of yours are on the road.</div>`;
    for (const t of v.transit) {
        const rider = CourierRiders.riderFor(game.world, t.id);
        const where = rider ? ` · 🏇 on the map, ${Math.round(CourierRiders.progress(rider) * 100)}% of the way (${rider.q}, ${rider.r})` : '';
        html += `<div style="${CARD}">${t.icon} <b>${esc(t.name)}</b> to ${esc(t.to)} at ${esc(t.place || '?')} — with ${esc(t.courier)} · ${t.daysLeft ? `due in ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'}` : 'due today'}${t.delayed ? ' <span style="color:#d8c89f;">(held up on the road)</span>' : ''}${t.gold ? ` · 💰 ${t.gold}g enclosed` : ''}${t.item ? ` · 📦 ${esc(String(t.item.id).replace(/_/g, ' '))}` : ''}<span style="font-size:11px; color:#999;">${where}</span></div>`;
    }
    html += `<div style="${HEAD}">Replies on the way</div>`;
    if (!v.replies.length) html += `<div style="${CARD} color:#999;">No replies are riding back to you.</div>`;
    for (const r of v.replies) html += `<div style="${CARD}">📨 ${esc(r.from)}'s answer — about ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} away.</div>`;
    html += `<div style="${HEAD}">Letters sent</div>`;
    if (!v.sent.length) html += `<div style="${CARD} color:#999;">You have sent no letters yet.</div>`;
    for (const s of v.sent) {
        const [icon, color, label] = STATUS[s.status] || ['•', '#bbb', s.status];
        const tone = s.tone && TONE[s.tone];
        html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between; gap:8px;"><span>${esc((Mail.kind(s.kind) || {}).name || s.kind)} to <b>${esc(s.to)}</b> <span style="color:#999; font-size:11px;">via ${esc(s.courier)}</span></span>`;
        html += `<span style="font-size:11px; color:${color}; white-space:nowrap;">${icon} ${label}${tone ? ` · <span style="color:${tone[0]};">${tone[1]}</span>` : ''} · day ${s.day != null ? s.day : s.sentDay}</span></div>`;
        if (s.text) html += `<div style="font-size:11px; color:#bbb; margin-top:3px;">${esc(s.text)}</div>`;
        if (s.intercepted) html += `<div style="font-size:11px; color:#e0a080;">🔓 Read on the way by ${esc(s.intercepted)}.</div>`;
        html += '</div>';
    }
    const st = v.stats;
    html += `<div style="font-size:11px; color:#999; margin-top:8px;">Sent ${st.sent} · delivered ${st.delivered} · lost ${st.lost} · robbed ${st.robbed} · opened on the way ${st.intercepted} · replies ${st.replies}</div>`;
    return html;
}

// ──────────── POST ────────────

function houseRow(c, extra = '') {
    return `<div style="${CARD} padding:5px 8px; margin:4px 0;"><div style="display:flex; justify-content:space-between; gap:8px;"><span>${c.icon} <b>${esc(c.name)}</b> <span style="color:#999; font-size:11px;">${c.owner === 'player' ? 'yours' : esc(c.ownerName || '')} · of ${esc(c.homeName || '?')}</span></span>`
        + `<span style="font-size:11px; color:#bbb; white-space:nowrap;">${c.price}g · ${esc(c.speedName)} · rep ${c.reputation} · ${pct(c.reliability)}</span></div>`
        + `<div style="font-size:11px; color:#999;">${c.stations.length} station${c.stations.length === 1 ? '' : 's'}: ${esc(c.stations.join(', '))}${c.charters.length ? ` · 📜 Royal Post of ${esc(c.charters.join(', '))}` : ''}</div>${extra}</div>`;
}

function myHouse(game, v) {
    const { player, world } = game;
    const C = Couriers.config();
    const m = v.mine;
    let html = `<div style="${HEAD}">Your courier house</div>`;
    if (!m) {
        const q = Couriers.foundQuote(player, world);
        html += `<div style="${CARD}">Found a courier house${q.town ? ` here at <b>${esc(q.town.name)}</b>` : ''}: ${q.cost} gold for the yard, stables and two riders, and a ${q.licence} gold licence to the crown. Open stations in other towns, hire riders and relay horses, set your postage — and win the towns' mail from the houses already there. Your own letters ride free.<div>${act(`📮 Found a courier house (${q.cost + q.licence}g)`, ['found'], BTN_GOLD, q.ok, q.why)}</div></div>`;
        return html;
    }
    const last = m.last;
    html += houseRow(m);
    html += `<div style="${CARD}">`;
    html += `<div>🏇 Riders <b>${m.riders}</b> ${act('+1', ['staff', 'riders', 1], BTN_PLAIN, true, `${C.costs.riderHire}g to hire, ${C.costs.riderWage}g a week`)}${act('−1', ['staff', 'riders', -1], BTN_PLAIN, m.riders > 0)}`;
    html += ` · 🐎 Relay horses <b>${m.horses}</b> ${act('+1', ['staff', 'horses', 1], BTN_PLAIN, true, `${C.costs.horsePrice}g, ${C.costs.horseUpkeep}g a week`)}${act('−1', ['staff', 'horses', -1], BTN_PLAIN, m.horses > 0, 'Sold at half price')}`;
    html += ` · 🛡️ Guards <b>${m.guards}</b> ${act('+1', ['staff', 'guards', 1], BTN_PLAIN, true, `${C.costs.guardHire}g to hire, ${C.costs.guardWage}g a week — fewer riders robbed`)}${act('−1', ['staff', 'guards', -1], BTN_PLAIN, m.guards > 0)}</div>`;
    html += `<div style="margin-top:4px;">✉️ Postage <b>${m.price}g</b> a letter ${act('−0.5', ['price', Math.max(C.price.min, m.price - 0.5)], BTN_PLAIN, m.price > C.price.min)}${act('+0.5', ['price', Math.min(C.price.max, m.price + 0.5)], BTN_PLAIN, m.price < C.price.max)} · pace: `;
    for (const [id, S] of Object.entries(C.speeds)) html += act(`${S.icon} ${esc(S.name)}`, ['speed', id], m.speed === id ? BTN_GOLD : BTN_PLAIN, true, `${S.hexesPerDay} hexes a day · price ×${S.price} · wages ×${S.wage}${S.horsesPerStation ? ` · needs ${S.horsesPerStation} relay horses a station` : ''}`);
    html += '</div>';
    html += `<div style="font-size:11px; color:#999; margin-top:4px;">Reputation ${m.reputation} · reliability ${pct(m.reliability)}${last ? ` · last week: ${Math.round(last.letters)} letters, takings ${last.revenue}g, costs ${last.costs}g, <b style="color:${last.profit >= 0 ? '#9fd89f' : '#e08080'};">${last.profit >= 0 ? '+' : ''}${last.profit}g</b>${last.robbed ? `, ${last.robbed} robbed` : ''}` : ' · the first week is not yet reckoned'}</div>`;
    if (m.history.length > 1) {
        html += '<div style="font-size:11px; color:#bbb; margin-top:4px;">Weeks: ' + m.history.map(h => `<span style="color:${h.profit >= 0 ? '#9fd89f' : '#e08080'};">${h.profit >= 0 ? '+' : ''}${h.profit}</span>`).join(' · ') + '</div>';
    }
    const riders = CourierRiders.ownRiders(world).filter(u => u.letterId == null);
    if (riders.length) html += `<div style="font-size:11px; color:#bbb; margin-top:4px;">🏇 On the road: ${riders.map(u => `${esc(u.fromName)} → ${esc(u.toName)} (${Math.round(CourierRiders.progress(u) * 100)}%, at ${u.q}, ${u.r})`).join(' · ')}</div>`;
    html += '</div>';

    // Stations and the towns within reach
    html += `<div style="${HEAD}">Stations</div><div style="${CARD}">`;
    const houseRec = Couriers.playerHouse(world);
    for (const s of (houseRec ? houseRec.stations : [])) {
        const rivals = Couriers.alive(world).filter(o => o.owner !== 'player' && Couriers.hasStation(o, s.key));
        html += `<div style="font-size:12px;">📮 ${esc(s.name)}${rivals.length ? ` <span style="color:#999; font-size:11px;">vs ${esc(rivals.map(o => `${o.name} (${o.price}g)`).join(', '))}</span>` : ' <span style="color:#9fd89f; font-size:11px;">the only post</span>'}${s.key === houseRec.home ? ' <span style="color:#999; font-size:11px;">(home)</span>' : ` ${act('Close', ['closeStation', s.key], BTN_RED)}`}</div>`;
    }
    html += '</div>';
    const opts = Couriers.stationOptions(world, player);
    if (opts.length) {
        html += `<div style="${HEAD}">Open a station</div>`;
        for (const o of opts) {
            html += `<div style="${CARD} padding:4px 8px; margin:3px 0; display:flex; justify-content:space-between; align-items:center; gap:8px;"><span>${esc(o.town.name)} <span style="color:#999; font-size:11px;">${o.dist} hexes · ~${Math.round(o.demand)} letters a week${o.servers.length ? ` · served by ${esc(o.servers.join(', '))}` : ' · no post'}</span></span>${act(`Open (${o.cost}g)`, ['station', o.town.key], BTN_PLAIN, o.ok, o.why)}</div>`;
        }
    }

    // The Royal Post
    const realms = [...new Set((houseRec ? houseRec.stations : []).map(s => s.kingdomId).filter(Boolean))];
    if (realms.length) {
        html += `<div style="${HEAD}">The Royal Post</div>`;
        for (const kid of realms) {
            const k = world.getKingdom(kid);
            if (!k) continue;
            const q = Couriers.bidQuote(player, world, kid);
            const ch = Couriers.charter(world, kid);
            const holder = ch ? Couriers.get(world, ch.courierId) : null;
            html += `<div style="${CARD} padding:4px 8px; margin:3px 0; display:flex; justify-content:space-between; align-items:center; gap:8px;"><span>📜 ${esc(k.name)} <span style="color:#999; font-size:11px;">${holder ? `held by ${esc(holder.name)}` : 'no charter'}${q.ok ? ` · ${pct(q.chance)} chance` : ''}</span></span>${holder && holder.owner === 'player' ? '<span style="color:#9fd89f; font-size:11px;">yours</span>' : act(`Petition (${q.cost}g)`, ['bid', kid], BTN_PLAIN, q.ok, q.why)}</div>`;
        }
    }
    return html;
}

function postTab(game) {
    const { player, world } = game;
    const v = Couriers.view(world, player);
    let html = '';
    if (v.here) {
        html += `<div style="${HEAD} margin-top:6px;">The post at ${esc(v.here.name)}</div>`;
        if (v.here.charter) html += `<div style="font-size:11px; color:#d8c89f;">📜 The Royal Post: only ${esc((Couriers.get(world, v.here.charter.courierId) || {}).name || '?')} may carry this realm's mail.</div>`;
        if (!v.here.couriers.length) html += `<div style="${CARD} color:#999;">No courier house keeps a station here. Your own rider can still take a letter — or found a house yourself.</div>`;
        for (const c of v.here.couriers) html += houseRow(c);
        html += `<div>${act('✍️ Write a letter from here', ['tab', 'write'], BTN_PLAIN)}</div>`;
    } else {
        html += `<div style="${CARD} color:#999;">You are not in a town. The post houses keep their stations in towns.</div>`;
    }
    html += myHouse(game, v);
    if (v.ruled) {
        const def = Kingship.edicts().royal_post || {};
        const cost = def.passCost != null ? def.passCost : 150;
        html += `<div style="${HEAD}">Your realm's Royal Post</div><div style="${CARD}">${v.ruled.holder ? `Held by <b>${esc(v.ruled.holder)}</b> by your edict. ${act('Revoke the edict', ['revoke'], BTN_RED)}` : `No house holds it. Proclaim the Royal Post edict (${cost}g from the royal treasury, an edict slot) for a house with a station in your realm: its weekly fee comes to the crown's books.`}<div>`;
        for (const c of Kingship.royalPostCandidates(player, world).filter(x => !x.holder)) {
            html += act(`${v.ruled.holder ? 'Transfer' : 'Grant'} to ${esc(c.name)} (${c.stations} st., ${c.fee}g/wk)`, ['grant', c.id], BTN_PLAIN);
        }
        html += '</div></div>';
    }
    html += `<div style="${HEAD}">Every courier house</div>`;
    if (!v.all.length) html += `<div style="${CARD} color:#999;">No courier houses yet.</div>`;
    for (const c of v.all.filter(x => x.owner !== 'player')) html += houseRow(c, c.last ? `<div style="font-size:11px; color:#888;">about ${Math.round(c.last.letters)} letters a week</div>` : '');
    if (v.charters.length) html += `<div style="font-size:11px; color:#bbb; margin-top:6px;">📜 Royal Posts: ${esc(v.charters.map(ch => `${ch.realm} — ${ch.holder}`).join(' · '))}</div>`;
    if (v.news.length) {
        html += `<div style="${HEAD}">News of the post</div>`;
        for (const n of v.news) html += `<div style="font-size:11px; color:#bbb;">${n.icon} day ${n.day}: ${esc(n.text)}</div>`;
    }
    return html;
}

Object.assign(ActionMenu, {
    /** Journal → Letters: the inbox, writing, letters in transit, the post, answered letters, debts & promises, what lords remember. */
    showLetters(game, message = null) {
        const player = game.player;
        const world = game.world;
        const v = CourtLetters.view(player, world);
        let html = '<div style="max-height: 560px; overflow-y: auto; font-size: 12px;">';
        if (message) html += `<div style="${CARD} border-color: ${message.color || 'rgba(245,197,66,0.4)'}; color:#eee;">${message.html}</div>`;
        html += panelTabs(game, {
            id: 'letters', title: '✉️ Letters', tabs: TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showLetters(game); },
            attrsFor: (k) => `data-am-act="lettersAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        try {
            if (_tab === 'answered') html += answeredTab(v);
            else if (_tab === 'accounts') html += accountsTab(v);
            else if (_tab === 'memory') html += memoryTab(game);
            else if (_tab === 'write') html += writeTab(game);
            else if (_tab === 'transit') html += transitTab(game);
            else if (_tab === 'post') html += postTab(game);
            else html += inboxTab(v);
        } catch (e) {
            html += `<div style="${CARD} color:#e08080;">This page could not be drawn (${esc(e && e.message)}).</div>`;
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

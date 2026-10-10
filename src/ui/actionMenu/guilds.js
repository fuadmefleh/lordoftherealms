// ActionMenu — the Guildhall: a town's craft and merchant guilds (opened from
// the town's actions, the trade window or the Counsel). Each guild's hall,
// master, treasury, standing with the crown, its market powers (toll, sale
// cap, price floor, quality mark, guild rates), a strike or feud; the
// player's rank and what the next one asks; contracts, loans, elections; a
// ruler's charter or abolition. Logic lives in systems/guilds.js; buttons
// route through data-am-act → ActionMenu.guildAct.
import { ActionMenu } from './_ref.js';
import { Guilds } from '../../systems/guilds.js';
import { Underworld } from '../../systems/underworld.js';
import { SettlementMarket } from '../../world/settlementMarket.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, BTN_RED, CARD } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pct = (v) => `${Math.round(v * 100)}%`;
const g = (n) => `${Math.round(n).toLocaleString()}g`;
const gname = (id) => esc(Guilds.goodName(id));

/** A button routed to ActionMenu.guildAct(game, ...args). */
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="guildAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function powersLine(player, s, gd, def) {
    const parts = [];
    for (const id of def.goods) {
        const toll = Guilds.tollRate(player, s, id);
        const f = Guilds.saleFactor(player, s, id);
        const room = Guilds.outsiderRoom(player, s, id);
        const mono = s.monopolies && s.monopolies[id];
        let t = `${gname(id)}: `;
        if (mono && !(mono.holder === 'guild' && mono.guildId === gd.id)) t += `<span style="color:#e67e22;">${esc(mono.holderName || 'another')}'s monopoly sets the guild's rights aside</span>`;
        else {
            t += f > 1 ? `<span style="color:#2ecc71;">your mark +${pct(f - 1)}</span>` : toll > 0 ? `<span style="color:#e67e22;">toll ${pct(toll)}</span>` : 'no toll';
            if (room !== Infinity) t += ` · ${room} more from outsiders this week`;
            const floor = Guilds.askFloor(s, id);
            if (floor > 0) t += ` · never under ${pct(floor)} of its ask`;
            if (mono && mono.holder === 'guild') t += ' · <b>guild monopoly</b>';
        }
        parts.push(t);
    }
    if (def.inputs.length) parts.push(`guild rates on ${def.inputs.map(gname).join(', ')}${Guilds.inputDiscount(player, s, def.inputs[0]) > 0 ? ` (−${pct(Guilds.inputDiscount(player, s, def.inputs[0]))} for you)` : ' for journeymen'}`);
    return parts.join('<br>');
}

function guildCard(game, tile, gd) {
    const { player, world } = game;
    const s = tile.settlement;
    const def = Guilds.def(gd.id);
    const m = Guilds.membership(player, s, gd.id);
    const rank = m ? m.rank : -1;
    let html = `<div style="${CARD}">`;
    html += `<div><b>${esc(def.icon)} ${esc(gd.name)}</b>${gd.chartered ? ' · 📜 royal charter' : ''} · master ${esc(gd.master.name)}${gd.master.player ? ' (you)' : ''}</div>`;
    html += `<div style="${NOTE}">${gd.members} members · hall ${g(gd.treasury)} · prosperity ${pct(gd.prosperity)} · crown standing ${Math.round(gd.crown)}${gd.feud > 0 ? ` · <span style="color:#e74c3c;">feud with you ${Math.round(gd.feud)}</span>` : ''}</div>`;
    if (gd.strike) html += `<div style="color:#e67e22; font-size:12px;">✊ On strike over ${esc(gd.strike.reason)} until day ${gd.strike.until}: its trades stand idle.</div>`;
    else if (gd.squeeze >= 0.6) html += `<div style="${NOTE}">Grumbling (squeeze ${gd.squeeze.toFixed(2)}): ${esc((Guilds.squeeze(world, player, s, gd).top) || 'hard times')}.</div>`;
    html += `<div style="font-size:11px; margin:4px 0;">${powersLine(player, s, gd, def)}</div>`;
    if (!m) {
        html += act(`Join as apprentice (${g(Guilds._fee(s, 0))})`, ['join', gd.id]);
        html += `<span style="${NOTE}"> half the toll, standing from trading its goods here, contracts</span>`;
    } else {
        html += `<div style="font-size:12px;">You: <b>${esc(Guilds.rankName(rank))}</b> · standing ${Math.floor(m.standing)} · ${m.contracts} contracts · traded ${g(m.traded)}${m.unpaid ? ` · <span style="color:#e74c3c;">${m.unpaid} week(s) of dues unpaid</span>` : ''}</div>`;
        const q = Guilds.advanceQuote(player, world, tile, gd.id);
        if (q.needs.length) {
            html += `<div style="${NOTE}">To ${esc(Guilds.rankName(q.rank).toLowerCase())}: ${q.needs.map(n => `<span style="color:${n.met ? '#2ecc71' : '#e67e22'};">${esc(n.label)}</span>`).join(' · ')}</div>`;
            html += act(`Rise to ${Guilds.rankName(q.rank)}${q.goods && Object.keys(q.goods).length ? ' (masterpiece)' : ''}`, ['advance', gd.id], BTN_GOLD, q.ok, q.reason);
        } else if (q.reason) html += `<div style="${NOTE}">${esc(q.reason)}</div>`;
        const rd = Guilds.rankDef(rank);
        if (rd.votes) {
            const c = Guilds.candidates(s, gd);
            html += `<div style="${NOTE}">Election on day ${gd.nextElection}: ${esc(c.incumbent)} against ${esc(c.challenger)}${m.vote ? ` — you back the ${m.vote}` : ''}.</div>`;
            if (!gd.master.player) html += act('Back the master', ['vote', gd.id, 'incumbent'], BTN_PLAIN) + act('Back the challenger', ['vote', gd.id, 'challenger'], BTN_PLAIN);
            html += act(m.candidate || gd.master.player ? 'Withdraw your name' : 'Stand for guildmaster', ['stand', gd.id, !(m.candidate || gd.master.player)], BTN_PLAIN);
        }
        if (gd.strike && rank >= 3) html += act('Call off the strike', ['endStrike', gd.id], BTN_RED);
        // Contracts
        const offers = Guilds.contractOffers(player, world, s, gd.id);
        for (const o of offers) html += `<div style="font-size:11px;">📜 ${o.qty} ${gname(o.good)} within ${o.days} days at ${o.unit}g (${g(o.total)}) ${act('Take', ['contract', gd.id, o.good], BTN_PLAIN)}</div>`;
        // Loans
        const lq = Guilds.loanQuote(player, world, s, gd.id);
        if (lq.ok) html += `<div style="font-size:11px;">💰 The hall lends up to ${g(lq.max)} at ${pct(lq.rate)} over ${lq.weeks} weeks ${act(`Borrow ${g(lq.max)}`, ['borrow', gd.id, lq.max], BTN_PLAIN)}</div>`;
        else if (rd.loans && lq.reason) html += `<div style="${NOTE}">${esc(lq.reason)}</div>`;
        html += act('Leave the guild', ['leave', gd.id], BTN_RED);
    }
    if (Guilds.canRule(player, world, s)) {
        html += `<div style="${NOTE} margin-top:4px;">As ruler: ${act(gd.chartered ? 'Chartered' : 'Grant a charter', ['charter', gd.id], BTN_PLAIN, !gd.chartered)}${act('Abolish by edict', ['abolish', gd.id], BTN_RED)}</div>`;
    }
    html += '</div>';
    return html;
}

function myGuilds(game) {
    const { player, world } = game;
    const st = player.guilds;
    if (!st) return '';
    let html = '';
    const list = Guilds.memberships(player, world);
    if (list.length) {
        html += '<h5 style="margin:10px 0 4px;">Your guilds</h5>';
        for (const x of list) html += `<div style="font-size:12px;">${esc((x.def && x.def.icon) || '')} ${esc(Guilds.rankName(x.m.rank))} of the ${esc(x.guild ? x.guild.name : x.m.guild)} (${esc(x.m.town)}) · standing ${Math.floor(x.m.standing)}</div>`;
    }
    for (const c of st.contracts) {
        html += `<div style="font-size:12px;">📜 ${c.qty - c.delivered} ${gname(c.good)} to ${esc(c.town)} by day ${c.due} at ${c.unit}g ${act('Deliver', ['deliver', c.id], BTN_PLAIN, player.q === c.q && player.r === c.r)}</div>`;
    }
    for (const l of st.loans) html += `<div style="font-size:12px;">💰 Owe the guild at ${esc(l.town)} ${g(l.owed)} (${g(l.weekly)} a week) ${act('Repay', ['repay', l.id], BTN_PLAIN, player.gold >= l.owed)}</div>`;
    const s = st.stats;
    html += `<div style="${NOTE} margin-top:6px;">Fees ${g(s.fees)} · dues ${g(s.dues)} · tolls paid ${g(s.tolls)} · guild mark earned ${g(s.premium)} · contracts ${s.contractsDone} (${g(s.contractIncome)}) · stipends ${g(s.stipends)}</div>`;
    if (st.log.length) for (const l of st.log.slice(-5).reverse()) html += `<div style="${NOTE}">Day ${l.day}: ${esc(l.text)}</div>`;
    return html;
}

Object.assign(ActionMenu, {
    /** The Guildhall panel for the town the player stands in. */
    showGuildhall(game, tile = null) {
        const player = game.player;
        const world = game.world;
        const t = tile || world.getTile(player.q, player.r);
        const s = t && t.settlement;
        let html = '<div style="font-size:12px; max-height:620px; overflow-y:auto;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">💰 ${Math.floor(player.gold).toLocaleString()} gold${s ? ` · at ${esc(s.name)}` : ''}</p>`;
        html += `<div style="${NOTE}">The town's guilds work its trades. Outsiders pay their toll on the goods they guard and may sell only so much a week; their masters' goods carry the guild's mark; journeymen buy the guild's materials at guild rates. A monopoly — the crown's above all — sets a guild's rights aside.</div>`;
        const gs = s && Guilds.townGuilds(s);
        if (!gs) html += `<div style="color:#aaa; margin-top:8px;">${s ? `${esc(s.name)} has no guilds${s.guildBans ? ' (abolished by the crown)' : ''}.` : 'Stand in a town to visit its guildhall.'}</div>`;
        else for (const gd of Object.values(gs)) html += guildCard(game, t, gd);
        if (s && Underworld.hasGuildPresence(s)) html += `<div style="${NOTE} margin-top:6px;">🗝️ The thieves' guild keeps its own counsel here (the Underworld).</div>`;
        if (s && SettlementMarket.fair(s)) html += `<div style="${NOTE}">🎪 A fair is on: outside merchants trade freely while it lasts.</div>`;
        html += myGuilds(game);
        html += '</div>';
        game.ui.showCustomPanel('⚒️ Guildhall', html);
    },

    /** Every button on the panel: op + its arguments. */
    guildAct(game, op, a = null, b = null) {
        const player = game.player;
        const world = game.world;
        const tile = world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        let res = null;
        switch (op) {
            case 'join': res = Guilds.join(player, world, tile, a); break;
            case 'leave': res = Guilds.leave(player, world, s, a); break;
            case 'advance': res = Guilds.advance(player, world, tile, a); break;
            case 'vote': res = Guilds.vote(player, world, s, a, b); break;
            case 'stand': res = Guilds.stand(player, world, s, a, b); break;
            case 'endStrike': res = Guilds.endStrike(player, world, s, a); break;
            case 'contract': res = Guilds.takeContract(player, world, tile, a, b); break;
            case 'deliver': res = Guilds.deliverContract(player, world, a); break;
            case 'borrow': res = Guilds.borrow(player, world, s, a, b); break;
            case 'repay': res = Guilds.repayLoan(player, world, a); break;
            case 'charter': res = Guilds.charter(player, world, s, a); break;
            case 'abolish': res = Guilds.abolish(player, world, s, a); break;
            default: return;
        }
        if (res) {
            const text = res.success
                ? (res.earned != null ? `Done: +${res.earned} gold.` : res.spent != null ? `Done: −${res.spent} gold.` : res.gold != null ? `Done: +${res.gold} gold.` : 'Done.')
                : (res.reason || 'Not possible.');
            game.ui.showNotification('⚒️ Guildhall', text, res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showGuildhall(game, tile);
    },
});

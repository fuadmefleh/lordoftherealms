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
import { lede, bullets, chips, purse, kv, card, actRow, rowList, price } from './uiKit.js';
import { Utils } from '../../core/utils.js';


function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pct = (v) => `${Math.round(v * 100)}%`;
const g = (n) => `${Utils.formatGold(n)}g`;
const gname = (id) => esc(Guilds.goodName(id));

/** A guild deed as a row in the panels' voice (uiKit actRow), routed to ActionMenu.guildAct. */
function deed(o, args, ok = true, why = '') {
    return actRow({ ...o, act: ok ? 'guildAct' : null, args: ok ? args : null, off: !ok, why: why ? esc(why) : '' });
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
    // The hall's chest is the members' business
    let body = `<div class="pk-row-desc" style="margin:0 0 4px;">Master ${esc(gd.master.name)}${gd.master.player ? ' (you)' : ''} · ${gd.members} members${rank >= 0 ? ` · hall ${g(gd.treasury)}` : ''} · prosperity ${pct(gd.prosperity)} · crown standing ${Math.round(gd.crown)}${gd.feud > 0 ? ` · <span style="color:#e74c3c;">feud with you ${Math.round(gd.feud)}</span>` : ''}</div>`;
    if (gd.strike) body += `<div class="pk-row-desc" style="color:#e67e22;">✊ On strike over ${esc(gd.strike.reason)} until day ${gd.strike.until}: its trades stand idle.</div>`;
    else if (gd.squeeze >= 0.6) body += `<div class="pk-row-desc">Grumbling (squeeze ${gd.squeeze.toFixed(2)}): ${esc((Guilds.squeeze(world, player, s, gd).top) || 'hard times')}.</div>`;
    body += kv('Its rights', powersLine(player, s, gd, def));
    const rows = [];
    if (!m) {
        const fee = Guilds._fee(s, 0);
        rows.push(deed({ icon: '✍️', name: 'Join as apprentice', desc: 'Half the toll, standing from trading its goods here, and its contracts', side: price(fee, player.gold >= fee), tone: 'gold' }, ['join', gd.id]));
    } else {
        body += kv('You', `<b>${esc(Guilds.rankName(rank))}</b> · standing ${Math.floor(m.standing)} · ${m.contracts} contracts · traded ${g(m.traded)}${m.unpaid ? ` · <span style="color:#e74c3c;">${m.unpaid} week(s) of dues unpaid</span>` : ''}`);
        const q = Guilds.advanceQuote(player, world, tile, gd.id);
        if (q.needs.length) {
            rows.push(deed({
                icon: '⬆️', name: `Rise to ${esc(Guilds.rankName(q.rank))}${q.goods && Object.keys(q.goods).length ? ' (masterpiece)' : ''}`,
                desc: q.needs.map(n => `<span style="color:${n.met ? '#2ecc71' : '#e67e22'};">${n.met ? '✓' : '○'} ${esc(n.label)}</span>`).join(' · '),
                side: q.ok ? 'Rise ›' : '', tone: 'gold',
            }, ['advance', gd.id], q.ok, q.ok ? '' : q.reason || q.needs.filter(n => !n.met).map(n => n.label).join(' · ')));
        } else if (q.reason) body += `<div class="pk-row-desc">${esc(q.reason)}</div>`;
        const rd = Guilds.rankDef(rank);
        if (rd.votes) {
            const c = Guilds.candidates(s, gd);
            const left = Math.max(0, (gd.nextElection || 0) - (world.day || 0));
            body += card(
                `<div class="pk-row-desc">${esc(c.incumbent)} against ${esc(c.challenger)}${m.vote ? ` — you back the ${m.vote}` : ''}.</div>`
                // How a seat is won or kept (systems/guilds.js _election): standing and contracts filled
                + (gd.master.player || m.candidate ? `<div class="pk-row-desc" style="color:#e8d9a8;">The masters weigh your standing (${Math.round(m.standing || 0)}) and the guild contracts you have filled (${m.contracts || 0}). Sell the guild's goods here and fill its contracts below before day ${gd.nextElection} to ${gd.master.player ? 'keep the chair' : 'win it'}.</div>` : ''),
                { icon: '🗳️', title: `The election, day ${gd.nextElection}`, side: `in ${left} day${left === 1 ? '' : 's'}`, tone: left <= 10 ? 'warn' : null },
            );
            if (!gd.master.player) {
                rows.push(deed({ icon: '🤝', name: 'Back the master', desc: esc(c.incumbent), side: m.vote === 'incumbent' ? 'backed' : 'Back ›' }, ['vote', gd.id, 'incumbent'], m.vote !== 'incumbent'));
                rows.push(deed({ icon: '🤝', name: 'Back the challenger', desc: esc(c.challenger), side: m.vote === 'challenger' ? 'backed' : 'Back ›' }, ['vote', gd.id, 'challenger'], m.vote !== 'challenger'));
            }
            const standing = !!(m.candidate || gd.master.player);
            rows.push(deed(standing
                ? { icon: '🚪', name: gd.master.player ? 'Give up the chair at the vote' : 'Withdraw your name', desc: gd.master.player ? 'You hold the chair: withdraw only to let it go' : 'You stand for guildmaster', side: 'Withdraw', tone: 'bad' }
                : { icon: '🗳️', name: 'Stand for guildmaster', desc: 'The masters vote on standing and contracts filled', side: 'Stand ›', tone: 'gold' },
            ['stand', gd.id, !standing]));
        }
        if (gd.strike && rank >= 3) rows.push(deed({ icon: '✊', name: 'Call off the strike', desc: `Over ${esc(gd.strike.reason)}`, tone: 'bad' }, ['endStrike', gd.id]));
        // Contracts: what fills the chair and the purse
        for (const o of Guilds.contractOffers(player, world, s, gd.id)) {
            rows.push(deed({ icon: '📜', name: `Contract: ${o.qty} ${gname(o.good)}`, desc: `Within ${o.days} days at ${Utils.formatGold(o.unit)}g each · counts toward your standing`, side: price(o.total), tone: 'gold' }, ['contract', gd.id, o.good]));
        }
        // Loans
        const lq = Guilds.loanQuote(player, world, s, gd.id);
        if (lq.ok) rows.push(deed({ icon: '💰', name: `Borrow from the hall`, desc: `Up to ${g(lq.max)} at ${pct(lq.rate)} over ${lq.weeks} weeks`, side: price(lq.max) }, ['borrow', gd.id, lq.max]));
        else if (rd.loans && lq.reason) body += `<div class="pk-row-desc">${esc(lq.reason)}</div>`;
        rows.push(deed({ icon: '🚪', name: 'Leave the guild', desc: 'Your rank and standing here are lost', tone: 'bad' }, ['leave', gd.id]));
    }
    if (Guilds.canRule(player, world, s)) {
        rows.push(deed({ icon: '📜', name: gd.chartered ? 'Chartered by the crown' : 'Grant a royal charter', desc: 'As ruler: the guild stands under your protection', side: gd.chartered ? 'granted' : 'Grant ›' }, ['charter', gd.id], !gd.chartered));
        rows.push(deed({ icon: '⚔️', name: 'Abolish by edict', desc: 'As ruler: its rights end and its trades go free', tone: 'bad' }, ['abolish', gd.id]));
    }
    body += rowList(rows);
    return card(body, {
        icon: esc(def.icon), title: esc(gd.name),
        side: gd.chartered ? '📜 royal charter' : (rank >= 0 ? esc(Guilds.rankName(rank)) : ''),
        tone: gd.master.player ? 'good' : null,
    });
}

function myGuilds(game) {
    const { player, world } = game;
    const st = player.guilds;
    if (!st) return '';
    let html = '';
    const list = Guilds.memberships(player, world);
    html += rowList(list.map(x => ({
        icon: esc((x.def && x.def.icon) || '⚒️'), name: `${esc(Guilds.rankName(x.m.rank))} of the ${esc(x.guild ? x.guild.name : x.m.guild)}`,
        desc: esc(x.m.town), side: `standing ${Math.floor(x.m.standing)}`,
    })), 'Your guilds');
    html += rowList(st.contracts.map(c => {
        const here = player.q === c.q && player.r === c.r;
        return deed({ icon: '📜', name: `${c.qty - c.delivered} ${gname(c.good)} to ${esc(c.town)}`, desc: `By day ${c.due} at ${Utils.formatGold(c.unit)}g each`, side: here ? 'Deliver ›' : '', tone: 'gold' }, ['deliver', c.id], here, `Deliver it in ${c.town}.`);
    }), 'Your contracts');
    html += rowList(st.loans.map(l => deed({ icon: '💰', name: `Owed to the guild at ${esc(l.town)}`, desc: `${g(l.weekly)} a week`, side: price(l.owed, player.gold >= l.owed) }, ['repay', l.id], player.gold >= l.owed, `You owe ${Utils.formatGold(l.owed)}g.`)), 'Your loans');
    const s = st.stats;
    html += chips([
        ['', 'Fees', g(s.fees)], ['', 'Dues', g(s.dues)], ['', 'Tolls paid', g(s.tolls)], ['', 'Guild mark earned', g(s.premium)],
        ['', 'Contracts', `${s.contractsDone} (${g(s.contractIncome)})`], ['', 'Stipends', g(s.stipends)],
    ]);
    if (st.log.length) html += rowList(st.log.slice(-5).reverse().map(l => ({ icon: '·', name: esc(l.text), side: `day ${l.day}` })), 'Lately');
    return html;
}

Object.assign(ActionMenu, {
    /** The Guildhall panel for the town the player stands in. */
    showGuildhall(game, tile = null) {
        const player = game.player;
        const world = game.world;
        const t = tile || world.getTile(player.q, player.r);
        const s = t && t.settlement;
        let html = '<div>';
        html += chips([purse(player.gold), s ? ['📍', esc(s.name)] : null]);
        html += lede('The town’s guilds work its trades.');
        html += bullets([
            'Outsiders pay their toll on the goods the guilds guard, and may sell only so much a week.',
            'Masters’ goods carry the guild’s mark; journeymen buy the guild’s materials at guild rates.',
            'A monopoly — the crown’s above all — sets a guild’s rights aside.',
        ]);
        const gs = s && Guilds.townGuilds(s);
        if (!gs) html += lede(s ? `${esc(s.name)} has no guilds${s.guildBans ? ' (abolished by the crown)' : ''}.` : 'Stand in a town to visit its guildhall.');
        else for (const gd of Object.values(gs)) html += guildCard(game, t, gd);
        html += rowList([
            s && Underworld.hasGuildPresence(s) ? { icon: '🗝️', name: 'The thieves\' guild', desc: 'It keeps its own counsel here (the Underworld)' } : null,
            s && SettlementMarket.fair(s) ? { icon: '🎪', name: 'A fair is on', desc: 'Outside merchants trade freely while it lasts', tone: 'good' } : null,
        ]);
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
                ? (res.earned != null ? `Done: +${Utils.formatGold(res.earned)} gold.` : res.spent != null ? `Done: −${Utils.formatGold(res.spent)} gold.` : res.gold != null ? `Done: +${Utils.formatGold(res.gold)} gold.` : 'Done.')
                : (res.reason || 'Not possible.');
            game.ui.showNotification('⚒️ Guildhall', text, res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showGuildhall(game, tile);
    },
});

// ActionMenu — Works of the Ages: the great works rising near you (cathedrals,
// universities, great bridges, royal canals, walls, keeps, harbours), their
// stage, their funders and their shares, your House's pledges (pledge, raise,
// withdraw), the ruins that may be taken up again, and founding a work in the
// town you stand in (systems/greatWorks.js). Opened from the town's action
// menu ('great_works') and the Public Works panel. Buttons route through
// data-am-act → ActionMenu.greatWorksAct.
import { ActionMenu } from './_ref.js';
import { GreatWorks } from '../../systems/greatWorks.js';
import { lede, chips, rowList, card, price, purse, more, esc } from './uiKit.js';
import { Utils } from '../../core/utils.js';

// The pledge term the buttons offer (years; 0 = until it is finished): a panel setting, not saved
let _term = 10;

const STATUS = { building: ['🏗️', 'rising', 'good'], stalled: ['🚧', 'stalled', 'warn'], done: ['🏛️', 'finished', 'gold'], ruin: ['🏚️', 'a ruin', 'bad'] };
const KIND = { player: '🛡️', rival: '⚔️', crown: '👑', guild: '⚒️', holder: '🏰' };

function _here(game) {
    const t = game.world.getTile(game.player.q, game.player.r);
    return (t && t.settlement) || null;
}

function _bar(p, tone = '#c9a227') {
    const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
    return `<div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; margin:4px 0;"><div style="height:6px; width:${pct}%; background:${tone}; border-radius:3px;"></div></div>`;
}

function _amounts(full) {
    const C = GreatWorks.config().pledge || {};
    const list = Array.isArray(C.playerWeekly) ? C.playerWeekly : [2, 5, 10, 25, 50, 100];
    return list.filter(a => a <= Math.max(5, full * 1.5));
}

function _termText(y) {
    return y > 0 ? `for ${y} years` : 'until it is finished';
}

function _funderRows(d, day) {
    return d.funders.slice().sort((a, b) => b.paid - a.paid).map(f => ({
        icon: KIND[f.kind] || '•', name: esc(f.name) + (f.mine ? ' (your House)' : ''),
        desc: f.status === 'active' ? `${Utils.formatGold(f.weekly)}g a week ${f.until ? `for ${Math.max(0, Math.ceil((f.until - day) / 120))} more years` : 'until it is finished'}${f.missed ? ` · ${f.missed} week${f.missed === 1 ? '' : 's'} short` : ''}`
            : f.status === 'broken' ? 'broke its pledge' : f.status === 'lapsed' ? 'the old line\'s pledge, lapsed' : 'pledge honoured',
        side: `${Utils.formatGold(f.paid)}g · ${Math.round(f.share * 100)}%`, tone: f.status === 'broken' ? 'bad' : f.mine ? 'gold' : '',
    }));
}

function _workCard(game, d) {
    const { player } = game;
    const [sIco, sTxt, tone] = STATUS[d.status] || ['•', d.status, ''];
    let body = `<div style="font-size:12px;">${esc(d.town)}${d.dist != null ? (d.dist > 0 ? ` · ${d.dist} hex${d.dist === 1 ? '' : 'es'} away` : ' · here') : ''} · founded by ${esc(d.founder ? d.founder.name : 'unknown')}, ${d.years > 0 ? `${d.years} year${d.years === 1 ? '' : 's'} ago` : 'this year'}</div>`;
    if (d.status === 'done') {
        body += `<div style="font-size:12px; margin-top:4px;">Carved over its door: <b>${esc((d.carved || []).map(c => `${c.name} (${Math.round(c.share * 100)}%)`).join(', ') || 'no names')}</b></div>`;
    } else {
        body += _bar(d.prog, d.status === 'ruin' ? '#8a5a4a' : d.status === 'stalled' ? '#b08a3a' : '#c9a227');
        body += `<div style="font-size:11px; color:var(--text-secondary);">${Math.round(d.prog * 100)}% built · stage ${d.stageNo}/${d.stages}: ${esc(d.stage)} · pledged ${Utils.formatGold(d.pledged)}g of ${Utils.formatGold(d.full)}g a week at full pace${d.yearsLeft != null ? ` · about ${d.yearsLeft} more years at this pace` : ''} · ${Utils.formatGold(d.spent)}g spent of about ${Utils.formatGold(d.est)}g${d.short && d.status === 'building' ? ` · waiting on ${esc(d.short)}` : ''}</div>`;
    }
    if (d.abandonedBy.length) body += `<div style="font-size:11px; color:#e0a080;">${esc(d.town)} blames ${esc(d.abandonedBy.map(b => b.name).join(', '))} for its ruin.</div>`;
    body += more(`Funders (${d.funders.length})`, rowList(_funderRows(d, game.world.day)));
    const rows = [];
    const gold = player.gold || 0;
    if (d.status === 'building' || d.status === 'stalled') {
        const cur = d.mine ? d.mine.weekly : 0;
        for (const a of _amounts(d.full).filter(x => x > cur)) {
            rows.push({ icon: '🤝', name: d.mine ? `Raise your pledge to ${Utils.formatGold(a)}g a week` : `Pledge ${Utils.formatGold(a)}g a week ${_termText(_term)}`, desc: d.mine ? 'A pledge may be raised, never cut' : 'Paid each week in turn with the others; your share is carved over the door when it is done', side: price(a, gold >= a), off: gold < a, why: `You haven't ${Utils.formatGold(a)}g.`, act: 'greatWorksAct', args: ['pledge', d.id, a] });
        }
        if (d.mine) {
            const left = d.mine.until ? Math.max(0, Math.ceil((d.mine.until - game.world.day) / 120)) : null;
            rows.push({ icon: '💔', name: 'Withdraw your pledge', desc: `${left != null ? `${left} years of it left: ` : ''}a broken pledge costs Prestige, and ${esc(d.town)} will remember it`, side: '', tone: 'bad', act: 'greatWorksAct', args: ['withdraw', d.id] });
        }
    } else if (d.status === 'ruin') {
        const need = Math.ceil(d.full * ((GreatWorks.config().pledge || {}).founderMinShare || 0.1));
        for (const a of _amounts(d.full).filter(x => x >= need).slice(0, 3)) {
            rows.push({ icon: '🏗️', name: `Take up the ruin: ${Utils.formatGold(a)}g a week ${_termText(_term)}`, desc: `${Math.round(d.prog * 100)}% of it still stands`, side: price(a, gold >= a), off: gold < a, why: `You haven't ${Utils.formatGold(a)}g.`, act: 'greatWorksAct', args: ['resume', d.id, a] });
        }
    }
    return card(body + rowList(rows), { icon: d.icon, title: esc(d.name), side: `${sIco} ${sTxt}`, tone: tone === 'bad' ? 'bad' : '' });
}

function _foundSection(game, s) {
    const { player, world } = game;
    const opts = GreatWorks.options(world, s);
    const P = GreatWorks.config().pledge || {};
    const rows = opts.map(o => {
        const min = Math.ceil(o.est.weekly * (P.founderMinShare || 0.1));
        const amt = _amounts(o.est.weekly).find(a => a >= min) || min;
        return {
            icon: o.icon, name: `Found ${esc(GreatWorks.withArticle(o.name))} in ${esc(s.name)}`,
            desc: `${esc(o.blurb)} About ${o.years} years at full pace (${Utils.formatGold(o.est.weekly)}g a week; ~${Utils.formatGold(o.est.total)}g in all, stone and wages). You pledge ${Utils.formatGold(amt)}g a week ${_termText(_term)}; others will join.`,
            side: price(amt, (player.gold || 0) >= amt), off: !o.ok || (player.gold || 0) < amt, why: esc(o.ok ? `You haven't ${Utils.formatGold(amt)}g.` : o.reason),
            act: 'greatWorksAct', args: ['found', o.id, amt],
        };
    });
    return rowList(rows, `🏛️ Found a work in ${esc(s.name)}`);
}

Object.assign(ActionMenu, {
    /** Works of the Ages near you. */
    showGreatWorks(game, message = null) {
        const { player, world } = game;
        const s = _here(game);
        const list = GreatWorks.nearby(world, player);
        const mine = list.filter(d => d.mine);
        let html = '<div style="font-size:12px;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'gold' : 'bad' });
        html += lede('Cathedrals, universities, great bridges, canals, walls and harbours take a generation or two. Houses, guilds, the church and the crown pledge and pay in turn; the names of those who paid most are carved over the door. A pledge binds your heirs: keep it, and the House keeps the honour.');
        html += chips([purse(player.gold), ['👑', 'Prestige', Math.round((player.house && player.house.prestige) || 0)], ['🤝', 'Your pledges', `${Utils.formatGold(mine.reduce((a, d) => a + d.mine.weekly, 0))}g/wk`]]);
        html += rowList([{ icon: '📅', name: `Pledges offered ${_termText(_term)}`, desc: 'Change the term the buttons below offer', side: 'change', act: 'greatWorksAct', args: ['term'] }]);
        if (!list.length) html += card('No great work is rising within reach, and your House is pledged to none.', { icon: '🏛️', title: 'Nothing near' });
        for (const d of list.filter(x => x.status !== 'done').slice(0, 8)) html += _workCard(game, d);
        const done = list.filter(x => x.status === 'done');
        if (done.length) html += more(`Finished works near you (${done.length})`, done.slice(0, 8).map(d => _workCard(game, d)).join(''));
        if (s) html += _foundSection(game, s);
        const log = (GreatWorks.state(world).log || []).slice(-10).reverse();
        if (log.length) html += more('The builders\' chronicle', rowList(log.map(e => ({ icon: '📜', name: esc(e.text), desc: `day ${e.day}`, side: '' }))));
        html += '</div>';
        game.ui.showCustomPanel('🏛️ Works of the Ages', html);
    },

    /** Every button on the panel. */
    greatWorksAct(game, op, a = null, b = null) {
        const { player, world } = game;
        let res = { success: false, message: 'Nothing happens.' };
        if (op === 'term') {
            const C = GreatWorks.config().pledge || {};
            const terms = Array.isArray(C.playerYears) && C.playerYears.length ? C.playerYears : [5, 10, 20, 0];
            _term = terms[(terms.indexOf(_term) + 1) % terms.length];
            ActionMenu.showGreatWorks(game);
            return;
        }
        if (op === 'pledge') res = GreatWorks.pledge(world, player, a, Number(b) || 0, _term);
        else if (op === 'withdraw') res = GreatWorks.withdraw(world, player, a);
        else if (op === 'resume') res = GreatWorks.resume(world, player, a, { weekly: Number(b) || 0, years: _term });
        else if (op === 'found') {
            const s = _here(game);
            res = s ? GreatWorks.found(world, player, s, a, { weekly: Number(b) || 0, years: _term }) : { success: false, message: 'There is no town here.' };
        }
        if (res.success) game.ui.updateStats(player, world);
        ActionMenu.showGreatWorks(game, { ok: !!res.success, text: res.message });
    },
});

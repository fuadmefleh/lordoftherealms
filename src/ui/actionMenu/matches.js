// ActionMenu — Matches & Betrothals (Dynasty → 💍 Matches & Betrothals):
//   showMatchesPanel  the House's promised children, offers that stand,
//                     children who could be promised, the record
//   showMatchSeek     one child's suitors: rival Houses' children, foreign
//                     crowns' princes and princesses, your lords' houses, a
//                     realm's nobility — with what each would ask
//   showMatchTerms    the terms (whose House the line belongs to, a ward,
//                     land in the dowry), their price, and the proposal
//   matchesDo         the clicks: propose, break (with its cost shown first),
//                     accept or decline an offer
// Logic lives in systems/betrothals.js; these panels present it in the
// action menu's voice (ui/actionMenu/uiKit.js).
import { ActionMenu } from './_ref.js';
import { Betrothals } from '../../systems/betrothals.js';
import { HeirAgency } from '../../systems/heirAgency.js';
import { LandMarket } from '../../systems/landMarket.js';
import { Upbringing } from '../../systems/upbringing.js';
import { esc, sectionHead, lede, chips, card, rowList, price } from './uiKit.js';
import { Utils } from '../../core/utils.js';

const MUTED = 'color:#9d937c; font-size:11px;';
const BACK_TO_DYNASTY = { icon: '←', name: 'Back to Dynasty', act: 'openTileMenu', args: ['showDynastyMenu'] };
const BACK_TO_MATCHES = { icon: '←', name: 'Back to Matches', act: 'showMatchesPanel' };
const KIND_ICON = { rival: '🛡️', royal: '👑', vassal: '🏰', noble: '⚜️' };
const KIND_HEAD = { rival: 'Rival Houses', royal: 'Foreign Crowns', vassal: 'Lords of Your Realm', noble: 'The Nobility of the Realms' };

function _msg(message) {
    return message ? `<div class="pk-card" style="border-color:${message.color || 'rgba(245,197,66,0.4)'}; color:#ece2c8;">${message.html}</div>` : '';
}

/** "they ask 340g" / "they pay you 120g" / "no dowry". */
function _askText(ask) {
    return ask > 0 ? `they ask ${Utils.formatGold(ask)}g` : ask < 0 ? `they pay you ${Utils.formatGold(-ask)}g` : 'no dowry either way';
}

function _askSide(ask, canPay = true) {
    return ask > 0 ? price(ask, canPay) : ask < 0 ? `<span style="color:#8fd18a;">+${Utils.formatGold(-ask)}g</span>` : 'even';
}

function _childLabel(child) {
    return `${esc(child.firstName)}, ${child.age === 0 ? 'an infant' : `aged ${child.age}`}`;
}

Object.assign(ActionMenu, {
    /** Dynasty → Matches & Betrothals. */
    showMatchesPanel(game, message = null) {
        const player = game.player;
        const world = game.world;
        const st = Betrothals.state(player);
        const kids = (player.children || []).filter(c => c && c.isAlive !== false);
        const promised = kids.filter(c => Betrothals.of(c));
        const free = Betrothals.eligibleChildren(player);
        let html = '<div style="font-size: 12px;">' + _msg(message);
        html += chips([['💍', 'Promised', promised.length], ['💌', 'Offers', st.offers.length], ['✓', 'Kept', st.stats.kept], ['💔', 'Broken', st.stats.brokenByYou + st.stats.brokenByThem]]);
        html += lede('Promise a child — even in the cradle — to a rival House, a foreign crown, a lord of your realm. While the promise stands their House keeps the peace with yours; at coming of age the match is made. Breaking it costs whoever breaks it.');

        // Offers that stand
        if (st.offers.length) {
            html += sectionHead('Offers');
            const rows = [];
            for (const o of st.offers) {
                const child = (player.children || []).find(c => c && c.id === o.childId);
                if (!child) continue;
                rows.push({
                    icon: '💌', name: `${esc(o.house)} offers ${esc(o.name)}${o.heir ? ' (the heir)' : ''} for ${esc(child.firstName)}`,
                    desc: `${esc(_askText(o.ask))} · answer by day ${o.expires} · click to accept`,
                    act: 'matchesDo', args: ['accept', o.id], side: _askSide(o.ask, o.ask <= 0 || (player.gold || 0) >= o.ask / 2), tone: 'gold',
                });
                rows.push({ icon: '✋', name: `Decline ${esc(o.house)}`, desc: 'A small slight', act: 'matchesDo', args: ['decline', o.id], tone: 'warn' });
            }
            html += rowList(rows);
        }

        // Promised
        html += sectionHead('Promised');
        if (!promised.length) html += `<div style="${MUTED} margin:0 2px 6px;">None of your children is promised.</div>`;
        else {
            html += rowList(promised.map(c => {
                const b = Betrothals.of(c);
                const t = b.terms || {};
                const money = (b.due ? `${Utils.formatGold(b.due)}g still owed at the wedding` : b.owed ? `${Utils.formatGold(b.owed)}g owed to you at the wedding` : '');
                return {
                    icon: b.flaw ? '💔' : KIND_ICON[b.kind || 'noble'] || '💍',
                    name: `${_childLabel(c)} → ${esc(b.name)}`,
                    desc: `${esc(b.houseName || b.kingdomName || '')}${t.line === 'ours' ? ' · they take your name' : t.line === 'theirs' ? ` · ${esc(c.firstName)} goes to them` : ''}${t.ward === 'oursThere' ? ` · ${esc(c.firstName)} raised at their court` : ''}${t.ward === 'theirsHere' ? ' · their child at your court' : ''}${t.land ? ` · ${esc(b.landName || 'an estate')} at the wedding` : ''}${money ? ' · ' + money : ''}`,
                    note: b.flaw ? (b.flaw === 'maimed' ? 'Their child is maimed: you may break it without shame.' : 'Their child is held captive.') : '',
                    act: 'matchesDo', args: ['breakAsk', c.id], side: 'Break…', tone: b.flaw ? 'warn' : 'bad',
                };
            }));
        }

        // Seek a match
        html += sectionHead('Seek a Match');
        if (!free.length) html += `<div style="${MUTED} margin:0 2px 6px;">No child of yours is free to be promised.</div>`;
        else html += rowList(free.map(c => ({
            icon: c.gender === 'female' ? '👧' : '👦', name: _childLabel(c),
            desc: `${Upbringing.ensure(c).comeOfAge ? 'Of age: a promise now weds at once once the other is of age' : 'Weds at coming of age'}${player.heir === c.id ? ' · 👑 your heir' : ''}`,
            act: 'showMatchSeek', args: [c.id], side: '›',
        })));

        // Matches made, and the children born of them: of your House, or of theirs
        const wed = kids.filter(c => c.upbringing && c.upbringing.spouse && Array.isArray(c.upbringing.spouse.issue));
        if (wed.length) {
            html += rowList(wed.map(c => {
                const sp = c.upbringing.spouse;
                const issue = Betrothals.issue(c, world).filter(i => i.alive !== false);
                const ours = sp.line === 'ours';
                return {
                    icon: ours ? '🛡️' : '🏠', name: `${esc(c.firstName)} & ${esc(sp.name)}`,
                    desc: `${ours ? `${esc(sp.name)} took your name: their children are of your House and come to the seat with ${esc(c.firstName)}` : `${esc(c.firstName)} went to ${esc(sp.house || sp.kingdomName || 'them')}: their children are of that House${sp.match === 'royal' ? ' — your blood in a royal line, a claim by blood' : ''}`}`,
                    note: issue.length ? `Children: ${issue.map(i => `${esc(i.first)} (${i.age})`).join(', ')}` : 'No children yet',
                    side: issue.length ? `👶 ${issue.length}` : '',
                };
            }), 'Matches Made');
        }

        // The record
        if (st.history.length) {
            const lines = st.history.slice(-6).reverse().map(h => {
                const what = h.kind === 'made' ? 'promised to' : h.kind === 'kept' ? 'wed' : h.kind === 'ended' ? 'no longer promised to' : h.kind === 'brokenByThem' ? 'jilted by' : 'broke with';
                return `<div style="${MUTED}">Day ${h.day}: ${esc(h.child)} ${what} ${esc(h.to)}${h.why ? ` (${esc(h.why)})` : ''}</div>`;
            }).join('');
            html += card(lines, { icon: '📖', title: 'The record' });
        }
        html += rowList([BACK_TO_DYNASTY]);
        html += '</div>';
        game.ui.showCustomPanel('💍 Matches & Betrothals', html);
    },

    /** One child's suitors, grouped, each with what it would cost on the plain terms. */
    showMatchSeek(game, childId, message = null) {
        const player = game.player;
        const world = game.world;
        const child = (player.children || []).find(c => c && c.id === childId);
        if (!child) return ActionMenu.showMatchesPanel(game);
        let html = '<div style="font-size: 12px;">' + _msg(message);
        html += lede(`Suitors for ${_childLabel(child)}. The price shown is for the plain terms — ${esc(child.firstName)} goes to them, no ward, coin only. Pick one to set the terms.`);
        const all = Betrothals.suitors(player, world, childId);
        for (const kind of ['rival', 'royal', 'vassal', 'noble']) {
            const list = all.filter(s => s.kind === kind);
            if (!list.length) continue;
            html += rowList(list.map(s => {
                const q = Betrothals.quote(player, world, childId, s.id, { line: 'theirs', ward: 'none' }, { suitor: s });
                return {
                    icon: KIND_ICON[kind], name: `${esc(s.name)}${s.heir ? (kind === 'royal' ? ' · 👑 the heir' : ' · heir of the House') : ''}`,
                    desc: `${esc(s.houseName)} · ${s.gender === 'female' ? 'she' : 'he'} is ${s.age === 0 ? 'an infant' : s.age}${s.maimed ? ' · maimed' : ''} · ${esc(_askText(q.ask))}`,
                    off: !s.ok, why: esc(s.why || ''),
                    act: 'showMatchTerms', args: [childId, s.id, 'theirs', 'none', null], side: _askSide(q.ask, q.ok || q.ask <= 0), tone: kind === 'royal' ? 'gold' : '',
                };
            }), KIND_HEAD[kind]);
        }
        if (!all.length) html += `<div style="${MUTED} margin:0 2px 6px;">No one of a fitting age.</div>`;
        html += rowList([BACK_TO_MATCHES]);
        html += '</div>';
        game.ui.showCustomPanel(`💍 A Match for ${child.firstName}`, html);
    },

    /** The terms: whose line, a ward, land; the price and the proposal. */
    showMatchTerms(game, childId, candId, line = 'theirs', ward = 'none', land = null, message = null) {
        const player = game.player;
        const world = game.world;
        const child = (player.children || []).find(c => c && c.id === childId);
        if (!child) return ActionMenu.showMatchesPanel(game);
        const terms = { line, ward, land };
        const q = Betrothals.quote(player, world, childId, candId, terms);
        const s = q.suitor;
        if (!s) return ActionMenu.showMatchSeek(game, childId, { html: 'That match can no longer be made.', color: 'rgba(224,96,96,0.5)' });
        const go = (l, w, e) => ({ act: 'showMatchTerms', args: [childId, candId, l, w, e] });
        let html = '<div style="font-size: 12px;">' + _msg(message);
        html += card(`<div style="color:#ece2c8;">${esc(s.name)} of ${esc(s.houseName)}, ${s.age === 0 ? 'an infant' : `aged ${s.age}`}${s.heir ? (s.kind === 'royal' ? ' — the heir to the throne' : ' — heir of the House') : ''}.</div>`
            + `<div style="${MUTED} margin-top:3px;">${s.kind === 'royal' ? 'At the wedding your House gains a claim on that throne by marriage — more for the heir, more again if your child goes to them.' : s.kind === 'rival' ? 'While the promise stands, their House keeps a truce with yours: no plots, no agents, no ambush. The feud eases week by week.' : s.kind === 'vassal' ? 'The lord stands by the crown while the promise holds; at the wedding his house becomes kin.' : 'The realm counts your House as kin-to-be: slower to join a league against you.'}</div>`,
        { icon: KIND_ICON[s.kind], title: `${esc(child.firstName)} and ${esc(s.first)}`, side: s.kind === 'royal' ? 'royal' : '' });

        html += rowList([
            { icon: '🏠', name: `${esc(child.firstName)} goes to them`, desc: 'The children of the match are of their House (a royal line: your blood in it, a claim by blood); they ask less', ...go('theirs', ward, land), side: line === 'theirs' ? '✓' : '', tone: line === 'theirs' ? 'gold' : '' },
            { icon: '🛡️', name: `${esc(s.first)} takes your name`, desc: `The children of the match are of your House and come to the seat with their parent; they ask more (+Prestige at the wedding)`, ...go('ours', ward, land), side: line === 'ours' ? '✓' : '', tone: line === 'ours' ? 'gold' : '' },
        ], 'Whose House');

        const wOurs = Betrothals._wardWhy(player, world, child, s, 'oursThere');
        const wTheirs = Betrothals._wardWhy(player, world, child, s, 'theirsHere');
        html += rowList([
            { icon: '·', name: 'No ward', desc: 'Each child stays at home until the wedding', ...go(line, 'none', land), side: ward === 'none' ? '✓' : '', tone: ward === 'none' ? 'gold' : '' },
            { icon: '🏰', name: `${esc(child.firstName)} is raised at their court`, desc: 'A pledge of good faith (they ask less). Their court teaches your child, and a bond grows; turn cold toward them and they hold a hostage', off: !!wOurs, why: esc(wOurs || ''), ...go(line, 'oursThere', land), side: ward === 'oursThere' ? '✓' : '', tone: ward === 'oursThere' ? 'gold' : '' },
            { icon: '🎓', name: `${esc(s.first)} is raised at your court`, desc: 'You hold their child until the wedding (they ask more); your children grow up beside them', off: !!wTheirs, why: esc(wTheirs || ''), ...go(line, 'theirsHere', land), side: ward === 'theirsHere' ? '✓' : '', tone: ward === 'theirsHere' ? 'gold' : '' },
        ], 'Ward');

        // Land in the dowry (only when they ask one)
        const estates = LandMarket.mine(player, world) || [];
        const plain = Betrothals.quote(player, world, childId, candId, { line, ward, land: null });
        if (estates.length && plain.ask > 0) {
            const rows = [{ icon: '·', name: 'Coin only', ...go(line, ward, null), side: !land ? '✓' : '', tone: !land ? 'gold' : '' }];
            for (const e of estates.slice(0, 6)) {
                rows.push({ icon: '🌾', name: `Settle ${esc(e.name)} on them`, desc: `Worth about ${Utils.formatGold(Math.round(LandMarket.value(world, e)))}g · given at the wedding, if it is still yours`, ...go(line, ward, e.id), side: land === e.id ? '✓' : '', tone: land === e.id ? 'gold' : '' });
            }
            html += rowList(rows, 'Land in the Dowry');
        }

        // The price
        let body = `<div style="color:#ece2c8;">${esc(s.houseName)}: ${esc(_askText(q.ask))}${q.landValue ? `, ${esc(q.landName)} counting for ${Utils.formatGold(q.landValue)}g of it` : ''}.</div>`;
        if (q.coin > 0) body += `<div style="${MUTED}">You pay ${Utils.formatGold(q.now)}g now and ${Utils.formatGold(q.later)}g at the wedding.</div>`;
        else if (q.coin < 0) body += `<div style="${MUTED}">They pay ${Utils.formatGold(-q.now)}g now and ${Utils.formatGold(-q.later)}g at the wedding.</div>`;
        html += card(body, { icon: '💰', title: 'The Dowry', side: _askSide(q.ask, q.ok || q.ask <= 0) });
        html += rowList([{
            icon: '💍', name: `Promise ${esc(child.firstName)} to ${esc(s.name)}`, desc: 'Seal the betrothal on these terms',
            off: !q.ok, why: esc(q.reason || ''), act: 'matchesDo', args: ['propose', childId, candId, line, ward, land],
            side: q.now > 0 ? price(q.now, (player.gold || 0) >= q.now) : '', tone: 'gold',
        }, { icon: '←', name: 'Other suitors', act: 'showMatchSeek', args: [childId] }]);
        html += '</div>';
        game.ui.showCustomPanel(`💍 Terms for ${child.firstName}`, html);
    },

    /** The Matches panel's clicks. */
    matchesDo(game, op, a = null, b = null, c = null, d = null, e = null) {
        const player = game.player;
        const world = game.world;
        const ok = (html) => { game.ui.updateStats(player, world); ActionMenu.showMatchesPanel(game, { html }); };
        const bad = (html) => ActionMenu.showMatchesPanel(game, { html, color: 'rgba(224,96,96,0.5)' });
        if (op === 'propose') {
            const res = Betrothals.propose(player, world, a, b, { line: c, ward: d, land: e });
            if (!res.success) return ActionMenu.showMatchTerms(game, a, b, c, d, e, { html: esc(res.reason), color: 'rgba(224,96,96,0.5)' });
            return ok(`💍 ${esc(res.text)}`);
        }
        if (op === 'breakAsk') {
            const child = (player.children || []).find(x => x && x.id === a);
            const bt = child && Betrothals.of(child);
            if (!bt) return ActionMenu.showMatchesPanel(game);
            const cost = Betrothals.breakCost(player, world, child);
            let html = '<div style="font-size: 12px;">';
            html += lede(`Break ${esc(child.firstName)}'s betrothal to ${esc(bt.name)} of ${esc(bt.houseName || bt.kingdomName)}? ${esc(cost ? cost.text : '')}`);
            html += rowList([
                { icon: '💔', name: 'Break it', desc: 'Your word, unkept — and remembered', act: 'matchesDo', args: ['break', a], tone: 'bad' },
                BACK_TO_MATCHES,
            ]);
            html += '</div>';
            return game.ui.showCustomPanel('💔 Break a Betrothal', html);
        }
        if (op === 'break') {
            const res = HeirAgency.breakBetrothal(player, world, a);
            if (!res.success) return bad(esc(res.reason));
            return ok(`💔 The betrothal to ${esc(res.betrothal.name)} is broken.${res.returned ? ` ${Utils.formatGold(res.returned)}g goes back to them.` : ''}${res.free ? ' No one blames you.' : ' They will remember.'}`);
        }
        if (op === 'accept') {
            const res = Betrothals.acceptOffer(player, world, a);
            return res.success ? ok(`💍 ${esc(res.text)}`) : bad(esc(res.reason));
        }
        if (op === 'decline') {
            const res = Betrothals.declineOffer(player, world, a);
            return res.success ? ok(esc(res.text)) : bad(esc(res.reason));
        }
        return ActionMenu.showMatchesPanel(game);
    },
});

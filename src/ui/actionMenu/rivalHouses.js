// ActionMenu — the rival Houses' heads (systems/rivalHouses.js): meeting one
// on the road or in town (a staged conversation: ui/actionMenu/rivalAudience.js;
// the meeting's AP is paid on its first real act) and the
// Rival Houses overview (Dynasty → House → Rival Houses): each head, their
// family, purse, temper, what they are about and where, and their latest doings.
// ActionMenu.rivalHouseAct is the old button route, kept for data-am-act callers.
import { ActionMenu } from './_ref.js';
import { Names } from '../../core/names.js';
import { RivalHouses } from '../../systems/rivalHouses.js';
import { openRivalAudience } from './rivalAudience.js';
import { esc, lede, bullets, chips, card, more } from './uiKit.js';
import { Utils } from '../../core/utils.js';
import { MaimMarks } from '../../systems/maimMarks.js';

const NOTE = 'font-size: 11px; color: #9d937c;';

function feudLabel(f) {
    return f >= 60 ? 'Hostile' : f >= 30 ? 'Wary' : 'Cool';
}

function ordinal(n) {
    return n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`;
}

/** The head's card: who they are, where they are and what they are about, then the rest folded away. */
function headCard(v, rival = null) {
    const where = !v.where ? ' · nowhere to be found'
        : v.where.atTown ? (v.doing.includes(v.where.near) ? '' : ` · in ${esc(v.where.near)}`)
            : v.where.near ? ` · on the road near ${esc(v.where.near)}` : ` · at (${v.where.q}, ${v.where.r})`;
    let body = `<div style="${NOTE}">Head of ${esc(v.house)}${v.role ? `, <i>${esc(v.role)}</i>` : ''}${v.heads > 1 ? ` (the ${ordinal(v.heads)} in your time)` : ''}${v.seat ? ` · seat at ${esc(v.seat)}` : ''}${v.traits.length ? ` · ${v.traits.map(t => `${t.icon} ${esc(t.name)}`).join(', ')}` : ''}</div>`;
    body += `<div style="margin:4px 0; color:${v.hunting ? '#ff8080' : '#ddd'};">${v.hunting ? '⚔️' : '🧭'} ${esc(v.doing)}${where}</div>`;
    const armed = v.armed != null && v.armed < 0.95 ? ', ill-armed' : v.armed > 1.02 ? ', well armed' : '';
    body += chips([
        ['💰', 'Purse', esc(v.wealth)],
        ['⚔️', 'Retinue', `${v.strength}${armed}`],
        v.guards ? ['🛡️', 'Guards', v.guards] : null,
        v.estates.length ? ['🌾', 'Estates', `${v.estates.length} (~${Utils.formatGold(v.landValue)}g)`] : null,
        v.renown ? ['⭐', 'Renown', v.renown] : null,
    ]);
    const facts = [];
    if (v.ambition) {
        const am = v.ambition;
        const prog = am.id === 'wealth' ? `${am.have.toLocaleString()} / ${Utils.formatGold(am.target)}g` : `${am.have} / ${am.target}`;
        facts.push(`${am.icon} Ambition: <b>${esc(am.name)}</b> (${prog})`);
    }
    // (the heir, one you hold captive, one maimed: systems/rivalCaptives.js)
    const kids = v.children.map(c => `${esc(c.name)} (${c.age}${c.wed ? `, wed${c.wed !== 'another House' ? ` to your ${esc(c.wed)}` : ''}` : ''}${c.heir ? ', the heir' : ''}${c.held ? ', your captive' : ''}${c.maimed ? `, ${esc(c.maimed)}` : ''})`);
    facts.push(`💍 ${v.spouse ? `Married to ${esc(v.spouse)}` : 'Unmarried'}${kids.length ? ` · children: ${kids.join(', ')}` : ' · no children'}`);
    if (v.knight) facts.push(`✝️ ${esc(v.knight)}`);
    if (v.cross) facts.push(`✝️ Under the cross against ${esc(Names.realm(v.cross))}`);
    if (v.allies.length) facts.push(`🤝 Stands allied with ${v.allies.map(esc).join(', ')}`);
    if (v.enemies.length) facts.push(`💢 At odds with ${v.enemies.map(esc).join(', ')}`);
    if (v.favourite.length) facts.push(`👑 Favourite at the court of ${v.favourite.map(esc).join(', ')}`);
    if (v.arms) facts.push(`🛡️ ${esc(v.arms)}`);
    facts.push(`<span style="${NOTE}">Diplomacy ${v.skills.diplomacy} · stewardship ${v.skills.stewardship} · intrigue ${v.skills.intrigue}</span>`);
    body += bullets(facts);
    if (v.log.length) body += more(`Latest doings (${v.log.length})`, `<div style="${NOTE}">${v.log.map(e => `Day ${e.day}: ${esc(e.text)}`).join('<br>')}</div>`);
    const tone = v.feud >= 60 ? 'bad' : v.feud >= 30 ? 'warn' : '';
    // (the head maimed — blinded, a hand gone — carries it on the card)
    const marks = rival && rival.head ? MaimMarks.tag(rival.head) : '';
    return card(body, { icon: '🏰', title: `${esc(v.name)}, ${v.age}${marks ? ` · <span style="color:#e0846a;">${esc(marks)}</span>` : ''}`, side: `<span title="Their feud with your House, 0–100">${feudLabel(v.feud)} · feud ${v.feud}</span>`, tone });
}

Object.assign(ActionMenu, {
    /** Meet a rival House's head and retinue within a hex: a conversation (ui/actionMenu/rivalAudience.js). */
    showRivalHead(game, unitId) {
        return openRivalAudience(game, unitId);
    },

    /** Every rival House's head: the overview. */
    showRivalHouses(game) {
        const { player, world } = game;
        const rivals = RivalHouses.rivals(player).filter(r => r.head);
        let html = '<div style="font-size:12px; max-height:var(--panel-max-h, 560px); overflow-y:auto; min-width:440px;">';
        html += lede(rivals.length
            ? 'The Houses that resent yours. Their lords ride the map (🏰) with their retinues: come within a hex of one to talk. They remember what you do to them, trade in your markets and pay for their plots from their own purses.'
            : 'No rival House has shown its face yet.');
        for (const r of rivals) html += headCard(RivalHouses.view(player, world, r), r);
        html += '</div>';
        game.ui.showCustomPanel('🏰 Rival Houses', html);
    },

    /** The old button route (parley, gift, insult, match): acts through RivalHouses, then the meeting reopens. */
    rivalHouseAct(game, op, kingdomId, unitId, ...rest) {
        if (op === 'close') {
            if (game.ui.hideCustomPanel) game.ui.hideCustomPanel();
            return;
        }
        const { player, world } = game;
        if (!ActionMenu.commitPendingAP(game)) return;
        let res;
        if (op === 'parley') res = RivalHouses.parley(player, world, kingdomId);
        else if (op === 'gift') res = RivalHouses.gift(player, world, kingdomId);
        else if (op === 'insult') res = RivalHouses.insult(player, world, kingdomId);
        else if (op === 'match') res = RivalHouses.proposeMatch(player, world, kingdomId, rest[0], rest[1]);
        else return;
        if (game.updateUI) game.updateUI();
        game.ui.showNotification('🏰 Rival House', res.success ? res.text : res.reason, res.success && res.ok !== false ? 'success' : 'warning');
        if (unitId) openRivalAudience(game, unitId);
    },
});

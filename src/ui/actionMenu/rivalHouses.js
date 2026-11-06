// ActionMenu — the rival Houses' heads (systems/rivalHouses.js): meeting one
// on the road or in town (a staged conversation: ui/actionMenu/rivalAudience.js;
// the meeting's AP is paid on its first real act) and the
// Rival Houses overview (Dynasty → House → Rival Houses): each head, their
// family, purse, temper, what they are about and where, and their latest doings.
// ActionMenu.rivalHouseAct is the old button route, kept for data-am-act callers.
import { ActionMenu } from './_ref.js';
import { RivalHouses } from '../../systems/rivalHouses.js';
import { openRivalAudience } from './rivalAudience.js';
import { CARD, esc, lede, bullets } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function feudColor(f) {
    return f >= 60 ? '#e08080' : f >= 30 ? '#e0b040' : '#88aabb';
}

function feudLabel(f) {
    return f >= 60 ? 'Hostile' : f >= 30 ? 'Wary' : 'Cool';
}

/** The head's card: name, age, temper, family, purse, errand. */
function headCard(v) {
    let html = `<div style="${CARD}">`;
    html += `<div style="display:flex; justify-content:space-between; align-items:baseline;"><div style="font-weight:bold; color:var(--gold);">🏰 ${esc(v.name)}, ${v.age}</div>`;
    html += `<span style="color:${feudColor(v.feud)}; font-size:12px;">${feudLabel(v.feud)} (feud ${v.feud})</span></div>`;
    html += `<div style="${NOTE}">Head of ${esc(v.house)}${v.heads > 1 ? ` (the ${v.heads === 2 ? 'second' : v.heads === 3 ? 'third' : `${v.heads}th`} head in your time)` : ''}${v.seat ? ` · seat at ${esc(v.seat)}` : ''} · ${esc(v.wealth)}</div>`;
    if (v.traits.length) html += `<div style="font-size:12px; margin-top:3px;">${v.traits.map(t => `${t.icon} ${esc(t.name)}`).join(' · ')} <span style="${NOTE}">· diplomacy ${v.skills.diplomacy}, stewardship ${v.skills.stewardship}, intrigue ${v.skills.intrigue}</span></div>`;
    const kids = v.children.map(c => `${esc(c.name)} (${c.age}${c.wed ? `, wed${c.wed !== 'another House' ? ` to your ${esc(c.wed)}` : ''}` : ''})`);
    html += `<div style="font-size:12px; margin-top:3px;">${v.spouse ? `Married to ${esc(v.spouse)}` : 'Unmarried'}${kids.length ? ` · children: ${kids.join(', ')}` : ' · no children'}</div>`;
    if (v.ambition) {
        const a = v.ambition;
        const prog = a.id === 'wealth' ? `${a.have.toLocaleString()} / ${a.target.toLocaleString()}g` : `${a.have} / ${a.target}`;
        html += `<div style="font-size:12px; margin-top:3px;">${a.icon} Ambition: <b>${esc(a.name)}</b> <span style="${NOTE}">(${prog})</span>${v.renown ? ` <span style="${NOTE}">· renown ${v.renown}</span>` : ''}</div>`;
    }
    const extras = [];
    if (v.estates.length) extras.push(`🌾 ${v.estates.length} estate${v.estates.length > 1 ? 's' : ''} (~${v.landValue.toLocaleString()}g)`);
    if (v.favourite.length) extras.push(`👑 favourite at the court of ${v.favourite.map(esc).join(', ')}`);
    if (v.allies.length) extras.push(`🤝 allied with ${v.allies.map(esc).join(', ')}`);
    if (v.enemies.length) extras.push(`💢 at odds with ${v.enemies.map(esc).join(', ')}`);
    if (v.guards) extras.push(`🛡️ ${v.guards} hired guards`);
    extras.push(`⚔️ retinue strength ${v.strength}`);
    html += `<div style="${NOTE} margin-top:3px;">${extras.join(' · ')}</div>`;
    // The errand names the town when they are in it; else say where the road has them
    const where = !v.where ? ' · nowhere to be found'
        : v.where.atTown ? (v.doing.includes(v.where.near) ? '' : ` · in ${esc(v.where.near)}`)
            : v.where.near ? ` · on the road near ${esc(v.where.near)} (${v.where.q}, ${v.where.r})` : ` · at (${v.where.q}, ${v.where.r})`;
    html += `<div style="font-size:12px; margin-top:3px; color:${v.hunting ? '#ff8080' : '#ddd'};">${v.hunting ? '⚔️' : '🧭'} ${esc(v.doing)}${where}</div>`;
    if (v.log.length) {
        html += `<div style="${NOTE} margin-top:4px;">${v.log.map(e => `Day ${e.day}: ${esc(e.text)}`).join('<br>')}</div>`;
    }
    html += '</div>';
    return html;
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
        html += lede('The Houses that resent yours, and the lords who lead them.');
        html += bullets([
            'Their retinues ride the map (🏰): meet one within a hex to talk with its lord.',
            'They remember what you have done to them, have moods of their own, and make offers of their own.',
            'They trade in the same markets you do, sit at the same courts, and pay for their plots out of their own purses.',
        ]);
        if (!rivals.length) html += `<div style="${CARD}">No rival House has shown its face yet.</div>`;
        for (const r of rivals) html += headCard(RivalHouses.view(player, world, r));
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

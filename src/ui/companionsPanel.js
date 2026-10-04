// ============================================
// COMPANIONS PANEL — the travel-party roster
// ============================================
// Rendered inside ActionMenu.showTravelPartyMenu: one card per travelling
// companion with approval, mood, values, bonds, current gripe, wage and
// personal-quest status, plus Talk / Gift / Pay / Raise / Hear-them-out /
// Dismiss actions (systems/companions.js does the work). The fallen are
// remembered at the bottom.

import { Companions } from '../systems/companions.js';
import { Relationships } from '../systems/relationships.js';
import { PlayerEffects } from '../player/playerEffects.js';

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const BTN = 'padding: 3px 8px; border: none; border-radius: 3px; cursor: pointer; font-size: 10px;';

function _approvalBar(approval) {
    const color = approval >= 75 ? '#6c6' : approval >= 40 ? '#cc6' : approval >= 25 ? '#d93' : '#d55';
    return `<div style="height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; margin: 4px 0;">`
        + `<div style="width: ${Math.max(0, Math.min(100, approval))}%; height: 100%; background: ${color};"></div></div>`;
}

export const CompanionsPanel = {
    /** HTML for the roster of current companions (and the fallen). */
    rosterHtml(game) {
        const player = game.player;
        const party = Relationships.getTravelPartyMembers(player);
        const cfg = Companions.config();
        let html = '';
        if (party.length === 0) {
            html += '<div style="padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.03); color: #aaa; font-size: 12px; margin-bottom: 8px;">No one is currently traveling with you.</div>';
        } else {
            html += '<h5 style="margin: 6px 0; color: #6cf;">Current Party</h5>';
            for (const npc of party) {
                const d = Companions.describe(player, npc);
                const role = PlayerEffects.companionRole(npc);
                const rel = Relationships.getRelationship(player, npc.id);
                html += `<div style="background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px; margin-bottom: 6px; font-size: 12px;">`;
                html += `<div style="display: flex; justify-content: space-between; align-items: center;">`;
                html += `<div>${d.tier.icon} <strong>${_esc(d.name)}</strong> <span style="color:#9bc;font-size:11px">· ${_esc(npc.occupation || 'traveller')}: ${_esc(role.text)}</span></div>`;
                html += `<div style="font-size: 11px; color: #bbb;">${_esc(d.tier.label)} · ${Math.round(d.effectiveness * 100)}%</div>`;
                html += `</div>`;
                html += _approvalBar(d.approval);
                html += `<div style="font-size: 11px; color: #bcd;">Approval <strong>${d.approval}</strong>/100 · Friendship ${rel ? rel.score || 0 : 0} · ${d.daysTogether} day(s) together</div>`;
                html += `<div style="font-size: 11px; margin-top: 3px;">Values: ${d.values.map(v => `<span style="background: rgba(120,140,200,0.18); padding: 1px 6px; border-radius: 8px; margin-right: 3px;">${v.icon || ''} ${_esc(v.label)}</span>`).join('')}</div>`;
                if (d.bonds.length) {
                    html += `<div style="font-size: 11px; margin-top: 3px; color: #aaa;">Bonds: ${d.bonds.map(b => `${b.kind === 'friends' ? '🤝' : '⚡'} ${_esc(b.name)}`).join(', ')}</div>`;
                }
                html += `<div style="font-size: 11px; margin-top: 3px; color: #aaa;">Wage ${d.wage}g/day${d.wageDue ? ` · owed ${d.wageDue}g (paid every ${cfg.payInterval} days)` : ''}</div>`;
                if (d.perk) {
                    html += `<div style="font-size: 11px; margin-top: 3px; color: #fd6;">${d.perk.icon || '💛'} ${_esc(d.perk.name)} — ${_esc(d.perk.text)}</div>`;
                }
                if (d.warned) {
                    html += `<div style="font-size: 11px; margin-top: 3px; color: #f77;">⚠️ ${_esc(npc.firstName)} has been acting strangely — win them back before it is too late.</div>`;
                }
                if (d.gripe) {
                    html += `<div style="font-size: 11px; margin-top: 3px; color: #e96;">Gripe: ${_esc(d.gripe.text)}</div>`;
                }
                if (d.quest) {
                    const q = d.quest;
                    const status = { offered: 'Wants to talk', active: 'In progress', done: 'Fulfilled', abandoned: 'Abandoned' }[q.status] || q.status;
                    html += `<div style="font-size: 11px; margin-top: 4px; padding: 4px 6px; background: rgba(200,170,90,0.10); border-radius: 4px;">${q.icon} <strong>${_esc(q.title)}</strong> — ${status}`;
                    if (q.status === 'offered' || q.status === 'active') html += `<div style="color:#bbb; margin-top: 2px;">${_esc(q.description)}</div>`;
                    for (const o of q.objectives) html += `<div style="color:#cdb;">• ${_esc(o.text)}: ${Math.min(o.current, o.target)}/${o.target}</div>`;
                    html += `</div>`;
                }
                html += `<div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px;">`;
                html += `<button onclick="window._companionAct('talk','${npc.id}')" style="${BTN} background: #355; color: #cde;">💬 Talk</button>`;
                html += `<button onclick="window._companionAct('gift','${npc.id}')" style="${BTN} background: #553; color: #eed;">🎁 Gift (${cfg.giftCost}g)</button>`;
                if (d.wageDue > 0) html += `<button onclick="window._companionAct('pay','${npc.id}')" style="${BTN} background: #353; color: #cec;">💰 Pay ${d.wageDue}g</button>`;
                if (d.gripe && d.gripe.kind === 'raise') html += `<button onclick="window._companionAct('raise','${npc.id}')" style="${BTN} background: #563; color: #efc;">📈 Grant raise (${d.gripe.demand}g/day)</button>`;
                if (d.quest && d.quest.status === 'offered') html += `<button onclick="window._companionAct('quest','${npc.id}')" style="${BTN} background: #654; color: #fec;">📜 Hear them out</button>`;
                if (d.quest && d.quest.status === 'active' && d.quest.payable) html += `<button onclick="window._companionAct('contribute','${npc.id}')" style="${BTN} background: #654; color: #fec;">💰 Give 50g to their cause</button>`;
                html += `<button onclick="window._partyOpenProfile('${npc.id}')" style="${BTN} background: #444; color: #ddd;">Profile</button>`;
                html += `<button onclick="window._companionAct('dismiss','${npc.id}')" style="${BTN} background: #533; color: #ecc;">Dismiss</button>`;
                html += `</div></div>`;
            }
        }
        const mourned = (player.companions && player.companions.mourned) || [];
        if (mourned.length) {
            html += '<h5 style="margin: 8px 0 4px; color: #999;">🕯️ The Fallen</h5>';
            for (const m of mourned.slice().reverse()) {
                html += `<div style="font-size: 11px; color: #aaa; padding: 2px 8px;">${_esc(m.name)}${m.devoted ? ' 💛' : ''} — fell on day ${m.day}${m.enemy ? ` against ${_esc(m.enemy)}` : ''}</div>`;
            }
        }
        return html;
    },

    /** Wire the roster's inline handlers; `refresh` re-renders the panel. */
    bind(game, refresh) {
        const player = game.player;
        const world = game.world;
        const notify = (title, text, type) => game.ui.showNotification(title, text, type);
        window._companionAct = (action, npcId) => {
            let r;
            switch (action) {
                case 'talk':
                    r = Companions.talk(player, npcId, world);
                    if (r.success) notify(`💬 ${r.npc.firstName}`, r.text, 'info');
                    break;
                case 'gift':
                    r = Companions.gift(player, npcId, world);
                    if (r.success) notify(`🎁 ${r.npc.firstName}`, `${r.text} (approval +${r.gain})`, 'success');
                    break;
                case 'pay':
                    r = Companions.payWages(player, npcId, world);
                    if (r.success) notify('💰 Wages Paid', `${r.npc.firstName} is paid ${r.paid} gold.`, 'success');
                    break;
                case 'raise':
                    r = Companions.grantRaise(player, npcId, world);
                    if (r.success) notify('📈 Raise Granted', `${r.npc.firstName} now earns ${r.wage} gold a day.`, 'success');
                    break;
                case 'quest':
                    r = Companions.acceptQuest(player, npcId, world);
                    if (r.success) notify('📜 Personal Quest', `${r.quest.title}: ${r.quest.description}`, 'success');
                    break;
                case 'contribute':
                    r = Companions.contribute(player, npcId, 50, world);
                    if (r.success) notify('💰 Contribution', `You give ${r.paid} gold. ${r.remaining > 0 ? `${r.remaining} to go.` : 'That settles it.'}`, 'success');
                    break;
                case 'dismiss':
                    r = Companions.dismiss(player, npcId, world);
                    if (r.success) notify('👋 Dismissed', `${r.npc.firstName} takes their leave.`, 'info');
                    break;
                default:
                    r = { success: false, reason: 'Unknown action.' };
            }
            if (!r.success) notify('Companion', r.reason, 'warning');
            if (game.ui.updateStats) game.ui.updateStats(player, world);
            refresh();
        };
    },
};

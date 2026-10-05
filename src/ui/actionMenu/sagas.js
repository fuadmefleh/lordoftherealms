// ActionMenu — the Sagas journal: the world storylines the player has heard
// of, the chapters seen so far, what they've heard, and the chapter's actions
// (Journal → Sagas). Logic lives in systems/sagas.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Sagas } from './_imports.js';

const BTN = 'padding: 5px 8px; margin: 3px 3px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_OFF = BTN + 'background: #333; color: #777; cursor: not-allowed;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 10px 0 4px;';
const OUTCOME = { triumph: ['🏆', '#7fd07f'], mixed: ['⚖️', '#e0b040'], tragedy: ['🕯️', '#e08080'] };

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _costText(cost) {
    if (!cost) return '';
    const parts = [];
    if (cost.gold) parts.push(`${cost.gold}g`);
    if (cost.prestige) parts.push(`${cost.prestige} Prestige`);
    for (const [item, n] of Object.entries(cost.items || {})) parts.push(`${n} ${item.replace(/_/g, ' ')}`);
    return parts.length ? ` (${parts.join(', ')})` : '';
}

function _sagaCard(player, world, saga, open) {
    let html = `<div style="${CARD}">`;
    const where = [saga.anchor.settlement && saga.anchor.settlement.name, saga.anchor.kingdomName].filter(Boolean).join(', ');
    html += `<div style="display:flex; justify-content:space-between; gap:8px;"><strong style="color:var(--gold); font-size:13px;">${saga.icon} ${_esc(saga.name)}</strong>`;
    if (saga.ended) {
        const [icon, color] = OUTCOME[saga.ended.outcome] || OUTCOME.mixed;
        html += `<span style="color:${color}; white-space:nowrap;">${icon} ${_esc(saga.ended.title)}</span>`;
    } else {
        html += `<span style="color:#aaa; white-space:nowrap;">since day ${saga.startDay}</span>`;
    }
    html += '</div>';
    html += `<div style="font-size:11px; color:#999;">${_esc(where)}${saga.involved ? ' · <span style="color:#7fd07f;">you have a hand in this</span>' : ''}</div>`;

    // Chapters seen
    const seen = saga.history.filter(h => h.heard);
    const unseen = saga.history.length - seen.length;
    html += `<div style="${HEAD} color: var(--gold);">Chapters</div>`;
    if (unseen > 0) html += `<div style="color:#777; font-style:italic; font-size:11px;">${unseen} earlier chapter${unseen === 1 ? '' : 's'} passed before you heard.</div>`;
    seen.forEach((h, i) => {
        const current = open && i === seen.length - 1 && !saga.ended;
        html += `<div style="padding:3px 0; ${current ? 'color:#eee;' : 'color:#bbb;'}"><span style="color:#888; font-size:10px;">Day ${h.day}</span> <b>${_esc(h.title)}</b>${current ? ' <span style="color:var(--gold); font-size:10px;">(now)</span>' : ''}`;
        if (open || i === seen.length - 1) html += `<div style="font-size:11px; color:#aaa; margin-left:6px;">${_esc(h.text)}</div>`;
        html += '</div>';
    });

    // What you've heard
    if (open && saga.heard.length) {
        html += `<div style="${HEAD} color:#9ab;">What You've Heard</div>`;
        for (const h of saga.heard.slice(-6).reverse()) {
            html += `<div style="font-size:11px; color:#ccc; padding:2px 0;">🗣️ <span style="color:#777;">day ${h.day}</span> ${_esc(h.text)}</div>`;
        }
    }

    // What you can do now
    if (open && !saga.ended) {
        const actions = Sagas.actions(player, world, saga);
        if (actions.length) {
            html += `<div style="${HEAD} color:#7fd07f;">Your Part</div>`;
            for (const a of actions) {
                const label = `${_esc(a.label)}${_esc(_costText(a.cost))}`;
                if (a.ok) html += `<button onclick="window._sagas.act('${saga.uid}', '${a.id}')" style="${BTN_GOLD}">${label}</button>`;
                else html += `<button disabled title="${_esc(a.reason)}" style="${BTN_OFF}">${label}</button><span style="font-size:10px; color:#888;"> ${_esc(a.reason)}</span><br>`;
            }
        }
        const boss = saga.units.find(u => u.role === 'boss' && !u.slain && !u.gone);
        if (boss) html += `<div style="font-size:11px; color:#e0b040; margin-top:4px;">${boss.icon} ${_esc(boss.name)} was last seen near (${boss.q}, ${boss.r}) — strength ${boss.strength}.</div>`;
        if (saga.anchor.site) html += `<div style="font-size:11px; color:#9ab; margin-top:2px;">📍 ${_esc(saga.anchor.site.name)} at (${saga.anchor.site.q}, ${saga.anchor.site.r}) — a place to delve.</div>`;
    }
    if (saga.rewards.length) html += `<div style="font-size:11px; color:#7fd07f; margin-top:4px;">${saga.rewards.map(_esc).join(' · ')}</div>`;
    html += '</div>';
    return html;
}

Object.assign(ActionMenu, {
    /** Journal → Sagas: known storylines, chapters seen, rumours heard, and your part in them. */
    showSagasJournal(game, message = null) {
        const player = game.player;
        const world = game.world;
        const j = Sagas.journal(player);
        let html = '<div style="max-height: 540px; overflow-y: auto; font-size: 12px;">';
        if (message) html += `<div style="${CARD} border-color: ${message.color || 'rgba(245,197,66,0.4)'}; color:#eee;">${message.html}</div>`;
        html += '<p style="margin:0 0 6px; color:var(--text-secondary);">Great stories unfold across the realms whether you take part or not. Hear of them in taverns, at court and on the road; act while a chapter lasts, or let the world decide.</p>';
        if (!j.active.length) {
            html += `<div style="${CARD} color:#999;">${j.unknownActive ? 'Something is stirring somewhere in the world, but no word of it has reached you yet. Check tavern notice boards.' : 'No great tale is unfolding that you know of.'}</div>`;
        }
        for (const s of j.active) html += _sagaCard(player, world, s, true);
        if (j.done.length) {
            html += `<div style="${HEAD} color:#999;">Concluded</div>`;
            for (const s of j.done) html += _sagaCard(player, world, s, false);
        }
        html += '</div>';

        window._sagas = {
            act: (uid, actionId) => {
                const res = Sagas.act(player, world, uid, actionId);
                if (!res.success) {
                    game.ui.showNotification('📜 Sagas', res.reason, 'error');
                    return;
                }
                for (const n of res.notices || []) game.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
                game.ui.updateStats(player, world);
                ActionMenu.showSagasJournal(game, { html: `📜 ${_esc(res.text)}` });
            },
        };
        game.ui.showCustomPanel('📜 Sagas', html);
    },
});

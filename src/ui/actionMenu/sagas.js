// ActionMenu — the Sagas journal: the world storylines the player has heard
// of, the chapters seen so far, what they've heard, and the chapter's actions
// (Journal → Sagas). Logic lives in systems/sagas.js; this panel presents it.
// The action menu's voice (uiKit.js): a card a saga, its chapters as a listing,
// your part as rows (cost at the right, greyed with the reason).
import { ActionMenu } from './_ref.js';
import { Sagas } from './_imports.js';
import { lede, card, rowList, sectionHead, more, esc } from './uiKit.js';

const OUTCOME = { triumph: ['🏆', 'good'], mixed: ['⚖️', 'warn'], tragedy: ['🕯️', 'bad'] };
const MUTED = 'font-size:11px; color:#a99a78;';

function _costText(cost) {
    if (!cost) return '';
    const parts = [];
    if (cost.gold) parts.push(`${cost.gold}g`);
    if (cost.prestige) parts.push(`⭐${cost.prestige}`);
    for (const [item, n] of Object.entries(cost.items || {})) parts.push(`${n} ${item.replace(/_/g, ' ')}`);
    return parts.join(' · ');
}

function _chapterRows(saga, open) {
    const seen = saga.history.filter(h => h.heard);
    return seen.map((h, i) => {
        const current = open && i === seen.length - 1 && !saga.ended;
        return {
            icon: current ? '▶' : '·',
            name: `${esc(h.title)}${current ? ' <span style="color:var(--gold); font-size:10px;">(now)</span>' : ''}`,
            desc: open || i === seen.length - 1 ? esc(h.text) : '',
            side: `<span style="${MUTED}">day ${h.day}</span>`,
        };
    });
}

function _sagaCard(player, world, saga, open) {
    const where = [saga.anchor.settlement && saga.anchor.settlement.name, saga.anchor.kingdomName].filter(Boolean).join(', ');
    let side, tone = '';
    if (saga.ended) {
        const [icon, t] = OUTCOME[saga.ended.outcome] || OUTCOME.mixed;
        side = `${icon} ${esc(saga.ended.title)}`;
        tone = t;
    } else side = `<span style="${MUTED}">since day ${saga.startDay}</span>`;

    let body = `<div style="${MUTED}">${esc(where)}${saga.involved ? ' · <span style="color:#9fd89f;">you have a hand in this</span>' : ''}</div>`;
    const unseen = saga.history.length - saga.history.filter(h => h.heard).length;
    if (unseen > 0) body += `<div style="${MUTED} font-style:italic;">${unseen} earlier chapter${unseen === 1 ? '' : 's'} passed before you heard.</div>`;
    const chapters = rowList(_chapterRows(saga, open));
    body += open ? chapters : more('Chapters', chapters);

    if (open && saga.heard.length) {
        body += more(`What you've heard (${Math.min(6, saga.heard.length)})`, rowList(saga.heard.slice(-6).reverse().map(h => ({
            icon: '🗣️', name: esc(h.text), side: `<span style="${MUTED}">day ${h.day}</span>`,
        }))));
    }

    if (open && !saga.ended) {
        const rows = Sagas.actions(player, world, saga).map(a => ({
            icon: '📜', name: esc(a.label), desc: '', off: !a.ok, why: esc(a.reason || ''),
            side: a.cost ? `<span class="pk-price">${esc(_costText(a.cost))}</span>` : '',
            attrs: a.ok ? `onclick="window._sagas.act('${esc(saga.uid)}', '${esc(a.id)}')"` : '',
        }));
        body += rowList(rows, 'Your part');
        const where2 = [];
        const boss = saga.units.find(u => u.role === 'boss' && !u.slain && !u.gone);
        if (boss) where2.push({ icon: boss.icon, name: esc(boss.name), desc: `Last seen near (${boss.q}, ${boss.r})`, side: `⚔️ ${boss.strength}`, tone: 'warn' });
        if (saga.anchor.site) where2.push({ icon: '📍', name: esc(saga.anchor.site.name), desc: `At (${saga.anchor.site.q}, ${saga.anchor.site.r}): a place to delve` });
        body += rowList(where2);
    }
    if (saga.rewards.length) body += `<div style="font-size:11px; color:#9fd89f; margin-top:4px;">${saga.rewards.map(esc).join(' · ')}</div>`;
    return card(body, { icon: saga.icon, title: esc(saga.name), side, tone });
}

Object.assign(ActionMenu, {
    /** Journal → Sagas: known storylines, chapters seen, rumours heard, and your part in them. */
    showSagasJournal(game, message = null) {
        const player = game.player;
        const world = game.world;
        const j = Sagas.journal(player);
        let html = '<div style="max-height: 540px; overflow-y: auto; font-size: 12px;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        html += lede('Great stories unfold across the realms whether you take part or not. Hear of them in taverns, at court and on the road; act while a chapter lasts.');
        if (!j.active.length) {
            html += lede(j.unknownActive ? 'Something is stirring somewhere in the world, but no word of it has reached you yet. Check tavern notice boards.' : 'No great tale is unfolding that you know of.');
        }
        for (const s of j.active) html += _sagaCard(player, world, s, true);
        if (j.done.length) {
            html += sectionHead(`Concluded (${j.done.length})`);
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
                ActionMenu.showSagasJournal(game, { html: `📜 ${esc(res.text)}` });
            },
        };
        game.ui.showCustomPanel('📜 Sagas', html);
    },
});

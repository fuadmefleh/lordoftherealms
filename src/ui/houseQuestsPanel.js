// The House's unfinished business in the Quest Journal (systems/houseQuests.js):
// each open matter as a card — the telling, the holder's own words, the
// objectives and, once the player stands at the place, the ways to settle it
// as action-menu rows — and the matters settled as a short list.
import { HouseQuests } from '../systems/houseQuests.js';
import { card, rowList, sectionHead, bullets, price, esc } from './actionMenu/uiKit.js';

function _uiAttrs(method, args) {
    return `data-ui-act="${method}" data-ui-args='${esc(JSON.stringify(args))}'`;
}

/** The journal section's HTML ('' when the House has no business, open or past). */
export function houseQuestsHtml(world, player) {
    if (!world || !player) return '';
    let v;
    try { v = HouseQuests.view(world, player); } catch (e) { return ''; }
    if (!v.open.length && !v.past.length) return '';
    let html = sectionHead('Unfinished Business of the House');
    for (const q of v.open) {
        let body = `<div style="font-size: 13px; line-height: 1.45;">${esc(q.hook)}</div>`;
        if (q.journal && q.journal !== q.hook) body += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px; font-style: italic;">${esc(q.journal)}</div>`;
        body += bullets(q.objectives.map(o => `${o.done ? '✓' : '○'} ${esc(o.text)}`));
        const rows = q.options.map(o => ({
            icon: o.ok ? '▸' : '·', name: esc(o.label), desc: esc(o.desc),
            side: o.cost != null ? price(o.cost, _num(player.gold) >= o.cost) : '',
            off: !o.ok, why: o.why ? esc(o.why) : null,
            attrs: _uiAttrs('houseQuestAct', [q.id, o.id]),
        }));
        rows.push({ icon: '✕', name: 'Let it lie', desc: 'Leave the matter be. It will be remembered that you did.', attrs: _uiAttrs('houseQuestDismiss', [q.id]), tone: 'warn' });
        body += rowList(rows);
        const side = q.daysLeft != null ? `${q.daysLeft} days` : '';
        html += card(body, { title: esc(q.title), icon: q.icon, side: q.here ? `here · ${side}` : `${esc(q.place || '')} · ${side}` });
    }
    if (v.past.length) {
        html += rowList(v.past.map(q => ({
            icon: q.icon, name: esc(q.title), desc: esc(q.epilogue),
            note: q.effects && q.effects.length ? esc(q.effects.join(' · ')) : '',
            side: q.status === 'done' ? 'settled' : 'closed', tone: q.status === 'done' ? 'good' : 'bad',
        })), 'Settled and Closed');
    }
    return html;
}

function _num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }

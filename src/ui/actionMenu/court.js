// ActionMenu — the Court: hear petitions brought to your holdings and rule
// on them. Logic lives in systems/petitions.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Petitions } from './_imports.js';

const BTN = 'padding: 6px 10px; margin: 4px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px; text-align: left;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const BTN_DISMISS = BTN + 'background: #5a3030; color: #eee;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';

Object.assign(ActionMenu, {
    /** The Court panel: pending petitions, court reputation and recent rulings. */
    showCourtPanel(game, tile) {
        const player = game.player;
        const world = game.world;
        const pending = Petitions.pending(player);
        const axes = Petitions.axisMeta();
        const court = Petitions.courtStanding(player);

        let html = '<div style="font-size:12px;">';
        html += '<p style="margin:0 0 6px; color:var(--text-secondary);">Petitioners from your holdings wait to be heard. Every choice has a price; unanswered petitions expire, and that has a price too.</p>';

        if (!pending.length) {
            html += `<div style="${CARD} color:var(--text-secondary);">No petitioners wait today. New ones arrive every week or so while you hold lands, an office, or a House of standing.</div>`;
        }
        for (const p of pending) {
            const def = Petitions.defOf(p);
            const days = Petitions.daysLeft(p, world);
            html += `<div style="${CARD}">`;
            html += `<div style="display:flex; justify-content:space-between; gap:8px;"><strong style="color:var(--gold);">${p.icon} ${p.title}</strong>`;
            html += `<span style="color:${days <= 2 ? '#e08080' : '#e0b040'}; white-space:nowrap;">${days} day(s)</span></div>`;
            if (p.ctx && p.ctx.settlementName) html += `<div style="font-size:11px; color:#999;">${p.ctx.settlementName}${p.ctx.kingdomName ? ` · ${p.ctx.kingdomName}` : ''}</div>`;
            html += `<div style="color:#ccc; margin:4px 0 6px;">${p.text}</div>`;
            for (const ch of (def && def.choices) || []) {
                const can = Petitions.canChoose(player, p, ch);
                const fx = Petitions.describeEffects(ch.effects, p.ctx, player, world);
                const gamble = ch.gamble ? ` · ${Math.round((ch.gamble.chance || 0.5) * 100)}% gamble` : '';
                const follow = ch.followUp ? ' · consequences may follow' : '';
                const courtTags = Object.entries((ch.effects && ch.effects.court) || {})
                    .filter(([, v]) => v > 0).map(([k]) => (axes[k] && axes[k].icon) || k).join('');
                const sub = `${fx.join(', ') || 'no immediate cost'}${gamble}${follow}`;
                html += `<button ${can.ok ? `onclick="window._court.rule(${p.id}, '${ch.id}')"` : 'disabled'} style="${can.ok ? BTN_GOLD : BTN_DIM} display:block; width:100%;">`;
                html += `${courtTags ? `${courtTags} ` : ''}${Petitions.fill(ch.label, p.ctx)}`;
                html += `<div style="font-weight:normal; font-size:10px; opacity:0.8;">${can.ok ? sub : can.reason}</div></button>`;
            }
            const ig = (def && def.ignore) || {};
            const igFx = Petitions.describeEffects(ig.effects, p.ctx, player, world);
            html += `<button onclick="window._court.dismiss(${p.id})" style="${BTN_DISMISS} display:block; width:100%;">Send them away unheard`;
            html += `<div style="font-weight:normal; font-size:10px; opacity:0.8;">${igFx.join(', ') || 'no immediate cost'}</div></button>`;
            html += '</div>';
        }

        // Court reputation — what lords and peoples remember of your rulings
        html += '<h5 style="margin:10px 0 4px;">⚖️ Your Court\'s Reputation</h5>';
        html += '<div style="display:flex; flex-wrap:wrap; gap:6px;">';
        for (const id of Petitions.COURT_AXES) {
            const v = court[id] || 0;
            const meta = axes[id] || { name: id, icon: '' };
            html += `<span style="background:rgba(0,0,0,0.25); padding:3px 6px; border-radius:4px; color:${v > 0 ? '#7fd07f' : v < 0 ? '#e08080' : '#aaa'};">${meta.icon} ${meta.name} ${v > 0 ? '+' : ''}${v}</span>`;
        }
        html += '</div><div style="font-size:10px; color:#888; margin-top:2px;">Honorable lords value justice, pious ones piety, cruel ones severity, cautious ones mercy; greedy lords like a grasping hand.</div>';

        // Recent rulings
        const hist = Petitions.history(player).slice(-6).reverse();
        if (hist.length) {
            html += '<h5 style="margin:10px 0 4px;">📜 Recent Rulings</h5>';
            html += '<div style="font-size:11px; color:#bbb; max-height:140px; overflow-y:auto;">';
            for (const h of hist) {
                const what = h.outcome === 'ruled' ? h.choice : (h.outcome === 'dismissed' ? 'sent away unheard' : 'ignored — it expired');
                html += `<div style="padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05);">Day ${h.day}: ${h.icon || ''} <strong>${h.title}</strong>${h.where ? ` (${h.where})` : ''} — ${what}${h.notable ? ' ⭐' : ''}</div>`;
            }
            html += '</div>';
        }
        html += '</div>';
        game.ui.showCustomPanel('⚖️ Court', html);

        const after = (title, res, kind) => {
            if (!res.success) {
                game.ui.showNotification(title, res.reason || 'Not possible.', 'error');
            } else {
                const fx = res.effects && res.effects.length ? ` (${res.effects.join(', ')})` : '';
                game.ui.showNotification(title, `${res.text}${fx}`, kind);
            }
            game.ui.updateStats(player, world);
            ActionMenu.showCourtPanel(game, tile);
        };
        window._court = {
            rule: (id, choiceId) => after('⚖️ Ruling', Petitions.rule(player, world, id, choiceId), 'success'),
            dismiss: (id) => after('⚖️ Petitioners Dismissed', Petitions.dismiss(player, world, id), 'warning'),
        };
    },
});

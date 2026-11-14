// ActionMenu — the Court: hear petitions brought to your holdings and rule
// on them. Logic lives in systems/petitions.js; this panel presents it in the
// action menu's voice (ui/actionMenu/uiKit.js): a card per petition with one
// row per ruling (its cost and what it pleases on the row), your court's
// reputation as chips, and the recent rulings folded away.
import { ActionMenu } from './_ref.js';
import { Petitions } from './_imports.js';
import { lede, chips, rowList, card, more, esc } from './uiKit.js';

Object.assign(ActionMenu, {
    /** The Court panel: pending petitions, court reputation and recent rulings. */
    showCourtPanel(game, tile) {
        const player = game.player;
        const world = game.world;
        const pending = Petitions.pending(player);
        const axes = Petitions.axisMeta();
        const court = Petitions.courtStanding(player);

        let html = '<div style="font-size:12px;">';
        html += lede(pending.length
            ? 'Petitioners from your holdings wait to be heard. Every ruling has a price, and so does leaving them to wait.'
            : 'No petitioners wait today. New ones come every week or so while you hold lands, an office or a House of standing.');

        // What your court is known for: the lords weigh it
        html += `<div style="font-size:11px; color:#9d937c; margin:0 0 3px;" title="Honourable lords value justice, pious ones piety, cruel ones severity, cautious ones mercy; greedy lords like a grasping hand.">Your court is known for (lords weigh it by temper)</div>`;
        html += chips(Petitions.COURT_AXES.map(id => {
            const v = court[id] || 0;
            const meta = axes[id] || { name: id, icon: '' };
            const col = v > 0 ? '#8fd18a' : '#e0846a';
            return { icon: meta.icon, label: meta.name, value: v ? `<span style="color:${col};">${v > 0 ? '+' : ''}${v}</span>` : '0', cls: v ? '' : 'dim' };
        }));

        for (const p of pending) {
            const def = Petitions.defOf(p);
            const days = Petitions.daysLeft(p, world);
            const rows = ((def && def.choices) || []).map(ch => {
                const can = Petitions.canChoose(player, p, ch);
                const fx = Petitions.describeEffects(ch.effects, p.ctx, player, world);
                const pleases = Object.entries((ch.effects && ch.effects.court) || {})
                    .filter(([, v]) => v > 0).map(([k]) => (axes[k] && axes[k].icon) || k).join('');
                const extra = [ch.gamble ? `${Math.round((ch.gamble.chance || 0.5) * 100)}% gamble` : '', ch.followUp ? 'consequences may follow' : ''].filter(Boolean).join(' · ');
                return {
                    icon: '⚖️',
                    name: Petitions.fill(ch.label, p.ctx),
                    desc: fx.join(', ') || 'No immediate cost',
                    note: extra,
                    side: pleases,
                    title: pleases ? 'What your court will be known for' : '',
                    off: !can.ok, why: can.reason,
                    attrs: `onclick="window._court.rule(${p.id}, '${ch.id}')"`,
                };
            });
            const ig = (def && def.ignore) || {};
            const igFx = Petitions.describeEffects(ig.effects, p.ctx, player, world);
            rows.push({ icon: '🚪', name: 'Send them away unheard', desc: igFx.join(', ') || 'No immediate cost', tone: 'bad', attrs: `onclick="window._court.dismiss(${p.id})"` });
            const where = p.ctx && p.ctx.settlementName ? `<div style="font-size:11px; color:#9d937c;">${esc(p.ctx.settlementName)}${p.ctx.kingdomName ? ` · ${esc(p.ctx.kingdomName)}` : ''}</div>` : '';
            html += card(`${where}<div style="color:#d8ccaf; margin:4px 0;">${p.text}</div>${rowList(rows)}`, {
                icon: p.icon, title: p.title,
                side: `${days} day${days === 1 ? '' : 's'} left`, tone: days <= 2 ? 'bad' : '',
            });
        }

        const hist = Petitions.history(player).slice(-6).reverse();
        html += more(`Recent rulings (${hist.length})`, rowList(hist.map(h => ({
            icon: h.icon || '📜',
            name: `${esc(h.title)}${h.notable ? ' ⭐' : ''}`,
            desc: `${h.where ? `${esc(h.where)} · ` : ''}${h.outcome === 'ruled' ? esc(h.choice) : (h.outcome === 'dismissed' ? 'sent away unheard' : 'left to expire')}`,
            side: `day ${h.day}`,
        }))));
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

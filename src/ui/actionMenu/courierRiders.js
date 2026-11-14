// ActionMenu — a post rider met on the road (systems/courierRiders.js): whose
// house, from where to where, how far along, and — if it carries one of your
// letters — which; your own house's riders report to you. A rider that is
// not yours can be robbed (the fight goes through the shared attack panel,
// ActionMenu.performAttack → PlayerMilitary.attackUnit → CourierRiders.onRobbed).
// Buttons route through data-am-act → ActionMenu.riderAct.
import { ActionMenu } from './_ref.js';
import { CourierRiders } from '../../systems/courierRiders.js';
import { card, chips, rowList, esc } from './uiKit.js';

const MUTED = 'font-size:11px; color:#a99a78;';

Object.assign(ActionMenu, {
    /** Hail a post rider within a hex. */
    showRider(game, unitId, message = null) {
        const { player, world } = game;
        const u = CourierRiders.find(world, unitId);
        if (!u || !CourierRiders.meetable(player, world).includes(u)) {
            game.ui.showNotification('On the Road', 'The rider has ridden on.', 'info');
            return;
        }
        const v = CourierRiders.describe(world, player, u);
        let html = '<div style="font-size:12px;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'good' : 'bad' });
        let body = `<div style="${MUTED}">${esc(v.from)} → ${esc(v.to)} · ${v.progress}% of the way${v.daysLeft ? ` · due in ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'}` : ' · due today'}</div>`;
        body += chips([['🛡️', 'Guard', v.guards], ['✉️', 'Letters', v.letters], v.coin ? ['💰', 'Coin', `~${v.coin}g`] : null]);
        if (v.sealed && !v.own) body += `<div style="${MUTED}">A letter under a lord's seal, by the look of it.</div>`;
        if (v.yourLetter) {
            const L = v.yourLetter;
            body += `<div style="margin-top:4px;">${L.icon} Your ${esc(L.kind.toLowerCase())} to <b>${esc(L.to)}</b> rides with them${L.gold ? `, with ${L.gold} gold enclosed` : ''}${L.item ? `, with your ${esc(String(L.item.id).replace(/_/g, ' '))}` : ''}.${L.delayed ? ' <span style="color:#d8c89f;">They are held up on the road.</span>' : ''}</div>`;
        }
        if (v.yourReply) body += `<div style="margin-top:4px;">📨 They carry <b>${esc(v.yourReply.from)}</b>'s answer to your letter${v.yourReply.gold ? `, with ${v.yourReply.gold} gold` : ''}.</div>`;
        const mine = v.own || v.yourLetter || v.yourReply;
        body += `<div style="${MUTED} font-style:italic; margin-top:4px;">${mine ? `“${v.yourReply ? 'An answer for you, as it happens. I will bring it on.' : v.yourLetter ? 'Your letter is safe with me.' : 'All well on the road, master.'}” The rider touches a hat.` : `“Post for ${esc(v.to)}. Mind the road, traveller.”`}</div>`;
        html += card(body, { icon: v.icon, title: esc(v.name), side: `${esc(v.house)}${v.own ? ' · <span style="color:#9fd89f;">your house</span>' : ''}` });
        html += rowList([
            { icon: '👋', name: 'Let them ride on', act: 'riderAct', args: ['close', u.id] },
            mine ? null : { icon: '🗡️', name: 'Rob the mailbag', desc: 'Fight the guard for the bag: its coin and letters; the house and its realm will hear of it', act: 'riderAct', args: ['rob', u.id], tone: 'bad' },
        ]);
        html += '</div>';
        game.ui.showCustomPanel(`${v.icon} A Post Rider`, html);
    },

    riderAct(game, op, unitId) {
        if (op === 'rob') {
            ActionMenu._pendingAP = ActionMenu.getAPCost('attack_unit');
            ActionMenu.performAttack(game, unitId);
            return;
        }
        if (game.ui.hideCustomPanel) game.ui.hideCustomPanel();
    },
});

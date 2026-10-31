// ActionMenu — a post rider met on the road (systems/courierRiders.js): whose
// house, from where to where, how far along, and — if it carries one of your
// letters — which; your own house's riders report to you. A rider that is
// not yours can be robbed (the fight goes through the shared attack panel,
// ActionMenu.performAttack → PlayerMilitary.attackUnit → CourierRiders.onRobbed).
// Buttons route through data-am-act → ActionMenu.riderAct.
import { ActionMenu } from './_ref.js';
import { CourierRiders } from '../../systems/courierRiders.js';
import { BTN_GOLD, BTN_PLAIN, BTN_RED, CARD, esc } from './uiKit.js';

function act(label, args, style = BTN_PLAIN) {
    return `<button data-am-act="riderAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}">${label}</button>`;
}

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
        if (message) html += `<div style="${CARD} border-color:${message.ok ? 'rgba(159,216,159,0.5)' : 'rgba(224,128,128,0.5)'};">${esc(message.text)}</div>`;
        html += `<div style="${CARD}"><div style="font-weight:bold; color:var(--gold);">${v.icon} ${esc(v.name)}</div>`;
        html += `<div style="font-size:11px; color:#aaa;">${esc(v.house)}${v.own ? ' · <span style="color:#9fd89f;">your house</span>' : ''} · ${esc(v.from)} → ${esc(v.to)} · ${v.progress}% of the way${v.daysLeft ? ` · due in ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'}` : ' · due today'}</div>`;
        html += `<div style="font-size:11px; color:#bbb; margin-top:4px;">🛡️ ${v.guards} guard strength · ✉️ ${v.letters} letter${v.letters === 1 ? '' : 's'} in the bag${v.coin ? ` · 💰 about ${v.coin} gold` : ''}${v.sealed && !v.own ? ' · a letter under a lord\'s seal, by the look of it' : ''}</div>`;
        if (v.yourLetter) {
            const L = v.yourLetter;
            html += `<div style="margin-top:6px; color:#ddd;">${L.icon} Your ${esc(L.kind.toLowerCase())} to <b>${esc(L.to)}</b> rides with them${L.gold ? `, with ${L.gold} gold enclosed` : ''}${L.item ? `, with your ${esc(String(L.item.id).replace(/_/g, ' '))}` : ''}.${L.delayed ? ' <span style="color:#d8c89f;">They are held up on the road.</span>' : ''}</div>`;
        }
        if (v.yourReply) html += `<div style="margin-top:6px; color:#ddd;">📨 They carry <b>${esc(v.yourReply.from)}</b>'s answer to your letter${v.yourReply.gold ? `, with ${v.yourReply.gold} gold` : ''}.</div>`;
        html += '</div><div>';
        if (v.own || v.yourLetter || v.yourReply) html += `<div style="font-size:11px; color:#999;">"${v.yourReply ? 'An answer for you, as it happens. I will bring it on.' : v.yourLetter ? 'Your letter is safe with me.' : 'All well on the road, master.'}" The rider touches a hat and rides on.</div>`;
        else html += `<div style="font-size:11px; color:#999;">"Post for ${esc(v.to)}. Mind the road, traveller."</div>`;
        html += `<div style="margin-top:6px;">${act('Let them ride on', ['close', u.id], BTN_GOLD)}`;
        if (!v.own && !v.yourLetter && !v.yourReply) html += act('🗡️ Rob the mailbag', ['rob', u.id], BTN_RED);
        html += '</div></div></div>';
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

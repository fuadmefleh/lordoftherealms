// ActionMenu — a merchant caravan or trading ship met on the road
// (systems/merchantCaravans.js): its house, route and cargo; buy from its
// cargo or sell it the goods it deals in, hire on as escort, or rob it (the
// fight goes through the shared attack panel, ActionMenu.performAttack).
// Buttons route through data-am-act.
import { ActionMenu } from './_ref.js';
import { MerchantCaravans, PlayerMilitary } from './_imports.js';

const BTN = 'padding: 4px 8px; margin: 2px 3px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_RED = BTN + 'background: #8a2c22; color: #eee;';
const BTN_OFF = BTN + 'background: #333; color: #777; cursor: not-allowed;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _btn(ok, label, act, args, style = BTN_GOLD, reason = '') {
    if (!ok) return `<button disabled title="${_esc(reason)}" style="${BTN_OFF}">${label}</button>`;
    return `<button data-am-act="${act}" data-am-args='${_esc(JSON.stringify(args))}' style="${style}">${label}</button>`;
}

Object.assign(ActionMenu, {
    /** The trader panel: who, where to, what it carries and at what price; escort and robbery. */
    showTrader(game, unitId, message = null) {
        const { player, world } = game;
        const u = MerchantCaravans.find(world, unitId);
        if (!u) {
            game.ui.showCustomPanel('🐫 On the Road', '<div style="padding:12px; color:#aaa;">The trader has moved on.</div>');
            return;
        }
        const house = u.house || {};
        let html = '<div style="padding:8px;">';
        if (message) html += `<div style="${CARD} color:${message.ok ? '#7fd07f' : '#e08080'}; font-size:12px;">${_esc(message.text)}</div>`;
        html += `<div style="${CARD}"><div style="font-weight:bold; color:var(--gold);">${u.icon} ${_esc(u.name)}</div>`;
        html += `<div style="font-size:11px; color:#ccc;">${house.icon || '⚖️'} ${_esc(house.name || 'Free traders')} · ${_esc(u.fromName)} → ${_esc(u.toName)} · ${Math.round(MerchantCaravans.progress(u) * 100)}% of the way</div>`;
        html += `<div style="font-size:11px; color:#aaa;">Guards ${u.strength} · purse ${Math.floor(u.purse || 0)}g · cargo worth ~${u.value}g${u.tollsPaid ? ` · ${u.tollsPaid}g paid in tolls` : ''}</div>`;
        if (u.danger) html += '<div style="font-size:11px; color:#e0a070;">⚠️ The road runs near an outlaw lair.</div>';
        html += '</div>';

        // Cargo and prices
        html += `<div style="${CARD}"><div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#9ab; margin-bottom:4px;">Cargo</div>`;
        const offers = MerchantCaravans.offers(u);
        if (!offers.length) html += '<div style="font-size:11px; color:#888;">Nothing left to sell.</div>';
        for (const o of offers) {
            const held = Math.floor((player.inventory && player.inventory[o.id]) || 0);
            html += `<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; font-size:12px; margin:3px 0;">`;
            html += `<span>${o.icon} ${_esc(o.name)} <span style="color:#888;">×${o.qty}</span></span><span>`;
            html += _btn(o.qty >= 1 && (player.gold || 0) >= o.buy, `Buy ${o.buy}g`, 'traderBuy', [u.id, o.id, 1], BTN_GOLD, 'Not enough gold or stock');
            html += _btn(o.qty >= 5 && (player.gold || 0) >= o.buy * 5, '×5', 'traderBuy', [u.id, o.id, 5], BTN_GOLD, 'Not enough gold or stock');
            html += _btn(held >= 1 && (u.purse || 0) >= o.sell, `Sell ${o.sell}g`, 'traderSell', [u.id, o.id, 1], BTN_GOLD, held ? 'The merchant cannot pay' : 'You have none');
            html += '</span></div>';
        }
        html += '<div style="font-size:10px; color:#888; margin-top:4px;">Prices run from what the goods fetch where they were bought toward what they fetch where they are going. What you buy never reaches that market.</div></div>';

        // Escort and robbery
        html += `<div style="${CARD}">`;
        if (u.escort && u.escort.by === 'player') {
            html += `<div style="font-size:12px; color:#7fd07f;">🛡️ You ride as their escort: ${u.escort.pay}g on reaching ${_esc(u.toName)}. Stay within ${MerchantCaravans.config().escort.range} hexes to fight off ambushes.</div>`;
            html += _btn(true, 'Leave their service', 'traderQuitEscort', [u.id], BTN_RED);
        } else {
            const can = MerchantCaravans.canEscort(player, world, u);
            html += _btn(can.ok, `🛡️ Hire on as escort (${u.escortPay}g on arrival)`, 'traderEscort', [u.id], BTN_GOLD, can.reason || '');
            if (!can.ok && can.reason) html += `<div style="font-size:10px; color:#888;">${_esc(can.reason)}</div>`;
        }
        const army = PlayerMilitary.getArmyStrength ? PlayerMilitary.getArmyStrength(player) : 0;
        html += `<div style="margin-top:6px;">${_btn(true, `🗡️ Rob them (guards ${u.strength} vs your ${army})`, 'traderRob', [u.id], BTN_RED)}</div>`;
        html += '<div style="font-size:10px; color:#888;">Robbery: the goods are hot (only a fence will take them), the realm wants you, and the town waiting on this cargo goes without.</div>';
        html += '</div></div>';
        game.ui.showCustomPanel(`${u.icon} ${u.name}`, html);
    },

    traderBuy(game, unitId, goodId, qty) {
        const r = MerchantCaravans.buy(game.player, game.world, unitId, goodId, qty);
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showTrader(game, unitId, r.success ? { ok: true, text: `Bought ${r.qty} for ${r.cost} gold.` } : { ok: false, text: r.reason });
    },

    traderSell(game, unitId, goodId, qty) {
        const r = MerchantCaravans.sell(game.player, game.world, unitId, goodId, qty);
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showTrader(game, unitId, r.success ? { ok: true, text: `Sold ${r.qty} for ${r.pay} gold.` } : { ok: false, text: r.reason });
    },

    traderEscort(game, unitId) {
        const r = MerchantCaravans.hireEscort(game.player, game.world, unitId);
        ActionMenu.showTrader(game, unitId, r.success
            ? { ok: true, text: `Hired. Bring them safe to ${r.to} and you are paid ${r.pay} gold.` }
            : { ok: false, text: r.reason });
    },

    traderQuitEscort(game, unitId) {
        MerchantCaravans.quitEscort(game.player, game.world, unitId);
        ActionMenu.showTrader(game, unitId, { ok: false, text: 'You leave their service, unpaid.' });
    },

    /** Rob the trader: the shared attack (PlayerMilitary.attackUnit → MerchantCaravans.onRobbed). */
    traderRob(game, unitId) {
        ActionMenu._pendingAP = ActionMenu.getAPCost('attack_unit');
        ActionMenu.performAttack(game, unitId);
    },
});

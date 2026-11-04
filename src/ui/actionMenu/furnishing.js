// ActionMenu — the Furniture Maker: buy beds, chests, tables, hearths and the
// rest (systems/furnishing.js, data/furniture.json) for the homes you own;
// see your furniture store and sell pieces back. Opened from the world action
// menu in any settlement ('furniture_maker') and from a market stall on the
// town map (ui/objectActions). Pieces are set down inside a home with Furnish
// (ui/innerMapFurnish.js). Buttons route through data-am-act → furnitureAct.
import { ActionMenu } from './_ref.js';
import { Furnishing } from '../../systems/furnishing.js';
import { BTN_GOLD, BTN_OFF, BTN_PLAIN, CARD, esc } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function act(label, args, style = BTN_PLAIN, title = '') {
    return `<button data-am-act="furnitureAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function _settlement(game) {
    const wt = game.world && game.world.getTile ? game.world.getTile(game.player.q, game.player.r) : null;
    return (wt && wt.settlement) || null;
}

function _does(item) {
    const out = [];
    if (item.restBonus) out.push(`sleep +${Math.round(item.restBonus * 100)}%`);
    if (item.comfort) out.push(`comfort +${item.comfort}/h`);
    const fp = item.footprint || [1, 1];
    if (fp[0] * fp[1] > 1) out.push(`${fp[0]}×${fp[1]} tiles`);
    if (item.passable) out.push('walk over it');
    return out.join(' · ');
}

Object.assign(ActionMenu, {
    /** The furniture maker's shop, and the player's furniture store. */
    showFurnitureShop(game, tileOrMsg = null, message = null) {
        if (tileOrMsg && typeof tileOrMsg === 'object' && 'text' in tileOrMsg && !message) message = tileOrMsg;
        const { player } = game;
        const s = _settlement(game);
        const type = (s && s.type) || 'village';
        let html = '<div style="font-size:12px;">';
        if (message) html += `<div style="${CARD} border-color:${message.ok ? 'rgba(159,216,159,0.5)' : 'rgba(224,128,128,0.5)'};">${esc(message.text)}</div>`;
        html += `<p style="${NOTE}">${s ? `The joiner of ${esc(s.name)}` : 'A joiner'} makes what a ${esc(type)} can make — bigger places, finer pieces. What you buy waits in your furniture store until you set it down in a home you own: go inside it and choose <b>Furnish</b>.</p>`;

        html += `<div style="font-weight:bold; color:var(--gold); margin-top:8px;">🪑 For sale</div>`;
        for (const item of Furnishing.shopList(player, type)) {
            html += `<div style="${CARD} display:flex; justify-content:space-between; gap:8px; align-items:center;">`;
            html += `<div><div><span style="font-size:15px;">${item.icon || '🪑'}</span> <b>${esc(item.name)}</b> <span style="color:var(--gold);">${item.price}g</span></div>`;
            html += `<div style="${NOTE}">${esc(item.desc || '')}${_does(item) ? ` <i>(${esc(_does(item))})</i>` : ''}</div></div>`;
            html += `<div style="flex-shrink:0;">${item.affordable ? act('Buy', ['buy', item.id], BTN_GOLD) : `<button style="${BTN_OFF}" title="Not enough gold">Buy</button>`}</div>`;
            html += '</div>';
        }

        const stored = Furnishing.storeView(player);
        html += `<div style="font-weight:bold; color:var(--gold); margin-top:12px;">📦 Your furniture store (${stored.length})</div>`;
        if (!stored.length) html += `<p style="${NOTE}">Nothing in store.</p>`;
        for (const { piece, view, value } of stored) {
            html += `<div style="${CARD} display:flex; justify-content:space-between; gap:8px; align-items:center;">`;
            html += `<div><span style="font-size:15px;">${view.icon}</span> ${esc(view.name)}${view.original ? ` <span style="${NOTE}">(from a house of yours)</span>` : ''}</div>`;
            html += `<div style="flex-shrink:0;">${act(`Sell (${value}g)`, ['sell', piece.uid], BTN_PLAIN, 'The joiner buys it back')}</div></div>`;
        }
        const homes = Furnishing.homesView(player);
        if (homes.length) {
            html += `<div style="${NOTE} margin-top:8px;">Furnished: ${homes.map(h => `${esc(h.name)}${h.town ? ` in ${esc(h.town)}` : ''} (${h.pieces})`).join(' · ')}</div>`;
        }
        html += '</div>';
        game.ui.showCustomPanel('🪑 Furniture Maker', html);
    },

    /** The shop's buttons: ['buy', itemId] or ['sell', uid]. */
    furnitureAct(game, op, ref) {
        const { player, world } = game;
        const s = _settlement(game);
        let res;
        if (op === 'buy') res = Furnishing.buy(player, world, ref, (s && s.type) || 'village');
        else if (op === 'sell') res = Furnishing.sell(player, ref);
        else return;
        if (res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showFurnitureShop(game, null, { ok: !!res.success, text: res.text });
    },
});

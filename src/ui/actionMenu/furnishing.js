// ActionMenu — the Furniture Maker: buy beds, chests, tables, hearths and the
// rest (systems/furnishing.js, data/furniture.json) for the homes you own;
// see your furniture store and sell pieces back. Opened from the world action
// menu in any settlement ('furniture_maker') and from a market stall on the
// town map (ui/objectActions). Pieces are set down inside a home with Furnish
// (ui/innerMapFurnish.js). Buttons route through data-am-act → furnitureAct.
import { ActionMenu } from './_ref.js';
import { Furnishing } from '../../systems/furnishing.js';
import { FurnitureCatalogue } from '../../world/furnitureCatalogue.js';
import { esc, lede, chips, purse, card, rowList, sectionHead, price } from './uiKit.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): one row a piece, its
// price at the right; a stored piece's row sells it back.
const NOTE = 'font-size: 11px; color: var(--text-secondary);';

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
    if (item.cheer) out.push(`cheer +${item.cheer}/h`);
    if (item.light) out.push('light');
    if (item.prestige) out.push('guests remark on it');
    if (item.kind === 'decor') out.push('on a table or shelf');
    else if (item.kind === 'wall') out.push(item.onWindow ? 'at a window' : 'on a wall');
    else if (item.passable) out.push('walk over it');
    if (FurnitureCatalogue.holdsThings(item.type)) out.push('storage');
    return out.join(' · ');
}

Object.assign(ActionMenu, {
    /** The furniture maker's shop, and the player's furniture store. */
    showFurnitureShop(game, tileOrMsg = null, message = null) {
        if (tileOrMsg && typeof tileOrMsg === 'object' && 'text' in tileOrMsg && !message) message = tileOrMsg;
        const { player } = game;
        const s = _settlement(game);
        const type = (s && s.type) || 'village';
        const stored = Furnishing.storeView(player);
        let html = '<div style="font-size:12px;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'good' : 'bad' });
        html += lede(`${s ? `The joiner, weaver, potter, chandler and smith of ${esc(s.name)}` : 'The makers'} make what a ${esc(type)} can make: bigger places, finer pieces. What you buy waits in your store until you go inside a home you own and choose <b>Furnish</b>.`);
        html += chips([purse(player.gold), ['📦', 'In store', stored.length]]);

        // One list a maker: the joiner, the weaver, the potter, the chandler, the smith
        const forSale = Furnishing.shopList(player, type);
        const makers = FurnitureCatalogue.makers();
        const order = [...Object.keys(makers), ...new Set(forSale.map(i => i.maker || 'joiner'))].filter((m, i, a) => a.indexOf(m) === i);
        for (const m of order) {
            const list = forSale.filter(i => (i.maker || 'joiner') === m);
            if (!list.length) continue;
            const mk = makers[m] || { name: m, icon: '💺' };
            html += rowList(list.map(item => ({
                icon: item.icon || '💺', name: esc(item.name),
                desc: `${esc(item.desc || '')}${_does(item) ? ` <i>(${esc(_does(item))})</i>` : ''}`,
                side: price(item.price, item.affordable), off: !item.affordable, why: `Your purse is short. ${esc(item.desc || '')}`,
                act: 'furnitureAct', args: ['buy', item.id],
            })), `${mk.icon || '💺'} ${esc(mk.name)}`);
        }
        const job = Furnishing.windowJob();
        html += `<div style="${NOTE} margin-top:6px;">🪟 A window is building work, not a piece: inside a home of yours, Furnish → <b>Knock Through a Window</b> (${esc(job.price)}g to a mason).</div>`;

        html += rowList(stored.map(({ piece, view, value }) => ({
            icon: view.icon, name: `Sell the ${esc(view.name)}`,
            desc: view.original ? 'From a house of yours' : 'The joiner buys it back',
            side: price(value), act: 'furnitureAct', args: ['sell', piece.uid],
        })), `📦 Your furniture store (${stored.length})`);
        if (!stored.length) html += sectionHead('📦 Your furniture store') + `<div style="${NOTE}">Nothing in store.</div>`;
        const homes = Furnishing.homesView(player);
        if (homes.length) {
            html += `<div style="${NOTE} margin-top:8px;">Furnished: ${homes.map(h => `${esc(h.name)}${h.town ? ` in ${esc(h.town)}` : ''} (${h.pieces}${h.decor ? ` + ${h.decor} things` : ''})`).join(' · ')}</div>`;
        }
        html += '</div>';
        game.ui.showCustomPanel('💺 Furniture Maker', html);
    },

    /** The shop's buttons: ['buy', itemId] or ['sell', uid]. */
    furnitureAct(game, op, ref) {
        const { player, world } = game;
        const s = _settlement(game);
        let res;
        if (op === 'buy') res = Furnishing.buy(player, world, ref, (s && s.type) || 'village');
        else if (op === 'sell') res = Furnishing.sell(player, ref, world);
        else return;
        if (res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showFurnitureShop(game, null, { ok: !!res.success, text: res.text });
    },
});

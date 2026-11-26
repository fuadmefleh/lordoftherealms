// ============================================
// UI — Goods Left Here (the world map's hex: what lies on the ground)
// ============================================
// The world map's door to systems/groundGoods.js: the piles on the hex the
// player stands on — theirs left at the roadside, others' abandoned, a
// town's refuse — each with Pick up (all, one, half). Someone's goods just
// set down are stolen if lifted (the theft roll: systems/containers.js). The
// street map shows the same piles on the ground (ui/innerMapGroundGoods.js).

import { UI } from './core.js';
import { GroundGoods } from '../../systems/groundGoods.js';
import { Grades } from '../../core/grades.js';
import { itemIcon } from '../icons.js';
import { rowList, lede, esc } from '../actionMenu/uiKit.js';
import { Hotbar } from '../hotbar.js';
import { PlayerCoin } from '../../player/playerCoin.js';

const TITLE = '🧺 Goods Left Here';
const _args = (a) => esc(JSON.stringify(a));

/** The panel's HTML for the piles on hex (q, r) — exported for the spec. */
export function groundGoodsHtml(game, q, r) {
    const world = game.world;
    const day = Number(world.day) || 0;
    const piles = GroundGoods.at(world, q, r);
    const tile = typeof world.getTile === 'function' ? world.getTile(q, r) : null;
    const place = GroundGoods.placeOf(tile);
    const intro = place === 'town' ? 'Left lying in the streets, they will not lie long: beggars, ragpickers and passers-by take what they find.'
        : place === 'road' ? 'At the roadside, travellers and carters going by may take what they find.'
            : 'Out here few pass: things may lie a long while, but outlaws about will have them.';
    let html = lede(intro);
    if (!piles.length) return html + rowList([{ icon: '🍂', name: 'Nothing lies here now', off: true, why: 'Whatever was here is gone' }]);
    const rows = [];
    for (const p of piles) {
        const name = p.label || `${p.refuse ? 'Spoiled ' : ''}${GroundGoods.nameOf(p.good)}`;
        const theirs = GroundGoods.claimed(p, day);
        const whose = p.by === 'player' ? `Yours, left on day ${p.day}` : p.refuse ? 'Thrown out: anyone\'s' : theirs ? `${p.claim.name || p.byName || 'Someone'} set it down: taking it is theft` : 'Abandoned: anyone\'s for the taking';
        const graded = Object.keys(p.grades || {}).length ? ` · ${Object.entries(p.grades).map(([g, n]) => `${n} ${Grades.get(g).name || g}`).join(', ')}` : '';
        const verb = theirs ? 'Take' : 'Pick up';
        rows.push({ icon: itemIcon(p.good, GroundGoods.iconOf(p.good), 22), name: `${verb} ${p.qty > 1 ? `all ${p.qty}` : ''} ${esc(name)}`.replace(/\s+/g, ' '), desc: `${esc(whose)}${esc(graded)}`, side: `×${p.qty}`, tone: theirs ? 'warn' : null, attrs: `data-ui-act="ggPick" data-ui-args="${_args([q, r, p.id, null])}"` });
        if (p.qty > 1) rows.push({ icon: '☝️', name: `${verb} one`, desc: `Leave ${p.qty - 1}`, attrs: `data-ui-act="ggPick" data-ui-args="${_args([q, r, p.id, 1])}"` });
        if (p.qty >= 4) rows.push({ icon: '✌️', name: `${verb} half (${Math.floor(p.qty / 2)})`, desc: 'Take half, leave half', attrs: `data-ui-act="ggPick" data-ui-args="${_args([q, r, p.id, Math.floor(p.qty / 2)])}"` });
    }
    html += rowList(rows);
    html += `<p class="gg-note">Set more down from the Inventory: pick a good and choose Drop…</p>`;
    return html;
}

/** The second-hand goods the townsfolk's houses would sell (their finds) — exported for the spec. */
export function secondHandHtml(game, settlement) {
    const rows = GroundGoods.secondHand(settlement);
    let html = lede('What the townsfolk picked up in the streets and kept, and would let go for a little coin: odd things no stall deals in, cheap.');
    if (!rows.length) return html + rowList([{ icon: '🍂', name: 'Nothing to sell just now', off: true, why: 'The houses have kept nothing they would part with' }]);
    const gold = Number(game.player.gold) || 0;
    html += rowList(rows.map(x => ({
        icon: itemIcon(x.good, GroundGoods.iconOf(x.good), 22), name: `Buy one ${esc(GroundGoods.nameOf(x.good).toLowerCase())}`,
        desc: `Second-hand · ${x.qty} to be had`, side: `${x.price}g`, off: gold < x.price, why: gold < x.price ? 'Not enough coin' : '',
        attrs: `data-ui-act="ggBuyUsed" data-ui-args="${_args([settlement.q, settlement.r, x.good, 1])}"`,
    })));
    return html;
}

Object.assign(UI.prototype, {
    /** The second-hand goods of the town at (q, r). */
    showSecondHand(q = this.game.player.q, r = this.game.player.r) {
        const tile = this.game.world.getTile(q, r);
        if (!tile || !tile.settlement) return;
        this.showCustomPanel(`♻️ Second-hand — ${tile.settlement.name || 'the town'}`, secondHandHtml(this.game, tile.settlement));
    },

    /** Buy `n` of a good second-hand from the town at (q, r). */
    ggBuyUsed(q, r, good, n = 1) {
        const game = this.game;
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || game.player.q !== q || game.player.r !== r) { this.showNotification('♻️ Too Far', 'You have left that town.', 'error'); return; }
        const res = GroundGoods.buyUsed(game.world, game.player, tile.settlement, good, n);
        this.showNotification(res.ok ? '♻️ Bought' : '♻️ Second-hand', res.ok ? res.text : res.reason, res.ok ? 'success' : 'warning');
        this.updateStats(game.player, game.world);
        Hotbar.refresh();
        this.showSecondHand(q, r);
    },

    /** The piles on hex (q, r) — the player's own hex. */
    showGroundGoods(q = this.game.player.q, r = this.game.player.r) {
        this._ggAt = { q, r };
        const line = GroundGoods.goneLine(this.game.world, q, r);
        if (line) this.showNotification('🖐️ Gone', line, 'warning');
        this.showCustomPanel(TITLE, groundGoodsHtml(this.game, q, r));
    },

    /** Pick up `qty` (null: all) of a pile on hex (q, r). */
    ggPick(q, r, pileId, qty = null) {
        const game = this.game;
        const player = game.player;
        if (player.q !== q || player.r !== r) { this.showNotification('🧺 Too Far', 'You have left that place.', 'error'); return; }
        const pile = GroundGoods.find(game.world, q, r, pileId);
        if (!pile) { this.showNotification('🧺 Gone', 'Someone has had it already.', 'warning'); this.showGroundGoods(q, r); return; }
        const tile = typeof game.world.getTile === 'function' ? game.world.getTile(q, r) : null;
        // (on the world map no one is close enough to see the owner: in a town a few people about)
        const scene = { witnesses: tile && tile.settlement ? 2 : 0, guards: 0, hour: 12 };
        // (someone's set down for the day is watched over: they are about it, in a town or at their cart)
        const ownerNear = !!(tile && tile.settlement) || !!(pile.claim && pile.claim.kind);
        const res = GroundGoods.pickUp(game.world, player, q, r, pileId, qty == null ? pile.qty : qty, { scene, ownerNear });
        if (res.ok && res.gold > 0) PlayerCoin.found(game.world, player, res.gold, 'salvage', 'exploration');
        if (res.ok) this.showNotification(`${GroundGoods.iconOf(pile.good)} Picked Up`, res.text, 'success');
        else this.showNotification(res.theft ? '🚨 Caught' : '🎒 Pick Up', res.text || res.reason, res.theft ? 'error' : 'warning');
        this.updateStats(player, game.world);
        Hotbar.refresh();
        this.showGroundGoods(q, r);
    },
});
